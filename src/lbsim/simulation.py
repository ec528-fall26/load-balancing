"""Run the current simulator and summarize a fully drained run."""

from lbsim.metrics import summarize
from lbsim.settings import validate_config
from lbsim.utils.generate_seed import route


def run_simulation(values: dict) -> dict:
    config = validate_config(values)
    if config['policy'] != 'round_robin':
        raise ValueError('Only round-robin routing is implemented yet.')
    events = []
    completed, rejected = route(**config, events=events)
    summary = summarize(
        completed, rejected,
        duration=config['duration'],
        server_capacities={i: config['concurrency'] for i in range(config['server_count'])},
    )
    summary['events'] = events
    summary['response_times'] = [e.completion_time - e.request.arrival_time for e in completed]
    return summary
