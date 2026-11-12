# CPU/I/O in the main Lab

Single-pool runs support two independent execution choices (one-shot/continuous)
and two request models (simple service duration/CPU → I/O wait → CPU). Regions
retain their existing aggregate-pool model; CPU/I/O is not offered for regions.

## Configure and run

Open **Library** and choose **CPU to I/O, step by step**, **I/O-heavy routing** or
**CPU-heavy routing**. **Live I/O-heavy traffic** and **Live CPU-heavy traffic**
open Setup in continuous mode. All templates prefill editable settings.

Setup has its own page at `/setup`, grouped into **Infrastructure**, **Traffic
and routing**, and **Execution**. The summary shows capacity, traffic and routing
beside the run action. CPU/I/O details expand within Traffic and routing. There is
no preset/custom mode: edit a template directly. Successful runs open the Lab at
`/simulator`; errors leave the form available. **Edit configuration** returns to
Setup while keeping completed results. **Compare this run** uses the run's
configuration, while **Compare current setup** on Setup uses the draft.

Live Pause/Stop and traffic changes stay in Lab; speed and restart are under
**Session options**. Draft edits do not stop or reconfigure a live session.
Starting a replacement continuous run explicitly replaces the existing worker.

The service-time range samples total demand before queueing; the CPU fraction
is split equally before/after I/O. Server processing-rate multipliers scale CPU
stages only. All servers share a finite I/O resource with a FIFO queue. A call
holds one I/O slot during service and releases its server CPU slot. This models
one shared dependency, not a physical disk or network. **Shared I/O bottleneck**
provides an intentionally constrained example.

Mixed workloads draw a 90% or 10% I/O fraction per request, with a configurable
probability of I/O-heavy requests. A separate seeded type stream preserves the
offered workload across policies and I/O capacities; `workload_sha256` covers all
offered requests, including rejected ones.

Each admitted request belongs to one server until completion. CPU1 and CPU2 share
one non-preemptive CPU-ready FIFO. I/O releases its CPU slot but retains an
outstanding admission place. A full selected server rejects without alternate
routing or retry. There is no separate CPU-queue admission limit in this mode;
all unfinished work is bounded by the outstanding cap. The legacy `queue_limit`
setting is preserved for switching back to the simple model and is hidden while
CPU/I/O is selected.

## Routing and signals

All strategies use the central Python registry and fresh per-run state:

- Round robin advances through servers even after rejection.
- Least active counts CPU-active requests; CPU queues and I/O wait are excluded.
- Least outstanding counts CPU-active + CPU-queued + I/O-waiting requests.
- Power of two samples two distinct servers and chooses fewer CPU-active requests;
  equal counts choose the first sampled. Routing RNG uses `seed + 1000000`, separate
  from workload generation. This specified variant is not an Envoy conformance claim.

Both minimum policies use a bounded indexed tree, with lowest-server-ID ties.
The simple model also supports least outstanding (running + waiting) and P2C.
The original two policies retain their prior behavior on the simple model.

## Visualization and metrics

Datacenter racks and server details show CPU activity, CPU-ready queues, I/O
in service, I/O queued and outstanding counts/caps. Resource pressure separates
CPU occupancy, shared I/O capacity and admission capacity. A server with idle CPU and I/O wait is not
labeled idle. Task-pool counts include I/O in conservation and future arrivals.
One-shot playback fetches the selected-time state for only the visible server
page. It does not download the whole event trace.

Latency includes CPU queueing, I/O and execution through full draining, and
excludes rejected requests. The latency breakdown separates CPU service, CPU queue, I/O service and I/O
queue means for completed requests only. One-shot p95/histogram cover all completions. Continuous p95/histogram cover
the bounded recent response window (at most 2,000), while mean response and mean
CPU queue delay cover all completions since session creation. CPU occupancy is
modeled slot occupancy, not host CPU utilization. One-shot utilization clips to
the arrival window; continuous utilization covers the elapsed session.

Continuous history stays capped at 240 points and server pages at 64 (the UI
requests 32). Sessions retain outstanding state, not full completed traces. Pause
freezes the clock; resume continues; zero traffic drains existing work. Live
traffic controls apply immediately at processed simulated time. Draft model,
policy and I/O-share edits apply on the next session, as other setup edits do.

## Recorded data and compatibility

Simple-model configuration and six-field events keep their original shape.
CPU/I/O adds `request_model: cpu_io`, `io_fraction` (0–0.99) and a positive
`outstanding_limit`, `io_capacity` (1–4096; default 64) and optional
`io_heavy_probability` (0–1). Ten-field staged events append per-server total I/O,
outstanding, active I/O and queued I/O counts to the six legacy fields. Actions
`cpu_to_io`, `io_started` and `io_to_cpu` are internal
transitions, not new arrivals. CPU completions precede I/O completions, then
arrivals; same-kind ties follow stable insertion order. One-shot uses exactly
`int(arrival_rate * duration)` generated arrivals and drains accepted requests.

Recordings remain disk-backed with count/bytes/TTL quotas, stable event pages
and indexed selected-time snapshots. Browser saves retain all model settings;
Compare clones retain them and allow policy/I/O-share/admission changes. Version-1
JSON/CSV exports cannot represent stages and explicitly reject CPU/I/O rather
than dropping settings. No silent schema migration is introduced.

## Verify

```sh
uv sync --locked
PYTHONPATH=src uv run python -m unittest discover -s tests -q
npm --prefix src/frontend ci
npm --prefix src/frontend run typecheck
npm --prefix src/frontend run test:library
npm --prefix src/frontend run test:live
npm --prefix src/frontend run test:comparison
```

Start the Python API and Next.js using the existing API/frontend setup guides.
Browser tests in `src/frontend/tests/cpu-io-templates.spec.ts` exercise the actual API,
exact one-shot I/O state, save/reload, live controls and zero-traffic drain.
`tests/test_staged.py` checks hand-derived traces, parity with the standalone
CPU/I/O experiment, compute multipliers, FIFO, minimum-policy load signals,
capacity/conservation, paging, rate changes, bounded retention and API validation.
The pre-refactor simple-model snapshot fingerprints remain in the full suite.

The backend suite reports **128 tests, OK**. `tests/test_shared_io.py` adds exact
shared-dependency timelines, FIFO/capacity invariants, mixed-workload identity,
resource accounting and bounded retention. Browser checks cover dedicated Setup/Lab navigation,
direct template editing, shared I/O pressure, saved configurations, playback
and live drain. These are local correctness checks, not production-capacity or
physical-network claims.
