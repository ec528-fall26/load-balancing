"""Small standalone CPU/I/O research model; existing simulation contracts stay unchanged.

A request is CPU1 -> unbounded I/O delay -> CPU2 on its assigned server.
CPU stages share a bounded FIFO-ready queue and non-preemptive CPU slots. I/O
wait releases CPU, but the request retains its outstanding admission slot.
"""
from collections import deque
from dataclasses import asdict, dataclass
from hashlib import sha256
from heapq import heappop, heappush
from math import ceil, isfinite
from random import Random
import json

from lbsim.policies import RoutingContext, create_policy


@dataclass(frozen=True)
class StagedRequest:
    id: int
    arrival: float
    cpu_first: float
    io_wait: float
    cpu_last: float

    def __post_init__(self):
        if type(self.id) is not int or self.id < 0:
            raise ValueError('Request IDs must be nonnegative integers.')
        if any(type(v) not in (int, float) or not isfinite(v) for v in
               (self.arrival, self.cpu_first, self.io_wait, self.cpu_last)):
            raise ValueError('Request times must be finite numbers.')
        if self.arrival < 0 or self.cpu_first <= 0 or self.cpu_last <= 0 or self.io_wait < 0:
            raise ValueError('CPU stages must be positive; arrival and I/O must be nonnegative.')


def make_workload(*, rate, duration, seed, io_fraction, service_min=.08, service_max=.12):
    if (type(seed) is not int or any(type(v) not in (int, float) or not isfinite(v)
            for v in (rate, duration, io_fraction, service_min, service_max))
            or rate <= 0 or duration <= 0 or not 0 <= io_fraction < 1
            or not 0 < service_min <= service_max):
        raise ValueError('Choose valid finite workload parameters and an integer seed.')
    rng = Random(seed)
    requests = []
    for i in range(int(rate * duration)):
        total = rng.uniform(service_min, service_max)
        cpu = total * (1 - io_fraction) / 2
        requests.append(StagedRequest(i, i / rate, cpu, total * io_fraction, cpu))
    return tuple(requests)


def workload_hash(requests):
    return sha256(json.dumps([asdict(r) for r in requests], sort_keys=True).encode()).hexdigest()


def run_staged(requests, *, servers, cpu_slots, outstanding_limit, duration,
               policy, routing_seed=0, record_events=False):
    """Offer an immutable trace in [0,duration), then fully drain accepted work.

    Completion ties: CPU end, I/O end, then arrival; equal-kind ties follow event
    insertion order. A returning CPU stage joins the ready FIFO without being
    readmitted. No retry, cancellation, I/O contention or network model.
    """
    if (any(type(v) is not int or v < 1 for v in (servers, cpu_slots, outstanding_limit))
            or type(duration) not in (int, float) or not isfinite(duration) or duration <= 0
            or type(routing_seed) is not int):
        raise ValueError('Choose positive capacities/duration and an integer routing seed.')
    requests = tuple(requests)
    if (any(not isinstance(r, StagedRequest) or r.arrival >= duration for r in requests)
            or len({r.id for r in requests}) != len(requests)
            or any(a.arrival > b.arrival for a, b in zip(requests, requests[1:]))):
        raise ValueError('Trace must have unique IDs and ordered arrivals inside the window.')
    active = [0] * servers
    outstanding = [0] * servers
    io = [0] * servers
    ready = [deque() for _ in range(servers)]
    busy = [0.] * servers
    cpu_total = [0.] * servers
    outstanding_area = [0.] * servers
    io_area = [0.] * servers
    queue_area = [0.] * servers
    peak_outstanding = [0] * servers
    peak_io = [0] * servers
    last = 0.
    offered = completed = rejected = 0
    finished = []
    rejections = []
    events = []
    pending = []
    serial = 0
    routing = create_policy(policy, RoutingContext(
        servers, active.__getitem__, routing_rng=Random(routing_seed)), 'cpu_io')

    def push(time, kind, sid, request, stage):
        nonlocal serial
        serial += 1
        priority = {'cpu_end': 0, 'io_end': 1, 'arrival': 2}[kind]
        heappush(pending, (time, priority, serial, kind, sid, request, stage))

    def start_ready(sid, now):
        while ready[sid] and active[sid] < cpu_slots:
            request, stage = ready[sid].popleft()
            active[sid] += 1
            cpu = request.cpu_first if stage == 0 else request.cpu_last
            push(now + cpu, 'cpu_end', sid, request, stage)
        routing.update(sid)

    for request in requests:
        push(request.arrival, 'arrival', -1, request, 0)
    while pending:
        now, _, _, kind, sid, request, stage = heappop(pending)
        window = min(now, duration) - min(last, duration)
        for i in range(servers):
            busy[i] += window * active[i]
            cpu_total[i] += (now - last) * active[i]
            outstanding_area[i] += window * outstanding[i]
            io_area[i] += window * io[i]
            queue_area[i] += window * len(ready[i])
        last = now
        if kind == 'arrival':
            sid = routing.choose()
            offered += 1
            if outstanding[sid] >= outstanding_limit:
                rejected += 1
                rejections.append(request.id)
            else:
                outstanding[sid] += 1
                ready[sid].append((request, 0))
                start_ready(sid, now)
        elif kind == 'cpu_end':
            active[sid] -= 1
            if stage == 0:
                io[sid] += 1
                push(now + request.io_wait, 'io_end', sid, request, 1)
            else:
                outstanding[sid] -= 1
                completed += 1
                finished.append({'id': request.id, 'server': sid,
                                 'completion': now, 'response': now - request.arrival,
                                 'cpu_queue_wait': max(0., now - request.arrival - request.cpu_first - request.io_wait - request.cpu_last)})
            start_ready(sid, now)
        else:
            io[sid] -= 1
            ready[sid].append((request, 1))
            start_ready(sid, now)
        for i in range(servers):
            peak_outstanding[i] = max(peak_outstanding[i], outstanding[i])
            peak_io[i] = max(peak_io[i], io[i])
            assert 0 <= active[i] <= cpu_slots
            assert 0 <= outstanding[i] <= outstanding_limit
            assert outstanding[i] == active[i] + io[i] + len(ready[i])
        assert offered == completed + rejected + sum(outstanding)
        if record_events:
            events.append({'time': now, 'kind': kind, 'request': request.id, 'server': sid,
                           'cpu_active': list(active), 'io_waiting': list(io),
                           'cpu_queued': [len(q) for q in ready],
                           'outstanding': list(outstanding), 'completed': completed,
                           'rejected': rejected, 'offered': offered})
    assert completed + rejected == len(requests) and not any(outstanding)
    response = sorted(r['response'] for r in finished)
    return dict(policy=policy, workload_sha256=workload_hash(requests),
                offered=offered, completed=completed, rejected=rejected,
                rejection_rate=rejected / offered if offered else 0.,
                mean_response=sum(response) / len(response) if response else None,
                p95_response=response[ceil(.95 * len(response)) - 1] if response else None,
                mean_cpu_queue_wait=sum(r['cpu_queue_wait'] for r in finished) / completed if completed else None,
                mean_io_waiting=[value / duration for value in io_area],
                mean_cpu_queued=[value / duration for value in queue_area],
                cpu_utilization=[value / (cpu_slots * duration) for value in busy],
                cpu_seconds_including_drain=cpu_total,
                mean_outstanding=[value / duration for value in outstanding_area],
                peak_outstanding=peak_outstanding, peak_io_waiting=peak_io,
                end_time=last, completions=finished, rejected_ids=rejections, events=events)
