import unittest

from fastapi.testclient import TestClient

from lbsim.api import create_app
from lbsim.simulation import run_simulation


CONFIG = dict(
    server_count=1, concurrency=1, queue_limit=0, policy="round_robin",
    arrival_rate=2, duration=1, service_min=1, service_max=1, seed=42,
)


class RetryTests(unittest.TestCase):
    def test_immediate_retries_amplify_overload_and_backoff_recovers(self):
        retry = {"mode": "immediate", "limit": 2, "base_ms": 1200}
        immediate = run_simulation({**CONFIG, "retry": retry})
        self.assertEqual(immediate["retry_attempts"], 2)
        self.assertEqual((immediate["completed_count"], immediate["rejected_count"]), (1, 1))

        config = {**CONFIG, "retry": {**retry, "mode": "backoff"}}
        backoff = run_simulation(config)
        self.assertEqual(backoff, run_simulation(config))
        self.assertEqual(backoff["retry_attempts"], 1)
        self.assertEqual((backoff["completed_count"], backoff["rejected_count"]), (2, 0))
        self.assertGreaterEqual(backoff["response_times"][1], 1.6)

    def test_recording_reconciles_original_requests_while_retry_waits(self):
        config = {**CONFIG, "retry": {"mode": "backoff", "limit": 1, "base_ms": 1200}}
        with TestClient(create_app()) as client:
            response = client.post("/v1/runs", json={"config": config})
            self.assertEqual(response.status_code, 201, response.text)
            run = response.json()
            snapshot = client.get(f"/v1/runs/{run['run_id']}/snapshot", params={"time": .75})
            self.assertEqual(snapshot.status_code, 200, snapshot.text)
            self.assertEqual(snapshot.json()["totals"]["offered"], 2)
            self.assertEqual(snapshot.json()["totals"]["rejected"], 0)
            self.assertEqual(run["summary"]["retry_attempts"], 1)

    def test_api_bounds_potential_attempts_and_rejects_live_retries(self):
        config = {**CONFIG, "retry": {"mode": "immediate", "limit": 5, "base_ms": 100}}
        with TestClient(create_app()) as client:
            response = client.post("/v1/run-summary", json={"config": {**config, "arrival_rate": 20000}})
            self.assertEqual(response.status_code, 422, response.text)
            config.pop("duration")
            response = client.post("/v1/sessions", json={"config": config})
            self.assertEqual(response.status_code, 422, response.text)
