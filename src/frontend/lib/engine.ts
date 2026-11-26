import { serverPolicies } from "./policy-metadata";
export const MAX_SINGLE_POOL_SERVERS = 1_000;

export function validServerCount(count: number): boolean {
  return Number.isSafeInteger(count) && count >= 1 && count <= MAX_SINGLE_POOL_SERVERS;
}

export type DiskConfig = {
  read_fraction: number;
  read_ms: number;
  write_ms: number;
  write_size_kib?: number;
  write_speed_mib_s?: number;
};

export const DEFAULT_WRITE_SPEED_MIB_S = 100;
export type DiskCounts = { read: number; write: number };

export const retryModes = {
  off: "Off",
  immediate: "Immediate retries",
  backoff: "Exponential backoff with jitter",
} as const;

export type RetryConfig = {
  mode: keyof typeof retryModes;
  limit: number;
  base_ms: number;
};

export const defaultRetry: RetryConfig = { mode: "off", limit: 3, base_ms: 100 };

export type Config = {
  server_count: number;
  concurrency: number;
  queue_limit: number;
  policy: keyof typeof serverPolicies;
  arrival_rate: number;
  duration: number;
  service_min: number;
  service_max: number;
  seed: number;
  processing_rates?: number[];
  /** Fraction of time each server is up (0–1]; omitted means servers never fail. */
  availabilities?: number[];
  /** Average outage length in seconds (MTTR): one shared value or one per server. */
  mean_repair_time?: number | number[];
  request_model?: "simple" | "cpu_io";
  io_fraction?: number;
  outstanding_limit?: number;
  io_capacity?: number;
  io_heavy_probability?: number;
  disk?: DiskConfig;
  retry?: RetryConfig;
};
export function withoutRetries({ retry: _retry, ...config }: Config): Config {
  return config;
}

export type Event = [number, number, number, number, string, number, number?, number?, number?, number?];
export type Summary = {
  request_model?: "cpu_io";
  workload_sha256?: string;
  mean_cpu_queue_wait?: number | null;
  mean_io_queue_wait?: number|null;
  mean_cpu_service_time?: number|null;
  mean_io_service_time?: number|null;
  io_resource?: {capacity:number;utilization:number;peak_queue:number;disk_completed?:DiskCounts};
  per_server_mean_io_waiting?: Record<string,number>;
  per_server_mean_cpu_queued?: Record<string,number>;
  histogram?: {
    scope: "all_completed_responses";
    bins: { start: number; end: number; count: number }[];
  };
  end_time?: number;
  event_count?: number;
  completed_count: number;
  rejected_count: number;
  retry_attempts?: number;
  mean_response_time: number | null;
  p95_response_time: number | null;
  response_times: number[];
  per_server_utilization: Record<string, number>;
  /** Present only for runs with server outages. */
  rerouted_count?: number;
  outages?: Record<string, [number, number][]>;
  per_server_availability?: Record<string, number>;
  /** Requests moved off each server because it failed. */
  rerouted_by_server?: Record<string, { rerouted: number; rejected: number }>;
  /** Why requests were rejected; the three counts sum to rejected_count. */
  rejected_breakdown?: {
    queue_full: number;
    no_server_up: number;
    reroute_rejected: number;
  };
  events: Event[];
};
export type Run = {
  run_id?: string;
  playback?: { total_requests: number; expires_in_seconds: number };
  api_version?: "1";
  config: Config;
  summary: Summary;
};
export const defaults: Config = {
  server_count: 2,
  concurrency: 1,
  queue_limit: 10,
  policy: "round_robin",
  arrival_rate: 1,
  duration: 60,
  service_min: 0.1,
  service_max: 1,
  seed: 42,
};
export const policies = serverPolicies;
export type FieldError = { field: string; message: string };
export class EngineError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = "EngineError";
  }
}
// All browser calls stay same-origin; only the server knows the Python URL.
export async function engineRequest<T>(
  operation: "run" | "summarize" | "replay" | "compare" | "exports",
  payload: unknown,
): Promise<T> {
  const response = await fetch(`/api/engine/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new EngineError(
      "The service returned an unreadable response. Retry shortly.",
      response.status,
      "INVALID_RESPONSE",
    );
  }
  if (!response.ok) {
    const fields: FieldError[] = Array.isArray(data.field_errors)
      ? data.field_errors.filter(
          (f: FieldError) =>
            typeof f?.field === "string" && typeof f?.message === "string",
        )
      : [];
    const message =
      typeof data.message === "string"
        ? data.message
        : "The engine request failed.";
    const detail = fields
      .slice(0, 5)
      .map((f) => `${f.field}: ${f.message}`)
      .join("; ");
    throw new EngineError(
      detail ? `${message} ${detail}` : message,
      response.status,
      data.code ?? "ENGINE_ERROR",
      fields,
    );
  }
  return data as T;
}
