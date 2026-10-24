# Simulation model

Shared contract for D2-01, describing the current Demo 2 implementation.
Ready for team review; optional extensions are listed separately.
All times are simulated seconds. No wall-clock sleeps are used.

## Data

| Object | Fields |
| --- | --- |
| Config | `server_count`, `concurrency`, `queue_limit`, `arrival_rate`, `duration`, `service_min`, `service_max`, `seed`, `policy` |
| Request | `id` (unique integer), `arrival_time`, `service_time` |
| Server | `id`, `concurrency`, `queue_limit`, `size`, `reliability`, running executions, FIFO waiting requests |
| Execution | request, `server_id`, `start_time`, `completion_time` |
| Run summary | `completed_count`, `rejected_count`, `mean_response_time`, `p95_response_time`, `per_server_utilization`, `response_times`, `events` |

Server count and concurrency are positive integers. Queue limit is a nonnegative
integer counting waiting requests only. Duration, rate and service bounds are
positive finite numbers, with `service_min <= service_max`. Arrival times are
finite and nonnegative. IDs are unique within a run. The seed is an integer.
All servers initially have identical capacity; concurrency is the only server
size setting. Hardware types and reliability/failures remain optional extensions.

The connected prototype currently uses `int(arrival_rate * duration)` requests
with evenly spaced arrivals starting at zero. Service durations are uniform
between the configured bounds. Each run uses a local seeded generator.

## Routing and event order

The public entry point is `run_simulation(values: dict) -> dict` in
`src/lbsim/simulation.py`. It validates the configuration and returns the run
summary. The lower-level engine is
`route(server_count, concurrency, queue_limit, policy, arrival_rate, duration,
service_min, service_max, seed, events=None) -> (completed, rejected)` in
`src/lbsim/utils/generate_seed.py`. Callers of `route` must validate their inputs.
`completed` contains `Execution` objects in completion order; `rejected` contains
request IDs in arrival order. Pass a list as `events` to collect playback records.
Configuration and these raw lists are not included in the public summary.
Generated count is `completed_count + rejected_count` after draining.

Round-robin is implemented inside `route`, using a counter to select server IDs
`0, 1, ..., server_count - 1` repeatedly. There is no separate `select_server`
function. Least-active-requests selects the minimum `(running_count, server_id)`
from current server state at each arrival. Both policies leave admission to the
selected server: neither skips full servers nor retries. Waiting requests do not
count toward load, so ties can select a full queue even when another server has
waiting space.

- Pending completions are sorted by `(completion_time, server_id, request_id)`.
- Completions are processed before arrivals at the same timestamp.
- Arrivals are processed in generated request ID order, with times
  `request_id / arrival_rate`.
- On completion, queued work starts immediately, before the next event is handled.
- After arrivals stop, accepted work drains until every server is idle.

Playback records are tuples
`(time, server_id, running_count, waiting_count, status, request_id)`. Counts
reflect server state after the event, including any queued request started by a
completion. Status is `started`, `queued`, `rejected`, or `completed`. Starting
queued work is represented by the completion's updated counts, rather than a
separate `started` record.

## Optional extensions

Both `round_robin` and `least_active_requests` are implemented in the engine and
available in the UI. Policy-comparison experiments remain a separate task.

Exponential interarrival times, hardware types, and reliability/failures are also
optional. The current engine creates identical servers with `size=None` and
`reliability=None`; those constructor fields do not affect execution. Any future
traffic generator must create the complete seeded trace before routing so policy
comparisons use identical requests.

## Server processing rates (A-01)

Each server can have an optional processing-rate multiplier. A request's
`service_time` is the work it needs on a rate-1.0 server, a server with rate `r`
runs it for `service_time / r` seconds. Rate 2.0 finishes the same request in
half the time. Rate 0.5 takes twice as long

- Set it with `processing_rates`: one positive, finite number per server, in
  server-ID order. Leaving it out, or giving all 1.0, is the original uniform
  model and returns the same nine-field config and identical results
- Rates change only execution time. The seeded trace (arrivals and service
  times) is identical, uniform and mixed fleets can be compared on the same
  requests
- Neither policy reads rates. Least-active-requests counts running requests
  only. A faster server frees slots sooner it's picked more often, and
  ties still go to the lowest server ID
- Utilization is still occupied slot time in the arrival window. A fast server
  at 100% does more work than a slow one at 100%
- Not yet in the UI or exports. Exports refuse a run with mixed rates rather
  than silently dropping them (schema version 1 has nine settings)

Worked example (`tests/test_processing_rates.py`): 2 servers, 1 slot, 1 waiting
place, 4 requests/s for 1 s (arrivals at 0, 0.25, 0.5, 0.75), service 1.0 s,
rates `[2.0, 1.0]`

| Policy | Where request 3 goes | Response times (s) | Mean | p95 |
| --- | --- | --- | ---: | ---: |
| round_robin, uniform `[1, 1]` | queues on server 1 | 1.0, 1.0, 1.5, 1.5 | 1.25 | 1.5 |
| round_robin, `[2, 1]` | queues on slow server 1, starts at 1.25 | 0.5, 0.5, 1.0, 1.5 | 0.875 | 1.5 |
| least_active, `[2, 1]` | tie at 1 running: lowest ID, fast server 0, starts at 1.0 | 0.5, 0.5, 1.0, 0.75 | 0.6875 | 1.0 |

Response times are listed in completion order. On the fast server request 0
ends at 0.5, exactly when request 2 arrives, completions run first,
request 2 starts at once instead of queueing.

## Server API (implemented)

- `submit(request, now)` returns `started`, `queued`, or `rejected`, plus the
  new execution when work starts. Submission must occur at the arrival time.
- `complete(request_id, now)` returns the completed execution and, if the queue
  was nonempty, the execution that just started. It must be called at the
  scheduled completion time.
- The engine must schedule each returned execution's completion event, including
  work started from a queue. The server does not advance time automatically.
- `running` and `waiting` expose immutable snapshots for policies and debugging.

A free slot starts work immediately. Otherwise a request joins the waiting queue
if there is room, or is rejected. There are no retries or alternate-server attempts.
Requests run without preemption for their full service duration.

## Metrics contract (implemented)

Response time is `completion_time - arrival_time`; waiting time is
`start_time - arrival_time`. Latency statistics include completed requests only,
including those completed during draining. Report mean and nearest-rank p95
(sorted value at index `ceil(0.95 * n) - 1`), or `null` for no completions.

Per-server utilization is occupied slot-seconds within `[0, duration]`, divided
by `concurrency * duration`. Clip execution intervals to that window; draining
must not inflate utilization. This is modeled slot occupancy, not measured CPU.
After draining, `completed + rejected == generated`, and every server is idle.

## Data examples

These examples use a fixed service duration so the output is easy to check.

```python
from lbsim.server import Execution, Request, Server
from lbsim.settings import validate_config
from lbsim.simulation import run_simulation

config = validate_config({
    "server_count": 1, "concurrency": 1, "queue_limit": 1,
    "arrival_rate": 1.0, "duration": 4.0,
    "service_min": 3.0, "service_max": 3.0,
    "seed": 42, "policy": "round_robin",
})
request = Request(id=0, arrival_time=0.0, service_time=3.0)
server = Server(id=0, concurrency=1, queue_limit=1, size=None, reliability=None)
admission = server.submit(request, now=0.0)
assert admission.status == "started"
assert server.running == (Execution(request, 0, 0.0, 3.0),)
assert server.waiting == ()

# This creates fresh servers, independently of the example server above.
result = run_simulation(config)
assert result == {
    "completed_count": 3,
    "rejected_count": 1,
    "mean_response_time": 14 / 3,
    "p95_response_time": 6.0,
    "per_server_utilization": {0: 1.0},
    "response_times": [3.0, 5.0, 6.0],
    "events": [
        (0.0, 0, 1, 0, "started", 0),
        (1.0, 0, 1, 1, "queued", 1),
        (2.0, 0, 1, 1, "rejected", 2),
        (3.0, 0, 1, 0, "completed", 0),
        (3.0, 0, 1, 1, "queued", 3),
        (6.0, 0, 1, 0, "completed", 1),
        (9.0, 0, 0, 0, "completed", 3),
    ],
}
```

## Worked server example

This hand-written trace uses different service durations. It exercises the
`Server` API directly; it is not the trace generated by the config above.
A/B/C/D correspond to integer request IDs 0/1/2/3.

One server, one slot, one waiting space:

| Time | Event | Result |
| --- | --- | --- |
| 0 | A arrives, service 3 | A starts; completion at 3 |
| 1 | B arrives, service 2 | B waits |
| 2 | C arrives, service 1 | C rejected; queue full |
| 3 | A completes | B starts; completion at 5 |
| 3 | D arrives, service 1 | D waits behind running B |
| 5 | B completes | D starts; completion at 6 |
| 6 | D completes | Server idle |

Response times are A=3, B=4, D=3 seconds. There are three completions and one
rejection. With an arrival window of 4 seconds, utilization is 100%; the final
completion is at 6 seconds. Mean response time is 10/3 seconds and p95 is 4.

## Run the checks

From the repository root:

```sh
uv run python -m unittest discover -s tests -v
```

`tests/test_server.py` checks the hand-written server trace above.
The server lifecycle, fixed-interval workload generator, both routing policies,
metrics and UI are connected. `tests/test_policies.py` checks changing load,
completion-before-arrival routing, ties, full queues, multiple slots and identical
seeded workloads between policies. Whole-run invariants cover both policies.
