"""Incremental regional simulation, with a heap and bounded telemetry.

Regions are aggregate compute pools, not individually scheduled servers. RTT is
split equally between dispatch and response. Load reports are current in-process
state; network latency does not delay telemetry in this model.
"""

from collections import deque
from dataclasses import dataclass, field
from heapq import heappop, heappush
from math import exp, isfinite, ceil
from random import Random
from time import perf_counter

from lbsim.regions import Region, validate_topology
from lbsim.policies import RoutingContext, create_policy, supports_policy


@dataclass
class Pool:
    region: Region
    running: int = 0
    flying: int = 0
    waiting: deque = field(default_factory=deque)
    completed: int = 0
    rejected: int = 0
    load: list = field(default_factory=lambda: [0.0, 0.0, 0.0])
    load_time: float = 0.0
    responses: deque = field(default_factory=lambda: deque(maxlen=2000))

    def integrate_load(self, now):
        demand = self.running + len(self.waiting)
        elapsed = now - self.load_time
        for i, seconds in enumerate((60, 300, 900)):
            self.load[i] = demand + (self.load[i] - demand) * exp(-elapsed / seconds)
        self.load_time = now


class LiveSimulation:
    def __init__(self, regions, latency_ms, *, arrival_rate=1000.0,
                 service_min=0.1, service_max=1.0, source=0,
                 policy='least_loaded', seed=42, client_latency_ms=None):
        validate_topology(regions, latency_ms)
        if (type(source) is not int or not 0 <= source < len(regions)
                or not supports_policy(policy, 'regions')):
            raise ValueError('Choose a valid source region and routing policy.')
        if (not all(type(v) in (int, float) and isfinite(v) for v in (service_min, service_max))
                or not 0 < service_min <= service_max):
            raise ValueError('Service times must be positive and ordered.')
        self.regions = tuple(regions)
        self.latency_ms = tuple(tuple(row) for row in latency_ms)
        self.client_latency_ms = tuple(client_latency_ms if client_latency_ms is not None else self.latency_ms[source])
        if len(self.client_latency_ms) != len(regions) or any(type(v) not in (int, float) or not isfinite(v) or not 0 <= v <= 60000 for v in self.client_latency_ms):
            raise ValueError("Client RTT needs one finite nonnegative value per region (at most 60,000 ms).")
        self.pools = [Pool(r) for r in regions]
        self.source, self.policy = source, policy
        self.routing = create_policy(policy, RoutingContext(
            len(self.pools), lambda i: self.pools[i].running,
            demand=lambda i: (self.pools[i].running + len(self.pools[i].waiting)
                              + self.pools[i].flying),
            capacity=lambda i: self.regions[i].slots,
            latency_ms=self.client_latency_ms), 'regions')
        self.service_min, self.service_max = service_min, service_max
        self.seed = seed
        self.rng = Random(seed)
        self.now = 0.0
        self.anchor, self.arrival_index = 0.0, 0
        self.next_arrival = 0.0 if arrival_rate else float('inf')
        self.arrival_end = float('inf')
        self.set_rate(arrival_rate)
        self.arrival_index = 0
        self.next_arrival = 0.0 if arrival_rate else float('inf')
        self.events = []
        self.serial = 0
        self.offered = self.completed = self.rejected = 0
        self.returning = 0
        self.response_sum = 0.0
        self.responses = deque(maxlen=2000)
        self.history = deque(maxlen=240)

    def set_rate(self, rate):
        if type(rate) not in (int, float) or not isfinite(rate) or not 0 <= rate <= 100000:
            raise ValueError('Traffic must be between 0 and 100,000 requests/s.')
        self.arrival_rate = float(rate)
        self.anchor, self.arrival_index = self.now, 1
        self.next_arrival = self.anchor + self.arrival_index / rate if rate else float('inf')

    def _push(self, now, kind, region, request):
        # Completions free slots before dispatch; serial makes all ties stable.
        priority = {'complete': 0, 'dispatch': 1, 'response': 2}[kind]
        self.serial += 1
        heappush(self.events, (now, priority, self.serial, kind, region, request))

    def _start(self, region, request):
        pool = self.pools[region]
        pool.running += 1
        self._push(self.now + request[1] / pool.region.compute, 'complete', region, request)

    def advance(self, target, *, max_events=20000, budget_seconds=None):
        """Advance toward target; return False when work remains for another tick."""
        if not isfinite(target) or target < self.now:
            raise ValueError('Simulation time must be finite and cannot move backwards.')
        if max_events <= 0:
            raise ValueError('Event budget must be positive.')
        deadline = perf_counter() + budget_seconds if budget_seconds is not None else None
        processed = 0
        while True:
            next_arrival = self.next_arrival if self.next_arrival < self.arrival_end else float('inf')
            if min(next_arrival, self.events[0][0] if self.events else float('inf')) > target:
                break
            if processed >= max_events or (deadline is not None and processed % 128 == 0 and perf_counter() >= deadline):
                return False
            processed += 1
            if self.events and self.events[0][0] <= next_arrival:
                self.now, _, _, kind, region, request = heappop(self.events)
                pool = self.pools[region]
                pool.integrate_load(self.now)
                if kind == 'dispatch':
                    pool.flying -= 1
                    if pool.running < pool.region.slots:
                        self._start(region, request)
                    elif len(pool.waiting) < pool.region.queue_limit:
                        pool.waiting.append(request)
                    else:
                        pool.rejected += 1
                        self.rejected += 1
                elif kind == 'complete':
                    pool.running -= 1
                    self.returning += 1
                    self._push(self.now + self.client_latency_ms[region] / 2000,
                               'response', region, request)
                    if pool.waiting:
                        self._start(region, pool.waiting.popleft())
                else:
                    self.returning -= 1
                    self.completed += 1
                    pool.completed += 1
                    response = self.now - request[0]
                    self.response_sum += response
                    self.responses.append(response)
                    pool.responses.append(response)
            else:
                self.now = self.next_arrival
                region = self.routing.choose()
                request = (self.now, self.rng.uniform(self.service_min, self.service_max))
                self.offered += 1
                self.pools[region].flying += 1
                self._push(self.now + self.client_latency_ms[region] / 2000,
                           'dispatch', region, request)
                # Integer-indexed arrivals avoid accumulated interval error
                # admitting a request just before an exclusive one-shot cutoff.
                self.arrival_index += 1
                self.next_arrival = self.anchor + self.arrival_index / self.arrival_rate
        self.now = target
        return True

    def run_once(self, duration):
        """Offer traffic in [0, duration), then drain travel, queues and compute."""
        if not isfinite(duration) or duration <= 0 or self.now != 0 or self.offered:
            raise ValueError('Start a one-shot run with a fresh engine and positive duration.')
        self.arrival_end = duration
        while self.now < duration or self.events:
            target = min(duration, self.now + 0.5) if self.now < duration else self.now + 0.5
            while not self.advance(target):
                pass
            self.sample()
        return self

    def report(self):
        rows = []
        for i, pool in enumerate(self.pools):
            pool.integrate_load(self.now)
            rows.append({'Region': pool.region.name, 'Slots': pool.region.slots,
                         'Free': pool.region.slots - pool.running, 'Running': pool.running,
                         'Queued': len(pool.waiting), 'In transit': pool.flying,
                         'CPU / slots (%)': round(100 * pool.running / pool.region.slots, 1),
                         'Compute (×)': pool.region.compute,
                         'Load 1m': round(pool.load[0], 2), 'Load 5m': round(pool.load[1], 2),
                         'Load 15m': round(pool.load[2], 2),
                         'Network RTT (ms)': self.client_latency_ms[i],
                         'Response p95 (ms)': round(self.p95(pool.responses) * 1000, 1) if pool.responses else None,
                         'Completed': pool.completed, 'Rejected': pool.rejected})
        return rows

    @staticmethod
    def p95(values):
        ordered = sorted(values)
        return ordered[ceil(len(ordered) * 0.95) - 1] if ordered else 0.0

    def sample(self):
        rows = self.report()
        if self.history and self.history[-1]['Time (s)'] == self.now:
            self.history.pop()
        self.history.append({'Time (s)': self.now,
                             'Running': sum(p.running for p in self.pools),
                             'Queued': sum(len(p.waiting) for p in self.pools),
                             'In transit': sum(p.flying for p in self.pools) + self.returning})
        return rows
