/** Dates stay ISO in storage; every product-facing date uses the Persian calendar. */
export const TEHRAN_TIME_ZONE = "Asia/Tehran";
export const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
] as const;
export const JALALI_WEEKDAYS = [
  "شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه",
] as const;
export type JalaliParts = { year: number; month: number; day: number };
export type JalaliCalendarDay = { iso: string; day: number; weekday: number };

const DAY_MS = 86400000;
const persianParts = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
  calendar: "persian", timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric",
});
const isoPartsCache = new Map<string, JalaliParts>();
const jalaliIsoCache = new Map<string, string | null>();

export function latinDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}
export function persianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

/** Strict validation prevents JavaScript's silent invalid-day rollover. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, rawYear, rawMonth, rawDay] = match;
  const year = Number(rawYear), month = Number(rawMonth), day = Number(rawDay);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function dateOnly(value: string): Date | null {
  return isIsoDate(value) ? new Date(`${value}T12:00:00.000Z`) : null;
}

export function getJalaliParts(iso: string): JalaliParts | null {
  if (isoPartsCache.has(iso)) return isoPartsCache.get(iso)!;
  const date = dateOnly(iso);
  if (!date) return null;
  const values: Record<string, number> = {};
  for (const part of persianParts.formatToParts(date))
    if (["year", "month", "day"].includes(part.type)) values[part.type] = Number(part.value);
  const result = { year: values.year, month: values.month, day: values.day };
  // Keep long-lived apps bounded even when users inspect many projects.
  if (isoPartsCache.size > 8192) isoPartsCache.clear();
  isoPartsCache.set(iso, result);
  return result;
}

function compareParts(a: JalaliParts, b: JalaliParts): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** Uses the browser's ICU Persian calendar, including real Esfand leap years. */
export function jalaliToIso(year: number, month: number, day: number): string | null {
  const key = `${year}/${month}/${day}`;
  if (jalaliIsoCache.has(key)) return jalaliIsoCache.get(key)!;
  if (![year, month, day].every(Number.isInteger) || year < 1 || year > 3177 || month < 1 || month > 12 || day < 1 || day > 31)
    return null;
  const target = { year, month, day };
  let low = Math.floor(new Date(`${String(year + 621).padStart(4, "0")}-01-01T12:00:00Z`).getTime() / DAY_MS);
  let high = Math.floor(new Date(`${String(year + 622).padStart(4, "0")}-12-31T12:00:00Z`).getTime() / DAY_MS);
  let result: string | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const iso = new Date(middle * DAY_MS + DAY_MS / 2).toISOString().slice(0, 10);
    const parts = getJalaliParts(iso)!;
    const comparison = compareParts(parts, target);
    if (comparison === 0) { result = iso; break; }
    if (comparison < 0) low = middle + 1;
    else high = middle - 1;
  }
  if (jalaliIsoCache.size > 8192) jalaliIsoCache.clear();
  jalaliIsoCache.set(key, result);
  return result;
}

export function parseJalali(value: string): string | null {
  const clean = latinDigits(value).trim().replace(/[\u200e\u200f\u061c]/g, "");
  const match = /^(\d{1,4})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})$/.exec(clean);
  return match ? jalaliToIso(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

/** For pasted/imported dates: contemporary dashed ISO or an explicit Shamsi date. */
export function toIsoDate(value: string): string | null {
  const clean = latinDigits(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean) && Number(clean.slice(0, 4)) >= 1700)
    return isIsoDate(clean) ? clean : null;
  return parseJalali(clean);
}

export function formatJalaliInput(iso: string, usePersianDigits = true): string {
  const parts = getJalaliParts(iso);
  if (!parts) return "";
  const value = `${String(parts.year).padStart(4, "0")}/${String(parts.month).padStart(2, "0")}/${String(parts.day).padStart(2, "0")}`;
  return usePersianDigits ? persianDigits(value) : value;
}

export function formatDate(value: unknown, options?: Intl.DateTimeFormatOptions): string {
  if (value == null || value === "") return "—";
  let date: Date | null;
  if (typeof value === "string") {
    const clean = latinDigits(value).trim().replace(/[\u200e\u200f\u061c]/g, "");
    if (/^\d{1,4}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{1,2}$/.test(clean)) {
      const iso = toIsoDate(clean);
      date = iso ? dateOnly(iso) : null;
    } else date = new Date(clean);
  } else date = value instanceof Date ? value : typeof value === "number" ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "تاریخ نامعتبر";
  const styles = options?.dateStyle || options?.timeStyle;
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    ...(!styles ? { year: "numeric", month: "long", day: "numeric" } as const : {}),
    ...options, calendar: "persian", timeZone: TEHRAN_TIME_ZONE,
  }).format(date);
}

export function todayIso(now = new Date()): string {
  const values: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: TEHRAN_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now)) values[part.type] = part.value;
  return `${values.year}-${values.month}-${values.day}`;
}
export function jalaliFileDate(now = new Date()): string {
  return formatJalaliInput(todayIso(now), false).replaceAll("/", "-");
}
export function jalaliMonthDays(year: number, month: number): number {
  if (!Number.isInteger(year) || year < 1 || year > 3177 || month < 1 || month > 12 || !Number.isInteger(month)) return 0;
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  return jalaliToIso(year, 12, 30) ? 30 : 29;
}
export function jalaliMonthGrid(year: number, month: number): Array<JalaliCalendarDay | null> {
  const firstIso = jalaliToIso(year, month, 1);
  if (!firstIso) return [];
  const firstDate = dateOnly(firstIso)!;
  const offset = (firstDate.getUTCDay() + 1) % 7; // Saturday starts the Persian week.
  const length = jalaliMonthDays(year, month);
  const cells: Array<JalaliCalendarDay | null> = Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, () => null);
  for (let day = 1; day <= length; day++) {
    const iso = new Date(firstDate.getTime() + (day - 1) * DAY_MS).toISOString().slice(0, 10);
    cells[offset + day - 1] = { iso, day, weekday: (offset + day - 1) % 7 };
  }
  return cells;
}
