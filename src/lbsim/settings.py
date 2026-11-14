"""Shared configuration validation for the UI, engine and experiment scripts."""

from collections.abc import Mapping

from math import isfinite

from lbsim.policies import supports_policy


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
    if not supports_policy(values.get("policy")):
        errors.append("policy: select a supported routing policy")
    model = values.get('request_model', 'simple')
    if model not in ('simple', 'cpu_io'):
        errors.append('request_model: choose simple or cpu_io')
    if model == 'cpu_io':
        fraction = values.get('io_fraction', .9)
        cap = values.get('outstanding_limit')
        io_capacity = values.get('io_capacity', 64)
        mix = values.get('io_heavy_probability')
        if type(io_capacity) is not int or not 1 <= io_capacity <= 4096:
            errors.append('io_capacity: use 1–4096 shared concurrent I/O operations')
        if mix is not None and (type(mix) not in (int, float) or not isfinite(mix) or not 0 <= mix <= 1):
            errors.append('io_heavy_probability: use a finite fraction from zero to one')
        if type(fraction) not in (int, float) or not isfinite(fraction) or not 0 <= fraction <= .99:
            errors.append('io_fraction: use a finite fraction from zero to 0.99')
        if type(cap) is not int or cap < 1:
            errors.append('outstanding_limit: use a positive integer per server')
    elif any(k in values for k in ('io_fraction', 'outstanding_limit', 'io_capacity', 'io_heavy_probability')):
        errors.append('request_model: CPU/I/O settings require the cpu_io model')
    rates = values.get("processing_rates")
    if rates is not None:
        if type(rates) not in (list, tuple):
            errors.append("processing_rates: must be a list with one rate per server")
        else:
            if type(values.get("server_count")) is int and len(rates) != values["server_count"]:
                errors.append("processing_rates: must have one rate per server")
            if any(type(r) not in (int, float) or not isfinite(r) or r <= 0 for r in rates):
                errors.append("processing_rates: each rate must be finite and greater than zero")
    reliabilities = values.get("reliabilities")
    repair = values.get("mean_repair_time", 1.0)
    if reliabilities is not None:
        if type(reliabilities) not in (list, tuple):
            errors.append("reliabilities: must be a list with one value per server")
        else:
            if type(values.get("server_count")) is int and len(reliabilities) != values["server_count"]:
                errors.append("reliabilities: must have one value per server")
            if any(type(r) not in (int, float) or not isfinite(r) or not 0 < r <= 1
                   for r in reliabilities):
                errors.append("reliabilities: each value must be greater than 0 and at most 1")
        if model == 'cpu_io':
            errors.append("reliabilities: server outages require the simple request model")
    if type(repair) not in (int, float) or not isfinite(repair) or repair <= 0:
        errors.append("mean_repair_time: must be finite and greater than zero")
    if errors:
        raise ValueError("; ".join(errors))
    keys = ("server_count", "concurrency", "queue_limit", "arrival_rate", "duration",
            "service_min", "service_max", "seed", "policy")
    config = {key: values[key] for key in keys}
    # All-1.0 rates are the uniform model, so they keep the original nine-field config.
    if rates is not None and any(r != 1 for r in rates):
        config["processing_rates"] = tuple(float(r) for r in rates)
    # Fully reliable fleets are the original model and keep the original config.
    if reliabilities is not None and any(r < 1 for r in reliabilities):
        config["reliabilities"] = tuple(float(r) for r in reliabilities)
        config["mean_repair_time"] = float(repair)
    if model == 'cpu_io':
        config.update(request_model=model, io_fraction=fraction, outstanding_limit=cap, io_capacity=io_capacity)
        if mix is not None: config["io_heavy_probability"] = mix
    return config


def build_config(**values) -> dict:
    """Build a validated config from form values."""
    return validate_config(values)
