import { test } from "node:test";
import assert from "node:assert/strict";
import { changedSettings, compactRun, metrics } from "../lib/comparison";
import { defaults, type Run } from "../lib/engine";
test("changed settings compare rate arrays by value and include both sides", () => {
  const a = { ...defaults, processing_rates: [0.5, 2] };
  assert.deepEqual(
    changedSettings(a, { ...a, processing_rates: [0.5, 2] }),
    [],
  );
  assert.deepEqual(
    changedSettings(defaults, {
      ...defaults,
      concurrency: 2,
      policy: "least_active_requests",
    }),
    ["concurrency", "policy"],
  );
  assert.deepEqual(changedSettings(a, defaults), ["processing_rates"]);
});
test("undefined metrics remain N/A and utilization is the mean across servers", () => {
  const run = {
    config: defaults,
    summary: {
      completed_count: 0,
      rejected_count: 0,
      mean_response_time: null,
      p95_response_time: null,
      per_server_utilization: { "0": 0.2, "1": 0.6 },
    },
  };
  assert.deepEqual(metrics(run), {
    completed: 0,
    rejected: 0,
    mean: null,
    p95: null,
    rejection: null,
    utilization: 40,
  });
});
test("comparison retains metrics without retaining event and response sample arrays", () => {
  const run: Run = {
    config: defaults,
    summary: {
      completed_count: 2,
      rejected_count: 1,
      mean_response_time: 0.5,
      p95_response_time: 0.8,
      per_server_utilization: { "0": 0.5 },
      response_times: [0.2, 0.8],
      events: [[0, 0, 1, 0, "started", 0]],
    },
  };
  const result = compactRun(run);
  assert.ok(!("events" in result.summary));
  assert.ok(!("response_times" in result.summary));
  assert.equal(metrics(result).rejection, 100 / 3);
  assert.deepEqual(run.summary.response_times, [0.2, 0.8]);
});
