# EC528 Project — Load Modeling and Load Balancing Simulation Platform

**Team:** <names>
**Mentor:** Shripad Nadgowda (Meta)
**Project:** <one sentence: what this system does>

## What this is

<2-3 sentences. The problem, and what your system does about it.>

## Quick start

```bash
uv sync
uv run python -m unittest discover -s tests -v
```

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) first. `uv sync`
creates a local `.venv` using Python 3.12 and the versions in `uv.lock`.
The environment stays on each teammate's machine; commit `pyproject.toml`,
`.python-version`, and `uv.lock` so everyone uses the same project setup.
Add future runtime dependencies with `uv add <package>` and commit the updated
project file and lockfile together. There are no third-party dependencies yet.

## Repository layout

| Path | Contents |
| --- | --- |
| `docs/` | Design proposal and design document |
| `slides/` | Demo slides (`demo-1.pdf`, `demo-2.pdf`, ...) |
| `src/` | Source code |
| `experiments/` | Scripts that reproduce every result you claim |

## Reproducing our results

See [`docs/design-document.md`](docs/design-document.md). Every claim we make in a
demo or in the final presentation has a corresponding script in `experiments/`.

## Submission checklist

Deliverables are collected from a **branch named for the demo**, at **12:00 noon**
on the day of that demo. See the
[submission instructions](https://ec528.github.io/ec528/fall26/setup/).

| Deliverable | Branch | Must contain |
| --- | --- | --- |
| Demo 1 | `demo-1` | slides, code, `docs/design-proposal.md` |
| Demo 2 | `demo-2` | slides, code, `docs/design-document.md`, demo video |
| Demo 3 | `demo-3` | slides, code, updated `docs/design-document.md`, demo video |
| Final | `final-demo` | slides, code, artifact documentation, recorded video presentation |
