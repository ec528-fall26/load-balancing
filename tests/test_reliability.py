"""Server reliability: random outages, health-checked routing and re-routing.

Reliability A is the long-run fraction of time a server is up. Down periods
average `mean_repair_time` (MTTR); up periods average MTTR * A / (1 - A).
Requests running or queued on a failing server are re-routed to an up server
and restart from scratch, keeping their original arrival time.
"""

import unittest
from random import Random

from fastapi.testclient import TestClient

from lbsim.api import create_app
from lbsim.continuous import ContinuousSimulation
from lbsim.exports import build_exports
from lbsim.policies import RoutingContext, create_policy
from lbsim.reliability import outage_schedule
from lbsim.server import Request, Server
from lbsim.settings import validate_config
from lbsim.simulation import run_simulation
from lbsim.utils.generate_seed import route

BASE = dict(server_count=3, concurrency=2, queue_limit=3, arrival_rate=30.0,
            duration=20.0, service_min=.05, service_max=.15, seed=11,
            policy="least_active_requests")


def overlaps(execution, intervals):
    """True when an execution ran while its server was down."""
    return any(execution.start_time < end and execution.completion_time > start
               for start, end in intervals)


class ServerOutageTests(unittest.TestCase):
    def test_fail_returns_running_then_queued_and_empties_server(self):
        server = Server(0, 2, 2)
        server.submit(Request(0, 0, 5), 0)
        server.submit(Request(1, 0, 5), 0)
        server.submit(Request(2, 0, 5), 0)
        server.submit(Request(3, 0, 5), 0)
        dropped = server.fail(1)
        self.assertEqual([r.id for r in dropped], [0, 1, 2, 3])
        self.assertFalse(server.up)
        self.assertEqual((server.running, server.waiting), ((), ()))

    def test_submit_while_down_raises_and_recover_reopens(self):
        server = Server(0, 1, 1)
        server.fail(1)
        with self.assertRaisesRegex(ValueError, "down"):
            server.submit(Request(0, 2, 1), 2)
        server.recover(3)
        self.assertTrue(server.up)
        self.assertEqual(server.submit(Request(0, 4, 1), 4).status, "started")

    def test_fail_and_recover_reject_wrong_state(self):
        server = Server(0, 1, 1)
        with self.assertRaises(ValueError):
            server.recover(1)
        server.fail(1)
        with self.assertRaises(ValueError):
            server.fail(2)

    def test_late_submit_keeps_original_arrival_time(self):
        server = Server(0, 1, 0)
        execution = server.submit(Request(0, 1, 2), 3).execution
        self.assertEqual((execution.start_time, execution.completion_time), (3, 5))
        self.assertEqual(execution.request.arrival_time, 1)
        with self.assertRaises(ValueError):
            Server(0, 1, 0).submit(Request(1, 5, 1), 4)


class PolicyAvailabilityTests(unittest.TestCase):
    def context(self, up, running=None, rng=None):
        running = running or [0] * len(up)
        return RoutingContext(len(up), running.__getitem__, demand=running.__getitem__,
                              routing_rng=rng, available=up.__getitem__)

    def test_round_robin_skips_down_servers(self):
        policy = create_policy("round_robin", self.context([True, False, True]))
        self.assertEqual([policy.choose() for _ in range(4)], [0, 2, 0, 2])

    def test_tree_policies_skip_down_servers_and_readmit_on_recovery(self):
        for name in ("least_active_requests", "least_outstanding"):
            with self.subTest(policy=name):
                up = [False, True, True]
                running = [0, 3, 1]
                policy = create_policy(name, self.context(up, running))
                self.assertEqual(policy.choose(), 2)
                up[0] = True
                policy.update(0)
                self.assertEqual(policy.choose(), 0)
                up[0] = False
                policy.update(0)
                self.assertEqual(policy.choose(), 2)

    def test_power_of_two_only_samples_up_servers(self):
        up = [False, True, False, True]
        policy = create_policy("power_of_two", self.context(up, rng=Random(3)))
        self.assertTrue(all(policy.choose() in (1, 3) for _ in range(200)))
        up[3] = False
        self.assertEqual(policy.choose(), 1)

    def test_power_of_two_draws_unchanged_when_all_up(self):
        running = [2, 0, 1, 3, 0]
        plain = create_policy("power_of_two", RoutingContext(
            5, running.__getitem__, routing_rng=Random(9)))
        aware = create_policy("power_of_two", self.context([True] * 5, running, Random(9)))
        self.assertEqual([plain.choose() for _ in range(50)],
                         [aware.choose() for _ in range(50)])


class OutageScheduleTests(unittest.TestCase):
    def test_fully_reliable_servers_never_fail(self):
        self.assertEqual(outage_schedule((1.0, 1.0), 2.0, 100.0, 1), {0: [], 1: []})

    def test_deterministic_per_seed(self):
        a = outage_schedule((.9, .5), 2.0, 200.0, 4)
        self.assertEqual(a, outage_schedule((.9, .5), 2.0, 200.0, 4))
        self.assertNotEqual(a, outage_schedule((.9, .5), 2.0, 200.0, 5))

    def test_intervals_are_ordered_and_start_inside_the_run(self):
        schedule = outage_schedule((.7, 1.0, .3), 1.5, 300.0, 8)
        self.assertEqual(schedule[1], [])
        for sid in (0, 2):
            intervals = schedule[sid]
            self.assertTrue(intervals)
            previous_end = 0.0
            for start, end in intervals:
                self.assertGreaterEqual(start, previous_end)
                self.assertLess(start, 300.0)
                self.assertGreaterEqual(end, start)
                previous_end = end

    def test_long_run_fraction_up_matches_reliability(self):
        duration = 50_000.0
        for reliability in (.5, .8, .95):
            with self.subTest(reliability=reliability):
                down = sum(min(end, duration) - start for start, end in
                           outage_schedule((reliability,), 1.0, duration, 2)[0])
                self.assertAlmostEqual(1 - down / duration, reliability, delta=.02)

    def test_mean_repair_time_sets_outage_length(self):
        for repair in (.5, 4.0):
            with self.subTest(repair=repair):
                intervals = outage_schedule((.9,), repair, 50_000.0, 6)[0]
                mean = sum(end - start for start, end in intervals) / len(intervals)
                self.assertAlmostEqual(mean, repair, delta=repair * .1)


class EngineOutageTests(unittest.TestCase):
    def test_reroute_worked_example(self):
        # Server 1 is down from 0.6 to 2.0. Round robin, 1 slot, 2 queue places,
        # four 1-second requests at t = 0, 0.25, 0.5, 0.75.
        events = []
        completed, rejected = route(2, 1, 2, "round_robin", 4.0, 1.0, 1.0, 1.0, 7,
                                    events=events, outages={0: [], 1: [(.6, 2.0)]})
        self.assertEqual(rejected, [3])  # server 0 is full when r3 arrives
        by_id = {e.request.id: e for e in completed}
        self.assertEqual(sorted(by_id), [0, 1, 2])
        # r1 started on server 1 at 0.25, was re-routed at 0.6 and queued on server 0.
        self.assertEqual((by_id[1].server_id, by_id[1].start_time, by_id[1].completion_time),
                         (0, 2.0, 3.0))
        self.assertEqual(by_id[1].request.arrival_time, .25)
        actions = [(e[0], e[1], e[4], e[5]) for e in events]
        self.assertIn((.6, 1, "server_down", None), actions)
        self.assertIn((.6, 0, "rerouted", 1), actions)
        self.assertIn((2.0, 1, "server_up", None), actions)
        # At t = 2.0 the completion is handled before the recovery.
        at_two = [a[2] for a in actions if a[0] == 2.0]
        self.assertEqual(at_two, ["completed", "server_up"])

    def test_all_servers_down_rejects_arrivals_and_completion_wins_ties(self):
        events = []
        completed, rejected = route(1, 1, 1, "round_robin", 4.0, 1.0, .1, .1, 7,
                                    events=events, outages={0: [(.1, .6)]})
        self.assertEqual(sorted(e.request.id for e in completed), [0, 3])
        self.assertEqual(rejected, [1, 2])
        self.assertEqual([e[4] for e in events if e[0] == .1], ["completed", "server_down"])

    def test_reroute_rejected_when_no_server_can_take_it(self):
        events = []
        completed, rejected = route(1, 1, 1, "round_robin", 1.0, 1.0, 5.0, 5.0, 7,
                                    events=events, outages={0: [(1.0, 2.0)]})
        self.assertEqual((completed, rejected), ([], [0]))
        self.assertIn((1.0, 0, 0, 0, "reroute_rejected", 0), events)

    def test_every_request_finishes_once_and_never_on_a_down_server(self):
        for policy in ("round_robin", "least_active_requests", "least_outstanding",
                       "power_of_two"):
            with self.subTest(policy=policy):
                config = {**BASE, "policy": policy}
                schedule = outage_schedule((.6, .8, .9), 1.0, config["duration"], config["seed"])
                events = []
                completed, rejected = route(**config, events=events, outages=schedule)
                ids = [e.request.id for e in completed] + list(rejected)
                total = int(config["arrival_rate"] * config["duration"])
                self.assertEqual(sorted(ids), list(range(total)))
                self.assertTrue(any(e[4] == "rerouted" for e in events))
                for execution in completed:
                    self.assertFalse(overlaps(execution, schedule[execution.server_id]))
                    self.assertEqual(execution.request.arrival_time,
                                     execution.request.id / config["arrival_rate"])

    def test_no_outages_leaves_results_identical(self):
        for policy in ("round_robin", "least_active_requests", "least_outstanding",
                       "power_of_two"):
            with self.subTest(policy=policy):
                config = {**BASE, "policy": policy}
                plain_events, aware_events = [], []
                plain = route(**config, events=plain_events)
                aware = route(**config, events=aware_events,
                              reliabilities=(1.0, 1.0, 1.0), mean_repair_time=2.0)
                self.assertEqual(plain, aware)
                self.assertEqual(plain_events, aware_events)


class ConfigTests(unittest.TestCase):
    def base(self, **extra):
        return {**BASE, **extra}

    def test_all_reliable_keeps_the_original_config(self):
        self.assertEqual(validate_config(self.base(reliabilities=[1, 1.0, 1])),
                         validate_config(self.base()))
        self.assertEqual(validate_config(self.base(reliabilities=[1, 1, 1], mean_repair_time=3)),
                         validate_config(self.base()))

    def test_unreliable_servers_are_kept_with_default_repair_time(self):
        config = validate_config(self.base(reliabilities=[1, .5, .9]))
        self.assertEqual(config["reliabilities"], (1.0, .5, .9))
        self.assertEqual(config["mean_repair_time"], 1.0)
        config = validate_config(self.base(reliabilities=[1, .5, .9], mean_repair_time=4))
        self.assertEqual(config["mean_repair_time"], 4.0)

    def test_invalid_reliability_settings_are_rejected(self):
        bad = [
            dict(reliabilities=[1, 0, 1]),
            dict(reliabilities=[1, 1.5, 1]),
            dict(reliabilities=[1, float("nan"), 1]),
            dict(reliabilities=[1, True, 1]),
            dict(reliabilities=[1, .5]),
            dict(reliabilities=".5"),
            dict(reliabilities=[1, .5, 1], mean_repair_time=0),
            dict(reliabilities=[1, .5, 1], mean_repair_time=float("inf")),
            dict(reliabilities=[1, .5, 1], mean_repair_time="2"),
            dict(reliabilities=[1, .5, 1], request_model="cpu_io", outstanding_limit=4),
        ]
        for extra in bad:
            with self.subTest(extra=extra):
                with self.assertRaises(ValueError):
                    validate_config(self.base(**extra))


class SummaryAndIntegrationTests(unittest.TestCase):
    # Up periods average ~2.3 s and 4 s, so a 20 s run reliably sees outages.
    CONFIG = {**BASE, "reliabilities": [1.0, .7, .8], "mean_repair_time": 1.0}

    def test_summary_reports_outages_only_when_configured(self):
        plain = run_simulation(BASE)
        for key in ("rerouted_count", "outages", "per_server_availability"):
            self.assertNotIn(key, plain)
        summary = run_simulation(self.CONFIG)
        self.assertEqual(summary["outages"][0], [])
        self.assertEqual(summary["per_server_availability"][0], 1.0)
        for sid in (1, 2):
            self.assertTrue(summary["outages"][sid])
            self.assertLess(summary["per_server_availability"][sid], 1.0)
            self.assertGreater(summary["per_server_availability"][sid], 0.0)
        self.assertEqual(summary["rerouted_count"],
                         sum(e[4] in ("rerouted", "reroute_rejected") for e in summary["events"]))
        self.assertGreater(summary["rerouted_count"], 0)

    def test_summary_is_deterministic(self):
        self.assertEqual(run_simulation(self.CONFIG), run_simulation(self.CONFIG))

    def test_recorded_run_api_accepts_reliability(self):
        expected = run_simulation(self.CONFIG)
        with TestClient(create_app()) as client:
            response = client.post("/v1/runs", json={"config": self.CONFIG})
            self.assertEqual(response.status_code, 201, response.text)
            summary = response.json()["summary"]
            for key in ("completed_count", "rejected_count", "rerouted_count"):
                self.assertEqual(summary[key], expected[key])

    def test_unsupported_paths_reject_reliability(self):
        config = validate_config(self.CONFIG)
        with self.assertRaisesRegex(ValueError, "reliab"):
            build_exports(config, run_simulation(config))
        with self.assertRaisesRegex(ValueError, "reliab"):
            ContinuousSimulation(config)


if __name__ == "__main__":
    unittest.main()
