"""Reproduce the regional failover figures on Demo 3 slide 7."""

import json

from lbsim.regional_engine import LiveSimulation
from lbsim.regions import PRESETS


def measure_phase(simulation, rtt, start, end):
    busy_samples = [0] * len(rtt)
    routes = [[0] * len(rtt) for _ in rtt]
    for second in range(start, end):
        for tick in range(1, 11):
            simulation.advance(second + tick / 10)
            for index, pool in enumerate(simulation.pools):
                busy_samples[index] += pool.running
        for totals, observed in zip(routes, simulation.clients.previous):
            for target, count in enumerate(observed):
                totals[target] += count

    routed = sum(map(sum, routes))
    total_rtt = sum(
        count * rtt[origin][target]
        for origin, row in enumerate(routes)
        for target, count in enumerate(row)
    )
    return {
        "mean_busy_slots": [round(count / (10 * (end - start)), 1) for count in busy_samples],
        "mean_routed_rtt_ms": round(total_rtt / routed, 1),
        "routes_by_origin": routes,
    }


def main():
    regions, rtt = PRESETS["US · balanced"]
    simulation = LiveSimulation(
        regions, rtt, arrival_rate=55, service_min=0.1, service_max=1.0,
        seed=42, policy="nearest", client_weights=[70, 20, 10],
        client_migration=True,
    )
    normal = measure_phase(simulation, rtt, 0, 10)
    rejected_before = simulation.rejected
    simulation.set_region_online(0, False)
    interrupted = simulation.rejected - rejected_before
    rejected_at_start = simulation.rejected
    outage = measure_phase(simulation, rtt, 10, 20)
    new_rejections = simulation.rejected - rejected_at_start
    simulation.set_region_online(0, True)
    recovery = measure_phase(simulation, rtt, 20, 35)
    restored = measure_phase(simulation, rtt, 35, 45)
    print(json.dumps({
        "regions": [region.name for region in regions],
        "normal": normal,
        "outage": outage,
        "recovery": recovery,
        "restored": restored,
        "interrupted_at_outage": interrupted,
        "new_rejections_during_outage": new_rejections,
    }, indent=2))


if __name__ == "__main__":
    main()
