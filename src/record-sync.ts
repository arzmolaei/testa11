import type { Store } from "./types";

/** Edits carry the previous value of each changed field, rather than a whole
 * workspace revision. Unrelated edits can merge; matching fields cannot. */
export type SyncCollection = "keywords" | "pages" | "content" | "results" | "tasks" | "links";
export type SyncTarget = SyncCollection | "projects" | "settings";
export type FieldValue = { exists: false } | { exists: true; value: unknown; hash?: never } | { exists: true; hash: string; value?: never };
type Address = { collection: SyncTarget; projectId: string; rowId: string };
export type EntityChange = Address & (
  | { kind: "create"; after: Record<string, unknown> }
  | { kind: "delete"; beforeHash: string }
  | { kind: "edit"; fields: Record<string, { before: FieldValue; after: FieldValue }> }
);
export type ChangeSet = { version: 1; changes: EntityChange[] };
export type RecordConflict = Address & { fields: string[] };
export type ApplyChangesResult = { state: Store; conflicts: RecordConflict[]; applied: EntityChange[] };
export type CloudBase = { state: Store; revision: number; scope: string };

const COLLECTIONS: SyncCollection[] = ["keywords", "pages", "content", "results", "tasks", "links"];
const PROJECT_FIELDS = new Set(["name", "domain", "market", "language", "projectType", "goal", "startDate", "lastReview", "playbook", "searchConsole"]);
const SETTINGS_FIELDS = new Set(["titleMin", "titleMax", "metaMin", "metaMax", "customLabels", "playbooks"]);
const FORBIDDEN_FIELDS = new Set(["__proto__", "constructor", "prototype", "id"]);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Sorted keys make guards independent of JSON/object key insertion order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function equal(a: unknown, b: unknown) { return canonical(a) === canonical(b); }
export async function recordFingerprint(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function fieldValue(entity: Record<string, unknown>, key: string): FieldValue {
  return own(entity, key) && entity[key] !== undefined ? { exists: true, value: entity[key] } : { exists: false };
}
function rows(project: Record<string, unknown>, collection: SyncCollection): Record<string, unknown>[] {
  return Array.isArray(project[collection]) ? project[collection] as Record<string, unknown>[] : [];
}
async function edit(before: Record<string, unknown>, after: Record<string, unknown>, address: Address, allowed?: Set<string>): Promise<EntityChange | null> {
  const fields: Record<string, { before: FieldValue; after: FieldValue }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (FORBIDDEN_FIELDS.has(key) || (allowed && !allowed.has(key))) continue;
    const left = fieldValue(before, key), right = fieldValue(after, key);
    if (!equal(left, right)) fields[key] = { before: left.exists && typeof left.value === "object" ? { exists: true, hash: await recordFingerprint(left.value) } : left, after: structuredClone(right) };
  }
  return Object.keys(fields).length ? { ...address, kind: "edit", fields } : null;
}

/** Navigation is a device preference. Only project data and settings are sent. */
export async function buildChangeSet(base: Store, next: Store): Promise<ChangeSet> {
  const changes: EntityChange[] = [];
  const settings = await edit(base.settings as unknown as Record<string, unknown>, next.settings as unknown as Record<string, unknown>, { collection: "settings", projectId: "", rowId: "settings" }, SETTINGS_FIELDS);
  if (settings) changes.push(settings);
  const previous = new Map(base.projects.map((project) => [project.id, project]));
  const upcoming = new Map(next.projects.map((project) => [project.id, project]));
  for (const old of base.projects) if (!upcoming.has(old.id)) changes.push({ kind: "delete", collection: "projects", projectId: old.id, rowId: old.id, beforeHash: await recordFingerprint(old) });
  for (const project of next.projects) {
    const old = previous.get(project.id);
    if (!old) {
      changes.push({ kind: "create", collection: "projects", projectId: project.id, rowId: project.id, after: structuredClone(project) as unknown as Record<string, unknown> });
      continue;
    }
    const metadata = await edit(old as unknown as Record<string, unknown>, project as unknown as Record<string, unknown>, { collection: "projects", projectId: project.id, rowId: project.id }, PROJECT_FIELDS);
    if (metadata) changes.push(metadata);
    for (const collection of COLLECTIONS) {
      const oldRows = rows(old as unknown as Record<string, unknown>, collection), newRows = rows(project as unknown as Record<string, unknown>, collection);
      const oldMap = new Map(oldRows.map((row) => [String(row.id), row]));
      const newIds = new Set(newRows.map((row) => String(row.id)));
      for (const row of oldRows) if (!newIds.has(String(row.id))) changes.push({ kind: "delete", collection, projectId: project.id, rowId: String(row.id), beforeHash: await recordFingerprint(row) });
      for (const row of newRows) {
        const address: Address = { collection, projectId: project.id, rowId: String(row.id) };
        const oldRow = oldMap.get(String(row.id));
        if (!oldRow) changes.push({ ...address, kind: "create", after: structuredClone(row) });
        else { const change = await edit(oldRow, row, address); if (change) changes.push(change); }
      }
    }
  }
  return { version: 1, changes };
}

function validId(value: unknown) { return typeof value === "string" && value.trim().length > 0 && value.length <= 200; }
function validValue(value: unknown, collection: SyncTarget, key: string): boolean {
  if (collection === "projects" && ["playbook", "searchConsole"].includes(key)) return object(value);
  if (collection === "settings" && key === "playbooks") return Array.isArray(value) && value.length <= 50 && value.every(object);
  if (collection === "settings" && key === "customLabels") return object(value) && Object.keys(value).length <= 10 && Object.entries(value).every(([field, label]) => /^custom(?:0[1-9]|10)$/.test(field) && typeof label === "string" && label.length <= 100);
  return (typeof value === "string" && value.length <= (collection === "projects" || collection === "settings" ? 10000 : 100000)) || (typeof value === "number" && Number.isFinite(value));
}
function validFieldValue(value: unknown, collection: SyncTarget, key: string, before: boolean): value is FieldValue {
  return object(value) && (value.exists === false || (value.exists === true && ((before && typeof value.hash === "string" && /^[a-f0-9]{64}$/.test(value.hash) && !own(value, "value")) || (!own(value, "hash") && own(value, "value") && validValue(value.value, collection, key)))));
}

/** Structural validation precedes lookup/mutation; the complete merged Store is
 * separately validated by the Worker before its transaction is committed. */
export function validateChangeSet(input: unknown): ChangeSet {
  if (!object(input) || input.version !== 1 || !Array.isArray(input.changes) || input.changes.length > 160000) throw new Error("INVALID_CHANGES");
  const addresses = new Set<string>(), lifecycleProjects = new Set<string>();
  for (const change of input.changes) {
    if (!object(change) || ![...COLLECTIONS, "projects", "settings"].includes(change.collection as SyncCollection) || !["create", "delete", "edit"].includes(String(change.kind))) throw new Error("INVALID_CHANGES");
    const collection = change.collection as SyncTarget;
    if (collection === "settings") {
      if (change.projectId !== "" || change.rowId !== "settings" || change.kind !== "edit") throw new Error("INVALID_CHANGES");
    } else if (!validId(change.projectId) || !validId(change.rowId) || (collection === "projects" && change.projectId !== change.rowId)) throw new Error("INVALID_CHANGES");
    const key = JSON.stringify([change.projectId, collection, change.rowId]);
    if (addresses.has(key)) throw new Error("INVALID_CHANGES");
    addresses.add(key);
    if (collection === "projects" && change.kind !== "edit") lifecycleProjects.add(String(change.projectId));
    if (change.kind === "delete") {
      if (typeof change.beforeHash !== "string" || !/^[a-f0-9]{64}$/.test(change.beforeHash)) throw new Error("INVALID_CHANGES");
    } else if (change.kind === "create") {
      if (!object(change.after) || change.after.id !== change.rowId || Object.keys(change.after).some((field) => ["__proto__", "constructor", "prototype"].includes(field))) throw new Error("INVALID_CHANGES");
      if (collection !== "projects" && Object.entries(change.after).some(([field, value]) => field.length > 100 || (value !== undefined && !validValue(value, collection, field)))) throw new Error("INVALID_CHANGES");
    } else {
      if (!object(change.fields) || Object.keys(change.fields).length < 1 || Object.keys(change.fields).length > 120) throw new Error("INVALID_CHANGES");
      for (const [field, value] of Object.entries(change.fields)) {
        if (field.length > 100 || FORBIDDEN_FIELDS.has(field) || (collection === "projects" && !PROJECT_FIELDS.has(field)) || (collection === "settings" && !SETTINGS_FIELDS.has(field)) || !object(value) || !validFieldValue(value.before, collection, field, true) || !validFieldValue(value.after, collection, field, false)) throw new Error("INVALID_CHANGES");
      }
    }
  }
  if (input.changes.some((change) => lifecycleProjects.has(change.projectId) && change.collection !== "projects")) throw new Error("INVALID_CHANGES");
  return input as ChangeSet;
}

/** Atomic three-way merge. No partial state is returned on any conflict. */
export async function applyChangeSet(current: Store, input: ChangeSet): Promise<ApplyChangesResult> {
  const changes = validateChangeSet(input).changes;
  // Copy only touched containers. Large unchanged Search Console datasets stay
  // shared during this merge; writes always replace, rather than mutate, values.
  const next: Store = { ...current, projects: current.projects.slice(), settings: { ...current.settings } };
  const copiedProjects = new Set<string>(), copiedCollections = new Set<string>();
  function editableProject(projectId: string): Record<string, unknown> | undefined {
    const index = next.projects.findIndex((project) => project.id === projectId);
    if (index < 0) return undefined;
    if (!copiedProjects.has(projectId)) {
      next.projects[index] = { ...next.projects[index] };
      copiedProjects.add(projectId);
    }
    return next.projects[index] as unknown as Record<string, unknown>;
  }
  const conflicts: RecordConflict[] = [], applied: EntityChange[] = [];
  for (const change of changes) {
    const address: Address = { collection: change.collection, projectId: change.projectId, rowId: change.rowId };
    let target: Record<string, unknown> | undefined;
    let list: Record<string, unknown>[] | undefined;
    if (change.collection === "settings") target = next.settings as unknown as Record<string, unknown>;
    else if (change.collection === "projects") {
      list = next.projects as unknown as Record<string, unknown>[];
      target = list.find((project) => project.id === change.rowId);
      if (target && change.kind === "edit") target = editableProject(change.projectId);
    } else {
      const project = editableProject(change.projectId);
      if (!project) { conflicts.push({ ...address, fields: ["project"] }); continue; }
      if (!Array.isArray(project[change.collection]) && change.kind === "create") project[change.collection] = [];
      const collectionKey = JSON.stringify([change.projectId, change.collection]);
      if (!copiedCollections.has(collectionKey)) {
        if (Array.isArray(project[change.collection])) project[change.collection] = (project[change.collection] as unknown[]).slice();
        copiedCollections.add(collectionKey);
      }
      list = Array.isArray(project[change.collection]) ? project[change.collection] as Record<string, unknown>[] : [];
      target = list.find((row) => row.id === change.rowId);
      if (target && change.kind === "edit") {
        const index = list.indexOf(target);
        target = { ...target };
        list[index] = target;
      }
    }
    if (change.kind === "create") {
      if (target) { if (!equal(target, change.after)) conflicts.push({ ...address, fields: ["id"] }); }
      else { list!.push(structuredClone(change.after)); applied.push(change); }
    } else if (change.kind === "delete") {
      if (!target) continue; // A retried delete is harmless.
      if (await recordFingerprint(target) !== change.beforeHash) { conflicts.push({ ...address, fields: ["record"] }); continue; }
      list!.splice(list!.indexOf(target), 1);
      applied.push(change);
    } else {
      if (!target) { conflicts.push({ ...address, fields: ["record"] }); continue; }
      const disputed: string[] = [], effective: typeof change.fields = {};
      for (const [field, value] of Object.entries(change.fields)) {
        const now = fieldValue(target, field);
        if (equal(now, value.after)) continue; // Retry after a lost success response.
        // The UI stamps every saved row. Its bookkeeping timestamp must not
        // turn two independent user-field edits into a false conflict. Keep
        // the latest valid timestamp; all real fields still use strict guards.
        if (field === "updatedAt" && change.collection !== "projects" && change.collection !== "settings" && value.after.exists && typeof value.after.value === "string" && Number.isFinite(Date.parse(value.after.value))) {
          const existingTime = now.exists && typeof now.value === "string" ? Date.parse(now.value) : NaN;
          if (!Number.isFinite(existingTime) || existingTime < Date.parse(value.after.value)) effective[field] = value;
          continue;
        }
        // Older/imported rows may not yet have a creation stamp. Two devices
        // filling that missing metadata should keep the earliest known stamp.
        // Editing an already-known creation date still requires its guard.
        if (field === "createdAt" && !value.before.exists && change.collection !== "projects" && change.collection !== "settings" && value.after.exists && typeof value.after.value === "string" && Number.isFinite(Date.parse(value.after.value))) {
          const existingTime = now.exists && typeof now.value === "string" ? Date.parse(now.value) : NaN;
          if (!Number.isFinite(existingTime) || existingTime > Date.parse(value.after.value)) effective[field] = value;
          continue;
        }
        const matchesBefore = value.before.exists && value.before.hash ? now.exists && await recordFingerprint(now.value) === value.before.hash : equal(now, value.before);
        if (!matchesBefore) disputed.push(field);
        else effective[field] = value;
      }
      if (disputed.length) { conflicts.push({ ...address, fields: disputed }); continue; }
      for (const [field, value] of Object.entries(effective)) {
        if (value.after.exists) target[field] = structuredClone(value.after.value);
        else delete target[field];
      }
      if (Object.keys(effective).length) applied.push({ ...change, fields: effective });
    }
  }
  if (conflicts.length) return { state: current, conflicts, applied: [] };
  if (!next.projects.some((project) => project.id === next.activeProjectId)) next.activeProjectId = next.projects[0]?.id || "";
  return { state: next, conflicts: [], applied };
}

const BASE_DB = "seo-studio-cloud-base-v1";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BASE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("base");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("حافظهٔ مبنای همگام‌سازی در دسترس نیست."));
    request.onblocked = () => reject(new Error("حافظهٔ مبنای همگام‌سازی در تب دیگری باز است."));
  });
}
export async function loadCloudBase(scope: string): Promise<CloudBase | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("base").objectStore("base").get(scope);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value && value.scope === scope && Number.isSafeInteger(value.revision) && value.revision >= 0 ? value as CloudBase : null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function saveCloudBase(state: Store, revision: number, scope: string): Promise<void> {
  if (!Number.isSafeInteger(revision) || revision < 0 || !scope) throw new Error("مبنای همگام‌سازی معتبر نیست.");
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("base", "readwrite");
      const store = transaction.objectStore("base"), previous = store.get(scope);
      previous.onsuccess = () => {
        // A delayed response from an older tab must not roll the merge base back.
        if (!previous.result || previous.result.revision <= revision) store.put({ state, revision, scope } satisfies CloudBase, scope);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("ذخیرهٔ مبنای همگام‌سازی متوقف شد."));
    });
  } finally { db.close(); }
}
export async function clearCloudBase(scope?: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("base", "readwrite"), store = transaction.objectStore("base");
      if (scope) store.delete(scope); else store.clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("پاک‌کردن مبنای همگام‌سازی متوقف شد."));
    });
  } finally { db.close(); }
}
