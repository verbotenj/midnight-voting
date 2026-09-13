export const TEST_NETWORKS = new Set(["preprod", "preview"]);

// Fixed hosts and read-only methods: never proxy a user-supplied RPC URL.
export async function readNetwork(network, fetcher = fetch) {
  if (!TEST_NETWORKS.has(network)) throw new Error("UNSUPPORTED_TEST_NETWORK");
  const rpc = async (method, params = []) => {
    const response = await fetcher(`https://rpc.${network}.midnight.network`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("NETWORK_UNAVAILABLE");
    const data = await response.json();
    if (data.error || data.result == null) throw new Error("NETWORK_RPC_ERROR");
    return data.result;
  };
  const chain = await rpc("system_chain");
  if (chain !== `Midnight ${network === "preprod" ? "Preprod" : "Preview"}`) throw new Error("NETWORK_MISMATCH");
  const finalizedHash = await rpc("chain_getFinalizedHead");
  const header = await rpc("chain_getHeader", [finalizedHash]);
  if (!/^0x[0-9a-f]+$/i.test(header.number)) throw new Error("INVALID_BLOCK_HEADER");
  return { network, chain, finalizedHash, height: Number.parseInt(header.number, 16), checkedAt: new Date().toISOString() };
}
