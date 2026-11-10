import assert from "node:assert/strict";
import { test } from "node:test";
import { proxyRun } from "../lib/server/engine-proxy";
import { engineRequest, EngineError } from "../lib/engine";

const config = { server_count: 2, concurrency: 1, queue_limit: 10, arrival_rate: 1,
  duration: 2, service_min: 0.1, service_max: 1, seed: 42, policy: "round_robin" };
const request = () => new Request("http://localhost/api/engine/run", {
  method: "POST", body: JSON.stringify({ config }),
});

test("proxy forwards the request to the configured server and preserves real results", async () => {
  const result = { api_version: "1", config, summary: { completed_count: 2 } };
  const response = await proxyRun(request(), { backendUrl: "http://backend:8000/", fetchImpl: async (url, init) => {
    assert.equal(String(url), "http://backend:8000/v1/run");
    assert.deepEqual(JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)), { config });
    assert.equal(init?.cache, "no-store");
    return Response.json(result);
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
});

test("Python validation, busy and timeout responses are preserved", async () => {
  for (const status of [422, 429, 504]) {
    const error = { api_version: "1", code: "PYTHON_ERROR", message: "Try again", field_errors: [] };
    const response = await proxyRun(request(), { fetchImpl: async () => Response.json(error, { status }) });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), error);
  }
});

test("proxy rejects a streamed body above 64 KiB before calling Python", async () => {
  let called = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(40000)); controller.enqueue(new Uint8Array(40000)); controller.close();
  } });
  const oversized = new Request("http://localhost/api/engine/run", {
    method: "POST", body, duplex: "half",
  } as RequestInit);
  const response = await proxyRun(oversized, { fetchImpl: async () => { called = true; return Response.json({}); } });
  assert.equal(response.status, 413); assert.equal(called, false);
});

test("backend outage, invalid address and invalid response have actionable errors", async () => {
  let response = await proxyRun(request(), { fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  assert.equal(response.status, 503); assert.equal((await response.json()).code, "BACKEND_UNAVAILABLE");
  response = await proxyRun(request(), { backendUrl: "file:///private/path" });
  assert.equal(response.status, 503); assert.equal((await response.json()).code, "BACKEND_CONFIG");
  response = await proxyRun(request(), { fetchImpl: async () => new Response("unexpected html") });
  assert.equal(response.status, 502);
});

test("proxy deadline aborts a backend that has not responded", async () => {
  const response = await proxyRun(request(), { timeoutMs: 10, fetchImpl: async (_url, init) => {
    return await new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json({})), 1000);
      init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal?.reason); });
    });
  } });
  assert.equal(response.status, 504); assert.equal((await response.json()).code, "BACKEND_TIMEOUT");
});

test("browser API client exposes Python field errors and rejects malformed responses", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ code: "INVALID_CONFIG", message: "Invalid configuration.",
      field_errors: [{ field: "config.concurrency", message: "must be positive" }] }, { status: 422 });
    await assert.rejects(engineRequest("run", { config }), (error: unknown) => {
      assert.ok(error instanceof EngineError); assert.equal(error.status, 422);
      assert.match(error.message, /config.concurrency: must be positive/); return true;
    });
    globalThis.fetch = async () => new Response("invalid JSON", { status: 502 });
    await assert.rejects(engineRequest("run", { config }), (error: unknown) => {
      assert.ok(error instanceof EngineError); assert.equal(error.code, "INVALID_RESPONSE"); return true;
    });
  } finally { globalThis.fetch = original; }
});
