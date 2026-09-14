// Read-only pre-publication audit. Reports counts/paths, never secret values.
// This is a focused guardrail, not a guarantee or a substitute for code review.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...options });
const secrets = new Set();
for (const name of [".env.development", ".env.preprod"]) {
  if (!existsSync(name)) continue;
  for (const line of readFileSync(name, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z_0-9]*(?:SEED|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z_0-9]*)\s*=\s*["']?([^"'\s#]+)["']?\s*$/);
    if (match && match[2].length >= 20) secrets.add(match[2]);
  }
}
function collect(value, key = "") {
  if (typeof value === "string" && /secret|seed|mnemonic|privatekey/i.test(key) && value.length >= 20) secrets.add(value);
  else if (value && typeof value === "object") for (const [child, data] of Object.entries(value)) collect(data, child);
}
for (const dir of [".local/preview-voting", ".local/preview-voting-002"]) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (/^(authority-private|voter-credential-.*)\.json$/.test(name)) collect(JSON.parse(readFileSync(join(dir, name), "utf8")));
  }
}
const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{40,}\b/, /^MIDNIGHT_\w*SEED\w*\s*=\s*[a-f0-9]{64,}\s*$/im];
function scan(content, label) {
  if (patterns.some(pattern => pattern.test(content)) || [...secrets].some(secret => content.includes(secret))) throw new Error(`Possible secret in ${label}; investigate privately before publishing.`);
}
const privatePath = /(^|\/)(\.local|\.wrangler|node_modules|test-results|playwright-report)(\/|$)|^compact\/managed\/|(^|\/)(\.env|\.dev\.vars)(?:\..*)?$|\.(?:pem|key|seed|sqlite\w*|db|log)$/i;
const objects = run("git", ["rev-list", "--objects", "--all"]).trim().split("\n");
for (const object of objects) {
  const path = object.slice(object.indexOf(" ") + 1);
  if (object.includes(" ") && path !== ".env.example" && privatePath.test(path)) throw new Error(`Private path in history: ${path}`);
}
const ids = objects.map(line => line.split(" ")[0]);
const types = run("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], { input: ids.join("\n") + "\n" });
let blobs = 0;
for (const line of types.trim().split("\n")) {
  const [id, type] = line.split(" ");
  if (type === "blob") { scan(run("git", ["cat-file", "blob", id]), `Git blob ${id}`); blobs++; }
}
const tracked = run("git", ["ls-files", "-z"]).split("\0").filter(Boolean);
for (const path of tracked) scan(readFileSync(path, "utf8"), path);
// The Cloudflare dry-run bundle is ignored, but it is the actual deployment
// payload. Check it and its source map against the same known local secrets.
for (const path of [".local/cloudflare-build/worker.js", ".local/cloudflare-build/worker.js.map"]) {
  if (existsSync(path)) scan(readFileSync(path, "utf8"), path);
}
let logs = 0;
if (process.argv.includes("--github")) {
  const runs = JSON.parse(run("gh", ["api", "repos/verbotenj/midnight-voting/actions/runs?per_page=100"]));
  if (runs.total_count > 100) throw new Error("Paginate Actions history before publishing.");
  const artifacts = JSON.parse(run("gh", ["api", "repos/verbotenj/midnight-voting/actions/artifacts"]));
  if (artifacts.total_count) throw new Error("Review Actions artifacts before publishing.");
  for (const item of runs.workflow_runs) {
    if (item.status !== "completed") throw new Error("Wait for the running Actions workflow before auditing its log.");
    scan(run("gh", ["run", "view", String(item.id), "--repo", "verbotenj/midnight-voting", "--log"]), `Actions log ${item.id}`);
    logs++;
  }
}
console.log(`Publication audit passed: ${blobs} history blobs, ${tracked.length} working files, ${secrets.size} known local secrets compared, ${logs} Actions logs reviewed. No detected matches.`);
