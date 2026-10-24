"""A-01: optional per-server processing-rate multipliers."""

import unittest
from unittest.mock import patch

from lbsim.exports import build_exports
from lbsim.server import Request, Server
from lbsim.settings import validate_config
from lbsim.simulation import run_simulation
from lbsim.utils.generate_seed import route

# 2 servers, 1 slot, 1 queue place; 4 requests at t = 0, 0.25, 0.5, 0.75,
# each needing 1 s of work at rate 1.0. Server 0 runs twice as fast.
SMALL = dict(server_count=2, concurrency=1, queue_limit=1, arrival_rate=4.0,
             duration=1.0, service_min=1.0, service_max=1.0, seed=7)


class ServerRateTests(unittest.TestCase):
    def test_rate_scales_execution_time(self):
        for rate, end in ((1.0, 3.0), (2.0, 2.0), (0.5, 5.0), (4, 1.5)):
            with self.subTest(rate=rate):
                server = Server(0, 1, 0, processing_rate=rate)
                admission = server.submit(Request(0, 1.0, 2.0), 1.0)
                self.assertEqual(admission.execution.completion_time, end)

    def test_default_rate_is_one(self):
        self.assertEqual(Server(0, 1, 0).processing_rate, 1.0)

    def test_invalid_rates_rejected(self):
        for rate in (0, -1.0, float("inf"), float("nan"), True, "2", None):
            with self.subTest(rate=rate):
                with self.assertRaisesRegex(ValueError, "processing rate"):
                    Server(0, 1, 0, processing_rate=rate)


class ConfigRateTests(unittest.TestCase):
    def setUp(self):
        self.config = {**SMALL, "policy": "round_robin"}

    def test_uniform_or_missing_rates_keep_nine_field_config(self):
        expected = validate_config(self.config)
        for rates in (None, [1.0, 1.0], (1, 1)):
            with self.subTest(rates=rates):
                self.assertEqual(validate_config({**self.config, "processing_rates": rates}),
                                 expected)

    def test_mixed_rates_kept_as_float_tuple(self):
        result = validate_config({**self.config, "processing_rates": [2, 1.0]})
        self.assertEqual(result["processing_rates"], (2.0, 1.0))

    def test_invalid_rate_lists(self):
        for rates in ([2.0], [2.0, 1.0, 1.0], [2.0, 0], [2.0, -1.0],
                      [2.0, float("nan")], [2.0, True], [2.0, "1"], 2.0, "2,1"):
            with self.subTest(rates=rates):
                with self.assertRaisesRegex(ValueError, "processing_rates"):
                    validate_config({**self.config, "processing_rates": rates})

    def test_route_checks_length(self):
        with self.assertRaisesRegex(ValueError, "one value per server"):
            route(**self.config, processing_rates=(1.0,))

    def test_exports_refuse_mixed_rates(self):
        config = {**self.config, "processing_rates": [2.0, 1.0]}
        with self.assertRaisesRegex(ValueError, "processing rates"):
            build_exports(config, run_simulation(config))


class MixedSpeedTraceTests(unittest.TestCase):
    """Hand-checked traces; documented in docs/simulation-model.md."""

    def run_case(self, policy, rates):
        return run_simulation({**SMALL, "policy": policy, "processing_rates": rates})

    def test_uniform_rates_match_original_engine(self):
        for policy in ("round_robin", "least_active_requests"):
            with self.subTest(policy=policy):
                self.assertEqual(self.run_case(policy, [1.0, 1.0]),
                                 run_simulation({**SMALL, "policy": policy}))

    def test_round_robin_mixed_speed_trace(self):
        summary = self.run_case("round_robin", [2.0, 1.0])
        self.assertEqual(summary["events"], [
            (0.0, 0, 1, 0, "started", 0),     # fast server: done at 0.5
            (0.25, 1, 1, 0, "started", 1),    # slow server: done at 1.25
            (0.5, 0, 0, 0, "completed", 0),   # completion first at the tie
            (0.5, 0, 1, 0, "started", 2),     # so request 2 starts at once
            (0.75, 1, 1, 1, "queued", 3),     # round robin sends it to the busy slow server
            (1.0, 0, 0, 0, "completed", 2),
            (1.25, 1, 1, 0, "completed", 1),  # request 3 starts at 1.25
            (2.25, 1, 0, 0, "completed", 3),
        ])
        self.assertEqual(summary["response_times"], [0.5, 0.5, 1.0, 1.5])
        self.assertEqual(summary["mean_response_time"], 0.875)
        self.assertEqual(summary["p95_response_time"], 1.5)
        self.assertEqual(summary["per_server_utilization"], {0: 1.0, 1: 0.75})

    def test_least_active_mixed_speed_trace(self):
        summary = self.run_case("least_active_requests", [2.0, 1.0])
        self.assertEqual(summary["events"], [
            (0.0, 0, 1, 0, "started", 0),
            (0.25, 1, 1, 0, "started", 1),
            (0.5, 0, 0, 0, "completed", 0),
            (0.5, 0, 1, 0, "started", 2),
            (0.75, 0, 1, 1, "queued", 3),     # both running 1: lowest ID wins
            (1.0, 0, 1, 0, "completed", 2),   # request 3 starts at 1.0 on the fast server
            (1.25, 1, 0, 0, "completed", 1),
            (1.5, 0, 0, 0, "completed", 3),
        ])
        self.assertEqual(summary["response_times"], [0.5, 0.5, 1.0, 0.75])
        self.assertEqual(summary["mean_response_time"], 0.6875)
        self.assertEqual(summary["p95_response_time"], 1.0)

    def test_rates_do_not_change_the_seeded_trace(self):
        # Same check style as experiments/compare_policies.py: record every
        # generated Request, including rejected ones.
        config = dict(server_count=3, concurrency=2, queue_limit=3, arrival_rate=20.0,
                      duration=5.0, service_min=0.1, service_max=1.0, seed=11,
                      policy="round_robin")

        def trace(rates):
            observed = []

            def observe(*args):
                observed.append(Request(*args))
                return observed[-1]

            with patch("lbsim.utils.generate_seed.Request", side_effect=observe):
                route(**config, processing_rates=rates)
            return observed

        uniform = trace(None)
        self.assertEqual(len(uniform), 100)
        self.assertEqual(trace((2.0, 1.0, 0.5)), uniform)


if __name__ == "__main__":
    unittest.main()
