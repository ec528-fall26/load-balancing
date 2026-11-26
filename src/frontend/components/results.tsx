"use client";
import { DEFAULT_WRITE_SPEED_MIB_S } from "@/lib/engine";
import { useMemo } from "react";
import {
  OutcomeChart,
  ResponseChart,
  UtilizationChart,
  histogram,
} from "./chart";
import { metricHelp } from "@/lib/metric-help";
import { ParameterHelp } from "./parameter-help";
import { LatencyBreakdown } from "./latency-breakdown";
import { Datacenter } from "./datacenter";
import { Run, policies } from "@/lib/engine";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "./surface";
import { AvailabilityNote } from "./availability-note";
import { OutageTimeline } from "./outage-timeline";
import { repairTime } from "@/lib/availability";
export const seconds = (v: number | null) =>
  v === null ? "N/A" : `${v.toFixed(3)} s`;
export function Results({ run }: { run: Run }) {
  const { config: c, summary: s } = run;
  const bins = useMemo(
    () =>
      s.histogram
        ? s.histogram.bins.map((b) => ({ ...b, center: (b.start + b.end) / 2 }))
        : histogram(s.response_times),
    [s.response_times, s.histogram],
  );
  const rows = useMemo(
    () =>
      Object.entries(s.per_server_utilization)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([id, u]) => ({
          id: Number(id),
          utilization: Math.round(u * 10000) / 100,
        })),
    [s.per_server_utilization],
  );
  const total = s.completed_count + s.rejected_count;
  const availability = s.per_server_availability;
  const outageCount = (id: number) => s.outages?.[String(id)]?.length ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Last completed run</Badge>
        <p className="caption">
          {c.server_count} servers · {c.arrival_rate} requests/s · {c.duration}{" "}
          s arrival window · seed {c.seed} · {policies[c.policy]}
        </p>
      </div>
      {c.request_model==="cpu_io"&&<p className="caption">CPU → I/O → CPU · {c.disk ? `Disk: ${(c.disk.read_fraction * 100).toFixed(0)}% reads at ${c.disk.read_ms} ms; writes at ${c.disk.write_ms} ms base${c.disk.write_size_kib ? ` plus ${c.disk.write_size_kib} KiB at ${c.disk.write_speed_mib_s ?? DEFAULT_WRITE_SPEED_MIB_S} MiB/s` : ""}` : c.io_heavy_probability!==undefined?`${(c.io_heavy_probability*100).toFixed(0)}% I/O-heavy requests`:`${((c.io_fraction??0)*100).toFixed(0)}% I/O share`} · {c.outstanding_limit} outstanding places per server · Mean CPU queue delay: {seconds(s.mean_cpu_queue_wait??null)}. Shared I/O: {c.io_capacity??64} operations at once. I/O releases CPU but retains admission capacity.</p>}
      <dl className="grid grid-cols-2 gap-6 border-y py-5 xl:grid-cols-4">
        {[
          ["Completed requests", s.completed_count.toLocaleString(), metricHelp.completed],
          ["Rejected requests", s.rejected_count.toLocaleString(), metricHelp.rejected],
          ...(s.retry_attempts === undefined ? [] : [
            ["Retry attempts", s.retry_attempts.toLocaleString(), "Additional attempts after rejection. Completed and rejected totals each count original requests once."],
          ]),
          ["Average response time", seconds(s.mean_response_time), metricHelp.mean],
          ["p95 response time", seconds(s.p95_response_time), metricHelp.p95],
        ].map(([label, value, description]) => (
          <div key={label}>
            <dt className="flex items-center gap-1 text-sm text-muted-foreground">
              {label}
              <ParameterHelp label={label} description={description} />
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {value}
            </dd>
            {label === "Rejected requests" && s.rejected_breakdown && (
              <dd data-testid="rejected-breakdown" className="mt-2">
                <p className="text-xs text-muted-foreground">
                  Why requests were rejected
                </p>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {(
                    [
                      [s.rejected_breakdown.no_server_up, "every server was down"],
                      [
                        s.rejected_breakdown.reroute_rejected,
                        "dropped when their server failed",
                      ],
                      [s.rejected_breakdown.queue_full, "queue full (overload)"],
                    ] as const
                  ).map(([count, text]) => (
                    <li key={text}>
                      <strong className="text-foreground tabular-nums">
                        {count.toLocaleString()}
                      </strong>{" "}
                      {text}
                    </li>
                  ))}
                </ul>
              </dd>
            )}
          </div>
        ))}
      </dl>
      {s.completed_count === 0 && (
        <Notice>No completed requests. Response times are unavailable.</Notice>
      )}
      <p className="caption">
        Response times include queue waiting and service, in simulated seconds.
      </p>
      {c.request_model==="cpu_io"&&<LatencyBreakdown metrics={s} disk={s.io_resource?.disk_completed}/>}
      <Tabs defaultValue="Overview" className="min-w-0">
        <TabsList>
          {["Overview", "Datacenter", "Server details"].map((t) => (
            <TabsTrigger key={t} value={t}>
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="Overview" className="mt-4 flex flex-col gap-5">
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Request outcomes</CardTitle>
                <CardDescription>
                  Did the available capacity keep up?
                </CardDescription>
              </CardHeader>
              <CardContent>
                {total ? (
                  <>
                    <OutcomeChart
                      completed={s.completed_count}
                      rejected={s.rejected_count}
                    />
                    <p className="caption mt-3">
                      {((s.rejected_count / total) * 100).toFixed(1)}% rejected
                      out of {total.toLocaleString()} requests.
                    </p>
                  </>
                ) : (
                  <p className="caption">
                    No requests were generated. Increase the rate or arrival
                    window.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Response time distribution</CardTitle>
                <CardDescription>
                  Completed requests, in simulated seconds.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {bins.length ? (
                  <>
                    <ResponseChart bins={bins} p95={s.p95_response_time} />
                    <p className="caption mt-3">
                      Each bar groups similar response times. The dashed line
                      marks p95.
                    </p>
                  </>
                ) : (
                  <p className="caption">
                    Run a simulation with completed requests to see the
                    distribution.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
          {availability && (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Server outages</CardTitle>
                <CardDescription>
                  How did random server failures affect this run?
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <dl className="grid grid-cols-2 gap-6 xl:grid-cols-3">
                  {[
                    [
                      "Re-routed requests",
                      Object.values(s.rerouted_by_server ?? {})
                        .reduce((n, m) => n + m.rerouted, 0)
                        .toLocaleString(),
                    ],
                    [
                      "Dropped by a failure",
                      Object.values(s.rerouted_by_server ?? {})
                        .reduce((n, m) => n + m.rejected, 0)
                        .toLocaleString(),
                    ],
                    [
                      "Outages",
                      rows
                        .reduce((n, r) => n + outageCount(r.id), 0)
                        .toLocaleString(),
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-sm text-muted-foreground">{label}</dt>
                      <dd className="mt-1 text-xl font-semibold tabular-nums">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <OutageTimeline
                  summary={s}
                  serverCount={c.server_count}
                  duration={c.duration}
                />
                <AvailabilityNote config={c} />
              </CardContent>
            </Card>
          )}
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Per-server utilization</CardTitle>
              <CardDescription>
                How evenly was work distributed?
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length ? (
                <UtilizationChart rows={rows} />
              ) : (
                <Notice>No server utilization data available.</Notice>
              )}
              <p className="caption mt-3">
                Occupied slots during the arrival window. Draining time is
                excluded; this is modeled utilization.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="Datacenter" className="mt-4">
          <Datacenter run={run} />
        </TabsContent>
        <TabsContent value="Server details" className="mt-4">
          <p className="caption mb-3">Values behind the utilization chart.</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Server ID</TableHead>
                <TableHead>Slot utilization (%)</TableHead>
                {availability && (
                  <>
                    <TableHead>Configured availability</TableHead>
                    <TableHead>MTTR (s)</TableHead>
                    <TableHead>Measured availability (%)</TableHead>
                    <TableHead>Outages</TableHead>
                    <TableHead>Re-routed</TableHead>
                    <TableHead>Dropped by failure</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.id}</TableCell>
                  <TableCell>{r.utilization.toFixed(2)}</TableCell>
                  {availability && (
                    <>
                      <TableCell>{c.availabilities?.[r.id] ?? 1}</TableCell>
                      <TableCell>{repairTime(c, r.id)}</TableCell>
                      <TableCell>
                        {((availability[String(r.id)] ?? 1) * 100).toFixed(2)}
                      </TableCell>
                      <TableCell>{outageCount(r.id)}</TableCell>
                      <TableCell>
                        {s.rerouted_by_server?.[String(r.id)]?.rerouted ?? 0}
                      </TableCell>
                      <TableCell>
                        {s.rerouted_by_server?.[String(r.id)]?.rejected ?? 0}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}
