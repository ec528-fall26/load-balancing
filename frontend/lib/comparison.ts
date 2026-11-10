import { policies } from "./engine";
import type { Config, Run } from "./engine";
import type { RegionalConfig, RegionalRun } from "./regions";
import { validConfig } from "./saved-setups";
export type CompareConfig = Config | (RegionalConfig & { duration: number });
export const isRegional = (
  config: CompareConfig,
): config is RegionalConfig & { duration: number } =>
  "topology" in config && config.topology === "regions";
export const COMPARE_DRAFT_KEY = "lbsim.compare-draft.v1";
export const configLabels: Record<keyof Config, string> = {
  server_count: "Server count",
  concurrency: "Slots per server",
  queue_limit: "Queue per server",
  arrival_rate: "Requests per second",
  duration: "Arrival window",
  service_min: "Minimum service time",
  service_max: "Maximum service time",
  seed: "Random seed",
  policy: "Routing policy",
  processing_rates: "Processing rates",
  request_model: "Request model",
  io_fraction: "I/O share",
  outstanding_limit: "Outstanding limit per server",
  io_capacity: "Shared I/O concurrency",
  io_heavy_probability: "I/O-heavy request fraction",
};
export type Setting = {
  key: string;
  label: string;
  group: string;
  value: string | number | number[] | undefined;
  step?: number;
  options?: Record<string, string>;
};
export function settings(config: CompareConfig): Setting[] {
  const regional = isRegional(config);
  const common: Setting[] = [
    {
      key: "arrival_rate",
      label: "Requests per second",
      group: "Traffic",
      value: config.arrival_rate,
      step: 0.01,
    },
    {
      key: "duration",
      label: "Arrival window",
      group: "Traffic",
      value: config.duration,
      step: 0.01,
    },
    {
      key: "service_min",
      label: "Minimum service time",
      group: "Workload",
      value: config.service_min,
      step: 0.001,
    },
    {
      key: "service_max",
      label: "Maximum service time",
      group: "Workload",
      value: config.service_max,
      step: 0.001,
    },
    {
      key: "seed",
      label: "Random seed",
      group: "Workload",
      value: config.seed,
      step: 1,
    },
    {
      key: "policy",
      label: "Routing policy",
      group: "Routing",
      value: config.policy,
      options: regional
        ? {
            round_robin: "Round robin across regions",
            least_loaded: "Least loaded region",
            nearest: "Nearest region",
          }
        : policies,
    },
  ];
  if (!regional) {
    const fields: Setting[] = [
      {
        key: "server_count",
        label: configLabels.server_count,
        group: "Capacity",
        value: config.server_count,
        step: 1,
      },
      {
        key: "concurrency",
        label: configLabels.concurrency,
        group: "Capacity",
        value: config.concurrency,
        step: 1,
      },
      {
        key: "queue_limit",
        label: configLabels.queue_limit,
        group: "Capacity",
        value: config.queue_limit,
        step: 1,
      },
      ...(config.request_model==="cpu_io" ? [
        {key:"io_fraction",label:"I/O share (fraction)",group:"Workload",value:config.io_fraction,step:.01},
        {key:"outstanding_limit",label:"Outstanding limit per server",group:"Capacity",value:config.outstanding_limit,step:1},
        {key:"io_capacity",label:"Shared I/O concurrency",group:"Capacity",value:config.io_capacity??64,step:1},
        ...(config.io_heavy_probability!==undefined?[{key:"io_heavy_probability",label:"I/O-heavy request fraction",group:"Workload",value:config.io_heavy_probability,step:.01}]:[]),
      ] : []),
      ...common,
      {
        key: "processing_rates",
        label: "Processing rates",
        group: "Capacity",
        value: config.processing_rates,
      },
    ];
    return fields;
  }
  return [
    ...common,
    ...config.regions.flatMap((r, i) => [
      ...(
        [
          ["servers", "Servers", 1],
          ["slots_per_server", "Slots per server", 1],
          ["compute", "Compute multiplier", 0.1],
          ["queue_per_server", "Waiting places per server", 1],
        ] as const
      ).map(([key, label, step]) => ({
        key: `regions.${i}.${key}`,
        label: `${r.name} · ${label}`,
        group: r.name,
        value: r[key],
        step,
      })),
      {
        key: `client_latency_ms.${i}`,
        label: `${r.name} · Client RTT (ms)`,
        group: r.name,
        value: config.client_latency_ms[i],
        step: 1,
      },
    ]),
  ];
}
export function changedSettings(a: CompareConfig, b: CompareConfig): string[] {
  const other = new Map(settings(b).map((s) => [s.key, s.value]));
  return settings(a)
    .filter(
      (s) =>
        JSON.stringify(s.value ?? null) !==
        JSON.stringify(other.get(s.key) ?? null),
    )
    .map((s) => s.key);
}
export function settingLabel(config: CompareConfig, key: string) {
  return settings(config).find((s) => s.key === key)?.label ?? key;
}
export function settingValue(config: CompareConfig, key: string) {
  const s = settings(config).find((s) => s.key === key);
  if (!s) return "N/A";
  if (s.options) return s.options[String(s.value)] ?? String(s.value);
  if (Array.isArray(s.value))
    return `${s.value.length} rates: ${s.value.slice(0, 8).join(", ")}${s.value.length > 8 ? "…" : ""}`;
  return s.value === undefined ? "Identical (1×)" : String(s.value);
}
export function updateSetting(
  config: CompareConfig,
  key: string,
  value: Setting["value"],
): CompareConfig {
  const next = structuredClone(config);
  const parts = key.split(".");
  // Only descriptors generated from this configuration are editable.
  if (!settings(config).some((s) => s.key === key)) return next;
  let target: Record<string, unknown> = next as unknown as Record<
    string,
    unknown
  >;
  for (const part of parts.slice(0, -1))
    target = target[part] as Record<string, unknown>;
  target[parts.at(-1)!] = value;
  return next;
}
export function validCompareConfig(value: unknown): value is CompareConfig {
  if (!value || typeof value !== "object") return false;
  if (!("topology" in value)) return validConfig(value);
  const c = value as RegionalConfig;
  const num = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n);
  const int = (n: unknown, min: number, max: number) =>
    num(n) && Number.isSafeInteger(n) && n >= min && n <= max;
  return (
    c.topology === "regions" &&
    Array.isArray(c.regions) &&
    c.regions.length > 0 &&
    c.regions.length <= 12 &&
    c.regions.every(
      (r) =>
        r &&
        typeof r.name === "string" &&
        r.name.trim() === r.name &&
        r.name.length > 0 &&
        r.name.length <= 64 &&
        int(r.servers, 1, 1000) &&
        int(r.slots_per_server, 1, 4096) &&
        int(r.queue_per_server, 0, 100000) &&
        num(r.compute) &&
        r.compute > 0 &&
        r.compute <= 1000,
    ) &&
    new Set(c.regions.map((r) => r.name)).size === c.regions.length &&
    int(c.source, 0, c.regions.length - 1) &&
    Array.isArray(c.latency_ms) &&
    c.latency_ms.length === c.regions.length &&
    c.latency_ms.every(
      (row) =>
        Array.isArray(row) &&
        row.length === c.regions.length &&
        row.every((n) => num(n) && n >= 0 && n <= 60000),
    ) &&
    Array.isArray(c.client_latency_ms) &&
    c.client_latency_ms.length === c.regions.length &&
    c.client_latency_ms.every((n) => num(n) && n >= 0 && n <= 60000) &&
    ["round_robin", "least_loaded", "nearest"].includes(c.policy) &&
    int(c.seed, 0, 2 ** 32 - 1) &&
    num(c.arrival_rate) &&
    c.arrival_rate >= 0 &&
    c.arrival_rate <= 100000 &&
    num(c.duration) &&
    c.duration > 0 &&
    c.duration <= 3600 &&
    c.arrival_rate * c.duration <= 100000 &&
    num(c.service_min) &&
    num(c.service_max) &&
    c.service_min > 0 &&
    c.service_max >= c.service_min &&
    c.regions.reduce((n, r) => n + r.servers, 0) <= 1000 &&
    c.regions.reduce((n, r) => n + r.servers * r.slots_per_server, 0) <= 4096 &&
    c.regions.reduce((n, r) => n + r.servers * r.queue_per_server, 0) <= 100000
  );
}
export type ComparisonRun = {
  config: CompareConfig;
  response_window_count?: number;
  summary: Pick<
    Run["summary"],
    | "completed_count"
    | "rejected_count"
    | "mean_response_time"
    | "p95_response_time"
    | "per_server_utilization"
  >;
};
export function compactRun(run: Run): ComparisonRun {
  const s = run.summary;
  return {
    config: run.config,
    summary: {
      completed_count: s.completed_count,
      rejected_count: s.rejected_count,
      mean_response_time: s.mean_response_time,
      p95_response_time: s.p95_response_time,
      per_server_utilization: s.per_server_utilization,
    },
  };
}
export function compactRegionalRun(run: RegionalRun): ComparisonRun {
  return {
    config: run.config as CompareConfig,
    response_window_count: run.summary.metrics.response_window_count,
    summary: {
      completed_count: run.summary.totals.completed,
      rejected_count: run.summary.totals.rejected,
      mean_response_time: run.summary.metrics.mean_response_time,
      p95_response_time: run.summary.metrics.recent_p95_response_time,
      per_server_utilization: {},
    },
  };
}
export function metrics(run: ComparisonRun) {
  const s = run.summary,
    total = s.completed_count + s.rejected_count,
    util = Object.values(s.per_server_utilization);
  return {
    completed: s.completed_count,
    rejected: s.rejected_count,
    mean: s.mean_response_time,
    p95: s.p95_response_time,
    rejection: total ? (100 * s.rejected_count) / total : null,
    utilization: util.length
      ? (100 * util.reduce((a, b) => a + b, 0)) / util.length
      : null,
  };
}
