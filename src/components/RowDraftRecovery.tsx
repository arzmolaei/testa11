import { Download, RotateCcw } from "lucide-react";
import { formatDate, jalaliFileDate } from "../dates";
import type { SavedRowDraft } from "../row-draft";
import { downloadJson } from "../storage";

export function RowDraftRecovery({ draft, error, onRecover, onDiscard }: {
  draft: SavedRowDraft | null;
  error: string;
  onRecover: () => void;
  onDiscard: () => void;
}) {
  return <>
    {error && <p className="form-error" role="alert">{error}</p>}
    {draft && <div className="row-draft-recovery" role="status">
      <div><strong>یک پیش‌نویس ثبت‌نشده از قبل روی این دستگاه باقی مانده است.</strong><p>آخرین ذخیره: {formatDate(draft.savedAt)} · پیش از ثبت، تغییرات هم‌زمان بررسی می‌شوند.</p></div>
      <div className="row-draft-actions">
        <button className="btn btn-secondary" onClick={() => downloadJson(draft, `SEO-form-draft-${jalaliFileDate()}.json`)}><Download size={16}/>دانلود پیش‌نویس فرم</button>
        <button className="btn btn-ghost" onClick={() => { if (window.confirm("پیش‌نویس این فرم از دستگاه حذف شود؟ برای حفظ نسخه، ابتدا آن را دانلود کنید.")) onDiscard(); }}>کنارگذاشتن پیش‌نویس فرم</button>
        <button className="btn btn-primary" onClick={onRecover}><RotateCcw size={16}/>بازیابی پیش‌نویس فرم</button>
      </div>
    </div>}
  </>;
}
