# EC528 Project — Load Modeling and Load Balancing Simulation Platform

**Team:** Daniel Thomas, Kimone Walker, Neev Jain, Sean O'Connor

**Mentor:** Shripad Nadgowda (Meta)

**Project:** A web application for simulating request traffic, server queues, and load-balancing policies.

For the containerized Next.js Lab and replica controls, see [Docker Compose](docs/docker-compose.md).

## What this is

Uneven traffic can overload some servers while leaving others underused. This
simulator lets users configure a server pool and workload, then inspect request
outcomes, response times, and server utilization.

The Demo 2 prototype runs locally with round-robin routing, bounded FIFO queues,
repeatable seeded workloads, result charts, and recorded-event playback.
This branch adds least-active-requests, saved-run comparison in Streamlit,
and a Next.js frontend connected to the Python run API.

## Quick start

### Next.js interface

Install Git, uv, and Node.js 20.9 or later. From a checkout of this branch,
start the Python API at the repository root:

```sh
uv sync --locked
PYTHONPATH=src uv run uvicorn lbsim.api:app --host 127.0.0.1 --port 8000 --workers 1
```

In a second terminal at the repository root:

```sh
npm --prefix src/frontend ci
npm --prefix src/frontend run dev
```

Open `http://localhost:3000/setup` to configure and run a simulation. The Next.js app
calls the Python API. Saved-run upload, comparison, and export are available
in the Streamlit app below. See the [frontend guide](src/frontend/README.md)
and [Python API contract](docs/python-api.md).

The current frontend flow is **Library → Setup → Lab → Compare**. Templates and
browser saves open editable settings on `/setup`. Run to open `/simulator`, where
results, playback and live controls stay together. Edit configuration preserves
the current run while preparing the next. See [CPU/I/O Lab](docs/cpu-io-lab.md).

### Original Streamlit interface

Install [Git](https://git-scm.com/downloads) and
[uv](https://docs.astral.sh/uv/getting-started/installation/), then run:

```sh
uv sync --locked
uv run streamlit run src/lbsim/app.py
```

uv selects Python 3.12 and installs the dependencies from `uv.lock` into a local
`.venv`. Open the URL printed by Streamlit, usually `http://localhost:8501`.
Set the server count, slots, queue capacity, workload, and seed in the sidebar,
then select **Run simulation**. Stop the app with Ctrl+C.

Run the checks from the repository root:

```sh
uv run python -m unittest discover -s tests -v
```

For ongoing development, use the `dev` branch. Keep `pyproject.toml`, `uv.lock`,
and `.python-version` in Git; each teammate creates their own local environment.

## Demo 1 materials

- [Design proposal](docs/design-proposal.md) and [original PDF](docs/design-proposal.pdf).
- [Presented slides](slides/demo-1.pdf), including simulation architecture and milestones.

These materials were consolidated after grading on October 6, 2026. The original
snapshot remains at [d01e823](https://github.com/ec528-fall26/load-balancing/tree/d01e823).
The PDF is the original proposal; the Markdown includes the added architecture diagram.

## Repository layout

| Path | Contents |
| --- | --- |
| `docs/` | Design proposal, implemented design document, and simulation contract |
| `slides/` | Demo slides (`demo-1.pdf`, `demo-2.pdf`, ...) |
| `src/lbsim/` | Python simulation engine, API, and Streamlit interface |
| `src/frontend/` | Next.js interface and browser tests |
| `experiments/` | Reproduction scripts and saved benchmark results |
| `tests/` | Simulator, metrics, interface, and playback checks |

## Reproducing our results

Every claim we make in a demo or in the final presentation has a corresponding
script in `experiments/`.

See [the design document](docs/design-document.md) for architecture, setup,
worked examples, metric definitions, and limitations. See
[the experiment instructions](experiments/README.md) for the saved scale baseline.

Run the same 10,000-request workload with 10, 100, and 1,000 servers:

```sh
uv run python experiments/scale_benchmark.py --repeats 3 --output experiments/results/d2-13-rerun
```

The command saves the trace, raw samples, and report in a separate directory,
preserving the checked-in baseline. Seeded outcomes should match; runtime and
peak memory depend on the machine.

The model uses identical servers and evenly spaced arrivals. Utilization means
occupied execution slots, not measured CPU use. Playback replays recorded events;
it does not run real servers or network requests. Development on `dev` now supports
round-robin and least-active-requests. The latter counts running requests only,
breaks ties by lowest server ID, and does not skip full targets. The graded
Demo 2 snapshot remains on `demo-2`.

## Download run configuration and results (D3-03)

After running a simulation, open **Download run** to save the last completed
configuration (JSON, including seed and schema version) and results (CSV, with
summary metrics and per-server utilization). Downloads retain the completed
run's settings even if you edit the form. See [the file format and real-run
example](docs/run-exports.md).

To reproduce a saved run, open **Replay a saved run** in the sidebar, upload its
configuration JSON, then select **Replay saved configuration**. The app verifies
the regenerated metrics against the saved fingerprint before replacing results.
To compare runs, open **Compare saved results** and upload two results CSVs.
Policies, all settings, latency, rejection and utilization appear side by side;
workload/capacity differences are flagged. See [saved-run instructions and
validation rules](docs/run-exports.md) for D3-04/05 and real examples.

## Submission checklist

Deliverables are collected from the named branch at **12:00 noon Boston time**
on the demo date. See the
[course submission instructions](https://ec528.github.io/ec528/fall26/setup/).

| Deliverable | Date | Branch | Must contain |
| --- | --- | --- | --- |
| Demo 1 | September 23 | `demo-1` | Slides, code, design proposal |
| Demo 2 | October 21 | `demo-2` | Slides, code, `docs/design-document.md`, demo video |
| Demo 3 | November 16 | `demo-3` | Slides, code, updated design document, demo video |
| Final | December 9 | `final-demo` | Slides, code, artifact documentation, recorded video presentation |

Demo 2 submission: [slides](slides/demo-2.pdf) · [demo video](videos/demo-2.mp4)

For each demo, two multiple-choice questions with marked answers are due to the
instructor by **5:30 pm** that day. Keep those questions within the team before
the presentation quiz.

## CPU/I/O in the main Lab

Single-pool simulations support simple service durations or CPU → I/O wait → CPU
in both one-shot and continuous mode. CPU/I/O templates prefill Setup;
least-outstanding routing accounts for CPU queues and I/O wait. See
[the model and verification guide](docs/cpu-io-lab.md) for configuration,
visualization, limits and tests. Existing simple-model runs remain supported.
