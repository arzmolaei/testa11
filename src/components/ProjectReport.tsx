import { Download, FileText, Printer, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "../dates";
import { buildProjectReport, defaultReportPeriod, importedReportPeriod, reportCsv, reportFileName, reportHtml } from "../reports";
import type { Project } from "../types";
import { JalaliDateInput } from "./JalaliDateInput";
import "./ProjectReport.css";

export type ProjectReportProps = { project: Project; readOnly?: boolean; notify: (message: string) => void };
const number = (value: number | undefined) => value === undefined ? "—" : value.toLocaleString("fa-IR", { maximumFractionDigits: 2 });

function download(contents: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: `${mime};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function ProjectReport({ project, notify }: ProjectReportProps) {
  const [period, setPeriod] = useState(defaultReportPeriod);
  const [periodSelection, setPeriodSelection] = useState(0);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [preparedBy, setPreparedBy] = useState("علیرضا ملائی");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { setPeriod(defaultReportPeriod()); setIncludeNotes(false); }, [project.id]);
  const result = useMemo(() => {
    try { return { report: buildProjectReport(project, { ...period, includePrivateNotes: includeNotes, preparedBy }), error: "" }; }
    catch (error) { return { report: undefined, error: error instanceof Error ? error.message : "بازه گزارش معتبر نیست." }; }
  }, [project, period, includeNotes, preparedBy]);
  const report = result.report;
  const importedPeriod = importedReportPeriod(project);
  const canExport = () => Boolean(form.current?.reportValidity() && report);
  const print = () => {
    if (!canExport() || !report) return;
    const popup = window.open("", "_blank", "width=1000,height=780");
    if (!popup) { notify("پنجرهٔ چاپ باز نشد؛ اجازهٔ پنجره جدید بدهید یا فایل HTML را دانلود کنید."); return; }
    popup.opener = null;
    popup.document.open(); popup.document.write(reportHtml(report)); popup.document.close();
    popup.focus();
    // The document contains only text and inline CSS, so no network wait is needed.
    window.setTimeout(() => { if (!popup.closed) popup.print(); }, 250);
  };
  return <section className="project-report-workspace">
    <div className="project-report-intro"><span className="project-report-icon"><FileText size={22} /></span><div><h2>گزارش قابل ارائه</h2><p>بازه را انتخاب کن؛ فعالیت‌های دارای تاریخ و دادهٔ واقعی گزارش می‌شوند.</p></div></div>
    <form className="project-report-controls" ref={form} onSubmit={(event) => event.preventDefault()}>
      <label className="field"><span>از تاریخ</span><JalaliDateInput key={`${project.id}-start-${periodSelection}`} value={period.start} required aria-label="شروع بازه گزارش" onChange={(start) => setPeriod((previous) => ({ ...previous, start }))} /></label>
      <label className="field"><span>تا تاریخ</span><JalaliDateInput key={`${project.id}-end-${periodSelection}`} value={period.end} required aria-label="پایان بازه گزارش" onChange={(end) => setPeriod((previous) => ({ ...previous, end }))} /></label>
      <label className="field"><span>تهیه‌کنندهٔ گزارش</span><input value={preparedBy} maxLength={100} onChange={(event) => setPreparedBy(event.target.value)} placeholder="نام شما یا تیم" /></label>
      {importedPeriod && <div className="project-report-period-shortcut"><button type="button" className="btn btn-secondary" onClick={() => { setPeriod(importedPeriod); setPeriodSelection((previous) => previous + 1); }}>استفاده از دورهٔ واردشده</button><span>{formatDate(importedPeriod.start)} تا {formatDate(importedPeriod.end)}</span></div>}
      <div className="project-report-export"><button type="button" className="btn btn-primary" disabled={!report} onClick={() => { if (canExport() && report) { download(reportHtml(report), reportFileName(report, "html"), "text/html"); notify("فایل مستقل گزارش برای دانلود آماده شد."); } }}><Download size={15} />دانلود گزارش</button><button type="button" className="btn btn-secondary" disabled={!report} onClick={print}><Printer size={15} />چاپ / ذخیره PDF</button><button type="button" className="btn btn-ghost" disabled={!report} onClick={() => { if (canExport() && report) download(reportCsv(report), reportFileName(report, "csv"), "text/csv"); }}>دادهٔ CSV</button></div>
      <label className="project-report-private"><input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} /><span>یادداشت‌های خصوصی فعالیت‌های این بازه هم در خروجی بیاید</span></label>
      <p className="project-report-help"><ShieldCheck size={14} />فایل گزارش مستقل است. برای PDF، در پنجرهٔ چاپ مرورگر «ذخیره به‌صورت PDF» را انتخاب کن.</p>
    </form>
    {result.error && <p role="alert" className="project-report-error">{result.error}</p>}
    {report && <article className="project-report-paper" aria-label="پیش‌نمایش گزارش">
      <header className="project-report-heading"><div><span>گزارش پیشرفت سئو</span><h1>{report.projectName}</h1><p className="project-report-domain" dir="ltr">{report.domain}</p><p>{formatDate(report.period.start)} تا {formatDate(report.period.end)}</p></div><div><strong>{report.preparedBy}</strong><p>تهیه گزارش: {formatDate(report.generatedAt)}</p></div></header>
      {report.goal && <p className="project-report-goal">{report.goal}</p>}
      <h3>دادهٔ عملکرد در بازه</h3>
      {report.searchConsole ? <>
        <div className="project-report-kpis">{[["کلیک ردیف‌های واردشده", report.searchConsole.clicks], ["نمایش ردیف‌های واردشده", report.searchConsole.impressions], ["نرخ کلیک (%)", report.searchConsole.ctr]].map(([label, value]) => <div key={String(label)}><strong>{number(value as number)}</strong><span>{label}</span></div>)}</div>
        <p className="project-report-muted">فایل «{report.searchConsole.label}»؛ {formatDate(report.searchConsole.periodStart)} تا {formatDate(report.searchConsole.periodEnd)}، {number(report.searchConsole.rowCount)} ردیف. جمع یک فایل؛ پوشش کامل سایت و بازهٔ انتخابی را تضمین نمی‌کند.{report.searchConsole.sourceFilters && ` فیلتر: ${report.searchConsole.sourceFilters}`}</p>
      </> : <p className="project-report-empty">فایل Search Console با دورهٔ کاملاً داخل بازه در دسترس نیست.</p>}
      <h3>کارها و انتشارهای ثبت‌شده در بازه</h3>
      {report.events.length ? <div className="project-report-table-scroll"><table><thead><tr><th>فعالیت</th><th>عنوان</th><th>تاریخ</th></tr></thead><tbody>{report.events.slice(0, 100).map((event) => <tr key={event.id}><td>{event.kind === "task" ? "کار انجام‌شده" : event.kind === "content" ? "انتشار محتوا" : "انتشار / به‌روزرسانی صفحه"}</td><td>{event.title}</td><td>{formatDate(event.date)}</td></tr>)}</tbody></table></div> : <p className="project-report-empty">کار انجام‌شده یا انتشار دارای تاریخ معتبر در این بازه ثبت نشده است.</p>}
      {report.events.length > 100 && <p className="project-report-muted">پیش‌نمایش: ۱۰۰ فعالیت اول؛ تمام {number(report.events.length)} فعالیت در خروجی قرار دارد.</p>}
      <h3>آخرین سنجش‌های دستی در بازه</h3><p className="project-report-muted">آخرین سنجش هر صفحه نمایش داده می‌شود؛ این اعداد جمع عملکرد دوره نیستند.</p>
      {report.metrics.length ? <div className="project-report-table-scroll"><table><thead><tr><th>صفحه</th><th>تاریخ بررسی</th><th>کلیک</th><th>نمایش</th><th>CTR (%)</th><th>جایگاه</th><th>تبدیل</th></tr></thead><tbody>{report.metrics.slice(0, 100).map((metric) => <tr key={metric.id}><td>{metric.title}</td><td>{formatDate(metric.date)}</td><td>{number(metric.clicks)}</td><td>{number(metric.impressions)}</td><td>{number(metric.ctr)}</td><td>{number(metric.position)}</td><td>{number(metric.conversions)}</td></tr>)}</tbody></table></div> : <p className="project-report-empty">سنجش دستی دارای تاریخ بررسی در این بازه ثبت نشده است.</p>}
      {report.metrics.length > 100 && <p className="project-report-muted">پیش‌نمایش: ۱۰۰ سنجش اول؛ تمام {number(report.metrics.length)} سنجش در خروجی قرار دارد.</p>}
      <h3>اقدامات بعدی براساس وضعیت کنونی</h3>
      {report.nextSteps.length ? report.nextSteps.map((action, index) => <div className="project-report-action" key={`${action.title}-${index}`}><strong><span>{action.priority}</span>{action.title}</strong><p>{action.reason}</p></div>) : <p className="project-report-empty">اقدام بعدی در اطلاعات فعلی ثبت نشده است.</p>}
      {report.privateNotes.length > 0 && <><h3>یادداشت‌های خصوصی؛ با انتخاب شما</h3>{report.privateNotes.map((note, index) => <div className="project-report-note" key={`${note.title}-${index}`}><strong>{note.title}</strong><p>{note.text}</p></div>)}</>}
      <footer><p>موجودی کنونی: {number(report.current.keywords)} کلمه، {number(report.current.pages)} صفحه و {number(report.current.content)} محتوا.</p><p>وارد شمارش بازه نشده‌اند: {number(report.exclusions.undatedEvents)} فعالیت بدون تاریخ معتبر؛ {number(report.exclusions.undatedMetrics)} سنجش بدون تاریخ بررسی؛ {number(report.exclusions.searchConsoleOutsidePeriod)} فایل Search Console خارج یا عبوری از بازه.</p><p>گزارش از داده‌های ثبت‌شده تهیه می‌شود؛ علت تغییر رتبه یا اثر قطعی یک اقدام از این اطلاعات به‌تنهایی مشخص نمی‌شود.</p></footer>
    </article>}
  </section>;
}

export default ProjectReport;
