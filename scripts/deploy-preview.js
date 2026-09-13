import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, lstat, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { createUnprovenDeployTx, submitTx, verifyContractState } from "@midnight-ntwrk/midnight-js-contracts";
import { sampleSigningKey } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { SucceedEntirely } from "@midnight-ntwrk/midnight-js-types";
import { validatePassword } from "@midnight-ntwrk/midnight-js-utils";
import { pureCircuits, ledger } from "../compact/managed/voting/contract/index.js";
import { compiledVoting, zkConfigProvider, PROVER_URL, electionBytes, ELECTION_NAME, requireLocalProver, publicLedger } from "../lib/preview-contract.js";
import { withPreviewWallet, PREVIEW_HTTP, PREVIEW_WS, requirePreview, logStage, deadline } from "../lib/preview-wallet.js";
import { previewDirectory, lockPreviewOperation } from "../lib/preview-store.js";

setNetworkId("preview");
const directory = previewDirectory;
const path = name => `${directory}${name}`;
const readJson = async name => {
  const stat = await lstat(path(name));
  if (!stat.isFile() || (stat.mode & 0o077)) throw new Error("UNSAFE_LOCAL_FILE_PERMISSIONS");
  return JSON.parse(await readFile(path(name), "utf8"));
};
const exists = async name => { try { await lstat(path(name)); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const writeJson = async (name, value) => {
  const handle = await open(path(name), "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); } finally { await handle.close(); }
};
let release, stage = "setup";
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const dirStat = await lstat(directory);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || (dirStat.mode & 0o077)) throw new Error("UNSAFE_LOCAL_DIRECTORY");
  const publicDataProvider = indexerPublicDataProvider(PREVIEW_HTTP, PREVIEW_WS);
  await requirePreview();
  if (await exists("deployment.json")) {
    const deployment = await readJson("deployment.json");
    if (deployment.network !== "preview" || deployment.electionId !== ELECTION_NAME) throw new Error("SAVED_DEPLOYMENT_SCOPE_MISMATCH");
    const current = await publicDataProvider.queryContractState(deployment.contractAddress);
    if (!current) throw new Error("SAVED_CONTRACT_NOT_FOUND_ON_PREVIEW");
    verifyContractState(await zkConfigProvider.getVerifierKeys(["enroll", "openVoting", "vote", "closeElection"]), current);
    assert.deepEqual(ledger(current.data).electionId, electionBytes);
    const receipt = await deadline(publicDataProvider.watchForTxData(deployment.txId), 30000, "DEPLOYMENT_RECEIPT_CHECK_TIMEOUT");
    if (receipt.status !== SucceedEntirely || receipt.txHash !== deployment.txHash || receipt.blockHeight !== deployment.blockHeight) throw new Error("DEPLOYMENT_RECEIPT_MISMATCH");
    logStage("already-deployed", { contractAddress: deployment.contractAddress, deploymentFinalized: true, blockHeight: receipt.blockHeight,
      localVerifierKeysMatchOnChain: true, state: publicLedger(ledger(current.data)) });
  } else {
    if (!process.argv.includes("--submit")) throw new Error("USE_--submit_TO_DEPLOY_WITH_TEST_DUST");
    if (await exists("deploy-broadcast.json")) throw new Error("PRIOR_BROADCAST_REQUIRES_RECONCILIATION_NO_AUTOMATIC_REDEPLOY");
    await requireLocalProver();
    release = await lockPreviewOperation();
    if (!(await exists("authority-private.json"))) {
      let storagePassword;
      do {
        storagePassword = `Aa9!${randomBytes(48).toString("base64url")}`;
        try { validatePassword(storagePassword); break; } catch { storagePassword = null; }
      } while (!storagePassword);
      await writeJson("authority-private.json", { version: 1, network: "preview", authoritySecret: randomBytes(32).toString("hex"),
        instance: randomBytes(32).toString("hex"), maintenanceSigningKey: sampleSigningKey(), storagePassword });
    }
    const secretState = await readJson("authority-private.json");
    if (secretState.version !== 1 || secretState.network !== "preview" || !/^[a-f0-9]{64}$/.test(secretState.authoritySecret) || !/^[a-f0-9]{64}$/.test(secretState.instance)) throw new Error("INVALID_LOCAL_AUTHORITY_STATE");
    validatePassword(secretState.storagePassword);
    const authoritySecret = new Uint8Array(Buffer.from(secretState.authoritySecret, "hex"));
    const instance = new Uint8Array(Buffer.from(secretState.instance, "hex"));
    stage = "wallet-sync";
    await withPreviewWallet("authority", async ({ wallet, walletProvider, address }) => {
      const privateStateProvider = levelPrivateStateProvider({ midnightDbName: path("private-state-db"), accountId: address,
        privateStateStoreName: "voting-authority", signingKeyStoreName: "voting-maintenance",
        privateStoragePasswordProvider: () => secretState.storagePassword });
      const proofProvider = httpClientProofProvider(PROVER_URL, zkConfigProvider);
      stage = "build-deployment";
      const data = await createUnprovenDeployTx({ zkConfigProvider, walletProvider }, {
        compiledContract: compiledVoting, signingKey: secretState.maintenanceSigningKey,
        initialPrivateState: { authoritySecret }, args: [electionBytes, instance, pureCircuits.authorityKey(authoritySecret)],
      });
      const contractAddress = data.public.contractAddress;
      // Persist authority and maintenance state BEFORE anything can be broadcast.
      privateStateProvider.setContractAddress(contractAddress);
      await privateStateProvider.set("authority", { authoritySecret });
      await privateStateProvider.setSigningKey(contractAddress, secretState.maintenanceSigningKey);
      await writeJson(`deploy-prepared-${randomUUID()}.json`, { contractAddress, electionId: ELECTION_NAME, network: "preview", at: new Date().toISOString() });
      const midnightProvider = { async submitTx(tx) {
        stage = "broadcast";
        // Exclusive journal is the final gate. Never automatically replay after this exists.
        await writeJson("deploy-broadcast.json", { network: "preview", contractAddress, identifiers: tx.identifiers(), transactionHash: tx.transactionHash(), at: new Date().toISOString() });
        logStage("deployment-broadcast", { contractAddress, identifiers: tx.identifiers() });
        return await deadline(wallet.submitTransaction(tx), 10 * 60000, "SUBMISSION_OUTCOME_UNKNOWN_DO_NOT_REDEPLOY");
      } };
      stage = "prove-and-balance-deployment";
      const receipt = await submitTx({ publicDataProvider, proofProvider, walletProvider, midnightProvider }, { unprovenTx: data.private.unprovenTx });
      if (receipt.status !== SucceedEntirely) throw new Error("DEPLOYMENT_DID_NOT_SUCCEED_ENTIRELY");
      stage = "verify-on-chain-state";
      const state = await publicDataProvider.queryContractState(contractAddress);
      if (!state) throw new Error("FINALIZED_CONTRACT_STATE_MISSING");
      verifyContractState(await zkConfigProvider.getVerifierKeys(["enroll", "openVoting", "vote", "closeElection"]), state);
      const view = ledger(state.data);
      assert.deepEqual(view.electionId, electionBytes);
      assert.deepEqual(view.instance, instance);
      assert.deepEqual(view.authority, pureCircuits.authorityKey(authoritySecret));
      assert.equal(view.phase, 0); assert.equal(view.eligibleCount, 0n); assert.equal(view.usedNullifiers.size(), 0n);
      assert.deepEqual(publicLedger(view).tally, { YES: "0", NO: "0" });
      const deployment = { network: "preview", electionId: ELECTION_NAME, contractAddress,
        txId: receipt.txId, txHash: receipt.txHash, blockHeight: receipt.blockHeight, status: receipt.status,
        verifiedAt: new Date().toISOString(), state: publicLedger(view), privacy: "Public choice/tally; wallet and timing correlation not solved" };
      await writeJson("deployment.json", deployment);
      logStage("DEPLOYMENT_VERIFIED", deployment);
    });
    authoritySecret.fill(0);
  }
} catch (error) {
  logStage("failed", { during: stage, error: String(error.message || "DEPLOYMENT_FAILED").replace(/[a-f0-9]{32,}/gi, "[redacted]").slice(0, 500), automaticRetry: false });
  process.exitCode = 1;
} finally {
  if (release) await release();
}
