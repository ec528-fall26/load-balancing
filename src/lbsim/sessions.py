"""Local, bounded session ownership. One spawned process owns each live engine."""

from collections import OrderedDict, deque
from dataclasses import dataclass, field
import multiprocessing
from math import isfinite
from threading import Event, Lock, RLock, Thread
from time import monotonic
from uuid import uuid4

from lbsim.continuous import ContinuousSimulation
from lbsim.staged import StagedSimulation
from lbsim.regional import RegionalSimulation


@dataclass(frozen=True)
class SessionLimits:
    max_sessions: int = 2
    idle_seconds: float = 300.0
    lifetime_seconds: float = 3600.0
    startup_seconds: float = 5.0
    command_seconds: float = 2.0
    tick_seconds: float = 0.05
    tick_budget_seconds: float = 0.01
    events_per_tick: int = 20000
    response_window: int = 2000
    history_points: int = 240
    history_interval_seconds: float = 0.5
    server_page: int = 64
    command_log: int = 128
    tombstones: int = 128
    max_arrival_rate: float = 100000.0

    def __post_init__(self):
        counts = (
            "max_sessions",
            "events_per_tick",
            "response_window",
            "history_points",
            "server_page",
            "command_log",
            "tombstones",
        )
        times = (
            "idle_seconds",
            "lifetime_seconds",
            "startup_seconds",
            "command_seconds",
            "tick_seconds",
            "tick_budget_seconds",
            "history_interval_seconds",
            "max_arrival_rate",
        )
        if any(
            type(getattr(self, key)) is not int or getattr(self, key) < 1
            for key in counts
        ):
            raise ValueError(
                "Session retention and capacity limits must be positive integers."
            )
        if any(
            type(getattr(self, key)) not in (int, float)
            or not isfinite(getattr(self, key))
            or getattr(self, key) <= 0
            for key in times
        ):
            raise ValueError(
                "Session time and traffic limits must be finite and positive."
            )
        for key, maximum in (
            ("max_sessions", 8),
            ("server_page", 64),
            ("response_window", 2000),
            ("history_points", 240),
            ("command_log", 128),
            ("max_arrival_rate", 100000),
        ):
            if getattr(self, key) > maximum:
                raise ValueError(
                    f"{key} exceeds the service safety ceiling of {maximum}."
                )


class SessionError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message
        self.fields = []


def session_worker(connection, config, limits, speed, paused):
    """Own the engine and clock; queries never advance simulated time."""
    try:
        engine_type = (RegionalSimulation if config.get("topology") == "regions" else
                       StagedSimulation if config.get("request_model") == "cpu_io" else ContinuousSimulation)
        engine = engine_type(
            config,
            response_window=limits.response_window,
            history_points=limits.history_points,
        )
        born = last_wall = last_activity = last_sample = monotonic()
        target, revision, command_sequence = 0.0, 0, 0
        commands = deque(maxlen=limits.command_log)

        def snapshot(options=None):
            options = {
                **dict(
                    server_limit=min(32, limits.server_page),
                    history_limit=min(120, limits.history_points),
                ),
                **(options or {}),
            }
            return dict(
                _born=born,
                _activity=last_activity,
                status="paused" if paused else "running",
                speed=speed,
                revision=revision,
                target_simulation_time=target,
                lag_simulation_seconds=max(0.0, target - engine.now),
                idle_timeout_seconds=limits.idle_seconds,
                lifetime_seconds=limits.lifetime_seconds,
                commands=list(commands),
                command_sequence=command_sequence,
                command_log_limit=limits.command_log,
                command_log_truncated=command_sequence > len(commands),
                **engine.snapshot(**options),
            )

        connection.send(snapshot())
        while True:
            wall = monotonic()
            if (
                wall - last_activity >= limits.idle_seconds
                or wall - born >= limits.lifetime_seconds
            ):
                break
            if connection.poll(limits.tick_seconds):
                message = connection.recv()
                last_activity = monotonic()
                action = message["action"]
                if action == "snapshot":
                    connection.send(snapshot(message.get("options")))
                else:
                    # Commands take effect at the current processed simulation time.
                    # Pause and speed/rate changes discard catch-up debt, not events.
                    if action == "pause":
                        paused = True
                    elif action == "resume":
                        paused = False
                    elif action == "set_rate":
                        engine.set_rate(message["value"])
                    elif action == "set_speed":
                        speed = message["value"]
                    else:
                        raise ValueError("Unknown session command")
                    target = engine.now
                    last_wall = monotonic()
                    revision += 1
                    command_sequence += 1
                    commands.append(
                        dict(
                            sequence=command_sequence,
                            action=action,
                            value=message.get("value"),
                            simulation_time=engine.now,
                        )
                    )
                    connection.send(snapshot())
            wall = monotonic()
            if not paused:
                target += (wall - last_wall) * speed
                previous = engine.now
                engine.advance(
                    target,
                    max_events=limits.events_per_tick,
                    budget_seconds=limits.tick_budget_seconds,
                )
                if engine.now != previous:
                    revision += 1
            last_wall = wall
            if wall - last_sample >= limits.history_interval_seconds:
                engine.sample()
                last_sample = wall
    except (EOFError, BrokenPipeError, ConnectionResetError):
        pass
    finally:
        connection.close()


@dataclass
class _Session:
    process: object
    connection: object
    born: float
    touched: float
    lock: object = field(default_factory=RLock)


class SessionManager:
    def __init__(self, limits=None, *, worker_target=session_worker):
        self.limits = limits or SessionLimits()
        self.worker_target = worker_target
        self.sessions = {}
        self.tombstones = OrderedDict()
        self.lock = Lock()
        self.pending = 0
        self.closed = False
        self.stopping = Event()
        self.sweeper = None

    def start(self):
        self.sweeper = Thread(
            target=self._sweep_loop, daemon=True, name="lbsim-session-expiry"
        )
        self.sweeper.start()

    def _sweep_loop(self):
        while not self.stopping.wait(min(0.5, self.limits.idle_seconds / 2)):
            self.sweep()

    def _expired(self, record):
        now = monotonic()
        return (
            now - record.touched >= self.limits.idle_seconds
            or now - record.born >= self.limits.lifetime_seconds
        )

    @staticmethod
    def _stop(record):
        record.connection.close()
        process = record.process
        if process.pid is not None:
            process.join(timeout=0.15)
            if process.is_alive():
                process.terminate()
                process.join(timeout=0.5)
            if process.is_alive():
                process.kill()
                process.join(timeout=0.5)
            if not process.is_alive():
                process.close()

    def _forget(self, sid, record, reason):
        with self.lock:
            if self.sessions.get(sid) is not record:
                return
            del self.sessions[sid]
            self.pending += 1
            if reason != "deleted":
                self.tombstones[sid] = reason
                while len(self.tombstones) > self.limits.tombstones:
                    self.tombstones.popitem(last=False)
        try:
            self._stop(record)
        finally:
            with self.lock:
                self.pending -= 1

    def sweep(self):
        with self.lock:
            records = list(self.sessions.items())
        for sid, record in records:
            if not record.lock.acquire(blocking=False):
                continue
            try:
                with self.lock:
                    if self.sessions.get(sid) is not record:
                        continue
                if self._expired(record):
                    self._forget(sid, record, "expired")
                elif not record.process.is_alive():
                    self._forget(sid, record, "failed")
            finally:
                record.lock.release()

    def _get(self, sid):
        with self.lock:
            record = self.sessions.get(sid)
            reason = self.tombstones.get(sid)
        if record is None:
            if reason == "expired":
                raise SessionError(
                    410, "SESSION_EXPIRED", "Session expired. Create a new session."
                )
            if reason == "failed":
                raise SessionError(
                    503,
                    "SESSION_FAILED",
                    "Session worker stopped. Create a new session.",
                )
            raise SessionError(
                404, "SESSION_NOT_FOUND", "Session was not found in this API process."
            )
        return record

    @staticmethod
    def _envelope(sid, data):
        return dict(api_version="1", session_id=sid, **data)

    def create(self, config, *, speed=1.0, paused=False, replace_session_id=None):
        self.sweep()
        with self.lock:
            previous = self.sessions.get(replace_session_id)
        if previous is None:
            return self._create(config, speed, paused)
        if not previous.lock.acquire(timeout=self.limits.command_seconds):
            raise SessionError(429, "SESSION_BUSY", "Another command is using this session. Retry shortly.")
        try:
            if self._get(replace_session_id) is not previous:
                raise SessionError(404, "SESSION_NOT_FOUND", "Session was removed.")
            return self._create(config, speed, paused, (replace_session_id, previous))
        finally:
            previous.lock.release()

    def _create(self, config, speed, paused, replacement=None):
        with self.lock:
            if self.closed:
                raise SessionError(
                    503, "SESSIONS_CLOSED", "Session service is shutting down."
                )
            # A replacement can borrow one worker slot during startup.
            capacity = self.limits.max_sessions + (replacement is not None)
            if len(self.sessions) + self.pending >= capacity:
                raise SessionError(
                    429,
                    "SESSION_LIMIT",
                    "Live session capacity is full. Delete or wait for a session to expire.",
                )
            self.pending += 1
        context = multiprocessing.get_context("spawn")
        parent, child = context.Pipe()
        process = context.Process(
            target=self.worker_target, args=(child, config, self.limits, speed, paused)
        )
        record = _Session(process, parent, monotonic(), monotonic())
        try:
            process.start()
            child.close()
            if not parent.poll(self.limits.startup_seconds):
                raise SessionError(
                    504,
                    "SESSION_START_TIMEOUT",
                    "Session worker did not start in time.",
                )
            try:
                data = parent.recv()
            except EOFError as error:
                raise SessionError(
                    503, "SESSION_FAILED", "Session worker stopped during startup."
                ) from error
            sid = uuid4().hex
            if not isinstance(data, dict) or "_born" not in data:
                raise SessionError(
                    503,
                    "SESSION_FAILED",
                    "Session worker returned invalid startup data.",
                )
            record.born = data.pop("_born")
            record.touched = data.pop("_activity")
            with self.lock:
                if self.closed:
                    raise SessionError(
                        503, "SESSIONS_CLOSED", "Session service is shutting down."
                    )
                if replacement is not None:
                    del self.sessions[replacement[0]]
                self.sessions[sid] = record
        except BaseException:
            self._stop(record)
            raise
        else:
            if replacement is not None:
                self._stop(replacement[1])
            return self._envelope(sid, data)
        finally:
            child.close()
            with self.lock:
                self.pending -= 1

    def request(self, sid, action, *, value=None, options=None):
        record = self._get(sid)
        if not record.lock.acquire(timeout=self.limits.command_seconds):
            raise SessionError(
                429,
                "SESSION_BUSY",
                "Another command is using this session. Retry shortly.",
            )
        try:
            # Recheck identity under ownership; delete/expiry may have won the lock.
            if self._get(sid) is not record:
                raise SessionError(404, "SESSION_NOT_FOUND", "Session was removed.")
            if self._expired(record):
                self._forget(sid, record, "expired")
                raise SessionError(
                    410, "SESSION_EXPIRED", "Session expired. Create a new session."
                )
            if not record.process.is_alive():
                self._forget(sid, record, "failed")
                raise SessionError(
                    503,
                    "SESSION_FAILED",
                    "Session worker stopped. Create a new session.",
                )
            try:
                record.connection.send(
                    dict(action=action, value=value, options=options or {})
                )
                if not record.connection.poll(self.limits.command_seconds):
                    raise TimeoutError
                data = record.connection.recv()
            except (
                EOFError,
                BrokenPipeError,
                ConnectionResetError,
                OSError,
                TimeoutError,
            ) as error:
                expired = self._expired(record)
                self._forget(sid, record, "expired" if expired else "failed")
                raise SessionError(
                    410 if expired else 503,
                    "SESSION_EXPIRED" if expired else "SESSION_FAILED",
                    "Session expired or its worker became unavailable. Create a new session.",
                ) from error
            data.pop("_born")
            record.touched = data.pop("_activity")
            return self._envelope(sid, data)
        finally:
            record.lock.release()

    def delete(self, sid):
        record = self._get(sid)
        if not record.lock.acquire(timeout=self.limits.command_seconds):
            raise SessionError(
                429,
                "SESSION_BUSY",
                "Another command is using this session. Retry shortly.",
            )
        try:
            if self._get(sid) is not record:
                raise SessionError(404, "SESSION_NOT_FOUND", "Session was removed.")
            self._forget(sid, record, "deleted")
            return dict(api_version="1", session_id=sid, status="deleted")
        finally:
            record.lock.release()

    def close(self):
        with self.lock:
            self.closed = True
        self.stopping.set()
        if self.sweeper is not None:
            self.sweeper.join(timeout=1)
        with self.lock:
            records = list(self.sessions.items())
        for sid, record in records:
            with record.lock:
                self._forget(sid, record, "deleted")
