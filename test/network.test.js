import test from "node:test";
import assert from "node:assert/strict";
import { readNetwork } from "../lib/network.js";
import { assertTestWallet, prepareSelfTransfer } from "../public/wallet-lab.js";

test("network reader uses fixed host and finalized block, not simulated state", async () => {
  const calls = [];
  const data = ["Midnight Preprod", "0xabc", { number: "0x2a" }];
  const result = await readNetwork("preprod", async (url, options) => {
    calls.push([url, JSON.parse(options.body)]);
    return { ok: true, json: async () => ({ result: data.shift() }) };
  });
  assert.equal(result.height, 42);
  assert.equal(result.finalizedHash, "0xabc");
  assert.ok(calls.every(([url]) => url === "https://rpc.preprod.midnight.network"));
  assert.deepEqual(calls[2][1].params, ["0xabc"]);
});
test("network reader fails closed on mainnet, wrong network, RPC errors and bad headers", async () => {
  await assert.rejects(readNetwork("mainnet"), /UNSUPPORTED/);
  await assert.rejects(readNetwork("preprod", async () => ({ ok: true, json: async () => ({ result: "Midnight Mainnet" }) })), /MISMATCH/);
  await assert.rejects(readNetwork("preprod", async () => ({ ok: false })), /UNAVAILABLE/);
  const responses = ["Midnight Preprod", "0xabc", { number: "invalid" }];
  await assert.rejects(readNetwork("preprod", async () => ({ ok: true, json: async () => ({ result: responses.shift() }) })), /INVALID_BLOCK/);
});
const wallet = (overrides = {}) => ({
  getConfiguration: async () => ({ networkId: "preprod" }),
  getUnshieldedAddress: async () => ({ unshieldedAddress: "mn_addr_preprod1demo" }),
  getUnshieldedBalances: async () => ({ abcd: 10n }),
  getDustBalance: async () => ({ balance: 20n }), ...overrides,
});
test("self-transfer is one raw unit to own test address with no identity data", async () => {
  const outputs = await prepareSelfTransfer(wallet(), "preprod", "abcd");
  assert.deepEqual(outputs, [{ kind: "unshielded", type: "abcd", value: 1n, recipient: "mn_addr_preprod1demo" }]);
});
test("wrong network, mainnet, empty balances and no fee capacity are blocked before wallet build", async () => {
  assert.throws(() => assertTestWallet("mainnet", { networkId: "mainnet" }, "mn_addr1demo"), /Only/);
  await assert.rejects(prepareSelfTransfer(wallet(), "preview", "abcd"), /mismatch/);
  await assert.rejects(prepareSelfTransfer(wallet(), "preprod", "beef"), /balance/);
  await assert.rejects(prepareSelfTransfer(wallet({ getDustBalance: async () => ({ balance: 0n }) }), "preprod", "abcd"), /tDUST/);
});
