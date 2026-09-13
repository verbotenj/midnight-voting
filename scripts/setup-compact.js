import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Pinned official compactc 0.31.1 release assets. These public archive digests
// were checked against github.com/midnightntwrk/compact release metadata.
const assets = {
  "darwin-arm64": ["aarch64-darwin", "57af9b0449aa96b2905ea3d7a175b6b42ab38d725612a9cb2d73eb4ef253cce2"],
  "darwin-x64": ["x86_64-darwin", "eebae2d04b1ec05fe07d06398e36d78e60cf4927ddbc0dae7d5f5ebb9ac6721c"],
  "linux-arm64": ["aarch64-unknown-linux-musl", "7c7e38581808779d2671687c3378017bcf2fb3111a192fd1253f3472012df549"],
  "linux-x64": ["x86_64-unknown-linux-musl", "e291b4bab4d4e857707008f8b1c25c2b8e0c843f6c737d0ee6c0d9ac69a6bbfb"],
};
const asset = assets[`${process.platform}-${process.arch}`];
if (!asset) throw new Error("UNSUPPORTED_COMPACT_PLATFORM_USE_LINUX_OR_MACOS");
const root = fileURLToPath(new URL("../.local/toolchain/", import.meta.url));
const destination = join(root, "compactc-0.31.1");
const compiler = join(destination, "compactc");
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const checkVersion = path => {
  if (execFileSync(path, ["--version"], { encoding: "utf8" }).trim() !== "0.31.1") throw new Error("PINNED_COMPACT_VERSION_MISMATCH");
};
if (await exists(destination)) {
  const stat = await lstat(destination);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("UNSAFE_COMPILER_DIRECTORY");
  checkVersion(compiler);
  console.log("Existing Compact 0.31.1 preserved; no download or replacement.");
} else {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stage = await mkdtemp(join(root, "compact-download-"));
  const archive = join(stage, "compiler.zip");
  const response = await fetch(`https://github.com/midnightntwrk/compact/releases/download/compactc-v0.31.1/compactc_v0.31.1_${asset[0]}.zip`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`COMPACT_DOWNLOAD_FAILED_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== asset[1]) throw new Error("COMPACT_ARCHIVE_DIGEST_MISMATCH");
  await writeFile(archive, bytes, { flag: "wx", mode: 0o600 });
  const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
  if (entries.some(entry => entry.startsWith("/") || entry.split("/").includes(".."))) throw new Error("UNSAFE_ARCHIVE_PATH");
  const extracted = join(stage, "extracted");
  await mkdir(extracted, { mode: 0o700 });
  execFileSync("unzip", ["-q", archive, "-d", extracted]);
  checkVersion(join(extracted, "compactc"));
  if (await exists(destination)) throw new Error("COMPILER_CREATED_CONCURRENTLY_NO_OVERWRITE");
  await rename(extracted, destination);
  console.log("Installed checksum-verified Compact 0.31.1. No keys or wallet state were changed.");
}
