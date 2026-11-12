import { regionalPolicies } from "./policy-metadata";
import { EngineError } from "./engine";
export type Region = {
  name: string;
  servers: number;
  slots_per_server: number;
  compute: number;
  queue_per_server: number;
};
export type RegionalTopology = {
  regions: Region[];
  latency_ms: number[][];
  client_latency_ms: number[];
  source: number;
  client_weights?: number[];
  client_migration?: boolean;
};
export type RegionalConfig = RegionalTopology & {
  topology: "regions";
  policy: keyof typeof regionalPolicies;
  arrival_rate: number;
  service_min: number;
  service_max: number;
  seed: number;
  duration?: number;
};
export type RegionPreset = RegionalTopology & { id: string };
export type RegionalSummary = {
  topology: "regions";
  model: "aggregate_regional_pools";
  history_limit?: number;
  telemetry?: "immediate";
  retention?: {pending_events:number;response_values:number;history_points:number};
  config: RegionalConfig;
  simulation_time: number;
  arrival_rate: number;
  totals: {
    offered: number;
    completed: number;
    rejected: number;
    running: number;
    waiting: number;
    in_transit: number;
  };
  metrics: {
    mean_response_time: number | null;
    recent_p95_response_time: number | null;
    response_window_count: number;
    response_window_limit: number;
  };
  histogram: {
    scope: "recent_completed_responses";
    bins: { start: number; end: number; count: number }[];
  };
  regions: {
    name: string;
    slots: number;
    free_slots: number;
    running: number;
    waiting: number;
    outbound: number;
    online?: boolean;
    queue_limit: number;
    cpu_occupancy: number;
    compute: number;
    load_averages: number[];
    client_rtt_ms: number;
    completed: number;
    rejected: number;
    recent_p95_response_time: number | null;
    response_window_count: number;
  }[];
  client_traffic?: {
    origin: number;
    configured_rps: number;
    shifted_fraction: number;
    destination: number | null;
    routed_per_second: number[];
  }[];
  client_migration_events?: {
    simulation_time: number;
    origin: number;
    destination: number | null;
    shifted_fraction: number;
    reason: "outage" | "overload" | "recovery" | "destination_unavailable";
  }[];
  history: {
    simulation_time: number;
    running: number;
    waiting: number;
    in_transit: number;
  }[];
};
export type RegionalSnapshot = RegionalSummary & {
  api_version: "1";
  session_id: string;
  revision: number;
  status: "running" | "paused";
  speed: number;
  target_simulation_time: number;
  lag_simulation_seconds: number;
};
export type RegionalRun = {
  api_version: "1";
  config: RegionalConfig;
  summary: RegionalSummary;
};
export function acceptRegionalSummary(
  value: unknown,
): value is RegionalSummary {
  if (!value || typeof value !== "object") return false;
  const s = value as RegionalSummary;
  const n = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  const c = (v: unknown): v is number => n(v) && Number.isSafeInteger(v);
  const latency = (v: unknown) => v === null || n(v);
  const regionIndex = (v: unknown) => c(v) && v < s.config.regions.length;
  const preference = (v: { destination: number | null; shifted_fraction: number }) =>
    n(v.shifted_fraction) && v.shifted_fraction <= 1 &&
    (v.shifted_fraction === 0 ? v.destination === null : regionIndex(v.destination));
  return (
    s.topology === "regions" &&
    s.model === "aggregate_regional_pools" &&
    n(s.simulation_time) &&
    n(s.arrival_rate) &&
    !!s.config &&
    s.config.topology === "regions" &&
    Array.isArray(s.config.regions) &&
    s.config.regions.length > 0 &&
    s.config.regions.length <= 12 &&
    s.config.regions.every(
      (r) =>
        !!r &&
        typeof r.name === "string" &&
        c(r.servers) &&
        r.servers > 0 &&
        c(r.slots_per_server) &&
        r.slots_per_server > 0 &&
        c(r.queue_per_server) &&
        n(r.compute) &&
        r.compute > 0,
    ) &&
    c(s.config.source) &&
    s.config.source < s.config.regions.length &&
    Array.isArray(s.config.latency_ms) &&
    s.config.latency_ms.length === s.config.regions.length &&
    s.config.latency_ms.every(
      (row) =>
        Array.isArray(row) &&
        row.length === s.config.regions.length &&
        row.every(n),
    ) &&
    Array.isArray(s.config.client_latency_ms) &&
    s.config.client_latency_ms.length === s.config.regions.length &&
    s.config.client_latency_ms.every(n) &&
    Object.hasOwn(regionalPolicies, s.config.policy) &&
    !!s.totals &&
    Object.values(s.totals).every(c) &&
    [
      "offered",
      "completed",
      "rejected",
      "running",
      "waiting",
      "in_transit",
    ].every((k) => c(s.totals[k as keyof typeof s.totals])) &&
    s.totals.offered ===
      s.totals.completed +
        s.totals.rejected +
        s.totals.running +
        s.totals.waiting +
        s.totals.in_transit &&
    !!s.metrics &&
    latency(s.metrics.mean_response_time) &&
    latency(s.metrics.recent_p95_response_time) &&
    c(s.metrics.response_window_count) &&
    c(s.metrics.response_window_limit) &&
    s.metrics.response_window_count <= s.metrics.response_window_limit &&
    s.metrics.response_window_limit <= 2000 &&
    Array.isArray(s.regions) &&
    s.regions.length === s.config.regions.length &&
    s.regions.every(
      (r, i) =>
        !!r &&
        r.name === s.config.regions[i].name &&
        c(r.slots) &&
        r.slots > 0 &&
        c(r.running) &&
        r.running <= r.slots &&
        c(r.waiting) &&
        c(r.queue_limit) &&
        r.waiting <= r.queue_limit &&
        (r.online === undefined || typeof r.online === "boolean") &&
        (r.online === false
          ? r.free_slots === 0 && r.running === 0 && r.waiting === 0 && r.outbound === 0
          : r.free_slots === r.slots - r.running) &&
        c(r.outbound) &&
        n(r.cpu_occupancy) &&
        r.cpu_occupancy <= 1 &&
        n(r.compute) &&
        n(r.client_rtt_ms) &&
        c(r.completed) &&
        c(r.rejected) &&
        latency(r.recent_p95_response_time) &&
        c(r.response_window_count) &&
        r.response_window_count <= 2000 &&
        Array.isArray(r.load_averages) &&
        r.load_averages.length === 3 &&
        r.load_averages.every(n),
    ) &&
    (s.client_traffic === undefined ||
      (Array.isArray(s.client_traffic) &&
        s.client_traffic.length === s.regions.length &&
        s.client_traffic.every((row, i) =>
          !!row && row.origin === i && n(row.configured_rps) && preference(row) &&
          Array.isArray(row.routed_per_second) &&
          row.routed_per_second.length === s.regions.length &&
          row.routed_per_second.every(c)))) &&
    (s.client_migration_events === undefined ||
      (Array.isArray(s.client_migration_events) &&
        s.client_migration_events.length <= 48 &&
        s.client_migration_events.every((event) =>
          !!event && n(event.simulation_time) && regionIndex(event.origin) &&
          preference(event) &&
          ["outage", "overload", "recovery", "destination_unavailable"].includes(event.reason)))) &&
    Array.isArray(s.history) &&
    s.history.length <= 240 &&
    s.history.every(
      (h) =>
        !!h &&
        n(h.simulation_time) &&
        c(h.running) &&
        c(h.waiting) &&
        c(h.in_transit),
    ) &&
    s.histogram?.scope === "recent_completed_responses" &&
    Array.isArray(s.histogram.bins) &&
    s.histogram.bins.length <= 20 &&
    s.histogram.bins.every(
      (b) => n(b.start) && n(b.end) && b.end >= b.start && c(b.count),
    ) &&
    s.histogram.bins.reduce((total, b) => total + b.count, 0) ===
      s.metrics.response_window_count
  );
}
export async function regionalRequest<T>(
  operation: "presets" | "run",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/regions/" + operation, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new EngineError(
      [
        data.message,
        ...(data.field_errors ?? []).map((e: { message: string }) => e.message),
      ].join(" "),
      response.status,
      data.code,
    );
  if (operation === "run" && !acceptRegionalSummary(data.summary))
    throw new EngineError(
      "Invalid regional response.",
      502,
      "INVALID_RESPONSE",
    );
  return data as T;
}

export function withoutRegionalClients<T extends RegionalTopology>(config: T) {
  const { client_weights: _weights, client_migration: _migration, ...rest } = config;
  return rest;
}
