import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, BarChart3, ChevronLeft, ChevronRight, FileSpreadsheet, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { parseCsv } from "../domain";
import { formatDate, formatJalaliInput, jalaliFileDate } from "../dates";
import type { Project, Row } from "../types";
import {
  buildSearchConsoleInsights, createSearchConsoleDataset, detectSearchConsoleMapping,
  prepareSearchConsoleImport, SEARCH_CONSOLE_BYTES_LIMIT, SEARCH_CONSOLE_COLUMN_LIMIT, SEARCH_CONSOLE_FIELDS, SEARCH_CONSOLE_ROW_LIMIT,
  searchConsoleComparisonReason, searchConsoleDatasetCsv, searchConsoleInsightSource, searchConsolePeriodDays, validateSearchConsoleData,
} from "../search-console";
import type { SearchConsoleData, SearchConsoleDataset, SearchConsoleMapping, SearchConsoleInsight } from "../search-console";
import { JalaliDateInput } from "./JalaliDateInput";
import "./SearchConsoleWorkspace.css";

type Props = { project: Project; onProjectChange: (project: Project) => boolean | void; notify: (message: string) => void; readOnly?: boolean };
type Period = "current" | "previous";
type ImportState = { sheets: { name: string; matrix: string[][] }[]; sheet: number; mapping: SearchConsoleMapping; label: string; period: Period; periodStart: string; periodEnd: string; sourceFilters: string };
type ExtendedProject = Project & { searchConsole?: SearchConsoleData; tasks?: Row[] };
const fa = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
const percentage = (value: number) => `${fa.format(value * 100)}٪`;
const dimensionLabel = { query: "عبارت", page: "صفحه", "query-page": "عبارت + صفحه" };
const kindLabel = { "low-ctr": "نرخ کلیک", "near-first-page": "فرصت جایگاه", decline: "افت کلیک", "query-page-overlap": "همپوشانی احتمالی" };

function exportDataset(dataset: SearchConsoleDataset) {
  const url = URL.createObjectURL(new Blob([searchConsoleDatasetCsv(dataset)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `Roshdimo-Search-Console-${jalaliFileDate()}.csv`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SearchConsoleWorkspace({ project, onProjectChange, notify, readOnly = false }: Props) {
  const extended = project as ExtendedProject;
  const data = extended.searchConsole || {};
  const [period, setPeriod] = useState<Period>("current");
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [section, setSection] = useState<"insights" | "rows">("insights");
  const [kind, setKind] = useState("all");
  const fileInput = useRef<HTMLInputElement>(null);
  const importSection = useRef<HTMLElement>(null);
  const request = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  useEffect(() => { setPage(0); }, [search, period, section, kind, project.id]);
  const dataset = data[period];
  useEffect(() => { setPage(0); }, [dataset?.id]);
  const insights = useMemo(() => buildSearchConsoleInsights(extended), [project]);
  const preview = useMemo(() => importState ? prepareSearchConsoleImport(importState.sheets[importState.sheet].matrix, importState.mapping) : null, [importState]);
  const rows = useMemo(() => (dataset?.rows || []).filter((row) => `${row.query || ""} ${row.page || ""} ${row.device || ""} ${row.country || ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => b.impressions - a.impressions), [dataset, search]);
  const visibleInsights = insights.filter((insight) => (kind === "all" || insight.kind === kind) && `${insight.title} ${insight.query || ""} ${insight.url || ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const totals = useMemo(() => ({ clicks: dataset?.rows.reduce((sum, row) => sum + row.clicks, 0) || 0, impressions: dataset?.rows.reduce((sum, row) => sum + row.impressions, 0) || 0 }), [dataset]);
  const comparisonReason = searchConsoleComparisonReason(data.current, data.previous);
  const closeImport = () => { request.current++; setImportState(null); setLoading(false); setError(""); };

  const readFile = async (file?: File) => {
    if (!file || readOnly) return;
    const token = ++request.current;
    setLoading(true); setError("");
    try {
      if (file.size > SEARCH_CONSOLE_BYTES_LIMIT) throw new Error("فایل حداکثر ۵ مگابایت باشد.");
      let sheets: ImportState["sheets"];
      if (/\.xlsx$/i.test(file.name)) {
        const { default: ExcelJS } = await import("exceljs");
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await file.arrayBuffer());
        sheets = workbook.worksheets.slice(0, 20).map((sheet) => {
          if (sheet.rowCount > SEARCH_CONSOLE_ROW_LIMIT + 1 || sheet.columnCount > SEARCH_CONSOLE_COLUMN_LIMIT) return { name: `${sheet.name} (بیش از ظرفیت)`, matrix: [] };
          const matrix: string[][] = [];
          for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex++) {
            const cells: string[] = [];
            for (let column = 1; column <= sheet.columnCount; column++) {
              const cell = sheet.getRow(rowIndex).getCell(column), value = cell.value;
              if (value && typeof value === "object" && "formula" in value) cells.push(String(value.result ?? ""));
              else if (typeof value === "number") cells.push(String(value));
              else cells.push(cell.text || "");
            }
            matrix.push(cells);
          }
          return { name: sheet.name, matrix };
        });
      } else if (/\.(csv|tsv|txt)$/i.test(file.name)) sheets = [{ name: file.name, matrix: parseCsv(await file.text()) }];
      else throw new Error("فایل CSV، TSV یا XLSX انتخاب کنید.");
      if (!sheets.length) throw new Error("فایل کاربرگ ندارد.");
      if (sheets.some((sheet) => (sheet.matrix[0]?.length || 0) > SEARCH_CONSOLE_COLUMN_LIMIT)) throw new Error("فایل حداکثر ۶۴ ستون داشته باشد؛ فقط ستون‌های گزارش عملکرد را نگه دارید.");
      const selected = sheets.findIndex((sheet) => {
        const mapping = detectSearchConsoleMapping(sheet.matrix[0] || []);
        return sheet.matrix.length > 1 && mapping.clicks !== undefined && mapping.impressions !== undefined && (mapping.query !== undefined || mapping.page !== undefined);
      });
      const sheet = selected >= 0 ? selected : 0;
      if (mounted.current && token === request.current) setImportState({ sheets, sheet, mapping: detectSearchConsoleMapping(sheets[sheet].matrix[0] || []), label: file.name, period, periodStart: "", periodEnd: "", sourceFilters: "" });
    } catch (failure) { if (mounted.current && token === request.current) setError(failure instanceof Error ? failure.message : "خواندن فایل ممکن نشد."); }
    finally { if (mounted.current && token === request.current) setLoading(false); if (fileInput.current) fileInput.current.value = ""; }
  };
  const confirmImport = () => {
    if (readOnly || !importState || !preview) return;
    const invalidInput = [...(importSection.current?.querySelectorAll<HTMLInputElement>("input") || [])].find((input) => !input.checkValidity());
    if (invalidInput) { invalidInput.reportValidity(); return; }
    try {
      const next = createSearchConsoleDataset(preview, { periodStart: importState.periodStart, periodEnd: importState.periodEnd, label: importState.label.trim() || "خروجی Search Console", sourceFilters: importState.sourceFilters.trim() });
      const updated = { ...data, [importState.period]: next };
      validateSearchConsoleData(updated);
      if (data[importState.period] && !window.confirm("دادهٔ این دوره جایگزین شود؟ دورهٔ دیگر و اطلاعات پروژه حفظ می‌شوند.")) return;
      if (onProjectChange({ ...project, searchConsole: updated } as ExtendedProject) === false) {
        setError("ثبت دوره انجام نشد. پیش‌نمایش حفظ شده است؛ مشکل ذخیره یا دسترسی را برطرف کنید و دوباره تلاش کنید.");
        return;
      }
      setPeriod(importState.period); closeImport();
      notify(`${fa.format(next.rows.length)} ردیف در دورهٔ ${importState.period === "current" ? "فعلی" : "قبلی"} ثبت شد.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "ثبت داده ممکن نشد."); }
  };
  const removeDataset = () => {
    if (readOnly || !dataset || !window.confirm("داده‌های Search Console این دوره حذف شوند؟ سایر اطلاعات پروژه حفظ می‌شوند.")) return;
    const updated = { ...data }; delete updated[period];
    if (onProjectChange({ ...project, searchConsole: updated } as ExtendedProject) === false) return;
    notify("دادهٔ این دوره حذف شد.");
  };
  const makeTask = (insight: SearchConsoleInsight) => {
    if (readOnly) return;
    const tasks = extended.tasks || [], source = searchConsoleInsightSource(insight);
    if (tasks.some((task) => task.source === source)) { notify("این پیشنهاد قبلاً به فهرست کارها اضافه شده است."); return; }
    if (tasks.length >= 2000) { notify("فهرست کارها به ظرفیت ۲۰۰۰ مورد رسیده است."); return; }
    const task: Row = { id: crypto.randomUUID(), title: insight.title, source, status: "open", priority: insight.priority, pageId: insight.pageId, query: insight.query, url: insight.url, createdAt: new Date().toISOString(), notes: `${insight.reason}\n${insight.query || insight.url || ""}\n${formatJalaliInput(insight.evidence.periodStart)} تا ${formatJalaliInput(insight.evidence.periodEnd)}؛ کلیک: ${fa.format(insight.evidence.clicks)}؛ نمایش: ${fa.format(insight.evidence.impressions)}؛ نرخ کلیک: ${percentage(insight.evidence.ctr)}` };
    if (onProjectChange({ ...project, tasks: [...tasks, task] } as ExtendedProject) === false) return;
    notify("پیشنهاد به فهرست کارها اضافه شد.");
  };
  const importDateValid = importState && searchConsolePeriodDays(importState) > 0;

  return <div className="gsc-workspace" data-dirty={importState ? "true" : undefined}>
    <div className="workspace-heading"><div><span className="eyebrow">تحلیل محلی داده</span><h1>فرصت‌های Search Console</h1><p>خروجی واقعی را وارد کنید؛ فرصت‌ها را با دلیل بررسی و به کار اجرایی تبدیل کنید.</p></div>
      <button className="btn btn-primary" disabled={readOnly || loading} onClick={() => fileInput.current?.click()}><Upload size={16}/>{loading ? "در حال خواندن…" : "ورود خروجی"}</button>
      <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,.xlsx" hidden onChange={(event) => void readFile(event.target.files?.[0])}/>
    </div>
    {error && <div role="alert" className="gsc-error">{error}</div>}
    {importState && <section ref={importSection} className="gsc-import" aria-label="پیش‌نمایش ورود داده">
      <div className="gsc-card-heading"><h2><FileSpreadsheet size={19}/>پیش‌نمایش ورود داده</h2><button className="btn btn-ghost" onClick={closeImport} aria-label="بستن ورود داده"><X size={18}/></button></div>
      <p className="gsc-help">هر کاربرگ را جدا بررسی کنید. خروجی «عبارت‌ها» و «صفحات» به هم متصل نمی‌شوند؛ فقط فایلی که هر دو ستون را در یک ردیف دارد، ارتباط واقعی عبارت با صفحه را نشان می‌دهد.</p>
      <div className="gsc-import-fields">
        <label>دوره<select value={importState.period} onChange={(event) => setImportState({ ...importState, period: event.target.value as Period })}><option value="current">دورهٔ فعلی</option><option value="previous">دورهٔ قبلی</option></select></label>
        <label>نام مجموعه<input value={importState.label} maxLength={150} onChange={(event) => setImportState({ ...importState, label: event.target.value })}/></label>
        <label>شروع دوره<JalaliDateInput value={importState.periodStart} required aria-label="شروع دوره Search Console" onChange={(value) => setImportState({ ...importState, periodStart: value })}/></label>
        <label>پایان دوره<JalaliDateInput value={importState.periodEnd} required aria-label="پایان دوره Search Console" onChange={(value) => setImportState({ ...importState, periodEnd: value })}/></label>
        <label className="gsc-filter-field">فیلترهای خروجی<input value={importState.sourceFilters} maxLength={300} placeholder="مثلاً جست‌وجوی وب، ایران، موبایل؛ خالی = بدون فیلتر" onChange={(event) => setImportState({ ...importState, sourceFilters: event.target.value })}/></label>
        {importState.sheets.length > 1 && <label>کاربرگ<select value={importState.sheet} onChange={(event) => { const sheet = Number(event.target.value); setError(""); setImportState({ ...importState, sheet, mapping: detectSearchConsoleMapping(importState.sheets[sheet].matrix[0] || []) }); }}>{importState.sheets.map((sheet, index) => <option value={index} key={index}>{sheet.name}</option>)}</select></label>}
      </div>
      <div className="gsc-mapping">{SEARCH_CONSOLE_FIELDS.map(({ key, label }) => <label key={key}>{label}<select aria-label={`ستون ${label}`} value={importState.mapping[key] ?? ""} onChange={(event) => setImportState({ ...importState, mapping: { ...importState.mapping, [key]: event.target.value === "" ? "" : Number(event.target.value) } })}><option value="">انتخاب نشده</option>{(importState.sheets[importState.sheet].matrix[0] || []).map((header, index) => <option value={index} key={index}>{header || `ستون ${fa.format(index + 1)}`}</option>)}</select></label>)}</div>
      {preview && <div className="gsc-preview-summary"><strong>{fa.format(preview.sourceRows)} ردیف ورودی · {fa.format(preview.rows.length)} ردیف پس از تجمیع</strong><span>{preview.dimension ? dimensionLabel[preview.dimension] : "ستون‌ها را مشخص کنید"} · نرخ کلیک از مجموع کلیک ÷ مجموع نمایش محاسبه می‌شود.</span></div>}
      {preview?.errorCount ? <div role="alert" className="gsc-error"><strong>{fa.format(preview.errorCount)} خطا؛ هیچ داده‌ای ثبت نشده است.</strong>{preview.errors.map((failure, index) => <p key={index}>ردیف {fa.format(failure.row)}: {failure.message}</p>)}</div> : preview?.rows.length ? <div className="gsc-table-scroll"><table><thead><tr><th>عبارت / صفحه</th><th>کلیک</th><th>نمایش</th><th>نرخ کلیک</th></tr></thead><tbody>{preview.rows.slice(0, 5).map((row) => <tr key={row.id}><td><span>{row.query || row.page}</span>{row.query && row.page && <small dir="ltr">{row.page}</small>}</td><td>{fa.format(row.clicks)}</td><td>{fa.format(row.impressions)}</td><td>{percentage(row.impressions ? row.clicks / row.impressions : 0)}</td></tr>)}</tbody></table></div> : null}
      {!importDateValid && <p className="gsc-help">شروع و پایان دوره را دقیقاً مطابق خروجی مشخص کنید؛ تاریخ از نام فایل حدس زده نمی‌شود.</p>}
      <div className="gsc-import-actions"><button className="btn btn-primary" disabled={readOnly || !preview?.rows.length || Boolean(preview?.errorCount) || !importDateValid} onClick={confirmImport}>تأیید و ثبت دوره</button><button className="btn btn-secondary" onClick={closeImport}>انصراف</button><span>هر دوره تا ۲۰٬۰۰۰ ردیف · مجموع دو دوره تا ۵ مگابایت</span></div>
    </section>}
    <div className="gsc-periods" role="group" aria-label="انتخاب دوره">{(["current", "previous"] as const).map((value) => <button key={value} className={period === value ? "active" : ""} onClick={() => { setPeriod(value); setSection(value === "previous" ? "rows" : "insights"); }}><span>{value === "current" ? "دورهٔ فعلی" : "دورهٔ قبلی"}</span><small>{data[value] ? `${formatJalaliInput(data[value]!.periodStart)} تا ${formatJalaliInput(data[value]!.periodEnd)}` : "هنوز وارد نشده"}</small></button>)}</div>
    {!dataset ? <div className="gsc-empty"><BarChart3 size={32}/><h2>از داده‌های واقعی، کار بعدی را پیدا کنید</h2><p>در Search Console خروجی CSV یا Excel بگیرید و اینجا وارد کنید. فایل داخل همین برنامه پردازش می‌شود؛ اتصال یا ارسال اطلاعات به گوگل لازم نیست.</p><button className="btn btn-secondary" disabled={readOnly || loading} onClick={() => fileInput.current?.click()}><Upload size={16}/>ورود دادهٔ این دوره</button><details><summary>راهنمای خروجی مناسب</summary><p>از گزارش عملکرد، بازهٔ تاریخ و فیلترها را انتخاب کنید و خروجی بگیرید. کاربرگ عبارت‌ها یا صفحات را وارد کنید. برای بررسی همپوشانی، خروجی واقعی با دو ستون عبارت و صفحه لازم است؛ کاربرگ‌های جدا چنین ارتباطی ندارند.</p></details></div> : <>
      <div className="gsc-metrics"><div><span>کلیک ردیف‌های واردشده</span><strong>{fa.format(totals.clicks)}</strong></div><div><span>نمایش ردیف‌های واردشده</span><strong>{fa.format(totals.impressions)}</strong></div><div><span>نرخ کلیک تجمیعی</span><strong>{percentage(totals.impressions ? totals.clicks / totals.impressions : 0)}</strong></div><div><span>نوع داده</span><strong>{dimensionLabel[dataset.dimension]}</strong></div></div>
      <div className="gsc-dataset-note"><span>{dataset.label} · ثبت: {formatDate(dataset.importedAt)} · {fa.format(dataset.rows.length)} ردیف{dataset.sourceFilters ? ` · فیلتر: ${dataset.sourceFilters}` : ""}</span><div><button className="btn btn-ghost" onClick={() => exportDataset(dataset)}><ArrowDownToLine size={14}/>خروجی CSV</button><button className="btn btn-ghost" disabled={readOnly} onClick={removeDataset} aria-label="حذف دادهٔ این دوره"><Trash2 size={15}/></button></div></div>
      <p className="gsc-help">این اعداد مربوط به ردیف‌های فایل هستند و لزوماً کل عملکرد سایت را پوشش نمی‌دهند. پیشنهادها برای بررسی‌اند؛ برنامه افزایش رتبه یا علت قطعی افت را پیش‌بینی نمی‌کند.</p>
      <div className="gsc-toolbar"><div className="gsc-sections">{period === "current" && <button className={section === "insights" ? "active" : ""} onClick={() => setSection("insights")}>فرصت‌ها <span>{fa.format(insights.length)}</span></button>}<button className={section === "rows" ? "active" : ""} onClick={() => setSection("rows")}>دادهٔ واردشده</button></div><label className="gsc-search"><Search size={16}/><input aria-label="جست‌وجوی داده‌های Search Console" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی عبارت یا صفحه…"/></label></div>
      {section === "insights" && period === "current" ? <>
        <div className="gsc-opportunity-tools"><select aria-label="نوع فرصت" value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">همهٔ فرصت‌ها</option>{Object.entries(kindLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><span>{comparisonReason || "مقایسهٔ دو دورهٔ هم‌اندازه و بدون همپوشانی فعال است."}</span></div>
        {!visibleInsights.length ? <div className="gsc-empty compact"><strong>با این داده و فیلتر، پیشنهاد قابل اتکایی پیدا نشد.</strong><p>نبود پیشنهاد، به معنی نبود مشکل سئو نیست. برای تحلیل افت، دورهٔ قبلی هم‌اندازه را وارد کنید.</p></div> : <div className="gsc-insights">{visibleInsights.map((insight) => {
          const exists = (extended.tasks || []).some((task) => task.source === searchConsoleInsightSource(insight));
          return <article className="gsc-insight" key={insight.id}><div className="gsc-insight-heading"><span className={`gsc-priority ${insight.priority.toLowerCase()}`}>{insight.priority}</span><span>{kindLabel[insight.kind]}</span></div><h3>{insight.title}</h3><div className="gsc-insight-target">{insight.query && <strong>{insight.query}</strong>}{insight.url && <span dir="ltr">{insight.url}</span>}</div><p>{insight.reason}</p><div className="gsc-evidence"><span>کلیک: {fa.format(insight.evidence.clicks)}</span><span>نمایش: {fa.format(insight.evidence.impressions)}</span><span>نرخ کلیک: {percentage(insight.evidence.ctr)}</span>{insight.evidence.position !== undefined && <span>جایگاه: {fa.format(insight.evidence.position)}</span>}{insight.evidence.previousClicks !== undefined && <span>کلیک دورهٔ قبل: {fa.format(insight.evidence.previousClicks)}</span>}{insight.evidence.device && <span>دستگاه: {insight.evidence.device}</span>}{insight.evidence.country && <span>کشور: {insight.evidence.country}</span>}</div>{insight.evidence.urls && <details><summary>صفحه‌های دارای نمایش برای همین عبارت</summary>{insight.evidence.urls.map((url) => <p key={url} dir="ltr">{url}</p>)}</details>}<button className="btn btn-secondary" disabled={readOnly || exists} onClick={() => makeTask(insight)}><Plus size={14}/>{exists ? "در فهرست کارها ثبت شده" : "اضافه به کارها"}</button></article>;
        })}</div>}
      </> : <><div className="gsc-table-scroll"><table><thead><tr><th>عبارت / صفحه</th><th>کلیک</th><th>نمایش</th><th>نرخ کلیک</th><th>جایگاه</th><th>دستگاه / کشور</th></tr></thead><tbody>{rows.slice(page * 50, (page + 1) * 50).map((row) => <tr key={row.id}><td><span>{row.query || row.page}</span>{row.query && row.page && <small dir="ltr">{row.page}</small>}</td><td>{fa.format(row.clicks)}</td><td>{fa.format(row.impressions)}</td><td>{percentage(row.impressions ? row.clicks / row.impressions : 0)}</td><td>{row.position === undefined ? "—" : fa.format(row.position)}</td><td>{[row.device, row.country].filter(Boolean).join(" / ") || "—"}</td></tr>)}</tbody></table></div>{!rows.length && <p className="gsc-help">ردیفی با این جست‌وجو پیدا نشد.</p>}<div className="gsc-pagination"><span>{fa.format(rows.length)} ردیف · صفحهٔ {fa.format(page + 1)} از {fa.format(Math.max(1, Math.ceil(rows.length / 50)))}</span><button className="btn btn-ghost" disabled={page <= 0} onClick={() => setPage(page - 1)} aria-label="صفحهٔ قبلی"><ChevronRight size={17}/></button><button className="btn btn-ghost" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)} aria-label="صفحهٔ بعدی"><ChevronLeft size={17}/></button></div></>}
    </>}
  </div>;
}

export default SearchConsoleWorkspace;
