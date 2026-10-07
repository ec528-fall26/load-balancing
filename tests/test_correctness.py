import unittest

from lbsim.server import Request, Server


class SimulatorCorrectnessTests(unittest.TestCase):

    def assert_server_invariants(self, server):
        #server shouldn't run more requests than its configured concurrency
        self.assertLessEqual(len(server.running), server.concurrency)

        #server shouldn't hold more waiting requests than its queue limit
        self.assertLessEqual(len(server.waiting), server.queue_limit)

        #request shouldn't never be both running and waiting
        running_ids = {execution.request.id for execution in server.running}
        waiting_ids = {request.id for request in server.waiting}

        self.assertTrue(running_ids.isdisjoint(waiting_ids))

        #every running execution should belong to this server and have valid times
        for execution in server.running:
            self.assertEqual(execution.server_id, server.id)
            self.assertLessEqual(
                execution.request.arrival_time,
                execution.start_time,
            )
            self.assertLess(
                execution.start_time,
                execution.completion_time,
            )

    def test_server_invariants_through_request_lifecycle(self):
        server = Server(0, 1, 1)

        # request 0 starts immediately
        first = server.submit(Request(0, 0, 3), 0)
        self.assertEqual(first.status, "started")
        self.assert_server_invariants(server)

        # request 1 has to wait
        second = server.submit(Request(1, 1, 2), 1)
        self.assertEqual(second.status, "queued")
        self.assert_server_invariants(server)

        # request 2 is rejected because both the slot and queue are full.
        third = server.submit(Request(2, 2, 1), 2)
        self.assertEqual(third.status, "rejected")
        self.assert_server_invariants(server)

        # finishing request 0 should immediately start request 1
        completion = server.complete(0, 3)

        self.assertEqual(completion.finished.request.id, 0)
        self.assertEqual(completion.started.request.id, 1)
        self.assertEqual(completion.started.start_time, 3)

        self.assert_server_invariants(server)

        # drain the remaining accepted request
        server.complete(1, 5)

        self.assertEqual(server.running, ())
        self.assertEqual(server.waiting, ())
        self.assert_server_invariants(server)


if __name__ == "__main__":
    unittest.main()