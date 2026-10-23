# D3-02: routing-policy comparison

Prepared October 22, 2026. Code revision: `df17c613782f22ceb3d6b88f7fccd36f3fe9737c`.

## Experiment

- Fleet: 10 identical servers, one running slot and 10 waiting places per server.
- Workload: evenly spaced arrivals over 100 seconds; uniform service durations 0.1–1.0 seconds.
- Expected service duration is 0.55 seconds. Nominal fleet capacity is 10 / 0.55 = 18.1818 requests/s. This is a workload-based reference, not a measured SLA or a guarantee of no rejections.
- Scenarios: 50% nominal load (9.0909 req/s), 90% (16.3636), 120% (21.8182), and a 20% increase over the 90% case (19.6364 req/s, or 108% of nominal capacity).
- Seeds 42, 43 and 44; each scenario/seed has one trace shared exactly by both policies. Total: 12 traces, 24 policy runs, and 24 independent public-API replays.
- Both policies see the same arrival and service durations, including rejected requests. The observed generator output is checked against the saved reference, not assumed equal from matching seed labels.
- Policy selection is validated against current server state before each admission. Checks also cover event order, capacity, overflow, request conservation, FIFO and full draining.

## Results across three seeds

Each value is the arithmetic mean of the three per-seed metrics. Rejection ranges and p95 ranges show the minimum/maximum across seeds, not confidence intervals. Mean response standard deviation is the sample standard deviation of seed means. The p95 column averages three per-run p95 values; it is not a pooled percentile.

| Scenario | Policy | Rejected %, mean [range] | Mean response s, mean ± SD | Per-run p95 s, mean [range] | Mean utilization % |
| --- | --- | ---: | ---: | ---: | ---: |
| low | round_robin | 0.00 [0.00–0.00] | 0.546 ± 0.010 | 0.953 [0.947–0.962] | 49.45 |
| low | least_active_requests | 0.00 [0.00–0.00] | 0.546 ± 0.010 | 0.953 [0.947–0.962] | 49.45 |
| near_capacity | round_robin | 0.00 [0.00–0.00] | 0.952 ± 0.042 | 2.126 [2.023–2.237] | 88.97 |
| near_capacity | least_active_requests | 2.91 [2.69–3.36] | 1.048 ± 0.015 | 5.235 [5.137–5.291] | 86.23 |
| overload | round_robin | 12.21 [11.55–13.20] | 4.740 ± 0.141 | 6.912 [6.797–7.084] | 99.50 |
| overload | least_active_requests | 22.50 [21.50–23.89] | 1.135 ± 0.014 | 6.001 [5.924–6.059] | 92.23 |
| near_plus_20_percent | round_robin | 3.65 [3.06–4.58] | 3.720 ± 0.205 | 6.474 [6.385–6.615] | 98.88 |
| near_plus_20_percent | least_active_requests | 15.44 [14.42–16.40] | 1.124 ± 0.014 | 5.891 [5.771–5.962] | 90.54 |

## Interpretation

1. At low load both policies accept every request with no waiting and identical response metrics. Least-active spreads work less evenly: average across-seed population utilization SD is 0.3463, versus 0.0254 for round-robin. Lowest-ID idle ties concentrate work on the first servers; aggregate fleet utilization alone hides this.
2. At 90% nominal load round-robin rejects no requests. Least-active rejects 2.91% on average and has higher mean and per-run p95 response times. Its running-only signal ignores queues. With one slot per server, when all servers are busy every running count ties at 1, so server 0 receives additional queued work and overflow.
3. At overload, least-active rejects 22.50% versus 12.21% for round-robin, while mean response among completed requests is lower (1.135 versus 4.740 seconds). This is a latency/admission tradeoff: rejected requests are excluded from latency, so lower latency must not be presented as an overall win.
4. The +20% near-capacity case shows the same tradeoff: least-active rejects 15.44% versus 3.65%, with lower completed-request mean response (1.124 versus 3.720 seconds).
5. Every rejection in this dataset occurs while another server has waiting space, for both policies. Neither retries a different target. The least-active lowest-ID tie rule concentrates overflow; round-robin can also reject at its selected target without exhausting total fleet queue space.

## Limits and next questions

- Three seeds, one fleet size, one service distribution and regular arrivals are not a general ranking of routing policies.
- These are independent fixed-load runs. +20% traffic does not mean a mid-run spike, failure injection or continuous simulation.
- Latency includes waiting and draining for completed requests only. Rejection is reported separately. Utilization counts occupied slots during the arrival window, excluding draining; it is not CPU usage.
- The nominal capacity calculation does not account for routing imbalance, finite queues, sample variability or startup/drain effects.
- No routing behavior was changed to improve the experiment result. Counting queued work or rotating ties would be new policies requiring team agreement and separate comparisons.
- Per-seed metrics, configs, trace and summary hashes and all utilization values are saved. Sample ranges are descriptive, not statistical significance claims. No CPU runtime comparison is made.

## Reproduce and inspect

```sh
PYTHONPATH=src uv run python experiments/compare_policies.py --output experiments/results/d3-02-rerun
```

The run completes in a few seconds locally without cloud resources or GPU. Output:

- report.json: exact configuration for every policy run, seed, workload hash, full-summary hash, metrics, aggregates, code/source hashes and environment.
- samples.csv: 24 per-run metric rows, including rejection when another queue has room.
- server-utilization.csv: 240 per-server values for inspecting imbalance.
- traces/: 12 CSV workloads; actual requests generated by each policy must match these traces exactly.

A new output directory preserves the checked-in evidence. Trace hashes and simulation results should reproduce on the same engine revision. The timestamp/environment fields may change.
