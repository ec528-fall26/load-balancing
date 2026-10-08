import random
import unittest

from lbsim.simulation import run_simulation


class IntegrationTests(unittest.TestCase):
    def test_runs_are_isolated_and_do_not_change_global_random(self):
        config = dict(server_count=3, concurrency=1, queue_limit=1,
                      arrival_rate=7.0, duration=1.0, service_min=5.0,
                      service_max=7.0, seed=2, policy='round_robin')
        state = random.getstate()
        first = run_simulation(config)
        self.assertEqual(random.getstate(), state)
        smaller = run_simulation({**config, 'server_count': 1})
        self.assertEqual(set(smaller['per_server_utilization']), {0})
        self.assertEqual(run_simulation(config), first)
        self.assertEqual(first['completed_count'] + first['rejected_count'], 7)
        self.assertEqual(len(first['response_times']), first['completed_count'])
        self.assertAlmostEqual(sum(first['response_times']) / len(first['response_times']),
                               first['mean_response_time'])

    def test_empty_run_and_unimplemented_policy(self):
        config = dict(server_count=1, concurrency=1, queue_limit=0,
                      arrival_rate=1.0, duration=0.1, service_min=1.0,
                      service_max=1.0, seed=42, policy='round_robin')
        summary = run_simulation(config)
        self.assertEqual(summary['completed_count'], 0)
        self.assertIsNone(summary['p95_response_time'])
        with self.assertRaisesRegex(ValueError, 'round-robin'):
            run_simulation({**config, 'policy': 'least_active_requests'})
