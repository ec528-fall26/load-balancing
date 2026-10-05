import unittest
from lbsim.metrics import summarize
from lbsim.server import Request, Execution


class MetricsTests(unittest.TestCase):
    def test_contract_example(self):
        executions = [Execution(Request(0, 0, 3), 0, 0, 3),
                      Execution(Request(1, 1, 2), 0, 3, 5),
                      Execution(Request(3, 3, 1), 0, 5, 6)]
        result = summarize(executions, [2], duration=4, server_capacities={0: 1, 9: 2})
        self.assertEqual(result['completed_count'], 3)
        self.assertEqual(result['rejected_count'], 1)
        self.assertAlmostEqual(result['mean_response_time'], 10 / 3)
        self.assertEqual(result['p95_response_time'], 4)
        self.assertEqual(result['per_server_utilization'], {0: 1, 9: 0})

    def test_empty_and_all_rejected(self):
        for rejected in ([], [0, 1]):
            result = summarize([], rejected, duration=4, server_capacities={0: 2})
            self.assertEqual(result['completed_count'], 0)
            self.assertEqual(result['rejected_count'], len(rejected))
            self.assertIsNone(result['mean_response_time'])
            self.assertIsNone(result['p95_response_time'])
            self.assertEqual(result['per_server_utilization'], {0: 0})

    def test_nearest_rank_and_concurrent_capacity(self):
        executions = [Execution(Request(i, 0, i + 1), 7, 0, i + 1) for i in range(20)]
        result = summarize(reversed(executions), [], duration=10, server_capacities={7: 20})
        self.assertEqual(result['p95_response_time'], 19)
        self.assertEqual(result['mean_response_time'], 10.5)
        self.assertAlmostEqual(result['per_server_utilization'][7], 155 / 200)

    def test_invalid_denominators_and_duplicate_results(self):
        for duration in (0, -1, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                summarize([], [], duration=duration, server_capacities={0: 1})
        with self.assertRaises(ValueError):
            summarize([], [], duration=1, server_capacities={0: 0})
        execution = Execution(Request(0, 0, 1), 0, 0, 1)
        with self.assertRaises(ValueError):
            summarize([execution], [0], duration=1, server_capacities={0: 1})
