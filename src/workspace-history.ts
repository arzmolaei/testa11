import type { Project, Row, Store } from "./types";
import { validateStore } from "./domain";
import { applyChangeSet, buildChangeSet, recordFingerprint, validateChangeSet } from "./record-sync";
import type { ChangeSet, EntityChange } from "./record-sync";

export const HISTORY_LIMIT = 50;
export const HISTORY_BYTES = 16 * 1024 * 1024;
export type HistoryEntry = {
  id: string; title: string; at: string; projectIds: string[];
  beforeActive: string; afterActive: string; undo: ChangeSet; redo: ChangeSet;
  order?: { projectId: string; collection: string; before: string[]; after: string[] }[];
};
export type HistoryState = { version: 1; past: HistoryEntry[]; future: HistoryEntry[] };
export const emptyHistory = (): HistoryState => ({ version: 1, past: [], future: [] });
export const historySize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const labels: Record<string, string> = { keywords: "کلمه", pages: "صفحه", content: "محتوا", results: "نتیجه", tasks: "کار", links: "لینک", projects: "پروژه", settings: "تنظیمات" };
const collections = ["keywords", "pages", "content", "results", "tasks", "links"] as const;
const address = (change: EntityChange) => JSON.stringify([change.collection, change.projectId, change.rowId]);
function withoutStamps(changes: ChangeSet): ChangeSet {
  return { version: 1, changes: changes.changes.flatMap(change => {
    if (change.kind !== "edit" || change.collection === "settings" || change.collection === "projects") return [change];
    const fields = Object.fromEntries(Object.entries(change.fields).filter(([key]) => !["createdAt", "updatedAt"].includes(key)));
    return Object.keys(fields).length ? [{ ...change, fields }] : [];
  }) };
}
function describe(changes: ChangeSet): string {
  const kinds = new Set(changes.changes.map(change => change.kind));
  const names = [...new Set(changes.changes.map(change => labels[change.collection]))];
  const verb = kinds.size === 1 ? ({ create: "افزودن", delete: "حذف", edit: "ویرایش" } as const)[[...kinds][0]] : "تغییر";
  const count = changes.changes.length.toLocaleString("fa-IR");
  return `${verb} ${count} ${names.length <= 2 ? names.join(" و ") : "مورد در چند بخش"}`;
}
export async function makeHistoryEntry(before: Store, after: Store, title?: string): Promise<HistoryEntry | null> {
  const redo = withoutStamps(await buildChangeSet(before, after));
  if (!redo.changes.length) return null; // Navigation is a device preference.
  const undo = withoutStamps(await buildChangeSet(after, before));
  const order: NonNullable<HistoryEntry["order"]> = [];
  const seen = new Set<string>();
  for (const change of redo.changes) {
    if (change.kind === "edit" || change.collection === "settings") continue;
    const key = `${change.projectId}:${change.collection}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (change.collection === "projects") {
      if (!order.some(item => item.collection === "projects")) order.push({ projectId: "", collection: "projects", before: before.projects.map(project => project.id), after: after.projects.map(project => project.id) });
    } else {
      order.push({ projectId: change.projectId, collection: change.collection, before: (before.projects.find(project => project.id === change.projectId)?.[change.collection] || []).map(row => row.id), after: (after.projects.find(project => project.id === change.projectId)?.[change.collection] || []).map(row => row.id) });
    }
  }
  return { id: crypto.randomUUID(), title: title || describe(redo), at: new Date().toISOString(), projectIds: [...new Set(redo.changes.map(change => change.projectId).filter(Boolean))], beforeActive: before.activeProjectId, afterActive: after.activeProjectId, undo, redo, ...(order.length ? { order } : {}) };
}
export function boundedHistory(value: HistoryState): HistoryState {
  const next = { ...value, past: value.past.slice(-HISTORY_LIMIT), future: value.future.slice(-HISTORY_LIMIT) };
  while ((historySize(next) > HISTORY_BYTES || next.past.length + next.future.length > HISTORY_LIMIT) && (next.past.length || next.future.length)) {
    if (next.past.length > 1 || !next.future.length) next.past.shift(); else next.future.shift();
  }
  return next;
}
export function validateHistory(input: unknown): HistoryState {
  if (!input || typeof input !== "object" || historySize(input) > HISTORY_BYTES) throw new Error("سابقهٔ بازگشت قابل خواندن نیست و در دستگاه حفظ شده است.");
  const state = input as HistoryState;
  if (state.version !== 1 || !Array.isArray(state.past) || !Array.isArray(state.future) || state.past.length + state.future.length > HISTORY_LIMIT) throw new Error("ساختار سابقهٔ بازگشت معتبر نیست.");
  for (const entry of [...state.past, ...state.future]) {
    if (!entry || typeof entry.id !== "string" || typeof entry.title !== "string" || entry.title.length > 500 || typeof entry.at !== "string" || !Number.isFinite(Date.parse(entry.at)) || !Array.isArray(entry.projectIds) || !entry.projectIds.every(id => typeof id === "string") || typeof entry.beforeActive !== "string" || typeof entry.afterActive !== "string") throw new Error("یک تغییر در سابقهٔ بازگشت معتبر نیست.");
    validateChangeSet(entry.undo); validateChangeSet(entry.redo);
    if (entry.order !== undefined && (!Array.isArray(entry.order) || !entry.order.every(item => item && ["projects", ...collections].includes(item.collection as "projects") && typeof item.projectId === "string" && [item.before, item.after].every(ids => Array.isArray(ids) && ids.length <= 120000 && ids.every(id => typeof id === "string" && id.length <= 200))))) throw new Error("ترتیب ذخیره‌شده در سابقه معتبر نیست.");
  }
  return state;
}
function comparable(entity: Record<string, unknown>, project: boolean): Record<string, unknown> {
  const next = { ...entity };
  delete next.createdAt; delete next.updatedAt;
  if (project) for (const collection of collections) if (Array.isArray(next[collection])) next[collection] = (next[collection] as Row[]).map(row => comparable(row, false));
  return next;
}
/** Allow bookkeeping timestamps to advance, while preserving a strict guard on every real field before deletion. */
async function guardedPatch(store: Store, wanted: ChangeSet, opposite: ChangeSet): Promise<ChangeSet> {
  const restores = new Map(opposite.changes.filter(change => change.kind === "create").map(change => [address(change), change]));
  const projects = new Map(store.projects.map(project => [project.id, project]));
  const indexes = new Map<string, Map<string, Row>>();
  const changes: EntityChange[] = [];
  for (const change of wanted.changes) {
    const restore = restores.get(address(change));
    if (change.kind !== "delete" || restore?.kind !== "create") { changes.push(change); continue; }
    const project = projects.get(change.projectId);
    let current: Record<string, unknown> | undefined;
    if (change.collection === "projects") current = project as unknown as Record<string, unknown> | undefined;
    else if (project && change.collection !== "settings") {
      const key = `${change.projectId}:${change.collection}`;
      let rows = indexes.get(key);
      if (!rows) { rows = new Map((project[change.collection] || []).map(row => [row.id, row])); indexes.set(key, rows); }
      current = rows.get(change.rowId);
    }
    if (current && await recordFingerprint(comparable(current, change.collection === "projects")) === await recordFingerprint(comparable(restore.after, change.collection === "projects"))) changes.push({ ...change, beforeHash: await recordFingerprint(current) });
    else changes.push(change);
  }
  return { version: 1, changes };
}
function restoreOrder<T extends { id: string }>(items: T[], wanted: string[], restored: Set<string>): T[] {
  if (!restored.size) return items;
  const rows = new Map(items.map(item => [item.id, item]));
  const existing = new Set(items.filter(item => !restored.has(item.id)).map(item => item.id));
  const buckets = new Map<string | null, T[]>();
  let anchor: string | null = null;
  for (const id of [...wanted].reverse()) {
    if (existing.has(id)) anchor = id;
    else if (restored.has(id) && rows.has(id)) { const bucket = buckets.get(anchor) || []; bucket.push(rows.get(id)!); buckets.set(anchor, bucket); }
  }
  const known = new Set(wanted);
  const next: T[] = [];
  for (const item of items) if (!restored.has(item.id)) next.push(...(buckets.get(item.id) || []).reverse(), item);
  next.push(...(buckets.get(null) || []).reverse(), ...items.filter(item => restored.has(item.id) && !known.has(item.id)));
  return next;
}
export async function replayHistory(current: Store, entry: HistoryEntry, direction: "undo" | "redo"): Promise<{ state: Store; entry: HistoryEntry }> {
  const opposite = direction === "undo" ? "redo" : "undo";
  const patch = await guardedPatch(current, entry[direction], entry[opposite]);
  const result = await applyChangeSet(current, patch);
  if (result.conflicts.length) throw new Error("بعضی از همین فیلدها بعداً تغییر کرده‌اند؛ بازگشت متوقف شد و هیچ داده‌ای جایگزین نشد. سابقهٔ تیم یا پشتیبان را بررسی کنید.");
  const now = new Date().toISOString();
  const original = new Map(current.projects.map(project => [project.id, project]));
  const next = { ...result.state, projects: result.state.projects.map(project => {
    const before = original.get(project.id);
    const updated = { ...project };
    for (const collection of collections) {
      if (!project[collection] || project[collection] === before?.[collection]) continue;
      const rows = new Map((before?.[collection] || []).map(row => [row.id, row]));
      updated[collection] = project[collection]!.map(row => rows.get(row.id) === row ? row : { ...row, updatedAt: now });
    }
    return updated as Project;
  }) };
  for (const order of entry.order || []) {
    const restored = new Set(result.applied.filter(change => change.kind === "create" && change.collection === order.collection && (order.collection === "projects" || change.projectId === order.projectId)).map(change => change.rowId));
    const wanted = direction === "undo" ? order.before : order.after;
    if (order.collection === "projects") next.projects = restoreOrder(next.projects, wanted, restored);
    else {
      const project = next.projects.find(project => project.id === order.projectId);
      const collection = order.collection as typeof collections[number];
      if (project?.[collection]) project[collection] = restoreOrder(project[collection]!, wanted, restored);
    }
  }
  const fromActive = direction === "undo" ? entry.afterActive : entry.beforeActive;
  const toActive = direction === "undo" ? entry.beforeActive : entry.afterActive;
  if (current.activeProjectId === fromActive && next.projects.some(project => project.id === toActive)) next.activeProjectId = toActive;
  const state = validateStore(next);
  // Rebuild the opposite operation against the actual state, including unrelated teammate edits.
  return { state, entry: { ...entry, [opposite]: withoutStamps(await buildChangeSet(state, current)) } };
}

function historyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("roshdimo-undo-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("accounts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("حافظهٔ بازگشت در تب دیگری باز است."));
  });
}
export async function loadHistory(scope: string): Promise<HistoryState> {
  const db = await historyDatabase();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction("accounts");
    const request = tx.objectStore("accounts").get(scope);
    request.onsuccess = () => { try { resolve(request.result === undefined ? emptyHistory() : validateHistory(request.result)); } catch (error) { reject(error); } };
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
export async function saveHistory(scope: string, value: HistoryState): Promise<void> {
  const db = await historyDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("accounts", "readwrite");
    tx.objectStore("accounts").put(value, scope);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
