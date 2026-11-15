"""Seeded server outage schedules for the batch engine.

Reliability A is the long-run fraction of time a server is up. Down periods
average `mean_repair_time` (MTTR) and up periods average MTTR * A / (1 - A)
(MTBF), so MTBF / (MTBF + MTTR) = A. Each period length is an exponential
draw: failures are equally likely at any moment, whatever the server's uptime.
"""
from random import Random


def outage_schedule(reliabilities, mean_repair_time: float, duration: float,
                    seed: int) -> dict[int, list[tuple[float, float]]]:
    """Return each server's (down, up) intervals; every server starts up.

    Outages only begin before `duration`, but the last one keeps its drawn
    recovery time even past the end, so no server stays down while draining.
    Uses its own RNG so request traces and routing draws are unchanged.
    """
    rng = Random(f"reliability:{seed}")
    schedule = {}
    for sid, reliability in enumerate(reliabilities):
        intervals = []
        if reliability < 1:
            mean_up = mean_repair_time * reliability / (1 - reliability)
            t = 0.0
            while True:
                t += rng.expovariate(1 / mean_up)
                if t >= duration:
                    break
                end = t + rng.expovariate(1 / mean_repair_time)
                intervals.append((t, end))
                t = end
        schedule[sid] = intervals
    return schedule
