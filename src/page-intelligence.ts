import { normalizeKeyword, uid } from "./domain";
import type { Project, Row } from "./types";
import { buildBrief } from "./workflow";

export type PageCandidate = {
  id: string;
  label: string;
  keywordIds: string[];
  primaryKeyword: string;
  pageType: string;
  intent: string;
  confidence: "strong" | "review";
  reasons: string[];
  existingPageIds: string[];
  manual: boolean;
  /** Relevant source values, so a preview cannot replace subsequent edits. */
  sourceFingerprints?: Record<string, string>;
};

export type PagePlanSelection = {
  candidateId: string;
  label?: string;
  primaryKeyword?: string;
  pageType?: string;
  targetPageId?: string;
  excluded?: boolean;
};

type Analysis = {
  core: string;
  family: string;
  pageType: string;
  intent: string;
  review: boolean;
  head: boolean;
  evidence: string;
};

const text = (value: unknown) => String(value ?? "").trim();
const boundedText = (value: unknown) => {
  const valueText = text(value);
  return valueText.length <= 100000 ? valueText : `${valueText.slice(0, 99920)}\nبخش باقی‌مانده را در کلمات متصل به صفحه بررسی کنید.`;
};
const ecommerce = (project: Project) => ["Ecommerce", "Marketplace"].includes(project.projectType);
const service = (project: Project) => ["Service", "Local SEO"].includes(project.projectType);
const brandWords = new Set([
  "داهوا", "هایکویژن", "سامسونگ", "شیائومی", "اپل", "الجی", "سونی", "بوش", "کانن", "نیکون",
  "dahua", "hikvision", "samsung", "xiaomi", "apple", "sony", "bosch", "canon", "nikon",
]);

/** Only a small, explicit spelling dictionary; names and model punctuation survive. */
function canonical(value: unknown): string {
  return normalizeKeyword(text(value))
    .replace(/دوربین های? /g, "دوربین ")
    .replace(/گوشی های? /g, "گوشی ")
    .replace(/دوربین مدار بسته/g, "دوربین مداربسته")
    .replace(/هایک ویژن/g, "هایکویژن")
    .replace(/ال جی/g, "الجی")
    .replace(/[^\p{L}\p{N}./+_-]+/gu, " ")
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^[./_-]+|[./_-]+$/g, ""))
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .join(" ");
}

function stripPhrase(value: string, phrase: string): string | undefined {
  const padded = ` ${value} `;
  const wanted = ` ${phrase} `;
  if (!padded.includes(wanted)) return undefined;
  return padded.replace(wanted, " ").trim().replace(/\s+/g, " ");
}

function trimEdges(value: string): string {
  return value.replace(/^(?:برای|در|از|با|و|یا)\s+/u, "").replace(/\s+(?:است|هست|برای|در|از|با|و|یا)$/u, "").trim();
}

function classify(keyword: string, project: Project): Analysis {
  const normalized = canonical(keyword);
  const result = (core: string, family: string, pageType: string, intent: string, evidence: string, review = false): Analysis => ({
    core: trimEdges(core), family, pageType, intent, evidence, review: review || !trimEdges(core), head: false,
  });
  for (const phrase of ["دانلود", "ثبت نام"]) {
    if (normalized.startsWith(`${phrase} `)) return result(normalized.slice(phrase.length).trim(), `landing:${phrase}`, "لندینگ", "تراکنشی", phrase);
  }
  // Operations stay in the family: teaching installation is not selling installation.
  for (const operation of ["نصب", "تعمیر", "راه اندازی", "نگهداری"]) {
    for (const lead of ["آموزش", "نحوه", "روش", "چگونه", "راهنمای"]) {
      const core = stripPhrase(normalized, `${lead} ${operation}`);
      if (core !== undefined) return result(core, `training:${operation}`, "مقاله", "اطلاعاتی", `${lead} ${operation}`);
    }
    const operationCore = stripPhrase(normalized, operation);
    if (operationCore !== undefined) for (const lead of ["آموزش", "نحوه", "روش", "چگونه", "چطور", "راهنمای"]) {
      const core = stripPhrase(operationCore, lead);
      if (core !== undefined) return result(core.replace(/\s+(?:را|کنیم|کنم|کنید|کنند|میکنیم)(?=\s|$)/gu, ""), `training:${operation}`, "مقاله", "اطلاعاتی", `${lead} ${operation}`);
    }
    for (const lead of ["هزینه", "قیمت", "خدمات", "سفارش"]) {
      const core = stripPhrase(normalized, `${lead} ${operation}`);
      if (core !== undefined) return result(core, `service:${operation}`, "خدمات", "تراکنشی", `${lead} ${operation}`);
    }
    const core = operationCore;
    if (core !== undefined) return result(core, `service:${operation}`, "خدمات", "تراکنشی", operation, !service(project));
  }
  for (const phrase of ["راهنمای خرید", "راهنما خرید", "بهترین"]) {
    const core = stripPhrase(normalized, phrase);
    if (core !== undefined) return result(core, "buying-guide", "راهنمای خرید", "بررسی تجاری", phrase);
  }
  for (const phrase of ["مقایسه", "vs", "versus"]) {
    const core = stripPhrase(normalized, phrase);
    if (core !== undefined) return result(core, "comparison", "مقایسه", "بررسی تجاری", phrase);
  }
  const reviewed = stripPhrase(normalized, "بررسی");
  if (reviewed !== undefined) return result(reviewed, "review", "مقاله", "بررسی تجاری", "بررسی");
  for (const phrase of ["چیست", "چیه", "تعریف", "معنی"]) {
    const core = stripPhrase(normalized, phrase);
    if (core !== undefined) return result(core, "definition", "مقاله", "اطلاعاتی", phrase);
  }
  for (const phrase of ["چرا", "چگونه", "چطور", "آیا", "آموزش", "نحوه", "روش", "راهنمای", "راهنما"]) {
    const core = stripPhrase(normalized, phrase);
    // Keep different questions separate even when their subject happens to match.
    if (core !== undefined) return result(core, `question:${["چگونه", "چطور", "نحوه", "روش"].includes(phrase) ? "how" : phrase}`, "مقاله", "اطلاعاتی", phrase);
  }
  for (const phrase of ["ورود", "لاگین", "login", "سایت رسمی"]) {
    const core = stripPhrase(normalized, phrase);
    if (core !== undefined) return result(core, "navigation", "لندینگ", "ناوبری", phrase);
  }
  for (const phrase of ["دانلود", "ثبت نام"]) {
    const core = stripPhrase(normalized, phrase);
    if (core !== undefined) return result(core, `landing:${phrase}`, "لندینگ", "تراکنشی", phrase);
  }
  let core = normalized;
  const commerceSignals: string[] = [];
  for (const phrase of ["خرید آنلاین", "خرید اینترنتی", "لیست قیمت", "قیمت روز", "قیمت امروز", "خرید", "قیمت", "فروش", "سفارش"]) {
    const stripped = stripPhrase(core, phrase);
    if (stripped !== undefined) { core = stripped; commerceSignals.push(phrase); }
  }
  if (commerceSignals.some((signal) => signal.includes("قیمت"))) core = core.replace(/\s+امروز$/u, "");
  const words = core.split(" ");
  const hasModel = words.some((word, index) => /\d/u.test(word) && (
    /[a-z]/iu.test(word) || words[index - 1] === "مدل" || /[./+_-]/u.test(word) || /^\d{3,}$/u.test(word)
  ));
  const hasBrand = words.some((word) => brandWords.has(word));
  const type = ecommerce(project) ? hasModel ? "محصول" : hasBrand ? "برند" : "دسته‌بندی محصول" : service(project) ? "خدمات" : project.projectType === "Content / Blog" ? "مقاله" : "Needs Review";
  const intent = commerceSignals.length ? service(project) || ecommerce(project) ? "تراکنشی" : "نیاز به بررسی" : "نیاز به بررسی";
  return {
    core: trimEdges(core), family: ecommerce(project) ? "commerce" : service(project) ? "service:generic" : "unknown",
    pageType: type, intent, evidence: commerceSignals.join("، "), head: commerceSignals.length === 0,
    review: !core || commerceSignals.length === 0 || (!ecommerce(project) && !service(project)),
  };
}

function withManualIntent(analysis: Analysis, row: Row): Analysis {
  const manualIntent = text(row.intent);
  if (!manualIntent) return analysis;
  if (manualIntent === "نیاز به بررسی" || manualIntent === "ترکیبی") return { ...analysis, intent: manualIntent, review: true };
  const commerceCompatible = analysis.family === "commerce" && ["تراکنشی", "بررسی تجاری"].includes(manualIntent);
  if (manualIntent === analysis.intent || commerceCompatible) return { ...analysis, intent: manualIntent };
  return {
    ...analysis, family: `manual:${manualIntent}:${analysis.family}`, intent: manualIntent, review: true,
    pageType: manualIntent === "اطلاعاتی" ? "مقاله" : manualIntent === "ناوبری" ? "لندینگ" : analysis.pageType,
  };
}

function stableHash(value: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    a = Math.imul(a ^ value.charCodeAt(index), 16777619);
    b = Math.imul(b ^ value.charCodeAt(index), 2246822519);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

function fingerprint(row: Row): string {
  return JSON.stringify([text(row.keyword), text(row.group), text(row.intent), text(row.targetPage)]);
}

function candidateKey(row: Row, analysis: Analysis): string {
  if (text(row.targetPage)) return `linked:${text(row.targetPage)}`;
  const group = text(row.group);
  return `${group ? `manual:${canonical(group)}:` : "automatic:"}${analysis.family}:${analysis.core || `empty:${row.id}`}`;
}

function primaryScore(row: Row, analysis: Analysis): number {
  // A head phrase makes a useful label, but its ambiguity remains visible.
  return (analysis.head ? 1e12 : 0) + Math.min(Math.max(Number(row.volume) || 0, 0), 1e9) * 1000 - text(row.keyword).length;
}

function splitKeywords(value: unknown): string[] {
  return text(value).split(/[\n\r,،;؛]+/u).map((part) => part.trim()).filter(Boolean);
}

function pageIndex(project: Project): { exact: Map<string, Set<string>>; subject: Map<string, Set<string>>; pages: Map<string, Row> } {
  const exact = new Map<string, Set<string>>();
  const subject = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, id: string) => {
    if (!key) return;
    const ids = map.get(key) ?? new Set<string>(); ids.add(id); map.set(key, ids);
  };
  for (const page of project.pages) {
    for (const word of [text(page.pkw), ...splitKeywords(page.supporting), text(page.cluster)]) {
      if (!word) continue;
      add(exact, canonical(word), page.id);
      const analysis = classify(word, project);
      // Explicit page types can disambiguate a generic head on the existing page.
      const family = page.pageType === "مقاله" && analysis.family === "commerce" ? "unknown" : analysis.family;
      add(subject, `${family}:${analysis.core}`, page.id);
    }
  }
  return { exact, subject, pages: new Map(project.pages.map((row) => [row.id, row])) };
}

/** Local suggestions, never a claim that Google serves identical search results. */
export function analyzePageCandidates(project: Project): PageCandidate[] {
  const index = pageIndex(project);
  const groups = new Map<string, { candidate: PageCandidate; primaryScore: number; types: Set<string>; intents: Set<string> }>();
  for (const row of project.keywords) {
    if (row.decision === "Exclude") continue;
    const analysis = withManualIntent(classify(text(row.keyword), project), row);
    const key = candidateKey(row, analysis);
    let group = groups.get(key);
    if (!group) {
      const linked = index.pages.get(text(row.targetPage));
      const label = text(row.group) || analysis.core || text(row.keyword) || "کلمهٔ بدون عنوان";
      group = {
        candidate: {
          id: `pc-${stableHash(`${project.id}:${key}`)}`, label, keywordIds: [], primaryKeyword: text(row.keyword),
          pageType: text(linked?.pageType) || analysis.pageType, intent: analysis.intent,
          confidence: analysis.review ? "review" : "strong", reasons: [], existingPageIds: [],
          manual: !!text(row.group) || !!text(row.intent) || !!text(row.targetPage), sourceFingerprints: Object.create(null) as Record<string, string>,
        },
        primaryScore: -Infinity, types: new Set(), intents: new Set(),
      };
      groups.set(key, group);
    }
    const candidate = group.candidate;
    candidate.keywordIds.push(row.id);
    candidate.sourceFingerprints![row.id] = fingerprint(row);
    candidate.manual ||= !!text(row.group) || !!text(row.intent) || !!text(row.targetPage);
    group.types.add(analysis.pageType); group.intents.add(analysis.intent);
    if (analysis.review || !text(row.keyword)) candidate.confidence = "review";
    const score = primaryScore(row, analysis);
    if (score > group.primaryScore) { group.primaryScore = score; candidate.primaryKeyword = text(row.keyword); }
    const related = new Set<string>();
    if (index.pages.has(text(row.targetPage))) related.add(text(row.targetPage));
    for (const id of index.exact.get(canonical(row.keyword)) ?? []) related.add(id);
    for (const id of index.subject.get(`${analysis.family}:${analysis.core}`) ?? []) related.add(id);
    if (text(row.group)) for (const id of index.exact.get(canonical(row.group)) ?? []) related.add(id);
    for (const id of related) if (!candidate.existingPageIds.includes(id)) candidate.existingPageIds.push(id);
    const addReason = (reason: string) => { if (candidate.reasons.length < 7 && !candidate.reasons.includes(reason)) candidate.reasons.push(reason); };
    if (analysis.evidence) addReason(`نشانهٔ هدف جست‌وجو: ${analysis.evidence}`);
    if (analysis.core) addReason(`موضوع عبارت: ${analysis.core}`);
    if (text(row.group)) addReason("گروه‌بندی دستی شما حفظ می‌شود؛ شباهت موضوع به‌تنهایی به معنای یک صفحه نیست.");
    if (text(row.intent)) addReason("نیت ثبت‌شدهٔ شما حفظ می‌شود.");
    if (text(row.targetPage)) addReason(index.pages.has(text(row.targetPage)) ? "این کلمه از قبل به صفحهٔ هدف متصل است؛ ارتباط آن حفظ می‌شود." : "ارجاع صفحهٔ هدف موجود نیست؛ پیش از ساخت صفحه بررسی شود.");
    if (analysis.head) addReason("عبارت عمومی هدف قطعی را روشن نمی‌کند؛ نتایج جست‌وجو را بررسی کنید.");
    if (!text(row.keyword)) addReason("عنوان کلمه خالی است؛ ابتدا آن را تکمیل کنید.");
    if (text(row.targetPage) && !index.pages.has(text(row.targetPage))) candidate.confidence = "review";
  }
  const candidates = [...groups.values()].map(({ candidate, types, intents }) => {
    if (types.size > 1 || candidate.existingPageIds.length > 1) {
      candidate.confidence = "review";
      candidate.reasons.push(candidate.existingPageIds.length > 1 ? "بیش از یک صفحهٔ موجود تطبیق دارد؛ صفحهٔ مقصد را انتخاب کنید." : "نوع صفحهٔ کلمات یکسان نیست؛ گروه را بررسی یا تفکیک کنید.");
    }
    if (intents.size > 1 && ![...intents].every((intent) => ["تراکنشی", "بررسی تجاری", "نیاز به بررسی"].includes(intent))) {
      candidate.intent = "ترکیبی"; candidate.confidence = "review";
    }
    // Limit explanation size for broad manual groups and 20,000-row projects.
    candidate.reasons = candidate.reasons.slice(0, 7);
    return candidate;
  });
  return candidates.sort((a, b) => b.keywordIds.length - a.keywordIds.length || a.label.localeCompare(b.label, "fa"));
}

function contentType(pageType: string): string {
  return ({ "دسته‌بندی محصول": "PLP", "برند": "PLP", "محصول": "PDP", "مقاله": "Blog", "راهنمای خرید": "Buying Guide", "مقایسه": "Comparison", "خدمات": "Service", "لندینگ": "Landing Page", "FAQ": "FAQ" } as Record<string, string>)[pageType] ?? "Other";
}

function unchanged(row: Row, candidate: PageCandidate): boolean {
  const snapshot = candidate.sourceFingerprints?.[row.id];
  if (!snapshot) return true;
  try {
    const before = JSON.parse(snapshot) as string[];
    // A newly linked target is separately protected and allows idempotent re-apply.
    return before[0] === text(row.keyword) && before[1] === text(row.group) && before[2] === text(row.intent) && (!before[3] || before[3] === text(row.targetPage));
  } catch { return false; }
}

/** Applies only reviewed selections; all links use immutable internal page IDs. */
export function buildPagePlan(
  project: Project,
  candidates: readonly PageCandidate[],
  selections: readonly PagePlanSelection[],
  options: { createBriefs?: boolean } = {},
): { project: Project; createdPages: number; updatedPages: number; createdContent: number; linkedKeywords: number; skipped: number } {
  const plans = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const keywords = new Map(project.keywords.map((row) => [row.id, row]));
  const pages = new Map(project.pages.map((row) => [row.id, row]));
  const nextPages = [...project.pages], nextContent = [...project.content];
  const displayPageIds = new Set(project.pages.map((row) => text(row.pageId)));
  const displayContentIds = new Set(project.content.map((row) => text(row.contentId)));
  let pageCounter = nextPages.length + 1, contentCounter = nextContent.length + 1;
  const nextDisplayId = (kind: "page" | "content") => {
    const ids = kind === "page" ? displayPageIds : displayContentIds;
    let value: string;
    do { value = `${kind === "page" ? "P" : "C"}-${String(kind === "page" ? pageCounter++ : contentCounter++).padStart(3, "0")}`; } while (ids.has(value));
    ids.add(value); return value;
  };
  const pagePositions = new Map(project.pages.map((row, index) => [row.id, index]));
  const originalPageIds = new Set(project.pages.map((row) => row.id));
  const priorPlans = new Map<string, string[]>();
  for (const page of project.pages) if (text(page.planningCandidateId)) {
    const key = text(page.planningCandidateId), ids = priorPlans.get(key) ?? [];
    ids.push(page.id); priorPlans.set(key, ids);
  }
  const assigned = new Set<string>(), updated = new Set<string>(), handled = new Set<string>();
  const contentTargets = new Set(project.content.map((row) => text(row.targetPage)).filter(Boolean));
  let createdPages = 0, createdContent = 0, linkedKeywords = 0, skipped = 0;
  for (const selection of selections) {
    if (selection.excluded || handled.has(selection.candidateId)) continue;
    handled.add(selection.candidateId);
    const candidate = plans.get(selection.candidateId);
    if (!candidate) { skipped++; continue; }
    const rows = [...new Set(candidate.keywordIds)].map((id) => keywords.get(id)).filter((row): row is Row => !!row && row.decision !== "Exclude" && !!text(row.keyword) && !assigned.has(row.id) && unchanged(row, candidate));
    skipped += new Set(candidate.keywordIds).size - rows.length;
    if (!rows.length) continue;
    const requestedTarget = text(selection.targetPageId);
    if (requestedTarget && !pages.has(requestedTarget)) { skipped += rows.length; continue; }
    const related = new Set(candidate.existingPageIds.filter((id) => pages.has(id)));
    for (const row of rows) if (pages.has(text(row.targetPage))) related.add(text(row.targetPage));
    for (const id of priorPlans.get(candidate.id) ?? []) related.add(id);
    if (!requestedTarget && related.size > 1) { skipped += rows.length; continue; }
    let page = pages.get(requestedTarget || [...related][0]);
    const eligible = rows.filter((row) => !text(row.targetPage) || text(row.targetPage) === page?.id);
    skipped += rows.length - eligible.length;
    if (!eligible.length) continue;
    const primary = text(selection.primaryKeyword) || (eligible.some((row) => canonical(row.keyword) === canonical(candidate.primaryKeyword)) ? candidate.primaryKeyword : text(eligible[0].keyword));
    const label = text(selection.label) || candidate.label || primary;
    const pageType = text(selection.pageType) || candidate.pageType || "Needs Review";
    if (!page) {
      if (nextPages.length >= 2000) { skipped += eligible.length; continue; }
      page = {
        id: uid(), pageId: nextDisplayId("page"), target: label, pkw: primary,
        supporting: "", cluster: candidate.label, pageType, existing: "New", action: "Create New", priority: "P2", status: "Mapping",
        serpCheck: "Not Checked", intentConfirmed: "Unknown", samePageDecision: "Needs Review", planningCandidateId: candidate.id,
        pageBrief: boundedText(`هدف پیشنهادی: ${candidate.intent}\nکلمهٔ اصلی: ${primary}\nپیش از اجرا، نیت و نوع صفحه را در نتایج جست‌وجو بررسی کنید.`),
      };
      pagePositions.set(page.id, nextPages.length);
      pages.set(page.id, page); nextPages.push(page); createdPages++;
    }
    const supporting = splitKeywords(page.supporting);
    const existingWords = new Set([canonical(page.pkw), ...supporting.map(canonical)]);
    const additions: string[] = [];
    const plannedRows: Row[] = [];
    let supportingLength = String(page.supporting ?? "").length;
    for (const row of eligible) {
      const word = text(row.keyword), key = canonical(word);
      if (!existingWords.has(key)) {
        const additionLength = word.length + (supportingLength ? 1 : 0);
        if (supportingLength + additionLength > 100000) { skipped++; continue; }
        additions.push(word); existingWords.add(key); supportingLength += additionLength;
      }
      if (!text(row.targetPage)) { keywords.set(row.id, { ...row, targetPage: page.id }); linkedKeywords++; }
      assigned.add(row.id);
      plannedRows.push(row);
    }
    if (!plannedRows.length) continue;
    if (additions.length) {
      const updatedPage: Row = { ...page, supporting: [String(page.supporting ?? ""), additions.join("\n")].filter(Boolean).join("\n") };
      pages.set(page.id, updatedPage);
      nextPages[pagePositions.get(page.id)!] = updatedPage;
      // Newly created pages are counted only as creations.
      if (originalPageIds.has(page.id)) updated.add(page.id);
      page = updatedPage;
    }
    if (options.createBriefs && !contentTargets.has(page.id) && nextContent.length < 2000) {
      const effectiveType = text(page.pageType) || pageType;
      // The helper needs only this candidate's rows, avoiding a project-wide scan per page.
      const brief = buildBrief({ ...project, keywords: plannedRows }, page);
      nextContent.push({
        id: uid(), contentId: nextDisplayId("content"), targetPage: page.id,
        pkw: text(page.pkw) || primary, topic: text(page.target) || label, contentType: contentType(effectiveType), cluster: text(page.cluster) || candidate.label,
        briefStatus: "Research", writingStatus: "Research", h2Ideas: boundedText(brief.h2Ideas), faq: boundedText(brief.faq),
        entities: boundedText([...new Set(plannedRows.map((row) => text(row.keyword)))].join("\n")),
        cta: boundedText(brief.cta),
        sources: "بریف اولیه از اطلاعات همین پروژه؛ منابع و شواهد باید در مرحلهٔ تحقیق اضافه شوند.",
        notes: boundedText([text(brief.pageBrief), text(brief.contentNotes), `نیت پیشنهادی: ${candidate.intent}`].filter(Boolean).join("\n\n")),
      });
      contentTargets.add(page.id); createdContent++;
    }
  }
  const changed = createdPages || updated.size || createdContent || linkedKeywords;
  return {
    project: changed ? { ...project, keywords: project.keywords.map((row) => keywords.get(row.id)!), pages: nextPages, content: nextContent } : project,
    createdPages, updatedPages: updated.size, createdContent, linkedKeywords, skipped,
  };
}
