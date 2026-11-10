"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRecordedPlayback } from "@/hooks/use-recorded-playback";
import { Notice } from "@/components/surface";
import { Skeleton } from "@/components/ui/skeleton";
import type { Run } from "@/lib/engine";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Field,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, RotateCcw } from "lucide-react";
import { ResourcePressure } from "./resource-pressure";
import { RackView } from "./datacenter/rack-view";
import { TaskPool } from "./datacenter/task-pool";
import { ServerInspector } from "./datacenter/server-inspector";
import type { ServerSnapshot } from "./datacenter/server-node";
export function Datacenter({ run }: { run: Run }) {
  const selectedTrigger = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState("Playback"),
    [page, setPage] = useState(0),
    [now, setNow] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  const { config, summary } = run,
    events = summary.events;
  const end =
    summary.end_time ?? Math.max(config.duration, events.at(-1)?.[0] ?? 0);
  const recorded = useRecordedPlayback(
    run.run_id,
    now,
    page,
    mode === "Playback",
  );
  const remote = recorded.snapshot;
  const displayedNow =
    run.run_id && mode === "Playback" ? (remote?.simulation_time ?? 0) : now;
  const pageReady =
    !run.run_id || (remote?.servers.offset === page * 32 && !recorded.error);
  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const next = performance.now();
      const delta = ((next - previous) / 1000) * speed;
      previous = next;
      setNow((t) => Math.min(end, t + delta));
    }, 100);
    return () => clearInterval(timer);
  }, [playing, speed, end]);
  useEffect(() => {
    if (now >= end) setPlaying(false);
  }, [now, end]);
  const servers = useMemo(
    () =>
      Object.entries(summary.per_server_utilization).sort(
        (a, b) => Number(a[0]) - Number(b[0]),
      ),
    [summary.per_server_utilization],
  );
  const states: Record<string, [number, number,number,number,number,number]> = {};
  servers.forEach(([sid]) => (states[sid] = [0, 0,0,0,0,0]));
  let completed = 0,
    rejected = 0,
    latest;
  for (const event of events) {
    if (event[0] > now) break;
    states[event[1]] = [event[2], event[3],event[6]??0,event[7]??event[2]+event[3],event[8]??event[6]??0,event[9]??0];
    completed += Number(event[4] === "completed");
    rejected += Number(event[4] === "rejected");
    latest = event;
  }
  if (run.run_id && remote) {
    for (const row of remote.servers.items)
      states[String(row.id)] = [row.running, row.waiting,row.io_waiting??0,row.outstanding??row.running+row.waiting,row.io_active??row.io_waiting??0,row.io_queued??0];
    completed = remote.totals.completed;
    rejected = remote.totals.rejected;
    latest = remote.latest_event ?? undefined;
  }
  const running =
      run.run_id && remote
        ? remote.totals.running
        : Object.values(states).reduce((a, b) => a + b[0], 0),
    waiting =
      run.run_id && remote
        ? remote.totals.waiting
        : Object.values(states).reduce((a, b) => a + b[1], 0),
    total =
      run.playback?.total_requests ??
      Math.floor(config.arrival_rate * config.duration),
    ioWaiting = run.run_id&&remote ? remote.totals.io_waiting??0 : Object.values(states).reduce((n,s)=>n+s[2],0),
    arrived = running + waiting + completed + rejected + ioWaiting;
  const visible = servers.slice(page * 32, (page + 1) * 32);
  const snapshot = ([id, utilization]: [string, number]): ServerSnapshot => ({
    id,
    utilization,
    active: states[id]?.[0] ?? 0,
    queued: states[id]?.[1] ?? 0,
    slots: config.concurrency,
    queueLimit: config.queue_limit,
    processingRate: config.processing_rates?.[Number(id)] ?? 1,
    ...(config.request_model==="cpu_io" ? {ioWaiting:states[id]?.[2]??0,outstanding:states[id]?.[3]??0,ioActive:states[id]?.[4]??0,ioQueued:states[id]?.[5]??0,outstandingLimit:config.outstanding_limit,queueLimit:config.outstanding_limit!}:{}),
  });
  const displayed = visible.map(snapshot);
  const inspected =
    selected === null ? undefined : servers.find(([id]) => id === selected);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Datacenter</h2>
        <p className="caption mt-1">
          Racks group servers for display; they do not model physical locations
          or network topology.
        </p>
      </div>
      {config.request_model==="cpu_io"&&mode==="Playback"&&<ResourcePressure cpuActive={running} cpuSlots={config.server_count*config.concurrency} cpuQueued={waiting} outstanding={running+waiting+ioWaiting} admissionSlots={config.server_count*(config.outstanding_limit??1)} ioActive={remote?.io_resource?.active??Object.values(states).reduce((n,s)=>n+s[4],0)} ioQueued={remote?.io_resource?.queued??Object.values(states).reduce((n,s)=>n+s[5],0)} ioCapacity={config.io_capacity??64}/>}
      {recorded.error && (
        <Notice error>
          {recorded.error} Summary metrics remain available. Rerun to recreate
          playback.
        </Notice>
      )}
      {run.run_id && mode === "Playback" && !recorded.error && (
        <p className="caption">
          Recorded state at {(remote?.simulation_time ?? 0).toFixed(2)} s.
          Playback is temporary; summary metrics remain available after it
          expires.
        </p>
      )}
      {servers.length > 32 && (
        <Field className="max-w-xs">
          <FieldLabel htmlFor="server-page">Servers to display</FieldLabel>
          <Select
            value={String(page)}
            onValueChange={(value) => setPage(Number(value))}
          >
            <SelectTrigger id="server-page" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Array.from(
                  { length: Math.ceil(servers.length / 32) },
                  (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      Servers {i * 32}–
                      {Math.min((i + 1) * 32, servers.length) - 1}
                    </SelectItem>
                  ),
                )}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )}
      <FieldSet>
        <FieldLegend>View</FieldLegend>
        <RadioGroup
          className="flex flex-wrap gap-5"
          value={mode}
          onValueChange={setMode}
        >
          {["Playback", "Run averages"].map((v) => (
            <Field orientation="horizontal" key={v} className="w-auto">
              <RadioGroupItem id={`view-${v}`} value={v} />
              <FieldLabel htmlFor={`view-${v}`}>{v}</FieldLabel>
            </Field>
          ))}
        </RadioGroup>
      </FieldSet>
      {mode === "Playback" && (
        <Card>
          <CardHeader>
            <CardTitle>Playback controls</CardTitle>
            <CardDescription>
              Explore the recorded run, including queue draining.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Button
                onClick={() => {
                  if (now >= end) setNow(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? (
                  <Pause data-icon="inline-start" />
                ) : (
                  <Play data-icon="inline-start" />
                )}
                {playing ? "Pause" : "Play"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setNow(0);
                  setPlaying(false);
                }}
              >
                <RotateCcw data-icon="inline-start" />
                Restart
              </Button>
              <Field className="w-40">
                <FieldLabel htmlFor="playback-speed">Playback speed</FieldLabel>
                <Select
                  value={String(speed)}
                  onValueChange={(value) => setSpeed(Number(value))}
                >
                  <SelectTrigger id="playback-speed" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {[0.25, 0.5, 1, 2, 5, 10].map((v) => (
                        <SelectItem key={v} value={String(v)}>
                          {v}×
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel>Jump to time (seconds)</FieldLabel>
              <Slider
                aria-label="Jump to time (seconds)"
                min={0}
                max={Math.max(end, 0.001)}
                step={end > 0 ? Math.min(0.1, end / 100) : 0.001}
                value={[now]}
                onValueChange={(v) =>
                  setNow(
                    end - v[0] <=
                      (end > 0 ? Math.min(0.1, end / 100) : 0.001) / 2 + 1e-9
                      ? end
                      : v[0],
                  )
                }
              />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm tabular-nums">
                {displayedNow >= end
                  ? "Finished"
                  : playing
                    ? "Playing"
                    : "Paused"}{" "}
                · {displayedNow.toFixed(1)} / {end.toFixed(1)} s
              </strong>
              <p className="caption">
                1× = one simulated second per real second
              </p>
            </div>
            {latest && (
              <p className="caption">
                Latest event · {latest[0].toFixed(3)} s · Request {latest[5]}{" "}
                {config.request_model==="cpu_io"?({cpu_to_io:"finished CPU stage 1",io_started:"started shared I/O",io_to_cpu:"returned from I/O",started:"started CPU work",queued:"joined the CPU queue",completed:"completed",rejected:"was rejected"} as Record<string,string>)[latest[4]]??latest[4]:latest[4]} on server {latest[1]}
              </p>
            )}
            <p className="caption">
              Playback follows the recorded run, including queue draining.
              Labels show current slot and queue counts.
            </p>
          </CardContent>
        </Card>
      )}
      {mode === "Playback" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="executing">
              {running.toLocaleString()} executing
            </Badge>
            <Badge variant="waiting">{waiting.toLocaleString()} {config.request_model==="cpu_io"?"CPU queued":"waiting"}</Badge>
            {config.request_model==="cpu_io"&&<Badge variant="outline">{ioWaiting} I/O waiting</Badge>}
            <Badge variant="secondary">
              {run.run_id && remote
                ? remote.idle_servers
                : servers.filter(([id]) => !states[id][3])
                    .length}{" "}
              idle servers
            </Badge>
          </div>
          <p className="caption">
            Teal: CPU execution · Orange: CPU queue · I/O wait and admission are separate
          </p>
        </div>
      )}
      <div
        className={
          mode === "Playback"
            ? "grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_220px]"
            : "grid gap-5"
        }
      >
        <div
          className={
            visible.length > 8
              ? "grid min-w-0 items-start gap-5 md:grid-cols-2"
              : "grid min-w-0 gap-5"
          }
        >
          {mode === "Playback" && !pageReady ? (
            <Skeleton className="h-64" />
          ) : (
            Array.from({ length: Math.ceil(displayed.length / 8) }, (_, r) => (
              <RackView
                key={r}
                number={page * 4 + r + 1}
                servers={displayed.slice(r * 8, r * 8 + 8)}
                averages={mode === "Run averages"}
                onInspect={(id) => {
                  selectedTrigger.current =
                    document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : null;
                  setPlaying(false);
                  setSelected(id);
                }}
              />
            ))
          )}
        </div>
        {mode === "Playback" && (
          <TaskPool
            total={total}
            ioActive={config.request_model==="cpu_io" ? remote?.io_resource?.active??Object.values(states).reduce((n,s)=>n+s[4],0) : undefined}
            ioQueued={config.request_model==="cpu_io" ? remote?.io_resource?.queued??Object.values(states).reduce((n,s)=>n+s[5],0) : undefined}
            ioWaiting={config.request_model==="cpu_io" ? ioWaiting : undefined}
            running={running}
            waiting={waiting}
            completed={completed}
            rejected={rejected}
          />
        )}
      </div>
      <ServerInspector
        server={inspected ? snapshot(inspected) : undefined}
        now={displayedNow}
        averages={mode === "Run averages"}
        onClose={() => setSelected(null)}
        onRestoreFocus={() => selectedTrigger.current?.focus()}
      />
      <p className="caption">
        Showing {visible.length} of {servers.length} servers.{" "}
        {mode === "Playback"
          ? "Execution and waiting are separate. Up to 16 cells per strip; large capacities group multiple places per cell. Select a server for details."
          : "Bars show average occupied slots during the arrival window."}
      </p>
    </div>
  );
}
