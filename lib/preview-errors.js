import { Cause, Option, Runtime } from "effect";

// Effect's Promise rejection hides the underlying SDK/RPC error behind a symbol.
// Read only messages/cause links, never txData, witnesses, keys or whole objects.
export function previewErrorMessage(error) {
  const messages = [], seen = new Set();
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) return;
    seen.add(value);
    if (typeof value.message === "string" && !messages.includes(value.message)) messages.push(value.message);
    const effectCause = value[Runtime.FiberFailureCauseId];
    if (effectCause) {
      const failure = Cause.failureOption(effectCause);
      if (Option.isSome(failure)) visit(failure.value, depth + 1);
    }
    visit(value.cause, depth + 1);
  };
  visit(error);
  return (messages.join(" · ") || "UNKNOWN_PREVIEW_ERROR").replace(/[a-f0-9]{32,}/gi, "[redacted]").slice(0, 1000);
}

export const isDefiniteInvalidTransaction = error => /1010|Invalid.?Transaction|invalid proof|VerificationError/i.test(previewErrorMessage(error));
