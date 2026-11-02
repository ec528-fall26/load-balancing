import { test, expect } from "@playwright/test";
import { templates } from "../lib/saved-setups";

test("home lists templates, filters them, and opens the configured simulator", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your simulations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Use template", exact: true }),
  ).toHaveCount(templates.length);
  await page
    .getByRole("textbox", { name: "Search setups" })
    .fill("Mixed-speed");
  await expect(
    page.getByRole("link", { name: "Use template", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("link", { name: "Use template", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("6");
  await expect(page.getByLabel("Routing policy", { exact: true })).toContainText("Least active requests");
  await page
    .getByRole("link", { name: "Load balancing lab home", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search setups" }).fill("1,000");
  await expect(
    page.getByRole("link", { name: "Use template", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("link", { name: "Use template", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("1000");
  await expect(
    page.getByRole("spinbutton", { name: "Slots per server", exact: true }),
  ).toHaveValue("4");
});

test("named saves survive reload, update, copy, reopen and deletion", async ({
  page,
}) => {
  await page.goto("/simulator?template=queue-pressure");
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("4");
  await page.getByRole("button", { name: "Save setup", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Setup name", { exact: true })
    .fill("Overload experiment");
  await dialog.getByRole("button", { name: "Save setup", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/save=/);
  await page
    .getByRole("link", { name: "Load balancing lab home", exact: true })
    .click();
  await expect(page).toHaveURL(new URL("/", test.info().project.use.baseURL).toString());
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Overload experiment", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/library-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Overload experiment", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("4");
  await page
    .getByRole("spinbutton", { name: "Server count", exact: true })
    .fill("5");
  await page.getByRole("button", { name: "Save setup", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("spinbutton", { name: "Server count", exact: true }),
  ).toHaveValue("5");
  await page.getByRole("button", { name: "Save setup", exact: true }).click();
  await dialog.getByLabel("Setup name", { exact: true }).fill("Overload copy");
  await dialog
    .getByRole("button", { name: "Save a copy", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("link", { name: "Load balancing lab home", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Overload experiment", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Overload copy", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete Overload copy", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete setup", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Overload copy", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Overload experiment", exact: true }),
  ).toBeVisible();
});

test("home is usable on mobile, including empty saved view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Use template", exact: true }),
  ).toHaveCount(templates.length);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/library-mobile.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Saved (0)", exact: true }).click();
  await expect(
    page.getByText("No saved setups yet", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Browse templates", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Use template", exact: true }),
  ).toHaveCount(templates.length);
  await page.getByRole("link", { name: "New simulation", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save setup", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("corrupt local saves show an error without being overwritten", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("lbsim.saved-setups.v1", "{broken"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("alert").filter({ hasText: "left unchanged" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Use template", exact: true }),
  ).toHaveCount(templates.length);
  expect(
    await page.evaluate(() => localStorage.getItem("lbsim.saved-setups.v1")),
  ).toBe("{broken");
});
