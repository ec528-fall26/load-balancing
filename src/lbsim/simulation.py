"""Run the current simulator and summarize a fully drained run."""

from lbsim.metrics import summarize
from lbsim.availability import outage_schedule
from lbsim.settings import validate_config
from lbsim.utils.generate_seed import route


def run_simulation(values: dict) -> dict:
    config = validate_config(values)
    if config.get("request_model") == "cpu_io":
        from lbsim.staged import run_staged_simulation
        return run_staged_simulation(config)
    events = []
    outages = None
    if "availabilities" in config:
        outages = outage_schedule(config["availabilities"], config["mean_repair_time"],
                                  config["duration"], config["seed"])
    interrupted = []
    completed, rejected = route(**config, events=events, outages=outages, interrupted=interrupted)
    summary = summarize(
        completed, rejected,
        duration=config['duration'],
        server_capacities={i: config['concurrency'] for i in range(config['server_count'])},
        interrupted=interrupted,
    )
    summary['events'] = events
    summary['response_times'] = [e.completion_time - e.request.arrival_time for e in completed]
    if 'retry' in config:
        summary['retry_attempts'] = sum(event[4].startswith('retry_') and
                                        event[4] != 'retry_scheduled' for event in events)
    if outages is not None:
        # Only availability runs gain these keys, so existing summaries stay byte-identical.
        duration = config['duration']
        summary['rerouted_count'] = sum(e[4] in ('rerouted', 'reroute_rejected') for e in events)
        # Requests moved off each server because it failed. route() records a
        # server's re-routes immediately after its server_down event.
        by_server = {sid: {'rerouted': 0, 'rejected': 0} for sid in outages}
        failed = None
        for e in events:
            if e[4] == 'server_down':
                failed = e[1]
            elif e[4] == 'rerouted':
                by_server[failed]['rerouted'] += 1
            elif e[4] == 'reroute_rejected':
                by_server[failed]['rejected'] += 1
        summary['rerouted_by_server'] = by_server
        # Every rejection falls in exactly one bucket; they sum to rejected_count.
        summary['rejected_breakdown'] = {
            'queue_full': sum(e[4] in ('rejected', 'retry_rejected') for e in events),
            'no_server_up': sum(e[4] in ('no_server_up', 'retry_no_server_up') for e in events),
            'reroute_rejected': sum(e[4] == 'reroute_rejected' for e in events),
        }
        summary['outages'] = {sid: [list(i) for i in intervals] for sid, intervals in outages.items()}
        summary['per_server_availability'] = {
            sid: 1 - sum(min(end, duration) - start for start, end in intervals) / duration
            for sid, intervals in outages.items()
        }
    return summary
