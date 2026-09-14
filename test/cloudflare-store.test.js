import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DemoStore, SESSION_TTL, API_BASE } from "../cloudflare/demo-store.js";
import { credentialCommitment, voteNullifier, simulatedProofDigest, ELECTION_ID } from "../lib/domain.js";

function fixture(t, options) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const sql = { exec(query, ...args) { return db.prepare(query).all(...args); } };
  return { sql, store: new DemoStore(sql, options) };
}
const state = (store, id, now = 1000) => store.handle({ id, method: "GET", path: "/api/state" }, now);
const post = (store, id, path, input = {}, now = 1000) => store.handle({ id, method: "POST", path, input }, now);
function vote(secret, choice = "YES") {
  return { choice, credentialSecret: secret, proofDigest: simulatedProofDigest({ electionId: ELECTION_ID, choice, credentialSecret: secret, commitment: credentialCommitment(ELECTION_ID, secret), nullifier: voteNullifier(ELECTION_ID, secret) }) };
}

test("Cloudflare storage survives object reconstruction, prevents replay, and isolates sessions", t => {
  const { store, sql } = fixture(t);
  const a = state(store), b = state(store);
  const secret = "7".repeat(64);
  const credential = { demoPassport: "DEMO-P001", commitment: credentialCommitment(ELECTION_ID, secret) };
  assert.equal(post(store, a.id, `${API_BASE}/credential`, credential).body.code, "ISSUED");
  const restarted = new DemoStore(sql);
  assert.equal(state(restarted, a.id).body.sessionVersion, a.body.sessionVersion);
  assert.equal(post(restarted, a.id, `${API_BASE}/credential`, credential).body.code, "ALREADY_ISSUED");
  assert.equal(post(restarted, a.id, `${API_BASE}/vote`, vote(secret)).body.code, "ACCEPTED");
  assert.equal(post(new DemoStore(sql), a.id, `${API_BASE}/vote`, vote(secret)).body.code, "CREDENTIAL_ALREADY_USED");
  assert.equal(state(restarted, b.id).body.public.votesCast, 0);
  post(restarted, b.id, "/api/demo/reset");
  assert.equal(state(restarted, a.id).body.public.votesCast, 1);
  assert.equal(JSON.stringify([...sql.exec("SELECT data FROM sessions")]).includes(secret), false);
});

test("Cloudflare state expires, capacity is bounded, and stale mutations do not recreate elections", t => {
  const { store, sql } = fixture(t, { maxSessions: 1 });
  const a = state(store);
  assert.equal(state(store).body.code, "DEMO_CAPACITY_REACHED");
  assert.equal(post(store, "forged", "/api/demo/reset").body.code, "DEMO_SESSION_EXPIRED");
  assert.equal(post(store, a.id, "/api/demo/reset", {}, 1000 + SESSION_TTL).body.code, "DEMO_SESSION_EXPIRED");
  assert.equal([...sql.exec("SELECT COUNT(*) AS n FROM sessions")][0].n, 0);
  const next = state(store, a.id, 1001 + SESSION_TTL);
  assert.notEqual(next.id, a.id);
  assert.notEqual(next.body.sessionVersion, a.body.sessionVersion);
});

test("Cloudflare rate limits persist across new object instances", t => {
  const { store, sql } = fixture(t);
  const a = state(store);
  for (let i = 1; i < 120; i++) assert.equal(state(new DemoStore(sql), a.id).status, 200);
  assert.equal(state(new DemoStore(sql), a.id).body.code, "DEMO_RATE_LIMIT");
  assert.equal(state(store, a.id, 61_000).status, 200);
});

test("Cloudflare global rate window counts requests at the same millisecond", t => {
  const { store } = fixture(t);
  for (let i = 0; i < 2400; i++) post(store, undefined, "/api/demo/reset");
  assert.equal(state(store).body.code, "DEMO_BUSY");
  assert.equal(state(store, undefined, 61_000).status, 200);
});
