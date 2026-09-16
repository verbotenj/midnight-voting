import { test, expect } from "@playwright/test";

test("expired sessions explain recovery without claiming the server is offline", async ({ page }) => {
  await page.route("**/api/demo/reset", route => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "DEMO_SESSION_EXPIRED" }) }));
  await page.goto("/");
  await page.locator("#guidedDemoButton").click();
  await expect(page.locator("#flowStatus")).toHaveText("DEMO SESSION EXPIRED");
  await expect(page.locator("#demoStepDetail")).toContainText("Refresh the page to create a new demo session");
  await expect(page.locator("#demoResults li")).toHaveCount(0);
  await expect(page.locator("#demoNext")).toBeHidden();
});

test("an immediate start waits for the initial session cookie", async ({ page }) => {
  let releaseState;
  const stateGate = new Promise(resolve => { releaseState = resolve; });
  let resetRequests = 0;
  page.on("request", request => { if (request.url().endsWith("/api/demo/reset")) resetRequests++; });
  await page.route("**/api/state", async route => { await stateGate; await route.continue(); });
  try {
    await page.goto("/");
    await page.locator("#guidedDemoButton").click();
    await expect(page.locator("#guidedDemoButton")).toBeHidden();
    expect(resetRequests).toBe(0);
    releaseState();
    await expect(page.locator("#demoNext")).toBeEnabled();
    expect(resetRequests).toBe(1);
    await expect(page.locator("#demoStepTitle")).toContainText("1 / 10");
  } finally { releaseState(); }
});

test("hosted walkthrough completes and leaves another visitor untouched", async ({ page, browser, baseURL }) => {
  const errors = [], liveRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/\/api\/(preview|midnight)\//.test(request.url())) liveRequests.push(request.url()); });
  const other = await browser.newContext();
  try {
    const visitor = await other.newPage();
    await visitor.goto(new URL("/developer", baseURL).href);
    await expect(visitor.locator("#eligibleCount")).toHaveText("0");
    await page.goto("/");
    await expect(page.locator(".hosted-notice")).toBeVisible();
    await page.locator("#guidedDemoButton").click();
    await expect(page.locator("#demoNext")).toBeEnabled();
    for (let step = 1; step <= 10; step++) {
      await expect(page.locator("#demoStepTitle")).toContainText(`${step} / 10`);
      await page.locator("#demoNext").click();
      if (step < 10) await expect(page.locator("#demoStepTitle")).toContainText(`${step + 1} / 10`, { timeout: 25000 });
    }
    await expect(page.locator("#demoStepTitle")).toHaveText("Demo verified · YES 1 / NO 1", { timeout: 25000 });
    await expect(page.locator('#demoResults li[data-result="pass"]')).toHaveCount(11);
    await visitor.reload();
    await expect(visitor.locator("#eligibleCount")).toHaveText("0");
    await page.getByRole("link", { name: "Live Preview", exact: true }).click();
    await expect(page.getByText("This hosted app cannot connect a wallet, run a prover, or submit a Midnight transaction.")).toBeVisible();
    await expect(page.locator("#previewRun, #connectWallet")).toHaveCount(0);
    await page.reload();
    await page.getByRole("link", { name: "Developer", exact: true }).click();
    await expect(page.locator("#yesCount")).toHaveText("1");
    await expect(page.locator("#noCount")).toHaveText("1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    expect(liveRequests).toEqual([]);
  } finally { await other.close(); }
});
