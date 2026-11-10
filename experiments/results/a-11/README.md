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

   Defaults to the installed Chromium channel; `PLAYWRIGHT_CHANNEL` can select another installed browser. Eight cases cover both topologies, rates and execution modes. One-shot cases offer 100,000 requests; live cases observe 15 seconds of updates, then pause/drain/stop. This suite is outside the default test directory. It records CDP heap/task metrics, long tasks, animation-frame gaps, decoded polling payloads, request concurrency and control latency. Test-owned sessions are deleted afterward.

5. Generate the analysis from the repository root:

   ```sh
   python3 experiments/summarize_telemetry.py
   ```

`baseline-api-engine.json` preserves the pre-fix capture with a 100,001st regional arrival; do not overwrite it. The corrected report records source hashes and dirty-checkout status. Measurements remain local evidence until committed/reviewed. JSON bytes, wire bytes, engine CPU, worker RSS and browser heap are distinct quantities.
