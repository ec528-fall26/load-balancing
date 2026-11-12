# A-24: CPU/I/O routing comparison

Three seeds per row. Values average per-run metrics; p95 is the mean of three run p95s, not a pooled percentile.

| Profile | Req/s | Policy | Rejected % | Mean response ms | p95 ms | CPU % | Mean outstanding/server |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| cpu_heavy | 40 | round_robin | 0.00 | 99.6 | 117.8 | 44.6 | 0.50 |
| cpu_heavy | 40 | least_active_requests | 0.00 | 115.5 | 147.8 | 44.6 | 0.58 |
| cpu_heavy | 40 | power_of_two | 0.00 | 112.4 | 157.7 | 44.6 | 0.56 |
| cpu_heavy | 100 | round_robin | 7.27 | 566.4 | 717.9 | 99.4 | 6.35 |
| cpu_heavy | 100 | least_active_requests | 18.13 | 207.0 | 706.2 | 90.9 | 2.08 |
| cpu_heavy | 100 | power_of_two | 11.17 | 441.4 | 686.8 | 96.7 | 4.78 |
| cpu_heavy | 400 | round_robin | 76.70 | 690.9 | 751.6 | 99.9 | 7.83 |
| cpu_heavy | 400 | least_active_requests | 77.84 | 211.3 | 719.5 | 98.4 | 2.29 |
| cpu_heavy | 400 | power_of_two | 76.73 | 683.8 | 747.5 | 99.9 | 7.71 |
| io_heavy | 40 | round_robin | 0.00 | 99.6 | 117.8 | 5.0 | 0.50 |
| io_heavy | 40 | least_active_requests | 0.00 | 100.4 | 118.0 | 5.0 | 0.50 |
| io_heavy | 40 | power_of_two | 0.00 | 99.7 | 117.8 | 5.0 | 0.50 |
| io_heavy | 100 | round_robin | 0.00 | 100.5 | 118.2 | 12.4 | 1.25 |
| io_heavy | 100 | least_active_requests | 2.67 | 101.2 | 120.2 | 12.1 | 1.23 |
| io_heavy | 100 | power_of_two | 0.00 | 100.2 | 118.2 | 12.4 | 1.25 |
| io_heavy | 400 | round_robin | 0.00 | 101.8 | 119.0 | 49.7 | 5.07 |
| io_heavy | 400 | least_active_requests | 30.31 | 101.5 | 119.3 | 34.6 | 3.52 |
| io_heavy | 400 | power_of_two | 3.38 | 101.9 | 119.9 | 48.1 | 4.90 |
| mixed | 40 | round_robin | 0.00 | 99.6 | 117.8 | 24.6 | 0.50 |
| mixed | 40 | least_active_requests | 0.00 | 112.6 | 150.3 | 24.5 | 0.56 |
| mixed | 40 | power_of_two | 0.00 | 104.7 | 137.8 | 24.5 | 0.52 |
| mixed | 100 | round_robin | 0.00 | 121.6 | 177.1 | 61.9 | 1.51 |
| mixed | 100 | least_active_requests | 0.20 | 119.4 | 163.8 | 61.8 | 1.48 |
| mixed | 100 | power_of_two | 0.00 | 130.8 | 209.8 | 61.9 | 1.63 |
| mixed | 400 | round_robin | 58.43 | 372.3 | 533.7 | 99.6 | 7.59 |
| mixed | 400 | least_active_requests | 61.13 | 167.4 | 402.4 | 96.8 | 3.22 |
| mixed | 400 | power_of_two | 59.04 | 365.7 | 522.9 | 99.6 | 7.35 |

## Model and limits

Eight servers, one CPU slot and eight outstanding requests per server; ten-second arrival window. Evenly spaced traffic; total no-contention service sampled uniformly from 80–120 ms. CPU-heavy uses 90% CPU/10% I/O; I/O-heavy uses 10% CPU/90% I/O. The mixed trace independently samples a 50/50 request type with Random(2000000 + seed), avoiding a periodic type pattern aligned with round robin. CPU work is split equally before/after I/O. Each profile/rate/seed trace is generated once and supplied unchanged to all policies.

All policies choose using CPU-active counts (round robin ignores load). Least-active examines all servers with lowest-ID ties. Power-of-two samples two distinct servers, selects the lower CPU-active count and chooses the first sampled on a tie. Routing uses an independent Random(1000000 + seed); workload generation uses Random(seed). This is a specified P2C variant, not an exact implementation of a particular proxy.

I/O delay releases CPU but retains the outstanding admission slot. I/O has no capacity limit or shared downstream contention. CPU1 and returning CPU2 share a non-preemptive FIFO. A full outstanding cap rejects without retry. CPU completion precedes I/O completion, then arrivals; same-kind ties use insertion order. Accepted work fully drains.

CPU occupancy and mean outstanding are integrated over the arrival window only. Latency includes draining and excludes rejected work. Rejection, latency, occupancy and outstanding work must be read together. These simulated seconds are not Python runtime measurements or real CPU utilization.

81 paired runs on 27 exact shared traces, each replayed once with exact full-result equality. Per-event assertions check request conservation, CPU bounds, outstanding caps and CPU + I/O + ready-queue accounting. Three seeds do not establish a general policy ranking; regular arrivals, fixed per-type stage proportions and an unbounded I/O resource limit realism. No faults, fan-out, retries, delayed telemetry, cloud deployment, CPU-sharing scheduler or UI integration.

## Reproduce

```sh
uv sync --locked
PYTHONPATH=src uv run python experiments/compare_cpu_io.py --output experiments/results/a-24-rerun
PYTHONPATH=src uv run python -m unittest discover -s tests -q
```

The experiment takes seconds locally, writes 81 rows to samples.csv, 27 input traces to traces.json and source/configuration/result fingerprints to report.json, plus this table. Use a different output directory to preserve evidence. No cloud or GPU is needed. Exact trace/result fields should match; machine metadata can differ.
