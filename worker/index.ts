import { validateStore } from "../src/domain";
import type { D1Database, Fetcher } from "@cloudflare/workers-types";
import type { Store } from "../src/types";
import { Accounts, AuthError, base64url, cookie } from "./auth";
import { getHistory, MAX_CHANGE_BYTES, putChanges, RecordSyncError } from "./sync";

export interface Env {
  DB?: D1Database;
  ASSETS?: Fetcher;
  APP_PASSWORD?: string;
}

const MAX_BYTES = 25 * 1024 * 1024;
const CHUNK_BYTES = 900_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function configured(
  env: Env,
): env is Env & { DB: D1Database; APP_PASSWORD: string } {
  return Boolean(env.DB && env.APP_PASSWORD && env.APP_PASSWORD.length >= 12);
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin) return origin === new URL(request.url).origin;
  const site = request.headers.get("Sec-Fetch-Site");
  return site !== "cross-site" && site !== "same-site";
}

async function readJSON(request: Request, limit: number): Promise<unknown> {
  if (
    !request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new RequestError(415, "JSON_REQUIRED");
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > limit) throw new RequestError(413, "PAYLOAD_TOO_LARGE");
  if (!request.body) throw new RequestError(400, "INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new RequestError(413, "PAYLOAD_TOO_LARGE");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new RequestError(400, "INVALID_JSON");
  }
}

class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validState(value: unknown): value is Store {
  try {
    validateStore(value);
    return true;
  } catch {
    return false;
  }
}

export function chunkJSON(serialized: string): string[] {
  const bytes = encoder.encode(serialized);
  if (bytes.byteLength > MAX_BYTES)
    throw new RequestError(413, "PAYLOAD_TOO_LARGE");
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + CHUNK_BYTES, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return chunks;
}

async function rateLimit(request: Request, db: D1Database, operation: "login" | "password", account: string) {
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get("CF-Connecting-IP") || "local-development";
  // A valid teammate must not clear somebody else's failed-login counter.
  // Hash both values so neither IPs nor account names enter the attempts table.
  const opaque = async (parts: string[]) => base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(parts)))));
  const [overallHash, accountHash] = await Promise.all([opaque([ip, operation]), opaque([ip, operation, account])]);
  // Remove expired unknown-user counters even if nobody successfully logs in.
  await db.prepare("DELETE FROM seo_login_attempts WHERE window_start <= ?").bind(now - 900).run();
  async function reserve(hash: string, limit: number) {
    const attempt = await db.prepare(
      "INSERT INTO seo_login_attempts (ip_hash, attempts, window_start) VALUES (?, 1, ?) ON CONFLICT(ip_hash) DO UPDATE SET attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END, window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END WHERE attempts <= ? OR window_start <= ? RETURNING attempts, window_start",
    ).bind(hash, now, now - 900, now - 900, now, limit, now - 900).first<{ attempts: number; window_start: number }>();
    if (!attempt || attempt.attempts > limit) throw new AuthError(429, "TOO_MANY_ATTEMPTS");
    return attempt.window_start;
  }
  // This bound precedes creation of an account-specific counter. Rotating
  // unregistered usernames cannot fill the table or bypass the IP limit.
  const overallWindow = await reserve(overallHash, 100);
  const accountWindow = await reserve(accountHash, 10);
  return async () => {
    await db.batch([
      db.prepare("DELETE FROM seo_login_attempts WHERE ip_hash = ? AND window_start = ?").bind(accountHash, accountWindow),
      // Remove this successful request from the aggregate; keep all failures.
      // A delayed response must not decrement a newer time window's counter.
      db.prepare("UPDATE seo_login_attempts SET attempts = attempts - 1 WHERE ip_hash = ? AND window_start = ? AND attempts > 0").bind(overallHash, overallWindow),
    ]);
  };
}

async function login(request: Request, env: Env & { DB: D1Database; APP_PASSWORD: string }) {
  const input = await readJSON(request, 4096);
  const name = record(input) && typeof input.username === "string" ? input.username.trim().toLowerCase() : "alireza";
  const complete = await rateLimit(request, env.DB, "login", name);
  const { token, ...session } = await new Accounts(env.DB, env.APP_PASSWORD).login(input);
  await complete();
  return json({ authenticated: true, ...session }, 200, { "Set-Cookie": cookie(request, token) });
}

async function getState(db: D1Database) {
  // A single join reads the revision and its immutable chunks in the same SQLite snapshot.
  const result = await db
    .prepare(
      "SELECT m.revision, m.snapshot_id, c.chunk_index, c.payload FROM seo_meta m LEFT JOIN seo_chunks c ON c.snapshot_id = m.snapshot_id WHERE m.id = 1 ORDER BY c.chunk_index",
    )
    .all<{
      revision: number;
      snapshot_id: string | null;
      chunk_index: number | null;
      payload: string | null;
    }>();
  const rows = result.results;
  if (!rows.length) throw new Error("Database migration missing");
  if (!rows[0].snapshot_id)
    return json({ state: null, revision: rows[0].revision });
  const state: unknown = JSON.parse(
    rows.map((row) => row.payload || "").join(""),
  );
  if (!validState(state)) throw new Error("Invalid saved state");
  return json({ state, revision: rows[0].revision });
}

async function putState(request: Request, db: D1Database) {
  const input = await readJSON(request, MAX_BYTES);
  if (
    !record(input) ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 0 ||
    !validState(input.state)
  )
    return json({ error: "INVALID_STATE" }, 400);
  const revision = Number(input.revision);
  const snapshot = crypto.randomUUID();
  const chunks = chunkJSON(JSON.stringify(input.state));
  const statements = chunks.map((payload, i) =>
    db
      .prepare(
        "INSERT INTO seo_chunks (snapshot_id, chunk_index, payload, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(snapshot, i, payload, Math.floor(Date.now() / 1000)),
  );
  statements.push(
    db
      .prepare(
        "UPDATE seo_meta SET revision = revision + 1, snapshot_id = ? WHERE id = 1 AND revision = ?",
      )
      .bind(snapshot, revision),
  );
  // D1 batch is transactional. Failed CAS leaves only an unreachable immutable snapshot.
  const results = await db.batch(statements);
  if (results[results.length - 1].meta.changes !== 1) {
    try {
      await db
        .prepare("DELETE FROM seo_chunks WHERE snapshot_id = ?")
        .bind(snapshot)
        .run();
    } catch {
      /* an unreachable snapshot is safe and will be pruned later */
    }
    return json({ error: "REVISION_CONFLICT" }, 409);
  }
  // Keep a few complete snapshots. Never delete the live pointer; reads use one query.
  // A cleanup failure does not turn an already committed save into a reported failure.
  try {
    await db
      .prepare(
        "DELETE FROM seo_chunks WHERE snapshot_id NOT IN (SELECT snapshot_id FROM seo_meta WHERE id = 1 AND snapshot_id IS NOT NULL) AND snapshot_id NOT IN (SELECT snapshot_id FROM seo_chunks GROUP BY snapshot_id ORDER BY MAX(created_at) DESC LIMIT 3)",
      )
      .run();
  } catch {
    /* harmless retained snapshots can be removed by the next successful save */
  }
  return json({ revision: revision + 1 });
}

async function handle(request: Request, env: Env) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/")) {
    if (!env.ASSETS)
      return new Response("Build the application with npm run build.", {
        status: 503,
      });
    const asset = await env.ASSETS.fetch(request as never);
    const headers = new Headers();
    asset.headers.forEach((value, key) => headers.set(key, value));
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("X-Frame-Options", "DENY");
    headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    return new Response(asset.body as ReadableStream | null, {
      status: asset.status,
      headers,
    });
  }
  if (path === "/api/status" && request.method === "GET") {
    if (!configured(env)) return json({ configured: false, authenticated: false });
    const accounts = new Accounts(env.DB, env.APP_PASSWORD);
    await accounts.ready();
    const session = await accounts.authenticate(request);
    return json({ configured: true, authenticated: Boolean(session), ...(session || {}) });
  }
  if (!configured(env)) return json({ error: "CLOUD_NOT_CONFIGURED" }, 503);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && !sameOrigin(request))
    return json({ error: "ORIGIN_DENIED" }, 403);
  if (path === "/api/login" && request.method === "POST") return login(request, env);
  if (path === "/api/logout" && request.method === "POST")
    return json({ authenticated: false }, 200, { "Set-Cookie": cookie(request, "", 0) });
  const accounts = new Accounts(env.DB, env.APP_PASSWORD);
  const session = await accounts.authenticate(request);
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);
  if (path === "/api/me" && request.method === "GET") return json(session);
  if (path === "/api/password" && request.method === "POST") {
    const input = await readJSON(request, 4096);
    const complete = await rateLimit(request, env.DB, "password", session.user.username);
    const { token, ...changed } = await accounts.changePassword(session.user.id, input);
    await complete();
    return json(changed, 200, { "Set-Cookie": cookie(request, token) });
  }
  if (path === "/api/users" || /^\/api\/users\/[^/]+$/.test(path)) {
    if (session.user.role !== "owner") return json({ error: "FORBIDDEN" }, 403);
    if (path === "/api/users" && request.method === "GET") return json({ users: await accounts.list() });
    if (path === "/api/users" && request.method === "POST") return json({ user: await accounts.create(await readJSON(request, 4096)) }, 201);
    if (path.startsWith("/api/users/") && request.method === "PATCH") return json({ user: await accounts.update(decodeURIComponent(path.slice("/api/users/".length)), await readJSON(request, 4096)) });
  }
  if (path === "/api/state" && request.method === "GET") return getState(env.DB);
  if (path === "/api/history" && request.method === "GET")
    return getHistory(env.DB, new URL(request.url).searchParams.get("projectId") || "");
  if (path === "/api/changes" && request.method === "POST") {
    if (session.user.role === "viewer") return json({ error: "FORBIDDEN" }, 403);
    return putChanges(env.DB, await readJSON(request, MAX_CHANGE_BYTES), session.user);
  }
  if (path === "/api/state" && request.method === "PUT") {
    if (session.user.role === "viewer") return json({ error: "FORBIDDEN" }, 403);
    return putState(request, env.DB);
  }
  return json({ error: "NOT_FOUND" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (!local && url.protocol === "http:") {
      url.protocol = "https:";
      return new Response(null, { status: 308, headers: { Location: url.href, "Cache-Control": "no-store" } });
    }
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof RequestError || error instanceof AuthError || error instanceof RecordSyncError)
        return json({ error: error.code }, error.status, error.status === 429 ? { "Retry-After": "900" } : {});
      return json({ error: "SERVICE_UNAVAILABLE" }, 503);
    }
  },
};
