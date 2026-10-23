"""D3-02: paired seeded routing-policy experiments, not CPU benchmarks."""

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import random
import statistics
import struct
import subprocess
from unittest.mock import patch

from lbsim.metrics import summarize
from lbsim.server import Request
from lbsim.simulation import run_simulation
from lbsim.utils.generate_seed import route

ROOT = Path(__file__).resolve().parents[1]
BASE = dict(server_count=10, concurrency=1, queue_limit=10, duration=100.0,
            service_min=0.1, service_max=1.0)
SEEDS = (42, 43, 44)
SCENARIOS = dict(low=0.50, near_capacity=0.90, overload=1.20,
                 near_plus_20_percent=0.90 * 1.20)
POLICIES = ('round_robin', 'least_active_requests')


def digest_trace(trace):
    digest = hashlib.sha256()
    for request in trace:
        digest.update(struct.pack('!qdd', request.id, request.arrival_time,
                                  request.service_time))
    return digest.hexdigest()


def validate(events, completed, rejected, config):
    generated = int(config['arrival_rate'] * config['duration'])
    ids = [e.request.id for e in completed] + rejected
    if sorted(ids) != list(range(generated)):
        raise RuntimeError('Missing, duplicate or unexpected outcomes')
    states = {sid: (0, 0) for sid in range(config['server_count'])}
    arrivals = 0
    previous = -1.0
    rejected_with_other_queue_space = 0
    for now, sid, running, waiting, action, request_id in events:
        if now < previous:
            raise RuntimeError('Events moved backwards')
        previous = now
        if action != 'completed':
            target = (arrivals % config['server_count'] if config['policy'] == 'round_robin'
                      else min(states, key=lambda s: (states[s][0], s)))
            if sid != target or request_id != arrivals:
                raise RuntimeError('Routing does not match the current state or arrival order')
            if action == 'rejected' and states[sid] != (config['concurrency'], config['queue_limit']):
                raise RuntimeError('Rejected before the selected server was full')
            if action == 'rejected' and any(other != sid and state[1] < config['queue_limit']
                                             for other, state in states.items()):
                rejected_with_other_queue_space += 1
            arrivals += 1
        if not (0 <= running <= config['concurrency'] and 0 <= waiting <= config['queue_limit']):
            raise RuntimeError('Capacity exceeded')
        states[sid] = running, waiting
    if arrivals != generated or any(state != (0, 0) for state in states.values()):
        raise RuntimeError('Arrival count or final drain incorrect')
    for sid in states:
        executions = sorted((e for e in completed if e.server_id == sid),
                            key=lambda e: e.request.id)
        if [e.start_time for e in executions] != sorted(e.start_time for e in executions):
            raise RuntimeError('FIFO violated')
    return dict(rejected_with_other_queue_space=rejected_with_other_queue_space)


def sample(config, expected_trace):
    observed = []

    def observe(*args):
        request = Request(*args)
        observed.append(request)
        return request

    events = []
    with patch('lbsim.utils.generate_seed.Request', side_effect=observe):
        completed, rejected = route(**config, events=events)
    if observed != expected_trace:
        raise RuntimeError('Actual workload differs from the reference trace')
    diagnostics = validate(events, completed, rejected, config)
    summary = summarize(completed, rejected, duration=config['duration'],
                        server_capacities={i: config['concurrency']
                                           for i in range(config['server_count'])})
    summary['events'] = events
    summary['response_times'] = [e.completion_time - e.request.arrival_time for e in completed]
    if run_simulation(config) != summary:
        raise RuntimeError('Public API replay differs from the observed run')
    utilization = list(summary['per_server_utilization'].values())
    if any(not 0 <= u <= 1.000000001 for u in utilization):
        raise RuntimeError('Utilization outside valid range')
    count = len(observed)
    return dict(**diagnostics, completed_count=len(completed), rejected_count=len(rejected),
                generated_count=count, rejection_fraction=len(rejected)/count,
                mean_response_time_seconds=summary['mean_response_time'],
                p95_response_time_seconds=summary['p95_response_time'],
                mean_wait_seconds=statistics.fmean(e.start_time-e.request.arrival_time
                                                   for e in completed),
                mean_utilization=statistics.fmean(utilization),
                min_utilization=min(utilization), max_utilization=max(utilization),
                utilization_population_stdev=statistics.pstdev(utilization),
                per_server_utilization=summary['per_server_utilization'],
                final_event_seconds=events[-1][0],
                trace_sha256=digest_trace(observed),
                summary_sha256=hashlib.sha256(json.dumps(summary, sort_keys=True).encode()).hexdigest(),
                config=config)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'experiments/results/d3-02')
    args = parser.parse_args()
    output = args.output.resolve()
    (output/'traces').mkdir(parents=True, exist_ok=True)
    capacity = BASE['server_count'] * BASE['concurrency'] / ((BASE['service_min']+BASE['service_max'])/2)
    samples = []
    for scenario, load in SCENARIOS.items():
        for seed in SEEDS:
            config = {**BASE, 'arrival_rate': capacity*load, 'seed': seed}
            rng = random.Random(seed)
            trace = [Request(i, i/config['arrival_rate'],
                             rng.uniform(config['service_min'], config['service_max']))
                     for i in range(int(config['arrival_rate']*config['duration']))]
            filename = f'traces/{scenario}-seed-{seed}.csv'
            with (output/filename).open('w', newline='') as stream:
                writer = csv.writer(stream)
                writer.writerow(['request_id', 'arrival_seconds', 'service_seconds'])
                writer.writerows((r.id, r.arrival_time, r.service_time) for r in trace)
            for policy in POLICIES:
                row = sample({**config, 'policy': policy}, trace)
                row.update(scenario=scenario, seed=seed, policy=policy,
                           nominal_load=load, trace_file=filename)
                samples.append(row)
                print(f"{scenario}, seed {seed}, {policy}: "
                      f"{row['completed_count']} completed / {row['rejected_count']} rejected")
    metrics = ['rejection_fraction', 'mean_response_time_seconds', 'p95_response_time_seconds',
               'mean_wait_seconds', 'mean_utilization', 'utilization_population_stdev']
    aggregates = []
    for scenario in SCENARIOS:
        for policy in POLICIES:
            rows = [s for s in samples if s['scenario']==scenario and s['policy']==policy]
            aggregates.append(dict(scenario=scenario, policy=policy, metrics={
                key: dict(mean=statistics.fmean(r[key] for r in rows),
                          minimum=min(r[key] for r in rows), maximum=max(r[key] for r in rows),
                          sample_stdev=statistics.stdev(r[key] for r in rows)) for key in metrics}))
    files = ['experiments/compare_policies.py', 'src/lbsim/utils/generate_seed.py',
             'src/lbsim/server.py', 'src/lbsim/metrics.py', 'src/lbsim/simulation.py']
    report = dict(recorded_at_utc=datetime.now(timezone.utc).isoformat(),
                  revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                  source_sha256={f: hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in files},
                  python=platform.python_version(), platform=platform.platform(),
                  nominal_capacity_requests_per_second=capacity, seeds=SEEDS,
                  scenarios=SCENARIOS, samples=samples, aggregates=aggregates)
    (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    columns = ['scenario', 'seed', 'policy', 'nominal_load', 'trace_file', 'trace_sha256',
               'generated_count', 'completed_count', 'rejected_count', *metrics,
               'rejected_with_other_queue_space', 'min_utilization', 'max_utilization',
               'final_event_seconds']
    with (output/'samples.csv').open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(samples)
    with (output/'server-utilization.csv').open('w', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow(['scenario', 'seed', 'policy', 'server_id', 'utilization'])
        for row in samples:
            writer.writerows((row['scenario'], row['seed'], row['policy'], sid, value)
                             for sid, value in row['per_server_utilization'].items())
    print('Validated 24 runs and public-API replays; saved 12 shared traces and all metrics.')


if __name__ == '__main__':
    main()
