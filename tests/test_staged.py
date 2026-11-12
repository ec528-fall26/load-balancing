from math import inf
import unittest
from fastapi.testclient import TestClient
from lbsim.api import create_app
from lbsim.cpu_io import make_workload, run_staged
from lbsim.exports import build_exports
from lbsim.runs import RunStore
from lbsim.settings import validate_config
from lbsim.simulation import run_simulation
from lbsim.staged import StagedSimulation

CONFIG=dict(server_count=1,concurrency=1,queue_limit=1,arrival_rate=10.,duration=.2,
            service_min=4.,service_max=4.,seed=42,policy='round_robin',
            request_model='cpu_io',io_fraction=.5,outstanding_limit=2)

class StagedTests(unittest.TestCase):
    def test_hand_checked_one_shot_live_and_recorded_states(self):
        summary=run_simulation(CONFIG)
        self.assertEqual((summary['completed_count'],summary['rejected_count']),(2,0))
        self.assertEqual(summary['response_times'],[4.,4.9])
        self.assertAlmostEqual(summary['mean_cpu_queue_wait'],.45)
        live=StagedSimulation(CONFIG)
        live.arrival_limit=2
        while not live.advance(2,max_events=1):pass
        live.sample()
        snap=live.snapshot()
        self.assertEqual(snap['totals'],dict(offered=2,completed=0,rejected=0,running=0,waiting=0,io_waiting=2,io_active=2,io_queued=0,outstanding=2))
        self.assertEqual(snap['servers']['items'][0]['outstanding_limit'],2)
        live.set_rate(0)
        while not live.advance(5,max_events=1):pass
        self.assertEqual(list(live.responses),summary['response_times'])
        store=RunStore()
        try:
            r=store.add(CONFIG,summary);rid=r['run_id']
            self.assertEqual(r['summary']['events'],[])
            self.assertEqual(store.snapshot(rid,2,0,32)['totals'],snap['totals'])
            self.assertEqual(store.snapshot(rid,2,0,32)['idle_servers'],0)
            events=[];offset=0
            while True:
                page=store.events(rid,offset,2);events += [tuple(x['event']) for x in page['items']]
                if page['next_offset'] is None:break
                offset=page['next_offset']
            self.assertEqual(events,summary['events'])
            self.assertEqual(store.snapshot(rid,5,0,32)['totals']['outstanding'],0)
        finally:store.close()

    def test_old_research_model_matches_paired_new_engine(self):
        for policy in ('round_robin','least_active_requests','power_of_two'):
            for fraction in (0,.1,.9):
                with self.subTest(policy=policy,fraction=fraction):
                    c={**CONFIG,'server_count':4,'arrival_rate':80.,'duration':2,'service_min':.08,'service_max':.12,'outstanding_limit':4,'io_fraction':fraction,'policy':policy}
                    trace=make_workload(rate=80,duration=2,seed=42,io_fraction=fraction)
                    before=run_staged(trace,servers=4,cpu_slots=1,outstanding_limit=4,duration=2,policy=policy,routing_seed=1000042)
                    after=run_simulation(c)
                    self.assertEqual((after['completed_count'],after['rejected_count']),(before['completed'],before['rejected']))
                    self.assertEqual(sorted(after['response_times']),sorted(x['response'] for x in before['completions']))
                    self.assertAlmostEqual(after['mean_cpu_queue_wait'],before['mean_cpu_queue_wait'])

    def test_outstanding_signal_avoids_idle_cpu_with_full_admission(self):
        c={**CONFIG,'server_count':2,'duration':.4,'service_min':1.,'service_max':1.,'io_fraction':.9}
        least_active=run_simulation({**c,'policy':'least_active_requests'})
        least_outstanding=run_simulation({**c,'policy':'least_outstanding'})
        self.assertGreater(least_active['rejected_count'],least_outstanding['rejected_count'])
        self.assertEqual(least_outstanding['completed_count'],4)

    def test_speed_changes_only_cpu_not_io_and_empty_run(self):
        c={**CONFIG,'arrival_rate':1.,'duration':1,'processing_rates':[2]}
        self.assertEqual(run_simulation(c)['response_times'],[3.])
        empty=run_simulation({**c,'duration':.1})
        self.assertEqual(empty['events'],[])
        self.assertIsNone(empty['p95_response_time'])

    def test_live_retention_conservation_paging_and_rate_change(self):
        c={**CONFIG,'server_count':40,'arrival_rate':400.,'service_min':.08,'service_max':.12,'io_fraction':.9,'outstanding_limit':4,'policy':'least_outstanding'}
        sim=StagedSimulation(c,response_window=20,history_points=5)
        for t in range(1,31):
            while not sim.advance(t,max_events=31):pass
            sim.sample();s=sim.snapshot(server_offset=32,server_limit=8)
            totals=s['totals']
            self.assertEqual(totals['offered'],totals['completed']+totals['rejected']+totals['outstanding'])
            self.assertLessEqual(len(s['history']),5)
            self.assertLessEqual(len(sim.responses),20)
            self.assertFalse(sim.event_log or sim.all_responses)
            for row in s['servers']['items']:
                self.assertEqual(row['outstanding'],row['running']+row['waiting']+row['io_waiting'])
                self.assertLessEqual(row['outstanding'],4)
        sim.set_rate(0)
        while not sim.advance(32,max_events=31):pass
        self.assertEqual(sim.snapshot()['totals']['outstanding'],0)

    def test_validation_and_export_do_not_silently_drop_stages(self):
        for override in ({'io_fraction':1},{'io_fraction':True},{'outstanding_limit':0},{'request_model':'other'},{'request_model':'simple'}):
            with self.assertRaises(ValueError):validate_config({**CONFIG,**override})
        with self.assertRaisesRegex(ValueError,'CPU/I/O'):build_exports(CONFIG,run_simulation(CONFIG))
        with TestClient(create_app()) as client:
            r=client.post('/v1/runs',json={'config':CONFIG})
            self.assertEqual(r.status_code,201,r.text)
            body=r.json();self.assertEqual(body['config']['request_model'],'cpu_io')
            state=client.get(f"/v1/runs/{body['run_id']}/snapshot?time=2").json()
            self.assertEqual(state['totals']['io_waiting'],2)
            r=client.post('/v1/sessions',json={'config':{k:v for k,v in CONFIG.items() if k!='duration'},'paused':True})
            self.assertEqual(r.status_code,201,r.text)
            body=r.json();self.assertEqual(body['config']['request_model'],'cpu_io')
            self.assertEqual(body['totals']['outstanding'],0)
            self.assertEqual(client.delete('/v1/sessions/'+body['session_id']).status_code,200)
            r=client.post('/v1/runs',json={'config':{**CONFIG,'outstanding_limit':100001}})
            self.assertEqual(r.status_code,422)
