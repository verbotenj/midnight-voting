// Public educational hosting only. Deliberately imports no SDK, wallet, prover,
// environment-file loader, Preview runtime, or arbitrary filesystem routes.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createDemoState, authorityState, publicElectionState, issueCredential, castVote, closeElection, ELECTION_ID, PASSPORT_FIXTURES } from "./lib/domain.js";

const files = new Map([
  ...["/", "/learn", "/privacy", "/developer", "/preview"].map(route => [route, ["index.html", "text/html"]]),
  ...["app.js", "pages.js", "privacy-lens.js", "demo-player.js", "payload-inspector.js", "hosted-demo.js", "preview-ballot.js", "wallet-lab.js"].map(name => [`/${name}`, [name, "text/javascript"]]),
  ["/styles.css", ["styles.css", "text/css"]],
]);
const passports = new Set(PASSPORT_FIXTURES.map(item => item.passport));
const ttl = 60 * 60 * 1000;
const securityHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export function createPublicServer({ origin, maxSessions = 250, now = Date.now } = {}) {
  const expectedOrigin = new URL(origin).origin;
  const secure = expectedOrigin.startsWith("https:");
  const cookieName = secure ? "__Host-demo_session" : "demo_session";
  const sessions = new Map();
  let windowStart = now(), windowRequests = 0;
  const server = createServer(async (request, response) => {
    const send = (status, payload, headers = {}) => {
      response.writeHead(status, { ...securityHeaders, "content-type": "application/json; charset=utf-8", ...headers });
      response.end(JSON.stringify(payload));
    };
    try {
      const url = new URL(request.url, expectedOrigin);
      if (request.method === "GET" && url.pathname === "/health") return send(200, { status: "ok", mode: "public-simulation" });
      // No live API is reachable, even if someone manually changes the UI.
      if (/^\/api\/(preview|midnight)(\/|$)/.test(url.pathname)) return send(403, { code: "LIVE_OPERATIONS_DISABLED" });
      if (!url.pathname.startsWith("/api/")) {
        if (request.method !== "GET" && request.method !== "HEAD") return send(405, { code: "METHOD_NOT_ALLOWED" });
        let content, type;
        if (url.pathname === "/runtime.js") {
          content = "export const HOSTED_DEMO = true; export const HOSTING_PLATFORM = 'node';\n";
          type = "text/javascript";
        } else {
          const asset = files.get(url.pathname);
          if (!asset) return send(404, { code: "NOT_FOUND" });
          content = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
          type = asset[1];
        }
        response.writeHead(200, { ...securityHeaders, "content-type": `${type}; charset=utf-8` });
        return response.end(request.method === "HEAD" ? undefined : content);
      }
      if (!["GET", "POST"].includes(request.method)) return send(405, { code: "METHOD_NOT_ALLOWED" });
      if ((request.headers.origin && request.headers.origin !== expectedOrigin)
          || (request.method === "POST" && (request.headers.origin !== expectedOrigin || !/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")))) {
        return send(403, { code: "SAME_ORIGIN_JSON_REQUIRED" });
      }
      const time = now();
      if (time - windowStart >= 60_000) { windowStart = time; windowRequests = 0; }
      if (++windowRequests > 2400) return send(429, { code: "DEMO_BUSY" }, { "retry-after": "60" });
      for (const [key, value] of sessions) if (time - value.touched >= ttl) sessions.delete(key);
      const cookie = (request.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
      let id = cookie?.slice(cookieName.length + 1);
      let session = sessions.get(id);
      if (!session) {
        if (request.method !== "GET" || url.pathname !== "/api/state") return send(409, { code: "DEMO_SESSION_EXPIRED" });
        if (sessions.size >= maxSessions) return send(503, { code: "DEMO_CAPACITY_REACHED" }, { "retry-after": "60" });
        id = randomBytes(32).toString("base64url");
        session = { state: createDemoState(), version: randomBytes(16).toString("hex"), touched: time, window: time, requests: 0 };
        sessions.set(id, session);
      }
      response.setHeader("set-cookie", `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${secure ? "; Secure" : ""}`);
      session.touched = time;
      if (time - session.window >= 60_000) { session.window = time; session.requests = 0; }
      if (++session.requests > 120) return send(429, { code: "DEMO_RATE_LIMIT" }, { "retry-after": "60" });
      if (request.method === "GET" && url.pathname === "/api/state") {
        return send(200, { sessionVersion: session.version, authority: authorityState(session.state), public: publicElectionState(session.state) });
      }
      const base = `/api/elections/${ELECTION_ID}`;
      if (request.method !== "POST" || ![`${base}/credential`, `${base}/vote`, `${base}/close`, "/api/demo/reset"].includes(url.pathname)) return send(404, { code: "NOT_FOUND" });
      if (Number(request.headers["content-length"]) > 8192) return send(413, { code: "BODY_TOO_LARGE" });
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 8192) return send(413, { code: "BODY_TOO_LARGE" });
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (!input || Array.isArray(input) || typeof input !== "object") return send(400, { code: "INVALID_INPUT" });
      const allowed = url.pathname.endsWith("/credential") ? ["demoPassport", "commitment"] : url.pathname.endsWith("/vote") ? ["choice", "credentialSecret", "proofDigest", "proofMode"] : [];
      if (Object.keys(input).some(key => !allowed.includes(key))) return send(400, { code: "UNEXPECTED_FIELDS" });
      if (url.pathname.endsWith("/credential")) {
        // Reject non-demo document IDs without retaining them in event records.
        if (!passports.has(input.demoPassport)) return send(403, { code: "NOT_ELIGIBLE" });
        const result = issueCredential(session.state, { ...input, electionId: ELECTION_ID });
        return send(result.status, result.body);
      }
      if (url.pathname.endsWith("/vote")) {
        const result = castVote(session.state, { ...input, electionId: ELECTION_ID });
        return send(result.status, result.body);
      }
      if (url.pathname.endsWith("/close")) return send(200, closeElection(session.state));
      session.state = createDemoState();
      return send(200, { code: "RESET", public: publicElectionState(session.state) });
    } catch (error) {
      send(error instanceof SyntaxError ? 400 : 500, { code: error instanceof SyntaxError ? "INVALID_JSON" : "SIMULATION_UNAVAILABLE" });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.MIDNIGHT_LIVE_ACTIONS === "1" || Object.keys(process.env).some(key => /^MIDNIGHT_.*SEED/.test(key))) throw new Error("REMOVE_WALLET_CONFIGURATION_FROM_PUBLIC_HOST");
  const port = Number(process.env.PORT || 4175);
  const origin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${port}`;
  const server = createPublicServer({ origin });
  server.listen(port, process.env.HOST || "127.0.0.1", () => console.log("Public fictional voting simulation listening; live operations disabled."));
}
