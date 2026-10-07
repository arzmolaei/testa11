import { describe, expect, it } from "vitest";
import { applyCellChanges, encodeClipboard, parseClipboard, parseBulkValue, previewPaste, validateBulkRows } from "../src/bulk-edit";
import { SCHEMAS } from "../src/domain";
import type { Row } from "../src/types";
import { validBulkDraft } from "../src/bulk-draft";

const fields = SCHEMAS.keywords[0].fields;
describe("bulk spreadsheet transactions", () => {
  it("pastes a rectangular selection with Persian numbers without changing identity or unrelated manual notes", () => {
    const rows: Row[] = [{ id: "a", keyword: "اول", notes: "keep" }, { id: "b", keyword: "دوم", group: "manual" }];
    const plan = previewPaste("نو\t۱٬۲۵۰\nبعدی\t۰\n", rows, fields, 0, 0);
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toBe(2);
    const applied = applyCellChanges(rows, plan.changes);
    expect(applied).toEqual([{ id: "a", keyword: "نو", volume: 1250, notes: "keep" }, { id: "b", keyword: "بعدی", volume: 0, group: "manual" }]);
    expect(rows[0].keyword).toBe("اول");
  });
  it("blocks the entire invalid paste preview, including out of bounds and unrecognized enum values", () => {
    const rows: Row[] = [{ id: "a", keyword: "اول" }];
    expect(previewPaste("wrong", rows, fields, 0, 3).errors.length).toBe(1);
    expect(previewPaste("a\nb", rows, fields, 0, 0).changes).toEqual([]);
    expect(previewPaste("-1", rows, fields, 0, 1).errors.length).toBe(1);
  });
  it("roundtrips quoted multiline notes and does not invent a trailing blank row", () => {
    const notes = [{ key: "notes", label: "notes" }];
    const encoded = encodeClipboard([{ id: "a", notes: 'one\n"two"\tthree' }], notes);
    expect(parseClipboard(encoded + "\r\n")).toEqual([['one\n"two"\tthree']]);
  });
  it("protects immutable identifiers and bounded tool metrics", () => {
    expect(() => applyCellChanges([{ id: "a" }], [{ id: "a", key: "id", value: "b" }])).toThrow();
    expect(() => parseBulkValue({ key: "ctr", label: "CTR", type: "number" }, "۱۰۱")).toThrow();
    expect(parseBulkValue({ key: "volume", label: "حجم", type: "number" }, "٠")).toBe(0);
    expect(() => parseBulkValue({ key: "nextAction", label: "next", calculated: true }, "foo")).toThrow();
  });
  it("only accepts dates through the explicit Jalali parser", () => {
    const field = { key: "publishDate", label: "تاریخ", type: "date" as const };
    expect(parseBulkValue(field, "۱۴۰۵/۰۷/۱۵", () => "2026-10-07")).toBe("2026-10-07");
    expect(() => parseBulkValue(field, "wrong", () => null)).toThrow();
  });
  it("validates mandatory values and duplicate display identifiers only for edited rows", () => {
    expect(validateBulkRows("keywords", [{ id: "a", keyword: "" }], new Set(["a"]))).toContain("خالی");
    expect(validateBulkRows("pages", [{ id: "a", target: "x", pageId: "P1" }, { id: "b", target: "y", pageId: "p1" }], new Set(["b"]))).toContain("تکراری");
    expect(validateBulkRows("results", [{ id: "a", pageId: "page" }], new Set(["a"]))).toBeNull();
  });
  it("updates all two thousand selected keyword records in one transaction", () => {
    const rows: Row[] = Array.from({ length: 2000 }, (_, n) => ({ id: `k${n}`, keyword: `کلمه ${n}`, notes: `note${n}` }));
    const applied = applyCellChanges(rows, rows.map((r) => ({ id: r.id, key: "intent", value: "اطلاعاتی" })));
    expect(applied.filter((r) => r.intent === "اطلاعاتی")).toHaveLength(2000);
    expect(applied[1999].notes).toBe("note1999");
    expect(applied[1999].id).toBe("k1999");
  });
  it("refuses stale foreign-project recovery and drafts that mutate immutable IDs", () => {
    const draft = { version: 1, projectId: "p", collection: "keywords", savedAt: "2026-10-07T10:00:00Z", patches: [["k", { group: "x" }]], additions: [], deleted: [], baselines: [["k", { id: "k", keyword: "x" }]], editing: null };
    expect(validBulkDraft(draft, "p", "keywords")).toBe(true);
    expect(validBulkDraft(draft, "other", "keywords")).toBe(false);
    expect(validBulkDraft({ ...draft, patches: [["k", { id: "evil" }]] }, "p", "keywords")).toBe(false);
    expect(validBulkDraft({ ...draft, baselines: [["k", { id: "other" }]] }, "p", "keywords")).toBe(false);
    expect(validBulkDraft({ ...draft, editing: { id: "k", key: "id", value: "evil" } }, "p", "keywords")).toBe(false);
  });
  it("prevents duplicate result pages and broken linked references in edited records", () => {
    const rows: Row[] = [{ id: "a", pageId: "p1", url: "https://x.test/" }, { id: "b", pageId: "p1" }];
    expect(validateBulkRows("results", rows, new Set(["b"]))).toContain("دیگری");
    expect(validateBulkRows("content", [{ id: "c", topic: "Topic", targetPage: "missing" }], new Set(["c"]), [])).toContain("معتبر");
    expect(validateBulkRows("pages", [{ id: "a", target: "a" }, { id: "a", target: "b" }], new Set(["a"]))).toContain("داخلی");
  });
});
