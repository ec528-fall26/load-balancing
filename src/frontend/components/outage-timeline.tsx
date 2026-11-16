import type { Summary } from "@/lib/engine";
import {
  allDownTime,
  downIntervals,
  formatDuration,
  formatPercent,
} from "@/lib/availability";

const MAX_ROWS = 40;
const TICKS = [0, 0.25, 0.5, 0.75, 1];

/** One row per server: when it was down across the arrival window, % down, and re-routes. */
export function OutageTimeline({
  summary,
  serverCount,
  duration,
}: {
  summary: Summary;
  serverCount: number;
  duration: number;
}) {
  const outages = summary.outages ?? {};
  const availability = summary.per_server_availability ?? {};
  const reroutes = summary.rerouted_by_server ?? {};
  const allDown = allDownTime(outages, serverCount, duration);
  const servers = Array.from({ length: Math.min(serverCount, MAX_ROWS) }, (_, sid) => sid);
  // One grid for every row, so all tracks share the same width and scale.
  const grid =
    "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 sm:grid-flow-row-dense sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-y-2.5";
  return (
    <div className="flex flex-col gap-3" data-testid="outage-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Outages over the {formatDuration(duration)} arrival window
        </p>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="inline-block size-3 rounded-sm"
            style={{ background: "var(--chart-2)" }}
          />
          Server down
        </span>
      </div>
      <div className={grid}>
        {servers.map((sid) => {
          const intervals = downIntervals(outages[String(sid)] ?? [], duration);
          const down = 1 - (availability[String(sid)] ?? 1);
          const moved = reroutes[String(sid)] ?? { rerouted: 0, rejected: 0 };
          return (
            <div key={sid} className="contents">
              <span className="text-sm whitespace-nowrap tabular-nums">
                Server {sid}
              </span>
              <span className="text-right text-xs text-muted-foreground tabular-nums sm:col-start-3 sm:text-left">
                <strong className="text-sm text-foreground">
                  {formatPercent(down)}
                </strong>{" "}
                down · {moved.rerouted} re-routed
                {moved.rejected > 0 && ` · ${moved.rejected} dropped`}
              </span>
              <div
                role="img"
                aria-label={`Server ${sid}: down ${intervals.length} ${
                  intervals.length === 1 ? "time" : "times"
                }, ${formatPercent(down)} of the window; ${moved.rerouted} requests re-routed, ${moved.rejected} dropped`}
                className="relative col-span-2 h-4 overflow-hidden rounded-sm bg-muted sm:col-span-1 sm:col-start-2"
              >
                {intervals.map(([start, end]) => (
                  <span
                    key={start}
                    title={`Down ${start.toFixed(1)}–${end.toFixed(1)} s`}
                    className="absolute inset-y-0"
                    style={{
                      left: `${(start / duration) * 100}%`,
                      width: `${((end - start) / duration) * 100}%`,
                      minWidth: 2,
                      background: "var(--chart-2)",
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
        <div className="contents" aria-hidden>
          <div className="relative col-span-2 h-4 text-xs text-muted-foreground tabular-nums sm:col-span-1 sm:col-start-2">
            {TICKS.map((t) => (
              <span
                key={t}
                className="absolute top-0 whitespace-nowrap"
                style={{
                  left: `${t * 100}%`,
                  transform: `translateX(${t === 0 ? "0" : t === 1 ? "-100%" : "-50%"})`,
                }}
              >
                {formatDuration(t * duration)}
              </span>
            ))}
          </div>
        </div>
      </div>
      {serverCount > MAX_ROWS && (
        <p className="caption">
          Showing the first {MAX_ROWS} of {serverCount} servers. Every server is
          listed under Server details.
        </p>
      )}
      <p className="border-t pt-3 text-sm">
        All servers down at once:{" "}
        <strong className="tabular-nums">{formatDuration(allDown)}</strong>{" "}
        <span className="text-muted-foreground">
          ({formatPercent(allDown / duration)} of the window)
          {allDown === 0 && " — at least one server was always up to take requests."}
        </span>
      </p>
    </div>
  );
}
