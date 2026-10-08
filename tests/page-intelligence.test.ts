import { describe, expect, it } from "vitest";
import { createProject } from "../src/domain";
import { analyzePageCandidates, buildPagePlan, type PageCandidate } from "../src/page-intelligence";
import type { Project, Row } from "../src/types";

function project(words: (string | Row)[], type = "Ecommerce"): Project {
  return { ...createProject("آزمایش"), projectType: type, keywords: words.map((word, index) => typeof word === "string" ? { id: `k-${index}`, keyword: word } : word) };
}
function selected(candidates: PageCandidate[]) { return candidates.map((candidate) => ({ candidateId: candidate.id })); }

describe("local page-intent planning", () => {
  it("places ecommerce head, buy and price variants on one proposed page with an honest head-term review", () => {
    const source = project(["دوربین مداربسته", "خرید دوربین مدار بسته", "قیمت دوربین مدار‌بسته", "خرید دوربین‌های مداربسته"]);
    const candidates = analyzePageCandidates(source);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ keywordIds: ["k-0", "k-1", "k-2", "k-3"], primaryKeyword: "دوربین مداربسته", pageType: "دسته‌بندی محصول", confidence: "review" });
    expect(candidates[0].reasons.join(" ")).toContain("نتایج جست‌وجو");
    expect(source.keywords.every((row) => !row.group && !row.intent && !row.targetPage)).toBe(true);
  });

  it("separates installation teaching, service cost and product purchase despite the shared subject", () => {
    const source = project(["آموزش نصب دوربین مداربسته", "نحوه نصب دوربین مدار بسته", "هزینه نصب دوربین مداربسته", "قیمت نصب دوربین مدار بسته", "خرید دوربین مداربسته", "چگونه دوربین مداربسته را نصب کنیم"]);
    const candidates = analyzePageCandidates(source);
    expect(candidates).toHaveLength(3);
    expect(candidates.find((candidate) => candidate.pageType === "مقاله")?.keywordIds).toEqual(["k-0", "k-1", "k-5"]);
    expect(candidates.find((candidate) => candidate.pageType === "خدمات")?.keywordIds).toEqual(["k-2", "k-3"]);
    expect(candidates.find((candidate) => candidate.pageType === "دسته‌بندی محصول")?.keywordIds).toEqual(["k-4"]);
  });

  it("keeps buying guides, comparisons, reviews, definitions and distinct questions separate", () => {
    const source = project(["بهترین دوربین برای منزل", "راهنمای خرید دوربین برای منزل", "مقایسه دوربین داهوا با سونی", "بررسی دوربین داهوا", "دوربین داهوا چیست", "چرا دوربین داهوا قطع میشود", "چگونه دوربین داهوا قطع میشود"]);
    const candidates = analyzePageCandidates(source);
    expect(candidates).toHaveLength(6);
    expect(candidates.find((candidate) => candidate.pageType === "راهنمای خرید")?.keywordIds).toEqual(["k-0", "k-1"]);
    expect(candidates.filter((candidate) => candidate.keywordIds.length === 1)).toHaveLength(5);
  });

  it("recognizes common purchase and price phrasing while keeping downloads and registration distinct", () => {
    const source = project(["خرید اینترنتی دوربین مداربسته", "خرید آنلاین دوربین مداربسته", "لیست قیمت دوربین مداربسته", "قیمت روز دوربین مداربسته", "قیمت دوربین مداربسته امروز", "دانلود راهنمای دوربین مداربسته", "ثبت نام دوره دوربین مداربسته"]);
    const candidates = analyzePageCandidates(source);
    expect(candidates.find((candidate) => candidate.pageType === "دسته‌بندی محصول")?.keywordIds).toEqual(["k-0", "k-1", "k-2", "k-3", "k-4"]);
    expect(candidates).toHaveLength(3);
    expect(candidates.find((candidate) => candidate.keywordIds.includes("k-5"))).toMatchObject({ pageType: "لندینگ", intent: "تراکنشی" });
    expect(candidates.find((candidate) => candidate.keywordIds.includes("k-6"))).toMatchObject({ pageType: "لندینگ", intent: "تراکنشی" });
  });

  it("preserves exact model punctuation and different brands, including within broad manual groups", () => {
    const source = project(["خرید گوشی S24", "قیمت گوشی S24+", "خرید دوربین داهوا 12.3", "خرید دوربین داهوا 12-3", "خرید دوربین داهوا 12/3", "خرید دوربین داهوا", "خرید دوربین هایک ویژن"].map((keyword, index) => ({ id: `k-${index}`, keyword, group: "تجهیزات" })));
    const candidates = analyzePageCandidates(source);
    expect(candidates).toHaveLength(7);
    expect(candidates.filter((candidate) => candidate.pageType === "محصول")).toHaveLength(5);
    expect(candidates.filter((candidate) => candidate.pageType === "برند")).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.manual)).toBe(true);
  });

  it("uses project type and preserves an explicitly recorded informative intent", () => {
    const shop = analyzePageCandidates(project(["قیمت طراحی سایت"]));
    const agency = analyzePageCandidates(project(["قیمت طراحی سایت"], "Service"));
    const blog = analyzePageCandidates(project(["طراحی سایت"], "Content / Blog"));
    const manual = analyzePageCandidates(project([{ id: "manual", keyword: "خرید دوربین", group: "راهنما", intent: "اطلاعاتی" }]));
    expect(shop[0].pageType).toBe("دسته‌بندی محصول");
    expect(agency[0].pageType).toBe("خدمات");
    expect(blog[0]).toMatchObject({ pageType: "مقاله", confidence: "review" });
    expect(manual[0]).toMatchObject({ pageType: "مقاله", intent: "اطلاعاتی", manual: true, confidence: "review" });
  });

  it("leaves empty terms reviewable, excludes discarded rows and produces stable candidate IDs", () => {
    const source = project([{ id: "blank", keyword: "" }, { id: "excluded", keyword: "خرید دوربین", decision: "Exclude" }, { id: "active", keyword: "خرید دوربین" }]);
    const first = analyzePageCandidates(source), second = analyzePageCandidates(source);
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first.find((candidate) => candidate.keywordIds.includes("blank"))?.confidence).toBe("review");
    expect(first.some((candidate) => candidate.keywordIds.includes("excluded"))).toBe(false);
  });

  it("matches existing primary, supporting, cluster and stable target references", () => {
    const source = project(["خرید دوربین مداربسته", "هزینه نصب دوربین", "خرید گوشی سامسونگ", { id: "linked", keyword: "کلمهٔ دستی", targetPage: "manual" }]);
    source.pages = [
      { id: "category", pkw: "دوربین مدار بسته", pageType: "دسته‌بندی محصول" },
      { id: "service", pkw: "خدمات نصب دوربین", supporting: "هزینه نصب دوربین", pageType: "خدمات" },
      { id: "brand", pkw: "گوشی", cluster: "خرید گوشی سامسونگ", pageType: "برند" },
      { id: "manual", pkw: "هدف دستی", pageType: "لندینگ" },
    ];
    const candidates = analyzePageCandidates(source);
    expect(candidates.find((candidate) => candidate.keywordIds.includes("k-0"))?.existingPageIds).toEqual(["category"]);
    expect(candidates.find((candidate) => candidate.keywordIds.includes("k-1"))?.existingPageIds).toEqual(["service"]);
    expect(candidates.find((candidate) => candidate.keywordIds.includes("k-2"))?.existingPageIds).toEqual(["brand"]);
    expect(candidates.find((candidate) => candidate.keywordIds.includes("linked"))).toMatchObject({ existingPageIds: ["manual"], pageType: "لندینگ", manual: true });
  });

  it("creates reviewed pages and research briefs in one immutable plan using stable target IDs", () => {
    const source = project(["خرید دوربین مداربسته", "قیمت دوربین مداربسته", "آموزش نصب دوربین مداربسته"]);
    source.goal = "کمک به انتخاب و خرید";
    const candidates = analyzePageCandidates(source);
    expect(buildPagePlan(source, candidates, []).project).toBe(source);
    const result = buildPagePlan(source, candidates, selected(candidates), { createBriefs: true });
    expect(result).toMatchObject({ createdPages: 2, updatedPages: 0, createdContent: 2, linkedKeywords: 3, skipped: 0 });
    expect(result.project.pages.every((row) => row.existing === "New" && row.action === "Create New" && row.status === "Mapping" && row.priority === "P2" && row.serpCheck === "Not Checked")).toBe(true);
    expect(result.project.keywords.every((row) => result.project.pages.some((page) => page.id === row.targetPage))).toBe(true);
    expect(result.project.content.every((row) => result.project.pages.some((page) => page.id === row.targetPage) && row.briefStatus === "Research" && row.writingStatus === "Research" && String(row.notes).includes("کمک به انتخاب و خرید"))).toBe(true);
    expect(source.pages).toHaveLength(0);
    expect(source.keywords.every((row) => !row.targetPage)).toBe(true);
    const repeat = buildPagePlan(result.project, candidates, selected(candidates), { createBriefs: true });
    expect(repeat).toMatchObject({ createdPages: 0, updatedPages: 0, createdContent: 0, linkedKeywords: 0 });
    expect(repeat.project).toBe(result.project);
  });

  it("only appends supporters to existing pages and preserves every manual value and existing brief", () => {
    const source = project([{ id: "a", keyword: "خرید دوربین", group: "گروه دستی", intent: "تراکنشی", notes: "manual", custom1: "custom" }, { id: "b", keyword: "قیمت دوربین", group: "گروه دستی", intent: "بررسی تجاری" }]);
    const page: Row = { id: "original", pkw: "دوربین", supporting: "دوربین خانگی،دوربین اداری", target: "عنوان دستی", notes: "private", proposedTitle: "عنوان سئو", pageType: "دسته‌بندی محصول", pageBrief: "بریف دستی", intentConfirmed: "Yes" };
    source.pages = [page]; source.content = [{ id: "brief", targetPage: page.id, h2Ideas: "بخش‌های دستی" }];
    const candidates = analyzePageCandidates(source);
    const result = buildPagePlan(source, candidates, selected(candidates), { createBriefs: true });
    expect(result).toMatchObject({ createdPages: 0, updatedPages: 1, createdContent: 0, linkedKeywords: 2 });
    expect(result.project.pages[0]).toEqual({ ...page, supporting: "دوربین خانگی،دوربین اداری\nخرید دوربین\nقیمت دوربین" });
    expect(result.project.keywords[0]).toEqual({ ...source.keywords[0], targetPage: page.id });
    expect(result.project.content).toEqual(source.content);
    expect(buildPagePlan(result.project, candidates, selected(candidates), { createBriefs: true }).project).toBe(result.project);
  });

  it("requires a destination for multiple matches and never replaces an existing keyword target", () => {
    const source = project(["خرید دوربین", { id: "linked", keyword: "قیمت دوربین", targetPage: "b" }]);
    source.pages = [{ id: "a", pkw: "دوربین", pageType: "دسته‌بندی محصول" }, { id: "b", pkw: "دوربین", pageType: "دسته‌بندی محصول" }];
    const candidates = analyzePageCandidates(source);
    const unlinked = candidates.find((candidate) => candidate.keywordIds.includes("k-0"))!;
    expect(unlinked).toMatchObject({ confidence: "review", existingPageIds: ["a", "b"] });
    expect(buildPagePlan(source, candidates, [{ candidateId: unlinked.id }])).toMatchObject({ createdPages: 0, linkedKeywords: 0, skipped: 1 });
    const combined = { ...unlinked, id: "merged", keywordIds: ["k-0", "linked"], sourceFingerprints: undefined };
    const result = buildPagePlan(source, [combined], [{ candidateId: "merged", targetPageId: "a" }]);
    expect(result).toMatchObject({ createdPages: 0, linkedKeywords: 1, skipped: 1 });
    expect(result.project.keywords.find((row) => row.id === "linked")?.targetPage).toBe("b");
    expect(result.project.keywords.find((row) => row.id === "k-0")?.targetPage).toBe("a");
  });

  it("accepts reviewed merged and split candidates while preventing duplicate keyword assignments", () => {
    const source = project(["خرید دوربین", "قیمت دوربین", "خرید دستگاه ضبط"]);
    const candidates = analyzePageCandidates(source);
    const merged = { ...candidates[0], id: "reviewed-merge", label: "تجهیزات امنیتی", keywordIds: source.keywords.map((row) => row.id), sourceFingerprints: Object.assign({}, ...candidates.map((candidate) => candidate.sourceFingerprints)) };
    const result = buildPagePlan(source, [merged, ...candidates], [{ candidateId: merged.id }, ...selected(candidates)]);
    expect(result).toMatchObject({ createdPages: 1, linkedKeywords: 3, skipped: 3 });
    expect(new Set(result.project.keywords.map((row) => row.targetPage)).size).toBe(1);
    expect(result.project.pages[0].target).toBe("تجهیزات امنیتی");
    const split = candidates.flatMap((candidate) => candidate.keywordIds.map((id) => ({ ...candidate, id: `split-${id}`, keywordIds: [id], primaryKeyword: String(source.keywords.find((row) => row.id === id)?.keyword) })));
    expect(buildPagePlan(source, split, selected(split)).createdPages).toBe(3);
  });

  it("skips words edited, deleted or excluded since the preview without losing unrelated edits", () => {
    const source = project(["خرید دوربین", "قیمت دوربین", "فروش دوربین", "سفارش دوربین"]);
    const candidates = analyzePageCandidates(source);
    const current = { ...source, keywords: [
      { ...source.keywords[0], notes: "updated note", custom1: "new custom" },
      { ...source.keywords[1], intent: "اطلاعاتی" },
      { ...source.keywords[2], decision: "Exclude" },
    ] };
    const result = buildPagePlan(current, candidates, selected(candidates));
    expect(result).toMatchObject({ createdPages: 1, linkedKeywords: 1, skipped: 3 });
    expect(result.project.keywords[0]).toMatchObject({ notes: "updated note", custom1: "new custom" });
    expect(result.project.keywords[1]).toEqual(current.keywords[1]);
    expect(result.project.keywords[2]).toEqual(current.keywords[2]);
  });

  it("does not restore a manual target that was cleared after the preview", () => {
    const source = project([{ id: "linked", keyword: "خرید دوربین", targetPage: "a" }]);
    source.pages = [{ id: "a", pkw: "دوربین", pageType: "دسته‌بندی محصول" }];
    const candidates = analyzePageCandidates(source);
    const current = { ...source, keywords: [{ ...source.keywords[0], targetPage: "" }] };
    expect(buildPagePlan(current, candidates, selected(candidates))).toMatchObject({ project: current, linkedKeywords: 0, updatedPages: 0, skipped: 1 });
  });

  it("chooses a remaining eligible primary when the original primary was excluded", () => {
    const source = project(["خرید دوربین", "قیمت دوربین"]);
    const candidates = analyzePageCandidates(source);
    const current = { ...source, keywords: [{ ...source.keywords[0], decision: "Exclude" }, source.keywords[1]] };
    const result = buildPagePlan(current, candidates, selected(candidates));
    expect(result).toMatchObject({ createdPages: 1, linkedKeywords: 1, skipped: 1 });
    expect(result.project.pages[0].pkw).toBe("قیمت دوربین");
    expect(result.project.keywords[0].targetPage).toBeUndefined();
  });

  it("preserves invalid legacy targets and rejects missing requested destinations without creating data", () => {
    const source = project([{ id: "a", keyword: "خرید دوربین", targetPage: "deleted-page" }]);
    const candidates = analyzePageCandidates(source);
    expect(candidates[0].confidence).toBe("review");
    expect(buildPagePlan(source, candidates, selected(candidates))).toMatchObject({ project: source, createdPages: 0, linkedKeywords: 0, skipped: 1 });
    const unlinked = project(["خرید دوربین"]), next = analyzePageCandidates(unlinked);
    expect(buildPagePlan(unlinked, next, [{ candidateId: next[0].id, targetPageId: "nonexistent" }])).toMatchObject({ project: unlinked, createdPages: 0, skipped: 1 });
  });

  it("honors collection capacity without orphan links and avoids duplicate display codes", () => {
    const source = project(["خرید دوربین", "خرید گوشی"]);
    source.pages = Array.from({ length: 1999 }, (_, index) => ({ id: `existing-${index}`, pageId: index === 0 ? "P-2000" : `P-${index}`, pkw: `موضوع قبلی ${index}`, pageType: "مقاله" }));
    source.content = Array.from({ length: 2000 }, (_, index) => ({ id: `content-${index}`, contentId: `C-${index}` }));
    const candidates = analyzePageCandidates(source);
    const result = buildPagePlan(source, candidates, selected(candidates), { createBriefs: true });
    expect(result).toMatchObject({ createdPages: 1, createdContent: 0, linkedKeywords: 1, skipped: 1 });
    expect(result.project.pages).toHaveLength(2000);
    expect(result.project.content).toHaveLength(2000);
    expect(result.project.pages[1999].pageId).toBe("P-2001");
    expect(result.project.keywords.filter((row) => row.targetPage)).toHaveLength(1);
    expect(result.project.keywords.filter((row) => row.targetPage).every((row) => result.project.pages.some((page) => page.id === row.targetPage))).toBe(true);
  });

  it("does not exceed the supported text-field size or silently link words omitted by that limit", () => {
    const source = project(["خرید دوربین", "قیمت دوربین"]);
    source.pages = [{ id: "page", pkw: "دوربین", supporting: "ا".repeat(100000), pageType: "دسته‌بندی محصول" }];
    const candidates = analyzePageCandidates(source);
    const result = buildPagePlan(source, candidates, selected(candidates), { createBriefs: true });
    expect(result).toMatchObject({ project: source, createdPages: 0, updatedPages: 0, linkedKeywords: 0, createdContent: 0, skipped: 2 });
    expect(source.pages[0].supporting).toHaveLength(100000);
  });

  it("plans all 2000 rows at once and handles 20000 existing models without pairwise comparisons", () => {
    const source = project(Array.from({ length: 2000 }, (_, index) => `${index % 2 ? "خرید" : "قیمت"} دوربین مدل ${index % 20}`));
    const candidates = analyzePageCandidates(source);
    expect(candidates).toHaveLength(20);
    expect(candidates.every((candidate) => candidate.keywordIds.length === 100)).toBe(true);
    const result = buildPagePlan(source, candidates, selected(candidates), { createBriefs: true });
    expect(result).toMatchObject({ createdPages: 20, createdContent: 20, linkedKeywords: 2000 });
    const large = project(Array.from({ length: 20000 }, (_, index) => `خرید دوربین مدل ${index}`));
    large.pages = Array.from({ length: 20000 }, (_, index) => ({ id: `p-${index}`, pkw: `دوربین مدل ${index}`, pageType: "محصول", supporting: "" }));
    const started = performance.now();
    const largeCandidates = analyzePageCandidates(large);
    const largePlan = buildPagePlan(large, largeCandidates, selected(largeCandidates));
    expect(largeCandidates).toHaveLength(20000);
    expect(largePlan).toMatchObject({ createdPages: 0, updatedPages: 20000, linkedKeywords: 20000 });
    expect(performance.now() - started).toBeLessThan(8000);
  }, 15000);
});
