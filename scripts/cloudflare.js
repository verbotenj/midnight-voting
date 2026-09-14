// Keep the public simulation CLI separate from local Midnight wallet setup.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
if (existsSync(".dev.vars")) throw new Error("Remove .dev.vars before running the public simulation tooling; it needs no runtime secrets.");
const env = { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", WRANGLER_SEND_METRICS: "false" };
for (const key of Object.keys(env)) if (key.startsWith("MIDNIGHT_")) delete env[key];
const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)), ...args], { stdio: "inherit", env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
