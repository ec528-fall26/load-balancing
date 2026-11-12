import json,sys
from lbsim.simulation import run_simulation
from lbsim.continuous import ContinuousSimulation
from lbsim.regional_engine import LiveSimulation
from lbsim.regions import Region

def capture():
    out=[]
    for policy in ('round_robin','least_active_requests'):
     for seed in (42,43,44):
      for slots,queue,rate in ((1,0,25),(1,4,15),(4,2,40)):
       c=dict(server_count=5,concurrency=slots,queue_limit=queue,arrival_rate=rate,duration=3,service_min=.1,service_max=1.,seed=seed,policy=policy,processing_rates=[1,.5,2,1,1])
       out.append(run_simulation(c))
       s=ContinuousSimulation(c)
       for t in (0,.5,1,2,3):
        while not s.advance(t,max_events=7): pass
        s.sample(); out.append(s.snapshot())
       s.set_rate(4)
       while not s.advance(4,max_events=7): pass
       s.set_rate(0)
       while not s.advance(15,max_events=7): pass
       s.sample();out.append(s.snapshot())
    for policy in ('round_robin','nearest','least_loaded'):
     for seed in (42,43,44):
      rs=[Region('a',2,1,1,2),Region('b',1,2,.5,3),Region('c',1,1,2,0)]
      s=LiveSimulation(rs,[[2,12,75],[12,2,60],[75,60,2]],arrival_rate=25,policy=policy,seed=seed)
      for t in (0,.5,1,2):
       while not s.advance(t,max_events=7): pass
       out.append([s.now,s.offered,s.completed,s.rejected,s.report(),list(s.responses),s.events])
      s.set_rate(4)
      while not s.advance(3,max_events=7): pass
      s.set_rate(0)
      while not s.advance(15,max_events=7): pass
      out.append([s.now,s.offered,s.completed,s.rejected,s.report(),list(s.responses),s.events])
    return out

import hashlib
from pathlib import Path
import unittest

class PolicyParityTests(unittest.TestCase):
    def test_exact_pre_refactor_outputs(self):
        expected = json.loads(Path(__file__).with_name('policy-parity-sha256.json').read_text())
        actual = capture()
        self.assertEqual(len(expected), len(actual))
        for index, (digest, snapshot) in enumerate(zip(expected, actual)):
            with self.subTest(snapshot=index):
                self.assertEqual(hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest(), digest)
