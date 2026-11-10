import unittest

from fastapi.testclient import TestClient

from lbsim.api import create_app
from lbsim.fanout import Config, Request, Simulation, experiment


PIECES = ((8, 12), (4, 4), (4, 4), (4, 4))


class FanoutPipelineTest(unittest.TestCase):
    def run_trace(self, *, inspect=0, arrivals=(0,), **kwargs):
        config = Config(dispatch_us=2, join_us=3, rtt_us=5, **kwargs)
        requests = tuple(Request(arrival, PIECES) for arrival in arrivals)
        return Simulation(config, inspect).run(requests)

    def test_parallel_join_uses_last_reply_and_deadline_tie_succeeds(self):
        result = self.run_trace(deadline_us=30)
        selected = result["inspected"]
        self.assertEqual(selected["critical_shard"], 0)
        self.assertEqual(result["completed"], 1)
        self.assertEqual(result["mean_ms"], 0.030)
        self.assertEqual(result["p95_ms"], 0.030)
        events = {(e["phase"], e["shard"]): e["at_us"] for e in selected["events"]}
        self.assertEqual(events["request_received", 0], 4)
        self.assertEqual(events["io_started", 0], 8)
        self.assertEqual(events["reply_received", 0], 27)
        self.assertEqual(events["join_cpu_started", None], 27)
        self.assertEqual(events["completed", None], 30)

    def test_width_changes_placement_but_preserves_backend_work(self):
        one = self.run_trace(width=1)
        two = self.run_trace(width=2)
        four = self.run_trace(width=4)
        self.assertEqual(one["backend_ms_per_success"], two["backend_ms_per_success"])
        self.assertEqual(sum(s["sent"] for s in two["shards"]), 2)
        self.assertEqual(two["p95_ms"], 0.038)
        self.assertEqual(one["backend_ms_per_success"], four["backend_ms_per_success"])
        self.assertEqual(sum(s["sent"] for s in one["shards"]), 1)
        self.assertEqual(sum(s["sent"] for s in four["shards"]), 4)
        self.assertGreater(one["p95_ms"], four["p95_ms"])

    def test_slowdown_can_target_a_nonzero_shard(self):
        result = self.run_trace(slow_shard=2, slowdown=5)
        self.assertEqual(result["inspected"]["critical_shard"], 2)
        self.assertEqual(result["p95_ms"], 0.034)

    def test_io_wait_releases_cpu_and_coordinator_dispatches_while_blocked(self):
        result = self.run_trace(inspect=1, arrivals=(0, 0))
        events = {(e["phase"], e["shard"]): e["at_us"] for e in result["inspected"]["events"]}
        self.assertEqual(events["dispatch_cpu_started", None], 2)
        self.assertEqual(events["cpu_first_started", 0], 8)
        self.assertEqual(events["io_queued", 0], 10)
        self.assertEqual(events["io_started", 0], 20)
        self.assertEqual(result["shards"][0]["peak_io_queue"], 1)

    def test_deadline_records_unanswered_shard_and_drains_admitted_work(self):
        result = self.run_trace(deadline_us=26)
        self.assertEqual(result["timed_out"], 1)
        self.assertEqual(result["completed"], 0)
        self.assertEqual(result["inspected"]["unanswered_shards"], (0,))
        self.assertEqual(result["wasted_backend_ms"], .044)
        self.assertIsNone(result["mean_ms"])
        self.assertIsNone(result["p95_ms"])
        self.assertTrue(all(shard["completed"] == 1 for shard in result["shards"]))

    def test_rejection_fails_parent_only_when_network_reply_arrives(self):
        result = self.run_trace(inspect=1, arrivals=(0, 0), shard_limit=1)
        self.assertEqual(result["shard_rejected"], 1)
        selected = result["inspected"]["events"]
        rejected_at = next(e["at_us"] for e in selected if e["phase"] == "rejection_received")
        terminal = next(e["at_us"] for e in selected
                        if e["phase"] == "shard_rejected" and e["shard"] is None)
        self.assertEqual(rejected_at, terminal)
        self.assertEqual(terminal, 9)
        self.assertEqual(sum(s["completed"] for s in result["shards"]), 4)

    def test_coordinator_limit_and_queued_deadline(self):
        capped = self.run_trace(arrivals=(0, 0), coordinator_limit=1)
        self.assertEqual(capped["coordinator_rejected"], 1)
        expired = self.run_trace(inspect=1, arrivals=(0, 0), deadline_us=2)
        self.assertEqual(expired["timed_out"], 2)
        self.assertFalse(any(e["phase"] == "request_sent" for e in expired["inspected"]["events"]))

    def test_seeded_experiment_and_api_validation(self):
        first = experiment({"rate": 10, "duration": 1})
        self.assertEqual(first, experiment({"rate": 10, "duration": 1}))
        with TestClient(create_app()) as client:
            response = client.post("/v1/research/fan-out", json={"config": {"rate": 10, "duration": 1}})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["workload_sha256"], first["workload_sha256"])
            invalid = client.post("/v1/research/fan-out", json={"config": {"rate": 1, "duration": 1, "inspect": 1}})
            self.assertEqual(invalid.status_code, 422)

    def test_single_run_and_comparison_use_the_same_seeded_workload(self):
        settings = dict(rate=10, duration=1, slow_shard=2, slowdown=5)
        with TestClient(create_app()) as client:
            run = client.post("/v1/fan-out/run", json={"config": {**settings, "width": 4}})
            paired = client.post("/v1/research/fan-out", json={"config": settings})
            invalid = client.post("/v1/fan-out/run", json={"config": {**settings, "width": 3}})

        self.assertEqual(run.status_code, 200)
        self.assertEqual(paired.status_code, 200)
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(run.json()["workload_sha256"], paired.json()["workload_sha256"])
        case = run.json()["result"]
        self.assertEqual(case["condition"], "slow shard 2")
        self.assertEqual({**case, "condition": "slow shard"}, paired.json()["cases"][3])


if __name__ == "__main__":
    unittest.main()
