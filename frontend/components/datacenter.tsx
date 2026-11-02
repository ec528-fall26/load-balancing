"use client";
import { useEffect, useState } from "react";
import type { Run } from "@/lib/engine";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Play, Pause, RotateCcw } from "lucide-react";
export function Datacenter({ run }: { run: Run }) {
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
  const servers = Object.entries(summary.per_server_utilization).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
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
          <NativeSelect
            id="server-page"
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
          >
            {Array.from({ length: Math.ceil(servers.length / 32) }, (_, i) => (
              <NativeSelectOption key={i} value={i}>
                Servers {i * 32}–{Math.min((i + 1) * 32, servers.length) - 1}
              </NativeSelectOption>
            ))}
          </NativeSelect>
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
        <div className="flex flex-col gap-4 rounded-lg border p-4">
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
              <NativeSelect
                id="playback-speed"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                {[0.25, 0.5, 1, 2, 5, 10].map((v) => (
                  <NativeSelectOption key={v} value={v}>
                    {v}×
                  </NativeSelectOption>
                ))}
              </NativeSelect>
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
            <p className="caption">1× = one simulated second per real second</p>
          </div>
          {latest && (
            <p className="caption">
              Latest event · {latest[0].toFixed(3)} s · Request {latest[5]}{" "}
              {latest[4]} on server {latest[1]}
            </p>
          )}
          <p className="caption">
            Playback follows the recorded run, including queue draining. Labels
            show current slot and queue counts.
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
              ? "grid min-w-0 gap-5 md:grid-cols-2"
              : "grid min-w-0 gap-5"
          }
        >
          {Array.from({ length: Math.ceil(visible.length / 8) }, (_, r) => (
            <Card key={r} className="min-w-0">
              <CardHeader>
                <CardTitle>Rack {page * 4 + r + 1}</CardTitle>
                <CardDescription>
                  {visible.slice(r * 8, r * 8 + 8).length} servers
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {visible.slice(r * 8, r * 8 + 8).map(([sid, u]) => {
                  const [active, queued] = states[sid];
                  return (
                    <div
                      key={sid}
                      className="flex flex-col gap-3 border-t pt-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-sm">Server {sid}</strong>
                        {mode === "Playback" && (
                          <Badge
                            variant={
                              queued === config.queue_limit && queued > 0
                                ? "destructive"
                                : active
                                  ? "default"
                                  : "secondary"
                            }
                          >
                            {queued
                              ? queued === config.queue_limit
                                ? "Queue full"
                                : "Queued"
                              : active
                                ? "Executing"
                                : "Idle"}
                          </Badge>
                        )}
                      </div>
                      {mode === "Run averages" ? (
                        <>
                          <div className="flex justify-between text-sm">
                            <span>Average utilization</span>
                            <span className="tabular-nums">
                              {(u * 100).toFixed(1)}%
                            </span>
                          </div>
                          <Progress
                            value={u * 100}
                            role="meter"
                            aria-label={`Server ${sid} slot utilization`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={u * 100}
                          />
                        </>
                      ) : (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col gap-2">
                            <div className="text-sm text-muted-foreground">
                              Executing{" "}
                              <span className="tabular-nums">
                                {active}/{config.concurrency}
                              </span>
                            </div>
                            <Progress
                              value={(100 * active) / config.concurrency}
                              aria-label={`Server ${sid} executing slots`}
                            />
                            <Badge variant={active ? "default" : "outline"}>
                              {active ? `Running × ${active}` : "Available"}
                            </Badge>
                          </div>
                          <div className="flex flex-col gap-2">
                            <div className="text-sm text-muted-foreground">
                              Waiting{" "}
                              <span className="tabular-nums">
                                {queued}/{config.queue_limit}
                              </span>
                            </div>
                            <Progress
                              value={
                                config.queue_limit
                                  ? (100 * queued) / config.queue_limit
                                  : 0
                              }
                              aria-label={`Server ${sid} waiting queue`}
                            />
                            <Badge variant={queued ? "secondary" : "outline"}>
                              {queued
                                ? `Waiting × ${queued}`
                                : config.queue_limit
                                  ? "Available"
                                  : "Disabled"}
                            </Badge>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
        {mode === "Playback" && (
          <Card>
            <CardHeader>
              <CardTitle>Task pool</CardTitle>
              <CardDescription>Across all servers</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-4">
                {[
                  ["Not arrived", total - arrived],
                  ["Running", running],
                  ["Waiting", waiting],
                  ["Completed", completed],
                  ["Rejected", rejected],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-2"
                  >
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="font-semibold tabular-nums">
                      {Number(value).toLocaleString()}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="caption mt-5">
                {arrived.toLocaleString()} arrived / {total.toLocaleString()}{" "}
                total requests.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
      <p className="caption">
        Showing {visible.length} of {servers.length} servers.{" "}
        {mode === "Playback"
          ? "Counts show occupied execution slots and waiting places separately."
          : "Bars show average occupied slots during the arrival window."}
      </p>
    </div>
  );
}
