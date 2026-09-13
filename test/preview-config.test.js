import test from "node:test";
import assert from "node:assert/strict";
import { previewConfig } from "../lib/preview-config.js";

test("approved elections have stable, isolated storage and preserve the original default", () => {
  const original = previewConfig();
  assert.equal(original.electionId, "ELECTION-DEMO-2026-001");
  assert.match(original.directory, /\/\.local\/preview-voting\/$/);
  const next = previewConfig("ELECTION-DEMO-2026-002");
  assert.match(next.directory, /\/\.local\/preview-voting-002\/$/);
  assert.notEqual(next.directory, original.directory);
  for (const invalid of ["", "../../preview-voting", "ELECTION-DEMO-2026-003", "__proto__", null]) {
    assert.throws(() => previewConfig(invalid), /UNAPPROVED_PREVIEW_ELECTION/);
  }
});
