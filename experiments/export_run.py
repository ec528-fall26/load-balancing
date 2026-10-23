"""Export a real, fixed overload example for D3-03 from the repository root."""

import argparse
from pathlib import Path

from lbsim.exports import build_exports
from lbsim.simulation import run_simulation

CONFIG = dict(server_count=1, concurrency=1, queue_limit=1, arrival_rate=4.0,
              duration=1.0, service_min=1.0, service_max=1.0, seed=42,
              policy="round_robin")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path,
                        default=Path("experiments/results/d3-03"))
    args = parser.parse_args()
    summary = run_simulation(CONFIG)
    export = build_exports(CONFIG, summary)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "config.json").write_bytes(export.config_json)
    (args.output / "results.csv").write_bytes(export.results_csv)
    print(f"Run {export.run_id}: {summary['completed_count']} completed, "
          f"{summary['rejected_count']} rejected")
    print(f"Exported config.json and results.csv to {args.output}")


if __name__ == "__main__":
    main()
