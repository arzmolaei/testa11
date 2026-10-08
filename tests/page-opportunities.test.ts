import { describe, expect, it } from "vitest";
import { createProject } from "../src/domain";
import { analyzePageCandidates, buildPagePlan } from "../src/page-intelligence";
import { assessPageOpportunities, keywordMetric } from "../src/page-opportunities";
import type { Project, Row } from "../src/types";
function fixture(rows: Row[]): Project { return { ...createProject("هدف‌گذاری"), domain: "https://example.test", keywords: rows }; }
function evidence(project: Project, rows: { id: string; query: string; page: string; clicks: number; impressions: number }[]) {
  project.searchConsole = { current: { id: "gsc", label: "دوره", dimension: "query-page", importedAt: "2026-10-08T08:00:00.000Z", periodStart: "2026-09-01", periodEnd: "2026-09-30", sourceRows: rows.length, rows } };
}
describe("local targeting opportunities", () => {
  it("uses recorded qualitative difficulty without inventing a numeric Google KD", () => {
    const p = fixture([{ id: "a", keyword: "خرید دوربین", kd: "آسان" }, { id: "b", keyword: "قیمت دوربین", kd: "متوسط" }]);
    const result = [...assessPageOpportunities(p, analyzePageCandidates(p)).values()][0];
    expect(result).toMatchObject({ difficulty: null, difficultyLabel: "متوسط" });
    expect(result.reasons.join(" ")).toContain("به عدد فرضی تبدیل نشده");
  });
  it("keeps missing metrics distinct from zero and accepts Persian numbers", () => {
    expect(keywordMetric("")).toBeNull(); expect(keywordMetric(undefined)).toBeNull(); expect(keywordMetric("نامشخص")).toBeNull();
    expect(keywordMetric("۰")).toBe(0); expect(keywordMetric("۱٬۲۵۰")).toBe(1250); expect(keywordMetric("۳۲٫۵", 100)).toBe(32.5);
    expect(keywordMetric(101, 100)).toBeNull(); expect(keywordMetric(-1)).toBeNull();
    const p = fixture([{ id: "a", keyword: "خرید دوربین" }, { id: "b", keyword: "قیمت دوربین", volume: 0, kd: 0 }]);
    const result = [...assessPageOpportunities(p, analyzePageCandidates(p)).values()][0];
    expect(result).toMatchObject({ volume: 0, knownVolume: 1, difficulty: 0, coverage: "new", unassigned: 2 });
  });
  it("distinguishes extending existing pages from covered work and broken references", () => {
    const p = fixture([{ id: "a", keyword: "خرید دوربین", targetPage: "page" }, { id: "b", keyword: "قیمت دوربین" }]);
    p.pages = [{ id: "page", pkw: "دوربین", pageType: "دسته‌بندی محصول" }];
    const merged = () => [{ ...analyzePageCandidates(p)[0], keywordIds: ["a", "b"] }];
    let candidates = merged(), result = [...assessPageOpportunities(p, candidates).values()][0];
    expect(result).toMatchObject({ coverage: "extend", suggestedTarget: "page", unassigned: 1 });
    p.keywords[1].targetPage = "page";
    candidates = merged(); result = [...assessPageOpportunities(p, candidates).values()][0];
    expect(result.coverage).toBe("covered");
    p.keywords[1].targetPage = "deleted";
    result = [...assessPageOpportunities(p, merged()).values()][0];
    expect(result.coverage).toBe("conflict"); expect(result.suggestedTarget).toBeUndefined();
  });
  it("deduplicates identical phrases and uses only the current imported period", () => {
    const p = fixture([{ id: "a", keyword: "خرید دوربین", volume: 100, kd: 25 }, { id: "b", keyword: "خرید دوربین", volume: 200, kd: 25 }]);
    evidence(p, [{ id: "e", query: "خرید دوربین", page: "https://example.test/camera", clicks: 8, impressions: 150 }]);
    p.searchConsole!.previous = { ...p.searchConsole!.current!, id: "old", rows: [{ id: "old", query: "خرید دوربین", page: "https://example.test/camera", clicks: 1000, impressions: 50000 }] };
    const result = [...assessPageOpportunities(p, analyzePageCandidates(p)).values()][0];
    expect(result).toMatchObject({ volume: 200, knownVolume: 1, difficulty: 25, gsc: { clicks: 8, impressions: 150, queries: 1, periodStart: "2026-09-01" } });
  });
  it("suggests a known page from exact imported query evidence without changing manual values", () => {
    const p = fixture([{ id: "a", keyword: "خرید دوربین", notes: "دستی", volume: 200 }]);
    p.pages = [{ id: "page", pkw: "تجهیزات امنیتی", url: "/camera/", priority: "P0", proposedTitle: "عنوان دستی" }];
    evidence(p, [{ id: "e", query: "خرید دوربین", page: "https://example.test/camera/", clicks: 10, impressions: 400 }]);
    const candidates = analyzePageCandidates(p), result = assessPageOpportunities(p, candidates).get(candidates[0].id)!;
    expect(result).toMatchObject({ coverage: "extend", suggestedTarget: "page" });
    const plan = buildPagePlan(p, candidates, [{ candidateId: candidates[0].id, targetPageId: result.suggestedTarget, priority: "P1" }], { createBriefs: true });
    expect(plan.createdPages).toBe(0); expect(plan.project.pages[0]).toMatchObject({ priority: "P0", proposedTitle: "عنوان دستی" });
    expect(plan.project.keywords[0]).toMatchObject({ notes: "دستی", targetPage: "page" });
  });
  it("requires review for ambiguous query-page evidence even with a selected target", () => {
    const p = fixture([{ id: "a", keyword: "خرید دوربین" }]);
    p.pages = [{ id: "page", pkw: "تجهیزات", url: "/camera" }];
    evidence(p, [{ id: "e1", query: "خرید دوربین", page: "https://example.test/camera", clicks: 10, impressions: 400 }, { id: "e2", query: "خرید دوربین", page: "https://example.test/another", clicks: 0, impressions: 5 }]);
    const candidates = analyzePageCandidates(p), result = assessPageOpportunities(p, candidates, { [candidates[0].id]: { targetPageId: "page" } }).get(candidates[0].id)!;
    expect(result.coverage).toBe("conflict"); expect(result.suggestedTarget).toBeUndefined();
    expect(result.reasons.join(" ")).toContain("بررسی");
  });
});
