# EC528 Project — Load Modeling and Load Balancing Simulation Platform

**Team:** Daniel Thomas, Kimone Walker, Neev Jain, Sean O'Connor

**Mentor:** Shripad Nadgowda (Meta)

**Project:** A web application for simulating request traffic, server queues, and load-balancing policies.

## What this is

Uneven traffic can overload some servers while leaving others underused. This
simulator lets users configure a server pool and workload, then inspect request
outcomes, response times, and server utilization.

The Demo 2 prototype runs locally with round-robin routing, bounded FIFO queues,
repeatable seeded workloads, result charts, and recorded-event playback.
Least-active-requests and saved-run comparison are planned for Demo 3.

## Quick start

Install [Git](https://git-scm.com/downloads) and
[uv](https://docs.astral.sh/uv/getting-started/installation/), then run:

```sh
git clone --branch demo-2 https://github.com/ec528-fall26/load-balancing.git
cd load-balancing
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
| `src/` | Simulation engine, server model, metrics, and Streamlit interface |
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
it does not run real servers or network requests. Only round-robin is implemented.

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

The `demo-2` branch is created. Demo 2 slides and the video still need to be added
before submission. Sync the completed work from `dev` into `demo-2` and push it
before the deadline.

For each demo, two multiple-choice questions with marked answers are due to the
instructor by **5:30 pm** that day. Keep those questions within the team before
the presentation quiz.
