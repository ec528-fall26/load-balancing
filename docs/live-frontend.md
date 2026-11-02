# Live sessions in the Next.js lab — A-10

The lab connects to the A-08 continuous API through same-origin Next.js routes.
The Python worker owns the simulation clock; browser polling only reads bounded
snapshots. The one-shot Run path and recorded playback remain separate.

Start Python as documented in [continuous-api.md](continuous-api.md), then start
Next.js from `frontend/`. `LBSIM_API_URL` remains server-only and defaults to
`http://127.0.0.1:8000`. Open `http://127.0.0.1:3000/simulator`.

## Controls

- Topology and Execution are separate shadcn Select controls. Single pool and
  Regions each support One-shot and Continuous execution. Regional presets,
  capacity/compute and source/client/matrix RTT editors use the A-09 contract.
- Choose Continuous. Its setup omits the one-shot arrival-window field. Start
  continuous simulation sends the current configuration without `duration`.
- Pause/Resume affect the worker clock. Simulation speed uses the API's 0.25–10×
  control. Simulation time and reported catch-up lag remain visible.
- Apply traffic changes the active rate. Drain traffic sets rate to zero; work
  drains while running, whereas Pause freezes processing.
- Stop deletes the session. Restart with current settings stops it first, then
  starts a new session with the editable sidebar configuration.
- Switching topology or returning to One-shot stops an active session before changing the view. A
  failed stop leaves the continuous view available rather than hiding the worker.

Editable settings are distinct from the active configuration shown below the
live view. Setup edits do not silently reconfigure an existing worker. Browser
library saves remain configuration/seed records; they do not persist a live
worker, its history, or execution mode.

## Reconnection and lifecycle

The opaque active ID is stored under the versioned per-tab sessionStorage key
`lbsim.active-session.v1`. Reloading the lab reconnects to it and selects
Continuous. If no template/save/draft is being loaded, its active configuration
also restores the setup form. A new successful session closes mobile settings;
reconnecting does not override a deliberately opened setup Sheet.

Leaving the page cancels polling but does not delete a worker. The API continues
until explicit Stop, idle/absolute expiry, process restart, or failure. API
session IDs are not authentication; this remains a local service.

Not-found, expired and failed sessions detach, clear the stored ID, stop polling,
and leave a labeled last snapshot. A new session can be started. Transient API
errors retain the last snapshot and retry reads. Command errors remain visible
until another action rather than disappearing on the next successful poll.

## Transport and telemetry

`/api/sessions` handles creation; its bounded catch-all route exposes only the
UUID-scoped snapshot, commands and delete paths. It uses the configured Python
base URL, strict path/query allowlists, a 64 KiB streamed body bound, no-store
responses, a deadline and cancellation. Existing one-shot proxy behavior is
preserved through the shared `proxyPython` transport.

`useLiveSession` schedules another poll 500 ms after the preceding read finishes.
Only one poll is outstanding. Commands suspend polling and abort outstanding
reads. Request generations and session/revision checks ignore stale responses.
Page changes abort old reads; commands refresh the selected server page. No
browser request advances the simulation clock.

Snapshot validation checks identity, conservation, finite metrics, server/page
state, window and array bounds. At most 32 servers, 120 historical points and
20 histogram bins are requested/displayed. Recent p95 uses the API's explicitly
bounded response window; mean response/utilization cover the session lifetime.
There is no synthetic finite total or "not arrived" count for a continuous run.

The view composes shadcn controls/cards/charts with RackView, TaskPool and
ServerInspector. Live server details use live time and session-average labels.
Stopped/expired data is labeled as a last retained snapshot.

## Verification

```sh
cd frontend
npm run build
npm run test:api
npm run test:live
PLAYWRIGHT_CHANNEL=chrome npm test
```

Node tests cover proxy method/path/query mapping, body bounds, backend errors,
deadlines, snapshot bounds/identity and terminal errors. Browser tests cover a
real 40-server session, independent clock progress, pause/reload reconnection,
restored settings, speed/traffic changes, complete draining, pagination and
stop; delayed polling and stale responses; expiry with polling cancellation;
and mobile start/mode switching. Test-created sessions are deleted afterward.

Regional browser tests also cover preset selection, source/RTT/compute edits,
fully drained one-shot results, validation errors preserving prior results,
continuous reconnect, active versus draft settings, restart, topology cleanup
and mobile overflow. A-11 retains broader frontend/payload scale benchmarks;
fault injection remains separate.


## Regional extension

Regional one-shot and continuous execution now share the Lab topology/execution controls. See [regional-api.md](regional-api.md) for regional policies, preset/RTT settings, pooled-capacity assumptions, bounds and scope. Regional saves and exports remain unavailable pending a versioned schema. Compare captures regional configurations into fresh bounded cases while preserving the live session.
