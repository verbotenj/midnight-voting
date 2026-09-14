// Checkpoints are outside actions: stopping never cancels an in-flight mutation.
export class DemoStopped extends Error {}

export class DemoPlayer {
  constructor({ next, stop, title, detail, results }) {
    Object.assign(this, { next, stop, title, detail, results });
    next.addEventListener("click", () => this.release?.());
    stop.addEventListener("click", () => {
      this.stopped = true;
      stop.disabled = true;
      detail.textContent = "Stopping after the current action. Already recorded results are kept; no transaction is cancelled or retried.";
      this.release?.();
    });
  }

  start() {
    this.stopped = false;
    this.results.replaceChildren();
    this.results.closest("details").open = false;
    document.getElementById("demoOutcome").textContent = "";
    this.next.hidden = false;
    this.stop.hidden = false;
    this.stop.disabled = false;
  }

  async checkpoint(title, detail) {
    if (this.stopped) throw new DemoStopped();
    this.title.textContent = title;
    this.detail.textContent = detail;
    const step = Number.parseInt(title, 10);
    document.getElementById("demoPlayer").dataset.scene = [1, 6, 9].includes(step) ? "nfc" : "network";
    const passport = { 1: "DEMO-P001", 6: "DEMO-P002", 9: "DEMO-P003" }[step];
    if (passport) document.getElementById("nfcPassportLabel").textContent = passport;
    this.next.textContent = "Run this step →";
    this.next.disabled = false;
    await new Promise(resolve => {
      this.release = resolve;
    });
    this.release = null;
    this.next.disabled = true;
    this.next.textContent = "Animating…";
    if (this.stopped) throw new DemoStopped();
  }

  record(label, result, expected) {
    const passed = result?.code === expected;
    const row = document.createElement("li");
    row.dataset.result = passed ? "pass" : "fail";
    row.textContent = `${passed ? "PASS" : "FAIL"} · ${label} · ${result?.code || "NO_RESULT"}`;
    this.results.append(row);
    document.getElementById("demoOutcome").textContent = row.textContent;
    if (!passed) this.results.closest("details").open = true;
    if (!passed) throw new Error(`${label}: expected ${expected}, received ${result?.code || "NO_RESULT"}.`);
  }

  finish(title, detail) {
    this.title.textContent = title;
    this.detail.textContent = detail;
    this.next.disabled = this.stop.disabled = true;
    this.next.hidden = true;
    this.stop.hidden = true;
  }
}
