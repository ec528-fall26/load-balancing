"""Routing strategies shared by the batch and incremental engines.

Registry entries describe supported topologies; every simulation creates its own
strategy. Admission, queues, travel and RNG remain responsibilities of engines.
"""
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from math import inf
from random import Random
from types import MappingProxyType


@dataclass(frozen=True)
class RoutingContext:
    count: int
    running: Callable[[int], int]
    demand: Callable[[int], int] | None = None
    capacity: Callable[[int], int] | None = None
    latency_ms: tuple[float, ...] = ()
    routing_rng: Random | None = None
    # Health check: None means every target is always up. Engines only call
    # choose() while at least one target is available.
    available: Callable[[int], bool] | None = None


class RoutingPolicy(ABC):
    def __init__(self, context: RoutingContext):
        self.context = context

    @abstractmethod
    def choose(self) -> int:
        """Return a target index before admission, including full targets."""

    def update(self, target: int) -> None:
        """Notify the strategy after a target's running count changes."""


class RoundRobinPolicy(RoutingPolicy):
    def __init__(self, context):
        super().__init__(context)
        self.next_target = 0

    def choose(self):
        available = self.context.available
        for _ in range(self.context.count):
            target = self.next_target
            self.next_target = (target + 1) % self.context.count
            if available is None or available(target):
                return target
        raise ValueError("no target is available")


class LeastActiveRequestsPolicy(RoutingPolicy):
    """Running requests only; a bounded indexed tree preserves O(log n) updates.

    Waiting requests do not contribute. Equal counts favor the lowest index.
    Unavailable targets count as infinitely loaded.
    """
    def __init__(self, context):
        super().__init__(context)
        self.width = 1 << (context.count - 1).bit_length()
        self.tree = [(inf, 0)] * (2 * self.width)
        for i in range(context.count):
            self.tree[self.width + i] = self._leaf(i)
        for i in range(self.width - 1, 0, -1):
            self.tree[i] = min(self.tree[2 * i], self.tree[2 * i + 1])

    def _leaf(self, target):
        available = self.context.available
        if available is not None and not available(target):
            return (inf, target)
        return (self.context.running(target), target)

    def update(self, target):
        i = self.width + target
        self.tree[i] = self._leaf(target)
        while i > 1:
            i //= 2
            self.tree[i] = min(self.tree[2 * i], self.tree[2 * i + 1])

    def choose(self):
        return self.tree[1][1]


class LeastOutstandingPolicy(LeastActiveRequestsPolicy):
    """Fewest unfinished admitted requests, including CPU queue and I/O wait."""
    def __init__(self, context):
        demand_context = RoutingContext(context.count, context.demand,
                                        available=context.available)
        super().__init__(demand_context)


class PowerOfTwoChoicesPolicy(RoutingPolicy):
    """Sample two distinct targets; choose fewer CPU-active requests.

    Equal loads choose the first sampled target. A one-target fleet consumes no
    routing random draw. This experimental variant does not count I/O wait.
    """
    def __init__(self, context):
        super().__init__(context)
        self.rng = context.routing_rng if context.routing_rng is not None else Random(0)

    def choose(self):
        if self.context.count == 1:
            return 0
        candidates = range(self.context.count)
        available = self.context.available
        # Only filter when something is down, so all-up runs draw exactly as before.
        if available is not None and not all(available(i) for i in candidates):
            candidates = [i for i in candidates if available(i)]
            if len(candidates) == 1:
                return candidates[0]
        a, b = self.rng.sample(candidates, 2)
        return a if self.context.running(a) <= self.context.running(b) else b


class NearestRegionPolicy(RoutingPolicy):
    def choose(self):
        return min(range(self.context.count),
                   key=lambda i: (self.context.latency_ms[i], i))


class LeastLoadedRegionPolicy(RoutingPolicy):
    def choose(self):
        return min(range(self.context.count), key=lambda i: (
            self.context.demand(i) / self.context.capacity(i),
            self.context.latency_ms[i], i))


class NearestUnderLoadPolicy(RoutingPolicy):
    """Nearest region below the overload threshold; least loaded when all are above it.

    Load is the same signal as least_loaded: (running + queued + outbound) / slots.
    Keeps traffic local while there is room and spills over only under load.
    """
    THRESHOLD = 0.9

    def choose(self):
        context = self.context
        def load(i):
            return context.demand(i) / context.capacity(i)
        available = [i for i in range(context.count) if load(i) < self.THRESHOLD]
        if available:
            return min(available, key=lambda i: (context.latency_ms[i], i))
        return min(range(context.count), key=lambda i: (load(i), context.latency_ms[i], i))


@dataclass(frozen=True)
class PolicyDefinition:
    strategy: type[RoutingPolicy]
    labels: tuple[tuple[str, str], ...]
    order: int = 0

    def label(self, topology):
        return dict(self.labels).get(topology)


# The only authoritative list of policy identifiers, factories and Python labels.
POLICY_REGISTRY = MappingProxyType({
    'round_robin': PolicyDefinition(RoundRobinPolicy, (
        ('single_pool', 'Round robin'), ('regions', 'Round robin across regions'),
        ('cpu_io', 'Round robin'))),
    'least_active_requests': PolicyDefinition(LeastActiveRequestsPolicy, (
        ('single_pool', 'Least active requests'),
        ('cpu_io', 'Least CPU-active requests'))),
    'least_loaded': PolicyDefinition(LeastLoadedRegionPolicy, (
        ('regions', 'Least loaded region'),), order=-1),
    'least_outstanding': PolicyDefinition(LeastOutstandingPolicy, (
        ('single_pool', 'Least outstanding requests'),)),
    'power_of_two': PolicyDefinition(PowerOfTwoChoicesPolicy, (
        ('cpu_io', 'Power of two (CPU active)'),
        ('single_pool', 'Power of two choices')),),
    'nearest': PolicyDefinition(NearestRegionPolicy, (
        ('regions', 'Nearest region'),)),
    'nearest_under_load': PolicyDefinition(NearestUnderLoadPolicy, (
        ('regions', 'Nearest region under 90% load'),)),
})


def policy_options(topology='single_pool'):
    return {name: definition.label(topology)
            for name, definition in sorted(POLICY_REGISTRY.items(), key=lambda item: item[1].order)
            if definition.label(topology) is not None}


def supports_policy(name, topology='single_pool'):
    # Match validation's prior behavior for non-string JSON values without
    # requiring callers to hash an arbitrary user-provided value.
    return isinstance(name, str) and name in policy_options(topology)


def create_policy(name, context, topology='single_pool'):
    if not supports_policy(name, topology):
        raise ValueError('Select a supported routing policy.')
    return POLICY_REGISTRY[name].strategy(context)
