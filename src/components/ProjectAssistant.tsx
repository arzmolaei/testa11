import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpLeft, Check, CheckCircle2, ClipboardList, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { uid } from "../domain";
import { formatDate, todayIso, toIsoDate } from "../dates";
import { getProjectActions } from "../workflow";
import { loadAssistantDraft, saveAssistantDraft } from "../assistant-draft";
import type { AssistantDraft } from "../assistant-draft";
import type { ActionView, ProjectAction } from "../workflow";
import type { Project, Row } from "../types";
import { JalaliDateInput } from "./JalaliDateInput";
import "./ProjectAssistant.css";

type Props = {
  project: Project;
  onProjectChange: (project: Project) => boolean | void;
  onNavigate: (view: ActionView, rowId?: string) => void;
  readOnly?: boolean;
  draftScope?: string;
  notify: (message: string) => void;
};
const text = (value: unknown) => String(value ?? "");
const number = (value: number) => value.toLocaleString("fa-IR");
const priorityLabels: Record<string, string> = { P0: "اولویت فوری", P1: "اولویت بالا", P2: "اولویت عادی" };
const freshTask = (): Row => ({ id: uid(), title: "", status: "open", priority: "P2", dueDate: "", pageId: "", notes: "" });
const targetView = (task: Row): ActionView => ["keywords", "pages", "content", "results", "bulk"].includes(text(task.view)) ? text(task.view) as ActionView : task.contentId ? "content" : task.keywordId ? "keywords" : /^(gsc:|result:)/.test(text(task.source)) ? "results" : "pages";
const targetId = (task: Row | ProjectAction) => text(task.contentId || task.keywordId || task.pageId) || undefined;

export function ProjectAssistant({ project, onProjectChange, onNavigate, readOnly = false, draftScope = "local-development", notify }: Props) {
  const tasks: Row[] = project.tasks || [];
  const [scope, setScope] = useState<"today" | "all">("today");
  const [archive, setArchive] = useState(false);
  const [draft, setDraft] = useState<Row | null>(null);
  const [recovery, setRecovery] = useState<AssistantDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftError, setDraftError] = useState("");
  const baseline = useRef<Row | null>(null);
  const draftIdentity = useRef(JSON.stringify([draftScope, project.id]));
  const latestDraft = useRef<{ projectId: string; scope: string; ready: boolean; value: AssistantDraft | null }>({ projectId: project.id, scope: draftScope, ready: false, value: null });
  const [visible, setVisible] = useState(40);
  const today = todayIso();
  const actions = useMemo(() => getProjectActions(project, today), [project, today]);
  if (draftIdentity.current === JSON.stringify([draftScope, project.id])) latestDraft.current = { projectId: project.id, scope: draftScope, ready: draftReady && !draftError, value: draft ? { version: 1, projectId: project.id, scope: draftScope, savedAt: new Date().toISOString(), row: draft, baseline: baseline.current } : recovery };
  useEffect(() => {
    let canceled = false;
    draftIdentity.current = JSON.stringify([draftScope, project.id]);
    latestDraft.current = { projectId: project.id, scope: draftScope, ready: false, value: null };
    setDraft(null); baseline.current = null; setRecovery(null); setDraftReady(false); setDraftError(""); setArchive(false); setVisible(40);
    loadAssistantDraft(project.id, draftScope).then((saved) => { if (!canceled) setRecovery(saved); })
      .catch(() => { if (!canceled) setDraftError("ذخیرهٔ خودکار پیش‌نویس روی این دستگاه در دسترس نیست؛ تا ثبت کار، فرم را باز نگه دارید."); })
      .finally(() => { if (!canceled) setDraftReady(true); });
    return () => { canceled = true; };
  }, [project.id, draftScope]);
  useEffect(() => {
    if (!draftReady || draftError || readOnly && !latestDraft.current.value) return;
    const timer = window.setTimeout(() => { saveAssistantDraft(project.id, draftScope, latestDraft.current.value).catch(() => setDraftError("پیش‌نویس روی این دستگاه ذخیره نشد؛ فرم را تا ثبت کار باز نگه دارید.")); }, 200);
    return () => window.clearTimeout(timer);
  }, [project.id, draftScope, draftReady, draftError, readOnly, draft, recovery]);
  useEffect(() => () => {
    const latest = latestDraft.current;
    if (latest.projectId === project.id && latest.scope === draftScope && latest.ready) void saveAssistantDraft(project.id, draftScope, latest.value).catch(() => {});
  }, [project.id, draftScope]);
  useEffect(() => {
    if (!draft) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [draft]);
  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "dismissed");
  const displayed = useMemo(() => {
    const items: Array<{ id: string; task?: Row; action?: ProjectAction; priority: string; due: string }> = [];
    for (const task of tasks) {
      const closed = task.status === "done" || task.status === "dismissed";
      if (closed !== archive) continue;
      const due = toIsoDate(text(task.dueDate)) || "";
      if (!archive && scope === "today" && due && due > today) continue;
      items.push({ id: `task:${task.id}`, task, priority: text(task.priority) || "P2", due });
    }
    if (!archive) for (const action of actions) items.push({ id: action.id, action, priority: action.priority, due: "" });
    return items.sort((a, b) => a.priority.localeCompare(b.priority) || (a.due || "9999").localeCompare(b.due || "9999") || a.id.localeCompare(b.id));
  }, [tasks, actions, scope, archive, today]);

  function saveTasks(next: Row[]) {
    if (readOnly) return false;
    try { return onProjectChange({ ...project, tasks: next }) !== false; }
    catch (error) { notify(error instanceof Error ? error.message : "ذخیرهٔ کار انجام نشد؛ پیش‌نویس حفظ شده است."); return false; }
  }
  function track(action: ProjectAction, status: "open" | "done" | "dismissed") {
    if (readOnly) return;
    if (tasks.some((task) => task.source === action.id)) { notify("این پیشنهاد قبلاً در کارهای پروژه ثبت شده است."); return; }
    const row: Row = { id: uid(), title: action.title, status, priority: action.priority, notes: action.reason, source: action.id, view: action.view, createdAt: today, ...(status === "done" ? { completedAt: today } : {}), ...(action.pageId ? { pageId: action.pageId } : {}), ...(action.contentId ? { contentId: action.contentId } : {}), ...(action.keywordId ? { keywordId: action.keywordId } : {}) };
    if (!saveTasks([...tasks, row])) return;
    notify(status === "open" ? "پیشنهاد در کارهای پروژه ثبت شد." : status === "done" ? "بررسی این پیشنهاد انجام‌شده ثبت شد." : "پیشنهاد کنار گذاشته شد؛ از کارهای بسته قابل بازگرداندن است.");
  }
  function changeStatus(task: Row, status: string) {
    saveTasks(tasks.map((item) => item.id === task.id ? { ...item, status, completedAt: status === "done" ? today : "" } : item));
  }
  function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || !draft) return;
    const title = text(draft.title).trim();
    if (!title) return;
    if (draft.dueDate && !toIsoDate(text(draft.dueDate))) { notify("تاریخ کار معتبر نیست."); return; }
    if (draft.pageId && !project.pages.some((page) => page.id === draft.pageId)) { notify("صفحهٔ مرتبط حذف شده است؛ صفحهٔ دیگری انتخاب کنید."); return; }
    const original = tasks.find((task) => task.id === draft.id);
    if (baseline.current && JSON.stringify(original) !== JSON.stringify(baseline.current) || !baseline.current && original) { notify("این کار پس از باز شدن فرم تغییر کرده است؛ پیش‌نویس حفظ شد. آن را کپی کنید و آخرین نسخهٔ کار را دوباره باز کنید."); return; }
    const row: Row = { ...draft, title, createdAt: draft.createdAt || today };
    if (!saveTasks(tasks.some((task) => task.id === row.id) ? tasks.map((task) => task.id === row.id ? row : task) : [...tasks, row])) return;
    latestDraft.current.value = null;
    baseline.current = null; setDraft(null); setRecovery(null);
    void saveAssistantDraft(project.id, draftScope, null).catch(() => setDraftError("کار ثبت شد؛ حذف نسخهٔ موقت از این دستگاه انجام نشد."));
    notify("کار پروژه ذخیره شد.");
  }
  function openTask(row?: Row) {
    if (readOnly || !draftReady || recovery) return;
    if (draft && !window.confirm("پیش‌نویس کار فعلی کنار گذاشته شود؟")) return;
    baseline.current = row ? { ...row } : null;
    setDraft(row ? { ...row } : freshTask()); setArchive(false);
  }
  function discardDraft() {
    if (draft && !window.confirm("پیش‌نویس این کار کنار گذاشته شود؟")) return;
    baseline.current = null; latestDraft.current.value = null; setDraft(null); setRecovery(null);
    void saveAssistantDraft(project.id, draftScope, null).catch(() => setDraftError("حذف پیش‌نویس از این دستگاه انجام نشد."));
  }
  const pageName = (id: unknown) => { const page = project.pages.find((item) => item.id === id); return page ? text(page.target || page.pkw || page.pageId) : ""; };

  return <section className="project-assistant" aria-labelledby="project-assistant-title">
    <div className="assistant-heading"><div><span className="assistant-eyebrow"><Sparkles size={15} />دستیار پروژه</span><h2 id="project-assistant-title">امروز چه کاری انجام بدهم؟</h2><p>پیشنهادهای قابل بررسی بر اساس اطلاعات همین پروژه؛ با دلیل روشن و قدم بعدی.</p></div><button className="btn btn-secondary" disabled={readOnly || !draftReady || !!recovery} onClick={() => openTask()}><Plus size={16} />کار جدید</button></div>
    <div className="assistant-summary"><span><strong>{number(openTasks.length)}</strong> کار باز</span><span><strong>{number(actions.length)}</strong> پیشنهاد بررسی</span><span><strong>{number(openTasks.filter((task) => { const date = toIsoDate(text(task.dueDate)); return date && date < today; }).length)}</strong> کار عقب‌افتاده</span></div>
    {draftError && <p className="assistant-draft-error" role="alert">{draftError}</p>}
    {recovery && !readOnly && <div className="assistant-draft-recovery" role="status"><div><strong>یک پیش‌نویس کار از قبل روی این دستگاه باقی مانده است.</strong><p>{formatDate(recovery.savedAt)} · {text(recovery.row.title) || "کار بدون عنوان"}</p></div><div><button className="btn btn-secondary" onClick={() => { baseline.current = recovery.baseline; setDraft({ ...recovery.row }); setRecovery(null); }}>بازیابی پیش‌نویس کار</button><button className="btn btn-ghost" onClick={() => { if (window.confirm("پیش‌نویس قبلی این کار از دستگاه حذف شود؟")) discardDraft(); }}>کنارگذاشتن پیش‌نویس کار</button></div></div>}
    {draft && <form className="assistant-task-form" onSubmit={saveDraft} data-unsaved="true">
      <div className="assistant-form-heading"><h3>{tasks.some((task) => task.id === draft.id) ? "ویرایش کار" : "کار جدید پروژه"}</h3><button type="button" className="btn btn-ghost" aria-label="بستن فرم کار" onClick={discardDraft}><X size={18}/></button></div>
      <label className="field assistant-title-field"><span>عنوان کار</span><input autoFocus disabled={readOnly} required maxLength={200} aria-label="عنوان کار پروژه" value={text(draft.title)} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="مثلاً بررسی عنوان صفحهٔ دسته‌بندی"/></label>
      <label className="field"><span>اولویت</span><select disabled={readOnly} aria-label="اولویت کار" value={text(draft.priority)} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span>تاریخ انجام</span><JalaliDateInput disabled={readOnly} value={text(draft.dueDate)} onChange={(dueDate) => setDraft({ ...draft, dueDate })} aria-label="تاریخ انجام کار"/></label>
      <label className="field assistant-title-field"><span>صفحهٔ مرتبط، اختیاری</span><select disabled={readOnly} aria-label="صفحهٔ مرتبط با کار" value={text(draft.pageId)} onChange={(event) => setDraft({ ...draft, pageId: event.target.value })}><option value="">بدون صفحهٔ مرتبط</option>{draft.pageId && !project.pages.some((page) => page.id === draft.pageId) && <option value={text(draft.pageId)} disabled>صفحهٔ حذف‌شده؛ یک صفحهٔ دیگر انتخاب کنید</option>}{project.pages.map((page) => <option key={page.id} value={page.id}>{text(page.target || page.pkw || page.pageId) || "صفحهٔ بدون نام"}</option>)}</select></label>
      <label className="field assistant-title-field"><span>یادداشت و دلیل</span><textarea disabled={readOnly} maxLength={3000} rows={3} aria-label="یادداشت کار" value={text(draft.notes)} onChange={(event) => setDraft({ ...draft, notes: event.target.value })}/></label>
      <div className="assistant-form-actions"><button type="button" className="btn btn-secondary" onClick={discardDraft}>انصراف</button><button className="btn btn-primary" type="submit" disabled={readOnly}><Check size={16}/>ذخیرهٔ کار</button></div>
    </form>}
    <div className="assistant-filters"><div className="assistant-scope" role="group" aria-label="زمان کارهای پروژه"><button className={scope === "today" ? "active" : ""} onClick={() => { setScope("today"); setVisible(40); }}>امروز و بدون تاریخ</button><button className={scope === "all" ? "active" : ""} onClick={() => { setScope("all"); setVisible(40); }}>همهٔ کارها</button></div><label><input type="checkbox" checked={archive} onChange={(event) => { setArchive(event.target.checked); setVisible(40); }}/>نمایش کارهای بسته</label></div>
    <div className="assistant-queue" aria-live="polite">
      {displayed.slice(0, visible).map(({ id, task, action, priority: itemPriority, due }) => <article className={`assistant-action ${task?.status === "done" ? "completed" : ""}`} key={id}>
        <div className="assistant-action-main"><div className="assistant-action-meta"><span className={`assistant-priority ${itemPriority}`}>{priorityLabels[itemPriority] || "اولویت عادی"}</span><span>{action ? "پیشنهاد بررسی" : task?.status === "done" ? "انجام شده" : task?.status === "dismissed" ? "کنار گذاشته شده" : task?.source ? "کار ثبت‌شده از پیشنهاد" : "کار شما"}</span>{due && <span className={due < today && task?.status === "open" ? "assistant-overdue" : ""}>{formatDate(due)}</span>}</div><h3>{action?.title || text(task?.title)}</h3><p>{action?.reason || text(task?.notes) || "یادداشتی ثبت نشده است."}</p>{task?.pageId && pageName(task.pageId) && <small>صفحهٔ مرتبط: {pageName(task.pageId)}</small>}</div>
        <div className="assistant-action-buttons">
          {(action || targetId(task!)) && <button className="btn btn-secondary" onClick={() => onNavigate(action?.view || targetView(task!), targetId(action || task!))}><ArrowUpLeft size={15}/>بررسی</button>}
          {action ? <><button className="btn btn-ghost" disabled={readOnly} onClick={() => track(action, "open")}><ClipboardList size={15}/>ثبت در کارها</button><button className="btn btn-ghost" disabled={readOnly} aria-label={`انجام شد: ${action.title}`} onClick={() => track(action, "done")}><Check size={16}/>انجام شد</button><button className="btn btn-ghost" disabled={readOnly} aria-label={`کنار گذاشتن: ${action.title}`} onClick={() => track(action, "dismissed")}><X size={15}/></button></> : <>
            {!archive ? <button className="btn btn-ghost" disabled={readOnly} onClick={() => changeStatus(task!, "done")}><CheckCircle2 size={16}/>انجام شد</button> : <button className="btn btn-ghost" disabled={readOnly} onClick={() => changeStatus(task!, "open")}>بازگرداندن</button>}
            <button className="btn btn-ghost" disabled={readOnly || !draftReady || !!recovery} aria-label={`ویرایش کار ${text(task?.title)}`} onClick={() => openTask(task!)}><Pencil size={15}/></button>
            <button className="btn btn-ghost" disabled={readOnly} aria-label={`حذف کار ${text(task?.title)}`} onClick={() => { if (window.confirm("این کار حذف شود؟ اگر از پیشنهاد ثبت شده باشد، پیشنهاد دوباره در صف ظاهر می‌شود.") && saveTasks(tasks.filter((item) => item.id !== task!.id))) notify("کار حذف شد."); }}><Trash2 size={15}/></button>
          </>}
        </div>
      </article>)}
      {!displayed.length && <div className="assistant-empty"><CheckCircle2 size={30}/><h3>{archive ? "کار بسته‌ای ثبت نشده است" : "صف کارهای این بخش خالی است"}</h3><p>{archive ? "کارهای انجام‌شده و کنارگذاشته‌شده اینجا قابل بازگرداندن‌اند." : "با ورود کلمات، صفحات و دادهٔ عملکرد، پیشنهادهای مرتبط ظاهر می‌شوند. کار شخصی هم می‌توانید ثبت کنید."}</p></div>}
    </div>
    {displayed.length > visible && <button className="btn btn-secondary assistant-more" onClick={() => setVisible((count) => count + 40)}>نمایش {number(Math.min(40, displayed.length - visible))} مورد بعدی</button>}
    <p className="assistant-footnote">این صف، وضعیت اطلاعات ثبت‌شده را بررسی می‌کند. هیچ صفحه‌ای در وب اسکن نشده و هیچ تغییر سئویی بدون تصمیم شما انجام نمی‌شود.</p>
  </section>;
}
