from pathlib import Path
import unittest
from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parents[1] / 'src' / 'lbsim' / 'app.py'


class SimulationAppTests(unittest.TestCase):
    def app(self):
        return AppTest.from_file(str(APP), default_timeout=30).run()

    def test_normal_run_and_changed_settings(self):
        app = self.app()
        for key, value in dict(server_count=2, concurrency=1, queue_limit=0,
                               arrival_rate=2.0, duration=2.0,
                               service_min=0.1, service_max=0.1, seed=-42).items():
            app.number_input(key=key).set_value(value)
        next(b for b in app.button if b.label == 'Run simulation').click().run()
        self.assertFalse(app.exception)
        self.assertFalse(app.error)
        self.assertEqual([m.value for m in app.metric], ['4', '0', '0.100 s', '0.100 s'])
        self.assertEqual(app.session_state['config']['seed'], -42)
        self.assertEqual(app.selectbox(key='policy').options, ['Round robin'])
        app.number_input(key='arrival_rate').set_value(3.0)
        next(b for b in app.button if b.label == 'Run simulation').click().run()
        self.assertEqual(app.metric[0].value, '6')

    def test_overload_drains_and_replays(self):
        app = self.app()
        for key, value in dict(server_count=1, concurrency=1, queue_limit=1,
                               arrival_rate=4.0, duration=1.0,
                               service_min=2.0, service_max=3.0, seed=42).items():
            app.number_input(key=key).set_value(value)
        next(b for b in app.button if b.label == 'Run simulation').click().run()
        self.assertFalse(app.exception)
        first = app.session_state['summary'].copy()
        self.assertEqual(first['completed_count'], 2)
        self.assertEqual(first['rejected_count'], 2)
        self.assertGreater(first['mean_response_time'], 1)
        self.assertEqual(first['per_server_utilization'], {0: 1})
        next(b for b in app.button if b.label == 'Run simulation').click().run()
        self.assertEqual(app.session_state['summary'], first)

    def test_invalid_settings_clear_previous_results(self):
        app = self.app()
        next(b for b in app.button if b.label == 'Run simulation').click().run()
        app.number_input(key='service_min').set_value(2.0)
        next(b for b in app.button if b.label == 'Run simulation').click().run()
        self.assertFalse(app.exception)
        self.assertIn('service_min', app.error[0].value)
        self.assertEqual(len(app.json), 0)
        self.assertEqual(len(app.metric), 0)
        app.number_input(key='service_min').set_value(0.1)
        app.number_input(key='server_count').set_value(0)
        next(b for b in app.button if b.label == 'Run simulation').click().run()
        self.assertIn('server_count', app.error[0].value)
