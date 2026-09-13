import { pureCircuits } from "../compact/managed/voting/contract/index.js";

const bytes32 = (value, name) => {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new Error(`Missing private ${name}`);
  return value;
};

// These functions run only on the trusted local proving side. They are not an API
// for an authority to retrieve a voter secret. Circuit assertions validate them.
export const votingWitnesses = {
  authoritySecret: ({ privateState }) => [privateState, bytes32(privateState.authoritySecret, "authority secret")],
  credentialSecret: ({ privateState }) => [privateState, bytes32(privateState.credentialSecret, "credential secret")],
  membershipPath: ({ ledger, privateState }) => {
    const commitment = pureCircuits.commitment(ledger.electionId, ledger.instance, bytes32(privateState.credentialSecret, "credential secret"));
    const path = privateState.membershipPath ?? ledger.eligible.findPathForLeaf(commitment);
    if (!path) throw new Error("CREDENTIAL_NOT_ENROLLED");
    return [privateState, path];
  },
};
