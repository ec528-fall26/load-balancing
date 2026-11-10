import { test, expect } from "@playwright/test";

test("lab draft comparison runs baseline and two variants, retaining results on failure", async ({
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
  ])
    await page.getByRole("spinbutton", { name, exact: true }).fill(value);
  await page
    .getByRole("button", { name: "Compare current setup", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Compare configurations" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Load baseline from", { exact: true }),
  ).toContainText("Current lab setup");
  await page.getByLabel("Load baseline from", { exact: true }).click();
  await page
    .getByRole("option", { name: "Light traffic", exact: true })
    .click();
  await page.getByLabel("Load baseline from", { exact: true }).click();
  await page
    .getByRole("option", { name: "Current lab setup", exact: true })
    .click();

  const a = page.getByRole("region", {
    name: "Variant A configuration",
    exact: true,
  });
  await expect(
    a.getByRole("spinbutton", { name: "Servers", exact: true }),
  ).toHaveValue("1");
  await a
    .getByRole("spinbutton", { name: "Slots / server", exact: true })
    .fill("2");
  await page.getByRole("button", { name: "Add variant", exact: true }).click();
  const b = page.getByRole("region", {
    name: "Variant B configuration",
    exact: true,
  });
  await b
    .getByRole("spinbutton", { name: "Slots / server", exact: true })
    .fill("3");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  const results = page.getByRole("region", {
    name: "Comparison results",
    exact: true,
  });
  await expect(results).toBeVisible();
  const row = results.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Completed requests", exact: true }),
  });
  await expect(row.getByRole("cell").nth(1)).toHaveText("1");
  await expect(row.getByRole("cell").nth(2)).toContainText("2");
  await expect(row.getByRole("cell").nth(2)).toContainText("Δ +1");
  await expect(row.getByRole("cell").nth(3)).toContainText("Δ +2");
  await expect(results).toContainText("not an isolated policy effect");
  await expect(results).toContainText("Slots per server");
  await page.screenshot({
    path: "test-results/comparison-desktop.png",
    fullPage: true,
  });
  let requests = 0;
  await page.route("**/api/engine/run", (route) => {
    requests++;
    return requests === 2
      ? route.fulfill({
          status: 429,
          json: { code: "BUSY", message: "Engine is busy." },
        })
      : route.continue();
  });
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Variant A failed" }),
  ).toBeVisible();
  await expect(row.getByRole("cell").nth(3)).toContainText("Δ +2");
  await page.getByRole("link", { name: "Lab", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("1");
  await expect(
    page.getByRole("spinbutton", { name: "Requests per second", exact: true }),
  ).toHaveValue("10.00");
});

test("mobile template opens setup automatically and closes it after a successful run", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Search setups" })
    .fill("Light traffic");
  await page.getByRole("link", { name: "Use template", exact: true }).click();
  const sheet = page.getByRole("dialog", {
    name: "Run configuration",
    exact: true,
  });
  await expect(sheet).toBeVisible();
  await sheet
    .getByRole("spinbutton", { name: "Arrival window (seconds)", exact: true })
    .fill("2");
  await sheet
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await expect(sheet).not.toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Page navigation", exact: true }),
  ).toContainText("Lab");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Page navigation", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Compare", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Compare configurations" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/comparison-mobile.png",
    fullPage: true,
  });
});

test("comparison rejects unchanged variants before requesting work", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/engine/run", (route) => {
    calls++;
    return route.abort();
  });
  await page.goto("/compare");
  const variant = page.getByRole("region", {
    name: "Variant A configuration",
    exact: true,
  });
  await variant.getByLabel("Routing policy", { exact: true }).click();
  await page.getByRole("option", { name: "Round robin", exact: true }).click();
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "change at least one setting" }),
  ).toBeVisible();
  expect(calls).toBe(0);
});
