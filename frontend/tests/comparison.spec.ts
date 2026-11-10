import { test, expect } from "@playwright/test";

test("lab draft comparison runs baseline and two variants, retaining results on failure", async ({
  page,
}) => {
  await page.goto("/setup");

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
  await expect(a).toContainText("Matches baseline");
  await a.getByLabel("Change a setting", { exact: true }).click();
  await page
    .getByRole("option", { name: "Slots per server", exact: true })
    .click();
  await a
    .getByRole("spinbutton", { name: "Slots per server", exact: true })
    .fill("2");
  await page
    .getByRole("button", { name: "Clone baseline", exact: true })
    .click();
  const b = page.getByRole("region", {
    name: "Variant B configuration",
    exact: true,
  });
  await b.getByLabel("Change a setting", { exact: true }).click();
  await page
    .getByRole("option", { name: "Slots per server", exact: true })
    .click();
  await b
    .getByRole("spinbutton", { name: "Slots per server", exact: true })
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
  await page.getByRole("link", { name: "Setup", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("1");
  await expect(
    page.getByRole("spinbutton", { name: "Requests per second", exact: true }),
  ).toHaveValue("10.00");
});

test("mobile bottom navigation connects Library, Setup, Lab and Compare", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Search setups" })
    .fill("Light traffic");
  await page.getByRole("link", { name: "Use template", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Set up a simulation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Arrival window (seconds)", exact: true })
    .fill("2");
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/simulator$/);
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    navigation.getByRole("link", { name: "Lab", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link")).toHaveCount(4);
  await navigation.getByRole("link", { name: "Compare", exact: true }).click();
  await expect(
    navigation.getByRole("link", { name: "Compare", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Compare configurations" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/mobile-navigation.png" });
  const backToSetup = page.getByRole("link", { name: "Back to Setup" });
  await backToSetup.scrollIntoViewIfNeeded();
  const bar = await navigation.boundingBox();
  const lastControl = await backToSetup.boundingBox();
  expect(bar!.y + bar!.height).toBeCloseTo(844);
  expect(lastControl!.y + lastControl!.height).toBeLessThanOrEqual(bar!.y);
  await navigation.getByRole("link", { name: "Setup", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Arrival window (seconds)" }),
  ).toHaveValue("2.00");
  await navigation.getByRole("link", { name: "Lab", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeVisible();
  await navigation.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    navigation.getByRole("link", { name: "Library", exact: true }),
  ).toHaveAttribute("aria-current", "page");
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
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "change at least one setting" }),
  ).toBeVisible();
  expect(calls).toBe(0);
});

test("clones are exact copies, nested clones preserve changes, and reset removes overrides", async ({
  page,
}) => {
  await page.goto("/compare");
  const a = page.getByRole("region", {
    name: "Variant A configuration",
    exact: true,
  });
  await expect(a).toContainText("Matches baseline");
  await expect(a.getByRole("spinbutton")).toHaveCount(0);
  await a.getByLabel("Change a setting", { exact: true }).click();
  await page
    .getByRole("option", { name: "Requests per second", exact: true })
    .click();
  await a
    .getByRole("spinbutton", { name: "Requests per second", exact: true })
    .fill("2");
  await expect(a.getByRole("table")).toContainText("1");
  await expect(a).toContainText("1 changed");
  await a.getByRole("button", { name: "Clone Variant A", exact: true }).click();
  const b = page.getByRole("region", {
    name: "Variant B configuration",
    exact: true,
  });
  await expect(
    b.getByRole("spinbutton", { name: "Requests per second", exact: true }),
  ).toHaveValue("2.00");
  await b.getByLabel("Change a setting", { exact: true }).click();
  await page
    .getByRole("option", { name: "Slots per server", exact: true })
    .click();
  await b
    .getByRole("spinbutton", { name: "Slots per server", exact: true })
    .fill("2");
  await expect(b).toContainText("2 changed");
  await expect(a).toContainText("1 changed");
  await b
    .getByRole("button", { name: "Reset Slots per server", exact: true })
    .click();
  await expect(b).toContainText("1 changed");
  await a
    .getByRole("button", { name: "Reset to baseline", exact: true })
    .click();
  await expect(a).toContainText("Matches baseline");
  await expect(b).toContainText("1 changed");
  await expect(
    page.getByRole("region", { name: "Baseline configuration", exact: true }),
  ).toContainText("2 servers × 1 slots");
});

test("regional live setup transfers through navigation and compares only the selected compute change", async ({
  page,
  request,
}) => {
  let sid = "";
  try {
    await page.goto("/setup");

    await page.getByLabel("Topology", { exact: true }).click();
    await page.getByRole("option", { name: "Regions", exact: true }).click();
    await page
      .getByRole("spinbutton", { name: "Requests per second", exact: true })
      .fill("10");
    await page
      .getByRole("spinbutton", {
        name: "Arrival window (seconds)",
        exact: true,
      })
      .fill("1");
    await page.getByLabel("Execution", { exact: true }).click();
    await page.getByRole("option", { name: "Continuous", exact: true }).click();
    const started = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/sessions" &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Start continuous simulation", exact: true })
      .click();
    sid = (await (await started).json()).session_id;
    await expect(
      page.getByRole("button", { name: "Pause session", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Pause session", exact: true })
      .click();
    await page.getByRole("link", { name: "Compare", exact: true }).click();
    const a = page.getByRole("region", {
      name: "Variant A configuration",
      exact: true,
    });
    await expect(
      page.getByRole("region", { name: "Baseline configuration", exact: true }),
    ).toContainText("3 regions · 30 servers");
    await expect(a).toContainText("Matches baseline");
    await a.getByLabel("Change a setting", { exact: true }).click();
    await page
      .getByRole("option", {
        name: "us-west-1 · Compute multiplier",
        exact: true,
      })
      .click();
    await a
      .getByRole("spinbutton", {
        name: "us-west-1 · Compute multiplier",
        exact: true,
      })
      .fill("2");
    const payloads: unknown[] = [];
    await page.route("**/api/regions/run", async (route) => {
      payloads.push(route.request().postDataJSON().config);
      await route.continue();
    });
    await page
      .getByRole("button", { name: "Run comparison", exact: true })
      .click();
    const results = page.getByRole("region", {
      name: "Comparison results",
      exact: true,
    });
    await expect(results).toBeVisible();
    expect(payloads).toHaveLength(2);
    const [base, variant] = payloads as { regions: { compute: number }[] }[];
    expect(base.regions[2].compute).toBe(1);
    expect(variant.regions[2].compute).toBe(2);
    expect({ ...variant, regions: base.regions }).toEqual(base);
    await expect(results).toContainText("Recent-window p95");
    await expect(results).toContainText("us-west-1 · Compute multiplier");
    expect(
      (await (await request.get(`/api/sessions/${sid}/snapshot`)).json())
        .status,
    ).toBe("paused");
    await page.screenshot({
      path: "test-results/comparison-regional-desktop.png",
      fullPage: true,
    });
    await page
      .getByRole("link", { name: "Back to Setup", exact: true })
      .click();
    await expect(page.getByLabel("Topology", { exact: true })).toContainText(
      "Regions",
    );
    await page
      .getByRole("link", { name: "Return to Lab", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Resume session", exact: true }),
    ).toBeVisible();
  } finally {
    if (sid) await request.delete(`/api/sessions/${sid}`);
  }
});
