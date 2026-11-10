import json
import multiprocessing
from threading import Event
from concurrent.futures import ThreadPoolExecutor
from time import sleep
import unittest

from fastapi.testclient import TestClient

from lbsim.api import APIError, Limits, create_app, isolated_run
from lbsim.simulation import run_simulation


CONFIG = dict(server_count=2, concurrency=2, queue_limit=2, arrival_rate=10.0,
              duration=2.0, service_min=0.1, service_max=1.0, seed=42, policy='round_robin')


def hanging_worker(connection, config):
    sleep(60)


def crashed_worker(connection, config):
    connection.close()


class APITests(unittest.TestCase):
    def test_http_matches_direct_engine_for_both_policies_and_mixed_rates(self):
        with TestClient(create_app()) as client:
            for policy in ('round_robin', 'least_active_requests'):
                config = {**CONFIG, 'policy': policy, 'processing_rates': [0.5, 2.0]}
                response = client.post('/v1/run', json={'config': config})
                self.assertEqual(response.status_code, 200, response.text)
                result = response.json()
                self.assertEqual(result['api_version'], '1')
                self.assertEqual(result['config'], config)
                # JSON turns tuple events and numeric dictionary keys into wire types.
                expected = json.loads(json.dumps(run_simulation(config)))
                self.assertEqual(result['summary'], expected)

    def test_health_schema_and_http_errors(self):
        with TestClient(create_app()) as client:
            response = client.get('/health')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['limits']['concurrent_runs'], 1)
            self.assertIn('/v1/run', client.get('/openapi.json').json()['paths'])
            for path, method, status, code in (
                ('/absent', 'get', 404, 'NOT_FOUND'),
                ('/v1/run', 'get', 405, 'METHOD_NOT_ALLOWED')):
                response = getattr(client, method)(path)
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.json()['code'], code)

    def test_bad_json_envelopes_and_configuration_never_run(self):
        def must_not_run(*args):
            self.fail('Invalid input reached the engine')
        with TestClient(create_app(runner=must_not_run)) as client:
            for body in ({}, {'config': []}, {'config': CONFIG, 'ignored': True}):
                response = client.post('/v1/run', json=body)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()['code'], 'INVALID_REQUEST')
            response = client.post('/v1/run', content=b'{', headers={'Content-Type': 'application/json'})
            self.assertEqual(response.status_code, 422)
            for config in ({**CONFIG, 'concurrency': True}, {**CONFIG, 'duration': -1},
                           {**CONFIG, 'policy': 'unknown'}, {**CONFIG, 'processing_rates': [1]},
                           {**CONFIG, 'regions': []}, {**CONFIG, 'service_min': 2}):
                response = client.post('/v1/run', json={'config': config})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(response.json()['code'], 'INVALID_CONFIG')
                self.assertTrue(response.json()['field_errors'])
            response = client.post('/v1/run', content=json.dumps({'config': {**CONFIG, 'duration': float('inf')}}),
                                   headers={'Content-Type': 'application/json'})
            self.assertEqual(response.status_code, 422)

    def test_workload_limits_and_body_limit_including_chunked_upload(self):
        limits = Limits(body_bytes=1024, generated_requests=100, servers=4, slots=8, waiting_places=12)
        with TestClient(create_app(limits=limits, runner=lambda *_: {})) as client:
            for change in ({'arrival_rate': 1000}, {'server_count': 5},
                           {'concurrency': 5}, {'queue_limit': 7}):
                response = client.post('/v1/run', json={'config': {**CONFIG, **change}})
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()['code'], 'WORKLOAD_LIMIT')
            response = client.post('/v1/run', content=b' ' * 1025)
            self.assertEqual(response.status_code, 413)
            response = client.post('/v1/run', content=iter([b' ' * 700, b' ' * 700]))
            self.assertEqual(response.status_code, 413)
            self.assertEqual(response.json()['code'], 'BODY_TOO_LARGE')
            self.assertEqual(client.get('/health').status_code, 200)

    def test_busy_rejection_health_and_capacity_recovery(self):
        entered, release = Event(), Event()
        def blocked(config, limits):
            entered.set()
            if not release.wait(5):
                raise RuntimeError('Test worker was not released')
            return run_simulation(config)
        with TestClient(create_app(runner=blocked)) as client, ThreadPoolExecutor(1) as executor:
            first = executor.submit(client.post, '/v1/run', json={'config': CONFIG})
            try:
                self.assertTrue(entered.wait(3))
                self.assertEqual(client.get('/health').status_code, 200)
                second = client.post('/v1/run', json={'config': CONFIG})
                self.assertEqual(second.status_code, 429)
                self.assertEqual(second.json()['code'], 'RUN_BUSY')
            finally:
                release.set()
            self.assertEqual(first.result(timeout=5).status_code, 200)
            self.assertEqual(client.post('/v1/run', json={'config': CONFIG}).status_code, 200)

    def test_timeout_and_crash_reap_workers(self):
        before = {child.pid for child in multiprocessing.active_children()}
        with self.assertRaises(APIError) as error:
            isolated_run(CONFIG, Limits(worker_seconds=0.1), worker_target=hanging_worker)
        self.assertEqual(error.exception.code, 'RUN_TIMEOUT')
        self.assertEqual({child.pid for child in multiprocessing.active_children()}, before)
        with self.assertRaises(APIError) as error:
            isolated_run(CONFIG, Limits(worker_seconds=5), worker_target=crashed_worker)
        self.assertEqual(error.exception.code, 'ENGINE_FAILED')
        self.assertEqual({child.pid for child in multiprocessing.active_children()}, before)

    def test_timeout_error_envelope_releases_gate(self):
        calls = []
        def timeout_once(config, limits):
            calls.append(config)
            if len(calls) == 1:
                raise APIError(504, 'RUN_TIMEOUT', 'Simulation exceeded runtime limit.')
            return {}
        with TestClient(create_app(runner=timeout_once)) as client:
            self.assertEqual(client.post('/v1/run', json={'config': CONFIG}).json()['code'], 'RUN_TIMEOUT')
            self.assertEqual(client.post('/v1/run', json={'config': CONFIG}).status_code, 200)


if __name__ == '__main__':
    unittest.main()
