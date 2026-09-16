import { HOSTING_PLATFORM } from "./runtime.js";

export function initializeHostedDemo() {
  document.body.dataset.hostedDemo = "true";
  const banner = document.createElement("p");
  banner.className = "hosted-notice";
  banner.textContent = "Public simulation · fictional passports only · your browser has its own demo session. " + (HOSTING_PLATFORM === "cloudflare" ? "Demo state is stored temporarily and expires after one hour idle. No wallet or real passport data belongs here." : "The free server may take a minute to wake up. Sessions reset after restart or one hour idle.");
  document.querySelector("main").prepend(banner);
  const preview = document.getElementById("previewPage");
  preview.querySelector("h1").textContent = "Real chain evidence, kept separate.";
  preview.querySelector(".page-heading p").textContent = "This hosted app cannot connect a wallet, run a prover, or submit a Midnight transaction.";
  document.getElementById("previewBallot").remove();
  document.getElementById("networkLab").remove();
  const info = document.createElement("section");
  info.className = "learn-section";
  const heading = document.createElement("h2");
  heading.textContent = "Two recorded Preview elections. Both closed at YES 1 / NO 1.";
  const text = document.createElement("p");
  text.textContent = "Recorded September 12–13, 2026 on a separate local development machine. These are historical results, not a live network check. Public vote choices and timing remain privacy limitations.";
  const link = document.createElement("a");
  link.href = "https://github.com/verbotenj/midnight-voting/blob/main/docs/PREVIEW-RUNBOOK.md";
  link.textContent = "View contract addresses and transaction receipts on GitHub →";
  info.append(heading, text, link);
  preview.append(info);
  document.querySelector(".demo-disclaimer").textContent = "Simulation only · no hardware NFC, ZK proofs or blockchain submissions. The backend can link fictional identities and votes. One-issuance rules apply within your browser’s demo session, not across independent visitors.";
}
