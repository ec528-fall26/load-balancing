"use client";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Notice, Panel } from "@/components/surface";
import {
  changedSettings,
  settingLabel,
  settingValue,
  isRegional,
  metrics,
  type ComparisonRun,
} from "@/lib/comparison";
import { policies, type Config } from "@/lib/engine";
export type CompletedCase = { label: string; run: ComparisonRun };
const definitions = [
  { key: "completed", label: "Completed requests", unit: "count" },
  { key: "rejected", label: "Rejected requests", unit: "count" },
  { key: "mean", label: "Mean response time", unit: "seconds" },
  { key: "p95", label: "p95 response time", unit: "seconds" },
  { key: "rejection", label: "Rejection rate", unit: "percent" },
  { key: "utilization", label: "Mean slot utilization", unit: "percent" },
] as const;
function value(n: number | null, unit: string, delta = false) {
  if (n === null) return "N/A";
  const prefix = delta && n > 0 ? "+" : "";
  return (
    prefix +
    (unit === "count"
      ? n.toLocaleString()
      : n.toFixed(unit === "seconds" ? 3 : 1)) +
    (unit === "seconds"
      ? " s"
      : unit === "percent"
        ? delta
          ? " pp"
          : "%"
        : "")
  );
}
export function ComparisonResults({ cases }: { cases: CompletedCase[] }) {
  const base = cases[0].run.config,
    rows = cases.map((c) => ({ name: c.label, ...metrics(c.run) })),
    baseline = rows[0];
  const regional = isRegional(base);
  const visibleDefinitions = regional
    ? definitions.filter((m) => m.key !== "utilization")
    : definitions;
  const changed = [
    ...new Set(
      cases.slice(1).flatMap((c) => changedSettings(base, c.run.config)),
    ),
  ];
  const chartConfig = {
    completed: { label: "Completed", color: "var(--chart-1)" },
    rejected: { label: "Rejected", color: "var(--chart-2)" },
    mean: { label: "Mean (s)", color: "var(--chart-1)" },
    p95: {
      label: regional ? "Recent p95 (s)" : "p95 (s)",
      color: "var(--chart-2)",
    },
  };
  return (
    <section aria-label="Comparison results" className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">Last completed comparison</h2>
        <p className="caption mt-1">
          Each case was run through Python. Deltas are relative to the baseline;
          edited settings above do not change these results.
        </p>
      </div>
      <Notice>
        {changed.some((key) => key !== "policy")
          ? "Inputs other than routing policy differ. These deltas reflect all listed changes, not an isolated policy effect."
          : "Only the routing policy differs. Workload, capacity, service times and seed match."}{" "}
        These are single seeded runs, not statistical estimates.
        {regional &&
          " Regional means include all completions; each p95 uses only that case’s latest 2,000 completions. Regional compute is pooled and RTT assumptions are illustrative."}
      </Notice>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            {cases.map((c) => (
              <TableHead key={c.label}>{c.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleDefinitions.map((metric) => (
            <TableRow key={metric.key}>
              <TableCell>
                {regional && metric.key === "p95"
                  ? "Recent-window p95 response time"
                  : metric.label}
              </TableCell>
              {rows.map((row, i) => (
                <TableCell key={row.name} className="tabular-nums">
                  <div>{value(row[metric.key], metric.unit)}</div>
                  {i > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Δ{" "}
                      {value(
                        row[metric.key] === null ||
                          baseline[metric.key] === null
                          ? null
                          : row[metric.key]! - baseline[metric.key]!,
                        metric.unit,
                        true,
                      )}
                    </div>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Request outcomes</CardTitle>
            <CardDescription>
              Completed and rejected requests for each case.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <BarChart accessibilityLayer data={rows}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis width={46} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  dataKey="completed"
                  stackId="outcomes"
                  fill="var(--color-completed)"
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="rejected"
                  stackId="outcomes"
                  fill="var(--color-rejected)"
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Response times</CardTitle>
            <CardDescription>
              Completed requests only, including queue waiting and draining.{" "}
              {regional &&
                "Regional latency also includes client RTT. p95 uses the recent response window, not the entire run."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <BarChart accessibilityLayer data={rows}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis width={46} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  dataKey="mean"
                  fill="var(--color-mean)"
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="p95"
                  fill="var(--color-p95)"
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
      <div>
        <h3 className="mb-3 font-semibold">Changed settings</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Setting</TableHead>
              {cases.map((c) => (
                <TableHead key={c.label}>{c.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {changed.map((key) => (
              <TableRow key={key}>
                <TableCell>{settingLabel(base, key)}</TableCell>
                {cases.map((c) => (
                  <TableCell key={c.label}>
                    {settingValue(c.run.config, key)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="caption">
        {regional
          ? `Regional p95 sample counts: ${cases.map((c) => `${c.label}: ${c.run.response_window_count ?? 0}`).join("; ")}. `
          : "Utilization averages server slot occupancy during the arrival window, excluding draining. "}{" "}
        pp = percentage points. N/A means the metric is undefined for that run.
      </p>
      <Panel title="Full compared configurations">
        <pre>
          {JSON.stringify(
            cases.map((c) => ({ case: c.label, config: c.run.config })),
            null,
            2,
          )}
        </pre>
      </Panel>
    </section>
  );
}
