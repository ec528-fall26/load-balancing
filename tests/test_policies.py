import random
import unittest
from unittest.mock import patch

from lbsim.simulation import run_simulation
from lbsim.utils.generate_seed import route


class LeastActiveRequestsTests(unittest.TestCase):
    def config(self, **changes):
        return dict(dict(server_count=2, concurrency=1, queue_limit=1,
                         arrival_rate=1.0, duration=4.0, service_min=1.0,
                         service_max=4.0, seed=42, policy='least_active_requests'),
                    **changes)

    def arrivals(self, events):
        return [e for e in events if e[4] != 'completed']

    def test_completions_change_the_next_routing_decision(self):
        # A long request keeps server 0 busy; server 1 repeatedly frees up.
        # Completions at t=2 and t=3 must be visible to arrivals at those times.
        with patch('lbsim.utils.generate_seed.random.Random.uniform',
                   side_effect=[4.0, 1.0, 1.0, 1.0]):
            result = run_simulation(self.config())
        self.assertEqual(self.arrivals(result['events']), [
            (0.0, 0, 1, 0, 'started', 0),
            (1.0, 1, 1, 0, 'started', 1),
            (2.0, 1, 1, 0, 'started', 2),
            (3.0, 1, 1, 0, 'started', 3),
        ])
        self.assertEqual((result['completed_count'], result['rejected_count']), (4, 0))
        self.assertEqual(result['response_times'], [1.0, 1.0, 4.0, 1.0])

    def test_running_ties_do_not_skip_a_full_queue(self):
        result = run_simulation(self.config(duration=5.0, service_min=10.0,
                                            service_max=10.0))
        self.assertEqual(self.arrivals(result['events']), [
            (0.0, 0, 1, 0, 'started', 0),
            (1.0, 1, 1, 0, 'started', 1),
            (2.0, 0, 1, 1, 'queued', 2),
            (3.0, 0, 1, 1, 'rejected', 3),
            (4.0, 0, 1, 1, 'rejected', 4),
        ])
        # Server 1 still has a waiting place, but lowest-ID running-count ties
        # select server 0. Its queued request drains when the slot is freed.
        self.assertEqual(result['events'][-1], (20.0, 0, 0, 0, 'completed', 2))
        self.assertEqual((result['completed_count'], result['rejected_count']), (3, 2))

    def test_multiple_slots_balance_running_counts(self):
        result = run_simulation(self.config(server_count=3, concurrency=2,
                                            duration=6.0, service_min=10.0,
                                            service_max=10.0))
        self.assertEqual([e[1] for e in self.arrivals(result['events'])],
                         [0, 1, 2, 0, 1, 2])
        self.assertEqual(result['rejected_count'], 0)

    def test_seeded_workload_is_identical_between_policies(self):
        config = self.config(arrival_rate=5.0, duration=5.0, concurrency=2,
                             queue_limit=25)
        traces = []
        state = random.getstate()
        for policy in ('round_robin', 'least_active_requests'):
            completed, rejected = route(**{**config, 'policy': policy})
            self.assertEqual(rejected, [])
            traces.append(sorted((e.request.id, e.request.arrival_time,
                                  e.request.service_time) for e in completed))
        self.assertEqual(traces[0], traces[1])
        self.assertEqual(random.getstate(), state)
        self.assertEqual(run_simulation(config), run_simulation(config))

    def test_lower_level_engine_rejects_unknown_policy(self):
        with self.assertRaisesRegex(ValueError, 'policy'):
            route(**self.config(policy='unknown'))
