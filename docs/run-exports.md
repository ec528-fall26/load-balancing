# Saved runs: export, verified replay and comparison (D3-03/04/05)

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
Configuration replay and saved-result comparison are described below. Migration
between schema versions is not implemented. Reproducing a configuration requires
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
can be passed to `run_simulation` through the Python API or uploaded using the
verified replay control below.

The existing unit-test command checks export values, JSON configuration
reproduction, unrounded metrics, empty/idle servers, deterministic serialization,
and that the UI exports completed settings rather than unsubmitted edits:

```sh
uv run python -m unittest discover -s tests -v
```

## Replay an exported configuration (D3-04)

1. In the sidebar, open **Replay a saved run** and upload the original
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

## Compare two saved result sets (D3-05)

Open **Compare saved results** beneath the main results and upload an original
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

## Reproduce replay and comparison evidence

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
