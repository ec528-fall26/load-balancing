"""Incremental single-pool engine: bounded outstanding work and recent telemetry.

Uses the same Server admission/completion behavior as one-shot runs. No request
trace or completed execution list is retained. The service owns advancement.

Server outages (optional `availabilities` / `mean_repair_time`) follow the same
seeded up/down streams as one-shot runs, drawn one period at a time as servers
change state. `fail_server` takes a server down immediately for exactly its MTTR.
At equal times a completion is handled first, then a server change, then an
arrival, matching the one-shot engine.
"""

from collections import deque
from heapq import heapify, heappop, heappush
from math import ceil, inf, isfinite
from random import Random
from time import perf_counter

from lbsim.availability import down_period, repair_times, server_rng, up_period
from lbsim.server import Request, Server
from lbsim.policies import RoutingContext, create_policy


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
        self.routing = create_policy(config["policy"], RoutingContext(
            count, lambda i: self.servers[i].running_count,
            demand=lambda i: self.servers[i].running_count+self.servers[i].waiting_count,
            routing_rng=Random(config["seed"] + 1000000),
            # Health check; with every server up, routing is unchanged.
            available=lambda i: self.servers[i].up))
        # Outages. Telemetry appears only once outages are possible, so sessions
        # without them keep their original snapshots.
        self.availabilities = [float(a) for a in config.get("availabilities", [1.0] * count)]
        self.mttr = repair_times(config.get("mean_repair_time", 1.0), count)
        self.outage_rngs = [server_rng(config["seed"], sid) for sid in range(count)]
        self.outages_enabled = "availabilities" in config
        self.transitions = []  # (time, sequence, server, "down" | "up")
        self.next_change = [None] * count  # sequence of each server's live transition
        self.transition_sequence = 0
        self.up_count = count
        self.down_since = [None] * count
        self.downtime = [0.0] * count
        self.outage_count = [0] * count
        self.rerouted_from = [0] * count
        self.dropped_from = [0] * count
        self.rerouted = self.reroute_rejected = self.no_server_up = 0
        for sid, availability in enumerate(self.availabilities):
            if availability < 1:
                self._schedule(
                    up_period(self.outage_rngs[sid], availability, self.mttr[sid]),
                    sid, "down")
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

    def _schedule(self, time, sid, kind):
        """Make this the server's only live transition; older ones become stale."""
        self.transition_sequence += 1
        self.next_change[sid] = self.transition_sequence
        heappush(self.transitions, (time, self.transition_sequence, sid, kind))

    def _go_down(self, sid, recover_at):
        self._touch(sid)
        dropped = self.servers[sid].fail(self.now)
        self.running -= self.active[sid]
        self.waiting -= self.queued[sid]
        if self.active[sid]:
            self.pending = [p for p in self.pending if p[1] != sid]
            heapify(self.pending)
        self.active[sid] = self.queued[sid] = 0
        self.up_count -= 1
        self.down_since[sid] = self.now
        self.outage_count[sid] += 1
        self.routing.update(sid)
        self._schedule(recover_at, sid, "up")
        # Running then queued work goes back through the load balancer and
        # restarts, keeping its original arrival time.
        for request in dropped:
            self._reroute(request, sid)

    def _reroute(self, request, failed):
        if self.up_count == 0:
            self.rejected += 1
            self.reroute_rejected += 1
            self.dropped_from[failed] += 1
            return
        target = self.routing.choose()
        self._touch(target)
        admission = self.servers[target].submit(request, self.now)
        if admission.status == "started":
            self.active[target] += 1
            self.running += 1
            heappush(self.pending, (admission.execution.completion_time, target, request.id))
        elif admission.status == "queued":
            self.queued[target] += 1
            self.waiting += 1
        self.routing.update(target)
        if admission.status == "rejected":
            self.rejected += 1
            self.reroute_rejected += 1
            self.dropped_from[failed] += 1
        else:
            self.rerouted += 1
            self.rerouted_from[failed] += 1

    def _go_up(self, sid):
        self.servers[sid].recover(self.now)
        self.up_count += 1
        self.downtime[sid] += self.now - self.down_since[sid]
        self.down_since[sid] = None
        self.routing.update(sid)
        availability = self.availabilities[sid]
        if availability < 1:
            self._schedule(
                self.now + up_period(self.outage_rngs[sid], availability, self.mttr[sid]),
                sid, "down")
        else:
            self.next_change[sid] = None

    def _transition(self):
        time, sequence, sid, kind = heappop(self.transitions)
        if sequence != self.next_change[sid]:
            return  # replaced by a manual failure
        self._time(time)
        if kind == "down":
            self._go_down(sid, self.now + down_period(self.outage_rngs[sid], self.mttr[sid]))
        else:
            self._go_up(sid)

    def fail_server(self, sid):
        """Take a server down now for exactly its MTTR. Invalid or down: no-op."""
        if type(sid) is not int or not 0 <= sid < len(self.servers) or not self.servers[sid].up:
            return False
        self.outages_enabled = True
        self._go_down(sid, self.now + self.mttr[sid])
        return True

    def _availability(self, sid):
        if not self.now:
            return 1.0
        down = self.downtime[sid]
        if self.down_since[sid] is not None:
            down += self.now - self.down_since[sid]
        return 1 - down / self.now

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
        while True:
            next_completion = self.pending[0][0] if self.pending else inf
            next_transition = self.transitions[0][0] if self.transitions else inf
            if min(self.next_arrival, next_completion, next_transition) > target:
                break
            if processed >= max_events or perf_counter() >= deadline:
                return False
            processed += 1
            if next_transition < next_completion and next_transition <= self.next_arrival:
                self._transition()
            elif self.pending and next_completion <= self.next_arrival:
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
                self.routing.update(sid)
            elif self.up_count == 0:
                # Every server is down. Still draw the service time so the
                # request stream stays aligned with one-shot runs.
                self._time(self.next_arrival)
                self.rng.uniform(self.config["service_min"], self.config["service_max"])
                self.offered += 1
                self.rejected += 1
                self.no_server_up += 1
                self.arrival_index += 1
                self.next_arrival = self.anchor + self.arrival_index / self.rate
            else:
                self._time(self.next_arrival)
                rid = self.offered
                sid = self.routing.choose()
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
                    self.routing.update(sid)
                    execution = admission.execution
                    heappush(self.pending, (execution.completion_time, sid, rid))
                elif admission.status == "queued":
                    self.queued[sid] += 1
                    self.waiting += 1
                    self.routing.update(sid)
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
                **(dict(servers_down=len(self.servers) - self.up_count)
                   if self.outages_enabled else {}),
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
                    **(dict(
                        up=self.servers[sid].up,
                        measured_availability=self._availability(sid),
                        outage_count=self.outage_count[sid],
                        rerouted=self.rerouted_from[sid],
                        dropped=self.dropped_from[sid],
                    ) if self.outages_enabled else {}),
                )
            )
        outages = {}
        if self.outages_enabled:
            outages = dict(
                outages=dict(
                    servers_down=len(self.servers) - self.up_count,
                    outage_count=sum(self.outage_count),
                    rerouted=self.rerouted,
                    reroute_rejected=self.reroute_rejected,
                    no_server_up=self.no_server_up,
                ),
                # Every rejection falls in exactly one bucket.
                rejected_breakdown=dict(
                    queue_full=self.rejected - self.no_server_up - self.reroute_rejected,
                    no_server_up=self.no_server_up,
                    reroute_rejected=self.reroute_rejected,
                ),
            )
        return dict(
            **outages,
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
