// Local development actor. No HTTP endpoint; parent IPC carries commitments and
// commands, never witness secrets. Roles have separate credential/state stores.
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { createUnprovenCallTx, submitTx, verifyContractState } from "@midnight-ntwrk/midnight-js-contracts";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider, httpClientProvingProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { CostModel } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { SucceedEntirely } from "@midnight-ntwrk/midnight-js-types";
import { validatePassword } from "@midnight-ntwrk/midnight-js-utils";
import { ledger, pureCircuits } from "../compact/managed/voting/contract/index.js";
import { compiledVoting, zkConfigProvider, PROVER_URL, electionBytes, ELECTION_NAME, requireLocalProver, publicLedger } from "../lib/preview-contract.js";
import { withPreviewWallet, PREVIEW_HTTP, PREVIEW_WS, logStage, deadline } from "../lib/preview-wallet.js";
import { createPreviewStore } from "../lib/preview-store.js";
import { reserveIssuance, planIssuanceRecovery } from "../lib/preview-issuance.js";
import { previewErrorMessage, isDefiniteInvalidTransaction } from "../lib/preview-errors.js";

const role = process.argv[2];
if (!process.send || !["authority", "voter"].includes(role)) throw new Error("LOCAL_PARENT_AND_ROLE_REQUIRED");
setNetworkId("preview");
const bytes = hex => { if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error("INVALID_BYTES32"); return new Uint8Array(Buffer.from(hex, "hex")); };
const hex = value => Buffer.from(value).toString("hex");
const safeError = previewErrorMessage;
const send = message => { if (process.connected) process.send(message); };
let release;
let parentDisconnected = false;
process.once("disconnect", () => { parentDisconnected = true; });
try {
  const store = await createPreviewStore();
  release = await store.lock(`${role}-worker-lock.json`);
  const deployment = await store.read("deployment.json");
  if (deployment.network !== "preview" || deployment.electionId !== ELECTION_NAME) throw new Error("DEPLOYMENT_SCOPE_MISMATCH");
  const contractAddress = deployment.contractAddress;
  await requireLocalProver();
  await withPreviewWallet(role, async ({ wallet, walletProvider, address }) => {
    if (parentDisconnected) throw new Error("PARENT_DISCONNECTED_NO_ACTION_STARTED");
    const publicDataProvider = indexerPublicDataProvider(PREVIEW_HTTP, PREVIEW_WS);
    const getState = async () => {
      const state = await publicDataProvider.queryContractState(contractAddress);
      if (!state) throw new Error("CONTRACT_STATE_MISSING");
      const view = ledger(state.data);
      assert.deepEqual(view.electionId, electionBytes);
      return { state, view };
    };
    const initial = await getState();
    verifyContractState(await zkConfigProvider.getVerifierKeys(["enroll", "openVoting", "vote", "closeElection"]), initial.state);
    let authoritySecret, storagePassword;
    if (role === "authority") {
      const privateData = await store.read("authority-private.json");
      authoritySecret = bytes(privateData.authoritySecret); storagePassword = privateData.storagePassword;
      assert.deepEqual(pureCircuits.authorityKey(authoritySecret), initial.view.authority);
    } else {
      if (!(await store.exists("voter-storage.json"))) {
        let password;
        do { password = `Aa9!${randomBytes(48).toString("base64url")}`; try { validatePassword(password); break; } catch { password = null; } } while (!password);
        await store.create("voter-storage.json", { password });
      }
      storagePassword = (await store.read("voter-storage.json")).password;
    }
    validatePassword(storagePassword);
    const privateStateProvider = levelPrivateStateProvider({ midnightDbName: store.path(`${role}-actor-state-db`), accountId: address,
      privateStateStoreName: `voting-${role}`, signingKeyStoreName: `maintenance-${role}`, privateStoragePasswordProvider: () => storagePassword });
    privateStateProvider.setContractAddress(contractAddress);
    const actualProofProvider = httpClientProofProvider(PROVER_URL, zkConfigProvider);
    const proofProvider = { async proveTx(...args) {
      logStage("prove-start", { role });
      const result = await actualProofProvider.proveTx(...args);
      logStage("prove-finished", { role });
      return result;
    } };
    const baseProviders = { publicDataProvider, walletProvider, zkConfigProvider, privateStateProvider, proofProvider };
    const confirmedName = operation => `${role}-${operation}-confirmed.json`;
    const intentName = operation => `${role}-${operation}-broadcast.json`;
    const receiptOnly = receipt => ({ network: "preview", contractAddress, txId: receipt.txId, txHash: receipt.txHash,
      blockHeight: receipt.blockHeight, status: receipt.status, verifiedAt: new Date().toISOString() });
    const makeCall = async (circuitId, privateState, args = []) => {
      await privateStateProvider.set("active", privateState);
      return createUnprovenCallTx(baseProviders, { compiledContract: compiledVoting, contractAddress, circuitId, privateStateId: "active", args });
    };
    const call = async (operation, circuitId, privateState, args, assertAfter) => {
      if (await store.exists(confirmedName(operation))) {
        const saved = await store.read(confirmedName(operation));
        const receipt = await deadline(publicDataProvider.watchForTxData(saved.txId), 30000, "RECEIPT_LOOKUP_TIMEOUT");
        assert.equal(receipt.status, SucceedEntirely); assert.equal(receipt.txHash, saved.txHash);
        return { code: "ALREADY_FINALIZED", receipt: saved };
      }
      if (await store.exists(intentName(operation))) throw new Error("BROADCAST_OUTCOME_REQUIRES_RECONCILIATION");
      const before = (await getState()).view;
      logStage("build-real-call", { role, circuitId });
      const data = await makeCall(circuitId, privateState, args);
      const midnightProvider = { async submitTx(tx) {
        await store.create(intentName(operation), { network: "preview", contractAddress, circuitId,
          identifiers: tx.identifiers(), transactionHash: tx.transactionHash(), at: new Date().toISOString() });
        logStage("call-broadcast", { role, circuitId, identifiers: tx.identifiers() });
        return deadline(wallet.submitTransaction(tx), 10 * 60000, "SUBMISSION_OUTCOME_UNKNOWN_NO_AUTOMATIC_RETRY");
      } };
      const receipt = await submitTx({ ...baseProviders, midnightProvider }, { unprovenTx: data.private.unprovenTx });
      assert.equal(receipt.status, SucceedEntirely);
      const after = (await getState()).view;
      assertAfter(before, after);
      const result = receiptOnly(receipt);
      await store.create(confirmedName(operation), result);
      logStage("call-finalized-and-state-verified", { role, circuitId, ...result, state: publicLedger(after) });
      return { code: "FINALIZED", receipt: result };
    };
    const credential = async slot => {
      if (!["a", "b", "copy", "revoked"].includes(slot)) throw new Error("INVALID_VOTER_SLOT");
      const name = `voter-credential-${slot}.json`, view = (await getState()).view;
      if (!(await store.exists(name))) {
        const secret = randomBytes(32), commitment = pureCircuits.commitment(view.electionId, view.instance, secret);
        await store.create(name, { network: "preview", contractAddress, electionId: hex(view.electionId), instance: hex(view.instance), secret: hex(secret), commitment: hex(commitment) });
        secret.fill(0);
      }
      const stored = await store.read(name);
      if (stored.contractAddress !== contractAddress || stored.network !== "preview" || stored.electionId !== hex(view.electionId) || stored.instance !== hex(view.instance)) throw new Error("CREDENTIAL_SCOPE_MISMATCH");
      assert.equal(hex(pureCircuits.commitment(view.electionId, view.instance, bytes(stored.secret))), stored.commitment);
      return stored;
    };
    const handle = async ({ method, params = {} }) => {
      if (method === "state") return { code: "STATE", state: publicLedger((await getState()).view) };
      if (role === "authority" && method === "enroll") {
        const reservation = await reserveIssuance(store, { contractAddress, electionId: ELECTION_NAME }, params.demoPassport, params.commitment);
        if (reservation.code !== "RESERVED") {
          if (reservation.code === "ALREADY_ISSUED_OR_RESERVED") {
            if (reservation.contractMatches === false) return { code: "ALREADY_ISSUED_FOR_ELECTION", sameCommitment: false };
            const recorded = await store.read(reservation.reservation);
            const view = (await getState()).view;
            const decision = planIssuanceRecovery({ ...reservation, enrolled: view.enrolled.member(bytes(recorded.commitment)), phase: view.phase,
              broadcastExists: await store.exists(intentName(`enroll-${params.demoPassport}`)), confirmedExists: await store.exists(confirmedName(`enroll-${params.demoPassport}`)) });
            if (decision.code !== "RESUME_UNBROADCAST_ISSUANCE") return decision;
            // The same stored commitment, no broadcast journal, and open enrollment:
            // the original request may continue without creating another reservation.
            logStage("resume-unbroadcast-issuance", { role });
          } else {
            return { code: reservation.code };
          }
        }
        const commitment = bytes(params.commitment);
        const result = await call(`enroll-${params.demoPassport}`, "enroll", { authoritySecret }, [commitment], (before, after) => {
          assert.equal(after.eligibleCount, before.eligibleCount + 1n); assert.equal(after.enrolled.member(commitment), true);
        });
        return { ...result, code: "ISSUED" };
      }
      if (role === "authority" && ["open", "close"].includes(method)) {
        const circuit = method === "open" ? "openVoting" : "closeElection";
        return call(method, circuit, { authoritySecret }, [], (before, after) => {
          assert.equal(after.phase, method === "open" ? 1 : 2);
          assert.deepEqual(before.eligible.root(), after.eligible.root());
          assert.equal(after.yesVotes, before.yesVotes); assert.equal(after.noVotes, before.noVotes);
        });
      }
      if (role === "voter" && method === "prepare") return { code: "PREPARED", commitment: (await credential(params.slot)).commitment };
      if (role === "voter" && method === "testModifiedProof") {
        if (await store.exists("voter-modified-proof-rejected.json")) return store.read("voter-modified-proof-rejected.json");
        if (await store.exists("voter-modified-proof-broadcast.json")) throw new Error("NEGATIVE_TEST_OUTCOME_REQUIRES_RECONCILIATION");
        const stored = await credential("a"), secret = bytes(stored.secret);
        try {
          const before = publicLedger((await getState()).view);
          const data = await makeCall("vote", { credentialSecret: secret }, [true]);
          const realProver = httpClientProvingProvider(PROVER_URL, zkConfigProvider);
          let modified = false;
          const proven = await data.private.unprovenTx.prove({
            check: (...args) => realProver.check(...args),
            prove: async (...args) => {
              const proof = new Uint8Array(await realProver.prove(...args));
              if (args[1] === "vote") { proof[Math.floor(proof.length / 2)] ^= 1; modified = true; }
              return proof;
            },
          }, CostModel.initialCostModel());
          assert.equal(modified, true);
          const tx = await walletProvider.balanceTx(proven);
          const intent = { network: "preview", contractAddress, identifiers: tx.identifiers(), transactionHash: tx.transactionHash(), proofBodyMutated: true };
          await store.create("voter-modified-proof-broadcast.json", intent);
          logStage("submit-deliberately-modified-proof", { identifiers: tx.identifiers() });
          let rejection;
          try {
            await deadline(wallet.submitTransaction(tx), 3 * 60000, "NEGATIVE_TEST_SUBMISSION_OUTCOME_UNKNOWN");
            throw new Error("MODIFIED_PROOF_UNEXPECTEDLY_ACCEPTED_STOP");
          } catch (error) {
            const message = safeError(error);
            // Only a deterministic invalid-transaction response is a rejection.
            // Transport failures, timeouts and unrelated exceptions remain unknown.
            if (!isDefiniteInvalidTransaction(error)) throw error;
            rejection = message;
          }
          const after = publicLedger((await getState()).view);
          assert.deepEqual(after, before);
          const result = { code: "NETWORK_REJECTED_MODIFIED_PROOF", ...intent, rejection, stateUnchanged: true, verifiedAt: new Date().toISOString() };
          await store.create("voter-modified-proof-rejected.json", result);
          logStage("modified-proof-rejected-by-preview", result);
          return result;
        } finally { secret.fill(0); }
      }
      if (role === "voter" && method === "vote") {
        const stored = await credential(params.slot), secret = bytes(stored.secret);
        if (typeof params.yes !== "boolean") throw new Error("BOOLEAN_CHOICE_REQUIRED");
        const operation = `${params.repeat ? "repeat" : "vote"}-${params.slot}`;
        try {
          return await call(operation, "vote", { credentialSecret: secret }, [params.yes], (before, after) => {
            const nullifier = pureCircuits.votingNullifier(before.electionId, before.instance, { bytes: bytes(contractAddress) }, secret);
            assert.equal(after.usedNullifiers.member(nullifier), true);
            assert.equal(after.usedNullifiers.size(), before.usedNullifiers.size() + 1n);
            assert.equal(after.yesVotes, before.yesVotes + (params.yes ? 1n : 0n));
            assert.equal(after.noVotes, before.noVotes + (params.yes ? 0n : 1n));
          });
        } catch (error) {
          if (/CREDENTIAL_ALREADY_USED/.test(error.message)) return { code: "CREDENTIAL_ALREADY_USED", stage: "CIRCUIT_CONSTRUCTION", broadcast: false };
          if (/VOTING_NOT_OPEN/.test(error.message)) return { code: "VOTING_NOT_OPEN", stage: "CIRCUIT_CONSTRUCTION", broadcast: false };
          throw error;
        } finally { secret.fill(0); }
      }
      throw new Error("ROLE_OPERATION_NOT_ALLOWED");
    };
    if (parentDisconnected) throw new Error("PARENT_DISCONNECTED_NO_ACTION_STARTED");
    send({ event: "ready", role });
    await new Promise(resolve => {
      let queue = Promise.resolve();
      process.on("message", message => {
        queue = queue.then(async () => {
          if (message.method === "shutdown") { resolve(); return; }
          try { send({ id: message.id, result: await handle(message) }); }
          catch (error) { send({ id: message.id, error: safeError(error) }); }
        });
      });
      process.once("disconnect", () => { queue.finally(resolve); });
    });
    authoritySecret?.fill(0);
  });
} catch (error) { send({ event: "fatal", role, error: safeError(error) }); process.exitCode = 1; }
finally { if (release) await release(); if (process.connected) process.disconnect(); }
