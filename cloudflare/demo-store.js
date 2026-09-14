import { randomBytes } from "node:crypto";
import { createDemoState, authorityState, publicElectionState, issueCredential, castVote, closeElection, ELECTION_ID } from "../lib/domain.js";

export const SESSION_TTL = 3_600_000;
export const API_BASE = `/api/elections/${ELECTION_ID}`;
export const POST_PATHS = new Set([`${API_BASE}/credential`, `${API_BASE}/vote`, `${API_BASE}/close`, "/api/demo/reset"]);

// Explicit serialization: no submitted credential secret or request body is stored.
function encode(state) {
  return JSON.stringify({ ...state, authority: { ...state.authority, passports: [...state.authority.passports], issued: [...state.authority.issued] }, election: { ...state.election, usedNullifiers: [...state.election.usedNullifiers] } });
}
function decode(value) {
  const state = JSON.parse(value);
  state.authority.passports = new Map(state.authority.passports);
  state.authority.issued = new Map(state.authority.issued);
  state.election.usedNullifiers = new Set(state.election.usedNullifiers);
  return state;
}

// One bounded coordinator, NOT a scalable election service. SQL and domain
// mutations run synchronously with no await between read/check/write. The Durable
// Object caller wraps each request in transactionSync, preventing double issuance
// and double voting even across concurrent requests and isolate restarts.
export class DemoStore {
  constructor(sql, { maxSessions = 250 } = {}) {
    this.sql = sql;
    this.maxSessions = maxSessions;
    sql.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, version TEXT NOT NULL, touched INTEGER NOT NULL, window_start INTEGER NOT NULL, requests INTEGER NOT NULL, data TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS sessions_touched ON sessions(touched)");
    sql.exec("CREATE TABLE IF NOT EXISTS rate_limit (id INTEGER PRIMARY KEY, window_start INTEGER NOT NULL, requests INTEGER NOT NULL)");
  }
  expire(now = Date.now()) {
    this.sql.exec("DELETE FROM sessions WHERE touched <= ?", now - SESSION_TTL);
    return [...this.sql.exec("SELECT COUNT(*) AS count FROM sessions")][0].count;
  }
  handle({ id, method, path, input = {} }, now = Date.now()) {
    this.expire(now);
    const limit = [...this.sql.exec("SELECT * FROM rate_limit WHERE id = 1")][0];
    const newWindow = !limit || now - limit.window_start >= 60_000;
    const windowStart = newWindow ? now : limit.window_start;
    const requests = newWindow ? 1 : limit.requests + 1;
    if (requests > 2400) return { status: 429, body: { code: "DEMO_BUSY" } };
    this.sql.exec("INSERT OR REPLACE INTO rate_limit VALUES (1, ?, ?)", windowStart, requests);
    let row = id ? [...this.sql.exec("SELECT * FROM sessions WHERE id = ?", id)][0] : undefined;
    if (!row) {
      if (method !== "GET" || path !== "/api/state") return { status: 409, body: { code: "DEMO_SESSION_EXPIRED" } };
      const count = [...this.sql.exec("SELECT COUNT(*) AS count FROM sessions")][0].count;
      if (count >= this.maxSessions) return { status: 503, body: { code: "DEMO_CAPACITY_REACHED" } };
      id = randomBytes(32).toString("base64url");
      row = { version: randomBytes(16).toString("hex"), touched: now, window_start: now, requests: 0, data: encode(createDemoState()) };
    }
    if (now - row.window_start >= 60_000) { row.window_start = now; row.requests = 0; }
    if (++row.requests > 120) return { status: 429, body: { code: "DEMO_RATE_LIMIT" } };
    let state = decode(row.data);
    let result;
    if (method === "GET" && path === "/api/state") result = { status: 200, body: { sessionVersion: row.version, authority: authorityState(state), public: publicElectionState(state) } };
    else if (path === `${API_BASE}/credential`) result = issueCredential(state, { ...input, electionId: ELECTION_ID });
    else if (path === `${API_BASE}/vote`) result = castVote(state, { ...input, electionId: ELECTION_ID });
    else if (path === `${API_BASE}/close`) result = { status: 200, body: closeElection(state) };
    else if (path === "/api/demo/reset") {
      state = createDemoState();
      result = { status: 200, body: { code: "RESET", public: publicElectionState(state) } };
    } else return { status: 404, body: { code: "NOT_FOUND" } };
    this.sql.exec("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?, ?, ?)", id, row.version, now, row.window_start, row.requests, encode(state));
    return { ...result, id };
  }
}
