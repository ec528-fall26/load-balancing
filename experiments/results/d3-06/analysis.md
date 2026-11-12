# D3-06: engine profiling

Recorded October 22, 2026. Local round-robin profiling on arm64.

## Measurement

- Code revision: `2ae52ee6d3177bf7ae024ec54a0c34304c0fba71`; exact measured source hashes are in report.json.
- Each case: three unprofiled runs and one cProfile run, each in a fresh process.
- Same 100 requests/s, seed 42, service 0.1–1.0 seconds, one slot and ten waiting places.
- 100,000 requests extends the arrival window to 1,000 seconds; it does not increase traffic rate.
- Complete-summary fingerprints match between profiled and all unprofiled runs; all 24 runs conserve requests and drain.
- No runtime code was changed during profiling.

## Results

| Requests | Servers | Unprofiled median (s) | Profiled total (s) | List pop self time (s) | Share of profiled time |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 10 | 0.0238 | 0.0716 | 0.0052 | 7.2% |
| 10,000 | 100 | 0.0389 | 0.1048 | 0.0059 | 5.6% |
| 10,000 | 1,000 | 0.0394 | 0.1090 | 0.0060 | 5.5% |
| 100,000 | 10 | 0.8649 | 1.3411 | 0.6379 | 47.6% |
| 100,000 | 100 | 1.0304 | 1.7815 | 0.6645 | 37.3% |
| 100,000 | 1,000 | 1.0615 | 1.7548 | 0.6531 | 37.2% |

## Finding and limits

At 100 servers, 10× more requests takes 26.5× the unprofiled time. List pop becomes the largest individual self-time entry in all three 100,000-request captures. The engine removes the next arrival with requests.pop(0), shifting the remaining list on every arrival: consuming N requests this way performs quadratic total element movement.

cProfile combines both list-pop call sites: arrival removal and pending-completion removal. It does not isolate the arrival pop directly. The growing arrival list is the narrow candidate suggested by the scaling and source inspection; the before/after experiment must establish the actual benefit. Pending completions are also repeatedly sorted, but their population is smaller in this fixed-rate workload.

Profiling adds overhead; the profiled share is not a predicted percentage speedup. Function cumulative times overlap. These short, local runs vary with background load and do not establish a universal scalability bound. Only round-robin is profiled here; least-active selection has separate fleet-size costs and is not evaluated by these results.

## D3-07: proposed single improvement

1. Keep generating the entire seeded workload before routing, but store pending arrivals in collections.deque.
2. Replace only requests.pop(0) with requests.popleft(); keep requests[0], round-robin selection, pending-completion sorting, FIFO queues and tie ordering unchanged.
3. Retain these before-change files and rerun the same command into a different output directory on the same machine.
4. Require identical complete-summary SHA-256 values, counts and event totals for every matching case; report all per-case medians and ratios, including regressions or no improvement.
5. Run all 39 tests, including both-policy correctness checks, exact event traces and policy switching. Add a focused regression only if the change exposes an uncovered boundary.
6. Compare both policies on matching seeded workloads for correctness, without turning this task into D3-02 policy-performance claims.

Expected effect: remove quadratic arrival-list shifting. No claim of achieved speedup until D3-07 is implemented and measured. Memory still holds the whole trace/event log; this is not a streaming or bounded-memory design.

## Reproduce

```sh
PYTHONPATH=src uv run python experiments/profile_engine.py --output experiments/results/d3-06-rerun
```

report.json contains raw timing samples, exact configs, fingerprints, environment details and function statistics. The six .prof files can be opened with python -m pstats. See experiments/README.md for timing scope and commands.
