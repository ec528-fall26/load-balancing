"use client";
import { useEffect, useRef, useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { RegionalConfig } from "@/lib/regions";
import { RegionalTelemetry } from "@/components/regional-telemetry";
import type { Config } from "@/lib/engine";
import type { LiveSessionController } from "@/hooks/use-live-session";
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { NumberField } from "@/components/number-field";
import { Notice, Panel } from "@/components/surface";
import { ResponseChart } from "@/components/chart";
import { ResourcePressure } from "./resource-pressure";
import { LatencyBreakdown } from "./latency-breakdown";
import { RackView } from "@/components/datacenter/rack-view";
import { TaskPool } from "@/components/datacenter/task-pool";
import { ServerInspector } from "@/components/datacenter/server-inspector";
import type { ServerSnapshot } from "@/components/datacenter/server-node";
import { seconds } from "@/components/results";
export function LiveSessionPanel({
  live,
  config,
}: {
  live: LiveSessionController;
  config: Config | RegionalConfig;
}) {
  const s = live.snapshot;
  const [rate, setRate] = useState(config.arrival_rate),
    [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (s) setRate(s.arrival_rate);
  }, [s?.session_id, s?.arrival_rate]);
  const servers: ServerSnapshot[] =
    (s?.topology === "regions" ? undefined : s?.servers.items)?.map(
      (server) => ({
        id: String(server.id),
        active: server.running,
        queued: server.waiting,
        slots: server.slots,
        queueLimit: server.queue_limit,
        utilization: server.mean_slot_utilization,
        processingRate: server.processing_rate,
        ioWaiting: server.io_waiting,
        ioActive: server.io_active,
        ioQueued: server.io_queued,
        outstanding: server.outstanding,
        outstandingLimit: server.outstanding_limit,
      }),
    ) ?? [];
  const active = !!live.id;
  const pageReady =
    s?.topology !== "regions" && s?.servers.offset === live.offset;
  const bins =
    s?.histogram.bins.map((bin) => ({
      ...bin,
      center: (bin.start + bin.end) / 2,
    })) ?? [];
  return (
    <section
      aria-label="Continuous simulation"
      className="flex min-w-0 flex-col gap-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Continuous simulation</h2>
          <p className="caption">
            Python owns the clock. The session keeps running between updates and
            while this page is closed, until stopped or expired.
          </p>
        </div>
        <Badge
          variant={
            live.connectionError
              ? "destructive"
              : active && s?.status === "running"
                ? "executing"
                : "secondary"
          }
        >
          {live.connectionError
            ? active
              ? "Disconnected"
              : "Session ended"
            : active
              ? s?.status === "paused"
                ? "Paused"
                : s
                  ? "Running"
                  : "Reconnecting…"
              : s
                ? "Stopped"
                : "Not started"}
        </Badge>
      </div>
      {live.error && (
        <Notice error>
          {live.error}
          {active &&
            live.connectionError &&
            " Retaining the last snapshot; reconnecting automatically."}
        </Notice>
      )}
      {active && (
        <Card>
          <CardHeader>
            <CardTitle>Live controls</CardTitle>
            <CardDescription>
              These controls affect the active session. Setup edits apply on
              the next start.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Button
                disabled={live.busy || !s}
                onClick={() =>
                  live.command(s?.status === "paused" ? "resume" : "pause")
                }
              >
                {s?.status === "paused" ? "Resume session" : "Pause session"}
              </Button>
              <Button
                variant="outline"
                disabled={live.busy}
                onClick={() => live.stop()}
              >
                Stop session
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-52">
                <NumberField
                  label="Live requests per second"
                  step={0.01}
                  value={rate}
                  onChange={setRate}
                />
              </div>
              <Button
                variant="outline"
                disabled={live.busy || !s || rate === s.arrival_rate}
                onClick={() => live.command("set_rate", rate)}
              >
                Apply traffic
              </Button>
              <Button
                variant="outline"
                disabled={live.busy || !s || s.arrival_rate === 0}
                onClick={() => live.command("set_rate", 0)}
              >
                Drain traffic
              </Button>
            </div>
            <Panel title="Session options"><div className="flex flex-wrap items-end gap-3">
              <Button
                variant="outline"
                disabled={live.busy}
                onClick={async () => {
                  if (await live.stop()) await live.create(config);
                }}
              >
                Restart session
              </Button>
              <Field className="w-40">
                <FieldLabel htmlFor="live-speed">Simulation speed</FieldLabel>
                <Select
                  disabled={live.busy || !s}
                  value={String(s?.speed ?? 1)}
                  onValueChange={(value) =>
                    live.command("set_speed", Number(value))
                  }
                >
                  <SelectTrigger id="live-speed">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {[0.25, 0.5, 1, 2, 5, 10].map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {value}×
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div></Panel>
            <p className="caption">
              Zero traffic drains outstanding work while running. Pause freezes
              processing. Current traffic:{" "}
              {s?.arrival_rate.toLocaleString() ?? "…"} requests/s.
            </p>
          </CardContent>
        </Card>
      )}
      {!s && active && <Skeleton className="h-52" />}
      {!s && !active && (
        <Empty className="min-h-64 border border-dashed">
          <EmptyHeader>
            <EmptyTitle>Ready for a continuous run</EmptyTitle>
            <EmptyDescription>
              Configure the topology and select Start continuous simulation.
              There is no arrival-window cutoff.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {s?.topology === "regions" ? (
        <>
          <p className="caption">
            Simulated time: {s.simulation_time.toFixed(2)} s · {s.speed}× target
            speed · revision {s.revision}
            {s.lag_simulation_seconds > 0.25
              ? ` · Catching up: ${s.lag_simulation_seconds.toFixed(2)} simulated seconds behind`
              : ""}
            {!active ? " · Last retained snapshot; no longer live." : ""}
          </p>
          <RegionalTelemetry summary={s} />
        </>
      ) : (
        s && (
          <>
            <p className="caption">
              Active pool: {s.config.server_count.toLocaleString()} servers ×{" "}
              {s.config.concurrency.toLocaleString()} slots;{" "}
              {s.config.request_model==="cpu_io" ? `${s.config.outstanding_limit} outstanding places per server · CPU → I/O → CPU` : `${s.config.queue_limit.toLocaleString()} queue places per server.`}
            </p>
            <div role="status" className="flex flex-wrap items-center gap-3">
              <strong className="tabular-nums">
                Simulated time: {s.simulation_time.toFixed(2)} s
              </strong>
              <span className="caption">
                {s.speed}× target speed · revision {s.revision}
              </span>
              {s.lag_simulation_seconds > 0.25 && (
                <Badge variant="waiting">
                  Catching up: {s.lag_simulation_seconds.toFixed(2)} simulated
                  seconds behind
                </Badge>
              )}
              {!active && (
                <span className="caption">
                  Last retained snapshot; no longer live.
                </span>
              )}
            </div>
            {s.config.request_model==="cpu_io"&&s.io_resource&&<ResourcePressure cpuActive={s.totals.running} cpuSlots={s.config.server_count*s.config.concurrency} cpuQueued={s.totals.waiting} outstanding={s.totals.outstanding??0} admissionSlots={s.config.server_count*(s.config.outstanding_limit??1)} ioActive={s.io_resource.active} ioQueued={s.io_resource.queued} ioCapacity={s.io_resource.capacity}/>}
            {s.config.request_model==="cpu_io"&&<p className="caption">CPU active: {s.totals.running} · I/O waiting: {s.totals.io_waiting} · CPU queue: {s.totals.waiting} · Outstanding: {s.totals.outstanding} · Mean CPU queue delay: {seconds(s.metrics.mean_cpu_queue_wait??null)}</p>}
            {s.config.request_model==="cpu_io"&&<LatencyBreakdown metrics={s.metrics}/>}
            <dl className="grid grid-cols-2 gap-5 border-y py-4 lg:grid-cols-4">
              {[
                ["Offered", s.totals.offered.toLocaleString()],
                ["Completed", s.totals.completed.toLocaleString()],
                ["Rejected", s.totals.rejected.toLocaleString()],
                ["Recent p95", seconds(s.metrics.recent_p95_response_time)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="caption">
              Mean response: {seconds(s.metrics.mean_response_time)} since
              start. Recent p95 and histogram cover the latest{" "}
              {s.metrics.response_window_count.toLocaleString()} completed
              responses, up to{" "}
              {s.metrics.response_window_limit.toLocaleString()}.
              Session-average slot utilization:{" "}
              {(100 * s.metrics.mean_slot_utilization).toFixed(1)}%.
            </p>
            <div className="grid min-w-0 gap-5 xl:grid-cols-2">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Live load</CardTitle>
                  <CardDescription>
                    Bounded history of CPU execution, CPU queue and I/O wait.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      running: {
                        label: "Executing",
                        color: "var(--executing)",
                      },
                      waiting: { label: "CPU queue", color: "var(--waiting)" },
                      io_waiting: { label: "I/O wait", color: "var(--chart-3)" },
                    }}
                    className="h-52 w-full"
                  >
                    <LineChart accessibilityLayer data={s.history}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="simulation_time"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(n) => `${Number(n).toFixed(1)} s`}
                      />
                      <YAxis allowDecimals={false} width={36} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Line
                        dataKey="running"
                        stroke="var(--color-running)"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="waiting"
                        stroke="var(--color-waiting)"
                        dot={false}
                        isAnimationActive={false}
                      />
                      {s.config.request_model==="cpu_io"&&<Line type="stepAfter" dataKey="io_waiting" stroke="var(--color-io_waiting)" dot={false} isAnimationActive={false}/>}
                    </LineChart>
                  </ChartContainer>
                </CardContent>
              </Card>
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Recent response times</CardTitle>
                  <CardDescription>
                    Up to 20 bins supplied by Python; completed requests only.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {bins.length ? (
                    <ResponseChart
                      bins={bins}
                      p95={s.metrics.recent_p95_response_time}
                    />
                  ) : (
                    <p className="caption">Waiting for completed requests.</p>
                  )}
                </CardContent>
              </Card>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Live datacenter</h3>
                <p className="caption">
                  Racks are display groups. Executing and waiting counts are
                  separate.
                </p>
              </div>
              {s.servers.total > 32 && (
                <Field className="w-48">
                  <FieldLabel htmlFor="live-server-page">
                    Live server page
                  </FieldLabel>
                  <Select
                    value={String(live.offset)}
                    disabled={!active}
                    onValueChange={(value) => live.setOffset(Number(value))}
                  >
                    <SelectTrigger id="live-server-page">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {Array.from(
                          { length: Math.ceil(s.servers.total / 32) },
                          (_, i) => (
                            <SelectItem key={i} value={String(i * 32)}>
                              Servers {i * 32}–
                              {Math.min((i + 1) * 32, s.servers.total) - 1}
                            </SelectItem>
                          ),
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_220px]">
              <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
                {!pageReady ? (
                  <Skeleton className="h-64" />
                ) : (
                  Array.from(
                    { length: Math.ceil(servers.length / 8) },
                    (_, i) => (
                      <RackView
                        key={i}
                        number={Math.floor(s.servers.offset / 8) + i + 1}
                        servers={servers.slice(i * 8, i * 8 + 8)}
                        averages={false}
                        onInspect={(id) => {
                          trigger.current =
                            document.activeElement instanceof HTMLElement
                              ? document.activeElement
                              : null;
                          setSelected(id);
                        }}
                      />
                    ),
                  )
                )}
              </div>
              <TaskPool
                continuous
                total={s.totals.offered}
                ioActive={s.config.request_model==="cpu_io"?s.totals.io_active:undefined}
                ioQueued={s.config.request_model==="cpu_io"?s.totals.io_queued:undefined}
                ioWaiting={s.config.request_model==="cpu_io"?s.totals.io_waiting:undefined}
                running={s.totals.running}
                waiting={s.totals.waiting}
                completed={s.totals.completed}
                rejected={s.totals.rejected}
              />
            </div>
            <ServerInspector
              live
              server={servers.find((server) => server.id === selected)}
              now={s.simulation_time}
              averages={false}
              onClose={() => setSelected(null)}
              onRestoreFocus={() => trigger.current?.focus()}
            />
            <Panel title="Active continuous configuration">
              <pre>{JSON.stringify(s.config, null, 2)}</pre>
            </Panel>
          </>
        )
      )}
    </section>
  );
}
