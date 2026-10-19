import unittest

from lbsim.server import Request, Server
from lbsim.utils.generate_seed import route


class ServerTests(unittest.TestCase):
    def test_worked_example_drains_in_fifo_order(self):
        server = Server(0, 1, 1)
        self.assertEqual(server.submit(Request(0, 0, 3), 0).execution.completion_time, 3)
        self.assertEqual(server.submit(Request(1, 1, 2), 1).status, "queued")
        self.assertEqual(server.submit(Request(2, 2, 1), 2).status, "rejected")
        first = server.complete(0, 3)
        self.assertEqual(first.started.request.id, 1)
        self.assertEqual(server.submit(Request(3, 3, 1), 3).status, "queued")
        second = server.complete(1, 5)
        self.assertEqual(second.started.request.id, 3)
        third = server.complete(3, 6)
        self.assertIsNone(third.started)
        self.assertEqual([e.completion_time - e.request.arrival_time
                          for e in (first.finished, second.finished, third.finished)], [3, 4, 3])
        self.assertEqual(server.running, ())
        self.assertEqual(server.waiting, ())

    def test_multiple_slots_and_fifo(self):
        server = Server(0, 2, 2)
        for i, duration in enumerate([4, 2, 3, 1]):
            self.assertEqual(server.submit(Request(i, 0, duration), 0).status,
                             "started" if i < 2 else "queued")
        self.assertEqual(server.complete(1, 2).started.request.id, 2)
        self.assertEqual(server.complete(0, 4).started.request.id, 3)
        server.complete(2, 5)
        server.complete(3, 5)
        self.assertEqual(server.running, ())

    def test_zero_queue_and_completion_before_arrival(self):
        server = Server(0, 1, 0)
        server.submit(Request(0, 0, 2), 0)
        self.assertEqual(server.submit(Request(1, 1, 1), 1).status, "rejected")
        with self.assertRaises(ValueError):
            server.submit(Request(2, 2, 1), 2)
        server.complete(0, 2)
        self.assertEqual(server.submit(Request(2, 2, 1), 2).status, "started")

    def test_invalid_events_leave_state_unchanged(self):
        server = Server(0, 1, 1)
        server.submit(Request(0, 1, 2), 1)
        before = server.running
        for request_id, time in [(0, 2), (0, 4), (99, 3), (0, 0)]:
            with self.subTest(request_id=request_id, time=time):
                with self.assertRaises(ValueError):
                    server.complete(request_id, time)
                self.assertEqual(server.running, before)
        with self.assertRaises(ValueError):
            server.submit(Request(0, 1, 1), 1)
        server.complete(0, 3)

    def test_invalid_capacity_and_request_times(self):
        for slots, limit in [(0, 1), (1, -1), (True, 1), (1.5, 1)]:
            with self.assertRaises(ValueError):
                Server(0, slots, limit)
        for arrival, service in [(-1, 1), (0, 0), (0, -1), (float('nan'), 1),
                                 (0, float('inf')), (1e300, 1)]:
            with self.assertRaises(ValueError):
                Request(0, arrival, service)

class RoundRobinRoutingTests(unittest.TestCase):
    def test_consistency(self):
        for _ in range(10):
            c, r = route(3, 1, 1, "round_robin", 7.0, 1.0, 5.0, 7.0, 2)
            self.assertEqual(len(c), 6)
            self.assertEqual(len(r), 1)
    
    def test_no_rejected(self):
        c, r = route(100, 1, 1, "round_robin", 10.0, 1.0, 5.0, 7.0, 2)
        self.assertEqual(len(c), 10)
        self.assertEqual(len(r), 0)

    def test_round_robin_sequential_assignment(self):
        c, r = route(3, 10, 10, "round_robin", 6.0, 1.0, 1.0, 2.0, 2)
        
        self.assertEqual(len(r), 0)
        self.assertEqual(len(c), 6)
        
        c.sort(key=lambda exec: exec.request.id)
        
        # Verify routing sequence: 0, 1, 2, 0, 1, 2
        expected_servers = [0, 1, 2, 0, 1, 2]
        actual_servers = [exec.server_id for exec in c]
        self.assertEqual(actual_servers, expected_servers)

    def test_zero_queue_rejections(self):
        c, r = route(2, 1, 0, "round_robin", 4.0, 1.0, 5.0, 5.0, 2)
        
        self.assertEqual(len(c), 2)
        self.assertEqual(len(r), 2)
        
        self.assertEqual(sorted(r), [2, 3])

    def test_empty_workload(self):
        c, r = route(3, 1, 1, "round_robin", 0.0, 1.0, 1.0, 2.0, 2)
        self.assertEqual(len(c), 0)
        self.assertEqual(len(r), 0)


if __name__ == '__main__':
    unittest.main()
