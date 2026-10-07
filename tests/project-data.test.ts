import { describe, expect, it } from "vitest";
import { createProject, DEFAULT_SETTINGS, validateStore } from "../src/domain";
import { PROJECT_PLAYBOOKS } from "../src/playbooks";
import { validatePlaybook, validateProjectExtras, validateSavedPlaybooks } from "../src/project-data";
import type { SearchConsoleDataset } from "../src/search-console";

function dataset(): SearchConsoleDataset {
  return {
    id: "period-current", label: "مهر", importedAt: "2026-10-07T12:00:00.000Z", periodStart: "2026-09-01", periodEnd: "2026-09-30",
    sourceRows: 2, dimension: "query-page", sourceFilters: "کشور ایران، دستگاه موبایل",
    rows: [
      { id: "gsc-a", query: "خرید دوربین", page: "https://example.com/cameras/", clicks: 5, impressions: 80, position: 8.5, country: "IR", device: "mobile" },
      { id: "gsc-b", query: "دوربین داهوا", page: "https://example.com/dahua/", clicks: 0, impressions: 10, position: 14, country: "IR", device: "mobile" },
    ],
  };
}
function extraWith(current: unknown) { return { searchConsole: { current } }; }

describe("project metadata import and cloud boundaries", () => {
  it("round-trips tasks, links, both GSC periods and project/saved playbooks through the actual store validator", () => {
    const current = dataset(), previous = { ...dataset(), id: "period-previous", label: "شهریور", periodStart: "2026-08-01", periodEnd: "2026-08-30" };
    const source = createProject("فروشگاه");
    source.keywords = [{ id: "keyword", keyword: "خرید دوربین", targetPage: "page" }];
    source.pages = [{ id: "page", pkw: "دوربین", url: "https://example.com/cameras/" }];
    source.tasks = [{ id: "task", title: "بررسی عنوان", status: "open", pageId: "page", dueDate: "2026-10-10", source: "gsc:source", notes: "یادداشت خصوصی" }];
    source.links = [{ id: "link", fromPageId: "page", toPageId: "other-page", anchor: "راهنمای دوربین", status: "planned" }];
    source.searchConsole = { current, previous };
    source.playbook = { ...PROJECT_PLAYBOOKS[0], id: "project-recipe" };
    const store = { version: 1, activeProjectId: source.id, projects: [source], settings: { ...DEFAULT_SETTINGS, playbooks: [{ ...PROJECT_PLAYBOOKS[1], id: "saved-recipe" }] } };
    const validated = validateStore(JSON.parse(JSON.stringify(store)));
    expect(validated).toEqual(store);
    expect(validated.projects[0].searchConsole?.current?.rows[0].clicks).toBe(5);
    expect(validated.projects[0].keywords[0].targetPage).toBe("page");
    expect(validated.settings.playbooks?.[0].conversionGoal).toBe(store.settings.playbooks[0].conversionGoal);
  });

  it("isolates project and saved recipe copies from the source and each other", () => {
    const recipe = { ...PROJECT_PLAYBOOKS[0], id: "custom" };
    const first = validateProjectExtras({ playbook: recipe }), second = validateProjectExtras({ playbook: recipe });
    const saved = validateSavedPlaybooks([recipe]);
    first.playbook!.audience = "مخاطب پروژه اول";
    saved[0].briefTemplate = "قالب ویرایش‌شده";
    expect(second.playbook?.audience).toBe(recipe.audience);
    expect(recipe.briefTemplate).toBe(PROJECT_PLAYBOOKS[0].briefTemplate);
    expect(first.playbook?.briefTemplate).toBe(recipe.briefTemplate);
    expect(PROJECT_PLAYBOOKS[0].audience).toBe(recipe.audience);
  });

  it("uses the recipe editor's safety limits while preserving intentional backup whitespace", () => {
    const source = { ...PROJECT_PLAYBOOKS[0], briefTemplate: "  مقدمه\n\nپرسش‌ها\n", label: " نام انتخابی " };
    expect(validatePlaybook(source)).toEqual(source);
    for (const patch of [{ audience: "x".repeat(2001) }, { conversionGoal: "x".repeat(2001) }, { briefTemplate: "x".repeat(12001) }, { groupingRules: "x".repeat(6001) }, { label: "نام\u0000خراب" }]) {
      expect(() => validatePlaybook({ ...source, ...patch })).toThrow();
    }
  });

  it("copies GSC rows and task/link objects rather than sharing mutable backup objects", () => {
    const current = dataset(), task = { id: "task", status: "done", title: "کار اصلی" }, link = { id: "link", status: "implemented", anchor: "لینک اصلی" };
    const validated = validateProjectExtras({ searchConsole: { current }, tasks: [task], links: [link] });
    validated.searchConsole!.current!.rows[0].clicks = 0;
    validated.tasks![0].title = "جدید"; validated.links![0].anchor = "جدید";
    expect(current.rows[0].clicks).toBe(5); expect(task.title).toBe("کار اصلی"); expect(link.anchor).toBe("لینک اصلی");
  });

  it("rejects malformed counts, fractions, over-counted clicks and unsafe numeric values", () => {
    for (const patch of [{ clicks: "5" }, { clicks: -1 }, { clicks: 1.5 }, { clicks: 81 }, { impressions: Infinity }, { impressions: Number.MAX_SAFE_INTEGER + 1 }, { impressions: "80" }, { position: NaN }, { position: -1 }, { position: 0 }, { position: 0.5 }, { position: 1001 }]) {
      const current = dataset(); Object.assign(current.rows[0], patch);
      expect(() => validateProjectExtras(extraWith(current))).toThrow();
    }
  });

  it("rejects unsafe dataset totals even when individual row values are safe integers", () => {
    const current = dataset();
    current.rows.forEach((row) => { row.clicks = Number.MAX_SAFE_INTEGER; row.impressions = Number.MAX_SAFE_INTEGER; });
    expect(() => validateProjectExtras(extraWith(current))).toThrow(/مجموع آمار/);
  });

  it("rejects active URL schemes, embedded credentials and missing dimension columns", () => {
    for (const page of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///secret", "https://user:secret@example.com/", "/relative-only"]) {
      const current = dataset(); current.rows[0].page = page;
      expect(() => validateProjectExtras(extraWith(current))).toThrow(/نشانی/);
    }
    const noQuery = dataset(); delete noQuery.rows[0].query;
    const noPage = dataset(); delete noPage.rows[0].page;
    expect(() => validateProjectExtras(extraWith(noQuery))).toThrow();
    expect(() => validateProjectExtras(extraWith(noPage))).toThrow();
    const text = dataset(); text.rows[0].query = "<img src=x onerror=alert(1)>";
    expect(validateProjectExtras(extraWith(text)).searchConsole?.current?.rows[0].query).toBe(text.rows[0].query);
  });

  it("validates source metadata, real calendar periods, dimension and unique row identity", () => {
    for (const patch of [{ periodStart: "2026-02-31" }, { periodEnd: "2026-08-01" }, { importedAt: "not-a-date" }, { sourceRows: 1 }, { sourceRows: 20001 }, { sourceRows: 2.5 }, { sourceRows: "2" }, { dimension: "unknown" }]) {
      expect(() => validateProjectExtras(extraWith({ ...dataset(), ...patch }))).toThrow();
    }
    const duplicate = dataset(); duplicate.rows[1].id = duplicate.rows[0].id;
    expect(() => validateProjectExtras(extraWith(duplicate))).toThrow();
    expect(() => validateProjectExtras(extraWith({ ...dataset(), rows: [] }))).toThrow();
    const queryOnly = { ...dataset(), dimension: "query", rows: [{ id: "query", query: "دوربین", clicks: 0, impressions: 1 }] };
    const pageOnly = { ...dataset(), dimension: "page", rows: [{ id: "page", page: "https://example.com/", clicks: 0, impressions: 1 }] };
    expect(validateProjectExtras(extraWith(queryOnly)).searchConsole?.current?.dimension).toBe("query");
    expect(validateProjectExtras(extraWith(pageOnly)).searchConsole?.current?.dimension).toBe("page");
    expect(() => validateProjectExtras(extraWith({ ...dataset(), dimension: "query" }))).toThrow(/نوع داده/);
    expect(() => validateProjectExtras(extraWith({ ...dataset(), dimension: "page" }))).toThrow(/نوع داده/);
  });

  it("rejects ambiguous and rolled import timestamps but accepts stable ISO timezone offsets", () => {
    for (const importedAt of ["1", "2026-02-30T12:00:00Z", "2026-10-07T24:00:00Z", "2026-10-07T12:00:00", "2026-10-07T12:00:00+24:00"]) expect(() => validateProjectExtras(extraWith({ ...dataset(), importedAt }))).toThrow();
    expect(validateProjectExtras(extraWith({ ...dataset(), importedAt: "2026-10-07T15:30:00+03:30" })).searchConsole?.current?.importedAt).toBe("2026-10-07T15:30:00+03:30");
  });

  it("rejects malformed task/link states, duplicate identity, nested payloads and prototype keys", () => {
    for (const [collection, row] of [["tasks", { id: "task", status: "Published" }], ["links", { id: "link", status: "done" }], ["tasks", { id: "task", title: { nested: true } }], ["links", { id: "link", anchor: Infinity }]] as const) {
      expect(() => validateProjectExtras({ [collection]: [row] })).toThrow();
    }
    expect(() => validateProjectExtras({ tasks: [{ id: "same" }, { id: "same" }] })).toThrow();
    const polluted = JSON.parse('{"id":"task","__proto__":{"polluted":true}}');
    expect(() => validateProjectExtras({ tasks: [polluted] })).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps stable references and optional dates typed and rejects silent calendar rollover", () => {
    for (const row of [{ id: "task", status: 0 }, { id: "task", pageId: 42 }, { id: "task", dueDate: "2026-02-30" }, { id: "task", updatedAt: "2026-02-30T12:00:00Z" }, { id: "task", completedAt: 2026 }]) expect(() => validateProjectExtras({ tasks: [row] })).toThrow();
    expect(() => validateProjectExtras({ links: [{ id: "link", fromPageId: 1, toPageId: "page" }] })).toThrow();
    const task = { id: "task", dueDate: "", createdAt: "2026-10-07", updatedAt: "2026-10-07T15:30:00+03:30", completedAt: "", pageId: "page" };
    expect(validateProjectExtras({ tasks: [task] }).tasks?.[0]).toEqual(task);
    expect(validateProjectExtras({ tasks: [{ id: "legacy-task" }] }).tasks?.[0].id).toBe("legacy-task");
  });

  it("enforces limits on collections, payload size, saved recipe count and duplicate recipe identity", () => {
    expect(() => validateProjectExtras({ tasks: Array.from({ length: 4001 }, (_, index) => ({ id: String(index) })) })).toThrow();
    expect(() => validateProjectExtras({ links: Array.from({ length: 10001 }, (_, index) => ({ id: String(index) })) })).toThrow();
    expect(() => validateSavedPlaybooks(Array.from({ length: 31 }, (_, index) => ({ ...PROJECT_PLAYBOOKS[0], id: `recipe-${index}` })))).toThrow();
    expect(() => validateSavedPlaybooks([{ ...PROJECT_PLAYBOOKS[0] }, { ...PROJECT_PLAYBOOKS[0] }])).toThrow();
    const current = dataset(); current.rows = Array.from({ length: 520 }, (_, index) => ({ id: `row-${index}`, query: "ک".repeat(10000), page: "https://example.com/", clicks: 0, impressions: 1 })); current.sourceRows = 520;
    expect(() => validateProjectExtras(extraWith(current))).toThrow(/۵ مگابایت/);
  });

  it("keeps older backups without new metadata valid and rejects malformed metadata at the same boundary", () => {
    const source = createProject("قدیمی");
    const store = { version: 1, activeProjectId: source.id, projects: [source], settings: DEFAULT_SETTINGS };
    expect(validateStore(store)).toEqual(store);
    expect(() => validateStore({ ...store, projects: [{ ...source, searchConsole: [] }] })).toThrow();
    expect(() => validateStore({ ...store, settings: { ...DEFAULT_SETTINGS, playbooks: [{ id: "missing-fields" }] } })).toThrow();
  });
});
