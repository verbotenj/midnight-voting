import test from "node:test";
import assert from "node:assert/strict";
import { derivePublicAddresses, validatePublicAddresses } from "../scripts/dev-wallets.js";

// Public deterministic test inputs only; never load the real .env.development here.
test("SDK wallet derivation restores all addresses and separates wallet roles", () => {
  const voter = derivePublicAddresses(new Uint8Array(32).fill(1), "preprod");
  const authority = derivePublicAddresses(new Uint8Array(32).fill(2), "preprod");
  assert.deepEqual(voter, derivePublicAddresses(new Uint8Array(32).fill(1), "preprod"));
  assert.deepEqual(Object.keys(voter).sort(), ["dust", "shielded", "unshielded"]);
  for (const kind of Object.keys(voter)) assert.notEqual(voter[kind], authority[kind]);
  validatePublicAddresses(voter, "preprod");
  validatePublicAddresses(authority, "preprod");
  assert.ok(voter.shielded.length > 90, "shielded addresses need extended Bech32m length support");
});

test("wallet tools reject mainnet, bad seeds, wrong networks and corrupted checksums", () => {
  assert.throws(() => derivePublicAddresses(new Uint8Array(32), "mainnet"), /TEST_NETWORK/);
  assert.throws(() => derivePublicAddresses(new Uint8Array(16), "preprod"), /INVALID/);
  const addresses = derivePublicAddresses(new Uint8Array(32).fill(1), "preview");
  validatePublicAddresses(addresses, "preview");
  assert.throws(() => validatePublicAddresses(addresses, "preprod"), /MISMATCH/);
  const last = addresses.unshielded.slice(-1);
  assert.throws(() => validatePublicAddresses({ ...addresses, unshielded: addresses.unshielded.slice(0, -1) + (last === "q" ? "p" : "q") }, "preview"));
});
