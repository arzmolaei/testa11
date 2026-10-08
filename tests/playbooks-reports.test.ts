import { describe, expect, it } from "vitest";
import { cloneProjectPlaybook, createCustomPlaybook, findProjectPlaybook, PROJECT_PLAYBOOKS, validateProjectPlaybook } from "../src/playbooks";
import { buildProjectReport, defaultReportPeriod, importedReportPeriod, reportCsv, reportDate, reportFileName, reportHtml, safeReportCsvCell, validateReportPeriod } from "../src/reports";
import type { Project } from "../src/types";
import type { SearchConsoleDataset } from "../src/search-console";

function project(patch: Partial<Project> = {}): Project {
  return { id: "project", name: "پروژه واقعی", domain: "example.test", market: "ایران", language: "فارسی", projectType: "Mixed", goal: "درخواست مشاوره", startDate: "2026-09-23", lastReview: "", keywords: [], pages: [], content: [], results: [], ...patch };
}
const period = { start: "2026-10-01", end: "2026-10-07", now: new Date("2026-10-07T12:00:00Z") };
function dataset(patch: Partial<SearchConsoleDataset> = {}): SearchConsoleDataset {
  return { id: "current", label: "فایل واقعی", dimension: "page", periodStart: "2026-10-01", periodEnd: "2026-10-07", importedAt: "2026-10-07T12:00:00Z", rows: [{ id: "a", page: "https://example.test/a", clicks: 2, impressions: 100 }, { id: "b", page: "https://example.test/b", clicks: 3, impressions: 200 }], sourceRows: 2, ...patch };
}

describe("reusable local project playbooks", () => {
  it("offers the five project types and copies recipes between projects", () => {
    expect(PROJECT_PLAYBOOKS.map((recipe) => recipe.id)).toEqual(["ecommerce", "services", "local", "blog", "mixed"]);
    const first = findProjectPlaybook("ecommerce")!;
    const second = findProjectPlaybook("ecommerce")!;
    first.briefTemplate = "بریف اختصاصی";
    expect(second.briefTemplate).not.toBe(first.briefTemplate);
    expect(PROJECT_PLAYBOOKS[0].briefTemplate).toBe(second.briefTemplate);
    expect(Object.isFrozen(PROJECT_PLAYBOOKS[0])).toBe(true);
  });
  it("saves an independent custom recipe and finds its copied configuration", () => {
    const original = cloneProjectPlaybook(PROJECT_PLAYBOOKS[1]);
    const saved = createCustomPlaybook({ ...original, label: "خدمات خودم", audience: "مخاطب اختصاصی" });
    expect(saved.id).toMatch(/^custom-/);
    expect(saved.id).not.toBe(original.id);
    const found = findProjectPlaybook(saved.id, [saved])!;
    found.audience = "تغییر فقط در پروژه";
    expect(saved.audience).toBe("مخاطب اختصاصی");
    expect(findProjectPlaybook("missing")).toBeUndefined();
  });
  it("rejects malformed recipes and dangerous control characters without truncation", () => {
    expect(() => validateProjectPlaybook({ ...PROJECT_PLAYBOOKS[0], label: " " })).toThrow();
    expect(() => validateProjectPlaybook({ ...PROJECT_PLAYBOOKS[0], audience: 42 })).toThrow();
    expect(() => validateProjectPlaybook({ ...PROJECT_PLAYBOOKS[0], briefTemplate: "x".repeat(12001) })).toThrow();
    expect(() => validateProjectPlaybook({ ...PROJECT_PLAYBOOKS[0], groupingRules: "bad\u0000rule" })).toThrow();
    expect(validateProjectPlaybook({ ...PROJECT_PLAYBOOKS[0], unknown: "ignored" })).not.toHaveProperty("unknown");
  });
});

describe("reports use actual dates and recorded metrics", () => {
  it("defaults to the current Persian month, using Tehran's day", () => {
    expect(defaultReportPeriod(new Date("2026-10-06T21:00:00Z"))).toEqual({ start: "2026-09-23", end: "2026-10-07" });
    expect(validateReportPeriod({ start: "۱۴۰۵/۰۷/۰۹", end: "۱۴۰۵/۰۷/۱۵" })).toEqual({ start: "2026-10-01", end: "2026-10-07" });
    expect(() => validateReportPeriod({ start: "2026-10-08", end: "2026-10-07" })).toThrow();
    expect(() => validateReportPeriod({ start: "2026-02-30", end: "2026-10-07" })).toThrow();
  });
  it("matches a long imported period exactly without inventing partial-day metrics", () => {
    const source = project({ searchConsole: { current: dataset({ periodStart: "2026-09-10", periodEnd: "2026-10-07" }) } });
    expect(importedReportPeriod(source)).toEqual({ start: "2026-09-10", end: "2026-10-07" });
    expect(buildProjectReport(source, period).searchConsole).toBeUndefined();
    expect(buildProjectReport(source, { ...importedReportPeriod(source)!, now: period.now }).searchConsole?.clicks).toBe(5);
    expect(importedReportPeriod(project())).toBeUndefined();
    expect(importedReportPeriod(project({ searchConsole: { current: dataset({ periodStart: "invalid" }) } }))).toBeUndefined();
  });
  it("handles completion timestamps locally and rejects silently rolled invalid dates", () => {
    expect(reportDate("2026-10-06T21:00:00Z")).toBe("2026-10-07");
    expect(reportDate("۱۴۰۵/۰۷/۱۵")).toBe("2026-10-07");
    expect(reportDate("2026-02-30T12:00:00Z")).toBeNull();
    expect(reportDate("not a date")).toBeNull();
    for (const timestamp of ["2026-10-07T24:00:00Z", "2026-10-07T12:00:00", "2026-10-07T12:00:00+24:00", "2026-10-07T12:60:00Z"]) expect(reportDate(timestamp)).toBeNull();
    expect(reportDate("2026-10-07T00:30:00+03:30")).toBe("2026-10-07");
  });
  it("filters completed tasks and actual publication inclusively, never scheduled work", () => {
    const report = buildProjectReport(project({ tasks: [
      { id: "start", title: "اول بازه", status: "done", completedAt: period.start },
      { id: "end", title: "آخر بازه", status: "done", completedAt: period.end },
      { id: "old", title: "قدیمی", status: "done", completedAt: "2026-09-30" },
      { id: "open", title: "در جریان", status: "open", completedAt: period.start },
      { id: "undated", title: "بی‌تاریخ", status: "done" },
    ], content: [
      { id: "published", topic: "منتشرشده", writingStatus: "Published", publishDate: "2026-10-02" },
      { id: "scheduled", topic: "برنامه‌ریزی‌شده", writingStatus: "Ready", publishDate: "2026-10-02" },
      { id: "undated-content", topic: "انتشار بی‌تاریخ", writingStatus: "Published" },
    ] }), period);
    expect(new Set(report.events.map((event) => event.title))).toEqual(new Set(["اول بازه", "آخر بازه", "منتشرشده"]));
    expect(report.exclusions.undatedEvents).toBe(2);
    expect(report.nextSteps.some((step) => step.title === "در جریان")).toBe(true);
    expect(report.nextSteps.some((step) => step.title === "قدیمی")).toBe(false);
  });
  it("counts a linked publication once and takes the last manual snapshot per page", () => {
    const report = buildProjectReport(project({
      pages: [{ id: "page", target: "صفحه", status: "Published", publishDate: "2026-10-02" }],
      content: [{ id: "content", targetPage: "page", topic: "محتوا", writingStatus: "Published", publishDate: "2026-10-02" }],
      results: [
        { id: "older", pageId: "page", lastChecked: "2026-10-02", clicks: 10, impressions: 100 },
        { id: "latest", pageId: "page", lastChecked: "2026-10-06", clicks: 0, impressions: 0, ctr: 0, position: "", conversions: "" },
        { id: "outside", pageId: "page", lastChecked: "2026-10-08", clicks: 99 },
        { id: "undated", clicks: 7, baselineDate: "2026-10-03" },
        { id: "empty", lastChecked: "2026-10-04", clicks: "", impressions: "" },
      ],
    }), period);
    expect(report.events).toHaveLength(1);
    expect(report.metrics).toHaveLength(1);
    expect(report.metrics[0]).toMatchObject({ id: "latest", clicks: 0, impressions: 0, ctr: 0, position: undefined, conversions: undefined });
    expect(report.exclusions.undatedMetrics).toBe(1);
    expect(reportHtml(report)).toContain("این اعداد جمع عملکرد دوره نیستند");
  });
  it("selects the real latest same-day timestamp independently of row IDs and input order", () => {
    const rows = [
      { id: "z-older", pageId: "page", lastChecked: "2026-10-06T22:00:00Z", clicks: 1 },
      { id: "a-latest", pageId: "page", lastChecked: "2026-10-07T08:00:00+03:30", clicks: 2 },
    ];
    for (const results of [rows, [...rows].reverse()]) {
      const report = buildProjectReport(project({ results }), period);
      expect(report.metrics[0]).toMatchObject({ id: "a-latest", date: "2026-10-07", clicks: 2 });
    }
  });
  it("keeps private notes out by default and includes only selected period records when chosen", () => {
    const source = project({ tasks: [
      { id: "in", title: "کار", status: "done", completedAt: "2026-10-03", notes: "راز این دوره" },
      { id: "old", title: "قدیمی", status: "done", completedAt: "2026-09-01", notes: "راز دوره قبل" },
    ], results: [
      { id: "old-snapshot", pageId: "page", lastChecked: "2026-10-02", clicks: 1, notes: "راز سنجش قدیمی" },
      { id: "new-snapshot", pageId: "page", lastChecked: "2026-10-04", clicks: 2, notes: "راز سنجش منتخب" },
    ] });
    const privateReport = buildProjectReport(source, period);
    expect(privateReport.privateNotes).toHaveLength(0);
    expect(reportHtml(privateReport)).not.toContain("راز");
    expect(reportCsv(privateReport)).not.toContain("راز");
    const selected = buildProjectReport(source, { ...period, includePrivateNotes: true });
    expect(selected.privateNotes.map((note) => note.text)).toEqual(["راز این دوره", "راز سنجش منتخب"]);
  });
  it("reports only one fully contained Search Console dataset and calculates weighted CTR", () => {
    const report = buildProjectReport(project({ searchConsole: { current: dataset(), previous: dataset({ id: "previous", rows: [{ id: "z", clicks: 999, impressions: 9999 }] }) } }), period);
    expect(report.searchConsole).toMatchObject({ clicks: 5, impressions: 300, ctr: 5 / 300 * 100, rowCount: 2 });
    expect(report.searchConsole?.clicks).not.toBe(1004);
    expect(reportHtml(report)).toContain("پوشش کامل سایت");
  });
  it("does not prorate partially overlapping periods or pretend the chosen dates change source coverage", () => {
    const report = buildProjectReport(project({ searchConsole: { current: dataset({ periodStart: "2026-09-01", periodEnd: "2026-10-07" }) } }), period);
    expect(report.searchConsole).toBeUndefined();
    expect(report.exclusions.searchConsoleOutsidePeriod).toBe(1);
    const previous = buildProjectReport(project({ searchConsole: { current: dataset({ periodStart: "2026-09-01" }), previous: dataset({ id: "previous", label: "دوره منطبق", periodStart: "2026-10-02", periodEnd: "2026-10-05" }) } }), period);
    expect(previous.searchConsole?.label).toBe("دوره منطبق");
    expect(previous.searchConsole?.periodStart).toBe("2026-10-02");
  });
});

describe("portable report exports", () => {
  it("escapes every project string and includes no scripts, external styles or font URLs", () => {
    const hostile = '</style><script>alert(1)</script><img src="https://evil.test/x">';
    const report = buildProjectReport(project({ name: hostile, domain: hostile, goal: hostile, tasks: [{ id: "x", title: hostile, status: "done", completedAt: "2026-10-03", notes: hostile }] }), { ...period, preparedBy: hostile, includePrivateNotes: true });
    const html = reportHtml(report);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<script\b|<img\b|<link\b|<iframe\b/i);
    expect(html).not.toMatch(/@import|url\(/i);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("۱۴۰۵");
    expect(html).not.toContain("2026-10-03");
  });
  it("guards spreadsheet formula injection including whitespace prefixes and quotes multiline text", () => {
    for (const value of ["=HYPERLINK(\"x\")", " +SUM(A1)", "\t@cmd", "\r\n-1+2"]) expect(safeReportCsvCell(value)).toMatch(/^"'/);
    expect(safeReportCsvCell('line "one"\nline two')).toBe('"line ""one""\nline two"');
    const csv = reportCsv(buildProjectReport(project({ name: '=HYPERLINK("evil")' }), period));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""evil"")"');
    expect(csv).toContain("۱۴۰۵/۰۷/۰۹");
  });
  it("uses Shamsi filenames and strips characters that prevent a real Windows download", () => {
    const report = buildProjectReport(project({ name: 'A/B:C*D?"<>|\u0000.' }), period);
    const filename = reportFileName(report, "html");
    expect(filename).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/);
    expect(filename).toContain("1405-07-09-1405-07-15.html");
    expect(filename).not.toContain("2026");
  });
});
