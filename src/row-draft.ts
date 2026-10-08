import { useEffect, useRef, useState } from "react";
import { loadAssistantDraft, saveAssistantDraft, validAssistantDraft } from "./assistant-draft";
import type { AssistantDraft } from "./assistant-draft";
import type { Collection, Row } from "./types";

export type SavedRowDraft = AssistantDraft & { collection: Collection; creating: boolean; initial: Row };
const rowScope = (scope: string, collection: Collection) => JSON.stringify(["drawer", scope, collection]);
export function validRowDraft(value: unknown, projectId: string, scope: string, collection: Collection): value is SavedRowDraft {
  if (!validAssistantDraft(value, projectId, rowScope(scope, collection))) return false;
  const draft = value as SavedRowDraft;
  return draft.collection === collection && typeof draft.creating === "boolean"
    && validAssistantDraft({ ...draft, row: draft.initial, baseline: null }, projectId, rowScope(scope, collection))
    && draft.initial.id === draft.row.id && (draft.creating || draft.baseline !== null);
}

type Options = {
  projectId: string; collection: Collection; scope: string; readOnly: boolean;
  draft: Row | null; baseline: Row | null; initial: Row | null; creating: boolean; dirty: boolean;
};
/** Temporary forms belong to the signed-in account and are never applied automatically. */
export function useRowDraft(options: Options) {
  const { projectId, collection, scope, readOnly, draft, baseline, initial, creating, dirty } = options;
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState<SavedRowDraft | null>(null);
  const [error, setError] = useState("");
  const storageBlocked = useRef(false);
  const storageScope = rowScope(scope, collection);
  const identity = JSON.stringify([projectId, storageScope]);
  const draftIdentity = useRef(identity);
  const latest = useRef<{ projectId: string; storageScope: string; ready: boolean; readOnly: boolean; value: SavedRowDraft | null }>({ projectId, storageScope, ready: false, readOnly, value: null });
  if (draftIdentity.current === identity) latest.current = { projectId, storageScope, ready, readOnly, value: draft && dirty && initial ? { version: 1, projectId, scope: storageScope, collection, creating, savedAt: new Date().toISOString(), row: draft, baseline, initial } : recovery };
  useEffect(() => {
    let alive = true;
    draftIdentity.current = identity;
    latest.current = { projectId, storageScope, ready: false, readOnly, value: null };
    storageBlocked.current = false;
    setReady(false); setRecovery(null); setError("");
    loadAssistantDraft(projectId, storageScope).then((saved) => {
      if (!alive || saved === null) return;
      if (!validRowDraft(saved, projectId, scope, collection)) throw new Error("پیش‌نویس فرم قبلی معتبر نیست و در دستگاه حفظ شده است.");
      setRecovery(saved);
    }).catch(() => { if (alive) { storageBlocked.current = true; setError("ذخیرهٔ خودکار پیش‌نویس در این مرورگر ممکن نیست؛ نسخهٔ قبلی حفظ شده است. پیش از خروج، تغییرات را ثبت یا کپی کنید."); } })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [projectId, storageScope]);
  const persist = () => {
    const current = latest.current;
    // A role change or transfer can disable an already open form. Its local
    // draft still needs to survive; a read-only visit must not delete it.
    if (!current.ready || storageBlocked.current || current.readOnly && !current.value) return;
    void saveAssistantDraft(current.projectId, current.storageScope, current.value).catch(() => setError("پیش‌نویس روی دستگاه ذخیره نشد؛ فرم را تا ثبت تغییرات باز نگه دارید."));
  };
  const persistRef = useRef(persist); persistRef.current = persist;
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(persist, 200);
    return () => window.clearTimeout(timer);
  }, [projectId, storageScope, ready, readOnly, draft, dirty, recovery]);
  useEffect(() => () => {
    const current = latest.current;
    if (current.projectId === projectId && current.storageScope === storageScope) persistRef.current();
  }, [projectId, storageScope]);
  useEffect(() => {
    const saveNow = () => persistRef.current();
    const onHide = () => { if (document.visibilityState === "hidden") saveNow(); };
    window.addEventListener("pagehide", saveNow); window.addEventListener("seo:auth-expired", saveNow);
    document.addEventListener("visibilitychange", onHide);
    return () => { saveNow(); window.removeEventListener("pagehide", saveNow); window.removeEventListener("seo:auth-expired", saveNow); document.removeEventListener("visibilitychange", onHide); };
  }, []);
  function clear() {
    if (readOnly) return;
    latest.current.value = null;
    setRecovery(null);
    if (storageBlocked.current) return;
    void saveAssistantDraft(projectId, storageScope, null).catch(() => setError("حذف نسخهٔ موقت پیش‌نویس از دستگاه انجام نشد."));
  }
  return { ready, recovery: readOnly ? null : recovery, error, clear, recover: () => { const value = recovery; setRecovery(null); return value; } };
}
