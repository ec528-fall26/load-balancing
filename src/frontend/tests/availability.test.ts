import { test } from "node:test";
import assert from "node:assert/strict";
import { defaults } from "../lib/engine";
import { changedSettings, settingValue } from "../lib/comparison";
import { validConfig } from "../lib/saved-setups";
import {
  allDownTime,
  downIntervals,
  formatDuration,
  formatPercent,
  formatAvailabilities,
  formatRepairTimes,
  formatServers,
  hasOutages,
  mtbf,
  outagesSupported,
  parseAvailabilities,
  parseRepairTimes,
  repairTime,
  availabilityError,
  availabilityNotes,
  resizeAvailabilities,
  withoutOutages,
} from "../lib/availability";

const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("MTBF follows availability = MTBF / (MTBF + MTTR)", () => {
  close(mtbf(0.9, 2), 18);
  close(mtbf(0.5, 3), 3);
  assert.equal(mtbf(1, 2), Infinity);
  const up = mtbf(0.95, 1.5);
  assert.ok(Math.abs(up / (up + 1.5) - 0.95) < 1e-12);
});

test("percentages avoid floating-point noise", () => {
  assert.equal(formatPercent(0.07), "7%");
  assert.equal(formatPercent(0.9), "90%");
  assert.equal(formatPercent(0.95), "95%");
  assert.equal(formatPercent(0.0356739), "3.57%");
  assert.equal(formatPercent(1), "100%");
});

test("one value applies to every server; several are per server", () => {
  assert.equal(parseAvailabilities("", 3), undefined);
  assert.equal(parseAvailabilities("   ", 3), undefined);
  assert.deepEqual(parseAvailabilities("0.9", 3), [0.9, 0.9, 0.9]);
  assert.deepEqual(parseAvailabilities("1, 0.9, .5", 3), [1, 0.9, 0.5]);
  assert.ok(Number.isNaN(parseAvailabilities("0.9,", 2)![1]));
  assert.equal(formatAvailabilities([0.9, 0.9]), "0.9");
  assert.equal(formatAvailabilities([1, 0.5]), "1, 0.5");
  assert.equal(formatAvailabilities(undefined), "");
});

test("a shared availability follows the server count; per-server lists do not", () => {
  const shared = { ...defaults, server_count: 4, availabilities: [0.9, 0.9] };
  assert.deepEqual(resizeAvailabilities(shared).availabilities, [0.9, 0.9, 0.9, 0.9]);
  const mixed = { ...defaults, server_count: 3, availabilities: [1, 0.5] };
  assert.equal(resizeAvailabilities(mixed), mixed);
  assert.equal(resizeAvailabilities(defaults), defaults);
});

test("validation explains invalid availability settings", () => {
  const base = { ...defaults, server_count: 2 };
  assert.equal(availabilityError(base), null);
  assert.equal(availabilityError({ ...base, availabilities: [1, 0.5] }), null);
  assert.match(availabilityError({ ...base, availabilities: [0, 1] })!, /greater than 0/);
  assert.match(availabilityError({ ...base, availabilities: [1.5, 1] })!, /at most 1/);
  assert.match(availabilityError({ ...base, availabilities: [NaN, 1] })!, /greater than 0/);
  assert.match(availabilityError({ ...base, availabilities: [0.5] })!, /exactly 2/);
  assert.match(
    availabilityError({ ...base, availabilities: [0.5, 0.5], mean_repair_time: 0 })!,
    /recover/,
  );
});

test("notes group servers by availability with MTBF, MTTR and expected outages", () => {
  const config = {
    ...defaults,
    server_count: 4,
    duration: 60,
    availabilities: [1, 0.9, 0.9, 0.5],
    mean_repair_time: 2,
  };
  const notes = availabilityNotes(config);
  assert.deepEqual(
    notes.map((n) => [n.availability, n.servers, n.mttr]),
    [
      [0.5, [3], 2],
      [0.9, [1, 2], 2],
    ],
  );
  close(notes[0].mtbf, 2);
  close(notes[0].expectedOutages, 15);
  close(notes[1].mtbf, 18);
  close(notes[1].expectedOutages, 3);
  assert.deepEqual(availabilityNotes({ ...config, availabilities: [1, 1, 1, 1] }), []);
  assert.deepEqual(availabilityNotes({ ...config, availabilities: [0.5] }), []);
  // Missing MTTR uses the backend default of 1 s.
  const fallback = availabilityNotes({ ...config, mean_repair_time: undefined });
  assert.equal(fallback[1].mttr, 1);
  close(fallback[1].mtbf, 9);
});

test("repair time is one shared value or one per server", () => {
  assert.equal(parseRepairTimes(""), undefined);
  assert.equal(parseRepairTimes("2"), 2);
  assert.deepEqual(parseRepairTimes("1, 2, 5"), [1, 2, 5]);
  assert.equal(formatRepairTimes(undefined), "1");
  assert.equal(formatRepairTimes(2), "2");
  assert.equal(formatRepairTimes([2, 2]), "2");
  assert.equal(formatRepairTimes([1, 5]), "1, 5");
  const config = { ...defaults, server_count: 3, availabilities: [0.9, 0.9, 0.9] };
  assert.equal(repairTime({ ...config, mean_repair_time: 4 }, 2), 4);
  assert.equal(repairTime({ ...config, mean_repair_time: [1, 2, 5] }, 2), 5);
  assert.equal(repairTime(config, 1), 1);
  assert.equal(availabilityError({ ...config, mean_repair_time: [1, 2, 5] }), null);
  assert.match(availabilityError({ ...config, mean_repair_time: [1, 2] })!, /exactly 3/);
  assert.match(availabilityError({ ...config, mean_repair_time: [1, 0, 2] })!, /recover/);
});

test("notes split servers that share availability but not repair time", () => {
  const config = {
    ...defaults,
    server_count: 3,
    duration: 60,
    availabilities: [0.9, 0.9, 0.9],
    mean_repair_time: [2, 2, 5],
  };
  const notes = availabilityNotes(config);
  assert.deepEqual(
    notes.map((n) => [n.availability, n.mttr, n.servers]),
    [
      [0.9, 2, [0, 1]],
      [0.9, 5, [2]],
    ],
  );
  close(notes[1].mtbf, 45);
});

test("durations and server lists read naturally", () => {
  assert.equal(formatDuration(18), "18 s");
  assert.equal(formatDuration(2.25), "2.25 s");
  assert.equal(formatDuration(1 / 3), "0.333 s");
  assert.equal(formatDuration(180), "3 min");
  assert.equal(formatDuration(7200), "2 h");
  assert.equal(formatDuration(Infinity), "never");
  assert.equal(formatServers([0, 1, 2], 3), "All servers");
  assert.equal(formatServers([3], 5), "Server 3");
  assert.equal(formatServers([1, 2, 3, 4], 8), "Servers 1–4");
  assert.equal(formatServers([1, 3], 8), "Servers 1, 3");
});

test("outages only apply to one-shot simple runs and can be stripped", () => {
  const config = { ...defaults, availabilities: [0.9, 0.9], mean_repair_time: 2 };
  assert.ok(hasOutages(config));
  assert.ok(!hasOutages({ ...defaults, availabilities: [1, 1] }));
  assert.ok(outagesSupported(config, "one_shot"));
  assert.ok(!outagesSupported(config, "continuous"));
  assert.ok(!outagesSupported({ ...config, request_model: "cpu_io" }, "one_shot"));
  assert.deepEqual(withoutOutages(config), defaults);
});

test("saved setups accept valid availability and reject invalid values", () => {
  assert.ok(validConfig({ ...defaults, availabilities: [1, 0.5], mean_repair_time: 2 }));
  assert.ok(!validConfig({ ...defaults, availabilities: [1] }));
  assert.ok(!validConfig({ ...defaults, availabilities: [1, 0] }));
  assert.ok(!validConfig({ ...defaults, availabilities: [1, 0.5], mean_repair_time: -1 }));
  assert.ok(validConfig({ ...defaults, availabilities: [1, 0.5], mean_repair_time: [1, 3] }));
  assert.ok(!validConfig({ ...defaults, availabilities: [1, 0.5], mean_repair_time: [1] }));
  assert.ok(!validConfig({ ...defaults, availabilities: [1, 0.5], mean_repair_time: [1, 0] }));
  assert.ok(
    !validConfig({
      ...defaults,
      availabilities: [1, 0.5],
      request_model: "cpu_io",
      io_fraction: 0.5,
      outstanding_limit: 4,
    }),
  );
});

test("comparison shows availability as a setting without false changes", () => {
  assert.deepEqual(changedSettings(defaults, { ...defaults }), []);
  const flaky = { ...defaults, availabilities: [0.9, 0.5], mean_repair_time: 2 };
  assert.deepEqual(changedSettings(defaults, flaky), ["availabilities", "mean_repair_time"]);
  assert.equal(settingValue(flaky, "availabilities"), "0.9, 0.5");
  assert.equal(settingValue(defaults, "availabilities"), "Always up (1)");
  assert.equal(settingValue(flaky, "mean_repair_time"), "2 s");
  assert.equal(
    settingValue({ ...flaky, mean_repair_time: [1, 4] }, "mean_repair_time"),
    "1, 4 s",
  );
});

test("outage intervals are clipped to the arrival window", () => {
  assert.deepEqual(
    downIntervals([[2, 4], [9, 13], [12, 15]], 10),
    [[2, 4], [9, 10]],
  );
  assert.deepEqual(downIntervals([], 10), []);
});

test("all-down time counts only moments when every server is down", () => {
  // Overlap of [2, 6] and [4, 8] is 2 s.
  assert.equal(allDownTime({ 0: [[2, 6]], 1: [[4, 8]] }, 2, 10), 2);
  // No overlap.
  assert.equal(allDownTime({ 0: [[1, 2]], 1: [[3, 4]] }, 2, 10), 0);
  // Several overlaps: [1, 3]∩[2, 5] = 1 s, [6, 9]∩[7, 12] clipped to 10 = 2 s.
  assert.equal(
    allDownTime({ 0: [[1, 3], [6, 9]], 1: [[2, 5], [7, 12]] }, 2, 10),
    3,
  );
  // Touching intervals do not overlap.
  assert.equal(allDownTime({ 0: [[1, 3]], 1: [[3, 5]] }, 2, 10), 0);
  // A server that never fails keeps the service up.
  assert.equal(allDownTime({ 0: [[0, 10]], 1: [] }, 2, 10), 0);
  assert.equal(allDownTime({ 0: [[0, 10]] }, 2, 10), 0);
  // A single server: all-down time is its own downtime inside the window.
  assert.equal(allDownTime({ 0: [[1, 2], [8, 14]] }, 1, 10), 3);
  // Three servers must all be down.
  assert.equal(
    allDownTime({ 0: [[0, 6]], 1: [[2, 8]], 2: [[5, 9]] }, 3, 10),
    1,
  );
});
