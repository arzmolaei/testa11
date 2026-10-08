import { LISTS, normalizeKeyword } from "./domain";
import { latinDigits } from "./dates";
import { canonicalPageUrl } from "./workflow";
import type { PageCandidate, PagePlanSelection } from "./page-intelligence";
import type { Project } from "./types";

export type PageOpportunity = {
  coverage: "new" | "extend" | "covered" | "conflict";
  volume: number | null; knownVolume: number; difficulty: number | null; difficultyLabel: string | null;
  unassigned: number; existingPageIds: string[]; suggestedTarget?: string;
  score: number; priority: "P1" | "P2" | "P3"; reasons: string[];
  gsc: { clicks: number; impressions: number; queries: number; periodStart: string; periodEnd: string } | null;
};
export function keywordMetric(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(latinDigits(String(value)).replace(/[,٬]/g, "").replace(/٫/g, "."));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
}

/** One pass over imported evidence and keywords. Scores rank local work; they never estimate Google traffic or assert identical SERPs. */
export function assessPageOpportunities(project: Project, candidates: readonly PageCandidate[], choices: Record<string, Partial<PagePlanSelection>> = {}): Map<string, PageOpportunity> {
  const keywords = new Map(project.keywords.map(row => [row.id, row]));
  const pages = new Map(project.pages.map(row => [row.id, row]));
  const urlPages = new Map<string, Set<string>>();
  for (const page of project.pages) {
    const url = canonicalPageUrl(page.url, project.domain);
    if (url) { const ids = urlPages.get(url) || new Set(); ids.add(page.id); urlPages.set(url, ids); }
  }
  const current = project.searchConsole?.current;
  const queryEvidence = new Map<string, { clicks: number; impressions: number; urls: Set<string> }>();
  if (current?.dimension !== "page") for (const row of current?.rows || []) {
    const query = normalizeKeyword(row.query || "");
    if (!query) continue;
    const evidence = queryEvidence.get(query) || { clicks: 0, impressions: 0, urls: new Set<string>() };
    evidence.clicks += row.clicks; evidence.impressions += row.impressions;
    const url = canonicalPageUrl(row.page, project.domain);
    if (url && row.impressions > 0) evidence.urls.add(url);
    queryEvidence.set(query, evidence);
  }
  const result = new Map<string, PageOpportunity>();
  for (const candidate of candidates) {
    const choice = choices[candidate.id];
    const matching = new Set(candidate.existingPageIds.filter(id => pages.has(id)));
    const phrases = new Map<string, { volume: number | null; difficulty: number | null; band: number }>();
    let unassigned = 0, brokenTarget = false;
    for (const id of candidate.keywordIds) {
      const row = keywords.get(id);
      if (!row || row.decision === "Exclude") continue;
      const target = String(row.targetPage || "");
      if (!target) unassigned++; else if (!pages.has(target)) brokenTarget = true; else matching.add(target);
      const key = normalizeKeyword(String(row.keyword ?? ""));
      const volume = keywordMetric(row.volume), difficulty = keywordMetric(row.kd, 100);
      const before = phrases.get(key);
      // Exact duplicated phrases must not inflate the displayed volume or file evidence.
      phrases.set(key, { volume: volume === null ? before?.volume ?? null : Math.max(before?.volume ?? 0, volume), difficulty: difficulty ?? before?.difficulty ?? null, band: Math.max(before?.band ?? -1, LISTS.kd.indexOf(String(row.kd ?? ""))) });
    }
    let volume = 0, knownVolume = 0, kdTotal = 0, kdCount = 0, hardestBand = -1, clicks = 0, impressions = 0, queries = 0, observedOverlap = false;
    for (const [phrase, metric] of phrases) {
      if (metric.volume !== null) { volume = Math.min(Number.MAX_SAFE_INTEGER, volume + metric.volume); knownVolume++; }
      if (metric.difficulty !== null) { kdTotal += metric.difficulty; kdCount++; }
      hardestBand = Math.max(hardestBand, metric.band);
      const evidence = queryEvidence.get(phrase);
      if (evidence) {
        clicks += evidence.clicks; impressions += evidence.impressions; queries++;
        observedOverlap ||= evidence.urls.size > 1;
        for (const url of evidence.urls) for (const id of urlPages.get(url) || []) matching.add(id);
      }
    }
    const explicit = choice?.targetPageId && pages.has(choice.targetPageId) ? choice.targetPageId : undefined;
    const conflict = brokenTarget || observedOverlap || matching.size > 1 && !explicit;
    const coverage: PageOpportunity["coverage"] = conflict ? "conflict" : !unassigned ? "covered" : matching.size ? "extend" : "new";
    const difficulty = kdCount ? kdTotal / kdCount : null;
    const difficultyLabel = hardestBand < 0 ? null : LISTS.kd[hardestBand];
    const reasons: string[] = [];
    if (coverage === "conflict") reasons.push(brokenTarget ? "ارجاع یک کلمه به صفحهٔ حذف‌شده باید بررسی شود." : observedOverlap ? "یک عبارت در فایل Search Console روی چند نشانی نمایش داشته؛ تصمیم یک صفحه را بررسی کنید." : "چند صفحهٔ موجود با موضوع مرتبط‌اند؛ مقصد را پیش از ساخت صفحهٔ تازه تعیین کنید.");
    else if (coverage === "extend") reasons.push("صفحهٔ موجود شناسایی شده است؛ می‌توانید کلمات بدون هدف را به آن وصل کنید و از ساخت صفحهٔ تکراری جلوگیری کنید.");
    else if (coverage === "covered") reasons.push("کلمات این پیشنهاد از قبل صفحهٔ معتبر دارند؛ ابتدا بهبود همان صفحه را بررسی کنید.");
    else reasons.push("برای این پیشنهاد هنوز صفحهٔ موجودی شناسایی نشده است.");
    if (!knownVolume) reasons.push("حجم جست‌وجوی ثبت‌شده موجود نیست؛ صفر فرض نشده است.");
    if (difficulty !== null && difficulty <= 35) reasons.push("سختی ثبت‌شده پایین‌تر است؛ می‌تواند شروع ساده‌تری باشد.");
    if (difficulty === null && difficultyLabel) reasons.push(`سخت‌ترین ارزیابی کیفی ثبت‌شدهٔ گروه «${difficultyLabel}» است؛ به عدد فرضی تبدیل نشده است.`);
    if (queries) reasons.push(`شواهد از فایل واردشدهٔ Search Console برای ${queries.toLocaleString("fa-IR")} عبارت در همین گروه وجود دارد.`);
    if (candidate.confidence === "review") reasons.push("نشانه‌های محلی برای تصمیم قطعی کافی نیست؛ بررسی نتایج جست‌وجو لازم است.");
    const type = choice?.pageType || candidate.pageType;
    const commercial = ["محصول", "برند", "دسته‌بندی محصول", "خدمات", "لندینگ"].includes(type);
    const businessFit = ["Ecommerce", "Marketplace", "Service", "Local SEO"].includes(project.projectType) ? commercial : ["Content / Blog"].includes(project.projectType) ? !commercial : false;
    let score = (coverage === "extend" ? 34 : coverage === "new" ? 25 : coverage === "conflict" ? 18 : 5)
      + Math.min(22, Math.log10(1 + volume) * 5) + (difficulty === null ? hardestBand < 0 ? 0 : (4 - hardestBand) * 2 : (100 - difficulty) / 10)
      + (candidate.confidence === "strong" ? 10 : 0) + (businessFit ? 10 : 0) + Math.min(10, Math.log10(1 + impressions) * 3);
    if (knownVolume && volume === 0) score -= 8;
    score = Math.round(Math.max(0, Math.min(100, score)));
    result.set(candidate.id, { coverage, volume: knownVolume ? volume : null, knownVolume, difficulty, difficultyLabel, unassigned, existingPageIds: [...matching], suggestedTarget: !conflict ? explicit || (matching.size === 1 ? [...matching][0] : undefined) : undefined, score, priority: score >= 65 ? "P1" : score >= 40 ? "P2" : "P3", reasons, gsc: queries && current ? { clicks, impressions, queries, periodStart: current.periodStart, periodEnd: current.periodEnd } : null });
  }
  return result;
}
