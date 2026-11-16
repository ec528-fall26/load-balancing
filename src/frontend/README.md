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
See the [Python API](../../docs/api.md#python-engine-api-a-05),
[recorded runs](../../docs/api.md#bounded-one-shot-responses-and-recorded-playback), and
[live sessions](../../docs/api.md#live-sessions-in-the-nextjs-lab--a-10) for the contracts.

## Checks

See the [repository verification commands](../../README.md#verification) for
the build, Node tests, and browser suite. The [A-11 performance harness](../../experiments/results/a-11/README.md)
uses separate ports and is independent of the browser regression suite.

## Shared component system

The interface uses shadcn/ui (Radix, Nova style) with Tailwind CSS v4. Source
components live in `components/ui/`; `components.json` records the registry,
style, and aliases. Use these components for all controls, tabs, tables,
callouts, empty states, and playback widgets. Compose application behavior in
`components/` rather than creating another set of styled HTML controls.

Charts use the shadcn `ChartContainer` and tooltip components with Recharts v3.
Recorded runs and live sessions receive at most 20 histogram bins from Python.
The p95 line uses the engine's reported percentile for the corresponding
sample window. Utilization uses bars for up to 40 servers and a line for
larger pools. One-shot playback seeks within a recording, while live views
update from bounded worker snapshots.

Add components with `npx shadcn@latest add <component>`. Use semantic theme
variables in `app/globals.css`, built-in variants, and Lucide icons. The source
font is served locally. See [DESIGN.md](DESIGN.md) for the UI conventions.
