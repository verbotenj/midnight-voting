import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { readNetwork, TEST_NETWORKS } from "./lib/network.js";
import { assertPreviewRequest } from "./lib/preview-http-guard.js";
import {
  authorityState,
  castVote,
  closeElection,
  createDemoState,
  issueCredential,
  publicElectionState,
} from "./lib/domain.js";

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

let state = createDemoState();
let previewService;
const preview = async () => {
  previewService ||= import("./lib/preview-runtime.js").then(({ createLivePreviewService }) => createLivePreviewService(process.env.MIDNIGHT_LIVE_ACTIONS === "1"));
  return previewService;
};

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64_000) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(pathname, response) {
  const relative = ["/", "/learn", "/privacy", "/developer", "/preview"].includes(pathname) ? "index.html" : pathname.slice(1);
  const safePath = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = join(PUBLIC_DIR, safePath);
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
    const contents = await readFile(filePath);
    response.writeHead(200, {
      "content-type": MIME[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    response.end(contents);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/preview/")) {
      try {
        assertPreviewRequest(request, request.method !== "GET");
        const service = await preview();
        if (request.method === "GET" && url.pathname === "/api/preview/inspection") return json(response, 200, await service.inspect());
        if (request.method === "GET" && url.pathname === "/api/preview/job") return json(response, 200, service.job());
        if (request.method === "POST" && url.pathname === "/api/preview/actions") return json(response, 202, { job: service.start(await body(request)) });
        if (request.method === "POST" && url.pathname === "/api/preview/disconnect") { await service.stop(); return json(response, 200, { code: "WORKERS_STOPPED" }); }
        return json(response, 404, { code: "NOT_FOUND" });
      } catch (error) {
        const safe = error.status ? error.message : error instanceof SyntaxError ? "INVALID_JSON" : "PREVIEW_INSPECTION_UNAVAILABLE";
        return json(response, error.status || (error instanceof SyntaxError ? 400 : 503), { code: safe, message: "No success is assumed. Inspect current state and any saved broadcast before retrying an action." });
      }
    }
    if (request.method === "GET" && url.pathname === "/api/midnight/network") {
      const network = url.searchParams.get("network") || "preview";
      if (!TEST_NETWORKS.has(network)) return json(response, 400, { code: "UNSUPPORTED_TEST_NETWORK" });
      try { return json(response, 200, await readNetwork(network)); }
      catch { return json(response, 503, { code: "NETWORK_UNAVAILABLE", message: "Could not verify the test network. Try again; no transaction was submitted." }); }
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      return json(response, 200, {
        authority: authorityState(state),
        public: publicElectionState(state),
      });
    }
    if (request.method === "POST" && url.pathname === `/api/elections/${state.election.id}/credential`) {
      const result = issueCredential(state, {
        ...(await body(request)),
        electionId: state.election.id,
      });
      return json(response, result.status, result.body);
    }
    if (request.method === "POST" && url.pathname === `/api/elections/${state.election.id}/vote`) {
      const result = castVote(state, {
        ...(await body(request)),
        electionId: state.election.id,
      });
      return json(response, result.status, result.body);
    }
    if (request.method === "POST" && url.pathname === `/api/elections/${state.election.id}/close`) {
      return json(response, 200, closeElection(state));
    }
    if (request.method === "POST" && url.pathname === "/api/demo/reset") {
      state = createDemoState();
      return json(response, 200, { code: "RESET", public: publicElectionState(state) });
    }
    if (url.pathname.startsWith("/api/")) return json(response, 404, { code: "NOT_FOUND" });
    return serveStatic(url.pathname, response);
  } catch (error) {
    const code = error instanceof SyntaxError ? "INVALID_JSON" : error.message;
    return json(response, code === "BODY_TOO_LARGE" ? 413 : 400, { code });
  }
});

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, HOST, () => {
    console.log(`Private Ballot POC running at http://${HOST}:${PORT}`);
  });
}

export { server };
