import { readFile, mkdir, open, lstat } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import * as Rx from "rxjs";
import { HDWallet, Roles, WalletFacade, ShieldedWallet, DustWallet, UnshieldedWallet, createKeystore, PublicKey, NoOpTransactionHistoryStorage, DustAddress, MidnightBech32m } from "@midnightntwrk/wallet-sdk";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { developmentEnvPath, showPublicAddresses } from "./dev-wallets.js";
import { formatUnits as format, selectRegistrationCoins } from "../lib/dust-registration.js";

globalThis.WebSocket = WebSocket;
const output = (role, stage, details = {}) => process.stdout.write(`${JSON.stringify({ role, stage, ...details })}\n`);
const dir = fileURLToPath(new URL("../.local/dust-registration/", import.meta.url));
const submit = process.argv.includes("--submit");
const selected = process.argv.find(arg => arg.startsWith("--role="))?.slice(7) || "both";
const syncProgress = state => Object.fromEntries(["shielded", "unshielded", "dust"].map(kind => {
  const p = state?.[kind].progress;
  return [kind, p ? { applied: String(p.appliedIndex ?? p.appliedId), relevant: String(p.highestRelevantWalletIndex ?? p.highestTransactionId), highest: String(p.highestIndex ?? p.highestTransactionId), connected: p.isConnected } : null];
}));
const deadline = async (promise, ms, label) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
};
async function journal(role, phase, data) {
  const file = await open(`${dir}${role}-${phase}.json`, "wx", 0o600);
  try { await file.writeFile(JSON.stringify({ network: "preview", phase, at: new Date().toISOString(), ...data }, null, 2)); await file.sync(); }
  finally { await file.close(); }
}
async function hasJournal(role) {
  try { await lstat(`${dir}${role}-broadcast-intent.json`); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
async function runWallet(role, env) {
  let wallet, shieldedKeys, dustKey, keys, hd, progress, latest;
  let stage = "restore";
  const name = role.toUpperCase();
  const seed = Buffer.from(env[`MIDNIGHT_${name}_SEED_HEX`], "hex");
  try {
    hd = HDWallet.fromSeed(seed);
    if (hd.type !== "seedOk") throw new Error("RESTORE_FAILED");
    const derived = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
    if (derived.type !== "keysDerived") throw new Error("DERIVATION_FAILED");
    keys = derived.keys;
    hd.hdWallet.clear(); seed.fill(0);
    shieldedKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
    dustKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
    const keystore = createKeystore(keys[Roles.NightExternal], "preview");
    const address = String(keystore.getBech32Address());
    const dustAddress = String(DustAddress.encodePublicKey("preview", dustKey.publicKey));
    if (address !== env[`MIDNIGHT_${name}_UNSHIELDED_ADDRESS`] || dustAddress !== env[`MIDNIGHT_${name}_DUST_ADDRESS`]) throw new Error("SAVED_ADDRESS_MISMATCH");
    output(role, "restored", { address, dustAddress });
    const configuration = {
      networkId: "preview",
      indexerClientConnection: { indexerHttpUrl: "https://indexer.preview.midnight.network/api/v4/graphql", indexerWsUrl: "wss://indexer.preview.midnight.network/api/v4/graphql/ws" },
      provingServerUrl: new URL("http://127.0.0.1:6300"), relayURL: new URL("wss://rpc.preview.midnight.network"),
      txHistoryStorage: new NoOpTransactionHistoryStorage(), costParameters: { feeBlocksMargin: 5, additionalFeeOverhead: 300_000_000_000_000n },
    };
    stage = "initialize";
    wallet = await WalletFacade.init({ configuration,
      shielded: cfg => ShieldedWallet(cfg).startWithSecretKeys(shieldedKeys),
      unshielded: cfg => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
      dust: cfg => DustWallet(cfg).startWithSecretKey(dustKey, ledger.LedgerParameters.initialParameters().dust),
    });
    stage = "sync";
    const subscription = wallet.state().subscribe({ next: state => { latest = state; }, error: () => output(role, "sync-stream-error") });
    progress = { subscription, timer: setInterval(() => output(role, stage, { synced: latest?.isSynced ?? false, night: format(latest?.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n, 6), progress: syncProgress(latest) }), 15_000) };
    await wallet.start(shieldedKeys, dustKey);
    let state = await deadline(wallet.waitForSyncedState(), 12 * 60_000, "SYNC_TIMEOUT");
    const { night: nightCoins, unregistered } = selectRegistrationCoins(state.unshielded.availableCoins, ledger.unshieldedToken().raw);
    output(role, "synced", { night: format(state.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n, 6), nightCoins: nightCoins.length, unregistered: unregistered.length, dust: format(state.dust.balance(new Date()), 15) });
    if (!submit) return;
    if (nightCoins.length === 0) throw new Error("NO_NIGHT_COINS");
    if (unregistered.length) {
      if (await hasJournal(role)) throw new Error("PRIOR_BROADCAST_INTENT_REQUIRES_RECONCILIATION_NO_RETRY");
      stage = "estimate";
      const estimate = await wallet.estimateRegistration(unregistered);
      output(role, stage, { estimatedFeeDust: format(estimate.fee, 15) });
      if (estimate.fee > 100n * 10n ** 15n) throw new Error("REGISTRATION_FEE_EXCEEDS_100_TEST_DUST_GUARD");
      await wallet.waitForGeneratedDust(unregistered, estimate.fee, { timeoutMs: 5 * 60_000 });
      stage = "build-and-prove";
      const receiver = MidnightBech32m.parse(dustAddress).decode(DustAddress, "preview");
      const recipe = await wallet.registerNightUtxosForDustGeneration(unregistered, keystore.getPublicKey(), payload => keystore.signData(payload), receiver);
      const finalized = await deadline(wallet.finalizeRecipe(recipe), 5 * 60_000, "PROVING_TIMEOUT");
      const identifiers = finalized.identifiers();
      await journal(role, "broadcast-intent", { address, dustAddress, identifiers });
      stage = "submit";
      output(role, stage, { identifiers });
      const identifier = await deadline(wallet.submitTransaction(finalized), 5 * 60_000, "SUBMISSION_OUTCOME_UNKNOWN_DO_NOT_RETRY");
      await journal(role, "submitted", { address, identifier });
      output(role, "submission-finalized", { identifier });
    } else output(role, "already-registered");
    stage = "confirm-generation";
    // After finalized submission, a global sync flag can lag unrelated ledger
    // events. Confirm the actual registered output and a positive observed DUST
    // balance instead; report sync status separately, not as transaction finality.
    state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter(s => s.unshielded.availableCoins.some(c => c.utxo.type === ledger.unshieldedToken().raw && c.meta?.registeredForDustGeneration === true) && s.dust.balance(new Date()) > 0n), Rx.timeout({ first: 5 * 60_000 })));
    const result = { address, dustAddress, fullySynced: state.isSynced, night: format(state.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n, 6), dust: format(state.dust.balance(new Date()), 15), registeredNightCoins: state.unshielded.availableCoins.filter(c => c.utxo.type === ledger.unshieldedToken().raw && c.meta?.registeredForDustGeneration === true).length };
    output(role, "confirmed-generating-dust", result);
    try { await journal(role, "confirmed", result); } catch (error) { if (error.code !== "EEXIST") throw error; }
  } catch (error) {
    // Never dump SDK error objects or witnesses. Long hex values are redacted.
    output(role, "failed", { during: stage, error: String(error.message || "SDK_FAILURE").replace(/[a-f0-9]{32,}/gi, "[redacted]").slice(0, 600), automaticRetry: false });
    process.exitCode = 1;
  } finally {
    if (progress) { clearInterval(progress.timer); progress.subscription.unsubscribe(); }
    if (wallet) await deadline(wallet.stop(), 15_000, "STOP_TIMEOUT").catch(() => {});
    hd?.type === "seedOk" && hd.hdWallet.clear(); seed.fill(0);
    if (keys) Object.values(keys).forEach(key => key.fill(0));
    shieldedKeys?.clear(); dustKey?.clear();
  }
}

try {
  if (!["voter", "authority", "both"].includes(selected)) throw new Error("INVALID_ROLE");
  await showPublicAddresses(developmentEnvPath, false);
  const env = parseEnv(await readFile(developmentEnvPath, "utf8"));
  if (env.MIDNIGHT_NETWORK_ID !== "preview") throw new Error("ONLY_PREVIEW_ALLOWED");
  const chain = await (await fetch("https://rpc.preview.midnight.network", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "system_chain", params: [] }), signal: AbortSignal.timeout(15_000) })).json();
  if (chain.result !== "Midnight Preview") throw new Error("NETWORK_MISMATCH");
  if (submit) {
    const health = await fetch("http://127.0.0.1:6300/health", { signal: AbortSignal.timeout(5000) });
    if (!health.ok) throw new Error("LOCAL_PROVER_UNAVAILABLE");
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const role of selected === "both" ? ["voter", "authority"] : [selected]) await runWallet(role, env);
} catch (error) {
  output("setup", "failed", { error: String(error.message || "SETUP_FAILED").replace(/[a-f0-9]{32,}/gi, "[redacted]").slice(0, 300) }); process.exitCode = 1;
}
