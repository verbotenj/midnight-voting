// Separate URL-addressable views; keep the local walkthrough and inspector state
// alive when readers visit another page. Navigation never starts an API action.
const routes = {
  "/": ["demo", "A ballot, one step at a time.", "Three fictional passports. Two eligible voters. You control every step."],
  "/learn": ["learn", "Understand the system.", "Passport reading, eligibility and zero-knowledge proofs—separate from the animation."],
  "/privacy": ["privacy", "Who can see what?", "Explore the privacy boundary—and the limits. No wallet or passport needed."],
  "/developer": ["developer", "Inspect the boundaries.", "Manual simulator controls, request shapes and public state. No real chain transactions here."],
  "/preview": ["preview", "Check the real chain.", "Recorded elections and explicitly approved test-network operations. Separate from the demo."],
};
const legacy = { previewBallot: "/preview", networkLab: "/preview", nfcOverview: "/learn", chainOverview: "/learn", zkExplainer: "/learn", payloadInspector: "/developer" };
let views, theater;

export function navigatePage(path, { push = true, focus = true } = {}) {
  const url = new URL(path, location.origin);
  const route = legacy[url.hash.slice(1)] || (routes[url.pathname] ? url.pathname : "/");
  if (push && location.pathname + location.hash !== route + url.hash) history.pushState({}, "", route + url.hash);
  const [name, title] = routes[route];
  document.body.dataset.page = name;
  for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
  // Shared animation nodes retain in-flight animations and event listeners.
  const host = name === "developer" ? views.developer : views.demo;
  if (theater.parentElement !== host) host.insertBefore(theater, host.children[1] || null);
  document.querySelectorAll(".page-nav a").forEach(link => {
    if (link.getAttribute("href") === route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.getElementById("resetButton").hidden = !["demo", "developer"].includes(name);
  document.title = `${name === "demo" ? "Demo" : title} — Private Ballot`;
  if (focus) {
    views[name].querySelector("h1").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

export function initializePages() {
  const main = document.querySelector("main");
  views = {};
  for (const [name, title, subtitle] of Object.values(routes)) {
    const view = document.createElement("div");
    view.className = "page-view";
    view.id = `${name}Page`;
    view.hidden = true;
    const header = document.createElement("header");
    header.className = "page-heading";
    const heading = document.createElement("h1");
    heading.tabIndex = -1;
    heading.textContent = title;
    const description = document.createElement("p");
    description.textContent = subtitle;
    header.append(heading, description);
    view.append(header);
    views[name] = view;
  }
  main.append(...Object.values(views));
  theater = document.getElementById("transactionTheater");
  views.demo.append(theater);
  const player = document.getElementById("demoPlayer");
  player.dataset.scene = "nfc";
  document.getElementById("demoStepTitle").textContent = "1 / 10 · Read the first passport";
  document.getElementById("demoStepDetail").textContent = "Start the walkthrough, then run each step when you’re ready. Nothing advances automatically.";
  const note = document.createElement("p");
  note.className = "demo-disclaimer";
  note.textContent = "Simulation only · no hardware NFC or real ZK proof. On-chain choices in this POC are public; full anonymity is not demonstrated.";
  views.demo.append(note);
  const more = document.createElement("a");
  more.href = "/learn";
  more.dataset.pageLink = "";
  more.className = "demo-learn-link";
  more.textContent = "Want the explanation? Visit Learn →";
  views.demo.append(more);
  const lensLink = document.createElement("a");
  lensLink.href = "/privacy";
  lensLink.dataset.pageLink = "";
  lensLink.className = "demo-learn-link";
  lensLink.textContent = "New · try the Privacy lens →";
  views.demo.append(lensLink);
  views.privacy.append(document.getElementById("privacyLens"));
  for (const id of ["nfcOverview", "chainOverview", "zkExplainer"]) views.learn.append(document.getElementById(id));
  views.developer.append(document.getElementById("developerElection"));
  for (const selector of [".workspace", ".payload-follow", ".payload-boundaries", "#payloadInspector", ".protocol-ticker", ".ledger-section"]) {
    views.developer.append(document.querySelector(selector));
  }
  for (const id of ["previewBallot", "networkLab"]) views.preview.append(document.getElementById(id));
  document.addEventListener("click", event => {
    const link = event.target.closest("a[data-page-link]");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigatePage(link.getAttribute("href"));
  });
  window.addEventListener("popstate", () => navigatePage(location.href, { push: false }));
  window.addEventListener("hashchange", () => navigatePage(location.href, { push: false }));
  navigatePage(location.href, { push: false, focus: false });
}
