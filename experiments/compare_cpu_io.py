"""Paired CPU/I/O routing experiment. No network or CPU runtime claims."""
import argparse
import csv
from dataclasses import asdict, replace
from hashlib import sha256
import json
from pathlib import Path
import platform
from random import Random
from statistics import mean
import subprocess
import sys

from lbsim.cpu_io import make_workload, run_staged
from lbsim.policies import policy_options


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('experiments/results/a-24-rerun'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    rows, runs, traces = [], [], {}
    for profile, fraction in [('cpu_heavy', .1), ('io_heavy', .9), ('mixed', .1)]:
        for rate in (40, 100, 400):
            for seed in (42, 43, 44):
                trace = make_workload(rate=rate, duration=10, seed=seed, io_fraction=fraction)
                if profile == 'mixed':
                    mixed = []
                    types = Random(2000000 + seed)
                    for r in trace:
                        if types.random() < .5:
                            total = r.cpu_first + r.io_wait + r.cpu_last
                            r = replace(r, cpu_first=total*.05, io_wait=total*.9, cpu_last=total*.05)
                        mixed.append(r)
                    trace = tuple(mixed)
                trace_id = f'{profile}-{rate}-{seed}'
                traces[trace_id] = [asdict(r) for r in trace]
                hashes = set()
                for policy in policy_options('cpu_io'):
                    config = dict(servers=8, cpu_slots=1, outstanding_limit=8,
                                  duration=10, policy=policy, routing_seed=1000000+seed)
                    result = run_staged(trace, **config)
                    assert result == run_staged(trace, **config), 'Seeded replay mismatch'
                    hashes.add(result['workload_sha256'])
                    signature = sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
                    row = dict(profile=profile, rate=rate, seed=seed, policy=policy,
                               offered=result['offered'], completed=result['completed'],
                               rejected=result['rejected'], rejection_rate=result['rejection_rate'],
                               mean_response=result['mean_response'], p95_response=result['p95_response'],
                               mean_cpu_queue_wait=result['mean_cpu_queue_wait'],
                               mean_io_waiting_per_server=mean(result['mean_io_waiting']),
                               mean_cpu_queued_per_server=mean(result['mean_cpu_queued']),
                               mean_cpu_utilization=mean(result['cpu_utilization']),
                               mean_outstanding_per_server=mean(result['mean_outstanding']),
                               max_outstanding_per_server=max(result['peak_outstanding']),
                               max_io_waiting_per_server=max(result['peak_io_waiting']),
                               end_time=result['end_time'],workload_sha256=result['workload_sha256'],
                               result_sha256=signature)
                    rows.append(row)
                    runs.append(dict(trace_id=trace_id,config=config,summary={k:v for k,v in result.items()
                                if k not in ('completions','rejected_ids','events')},
                                completed_ids_sha256=sha256(json.dumps(result['completions'],sort_keys=True).encode()).hexdigest(),
                                rejected_ids=result['rejected_ids'],result_sha256=signature))
                assert len(hashes) == 1, 'Policy workloads differ'
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output/'samples.csv').open('w') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    (args.output/'traces.json').write_text(json.dumps(traces,separators=(',',':'))+'\n')
    report=dict(python=sys.version,platform=platform.platform(),
                base_revision=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
                source_sha256={path:sha256((root/path).read_bytes()).hexdigest() for path in
                               ['src/lbsim/cpu_io.py','src/lbsim/policies.py','experiments/compare_cpu_io.py']},
                note='Source hashes identify local changes; no engine/runtime benchmark or production claim.',runs=runs)
    (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    lines=['# A-24: CPU/I/O routing comparison','',
           'Three seeds per row. Values average per-run metrics; p95 is the mean of three run p95s, not a pooled percentile.', '',
           '| Profile | Req/s | Policy | Rejected % | Mean response ms | p95 ms | CPU % | Mean outstanding/server |',
           '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |']
    for profile in ('cpu_heavy','io_heavy','mixed'):
        for rate in (40,100,400):
            for policy in policy_options('cpu_io'):
                group=[r for r in rows if (r['profile'],r['rate'],r['policy'])==(profile,rate,policy)]
                lines.append(f"| {profile} | {rate} | {policy} | {100*mean(r['rejection_rate'] for r in group):.2f} | {1000*mean(r['mean_response'] for r in group):.1f} | {1000*mean(r['p95_response'] for r in group):.1f} | {100*mean(r['mean_cpu_utilization'] for r in group):.1f} | {mean(r['mean_outstanding_per_server'] for r in group):.2f} |")
    lines += ['', '## Model and limits', '',
              'Eight servers, one CPU slot and eight outstanding requests per server; ten-second arrival window. Evenly spaced traffic; total no-contention service sampled uniformly from 80–120 ms. CPU-heavy uses 90% CPU/10% I/O; I/O-heavy uses 10% CPU/90% I/O. The mixed trace independently samples a 50/50 request type with Random(2000000 + seed), avoiding a periodic type pattern aligned with round robin. CPU work is split equally before/after I/O. Each profile/rate/seed trace is generated once and supplied unchanged to all policies.', '',
              'All policies choose using CPU-active counts (round robin ignores load). Least-active examines all servers with lowest-ID ties. Power-of-two samples two distinct servers, selects the lower CPU-active count and chooses the first sampled on a tie. Routing uses an independent Random(1000000 + seed); workload generation uses Random(seed). This is a specified P2C variant, not an exact implementation of a particular proxy.', '',
              'I/O delay releases CPU but retains the outstanding admission slot. I/O has no capacity limit or shared downstream contention. CPU1 and returning CPU2 share a non-preemptive FIFO. A full outstanding cap rejects without retry. CPU completion precedes I/O completion, then arrivals; same-kind ties use insertion order. Accepted work fully drains.', '',
              'CPU occupancy and mean outstanding are integrated over the arrival window only. Latency includes draining and excludes rejected work. Rejection, latency, occupancy and outstanding work must be read together. These simulated seconds are not Python runtime measurements or real CPU utilization.', '',
              '81 paired runs on 27 exact shared traces, each replayed once with exact full-result equality. Per-event assertions check request conservation, CPU bounds, outstanding caps and CPU + I/O + ready-queue accounting. Three seeds do not establish a general policy ranking; regular arrivals, fixed per-type stage proportions and an unbounded I/O resource limit realism. No faults, fan-out, retries, delayed telemetry, cloud deployment, CPU-sharing scheduler or UI integration.', '',
              '## Reproduce', '', '```sh', 'uv sync --locked', 'PYTHONPATH=src uv run python experiments/compare_cpu_io.py --output experiments/results/a-24-rerun', 'PYTHONPATH=src uv run python -m unittest discover -s tests -q', '```', '',
              'The experiment takes seconds locally, writes 81 rows to samples.csv, 27 input traces to traces.json and source/configuration/result fingerprints to report.json, plus this table. Use a different output directory to preserve evidence. No cloud or GPU is needed. Exact trace/result fields should match; machine metadata can differ.']
    (args.output/'analysis.md').write_text('\n'.join(lines)+'\n')
    print(f'Validated {len(rows)} runs plus exact replays on {len(traces)} shared traces. Results: {args.output}')


if __name__ == '__main__':
    main()
