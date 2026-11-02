import { test } from "node:test";
import assert from "node:assert/strict";
import { proxySession } from "../lib/server/session-proxy";
import {
  acceptSnapshot,
  continuousConfig,
  sessionRequest,
  isTerminalSessionError,
} from "../lib/live-session";
import { EngineError, defaults } from "../lib/engine";
import { liveFixture } from "./fixtures/live-snapshot";
const id = liveFixture.session_id;
test("session proxy maps only whitelisted paths and preserves methods and queries", async () => {
  for (const [method, parts, query] of [
    ["POST", [], ""],
    ["DELETE", [id], ""],
    [
      "GET",
      [id, "snapshot"],
      "?server_offset=32&server_limit=32&history_limit=120",
    ],
    ["POST", [id, "commands"], ""],
  ] as [string, string[], string][]) {
    let called = false;
    const request = new Request("http://localhost/api/sessions" + query, {
      method,
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    const response = await proxySession(request, parts, {
      backendUrl: "http://python:8000",
      fetchImpl: async (url, init) => {
        called = true;
        assert.equal(
          String(url),
          "http://python:8000/v1/sessions" +
            (parts.length ? "/" + parts.join("/") : "") +
            query,
        );
        assert.equal(init?.method, method);
        return Response.json(liveFixture);
      },
    });
    assert.equal(response.status, 200);
    assert.ok(called);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});
test("session proxy rejects invalid routing, duplicate queries and oversized streamed bodies", async () => {
  const fetchImpl = async () => {
    assert.fail("Invalid input reached backend");
  };
  for (const parts of [
    ["..", "health"],
    ["wrong-id", "snapshot"],
    [id, "pause"],
    [id, "snapshot", "extra"],
  ])
    assert.equal(
      (
        await proxySession(
          new Request("http://localhost/api/sessions"),
          parts,
          { fetchImpl },
        )
      ).status,
      404,
    );
  for (const query of [
    "?other=1",
    "?server_limit=1&server_limit=2",
    "?server_offset=-1",
  ])
    assert.equal(
      (
        await proxySession(
          new Request("http://localhost/api/sessions" + query),
          [id, "snapshot"],
          { fetchImpl },
        )
      ).status,
      422,
    );
  assert.equal(
    (
      await proxySession(
        new Request("http://localhost/api/sessions", {
          method: "POST",
          body: "x".repeat(65537),
        }),
        [],
        { fetchImpl },
      )
    ).status,
    413,
  );
});
test("session errors and deadlines remain explicit", async () => {
  const request = () => new Request("http://localhost/api/sessions");
  const expired = await proxySession(request(), [id, "snapshot"], {
    fetchImpl: async () =>
      Response.json(
        { code: "SESSION_EXPIRED", message: "Expired." },
        { status: 410 },
      ),
  });
  assert.equal(expired.status, 410);
  assert.equal((await expired.json()).code, "SESSION_EXPIRED");
  const timeout = await proxySession(request(), [id, "snapshot"], {
    timeoutMs: 5,
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(
          () => reject(new Error("missed deadline")),
          100,
        );
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(keepAlive);
          reject(init.signal?.reason);
        });
      }),
  });
  assert.equal(timeout.status, 504);
});
test("snapshot validation enforces bounded arrays, server state and conservation", () => {
  assert.ok(acceptSnapshot(liveFixture, id));
  assert.equal(acceptSnapshot(liveFixture, "b".repeat(32)), false);
  for (const change of [
    { revision: -1 },
    { history: Array(241).fill(liveFixture.history[0]) },
    { totals: { ...liveFixture.totals, offered: 1 } },
    { metrics: { ...liveFixture.metrics, mean_response_time: "bad" } },
    {
      histogram: {
        scope: "recent_completed_responses",
        bins: Array(21).fill({ start: 0, end: 1, count: 0 }),
      },
    },
  ])
    assert.ok(!acceptSnapshot({ ...liveFixture, ...change }));
  assert.ok(!("duration" in continuousConfig(defaults)));
});
test("browser session client validates identity and identifies terminal errors", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json(liveFixture);
    assert.ok(acceptSnapshot(await sessionRequest("/" + id + "/snapshot")));
    await assert.rejects(
      () => sessionRequest("/" + "b".repeat(32) + "/snapshot"),
      (e: unknown) => e instanceof EngineError && e.code === "INVALID_RESPONSE",
    );
    globalThis.fetch = async () =>
      Response.json(
        { code: "SESSION_EXPIRED", message: "Expired." },
        { status: 410 },
      );
    await assert.rejects(
      () => sessionRequest("/" + id + "/snapshot"),
      (e: unknown) => isTerminalSessionError(e),
    );
    assert.ok(
      !isTerminalSessionError(
        new EngineError("Offline", 503, "BACKEND_UNAVAILABLE"),
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});
