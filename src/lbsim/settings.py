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
    rates = values.get("processing_rates")
    if rates is not None:
        if type(rates) not in (list, tuple):
            errors.append("processing_rates: must be a list with one rate per server")
        else:
            if type(values.get("server_count")) is int and len(rates) != values["server_count"]:
                errors.append("processing_rates: must have one rate per server")
            if any(type(r) not in (int, float) or not isfinite(r) or r <= 0 for r in rates):
                errors.append("processing_rates: each rate must be finite and greater than zero")
    if errors:
        raise ValueError("; ".join(errors))
    keys = ("server_count", "concurrency", "queue_limit", "arrival_rate", "duration",
            "service_min", "service_max", "seed", "policy")
    config = {key: values[key] for key in keys}
    # All-1.0 rates are the uniform model, so they keep the original nine-field config.
    if rates is not None and any(r != 1 for r in rates):
        config["processing_rates"] = tuple(float(r) for r in rates)
    return config


def build_config(**values) -> dict:
    """Build a validated config from form values."""
    return validate_config(values)
