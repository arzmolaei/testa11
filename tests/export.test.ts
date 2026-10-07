import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildWorkbook } from "../src/export";
import { demoStore, SCHEMAS } from "../src/domain";

const names = [
  "00_START",
  "01_KEYWORDS",
  "02_PAGES",
  "03_CONTENT",
  "04_RESULTS",
  "99_SETTINGS",
];
function column(sheet: ExcelJS.Worksheet, label: string): number {
  const cells = sheet.getRow(4).values as unknown[];
  return cells.findIndex((value) => value === label);
}

describe("portable SEO workbook", () => {
  it("round-trips six RTL sheets, stable manual data, formulas, dropdowns and independent groups", async () => {
    const store = demoStore();
    const project = store.projects[0];
    project.keywords[0].notes =
      '=HYPERLINK("https://example.com","preserve as text")';
    project.keywords[0].custom01 = "حاشیه سود دستی";
    project.keywords.push({
      id: "stable-duplicate",
      keyword: "دوربين مداربسته",
      decision: "Review",
      notes: "تکرار برای بررسی؛ حذف نشود",
    });
    store.settings.customLabels = { custom01: "حاشیه سود" };
    const original = JSON.stringify(project);
    const book = await buildWorkbook(project, store.settings);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(names);
    const buffer = await book.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(10000);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer);
    expect(loaded.worksheets.map((sheet) => sheet.name)).toEqual(names);
    loaded.worksheets.forEach((sheet) => {
      expect(sheet.views[0].rightToLeft).toBe(true);
      expect(
        sheet.getCell(
          sheet.name === "00_START" || sheet.name === "99_SETTINGS"
            ? "A1"
            : "B1",
        ).font?.name,
      ).toBe("Vazirmatn");
    });
    const keywords = loaded.getWorksheet("01_KEYWORDS")!;
    expect(keywords.views[0].state).toBe("frozen");
    expect(keywords.getColumn(1).hidden).toBe(true);
    expect(keywords.getCell(5, 1).value).toBe(project.keywords[0].id);
    expect(keywords.getCell(5, column(keywords, "یادداشت")).value).toBe(
      project.keywords[0].notes,
    );
    expect(keywords.getCell(5, column(keywords, "یادداشت")).type).toBe(
      ExcelJS.ValueType.String,
    );
    expect(keywords.getCell(5, column(keywords, "حاشیه سود")).value).toBe(
      "حاشیه سود دستی",
    );
    const kd = column(keywords, "سختی کلمه");
    expect(keywords.getCell(5, kd).dataValidation.type).toBe("list");
    expect(keywords.getCell(20004, kd).dataValidation.formulae).toEqual([
      "seo_kd",
    ]);
    expect(loaded.definedNames.getRanges("seo_kd").ranges).toHaveLength(1);
    const normalized = column(keywords, "کلید نرمال‌شده");
    expect(keywords.getColumn(normalized).hidden).toBe(true);
    expect(keywords.getCell(5, normalized).value).toBe(
      keywords.getCell(11, normalized).value,
    );
    expect(
      keywords.getCell(11, column(keywords, "وضعیت تکرار")).value,
    ).toContain("تکراری");
    const groupColumns = keywords.columns.map((col) => ({
      hidden: col.hidden,
      level: col.outlineLevel,
    }));
    expect(
      groupColumns.filter((col) => col.hidden && col.level === 1).length,
    ).toBeGreaterThan(20);
    expect(
      groupColumns.some(
        (col, index) =>
          !col.hidden &&
          index > 8 &&
          groupColumns[index - 1].level === 1 &&
          groupColumns[index + 1]?.level === 1,
      ),
    ).toBe(true);
    expect(keywords.autoFilter).toBeTruthy();
    expect(keywords.getTable("SEO_KEYWORDS")).toBeTruthy();
    const pages = loaded.getWorksheet("02_PAGES")!;
    const length = pages.getCell(5, column(pages, "طول عنوان"));
    expect(length.formula).toContain("LEN(TRIM(");
    expect(length.result).toBeGreaterThan(0);
    expect(
      pages.getCell(5, column(pages, "سیگنال بررسی عنوان")).formula,
    ).toContain("'99_SETTINGS'!$B$4");
    const results = loaded.getWorksheet("04_RESULTS")!;
    expect(results.getCell(5, column(results, "تغییر کلیک")).formula).toContain(
      "ROUND(",
    );
    expect(results.getCell(5, column(results, "تغییر کلیک")).result).toBe(42);
    expect(results.getCell(5, column(results, "بهبود رتبه")).result).toBe(2.8);
    expect(results.getCell(5, column(results, "صفحه مرتبط")).value).toBe(
      "P-001",
    );
    expect(
      results.getCell(5, column(results, "شناسه ثابت صفحه مرتبط")).value,
    ).toBe(project.pages[0].id);
    loaded.worksheets.forEach((sheet) =>
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          expect(cell.type).not.toBe(ExcelJS.ValueType.Error);
          if (cell.formula) {
            expect(cell.formula).not.toMatch(
              /#REF!|#VALUE!|#NAME\?|#DIV\/0!|INDIRECT\(|OFFSET\(/,
            );
            expect(cell.result).not.toBeInstanceOf(Error);
          }
        }),
      ),
    );
    expect(JSON.stringify(project)).toBe(original);
  }, 30000);

  it("keeps missing metrics empty and zero metrics numeric without inventing comparisons", async () => {
    const store = demoStore();
    const project = store.projects[0];
    project.keywords = [{ id: "zero", keyword: "کلمه تست", volume: 0 }];
    project.results = [
      { id: "result", url: "https://example.com", clicks: 0, impressions: 0 },
    ];
    const workbook = await buildWorkbook(project, store.settings);
    const keywords = workbook.getWorksheet("01_KEYWORDS")!;
    expect(keywords.getCell(5, column(keywords, "حجم جست‌وجو")).value).toBe(0);
    const results = workbook.getWorksheet("04_RESULTS")!;
    expect(results.getCell(5, column(results, "تغییر کلیک")).result).toBe("");
    expect(results.getCell(5, column(results, "بهبود رتبه")).result).toBe("");
    expect(keywords.rowCount).toBe(105);
    expect(results.rowCount).toBe(105);
  });

  it("exports every schema field and rejects an oversized Excel cell clearly", async () => {
    const store = demoStore();
    const workbook = await buildWorkbook(store.projects[0], store.settings);
    for (const [collection, sections] of Object.entries(SCHEMAS)) {
      const sheet = workbook.getWorksheet(
        {
          keywords: "01_KEYWORDS",
          pages: "02_PAGES",
          content: "03_CONTENT",
          results: "04_RESULTS",
        }[collection as keyof typeof SCHEMAS],
      )!;
      for (const field of sections.flatMap((section) => section.fields))
        expect(column(sheet, field.label)).toBeGreaterThan(0);
    }
    store.projects[0].keywords[0].notes = "x".repeat(32768);
    await expect(
      buildWorkbook(store.projects[0], store.settings),
    ).rejects.toThrow("۳۲٬۷۶۷");
  });
});
