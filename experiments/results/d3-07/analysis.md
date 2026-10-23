# D3-07: consume arrivals with a deque

Measured locally October 22, 2026. Before evidence is preserved in ../d3-06/.

## Change

Only the pre-generated arrival container changes: list → collections.deque, and requests.pop(0) → requests.popleft(). This removes repeated shifting of all remaining arrivals. Workload generation, pending-completion sorting, routing, admission and event ordering are unchanged.

## Measured results

Three unprofiled fresh-process timings per case, same machine/configuration/Python as D3-06. Captures are sequential before/after batches, not randomized/interleaved trials. Short-run results are sensitive to scheduling and background load; they are not general performance guarantees.

| Requests | Servers | Before median (s) | After median (s) | Speedup |
| ---: | ---: | ---: | ---: | ---: |
| 10,000 | 10 | 0.0238 | 0.0186 | 1.28× |
| 10,000 | 100 | 0.0389 | 0.0343 | 1.14× |
| 10,000 | 1,000 | 0.0394 | 0.0351 | 1.12× |
| 100,000 | 10 | 0.8649 | 0.2007 | 4.31× |
| 100,000 | 100 | 1.0304 | 0.3636 | 2.83× |
| 100,000 | 1,000 | 1.0615 | 0.3846 | 2.76× |

## Correctness

- Every case has an identical full-summary SHA-256 before and after: metrics, response-time lists and every event match. Counts and event totals also match explicitly.
- All 24 after-change timed/profiled runs pass conservation, draining and replay checks.
- All 39 existing tests pass, covering both policies, exact traces, overflow and UI switching.
- An additional direct comparison against the engine source at 2ae52ee checks raw executions, rejected IDs and events for 12 cases across round-robin and least-active, including empty, single-server, zero-queue, multi-slot, varied-service and larger-fleet runs.
- The remaining completion-list pop and sort are intentionally unchanged. This task does not optimize least-active selection or add continuous execution.

## Reproduce

```sh
PYTHONPATH=src uv run python experiments/profile_engine.py --output experiments/results/d3-07-rerun
PYTHONPATH=src uv run python experiments/compare_profiles.py experiments/results/d3-06/report.json experiments/results/d3-07-rerun/report.json --output experiments/results/d3-07-rerun/comparison.json
PYTHONPATH=src uv run python -m unittest discover -s tests
```

The comparison command rejects mismatched environments, configurations or outputs. It compares unprofiled medians only; profiler timings are not used as a speedup estimate. report.json records exact source hashes because the engine change is currently uncommitted. Raw profiles remain available for inspection.

## Conclusion

The proposed deque change improves all six measured medians, with the larger request traces improving 2.76–4.31× in this run. Removing front-of-list shifts explains why the benefit grows with request count. The measurements do not prove an overall linear complexity bound: completion sorting, metrics and full-trace storage remain. No memory reduction or policy-superiority claim is made.
