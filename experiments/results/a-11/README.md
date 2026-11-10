# Reproduce A-11 scale measurements

Use isolated ports to preserve the interactive demo. Run phases sequentially on a quiet machine; do not overlap builds, API/core measurement and browser measurement.

1. Start the benchmark API from the repository root:

   ```sh
   PYTHONPATH=src uv run uvicorn lbsim.api:app --host 127.0.0.1 --port 8001 --workers 1
   ```

   Note the API PID printed by Uvicorn. The harness samples that PID's live child for RSS/CPU; do not share the benchmark service with other sessions.

2. Build the frontend and start a production server in another terminal:

   ```sh
   cd src/frontend
   npm run build
   LBSIM_API_URL=http://127.0.0.1:8001 npm run start -- --hostname 127.0.0.1 --port 3001
   ```

3. Run engine/HTTP measurements from the repository root:

   ```sh
   PYTHONPATH=src uv run python experiments/telemetry_benchmark.py --api-pid API_PID
   ```

   Replace `API_PID` with the actual Uvicorn PID. Defaults: three seeds per core/one-shot case; 20 wall seconds per live case, except a 130-second regional 10,000/s soak to fill the 240-sample history. Evidence is written incrementally to `api-engine.json`. Workers run one at a time; test sessions are deleted in `finally`.

4. After that completes, run browser measurements:

   ```sh
   cd src/frontend
   npm test -- --config benchmarks/playwright.config.ts
   ```

   Defaults to the installed Chromium channel; `PLAYWRIGHT_CHANNEL` can select another installed browser. Ten cases cover both topologies, rates and execution modes, plus 1,000-server playback and the 12-datacenter preset. One-shot cases offer 100,000 requests; live cases observe 15 seconds of updates, then pause/drain/stop. This suite is outside the default test directory. It records CDP heap/task metrics, long tasks, animation-frame gaps, decoded polling payloads, request concurrency and control latency. Test-owned sessions are deleted afterward.

5. Generate the analysis from the repository root:

   ```sh
   python3 experiments/summarize_telemetry.py
   ```

`baseline-api-engine.json` preserves the pre-fix capture with a 100,001st regional arrival; do not overwrite it. The corrected report records source hashes and dirty-checkout status. Measurements remain local evidence until committed/reviewed. JSON bytes, wire bytes, engine CPU, worker RSS and browser heap are distinct quantities.


## Pagination and larger topology follow-up

The first `api-engine.json` capture used the pre-pagination frontend. Its exact harness source is preserved in `capture-source/telemetry_benchmark.py`; source hashes are in the report. The current harness also accepts the bounded frontend response, verifies its metrics against legacy output and deletes its recording.

For the current API, run `PYTHONPATH=src uv run python experiments/pagination_scale.py` against the isolated backend. It verifies all event pages against the legacy trace, precise seeking, 1,000-server workloads and 12-datacenter RTT configurations, then samples 10,000 and 100,000 offered requests/s. Evidence is `pagination-scale.json`; `pagination-before-batch.json` preserves the exploratory event-budget result. Its initial one-shot timings overlapped a frontend build, so use the final capture for timing conclusions.
