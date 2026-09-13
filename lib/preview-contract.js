import { fileURLToPath } from "node:url";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { Contract } from "../compact/managed/voting/contract/index.js";
import { votingWitnesses } from "./compact-witnesses.js";
import { selectedPreview } from "./preview-config.js";

export const artifactDirectory = fileURLToPath(new URL("../compact/managed/voting/", import.meta.url));
export const compiledVoting = CompiledContract.withCompiledFileAssets(
  CompiledContract.withWitnesses(CompiledContract.make("voting", Contract), votingWitnesses), artifactDirectory,
);
export const zkConfigProvider = new NodeZkConfigProvider(artifactDirectory);
export const PROVER_URL = "http://127.0.0.1:6300";
export const ELECTION_NAME = selectedPreview.electionId;
// This election name fits into Bytes<32>; no passport data is encoded here.
export const electionBytes = new Uint8Array(32);
electionBytes.set(new TextEncoder().encode(ELECTION_NAME));

export async function requireLocalProver() {
  const health = await fetch(`${PROVER_URL}/health`, { signal: AbortSignal.timeout(5000) });
  if (!health.ok) throw new Error("LOCAL_PROVER_UNAVAILABLE");
}

export const publicLedger = view => ({
  phase: ["ENROLLMENT", "VOTING", "CLOSED"][view.phase],
  eligibleCount: String(view.eligibleCount),
  eligibilityRoot: String(view.eligible.root().field),
  usedNullifiers: String(view.usedNullifiers.size()),
  tally: { YES: String(view.yesVotes), NO: String(view.noVotes) },
});
