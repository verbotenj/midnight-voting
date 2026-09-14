import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  outputDir: ".local/public-test-results",
  testDir: "./hosted-e2e", workers: 1, timeout: 180_000,
  expect: { timeout: 15_000 },
  use: { baseURL: "http://127.0.0.1:4175", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } },
  ],
  webServer: { command: "node public-server.js", env: { PORT: "4175", HOST: "127.0.0.1", PUBLIC_ORIGIN: "http://127.0.0.1:4175" }, url: "http://127.0.0.1:4175/health", reuseExistingServer: false },
});
