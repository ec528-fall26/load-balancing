import { test, expect, type Page } from "@playwright/test";

async function select(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function runRegional(page: Page, policy: string) {
  await page.goto("/setup");
  await select(page, "Topology", "Regions");
  await select(page, "Regional preset", "US · balanced");
  await select(page, "Regional routing policy", policy);
  for (const [name, value] of [
    ["Requests per second", "130"],
    ["Min service (s)", "0.1"],
    ["Max service (s)", "1"],
    ["Arrival window (seconds)", "5"],
  ])
    await page.getByRole("spinbutton", { name, exact: true }).fill(value);
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/regions/run",
  );
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  return (await response).json();
}

test("nearest region under 90% load stays local and spills over instead of rejecting", async ({
  page,
}) => {
  const nearest = await runRegional(page, "Nearest region");
  expect(nearest.config.policy).toBe("nearest");
  expect(nearest.summary.totals.offered).toBe(650);
  expect(nearest.summary.totals.rejected).toBeGreaterThan(0);
  await page.screenshot({
    path: "test-results/regional-nearest.png",
    fullPage: true,
  });

  const spill = await runRegional(page, "Nearest region under 90% load");
  expect(spill.config.policy).toBe("nearest_under_load");
  expect(spill.summary.totals.offered).toBe(650);
  expect(spill.summary.totals.rejected).toBe(0);
  const completed = spill.summary.regions.map(
    (r: { completed: number }) => r.completed,
  );
  // Most work stays in the source region (us-east-1); the far region gets the least.
  expect(completed[0]).toBeGreaterThan(completed[1]);
  expect(completed[1]).toBeGreaterThan(completed[2]);
  await expect(page.getByTestId("regional-accounting")).toHaveText(
    "650 offered = 650 completed + 0 rejected + 0 executing + 0 waiting + 0 in transit.",
  );
  await page.screenshot({
    path: "test-results/regional-nearest-under-load.png",
    fullPage: true,
  });
});
