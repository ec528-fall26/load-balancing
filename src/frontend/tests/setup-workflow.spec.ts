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
