import unittest
from streamlit.testing.v1 import AppTest
from lbsim.datacenter import rack_view


class DatacenterTests(unittest.TestCase):
    def test_panels_use_actual_ids_and_utilization(self):
        html = rack_view([(7, 0), (42, 0.5), (99, 1)])
        self.assertIn('Server 7', html)
        self.assertIn('Server 42', html)
        self.assertIn('Server 99', html)
        self.assertIn('aria-valuenow="0.0"', html)
        self.assertIn('aria-valuenow="50.0"', html)
        self.assertIn('aria-valuenow="100.0"', html)
        self.assertEqual(html.count('class="dc-server"'), 3)

    def test_large_run_can_page_and_change_server_count(self):
        app = AppTest.from_string(
            'import streamlit as st\n'
            'from lbsim.datacenter import display_datacenter\n'
            'display_datacenter(st.session_state["servers"])', default_timeout=30)
        app.session_state['servers'] = {i: 0.5 for i in range(1000)}
        app.run()
        self.assertFalse(app.exception)
        app.selectbox[0].set_value(31).run()
        self.assertFalse(app.exception)
        self.assertTrue(any('Showing 8 of 1000' in c.value for c in app.caption))
        app.session_state['servers'] = {i: 0.5 for i in range(40)}
        app.run()
        self.assertFalse(app.exception)
        app.session_state['servers'] = {0: 0}
        app.run()
        self.assertFalse(app.exception)
        self.assertTrue(any('Showing 1 of 1' in c.value for c in app.caption))
