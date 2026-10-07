import type { Store } from "./types";
const DB_NAME = "rooyesh-seo-v1";
export type Stored = { state: Store; revision: number; savedAt: string };
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("workspace");
      request.result.createObjectStore("backups", { keyPath: "savedAt" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("دسترسی به حافظه مرورگر ممکن نیست."));
    request.onblocked = () =>
      reject(new Error("حافظه در تب دیگری در حال استفاده است."));
  });
}
export async function loadLocal(): Promise<Stored | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const r = db
        .transaction("workspace")
        .objectStore("workspace")
        .get("state");
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function saveLocal(
  state: Store,
  expected: number,
  forceBackup = false,
): Promise<Stored> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["workspace", "backups"], "readwrite");
      const os = tx.objectStore("workspace"),
        backups = tx.objectStore("backups");
      let record: Stored;
      const r = os.get("state");
      r.onsuccess = () => {
        const current = r.result as Stored | undefined;
        if ((current?.revision ?? 0) !== expected) {
          reject(
            new Error(
              "نسخه جدیدتری در تب دیگر ذخیره شده؛ برای جلوگیری از تداخل، صفحه را دوباره باز کنید.",
            ),
          );
          tx.abort();
          return;
        }
        record = {
          state,
          revision: expected + 1,
          savedAt: new Date().toISOString(),
        };
        os.put(record, "state");
        if (current) {
          const stamp = os.get("lastBackupAt");
          stamp.onsuccess = () => {
            const count = (s: Store) =>
              s.projects.reduce(
                (n, p) =>
                  n +
                  p.keywords.length +
                  p.pages.length +
                  p.content.length +
                  p.results.length,
                0,
              );
            if (
              forceBackup ||
              !stamp.result ||
              Date.now() - Number(stamp.result) > 60000 ||
              count(state) < count(current.state)
            ) {
              backups.put(current);
              os.put(Date.now(), "lastBackupAt");
              const keys = backups.getAllKeys();
              keys.onsuccess = () =>
                keys.result
                  .slice(0, Math.max(0, keys.result.length - 8))
                  .forEach((k) => backups.delete(k));
            }
          };
        }
      };
      tx.oncomplete = () => resolve(record!);
      tx.onerror = () =>
        reject(
          tx.error ??
            new Error(
              "ذخیره نشد؛ فضای حافظه دستگاه را بررسی کنید و پشتیبان بگیرید.",
            ),
        );
      tx.onabort = () => reject(new Error("ذخیره متوقف شد."));
    });
  } finally {
    db.close();
  }
}
export async function listBackups(): Promise<Stored[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction("backups").objectStore("backups").getAll();
      r.onsuccess = () =>
        resolve(
          (r.result as Stored[])
            .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
            .slice(0, 8),
        );
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Explicit recovery keeps the unreadable record separately before replacement. */
export async function recoverLocal(state: Store): Promise<Stored> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite");
      const os = tx.objectStore("workspace");
      let replacement: Stored;
      const request = os.get("state");
      request.onsuccess = () => {
        const previous = request.result;
        if (previous) os.put(previous, "recovery");
        const revision =
          Number.isSafeInteger(previous?.revision) &&
          previous.revision >= 0 &&
          previous.revision < Number.MAX_SAFE_INTEGER
            ? previous.revision + 1
            : 1;
        replacement = { state, revision, savedAt: new Date().toISOString() };
        os.put(replacement, "state");
      };
      tx.oncomplete = () => resolve(replacement!);
      tx.onerror = () =>
        reject(tx.error ?? new Error("بازیابی در حافظه دستگاه انجام نشد."));
      tx.onabort = () => reject(new Error("بازیابی متوقف شد."));
    });
  } finally {
    db.close();
  }
}
