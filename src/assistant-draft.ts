import type { Row } from "./types";

export type AssistantDraft = {
  version: 1;
  projectId: string;
  scope: string;
  savedAt: string;
  row: Row;
  baseline: Row | null;
};
const pending = new Map<string, Promise<unknown>>();
const keyFor = (projectId: string, scope: string) => JSON.stringify([scope, projectId]);
const validRow = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value)
  && typeof (value as Row).id === "string" && (value as Row).id.length > 0 && (value as Row).id.length <= 200
  && Object.keys(value).length <= 120
  && Object.entries(value).every(([key, part]) => !["__proto__", "prototype", "constructor"].includes(key)
    && (part === undefined || typeof part === "string" && part.length <= 100000 || typeof part === "number" && Number.isFinite(part)));
export function validAssistantDraft(value: unknown, projectId: string, scope: string): value is AssistantDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as AssistantDraft;
  return draft.version === 1 && draft.projectId === projectId && draft.scope === scope
    && typeof draft.savedAt === "string" && Number.isFinite(Date.parse(draft.savedAt))
    && validRow(draft.row) && (draft.baseline === null || validRow(draft.baseline) && draft.baseline.id === draft.row.id);
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("seo-assistant-drafts-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("حافظهٔ پیش‌نویس در دسترس نیست."));
  });
}
export async function loadAssistantDraft(projectId: string, scope: string): Promise<AssistantDraft | null> {
  const key = keyFor(projectId, scope);
  await pending.get(key)?.catch(() => {});
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").get(key);
      request.onsuccess = () => {
        if (request.result === undefined || request.result === null) { resolve(null); return; }
        if (!validAssistantDraft(request.result, projectId, scope)) { reject(new Error("پیش‌نویس قبلی قابل خواندن نیست و در حافظه حفظ شده است.")); return; }
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export function saveAssistantDraft(projectId: string, scope: string, draft: AssistantDraft | null): Promise<void> {
  if (draft !== null && !validAssistantDraft(draft, projectId, scope)) return Promise.reject(new Error("پیش‌نویس کار معتبر نیست."));
  const snapshot = draft === null ? null : structuredClone(draft);
  const key = keyFor(projectId, scope);
  const operation = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("drafts", "readwrite");
        const store = transaction.objectStore("drafts");
        if (snapshot) store.put(snapshot, key); else store.delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  });
  pending.set(key, operation);
  operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
  return operation;
}
