import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyChangeSet, buildChangeSet, recordFingerprint, validateChangeSet } from "../src/record-sync";
import { createProject, DEFAULT_SETTINGS } from "../src/domain";
import type { ChangeSet } from "../src/record-sync";
import type { Store } from "../src/types";
import worker from "../worker/index";
import type { Env } from "../worker/index";
import { TestD1 } from "./helpers/d1";

function fixture(): Store {
  const project = createProject("پروژه آزمون");
  project.id = "p1";
  project.keywords = [{ id: "k1", keyword: "دوربین", intent: "", group: "" }, { id: "k2", keyword: "خرید دوربین", intent: "", group: "" }];
  return { version: 1, projects: [project], activeProjectId: project.id, settings: { ...DEFAULT_SETTINGS } };
}
function changed(base: Store, mutate: (next: Store) => void) { const next = structuredClone(base); mutate(next); return next; }

describe("Record-level three-way merge", () => {
  it("merges different rows and different fields on the same row", async () => {
    const base = fixture();
    const local = changed(base, (next) => { next.projects[0].keywords[0].intent = "Commercial"; next.projects[0].keywords[1].group = "فروش"; });
    const remote = changed(base, (next) => { next.projects[0].keywords[0].group = "دوربین"; });
    const merged = await applyChangeSet(remote, await buildChangeSet(base, local));
    expect(merged.conflicts).toEqual([]);
    expect(merged.state.projects[0].keywords).toMatchObject([{ intent: "Commercial", group: "دوربین" }, { group: "فروش" }]);
    expect(base.projects[0].keywords[0].intent).toBe("");
  });
  it("merges independent stamped fields and preserves the newest bookkeeping timestamp", async () => {
    const base = fixture(); base.projects[0].keywords[0].updatedAt = "2026-10-01T08:00:00.000Z";
    const local = changed(base, (next) => { next.projects[0].keywords[0].intent = "Commercial"; next.projects[0].keywords[0].updatedAt = "2026-10-07T08:00:00.000Z"; });
    const remote = changed(base, (next) => { next.projects[0].keywords[0].group = "دوربین"; next.projects[0].keywords[0].updatedAt = "2026-10-07T09:00:00.000Z"; });
    const merged = await applyChangeSet(remote, await buildChangeSet(base, local));
    expect(merged.conflicts).toEqual([]);
    expect(merged.state.projects[0].keywords[0]).toMatchObject({ intent: "Commercial", group: "دوربین", updatedAt: "2026-10-07T09:00:00.000Z" });
    expect((await applyChangeSet(merged.state, await buildChangeSet(base, local))).applied).toEqual([]);
    const collision = changed(base, (next) => { next.projects[0].keywords[0].intent = "Informational"; next.projects[0].keywords[0].updatedAt = "2026-10-07T10:00:00.000Z"; });
    const rejected = await applyChangeSet(merged.state, await buildChangeSet(base, collision));
    expect(rejected.conflicts[0].fields).toEqual(["intent"]);
    expect(rejected.state).toBe(merged.state);
    expect(rejected.state.projects[0].keywords[0].updatedAt).toBe("2026-10-07T09:00:00.000Z");
  });
  it("merges the first creation-stamp initialization on legacy rows without weakening known-date guards", async () => {
    const base = fixture();
    const local = changed(base, (next) => { Object.assign(next.projects[0].keywords[0], { intent: "Commercial", createdAt: "2026-10-07T08:00:00.000Z", updatedAt: "2026-10-07T08:00:00.000Z" }); });
    const remote = changed(base, (next) => { Object.assign(next.projects[0].keywords[0], { group: "دوربین", createdAt: "2026-10-07T09:00:00.000Z", updatedAt: "2026-10-07T09:00:00.000Z" }); });
    const merged = await applyChangeSet(remote, await buildChangeSet(base, local));
    expect(merged.conflicts).toEqual([]);
    expect(merged.state.projects[0].keywords[0]).toMatchObject({ intent: "Commercial", group: "دوربین", createdAt: "2026-10-07T08:00:00.000Z", updatedAt: "2026-10-07T09:00:00.000Z" });
    expect((await applyChangeSet(merged.state, await buildChangeSet(base, remote))).applied).toEqual([]);
    const changedKnown = changed(merged.state, (next) => { next.projects[0].keywords[0].createdAt = "2026-10-06T08:00:00.000Z"; });
    const independentlyChanged = changed(merged.state, (next) => { next.projects[0].keywords[0].createdAt = "2026-10-05T08:00:00.000Z"; });
    expect((await applyChangeSet(independentlyChanged, await buildChangeSet(merged.state, changedKnown))).conflicts[0].fields).toEqual(["createdAt"]);
  });
  it("rejects the whole batch when any changed field conflicts", async () => {
    const base = fixture();
    const local = changed(base, (next) => { next.projects[0].keywords[0].intent = "Commercial"; next.projects[0].keywords[1].group = "فروش"; });
    const remote = changed(base, (next) => { next.projects[0].keywords[0].intent = "Informational"; });
    const merged = await applyChangeSet(remote, await buildChangeSet(base, local));
    expect(merged.conflicts).toEqual([{ projectId: "p1", collection: "keywords", rowId: "k1", fields: ["intent"] }]);
    expect(merged.state).toBe(remote);
    expect(merged.applied).toEqual([]);
    expect(merged.state.projects[0].keywords[1].group).toBe("");
  });
  it("guards deletion of an edited row and editing a deleted row", async () => {
    const base = fixture();
    const removed = changed(base, (next) => { next.projects[0].keywords.shift(); });
    const edited = changed(base, (next) => { next.projects[0].keywords[0].group = "تغییر جدید"; });
    expect((await applyChangeSet(edited, await buildChangeSet(base, removed))).conflicts[0].fields).toEqual(["record"]);
    expect((await applyChangeSet(removed, await buildChangeSet(base, edited))).conflicts[0].fields).toEqual(["record"]);
  });
  it("is idempotent after a response is lost and distinguishes missing from empty", async () => {
    const base = fixture();
    const next = changed(base, (store) => { store.projects[0].keywords[0].note = ""; store.projects[0].keywords.pop(); store.projects[0].pages.push({ id: "page1", title: "دوربین" }); });
    const patch = await buildChangeSet(base, next);
    expect(patch.changes.find((change) => change.kind === "edit" && change.rowId === "k1")).toMatchObject({ fields: { note: { before: { exists: false }, after: { exists: true, value: "" } } } });
    const retry = await applyChangeSet(next, patch);
    expect(retry.conflicts).toEqual([]);
    expect(retry.applied).toEqual([]);
  });
  it("guards deleting whole projects while merging independent metadata", async () => {
    const base = fixture(); base.projects.push({ ...createProject("دوم"), id: "p2" });
    const removed = changed(base, (next) => { next.projects.shift(); next.activeProjectId = "p2"; });
    const remote = changed(base, (next) => { next.projects[0].keywords[0].note = "یادداشت"; });
    expect((await applyChangeSet(remote, await buildChangeSet(base, removed))).conflicts).toHaveLength(1);
    const clean = await applyChangeSet(base, await buildChangeSet(base, removed));
    expect(clean.state.activeProjectId).toBe("p2");
    const local = changed(base, (next) => { next.projects[0].name = "نام جدید"; });
    const other = changed(base, (next) => { next.projects[0].domain = "new.example"; });
    expect((await applyChangeSet(other, await buildChangeSet(base, local))).state.projects[0]).toMatchObject({ name: "نام جدید", domain: "new.example" });
  });
  it("keeps active project navigation out of a changes payload", async () => {
    const base = fixture(); base.projects.push({ ...createProject("دوم"), id: "p2" });
    expect(await buildChangeSet(base, changed(base, (next) => { next.activeProjectId = "p2"; }))).toEqual({ version: 1, changes: [] });
  });
  it("preserves absent optional collections and supports task/link rows", async () => {
    const base = fixture();
    const next = changed(base, (store) => { store.projects[0].tasks = [{ id: "t1", title: "بررسی عنوان" }]; store.projects[0].links = [{ id: "l1", anchor: "خرید دوربین" }]; });
    const merged = await applyChangeSet(base, await buildChangeSet(base, next));
    expect(merged.state.projects[0].tasks).toEqual(next.projects[0].tasks);
    expect(merged.state.projects[0].links).toEqual(next.projects[0].links);
    expect((await applyChangeSet(base, { version: 1, changes: [] })).state.projects[0]).not.toHaveProperty("tasks");
  });
  it("retries a missing optional-row delete alongside a new row without dropping the new row", async () => {
    const base = fixture(); base.projects[0].tasks = [{ id: "old-task", title: "قدیمی" }];
    const next = changed(base, (store) => { store.projects[0].tasks = [{ id: "new-task", title: "جدید" }]; });
    const remote = fixture();
    const merged = await applyChangeSet(remote, await buildChangeSet(base, next));
    expect(merged.conflicts).toEqual([]);
    expect(merged.state.projects[0].tasks).toEqual(next.projects[0].tasks);
    expect(remote.projects[0]).not.toHaveProperty("tasks");
  });
  it("uses a hash for structured previous values without doubling datasets", async () => {
    const base = fixture() as Store & { projects: Record<string, unknown>[] };
    base.projects[0].searchConsole = { current: { rows: [{ query: "دوربین", page: "/old" }] } } as never;
    const next = changed(base, (store) => { store.projects[0].searchConsole = { current: { rows: [{ query: "دوربین", page: "/new" }] } } as never; });
    const patch = await buildChangeSet(base, next);
    expect(patch.changes[0]).toMatchObject({ fields: { searchConsole: { before: { exists: true, hash: expect.stringMatching(/^[a-f0-9]{64}$/) }, after: { exists: true, value: next.projects[0].searchConsole } } } });
    expect(JSON.stringify(patch)).not.toContain("/old");
    expect((await applyChangeSet(base, patch)).conflicts).toEqual([]);
    const different = changed(base, (store) => { store.projects[0].searchConsole = { current: { rows: [] } } as never; });
    expect((await applyChangeSet(different, patch)).conflicts[0].fields).toEqual(["searchConsole"]);
  });
  it("uses canonical hash guards independent of object-key order", async () => {
    expect(await recordFingerprint({ id: "1", title: "دوربین", note: undefined })).toBe(await recordFingerprint({ title: "دوربین", id: "1" }));
  });
  it("copies touched rows without mutating frozen input or cloning unchanged datasets", async () => {
    const base = fixture();
    base.projects[0].searchConsole = { current: { rows: [{ id: "g1", query: "دوربین", clicks: 1, impressions: 100 }] } } as never;
    const local = changed(base, (next) => { next.projects[0].keywords[0].intent = "Commercial"; });
    function freeze(value: unknown) { if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } }
    freeze(base);
    const merged = await applyChangeSet(base, await buildChangeSet(base, local));
    expect(merged.state.projects[0].keywords[0].intent).toBe("Commercial");
    expect(base.projects[0].keywords[0].intent).toBe("");
    expect(merged.state.projects[0].searchConsole).toBe(base.projects[0].searchConsole);
  });
  it("rejects invalid field guards, duplicate targets and prototype mutation", () => {
    const patch: ChangeSet = { version: 1, changes: [{ collection: "keywords", projectId: "p1", rowId: "k1", kind: "edit", fields: { keyword: { before: { exists: false }, after: { exists: true, value: "نو" } } } }] };
    expect(() => validateChangeSet({ ...patch, changes: [...patch.changes, ...patch.changes] })).toThrow("INVALID_CHANGES");
    const bad = JSON.parse(JSON.stringify(patch)); bad.changes[0].fields = JSON.parse('{"__proto__":{"before":{"exists":false},"after":{"exists":true,"value":"bad"}}}');
    expect(() => validateChangeSet(bad)).toThrow("INVALID_CHANGES");
    const hashAfter = JSON.parse(JSON.stringify(patch)); hashAfter.changes[0].fields.keyword.after = { exists: true, hash: "a".repeat(64) };
    expect(() => validateChangeSet(hashAfter)).toThrow("INVALID_CHANGES");
  });
});

const origin = "https://seo.example", password = "test-only-record-sync-owner-123";
function request(path: string, method = "GET", body?: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return new Request(origin + path, { method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
describe("Incremental Worker sync with actual SQLite transactions", () => {
  let db: TestD1, env: Env, cookie: string, base: Store;
  beforeEach(async () => {
    db = new TestD1();
    db.database.exec(readFileSync(new URL("../migrations/0003_record_sync.sql", import.meta.url), "utf8"));
    env = { DB: db as unknown as NonNullable<Env["DB"]>, APP_PASSWORD: password };
    const response = await worker.fetch(request("/api/login", "POST", { password }), env);
    cookie = response.headers.get("Set-Cookie")!.split(";")[0];
    base = fixture();
    expect((await worker.fetch(request("/api/state", "PUT", { state: base, revision: 0 }, cookie), env)).status).toBe(200);
  });
  afterEach(() => db.close());
  const call = (path: string, method = "GET", body?: unknown, session?: string) => worker.fetch(request(path, method, body, session ?? cookie), env);
  async function sync(next: Store, revision = 1, previous = base) { return call("/api/changes", "POST", { revision, changes: await buildChangeSet(previous, next) }); }
  it("merges stale independent edits and reads the merged state through legacy GET", async () => {
    const left = changed(base, (next) => { next.projects[0].keywords[0].intent = "Commercial"; });
    const right = changed(base, (next) => { next.projects[0].keywords[1].group = "فروش"; });
    expect((await sync(left)).status).toBe(200);
    const merged = await sync(right);
    expect(merged.status).toBe(200);
    const result = await merged.json() as { state: Store; revision: number };
    expect(result.revision).toBe(3);
    expect(result.state.projects[0].keywords).toMatchObject([{ intent: "Commercial" }, { group: "فروش" }]);
    expect(await (await call("/api/state")).json()).toEqual(result);
  });
  it("retries CAS races without losing independent rows or creating false audit records", async () => {
    const left = changed(base, (next) => { next.projects[0].keywords[0].intent = "Commercial"; });
    const right = changed(base, (next) => { next.projects[0].keywords[1].group = "فروش"; });
    const responses = await Promise.all([sync(left), sync(right)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const result = await (await call("/api/state")).json() as { state: Store; revision: number };
    expect(result.revision).toBe(3);
    expect(result.state.projects[0].keywords).toMatchObject([{ intent: "Commercial" }, { group: "فروش" }]);
    expect(db.database.prepare("SELECT COUNT(*) count FROM seo_history").get()!.count).toBe(2);
    expect(db.snapshots.size).toBeLessThanOrEqual(3);
  });
  it("merges concurrent fields on one row and rejects same-field races atomically", async () => {
    const intent = changed(base, (next) => { next.projects[0].keywords[0].intent = "Commercial"; next.projects[0].keywords[0].createdAt = "2026-10-07T08:00:00.000Z"; next.projects[0].keywords[0].updatedAt = "2026-10-07T08:00:00.000Z"; });
    const group = changed(base, (next) => { next.projects[0].keywords[0].group = "دوربین"; next.projects[0].keywords[0].createdAt = "2026-10-07T09:00:00.000Z"; next.projects[0].keywords[0].updatedAt = "2026-10-07T09:00:00.000Z"; });
    expect((await Promise.all([sync(intent), sync(group)])).map((response) => response.status)).toEqual([200, 200]);
    const collision = changed(base, (next) => { next.projects[0].keywords[0].intent = "Informational"; next.projects[0].keywords[1].group = "نباید ذخیره شود"; });
    const response = await sync(collision);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "RECORD_CONFLICT", conflicts: [{ rowId: "k1", fields: ["intent"] }] });
    const saved = await (await call("/api/state")).json() as { state: Store; revision: number };
    expect(saved.revision).toBe(3);
    expect(saved.state.projects[0].keywords[1].group).toBe("");
    expect(saved.state.projects[0].keywords[0].updatedAt).toBe("2026-10-07T09:00:00.000Z");
    expect(saved.state.projects[0].keywords[0].createdAt).toBe("2026-10-07T08:00:00.000Z");
    expect(db.database.prepare("SELECT COUNT(*) count FROM seo_history").get()!.count).toBe(2);
  });
  it("returns the same revision for a retried successful change", async () => {
    const next = changed(base, (store) => { store.projects[0].keywords[0].note = "یادداشت"; });
    expect((await sync(next)).status).toBe(200);
    expect(await (await sync(next)).json()).toMatchObject({ revision: 2 });
    expect(db.database.prepare("SELECT COUNT(*) count FROM seo_history").get()!.count).toBe(1);
  });
  it("retains an edited row when another client attempts its stale deletion", async () => {
    expect((await sync(changed(base, (next) => { next.projects[0].keywords[0].note = "حفظ شود"; }))).status).toBe(200);
    const response = await sync(changed(base, (next) => { next.projects[0].keywords.shift(); }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "RECORD_CONFLICT" });
    expect((await (await call("/api/state")).json() as { state: Store }).state.projects[0].keywords[0].note).toBe("حفظ شود");
  });
  it("rejects invalid merged state and oversized or unauthenticated patch requests", async () => {
    const invalid = changed(base, (next) => { next.settings.titleMin = 999; });
    expect((await sync(invalid)).status).toBe(400);
    expect(db.revision).toBe(1);
    expect((await worker.fetch(request("/api/changes", "POST", {}, undefined), env)).status).toBe(401);
    expect((await worker.fetch(request("/api/history?projectId=p1"), env)).status).toBe(401);
    expect((await worker.fetch(request("/api/changes", "POST", {}, cookie, { "Content-Length": String(7 * 1024 * 1024) }), env)).status).toBe(413);
    expect((await worker.fetch(request("/api/changes", "POST", {}, cookie, { Origin: "https://evil.example" }), env)).status).toBe(403);
  });
  it("allows viewers to read history while immediately denying revoked write roles", async () => {
    const newUser = await call("/api/users", "POST", { username: "editor", displayName: "همکار", role: "editor", password });
    const user = (await newUser.json() as { user: { id: string } }).user;
    const login = await worker.fetch(request("/api/login", "POST", { username: "editor", password }), env);
    const memberCookie = login.headers.get("Set-Cookie")!.split(";")[0];
    const memberPatch = { revision: 1, changes: await buildChangeSet(base, changed(base, (next) => { next.projects[0].keywords[0].note = "ویرایش همکار"; })) };
    expect((await call("/api/changes", "POST", memberPatch, memberCookie)).status).toBe(200);
    expect((await call(`/api/users/${user.id}`, "PATCH", { role: "viewer" })).status).toBe(200);
    expect((await call("/api/changes", "POST", memberPatch, memberCookie)).status).toBe(401);
    const viewerLogin = await worker.fetch(request("/api/login", "POST", { username: "editor", password }), env);
    const viewerCookie = viewerLogin.headers.get("Set-Cookie")!.split(";")[0];
    expect((await call("/api/changes", "POST", memberPatch, viewerCookie)).status).toBe(403);
    const history = await call("/api/history?projectId=p1", "GET", undefined, viewerCookie);
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({ events: [{ actorName: "همکار", rowId: "k1", before: { note: null }, after: { note: "ویرایش همکار" } }] });
  });
  it("keeps only the latest 200 audit records per project without secrets", async () => {
    const next = changed(base, (store) => { for (let i = 0; i < 205; i++) store.projects[0].keywords.push({ id: `bulk${i}`, keyword: `کلمه ${i}` }); });
    expect((await sync(next)).status).toBe(200);
    const later = changed(next, (store) => { store.projects[0].keywords[0].note = "جدیدترین"; });
    expect((await sync(later, 2, next)).status).toBe(200);
    const history = await (await call("/api/history?projectId=p1")).json() as { events: Record<string, unknown>[] };
    expect(history.events).toHaveLength(200);
    expect(history.events[0]).toMatchObject({ rowId: "k1", revision: 3 });
    expect(JSON.stringify(history)).not.toContain(password);
    expect(JSON.stringify(history)).not.toContain("password_hash");
    expect(db.database.prepare("SELECT COUNT(*) count FROM seo_history").get()!.count).toBe(200);
  });
  it("includes shared settings history in each project context", async () => {
    const next = changed(base, (store) => { store.settings.titleMax = 65; store.projects.push({ ...createProject("دوم"), id: "p2" }); });
    expect((await sync(next)).status).toBe(200);
    for (const id of ["p1", "p2"]) {
      const history = await (await call(`/api/history?projectId=${id}`)).json() as { events: { collection: string; projectId: string; summary: string }[] };
      expect(history.events.some((event) => event.collection === "settings" && event.projectId === "" && event.summary.includes("حداکثر طول عنوان"))).toBe(true);
    }
  });
  it("leaves legacy state readable when migration three is missing", async () => {
    db.database.exec("DROP TABLE seo_history");
    expect((await call("/api/state")).status).toBe(200);
    const response = await sync(changed(base, (next) => { next.projects[0].keywords[0].note = "نو"; }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "RECORD_SYNC_MIGRATION_REQUIRED" });
    expect(db.revision).toBe(1);
  });
  it("does not treat an uninitialized database as a workspace", async () => {
    db.database.exec("UPDATE seo_meta SET revision = 0, snapshot_id = NULL");
    const response = await sync(base, 0);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "STATE_REQUIRED" });
  });
});
