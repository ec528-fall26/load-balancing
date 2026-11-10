import type { Config, Run } from "./engine";
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
};
export function changedSettings(a: Config, b: Config): (keyof Config)[] {
  return (Object.keys(configLabels) as (keyof Config)[]).filter(
    (key) => JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null),
  );
}
export type ComparisonRun = {
  config: Config;
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
