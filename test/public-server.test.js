import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createPublicServer } from "../public-server.js";
import { ELECTION_ID, credentialCommitment } from "../lib/domain.js";

const origin = "https://demo.example";
const election = `/api/elections/${ELECTION_ID}`;
async function setup(t, options = {}) {
  const server = createPublicServer({ origin, ...options });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, cookie = "") => fetch(base + path, { headers: { cookie } });
  const post = (path, body, cookie = "", extra = {}) => fetch(base + path, { method: "POST", headers: { origin, "content-type": "application/json", cookie, ...extra }, body: JSON.stringify(body) });
  const session = async () => {
    const response = await get("/api/state");
    return { cookie: response.headers.get("set-cookie")?.split(";")[0], data: await response.json(), response };
  };
  return { base, get, post, session };
}

test("public hosting isolates visitors and one browser cannot reset another", async t => {
  const { session, get, post } = await setup(t);
  const a = await session(), b = await session();
  assert.notEqual(a.cookie, b.cookie);
  assert.match(a.response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict; Path=\/; Max-Age=3600; Secure/);
  const input = { demoPassport: "DEMO-P001", commitment: credentialCommitment(ELECTION_ID, "a".repeat(64)) };
  assert.equal((await post(`${election}/credential`, input, a.cookie)).status, 201);
  assert.equal((await post(`${election}/credential`, input, a.cookie)).status, 409);
  assert.equal((await post(`${election}/credential`, input, b.cookie)).status, 201);
  await post("/api/demo/reset", {}, b.cookie);
  assert.equal((await (await get("/api/state", a.cookie)).json()).public.eligibleCredentialCount, 1);
  assert.equal((await (await get("/api/state", b.cookie)).json()).public.eligibleCredentialCount, 0);
});

test("public hosting blocks live APIs, private files, unexpected bodies and cross-origin writes", async t => {
  const { get, post, session } = await setup(t);
  const { cookie } = await session();
  for (const path of ["/api/preview/actions", "/api/preview/inspection", "/api/midnight/network"]) assert.equal((await get(path)).status, 403);
  for (const path of ["/.env.development", "/.local/preview-voting/authority.json", "/server.js", "/lib/preview-wallet.js", "/node_modules/package.json"]) assert.equal((await get(path)).status, 404);
  assert.match(await (await get("/runtime.js")).text(), /HOSTED_DEMO = true/);
  for (const path of ["/", "/learn", "/privacy", "/privacy-lens.js", "/developer", "/preview", "/health"]) assert.equal((await get(path)).status, 200);
  assert.equal((await post("/api/demo/reset", {}, cookie, { origin: "https://attacker.example" })).status, 403);
  assert.equal((await post("/api/demo/reset", {}, cookie, { origin: "" })).status, 403);
  assert.equal((await post("/api/demo/reset", { seed: "not-allowed" }, cookie)).status, 400);
  assert.equal((await post("/api/demo/reset", { excess: "x".repeat(9000) }, cookie)).status, 413);
  assert.equal((await post(`${election}/credential`, { demoPassport: "REAL-DOCUMENT-NOT-ALLOWED", commitment: "a".repeat(64) }, cookie)).status, 403);
  assert.doesNotMatch(JSON.stringify(await (await get("/api/state", cookie)).json()), /REAL-DOCUMENT/);
});

test("expired hosted sessions cannot silently mutate a fresh election", async t => {
  let time = 1;
  const { session, get, post } = await setup(t, { now: () => time, maxSessions: 1 });
  const first = await session();
  assert.equal((await get("/api/state")).status, 503);
  time += 3600_001;
  assert.equal((await post("/api/demo/reset", {}, first.cookie)).status, 409);
  const response = await get("/api/state", first.cookie);
  assert.equal(response.status, 200);
  assert.notEqual((await response.json()).sessionVersion, first.data.sessionVersion);
});

test("public simulation has bounded per-session request rates", async t => {
  const { session, get } = await setup(t);
  const { cookie } = await session();
  for (let i = 1; i < 120; i++) assert.equal((await get("/api/state", cookie)).status, 200);
  assert.equal((await get("/api/state", cookie)).status, 429);
});
