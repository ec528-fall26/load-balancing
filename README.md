# EC528 Project — Load Modeling and Load Balancing Simulation Platform

**Team** Daniel Thomas, Kimone Walker, Neev Jain, Sean O’Connor

**Mentor** Shripad Nadgowda (Meta)

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
and Node.js 22 or newer. Dependencies are pinned by `uv.lock` and
`src/frontend/package-lock.json`.

```sh
git clone --branch sean-dev https://github.com/ec528-fall26/load-balancing.git
cd load-balancing
uv sync --locked
uv run uvicorn lbsim.api:app --host 127.0.0.1 --port 8000 --workers 1
```

For the graded snapshot, use `demo-3` in place of `sean-dev` once published.

In a second terminal, from the repository root:

```sh
npm --prefix src/frontend ci
LBSIM_API_URL=http://127.0.0.1:8000 npm --prefix src/frontend run dev
```

Open [Setup](http://127.0.0.1:3000/setup). To check the backend independently,
run `curl -fsS http://127.0.0.1:8000/health` and look for `"status":"ok"`.

- **Compare routing.** In Setup, select **Single server pool** and **One-shot**.
  Use 10 servers, 1 slot and 10 waiting places per server, 16.36 requests/s for
  100 seconds, simple service times of 0.1–1.0 seconds, and seed 42.
  Choose **Compare current setup**, clone the baseline, and set the two variants
  to **Least active requests** and **Least outstanding requests**. Leave the
  baseline at **Round robin** and click **Run comparison**. Expect 1,636 offered
  requests per case and 0, 55, and 0 rejections, respectively.
- **Change load live.** In Setup, use **Continuous**, two servers with one slot
  each, and start at 2 requests/s. In Lab, enter 10 in **Live requests per
  second** and click **Apply traffic**. Watch the queue and simulated clock.
  Click **Pause session**, then **Resume session**. Click **Stop session** when
  finished.
- **Inspect an outage.** Choose **Sharded service**, four parallel calls,
  4 ms round trip, a 500 ms seeded outage, CPU slowdown 1×, 50 parents/s for
  four seconds, a 200 ms deadline, and seed 42. Under **Seed and request
  timeline**, choose request 170. Expect 175 of 200 parents on time and 25
  outage failures. Open **Follow request 170** and **Full event timeline**.

The original Streamlit interface is available with
`uv run streamlit run src/lbsim/app.py`.
For deployment, see [Docker Compose](docs/docker-compose.md) and
[Kubernetes](docs/kubernetes.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `docs/` | Design proposal, design document, API contracts, and deployment instructions |
| `slides/` and `videos/` | Demo deliverables |
| `src/lbsim/` | Python simulator, HTTP API, and Streamlit interface |
| `src/frontend/` | Next.js Lab and browser tests |
| `experiments/` | Reproduction scripts and saved results |
| `tests/` | Python engine and API tests |
| `deploy/` | Dockerfiles, gateway configuration, and Kubernetes manifests |

## Reproducing our results

See the [Demo 3 experiments](docs/design-document.md#demo-3-experiments) for
commands, expected output, and timing. Run the Python suite and frontend
build from the repository root:

```sh
uv run python -m unittest discover -s tests -q
npm --prefix src/frontend run build
```

See the [frontend guide](src/frontend/README.md) for Node and browser checks.

## Submission checklist

The course collects deliverables from the named branch at noon Boston time on
the demo date. [Course submission instructions](https://ec528.github.io/ec528/fall26/setup/)

| Deliverable | Branch | Must contain |
| --- | --- | --- |
| Demo 1 | `demo-1` | Slides, code, design proposal |
| Demo 2 | `demo-2` | Slides, code, design document, demo video |
| Demo 3 | `demo-3` | Slides, code, updated design document, demo video |
| Final | `final-demo` | Slides, code, artifact documentation, recorded video presentation |

Earlier snapshots: [Demo 1 proposal](docs/design-proposal.md) and
[slides](slides/demo-1.pdf) · [Demo 2 slides](slides/demo-2.pdf) and
[video](videos/demo-2.mp4).
