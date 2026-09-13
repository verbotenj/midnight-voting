import test from "node:test";
import assert from "node:assert/strict";
import { Data, Effect } from "effect";
import { previewErrorMessage, isDefiniteInvalidTransaction } from "../lib/preview-errors.js";

class SubmissionError extends Data.TaggedError("SubmissionError") {}
const rejection = async cause => {
  try { await Effect.runPromise(Effect.fail(new SubmissionError({ message: "Transaction submission error", cause }))); }
  catch (error) { return error; }
};
test("Preview errors unwrap SDK RPC causes without leaking transaction or secret fields", async () => {
  const inner = new SubmissionError({ message: "Transaction submission failed", txData: "DO_NOT_LOG", secret: "DO_NOT_LOG",
    cause: new Error(`1010: Invalid Transaction: ${"a".repeat(64)}`) });
  const error = await rejection(inner);
  assert.equal(error.message, "Transaction submission error");
  assert.equal(isDefiniteInvalidTransaction(error), true);
  assert.match(previewErrorMessage(error), /1010: Invalid Transaction: \[redacted\]/);
  assert.equal(previewErrorMessage(error).includes("DO_NOT_LOG"), false);
});
test("Preview transport failures do not count as proof rejection", async () => {
  for (const cause of [new Error("Socket disconnected"), new Error("Timeout"), new Error("503 service unavailable")]) {
    assert.equal(isDefiniteInvalidTransaction(await rejection(cause)), false);
  }
});
