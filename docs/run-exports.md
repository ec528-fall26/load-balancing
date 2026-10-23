# Run exports (D3-03)

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

## Configuration JSON, schema version 1

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

## Results CSV, schema version 1

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
General file import, UI replay from a file, side-by-side comparison and migration
between schema versions are outside D3-03. Reproducing a configuration requires
the same simulation model/code and dependencies; the JSON does not bundle them.

## Real-run example and reproduction

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
can already be passed to `run_simulation` through the Python API; there is no
file-upload control in this task.

The existing unit-test command checks export values, JSON configuration
reproduction, unrounded metrics, empty/idle servers, deterministic serialization,
and that the UI exports completed settings rather than unsubmitted edits:

```sh
uv run python -m unittest discover -s tests -v
```
