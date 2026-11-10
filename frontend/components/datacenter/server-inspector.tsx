"use client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  CapacityCells,
  serverStatus,
  type ServerSnapshot,
} from "./server-node";
export function ServerInspector({
  server,
  now,
  averages,
  onClose,
  onRestoreFocus,
  live = false,
}: {
  live?: boolean;
  server: ServerSnapshot | undefined;
  now: number;
  averages: boolean;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const status = server && serverStatus(server);
  return (
    <Sheet
      open={!!server}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <SheetHeader>
          <SheetTitle>Server {server?.id} details</SheetTitle>
          <SheetDescription>
            {averages
              ? "Summary of the completed run."
              : `${live ? "Live snapshot" : "Recorded state"} at ${now.toFixed(1)} simulated seconds.`}
          </SheetDescription>
        </SheetHeader>
        {server && (
          <div className="flex flex-col gap-6 p-4 pt-0">
            <Badge variant={averages ? "secondary" : status?.variant}>
              {averages ? "Run average" : status?.label}
            </Badge>
            {!averages && (
              <>
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
              </>
            )}
            {server.ioWaiting!==undefined&&!averages&&<div className="flex flex-col gap-2"><p>{server.ioActive??server.ioWaiting} I/O calls in service · {server.ioQueued??0} in the shared I/O queue</p><p>{server.outstanding} / {server.outstandingLimit} outstanding</p><p className="text-sm text-muted-foreground">I/O wait releases CPU, but retains admission capacity.</p></div>}
            <dl className="flex flex-col gap-4">
              {[
                [
                  "Processing capacity",
                  `${server.slots.toLocaleString()} slots`,
                ],
                [
                  server.ioWaiting!==undefined ? "Outstanding admission cap" : "Queue capacity",
                  `${server.queueLimit.toLocaleString()} places`,
                ],
                ["Processing rate", `${server.processingRate}× baseline`],
                [
                  live
                    ? "Session-average utilization"
                    : "Run-average utilization",
                  `${(server.utilization * 100).toFixed(2)}%`,
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between gap-4 border-b pb-3"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="caption">
              {live
                ? "Session-average utilization covers occupied slots since the session started."
                : "Run-average utilization covers occupied slots during the arrival window; draining time is excluded."}{" "}
              Racks are display groups, not physical locations.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
