# A-02: routing policies on uniform and mixed-speed servers

Builds on A-01 (per-server processing rates). Simulation results are deterministic:
rerunning the command below on any machine gives the same numbers.

## Experiment

- Same base fleet and workload as D3-02: 10 servers, one running slot and 10 waiting
  places each, evenly spaced arrivals over 100 seconds, service work uniform 0.1–1.0
  seconds (at rate 1.0).
- Three fleets with the same total processing rate (10.0), so nominal capacity is
  18.18 requests/s for all of them and only the spread of speeds changes:
  - `uniform`: every server at rate 1.0.
  - `fast_low_ids`: servers 0–4 at 1.5, servers 5–9 at 0.5.
  - `fast_high_ids`: the same speeds with IDs reversed (0–4 at 0.5, 5–9 at 1.5).
    Included because least-active breaks ties by lowest server ID.
- Loads: 50%, 90% and 120% of nominal capacity. Seeds 42, 43 and 44.
- Each load/seed has one trace shared by all six fleet/policy runs: 9 traces, 54 runs.
  The checks reused from `compare_policies.py` confirm every run saw exactly that trace,
  and validate routing, capacity, FIFO order, draining and public-API replay.

## Results across three seeds

Means of per-seed values, with [min–max] across seeds. Rejected-with-space is the mean
number of rejections per run while another server still had waiting space.

| Load | Fleet | Policy | Rejected % | Mean response s | Per-run p95 s | Mean utilization % | Rejected with space |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 50% | uniform | round_robin | 0.00 | 0.546 [0.539–0.557] | 0.953 [0.947–0.962] | 49.4 | 0 |
| 50% | uniform | least_active | 0.00 | 0.546 [0.539–0.557] | 0.953 [0.947–0.962] | 49.4 | 0 |
| 50% | fast_low_ids | round_robin | 0.00 | 1.788 [1.569–1.905] | 6.475 [5.462–7.319] | 64.1 | 0 |
| 50% | fast_low_ids | least_active | 0.00 | 0.379 [0.369–0.392] | 0.646 [0.639–0.653] | 34.4 | 0 |
| 50% | fast_high_ids | round_robin | 0.04 [0.00–0.11] | 1.736 [1.293–2.321] | 6.171 [3.690–9.088] | 64.1 | 0 |
| 50% | fast_high_ids | least_active | 0.00 | 0.706 [0.701–0.714] | 1.780 [1.760–1.802] | 63.8 | 0 |
| 90% | uniform | round_robin | 0.00 | 0.952 [0.916–0.998] | 2.126 [2.023–2.237] | 89.0 | 0 |
| 90% | uniform | least_active | 2.91 [2.69–3.36] | 1.048 [1.035–1.065] | 5.235 [5.137–5.291] | 86.2 | 48 |
| 90% | fast_low_ids | round_robin | 19.27 [18.58–19.87] | 4.219 [4.179–4.274] | 13.484 [13.155–13.701] | 79.4 | 315 |
| 90% | fast_low_ids | least_active | 0.69 [0.31–1.41] | 0.831 [0.767–0.916] | 2.732 [2.062–3.267] | 87.1 | 11 |
| 90% | fast_high_ids | round_robin | 19.09 [18.46–20.05] | 4.241 [4.204–4.300] | 13.165 [12.774–13.505] | 79.8 | 312 |
| 90% | fast_high_ids | least_active | 7.89 [7.33–8.68] | 1.226 [1.204–1.249] | 9.527 [9.272–9.662] | 86.9 | 129 |
| 120% | uniform | round_robin | 12.21 [11.55–13.20] | 4.740 [4.604–4.886] | 6.912 [6.797–7.084] | 99.5 | 266 |
| 120% | uniform | least_active | 22.50 [21.50–23.89] | 1.135 [1.121–1.149] | 6.001 [5.924–6.059] | 92.2 | 491 |
| 120% | fast_low_ids | round_robin | 26.85 [26.50–27.24] | 3.756 [3.722–3.777] | 13.449 [13.354–13.607] | 89.4 | 586 |
| 120% | fast_low_ids | least_active | 21.64 [20.77–22.74] | 1.113 [1.099–1.130] | 4.093 [4.027–4.206] | 92.9 | 472 |
| 120% | fast_high_ids | round_robin | 26.62 [25.86–27.42] | 3.730 [3.667–3.781] | 13.244 [12.680–13.867] | 90.0 | 581 |
| 120% | fast_high_ids | least_active | 25.05 [24.48–26.00] | 1.210 [1.202–1.220] | 9.979 [9.712–10.488] | 92.0 | 546 |

The uniform rows match the saved D3-02 results, so adding processing rates did not
change the existing model.

## Interpretation

1. Round-robin ignores speed. It sends each server 1/10 of arrivals, so at 50% load each
   slow server receives about 0.91 requests/s with an average execution of 1.1 seconds:
   it is already fully busy while fast servers sit partly idle. Mean response rises from
   0.546 s (uniform) to about 1.7–1.8 s and per-run p95 to about 6.2–6.5 s, with the
   same total capacity. At 90% load the slow servers are overloaded and about 19% of
   requests are rejected, versus none for the uniform fleet.
2. Least-active never reads speed but adapts indirectly: fast servers finish sooner,
   show fewer running requests and are chosen more often. At 90% load (seed 42) fast
   servers completed 75% of requests with fast servers at low IDs and 69% with them at
   high IDs, versus 62% for round-robin.
3. Server ID order changes least-active's result. Ties go to the lowest ID. With fast
   servers at low IDs, ties also favor fast servers: 0.69% rejected at 90% load. With
   the same speeds reversed, ties favor slow servers: 7.89% rejected and per-run p95
   9.5 s instead of 2.7 s. Round-robin results barely change between the two orderings.
   Part of least-active's advantage in `fast_low_ids` therefore comes from the tie rule,
   not the policy, and both orderings must be reported.
4. At 50% load with fast servers at low IDs, least-active's latency is lower than the
   uniform fleet's (0.379 vs 0.546 s) because most work lands on rate-1.5 servers. This is
   a property of this fleet and tie rule, not evidence that mixed fleets are better.
5. At 120% load, as in D3-02, latency counts completed requests only. Least-active's lower
   latency comes with rejection rates of 21.6–25.1%, so compare both together.
6. Utilization is occupied slot time, not work done. Round-robin's mixed fleets show
   higher mean utilization at 50% load (64.1% vs 49.4%) because slow servers stay busy
   longer, not because more work is done. A fast server at 100% does three times the work
   of a slow one at 100%.

## Limits

- Three seeds, one speed mix (1.5/0.5), one fleet size, regular arrivals and one service
  distribution. Not a general ranking of policies.
- Neither policy uses speed. A speed-aware policy would be a new policy requiring team
  agreement and its own comparison.
- Mixed-rate runs cannot be exported or loaded in the UI yet (see A-01).

## Reproduce

```sh
PYTHONPATH=src uv run python experiments/compare_speeds.py --output experiments/results/a-02-rerun
```

Takes a few seconds and prints one line per run, a summary table and
`Validated 54 runs on 9 shared traces.` Files: `report.json` (configs, per-run metrics,
trace and summary hashes, source hashes) and `samples.csv`.
