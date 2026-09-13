import { open, readFile, lstat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { HDWallet, Roles, generateRandomSeed } from "@midnight-ntwrk/wallet-sdk-hd";
import { bech32m } from "@scure/base";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { MidnightBech32m, UnshieldedAddress, ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey, DustAddress } from "@midnight-ntwrk/wallet-sdk-address-format";

export const developmentEnvPath = fileURLToPath(new URL("../.env.development", import.meta.url));
const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const roles = ["VOTER", "AUTHORITY"];

// Offline SDK derivation only. Never log seeds, signing keys, or error objects.
export function derivePublicAddresses(seed, network) {
  if (!["preprod", "preview"].includes(network)) throw new Error("TEST_NETWORK_REQUIRED");
  if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new Error("INVALID_DEVELOPMENT_SEED");
  const result = HDWallet.fromSeed(seed);
  if (result.type !== "seedOk") throw new Error("HD_DERIVATION_FAILED");
  const keys = [];
  let shielded, dust;
  try {
    const account = result.hdWallet.selectAccount(0);
    for (const role of [Roles.NightExternal, Roles.Zswap, Roles.Dust]) {
      const key = account.selectRole(role).deriveKeyAt(0);
      // Fail rather than silently changing the documented derivation index.
      if (key.type !== "keyDerived") throw new Error("HD_INDEX_ZERO_DERIVATION_FAILED");
      keys.push(key.key);
    }
    const verifyingKey = ledger.signatureVerifyingKey(Buffer.from(keys[0]).toString("hex"));
    shielded = ledger.ZswapSecretKeys.fromSeed(keys[1]);
    dust = ledger.DustSecretKey.fromSeed(keys[2]);
    const encode = value => MidnightBech32m.encode(network, value).toString();
    return {
      unshielded: encode(new UnshieldedAddress(Buffer.from(ledger.addressFromKey(verifyingKey), "hex"))),
      shielded: encode(new ShieldedAddress(new ShieldedCoinPublicKey(Buffer.from(shielded.coinPublicKey, "hex")), new ShieldedEncryptionPublicKey(Buffer.from(shielded.encryptionPublicKey, "hex")))),
      dust: encode(new DustAddress(dust.publicKey)),
    };
  } finally {
    result.hdWallet.clear();
    keys.forEach(key => key.fill(0));
    shielded?.clear();
    dust?.clear();
  }
}

export function validatePublicAddresses(addresses, network) {
  for (const [kind, type] of [["unshielded", UnshieldedAddress], ["shielded", ShieldedAddress], ["dust", DustAddress]]) {
    // SDK 3.1.2 parse() applies Bech32's default 90-character limit, but
    // Midnight shielded addresses exceed it. Validate checksum without that limit.
    const decodedBech32 = bech32m.decode(addresses[kind], false);
    const tag = { unshielded: "addr", shielded: "shield-addr", dust: "dust" }[kind];
    if (decodedBech32.prefix !== `mn_${tag}_${network}`) throw new Error("ADDRESS_NETWORK_MISMATCH");
    const representation = new MidnightBech32m(tag, network, Buffer.from(bech32m.fromWords(decodedBech32.words)));
    const decoded = representation.decode(type, network);
    if (MidnightBech32m.encode(network, decoded).toString() !== addresses[kind]) throw new Error("ADDRESS_ROUNDTRIP_FAILED");
  }
}

function requireIgnoredEnv(path = developmentEnvPath) {
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", path], { cwd: projectDirectory, stdio: "ignore" });
  if (result.status !== 0) throw new Error("ENV_MUST_BE_GIT_IGNORED");
}

export async function initialize(network = "preview", path = developmentEnvPath) {
  if (!["preview", "preprod"].includes(network)) throw new Error("TEST_NETWORK_REQUIRED");
  requireIgnoredEnv(path);
  let file;
  const seeds = [];
  try {
    const lines = [
      "# PRIVATE: disposable Midnight test-network wallets. Never use for real funds.",
      "# SDK root seeds, NOT BIP39 mnemonics. Independently generated per role.",
      "# HD paths: m/44'/2400'/0'/role/0; roles 0=unshielded, 2=DUST, 3=shielded.",
      "# Reserved authority wallet is not a deployed contract or an issuer API key.",
      "# This file is not loaded by the web server or sent to the browser.",
      `MIDNIGHT_NETWORK_ID=${network}`,
      `MIDNIGHT_NODE_URL=https://rpc.${network}.midnight.network`,
      `MIDNIGHT_INDEXER_URL=https://indexer.${network}.midnight.network/api/v4/graphql`,
      "MIDNIGHT_PROOF_SERVER_URL=http://127.0.0.1:6300",
    ];
    for (const role of roles) {
      const seed = generateRandomSeed(256);
      seeds.push(seed);
      const addresses = derivePublicAddresses(seed, network);
      validatePublicAddresses(addresses, network);
      lines.push("", `MIDNIGHT_${role}_SEED_HEX=${Buffer.from(seed).toString("hex")}`);
      for (const [kind, address] of Object.entries(addresses)) lines.push(`MIDNIGHT_${role}_${kind.toUpperCase()}_ADDRESS=${address}`);
    }
    // Exclusive creation refuses existing files and symlinks. No rotation/overwrite mode.
    // Derive and validate first so derivation failures cannot leave an empty file.
    file = await open(path, "wx", 0o600);
    await file.writeFile(`${lines.join("\n")}\n`, "utf8");
    await file.sync();
  } finally {
    seeds.forEach(seed => seed.fill(0));
    await file?.close();
  }
}

export async function showPublicAddresses(path = developmentEnvPath, print = true) {
  requireIgnoredEnv(path);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error("ENV_REQUIRES_OWNER_ONLY_PERMISSIONS");
  const env = parseEnv(await readFile(path, "utf8"));
  const network = env.MIDNIGHT_NETWORK_ID;
  const output = { network, wallets: {}, note: "Public addresses only. Funding and registration have not been checked. These SDK wallets are not automatically connected to the browser." };
  for (const role of roles) {
    const hex = env[`MIDNIGHT_${role}_SEED_HEX`];
    if (!/^[a-f0-9]{64}$/.test(hex || "")) throw new Error("INVALID_SAVED_SEED");
    const seed = Buffer.from(hex, "hex");
    try {
      const addresses = derivePublicAddresses(seed, network);
      validatePublicAddresses(addresses, network);
      for (const [kind, address] of Object.entries(addresses)) {
        if (address !== env[`MIDNIGHT_${role}_${kind.toUpperCase()}_ADDRESS`]) throw new Error("SAVED_ADDRESS_MISMATCH");
      }
      output.wallets[role.toLowerCase()] = addresses;
    } finally { seed.fill(0); }
  }
  if (print) console.log(JSON.stringify(output, null, 2));
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  try {
    if (action === "init") await initialize();
    else if (action !== "show") throw new Error("USE_INIT_OR_SHOW");
    await showPublicAddresses();
  } catch (error) {
    // Intentionally omit SDK/IO error details: future versions may include secrets.
    console.error(error?.code === "EEXIST" ? "Refusing to overwrite .env.development. Use npm run wallets:show." : "Wallet operation failed safely. Check ignored-file permissions, SDK compatibility and saved configuration; no secret values were printed.");
    process.exitCode = 1;
  }
}
