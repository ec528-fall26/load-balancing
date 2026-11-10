"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
const config = {
  count: { label: "Requests", color: "var(--chart-1)" },
  utilization: { label: "Utilization (%)", color: "var(--chart-1)" },
} satisfies ChartConfig;
export function OutcomeChart({
  completed,
  rejected,
}: {
  completed: number;
  rejected: number;
}) {
  return (
    <ChartContainer
      config={config}
      className="chart h-60 w-full"
      role="img"
      aria-label="Completed and rejected request counts"
    >
      <BarChart
        accessibilityLayer
        data={[
          { name: "Completed", count: completed },
          { name: "Rejected", count: rejected },
        ]}
        layout="vertical"
        margin={{ left: 12, right: 20 }}
      >
        <CartesianGrid horizontal={false} />
        <XAxis type="number" allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={80}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar isAnimationActive={false} dataKey="count" radius={4}>
          <Cell fill="var(--chart-1)" />
          <Cell fill="var(--chart-2)" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
export type HistogramBin = {
  start: number;
  end: number;
  center: number;
  count: number;
};
export function histogram(values: number[], limit = 20): HistogramBin[] {
  if (!values.length) return [];
  let min = Infinity,
    max = -Infinity;
  for (const n of values) {
    min = Math.min(min, n);
    max = Math.max(max, n);
  }
  const count = min === max ? 1 : limit,
    width =
      min === max ? Math.max(0.001, Math.abs(min) * 0.01) : (max - min) / count;
  const bins = Array.from({ length: count }, (_, i) => ({
    start: min + i * width,
    end: min + (i + 1) * width,
    center: min + (i + 0.5) * width,
    count: 0,
  }));
  for (const n of values)
    bins[Math.min(count - 1, Math.floor((n - min) / width))].count++;
  return bins;
}
export function ResponseChart({
  bins,
  p95,
}: {
  bins: HistogramBin[];
  p95: number | null;
}) {
  return (
    <ChartContainer
      config={config}
      className="chart h-60 w-full"
      role="img"
      aria-label="Histogram of completed-request response times with a p95 reference line"
    >
      <BarChart accessibilityLayer data={bins} margin={{ left: 0, right: 18 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          type="number"
          dataKey="center"
          domain={[bins[0]?.start ?? 0, bins.at(-1)?.end ?? 1]}
          tickFormatter={(n) => Number(n).toFixed(2)}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          allowDecimals={false}
          width={36}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip
          labelFormatter={(_, payload) => {
            const b = payload[0]?.payload as HistogramBin | undefined;
            return b
              ? `${b.start.toFixed(3)}–${b.end.toFixed(3)} s`
              : "Response time";
          }}
          content={<ChartTooltipContent />}
        />
        <Bar
          isAnimationActive={false}
          dataKey="count"
          fill="var(--color-count)"
          radius={[3, 3, 0, 0]}
        />
        {p95 !== null && (
          <ReferenceLine
            x={p95}
            stroke="var(--chart-2)"
            strokeDasharray="5 4"
            label={{
              value: "p95",
              position: "insideTopRight",
              fill: "var(--chart-2)",
            }}
          />
        )}
      </BarChart>
    </ChartContainer>
  );
}
export function UtilizationChart({
  rows,
}: {
  rows: { id: number; utilization: number }[];
}) {
  const children = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="id" tickLine={false} axisLine={false} minTickGap={24} />
      <YAxis
        domain={[0, 100]}
        width={36}
        tickFormatter={(n) => `${n}%`}
        tickLine={false}
        axisLine={false}
      />
      <ChartTooltip
        labelFormatter={(v) => `Server ${v}`}
        content={<ChartTooltipContent />}
      />
    </>
  );
  return (
    <ChartContainer
      config={config}
      className="chart h-56 w-full"
      role="img"
      aria-label="Occupied slot percentage for each server during the arrival window"
    >
      {rows.length <= 40 ? (
        <BarChart accessibilityLayer data={rows}>
          {children}
          <Bar
            isAnimationActive={false}
            dataKey="utilization"
            fill="var(--color-utilization)"
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      ) : (
        <LineChart accessibilityLayer data={rows}>
          {children}
          <Line
            dataKey="utilization"
            stroke="var(--color-utilization)"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      )}
    </ChartContainer>
  );
}
