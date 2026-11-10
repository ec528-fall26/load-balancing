import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  FanoutEventTable,
  ShardOutageSummary,
} from "@/components/fanout-results";
import { Panel } from "@/components/surface";
import type { FanoutRun, ShardedConfig } from "@/lib/fanout";

const outcomes: Record<string, string> = {
  completed: "Completed on time",
  timed_out: "Missed the deadline",
  outage_failed: "Failed because a shard went offline",
  coordinator_rejected: "Rejected by the coordinator",
  shard_rejected: "Rejected by a shard",
};

function elapsed(ms: number | null | undefined) {
  return ms == null ? "—" : `${ms.toFixed(2)} ms`;
}

export function ShardedRunResults({
  run,
  config,
}: {
  run: FanoutRun;
  config: ShardedConfig;
}) {
  const result = run.result;
  const trace = result.inspected;
  const totalCalls = result.shards.reduce((sum, shard) => sum + shard.sent, 0);
  const terminalIndex = trace.events.findIndex(
    (event) => event.shard === null && event.phase === trace.status,
  );
  const parentEvents = trace.events.slice(0, terminalIndex + 1);
  const dispatches = parentEvents.filter(
    (event) => event.phase === "request_sent",
  );
  const replies = parentEvents.filter(
    (event) => event.phase === "reply_received",
  );
  const ended = trace.events[terminalIndex];
  const outcome = outcomes[trace.status];
  const dispatch = dispatches[0];
  const lastReply = replies.at(-1);
  const metrics = [
    [
      "Completed on time",
      `${result.completed.toLocaleString()} / ${result.offered.toLocaleString()}`,
    ],
    ["Timed out", result.timed_out.toLocaleString()],
    [
      "Rejected",
      (result.shard_rejected + result.coordinator_rejected).toLocaleString(),
    ],
    ...(result.outage
      ? [["Outage failures", result.outage_failed.toLocaleString()]]
      : []),
    ["P95 response time", elapsed(result.p95_ms)],
  ];

  return (
    <>
      <section
        aria-labelledby="sharded-outcomes"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">One-shot run</Badge>
          <p className="caption">
            {config.width} {config.width === 1 ? "shard call" : "shard calls"}{" "}
            per request · {config.rate} requests/s for {config.duration}s ·{" "}
            {config.rtt_ms} ms network round trip · seed {config.seed}
          </p>
        </div>
        <h2 id="sharded-outcomes" className="text-lg font-semibold">
          Did requests finish on time?
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 border-y py-4 md:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="caption">
          {result.mean_ms != null &&
            `Average response time was ${elapsed(result.mean_ms)}. `}
          {result.completed
            ? "P95 is the time within which 95% of successful requests finished."
            : "No requests completed on time, so response times are unavailable."}{" "}
          The deadline was {config.deadline_ms} ms per request.
        </p>
        {result.outage && <ShardOutageSummary outage={result.outage} />}
      </section>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Where did the work go?
          </CardTitle>
          <CardDescription>
            {totalCalls.toLocaleString()} shard calls. Each bar shows the
            shard’s share of all calls. Queue peaks show the most calls waiting
            for CPU or I/O at one time.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {result.shards.map((shard) => {
            const slow = config.slowdown > 1 && config.slow_shard === shard.id;
            const share = totalCalls ? (100 * shard.sent) / totalCalls : 0;
            return (
              <section
                key={shard.id}
                className="flex min-w-0 flex-col gap-2 border-t pt-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">Shard {shard.id}</h3>
                  {slow && (
                    <Badge variant="waiting">{config.slowdown}× CPU time</Badge>
                  )}
                </div>
                <p className="text-sm tabular-nums">
                  {shard.sent.toLocaleString()} calls · {share.toFixed(1)}%
                </p>
                <Progress
                  aria-label={`Shard ${shard.id} share of calls`}
                  value={share}
                  className="motion-reduce:[&>*]:transition-none"
                />
                <p className="caption tabular-nums">
                  Peak waiting · CPU {shard.peak_cpu_queue} · I/O{" "}
                  {shard.peak_io_queue}
                </p>
                <p className="caption tabular-nums">
                  {shard.completed.toLocaleString()} finished ·{" "}
                  {shard.rejected.toLocaleString()} rejected
                  {result.outage &&
                    ` · ${shard.outage_failed.toLocaleString()} outage failures`}
                </p>
              </section>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Follow request {trace.id}
          </CardTitle>
          <CardDescription>
            {outcome} at {elapsed(ended.at_us / 1000)}.
            {trace.critical_shard !== null &&
              ` Shard ${trace.critical_shard} provided the last required reply.`}
            {trace.unanswered_shards.length > 0 &&
              ` Still waiting on ${trace.unanswered_shards.map((shard) => `shard ${shard}`).join(", ")} when the request ended.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Arrived", "The coordinator receives the request.", 0],
              [
                "Sent to shards",
                dispatches.length
                  ? dispatches.map((event) => `Shard ${event.shard}`).join(", ")
                  : "No shard calls were sent.",
                dispatch?.at_us,
              ],
              [
                "Waited for replies",
                dispatches.length
                  ? `${replies.length} of ${dispatches.length} successful replies before the request ended.`
                  : "No replies expected.",
                lastReply?.at_us,
              ],
              ["Request ended", outcome, ended.at_us],
            ].map(([stage, detail, at]) => (
              <li key={stage} className="border-t pt-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <h3 className="text-sm font-semibold">{stage}</h3>
                  {typeof at === "number" && (
                    <span className="caption tabular-nums">
                      {elapsed(at / 1000)}
                    </span>
                  )}
                </div>
                <p className="caption mt-1">{detail}</p>
              </li>
            ))}
          </ol>
          <Panel title="Full event timeline">
            <p className="caption mb-3">
              Times are relative to arrival. Shards can keep processing calls
              after the parent request ends.
            </p>
            <FanoutEventTable events={trace.events} />
          </Panel>
        </CardContent>
      </Card>

      <Panel title="More run details">
        <p className="caption">
          Peak coordinator CPU queue {result.coordinator_peak_queue} ·{" "}
          {result.coordinator_rejected} coordinator rejections ·{" "}
          {result.shard_rejected} shard rejections
        </p>
        <p className="caption mt-2">
          {elapsed(run.offered_backend_demand_ms)} nominal backend work offered
          · {elapsed(result.backend_ms_per_success)} backend work per successful
          request · {elapsed(result.wasted_backend_ms)} backend work on failed
          requests
        </p>
      </Panel>
    </>
  );
}
