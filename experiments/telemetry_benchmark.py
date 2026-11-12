"""A-11: isolated engine/API scale measurements; browser phase is separate.

Start an isolated API on 8001 and production Next.js on 3001 pointing to it.
Run with PYTHONPATH=src uv run python experiments/telemetry_benchmark.py --api-pid PID.
No commands are sent to the interactive demo on ports 8000/3000.
"""
import argparse
import hashlib
from collections import defaultdict
from datetime import datetime, timezone
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import resource
import statistics
import subprocess
import sys
from time import monotonic, perf_counter, process_time, sleep

import httpx
from lbsim.continuous import ContinuousSimulation
from lbsim.regional import RegionalSimulation, run_regional
from lbsim.regions import PRESETS
from lbsim.simulation import run_simulation
from dataclasses import asdict

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'experiments/results/a-11'


def configuration(topology, rate, *, seed=42, duration=None):
    common=dict(arrival_rate=rate,service_min=.1,service_max=1.,seed=seed,policy='round_robin')
    if topology=='single_pool':
        common.update(server_count=100,concurrency=4,queue_limit=10)
    else:
        regions,matrix=PRESETS['Scale · 100 servers']
        common.update(topology='regions',regions=[asdict(r) for r in regions],latency_ms=matrix,client_latency_ms=matrix[0],source=0)
    if duration is not None:common['duration']=duration
    return common


def distribution(values):
    if not values:return None
    s=sorted(values)
    return dict(count=len(s),min=min(s),median=statistics.median(s),p95=s[max(0,__import__('math').ceil(.95*len(s))-1)],max=max(s))


def conserve(s):
    t=s['totals']
    assert t['offered']==sum(t[k] for k in ('completed','rejected','running','waiting'))+t.get('in_transit',0),t
    assert len(s['history'])<=240 and len(s['histogram']['bins'])<=20
    assert sum(b['count'] for b in s['histogram']['bins'])==s['metrics']['response_window_count']<=2000
    if s.get('topology')=='regions':
        for r in s['regions']:
            assert 0<=r['running']<=r['slots'] and 0<=r['waiting']<=r['queue_limit']
    else:
        assert len(s['servers']['items'])<=64
        for r in s['servers']['items']:
            assert 0<=r['running']<=r['slots'] and 0<=r['waiting']<=r['queue_limit']


def engine_worker(topology,rate,seed,mode):
    config=configuration(topology,rate,seed=seed,duration=100000/rate if mode=='one_shot' else None)
    start,cpu=perf_counter(),process_time()
    if mode=='one_shot':
        s=run_simulation(config) if topology=='single_pool' else run_regional(config)
        if topology=='single_pool':
            counts=dict(completed=s['completed_count'],rejected=s['rejected_count'])
            assert sum(counts.values())==100000
            assert all(s['events'][i][0]<=s['events'][i+1][0] for i in range(len(s['events'])-1))
            retention=dict(events=len(s['events']),response_values=len(s['response_times']))
        else:
            conserve(s);counts=s['totals'];assert counts['offered']==100000;assert counts['running']+counts['waiting']+counts['in_transit']==0
            retention=s['retention']
    else:
        e=(ContinuousSimulation if topology=='single_pool' else RegionalSimulation)(config)
        # Fixed simulated work, independent of the service wall clock. Use an
        # exclusive 100-second cutoff for both engines; stop traffic and drain.
        target=__import__('math').nextafter(100.,0.)
        ticks=0
        while not e.advance(target,max_events=2000):ticks+=1
        e.sample();conserve(e.snapshot())
        e.set_rate(0)
        while True:
            target=e.now+.5
            while not e.advance(target,max_events=2000):ticks+=1
            e.sample();s=e.snapshot();conserve(s)
            if s['totals']['offered']==s['totals']['completed']+s['totals']['rejected']:break
        counts=s['totals'];retention=s['retention']
        retention['response_values']=s['metrics']['response_window_count']
    elapsed=perf_counter()-start;cpu_seconds=process_time()-cpu
    peak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024)
    return dict(topology=topology,mode=mode,rate=rate,seed=seed,config=config,wall_seconds=elapsed,cpu_seconds=cpu_seconds,peak_process_bytes=peak,counts=counts,retention=retention)


def worker_stats(parent_pid):
    output=subprocess.check_output(['ps','-axo','pid=,ppid=,rss=,time=,command='],text=True)
    workers=[]
    for line in output.splitlines():
        pieces=line.strip().split(None,4)
        if len(pieces)!=5:continue
        pid,ppid,rss,cpu,command=pieces
        if int(ppid)!=parent_pid or 'spawn_main' not in command:continue
        parts=cpu.split(':');seconds=sum(float(v)*60**i for i,v in enumerate(reversed(parts)))
        workers.append(dict(pid=int(pid),rss_bytes=int(rss)*1024,cpu_seconds=seconds))
    assert len(workers)==1,workers
    return workers[0]


def request_sample(client,url,method='GET',body=None):
    start=perf_counter();r=client.request(method,url,json=body) if body is not None else client.request(method,url)
    elapsed=perf_counter()-start;r.raise_for_status();data=r.json()
    return data,dict(latency_ms=elapsed*1000,decoded_bytes=len(r.content),wire_bytes=r.num_bytes_downloaded,content_encoding=r.headers.get('content-encoding','identity'))


def main(args):
    OUT.mkdir(parents=True,exist_ok=True)
    report=dict(recorded_at_utc=datetime.now(timezone.utc).isoformat(),git_head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),python=sys.version,platform=platform.platform(),cpu=platform.processor(),versions={p:importlib.metadata.version(p) for p in ('fastapi','uvicorn','httpx')},methodology=dict(servers=100,slots_per_server=4,queue_per_server=10,policy='round_robin',service_seconds=[.1,1.],one_shot_requests=100000,engine_continuous_cutoff_seconds=100,api_poll_delay_after_completion=.5,live_wall_seconds=args.seconds,regional_high_rate_soak_seconds=args.soak,isolated_backend=args.backend,isolated_proxy=args.frontend,api_pid=args.api_pid),engine=[],one_shot_api=[],live_api=[])
    report['source_hashes']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'src/lbsim/regional_engine.py',ROOT/'src/lbsim/continuous.py',ROOT/'src/lbsim/sessions.py',ROOT/'src/lbsim/api.py',Path(__file__)]}
    report['git_dirty']=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT))
    def save(): (OUT/'api-engine.json').write_text(json.dumps(report,indent=2)+'\n')
    if not args.skip_engine:
        for topology in ('single_pool','regions'):
            for rate in (1000,10000):
                for mode in ('one_shot','continuous'):
                    for seed in (42,43,44):
                        output=subprocess.check_output([sys.executable,__file__,'--worker',topology,str(rate),str(seed),mode],env=os.environ,text=True)
                        r=json.loads(output);report['engine'].append(r);save()
                        print(f'engine {topology} {mode} {rate}/s seed {seed}: {r["wall_seconds"]:.3f}s',flush=True)
    with httpx.Client(timeout=30) as client:
        report['health']=client.get(args.backend+'/health').json()
        for topology in ('single_pool','regions'):
            path='/v1/run' if topology=='single_pool' else '/v1/regions/run'
            proxy='/api/engine/run' if topology=='single_pool' else '/api/regions/run'
            for rate in (1000,10000):
                for seed in (42,43,44):
                    config=configuration(topology,rate,seed=seed,duration=100000/rate)
                    data,sample=request_sample(client,args.backend+path,'POST',dict(config=config))
                    s=data['summary']
                    if topology=='single_pool':
                        assert s['completed_count']+s['rejected_count']==100000
                        counts=dict(completed=s['completed_count'],rejected=s['rejected_count'])
                        trace_events=len(s['events'])
                    else:conserve(s);counts=s['totals'];assert counts['offered']==100000;trace_events=0
                    record=dict(topology=topology,rate=rate,seed=seed,transport='direct',sample=sample,counts=counts,trace_events=trace_events)
                    report['one_shot_api'].append(record);save()
                    if seed==42:
                        proxied,measure=request_sample(client,args.frontend+proxy,'POST',dict(config=config))
                        if proxied.get('run_id'):
                            for key in ('completed_count','rejected_count','mean_response_time','p95_response_time','per_server_utilization'):
                                assert proxied['summary'][key]==data['summary'][key]
                            client.delete(args.frontend+'/api/runs/'+proxied['run_id']).raise_for_status()
                        else:assert proxied==data
                        report['one_shot_api'].append({**record,'transport':'next_proxy','sample':measure,'trace_events':len(proxied['summary'].get('events',[])),'response_format':'recorded_summary' if proxied.get('run_id') else 'full_trace'});save()
                    print(f'one-shot API {topology} {rate}/s seed {seed}: {sample["latency_ms"]:.0f}ms, {sample["decoded_bytes"]:,} decoded bytes',flush=True)
        for topology in ('single_pool','regions'):
            for rate in (1000,10000):
                sid=None
                try:
                    data,create=request_sample(client,args.frontend+'/api/sessions','POST',dict(config=configuration(topology,rate),paused=True))
                    sid=data['session_id'];conserve(data)
                    url=args.frontend+f'/api/sessions/{sid}'
                    initial=worker_stats(args.api_pid)
                    request_sample(client,url+'/commands','POST',dict(action='resume'))
                    duration=args.soak if topology=='regions' and rate==10000 else args.seconds
                    start=monotonic();samples=[]
                    while monotonic()-start<duration:
                        s,measure=request_sample(client,url+'/snapshot?server_limit=32&history_limit=240')
                        conserve(s);worker=worker_stats(args.api_pid)
                        samples.append(dict(wall_seconds=monotonic()-start,simulation_time=s['simulation_time'],lag_seconds=s['lag_simulation_seconds'],revision=s['revision'],totals=s['totals'],retention=s['retention'],history_points=len(s['history']),response_window_count=s['metrics']['response_window_count'],worker=worker,**measure))
                        if len(samples)%20==0:print(f'live {topology} {rate}/s: {samples[-1]["wall_seconds"]:.0f}/{duration}s; lag {s["lag_simulation_seconds"]:.3f}s',flush=True)
                        sleep(.5)
                    _,pause=request_sample(client,url+'/commands','POST',dict(action='pause'))
                    frozen=client.get(url+'/snapshot').json();sleep(.15)
                    assert client.get(url+'/snapshot').json()['simulation_time']==frozen['simulation_time']
                    client.post(url+'/commands',json=dict(action='set_rate',value=0)).raise_for_status()
                    client.post(url+'/commands',json=dict(action='set_speed',value=10)).raise_for_status()
                    client.post(url+'/commands',json=dict(action='resume')).raise_for_status()
                    deadline=monotonic()+15
                    while True:
                        drained=client.get(url+'/snapshot').json();conserve(drained)
                        if drained['totals']['offered']==drained['totals']['completed']+drained['totals']['rejected']:break
                        assert monotonic()<deadline,'Drain deadline exceeded'
                        sleep(.1)
                    client.post(url+'/commands',json=dict(action='pause')).raise_for_status()
                    if topology=='single_pool':
                        ids=[]
                        for offset in (0,32,64,96):
                            page=client.get(url+f'/snapshot?server_offset={offset}&server_limit=32').json();conserve(page);ids.extend(r['id'] for r in page['servers']['items'])
                        assert ids==list(range(100))
                    final_worker=worker_stats(args.api_pid)
                    result=dict(topology=topology,rate=rate,create=create,pause=pause,initial_worker=initial,final_worker=final_worker,samples=samples,drained_totals=drained['totals'],median_poll_ms=statistics.median(s['latency_ms'] for s in samples),poll_ms=distribution([s['latency_ms'] for s in samples]),lag_seconds=distribution([s['lag_seconds'] for s in samples]),decoded_bytes=distribution([s['decoded_bytes'] for s in samples]),wire_bytes=distribution([s['wire_bytes'] for s in samples]),sampled_worker_cpu_seconds=final_worker['cpu_seconds']-initial['cpu_seconds'])
                    report['live_api'].append(result);save()
                    print(f'live complete {topology} {rate}/s: {result["poll_ms"]}',flush=True)
                finally:
                    if sid:client.delete(args.frontend+f'/api/sessions/{sid}').raise_for_status()
    save()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker',nargs=4,metavar=('TOPOLOGY','RATE','SEED','MODE'))
    parser.add_argument('--api-pid',type=int)
    parser.add_argument('--backend',default='http://127.0.0.1:8001')
    parser.add_argument('--frontend',default='http://127.0.0.1:3001')
    parser.add_argument('--seconds',type=float,default=20)
    parser.add_argument('--soak',type=float,default=130)
    parser.add_argument('--skip-engine',action='store_true')
    args=parser.parse_args()
    if args.worker:print(json.dumps(engine_worker(args.worker[0],int(args.worker[1]),int(args.worker[2]),args.worker[3])))
    else:
        parser.error('--api-pid is required') if args.api_pid is None else main(args)
