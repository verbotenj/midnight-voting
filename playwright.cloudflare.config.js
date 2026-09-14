import { defineConfig, devices } from "@playwright/test";
const remote = process.env.CLOUDFLARE_TEST_URL;
if (remote && (!remote.startsWith("https://") || !new URL(remote).hostname.endsWith(".workers.dev"))) throw new Error("Use an explicit HTTPS workers.dev simulation URL");
export default defineConfig({
  outputDir: ".local/cloudflare-test-results",
  testDir: "./hosted-e2e", workers: 1, timeout: 180_000,
  expect: { timeout: 15_000 },
  use: { baseURL: remote || "http://127.0.0.1:4176", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } },
  ],
  webServer: remote ? undefined : { command: "node scripts/cloudflare.js dev --ip 127.0.0.1 --port 4176 --persist-to .local/cloudflare-test-state", url: "http://127.0.0.1:4176/health", reuseExistingServer: false, timeout: 120_000 },
});
