# Routing strategies

`src/lbsim/policies.py` owns the policy registry, topology eligibility, labels and
strategy factories. `settings.py`, the Streamlit menu and all three engines use
that registry. A simulation creates a fresh strategy; no mutable strategy is
shared between runs. Engines call `choose()` before admission and notify
`update(target)` after running counts change. Admission, event ordering, workload
sampling, completion handling and queues remain engine responsibilities.

| Identifier | Topology | Selection and ties |
| --- | --- | --- |
| `round_robin` | Single pool and regions | Advance through target indices from zero, including after rejection. |
| `least_active_requests` | Single pool | Fewest running requests, then lowest server ID. Waiting work is excluded; no fallback on rejection. |
| `least_loaded` | Regions | Minimum `(running + queued + outbound in transit) / slots`, then client RTT, then region index. |
| `nearest` | Regions | Minimum client RTT, then region index. |
| `nearest_under_load` | Regions | Nearest region (client RTT, then index) whose `(running + queued + outbound in transit) / slots` is below 0.9. If every region is at or above 0.9, falls back to `least_loaded`. |
| `least_outstanding` | Single pool | Fewest running + CPU-queued + I/O-waiting requests, then lowest ID. |
| `power_of_two` | Single pool and CPU/I/O research | Sample two distinct targets; fewer CPU-active requests, first sampled on ties. |

Least-active and least-outstanding own bounded indexed minimum trees: O(log n) running-count updates
and O(1) selection. Round robin and regional strategies do not allocate that
index. The regional model still represents aggregate pools, not independent
per-server schedules. `nearest_under_load` is the one added routing rule: it
follows the mentor's example of preferring low latency until a region passes
about 90% load, then accepting extra latency to avoid overloading it.

## Frontend contract

Next.js uses a generated TypeScript projection of the same registry for menu
labels and policy types. It requires no extra runtime request or Python in the
browser. Keep the generated file in Git so frontend-only installs still work.
After changing policy metadata, run from the repository root:

```sh
uv run python scripts/generate_policy_metadata.py
uv run python scripts/generate_policy_metadata.py --check
```

To add a policy, implement a `RoutingPolicy`, register its factory and supported
topology labels, regenerate metadata and add behavioral tests. Registering a name
does not automatically implement it for a different target model.

## Verification

```sh
PYTHONPATH=src uv run python -m unittest discover -s tests -q
npm run typecheck --prefix src/frontend
npm run test:api --prefix src/frontend
```

`tests/test_policy_parity.py` checks 171 snapshots against SHA-256 fingerprints
captured before this refactor at `58cfcd3`. It covers batch and incremental
single-pool runs with both policies, three seeds, mixed compute rates, zero and
bounded queues and multiple slots; all three regional policies with travel;
small event budgets, traffic-rate changes and full draining. The fingerprints
include exact metrics and event/state data, not just outcome counts. Existing
policy, saved-run/replay, API and engine tests remain intact. Registry tests also
compare indexed selection with a simple minimum oracle after 1,000 seeded load
updates, verify per-run isolation and reject policies from the wrong topology.

The main Lab supports staged CPU/I/O requests in single-pool one-shot and live
runs. See [the integration guide](cpu-io-lab.md) for admission, stage accounting
and model-specific UI and recording contracts.
