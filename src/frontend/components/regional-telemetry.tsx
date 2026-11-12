"use client";
import type { RegionalSummary } from "@/lib/regions";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
const migrationReasons = {
  outage: "Home outage",
  overload: "Home overloaded",
  recovery: "Home recovered",
  destination_unavailable: "Backup unavailable",
};

function ClientTraffic({ summary }: { summary: RegionalSummary }) {
  const rows = summary.client_traffic;
  const changes = summary.client_migration_events ?? [];
  if (!rows) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client traffic by region</CardTitle>
        <CardDescription>
          Routed counts cover the last complete simulated second. Preferred
          shifts move a share of new requests. Other requests can still fail
          over when home is offline or full.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client origin</TableHead>
              <TableHead className="text-right">Target req/s</TableHead>
              <TableHead>Preferred shift</TableHead>
              {summary.regions.map((region) => (
                <TableHead key={region.name} className="text-right">
                  To {region.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.origin}>
                <TableCell className="font-medium">{summary.regions[row.origin].name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.configured_rps.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </TableCell>
                <TableCell>
                  {row.destination === null ? "Home" : (
                    <Badge variant="secondary">
                      {Math.round(row.shifted_fraction * 100)}% to {summary.regions[row.destination].name}
                    </Badge>
                  )}
                </TableCell>
                {row.routed_per_second.map((count, i) => (
                  <TableCell key={i} className={`text-right tabular-nums ${count && i !== row.origin ? "font-semibold" : ""}`}>
                    {count.toLocaleString()}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {changes.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Recent shifts</h3>
            <ol className="flex flex-col gap-1.5">
              {changes.slice(-8).reverse().map((event) => (
                <li key={`${event.simulation_time}-${event.origin}`} className="text-sm text-muted-foreground">
                  <span className="mr-2 tabular-nums">{event.simulation_time}s</span>
                  <span className="font-medium text-foreground">{summary.regions[event.origin].name}</span>
                  {" · "}{migrationReasons[event.reason]}{" · "}
                  {event.destination === null
                    ? event.reason === "recovery" ? "Home preference restored" : "Backup preference cleared"
                    : `${Math.round(event.shifted_fraction * 100)}% to ${summary.regions[event.destination].name}`}
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RegionalTelemetry({
  summary: s,
  oneShot = false,
  onRegionChange,
  controlsBusy = false,
}: {
  summary: RegionalSummary;
  oneShot?: boolean;
  onRegionChange?: (index: number, online: boolean) => void;
  controlsBusy?: boolean;
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
      <ClientTraffic summary={s} />
      <div className="grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {s.regions.map((r, index) => (
          <Card key={r.name} aria-label={`Region ${r.name}`}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle>{r.name}</CardTitle>
                <Badge
                  variant={
                    r.online === false
                      ? "destructive"
                      : r.waiting
                      ? "waiting"
                      : r.running
                        ? "executing"
                        : "secondary"
                  }
                >
                  {r.online === false ? "Offline" : r.waiting ? "Queued" : r.running ? "Executing" : "Idle"}
                </Badge>
              </div>
              <CardDescription>
                {r.compute}× compute · {r.slots} slots
                {!s.client_traffic && ` · ${r.client_rtt_ms} ms client RTT`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {onRegionChange && r.online !== undefined && (
                <Button
                  variant={r.online ? "outline" : "secondary"}
                  size="sm"
                  className="self-start"
                  disabled={controlsBusy}
                  aria-label={r.online ? `Take ${r.name} offline` : `Restore ${r.name}`}
                  onClick={() => onRegionChange(index, !r.online)}
                >
                  {r.online ? "Take offline" : "Restore"}
                </Button>
              )}
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
          {s.client_traffic
            ? `Fallback policy: ${s.config.policy}. Each client origin uses its row in the RTT matrix for dispatch and response.`
            : `Policy: ${s.config.policy}. Source: ${s.config.regions[s.config.source].name}. Configured client RTT drives request and response travel.`}
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
