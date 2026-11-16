"""Server outages in continuous sessions, including the "fail server now" command.

Continuous sessions draw each server's up/down periods one at a time from the
same seeded streams as one-shot runs, so the same seed gives the same outages.
"""
from time import sleep
import unittest

from fastapi.testclient import TestClient

from lbsim.api import create_app
from lbsim.availability import outage_schedule
from lbsim.continuous import ContinuousSimulation
from lbsim.sessions import SessionLimits
from lbsim.settings import validate_config

BASE = dict(server_count=4, concurrency=1, queue_limit=5, arrival_rate=20.0,
            duration=1.0, service_min=.05, service_max=.15, seed=3,
            policy="least_active_requests")


def config(**extra):
    values = validate_config({**BASE, **extra})
    values.pop("duration")
    return values


class Recording(ContinuousSimulation):
    """Records each server's outages as (down, up) intervals."""

    def __init__(self, *args, **kwargs):
        self.log = {}
        super().__init__(*args, **kwargs)

    def _go_down(self, sid, recover_at):
        self.log.setdefault(sid, []).append([self.now, None])
        super()._go_down(sid, recover_at)

    def _go_up(self, sid):
        self.log[sid][-1][1] = self.now
        super()._go_up(sid)


class ContinuousAvailabilityTests(unittest.TestCase):
    def assert_consistent(self, engine):
        self.assertEqual(engine.offered,
                         engine.completed + engine.rejected + engine.running + engine.waiting)
        self.assertEqual(len(engine.pending), engine.running)
        self.assertEqual(sum(engine.active), engine.running)
        self.assertEqual(sum(engine.queued), engine.waiting)
        for sid, server in enumerate(engine.servers):
            if not server.up:
                self.assertEqual((engine.active[sid], engine.queued[sid]), (0, 0))
        self.assertEqual(engine.up_count, sum(s.up for s in engine.servers))

    def test_without_outages_snapshots_have_no_outage_fields(self):
        engine = ContinuousSimulation(config())
        engine.advance(5.0)
        snapshot = engine.snapshot()
        for key in ("outages", "rejected_breakdown"):
            self.assertNotIn(key, snapshot)
        self.assertNotIn("up", snapshot["servers"]["items"][0])
        self.assertNotIn("servers_down", snapshot["history"][-1])

    def test_outages_happen_and_requests_stay_accounted_for(self):
        engine = ContinuousSimulation(config(availabilities=[1, .9, .9, .5],
                                             mean_repair_time=2))
        for step in range(1, 241):
            while not engine.advance(step / 4, max_events=7):
                pass
            self.assert_consistent(engine)
        snapshot = engine.snapshot()
        outages = snapshot["outages"]
        self.assertGreater(outages["outage_count"], 0)
        self.assertGreater(outages["rerouted"], 0)
        breakdown = snapshot["rejected_breakdown"]
        self.assertEqual(sum(breakdown.values()), snapshot["totals"]["rejected"])
        rows = snapshot["servers"]["items"]
        self.assertEqual((rows[0]["outage_count"], rows[0]["measured_availability"]), (0, 1.0))
        for row in rows[1:]:
            self.assertGreater(row["outage_count"], 0)
            self.assertLess(row["measured_availability"], 1.0)
        self.assertEqual(sum(r["rerouted"] for r in rows), outages["rerouted"])
        self.assertEqual(sum(r["dropped"] for r in rows), outages["reroute_rejected"])

    def test_same_outages_as_a_one_shot_run_with_the_same_seed(self):
        engine = Recording(config(availabilities=[.9, .7, 1, .5], mean_repair_time=[1, 2, 1, 3]))
        while not engine.advance(200.0):
            pass
        schedule = outage_schedule((.9, .7, 1, .5), (1, 2, 1, 3), 150.0, 3)
        for sid, intervals in schedule.items():
            recorded = [tuple(i) for i in engine.log.get(sid, []) if i[0] < 150.0]
            self.assertEqual(len(recorded), len(intervals))
            for (down, up), (expected_down, expected_up) in zip(recorded, intervals):
                self.assertAlmostEqual(down, expected_down)
                self.assertAlmostEqual(up, expected_up)

    def test_deterministic(self):
        values = config(availabilities=[.6, .6, .8, .9])
        first, second = ContinuousSimulation(values), ContinuousSimulation(values)
        for engine in (first, second):
            while not engine.advance(30.0):
                pass
        self.assertEqual(first.snapshot(), second.snapshot())

    def test_arrivals_with_every_server_down_are_no_server_up(self):
        engine = ContinuousSimulation(config(server_count=1, availabilities=[.2],
                                             mean_repair_time=2))
        while not engine.advance(60.0):
            pass
        self.assert_consistent(engine)
        snapshot = engine.snapshot()
        self.assertGreater(snapshot["rejected_breakdown"]["no_server_up"], 0)
        self.assertEqual(sum(snapshot["rejected_breakdown"].values()),
                         snapshot["totals"]["rejected"])

    def test_fail_server_now_reroutes_and_recovers_after_mttr(self):
        # No availability settings: validation would drop the repair times, so
        # set them directly on the engine config.
        engine = ContinuousSimulation({**config(), "mean_repair_time": [1, 2.5, 1, 1]})
        engine.advance(3.0)
        busy = engine.active[1] + engine.queued[1]
        self.assertTrue(engine.fail_server(1))
        self.assertFalse(engine.servers[1].up)
        self.assert_consistent(engine)
        snapshot = engine.snapshot()  # telemetry appears after a manual failure
        self.assertEqual(snapshot["outages"]["servers_down"], 1)
        self.assertEqual(snapshot["outages"]["rerouted"] + snapshot["outages"]["reroute_rejected"], busy)
        self.assertFalse(snapshot["servers"]["items"][1]["up"])
        # Invalid or already-down servers are ignored, never errors.
        for sid in (1, -1, 4, 1.0, True, "1"):
            self.assertFalse(engine.fail_server(sid))
        engine.advance(5.5 - 1e-9)
        self.assertFalse(engine.servers[1].up)
        engine.advance(5.5)
        self.assertTrue(engine.servers[1].up)  # exactly its 2.5 s MTTR
        self.assertEqual(engine.snapshot()["servers"]["items"][1]["outage_count"], 1)
        self.assert_consistent(engine)
        # Fully available servers do not fail again on their own.
        while not engine.advance(60.0):
            pass
        self.assertEqual(engine.outage_count[1], 1)

    def test_fail_server_replaces_a_scheduled_failure(self):
        engine = ContinuousSimulation(config(availabilities=[.5, 1, 1, 1], mean_repair_time=1))
        engine.fail_server(0)
        engine.advance(1.0)  # manual outage lasts exactly 1 s
        self.assertTrue(engine.servers[0].up)
        self.assertEqual(engine.outage_count[0], 1)
        while not engine.advance(120.0):
            pass
        self.assertGreater(engine.outage_count[0], 1)  # automatic cycle continues
        self.assert_consistent(engine)


class FailServerCommandTests(unittest.TestCase):
    def test_fail_server_command_through_the_api(self):
        limits = SessionLimits(tick_seconds=0.01, history_interval_seconds=0.01)
        session = {k: v for k, v in BASE.items() if k != "duration"}
        with TestClient(create_app(session_limits=limits)) as client:
            created = client.post("/v1/sessions", json={
                "config": {**session, "availabilities": [1, 1, .9, .9], "mean_repair_time": 3},
                "paused": True,
            })
            self.assertEqual(created.status_code, 201, created.text)
            sid = created.json()["session_id"]
            response = client.post(f"/v1/sessions/{sid}/commands",
                                   json={"action": "fail_server", "value": 0})
            self.assertEqual(response.status_code, 200, response.text)
            snapshot = response.json()
            self.assertFalse(snapshot["servers"]["items"][0]["up"])
            self.assertEqual(snapshot["outages"]["servers_down"], 1)
            self.assertEqual(snapshot["commands"][-1]["action"], "fail_server")
            # A server number past the fleet is ignored, not an error.
            response = client.post(f"/v1/sessions/{sid}/commands",
                                   json={"action": "fail_server", "value": 999})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["outages"]["servers_down"], 1)
            client.post(f"/v1/sessions/{sid}/commands", json={"action": "set_speed", "value": 10})
            client.post(f"/v1/sessions/{sid}/commands", json={"action": "resume"})
            sleep(0.6)  # > 3 simulated seconds at 10x
            snapshot = client.post(f"/v1/sessions/{sid}/commands",
                                   json={"action": "pause"}).json()
            self.assertTrue(snapshot["servers"]["items"][0]["up"])
            self.assertEqual(client.delete(f"/v1/sessions/{sid}").status_code, 200)


if __name__ == "__main__":
    unittest.main()
