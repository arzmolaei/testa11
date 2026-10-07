import { describe, expect, it } from "vitest";
import { analyzeKeyword, applyKeywordSuggestions, buildKeywordSuggestions, matchesKeywordRule } from "../src/suggestions";
import type { Row } from "../src/types";

describe("local Persian keyword organization", () => {
  it("separates explicit intention modifiers from the topic, with compound phrases taking precedence", () => {
    expect(analyzeKeyword("راهنمای خرید دوربین داهوا")).toMatchObject({ core: "دوربین داهوا", intent: "بررسی تجاری" });
    expect(analyzeKeyword("خرید دوربین داهوا")).toMatchObject({ core: "دوربین داهوا", intent: "تراکنشی" });
    expect(analyzeKeyword("آموزش نصب دوربین داهوا")).toMatchObject({ core: "دوربین داهوا", intent: "اطلاعاتی" });
    expect(analyzeKeyword("نصب دوربین داهوا")).toMatchObject({ core: "دوربین داهوا", intent: "نیاز به بررسی" });
    expect(analyzeKeyword("بهترین خرید دوربین داهوا").intent).toBe("نیاز به بررسی");
    expect(analyzeKeyword("دوربین داهوا").intent).toBeUndefined();
  });

  it("preserves brands, models, features and literal phrase differences", () => {
    const keywords = ["خرید دوربین داهوا ۱۲۳", "قیمت دوربين داهوا 123", "خرید دوربین هایک ویژن 123", "خرید دوربین داهوا 124", "خرید دوربین داهوا دید در شب", "خرید دوربین مدار بسته", "خرید دوربین مداربسته"];
    const preview = buildKeywordSuggestions(keywords.map((keyword, index) => ({ id: String(index), keyword })));
    expect(preview.groups).toHaveLength(6);
    expect(preview.groups.find((group) => group.label === "دوربین داهوا 123")?.rowIds).toEqual(["0", "1"]);
    expect(analyzeKeyword("شیر آب").core).not.toBe(analyzeKeyword("آب شیر").core);
    expect(analyzeKeyword("خرید دوربین برای خانه").core).toBe("دوربین برای خانه");
    const modelKeywords = ["خرید گوشی S24", "خرید گوشی S24+", "خرید دوربین 12.3", "خرید دوربین 12-3", "خرید دوربین 12/3"];
    expect(buildKeywordSuggestions(modelKeywords.map((keyword, index) => ({ id: `model-${index}`, keyword }))).groups).toHaveLength(5);
  });

  it("fills only missing fields by default and never invents difficulty, volume or a final decision", () => {
    const rows: Row[] = [
      { id: "a", keyword: "خرید دوربین داهوا", group: "گروه دستی", intent: "ترکیبی", kd: "سخت", volume: 5, notes: "manual", decision: "Review", custom1: "saved" },
      { id: "b", keyword: "قیمت دوربین داهوا", group: "گروه دوم", intent: "" },
      { id: "c", keyword: "دوربین داهوا", intent: "ناوبری" },
    ];
    const preview = buildKeywordSuggestions(rows);
    const result = applyKeywordSuggestions(rows, preview);
    expect(result.rows[0]).toBe(rows[0]);
    expect(result.rows[1]).toEqual({ ...rows[1], intent: "بررسی تجاری" });
    expect(result.rows[2]).toEqual({ ...rows[2], group: "دوربین داهوا" });
    expect(preview.protectedGroups).toBe(2);
    expect(preview.protectedIntents).toBe(2);
    expect(result.changed).toBe(2);
    expect(result.overwritten).toBe(0);
  });

  it("processes all 2000 keywords in one transaction without pagination or unstable IDs", () => {
    const rows: Row[] = Array.from({ length: 2000 }, (_, index) => ({ id: `keyword-${index}`, keyword: `${index % 2 ? "خرید" : "قیمت"} دوربین داهوا مدل ${index % 20}`, volume: index, kd: "متوسط", decision: "Keep", notes: `note-${index}`, custom2: `custom-${index}` }));
    const preview = buildKeywordSuggestions(rows);
    expect(preview.scopeCount).toBe(2000);
    expect(preview.groups).toHaveLength(20);
    expect(preview.groups.every((group) => group.rowIds.length === 100)).toBe(true);
    const result = applyKeywordSuggestions(rows, preview);
    expect(result.changed).toBe(2000);
    expect(result.groupChanges).toBe(2000);
    expect(result.intentChanges).toBe(2000);
    result.rows.forEach((row, index) => {
      expect(row).toEqual({ ...rows[index], group: `دوربین داهوا مدل ${index % 20}`, intent: index % 2 ? "تراکنشی" : "بررسی تجاری" });
    });
    expect(rows.every((row) => row.group === undefined && row.intent === undefined)).toBe(true);
  });

  it("handles 20000 distinct models with sparse maps rather than pairwise comparisons", () => {
    const rows: Row[] = Array.from({ length: 20000 }, (_, index) => ({ id: `id-${index}`, keyword: `خرید دوربین برند مدل ${index}`, custom10: `important-${index}` }));
    const started = performance.now();
    const preview = buildKeywordSuggestions(rows);
    const result = applyKeywordSuggestions(rows, preview);
    expect(preview.groups).toHaveLength(20000);
    expect(result.changed).toBe(20000);
    expect(result.rows[19999]).toEqual({ ...rows[19999], group: "دوربین برند مدل 19999", intent: "تراکنشی" });
    expect(performance.now() - started).toBeLessThan(8000);
  }, 10000);

  it("offers explicit user rules with normalized whole-phrase boundaries and visible precedence", () => {
    expect(matchesKeywordRule("خريد دوربين داهوا", "دوربین داهوا")).toBe(true);
    expect(matchesKeywordRule("دوربینی", "دوربین")).toBe(false);
    expect(matchesKeywordRule("قیمت دوربین، داهوا", "دوربین داهوا")).toBe(true);
    expect(matchesKeywordRule("دوربین", " ")).toBe(false);
    const rows: Row[] = [{ id: "a", keyword: "خرید دوربين داهوا" }, { id: "b", keyword: "دوربین هایک ویژن" }, { id: "c", keyword: "دوربینی" }];
    const preview = buildKeywordSuggestions(rows, { mode: "rules", rules: [
      { id: "specific", phrase: "دوربین داهوا", group: "محصولات داهوا" },
      { id: "general", phrase: "دوربین", group: "دوربین‌ها", intent: "بررسی تجاری" },
    ] });
    const result = applyKeywordSuggestions(rows, preview);
    expect(result.rows[0]).toEqual({ ...rows[0], group: "محصولات داهوا", intent: "بررسی تجاری" });
    expect(result.rows[1]).toEqual({ ...rows[1], group: "دوربین‌ها", intent: "بررسی تجاری" });
    expect(result.rows[2]).toBe(rows[2]);
  });

  it("limits both automatic suggestions and custom rules to selected stable IDs", () => {
    const rows: Row[] = [{ id: "a", keyword: "خرید دوربین" }, { id: "b", keyword: "خرید دوربین" }, { id: "c", keyword: "خرید دوربین" }];
    const preview = buildKeywordSuggestions(rows, { scopeIds: new Set(["b", "missing"]) });
    expect(preview.scopeCount).toBe(1);
    const result = applyKeywordSuggestions(rows, preview);
    expect(result.changed).toBe(1);
    expect(result.rows[0]).toBe(rows[0]);
    expect(result.rows[2]).toBe(rows[2]);
    expect(result.rows[1].id).toBe("b");
  });

  it("requires explicit overwrite settings and reports replaced manual fields", () => {
    const rows: Row[] = [{ id: "a", keyword: "خرید دوربین", group: "قبلی", intent: "اطلاعاتی", notes: "unchanged" }];
    expect(buildKeywordSuggestions(rows).suggestions).toHaveLength(0);
    const groupsOnly = applyKeywordSuggestions(rows, buildKeywordSuggestions(rows, { replaceGroups: true }));
    expect(groupsOnly.rows[0]).toEqual({ ...rows[0], group: "دوربین" });
    expect(groupsOnly.overwritten).toBe(1);
    const both = applyKeywordSuggestions(rows, buildKeywordSuggestions(rows, { replaceGroups: true, replaceIntents: true }));
    expect(both.overwritten).toBe(2);
    expect(both.rows[0]).toEqual({ ...rows[0], group: "دوربین", intent: "تراکنشی" });
  });

  it("lets a reviewer rename or exclude groups without changing other records", () => {
    const rows: Row[] = [{ id: "a", keyword: "خرید دوربین" }, { id: "b", keyword: "قیمت دوربین" }, { id: "c", keyword: "خرید کابل" }];
    const preview = buildKeywordSuggestions(rows);
    const camera = preview.groups.find((group) => group.label === "دوربین")!;
    const cable = preview.groups.find((group) => group.label === "کابل")!;
    const result = applyKeywordSuggestions(rows, preview, { labels: { [camera.id]: "دوربین‌های فروشگاه" }, excludedGroups: new Set([cable.id]) });
    expect(result.changed).toBe(2);
    expect(result.rows[0].group).toBe("دوربین‌های فروشگاه");
    expect(result.rows[1].group).toBe("دوربین‌های فروشگاه");
    expect(result.rows[2]).toBe(rows[2]);
    const noGroup = applyKeywordSuggestions(rows, preview, { labels: { [camera.id]: " " } });
    expect(noGroup.rows[0].group).toBeUndefined();
    expect(noGroup.rows[0].intent).toBe("تراکنشی");
  });

  it("preserves edits made after preview and applies against current rows by immutable ID", () => {
    const rows: Row[] = [{ id: "a", keyword: "خرید دوربین", notes: "original" }, { id: "b", keyword: "خرید کابل", notes: "original" }, { id: "c", keyword: "خرید مودم" }];
    const preview = buildKeywordSuggestions(rows);
    const current = [{ ...rows[1], notes: "updated after preview" }, { ...rows[0], intent: "ناوبری" }];
    const result = applyKeywordSuggestions(current, preview);
    expect(result.skipped).toBe(1);
    expect(result.changed).toBe(1);
    expect(result.rows[0]).toEqual({ ...current[0], group: "کابل", intent: "تراکنشی" });
    expect(result.rows[1]).toBe(current[1]);
    expect(result.rows).toHaveLength(2);
  });

  it("supports group-only or intention-only help, blank records and unmatched rules", () => {
    const rows: Row[] = [{ id: "a", keyword: "خرید دوربین" }, { id: "b", keyword: "کابل" }, { id: "c", keyword: "" }];
    const groups = applyKeywordSuggestions(rows, buildKeywordSuggestions(rows, { suggestIntents: false }));
    expect(groups.rows[0].intent).toBeUndefined();
    expect(groups.groupChanges).toBe(2);
    const intents = applyKeywordSuggestions(rows, buildKeywordSuggestions(rows, { suggestGroups: false }));
    expect(intents.groupChanges).toBe(0);
    expect(intents.changed).toBe(1);
    expect(intents.rows[1].intent).toBeUndefined();
    expect(buildKeywordSuggestions(rows, { mode: "rules", rules: [{ id: "empty", phrase: "", group: "test" }] }).suggestions).toHaveLength(0);
  });
});
