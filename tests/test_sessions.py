from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep
import unittest

from fastapi.testclient import TestClient

from lbsim.api import create_app
from lbsim.sessions import SessionLimits, SessionManager, session_worker

CONFIG = dict(
    server_count=4,
    concurrency=2,
    queue_limit=8,
    arrival_rate=100.0,
    service_min=0.01,
    service_max=0.1,
    seed=42,
    policy="round_robin",
)


def dead_worker(connection, *_args):
    connection.close()


def hung_worker(connection, config, limits, *_args):
    now = monotonic()
    connection.send(dict(_born=now, _activity=now, simulation_time=0, status="running"))
    sleep(60)


class SessionTests(unittest.TestCase):
    def create(self, client, config=None, **options):
        response = client.post(
            "/v1/sessions", json={"config": config or CONFIG, **options}
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def command(self, client, sid, action, value=None):
        body = {"action": action}
        if value is not None:
            body["value"] = value
        response = client.post(f"/v1/sessions/{sid}/commands", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_clock_progresses_without_polling_pause_resume_drain_and_reconnect(self):
        limits = SessionLimits(tick_seconds=0.01, history_interval_seconds=0.01)
        with TestClient(create_app(session_limits=limits)) as client:
            initial = self.create(client)
            sid = initial["session_id"]
            self.assertEqual(len(sid), 32)
            sleep(0.18)  # No browser/snapshot requests drive this interval.
            paused = self.command(client, sid, "pause")
            self.assertGreater(paused["simulation_time"], 0.05)
            self.assertGreater(paused["totals"]["offered"], 0)
            sleep(0.07)
            frozen = client.get(f"/v1/sessions/{sid}/snapshot").json()
            self.assertEqual(frozen["simulation_time"], paused["simulation_time"])
            self.assertEqual(frozen["totals"], paused["totals"])
            self.command(client, sid, "set_rate", 0)
            self.command(client, sid, "set_speed", 5)
            self.command(client, sid, "resume")
            sleep(0.15)
            drained = self.command(client, sid, "pause")
            self.assertEqual(drained["totals"]["offered"], paused["totals"]["offered"])
            self.assertEqual(
                drained["totals"]["running"] + drained["totals"]["waiting"], 0
            )
            self.assertEqual(drained["command_sequence"], 5)
            self.assertEqual(
                [c["sequence"] for c in drained["commands"]], list(range(1, 6))
            )
            self.assertNotIn("_born", drained)
            self.assertEqual(client.delete(f"/v1/sessions/{sid}").status_code, 200)
            self.assertEqual(
                client.get(f"/v1/sessions/{sid}/snapshot").status_code, 404
            )
            self.assertEqual(client.delete(f"/v1/sessions/{sid}").status_code, 404)

    def test_pagination_retention_limits_and_serialized_commands(self):
        limits = SessionLimits(
            response_window=9,
            history_points=5,
            server_page=2,
            command_log=3,
            tick_seconds=0.01,
            history_interval_seconds=0.01,
        )
        with TestClient(create_app(session_limits=limits)) as client:
            initial = self.create(client, paused=True)
            sid = initial["session_id"]
            self.assertEqual(len(initial["servers"]["items"]), 2)
            with ThreadPoolExecutor(max_workers=4) as pool:
                responses = list(
                    pool.map(
                        lambda value: self.command(client, sid, "set_rate", value),
                        [10, 20, 30, 40],
                    )
                )
            self.assertEqual(
                sorted(r["command_sequence"] for r in responses), [1, 2, 3, 4]
            )
            last = client.get(
                f"/v1/sessions/{sid}/snapshot?server_offset=2&server_limit=2&history_limit=0"
            ).json()
            self.assertEqual([s["id"] for s in last["servers"]["items"]], [2, 3])
            self.assertEqual(last["history"], [])
            self.assertEqual(len(last["commands"]), 3)
            self.assertTrue(last["command_log_truncated"])
            self.command(client, sid, "set_speed", 10)
            self.command(client, sid, "resume")
            sleep(0.2)
            last = self.command(client, sid, "pause")
            self.assertEqual(last["metrics"]["response_window_count"], 9)
            self.assertLessEqual(len(last["history"]), 5)
            self.assertLessEqual(last["retention"]["pending_completions"], 8)
            for query in (
                "server_limit=3",
                "server_limit=0",
                "server_offset=-1",
                "history_limit=6",
            ):
                response = client.get(f"/v1/sessions/{sid}/snapshot?{query}")
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()["code"], "INVALID_REQUEST")

    def test_admission_expiration_restart_loss_and_shutdown_reap_workers(self):
        limits = SessionLimits(max_sessions=1, idle_seconds=0.2, tick_seconds=0.01)
        app = create_app(session_limits=limits)
        with TestClient(app) as client:
            sid = self.create(client)["session_id"]
            self.assertEqual(
                client.post("/v1/sessions", json={"config": CONFIG}).status_code, 429
            )
            sleep(0.32)
            response = client.get(f"/v1/sessions/{sid}/snapshot")
            self.assertEqual(response.status_code, 410, response.text)
            self.assertEqual(response.json()["code"], "SESSION_EXPIRED")
            new = self.create(client, paused=True)["session_id"]
            self.assertNotEqual(new, sid)
            remaining = app.state.sessions.sessions[new].process
        self.assertEqual(app.state.sessions.sessions, {})
        self.assertTrue(getattr(remaining, "_closed", False))
        with TestClient(create_app()) as restarted:
            response = restarted.get(f"/v1/sessions/{new}/snapshot")
            self.assertEqual(response.status_code, 404)
            self.assertEqual(restarted.get("/health").status_code, 200)

    def test_absolute_lifetime_expires_even_with_active_polling(self):
        limits = SessionLimits(lifetime_seconds=0.25, idle_seconds=5, tick_seconds=0.01)
        with TestClient(create_app(session_limits=limits)) as client:
            sid = self.create(client, paused=True)["session_id"]
            deadline = monotonic() + 2
            while monotonic() < deadline:
                response = client.get(f"/v1/sessions/{sid}/snapshot")
                if response.status_code == 410:
                    break
                self.assertEqual(response.status_code, 200)
                sleep(0.04)
            self.assertEqual(response.status_code, 410)

    def test_failed_worker_tombstones_are_bounded_and_capacity_recovers(self):
        limits = SessionLimits(max_sessions=1, tombstones=2)
        app = create_app(session_limits=limits)
        with TestClient(app) as client:
            ids = []
            for _ in range(3):
                sid = self.create(client, paused=True)["session_id"]
                ids.append(sid)
                process = app.state.sessions.sessions[sid].process
                process.terminate()
                process.join(timeout=1)
                app.state.sessions.sweep()
                self.assertEqual(app.state.sessions.sessions, {})
            self.assertEqual(len(app.state.sessions.tombstones), 2)
            self.assertEqual(
                client.get(f"/v1/sessions/{ids[0]}/snapshot").status_code, 404
            )
            self.assertEqual(
                client.get(f"/v1/sessions/{ids[-1]}/snapshot").status_code, 503
            )

    def test_invalid_inputs_cannot_create_or_change_sessions(self):
        with TestClient(create_app()) as client:
            for change in (
                {"duration": 1},
                {"arrival_rate": -1},
                {"arrival_rate": True},
                {"arrival_rate": 10**400},
                {"concurrency": 10000},
                {"processing_rates": [1]},
                {"service_min": 1e-300},
                {"regions": []},
            ):
                response = client.post(
                    "/v1/sessions", json={"config": {**CONFIG, **change}}
                )
                self.assertEqual(response.status_code, 422, response.text)
            for options in (
                {"speed": 0},
                {"speed": True},
                {"speed": "2"},
                {"paused": 1},
                {"unexpected": 1},
            ):
                response = client.post(
                    "/v1/sessions", json={"config": CONFIG, **options}
                )
                self.assertEqual(response.status_code, 422, response.text)
            sid = self.create(client, {**CONFIG, "arrival_rate": 0}, paused=True)[
                "session_id"
            ]
            for body in (
                {"action": "pause", "value": 1},
                {"action": "set_rate", "value": -1},
                {"action": "set_speed", "value": 11},
                {"action": "set_rate", "value": True},
                {"action": "set_rate"},
                {"action": "set_rate", "value": 10**400},
                {"action": "fail_server", "value": 0},
            ):
                response = client.post(f"/v1/sessions/{sid}/commands", json=body)
                self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(
                client.get("/v1/sessions/unknown/snapshot").status_code, 404
            )
            self.assertEqual(
                client.get(f"/v1/sessions/{sid}/snapshot").json()["command_sequence"], 0
            )

    def test_crash_and_timeout_cleanup_release_session_capacity(self):
        for target in (dead_worker, hung_worker):
            limits = SessionLimits(
                max_sessions=1, command_seconds=0.08, startup_seconds=0.6
            )
            manager = SessionManager(limits, worker_target=target)
            with TestClient(
                create_app(session_limits=limits, session_manager=manager)
            ) as client:
                response = client.post("/v1/sessions", json={"config": CONFIG})
                if response.status_code == 201:
                    sid = response.json()["session_id"]
                    response = client.get(f"/v1/sessions/{sid}/snapshot")
                self.assertIn(response.status_code, (503, 504), response.text)
                self.assertEqual(manager.sessions, {})
                self.assertEqual(manager.pending, 0)
                manager.worker_target = session_worker
                self.create(client)

    def test_healthy_session_and_health_remain_responsive_during_one_shot(self):
        started, release = Event(), Event()

        def runner(*_args):
            started.set()
            release.wait(2)
            return {}

        with TestClient(create_app(runner=runner)) as client:
            sid = self.create(client, paused=True)["session_id"]
            with ThreadPoolExecutor(max_workers=2) as pool:
                pending = pool.submit(
                    client.post, "/v1/run", json={"config": {**CONFIG, "duration": 1}}
                )
                self.assertTrue(started.wait(1))
                try:
                    self.assertEqual(client.get("/health").status_code, 200)
                    self.assertEqual(
                        client.get(f"/v1/sessions/{sid}/snapshot").status_code, 200
                    )
                finally:
                    release.set()
                self.assertEqual(pending.result().status_code, 200)


if __name__ == "__main__":
    unittest.main()
