# EC528 Project — Load Modeling and Load Balancing Simulation Platform

**Team:** Daniel Thomas, Kimone Walker, Neev Jain, Sean O’Connor

**Mentor:** Shripad Nadgowda (Meta)

**Project:** A simulator for measuring how routing, load, and failures affect queues, latency, and rejections.

## What this is

Load Balancing Lab simulates how routing decisions, server capacity, and
downstream failures affect queues, rejected requests, and response times.
A Next.js interface drives the Python simulator. The same seed lets you compare
policies on identical offered workloads.

**Demo 3** · [Slides](slides/demo-3.pdf) · [Captioned video](videos/demo-3.mp4) ·
[Design document](docs/design-document.md) ·
[Hosted slides](https://ec528-demo-3.vercel.app/load-balancing-demo-3/) ·
[Hosted Lab](https://ec528-lab.coolify.soconnor.dev/)

## Quick start

From a fresh checkout on macOS or Linux, install Git, [uv](https://docs.astral.sh/uv/getting-started/installation/),
and [Node.js with npm](https://nodejs.org/). Use Python 3.12 (selected by uv)
and Node.js 24 (the version used by CI). Dependencies are pinned by `uv.lock` and
`src/frontend/package-lock.json`.

```sh
git clone --branch demo-3 https://github.com/ec528-fall26/load-balancing.git
cd load-balancing
uv sync --locked
uv run --locked python -m uvicorn lbsim.api:app --host 127.0.0.1 --port 8000 --workers 1
```

In a second terminal, from the repository root:

```sh
npm --prefix src/frontend ci
LBSIM_API_URL=http://127.0.0.1:8000 npm --prefix src/frontend run dev
```

Open [Setup](http://localhost:3000/setup). To check the backend independently,
run `curl -fsS http://127.0.0.1:8000/health` and look for `"status":"ok"`.

For a smoke test, choose **Single server pool**, **One-shot**, and **Round robin**.
Set one server, one slot, one waiting place, 4 requests/s, a 1-second arrival
window, and both service-time bounds to 1 second. Run the simulation. Expect
**2 completed, 2 rejected, and 1.75 s p95**. Keep the default seed of 42.

See the [Demo 3 walkthroughs](docs/design-document.md#lab-walkthroughs) for
routing comparisons, changes to live traffic, and a shard outage.

See the [deployment guide](deploy/README.md) for Docker Compose and Kubernetes.

## Repository layout

| Path | Contents |
| --- | --- |
| `docs/` | Design proposal, design document, and model/API reference |
| `slides/` and `videos/` | Demo deliverables |
| `src/lbsim/` | Python simulator and HTTP API |
| `src/frontend/` | Next.js Lab and browser tests |
| `experiments/` | Reproduction scripts and saved results |
| `tests/` | Python engine and API tests |
| `deploy/` | Dockerfiles, gateway configuration, and Kubernetes manifests |

## Reproducing our results

Start with [Running the experiments](docs/design-document.md#4-running-the-experiments)
for the exact commands, expected results, and links to the reference captures.
[Experiment outputs](experiments/README.md) explains where reruns write files.

## Verification

```sh
uv run --locked python -m unittest discover -s tests -q
uv run --locked python scripts/generate_policy_metadata.py --check
npm --prefix src/frontend run build
(cd src/frontend && npx --no-install tsc -p tsconfig.api-tests.json && node --test .api-tests/tests/*.test.js)
(cd src/frontend && npx --no-install playwright install chromium)
LBSIM_API_URL=http://127.0.0.1:8000 PLAYWRIGHT_CHANNEL=chromium npm --prefix src/frontend test
```

Run these commands after installing the locked dependencies. Keep the API running
and stop the interactive frontend before Playwright starts its server on port 3000.

Expect 181 Python tests with `OK`, a successful metadata check and frontend build,
39 passing Node module tests and 48 passing Chromium tests.
On a Linux machine missing browser system libraries, add `--with-deps` to the
Playwright install command. The default config otherwise selects Edge; explicitly selecting Chromium makes
this command portable. Allow roughly 30-120 seconds for Python, 1-3 minutes for
a cold build, and 2-10 minutes for browser checks after installation. Slower
machines may exceed these estimates. These categories also run in
[CI](.github/workflows/tests.yml).

## Submission checklist

The course collects deliverables from the named branch at noon Boston time on
the demo date. [Course submission instructions](https://ec528.github.io/ec528/fall26/setup/)

| Deliverable | Branch | Must contain |
| --- | --- | --- |
| Demo 1 | `demo-1` | Slides, code, `docs/design-proposal.md` |
| Demo 2 | `demo-2` | Slides, code, `docs/design-document.md`, demo video |
| Demo 3 | `demo-3` | Slides, code, updated `docs/design-document.md`, demo video |
| Final | `final-demo` | Slides, code, artifact documentation, recorded video presentation |

Earlier snapshots: [Demo 1 proposal](docs/design-proposal.md) and
[slides](slides/demo-1.pdf) · [Demo 2 slides](slides/demo-2.pdf) and
[video](videos/demo-2.mp4).
