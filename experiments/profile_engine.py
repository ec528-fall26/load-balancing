"""D3-06: profile round-robin baseline and longer runs in fresh processes."""

import argparse
import cProfile
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import pstats
import statistics
import subprocess
import sys
from time import perf_counter

from lbsim.simulation import run_simulation
from scale_benchmark import CONFIG, ROOT


def fingerprint(summary):
    payload = json.dumps(summary, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def functions(profile):
    rows = []
    for (filename, line, name), (primitive, calls, own, cumulative, _) in pstats.Stats(profile).stats.items():
        path = Path(filename)
        if path.is_relative_to(ROOT):
            filename = str(path.relative_to(ROOT))
        rows.append(dict(file=filename, line=line, function=name, calls=calls,
                         primitive_calls=primitive, self_seconds=own,
                         cumulative_seconds=cumulative))
    return rows


def worker(args):
    config = {**CONFIG, 'server_count': args.servers,
              'duration': args.requests / CONFIG['arrival_rate']}
    # Imports, hashing, validation and file writes stay outside the timed region.
    profiler = cProfile.Profile() if args.profile else None
    start = perf_counter()
    if profiler:
        profiler.enable()
    summary = run_simulation(config)
    if profiler:
        profiler.disable()
    elapsed = perf_counter() - start
    if summary['completed_count'] + summary['rejected_count'] != args.requests:
        raise RuntimeError('Request conservation failed')
    states = {i: (0, 0) for i in range(args.servers)}
    for _, sid, running, waiting, _, _ in summary['events']:
        states[sid] = (running, waiting)
    if any(state != (0, 0) for state in states.values()):
        raise RuntimeError('Run did not drain')
    result = dict(config=config, elapsed_seconds=elapsed,
                  summary_sha256=fingerprint(summary), event_count=len(summary['events']),
                  completed_count=summary['completed_count'],
                  rejected_count=summary['rejected_count'])
    if profiler:
        profiler.dump_stats(str(args.profile))
        result['functions'] = functions(profiler)
    print(json.dumps(result))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'experiments/results/d3-06')
    parser.add_argument('--request-counts', nargs='+', type=int, default=[10000, 100000])
    parser.add_argument('--server-counts', nargs='+', type=int, default=[10, 100, 1000])
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--servers', type=int, help=argparse.SUPPRESS)
    parser.add_argument('--requests', type=int, help=argparse.SUPPRESS)
    parser.add_argument('--profile', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        worker(args)
        return
    if args.repeats < 1 or any(n < 1 for n in args.request_counts + args.server_counts):
        parser.error('Counts and repeats must be positive')
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    cases = []
    for requests in args.request_counts:
        for servers in args.server_counts:
            command = [sys.executable, str(Path(__file__).resolve()), '--worker',
                       '--servers', str(servers), '--requests', str(requests)]
            samples = []
            for _ in range(args.repeats):
                completed = subprocess.run(command, capture_output=True, text=True,
                                           check=True, cwd=ROOT, timeout=120)
                samples.append(json.loads(completed.stdout))
            profile_name = f'{requests}-requests-{servers}-servers.prof'
            completed = subprocess.run(command + ['--profile', str(args.output / profile_name)],
                                       capture_output=True, text=True, check=True,
                                       cwd=ROOT, timeout=120)
            profiled = json.loads(completed.stdout)
            if any(s['summary_sha256'] != profiled['summary_sha256'] for s in samples):
                raise RuntimeError('Profiled and unprofiled runs differ')
            rows = profiled.pop('functions')
            profiled['profile_file'] = profile_name
            profiled['samples_seconds'] = [s['elapsed_seconds'] for s in samples]
            profiled['median_unprofiled_seconds'] = statistics.median(profiled['samples_seconds'])
            profiled['functions_by_self'] = sorted(rows, key=lambda r: r['self_seconds'], reverse=True)
            profiled['functions_by_cumulative'] = sorted(rows, key=lambda r: r['cumulative_seconds'], reverse=True)
            cases.append(profiled)
            print(f'{requests} requests / {servers} servers: '
                  f'{profiled["median_unprofiled_seconds"]:.4f} s median; profile output matches')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    source_files = ['src/lbsim/simulation.py', 'src/lbsim/utils/generate_seed.py',
                    'src/lbsim/server.py', 'src/lbsim/metrics.py', 'experiments/profile_engine.py']
    report = dict(recorded_at_utc=datetime.now(timezone.utc).isoformat(),
                  revision=revision, python=sys.version, platform=platform.platform(),
                  machine=platform.machine(), processor=platform.processor(),
                  streamlit=importlib.metadata.version('streamlit'),
                  source_sha256={f: hashlib.sha256((ROOT / f).read_bytes()).hexdigest()
                                 for f in source_files},
                  scope='run_simulation only; fresh processes; profiler overhead excluded from baseline medians',
                  cases=cases)
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
