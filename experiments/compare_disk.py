"""Compare disk timing and request mix with the same CPU demand and arrival pattern."""

import json

from lbsim.simulation import run_simulation

BASE = dict(
    server_count=8, concurrency=2, queue_limit=8, arrival_rate=100, duration=10,
    seed=42, service_min=.016, service_max=.024, request_model="cpu_io",
    io_fraction=.5, outstanding_limit=24, io_capacity=2, policy="least_outstanding",
    disk={"read_fraction": .9, "read_ms": 4, "write_ms": 50},
)


def main():
    cases = {
        "read_heavy": BASE["disk"],
        "slower_writes": {**BASE["disk"], "write_ms": 250},
        "write_heavy": {**BASE["disk"], "read_fraction": .2},
    }
    results = {}
    for name, disk in cases.items():
        config = {**BASE, "disk": disk}
        summary = run_simulation(config)
        results[name] = {
            "disk": disk,
            "completed": summary["completed_count"],
            "rejected": summary["rejected_count"],
            "p95_ms": round(1000 * summary["p95_response_time"], 3),
            "mean_disk_queue_ms": round(1000 * summary["mean_io_queue_wait"], 3),
            "disk_utilization": round(summary["io_resource"]["utilization"], 4),
            "workload_sha256": summary["workload_sha256"],
        }
    if results["read_heavy"]["workload_sha256"] != results["slower_writes"]["workload_sha256"]:
        raise RuntimeError("Changing write latency changed the offered workload.")
    if any(row["completed"] + row["rejected"] != BASE["arrival_rate"] * BASE["duration"]
           for row in results.values()):
        raise RuntimeError("The case did not account for every request.")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
