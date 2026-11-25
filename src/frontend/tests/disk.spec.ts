import { expect, test } from "@playwright/test";

test("one-shot disk model reports seeded read and write counts", async ({ page }) => {
  await page.goto("/setup?template=disk-read-heavy");
  await page.getByRole("button", { name: "I/O capacity and request details" }).click();
  await expect(page.getByRole("spinbutton", { name: "Write time (ms)", exact: true })).toHaveValue("50.000");
  await page.getByRole("button", { name: "Run simulation", exact: true }).click();
  await expect(page.getByText("Where response time went")).toBeVisible();
  await expect(page.getByText("Completed requests · 889 reads · 111 writes")).toBeVisible();
  await expect(page.getByText("0.060 s", { exact: true })).toBeVisible();
});

test("continuous disk telemetry counts completed reads and writes", async ({ page }) => {
  await page.goto("/setup?template=disk-write-heavy&mode=continuous");
  const create = page.waitForResponse(
    (r) => r.url().endsWith("/api/sessions") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start continuous simulation" }).click();
  const initial = await (await create).json();
  expect(initial.config.disk.read_fraction).toBe(.2);
  await expect(page.getByText(/Completed requests · [1-9]\d* reads · [1-9]\d* writes/)).toBeVisible();
  await page.getByRole("button", { name: "Pause session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume session", exact: true })).toBeVisible();
  const snapshot = await (await page.request.get(`/api/sessions/${initial.session_id}/snapshot`)).json();
  expect(snapshot.io_resource.disk_completed.read + snapshot.io_resource.disk_completed.write)
    .toBe(snapshot.totals.completed);
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
});


test("write size and throughput reach the recorded disk run", async ({ page }) => {
  await page.goto("/setup?template=disk-read-heavy");
  await page.getByRole("button", { name: "I/O capacity and request details" }).click();
  const size = page.getByRole("spinbutton", { name: "Write size (KiB)", exact: true });
  const throughput = page.getByRole("spinbutton", { name: "Write throughput (MiB/s)", exact: true });
  await expect(size).toHaveValue("0.00");
  await size.fill("1024");
  await throughput.fill("25");
  const recorded = page.waitForResponse(
    (response) => response.url().endsWith("/api/engine/run") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run simulation", exact: true }).click();
  const response = await recorded;
  expect(response.status()).toBe(201);
  const run = await response.json();
  try {
    expect(run.config.disk).toMatchObject({ write_size_kib: 1024, write_speed_mib_s: 25 });
    await expect(page.getByText(/1024 KiB at 25 MiB\/s/)).toBeVisible();
  } finally {
    await page.request.delete("/api/runs/" + run.run_id);
  }
});
