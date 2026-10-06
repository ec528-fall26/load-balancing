"""D2-13: reproducible 10,000-request baseline, using fresh worker processes."""

import argparse
import csv
import ctypes
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import random
import statistics
import struct
import subprocess
import sys
from time import perf_counter
from datetime import datetime, timezone
from unittest.mock import patch

from lbsim.server import Request
from lbsim.simulation import run_simulation

ROOT = Path(__file__).resolve().parents[1]
CONFIG = dict(concurrency=1, queue_limit=10, policy="round_robin",
              arrival_rate=100.0, duration=100.0, service_min=0.1,
              service_max=1.0, seed=42)
SERVER_COUNTS = (10, 100, 1000)
REQUEST_COUNT = 10000


def hash_request(digest, request_id, arrival, service):
    digest.update(struct.pack("!qdd", request_id, arrival, service))


def peak_process_bytes():
    """OS process high-water mark, including interpreter/imports (not allocations)."""
    if sys.platform == "win32":
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in (
                    "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                    "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                    "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            raise ctypes.WinError(ctypes.get_last_error())
        return counters.PeakWorkingSetSize
    import resource
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(peak if sys.platform == "darwin" else peak * 1024)


def worker(server_count):
    config = {**CONFIG, "server_count": server_count}
    started = perf_counter()
    summary = run_simulation(config)
    elapsed = perf_counter() - started
    peak = peak_process_bytes()  # Snapshot before validation allocates anything.

    # Observe the actual generator, including requests that are later rejected.
    digest = hashlib.sha256()
    generated = 0

    def observe(request_id, arrival, service):
        nonlocal generated
        generated += 1
        hash_request(digest, request_id, arrival, service)
        return Request(request_id, arrival, service)

    with patch("lbsim.utils.generate_seed.Request", side_effect=observe):
        repeated = run_simulation(config)
    if summary != repeated:
        raise RuntimeError("Seeded replay changed simulation output")
    events = summary["events"]
    states = {sid: (0, 0) for sid in range(server_count)}
    completed = rejected = arrived = 0
    previous = -1.0
    for timestamp, sid, running, queued, action, _ in events:
        if timestamp < previous:
            raise RuntimeError("Events are out of time order")
        previous = timestamp
        if not (0 <= running <= CONFIG["concurrency"] and 0 <= queued <= CONFIG["queue_limit"]):
            raise RuntimeError("Server exceeded slot or queue capacity")
        states[sid] = (running, queued)
        completed += action == "completed"
        rejected += action == "rejected"
        arrived += action != "completed"
    if not (generated == arrived == REQUEST_COUNT == completed + rejected):
        raise RuntimeError("Request conservation failed")
    if any(state != (0, 0) for state in states.values()):
        raise RuntimeError("Servers are not idle after draining")
    if completed != summary["completed_count"] or rejected != summary["rejected_count"]:
        raise RuntimeError("Event totals disagree with summary")
    return dict(server_count=server_count, runtime_seconds=elapsed,
                peak_process_bytes=peak, trace_sha256=digest.hexdigest(),
                completed_count=completed, rejected_count=rejected,
                mean_response_time=summary["mean_response_time"],
                p95_response_time=summary["p95_response_time"],
                final_event_seconds=previous, validation="passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "experiments/results/d2-13")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--worker", type=int, choices=SERVER_COUNTS, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker is not None:
        print(json.dumps(worker(args.worker)))
        return
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    args.output.mkdir(parents=True, exist_ok=True)
    rng = random.Random(CONFIG["seed"])
    digest = hashlib.sha256()
    with (args.output / "trace.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["request_id", "arrival_seconds", "service_seconds"])
        for request_id in range(REQUEST_COUNT):
            arrival = request_id / CONFIG["arrival_rate"]
            service = rng.uniform(CONFIG["service_min"], CONFIG["service_max"])
            hash_request(digest, request_id, arrival, service)
            writer.writerow([request_id, arrival, service])
    samples = []
    for server_count in SERVER_COUNTS:
        for repeat in range(1, args.repeats + 1):
            result = subprocess.run([sys.executable, str(Path(__file__).resolve()),
                                     "--worker", str(server_count)], cwd=ROOT,
                                    capture_output=True, text=True, check=True, timeout=120)
            sample = json.loads(result.stdout)
            if sample["trace_sha256"] != digest.hexdigest():
                raise RuntimeError("Actual generated workload differs from saved trace")
            matching = [s for s in samples if s["server_count"] == server_count]
            stable_fields = ("completed_count", "rejected_count", "mean_response_time",
                             "p95_response_time", "final_event_seconds")
            if matching and any(sample[key] != matching[0][key] for key in stable_fields):
                raise RuntimeError("Simulation results changed between fresh processes")
            sample["repeat"] = repeat
            samples.append(sample)
            print(f"{server_count:4} servers, repeat {repeat}: "
                  f"{sample['runtime_seconds']:.4f} s, "
                  f"{sample['peak_process_bytes'] / 2**20:.2f} MiB peak", flush=True)
    with (args.output / "samples.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(samples[0]))
        writer.writeheader()
        writer.writerows(samples)
    git = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True)
    report = dict(
        recorded_at_utc=datetime.now(timezone.utc).isoformat(),
        command="uv run python experiments/scale_benchmark.py " +
                f"--repeats {args.repeats} --output " + args.output.as_posix(),
        source_commit=git.stdout.strip() if git.returncode == 0 else None,
        benchmark_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        uv_lock_sha256=hashlib.sha256((ROOT / "uv.lock").read_bytes()).hexdigest(),
        machine=dict(os=platform.platform(), architecture=platform.machine(),
                     processor=os.environ.get("PROCESSOR_IDENTIFIER") or platform.processor(),
                     logical_cpus=os.cpu_count(), python=sys.version,
                     streamlit=importlib.metadata.version("streamlit")),
        config=CONFIG, server_counts=SERVER_COUNTS, request_count=REQUEST_COUNT,
        trace_sha256=digest.hexdigest(), repeats=args.repeats,
        method="Fresh process per sample; perf_counter around run_simulation; "
               "OS peak resident/working-set bytes including interpreter and imports. "
               "Startup and validation excluded from timing; peak sampled before validation.",
        results=[dict(server_count=count,
                      median_runtime_seconds=statistics.median(s["runtime_seconds"] for s in samples if s["server_count"] == count),
                      max_peak_process_bytes=max(s["peak_process_bytes"] for s in samples if s["server_count"] == count),
                      completed_count=next(s["completed_count"] for s in samples if s["server_count"] == count),
                      rejected_count=next(s["rejected_count"] for s in samples if s["server_count"] == count))
                 for count in SERVER_COUNTS])
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Saved trace.csv, samples.csv and report.json in {args.output}")


if __name__ == "__main__":
    main()
