import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import type { Env } from "../worker/index";
import { hashPassword, verifyPassword } from "../worker/auth";
import type { TeamUser, UserRow } from "../worker/auth";
import { TestD1 } from "./helpers/d1";

const origin = "https://seo.example";
const secret = "test-only-owner-password-123";
const memberPassword = "test-only-member-password-456";
function request(path: string, method = "GET", body?: unknown, session?: string, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }), ...(session ? { Cookie: session } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function session(response: Response) { return response.headers.get("Set-Cookie")!.split(";")[0]; }

describe("Team accounts with actual SQLite SQL", () => {
  let db: TestD1;
  let env: Env;
  beforeEach(() => {
    vi.useRealTimers();
    db = new TestD1();
    env = { DB: db as unknown as NonNullable<Env["DB"]>, APP_PASSWORD: secret };
  });
  afterEach(() => { db.close(); vi.useRealTimers(); });
  async function call(path: string, method = "GET", body?: unknown, cookie?: string, headers: Record<string, string> = {}) {
    return worker.fetch(request(path, method, body, cookie, headers), env);
  }
  async function login(username = "alireza", password = secret) {
    const response = await call("/api/login", "POST", { username, password });
    expect(response.status).toBe(200);
    return session(response);
  }
  async function create(owner: string, username: string, role = "editor") {
    const response = await call("/api/users", "POST", { username, displayName: "همکار سئو", role, password: memberPassword }, owner);
    expect(response.status).toBe(201);
    return (await response.json() as { user: TeamUser }).user;
  }

  it("boots only a validated owner and stores salted hashes rather than the bootstrap secret", async () => {
    expect((await call("/api/status")).status).toBe(200);
    expect(db.database.prepare("SELECT COUNT(*) count FROM seo_users").get()!.count).toBe(0);
    expect((await call("/api/login", "POST", { password: "wrong" })).status).toBe(401);
    expect(db.database.prepare("SELECT COUNT(*) count FROM seo_users").get()!.count).toBe(0);
    const owner = await login();
    const row = db.database.prepare("SELECT * FROM seo_users").get() as unknown as UserRow;
    expect(row.role).toBe("owner");
    expect(row.password_hash).not.toContain(secret);
    expect(await verifyPassword(secret, row.password_hash)).toBe(true);
    expect((await (await call("/api/me", "GET", undefined, owner)).json())).toMatchObject({ user: { username: "alireza", displayName: "علیرضا ملائی", role: "owner" } });
  });

  it("creates only one owner when two first logins race", async () => {
    const responses = await Promise.all([call("/api/login", "POST", { password: secret }), call("/api/login", "POST", { password: secret })]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(db.database.prepare("SELECT COUNT(*) count FROM seo_users").get()!.count).toBe(1);
    for (const response of responses) expect((await call("/api/me", "GET", undefined, session(response))).status).toBe(200);
  });

  it("requires the team migration with an actionable error and never falls back to anonymous access", async () => {
    db.database.exec("DROP TABLE seo_users");
    const status = await call("/api/status");
    expect(status.status).toBe(503);
    expect(await status.json()).toEqual({ error: "TEAM_MIGRATION_REQUIRED" });
    const loginResponse = await call("/api/login", "POST", { password: secret });
    expect(loginResponse.status).toBe(503);
    expect(await loginResponse.json()).toEqual({ error: "TEAM_MIGRATION_REQUIRED" });
    expect((await call("/api/state")).status).toBe(401);
  });

  it("protects user management and workspace data from anonymous requests", async () => {
    for (const [path, method, body] of [["/api/users", "GET", undefined], ["/api/users", "POST", {}], ["/api/users/unknown", "PATCH", {}], ["/api/me", "GET", undefined], ["/api/password", "POST", {}], ["/api/state", "PUT", {}]] as const) {
      expect((await call(path, method, body)).status).toBe(401);
    }
  });

  it("creates independent accounts, normalizes usernames and returns no password material", async () => {
    const owner = await login();
    const member = await create(owner, "  Sara.SEO  ", "viewer");
    expect(member.username).toBe("sara.seo");
    expect(member.disabled).toBe(false);
    const all = await (await call("/api/users", "GET", undefined, owner)).json() as { users: TeamUser[] };
    expect(all.users).toHaveLength(2);
    expect(JSON.stringify(all)).not.toContain("password");
    expect(JSON.stringify(all)).not.toContain("auth_version");
    const response = await call("/api/login", "POST", { username: "SARA.SEO", password: memberPassword });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { id: member.id, role: "viewer" }, expiresAt: expect.any(String) });
    const status = await (await call("/api/status", "GET", undefined, session(response))).json() as { expiresAt: string; authenticated: boolean };
    expect(Date.parse(status.expiresAt)).toBeGreaterThan(Date.now());
    expect(status.authenticated).toBe(true);
  });

  it("rejects duplicate accounts, invalid usernames, weak passwords and extra owners", async () => {
    const owner = await login();
    await create(owner, "sara");
    const baseline = { username: "newuser", displayName: "همکار", role: "editor", password: memberPassword };
    const duplicate = await call("/api/users", "POST", { ...baseline, username: "SARA" }, owner);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "USERNAME_EXISTS" });
    for (const delta of [{ username: "<script>" }, { username: "سارا" }, { password: "short" }, { password: "x".repeat(129) }, { role: "owner" }, { displayName: "\n" }]) {
      expect((await call("/api/users", "POST", { ...baseline, ...delta }, owner)).status).toBe(400);
    }
    expect(db.database.prepare("SELECT COUNT(*) count FROM seo_users").get()!.count).toBe(2);
  });

  it("keeps the team size bounded even when the last available account slot has concurrent requests", async () => {
    const owner = await login();
    const row = db.database.prepare("SELECT password_hash FROM seo_users LIMIT 1").get()!;
    const insert = db.database.prepare("INSERT INTO seo_users (id, username, display_name, role, password_hash, created_at) VALUES (?, ?, ?, 'viewer', ?, 1)");
    for (let i = 0; i < 98; i++) insert.run(`seed${i}`, `seed${i}`, "همکار", String(row.password_hash));
    const baseline = { displayName: "همکار", role: "editor", password: memberPassword };
    const responses = await Promise.all([call("/api/users", "POST", { ...baseline, username: "contender1" }, owner), call("/api/users", "POST", { ...baseline, username: "contender2" }, owner)]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(db.database.prepare("SELECT COUNT(*) count FROM seo_users").get()!.count).toBe(100);
  });

  it("enforces viewer read-only access on the backend and blocks team administration", async () => {
    const owner = await login();
    await create(owner, "viewer", "viewer");
    const viewer = await login("viewer", memberPassword);
    expect((await call("/api/state", "GET", undefined, viewer)).status).toBe(200);
    expect((await call("/api/state", "PUT", {}, viewer)).status).toBe(403);
    for (const [path, method, body] of [["/api/users", "GET", undefined], ["/api/users", "POST", {}], ["/api/users/unknown", "PATCH", {}]] as const) expect((await call(path, method, body, viewer)).status).toBe(403);
  });

  it("lets editors reach workspace validation but blocks owner operations", async () => {
    const owner = await login();
    await create(owner, "editor");
    const editor = await login("editor", memberPassword);
    expect((await call("/api/state", "PUT", {}, editor)).status).toBe(400);
    expect((await call("/api/users", "GET", undefined, editor)).status).toBe(403);
  });

  it("revokes a session immediately when its account is disabled, and accepts a later reenable", async () => {
    const owner = await login();
    const user = await create(owner, "sara");
    const before = await login("sara", memberPassword);
    expect((await call(`/api/users/${user.id}`, "PATCH", { disabled: true }, owner)).status).toBe(200);
    expect((await call("/api/state", "GET", undefined, before)).status).toBe(401);
    const denied = await call("/api/login", "POST", { username: "sara", password: memberPassword });
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "INVALID_CREDENTIALS" });
    expect((await call(`/api/users/${user.id}`, "PATCH", { disabled: false }, owner)).status).toBe(200);
    expect((await call("/api/me", "GET", undefined, await login("sara", memberPassword))).status).toBe(200);
    expect((await call("/api/me", "GET", undefined, before)).status).toBe(401);
  });

  it("keeps a valid teammate session when only its display name changes and the existing role is repeated", async () => {
    const owner = await login();
    const user = await create(owner, "sara");
    const active = await login("sara", memberPassword);
    expect((await call(`/api/users/${user.id}`, "PATCH", { displayName: "سارا", role: "editor" }, owner)).status).toBe(200);
    const response = await call("/api/me", "GET", undefined, active);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { displayName: "سارا", role: "editor" } });
  });

  it("revokes old sessions on role changes and applies the new role after login", async () => {
    const owner = await login();
    const user = await create(owner, "sara");
    const old = await login("sara", memberPassword);
    expect((await call(`/api/users/${user.id}`, "PATCH", { role: "viewer" }, owner)).status).toBe(200);
    expect((await call("/api/state", "GET", undefined, old)).status).toBe(401);
    expect((await call("/api/state", "PUT", {}, await login("sara", memberPassword))).status).toBe(403);
  });

  it("supports owner password resets for teammates and invalidates their old sessions", async () => {
    const owner = await login();
    const user = await create(owner, "sara");
    const old = await login("sara", memberPassword);
    const changedPassword = "reset-only-member-password-789";
    expect((await call(`/api/users/${user.id}`, "PATCH", { password: changedPassword }, owner)).status).toBe(200);
    expect((await call("/api/me", "GET", undefined, old)).status).toBe(401);
    expect((await call("/api/login", "POST", { username: "sara", password: memberPassword })).status).toBe(401);
    await login("sara", changedPassword);
  });

  it("requires the current password, refreshes only the changing session and leaves no bootstrap backdoor", async () => {
    const owner = await login();
    const other = await login();
    const changedPassword = "new-only-owner-password-789";
    expect((await call("/api/password", "POST", { currentPassword: "wrong", password: changedPassword }, owner)).status).toBe(401);
    expect((await call("/api/me", "GET", undefined, owner)).status).toBe(200);
    const changed = await call("/api/password", "POST", { currentPassword: secret, password: changedPassword }, owner);
    expect(changed.status).toBe(200);
    expect((await call("/api/me", "GET", undefined, session(changed))).status).toBe(200);
    expect((await call("/api/me", "GET", undefined, owner)).status).toBe(401);
    expect((await call("/api/me", "GET", undefined, other)).status).toBe(401);
    expect((await call("/api/login", "POST", { password: secret })).status).toBe(401);
    await login("alireza", changedPassword);
    expect(db.database.prepare("SELECT COUNT(*) count FROM seo_users").get()!.count).toBe(1);
  });

  it("protects the owner account from disabling, downgrading and bypassed password reset", async () => {
    const owner = await login();
    const user = (await (await call("/api/me", "GET", undefined, owner)).json() as { user: TeamUser }).user;
    for (const change of [{ disabled: true }, { role: "viewer" }, { password: memberPassword }]) {
      expect((await call(`/api/users/${user.id}`, "PATCH", change, owner)).status).toBe(403);
    }
    expect((await call(`/api/users/${user.id}`, "PATCH", { displayName: "علیرضا" }, owner)).status).toBe(200);
    expect(await (await call("/api/me", "GET", undefined, owner)).json()).toMatchObject({ user: { displayName: "علیرضا" } });
  });

  it("rejects malformed updates without touching stored data", async () => {
    const owner = await login();
    const user = await create(owner, "sara");
    for (const change of [{ username: "renamed" }, { disabled: "true" }, { displayName: "" }, { role: "owner" }, {}, { password: "tiny" }]) expect((await call(`/api/users/${user.id}`, "PATCH", change, owner)).status).toBe(400);
    expect((await call("/api/users/unknown", "PATCH", { disabled: true }, owner)).status).toBe(404);
    const all = await (await call("/api/users", "GET", undefined, owner)).json() as { users: TeamUser[] };
    expect(all.users.find((entry) => entry.id === user.id)).toEqual(user);
  });

  it("denies cross-origin account creation, updates and password changes", async () => {
    const owner = await login();
    for (const [path, method] of [["/api/users", "POST"], ["/api/users/unknown", "PATCH"], ["/api/password", "POST"]]) expect((await call(path, method, {}, owner, { Origin: "https://evil.example" })).status).toBe(403);
  });

  it("uses the same invalid-credentials error for unknown and disabled users and rate limits attempts", async () => {
    const owner = await login();
    const user = await create(owner, "disabled");
    await call(`/api/users/${user.id}`, "PATCH", { disabled: true }, owner);
    const bodies: unknown[] = [];
    for (const username of ["unknown", "disabled", "alireza"]) {
      const response = await call("/api/login", "POST", { username, password: "wrong" });
      expect(response.status).toBe(401);
      bodies.push(await response.json());
    }
    expect(bodies).toEqual([{ error: "INVALID_CREDENTIALS" }, { error: "INVALID_CREDENTIALS" }, { error: "INVALID_CREDENTIALS" }]);
    for (let i = 0; i < 9; i++) expect((await call("/api/login", "POST", { username: "alireza", password: "wrong" })).status).toBe(401);
    const limited = await call("/api/login", "POST", { username: "alireza", password: secret });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("900");
  });

  it("does not let a valid teammate reset another account's failed-login limit", async () => {
    const owner = await login();
    await create(owner, "viewer", "viewer");
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await call("/api/login", "POST", { username: "alireza", password: "wrong" })).status).toBe(401);
      await login("viewer", memberPassword);
    }
    expect(db.database.prepare("SELECT attempts FROM seo_login_attempts WHERE attempts > 0 ORDER BY attempts").all().map((entry) => entry.attempts)).toEqual([10, 10]);
    const limited = await call("/api/login", "POST", { username: "ALIREZA", password: secret });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "TOO_MANY_ATTEMPTS" });
    expect((await call("/api/login", "POST", { password: secret })).status).toBe(429);
    await login("viewer", memberPassword);
    expect((await call("/api/me", "GET", undefined, owner)).status).toBe(200);
  });

  it("bounds rotating unknown usernames by IP and removes expired counters even after only failed attempts", async () => {
    const now = Date.now();
    vi.useFakeTimers(); vi.setSystemTime(now);
    for (let index = 0; index < 100; index++) {
      expect((await call("/api/login", "POST", { username: `unknown-${index}`, password: "wrong" })).status).toBe(401);
    }
    for (let index = 100; index < 120; index++) {
      expect((await call("/api/login", "POST", { username: `unknown-${index}`, password: "wrong" })).status).toBe(429);
    }
    expect(db.database.prepare("SELECT COUNT(*) count FROM seo_login_attempts").get()!.count).toBe(101);
    vi.setSystemTime(now + 901000);
    expect((await call("/api/login", "POST", { username: "unknown-after-window", password: "wrong" })).status).toBe(401);
    expect(db.database.prepare("SELECT COUNT(*) count FROM seo_login_attempts").get()!.count).toBe(2);
    expect(db.database.prepare("SELECT MIN(window_start) oldest FROM seo_login_attempts").get()!.oldest).toBe(Math.floor((now + 901000) / 1000));
  }, 10000);
});

describe("Password hashing", () => {
  it("uses independent salts, verifies unicode exactly and rejects altered or malformed hashes", async () => {
    const password = "گذرواژه طولانی 😃 امنیت";
    const a = await hashPassword(password), b = await hashPassword(password);
    expect(a).not.toBe(b);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword(password + " ", a)).toBe(false);
    expect(await verifyPassword(password, a.replace("100000", "99999999"))).toBe(false);
    expect(await verifyPassword(password, "plaintext")).toBe(false);
  });
});
