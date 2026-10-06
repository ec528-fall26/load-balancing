# Design Document

*Due in the `demo-2` branch, updated for `demo-3` and `final-demo`.
**The TA will run this document.** If they cannot follow it, you lose the points.*

## 1. Architecture

What you actually built — not what you originally planned. Include a diagram.

## 2. Design decisions

The choices that mattered, the alternatives, and why you chose as you did.
Include the things that did not work.

## 3. Setup

Exact dependencies, versions, and hardware assumptions. Written so that someone
starting from a clean machine can follow it.

```bash
# every command needed to go from a fresh machine to a runnable system
```

## 4. Running the experiments

One entry per claim you make. Someone else runs these; you do not get to
explain them in person.

### Experiment 1: D2-13 round-robin scale baseline

| | |
| --- | --- |
| Supports | Local baseline runtime and peak process memory for the same 10,000-request trace with 10, 100 and 1,000 servers. |
| Setup | From the repository root, install uv and run `uv sync --locked` (Python 3.12 is selected by `.python-version`). |
| Command | `uv run python experiments/scale_benchmark.py --repeats 3 --output experiments/results/d2-13` |
| Expected runtime | Typically under one minute on the recorded machine; each worker has a 120-second timeout. |
| Expected output | Nine sample lines, followed by saved `trace.csv`, `samples.csv`, and `report.json`. See [the benchmark instructions](../experiments/README.md) for methodology and recorded results. |

The script checks the actual generated trace against the saved trace's SHA-256 for every sample, verifies seeded replay and request conservation, and checks that every server is idle after draining. Counts and trace hashes should match the recorded run; wall-clock time and peak memory vary by machine and load. This experiment is a round-robin baseline, not a comparison of routing policies.

### Experiment 2: <...>

## 5. Claims and limitations

What your artifact supports, and an honest account of what does not work or was
not tested. *An honest narrower result scores better than an impressive result we
cannot reproduce.*
