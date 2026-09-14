import { test, expect } from "@playwright/test";
import { credentialCommitment, ELECTION_ID } from "../lib/domain.js";

const election = `/api/elections/${ELECTION_ID}`;
const pageErrors = new WeakMap();
test.beforeEach(async ({ page, request }) => {
  await request.post("/api/demo/reset");
  const errors = [];
  pageErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    // Expected HTTP 4xx/5xx are asserted at the action boundary in failure tests.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
  });
  // No test may broadcast a live network transaction or access a remote prover.
  await page.route("**/api/midnight/network**", route => route.fulfill({ status: 503, json: { code: "NETWORK_UNAVAILABLE" } }));
  await page.goto("/developer");
  await expect(page.locator("#registry .registry-row")).toHaveCount(3);
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

async function start(page) {
  await page.getByRole("link", { name: "Demo", exact: true }).click();
  await page.locator("#guidedDemoButton").click();
  await expect(page.locator("#demoStepTitle")).toContainText("1 / 10");
  await expect(page.locator("#demoNext")).toBeEnabled();
}

async function issue(page, passport = "DEMO-P001") {
  await page.locator(`[data-passport="${passport}"]`).click();
  await page.locator("#issueButton").click();
  await expect(page.locator("#credentialCard")).toBeVisible();
  await expect(page.locator("#voteButton")).toBeDisabled();
}

test("full human-paced NFC and three-passport ballot checks each result", async ({ page, request }, testInfo) => {
  await expect(page.locator("#demoPace")).toHaveCount(0);
  await start(page);
  // A genuine reading-time assertion: the default cannot advance automatically.
  await page.waitForTimeout(2200);
  await expect(page.locator("#demoResults li")).toHaveCount(0);
  await expect(page.locator("#demoNext")).toBeEnabled();
  for (let step = 1; step <= 10; step++) {
    await expect(page.locator("#demoStepTitle")).toContainText(`${step} / 10`, { timeout: 20000 });
    await page.locator("#demoNext").click();
    if (step < 10) await expect(page.locator("#demoStepTitle")).toContainText(`${step + 1} / 10`, { timeout: 20000 });
  }
  await expect(page.locator("#demoStepTitle")).toHaveText("Demo verified · YES 1 / NO 1", { timeout: 20000 });
  await expect(page.locator('#demoResults li[data-result="pass"]')).toHaveCount(11);
  await expect(page.locator('#demoResults li[data-result="fail"]')).toHaveCount(0);
  await expect(page.locator("#ballot")).toBeHidden();
  await expect(page.locator("#yesCount")).toHaveText("1");
  await expect(page.locator("#noCount")).toHaveText("1");
  await expect(page.locator("#votesCast")).toHaveText("2");
  const state = await (await request.get("/api/state")).json();
  expect(state.public.tally).toEqual({ YES: 1, NO: 1 });
  expect(JSON.stringify(state.public)).not.toMatch(/DEMO-P|credentialSecret|documentStatus/);
  expect(state.authority.events.map(x => x.result)).toEqual(expect.arrayContaining(["ISSUED", "ALREADY_ISSUED", "REVOKED"]));
  await page.locator("#demoPlayer").screenshot({ path: testInfo.outputPath("verified-ballot.png") });
});

test("NFC read alone issues nothing, including for an authentic-looking revoked document", async ({ page, request }) => {
  await page.locator('[data-passport="DEMO-P003"]').click();
  await page.locator("#nfcReadButton").click();
  await expect(page.locator("#nfcReadStatus")).toContainText("Document status is UNKNOWN");
  const state = await (await request.get("/api/state")).json();
  expect(state.public.eligibleCredentialCount).toBe(0);
  expect(state.authority.events).toHaveLength(0);
  await page.locator("#issueButton").click();
  await expect(page.locator("#flowStatus")).toHaveText("REVOKED");
  await expect(page.locator("#ballot")).toBeHidden();
});

test("payload boundary navigation follows NFC and shows exact authority rejection", async ({ page, request }, testInfo) => {
  const sent = [];
  page.on("request", r => { if (r.method() === "POST") sent.push(r.url()); });
  await page.locator('[data-passport="DEMO-P003"]').click();
  await page.locator("#nfcReadButton").click();
  await expect(page.locator('[data-payload-target="local"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#nfcScene")).toHaveAttribute("data-phase", "prepared");
  expect(sent).toEqual([]);
  await page.locator("#viewPayloads").click();
  await expect(page.locator("#localPayload")).toBeVisible();
  await expect(page.locator('[data-payload-panel="local"] > summary')).toBeFocused();
  await expect(page.locator("#localPayload")).toContainText('"documentStatus": "UNKNOWN"');
  await page.locator("#issueButton").click();
  await expect(page.locator("#flowStatus")).toHaveText("REVOKED");
  await expect(page.locator('[data-payload-target="authority"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#payloadBoundaryStatus")).toContainText("HTTP 403 · REVOKED");
  await page.locator('[data-payload-target="authority"]').click();
  await expect(page.locator("#authorityRequest")).toBeVisible();
  expect(JSON.parse(await page.locator("#authorityResponse").textContent())).toEqual({ code: "REVOKED" });
  await page.locator('[data-payload-target="vote"]').click();
  await expect(page.locator("#voteRequest")).toBeVisible();
  await expect(page.locator("#voteRequest")).toHaveText("No request yet.");
  await page.locator('[data-payload-target="public"]').click();
  await expect(page.locator("#publicPayload")).toBeVisible();
  const actual = (await (await request.get("/api/state")).json()).public;
  expect(JSON.parse(await page.locator("#publicPayload").textContent())).toEqual(actual);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator("#nfcScene").screenshot({ path: testInfo.outputPath("payload-boundaries.png") });
});

test("manual controls are locked during issuance and reject a modified proof", async ({ page, request }) => {
  await page.locator('[data-passport="DEMO-P001"]').click();
  await page.locator("#issueButton").click();
  await expect(page.locator('[data-passport="DEMO-P002"]')).toBeDisabled();
  await expect(page.locator("#resetButton")).toBeDisabled();
  await expect(page.locator("#closeButton")).toBeDisabled();
  await expect(page.locator("#credentialCard")).toBeVisible();
  await expect(page.locator('[data-choice="YES"]')).toBeEnabled();
  await page.locator("#tamperButton").click();
  await expect(page.locator("#flowStatus")).toHaveText("INVALID PROOF");
  expect((await (await request.get("/api/state")).json()).public.votesCast).toBe(0);
  await expect(page.locator('[data-passport="DEMO-P002"]')).toBeEnabled();
});

test("guided authority failure stops instead of announcing success", async ({ page, request }) => {
  await page.route(`**${election}/credential`, route => route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE" } }));
  await start(page);
  await page.locator("#demoNext").click();
  await expect(page.locator("#demoStepTitle")).toContainText("2 / 10");
  await page.locator("#demoNext").click();
  await expect(page.locator("#demoStepTitle")).toHaveText("Demo failed verification");
  await expect(page.locator("#nfcScene")).toHaveAttribute("data-phase", "unknown");
  await expect(page.locator('#demoResults li[data-result="fail"]')).toContainText("SERVICE_UNAVAILABLE");
  expect((await (await request.get("/api/state")).json()).public.votesCast).toBe(0);
  await expect(page.locator("#guidedDemoButton")).toBeEnabled();
});

test("failed reset and close preserve state and never claim success", async ({ page }) => {
  await page.locator('[data-passport="DEMO-P001"]').click();
  await page.route("**/api/demo/reset", route => route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE" } }));
  await page.locator("#resetButton").click();
  await expect(page.locator("#toastRegion")).toContainText("Action interrupted");
  await expect(page.locator("#selectedPassportValue")).toHaveText("DEMO-P001");
  await page.route(`**${election}/close`, route => route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE" } }));
  await page.locator("#closeButton").click();
  await expect(page.locator("#electionState")).toHaveText("OPEN");
  await expect(page.locator("#closeButton")).toBeEnabled();
});

test("manual next and stop work without interrupting mutations", async ({ page, request }) => {
  await start(page);
  await expect(page.locator("#demoPause")).toHaveCount(0);
  await page.waitForTimeout(6500);
  await expect(page.locator("#demoResults li")).toHaveCount(0);
  await page.locator("#demoNext").click();
  await expect(page.locator("#demoStepTitle")).toContainText("2 / 10");
  await page.locator("#demoNext").click();
  await expect(page.locator("#demoNext")).toBeDisabled();
  await page.locator("#demoStop").click();
  await expect(page.locator("#demoStepTitle")).toHaveText("Demo stopped", { timeout: 18000 });
  const state = await (await request.get("/api/state")).json();
  expect(state.public.eligibleCredentialCount).toBe(1);
  expect(state.public.votesCast).toBe(0);
  await expect(page.locator("#guidedDemoButton")).toBeEnabled();
});

test("reduced motion does not remove the reading checkpoint; keyboard works", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await start(page);
  await page.locator("#demoNext").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#demoStepTitle")).toContainText("2 / 10");
  await page.waitForTimeout(1500);
  await expect(page.locator("#demoResults li")).toHaveCount(1);
  await page.locator("#demoStop").click();
  await expect(page.locator("#demoStepTitle")).toHaveText("Demo stopped");
});

test("another device and a deleted app cannot obtain a second credential", async ({ page, request, browser }) => {
  const secret = "a".repeat(64);
  const result = await request.post(`${election}/credential`, { data: { demoPassport: "DEMO-P001", commitment: credentialCommitment(ELECTION_ID, secret) } });
  expect(result.status()).toBe(201);
  const other = await browser.newContext();
  try {
    const copy = await other.newPage();
    await copy.goto("http://127.0.0.1:4174/developer");
    await copy.locator('[data-passport="DEMO-P001"]').click();
    await copy.locator("#issueButton").click();
    await expect(copy.locator("#flowStatus")).toHaveText("ALREADY ISSUED");
    await expect(copy.locator("#ballot")).toBeHidden();
  } finally { await other.close(); }
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('[data-passport="DEMO-P001"]').click();
  await page.locator("#issueButton").click();
  await expect(page.locator("#flowStatus")).toHaveText("ALREADY ISSUED");
});

test("overview and controls fit the viewport and disclose engineering limitations", async ({ page }, testInfo) => {
  await page.getByRole("link", { name: "Learn", exact: true }).click();
  await expect(page.locator("#nfcOverview")).toContainText("documentStatus");
  await expect(page.locator("#chainOverview")).toContainText("still run in a local simulator");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator("#nfcOverview").screenshot({ path: testInfo.outputPath("nfc-overview.png") });
  await page.locator("#chainOverview").screenshot({ path: testInfo.outputPath("chain-overview.png") });
});

test("closing updates both badges and rejects later voting and issuance", async ({ page, request }) => {
  await issue(page);
  await page.locator('[data-choice="YES"]').click();
  await page.locator("#closeButton").click();
  await expect(page.locator("#heroElectionState")).toHaveText("CLOSED");
  await expect(page.locator("#electionState")).toHaveText("CLOSED");
  await page.locator("#voteButton").click();
  await expect(page.locator("#flowStatus")).toHaveText("ELECTION CLOSED");
  await page.locator('[data-passport="DEMO-P002"]').click();
  await page.locator("#issueButton").click();
  await expect(page.locator("#flowStatus")).toHaveText("ELECTION CLOSED");
  const state = await (await request.get("/api/state")).json();
  expect(state.public.votesCast).toBe(0);
  expect(state.public.eligibleCredentialCount).toBe(1);
});

test("changing credential holders clears the previous ballot choice", async ({ page, request }) => {
  const credentials = {};
  for (const [passport, letter] of [["DEMO-P001", "a"], ["DEMO-P002", "b"]]) {
    const secret = letter.repeat(64);
    const commitment = credentialCommitment(ELECTION_ID, secret);
    expect((await request.post(`${election}/credential`, { data: { demoPassport: passport, commitment } })).status()).toBe(201);
    credentials[passport] = { secret, commitment, electionId: ELECTION_ID, voted: false };
  }
  await page.evaluate(credentials => localStorage.setItem("private-ballot-demo-credentials-v1", JSON.stringify(credentials)), credentials);
  await page.locator('[data-passport="DEMO-P001"]').click();
  await page.locator('[data-choice="YES"]').click();
  await expect(page.locator("#voteButton")).toBeEnabled();
  await page.locator('[data-passport="DEMO-P002"]').click();
  await expect(page.locator("#voteButton")).toBeDisabled();
  await expect(page.locator(".vote-option.selected")).toHaveCount(0);
});

test("concurrent HTTP issuance requests produce one entitlement", async ({ request }) => {
  const responses = await Promise.all(["a", "b"].map(letter => request.post(`${election}/credential`, {
    data: { demoPassport: "DEMO-P001", commitment: credentialCommitment(ELECTION_ID, letter.repeat(64)) },
  })));
  expect(responses.map(response => response.status()).sort()).toEqual([201, 409]);
  const state = await (await request.get("/api/state")).json();
  expect(state.public.eligibleCredentialCount).toBe(1);
});

test("passport animation prepares locally and inspector matches actual wire payloads", async ({ page, request }, testInfo) => {
  const posts = [];
  page.on("request", r => { if (r.method() === "POST") posts.push(r.url()); });
  await page.locator('[data-passport="DEMO-P001"]').click();
  const before = await page.locator("#nfcPassport").boundingBox();
  const startedAt = Date.now();
  await page.locator("#nfcReadButton").click();
  await expect(page.locator("#nfcScene")).toHaveAttribute("data-phase", "approach");
  await expect(page.locator("#nfcScene")).toHaveAttribute("data-phase", "reading");
  const after = await page.locator("#nfcPassport").boundingBox();
  expect(after.x).toBeGreaterThan(before.x);
  await expect(page.locator("#nfcScene")).toHaveAttribute("data-phase", "preparing");
  await expect(page.locator("#nfcScene")).toHaveAttribute("data-phase", "prepared");
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(5000);
  expect(posts).toEqual([]);
  const local = JSON.parse(await page.locator("#localPayload").textContent());
  expect(local.credential.authorization).toBe("NOT_ISSUED");
  expect(local.documentStatus).toBe("UNKNOWN");
  expect((await (await request.get("/api/state")).json()).public.eligibleCredentialCount).toBe(0);
  await page.locator("#nfcScene").screenshot({ path: testInfo.outputPath("passport-read.png") });
  const authorityRequest = page.waitForRequest(r => r.url().endsWith("/credential") && r.method() === "POST");
  await page.locator("#issueButton").click();
  const sent = (await authorityRequest).postDataJSON();
  await expect(page.locator("#nfcScene")).toHaveAttribute("data-phase", "issued");
  expect(sent).toEqual({ demoPassport: "DEMO-P001", commitment: local.credential.commitment });
  expect(JSON.parse(await page.locator("#authorityRequest").textContent())).toEqual(sent);
  expect(JSON.parse(await page.locator("#authorityResponse").textContent()).code).toBe("ISSUED");
  await page.locator('[data-choice="YES"]').click();
  const voteRequest = page.waitForRequest(r => r.url().endsWith("/vote") && r.method() === "POST");
  await page.locator("#voteButton").click();
  const vote = (await voteRequest).postDataJSON();
  await expect(page.locator("#flowStatus")).toHaveText("VOTE CONFIRMED");
  const shown = JSON.parse(await page.locator("#voteRequest").textContent());
  expect(shown).toEqual({ ...vote, credentialSecret: "<redacted in UI; SENT to local simulator>" });
  expect(await page.locator("#payloadInspector").textContent()).not.toContain(vote.credentialSecret);
  await page.locator("#payloadInspector > summary").click();
  await expect(page.locator("#authorityRequest")).toBeVisible();
  await page.locator("#localPayloadShape > summary").click();
  await expect(page.locator("#localPayloadShape")).toContainText("zero HTTP requests");
  await page.locator("#compactPayloadShape > summary").click();
  await expect(page.locator("#compactPayloadShape")).toContainText("enroll(credentialCommitment: Bytes<32>)");
  await expect(page.locator("#compactPayloadShape")).toContainText("vote(yes: Boolean)");
  await expect(page.locator("#compactPayloadShape")).toContainText("not connected to this runner");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator("#payloadInspector").screenshot({ path: testInfo.outputPath("developer-payloads.png") });
  await page.locator("#resetButton").click();
  await expect(page.locator("#localPayload")).toHaveText("No local read yet.");
  await expect(page.locator("#authorityRequest")).toHaveText("No request yet.");
});
