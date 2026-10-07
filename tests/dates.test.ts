import { describe, expect, it } from "vitest";
import {
  formatDate, formatJalaliInput, getJalaliParts, isIsoDate, jalaliFileDate,
  jalaliMonthDays, jalaliMonthGrid, jalaliToIso, parseJalali, todayIso, toIsoDate,
} from "../src/dates";

describe("Persian date presentation with ISO storage", () => {
  it("converts Nowruz and a project date in both directions", () => {
    expect(getJalaliParts("2026-03-21")).toEqual({ year: 1405, month: 1, day: 1 });
    expect(getJalaliParts("2026-10-07")).toEqual({ year: 1405, month: 7, day: 15 });
    expect(jalaliToIso(1405, 7, 15)).toBe("2026-10-07");
    expect(formatJalaliInput("2026-10-07")).toBe("۱۴۰۵/۰۷/۱۵");
    expect(formatDate("2026-10-07")).toContain("مهر");
    expect(formatDate("2026-10-07")).toContain("۱۴۰۵");
  });
  it("validates Esfand against the real Persian leap year", () => {
    expect(parseJalali("۱۴۰۳/۱۲/۳۰")).toBe("2025-03-20");
    expect(parseJalali("۱۴۰۴/۱۲/۳۰")).toBeNull();
    expect(parseJalali("۱۴۰۲/۱۲/۳۰")).toBeNull();
    expect(jalaliMonthDays(1403, 12)).toBe(30);
    expect(jalaliMonthDays(1404, 12)).toBe(29);
    expect(parseJalali("1405/07/31")).toBeNull();
    expect(parseJalali("1405/13/01")).toBeNull();
    expect(parseJalali("1405/00/01")).toBeNull();
    expect(parseJalali("1405/01/00")).toBeNull();
  });
  it("accepts Persian, Arabic and Latin digits without parsing a Shamsi year as Gregorian", () => {
    for (const value of ["۱۴۰۵/۷/۱۵", "١٤٠٥/٧/١٥", "1405-07-15", " 1405.07.15 "])
      expect(parseJalali(value)).toBe("2026-10-07");
    expect(toIsoDate("1405-07-15")).toBe("2026-10-07");
    expect(toIsoDate("۲۰۲۶-۱۰-۰۷")).toBe("2026-10-07");
    expect(toIsoDate("2026-02-30")).toBeNull();
    expect(parseJalali("tomorrow")).toBeNull();
    for (const value of ["۱۴۰۵/۷/۱۵", "١٤٠٥/٧/١٥", "1405-07-15", "1405/07/15"])
      expect(formatDate(value)).toBe(formatDate("2026-10-07"));
    expect(formatDate("1404-12-30")).toBe("تاریخ نامعتبر");
    expect(formatDate("1403/12/30")).toContain("۱۴۰۳");
  });
  it("uses Tehran's midnight for today, timestamps and filenames", () => {
    const beforeMidnight = new Date("2026-03-20T20:00:00Z");
    const afterMidnight = new Date("2026-03-20T21:00:00Z");
    expect(todayIso(beforeMidnight)).toBe("2026-03-20");
    expect(todayIso(afterMidnight)).toBe("2026-03-21");
    expect(jalaliFileDate(afterMidnight)).toBe("1405-01-01");
    expect(formatDate(afterMidnight)).toContain("فروردین");
    expect(formatDate(afterMidnight)).toContain("۱۴۰۵");
    expect(formatDate("2026-03-20", { month: "long" })).toContain("اسفند");
  });
  it("rejects rollover dates and keeps empty or corrupt dates recognizable", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(getJalaliParts("2026-04-31")).toBeNull();
    expect(formatJalaliInput("broken")).toBe("");
    expect(formatDate("2026-04-31")).toBe("تاریخ نامعتبر");
    expect(formatDate("")).toBe("—");
  });
  it("builds a real Shamsi month with Saturday first and Friday as the weekend", () => {
    const grid = jalaliMonthGrid(1405, 1);
    const days = grid.filter((day) => day !== null);
    expect(grid.length % 7).toBe(0);
    expect(days).toHaveLength(31);
    expect(grid[0]).toEqual({ iso: "2026-03-21", day: 1, weekday: 0 });
    expect(days.find((day) => day.weekday === 6)).toEqual({ iso: "2026-03-27", day: 7, weekday: 6 });
    expect(jalaliMonthGrid(1403, 12).filter(Boolean)).toHaveLength(30);
    expect(jalaliMonthGrid(1404, 12).filter(Boolean)).toHaveLength(29);
  });
});
