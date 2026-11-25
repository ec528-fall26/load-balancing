import { expect, test } from "@playwright/test";

test("Compare shows how backoff recovers requests rejected by immediate retries", async ({ page }) => {
  await page.goto("/setup?new=1");
  const fields = {
    "Server count": "1",
    "Slots per server": "1",
    "Waiting places per server": "0",
    "Requests per second": "2",
    "Arrival window (seconds)": "1",
    "Max service (s)": "1",
    "Min service (s)": "1",
  };
  for (const [name, amount] of Object.entries(fields)) {
    await page.getByRole("spinbutton", { name, exact: true }).fill(amount);
  }
  await page.getByRole("combobox", { name: "Client retry policy", exact: true }).click();
  await page.getByRole("option", { name: "Exponential backoff with jitter", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Base retry delay (ms)", exact: true }).fill("1200");
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

