import unittest
from lbsim.settings import validate_config
from lbsim.simulation import run_simulation
from lbsim.staged import StagedSimulation
from lbsim.runs import RunStore
from test_staged import CONFIG


class SharedIOTests(unittest.TestCase):
    def test_one_dependency_slot_queues_a_second_call(self):
        config={**CONFIG,'io_capacity':1}
        result=run_simulation(config)
        self.assertEqual(result['response_times'],[4.,5.9])
        self.assertAlmostEqual(result['mean_io_queue_wait'],.5)
        self.assertAlmostEqual(sum(result[k] for k in ('mean_cpu_service_time','mean_io_service_time','mean_cpu_queue_wait','mean_io_queue_wait')),result['mean_response_time'])
        sim=StagedSimulation(config);sim.arrival_limit=2
        while not sim.advance(2,max_events=1):pass
        snap=sim.snapshot()
        self.assertEqual((snap['io_resource']['active'],snap['io_resource']['queued']),(1,1))
        self.assertEqual(snap['totals']['io_waiting'],2)
        self.assertEqual(snap['totals']['running'],0)
        store=RunStore()
        try:
            saved=store.add(config,result)
            state=store.snapshot(saved['run_id'],2,0,32)
            self.assertEqual(state['io_resource'],dict(capacity=1,active=1,queued=1))
            self.assertEqual(state['servers']['items'][0]['io_queued'],1)
            events=store.events(saved['run_id'],0,100)['items']
            self.assertEqual([tuple(e['event']) for e in events],result['events'])
        finally:store.close()

    def test_shared_fifo_across_servers_and_capacity_at_every_recorded_event(self):
        config={**CONFIG,'server_count':3,'io_capacity':1,'arrival_rate':10.,'duration':1.,'outstanding_limit':5}
        result=run_simulation(config)
        entered=[e[5] for e in result['events'] if e[4]=='cpu_to_io']
        started=[e[5] for e in result['events'] if e[4]=='io_started']
        self.assertEqual(entered,started)
        active=[0]*3;queued=[0]*3
        for e in result['events']:
            active[e[1]]=e[8];queued[e[1]]=e[9]
            self.assertLessEqual(sum(active),1)
            self.assertEqual(e[6],e[8]+e[9])
            self.assertGreaterEqual(sum(queued),0)
        self.assertEqual(sum(active)+sum(queued),0)

    def test_more_io_capacity_reduces_queue_delay_without_changing_work(self):
        slow=run_simulation({**CONFIG,'io_capacity':1})
        fast=run_simulation({**CONFIG,'io_capacity':2})
        self.assertEqual(slow['workload_sha256'],fast['workload_sha256'])
        self.assertGreater(slow['mean_io_queue_wait'],fast['mean_io_queue_wait'])
        self.assertGreater(slow['p95_response_time'],fast['p95_response_time'])
        self.assertEqual(fast['response_times'],[4.,4.9])

    def test_seeded_mixed_requests_are_shared_across_all_four_policies(self):
        c={**CONFIG,'server_count':4,'io_capacity':2,'arrival_rate':80.,'duration':2.,'service_min':.08,'service_max':.12,'io_heavy_probability':.3,'outstanding_limit':4}
        outputs=[run_simulation({**c,'policy':p}) for p in ('round_robin','least_active_requests','least_outstanding','power_of_two')]
        self.assertEqual(len({r['workload_sha256'] for r in outputs}),1)
        self.assertEqual(outputs[0],run_simulation(c))
        self.assertTrue(all(r['completed_count']+r['rejected_count']==160 for r in outputs))
        sim=StagedSimulation(c,response_window=20,history_points=5)
        for t in range(1,11):
            while not sim.advance(t,max_events=13):pass
            sim.sample();s=sim.snapshot()
            self.assertLessEqual(s['io_resource']['active'],2)
            self.assertEqual(s['totals']['io_waiting'],s['totals']['io_active']+s['totals']['io_queued'])
            self.assertLessEqual(len(sim.io_ready)+len(sim.pending),c['server_count']*c['outstanding_limit'])
            self.assertLessEqual(len(s['history']),5)
            self.assertLessEqual(len(sim.responses),20)
        sim.set_rate(0)
        while not sim.advance(20,max_events=13):pass
        self.assertEqual(sim.snapshot()['totals']['outstanding'],0)

    def test_validation_rejects_unbounded_or_invalid_resources(self):
        for override in ({'io_capacity':0},{'io_capacity':4097},{'io_capacity':True},{'io_heavy_probability':-1},{'io_heavy_probability':float('nan')},{'request_model':'simple'}):
            with self.assertRaises(ValueError):validate_config({**CONFIG,**override})
        self.assertEqual(validate_config(CONFIG)['io_capacity'],64)
