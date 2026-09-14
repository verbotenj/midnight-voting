import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createPreviewStore } from "../lib/preview-store.js";
import { selectedPreview } from "../lib/preview-config.js";

// Real browser clicks, real HTTP, real proof workers and real Preview DUST.
// Never used by ordinary e2e tests. Stop on any ambiguous result; no auto-retry.
if (!process.argv.includes("--submit") || selectedPreview.electionId !== "ELECTION-DEMO-2026-002") {
  throw new Error("EXPLICIT_002_AND_--submit_REQUIRED");
}
const store = await createPreviewStore();
const deployment = await store.read("deployment.json");
const allSteps = [
  ["enroll-a", "ISSUED"], ["copy-check", "ALREADY_ISSUED"],
  ["enroll-b", "ISSUED"], ["revoked-check", "REVOKED"],
  ["open", "FINALIZED"], ["modified-proof-check", "NETWORK_REJECTED_MODIFIED_PROOF"],
  ["vote-a", "FINALIZED"], ["replay-check", "CREDENTIAL_ALREADY_USED"],
  ["vote-b", "FINALIZED"], ["close", "FINALIZED"],
];
// Explicit continuation only after inspecting the failed run and chain journals.
const from = process.argv.find(arg => arg.startsWith("--from="))?.slice(7);
if (from && !allSteps.some(([action]) => action === from)) throw new Error("INVALID_RESUME_STEP");
const steps = allSteps.slice(from ? allSteps.findIndex(([action]) => action === from) : 0);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors = [], submitted = [], completed = [];
const output = new URL(`../.local/ui-checks/live-002-${randomUUID()}/`, import.meta.url);
await mkdir(output, { recursive: true, mode: 0o700 });
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  if (request.method() === "POST") {
    // Record only the allowlisted action, never a request body or wallet object.
    expect(new URL(request.url()).pathname).toMatch(/^\/api\/preview\/(actions|disconnect)$/);
    if (request.url().endsWith("/actions")) submitted.push(request.postDataJSON().action);
  }
});
const inspect = async () => {
  await page.locator("#previewInspect").click();
  await expect(page.locator("#previewStatus")).toHaveText(/Preview state checked\.|Preview ballot verified/, { timeout: 65000 });
  await expect(page.locator("#previewElection")).toHaveText(selectedPreview.electionId);
  await expect(page.locator("#previewContract")).toHaveText(deployment.contractAddress);
};
try {
  await page.goto("http://127.0.0.1:4173/preview");
  await inspect();
  await page.locator("#previewActionPanel > summary").click();
  for (const [action, code] of steps) {
    await page.locator("#previewAction").selectOption(action);
    await expect(page.locator("#previewRun")).toBeDisabled();
    await page.waitForTimeout(3000); // Keep each authorization visible and readable.
    await page.locator("#previewConsent").check();
    await page.locator("#previewRun").click();
    console.log(JSON.stringify({ stage: "UI_ACTION_SUBMITTED", action, at: new Date().toISOString() }));
    let last = "";
    const heartbeat = setInterval(async () => {
      try {
        const line = await page.locator("#previewProgress li").last().textContent();
        if (line !== last) { last = line; console.log(JSON.stringify({ stage: "UI_PROGRESS", action, message: line })); }
      } catch { /* page may be closing */ }
    }, 15000);
    try {
      await expect(page.locator("#previewStatus")).toHaveText(/Check Preview state to choose the next step\.|Operation stopped:|status unavailable|response unavailable/, { timeout: 25 * 60000 });
    } finally { clearInterval(heartbeat); }
    const status = await page.locator("#previewStatus").textContent();
    await page.locator("#previewBallot").screenshot({ path: new URL(`${action}.png`, output).pathname });
    expect(status.startsWith(`${code} ·`), status).toBe(true);
    completed.push({ action, status });
    console.log(JSON.stringify({ stage: "UI_ACTION_VERIFIED", action, status }));
    await expect(page.locator("#previewRun")).toBeDisabled();
    await page.waitForTimeout(3000);
    expect(submitted).toEqual(completed.map(step => step.action));
    await inspect();
  }
  await expect(page.locator("#previewPhase")).toHaveText("CLOSED");
  await expect(page.locator("#previewTally")).toHaveText("YES 1 / NO 1");
  await expect(page.locator("#previewStatus")).toContainText("7 receipts");
  expect(errors).toEqual([]);
  await page.locator("#previewDisconnect").click();
  await expect(page.locator("#previewStatus")).toContainText("Idle wallet workers stopped", { timeout: 65000 });
  console.log(JSON.stringify({ stage: "REAL_PREVIEW_UI_BALLOT_COMPLETE", electionId: selectedPreview.electionId, actions: completed.length, pageErrors: 0 }));
} finally {
  await writeFile(new URL("report.json", output), JSON.stringify({ electionId: selectedPreview.electionId, contractAddress: deployment.contractAddress, submitted, completed, errors, finishedAt: new Date().toISOString() }, null, 2), { flag: "wx", mode: 0o600 });
  await context.close(); await browser.close();
}
