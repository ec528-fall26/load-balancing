import math
import unittest
from random import Random

from lbsim.cpu_io import StagedRequest, make_workload, run_staged, workload_hash
from lbsim.policies import RoutingContext, create_policy, supports_policy


class CPUIOTests(unittest.TestCase):
    def run_trace(self, trace, **overrides):
        config = dict(servers=1, cpu_slots=1, outstanding_limit=4,
                      duration=1, policy='round_robin', record_events=True)
        config.update(overrides)
        return run_staged(trace, **config)

    def test_io_releases_cpu_and_retains_outstanding_slot(self):
        trace = [StagedRequest(0, 0, 1, 2, 1), StagedRequest(1, .1, 1, 2, 1)]
        result = self.run_trace(trace)
        self.assertEqual([r['completion'] for r in result['completions']], [4, 5])
        self.assertAlmostEqual(result['mean_response'], 4.45)
        self.assertAlmostEqual(result['p95_response'], 4.9)
        self.assertEqual(result['cpu_seconds_including_drain'], [4])
        at_two = next(e for e in result['events'] if e['time'] == 2)
        self.assertEqual((at_two['cpu_active'], at_two['io_waiting'], at_two['outstanding']),
                         ([0], [2], [2]))

    def test_io_does_not_free_admission_capacity(self):
        result = self.run_trace([StagedRequest(0, 0, .1, 1, .1),
                                 StagedRequest(1, .2, .1, 0, .1)], outstanding_limit=1)
        self.assertEqual(result['rejected_ids'], [1])
        self.assertEqual((result['completed'], result['rejected']), (1, 1))
        self.assertAlmostEqual(result['cpu_utilization'][0], .1)

    def test_completion_before_tied_arrival_and_fifo_returning_stage(self):
        result = self.run_trace([StagedRequest(0, 0, .1, 0, .1),
                                 StagedRequest(1, .2, .1, 0, .1)], outstanding_limit=1)
        self.assertEqual((result['completed'], result['rejected']), (2, 0))
        # CPU2 returns behind CPU1 already waiting for the same CPU.
        result = self.run_trace([StagedRequest(0, 0, 1, 0, 1),
                                 StagedRequest(1, .1, 1, 0, 1)])
        self.assertEqual([r['completion'] for r in result['completions']], [3, 4])

    def test_repeatability_shared_workload_and_full_conservation(self):
        trace = make_workload(rate=80, duration=2, seed=43, io_fraction=.9)
        for policy in ('round_robin', 'least_active_requests', 'power_of_two'):
            with self.subTest(policy=policy):
                a = self.run_trace(trace, servers=4, cpu_slots=2, duration=2, policy=policy)
                b = self.run_trace(trace, servers=4, cpu_slots=2, duration=2, policy=policy)
                self.assertEqual(a, b)
                self.assertEqual(a['workload_sha256'], workload_hash(trace))
                ids = [r['id'] for r in a['completions']] + a['rejected_ids']
                self.assertEqual(sorted(ids), list(range(len(trace))))
                expected_cpu = sum(r.cpu_first + r.cpu_last for r in trace if r.id not in a['rejected_ids'])
                self.assertAlmostEqual(sum(a['cpu_seconds_including_drain']), expected_cpu)
                for e in a['events']:
                    self.assertEqual(e['offered'], e['completed'] + e['rejected'] + sum(e['outstanding']))
                    for active, io, queued, outstanding in zip(e['cpu_active'], e['io_waiting'], e['cpu_queued'], e['outstanding']):
                        self.assertEqual(outstanding, active + io + queued)
                        self.assertLessEqual(active, 2)
                        self.assertLessEqual(outstanding, 4)
                self.assertTrue(all(0 <= value <= 1 for value in a['cpu_utilization']))
                for i in range(4):
                    self.assertAlmostEqual(a['mean_outstanding'][i],
                        2*a['cpu_utilization'][i] + a['mean_io_waiting'][i] + a['mean_cpu_queued'][i])

    def test_power_two_uses_sampled_cpu_counts_and_independent_rng(self):
        loads = [3, 0, 1, 1]
        routing = create_policy('power_of_two', RoutingContext(
            4, loads.__getitem__, routing_rng=Random(12)), 'cpu_io')
        oracle = Random(12)
        for _ in range(100):
            a, b = oracle.sample(range(4), 2)
            self.assertEqual(routing.choose(), a if loads[a] <= loads[b] else b)
        one = create_policy('power_of_two', RoutingContext(1, lambda i: 0), 'cpu_io')
        self.assertEqual([one.choose() for _ in range(3)], [0, 0, 0])
        self.assertFalse(supports_policy('power_of_two', 'single_pool'))
        self.assertFalse(supports_policy('power_of_two', 'regions'))

    def test_invalid_and_empty_workloads(self):
        for bad in ((0, 0, 0, 1, 1), (0, 0, 1, -1, 1), (0, 0, 1, math.nan, 1)):
            with self.assertRaises(ValueError): StagedRequest(*bad)
        for trace in ([StagedRequest(0, 1, 1, 0, 1)],
                      [StagedRequest(0, .2, 1, 0, 1), StagedRequest(0, .3, 1, 0, 1)],
                      [StagedRequest(0, .4, 1, 0, 1), StagedRequest(1, .3, 1, 0, 1)]):
            with self.assertRaises(ValueError): self.run_trace(trace)
        result = self.run_trace([])
        self.assertEqual((result['offered'], result['completed'], result['rejected']), (0, 0, 0))
        self.assertIsNone(result['p95_response'])
        self.assertEqual(result['cpu_utilization'], [0])
