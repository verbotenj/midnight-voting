import { copyFile, readFile, rename, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { initialize, showPublicAddresses, developmentEnvPath } from "./dev-wallets.js";

// Explicit one-time migration. No secret values are logged, and the original
// Preprod file is preserved byte-for-byte before replacing the active config.
const archive = fileURLToPath(new URL("../.env.preprod", import.meta.url));
const staging = fileURLToPath(new URL("../.env.preview", import.meta.url));
try {
  const existing = await showPublicAddresses(developmentEnvPath, false);
  if (existing.network === "preview") {
    console.log("Preview is already active. No wallets changed.");
    await showPublicAddresses();
  } else {
    if (existing.network !== "preprod") throw new Error("UNEXPECTED_SOURCE_NETWORK");
    // Refuse existing archive/staging paths, including symlinks.
    for (const path of [archive, staging]) {
      try { await lstat(path); throw new Error("DESTINATION_EXISTS"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const original = await readFile(developmentEnvPath);
    await copyFile(developmentEnvPath, archive, constants.COPYFILE_EXCL);
    if (!(await readFile(archive)).equals(original)) throw new Error("BACKUP_MISMATCH");
    await showPublicAddresses(archive, false);
    await initialize("preview", staging);
    await showPublicAddresses(staging, false);
    if (!(await readFile(developmentEnvPath)).equals(original)) throw new Error("SOURCE_CHANGED");
    await rename(staging, developmentEnvPath);
    console.log("Preview activated. Original Preprod wallets preserved in .env.preprod.");
    await showPublicAddresses();
  }
} catch {
  console.error("Migration stopped without printing secrets. Inspect local file permissions and migration state; existing backup files are never overwritten.");
  process.exitCode = 1;
}
