import type { Project, Row } from "./types";
import { validateProjectPlaybook, type ProjectPlaybook } from "./playbooks";
import type { SearchConsoleData, SearchConsoleDataset, SearchConsoleRow } from "./search-console";
import { isIsoDate } from "./dates";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function string(value: unknown, label: string, max = 10000): string {
  if (typeof value !== "string" || value.length > max) throw new Error(`${label} معتبر نیست.`);
  return value;
}
function id(value: unknown): string {
  const result = string(value, "شناسه", 200);
  if (!result.trim()) throw new Error("شناسه نمی‌تواند خالی باشد.");
  return result;
}
export function validatePlaybook(value: unknown): ProjectPlaybook {
  if (!object(value)) throw new Error("روال پروژه معتبر نیست.");
  const result = validateProjectPlaybook(value);
  // Share the editor's limits and control-character policy, while a backup
  // round-trip preserves intentional whitespace in the user's source text.
  for (const key of Object.keys(result) as (keyof ProjectPlaybook)[]) result[key] = value[key] as string;
  return result;
}
export function validateSavedPlaybooks(value: unknown): ProjectPlaybook[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error("حداکثر ۳۰ روال شخصی قابل نگهداری است.");
  const result = value.map(validatePlaybook);
  if (new Set(result.map((item) => item.id)).size !== result.length) throw new Error("شناسه روال‌ها تکراری است.");
  return result;
}
function validateRows(value: unknown, limit: number, collection: "tasks" | "links"): Row[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error("ظرفیت یا ساختار کارها و لینک‌ها معتبر نیست.");
  const ids = new Set<string>();
  return value.map((input): Row => {
    if (!object(input) || Object.keys(input).length > 120) throw new Error("ساختار کار یا لینک معتبر نیست.");
    const row: Row = { id: id(input.id) };
    if (ids.has(row.id)) throw new Error("شناسه کار یا لینک تکراری است.");
    ids.add(row.id);
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      if (key.length > 100 || ["__proto__", "constructor", "prototype"].includes(key)) throw new Error("نام فیلد معتبر نیست.");
      if (typeof value === "string" && value.length <= 100000 || typeof value === "number" && Number.isFinite(value)) row[key] = value;
      else throw new Error("مقدار کار یا لینک معتبر نیست.");
    }
    if (row.status !== undefined && (typeof row.status !== "string" || row.status !== "" && !(collection === "tasks" ? ["open", "done", "dismissed"] : ["planned", "implemented"]).includes(row.status))) throw new Error("وضعیت کار یا لینک معتبر نیست.");
    const references = collection === "tasks" ? ["pageId", "contentId", "keywordId"] : ["fromPageId", "toPageId"];
    for (const key of references) if (row[key] !== undefined && (typeof row[key] !== "string" || String(row[key]).length > 200)) throw new Error("ارجاع کار یا لینک معتبر نیست.");
    for (const key of ["dueDate", "createdAt", "updatedAt", "completedAt", "implementedAt"]) if (row[key] !== undefined && row[key] !== "" && (typeof row[key] !== "string" || !validStoredDate(String(row[key])))) throw new Error("تاریخ کار یا لینک معتبر نیست.");
    return row;
  });
}
function validStoredDate(value: string): boolean {
  if (isIsoDate(value)) return true;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  return !!match && isIsoDate(match[1]) && Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59 && (match[5] === "Z" || Number(match[6]) <= 23 && Number(match[7]) <= 59) && Number.isFinite(Date.parse(value));
}
function validateDataset(value: unknown): SearchConsoleDataset {
  if (!object(value) || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 20000) throw new Error("داده‌های Search Console معتبر نیست.");
  const periodStart = string(value.periodStart, "شروع دوره", 10), periodEnd = string(value.periodEnd, "پایان دوره", 10);
  if (!isIsoDate(periodStart) || !isIsoDate(periodEnd) || periodStart > periodEnd) throw new Error("دوره Search Console معتبر نیست.");
  if (!["page", "query", "query-page"].includes(String(value.dimension))) throw new Error("نوع داده Search Console معتبر نیست.");
  const dimension = value.dimension as SearchConsoleDataset["dimension"];
  const importedAt = string(value.importedAt, "زمان ورود داده", 100);
  if (!validStoredDate(importedAt) || !Number.isSafeInteger(value.sourceRows) || Number(value.sourceRows) < value.rows.length || Number(value.sourceRows) > 20000) throw new Error("اطلاعات ورود Search Console معتبر نیست.");
  const ids = new Set<string>();
  let totalClicks = 0, totalImpressions = 0;
  const rows = value.rows.map((input): SearchConsoleRow => {
    if (!object(input)) throw new Error("ردیف Search Console معتبر نیست.");
    const row: SearchConsoleRow = { id: id(input.id), clicks: Number(input.clicks), impressions: Number(input.impressions) };
    if (ids.has(row.id) || typeof input.clicks !== "number" || typeof input.impressions !== "number" || !Number.isSafeInteger(row.clicks) || !Number.isSafeInteger(row.impressions) || row.clicks < 0 || row.impressions < 0 || row.clicks > row.impressions) throw new Error("شمارش کلیک و نمایش یا شناسه ردیف معتبر نیست.");
    totalClicks += row.clicks; totalImpressions += row.impressions;
    if (!Number.isSafeInteger(totalClicks) || !Number.isSafeInteger(totalImpressions)) throw new Error("مجموع آمار Search Console از ظرفیت عددی مجاز بیشتر است.");
    ids.add(row.id);
    if (input.query !== undefined) row.query = string(input.query, "عبارت", 10000);
    if (input.page !== undefined) {
      row.page = string(input.page, "نشانی صفحه", 10000);
      try { const url = new URL(row.page); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
      catch { throw new Error("نشانی صفحه Search Console معتبر نیست."); }
    }
    if (dimension !== "page" && !row.query?.trim() || dimension !== "query" && !row.page || dimension === "page" && row.query !== undefined || dimension === "query" && row.page !== undefined) throw new Error("ستون‌های Search Console با نوع داده همخوان نیست.");
    if (input.position !== undefined) {
      if (typeof input.position !== "number" || !Number.isFinite(input.position) || input.position < 0 || input.position > 1000 || input.position < 1 && row.impressions > 0) throw new Error("جایگاه Search Console معتبر نیست.");
      row.position = input.position;
    }
    if (input.device !== undefined) row.device = string(input.device, "دستگاه", 200);
    if (input.country !== undefined) row.country = string(input.country, "کشور", 200);
    return row;
  });
  const result: SearchConsoleDataset = { id: id(value.id), label: string(value.label, "نام دوره", 500), importedAt, periodStart, periodEnd, dimension, sourceRows: Number(value.sourceRows), rows };
  if (value.sourceFilters !== undefined) result.sourceFilters = string(value.sourceFilters, "فیلتر خروجی", 10000);
  return result;
}
export function validateProjectExtras(raw: Record<string, unknown>): Partial<Project> {
  const result: Partial<Project> = {};
  if (raw.tasks !== undefined) result.tasks = validateRows(raw.tasks, 4000, "tasks");
  if (raw.links !== undefined) result.links = validateRows(raw.links, 10000, "links");
  if (raw.playbook !== undefined) result.playbook = validatePlaybook(raw.playbook);
  if (raw.searchConsole !== undefined) {
    if (!object(raw.searchConsole)) throw new Error("ساختار Search Console معتبر نیست.");
    const data: SearchConsoleData = {};
    if (raw.searchConsole.current !== undefined) data.current = validateDataset(raw.searchConsole.current);
    if (raw.searchConsole.previous !== undefined) data.previous = validateDataset(raw.searchConsole.previous);
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 5_000_000) throw new Error("حجم دو دوره Search Console از ۵ مگابایت بیشتر است.");
    result.searchConsole = data;
  }
  return result;
}
