export const fanoutFields = [
  { name: "rate", label: "Parents per second", min: 1, max: 200, initial: 50 },
  {
    name: "duration",
    label: "Arrival window (s)",
    min: 1,
    max: 10,
    initial: 4,
  },
  {
    name: "deadline_ms",
    label: "Parent deadline (ms)",
    min: 10,
    max: 2000,
    initial: 200,
  },
  {
    name: "rtt_ms",
    label: "Shard round trip (ms)",
    min: 0,
    max: 200,
    initial: 4,
  },
  { name: "slow_shard", label: "Slow shard (0–3)", min: 0, max: 3, initial: 0 },
  {
    name: "slowdown",
    label: "Shard CPU slowdown (×)",
    min: 1,
    max: 20,
    initial: 4,
  },
  {
    name: "outage_ms",
    label: "Seeded outage duration (ms)",
    min: 0,
    max: 1000,
    initial: 0,
  },
  { name: "seed", label: "Seed", min: 0, max: 1_000_000, initial: 42 },
  {
    name: "inspect",
    label: "Request to inspect (zero-based)",
    min: 0,
    max: 1999,
    initial: 0,
  },
] as const;

type FieldName = (typeof fanoutFields)[number]["name"];
export type FanoutSettings = Record<FieldName, number>;
export type ShardedConfig = FanoutSettings & {
  topology: "sharded";
  width: 1 | 2 | 4;
};

export const fanoutDefaults = Object.fromEntries(
  fanoutFields.map(({ name, initial }) => [name, initial]),
) as FanoutSettings;

export const shardedDefaults: ShardedConfig = {
  ...fanoutDefaults,
  topology: "sharded",
  width: 4,
};

export function isShardedConfig(value: unknown): value is ShardedConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as ShardedConfig;
  return (
    config.topology === "sharded" &&
    [1, 2, 4].includes(config.width) &&
    fanoutFields.every(
      ({ name, min, max }) =>
        Number.isInteger(config[name]) &&
        config[name] >= min &&
        config[name] <= max,
    ) &&
    config.inspect < config.rate * config.duration
  );
}

export function fanoutCompareHref(config: FanoutSettings) {
  const query = new URLSearchParams({ fanout: "1" });
  for (const { name } of fanoutFields) query.set(name, String(config[name]));
  return `/compare?${query}`;
}

export function fanoutSettingsFromQuery(
  query: Pick<URLSearchParams, "get">,
): FanoutSettings {
  return Object.fromEntries(
    fanoutFields.map(({ name, min, max, initial }) => {
      const raw = query.get(name);
      const value = raw === null ? initial : Number(raw);
      return [
        name,
        Number.isInteger(value) && value >= min && value <= max
          ? value
          : initial,
      ];
    }),
  ) as FanoutSettings;
}

export type FanoutCase = {
  width: number;
  condition: string;
  offered: number;
  completed: number;
  timed_out: number;
  outage_failed: number;
  outage: { shard: number; start_ms: number; end_ms: number } | null;
  shard_rejected: number;
  coordinator_rejected: number;
  mean_ms: number | null;
  p95_ms: number | null;
  backend_ms_per_success: number | null;
  wasted_backend_ms: number;
  coordinator_peak_queue: number;
  shards: {
    id: number;
    sent: number;
    completed: number;
    rejected: number;
    outage_failed: number;
    peak_cpu_queue: number;
    peak_io_queue: number;
  }[];
  inspected: {
    id: number;
    status: string;
    critical_shard: number | null;
    unanswered_shards: number[];
    events: { at_us: number; phase: string; shard: number | null }[];
  };
};

export type FanoutRun = {
  result: FanoutCase;
  offered_backend_demand_ms: number;
};
export type FanoutExperiment = {
  cases: FanoutCase[];
  offered_backend_demand_ms: number;
};

export async function fanoutRequest<T>(
  path: "/api/fan-out/run" | "/api/research/fan-out",
  config: FanoutSettings,
) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? "The sharded service run failed.");
  return data as T;
}
