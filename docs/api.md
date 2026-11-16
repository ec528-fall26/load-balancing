# API and run formats

- [One-shot API](#python-engine-api-a-05)
- [Continuous sessions](#continuous-api-sessions--a-08)
- [Regional API](#regional-api-and-frontend)
- [Recorded playback](#bounded-one-shot-responses-and-recorded-playback)
- [Run exports and verified replay](#saved-runs-export-verified-replay-and-comparison-d3-030405)
- [Live Lab controls](#live-sessions-in-the-nextjs-lab--a-10)

## Python engine API (A-05)

The API calls the same seeded engine as the experiment scripts. For one-shot Lab
runs, Next.js proxies compact recordings. The API also serves
[continuous sessions](#continuous-api-sessions--a-08) and
[regional workloads](#regional-api-and-frontend).

### Start locally

Start one Python API process with the [quick start](../README.md#quick-start).
Use `http://127.0.0.1:8000/health` to check readiness and limits, or
`http://127.0.0.1:8000/docs` for the interactive schema. OpenAPI JSON is at
`/openapi.json`. Admission limits and temporary state belong to each API process.

### Run a simulation

```sh
curl --fail-with-body http://127.0.0.1:8000/v1/run \
  -H 'Content-Type: application/json' \
  -d '{"config":{"server_count":2,"concurrency":2,"queue_limit":2,"policy":"round_robin","arrival_rate":10,"duration":2,"service_min":0.1,"service_max":1,"seed":42}}'
```

The request requires a `config` object. The nine original settings are required;
`processing_rates` is optional, with one positive finite multiplier per server.
Unknown envelope/configuration fields are rejected rather than ignored.

Success returns HTTP 200 with:

```json
{
  "api_version": "1",
  "config": {"...": "validated simulation configuration"},
  "summary": {"...": "existing engine summary, response_times and events"}
}
```

`api_version` versions the HTTP interface, independently of saved-run export
schema versions. Events are JSON arrays and server-utilization object keys are
strings on the wire. A uniform all-1 processing-rate list is normalized away
by the existing validator. Mixed rates remain in the returned configuration.
Saved-run v1 exports still do not support those rates.

### Limits and errors

Defaults, also returned by `/health`:

| Limit | Value |
| --- | ---: |
| Actual request body, including chunked uploads | 65,536 bytes (saved CSV comparison: 12 MiB total, 5 MiB per CSV) |
| Arrival rate × duration | 100,000 |
| Servers | 1,000 |
| Total processing slots | 4,096 |
| Total waiting places | 100,000 |
| Concurrent simulations per API process | 1 |
| Worker response deadline | 15 seconds, plus bounded process cleanup |

Overlapping simulations receive 429 immediately rather than entering an
unbounded job queue. Simulation computation runs in a spawned child process;
the API waits in a thread so the async request loop remains available. The child
is terminated and reaped on timeout. Each request starts a fresh child, so a
failed run does not leave a broken persistent executor. Completed traces remain
bounded by the workload limits; they are still included in this first endpoint.
The [recordings endpoint](#bounded-one-shot-responses-and-recorded-playback) uses bounded summaries and separate playback transfer.

All errors share an envelope:

```json
{
  "api_version": "1",
  "code": "INVALID_CONFIG",
  "message": "Configuration validation failed.",
  "field_errors": [{"field": "config.concurrency", "message": "must be an integer"}]
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 413 | BODY_TOO_LARGE | Reduce the request body |
| 422 | INVALID_REQUEST | Invalid JSON or request envelope |
| 422 | INVALID_CONFIG | Unsupported or invalid simulation configuration |
| 422 | WORKLOAD_LIMIT | Reduce workload/capacity to fit API limits |
| 429 | RUN_BUSY | Another simulation owns the worker slot; retry later |
| 504 | RUN_TIMEOUT | Reduce workload; the child process is cleaned up |
| 500 | ENGINE_FAILED / INTERNAL_ERROR | Worker or unexpected service failure |

Unknown routes and unsupported methods use the same envelope with 404/405.

### Checks

```sh
uv run --locked python -m unittest discover -s tests -p test_api.py -v
uv run --locked python -m unittest discover -s tests
```

API tests exercise both policies with mixed compute speeds against exact direct
engine output, input and workload errors, streamed body limits, concurrent-run
admission, health during an active run, timeout/crash cleanup, and slot recovery.

## Continuous API sessions — A-08

The Python service owns each session's clock and mutable engine in a separate
spawned process. Polling reads state; it does not step the simulation. This
first slice supports individual servers in one pool, using the existing
single-pool admission semantics. The [regional API](#regional-api-and-frontend)
and [Next.js Lab controls](#live-sessions-in-the-nextjs-lab--a-10) share the
same session lifecycle.

Use the [local API](#start-locally) for these requests. `/health` reports the
separate `live_limits` object.

### HTTP contract

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
{"action":"fail_server","value":0}
{"action":"fail_region","value":0}
{"action":"restore_region","value":0}
```

Pause/resume do not accept values. Rate is finite, 0–100,000 requests/s;
speed is 0.25–10 simulated seconds per wall second. Booleans and numeric strings
are rejected as values. Zero traffic allows outstanding work to drain while
the clock runs; pausing freezes processing. `fail_server` targets a zero-based
server index in a simple single-pool session and uses that server’s configured
mean repair time. The regional commands use a zero-based region index.

The seed and policy are fixed for the life of a session. Create a new session
to change topology, capacities, policy or service distribution. Effective
service time (`service_time / processing_rate`) must be 1 ns–3,600 seconds.

### Clock and admission semantics

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
- The worker wakes about every 50 ms and processes at most 20,000 events or 10 ms
  of engine work per advance. The deadline is checked between events. An
  individual event or snapshot operation cannot be preempted mid-operation.
- The clock targets wall elapsed time multiplied by speed. Under overload,
  `simulation_time` can lag `target_simulation_time`; the difference is exposed
  as `lag_simulation_seconds`. Work is not skipped to make time look current.
- Pause, resume, rate and speed commands reset catch-up debt to the current
  processed time. They preserve outstanding requests/events. They do not
  retroactively generate arrivals for wall time the engine could not process.

### Snapshot and retention

Every response includes `api_version`, `session_id`, status, speed, revision,
configuration, simulated/target time, lag, totals, metrics, histogram, server
page, history and recent command metadata. A revision changes when processed
engine state advances or a control command is applied. Polls do not count as
commands. Clients can use session ID/revision to ignore stale responses.

For the simple single pool, `offered = completed + rejected + running + waiting`.
Availability-enabled snapshots also expose outages and rejection reasons.
Staged and regional snapshots include their additional outstanding states.

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
The command log is bounded in memory and disappears when the session ends.
No growing request trace or completed-response list is retained or returned.
Snapshots never include raw response-time samples.

GET query parameters:

- `server_offset`: default 0; offsets beyond the server count return an empty page.
- `server_limit`: default 32, maximum 64.
- `history_limit`: default 120, maximum 240; zero omits history.

Create and command responses also use a bounded default page/history. Every
response includes the server total and pagination metadata. Use polling around
2 Hz initially. The [playback scale experiment](design-document.md#recorded-playback-and-scale)
measures current one-shot paging and live telemetry.

### Lifecycle and resource bounds

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
| 503 | `SESSION_FAILED` | Worker could not start, crashed, disconnected, or stopped replying |
| 504 | `SESSION_START_TIMEOUT` | Worker did not finish startup in time |

Expired/failed IDs have a bounded 128-entry tombstone cache. Once evicted they
return 404. DELETE returns 200 for a live session; a repeated delete returns 404.
Sessions live in memory and expire when the state API restarts. Keep one
state API worker. Session IDs grant access to that temporary state. The API
does not provide user accounts or authenticate session ownership.

### Verification

```sh
uv run --locked python -m unittest discover -s tests -p 'test_continuous.py' -v
uv run --locked python -m unittest discover -s tests -p 'test_sessions.py' -v
uv run --locked python -m unittest discover -s tests
```

Tests cover one-shot parity for both policies and mixed compute rates,
conservation, bounded pending work/windows/history/histograms, event-budget
continuation, no-poll clock progression, pause/resume/drain, command ordering,
admission, TTL/lifetime expiry, restart loss, validation, pagination, worker
crash/timeout recovery, tombstone retention and shutdown reaping.


## Regional API and frontend

Topology and execution are independent: the Lab supports single-pool or regional topology with either one-shot or continuous execution. Single-pool behavior and exports retain their existing schema. Regional configurations use a separate `topology: "regions"` contract.

### Model

Each region is an aggregate FIFO compute pool. `servers × slots_per_server` sets pooled concurrent capacity; `servers × queue_per_server` sets pooled waiting capacity. Sampled service time is divided by `compute`. CPU occupancy is occupied slots / slots, not measured CPU usage. Load averages are exponentially weighted executing-plus-waiting demand at 60/300/900 seconds, initialized at zero. No per-server placement or failure behavior is implied.

The directed `latency_ms` matrix describes illustrative regional RTT assumptions. Selecting a source region copies its row into `client_latency_ms`. The explicit client RTT vector is authoritative for request travel and can be edited independently. Each request travels half of that RTT to its target, then waits/computes, then travels half back. The matrix does not introduce additional inter-region hops or downstream calls. Telemetry is immediate, without network reporting delay.

Regional policies are separate from individual-server least-active:

- `round_robin`: alternate regional targets.
- `nearest`: minimum client RTT, ties by region index.
- `least_loaded`: minimum `(running + waiting + outbound) / slots`, then client RTT, then region index. Outbound requests are counted before they arrive at the target. Returning responses no longer consume compute slots.
- `nearest_under_load`: the nearest region (client RTT, then region index) whose load, as defined for `least_loaded`, is below 0.9. If every region is at or above 0.9, it chooses like `least_loaded`. Light traffic stays local; heavier traffic spills to the next-nearest regions instead of overloading the nearest one.

A full target rejects at dispatch with no retry. Rejection accounting is immediate at dispatch; rejected requests do not incur an additional return event. Latency metrics cover successful completed responses only. Same-time completions free slots before dispatch; stable sequence numbers order other ties.

### Endpoints

- `GET /v1/regions/presets`: names, regional capacities, matrix, source and client RTT. Assumptions are illustrative, not AWS measurements.
- `POST /v1/regions/run`: `{ "config": ... }`, including positive `duration`. Arrivals occur in `[0, duration)`; outbound requests, queues, compute and returning responses fully drain. Returns normalized config and a bounded summary, not an event trace. Final time is the last drain sampling boundary, not an exact last-completion timestamp.
- `POST /v1/sessions`: the same regional config **without duration**, plus optional `speed` and `paused`. Reuses A-08 snapshot, command and delete paths, admission cap, expiry, worker isolation and command log. One Python process owns each session and advances without browser polling.

Regional configuration fields:

```json
{
  "topology": "regions",
  "regions": [
    {"name": "us-east-1", "servers": 10, "slots_per_server": 4, "compute": 1, "queue_per_server": 10},
    {"name": "us-west-1", "servers": 10, "slots_per_server": 4, "compute": 2, "queue_per_server": 10}
  ],
  "latency_ms": [[2, 75], [75, 2]],
  "source": 0,
  "client_latency_ms": [2, 75],
  "policy": "least_loaded",
  "arrival_rate": 100,
  "service_min": 0.1,
  "service_max": 1,
  "seed": 42
}
```

Client RTT defaults to the source row if omitted. Names must be unique, trimmed and at most 64 characters; use 1–12 regions. Matrices/vectors must match region count, with finite nonnegative RTTs up to 60,000 ms. Regional capacity is capped across all regions at 100,000 servers, 400,000 processing slots, and 1,000,000 waiting places. Regional runs retain the existing one-shot request and runtime limits. Effective service times must be 1 ns–3,600 seconds; seed is an integer in `[0, 2^32−1]`.

To bound in-flight memory, maximum traffic × maximum client RTT (seconds) must not exceed 100,000. Continuous creation uses the service ceiling of 100,000 requests/s for this check, since later rate commands can reach it. Therefore continuous client RTT is limited to 1,000 ms. This deliberately conservative bound is distinct from the matrix's allowed values. Unknown fields, invalid policies and continuous duration are rejected before worker creation.

### Telemetry and UI

Snapshots include total offered/completed/rejected/running/waiting/in-transit counts and at most 12 region rows. Conservation is `offered = completed + rejected + running + waiting + in_transit`; in transit includes outbound and returning accepted responses. Region rows expose slots/free slots, current occupancy, queues, outbound travel, compute, client RTT, load averages, completion/rejection counts and a regional recent-window p95.

The lifetime mean uses all completions. Global and regional p95 use their respective latest 2,000 completions. Global histogram bins are at most 20; history retains at most 240 samples. Continuous queries default to 120 history samples. No full request trace is retained or transferred. One-shot history is also a bounded tail, not a complete replay.

On Setup choose **Topology → Regions**, load a preset, edit capacities/compute and source/client/matrix RTTs, then independently select **Execution → One-shot / Continuous**. Regional cards show current capacity separately from task outcomes. Continuous controls, non-overlapping polling, stale-revision rejection and reconnect reuse A-10. Setup edits affect the next start; Lab live controls affect the active session. Draft topology/execution changes leave the active worker running. The API retires the old worker after its replacement starts successfully.

Regional browser saves, replay and CSV exports remain unavailable pending a versioned regional export schema. Lab-to-Compare transfer now supports regional configurations for bounded baseline/variant runs; this does not introduce a saved regional-results schema. Regional sessions support manual outages and optional client migration. Database persistence and retries are outside the regional model.

Use the [Lab quick start](../README.md#quick-start) and the [regional walkthrough](design-document.md#continuous-regional-outages-and-client-migration).

#### Manual datacenter outages

In a continuous regional run, use **Take offline** or **Restore** on a
datacenter card. The session API accepts `fail_region` and `restore_region`
with the zero-based index in `value`. Commands take effect at the worker's
current simulation time and can be issued while paused.

Taking a region offline rejects its running, queued, and outbound requests.
Responses already returning to clients still arrive. Every regional policy
selects from healthy regions. If all regions are offline, new requests count
as rejected without a destination. Restoring a region makes its slots
available for new work. Rejected requests are never retried automatically.

## Bounded one-shot responses and recorded playback

The Next.js Run action now uses `POST /v1/runs` rather than the full-trace legacy response. It returns exact engine metrics, a whole-run histogram of at most 20 bins, per-server utilization (at most 1,000 servers), an opaque `run_id` and recording metadata. `events` and `response_times` are empty compatibility arrays; they do not mean the simulation had no events or completions. `event_count` and `end_time` describe the recording. Mean and p95 remain the exact whole-run completed-request metrics.

`POST /v1/run` retains the original complete response for existing clients. Regional one-shot execution already returns bounded telemetry through `/v1/regions/run`; its p95 remains recent-window, not whole-run. Neither legacy schema is silently reinterpreted.

### Operations

- `POST /v1/runs` — same validated single-pool config body as `/v1/run`; returns `201` with the compact result. Uses the same one-run admission gate, request/runtime limits and isolated worker.
- `GET /v1/runs/{run_id}` — retrieve the immutable compact result.
- `GET /v1/runs/{run_id}/events?offset=0&limit=500` — at most 1,000 events per page, ordered by immutable zero-based sequence. Each item contains `sequence` and the original event tuple. `next_offset` is null at the end. Equal timestamps retain the original engine order. Paging does not rerun the simulation.
- `GET /v1/runs/{run_id}/snapshot?time=1.25&server_offset=0&server_limit=32` — inclusive state after all events at or before the requested time. Time is capped at the recording end. Returns global request totals, the count of healthy idle servers, the latest event and at most 64 server rows. Exact floating-point timestamps are passed without decimal truncation.
- `DELETE /v1/runs/{run_id}` — delete this recording and its trace file.

Unknown/deleted recordings return `404 RUN_NOT_FOUND`. Expired or evicted recordings return `410 RUN_EXPIRED` while their bounded tombstone remains. Cache loss on API restart also returns 404. The frontend keeps completed summary metrics visible and asks users to rerun when playback expires.

### Retention

Recordings are temporary process-owned data, not user database saves. Event rows are stored in an indexed SQLite file in a private temporary directory. The browser and retained result metadata do not hold full traces. Prefix totals are recorded alongside stable event sequence numbers; server snapshots use indexed per-server lookups rather than transferring/replaying every preceding event in JavaScript.

Defaults: at most four retained runs, a 64 MiB retained-file budget and ten minutes of absolute retention from creation. Reads do not renew retention. Creating a new recording may evict the oldest recording, including a recording currently being viewed. `playback.expires_in_seconds` describes the advertised creation-time retention limit, not a renewed lease. A periodic sweeper removes expired files; shutdown deletes the temporary directory. The quota applies to retained files; creation also needs a staging file and the existing bounded engine result in memory before registration. Generation remains capped at 100,000 offered requests. The event count depends on the model and outage schedule.

This reduces transfer and retained trace memory; it does not eliminate transient engine/IPC allocation. The cache is not durable across API restarts and is not authentication or a replacement for A-17 account/database persistence.

### Frontend

`/api/engine/run` now proxies the bounded endpoint and preserves its 201 status. `/api/runs/...` whitelists recording reads/deletes and numeric queries through the existing same-origin transport. The original `proxyRun` helper remains available for the legacy endpoint.

Overview consumes server-supplied histogram bins. Datacenter playback requests one server page at the selected time, with sequential reads no more often than every 250 ms after a completed read. Seeks/page changes cancel obsolete requests, and expired recordings stop retrying. The displayed state timestamp reflects the returned snapshot. The seek slider snaps its final half-step to the exact end to avoid leaving the last completion behind due to step rounding.

The regional preset **Scale · 1,000 servers / 12 datacenters** contains 4,000 slots, mixed compute and illustrative client RTTs up to 450 ms. Custom regional configurations can have up to 100,000 servers, 400,000 slots, and 1,000,000 waiting places across at most 12 regions.

### Evidence

See `experiments/results/a-11/pagination-scale.json`, `pagination-before-batch.json` and the browser captures. The worker event-count ceiling was increased from 2,000 to 20,000 events per tick while retaining the 10 ms processing-time budget. The old event cap throttled high offered rates before the CPU budget was used. Very high rates can still lag under that CPU budget; reported lag is not hidden or treated as dropped/rejected work. Controls apply at processed simulation time, matching the existing session contract.

### Compare and saved files

The Compare page sends each single-pool case to `POST /v1/run-summary`. It
returns the exact summary metrics without creating a recording or returning
the event trace.

For a recorded simple single-pool run, **Download run** exports the version-one
JSON configuration and CSV results. **Replay a saved run** verifies the
configuration against its saved results fingerprint before creating new
playback. **Compare saved results** verifies both CSV files without rerunning
either case. Version one supports uniform processing rates and the simple
request model.

## Saved runs: export, verified replay and comparison (D3-03/04/05)

After a successful simulation, open **Download run** beneath the results.
Download **configuration (JSON)** and **results (CSV)**. Both describe the last
completed run, including its original seed. Editing the settings form does not
change the downloads until another simulation successfully runs. Invalid
submitted settings clear the results and remove the download buttons. Downloading
does not rerun the simulation or restart playback.

Both files use UTF-8. Browser filenames are
`lbsim-<first 12 characters of run_id>-config.json` and
`lbsim-<first 12 characters of run_id>-results.csv`.
Keep the two files together. The complete matching ID is inside each file.

### Configuration JSON, schema version 1

| Field | Type | Meaning |
| --- | --- | --- |
| `schema_version` | integer | `1` for this format. |
| `run_id` | string | Full SHA-256 fingerprint shared with the results CSV. |
| `config` | object | All nine validated settings below. |

| `config` field | Type | Meaning |
| --- | --- | --- |
| `server_count` | integer | Number of servers, at least one. |
| `concurrency` | integer | Execution slots per server, at least one. |
| `queue_limit` | integer | Waiting places per server, zero or greater. |
| `arrival_rate` | number | Requests per simulated second. |
| `duration` | number | Arrival-window duration in simulated seconds. |
| `service_min`, `service_max` | number | Positive service-time bounds in simulated seconds. |
| `seed` | integer | Random seed, including negative seeds. |
| `policy` | string | Policy used by that run: `round_robin` or `least_active_requests`. |

The seed is stored once inside `config`. Numeric values retain their original
precision. There is no creation timestamp or automatic seed replacement.

### Results CSV, schema version 1

There is one row for **every configured server**, including idle servers and
servers in an empty workload. Rows are sorted by integer server ID. The header
is always present. Columns are in the order defined by `CSV_FIELDS` in
`src/lbsim/exports.py`:

| Column(s) | Meaning |
| --- | --- |
| `schema_version`, `run_id` | Same version and full fingerprint as the JSON. |
| `server_count`, `concurrency`, `queue_limit`, `arrival_rate`, `duration`, `service_min`, `service_max`, `seed`, `policy` | The original configuration, repeated so the CSV is understandable by itself. Units match the JSON. |
| `generated_count` | Total generated requests, equal to completed plus rejected after draining. |
| `completed_count`, `rejected_count` | Whole-run outcome counts after draining. |
| `mean_response_time_seconds` | Whole-run mean response time, including waiting and draining, for completed requests. |
| `p95_response_time_seconds` | Whole-run nearest-rank p95 response time for completed requests. |
| `server_id` | ID of the server represented by this row, starting at zero. |
| `slot_utilization` | This server's occupied-slot fraction over the arrival window, from 0 to 1; multiply by 100 for percent. Draining beyond the window is excluded. |

Global metrics and configuration repeat in every server row. **Do not sum the
repeated outcome counts across rows.** Only `server_id` and `slot_utilization`
vary between rows for a single run. Missing latency for no completions is an
empty CSV cell, not zero. Counts and utilization remain zero for an empty run.
Floats are serialized without the rounding used in the UI.

The ID is a deterministic SHA-256 hash of the schema version, configuration and
exported metrics, using sorted-key JSON. Identical configuration and metrics
produce the same ID even across separate executions. It is a content fingerprint,
not a unique execution timestamp, source revision or authentication signature.
The downloaded bytes are deterministic for an identical run on the same code.

These exports contain configuration and summary/per-server metrics. They do not
include individual requests, response-time samples or the playback event log.
Configuration replay and saved-result comparison are described below. Migration
between schema versions is not implemented. Reproducing a configuration requires
the same simulation model/code and dependencies; the JSON does not bundle them.

### Real-run example and reproduction

From the repository root after `uv sync --locked`:

```sh
uv run python experiments/export_run.py --output experiments/results/d3-03-rerun
```

The command runs a real simulation, then writes `config.json` and `results.csv`
to the chosen directory (overwriting those filenames if they already exist).
It normally finishes in seconds. Use the separate rerun directory to preserve
the checked-in [configuration](../experiments/results/d3-03/config.json) and
[results](../experiments/results/d3-03/results.csv).

The example uses one server, one slot, one waiting place, 4 requests/s for one
second, fixed one-second service, seed 42 and round-robin routing. Expected
results: four generated, two completed, two rejected, mean response 1.375 seconds,
p95 1.75 seconds and utilization 1.0. The final completion is at two simulated
seconds; draining is included in latency but not utilization. The exported config
can be passed to `run_simulation` through the Python API or uploaded using the
verified replay control below.

The existing unit-test command checks export values, JSON configuration
reproduction, unrounded metrics, empty/idle servers, deterministic serialization,
and that the UI exports completed settings rather than unsubmitted edits:

```sh
uv run python -m unittest discover -s tests -v
```

### Replay an exported configuration (D3-04)

1. In the Next.js Lab, select **Single server pool** on **Setup**. Open
   **Replay a saved run** under **Saved run tools** and upload the original
   configuration JSON from D3-03.
2. Inspect the displayed settings, including policy and seed. They are independent
   of the editable simulation form; loading a file does not overwrite the form.
3. Select **Replay saved configuration**. The simulator regenerates the run using
   those settings, then recomputes its export fingerprint.
4. A success message confirms that the regenerated configuration and all exported
   metrics match the saved ID. Only then does the replay replace active results
   and reset playback to paused at time zero. The new event log supports all
   normal charts, playback controls and downloads.

The comparison covers outcome counts, mean/p95 response times and every server's
utilization through the shared fingerprint. The original file did not store
events or individual response times, so a file alone cannot prove those original
details. The automated examples/tests additionally compare complete original and
replayed summaries, including events, when both are available.

Malformed JSON, unsupported versions, duplicate fields, missing/extra settings,
invalid numbers/policies, and invalid IDs produce explicit errors. An otherwise
valid edited configuration, or a run from a changed simulation model, can fail
the fingerprint check. Failed imports/replays leave the previous successful
active run intact. A file's ID is not an authentication signature; this checks
consistency with the saved export, not a trusted author or source revision.

### Compare two saved result sets (D3-05)

Open **Compare saved results** in the same **Saved run tools** card and upload an original
results CSV into each of **Run A** and **Run B**. An active simulation and the
configuration JSON files are not required. Comparison uses the configurations
already repeated in each CSV and does not run a simulation or replace active
results. Uploading only one file shows a prompt rather than a partial comparison.

The two panels show policy, full run ID, generated/completed/rejected counts,
mean and p95 response times in seconds, rejection rate, mean server slot
utilization, and a per-server utilization table. A shared table displays all nine
configuration settings. Differences in any setting other than policy produce a
warning, because workload or capacity changes also affect the metrics. If only
policy differs, the UI reports that workload/capacity settings match; this is not
a claim about source-code versions, identical trace bytes, or a universal winner.

Whole-run counts repeat in the CSV rows and are read once, never summed across
servers. Rejection rate is `rejected / (completed + rejected)`. Mean server
utilization is the average of the exported server fractions, including idle
servers. Each run has identical per-server capacity internally. Empty runs show
N/A latency and rejection rate, with zero utilization; no completions produces
N/A latency. Tables retain server values even if server counts differ.

CSV loading checks the expected columns, version, numeric types/ranges, consistent
configuration/global metrics in every row, count conservation, generated workload
size, one row per unique configured server, and the complete export fingerprint.
Missing, mixed or edited rows are rejected. Invalidating or removing either file
removes the comparison instead of retaining stale metrics. Both JSON and CSV must
use UTF-8 (an optional BOM is accepted) and be at most 5 MiB each. Comparisons and
uploads remain session-local; there is no server-side saved-run library.

### Reproduce replay and comparison evidence

```sh
uv run python experiments/replay_compare.py --output experiments/results/d3-04-05-rerun
```

From the repository root, this takes seconds and exports two real runs into
`run-a` and `run-b`, verifies full original/replayed summaries, reloads their CSVs,
and writes `verification.json`. It overwrites those filenames in the chosen
directory; the separate rerun path preserves the reference evidence.

Both use two servers, one slot and one waiting place each, 8 requests/s for two
seconds, uniform service times from 0.25 to 1 second and seed 42. Only policy
changes. The expected saved results are:

| Metric | Run A: round-robin | Run B: least-active-requests |
| --- | ---: | ---: |
| Generated | 16 | 16 |
| Completed | 9 | 7 |
| Rejected | 7 | 9 |
| Mean response (s, rounded) | 0.845 | 0.856 |
| p95 response (s, rounded) | 1.355 | 1.355 |
| Rejection rate | 43.75% | 56.25% |
| Mean server utilization (rounded) | 96.875% | 92.403% |

Reference files: [Run A JSON](../experiments/results/d3-04-05/run-a/config.json),
[Run A CSV](../experiments/results/d3-04-05/run-a/results.csv),
[Run B JSON](../experiments/results/d3-04-05/run-b/config.json),
[Run B CSV](../experiments/results/d3-04-05/run-b/results.csv), and
[verification report](../experiments/results/d3-04-05/verification.json).
Use those CSVs in the comparison panel and either JSON in replay. This single
example demonstrates functionality, not the multi-workload/three-seed policy
study in D3-02; least-active routing counts running work only and may target a
full queue when running counts tie.

## Live sessions in the Next.js lab — A-10

The lab connects to the A-08 continuous API through same-origin Next.js routes.
The Python worker owns the simulation clock; browser polling only reads bounded
snapshots. The one-shot Run path and recorded playback remain separate.

Start the Lab using the [quick start](../README.md#quick-start).
`LBSIM_API_URL` is server-side and defaults to `http://127.0.0.1:8000`.

### Controls

- Configure topology, workload, policy and execution on the dedicated Setup page.
  Regions and single pools support both one-shot and continuous execution.
- Start continuous simulation opens Lab, where Pause/Resume, Stop, traffic and
  Drain affect the active worker. Speed and Restart session live under Session
  options. Restart uses the active configuration.
- Edit configuration returns to Setup without stopping the session. Draft edits
  affect the next run. Replace continuous session starts a worker from the draft
  and retires the current worker after the replacement is ready.

Editable settings are distinct from the active configuration shown below the
live view. Setup edits do not silently reconfigure an existing worker. Browser
library saves preserve the configuration, seed, and execution mode. Live
workers and their telemetry are temporary.

### Reconnection and lifecycle

The opaque active ID is stored under the versioned per-tab sessionStorage key
`lbsim.active-session.v1`. Reloading the lab reconnects to it and selects
Continuous. If no template/save/draft is being loaded, its active configuration
also restores the setup form. A new successful session opens Lab on desktop and mobile. Setup and Lab share
workspace state, so navigating between them preserves the current results.

Leaving the workspace cancels polling but does not delete a worker. The API continues
until explicit Stop, idle/absolute expiry, process restart, or failure. API
session IDs identify temporary state and are not user authentication.

Not-found, expired and failed sessions detach, clear the stored ID, stop polling,
and leave a labeled last snapshot. A new session can be started. Transient API
errors retain the last snapshot and retry reads. Command errors remain visible
until another action rather than disappearing on the next successful poll.

### Transport and telemetry

`/api/sessions` handles creation; its bounded catch-all route exposes only the
UUID-scoped snapshot, commands and delete paths. It uses the configured Python
base URL, strict path/query allowlists, a 64 KiB streamed body bound, no-store
responses, a deadline and cancellation. Existing one-shot proxy behavior is
preserved through the shared `proxyPython` transport.

`useLiveSession` schedules another poll 500 ms after the preceding read finishes.
Only one poll is outstanding. Commands suspend polling and abort outstanding
reads. Request generations and session/revision checks ignore stale responses.
Page changes abort old reads; commands refresh the selected server page. No
browser request advances the simulation clock.

Snapshot validation checks identity, conservation, finite metrics, server/page
state, window and array bounds. At most 32 servers, 120 historical points and
20 histogram bins are requested/displayed. Recent p95 uses the API's explicitly
bounded response window; mean response/utilization cover the session lifetime.
There is no synthetic finite total or "not arrived" count for a continuous run.

The view composes shadcn controls/cards/charts with RackView, TaskPool and
ServerInspector. Live server details use live time and session-average labels.
Stopped/expired data is labeled as a last retained snapshot.

### Verification

```sh
cd src/frontend
npm run build
npm run test:api
npm run test:live
PLAYWRIGHT_CHANNEL=chrome npm test
```

Node tests cover proxy method/path/query mapping, body bounds, backend errors,
deadlines, snapshot bounds/identity and terminal errors. Browser tests cover a
real 40-server session, independent clock progress, pause/reload reconnection,
restored settings, speed/traffic changes, complete draining, pagination and
stop; delayed polling and stale responses; expiry with polling cancellation;
and mobile start/mode switching. Test-created sessions are deleted afterward.

Regional browser tests also cover preset selection, source/RTT/compute edits,
fully drained one-shot results, validation errors preserving prior results,
continuous reconnect, active versus draft settings, restart, topology cleanup
and mobile overflow. The [experiments](design-document.md#4-running-the-experiments)
cover availability, regional outages, and scale.


### Regional extension

Regional one-shot and continuous execution now share the Lab topology/execution controls. See [regional-api.md](#regional-api-and-frontend) for regional policies, preset/RTT settings, pooled-capacity assumptions, bounds and scope. Regional saves and exports remain unavailable pending a versioned schema. Compare captures regional configurations into fresh bounded cases while preserving the live session.
