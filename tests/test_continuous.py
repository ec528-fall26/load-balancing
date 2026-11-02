from math import inf
import unittest

from lbsim.continuous import ContinuousSimulation
from lbsim.simulation import run_simulation

CONFIG = dict(
    server_count=3,
    concurrency=2,
    queue_limit=4,
    arrival_rate=15.0,
    service_min=0.1,
    service_max=1.0,
    seed=42,
    policy="round_robin",
)


class ContinuousTests(unittest.TestCase):
    def test_incremental_counts_and_latency_match_drained_one_shot_for_both_policies(
        self,
    ):
        for policy in ("round_robin", "least_active_requests"):
            config = {**CONFIG, "policy": policy, "processing_rates": [0.5, 1, 2]}
            expected = run_simulation({**config, "duration": 3})
            engine = ContinuousSimulation(config)
            for step in range(1, 13):
                target = min(step / 4, 3 - 1e-9)
                while not engine.advance(target, max_events=3):
                    pass
                self.assert_conservation(engine)
            engine.set_rate(0)
            while engine.pending:
                engine.advance(engine.pending[0][0])
            snapshot = engine.snapshot()
            self.assertEqual(engine.completed, expected["completed_count"])
            self.assertEqual(engine.rejected, expected["rejected_count"])
            self.assertAlmostEqual(
                snapshot["metrics"]["mean_response_time"],
                expected["mean_response_time"],
            )
            self.assertEqual(
                snapshot["metrics"]["recent_p95_response_time"],
                expected["p95_response_time"],
            )
            self.assert_conservation(engine)

    def assert_conservation(self, engine):
        self.assertEqual(
            engine.offered,
            engine.completed + engine.rejected + engine.running + engine.waiting,
        )
        self.assertEqual(len(engine.pending), engine.running)
        self.assertEqual(sum(engine.active), engine.running)
        self.assertEqual(sum(engine.queued), engine.waiting)

    def test_retention_histogram_pagination_and_work_budgets(self):
        engine = ContinuousSimulation(
            {**CONFIG, "arrival_rate": 1000}, response_window=13, history_points=7
        )
        self.assertFalse(engine.advance(2, max_events=1))
        for tick in range(1, 301):
            while not engine.advance(tick / 10, max_events=100):
                pass
            engine.sample()
            self.assert_conservation(engine)
        snapshot = engine.snapshot(server_offset=1, server_limit=1, history_limit=3)
        self.assertEqual([s["id"] for s in snapshot["servers"]["items"]], [1])
        self.assertEqual(len(snapshot["history"]), 3)
        self.assertEqual(len(engine.history), 7)
        self.assertEqual(len(engine.responses), 13)
        self.assertLessEqual(len(engine.pending), 6)
        self.assertLessEqual(engine.waiting, 12)
        self.assertLessEqual(len(snapshot["histogram"]["bins"]), 20)
        self.assertEqual(sum(b["count"] for b in snapshot["histogram"]["bins"]), 13)
        self.assertNotIn("events", snapshot)
        self.assertNotIn("response_times", snapshot)
        self.assertEqual(engine.snapshot(history_limit=0)["history"], [])
        self.assertEqual(engine.snapshot(server_offset=100)["servers"]["items"], [])
        self.assertFalse(engine.advance(engine.now + 10, budget_seconds=0))

    def test_zero_traffic_drains_and_recent_metrics_are_explicit(self):
        engine = ContinuousSimulation({**CONFIG, "arrival_rate": 0})
        engine.advance(2)
        self.assertEqual(engine.offered, 0)
        self.assertIsNone(engine.snapshot()["metrics"]["mean_response_time"])
        engine.set_rate(100)
        engine.advance(3)
        offered = engine.offered
        engine.set_rate(0)
        engine.advance(20)
        self.assertEqual(engine.offered, offered)
        self.assertEqual(engine.running + engine.waiting, 0)
        self.assert_conservation(engine)
        self.assertEqual(
            engine.snapshot()["histogram"]["scope"], "recent_completed_responses"
        )
        for rate in (-1, inf, True, 100001):
            with self.assertRaises(ValueError):
                engine.set_rate(rate)
        with self.assertRaises(ValueError):
            engine.advance(0)


if __name__ == "__main__":
    unittest.main()
