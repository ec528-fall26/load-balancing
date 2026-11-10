# Fan-out and stragglers

Sharded service models a fixed amount of useful work per parent. The Lab runs
one, two, or four shard calls per parent in one-shot mode. Compare runs one
versus four calls on the same seeded workload, with and without either a CPU
slowdown or a shard outage.
The earlier A-04 probe increased work with fan-out and answers a different
workload question.

Each parent first queues for coordinator CPU. It sends one coalesced call or
two or four parallel calls, then releases the coordinator slot while waiting. Shard
placement rotates by parent ID so the one-shard case uses the same four-server
fleet. Every shard has a CPU slot, an I/O slot and an eight-request admission
limit. A shard call queues for CPU, releases it during I/O, then returns to the
CPU queue. The coordinator queues for CPU again after the last reply.

The configured round trip is divided between send and reply. A rejection
reaches the parent after the reply leg. A parent succeeds if its join finishes
at or before the deadline. Requests already sent continue to drain after parent
failure unless the shard itself goes offline. Consumed service is counted.
The model omits link contention, retry, replication and packet loss. The
slow condition multiplies CPU service time on the configured shard while
preserving its nominal demand and I/O time.

## Parallel and serial calls

Setup can send all required shard calls together or send them one at a time.
Both modes assign the same pieces to the same shards. Serial waits for a
successful reply before sending the next call and leaves later calls unsent
if the parent fails or reaches its deadline. Each sent call pays its own
network round trip. Other parents can still make progress while one waits.

Compare can isolate call order at two or four shards with the same workload,
CPU settings and deadline. If an outage is configured, each order runs once
with the outage and once with all shards online.

## Seeded outages

Set the outage duration to a value from 1 to 1,000 ms to take one shard offline
during the arrival window. Zero keeps all shards online. The seed chooses the
shard and start time independently of the workload. At the start of the outage,
the shard drops queued, executing and outbound calls to it. New calls to that
shard fail during the outage. Replies already sent can still arrive, and other
shards continue processing. The shard accepts new work at recovery. Work on
the interrupted CPU and I/O slots is counted only up to the interruption.

A parent records an outage failure if an outage error reaches it before a
different terminal outcome. The per-shard outage count includes affected calls
from parents that already timed out or failed elsewhere. Compare holds arrivals,
work, CPU slowdown and outage schedule fixed across the applicable cases. It
tests one and four calls per parent, each with and without the outage.

For example, at 50 parents/s over four seconds, seed 42 and normal CPU speed,
a 500 ms outage takes shard 0 offline around 3.238 s. Seven parents fail with
one required shard call and 25 fail with four required calls. Both no-outage
baselines complete all 200 parents.

## Reproduce

From the repository root with Python 3.12 and the locked environment:

```sh
uv sync --locked
PYTHONPATH=src uv run python experiments/compare_fanout_pipeline.py > /tmp/fanout-pipeline.json
PYTHONPATH=src uv run python -m unittest discover -s tests -p 'test_fanout_pipeline.py' -v
```

The experiment runs in seconds on a laptop. It needs no external services.
For the interactive view, start the existing Python API and Next.js frontend,
then choose Sharded service in Setup. Run the simulation to inspect outcomes,
shard queues and one parent's event timeline in the Lab. Choose Compare this
run to carry its settings into the four-case experiment.

## Expected results

Seeds 42–44 each offer 200 parents at 50 parents/s, with a 200 ms deadline, 4 ms
shard RTT and a 4× CPU slowdown on shard 0 in the slow condition. P95 is the
arithmetic mean of the three per-seed p95 values for successful parents.

| Case | On time / offered | Timeouts | Mean seed p95 (ms) | Backend service per success (ms) |
| --- | ---: | ---: | ---: | ---: |
| 1 shard, normal | 600 / 600 | 0 | 73.35 | 59.49 |
| 1 shard, slow shard | 558 / 600 | 42 | 182.08 | 80.01 |
| 4 shards, normal | 600 / 600 | 0 | 26.00 | 59.49 |
| 4 shards, slow shard | 600 / 600 | 0 | 112.46 | 74.32 |

No admission rejections occurred at these settings. The normal cases spend the
same total backend CPU and I/O service per success, while four-way parallelism
reduces elapsed latency. The slow shard raises the tail even in the four-way
case. Compare the deadline success count alongside p95, since p95 excludes
timeouts and rejections. These results apply to the modeled workload and
placement, and do not rank load-balancing policies.
