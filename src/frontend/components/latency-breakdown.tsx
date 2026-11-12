"use client";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
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
type Metrics = {
  mean_cpu_service_time?: number | null;
  mean_cpu_queue_wait?: number | null;
  mean_io_service_time?: number | null;
  mean_io_queue_wait?: number | null;
};
const config = {
  cpu: { label: "CPU work", color: "var(--chart-1)" },
  cpuQueue: { label: "CPU queue", color: "var(--chart-2)" },
  io: { label: "I/O service", color: "var(--chart-3)" },
  ioQueue: { label: "I/O queue", color: "var(--chart-4)" },
};
export function LatencyBreakdown({ metrics }: { metrics: Metrics }) {
  const values = {
    cpu: metrics.mean_cpu_service_time,
    cpuQueue: metrics.mean_cpu_queue_wait,
    io: metrics.mean_io_service_time,
    ioQueue: metrics.mean_io_queue_wait,
  };
  if (metrics.mean_cpu_service_time == null) return null;
  const row = {
    name: "Mean response",
    ...Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, (v ?? 0) * 1000]),
    ),
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where response time went</CardTitle>
        <CardDescription>
          Mean across completed requests, including draining. Read alongside
          rejected requests.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ChartContainer
          config={config}
          className="h-14 w-full"
          aria-label="Mean response time split into CPU work, CPU queue, I/O service and I/O queue"
        >
          <BarChart accessibilityLayer data={[row]} layout="vertical">
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" hide />
            <ChartTooltip content={<ChartTooltipContent />} />
            {Object.entries(config).map(([key, c]) => (
              <Bar
                key={key}
                stackId="time"
                dataKey={key}
                fill={c.color}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ChartContainer>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(config).map(([key, c]) => (
            <div key={key}>
              <dt className="text-xs text-muted-foreground">{c.label}</dt>
              <dd className="mt-1 font-medium tabular-nums">
                {((values[key as keyof typeof values] ?? 0) * 1000).toFixed(1)}{" "}
                ms
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
