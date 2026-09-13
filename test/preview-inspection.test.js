import test from "node:test";
import assert from "node:assert/strict";
import { inspectPreview, RECEIPT_STEPS } from "../lib/preview-inspection.js";
import { ELECTION_NAME, electionBytes } from "../lib/preview-contract.js";

function fixture() {
  const files = new Map(RECEIPT_STEPS.map(([, , file], i) => [file, { network: "preview", electionId: ELECTION_NAME, contractAddress: "a".repeat(64), txId: `00${String(i).repeat(64)}`, txHash: String(i).repeat(64), blockHeight: i + 10, privateCanary: "never-return-this" }]));
  return { files, options: {
    store: { exists: async f => files.has(f), read: async f => { if (!files.has(f)) throw new Error("MISSING"); return files.get(f); } },
    provider: { queryContractState: async () => ({ data: {} }), watchForTxData: async id => {
      const record = [...files.values()].find(r => r.txId === id);
      const index = Number(id[2]);
      const entryPoint = [null, "enroll", "enroll", "openVoting", "vote", "vote", "closeElection"][index];
      return { ...record, identifiers: [id], status: "SucceedEntirely", tx: { privateCanary: "never-return-this", intents: new Map([[1, { actions: [{ address: "a".repeat(64), ...(entryPoint ? { entryPoint } : { initialState: {} }) }] }]]) } };
    } },
    checkNetwork: async () => {}, checkKeys: async () => {}, decode: () => ({ electionId: electionBytes, phase: 2, eligibleCount: 2n, usedNullifiers: { size: () => 2n }, yesVotes: 1n, noVotes: 1n, eligible: { root: () => ({ field: 123n }) } }),
  } };
}
test("Preview audit independently checks all seven receipts and projects only public fields", async () => {
  const { options } = fixture(); const result = await inspectPreview(options);
  assert.equal(result.completeBallotVerified, true); assert.equal(result.receipts.length, 7);
  assert.equal(result.state.phase, "CLOSED"); assert.ok(!JSON.stringify(result).includes("never-return-this"));
});
test("audit rejects wrong network, verifier mismatch, receipt hash mismatch and incomplete evidence", async () => {
  for (const kind of ["network", "keys", "hash", "contract", "action"]) {
    const { options, files } = fixture();
    if (kind === "network") options.checkNetwork = async () => { throw new Error("WRONG_NETWORK"); };
    if (kind === "keys") options.checkKeys = async () => { throw new Error("WRONG_KEYS"); };
    if (kind === "hash") options.provider.watchForTxData = async () => ({ status: "SucceedEntirely", txHash: "mismatch" });
    if (kind === "contract") files.get("authority-open-confirmed.json").contractAddress = "b".repeat(64);
    if (kind === "action") { const watch = options.provider.watchForTxData; options.provider.watchForTxData = async id => { const result = await watch(id); result.tx.intents.get(1).actions[0].address = "b".repeat(64); return result; }; }
    await assert.rejects(inspectPreview(options));
  }
  const { options, files } = fixture();
  files.delete("voter-vote-b-confirmed.json"); files.set("voter-vote-b-broadcast.json", {});
  const result = await inspectPreview(options);
  assert.equal(result.completeBallotVerified, false); assert.deepEqual(result.recovery, ["vote-b"]);
});

const negativeIntent = () => ({ network: "preview", contractAddress: "a".repeat(64), identifiers: ["00" + "9".repeat(64)], transactionHash: "9".repeat(64), proofBodyMutated: true });
const negativeResult = () => ({ ...negativeIntent(), code: "NETWORK_REJECTED_MODIFIED_PROOF", stateUnchanged: true, rejection: "1010: Invalid Transaction: Custom error: 115", verifiedAt: "2026-09-12T06:30:00Z" });
test("unresolved negative-test journal blocks action eligibility even with all positive receipts", async () => {
  const { files, options } = fixture();
  files.set("voter-modified-proof-broadcast.json", negativeIntent());
  const result = await inspectPreview(options);
  assert.deepEqual(result.recovery, ["modified-proof-check"]);
  assert.equal(result.completeBallotVerified, false);
  files.set("voter-modified-proof-rejected.json", negativeResult());
  const reconciled = await inspectPreview(options);
  assert.deepEqual(reconciled.recovery, []);
  assert.equal(reconciled.negativeProofEvidence.status, "RECORDED_NODE_REJECTION");
  assert.equal(reconciled.completeBallotVerified, true);
});
test("negative-test reconciliation must match exact scope, identifiers, hash and rejection evidence", async () => {
  for (const overrides of [
    { contractAddress: "b".repeat(64) }, { identifiers: ["00" + "8".repeat(64)] },
    { transactionHash: "8".repeat(64) }, { stateUnchanged: false }, { proofBodyMutated: false },
    { rejection: "network timeout" }, { code: "OUTCOME_UNKNOWN" },
  ]) {
    const { files, options } = fixture();
    files.set("voter-modified-proof-broadcast.json", negativeIntent());
    files.set("voter-modified-proof-rejected.json", { ...negativeResult(), ...overrides });
    await assert.rejects(inspectPreview(options));
  }
});
