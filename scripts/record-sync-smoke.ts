import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createProject, DEFAULT_SETTINGS } from "../src/domain";
import { buildChangeSet } from "../src/record-sync";
import type { Store } from "../src/types";

// Use a disposable local Wrangler database. Never print the secret or cookies.
const origin = process.env.RECORD_SYNC_URL || "http://127.0.0.1:8896";
const secretFile = process.env.RECORD_SYNC_SECRET_FILE || "/tmp/record-sync-smoke/.dev.vars";
const password = /^APP_PASSWORD=(.+)$/m.exec(readFileSync(secretFile, "utf8"))?.[1];
if (!password) throw new Error("Disposable Worker secret is missing.");
const checks: string[] = [];
function check(ok: unknown, message: string) {
  if (!ok) throw new Error(`Failed: ${message}`);
  checks.push(message);
  console.log(`PASS ${message}`);
}
async function api(path: string, method = "GET", body?: unknown, cookie?: string) {
  return fetch(origin + path, { method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }), ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
}
const login = await api("/api/login", "POST", { password });
check(login.status === 200, "real Worker owner login");
const cookie = login.headers.get("Set-Cookie")!.split(";")[0];
const initial = await (await api("/api/state", "GET", undefined, cookie)).json() as { revision: number };
const project = createProject("آزمون همگام‌سازی"); project.id = "record-smoke-project";
project.keywords = [{ id: "r1", keyword: "دوربین مداربسته", group: "", intent: "" }, { id: "r2", keyword: "خرید دوربین مداربسته", group: "", intent: "" }];
const base: Store = { version: 1, activeProjectId: project.id, projects: [project], settings: { ...DEFAULT_SETTINGS } };
const seeded = await api("/api/state", "PUT", { state: base, revision: initial.revision }, cookie);
check(seeded.status === 200, "backward-compatible whole-state seed");
const seededRevision = (await seeded.json() as { revision: number }).revision;
const left = structuredClone(base), right = structuredClone(base);
left.projects[0].keywords[0].intent = "Commercial";
right.projects[0].keywords[0].group = "دوربین";
left.projects[0].keywords[0].updatedAt = "2026-10-07T08:00:00.000Z";
right.projects[0].keywords[0].updatedAt = "2026-10-07T09:00:00.000Z";
left.projects[0].keywords[0].createdAt = "2026-10-07T08:00:00.000Z";
right.projects[0].keywords[0].createdAt = "2026-10-07T09:00:00.000Z";
const save = async (previous: Store, next: Store, revision: number) => api("/api/changes", "POST", { revision, changes: await buildChangeSet(previous, next) }, cookie);
const responses = await Promise.all([save(base, left, seededRevision), save(base, right, seededRevision)]);
check(responses.every((response) => response.status === 200), "real D1 concurrent CAS retries merge separate fields");
const merged = await (await api("/api/state", "GET", undefined, cookie)).json() as { state: Store; revision: number };
check(merged.state.projects[0].keywords[0].intent === "Commercial" && merged.state.projects[0].keywords[0].group === "دوربین" && merged.revision === seededRevision + 2, "legacy read retains both concurrent edits");
check(merged.state.projects[0].keywords[0].updatedAt === "2026-10-07T09:00:00.000Z" && merged.state.projects[0].keywords[0].createdAt === "2026-10-07T08:00:00.000Z", "automatic row timestamps do not cause false field conflicts");
const collision = structuredClone(base);
collision.projects[0].keywords[0].intent = "Informational";
collision.projects[0].keywords[1].group = "نباید ذخیره شود";
const conflicted = await save(base, collision, seededRevision);
const conflictBody = await conflicted.json() as { error: string };
check(conflicted.status === 409 && conflictBody.error === "RECORD_CONFLICT", "same-field conflict is explicit");
const untouched = await (await api("/api/state", "GET", undefined, cookie)).json() as { state: Store; revision: number };
check(untouched.revision === merged.revision && untouched.state.projects[0].keywords[1].group === "", "a rejected patch commits no partial rows");
const history = await (await api(`/api/history?projectId=${project.id}`, "GET", undefined, cookie)).json() as { events: { actorName: string; rowId: string; summary: string }[] };
check(history.events.length >= 2 && history.events.slice(0, 2).every((event) => event.actorName === "علیرضا ملائی" && event.rowId === "r1" && event.summary.includes("ویرایش")), "JSON audit transaction works in real D1");
const large = structuredClone(merged.state);
for (let i = 0; i < 2000; i++) large.projects[0].keywords.push({ id: `large-${i}`, keyword: `دوربین مدل ${i}` });
const largeResponse = await save(merged.state, large, merged.revision);
check(largeResponse.status === 200, "2,000-row incremental import fits local Worker limits");
const largeSaved = await largeResponse.json() as { state: Store; revision: number };
const audit = await (await api(`/api/history?projectId=${project.id}`, "GET", undefined, cookie)).json() as { events: unknown[] };
check(audit.events.length === 200 && largeSaved.state.projects[0].keywords.length === 2002, "bulk audit retention stays bounded without dropping records");
check((await api(`/api/history?projectId=${project.id}`)).status === 401 && (await api("/api/changes", "POST", {})).status === 401, "history and incremental writes require an authenticated account");
const retry = await save(merged.state, large, merged.revision);
check(retry.status === 200 && (await retry.json() as { revision: number }).revision === largeSaved.revision, "lost-response retry is idempotent on real D1");
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/record-sync-worker-smoke.json", JSON.stringify({ passed: checks.length, checks, checkedAt: new Date().toISOString() }, null, 2));
