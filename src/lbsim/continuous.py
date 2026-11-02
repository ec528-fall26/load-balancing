"""Incremental single-pool engine: bounded outstanding work and recent telemetry.

Uses the same Server admission/completion behavior as one-shot runs. No request
trace or completed execution list is retained. The service owns advancement.
"""

from collections import deque
from heapq import heappop, heappush
from math import ceil, inf, isfinite
from random import Random
from time import perf_counter

from lbsim.server import Request, Server


class _Loads:
    """Bounded indexed minimum tree; running-count ties favor the lowest ID."""

    def __init__(self, count):
        self.width = 1 << (count - 1).bit_length()
        self.tree = [(inf, 0)] * (2 * self.width)
        for i in range(count):
            self.tree[self.width + i] = (0, i)
        for i in range(self.width - 1, 0, -1):
            self.tree[i] = min(self.tree[2 * i], self.tree[2 * i + 1])

    def update(self, server, running):
        i = self.width + server
        self.tree[i] = (running, server)
        while i > 1:
            i //= 2
            self.tree[i] = min(self.tree[2 * i], self.tree[2 * i + 1])

    def target(self):
        return self.tree[1][1]


class ContinuousSimulation:
    def __init__(self, config, *, response_window=2000, history_points=240):
        self.config = dict(config)
        count = config["server_count"]
        rates = config.get("processing_rates", [1.0] * count)
        self.servers = [
            Server(
                i,
                config["concurrency"],
                config["queue_limit"],
                processing_rate=rates[i],
            )
            for i in range(count)
        ]
        self.rng = Random(config["seed"])
        self.loads = _Loads(count)
        self.active = [0] * count
        self.queued = [0] * count
        self.areas = [0.0] * count
        self.area_times = [0.0] * count
        self.running = self.waiting = self.offered = self.completed = self.rejected = 0
        self.now = self.response_sum = self.occupied_seconds = 0.0
        self.rate = float(config["arrival_rate"])
        self.anchor = 0.0
        self.arrival_index = 0
        self.next_arrival = 0.0 if self.rate else inf
        self.pending = []
        self.responses = deque(maxlen=response_window)
        self.history = deque(maxlen=history_points)
        self.sample()

    def _time(self, now):
        self.occupied_seconds += (now - self.now) * self.running
        self.now = now

    def _touch(self, sid):
        self.areas[sid] += (self.now - self.area_times[sid]) * self.active[sid]
        self.area_times[sid] = self.now

    def set_rate(self, rate):
        if (
            type(rate) not in (float, int)
            or not isfinite(rate)
            or not 0 <= rate <= 100000
        ):
            raise ValueError(
                "Traffic must be finite and between zero and 100,000 requests/s."
            )
        self.rate = float(rate)
        self.config["arrival_rate"] = self.rate
        self.anchor, self.arrival_index = self.now, 1
        self.next_arrival = self.anchor + 1 / self.rate if self.rate else inf

    def advance(self, target, *, max_events=2000, budget_seconds=None):
        if not isfinite(target) or target < self.now:
            raise ValueError("Target time must be finite and cannot move backwards.")
        if max_events < 1:
            raise ValueError("Event budget must be positive.")
        deadline = (
            perf_counter() + budget_seconds if budget_seconds is not None else inf
        )
        processed = 0
        while (
            min(self.next_arrival, self.pending[0][0] if self.pending else inf)
            <= target
        ):
            if processed >= max_events or perf_counter() >= deadline:
                return False
            processed += 1
            if self.pending and self.pending[0][0] <= self.next_arrival:
                now, sid, rid = heappop(self.pending)
                self._time(now)
                self._touch(sid)
                result = self.servers[sid].complete(rid, now)
                latency = now - result.finished.request.arrival_time
                self.completed += 1
                self.response_sum += latency
                self.responses.append(latency)
                if result.started:
                    self.queued[sid] -= 1
                    self.waiting -= 1
                    heappush(
                        self.pending,
                        (
                            result.started.completion_time,
                            sid,
                            result.started.request.id,
                        ),
                    )
                else:
                    self.active[sid] -= 1
                    self.running -= 1
                self.loads.update(sid, self.active[sid])
            else:
                self._time(self.next_arrival)
                rid = self.offered
                sid = (
                    rid % len(self.servers)
                    if self.config["policy"] == "round_robin"
                    else self.loads.target()
                )
                self._touch(sid)
                demand = self.rng.uniform(
                    self.config["service_min"], self.config["service_max"]
                )
                admission = self.servers[sid].submit(
                    Request(rid, self.now, demand), self.now
                )
                self.offered += 1
                if admission.status == "started":
                    self.active[sid] += 1
                    self.running += 1
                    self.loads.update(sid, self.active[sid])
                    execution = admission.execution
                    heappush(self.pending, (execution.completion_time, sid, rid))
                elif admission.status == "queued":
                    self.queued[sid] += 1
                    self.waiting += 1
                else:
                    self.rejected += 1
                self.arrival_index += 1
                self.next_arrival = self.anchor + self.arrival_index / self.rate
        self._time(target)
        return True

    def sample(self):
        if self.history and self.history[-1]["simulation_time"] == self.now:
            return
        self.history.append(
            dict(
                simulation_time=self.now,
                offered=self.offered,
                completed=self.completed,
                rejected=self.rejected,
                running=self.running,
                waiting=self.waiting,
            )
        )

    def snapshot(self, *, server_offset=0, server_limit=32, history_limit=120):
        ordered = sorted(self.responses)
        bins = []
        if ordered:
            low, high = ordered[0], ordered[-1]
            count = 1 if low == high else 20
            width = max(0.000001, low * 0.01) if count == 1 else (high - low) / count
            bins = [
                dict(start=low + i * width, end=low + (i + 1) * width, count=0)
                for i in range(count)
            ]
            for value in ordered:
                bins[min(count - 1, int((value - low) / width))]["count"] += 1
        servers = []
        for sid in range(
            server_offset, min(len(self.servers), server_offset + server_limit)
        ):
            area = (
                self.areas[sid] + (self.now - self.area_times[sid]) * self.active[sid]
            )
            servers.append(
                dict(
                    id=sid,
                    running=self.active[sid],
                    waiting=self.queued[sid],
                    free_slots=self.config["concurrency"] - self.active[sid],
                    slots=self.config["concurrency"],
                    queue_limit=self.config["queue_limit"],
                    processing_rate=self.servers[sid].processing_rate,
                    mean_slot_utilization=area / (self.now * self.config["concurrency"])
                    if self.now
                    else 0.0,
                )
            )
        return dict(
            simulation_time=self.now,
            config=self.config,
            arrival_rate=self.rate,
            totals=dict(
                offered=self.offered,
                completed=self.completed,
                rejected=self.rejected,
                running=self.running,
                waiting=self.waiting,
            ),
            metrics=dict(
                mean_response_time=self.response_sum / self.completed
                if self.completed
                else None,
                recent_p95_response_time=ordered[ceil(0.95 * len(ordered)) - 1]
                if ordered
                else None,
                response_window_count=len(ordered),
                response_window_limit=self.responses.maxlen,
                mean_slot_utilization=self.occupied_seconds
                / (self.now * len(self.servers) * self.config["concurrency"])
                if self.now
                else 0.0,
            ),
            histogram=dict(scope="recent_completed_responses", bins=bins),
            servers=dict(
                offset=server_offset,
                limit=server_limit,
                total=len(self.servers),
                items=servers,
            ),
            history=list(self.history)[-history_limit:] if history_limit else [],
            retention=dict(
                pending_completions=len(self.pending),
                waiting_requests=self.waiting,
                history_points=len(self.history),
                history_limit=self.history.maxlen,
            ),
        )
