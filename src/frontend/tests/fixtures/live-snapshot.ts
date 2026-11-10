import { defaults } from "../../lib/engine";
import { continuousConfig, type LiveSnapshot } from "../../lib/live-session";
export const liveFixture: LiveSnapshot = {
  api_version: "1",
  session_id: "a".repeat(32),
  revision: 0,
  status: "running",
  speed: 1,
  simulation_time: 0,
  target_simulation_time: 0,
  lag_simulation_seconds: 0,
  arrival_rate: 1,
  config: continuousConfig(defaults),
  totals: { offered: 0, completed: 0, rejected: 0, running: 0, waiting: 0 },
  metrics: {
    mean_response_time: null,
    recent_p95_response_time: null,
    response_window_count: 0,
    response_window_limit: 2000,
    mean_slot_utilization: 0,
  },
  histogram: { scope: "recent_completed_responses", bins: [] },
  servers: {
    offset: 0,
    limit: 32,
    total: 2,
    items: [0, 1].map((id) => ({
      id,
      running: 0,
      waiting: 0,
      free_slots: 1,
      slots: 1,
      queue_limit: 10,
      processing_rate: 1,
      mean_slot_utilization: 0,
    })),
  },
  history: [
    {
      simulation_time: 0,
      offered: 0,
      completed: 0,
      rejected: 0,
      running: 0,
      waiting: 0,
    },
  ],
};
