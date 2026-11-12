import { test, expect, type Page } from "@playwright/test";
const sessionIds = new WeakMap<Page, Set<string>>();
test.beforeEach(async ({ page }) => {
  const ids = new Set<string>();
  sessionIds.set(page, ids);
  page.on("response", async (r) => {
    if (
      r.url().endsWith("/api/sessions") &&
      r.request().method() === "POST" &&
      r.status() === 201
    ) {
      try {
        ids.add((await r.json()).session_id);
      } catch {}
    }
  });
});
test.afterEach(async ({ page, request }) => {
  for (const id of sessionIds.get(page) ?? [])
    await request.delete("/api/sessions/" + id);
});

test("CPU/I/O template runs inside the Lab with exact recorded state", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("link", { name: "CPU to I/O, step by step", exact: true })
    .click();
  await expect(page).toHaveURL(/setup\?template=cpu-io-walkthrough/);
  await expect(page.getByLabel("Workload", { exact: true })).toContainText(
    "Custom CPU / I/O split",
  );
  await page
    .getByRole("button", {
      name: "I/O capacity and request details",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "I/O share (%)", exact: true }),
  ).toHaveValue("50");
  const runResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/engine/run") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  const run = await (await runResponse).json();
  expect(run.summary.completed_count).toBe(2);
  expect(run.summary.p95_response_time).toBe(4.9);
  await page.getByRole("tab", { name: "Datacenter", exact: true }).click();
  const seek = page.getByRole("slider").first();
  await seek.focus();
  await seek.press("Home");
  for (let i = 0; i < 40; i++) await seek.press("ArrowRight");
  await expect(
    page.getByText("Recorded state at 2.00 s.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("2 I/O waiting", { exact: true }).first(),
  ).toBeVisible();
  const state = await (
    await page.request.get(`/api/runs/${run.run_id}/snapshot?time=2`)
  ).json();
  expect(state.totals).toMatchObject({
    running: 0,
    waiting: 0,
    io_waiting: 2,
    outstanding: 2,
  });
  await page.screenshot({ path: "/tmp/ec528-main-cpu-io.png", fullPage: true });
  await seek.press("End");
  await expect(
    page.getByText("Recorded state at 5.00 s.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("0 I/O waiting", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await page.getByRole("button", { name: "Save setup", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Setup name", { exact: true })
    .fill("Staged saved");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save setup", exact: true })
    .click();
  await page.reload();
  await expect(page.getByLabel("Workload", { exact: true })).toContainText(
    "Custom CPU / I/O split",
  );
  await page
    .getByRole("button", {
      name: "I/O capacity and request details",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "I/O share (%)", exact: true }),
  ).toHaveValue("50");
});

test("CPU/I/O live template conserves work through pause, resume and zero-traffic drain", async ({
  page,
}) => {
  await page.goto("/setup?template=io-heavy-live&mode=continuous");
  await expect(page.getByLabel("Workload", { exact: true })).toContainText(
    "I/O-heavy requests",
  );
  const create = page.waitForResponse(
    (r) => r.url().endsWith("/api/sessions") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Start continuous simulation", exact: true })
    .click();
  const initial = await (await create).json();
  expect(initial.config.request_model).toBe("cpu_io");
  await expect(page.getByText(/CPU active:.*I\/O waiting:/)).toBeVisible();
  await page
    .getByRole("button", { name: "Pause session", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume session", exact: true }),
  ).toBeVisible();
  const id = initial.session_id;
  const paused = await (
    await page.request.get("/api/sessions/" + id + "/snapshot")
  ).json();
  expect(paused.totals.offered).toBe(
    paused.totals.completed +
      paused.totals.rejected +
      paused.totals.outstanding,
  );
  expect(paused.totals.outstanding).toBe(
    paused.totals.running + paused.totals.waiting + paused.totals.io_waiting,
  );
  await page.request.post("/api/sessions/" + id + "/commands", {
    data: { action: "set_rate", value: 0 },
  });
  await page
    .getByRole("button", { name: "Resume session", exact: true })
    .click();
  await expect
    .poll(async () => {
      const s = await (
        await page.request.get("/api/sessions/" + id + "/snapshot")
      ).json();
      return s.totals.outstanding;
    })
    .toBe(0);
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
  await expect(
    page.getByText("Last retained snapshot; no longer live.", { exact: true }),
  ).toBeVisible();
});

test("staged policy comparison retains the request model and isolates routing changes", async ({
  page,
}) => {
  await page.goto("/setup?template=io-heavy-routing");
  await expect(
    page.getByLabel("Routing policy", { exact: true }),
  ).toContainText("Least outstanding");
  await page
    .getByRole("button", { name: "Compare current setup", exact: true })
    .click();
  const variant = page.getByRole("region", {
    name: "Variant A configuration",
    exact: true,
  });
  await variant.getByLabel("Change a setting", { exact: true }).click();
  await page
    .getByRole("option", { name: "Routing policy", exact: true })
    .click();
  await variant.getByLabel("Routing policy", { exact: true }).click();
  await page
    .getByRole("option", { name: "Least active requests", exact: true })
    .click();
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/engine/summarize", async (route) => {
    payloads.push(route.request().postDataJSON().config);
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Comparison results", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toMatchObject({
    request_model: "cpu_io",
    io_fraction: 0.9,
    outstanding_limit: 8,
    policy: "least_outstanding",
  });
  expect({ ...payloads[1], policy: payloads[0].policy }).toEqual(payloads[0]);
});

test("shared I/O bottleneck and mixed request types are visible and saved", async ({
  page,
}) => {
  await page.goto("/setup?template=shared-io-bottleneck");
  await expect(
    page.getByRole("button", {
      name: "I/O capacity and request details",
      exact: true,
    }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("spinbutton", {
      name: "Concurrent I/O operations",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "I/O capacity and request details",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("spinbutton", {
      name: "Concurrent I/O operations",
      exact: true,
    }),
  ).toHaveValue("1");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/engine/run") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  const run = await (await response).json();
  expect(run.summary.mean_io_queue_wait).toBeGreaterThan(0);
  await expect(
    page.getByText("Where response time went", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Datacenter", exact: true }).click();
  const seek = page.getByRole("slider", {
    name: "Jump to time (seconds)",
    exact: true,
  });
  await seek.focus();
  await seek.press("Home");
  for (let i = 0; i < 20; i++) await seek.press("ArrowRight");
  await expect(
    page.getByText("Shared I/O is limiting progress", { exact: true }),
  ).toBeVisible();
  const state = await (
    await page.request.get(`/api/runs/${run.run_id}/snapshot?time=2`)
  ).json();
  expect(state.io_resource.active).toBe(1);
  expect(state.io_resource.queued).toBeGreaterThan(0);
  await page.screenshot({
    path: "/tmp/ec528-shared-io-desktop.png",
    fullPage: true,
  });
  await page.goto("/setup?template=mixed-cpu-io");
  await expect(page.getByLabel("Workload", { exact: true })).toContainText(
    "Mixed",
  );
  await page
    .getByRole("button", {
      name: "I/O capacity and request details",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("spinbutton", {
      name: "I/O-heavy requests (%)",
      exact: true,
    }),
  ).toHaveValue("50");
  await page.getByRole("button", { name: "Save setup", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Setup name", { exact: true })
    .fill("Mixed dependency");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save setup", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", {
      name: "I/O capacity and request details",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("spinbutton", {
      name: "I/O-heavy requests (%)",
      exact: true,
    }),
  ).toHaveValue("50");
  await expect(
    page.getByRole("spinbutton", {
      name: "Concurrent I/O operations",
      exact: true,
    }),
  ).toHaveValue("4");
});

test("template settings are directly editable without selecting a custom mode", async ({
  page,
}) => {
  await page.goto("/setup?template=mixed-cpu-io&mode=continuous");
  await expect(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "I/O capacity and request details",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("spinbutton", {
      name: "I/O-heavy requests (%)",
      exact: true,
    }),
  ).toHaveValue("50");
  const capacity = page.getByRole("spinbutton", {
    name: "Concurrent I/O operations",
    exact: true,
  });
  await expect(capacity).toHaveValue("4");
  await capacity.fill("8");
  await expect(capacity).toHaveValue("8");
  await page.getByRole("link", { name: "Return to Lab", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Edit configuration", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "I/O capacity and request details",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("spinbutton", {
      name: "Concurrent I/O operations",
      exact: true,
    }),
  ).toHaveValue("8");
});
