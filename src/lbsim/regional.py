"""Version-one aggregate regional API model and bounded telemetry adapter."""
from collections import deque
from dataclasses import asdict
from lbsim.regions import Region, PRESETS
from lbsim.regional_engine import LiveSimulation


def presets():
    return [dict(id=name, regions=[asdict(r) for r in regions], latency_ms=matrix,
                 source=0, client_latency_ms=matrix[0])
            for name, (regions, matrix) in PRESETS.items()]


class RegionalSimulation(LiveSimulation):
    def __init__(self, config, *, response_window=2000, history_points=240):
        self.config = dict(config)
        super().__init__([Region(**r) for r in config['regions']], config['latency_ms'],
            arrival_rate=config['arrival_rate'], service_min=config['service_min'],
            service_max=config['service_max'], source=config['source'],
            policy=config['policy'], seed=config['seed'], client_latency_ms=config['client_latency_ms'],
            client_weights=config.get('client_weights'), client_migration=config.get('client_migration', False))
        self.responses = deque(maxlen=response_window)
        for p in self.pools:
            p.responses = deque(maxlen=response_window)
        self.history = deque(maxlen=history_points)

    def snapshot(self, *, history_limit=120, **_unused):
        rows = self.report()
        running = sum(p.running for p in self.pools)
        waiting = sum(len(p.waiting) for p in self.pools)
        in_transit = sum(p.flying for p in self.pools) + self.returning
        values = list(self.responses)
        bins = []
        if values:
            low, high = min(values), max(values)
            count = 1 if low == high else 20
            width = max(.001, abs(low) * .01) if count == 1 else (high-low)/count
            bins = [dict(start=low+i*width, end=low+(i+1)*width, count=0) for i in range(count)]
            for v in values:
                bins[min(count-1, int((v-low)/width))]['count'] += 1
        regions = [dict(name=r['Region'], slots=r['Slots'], online=p.online,
            free_slots=r['Free'] if p.online else 0,
            running=r['Running'], waiting=r['Queued'], outbound=r['In transit'],
            queue_limit=p.region.queue_limit, cpu_occupancy=r['CPU / slots (%)']/100,
            compute=r['Compute (×)'], load_averages=[r['Load 1m'],r['Load 5m'],r['Load 15m']],
            client_rtt_ms=r['Network RTT (ms)'], completed=r['Completed'], rejected=r['Rejected'],
            recent_p95_response_time=self.p95(p.responses) if p.responses else None,
            response_window_count=len(p.responses)) for r,p in zip(rows,self.pools)]
        snapshot = dict(topology='regions', model='aggregate_regional_pools',
            config={**self.config, 'arrival_rate': self.arrival_rate},
            simulation_time=self.now, arrival_rate=self.arrival_rate,
            totals=dict(offered=self.offered, completed=self.completed, rejected=self.rejected,
                        running=running, waiting=waiting, in_transit=in_transit),
            metrics=dict(mean_response_time=self.response_sum/self.completed if self.completed else None,
                recent_p95_response_time=self.p95(values) if values else None,
                response_window_count=len(values), response_window_limit=self.responses.maxlen),
            histogram=dict(scope='recent_completed_responses', bins=bins), regions=regions,
            history=[dict(simulation_time=h['Time (s)'], running=h['Running'], waiting=h['Queued'],
                          in_transit=h['In transit']) for h in list(self.history)[-history_limit:]] if history_limit else [],
            history_limit=self.history.maxlen, telemetry='immediate',
            retention=dict(pending_events=len(self.events), response_values=len(values),
                           history_points=len(self.history)))
        if self.clients:
            snapshot['client_traffic'] = self.clients.report(self.arrival_rate)
            snapshot['client_migration_events'] = list(self.clients.changes)
        return snapshot


def run_regional(config):
    engine = RegionalSimulation(config)
    engine.run_once(config['duration'])
    return engine.snapshot(history_limit=240)
