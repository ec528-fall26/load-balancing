import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
export function ResourcePressure(p: {
  cpuActive: number;
  cpuSlots: number;
  cpuQueued: number;
  outstanding: number;
  admissionSlots: number;
  ioActive: number;
  ioQueued: number;
  ioCapacity: number;
}) {
  const title =
    p.ioQueued > 0
      ? "Shared I/O is limiting progress"
      : p.cpuQueued > 0
        ? "Requests are waiting for CPU"
        : p.outstanding >= p.admissionSlots
          ? "Admission capacity is full"
          : "Capacity is available";
  const description =
    p.ioQueued > 0
      ? `${p.ioActive} of ${p.ioCapacity} shared I/O operations are busy; ${p.ioQueued} requests are queued at the dependency. Adding server CPUs will not remove this shared bottleneck.`
      : p.cpuQueued > 0
        ? `${p.cpuQueued} requests are ready to run but need a CPU slot.`
        : p.outstanding >= p.admissionSlots
          ? "New arrivals will be rejected until a request completes. I/O wait still occupies admission capacity."
          : "This is the current state, not a guarantee that future requests will avoid queueing.";
  return (
    <section aria-label="Resource pressure" className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            label: "Server CPUs",
            value: p.cpuActive,
            max: p.cpuSlots,
            note: `${p.cpuQueued} in CPU queue`,
          },
          {
            label: "Shared I/O",
            value: p.ioActive,
            max: p.ioCapacity,
            note: `${p.ioQueued} in I/O queue`,
          },
          {
            label: "Unfinished requests",
            value: p.outstanding,
            max: p.admissionSlots,
            note: "Admission limit across servers",
          },
        ].map((r) => (
          <div key={r.label} className="flex flex-col gap-2">
            <div className="flex justify-between gap-2 text-sm">
              <span>{r.label}</span>
              <span className="tabular-nums">
                {r.value} / {r.max}
              </span>
            </div>
            <Progress
              value={(100 * r.value) / r.max}
              aria-label={`${r.label} occupancy`}
            />
            <p className="text-xs text-muted-foreground">{r.note}</p>
          </div>
        ))}
      </div>
      <Alert>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
    </section>
  );
}
