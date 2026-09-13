import { inspectPreview } from "../lib/preview-inspection.js";
try { console.log(JSON.stringify(await inspectPreview(), null, 2)); }
catch { console.error("PREVIEW_INSPECTION_FAILED: no successful audit is claimed; inspect the network and saved receipt scope."); process.exitCode = 1; }
