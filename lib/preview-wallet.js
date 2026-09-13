import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { WebSocket } from "ws";
import { HDWallet, Roles, WalletFacade, ShieldedWallet, DustWallet, UnshieldedWallet, createKeystore, PublicKey, NoOpTransactionHistoryStorage, DustAddress } from "@midnightntwrk/wallet-sdk";
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { developmentEnvPath, showPublicAddresses } from "../scripts/dev-wallets.js";

export const PREVIEW_HTTP = "https://indexer.preview.midnight.network/api/v4/graphql";
export const PREVIEW_WS = "wss://indexer.preview.midnight.network/api/v4/graphql/ws";
export const logStage = (stage, details = {}) => {
  process.stdout.write(`${JSON.stringify({ stage, ...details })}\n`);
  if (process.send && process.connected) process.send({ event: "progress", stage, ...details });
};
export async function deadline(promise, milliseconds, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

export async function requirePreview() {
  const response = await fetch("https://rpc.preview.midnight.network", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "system_chain", params: [] }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || (await response.json()).result !== "Midnight Preview") throw new Error("PREVIEW_NETWORK_CHECK_FAILED");
}

// Restores the existing wallet. It never requests tokens or registers NIGHT again.
export async function withPreviewWallet(role, operation) {
  if (!["authority", "voter"].includes(role)) throw new Error("INVALID_WALLET_ROLE");
  await requirePreview();
  await showPublicAddresses(developmentEnvPath, false);
  const env = parseEnv(await readFile(developmentEnvPath, "utf8"));
  if (env.MIDNIGHT_NETWORK_ID !== "preview") throw new Error("ONLY_PREVIEW_ALLOWED");
  globalThis.WebSocket = WebSocket;
  const name = role.toUpperCase(), seed = Buffer.from(env[`MIDNIGHT_${name}_SEED_HEX`], "hex");
  let hd, keys, shieldedKeys, dustKey, wallet, subscription, timer, latest;
  try {
    hd = HDWallet.fromSeed(seed);
    if (hd.type !== "seedOk") throw new Error("WALLET_RESTORE_FAILED");
    const derived = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
    if (derived.type !== "keysDerived") throw new Error("WALLET_DERIVATION_FAILED");
    keys = derived.keys; hd.hdWallet.clear(); seed.fill(0);
    shieldedKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
    dustKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
    const keystore = createKeystore(keys[Roles.NightExternal], "preview");
    const address = String(keystore.getBech32Address());
    if (address !== env[`MIDNIGHT_${name}_UNSHIELDED_ADDRESS`] || String(DustAddress.encodePublicKey("preview", dustKey.publicKey)) !== env[`MIDNIGHT_${name}_DUST_ADDRESS`]) throw new Error("SAVED_ADDRESS_MISMATCH");
    const configuration = { networkId: "preview",
      indexerClientConnection: { indexerHttpUrl: PREVIEW_HTTP, indexerWsUrl: PREVIEW_WS },
      provingServerUrl: new URL("http://127.0.0.1:6300"), relayURL: new URL("wss://rpc.preview.midnight.network"),
      txHistoryStorage: new NoOpTransactionHistoryStorage(), costParameters: { feeBlocksMargin: 5, additionalFeeOverhead: 300_000_000_000_000n },
    };
    wallet = await WalletFacade.init({ configuration,
      shielded: cfg => ShieldedWallet(cfg).startWithSecretKeys(shieldedKeys),
      unshielded: cfg => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
      dust: cfg => DustWallet(cfg).startWithSecretKey(dustKey, ledger.LedgerParameters.initialParameters().dust),
    });
    subscription = wallet.state().subscribe({ next: state => { latest = state; }, error: () => logStage("wallet-stream-error", { role }) });
    timer = setInterval(() => logStage("wallet-sync-progress", { role, synced: latest?.isSynced ?? false,
      progress: Object.fromEntries(["shielded", "unshielded", "dust"].map(kind => {
        const p = latest?.[kind]?.progress;
        return [kind, p ? { applied: String(p.appliedIndex ?? p.appliedId), highest: String(p.highestIndex ?? p.highestTransactionId) } : null];
      })),
    }), 15000);
    logStage("wallet-restored", { role, address });
    await wallet.start(shieldedKeys, dustKey);
    const state = await deadline(wallet.waitForSyncedState(), 15 * 60000, "WALLET_SYNC_TIMEOUT");
    clearInterval(timer);
    const dust = state.dust.balance(new Date());
    logStage("wallet-synced", { role, nightRaw: String(state.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n), dustSpecks: String(dust) });
    if (dust <= 0n) throw new Error("NO_GENERATED_DUST");
    const walletProvider = {
      getCoinPublicKey: () => shieldedKeys.coinPublicKey,
      getEncryptionPublicKey: () => shieldedKeys.encryptionPublicKey,
      async balanceTx(tx, ttl) {
        logStage("balance-with-dust", { role });
        const recipe = await wallet.balanceUnboundTransaction(tx, { shieldedSecretKeys: shieldedKeys, dustSecretKey: dustKey }, { ttl: ttl ?? new Date(Date.now() + 60 * 60000) });
        const finalized = await wallet.finalizeRecipe(recipe);
        const fee = finalized.feesWithMargin(ledger.LedgerParameters.initialParameters(), 5);
        if (fee > 100n * 10n ** 15n) throw new Error("TRANSACTION_FEE_EXCEEDS_100_TEST_DUST_GUARD");
        logStage("transaction-balanced", { role, estimatedFeeSpecks: String(fee) });
        return finalized;
      },
    };
    return await operation({ wallet, walletProvider, address });
  } finally {
    clearInterval(timer); subscription?.unsubscribe();
    if (wallet) await deadline(wallet.stop(), 15000, "WALLET_STOP_TIMEOUT").catch(() => {});
    if (hd?.type === "seedOk") hd.hdWallet.clear();
    seed.fill(0); if (keys) Object.values(keys).forEach(key => key.fill(0));
    shieldedKeys?.clear(); dustKey?.clear();
  }
}
