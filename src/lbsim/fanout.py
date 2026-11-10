"""Deterministic fork/join experiment with bounded CPU and I/O resources.

Times are integer microseconds. Each parent has four seeded pieces of useful
work. The one-shard case coalesces them and the four-shard case sends one piece
per server. Coordinator CPU and network delays are modeled separately.
"""

from collections import Counter, deque
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import partial
from hashlib import sha256
from heapq import heappop, heappush
from itertools import count
from json import dumps
from math import ceil
from random import Random

SHARD_COUNT = 4


@dataclass(frozen=True)
class Request:
    arrival_us: int
    # Each pair is CPU and I/O demand at nominal server speed.
    pieces: tuple[tuple[int, int], ...]


def workload(rate: int, duration: int, seed: int) -> tuple[Request, ...]:
    rng = Random(seed)
    return tuple(
        Request(index * 1_000_000 // rate, tuple(
            (rng.randint(3_000, 7_000), rng.randint(6_000, 14_000))
            for _ in range(SHARD_COUNT)
        ))
        for index in range(rate * duration)
    )


@dataclass(frozen=True)
class Outage:
    shard: int
    start_us: int
    end_us: int


@dataclass(frozen=True)
class Config:
    width: int = 4
    dispatch_mode: str = "parallel"
    deadline_us: int = 200_000
    slowdown: int = 1
    slow_shard: int = 0
    rtt_us: int = 4_000
    dispatch_us: int = 1_000
    join_us: int = 1_000
    coordinator_limit: int = 32
    shard_limit: int = 8
    outage: Outage | None = None


@dataclass
class Parent:
    id: int
    arrival_us: int
    status: str = "pending"
    finished_us: int | None = None
    remaining: set[int] = field(default_factory=set)
    queued_calls: deque[tuple[int, int, int]] = field(default_factory=deque)
    unsent_shards: tuple[int, ...] = ()
    unanswered_shards: tuple[int, ...] = ()
    critical_shard: int | None = None
    backend_service_us: int = 0


class Clock:
    def __init__(self):
        self.now = 0
        self.serial = count()
        self.events: list[tuple[int, int, int, Callable[[], None]]] = []

    def schedule(self, time: int, action: Callable[[], None], priority: int = 0):
        assert time >= self.now
        heappush(self.events, (time, priority, next(self.serial), action))

    def run(self):
        while self.events:
            self.now, _, _, action = heappop(self.events)
            action()


@dataclass
class Service:
    started: int
    duration: int
    finish: Callable[[], None]
    account: Callable[[int], None] | None


class Slot:
    """One FIFO service slot. CPU and I/O are distinct resources."""

    def __init__(self, clock: Clock):
        self.clock = clock
        self.queue = deque()
        self.active: Service | None = None
        self.peak_queue = 0
        self.wait_us = 0
        self.service_us = 0

    def submit(self, duration, start, finish, eligible=None, account=None):
        self.queue.append((self.clock.now, duration, start, finish, eligible, account))
        self._start_next()
        self.peak_queue = max(self.peak_queue, len(self.queue))

    def _start_next(self):
        while self.active is None and self.queue:
            ready, duration, start, finish, eligible, account = self.queue.popleft()
            if eligible is not None and not eligible():
                continue
            service = Service(self.clock.now, duration, finish, account)
            self.active = service
            self.wait_us += self.clock.now - ready
            start()
            self.clock.schedule(self.clock.now + duration, partial(self._finish, service))

    def _account(self, service, duration):
        self.service_us += duration
        if service.account is not None:
            service.account(duration)

    def _finish(self, service):
        if self.active is not service:
            return
        self._account(service, service.duration)
        # Enqueue any returning CPU work behind already queued work.
        service.finish()
        self.active = None
        self._start_next()

    def interrupt(self):
        self.queue.clear()
        if self.active is not None:
            self._account(self.active, self.clock.now - self.active.started)
            self.active = None


class Simulation:
    def __init__(self, config: Config, inspect: int):
        self.config = config
        self.inspect = inspect
        self.clock = Clock()
        self.coordinator = Slot(self.clock)
        self.cpu = [Slot(self.clock) for _ in range(SHARD_COUNT)]
        self.io = [Slot(self.clock) for _ in range(SHARD_COUNT)]
        self.parents: list[Parent] = []
        self.active_parents = 0
        self.outstanding = [0] * SHARD_COUNT
        self.sent = [0] * SHARD_COUNT
        self.completed = [0] * SHARD_COUNT
        self.rejected = [0] * SHARD_COUNT
        self.outage_failed = [0] * SHARD_COUNT
        self.in_flight: list[dict[int, tuple[Parent, int]]] = [{} for _ in range(SHARD_COUNT)]
        self.offline: int | None = None
        self.trace = []

    def event(self, parent: Parent, phase: str, shard: int | None = None):
        if parent.id == self.inspect:
            self.trace.append(dict(at_us=self.clock.now - parent.arrival_us, phase=phase, shard=shard))

    def finish_parent(self, parent: Parent, status: str):
        if parent.status != "pending":
            return
        parent.status = status
        parent.finished_us = self.clock.now
        parent.unanswered_shards = tuple(sorted(parent.remaining))
        parent.unsent_shards = tuple(shard for shard, _, _ in parent.queued_calls)
        parent.queued_calls.clear()
        self.active_parents -= 1
        self.event(parent, status)

    def coordinator_stage(self, parent: Parent, name, duration, finish):
        self.event(parent, name + "_queued")
        def complete():
            self.event(parent, name + "_finished")
            finish()

        self.coordinator.submit(
            duration, partial(self.event, parent, name + "_started"),
            complete, eligible=lambda: parent.status == "pending",
        )

    def arrive(self, parent: Parent, request: Request):
        self.event(parent, "arrived")
        if self.active_parents >= self.config.coordinator_limit:
            parent.status = "coordinator_rejected"
            parent.finished_us = self.clock.now
            self.event(parent, parent.status)
            return
        self.active_parents += 1
        # Service completions win ties with the deadline, and both precede
        # new external arrivals. The serial breaks remaining ties deterministically.
        self.clock.schedule(
            parent.arrival_us + self.config.deadline_us,
            partial(self.finish_parent, parent, "timed_out"), priority=1,
        )
        self.coordinator_stage(
            parent, "dispatch_cpu", self.config.dispatch_us,
            partial(self.dispatch, parent, request),
        )

    def dispatch(self, parent: Parent, request: Request):
        if parent.status != "pending":
            return
        pieces = request.pieces
        pieces_per_call = SHARD_COUNT // self.config.width
        groups = (
            pieces[start:start + pieces_per_call]
            for start in range(0, SHARD_COUNT, pieces_per_call)
        )
        calls = (
            (sum(cpu for cpu, _ in group), sum(io for _, io in group))
            for group in groups
        )
        # Both modes assign the same work to the same shards.
        parent.queued_calls.extend(
            ((parent.id + offset) % SHARD_COUNT, cpu_us, io_us)
            for offset, (cpu_us, io_us) in enumerate(calls)
        )
        if self.config.dispatch_mode == "serial":
            if self.clock.now < parent.arrival_us + self.config.deadline_us:
                self.send_next_call(parent)
            return
        while parent.queued_calls:
            self.send_next_call(parent)

    def send_next_call(self, parent: Parent):
        shard, cpu_us, io_us = parent.queued_calls.popleft()
        parent.remaining.add(shard)
        self.sent[shard] += 1
        self.event(parent, "request_sent", shard)
        arrival = self.clock.now + self.config.rtt_us // 2
        self.in_flight[shard][parent.id] = (parent, arrival)
        if self.offline == shard:
            self.fail_call(parent, shard, arrival)
        else:
            self.clock.schedule(arrival, partial(self.shard_arrival, parent, shard, cpu_us, io_us))

    def shard_arrival(self, parent: Parent, shard: int, cpu_us: int, io_us: int):
        if parent.id not in self.in_flight[shard]:
            return
        self.event(parent, "request_received", shard)
        if self.outstanding[shard] >= self.config.shard_limit:
            self.rejected[shard] += 1
            del self.in_flight[shard][parent.id]
            self.event(parent, "shard_rejected", shard)
            self.send_reply(parent, shard, outcome="rejected")
            return
        self.outstanding[shard] += 1
        speed_multiplier = self.config.slowdown if shard == self.config.slow_shard else 1
        cpu_us *= speed_multiplier
        first_cpu = cpu_us // 2
        def after_io():
            self.shard_stage(
                parent, shard, self.cpu[shard], "cpu_last", cpu_us - first_cpu,
                partial(self.finish_child, parent, shard),
            )

        def after_first_cpu():
            self.shard_stage(parent, shard, self.io[shard], "io", io_us, after_io)

        self.shard_stage(parent, shard, self.cpu[shard], "cpu_first", first_cpu, after_first_cpu)

    def shard_stage(self, parent: Parent, shard: int, slot: Slot, phase, duration, finish):
        self.event(parent, phase + "_queued", shard)

        def account(consumed):
            parent.backend_service_us += consumed

        def complete():
            self.event(parent, phase + "_finished", shard)
            finish()

        slot.submit(duration, partial(self.event, parent, phase + "_started", shard),
                    complete, account=account)

    def finish_child(self, parent: Parent, shard: int):
        self.outstanding[shard] -= 1
        self.completed[shard] += 1
        del self.in_flight[shard][parent.id]
        self.send_reply(parent, shard, outcome="success")

    def fail_call(self, parent: Parent, shard: int, arrival: int):
        del self.in_flight[shard][parent.id]
        self.outage_failed[shard] += 1
        self.event(parent, "shard_outage", shard)
        # A transport error cannot return before the call could reach the shard.
        self.send_reply(parent, shard, outcome="outage", earliest=arrival)

    def shard_down(self, shard: int):
        self.offline = shard
        self.cpu[shard].interrupt()
        self.io[shard].interrupt()
        self.outstanding[shard] = 0
        for parent, arrival in list(self.in_flight[shard].values()):
            self.fail_call(parent, shard, arrival)

    def shard_up(self):
        self.offline = None

    def send_reply(self, parent: Parent, shard: int, outcome: str, earliest: int = 0):
        if outcome != "outage":
            self.event(parent, "reply_sent", shard)
        self.clock.schedule(
            max(self.clock.now, earliest) + self.config.rtt_us - self.config.rtt_us // 2,
            partial(self.receive_reply, parent, shard, outcome),
        )

    def receive_reply(self, parent: Parent, shard: int, outcome: str):
        parent.remaining.remove(shard)
        phase = {"rejected": "rejection_received", "outage": "outage_error_received",
                 "success": "reply_received"}[outcome]
        self.event(parent, phase, shard)
        if parent.status != "pending":
            return
        if outcome == "rejected":
            self.finish_parent(parent, "shard_rejected")
        elif outcome == "outage":
            self.finish_parent(parent, "outage_failed")
        elif parent.queued_calls:
            if self.clock.now < parent.arrival_us + self.config.deadline_us:
                self.send_next_call(parent)
        elif not parent.remaining:
            parent.critical_shard = shard
            self.coordinator_stage(parent, "join_cpu", self.config.join_us,
                                   partial(self.finish_parent, parent, "completed"))

    def run(self, requests: tuple[Request, ...]):
        if self.config.outage is not None:
            outage = self.config.outage
            # Apply changes before service and arrivals at the same timestamp.
            self.clock.schedule(outage.start_us, partial(self.shard_down, outage.shard), priority=-1)
            self.clock.schedule(outage.end_us, self.shard_up, priority=-1)
        for index, request in enumerate(requests):
            parent = Parent(index, request.arrival_us)
            self.parents.append(parent)
            self.clock.schedule(request.arrival_us, partial(self.arrive, parent, request), priority=2)
        self.clock.run()
        assert self.active_parents == 0 and not any(self.outstanding)
        assert not any(parent.remaining or parent.queued_calls for parent in self.parents)
        assert not any(self.in_flight)
        assert all(sent == done + rejected + failed for sent, done, rejected, failed in
                   zip(self.sent, self.completed, self.rejected, self.outage_failed))
        return self.summary()

    def summary(self):
        counts = Counter(parent.status for parent in self.parents)
        latencies = sorted(parent.finished_us - parent.arrival_us
                           for parent in self.parents if parent.status == "completed")
        selected = self.parents[self.inspect]
        work = sum(parent.backend_service_us for parent in self.parents)
        assert work == sum(slot.service_us for slot in self.cpu + self.io)
        wasted = sum(parent.backend_service_us for parent in self.parents if parent.status != "completed")
        return dict(
            offered=len(self.parents),
            completed=counts["completed"],
            timed_out=counts["timed_out"],
            outage_failed=counts["outage_failed"],
            shard_rejected=counts["shard_rejected"],
            coordinator_rejected=counts["coordinator_rejected"],
            mean_ms=sum(latencies) / len(latencies) / 1000 if latencies else None,
            p95_ms=latencies[ceil(.95 * len(latencies)) - 1] / 1000 if latencies else None,
            backend_service_ms=work / 1000,
            backend_ms_per_success=work / len(latencies) / 1000 if latencies else None,
            wasted_backend_ms=wasted / 1000,
            coordinator_peak_queue=self.coordinator.peak_queue,
            shards=[dict(id=shard, sent=self.sent[shard], completed=self.completed[shard],
                         rejected=self.rejected[shard], outage_failed=self.outage_failed[shard], peak_cpu_queue=self.cpu[shard].peak_queue,
                         peak_io_queue=self.io[shard].peak_queue, cpu_wait_ms=self.cpu[shard].wait_us / 1000,
                         io_wait_ms=self.io[shard].wait_us / 1000) for shard in range(SHARD_COUNT)],
            outage=(dict(shard=self.config.outage.shard, start_ms=self.config.outage.start_us / 1000,
                         end_ms=self.config.outage.end_us / 1000) if self.config.outage else None),
            inspected=dict(id=selected.id, status=selected.status, critical_shard=selected.critical_shard,
                           unanswered_shards=selected.unanswered_shards, unsent_shards=selected.unsent_shards,
                           events=self.trace),
        )


def checked_settings(values, *, single_run=False):
    limits = {
        "rate": (1, 200, 50), "duration": (1, 10, 4), "seed": (0, 1_000_000, 42),
        "deadline_ms": (10, 2000, 200), "rtt_ms": (0, 200, 4),
        "outage_ms": (0, 1000, 0),
        "slowdown": (1, 20, 4), "slow_shard": (0, 3, 0), "inspect": (0, 1999, 0),
    }
    if single_run:
        limits["width"] = (1, SHARD_COUNT, 4)
    choices = {"dispatch_mode": ("parallel", "serial")}
    if not single_run:
        choices["comparison"] = ("width", "order")
        choices["order_width"] = (4, 2)
    if set(values) - limits.keys() - choices.keys():
        raise ValueError("Unknown fan-out settings.")
    settings = {}
    for key, options in choices.items():
        value = values.get(key, options[0])
        if type(value) is not type(options[0]) or value not in options:
            raise ValueError(f"{key} must be one of {', '.join(map(str, options))}.")
        settings[key] = value
    for key, (low, high, default) in limits.items():
        value = values.get(key, default)
        if type(value) is not int or not low <= value <= high:
            raise ValueError(f"{key} must be an integer from {low} to {high}.")
        settings[key] = value
    if single_run and settings["width"] not in (1, 2, 4):
        raise ValueError("Choose one, two or four shards per parent.")
    if settings["inspect"] >= settings["rate"] * settings["duration"]:
        raise ValueError("The selected request is outside the arrival window.")
    return settings


def paired_workload(settings):
    trace = workload(settings["rate"], settings["duration"], settings["seed"])
    fingerprint = sha256(dumps([(r.arrival_us, r.pieces) for r in trace]).encode()).hexdigest()
    demand = sum(cpu + io for request in trace for cpu, io in request.pieces)
    return trace, dict(settings=settings, workload_sha256=fingerprint,
                       offered_backend_demand_ms=demand / 1000)


def seeded_outage(settings):
    if not settings["outage_ms"]:
        return None
    duration = settings["outage_ms"] * 1000
    window = settings["duration"] * 1_000_000
    rng = Random(f"fanout-outage:{settings['seed']}")
    shard = rng.randrange(SHARD_COUNT)
    start = rng.randint(0, window - duration)
    return Outage(shard, start, start + duration)


def run_case(settings, trace, width, slowdown, outage=None):
    config = Config(
        width=width, dispatch_mode=settings["dispatch_mode"], slowdown=slowdown,
        slow_shard=settings["slow_shard"], outage=outage,
        deadline_us=settings["deadline_ms"] * 1000, rtt_us=settings["rtt_ms"] * 1000,
    )
    condition = "normal" if slowdown == 1 else f"slow shard {config.slow_shard}"
    return dict(width=width, dispatch_mode=config.dispatch_mode, condition=condition, **Simulation(config, settings["inspect"]).run(trace))


def run_fanout(values):
    settings = checked_settings(values, single_run=True)
    trace, metadata = paired_workload(settings)
    result = run_case(settings, trace, settings["width"], settings["slowdown"], seeded_outage(settings))
    return dict(**metadata, result=result)


def experiment(values):
    settings = checked_settings(values)
    trace, metadata = paired_workload(settings)
    outage = seeded_outage(settings)
    if settings["comparison"] == "order":
        faults = (("no outage", None), ("seeded outage", outage)) if outage else (("same CPU settings", None),)
        return dict(**metadata, cases=[
            {**run_case({**settings, "dispatch_mode": mode}, trace, settings["order_width"], settings["slowdown"], fault),
             "condition": label}
            for mode in ("parallel", "serial")
            for label, fault in faults
        ])
    if outage is not None:
        return dict(**metadata, cases=[
            {**run_case(settings, trace, width, settings["slowdown"], fault), "condition": label}
            for width in (1, 4)
            for label, fault in (("no outage", None), ("seeded outage", outage))
        ])
    return dict(**metadata, cases=[
        {**run_case(settings, trace, width, slowdown), "condition": label}
        for width in (1, 4)
        for label, slowdown in (("normal", 1), ("slow shard", settings["slowdown"]))
    ])
