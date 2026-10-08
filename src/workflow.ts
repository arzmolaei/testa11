import { normalizeKeyword, resultLookup } from "./domain";
import { formatDate, todayIso, toIsoDate } from "./dates";
import { buildSearchConsoleInsights } from "./search-console";
import type { Project, Row } from "./types";

export type ActionView = "keywords" | "pages" | "content" | "results" | "bulk";
export type ProjectAction = {
  id: string;
  title: string;
  reason: string;
  priority: "P0" | "P1" | "P2";
  view: ActionView;
  pageId?: string;
  contentId?: string;
  keywordId?: string;
};
type WorkflowProject = Project & { tasks?: Row[]; links?: Row[] };
const text = (value: unknown) => String(value ?? "").trim();
const boundedGeneratedText = (value: string) => value.length <= 100000 ? value : `${value.slice(0, 99920)}\nادامهٔ عبارت‌های ثبت‌شده را در کلمات و اطلاعات صفحه بررسی کنید.`;
const norm = (value: unknown) => normalizeKeyword(text(value));
const split = (value: unknown) => text(value).split(/[\n،,;؛]+/).map((item) => item.trim()).filter(Boolean);
const pageName = (page: Row) => text(page.target || page.pkw || page.pageId) || "صفحهٔ بدون نام";
const priority = (value: unknown, fallback: ProjectAction["priority"] = "P2"): ProjectAction["priority"] => ["P0", "P1", "P2"].includes(text(value)) ? text(value) as ProjectAction["priority"] : fallback;
function hash(value: string): string {
  let n = 2166136261;
  for (const character of value) n = Math.imul(n ^ character.charCodeAt(0), 16777619);
  return (n >>> 0).toString(36);
}
export function pageKeywordPhrases(page: Row): string[] {
  return [...new Set([text(page.pkw), ...split(page.supporting), ...split(page.akw), ...split(page.skw), ...split(page.moreKeywords)].map(norm).filter(Boolean))];
}
export function getContentReadiness(project: Project, content: Row): { ready: boolean; missing: string[] } {
  const page = project.pages.find((item) => item.id === content.targetPage);
  const missing: string[] = [];
  if (!page) missing.push("صفحهٔ هدف معتبر");
  if (!text(content.topic)) missing.push("موضوع محتوا");
  if (!text(content.pkw || page?.pkw)) missing.push("کلمهٔ اصلی");
  if (!text(content.contentType)) missing.push("نوع محتوا");
  if (!text(content.h2Ideas || page?.mainSections || page?.h2Ideas)) missing.push("طرح بخش‌های محتوا");
  if (content.briefStatus !== "Brief Ready") missing.push("بازبینی و تأیید بریف");
  return { ready: missing.length === 0, missing };
}

/** A local queue of concrete checks. No ranking score, crawler or search-engine data is fabricated. */
export function getProjectActions(project: WorkflowProject, today = todayIso()): ProjectAction[] {
  const actions: ProjectAction[] = [];
  const tracked = new Set((project.tasks || []).map((task) => text(task.source)).filter(Boolean));
  const add = (action: ProjectAction) => { if (!tracked.has(action.id)) actions.push(action); };
  const pages = new Map(project.pages.map((page) => [page.id, page]));
  const mapped = new Set<string>();
  for (const page of project.pages) {
    for (const phrase of pageKeywordPhrases(page)) mapped.add(phrase);
  }
  const groups = new Map<string, Row[]>();
  const activeKeywords = project.keywords.filter((row) => row.decision !== "Exclude" && text(row.keyword));
  let ungrouped = 0, uncertain = 0;
  let firstUngrouped: string | undefined, firstUncertain: string | undefined;
  for (const keyword of activeKeywords) {
    const group = norm(keyword.group);
    if (!group) { ungrouped++; firstUngrouped ||= keyword.id; }
    else { const list = groups.get(group) || []; list.push(keyword); groups.set(group, list); }
    if (!text(keyword.intent) || ["نیاز به بررسی", "ترکیبی", "Needs Review"].includes(text(keyword.intent))) { uncertain++; firstUncertain ||= keyword.id; }
  }
  if (ungrouped) add({ id: "keywords:ungrouped", title: "کلمات بدون گروه را سامان دهید", reason: `${ungrouped.toLocaleString("fa-IR")} کلمه هنوز گروه ندارد؛ از پیش‌نمایش گروه‌بندی برای بررسی یکجای آن‌ها استفاده کنید.`, priority: "P1", view: "keywords", keywordId: firstUngrouped });
  if (uncertain) add({ id: "keywords:intent", title: "نیت‌های نامشخص را بازبینی کنید", reason: `${uncertain.toLocaleString("fa-IR")} کلمه نیت روشن ندارد؛ این موضوع می‌تواند انتخاب مقاله، دسته‌بندی یا خدمات را تغییر دهد.`, priority: "P2", view: "keywords", keywordId: firstUncertain });
  for (const [group, rows] of groups) {
    const unmapped = rows.filter((row) => !pages.has(text(row.targetPage)) && !mapped.has(norm(row.keyword)));
    if (unmapped.length) add({ id: `group:${hash(group)}:target`, title: `صفحهٔ هدف گروه «${text(rows[0].group)}» را مشخص کنید`, reason: `${unmapped.length.toLocaleString("fa-IR")} کلمهٔ این گروه به صفحهٔ ثبت‌شده‌ای متصل نیست. وجود صفحه در سایت را پیش از ساخت صفحهٔ تازه بررسی کنید.`, priority: "P1", view: "keywords", keywordId: unmapped[0].id });
  }
  for (const page of project.pages) {
    const name = pageName(page), p = priority(page.priority);
    if (!text(page.pkw) || !text(page.pageType)) add({ id: `page:${page.id}:target`, title: `هدف‌گذاری «${name}» را کامل کنید`, reason: [!text(page.pkw) && "کلمهٔ اصلی", !text(page.pageType) && "نوع صفحه"].filter(Boolean).join(" و ") + " ثبت نشده است.", priority: p, view: "pages", pageId: page.id });
    if (["High", "Needs Review"].includes(text(page.cannibalizationRisk)) || page.samePageDecision === "Needs Review") add({ id: `page:${page.id}:overlap`, title: `همپوشانی هدف «${name}» را بررسی کنید`, reason: "در ارزیابی ثبت‌شدهٔ شما، همپوشانی یا تصمیم صفحهٔ مشترک نیازمند بررسی است؛ این نشانه به‌تنهایی کنیبالیزیشن را اثبات نمی‌کند.", priority: "P1", view: "pages", pageId: page.id });
    const gaps = [!text(page.proposedTitle || page.currentTitle) && "عنوان سئو", !text(page.proposedH1 || page.currentH1) && "H1", !text(page.proposedMeta || page.currentMeta) && "توضیحات متا"].filter(Boolean);
    if (gaps.length && text(page.pkw)) add({ id: `page:${page.id}:seo`, title: `اطلاعات سئوی «${name}» را کامل کنید`, reason: `${gaps.join("، ")} در اطلاعات ثبت‌شده وجود ندارد؛ وضعیت واقعی صفحه نیازمند بررسی شماست.`, priority: p, view: "pages", pageId: page.id });
    if (text(page.pkw) && !text(page.pageBrief) && !["Published", "Monitoring", "Complete"].includes(text(page.status))) add({ id: `page:${page.id}:brief`, title: `بریف «${name}» را آماده کنید`, reason: "هدف صفحه مشخص شده، ولی بریف ثبت نشده است. می‌توانید از پیش‌نویس مبتنی بر اطلاعات همین پروژه شروع کنید.", priority: p, view: "pages", pageId: page.id });
  }
  for (const content of project.content) {
    const name = text(content.topic || content.pkw || content.contentId) || "محتوای بدون نام";
    const due = toIsoDate(text(content.publishDate));
    const finished = ["Published", "Complete"].includes(text(content.writingStatus));
    if (due && due < today && !finished) add({ id: `content:${content.id}:overdue`, title: `زمان‌بندی «${name}» را بازبینی کنید`, reason: "تاریخ انتشار گذشته است و محتوا هنوز منتشرشده ثبت نشده؛ وضعیت یا تاریخ برنامه را اصلاح کنید.", priority: "P1", view: "content", contentId: content.id, ...(pages.has(text(content.targetPage)) ? { pageId: text(content.targetPage) } : {}) });
    else if (due === today && !finished) add({ id: `content:${content.id}:today`, title: `انتشار امروز: ${name}`, reason: "در برنامهٔ محتوا، امروز برای انتشار تعیین شده است. آمادگی و تأیید نهایی را بررسی کنید.", priority: "P1", view: "content", contentId: content.id });
    if (!finished) {
      const readiness = getContentReadiness(project, content);
      if (!readiness.ready) add({ id: `content:${content.id}:ready`, title: `اطلاعات تولید «${name}» را کامل کنید`, reason: `موارد باقی‌مانده: ${readiness.missing.join("، ")}.`, priority: "P2", view: "content", contentId: content.id });
    }
  }
  // Older snapshots must not keep a resolved decline in today's queue. Resolve
  // legacy display codes with the same latest-snapshot rule as page workspaces.
  const latestResults = [...resultLookup(project.results, project.pages).entries(), ...project.results.filter((row) => !text(row.pageId)).map((row): [string, Row] => [row.id, row])];
  for (const [id, result] of latestResults) {
    const page = pages.get(id);
    const clicks = result.clicks === "" || result.clicks == null ? null : Number(result.clicks);
    const previous = result.previousClicks === "" || result.previousClicks == null ? null : Number(result.previousClicks);
    const drop = Number.isFinite(clicks) && Number.isFinite(previous) && previous! > 0 && clicks! < previous! * .8;
    if (["Dropping", "Declining", "افت عملکرد"].includes(text(result.result)) || drop) {
      add({ id: `result:${id}:decline`, title: `افت عملکرد «${page ? pageName(page) : text(result.pkw || result.url) || "صفحه"}» را بررسی کنید`, reason: drop ? `کلیک ثبت‌شده از ${previous!.toLocaleString("fa-IR")} به ${clicks!.toLocaleString("fa-IR")} رسیده است. هم‌طول‌بودن دوره‌ها و فصل‌پذیری را قبل از نتیجه‌گیری بررسی کنید.` : "وضعیت این نتیجه در پروژه «افت عملکرد» ثبت شده است؛ علت افت از این داده به‌تنهایی مشخص نمی‌شود.", priority: "P1", view: "results", ...(page ? { pageId: page.id } : {}) });
    }
  }
  for (const insight of buildSearchConsoleInsights(project)) {
    const page = insight.pageId ? pages.get(insight.pageId) : undefined;
    const label = insight.query || (page ? pageName(page) : insight.url);
    add({ id: `gsc:${insight.evidence.periodStart}:${insight.evidence.periodEnd}:${insight.id}`, title: `${insight.title}${label ? `؛ ${label}` : ""}`, reason: `${insight.reason}\nدورهٔ داده: ${formatDate(insight.evidence.periodStart)} تا ${formatDate(insight.evidence.periodEnd)}؛ ${insight.evidence.clicks.toLocaleString("fa-IR")} کلیک و ${insight.evidence.impressions.toLocaleString("fa-IR")} نمایش.`, priority: insight.priority, view: "results", ...(insight.pageId ? { pageId: insight.pageId } : {}) });
  }
  return actions.sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id));
}

/** Produces an editable brief scaffold using only recorded data, never invented facts or competitor claims. */
export function buildBrief(project: Project, page: Row): Partial<Row> {
  const subject = text(page.pkw || page.target), name = pageName(page);
  const supporting = split(page.supporting);
  const relevant = new Set(pageKeywordPhrases(page));
  const questions = project.keywords.filter((keyword) => keyword.decision !== "Exclude" && (text(keyword.targetPage) === page.id || relevant.has(norm(keyword.keyword))) && /(?:چگونه|چطور|چیست|چرا|آیا|چه |کدام|\?|؟)/.test(text(keyword.keyword))).map((keyword) => text(keyword.keyword));
  const commercial = /(?:دسته|محصول|برند|خدمات|لندینگ|PLP|PDP|Service)/i.test(text(page.pageType));
  const sections = text(page.mainSections || page.h2Ideas || project.playbook?.briefTemplate) || (commercial ? ["معرفی و کاربرد", "معیارهای انتخاب", "گزینه‌ها و ویژگی‌های تأییدشده", "شرایط خرید یا دریافت خدمت", "پاسخ به پرسش‌های متداول"].join("\n") : ["پاسخ کوتاه به پرسش اصلی", "توضیح موضوع و پیش‌نیازها", "مراحل یا معیارهای بررسی", "محدودیت‌ها و نکات کاربردی", "پاسخ به پرسش‌های متداول"].join("\n"));
  return {
    pageBrief: boundedGeneratedText([`موضوع: ${name}`, `کلمهٔ اصلی: ${subject || "نیاز به انتخاب"}`, `نوع صفحه: ${text(page.pageType) || "نیاز به انتخاب"}`, `مخاطب: ${text(project.playbook?.audience || project.market) || "پیش از نگارش، مخاطب و نیاز او را مشخص کنید."}`, `هدف پروژه: ${text(project.goal || project.playbook?.conversionGoal) || "هدف کسب‌وکار و اقدام مورد انتظار را مشخص کنید."}`, supporting.length ? `عبارت‌های مرتبط ثبت‌شده: ${supporting.join("، ")}` : "عبارت‌های مرتبط: در صورت نیاز از کلمات همین پروژه انتخاب کنید.", "این پیش‌نویس باید با هدف جست‌وجو و اطلاعات واقعی کسب‌وکار بازبینی شود."].join("\n\n")),
    mainSections: sections,
    h2Ideas: text(page.h2Ideas) || sections,
    faq: text(page.faq) || boundedGeneratedText([...new Set(questions)].join("\n")),
    cta: text(page.cta || project.playbook?.conversionGoal) || (commercial ? "اقدام مورد انتظار و مسیر خرید یا درخواست خدمت را مشخص کنید." : "قدم بعدی متناسب با موضوع و نیاز خواننده را مشخص کنید."),
    contentNotes: text(page.contentNotes) || "راهنمای نویسنده: فقط از اطلاعات تأییدشده استفاده کنید؛ برای قیمت، ادعا، آمار و مشخصات منبع معتبر ثبت کنید. پاسخ روشن را بر تکرار کلمات ترجیح دهید. لینک‌های داخلی را در جای مرتبط پیشنهاد دهید.",
  };
}

export type LinkSuggestion = { id: string; fromPageId: string; toPageId: string; anchor: string; reason: string; sharedTopics: string[] };
export type PageOverlap = { id: string; pageIds: [string, string]; phrases: string[]; reason: string };
export type PageRelationshipAnalysis = { suggestions: LinkSuggestion[]; overlaps: PageOverlap[]; orphanPageIds: string[]; eligiblePageIds: string[] };
const stopwords = new Set(["صفحه", "دسته", "بندی", "خرید", "قیمت", "بهترین", "راهنما", "راهنمای", "برای", "های", "ها", "مقاله", "محصول", "محصولات", "آموزش", "معرفی", "بررسی", "چیست", "چگونه", "چطور", "این", "آن", "با", "از", "در", "و", "یا", "به"]);
const isArticle = (page: Row) => /(?:مقاله|راهنمای|مقایسه|Blog|Guide|Comparison|FAQ)/i.test(text(page.pageType));
export function canonicalPageUrl(value: unknown, domain: string): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const base = domain ? (/^https?:\/\//i.test(domain) ? domain : `https://${domain}`) : undefined;
    const url = new URL(raw, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}
function eligible(page: Row, project: Project): boolean {
  const url = canonicalPageUrl(page.url, project.domain);
  const projectUrl = canonicalPageUrl("/", project.domain);
  const sameSite = !projectUrl || Boolean(url && new URL(url).hostname.replace(/^www\./, "") === new URL(projectUrl).hostname.replace(/^www\./, ""));
  return Boolean(url) && sameSite && (page.existing === "Existing" || ["Published", "Monitoring", "Complete"].includes(text(page.status)) || page.executionStatus === "Published");
}

/** Bounded inverted indexes avoid comparing every page with every other page. */
export function analyzePageRelationships(project: WorkflowProject): PageRelationshipAnalysis {
  const pages = new Map(project.pages.map((page) => [page.id, page]));
  const phrases = new Map<string, string[]>();
  const overlaps = new Map<string, PageOverlap>();
  for (const page of project.pages) for (const phrase of pageKeywordPhrases(page)) {
    const owners = phrases.get(phrase) || [];
    for (const owner of owners.slice(0, 20)) {
      if (overlaps.size >= 500) break;
      const ids = [owner, page.id].sort() as [string, string], key = ids.join(":");
      const old = overlaps.get(key);
      if (old) { if (old.phrases.length < 8) old.phrases.push(phrase); }
      else overlaps.set(key, { id: `overlap:${key}`, pageIds: ids, phrases: [phrase], reason: "یک عبارت دقیق در هدف‌گذاری هر دو صفحه ثبت شده است؛ بررسی نیت و دادهٔ جست‌وجو برای تصمیم ادغام یا تفکیک لازم است." });
    }
    owners.push(page.id); phrases.set(phrase, owners);
  }
  const eligiblePages = project.pages.filter((page) => eligible(page, project));
  const eligibleIds = new Set(eligiblePages.map((page) => page.id));
  const links = (project.links || []).filter((link) => pages.has(text(link.fromPageId)) && pages.has(text(link.toPageId)) && link.fromPageId !== link.toPageId);
  const recorded = new Set(links.map((link) => `${link.fromPageId}:${link.toPageId}`));
  const incoming = new Set(links.filter((link) => link.status === "implemented" && eligibleIds.has(text(link.fromPageId)) && eligibleIds.has(text(link.toPageId)) && canonicalPageUrl(pages.get(text(link.fromPageId))!.url, project.domain) !== canonicalPageUrl(pages.get(text(link.toPageId))!.url, project.domain)).map((link) => text(link.toPageId)));
  // Legacy notes can confirm registered links; unregistered web links cannot be inferred.
  for (const target of eligiblePages) {
    const note = norm(target.linksIn);
    const explicitlyAbsent = /^(?:0|none|no links?|ندارد|خیر|[—-]|بدون لینک(?: ورودی)?|(?:هیچ )?لینک(?: ورودی)?ی? ندارد)$/u.test(note);
    if (note && !explicitlyAbsent) incoming.add(target.id);
  }
  const topics = new Map<string, Set<string>>(), index = new Map<string, string[]>();
  for (const page of eligiblePages) {
    const tokens = new Set([text(page.pkw), ...split(page.supporting)].join(" ").split(/\s+/).map(norm).filter((token) => token.length >= 2 && !stopwords.has(token)));
    topics.set(page.id, tokens);
    const entries = [...tokens].slice(0, 40);
    if (text(page.linkCluster || page.cluster)) entries.push(`cluster:${norm(page.linkCluster || page.cluster)}`);
    if (text(page.pillar)) entries.push(`pillar:${norm(page.pillar)}`);
    for (const token of entries) { const list = index.get(token) || []; if (list.length < 201) list.push(page.id); index.set(token, list); }
  }
  const suggestions: LinkSuggestion[] = [];
  for (const source of eligiblePages) {
    const candidates = new Set<string>();
    const keys = [...(topics.get(source.id) || [])].slice(0, 40);
    if (text(source.linkCluster || source.cluster)) keys.push(`cluster:${norm(source.linkCluster || source.cluster)}`);
    if (text(source.pillar)) keys.push(`pillar:${norm(source.pillar)}`);
    for (const key of keys) {
      const matches = index.get(key) || [];
      if (matches.length > 200) continue;
      for (const id of matches) if (id !== source.id && candidates.size < 100) candidates.add(id);
    }
    const ranked: Array<LinkSuggestion & { weight: number }> = [];
    for (const id of candidates) {
      const target = pages.get(id)!;
      if (recorded.has(`${source.id}:${id}`) || canonicalPageUrl(source.url, project.domain) === canonicalPageUrl(target.url, project.domain)) continue;
      if (new URL(canonicalPageUrl(source.url, project.domain)!).hostname.replace(/^www\./, "") !== new URL(canonicalPageUrl(target.url, project.domain)!).hostname.replace(/^www\./, "")) continue;
      const shared = [...(topics.get(source.id) || [])].filter((word) => topics.get(id)?.has(word));
      const sameCluster = Boolean(text(source.linkCluster || source.cluster)) && norm(source.linkCluster || source.cluster) === norm(target.linkCluster || target.cluster);
      const samePillar = Boolean(text(source.pillar)) && norm(source.pillar) === norm(target.pillar);
      const explicitPillar = norm(source.pillar) === norm(target.pkw) && Boolean(text(source.pillar));
      if (shared.length < 2 && !sameCluster && !samePillar && !explicitPillar) continue;
      // Editorial sources get precedence; no automatic assumption that every commercial page should cross-link.
      const editorial = isArticle(source) && !isArticle(target);
      const reason = [sameCluster && "خوشهٔ مشترک ثبت‌شده", (samePillar || explicitPillar) && "موضوع مادر مرتبط", shared.length >= 2 && `واژه‌های مشترک: ${shared.slice(0, 4).join("، ")}`, editorial && "اتصال محتوای راهنما به صفحهٔ مرتبط"].filter(Boolean).join("؛ ");
      ranked.push({ id: `link:${source.id}:${id}`, fromPageId: source.id, toPageId: id, anchor: text(target.pkw || target.target), reason, sharedTopics: shared.slice(0, 6), weight: (sameCluster ? 4 : 0) + (samePillar || explicitPillar ? 4 : 0) + Math.min(4, shared.length) + (editorial ? 3 : 0) });
    }
    ranked.sort((a, b) => b.weight - a.weight || a.toPageId.localeCompare(b.toPageId));
    for (const { weight: _weight, ...suggestion } of ranked.slice(0, 3)) { if (suggestions.length < 300) suggestions.push(suggestion); }
  }
  return { suggestions, overlaps: [...overlaps.values()], orphanPageIds: eligiblePages.filter((page) => !incoming.has(page.id)).map((page) => page.id), eligiblePageIds: [...eligibleIds] };
}
