import type { Collection, Row } from "./types";
import { SCHEMAS } from "./domain";

export type SavedBulkDraft = {
  version: 1;
  projectId: string;
  collection: Collection;
  savedAt: string;
  patches: [string, Partial<Row>][];
  additions: Row[];
  deleted: string[];
  baselines: [string, Row][];
  editing: { id: string; key: string; value: string } | null;
};
const pending = new Map<string, Promise<unknown>>();
const draftKey = (projectId: string, collection: Collection) => `${projectId}:${collection}`;
export function validBulkDraft(input: unknown, projectId: string, collection: Collection): input is SavedBulkDraft {
  if (!input || typeof input !== "object") return false;
  const draft = input as SavedBulkDraft;
  const limit = collection === "keywords" ? 20000 : 2000;
  if (draft.version !== 1 || draft.projectId !== projectId || draft.collection !== collection || !Number.isFinite(Date.parse(draft.savedAt))) return false;
  if (![draft.patches, draft.additions, draft.deleted, draft.baselines].every((part) => Array.isArray(part) && part.length <= limit)) return false;
  const fieldKeys = new Set(SCHEMAS[collection].flatMap((section) => section.fields.filter((field) => !field.calculated).map((field) => field.key)));
  const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200;
  const validValue = (value: unknown) => value === undefined || typeof value === "string" && value.length <= 20000 || typeof value === "number" && Number.isFinite(value);
  const validRow = (row: unknown): row is Row => !!row && typeof row === "object" && validId((row as Row).id) && Object.keys(row).length <= 250 && Object.values(row).every(validValue);
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
export async function loadBulkDraft(projectId: string, collection: Collection): Promise<SavedBulkDraft | null> {
  const key = draftKey(projectId, collection);
  await pending.get(key)?.catch(() => {});
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export function saveBulkDraft(projectId: string, collection: Collection, draft: SavedBulkDraft | null): Promise<void> {
  const key = draftKey(projectId, collection);
  const operation = (pending.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("drafts", "readwrite");
        const store = transaction.objectStore("drafts");
        if (draft) store.put(draft, key); else store.delete(key);
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
