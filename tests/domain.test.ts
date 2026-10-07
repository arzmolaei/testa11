import { describe, expect, it } from "vitest";
import {
  createProject,
  DEFAULT_SETTINGS,
  demoStore,
  duplicates,
  fieldValue,
  importMetrics,
  keywordLookup,
  nextKeyword,
  nextPage,
  nextResult,
  normalizeKeyword,
  parseCsv,
  projectPageAction,
  resultLookup,
  SCHEMAS,
  summarize,
  validateStore,
} from "../src/domain";
import type { Row } from "../src/types";

describe("technical keyword normalization", () => {
  it("normalizes Persian letter, whitespace, digit, diacritic and halfspace variants", () => {
    expect(normalizeKeyword("  خَرید\u00a0دوربين\u200cمداربستهـ ۱۲٣ ")).toBe(
      normalizeKeyword("خرید دوربین مداربسته 123"),
    );
    expect(normalizeKeyword("كابل شبكه")).toBe(normalizeKeyword("کابل شبکه"));
  });
  it("keeps distinct intent and spelling distinct", () => {
    expect(normalizeKeyword("خرید دوربین داهوا")).not.toBe(
      normalizeKeyword("قیمت دوربین داهوا"),
    );
    expect(normalizeKeyword("دوربین داهوا")).not.toBe(
      normalizeKeyword("دوربین های داهوا"),
    );
    expect(normalizeKeyword("ab c")).not.toBe(normalizeKeyword("a bc"));
    expect(normalizeKeyword("دور بین")).not.toBe(normalizeKeyword("دوربین"));
    expect(normalizeKeyword("دوربین‌های")).toBe(
      normalizeKeyword("دوربین  های"),
    );
  });
  it("counts technical duplicates without mutating or deleting rows", () => {
    const rows: Row[] = [
      { id: "1", keyword: "خرید دوربین" },
      { id: "2", keyword: "خريد\u200cدوربين" },
      { id: "3", keyword: "قیمت دوربین" },
    ];
    expect(duplicates(rows).get(normalizeKeyword("خرید دوربین"))).toBe(2);
    expect(rows).toHaveLength(3);
  });
});

describe("beginner workflow guidance", () => {
  it("accepts zero volume, respects exclusion and moves through research in order", () => {
    expect(nextKeyword({ id: "a", keyword: "دوربین" })).toBe(
      "حجم جست‌وجو را ثبت کنید",
    );
    expect(nextKeyword({ id: "a", keyword: "دوربین", volume: 0 })).toBe(
      "سختی کلمه را ارزیابی کنید",
    );
    expect(
      nextKeyword({ id: "a", keyword: "دوربین", decision: "Exclude" }),
    ).toBe("کنار گذاشته شده");
    expect(
      nextKeyword({
        id: "a",
        keyword: "دوربین",
        volume: 0,
        kd: "آسان",
        intent: "تراکنشی",
        decision: "Keep",
        group: "دوربین",
      }),
    ).toBe("آماده هدف‌گذاری صفحه");
  });
  it("asks for PKW and actual SERP validation before title writing", () => {
    const row: Row = { id: "page", target: "دوربین" };
    expect(nextPage(row)).toBe("کلمه کلیدی اصلی را انتخاب کنید");
    expect(nextPage({ ...row, pkw: "دوربین" })).toBe(
      "نتایج جست‌وجو را بررسی کنید",
    );
    expect(
      nextPage({
        ...row,
        pkw: "دوربین",
        serpCheck: "Checked",
        pageType: "برند",
        existing: "Existing",
        action: "Optimize Existing",
        url: "/cameras",
      }),
    ).toBe("عنوان سئو را بنویسید");
    expect(nextPage({ ...row, action: "No Dedicated Page" })).toBe(
      "صفحه مستقل نیاز ندارد",
    );
  });
  it("requires the technical checklist rather than only one successful check", () => {
    const row: Row = {
      id: "page",
      target: "دوربین",
      pkw: "دوربین",
      serpCheck: "Checked",
      pageType: "برند",
      existing: "Existing",
      action: "Optimize Existing",
      url: "/camera",
      proposedTitle: "عنوان کوتاه",
      proposedH1: "دوربین",
      proposedMeta: "متای کوتاه",
      pageBrief: "بریف",
      status: "Ready",
      internalLinkingStatus: "Complete",
      indexable: "Pass",
    };
    expect(nextPage(row)).toBe("چک‌لیست فنی را بررسی کنید");
    const ready = {
      ...row,
      canonical: "Pass",
      robots: "Pass",
      breadcrumb: "Not Applicable",
      schema: "Not Applicable",
      mobileCheck: "Pass",
      speedCheck: "Pass",
    };
    expect(nextPage(ready)).toBe("صفحه را منتشر یا به‌روزرسانی کنید");
    expect(fieldValue(row, "titleReview")).toBe("کوتاه؛ بازبینی کنید");
  });
  it("waits for data and treats decreasing average position as improvement", () => {
    expect(
      nextResult({
        id: "result",
        pageId: "page",
        baselineDate: "2026-10-01",
        clicks: 0,
        impressions: 0,
        position: 0,
      }),
    ).toBe("برای داده بیشتر صبر کنید");
    expect(
      fieldValue(
        { id: "result", previousPosition: 12, position: 8.5 },
        "positionChange",
      ),
    ).toBe(3.5);
    expect(
      fieldValue(
        { id: "result", previousClicks: 0, clicks: 42 },
        "clicksChange",
      ),
    ).toBe(42);
    expect(fieldValue({ id: "result", clicks: 42 }, "clicksChange")).toBe("");
  });
  it("links the tasteful demo by stable page IDs", () => {
    const store = demoStore(),
      project = store.projects[0];
    expect(project.keywords).toHaveLength(6);
    expect(project.pages).toHaveLength(3);
    expect(project.results[0].pageId).toBe(project.pages[0].id);
    expect(project.content[0].targetPage).toBe(project.pages[2].id);
    expect(validateStore(store)).toEqual(store);
    const summary = summarize(project);
    expect(summary.stage).toBe(1);
    expect(summary.totals.published).toBe(1);
    expect(summary.totals.monitored).toBe(1);
  });
  it("includes every advanced module and all ten custom fields", () => {
    expect(
      SCHEMAS.keywords.find((section) => section.key === "custom")?.fields,
    ).toHaveLength(10);
    expect(SCHEMAS.pages.map((section) => section.key)).toEqual([
      "core",
      "advancedKeywords",
      "serp",
      "onPage",
      "pageContent",
      "internalLinks",
      "technical",
      "execution",
    ]);
    expect(
      SCHEMAS.content
        .find((section) => section.key === "detail")
        ?.fields.map((field) => field.key),
    ).toContain("sources");
  });
  it("uses the same contextual monitoring action on dashboard and page rows", () => {
    const project = createProject("پایش");
    project.keywords = [
      {
        id: "keyword",
        keyword: "دوربین",
        volume: 100,
        kd: "آسان",
        intent: "تراکنشی",
        decision: "Keep",
        group: "دوربین",
      },
    ];
    project.pages = [
      {
        id: "page",
        pageId: "P-001",
        target: "دوربین",
        pkw: "دوربین",
        pageType: "برند",
        url: "/camera",
        serpCheck: "Checked",
        status: "Monitoring",
        proposedTitle: "دوربین",
        proposedH1: "دوربین",
        proposedMeta: "انتخاب دوربین",
      },
    ];
    project.results = [
      {
        id: "result",
        pageId: "page",
        url: "/camera",
        baselineDate: "2026-09-01",
        clicks: 10,
        impressions: 100,
        position: 12,
        result: "Improving",
        lastChecked: "2026-10-07",
      },
    ];
    expect(summarize(project).stage).toBe(5);
    expect(summarize(project).action).toBe("نتایج دوره بعد را پایش کنید");
    expect(summarize(project).action).toBe(
      projectPageAction(project, project.pages[0]),
    );
  });
  it("omits ambiguous keyword decisions and selects the latest result independently of order", () => {
    const words: Row[] = [
      { id: "a", keyword: "دوربین", decision: "Keep" },
      { id: "b", keyword: "دوربين", decision: "Exclude" },
      { id: "c", keyword: "شبکه", decision: "Keep" },
    ];
    expect(keywordLookup(words).has(normalizeKeyword("دوربین"))).toBe(false);
    expect(keywordLookup(words).get(normalizeKeyword("شبکه"))?.id).toBe("c");
    const pages: Row[] = [{ id: "page-stable", pageId: "P-001" }];
    const results: Row[] = [
      { id: "old", pageId: "P-001", lastChecked: "2026-09-01" },
      { id: "new", pageId: "page-stable", lastChecked: "2026-10-07" },
      { id: "tie", pageId: "page-stable", lastChecked: "2026-10-07" },
    ];
    expect(resultLookup(results, pages).get("page-stable")?.id).toBe("new");
    expect(
      resultLookup([...results].reverse(), pages).get("page-stable")?.id,
    ).toBe("new");
  });
});

describe("safe metric import", () => {
  it("matches keyword identity instead of order and never replaces manual decisions", () => {
    const existing: Row[] = [
      {
        id: "b",
        keyword: "قیمت دوربین",
        kd: "آسان",
        decision: "Keep",
        group: "قیمت",
        notes: "یادداشت دستی",
      },
      { id: "a", keyword: "خرید دوربین", volume: 12, intent: "تراکنشی" },
    ];
    const imported = importMetrics(existing, [
      {
        id: "csv1",
        keyword: "خريد دوربين",
        volume: 900,
        kd: 23,
        decision: "Exclude",
      },
      {
        id: "csv2",
        keyword: "قیمت دوربین",
        volume: 300,
        kd: 78,
        decision: "Exclude",
        notes: "overwrite",
        group: "wrong",
      },
    ]);
    expect(imported.rows[0]).toMatchObject({
      id: "b",
      volume: 300,
      kd: "آسان",
      kdTool: 78,
      decision: "Keep",
      group: "قیمت",
      notes: "یادداشت دستی",
    });
    expect(imported.rows[1]).toMatchObject({ id: "a", volume: 12, kdTool: 23 });
    expect(imported.matched).toBe(2);
    expect(imported.conflicts).toBe(1);
    expect(existing[0].volume).toBeUndefined();
    const overwrite = importMetrics(
      existing,
      [
        {
          id: "csv",
          keyword: "قیمت دوربین",
          volume: 0,
          kd: 90,
          decision: "Exclude",
          group: "wrong",
          notes: "wrong",
        },
      ],
      "overwrite",
    );
    expect(overwrite.rows[0]).toMatchObject({
      id: "b",
      volume: 0,
      kd: "آسان",
      kdTool: 90,
      decision: "Keep",
      group: "قیمت",
      notes: "یادداشت دستی",
    });
  });
  it("keeps manual intent in overwrite mode and stores tool intent separately", () => {
    const source: Row[] = [{ id: "a", keyword: "دوربین", intent: "تراکنشی" }];
    const imported = importMetrics(
      source,
      [{ id: "csv", keyword: "دوربین", intent: "اطلاعاتی" }],
      "overwrite",
    );
    expect(imported.rows[0].intent).toBe("تراکنشی");
    expect(imported.rows[0].toolIntent).toBe("اطلاعاتی");
    const blank = importMetrics(
      [{ id: "a", keyword: "دوربین" }],
      [{ id: "csv", keyword: "دوربین", intent: "اطلاعاتی" }],
    );
    expect(blank.rows[0].intent).toBe("اطلاعاتی");
    const unknown = importMetrics(
      [],
      [{ id: "csv", keyword: "دوربین", intent: "something" }],
    );
    expect(unknown.rows[0].intent).toBeUndefined();
    expect(unknown.rows[0].toolIntent).toBe("something");
  });
  it("does not attach ambiguous metrics to one arbitrary duplicate", () => {
    const existing: Row[] = [
      { id: "1", keyword: "دوربین" },
      { id: "2", keyword: "دوربين" },
    ];
    const result = importMetrics(existing, [
      { id: "csv", keyword: "دوربین", volume: 100 },
    ]);
    expect(result.rows).toEqual(existing);
    expect(result.conflicts).toBe(1);
    expect(result.matched).toBe(0);
  });
  it("preserves new duplicates and reports them, but skips competing imports to an existing row", () => {
    const incoming: Row[] = [
      { id: "a", keyword: "دوربین", volume: 100 },
      { id: "b", keyword: "دوربين", volume: 200 },
    ];
    const fresh = importMetrics([], incoming);
    expect(fresh.added).toBe(2);
    expect(fresh.duplicates).toBe(1);
    expect(fresh.rows[0].id).not.toBe(fresh.rows[1].id);
    const existing: Row[] = [{ id: "x", keyword: "دوربین", notes: "keep" }];
    const ambiguous = importMetrics(existing, incoming);
    expect(ambiguous.rows).toEqual(existing);
    expect(ambiguous.conflicts).toBe(2);
    expect(ambiguous.duplicates).toBe(1);
  });
  it("rejects invalid numeric metrics and leaves the row intact", () => {
    const result = importMetrics(
      [{ id: "existing", keyword: "دوربین" }],
      [{ id: "csv", keyword: "دوربین", volume: -1, kd: 120, cpc: Infinity }],
    );
    expect(result.rows[0].volume).toBeUndefined();
    expect(result.rows[0].kdTool).toBeUndefined();
    expect(result.conflicts).toBe(1);
  });
  it("reads Persian digits and valid grouped numbers without interpreting malformed commas", () => {
    const result = importMetrics(
      [],
      [
        { id: "a", keyword: "دوربین", volume: "۱٬۲۳۴", kd: "۲۳", cpc: "۰٫۵" },
        { id: "b", keyword: "شبکه", volume: "12,34" },
      ],
    );
    expect(result.rows[0]).toMatchObject({
      volume: 1234,
      kdTool: 23,
      cpc: 0.5,
    });
    expect(result.rows[1].volume).toBeUndefined();
    expect(result.conflicts).toBe(1);
  });
});

describe("CSV parser", () => {
  it("handles BOM, quoted delimiters, escaped quotes, multiline cells and Windows line endings", () => {
    expect(
      parseCsv(
        '\ufeffKeyword,Notes,Volume\r\n"دوربین,داهوا","line1\nline2 ""quoted""",0\r\n',
      ),
    ).toEqual([
      ["Keyword", "Notes", "Volume"],
      ["دوربین,داهوا", 'line1\nline2 "quoted"', "0"],
    ]);
  });
  it("detects TSV and semicolon exports and preserves empty cells", () => {
    expect(parseCsv("Keyword\tVolume\tKD\nدوربین\t\t12")).toEqual([
      ["Keyword", "Volume", "KD"],
      ["دوربین", "", "12"],
    ]);
    expect(parseCsv("Keyword;Volume\nدوربین;12")).toEqual([
      ["Keyword", "Volume"],
      ["دوربین", "12"],
    ]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a,b,")).toEqual([["a", "b", ""]]);
  });
  it("rejects malformed quoting instead of misaligning data", () => {
    expect(() => parseCsv('a,b\n"unfinished')).toThrow();
    expect(() => parseCsv('a,b\n"value"oops,12')).toThrow();
  });
});

describe("backup validation", () => {
  const blankStore = () => {
    const project = createProject("تست");
    return {
      version: 1 as const,
      activeProjectId: project.id,
      projects: [project],
      settings: { ...DEFAULT_SETTINGS },
    };
  };
  it("rejects malformed collections, unknown active IDs, nonfinite and negative metrics", () => {
    const badCollection = blankStore();
    (badCollection.projects[0] as unknown as Record<string, unknown>).pages =
      {};
    expect(() => validateStore(badCollection)).toThrow();
    expect(() =>
      validateStore({ ...blankStore(), activeProjectId: "missing" }),
    ).toThrow();
    for (const volume of [-1, Infinity, NaN, "bad"]) {
      const store = blankStore();
      store.projects[0].keywords = [{ id: "a", keyword: "دوربین", volume }];
      expect(() => validateStore(store)).toThrow();
    }
  });
  it("rejects duplicate IDs across collections and too many rows", () => {
    const store = blankStore();
    store.projects[0].keywords = [{ id: "a" }];
    store.projects[0].pages = [{ id: "a" }];
    expect(() => validateStore(store)).toThrow();
    const tooLarge = blankStore();
    tooLarge.projects[0].pages = Array.from({ length: 2001 }, (_, i) => ({
      id: `p${i}`,
    }));
    expect(() => validateStore(tooLarge)).toThrow();
  });
  it("rejects unsafe object fields and nonsensical thresholds", () => {
    const store = blankStore();
    store.projects[0].keywords = [
      JSON.parse('{"id":"a","__proto__":"unsafe"}'),
    ];
    expect(() => validateStore(store)).toThrow();
    const thresholds = blankStore();
    thresholds.settings.titleMin = 100;
    thresholds.settings.titleMax = 30;
    expect(() => validateStore(thresholds)).toThrow();
  });
  it("preserves renamed custom fields while rejecting unsafe label keys", () => {
    const store = blankStore();
    const renamed = {
      ...store,
      settings: {
        ...store.settings,
        customLabels: { custom01: "موجودی", custom02: "حاشیه سود" },
      },
    };
    expect(validateStore(renamed).settings.customLabels).toEqual(
      renamed.settings.customLabels,
    );
    expect(() =>
      validateStore({
        ...store,
        settings: { ...store.settings, customLabels: { notes: "wrong" } },
      }),
    ).toThrow();
  });
});

describe.each([100, 1000, 10000])("stable identity with %i rows", (size) => {
  it("keeps manual data and page links attached after sorting, filtering and keyed metric imports", () => {
    const source: Row[] = Array.from({ length: size }, (_, i) => ({
      id: `keyword-${i}`,
      keyword: `دوربین ${i}`,
      volume: i,
      kd: "آسان",
      decision: i % 2 ? "Keep" : "Review",
      group: `گروه ${i % 10}`,
      notes: `یادداشت ${i}`,
    }));
    const lookup = new Map(source.map((row) => [row.id, { ...row }]));
    const sorted = [...source].sort(
      (a, b) => Number(b.volume) - Number(a.volume),
    );
    const filtered = sorted.filter((row) => row.decision === "Keep");
    expect(
      filtered.every(
        (row) =>
          row.notes === lookup.get(row.id)?.notes &&
          row.group === lookup.get(row.id)?.group,
      ),
    ).toBe(true);
    const incoming = [...source]
      .reverse()
      .map((row, i) => ({
        id: `csv-${i}`,
        keyword: row.keyword,
        volume: Number(row.volume) + 100,
        kd: 42,
        notes: "bad",
        decision: "Exclude",
        group: "bad",
      }));
    const result = importMetrics(sorted, incoming, "overwrite");
    expect(result.matched).toBe(size);
    expect(result.added).toBe(0);
    const counts = duplicates(source);
    for (const row of result.rows) {
      const previous = lookup.get(row.id)!;
      expect(row.notes).toBe(previous.notes);
      expect(row.decision).toBe(previous.decision);
      expect(row.group).toBe(previous.group);
      expect(row.kd).toBe(previous.kd);
      expect(row.volume).toBe(Number(previous.volume) + 100);
      expect(row.kdTool).toBe(42);
      expect(counts.get(normalizeKeyword(String(row.keyword)))).toBe(1);
    }
    const project = createProject("حجم داده");
    project.keywords = result.rows;
    project.pages = [
      { id: "page-stable", pageId: "P-001", target: "گروه 1", pkw: "دوربین 1" },
    ];
    project.content = [{ id: "content-stable", targetPage: "page-stable" }];
    const validated = validateStore({
      version: 1,
      activeProjectId: project.id,
      projects: [project],
      settings: DEFAULT_SETTINGS,
    });
    expect(validated.projects[0].content[0].targetPage).toBe("page-stable");
    expect(nextPage(validated.projects[0].pages[0])).toBe(
      "نتایج جست‌وجو را بررسی کنید",
    );
  });
});
