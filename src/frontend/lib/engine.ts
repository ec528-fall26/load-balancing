import { serverPolicies } from "./policy-metadata";
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
};
export type Event = [number, number, number, number, string, number];
export type Summary = {
  histogram?: {
    scope: "all_completed_responses";
    bins: { start: number; end: number; count: number }[];
  };
  end_time?: number;
  event_count?: number;
  completed_count: number;
  rejected_count: number;
  mean_response_time: number | null;
  p95_response_time: number | null;
  response_times: number[];
  per_server_utilization: Record<string, number>;
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
  operation: "run" | "replay" | "compare" | "exports",
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
