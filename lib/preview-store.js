import { mkdir, open, lstat, unlink, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { selectedPreview, previewSharedDirectory, previewElectionDirectories } from "./preview-config.js";

export const previewDirectory = selectedPreview.directory;
// Wallets and proving artifacts are shared across elections. Hold this lock for
// the whole wallet session (including sync), not just while broadcasting.
export async function lockPreviewOperation() {
  const shared = await createPreviewStore(previewSharedDirectory);
  const release = await shared.lock("operation-lock.json");
  try {
    for (const directory of previewElectionDirectories) {
      try { await lstat(join(directory, "operation-lock.json")); throw new Error("LEGACY_PREVIEW_OPERATION_ACTIVE"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return release;
  } catch (error) { await release(); throw error; }
}
export async function createPreviewStore(directory = previewDirectory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error("UNSAFE_PREVIEW_DIRECTORY");
  const path = name => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error("INVALID_STORE_NAME");
    return join(directory, name);
  };
  const exists = async name => {
    try { await lstat(path(name)); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  };
  const read = async name => {
    const file = await open(path(name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (stat.mode & 0o077)) throw new Error("UNSAFE_PREVIEW_FILE");
      return JSON.parse(await file.readFile("utf8"));
    } finally { await file.close(); }
  };
  const create = async (name, value) => {
    const file = await open(path(name), "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); } finally { await file.close(); }
    const dir = await open(directory, "r");
    try { await dir.sync(); } finally { await dir.close(); }
  };
  const lock = async name => {
    await create(name, { pid: process.pid, startedAt: new Date().toISOString() });
    return async () => { await unlink(path(name)); };
  };
  const issuanceFiles = async passport => {
    if (!/^DEMO-P00[123]$/.test(passport)) throw new Error("INVALID_DEMO_PASSPORT");
    return (await readdir(directory)).filter(name => new RegExp(`^issuance-[a-f0-9]{64}-${passport}\\.json$`).test(name));
  };
  return { directory, path, exists, read, create, lock, issuanceFiles };
}
