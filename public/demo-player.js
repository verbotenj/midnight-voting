// Checkpoints are outside actions: stopping never cancels an in-flight mutation.
export class DemoStopped extends Error {}

export class DemoPlayer {
  constructor({ next, pause, stop, title, detail, results }) {
    Object.assign(this, { next, pause, stop, title, detail, results });
    next.addEventListener("click", () => this.release?.());
    pause.addEventListener("click", () => {
      this.paused = !this.paused;
      pause.textContent = this.paused ? "Resume autoplay" : "Pause after step";
      if (this.paused) this.cancelTimer?.();
      else this.release?.();
    });
    stop.addEventListener("click", () => {
      this.stopped = true;
      stop.disabled = true;
      detail.textContent = "Stopping after the current action. Already recorded results are kept; no transaction is cancelled or retried.";
      this.release?.();
    });
  }

  start(mode) {
    this.mode = mode;
    this.paused = mode === "step";
    this.stopped = false;
    this.results.replaceChildren();
    this.pause.disabled = mode === "step";
    this.pause.textContent = "Pause after step";
    this.stop.disabled = false;
  }

  async checkpoint(title, detail) {
    if (this.stopped) throw new DemoStopped();
    this.title.textContent = title;
    this.detail.textContent = detail;
    this.next.disabled = false;
    await new Promise(resolve => {
      let timer;
      this.cancelTimer = () => clearTimeout(timer);
      this.release = () => { clearTimeout(timer); resolve(); };
      // Reading time is separate from motion: reduced-motion must not rush text.
      if (!this.paused) timer = setTimeout(this.release, this.mode === "1" ? 2000 : 6000);
    });
    this.release = null;
    this.cancelTimer = null;
    this.next.disabled = true;
    if (this.stopped) throw new DemoStopped();
  }

  record(label, result, expected) {
    const passed = result?.code === expected;
    const row = document.createElement("li");
    row.dataset.result = passed ? "pass" : "fail";
    row.textContent = `${passed ? "PASS" : "FAIL"} · ${label} · ${result?.code || "NO_RESULT"}`;
    this.results.append(row);
    if (!passed) throw new Error(`${label}: expected ${expected}, received ${result?.code || "NO_RESULT"}.`);
  }

  finish(title, detail) {
    this.title.textContent = title;
    this.detail.textContent = detail;
    this.cancelTimer?.();
    this.next.disabled = this.pause.disabled = this.stop.disabled = true;
  }
}
