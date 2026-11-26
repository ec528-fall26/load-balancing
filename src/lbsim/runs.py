"""Bounded temporary one-shot results. Stable event order lives on disk, not in JSON replies."""
from contextlib import closing
from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass
import os
from pathlib import Path
import sqlite3
import tempfile
from threading import Event, RLock, Thread
from time import monotonic
from typing import NamedTuple
from uuid import uuid4

from lbsim.sessions import SessionError


@dataclass(frozen=True)
class RunLimits:
    max_runs: int = 4
    max_bytes: int = 64 * 1024 * 1024
    ttl_seconds: float = 600
    event_page: int = 1000
    server_page: int = 64



class _ServerState(NamedTuple):
    running: int = 0
    waiting: int = 0
    io_waiting: int = 0
    outstanding: int = 0
    io_active: int = 0
    io_queued: int = 0


@dataclass(slots=True)
class _TimelineTotals:
    idle: int
    offered: int = 0
    completed: int = 0
    rejected: int = 0
    running: int = 0
    waiting: int = 0
    outstanding: int = 0
    io_waiting: int = 0
    io_active: int = 0
    io_queued: int = 0
    # Work dropped during a server failure awaits rerouting at the same timestamp.
    pending_reroutes: int = 0
    pending_retries: int = 0


def _timeline_rows(events, server_count, totals):
    states = [_ServerState()] * server_count
    down = set()
    for sequence, event in enumerate(events):
        timestamp, server_id, running, waiting, action, request_id = event[:6]
        io_waiting = event[6] if len(event) > 6 else 0
        state = _ServerState(
            running=running,
            waiting=waiting,
            io_waiting=io_waiting,
            outstanding=event[7] if len(event) > 7 else running + waiting,
            io_active=event[8] if len(event) > 8 else io_waiting,
            io_queued=event[9] if len(event) > 9 else 0,
        )
        previous = states[server_id]
        was_idle = previous.outstanding == 0 and server_id not in down
        if action == 'server_down':
            totals.pending_reroutes += previous.running + previous.waiting
            down.add(server_id)
        elif action == 'server_up':
            down.remove(server_id)
        elif action in ('rerouted', 'reroute_rejected'):
            totals.pending_reroutes -= 1

        is_idle = state.outstanding == 0 and server_id not in down
        totals.idle += int(is_idle) - int(was_idle)
        totals.running += state.running - previous.running
        totals.waiting += state.waiting - previous.waiting
        totals.outstanding += state.outstanding - previous.outstanding
        totals.io_waiting += state.io_waiting - previous.io_waiting
        totals.io_active += state.io_active - previous.io_active
        totals.io_queued += state.io_queued - previous.io_queued
        states[server_id] = state

        if action == 'retry_scheduled':
            totals.pending_retries += 1
        elif action in ('retry_started', 'retry_queued', 'retry_rejected', 'retry_no_server_up'):
            totals.pending_retries -= 1
        totals.completed += action == 'completed'
        totals.rejected += action in ('rejected', 'reroute_rejected', 'no_server_up', 'retry_rejected', 'retry_no_server_up')
        totals.offered += action in ('started', 'queued', 'rejected', 'no_server_up', 'retry_scheduled')
        assert totals.offered == (
            totals.completed + totals.rejected + totals.running + totals.waiting
            + totals.io_waiting + totals.pending_reroutes + totals.pending_retries
        )

        yield (
            sequence, timestamp, server_id, state.running, state.waiting, action, request_id,
            totals.offered, totals.completed, totals.rejected, totals.running, totals.waiting, totals.idle,
            state.io_waiting, state.outstanding, totals.io_waiting, totals.outstanding,
            state.io_active, state.io_queued, totals.io_active, totals.io_queued, totals.pending_retries,
        )


def _write_timeline(db, events, server_count):
    totals = _TimelineTotals(idle=server_count)
    db.execute('PRAGMA journal_mode=OFF')
    db.execute("""
        CREATE TABLE events (
            seq INTEGER PRIMARY KEY, at REAL, sid INTEGER, running INTEGER, waiting INTEGER,
            action TEXT, request INTEGER, offered INTEGER, completed INTEGER, rejected INTEGER,
            total_running INTEGER, total_waiting INTEGER, idle INTEGER, io INTEGER,
            outstanding INTEGER, total_io INTEGER, total_outstanding INTEGER,
            io_active INTEGER, io_queued INTEGER, total_io_active INTEGER, total_io_queued INTEGER,
            pending_retries INTEGER
        )
    """)
    db.executemany(
        'INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        _timeline_rows(events, server_count, totals),
    )
    db.execute('CREATE INDEX time_order ON events(at,seq)')
    db.execute('CREATE INDEX server_time ON events(sid,at,seq)')
    db.commit()
    return totals


def _event_payload(row, staged):
    event = [row[key] for key in ('at', 'sid', 'running', 'waiting', 'action', 'request')]
    if staged:
        event.extend(row[key] for key in ('io', 'outstanding', 'io_active', 'io_queued'))
    return event


def _recorded_histogram(values):
    if not values:
        return []
    low, high = min(values), max(values)
    count = 1 if low == high else 20
    width = max(.000001, abs(low) * .01) if count == 1 else (high - low) / count
    bins = [
        dict(start=low + i * width, end=low + (i + 1) * width, count=0)
        for i in range(count)
    ]
    for value in values:
        bins[min(count - 1, int((value - low) / width))]['count'] += 1
    return bins


class RunStore:
    def __init__(self, limits=None, *, clock=monotonic):
        self.limits = limits or RunLimits()
        if not (
            1 <= self.limits.max_runs <= 8
            and 1 <= self.limits.max_bytes <= 256 * 1024 * 1024
            and 0 < self.limits.ttl_seconds <= 3600
            and 1 <= self.limits.event_page <= 1000
            and 1 <= self.limits.server_page <= 64
        ):
            raise ValueError('Invalid run retention limits.')
        self.clock = clock
        self.directory = None
        self.records = OrderedDict()
        self.tombstones = OrderedDict()
        self.lock = RLock()
        self.stopping = Event()
        self.closed = False
        self.thread = None

    def start(self):
        self.thread = Thread(target=self._sweep_loop, daemon=True, name='lbsim-run-expiry')
        self.thread.start()

    def _sweep_loop(self):
        while not self.stopping.wait(min(5, self.limits.ttl_seconds)):
            with self.lock:
                self._sweep()

    def _remove(self, rid, reason):
        record = self.records.pop(rid)
        record['path'].unlink(missing_ok=True)
        self.tombstones[rid] = reason
        while len(self.tombstones) > 64:
            self.tombstones.popitem(last=False)

    def _sweep(self):
        for rid, record in list(self.records.items()):
            if self.clock() - record['born'] >= self.limits.ttl_seconds:
                self._remove(rid, 'expired')

    def _get(self, rid):
        self._sweep()
        if rid not in self.records:
            if self.tombstones.get(rid) in ('expired', 'evicted'):
                raise SessionError(
                    410, 'RUN_EXPIRED',
                    'Recorded playback expired or was evicted. Run the configuration again.',
                )
            raise SessionError(404, 'RUN_NOT_FOUND', 'Recorded run not found in this API process.')
        return self.records[rid]

    def add(self, config, summary):
        rid = uuid4().hex
        with self.lock:
            if self.closed:
                raise SessionError(503, 'RUNS_CLOSED', 'Run store is shutting down.')
            if self.directory is None:
                self.directory = tempfile.TemporaryDirectory(prefix='lbsim-runs-')
            fd, name = tempfile.mkstemp(dir=self.directory.name, suffix='.sqlite')
        os.close(fd)
        path = Path(name)
        try:
            events = summary['events']
            with closing(sqlite3.connect(path)) as db:
                totals = _write_timeline(db, events, config['server_count'])
            assert totals.completed == summary['completed_count']
            assert totals.rejected == summary['rejected_count']

            compact = {k: v for k, v in summary.items() if k not in ('events', 'response_times')}
            compact.update(
                events=[],
                response_times=[],
                histogram=dict(
                    scope='all_completed_responses',
                    bins=_recorded_histogram(summary['response_times']),
                ),
                event_count=len(events),
                end_time=max(config['duration'], events[-1][0] if events else 0),
            )
            response = dict(
                api_version='1', run_id=rid, config=deepcopy(config), summary=compact,
                playback=dict(
                    expires_in_seconds=self.limits.ttl_seconds,
                    event_page_limit=self.limits.event_page,
                    server_page_limit=self.limits.server_page,
                    total_requests=totals.offered,
                ),
            )
            size = path.stat().st_size
            if size > self.limits.max_bytes:
                raise SessionError(
                    503, 'RUN_STORAGE_LIMIT', 'Recorded trace exceeds temporary storage capacity.',
                )
            with self.lock:
                if self.closed:
                    raise SessionError(503, 'RUNS_CLOSED', 'Run store is shutting down.')
                self._sweep()
                while self.records and (
                    len(self.records) >= self.limits.max_runs
                    or sum(record['bytes'] for record in self.records.values()) + size
                    > self.limits.max_bytes
                ):
                    self._remove(next(iter(self.records)), 'evicted')
                self.records[rid] = dict(path=path, bytes=size, born=self.clock(), response=response)
            return deepcopy(response)
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    @staticmethod
    def _connect(record):
        db = sqlite3.connect(f'file:{record["path"]}?mode=ro', uri=True)
        db.row_factory = sqlite3.Row
        return db

    def get(self, rid):
        with self.lock:
            return deepcopy(self._get(rid)['response'])

    def events(self, rid, offset, limit):
        with self.lock:
            record = self._get(rid)
            with closing(self._connect(record)) as db:
                rows = db.execute("""
                    SELECT seq, at, sid, running, waiting, action, request, io, outstanding,
                           io_active, io_queued
                    FROM events WHERE seq >= ? ORDER BY seq LIMIT ?
                """, (offset, limit)).fetchall()
            response = record['response']
            total = response['summary']['event_count']
            staged = response['config'].get('request_model') == 'cpu_io'
            next_offset = offset + len(rows)
            return dict(
                api_version='1', run_id=rid, offset=offset, limit=limit, total=total,
                next_offset=next_offset if next_offset < total else None,
                items=[dict(sequence=row['seq'], event=_event_payload(row, staged)) for row in rows],
            )

    def snapshot(self, rid, now, offset, limit):
        with self.lock:
            record = self._get(rid)
            response = record['response']
            config = response['config']
            server_count = config['server_count']
            rates = config.get('processing_rates', [1] * server_count)
            staged = config.get('request_model') == 'cpu_io'
            now = min(now, response['summary']['end_time'])
            items = []
            with closing(self._connect(record)) as db:
                latest = db.execute("""
                    SELECT * FROM events WHERE at <= ? ORDER BY at DESC, seq DESC LIMIT 1
                """, (now,)).fetchone()
                for sid in range(offset, min(server_count, offset + limit)):
                    row = db.execute("""
                        SELECT running, waiting, io, outstanding, io_active, io_queued
                        FROM events WHERE sid = ? AND at <= ? ORDER BY at DESC, seq DESC LIMIT 1
                    """, (sid, now)).fetchone()
                    server = dict(
                        id=sid,
                        running=row['running'] if row else 0,
                        waiting=row['waiting'] if row else 0,
                        slots=config['concurrency'],
                        queue_limit=config.get('outstanding_limit', config['queue_limit']),
                        processing_rate=rates[sid],
                    )
                    if staged:
                        server.update(
                            io_waiting=row['io'] if row else 0,
                            io_active=row['io_active'] if row else 0,
                            io_queued=row['io_queued'] if row else 0,
                            outstanding=row['outstanding'] if row else 0,
                            outstanding_limit=config['outstanding_limit'],
                        )
                    items.append(server)

            totals = dict(
                offered=latest['offered'] if latest else 0,
                completed=latest['completed'] if latest else 0,
                rejected=latest['rejected'] if latest else 0,
                running=latest['total_running'] if latest else 0,
                waiting=latest['total_waiting'] if latest else 0,
            )
            if 'retry' in config:
                totals['pending_retries'] = latest['pending_retries'] if latest else 0
            snapshot = dict(
                api_version='1', run_id=rid, simulation_time=now, totals=totals,
                idle_servers=latest['idle'] if latest else server_count,
                latest_event=_event_payload(latest, staged) if latest else None,
                servers=dict(offset=offset, limit=limit, total=server_count, items=items),
            )
            if staged:
                totals.update(
                    io_waiting=latest['total_io'] if latest else 0,
                    io_active=latest['total_io_active'] if latest else 0,
                    io_queued=latest['total_io_queued'] if latest else 0,
                    outstanding=latest['total_outstanding'] if latest else 0,
                )
                snapshot['io_resource'] = dict(
                    capacity=config.get('io_capacity', 64),
                    active=totals['io_active'],
                    queued=totals['io_queued'],
                )
            return snapshot

    def delete(self, rid):
        with self.lock:
            self._get(rid)
            self._remove(rid, 'deleted')
        return dict(api_version='1', run_id=rid, status='deleted')

    def close(self):
        self.stopping.set()
        if self.thread:
            self.thread.join(timeout=1)
        with self.lock:
            self.closed = True
            self.records.clear()
            if self.directory:
                self.directory.cleanup()
