# Regional API and frontend

Topology and execution are independent: the Lab supports single-pool or regional topology with either one-shot or continuous execution. Single-pool behavior and exports retain their existing schema. Regional configurations use a separate `topology: "regions"` contract.

## Model

Each region is an aggregate FIFO compute pool. `servers × slots_per_server` sets pooled concurrent capacity; `servers × queue_per_server` sets pooled waiting capacity. Sampled service time is divided by `compute`. CPU occupancy is occupied slots / slots, not measured CPU usage. Load averages are exponentially weighted executing-plus-waiting demand at 60/300/900 seconds, initialized at zero. No per-server placement or failure behavior is implied.

The directed `latency_ms` matrix describes illustrative regional RTT assumptions. Selecting a source region copies its row into `client_latency_ms`. The explicit client RTT vector is authoritative for request travel and can be edited independently. Each request travels half of that RTT to its target, then waits/computes, then travels half back. The matrix does not introduce additional inter-region hops or downstream calls. Telemetry is immediate, without network reporting delay.

Regional policies are separate from individual-server least-active:

- `round_robin`: alternate regional targets.
- `nearest`: minimum client RTT, ties by region index.
- `least_loaded`: minimum `(running + waiting + outbound) / slots`, then client RTT, then region index. Outbound requests are counted before they arrive at the target. Returning responses no longer consume compute slots.
- `nearest_under_load`: the nearest region (client RTT, then region index) whose load, as defined for `least_loaded`, is below 0.9. If every region is at or above 0.9, it chooses like `least_loaded`. Light traffic stays local; heavier traffic spills to the next-nearest regions instead of overloading the nearest one.

A full target rejects at dispatch with no retry. Rejection accounting is immediate at dispatch; rejected requests do not incur an additional return event. Latency metrics cover successful completed responses only. Same-time completions free slots before dispatch; stable sequence numbers order other ties.

## Endpoints

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

## Telemetry and UI

Snapshots include total offered/completed/rejected/running/waiting/in-transit counts and at most 12 region rows. Conservation is `offered = completed + rejected + running + waiting + in_transit`; in transit includes outbound and returning accepted responses. Region rows expose slots/free slots, current occupancy, queues, outbound travel, compute, client RTT, load averages, completion/rejection counts and a regional recent-window p95.

The lifetime mean uses all completions. Global and regional p95 use their respective latest 2,000 completions. Global histogram bins are at most 20; history retains at most 240 samples. Continuous queries default to 120 history samples. No full request trace is retained or transferred. One-shot history is also a bounded tail, not a complete replay.

On Setup choose **Topology → Regions**, load a preset, edit capacities/compute and source/client/matrix RTTs, then independently select **Execution → One-shot / Continuous**. Regional cards show current capacity separately from task outcomes. Continuous controls, non-overlapping polling, stale-revision rejection and reconnect reuse A-10. Setup edits affect the next start; Lab live controls affect the active session. Draft topology/execution changes leave the active worker running. Starting a replacement continuous session explicitly stops the old worker first.

Regional browser saves, replay and CSV exports remain unavailable pending a versioned regional export schema. Lab-to-Compare transfer now supports regional configurations for bounded baseline/variant runs; this does not introduce a saved regional-results schema. No database persistence, failure injection, retries or cloud deployment is added here. Broad scale measurements remain A-11.

Launch the two processes using [live-frontend.md](live-frontend.md). Existing Streamlit code and the original uncommitted local prototypes are preserved.


## Local verification — November 2

The production frontend build and TypeScript pass; 98 Python tests and 12 Node API/client tests pass. All 23 browser tests cover the existing single-pool/library/comparison flows plus regional one-shot, regional continuous reconnect/control/drain/restart and desktop/mobile behavior. The three regional tests were repeated after the final editor-height adjustment, including an expanded-content visibility assertion. Original prototype tests were ported to the new regional engine; API tests exercise normalization, malformed inputs, seeded parity, travel, capacity, conservation, shared session admission and progress without browser reads. Broad scale benchmarks are not claimed.

### Manual datacenter outages

In a continuous regional run, use **Take offline** or **Restore** on a
datacenter card. The session API accepts `fail_region` and `restore_region`
with the zero-based index in `value`. Commands take effect at the worker's
current simulation time and can be issued while paused.

Taking a region offline rejects its running, queued, and outbound requests.
Responses already returning to clients still arrive. Every regional policy
selects from healthy regions. If all regions are offline, new requests count
as rejected without a destination. Restoring a region makes its slots
available for new work. Rejected requests are never retried automatically.
