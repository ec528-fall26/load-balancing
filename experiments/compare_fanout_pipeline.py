"""Run the fixed-work fan-out experiment across three paired seeds."""

import argparse
import json
from statistics import mean

from lbsim.fanout import experiment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--outage", action="store_true", help="Compare against a seeded 500 ms shard outage.")
    args = parser.parse_args()
    scenario = {"outage_ms": 500, "slowdown": 1} if args.outage else {}
    runs = [experiment({"seed": seed, **scenario}) for seed in (42, 43, 44)]
    summaries = []
    for index, case in enumerate(runs[0]["cases"]):
        samples = [run["cases"][index] for run in runs]
        successful_p95s = [row["p95_ms"] for row in samples if row["p95_ms"] is not None]
        successes = sum(row["completed"] for row in samples)
        service = sum(row["backend_service_ms"] for row in samples)
        summaries.append(dict(
            width=case["width"],
            condition=case["condition"],
            offered=sum(row["offered"] for row in samples),
            on_time=successes,
            outage_failed=sum(row["outage_failed"] for row in samples),
            timed_out=sum(row["timed_out"] for row in samples),
            rejected=sum(row["shard_rejected"] + row["coordinator_rejected"] for row in samples),
            mean_seed_p95_ms=mean(successful_p95s) if successful_p95s else None,
            backend_ms_per_success=service / successes if successes else None,
        ))
    print(json.dumps({"runs": runs, "summaries": summaries}, indent=2))


if __name__ == "__main__":
    main()
