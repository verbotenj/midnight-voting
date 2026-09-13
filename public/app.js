import { initializeNetworkLab } from "./wallet-lab.js";
import { initializePreviewBallot } from "./preview-ballot.js";
import { DemoPlayer, DemoStopped } from "./demo-player.js";
import { inspectRequest, inspectLocal, inspectPublic, resetInspector, initializeInspector, highlightBoundary } from "./payload-inspector.js";
initializeInspector();
initializeNetworkLab();
initializePreviewBallot();
const ELECTION_ID = "ELECTION-DEMO-2026-001";
const STORAGE_KEY = "private-ballot-demo-credentials-v1";
const DOMAIN = {
  credential: "MIDNIGHT_DEMO_CREDENTIAL_V1",
  nullifier: "MIDNIGHT_DEMO_NULLIFIER_V1",
  proof: "MIDNIGHT_DEMO_PROOF_V1",
};

const ui = Object.fromEntries([
  "passportList", "issueButton", "copyAttackButton", "credentialCard", "credentialStatus",
  "commitmentValue", "ballot", "voteButton", "tamperButton", "registry", "authorityLog",
  "yesCount", "noCount", "electionState", "eligibleCount", "votesCast", "rootValue",
  "transactionList", "blockHeight", "resetButton", "guidedDemoButton", "closeButton",
  "copyRoot", "toastRegion", "transactionTheater", "flowStatus", "networkStage",
  "packetLayer", "traceList", "clearTrace", "deviceNode", "authorityNode", "midnightNode",
  "deviceNodeState", "authorityNodeState", "midnightNodeState", "selectionConfirmation",
  "selectedPassportValue", "nextInstruction", "demoPace", "nfcReadButton", "nfcReadStatus",
].map((id) => [id, document.getElementById(id)]));

const player = new DemoPlayer(Object.fromEntries([
  ["next", "demoNext"], ["pause", "demoPause"], ["stop", "demoStop"],
  ["title", "demoStepTitle"], ["detail", "demoStepDetail"], ["results", "demoResults"],
].map(([key, id]) => [key, document.getElementById(id)])));

let selectedPassport = null;
let selectedChoice = null;
let busy = false;
let publicState = null;
let guidedRunning = false;
const preparedCredentials = new Map();

const nfc = Object.fromEntries(["nfcScene", "nfcSceneStatus", "nfcPassport", "nfcPassportLabel", "nfcReader", "nfcReaderStatus", "nfcCredentialTitle", "nfcCredentialDetail"].map(id => [id, document.getElementById(id)]));

function setNfcPhase(phase, title, detail) {
  nfc.nfcScene.dataset.phase = phase;
  nfc.nfcSceneStatus.textContent = title;
  nfc.nfcReaderStatus.textContent = detail;
}

function resetNfc() {
  nfc.nfcPassport.getAnimations().forEach(animation => animation.cancel());
  nfc.nfcPassportLabel.textContent = selectedPassport || "Select a passport";
  setNfcPhase("idle", "Passport → read → prepare credential", "Ready to read");
  nfc.nfcCredentialTitle.textContent = "No credential prepared";
  nfc.nfcCredentialDetail.textContent = "The device creates a private secret. The authority decides whether it becomes a voting right.";
}

async function prepareCredential(passport, fresh = false) {
  if (!fresh && preparedCredentials.has(passport)) return preparedCredentials.get(passport);
  const secret = randomSecret();
  const credential = { secret, commitment: await makeCommitment(secret) };
  if (!fresh) preparedCredentials.set(passport, credential);
  return credential;
}

function currentPace() {
  return guidedRunning && ui.demoPace.value !== "step" ? Number(ui.demoPace.value) : 2;
}

const DEFAULT_NODE_COPY = {
  device: "Waiting for passport",
  authority: "Ready to verify",
  midnight: "Listening for proof",
};

function clearNodeFocus() {
  [ui.deviceNode, ui.authorityNode, ui.midnightNode].forEach((node) => node.classList.remove("active", "rejected", "verifying"));
}

function setFlowPhase(activeStep) {
  document.querySelectorAll(".flow-step").forEach((node) => {
    const step = Number(node.dataset.flowStep);
    node.classList.toggle("active", step === activeStep);
    node.classList.toggle("complete", step < activeStep);
    node.querySelector("span").textContent = step < activeStep ? "✓" : String(step);
  });
  document.querySelectorAll(".flow-progress > i").forEach((line, index) => line.classList.toggle("complete", index + 1 < activeStep));
}

function setNodeState(nodeName, message, mode = "active") {
  clearNodeFocus();
  const node = ui[`${nodeName}Node`];
  const state = ui[`${nodeName}NodeState`];
  if (node) node.classList.add(mode);
  if (state) state.textContent = message;
}

function setFlowStatus(message, mode = "running") {
  ui.flowStatus.textContent = message;
  ui.transactionTheater.classList.toggle("running", mode === "running");
  ui.transactionTheater.classList.toggle("rejected", mode === "rejected");
}

function addTrace(label, value, tone = "public") {
  const empty = ui.traceList.querySelector(".trace-empty");
  if (empty) empty.remove();
  const item = document.createElement("div");
  item.className = `trace-event ${tone}`;
  item.innerHTML = `<time>${new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</time><i></i><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>`;
  ui.traceList.append(item);
  ui.traceList.scrollLeft = ui.traceList.scrollWidth;
}

function nodeCenter(node, stageRect) {
  const rect = node.getBoundingClientRect();
  return {
    x: rect.left - stageRect.left + rect.width / 2,
    y: rect.top - stageRect.top + rect.height / 2,
  };
}

async function animatePacket(fromNode, toNode, label, tone = "public") {
  const stageRect = ui.networkStage.getBoundingClientRect();
  const start = nodeCenter(ui[`${fromNode}Node`], stageRect);
  const end = nodeCenter(ui[`${toNode}Node`], stageRect);
  const packet = document.createElement("div");
  packet.className = `data-packet ${tone}`;
  packet.textContent = label;
  packet.style.left = `${start.x}px`;
  packet.style.top = `${start.y}px`;
  ui.packetLayer.append(packet);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    packet.style.left = `${end.x}px`;
    packet.style.top = `${end.y}px`;
    await wait(720 * currentPace());
  } else {
    const animation = packet.animate([
      { left: `${start.x}px`, top: `${start.y}px`, opacity: 0, transform: "translate(-50%,-50%) scale(.72)" },
      { left: `${start.x}px`, top: `${start.y}px`, opacity: 1, transform: "translate(-50%,-50%) scale(1)", offset: .14 },
      { left: `${end.x}px`, top: `${end.y}px`, opacity: 1, transform: "translate(-50%,-50%) scale(1)", offset: .84 },
      { left: `${end.x}px`, top: `${end.y}px`, opacity: 0, transform: "translate(-50%,-50%) scale(.72)" },
    ], { duration: 720 * currentPace(), easing: "cubic-bezier(.22,.75,.24,1)" });
    await animation.finished.catch(() => {});
  }
  packet.remove();
}

async function animatePassportRead(passport, copiedApp = false) {
  setFlowPhase(1);
  setFlowStatus(copiedApp ? "COPIED APP REQUEST" : "READING DEMO PASSPORT");
  setNodeState("device", copiedApp ? `New app requests ${passport}` : `${passport} read locally`);
  addTrace("DEVICE", copiedApp ? `COPY ATTACK · ${passport}` : `LOCAL READ · ${passport}`, "private");
  await wait(260 * currentPace());
  setNodeState("device", "Private 256-bit secret generated");
  addTrace("DEVICE", "SECRET CREATED LOCALLY", "private");
  await animatePacket("device", "authority", copiedApp ? "SECOND ISSUANCE REQUEST" : "PASSPORT + ELECTION ID", "private");
  addTrace("PRIVATE API", "IDENTITY STATUS CHECK", "private");
  await simulateAuthorityVerification(passport);
}

async function simulateAuthorityVerification(passport) {
  setFlowPhase(2);
  setFlowStatus("AUTHORITY VERIFYING • 1 SECOND");
  clearNodeFocus();
  ui.authorityNode.classList.add("active", "verifying");
  ui.authorityNodeState.textContent = "Status + eligibility + previous issuance";
  await wait(1000);
  ui.authorityNode.classList.remove("verifying");
  ui.authorityNodeState.textContent = `${passport} verification complete`;
}

async function animateIssuanceResult(result, passport) {
  if (result.code === "ISSUED") {
    setFlowPhase(3);
    setNodeState("authority", `${passport} valid · first issuance`);
    addTrace("AUTHORITY", "VALID + ELIGIBLE + NOT ISSUED", "private");
    await animatePacket("authority", "midnight", "COMMITMENT 0x… ONLY", "public");
    setNodeState("midnight", "Eligibility Merkle root updated");
    addTrace("MIDNIGHT", "ELIGIBILITY ROOT UPDATED", "public");
    await animatePacket("authority", "device", "ANONYMOUS CREDENTIAL", "private");
    setNodeState("device", "Credential stored on this device");
    setFlowStatus("CREDENTIAL READY", "idle");
  } else {
    setNodeState("authority", result.code.replaceAll("_", " "), "rejected");
    addTrace("AUTHORITY", result.code, "reject");
    await animatePacket("authority", "device", result.code.replaceAll("_", " "), "reject");
    setNodeState("device", "No credential received", "rejected");
    setFlowStatus(result.code.replaceAll("_", " "), "rejected");
  }
}

async function animateVoteRequest(choice, tampered = false) {
  setFlowPhase(4);
  setFlowStatus(tampered ? "GENERATING MODIFIED PROOF" : "GENERATING PRIVATE PROOF");
  setNodeState("device", `${choice} selected · simulated proof`);
  addTrace("DEVICE", `${choice} + PRIVATE WITNESS`, "private");
  await wait(300 * currentPace());
  addTrace("DEVICE", tampered ? "PROOF MODIFIED" : "PROOF GENERATED", tampered ? "reject" : "private");
  await animatePacket("device", "midnight", tampered ? "MODIFIED PROOF" : "ZK PROOF + NULLIFIER", tampered ? "reject" : "public");
  setNodeState("midnight", "Verifying membership + nullifier");
}

async function animateVoteResult(result) {
  if (result.code === "ACCEPTED") {
    setFlowPhase(5);
    setNodeState("midnight", "Proof accepted · tally incremented");
    addTrace("MIDNIGHT", "PROOF VALID + NULLIFIER UNUSED", "public");
    await animatePacket("midnight", "device", "VOTE ACCEPTED", "public");
    setNodeState("device", `Confirmed · ${short(result.transactionHash, 8, 5)}`);
    setFlowStatus("VOTE CONFIRMED", "idle");
  } else {
    setNodeState("midnight", result.code.replaceAll("_", " "), "rejected");
    addTrace("MIDNIGHT", result.code, "reject");
    await animatePacket("midnight", "device", result.code.replaceAll("_", " "), "reject");
    setNodeState("device", "Vote not recorded", "rejected");
    setFlowStatus(result.code.replaceAll("_", " "), "rejected");
  }
}

function resetProtocolTheater(clearTrace = false) {
  clearNodeFocus();
  ui.deviceNodeState.textContent = DEFAULT_NODE_COPY.device;
  ui.authorityNodeState.textContent = DEFAULT_NODE_COPY.authority;
  ui.midnightNodeState.textContent = DEFAULT_NODE_COPY.midnight;
  setFlowStatus("READY FOR PASSPORT", "idle");
  setFlowPhase(1);
  ui.packetLayer.innerHTML = "";
  if (clearTrace) ui.traceList.innerHTML = '<div class="trace-empty">Choose a demo passport or run the guided demo.</div>';
}

function getCredentials() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}

function setCredentials(credentials) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hash(...parts) {
  const joined = `${parts.map(String).join("\0")}\0`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(joined));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const makeCommitment = (secret, electionId = ELECTION_ID) => hash(DOMAIN.credential, electionId, secret);
const makeNullifier = (secret, electionId = ELECTION_ID) => hash(DOMAIN.nullifier, electionId, "vote", secret);

async function makeProof(secret, choice) {
  const commitment = await makeCommitment(secret);
  const nullifier = await makeNullifier(secret);
  return hash(DOMAIN.proof, ELECTION_ID, choice, commitment, nullifier, secret);
}

async function api(path, options = {}) {
  const exchange = options.body ? inspectRequest(path, JSON.parse(options.body)) : null;
  try {
    const response = await fetch(path, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    const result = await response.json();
    exchange?.received(response.status, result);
    return { ok: response.ok, status: response.status, ...result };
  } catch {
    exchange?.unavailable();
    return { ok: false, status: 0, code: "SERVICE_UNAVAILABLE" };
  }
}

function short(value, start = 10, end = 8) {
  if (!value) return "—";
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function toast(title, detail, kind = "success") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
  ui.toastRegion.append(node);
  setTimeout(() => node.remove(), 4200);
}

function setBusy(next) {
  busy = next;
  document.body.classList.toggle("busy", busy);
  updateControlLock();
}

function updateControlLock() {
  const locked = busy || guidedRunning;
  const credential = getCredentials()[selectedPassport];
  document.querySelectorAll(".passport-card, .vote-option").forEach(button => { button.disabled = locked; });
  [ui.resetButton, ui.clearTrace, ui.guidedDemoButton, ui.demoPace].forEach(button => { button.disabled = locked; });
  ui.issueButton.disabled = locked || !selectedPassport || Boolean(credential?.secret);
  ui.copyAttackButton.disabled = locked || !credential?.secret;
  ui.voteButton.disabled = locked || !credential?.secret || !selectedChoice;
  ui.tamperButton.disabled = locked || !credential?.secret;
  ui.closeButton.disabled = locked || publicState?.status === "CLOSED";
  ui.nfcReadButton.disabled = locked || !selectedPassport;
}

// One gate for mouse, keyboard and asynchronous exceptions. Internal tour calls
// share these same actions, but cannot be interrupted by another UI action.
async function manualAction(action) {
  if (busy || guidedRunning) return;
  setBusy(true);
  try { await action(); }
  catch { toast("Action interrupted", "Could not confirm the result. Check the current state before retrying; the demo has not assumed success.", "error"); }
  finally { ui.voteButton.classList.remove("pulse"); setBusy(false); }
}

function updateStepper(step) {
  document.querySelectorAll(".step").forEach((node) => {
    const value = Number(node.dataset.step);
    node.classList.toggle("active", value === step);
    node.classList.toggle("complete", value < step);
    if (value < step) node.querySelector("span").textContent = "✓";
    else node.querySelector("span").textContent = String(value);
  });
}

function renderVoter() {
  document.querySelectorAll(".passport-card").forEach((card) => card.classList.toggle("selected", card.dataset.passport === selectedPassport));
  const hasSelection = Boolean(selectedPassport);
  const credential = hasSelection ? getCredentials()[selectedPassport] : null;
  const hasCredential = Boolean(credential?.secret);
  ui.selectionConfirmation.classList.toggle("hidden", !hasSelection || hasCredential);
  if (hasSelection) ui.selectedPassportValue.textContent = selectedPassport;
  ui.credentialCard.classList.toggle("hidden", !hasCredential);
  ui.ballot.classList.toggle("hidden", !hasCredential);
  ui.issueButton.innerHTML = !hasSelection
    ? "First, choose a demo passport <span>↑</span>"
    : hasCredential
      ? "Credential already on this device <span>✓</span>"
      : `Next: verify ${escapeHtml(selectedPassport)} with authority <span>→</span>`;
  ui.issueButton.disabled = !hasSelection || hasCredential;
  ui.copyAttackButton.disabled = !hasCredential;
  if (hasCredential) {
    ui.commitmentValue.textContent = `0x${short(credential.commitment, 14, 10)}`;
    ui.credentialStatus.textContent = credential.voted ? "Used for this election" : "Ready to vote";
    updateStepper(credential.voted ? 4 : 3);
  } else {
    selectedChoice = null;
    document.querySelectorAll(".vote-option").forEach((button) => button.classList.remove("selected"));
    ui.voteButton.disabled = true;
    updateStepper(1);
  }
  updateControlLock();
}

function renderAuthority(authority) {
  ui.registry.innerHTML = authority.passports.map((record) => {
    const label = record.status === "REVOKED" ? "REVOKED" : record.issued ? "ISSUED" : "NOT ISSUED";
    const statusClass = record.status === "REVOKED" ? "revoked" : record.issued ? "issued" : "";
    return `<div class="registry-row"><div><strong>${record.passport}</strong><small>${record.status} · ${record.eligible ? "ELIGIBLE" : "NOT ELIGIBLE"}</small></div><span class="registry-status ${statusClass}">${label}</span></div>`;
  }).join("");

  ui.authorityLog.innerHTML = authority.events.length ? authority.events.map((event) => {
    const error = event.result !== "ISSUED";
    return `<div class="log-row"><time>${new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><b>${escapeHtml(event.passport)}</b><span class="log-result ${error ? "error" : ""}">${escapeHtml(event.result)}</span></div>`;
  }).join("") : '<div class="empty-log">Credential checks will appear here.</div>';
}

function renderPublic(next) {
  publicState = next;
  inspectPublic(next);
  ui.yesCount.textContent = next.tally.YES;
  ui.noCount.textContent = next.tally.NO;
  ui.eligibleCount.textContent = next.eligibleCredentialCount;
  ui.votesCast.textContent = next.votesCast;
  ui.electionState.textContent = next.status;
  const heroState = document.getElementById("heroElectionState");
  heroState.textContent = next.status;
  heroState.classList.toggle("open", next.status === "OPEN");
  ui.rootValue.textContent = `0x${next.eligibilityRoot}`;
  ui.blockHeight.textContent = `SIM EVENT #${String(next.transactions.length + next.eligibleCredentialCount).padStart(4, "0")}`;
  ui.closeButton.disabled = next.status === "CLOSED";
  ui.transactionList.innerHTML = next.transactions.length ? next.transactions.map((tx) => `<div class="tx-row"><time>${new Date(tx.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span class="tx-hash">0x${short(tx.transactionHash, 16, 10)} · nullifier ${short(tx.nullifier, 8, 6)}</span><span class="tx-result">${tx.result}</span></div>`).join("") : '<div class="empty-transaction">No votes submitted yet.</div>';
}

async function refresh() {
  const state = await api("/api/state");
  if (!state.ok || !state.authority || !state.public) {
    setFlowStatus("DEMO SERVER OFFLINE", "rejected");
    return false;
  }
  renderAuthority(state.authority);
  renderPublic(state.public);
  renderVoter();
  return true;
}

async function selectPassport(passport) {
  selectedPassport = passport;
  resetNfc();
  selectedChoice = null;
  document.querySelectorAll(".vote-option").forEach(button => button.classList.remove("selected"));
  ui.nfcReadStatus.textContent = `${passport} selected. Optional NFC simulation reads fictional document data; authority verification is a separate action.`;
  renderVoter();
  setFlowPhase(1);
  setFlowStatus("PASSPORT SELECTED • NEXT: VERIFY", "idle");
  setNodeState("device", `${passport} selected · ready to verify`);
  addTrace("VOTER", `${passport} SELECTED`, "private");
}

async function simulateNfcRead() {
  if (!selectedPassport) throw new Error("SELECT_PASSPORT_FIRST");
  const passport = selectedPassport;
  resetNfc();
  if (!guidedRunning) nfc.nfcScene.scrollIntoView({ behavior: "smooth", block: "center" });
  setFlowPhase(1);
  setNfcPhase("approach", "Bring passport close to the voter device", "Waiting for passport…");
  highlightBoundary("local", "Passport approaching the device · animation only. No data sent.");
  setFlowStatus("SIMULATED NFC · PASSPORT APPROACHING");
  setNodeState("device", "Passport approaching");
  addTrace("LOCAL NFC SIM", "PASSPORT APPROACHING DEVICE", "private");
  const passportRect = nfc.nfcPassport.getBoundingClientRect();
  const readerRect = nfc.nfcReader.getBoundingClientRect();
  const distance = Math.max(0, readerRect.left - passportRect.right - 12);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    await wait(1800);
  } else {
    await nfc.nfcPassport.animate([
      { transform: "translateX(0) rotate(-5deg)" },
      { transform: `translateX(${distance}px) rotate(0deg)` },
    ], { duration: 1800, easing: "ease-in-out", fill: "forwards" }).finished;
  }
  setNfcPhase("reading", "Reading passport…", "Local NFC read · simulated");
  setNodeState("device", "Reading passport locally");
  ui.nfcReadStatus.textContent = "Reading fictional document ID. No data is being sent to the authority or Midnight.";
  inspectLocal({ mode: "SIMULATED_NFC", demoPassport: passport, documentStatus: "UNKNOWN", accessedGroups: ["DG1", "SOD"], facialImageRead: false });
  addTrace("LOCAL NFC SIM", "DOCUMENT ID READ · NOTHING SENT", "private");
  await wait(1800);
  setNfcPhase("preparing", "Creating a private credential on this device…", "Generating secret + commitment");
  const existing = getCredentials()[passport];
  const credential = existing?.secret ? existing : await prepareCredential(passport);
  inspectLocal({ mode: "SIMULATED_NFC", demoPassport: passport, documentStatus: "UNKNOWN", accessedGroups: ["DG1", "SOD"], facialImageRead: false, credential: { secret: "<private; never displayed>", commitment: credential.commitment, authorization: existing?.secret ? "ALREADY_ISSUED_ON_THIS_DEVICE" : "NOT_ISSUED" } });
  nfc.nfcCredentialTitle.textContent = existing?.secret ? "Existing credential on this device" : "Private credential prepared · not issued";
  nfc.nfcCredentialDetail.textContent = "Only the commitment and demo passport ID will be sent to the authority. A prepared secret is not permission to vote.";
  addTrace("DEVICE", "SECRET + COMMITMENT PREPARED LOCALLY", "private");
  await wait(1800);
  setNfcPhase("prepared", "Ready for the authority check", "Read complete · data stays local");
  ui.nfcReadStatus.textContent = `${passport} read in simulation. Document status is UNKNOWN until the authority checks it. No credential has been issued by this read.`;
  setNodeState("device", `${passport} · status still UNKNOWN`);
  setFlowStatus("SIMULATED READ COMPLETE · NEXT: AUTHORITY", "idle");
  return { code: "SIMULATED_READ" };
}

async function issueCredential({ quiet = false, copiedApp = false } = {}) {
  if (!selectedPassport) {
    toast("Choose a passport first", "Select one fictional passport, then verify it with the authority.", "error");
    return null;
  }
  setBusy(true);
  const { secret, commitment } = await prepareCredential(selectedPassport, copiedApp);
  setNfcPhase("verifying", "Authority checking eligibility…", "Credential awaits authorization");
  if (!quiet) updateStepper(2);
  if (!guidedRunning) ui.transactionTheater.scrollIntoView({ behavior: "smooth", block: "start" });
  await wait(420 * currentPace());
  await animatePassportRead(selectedPassport, copiedApp);
  const result = await api(`/api/elections/${ELECTION_ID}/credential`, {
    method: "POST",
    body: JSON.stringify({ demoPassport: selectedPassport, commitment }),
  });
  if (result.ok && !copiedApp) {
    const credentials = getCredentials();
    credentials[selectedPassport] = { secret, commitment, electionId: ELECTION_ID, issuedAt: Date.now(), voted: false };
    setCredentials(credentials);
    preparedCredentials.delete(selectedPassport);
  }
  if (result.ok) {
    setNfcPhase("issued", "Voting credential issued", "Authorized for this election");
    nfc.nfcCredentialTitle.textContent = "Credential issued · ready to vote";
    nfc.nfcCredentialDetail.textContent = "The authority accepted the commitment. Your private secret was not part of the issuance request.";
  } else if (result.code === "SERVICE_UNAVAILABLE") {
    setNfcPhase("unknown", "Issuance outcome unknown", "No confirmed authority response");
    nfc.nfcCredentialTitle.textContent = "Credential authorization not confirmed";
    nfc.nfcCredentialDetail.textContent = "A lost response does not prove rejection. Keep the prepared secret and reconcile the original request before trying again.";
  } else {
    setNfcPhase("rejected", "No new voting right issued", result.code.replaceAll("_", " "));
    nfc.nfcCredentialTitle.textContent = copiedApp ? "Copied app refused a second credential" : "Credential not authorized by this request";
    nfc.nfcCredentialDetail.textContent = "Preparing or reading a passport does not grant a vote. Inspect the authority response for the reason.";
  }
  await animateIssuanceResult(result, selectedPassport);
  await refresh();

  const messages = {
    ISSUED: ["Credential issued", "Only the anonymous commitment entered the eligibility set."],
    ALREADY_ISSUED: ["Credential already issued", "A copied app cannot create a second voting entitlement."],
    REVOKED: ["Document revoked", "The authority refused eligibility. Voting is impossible."],
    NOT_ELIGIBLE: ["Not eligible", "No credential was issued for this election."],
    ELECTION_CLOSED: ["Election closed", "No new credentials can be issued after closing."],
    SERVICE_UNAVAILABLE: ["Authority result unknown", "The response was unavailable. Check authority state before retrying; a lost response does not prove nothing was issued."],
  };
  const [title, detail] = messages[result.code] || ["Request rejected", result.code || "Unknown authority response"];
  if (!quiet) toast(title, detail, result.ok ? "success" : "error");
  if (result.ok && !copiedApp && !quiet) {
    await wait(350);
    ui.ballot.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  return result;
}

async function castSelectedVote({ tampered = false, quiet = false } = {}) {
  const credential = getCredentials()[selectedPassport];
  if (!credential || !selectedChoice) return null;
  setBusy(true);
  ui.voteButton.classList.add("pulse");
  if (!guidedRunning) ui.transactionTheater.scrollIntoView({ behavior: "smooth", block: "start" });
  await wait(420 * currentPace());
  await animateVoteRequest(selectedChoice, tampered);
  let proofDigest = await makeProof(credential.secret, selectedChoice);
  if (tampered) proofDigest = `${proofDigest.slice(0, -1)}${proofDigest.endsWith("0") ? "1" : "0"}`;
  const result = await api(`/api/elections/${ELECTION_ID}/vote`, {
    method: "POST",
    body: JSON.stringify({
      choice: selectedChoice,
      credentialSecret: credential.secret,
      proofDigest,
      proofMode: "SIMULATED_ZK",
    }),
  });
  if (result.ok) {
    const credentials = getCredentials();
    credentials[selectedPassport].voted = true;
    setCredentials(credentials);
  }
  await animateVoteResult(result);
  await refresh();
  ui.voteButton.classList.remove("pulse");
  const messages = {
    ACCEPTED: ["Vote accepted", "The tally changed and the anonymous nullifier is now used."],
    CREDENTIAL_ALREADY_USED: ["Credential already used", "The repeated vote produced the same nullifier and was rejected."],
    INVALID_PROOF: ["Proof rejected", "The verifier detected a modified or ineligible proof."],
    ELECTION_CLOSED: ["Election closed", "No more ballots can be accepted."],
    SERVICE_UNAVAILABLE: ["Simulator result unknown", "The response was unavailable. Check the tally before retrying; this is not a Midnight network confirmation."],
  };
  const [title, detail] = messages[result.code] || ["Vote rejected", result.code || "Unknown contract response"];
  if (!quiet) toast(title, detail, result.ok ? "success" : "error");
  return result;
}

function chooseVote(choice) {
  selectedChoice = choice;
  document.querySelectorAll(".vote-option").forEach((button) => button.classList.toggle("selected", button.dataset.choice === choice));
  updateControlLock();
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function guidedDemo() {
  if (busy || guidedRunning) return;
  guidedRunning = true;
  updateControlLock();
  player.start(ui.demoPace.value);
  ui.guidedDemoButton.innerHTML = "<span>●</span> Playing animated demo…";
  try {
    const reset = await api("/api/demo/reset", { method: "POST", body: "{}" });
    if (!reset.ok) {
      setFlowStatus("DEMO SERVER OFFLINE", "rejected");
      toast("Demo server is offline", "Start it with npm start, then press the demo button again.", "error");
      throw new Error("Demo reset was not confirmed. No scripted steps were run.");
    }
    localStorage.removeItem(STORAGE_KEY);
    preparedCredentials.clear();
    resetInspector();
    selectedPassport = null;
    resetNfc();
    resetProtocolTheater(true);
    if (!await refresh()) throw new Error("Cannot read the reset election.");
    ui.transactionTheater.scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Animated demo started", "Follow the numbered graph from passport selection to public tally.");
    await player.checkpoint("1 / 10 · Read the first passport", "Simulate the NFC session, DG1 + SOD read and authenticity checks for DEMO-P001. A successful read does not prove current eligibility.");
    await selectPassport("DEMO-P001");
    player.record("P001 NFC walkthrough", await simulateNfcRead(), "SIMULATED_READ");
    await player.checkpoint("2 / 10 · Authority verifies and issues", "The mock authority checks validity, eligibility and prior issuance in one second. Only a commitment enters the simulated eligibility set; the secret stays with this device during issuance.");
    player.record("P001 credential", await issueCredential({ quiet: true }), "ISSUED");
    await player.checkpoint("3 / 10 · Cast YES", "Use P001’s credential to produce the simulated proof and one-time nullifier. Expected result: YES becomes 1. No real voting proof or network transaction runs here.");
    chooseVote("YES");
    player.record("P001 YES", await castSelectedVote({ quiet: true }), "ACCEPTED");
    await player.checkpoint("4 / 10 · Attempt a second vote", "The same secret in the same election must produce the same nullifier. The second vote must be rejected without changing the tally.");
    player.record("Double vote blocked", await castSelectedVote({ quiet: true }), "CREDENTIAL_ALREADY_USED");
    await player.checkpoint("5 / 10 · Try a copied app", "A fresh app secret does not create a fresh identity. The authority must refuse another credential for P001 in this election.");
    player.record("Copied app blocked", await issueCredential({ quiet: true, copiedApp: true }), "ALREADY_ISSUED");
    await player.checkpoint("6 / 10 · Read the second passport", "P002 is a separate fictional identity. Its local secret and credential will be independent of P001’s.");
    await selectPassport("DEMO-P002");
    player.record("P002 NFC walkthrough", await simulateNfcRead(), "SIMULATED_READ");
    await player.checkpoint("7 / 10 · Issue the second credential", "The authority checks P002 and issues once. Expected eligible credential count: 2.");
    player.record("P002 credential", await issueCredential({ quiet: true }), "ISSUED");
    await player.checkpoint("8 / 10 · Cast NO", "The second credential has a different nullifier. Expected result: NO becomes 1 and total votes becomes 2.");
    chooseVote("NO");
    player.record("P002 NO", await castSelectedVote({ quiet: true }), "ACCEPTED");
    await player.checkpoint("9 / 10 · Read the revoked passport", "P003 can still have readable, authentic-looking historical chip data. NFC alone does not reveal whether a government subsequently revoked it.");
    await selectPassport("DEMO-P003");
    player.record("P003 NFC walkthrough", await simulateNfcRead(), "SIMULATED_READ");
    await player.checkpoint("10 / 10 · Reject revoked document; check the tally", "The authority must return REVOKED, issue nothing and leave the tally at YES 1 / NO 1. The demo only declares success after checking those outcomes.");
    player.record("P003 rejected", await issueCredential({ quiet: true }), "REVOKED");
    if (!await refresh()) throw new Error("Final tally could not be read.");
    const correct = publicState.tally.YES === 1 && publicState.tally.NO === 1 && publicState.votesCast === 2 && publicState.eligibleCredentialCount === 2;
    player.record("Final tally 1–1; two credentials", { code: correct ? "VERIFIED" : "TALLY_MISMATCH" }, "VERIFIED");
    player.finish("Demo verified · YES 1 / NO 1", "Three fictional passports, two credentials, two accepted ballots. Duplicate issuance, duplicate voting and the revoked document were rejected. Results below are simulator assertions, not on-chain receipts.");
    toast("Demo complete: 3 → 2 → 2", "Two eligible credentials, two simulated ballots, verified tally 1–1.");
    if (document.getElementById("includeNetworkStep").checked) {
      document.getElementById("networkLab").scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Ready for the real-network step", "Check the network, connect and fund your wallet, then explicitly approve a self-transfer. The ballot remains simulated.");
    }
  } catch (error) {
    const stopped = error instanceof DemoStopped;
    player.finish(stopped ? "Demo stopped" : "Demo failed verification", stopped ? "Completed actions remain in the local simulator. Start again to reset and replay." : error.message);
    toast(stopped ? "Demo stopped" : "Demo interrupted", stopped ? "No further steps will run." : "An expected result was not confirmed. Review the persistent result list; success has not been assumed.", "error");
  } finally {
    setBusy(false);
    guidedRunning = false;
    updateControlLock();
    ui.guidedDemoButton.disabled = false;
    ui.demoPace.disabled = false;
    ui.guidedDemoButton.innerHTML = "<span>▶</span> Run full animated demo";
  }
}

ui.passportList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-passport]");
  if (card) manualAction(() => selectPassport(card.dataset.passport));
});
document.querySelectorAll(".vote-option").forEach((button) => button.addEventListener("click", () => manualAction(() => chooseVote(button.dataset.choice))));
ui.issueButton.addEventListener("click", () => manualAction(() => issueCredential()));
ui.copyAttackButton.addEventListener("click", () => manualAction(() => issueCredential({ copiedApp: true })));
ui.voteButton.addEventListener("click", () => manualAction(() => castSelectedVote()));
ui.nfcReadButton.addEventListener("click", () => manualAction(simulateNfcRead));
ui.tamperButton.addEventListener("click", () => manualAction(() => {
  if (!selectedChoice) chooseVote("YES");
  return castSelectedVote({ tampered: true });
}));
ui.guidedDemoButton.addEventListener("click", guidedDemo);
ui.resetButton.addEventListener("click", () => manualAction(async () => {
  const result = await api("/api/demo/reset", { method: "POST", body: "{}" });
  if (!result.ok) throw new Error("RESET_NOT_CONFIRMED");
  localStorage.removeItem(STORAGE_KEY);
  preparedCredentials.clear();
  resetInspector();
  selectedPassport = null;
  resetNfc();
  selectedChoice = null;
  resetProtocolTheater(true);
  player.results.replaceChildren();
  player.finish("A complete ballot, at your pace", "Run the guided demo or choose a fictional passport below.");
  ui.nfcReadStatus.textContent = "Optional learning step. Select a fictional passport first. No NFC hardware or real document is accessed.";
  await refresh();
  setBusy(false);
  toast("Demo reset", "Authority, device and public election state are clean.");
}));
ui.closeButton.addEventListener("click", () => manualAction(async () => {
  const result = await api(`/api/elections/${ELECTION_ID}/close`, { method: "POST", body: "{}" });
  if (!result.ok || result.status !== "CLOSED") throw new Error("CLOSE_NOT_CONFIRMED");
  renderPublic(result);
  toast("Election closed", "The final tally is now read-only.");
}));
ui.copyRoot.addEventListener("click", async () => {
  if (!publicState) return;
  await navigator.clipboard.writeText(publicState.eligibilityRoot);
  toast("Merkle root copied", "This is public election state—not passport data.");
});
ui.clearTrace.addEventListener("click", () => manualAction(() => resetProtocolTheater(true)));

refresh().catch(() => toast("Cannot reach the demo server", "Start it with npm start, then refresh this page.", "error"));
