const captions = {
  preflight: "Checking Preview, election phase and saved receipts",
  "wallet-restored": "Wallet restored locally · starting sync",
  "wallet-sync-progress": "Syncing wallet history · no ballot submitted",
  "wallet-synced": "Wallet synced · generated DUST available",
  "wallet-stream-error": "Wallet stream interrupted · outcome not confirmed",
  "build-real-call": "Building the actual Compact circuit call",
  "prove-start": "Generating a real ZK proof with the trusted local prover",
  "prove-finished": "Proof generated · not yet a finalized transaction",
  "balance-with-dust": "Balancing network fees with generated DUST",
  "transaction-balanced": "DUST fee calculated",
  "call-broadcast": "Transaction submitted · waiting for finality",
  "call-finalized-and-state-verified": "Finalized transaction and contract transition checked",
  "submit-deliberately-modified-proof": "Submitting the negative proof test to Preview",
  "modified-proof-rejected-by-preview": "Node rejected the modified-proof transaction",
  "verify-receipts": "Rechecking transaction receipts and current contract state",
};
const explanations = {
  deployment: "The authority deployed the verifier and initial election state. This receipt is not a ballot.",
  "enroll-a": "An authority proof enrolled an anonymous commitment. The passport ID is not a circuit argument.",
  "enroll-b": "A second commitment entered the eligible set before voting opened.",
  open: "The authority opened voting and froze the eligibility root.",
  "vote-a": "Midnight accepted a proof-backed ballot and recorded a one-time nullifier.",
  "vote-b": "A second proof-backed ballot updated the tally with a different nullifier.",
  close: "The authority closed the election. Later votes cannot change this result.",
};

export function initializePreviewBallot() {
  const ids = ["Inspect", "JobCheck", "Status", "State", "Election", "Phase", "Tally", "Counts", "Contract", "Checked", "ReceiptGuide", "ReceiptTitle", "ReceiptHelp", "ReceiptJson", "Previous", "Next", "Action", "Consent", "Run", "Disconnect", "ActionHint", "ProgressPanel", "Progress"];
  const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(`preview${id}`)]));
  let inspected, receiptIndex = 0, busy = false, jobRunning = false, timer, needsInspection = true;
  const request = async (path, data) => {
    const response = await fetch(`/api/preview/${path}`, {
      ...(data === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", "x-midnight-preview-action": "explicit" }, body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(60000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.code || "PREVIEW_UNAVAILABLE");
    return result;
  };
  const controls = () => {
    ui.Inspect.disabled = busy;
    ui.JobCheck.disabled = busy;
    const allowed = !busy && !jobRunning && !needsInspection && inspected?.actionsEnabled && inspected.actions.length > 0;
    ui.Action.disabled = !allowed;
    ui.Consent.disabled = !allowed;
    ui.Run.disabled = !allowed || !ui.Consent.checked;
    ui.Disconnect.disabled = busy || jobRunning || !inspected?.workersReady;
  };
  const renderReceipt = () => {
    const receipts = inspected?.receipts || [];
    ui.ReceiptGuide.hidden = !receipts.length;
    if (!receipts.length) return;
    receiptIndex = Math.min(receiptIndex, receipts.length - 1);
    const receipt = receipts[receiptIndex];
    ui.ReceiptTitle.textContent = `${receiptIndex + 1} / ${receipts.length} · ${receipt.label}`;
    ui.ReceiptHelp.textContent = explanations[receipt.id] || "A confirmed Preview transaction.";
    ui.ReceiptJson.textContent = JSON.stringify(receipt, null, 2);
    ui.Previous.disabled = receiptIndex === 0; ui.Next.disabled = receiptIndex === receipts.length - 1;
  };
  const renderInspection = value => {
    inspected = value; needsInspection = false;
    ui.State.hidden = false;
    ui.Election.textContent = value.electionId;
    ui.Phase.textContent = value.state.phase;
    ui.Tally.textContent = `YES ${value.state.tally.YES} / NO ${value.state.tally.NO}`;
    ui.Counts.textContent = `${value.state.eligibleCount} eligible / ${value.state.usedNullifiers} used`;
    ui.Contract.textContent = value.contractAddress; ui.Checked.textContent = value.checkedAt;
    ui.Action.replaceChildren();
    for (const action of value.actions) ui.Action.add(new Option(action.label, action.id));
    if (!value.actions.length) ui.Action.add(new Option("No action allowed in this state", ""));
    ui.Consent.checked = false;
    ui.ActionHint.textContent = value.state.phase === "CLOSED" ? "This election is closed. Inspect its receipts; it cannot be reset or voted in again."
      : value.recovery.length ? "An unresolved broadcast requires reconciliation. No action is enabled."
      : !value.actionsEnabled ? "Live actions are disabled on this server. Start with npm run start:preview to explicitly enable local development actions."
      : "Choose one step. Nothing starts until you authorize it and click Run selected live step.";
    renderReceipt(); controls();
  };
  const renderJob = value => {
    const job = value.job;
    if (inspected) inspected.workersReady = value.workersReady;
    jobRunning = Boolean(job && ["queued", "running"].includes(job.state));
    ui.ProgressPanel.hidden = !job;
    if (!job) { ui.Status.textContent = "No operation is running in this server session. Check Preview state before starting an action."; controls(); return; }
    ui.Progress.replaceChildren();
    for (const event of job.progress) {
      const item = document.createElement("li");
      item.textContent = `${event.at.slice(11, 19)} · ${event.role ? `${event.role}: ` : ""}${captions[event.stage] || event.stage}`;
      if (event.estimatedFeeSpecks) item.textContent += ` · estimated fee ${event.estimatedFeeSpecks} DUST specks`;
      if (event.progress) item.textContent += ` · processed ${Object.entries(event.progress).filter(([, p]) => p).map(([kind, p]) => `${kind} ${p.applied}`).join(", ")}`;
      ui.Progress.append(item);
    }
    if (jobRunning) {
      ui.Status.textContent = `Live step ${job.action}: ${job.state}. Waiting for actual completion; no next step starts automatically.`;
      clearTimeout(timer); timer = setTimeout(checkJob, 2000);
    } else if (job.state === "succeeded") {
      if (job.inspection && inspected) renderInspection({ ...job.inspection, actionsEnabled: inspected.actionsEnabled, actions: [], workersReady: value.workersReady });
      needsInspection = true; // Obtain fresh allowed actions explicitly; never autoplay.
      ui.Status.textContent = `${job.result.code} · ${job.result.evidence}. Check Preview state to choose the next step.`;
    } else {
      needsInspection = true;
      ui.Status.textContent = `Operation stopped: ${job.error}. Outcome may need reconciliation; do not blindly submit again.`;
    }
    controls();
  };
  async function checkJob() {
    clearTimeout(timer);
    try { renderJob(await request("job")); }
    catch { jobRunning = true; ui.Status.textContent = "Operation status unavailable. A submitted transaction may still finish. Use Check running operation; do not resubmit."; controls(); }
  }
  ui.Inspect.addEventListener("click", async () => {
    busy = true; controls(); clearTimeout(timer);
    ui.Status.textContent = "Checking Preview state, verifier keys and receipts… no transaction is being submitted.";
    try {
      const result = await request("inspection"); renderInspection(result);
      if (result.job && ["queued", "running"].includes(result.job.state)) renderJob(result);
      else { jobRunning = false; ui.Status.textContent = result.completeBallotVerified ? `Preview ballot verified · ${result.receipts.length} receipts · CLOSED · YES 1 / NO 1. Browse the evidence at your pace.` : "Preview state checked. Review allowed actions and evidence before continuing."; }
    } catch (error) {
      needsInspection = true; inspected = undefined; ui.State.hidden = true; ui.ReceiptGuide.hidden = true;
      ui.Status.textContent = `Preview check failed: ${error.message}. No verified result is shown. No transaction was submitted by this read.`;
    } finally { busy = false; controls(); }
  });
  ui.JobCheck.addEventListener("click", checkJob);
  ui.Previous.addEventListener("click", () => { receiptIndex--; renderReceipt(); });
  ui.Next.addEventListener("click", () => { receiptIndex++; renderReceipt(); });
  ui.Consent.addEventListener("change", controls);
  ui.Action.addEventListener("change", () => { ui.Consent.checked = false; controls(); });
  ui.Run.addEventListener("click", async () => {
    if (ui.Run.disabled) return;
    busy = true; controls();
    try {
      const result = await request("actions", { action: ui.Action.value, contractAddress: inspected.contractAddress, requestId: crypto.randomUUID(), consent: true });
      ui.Consent.checked = false; renderJob({ ...result, workersReady: inspected.workersReady });
    } catch { jobRunning = true; needsInspection = true; ui.Status.textContent = "Action response unavailable or rejected. Check running operation and chain state before considering another submission."; }
    finally { busy = false; controls(); }
  });
  ui.Disconnect.addEventListener("click", async () => {
    busy = true; controls();
    try { await request("disconnect", {}); inspected.workersReady = false; ui.Status.textContent = "Idle wallet workers stopped. No on-chain state was changed."; }
    catch { ui.Status.textContent = "Could not stop workers. Check running operation; a transaction may still be active."; }
    finally { busy = false; controls(); }
  });
  controls();
}
