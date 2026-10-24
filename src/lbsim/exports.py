"""Versioned, deterministic downloads for a completed simulation run."""

import csv
from dataclasses import dataclass
from hashlib import sha256
from io import StringIO
import json

from lbsim.settings import validate_config

SCHEMA_VERSION = 1
CONFIG_FIELDS = (
    "server_count", "concurrency", "queue_limit", "arrival_rate", "duration",
    "service_min", "service_max", "seed", "policy",
)
CSV_FIELDS = (
    "schema_version", "run_id", *CONFIG_FIELDS, "generated_count",
    "completed_count", "rejected_count", "mean_response_time_seconds",
    "p95_response_time_seconds", "server_id", "slot_utilization",
)


@dataclass(frozen=True)
class RunExports:
    run_id: str
    config_json: bytes
    results_csv: bytes


def build_exports(config: dict, summary: dict) -> RunExports:
    """Serialize the successful run's config and metrics without rerunning it.

    CSV has one row per server; global metrics repeat in each row. None latency
    values become empty cells. Events and individual response times are omitted.
    """
    config = validate_config(config)
    if "processing_rates" in config:
        raise ValueError("Exports do not support per-server processing rates yet "
                         "(schema version 1 has nine settings).")
    metrics = {key: summary[key] for key in (
        "completed_count", "rejected_count", "mean_response_time",
        "p95_response_time", "per_server_utilization",
    )}
    canonical = json.dumps({"schema_version": SCHEMA_VERSION, "config": config,
                            "metrics": metrics}, sort_keys=True, allow_nan=False)
    run_id = sha256(canonical.encode("utf-8")).hexdigest()
    config_json = json.dumps(
        {"schema_version": SCHEMA_VERSION, "run_id": run_id, "config": config},
        indent=2, allow_nan=False,
    ) + "\n"
    output = StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CSV_FIELDS)
    writer.writeheader()
    common = {
        "schema_version": SCHEMA_VERSION, "run_id": run_id, **config,
        "generated_count": summary["completed_count"] + summary["rejected_count"],
        "completed_count": summary["completed_count"],
        "rejected_count": summary["rejected_count"],
        "mean_response_time_seconds": summary["mean_response_time"],
        "p95_response_time_seconds": summary["p95_response_time"],
    }
    for server_id, utilization in sorted(summary["per_server_utilization"].items()):
        writer.writerow({**common, "server_id": server_id,
                         "slot_utilization": utilization})
    return RunExports(run_id, config_json.encode("utf-8"), output.getvalue().encode("utf-8"))
