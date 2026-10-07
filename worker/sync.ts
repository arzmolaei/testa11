import type { D1Database } from "@cloudflare/workers-types";
import { SCHEMAS, validateStore } from "../src/domain";
import { applyChangeSet, validateChangeSet } from "../src/record-sync";
import type { EntityChange } from "../src/record-sync";
import type { Store } from "../src/types";
import type { PublicUser } from "./auth";

export const MAX_CHANGE_BYTES = 6 * 1024 * 1024;
export class RecordSyncError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
const encoder = new TextEncoder(), decoder = new TextDecoder();
const MAX_STATE_BYTES = 25 * 1024 * 1024;
const FIELD_LABELS: Record<string, string> = Object.assign({
  name: "نام پروژه", domain: "دامنه", market: "بازار", language: "زبان", projectType: "نوع پروژه", goal: "هدف پروژه",
  startDate: "تاریخ شروع", lastReview: "آخرین بررسی", playbook: "روال پروژه", searchConsole: "داده‌های Search Console",
  titleMin: "حداقل طول عنوان", titleMax: "حداکثر طول عنوان", metaMin: "حداقل طول متا", metaMax: "حداکثر طول متا",
  customLabels: "نام فیلدهای اختصاصی", playbooks: "روال‌های شخصی", title: "عنوان", status: "وضعیت", assignee: "مسئول",
  dueDate: "موعد انجام", reason: "دلیل اقدام", source: "منبع پیشنهاد", anchor: "عبارت لینک", sourcePage: "صفحهٔ مبدأ",
  targetPage: "صفحهٔ مقصد", fromPageId: "صفحهٔ مبدأ", toPageId: "صفحهٔ مقصد", implementedAt: "تاریخ اجرا", createdAt: "زمان ثبت", updatedAt: "آخرین تغییر", completedAt: "زمان انجام",
}, ...Object.values(SCHEMAS).flatMap((sections) => sections.flatMap((section) => section.fields.map((field) => ({ [field.key]: field.label })))));

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
async function ready(db: D1Database) {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'seo_history'").first<{ name: string }>();
  if (!row) throw new RecordSyncError(503, "RECORD_SYNC_MIGRATION_REQUIRED");
}
async function current(db: D1Database): Promise<{ state: Store | null; revision: number }> {
  const result = await db.prepare("SELECT m.revision, m.snapshot_id, c.chunk_index, c.payload FROM seo_meta m LEFT JOIN seo_chunks c ON c.snapshot_id = m.snapshot_id WHERE m.id = 1 ORDER BY c.chunk_index").all<{ revision: number; snapshot_id: string | null; chunk_index: number | null; payload: string | null }>();
  if (!result.results.length) throw new Error("Database migration missing");
  if (!result.results[0].snapshot_id) return { state: null, revision: result.results[0].revision };
  const raw: unknown = JSON.parse(result.results.map((row) => row.payload || "").join(""));
  const state = validateStore(raw);
  return { state, revision: result.results[0].revision };
}
function chunks(value: string) {
  const bytes = encoder.encode(value);
  if (bytes.length > MAX_STATE_BYTES) throw new RecordSyncError(413, "PAYLOAD_TOO_LARGE");
  const pieces: string[] = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + 900000, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    pieces.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return pieces;
}
export type HistoryEvent = {
  id: string; createdAt: string; revision: number; actorName: string; projectId: string;
  collection: string; rowId: string; summary: string; before?: unknown; after?: unknown;
};
function excerpt(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 250);
  if (typeof value === "number") return value;
  if (object(value)) return Object.fromEntries(Object.entries(value).slice(0, 10).map(([key, item]) => [key, typeof item === "string" ? item.slice(0, 100) : typeof item === "number" ? item : "…"]));
  return null;
}
function event(change: EntityChange, actor: PublicUser, revision: number, createdAt: string, detailed: boolean): HistoryEvent {
  const base = { id: crypto.randomUUID(), createdAt, revision, actorName: actor.displayName, projectId: change.projectId, collection: change.collection, rowId: change.rowId };
  if (change.kind === "create") return { ...base, summary: "افزودن رکورد", ...(detailed ? { after: excerpt(change.after) } : {}) };
  if (change.kind === "delete") return { ...base, summary: "حذف رکورد" };
  const fields = Object.entries(change.fields);
  const summary = `ویرایش ${fields.slice(0, 5).map(([key]) => FIELD_LABELS[key] || (/^custom\d+$/.test(key) ? "فیلد اختصاصی" : key)).join("، ").slice(0, 150)}${fields.length > 5 ? ` و ${fields.length - 5} فیلد دیگر` : ""}`;
  if (!detailed) return { ...base, summary };
  return {
    ...base, summary,
    before: Object.fromEntries(fields.slice(0, 10).map(([key, value]) => [key, value.before.exists ? value.before.hash ? "نسخهٔ قبلی" : excerpt(value.before.value) : null])),
    after: Object.fromEntries(fields.slice(0, 10).map(([key, value]) => [key, value.after.exists ? excerpt(value.after.value) : null])),
  };
}
/** Limit audit work as well as retained rows, even for 20,000-row imports. */
function auditEvents(applied: EntityChange[], actor: PublicUser, revision: number): HistoryEvent[] {
  const perProject = new Map<string, EntityChange[]>();
  for (const change of applied) {
    const group = perProject.get(change.projectId) || [];
    group.push(change);
    if (group.length > 200) group.shift();
    perProject.set(change.projectId, group);
  }
  const createdAt = new Date().toISOString();
  const detailed = applied.length <= 200;
  return Array.from(perProject.values()).flatMap((group) => group.map((change) => event(change, actor, revision, createdAt, detailed)));
}
function eventBatches(events: HistoryEvent[]) {
  const batches: string[] = [];
  let batch: HistoryEvent[] = [], size = 2;
  for (const value of events) {
    const nextSize = encoder.encode(JSON.stringify(value)).length + 1;
    if (size + nextSize > 700000 && batch.length) { batches.push(JSON.stringify(batch)); batch = []; size = 2; }
    batch.push(value); size += nextSize;
  }
  if (batch.length) batches.push(JSON.stringify(batch));
  return batches;
}

export async function putChanges(db: D1Database, input: unknown, actor: PublicUser): Promise<Response> {
  await ready(db);
  if (!object(input) || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0) return json({ error: "INVALID_CHANGES" }, 400);
  let patch;
  try { patch = validateChangeSet(input.changes); } catch { return json({ error: "INVALID_CHANGES" }, 400); }
  // Contention for the global immutable snapshot is retried. Every retry reapplies
  // the original per-field guards to the newly committed state.
  for (let attempt = 0; attempt < 5; attempt++) {
    const saved = await current(db);
    if (!saved.state) return json({ error: "STATE_REQUIRED" }, 409);
    if (Number(input.revision) > saved.revision) return json({ error: "REVISION_CONFLICT" }, 409);
    const merged = await applyChangeSet(saved.state, patch);
    if (merged.conflicts.length) return json({ error: "RECORD_CONFLICT", conflicts: merged.conflicts }, 409);
    if (!merged.applied.length) return json({ state: saved.state, revision: saved.revision });
    let state: Store;
    try { state = validateStore(merged.state); } catch { return json({ error: "INVALID_STATE" }, 400); }
    const snapshot = crypto.randomUUID(), revision = saved.revision + 1;
    const pieces = chunks(JSON.stringify(state));
    const statements = pieces.map((payload, index) => db.prepare("INSERT INTO seo_chunks (snapshot_id, chunk_index, payload, created_at) VALUES (?, ?, ?, ?)").bind(snapshot, index, payload, Math.floor(Date.now() / 1000)));
    const compareIndex = statements.length;
    statements.push(db.prepare("UPDATE seo_meta SET revision = revision + 1, snapshot_id = ? WHERE id = 1 AND revision = ?").bind(snapshot, saved.revision));
    for (const events of eventBatches(auditEvents(merged.applied, actor, revision))) {
      statements.push(db.prepare("INSERT INTO seo_history (id, created_at, revision, actor_name, project_id, collection, row_id, summary, before_json, after_json) SELECT json_extract(value, '$.id'), json_extract(value, '$.createdAt'), json_extract(value, '$.revision'), json_extract(value, '$.actorName'), json_extract(value, '$.projectId'), json_extract(value, '$.collection'), json_extract(value, '$.rowId'), json_extract(value, '$.summary'), json_extract(value, '$.before'), json_extract(value, '$.after') FROM json_each(?) WHERE EXISTS (SELECT 1 FROM seo_meta WHERE id = 1 AND snapshot_id = ?)").bind(events, snapshot));
    }
    const results = await db.batch(statements);
    if (results[compareIndex].meta.changes !== 1) {
      try { await db.prepare("DELETE FROM seo_chunks WHERE snapshot_id = ?").bind(snapshot).run(); } catch { /* Unreachable immutable data is safe. */ }
      continue;
    }
    // Cleanup cannot convert an already committed change into a reported failure.
    try {
      await db.batch([
        db.prepare("DELETE FROM seo_history WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY revision DESC, created_at DESC, id DESC) AS age FROM seo_history) WHERE age > 200)"),
        db.prepare("DELETE FROM seo_chunks WHERE snapshot_id NOT IN (SELECT snapshot_id FROM seo_meta WHERE id = 1 AND snapshot_id IS NOT NULL) AND snapshot_id NOT IN (SELECT snapshot_id FROM seo_chunks GROUP BY snapshot_id ORDER BY MAX(created_at) DESC LIMIT 3)"),
      ]);
    } catch { /* A later successful save can retry bounded-data cleanup. */ }
    return json({ state, revision });
  }
  return json({ error: "SYNC_BUSY" }, 409);
}

export async function getHistory(db: D1Database, projectId: string): Promise<Response> {
  await ready(db);
  if (projectId.length > 200 || !projectId.trim()) return json({ error: "INVALID_PROJECT" }, 400);
  const result = await db.prepare("SELECT id, created_at, revision, actor_name, project_id, collection, row_id, summary, before_json, after_json FROM seo_history WHERE project_id = ? OR project_id = '' ORDER BY revision DESC, created_at DESC, id DESC LIMIT 200").bind(projectId).all<{
    id: string; created_at: string; revision: number; actor_name: string; project_id: string; collection: string; row_id: string; summary: string; before_json: string | null; after_json: string | null;
  }>();
  return json({ events: result.results.map((row): HistoryEvent => ({
    id: row.id, createdAt: row.created_at, revision: row.revision, actorName: row.actor_name, projectId: row.project_id,
    collection: row.collection, rowId: row.row_id, summary: row.summary,
    ...(row.before_json ? { before: JSON.parse(row.before_json) } : {}), ...(row.after_json ? { after: JSON.parse(row.after_json) } : {}),
  })) });
}
