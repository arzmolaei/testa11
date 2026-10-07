import { normalizeKeyword, SCHEMAS } from "./domain";
import type { Collection, Field, Row } from "./types";

export type BulkCellChange = { id: string; key: string; value: string | number };
export type PastePreview = { changes: BulkCellChange[]; errors: string[]; rows: number; columns: number };
export type DateParser = (value: string) => string | null;

export function parseBulkValue(field: Field, raw: string, dateParser?: DateParser): string | number {
  if (field.calculated || field.key === "id") throw new Error("این ستون محاسباتی است و قابل ویرایش نیست.");
  const text = raw.trim();
  if (!text) return "";
  if (text.length > 20000) throw new Error("متن این خانه بیش از حد بلند است.");
  if (field.type === "number") {
    const digits = text.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace(/[,٬\s]/g, "").replace(/٫/g, ".");
    if (!/^\d+(?:\.\d+)?$/.test(digits)) throw new Error("یک عدد صفر یا بیشتر وارد کنید.");
    const value = Number(digits);
    if (!Number.isFinite(value)) throw new Error("عدد معتبر نیست.");
    if (["ctr", "previousCtr", "kdTool", "kdKwf", "kdJetSeo"].includes(field.key) && value > 100)
      throw new Error("مقدار باید بین صفر و ۱۰۰ باشد.");
    return value;
  }
  if (field.type === "select" && field.options && !field.options.includes(text))
    throw new Error("مقدار با گزینه‌های مجاز این ستون مطابقت ندارد.");
  if (field.type === "date") {
    const value = dateParser?.(text);
    if (!value) throw new Error("تاریخ شمسی معتبر وارد کنید؛ مانند ۱۴۰۵/۰۷/۱۵.");
    return value;
  }
  return text;
}

/** Spreadsheet TSV including quoted tabs/newlines; a trailing clipboard newline is not a new row. */
export function parseClipboard(text: string): string[][] {
  if (text.length > 8 * 1024 * 1024) throw new Error("حجم متن برای چسباندن بیش از حد بزرگ است.");
  if (!text) return [];
  const source = text.replace(/(?:\r?\n)$/, "");
  const matrix: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"' && (quoted || !cell)) {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === "\t" || char === "\n" || char === "\r")) {
      row.push(cell); cell = "";
      if (char !== "\t") {
        matrix.push(row); row = [];
        if (char === "\r" && source[i + 1] === "\n") i++;
      }
    } else cell += char;
  }
  if (quoted) throw new Error("نقل‌قول متن چسبانده‌شده بسته نشده است.");
  row.push(cell); matrix.push(row);
  return matrix;
}

export function previewPaste(
  text: string, rows: Row[], columns: Field[], rowIndex: number, columnIndex: number, dateParser?: DateParser,
): PastePreview {
  const matrix = parseClipboard(text);
  const result: PastePreview = { changes: [], errors: [], rows: matrix.length, columns: Math.max(0, ...matrix.map((r) => r.length)) };
  if (!matrix.length) return result;
  if (rowIndex < 0 || columnIndex < 0 || rowIndex + matrix.length > rows.length || columnIndex + result.columns > columns.length) {
    result.errors.push("محدوده چسباندن از ردیف‌ها یا ستون‌های جدول بیرون می‌رود؛ ردیف اضافه کنید یا نقطه شروع را تغییر دهید.");
    return result;
  }
  matrix.forEach((values, y) => values.forEach((value, x) => {
    const field = columns[columnIndex + x];
    try {
      const parsed = parseBulkValue(field, value, dateParser);
      if (String(rows[rowIndex + y][field.key] ?? "") !== String(parsed))
        result.changes.push({ id: rows[rowIndex + y].id, key: field.key, value: parsed });
    } catch (error) {
      if (result.errors.length < 20)
        result.errors.push(`ردیف ${rowIndex + y + 1}، ${field.label}: ${(error as Error).message}`);
    }
  }));
  return result;
}

export function applyCellChanges(rows: Row[], changes: BulkCellChange[]): Row[] {
  const patches = new Map<string, Partial<Row>>();
  changes.forEach(({ id, key, value }) => {
    if (key === "id") throw new Error("شناسه داخلی قابل تغییر نیست.");
    patches.set(id, { ...(patches.get(id) || {}), [key]: value });
  });
  return rows.map((row) => patches.has(row.id) ? { ...row, ...patches.get(row.id), id: row.id } : row);
}

export function validateBulkRows(collection: Collection, rows: Row[], editedIds: Set<string>, pages?: Row[]): string | null {
  if (rows.length > (collection === "keywords" ? 20000 : 2000)) return "تعداد ردیف‌های جدول از سقف مجاز بیشتر است.";
  const internalIds = new Set<string>();
  const required = collection === "keywords" ? "keyword" : collection === "pages" ? "target" : collection === "content" ? "topic" : "";
  const requiredLabel = SCHEMAS[collection].flatMap((s) => s.fields).find((f) => f.key === required)?.label;
  const displayKey = collection === "pages" ? "pageId" : collection === "content" ? "contentId" : "";
  const displayIds = new Map<string, string>();
  const resultRefs = new Map<string, string>();
  const pageMap = new Map((pages || []).map((page) => [page.id, page]));
  for (const row of rows) {
    if (!row.id || internalIds.has(row.id)) return "شناسه داخلی ردیف تکراری یا نامعتبر است.";
    internalIds.add(row.id);
    if (editedIds.has(row.id)) {
      if (required && !String(row[required] ?? "").trim()) return `${requiredLabel} نمی‌تواند خالی باشد.`;
      if (collection === "results" && !row.pageId && !String(row.url ?? "").trim()) return "برای نتیجه، صفحه مرتبط یا URL وارد کنید.";
      const linkKey = collection === "content" ? "targetPage" : collection === "results" ? "pageId" : "";
      if (pages !== undefined && linkKey && row[linkKey] && !pageMap.has(String(row[linkKey])))
        return "صفحه مرتبط معتبر نیست؛ صفحه را از فهرست صفحات انتخاب کنید.";
    }
    const displayId = displayKey && normalizeKeyword(String(row[displayKey] ?? ""));
    if (displayId) {
      const previous = displayIds.get(displayId);
      if (previous && (editedIds.has(row.id) || editedIds.has(previous))) return "شناسه نمایشی تکراری است؛ برای هر ردیف شناسه یکتا وارد کنید.";
      displayIds.set(displayId, row.id);
    }
    if (collection === "results") {
      const linkedPage = pageMap.get(String(row.pageId ?? ""));
      const keys = [row.pageId ? `page:${row.pageId}` : "", String(row.url || linkedPage?.url || "").trim().replace(/\/$/, "")].filter(Boolean);
      for (const key of keys) {
        const previous = resultRefs.get(key);
        if (previous && (editedIds.has(row.id) || editedIds.has(previous))) return "برای این صفحه نتیجه دیگری ثبت شده است؛ رکورد موجود را ویرایش کنید.";
        resultRefs.set(key, row.id);
      }
    }
  }
  return null;
}

export function encodeClipboard(rows: Row[], columns: Field[]): string {
  return rows.map((row) => columns.map((field) => {
    const value = String(row[field.key] ?? "");
    return /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join("\t")).join("\n");
}
