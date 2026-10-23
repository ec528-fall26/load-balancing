"""Read version-one exports and verify replays against their saved metrics."""

import csv
from dataclasses import dataclass
from io import StringIO
import json
from math import isfinite
import re

from lbsim.exports import CONFIG_FIELDS, CSV_FIELDS, SCHEMA_VERSION, build_exports
from lbsim.settings import validate_config
from lbsim.simulation import run_simulation

MAX_FILE_BYTES = 5 * 1024 * 1024


@dataclass(frozen=True)
class SavedConfiguration:
    config: dict
    run_id: str


@dataclass(frozen=True)
class SavedResults:
    config: dict
    summary: dict
    run_id: str


def _text(data: bytes) -> str:
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("File is too large; use an export of at most 5 MiB.")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("File must use UTF-8 encoding.") from error


def _run_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("run_id must be the 64-character fingerprint from an export.")
    return value


def _version(value):
    if type(value) is not int or value != SCHEMA_VERSION:
        raise ValueError(f"Unsupported schema_version {value!r}; expected {SCHEMA_VERSION}.")


def _config(value):
    if not isinstance(value, dict) or set(value) != set(CONFIG_FIELDS):
        raise ValueError("Configuration must contain exactly the nine exported settings.")
    try:
        return validate_config(value)
    except OverflowError as error:
        raise ValueError("Configuration numbers must be finite and within supported numeric limits.") from error


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"JSON contains duplicate field {key!r}.")
        result[key] = value
    return result


def load_configuration(data: bytes) -> SavedConfiguration:
    try:
        document = json.loads(_text(data), object_pairs_hook=_unique_object)
    except (json.JSONDecodeError, RecursionError) as error:
        raise ValueError("Malformed JSON; upload an exported configuration file.") from error
    if not isinstance(document, dict) or set(document) != {"schema_version", "run_id", "config"}:
        raise ValueError("Expected an exported JSON object with schema_version, run_id and config.")
    _version(document["schema_version"])
    return SavedConfiguration(_config(document["config"]), _run_id(document["run_id"]))


def replay_configuration(saved: SavedConfiguration) -> dict:
    """Return a regenerated full run only when its exported metrics match."""
    summary = run_simulation(saved.config)
    if build_exports(saved.config, summary).run_id != saved.run_id:
        raise ValueError("Replay did not match the saved results fingerprint. The file may "
                         "have changed, or it may use a different simulator version. "
                         "Current results were not replaced.")
    return summary


def _integer(value, field):
    if not isinstance(value, str) or not re.fullmatch(r"-?(0|[1-9][0-9]*)", value):
        raise ValueError(f"CSV {field} must be an integer.")
    try:
        return int(value)
    except ValueError as error:
        raise ValueError(f"CSV {field} is not a supported integer.") from error


def _number(value, field):
    # JSON number parsing preserves int-vs-float configuration values, which are
    # significant to the export fingerprint (e.g. 1 versus 1.0).
    try:
        number = json.loads(value)
        valid = type(number) in (int, float) and isfinite(number)
    except (ValueError, TypeError, OverflowError, RecursionError):
        valid = False
    if not valid:
        raise ValueError(f"CSV {field} must be a finite number.")
    return number


def load_results(data: bytes) -> SavedResults:
    try:
        reader = csv.DictReader(StringIO(_text(data), newline=""), strict=True)
        if reader.fieldnames is None or len(reader.fieldnames) != len(CSV_FIELDS) or set(reader.fieldnames) != set(CSV_FIELDS):
            raise ValueError("CSV columns do not match the supported version-one results export.")
        rows = list(reader)
    except csv.Error as error:
        raise ValueError("Malformed CSV; upload an exported results file.") from error
    if not rows:
        raise ValueError("Results CSV must include one row per server, even for an empty run.")
    first = rows[0]
    common_fields = set(CSV_FIELDS) - {"server_id", "slot_utilization"}
    for row in rows:
        if None in row or any(value is None for value in row.values()):
            raise ValueError("CSV row has missing or extra cells.")
        if any(row[key] != first[key] for key in common_fields):
            raise ValueError("CSV rows disagree on the run configuration or global metrics.")
    _version(_integer(first["schema_version"], "schema_version"))
    run_id = _run_id(first["run_id"])
    config = _config({field: first[field] if field == "policy" else
                      _integer(first[field], field) if field in
                      {"server_count", "concurrency", "queue_limit", "seed"} else
                      _number(first[field], field) for field in CONFIG_FIELDS})
    if len(rows) != config["server_count"]:
        raise ValueError("CSV must contain exactly one row for each configured server.")
    counts = {field: _integer(first[field], field) for field in
              ("generated_count", "completed_count", "rejected_count")}
    if any(value < 0 for value in counts.values()):
        raise ValueError("CSV request counts cannot be negative.")
    if counts["generated_count"] != counts["completed_count"] + counts["rejected_count"]:
        raise ValueError("CSV completed plus rejected must equal generated requests.")
    try:
        expected_count = int(config["arrival_rate"] * config["duration"])
    except (OverflowError, ValueError) as error:
        raise ValueError("Configuration generates an unsupported request count.") from error
    if counts["generated_count"] != expected_count:
        raise ValueError("CSV request count does not match the configured workload.")
    latencies = {}
    for field in ("mean_response_time", "p95_response_time"):
        cell = first[field + "_seconds"]
        if counts["completed_count"] == 0:
            if cell != "":
                raise ValueError("CSV latency must be blank when no requests completed.")
            latencies[field] = None
        else:
            value = _number(cell, field)
            if value <= 0:
                raise ValueError("CSV response times must be positive.")
            latencies[field] = value
    utilization = {}
    for row in rows:
        sid = _integer(row["server_id"], "server_id")
        if not 0 <= sid < config["server_count"] or sid in utilization:
            raise ValueError("CSV server IDs must be unique and cover the configured servers.")
        value = _number(row["slot_utilization"], "slot_utilization")
        if not 0 <= value <= 1 + 1e-12:
            raise ValueError("CSV slot utilization must be a fraction from zero to one.")
        utilization[sid] = value
    summary = {"completed_count": counts["completed_count"],
               "rejected_count": counts["rejected_count"], **latencies,
               "per_server_utilization": utilization}
    if build_exports(config, summary).run_id != run_id:
        raise ValueError("CSV fingerprint does not match its configuration and metrics. "
                         "Upload the original exported results without editing cells.")
    return SavedResults(config, summary, run_id)
