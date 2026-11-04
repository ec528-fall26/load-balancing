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

Least-active owns a bounded indexed minimum tree: O(log n) running-count updates
and O(1) selection. Round robin and regional strategies do not allocate that
index. The regional model still represents aggregate pools, not independent
per-server schedules. These are the existing policies, not new routing semantics.

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
npm run typecheck --prefix frontend
npm run test:api --prefix frontend
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
