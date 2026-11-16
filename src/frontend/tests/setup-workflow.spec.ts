import { test, expect } from "@playwright/test";

test("Setup, Lab and Compare preserve completed results and distinguish the draft from the run", async ({
  page,
  request,
}) => {
  await page.goto("/setup?template=light-traffic");
  await page
    .getByRole("spinbutton", { name: "Arrival window (seconds)", exact: true })
    .fill("1");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/engine/run") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  const run = await (await response).json();
  try {
    await expect(page).toHaveURL(/\/simulator$/);
    await expect(
      page.getByRole("heading", { name: "Simulation Lab", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("spinbutton", { name: "Server count", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("link", { name: "Edit configuration", exact: true })
      .click();
    await page
      .getByRole("spinbutton", { name: "Server count", exact: true })
      .fill("17");
    await page
      .getByRole("link", { name: "Return to Lab", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Run configuration", exact: true })
      .click();
    await expect(page.locator("main pre")).toContainText(
      `"server_count": ${run.config.server_count}`,
    );
    await page
      .getByRole("button", { name: "Compare this run", exact: true })
      .click();
    const baseline = page.getByRole("region", {
      name: "Baseline configuration",
      exact: true,
    });
    await expect(baseline).toContainText(`${run.config.server_count} servers`);
    await page
      .getByRole("link", { name: "Back to Setup", exact: true })
      .click();
    await expect(
      page.getByRole("spinbutton", { name: "Server count", exact: true }),
    ).toHaveValue("17");
    await page
      .getByRole("link", { name: "Return to Lab", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Overview", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Run configuration", exact: true })
      .click();
    await expect(page.locator("main pre")).toContainText(
      `"server_count": ${run.config.server_count}`,
    );
    await page.screenshot({
      path: "/tmp/ec528-focused-lab.png",
      fullPage: true,
    });
  } finally {
    if (run.run_id) await request.delete("/api/runs/" + run.run_id);
  }
});

test("legacy template links open editable Setup; edits survive reload and New simulation starts fresh", async ({
  page,
}) => {
  await page.goto("/simulator?template=mixed-cpu-io&mode=continuous");
  await expect(page).toHaveURL(/\/setup\?template=mixed-cpu-io/);
  await expect(
    page.getByRole("combobox", { name: "Workload", exact: true }),
  ).toContainText("Mixed");
  await page
    .getByRole("spinbutton", { name: "Server count", exact: true })
    .fill("19");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("lbsim.workspace-draft.v1") ?? "{}")
            .config?.server_count,
      ),
    )
    .toBe(19);
  await expect(page).not.toHaveURL(/template=/);
  await page.reload();
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("19");
  await expect(
    page.getByRole("combobox", { name: "Execution", exact: true }),
  ).toContainText("Continuous");
  await expect(
    page.getByRole("combobox", { name: "Workload", exact: true }),
  ).toContainText("Mixed");
  await page.screenshot({
    path: "/tmp/ec528-dedicated-setup.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Load balancing lab home", exact: true })
    .click();
  await page.getByRole("link", { name: "New simulation", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByRole("combobox", { name: "Execution", exact: true }),
  ).toContainText("One-shot");
});

test("availability survives invalid server counts without crashing Setup", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto("/setup?new=1");
  const count = page.getByRole("spinbutton", { name: "Server count", exact: true });
  const availability = page.getByLabel("Server availability", { exact: true });
  await expect(page.getByRole("button", { name: "Run simulation", exact: true })).toBeEnabled();

  await availability.fill("0.9");
  await count.fill("-1");
  await count.press("Tab");
  await expect(availability).toHaveValue("0.9");
  await count.fill("1.5");
  await availability.fill("0.8");
  await count.fill("3");
  await count.press("Tab");
  await expect(availability).toHaveValue("0.8");
  await page.getByRole("button", { name: "Compare current setup" }).click();
  await expect(page.getByRole("region", { name: "Baseline configuration" })).toContainText("3 servers");
  expect(errors).toEqual([]);
});

test("regional one-shot Setup reflects fractional traffic at the exclusive cutoff", async ({ page }) => {
  await page.goto("/setup");
  await page.getByLabel("Topology", { exact: true }).click();
  await page.getByRole("option", { name: "Regions", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Requests per second", exact: true }).fill("2.5");
  await page.getByRole("spinbutton", { name: "Arrival window (seconds)", exact: true }).fill("1");
  await expect(page.locator("dt").filter({ hasText: /^Offered requests$/ }).locator("..").locator("dd")).toHaveText("3");
  const ran = page.waitForResponse((response) => response.url().endsWith("/api/regions/run"));
  await page.getByRole("button", { name: "Run simulation", exact: true }).click();
  const run = await (await ran).json();
  expect(run.summary.totals.offered).toBe(3);
});

test("a valid high-rate continuous draft and named save preserve execution mode", async ({ page }) => {
  await page.goto("/setup?new=1");
  const execution = page.getByRole("combobox", { name: "Execution", exact: true });
  const rate = page.getByRole("spinbutton", { name: "Requests per second", exact: true });
  await expect(page.getByRole("button", { name: "Run simulation", exact: true })).toBeEnabled();
  await execution.click();
  await page.getByRole("option", { name: "Continuous", exact: true }).click();
  await rate.fill("2000");
  await rate.press("Tab");
  await page.reload();
  await expect(execution).toHaveText("Continuous");
  await expect(rate).toHaveValue("2000.00");

  await page.getByRole("button", { name: "Save setup", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Setup name", { exact: true }).fill("High-rate live");
  await dialog.getByRole("button", { name: "Save setup", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("link", { name: "Load balancing lab home" }).click();
  await page.getByRole("link", { name: "High-rate live", exact: true }).click();
  await expect(execution).toHaveText("Continuous");
  await expect(rate).toHaveValue("2000.00");
});

test("switching to CPU/I/O clears availability before saving or comparing", async ({ page }) => {
  await page.goto("/setup?new=1");
  await expect(page.getByRole("button", { name: "Run simulation", exact: true })).toBeEnabled();
  await page.getByLabel("Server availability", { exact: true }).fill("0.9");
  await page.getByRole("combobox", { name: "Workload", exact: true }).click();
  await page.getByRole("option", { name: "I/O-heavy requests", exact: true }).click();
  await expect(page.getByLabel("Server availability", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Save setup", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Setup name", { exact: true }).fill("Staged workload");
  await dialog.getByRole("button", { name: "Save setup", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Compare current setup" }).click();
  await expect(page.getByRole("region", { name: "Baseline configuration" })).toBeVisible();
});

test("resizing a mixed-speed fleet preserves existing rates and accepts edits", async ({ page, request }) => {
  await page.goto("/setup?template=mixed-speed");
  const count = page.getByRole("spinbutton", { name: "Server count", exact: true });
  const rates = page.getByLabel("Processing rates", { exact: true });
  await expect(count).toHaveValue("6");
  await count.fill("");
  await count.pressSequentially("12");
  await count.press("Enter");
  await expect(rates).toHaveValue("0.5, 0.5, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1");
  await count.fill("7");
  await count.press("Tab");
  await expect(rates).toHaveValue("0.5, 0.5, 1, 1, 2, 2, 1");
  await rates.fill("0.5, 0.5, 1, 1, 2, 2, 1.5");
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/engine/run") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run simulation", exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  const run = await result.json();
  try {
    expect(run.config.processing_rates).toEqual([0.5, 0.5, 1, 1, 2, 2, 1.5]);
  } finally {
    await request.delete(`/api/runs/${run.run_id}`);
  }
});

test("an explicit template and a new setup take precedence over the tab draft", async ({ page }) => {
  await page.goto("/setup?new=1");
  const serverCount = page.getByRole("spinbutton", { name: "Server count", exact: true });
  await expect(page.getByRole("button", { name: "Run simulation", exact: true })).toBeEnabled();
  await serverCount.fill("19");
  await serverCount.press("Tab");
  await page.reload();
  await expect(serverCount).toHaveValue("19");

  await page.getByRole("link", { name: "Load balancing lab home" }).click();
  const mixedSpeed = page.getByRole("link", { name: "Use template", exact: true });
  await page.getByRole("textbox", { name: "Search setups" }).fill("Mixed-speed");
  await mixedSpeed.click();
  await expect(serverCount).toHaveValue("6");
  await expect(page.getByLabel("Processing rates", { exact: true })).toHaveValue("0.5, 0.5, 1, 1, 2, 2");

  await page.getByRole("link", { name: "Load balancing lab home" }).click();
  await page.getByRole("link", { name: "New simulation", exact: true }).click();
  await expect(serverCount).toHaveValue("2");
  await expect(page.getByLabel("Processing rates", { exact: true })).toHaveValue("");
});
