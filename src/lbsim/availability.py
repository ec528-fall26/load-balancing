"""Seeded server outages, shared by the one-shot and continuous engines.

Each server's availability A is the long-run fraction of time it is up.
Down periods average `mean_repair_time` (MTTR) and up periods average
MTTR * A / (1 - A) (MTBF), so MTBF / (MTBF + MTTR) = A. Each period length is
an exponential draw: failures are equally likely at any moment, whatever the
server's uptime.

Every server draws from its own seeded stream, alternating up, down, up, ...
One-shot runs draw a whole window up front; continuous sessions draw the next
period whenever a server changes state. The draws are identical, so with the
same seed a continuous session's first T seconds have the same outages as a
T-second one-shot run.
"""
from random import Random


def repair_times(mean_repair_time, server_count: int) -> list[float]:
    """One MTTR per server from a shared value or a per-server list."""
    if isinstance(mean_repair_time, (list, tuple)):
        return [float(r) for r in mean_repair_time]
    return [float(mean_repair_time)] * server_count


def server_rng(seed: int, sid: int) -> Random:
    """The outage stream for one server; independent of requests and routing."""
    return Random(f"availability:{seed}:{sid}")


def mean_time_between_failures(availability: float, mttr: float) -> float:
    return mttr * availability / (1 - availability)


def up_period(rng: Random, availability: float, mttr: float) -> float:
    """Length of the next up period: exponential with mean MTBF."""
    return rng.expovariate(1 / mean_time_between_failures(availability, mttr))


def down_period(rng: Random, mttr: float) -> float:
    """Length of the next outage: exponential with mean MTTR."""
    return rng.expovariate(1 / mttr)


def outage_schedule(availabilities, mean_repair_time, duration: float,
                    seed: int) -> dict[int, list[tuple[float, float]]]:
    """Return each server's (down, up) intervals; every server starts up.

    `mean_repair_time` is one MTTR shared by every server, or one per server.
    Outages only begin before `duration`, but the last one keeps its drawn
    recovery time even past the end, so no server stays down while draining.
    """
    repairs = repair_times(mean_repair_time, len(availabilities))
    schedule = {}
    for sid, (availability, mttr) in enumerate(zip(availabilities, repairs)):
        intervals = []
        if availability < 1:
            rng = server_rng(seed, sid)
            t = 0.0
            while True:
                t += up_period(rng, availability, mttr)
                if t >= duration:
                    break
                end = t + down_period(rng, mttr)
                intervals.append((t, end))
                t = end
        schedule[sid] = intervals
    return schedule
