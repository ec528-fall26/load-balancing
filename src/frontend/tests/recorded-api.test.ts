import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyRecording } from "../lib/server/run-proxy";
const id = "a".repeat(32);
test("recorded proxy preserves precise times and only exposes bounded recording operations", async () => {
  let called = "";
  const response = await proxyRecording(
    new Request(
      "http://localhost/api/runs/" +
        id +
        "/snapshot?time=100.76233412345678&server_offset=968&server_limit=32",
    ),
    [id, "snapshot"],
    {
      backendUrl: "http://python:8000",
      fetchImpl: async (url) => {
        called = String(url);
        return Response.json({ ok: true });
      },
    },
  );
  assert.equal(response.status, 200);
  assert.ok(called.includes("time=100.76233412345678"));
  const laterPage = await proxyRecording(
    new Request(`http://localhost/api/runs/${id}/events?offset=1000000`),
    [id, "events"],
    { fetchImpl: async (url) => {
      assert.equal(new URL(String(url)).searchParams.get("offset"), "1000000");
      return Response.json({ items: [] });
    } },
  );
  assert.equal(laterPage.status, 200);
  for (const [parts, query] of [
    [[id, "events"], "?offset=-1"],
    [[id, "events"], "?offset=9007199254740992"],
    [[id, "snapshot"], "?time=NaN"],
    [[id, "snapshot"], "?time=1&time=2"],
    [["..", "snapshot"], ""],
    [[id, "other"], ""],
  ] as [string[], string][]) {
    const r = await proxyRecording(
      new Request("http://localhost/api/runs/test" + query),
      parts,
      {
        fetchImpl: async () => {
          assert.fail("Invalid request reached backend");
        },
      },
    );
    assert.equal(r.status, 422);
  }
});
