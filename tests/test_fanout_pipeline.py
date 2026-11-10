import unittest

from fastapi.testclient import TestClient

from lbsim.api import create_app
from lbsim.fanout import Config, Outage, Request, Simulation, experiment, run_fanout


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

    def test_serial_dispatch_waits_for_each_successful_reply(self):
        result = self.run_trace(dispatch_mode="serial")
        events = result["inspected"]["events"]
        self.assertEqual(
            [(e["shard"], e["at_us"]) for e in events if e["phase"] == "request_sent"],
            [(0, 2), (1, 27), (2, 40), (3, 53)],
        )
        self.assertEqual(result["p95_ms"], 0.069)
        self.assertEqual(result["backend_service_ms"], self.run_trace()["backend_service_ms"])

    def test_serial_stops_dispatching_on_deadline_or_failed_call(self):
        before_first = self.run_trace(dispatch_mode="serial", deadline_us=2)
        self.assertEqual(before_first["inspected"]["unsent_shards"], (0, 1, 2, 3))
        deadline = self.run_trace(dispatch_mode="serial", deadline_us=27)
        outage = self.run_trace(dispatch_mode="serial", outage=Outage(0, 6, 12))
        self.assertEqual(deadline["timed_out"], 1)
        self.assertEqual(outage["outage_failed"], 1)
        for result in (deadline, outage):
            self.assertEqual(result["inspected"]["unsent_shards"], (1, 2, 3))
            self.assertEqual(sum(shard["sent"] for shard in result["shards"]), 1)

    def test_order_comparison_shares_width_and_seeded_outage(self):
        paired = experiment({"comparison": "order", "order_width": 2, "outage_ms": 500})
        cases = paired["cases"]
        self.assertEqual([(row["dispatch_mode"], row["width"]) for row in cases],
                         [("parallel", 2), ("parallel", 2), ("serial", 2), ("serial", 2)])
        self.assertIsNone(cases[0]["outage"])
        self.assertIsNone(cases[2]["outage"])
        self.assertEqual(cases[1]["outage"], cases[3]["outage"])
        with self.assertRaisesRegex(ValueError, "order_width"):
            experiment({"order_width": 3})

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

    def test_outage_cancels_running_and_queued_work_and_then_recovers(self):
        result = self.run_trace(arrivals=(0, 0, 20), outage=Outage(0, 7, 15))
        shard = result["shards"][0]
        self.assertEqual((shard["sent"], shard["completed"], shard["outage_failed"]), (3, 1, 2))
        self.assertEqual((result["completed"], result["outage_failed"]), (1, 2))
        self.assertEqual(result["outage"], {"shard": 0, "start_ms": .007, "end_ms": .015})
        self.assertEqual(result["wasted_backend_ms"], .063)
        shard_events = [event["phase"] for event in result["inspected"]["events"] if event["shard"] == 0]
        self.assertIn("outage_error_received", shard_events)
        self.assertNotIn("cpu_first_finished", shard_events)

    def test_outage_interrupts_io_and_preserves_already_sent_replies(self):
        interrupted = self.run_trace(outage=Outage(0, 10, 12))
        self.assertEqual(interrupted["wasted_backend_ms"], .030)
        self.assertEqual(interrupted["outage_failed"], 1)
        self.assertEqual(self.run_trace(outage=Outage(0, 25, 26))["completed"], 1)

    def test_outage_fails_outbound_and_new_calls_even_if_recovered_on_arrival(self):
        for start, end in ((3, 4), (1, 3)):
            with self.subTest(start=start):
                result = self.run_trace(width=1, outage=Outage(0, start, end))
                self.assertEqual(result["outage_failed"], 1)
                self.assertEqual(result["wasted_backend_ms"], 0)
                events = result["inspected"]["events"]
                self.assertEqual(events[-1]["at_us"], 7)
                self.assertFalse(any(e["phase"] == "request_received" for e in events))

    def test_outage_cases_share_a_seeded_schedule_without_changing_traffic(self):
        settings = {"outage_ms": 500, "slowdown": 1}
        paired = experiment(settings)
        self.assertEqual(paired, experiment(settings))
        self.assertEqual(paired["workload_sha256"], experiment({})["workload_sha256"])
        one_baseline, one_outage, four_baseline, four_outage = paired["cases"]
        self.assertIsNone(one_baseline["outage"])
        self.assertIsNone(four_baseline["outage"])
        self.assertEqual(one_outage["outage"], four_outage["outage"])
        self.assertGreater(four_outage["outage_failed"], one_outage["outage_failed"])
        self.assertEqual(run_fanout({**settings, "width": 4})["result"]["outage"], four_outage["outage"])
        for case in paired["cases"]:
            self.assertEqual(case["offered"], sum(case[key] for key in
                ("completed", "timed_out", "outage_failed", "coordinator_rejected", "shard_rejected")))

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
