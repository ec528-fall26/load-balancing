"""Home-affine client cohorts and bounded migration telemetry."""

from bisect import bisect_right
from collections import deque
from itertools import accumulate
from random import Random

SHIFT_STEP = 0.2
MAX_SHIFT_STEPS = 3
OVERLOAD = 0.9
RECOVERED = 0.7


class RegionalClients:
    def __init__(self, weights, latency_ms, seed):
        self.weights = tuple(weights)
        self.total_weight = sum(weights)
        self.cumulative = tuple(accumulate(weights))[:-1]
        self.origin_rng = Random(seed ^ 0xC11E17)
        self.shift_rng = Random(seed ^ 0x5A1F7)
        self.latency_ms = latency_ms
        size = len(weights)
        self.destination = [None] * size
        self.steps = [0] * size
        self.overloaded = [0] * size
        self.recovered = [0] * size
        self.next_sample = 1
        self.changes = deque(maxlen=48)
        self.routed = [[0] * size for _ in weights]
        self.previous = [[0] * size for _ in weights]

    def preferred_route(self):
        origin = bisect_right(self.cumulative, self.origin_rng.random() * self.total_weight)
        if self.steps[origin] and self.shift_rng.random() < self.steps[origin] * SHIFT_STEP:
            return origin, self.destination[origin]
        return origin, origin

    def sample(self, online, loads, migration):
        now = self.next_sample
        self.next_sample += 1
        self.previous, self.routed = self.routed, [[0] * len(loads) for _ in loads]
        if not migration:
            return
        for origin, weight in enumerate(self.weights):
            if not weight:
                continue
            home_online = origin in online
            self.overloaded[origin] = self.overloaded[origin] + 1 if home_online and loads[origin] >= OVERLOAD else 0
            self.recovered[origin] = self.recovered[origin] + 1 if home_online and loads[origin] <= RECOVERED else 0
            destination = self.destination[origin]
            previous_steps = self.steps[origin]
            reason = None
            if (not home_online or self.overloaded[origin] >= 3
                    or (self.steps[origin] and destination not in online)):
                reason = 'outage' if not home_online else (
                    'overload' if self.overloaded[origin] >= 3 else 'destination_unavailable')
                candidates = [i for i in online if i != origin and loads[i] < OVERLOAD]
                if candidates:
                    if destination not in candidates:
                        self.destination[origin] = min(candidates, key=lambda i: (self.latency_ms[origin][i], loads[i], i))
                    self.steps[origin] = min(MAX_SHIFT_STEPS, self.steps[origin] + 1)
                elif destination not in online:
                    self.steps[origin] = 0
            elif self.recovered[origin] >= 10 and self.steps[origin]:
                reason = 'recovery'
                self.steps[origin] -= 1
            if not self.steps[origin]:
                self.destination[origin] = None
            if (self.steps[origin], self.destination[origin]) != (previous_steps, destination):
                self.changes.append(dict(simulation_time=now, origin=origin,
                    destination=self.destination[origin],
                    shifted_fraction=round(self.steps[origin] * SHIFT_STEP, 2), reason=reason))

    def report(self, rate):
        return [
            dict(origin=i, configured_rps=rate * weight / self.total_weight,
                 shifted_fraction=round(self.steps[i] * SHIFT_STEP, 2),
                 destination=self.destination[i], routed_per_second=self.previous[i][:])
            for i, weight in enumerate(self.weights)
        ]
