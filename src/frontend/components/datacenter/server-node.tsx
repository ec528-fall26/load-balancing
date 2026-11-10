"use client";
import type { CSSProperties } from "react";
import { Cpu, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
export type ServerSnapshot = {
  id: string;
  active: number;
  queued: number;
  utilization: number;
  slots: number;
  queueLimit: number;
  processingRate: number;
};
export function serverStatus(server: ServerSnapshot) {
  if (server.queued > 0 && server.queued >= server.queueLimit)
    return { label: "Queue full", variant: "destructive" as const };
  if (server.queued > 0)
    return { label: "Queued", variant: "waiting" as const };
  if (server.active >= server.slots)
    return { label: "Busy", variant: "executing" as const };
  if (server.active > 0)
    return { label: "Executing", variant: "executing" as const };
  return { label: "Idle", variant: "secondary" as const };
}
export function CapacityCells({
  count,
  capacity,
  kind,
}: {
  count: number;
  capacity: number;
  kind: "executing" | "waiting";
}) {
  const groupSize = Math.max(1, Math.ceil(capacity / 16));
  const cells = Array.from(
    { length: Math.ceil(capacity / groupSize) },
    (_, i) => {
      const size = Math.min(groupSize, capacity - i * groupSize);
      return Math.max(0, Math.min(1, (count - i * groupSize) / size));
    },
  );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {kind === "executing" ? "Executing" : "Waiting"}
        </span>
        <span className="font-medium tabular-nums">
          {count.toLocaleString()} / {capacity.toLocaleString()}
        </span>
      </div>
      {capacity ? (
        <div
          role="img"
          aria-label={`${count} of ${capacity} ${kind === "executing" ? "execution slots occupied" : "waiting places occupied"}`}
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`,
          }}
        >
          {cells.map((fill, i) => (
            <span
              key={i}
              data-kind={kind}
              className="dc-capacity-cell"
              style={{ "--cell-fill": `${fill * 100}%` } as CSSProperties}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No waiting queue</p>
      )}
      {capacity > 16 && (
        <p className="text-xs text-muted-foreground">
          Up to {groupSize.toLocaleString()} per cell
        </p>
      )}
    </div>
  );
}
export function ServerNode({
  server,
  averages,
  onInspect,
}: {
  server: ServerSnapshot;
  averages: boolean;
  onInspect: () => void;
}) {
  const status = serverStatus(server);
  return (
    <article
      aria-label={`Server ${server.id} visualization`}
      className="min-w-0 rounded-md border bg-background"
    >
      <Button
        variant="ghost"
        className="h-auto w-full justify-between gap-2 rounded-b-none px-3 py-2.5"
        onClick={onInspect}
        aria-label={`Inspect server ${server.id}`}
      >
        <span className="flex items-center gap-2">
          <Cpu data-icon="inline-start" />
          <span>Server {server.id}</span>
        </span>
        <span className="flex items-center gap-2">
          <Badge variant={averages ? "secondary" : status.variant}>
            {averages ? "Run average" : status.label}
          </Badge>
          <ChevronRight data-icon="inline-end" />
        </span>
      </Button>
      <div className="px-3 pb-3">
        {averages ? (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between gap-3 text-xs">
              <span className="text-muted-foreground">Average utilization</span>
              <span className="font-medium tabular-nums">
                {(server.utilization * 100).toFixed(1)}%
              </span>
            </div>
            <Progress
              value={server.utilization * 100}
              role="meter"
              aria-label={`Server ${server.id} slot utilization`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={server.utilization * 100}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <CapacityCells
              count={server.active}
              capacity={server.slots}
              kind="executing"
            />
            <CapacityCells
              count={server.queued}
              capacity={server.queueLimit}
              kind="waiting"
            />
          </div>
        )}
      </div>
    </article>
  );
}
