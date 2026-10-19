import unittest
from streamlit.testing.v1 import AppTest


class ResultsTests(unittest.TestCase):
    def render(self, summary):
        app = AppTest.from_string(
            'import streamlit as st\n'
            'from lbsim.results import display_summary\n'
            'display_summary(st.session_state["summary"])',
            default_timeout=30,
        )
        app.session_state['summary'] = summary
        return app.run()

    def test_fixture_display(self):
        app = self.render(dict(completed_count=3, rejected_count=1,
                               mean_response_time=10 / 3, p95_response_time=4,
                               per_server_utilization={9: 0.125, 0: 1}, response_times=[3, 4, 3]))
        self.assertFalse(app.exception)
        self.assertEqual([m.value for m in app.metric], ['3', '1', '3.333 s', '4.000 s'])
        table = app.table[0].value
        self.assertEqual(table['Server ID'].tolist(), [0, 9])
        self.assertEqual(table['Slot utilization (%)'].tolist(), [100, 12.5])

    def test_empty_and_rejected_only_display(self):
        for rejected in (0, 5):
            app = self.render(dict(completed_count=0, rejected_count=rejected,
                                   mean_response_time=None, p95_response_time=None,
                                   per_server_utilization={0: 0}))
            self.assertFalse(app.exception)
            self.assertEqual([m.value for m in app.metric], ['0', str(rejected), 'N/A', 'N/A'])
            self.assertIn('No completed requests', app.info[0].value)
            self.assertEqual(app.table[0].value['Slot utilization (%)'].tolist(), [0])
