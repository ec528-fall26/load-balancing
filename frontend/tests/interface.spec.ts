import { test, expect } from "@playwright/test";
import fixture from "../lib/preview-run.json";
test("initial UI and engine placeholder", async ({ page }) => {
  await page.goto("/");
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
    "Python engine API is not connected yet",
  );
  await expect(page.getByRole("tab")).toHaveCount(0);
});
test("recorded results, playback, tables and downloads", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?preview=1");
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".chart svg")).toHaveCount(3);
  await page.screenshot({
    path: "test-results/next-overview.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Datacenter", exact: true }).click();
  await expect(page.getByText("Server 0", { exact: true })).toBeVisible();
  await page.getByRole("slider").fill("10");
  await expect(page.getByText("Paused · 10.0 / 60.0 s")).toBeVisible();
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
  await page.goto("/?preview=1");
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".chart svg")).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/next-mobile.png",
    fullPage: true,
  });
});
test("API boundary never fabricates engine results", async ({ request }) => {
  for (const operation of ["run", "replay", "compare", "exports"]) {
    const response = await request.post(`/api/engine/${operation}`, {
      data: {},
    });
    expect(response.status()).toBe(501);
    expect((await response.json()).code).toBe("ENGINE_NOT_CONNECTED");
  }
  expect((await request.post("/api/engine/unknown")).status()).toBe(404);
});
test("future API results retain the completed configuration after form edits", async ({
  page,
}) => {
  await page.route("**/api/engine/run", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
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
  await page.goto("/");
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
  await page.route("**/api/engine/compare", (route) =>
    route.fulfill({ json: [fixture, fixture] }),
  );
  await page.getByText("Compare saved results", { exact: true }).click();
  for (const label of ["Run A results (CSV)", "Run B results (CSV)"])
    await page
      .getByLabel(label, { exact: true })
      .setInputFiles({
        name: "results.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("placeholder upload for mocked API"),
      });
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
