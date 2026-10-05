"""Shared configuration validation for the UI, engine and experiment scripts."""

from collections.abc import Mapping

from math import isfinite


def validate_config(values: Mapping) -> dict:
    """Validate configuration fields and return a new config dictionary."""
    errors = []
    for key in ("server_count", "concurrency", "queue_limit", "seed"):
        value = values.get(key)
        minimum = 0 if key == "queue_limit" else 1
        if type(value) is not int:
            errors.append(f"{key}: must be an integer")
        elif key != "seed" and value < minimum:
            errors.append(f"{key}: must be at least {minimum}")
    for key in ("arrival_rate", "duration", "service_min", "service_max"):
        value = values.get(key)
        if type(value) not in (int, float) or not isfinite(value) or value <= 0:
            errors.append(f"{key}: must be finite and greater than zero")
    if not errors and values["service_min"] > values["service_max"]:
        errors.append("service_min must be less than or equal to service_max")
    if values.get("policy") not in ("round_robin", "least_active_requests"):
        errors.append("policy: select a supported routing policy")
    if errors:
        raise ValueError("; ".join(errors))
    keys = ("server_count", "concurrency", "queue_limit", "arrival_rate", "duration",
            "service_min", "service_max", "seed", "policy")
    return {key: values[key] for key in keys}


def build_config(**values) -> dict:
    """Build a validated config from form values."""
    return validate_config(values)
