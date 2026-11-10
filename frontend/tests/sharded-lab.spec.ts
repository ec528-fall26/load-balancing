import { expect, test } from "@playwright/test";

test("Sharded service runs in the Lab and Compare reuses the completed workload", async ({
  page,
}) => {
  await page.goto("/setup");
  await page.getByRole("combobox", { name: "Execution", exact: true }).click();
  await page.getByRole("option", { name: "Continuous", exact: true }).click();
  await page.getByRole("combobox", { name: "Topology", exact: true }).click();
  await page
    .getByRole("option", { name: "Sharded service", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Execution", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: "2 shards", exact: true }).click();
  const slowdown = page.getByRole("slider", { name: "Shard CPU slowdown (×)" });
  await slowdown.press("ArrowRight");
  await expect(slowdown).toHaveAttribute("aria-valuenow", "5");
  const exactSlowdown = page.getByRole("spinbutton", {
    name: "Shard CPU slowdown (×)",
  });
  await expect(exactSlowdown).toHaveValue("5");
  await exactSlowdown.fill("7");
  await expect(slowdown).toHaveAttribute("aria-valuenow", "7");
  const deadlineHelp = page.getByRole("button", {
    name: "About parent deadline (ms)",
  });
  await deadlineHelp.hover();
  await expect(page.getByRole("tooltip")).toContainText("final join");
  await deadlineHelp.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const deadline = page.getByRole("spinbutton", {
    name: "Parent deadline (ms)",
    exact: true,
  });
  await deadline.fill("210");
  await page.getByRole("radio", { name: "Shard 2", exact: true }).click();

  const result = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/fan-out/run") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  const run = await (await result).json();
  expect(run.settings.slowdown).toBe(7);
  expect(run.result.mean_ms).toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/simulator$/);
  await expect(
    page.getByRole("heading", { name: "Did requests finish on time?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Shard 2 share of calls" }),
  ).toBeVisible();
  await expect(page.getByText("7× CPU time", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Follow request 0" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Request events" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Full event timeline" }).click();
  await expect(
    page.getByRole("region", { name: "Request events" }),
  ).toBeVisible();

  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await deadline.fill("250");
  await page.getByRole("link", { name: "Return to Lab", exact: true }).click();
  await page
    .getByRole("button", { name: "Compare this run", exact: true })
    .click();
  await expect(deadline).toHaveValue("210");
  const experiment = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/research/fan-out") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run experiment", exact: true })
    .click();
  const comparison = await (await experiment).json();
  expect(comparison.workload_sha256).toBe(run.workload_sha256);
  expect(comparison.cases).toHaveLength(4);
  await page
    .getByRole("button", { name: "4 shards · slow shard", exact: true })
    .click();
  await expect(
    page.getByText("Queues · 4 shards · slow shard", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Lab", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Did requests finish on time?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Shard 2 share of calls" }),
  ).toBeVisible();
  await expect(page.getByText("7× CPU time", { exact: true })).toBeVisible();
  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(deadline).toHaveValue("250");
  await page.reload();
  await expect(deadline).toHaveValue("250");
  await page.goto("/fan-out");
  await expect(page).toHaveURL(/\/compare\?fanout=1$/);
});

test("Lab and Compare show the same seeded shard outage", async ({ page }) => {
  await page.goto("/setup");
  await page.getByRole("combobox", { name: "Topology", exact: true }).click();
  await page
    .getByRole("option", { name: "Sharded service", exact: true })
    .click();
  const duration = page.getByRole("spinbutton", {
    name: "Seeded outage duration (ms)",
    exact: true,
  });
  await duration.fill("500");
  await page
    .getByRole("spinbutton", { name: "Shard CPU slowdown (×)" })
    .fill("1");
  const runResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/fan-out/run") && r.ok(),
  );
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  const run = await (await runResponse).json();
  const outage = run.result.outage;
  await expect(
    page.getByText(`Shard ${outage.shard} went offline`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Outage failures", { exact: true }),
  ).toBeVisible();
  expect(run.result.outage_failed).toBeGreaterThan(0);

  await page
    .getByRole("button", { name: "Compare this run", exact: true })
    .click();
  await expect(duration).toHaveValue("500");
  const compareResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/research/fan-out") && r.ok(),
  );
  await page
    .getByRole("button", { name: "Run experiment", exact: true })
    .click();
  const compare = await (await compareResponse).json();
  expect(compare.workload_sha256).toBe(run.workload_sha256);
  expect(compare.cases.map((item: { outage: unknown }) => item.outage)).toEqual(
    [null, outage, null, outage],
  );
  await expect(
    page.getByRole("button", { name: "4 shards · seeded outage", exact: true }),
  ).toBeVisible();
});
