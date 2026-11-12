import random
import subprocess
import sys
import unittest
from pathlib import Path
from lbsim.policies import RoutingContext, create_policy, policy_options, supports_policy


class PolicyTests(unittest.TestCase):
    def test_topology_validation_and_independent_instances(self):
        context = RoutingContext(3, lambda i: 0)
        a = create_policy('round_robin', context)
        b = create_policy('round_robin', context)
        self.assertEqual([a.choose() for _ in range(5)], [0, 1, 2, 0, 1])
        self.assertEqual(b.choose(), 0)
        for invalid in (None, [], {}, '', 'nearest', 'least_loaded'):
            self.assertFalse(supports_policy(invalid))
            with self.assertRaises(ValueError):
                create_policy(invalid, context)
        self.assertFalse(supports_policy('least_active_requests', 'regions'))

    def test_running_only_minimum_after_arbitrary_updates(self):
        running = [0] * 37
        policy = create_policy('least_active_requests', RoutingContext(37, running.__getitem__))
        rng = random.Random(42)
        for _ in range(1000):
            index = rng.randrange(37)
            running[index] = rng.randrange(5)
            policy.update(index)
            self.assertEqual(policy.choose(), min(range(37), key=lambda i: (running[i], i)))
        self.assertLess(len(policy.tree), 4 * len(running))

    def test_regional_load_normalization_and_latency_ties(self):
        demand, capacity = [3, 2, 1], [4, 2, 1]
        context = RoutingContext(3, lambda i: 0, demand.__getitem__, capacity.__getitem__, (20, 10, 10))
        loaded = create_policy('least_loaded', context, 'regions')
        nearest = create_policy('nearest', context, 'regions')
        self.assertEqual(loaded.choose(), 0)
        self.assertEqual(nearest.choose(), 1)
        demand[0] = 4
        self.assertEqual(loaded.choose(), 1)
        demand[2] = 0
        self.assertEqual(loaded.choose(), 2)

    def test_nearest_under_load_spills_over_only_above_threshold(self):
        # Region 0 is nearest, then 1, then 2. Each has 10 slots.
        demand, capacity = [0, 0, 0], [10, 10, 10]
        context = RoutingContext(3, lambda i: 0, demand.__getitem__, capacity.__getitem__, (2, 12, 75))
        policy = create_policy('nearest_under_load', context, 'regions')
        self.assertEqual(policy.choose(), 0)          # room nearby: stay local
        demand[0] = 8
        self.assertEqual(policy.choose(), 0)          # 80% is still under 90%
        demand[0] = 9
        self.assertEqual(policy.choose(), 1)          # 90% counts as overloaded: next nearest
        demand[1] = 9
        self.assertEqual(policy.choose(), 2)
        demand[2] = 10
        self.assertEqual(policy.choose(), 0)          # all overloaded: least loaded, nearest on ties
        demand[0] = 12
        self.assertEqual(policy.choose(), 1)
        self.assertFalse(supports_policy('nearest_under_load'))

    def test_frontend_metadata_is_generated_from_registry(self):
        root = Path(__file__).resolve().parents[1]
        subprocess.run([sys.executable, str(root / 'scripts/generate_policy_metadata.py'), '--check'], cwd=root, check=True)
        self.assertEqual(list(policy_options()), ['round_robin', 'least_active_requests', 'least_outstanding', 'power_of_two'])
        self.assertEqual(list(policy_options('regions')),
                         ['least_loaded', 'round_robin', 'nearest', 'nearest_under_load'])
