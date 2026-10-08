"""Summary metrics for completed, drained simulation runs (times in seconds)."""

from collections.abc import Iterable, Mapping
from math import ceil, fsum, isfinite

from lbsim.server import Execution


def summarize(completed: Iterable[Execution], rejected_ids: Iterable[int], *,
              duration: float, server_capacities: Mapping[int, int]) -> dict:
    """Return counts, latency seconds and utilization fractions for every server.

    Pass all completed executions, including work finished during draining.
    Capacities map actual server IDs to their number of concurrent slots.
    """
    if not isfinite(duration) or duration <= 0:
        raise ValueError("duration must be finite and positive")
    if any(type(n) is not int or n <= 0 for n in server_capacities.values()):
        raise ValueError("server capacities must be positive integers")
    executions = list(completed)
    rejected = list(rejected_ids)
    completed_ids = [e.request.id for e in executions]
    if len(set(completed_ids + rejected)) != len(completed_ids) + len(rejected):
        raise ValueError("completed and rejected request IDs must be unique and disjoint")
    occupied = {server_id: [] for server_id in server_capacities}
    latencies = []
    for execution in executions:
        if execution.server_id not in occupied:
            raise ValueError("execution references an unknown server")
        start, end = execution.start_time, execution.completion_time
        if (not isfinite(start) or not isfinite(end)
                or start < execution.request.arrival_time or end <= start):
            raise ValueError("execution times must be finite and ordered")
        latencies.append(end - execution.request.arrival_time)
        occupied[execution.server_id].append(max(0.0, min(end, duration) - max(start, 0.0)))
    latencies.sort()
    return {
        "completed_count": len(executions),
        "rejected_count": len(rejected),
        "mean_response_time": fsum(latencies) / len(latencies) if latencies else None,
        "p95_response_time": latencies[ceil(0.95 * len(latencies)) - 1] if latencies else None,
        "per_server_utilization": {
            server_id: fsum(intervals) / (server_capacities[server_id] * duration)
            for server_id, intervals in occupied.items()
        },
    }
