import type { D1Database } from "@cloudflare/workers-types";

export type Role = "owner" | "editor" | "viewer";
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}
export interface TeamUser extends PublicUser {
  disabled: boolean;
  createdAt: string;
}
export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  disabled: number;
  password_hash: string;
  auth_version: number;
  created_at: number;
}
export interface Session {
  user: PublicUser;
  expiresAt: string;
}

export const COOKIE = "seo_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
const ITERATIONS = 100_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const USER_COLUMNS = "id, username, display_name, role, disabled, password_hash, auth_version, created_at";
const INVALID_HASH = `pbkdf2-sha256$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

export class AuthError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unbase64url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
function sameBytes(a: Uint8Array, b: Uint8Array) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations }, key, 256));
}
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${base64url(salt)}$${base64url(await derivePassword(password, salt, ITERATIONS))}`;
}
export async function verifyPassword(password: string, hash: string) {
  try {
    const [algorithm, iterationsText, saltText, digestText, extra] = hash.split("$");
    const iterations = Number(iterationsText);
    if (algorithm !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < ITERATIONS || iterations > ITERATIONS || extra) return false;
    const salt = unbase64url(saltText);
    const digest = unbase64url(digestText);
    if (salt.length !== 16 || digest.length !== 32) return false;
    return sameBytes(await derivePassword(password, salt, iterations), digest);
  } catch { return false; }
}
async function bootstrapPasswordMatches(password: string, expected: string) {
  return sameBytes(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(password))), new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(expected))));
}
function publicUser(row: UserRow): PublicUser {
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
}
function teamUser(row: UserRow): TeamUser {
  return { ...publicUser(row), disabled: Boolean(row.disabled), createdAt: new Date(row.created_at * 1000).toISOString() };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function username(value: unknown) {
  if (typeof value !== "string") throw new AuthError(400, "INVALID_USERNAME");
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{2,31}$/.test(normalized)) throw new AuthError(400, "INVALID_USERNAME");
  return normalized;
}
function displayName(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw new AuthError(400, "INVALID_DISPLAY_NAME");
  return value.trim();
}
function newPassword(value: unknown) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) throw new AuthError(400, "PASSWORD_LENGTH");
  return value;
}
async function sessionKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(`seo-studio-team-session-v2:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export function cookie(request: Request, value: string, maxAge = SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

export class Accounts {
  constructor(private db: D1Database, private secret: string) {}

  private async query<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/no such table:\s*(?:main\.)?seo_users/i.test(message)) throw new AuthError(503, "TEAM_MIGRATION_REQUIRED");
      throw error;
    }
  }
  async ready() {
    await this.query(() => this.db.prepare("SELECT id FROM seo_users LIMIT 1").first<{ id: string }>());
  }
  private async byUsername(value: string) {
    return this.query(() => this.db.prepare(`SELECT ${USER_COLUMNS} FROM seo_users WHERE username = ?`).bind(value).first<UserRow>());
  }
  private async byId(id: string) {
    return this.query(() => this.db.prepare(`SELECT ${USER_COLUMNS} FROM seo_users WHERE id = ?`).bind(id).first<UserRow>());
  }
  async authenticate(request: Request): Promise<Session | null> {
    const value = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!value || value.length > 1024) return null;
    let payloadData: { expires?: unknown; userId?: unknown; authVersion?: unknown };
    try {
      const [payload, signature, extra] = value.split(".");
      if (!payload || !signature || extra) return null;
      if (!(await crypto.subtle.verify("HMAC", await sessionKey(this.secret), unbase64url(signature), encoder.encode(payload)))) return null;
      payloadData = JSON.parse(decoder.decode(unbase64url(payload)));
      if (!record(payloadData) || typeof payloadData.expires !== "number" || payloadData.expires <= Date.now() / 1000 || payloadData.expires > Date.now() / 1000 + SESSION_SECONDS + 60 || typeof payloadData.userId !== "string" || !Number.isSafeInteger(payloadData.authVersion)) return null;
    } catch { return null; }
    // Read on every request: disabling an account or changing its role/password revokes all sessions.
    const row = await this.byId(payloadData.userId as string);
    if (!row || row.disabled || row.auth_version !== payloadData.authVersion) return null;
    return { user: publicUser(row), expiresAt: new Date((payloadData.expires as number) * 1000).toISOString() };
  }
  private async issue(row: UserRow) {
    const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const payload = base64url(encoder.encode(JSON.stringify({ expires, userId: row.id, authVersion: row.auth_version, nonce: crypto.randomUUID() })));
    const signature = await crypto.subtle.sign("HMAC", await sessionKey(this.secret), encoder.encode(payload));
    return { user: publicUser(row), expiresAt: new Date(expires * 1000).toISOString(), token: `${payload}.${base64url(new Uint8Array(signature))}` };
  }
  async login(input: unknown) {
    if (!record(input) || typeof input.password !== "string" || input.password.length > 1024 || (input.username !== undefined && typeof input.username !== "string")) throw new AuthError(400, "INVALID_REQUEST");
    // The old installer sends only a password. Its one-time owner name remains stable.
    const name = typeof input.username === "string" ? input.username.trim().toLowerCase() : "alireza";
    let row = await this.byUsername(name);
    if (!row && name === "alireza") {
      const any = await this.query(() => this.db.prepare("SELECT id FROM seo_users LIMIT 1").first<{ id: string }>());
      if (!any && await bootstrapPasswordMatches(input.password, this.secret)) {
        const hash = await hashPassword(input.password);
        await this.query(() => this.db.prepare("INSERT OR IGNORE INTO seo_users (id, username, display_name, role, disabled, password_hash, auth_version, created_at) SELECT ?, 'alireza', 'علیرضا ملائی', 'owner', 0, ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM seo_users)").bind(crypto.randomUUID(), hash, Math.floor(Date.now() / 1000)).run());
        row = await this.byUsername(name);
      }
    }
    // Unknown and disabled accounts take the same password derivation path and share one error.
    const valid = await verifyPassword(input.password, row?.password_hash || INVALID_HASH);
    if (!valid || !row || row.disabled) throw new AuthError(401, "INVALID_CREDENTIALS");
    return this.issue(row);
  }
  async list() {
    const result = await this.query(() => this.db.prepare(`SELECT ${USER_COLUMNS} FROM seo_users ORDER BY created_at, username`).all<UserRow>());
    return result.results.map(teamUser);
  }
  async create(input: unknown) {
    if (!record(input)) throw new AuthError(400, "INVALID_REQUEST");
    const name = username(input.username);
    const display = displayName(input.displayName);
    const password = newPassword(input.password);
    if (input.role !== "editor" && input.role !== "viewer") throw new AuthError(400, "INVALID_ROLE");
    const count = await this.query(() => this.db.prepare("SELECT COUNT(*) AS count FROM seo_users").first<{ count: number }>());
    if ((count?.count || 0) >= 100) throw new AuthError(409, "TEAM_LIMIT_REACHED");
    const id = crypto.randomUUID();
    const hash = await hashPassword(password);
    const result = await this.query(() => this.db.prepare("INSERT OR IGNORE INTO seo_users (id, username, display_name, role, disabled, password_hash, auth_version, created_at) SELECT ?, ?, ?, ?, 0, ?, 1, ? WHERE (SELECT COUNT(*) FROM seo_users) < 100").bind(id, name, display, input.role, hash, Math.floor(Date.now() / 1000)).run());
    if (result.meta.changes !== 1) throw new AuthError(409, await this.byUsername(name) ? "USERNAME_EXISTS" : "TEAM_LIMIT_REACHED");
    return teamUser((await this.byId(id))!);
  }
  async update(id: string, input: unknown) {
    if (!record(input) || !Object.keys(input).length || Object.keys(input).some((key) => !["displayName", "role", "disabled", "password"].includes(key))) throw new AuthError(400, "INVALID_REQUEST");
    const row = await this.byId(id);
    if (!row) throw new AuthError(404, "USER_NOT_FOUND");
    if (("role" in input && input.role !== "editor" && input.role !== "viewer") || ("disabled" in input && typeof input.disabled !== "boolean")) throw new AuthError(400, "INVALID_REQUEST");
    if (row.role === "owner" && (("role" in input && input.role !== "owner") || input.disabled === true || "password" in input)) throw new AuthError(403, "OWNER_PROTECTED");
    const assignments: string[] = [];
    const values: unknown[] = [];
    if ("displayName" in input) { assignments.push("display_name = ?"); values.push(displayName(input.displayName)); }
    if ("role" in input) { assignments.push("role = ?"); values.push(input.role); }
    if ("disabled" in input) { assignments.push("disabled = ?"); values.push(input.disabled ? 1 : 0); }
    if ("password" in input) { assignments.push("password_hash = ?"); values.push(await hashPassword(newPassword(input.password))); }
    const revoke = ("role" in input && input.role !== row.role)
      || ("disabled" in input && Number(input.disabled) !== row.disabled)
      || "password" in input;
    if (revoke) assignments.push("auth_version = auth_version + 1");
    values.push(id, row.auth_version);
    const result = await this.query(() => this.db.prepare(`UPDATE seo_users SET ${assignments.join(", ")} WHERE id = ? AND auth_version = ?`).bind(...values).run());
    if (result.meta.changes !== 1) throw new AuthError(409, "USER_CHANGED");
    return teamUser((await this.byId(id))!);
  }
  async changePassword(userId: string, input: unknown) {
    if (!record(input) || typeof input.currentPassword !== "string" || input.currentPassword.length > 1024) throw new AuthError(400, "INVALID_REQUEST");
    const password = newPassword(input.password);
    const row = await this.byId(userId);
    if (!row || row.disabled || !(await verifyPassword(input.currentPassword, row.password_hash))) throw new AuthError(401, "INVALID_CREDENTIALS");
    const hash = await hashPassword(password);
    const result = await this.query(() => this.db.prepare("UPDATE seo_users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ? AND auth_version = ? AND disabled = 0").bind(hash, userId, row.auth_version).run());
    if (result.meta.changes !== 1) throw new AuthError(409, "USER_CHANGED");
    return this.issue((await this.byId(userId))!);
  }
}
