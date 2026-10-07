import { isIsoDate, latinDigits } from "./dates";
import type { Project, Row } from "./types";

export const SEARCH_CONSOLE_ROW_LIMIT = 20_000;
export const SEARCH_CONSOLE_BYTES_LIMIT = 5_000_000;
export type SearchConsoleRow = {
  id: string; query?: string; page?: string; clicks: number; impressions: number;
  position?: number; device?: string; country?: string;
};
export type SearchConsoleDataset = {
  id: string; periodStart: string; periodEnd: string; importedAt: string; label: string;
  dimension: "page" | "query" | "query-page"; rows: SearchConsoleRow[]; sourceRows: number;
  /** User-recorded export filters; compare only identically scoped datasets. */
  sourceFilters?: string;
};
export type SearchConsoleData = { current?: SearchConsoleDataset; previous?: SearchConsoleDataset };
export type SearchConsoleProject = Pick<Project, "pages"> & { searchConsole?: SearchConsoleData };
export const SEARCH_CONSOLE_FIELDS = [
  { key: "query", label: "عبارت جست‌وجو" }, { key: "page", label: "نشانی صفحه" },
  { key: "clicks", label: "کلیک" }, { key: "impressions", label: "نمایش" },
  { key: "ctr", label: "نرخ کلیک (اختیاری)" }, { key: "position", label: "میانگین جایگاه" },
  { key: "device", label: "دستگاه (اختیاری)" }, { key: "country", label: "کشور (اختیاری)" },
] as const;
export type SearchConsoleField = typeof SEARCH_CONSOLE_FIELDS[number]["key"];
export type SearchConsoleMapping = Partial<Record<SearchConsoleField, number | "">>;
export type SearchConsolePreview = {
  rows: SearchConsoleRow[]; dimension?: SearchConsoleDataset["dimension"];
  errors: { row: number; message: string }[]; errorCount: number; sourceRows: number; skipped: number;
};
export type SearchConsoleInsight = {
  id: string; kind: "low-ctr" | "near-first-page" | "decline" | "query-page-overlap";
  title: string; reason: string; priority: "P0" | "P1" | "P2";
  pageId?: string; query?: string; url?: string;
  evidence: {
    clicks: number; impressions: number; ctr: number; position?: number;
    previousClicks?: number; clickChange?: number; periodStart: string; periodEnd: string; urls?: string[];
    device?: string; country?: string;
  };
};

export function searchConsoleInsightSource(insight: SearchConsoleInsight): string {
  return `gsc:${insight.evidence.periodStart}:${insight.evidence.periodEnd}:${insight.id}`;
}

const normalizeText = (value: unknown) => String(value ?? "").trim().replace(/ي/g, "ی").replace(/ك/g, "ک");
const headerKey = (value: string) => normalizeText(value).toLocaleLowerCase().replace(/[\s_\-\u200c()%٪]/g, "");
const ALIASES: Record<SearchConsoleField, string[]> = {
  query: ["query", "queries", "topqueries", "keyword", "عبارت", "عبارتجستجو", "عبارتجست‌وجو", "کلمهکلیدی", "کلماتکلیدی", "پرسوجو"],
  page: ["page", "pages", "toppages", "url", "landingpage", "صفحه", "صفحات", "نشانیصفحه", "آدرسصفحه", "نشانی"],
  clicks: ["clicks", "click", "کلیک", "کلیکها", "تعدادکلیک"],
  impressions: ["impressions", "impression", "نمایش", "تعدادنمایش", "ایمپرشن"],
  ctr: ["ctr", "clickthroughrate", "نرخکلیک"],
  position: ["position", "averageposition", "avgposition", "جایگاه", "رتبه", "میانگینجایگاه"],
  device: ["device", "devices", "دستگاه"], country: ["country", "countries", "کشور"],
};
export function detectSearchConsoleMapping(headers: string[]): SearchConsoleMapping {
  const mapping: SearchConsoleMapping = {};
  for (const { key } of SEARCH_CONSOLE_FIELDS) {
    const index = headers.findIndex((header) => ALIASES[key].map(headerKey).includes(headerKey(header)));
    if (index >= 0) mapping[key] = index;
  }
  return mapping;
}

/** Stable keys are based on the complete exported dimension, including filter columns. */
function stableId(value: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
  return `${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}
export function searchConsoleRowKey(row: Pick<SearchConsoleRow, "query" | "page" | "device" | "country">): string {
  return JSON.stringify([normalizeText(row.query), normalizeSearchConsoleUrl(row.page || ""), normalizeText(row.device).toLowerCase(), normalizeText(row.country).toLowerCase()]);
}
/** Never match by path alone: a different hostname, protocol or query can be a different page. */
export function normalizeSearchConsoleUrl(value: string): string {
  if (!value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch { return ""; }
}
export function searchConsolePageId(pages: Row[], value: string): string | undefined {
  const key = normalizeSearchConsoleUrl(value);
  if (!key) return;
  const matches = pages.filter((page) => normalizeSearchConsoleUrl(String(page.url || "")) === key);
  return matches.length === 1 ? matches[0].id : undefined;
}

/** Reject malformed grouping, signs, units, infinity and ambiguous locale decimals. */
export function parseSearchConsoleNumber(raw: string, integer = false): number | null {
  let value = latinDigits(raw.trim()).replace(/\u00a0/g, " ");
  if (!value) return null;
  if (/[٬, ]/.test(value)) {
    if (!/^\d{1,3}(?:[,٬ ]\d{3})+(?:[.٫]\d+)?$/.test(value)) return null;
    value = value.replace(/[,٬ ]/g, "");
  }
  value = value.replace(/٫/g, ".");
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number <= 1_000_000_000_000 && (!integer || Number.isInteger(number)) ? number : null;
}

function addSearchConsoleCount(total: number, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value) throw new Error("مجموع کلیک یا نمایش Search Console از ظرفیت عددی مجاز بیشتر است؛ خروجی را با فیلتر محدود کنید.");
  return total + value;
}

export function aggregateSearchConsoleRows(rows: SearchConsoleRow[]): SearchConsoleRow[] {
  const groups = new Map<string, { row: SearchConsoleRow; weighted: number; positionWeight: number; missingPosition: boolean }>();
  let totalClicks = 0, totalImpressions = 0;
  for (const row of rows) {
    totalClicks = addSearchConsoleCount(totalClicks, row.clicks);
    totalImpressions = addSearchConsoleCount(totalImpressions, row.impressions);
    const key = searchConsoleRowKey(row);
    const existing = groups.get(key);
    const weight = row.position !== undefined ? row.impressions : 0;
    if (existing) {
      existing.row.clicks = addSearchConsoleCount(existing.row.clicks, row.clicks);
      existing.row.impressions = addSearchConsoleCount(existing.row.impressions, row.impressions);
      existing.weighted += (row.position || 0) * weight; existing.positionWeight += weight;
      existing.missingPosition ||= row.impressions > 0 && row.position === undefined;
    } else groups.set(key, { row: { ...row, id: `gsc-${stableId(key)}` }, weighted: (row.position || 0) * weight, positionWeight: weight, missingPosition: row.impressions > 0 && row.position === undefined });
  }
  return [...groups.values()].map(({ row, weighted, positionWeight, missingPosition }) => ({ ...row, position: positionWeight && !missingPosition ? weighted / positionWeight : undefined }));
}

export function prepareSearchConsoleImport(matrix: string[][], mapping: SearchConsoleMapping): SearchConsolePreview {
  const result: SearchConsolePreview = { rows: [], errors: [], errorCount: 0, sourceRows: 0, skipped: 0 };
  const error = (row: number, message: string) => { result.errorCount++; if (result.errors.length < 12) result.errors.push({ row, message }); };
  const has = (key: SearchConsoleField) => mapping[key] !== undefined && mapping[key] !== "";
  if (!has("query") && !has("page")) error(1, "ستون عبارت جست‌وجو یا نشانی صفحه را مشخص کنید.");
  if (!has("clicks") || !has("impressions")) error(1, "ستون کلیک و نمایش ضروری است.");
  const indexes = Object.values(mapping).filter((value): value is number => typeof value === "number");
  if (new Set(indexes).size !== indexes.length) error(1, "هر ستون فایل فقط به یک فیلد متصل شود.");
  if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= (matrix[0]?.length || 0))) error(1, "شمارهٔ ستون معتبر نیست.");
  if (result.errorCount) return result;
  result.dimension = has("query") && has("page") ? "query-page" : has("page") ? "page" : "query";
  const cell = (cells: string[], key: SearchConsoleField) => has(key) ? normalizeText(cells[Number(mapping[key])] ?? "") : "";
  const input: SearchConsoleRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i];
    if (!cells.some((value) => value.trim())) { result.skipped++; continue; }
    result.sourceRows++;
    if (result.sourceRows > SEARCH_CONSOLE_ROW_LIMIT) { error(i + 1, "هر دوره حداکثر ۲۰٬۰۰۰ ردیف دارد؛ فایل را با فیلتر محدود کنید."); break; }
    const query = cell(cells, "query"), page = cell(cells, "page");
    if ((has("query") && !query) || (has("page") && !normalizeSearchConsoleUrl(page))) { error(i + 1, "عبارت خالی یا نشانی صفحه نامعتبر است."); continue; }
    if (query.length > 1000 || page.length > 4096 || cell(cells, "device").length > 100 || cell(cells, "country").length > 100) { error(i + 1, "طول یکی از مقادیر بیش از ظرفیت مجاز است."); continue; }
    const clicks = parseSearchConsoleNumber(cell(cells, "clicks"), true), impressions = parseSearchConsoleNumber(cell(cells, "impressions"), true);
    if (clicks === null || impressions === null || clicks > impressions) { error(i + 1, "کلیک و نمایش باید عدد صحیح نامنفی باشند؛ کلیک از نمایش بیشتر نباشد."); continue; }
    const rawPosition = cell(cells, "position"), position = rawPosition ? parseSearchConsoleNumber(rawPosition) : undefined;
    if (position === null || (position !== undefined && (position > 1000 || (position < 1 && impressions > 0)))) { error(i + 1, "میانگین جایگاه معتبر نیست."); continue; }
    const rawCtr = cell(cells, "ctr");
    if (rawCtr) {
      const ctr = parseSearchConsoleNumber(rawCtr.replace(/[%٪]$/, ""));
      if (ctr === null || ctr > 100) { error(i + 1, "نرخ کلیک واردشده معتبر نیست."); continue; }
    }
    const row: SearchConsoleRow = { id: `preview-${i}`, clicks, impressions };
    if (has("query")) row.query = query;
    if (has("page")) row.page = normalizeSearchConsoleUrl(page);
    if (position !== undefined) row.position = position;
    if (cell(cells, "device")) row.device = cell(cells, "device").toLowerCase();
    if (cell(cells, "country")) row.country = cell(cells, "country").toLowerCase();
    input.push(row);
  }
  try { result.rows = aggregateSearchConsoleRows(input); }
  catch (failure) { error(1, failure instanceof Error ? failure.message : "مجموع آمار Search Console معتبر نیست."); }
  if (!result.sourceRows) error(1, "فایل ردیف داده ندارد.");
  return result;
}

export function searchConsolePeriodDays(dataset: Pick<SearchConsoleDataset, "periodStart" | "periodEnd">): number {
  if (!isIsoDate(dataset.periodStart) || !isIsoDate(dataset.periodEnd) || dataset.periodEnd < dataset.periodStart) return 0;
  return (Date.parse(dataset.periodEnd) - Date.parse(dataset.periodStart)) / 86_400_000 + 1;
}
export function searchConsoleComparisonReason(current?: SearchConsoleDataset, previous?: SearchConsoleDataset): string | null {
  if (!current || !previous) return "برای مقایسه، هر دو دوره را وارد کنید.";
  if (!searchConsolePeriodDays(current) || !searchConsolePeriodDays(previous)) return "تاریخ دوره‌ها معتبر نیست.";
  if (current.dimension !== previous.dimension) return "نوع دادهٔ دو دوره یکسان نیست؛ دادهٔ عبارت و صفحه را نمی‌توان به هم پیوند داد.";
  if (searchConsolePeriodDays(current) !== searchConsolePeriodDays(previous)) return "طول دو دوره برابر نیست؛ دوره‌های هم‌اندازه وارد کنید.";
  if (previous.periodEnd >= current.periodStart) return "دورهٔ قبلی باید پیش از دورهٔ فعلی و بدون همپوشانی باشد.";
  if (normalizeText(current.sourceFilters).toLowerCase() !== normalizeText(previous.sourceFilters).toLowerCase()) return "فیلترهای خروجی دو دوره یکسان نیستند.";
  const dimensions = (data: SearchConsoleDataset) => data.rows.some((row) => Boolean(row.device)) + ":" + data.rows.some((row) => Boolean(row.country));
  if (dimensions(current) !== dimensions(previous)) return "ستون‌های دستگاه یا کشور دو دوره یکسان نیستند.";
  return null;
}
export function validateSearchConsoleData(data: SearchConsoleData): void {
  for (const dataset of [data.current, data.previous]) if (dataset) {
    if (!searchConsolePeriodDays(dataset)) throw new Error("شروع و پایان معتبر دوره را مشخص کنید.");
    if (dataset.rows.length > SEARCH_CONSOLE_ROW_LIMIT || dataset.sourceRows > SEARCH_CONSOLE_ROW_LIMIT) throw new Error("تعداد ردیف‌های هر دوره از ۲۰٬۰۰۰ بیشتر است.");
    if (!dataset.rows.length) throw new Error("دورهٔ واردشده داده ندارد.");
    if (!Number.isSafeInteger(dataset.sourceRows) || dataset.sourceRows < dataset.rows.length) throw new Error("تعداد ردیف‌های منبع Search Console معتبر نیست.");
    if (!["page", "query", "query-page"].includes(dataset.dimension)) throw new Error("نوع داده Search Console معتبر نیست.");
    let totalClicks = 0, totalImpressions = 0;
    const ids = new Set<string>();
    for (const row of dataset.rows) {
      if (!Number.isSafeInteger(row.clicks) || !Number.isSafeInteger(row.impressions) || row.clicks < 0 || row.impressions < 0 || row.clicks > row.impressions) throw new Error("کلیک و نمایش باید عدد صحیح نامنفی و دقیق باشند؛ کلیک از نمایش بیشتر نباشد.");
      totalClicks = addSearchConsoleCount(totalClicks, row.clicks);
      totalImpressions = addSearchConsoleCount(totalImpressions, row.impressions);
      if (typeof row.id !== "string" || !row.id.trim() || ids.has(row.id)) throw new Error("شناسهٔ ردیف Search Console خالی یا تکراری است.");
      ids.add(row.id);
      const query = typeof row.query === "string" ? row.query.trim() : "";
      const page = typeof row.page === "string" ? normalizeSearchConsoleUrl(row.page) : "";
      if (dataset.dimension !== "page" && !query || dataset.dimension !== "query" && !page || dataset.dimension === "page" && row.query !== undefined || dataset.dimension === "query" && row.page !== undefined) throw new Error("ستون‌های عبارت و صفحه با نوع دادهٔ Search Console همخوان نیستند؛ کاربرگ و نگاشت ستون‌ها را بررسی کنید.");
      if (row.position !== undefined && (typeof row.position !== "number" || !Number.isFinite(row.position) || row.position < 0 || row.position > 1000 || row.position < 1 && row.impressions > 0)) throw new Error("میانگین جایگاه Search Console معتبر نیست.");
    }
  }
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > SEARCH_CONSOLE_BYTES_LIMIT) throw new Error("حجم دو دوره از ۵ مگابایت بیشتر است؛ خروجی را با فیلتر محدود کنید.");
}
export function createSearchConsoleDataset(preview: SearchConsolePreview, options: Pick<SearchConsoleDataset, "periodStart" | "periodEnd" | "label" | "sourceFilters">): SearchConsoleDataset {
  if (preview.errorCount || !preview.dimension || !preview.rows.length) throw new Error("خطاهای پیش‌نمایش را پیش از ورود داده اصلاح کنید.");
  const dataset: SearchConsoleDataset = { ...options, id: crypto.randomUUID(), importedAt: new Date().toISOString(), dimension: preview.dimension, rows: preview.rows, sourceRows: preview.sourceRows };
  validateSearchConsoleData({ current: dataset });
  return dataset;
}

export function buildSearchConsoleInsights(project: SearchConsoleProject): SearchConsoleInsight[] {
  const current = project.searchConsole?.current;
  if (!current || !searchConsolePeriodDays(current)) return [];
  const previous = project.searchConsole?.previous;
  const compare = !searchConsoleComparisonReason(current, previous);
  const previousRows = new Map(compare ? previous!.rows.map((row) => [searchConsoleRowKey(row), row]) : []);
  const pageLookup = new Map<string, string | null>();
  for (const page of project.pages) {
    const url = normalizeSearchConsoleUrl(String(page.url || ""));
    if (url) pageLookup.set(url, pageLookup.has(url) ? null : page.id);
  }
  const insights: SearchConsoleInsight[] = [];
  const add = (row: SearchConsoleRow, kind: SearchConsoleInsight["kind"], title: string, reason: string, priority: SearchConsoleInsight["priority"], extra: Partial<SearchConsoleInsight["evidence"]> = {}) => {
    insights.push({ id: `${kind}-${stableId(searchConsoleRowKey(row))}`, kind, title, reason, priority,
      pageId: row.page ? pageLookup.get(normalizeSearchConsoleUrl(row.page)) || undefined : undefined, query: row.query, url: row.page,
      evidence: { clicks: row.clicks, impressions: row.impressions, ctr: row.impressions ? row.clicks / row.impressions : 0, position: row.position, periodStart: current.periodStart, periodEnd: current.periodEnd, device: row.device, country: row.country, ...extra } });
  };
  for (const row of current.rows) {
    const ctr = row.impressions ? row.clicks / row.impressions : 0;
    if (row.impressions >= 300 && ctr < 0.02 && row.position !== undefined && row.position <= 10) add(row, "low-ctr", "نمایش زیاد و کلیک کم؛ عنوان و هدف صفحه را بررسی کنید", "حداقل ۳۰۰ نمایش، نرخ کلیک کمتر از ۲٪ و میانگین جایگاه در ده نتیجهٔ اول؛ این آستانهٔ بررسی است و نرخ کلیک استاندارد همهٔ حوزه‌ها نیست.", "P1");
    if (row.impressions >= 100 && row.position !== undefined && row.position >= 4 && row.position <= 15) add(row, "near-first-page", "فرصت بررسی بهبود صفحه با جایگاه ۴ تا ۱۵", "دادهٔ این دوره حداقل ۱۰۰ نمایش و میانگین جایگاه ۴ تا ۱۵ دارد؛ ارتباط محتوا با هدف جست‌وجو و لینک‌های داخلی را بررسی کنید.", "P2");
    const old = previousRows.get(searchConsoleRowKey(row));
    if (old && old.clicks >= 20 && row.clicks <= old.clicks * 0.75) add(row, "decline", "کلیک این ردیف نسبت به دورهٔ قبلی افت کرده است", "دو دورهٔ هم‌اندازه با ابعاد و فیلتر یکسان مقایسه شدند؛ افت کلیک دست‌کم ۲۵٪ است. افت، دلیل قطعی یا اثر یک تغییر خاص را اثبات نمی‌کند.", old.clicks - row.clicks >= 100 ? "P0" : "P1", { previousClicks: old.clicks, clickChange: row.clicks - old.clicks });
  }
  if (current.dimension === "query-page") {
    const queries = new Map<string, SearchConsoleRow[]>();
    for (const row of current.rows) if (row.query && row.page && row.impressions >= 50) {
      const key = JSON.stringify([normalizeText(row.query), row.device || "", row.country || ""]);
      const group = queries.get(key) || []; group.push(row); queries.set(key, group);
    }
    for (const rows of queries.values()) {
      rows.sort((a, b) => (a.page || "").localeCompare(b.page || ""));
      const urls = [...new Set(rows.map((row) => row.page!))];
      if (urls.length < 2) continue;
      const combined = { ...rows[0], clicks: rows.reduce((n, row) => n + row.clicks, 0), impressions: rows.reduce((n, row) => n + row.impressions, 0), position: undefined };
      add(combined, "query-page-overlap", "یک عبارت برای چند صفحه نمایش گرفته؛ هدف صفحات را بررسی کنید", "این خروجی واقعاً عبارت و صفحه را در یک ردیف دارد و برای هر صفحه حداقل ۵۰ نمایش ثبت شده است. نمایش چند صفحه، به‌تنهایی اثبات کنیبالیزیشن یا ضرورت ادغام نیست.", "P2", { urls });
    }
  }
  const rank = { P0: 0, P1: 1, P2: 2 };
  return insights.sort((a, b) => rank[a.priority] - rank[b.priority] || b.evidence.impressions - a.evidence.impressions || a.id.localeCompare(b.id)).slice(0, 100);
}
