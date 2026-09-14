import { test, expect } from "@playwright/test";

test("focused demo and separate pages load directly without mutations", async ({ page }) => {
  const writes = [], errors = [];
  page.on("request", request => { if (request.method() === "POST") writes.push(request.url()); });
  page.on("pageerror", error => errors.push(error.message));
  for (const [path, name] of [["/", "demo"], ["/learn", "learn"], ["/developer", "developer"], ["/preview", "preview"]]) {
    await page.goto(path);
    await expect(page.locator("body")).toHaveAttribute("data-page", name);
    await expect(page.locator(".page-view:visible")).toHaveCount(1);
    await expect(page.locator(".page-nav [aria-current=page]")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.getByRole("link", { name: "Demo", exact: true }).click();
  await expect(page.locator("#demoStepTitle")).toContainText("1 / 10");
  await expect(page.locator("#nfcScene")).toBeVisible();
  await expect(page.locator("#networkStage")).toBeHidden();
  await expect(page.locator("#previewBallot")).toBeHidden();
  await expect(page.locator("#payloadInspector")).toBeHidden();
  await expect(page.locator(".workspace")).toBeHidden();
  await expect(page.locator("#demoPace, #demoPause")).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("navigation and browser back retain the current checkpoint without advancing", async ({ page, request }) => {
  await request.post("/api/demo/reset");
  await page.goto("/");
  await page.locator("#guidedDemoButton").click();
  await expect(page.locator("#demoNext")).toBeEnabled();
  await page.getByRole("link", { name: "Learn", exact: true }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await page.waitForTimeout(2200);
  await page.goBack();
  await expect(page.locator("body")).toHaveAttribute("data-page", "demo");
  await expect(page.locator("#demoStepTitle")).toContainText("1 / 10");
  await expect(page.locator("#demoResults li")).toHaveCount(0);
  await page.locator("#demoStop").click();
  await expect(page.locator("#demoStepTitle")).toHaveText("Demo stopped");
  expect((await (await request.get("/api/state")).json()).public.votesCast).toBe(0);
});
