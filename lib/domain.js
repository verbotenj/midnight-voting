import { createHash } from "node:crypto";

export const ELECTION_ID = "ELECTION-DEMO-2026-001";

export const PASSPORT_FIXTURES = Object.freeze([
  { passport: "DEMO-P001", status: "VALID", eligible: true },
  { passport: "DEMO-P002", status: "VALID", eligible: true },
  { passport: "DEMO-P003", status: "REVOKED", eligible: false },
]);

const DOMAIN = Object.freeze({
  credential: "MIDNIGHT_DEMO_CREDENTIAL_V1",
  nullifier: "MIDNIGHT_DEMO_NULLIFIER_V1",
  proof: "MIDNIGHT_DEMO_PROOF_V1",
  leaf: "MIDNIGHT_DEMO_MERKLE_LEAF_V1",
  node: "MIDNIGHT_DEMO_MERKLE_NODE_V1",
  empty: "MIDNIGHT_DEMO_EMPTY_TREE_V1",
  transaction: "MIDNIGHT_DEMO_TRANSACTION_V1",
});

function hash(...parts) {
  const digest = createHash("sha256");
  for (const part of parts) {
    digest.update(String(part));
    digest.update("\0");
  }
  return digest.digest("hex");
}

export function credentialCommitment(electionId, credentialSecret) {
  return hash(DOMAIN.credential, electionId, credentialSecret);
}

export function voteNullifier(electionId, credentialSecret) {
  return hash(DOMAIN.nullifier, electionId, "vote", credentialSecret);
}

export function simulatedProofDigest({ electionId, choice, commitment, nullifier, credentialSecret }) {
  return hash(DOMAIN.proof, electionId, choice, commitment, nullifier, credentialSecret);
}

export function merkleRoot(commitments) {
  if (!commitments.length) return hash(DOMAIN.empty);
  let level = commitments.map((commitment) => hash(DOMAIN.leaf, commitment));
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(hash(DOMAIN.node, left, right));
    }
    level = next;
  }
  return level[0];
}

export function createDemoState() {
  return {
    startedAt: new Date().toISOString(),
    sequence: 0,
    authority: {
      passports: new Map(PASSPORT_FIXTURES.map((record) => [record.passport, { ...record }])),
      issued: new Map(),
      events: [],
    },
    election: {
      id: ELECTION_ID,
      open: true,
      commitments: [],
      usedNullifiers: new Set(),
      tally: { YES: 0, NO: 0 },
      transactions: [],
    },
  };
}

function authorityEvent(state, passport, result, detail) {
  state.authority.events.unshift({
    id: `AUTH-${String(++state.sequence).padStart(4, "0")}`,
    at: new Date().toISOString(),
    passport,
    result,
    detail,
  });
  state.authority.events = state.authority.events.slice(0, 30);
}

export function issueCredential(state, { electionId, demoPassport, commitment }) {
  const passport = String(demoPassport ?? "").trim().toUpperCase();
  if (electionId !== state.election.id) {
    authorityEvent(state, passport || "UNKNOWN", "ELECTION_NOT_FOUND", "Unknown election");
    return { status: 404, body: { code: "ELECTION_NOT_FOUND" } };
  }
  if (!state.election.open) {
    authorityEvent(state, passport || "UNKNOWN", "ELECTION_CLOSED", "Issuance is closed");
    return { status: 409, body: { code: "ELECTION_CLOSED" } };
  }

  const record = state.authority.passports.get(passport);
  if (!record) {
    authorityEvent(state, passport || "UNKNOWN", "NOT_ELIGIBLE", "Document not in demo registry");
    return { status: 403, body: { code: "NOT_ELIGIBLE" } };
  }
  if (record.status === "REVOKED") {
    authorityEvent(state, passport, "REVOKED", "Document status check failed");
    return { status: 403, body: { code: "REVOKED" } };
  }
  if (!record.eligible) {
    authorityEvent(state, passport, "NOT_ELIGIBLE", "Election policy check failed");
    return { status: 403, body: { code: "NOT_ELIGIBLE" } };
  }

  const issuanceKey = `${electionId}:${passport}`;
  if (state.authority.issued.has(issuanceKey)) {
    authorityEvent(state, passport, "ALREADY_ISSUED", "One credential per document per election");
    return { status: 409, body: { code: "ALREADY_ISSUED" } };
  }
  if (!/^[a-f0-9]{64}$/i.test(String(commitment ?? ""))) {
    authorityEvent(state, passport, "INVALID_COMMITMENT", "Malformed anonymous commitment");
    return { status: 400, body: { code: "INVALID_COMMITMENT" } };
  }
  if (state.election.commitments.includes(commitment)) {
    authorityEvent(state, passport, "INVALID_COMMITMENT", "Commitment collision or replay");
    return { status: 409, body: { code: "INVALID_COMMITMENT" } };
  }

  state.authority.issued.set(issuanceKey, {
    passport,
    electionId,
    issuedAt: new Date().toISOString(),
  });
  state.election.commitments.push(commitment);
  const root = merkleRoot(state.election.commitments);
  authorityEvent(state, passport, "ISSUED", "Anonymous commitment added to eligibility set");

  return {
    status: 201,
    body: {
      code: "ISSUED",
      electionId,
      eligibilityRoot: root,
      eligibleCredentialCount: state.election.commitments.length,
    },
  };
}

export function castVote(state, input) {
  const { electionId, choice, credentialSecret, proofDigest, proofMode = "SIMULATED_ZK" } = input ?? {};
  if (electionId !== state.election.id) {
    return { status: 404, body: { code: "ELECTION_NOT_FOUND" } };
  }
  if (!state.election.open) {
    return { status: 409, body: { code: "ELECTION_CLOSED" } };
  }
  if (!Object.hasOwn(state.election.tally, choice)) {
    return { status: 400, body: { code: "INVALID_CHOICE" } };
  }
  if (!/^[a-f0-9]{64}$/i.test(String(credentialSecret ?? ""))) {
    return { status: 400, body: { code: "INVALID_PROOF" } };
  }

  // This verifier models the assertions a Compact circuit must prove. The secret is
  // accepted as a private witness only by this educational simulator and is never
  // written to public state. A production client must replace this function with a
  // locally generated Midnight proof; see compact/Voting.compact.pseudo.
  const commitment = credentialCommitment(electionId, credentialSecret);
  const nullifier = voteNullifier(electionId, credentialSecret);
  const expectedProof = simulatedProofDigest({
    electionId,
    choice,
    commitment,
    nullifier,
    credentialSecret,
  });
  const proofIsValid = proofMode === "SIMULATED_ZK"
    && state.election.commitments.includes(commitment)
    && proofDigest === expectedProof;

  if (!proofIsValid) {
    return { status: 422, body: { code: "INVALID_PROOF" } };
  }
  if (state.election.usedNullifiers.has(nullifier)) {
    return {
      status: 409,
      body: { code: "CREDENTIAL_ALREADY_USED", nullifier },
    };
  }

  state.election.usedNullifiers.add(nullifier);
  state.election.tally[choice] += 1;
  const transactionHash = hash(
    DOMAIN.transaction,
    state.election.id,
    nullifier,
    state.sequence++,
    Date.now(),
  );
  state.election.transactions.unshift({
    transactionHash,
    nullifier,
    proofFingerprint: hash("proof-fingerprint", proofDigest).slice(0, 24),
    at: new Date().toISOString(),
    result: "ACCEPTED",
  });

  return {
    status: 201,
    body: { code: "ACCEPTED", transactionHash, nullifier },
  };
}

export function closeElection(state) {
  state.election.open = false;
  return publicElectionState(state);
}

export function publicElectionState(state) {
  return {
    electionId: state.election.id,
    status: state.election.open ? "OPEN" : "CLOSED",
    eligibilityRoot: merkleRoot(state.election.commitments),
    eligibleCredentialCount: state.election.commitments.length,
    usedNullifiers: [...state.election.usedNullifiers],
    tally: { ...state.election.tally },
    votesCast: state.election.usedNullifiers.size,
    transactions: state.election.transactions.map((transaction) => ({ ...transaction })),
  };
}

export function authorityState(state) {
  return {
    passports: [...state.authority.passports.values()].map((record) => ({
      ...record,
      issued: state.authority.issued.has(`${state.election.id}:${record.passport}`),
    })),
    events: state.authority.events.map((event) => ({ ...event })),
  };
}
