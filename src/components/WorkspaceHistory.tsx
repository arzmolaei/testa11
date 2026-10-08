import { useEffect, useRef } from "react";
import { History, Redo2, Undo2, X } from "lucide-react";
import type { HistoryEntry } from "../workspace-history";
import { formatDate } from "../dates";
import "./WorkspaceHistory.css";

export function WorkspaceHistory({ past, future, busy, disabled, error, onClose, onUndo, onRedo }: {
  past: HistoryEntry[]; future: HistoryEntry[]; busy: boolean; disabled: boolean; error: string;
  onClose: () => void; onUndo: (count?: number) => void; onRedo: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="workspace-history-dialog" aria-labelledby="workspace-history-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="workspace-history-panel">
      <header><div className="history-dialog-heading"><History size={21} /><div><h2 id="workspace-history-title">راه برگشت تغییرات</h2><p>۵۰ تغییر اخیرِ این حساب روی همین دستگاه؛ حتی هنگام آفلاین.</p></div></div><button className="icon-button" aria-label="بستن راه برگشت" onClick={onClose}><X size={19} /></button></header>
      <p className="history-dialog-note">کلمات، صفحات، محتوا، نتایج، کارها، لینک‌ها و تنظیمات پروژه قابل بازگشت‌اند. تغییر مستقل همکاران حفظ می‌شود؛ اگر همان فیلد بعداً تغییر کرده باشد، بازگشت متوقف می‌شود. رمز و دسترسی حساب‌ها از بخش حساب و تیم مدیریت می‌شوند.</p>
      {error && <p className="history-dialog-warning" role="status">{error}</p>}
      <div className="history-dialog-controls"><button className="btn btn-secondary" disabled={disabled || busy || !past.length} onClick={() => onUndo()}><Undo2 size={16} />برگرداندن آخرین تغییر</button><button className="btn btn-secondary" disabled={disabled || busy || !future.length} onClick={onRedo}><Redo2 size={16} />انجام دوباره</button></div>
      {!!future.length && <p className="history-dialog-redo">{future.length.toLocaleString("fa-IR")} تغییر برگشته است؛ با «انجام دوباره» قابل بازیابی‌اند. ویرایش تازه، مسیر انجام دوباره را می‌بندد.</p>}
      {!past.length ? <div className="history-dialog-empty"><History size={30} /><h3>تغییر تازه‌ای برای بازگشت ثبت نشده</h3><p>از این نسخه به بعد، تغییراتی که ثبت می‌کنید اینجا قرار می‌گیرند. سابقهٔ قدیمی تیم و پشتیبان‌ها همچنان در تنظیمات در دسترس‌اند.</p></div> : <ol className="history-dialog-list">{[...past].reverse().map((entry, index) => <li key={entry.id}><span className="history-step-number">{(index + 1).toLocaleString("fa-IR")}</span><div><strong>{entry.title}</strong><time dateTime={entry.at}>{formatDate(entry.at, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" })}</time></div><button className="history-step-undo" disabled={disabled || busy} onClick={() => onUndo(index + 1)} title={`بازگرداندن ${(index + 1).toLocaleString("fa-IR")} تغییر اخیر`}><Undo2 size={14} />{index === 0 ? "برگردان" : "بازگشت تا این تغییر"}</button></li>)}</ol>}
      <footer>سابقه برای مصرف کم حافظه تا ۵۰ مرحله و ۱۶ مگابایت نگه‌داری می‌شود. تغییرات بسیار بزرگ و نسخه‌های قدیمی را از پشتیبان برگردانید. داخل کادرهای متن، Ctrl + Z ویرایش نوشته را برمی‌گرداند.</footer>
    </div>
  </dialog>;
}
