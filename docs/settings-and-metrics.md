# Settings form and summary metrics

The app connects the settings form, simulator, metrics and result display (D2-11) on `dev`.

## Run locally

```sh
uv sync --locked
PYTHONPATH=src uv run streamlit run src/lbsim/app.py
uv run python -m unittest discover -s tests -v
```

Open the local URL printed by Streamlit. Enter server count, slots, queue limit,
arrival rate, arrival duration, service-time bounds, seed and routing policy.
Click **Run simulation**. Invalid inputs produce an error; a zero queue limit
and a negative integer seed are valid. The preview stores the agreed config
as a plain dictionary in `st.session_state["config"]`.

The results come from the selected configuration after all accepted requests
finish. A new run replaces the previous configuration and summary. Invalid
settings clear the previous results. Round-robin is the currently supported
policy; least-active-requests is excluded from the form until implemented.

The current prototype uses `int(arrival_rate * duration)` requests with evenly
spaced arrivals starting at time zero and uniform service durations. This is
Daniel's initial workload model; exponential arrivals remain a proposal for team
review. Each run uses its own server objects and seeded random generator.
`lbsim.simulation.run_simulation(config)` validates inputs, runs the event loop,
and returns the metrics summary. It can also be called from experiment scripts.

`lbsim.settings.validate_config(mapping)` validates the shared configuration and
returns a new dictionary. The UI calls it through `build_config(**values)`.
The engine and experiment scripts can call the same validator directly. It
rejects missing fields, booleans/fractions for integer fields, nonpositive or
nonfinite rates and durations, reversed service bounds and unsupported policies.
Zero queue capacity, equal service bounds and negative integer seeds are valid.

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

## Result display

`lbsim.results.display_summary(summary)` renders a metrics summary in Streamlit.
Counts appear as whole numbers, response times use seconds with three decimal
places, and per-server utilization appears as percentages in server-ID order.
No completed requests yields N/A latency values and an explanatory message;
idle servers still show 0%. The form passes the actual run summary to this display. Tests verify the actual displayed values for sample, empty and
rejected-only results.

## Integration checks

Tests cover changing settings between runs, normal traffic, overloaded queues,
draining after the arrival window, seeded replay, empty workloads, unsupported
policies, and isolation of server/random state between runs.

## Charts and layout

Configure a run in the sidebar. The main view shows request outcome bars, a
response-time histogram with a p95 reference line, and per-server slot utilization.
The histogram includes only completed requests, including work finished during
draining. `run_simulation` supplies the actual `response_times` alongside the summary.
Large server sets use a line chart; exact utilization values remain available
in the Server details tab. The last run's configuration is available in an expander.
