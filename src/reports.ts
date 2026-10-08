import { formatDate, formatJalaliInput, getJalaliParts, isIsoDate, jalaliToIso, todayIso, toIsoDate } from "./dates";
import { getProjectActions } from "./workflow";
import type { ProjectAction } from "./workflow";
import type { Project, Row } from "./types";
import type { SearchConsoleDataset } from "./search-console";

export type ReportPeriod = { start: string; end: string };
export type ReportOptions = ReportPeriod & { includePrivateNotes?: boolean; preparedBy?: string; now?: Date };
export type ReportEvent = { id: string; title: string; date: string; kind: "task" | "content" | "page"; url?: string };
export type ReportMetric = { id: string; title: string; url: string; date: string; clicks?: number; impressions?: number; ctr?: number; position?: number; conversions?: number };
export type ProjectReportData = {
  projectName: string; domain: string; goal: string; preparedBy: string; period: ReportPeriod;
  generatedAt: string; current: { keywords: number; pages: number; content: number };
  events: ReportEvent[]; metrics: ReportMetric[]; nextSteps: { title: string; reason: string; priority: string }[];
  searchConsole?: { label: string; dimension: SearchConsoleDataset["dimension"]; periodStart: string; periodEnd: string; clicks: number; impressions: number; ctr: number; rowCount: number; sourceFilters?: string };
  exclusions: { undatedEvents: number; undatedMetrics: number; searchConsoleOutsidePeriod: number };
  privateNotes: { title: string; text: string }[];
};

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "" || (typeof value === "string" && !value.trim())) return;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};
const displayNumber = (value: number | undefined) => value === undefined ? "—" : value.toLocaleString("fa-IR", { maximumFractionDigits: 2 });

/** Date-only fields and timestamps are interpreted consistently in Tehran. */
export function reportDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const iso = toIsoDate(raw);
  if (iso) return iso;
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(raw);
  if (!parts || !isIsoDate(parts[1]) || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59 || parts[5] !== "Z" && (Number(parts[6]) > 23 || Number(parts[7]) > 59)) return null;
  const timestamp = new Date(raw);
  return Number.isFinite(timestamp.getTime()) ? todayIso(timestamp) : null;
}

export function defaultReportPeriod(now = new Date()): ReportPeriod {
  const end = todayIso(now);
  const parts = getJalaliParts(end)!;
  return { start: jalaliToIso(parts.year, parts.month, 1)!, end };
}

export function validateReportPeriod(period: ReportPeriod): ReportPeriod {
  const start = toIsoDate(period.start), end = toIsoDate(period.end);
  if (!start || !end) throw new Error("شروع و پایان بازه را با تاریخ شمسی معتبر مشخص کنید.");
  if (start > end) throw new Error("تاریخ شروع نباید بعد از پایان بازه باشد.");
  return { start, end };
}

/** Match the actual imported file's dates instead of implying partial coverage. */
export function importedReportPeriod(project: Project): ReportPeriod | undefined {
  const current = project.searchConsole?.current;
  if (!current) return;
  try { return validateReportPeriod({ start: current.periodStart, end: current.periodEnd }); }
  catch { return; }
}

const inPeriod = (date: string, period: ReportPeriod) => date >= period.start && date <= period.end;
const rowName = (row: Row, fallback: string) => text(row.title || row.topic || row.target || row.pkw || row.pageId || row.contentId) || fallback;

/** A report never prorates an aggregate export or invents undated completion dates. */
export function buildProjectReport(project: Project, options: ReportOptions): ProjectReportData {
  const period = validateReportPeriod(options);
  const pages = new Map(project.pages.map((page) => [page.id, page]));
  const events: ReportEvent[] = [], metricsByPage = new Map<string, ReportMetric>();
  const metricTimes = new Map<string, number>();
  const privateNotes: ProjectReportData["privateNotes"] = [];
  const exclusions = { undatedEvents: 0, undatedMetrics: 0, searchConsoleOutsidePeriod: 0 };
  const addNotes = (row: Row, title: string) => {
    if (!options.includePrivateNotes) return;
    const fields = ["notes", "contentNotes", "executionNotes", "technicalNotes", "competitorNotes", "description"];
    const notes = [...new Set(fields.map((key) => text(row[key])).filter(Boolean))].join("\n\n");
    if (notes) privateNotes.push({ title, text: notes });
  };
  for (const task of project.tasks || []) {
    if (task.status !== "done") continue;
    const date = reportDate(task.completedAt);
    if (!date) { exclusions.undatedEvents++; continue; }
    if (!inPeriod(date, period)) continue;
    const title = rowName(task, "کار انجام‌شده");
    events.push({ id: `task:${task.id}`, title, date, kind: "task" });
    addNotes(task, title);
  }
  for (const content of project.content) {
    if (!["Published", "Complete"].includes(text(content.writingStatus))) continue;
    const date = reportDate(content.publishDate);
    if (!date) { exclusions.undatedEvents++; continue; }
    if (!inPeriod(date, period)) continue;
    const page = pages.get(text(content.targetPage));
    const title = rowName(content, "محتوای منتشرشده");
    events.push({ id: `content:${content.id}`, title, date, kind: "content", ...(text(page?.url) ? { url: text(page?.url) } : {}) });
    addNotes(content, title);
  }
  const contentPageIds = new Set(project.content.filter((content) => ["Published", "Complete"].includes(text(content.writingStatus)) && reportDate(content.publishDate) && inPeriod(reportDate(content.publishDate)!, period)).map((content) => text(content.targetPage)).filter(Boolean));
  for (const page of project.pages) {
    if (contentPageIds.has(page.id) || (!(["Published", "Monitoring", "Complete"].includes(text(page.status))) && !["Published", "Complete"].includes(text(page.executionStatus)))) continue;
    const date = reportDate(page.publishDate);
    if (!date) { exclusions.undatedEvents++; continue; }
    if (!inPeriod(date, period)) continue;
    const title = rowName(page, "صفحهٔ منتشرشده");
    events.push({ id: `page:${page.id}`, title, date, kind: "page", ...(text(page.url) ? { url: text(page.url) } : {}) });
    addNotes(page, title);
  }
  for (const result of project.results) {
    const values = { clicks: number(result.clicks), impressions: number(result.impressions), ctr: number(result.ctr), position: number(result.position), conversions: number(result.conversions) };
    if (Object.values(values).every((value) => value === undefined)) continue;
    const date = reportDate(result.lastChecked);
    if (!date) { exclusions.undatedMetrics++; continue; }
    if (!inPeriod(date, period)) continue;
    const page = pages.get(text(result.pageId));
    const title = page ? rowName(page, "صفحه") : rowName(result, "نتیجهٔ ثبت‌شده");
    const url = text(result.url || page?.url), key = text(result.pageId) || url || result.id;
    const previous = metricsByPage.get(key);
    // Keep timestamp precision for ordering; the rendered/filter date remains
    // Tehran's date. A random UUID must not select an older same-day snapshot.
    const checkedAt = text(result.lastChecked).includes("T") ? Date.parse(text(result.lastChecked)) : -Infinity;
    const previousTime = metricTimes.get(key) ?? -Infinity;
    if (!previous || previous.date < date || previous.date === date && (previousTime < checkedAt || previousTime === checkedAt && previous.id.localeCompare(result.id) < 0)) {
      metricsByPage.set(key, { id: result.id, title, url, date, ...values });
      metricTimes.set(key, checkedAt);
    }
  }
  const metrics = [...metricsByPage.values()].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  if (options.includePrivateNotes) for (const metric of metrics) {
    const row = project.results.find((result) => result.id === metric.id);
    if (row) addNotes(row, metric.title);
  }
  const candidates = [project.searchConsole?.current, project.searchConsole?.previous].filter((dataset): dataset is SearchConsoleDataset => Boolean(dataset));
  let searchConsole: ProjectReportData["searchConsole"];
  for (const dataset of candidates) {
    const valid = toIsoDate(dataset.periodStart) && toIsoDate(dataset.periodEnd) && dataset.periodStart <= dataset.periodEnd;
    if (!valid || !inPeriod(dataset.periodStart, period) || !inPeriod(dataset.periodEnd, period)) { exclusions.searchConsoleOutsidePeriod++; continue; }
    // Select one dataset only. Two files may describe the same traffic and must
    // never be added together, even when their dates or dimensions differ.
    if (searchConsole) continue;
    const clicks = dataset.rows.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = dataset.rows.reduce((sum, row) => sum + row.impressions, 0);
    searchConsole = { label: dataset.label, dimension: dataset.dimension, periodStart: dataset.periodStart, periodEnd: dataset.periodEnd, clicks, impressions, ctr: impressions ? clicks / impressions * 100 : 0, rowCount: dataset.rows.length, ...(dataset.sourceFilters ? { sourceFilters: dataset.sourceFilters } : {}) };
  }
  const taskSteps = (project.tasks || []).filter((task) => task.status === "open").map((task) => ({ title: rowName(task, "کار برنامه‌ریزی‌شده"), reason: "کار ثبت‌شده در برنامهٔ پروژه", priority: ["P0", "P1", "P2", "P3"].includes(text(task.priority)) ? text(task.priority) : "P2" }));
  const actions: ProjectAction[] = getProjectActions(project, todayIso(options.now));
  const nextSteps = [...taskSteps, ...actions.map(({ title, reason, priority }) => ({ title, reason, priority }))].sort((a, b) => a.priority.localeCompare(b.priority)).slice(0, 12);
  return {
    projectName: project.name, domain: project.domain, goal: project.goal,
    preparedBy: text(options.preparedBy) || "علیرضا ملائی", period,
    generatedAt: todayIso(options.now), current: { keywords: project.keywords.length, pages: project.pages.length, content: project.content.length },
    events: events.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)), metrics, nextSteps,
    ...(searchConsole ? { searchConsole } : {}), exclusions, privateNotes,
  };
}

export function escapeReportHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}
/** Guard formulas even after whitespace/control prefixes when opened in Excel. */
export function safeReportCsvCell(value: unknown): string {
  let raw = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(raw)) raw = `'${raw}`;
  return `"${raw.replaceAll('"', '""')}"`;
}

const kindLabel = (kind: ReportEvent["kind"]) => kind === "task" ? "کار انجام‌شده" : kind === "content" ? "انتشار محتوا" : "انتشار / به‌روزرسانی صفحه";
export function reportCsv(report: ProjectReportData): string {
  const rows: unknown[][] = [
    ["بخش", "عنوان", "تاریخ / بازه", "کلیک", "نمایش", "CTR (%)", "میانگین جایگاه", "تبدیل", "توضیح / نشانی"],
    ["پروژه", report.projectName, `${formatJalaliInput(report.period.start)} تا ${formatJalaliInput(report.period.end)}`, "", "", "", "", "", report.domain],
  ];
  if (report.searchConsole) rows.push(["ردیف‌های Search Console واردشده", report.searchConsole.label, `${formatJalaliInput(report.searchConsole.periodStart)} تا ${formatJalaliInput(report.searchConsole.periodEnd)}`, report.searchConsole.clicks, report.searchConsole.impressions, report.searchConsole.ctr, "", "", `فقط یک فایل؛ ${report.searchConsole.rowCount} ردیف. ${report.searchConsole.sourceFilters || ""}`]);
  for (const event of report.events) rows.push([kindLabel(event.kind), event.title, formatJalaliInput(event.date), "", "", "", "", "", event.url || ""]);
  for (const metric of report.metrics) rows.push(["آخرین سنجش ثبت‌شده؛ جمع دوره نیست", metric.title, formatJalaliInput(metric.date), metric.clicks ?? "", metric.impressions ?? "", metric.ctr ?? "", metric.position ?? "", metric.conversions ?? "", metric.url]);
  for (const action of report.nextSteps) rows.push(["قدم بعدی", action.title, "وضعیت کنونی", "", "", "", "", "", `${action.priority} · ${action.reason}`]);
  for (const note of report.privateNotes) rows.push(["یادداشت خصوصی با انتخاب شما", note.title, "", "", "", "", "", "", note.text]);
  return "\uFEFF" + rows.map((row) => row.map(safeReportCsvCell).join(",")).join("\r\n");
}

export const REPORT_DOCUMENT_CSS = `*{box-sizing:border-box}body{margin:0;color:#273933;background:#f7f9f8;font:14px/2 Tahoma,Arial,sans-serif;direction:rtl}.report{max-width:1050px;margin:30px auto;padding:36px;background:#fff;border:1px solid #e8eeeb;border-radius:18px}.report-heading{border-bottom:2px solid #087e73;padding-bottom:20px;display:flex;justify-content:space-between;gap:20px}h1{font-size:27px;line-height:1.7;margin:0 0 8px}h2{font-size:18px;margin:30px 0 12px}h3{font-size:14px;margin:0}p{margin:6px 0}.muted{color:#70827a;font-size:12px}.tag{color:#087e73;font-size:12px}.report-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}.report-kpi{padding:14px;border:1px solid #e8eeeb;border-radius:12px;background:#f7fbf9}.report-kpi strong{display:block;font-size:24px;color:#087e73}.report-kpi span{font-size:12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:right;padding:10px;border-bottom:1px solid #e8eeeb;vertical-align:top;overflow-wrap:anywhere}th{background:#edf7f1;color:#376357}.report-action{padding:12px 0;border-bottom:1px solid #e8eeeb}.report-action .tag{margin-left:8px}.report-notes{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:#fff7e8;border-radius:10px}code{direction:ltr;unicode-bidi:embed;font-size:11px;overflow-wrap:anywhere}.report-footer{margin-top:28px;padding-top:16px;border-top:1px solid #e8eeeb;font-size:11px;color:#70827a}.report-empty{border:1px dashed #d8e7df;border-radius:12px;padding:16px;color:#70827a}@page{size:A4;margin:14mm}@media print{body{background:#fff}.report{margin:0;padding:0;border:0;border-radius:0;max-width:none}thead{display:table-header-group}tr,.report-kpi,.report-action{break-inside:avoid}h2{break-after:avoid}}@media(max-width:650px){.report{padding:20px;margin:0;border:0;border-radius:0}.report-heading{display:block}.report-kpis{gap:7px}.report-kpi{padding:10px}.report-kpi strong{font-size:20px}th,td{padding:7px;font-size:11px}}`;

/** UTF-8, script-free, fully standalone. All untrusted project strings are escaped. */
export function reportHtml(report: ProjectReportData): string {
  const h = escapeReportHtml;
  const table = (headers: string[], rows: unknown[][]) => `<table><thead><tr>${headers.map((header) => `<th>${h(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${h(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const gsc = report.searchConsole;
  const coverage = gsc ? `دادهٔ فایل «${gsc.label}»، از ${formatDate(gsc.periodStart)} تا ${formatDate(gsc.periodEnd)}؛ ${displayNumber(gsc.rowCount)} ردیف واردشده.${gsc.sourceFilters ? ` فیلتر ثبت‌شده: ${gsc.sourceFilters}` : ""}` : "برای این بازه، فایل Search Console با دورهٔ کاملاً داخل بازه در دسترس نیست.";
  const gscSection = gsc ? `<div class="report-kpis">${[["کلیک ردیف‌های واردشده", gsc.clicks], ["نمایش ردیف‌های واردشده", gsc.impressions], ["نرخ کلیک (%)", gsc.ctr]].map(([label, value]) => `<div class="report-kpi"><strong>${h(displayNumber(value as number))}</strong><span>${h(label)}</span></div>`).join("")}</div>` : `<p class="report-empty">${h(coverage)}</p>`;
  const excludes = [`${displayNumber(report.exclusions.undatedEvents)} کار یا انتشار بدون تاریخ معتبر`, `${displayNumber(report.exclusions.undatedMetrics)} سنجش بدون تاریخ بررسی`, `${displayNumber(report.exclusions.searchConsoleOutsidePeriod)} فایل Search Console خارج یا عبوری از بازه`].join("؛ ");
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${h(`گزارش سئو · ${report.projectName}`)}</title><style>${REPORT_DOCUMENT_CSS}</style></head><body><main class="report"><header class="report-heading"><div><span class="tag">گزارش پیشرفت سئو</span><h1>${h(report.projectName)}</h1><p><code>${h(report.domain)}</code></p><p class="muted">${h(formatDate(report.period.start))} تا ${h(formatDate(report.period.end))}</p></div><div><strong>${h(report.preparedBy)}</strong><p class="muted">تهیه گزارش: ${h(formatDate(report.generatedAt))}</p></div></header>${report.goal ? `<p>${h(report.goal)}</p>` : ""}<h2>دادهٔ عملکرد در بازه</h2>${gscSection}${gsc ? `<p class="muted">${h(coverage)}</p><p class="muted">این اعداد جمع ردیف‌های یک فایل هستند؛ پوشش کامل سایت و دورهٔ انتخابی را تضمین نمی‌کنند.</p>` : ""}<h2>کارها و انتشارهای ثبت‌شده در بازه</h2>${report.events.length ? table(["فعالیت", "عنوان", "تاریخ", "نشانی"], report.events.map((event) => [kindLabel(event.kind), event.title, formatDate(event.date), event.url || "—"])) : '<p class="report-empty">کار انجام‌شده یا انتشار دارای تاریخ معتبر در این بازه ثبت نشده است.</p>'}<h2>آخرین سنجش‌های دستی در بازه</h2><p class="muted">آخرین سنجش هر صفحه در بازه نمایش داده می‌شود؛ این اعداد جمع عملکرد دوره نیستند.</p>${report.metrics.length ? table(["صفحه", "تاریخ بررسی", "کلیک", "نمایش", "CTR (%)", "جایگاه", "تبدیل"], report.metrics.map((metric) => [metric.title, formatDate(metric.date), displayNumber(metric.clicks), displayNumber(metric.impressions), displayNumber(metric.ctr), displayNumber(metric.position), displayNumber(metric.conversions)])) : '<p class="report-empty">سنجش دستی دارای تاریخ بررسی در این بازه ثبت نشده است.</p>'}<h2>اقدامات بعدی براساس وضعیت کنونی</h2>${report.nextSteps.length ? report.nextSteps.map((action) => `<div class="report-action"><h3><span class="tag">${h(action.priority)}</span>${h(action.title)}</h3><p class="muted">${h(action.reason)}</p></div>`).join("") : '<p class="report-empty">اقدام بعدی در اطلاعات فعلی ثبت نشده است.</p>'}${report.privateNotes.length ? `<h2>یادداشت‌های خصوصی؛ با انتخاب تهیه‌کننده</h2>${report.privateNotes.map((note) => `<h3>${h(note.title)}</h3><p class="report-notes">${h(note.text)}</p>`).join("")}` : ""}<footer class="report-footer"><p>موجودی کنونی پروژه: ${h(displayNumber(report.current.keywords))} کلمه، ${h(displayNumber(report.current.pages))} صفحه و ${h(displayNumber(report.current.content))} محتوا.</p><p>در شمارش بازه وارد نشده‌اند: ${h(excludes)}.</p><p>گزارش براساس داده‌ها و وضعیت‌های ثبت‌شده در پروژه تهیه شده است؛ علت تغییر رتبه یا اثر قطعی یک اقدام از این اطلاعات به‌تنهایی مشخص نمی‌شود.</p></footer></main></body></html>`;
}

export function reportFileName(report: ProjectReportData, extension: "html" | "csv"): string {
  const name = report.projectName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 80) || "SEO";
  return `گزارش-${name}-${formatJalaliInput(report.period.start, false).replaceAll("/", "-")}-${formatJalaliInput(report.period.end, false).replaceAll("/", "-")}.${extension}`;
}
