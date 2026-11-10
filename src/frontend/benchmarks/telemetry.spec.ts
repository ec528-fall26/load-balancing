import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const out = path.resolve(__dirname, "../../../experiments/results/a-11");
const ids = new WeakMap<Page, Set<string>>();
test.beforeEach(async ({ page }) => {
  const created = new Set<string>();
  ids.set(page, created);
  page.on("response", async (r) => {
    if (
      new URL(r.url()).pathname === "/api/sessions" &&
      r.request().method() === "POST" &&
      r.status() === 201
    ) {
      try {
        created.add((await r.json()).session_id);
      } catch {}
    }
  });
  await page.addInitScript(() => {
    const m = {
      longTasks: [] as number[],
      frames: 0,
      maxGap: 0,
      sumGap: 0,
      over100: 0,
      lastFrame: 0,
      jsonReads: [] as { url: string; ms: number }[],
    };
    (window as any).__a11 = m;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (m.longTasks.length < 2000) m.longTasks.push(e.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {}
    function frame(now: number) {
      if (m.lastFrame) {
        const d = now - m.lastFrame;
        m.frames++;
        m.sumGap += d;
        m.maxGap = Math.max(m.maxGap, d);
        m.over100 += Number(d > 100);
      }
      m.lastFrame = now;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    const original = Response.prototype.json;
    Response.prototype.json = async function () {
      const t = performance.now();
      try {
        return await original.call(this);
      } finally {
        if (this.url.includes("/api/") && m.jsonReads.length < 500)
          m.jsonReads.push({
            url: new URL(this.url).pathname,
            ms: performance.now() - t,
          });
      }
    };
  });
});
test.afterEach(async ({ page, request }) => {
  for (const id of ids.get(page) ?? [])
    await request.delete("/api/sessions/" + id);
});
async function choose(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
function distribution(a: number[]) {
  const s = [...a].sort((a, b) => a - b);
  return s.length
    ? {
        count: s.length,
        min: s[0],
        median: s[Math.floor(s.length / 2)],
        p95: s[Math.ceil(s.length * 0.95) - 1],
        max: s.at(-1),
      }
    : null;
}
for (const topology of ["single_pool", "regions"])
  for (const rate of [1000, 10000])
    for (const mode of ["one_shot", "continuous"])
      test(`${topology} ${rate} requests per second ${mode}`, async ({
        page,
        browser,
        request,
      }) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const polls: {
          started: number;
          ms: number;
          bytes: number;
          offered: number;
          lag: number;
        }[] = [];
        const pending = new Map<any, number>();
        let maxPending = 0;
        page.on("request", (r) => {
          if (
            r.url().includes("/api/sessions/") &&
            r.url().includes("/snapshot")
          ) {
            pending.set(r, performance.now());
            maxPending = Math.max(maxPending, pending.size);
          }
        });
        page.on("requestfailed", (r) => pending.delete(r));
        page.on("requestfinished", async (r) => {
          const started = pending.get(r);
          if (started === undefined) return;
          pending.delete(r);
          try {
            const response = await r.response();
            if (!response || !response.ok()) return;
            const body = await response.body(),
              s = JSON.parse(body.toString());
            polls.push({
              started,
              ms: performance.now() - started,
              bytes: body.length,
              offered: s.totals.offered,
              lag: s.lag_simulation_seconds,
            });
          } catch {}
        });
        await page.goto("/simulator");
        if (topology === "regions") {
          await choose(page, "Topology", "Regions");
          await choose(page, "Regional preset", "Scale · 100 servers");
          await choose(
            page,
            "Regional routing policy",
            "Round robin across regions",
          );
        } else {
          await page
            .getByRole("spinbutton", { name: "Server count", exact: true })
            .fill("100");
          await page
            .getByRole("spinbutton", { name: "Slots per server", exact: true })
            .fill("4");
        }
        await page
          .getByRole("spinbutton", { name: "Requests per second", exact: true })
          .fill(String(rate));
        await page
          .getByRole("spinbutton", {
            name: "Arrival window (seconds)",
            exact: true,
          })
          .fill(String(100000 / rate));
        if (mode === "continuous")
          await choose(page, "Execution", "Continuous");
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Performance.enable");
        await cdp.send("HeapProfiler.collectGarbage");
        const initialHeap = await cdp.send("Runtime.getHeapUsage");
        await page.evaluate(() => {
          const m = (window as any).__a11;
          m.longTasks = [];
          m.jsonReads = [];
          m.frames = 0;
          m.maxGap = 0;
          m.sumGap = 0;
          m.over100 = 0;
          m.lastFrame = 0;
        });
        let summary: any = null;
        const runPath =
          topology === "single_pool" ? "/api/engine/run" : "/api/regions/run";
        const start = performance.now();
        let firstReady = 0,
          pauseMs: number | undefined,
          drainMs: number | undefined;
        if (mode === "one_shot") {
          const promise = page.waitForResponse(
            (r) =>
              new URL(r.url()).pathname === runPath &&
              r.request().method() === "POST",
          );
          await page
            .getByRole("button", { name: "Run simulation", exact: true })
            .click();
          const response = await promise;
          expect(response.status()).toBe(
            topology === "single_pool" ? 201 : 200,
          );
          summary = (await response.json()).summary;
          if (topology === "single_pool")
            await expect(
              page.getByRole("tab", { name: "Overview", exact: true }),
            ).toBeVisible();
          else
            await expect(page.getByTestId("regional-accounting")).toBeVisible();
          firstReady = performance.now() - start;
          await page.waitForTimeout(1500);
        } else {
          await page
            .getByRole("button", {
              name: "Start continuous simulation",
              exact: true,
            })
            .click();
          await expect(
            page.getByRole("button", { name: "Pause session", exact: true }),
          ).toBeVisible();
          firstReady = performance.now() - start;
          await expect.poll(() => polls.length).toBeGreaterThan(1);
          await page.waitForTimeout(15000);
          const p = performance.now();
          await page
            .getByRole("button", { name: "Pause session", exact: true })
            .click();
          await expect(
            page.getByRole("button", { name: "Resume session", exact: true }),
          ).toBeVisible();
          pauseMs = performance.now() - p;
          const sid = [...ids.get(page)!][0];
          summary = await (
            await request.get(`/api/sessions/${sid}/snapshot?history_limit=240`)
          ).json();
          const t = summary.totals;
          expect(t.offered).toBe(
            t.completed +
              t.rejected +
              t.running +
              t.waiting +
              (t.in_transit ?? 0),
          );
          const d = performance.now();
          await page
            .getByRole("button", { name: "Drain traffic", exact: true })
            .click();
          await choose(page, "Simulation speed", "10×");
          await page
            .getByRole("button", { name: "Resume session", exact: true })
            .click();
          await expect
            .poll(
              async () => {
                const s = await (
                  await request.get(`/api/sessions/${sid}/snapshot`)
                ).json();
                return (
                  s.totals.offered - s.totals.completed - s.totals.rejected
                );
              },
              { timeout: 15000 },
            )
            .toBe(0);
          drainMs = performance.now() - d;
          await page
            .getByRole("button", { name: "Pause session", exact: true })
            .click();
        }
        const naturalHeap = await cdp.send("Runtime.getHeapUsage");
        const rendering = await page.evaluate(() => {
          const m = (window as any).__a11;
          return {
            long_tasks: m.longTasks,
            frames: m.frames,
            frame_gap_max_ms: m.maxGap,
            frame_gap_mean_ms: m.sumGap / Math.max(1, m.frames),
            frame_gaps_over_100ms: m.over100,
            json_reads: m.jsonReads,
            visibility: document.visibilityState,
          };
        });
        const pm = await cdp.send("Performance.getMetrics");
        await cdp.send("HeapProfiler.collectGarbage");
        const retainedHeap = await cdp.send("Runtime.getHeapUsage");
        expect(errors).toEqual([]);
        expect(maxPending).toBeLessThanOrEqual(1);
        if (mode === "one_shot")
          expect(
            topology === "single_pool"
              ? summary.completed_count + summary.rejected_count
              : summary.totals.offered,
          ).toBe(100000);
        if (mode === "continuous")
          await page
            .getByRole("button", { name: "Stop session", exact: true })
            .click();
        const record = {
          recorded_at_utc: new Date().toISOString(),
          git_head: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: path.resolve(__dirname, "../../.."),
            encoding: "utf8",
          }).trim(),
          benchmark_source_sha256: createHash("sha256")
            .update(readFileSync(__filename))
            .digest("hex"),
          topology,
          rate,
          mode,
          browser_version: browser.version(),
          viewport: page.viewportSize(),
          first_ready_ms: firstReady,
          pause_control_ms: pauseMs,
          drain_control_ms: drainMs,
          initial_heap: initialHeap,
          natural_end_heap: naturalHeap,
          post_gc_end_heap: retainedHeap,
          retained_heap_delta_bytes:
            retainedHeap.usedSize - initialHeap.usedSize,
          rendering,
          cdp_metrics: pm.metrics,
          poll_count: polls.length,
          max_simultaneous_polls: maxPending,
          poll_latency_ms: distribution(polls.map((p) => p.ms)),
          poll_body_bytes: distribution(polls.map((p) => p.bytes)),
          poll_start_gap_ms: distribution(
            polls.slice(1).map((p, i) => p.started - polls[i].started),
          ),
          polls,
          counts:
            mode === "one_shot" && topology === "single_pool"
              ? {
                  completed: summary.completed_count,
                  rejected: summary.rejected_count,
                }
              : summary.totals,
          errors,
        };
        await mkdir(out, { recursive: true });
        await writeFile(
          path.join(out, `browser-${topology}-${rate}-${mode}.json`),
          JSON.stringify(record, null, 2) + "\n",
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: path.join(out, `browser-${topology}-${rate}-${mode}.png`),
          fullPage: false,
        });
      });
