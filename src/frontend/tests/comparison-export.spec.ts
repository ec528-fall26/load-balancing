import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("Compare checks the offered workload and exports metrics and settings", async ({ page }) => {
  await page.goto("/setup?template=io-heavy-routing");
  await page.getByRole("button", { name: "Compare current setup" }).click();
  const variant = page.getByRole("region", { name: "Variant A configuration" });
  await variant.getByLabel("Change a setting", { exact: true }).click();
  await page.getByRole("option", { name: "Routing policy", exact: true }).click();
  await variant.getByLabel("Routing policy", { exact: true }).click();
  await page.getByRole("option", { name: "Least active requests", exact: true }).click();

  const run = page.getByRole("button", { name: "Run comparison", exact: true });
  await run.click();
  await expect(page.getByText("Offered workload matches", { exact: true })).toBeVisible();

  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("load-balancing-comparison.csv");
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain('"p95_scope"');
  expect(csv).toContain('"workload_sha256"');
  expect(csv).toContain('"Variant A"');
  expect(csv).toContain('""policy"":""least_active_requests""');
  const hashes = csv.match(/"[a-f0-9]{64}"/g);
  expect(hashes).toHaveLength(2);
  expect(hashes?.[0]).toBe(hashes?.[1]);

  await variant.getByLabel("Change a setting", { exact: true }).click();
  await page.getByRole("option", { name: "Random seed", exact: true }).click();
  await variant.getByRole("spinbutton", { name: "Random seed", exact: true }).fill("43");
  await run.click();
  await expect(page.getByText("Offered workloads differ", { exact: true })).toBeVisible();
});
