"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { cpuIOPolicies } from "@/lib/policy-metadata";
import { cpuIOTemplates } from "@/lib/cpu-io-templates";
import { Pause, Play, RotateCcw } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Snapshot = {time:number; kind:string; request:number; server:number; cpu_active:number[]; io_waiting:number[]; cpu_queued:number[]; outstanding:number[]; completed:number; rejected:number; offered:number};
type Result = {policy:string; offered:number; completed:number; rejected:number; rejection_rate:number; mean_response:number|null; p95_response:number|null; cpu_utilization:number[]; end_time:number; events:Snapshot[]};
type Preview = {mode:string; policy:string; seed:number; policies:Record<string,string>; config:{servers:number;cpu_slots:number;outstanding_limit:number;duration:number}; comparison:Result[]; playback:Result; requests:{id:number;arrival:number;cpu_first:number;io_wait:number;cpu_last:number}[]};
const sum = (a:number[]) => a.reduce((s,n)=>s+n,0);
const ms = (n:number|null) => n===null ? "—" : `${(n*1000).toFixed(1)} ms`;
export default function CPUIOPage() {
  return <Suspense fallback={<p className="p-8">Loading CPU/I/O lab…</p>}><CPUIOLab /></Suspense>;
}
function CPUIOLab() {
  const params = useSearchParams();
  const template = cpuIOTemplates.find(t => t.id === params.get("template"));
  const [mode,setMode] = useState<string>(template?.mode ?? "walkthrough");
  const [profile,setProfile] = useState<string>(template?.profile ?? "io_heavy");
  const [rate,setRate] = useState(String(template?.rate ?? 400));
  const [policy,setPolicy] = useState<string>(template?.policy ?? "round_robin");
  const [data,setData] = useState<Preview|null>(null);
  const [busy,setBusy] = useState(true);
  const [error,setError] = useState("");
  const [retry,setRetry] = useState(0);
  const [time,setTime] = useState(2);
  const [playing,setPlaying] = useState(false);
  useEffect(()=>{
    const controller = new AbortController();
    setBusy(true);setError("");setPlaying(false);
    (async () => {
      for (let attempt=0; ; attempt++) {
        if(controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const response=await fetch("/api/research/cpu-io", {method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,body:JSON.stringify({config:{mode,profile,rate:Number(rate),policy,seed:42}})});
        // An aborted prior render may still be finishing inside Python's run gate.
        if(response.status!==429 || attempt>=5) return response;
        await response.body?.cancel();
        await new Promise(resolve=>setTimeout(resolve,150));
      }
    })()
      .then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.message||"Could not run the example.");return body as Preview;})
      .then(body=>{if(!controller.signal.aborted){setData(body);setTime(mode==="walkthrough"?2:0);}})
      .catch(e=>{if(!controller.signal.aborted){setData(null);setError(e instanceof Error?e.message:"Could not run the example.");}})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return ()=>controller.abort();
  },[mode,profile,rate,policy,retry]);
  useEffect(()=>{
    if(!playing||!data)return;
    let previous=performance.now();
    const id=setInterval(()=>{const now=performance.now();const dt=(now-previous)/1000;previous=now;setTime(t=>Math.min(data.playback.end_time,t+dt));},100);
    return ()=>clearInterval(id);
  },[playing,data]);
  useEffect(()=>{if(data&&time>=data.playback.end_time)setPlaying(false);},[time,data]);
  const snapshot=useMemo(()=>{
    if(!data)return null;
    const events=data.playback.events;
    let lo=0,hi=events.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(events[mid].time<=time)lo=mid+1;else hi=mid;}
    return lo ? events[lo-1] : {time:0,kind:"",request:0,server:0,cpu_active:Array(data.config.servers).fill(0),io_waiting:Array(data.config.servers).fill(0),cpu_queued:Array(data.config.servers).fill(0),outstanding:Array(data.config.servers).fill(0),completed:0,rejected:0,offered:0};
  },[data,time]);
  const lanes=useMemo(()=>data?.requests.map(r=>{
    const cpu=data.playback.events.filter(e=>e.request===r.id&&e.kind==="cpu_end");
    const io=data.playback.events.find(e=>e.request===r.id&&e.kind==="io_end");
    return {id:r.id,arrival:r.arrival,segments:cpu.length===2&&io?[{label:"CPU",start:cpu[0].time-r.cpu_first,end:cpu[0].time,fill:"var(--chart-1)"},{label:"I/O wait",start:cpu[0].time,end:io.time,fill:"var(--chart-2)"},{label:"CPU",start:cpu[1].time-r.cpu_last,end:cpu[1].time,fill:"var(--chart-1)"}]:[]};
  })??[],[data]);
  return <div className="min-h-screen bg-background">
    <AppHeader section="lab" />
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">CPU work and I/O wait</h1><p className="mt-2 max-w-2xl text-muted-foreground">A request can stop using CPU and still occupy admission capacity. Watch the stages, then compare how routing reacts.</p></div>
        <Badge variant="outline">Research preview</Badge>
      </div>
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList><TabsTrigger value="walkthrough">Two-request example</TabsTrigger><TabsTrigger value="workload">Workload comparison</TabsTrigger></TabsList>
      </Tabs>
      <FieldGroup className="grid gap-4 sm:grid-cols-3">
        <Field><FieldLabel htmlFor="cpu-policy">Playback policy</FieldLabel><Select value={policy} onValueChange={setPolicy}><SelectTrigger id="cpu-policy"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{Object.entries(data?.policies??cpuIOPolicies).map(([id,label])=><SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        {mode==="workload"&&<><Field><FieldLabel htmlFor="cpu-profile">Request profile</FieldLabel><Select value={profile} onValueChange={setProfile}><SelectTrigger id="cpu-profile"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="io_heavy">I/O heavy · 10% CPU / 90% I/O</SelectItem><SelectItem value="cpu_heavy">CPU heavy · 90% CPU / 10% I/O</SelectItem></SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="cpu-rate">Offered traffic</FieldLabel><Select value={rate} onValueChange={setRate}><SelectTrigger id="cpu-rate"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[40,100,400].map(r=><SelectItem value={String(r)} key={r}>{r} requests / second</SelectItem>)}</SelectGroup></SelectContent></Select></Field></>}
      </FieldGroup>
      {error&&<Alert variant="destructive"><AlertTitle>Example unavailable</AlertTitle><AlertDescription>{error} Check that the Python API is running, then retry.</AlertDescription><Button variant="outline" onClick={()=>setRetry(n=>n+1)}>Retry simulation</Button></Alert>}
      <Card aria-busy={busy}>
        <CardHeader><CardTitle>{mode==="walkthrough"?"One CPU slot, two outstanding places":"Eight servers, one CPU slot each"}</CardTitle><CardDescription>{mode==="walkthrough"?"Each request needs 1s CPU → 2s I/O → 1s CPU. Requests arrive at 0s and 0.1s.":"Two seconds of seeded traffic, eight outstanding places per server. Accepted work drains after arrivals stop."}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy||!data} onClick={()=>{if(data&&time>=data.playback.end_time)setTime(0);setPlaying(p=>!p);}}>{playing?<Pause data-icon="inline-start"/>:<Play data-icon="inline-start"/>}{playing?"Pause":"Play"}</Button>
            <Button variant="outline" disabled={busy||!data} onClick={()=>{setPlaying(false);setTime(0);}}><RotateCcw data-icon="inline-start"/>Restart</Button>
            <output aria-label="Playback time" className="ml-auto tabular-nums">{busy?"Running Python model…":`${time.toFixed(2)} / ${data?.playback.end_time.toFixed(2)??"—"} s`}</output>
          </div>
          <Slider aria-label="Simulation time" disabled={busy||!data} min={0} max={data?.playback.end_time||1} step={.01} value={[time]} onValueChange={([t])=>{setPlaying(false);setTime(t);}} />
          {data&&snapshot&&!busy&&!error&&<>
            {lanes.length>0&&<div className="flex flex-col gap-3" role="img" aria-label="Request timeline. Teal is CPU execution; orange is I/O wait. The vertical line marks playback time.">
              <div className="flex gap-4 text-sm"><span className="text-[var(--chart-1)]">CPU execution</span><span className="text-[var(--chart-2)]">I/O wait</span><span className="text-muted-foreground">Unfilled time: waiting for CPU</span></div>
              {lanes.map(l=><div key={l.id} className="flex items-center gap-3"><span className="w-20 shrink-0 text-sm">Request {l.id}</span><svg viewBox="0 0 600 38" className="h-12 w-full" aria-hidden="true"><rect x="0" y="2" width="600" height="34" rx="5" fill="var(--muted)"/>{l.segments.map((s,i)=><g key={i}><rect x={s.start/data.playback.end_time*600} y="2" width={(s.end-s.start)/data.playback.end_time*600} height="34" rx="4" fill={s.fill}/><text x={(s.start+s.end)/2/data.playback.end_time*600} y="24" textAnchor="middle" fill="var(--chart-label)" fontSize="13">{s.label}</text></g>)}<line x1={time/data.playback.end_time*600} x2={time/data.playback.end_time*600} y1="0" y2="38" stroke="var(--foreground)" strokeWidth="2"/></svg></div>)}
            </div>}
            <Table><TableHeader><TableRow><TableHead>Server</TableHead><TableHead>CPU active</TableHead><TableHead>I/O waiting</TableHead><TableHead>CPU queue</TableHead><TableHead>Outstanding</TableHead></TableRow></TableHeader><TableBody>{snapshot.cpu_active.map((n,i)=><TableRow key={i}><TableCell>Server {i}</TableCell><TableCell><Badge variant={n?"default":"secondary"}>{n} / {data.config.cpu_slots}</Badge></TableCell><TableCell>{snapshot.io_waiting[i]}</TableCell><TableCell>{snapshot.cpu_queued[i]}</TableCell><TableCell>{snapshot.outstanding[i]} / {data.config.outstanding_limit}</TableCell></TableRow>)}</TableBody></Table>
            <div className="flex flex-wrap gap-4 text-sm tabular-nums"><span>{snapshot.offered} arrived</span><span>{snapshot.completed} completed</span><span>{snapshot.rejected} rejected</span><span>{sum(snapshot.outstanding)} outstanding</span></div>
            {sum(snapshot.cpu_active)===0&&sum(snapshot.io_waiting)>0&&<Alert><AlertTitle>CPU idle, requests still outstanding</AlertTitle><AlertDescription>I/O wait releases CPU slots. It does not release admission capacity; new requests can still be rejected.</AlertDescription></Alert>}
          </>}
        </CardContent>
      </Card>
      {mode==="workload"&&data&&!busy&&<Card><CardHeader><CardTitle>Same workload, three routing policies</CardTitle><CardDescription>Fresh Python runs · seed 42 · {data.playback.offered} identical requests each. Whole-run latency includes draining and excludes rejected requests.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Policy</TableHead><TableHead>Completed</TableHead><TableHead>Rejected</TableHead><TableHead>Mean response</TableHead><TableHead>p95 response</TableHead><TableHead>CPU occupancy</TableHead></TableRow></TableHeader><TableBody>{data.comparison.map(r=><TableRow key={r.policy}><TableCell>{data.policies[r.policy]}</TableCell><TableCell>{r.completed}</TableCell><TableCell>{r.rejected} ({(r.rejection_rate*100).toFixed(1)}%)</TableCell><TableCell>{ms(r.mean_response)}</TableCell><TableCell>{ms(r.p95_response)}</TableCell><TableCell>{(sum(r.cpu_utilization)/r.cpu_utilization.length*100).toFixed(1)}%</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
      <p className="max-w-3xl text-sm text-muted-foreground">This model has unbounded I/O delay capacity, finite CPU slots and an outstanding-request cap. Least-active and power-of-two observe CPU-active counts, not every outstanding HTTP request. No network contention, retries or failures are modeled. Playback shows recorded execution; it does not change a running experiment.</p>
    </main>
  </div>;
}
