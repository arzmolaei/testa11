import { describe, expect, it } from "vitest";
import { analyzePageRelationships, buildBrief, canonicalPageUrl, getContentReadiness, getProjectActions } from "../src/workflow";
import type { Project, Row } from "../src/types";

const project = (patch: Partial<Project> = {}): Project => ({ id: "project", name: "پروژه", domain: "example.com", market: "خریدار دوربین", language: "fa", projectType: "Ecommerce", goal: "خرید محصول", startDate: "", lastReview: "", keywords: [], pages: [], content: [], results: [], ...patch });
const page = (id: string, patch: Partial<Row> = {}): Row => ({ id, target: `صفحه ${id}`, pkw: "دوربین مداربسته", pageType: "دسته‌بندی محصول", existing: "Existing", url: `https://example.com/${id}/`, ...patch });

describe("local project workflow", () => {
  it("finds groups missing a target without treating excluded keywords as work", () => {
    const p = project({ keywords: [ { id: "keyword1", keyword: "خرید دوربین داهوا", group: "داهوا", intent: "تراکنشی", decision: "Keep" }, { id: "keyword2", keyword: "حذف", group: "حذف", decision: "Exclude" } ] });
    const actions = getProjectActions(p, "2026-10-07");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ view: "keywords", keywordId: "keyword1", priority: "P1" });
    const linked = project({ ...p, pages: [page("page1", { pkw: "خرید دوربین داهوا" })] });
    expect(getProjectActions(linked).some((action) => action.id.startsWith("group:"))).toBe(false);
  });

  it("does not treat a broad topic cluster as proof that every intent already has a target", () => {
    const p = project({ keywords: [{ id: "purchase", keyword: "خرید دوربین داهوا", group: "دوربین", intent: "تراکنشی" }], pages: [page("training", { cluster: "دوربین", pkw: "آموزش نصب دوربین داهوا", pageType: "مقاله" })] });
    expect(getProjectActions(p).find((action) => action.id.startsWith("group:"))).toMatchObject({ keywordId: "purchase", view: "keywords" });
  });

  it("uses stable page and content ids and distinguishes overdue publication from already published content", () => {
    const p = project({ pages: [page("stable-id", { pageId: "P-999" })], content: [ { id: "content1", targetPage: "stable-id", topic: "راهنما", publishDate: "2026-10-06", writingStatus: "Writing" }, { id: "content2", topic: "منتشرشده", publishDate: "2026-10-01", writingStatus: "Published" } ] });
    const action = getProjectActions(p, "2026-10-07").find((item) => item.id === "content:content1:overdue");
    expect(action).toMatchObject({ pageId: "stable-id", contentId: "content1", view: "content" });
    expect(getProjectActions(p, "2026-10-07").some((item) => item.id.includes("content2"))).toBe(false);
  });

  it("honors completed, dismissed and open tracked suggestions and restores them after task deletion", () => {
    const p = project({ pages: [page("a")] });
    const id = getProjectActions(p).find((item) => item.id.endsWith(":brief"))!.id;
    for (const status of ["open", "done", "dismissed"]) expect(getProjectActions({ ...p, tasks: [{ id: "task", title: "کار", source: id, status }] }).some((item) => item.id === id)).toBe(false);
    expect(getProjectActions({ ...p, tasks: [] }).some((item) => item.id === id)).toBe(true);
  });

  it("requires an actually ready brief and accepts registered source sections without inventing content", () => {
    const p = project({ pages: [page("a", { mainSections: "معیارهای انتخاب" })] });
    const content = { id: "c", targetPage: "a", topic: "انتخاب", contentType: "Buying Guide", briefStatus: "Review" };
    expect(getContentReadiness(p, content)).toEqual({ ready: false, missing: ["بازبینی و تأیید بریف"] });
    expect(getContentReadiness(p, { ...content, briefStatus: "Brief Ready" }).ready).toBe(true);
    expect(getContentReadiness(p, { ...content, targetPage: "deleted" }).missing).toContain("صفحهٔ هدف معتبر");
  });

  it("flags substantial recorded decline while preserving real zero and missing values", () => {
    const p = project({ pages: [page("a")], results: [ { id: "r1", pageId: "a", previousClicks: 100, clicks: 0 }, { id: "r2", previousClicks: 100 }, { id: "r3", previousClicks: 0, clicks: 0 }, { id: "r4", previousClicks: 100, clicks: 90 } ] });
    const actions = getProjectActions(p).filter((item) => item.id.startsWith("result:"));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ pageId: "a", view: "results" });
    expect(actions[0].reason).toContain("هم‌طول‌بودن");
  });

  it("uses the newest recorded result and resolves legacy page display codes", () => {
    const p = project({ pages: [page("stable", { pageId: "P-001" })], results: [
      { id: "old", pageId: "P-001", lastChecked: "2026-09-01", previousClicks: 100, clicks: 0, result: "Dropping" },
      { id: "latest", pageId: "stable", lastChecked: "2026-10-07", previousClicks: 100, clicks: 120 },
    ] });
    expect(getProjectActions(p).filter((action) => action.id.startsWith("result:"))).toEqual([]);
    p.results.push({ id: "new-decline", pageId: "P-001", lastChecked: "2026-10-08", previousClicks: 120, clicks: 0 });
    expect(getProjectActions(p).filter((action) => action.id.startsWith("result:"))).toEqual([expect.objectContaining({ id: "result:stable:decline", pageId: "stable", view: "results" })]);
  });

  it("builds an editable source-based scaffold using project playbook and existing outline, FAQ and CTA", () => {
    const p = project({ keywords: [{ id: "k", keyword: "دوربین مداربسته چیست" }], playbook: { id: "template", label: "الگو", audience: "مدیران ساختمان", conversionGoal: "تماس با مشاور", briefTemplate: "طرح الگو" } });
    const row = page("a", { supporting: "دوربین مداربسته چیست", h2Ideas: "طرح دستی", faq: "پرسش دستی", cta: "دعوت دستی" });
    const before = JSON.stringify({ p, row });
    const brief = buildBrief(p, row);
    expect(brief.pageBrief).toContain("مدیران ساختمان");
    expect(brief).toMatchObject({ mainSections: "طرح دستی", faq: "پرسش دستی", cta: "دعوت دستی" });
    expect(brief.contentNotes).toContain("منبع معتبر");
    expect(JSON.stringify({ p, row })).toBe(before);
    expect(buildBrief(p, page("b")).mainSections).toBe("طرح الگو");
  });

  it("takes FAQ from explicitly linked keywords and skips excluded questions", () => {
    const p = project({ keywords: [
      { id: "assigned", keyword: "چگونه دوربین را وصل کنیم", targetPage: "a" },
      { id: "excluded", keyword: "دوربین مداربسته چیست", decision: "Exclude", targetPage: "a" },
      { id: "other", keyword: "چرا دوربین خاموش میشود", targetPage: "b" },
    ] });
    expect(buildBrief(p, page("a", { supporting: "دوربین مداربسته چیست" })).faq).toBe("چگونه دوربین را وصل کنیم");
  });

  it("keeps generated fields within storage limits without appending to manual writer notes", () => {
    const p = project({ keywords: Array.from({ length: 1200 }, (_, index) => ({ id: `question-${index}`, keyword: `چگونه ${"ا".repeat(100)} ${index}`, targetPage: "a" })) });
    const manual = "م".repeat(100000);
    const brief = buildBrief(p, page("a", { supporting: "ا".repeat(100000), contentNotes: manual }));
    expect(String(brief.pageBrief).length).toBeLessThanOrEqual(100000);
    expect(String(brief.pageBrief)).toContain("ادامهٔ عبارت‌های ثبت‌شده");
    expect(String(brief.faq).length).toBeLessThanOrEqual(100000);
    expect(String(brief.faq)).toContain("ادامهٔ عبارت‌های ثبت‌شده");
    expect(brief.contentNotes).toBe(manual);
  });
});

describe("page relationship evidence", () => {
  it("suggests an article to a related commercial page, requires usable URLs, and never claims a live crawl", () => {
    const p = project({ pages: [page("category"), page("guide", { pkw: "بهترین دوربین مداربسته", pageType: "راهنمای خرید" }), page("draft", { existing: "New", status: "Ready" }), page("bad", { url: "javascript:alert(1)" }), page("competitor", { url: "https://competitor.com/cctv/" })] });
    const report = analyzePageRelationships(p);
    expect(report.suggestions.some((item) => item.fromPageId === "guide" && item.toPageId === "category")).toBe(true);
    expect(report.suggestions.some((item) => [item.fromPageId, item.toPageId].some((id) => ["draft", "bad", "competitor"].includes(id)))).toBe(false);
    expect(report.eligiblePageIds).toEqual(["category", "guide"]);
    expect(report.orphanPageIds).toEqual(["category", "guide"]);
    expect(report.suggestions[0].reason).toContain("مشترک");
  });

  it("tracks missing incoming links from implemented records only and skips existing planned suggestions", () => {
    const p = project({ pages: [page("a"), page("b", { pageType: "مقاله", pkw: "انتخاب دوربین مداربسته" })], links: [ { id: "link", fromPageId: "b", toPageId: "a", anchor: "دوربین مداربسته", status: "planned" } ] });
    expect(analyzePageRelationships(p).suggestions.some((item) => item.fromPageId === "b" && item.toPageId === "a")).toBe(false);
    expect(analyzePageRelationships(p).orphanPageIds).toContain("a");
    p.links![0].status = "implemented";
    expect(analyzePageRelationships(p).orphanPageIds).not.toContain("a");
    p.pages[1].linksIn = "لینک ثبت‌شده";
    expect(analyzePageRelationships(p).orphanPageIds).toEqual([]);
  });

  it("reports exact overlapping phrases with stable identity, without conflating related yet different phrases", () => {
    const p = project({ pages: [page("a", { pkw: "خرید دوربین داهوا" }), page("b", { pkw: "آموزش نصب دوربین", supporting: "خرید دوربین داهوا" }), page("c", { pkw: "خرید دوربین هایک ویژن" })] });
    const report = analyzePageRelationships(p);
    expect(report.overlaps).toHaveLength(1);
    expect(report.overlaps[0]).toMatchObject({ pageIds: ["a", "b"], phrases: ["خرید دوربین داهوا"] });
    expect(report.overlaps[0].reason).toContain("لازم است");
  });

  it("canonicalizes safe site-relative URLs and suppresses links between records representing the same URL", () => {
    expect(canonicalPageUrl("/cctv/#section", "example.com")).toBe("https://example.com/cctv/");
    expect(canonicalPageUrl("javascript:alert(1)", "example.com")).toBeNull();
    expect(canonicalPageUrl("https://user:secret@example.com/cctv/", "example.com")).toBeNull();
    const p = project({ pages: [page("a", { url: "/cctv/" }), page("b", { url: "https://example.com/cctv/#x" })] });
    expect(analyzePageRelationships(p).suggestions).toHaveLength(0);
  });

  it("does not count draft sources or aliases of the same URL as incoming web links", () => {
    const p = project({ pages: [page("a", { url: "/cctv/" }), page("alias", { url: "https://example.com/cctv/#x" }), page("draft", { existing: "New", status: "Mapping" })], links: [
      { id: "self-url", fromPageId: "alias", toPageId: "a", status: "implemented" },
      { id: "not-live", fromPageId: "draft", toPageId: "a", status: "implemented" },
    ] });
    expect(analyzePageRelationships(p).orphanPageIds).toContain("a");
  });

  it("does not count legacy notes explicitly stating that incoming links are absent", () => {
    const p = project({ pages: [page("a", { linksIn: "ندارد" }), page("b", { linksIn: "0" }), page("c", { linksIn: "لینک ورودی ندارد" }), page("d", { linksIn: "لینک ثبت‌شده" })] });
    expect(analyzePageRelationships(p).orphanPageIds).toEqual(["a", "b", "c"]);
  });

  it("bounds suggestions for large topic collections rather than producing an all-to-all plan", () => {
    const p = project({ pages: Array.from({ length: 2000 }, (_, index) => page(String(index), { pkw: `دوربین مداربسته مدل ${Math.floor(index / 2)}`, cluster: `گروه ${Math.floor(index / 2)}` })) });
    const report = analyzePageRelationships(p);
    expect(report.suggestions.length).toBeLessThanOrEqual(300);
    expect(report.overlaps.length).toBeLessThanOrEqual(500);
    expect(report.suggestions.every((item) => item.fromPageId !== item.toPageId)).toBe(true);
  });
});
