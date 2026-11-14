"""Run the current simulator and summarize a fully drained run."""

from lbsim.metrics import summarize
from lbsim.reliability import outage_schedule
from lbsim.settings import validate_config
from lbsim.utils.generate_seed import route


def run_simulation(values: dict) -> dict:
    config = validate_config(values)
    if config.get("request_model") == "cpu_io":
        from lbsim.staged import run_staged_simulation
        return run_staged_simulation(config)
    events = []
    outages = None
    if "reliabilities" in config:
        outages = outage_schedule(config["reliabilities"], config["mean_repair_time"],
                                  config["duration"], config["seed"])
    completed, rejected = route(**config, events=events, outages=outages)
    summary = summarize(
        completed, rejected,
        duration=config['duration'],
        server_capacities={i: config['concurrency'] for i in range(config['server_count'])},
    )
    summary['events'] = events
    summary['response_times'] = [e.completion_time - e.request.arrival_time for e in completed]
    if outages is not None:
        # Only reliability runs gain these keys, so existing summaries stay byte-identical.
        duration = config['duration']
        summary['rerouted_count'] = sum(e[4] in ('rerouted', 'reroute_rejected') for e in events)
        summary['outages'] = {sid: [list(i) for i in intervals] for sid, intervals in outages.items()}
        summary['per_server_availability'] = {
            sid: 1 - sum(min(end, duration) - start for start, end in intervals) / duration
            for sid, intervals in outages.items()
        }
    return summary
