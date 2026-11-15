"""Seeded server outage schedules for the batch engine.

Each server's availability A is the long-run fraction of time it is up.
Down periods average `mean_repair_time` (MTTR) and up periods average
MTTR * A / (1 - A) (MTBF), so MTBF / (MTBF + MTTR) = A. Each period length is
an exponential draw: failures are equally likely at any moment, whatever the
server's uptime.
"""
from random import Random


def outage_schedule(availabilities, mean_repair_time, duration: float,
                    seed: int) -> dict[int, list[tuple[float, float]]]:
    """Return each server's (down, up) intervals; every server starts up.

    `mean_repair_time` is one MTTR shared by every server, or one per server.
    Outages only begin before `duration`, but the last one keeps its drawn
    recovery time even past the end, so no server stays down while draining.
    Uses its own RNG so request traces and routing draws are unchanged.
    """
    repairs = (mean_repair_time if isinstance(mean_repair_time, (list, tuple))
               else [mean_repair_time] * len(availabilities))
    rng = Random(f"availability:{seed}")
    schedule = {}
    for sid, (availability, mttr) in enumerate(zip(availabilities, repairs)):
        intervals = []
        if availability < 1:
            mean_up = mttr * availability / (1 - availability)
            t = 0.0
            while True:
                t += rng.expovariate(1 / mean_up)
                if t >= duration:
                    break
                end = t + rng.expovariate(1 / mttr)
                intervals.append((t, end))
                t = end
        schedule[sid] = intervals
    return schedule
