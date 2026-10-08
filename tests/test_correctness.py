import unittest

from lbsim.settings import validate_config
from lbsim.simulation import run_simulation
from lbsim.utils.generate_seed import route


class SimulatorCorrectnessTests(unittest.TestCase):

    def assert_run_invariants(self, config):
        #check invariants that should hold for every complete simulation run
        config = validate_config(config)

        #runs the lower-level engine, we can inspect raw executions
        events = []
        completed, rejected = route(**config, events=events)

        #run through the public API
        summary = run_simulation(config)

        #both entry points should describe the same event history
        self.assertEqual(events, summary["events"])

        #same config and seed should reproduce the same result
        self.assertEqual(run_simulation(config), summary)

        expected_count = int(config["arrival_rate"] * config["duration"])
        expected_ids = list(range(expected_count))

        completed_ids = [execution.request.id for execution in completed]
        outcome_ids = completed_ids + list(rejected)

        #every generated request must appear exactly once as completed or rejected
        self.assertEqual(len(outcome_ids), len(set(outcome_ids)))
        self.assertEqual(sorted(outcome_ids), expected_ids)

        #public summary counts must agree with the raw engine results.
        self.assertEqual(summary["completed_count"], len(completed))
        self.assertEqual(summary["rejected_count"], len(rejected))
        self.assertEqual(
            summary["completed_count"] + summary["rejected_count"],
            expected_count,
        )

        #should be exactly one response time for each completed request
        self.assertEqual(
            len(summary["response_times"]),
            summary["completed_count"],
        )

        #raw executions must have valid lifecycle timing
        for execution in completed:
            self.assertLessEqual(
                execution.request.arrival_time,
                execution.start_time,
            )
            self.assertLess(
                execution.start_time,
                execution.completion_time,
            )

        #each server starts its requests in arrival order (FIFO)
        by_arrival = sorted(completed, key=lambda execution: execution.request.id)
        for server_id in range(config["server_count"]):
            start_times = [
                execution.start_time
                for execution in by_arrival
                if execution.server_id == server_id
            ]
            self.assertEqual(start_times, sorted(start_times))

        #start every server idle and unused servers are checked too
        states = {
            server_id: (0, 0)
            for server_id in range(config["server_count"])
        }

        previous_time = -1.0
        current_time = None
        saw_arrival_at_time = False
        arrival_ids = []

        for event in events:
            timestamp, server_id, running, waiting, action, request_id = event

            #simulated time never moves backward
            self.assertGreaterEqual(timestamp, previous_time)
            previous_time = timestamp

            self.assertIn(server_id, states)
            self.assertIn(
                action,
                {"started", "queued", "rejected", "completed"},
            )

            #recorded server state stays within configured capacity
            self.assertGreaterEqual(running, 0)
            self.assertLessEqual(running, config["concurrency"])
            self.assertGreaterEqual(waiting, 0)
            self.assertLessEqual(waiting, config["queue_limit"])

            #each event moves the server's (running, waiting) state by one valid step
            previous_running, previous_waiting = states[server_id]
            full = (config["concurrency"], config["queue_limit"])
            if action == "started":
                self.assertEqual(
                    (running, waiting),
                    (previous_running + 1, previous_waiting),
                )
            elif action == "queued":
                self.assertEqual(previous_running, config["concurrency"])
                self.assertEqual(
                    (running, waiting),
                    (previous_running, previous_waiting + 1),
                )
            elif action == "rejected":
                #reject only when every slot and queue space is already taken
                self.assertEqual((previous_running, previous_waiting), full)
                self.assertEqual((running, waiting), full)
            elif previous_waiting:
                #a completion immediately starts the next queued request
                self.assertEqual(
                    (running, waiting),
                    (previous_running, previous_waiting - 1),
                )
            else:
                self.assertEqual((running, waiting), (previous_running - 1, 0))

            #at equal timestamps, all completions must precede arrivals
            if timestamp != current_time:
                current_time = timestamp
                saw_arrival_at_time = False

            if action == "completed":
                self.assertFalse(
                    saw_arrival_at_time,
                    "completion occurred after an arrival at the same timestamp",
                )
            else:
                saw_arrival_at_time = True
                arrival_ids.append(request_id)

            states[server_id] = (running, waiting)

        #every generated request should have exactly one arrival event
        self.assertEqual(arrival_ids, expected_ids)

        #completion events match the raw completed executions, in order
        self.assertEqual(
            [event[5] for event in events if event[4] == "completed"],
            completed_ids,
        )

        #after draining, every server's idle with an empty queue
        for server_id, state in states.items():
            self.assertEqual(
                state,
                (0, 0),
                f"server {server_id} was not idle after draining",
            )

        #utilization is a fraction for every configured server
        self.assertEqual(
            set(summary["per_server_utilization"]),
            set(range(config["server_count"])),
        )
        for utilization in summary["per_server_utilization"].values():
            self.assertGreaterEqual(utilization, 0)
            self.assertLessEqual(utilization, 1)

        return summary

    def test_exact_one_server_trace(self):
        #exact integrated example from docs/simulation-model.md
        config = {
            "server_count": 1,
            "concurrency": 1,
            "queue_limit": 1,
            "arrival_rate": 1.0,
            "duration": 4.0,
            "service_min": 3.0,
            "service_max": 3.0,
            "seed": 42,
            "policy": "round_robin",
        }

        result = self.assert_run_invariants(config)

        self.assertEqual(
            result,
            {
                "completed_count": 3,
                "rejected_count": 1,
                "mean_response_time": 14 / 3,
                "p95_response_time": 6.0,
                "per_server_utilization": {0: 1.0},
                "response_times": [3.0, 5.0, 6.0],
                "events": [
                    (0.0, 0, 1, 0, "started", 0),
                    (1.0, 0, 1, 1, "queued", 1),
                    (2.0, 0, 1, 1, "rejected", 2),
                    (3.0, 0, 1, 0, "completed", 0),
                    (3.0, 0, 1, 1, "queued", 3),
                    (6.0, 0, 1, 0, "completed", 1),
                    (9.0, 0, 0, 0, "completed", 3),
                ],
            },
        )

    def test_exact_two_server_traces(self):
        base = {
            "server_count": 2,
            "concurrency": 1,
            "arrival_rate": 2.0,
            "duration": 2.0,
            "service_min": 1.5,
            "service_max": 1.5,
            "seed": 42,
            "policy": "round_robin",
        }

        cases = [
            (
                "queue",
                {**base, "queue_limit": 1},
                {
                    "completed_count": 4,
                    "rejected_count": 0,
                    "mean_response_time": 1.75,
                    "p95_response_time": 2.0,
                    "per_server_utilization": {0: 1.0, 1: 0.75},
                    "response_times": [1.5, 1.5, 2.0, 2.0],
                    "events": [
                        (0.0, 0, 1, 0, "started", 0),
                        (0.5, 1, 1, 0, "started", 1),
                        (1.0, 0, 1, 1, "queued", 2),
                        (1.5, 0, 1, 0, "completed", 0),
                        (1.5, 1, 1, 1, "queued", 3),
                        (2.0, 1, 1, 0, "completed", 1),
                        (3.0, 0, 0, 0, "completed", 2),
                        (3.5, 1, 0, 0, "completed", 3),
                    ],
                },
            ),
            (
                "zero_queue",
                {**base, "queue_limit": 0},
                {
                    "completed_count": 2,
                    "rejected_count": 2,
                    "mean_response_time": 1.5,
                    "p95_response_time": 1.5,
                    "per_server_utilization": {0: 0.75, 1: 0.75},
                    "response_times": [1.5, 1.5],
                    "events": [
                        (0.0, 0, 1, 0, "started", 0),
                        (0.5, 1, 1, 0, "started", 1),
                        (1.0, 0, 1, 0, "rejected", 2),
                        (1.5, 0, 0, 0, "completed", 0),
                        (1.5, 1, 1, 0, "rejected", 3),
                        (2.0, 1, 0, 0, "completed", 1),
                    ],
                },
            ),
        ]

        for name, config, expected in cases:
            with self.subTest(name=name):
                result = self.assert_run_invariants(config)
                self.assertEqual(result, expected)

    def test_run_invariants_across_shapes(self):
        cases = {
            "normal_load": {
                "server_count": 2,
                "concurrency": 1,
                "queue_limit": 1,
                "arrival_rate": 2.0,
                "duration": 2.0,
                "service_min": 0.1,
                "service_max": 0.1,
                "seed": 7,
                "policy": "round_robin",
            },
            "overload": {
                "server_count": 1,
                "concurrency": 1,
                "queue_limit": 1,
                "arrival_rate": 8.0,
                "duration": 1.0,
                "service_min": 2.0,
                "service_max": 2.0,
                "seed": 7,
                "policy": "round_robin",
            },
            "multi_slot": {
                "server_count": 2,
                "concurrency": 3,
                "queue_limit": 2,
                "arrival_rate": 8.0,
                "duration": 1.0,
                "service_min": 1.0,
                "service_max": 1.0,
                "seed": 7,
                "policy": "round_robin",
            },
            "zero_queue": {
                "server_count": 2,
                "concurrency": 1,
                "queue_limit": 0,
                "arrival_rate": 5.0,
                "duration": 1.0,
                "service_min": 2.0,
                "service_max": 2.0,
                "seed": 7,
                "policy": "round_robin",
            },
            #varied service times so seeded replay and deeper queues are exercised
            "mixed_service": {
                "server_count": 3,
                "concurrency": 2,
                "queue_limit": 3,
                "arrival_rate": 20.0,
                "duration": 5.0,
                "service_min": 0.1,
                "service_max": 1.0,
                "seed": 11,
                "policy": "round_robin",
            },
            "empty_run": {
                "server_count": 3,
                "concurrency": 1,
                "queue_limit": 1,
                "arrival_rate": 1.0,
                "duration": 0.1,
                "service_min": 1.0,
                "service_max": 1.0,
                "seed": 7,
                "policy": "round_robin",
            },
        }

        for name, config in cases.items():
            with self.subTest(name=name):
                self.assert_run_invariants(config)


if __name__ == "__main__":
    unittest.main()