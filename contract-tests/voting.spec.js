import test from "node:test";
import assert from "node:assert/strict";
import * as RT from "@midnight-ntwrk/compact-runtime";
import { Contract, Phase, ledger, pureCircuits } from "../compact/managed/voting/contract/index.js";
import { votingWitnesses } from "../lib/compact-witnesses.js";

const bytes = n => new Uint8Array(32).fill(n);
const id = bytes(1), nonce = bytes(2), admin = bytes(3), voterA = bytes(4), voterB = bytes(5);
const COIN = "0".repeat(64);

function election(electionId = id, instanceNonce = nonce) {
  const contract = new Contract(votingWitnesses);
  const address = RT.sampleContractAddress();
  const initial = contract.initialState(RT.createConstructorContext({}, COIN), electionId, instanceNonce, pureCircuits.authorityKey(admin));
  let state = initial.currentContractState;
  const view = () => ledger(state);
  const call = (name, privateState, ...args) => {
    const ctx = RT.createCircuitContext(address, COIN, state, privateState);
    const result = contract.impureCircuits[name](ctx, ...args);
    state = result.context.currentQueryContext.state;
    return result;
  };
  const enroll = secret => call("enroll", { authoritySecret: admin }, pureCircuits.commitment(electionId, instanceNonce, secret));
  const open = () => call("openVoting", { authoritySecret: admin });
  return { contract, address, view, call, enroll, open };
}

test("compiled contract: two credentials produce one YES and one NO, then close", () => {
  const e = election();
  e.enroll(voterA); e.enroll(voterB); e.open();
  const root = e.view().eligible.root();
  const first = e.call("vote", { credentialSecret: voterA }, true);
  const second = e.call("vote", { credentialSecret: voterB }, false);
  assert.notDeepEqual(first.result, second.result);
  assert.equal(e.view().yesVotes, 1n);
  assert.equal(e.view().noVotes, 1n);
  assert.equal(e.view().usedNullifiers.size(), 2n);
  assert.deepEqual(e.view().eligible.root(), root);
  e.call("closeElection", { authoritySecret: admin });
  assert.equal(e.view().phase, Phase.CLOSED);
  assert.throws(() => e.call("vote", { credentialSecret: voterA }, true), /VOTING_NOT_OPEN/);
});

test("compiled contract: only the authority can enroll, open or close", () => {
  const e = election();
  const impostor = { authoritySecret: bytes(9) };
  assert.throws(() => e.call("enroll", impostor, bytes(7)), /UNAUTHORIZED_AUTHORITY/);
  e.enroll(voterA); e.enroll(voterB);
  assert.throws(() => e.call("openVoting", impostor), /UNAUTHORIZED_AUTHORITY/);
  e.open();
  assert.throws(() => e.call("closeElection", impostor), /UNAUTHORIZED_AUTHORITY/);
  assert.equal(e.view().phase, Phase.VOTING);
});

test("compiled contract: enrollment duplicates and a one-person opening are rejected", () => {
  const e = election();
  assert.throws(() => e.open(), /ENROLL_AT_LEAST_TWO_CREDENTIALS/);
  e.enroll(voterA);
  assert.throws(() => e.enroll(voterA), /COMMITMENT_ALREADY_ENROLLED/);
  assert.throws(() => e.open(), /ENROLL_AT_LEAST_TWO_CREDENTIALS/);
  assert.equal(e.view().eligibleCount, 1n);
});

test("compiled contract: enrollment root cannot change during or after voting", () => {
  const e = election(); e.enroll(voterA); e.enroll(voterB); e.open();
  const root = e.view().eligible.root();
  assert.throws(() => e.enroll(bytes(8)), /ENROLLMENT_CLOSED/);
  assert.throws(() => e.open(), /WRONG_ELECTION_PHASE/);
  e.call("closeElection", { authoritySecret: admin });
  assert.throws(() => e.enroll(bytes(8)), /ENROLLMENT_CLOSED/);
  assert.deepEqual(e.view().eligible.root(), root);
});

test("compiled contract: duplicate voting cannot change the choice or increment again", () => {
  const e = election(); e.enroll(voterA); e.enroll(voterB); e.open();
  e.call("vote", { credentialSecret: voterA }, true);
  assert.throws(() => e.call("vote", { credentialSecret: voterA }, false), /CREDENTIAL_ALREADY_USED/);
  assert.equal(e.view().yesVotes, 1n);
  assert.equal(e.view().noVotes, 0n);
  assert.equal(e.view().usedNullifiers.size(), 1n);
});

test("compiled contract: forged leaf, forged path and stale enrollment root are rejected", () => {
  const e = election(); e.enroll(voterA);
  const leaf = pureCircuits.commitment(id, nonce, voterA);
  const stale = e.view().eligible.findPathForLeaf(leaf);
  e.enroll(voterB); e.open();
  const valid = e.view().eligible.findPathForLeaf(leaf);
  assert.throws(() => e.call("vote", { credentialSecret: bytes(9), membershipPath: valid }, true), /CREDENTIAL_LEAF_MISMATCH/);
  assert.throws(() => e.call("vote", { credentialSecret: voterA, membershipPath: stale }, true), /INVALID_MEMBERSHIP_ROOT/);
  const fake = structuredClone(valid);
  fake.path[0].sibling.field += 1n;
  assert.throws(() => e.call("vote", { credentialSecret: voterA, membershipPath: fake }, true), /INVALID_MEMBERSHIP_ROOT/);
  assert.equal(e.view().usedNullifiers.size(), 0n);
});

test("compiled contract: election, instance and contract domain separation", () => {
  const e = election();
  const address = { bytes: new Uint8Array(Buffer.from(e.address, "hex")) };
  const n = pureCircuits.votingNullifier(id, nonce, address, voterA);
  assert.notDeepEqual(n, pureCircuits.votingNullifier(bytes(8), nonce, address, voterA));
  assert.notDeepEqual(n, pureCircuits.votingNullifier(id, bytes(8), address, voterA));
  assert.notDeepEqual(n, pureCircuits.votingNullifier(id, nonce, { bytes: bytes(8) }, voterA));
  assert.notDeepEqual(pureCircuits.commitment(id, nonce, voterA), pureCircuits.commitment(bytes(8), nonce, voterA));
  const other = election(bytes(8));
  other.enroll(voterA); other.enroll(voterB); other.open();
  const otherPath = other.view().eligible.findPathForLeaf(pureCircuits.commitment(bytes(8), nonce, voterA));
  e.enroll(voterA); e.enroll(voterB); e.open();
  assert.throws(() => e.call("vote", { credentialSecret: voterA, membershipPath: otherPath }, true), /CREDENTIAL_LEAF_MISMATCH/);
});

test("compiled contract: vote requires a Boolean and a registered credential", () => {
  const e = election();
  assert.throws(() => e.call("vote", { credentialSecret: voterA }, true), /VOTING_NOT_OPEN/);
  e.enroll(voterA); e.enroll(voterB); e.open();
  assert.throws(() => e.call("vote", { credentialSecret: bytes(9) }, true), /CREDENTIAL_NOT_ENROLLED/);
  assert.throws(() => e.call("vote", { credentialSecret: voterA }, "YES"));
  assert.equal(e.view().usedNullifiers.size(), 0n);
});
