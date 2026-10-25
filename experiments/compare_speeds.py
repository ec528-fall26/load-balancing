"""A-02: both routing policies on uniform and mixed-speed fleets, same seeded traces."""

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import random
import statistics
import subprocess

from compare_policies import BASE, POLICIES, SEEDS, sample
from lbsim.server import Request

ROOT = Path(__file__).resolve().parents[1]
#every fleet has the same total processing rate (10.0), so only the spread changes
#"fast_low_ids" and "fast_high_ids" are the same fleet with IDs reversed, because least-active breaks ties by lowest server ID
FLEETS = dict(uniform=None,
              fast_low_ids=(1.5,) * 5 + (0.5,) * 5,
              fast_high_ids=(0.5,) * 5 + (1.5,) * 5)
LOADS = dict(low=0.50, near_capacity=0.90, overload=1.20)
METRICS = ('rejection_fraction', 'mean_response_time_seconds', 'p95_response_time_seconds',
           'mean_wait_seconds', 'mean_utilization')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'experiments/results/a-02')
    output = parser.parse_args().output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    capacity = BASE['server_count'] * BASE['concurrency'] / ((BASE['service_min']+BASE['service_max'])/2)
    samples = []
    for scenario, load in LOADS.items():
        for seed in SEEDS:
            config = {**BASE, 'arrival_rate': capacity*load, 'seed': seed}
            rng = random.Random(seed)
            trace = [Request(i, i/config['arrival_rate'],
                             rng.uniform(config['service_min'], config['service_max']))
                     for i in range(int(config['arrival_rate']*config['duration']))]
            for fleet, rates in FLEETS.items():
                for policy in POLICIES:
                    # sample() checks the observed trace equals `trace`, validates
                    # routing, capacity, FIFO and draining, and replays the public API.
                    run = {**config, 'policy': policy}
                    if rates is not None:
                        run['processing_rates'] = rates
                    row = sample(run, trace)
                    row.update(scenario=scenario, seed=seed, fleet=fleet, policy=policy,
                               nominal_load=load)
                    row['config'] = {**row['config'], 'processing_rates': rates}
                    samples.append(row)
                    print(f"{scenario}, seed {seed}, {fleet}, {policy}: "
                          f"{row['completed_count']} completed / {row['rejected_count']} rejected")
    aggregates = []
    for scenario in LOADS:
        for fleet in FLEETS:
            for policy in POLICIES:
                rows = [s for s in samples if (s['scenario'], s['fleet'], s['policy'])
                        == (scenario, fleet, policy)]
                aggregates.append(dict(scenario=scenario, fleet=fleet, policy=policy, metrics={
                    key: dict(mean=statistics.fmean(r[key] for r in rows),
                              minimum=min(r[key] for r in rows),
                              maximum=max(r[key] for r in rows)) for key in METRICS}))
    files = ['experiments/compare_speeds.py', 'experiments/compare_policies.py',
             'src/lbsim/utils/generate_seed.py', 'src/lbsim/server.py',
             'src/lbsim/metrics.py', 'src/lbsim/simulation.py']
    report = dict(recorded_at_utc=datetime.now(timezone.utc).isoformat(),
                  revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                  source_sha256={f: hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in files},
                  python=platform.python_version(), platform=platform.platform(),
                  nominal_capacity_requests_per_second=capacity, seeds=SEEDS,
                  loads=LOADS, fleets=FLEETS, samples=samples, aggregates=aggregates)
    (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    columns = ['scenario', 'seed', 'fleet', 'policy', 'nominal_load', 'trace_sha256',
               'generated_count', 'completed_count', 'rejected_count', *METRICS,
               'rejected_with_other_queue_space', 'min_utilization', 'max_utilization']
    with (output/'samples.csv').open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(samples)
    print('\nMeans over seeds (rejected %, mean s, p95 s):')
    for a in aggregates:
        m = a['metrics']
        print(f"{a['scenario']:<14} {a['fleet']:<14} {a['policy']:<22} "
              f"{m['rejection_fraction']['mean']:6.1%} {m['mean_response_time_seconds']['mean']:6.3f} "
              f"{m['p95_response_time_seconds']['mean']:6.3f}")
    print(f'Validated {len(samples)} runs on {len(LOADS)*len(SEEDS)} shared traces.')


if __name__ == '__main__':
    main()
