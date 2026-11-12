# Next.js interface

The Next.js App Router interface recreates the existing Streamlit application:
configuration sidebar, empty state, overview charts, datacenter playback and run
averages, server details, saved-run upload, comparison, and download panels.
The theme and local Source Sans variable font match Streamlit's light theme.

## Run locally

Requires Node.js 20.9 or later and npm.

```sh
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Open http://localhost:3000/?preview=1 to inspect the
results UI with an explicitly labeled, recorded example. The example was generated
once using the existing Python engine with the default configuration; browser
controls do not run a JavaScript simulation. Closing preview returns to the empty
state. The preview fixture does not change when the settings form is edited.

## Python API connection

This connection builds on the frontend in PR #17 and needs the Python API in
[PR #22](https://github.com/ec528-fall26/load-balancing/pull/22). Until #22 is
merged, run the backend from a separate `sean-api` checkout. The frontend can
run from this branch and connect to that backend over localhost.

Start the Python service from the repository root in another terminal:

```sh
uv sync --locked
PYTHONPATH=src uv run uvicorn lbsim.api:app --host 127.0.0.1 --port 8000 --workers 1
```

The **Run simulation** action now calls the real Python engine through the
same-origin `/api/engine/run` proxy. `LBSIM_API_URL` in `.env.local` is read only
by the Next.js server and defaults to `http://127.0.0.1:8000`. Restart Next.js
after changing it. Health and API limits are available at the Python `/health`
endpoint; see the [API contract](https://github.com/ec528-fall26/load-balancing/blob/sean-api/docs/python-api.md).

The proxy caps actual request bodies at 65,536 bytes and allows 20 seconds for
Python to respond (Python's own worker deadline is 15 seconds plus cleanup).
Python validation, busy and timeout errors retain their status and fields.
Unavailable backends and proxy deadlines produce actionable 503/504 messages.
Duplicate Run/Replay submissions are blocked while pending, and failures keep
the last successful results visible. `processing_rates` is supported in the
TypeScript run configuration, though there is no dedicated rate editor yet.

Replay, comparison and exports still return HTTP 501 with
`code: ENGINE_NOT_CONNECTED`; connecting those workflows is A-07.

| Route                 | Request body                                | Response                                                    |
| --------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| `/api/engine/run`     | `{ config: Config }`                        | `{ config: Config, summary: Summary }`                                        |
| `/api/engine/replay`  | `{ configuration: <uploaded JSON export> }` | Verified `{ config, summary }`                                                |
| `/api/engine/compare` | `{ results: [<CSV text A>, <CSV text B>] }` | Two validated runs as `[Run, Run]`; events/response_times can be empty arrays |
| `/api/engine/exports` | `{ config: Config, summary: Summary }`      | `{ config_json: string, results_csv: string, run_id: string }`                |

The `Config`, `Summary`, `Event`, and `Run` types are in `lib/engine.ts`.
Playback consumes `[time, server_id, running, queued, action, request_id]` events.
Configuration validation and simulation remain in Python. Replay fingerprint
verification, saved CSV validation and export hashing will also stay in Python
when A-07 connects those operations. Uploads currently provide selection and
JSON parsing only. Preview mode needs no backend; normal Run does.

## Checks

```sh
npm run test:api
npm run build
npm test
```

Playwright uses installed Microsoft Edge (`channel: msedge`) and starts/reuses the
local dev server. The browser tests cover unavailable-backend feedback, recorded-result charts,
playback/seek/reset, utilization tables, download feedback, and mobile overflow.
Screenshots are saved under the ignored `test-results/` directory.

The original Streamlit app remains available through the repository's Python setup.
No hosting or deployment settings have been added.

Font: Adobe Source Sans, distributed under the SIL Open Font License; see
`public/fonts/LICENSE.md`.

The six API/client tests run with Node's test runner after TypeScript compilation;
they do not require a browser or Python service. They cover proxy forwarding,
Python error propagation, streamed body limits, backend failures, deadlines,
and actionable client-side errors. Live HTTP and browser checks should additionally
exercise real Python results with two configurations and preservation of prior
results after a failed request.
