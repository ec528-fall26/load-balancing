"use client";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const end = Math.max(config.duration, events.at(-1)?.[0] ?? 0);
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
  const states: Record<string, [number, number]> = {};
  servers.forEach(([sid]) => (states[sid] = [0, 0]));
  let completed = 0,
    rejected = 0,
    latest;
  for (const event of events) {
    if (event[0] > now) break;
    states[event[1]] = [event[2], event[3]];
    completed += Number(event[4] === "completed");
    rejected += Number(event[4] === "rejected");
    latest = event;
  }
  const running = Object.values(states).reduce((a, b) => a + b[0], 0),
    waiting = Object.values(states).reduce((a, b) => a + b[1], 0),
    total = Math.floor(config.arrival_rate * config.duration),
    arrived = running + waiting + completed + rejected;
  const visible = servers.slice(page * 32, (page + 1) * 32);
  const snapshot = ([id, utilization]: [string, number]): ServerSnapshot => ({
    id,
    utilization,
    active: states[id]?.[0] ?? 0,
    queued: states[id]?.[1] ?? 0,
    slots: config.concurrency,
    queueLimit: config.queue_limit,
    processingRate: config.processing_rates?.[Number(id)] ?? 1,
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
                onValueChange={(v) => setNow(v[0])}
              />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm tabular-nums">
                {now >= end ? "Finished" : playing ? "Playing" : "Paused"} ·{" "}
                {now.toFixed(1)} / {end.toFixed(1)} s
              </strong>
              <p className="caption">
                1× = one simulated second per real second
              </p>
            </div>
            {latest && (
              <p className="caption">
                Latest event · {latest[0].toFixed(3)} s · Request {latest[5]}{" "}
                {latest[4]} on server {latest[1]}
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
            <Badge variant="waiting">{waiting.toLocaleString()} waiting</Badge>
            <Badge variant="secondary">
              {
                servers.filter(([id]) => !states[id][0] && !states[id][1])
                  .length
              }{" "}
              idle servers
            </Badge>
          </div>
          <p className="caption">
            Teal: executing · Orange: waiting · Empty cells: available
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
          {Array.from({ length: Math.ceil(displayed.length / 8) }, (_, r) => (
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
          ))}
        </div>
        {mode === "Playback" && (
          <TaskPool
            total={total}
            running={running}
            waiting={waiting}
            completed={completed}
            rejected={rejected}
          />
        )}
      </div>
      <ServerInspector
        server={inspected ? snapshot(inspected) : undefined}
        now={now}
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
