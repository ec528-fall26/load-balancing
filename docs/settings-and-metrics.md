# Settings form and summary metrics

These implement D2-09 and D2-08 on top of `sean-dev`.

## Run locally

```sh
uv sync --locked
uv run streamlit run src/lbsim/app.py
uv run python -m unittest discover -s tests -v
```

Open the local URL printed by Streamlit. Enter server count, slots, queue limit,
arrival rate, arrival duration, service-time bounds, seed and routing policy.
Click **Preview settings**. Invalid inputs produce an error; a zero queue limit
and a negative integer seed are valid. The preview stores the agreed config
as a plain dictionary in `st.session_state["config"]`.

The sample results are the fixed worked example in `simulation-model.md` and
are explicitly independent of the form values. No workload or engine runs yet.
Connecting the engine remains D2-11. The policy strings are `round_robin` and
`least_active_requests`; routing implementations should agree on these names.
`lbsim.settings.build_config` provides form-boundary validation that can later
call a shared configuration validator when D2-04 is integrated.

## Metrics integration

```python
from lbsim.metrics import summarize

summary = summarize(
    completed_executions,
    rejected_request_ids,
    duration=config["duration"],
    server_capacities={server.id: server.concurrency for server in servers},
)
```

Call after draining the engine and pass every completed `Execution`, including
those ending after the arrival window. Inputs are read without mutating them.
The engine remains responsible for valid non-overlapping slot schedules and
for checking that completed plus rejected equals generated requests.

Outputs:

- `completed_count`, `rejected_count`: request counts.
- `mean_response_time`: mean completion minus arrival, including waiting, in seconds.
- `p95_response_time`: nearest-rank 95th percentile, in seconds.
- `per_server_utilization`: server ID to occupied-slot fraction (0 to 1 for valid
  schedules), with every execution clipped to `[0, duration]`. Idle servers are
  included. This is modeled occupancy, not CPU utilization.

Both latency values are `None` for no completions (JSON `null`). Counts and
utilization remain zero for an empty run. Rejected-only runs have no latency.

The hand-worked fixture expects three completions, one rejection, mean 10/3 s,
p95 4 s, and full utilization for the one-slot server over four seconds. Tests
also check concurrent capacity, idle servers, nearest-rank p95 with 20 samples,
empty/rejected-only runs, invalid denominators, duplicate results, and form
submission, resubmission and error handling through Streamlit AppTest.
