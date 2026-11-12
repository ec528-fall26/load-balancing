# Bounded one-shot responses and recorded playback

The Next.js Run action now uses `POST /v1/runs` rather than the full-trace legacy response. It returns exact engine metrics, a whole-run histogram of at most 20 bins, per-server utilization (at most 1,000 servers), an opaque `run_id` and recording metadata. `events` and `response_times` are empty compatibility arrays; they do not mean the simulation had no events or completions. `event_count` and `end_time` describe the recording. Mean and p95 remain the exact whole-run completed-request metrics.

`POST /v1/run` retains the original complete response for existing clients. Regional one-shot execution already returns bounded telemetry through `/v1/regions/run`; its p95 remains recent-window, not whole-run. Neither legacy schema is silently reinterpreted.

## Operations

- `POST /v1/runs` — same validated single-pool config body as `/v1/run`; returns `201` with the compact result. Uses the same one-run admission gate, request/runtime limits and isolated worker.
- `GET /v1/runs/{run_id}` — retrieve the immutable compact result.
- `GET /v1/runs/{run_id}/events?offset=0&limit=500` — at most 1,000 events per page, ordered by immutable zero-based sequence. Each item contains `sequence` and the original event tuple. `next_offset` is null at the end. Equal timestamps retain the original engine order. Paging does not rerun the simulation.
- `GET /v1/runs/{run_id}/snapshot?time=1.25&server_offset=0&server_limit=32` — inclusive state after all events at or before the requested time. Time is capped at the recording end. Returns global request totals, idle count, latest event and at most 64 server rows. Exact floating-point timestamps are passed without decimal truncation.
- `DELETE /v1/runs/{run_id}` — delete this recording and its trace file.

Unknown/deleted recordings return `404 RUN_NOT_FOUND`. Expired or evicted recordings return `410 RUN_EXPIRED` while their bounded tombstone remains. Cache loss on API restart also returns 404. The frontend keeps completed summary metrics visible and asks users to rerun when playback expires.

## Retention

Recordings are temporary process-owned data, not user database saves. Event rows are stored in an indexed SQLite file in a private temporary directory. The browser and retained result metadata do not hold full traces. Prefix totals are recorded alongside stable event sequence numbers; server snapshots use indexed per-server lookups rather than transferring/replaying every preceding event in JavaScript.

Defaults: at most four retained runs, a 64 MiB retained-file budget and ten minutes of absolute retention from creation. Reads do not renew retention. Creating a new recording may evict the oldest recording, including a recording currently being viewed. `playback.expires_in_seconds` describes the advertised creation-time retention limit, not a renewed lease. A periodic sweeper removes expired files; shutdown deletes the temporary directory. The quota applies to retained files; creation also needs a staging file and the existing bounded engine result in memory before registration. Generation remains capped at 100,000 requests/200,000 events.

This reduces transfer and retained trace memory; it does not eliminate transient engine/IPC allocation. The cache is not durable across API restarts and is not authentication or a replacement for A-17 account/database persistence.

## Frontend

`/api/engine/run` now proxies the bounded endpoint and preserves its 201 status. `/api/runs/...` whitelists recording reads/deletes and numeric queries through the existing same-origin transport. The original `proxyRun` helper remains available for the legacy endpoint.

Overview consumes server-supplied histogram bins. Datacenter playback requests one server page at the selected time, with sequential reads no more often than every 250 ms after a completed read. Seeks/page changes cancel obsolete requests, and expired recordings stop retrying. The displayed state timestamp reflects the returned snapshot. The seek slider snaps its final half-step to the exact end to avoid leaving the last completion behind due to step rounding.

The regional preset **Scale · 1,000 servers / 12 datacenters** exposes the supported size limit in the UI: 4,000 slots, mixed compute and illustrative client RTTs up to 450 ms. Larger topology requests are rejected explicitly; limits were not raised.

## Evidence

See `experiments/results/a-11/pagination-scale.json`, `pagination-before-batch.json` and the browser captures. The worker event-count ceiling was increased from 2,000 to 20,000 events per tick while retaining the 10 ms processing-time budget. The old event cap throttled high offered rates before the CPU budget was used. Very high rates can still lag under that CPU budget; reported lag is not hidden or treated as dropped/rejected work. Controls apply at processed simulation time, matching the existing session contract.

## Compare and saved files

The Compare page sends each single-pool case to `POST /v1/run-summary`. It
returns the exact summary metrics without creating a recording or returning
the event trace.

For a recorded simple single-pool run, **Download run** exports the version-one
JSON configuration and CSV results. **Replay a saved run** verifies the
configuration against its saved results fingerprint before creating new
playback. **Compare saved results** verifies both CSV files without rerunning
either case. Version one supports uniform processing rates and the simple
request model.
