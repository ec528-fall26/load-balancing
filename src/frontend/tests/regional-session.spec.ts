import { test, expect, type Page } from "@playwright/test";
const created = new WeakMap<Page, Set<string>>();
test.beforeEach(async ({ page }) => {
  const ids = new Set<string>();
  created.set(page, ids);
  page.on("response", async (r) => {
    if (
      new URL(r.url()).pathname === "/api/sessions" &&
      r.request().method() === "POST" &&
      r.status() === 201
    )
      ids.add((await r.json()).session_id);
  });
});
test.afterEach(async ({ page, request }) => {
  for (const id of created.get(page) ?? [])
    await request.delete("/api/sessions/" + id);
});
async function select(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function regions(page: Page) {
  await select(page, "Topology", "Regions");
}
async function smallTraffic(page: Page) {
  await page
    .getByRole("spinbutton", { name: "Requests per second", exact: true })
    .fill("20");
  await page
    .getByRole("spinbutton", { name: "Min service (s)", exact: true })
    .fill(".02");
  await page
    .getByRole("spinbutton", { name: "Max service (s)", exact: true })
    .fill(".02");
}

test("regional one-shot uses presets, source/RTT/compute edits, fully drains and preserves results on invalid config", async ({
  page,
}) => {
  await page.goto("/setup");
  await regions(page);
  await select(page, "Regional preset", "US · compute in the west");
  await select(page, "Source region", "us-west-1");
  await page.getByRole("button", { name: "us-east-1", exact: true }).click();
  await expect
    .poll(async () =>
      page
        .getByRole("region", { name: "us-east-1", exact: true })
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    )
    .toBe(true);
  await page
    .getByRole("spinbutton", {
      name: "us-east-1 Compute multiplier",
      exact: true,
    })
    .fill("2.5");
  await page
    .getByRole("spinbutton", {
      name: "Client RTT to us-east-1 (ms)",
      exact: true,
    })
    .fill("45");
  await page
    .getByRole("button", { name: "Regional RTT matrix", exact: true })
    .click();
  await page
    .getByRole("spinbutton", {
      name: "us-west-1 to us-east-1 (ms)",
      exact: true,
    })
    .fill("65");
  await select(page, "Regional routing policy", "Round robin across regions");
  await smallTraffic(page);
  await page
    .getByRole("spinbutton", { name: "Arrival window (seconds)", exact: true })
    .fill("1");
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/regions/run",
  );
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  const result = await (await response).json();
  expect(result.config.source).toBe(2);
  expect(result.config.regions[0].compute).toBe(2.5);
  expect(result.config.client_latency_ms[0]).toBe(45);
  expect(result.config.latency_ms[2][0]).toBe(65);
  expect(result.summary.totals.offered).toBe(20);
  expect(result.summary.totals.in_transit).toBe(0);
  expect(result.summary.totals.running).toBe(0);
  expect(result.summary.totals.waiting).toBe(0);
  await expect(page.getByTestId("regional-accounting")).toHaveText(
    "20 offered = 20 completed + 0 rejected + 0 executing + 0 waiting + 0 in transit.",
  );
  await expect(
    page.getByLabel("Region us-east-1", { exact: true }),
  ).toContainText("2.5× compute");
  await expect(
    page.getByLabel("Region us-east-1", { exact: true }),
  ).toContainText("45 ms client RTT");
  await expect(
    page.getByText("Recent response times", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await page.getByRole("button", { name: "us-east-1", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Region 1 name", exact: true })
    .fill("us-east-2");
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Region names must be unique" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to Lab", exact: true }).click();
  await expect(page.getByTestId("regional-accounting")).toContainText(
    "20 offered = 20 completed",
  );
  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await page
    .getByRole("button", { name: "us-east-2", exact: true })
    .first()
    .click();
  await expect
    .poll(async () =>
      page
        .getByRole("textbox", { name: "Region 1 name", exact: true })
        .evaluate((el) => {
          const content = el.closest('[data-slot="accordion-content"]')!;
          const last = content.querySelectorAll("input");
          return (
            last[last.length - 1].getBoundingClientRect().bottom <=
            content.getBoundingClientRect().bottom + 1
          );
        }),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/regional-desktop.png",
    fullPage: true,
  });
});

test("regional continuous sessions reconnect, preserve active settings, drain, restart and switch topology cleanly", async ({
  page,
}) => {
  await page.goto("/setup");
  await regions(page);
  await smallTraffic(page);
  await select(page, "Regional preset", "Global · mixed compute");
  await select(page, "Regional routing policy", "Nearest region");
  await select(page, "Execution", "Continuous");
  await expect(
    page.getByRole("spinbutton", {
      name: "Arrival window (seconds)",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Start continuous simulation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause session", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        (await page.getByText(/^Simulated time:/).innerText()).match(
          /([\d.]+) s/,
        )?.[1],
      ),
    )
    .toBeGreaterThan(0.1);
  await page
    .getByRole("button", { name: "Pause session", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume session", exact: true }),
  ).toBeVisible();
  const paused = await page.getByText(/^Simulated time:/).innerText();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Resume session", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await expect(page.getByLabel("Topology", { exact: true })).toContainText(
    "Regions",
  );
  await expect(
    page.getByLabel("Regional routing policy", { exact: true }),
  ).toContainText("Nearest region");
  await page.getByRole("link", { name: "Return to Lab", exact: true }).click();
  await expect(page.getByText(/^Simulated time:/)).toHaveText(paused);
  await expect(
    page.getByLabel("Region ap-northeast-1", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Requests per second", exact: true })
    .fill("400");
  await page.getByRole("link", { name: "Return to Lab", exact: true }).click();
  await expect(
    page.getByText("Current traffic:", { exact: false }),
  ).toContainText("20 requests/s");
  await page
    .getByRole("button", { name: "Session options", exact: true })
    .click();
  await page.getByRole("spinbutton", { name: "Live requests per second" }).fill("30");
  await page.getByRole("button", { name: "Apply traffic", exact: true }).click();
  await expect(page.getByText(/Current traffic:/)).toContainText("30 requests/s");
  const restarted = page.waitForResponse((r) =>
    r.url().endsWith("/api/sessions") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Restart session", exact: true }).click();
  const restartedResponse = await restarted;
  expect(restartedResponse.status()).toBe(201);
  expect((await restartedResponse.json()).arrival_rate).toBe(30);
  await expect(page.getByText(/Current traffic:/)).toContainText("30 requests/s");
  await expect(page.getByRole("button", { name: "Pause session", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause session", exact: true }).click();
  const options = page.getByRole("button", { name: "Session options", exact: true });
  await expect(options).toHaveAttribute("aria-expanded", "false");
  await options.click();
  await select(page, "Simulation speed", "10×");
  await page
    .getByRole("button", { name: "Drain traffic", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Resume session", exact: true })
    .click();
  await expect(page.getByTestId("regional-accounting")).toHaveText(
    /\+ 0 executing \+ 0 waiting \+ 0 in transit\.$/,
  );
  await page
    .getByRole("button", { name: "Pause session", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Replace continuous session", exact: true })
    .click();
  await expect(
    page.getByText("Current traffic:", { exact: false }),
  ).toContainText("400 requests/s");
  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await select(page, "Topology", "Single server pool");
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toBeVisible();
  await select(page, "Execution", "One-shot");
  await expect(
    page.getByRole("spinbutton", {
      name: "Arrival window (seconds)",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to Lab", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop session", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Region ap-northeast-1", { exact: true }),
  ).toBeVisible();
});

test("regional mobile setup closes after run/start and live telemetry fits the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/setup");
  await regions(page);
  await smallTraffic(page);
  await page
    .getByRole("spinbutton", { name: "Arrival window (seconds)", exact: true })
    .fill("1");
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByLabel("Regional results", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await select(page, "Execution", "Continuous");
  await page
    .getByRole("button", { name: "Start continuous simulation", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Pause session", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pause session", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/regional-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
});
