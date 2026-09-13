import assert from "node:assert/strict";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { verifyContractState } from "@midnight-ntwrk/midnight-js-contracts";
import { ledger } from "../compact/managed/voting/contract/index.js";
import { ELECTION_NAME, electionBytes, zkConfigProvider, publicLedger } from "./preview-contract.js";
import { PREVIEW_HTTP, PREVIEW_WS, requirePreview, deadline } from "./preview-wallet.js";
import { createPreviewStore } from "./preview-store.js";

// Read only this explicit allowlist. Never enumerate private wallet/credential files.
export const RECEIPT_STEPS = [
  ["deployment", "Deploy contract", "deployment.json"],
  ["enroll-a", "Enroll first credential", "authority-enroll-DEMO-P001-confirmed.json"],
  ["enroll-b", "Enroll second credential", "authority-enroll-DEMO-P002-confirmed.json"],
  ["open", "Freeze root and open voting", "authority-open-confirmed.json"],
  ["vote-a", "First ballot", "voter-vote-a-confirmed.json"],
  ["vote-b", "Second ballot", "voter-vote-b-confirmed.json"],
  ["close", "Close election", "authority-close-confirmed.json"],
];

export async function inspectPreview({ store, provider, checkNetwork = requirePreview, checkKeys, decode = ledger } = {}) {
  setNetworkId("preview");
  store ||= await createPreviewStore();
  provider ||= indexerPublicDataProvider(PREVIEW_HTTP, PREVIEW_WS);
  await checkNetwork();
  const deployment = await store.read("deployment.json");
  assert.equal(deployment.network, "preview", "DEPLOYMENT_NETWORK_MISMATCH");
  assert.equal(deployment.electionId, ELECTION_NAME, "DEPLOYMENT_ELECTION_MISMATCH");
  assert.match(deployment.contractAddress, /^[a-f0-9]{64}$/);
  const current = await deadline(provider.queryContractState(deployment.contractAddress), 30000, "STATE_LOOKUP_TIMEOUT");
  assert.ok(current, "CONTRACT_NOT_FOUND");
  if (checkKeys) await checkKeys(current);
  else verifyContractState(await zkConfigProvider.getVerifierKeys(["enroll", "openVoting", "vote", "closeElection"]), current);
  const view = decode(current.data);
  assert.deepEqual(view.electionId, electionBytes, "ON_CHAIN_ELECTION_MISMATCH");
  const receipts = [], recovery = [];
  for (const [id, label, file] of RECEIPT_STEPS) {
    if (!(await store.exists(file))) {
      const intent = id === "deployment" ? "deploy-broadcast.json" : file.replace("-confirmed.json", "-broadcast.json");
      if (await store.exists(intent)) recovery.push(id);
      continue;
    }
    const saved = await store.read(file);
    assert.equal(saved.network, "preview");
    assert.equal(saved.contractAddress, deployment.contractAddress, "RECEIPT_CONTRACT_MISMATCH");
    // ledger-v8 identifiers include a one-byte discriminator (33 bytes).
    assert.match(saved.txId, /^[a-f0-9]{66}$/);
    const observed = await deadline(provider.watchForTxData(saved.txId), 30000, "RECEIPT_LOOKUP_TIMEOUT");
    assert.equal(observed.status, "SucceedEntirely", "TRANSACTION_NOT_SUCCESSFUL");
    assert.equal(observed.txHash, saved.txHash, "RECEIPT_HASH_MISMATCH");
    assert.equal(observed.blockHeight, saved.blockHeight, "RECEIPT_BLOCK_MISMATCH");
    if (observed.identifiers) assert.ok(observed.identifiers.includes(saved.txId), "RECEIPT_ID_MISMATCH");
    const expectedCircuit = { "enroll-a": "enroll", "enroll-b": "enroll", open: "openVoting", "vote-a": "vote", "vote-b": "vote", close: "closeElection" }[id];
    const actions = [...(observed.tx?.intents?.values() || [])].flatMap(intent => intent.actions);
    assert.ok(actions.some(action => {
      if (action.address !== deployment.contractAddress) return false;
      if (id === "deployment") return "initialState" in action;
      const entryPoint = typeof action.entryPoint === "string" ? action.entryPoint : action.entryPoint ? new TextDecoder().decode(action.entryPoint) : undefined;
      return entryPoint === expectedCircuit;
    }), "RECEIPT_DOES_NOT_CONTAIN_EXPECTED_CONTRACT_ACTION");
    // Projection, never return tx (it contains SDK internals) or spread local JSON.
    receipts.push({ id, label, txId: saved.txId, txHash: observed.txHash, blockHeight: observed.blockHeight, status: observed.status });
  }
  // A timed-out negative test is not a rejection. Do not let the next ballot
  // bypass its unresolved journal, even when no tally change is currently visible.
  let negativeProofEvidence = { status: "NOT_RUN" };
  const hasNegativeIntent = await store.exists("voter-modified-proof-broadcast.json");
  const hasNegativeResult = await store.exists("voter-modified-proof-rejected.json");
  if (hasNegativeIntent || hasNegativeResult) {
    if (!hasNegativeIntent || !hasNegativeResult) recovery.push("modified-proof-check");
    else {
      const intent = await store.read("voter-modified-proof-broadcast.json");
      const result = await store.read("voter-modified-proof-rejected.json");
      for (const value of [intent, result]) {
        assert.equal(value.network, "preview", "NEGATIVE_TEST_SCOPE_MISMATCH");
        assert.equal(value.contractAddress, deployment.contractAddress, "NEGATIVE_TEST_SCOPE_MISMATCH");
        assert.equal(value.proofBodyMutated, true, "NEGATIVE_TEST_MUTATION_EVIDENCE_MISSING");
      }
      assert.equal(result.code, "NETWORK_REJECTED_MODIFIED_PROOF", "NEGATIVE_TEST_REJECTION_NOT_CONFIRMED");
      assert.equal(result.stateUnchanged, true, "NEGATIVE_TEST_STATE_CHECK_MISSING");
      assert.ok(Array.isArray(intent.identifiers) && intent.identifiers.length > 0 && intent.identifiers.every(id => /^[a-f0-9]{66}$/.test(id)), "NEGATIVE_TEST_IDENTIFIERS_INVALID");
      assert.deepEqual(result.identifiers, intent.identifiers, "NEGATIVE_TEST_ID_MISMATCH");
      assert.equal(result.transactionHash, intent.transactionHash, "NEGATIVE_TEST_HASH_MISMATCH");
      assert.match(result.transactionHash, /^[a-f0-9]{64}$/);
      assert.match(result.rejection, /1010|Invalid.?Transaction|invalid proof|VerificationError/i);
      negativeProofEvidence = { status: "RECORDED_NODE_REJECTION", transactionHash: result.transactionHash, verifiedAt: result.verifiedAt };
    }
  }
  const state = publicLedger(view);
  if (state.phase === "CLOSED") {
    assert.equal(state.eligibleCount, "2", "UNEXPECTED_CLOSED_ELIGIBILITY");
    assert.equal(state.usedNullifiers, "2", "UNEXPECTED_CLOSED_NULLIFIERS");
    assert.deepEqual(state.tally, { YES: "1", NO: "1" }, "UNEXPECTED_CLOSED_TALLY");
  }
  return { network: "preview", electionId: ELECTION_NAME, contractAddress: deployment.contractAddress,
    checkedAt: new Date().toISOString(), verifierKeysMatch: true, state, receipts, recovery, negativeProofEvidence,
    completeBallotVerified: state.phase === "CLOSED" && receipts.length === RECEIPT_STEPS.length && recovery.length === 0 };
}
