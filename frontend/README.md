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
npm run dev
```

Open http://localhost:3000. Open http://localhost:3000/?preview=1 to inspect the
results UI with an explicitly labeled, recorded example. The example was generated
once using the existing Python engine with the default configuration; browser
controls do not run a JavaScript simulation. Closing preview returns to the empty
state. The preview fixture does not change when the settings form is edited.

## Python API placeholders

Python files are unchanged. All future calls go through `lib/engine.ts` and the
server route `app/api/engine/[operation]/route.ts`. Supported POST routes currently
return HTTP 501 with `code: ENGINE_NOT_CONNECTED`, so placeholder actions cannot
be mistaken for successful simulations or verified replays.

| Route                 | Request body                                | Future successful response                                                    |
| --------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| `/api/engine/run`     | `{ config: Config }`                        | `{ config: Config, summary: Summary }`                                        |
| `/api/engine/replay`  | `{ configuration: <uploaded JSON export> }` | Verified `{ config, summary }`                                                |
| `/api/engine/compare` | `{ results: [<CSV text A>, <CSV text B>] }` | Two validated runs as `[Run, Run]`; events/response_times can be empty arrays |
| `/api/engine/exports` | `{ config: Config, summary: Summary }`      | `{ config_json: string, results_csv: string, run_id: string }`                |

The `Config`, `Summary`, `Event`, and `Run` types are in `lib/engine.ts`.
Playback consumes `[time, server_id, running, queued, action, request_id]` events.
Connect these routes to the future Python HTTP API. Keep configuration validation,
simulation, replay fingerprint verification, saved CSV validation, and canonical
export hashing in Python. Uploads currently provide selection and JSON parsing;
authoritative validation remains an API placeholder. No Python server or API
credentials are required to review the UI.

## Checks

```sh
npm run build
npm test
```

Playwright uses installed Microsoft Edge (`channel: msedge`) and starts/reuses the
local dev server. The tests cover placeholder responses, recorded-result charts,
playback/seek/reset, utilization tables, download feedback, and mobile overflow.
Screenshots are saved under the ignored `test-results/` directory.

The original Streamlit app remains available through the repository's Python setup.
No hosting or deployment settings have been added.

Font: Adobe Source Sans, distributed under the SIL Open Font License; see
`public/fonts/LICENSE.md`.
