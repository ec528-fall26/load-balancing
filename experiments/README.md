# Experiments

One script per claim. Each script should be runnable from the repository root,
print what it is measuring, and finish in a bounded amount of time.

Every script here must have a matching entry in
[`../docs/design-document.md`](../docs/design-document.md) stating what it
supports, how long it takes, and what output to expect.

## D2-13: first scale benchmark

From the repository root (PowerShell, Bash, or another terminal):

```sh
uv sync --locked
uv run python experiments/scale_benchmark.py --repeats 3 --output experiments/results/d2-13
```

The command overwrites that output directory's three generated files. Choose a
different `--output` directory to retain another run. Python 3.12 and the locked
dependencies are selected by the project. No extra benchmark dependencies are
needed. Run `uv run python -m unittest discover -s tests -v` for the existing
correctness suite.

### Workload and measurement

All cases use exactly 10,000 requests, 100 requests/s over a 100-second arrival
window, seed 42, uniform service durations from 0.1 to 1.0 seconds, one running
slot and ten waiting places per server. Only server count changes: 10, 100,
and 1,000. Arrivals are evenly spaced, as implemented by the current engine.

Each of the three samples per server count runs in a fresh Python subprocess.
`perf_counter` measures `run_simulation`, including configuration validation,
workload generation, round-robin routing, draining, event recording and metrics.
Process startup, imports, output writing, and post-run checks are excluded from
the timed interval. There is no warm-up run in that worker.

Peak memory is the OS process high-water mark, read immediately after the timed
run: Windows peak working set or Unix peak resident set (`ru_maxrss`, converted
to bytes). It includes the interpreter, imports, and simulation data; it is not
an incremental allocation measurement, system-wide RAM use, or virtual memory.
The summary uses the median of three runtimes and the maximum of three memory
peaks. These are short local runs; background load can noticeably affect them.

After taking measurements, each worker observes every request constructed by
the real generator, including rejected requests, and hashes the binary tuples
`(request_id, arrival_seconds, service_seconds)` using SHA-256. Every hash must
match the saved reference trace. Validation also requires identical seeded
replay, time-ordered events, bounded running/waiting counts, exactly 10,000
completed plus rejected requests, matching event/summary counts, and idle final
server states. Repeats must agree on counts, latency metrics and final event time.
Validation failures stop the command with a nonzero exit code.

### Saved evidence

Recorded locally on October 6, 2026, using Windows 11, AMD64 (32 logical CPUs),
Python 3.12.13 and Streamlit 1.65.0, against simulation commit `ecfedc5`:

| Servers | Median runtime (s) | Maximum peak process memory (MiB) | Completed | Rejected |
| --- | ---: | ---: | ---: | ---: |
| 10 | 0.0752 | 35.41 | 1,905 | 8,095 |
| 100 | 0.1351 | 37.79 | 10,000 | 0 |
| 1,000 | 0.1275 | 38.66 | 10,000 | 0 |

All nine samples passed validation and used the same workload hash. These
numbers describe this saved run; a rerun replaces the raw files, so update this
table if replacing the reference results.

- [Reference trace](results/d2-13/trace.csv): all 10,000 request IDs, arrivals, and service durations; decimal float values round-trip to Python floats.
- [Raw samples](results/d2-13/samples.csv): runtime seconds, peak process bytes, workload hash, outcomes, latency metrics, draining time, and validation status for each sample.
- [Run report](results/d2-13/report.json): command, UTC recording time, simulation source commit, benchmark/lockfile hashes, OS, CPU, logical CPU count, architecture, Python/Streamlit versions, configuration, and aggregate results.

The simulation commit identifies the code being measured; the benchmark script
is an accompanying local change identified by its own hash. The trace hash uses
packed numeric values, not CSV file bytes. Performance measurements need not
match exactly when reproducing the run. The trace and deterministic outcome
fields should match with the same configuration and locked environment.

This baseline changes both available capacity and server count. Ten servers
are overloaded; larger cases have more capacity and can accept more work.
It does not isolate the cost of adding servers, establish asymptotic complexity,
compare policies, or measure UI playback, network throughput, or cloud hardware.
The engine still sorts pending completions and removes the first item from
lists; selecting or implementing an optimization belongs to later profiling work.
