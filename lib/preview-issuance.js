import { createHash } from "node:crypto";
const documents = new Map([["DEMO-P001", "VALID"], ["DEMO-P002", "VALID"], ["DEMO-P003", "REVOKED"]]);

// Recovery does not replace a secret or reserve another entitlement. The caller
// must hold the normal operation/authority lock and query current membership.
export function planIssuanceRecovery({ sameCommitment, contractMatches, enrolled, phase, broadcastExists, confirmedExists }) {
  if (contractMatches !== true) return { code: "ALREADY_ISSUED_FOR_ELECTION", sameCommitment: false };
  if ([enrolled, broadcastExists, confirmedExists].some(value => typeof value !== "boolean")) return { code: "ISSUANCE_STATE_UNKNOWN" };
  if (enrolled === true) return { code: "ALREADY_ISSUED", sameCommitment: sameCommitment === true };
  if (confirmedExists) return { code: "ISSUANCE_STATE_MISMATCH" };
  if (broadcastExists) return { code: "BROADCAST_OUTCOME_REQUIRES_RECONCILIATION" };
  if (sameCommitment !== true) return { code: "ISSUANCE_PENDING", sameCommitment: false };
  if (phase !== 0) return { code: "ENROLLMENT_CLOSED" };
  return { code: "RESUME_UNBROADCAST_ISSUANCE", sameCommitment: true };
}

// Durable issuer-side uniqueness. No credential secrets or ballot choices here.
export async function reserveIssuance(store, scope, demoPassport, commitment) {
  if (documents.get(demoPassport) === "REVOKED") return { code: "REVOKED" };
  if (documents.get(demoPassport) !== "VALID") return { code: "NOT_ELIGIBLE" };
  if (!/^[0-9a-f]{64}$/.test(commitment)) return { code: "INVALID_COMMITMENT" };
  if (!/^[0-9a-f]{64}$/.test(scope.contractAddress) || typeof scope.electionId !== "string") throw new Error("INVALID_ELECTION_SCOPE");
  // Election identity, NOT deployment address, is the uniqueness boundary.
  // Retain compatibility with the initial contract-scoped reservations without
  // allowing a replacement contract to mint a second entitlement.
  for (const previousName of await store.issuanceFiles(demoPassport)) {
    const previous = await store.read(previousName);
    if (previous.electionId === scope.electionId && previous.demoPassport === demoPassport) {
      return { code: "ALREADY_ISSUED_OR_RESERVED", reservation: previousName, sameCommitment: previous.commitment === commitment,
        contractMatches: previous.contractAddress === scope.contractAddress };
    }
  }
  const electionKey = createHash("sha256").update(scope.electionId).digest("hex");
  const name = `issuance-${electionKey}-${demoPassport}.json`;
  try {
    await store.create(name, { ...scope, demoPassport, commitment, createdAt: new Date().toISOString(), status: "RESERVED" });
    return { code: "RESERVED", reservation: name };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = await store.read(name);
    if (previous.electionId !== scope.electionId) throw new Error("ISSUANCE_SCOPE_MISMATCH");
    return { code: "ALREADY_ISSUED_OR_RESERVED", reservation: name, sameCommitment: previous.commitment === commitment,
      contractMatches: previous.contractAddress === scope.contractAddress };
  }
}
