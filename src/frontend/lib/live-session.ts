import { EngineError, type Config } from "./engine";
export type LiveConfig = Omit<Config, "duration">;
export type LiveSnapshot = {
  api_version: "1";
  session_id: string;
  revision: number;
  status: "running" | "paused";
  speed: number;
  simulation_time: number;
  target_simulation_time: number;
  lag_simulation_seconds: number;
  arrival_rate: number;
  config: LiveConfig;
  totals: {
    offered: number;
    completed: number;
    rejected: number;
    running: number;
    waiting: number;
  };
  metrics: {
    mean_response_time: number | null;
    recent_p95_response_time: number | null;
    response_window_count: number;
    response_window_limit: number;
    mean_slot_utilization: number;
  };
  histogram: {
    scope: "recent_completed_responses";
    bins: { start: number; end: number; count: number }[];
  };
  servers: {
    offset: number;
    limit: number;
    total: number;
    items: {
      id: number;
      running: number;
      waiting: number;
      free_slots: number;
      slots: number;
      queue_limit: number;
      processing_rate: number;
      mean_slot_utilization: number;
    }[];
  };
  history: {
    simulation_time: number;
    offered: number;
    completed: number;
    rejected: number;
    running: number;
    waiting: number;
  }[];
};
export const ACTIVE_SESSION_KEY = "lbsim.active-session.v1";
export const SESSION_ID = /^[a-f0-9]{32}$/;
export function continuousConfig(config: Config): LiveConfig {
  const { duration, ...rest } = config;
  return rest;
}
export function acceptSnapshot(
  value: unknown,
  id?: string,
): value is LiveSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as LiveSnapshot;
  const nonnegative = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= 0;
  const count = (n: unknown): n is number =>
    nonnegative(n) && Number.isSafeInteger(n);
  const latency = (n: unknown) => n === null || nonnegative(n);
  const totals = (t: LiveSnapshot["totals"]) =>
    !!t &&
    ["offered", "completed", "rejected", "running", "waiting"].every((key) =>
      count(t[key as keyof typeof t]),
    ) &&
    t.offered === t.completed + t.rejected + t.running + t.waiting;
  return (
    s.api_version === "1" &&
    SESSION_ID.test(s.session_id) &&
    (!id || s.session_id === id) &&
    count(s.revision) &&
    ["running", "paused"].includes(s.status) &&
    nonnegative(s.simulation_time) &&
    nonnegative(s.target_simulation_time) &&
    nonnegative(s.lag_simulation_seconds) &&
    nonnegative(s.arrival_rate) &&
    nonnegative(s.speed) &&
    s.speed >= 0.25 &&
    s.speed <= 10 &&
    totals(s.totals) &&
    !!s.config &&
    count(s.config.server_count) &&
    s.config.server_count > 0 &&
    s.config.server_count <= 1000 &&
    !!s.metrics &&
    latency(s.metrics.mean_response_time) &&
    latency(s.metrics.recent_p95_response_time) &&
    nonnegative(s.metrics.mean_slot_utilization) &&
    s.metrics.mean_slot_utilization <= 1.000001 &&
    count(s.metrics.response_window_count) &&
    count(s.metrics.response_window_limit) &&
    s.metrics.response_window_count <= s.metrics.response_window_limit &&
    s.metrics.response_window_limit <= 2000 &&
    !!s.servers &&
    count(s.servers.offset) &&
    count(s.servers.total) &&
    s.servers.total === s.config.server_count &&
    Array.isArray(s.servers.items) &&
    s.servers.items.length <= 64 &&
    s.servers.items.every(
      (row, index) =>
        row.id === s.servers.offset + index &&
        count(row.running) &&
        count(row.waiting) &&
        count(row.slots) &&
        row.slots > 0 &&
        count(row.queue_limit) &&
        row.running <= row.slots &&
        row.waiting <= row.queue_limit &&
        row.free_slots === row.slots - row.running &&
        nonnegative(row.processing_rate) &&
        row.processing_rate > 0 &&
        nonnegative(row.mean_slot_utilization),
    ) &&
    Array.isArray(s.history) &&
    s.history.length <= 240 &&
    s.history.every(
      (point) => nonnegative(point.simulation_time) && totals(point),
    ) &&
    s.histogram?.scope === "recent_completed_responses" &&
    Array.isArray(s.histogram.bins) &&
    s.histogram.bins.length <= 20 &&
    s.histogram.bins.every(
      (bin) =>
        nonnegative(bin.start) &&
        nonnegative(bin.end) &&
        bin.end >= bin.start &&
        count(bin.count),
    ) &&
    s.histogram.bins.reduce((n, bin) => n + bin.count, 0) ===
      s.metrics.response_window_count
  );
}
export async function sessionRequest(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<LiveSnapshot | { status: "deleted" }> {
  const response = await fetch("/api/sessions" + path, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    cache: "no-store",
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new EngineError(
      "The session service returned an unreadable response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }
  if (!response.ok) {
    const detail = Array.isArray(data.field_errors)
      ? data.field_errors
          .slice(0, 5)
          .map(
            (f: { field: string; message: string }) =>
              `${f.field}: ${f.message}`,
          )
          .join("; ")
      : "";
    throw new EngineError(
      (data.message ?? "Session request failed.") +
        (detail ? " " + detail : ""),
      response.status,
      data.code ?? "SESSION_ERROR",
    );
  }
  if (options.method === "DELETE" && data.status === "deleted") return data;
  if (
    !acceptSnapshot(
      data,
      SESSION_ID.test(path.split("/")[1] ?? "")
        ? path.split("/")[1]
        : undefined,
    )
  )
    throw new EngineError(
      "The session service returned an invalid snapshot.",
      502,
      "INVALID_RESPONSE",
    );
  return data;
}
export function isTerminalSessionError(error: unknown) {
  return (
    error instanceof EngineError &&
    ["SESSION_NOT_FOUND", "SESSION_EXPIRED", "SESSION_FAILED"].includes(
      error.code,
    )
  );
}
