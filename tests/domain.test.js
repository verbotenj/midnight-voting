import test from "node:test";
import assert from "node:assert/strict";
import {
  ELECTION_ID,
  castVote,
  closeElection,
  createDemoState,
  credentialCommitment,
  issueCredential,
  publicElectionState,
  simulatedProofDigest,
  voteNullifier,
} from "../lib/domain.js";

const secretA = "a".repeat(64);
const secretB = "b".repeat(64);

function issue(state, passport, secret = secretA) {
  return issueCredential(state, {
    electionId: ELECTION_ID,
    demoPassport: passport,
    commitment: credentialCommitment(ELECTION_ID, secret),
  });
}

function proof(secret, choice = "YES", electionId = ELECTION_ID) {
  const commitment = credentialCommitment(electionId, secret);
  const nullifier = voteNullifier(electionId, secret);
  return {
    electionId,
    choice,
    credentialSecret: secret,
    proofMode: "SIMULATED_ZK",
    proofDigest: simulatedProofDigest({ electionId, choice, commitment, nullifier, credentialSecret: secret }),
  };
}

test("three-passport demo produces a private 1–1 tally", () => {
  const state = createDemoState();
  assert.equal(issue(state, "DEMO-P001", secretA).body.code, "ISSUED");
  assert.equal(castVote(state, proof(secretA, "YES")).body.code, "ACCEPTED");
  assert.equal(issue(state, "DEMO-P002", secretB).body.code, "ISSUED");
  assert.equal(castVote(state, proof(secretB, "NO")).body.code, "ACCEPTED");
  assert.equal(issue(state, "DEMO-P003", "c".repeat(64)).body.code, "REVOKED");

  const publicState = publicElectionState(state);
  assert.deepEqual(publicState.tally, { YES: 1, NO: 1 });
  assert.equal(publicState.votesCast, 2);
  assert.equal(JSON.stringify(publicState).includes("DEMO-P"), false);
});

test("copied app cannot obtain a second entitlement", () => {
  const state = createDemoState();
  assert.equal(issue(state, "DEMO-P001", secretA).status, 201);
  const replay = issue(state, "DEMO-P001", secretB);
  assert.equal(replay.status, 409);
  assert.equal(replay.body.code, "ALREADY_ISSUED");
});

test("the same credential cannot vote twice", () => {
  const state = createDemoState();
  issue(state, "DEMO-P001", secretA);
  assert.equal(castVote(state, proof(secretA)).status, 201);
  const replay = castVote(state, proof(secretA));
  assert.equal(replay.status, 409);
  assert.equal(replay.body.code, "CREDENTIAL_ALREADY_USED");
});

test("invalid, revoked and malformed issuance requests are rejected", () => {
  const state = createDemoState();
  assert.equal(issue(state, "DEMO-P999", secretA).body.code, "NOT_ELIGIBLE");
  assert.equal(issue(state, "DEMO-P003", secretA).body.code, "REVOKED");
  assert.equal(issueCredential(state, {
    electionId: ELECTION_ID,
    demoPassport: "DEMO-P001",
    commitment: "not-a-commitment",
  }).body.code, "INVALID_COMMITMENT");
});

test("modified proofs and credentials from another election are rejected", () => {
  const state = createDemoState();
  issue(state, "DEMO-P001", secretA);
  assert.equal(castVote(state, { ...proof(secretA), proofDigest: "0".repeat(64) }).body.code, "INVALID_PROOF");
  assert.equal(castVote(state, proof(secretA, "YES", "ELECTION-DEMO-2026-002")).body.code, "ELECTION_NOT_FOUND");
});

test("a resubmitted blockchain transaction resolves to the same nullifier", () => {
  assert.equal(voteNullifier(ELECTION_ID, secretA), voteNullifier(ELECTION_ID, secretA));
  assert.notEqual(voteNullifier(ELECTION_ID, secretA), voteNullifier("ELECTION-DEMO-2026-002", secretA));
});

test("two devices racing for one passport produce exactly one credential", () => {
  const state = createDemoState();
  const results = [issue(state, "DEMO-P001", secretA), issue(state, "DEMO-P001", secretB)];
  assert.deepEqual(results.map((result) => result.body.code), ["ISSUED", "ALREADY_ISSUED"]);
  assert.equal(publicElectionState(state).eligibleCredentialCount, 1);
});

test("deleting the app secret does not let the identity receive a replacement", () => {
  const state = createDemoState();
  assert.equal(issue(state, "DEMO-P001", secretA).body.code, "ISSUED");
  // The first device secret is now assumed lost; a reinstalled app creates secretB.
  assert.equal(issue(state, "DEMO-P001", secretB).body.code, "ALREADY_ISSUED");
});

test("closing freezes eligibility as well as the tally", () => {
  const state = createDemoState();
  issue(state, "DEMO-P001", secretA);
  closeElection(state);
  const before = publicElectionState(state);
  assert.equal(issue(state, "DEMO-P002", secretB).body.code, "ELECTION_CLOSED");
  assert.deepEqual(publicElectionState(state), before);
});

test("a closed election rejects an otherwise valid proof without changing tally", () => {
  const state = createDemoState();
  issue(state, "DEMO-P001", secretA);
  closeElection(state);
  const result = castVote(state, proof(secretA));
  assert.equal(result.body.code, "ELECTION_CLOSED");
  assert.equal(publicElectionState(state).votesCast, 0);
});
