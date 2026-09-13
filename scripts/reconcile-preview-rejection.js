// One-time reconciliation of the captured first-run RPC rejection. This does
// not infer rejection from missing chain data and does not submit a transaction.
import assert from "node:assert/strict";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { ledger } from "../compact/managed/voting/contract/index.js";
import { createPreviewStore } from "../lib/preview-store.js";
import { requirePreview, PREVIEW_HTTP, PREVIEW_WS } from "../lib/preview-wallet.js";
import { publicLedger } from "../lib/preview-contract.js";

setNetworkId("preview");
await requirePreview();
const store = await createPreviewStore();
const observed = await store.read("voter-modified-proof-observed-rejection.json");
const intent = await store.read("voter-modified-proof-broadcast.json");
assert.equal(observed.network, "preview");
assert.equal(observed.rpcError, "1010: Invalid Transaction: Custom error: 115");
assert.deepEqual(observed.identifiers, intent.identifiers);
assert.equal(observed.transactionHash, intent.transactionHash);
assert.equal(observed.contractAddress, intent.contractAddress);
const provider = indexerPublicDataProvider(PREVIEW_HTTP, PREVIEW_WS);
const chain = await provider.queryContractState(intent.contractAddress);
assert.ok(chain);
const state = publicLedger(ledger(chain.data));
assert.equal(state.phase, "VOTING"); assert.equal(state.eligibleCount, "2");
assert.equal(state.usedNullifiers, "0"); assert.deepEqual(state.tally, { YES: "0", NO: "0" });
assert.equal(state.eligibilityRoot, "52267192708776976451338597357205625133784705819450886250680618576935542268533");
await store.create("voter-modified-proof-rejected.json", { code: "NETWORK_REJECTED_MODIFIED_PROOF", ...intent,
  rejection: observed.rpcError, evidenceSource: observed.source, rejectionObservedAt: observed.observedAt,
  stateUnchanged: true, verifiedState: state, verifiedAt: new Date().toISOString() });
console.log("Captured RPC rejection reconciled with its exact journal and unchanged on-chain state. Nothing resubmitted.");
