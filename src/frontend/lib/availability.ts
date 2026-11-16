import { validServerCount, type Config } from "./engine";

/*
 * Server availability A is the long-run fraction of time a server is up:
 * A = MTBF / (MTBF + MTTR). `availabilities` holds one A per server and
 * `mean_repair_time` the MTTR (shared or per server); MTBF follows from both.
 */

/** A one-shot config, or a continuous one (which has no arrival window). */
export type OutageConfig = Omit<Config, "duration"> & { duration?: number };

// Matches the Python default in lbsim/settings.py.
export const DEFAULT_REPAIR_TIME = 1;

/** Mean time between failures from availability: A = MTBF / (MTBF + MTTR). */
export function mtbf(availability: number, mttr: number): number {
  return availability >= 1 ? Infinity : (mttr * availability) / (1 - availability);
}

/** 0.9 → "90%", 0.0364 → "3.64%", without floating-point noise. */
export function formatPercent(fraction: number): string {
  return `${+(fraction * 100).toPrecision(3)}%`;
}

/** Mean time to recover for one server: a shared value or that server's own. */
export function repairTime(config: OutageConfig, sid = 0): number {
  const value = config.mean_repair_time ?? DEFAULT_REPAIR_TIME;
  return Array.isArray(value) ? value[sid] : value;
}

/** One shared repair time, or one per server separated by commas. */
export function parseRepairTimes(text: string): number | number[] | undefined {
  if (!text.trim()) return undefined;
  const values = text.split(",").map((v) => (v.trim() ? Number(v.trim()) : NaN));
  return values.length === 1 ? values[0] : values;
}

export function formatRepairTimes(value: number | number[] | undefined): string {
  if (value === undefined) return String(DEFAULT_REPAIR_TIME);
  return Array.isArray(value) ? formatAvailabilities(value) : String(value);
}

/** True when at least one server can go down. */
export function hasOutages(config: OutageConfig): boolean {
  return !!config.availabilities?.some((r) => r < 1);
}

/** Outages are modeled for the simple request model, one-shot or continuous. */
export function outagesSupported(config: OutageConfig): boolean {
  return config.request_model !== "cpu_io";
}

export function withoutOutages(config: Config): Config {
  const next = { ...config };
  delete next.availabilities;
  delete next.mean_repair_time;
  return next;
}

/** One value applies to every server; several values are one per server. */
export function parseAvailabilities(
  text: string,
  serverCount: number,
): number[] | undefined {
  if (!text.trim()) return undefined;
  const values = text.split(",").map((v) => (v.trim() ? Number(v.trim()) : NaN));
  return values.length === 1 && validServerCount(serverCount)
    ? Array(serverCount).fill(values[0])
    : values;
}

export function formatAvailabilities(values?: number[]): string {
  if (!values?.length) return "";
  return values.every((v) => v === values[0]) ? String(values[0]) : values.join(", ");
}

/** Keep a single shared availability in step with the server count. */
export function resizeAvailabilities(config: Config): Config {
  const values = config.availabilities;
  if (!validServerCount(config.server_count) || !values?.length ||
      !values.every((v) => v === values[0])) return config;
  return { ...config, availabilities: Array(config.server_count).fill(values[0]) };
}

export function availabilityError(config: OutageConfig): string | null {
  const values = config.availabilities;
  if (values) {
    if (values.some((v) => !Number.isFinite(v) || v <= 0 || v > 1))
      return "Each availability must be greater than 0 and at most 1.";
    if (values.length !== config.server_count)
      return `Enter one value for all servers or exactly ${config.server_count} values.`;
  }
  const repair = config.mean_repair_time ?? DEFAULT_REPAIR_TIME;
  const repairs = Array.isArray(repair) ? repair : [repair];
  if (repairs.some((v) => !Number.isFinite(v) || v <= 0))
    return "Each mean time to recover must be greater than zero.";
  if (Array.isArray(repair) && repair.length !== config.server_count)
    return `Enter one mean time to recover for all servers or exactly ${config.server_count} values.`;
  return null;
}

export type OutageGroup = {
  /** Configured availability (fraction of time up). */
  availability: number;
  servers: number[];
  mtbf: number;
  mttr: number;
  /** Expected outages per server during the arrival window; null without one. */
  expectedOutages: number | null;
};

/** One note per distinct (availability, MTTR) pair below 1, by availability then MTTR. */
export function availabilityNotes(config: OutageConfig): OutageGroup[] {
  if (availabilityError(config) || !hasOutages(config)) return [];
  const groups = new Map<string, { availability: number; mttr: number; servers: number[] }>();
  config.availabilities!.forEach((availability, sid) => {
    if (availability >= 1) return;
    const mttr = repairTime(config, sid);
    const key = `${availability}|${mttr}`;
    const group = groups.get(key) ?? { availability, mttr, servers: [] };
    group.servers.push(sid);
    groups.set(key, group);
  });
  return [...groups.values()]
    .sort((a, b) => a.availability - b.availability || a.mttr - b.mttr)
    .map(({ availability, mttr, servers }) => {
      const up = mtbf(availability, mttr);
      return {
        availability,
        servers,
        mtbf: up,
        mttr,
        expectedOutages:
          config.duration === undefined ? null : config.duration / (up + mttr),
      };
    });
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "never";
  if (seconds >= 3600) return `${+(seconds / 3600).toFixed(1)} h`;
  if (seconds >= 120) return `${+(seconds / 60).toFixed(1)} min`;
  return `${+seconds.toPrecision(3)} s`;
}

export function formatServers(servers: number[], total: number): string {
  if (servers.length === total) return "All servers";
  const contiguous = servers.every((s, i) => i === 0 || s === servers[i - 1] + 1);
  if (contiguous && servers.length > 2)
    return `Servers ${servers[0]}–${servers.at(-1)}`;
  return `${servers.length === 1 ? "Server" : "Servers"} ${servers.join(", ")}`;
}

export type Interval = [number, number];

/** Outage intervals clipped to the arrival window [0, duration]; empty ones dropped. */
export function downIntervals(intervals: Interval[], duration: number): Interval[] {
  return intervals
    .map(([start, end]): Interval => [Math.max(0, start), Math.min(end, duration)])
    .filter(([start, end]) => end > start);
}

/**
 * Seconds of the arrival window during which every server was down at once,
 * i.e. the whole service was unavailable. Each server's intervals do not overlap.
 */
export function allDownTime(
  outages: Record<string, Interval[]>,
  serverCount: number,
  duration: number,
): number {
  const servers = Array.from({ length: serverCount }, (_, sid) =>
    downIntervals(outages[String(sid)] ?? [], duration),
  );
  if (!serverCount || servers.some((intervals) => !intervals.length)) return 0;
  // Sweep: +1 when a server goes down, −1 when it recovers; ups sort first at ties.
  const changes = servers
    .flat()
    .flatMap(([start, end]): [number, number][] => [[start, 1], [end, -1]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let down = 0;
  let total = 0;
  let previous = 0;
  for (const [time, delta] of changes) {
    if (down === serverCount) total += time - previous;
    down += delta;
    previous = time;
  }
  return total;
}
