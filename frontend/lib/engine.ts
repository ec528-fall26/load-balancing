export type Config = {
  server_count: number;
  concurrency: number;
  queue_limit: number;
  policy: "round_robin" | "least_active_requests";
  arrival_rate: number;
  duration: number;
  service_min: number;
  service_max: number;
  seed: number;
};
export type Event = [number, number, number, number, string, number];
export type Summary = {
  completed_count: number;
  rejected_count: number;
  mean_response_time: number | null;
  p95_response_time: number | null;
  response_times: number[];
  per_server_utilization: Record<string, number>;
  events: Event[];
};
export type Run = { config: Config; summary: Summary };
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
export const policies = {
  round_robin: "Round robin",
  least_active_requests: "Least active requests",
};
// The UI talks only to this boundary. Replace the route handlers with Python API calls later.
export async function engineRequest<T>(
  operation: "run" | "replay" | "compare" | "exports",
  payload: unknown,
): Promise<T> {
  const response = await fetch(`/api/engine/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "The engine request failed.");
  return data as T;
}
