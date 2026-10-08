import type { Collection, Row } from "./types";
import { SCHEMAS } from "./domain";

export type SavedBulkDraft = {
  version: 1;
  projectId: string;
  collection: Collection;
  scope?: string;
  savedAt: string;
  patches: [string, Partial<Row>][];
  additions: Row[];
  deleted: string[];
  baselines: [string, Row][];
  editing: { id: string; key: string; value: string } | null;
};
const pending = new Map<string, Promise<unknown>>();
const draftKey = (projectId: string, collection: Collection, scope?: string) => scope ? JSON.stringify([scope, projectId, collection]) : `${projectId}:${collection}`;
export function validBulkDraft(input: unknown, projectId: string, collection: Collection): input is SavedBulkDraft {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const draft = input as SavedBulkDraft;
  const limit = collection === "keywords" ? 20000 : 2000;
  if (draft.version !== 1 || draft.projectId !== projectId || draft.collection !== collection || !Number.isFinite(Date.parse(draft.savedAt))) return false;
  if (![draft.patches, draft.additions, draft.deleted, draft.baselines].every((part) => Array.isArray(part) && part.length <= limit)) return false;
  const fieldKeys = new Set(SCHEMAS[collection].flatMap((section) => section.fields.filter((field) => !field.calculated).map((field) => field.key)));
  const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200;
  const validValue = (value: unknown) => value === undefined || typeof value === "string" && value.length <= 100000 || typeof value === "number" && Number.isFinite(value);
  const validRow = (row: unknown): row is Row => !!row && typeof row === "object" && !Array.isArray(row) && validId((row as Row).id) && Object.keys(row).length <= 250 && Object.keys(row).every((key) => !["__proto__", "prototype", "constructor"].includes(key)) && Object.values(row).every(validValue);
  if (!draft.additions.every(validRow) || !draft.deleted.every(validId)) return false;
  if (!draft.patches.every((pair) => Array.isArray(pair) && pair.length === 2 && validId(pair[0]) && pair[1] && typeof pair[1] === "object" && Object.entries(pair[1]).every(([key, value]) => fieldKeys.has(key) && validValue(value)))) return false;
  if (!draft.baselines.every((pair) => Array.isArray(pair) && pair.length === 2 && validId(pair[0]) && validRow(pair[1]) && pair[1].id === pair[0])) return false;
  if (draft.editing && (!validId(draft.editing.id) || !fieldKeys.has(draft.editing.key) || typeof draft.editing.value !== "string" || draft.editing.value.length > 20000)) return false;
  return true;
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("seo-bulk-drafts-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("حافظه پیش‌نویس در تب دیگری در حال استفاده است."));
  });
}
export async function loadBulkDraft(projectId: string, collection: Collection, scope?: string, recoverLegacy = false): Promise<SavedBulkDraft | null> {
  const key = draftKey(projectId, collection, scope);
  const legacyKey = draftKey(projectId, collection);
  await pending.get(key)?.catch(() => {});
  if (scope && recoverLegacy) await pending.get(legacyKey)?.catch(() => {});
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const migrate = !!scope && recoverLegacy;
      const tx = db.transaction("drafts", migrate ? "readwrite" : "readonly");
      const store = tx.objectStore("drafts");
      let saved: SavedBulkDraft | null = null;
      const request = store.get(key);
      request.onsuccess = () => {
        saved = request.result || null;
        if (saved || !migrate) return;
        const legacy = store.get(legacyKey);
        legacy.onsuccess = () => {
          if (!legacy.result) return;
          saved = legacy.result;
          if (!validBulkDraft(saved, projectId, collection)) return;
          saved = { ...saved, scope };
          // Move only after a valid copy is written in the same transaction.
          store.put(saved, key);
          store.delete(legacyKey);
        };
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export function saveBulkDraft(projectId: string, collection: Collection, draft: SavedBulkDraft | null, scope?: string): Promise<void> {
  if (draft !== null && !validBulkDraft(draft, projectId, collection)) return Promise.reject(new Error("پیش‌نویس تغییر گروهی معتبر نیست."));
  const snapshot = draft === null ? null : structuredClone({ ...draft, ...(scope ? { scope } : {}) });
  const key = draftKey(projectId, collection, scope);
  const operation = (pending.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("drafts", "readwrite");
        const store = transaction.objectStore("drafts");
        if (snapshot) store.put(snapshot, key); else store.delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("ذخیره پیش‌نویس متوقف شد."));
      });
    } finally { db.close(); }
  });
  pending.set(key, operation);
  operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
  return operation;
}
