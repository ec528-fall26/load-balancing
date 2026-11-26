import { expect, test, type Page } from "@playwright/test";

const overloadFields = {
  "Server count": "1",
  "Slots per server": "1",
  "Waiting places per server": "0",
  "Requests per second": "2",
  "Arrival window (seconds)": "1",
  "Max service (s)": "1",
  "Min service (s)": "1",
};

async function configureBackoff(page: Page) {
  await page.goto("/setup?new=1");
  for (const [name, amount] of Object.entries(overloadFields)) {
    await page.getByRole("spinbutton", { name, exact: true }).fill(amount);
  }
  await page.getByRole("combobox", { name: "Client retry policy", exact: true }).click();
  await page.getByRole("option", { name: "Exponential backoff with jitter", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Base retry delay (ms)", exact: true }).fill("1200");
}

test("Compare shows how backoff recovers requests rejected by immediate retries", async ({ page }) => {
  await configureBackoff(page);
  await page.getByRole("button", { name: "Compare current setup" }).click();

  const variant = page.getByRole("region", { name: "Variant A configuration" });
  await variant.getByLabel("Change a setting", { exact: true }).click();
  await page.getByRole("option", { name: "Client retry policy", exact: true }).click();
  await variant.getByLabel("Client retry policy", { exact: true }).click();
  await page.getByRole("option", { name: "Immediate retries", exact: true }).click();
  await page.getByRole("button", { name: "Run comparison", exact: true }).click();

  const results = page.getByRole("region", { name: "Comparison results" });
  await expect(results).toBeVisible({ timeout: 20_000 });
  const completed = results.getByRole("row", { name: /Completed requests/ }).getByRole("cell");
  await expect(completed.nth(1)).toHaveText("2");
  await expect(completed.nth(2)).toContainText("Δ -1");
  const retries = results.getByRole("row", { name: /Retry attempts/ }).getByRole("cell");
  await expect(retries.nth(1)).toHaveText("1");
  await expect(retries.nth(2)).toContainText("Δ +2");
});

test("Lab playback accounts for backoff and explains saved-run export availability", async ({ page }) => {
  await configureBackoff(page);
  const created = page.waitForResponse((response) =>
    response.url().endsWith("/api/engine/run") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run simulation", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { run_id: runId, summary } = await response.json();
  try {
    await page.getByRole("button", { name: "Download run", exact: true }).click();
    await expect(page.getByText("Saved-run downloads are unavailable with client retries.", { exact: false }))
      .toBeVisible();
    await expect(page.getByRole("button", { name: "Download configuration (JSON)" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download results (CSV)" })).toHaveCount(0);

    await page.getByRole("tab", { name: "Datacenter", exact: true }).click();
    const slider = page.getByRole("slider");
    await slider.press("Home");
    const stepSize = Math.min(0.1, summary.end_time / 100);
    const stepsToBackoff = Math.round(0.75 / stepSize);
    for (let step = 0; step < stepsToBackoff; step++) await slider.press("ArrowRight");
    await expect(page.getByRole("img", {
      name: "2 of 2 requests arrived; 1 running, 0 waiting, 1 waiting to retry, 0 completed, 0 rejected",
    })).toBeVisible();
    await slider.press("End");
    await expect(page.getByRole("img", {
      name: "2 of 2 requests arrived; 0 running, 0 waiting, 0 waiting to retry, 2 completed, 0 rejected",
    })).toBeVisible();
  } finally {
    await page.request.delete(`/api/runs/${runId}`);
  }
});
