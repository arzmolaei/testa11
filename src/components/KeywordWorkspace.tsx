import { useEffect, useMemo, useRef, useState } from "react";
import type { Field, Row, WorkspaceProps } from "../types";
import {
  SCHEMAS,
  LISTS,
  uid,
  normalizeKeyword,
  duplicates,
  nextKeyword,
  parseCsv,
  importMetrics,
} from "../domain";
import {
  Plus,
  Search,
  Download,
  Upload,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Pencil,
  X,
  Check,
  FileSpreadsheet,
  AlertCircle,
  ChevronDown,
  ArrowLeft,
  Trash2,
  Copy,
  ListFilter,
  SlidersHorizontal,
  LoaderCircle,
  CheckCircle2,
} from "lucide-react";
import "./KeywordWorkspace.css";
import { formatJalaliInput, jalaliFileDate } from "../dates";
import { JalaliDateInput } from "./JalaliDateInput";

type ImportKey = "keyword" | "volume" | "kdTool" | "toolIntent" | "source";
type ImportState = {
  matrix: string[][];
  name: string;
  mapping: Partial<Record<ImportKey, string>>;
};
const IMPORT_FIELDS: { key: ImportKey; label: string; hint: string }[] = [
  { key: "keyword", label: "کلمه کلیدی", hint: "ضروری؛ مبنای تطبیق رکوردها" },
  { key: "volume", label: "حجم جستجو", hint: "عدد نامنفی" },
  {
    key: "kdTool",
    label: "سختی عددی ابزار",
    hint: "۰ تا ۱۰۰؛ جدا از ارزیابی دستی",
  },
  {
    key: "toolIntent",
    label: "نیت جستجوی ابزار",
    hint: "ارزیابی دستی نیت تغییر نمی‌کند",
  },
  { key: "source", label: "منبع داده", hint: "نام ابزار یا منبع خروجی" },
];
const DECISION_NAMES: Record<string, string> = {
  Keep: "نگه‌داشتن",
  Review: "بررسی",
  Exclude: "کنارگذاشتن",
};
const CORE_KEYS = [
  "keyword",
  "volume",
  "kd",
  "intent",
  "decision",
  "group",
  "notes",
];
const IMPORT_LIMIT = 20000;
const PAGE_SIZE = 50;
function present(value: Row[string]) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}
function decisionClass(value: Row[string]) {
  return value === "Keep" ? "green" : value === "Review" ? "amber" : "gray";
}
function kdClass(value: Row[string]) {
  return value === "آسان"
    ? "green"
    : value === "آسان تا متوسط"
      ? "green"
      : value === "متوسط"
        ? "amber"
        : value === "متوسط تا سخت"
          ? "amber"
          : value === "سخت"
            ? "rose"
            : "gray";
}
function autoMapping(headers: string[]): ImportState["mapping"] {
  const mapping: ImportState["mapping"] = {};
  const aliases: Record<ImportKey, string[]> = {
    keyword: [
      "keyword",
      "keywords",
      "query",
      "search query",
      "کلمه کلیدی",
      "کلمات کلیدی",
      "عبارت",
      "عبارت جستجو",
    ],
    volume: [
      "volume",
      "search volume",
      "searchvolume",
      "avg monthly searches",
      "حجم جستجو",
      "حجم جست‌وجو",
      "حجم",
      "جستجو",
    ],
    kdTool: [
      "kd",
      "keyword difficulty",
      "difficulty",
      "kd semrush",
      "KD — Semrush / ابزار",
      "سختی عددی",
      "سختی",
    ],
    toolIntent: [
      "intent",
      "search intent",
      "tool intent",
      "نیت",
      "نیت جستجو",
      "نیت جست‌وجو",
      "نیت گزارش‌شده ابزار",
    ],
    source: ["source", "tool", "منبع", "ابزار"],
  };
  for (const field of IMPORT_FIELDS) {
    const schemaLabel = SCHEMAS.keywords
      .flatMap((section) => section.fields)
      .find((f) => f.key === field.key)?.label;
    const exact = schemaLabel
      ? headers.findIndex(
          (h) => normalizeKeyword(h) === normalizeKeyword(schemaLabel),
        )
      : -1;
    const index =
      exact >= 0
        ? exact
        : headers.findIndex((h) =>
            aliases[field.key].some(
              (a) => normalizeKeyword(a) === normalizeKeyword(h),
            ),
          );
    if (index !== -1) mapping[field.key] = String(index);
  }
  return mapping;
}
function parseImportNumber(raw: string) {
  const digits = raw
    .replace(/[۰-۹]/g, (x) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(x)))
    .replace(/[٠-٩]/g, (x) => String("٠١٢٣٤٥٦٧٨٩".indexOf(x)));
  const clean = digits
    .trim()
    .replace(/[,٬\s]/g, "")
    .replace(/٫/g, ".");
  if (!clean || !/^\d+(?:\.\d+)?$/.test(clean)) return undefined;
  const num = Number(clean);
  return Number.isFinite(num) ? num : undefined;
}
function downloadCsv(rows: Row[], customLabels?: Record<string, string>) {
  const fields = SCHEMAS.keywords
    .flatMap((s) => s.fields)
    .filter((f) => !f.calculated);
  const escape = (value: unknown) => {
    let text = String(value ?? "");
    // Prevent exported text from becoming a formula in spreadsheet applications.
    if (/^[\t\r\n ]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv =
    "\uFEFF" +
    [
      fields.map((f) => escape(customLabels?.[f.key] || f.label)).join(","),
      ...rows.map((r) => fields.map((f) => escape(f.type === "date" && r[f.key] ? formatJalaliInput(String(r[f.key])) || "تاریخ نامعتبر" : r[f.key])).join(",")),
    ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `keywords-${jalaliFileDate()}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function KeywordWorkspace({
  project,
  settings,
  onRowsChange,
  notify,
  readOnly = false,
  focusRowId,
  onFocusHandled,
}: WorkspaceProps) {
  const rows = project.keywords;
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState("all");
  const [quality, setQuality] = useState("all");
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({
    key: "",
    desc: false,
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Row | null>(null);
  const [newRow, setNewRow] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const draftBaseline = useRef<Row | null>(null);
  const closeDrawerRef = useRef<() => void>(() => {});
  const [editError, setEditError] = useState("");
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [bulkGroup, setBulkGroup] = useState("");
  const [groupModal, setGroupModal] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [paste, setPaste] = useState("");
  const [importMode, setImportMode] = useState<"fill" | "overwrite">("fill");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importRequest = useRef(0);
  const dupeCounts = useMemo(() => duplicates(rows), [rows]);
  const validSelected = useMemo(
    () => new Set(rows.filter((r) => selected.has(r.id)).map((r) => r.id)),
    [rows, selected],
  );
  const filtered = useMemo(() => {
    const term = normalizeKeyword(query);
    const found = rows.filter((row) => {
      if (
        term &&
        !normalizeKeyword(
          `${row.keyword ?? ""} ${row.group ?? ""} ${row.notes ?? ""}`,
        ).includes(term)
      )
        return false;
      if (decision !== "all" && row.decision !== decision) return false;
      if (
        quality === "duplicates" &&
        (dupeCounts.get(normalizeKeyword(String(row.keyword ?? ""))) ?? 0) < 2
      )
        return false;
      if (
        quality === "missing" &&
        ["volume", "kd", "intent"].every((key) => present(row[key]))
      )
        return false;
      if (quality === "ungrouped" && present(row.group)) return false;
      return true;
    });
    if (sort.key)
      found.sort((a, b) => {
        const av = a[sort.key],
          bv = b[sort.key];
        const comparison =
          sort.key === "volume"
            ? Number(av ?? -1) - Number(bv ?? -1)
            : String(av ?? "").localeCompare(String(bv ?? ""), "fa");
        return sort.desc ? -comparison : comparison;
      });
    return found;
  }, [rows, query, decision, quality, sort, dupeCounts]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const displayed = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const allDisplayedSelected =
    displayed.length > 0 && displayed.every((row) => validSelected.has(row.id));
  const coreFields = SCHEMAS.keywords
    .flatMap((s) => s.fields)
    .filter((f) => CORE_KEYS.includes(f.key));
  const duplicateRows = rows.filter(
    (r) => (dupeCounts.get(normalizeKeyword(String(r.keyword ?? ""))) ?? 0) > 1,
  ).length;
  const updateRows = (updated: Row[]) => {
    if (readOnly) { notify("حساب شما فقط اجازهٔ مشاهده دارد."); return false; }
    try { return onRowsChange("keywords", updated) !== false; }
    catch (error) { notify(error instanceof Error ? error.message : "ذخیرهٔ کلمات انجام نشد؛ پیش‌نویس و انتخاب‌ها حفظ شده‌اند."); return false; }
  };
  const changeFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };
  const toggleSelected = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const selectDisplayed = () =>
    setSelected((old) => {
      const next = new Set(old);
      displayed.forEach((r) =>
        allDisplayedSelected ? next.delete(r.id) : next.add(r.id),
      );
      return next;
    });
  const draftDirty = Boolean(
    draft &&
    draftBaseline.current &&
    [
      ...new Set([
        ...Object.keys(draft),
        ...Object.keys(draftBaseline.current),
      ]),
    ].some(
      (key) =>
        key !== "id" &&
        String(draft[key] ?? "") !== String(draftBaseline.current?.[key] ?? ""),
    ),
  );
  const openRow = (row?: Row) => {
    const initial = row
      ? { ...row }
      : { id: uid(), keyword: "", decision: "Review" };
    draftBaseline.current = { ...initial };
    setDraft(initial);
    setNewRow(!row);
    setEditError("");
    setDiscardOpen(false);
  };
  const finishCloseDrawer = () => {
    draftBaseline.current = null;
    setDraft(null);
    setEditError("");
    setDiscardOpen(false);
  };
  useEffect(() => {
    if (!focusRowId) return;
    const row = rows.find((item) => item.id === focusRowId);
    if (row) { draftBaseline.current = { ...row }; setDraft({ ...row }); setNewRow(false); }
    onFocusHandled?.();
  }, [focusRowId, rows, onFocusHandled]);
  const closeDrawer = () => {
    if (draftDirty) setDiscardOpen(true);
    else finishCloseDrawer();
  };
  closeDrawerRef.current = closeDrawer;
  useEffect(() => {
    if (!draftDirty) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [draftDirty]);
  const saveDraft = () => {
    if (readOnly) return;
    if (!draft || !String(draft.keyword ?? "").trim()) {
      setEditError("کلمه کلیدی را وارد کنید.");
      return;
    }
    for (const field of SCHEMAS.keywords
      .flatMap((section) => section.fields)
      .filter((field) => field.type === "number")) {
      if (!present(draft[field.key])) continue;
      const value = Number(draft[field.key]);
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        (field.key.startsWith("kd") && value > 100)
      ) {
        setEditError(
          `${field.label} باید ${field.key.startsWith("kd") ? "بین ۰ و ۱۰۰" : "یک عدد نامنفی"} باشد.`,
        );
        return;
      }
    }
    if (newRow && rows.length >= IMPORT_LIMIT) {
      setEditError("ظرفیت پروژه ۲۰٬۰۰۰ کلمه کلیدی است.");
      return;
    }
    const clean = { ...draft, keyword: String(draft.keyword).trim() };
    if (!newRow && JSON.stringify(rows.find((row) => row.id === draft.id)) !== JSON.stringify(draftBaseline.current)) {
      setEditError("این کلمه هم‌زمان تغییر کرده است. متن خود را کپی کنید و پنل را دوباره باز کنید.");
      return;
    }
    if (!updateRows(
      newRow
        ? [...rows, clean]
        : rows.map((r) => (r.id === draft.id ? clean : r)),
    )) return;
    finishCloseDrawer();
    notify(newRow ? "کلمه کلیدی اضافه شد." : "تغییرات کلمه کلیدی ذخیره شد.");
  };
  const bulkDecision = (value: string) => {
    if (!updateRows(
      rows.map((r) =>
        validSelected.has(r.id) ? { ...r, decision: value } : r,
      ),
    )) return;
    notify(
      `${validSelected.size.toLocaleString("fa-IR")} کلمه به «${DECISION_NAMES[value]}» تغییر کرد.`,
    );
  };
  const openImport = () => {
    setImportOpen(true);
    setImportState(null);
    setPaste("");
    setImportError("");
    setImportMode("fill");
  };
  const closeImport = () => {
    importRequest.current += 1;
    setImportOpen(false);
    setImportBusy(false);
    setDragging(false);
  };
  const loadMatrix = (matrix: string[][], name: string) => {
    const clean = matrix.filter((row) =>
      row.some((cell) => String(cell).trim()),
    );
    if (clean.length < 2)
      throw new Error("حداقل یک سطر عنوان و یک سطر داده لازم است.");
    if (clean.length - 1 > IMPORT_LIMIT)
      throw new Error("هر بار حداکثر ۲۰٬۰۰۰ ردیف وارد کنید.");
    if (clean[0].length > 200)
      throw new Error("فایل حداکثر می‌تواند ۲۰۰ ستون داشته باشد.");
    setImportState({ matrix: clean, name, mapping: autoMapping(clean[0]) });
    setImportError("");
  };
  const handleFile = async (file?: File) => {
    if (!file) return;
    const requestId = ++importRequest.current;
    setImportBusy(true);
    setImportError("");
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("حجم فایل باید کمتر از ۱۰ مگابایت باشد.");
      let matrix: string[][];
      if (/\.xlsx$/i.test(file.name)) {
        const { default: ExcelJS } = await import("exceljs");
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        const worksheet = workbook.worksheets[0];
        if (!worksheet) throw new Error("فایل اکسل کاربرگ ندارد.");
        if (worksheet.rowCount > IMPORT_LIMIT + 1)
          throw new Error("هر بار حداکثر ۲۰٬۰۰۰ ردیف وارد کنید.");
        matrix = [];
        worksheet.eachRow((row) => {
          const cells: string[] = [];
          for (let i = 1; i <= Math.min(worksheet.columnCount, 201); i += 1) {
            const cell = row.getCell(i);
            const value = cell.value;
            if (value && typeof value === "object" && "richText" in value)
              cells.push(value.richText.map((piece) => piece.text).join(""));
            else if (value && typeof value === "object" && "result" in value)
              cells.push(String(value.result ?? ""));
            else cells.push(cell.text ?? "");
          }
          matrix.push(cells);
        });
      } else if (/\.(csv|tsv|txt)$/i.test(file.name))
        matrix = parseCsv(await file.text());
      else throw new Error("فایل CSV، TSV یا XLSX انتخاب کنید.");
      if (requestId === importRequest.current) loadMatrix(matrix, file.name);
    } catch (error) {
      if (requestId === importRequest.current)
        setImportError(
          error instanceof Error ? error.message : "خواندن فایل ممکن نشد.",
        );
    } finally {
      if (requestId === importRequest.current) setImportBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const importPreview = useMemo(() => {
    if (
      !importState ||
      importState.mapping.keyword === undefined ||
      importState.mapping.keyword === ""
    )
      return null;
    const incoming: Row[] = [];
    let skipped = 0,
      invalidMetrics = 0;
    for (let i = 1; i < importState.matrix.length; i += 1) {
      const cells = importState.matrix[i];
      const keyword = (cells[Number(importState.mapping.keyword)] ?? "").trim();
      if (!normalizeKeyword(keyword)) {
        skipped += 1;
        continue;
      }
      const row: Row = { id: `import-preview-${i}`, keyword };
      for (const field of IMPORT_FIELDS.filter((f) => f.key !== "keyword")) {
        const index = importState.mapping[field.key];
        if (index === undefined || index === "") continue;
        const value = (cells[Number(index)] ?? "").trim();
        if (!value) continue;
        if (field.key === "volume" || field.key === "kdTool") {
          const number = parseImportNumber(value);
          if (
            number === undefined ||
            (field.key === "kdTool" && number > 100)
          ) {
            invalidMetrics += 1;
            continue;
          }
          row[field.key] = number;
        } else row[field.key] = value;
      }
      incoming.push(row);
    }
    try {
      return {
        incoming,
        skipped,
        invalidMetrics,
        result: importMetrics(rows, incoming, importMode),
        error: "",
      };
    } catch (error) {
      return {
        incoming,
        skipped,
        invalidMetrics,
        result: null,
        error:
          error instanceof Error
            ? error.message
            : "پیش‌نمایش ورود داده ساخته نشد.",
      };
    }
  }, [importState, rows, importMode]);
  const applyImport = () => {
    if (!importPreview?.result || !importPreview.incoming.length) return;
    // Generate stable IDs only when the user confirms this preview.
    try {
      const result = importMetrics(
        rows,
        importPreview.incoming.map((row) => ({ ...row, id: uid() })),
        importMode,
      );
      if (!updateRows(result.rows)) return;
      closeImport();
      notify(
        `ورود داده انجام شد: ${result.added.toLocaleString("fa-IR")} کلمه جدید و ${result.matched.toLocaleString("fa-IR")} تطبیق.`,
      );
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "ورود داده انجام نشد.",
      );
    }
  };
  const overlayState = `${Boolean(draft)}:${discardOpen}:${Boolean(deleteIds.length)}:${groupModal}:${importOpen}`;
  useEffect(() => {
    if (!draft && !deleteIds.length && !groupModal && !importOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialogs = document.querySelectorAll<HTMLElement>(
      '.kw-workspace [role="dialog"], .kw-workspace [role="alertdialog"]',
    );
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) return;
    const getFocusables = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
        ),
      ).filter((el) => el.offsetParent !== null);
    const focusables = getFocusables();
    (
      dialog.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ||
      focusables[0]
    )?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (discardOpen) setDiscardOpen(false);
        else if (deleteIds.length) setDeleteIds([]);
        else if (groupModal) setGroupModal(false);
        else if (importOpen) closeImport();
        else closeDrawerRef.current();
      }
      if (event.key === "Tab") {
        const controls = getFocusables();
        const first = controls[0],
          last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousFocus?.focus();
    };
    // Focus is reset when the top dialog changes, not on every edited field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayState]);
  const renderField = (field: Field) => {
    if (!draft) return null;
    const value = draft[field.key] ?? "";
    const fieldId = `kw-${field.key}`;
    const setValue = (raw: string) =>
      setDraft((current) =>
        current
          ? {
              ...current,
              [field.key]:
                field.type === "number" ? (raw === "" ? "" : Number(raw)) : raw,
            }
          : current,
      );
    return (
      <label
        className={`field ${field.type === "textarea" ? "kw-field-wide" : ""}`}
        key={field.key}
        htmlFor={fieldId}
      >
        <span>
          {settings.customLabels?.[field.key] || field.label}
          {field.key === "keyword" && <span className="kw-required"> *</span>}
        </span>
        {field.type === "textarea" ? (
          <textarea
            disabled={readOnly}
            maxLength={100000}
            id={fieldId}
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : field.type === "select" ? (
          <select
            disabled={readOnly}
            id={fieldId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">انتخاب کنید</option>
            {present(value) &&
              (field.key === "targetPage" ? !project.pages.some((page) => page.id === String(value)) : !(field.options ?? []).includes(String(value))) && (
                <option value={value}>{value} (واردشده)</option>
              )}
            {field.key === "targetPage" ? project.pages.map((page) => <option value={page.id} key={page.id}>{String(page.target || page.pkw || page.pageId)}</option>) : (field.options ?? []).map((option) => (
              <option value={option} key={option}>
                {DECISION_NAMES[option] ?? option}
              </option>
            ))}
          </select>
        ) : field.type === "date" ? (
          <JalaliDateInput id={fieldId} disabled={readOnly} value={String(value)} onChange={setValue} aria-label={settings.customLabels?.[field.key] || field.label} />
        ) : (
          <input
            disabled={readOnly}
            id={fieldId}
            data-autofocus={field.key === "keyword" ? true : undefined}
            type={field.type === "url" ? "text" : (field.type ?? "text")}
            min={field.type === "number" ? 0 : undefined}
            max={
              field.key.startsWith("kd") && field.type === "number"
                ? 100
                : undefined
            }
            step={field.type === "number" ? "any" : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            dir={field.type === "url" ? "ltr" : undefined}
          />
        )}
        {field.hint && <small className="muted">{field.hint}</small>}
      </label>
    );
  };

  return (
    <section className="kw-workspace">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">RESEARCH · ۰۱</span>
          <h1>پژوهش کلمات کلیدی</h1>
          <p className="muted">
            فرصت‌های جستجو را پیدا کنید، بررسی کنید و به یک هدف روشن برسانید.
          </p>
        </div>
        <div className="kw-heading-actions">
          <button disabled={readOnly} className="btn btn-secondary" onClick={openImport}>
            <Upload size={17} />
            ورود داده
          </button>
          <button disabled={readOnly} className="btn btn-primary" onClick={() => openRow()}>
            <Plus size={18} />
            کلمه جدید
          </button>
        </div>
      </div>
      <div className="kw-summary">
        <div>
          <span className="kw-summary-icon violet">
            <Search size={18} />
          </span>
          <span>
            <strong>{rows.length.toLocaleString("fa-IR")}</strong>
            <small>کلمه کلیدی</small>
          </span>
        </div>
        <div>
          <span className="kw-summary-icon green">
            <CheckCircle2 size={18} />
          </span>
          <span>
            <strong>
              {rows
                .filter((r) => r.decision === "Keep")
                .length.toLocaleString("fa-IR")}
            </strong>
            <small>انتخاب‌شده برای ادامه</small>
          </span>
        </div>
        <div>
          <span className="kw-summary-icon blue">
            <Copy size={18} />
          </span>
          <span>
            <strong>
              {new Set(
                rows.map((r) => String(r.group ?? "").trim()).filter(Boolean),
              ).size.toLocaleString("fa-IR")}
            </strong>
            <small>گروه هدف</small>
          </span>
        </div>
        <button
          className="kw-summary-warning"
          onClick={() => changeFilter(setQuality, "duplicates")}
        >
          <span className="kw-summary-icon amber">
            <AlertCircle size={18} />
          </span>
          <span>
            <strong>{duplicateRows.toLocaleString("fa-IR")}</strong>
            <small>ردیف با تکرار فنی</small>
          </span>
        </button>
      </div>
      <div className="table-card">
        <div className="toolbar kw-toolbar">
          <div className="search-input kw-search">
            <Search size={17} />
            <input
              aria-label="جستجوی کلمات کلیدی"
              placeholder="جستجوی کلمه، گروه یا یادداشت…"
              value={query}
              onChange={(e) => changeFilter(setQuery, e.target.value)}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="پاک کردن جستجو"
                onClick={() => changeFilter(setQuery, "")}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="kw-filters">
            <ListFilter size={16} className="muted" />
            <select
              aria-label="فیلتر تصمیم"
              value={decision}
              onChange={(e) => changeFilter(setDecision, e.target.value)}
            >
              <option value="all">همه تصمیم‌ها</option>
              {LISTS.decision.map((value) => (
                <option key={value} value={value}>
                  {DECISION_NAMES[value] ?? value}
                </option>
              ))}
            </select>
            <select
              aria-label="فیلتر کیفیت داده"
              value={quality}
              onChange={(e) => changeFilter(setQuality, e.target.value)}
            >
              <option value="all">همه کلمات</option>
              <option value="duplicates">تکرارهای فنی</option>
              <option value="missing">اطلاعات ناقص</option>
              <option value="ungrouped">بدون گروه</option>
            </select>
          </div>
          <button
            className="btn btn-ghost kw-export"
            onClick={() => {
              const exportRows = validSelected.size
                ? rows.filter((r) => validSelected.has(r.id))
                : filtered;
              downloadCsv(exportRows, settings.customLabels);
              notify(
                `${exportRows.length.toLocaleString("fa-IR")} ردیف خروجی گرفته شد.`,
              );
            }}
            disabled={!filtered.length && !validSelected.size}
          >
            <Download size={16} />
            {validSelected.size ? "خروجی انتخاب‌ها" : "خروجی CSV"}
          </button>
        </div>
        {validSelected.size > 0 && (
          <div className="kw-selection">
            <span>
              <strong>{validSelected.size.toLocaleString("fa-IR")}</strong> کلمه
              انتخاب شده
            </span>
            <div>
              {filtered.some((row) => !validSelected.has(row.id)) && <button onClick={() => setSelected(new Set(filtered.map((row) => row.id)))}>انتخاب همهٔ {filtered.length.toLocaleString("fa-IR")} نتیجه</button>}
              <button disabled={readOnly} onClick={() => bulkDecision("Keep")}>
                <Check size={15} />
                نگه‌داشتن
              </button>
              <button disabled={readOnly} onClick={() => bulkDecision("Review")}>بررسی</button>
              <button disabled={readOnly} onClick={() => bulkDecision("Exclude")}>
                کنارگذاشتن
              </button>
              <button
                disabled={readOnly}
                onClick={() => {
                  setBulkGroup("");
                  setGroupModal(true);
                }}
              >
                تعیین گروه
              </button>
              <button
                disabled={readOnly}
                className="kw-danger-text"
                onClick={() => setDeleteIds([...validSelected])}
              >
                <Trash2 size={14} />
                حذف
              </button>
            </div>
            <button
              className="icon-button"
              aria-label="لغو انتخاب‌ها"
              onClick={() => setSelected(new Set())}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="kw-table-scroll">
          <table className="data-table kw-table">
            <thead>
              <tr>
                <th className="kw-checkbox-cell">
                  <input
                    type="checkbox"
                    checked={allDisplayedSelected}
                    onChange={selectDisplayed}
                    aria-label="انتخاب ردیف‌های این صفحه"
                  />
                </th>
                {coreFields.map((field) => (
                  <th key={field.key} className={`kw-col-${field.key}`}>
                    <button
                      className="kw-sort"
                      onClick={() =>
                        setSort((s) => ({
                          key: field.key,
                          desc: s.key === field.key ? !s.desc : false,
                        }))
                      }
                    >
                      {field.label}
                      <ChevronsUpDown
                        size={12}
                        className={
                          sort.key === field.key ? "kw-sort-active" : ""
                        }
                      />
                    </button>
                  </th>
                ))}
                <th className="kw-next-col">قدم بعدی</th>
                <th>
                  <span className="kw-sr-only">ویرایش</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((row) => {
                const duplicate =
                  (dupeCounts.get(
                    normalizeKeyword(String(row.keyword ?? "")),
                  ) ?? 0) > 1;
                return (
                  <tr
                    key={row.id}
                    className={
                      validSelected.has(row.id) ? "kw-row-selected" : ""
                    }
                  >
                    <td className="kw-checkbox-cell">
                      <input
                        type="checkbox"
                        checked={validSelected.has(row.id)}
                        onChange={() => toggleSelected(row.id)}
                        aria-label={`انتخاب ${row.keyword}`}
                      />
                    </td>
                    {coreFields.map((field) => (
                      <td key={field.key} className={`kw-col-${field.key}`}>
                        {field.key === "keyword" ? (
                          <button
                            className="kw-keyword-button"
                            onClick={() => openRow(row)}
                          >
                            <span>{row.keyword || "بدون عنوان"}</span>
                            {duplicate && (
                              <span
                                className="kw-duplicate"
                                title="تکرار فنی؛ هیچ داده‌ای خودکار حذف نمی‌شود"
                              >
                                <Copy size={11} />
                                تکراری
                              </span>
                            )}
                          </button>
                        ) : field.key === "volume" ? (
                          <span className="kw-number">
                            {present(row.volume) ? (
                              Number(row.volume).toLocaleString("fa-IR")
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </span>
                        ) : field.key === "decision" ? (
                          <span
                            className={`badge ${decisionClass(row.decision)}`}
                          >
                            {DECISION_NAMES[String(row.decision)] ??
                              row.decision ??
                              "—"}
                          </span>
                        ) : field.key === "kd" ? (
                          <span className={`badge ${kdClass(row.kd)}`}>
                            {row.kd || "—"}
                          </span>
                        ) : field.key === "intent" ? (
                          <span
                            className={`badge ${present(row.intent) ? "violet" : "gray"}`}
                          >
                            {String(row.intent ?? "").split(" — ")[0] || "—"}
                          </span>
                        ) : field.key === "group" ? (
                          present(row.group) ? (
                            <span className="kw-group-tag">{row.group}</span>
                          ) : (
                            <span className="muted">—</span>
                          )
                        ) : (
                          <span
                            className="kw-note"
                            title={String(row.notes ?? "")}
                          >
                            {row.notes || "—"}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="kw-next-col">
                      <button
                        className="kw-next-action"
                        onClick={() => openRow(row)}
                      >
                        {nextKeyword(row)}
                        <ArrowLeft size={13} />
                      </button>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`ویرایش ${row.keyword}`}
                        onClick={() => openRow(row)}
                      >
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <div className="empty-state kw-empty">
            <div className="kw-empty-icon">
              <Search size={28} />
            </div>
            <h3>
              {rows.length
                ? "کلمه‌ای با این فیلتر پیدا نشد"
                : "اولین فرصت جستجو را ثبت کنید"}
            </h3>
            <p className="muted">
              {rows.length
                ? "جستجو یا فیلترها را تغییر دهید."
                : "کلمات را دستی اضافه کنید یا خروجی ابزار پژوهش خود را وارد کنید."}
            </p>
            <button
              className="btn btn-secondary"
              onClick={() =>
                rows.length
                  ? (setQuery(""), setDecision("all"), setQuality("all"))
                  : openImport()
              }
            >
              {rows.length ? "پاک کردن فیلترها" : "ورود فایل کلمات کلیدی"}
            </button>
          </div>
        )}
        <div className="pagination kw-pagination">
          <span className="muted">
            {filtered.length
              ? `${((currentPage - 1) * PAGE_SIZE + 1).toLocaleString("fa-IR")} تا ${Math.min(currentPage * PAGE_SIZE, filtered.length).toLocaleString("fa-IR")} از ${filtered.length.toLocaleString("fa-IR")} کلمه`
              : "۰ کلمه"}
            {filtered.length !== rows.length &&
              ` · مجموع ${rows.length.toLocaleString("fa-IR")}`}
          </span>
          <div>
            <button
              className="icon-button"
              aria-label="صفحه قبلی"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronRight size={17} />
            </button>
            <span>
              صفحه {currentPage.toLocaleString("fa-IR")} از{" "}
              {pages.toLocaleString("fa-IR")}
            </span>
            <button
              className="icon-button"
              aria-label="صفحه بعدی"
              disabled={currentPage === pages}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronLeft size={17} />
            </button>
          </div>
        </div>
      </div>
      <p className="kw-footnote">
        <SlidersHorizontal size={14} />
        فیلدهای پیشرفته در پنل هر کلمه آماده‌اند. تکرارها فقط علامت می‌خورند؛
        تصمیم با شماست.
      </p>

      {draft && (
        <div className="drawer-backdrop" onClick={closeDrawer}>
          <aside
            className="drawer kw-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={newRow ? "کلمه کلیدی جدید" : "جزئیات کلمه کلیدی"}
            aria-labelledby="keyword-drawer-title"
            data-dirty={draftDirty ? "true" : "false"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <div>
                <span className="eyebrow">KEYWORD DETAILS</span>
                <h2 id="keyword-drawer-title">
                  {newRow ? "کلمه کلیدی جدید" : "جزئیات کلمه کلیدی"}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="بستن ویرایش"
                onClick={closeDrawer}
              >
                <X size={20} />
              </button>
            </div>
            <div className="drawer-body">
              <div className="kw-drawer-next">
                <span>قدم بعدی</span>
                <strong>{nextKeyword(draft)}</strong>
              </div>
              {!newRow &&
                (dupeCounts.get(
                  normalizeKeyword(String(draft.keyword ?? "")),
                ) ?? 0) > 1 && (
                  <div className="kw-notice amber">
                    <Copy size={17} />
                    این عبارت تکرار فنی دارد. پیش از حذف، یادداشت‌ها و داده‌ها
                    را بررسی کنید.
                  </div>
                )}
              <div className="form-grid">{coreFields.map(renderField)}{SCHEMAS.keywords.flatMap((section) => section.fields).filter((field) => field.key === "targetPage").map(renderField)}</div>
              {SCHEMAS.keywords
                .filter((s) => s.key !== "core")
                .map((section) => (
                  <details className="section-accordion" key={section.key}>
                    <summary>
                      <span>{section.label}</span>
                      <ChevronDown size={16} />
                    </summary>
                    <div className="form-grid">
                      {section.fields
                        .filter((f) => !f.calculated)
                        .map(renderField)}
                    </div>
                  </details>
                ))}
              {editError && (
                <p className="kw-error" role="alert">
                  <AlertCircle size={16} />
                  {editError}
                </p>
              )}
            </div>
            <div className="drawer-footer">
              <button disabled={readOnly} className="btn btn-primary" onClick={saveDraft}>
                <Check size={17} />
                ذخیره تغییرات
              </button>
              <button className="btn btn-secondary" onClick={closeDrawer}>
                انصراف
              </button>
              {!newRow && (
                <button
                  disabled={readOnly}
                  className="btn btn-ghost kw-delete-row"
                  onClick={() => setDeleteIds([draft.id])}
                >
                  <Trash2 size={16} />
                  حذف
                </button>
              )}
            </div>
          </aside>
        </div>
      )}

      {discardOpen && (
        <div
          className="modal-backdrop kw-discard-backdrop"
          onClick={() => setDiscardOpen(false)}
        >
          <div
            className="modal kw-small-modal"
            role="alertdialog"
            aria-modal="true"
            aria-label="تغییرات ذخیره‌نشده"
            aria-labelledby="keyword-discard-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="kw-discard-icon">
              <AlertCircle size={25} />
            </div>
            <h2 id="keyword-discard-title">تغییرات شما هنوز ذخیره نشده</h2>
            <p className="muted">
              برای حفظ تغییرات به ویرایش برگردید و «ذخیره تغییرات» را بزنید، یا
              از این تغییرات صرف‌نظر کنید.
            </p>
            <div className="kw-modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setDiscardOpen(false)}
              >
                ادامه ویرایش
              </button>
              <button className="btn btn-danger" onClick={finishCloseDrawer}>
                صرف‌نظر از تغییرات
              </button>
            </div>
          </div>
        </div>
      )}

      {!!deleteIds.length && (
        <div className="modal-backdrop" onClick={() => setDeleteIds([])}>
          <div
            className="modal kw-small-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-keywords-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="kw-confirm-icon">
              <Trash2 size={24} />
            </div>
            <h2 id="delete-keywords-title">
              حذف {deleteIds.length.toLocaleString("fa-IR")} کلمه کلیدی؟
            </h2>
            <p className="muted">
              این کار کلمات و اطلاعات همراه آن‌ها را حذف می‌کند. برای حذف از
              مسیر پژوهش، می‌توانید تصمیم «کنارگذاشتن» را انتخاب کنید.
            </p>
            <div className="kw-modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setDeleteIds([])}
              >
                انصراف
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  const ids = new Set(deleteIds);
                  if (!updateRows(rows.filter((r) => !ids.has(r.id)))) return;
                  setSelected(
                    (old) => new Set([...old].filter((id) => !ids.has(id))),
                  );
                  if (draft && ids.has(draft.id)) finishCloseDrawer();
                  setDeleteIds([]);
                  notify("کلمات انتخاب‌شده حذف شدند.");
                }}
              >
                حذف قطعی
              </button>
            </div>
          </div>
        </div>
      )}

      {groupModal && (
        <div className="modal-backdrop" onClick={() => setGroupModal(false)}>
          <div
            className="modal kw-small-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-group-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="bulk-group-title">
              گروه مشترک برای {validSelected.size.toLocaleString("fa-IR")} کلمه
            </h2>
            <p className="muted">
              این گروه فقط به کلمات انتخاب‌شده اعمال می‌شود.
            </p>
            <label className="field">
              <span>گروه / هدف</span>
              <input
                autoFocus
                placeholder="مثلاً دوربین داهوا"
                value={bulkGroup}
                onChange={(e) => setBulkGroup(e.target.value)}
              />
            </label>
            <div className="kw-modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setGroupModal(false)}
              >
                انصراف
              </button>
              <button
                className="btn btn-primary"
                disabled={!bulkGroup.trim()}
                onClick={() => {
                  if (!updateRows(
                    rows.map((r) =>
                      validSelected.has(r.id)
                        ? { ...r, group: bulkGroup.trim() }
                        : r,
                    ),
                  )) return;
                  setGroupModal(false);
                  notify("گروه کلمات انتخاب‌شده ذخیره شد.");
                }}
              >
                اعمال گروه
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div
          className="modal-backdrop kw-import-backdrop"
          onClick={closeImport}
        >
          <div
            className="modal kw-import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyword-import-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="kw-import-header">
              <div>
                <span className="eyebrow">SMART IMPORT</span>
                <h2 id="keyword-import-title">ورود امن کلمات کلیدی</h2>
                <p className="muted">
                  تطبیق بر اساس متن نرمال‌شده؛ ترتیب ردیف‌های فایل اهمیتی ندارد.
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="بستن ورود داده"
                onClick={closeImport}
              >
                <X size={20} />
              </button>
            </div>
            <div className="kw-import-body">
              <div className="kw-import-steps">
                <span className={!importState ? "active" : ""}>
                  <b>۱</b>فایل یا متن
                </span>
                <span className={importState ? "active" : ""}>
                  <b>۲</b>تطبیق و پیش‌نمایش
                </span>
                <span>
                  <b>۳</b>تأیید ورود
                </span>
              </div>
              {!importState ? (
                <>
                  <div
                    className={`kw-dropzone ${dragging ? "dragging" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      void handleFile(e.dataTransfer.files[0]);
                    }}
                  >
                    <div className="kw-file-icon">
                      {importBusy ? (
                        <LoaderCircle size={26} className="kw-spin" />
                      ) : (
                        <FileSpreadsheet size={26} />
                      )}
                    </div>
                    <h3>
                      {importBusy
                        ? "در حال خواندن فایل…"
                        : "فایل را اینجا رها کنید"}
                    </h3>
                    <p>CSV، TSV یا XLSX · حداکثر ۱۰ مگابایت</p>
                    <button
                      className="btn btn-secondary"
                      disabled={importBusy}
                      onClick={() => fileInput.current?.click()}
                    >
                      انتخاب فایل
                    </button>
                    <input
                      ref={fileInput}
                      className="kw-hidden"
                      type="file"
                      accept=".csv,.tsv,.xlsx,.txt"
                      onChange={(e) => void handleFile(e.target.files?.[0])}
                    />
                  </div>
                  <div className="kw-paste-area">
                    <label className="field">
                      <span>یا داده‌ها را از اکسل / ابزار اینجا بچسبانید</span>
                      <textarea
                        rows={5}
                        value={paste}
                        onChange={(e) => setPaste(e.target.value)}
                        placeholder={
                          "keyword\tvolume\tkd\nدوربین مداربسته\t12000\t35"
                        }
                        dir="auto"
                      />
                      <small className="muted">
                        ردیف اول باید عنوان ستون‌ها باشد. کاما و تب پشتیبانی
                        می‌شوند.
                      </small>
                    </label>
                    <button
                      className="btn btn-secondary"
                      disabled={!paste.trim() || importBusy}
                      onClick={() => {
                        try {
                          loadMatrix(parseCsv(paste), "داده‌های چسبانده‌شده");
                        } catch (error) {
                          setImportError(
                            error instanceof Error
                              ? error.message
                              : "داده‌ها قابل خواندن نیستند.",
                          );
                        }
                      }}
                    >
                      ساخت پیش‌نمایش
                      <ArrowLeft size={16} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="kw-loaded-file">
                    <FileSpreadsheet size={18} />
                    <strong>{importState.name}</strong>
                    <span className="muted">
                      {(importState.matrix.length - 1).toLocaleString("fa-IR")}{" "}
                      ردیف
                    </span>
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setImportState(null);
                        setImportError("");
                      }}
                    >
                      تغییر فایل
                    </button>
                  </div>
                  <div className="kw-notice blue">
                    <CheckCircle2 size={18} />
                    <span>
                      حجم جستجو و سختی عددی ابزار وارد می‌شوند. سختی دستی، نیت
                      دستی، تصمیم، گروه و یادداشت‌های شما حفظ می‌شوند.
                    </span>
                  </div>
                  <h3 className="kw-import-section-title">
                    ستون‌های فایل را تطبیق دهید
                  </h3>
                  <div className="kw-mapping-grid">
                    {IMPORT_FIELDS.map((field) => (
                      <label className="field" key={field.key}>
                        <span>
                          {settings.customLabels?.[field.key] || field.label}
                          {field.key === "keyword" && (
                            <span className="kw-required"> *</span>
                          )}
                        </span>
                        <select
                          value={importState.mapping[field.key] ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setImportState((current) =>
                              current
                                ? {
                                    ...current,
                                    mapping: {
                                      ...current.mapping,
                                      [field.key]: value,
                                    },
                                  }
                                : current,
                            );
                          }}
                        >
                          <option value="">
                            {field.key === "keyword"
                              ? "ستون کلمه را انتخاب کنید"
                              : "وارد نشود"}
                          </option>
                          {importState.matrix[0].map((header, i) => (
                            <option
                              key={i}
                              value={i}
                              disabled={IMPORT_FIELDS.some(
                                (other) =>
                                  other.key !== field.key &&
                                  importState.mapping[other.key] === String(i),
                              )}
                            >
                              {header || `ستون ${i + 1}`} · {i + 1}
                            </option>
                          ))}
                        </select>
                        <small className="muted">{field.hint}</small>
                      </label>
                    ))}
                  </div>
                  <div className="kw-import-mode">
                    <label>
                      <input
                        type="radio"
                        name="import-mode"
                        checked={importMode === "fill"}
                        onChange={() => setImportMode("fill")}
                      />
                      <span>
                        <strong>فقط خانه‌های خالی را کامل کن</strong>
                        <small>
                          حالت پیشنهادی؛ داده‌های موجود تغییر نمی‌کنند.
                        </small>
                      </span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="import-mode"
                        checked={importMode === "overwrite"}
                        onChange={() => setImportMode("overwrite")}
                      />
                      <span>
                        <strong>معیارهای ابزار را به‌روزرسانی کن</strong>
                        <small>
                          فقط معیارهای واردشده جایگزین می‌شوند؛ ارزیابی دستی حفظ
                          می‌شود.
                        </small>
                      </span>
                    </label>
                  </div>
                  {importPreview?.result ? (
                    <>
                      <div className="kw-preview-stats">
                        <div>
                          <strong>
                            {importPreview.result.added.toLocaleString("fa-IR")}
                          </strong>
                          <span>کلمه جدید</span>
                        </div>
                        <div>
                          <strong>
                            {importPreview.result.matched.toLocaleString(
                              "fa-IR",
                            )}
                          </strong>
                          <span>تطبیق با رکورد موجود</span>
                        </div>
                        <div>
                          <strong>
                            {importPreview.result.duplicates.toLocaleString(
                              "fa-IR",
                            )}
                          </strong>
                          <span>تکرار در فایل ورودی</span>
                        </div>
                        <div>
                          <strong>
                            {importPreview.result.conflicts.toLocaleString(
                              "fa-IR",
                            )}
                          </strong>
                          <span>تعارض معیارها</span>
                        </div>
                      </div>
                      {(importPreview.invalidMetrics > 0 ||
                        importPreview.skipped > 0) && (
                        <div className="kw-notice amber">
                          <AlertCircle size={17} />
                          <span>
                            {importPreview.skipped > 0 &&
                              `${importPreview.skipped.toLocaleString("fa-IR")} ردیف بدون کلمه نادیده گرفته می‌شود. `}
                            {importPreview.invalidMetrics > 0 &&
                              `${importPreview.invalidMetrics.toLocaleString("fa-IR")} مقدار عددی نامعتبر وارد نمی‌شود.`}
                          </span>
                        </div>
                      )}
                      {importPreview.result.duplicates > 0 && (
                        <p className="kw-import-help">
                          کلمات جدید تکراری حفظ و علامت‌گذاری می‌شوند. تطبیق
                          مبهم با رکوردهای موجود اعمال نمی‌شود.
                        </p>
                      )}
                      {importPreview.result.conflicts > 0 && (
                        <p className="kw-import-help">
                          تعارض معیارها در حالت «تکمیل خانه‌های خالی» داده قبلی
                          را حفظ می‌کند. اگر یک کلمه چند تطبیق داشته باشد،
                          معیارهای آن وارد نمی‌شوند؛ فیلتر تکرارها به بررسی کمک
                          می‌کند.
                        </p>
                      )}
                      <h3 className="kw-import-section-title">
                        پیش‌نمایش ۵ ردیف اول فایل
                      </h3>
                      <p className="kw-import-help">
                        مقادیر زیر از فایل ورودی هستند. در حالت تکمیل خانه‌های
                        خالی، مقادیر قبلی حفظ می‌شوند.
                      </p>
                      <div className="kw-preview-table">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>کلمه کلیدی</th>
                              <th>حجم جستجو</th>
                              <th>سختی ابزار</th>
                              <th>وضعیت</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importPreview.incoming.slice(0, 5).map((row) => (
                              <tr key={row.id}>
                                <td>{row.keyword}</td>
                                <td>
                                  {present(row.volume)
                                    ? Number(row.volume).toLocaleString("fa-IR")
                                    : "—"}
                                </td>
                                <td>
                                  {present(row.kdTool)
                                    ? Number(row.kdTool).toLocaleString("fa-IR")
                                    : "—"}
                                </td>
                                <td>
                                  <span
                                    className={`badge ${rows.some((existing) => normalizeKeyword(String(existing.keyword)) === normalizeKeyword(String(row.keyword))) ? "blue" : "green"}`}
                                  >
                                    {rows.some(
                                      (existing) =>
                                        normalizeKeyword(
                                          String(existing.keyword),
                                        ) ===
                                        normalizeKeyword(String(row.keyword)),
                                    )
                                      ? "تطبیق با موجود"
                                      : "جدید"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="kw-notice amber">
                      <AlertCircle size={17} />
                      {importPreview?.error ||
                        "برای دیدن پیش‌نمایش، ستون کلمه کلیدی را انتخاب کنید."}
                    </div>
                  )}
                </>
              )}
              {importError && (
                <p className="kw-error" role="alert">
                  <AlertCircle size={17} />
                  {importError}
                </p>
              )}
            </div>
            <div className="kw-import-footer">
              <span className="muted">
                تا تأیید شما هیچ داده‌ای ذخیره نمی‌شود.
              </span>
              <button className="btn btn-secondary" onClick={closeImport}>
                انصراف
              </button>
              {importState && (
                <button
                  className="btn btn-primary"
                  disabled={
                    !importPreview?.incoming.length ||
                    !importPreview?.result ||
                    importBusy
                  }
                  onClick={applyImport}
                >
                  <Check size={17} />
                  تأیید و ورود داده
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
