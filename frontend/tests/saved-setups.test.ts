import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { defaults } from "../lib/engine";
import {
  readSetups,
  saveSetup,
  deleteSetup,
  LIBRARY_KEY,
  templates,
  validConfig,
} from "../lib/saved-setups";
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
});
test("save/update/copy/delete round trip preserves seeded configuration", () => {
  const original = saveSetup(" My setup ", {
    ...defaults,
    processing_rates: [0.5, 2],
  });
  assert.equal(original.name, "My setup");
  assert.deepEqual(readSetups()[0].config, original.config);
  const changed = saveSetup(
    "Updated",
    { ...defaults, arrival_rate: 4 },
    original.id,
  );
  assert.equal(changed.id, original.id);
  assert.equal(readSetups().length, 1);
  const copy = saveSetup("Copy", changed.config);
  assert.notEqual(copy.id, original.id);
  assert.equal(readSetups().length, 2);
  deleteSetup(original.id);
  assert.equal(readSetups()[0].id, copy.id);
});
test("malformed or unsupported data is retained rather than overwritten", () => {
  for (const raw of [
    "{bad",
    JSON.stringify({ version: 2, items: [] }),
    JSON.stringify({ version: 1, items: [{ id: "x", name: "broken" }] }),
  ]) {
    values.set(LIBRARY_KEY, raw);
    assert.throws(() => readSetups());
    assert.throws(() => saveSetup("new", defaults));
    assert.equal(values.get(LIBRARY_KEY), raw);
  }
});
test("failed storage writes leave previous data intact", () => {
  saveSetup("Original", defaults);
  const raw = values.get(LIBRARY_KEY);
  localStorage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  assert.throws(
    () => saveSetup("New", defaults),
    /Storage may be full or disabled/,
  );
  assert.equal(values.get(LIBRARY_KEY), raw);
});
test("templates are valid; invalid setups cannot be saved", () => {
  for (const t of templates) assert.ok(validConfig(t.config), t.id);
  for (const config of [
    { ...defaults, server_count: 0 },
    { ...defaults, processing_rates: [1] },
    { ...defaults, arrival_rate: 100000 },
    { ...defaults, service_min: 2, service_max: 1 },
  ])
    assert.throws(() => saveSetup("Invalid", config), /valid configuration/);
  assert.throws(() => saveSetup(" ", defaults));
  assert.equal(values.size, 0);
});
