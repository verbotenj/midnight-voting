import { chromium, devices, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { createPreviewStore } from "../lib/preview-store.js";
import { selectedPreview } from "../lib/preview-config.js";

// Opt-in, read-only real-network UI check. Does not reset simulator state, open
// wallet workers, run proof generation, or allow any browser POST request.
const store = await createPreviewStore();
const deployment = await store.read("deployment.json");
const close = await store.read("authority-close-confirmed.json");
const browser = await chromium.launch();
await mkdir(new URL("../.local/ui-checks/", import.meta.url), { recursive: true, mode: 0o700 });
try {
  for (const [name, device] of [["desktop", devices["Desktop Chrome"]], ["mobile", devices["Pixel 7"]]]) {
    const context = await browser.newContext(device);
    const page = await context.newPage();
    const errors = [], writes = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      if (route.request().method() !== "GET") { writes.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto("http://127.0.0.1:4173/");
    await page.locator("#previewInspect").click();
    await expect(page.locator("#previewStatus")).toContainText("7 receipts · CLOSED · YES 1 / NO 1", { timeout: 65000 });
    await expect(page.locator("#previewContract")).toHaveText(deployment.contractAddress);
    await expect(page.locator("#previewElection")).toHaveText(selectedPreview.electionId);
    for (let index = 1; index <= 7; index++) {
      await expect(page.locator("#previewReceiptTitle")).toContainText(`${index} / 7`);
      if (index < 7) await page.locator("#previewNext").click();
    }
    const last = JSON.parse(await page.locator("#previewReceiptJson").textContent());
    expect(last.blockHeight).toBe(close.blockHeight); expect(last.status).toBe("SucceedEntirely");
    await page.locator("#previewActionPanel > summary").click();
    await expect(page.locator("#previewRun")).toBeDisabled();
    await expect(page.locator("#previewConsent")).toBeDisabled();
    expect(writes).toEqual([]); expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.locator("#previewBallot").screenshot({ path: new URL(`../.local/ui-checks/preview-${name}.png`, import.meta.url).pathname });
    console.log(JSON.stringify({ check: "REAL_PREVIEW_UI_READ_VERIFIED", viewport: name, receipts: 7, lastBlock: last.blockHeight, writes: 0, pageErrors: 0 }));
    await context.close();
  }
} finally { await browser.close(); }
