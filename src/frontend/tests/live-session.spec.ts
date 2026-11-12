import { test, expect, type Page } from "@playwright/test";
import { liveFixture } from "./fixtures/live-snapshot";
const created = new WeakMap<Page, Set<string>>();
test.beforeEach(async ({ page }) => {
  const ids = new Set<string>();
  created.set(page, ids);
  page.on("response", async (response) => {
    if (
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/sessions" &&
      response.status() === 201
    ) {
      try {
        ids.add((await response.json()).session_id);
      } catch {}
    }
  });
});
test.afterEach(async ({ page, request }) => {
  for (const id of created.get(page) ?? [])
    await request.delete("/api/sessions/" + id);
});
async function continuousMode(page: Page) {
  await page.getByLabel("Execution", { exact: true }).click();
  await page.getByRole("option", { name: "Continuous", exact: true }).click();
}

test("real continuous session starts, polls, pauses, reconnects, drains, paginates and stops", async ({
  page,
}) => {
  await page.goto("/setup");

  await page
    .getByRole("spinbutton", { name: "Server count", exact: true })
    .fill("40");
  await page
    .getByRole("spinbutton", { name: "Slots per server", exact: true })
    .fill("4");
  await page
    .getByRole("spinbutton", { name: "Requests per second", exact: true })
    .fill("1000");
  await continuousMode(page);
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
  await expect(page.getByText(/^Simulated time:/)).toHaveText(paused);
  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("40");
  await page.getByRole("link", { name: "Return to Lab", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(32);
  await page.getByLabel("Live server page", { exact: true }).click();
  await page
    .getByRole("option", { name: "Servers 32–39", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "Inspect server 32", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Session options", exact: true })
    .click();
  await page.getByLabel("Simulation speed", { exact: true }).click();
  await page.getByRole("option", { name: "10×", exact: true }).click();
  await expect(
    page.getByLabel("Simulation speed", { exact: true }),
  ).toContainText("10×");
  await page
    .getByRole("button", { name: "Drain traffic", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Resume session", exact: true })
    .click();
  await expect(
    page.getByText("Current traffic: 0 requests/s.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /; 0 running, 0 waiting, / }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect server 32", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pause session", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/live-session-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("spinbutton", { name: "Live requests per second", exact: true })
    .fill("50");
  await page
    .getByRole("button", { name: "Apply traffic", exact: true })
    .click();
  await expect(
    page.getByText("Current traffic: 50 requests/s.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Edit configuration", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("lbsim.active-session.v1")),
    )
    .toBeNull();
  await expect(
    page.getByText("Last retained snapshot; no longer live.", { exact: true }),
  ).toBeVisible();
});

test("polling is serialized, stale snapshots cannot undo commands, and expired sessions detach", async ({
  page,
}) => {
  await page.addInitScript(
    (id) =>
      sessionStorage.setItem(
        "lbsim.active-session.v1",
        JSON.stringify({ version: 1, id }),
      ),
    liveFixture.session_id,
  );
  let active = 0,
    maxActive = 0,
    completed = 0,
    expired = false;
  const starts: number[] = [];
  await page.route("**/api/sessions/*/snapshot?*", async (route) => {
    active++;
    maxActive = Math.max(maxActive, active);
    starts.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      await route.fulfill(
        expired
          ? {
              status: 410,
              json: {
                code: "SESSION_EXPIRED",
                message: "Session expired. Start another.",
              },
            }
          : {
              json: {
                ...liveFixture,
                revision: Math.min(99, completed + 1),
                simulation_time: 1,
                target_simulation_time: 1,
              },
            },
      );
    } catch {
    } finally {
      active--;
      completed++;
    }
  });
  await page.route("**/api/sessions/*/commands", (route) =>
    route.fulfill({
      json: {
        ...liveFixture,
        revision: 100,
        status: "paused",
        simulation_time: 100,
        target_simulation_time: 100,
      },
    }),
  );
  await page.goto("/simulator?mode=continuous");
  await expect.poll(() => completed).toBeGreaterThanOrEqual(3);
  expect(maxActive).toBe(1);
  for (let i = 1; i < starts.length; i++)
    expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(450);
  await page
    .getByRole("button", { name: "Pause session", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume session", exact: true }),
  ).toBeVisible();
  const afterCommand = completed;
  await expect.poll(() => completed).toBeGreaterThan(afterCommand);
  await expect(
    page.getByRole("button", { name: "Resume session", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^Simulated time:/)).toContainText("100.00 s");
  expired = true;
  await expect(
    page.getByRole("alert").filter({ hasText: "Session expired" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Edit configuration", exact: true }),
  ).toBeVisible();
  const stoppedAt = completed;
  await page.waitForTimeout(1100);
  expect(completed).toBe(stoppedAt);
});

test("mobile run opens Lab and draft execution edits preserve the live session", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/setup");
  await continuousMode(page);
  await page
    .getByRole("button", { name: "Start continuous simulation", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Run configuration", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause session", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/live-session-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await page.getByLabel("Execution", { exact: true }).click();
  await page.getByRole("option", { name: "One-shot", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run simulation", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("lbsim.active-session.v1"),
    ),
  ).not.toBeNull();
  await page.getByRole("link", { name: "Return to Lab", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause session", exact: true }),
  ).toBeVisible();
});

test("a rejected replacement leaves the active run usable", async ({ page, request }) => {
  await page.goto("/setup?mode=continuous");
  const start = page.getByRole("button", { name: "Start continuous simulation", exact: true });
  await start.click();
  await expect(page.getByRole("button", { name: "Pause session", exact: true })).toBeVisible();
  await expect.poll(() => created.get(page)?.size).toBe(1);
  const [old] = created.get(page)!;
  await page.getByRole("link", { name: "Edit configuration", exact: true }).click();
  await page.route("**/api/sessions", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.replace_session_id).toBe(old);
    await route.continue({ postData: { ...body, config: { ...body.config, server_count: 0 } } });
  }, { times: 1 });
  const rejected = page.waitForResponse((response) =>
    response.url().endsWith("/api/sessions") && response.status() === 422,
  );
  await page.getByRole("button", { name: "Replace continuous session", exact: true }).click();
  await rejected;
  expect((await request.get(`/api/sessions/${old}/snapshot`)).ok()).toBe(true);
  await page.getByRole("link", { name: "Return to Lab", exact: true }).click();
  await page.getByRole("button", { name: "Pause session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume session", exact: true })).toBeVisible();
});
