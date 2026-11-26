"""Shared configuration validation for the UI, engine and experiment scripts."""

from collections.abc import Mapping

from math import isfinite

from lbsim.policies import supports_policy


def validate_config(values: Mapping, *, allow_manual_repair: bool = False) -> dict:
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
        if 'disk' in values:
            disk = values['disk']
            bounds = {'read_fraction': (0, 1), 'read_ms': (.001, 60000), 'write_ms': (.001, 60000)}
            optional = {'write_size_kib': (0, 65536), 'write_speed_mib_s': (2, 10000)}
            if (not isinstance(disk, Mapping) or not bounds.keys() <= disk.keys()
                    or not disk.keys() <= bounds.keys() | optional.keys()):
                errors.append('disk: set read_fraction, read_ms and write_ms')
            else:
                for key, value in disk.items():
                    minimum, maximum = (bounds | optional)[key]
                    if type(value) not in (int, float) or not isfinite(value) or not minimum <= value <= maximum:
                        errors.append(f'disk.{key}: use a finite value from {minimum} to {maximum}')
    elif any(k in values for k in ('io_fraction', 'outstanding_limit', 'io_capacity', 'io_heavy_probability', 'disk')):
        errors.append('request_model: CPU/I/O settings require the cpu_io model')
    retry = values.get("retry")
    if "retry" in values:
        if model != "simple":
            errors.append("retry: client retries require the simple request model")
        if not isinstance(retry, Mapping) or retry.keys() != {"mode", "limit", "base_ms"}:
            errors.append("retry: set mode, limit and base_ms")
        else:
            if retry["mode"] not in ("off", "immediate", "backoff"):
                errors.append("retry.mode: choose off, immediate or backoff")
            if type(retry["limit"]) is not int or not 1 <= retry["limit"] <= 5:
                errors.append("retry.limit: use 1–5 retries per request")
            base = retry["base_ms"]
            if type(base) not in (int, float) or not isfinite(base) or not 1 <= base <= 10000:
                errors.append("retry.base_ms: use 1–10,000 milliseconds")
    rates = values.get("processing_rates")
    if rates is not None:
        if type(rates) not in (list, tuple):
            errors.append("processing_rates: must be a list with one rate per server")
        else:
            if type(values.get("server_count")) is int and len(rates) != values["server_count"]:
                errors.append("processing_rates: must have one rate per server")
            if any(type(r) not in (int, float) or not isfinite(r) or r <= 0 for r in rates):
                errors.append("processing_rates: each rate must be finite and greater than zero")
    availabilities = values.get("availabilities")
    repair = values.get("mean_repair_time", 1.0)
    if availabilities is not None:
        if type(availabilities) not in (list, tuple):
            errors.append("availabilities: must be a list with one value per server")
        else:
            if type(values.get("server_count")) is int and len(availabilities) != values["server_count"]:
                errors.append("availabilities: must have one value per server")
            if any(type(r) not in (int, float) or not isfinite(r) or not 0 < r <= 1
                   for r in availabilities):
                errors.append("availabilities: each value must be greater than 0 and at most 1")
        if model == 'cpu_io':
            errors.append("availabilities: server outages require the simple request model")
    # One shared repair time, or one per server like availabilities.
    repairs = repair if type(repair) in (list, tuple) else [repair]
    if type(repair) in (list, tuple) and type(values.get("server_count")) is int \
            and len(repair) != values["server_count"]:
        errors.append("mean_repair_time: use one value, or one value per server")
    if not repairs or any(type(r) not in (int, float) or not isfinite(r) or r <= 0 for r in repairs):
        errors.append("mean_repair_time: each value must be finite and greater than zero")
    if errors:
        raise ValueError("; ".join(errors))
    keys = ("server_count", "concurrency", "queue_limit", "arrival_rate", "duration",
            "service_min", "service_max", "seed", "policy")
    config = {key: values[key] for key in keys}
    # All-1.0 rates are the uniform model, so they keep the original nine-field config.
    if rates is not None and any(r != 1 for r in rates):
        config["processing_rates"] = tuple(float(r) for r in rates)
    # Always-available fleets are the original model and keep the original config.
    if availabilities is not None and any(r < 1 for r in availabilities):
        config["availabilities"] = tuple(float(r) for r in availabilities)
    if "availabilities" in config or (
        allow_manual_repair and model == "simple" and "mean_repair_time" in values
    ):
        # A list of equal values is the same as one shared value.
        config["mean_repair_time"] = (float(repairs[0]) if all(r == repairs[0] for r in repairs)
                                      else tuple(float(r) for r in repairs))
    if model == 'cpu_io':
        config.update(request_model=model, io_fraction=fraction, outstanding_limit=cap, io_capacity=io_capacity)
        if mix is not None: config["io_heavy_probability"] = mix
        if 'disk' in values:
            config['disk'] = dict(values['disk'])
    if retry is not None and retry["mode"] != "off":
        config["retry"] = dict(retry)
    return config
