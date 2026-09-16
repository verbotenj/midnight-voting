// Read-only teaching data. Never read credentials, storage, or an API response.
// These are selected conceptual fields, not serialized SDK transactions.
export const PRIVACY_VIEWS = {
  voter: {
    label: "Voter device", kicker: "PRIVATE INPUTS", title: "Your identity is not your ballot.",
    description: "The voter prepares an election-specific secret and chooses a ballot. In the real Compact path, the secret and Merkle membership path are private proof inputs—not public ledger fields.",
    fields: [
      ["Document", "DEMO-P001", "Fictional identity used for eligibility"],
      ["Credential secret", "<private witness>", "Never displayed by this lens"],
      ["Membership path", "<private witness>", "Proves membership without publishing which leaf"],
      ["Ballot choice", "YES", "Known locally; disclosed on-chain in this POC"],
    ],
    boundary: "Private from the chain does not mean private from the prover.",
    caveat: "The real development flow gives private witnesses to a trusted local prover. It runs on a shared development machine, not an independently secured voter device.",
  },
  authority: {
    label: "Passport authority", kicker: "IDENTITY BOUNDARY", title: "One identity. One entitlement.",
    description: "The off-chain authority checks document status, election eligibility and prior issuance. It retains the identity-to-commitment association; it does not need the credential secret to enroll that commitment.",
    fields: [
      ["Document", "DEMO-P001", "Only a fictional fixture in this POC"],
      ["Election", "ELECTION-DEMO-2026-001", "Issuance is scoped to one election"],
      ["Authority decision", "VALID · ELIGIBLE · ISSUED", "A second request is refused"],
      ["Credential commitment", "<public commitment>", "Stored with issuance; enrolled on-chain"],
    ],
    boundary: "No ballot choice is needed in the issuance request.",
    caveat: "That is a data-flow boundary, not a guarantee against correlation. The authority can also observe public votes and timing. A passport chip alone cannot establish current document status.",
  },
  public: {
    label: "Public chain", kicker: "PUBLICLY DISCLOSED", title: "Verify a right. Not a passport.",
    description: "The Compact vote circuit checks membership and a fresh nullifier. Its public record omits passport fields, the credential secret and the private membership path. It does not make this POC a secret-ballot system.",
    fields: [
      ["Election", "ELECTION-DEMO-2026-001", "Encoded as Bytes<32> in the contract"],
      ["Eligibility", "<public root + commitments>", "The eligibility tree is public"],
      ["Voting nullifier", "<public one-time value>", "Reuse is rejected for this election instance"],
      ["Ballot choice", "YES · public", "The circuit explicitly discloses the choice"],
      ["Tally change", "YES +1", "The live counter also reveals the choice"],
    ],
    boundary: "No passport field on-chain ≠ end-to-end anonymity.",
    caveat: "Wallet metadata, timing, small voter sets and the shared development host can link activity. This lens shows selected application fields, not every transaction field or proof of anonymity.",
  },
};

export function initializePrivacyLens() {
  const section = document.getElementById("privacyLens");
  const buttons = [...section.querySelectorAll("[data-privacy-view]")];
  function select(view) {
    const data = PRIVACY_VIEWS[view];
    section.dataset.view = view;
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.privacyView === view));
    for (const key of ["kicker", "title", "description", "boundary", "caveat"]) {
      section.querySelector(`[data-lens="${key}"]`).textContent = data[key];
    }
    const fields = data.fields.map(([name, value, explanation]) => {
      const row = document.createElement("div");
      const label = document.createElement("dt"); label.textContent = name;
      const content = document.createElement("dd");
      const code = document.createElement("code"); code.textContent = value;
      const help = document.createElement("span"); help.textContent = explanation;
      content.append(code, help); row.append(label, content);
      return row;
    });
    document.getElementById("privacyFields").replaceChildren(...fields);
    document.getElementById("privacyAnnouncement").textContent = `Viewing ${data.label}. ${data.title}`;
  }
  for (const button of buttons) button.addEventListener("click", () => select(button.dataset.privacyView));
  select("public");
}
