"""Server admission and completion; the caller owns the event clock."""

from collections import deque
from dataclasses import dataclass
from math import isfinite
from typing import Literal


@dataclass(frozen=True)
class Request:
    id: int
    arrival_time: float
    service_time: float

    def __post_init__(self):
        if type(self.id) is not int:
            raise ValueError("request ID must be an integer")
        if not isfinite(self.arrival_time) or self.arrival_time < 0:
            raise ValueError("arrival time must be finite and nonnegative")
        if not isfinite(self.service_time) or self.service_time <= 0:
            raise ValueError("service time must be finite and positive")
        if (not isfinite(self.arrival_time + self.service_time)
                or self.arrival_time + self.service_time <= self.arrival_time):
            raise ValueError("service time must produce a finite later completion")


@dataclass(frozen=True)
class Execution:
    request: Request
    server_id: int
    start_time: float
    completion_time: float


@dataclass(frozen=True)
class Admission:
    status: Literal["started", "queued", "rejected"]
    execution: Execution | None = None


@dataclass(frozen=True)
class Completion:
    finished: Execution
    started: Execution | None = None


class Server:
    def __init__(self, id: int, concurrency: int, queue_limit: int):
        if type(id) is not int:
            raise ValueError("server ID must be an integer")
        if type(concurrency) is not int or concurrency <= 0:
            raise ValueError("concurrency must be a positive integer")
        if type(queue_limit) is not int or queue_limit < 0:
            raise ValueError("queue limit must be a nonnegative integer")
        self.id = id
        self.concurrency = concurrency
        self.queue_limit = queue_limit
        self._running: dict[int, Execution] = {}
        self._waiting: deque[Request] = deque()
        self._last_time = 0.0

    @property
    def running(self) -> tuple[Execution, ...]:
        return tuple(self._running.values())

    @property
    def waiting(self) -> tuple[Request, ...]:
        return tuple(self._waiting)

    def _check_time(self, now: float):
        if not isfinite(now) or now < self._last_time:
            raise ValueError("server time must be finite and cannot move backwards")

    def _execution(self, request: Request, now: float) -> Execution:
        end = now + request.service_time
        if not isfinite(end) or end <= now:
            raise ValueError("service time must produce a finite later completion")
        return Execution(request, self.id, now, end)

    def submit(self, request: Request, now: float) -> Admission:
        self._check_time(now)
        if now != request.arrival_time:
            raise ValueError("submit at the request's arrival time")
        if any(e.completion_time <= now for e in self._running.values()):
            raise ValueError("process pending completions before arrivals")
        if request.id in self._running or any(r.id == request.id for r in self._waiting):
            raise ValueError("request ID is already active on this server")
        if len(self._running) < self.concurrency:
            execution = self._execution(request, now)
            self._running[request.id] = execution
            result = Admission("started", execution)
        elif len(self._waiting) < self.queue_limit:
            self._waiting.append(request)
            result = Admission("queued")
        else:
            result = Admission("rejected")
        self._last_time = now
        return result

    def complete(self, request_id: int, now: float) -> Completion:
        self._check_time(now)
        finished = self._running.get(request_id)
        if finished is None:
            raise ValueError("request is not running on this server")
        if now != finished.completion_time:
            raise ValueError("complete at the scheduled completion time")
        if any(e.completion_time < now for e in self._running.values()):
            raise ValueError("process earlier completions first")
        started = self._execution(self._waiting[0], now) if self._waiting else None
        del self._running[request_id]
        if started is not None:
            self._waiting.popleft()
            self._running[started.request.id] = started
        self._last_time = now
        return Completion(finished, started)
