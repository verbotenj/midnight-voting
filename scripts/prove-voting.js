// Real circuit proving, entirely local. No wallet, faucet, or chain submission.
import { randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { createUnprovenDeployTx, createUnprovenCallTxFromInitialStates } from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProvingProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { ZswapSecretKeys, ZswapChainState, LedgerState, LedgerParameters, CostModel, sampleSigningKey, WellFormedStrictness, TransactionContext, Transaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { ChargedState } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { pureCircuits, ledger } from "../compact/managed/voting/contract/index.js";
import { compiledVoting, zkConfigProvider, PROVER_URL, electionBytes, requireLocalProver, publicLedger } from "../lib/preview-contract.js";

setNetworkId("preview");
const report = { mode: "REAL_LOCAL_PROVING_NOT_BROADCAST", startedAt: new Date().toISOString(), circuits: [],
  cryptographicVerification: "NOT_PERFORMED_BY_LEDGER_WASM_BUILD",
  verificationWarning: "Ledger WASM 8.1.0 omits the proof-verifying feature. Local wellFormed/apply checks are NOT cryptographic contract-proof verification. Use a real verifier or Preview acceptance/rejection.",
};
const admin = randomBytes(32), nonce = randomBytes(32), voterA = randomBytes(32), voterB = randomBytes(32);
const keys = ZswapSecretKeys.fromSeed(randomBytes(32));
let stage = "health";
try {
  await requireLocalProver();
  const walletProvider = { getCoinPublicKey: () => keys.coinPublicKey, getEncryptionPublicKey: () => keys.encryptionPublicKey };
  const deployed = await createUnprovenDeployTx({ zkConfigProvider, walletProvider }, {
    compiledContract: compiledVoting, signingKey: sampleSigningKey(), initialPrivateState: {},
    args: [electionBytes, nonce, pureCircuits.authorityKey(admin)],
  });
  let state = deployed.public.initialContractState;
  const baseProver = httpClientProvingProvider(PROVER_URL, zkConfigProvider);
  let proofCount = 0;
  const provingProvider = {
    check: (...args) => baseProver.check(...args),
    prove: async (...args) => { const proof = await baseProver.prove(...args); proofCount++; return proof; },
  };
  let referenceLedger = LedgerState.blank("preview");
  const strictness = new WellFormedStrictness();
  // This local ledger has no wallet funding. Balancing is relaxed.
  // WARNING: contract-proof verification is compiled OUT of this WASM package,
  // regardless of verifyContractProofs. These are structural/state checks only.
  strictness.enforceBalancing = false;
  strictness.verifyNativeProofs = true;
  strictness.verifyContractProofs = true;
  strictness.verifySignatures = true;
  strictness.enforceLimits = true;
  const checkAndApply = proven => {
    const now = new Date(), seconds = BigInt(Math.floor(now.getTime() / 1000));
    const verified = proven.bind().wellFormed(referenceLedger, strictness, now);
    const context = new TransactionContext(referenceLedger, { secondsSinceEpoch: seconds, secondsSinceEpochErr: 30,
      parentBlockHash: "0".repeat(64), lastBlockTime: seconds - 6n });
    const [next, result] = referenceLedger.apply(verified, context);
    assert.equal(result.type, "success", "Local ledger must accept the proven transition");
    referenceLedger = next;
  };
  checkAndApply(await deployed.private.unprovenTx.prove(provingProvider, CostModel.initialCostModel()));
  const call = async (circuitId, privateState, args = []) => {
    stage = circuitId;
    process.stdout.write(`${JSON.stringify({ stage, status: "building-and-proving", networkSubmission: false })}\n`);
    const start = performance.now(), priorProofs = proofCount;
    const callData = await createUnprovenCallTxFromInitialStates(zkConfigProvider, {
      compiledContract: compiledVoting, circuitId, contractAddress: deployed.public.contractAddress,
      coinPublicKey: keys.coinPublicKey, initialContractState: state, initialPrivateState: privateState,
      initialZswapChainState: new ZswapChainState(), ledgerParameters: LedgerParameters.initialParameters(), args,
    }, keys.encryptionPublicKey);
    // Independent preimage copy avoids reusing any cached proof from the valid run.
    // Sensitive serialization stays in memory only.
    const negativeTx = circuitId === "vote" && !report.localWasmNegativeProbe
      ? Transaction.deserialize("signature", "pre-proof", "pre-binding", callData.private.unprovenTx.serialize()) : null;
    const proven = await callData.private.unprovenTx.prove(provingProvider, CostModel.initialCostModel());
    assert.ok(proofCount > priorProofs, "A real /prove request must have occurred");
    if (negativeTx) {
      let changedProof = false;
      let acceptedByLocalWasm = false;
      const savedLedger = referenceLedger;
      try {
        const corrupted = await negativeTx.prove({
          check: (...args) => baseProver.check(...args),
          prove: async (...args) => {
            const bytes = new Uint8Array(await baseProver.prove(...args));
            // This diagnostic demonstrates why the WASM structural check
            // must not be used as our cryptographic acceptance gate.
            bytes[Math.floor(bytes.length / 2)] ^= 1;
            changedProof = true;
            return bytes;
          },
        }, CostModel.initialCostModel());
        assert.notDeepEqual(corrupted.serialize(), proven.serialize(), "Mutation must change the transaction");
        checkAndApply(corrupted);
        acceptedByLocalWasm = true;
      } finally { referenceLedger = savedLedger; }
      assert.ok(changedProof, "Mutation callback must execute");
      report.localWasmNegativeProbe = { proofBodyMutated: true, acceptedByLocalWasm,
        conclusion: "Local WASM acceptance is not evidence that a contract proof is valid" };
      process.stdout.write(`${JSON.stringify({ stage: "verification-limit-detected", ...report.localWasmNegativeProbe })}\n`);
    }
    checkAndApply(proven);
    const encoded = proven.serialize();
    const result = { circuitId, elapsedMs: Math.round(performance.now() - start), proofRequests: proofCount - priorProofs, localStructuralTransitionChecked: true,
      provenTransactionBytes: encoded.length, provenTransactionSha256: createHash("sha256").update(encoded).digest("hex") };
    report.circuits.push(result);
    process.stdout.write(`${JSON.stringify({ stage, status: "proof-generated", ...result })}\n`);
    state.data = new ChargedState(callData.public.nextContractState);
  };
  await call("enroll", { authoritySecret: admin }, [pureCircuits.commitment(electionBytes, nonce, voterA)]);
  await call("enroll", { authoritySecret: admin }, [pureCircuits.commitment(electionBytes, nonce, voterB)]);
  await call("openVoting", { authoritySecret: admin });
  await call("vote", { credentialSecret: voterA }, [true]);
  await call("vote", { credentialSecret: voterB }, [false]);
  await call("closeElection", { authoritySecret: admin });
  report.finalLocalState = publicLedger(ledger(state.data));
  assert.deepEqual(report.finalLocalState.tally, { YES: "1", NO: "1" });
  assert.equal(report.finalLocalState.usedNullifiers, "2");
  report.completedAt = new Date().toISOString();
  await mkdir(new URL("../.local/proof-checks/", import.meta.url), { recursive: true, mode: 0o700 });
  const destination = new URL(`../.local/proof-checks/${Date.now()}.json`, import.meta.url);
  await writeFile(destination, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ status: "LOCAL_PROOFS_COMPLETE", ...report.finalLocalState, networkSubmission: false })}\n`);
} catch (error) {
  // Never dump callData, proof preimages, witnesses, or SDK error objects.
  process.stderr.write(`${JSON.stringify({ stage, error: String(error.message || "PROVING_FAILED").replace(/[a-f0-9]{32,}/gi, "[redacted]").slice(0, 500), networkSubmission: false })}\n`);
  process.exitCode = 1;
} finally {
  keys.clear(); [admin, nonce, voterA, voterB].forEach(secret => secret.fill(0));
}
