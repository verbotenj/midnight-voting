import { test, expect } from "@playwright/test";

// Isolated UI fixtures. No wallet worker, external prover or chain broadcast.
const contractAddress = "a".repeat(64);
const receipt = (id, index) => ({ id, label: id, txId: `00${String(index).repeat(64)}`, txHash: String(index).repeat(64), blockHeight: index + 100, status: "SucceedEntirely" });
const closed = () => ({ network: "preview", contractAddress, electionId: "ELECTION-DEMO-2026-001", checkedAt: "2026-09-12T06:39:09Z", verifierKeysMatch: true, state: { phase: "CLOSED", eligibleCount: "2", usedNullifiers: "2", tally: { YES: "1", NO: "1" } }, receipts: ["deployment", "enroll-a", "enroll-b", "open", "vote-a", "vote-b", "close"].map(receipt), recovery: [], completeBallotVerified: true, actionsEnabled: true, actions: [], workersReady: false, job: null });
const enrollment = () => ({ ...closed(), state: { phase: "ENROLLMENT", eligibleCount: "0", usedNullifiers: "0", tally: { YES: "0", NO: "0" } }, receipts: [receipt("deployment", 0)], completeBallotVerified: false, actions: [{ id: "enroll-a", label: "Verify P001 and enroll its commitment" }] });

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/midnight/network**", route => route.fulfill({ status: 503, json: { code: "NETWORK_UNAVAILABLE" } }));
  await page.route("**/api/preview/**", route => route.fulfill({ status: 503, json: { code: "TEST_UNCONFIGURED_NO_LIVE_ACCESS" } }));
  page.on("close", () => expect(errors).toEqual([]));
});

test("closed Preview receipt walkthrough waits for clicks and cannot broadcast", async ({ page }, testInfo) => {
  const requests = [];
  await page.route("**/api/preview/**", route => {
    requests.push(route.request());
    return route.fulfill({ json: closed() });
  });
  await page.goto("/");
  expect(requests).toHaveLength(0);
  await page.locator("#previewInspect").click();
  await expect(page.locator("#previewStatus")).toContainText("7 receipts · CLOSED · YES 1 / NO 1");
  await expect(page.locator("#previewReceiptTitle")).toContainText("1 / 7");
  await expect(page.locator("#previewElection")).toHaveText("ELECTION-DEMO-2026-001");
  await page.waitForTimeout(2200);
  await expect(page.locator("#previewReceiptTitle")).toContainText("1 / 7");
  for (let i = 2; i <= 7; i++) {
    await page.locator("#previewNext").click();
    await expect(page.locator("#previewReceiptTitle")).toContainText(`${i} / 7`);
  }
  await page.locator("#previewActionPanel > summary").click();
  await expect(page.locator("#previewConsent")).toBeDisabled();
  await expect(page.locator("#previewRun")).toBeDisabled();
  await expect(page.locator("#previewActionHint")).toContainText("cannot be reset");
  expect(requests.every(request => request.method() === "GET")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator("#previewBallot").screenshot({ path: testInfo.outputPath("preview-history.png") });
});

test("live step needs consent, follows actual job events and never autoplays", async ({ page }) => {
  let input, finished = false;
  const posts = [];
  const state = enrollment();
  const job = () => ({ id: input?.requestId, action: "enroll-a", contractAddress, state: finished ? "succeeded" : "running", progress: [{ stage: "prove-start", role: "authority", at: "2026-09-12T07:00:00Z" }], ...(finished ? { result: { code: "ISSUED", evidence: "FINALIZED_RECEIPT" }, inspection: { ...state, state: { ...state.state, eligibleCount: "1" } } } : {}) });
  await page.route("**/api/preview/**", route => {
    const request = route.request();
    if (request.method() === "POST") { input = request.postDataJSON(); posts.push(input); return route.fulfill({ status: 202, json: { job: { ...job(), state: "queued" } } }); }
    return route.fulfill({ json: request.url().endsWith("/job") ? { job: job(), workersReady: true } : state });
  });
  await page.goto("/");
  await page.locator("#previewInspect").click();
  await page.locator("#previewActionPanel > summary").click();
  await expect(page.locator("#previewRun")).toBeDisabled();
  await page.locator("#previewConsent").check();
  await page.locator("#previewRun").click();
  await expect(page.locator("#previewProgress")).toContainText("Generating a real ZK proof");
  await expect(page.locator("#previewRun")).toBeDisabled();
  await expect(page.locator("#previewCounts")).toContainText("0 eligible");
  expect(Object.keys(input).sort()).toEqual(["action", "consent", "contractAddress", "requestId"]);
  expect(input.action).toBe("enroll-a"); expect(input.consent).toBe(true);
  expect(JSON.stringify(input)).not.toMatch(/credentialSecret|demoPassport|membershipPath/);
  finished = true;
  await expect(page.locator("#previewStatus")).toContainText("ISSUED · FINALIZED_RECEIPT");
  await expect(page.locator("#previewCounts")).toContainText("1 eligible");
  await expect(page.locator("#previewRun")).toBeDisabled();
  await page.waitForTimeout(2200);
  expect(posts).toHaveLength(1);
});

test("failed Preview read removes stale success and disables live actions", async ({ page }) => {
  let failed = false;
  await page.route("**/api/preview/**", route => route.fulfill(failed ? { status: 503, json: { code: "PREVIEW_INSPECTION_UNAVAILABLE" } } : { json: closed() }));
  await page.goto("/");
  await page.locator("#previewInspect").click();
  await expect(page.locator("#previewState")).toBeVisible();
  failed = true;
  await page.locator("#previewInspect").click();
  await expect(page.locator("#previewStatus")).toContainText("No verified result is shown");
  await expect(page.locator("#previewState")).toBeHidden();
  await expect(page.locator("#previewReceiptGuide")).toBeHidden();
  await expect(page.locator("#previewRun")).toBeDisabled();
});

test("unknown operation outcome never becomes confirmed and cannot be retried blindly", async ({ page }) => {
  let actions = 0;
  await page.route("**/api/preview/**", route => {
    const request = route.request();
    if (request.method() === "POST") { actions++; return route.fulfill({ status: 503, json: { code: "RESPONSE_LOST" } }); }
    if (request.url().endsWith("/job")) return route.fulfill({ status: 503, json: { code: "STATUS_UNAVAILABLE" } });
    return route.fulfill({ json: enrollment() });
  });
  await page.goto("/"); await page.locator("#previewInspect").click();
  await page.locator("#previewActionPanel > summary").click();
  await page.locator("#previewConsent").check(); await page.locator("#previewRun").click();
  await expect(page.locator("#previewStatus")).toContainText("response unavailable or rejected");
  await page.locator("#previewJobCheck").click();
  await expect(page.locator("#previewStatus")).toContainText("may still finish");
  await expect(page.locator("#previewRun")).toBeDisabled(); expect(actions).toBe(1);
});
