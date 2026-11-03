import { test, expect } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const out = path.resolve(__dirname, "../../experiments/results/a-11");
test("1000-server bounded playback renders 32 servers and seeks to its last page", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const config = {
    server_count: 1000,
    concurrency: 4,
    queue_limit: 10,
    arrival_rate: 10000,
    duration: 10,
    service_min: 0.1,
    service_max: 1,
    seed: 42,
    policy: "round_robin",
  };
  const t = performance.now();
  const r = await request.post("/api/engine/run", { data: { config } });
  expect(r.status()).toBe(201);
  const run = await r.json(),
    apiMs = performance.now() - t;
  try {
    await page.route("**/api/engine/run", (route) =>
      route.fulfill({ json: run }),
    );
    await page.goto("/simulator");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    const initial = await cdp.send("Runtime.getHeapUsage");
    const render = performance.now();
    await page
      .getByRole("button", { name: "Run simulation", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Overview", exact: true }),
    ).toBeVisible();
    const readyMs = performance.now() - render;
    await page.getByRole("tab", { name: "Datacenter", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(32);
    const seek = performance.now();
    await page.getByRole("slider").press("End");
    await expect(
      page.getByLabel(
        /100000 of 100000 requests arrived; 0 running, 0 waiting/,
      ),
    ).toBeVisible();
    const seekMs = performance.now() - seek;
    await page.getByLabel("Servers to display", { exact: true }).click();
    await page
      .getByRole("option", { name: "Servers 992–999", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Inspect server 999", exact: true }),
    ).toBeVisible();
    await cdp.send("HeapProfiler.collectGarbage");
    const final = await cdp.send("Runtime.getHeapUsage");
    await mkdir(out, { recursive: true });
    await writeFile(
      path.join(out, "large-browser-single.json"),
      JSON.stringify(
        {
          config,
          api_ms: apiMs,
          decoded_summary_bytes: (await r.body()).length,
          cached_response_to_results_ms: readyMs,
          seek_to_end_ms: seekMs,
          visible_server_count: await page.getByRole("article").count(),
          initial_heap: initial,
          post_gc_end_heap: final,
        },
        null,
        2,
      ) + "\n",
    );
    await page.screenshot({
      path: path.join(out, "large-browser-single.png"),
      fullPage: false,
    });
  } finally {
    await request.delete("/api/runs/" + run.run_id);
  }
});
test("12-datacenter latency preset runs continuously with 1000 servers", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  let sid = "";
  try {
    await page.goto("/simulator");
    await page.getByLabel("Topology", { exact: true }).click();
    await page.getByRole("option", { name: "Regions", exact: true }).click();
    await page.getByLabel("Regional preset", { exact: true }).click();
    await page
      .getByRole("option", {
        name: "Scale · 1,000 servers / 12 datacenters",
        exact: true,
      })
      .click();
    await page
      .getByRole("spinbutton", { name: "Requests per second", exact: true })
      .fill("10000");
    await page.getByLabel("Execution", { exact: true }).click();
    await page.getByRole("option", { name: "Continuous", exact: true }).click();
    const started = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/sessions" &&
        r.request().method() === "POST",
    );
    const t = performance.now();
    await page
      .getByRole("button", { name: "Start continuous simulation", exact: true })
      .click();
    sid = (await (await started).json()).session_id;
    await expect(
      page.getByLabel("Region dc-12", { exact: true }),
    ).toContainText("450 ms client RTT");
    const readyMs = performance.now() - t;
    await page.waitForTimeout(10000);
    const pause = performance.now();
    await page
      .getByRole("button", { name: "Pause session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Resume session", exact: true }),
    ).toBeVisible();
    const pauseMs = performance.now() - pause;
    const snapshot = await (
      await request.get(`/api/sessions/${sid}/snapshot`)
    ).json();
    const totals = snapshot.totals;
    expect(totals.offered).toBe(
      totals.completed +
        totals.rejected +
        totals.running +
        totals.waiting +
        totals.in_transit,
    );
    expect(snapshot.regions).toHaveLength(12);
    await writeFile(
      path.join(out, "large-browser-regions.json"),
      JSON.stringify(
        { first_ready_ms: readyMs, pause_control_ms: pauseMs, snapshot },
        null,
        2,
      ) + "\n",
    );
    await page.screenshot({
      path: path.join(out, "large-browser-regions.png"),
      fullPage: false,
    });
  } finally {
    if (sid) await request.delete("/api/sessions/" + sid);
  }
});
