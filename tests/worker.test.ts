import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { chunkJSON, validState } from "../worker/index";
import type { Env } from "../worker/index";
import type { Store } from "../src/types";

const origin = "https://seo.example";
const password = "test-only-long-password-123";

function state(): Store {
  return {
    version: 1,
    activeProjectId: "p1",
    settings: { titleMin: 30, titleMax: 60, metaMin: 100, metaMax: 160 },
    projects: [
      {
        id: "p1",
        name: "پروژه تست",
        domain: "example.com",
        market: "ایران",
        language: "فارسی",
        projectType: "Ecommerce",
        goal: "",
        startDate: "",
        lastReview: "",
        keywords: [{ id: "k1", keyword: "خرید دوربین داهوا", volume: 500 }],
        pages: [],
        content: [],
        results: [],
      },
    ],
  };
}

// An in-memory D1 adapter exercises the real Worker routing, auth and CAS code.
// Local Wrangler smoke tests separately exercise the actual SQLite migration.
class FakeDB {
  revision = 0;
  snapshot: string | null = null;
  snapshots = new Map<string, Map<number, string>>();
  attempts = new Map<string, { attempts: number; window: number }>();
  failure = false;

  prepare(sql: string) {
    const db = this;
    let values: unknown[] = [];
    const statement = {
      sql,
      get values() {
        return values;
      },
      bind(...input: unknown[]) {
        values = input;
        return statement;
      },
      async first() {
        if (db.failure) throw new Error("private database detail");
        if (sql.startsWith("INSERT INTO seo_login_attempts")) {
          const [id, now, cutoff] = values as [string, number, number];
          const old = db.attempts.get(id);
          if (old && old.window > cutoff && old.attempts > 10) return null;
          const next =
            !old || old.window <= cutoff
              ? { attempts: 1, window: now }
              : { ...old, attempts: old.attempts + 1 };
          db.attempts.set(id, next);
          return { attempts: next.attempts };
        }
        throw new Error(`Unsupported test SQL: ${sql}`);
      },
      async all() {
        if (db.failure) throw new Error("private database detail");
        if (sql.startsWith("SELECT m.revision")) {
          const chunks = db.snapshot && db.snapshots.get(db.snapshot);
          return {
            success: true,
            results: chunks
              ? [...chunks]
                  .sort((a, b) => a[0] - b[0])
                  .map(([chunk_index, payload]) => ({
                    revision: db.revision,
                    snapshot_id: db.snapshot,
                    chunk_index,
                    payload,
                  }))
              : [
                  {
                    revision: db.revision,
                    snapshot_id: null,
                    chunk_index: null,
                    payload: null,
                  },
                ],
          };
        }
        throw new Error(`Unsupported test SQL: ${sql}`);
      },
      async run() {
        if (db.failure) throw new Error("private database detail");
        if (sql.startsWith("DELETE FROM seo_login_attempts")) {
          db.attempts.delete(values[0] as string);
          return { success: true, meta: { changes: 1 } };
        }
        if (sql === "DELETE FROM seo_chunks WHERE snapshot_id = ?") {
          db.snapshots.delete(values[0] as string);
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM seo_chunks WHERE snapshot_id NOT IN"))
          return { success: true, meta: { changes: 0 } };
        throw new Error(`Unsupported test SQL: ${sql}`);
      },
    };
    return statement;
  }

  async batch(statements: ReturnType<FakeDB["prepare"]>[]) {
    if (this.failure) throw new Error("private database detail");
    // No await inside this loop: represent D1's atomic transaction for contenders.
    return statements.map((statement) => {
      const [id, index, payload] = statement.values;
      if (statement.sql.startsWith("INSERT INTO seo_chunks")) {
        const chunks =
          this.snapshots.get(id as string) || new Map<number, string>();
        chunks.set(index as number, payload as string);
        this.snapshots.set(id as string, chunks);
        return { success: true, meta: { changes: 1 } };
      }
      if (statement.sql.startsWith("UPDATE seo_meta")) {
        if (this.revision !== index)
          return { success: true, meta: { changes: 0 } };
        this.revision++;
        this.snapshot = id as string;
        return { success: true, meta: { changes: 1 } };
      }
      throw new Error(`Unsupported test SQL: ${statement.sql}`);
    });
  }
}

function request(
  path: string,
  method = "GET",
  body?: unknown,
  session?: string,
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json", Origin: origin }),
      ...(session ? { Cookie: session } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("Cloud Worker", () => {
  let db: FakeDB;
  let env: Env;
  beforeEach(() => {
    vi.useRealTimers();
    db = new FakeDB();
    env = {
      DB: db as unknown as NonNullable<Env["DB"]>,
      APP_PASSWORD: password,
    };
  });

  async function login() {
    const response = await worker.fetch(
      request("/api/login", "POST", { password }),
      env,
    );
    expect(response.status).toBe(200);
    return response.headers.get("Set-Cookie")!.split(";")[0];
  }

  it("reports local-only mode without credentials or D1", async () => {
    expect(
      await (await worker.fetch(request("/api/status"), {})).json(),
    ).toEqual({ configured: false, authenticated: false });
    expect(
      await (
        await worker.fetch(request("/api/status"), {
          ...env,
          APP_PASSWORD: "short",
        })
      ).json(),
    ).toEqual({ configured: false, authenticated: false });
    expect((await worker.fetch(request("/api/state"), {})).status).toBe(503);
  });

  it("protects state and does not authenticate a wrong password", async () => {
    expect((await worker.fetch(request("/api/state"), env)).status).toBe(401);
    expect(
      (
        await worker.fetch(
          request("/api/login", "POST", { password: "wrong" }),
          env,
        )
      ).status,
    ).toBe(401);
  });

  it("sets a secure HttpOnly cookie and authenticates status", async () => {
    const response = await worker.fetch(
      request("/api/login", "POST", { password }),
      env,
    );
    const header = response.headers.get("Set-Cookie")!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Secure");
    expect(
      await (
        await worker.fetch(
          request("/api/status", "GET", undefined, header.split(";")[0]),
          env,
        )
      ).json(),
    ).toEqual({ configured: true, authenticated: true });
  });

  it("supports local HTTP sessions without Secure and clears logout cookies", async () => {
    const response = await worker.fetch(
      new Request("http://localhost:8787/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:8787",
        },
        body: JSON.stringify({ password }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).not.toContain("Secure");
    const logout = await worker.fetch(
      request(
        "/api/logout",
        "POST",
        {},
        response.headers.get("Set-Cookie")!.split(";")[0],
      ),
      env,
    );
    expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("rejects forged, expired and password-rotated sessions", async () => {
    const session = await login();
    expect(
      (
        await worker.fetch(
          request("/api/state", "GET", undefined, session + "x"),
          env,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await worker.fetch(request("/api/state", "GET", undefined, session), {
          ...env,
          APP_PASSWORD: "different-long-password-456",
        })
      ).status,
    ).toBe(401);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(
      (
        await worker.fetch(
          request("/api/state", "GET", undefined, session),
          env,
        )
      ).status,
    ).toBe(401);
  });

  it("rejects cross-origin writes and logins", async () => {
    const session = await login();
    expect(
      (
        await worker.fetch(
          request("/api/login", "POST", { password }, undefined, {
            Origin: "https://evil.example",
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await worker.fetch(
          request(
            "/api/state",
            "PUT",
            { state: state(), revision: 0 },
            session,
            { Origin: "null" },
          ),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await worker.fetch(
          new Request(`${origin}/api/logout`, {
            method: "POST",
            headers: { Cookie: session, "Sec-Fetch-Site": "cross-site" },
          }),
          env,
        )
      ).status,
    ).toBe(403);
  });

  it("rate-limits repeated login guesses", async () => {
    for (let i = 0; i < 10; i++)
      expect(
        (
          await worker.fetch(
            request("/api/login", "POST", { password: "wrong" }),
            env,
          )
        ).status,
      ).toBe(401);
    const limited = await worker.fetch(
      request("/api/login", "POST", { password }),
      env,
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("900");
  });

  it("reads initial state, saves and keeps current state after stale writes", async () => {
    const session = await login();
    expect(
      await (
        await worker.fetch(
          request("/api/state", "GET", undefined, session),
          env,
        )
      ).json(),
    ).toEqual({ state: null, revision: 0 });
    expect(
      await (
        await worker.fetch(
          request(
            "/api/state",
            "PUT",
            { state: state(), revision: 0 },
            session,
          ),
          env,
        )
      ).json(),
    ).toEqual({ revision: 1 });
    const stale = state();
    stale.projects[0].name = "نسخه قدیمی";
    expect(
      (
        await worker.fetch(
          request("/api/state", "PUT", { state: stale, revision: 0 }, session),
          env,
        )
      ).status,
    ).toBe(409);
    expect(
      await (
        await worker.fetch(
          request("/api/state", "GET", undefined, session),
          env,
        )
      ).json(),
    ).toEqual({ state: state(), revision: 1 });
    expect(db.snapshots.size).toBe(1);
  });

  it("allows exactly one winner when two clients save the same revision", async () => {
    const session = await login();
    const contender = state();
    contender.projects[0].name = "نسخه دوم";
    const responses = await Promise.all([
      worker.fetch(
        request("/api/state", "PUT", { state: state(), revision: 0 }, session),
        env,
      ),
      worker.fetch(
        request(
          "/api/state",
          "PUT",
          { state: contender, revision: 0 },
          session,
        ),
        env,
      ),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(db.revision).toBe(1);
    expect(db.snapshots.size).toBe(1);
    const saved = (await (
      await worker.fetch(request("/api/state", "GET", undefined, session), env)
    ).json()) as { state: Store };
    expect(["پروژه تست", "نسخه دوم"]).toContain(saved.state.projects[0].name);
  });

  it("rejects malformed state, duplicate identity and invalid settings", async () => {
    const session = await login();
    expect(
      (
        await worker.fetch(
          request(
            "/api/state",
            "PUT",
            { state: { version: 1 }, revision: 0 },
            session,
          ),
          env,
        )
      ).status,
    ).toBe(400);
    const duplicate = state();
    duplicate.projects[0].keywords.push({
      ...duplicate.projects[0].keywords[0],
    });
    expect(validState(duplicate)).toBe(false);
    const thresholds = state();
    thresholds.settings.titleMin = 100;
    expect(validState(thresholds)).toBe(false);
    const nonexistent = state();
    nonexistent.activeProjectId = "missing";
    expect(validState(nonexistent)).toBe(false);
    expect(
      (
        await worker.fetch(
          request(
            "/api/state",
            "PUT",
            { state: state(), revision: -1 },
            session,
          ),
          env,
        )
      ).status,
    ).toBe(400);
  });

  it("preserves Persian and emoji across bounded UTF-8 chunks", () => {
    const source = JSON.stringify({ text: "دوربین 👁️ یك".repeat(150_000) });
    const chunks = chunkJSON(source);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(source);
    expect(
      chunks.every(
        (chunk) => new TextEncoder().encode(chunk).length <= 900_000,
      ),
    ).toBe(true);
  });

  it("enforces content type, payload limits and malformed JSON", async () => {
    const session = await login();
    const wrongType = new Request(`${origin}/api/state`, {
      method: "PUT",
      headers: { Cookie: session, "Content-Type": "text/plain" },
      body: "{}",
    });
    expect((await worker.fetch(wrongType, env)).status).toBe(415);
    expect(
      (
        await worker.fetch(
          request("/api/state", "PUT", {}, session, {
            "Content-Length": String(26 * 1024 * 1024),
          }),
          env,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await worker.fetch(
          new Request(`${origin}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{",
          }),
          env,
        )
      ).status,
    ).toBe(400);
  });

  it("returns a generic service failure without database details", async () => {
    const session = await login();
    db.failure = true;
    const response = await worker.fetch(
      request("/api/state", "GET", undefined, session),
      env,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"SERVICE_UNAVAILABLE"}');
  });

  it("adds security headers to application assets", async () => {
    const assets = {
      fetch: async () =>
        new Response("<!doctype html><title>SEO Studio</title>", {
          headers: { "Content-Type": "text/html" },
        }),
    } as unknown as Env["ASSETS"];
    const response = await worker.fetch(request("/"), { ASSETS: assets });
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(await response.text()).toContain("SEO Studio");
  });
});
