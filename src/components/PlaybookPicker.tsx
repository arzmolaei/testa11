import { BookOpen, Check, ChevronDown, Save } from "lucide-react";
import { useId, useState } from "react";
import { cloneProjectPlaybook, createCustomPlaybook, PROJECT_PLAYBOOKS } from "../playbooks";
import type { ProjectPlaybook } from "../playbooks";
import "./PlaybookPicker.css";

export type PlaybookPickerProps = {
  value?: ProjectPlaybook;
  onChange: (value: ProjectPlaybook) => void;
  customPlaybooks?: ProjectPlaybook[];
  onSave?: (playbook: ProjectPlaybook) => boolean | void;
  disabled?: boolean;
};

export function PlaybookPicker({ value, onChange, customPlaybooks = [], onSave, disabled = false }: PlaybookPickerProps) {
  const heading = useId();
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const recipes = [...PROJECT_PLAYBOOKS, ...customPlaybooks];
  const update = (key: keyof ProjectPlaybook, text: string) => {
    if (!value || disabled) return;
    setMessage("");
    setMessageError(false);
    onChange({ ...cloneProjectPlaybook(value), [key]: text });
  };
  return <section className="playbook-picker" aria-labelledby={heading}>
    <div className="playbook-heading"><BookOpen size={19} /><div><h3 id={heading}>روال آمادهٔ پروژه</h3><p>یک نقطه شروع انتخاب کن؛ تمام جزئیات قابل تغییرند.</p></div></div>
    <div className="playbook-options" role="group" aria-label="انتخاب روال پروژه">
      {recipes.map((recipe) => <button type="button" key={recipe.id} className={value?.id === recipe.id ? "selected" : ""} aria-pressed={value?.id === recipe.id} disabled={disabled} onClick={() => { onChange(cloneProjectPlaybook(recipe)); setMessage(""); }}>
        <span>{recipe.label}</span>{value?.id === recipe.id && <Check size={15} />}
      </button>)}
    </div>
    {value && <>
      <div className="playbook-summary"><span>هدف اقدام</span><p>{value.conversionGoal || "هدف پروژه را در جزئیات مشخص کن."}</p></div>
      <button type="button" className="playbook-details-toggle" aria-expanded={expanded} aria-controls={`${heading}-details`} onClick={() => setExpanded(!expanded)}><ChevronDown size={15} className={expanded ? "expanded" : ""} />{expanded ? "بستن جزئیات روال" : "مخاطب، بریف و قواعد پیشنهادی"}</button>
      {expanded && <div className="playbook-details" id={`${heading}-details`}>
        <label className="field"><span>نام روال</span><input aria-label="نام روال" value={value.label} maxLength={100} disabled={disabled} onChange={(event) => update("label", event.target.value)} /></label>
        <label className="field"><span>مخاطب هدف</span><textarea aria-label="مخاطب هدف" rows={2} value={value.audience} maxLength={2000} disabled={disabled} onChange={(event) => update("audience", event.target.value)} /></label>
        <label className="field"><span>اقدام مورد انتظار مخاطب</span><textarea aria-label="اقدام مورد انتظار مخاطب" rows={2} value={value.conversionGoal} maxLength={2000} disabled={disabled} onChange={(event) => update("conversionGoal", event.target.value)} /></label>
        <label className="field"><span>قالب اولیهٔ بریف</span><textarea aria-label="قالب اولیهٔ بریف" rows={5} value={value.briefTemplate} maxLength={12000} disabled={disabled} onChange={(event) => update("briefTemplate", event.target.value)} /><small>برای پیشنهاد بریف استفاده می‌شود؛ محتوای دستی را جایگزین نمی‌کند.</small></label>
        <label className="field"><span>راهنمای گروه‌بندی</span><textarea aria-label="راهنمای گروه‌بندی" rows={3} value={value.groupingRules || ""} maxLength={6000} disabled={disabled} onChange={(event) => update("groupingRules", event.target.value)} /><small>راهنمای تصمیم‌گیری؛ تأیید یک صفحه مشترک همچنان با توست.</small></label>
        {onSave && <button type="button" className="btn btn-secondary" disabled={disabled || !value.label.trim()} onClick={() => {
          try {
            const saved = createCustomPlaybook(value);
            if (onSave(cloneProjectPlaybook(saved)) === false) {
              setMessageError(true);
              setMessage("روال ذخیره نشد؛ جزئیات فعلی برای اصلاح باقی مانده است.");
              return;
            }
            onChange(cloneProjectPlaybook(saved)); setMessageError(false);
            setMessage("روال شخصی برای پروژه‌های بعد ذخیره شد.");
          }
          catch (error) { setMessageError(true); setMessage(error instanceof Error ? error.message : "ذخیره روال انجام نشد."); }
        }}><Save size={15} />ذخیره به‌عنوان روال شخصی</button>}
      </div>}
    </>}
    {message && <p className={`playbook-message${messageError ? " error" : ""}`} role={messageError ? "alert" : "status"}>{message}</p>}
  </section>;
}

export default PlaybookPicker;
