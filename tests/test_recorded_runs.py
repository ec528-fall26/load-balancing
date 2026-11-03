"""Immutable event pagination, server snapshots and bounded recording retention."""
import json
from pathlib import Path
import unittest
from fastapi.testclient import TestClient
from lbsim.api import create_app
from lbsim.runs import RunStore,RunLimits
from lbsim.simulation import run_simulation
from lbsim.sessions import SessionError

CONFIG=dict(server_count=3,concurrency=2,queue_limit=2,policy='round_robin',arrival_rate=20,duration=2,service_min=.2,service_max=.5,seed=42)

class RecordedTests(unittest.TestCase):
    def test_paged_events_exactly_reassemble_legacy_trace_and_summary_matches(self):
        expected=run_simulation(CONFIG)
        with TestClient(create_app()) as c:
            r=c.post('/v1/runs',json={'config':CONFIG});self.assertEqual(r.status_code,201,r.text)
            data=r.json();sid=data['run_id'];s=data['summary']
            self.assertEqual(s['events'],[]);self.assertEqual(s['response_times'],[])
            for key in ('completed_count','rejected_count','mean_response_time','p95_response_time'):
                self.assertEqual(s[key],expected[key])
            self.assertEqual(sum(b['count'] for b in s['histogram']['bins']),expected['completed_count'])
            events=[];seq=[];offset=0
            while True:
                page=c.get(f'/v1/runs/{sid}/events?offset={offset}&limit=7').json()
                self.assertEqual(page,c.get(f'/v1/runs/{sid}/events?offset={offset}&limit=7').json())
                self.assertLessEqual(len(page['items']),7)
                events.extend(e['event'] for e in page['items']);seq.extend(e['sequence'] for e in page['items'])
                if page['next_offset'] is None:break
                offset=page['next_offset']
            self.assertEqual(events,[list(e) for e in expected['events']])
            self.assertEqual(seq,list(range(len(events))))
            self.assertEqual(c.get(f'/v1/runs/{sid}').json(),data)
            self.assertEqual(c.get(f'/v1/runs/{sid}/events?offset=200000').json()['items'],[])
            self.assertEqual(c.delete(f'/v1/runs/{sid}').status_code,200)
            self.assertEqual(c.get(f'/v1/runs/{sid}').status_code,404)

    def test_seek_states_match_inclusive_event_order_at_ties_and_last_page(self):
        expected=run_simulation(CONFIG)
        with TestClient(create_app()) as c:
            run=c.post('/v1/runs',json={'config':CONFIG}).json();sid=run['run_id']
            for time in (0,.15,.5,1,2,run['summary']['end_time']):
                states=[[0,0] for _ in range(3)];completed=rejected=offered=0
                for e in expected['events']:
                    if e[0]>time:break
                    states[e[1]]=[e[2],e[3]];completed+=e[4]=='completed';rejected+=e[4]=='rejected';offered+=e[4]!='completed'
                r=c.get(f'/v1/runs/{sid}/snapshot?time={time}&server_offset=2&server_limit=1').json()
                t=r['totals'];self.assertEqual(t,dict(offered=offered,completed=completed,rejected=rejected,running=sum(x[0] for x in states),waiting=sum(x[1] for x in states)))
                self.assertEqual(t['offered'],sum(t[k] for k in ('completed','rejected','running','waiting')))
                self.assertEqual([r['servers']['items'][0][k] for k in ('running','waiting')],states[2])
                self.assertEqual(r['idle_servers'],sum(x==[0,0] for x in states))
            for query in ('time=nan','time=inf','time=-1','server_limit=65','server_offset=-1'):
                self.assertEqual(c.get(f'/v1/runs/{sid}/snapshot?{query}').status_code,422)
            for query in ('limit=1001','limit=0','offset=-1','offset=1000000000000000000000000'):
                self.assertEqual(c.get(f'/v1/runs/{sid}/events?{query}').status_code,422)

    def test_expiration_eviction_storage_limits_and_shutdown_cleanup(self):
        clock=[0.];store=RunStore(RunLimits(max_runs=1,ttl_seconds=10),clock=lambda:clock[0])
        try:
            a=store.add(CONFIG,run_simulation(CONFIG))['run_id'];first=next(iter(store.records.values()))['path']
            b=store.add(CONFIG,run_simulation(CONFIG))['run_id'];self.assertFalse(first.exists())
            with self.assertRaises(SessionError) as ctx:store.get(a)
            self.assertEqual((ctx.exception.status,ctx.exception.code),(410,'RUN_EXPIRED'))
            clock[0]=11
            with self.assertRaises(SessionError) as ctx:store.get(b)
            self.assertEqual(ctx.exception.status,410);self.assertEqual(store.records,{})
            tiny=RunStore(RunLimits(max_bytes=1))
            try:
                with self.assertRaises(SessionError):tiny.add(CONFIG,run_simulation(CONFIG))
                self.assertFalse(list(Path(tiny.directory.name).iterdir()))
            finally:tiny.close()
        finally:store.close()
        self.assertFalse(Path(store.directory.name).exists())

    def test_100k_response_is_bounded_and_playback_is_drained(self):
        config={**CONFIG,'server_count':100,'concurrency':4,'arrival_rate':1000,'duration':100}
        with TestClient(create_app()) as c:
            r=c.post('/v1/runs',json={'config':config});self.assertEqual(r.status_code,201,r.text)
            self.assertLess(len(r.content),25000)
            data=r.json();self.assertGreater(data['summary']['event_count'],100000)
            self.assertEqual(sum(b['count'] for b in data['summary']['histogram']['bins']),data['summary']['completed_count'])
            final=c.get(f'/v1/runs/{data["run_id"]}/snapshot?time={data["summary"]["end_time"]}').json()
            self.assertEqual(final['totals']['offered'],100000)
            self.assertEqual(final['totals']['running']+final['totals']['waiting'],0)

if __name__=='__main__':unittest.main()
