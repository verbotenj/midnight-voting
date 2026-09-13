import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { createPreviewService, availableActions, safeActionFailure } from "../lib/preview-service.js";
import { publicProgress } from "../lib/preview-actors.js";
import { assertPreviewRequest } from "../lib/preview-http-guard.js";

const address = "a".repeat(64);
const initial = () => ({ network: "preview", contractAddress: address, state: { phase: "ENROLLMENT", eligibleCount: "0", usedNullifiers: "0", tally: { YES: "0", NO: "0" } }, receipts: [], recovery: [] });
const input = (action = "enroll-a") => ({ action, contractAddress: address, requestId: randomUUID(), consent: true });
const finish = async service => { for (let i = 0; i < 30 && ["queued", "running"].includes(service.job().job?.state); i++) await setImmediate(); return service.job().job; };

test("live service requires explicit consent, fixed inputs and server opt-in", () => {
  assert.throws(() => createPreviewService({}).start(input()), /LIVE_ACTIONS_DISABLED/);
  const service = createPreviewService({ enabled: true });
  assert.throws(() => service.start({ ...input(), credentialSecret: "must-not-cross-http" }), /INVALID_ACTION_BODY/);
  assert.throws(() => service.start({ ...input(), consent: false }), /INVALID_ACTION_BODY/);
  assert.throws(() => service.start(input("arbitrary-command")), /INVALID_ACTION_BODY/);
});
test("closed state, unresolved journals and changed contracts prevent actors from starting", async () => {
  for (const mode of ["closed", "recovery", "changed"]) {
    let starts = 0;
    const state = initial();
    if (mode === "closed") state.state.phase = "CLOSED";
    if (mode === "recovery") state.recovery = ["enroll-a"];
    if (mode === "changed") state.contractAddress = "b".repeat(64);
    const service = createPreviewService({ enabled: true, inspect: async () => state, openActors: async () => { starts++; } });
    service.start(input());
    assert.equal((await finish(service)).state, "failed"); assert.equal(starts, 0);
    await service.stop();
  }
});
test("one human step uses actor commitments, emits no secret and never autoplays", async () => {
  let state = initial(), calls = [], starts = 0;
  const service = createPreviewService({ enabled: true, inspect: async () => structuredClone(state), openActors: async () => {
    starts++;
    return {
      voter: { request: async (method, params) => { calls.push([method, params]); return { commitment: "c".repeat(64) }; } },
      authority: { request: async (method, params) => { calls.push([method, params]); state.state.eligibleCount = "1"; return { code: "ISSUED", receipt: { secretCanary: "must-not-leak" } }; } }, stop: async () => {},
    };
  } });
  const action = input(); service.start(action);
  assert.equal(service.start(action).id, action.requestId);
  assert.throws(() => service.start(input()), /OPERATION_IN_PROGRESS/);
  const result = await finish(service);
  assert.equal(result.state, "succeeded"); assert.equal(starts, 1);
  assert.deepEqual(calls, [["prepare", { slot: "a" }], ["enroll", { demoPassport: "DEMO-P001", commitment: "c".repeat(64) }]]);
  assert.ok(!JSON.stringify(result).includes("must-not-leak"));
  assert.equal(service.start(action).state, "succeeded"); assert.equal(calls.length, 2);
  assert.throws(() => service.start({ ...action, action: "enroll-b" }), /REQUEST_ID_REUSED/);
  await service.stop();
});
test("unknown actor outcomes stay failed, do not retry and preserve idempotency", async () => {
  let calls = 0;
  const service = createPreviewService({ enabled: true, inspect: async () => initial(), openActors: async () => ({
    voter: { request: async () => { calls++; throw new Error("timeout with private SDK details"); } }, authority: {}, stop: async () => {},
  }) });
  const action = input(); service.start(action);
  const result = await finish(service);
  assert.equal(result.error, "ACTION_STOPPED_RECONCILE_BEFORE_RETRY");
  service.start(action); assert.equal(calls, 1);
  await service.stop();
});
test("negative test cannot report success when contract state changes", async () => {
  const state = initial();
  const service = createPreviewService({ enabled: true, inspect: async () => structuredClone(state), openActors: async () => ({
    voter: { request: async () => ({ commitment: "c".repeat(64) }) },
    authority: { request: async () => { state.state.eligibleCount = "1"; return { code: "REVOKED" }; } }, stop: async () => {},
  }) });
  service.start(input("revoked-check"));
  assert.equal((await finish(service)).error, "NEGATIVE_TEST_CHANGED_STATE");
  await service.stop();
});
test("live progress strips arbitrary fields, raw objects and secrets", () => {
  const progress = publicProgress({ stage: "transaction-balanced", role: "voter", estimatedFeeSpecks: "700", secret: "canary", tx: { private: true } });
  assert.deepEqual(Object.keys(progress).sort(), ["at", "estimatedFeeSpecks", "role", "stage"]);
  assert.equal(publicProgress({ stage: "dump-secret", secret: "canary" }), null);
  const state = initial(); state.state.phase = "CLOSED";
  assert.deepEqual(availableActions(state), []);
  assert.equal(safeActionFailure(new Error("authority: LOCAL_PROVER_UNAVAILABLE with unrelated private details")), "LOCAL_PROVER_UNAVAILABLE");
  assert.equal(safeActionFailure(new Error("unknown private SDK object")), "ACTION_STOPPED_RECONCILE_BEFORE_RETRY");
});
test("known rejected proof is not offered for resubmission and unresolved proof blocks all actions", () => {
  const state = initial(); state.state.phase = "VOTING"; state.state.eligibleCount = "2";
  assert.ok(availableActions(state).some(action => action.id === "modified-proof-check"));
  state.negativeProofEvidence = { status: "RECORDED_NODE_REJECTION" };
  assert.equal(availableActions(state).some(action => action.id === "modified-proof-check"), false);
  assert.ok(availableActions(state).some(action => action.id === "vote-a"));
  state.recovery = ["modified-proof-check"];
  assert.deepEqual(availableActions(state), []);
});
test("Preview HTTP guard rejects DNS rebinding, nonlocal peers and cross-origin writes", () => {
  const req = { socket: { localPort: 4173, remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173", "content-type": "application/json", "x-midnight-preview-action": "explicit" } };
  assert.doesNotThrow(() => assertPreviewRequest(req, true));
  for (const headers of [{ host: "attacker.example:4173" }, { origin: "https://attacker.example" }, { origin: undefined }, { "content-type": "text/plain" }, { "x-midnight-preview-action": undefined }, { "sec-fetch-site": "cross-site" }]) {
    assert.throws(() => assertPreviewRequest({ ...req, headers: { ...req.headers, ...headers } }, true));
  }
  assert.throws(() => assertPreviewRequest({ ...req, socket: { ...req.socket, remoteAddress: "192.168.1.20" } }, false));
});
