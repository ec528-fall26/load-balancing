# Continuous API sessions — A-08

The Python service owns each session's clock and mutable engine in a separate
spawned process. Polling reads state; it does not step the simulation. This
first slice supports individual servers in one pool, using the existing
round-robin and least-active-request admission semantics. Regional contracts
are A-09 and Next.js live controls are A-10. The Next.js lab now connects single-pool and regional live sessions as documented in [live-frontend.md](live-frontend.md). One-shot execution remains separate.

Run one API process locally:

```sh
PYTHONPATH=src uv run uvicorn lbsim.api:app --host 127.0.0.1 --port 8000 --workers 1
```

Interactive reference: `http://127.0.0.1:8000/docs`. `/health` includes the
one-shot limits and a separate `live_limits` object.

## HTTP contract

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/v1/sessions` | Create a session; return 201 with its ID and initial snapshot |
| GET | `/v1/sessions/{id}/snapshot` | Read a consistent, paginated snapshot |
| POST | `/v1/sessions/{id}/commands` | Apply one serialized command and return its snapshot |
| DELETE | `/v1/sessions/{id}` | Stop/reap its worker and release session capacity |

Create with the original configuration fields **except `duration`**. There is
no arrival cutoff; `arrival_rate` may be zero. Unknown fields and a supplied
duration are rejected. Optional processing rates have one value per server.

```json
{
  "config": {
    "server_count": 100,
    "concurrency": 4,
    "queue_limit": 16,
    "arrival_rate": 10000,
    "service_min": 0.01,
    "service_max": 0.1,
    "seed": 42,
    "policy": "round_robin"
  },
  "speed": 1,
  "paused": false
}
```

The returned `session_id` is opaque. Commands are:

```json
{"action":"pause"}
{"action":"resume"}
{"action":"set_rate","value":0}
{"action":"set_speed","value":2}
```

Pause/resume do not accept values. Rate is finite, 0–100,000 requests/s;
speed is 0.25–10 simulated seconds per wall second. Booleans and numeric strings
are rejected as values. Zero traffic allows outstanding work to drain while
the clock runs; pausing instead freezes all processing.

The seed and policy are fixed for the life of a session. Create a new session
to change topology, capacities, policy or service distribution. Effective
service time (`service_time / processing_rate`) must be 1 ns–3,600 seconds.

## Clock and admission semantics

- The first arrival is at simulation time zero when initial traffic is positive.
  Further arrivals are evenly spaced and service demands come from the seeded
  RNG. Completions precede arrivals at equal timestamps; completion ordering
  uses server ID then request ID, matching the one-shot engine.
- Round robin advances for each offered request. Least active counts running
  requests only, with lowest server ID breaking ties. Waiting requests are not
  counted for routing. A full target rejects without retrying elsewhere.
- A traffic change schedules its next arrival relative to the current processed
  simulation time. Commands are ordered under one session lock and take effect
  at the reported `simulation_time`, never in the middle of an engine event.
- The worker wakes about every 50 ms and processes at most 2,000 events or 10 ms
  of engine work per advance. The deadline is checked between events. An
  individual event or snapshot operation cannot be preempted mid-operation.
- The clock targets wall elapsed time multiplied by speed. Under overload,
  `simulation_time` can lag `target_simulation_time`; the difference is exposed
  as `lag_simulation_seconds`. Work is not skipped to make time look current.
- Pause, resume, rate and speed commands reset catch-up debt to the current
  processed time. They preserve outstanding requests/events. They do not
  retroactively generate arrivals for wall time the engine could not process.

## Snapshot and retention

Every response includes `api_version`, `session_id`, status, speed, revision,
configuration, simulated/target time, lag, totals, metrics, histogram, server
page, history and recent command metadata. A revision changes when processed
engine state advances or a control command is applied. Polls do not count as
commands. Clients can use session ID/revision to ignore stale responses.

`offered = completed + rejected + running + waiting`. There is no failure count
because server/network failure injection is not implemented in A-08.

| Data | Retention / meaning |
| --- | --- |
| Mean response time | All completed responses since creation |
| `recent_p95_response_time` | Most recent 2,000 completed responses, nearest-rank p95 |
| Histogram | At most 20 bins over the same recent response window |
| Mean slot utilization | Occupied slot-seconds / available slot-seconds since creation |
| Per-server utilization | Same definition for each displayed server |
| History | At most 240 samples, published about every 0.5 wall seconds; paused duplicate times are omitted |
| Command list | Last 128 controls, with sequence and effective simulation time |
| Pending completions | At most total execution-slot capacity |
| Waiting requests | At most total waiting-place capacity |

`command_sequence` is the lifetime count. `command_log_limit` and
`command_log_truncated` explicitly identify incomplete retained command history.
The bounded command list is not yet a durable replay log; A-22 owns that work.
No growing request trace or completed-response list is retained or returned.
Snapshots never include raw response-time samples.

GET query parameters:

- `server_offset`: default 0; offsets beyond the server count return an empty page.
- `server_limit`: default 32, maximum 64.
- `history_limit`: default 120, maximum 240; zero omits history.

Create and command responses also use a bounded default page/history. Every
response includes the server total and pagination metadata. Use polling around
2 Hz initially; SSE/WebSockets are not required for this contract. Work on
one-shot payload pagination and broader browser/regional scale measurements
remains in A-11.

## Lifecycle and resource bounds

Two live workers are admitted by default, in addition to the existing single
one-shot worker slot. Session creation reservations and stopping workers count
toward the live admission bound. Requests to a session are serialized; lock
contention returns `429 SESSION_BUSY` after a bounded wait instead of creating
an application command queue.

Sessions expire after 300 seconds without a successful snapshot/control request,
or 3,600 wall seconds after creation even with active viewers. Paused sessions
also expire. A bounded background sweeper and the worker enforce cleanup;
shutdown deletes live sessions and reaps workers. Worker startup has a 5-second
deadline; command replies have a 2-second deadline after lock acquisition.
Unavailable workers are terminated and their capacity is released.

Typical errors use the existing versioned error envelope:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 422 | `INVALID_REQUEST`, `INVALID_CONFIG`, `INVALID_COMMAND`, `WORKLOAD_LIMIT` | Invalid body, values, capacities, or query bounds |
| 429 | `SESSION_LIMIT` | Live admission bound reached |
| 429 | `SESSION_BUSY` | Per-session command lock could not be acquired in time |
| 404 | `SESSION_NOT_FOUND` | Unknown/deleted ID, or ID from a previous API process |
| 410 | `SESSION_EXPIRED` | Idle or absolute lifetime expired |
| 503 | `SESSION_FAILED` | Worker crashed, disconnected, or stopped replying |
| 504 | `SESSION_START_TIMEOUT` | Worker did not finish startup in time |

Expired/failed IDs have a bounded 128-entry tombstone cache. Once evicted they
return 404. DELETE returns 200 for a live session; a repeated delete returns 404.
Sessions are in memory and do not survive API restart. Multiple Uvicorn workers,
public authentication/ownership, persistence, regional travel, failures, retries
and frontend live controls are outside this slice. IDs are not authentication;
keep the service bound to localhost until a public ownership contract exists.

## Verification

```sh
PYTHONPATH=src uv run python -m unittest discover -s tests -p 'test_continuous.py' -v
PYTHONPATH=src uv run python -m unittest discover -s tests -p 'test_sessions.py' -v
PYTHONPATH=src uv run python -m unittest discover -s tests
```

Tests cover one-shot parity for both policies and mixed compute rates,
conservation, bounded pending work/windows/history/histograms, event-budget
continuation, no-poll clock progression, pause/resume/drain, command ordering,
admission, TTL/lifetime expiry, restart loss, validation, pagination, worker
crash/timeout recovery, tombstone retention and shutdown reaping.


The original A-08 exclusions above describe its single-pool slice. The A-09 extension adds aggregate regional pools and client RTT travel through the same lifecycle; see [regional-api.md](regional-api.md).
