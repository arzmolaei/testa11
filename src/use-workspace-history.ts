import { useCallback, useEffect, useRef, useState } from "react";
import type { Store } from "./types";
import { boundedHistory, emptyHistory, HISTORY_BYTES, historySize, loadHistory, makeHistoryEntry, replayHistory, saveHistory } from "./workspace-history";
import type { HistoryState } from "./workspace-history";

/** Only explicit workspace edits are recorded; server merges and navigation never become someone else's undo action. */
export function useWorkspaceHistory(scope: string) {
  const data = useRef<HistoryState>(emptyHistory());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const blockedStorage = useRef(false);
  const pending = useRef(0);
  const acting = useRef(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const redraw = useCallback(() => { if (mounted.current) setVersion(value => value + 1); }, []);
  useEffect(() => {
    mounted.current = true;
    blockedStorage.current = false;
    data.current = emptyHistory();
    pending.current++;
    queue.current = loadHistory(scope).then(value => { data.current = value; })
      .catch(() => { blockedStorage.current = true; if (mounted.current) setError("ذخیرهٔ سابقه در دسترس نیست؛ بازگشت تغییرات جدید فقط در این نشست کار می‌کند. سابقهٔ قبلی پاک نشده است."); })
      .finally(() => { pending.current--; redraw(); });
    return () => { mounted.current = false; };
  }, [scope, redraw]);
  const persist = useCallback(async () => {
    if (blockedStorage.current) return;
    try { await saveHistory(scope, data.current); }
    catch { blockedStorage.current = true; if (mounted.current) setError("ذخیرهٔ سابقه انجام نشد؛ تغییرات جدید در همین نشست قابل بازگشت‌اند. پیش از خروج پشتیبان بگیرید."); }
  }, [scope]);
  const capture = useCallback((before: Store, after: Store, title?: string) => {
    pending.current++;
    redraw();
    queue.current = queue.current.catch(() => {}).then(async () => {
      const entry = await makeHistoryEntry(before, after, title);
      if (!entry) return;
      // A new edit ends the redo branch, including edits too large for the bounded history.
      if (historySize(entry) > HISTORY_BYTES) {
        data.current = { ...data.current, future: [] };
        if (mounted.current) setError("این تغییر از ظرفیت سابقه بزرگ‌تر است؛ برای بازگرداندن آن از پشتیبان خودکار یا فایل JSON استفاده کنید.");
      } else data.current = boundedHistory({ version: 1, past: [...data.current.past, entry], future: [] });
      await persist();
    }).catch(() => { if (mounted.current) setError("ثبت این تغییر در سابقه ممکن نشد؛ دادهٔ پروژه حفظ شده است. برای تغییرات بزرگ پشتیبان بگیرید."); })
      .finally(() => { pending.current--; redraw(); });
  }, [persist, redraw]);
  const perform = useCallback(async (direction: "undo" | "redo", current: Store, commit: (state: Store) => boolean, count = 1) => {
    if (acting.current) throw new Error("بازگشت دیگری در حال انجام است.");
    acting.current = true;
    redraw();
    try {
      await queue.current;
      if (!mounted.current) return false;
      const original = data.current;
      const from = direction === "undo" ? [...original.past] : [...original.future];
      const to = direction === "undo" ? [...original.future] : [...original.past];
      if (!from.length) return false;
      const steps = Math.min(Math.max(1, Math.floor(count)), from.length);
      let next = current;
      for (let index = 0; index < steps; index++) {
        const result = await replayHistory(next, from.pop()!, direction);
        next = result.state; to.push(result.entry);
      }
      // All requested steps either commit together or leave both data and history untouched.
      if (!mounted.current || !commit(next)) return false;
      data.current = boundedHistory(direction === "undo" ? { version: 1, past: from, future: to } : { version: 1, past: to, future: from });
      await persist();
      return true;
    } finally { acting.current = false; redraw(); }
  }, [persist, redraw]);
  // Version is deliberately read to refresh ref-backed results after queued writes.
  void version;
  return { ...data.current, capture, perform, flush: () => queue.current, busy: pending.current > 0 || acting.current, error };
}
