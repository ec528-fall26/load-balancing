import { test, expect } from "@playwright/test";
test("100k bounded run loads its histogram, seeks to the drained state and paginates servers", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const config = {
    server_count: 100,
    concurrency: 4,
    queue_limit: 10,
    arrival_rate: 1000,
    duration: 100,
    service_min: 0.1,
    service_max: 1,
    seed: 42,
    policy: "round_robin",
  };
  const response = await request.post("/api/engine/run", { data: { config } });
  expect(response.status()).toBe(201);
  const run = await response.json();
  try {
    expect(run.summary.events).toEqual([]);
    expect(run.summary.response_times).toEqual([]);
    expect((await response.body()).length).toBeLessThan(25000);
    await page.route("**/api/engine/run", (r) => r.fulfill({ json: run }));
    const snapshots: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/runs/") && r.url().includes("/snapshot"))
        snapshots.push(r.url());
    });
    await page.goto("/simulator");
    await page
      .getByRole("button", { name: "Run simulation", exact: true })
      .click();
    await expect(
      page.getByRole("img", {
        name: "Histogram of completed-request response times with a p95 reference line",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Datacenter", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(32);
    await page.getByRole("slider").press("End");
    await expect(
      page.getByLabel(
        /100000 of 100000 requests arrived; 0 running, 0 waiting/,
      ),
    ).toBeVisible();
    await page.getByLabel("Servers to display", { exact: true }).click();
    await page
      .getByRole("option", { name: "Servers 96–99", exact: true })
      .click();
    await expect(page.getByRole("article")).toHaveCount(4);
    expect(snapshots.some((url) => url.includes("server_offset=96"))).toBe(
      true,
    );
    const events = await (
      await request.get(`/api/runs/${run.run_id}/events?offset=1000&limit=10`)
    ).json();
    expect(events.items).toHaveLength(10);
    expect(events.items[0].sequence).toBe(1000);
    await request.delete(`/api/runs/${run.run_id}`);
    await page.getByRole("slider").press("Home");
    await expect(
      page.getByRole("alert").filter({ hasText: "not found" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await expect(
      page.getByText("Last completed run", { exact: true }),
    ).toBeVisible();
  } finally {
    await request.delete(`/api/runs/${run.run_id}`);
  }
});
