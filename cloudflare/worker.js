import { DurableObject } from "cloudflare:workers";
import { DemoStore, POST_PATHS } from "./demo-store.js";
import { PASSPORT_FIXTURES } from "../lib/domain.js";

const securityHeaders = {
  "cache-control": "no-store", "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer", "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
const assets = new Set(["/index.html", "/app.js", "/pages.js", "/privacy-lens.js", "/demo-player.js", "/payload-inspector.js", "/hosted-demo.js", "/preview-ballot.js", "/wallet-lab.js", "/styles.css"]);
const pages = new Set(["/", "/learn", "/privacy", "/developer", "/preview"]);
const passports = new Set(PASSPORT_FIXTURES.map(record => record.passport));
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...securityHeaders, "content-type": "application/json; charset=utf-8", ...extra } });

async function readInput(request) {
  if (Number(request.headers.get("content-length")) > 8192) throw new Error("BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = []; let size = 0;
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; void reader.cancel(); }, 10_000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
      chunks.push(value);
    }
    if (timedOut) throw new Error("BODY_TIMEOUT");
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes) || "{}");
  } finally { clearTimeout(deadline); reader.releaseLock(); }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const { pathname: path, origin } = url;
      if (path === "/health" && request.method === "GET") return json(200, { status: "ok", mode: "public-simulation", hosting: "cloudflare" });
      if (/^\/api\/(preview|midnight)(\/|$)/.test(path)) return json(403, { code: "LIVE_OPERATIONS_DISABLED" });
      if (!path.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(request.method)) return json(405, { code: "METHOD_NOT_ALLOWED" });
        if (path === "/runtime.js") return new Response(request.method === "HEAD" ? null : "export const HOSTED_DEMO = true; export const HOSTING_PLATFORM = 'cloudflare';\n", { headers: { ...securityHeaders, "content-type": "text/javascript; charset=utf-8" } });
        if (pages.has(path)) url.pathname = "/index.html";
        else if (!assets.has(path)) return json(404, { code: "NOT_FOUND" });
        url.search = "";
        const asset = await env.ASSETS.fetch(new Request(url, { method: request.method }));
        const headers = new Headers(asset.headers);
        for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
        return new Response(asset.body, { status: asset.status, headers });
      }
      if (!["GET", "POST"].includes(request.method)) return json(405, { code: "METHOD_NOT_ALLOWED" });
      const suppliedOrigin = request.headers.get("origin");
      if ((suppliedOrigin && suppliedOrigin !== origin) || (request.method === "POST" && (suppliedOrigin !== origin || !/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")))) return json(403, { code: "SAME_ORIGIN_JSON_REQUIRED" });
      if (!(request.method === "GET" && path === "/api/state") && !(request.method === "POST" && POST_PATHS.has(path))) return json(404, { code: "NOT_FOUND" });
      const input = request.method === "POST" ? await readInput(request) : {};
      if (!input || Array.isArray(input) || typeof input !== "object") return json(400, { code: "INVALID_INPUT" });
      const allowed = path.endsWith("/credential") ? ["demoPassport", "commitment"] : path.endsWith("/vote") ? ["choice", "credentialSecret", "proofDigest", "proofMode"] : [];
      if (Object.keys(input).some(key => !allowed.includes(key))) return json(400, { code: "UNEXPECTED_FIELDS" });
      if (Object.values(input).some(value => typeof value !== "string")) return json(400, { code: "INVALID_INPUT" });
      if (path.endsWith("/credential") && !passports.has(input.demoPassport)) return json(403, { code: "NOT_ELIGIBLE" });
      const secure = url.protocol === "https:";
      const cookieName = secure ? "__Host-demo_session" : "demo_session";
      const cookie = (request.headers.get("cookie") || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
      const id = cookie?.slice(cookieName.length + 1);
      const coordinator = env.DEMO.get(env.DEMO.idFromName("public-demo-v1"));
      const result = await coordinator.handle({ method: request.method, path, input, id: /^[A-Za-z0-9_-]{43}$/.test(id || "") ? id : undefined });
      const headers = {};
      if (result.id) headers["set-cookie"] = `${cookieName}=${result.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${secure ? "; Secure" : ""}`;
      if ([429, 503].includes(result.status)) headers["retry-after"] = "60";
      return json(result.status, result.body, headers);
    } catch (error) {
      if (error.message === "BODY_TOO_LARGE") return json(413, { code: "BODY_TOO_LARGE" });
      if (error.message === "BODY_TIMEOUT") return json(408, { code: "BODY_TIMEOUT" });
      return json(error instanceof SyntaxError ? 400 : 503, { code: error instanceof SyntaxError ? "INVALID_JSON" : "SIMULATION_UNAVAILABLE" });
    }
  },
};

export class DemoCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new DemoStore(ctx.storage.sql);
  }
  async handle(input) {
    // Set cleanup before persisting any new data, so all stored sessions have an
    // alarm scheduled even if the isolate is evicted immediately after a response.
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 900_000);
    return this.ctx.storage.transactionSync(() => this.store.handle(input));
  }
  async alarm() {
    if (this.store.expire() > 0) await this.ctx.storage.setAlarm(Date.now() + 900_000);
  }
}
