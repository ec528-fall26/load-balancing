"use client";
import { Inbox } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
export function TaskPool({
  total,
  running,
  waiting,
  completed,
  rejected,
  continuous = false,
  ioWaiting,
  ioActive,
  ioQueued,
}: {
  continuous?: boolean;
  ioWaiting?: number;
  ioActive?: number;
  ioQueued?: number;
  total: number;
  running: number;
  waiting: number;
  completed: number;
  rejected: number;
}) {
  const arrived = running + waiting + completed + rejected + (ioWaiting??0);
  const rows = [
    {
      label: "Not arrived",
      value: Math.max(0, total - arrived),
      color: "bg-muted",
      variant: "secondary" as const,
    },
    {
      label: ioWaiting!==undefined ? "CPU active" : "Running",
      value: running,
      color: "bg-executing",
      variant: "executing" as const,
    },
    {
      label: ioWaiting!==undefined ? "CPU queue" : "Waiting",
      value: waiting,
      color: "bg-waiting",
      variant: "waiting" as const,
    },
    ...(ioActive!==undefined&&ioQueued!==undefined ? [{label:"I/O in service",value:ioActive,color:"bg-chart-3",variant:"secondary" as const},{label:"I/O queue",value:ioQueued,color:"bg-chart-4",variant:"waiting" as const}] : ioWaiting!==undefined ? [{label:"I/O waiting",value:ioWaiting,color:"bg-chart-2",variant:"waiting" as const}] : []),
    {
      label: "Completed",
      value: completed,
      color: "bg-completed",
      variant: "completed" as const,
    },
    {
      label: "Rejected",
      value: rejected,
      color: "bg-destructive",
      variant: "destructive" as const,
    },
  ].filter((row) => !continuous || row.label !== "Not arrived");
  return (
    <Card className="min-w-0 xl:sticky xl:top-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Inbox className="size-4" />
          Task pool
        </CardTitle>
        <CardDescription>Across all servers</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div
          role="img"
          aria-label={`${continuous ? `${total} requests offered so far` : `${arrived} of ${total} requests arrived`}; ${running} running, ${waiting} waiting${ioWaiting!==undefined?`, ${ioWaiting} I/O waiting`:""}, ${completed} completed, ${rejected} rejected`}
          className="flex h-3 overflow-hidden rounded-sm bg-muted"
        >
          {rows
            .filter((r) => r.value > 0)
            .map((r) => (
              <span
                key={r.label}
                className={cn("h-full", r.color)}
                style={{ width: `${total ? (100 * r.value) / total : 0}%` }}
              />
            ))}
        </div>
        <dl className="flex flex-col gap-4">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-2"
            >
              <dt>
                <Badge variant={row.variant}>{row.label}</Badge>
              </dt>
              <dd className="font-semibold tabular-nums">
                {row.value.toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
        <p className="caption border-t pt-4">
          {continuous
            ? `${total.toLocaleString()} requests offered so far.`
            : `${arrived.toLocaleString()} arrived / ${total.toLocaleString()} total requests.`}
        </p>
      </CardContent>
    </Card>
  );
}
