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
  ioWaiting?: number;
  ioActive?: number;
  ioQueued?: number;
  outstanding?: number;
  outstandingLimit?: number;
};
export function serverStatus(server: ServerSnapshot) {
  if(server.outstandingLimit!==undefined && (server.outstanding??0)>=server.outstandingLimit) return {label:"Admission full",variant:"destructive" as const};
  if (server.queued > 0 && server.queued >= server.queueLimit)
    return { label: "Queue full", variant: "destructive" as const };
  if (server.queued > 0)
    return { label: "Queued", variant: "waiting" as const };
  if (server.active >= server.slots)
    return { label: "Busy", variant: "executing" as const };
  if (server.active > 0)
    return { label: "Executing", variant: "executing" as const };
  if(server.ioWaiting) return {label:"I/O wait",variant:"waiting" as const};
  return { label: "Idle", variant: "secondary" as const };
}
export function CapacityCells({
  count,
  capacity,
  kind,
  label,
}: {
  count: number;
  capacity: number;
  kind: "executing" | "waiting";
  label?: string;
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
          {label ?? (kind === "executing" ? "Executing" : "Waiting")}
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
              label={server.ioWaiting!==undefined ? "CPU active" : undefined}
              capacity={server.slots}
              kind="executing"
            />
            {server.ioWaiting!==undefined ? <div className="flex flex-col gap-2"><div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Admission</span><span className="tabular-nums">{server.outstanding} / {server.outstandingLimit}</span></div><Progress value={100*(server.outstanding??0)/(server.outstandingLimit??1)} aria-label={`Server ${server.id} admission occupancy`}/></div> : <CapacityCells count={server.queued} capacity={server.queueLimit} kind="waiting"/>}
          </div>
        )}
        {!averages&&server.ioWaiting!==undefined&&<dl className="mt-3 grid grid-cols-3 gap-3 border-t pt-3 text-xs"><div><dt className="text-muted-foreground">CPU queue</dt><dd className="mt-1 font-medium tabular-nums">{server.queued}</dd></div><div><dt className="text-muted-foreground">I/O in service</dt><dd className="mt-1 font-medium tabular-nums">{server.ioActive??server.ioWaiting}</dd></div><div><dt className="text-muted-foreground">I/O queue</dt><dd className="mt-1 font-medium tabular-nums">{server.ioQueued??0}</dd></div></dl>}
      </div>
    </article>
  );
}
