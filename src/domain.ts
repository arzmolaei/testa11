import type {
  Collection,
  Field,
  Project,
  Row,
  Section,
  Settings,
  Store,
} from "./types";
import { todayIso, toIsoDate } from "./dates";
import { validateProjectExtras, validateSavedPlaybooks } from "./project-data";

export const DEFAULT_SETTINGS: Settings = {
  titleMin: 30,
  titleMax: 60,
  metaMin: 120,
  metaMax: 160,
};

export const LISTS = {
  kd: ["آسان", "آسان تا متوسط", "متوسط", "متوسط تا سخت", "سخت"],
  intent: [
    "اطلاعاتی",
    "بررسی تجاری",
    "تراکنشی",
    "ناوبری",
    "ترکیبی",
    "نیاز به بررسی",
  ],
  decision: ["Keep", "Review", "Exclude"],
  pageType: [
    "دسته‌بندی محصول",
    "برند",
    "محصول",
    "مقاله",
    "راهنمای خرید",
    "مقایسه",
    "لندینگ",
    "خدمات",
    "برچسب / آرشیو",
    "صفحه اصلی",
    "FAQ",
    "Other",
    "Needs Review",
  ],
  existing: ["Existing", "New", "Unknown"],
  pageAction: [
    "Optimize Existing",
    "Create New",
    "Merge / Consolidate",
    "No Dedicated Page",
    "Needs Review",
  ],
  priority: ["P0", "P1", "P2", "P3", "Backlog"],
  pageStatus: [
    "Not Started",
    "Mapping",
    "SERP Review",
    "Ready",
    "In Progress",
    "Review",
    "Published",
    "Monitoring",
    "Complete",
  ],
  contentType: [
    "Blog",
    "Buying Guide",
    "Comparison",
    "PDP",
    "PLP",
    "Landing Page",
    "Service",
    "FAQ",
    "Other",
  ],
  contentStatus: [
    "Not Started",
    "Research",
    "Brief Ready",
    "Writing",
    "Editing",
    "Ready",
    "Published",
    "Optimizing",
    "Complete",
  ],
  briefStatus: ["Not Started", "Research", "Brief Ready", "Review"],
  result: [
    "Improving",
    "Stable",
    "Dropping",
    "Needs Work",
    "Not Enough Data",
    "Complete",
  ],
  serpStatus: ["Not Checked", "In Review", "Checked", "Needs Review"],
  technicalStatus: ["Not Checked", "Pass", "Needs Work", "Not Applicable"],
  yesNo: ["Yes", "No", "Unknown"],
  samePage: ["Same Page", "Separate Page", "No Dedicated Page", "Needs Review"],
  risk: ["Low", "Medium", "High", "Needs Review"],
  linkStatus: ["Not Started", "In Progress", "Complete", "Not Applicable"],
  executionStatus: [
    "Not Started",
    "In Progress",
    "Review",
    "Ready",
    "Published",
    "Complete",
  ],
  source: [
    "Manual",
    "Search Console",
    "KeywordTool.io",
    "KWFinder",
    "Semrush",
    "JetSEO",
    "Other",
  ],
  projectType: [
    "Ecommerce",
    "Content / Blog",
    "Service",
    "Local SEO",
    "Marketplace",
    "Mixed",
  ],
};

const f = (
  key: string,
  label: string,
  type: Field["type"] = "text",
  options?: string[],
  hint?: string,
  calculated?: boolean,
): Field => ({
  key,
  label,
  type,
  ...(options ? { options } : {}),
  ...(hint ? { hint } : {}),
  ...(calculated ? { calculated } : {}),
});
const select = (key: string, label: string, options: string[], hint?: string) =>
  f(key, label, "select", options, hint);
const number = (key: string, label: string, hint?: string) =>
  f(key, label, "number", undefined, hint);
const note = (key: string, label: string, hint?: string) =>
  f(key, label, "textarea", undefined, hint);
const date = (key: string, label: string) => f(key, label, "date");
const calc = (key: string, label: string, hint?: string) =>
  f(key, label, "text", undefined, hint, true);

export const SCHEMAS: Record<Collection, Section[]> = {
  keywords: [
    {
      key: "core",
      label: "اطلاعات اصلی",
      fields: [
        f(
          "keyword",
          "کلمه کلیدی",
          "text",
          undefined,
          "هر ردیف یک عبارت مستقل است؛ عبارت‌های مشابه را خودکار یکی نمی‌کنیم.",
        ),
        number(
          "volume",
          "حجم جست‌وجو",
          "تخمین تعداد جست‌وجو در ماه؛ صفر هم یک مقدار معتبر است.",
        ),
        select(
          "kd",
          "سختی کلمه",
          LISTS.kd,
          "ارزیابی دستی شما؛ سختی عددی ابزار جدا نگه داشته می‌شود.",
        ),
        select("intent", "نیت جست‌وجو", LISTS.intent),
        select("decision", "تصمیم", LISTS.decision),
        f(
          "group",
          "گروه / هدف",
          "text",
          undefined,
          "عبارت‌هایی که احتمالاً یک صفحه مشترک دارند؛ پس از بررسی نتایج جست‌وجو تصمیم بگیرید.",
        ),
        note("notes", "یادداشت"),
        f("targetPage", "صفحه هدف", "select"),
      ],
    },
    {
      key: "metrics",
      label: "معیارهای پژوهش",
      fields: [
        select("source", "منبع", LISTS.source),
        number("kdKwf", "KD — KWFinder"),
        number("kdTool", "KD — Semrush / ابزار"),
        number("kdJetSeo", "KD — JetSEO"),
        number("cpc", "هزینه هر کلیک"),
        f("trend", "روند جست‌وجو"),
        f("toolIntent", "نیت گزارش‌شده ابزار"),
        f("volumeSource", "منبع حجم جست‌وجو"),
        date("metricUpdated", "آخرین به‌روزرسانی معیارها"),
      ],
    },
    {
      key: "serp",
      label: "بررسی نتایج جست‌وجو",
      fields: [
        select("serpChecked", "وضعیت بررسی SERP", LISTS.serpStatus),
        f("observedSerpType", "نوع صفحه در نتایج"),
        note("serpNotes", "یادداشت SERP"),
        f("competitorUrl", "URL رقیب", "url"),
        date("serpReviewDate", "تاریخ بررسی"),
      ],
    },
    {
      key: "custom",
      label: "فیلدهای اختصاصی",
      fields: Array.from({ length: 10 }, (_, i) =>
        f(
          `custom${String(i + 1).padStart(2, "0")}`,
          `فیلد اختصاصی ${String(i + 1).padStart(2, "0")}`,
        ),
      ),
    },
  ],
  pages: [
    {
      key: "core",
      label: "هدف‌گذاری اصلی",
      fields: [
        f(
          "pageId",
          "شناسه نمایشی صفحه",
          "text",
          undefined,
          "این کد برای نمایش است؛ ارتباط داده‌ها با شناسه ثابت داخلی انجام می‌شود.",
        ),
        f("target", "صفحه / هدف"),
        f(
          "pkw",
          "کلمه کلیدی اصلی (PKW)",
          "text",
          undefined,
          "عبارت اصلی صفحه را با قضاوت سئو انتخاب کنید؛ بیشترین حجم به‌تنهایی کافی نیست.",
        ),
        note(
          "supporting",
          "کلمات پشتیبان",
          "کلماتی که همین صفحه آن‌ها را هدف می‌گیرد؛ هر عبارت در یک خط.",
        ),
        select("pageType", "نوع صفحه", LISTS.pageType),
        select("existing", "موجود / جدید", LISTS.existing),
        f("url", "URL هدف", "url"),
        select("action", "اقدام صفحه", LISTS.pageAction),
        select("priority", "اولویت", LISTS.priority),
        select("status", "وضعیت", LISTS.pageStatus),
        calc("nextAction", "اقدام بعدی"),
        note("notes", "یادداشت"),
      ],
    },
    {
      key: "advancedKeywords",
      label: "کلمات پیشرفته و خوشه",
      fields: [
        note("akw", "عبارت جایگزین (AKW)"),
        note("skw", "کلمه ثانویه (SKW)"),
        note("moreKeywords", "کلمات بیشتر"),
        f("cluster", "خوشه"),
        number("clusterVolume", "حجم کل خوشه"),
      ],
    },
    {
      key: "serp",
      label: "اعتبارسنجی SERP",
      fields: [
        select("serpCheck", "بررسی SERP", LISTS.serpStatus),
        select("intentConfirmed", "نیت جست‌وجو تأیید شد؟", LISTS.yesNo),
        select("expectedPageType", "نوع صفحه مناسب نتایج", LISTS.pageType),
        select("samePageDecision", "همان صفحه / صفحه مستقل", LISTS.samePage),
        select("cannibalizationRisk", "ریسک هم‌نوع‌خواری", LISTS.risk),
        note("competitorNotes", "یادداشت رقبا"),
        f("serpDecision", "تصمیم SERP"),
        date("serpReviewDate", "تاریخ بررسی"),
      ],
    },
    {
      key: "onPage",
      label: "سئوی داخل صفحه",
      fields: [
        f("currentTitle", "عنوان سئوی فعلی"),
        f("proposedTitle", "عنوان سئوی پیشنهادی"),
        calc("titleLength", "طول عنوان"),
        calc(
          "titleReview",
          "سیگنال بررسی عنوان",
          "طول عنوان یک راهنمای بازبینی است، نه امتیاز رتبه‌بندی.",
        ),
        f("currentH1", "H1 فعلی"),
        f("proposedH1", "H1 پیشنهادی"),
        calc("pkwInH1", "PKW در H1؟"),
        note("currentMeta", "توضیحات متای فعلی"),
        note("proposedMeta", "توضیحات متای پیشنهادی"),
        calc("metaLength", "طول متا"),
        calc("metaReview", "سیگنال بررسی متا"),
      ],
    },
    {
      key: "pageContent",
      label: "ساختار و بریف صفحه",
      fields: [
        note("pageBrief", "بریف صفحه"),
        note("mainSections", "بخش‌های اصلی"),
        note("h2Ideas", "ایده‌های H2"),
        note("faq", "پرسش‌های متداول"),
        f("cta", "دعوت به اقدام"),
        note("productsToShow", "محصول / دسته برای نمایش"),
        note("contentNotes", "یادداشت محتوا"),
      ],
    },
    {
      key: "internalLinks",
      label: "لینک‌سازی داخلی",
      fields: [
        note("linksIn", "لینک‌های ورودی"),
        note("linksOut", "لینک‌های خروجی"),
        note("anchorNotes", "یادداشت انکر"),
        f("pillar", "موضوع مادر (Pillar)"),
        f("linkCluster", "خوشه لینک‌سازی"),
        select("internalLinkingStatus", "وضعیت لینک‌سازی", LISTS.linkStatus),
      ],
    },
    {
      key: "technical",
      label: "چک‌لیست فنی",
      fields: [
        select("indexable", "قابل ایندکس", LISTS.technicalStatus),
        select("canonical", "کنونیکال", LISTS.technicalStatus),
        select("robots", "Robots", LISTS.technicalStatus),
        select("breadcrumb", "مسیر راهنما", LISTS.technicalStatus),
        select("schema", "داده ساختاریافته", LISTS.technicalStatus),
        select("mobileCheck", "بررسی موبایل", LISTS.technicalStatus),
        select("speedCheck", "بررسی سرعت", LISTS.technicalStatus),
        note("technicalNotes", "یادداشت فنی"),
      ],
    },
    {
      key: "execution",
      label: "اجرا و انتشار",
      fields: [
        f("owner", "مسئول"),
        date("startDate", "تاریخ شروع"),
        date("publishDate", "تاریخ انتشار / به‌روزرسانی"),
        select("executionStatus", "وضعیت اجرا", LISTS.executionStatus),
        date("lastUpdated", "آخرین به‌روزرسانی"),
        note("executionNotes", "یادداشت اجرا"),
      ],
    },
  ],
  content: [
    {
      key: "core",
      label: "برنامه تولید محتوا",
      fields: [
        f("contentId", "شناسه محتوا"),
        f(
          "targetPage",
          "صفحه هدف",
          "text",
          undefined,
          "ارجاع ثابت به یک صفحه از نقشه صفحات.",
        ),
        f("pkw", "کلمه کلیدی اصلی"),
        select("contentType", "نوع محتوا", LISTS.contentType),
        f("topic", "عنوان / موضوع"),
        f("pillar", "موضوع مادر"),
        f("cluster", "خوشه"),
        select("briefStatus", "وضعیت بریف", LISTS.briefStatus),
        select("writingStatus", "وضعیت نگارش", LISTS.contentStatus),
        f("owner", "مسئول"),
        date("publishDate", "تاریخ انتشار"),
        f("internalLinkTarget", "هدف لینک داخلی"),
        note("notes", "یادداشت"),
      ],
    },
    {
      key: "detail",
      label: "جزئیات تولید محتوا",
      fields: [
        note("h2Ideas", "ایده‌های H2"),
        note("faq", "پرسش‌های متداول"),
        note("competitorNotes", "یادداشت رقبا"),
        note("entities", "موجودیت‌ها / موضوعات"),
        note("sources", "منابع"),
        f("cta", "دعوت به اقدام"),
        note("internalLinkNotes", "یادداشت لینک داخلی"),
      ],
    },
  ],
  results: [
    {
      key: "core",
      label: "عملکرد صفحه",
      fields: [
        f(
          "pageId",
          "صفحه مرتبط",
          "text",
          undefined,
          "ارجاع ثابت به صفحه؛ URL یا ترتیب ردیف، هویت داده نیست.",
        ),
        f("url", "URL", "url"),
        f("pkw", "کلمه کلیدی اصلی"),
        date("baselineDate", "تاریخ مبنا"),
        number("clicks", "کلیک"),
        number("impressions", "نمایش"),
        number("ctr", "CTR (%)", "درصد کلیک، مثلاً ۲٫۵ برای ۲٫۵ درصد."),
        number(
          "position",
          "میانگین رتبه",
          "کمتر شدن میانگین رتبه معمولاً بهتر است.",
        ),
        number("conversions", "تبدیل / فروش"),
        select("result", "نتیجه", LISTS.result),
        calc("nextAction", "اقدام بعدی"),
        date("lastChecked", "آخرین بررسی"),
      ],
    },
    {
      key: "comparison",
      label: "مقایسه با دوره قبل",
      fields: [
        number("previousClicks", "کلیک قبلی"),
        number("previousImpressions", "نمایش قبلی"),
        number("previousCtr", "CTR قبلی (%)"),
        number("previousPosition", "رتبه قبلی"),
        calc("clicksChange", "تغییر کلیک"),
        calc("impressionsChange", "تغییر نمایش"),
        calc("ctrChange", "تغییر CTR (واحد درصد)"),
        calc(
          "positionChange",
          "بهبود رتبه",
          "رتبه قبلی منهای رتبه فعلی؛ عدد مثبت یعنی بهبود.",
        ),
        note("notes", "یادداشت"),
      ],
    },
  ],
};

/** Technical equality only: spelling, intent, stemming and synonyms are untouched. */
export function normalizeKeyword(text: string): string {
  return String(text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u0640\u064b-\u065f\u0670\u06d6-\u06ed]/g, "")
    .replace(/\u200c/g, " ")
    .replace(/[\u200d\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function uid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues)
    return Array.from(
      globalThis.crypto.getRandomValues(new Uint8Array(16)),
      (n) => n.toString(16).padStart(2, "0"),
    ).join("");
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function createProject(name = "پروژه جدید"): Project {
  return {
    id: uid(),
    name,
    domain: "",
    market: "ایران",
    language: "فارسی",
    projectType: "Ecommerce",
    goal: "",
    startDate: todayIso(),
    lastReview: "",
    keywords: [],
    pages: [],
    content: [],
    results: [],
  };
}

const present = (value: unknown): boolean =>
  value !== undefined && value !== null && String(value).trim() !== "";
const str = (value: unknown): string => String(value ?? "").trim();
const oneOf = (value: unknown, list: string[]) => list.includes(str(value));
const checked = (value: unknown) =>
  oneOf(value, [
    "Checked",
    "Complete",
    "Pass",
    "Yes",
    "تأیید شده",
    "بررسی شده",
  ]);
const published = (row: Row) =>
  oneOf(row.status, ["Published", "Monitoring", "Complete"]) ||
  oneOf(row.executionStatus, ["Published", "Complete"]);

export function nextKeyword(row: Row): string {
  if (!present(row.keyword)) return "کلمه کلیدی را وارد کنید";
  if (row.decision === "Exclude") return "کنار گذاشته شده";
  if (!present(row.volume)) return "حجم جست‌وجو را ثبت کنید";
  if (!present(row.kd)) return "سختی کلمه را ارزیابی کنید";
  if (!present(row.intent) || row.intent === "نیاز به بررسی")
    return "نیت جست‌وجو را مشخص کنید";
  if (!present(row.decision) || row.decision === "Review")
    return "تصمیم نگه‌داشتن یا حذف را بگیرید";
  if (!present(row.group)) return "گروه کلمه را مشخص کنید";
  return "آماده هدف‌گذاری صفحه";
}

/** Signals guide the workflow; title/meta length never prevents publishing. */
export function nextPage(
  row: Row,
  _settings: Settings = DEFAULT_SETTINGS,
  keyword?: Row,
  result?: Row,
): string {
  if (!present(row.target)) return "هدف صفحه را مشخص کنید";
  if (row.action === "No Dedicated Page") return "صفحه مستقل نیاز ندارد";
  if (row.status === "Complete") return "تکمیل شده";
  if (published(row))
    return result ? nextResult(result) : "داده‌های سرچ کنسول را ثبت کنید";
  if (!present(row.pkw)) return "کلمه کلیدی اصلی را انتخاب کنید";
  if (keyword) {
    const action = nextKeyword(keyword);
    if (action !== "آماده هدف‌گذاری صفحه" && action !== "کنار گذاشته شده")
      return action;
    if (keyword.decision === "Exclude") return "کلمه اصلی صفحه را بازبینی کنید";
  }
  if (!checked(row.serpCheck)) return "نتایج جست‌وجو را بررسی کنید";
  if (!present(row.pageType) || row.pageType === "Needs Review")
    return "نوع صفحه را انتخاب کنید";
  if (!present(row.existing) || row.existing === "Unknown")
    return "موجود یا جدید بودن صفحه را مشخص کنید";
  if (!present(row.action) || row.action === "Needs Review")
    return "اقدام صفحه را انتخاب کنید";
  if (!present(row.url)) return "URL هدف را انتخاب کنید";
  if (!present(row.proposedTitle) && !present(row.currentTitle))
    return "عنوان سئو را بنویسید";
  if (!present(row.proposedH1) && !present(row.currentH1))
    return "عنوان H1 را بنویسید";
  if (!present(row.proposedMeta) && !present(row.currentMeta))
    return "توضیحات متا را بنویسید";
  if (!present(row.pageBrief)) return "بریف و ساختار صفحه را آماده کنید";
  if (
    !oneOf(row.status, ["In Progress", "Review", "Ready"]) &&
    !oneOf(row.executionStatus, ["In Progress", "Review", "Ready"])
  )
    return "صفحه را ایجاد یا بهینه کنید";
  if (!oneOf(row.internalLinkingStatus, ["Complete", "Not Applicable"]))
    return "لینک‌های داخلی را تکمیل کنید";
  const requiredTechnical = [
    "indexable",
    "canonical",
    "robots",
    "breadcrumb",
    "schema",
    "mobileCheck",
    "speedCheck",
  ];
  if (
    !requiredTechnical.every((key) =>
      oneOf(row[key], ["Pass", "Not Applicable"]),
    )
  )
    return "چک‌لیست فنی را بررسی کنید";
  return "صفحه را منتشر یا به‌روزرسانی کنید";
}

export function nextResult(row: Row): string {
  if (row.result === "Complete") return "تکمیل شده";
  if (!present(row.url) && !present(row.pageId))
    return "صفحه پایش را انتخاب کنید";
  if (!present(row.baselineDate)) return "تاریخ مبنا را ثبت کنید";
  if (
    !present(row.clicks) ||
    !present(row.impressions) ||
    !present(row.position)
  )
    return "داده‌های سرچ کنسول را ثبت کنید";
  if (row.result === "Not Enough Data" || Number(row.impressions) < 30)
    return "برای داده بیشتر صبر کنید";
  if (row.result === "Dropping")
    return "افت عملکرد و تغییرات صفحه را بررسی کنید";
  if (row.result === "Needs Work") return "صفحه را بهبود دهید";
  if (!present(row.result)) return "نتیجه را بررسی و ثبت کنید";
  if (
    Number(row.impressions) >= 100 &&
    present(row.ctr) &&
    Number(row.ctr) < 1 &&
    Number(row.position) <= 10
  )
    return "عنوان و متا را برای بهبود CTR بازبینی کنید";
  return "نتایج دوره بعد را پایش کنید";
}

/** Map normalized keywords to their occurrence count; includes singletons. */
export function duplicates(rows: Row[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeKeyword(str(row.keyword));
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Technical duplicates remain visible, but never become an arbitrary source of SEO decisions. */
export function keywordLookup(rows: Row[]): Map<string, Row> {
  const counts = duplicates(rows);
  const unique = new Map<string, Row>();
  for (const row of rows) {
    const key = normalizeKeyword(str(row.keyword));
    if (key && counts.get(key) === 1) unique.set(key, row);
  }
  return unique;
}

/** Resolve legacy display codes where possible; stable IDs always take precedence. */
export function resultLookup(rows: Row[], pages: Row[] = []): Map<string, Row> {
  const pageIds = new Set(pages.map((page) => page.id));
  const codes = new Map<string, string>();
  const codeCounts = new Map<string, number>();
  for (const page of pages) {
    const code = str(page.pageId);
    if (code) {
      codes.set(code, page.id);
      codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
    }
  }
  const lookup = new Map<string, Row>();
  const stamp = (row: Row) => {
    const parsed = Date.parse(str(row.lastChecked));
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  for (const row of rows) {
    const reference = str(row.pageId);
    if (!reference) continue;
    const key = pageIds.has(reference)
      ? reference
      : codeCounts.get(reference) === 1
        ? codes.get(reference)!
        : reference;
    const previous = lookup.get(key);
    if (
      !previous ||
      stamp(row) > stamp(previous) ||
      (stamp(row) === stamp(previous) && row.id < previous.id)
    )
      lookup.set(key, row);
  }
  return lookup;
}

/** Shared contextual guidance for the dashboard and row workspaces. */
export function projectPageAction(
  project: Project,
  row: Row,
  settings: Settings = DEFAULT_SETTINGS,
): string {
  return nextPage(
    row,
    settings,
    keywordLookup(project.keywords).get(normalizeKeyword(str(row.pkw))),
    resultLookup(project.results, project.pages).get(row.id),
  );
}

export function fieldValue(
  row: Row,
  fieldKey: string,
  settings: Settings = DEFAULT_SETTINGS,
): string | number {
  const title = str(row.proposedTitle || row.currentTitle);
  const meta = str(row.proposedMeta || row.currentMeta);
  const len = (text: string) => Array.from(text).length;
  const review = (text: string, min: number, max: number) =>
    !text
      ? "ثبت نشده"
      : len(text) < min
        ? "کوتاه؛ بازبینی کنید"
        : len(text) > max
          ? "بلند؛ بازبینی کنید"
          : "در محدوده پیشنهادی";
  if (fieldKey === "titleLength") return title ? len(title) : "";
  if (fieldKey === "metaLength") return meta ? len(meta) : "";
  if (fieldKey === "titleReview")
    return review(title, settings.titleMin, settings.titleMax);
  if (fieldKey === "metaReview")
    return review(meta, settings.metaMin, settings.metaMax);
  if (fieldKey === "pkwInH1") {
    const h1 = normalizeKeyword(str(row.proposedH1 || row.currentH1));
    const pkw = normalizeKeyword(str(row.pkw));
    return !h1 || !pkw ? "ثبت نشده" : h1.includes(pkw) ? "بله" : "بازبینی کنید";
  }
  const pairs: Record<string, [string, string]> = {
    clicksChange: ["clicks", "previousClicks"],
    impressionsChange: ["impressions", "previousImpressions"],
    ctrChange: ["ctr", "previousCtr"],
    positionChange: ["previousPosition", "position"],
  };
  if (pairs[fieldKey]) {
    const [current, previous] = pairs[fieldKey];
    return present(row[current]) && present(row[previous])
      ? Math.round((Number(row[current]) - Number(row[previous])) * 100) / 100
      : "";
  }
  if (fieldKey === "nextAction")
    return "target" in row ? nextPage(row, settings) : nextResult(row);
  return row[fieldKey] ?? "";
}

/** Counts are facts, not SEO scores. Stage is the first unfinished step. */
export function summarize(
  project: Project,
  settings: Settings = DEFAULT_SETTINGS,
) {
  const keywordMap = keywordLookup(project.keywords);
  const resultMap = resultLookup(project.results, project.pages);
  const pageAction = (row: Row) =>
    nextPage(
      row,
      settings,
      keywordMap.get(normalizeKeyword(str(row.pkw))),
      resultMap.get(row.id),
    );
  const kept = project.keywords.filter((row) => row.decision !== "Exclude");
  const reviewed = project.keywords.filter((row) =>
    oneOf(row.decision, ["Keep", "Exclude"]),
  ).length;
  const grouped = kept.filter((row) => present(row.group)).length;
  const livePages = project.pages.filter(
    (row) => row.action !== "No Dedicated Page",
  );
  const mapped = livePages.filter(
    (row) =>
      present(row.pkw) &&
      present(row.pageType) &&
      row.pageType !== "Needs Review" &&
      present(row.url) &&
      checked(row.serpCheck),
  ).length;
  const optimized = livePages.filter(
    (row) =>
      present(row.proposedTitle || row.currentTitle) &&
      present(row.proposedH1 || row.currentH1) &&
      present(row.proposedMeta || row.currentMeta),
  ).length;
  const publishedCount = livePages.filter(published).length;
  const ready = livePages.filter((row) =>
    oneOf(row.status, [
      "Ready",
      "In Progress",
      "Review",
      "Published",
      "Monitoring",
      "Complete",
    ]),
  ).length;
  const monitored = project.results.filter(
    (row) => present(row.clicks) && present(row.impressions),
  ).length;
  const names = [
    "پژوهش کلمات",
    "نقشه صفحات",
    "سئوی داخل صفحه",
    "اجرا و انتشار",
    "نتایج و بهبود",
  ];
  const unfinishedKeyword = kept.find(
    (row) => nextKeyword(row) !== "آماده هدف‌گذاری صفحه",
  );
  let stage = 5;
  if (!project.keywords.length || unfinishedKeyword) stage = 1;
  else if (!livePages.length || mapped < livePages.length) stage = 2;
  else if (optimized < livePages.length) stage = 3;
  else if (publishedCount < livePages.length) stage = 4;
  const stageTitle = names[stage - 1];
  const firstPendingPage = livePages.find((row) => !published(row));
  const action =
    stage === 1
      ? unfinishedKeyword
        ? nextKeyword(unfinishedKeyword)
        : "اولین کلمه کلیدی را اضافه کنید"
      : stage === 2 && !livePages.length
        ? "برای یک گروه، صفحه هدف بسازید"
        : stage < 5 && firstPendingPage
          ? pageAction(firstPendingPage)
          : livePages.find((row) => published(row) && row.status !== "Complete")
            ? pageAction(
                livePages.find(
                  (row) => published(row) && row.status !== "Complete",
                )!,
              )
            : project.results.length
              ? nextResult(
                  project.results.find((row) => row.result !== "Complete") ??
                    project.results[0],
                )
              : "داده‌های سرچ کنسول را ثبت کنید";
  const counts = duplicates(project.keywords);
  const duplicateRows = project.keywords.filter(
    (row) => (counts.get(normalizeKeyword(str(row.keyword))) ?? 0) > 1,
  ).length;
  const totals = {
    keywords: project.keywords.length,
    reviewed,
    grouped,
    pages: project.pages.length,
    mapped,
    ready,
    optimized,
    published: publishedCount,
    monitored,
    content: project.content.length,
  };
  const pending =
    kept.filter((row) => nextKeyword(row) !== "آماده هدف‌گذاری صفحه").length +
    livePages.filter((row) => !published(row)).length;
  const pipeline = [
    {
      key: "keywords",
      label: names[0],
      total: project.keywords.length,
      done: reviewed,
    },
    { key: "mapping", label: names[1], total: livePages.length, done: mapped },
    {
      key: "onPage",
      label: names[2],
      total: livePages.length,
      done: optimized,
    },
    {
      key: "execution",
      label: names[3],
      total: livePages.length,
      done: publishedCount,
    },
    { key: "results", label: names[4], total: publishedCount, done: monitored },
  ];
  return {
    totals,
    stage,
    stageTitle,
    nextStage: names[Math.min(stage, 4)],
    action,
    duplicateRows,
    pending,
    pipeline,
  };
}

export function demoStore(): Store {
  const project = createProject("دوربین۲۴");
  Object.assign(project, {
    domain: "dorbin24.com",
    goal: "رشد فروش ارگانیک دوربین‌های مداربسته و تجهیزات امنیتی",
    lastReview: todayIso(),
  });
  project.keywords = [
    {
      id: uid(),
      keyword: "دوربین مداربسته",
      volume: 12100,
      kd: "متوسط تا سخت",
      intent: "بررسی تجاری",
      decision: "Keep",
      group: "دوربین مداربسته",
      source: "Manual",
      notes: "داده نمایشی؛ معیارها را با گزارش واقعی جایگزین کنید.",
    },
    {
      id: uid(),
      keyword: "خرید دوربین مداربسته",
      volume: 2400,
      kd: "متوسط",
      intent: "تراکنشی",
      decision: "Keep",
      group: "دوربین مداربسته",
      notes: "با صفحه دسته‌بندی هدف‌گذاری می‌شود؛ تأیید نهایی با بررسی SERP.",
    },
    {
      id: uid(),
      keyword: "قیمت دوربین مداربسته",
      volume: 3600,
      kd: "متوسط",
      intent: "بررسی تجاری",
      decision: "Keep",
      group: "دوربین مداربسته",
    },
    {
      id: uid(),
      keyword: "دوربین داهوا",
      volume: 1900,
      kd: "آسان تا متوسط",
      intent: "بررسی تجاری",
      decision: "Keep",
      group: "داهوا",
    },
    {
      id: uid(),
      keyword: "بهترین دوربین مداربسته برای منزل",
      volume: 720,
      kd: "آسان",
      intent: "اطلاعاتی",
      decision: "Keep",
      group: "راهنمای دوربین منزل",
    },
    {
      id: uid(),
      keyword: "دوربین تحت شبکه",
      volume: 1300,
      decision: "Review",
      notes: "نیت جست‌وجو و رقابت را بررسی کنید.",
    },
  ];
  const category: Row = {
    id: uid(),
    pageId: "P-001",
    target: "دسته‌بندی دوربین مداربسته",
    pkw: "دوربین مداربسته",
    supporting: "خرید دوربین مداربسته\nقیمت دوربین مداربسته",
    pageType: "دسته‌بندی محصول",
    existing: "Existing",
    url: "https://dorbin24.com/cctv/",
    action: "Optimize Existing",
    priority: "P0",
    status: "Monitoring",
    serpCheck: "Checked",
    intentConfirmed: "Yes",
    samePageDecision: "Same Page",
    proposedTitle: "خرید دوربین مداربسته | بررسی مدل‌ها و قیمت روز",
    proposedH1: "دوربین مداربسته",
    proposedMeta:
      "انواع دوربین مداربسته را مقایسه کنید؛ انتخاب دوربین مناسب برای خانه یا محل کار با راهنمای خرید، قیمت روز و بررسی مشخصات محصولات دوربین۲۴.",
    pageBrief:
      "معرفی انواع دوربین، فیلتر برند و کاربرد، راهنمای انتخاب و پرسش‌های متداول.",
    internalLinkingStatus: "Complete",
    indexable: "Pass",
    canonical: "Pass",
    robots: "Pass",
    breadcrumb: "Pass",
    schema: "Pass",
    mobileCheck: "Pass",
    speedCheck: "Pass",
    notes: "پروژه نمونه؛ وضعیت و URL را مطابق سایت خود اصلاح کنید.",
  };
  const brand: Row = {
    id: uid(),
    pageId: "P-002",
    target: "صفحه برند داهوا",
    pkw: "دوربین داهوا",
    supporting: "خرید دوربین داهوا\nقیمت دوربین داهوا",
    pageType: "برند",
    existing: "Existing",
    url: "https://dorbin24.com/dahua/",
    action: "Optimize Existing",
    priority: "P1",
    status: "Ready",
    serpCheck: "Checked",
  };
  const guide: Row = {
    id: uid(),
    pageId: "P-003",
    target: "راهنمای دوربین منزل",
    pkw: "بهترین دوربین مداربسته برای منزل",
    pageType: "راهنمای خرید",
    existing: "New",
    url: "https://dorbin24.com/blog/home-cctv-guide/",
    action: "Create New",
    priority: "P2",
    status: "SERP Review",
    serpCheck: "Not Checked",
  };
  project.pages = [category, brand, guide];
  project.content = [
    {
      id: uid(),
      contentId: "C-001",
      targetPage: guide.id,
      pkw: guide.pkw,
      contentType: "Buying Guide",
      topic: "چطور دوربین مناسب خانه انتخاب کنیم؟",
      pillar: "راهنمای دوربین مداربسته",
      cluster: "امنیت منزل",
      briefStatus: "Brief Ready",
      writingStatus: "Writing",
      owner: "تیم محتوا",
      publishDate: todayIso(new Date(Date.now() + 7 * 86400000)),
      internalLinkTarget: String(category.url),
      h2Ideas: "کیفیت تصویر\nدید در شب\nمحل نصب\nبودجه",
      notes: "این یک تقویم محتوای نمونه است.",
    },
    {
      id: uid(),
      contentId: "C-002",
      targetPage: brand.id,
      pkw: brand.pkw,
      contentType: "PLP",
      topic: "راهنمای کوتاه انتخاب دوربین داهوا",
      briefStatus: "Research",
      writingStatus: "Research",
      owner: "تیم محتوا",
      internalLinkTarget: String(category.url),
    },
  ];
  project.results = [
    {
      id: uid(),
      pageId: category.id,
      url: category.url,
      pkw: category.pkw,
      baselineDate: "2026-09-01",
      clicks: 184,
      impressions: 6400,
      ctr: 2.88,
      position: 8.4,
      conversions: 12,
      result: "Improving",
      previousClicks: 142,
      previousImpressions: 5900,
      previousCtr: 2.41,
      previousPosition: 11.2,
      lastChecked: todayIso(),
      notes: "اعداد نمونه و ساختگی هستند؛ برای نمایش قابلیت مقایسه.",
    },
  ];
  return {
    version: 1,
    activeProjectId: project.id,
    projects: [project],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** RFC4180 quoting, multiline cells, BOM, CSV/TSV and common semicolon exports. */
export function parseCsv(text: string): string[][] {
  if (typeof text !== "string" || text.length > 25_000_000)
    throw new Error("حجم فایل ورودی بیش از حد مجاز است.");
  const input = text.replace(/^\ufeff/, "");
  let inQuotes = false;
  const counts: Record<string, number> = { ",": 0, "\t": 0, ";": 0 };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (inQuotes && input[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
    }
    if (!inQuotes) {
      if (char === "\n" || char === "\r") break;
      if (char in counts) counts[char]++;
    }
  }
  const delimiter =
    counts["\t"] > counts[","] && counts["\t"] >= counts[";"]
      ? "\t"
      : counts[";"] > counts[","]
        ? ";"
        : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    quoteClosed = false;
  const pushRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
    quoteClosed = false;
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else cell += char;
    } else if (char === '"' && cell.length === 0 && !quoteClosed) quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
      quoteClosed = false;
    } else if (char === "\n" || char === "\r") {
      pushRow();
      if (char === "\r" && input[i + 1] === "\n") i++;
    } else if (quoteClosed && char !== " " && char !== "\t")
      throw new Error("قالب CSV معتبر نیست؛ نویسه اضافی بعد از نقل‌قول.");
    else if (!quoteClosed) cell += char;
  }
  if (quoted) throw new Error("قالب CSV معتبر نیست؛ نقل‌قول بسته نشده است.");
  if (cell !== "" || row.length || quoteClosed) pushRow();
  return rows;
}

const numericMetrics = new Set([
  "volume",
  "kdKwf",
  "kdTool",
  "kdJetSeo",
  "cpc",
]);
const importable = new Set([
  ...numericMetrics,
  "source",
  "trend",
  "toolIntent",
  "volumeSource",
  "metricUpdated",
]);
const metricNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  let text = str(value)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/٫/g, ".");
  if (/^[+-]?\d{1,3}(?:[,٬]\d{3})+(?:\.\d+)?$/.test(text))
    text = text.replace(/[,٬]/g, "");
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
    ? Number(text)
    : NaN;
};

/** Import by technical keyword equality. Manual intent, KD, decisions, groups and notes stay intact in both modes. */
export function importMetrics(
  existing: Row[],
  incoming: Row[],
  mode: "fill" | "overwrite" = "fill",
): {
  rows: Row[];
  matched: number;
  added: number;
  conflicts: number;
  duplicates: number;
} {
  if (existing.length > 20000 || incoming.length > 20000)
    throw new Error("حداکثر ظرفیت کلمات کلیدی ۲۰٬۰۰۰ ردیف است.");
  if (mode !== "fill" && mode !== "overwrite")
    throw new Error("حالت ورود داده معتبر نیست.");
  const rows = existing.map((row) => ({ ...row }));
  const index = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const key = normalizeKeyword(str(row.keyword));
    if (!key) return;
    const matches = index.get(key);
    if (matches) matches.push(i);
    else index.set(key, [i]);
  });
  const incomingCounts = duplicates(incoming);
  let matched = 0,
    added = 0,
    conflicts = 0,
    duplicateCount = 0;
  const seen = new Set<string>();
  for (const sourceRow of incoming) {
    const keyword = str(sourceRow.keyword),
      key = normalizeKeyword(keyword);
    if (!key) {
      conflicts++;
      continue;
    }
    if (seen.has(key)) duplicateCount++;
    seen.add(key);
    const matches = index.get(key) ?? [];
    // Ambiguous matches never attach an import to an arbitrary user record.
    if (
      matches.length > 1 ||
      (matches.length === 1 && (incomingCounts.get(key) ?? 0) > 1)
    ) {
      conflicts++;
      continue;
    }
    const source: Row = { ...sourceRow };
    if (
      !present(source.kdTool) &&
      present(source.kd) &&
      !LISTS.kd.includes(str(source.kd)) &&
      Number.isFinite(metricNumber(source.kd))
    )
      source.kdTool = metricNumber(source.kd);
    if (present(source.intent) && !present(source.toolIntent))
      source.toolIntent = source.intent;
    const target: Row = matches.length
      ? rows[matches[0]]
      : { id: uid(), keyword, decision: "Review" };
    if (!present(target.intent) && LISTS.intent.includes(str(source.intent)))
      target.intent = str(source.intent);
    if (matches.length) matched++;
    let rowConflict = false;
    for (const field of importable) {
      if (!present(source[field])) continue;
      let value = source[field];
      if (field === "metricUpdated") {
        const normalized = toIsoDate(String(value));
        if (!normalized) { rowConflict = true; continue; }
        value = normalized;
      }
      if (numericMetrics.has(field)) {
        const parsed = metricNumber(value);
        if (
          !Number.isFinite(parsed) ||
          parsed < 0 ||
          (field.startsWith("kd") && parsed > 100)
        ) {
          rowConflict = true;
          continue;
        }
        value = parsed;
      }
      if (mode === "fill" && present(target[field])) {
        if (str(target[field]) !== str(value)) rowConflict = true;
        continue;
      }
      target[field] = value;
    }
    if (rowConflict) conflicts++;
    if (!matches.length) {
      rows.push(target);
      added++;
      // Preserve all new duplicate input rows and flag them; never delete source data silently.
      if ((incomingCounts.get(key) ?? 0) === 1)
        index.set(key, [rows.length - 1]);
    }
  }
  if (rows.length > 20000)
    throw new Error("این ورود داده ظرفیت ۲۰٬۰۰۰ کلمه کلیدی را رد می‌کند.");
  return { rows, matched, added, conflicts, duplicates: duplicateCount };
}

const capacities: Record<Collection, number> = {
  keywords: 20000,
  pages: 2000,
  content: 2000,
  results: 2000,
};
const numericFields = new Set([
  "volume",
  "kdKwf",
  "kdTool",
  "kdJetSeo",
  "cpc",
  "clusterVolume",
  "clicks",
  "impressions",
  "ctr",
  "position",
  "conversions",
  "previousClicks",
  "previousImpressions",
  "previousCtr",
  "previousPosition",
]);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Validate an untrusted JSON backup before any replacement; no mutation of supplied data. */
export function validateStore(input: unknown): Store {
  if (
    !object(input) ||
    input.version !== 1 ||
    !Array.isArray(input.projects) ||
    input.projects.length < 1 ||
    input.projects.length > 50
  )
    throw new Error(
      "فایل پشتیبان معتبر نیست یا تعداد پروژه‌ها بیش از حد مجاز است.",
    );
  if (!object(input.settings))
    throw new Error("تنظیمات فایل پشتیبان معتبر نیست.");
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const key of ["titleMin", "titleMax", "metaMin", "metaMax"] as const) {
    const value = input.settings[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1000
    )
      throw new Error("محدوده‌های بررسی عنوان و متا معتبر نیست.");
    settings[key] = value;
  }
  if (
    settings.titleMin > settings.titleMax ||
    settings.metaMin > settings.metaMax
  )
    throw new Error("حداقل طول نمی‌تواند بیشتر از حداکثر باشد.");
  if (input.settings.customLabels !== undefined) {
    const labels = input.settings.customLabels;
    if (!object(labels) || Object.keys(labels).length > 10)
      throw new Error("نام‌های فیلدهای اختصاصی معتبر نیست.");
    settings.customLabels = {};
    for (const [key, label] of Object.entries(labels)) {
      if (
        !/^custom(?:0[1-9]|10)$/.test(key) ||
        typeof label !== "string" ||
        label.length > 100
      )
        throw new Error("نام فیلد اختصاصی معتبر نیست.");
      settings.customLabels[key] = label;
    }
  }
  if (input.settings.playbooks !== undefined) settings.playbooks = validateSavedPlaybooks(input.settings.playbooks);
  const projectIds = new Set<string>();
  let totalRows = 0, coreRows = 0,
    totalText = JSON.stringify(settings).length;
  const projects: Project[] = input.projects.map((raw): Project => {
    if (
      !object(raw) ||
      typeof raw.id !== "string" ||
      !raw.id.trim() ||
      raw.id.length > 200 ||
      projectIds.has(raw.id)
    )
      throw new Error("شناسه پروژه نامعتبر یا تکراری است.");
    projectIds.add(raw.id);
    const project: Project = {
      id: raw.id,
      name: "",
      domain: "",
      market: "",
      language: "",
      projectType: "",
      goal: "",
      startDate: "",
      lastReview: "",
      keywords: [],
      pages: [],
      content: [],
      results: [],
    };
    const projectFields = [
      "name",
      "domain",
      "market",
      "language",
      "projectType",
      "goal",
      "startDate",
      "lastReview",
    ] as const;
    for (const key of projectFields) {
      if (typeof raw[key] !== "string" || raw[key].length > 10000)
        throw new Error("اطلاعات پروژه معتبر نیست.");
      project[key] = raw[key];
      totalText += raw[key].length;
    }
    if (!project.name.trim()) throw new Error("نام پروژه نمی‌تواند خالی باشد.");
    const rowIds = new Set<string>();
    for (const collection of Object.keys(capacities) as Collection[]) {
      const source = raw[collection];
      if (!Array.isArray(source) || source.length > capacities[collection])
        throw new Error(`ظرفیت یا ساختار بخش ${collection} معتبر نیست.`);
      totalRows += source.length;
      coreRows += source.length;
      if (coreRows > 120000)
        throw new Error("حجم کلی فایل پشتیبان بیش از حد مجاز است.");
      project[collection] = source.map((rawRow): Row => {
        if (
          !object(rawRow) ||
          typeof rawRow.id !== "string" ||
          !rawRow.id.trim() ||
          rawRow.id.length > 200 ||
          rowIds.has(rawRow.id)
        )
          throw new Error("شناسه ردیف نامعتبر یا تکراری است.");
        rowIds.add(rawRow.id);
        if (Object.keys(rawRow).length > 120)
          throw new Error("تعداد فیلدهای یک ردیف بیش از حد مجاز است.");
        const row: Row = { id: rawRow.id };
        for (const [key, value] of Object.entries(rawRow)) {
          if (
            key.length > 100 ||
            key === "__proto__" ||
            key === "constructor" ||
            key === "prototype"
          )
            throw new Error("نام فیلد نامعتبر است.");
          if (value === undefined) continue;
          if (typeof value !== "string" && typeof value !== "number")
            throw new Error("مقدار فیلد معتبر نیست.");
          if (typeof value === "string" && value.length > 100000)
            throw new Error("طول متن یک فیلد بیش از حد مجاز است.");
          totalText += key.length + String(value).length;
          if (totalText > 25_000_000)
            throw new Error("حجم کلی فایل پشتیبان بیش از حد مجاز است.");
          if (typeof value === "number" && !Number.isFinite(value))
            throw new Error("مقادیر عددی باید متناهی باشند.");
          if (numericFields.has(key) && present(value)) {
            const parsed = metricNumber(value);
            if (
              !Number.isFinite(parsed) ||
              parsed < 0 ||
              ((key === "ctr" ||
                key === "previousCtr" ||
                key.startsWith("kd")) &&
                parsed > 100)
            )
              throw new Error("معیارهای عددی نامعتبر هستند.");
            row[key] = parsed;
          } else row[key] = value;
        }
        return row;
      });
    }
    Object.assign(project, validateProjectExtras(raw));
    totalRows += (project.tasks?.length ?? 0) + (project.links?.length ?? 0) + (project.searchConsole?.current?.rows.length ?? 0) + (project.searchConsole?.previous?.rows.length ?? 0);
    totalText += JSON.stringify({ tasks: project.tasks, links: project.links, searchConsole: project.searchConsole, playbook: project.playbook }).length;
    if (totalRows > 160000 || totalText > 25_000_000) throw new Error("حجم کلی فایل پشتیبان بیش از حد مجاز است.");
    return project;
  });
  if (
    typeof input.activeProjectId !== "string" ||
    !projectIds.has(input.activeProjectId)
  )
    throw new Error("پروژه فعال در فایل پشتیبان وجود ندارد.");
  return {
    version: 1,
    activeProjectId: input.activeProjectId,
    projects,
    settings,
  };
}
