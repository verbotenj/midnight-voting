import { test, expect } from "@playwright/test";
import { credentialCommitment, voteNullifier, simulatedProofDigest, ELECTION_ID } from "../lib/domain.js";
const base = `/api/elections/${ELECTION_ID}`;

test("public API blocks private routes, invalid inputs, and concurrent replays", async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  try {
    const init = await api.get("/api/state");
    expect(init.status()).toBe(200);
    const cookie = init.headers()["set-cookie"];
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Strict");
    if (baseURL.startsWith("https:")) { expect(cookie).toContain("Secure"); expect(cookie).toContain("__Host-demo_session="); }
    for (const path of ["/.env.development", "/.local/authority-private.json", "/cloudflare/worker.js", "/lib/domain.js", "/server.js"]) expect((await api.get(path)).status()).toBe(404);
    for (const path of ["/api/preview/ballot", "/api/midnight/wallet"]) expect((await api.post(path, { data: {} })).status()).toBe(403);
    expect((await api.post("/api/demo/reset", { data: {}, headers: { Origin: "https://example.invalid" } })).status()).toBe(403);
    expect((await api.post("/api/demo/reset", { data: { passport: "fictional-extra-field" } })).status()).toBe(400);
    expect((await api.post("/api/demo/reset", { data: { blob: "x".repeat(9000) } })).status()).toBe(413);
    expect((await api.post(`${base}/credential`, { data: { demoPassport: "UNKNOWN-FICTIONAL", commitment: "a".repeat(64) } })).status()).toBe(403);
    const secret = "8".repeat(64), commitment = credentialCommitment(ELECTION_ID, secret);
    const issuance = await Promise.all([0, 1].map(() => api.post(`${base}/credential`, { data: { demoPassport: "DEMO-P001", commitment } })));
    expect((await Promise.all(issuance.map(r => r.json()))).map(r => r.code).sort()).toEqual(["ALREADY_ISSUED", "ISSUED"]);
    const data = { choice: "YES", credentialSecret: secret, proofDigest: simulatedProofDigest({ electionId: ELECTION_ID, choice: "YES", credentialSecret: secret, commitment, nullifier: voteNullifier(ELECTION_ID, secret) }) };
    expect((await api.post(`${base}/vote`, { data: { ...data, proofDigest: "fake" } })).status()).toBe(422);
    const votes = await Promise.all([0, 1].map(() => api.post(`${base}/vote`, { data })));
    expect((await Promise.all(votes.map(r => r.json()))).map(r => r.code).sort()).toEqual(["ACCEPTED", "CREDENTIAL_ALREADY_USED"]);
    expect((await api.post(`${base}/credential`, { data: { demoPassport: "DEMO-P003", commitment: "b".repeat(64) } })).status()).toBe(403);
    const final = await (await api.get("/api/state")).json();
    expect(final.public.votesCast).toBe(1);
    expect(JSON.stringify(final.public)).not.toContain("DEMO-P001");
    expect(JSON.stringify(final)).not.toContain(secret);
    expect(JSON.stringify(final.authority.events)).not.toContain("UNKNOWN-FICTIONAL");
    await api.post("/api/demo/reset", { data: {} });
  } finally { await api.dispose(); }
});
