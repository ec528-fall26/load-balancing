import {
  type OutageConfig,
  formatDuration,
  formatPercent,
  formatServers,
  availabilityNotes,
} from "@/lib/availability";
import { Notice } from "@/components/surface";

/** Explains the MTBF and MTTR implied by each availability. */
export function AvailabilityNote({ config }: { config: OutageConfig }) {
  const notes = availabilityNotes(config);
  if (!notes.length) return null;
  return (
    <Notice role="status">
      <div className="flex flex-col gap-2" data-testid="availability-note">
        <ul className="flex flex-col gap-1.5">
          {notes.map((n) => (
            <li className="" key={`${n.availability}-${n.mttr}`}>
              <span className="font-medium text-foreground">
                {formatServers(n.servers, config.server_count)} - {" "}
                {formatPercent(n.availability)} availability
              </span>
              : up for about an avg <strong>{formatDuration(n.mtbf)}</strong> between
              failures (MTBF), down about{" "}
              <strong>{formatDuration(n.mttr)}</strong> per failure (MTTR), so
              about {formatPercent(1 - n.availability)} downtime.
              {n.expectedOutages !== null && config.duration !== undefined && (
                <>
                  {" "}Expected failures in {formatDuration(config.duration)} arrival window:{" "}
                  <strong>{+n.expectedOutages.toFixed(1)}</strong>.
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Notice>
  );
}
