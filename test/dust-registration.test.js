import test from "node:test";
import assert from "node:assert/strict";
import { formatUnits, selectRegistrationCoins } from "../lib/dust-registration.js";

test("NIGHT and DUST amounts preserve integer precision", () => {
  assert.equal(formatUnits(5_000_000_000n, 6), "5000.000000");
  assert.equal(formatUnits(405083000000n, 15), "0.000405083000000");
  assert.equal(formatUnits(1n, 15), "0.000000000000001");
  assert.throws(() => formatUnits(-1n, 15));
});
test("registration excludes other tokens and already-registered NIGHT", () => {
  const a = { utxo: { type: "night" }, meta: { registeredForDustGeneration: false } };
  const b = { utxo: { type: "night" }, meta: { registeredForDustGeneration: true } };
  const c = { utxo: { type: "other" }, meta: { registeredForDustGeneration: false } };
  assert.deepEqual(selectRegistrationCoins([a, b, c], "night"), { night: [a, b], unregistered: [a] });
  assert.deepEqual(selectRegistrationCoins([b, c], "night").unregistered, []);
});
