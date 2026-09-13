import { fileURLToPath } from "node:url";

// Explicitly approved elections only. One fixed directory per election prevents
// a second deployment/directory from bypassing the issuer's uniqueness journal.
const directories = Object.freeze({
  "ELECTION-DEMO-2026-001": "preview-voting",
  "ELECTION-DEMO-2026-002": "preview-voting-002",
});
export function previewConfig(electionId = "ELECTION-DEMO-2026-001") {
  if (!Object.hasOwn(directories, electionId)) throw new Error("UNAPPROVED_PREVIEW_ELECTION");
  return Object.freeze({ electionId, directory: fileURLToPath(new URL(`../.local/${directories[electionId]}/`, import.meta.url)) });
}
export const selectedPreview = previewConfig(process.env.MIDNIGHT_ELECTION_ID);
export const previewElectionDirectories = Object.keys(directories).map(id => previewConfig(id).directory);
export const previewSharedDirectory = fileURLToPath(new URL("../.local/preview-shared/", import.meta.url));
