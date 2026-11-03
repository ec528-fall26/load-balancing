"""A-11 pagination and maximum supported topology checks on an isolated API."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
from time import perf_counter,sleep,monotonic

import httpx

OUT=Path(__file__).resolve().parent/'results/a-11'
ROOT=OUT.parents[2]


def measure(client,path,body=None):
    t=perf_counter();r=client.post(path,json=body) if body is not None else client.get(path)
    elapsed=perf_counter()-t;r.raise_for_status()
    return r.json(),dict(ms=elapsed*1000,decoded_bytes=len(r.content),wire_bytes=r.num_bytes_downloaded)


def pool(servers,rate):
    return dict(server_count=servers,concurrency=4,queue_limit=10,arrival_rate=rate,duration=100000/rate,service_min=.1,service_max=1.,seed=42,policy='round_robin')


def regions(rate):
    matrix=[[2 if i==j else 10+abs(i-j)*40 for j in range(12)] for i in range(12)]
    return dict(topology='regions',regions=[dict(name=f'dc-{i+1:02}',servers=84 if i<4 else 83,slots_per_server=4,queue_per_server=10,compute=[1,.75,2][i%3]) for i in range(12)],latency_ms=matrix,client_latency_ms=matrix[0],source=0,arrival_rate=rate,duration=100000/rate,service_min=.1,service_max=1.,seed=42,policy='round_robin')


def conserved(s):
    t=s['totals'];assert t['offered']==t['completed']+t['rejected']+t['running']+t['waiting']+t.get('in_transit',0)


def main(args):
    out=OUT/args.output
    result=dict(recorded_at_utc=datetime.now(timezone.utc).isoformat(),git_head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),source_hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'src/lbsim/runs.py',ROOT/'src/lbsim/sessions.py',ROOT/'src/lbsim/regional_engine.py',Path(__file__)]},one_shot=[],regional=[],live=[])
    def save():out.write_text(json.dumps(result,indent=2)+'\n')
    with httpx.Client(base_url=args.backend,timeout=35) as c:
        result['health']=c.get('/health').json()
        if not args.live_only:
            for servers,rate in [(100,1000),(1000,10000),(1000,100000)]:
                config=pool(servers,rate);sid=None
                try:
                    legacy,lm=measure(c,'/v1/run',dict(config=config))
                    data,bm=measure(c,'/v1/runs',dict(config=config));sid=data['run_id']
                    for key in ('completed_count','rejected_count','mean_response_time','p95_response_time','per_server_utilization'):assert data['summary'][key]==legacy['summary'][key]
                    assert data['summary']['events']==[] and data['summary']['response_times']==[]
                    assert sum(b['count'] for b in data['summary']['histogram']['bins'])==legacy['summary']['completed_count']
                    digest=hashlib.sha256();pages=0;offset=0;largest=0;page_ms=[];start=perf_counter()
                    while True:
                        page,m=measure(c,f'/v1/runs/{sid}/events?offset={offset}&limit=1000')
                        largest=max(largest,m['decoded_bytes']);page_ms.append(m['ms']);pages+=1
                        for i,e in enumerate(page['items']):
                            assert e['sequence']==offset+i
                            assert e['event']==legacy['summary']['events'][offset+i]
                            digest.update(json.dumps(e['event'],separators=(',',':')).encode())
                        if page['next_offset'] is None:break
                        offset=page['next_offset']
                    assert offset+len(page['items'])==len(legacy['summary']['events'])
                    all_pages_ms=(perf_counter()-start)*1000
                    snapshots=[]
                    for time in (0,config['duration']/2,data['summary']['end_time']):
                        snapshot,m=measure(c,f'/v1/runs/{sid}/snapshot?time={time}&server_offset={max(0,servers-32)}&server_limit=32');conserved(snapshot)
                        snapshots.append(dict(time=time,totals=snapshot['totals'],measure=m,visible=len(snapshot['servers']['items'])))
                    assert snapshots[-1]['totals']['offered']==100000 and snapshots[-1]['totals']['running']+snapshots[-1]['totals']['waiting']==0
                    record=dict(config=config,legacy=lm,bounded=bm,event_count=len(legacy['summary']['events']),pages=pages,largest_page_bytes=largest,page_ms=dict(median=statistics.median(page_ms),max=max(page_ms)),all_pages_ms=all_pages_ms,event_digest_sha256=digest.hexdigest(),snapshots=snapshots)
                    result['one_shot'].append(record);save();print(f'{servers} servers {rate}/s: legacy {lm["decoded_bytes"]:,}B -> bounded {bm["decoded_bytes"]:,}B; {pages} stable pages',flush=True)
                finally:
                    if sid:c.delete('/v1/runs/'+sid).raise_for_status()
            for rate in (10000,100000):
                config=regions(rate);data,m=measure(c,'/v1/regions/run',dict(config=config));s=data['summary'];conserved(s)
                assert s['totals']['offered']==100000 and s['totals']['running']+s['totals']['waiting']+s['totals']['in_transit']==0
                result['regional'].append(dict(config=config,measure=m,totals=s['totals'],regions=len(s['regions']),response_window_count=s['metrics']['response_window_count']));save()
                print(f'12 regions / 1000 servers {rate}/s: {m["decoded_bytes"]:,}B, {m["ms"]:.0f}ms',flush=True)
            for invalid in ({**pool(1000,10000),'server_count':1001},{**regions(10000),'regions':regions(10000)['regions']+[regions(10000)['regions'][0]]}):
                endpoint='/v1/regions/run' if invalid.get('topology') else '/v1/runs'
                assert c.post(endpoint,json={'config':invalid}).status_code==422
        for topology in ('single_pool','regions'):
            for rate in (10000,100000):
                config=pool(1000,rate) if topology=='single_pool' else regions(rate);config.pop('duration');sid=None
                try:
                    data,_=measure(c,'/v1/sessions',dict(config=config));sid=data['session_id'];samples=[];start=monotonic()
                    while monotonic()-start<args.seconds:
                        s,m=measure(c,f'/v1/sessions/{sid}/snapshot?server_offset=968&server_limit=32&history_limit=120');conserved(s)
                        samples.append(dict(wall_seconds=monotonic()-start,simulation_time=s['simulation_time'],target=s['target_simulation_time'],lag=s['lag_simulation_seconds'],totals=s['totals'],retention=s['retention'],measure=m));sleep(.5)
                    t=perf_counter();paused=c.post(f'/v1/sessions/{sid}/commands',json={'action':'pause'});paused.raise_for_status();pause_ms=(perf_counter()-t)*1000
                    frozen=paused.json()['simulation_time'];sleep(.05);assert c.get(f'/v1/sessions/{sid}/snapshot').json()['simulation_time']==frozen
                    c.post(f'/v1/sessions/{sid}/commands',json={'action':'set_rate','value':0}).raise_for_status()
                    c.post(f'/v1/sessions/{sid}/commands',json={'action':'set_speed','value':10}).raise_for_status()
                    c.post(f'/v1/sessions/{sid}/commands',json={'action':'resume'}).raise_for_status()
                    deadline=monotonic()+15
                    while True:
                        s=c.get(f'/v1/sessions/{sid}/snapshot').json();conserved(s)
                        if s['totals']['offered']==s['totals']['completed']+s['totals']['rejected']:break
                        assert monotonic()<deadline;sleep(.1)
                    result['live'].append(dict(topology=topology,rate=rate,config=config,pause_ms=pause_ms,samples=samples,drained=s['totals']));save()
                    print(f'live {topology} {rate}/s: max lag {max(s["lag"] for s in samples):.3f}s; pause {pause_ms:.1f}ms',flush=True)
                finally:
                    if sid:c.delete('/v1/sessions/'+sid).raise_for_status()
    save()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--backend',default='http://127.0.0.1:8001');p.add_argument('--seconds',type=float,default=8);p.add_argument('--live-only',action='store_true');p.add_argument('--output',default='pagination-scale.json');main(p.parse_args())
