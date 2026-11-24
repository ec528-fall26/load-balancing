import { expect, test } from "@playwright/test";

test("Docs provides screenshots, terminology, and keyboard-accessible setup help", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("link", { name: "Docs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Documentation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Definitions" })).toBeVisible();
  const screenshots = page.getByRole("img", { name: /Setup showing|Lab results showing/ });
  await expect(screenshots).toHaveCount(2);
  for (const screenshot of await screenshots.all()) {
    await screenshot.scrollIntoViewIfNeeded();
    await expect.poll(() => screenshot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByRole("link", { name: "Open Read-heavy disk" }))
    .toHaveAttribute("href", "/setup?template=disk-read-heavy");

  await page.goto("/setup?template=mixed-cpu-io");
  await page.getByRole("button", { name: "I/O capacity and request details" }).click();
  await page.getByRole("button", { name: "About concurrent i/o operations", exact: true }).focus();
  await expect(page.getByRole("tooltip")).toContainText("One shared pool for all servers");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).not.toBeVisible();
});

test("Docs navigation keeps the active Lab session", async ({ page }) => {
  await page.goto("/setup?template=io-heavy-live&mode=continuous");
  await page.getByRole("button", { name: "Start continuous simulation" }).click();
  await page.getByRole("button", { name: "Pause session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume session", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Docs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Documentation" })).toBeVisible();
  await page.getByRole("link", { name: "Lab", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume session", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
});
