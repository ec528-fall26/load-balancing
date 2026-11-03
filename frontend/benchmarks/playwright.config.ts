import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: __dirname,
  testMatch: "telemetry.spec.ts",
  use: {
    baseURL: process.env.A11_FRONTEND_URL ?? "http://localhost:3001",
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chromium",
    viewport: { width: 1440, height: 1000 },
  },
  workers: 1,
  outputDir: "../test-results/a11",
});
