import ExcelJS from "exceljs";
import type {
  Collection,
  Field,
  Project,
  Row,
  Section,
  Settings,
} from "./types";
import {
  SCHEMAS,
  LISTS,
  fieldValue,
  summarize,
  normalizeKeyword,
  duplicates,
} from "./domain";

const COLORS = {
  ink: "FF263D3B",
  muted: "FF68817C",
  paper: "FFF6F8F5",
  white: "FFFFFFFF",
  teal: "FF0F766E",
  mint: "FFE8F5EE",
  violet: "FFF0EBFB",
  blue: "FFEBF3FB",
  amber: "FFFFF4DC",
  orange: "FFFFEBDD",
  rose: "FFFCE8ED",
  line: "FFE1EAE5",
};
const FONT = "Vazirmatn";
const HEADER_ROW = 4;
const FIRST_ROW = HEADER_ROW + 1;
const BUFFER_ROWS = 100;
const SHEETS: Record<Collection, string> = {
  keywords: "01_KEYWORDS",
  pages: "02_PAGES",
  content: "03_CONTENT",
  results: "04_RESULTS",
};
type ExportField = Field & {
  module: string;
  moduleKey: string;
  hidden: boolean;
};
type ValidationBag = {
  add: (range: string, value: ExcelJS.DataValidation) => void;
};
type SheetWithValidations = ExcelJS.Worksheet & {
  dataValidations: ValidationBag;
};
const cellStyles = new Map<string, Partial<ExcelJS.Style>>();

function columnLetter(index: number): string {
  let text = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    text = String.fromCharCode(65 + ((value - 1) % 26)) + text;
  }
  return text;
}

// Text is written as an XLSX string, never interpreted as a formula. Preserve even
// strings beginning with =, +, - or @ instead of changing the user's original data.
function safeValue(value: unknown): string | number {
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  const text = value == null ? "" : String(value);
  if (text.length > 32767)
    throw new Error(
      "یکی از متن‌ها از ظرفیت ۳۲٬۷۶۷ نویسه یک سلول اکسل بیشتر است. آن را کوتاه کنید یا پشتیبان JSON بگیرید.",
    );
  return text;
}

function baseSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  freeze = 0,
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, {
    properties: {
      defaultRowHeight: 27,
      outlineProperties: { summaryBelow: true, summaryRight: true },
    },
    views: [
      {
        rightToLeft: true,
        showGridLines: false,
        ...(freeze
          ? {
              state: "frozen" as const,
              xSplit: 2,
              ySplit: freeze,
              activeCell: "C5",
            }
          : {}),
      },
    ],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  sheet.properties.outlineLevelCol = 1;
  return sheet;
}

function paint(cell: ExcelJS.Cell, fill = COLORS.white, bold = false): void {
  const key = `${fill}:${bold}`;
  if (!cellStyles.has(key))
    cellStyles.set(key, {
      font: { name: FONT, size: 11, color: { argb: COLORS.ink }, bold },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: fill } },
      alignment: {
        vertical: "middle",
        horizontal: "right",
        readingOrder: "rtl",
        wrapText: true,
      },
      border: { bottom: { style: "hair", color: { argb: COLORS.line } } },
    });
  // The outer object is per cell: ExcelJS mutates it when applying numFmt or an
  // alignment override. Shared font/fill/border objects remain immutable.
  cell.style = { ...cellStyles.get(key)! };
}

function band(
  sheet: ExcelJS.Worksheet,
  row: number,
  from: number,
  to: number,
  text: string,
  fill: string,
): void {
  if (to > from) sheet.mergeCells(row, from, row, to);
  const cell = sheet.getCell(row, from);
  cell.value = text;
  paint(cell, fill, true);
  if (fill === COLORS.teal)
    cell.font = {
      name: FONT,
      size: 16,
      bold: true,
      color: { argb: COLORS.white },
    };
}

function noteFor(field: Field, module: string): string {
  const computedNote =
    field.key.startsWith("_") || field.key === "pkwInH1"
      ? "محاسبه‌شده در زمان خروجی؛ برای بررسی دوباره پس از تغییر ورودی‌ها، از وب‌اپ خروجی جدید بگیرید."
      : "محاسبه‌شده؛ با تغییر ورودی‌ها به‌روز می‌شود. مقدار دستی ننویسید.";
  return `${field.label}\n${field.hint || `این فیلد در بخش «${module}» استفاده می‌شود.`}\n${field.calculated ? computedNote : "قابل ویرایش؛ داده و تصمیم شما به شناسه ثابت همین ردیف متصل است."}\nشناسه فیلد: ${field.key}`;
}

function flattenSections(
  sections: Section[],
  settings: Settings,
  collection: Collection,
  rows: Row[],
): ExportField[] {
  const fields: ExportField[] = [
    {
      key: "id",
      label: "شناسه ثابت",
      module: "شناسه",
      moduleKey: "identity",
      hidden: true,
    },
  ];
  sections.forEach((section, index) =>
    section.fields.forEach((field) =>
      fields.push({
        ...field,
        label: settings.customLabels?.[field.key] || field.label,
        module: section.label,
        moduleKey: section.key,
        hidden: index > 0,
      }),
    ),
  );
  if (collection === "keywords")
    fields.push(
      {
        key: "_normalizedKey",
        label: "کلید نرمال‌شده",
        module: "کنترل داده",
        moduleKey: "dataSafety",
        hidden: true,
        calculated: true,
        hint: "برابری فنی فارسی؛ فقط در زمان خروجی گرفتن محاسبه شده است. برای بررسی دوباره پس از ویرایش، از وب‌اپ خروجی جدید بگیرید.",
      },
      {
        key: "_duplicateStatus",
        label: "وضعیت تکرار",
        module: "کنترل داده",
        moduleKey: "dataSafety",
        hidden: true,
        calculated: true,
        hint: "هیچ ردیفی حذف نشده است. این علامت تصویر زمان خروجی است؛ ردیف تکراری را خودتان بازبینی کنید.",
      },
    );
  if (collection === "content" || collection === "results")
    fields.push({
      key: "_pageRef",
      label: "شناسه ثابت صفحه مرتبط",
      module: "کنترل داده",
      moduleKey: "dataSafety",
      hidden: true,
      hint: "رابطه اصلی با صفحه با این شناسه ثابت برقرار است؛ کد نمایشی قابل تغییر است.",
    });
  const known = new Set(fields.map((field) => field.key));
  for (const row of rows)
    for (const key of Object.keys(row)) {
      if (!known.has(key)) {
        fields.push({
          key,
          label: `فیلد دیگر • ${key}`,
          module: "سایر داده‌ها",
          moduleKey: "extraData",
          hidden: true,
        });
        known.add(key);
      }
    }
  // A narrow ungrouped gutter separates adjacent groups, allowing each optional
  // module to expand independently instead of Excel joining them into one group.
  const grouped: ExportField[] = [];
  fields.forEach((field, index) => {
    const previous = fields[index - 1];
    if (
      previous?.hidden &&
      previous.moduleKey !== "identity" &&
      field.moduleKey !== previous.moduleKey
    ) {
      grouped.push({
        key: `_gutter_${previous.moduleKey}`,
        label: `+ ${previous.module}`,
        module: "بازکردن بخش",
        moduleKey: `gutter_${previous.moduleKey}`,
        hidden: false,
      });
    }
    grouped.push(field);
  });
  const last = fields.at(-1);
  if (last?.hidden)
    grouped.push({
      key: `_gutter_${last.moduleKey}`,
      label: `+ ${last.module}`,
      module: "بازکردن بخش",
      moduleKey: `gutter_${last.moduleKey}`,
      hidden: false,
    });
  return grouped;
}

function listKey(options: string[] | undefined): string | undefined {
  if (!options) return undefined;
  return Object.entries(LISTS).find(
    ([, list]) => JSON.stringify(list) === JSON.stringify(options),
  )?.[0];
}

function writeSettings(
  workbook: ExcelJS.Workbook,
  settings: Settings,
  project: Project,
): Map<string, string> {
  const sheet = baseSheet(workbook, "99_SETTINGS");
  sheet.getColumn(1).width = 29;
  sheet.getColumn(2).width = 26;
  sheet.getColumn(3).width = 44;
  sheet.getColumn(4).width = 45;
  band(sheet, 1, 1, 4, "تنظیمات و راهنمای فیلدها", COLORS.teal);
  band(
    sheet,
    2,
    1,
    4,
    "حد طول عنوان و متا فقط نشانه بازبینی است؛ امتیاز یا عامل تضمینی رتبه نیست.",
    COLORS.paper,
  );
  const controls: [string, string | number][] = [
    ["حداقل طول عنوان", settings.titleMin],
    ["حداکثر طول عنوان", settings.titleMax],
    ["حداقل طول متا", settings.metaMin],
    ["حداکثر طول متا", settings.metaMax],
    ["پروژه", project.name],
    ["دامنه", project.domain],
    ["بازار", project.market],
    ["زبان", project.language],
    ["نوع پروژه", project.projectType],
  ];
  controls.forEach(([label, value], index) => {
    const row = index + 4;
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = safeValue(value);
    paint(sheet.getCell(row, 1), COLORS.paper, true);
    paint(sheet.getCell(row, 2));
    if (index < 4)
      sheet.getCell(row, 2).dataValidation = {
        type: "whole",
        operator: "between",
        formulae: [1, 500],
        allowBlank: false,
        showErrorMessage: true,
        errorTitle: "طول نامعتبر",
        error: "یک عدد بین ۱ تا ۵۰۰ وارد کنید.",
      };
  });
  const names = new Map<string, string>();
  const allLists: Record<string, string[]> = { ...LISTS };
  Object.values(SCHEMAS)
    .flatMap((sections) => sections.flatMap((section) => section.fields))
    .forEach((field) => {
      if (field.options && !listKey(field.options))
        allLists[`field_${field.key}`] = field.options;
    });
  Object.entries(allLists).forEach(([key, values], index) => {
    const col = index + 6;
    sheet.getColumn(col).width = 28;
    sheet.getCell(3, col).value = key;
    paint(sheet.getCell(3, col), index % 2 ? COLORS.violet : COLORS.mint, true);
    values.forEach((value, item) => {
      const cell = sheet.getCell(item + 4, col);
      cell.value = value;
      paint(cell);
    });
    const name = `seo_${key.replace(/[^A-Za-z0-9_]/g, "_")}`;
    const address = `'99_SETTINGS'!$${columnLetter(col)}$4:$${columnLetter(col)}$${values.length + 3}`;
    workbook.definedNames.add(address, name);
    names.set(key, name);
  });
  const guideRow = Math.max(
    19,
    ...Object.values(allLists).map((list) => list.length + 8),
  );
  band(
    sheet,
    guideRow,
    1,
    4,
    "راهنمای فیلدها • برای یادگیری و مرور",
    COLORS.teal,
  );
  ["فیلد", "معنی / راهنما", "زمان استفاده", "نوع ورود"].forEach(
    (value, index) => {
      const cell = sheet.getCell(guideRow + 1, index + 1);
      cell.value = value;
      paint(cell, COLORS.mint, true);
    },
  );
  let cursor = guideRow + 2;
  Object.entries(SCHEMAS).forEach(([collection, sections]) =>
    sections.forEach((section) =>
      section.fields.forEach((field) => {
        const values = [
          settings.customLabels?.[field.key] || field.label,
          field.hint || noteFor(field, section.label),
          `${SHEETS[collection as Collection]} • ${section.label}`,
          field.calculated
            ? "محاسبه‌شده • آبی روشن"
            : "ورودی / تصمیم دستی • سفید",
        ];
        values.forEach((value, index) => {
          const cell = sheet.getCell(cursor, index + 1);
          cell.value = value;
          paint(cell, cursor % 2 ? COLORS.white : COLORS.paper);
        });
        sheet.getRow(cursor).height = 47;
        cursor++;
      }),
    ),
  );
  sheet.autoFilter = {
    from: { row: guideRow + 1, column: 1 },
    to: { row: cursor - 1, column: 4 },
  };
  return names;
}

function writeStart(
  workbook: ExcelJS.Workbook,
  project: Project,
  settings: Settings,
): void {
  const sheet = baseSheet(workbook, "00_START");
  for (let col = 1; col <= 8; col++) sheet.getColumn(col).width = 19;
  for (let row = 1; row <= 42; row++)
    for (let col = 1; col <= 8; col++)
      paint(sheet.getCell(row, col), COLORS.paper);
  band(sheet, 1, 1, 8, "رویش • فضای روشن مدیریت سئو", COLORS.teal);
  sheet.getRow(1).height = 52;
  band(
    sheet,
    2,
    1,
    8,
    "از اولین کلمه تا اندازه‌گیری نتیجه • یک ردیف برای هر کلمه، صفحه یا محتوای مستقل",
    COLORS.paper,
  );
  const info: [string, string][] = [
    ["نام پروژه", project.name],
    ["دامنه", project.domain],
    ["بازار", project.market],
    ["زبان", project.language],
    ["نوع پروژه", project.projectType],
    ["هدف سئو", project.goal],
    ["تاریخ شروع", project.startDate],
    ["آخرین مرور", project.lastReview],
  ];
  info.forEach(([label, value], index) => {
    const row = 4 + Math.floor(index / 2) * 2;
    const from = index % 2 ? 5 : 1;
    band(sheet, row, from, from + 3, label, COLORS.paper);
    band(
      sheet,
      row + 1,
      from,
      from + 3,
      value || "هنوز ثبت نشده",
      COLORS.white,
    );
    sheet.getRow(row + 1).height = index === 5 ? 52 : 32;
  });
  // Project type is editable without changing the data model or adding a sheet.
  sheet.getCell("A9").dataValidation = {
    type: "list",
    formulae: ["seo_projectType"],
    allowBlank: true,
  };
  const summary = summarize(project, settings);
  band(sheet, 13, 1, 4, "مرحله فعلی", COLORS.mint);
  band(sheet, 13, 5, 8, "مرحله بعد", COLORS.violet);
  band(
    sheet,
    14,
    1,
    4,
    `${summary.stage} / 5 • ${summary.stageTitle}`,
    COLORS.white,
  );
  band(sheet, 14, 5, 8, summary.nextStage, COLORS.white);
  band(sheet, 16, 1, 8, "الان چه کار کنم؟", COLORS.teal);
  band(sheet, 17, 1, 8, summary.action, COLORS.mint);
  sheet.getRow(17).height = 48;
  const stages = [
    [
      "۱ • پژوهش کلمات",
      "کلمه، حجم، سختی، نیت، تصمیم و گروه را تکمیل کنید. عنوان و متا را در مرحله صفحات بنویسید.",
    ],
    [
      "۲ • نقشه صفحات",
      "برای گروه‌های مناسب صفحه بسازید؛ PKW، نوع صفحه، URL، اقدام و SERP را تعیین کنید.",
    ],
    [
      "۳ • سئوی داخل صفحه",
      "گروه سئوی داخل صفحه را باز کنید: عنوان سئو، H1، متا و سپس بریف صفحه.",
    ],
    [
      "۴ • اجرا و انتشار",
      "محتوا، لینک‌های داخلی و چک‌لیست فنی را تکمیل کنید؛ وضعیت و تاریخ انتشار را ثبت کنید.",
    ],
    [
      "۵ • نتایج و بهبود",
      "کلیک، نمایش، CTR، رتبه و تبدیل را برای دوره یکسان ثبت کنید؛ سپس تصمیم بهبود بگیرید.",
    ],
  ];
  stages.forEach(([title, help], index) => {
    const row = 20 + index;
    band(
      sheet,
      row,
      1,
      2,
      title,
      index + 1 === summary.stage ? COLORS.mint : COLORS.white,
    );
    band(sheet, row, 3, 8, help, COLORS.white);
    sheet.getRow(row).height = 48;
  });
  band(
    sheet,
    26,
    1,
    8,
    "پیشرفت سبک • شمارش واقعی، بدون امتیاز ساختگی",
    COLORS.teal,
  );
  const stats: [string, number][] = [
    ["کل کلمات", summary.totals.keywords],
    ["کلمات بررسی‌شده", summary.totals.reviewed],
    ["کلمات گروه‌بندی‌شده", summary.totals.grouped],
    ["صفحات هدف‌گذاری‌شده", summary.totals.mapped],
    ["صفحات آماده", summary.totals.ready],
    ["صفحات بهینه‌شده", summary.totals.optimized],
    ["صفحات منتشرشده", summary.totals.published],
    ["صفحات تحت پایش", summary.totals.monitored],
  ];
  stats.forEach(([label, value], index) => {
    const row = 27 + Math.floor(index / 2);
    const from = index % 2 ? 5 : 1;
    band(sheet, row, from, from + 2, label, COLORS.white);
    sheet.getCell(row, from + 3).value = value;
    paint(sheet.getCell(row, from + 3), COLORS.mint, true);
  });
  band(sheet, 33, 1, 8, "راهنمای استفاده امن", COLORS.teal);
  const tips = [
    "سفید = ورودی و تصمیم دستی • آبی روشن = محاسبه‌شده • گروه‌های پیشرفته با علامت + ستون باز می‌شوند.",
    "برای مرتب‌سازی از فیلتر سرستون جدول استفاده کنید تا تمام داده‌های ردیف و شناسه ثابت با هم جابه‌جا شوند.",
    "این فایل ۱۰۰ ردیف آماده اضافه دارد؛ اعتبارسنجی‌ها تا ۲۰٬۰۰۰ کلمه و ۲٬۰۰۰ ردیف در هر بخش دیگر آماده‌اند.",
    "مقایسه فنی فارسی، تکرارها و خلاصه مسیر، تصویر زمان خروجی هستند. ورود امن معیارها با تطبیق کلمه در وب‌اپ انجام می‌شود.",
    "برای فرمول‌ها، عنوان/متا و تغییرات دوره، سلول محاسبه‌شده را کپی کنید. در Google Sheets ممکن است گروه‌بندی یا ظاهر فیلترها متفاوت باشد.",
  ];
  tips.forEach((tip, index) => {
    band(sheet, 34 + index, 1, 8, tip, COLORS.white);
    sheet.getRow(34 + index).height = 43;
  });
  band(
    sheet,
    40,
    1,
    8,
    "راهنمای تمام فیلدها و فهرست‌های انتخاب در 99_SETTINGS قرار دارد. داده‌های این پروژه نمونه‌اند؛ آن‌ها را با داده واقعی جایگزین کنید.",
    COLORS.violet,
  );
  sheet.getRow(40).height = 45;
  sheet.pageSetup.printArea = "A1:H40";
}

function localFormula(
  collection: Collection,
  fieldKey: string,
  rowNumber: number,
  fields: ExportField[],
): string | undefined {
  const ref = (key: string) =>
    `${columnLetter(fields.findIndex((field) => field.key === key) + 1)}${rowNumber}`;
  const value = (proposed: string, current: string) =>
    `IF(${ref(proposed)}="",${ref(current)},${ref(proposed)})`;
  const quoted = (text: string) => `"${text.replace(/"/g, '""')}"`;
  const chain = (conditions: [string, string][], fallback: string) =>
    conditions.reduceRight(
      (formula, [test, output]) => `IF(${test},${quoted(output)},${formula})`,
      quoted(fallback),
    );
  if (collection === "pages") {
    const title = value("proposedTitle", "currentTitle");
    const meta = value("proposedMeta", "currentMeta");
    if (fieldKey === "titleLength" || fieldKey === "metaLength") {
      const text = fieldKey === "titleLength" ? title : meta;
      return `IF(${text}="","",LEN(TRIM(${text})))`;
    }
    if (fieldKey === "titleReview" || fieldKey === "metaReview") {
      const text = fieldKey === "titleReview" ? title : meta;
      const min = fieldKey === "titleReview" ? 4 : 6;
      return `IF(${text}="","ثبت نشده",IF(LEN(TRIM(${text}))<'99_SETTINGS'!$B$${min},"کوتاه؛ بازبینی کنید",IF(LEN(TRIM(${text}))>'99_SETTINGS'!$B$${min + 1},"بلند؛ بازبینی کنید","در محدوده پیشنهادی")))`;
    }
    if (fieldKey === "nextAction") {
      const is = (key: string, options: string[]) =>
        `OR(${options.map((option) => `${ref(key)}=${quoted(option)}`).join(",")})`;
      const bothEmpty = (a: string, b: string) =>
        `AND(${ref(a)}="",${ref(b)}="")`;
      return chain(
        [
          [`${ref("target")}=""`, "هدف صفحه را مشخص کنید"],
          [`${ref("action")}="No Dedicated Page"`, "صفحه مستقل نیاز ندارد"],
          [`${ref("status")}="Complete"`, "تکمیل شده"],
          [
            `OR(${is("status", ["Published", "Monitoring", "Complete"])},${is("executionStatus", ["Published", "Complete"])})`,
            "داده‌های سرچ کنسول را ثبت کنید",
          ],
          [`${ref("pkw")}=""`, "کلمه کلیدی اصلی را انتخاب کنید"],
          [
            `NOT(${is("serpCheck", ["Checked", "Complete", "Pass", "Yes", "تأیید شده", "بررسی شده"])})`,
            "نتایج جست‌وجو را بررسی کنید",
          ],
          [is("pageType", ["", "Needs Review"]), "نوع صفحه را انتخاب کنید"],
          [
            is("existing", ["", "Unknown"]),
            "موجود یا جدید بودن صفحه را مشخص کنید",
          ],
          [is("action", ["", "Needs Review"]), "اقدام صفحه را انتخاب کنید"],
          [`${ref("url")}=""`, "URL هدف را انتخاب کنید"],
          [bothEmpty("proposedTitle", "currentTitle"), "عنوان سئو را بنویسید"],
          [bothEmpty("proposedH1", "currentH1"), "عنوان H1 را بنویسید"],
          [bothEmpty("proposedMeta", "currentMeta"), "توضیحات متا را بنویسید"],
          [`${ref("pageBrief")}=""`, "بریف و ساختار صفحه را آماده کنید"],
          [
            `NOT(OR(${is("status", ["In Progress", "Review", "Ready"])},${is("executionStatus", ["In Progress", "Review", "Ready"])}))`,
            "صفحه را ایجاد یا بهینه کنید",
          ],
          [
            `NOT(${is("internalLinkingStatus", ["Complete", "Not Applicable"])})`,
            "لینک‌های داخلی را تکمیل کنید",
          ],
          [
            `NOT(AND(${["indexable", "canonical", "robots", "breadcrumb", "schema", "mobileCheck", "speedCheck"].map((key) => is(key, ["Pass", "Not Applicable"])).join(",")}))`,
            "چک‌لیست فنی را بررسی کنید",
          ],
        ],
        "صفحه را منتشر یا به‌روزرسانی کنید",
      );
    }
  }
  if (collection === "results") {
    const pairs: Record<string, [string, string]> = {
      clicksChange: ["clicks", "previousClicks"],
      impressionsChange: ["impressions", "previousImpressions"],
      ctrChange: ["ctr", "previousCtr"],
      positionChange: ["previousPosition", "position"],
    };
    if (pairs[fieldKey]) {
      const [current, previous] = pairs[fieldKey].map(ref);
      return `IF(OR(${current}="",${previous}=""),"",ROUND(${current}-${previous},2))`;
    }
    if (fieldKey === "nextAction")
      return chain(
        [
          [`${ref("result")}="Complete"`, "تکمیل شده"],
          [
            `AND(${ref("url")}="",${ref("pageId")}="")`,
            "صفحه پایش را انتخاب کنید",
          ],
          [`${ref("baselineDate")}=""`, "تاریخ مبنا را ثبت کنید"],
          [
            `OR(${ref("clicks")}="",${ref("impressions")}="",${ref("position")}="")`,
            "داده‌های سرچ کنسول را ثبت کنید",
          ],
          [
            `OR(${ref("result")}="Not Enough Data",${ref("impressions")}<30)`,
            "برای داده بیشتر صبر کنید",
          ],
          [
            `${ref("result")}="Dropping"`,
            "افت عملکرد و تغییرات صفحه را بررسی کنید",
          ],
          [`${ref("result")}="Needs Work"`, "صفحه را بهبود دهید"],
          [`${ref("result")}=""`, "نتیجه را بررسی و ثبت کنید"],
          [
            `AND(${ref("impressions")}>=100,${ref("ctr")}<>"",${ref("ctr")}<1,${ref("position")}<=10)`,
            "عنوان و متا را برای بهبود CTR بازبینی کنید",
          ],
        ],
        "نتایج دوره بعد را پایش کنید",
      );
  }
  return undefined;
}

function semanticFill(key: string, value: string | number): string | undefined {
  if (key === "kd")
    return [COLORS.mint, "FFDDF4EF", COLORS.amber, COLORS.orange, COLORS.rose][
      LISTS.kd.indexOf(String(value))
    ];
  if (key === "decision")
    return (
      {
        Keep: COLORS.mint,
        Review: COLORS.amber,
        Exclude: COLORS.paper,
      } as Record<string, string>
    )[value];
  if (key === "intent")
    return (
      {
        اطلاعاتی: COLORS.blue,
        "بررسی تجاری": COLORS.violet,
        تراکنشی: COLORS.mint,
        ناوبری: COLORS.paper,
        ترکیبی: COLORS.orange,
        "نیاز به بررسی": COLORS.amber,
      } as Record<string, string>
    )[value];
  if (key === "priority")
    return (
      {
        P0: COLORS.violet,
        P1: COLORS.mint,
        P2: COLORS.blue,
        P3: COLORS.paper,
        Backlog: COLORS.paper,
      } as Record<string, string>
    )[value];
  if (key === "result")
    return (
      {
        Improving: COLORS.mint,
        Stable: COLORS.blue,
        Dropping: COLORS.rose,
        "Needs Work": COLORS.amber,
        "Not Enough Data": COLORS.paper,
        Complete: COLORS.mint,
      } as Record<string, string>
    )[value];
  return undefined;
}

function writeCollection(
  workbook: ExcelJS.Workbook,
  project: Project,
  settings: Settings,
  collection: Collection,
  validationNames: Map<string, string>,
): void {
  const source = project[collection];
  const fields = flattenSections(
    SCHEMAS[collection],
    settings,
    collection,
    source,
  );
  const sheet = baseSheet(workbook, SHEETS[collection], HEADER_ROW);
  const title = {
    keywords: "پژوهش کلمات",
    pages: "نقشه و سئوی صفحات",
    content: "محتوا و تقویم انتشار",
    results: "نتایج و بهبود",
  }[collection];
  band(
    sheet,
    1,
    2,
    Math.min(8, fields.length),
    `${title} • ${project.name}`,
    COLORS.teal,
  );
  sheet.getRow(1).height = 43;
  band(
    sheet,
    2,
    2,
    Math.min(8, fields.length),
    "فیلتر و مرتب‌سازی از سرستون • سفید: ورودی دستی / آبی: محاسبه • +: بازکردن بخش پیشرفته",
    COLORS.paper,
  );
  sheet.getRow(2).height = 39;
  const tableLength = source.length + BUFFER_ROWS;
  const lastRow = HEADER_ROW + tableLength;
  const capacity = collection === "keywords" ? 20000 : 2000;
  const lastValidationRow = HEADER_ROW + Math.max(capacity, source.length);
  const counts =
    collection === "keywords" ? duplicates(source) : new Map<string, number>();
  const pages = new Map(project.pages.map((page) => [page.id, page]));
  const tableRows = Array.from({ length: tableLength }, (_, index) => {
    const record = source[index];
    return fields.map((field) => {
      if (field.key.startsWith("_gutter_")) return "";
      if (!record) {
        const formula = localFormula(
          collection,
          field.key,
          FIRST_ROW + index,
          fields,
        );
        if (!formula) return "";
        const primary = collection === "pages" ? "target" : "url";
        const col = columnLetter(
          fields.findIndex((candidate) => candidate.key === primary) + 1,
        );
        return {
          formula: `IF(${col}${FIRST_ROW + index}="","",${formula})`,
          result: "",
        };
      }
      if (field.key === "_normalizedKey")
        return normalizeKeyword(String(record.keyword || ""));
      if (field.key === "_duplicateStatus")
        return (counts.get(normalizeKeyword(String(record.keyword || ""))) ??
          0) > 1
          ? "تکراری • بازبینی کنید"
          : "";
      if (field.key === "_pageRef")
        return safeValue(
          collection === "content" ? record.targetPage : record.pageId,
        );
      if (
        (collection === "content" && field.key === "targetPage") ||
        (collection === "results" && field.key === "pageId")
      ) {
        const reference = String(
          collection === "content"
            ? record.targetPage || ""
            : record.pageId || "",
        );
        const page = pages.get(reference);
        return page
          ? `${page.pageId || reference}${collection === "content" ? ` • ${page.target || ""}` : ""}`
          : reference;
      }
      const result = safeValue(fieldValue(record, field.key, settings));
      const formula = localFormula(
        collection,
        field.key,
        FIRST_ROW + index,
        fields,
      );
      return formula ? { formula, result } : result;
    });
  });
  const usedHeaders = new Map<string, number>();
  const columns = fields.map((field) => {
    const count = usedHeaders.get(field.label) ?? 0;
    usedHeaders.set(field.label, count + 1);
    return {
      name: count
        ? `${field.label} • ${field.module} (${count + 1})`
        : field.label,
      filterButton: !field.key.startsWith("_gutter_"),
    };
  });
  sheet.addTable({
    name: `SEO_${collection.toUpperCase()}`,
    ref: `A${HEADER_ROW}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleLight9", showRowStripes: false },
    columns,
    rows: tableRows,
  });
  let moduleStart = 1;
  fields.forEach((field, index) => {
    const col = index + 1;
    const column = sheet.getColumn(col);
    const gutter = field.key.startsWith("_gutter_");
    column.width = gutter
      ? 3.5
      : field.key === "id" || field.key === "_pageRef"
        ? 23
        : field.type === "number"
          ? 17
          : field.type === "date"
            ? 20
            : field.type === "textarea"
              ? 42
              : field.key === "keyword" ||
                  field.key === "target" ||
                  field.key === "topic"
                ? 36
                : field.key === "pageId" || field.key === "contentId"
                  ? 21
                  : 29;
    column.hidden = field.hidden;
    column.outlineLevel = field.hidden && field.key !== "id" ? 1 : 0;
    const header = sheet.getCell(HEADER_ROW, col);
    paint(
      header,
      field.hidden ? COLORS.violet : gutter ? COLORS.paper : COLORS.mint,
      true,
    );
    header.note = noteFor(field, field.module);
    if (field.options) {
      const name = validationNames.get(
        listKey(field.options) || `field_${field.key}`,
      );
      if (name)
        (sheet as SheetWithValidations).dataValidations.add(
          `${columnLetter(col)}${FIRST_ROW}:${columnLetter(col)}${lastValidationRow}`,
          {
            type: "list",
            allowBlank: true,
            formulae: [name],
            showErrorMessage: true,
            errorTitle: "گزینه معتبر انتخاب کنید",
            error:
              "از فهرست این فیلد انتخاب کنید؛ تنظیم فهرست در 99_SETTINGS است.",
            showInputMessage: true,
            promptTitle: field.label,
            prompt:
              field.hint || "از فهرست انتخاب کنید؛ مقدار خالی هم مجاز است.",
          },
        );
    } else if (field.type === "number") {
      (sheet as SheetWithValidations).dataValidations.add(
        `${columnLetter(col)}${FIRST_ROW}:${columnLetter(col)}${lastValidationRow}`,
        {
          type: "decimal",
          operator: "greaterThanOrEqual",
          formulae: [0],
          allowBlank: true,
          showErrorMessage: true,
          errorTitle: "عدد نامعتبر",
          error: "عدد صفر یا بزرگ‌تر وارد کنید؛ صفر با مقدار خالی تفاوت دارد.",
        },
      );
    }
    for (let row = FIRST_ROW; row <= lastRow; row++) {
      const cell = sheet.getCell(row, col);
      const semantic = source[row - FIRST_ROW]
        ? semanticFill(field.key, safeValue(source[row - FIRST_ROW][field.key]))
        : undefined;
      paint(
        cell,
        semantic ||
          (field.calculated
            ? COLORS.blue
            : gutter
              ? COLORS.paper
              : row % 2
                ? COLORS.white
                : COLORS.paper),
      );
      if (field.type === "number") cell.numFmt = "#,##0.##";
      if (
        field.key === "url" ||
        field.type === "url" ||
        field.key === "id" ||
        field.key === "_pageRef"
      )
        cell.alignment = {
          ...cell.alignment,
          readingOrder: "ltr",
          horizontal: "left",
        };
    }
    if (
      field.options &&
      ["kd", "decision", "intent", "priority", "result"].includes(field.key)
    ) {
      const rules = field.options.flatMap((value, priority) => {
        const fill = semanticFill(field.key, value);
        return fill
          ? [
              {
                type: "expression" as const,
                priority: priority + 1,
                formulae: [
                  `$${columnLetter(col)}${FIRST_ROW}="${value.replace(/"/g, '""')}"`,
                ],
                style: {
                  fill: {
                    type: "pattern" as const,
                    pattern: "solid" as const,
                    fgColor: { argb: fill },
                  },
                },
              },
            ]
          : [];
      });
      sheet.addConditionalFormatting({
        ref: `${columnLetter(col)}${FIRST_ROW}:${columnLetter(col)}${lastRow}`,
        rules,
      });
    }
    const next = fields[index + 1];
    if (!next || next.moduleKey !== field.moduleKey) {
      if (gutter) {
        sheet.getCell(3, col).value = "+";
        paint(sheet.getCell(3, col), COLORS.paper, true);
      } else
        band(
          sheet,
          3,
          moduleStart,
          col,
          field.module,
          field.moduleKey === "core" ? COLORS.mint : COLORS.violet,
        );
      moduleStart = col + 1;
    }
  });
  sheet.getRow(3).height = 28;
  sheet.getRow(4).height = 44;
  for (let row = FIRST_ROW; row <= lastRow; row++)
    sheet.getRow(row).height = row < FIRST_ROW + source.length ? 48 : 29;
  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: lastRow, column: fields.length },
  };
  sheet.pageSetup.printTitlesRow = "1:4";
}

/** Six portable sheets, bounded formulas and validations, no macros or external links. */
export async function buildWorkbook(
  project: Project,
  settings: Settings,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Rooyesh SEO Studio";
  workbook.title = `SEO Project • ${project.name}`;
  workbook.subject = "Reusable keyword-to-results SEO workspace";
  workbook.description =
    "Persian RTL workspace with stable identities and optional grouped modules.";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  // Defined lists are available before writing validations, while sheet ordering
  // remains the exact public architecture requested by the user.
  writeStart(workbook, project, settings);
  const names = writeSettings(workbook, settings, project);
  (Object.keys(SHEETS) as Collection[]).forEach((collection) =>
    writeCollection(workbook, project, settings, collection, names),
  );
  // ExcelJS orders worksheet serialization by orderNo. No extra helper sheet.
  [
    "00_START",
    "01_KEYWORDS",
    "02_PAGES",
    "03_CONTENT",
    "04_RESULTS",
    "99_SETTINGS",
  ].forEach((name, index) => {
    const worksheet = workbook.getWorksheet(name)! as ExcelJS.Worksheet & {
      orderNo: number;
    };
    worksheet.orderNo = index;
  });
  return workbook;
}

export async function downloadWorkbook(
  project: Project,
  settings: Settings,
): Promise<void> {
  const workbook = await buildWorkbook(project, settings);
  const bytes = await workbook.xlsx.writeBuffer();
  const copy = new Uint8Array(bytes as unknown as ArrayBuffer);
  const url = URL.createObjectURL(
    new Blob([copy], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name.replace(/[\\/:*?"<>|]/g, "-").slice(0, 100) || "SEO-Project"}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
