from pathlib import Path
import unittest
from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parents[1] / 'src' / 'lbsim' / 'app.py'


class SettingsFormTests(unittest.TestCase):
    def test_submit_and_resubmit(self):
        app = AppTest.from_file(str(APP)).run()
        self.assertFalse(app.exception)
        app.number_input(key='queue_limit').set_value(0)
        app.number_input(key='seed').set_value(-42)
        app.button[0].click().run()
        self.assertFalse(app.exception)
        self.assertFalse(app.error)
        config = app.session_state['config']
        self.assertEqual(config['queue_limit'], 0)
        self.assertEqual(config['seed'], -42)
        self.assertEqual(len(config), 9)
        self.assertTrue(any('do not reflect' in c.value for c in app.caption))
        app.number_input(key='server_count').set_value(5)
        app.button[0].click().run()
        self.assertEqual(app.session_state['config']['server_count'], 5)

    def test_invalid_settings_clear_previous_preview(self):
        app = AppTest.from_file(str(APP)).run()
        app.button[0].click().run()
        app.number_input(key='service_min').set_value(2.0)
        app.button[0].click().run()
        self.assertFalse(app.exception)
        self.assertIn('service_min', app.error[0].value)
        self.assertEqual(len(app.json), 0)
        app.number_input(key='service_min').set_value(0.1)
        app.number_input(key='server_count').set_value(0)
        app.button[0].click().run()
        self.assertIn('server_count', app.error[0].value)
