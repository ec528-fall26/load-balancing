import unittest
from fastapi.testclient import TestClient
from lbsim.api import create_app
from lbsim.cpu_io_preview import preview


class CPUIOPreviewTests(unittest.TestCase):
    def test_two_request_example_is_real_python_execution(self):
        with TestClient(create_app()) as client:
            response=client.post('/v1/research/cpu-io',json={'config':{}})
            self.assertEqual(response.status_code,200)
            result=response.json()
            state=[e for e in result['playback']['events'] if e['time']<=2][-1]
            self.assertEqual((state['cpu_active'],state['io_waiting'],state['outstanding']),([0],[2],[2]))
            self.assertEqual([r['completion'] for r in result['playback']['completions']],[4,5])

    def test_workload_comparison_is_paired_bounded_and_repeatable(self):
        config=dict(mode='workload',rate=400,profile='io_heavy',policy='power_of_two',seed=42)
        a=preview(config)
        self.assertEqual(a,preview(config))
        self.assertEqual(a['playback']['offered'],800)
        self.assertLessEqual(len(a['playback']['events']),4000)
        self.assertEqual(len({r['workload_sha256'] for r in a['comparison']}),1)
        for r in a['comparison']:
            self.assertEqual(r['completed']+r['rejected'],800)
        self.assertFalse(a['requests'])

    def test_bad_or_unbounded_inputs_return_validation_errors(self):
        with TestClient(create_app()) as client:
            for config in ({'rate':401},{'rate':True},{'seed':-1},{'mode':'other'},
                           {'policy':'nearest'},{'servers':10000},{'profile':[]},{'duration':10000}):
                with self.subTest(config=config):
                    response=client.post('/v1/research/cpu-io',json={'config':config})
                    self.assertEqual(response.status_code,422)
                    self.assertEqual(response.json()['code'],'INVALID_CONFIG')
