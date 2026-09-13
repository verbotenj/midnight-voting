import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// Progress is projected onto a tiny schema; SDK objects, raw stderr and secrets
// must never become browser event payloads.
export function publicProgress(message) {
  const stages = new Set(["wallet-restored", "wallet-sync-progress", "wallet-synced", "wallet-stream-error", "build-real-call", "prove-start", "prove-finished", "balance-with-dust", "transaction-balanced", "call-broadcast", "call-finalized-and-state-verified", "submit-deliberately-modified-proof", "modified-proof-rejected-by-preview"]);
  if (!stages.has(message.stage)) return null;
  const result = { stage: message.stage, at: new Date().toISOString() };
  if (["authority", "voter"].includes(message.role)) result.role = message.role;
  if (["enroll", "openVoting", "vote", "closeElection"].includes(message.circuitId)) result.circuitId = message.circuitId;
  for (const field of ["nightRaw", "dustSpecks", "estimatedFeeSpecks"]) {
    if (typeof message[field] === "string" && /^\d{1,40}$/.test(message[field])) result[field] = message[field];
  }
  if (message.stage === "wallet-sync-progress") {
    result.progress = Object.fromEntries(["shielded", "unshielded", "dust"].map(kind => {
      const p = message.progress?.[kind];
      return [kind, p && /^\d{1,20}$/.test(p.applied) ? { applied: p.applied } : null];
    }));
  }
  return result;
}

export function createPreviewActor(role, onProgress = () => {}) {
  if (!["authority", "voter"].includes(role)) throw new Error("INVALID_ACTOR_ROLE");
  const child = fork(fileURLToPath(new URL("../scripts/preview-worker.js", import.meta.url)), [role], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const pending = new Map();
  let readyResolve, readyReject, exitResolve, started = false, dead = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  ready.catch(() => {}); // A caller may await both workers after constructing them.
  const exited = new Promise(resolve => { exitResolve = resolve; });
  const rejectPending = error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); };
  child.on("message", message => {
    if (message.event === "progress") { const safe = publicProgress(message); if (safe) onProgress(safe); }
    else if (message.event === "ready") { started = true; readyResolve(); }
    else if (message.event === "fatal") { const error = new Error(`${role}: ${message.error}`); readyReject(error); rejectPending(error); }
    else if (pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
      if (message.error) reject(new Error(`${role}: ${message.error}`)); else resolve(message.result);
    }
  });
  child.on("error", error => { readyReject(error); rejectPending(error); });
  child.on("exit", code => { dead = true; const error = new Error(`${role} worker exited (${code}); reconcile any broadcast`); readyReject(error); rejectPending(error); exitResolve(); });
  return { ready,
    async request(method, params = {}) {
      await ready;
      if (dead || !child.connected) throw new Error("ACTOR_DISCONNECTED_RECONCILE_BROADCAST");
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.send({ id, method, params }, error => { if (error) { pending.delete(id); reject(error); } });
      });
    },
    async stop() {
      await ready.catch(() => {});
      if (started && !dead && child.connected) child.send({ method: "shutdown" });
      await exited;
    },
  };
}
