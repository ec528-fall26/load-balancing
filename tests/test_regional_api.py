"""Regional API parity, validation and service-owned lifecycle checks."""
from copy import deepcopy
from time import sleep
import unittest
from fastapi.testclient import TestClient
from lbsim.api import create_app, checked_regional_config, Limits
from lbsim.sessions import SessionLimits
from lbsim.regional import RegionalSimulation

CONFIG = dict(topology='regions',regions=[dict(name='east',servers=1,slots_per_server=1,compute=2,queue_per_server=4),dict(name='west',servers=1,slots_per_server=1,compute=1,queue_per_server=4)],latency_ms=[[2,80],[80,2]],client_latency_ms=[200,80],source=0,policy='round_robin',arrival_rate=4,service_min=.2,service_max=.2,seed=42)

class RegionalAPITests(unittest.TestCase):
    def conserve(self,s):
        t=s['totals']
        self.assertEqual(t['offered'],sum(t[k] for k in ['completed','rejected','running','waiting','in_transit']))
        self.assertEqual(sum(b['count'] for b in s['histogram']['bins']),s['metrics']['response_window_count'])
        self.assertEqual(t['running'],sum(r['running'] for r in s['regions']))
        self.assertEqual(t['waiting'],sum(r['waiting'] for r in s['regions']))

    def test_presets_roundtrip_and_one_shot_matches_local_engine(self):
        with TestClient(create_app()) as c:
            response=c.get('/v1/regions/presets')
            self.assertEqual(response.status_code,200)
            for p in response.json()['presets']:
                checked_regional_config({**CONFIG,**{k:v for k,v in p.items() if k!='id'}},Limits(),SessionLimits(),continuous=True)
            for policy in ('round_robin','least_loaded','nearest'):
                config={**CONFIG,'policy':policy,'duration':1}
                r=c.post('/v1/regions/run',json={'config':config})
                self.assertEqual(r.status_code,200,r.text)
                s=r.json()['summary']; self.conserve(s)
                normalized=checked_regional_config(config,Limits(),SessionLimits())
                local=RegionalSimulation(normalized).run_once(1).snapshot(history_limit=240)
                self.assertEqual(s,local)
                self.assertEqual(s['totals']['offered'],4)
                self.assertEqual(s['totals']['in_transit']+s['totals']['running']+s['totals']['waiting'],0)
                self.assertNotIn('events',s)

    def test_service_owned_progress_pause_commands_drain_and_shared_capacity(self):
        with TestClient(create_app(session_limits=SessionLimits(max_sessions=1,tick_seconds=.01))) as c:
            r=c.post('/v1/sessions',json={'config':CONFIG,'speed':10,'paused':True})
            self.assertEqual(r.status_code,201,r.text)
            sid=r.json()['session_id'];self.conserve(r.json())
            self.assertEqual(c.post('/v1/sessions',json={'config':CONFIG}).status_code,429)
            url=f'/v1/sessions/{sid}'
            c.post(url+'/commands',json={'action':'resume'})
            sleep(.12) # No browser polling: the service alone advances.
            s=c.post(url+'/commands',json={'action':'pause'}).json()
            self.conserve(s);self.assertGreater(s['simulation_time'],.1)
            sleep(.08)
            self.assertEqual(c.get(url+'/snapshot').json()['simulation_time'],s['simulation_time'])
            c.post(url+'/commands',json={'action':'set_rate','value':0})
            c.post(url+'/commands',json={'action':'resume'})
            sleep(.25)
            s=c.post(url+'/commands',json={'action':'pause'}).json();self.conserve(s)
            self.assertEqual(s['totals']['offered'],s['totals']['completed']+s['totals']['rejected'])
            self.assertEqual(s['arrival_rate'],0)
            self.assertEqual(c.delete(url).status_code,200)
            self.assertEqual(c.get(url+'/snapshot').status_code,404)

    def test_invalid_regional_contracts_fail_before_workers_start(self):
        bad=[{'source':True},{'source':2},{'policy':'least_active'},{'seed':True},{'service_min':0},{'service_min':2},
             {'latency_ms':[[0]]},{'latency_ms':[[0,-1],[1,0]]},{'latency_ms':[[0,True],[1,0]]},
             {'client_latency_ms':[1]},{'client_latency_ms':[True,0]}, {'client_latency_ms':[1001,0]},
             {'arrival_rate':True},{'duration':1},{'extra':1}, {'regions':[{'name':'east'},{'name':'east'}]},
             {'regions':[{'name':'a','servers':1001}]},{'regions':[{'name':' a '}]}, {'regions':[{'name':'a','compute':1e-300}]}]
        app=create_app()
        with TestClient(app) as c:
            for change in bad:
                r=c.post('/v1/sessions',json={'config':{**deepcopy(CONFIG),**change}})
                self.assertEqual(r.status_code,422,(change,r.text))
                self.assertEqual(app.state.sessions.sessions,{})
            r=c.post('/v1/regions/run',json={'config':{**CONFIG,'duration':1000000}})
            self.assertEqual(r.status_code,422)

    def test_bounds_and_latency_math_are_explicit(self):
        cfg=checked_regional_config({**CONFIG,'regions':[dict(name='east',servers=1,slots_per_server=1,compute=2,queue_per_server=1)],'source':0,'policy':'nearest','latency_ms':[[2]],'client_latency_ms':[200],'arrival_rate':1},Limits(),SessionLimits(),continuous=True)
        e=RegionalSimulation(cfg,response_window=4,history_points=3)
        e.advance(0);e.set_rate(0);e.advance(.1)
        self.assertEqual(e.pools[0].running,1)
        e.advance(.21);self.assertEqual(e.returning,1)
        e.advance(.31);self.assertAlmostEqual(e.responses[0],.3)
        for i in range(5):e.advance(.4+i);e.sample()
        s=e.snapshot(history_limit=2);self.conserve(s)
        self.assertEqual(len(s['history']),2)
        self.assertEqual(s['regions'][0]['client_rtt_ms'],200)
        self.assertEqual(s['config']['latency_ms'],[[2]])
        self.assertEqual(s['telemetry'],'immediate')

if __name__=='__main__': unittest.main()
