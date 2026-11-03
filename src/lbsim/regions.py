"""Illustrative regional topologies; milliseconds are assumptions, not AWS measurements."""

from dataclasses import dataclass
from math import isfinite


@dataclass(frozen=True)
class Region:
    name: str
    servers: int = 10
    slots_per_server: int = 4
    compute: float = 1.0
    queue_per_server: int = 10

    def __post_init__(self):
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError('Each region needs a name.')
        for key, minimum in (('servers', 1), ('slots_per_server', 1), ('queue_per_server', 0)):
            value = getattr(self, key)
            if type(value) is not int or not minimum <= value <= 10000:
                raise ValueError(f'{key} must be an integer from {minimum} to 10,000.')
        if type(self.compute) not in (int, float) or not isfinite(self.compute) or not 0 < self.compute <= 1000:
            raise ValueError('Compute speed must be positive and at most 1,000×.')

    @property
    def slots(self):
        return self.servers * self.slots_per_server

    @property
    def queue_limit(self):
        return self.servers * self.queue_per_server


PRESETS = {
    'US · balanced': (
        (Region('us-east-1'), Region('us-east-2'), Region('us-west-1')),
        ((2, 12, 75), (12, 2, 65), (75, 65, 2))),
    'US · compute in the west': (
        (Region('us-east-1', 10, 4, 1), Region('us-east-2', 10, 4, 1.5),
         Region('us-west-1', 20, 4, 3)),
        ((2, 12, 75), (12, 2, 65), (75, 65, 2))),
    'Global · mixed compute': (
        (Region('us-east-1', 20, 4, 1.5), Region('us-east-2', 10, 4, 1),
         Region('us-west-1', 20, 4, 2), Region('eu-west-1', 10, 4, 1),
         Region('ap-northeast-1', 10, 4, 2)),
        ((2, 12, 75, 85, 170), (12, 2, 65, 95, 160),
         (75, 65, 2, 145, 110), (85, 95, 145, 2, 220), (170, 160, 110, 220, 2))),
    'Scale · 100 servers': (
        (Region('us-east-1', 40), Region('us-east-2', 30), Region('us-west-1', 30)),
        ((2, 12, 75), (12, 2, 65), (75, 65, 2))),
}


# A large illustrative topology, within API limits (1,000 servers/4,000 slots).
PRESETS['Scale · 1,000 servers / 12 datacenters'] = (
    tuple(Region(f'dc-{i+1:02}', 84 if i < 4 else 83, 4, (1, .75, 2)[i % 3], 10) for i in range(12)),
    tuple(tuple(2 if i == j else 10 + abs(i-j)*40 for j in range(12)) for i in range(12)),
)


def validate_topology(regions, latency_ms):
    if not 1 <= len(regions) <= 12:
        raise ValueError('Use between 1 and 12 regions.')
    if len({r.name for r in regions}) != len(regions):
        raise ValueError('Region names must be unique.')
    if len(latency_ms) != len(regions) or any(len(row) != len(regions) for row in latency_ms):
        raise ValueError('Latency matrix needs one row and column per region.')
    if any(type(v) not in (int, float) or not isfinite(v) or not 0 <= v <= 60000
           for row in latency_ms for v in row):
        raise ValueError('Round-trip latency must be between 0 and 60,000 ms.')
