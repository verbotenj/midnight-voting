const display = (id, value) => {
  document.getElementById(id).textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

let activeBoundary = "local";
export function highlightBoundary(kind, message) {
  activeBoundary = kind;
  display("payloadBoundaryStatus", message);
  document.querySelectorAll("[data-payload-target]").forEach(button => {
    if (button.dataset.payloadTarget === kind) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
}

export function initializeInspector() {
  const openBoundary = kind => {
    document.getElementById("payloadInspector").open = true;
    const panel = document.querySelector(`[data-payload-panel="${kind}"]`);
    panel.open = true;
    panel.querySelector("summary").focus({ preventScroll: true });
    panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  };
  document.getElementById("viewPayloads").addEventListener("click", () => openBoundary(activeBoundary));
  document.querySelectorAll("[data-payload-target]").forEach(button => {
    button.addEventListener("click", () => openBoundary(button.dataset.payloadTarget));
  });
}

// Keep private values out of the inspector DOM and retained screenshots.
export function displayRequest(body) {
  const safe = { ...body };
  if (Object.hasOwn(safe, "credentialSecret")) safe.credentialSecret = "<redacted in UI; SENT to local simulator>";
  return safe;
}

export function inspectRequest(path, body) {
  const kind = path.endsWith("/credential") ? "authority" : path.endsWith("/vote") ? "vote" : null;
  if (!kind) return null;
  highlightBoundary(kind, kind === "authority" ? "Sending document ID + commitment to the local authority. Secret stays on device." : "Sending to the local vote simulator. WARNING: this request includes the secret; it is not ZK.");
  display(`${kind}PayloadMeta`, `POST ${path} · awaiting response`);
  display(`${kind}Request`, displayRequest(body));
  display(`${kind}Response`, "Waiting for response…");
  return {
    received(status, response) {
      highlightBoundary(kind, `${kind === "authority" ? "Authority" : "Vote simulator"} response · HTTP ${status} · ${response.code || "received"}. Inspect the exact JSON below.`);
      display(`${kind}PayloadMeta`, `POST ${path} · HTTP ${status}`);
      display(`${kind}Response`, response);
    },
    unavailable() {
      highlightBoundary(kind, "Response unavailable. Outcome unknown; inspect state before retrying.");
      display(`${kind}PayloadMeta`, `POST ${path} · outcome unknown`);
      display(`${kind}Response`, "No confirmed response. The request might have reached the server; do not assume it failed before processing.");
    },
  };
}

export const inspectLocal = value => {
  highlightBoundary("local", value.credential ? "Secret + commitment prepared locally. No request sent by the NFC animation; authority authorization is separate." : "Reading fictional document data on the device. Nothing sent to an API or Midnight.");
  display("localPayload", value);
};
export const inspectPublic = value => display("publicPayload", value);
export function resetInspector() {
  highlightBoundary("local", "Select a passport to begin. Nothing sent yet.");
  document.querySelectorAll("[data-payload-target]").forEach(button => button.removeAttribute("aria-current"));
  display("localPayload", "No local read yet.");
  for (const kind of ["authority", "vote"]) {
    display(`${kind}PayloadMeta`, "No request sent.");
    display(`${kind}Request`, "No request yet.");
    display(`${kind}Response`, "No response yet.");
  }
}
