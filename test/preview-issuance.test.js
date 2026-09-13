import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPreviewStore } from "../lib/preview-store.js";
import { reserveIssuance, planIssuanceRecovery } from "../lib/preview-issuance.js";

const scope = { contractAddress: "a".repeat(64), electionId: "ELECTION-DEMO-2026-001" };
const store = async () => createPreviewStore(await mkdtemp(join(tmpdir(), "voting-issuer-test-")));
test("durable issuance: two devices racing produce exactly one reservation", async () => {
  const db = await store();
  const results = await Promise.all(["b", "c"].map(value => reserveIssuance(db, scope, "DEMO-P001", value.repeat(64))));
  assert.equal(results.filter(x => x.code === "RESERVED").length, 1);
  assert.equal(results.filter(x => x.code === "ALREADY_ISSUED_OR_RESERVED").length, 1);
  const restored = await createPreviewStore(db.directory);
  assert.equal((await reserveIssuance(restored, scope, "DEMO-P001", "d".repeat(64))).code, "ALREADY_ISSUED_OR_RESERVED");
});
test("durable issuance: revoked and invalid documents never reserve", async () => {
  const db = await store();
  assert.equal((await reserveIssuance(db, scope, "DEMO-P003", "b".repeat(64))).code, "REVOKED");
  assert.equal((await reserveIssuance(db, scope, "UNKNOWN", "b".repeat(64))).code, "NOT_ELIGIBLE");
  assert.equal((await reserveIssuance(db, scope, "DEMO-P002", "bad")).code, "INVALID_COMMITMENT");
  assert.equal(await db.exists(`issuance-${scope.contractAddress}-DEMO-P003.json`), false);
});
test("durable issuance: a replacement deployment cannot bypass election uniqueness", async () => {
  const db = await store();
  const original = await reserveIssuance(db, scope, "DEMO-P001", "b".repeat(64));
  assert.equal((await reserveIssuance(db, { ...scope, contractAddress: "c".repeat(64) }, "DEMO-P001", "d".repeat(64))).code, "ALREADY_ISSUED_OR_RESERVED");
  assert.equal((await reserveIssuance(db, { ...scope, electionId: "ELECTION-DEMO-2026-002", contractAddress: "c".repeat(64) }, "DEMO-P001", "d".repeat(64))).code, "RESERVED");
  await assert.rejects(db.read("../authority-private.json"), /INVALID_STORE_NAME/);
  await chmod(db.path(original.reservation), 0o644);
  await assert.rejects(db.read(original.reservation), /UNSAFE_PREVIEW_FILE/);
});

const recoverable = { sameCommitment: true, contractMatches: true, enrolled: false, phase: 0, broadcastExists: false, confirmedExists: false };
test("issuance recovery resumes the same unbroadcast reservation without altering it", async () => {
  const db = await store();
  const first = await reserveIssuance(db, scope, "DEMO-P001", "b".repeat(64));
  const saved = await db.read(first.reservation);
  const restored = await createPreviewStore(db.directory);
  const retry = await reserveIssuance(restored, scope, "DEMO-P001", "b".repeat(64));
  const plan = planIssuanceRecovery({ ...recoverable, ...retry });
  assert.equal(plan.code, "RESUME_UNBROADCAST_ISSUANCE");
  assert.deepEqual(await restored.read(first.reservation), saved);
  assert.equal((await restored.issuanceFiles("DEMO-P001")).length, 1);
  const copy = await reserveIssuance(restored, scope, "DEMO-P001", "c".repeat(64));
  assert.equal(planIssuanceRecovery({ ...recoverable, ...copy }).code, "ISSUANCE_PENDING");
});
test("issuance recovery never retries broadcast, closed, changed-scope or unknown outcomes", () => {
  const cases = [
    [{ broadcastExists: true }, "BROADCAST_OUTCOME_REQUIRES_RECONCILIATION"],
    [{ confirmedExists: true }, "ISSUANCE_STATE_MISMATCH"],
    [{ phase: 1 }, "ENROLLMENT_CLOSED"],
    [{ phase: 2 }, "ENROLLMENT_CLOSED"],
    [{ contractMatches: false }, "ALREADY_ISSUED_FOR_ELECTION"],
    [{ sameCommitment: false }, "ISSUANCE_PENDING"],
    [{ enrolled: undefined }, "ISSUANCE_STATE_UNKNOWN"],
    [{ broadcastExists: undefined }, "ISSUANCE_STATE_UNKNOWN"],
  ];
  for (const [overrides, code] of cases) assert.equal(planIssuanceRecovery({ ...recoverable, ...overrides }).code, code);
  assert.deepEqual(planIssuanceRecovery({ ...recoverable, enrolled: true, broadcastExists: true, confirmedExists: true }), { code: "ALREADY_ISSUED", sameCommitment: true });
});
test("recovery operations remain serialized by the persistent operation lock", async () => {
  const db = await store();
  const release = await db.lock("operation-lock.json");
  await assert.rejects(db.lock("operation-lock.json"), { code: "EEXIST" });
  await release();
  const releaseNext = await db.lock("operation-lock.json");
  await releaseNext();
});
