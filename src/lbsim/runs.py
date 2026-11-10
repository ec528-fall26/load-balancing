"""Bounded temporary one-shot results. Stable event order lives on disk, not in JSON replies."""
from contextlib import closing
from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from threading import Event, RLock, Thread
from time import monotonic
from uuid import uuid4

from lbsim.sessions import SessionError


@dataclass(frozen=True)
class RunLimits:
    max_runs: int = 4
    max_bytes: int = 64 * 1024 * 1024
    ttl_seconds: float = 600
    event_page: int = 1000
    server_page: int = 64


class RunStore:
    def __init__(self, limits=None, *, clock=monotonic):
        self.limits = limits or RunLimits()
        if not (1 <= self.limits.max_runs <= 8 and 1 <= self.limits.max_bytes <= 256*1024*1024
                and 0 < self.limits.ttl_seconds <= 3600 and 1 <= self.limits.event_page <= 1000
                and 1 <= self.limits.server_page <= 64):
            raise ValueError('Invalid run retention limits.')
        self.clock=clock
        self.directory=None
        self.records=OrderedDict()
        self.tombstones=OrderedDict()
        self.lock=RLock()
        self.stopping=Event()
        self.closed=False
        self.thread=None

    def start(self):
        self.thread=Thread(target=self._sweep_loop,daemon=True,name='lbsim-run-expiry')
        self.thread.start()

    def _sweep_loop(self):
        while not self.stopping.wait(min(5,self.limits.ttl_seconds)):
            with self.lock:self._sweep()

    def _remove(self, rid, reason):
        r=self.records.pop(rid)
        r['path'].unlink(missing_ok=True)
        self.tombstones[rid]=reason
        while len(self.tombstones)>64:self.tombstones.popitem(last=False)

    def _sweep(self):
        for rid,r in list(self.records.items()):
            if self.clock()-r['born']>=self.limits.ttl_seconds:self._remove(rid,'expired')

    def _get(self,rid):
        self._sweep()
        if rid not in self.records:
            reason=self.tombstones.get(rid)
            raise SessionError(410 if reason in ('expired','evicted') else 404,
                'RUN_EXPIRED' if reason in ('expired','evicted') else 'RUN_NOT_FOUND',
                'Recorded playback expired or was evicted. Run the configuration again.' if reason in ('expired','evicted') else 'Recorded run not found in this API process.')
        return self.records[rid]

    def add(self,config,summary):
        rid=uuid4().hex
        with self.lock:
            if self.closed:raise SessionError(503,'RUNS_CLOSED','Run store is shutting down.')
            if self.directory is None:self.directory=tempfile.TemporaryDirectory(prefix='lbsim-runs-')
            fd,name=tempfile.mkstemp(dir=self.directory.name,suffix='.sqlite')
        os.close(fd)
        path=Path(name)
        try:
            states=[[0,0,0,0,0,0] for _ in range(config['server_count'])]
            running=waiting=completed=rejected=offered=io_waiting=outstanding=io_active=io_queued=0
            idle=config['server_count']
            with closing(sqlite3.connect(path)) as db:
                db.execute('PRAGMA journal_mode=OFF')
                db.execute('CREATE TABLE events (seq INTEGER PRIMARY KEY, at REAL, sid INTEGER, running INTEGER, waiting INTEGER, action TEXT, request INTEGER, offered INTEGER, completed INTEGER, rejected INTEGER, total_running INTEGER, total_waiting INTEGER, idle INTEGER, io INTEGER, outstanding INTEGER, total_io INTEGER, total_outstanding INTEGER, io_active INTEGER, io_queued INTEGER, total_io_active INTEGER, total_io_queued INTEGER)')
                def rows():
                    nonlocal running,waiting,completed,rejected,offered,idle,io_waiting,outstanding,io_active,io_queued
                    for seq,e in enumerate(summary['events']):
                        at,sid,active,queued,action,request=e[:6]
                        io=e[6] if len(e)>6 else 0
                        unfinished=e[7] if len(e)>7 else active+queued
                        io_run=e[8] if len(e)>8 else io
                        io_queue=e[9] if len(e)>9 else 0
                        old=states[sid]
                        idle+=int(unfinished==0)-int(old[3]==0)
                        io_waiting+=io-old[2];outstanding+=unfinished-old[3]
                        io_active+=io_run-old[4];io_queued+=io_queue-old[5]
                        running+=active-old[0];waiting+=queued-old[1];states[sid]=[active,queued,io,unfinished,io_run,io_queue]
                        completed+=action=='completed';rejected+=action=='rejected';offered+=action in ('started','queued','rejected')
                        assert offered==completed+rejected+running+waiting+io_waiting
                        yield (seq,at,sid,active,queued,action,request,offered,completed,rejected,running,waiting,idle,io,unfinished,io_waiting,outstanding,io_run,io_queue,io_active,io_queued)
                db.executemany('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',rows())
                db.execute('CREATE INDEX time_order ON events(at,seq)')
                db.execute('CREATE INDEX server_time ON events(sid,at,seq)')
                db.commit()
            assert completed==summary['completed_count'] and rejected==summary['rejected_count']
            values=summary['response_times'];bins=[]
            if values:
                low,high=min(values),max(values);count=1 if low==high else 20
                width=max(.000001,abs(low)*.01) if count==1 else (high-low)/count
                bins=[dict(start=low+i*width,end=low+(i+1)*width,count=0) for i in range(count)]
                for value in values:bins[min(count-1,int((value-low)/width))]['count']+=1
            end=max(config['duration'],summary['events'][-1][0] if summary['events'] else 0)
            compact={k:v for k,v in summary.items() if k not in ('events','response_times')}
            compact.update(events=[],response_times=[],histogram=dict(scope='all_completed_responses',bins=bins),event_count=len(summary['events']),end_time=end)
            response=dict(api_version='1',run_id=rid,config=deepcopy(config),summary=compact,playback=dict(expires_in_seconds=self.limits.ttl_seconds,event_page_limit=self.limits.event_page,server_page_limit=self.limits.server_page,total_requests=offered))
            size=path.stat().st_size
            if size>self.limits.max_bytes:raise SessionError(503,'RUN_STORAGE_LIMIT','Recorded trace exceeds temporary storage capacity.')
            with self.lock:
                if self.closed:raise SessionError(503,'RUNS_CLOSED','Run store is shutting down.')
                self._sweep()
                while self.records and (len(self.records)>=self.limits.max_runs or sum(r['bytes'] for r in self.records.values())+size>self.limits.max_bytes):
                    self._remove(next(iter(self.records)),'evicted')
                self.records[rid]=dict(path=path,bytes=size,born=self.clock(),response=response)
            return deepcopy(response)
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    @staticmethod
    def _connect(record):
        db=sqlite3.connect(f'file:{record["path"]}?mode=ro',uri=True)
        db.row_factory=sqlite3.Row
        return db

    def get(self,rid):
        with self.lock:return deepcopy(self._get(rid)["response"])

    def events(self,rid,offset,limit):
        with self.lock:
            r=self._get(rid)
            with closing(self._connect(r)) as db:
                rows=db.execute('SELECT seq,at,sid,running,waiting,action,request,io,outstanding,io_active,io_queued FROM events WHERE seq>=? ORDER BY seq LIMIT ?',(offset,limit)).fetchall()
            total=r['response']['summary']['event_count']
            return dict(api_version='1',run_id=rid,offset=offset,limit=limit,total=total,next_offset=offset+len(rows) if offset+len(rows)<total else None,
                items=[dict(sequence=e['seq'],event=[e[k] for k in ('at','sid','running','waiting','action','request')] + ([e['io'],e['outstanding'],e['io_active'],e['io_queued']] if r['response']['config'].get('request_model')=='cpu_io' else [])) for e in rows])

    def snapshot(self,rid,now,offset,limit):
        with self.lock:
            r=self._get(rid);response=r['response'];config=response['config'];summary=response['summary'];now=min(now,summary['end_time'])
            with closing(self._connect(r)) as db:
                latest=db.execute('SELECT * FROM events WHERE at<=? ORDER BY at DESC,seq DESC LIMIT 1',(now,)).fetchone()
                items=[]
                for sid in range(offset,min(config['server_count'],offset+limit)):
                    e=db.execute('SELECT running,waiting,io,outstanding,io_active,io_queued FROM events WHERE sid=? AND at<=? ORDER BY at DESC,seq DESC LIMIT 1',(sid,now)).fetchone()
                    active,queued=(e['running'],e['waiting']) if e else (0,0)
                    items.append(dict(id=sid,running=active,waiting=queued,slots=config['concurrency'],queue_limit=config.get('outstanding_limit',config['queue_limit']),
                                      **(dict(io_waiting=e['io'] if e else 0,io_active=e['io_active'] if e else 0,io_queued=e['io_queued'] if e else 0,outstanding=e['outstanding'] if e else 0,outstanding_limit=config['outstanding_limit']) if config.get('request_model')=='cpu_io' else {}),processing_rate=config.get('processing_rates',[1]*config['server_count'])[sid]))
            return dict(api_version='1',run_id=rid,simulation_time=now,
                totals=dict(**(dict(io_waiting=latest['total_io'] if latest else 0,io_active=latest['total_io_active'] if latest else 0,io_queued=latest['total_io_queued'] if latest else 0,outstanding=latest['total_outstanding'] if latest else 0) if config.get('request_model')=='cpu_io' else {}),offered=latest['offered'] if latest else 0,completed=latest['completed'] if latest else 0,rejected=latest['rejected'] if latest else 0,running=latest['total_running'] if latest else 0,waiting=latest['total_waiting'] if latest else 0),
                **(dict(io_resource=dict(capacity=config.get('io_capacity',64),active=latest['total_io_active'] if latest else 0,queued=latest['total_io_queued'] if latest else 0)) if config.get('request_model')=='cpu_io' else {}),
                idle_servers=latest['idle'] if latest else config['server_count'],
                latest_event=([latest[k] for k in ('at','sid','running','waiting','action','request')]+([latest['io'],latest['outstanding'],latest['io_active'],latest['io_queued']] if config.get('request_model')=='cpu_io' else [])) if latest else None,
                servers=dict(offset=offset,limit=limit,total=config['server_count'],items=items))

    def delete(self,rid):
        with self.lock:
            self._get(rid);self._remove(rid,'deleted')
        return dict(api_version='1',run_id=rid,status='deleted')

    def close(self):
        self.stopping.set()
        if self.thread:self.thread.join(timeout=1)
        with self.lock:
            self.closed=True
            self.records.clear()
            if self.directory:self.directory.cleanup()
