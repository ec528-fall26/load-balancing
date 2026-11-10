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
class Config:
    width: int = 4
    deadline_us: int = 200_000
    slowdown: int = 1
    slow_shard: int = 0
    rtt_us: int = 4_000
    dispatch_us: int = 1_000
    join_us: int = 1_000
    coordinator_limit: int = 32
    shard_limit: int = 8


@dataclass
class Parent:
    id: int
    arrival_us: int
    status: str = "pending"
    finished_us: int | None = None
    remaining: set[int] = field(default_factory=set)
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
        # Placement is fixed by parent/shard ID and shared by all conditions.
        for offset, (cpu_us, io_us) in enumerate(calls):
            shard = (parent.id + offset) % SHARD_COUNT
            parent.remaining.add(shard)
            self.sent[shard] += 1
            self.event(parent, "request_sent", shard)
            self.clock.schedule(
                self.clock.now + self.config.rtt_us // 2,
                partial(self.shard_arrival, parent, shard, cpu_us, io_us),
            )

    def shard_arrival(self, parent: Parent, shard: int, cpu_us: int, io_us: int):
        self.event(parent, "request_received", shard)
        if self.outstanding[shard] >= self.config.shard_limit:
            self.rejected[shard] += 1
            self.event(parent, "shard_rejected", shard)
            self.send_reply(parent, shard, rejected=True)
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
        self.send_reply(parent, shard, rejected=False)

    def send_reply(self, parent: Parent, shard: int, rejected: bool):
        self.event(parent, "reply_sent", shard)
        self.clock.schedule(
            self.clock.now + self.config.rtt_us - self.config.rtt_us // 2,
            partial(self.receive_reply, parent, shard, rejected),
        )

    def receive_reply(self, parent: Parent, shard: int, rejected: bool):
        parent.remaining.remove(shard)
        self.event(parent, "rejection_received" if rejected else "reply_received", shard)
        if parent.status != "pending":
            return
        if rejected:
            self.finish_parent(parent, "shard_rejected")
        elif not parent.remaining:
            parent.critical_shard = shard
            self.coordinator_stage(parent, "join_cpu", self.config.join_us,
                                   partial(self.finish_parent, parent, "completed"))

    def run(self, requests: tuple[Request, ...]):
        for index, request in enumerate(requests):
            parent = Parent(index, request.arrival_us)
            self.parents.append(parent)
            self.clock.schedule(request.arrival_us, partial(self.arrive, parent, request), priority=2)
        self.clock.run()
        assert self.active_parents == 0 and not any(self.outstanding)
        assert not any(parent.remaining for parent in self.parents)
        assert all(sent == done + rejected for sent, done, rejected in
                   zip(self.sent, self.completed, self.rejected))
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
            shard_rejected=counts["shard_rejected"],
            coordinator_rejected=counts["coordinator_rejected"],
            mean_ms=sum(latencies) / len(latencies) / 1000 if latencies else None,
            p95_ms=latencies[ceil(.95 * len(latencies)) - 1] / 1000 if latencies else None,
            backend_service_ms=work / 1000,
            backend_ms_per_success=work / len(latencies) / 1000 if latencies else None,
            wasted_backend_ms=wasted / 1000,
            coordinator_peak_queue=self.coordinator.peak_queue,
            shards=[dict(id=shard, sent=self.sent[shard], completed=self.completed[shard],
                         rejected=self.rejected[shard], peak_cpu_queue=self.cpu[shard].peak_queue,
                         peak_io_queue=self.io[shard].peak_queue, cpu_wait_ms=self.cpu[shard].wait_us / 1000,
                         io_wait_ms=self.io[shard].wait_us / 1000) for shard in range(SHARD_COUNT)],
            inspected=dict(id=selected.id, status=selected.status, critical_shard=selected.critical_shard,
                           unanswered_shards=selected.unanswered_shards, events=self.trace),
        )


def checked_settings(values, *, single_run=False):
    limits = {
        "rate": (1, 200, 50), "duration": (1, 10, 4), "seed": (0, 1_000_000, 42),
        "deadline_ms": (10, 2000, 200), "rtt_ms": (0, 200, 4),
        "slowdown": (1, 20, 4), "slow_shard": (0, 3, 0), "inspect": (0, 1999, 0),
    }
    if single_run:
        limits["width"] = (1, SHARD_COUNT, 4)
    if set(values) - limits.keys():
        raise ValueError("Unknown fan-out settings.")
    settings = {}
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


def run_case(settings, trace, width, slowdown):
    config = Config(
        width=width, slowdown=slowdown, slow_shard=settings["slow_shard"],
        deadline_us=settings["deadline_ms"] * 1000, rtt_us=settings["rtt_ms"] * 1000,
    )
    condition = "normal" if slowdown == 1 else f"slow shard {config.slow_shard}"
    return dict(width=width, condition=condition, **Simulation(config, settings["inspect"]).run(trace))


def run_fanout(values):
    settings = checked_settings(values, single_run=True)
    trace, metadata = paired_workload(settings)
    result = run_case(settings, trace, settings["width"], settings["slowdown"])
    return dict(**metadata, result=result)


def experiment(values):
    settings = checked_settings(values)
    trace, metadata = paired_workload(settings)
    return dict(**metadata, cases=[
        {**run_case(settings, trace, width, slowdown), "condition": label}
        for width in (1, 4)
        for label, slowdown in (("normal", 1), ("slow shard", settings["slowdown"]))
    ])
