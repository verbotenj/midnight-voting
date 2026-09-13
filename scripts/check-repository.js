import { execFileSync } from "node:child_process";

// Scan exactly Git's staged/tracked snapshot, not ignored wallet stores. Reports
// filenames only, never matching secret values. Additional local secret matching
// is performed before initial publication; this guard is not a full DLP scanner.
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
if (!files.length) throw new Error("NO_TRACKED_SOURCE_TO_CHECK");
const forbidden = /(^|\/)(\.local|node_modules|playwright-report|test-results|coverage)(\/|$)|^compact\/managed\/|(^|\/)\.env(?:\..*)?$|\.(?:pem|key|p12|pfx|seed|sqlite\w*|db|log|zip|tgz)$/i;
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /^MIDNIGHT_\w*SEED\w*\s*=\s*[a-f0-9]{64,}\s*$/im,
];
const failures = [];
for (const file of files) {
  if (file !== ".env.example" && forbidden.test(file)) { failures.push(`${file}: excluded artifact/private path`); continue; }
  const content = execFileSync("git", ["show", `:${file}`], { maxBuffer: 8 * 1024 * 1024 });
  if (content.length > 2 * 1024 * 1024) failures.push(`${file}: unexpectedly large source file`);
  if (credentialPatterns.some(pattern => pattern.test(content.toString("utf8")))) failures.push(`${file}: possible credential`);
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log(`Repository hygiene passed for ${files.length} staged/tracked files; no excluded paths or recognized credential patterns.`);
