import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createPreviewStore, lockPreviewOperation } from "../lib/preview-store.js";
import { logStage } from "../lib/preview-wallet.js";
import { createPreviewActor } from "../lib/preview-actors.js";
import { inspectPreview } from "../lib/preview-inspection.js";

// This coordinator receives commitments/receipts, never credential or authority
// secrets. Both actors are still on one trusted development host, not a claim of
// production isolation or end-to-end election anonymity.
const actors = [];
function actor(role) {
  const result = createPreviewActor(role); actors.push(result); return result;
}

let release, stage = "preflight";
try {
  if (!process.argv.includes("--submit")) throw new Error("EXPLICIT_--submit_REQUIRED_FOR_PREVIEW_BALLOT");
  execFileSync(process.execPath, [fileURLToPath(new URL("./compile-voting.js", import.meta.url)), "--verify"], { stdio: "inherit" });
  const inspected = await inspectPreview();
  assert.equal(inspected.recovery.length, 0, "BROADCAST_OUTCOME_REQUIRES_RECONCILIATION");
  if (inspected.state.phase === "CLOSED") {
    assert.equal(inspected.completeBallotVerified, true, "CLOSED_BALLOT_EVIDENCE_INCOMPLETE");
    logStage("PREVIEW_BALLOT_ALREADY_FINALIZED_READ_ONLY", inspected);
  } else {
  const store = await createPreviewStore();
  release = await lockPreviewOperation();
  const authority = actor("authority"), voter = actor("voter");
  await Promise.all([authority.ready, voter.ready]);
  const outcomes = [];
  const record = (name, result, accepted) => {
    assert.ok(accepted.includes(result.code), `${name}: expected ${accepted.join(" / ")}, got ${result.code}`);
    // Do not build a passport-to-ballot/nullifier mapping in the public summary.
    outcomes.push({ check: name, code: result.code });
    logStage("preview-check", { check: name, code: result.code });
  };
  stage = "prepare-device-credentials";
  const a = await voter.request("prepare", { slot: "a" });
  const b = await voter.request("prepare", { slot: "b" });
  const copy = await voter.request("prepare", { slot: "copy" });
  record("independent credential commitments", { code: a.commitment !== b.commitment && a.commitment !== copy.commitment ? "DISTINCT" : "COLLISION" }, ["DISTINCT"]);
  stage = "enrollment";
  const first = await authority.request("enroll", { demoPassport: "DEMO-P001", commitment: a.commitment });
  if (first.code === "ALREADY_ISSUED") assert.equal(first.sameCommitment, true);
  record("first eligible identity", first, ["ISSUED", "ALREADY_ISSUED"]);
  record("copied-app request", await authority.request("enroll", { demoPassport: "DEMO-P001", commitment: copy.commitment }), ["ALREADY_ISSUED"]);
  const second = await authority.request("enroll", { demoPassport: "DEMO-P002", commitment: b.commitment });
  if (second.code === "ALREADY_ISSUED") assert.equal(second.sameCommitment, true);
  record("second eligible identity", second, ["ISSUED", "ALREADY_ISSUED"]);
  record("revoked document", await authority.request("enroll", { demoPassport: "DEMO-P003", commitment: copy.commitment }), ["REVOKED"]);
  record("unknown document", await authority.request("enroll", { demoPassport: "UNKNOWN", commitment: copy.commitment }), ["NOT_ELIGIBLE"]);
  stage = "open-voting";
  record("open voting", await authority.request("open"), ["FINALIZED", "ALREADY_FINALIZED"]);
  stage = "real-proof-rejection";
  record("modified proof rejected by Preview", await voter.request("testModifiedProof"), ["NETWORK_REJECTED_MODIFIED_PROOF"]);
  stage = "ballots";
  record("first ballot", await voter.request("vote", { slot: "a", yes: true }), ["FINALIZED", "ALREADY_FINALIZED"]);
  record("credential replay", await voter.request("vote", { slot: "a", yes: false, repeat: true }), ["CREDENTIAL_ALREADY_USED"]);
  record("second ballot", await voter.request("vote", { slot: "b", yes: false }), ["FINALIZED", "ALREADY_FINALIZED"]);
  stage = "close-and-verify";
  record("close voting", await authority.request("close"), ["FINALIZED", "ALREADY_FINALIZED"]);
  record("vote after close", await voter.request("vote", { slot: "b", yes: true, repeat: true }), ["VOTING_NOT_OPEN"]);
  const final = (await authority.request("state")).state;
  assert.equal(final.phase, "CLOSED"); assert.equal(final.eligibleCount, "2"); assert.equal(final.usedNullifiers, "2");
  assert.deepEqual(final.tally, { YES: "1", NO: "1" });
  const report = { network: "preview", contractAddress: (await store.read("deployment.json")).contractAddress,
    completedAt: new Date().toISOString(), outcomes, finalState: final,
    limitations: ["Two local worker processes on one trusted development host", "Public choice/live tally; wallet/timing correlation remains", "Browser simulator remains separate; live panel uses the same worker implementation"] };
  await store.create(`ballot-report-${randomUUID()}.json`, report);
  logStage("PREVIEW_BALLOT_VERIFIED", report);
  }
} catch (error) {
  logStage("preview-ballot-stopped", { during: stage, error: String(error.message || "FAILED").replace(/[a-f0-9]{32,}/gi, "[redacted]").slice(0, 500), automaticRetry: false });
  process.exitCode = 1;
} finally {
  await Promise.all(actors.map(actor => actor.stop()));
  if (release) await release();
}
