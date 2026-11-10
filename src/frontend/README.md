# Next.js interface

The Next.js App Router interface recreates the existing Streamlit application:
configuration sidebar, empty state, overview charts, datacenter playback and run
averages, server details, saved-run upload, comparison, and download panels.
The theme and local Source Sans variable font match Streamlit's light theme.

## Run locally

Requires Node.js 20.9 or later and npm.

```sh
cd src/frontend
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
[PR #22](https://github.com/ec528-fall26/load-balancing/pull/22). A combined
checkout such as `sean-dev` can run both services from this repository. If your
branch does not yet include #22, run the backend from a separate `sean-api`
checkout and connect to it over localhost.

Start the Python service from the repository root in another terminal:

```sh
uv sync --locked
PYTHONPATH=src uv run uvicorn lbsim.api:app --host 127.0.0.1 --port 8000 --workers 1
```

The **Run simulation** action now calls the real Python engine through the
same-origin `/api/engine/run` proxy. `LBSIM_API_URL` in `.env.local` is read only
by the Next.js server and defaults to `http://127.0.0.1:8000`. Restart Next.js
after changing it. Health and API limits are available at the Python `/health`
endpoint; see the [API contract](../../docs/python-api.md).

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
local server. Use `PLAYWRIGHT_CHANNEL=chrome npm test` to select installed Chrome.
Start the Python API before running the suite; a live Run test checks actual
Python results through the proxy. The browser tests cover unavailable-backend feedback, recorded-result charts,
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

## Shared component system

The interface uses shadcn/ui (Radix, Nova style) with Tailwind CSS v4. Source
components live in `components/ui/`; `components.json` records the registry,
style, and aliases. Use these components for all controls, tabs, tables,
callouts, empty states, and playback widgets. Compose application behavior in
`components/` rather than creating another set of styled HTML controls.

Charts use the shadcn `ChartContainer` and tooltip components with Recharts v3.
Vega is no longer a frontend dependency. Response samples are counted into at
most 20 histogram bins before rendering; the p95 line uses the engine's exact
reported percentile. Utilization uses bars for up to 40 servers and a line for
larger pools. These rendering choices do not alter the engine metrics or bound
the API response size. Playback still follows recorded events, not a running
continuous simulation.

Add components with `npx shadcn@latest add <component>`. Use semantic theme
variables in `app/globals.css`, built-in variants, and Lucide icons. The source
font is served locally. See [DESIGN.md](DESIGN.md) for the UI conventions.

Setup uses shadcn `SidebarProvider` / `Sidebar` / `SidebarContent`, with the
built-in mobile Sheet. The local Sidebar source adds `mobileTitle` and forwards
`onCloseAutoFocus` to SheetContent so the setup tray has a useful accessible
name and restores focus to its external header trigger on dismissal.

Datacenter graphics are reusable application components in
`components/datacenter/`: `ServerNode`, `CapacityCells`, `RackView`, `TaskPool`,
and `ServerInspector`. They compose shadcn controls and surfaces with bounded
capacity-cell graphics. Server inspection pauses playback and shows the exact
recorded state; closing the tray returns focus to its trigger. Displaying 40
servers with 64 execution slots and 64 queue places renders at most 32 server
blades and 1,024 capacity cells per page. The browser suite verifies this using
a real 10,000-request Python result, including queue saturation and pagination.

## Home and saved setups

`/` is the setup library; `/simulator` is the run workspace. The grid includes
six built-in templates and configurations saved in this browser. Search and
All/Saved/Templates filters work without contacting the Python API. Use the
header's New simulation action for defaults, or open a card to load its settings.
Existing `/?preview=1` links redirect to the simulator's recorded preview.

The simulator's Save setup dialog stores a name, configuration, seed and update
time. An existing save can be updated or copied. Home offers confirmed deletion.
Results and event arrays are not stored; opening a setup does not automatically
start a run. These local saves are independent of A-07's Python export/replay API.

Persistence lives in `lib/saved-setups.ts`, using the versioned localStorage key
`lbsim.saved-setups.v1`. It validates stored records and API workload limits,
limits the library to 100 setups, preserves malformed/unsupported data, and
reports storage failures without replacing previous saves. Templates do not
change when a user saves or deletes configurations. Cross-tab storage events
refresh an open home grid. Clearing browser/site storage removes local saves;
there is no account sync or server persistence in this feature.

Run `npm run test:library` for storage, validation, copy/update/delete, malformed
data, and quota-failure tests. The browser library tests cover template opening,
search, save/update/copy/reopen/delete, mobile overflow, empty states, and corrupt
storage feedback. The existing simulator suite now navigates to `/simulator`.

The large-scale starter setups include a 1,000-server fleet (four execution
slots per server) and a 100-server overload case. Both generate 100,000 requests
at 5,000 requests/s for 20 simulated seconds, matching the current one-shot API
request cap. Template cards show total generated requests and queue capacity.
Both presets have been exercised through the Python API with seed 42: the fleet
completed 100,000 with no rejections; the overload completed 16,365 and rejected
83,635. These are scenario outcomes, not real-world throughput measurements.

## Navigation and live comparisons

The shared header offers Library, Lab, and Compare navigation. On narrow
screens, a shadcn DropdownMenu carries the same destinations. The sidebar trigger
has no vertical divider. Opening a template or save automatically opens lab
settings; successful mobile runs close the Sheet to reveal results. Failures
keep settings available with feedback in the Sheet.

Use **Compare current setup** in Lab to carry its unsaved configuration into
`/compare`, or choose a template/save directly as the comparison baseline. The
transfer uses a versioned per-tab sessionStorage draft; returning to Lab from
that comparison restores the original draft. This does not save a configuration
to the home library.

Compare supports a baseline and up to three variants. The initial variant flips
the routing policy; additional variants start as baseline copies and must be
edited before running. Changed settings are listed by value, including optional
processing-rate arrays. Baseline controls and variant controls support capacity,
traffic, service times, seed, policy, and per-server processing rates.

Run comparison executes each case sequentially through the existing Python
`POST /v1/run` path, respecting its one-active-run admission limit. Each case
retains the per-run workload bounds. Results include metrics, raw deltas to the
baseline, outcome/latency charts, and exact compared configurations. Percentage
rate deltas use percentage points; undefined metrics remain N/A. Inputs other
than policy are called out, and one seeded comparison is not a statistical
performance conclusion. Editing inputs does not rewrite the last completed
comparison; a failed rerun preserves the previous complete result set.

Comparison results are in-memory only, with no event or response-time arrays
retained after extracting summary metrics. The full HTTP responses still use
the existing API payload contract. This feature orchestrates live runs; it does
not implement the separate CSV-comparison, replay, or export endpoints in A-07.
Run `npm run test:comparison` for change detection, undefined metrics and compact
result tests. Browser coverage includes a live baseline/two-variant comparison,
correct deltas, failure recovery, unchanged-variant rejection and mobile flow.
