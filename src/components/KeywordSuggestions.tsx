import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Layers3, Plus, Search, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { LISTS } from "../domain";
import { applyKeywordSuggestions, buildKeywordSuggestions } from "../suggestions";
import type { KeywordRule } from "../suggestions";
import type { WorkspaceProps } from "../types";
import "./KeywordSuggestions.css";

type Props = WorkspaceProps & {
  selectedIds?: ReadonlySet<string>;
  applyLabel?: string;
  disabled?: boolean;
};
const number = (value: number) => value.toLocaleString("fa-IR");
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

export function KeywordSuggestions({ project, onRowsChange, notify, selectedIds = EMPTY_SELECTION, applyLabel = "اعمال پیشنهادها", disabled = false }: Props) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [mode, setMode] = useState<"automatic" | "rules">("automatic");
  const [suggestGroups, setSuggestGroups] = useState(true);
  const [suggestIntents, setSuggestIntents] = useState(true);
  const [replaceGroups, setReplaceGroups] = useState(false);
  const [replaceIntents, setReplaceIntents] = useState(false);
  const [rules, setRules] = useState<KeywordRule[]>([{ id: "rule-1", phrase: "", group: "", intent: "" }]);
  const nextRule = useRef(2);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(60);
  const [confirm, setConfirm] = useState(false);
  const modal = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const validSelected = useMemo(() => new Set(project.keywords.filter((row) => selectedIds.has(row.id)).map((row) => row.id)), [project.keywords, selectedIds]);
  const preview = useMemo(() => open ? buildKeywordSuggestions(project.keywords, {
    ...(scope === "selected" ? { scopeIds: validSelected } : {}),
    mode, rules, suggestGroups, suggestIntents, replaceGroups, replaceIntents,
  }) : null, [open, project.keywords, scope, validSelected, mode, rules, suggestGroups, suggestIntents, replaceGroups, replaceIntents]);
  const groups = useMemo(() => preview?.groups.filter((group) => {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${labels[group.id] ?? group.label} ${group.examples.join(" ")}`.toLocaleLowerCase().includes(needle);
  }) ?? [], [preview, query, labels]);
  const totals = useMemo(() => {
    let rows = 0, groups = 0, intents = 0, overwritten = 0;
    for (const suggestion of preview?.suggestions ?? []) {
      if (excluded.has(suggestion.groupId)) continue;
      const hasGroup = Boolean(suggestion.group && (labels[suggestion.groupId] ?? suggestion.group).trim());
      if (hasGroup) { groups++; if (suggestion.before.group) overwritten++; }
      if (suggestion.intent) { intents++; if (suggestion.before.intent) overwritten++; }
      if (hasGroup || suggestion.intent) rows++;
    }
    return { rows, groups, intents, overwritten };
  }, [preview, excluded, labels]);

  function resetPreview() {
    setLabels({});
    setExcluded(new Set());
    setQuery("");
    setVisible(60);
    setConfirm(false);
  }
  function close() { setOpen(false); setConfirm(false); }
  function changeRule(id: string, patch: Partial<KeywordRule>) {
    setRules((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
    resetPreview();
  }

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => modal.current?.querySelector<HTMLButtonElement>("button")?.focus(), 0);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); setConfirm(false); }
      if (event.key !== "Tab" || !modal.current) return;
      const items = [...modal.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter((node) => node.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !modal.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !modal.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = priorOverflow;
      document.removeEventListener("keydown", handleKey);
      (previous?.isConnected ? previous : trigger.current)?.focus();
    };
  }, [open]);

  function apply() {
    if (!preview || disabled) return;
    const result = applyKeywordSuggestions(project.keywords, preview, { excludedGroups: excluded, labels });
    if (result.changed) onRowsChange("keywords", result.rows);
    notify(result.changed
      ? `${number(result.changed)} کلمه به‌روزرسانی شد: ${number(result.groupChanges)} گروه و ${number(result.intentChanges)} نیت.${result.skipped ? ` ${number(result.skipped)} کلمه به دلیل تغییر هم‌زمان کنار گذاشته شد.` : ""}`
      : "تغییری برای اعمال وجود ندارد.");
    close();
  }

  return <>
    <button ref={trigger} className="btn btn-secondary" onClick={() => { resetPreview(); setOpen(true); }} disabled={disabled || !project.keywords.length}>
      <Sparkles size={16} /> پیشنهاد گروه‌بندی
    </button>
    {open && <div className="modal-backdrop suggestions-backdrop" onClick={close}>
      <div ref={modal} className="modal keyword-suggestions" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <div className="suggestions-header">
          <div className="suggestions-title"><span className="suggestions-icon"><Sparkles size={24} /></span><div><h2 id={titleId}>دستیار سامان‌دهی کلمات</h2><p>هزاران کلمه؛ یک پیش‌نمایش و یک تغییر گروهی</p></div></div>
          <button className="btn btn-ghost suggestions-close" aria-label="بستن پیشنهادها" onClick={close}><X size={19} /></button>
        </div>

        {confirm ? <div className="suggestions-confirm">
          <ShieldCheck size={39} />
          <h3>تغییرات پیشنهادی را تأیید کنید</h3>
          <p>{number(totals.rows)} کلمه تغییر می‌کند: {number(totals.groups)} گروه و {number(totals.intents)} نیت جست‌وجو.</p>
          {totals.overwritten > 0 && <p className="suggestions-warning">{number(totals.overwritten)} مقدار دستی با پیشنهادهای انتخاب‌شده جایگزین می‌شود.</p>}
          <p className="suggestions-disclaimer">این گروه‌ها موضوعی‌اند. تعیین یک صفحه مشترک به بررسی نیت و نتایج جست‌وجو نیاز دارد.</p>
          <div className="suggestions-actions"><button className="btn btn-secondary" onClick={() => setConfirm(false)}>بازگشت به پیش‌نمایش</button><button className="btn btn-primary" disabled={disabled || !totals.rows} onClick={apply}><Check size={16} />{applyLabel}</button></div>
        </div> : <>
          <div className="suggestions-body">
            <div className="suggestions-mode" role="group" aria-label="روش پیشنهاد">
              <button className={mode === "automatic" ? "active" : ""} onClick={() => { setMode("automatic"); resetPreview(); }}><Sparkles size={15} />پیشنهاد خودکار</button>
              <button className={mode === "rules" ? "active" : ""} onClick={() => { setMode("rules"); resetPreview(); }}><Layers3 size={15} />قانون دلخواه</button>
            </div>
            <div className="suggestions-controls">
              <label className="field"><span>دامنه تغییرات</span><select aria-label="دامنه پیشنهادها" value={scope} onChange={(event) => { setScope(event.target.value as "all" | "selected"); resetPreview(); }}><option value="all">تمام {number(project.keywords.length)} کلمه</option><option value="selected" disabled={!validSelected.size}>{number(validSelected.size)} کلمه انتخاب‌شده</option></select></label>
              <label className="suggestions-check"><input type="checkbox" checked={suggestGroups} onChange={(event) => { setSuggestGroups(event.target.checked); resetPreview(); }} />پیشنهاد گروه / موضوع</label>
              <label className="suggestions-check"><input type="checkbox" checked={suggestIntents} onChange={(event) => { setSuggestIntents(event.target.checked); resetPreview(); }} />پیشنهاد نیت جست‌وجو</label>
            </div>
            {mode === "automatic" ? <div className="suggestions-explanation"><ShieldCheck size={18} /><p>کلماتِ خرید، قیمت، آموزش و مانند آن را از موضوع جدا می‌کنیم. نام برند، مدل و ویژگی‌ها حفظ می‌شود؛ ادغام مترادف‌ها انجام نمی‌شود. نیت، پیشنهادِ قابل بازبینی است و داده‌ای از نتایج گوگل دریافت نشده است.</p></div> : <div className="suggestions-rules">
              <p className="muted">اگر کلمه شامل عبارت زیر بود، این گروه یا نیت را پیشنهاد بده. اولین قانون منطبق برای هر فیلد اولویت دارد.</p>
              {rules.map((rule, index) => <div className="suggestions-rule" key={rule.id}>
                <span className="suggestions-rule-number">{number(index + 1)}</span>
                <label className="field"><span>عبارت شامل</span><input aria-label={`عبارت قانون ${index + 1}`} placeholder="مثلاً دوربین داهوا" value={rule.phrase} onChange={(event) => changeRule(rule.id, { phrase: event.target.value })} /></label>
                <label className="field"><span>گروه پیشنهادی</span><input aria-label={`گروه قانون ${index + 1}`} placeholder="مثلاً محصولات داهوا" value={rule.group ?? ""} onChange={(event) => changeRule(rule.id, { group: event.target.value })} /></label>
                <label className="field"><span>نیت پیشنهادی</span><select aria-label={`نیت قانون ${index + 1}`} value={rule.intent ?? ""} onChange={(event) => changeRule(rule.id, { intent: event.target.value })}><option value="">بدون تغییر نیت</option>{LISTS.intent.map((intent) => <option key={intent}>{intent}</option>)}</select></label>
                <button className="btn btn-ghost" aria-label={`حذف قانون ${index + 1}`} onClick={() => { setRules((items) => items.filter((item) => item.id !== rule.id)); resetPreview(); }}><Trash2 size={16} /></button>
              </div>)}
              <button className="btn btn-secondary" disabled={rules.length >= 12} onClick={() => { setRules((items) => [...items, { id: `rule-${nextRule.current++}`, phrase: "", group: "", intent: "" }]); resetPreview(); }}><Plus size={15} />افزودن قانون</button>
            </div>}
            <details className="suggestions-preservation"><summary>حفاظت از ارزیابی‌های دستی <span>پیش‌فرض: حفظ مقادیر موجود</span></summary><div>
              <label className="suggestions-check"><input type="checkbox" checked={replaceGroups} onChange={(event) => { setReplaceGroups(event.target.checked); resetPreview(); }} />گروه‌های دستی هم جایگزین شوند</label>
              <label className="suggestions-check"><input type="checkbox" checked={replaceIntents} onChange={(event) => { setReplaceIntents(event.target.checked); resetPreview(); }} />نیت‌های دستی هم جایگزین شوند</label>
              {(replaceGroups || replaceIntents) && <p className="suggestions-warning">جایگزینی دستی فعال است. تعداد مقادیر جایگزین‌شده پیش از اعمال نمایش داده می‌شود.</p>}
            </div></details>
            <div className="suggestions-preview-heading"><div><h3>پیش‌نمایش پیشنهادها</h3><span>{number(preview?.scopeCount ?? 0)} کلمه بررسی شد · {number(preview?.groups.length ?? 0)} گروه پیشنهادی</span></div><label className="suggestions-search"><Search size={16} /><input aria-label="جست‌وجوی گروه‌های پیشنهادی" placeholder="جست‌وجو در پیشنهادها…" value={query} onChange={(event) => { setQuery(event.target.value); setVisible(60); }} /></label></div>
            {!!preview?.groups.length && <div className="suggestions-select-actions"><button className="btn btn-ghost" onClick={() => setExcluded(new Set())}>انتخاب همه پیشنهادها</button><button className="btn btn-ghost" onClick={() => setExcluded(new Set(preview.groups.map((group) => group.id)))}>لغو انتخاب همه</button></div>}
            <div className="suggestions-preview" aria-live="polite">
              {groups.slice(0, visible).map((group) => <div className={`suggestions-group ${excluded.has(group.id) ? "excluded" : ""}`} key={group.id}>
                <label className="suggestions-group-toggle"><input type="checkbox" aria-label={`انتخاب پیشنهاد ${group.label}`} checked={!excluded.has(group.id)} onChange={(event) => setExcluded((old) => { const next = new Set(old); if (event.target.checked) next.delete(group.id); else next.add(group.id); return next; })} /><span>{number(group.rowIds.length)} کلمه</span></label>
                <div className="suggestions-group-main"><label className="field"><span>{group.groupCount ? "نام گروه؛ قابل ویرایش" : "موضوع واژگانی؛ فقط تغییر نیت"}</span>{group.groupCount ? <input aria-label={`نام گروه ${group.label}`} value={labels[group.id] ?? group.label} onChange={(event) => setLabels((old) => ({ ...old, [group.id]: event.target.value }))} /> : <strong>{group.label}</strong>}</label><p className="suggestions-examples">{group.examples.join(" · ")}{group.rowIds.length > group.examples.length ? ` · و ${number(group.rowIds.length - group.examples.length)} کلمه دیگر` : ""}</p><div className="suggestions-intents">{Object.entries(group.intents).map(([intent, count]) => <span key={intent}>{intent}: {number(count)}</span>)}</div></div>
              </div>)}
              {!groups.length && <div className="suggestions-empty"><Layers3 size={29} /><strong>{query ? "پیشنهادی با این جست‌وجو پیدا نشد" : "تغییری برای پیشنهاد وجود ندارد"}</strong><p>{mode === "rules" ? "عبارت و گروه یا نیتِ قانون را وارد کنید. مقادیر دستی به‌صورت پیش‌فرض حفظ می‌شوند." : "مقادیر دستی حفظ می‌شوند؛ کلمات بدون نشانه روشنِ نیت، نیت پیشنهادی ندارند."}</p></div>}
              {groups.length > visible && <button className="btn btn-secondary suggestions-more" onClick={() => setVisible((count) => count + 60)}>نمایش {number(Math.min(60, groups.length - visible))} گروه بعدی <ChevronLeft size={15} /></button>}
            </div>
          </div>
          <div className="suggestions-footer"><div><strong>{number(totals.rows)} کلمه آماده تغییر</strong><span>{number(totals.groups)} گروه · {number(totals.intents)} نیت · بدون تغییر در سختی، حجم یا شناسه‌ها</span></div><button className="btn btn-primary" disabled={disabled || !totals.rows} onClick={() => setConfirm(true)}>بازبینی و تأیید <ChevronLeft size={16} /></button></div>
        </>}
      </div>
    </div>}
  </>;
}
