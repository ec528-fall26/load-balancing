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
}: {
  continuous?: boolean;
  total: number;
  running: number;
  waiting: number;
  completed: number;
  rejected: number;
}) {
  const arrived = running + waiting + completed + rejected;
  const rows = [
    {
      label: "Not arrived",
      value: Math.max(0, total - arrived),
      color: "bg-muted",
      variant: "secondary" as const,
    },
    {
      label: "Running",
      value: running,
      color: "bg-executing",
      variant: "executing" as const,
    },
    {
      label: "Waiting",
      value: waiting,
      color: "bg-waiting",
      variant: "waiting" as const,
    },
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
          aria-label={`${continuous ? `${total} requests offered so far` : `${arrived} of ${total} requests arrived`}; ${running} running, ${waiting} waiting, ${completed} completed, ${rejected} rejected`}
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
