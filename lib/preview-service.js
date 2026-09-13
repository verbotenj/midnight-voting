// Orchestration only: no wallet seeds or proof witnesses enter this module.
export const LIVE_ACTIONS = [
  { id: "enroll-a", label: "Verify P001 and enroll its commitment", phase: "ENROLLMENT", count: "0" },
  { id: "copy-check", label: "Try a copied app for P001", phase: "ENROLLMENT", count: "1" },
  { id: "enroll-b", label: "Verify P002 and enroll its commitment", phase: "ENROLLMENT", count: "1" },
  { id: "revoked-check", label: "Verify P003 · expect REVOKED", phase: "ENROLLMENT" },
  { id: "open", label: "Freeze eligibility and open voting", phase: "ENROLLMENT", count: "2" },
  { id: "modified-proof-check", label: "Submit a modified proof · expect node rejection", phase: "VOTING", votes: "0" },
  { id: "vote-a", label: "Prove and submit the first ballot · YES", phase: "VOTING", votes: "0" },
  { id: "replay-check", label: "Try using the first credential again", phase: "VOTING", votes: "1" },
  { id: "vote-b", label: "Prove and submit the second ballot · NO", phase: "VOTING", votes: "1" },
  { id: "close", label: "Close the election at YES 1 / NO 1", phase: "VOTING", votes: "2" },
];

const failure = (code, status = 409) => Object.assign(new Error(code), { code, status });
export function safeActionFailure(error) {
  if (/^[A-Z_]{3,100}$/.test(error.code || "") && error.code !== "EEXIST") return error.code;
  if (error.code === "EEXIST") return "OPERATION_LOCK_REQUIRES_INSPECTION";
  const known = ["NO_GENERATED_DUST", "LOCAL_PROVER_UNAVAILABLE", "WALLET_SYNC_TIMEOUT", "PREVIEW_NETWORK_CHECK_FAILED", "BROADCAST_OUTCOME_REQUIRES_RECONCILIATION", "NEGATIVE_TEST_OUTCOME_REQUIRES_RECONCILIATION", "SUBMISSION_OUTCOME_UNKNOWN_NO_AUTOMATIC_RETRY", "TRANSACTION_FEE_EXCEEDS_100_TEST_DUST_GUARD", "SOURCE_OR_COMPILER_CHANGED_RECOMPILE", "GENERATED_ARTIFACTS_CHANGED_RECOMPILE"];
  return known.find(code => String(error.message).includes(code)) || "ACTION_STOPPED_RECONCILE_BEFORE_RETRY";
}
export function availableActions(snapshot) {
  if (snapshot.recovery.length) return [];
  return LIVE_ACTIONS.filter(action => snapshot.state.phase === action.phase
    && (action.count === undefined || snapshot.state.eligibleCount === action.count)
    && (action.votes === undefined || snapshot.state.usedNullifiers === action.votes)
    && !snapshot.receipts.some(receipt => receipt.id === action.id)
    && !(action.id === "modified-proof-check" && snapshot.negativeProofEvidence?.status === "RECORDED_NODE_REJECTION"));
}

export function createPreviewService({ inspect, openActors, enabled = false, idleMs = 30 * 60000 }) {
  const jobs = new Map();
  let active, last, session, idleTimer, stopping = false;
  const snapshot = job => job ? structuredClone(job) : null;
  const push = event => {
    if (!active) return;
    active.progress.push(event);
    if (active.progress.length > 80) active.progress.shift();
  };
  const stop = async () => {
    if (active) throw failure("OPERATION_IN_PROGRESS_WAIT_FOR_OUTCOME");
    if (stopping) throw failure("WORKERS_STOPPING");
    clearTimeout(idleTimer);
    stopping = true;
    try { if (session) await session.stop(); session = undefined; }
    finally { stopping = false; }
  };
  const run = async job => {
    job.state = "running";
    try {
      push({ stage: "preflight", at: new Date().toISOString() });
      const before = await inspect(); // Recheck network/state immediately before action.
      if (before.contractAddress !== job.contractAddress) throw failure("CONTRACT_CHANGED_REFRESH_REQUIRED");
      if (!availableActions(before).some(action => action.id === job.action)) throw failure("ACTION_NOT_ALLOWED_BY_CURRENT_CHAIN_STATE");
      if (!session) session = await openActors(push);
      const { authority, voter } = session;
      const prepare = async slot => (await voter.request("prepare", { slot })).commitment;
      let result, expected;
      switch (job.action) {
        case "enroll-a": case "enroll-b": {
          const a = job.action === "enroll-a";
          result = await authority.request("enroll", { demoPassport: a ? "DEMO-P001" : "DEMO-P002", commitment: await prepare(a ? "a" : "b") });
          expected = ["ISSUED", "ALREADY_ISSUED"];
          if (result.code === "ALREADY_ISSUED" && !result.sameCommitment) throw failure("DIFFERENT_CREDENTIAL_ALREADY_ISSUED");
          break;
        }
        case "copy-check":
          result = await authority.request("enroll", { demoPassport: "DEMO-P001", commitment: await prepare("copy") }); expected = ["ALREADY_ISSUED"]; break;
        case "revoked-check":
          result = await authority.request("enroll", { demoPassport: "DEMO-P003", commitment: await prepare("revoked") }); expected = ["REVOKED"]; break;
        case "open": case "close":
          result = await authority.request(job.action); expected = ["FINALIZED", "ALREADY_FINALIZED"]; break;
        case "modified-proof-check":
          result = await voter.request("testModifiedProof"); expected = ["NETWORK_REJECTED_MODIFIED_PROOF"]; break;
        case "replay-check":
          result = await voter.request("vote", { slot: "a", yes: false, repeat: true }); expected = ["CREDENTIAL_ALREADY_USED"]; break;
        case "vote-a": case "vote-b":
          result = await voter.request("vote", { slot: job.action === "vote-a" ? "a" : "b", yes: job.action === "vote-a" }); expected = ["FINALIZED", "ALREADY_FINALIZED"]; break;
        default: throw failure("UNKNOWN_ACTION", 400);
      }
      if (["ISSUANCE_PENDING", "ISSUANCE_STATE_MISMATCH", "ISSUANCE_STATE_UNKNOWN", "BROADCAST_OUTCOME_REQUIRES_RECONCILIATION", "ALREADY_ISSUED_FOR_ELECTION", "ENROLLMENT_CLOSED"].includes(result.code)) throw failure(result.code);
      if (!expected.includes(result.code)) throw failure("UNEXPECTED_RESULT_RECONCILE_BEFORE_RETRY");
      push({ stage: "verify-receipts", at: new Date().toISOString() });
      const after = await inspect();
      if (after.contractAddress !== before.contractAddress) throw failure("CONTRACT_CHANGED_REFRESH_REQUIRED");
      if (job.action.endsWith("-check") && JSON.stringify(after.state) !== JSON.stringify(before.state)) throw failure("NEGATIVE_TEST_CHANGED_STATE");
      job.result = { code: result.code, evidence: result.code === "NETWORK_REJECTED_MODIFIED_PROOF" ? "RECORDED_NODE_REJECTION" : result.stage === "CIRCUIT_CONSTRUCTION" ? "LOCAL_CIRCUIT_REJECTION_NO_BROADCAST" : result.receipt ? "FINALIZED_RECEIPT" : "AUTHORITY_DECISION_NO_BROADCAST" };
      job.inspection = after;
      job.state = "succeeded";
    } catch (error) {
      // Don't expose raw SDK exceptions or private-state objects through HTTP.
      job.error = safeActionFailure(error);
      job.state = "failed";
    } finally {
      job.finishedAt = new Date().toISOString();
      active = undefined;
      idleTimer = setTimeout(() => stop().catch(() => {}), idleMs);
      idleTimer.unref?.();
    }
  };
  return {
    async inspect() { const value = await inspect(); return { ...value, actionsEnabled: enabled, actions: availableActions(value), workersReady: Boolean(session), job: snapshot(last) }; },
    job() { return { job: snapshot(last), workersReady: Boolean(session), stopping }; },
    start(input) {
      if (!enabled) throw failure("LIVE_ACTIONS_DISABLED", 403);
      if (!input || Object.keys(input).sort().join(",") !== "action,consent,contractAddress,requestId") throw failure("INVALID_ACTION_BODY", 400);
      const { action, consent, contractAddress, requestId } = input;
      if (consent !== true || !LIVE_ACTIONS.some(item => item.id === action) || !/^[a-f0-9]{64}$/.test(contractAddress) || !/^[a-f0-9-]{36}$/.test(requestId)) throw failure("INVALID_ACTION_BODY", 400);
      if (jobs.has(requestId)) {
        const old = jobs.get(requestId);
        if (old.action !== action || old.contractAddress !== contractAddress) throw failure("REQUEST_ID_REUSED_FOR_DIFFERENT_ACTION");
        return snapshot(old);
      }
      if (active || stopping) throw failure("OPERATION_IN_PROGRESS_WAIT_FOR_OUTCOME");
      if (jobs.size >= 100) throw failure("SESSION_JOB_LIMIT_RESTART_AFTER_RECONCILIATION");
      clearTimeout(idleTimer);
      const job = { id: requestId, action, contractAddress, state: "queued", startedAt: new Date().toISOString(), progress: [] };
      jobs.set(requestId, job); active = job; last = job;
      queueMicrotask(() => run(job));
      return snapshot(job);
    },
    stop,
  };
}
