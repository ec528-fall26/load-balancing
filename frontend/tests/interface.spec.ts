import { test, expect, type Page } from "@playwright/test";
import fixture from "../lib/preview-run.json";
async function expectHeaderPinned(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(100);
  expect((await page.getByRole("banner").boundingBox())?.y).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
}
test("initial UI and unavailable backend feedback", async ({ page }) => {
  await page.route("**/api/engine/run", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "BACKEND_UNAVAILABLE",
        message: "Cannot reach the Python API. Start the backend and retry.",
      }),
    }),
  );
  await page.goto("/simulator");
  await expect(
    page.getByRole("heading", { name: "Load balancing simulator" }),
  ).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("2");
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Cannot reach the Python API",
  );
  await expect(page.getByRole("tab")).toHaveCount(0);
});
test("recorded results, playback, tables and downloads", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/simulator?preview=1");
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".chart svg")).toHaveCount(3);
  await expect(
    page.locator(".recharts-bar-rectangle path").first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/next-overview.png",
    fullPage: true,
  });
  await expectHeaderPinned(page);
  await page.getByRole("tab", { name: "Datacenter", exact: true }).click();
  await expect(page.getByText("Server 0", { exact: true })).toBeVisible();
  await page.getByRole("slider").focus();
  await page.getByRole("slider").press("Home");
  await page.getByRole("slider").press("ArrowRight", { delay: 0 });
  await page.getByRole("slider").press("End");
  await expect(page.getByText("Finished · 60.0 / 60.0 s")).toBeVisible();
  await page.getByRole("slider").press("Home");
  await expect(page.getByText("Paused · 0.0 / 60.0 s")).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(page.getByText("Paused · 0.0 / 60.0 s")).toBeVisible();
  await page.screenshot({
    path: "test-results/next-datacenter.png",
    fullPage: true,
  });
  const inspect = page.getByRole("button", {
    name: "Inspect server 0",
    exact: true,
  });
  await inspect.click();
  await expect(page.getByRole("dialog")).toContainText("Server 0 details");
  await expect(page.getByRole("dialog")).toContainText("Processing rate");
  await page.keyboard.press("Escape");
  await expect(inspect).toBeFocused();
  await page.getByRole("radio", { name: "Run averages", exact: true }).check();
  await expect(page.getByRole("meter")).toHaveCount(2);
  await page.getByRole("tab", { name: "Server details", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Slot utilization (%)" }),
  ).toBeVisible();
  await page.getByText("Download run", { exact: true }).click();
  await page.getByRole("button", { name: "Download results (CSV)" }).click();
  await expect(page.getByRole("status")).toContainText("not connected");
  expect(errors).toEqual([]);
});
test("mobile layout stays within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/simulator?preview=1");
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".chart svg")).toHaveCount(3);
  await expect(
    page.locator(".recharts-bar-rectangle path").first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/next-mobile.png",
    fullPage: true,
  });
  await expectHeaderPinned(page);
});
test("API boundary never fabricates engine results", async ({ request }) => {
  for (const operation of ["replay", "compare", "exports"]) {
    const response = await request.post(`/api/engine/${operation}`, {
      data: {},
    });
    expect(response.status()).toBe(501);
    expect((await response.json()).code).toBe("ENGINE_NOT_CONNECTED");
  }
  const invalid = await request.post("/api/engine/run", { data: {} });
  expect(invalid.status()).toBe(422);
  expect((await invalid.json()).code).toBe("INVALID_REQUEST");
  expect((await request.post("/api/engine/unknown")).status()).toBe(404);
});
test("Run returns the actual Python result through the proxy", async ({
  request,
}) => {
  const response = await request.post("/api/engine/run", {
    data: { config: fixture.config },
  });
  expect(response.status()).toBe(200);
  const run = await response.json();
  expect(run.api_version).toBe("1");
  expect(run.config).toEqual(fixture.config);
  expect(run.summary).toEqual(fixture.summary);
});
test("future API results retain the completed configuration after form edits", async ({
  page,
}) => {
  await page.route("**/api/engine/run", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/simulator");
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Server count", exact: true })
    .fill("5");
  await page.getByText("Run configuration", { exact: true }).click();
  await expect(page.locator("main pre")).toContainText('"server_count": 2');
  await page
    .getByRole("button", { name: "Increase Server count", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("6");
});
test("replay and comparison send uploaded files to the engine boundary", async ({
  page,
}) => {
  await page.goto("/simulator");
  await page.getByText("Replay a saved run", { exact: true }).click();
  await page
    .getByLabel("Configuration export (JSON)", { exact: true })
    .setInputFiles({
      name: "config.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ schema_version: 1, config: fixture.config }),
      ),
    });
  await page
    .getByRole("button", { name: "Replay saved configuration", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("not connected");
  await page.route("**/api/engine/compare", (route) => {
    expect(route.request().postDataJSON().results).toEqual([
      "Run A payload",
      "Run B payload",
    ]);
    return route.fulfill({ json: [fixture, fixture] });
  });
  await page.getByText("Compare saved results", { exact: true }).click();
  await Promise.all(
    ["Run A results (CSV)", "Run B results (CSV)"].map((label, index) =>
      page.getByLabel(label, { exact: true }).setInputFiles({
        name: "results.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(index === 0 ? "Run A payload" : "Run B payload"),
      }),
    ),
  );
  await expect(
    page.getByText("Both files have the same configuration."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Run A", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/next-comparison.png",
    fullPage: true,
  });
});

test("real Run updates the UI and preserves results after validation failure", async ({
  page,
}) => {
  await page.goto("/simulator");
  for (const [name, value] of [
    ["Server count", "1"],
    ["Slots per server", "1"],
    ["Waiting places per server", "0"],
    ["Requests per second", "10"],
    ["Arrival window (seconds)", "1"],
    ["Min service (s)", "1"],
    ["Max service (s)", "1"],
  ]) {
    const input = page.getByRole("spinbutton", { name, exact: true });
    await input.fill(value);
    await expect(input).toHaveValue(value);
  }
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await expect(page.locator("dl").first()).toContainText(
    "Completed requests1Rejected requests9",
  );
  await expect(
    page.locator(".recharts-bar-rectangle path").first(),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Server count", exact: true })
    .fill("0");
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("server_count");
  await expect(page.locator("dl").first()).toContainText(
    "Completed requests1Rejected requests9",
  );
});

test("setup uses a mobile sheet and preserves settings when reopened", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/simulator");
  await page.getByRole("button", { name: "Show setup", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  const count = sheet.getByRole("spinbutton", {
    name: "Server count",
    exact: true,
  });
  await count.fill("7");
  await page.keyboard.press("Escape");
  await expect(sheet).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show setup", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Show setup", exact: true }).click();
  await expect(
    sheet.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("7");
  await expect(
    sheet.getByRole("button", { name: "Hide setup", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await sheet.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
  await page.screenshot({
    path: "test-results/next-mobile-setup.png",
    fullPage: true,
  });
});

test("large rack view bounds cells, paginates, and shows queue saturation", async ({
  page,
  request,
}) => {
  const config = {
    ...fixture.config,
    server_count: 40,
    concurrency: 64,
    queue_limit: 64,
    arrival_rate: 10000,
    duration: 1,
    service_min: 2,
    service_max: 2,
  };
  const response = await request.post("/api/engine/run", { data: { config } });
  expect(response.status()).toBe(200);
  const run = await response.json();
  await page.route("**/api/engine/run", (route) =>
    route.fulfill({ json: run }),
  );
  await page.goto("/simulator");
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await page.getByRole("tab", { name: "Datacenter", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(32);
  await expect(page.locator(".dc-capacity-cell")).toHaveCount(1024);
  await page.getByLabel("Playback speed", { exact: true }).click();
  await page.getByRole("option", { name: "2×", exact: true }).click();
  await expect(
    page.getByLabel("Playback speed", { exact: true }),
  ).toContainText("2×");
  const seek = page.getByRole("slider");
  await seek.press("Home");
  await seek.press("PageUp");
  await seek.press("PageUp");
  const server0 = page.getByRole("article", {
    name: "Server 0 visualization",
    exact: true,
  });
  await expect(server0).toContainText("Queue full");
  await expect(
    server0.getByRole("img", {
      name: "64 of 64 execution slots occupied",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    server0.getByRole("img", {
      name: "64 of 64 waiting places occupied",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/next-datacenter-loaded.png",
    fullPage: true,
  });
  await page.getByLabel("Servers to display", { exact: true }).click();
  await page
    .getByRole("option", { name: "Servers 32–39", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "Inspect server 32", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/next-datacenter-mobile.png",
    fullPage: true,
  });
});
