# Simulation model

Shared contract for D2-01. This is the initial implementation proposal for team review.
All times are simulated seconds. No wall-clock sleeps are used.

## Data

| Object | Fields |
| --- | --- |
| Config | `server_count`, `concurrency`, `queue_limit`, `arrival_rate`, `duration`, `service_min`, `service_max`, `seed`, `policy` |
| Request | `id` (unique integer), `arrival_time`, `service_time` |
| Server | `id`, `concurrency`, `queue_limit`, running executions, FIFO waiting requests |
| Execution | request, `server_id`, `start_time`, `completion_time` |
| Run result | config, generated request count, completed executions, rejected request IDs, per-server utilization |

Server count and concurrency are positive integers. Queue limit is a nonnegative
integer counting waiting requests only. Duration, rate and service bounds are
positive finite numbers, with `service_min <= service_max`. Arrival times are
finite and nonnegative. IDs are unique within a run. The seed is an integer.
All servers initially have identical capacity; concurrency is the only server
size setting. Hardware types and reliability/failures remain optional extensions.

The connected prototype currently uses `int(arrival_rate * duration)` requests
with evenly spaced arrivals starting at zero. Service durations are uniform
between the configured bounds. Each run uses a local seeded generator.

Proposed alternative for team review: exponential interarrival times with mean
`1 / arrival_rate`, starting from time zero; uniform service durations between
the two bounds. Generate arrivals strictly before `duration`. Use a local seeded
random generator and create the complete trace before routing, so both policies
receive identical requests. Generation and config validation are separate tasks.

## Routing and event order

The policy interface is `select_server(servers) -> server_id`, where servers are
provided in increasing ID order. Policies inspect state but do not change it.
Round-robin maintains its own index. Least-active-requests counts running work
only and breaks ties by smallest server ID. Neither policy skips a full server;
rejection is handled by the selected server.

The engine orders events by `(time, kind, request_id)`, with completions before
arrivals. For simultaneous arrivals, smaller request IDs go first. On completion,
queued work starts immediately, before arrivals at that timestamp are routed.
After arrivals stop, drain accepted work until every server is idle.

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

## Metrics contract (not implemented yet)

Response time is `completion_time - arrival_time`; waiting time is
`start_time - arrival_time`. Latency statistics include completed requests only,
including those completed during draining. Report mean and nearest-rank p95
(sorted value at index `ceil(0.95 * n) - 1`), or `null` for no completions.

Per-server utilization is occupied slot-seconds within `[0, duration]`, divided
by `concurrency * duration`. Clip execution intervals to that window; draining
must not inflate utilization. This is modeled slot occupancy, not measured CPU.
After draining, `completed + rejected == generated`, and every server is idle.

## Worked example

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

## Run the server tests

From the repository root:

```sh
uv run python -m unittest discover -s tests -v
```

The server lifecycle, fixed-interval workload generator, round-robin event loop,
metrics and UI are connected. Least-active-requests remains a subsequent task.
