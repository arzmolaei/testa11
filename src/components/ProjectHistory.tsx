import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Clock3, RefreshCw, Search, WifiOff } from "lucide-react";
import { AuthApiError, authRequest } from "../auth";
import { normalizeKeyword, SCHEMAS } from "../domain";
import { formatDate, isIsoDate } from "../dates";
import "./ProjectHistory.css";

type HistoryEvent = {
  id: string; createdAt: string; revision: number; actorName: string; projectId: string;
  collection: string; rowId: string; summary: string; before?: unknown; after?: unknown;
};
type Props = { projectId: string; mode?: "online" | "offline" | "local" };
type Status = "loading" | "ready" | "error" | "offline" | "local";
const PAGE_SIZE = 50;
const collections: Record<string, string> = {
  keywords: "کلمات کلیدی", pages: "نقشهٔ صفحات", content: "محتوا", results: "نتایج",
  tasks: "کارها", links: "لینک‌های داخلی", project: "اطلاعات پروژه", projects: "اطلاعات پروژه", meta: "اطلاعات پروژه", settings: "تنظیمات مشترک فضای کار",
  searchConsole: "داده‌های Search Console", playbook: "روال پروژه",
};
const labels: Record<string, string> = {
  ...Object.fromEntries(Object.values(SCHEMAS).flatMap((sections) => sections.flatMap((section) => section.fields.map((field) => [field.key, field.label])))),
  id: "شناسه", name: "نام پروژه", domain: "دامنه", market: "بازار هدف", language: "زبان", projectType: "نوع پروژه", goal: "هدف پروژه",
  title: "عنوان کار", reason: "دلیل پیشنهاد", source: "منبع", status: "وضعیت", dueDate: "موعد انجام",
  pageId: "صفحهٔ مرتبط", fromPageId: "صفحهٔ مبدأ", toPageId: "صفحهٔ مقصد", targetPage: "صفحهٔ هدف", anchor: "عبارت لینک",
  createdAt: "زمان ثبت", updatedAt: "زمان تغییر", completedAt: "زمان انجام", implementedAt: "تاریخ اجرا", importedAt: "زمان ورود داده", actorName: "انجام‌دهنده",
  audience: "مخاطب", conversionGoal: "هدف تبدیل", briefTemplate: "قالب بریف", groupingRules: "قواعد گروه‌بندی",
  current: "دورهٔ جاری", previous: "دورهٔ قبلی", periodStart: "شروع دوره", periodEnd: "پایان دوره", searchConsole: "داده‌های Search Console", playbook: "روال پروژه", label: "نام",
  titleMin: "حداقل طول عنوان", titleMax: "حداکثر طول عنوان", metaMin: "حداقل طول متا", metaMax: "حداکثر طول متا", customLabels: "نام فیلدهای اختصاصی", playbooks: "روال‌های شخصی",
};
const dateFields = new Set([...Object.values(SCHEMAS).flatMap((sections) => sections.flatMap((section) => section.fields.filter((field) => field.type === "date").map((field) => field.key))), "dueDate", "createdAt", "updatedAt", "completedAt", "implementedAt", "importedAt", "periodStart", "periodEnd"]);
const values: Record<string, string> = {
  open: "باز", done: "انجام‌شده", dismissed: "کنار گذاشته‌شده", planned: "برنامه‌ریزی‌شده", implemented: "اجراشده",
  Mapping: "هدف‌گذاری", Research: "تحقیق", "Not Started": "شروع نشده", "Brief Ready": "بریف آماده", Writing: "در حال نگارش", Editing: "ویرایش",
  Ready: "آماده", Review: "بازبینی", Published: "منتشرشده", Complete: "تکمیل‌شده", Monitoring: "پایش", "In Progress": "در حال انجام",
  New: "جدید", Existing: "موجود", Unknown: "نامشخص", "Create New": "ساخت صفحه", "Optimize Existing": "بهبود صفحه موجود",
  "Needs Review": "نیاز به بررسی", "Not Checked": "بررسی نشده", Checked: "بررسی شده", Yes: "بله", No: "خیر",
  Keep: "نگه‌داشتن", Exclude: "کنار گذاشتن", "SERP Review": "بررسی نتایج جست‌وجو", "Merge / Consolidate": "ادغام صفحات", "No Dedicated Page": "بدون صفحهٔ مستقل", "Same Page": "یک صفحهٔ مشترک", "Separate Page": "صفحات مجزا",
  Backlog: "بعداً", Optimizing: "بهینه‌سازی", Blog: "مقاله", "Buying Guide": "راهنمای خرید", Comparison: "مقایسه", PDP: "صفحهٔ محصول", PLP: "دسته‌بندی محصول", "Landing Page": "لندینگ", Service: "خدمات", FAQ: "پرسش‌های متداول", Other: "سایر",
  Improving: "رو به رشد", Dropping: "افت عملکرد", Stable: "پایدار", "Needs Work": "نیاز به اصلاح", "Not Enough Data": "دادهٔ ناکافی", Pass: "تأیید شده", "Not Applicable": "کاربرد ندارد", "In Review": "در حال بررسی", Low: "کم", Medium: "متوسط", High: "زیاد", Manual: "ثبت دستی",
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const clean = (value: unknown, length = 800) => String(value ?? "").slice(0, length);
const number = (value: number) => value.toLocaleString("fa-IR");

function validEvent(value: unknown, projectId: string): value is HistoryEvent {
  if (!object(value) || !(value.projectId === projectId || value.projectId === "" && value.collection === "settings") || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) return false;
  if (!["id", "createdAt", "actorName", "collection", "rowId", "summary"].every((key) => typeof value[key] === "string" && String(value[key]).length <= (key === "summary" ? 500 : 200))) return false;
  return !!String(value.id).trim() && isIsoDate(String(value.createdAt).slice(0, 10)) && Number.isFinite(Date.parse(String(value.createdAt)));
}
function shownValue(value: unknown, key: string, depth = 0): string {
  if (value == null || value === "") return "—";
  if (dateFields.has(key) && typeof value === "string") return formatDate(value);
  if (key === "source" && typeof value === "string") {
    const period = /^gsc:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2}):/.exec(value);
    if (period) return `پیشنهاد Search Console؛ ${formatDate(period[1])} تا ${formatDate(period[2])}`;
    if (/^link:/.test(value)) return "پیشنهاد لینک‌سازی داخلی";
    if (/^(keywords|group|page|content|result):/.test(value)) return "پیشنهاد دستیار پروژه";
  }
  if (typeof value === "string" && values[value]) return values[value];
  if (typeof value === "number") return number(value);
  if (depth >= 2 && typeof value === "object") return "…";
  const raw = Array.isArray(value) ? value.slice(0, 10).map((item) => shownValue(item, key, depth + 1)).join("، ") : object(value) ? Object.entries(value).slice(0, 10).map(([field, item]) => `${labels[field] || clean(field, 80)}: ${shownValue(item, field, depth + 1)}`).join("؛ ") : String(value);
  return raw.length > 800 ? `${raw.slice(0, 800)}…` : raw;
}
function Diff({ event }: { event: HistoryEvent }) {
  const before = object(event.before) ? event.before : {};
  const after = object(event.after) ? event.after : {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !["id", "planningCandidateId"].includes(key)).slice(0, 20);
  if (!keys.length) return null;
  return <details className="history-details"><summary>مشاهدهٔ جزئیات تغییر</summary><div className="history-diff">
    <div className="history-diff-heading"><span>فیلد</span><span>پیش از تغییر</span><span>پس از تغییر</span></div>
    {keys.map((key) => <div className="history-diff-row" key={key}><b>{labels[key] || (/^custom\d+$/u.test(key) ? "فیلد اختصاصی" : clean(key, 80))}</b><span dir="auto">{shownValue(before[key], key)}</span><span dir="auto">{shownValue(after[key], key)}</span></div>)}
  </div><p className="history-detail-note">جزئیات طولانی به‌صورت خلاصه نمایش داده می‌شوند.</p></details>;
}

export function ProjectHistory({ projectId, mode = "online" }: Props) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => { setQuery(""); setPage(0); }, [projectId]);
  useEffect(() => {
    setEvents([]); setError("");
    if (mode === "local") { setStatus("local"); return; }
    if (mode === "offline" || !online) { setStatus("offline"); return; }
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => controller.abort(), 15000);
    setStatus("loading");
    void authRequest<{ events: unknown[] }>(`history?projectId=${encodeURIComponent(projectId)}`, { signal: controller.signal })
      .then((value) => {
        if (!active) return;
        if (!Array.isArray(value.events)) throw new Error("ساختار سابقهٔ تغییرات معتبر نیست.");
        const unique = new Set<string>();
        setEvents(value.events.slice(0, 200).filter((event): event is HistoryEvent => {
          if (!validEvent(event, projectId) || unique.has(event.id)) return false;
          unique.add(event.id); return true;
        }));
        setPage(0); setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof AuthApiError && cause.code.includes("MIGRATION")
          ? "جدول سابقهٔ تغییرات آماده نیست. میان‌بر به‌روزرسانی یا نصب‌کنندهٔ ویندوز را دوباره اجرا کنید تا دیتابیس به‌روزرسانی شود."
          : cause instanceof AuthApiError ? cause.message : "سابقهٔ تغییرات دریافت نشد. اتصال را بررسی و دوباره تلاش کنید.");
        setStatus(navigator.onLine ? "error" : "offline");
      })
      .finally(() => window.clearTimeout(timer));
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [projectId, mode, online, refresh]);
  const filtered = useMemo(() => {
    const needle = normalizeKeyword(query);
    return events.filter((event) => !needle || normalizeKeyword(`${event.actorName} ${event.summary} ${collections[event.collection] || event.collection} ${formatDate(event.createdAt)} ${shownValue(event.before, "before")} ${shownValue(event.after, "after")}`).includes(needle));
  }, [events, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const canRefresh = mode === "online" && online && status !== "loading";
  return <section className="project-history" aria-label="سابقهٔ تغییرات پروژه" aria-busy={status === "loading"}>
    <div className="history-heading"><div className="history-title"><span className="history-icon"><Clock3 size={21} /></span><div><h3>سابقهٔ تغییرات</h3><p>۲۰۰ تغییر اخیر ذخیره‌شده در فضای ابری این پروژه و تنظیمات مشترک؛ همراه با نام انجام‌دهنده.</p></div></div><button type="button" className="btn btn-secondary history-refresh" disabled={!canRefresh} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} />دریافت دوباره</button></div>
    {status === "ready" && !!events.length && <div className="history-toolbar"><label className="history-search"><Search size={16} /><input aria-label="جست‌وجو در سابقه تغییرات" placeholder="جست‌وجوی تغییر، نام یا تاریخ…" value={query} maxLength={200} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label><span>{number(filtered.length)} تغییر</span></div>}
    {status === "loading" && <div className="history-state" role="status"><RefreshCw size={20} /><strong>در حال دریافت سابقهٔ تغییرات…</strong></div>}
    {status === "offline" && <div className="history-state"><WifiOff size={23} /><strong>برای مشاهدهٔ سابقه به اینترنت متصل شوید</strong><p>سابقه از فضای ابری دریافت می‌شود. تغییرات آفلاین پس از همگام‌سازی در این بخش ثبت خواهند شد.</p></div>}
    {status === "local" && <div className="history-state"><Clock3 size={23} /><strong>سابقهٔ تیمی در فضای ابری نگهداری می‌شود</strong><p>در محیط محلی، سابقهٔ سرور در دسترس نیست. پس از نصب و ورود به برنامهٔ ابری، تغییرات ذخیره‌شده را اینجا می‌بینید.</p></div>}
    {status === "error" && <div className="history-state history-error" role="alert"><AlertCircle size={23} /><strong>دریافت سابقه انجام نشد</strong><p>{error}</p></div>}
    {status === "ready" && !filtered.length && <div className="history-state"><Clock3 size={23} /><strong>{events.length ? "تغییری با این جست‌وجو پیدا نشد" : "هنوز تغییری در سابقهٔ این پروژه ثبت نشده"}</strong><p>{events.length ? "نام، عبارت یا تاریخ دیگری را جست‌وجو کنید." : "تغییرات جدید پس از ذخیره در فضای ابری ثبت می‌شوند؛ اطلاعات قبل از فعال‌شدن این قابلیت به گذشته اضافه نمی‌شوند."}</p></div>}
    {status === "ready" && !!filtered.length && <><ol className="history-list">{filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((event) => <li className="history-entry" key={event.id}><div className="history-entry-heading"><b>{clean(event.summary, 250)}</b><span className="history-collection">{collections[event.collection] || clean(event.collection, 80)}</span></div><div className="history-meta"><span>{clean(event.actorName, 100) || "کاربر"}</span><time dateTime={event.createdAt}>{formatDate(event.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time></div><Diff event={event} /></li>)}</ol><div className="history-pagination"><span>صفحهٔ {number(currentPage + 1)} از {number(pageCount)}</span><div><button type="button" aria-label="صفحه قبلی سابقه" disabled={!currentPage} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronRight size={17} /></button><button type="button" aria-label="صفحه بعدی سابقه" disabled={currentPage + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronLeft size={17} /></button></div></div></>}
  </section>;
}
