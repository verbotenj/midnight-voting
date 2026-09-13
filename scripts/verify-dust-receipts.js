import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { formatUnits } from "../lib/dust-registration.js";

// Fast, public-only verification. Does not load .env or any wallet secrets.
const dir = fileURLToPath(new URL("../.local/dust-registration/", import.meta.url));
async function rpc(method, params = []) {
  const response = await fetch("https://rpc.preview.midnight.network", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error("RPC_UNAVAILABLE");
  return json.result;
}
try {
  if (await rpc("system_chain") !== "Midnight Preview") throw new Error("NETWORK_MISMATCH");
  const finalizedHash = await rpc("chain_getFinalizedHead");
  const finalizedHeight = Number.parseInt((await rpc("chain_getHeader", [finalizedHash])).number, 16);
  for (const role of ["voter", "authority"]) {
    let receipt;
    try { receipt = JSON.parse(await readFile(`${dir}${role}-broadcast-intent.json`, "utf8")); }
    catch (error) { if (error.code === "ENOENT") { console.log(JSON.stringify({ role, status: "NO_LOCAL_RECEIPT" })); process.exitCode = 1; continue; } throw error; }
    if (receipt.network !== "preview" || !receipt.address.startsWith("mn_addr_preview1")) throw new Error("INVALID_RECEIPT_NETWORK");
    const identifier = receipt.identifiers.at(-1);
    if (!/^[a-f0-9]{64,}$/i.test(identifier)) throw new Error("INVALID_RECEIPT_IDENTIFIER");
    const query = "query($identifier:HexEncoded!){transactions(offset:{identifier:$identifier}){hash block{height hash} unshieldedCreatedOutputs{owner tokenType value registeredForDustGeneration spentAtTransaction{hash}}}}";
    const response = await fetch("https://indexer.preview.midnight.network/api/v4/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables: { identifier } }), signal: AbortSignal.timeout(15_000) });
    const json = await response.json();
    if (!response.ok || json.errors) throw new Error("INDEXER_UNAVAILABLE");
    const transactions = json.data.transactions;
    if (transactions.length !== 1) { console.log(JSON.stringify({ role, identifier, status: "NOT_UNIQUELY_FOUND", automaticRetry: false })); process.exitCode = 1; continue; }
    const tx = transactions[0];
    const canonical = await rpc("chain_getBlockHash", [tx.block.height]);
    const isFinalized = canonical.replace(/^0x/, "") === tx.block.hash.replace(/^0x/, "") && tx.block.height <= finalizedHeight;
    const outputs = tx.unshieldedCreatedOutputs.filter(o => o.owner === receipt.address && o.tokenType === "0".repeat(64));
    const registered = outputs.length > 0 && outputs.every(o => o.registeredForDustGeneration);
    const unspent = outputs.filter(o => !o.spentAtTransaction).reduce((sum, o) => sum + BigInt(o.value), 0n);
    console.log(JSON.stringify({ role, identifier, transactionHash: tx.hash, block: tx.block.height, finalized: isFinalized, outputsRegisteredForDust: registered, unspentNightInRegistrationOutputs: formatUnits(unspent, 6), note: "This checks the registration outputs, not the full current wallet or DUST balance." }));
    if (!isFinalized || !registered) process.exitCode = 1;
  }
} catch (error) { console.error(String(error.message || "VERIFICATION_FAILED")); process.exitCode = 1; }
