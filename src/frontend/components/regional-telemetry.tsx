"use client";
import type { RegionalSummary } from "@/lib/regions";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { CartesianGrid, LineChart, Line, XAxis, YAxis } from "recharts";
import { ResponseChart } from "@/components/chart";
import { Panel } from "@/components/surface";
import { seconds } from "@/components/results";
export function RegionalTelemetry({
  summary: s,
  oneShot = false,
}: {
  summary: RegionalSummary;
  oneShot?: boolean;
}) {
  return (
    <section
      aria-label="Regional results"
      className="flex min-w-0 flex-col gap-5"
    >
      <div>
        <h2 className="text-xl font-semibold">Regional datacenters</h2>
        <p className="caption">
          Aggregate compute pools; slots are pooled within each region. RTT
          assumptions are illustrative; load reports are immediate. No
          inter-region downstream calls or individual-server failures are
          modeled.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Object.entries(s.totals).map(([key, value]) => (
          <Card key={key}>
            <CardHeader>
              <CardDescription>{key.replace("_", " ")}</CardDescription>
              <CardTitle className="tabular-nums">
                {value.toLocaleString()}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <p className="caption" data-testid="regional-accounting">
        {s.totals.offered} offered = {s.totals.completed} completed +{" "}
        {s.totals.rejected} rejected + {s.totals.running} executing +{" "}
        {s.totals.waiting} waiting + {s.totals.in_transit} in transit.
      </p>
      <p className="caption">
        {oneShot
          ? `Arrival window: ${s.config.duration} s; arrivals stop before the cutoff, then all accepted work drains. Final sampled time: ${s.simulation_time.toFixed(2)} s.`
          : "Live telemetry includes outbound requests and returning responses in the in-transit count."}{" "}
        Mean response: {seconds(s.metrics.mean_response_time)} across all
        completions. Recent p95: {seconds(s.metrics.recent_p95_response_time)}{" "}
        across the latest {s.metrics.response_window_count} completions (maximum{" "}
        {s.metrics.response_window_limit}); latency excludes rejected requests.
      </p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {s.regions.map((r) => (
          <Card key={r.name} aria-label={`Region ${r.name}`}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle>{r.name}</CardTitle>
                <Badge
                  variant={
                    r.waiting
                      ? "waiting"
                      : r.running
                        ? "executing"
                        : "secondary"
                  }
                >
                  {r.waiting ? "Queued" : r.running ? "Executing" : "Idle"}
                </Badge>
              </div>
              <CardDescription>
                {r.compute}× compute · {r.slots} slots · {r.client_rtt_ms} ms
                client RTT
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Progress
                aria-label={`${r.name} CPU slot occupancy`}
                value={r.cpu_occupancy * 100}
              />
              <p className="caption">
                Modeled CPU occupancy: {(r.cpu_occupancy * 100).toFixed(1)}%
              </p>
              <dl className="grid grid-cols-2 gap-3">
                {[
                  ["Free slots", r.free_slots],
                  ["Executing", r.running],
                  ["Waiting", `${r.waiting} / ${r.queue_limit}`],
                  ["Outbound", r.outbound],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="caption">{k}</dt>
                    <dd className="font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="caption">
                Load averages (1 / 5 / 15 min):{" "}
                {r.load_averages.map((n) => n.toFixed(2)).join(" / ")}
              </p>
              <p className="caption">
                Recent p95: {seconds(r.recent_p95_response_time)} · latest{" "}
                {r.response_window_count} completions
              </p>
              <p className="caption">
                {r.completed.toLocaleString()} completed ·{" "}
                {r.rejected.toLocaleString()} rejected
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Regional load history</CardTitle>
            <CardDescription>
              Latest {s.history.length} samples, capped at 240. Older samples
              are discarded.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              className="h-56 w-full"
              config={{
                running: { label: "Executing", color: "var(--executing)" },
                waiting: { label: "Waiting", color: "var(--waiting)" },
                in_transit: { label: "In transit", color: "var(--chart-3)" },
              }}
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
                {["running", "waiting", "in_transit"].map((k) => (
                  <Line
                    key={k}
                    dataKey={k}
                    stroke={`var(--color-${k})`}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Recent response times</CardTitle>
            <CardDescription>
              At most 20 bins; latest completed-response window.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {s.histogram.bins.length ? (
              <ResponseChart
                bins={s.histogram.bins.map((b) => ({
                  ...b,
                  center: (b.start + b.end) / 2,
                }))}
                p95={s.metrics.recent_p95_response_time}
              />
            ) : (
              <p className="caption">Waiting for completed requests.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Panel title="Active regional configuration">
        <p className="caption">
          Policy: {s.config.policy}; source:{" "}
          {s.config.regions[s.config.source].name}. Regional RTT matrix below is
          an illustrative topology; client RTT is separately configured and
          drives the request/response travel. The engine splits each client RTT
          equally across both directions.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From / to (ms)</TableHead>
              {s.config.regions.map((r) => (
                <TableHead key={r.name}>{r.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.config.regions.map((r, i) => (
              <TableRow key={r.name}>
                <TableCell>{r.name}</TableCell>
                {s.config.latency_ms[i].map((v, j) => (
                  <TableCell key={j}>{v}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <pre>{JSON.stringify(s.config, null, 2)}</pre>
      </Panel>
    </section>
  );
}
