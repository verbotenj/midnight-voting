import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, mkdir, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { lockPreviewOperation } from "../lib/preview-store.js";

const project = fileURLToPath(new URL("../", import.meta.url));
const compiler = join(project, ".local/toolchain/compactc-0.31.1/compactc");
const source = join(project, "compact/Voting.compact");
const output = join(project, "compact/managed/voting");
const sha256 = data => createHash("sha256").update(data).digest("hex");

async function hashes(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(path));
    else if (entry.isFile() && entry.name !== "artifact-manifest.json") result[relative(output, path)] = sha256(await readFile(path));
    else if (!entry.isFile()) throw new Error("UNEXPECTED_ARTIFACT_ENTRY");
  }
  return result;
}

let release;
try {
  const version = execFileSync(compiler, ["--version"], { encoding: "utf8" }).trim();
  if (version !== "0.31.1") throw new Error("PREVIEW_COMPILER_VERSION_MISMATCH");
  if (process.argv.includes("--verify")) {
    const manifest = JSON.parse(await readFile(join(output, "artifact-manifest.json"), "utf8"));
    if (manifest.compiler !== version || manifest.sourceSha256 !== sha256(await readFile(source))) throw new Error("SOURCE_OR_COMPILER_CHANGED_RECOMPILE");
    const actual = await hashes(output);
    if (Object.keys(actual).length !== Object.keys(manifest.files).length || Object.entries(actual).some(([file, hash]) => manifest.files[file] !== hash)) throw new Error("GENERATED_ARTIFACTS_CHANGED_RECOMPILE");
    console.log("Voting source, compiler and every generated artifact match the build manifest.");
  } else {
    // Never replace keys while a known contract operation is using them.
    release = await lockPreviewOperation();
    await mkdir(output, { recursive: true });
    execFileSync(compiler, [source, output], { stdio: "inherit" }); // full key generation, never --skip-zk
    for (const circuit of ["enroll", "openVoting", "vote", "closeElection"]) {
      for (const file of [`keys/${circuit}.prover`, `keys/${circuit}.verifier`, `zkir/${circuit}.bzkir`]) {
        if ((await lstat(join(output, file))).size === 0) throw new Error("MISSING_PROVING_ARTIFACT");
      }
    }
    await writeFile(join(output, "artifact-manifest.json"), JSON.stringify({
      compiler: version, runtime: "0.16.0", networkTarget: "preview", builtAt: new Date().toISOString(),
      sourceSha256: sha256(await readFile(source)), files: await hashes(output),
    }, null, 2));
    console.log("Full Compact compile complete; source/artifact hashes saved.");
  }
} catch (error) {
  console.error(error.code === "ENOENT" ? "Pinned compiler/artifacts missing. See docs/PREVIEW-RUNBOOK.md for setup." : error.message);
  process.exitCode = 1;
} finally {
  if (release) await release();
}
