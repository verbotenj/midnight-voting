import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { inspectPreview } from "./preview-inspection.js";
import { createPreviewActor } from "./preview-actors.js";
import { lockPreviewOperation } from "./preview-store.js";
import { createPreviewService } from "./preview-service.js";

export function createLivePreviewService(enabled) {
  return createPreviewService({ inspect: inspectPreview, enabled,
    async openActors(onProgress) {
      const release = await lockPreviewOperation();
      const actors = [];
      try {
        await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../scripts/compile-voting.js", import.meta.url)), "--verify"]);
        const authority = createPreviewActor("authority", onProgress); actors.push(authority);
        const voter = createPreviewActor("voter", onProgress); actors.push(voter);
        await Promise.all(actors.map(actor => actor.ready));
        return { authority, voter, async stop() { await Promise.all(actors.map(actor => actor.stop())); await release(); } };
      } catch (error) {
        await Promise.all(actors.map(actor => actor.stop()));
        await release();
        throw error;
      }
    },
  });
}
