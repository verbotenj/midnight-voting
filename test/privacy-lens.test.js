import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRIVACY_VIEWS } from "../public/privacy-lens.js";

test("privacy lens keeps identities out of its public example and discloses public choices", () => {
  assert.deepEqual(Object.keys(PRIVACY_VIEWS), ["voter", "authority", "public"]);
  assert.doesNotMatch(JSON.stringify(PRIVACY_VIEWS.public.fields), /DEMO-P001|private witness/);
  assert.ok(PRIVACY_VIEWS.public.fields.some(([name, value]) => name === "Ballot choice" && value === "YES · public"));
  assert.ok(PRIVACY_VIEWS.authority.fields.some(([name]) => name === "Document"));
  assert.ok(!PRIVACY_VIEWS.authority.fields.some(([name]) => name === "Ballot choice"));
  // Catch explanation drift if the contract's disclosure/witness design changes.
  const compact = readFileSync(new URL("../compact/Voting.compact", import.meta.url), "utf8");
  assert.match(compact, /disclose\(yes\)/);
  assert.match(compact, /witness credentialSecret\(\)/);
  assert.match(compact, /witness membershipPath\(\)/);
});
