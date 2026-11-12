"""CPU/I/O execution: per-server CPUs and one capacity-limited shared dependency.

Both CPU stages share a non-preemptive FIFO per server. All servers share the
I/O FIFO. Admission bounds every unfinished request, including both queues.
"""
from collections import deque
from dataclasses import dataclass
from heapq import heappop, heappush
from hashlib import sha256
from struct import pack
from math import ceil, inf, isfinite
from random import Random
from time import perf_counter

from lbsim.continuous import ContinuousSimulation
from lbsim.policies import RoutingContext, create_policy


@dataclass
class Work:
    id: int
    arrival: float
    demand: float
    io_fraction: float
    stage: int = 0
    cpu_ready_at: float = 0.
    cpu_wait: float = 0.
    io_ready_at: float = 0.
    io_wait: float = 0.


class StagedSimulation(ContinuousSimulation):
    def __init__(self, config, *, response_window=2000, history_points=240, record=False):
        count = config['server_count']
        self.io_waiting = self.io_in_service = 0
        self.io_capacity = config.get('io_capacity', 64)
        if type(self.io_capacity) is not int or not 1 <= self.io_capacity <= 4096:
            raise ValueError('Shared I/O concurrency must be an integer from 1 to 4096.')
        self.workload_digest = sha256()
        self.io = [0] * count
        self.io_active = [0] * count
        self.io_queued = [0] * count
        self.io_ready = deque()
        self.outstanding = [0] * count
        self.io_areas = [0.] * count
        self.queue_areas = [0.] * count
        self.io_busy_seconds = self.io_last_time = 0.
        self.peak_io_queue = 0
        self.queue_delay = self.io_queue_delay = 0.
        self.cpu_service_sum = self.io_service_sum = 0.
        self.record = record
        self.event_log, self.all_responses = [], []
        self.serial, self.arrival_limit = 0, inf
        self.type_rng = Random(config['seed'] + 2000000)
        super().__init__(config, response_window=response_window, history_points=history_points)
        self.ready = [deque() for _ in range(count)]
        self.routing = create_policy(config['policy'], RoutingContext(
            count, self.active.__getitem__, demand=self.outstanding.__getitem__,
            routing_rng=Random(config['seed'] + 1000000)))

    def _touch(self, sid):
        elapsed = self.now - self.area_times[sid]
        self.io_areas[sid] += elapsed * self.io[sid]
        self.queue_areas[sid] += elapsed * self.queued[sid]
        super()._touch(sid)

    def _io_time(self):
        self.io_busy_seconds += (self.now-self.io_last_time) * self.io_in_service
        self.io_last_time = self.now

    def _push(self, when, kind, sid, work):
        if not isfinite(when) or when < self.now:
            raise ValueError('Stage time must be finite and cannot go backwards.')
        self.serial += 1
        heappush(self.pending, (when, 1 if kind == 'io' else 0,
                               self.serial, sid, kind, work))

    def _start_cpu(self, sid):
        while self.ready[sid] and self.active[sid] < self.config['concurrency']:
            work = self.ready[sid].popleft()
            self.queued[sid] -= 1
            self.waiting -= 1
            work.cpu_wait += self.now-work.cpu_ready_at
            self.active[sid] += 1
            self.running += 1
            duration = work.demand*(1-work.io_fraction)/2/self.servers[sid].processing_rate
            if self.now+duration <= self.now:
                raise ValueError('CPU stage is too short for the simulation clock.')
            self._push(self.now+duration, 'cpu', sid, work)
        self.routing.update(sid)

    def _start_io(self):
        while self.io_ready and self.io_in_service < self.io_capacity:
            sid, work = self.io_ready.popleft()
            self._touch(sid)
            self._io_time()
            self.io_queued[sid] -= 1
            self.io_active[sid] += 1
            self.io_in_service += 1
            work.io_wait += self.now-work.io_ready_at
            self._push(self.now+work.demand*work.io_fraction, 'io', sid, work)
            self._emit(sid, 'io_started', work.id)

    def _emit(self, sid, action, rid):
        if self.record:
            self.event_log.append((self.now, sid, self.active[sid], self.queued[sid],
                                   action, rid, self.io[sid], self.outstanding[sid],
                                   self.io_active[sid], self.io_queued[sid]))

    def advance(self, target, *, max_events=2000, budget_seconds=None):
        if not isfinite(target) or target < self.now or max_events < 1:
            raise ValueError('Use a finite forward target and positive event budget.')
        deadline = perf_counter()+budget_seconds if budget_seconds is not None else inf
        count = 0
        while True:
            arrival = self.next_arrival if self.offered < self.arrival_limit else inf
            completion = self.pending[0][0] if self.pending else inf
            if min(arrival, completion) > target:
                break
            if count >= max_events or perf_counter() >= deadline:
                return False
            count += 1
            if completion <= arrival:
                now, _, _, sid, kind, work = heappop(self.pending)
                self._time(now)
                self._touch(sid)
                self._io_time()
                rid = work.id
                if kind == 'io':
                    self.io_active[sid] -= 1
                    self.io_in_service -= 1
                    self.io[sid] -= 1
                    self.io_waiting -= 1
                    work.stage, work.cpu_ready_at = 1, now
                    self.ready[sid].append(work)
                    self.queued[sid] += 1
                    self.waiting += 1
                    action = 'io_to_cpu'
                else:
                    self.active[sid] -= 1
                    self.running -= 1
                    if work.stage == 0:
                        self.io[sid] += 1
                        self.io_waiting += 1
                        self.io_queued[sid] += 1
                        work.io_ready_at = now
                        self.io_ready.append((sid, work))
                        action = 'cpu_to_io'
                    else:
                        self.outstanding[sid] -= 1
                        self.completed += 1
                        response = now-work.arrival
                        self.response_sum += response
                        self.queue_delay += work.cpu_wait
                        self.io_queue_delay += work.io_wait
                        self.cpu_service_sum += work.demand*(1-work.io_fraction)/self.servers[sid].processing_rate
                        self.io_service_sum += work.demand*work.io_fraction
                        self.responses.append(response)
                        if self.record:self.all_responses.append(response)
                        action = 'completed'
                self._start_cpu(sid)
                self._emit(sid, action, rid)
                # Record the released slot before promoting a different server's
                # queued dependency call, preserving capacity at every event.
                self._start_io()
                self.peak_io_queue = max(self.peak_io_queue, len(self.io_ready))
            else:
                self._time(arrival)
                rid = self.offered
                sid = self.routing.choose()
                self._touch(sid)
                demand = self.rng.uniform(self.config['service_min'], self.config['service_max'])
                fraction = self.config['io_fraction']
                if 'io_heavy_probability' in self.config:
                    fraction = .9 if self.type_rng.random() < self.config['io_heavy_probability'] else .1
                self.workload_digest.update(pack("!qddd", rid, self.now, demand, fraction))
                self.offered += 1
                if self.outstanding[sid] >= self.config['outstanding_limit']:
                    self.rejected += 1
                    action = 'rejected'
                else:
                    self.outstanding[sid] += 1
                    work = Work(rid, self.now, demand, fraction, cpu_ready_at=self.now)
                    self.ready[sid].append(work)
                    self.queued[sid] += 1
                    self.waiting += 1
                    self._start_cpu(sid)
                    action = 'queued' if self.ready[sid] else 'started'
                self.arrival_index += 1
                self.next_arrival = self.anchor+self.arrival_index/self.rate if self.rate else inf
                self._emit(sid, action, rid)
            assert self.outstanding[sid] == self.active[sid]+self.queued[sid]+self.io[sid]
            assert self.io[sid] == self.io_active[sid]+self.io_queued[sid]
            assert 0 <= self.active[sid] <= self.config['concurrency']
            assert 0 <= self.outstanding[sid] <= self.config['outstanding_limit']
            assert 0 <= self.io_in_service <= self.io_capacity
            assert self.offered == self.completed+self.rejected+self.running+self.waiting+self.io_waiting
        self._time(target)
        return True

    def sample(self):
        super().sample()
        self.history[-1].update(io_waiting=self.io_waiting, io_active=self.io_in_service,
                                io_queued=len(self.io_ready),
                                outstanding=self.running+self.waiting+self.io_waiting)

    def latency_breakdown(self):
        return {key: value/self.completed if self.completed else None for key,value in (
            ('mean_cpu_queue_wait', self.queue_delay), ('mean_io_queue_wait', self.io_queue_delay),
            ('mean_cpu_service_time', self.cpu_service_sum), ('mean_io_service_time', self.io_service_sum))}

    def snapshot(self, **options):
        result = super().snapshot(**options)
        result['request_model'] = 'cpu_io'
        result['workload_sha256'] = self.workload_digest.hexdigest()
        result['totals'].update(io_waiting=self.io_waiting, io_active=self.io_in_service,
                               io_queued=len(self.io_ready),
                               outstanding=self.running+self.waiting+self.io_waiting)
        result['metrics'].update(self.latency_breakdown())
        busy = self.io_busy_seconds+(self.now-self.io_last_time)*self.io_in_service
        result['io_resource'] = dict(capacity=self.io_capacity, active=self.io_in_service,
                                     queued=len(self.io_ready), utilization=busy/(self.now*self.io_capacity) if self.now else 0.)
        for row in result['servers']['items']:
            sid = row['id']
            row.update(io_waiting=self.io[sid], io_active=self.io_active[sid], io_queued=self.io_queued[sid],
                       outstanding=self.outstanding[sid], outstanding_limit=self.config['outstanding_limit'],
                       queue_limit=self.config['outstanding_limit'])
        return result


def run_staged_simulation(config):
    sim = StagedSimulation(config, record=True)
    sim.arrival_limit = int(config['arrival_rate']*config['duration'])
    while not sim.advance(config['duration'], max_events=20000):pass
    sim.next_arrival = inf
    for sid in range(config['server_count']):sim._touch(sid)
    sim._io_time()
    io_busy = sim.io_busy_seconds
    areas, io_areas, queue_areas = list(sim.areas), list(sim.io_areas), list(sim.queue_areas)
    while sim.pending:
        sim.advance(sim.pending[0][0], max_events=20000)
    assert sim.offered == sim.completed+sim.rejected
    assert not sim.io_ready and not sim.io_waiting and not sim.running and not sim.waiting
    values = sorted(sim.all_responses)
    return dict(completed_count=sim.completed, rejected_count=sim.rejected,
                mean_response_time=sim.response_sum/sim.completed if sim.completed else None,
                p95_response_time=values[ceil(.95*len(values))-1] if values else None,
                per_server_utilization={i:a/(config['duration']*config['concurrency']) for i,a in enumerate(areas)},
                per_server_mean_io_waiting={i:a/config['duration'] for i,a in enumerate(io_areas)},
                per_server_mean_cpu_queued={i:a/config['duration'] for i,a in enumerate(queue_areas)},
                **sim.latency_breakdown(),
                io_resource=dict(capacity=sim.io_capacity, utilization=io_busy/(config['duration']*sim.io_capacity), peak_queue=sim.peak_io_queue),
                workload_sha256=sim.workload_digest.hexdigest(),
                request_model='cpu_io', events=sim.event_log, response_times=sim.all_responses)
