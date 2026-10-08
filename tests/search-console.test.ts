import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/domain";
import {
  aggregateSearchConsoleRows, buildSearchConsoleInsights, createSearchConsoleDataset,
  detectSearchConsoleMapping, normalizeSearchConsoleUrl, parseSearchConsoleNumber,
  prepareSearchConsoleImport, searchConsoleComparisonReason, searchConsolePageId,
  searchConsoleDatasetCsv, searchConsoleInsightSource, searchConsolePeriodDays, validateSearchConsoleData,
} from "../src/search-console";
import type { SearchConsoleDataset, SearchConsoleRow } from "../src/search-console";

const row = (overrides: Partial<SearchConsoleRow> = {}): SearchConsoleRow => ({ id: "r", page: "https://example.com/camera", clicks: 10, impressions: 1000, position: 5, ...overrides });
const dataset = (overrides: Partial<SearchConsoleDataset> = {}): SearchConsoleDataset => ({ id: "d", label: "GSC export", importedAt: "2026-10-07T10:00:00Z", periodStart: "2026-09-01", periodEnd: "2026-09-28", dimension: "page", rows: [row()], sourceRows: 1, ...overrides });
const previous = (overrides: Partial<SearchConsoleDataset> = {}) => dataset({ id: "old", periodStart: "2026-08-01", periodEnd: "2026-08-28", rows: [row({ clicks: 100 })], ...overrides });
const preview = (data: string[][]) => prepareSearchConsoleImport(data, detectSearchConsoleMapping(data[0]));

describe("local Search Console import and evidence", () => {
  it("recognizes Google's usual page/query headers and Persian exports", () => {
    expect(detectSearchConsoleMapping(["Top queries", "Clicks", "Impressions", "CTR", "Position"])).toEqual({ query: 0, clicks: 1, impressions: 2, ctr: 3, position: 4 });
    expect(detectSearchConsoleMapping(["نشانی صفحه", "کلیک", "نمایش", "میانگین جایگاه", "کشور"])).toEqual({ page: 0, clicks: 1, impressions: 2, position: 3, country: 4 });
  });
  it("strictly parses Latin, Persian and Arabic digits without inventing bad metrics", () => {
    expect(parseSearchConsoleNumber("۱٬۲۳۴", true)).toBe(1234);
    expect(parseSearchConsoleNumber("١٢٫٥")).toBe(12.5);
    expect(parseSearchConsoleNumber("1 000", true)).toBe(1000);
    for (const value of ["1,2", "10,00", "-5", "+2", "1e5", "Infinity", "NaN", "2k", "", "3.5.4", "۵ درصد"]) expect(parseSearchConsoleNumber(value)).toBeNull();
    expect(parseSearchConsoleNumber("1.5", true)).toBeNull();
  });
  it("round-trips app CSV exports with only their real dimensions and preserves device/country", () => {
    for (const dimension of ["page", "query", "query-page"] as const) {
      const original = row({ query: dimension === "page" ? undefined : "دوربین", page: dimension === "query" ? undefined : "https://example.com/camera", device: "mobile", country: "ir" });
      const source = dataset({ dimension, rows: [original] });
      const csv = searchConsoleDatasetCsv(source), matrix = parseCsv(csv);
      const imported = preview(matrix);
      expect(imported.errorCount).toBe(0);
      expect(imported.dimension).toBe(dimension);
      expect(imported.rows[0]).toMatchObject({ clicks: original.clicks, impressions: original.impressions, position: original.position, device: "mobile", country: "ir" });
      expect(imported.rows[0].query).toBe(original.query);
      expect(imported.rows[0].page).toBe(original.page);
      expect(csv).toContain("۱۴۰۵");
      expect(csv).not.toContain("2026-09-01");
    }
  });
  it("reimports safe aggregated large counts and tiny CTR without scientific notation", () => {
    const source = dataset({ rows: [row({ clicks: 1, impressions: Number.MAX_SAFE_INTEGER })] });
    const matrix = parseCsv(searchConsoleDatasetCsv(source));
    expect(matrix[1][3]).not.toMatch(/e[-+]/i);
    const imported = preview(matrix);
    expect(imported.errorCount).toBe(0);
    expect(imported.rows[0].impressions).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseSearchConsoleNumber(String(Number.MAX_SAFE_INTEGER + 1), true)).toBeNull();
  });
  it("guards CSV formulas after control characters in untrusted GSC strings", () => {
    const csv = searchConsoleDatasetCsv(dataset({ dimension: "query", rows: [row({ page: undefined, query: '\u0000=HYPERLINK("https://evil.test")' })] }));
    expect(csv).toContain('"\'\u0000=HYPERLINK(""https://evil.test"")"');
  });
  it("aggregates duplicate dimension rows using impressions to weight position and derives CTR", () => {
    const parsed = preview([["Page", "Clicks", "Impressions", "CTR", "Position"], ["https://example.com/a/", "10", "100", "10%", "2"], ["https://example.com/a", "20", "900", "2.22%", "10"]]);
    expect(parsed.errorCount).toBe(0); expect(parsed.dimension).toBe("page"); expect(parsed.rows).toHaveLength(1); expect(parsed.sourceRows).toBe(2);
    expect(parsed.rows[0]).toMatchObject({ page: "https://example.com/a", clicks: 30, impressions: 1000, position: 9.2 });
    expect(parsed.rows[0].clicks / parsed.rows[0].impressions).toBe(0.03);
    expect(parsed.rows[0]).not.toHaveProperty("ctr");
  });
  it("rejects unsafe preview totals for duplicate and distinct exported rows", () => {
    for (const duplicate of [true, false]) {
      const parsed = preview([["Query", "Clicks", "Impressions"], ...Array.from({ length: 9008 }, (_, index) => [duplicate ? "same-query" : `query-${index}`, "1000000000000", "1000000000000"])]);
      expect(parsed.errorCount).toBe(1);
      expect(parsed.errors[0].message).toMatch(/مجموع کلیک یا نمایش.*ظرفیت عددی/);
      expect(parsed.rows).toEqual([]);
      expect(() => createSearchConsoleDataset(parsed, { periodStart: "2026-09-01", periodEnd: "2026-09-28", label: "overflow" })).toThrow(/خطاهای پیش‌نمایش/);
    }
  });
  it("preserves exact safe integer totals and rejects the first overflowing count", () => {
    const maximum = row({ clicks: Number.MAX_SAFE_INTEGER, impressions: Number.MAX_SAFE_INTEGER });
    expect(aggregateSearchConsoleRows([maximum, row({ clicks: 0, impressions: 0 })])[0].clicks).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => aggregateSearchConsoleRows([maximum, row({ clicks: 1, impressions: 1 })])).toThrow(/ظرفیت عددی/);
    expect(() => aggregateSearchConsoleRows([maximum, row({ page: "https://example.com/other", clicks: 0, impressions: 1 })])).toThrow(/ظرفیت عددی/);
  });
  it("does not average a partly missing position into a falsely precise result", () => {
    const rows = aggregateSearchConsoleRows([row({ impressions: 100, position: 2 }), row({ impressions: 900, position: undefined })]);
    expect(rows[0].position).toBeUndefined();
    expect(rows[0].impressions).toBe(1000);
  });
  it("preserves query/page, device and country as separate aggregation dimensions", () => {
    const parsed = preview([["Query", "Page", "Clicks", "Impressions", "Device", "Country"], ["دوربین", "https://example.com/a", "1", "10", "MOBILE", "IR"], ["دوربین", "https://example.com/a", "2", "20", "desktop", "ir"], ["دوربین", "https://example.com/a", "3", "30", "mobile", "us"], ["دوربین", "https://example.com/b", "4", "40", "mobile", "ir"]]);
    expect(parsed.rows).toHaveLength(4); expect(parsed.dimension).toBe("query-page");
    expect(parsed.rows[0]).toMatchObject({ query: "دوربین", device: "mobile", country: "ir" });
  });
  it("rejects the complete import until every invalid number is corrected", () => {
    const parsed = preview([["Query", "Clicks", "Impressions", "Position"], ["valid", "1", "100", "5"], ["broken", "1x", "100", "5"], ["invalid", "101", "100", "5"], ["fraction", "1.2", "100", "5"], ["rank", "1", "100", "0"]]);
    expect(parsed.errorCount).toBe(4); expect(parsed.rows).toHaveLength(1);
    expect(() => createSearchConsoleDataset(parsed, { periodStart: "2026-09-01", periodEnd: "2026-09-28", label: "test" })).toThrow(/خطاهای/);
  });
  it("requires a real dimension and metrics and rejects reused mapping columns", () => {
    expect(prepareSearchConsoleImport([["Clicks", "Impressions"], ["1", "5"]], { clicks: 0, impressions: 1 }).errorCount).toBe(1);
    expect(prepareSearchConsoleImport([["Query", "Clicks"], ["a", "1"]], { query: 0, clicks: 1, impressions: 1 }).errorCount).toBe(1);
    expect(preview([["Date", "Clicks", "Impressions"], ["2026-09-01", "1", "10"]]).errorCount).toBeGreaterThan(0);
    const wide = prepareSearchConsoleImport([["Query", "Clicks", "Impressions", ...Array.from({ length: 62 }, () => "unused")], ["a", "1", "10"]], { query: 0, clicks: 1, impressions: 2 });
    expect(wide.rows).toEqual([]);
    expect(wide.errors[0].message).toMatch(/۶۴ ستون/);
  });
  it("checks page URLs and keeps domains, protocols and search parameters distinct", () => {
    const pages = [{ id: "camera", url: "https://example.com/camera/" }, { id: "foreign", url: "https://other.com/camera" }];
    expect(searchConsolePageId(pages, "https://example.com/camera")).toBe("camera");
    expect(searchConsolePageId(pages, "http://example.com/camera")).toBeUndefined();
    expect(searchConsolePageId(pages, "https://example.com/camera?variant=1")).toBeUndefined();
    expect(normalizeSearchConsoleUrl("javascript:alert(1)")).toBe("");
    expect(normalizeSearchConsoleUrl("https://user:password@example.com/a")).toBe("");
    expect(searchConsolePageId([...pages, { id: "duplicate", url: pages[0].url }], pages[0].url)).toBeUndefined();
    expect(preview([["Page", "Clicks", "Impressions"], ["/camera", "1", "10"]]).errorCount).toBe(1);
  });
  it("requires explicit valid periods and preserves only ISO dates in storage", () => {
    const parsed = preview([["Query", "Clicks", "Impressions"], ["دوربین", "10", "100"]]);
    expect(() => createSearchConsoleDataset(parsed, { periodStart: "", periodEnd: "", label: "export" })).toThrow(/شروع/);
    expect(searchConsolePeriodDays({ periodStart: "2026-02-30", periodEnd: "2026-03-01" })).toBe(0);
    expect(searchConsolePeriodDays({ periodStart: "2026-10-07", periodEnd: "2026-10-06" })).toBe(0);
    const imported = createSearchConsoleDataset(parsed, { periodStart: "2026-09-01", periodEnd: "2026-09-28", label: "export" });
    expect(imported.id).toBeTruthy(); expect(imported.periodStart).toBe("2026-09-01"); expect(searchConsolePeriodDays(imported)).toBe(28);
  });
  it("validates safe counts across all dataset rows before exposing totals", () => {
    const maximum = row({ id: "maximum", clicks: Number.MAX_SAFE_INTEGER, impressions: Number.MAX_SAFE_INTEGER });
    expect(() => validateSearchConsoleData({ current: dataset({ rows: [maximum] }) })).not.toThrow();
    expect(() => validateSearchConsoleData({ current: dataset({ rows: [maximum, row({ id: "extra", clicks: 1, impressions: 1 })], sourceRows: 2 }) })).toThrow(/ظرفیت عددی/);
    expect(() => validateSearchConsoleData({ current: dataset({ rows: [maximum, row({ id: "extra", clicks: 0, impressions: 1 })], sourceRows: 2 }) })).toThrow(/ظرفیت عددی/);
    for (const invalid of [row({ clicks: 1.5 }), row({ clicks: -1 }), row({ clicks: 1001 }), row({ impressions: Number.MAX_SAFE_INTEGER + 1 })]) {
      expect(() => validateSearchConsoleData({ current: dataset({ rows: [invalid] }) })).toThrow(/کلیک و نمایش/);
    }
  });
  it("rejects declared dimensions that contradict the actual row fields", () => {
    const invalid = [
      dataset({ rows: [row({ query: "unexpected query" })] }),
      dataset({ rows: [row({ query: "" })] }),
      dataset({ dimension: "query", rows: [row({ query: "camera" })] }),
      dataset({ dimension: "query", rows: [row({ query: "camera", page: "" })] }),
      dataset({ dimension: "query-page", rows: [row()] }),
      dataset({ dimension: "query-page", rows: [row({ query: "camera", page: undefined })] }),
      dataset({ rows: [row({ page: "javascript:alert(1)" })] }),
    ];
    for (const current of invalid) expect(() => validateSearchConsoleData({ current })).toThrow(/نوع داده.*همخوان/);
    expect(() => validateSearchConsoleData({ current: dataset({ dimension: "query", rows: [row({ page: undefined, query: "camera" })] }) })).not.toThrow();
    expect(() => validateSearchConsoleData({ current: dataset({ dimension: "query-page", rows: [row({ query: "camera" })] }) })).not.toThrow();
    const forgedPreview = { rows: [row({ query: "camera" })], dimension: "page" as const, errors: [], errorCount: 0, sourceRows: 1, skipped: 0 };
    expect(() => createSearchConsoleDataset(forgedPreview, { periodStart: "2026-09-01", periodEnd: "2026-09-28", label: "wrong dimension" })).toThrow(/نوع داده.*همخوان/);
  });
  it("compares only aligned periods with identical exported dimensions and filters", () => {
    expect(searchConsoleComparisonReason(dataset(), previous())).toBeNull();
    expect(searchConsoleComparisonReason(dataset(), previous({ dimension: "query" }))).toMatch(/نوع داده/);
    expect(searchConsoleComparisonReason(dataset(), previous({ periodEnd: "2026-08-29" }))).toMatch(/طول/);
    expect(searchConsoleComparisonReason(dataset(), previous({ periodStart: "2026-09-01", periodEnd: "2026-09-28" }))).toMatch(/همپوشانی/);
    expect(searchConsoleComparisonReason(dataset({ sourceFilters: "mobile" }), previous({ sourceFilters: "desktop" }))).toMatch(/فیلتر/);
    expect(searchConsoleComparisonReason(dataset({ sourceFilters: "Page: /Products" }), previous({ sourceFilters: "Page: /products" }))).toMatch(/فیلتر/);
    expect(searchConsoleComparisonReason(dataset({ rows: [row({ device: "mobile" })] }), previous())).toMatch(/ستون/);
  });
  it("builds evidence-based CTR, rank and decline opportunities with stable IDs and real page links", () => {
    const project = { pages: [{ id: "p", url: "https://example.com/camera/" }], searchConsole: { current: dataset(), previous: previous() } };
    const insights = buildSearchConsoleInsights(project);
    expect(insights.map((insight) => insight.kind).sort()).toEqual(["decline", "low-ctr", "near-first-page"]);
    expect(insights.every((insight) => insight.pageId === "p")).toBe(true);
    const decline = insights.find((insight) => insight.kind === "decline")!;
    expect(decline.evidence).toMatchObject({ previousClicks: 100, clickChange: -90, ctr: .01, periodStart: "2026-09-01" });
    expect(buildSearchConsoleInsights(project).map((insight) => insight.id)).toEqual(insights.map((insight) => insight.id));
  });
  it("does not claim page attribution or cannibalization from separate query exports", () => {
    const project = { pages: [{ id: "p", pkw: "دوربین", url: "https://example.com/camera" }], searchConsole: { current: dataset({ dimension: "query", rows: [row({ page: undefined, query: "دوربین" })] }), previous: previous({ dimension: "page" }) } };
    const insights = buildSearchConsoleInsights(project);
    expect(insights.every((insight) => !insight.pageId && !insight.url)).toBe(true);
    expect(insights.some((insight) => insight.kind === "query-page-overlap" || insight.kind === "decline")).toBe(false);
  });
  it("flags overlap only from real joint data in matching device/country cohorts", () => {
    const current = dataset({ dimension: "query-page", sourceRows: 3, rows: [row({ id: "a", query: "دوربین", page: "https://example.com/a", device: "mobile" }), row({ id: "b", query: "دوربین", page: "https://example.com/b", device: "mobile" }), row({ id: "c", query: "دوربین", page: "https://example.com/c", device: "desktop" })] });
    const overlap = buildSearchConsoleInsights({ pages: [], searchConsole: { current } }).filter((insight) => insight.kind === "query-page-overlap");
    expect(overlap).toHaveLength(1); expect(overlap[0].evidence.urls).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(overlap[0].reason).toMatch(/به‌تنهایی اثبات/);
    const reordered = buildSearchConsoleInsights({ pages: [], searchConsole: { current: { ...current, rows: [...current.rows].reverse() } } }).filter((insight) => insight.kind === "query-page-overlap");
    expect(reordered[0].id).toBe(overlap[0].id);
  });
  it("scopes generated tasks to the actual period so prior completed tasks do not hide future work", () => {
    const first = buildSearchConsoleInsights({ pages: [], searchConsole: { current: dataset() } })[0];
    const later = buildSearchConsoleInsights({ pages: [], searchConsole: { current: dataset({ periodStart: "2026-10-01", periodEnd: "2026-10-28" }) } })[0];
    expect(first.id).toBe(later.id);
    expect(searchConsoleInsightSource(first)).not.toBe(searchConsoleInsightSource(later));
    const filtered = buildSearchConsoleInsights({ pages: [], searchConsole: { current: dataset({ sourceFilters: "web, mobile" }) } })[0];
    const otherFilter = buildSearchConsoleInsights({ pages: [], searchConsole: { current: dataset({ sourceFilters: "images, mobile" }) } })[0];
    expect(searchConsoleInsightSource(first)).not.toBe(searchConsoleInsightSource(filtered));
    expect(searchConsoleInsightSource(filtered)).not.toBe(searchConsoleInsightSource(otherFilter));
  });
  it("never invents declines for censored or missing rows, zero baselines or mismatched filters", () => {
    expect(buildSearchConsoleInsights({ pages: [], searchConsole: { current: dataset(), previous: previous({ rows: [row({ page: "https://example.com/other" })] }) } }).some((insight) => insight.kind === "decline")).toBe(false);
    expect(buildSearchConsoleInsights({ pages: [], searchConsole: { current: dataset(), previous: previous({ rows: [row({ clicks: 0 })] }) } }).some((insight) => insight.kind === "decline")).toBe(false);
    expect(buildSearchConsoleInsights({ pages: [], searchConsole: { current: dataset(), previous: previous({ sourceFilters: "web, IR" }) } }).some((insight) => insight.kind === "decline")).toBe(false);
    expect(buildSearchConsoleInsights({ pages: [], searchConsole: { current: dataset({ rows: [row({ clicks: 0, impressions: 0, position: 0 })] }) } })).toEqual([]);
  });
  it("bounds datasets, preview errors and the number of displayed opportunities", () => {
    const matrix = [["Query", "Clicks", "Impressions", "Position"], ...Array.from({ length: 20_000 }, (_, i) => [`query-${i}`, "1", "1000", "5"])];
    const parsed = preview(matrix); expect(parsed.errorCount).toBe(0); expect(parsed.rows).toHaveLength(20_000);
    const current = createSearchConsoleDataset(parsed, { label: "large", periodStart: "2026-09-01", periodEnd: "2026-09-28" });
    expect(buildSearchConsoleInsights({ pages: [], searchConsole: { current } })).toHaveLength(100);
    const oversize = preview([...matrix, ["extra", "1", "1000", "5"]]); expect(oversize.errorCount).toBe(1);
    expect(() => validateSearchConsoleData({ current: dataset({ rows: Array.from({ length: 20_001 }, (_, i) => row({ id: String(i) })), sourceRows: 20_001 }) })).toThrow(/۲۰٬۰۰۰/);
    const bad = preview([["Query", "Clicks", "Impressions"], ...Array.from({ length: 100 }, () => ["a", "invalid", "1"])]);
    expect(bad.errorCount).toBe(100); expect(bad.errors).toHaveLength(12);
  });
  it("counts UTF-8 bytes across both periods, including Persian text", () => {
    const rows = Array.from({ length: 4000 }, (_, i) => row({ id: String(i), query: `${i}${"ک".repeat(700)}` }));
    expect(() => validateSearchConsoleData({ current: dataset({ dimension: "query-page", rows, sourceRows: rows.length }) })).toThrow(/۵ مگابایت/);
  });
  it("matches 20000 imported pages against 2000 planned pages with a URL index", () => {
    const pages = Array.from({ length: 2000 }, (_, index) => ({ id: `page-${index}`, url: `https://example.com/page-${index}/` }));
    const current = dataset({ rows: Array.from({ length: 20_000 }, (_, index) => row({ id: `row-${index}`, page: `https://example.com/page-${index}` })), sourceRows: 20_000 });
    const start = performance.now();
    const insights = buildSearchConsoleInsights({ pages, searchConsole: { current } });
    expect(insights).toHaveLength(100);
    for (const insight of insights) if (insight.pageId) expect(insight.url).toBe(`https://example.com/${insight.pageId}`);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
