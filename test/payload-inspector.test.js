import test from "node:test";
import assert from "node:assert/strict";
import { displayRequest } from "../public/payload-inspector.js";

test("payload inspector redacts the simulator witness without changing the sent body", () => {
  const body = { choice: "YES", credentialSecret: "a".repeat(64), proofDigest: "b".repeat(64), proofMode: "SIMULATED_ZK" };
  const displayed = displayRequest(body);
  assert.match(displayed.credentialSecret, /redacted.*SENT/);
  assert.equal(JSON.stringify(displayed).includes(body.credentialSecret), false);
  assert.equal(body.credentialSecret, "a".repeat(64));
  assert.equal(displayed.proofDigest, body.proofDigest);
});

test("authority request display preserves the exact field names and values", () => {
  const body = { demoPassport: "DEMO-P001", commitment: "c".repeat(64) };
  assert.deepEqual(displayRequest(body), body);
  assert.deepEqual(Object.keys(displayRequest(body)), ["demoPassport", "commitment"]);
});
