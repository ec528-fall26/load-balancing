"""D3-04/05: export two real policies, verify their replays, and save evidence."""

import argparse
import json
from pathlib import Path

from lbsim.exports import build_exports
from lbsim.saved_runs import load_configuration, load_results, replay_configuration
from lbsim.simulation import run_simulation

CONFIG = dict(server_count=2, concurrency=1, queue_limit=1, arrival_rate=8.0,
              duration=2.0, service_min=0.25, service_max=1.0, seed=42)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path,
                        default=Path("experiments/results/d3-04-05"))
    args = parser.parse_args()
    report = []
    for name, policy in (("run-a", "round_robin"), ("run-b", "least_active_requests")):
        config = {**CONFIG, "policy": policy}
        original = run_simulation(config)
        exported = build_exports(config, original)
        directory = args.output / name
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "config.json").write_bytes(exported.config_json)
        (directory / "results.csv").write_bytes(exported.results_csv)
        saved = load_configuration((directory / "config.json").read_bytes())
        replay = replay_configuration(saved)
        if replay != original:
            raise RuntimeError("Replayed full summary/events differed from the original run")
        result = load_results((directory / "results.csv").read_bytes())
        total = original["completed_count"] + original["rejected_count"]
        report.append({"name": name, "config": result.config, "run_id": result.run_id,
                       "replay_full_summary_matches": True,
                       "event_count": len(replay["events"]), "summary": result.summary,
                       "rejection_rate": original["rejected_count"] / total,
                       "mean_server_slot_utilization":
                       sum(result.summary["per_server_utilization"].values()) / config["server_count"]})
        print(f"{name}: {policy}, {original['completed_count']} completed, "
              f"{original['rejected_count']} rejected; replay verified")
    (args.output / "verification.json").write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Load the two results.csv files from {args.output} in Compare saved results.")


if __name__ == "__main__":
    main()
