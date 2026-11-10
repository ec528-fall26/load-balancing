# Next.js Lab

The Lab uses a Python backend for simulation, playback, and live sessions.
**Library → Setup → Lab → Compare** is the main workflow. Templates prefill
Setup. Starting a run opens Lab, and Compare clones the current configuration
so you can isolate a change.

## Run locally

Follow the [repository quick start](../../README.md#quick-start) from the
same checkout. The server-side `LBSIM_API_URL` defaults to
`http://127.0.0.1:8000`. Set it explicitly when using a different address.
Open [Setup](http://127.0.0.1:3000/setup).

Recorded runs use bounded summaries and fetch only the requested server or
event page. Live sessions poll the Python worker for bounded telemetry, and
Pause, Resume, traffic changes, and Stop send commands to that worker.
See the [Python API](../../docs/python-api.md),
[recorded runs](../../docs/recorded-runs.md), and
[live sessions](../../docs/live-frontend.md) for the contracts.

## Checks

From `src/frontend/`, after `npm ci`:

```sh
npm run build
npm run test:api
npm run test:library
npm run test:comparison
npm run test:live
npm run test:recordings
```

Run the browser suite with the Python API running on port 8000:

```sh
PLAYWRIGHT_CHANNEL=chrome npm test
```

Install Chrome for that command, or use the configured browser in
[playwright.config.ts](playwright.config.ts). See the
[A-11 guide](../../experiments/results/a-11/README.md) for the separate
performance harness and isolated ports.

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
