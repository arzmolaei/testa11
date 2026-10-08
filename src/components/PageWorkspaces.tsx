import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Layers3,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  SCHEMAS,
  LISTS,
  uid,
  nextPage,
  nextResult,
  fieldValue,
  normalizeKeyword,
  resultLookup,
} from "../domain";
import type { Field, Row, WorkspaceProps } from "../types";
import { formatDate, getJalaliParts, JALALI_MONTHS, JALALI_WEEKDAYS, jalaliMonthGrid, todayIso, toIsoDate } from "../dates";
import { JalaliDateInput } from "./JalaliDateInput";
import { buildBrief } from "../workflow";
import { useRowDraft } from "../row-draft";
import { RowDraftRecovery } from "./RowDraftRecovery";
import "./page-workspaces.css";

type WorkspaceKind = "pages" | "content" | "results";
type Column = { key: string; label: string; render?: (row: Row) => ReactNode };
const PAGE_SIZE = 50;
const ROW_LIMIT = 2000;
const fa = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
const collator = new Intl.Collator("fa", {
  numeric: true,
  sensitivity: "base",
});
const labels: Record<string, string> = {
  "Not Started": "شروع نشده",
  Mapping: "هدف‌گذاری",
  "SERP Review": "بررسی نتایج جستجو",
  Ready: "آماده",
  "In Progress": "در حال انجام",
  Review: "نیاز به بازبینی",
  Published: "منتشر شده",
  Monitoring: "در حال پایش",
  Complete: "تکمیل شده",
  Existing: "صفحه موجود",
  New: "صفحه جدید",
  Unknown: "نامشخص",
  "Optimize Existing": "بهینه‌سازی صفحه",
  "Create New": "ساخت صفحه",
  "Merge / Consolidate": "ادغام صفحات",
  "No Dedicated Page": "بدون صفحه مستقل",
  "Needs Review": "نیاز به بررسی",
  Backlog: "بعداً",
  Research: "تحقیق",
  "Brief Ready": "بریف آماده",
  Writing: "در حال نگارش",
  Editing: "ویراستاری",
  Optimizing: "بهینه‌سازی",
  Blog: "مقاله",
  "Buying Guide": "راهنمای خرید",
  Comparison: "مقایسه",
  PDP: "صفحه محصول",
  PLP: "دسته‌بندی محصول",
  "Landing Page": "لندینگ",
  Service: "خدمات",
  FAQ: "پرسش‌های متداول",
  Other: "سایر",
  Improving: "رو به رشد",
  Declining: "افت عملکرد",
  Dropping: "افت عملکرد",
  Stable: "پایدار",
  "No Data": "بدون داده",
  "Not Enough Data": "داده ناکافی",
  "Too Early": "هنوز زود است",
  "Needs Improvement": "نیاز به بهبود",
  "Needs Work": "نیاز به اصلاح",
  Yes: "بله",
  No: "خیر",
  Pending: "در انتظار",
  Done: "انجام شده",
  Checked: "بررسی شده",
  "Not Checked": "بررسی نشده",
  "In Review": "در حال بررسی",
  Passed: "تأیید شده",
  Pass: "تأیید شده",
  Failed: "نیاز به اصلاح",
  "Not Applicable": "کاربرد ندارد",
  "Same Page": "یک صفحه مشترک",
  "Separate Page": "صفحات مجزا",
  Low: "کم",
  Medium: "متوسط",
  High: "زیاد",
};
const text = (value: unknown) => (value == null ? "" : String(value));
const translate = (value: unknown) => labels[text(value)] || text(value);
const normalized = (value: unknown) =>
  text(value)
    .trim()
    .toLocaleLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200d]/g, " ")
    .replace(/\s+/g, " ");
const present = (value: unknown) =>
  value !== undefined && value !== null && value !== "";
const rowFingerprint = (row: Row) =>
  JSON.stringify(
    Object.entries(row)
      .filter(([, value]) => present(value))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
const numberText = (value: unknown) =>
  present(value) && Number.isFinite(Number(value))
    ? fa.format(Number(value))
    : "—";
function badgeTone(value: unknown) {
  const v = text(value);
  if (
    [
      "Complete",
      "Published",
      "Improving",
      "Ready",
      "Done",
      "Passed",
      "Pass",
      "Yes",
      "تکمیل شده",
      "منتشر شده",
    ].includes(v)
  )
    return "green";
  if (["Declining", "Dropping", "Failed", "P0", "No", "افت عملکرد"].includes(v))
    return "rose";
  if (
    [
      "Needs Review",
      "Review",
      "SERP Review",
      "P1",
      "Editing",
      "Needs Improvement",
      "Needs Work",
      "نیاز به بررسی",
    ].includes(v)
  )
    return "amber";
  if (
    [
      "In Progress",
      "Writing",
      "Research",
      "Monitoring",
      "P2",
      "Mapping",
      "Optimizing",
    ].includes(v)
  )
    return "blue";
  if (["New", "Brief Ready", "P3"].includes(v)) return "violet";
  return "gray";
}
function Chip({ value }: { value: unknown }) {
  return present(value) ? (
    <span className={`badge ${badgeTone(value)}`}>{translate(value)}</span>
  ) : (
    <span className="muted">—</span>
  );
}
function dateText(value: unknown) {
  return value ? formatDate(value) : "بدون تاریخ";
}
function nextContent(row: Row, linkedPage?: Row) {
  if (!row.targetPage || !linkedPage) return "صفحه هدف را مشخص کنید";
  if (!row.topic) return "موضوع محتوا را بنویسید";
  if (!row.pkw && !linkedPage.pkw) return "کلمه کلیدی اصلی را انتخاب کنید";
  if (!row.contentType) return "نوع محتوا را انتخاب کنید";
  if (["Published", "Complete", "Optimizing"].includes(text(row.writingStatus)))
    return "عملکرد محتوا را بررسی کنید";
  if (
    !row.briefStatus ||
    ["Not Started", "Research", "Review", "Needs Review"].includes(
      text(row.briefStatus),
    )
  )
    return row.briefStatus === "Review"
      ? "بریف محتوا را بازبینی کنید"
      : "بریف محتوا را آماده کنید";
  if (
    !row.writingStatus ||
    ["Not Started", "Research", "Brief Ready"].includes(text(row.writingStatus))
  )
    return "نگارش محتوا را شروع کنید";
  if (row.writingStatus === "Writing") return "نگارش را کامل کنید";
  if (["Editing", "Review"].includes(text(row.writingStatus)))
    return "محتوا را بازبینی کنید";
  return row.publishDate
    ? "محتوا را در تاریخ تعیین‌شده منتشر کنید"
    : "تاریخ انتشار را مشخص کنید";
}
function nextCode(rows: Row[], key: string, prefix: string) {
  let n = rows.length + 1;
  while (
    rows.some((row) => row[key] === `${prefix}-${String(n).padStart(3, "0")}`)
  )
    n++;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}
function initialRow(kind: WorkspaceKind, rows: Row[]): Row {
  const id = uid();
  if (kind === "pages")
    return {
      id,
      pageId: nextCode(rows, "pageId", "P"),
      target: "",
      status: "Not Started",
      priority: "P2",
      existing: "Unknown",
    };
  if (kind === "content")
    return {
      id,
      contentId: nextCode(rows, "contentId", "C"),
      topic: "",
      briefStatus: "Not Started",
      writingStatus: "Not Started",
    };
  return { id, pageId: "", result: "Not Enough Data" };
}
const config = {
  pages: {
    title: "نقشه صفحات",
    eyebrow: "۰۲ / هدف‌گذاری و اجرا",
    description:
      "هر صفحه، یک هدف روشن. از انتخاب کلمه کلیدی تا انتشار، قدم بعدی را ببینید.",
    singular: "صفحه",
    button: "صفحه جدید",
    search: "جستجو در صفحات، کلمات و آدرس‌ها…",
    filter: "status",
    statusList: "pageStatus",
    emptyTitle: "اولین صفحه را هدف‌گذاری کنید",
    emptyText:
      "یک صفحه موجود یا جدید اضافه کنید، کلمه کلیدی اصلی آن را انتخاب کنید و قدم‌به‌قدم پیش بروید.",
  },
  content: {
    title: "برنامه محتوا",
    eyebrow: "۰۳ / برنامه‌ریزی و تولید",
    description:
      "محتوای مورد نیاز صفحات را برنامه‌ریزی کنید و مسیر تولید را تا انتشار دنبال کنید.",
    singular: "محتوا",
    button: "محتوای جدید",
    search: "جستجو در موضوع، صفحه هدف و مسئول…",
    filter: "writingStatus",
    statusList: "contentStatus",
    emptyTitle: "برای محتوای بعدی برنامه بریزید",
    emptyText:
      "یک مقاله، راهنمای خرید یا محتوای صفحه اضافه کنید و آن را به صفحه هدف متصل کنید.",
  },
  results: {
    title: "نتایج و عملکرد",
    eyebrow: "۰۴ / اندازه‌گیری و بهبود",
    description:
      "داده‌های واقعی صفحات را ثبت کنید؛ تغییرات را ببینید و برای بهبود تصمیم بگیرید.",
    singular: "نتیجه",
    button: "ثبت نتیجه",
    search: "جستجو در صفحه، آدرس و کلمه کلیدی…",
    filter: "result",
    statusList: "result",
    emptyTitle: "وقت اندازه‌گیری عملکرد است",
    emptyText:
      "پس از انتشار یا به‌روزرسانی یک صفحه، داده‌های Search Console را ثبت کنید تا روند رشد قابل مقایسه باشد.",
  },
} as const;

export function PageWorkspace(props: WorkspaceProps) {
  return <RowWorkspace {...props} kind="pages" />;
}
export function ContentWorkspace(props: WorkspaceProps) {
  return <RowWorkspace {...props} kind="content" />;
}
export function ResultsWorkspace(props: WorkspaceProps) {
  return <RowWorkspace {...props} kind="results" />;
}

function RowWorkspace({
  project,
  settings,
  onRowsChange,
  notify,
  kind,
  readOnly = false,
  focusRowId,
  onFocusHandled,
  onNavigate,
  draftScope = "local-development",
}: WorkspaceProps & { kind: WorkspaceKind }) {
  const rows = project[kind];
  const info = config[kind];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [sortKey, setSortKey] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Row | null>(null);
  const draftBaseline = useRef<string | null>(null);
  const draftOriginalRow = useRef<Row | null>(null);
  const draftInitial = useRef<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [calendar, setCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => getJalaliParts(todayIso())!);
  const [bulkStatus, setBulkStatus] = useState("");
  const [comparison, setComparison] = useState(false);
  const formDraft = useRowDraft({ projectId: project.id, collection: kind, scope: draftScope, readOnly,
    draft, baseline: draftOriginalRow.current, initial: draftInitial.current, creating,
    dirty: !!draft && rowFingerprint(draft) !== rowFingerprint(draftInitial.current || { id: draft.id }) });
  const pageMap = useMemo(() => {
    const map = new Map<string, Row>();
    project.pages.forEach((row) => {
      if (row.pageId) map.set(text(row.pageId), row);
    });
    project.pages.forEach((row) => map.set(row.id, row));
    return map;
  }, [project.pages]);
  const keywordMatches = useMemo(() => {
    const map = new Map<string, Row>();
    const ambiguous = new Set<string>();
    project.keywords.forEach((row) => {
      const key = normalizeKeyword(text(row.keyword));
      if (!key || ambiguous.has(key)) return;
      if (map.has(key)) {
        map.delete(key);
        ambiguous.add(key);
      } else map.set(key, row);
    });
    return { map, ambiguous };
  }, [project.keywords]);
  const resultMap = useMemo(
    () => resultLookup(project.results, project.pages),
    [project.results, project.pages],
  );
  const resolvePage = (row: Row) =>
    pageMap.get(text(kind === "content" ? row.targetPage : row.pageId));
  const viewRow = (row: Row) => {
    if (kind === "pages") return row;
    const linked = resolvePage(row);
    return {
      ...row,
      pkw: row.pkw || linked?.pkw || "",
      ...(kind === "results" ? { url: row.url || linked?.url || "" } : {}),
    };
  };
  const nextAction = (row: Row) => {
    if (kind === "pages") {
      const pkw = normalizeKeyword(text(row.pkw));
      if (
        keywordMatches.ambiguous.has(pkw) &&
        row.status !== "Complete" &&
        row.action !== "No Dedicated Page"
      )
        return "کلمه اصلی تکراری است؛ داده‌ها را بازبینی کنید";
      return nextPage(
        row,
        settings,
        keywordMatches.map.get(pkw),
        resultMap.get(row.id) || resultMap.get(text(row.pageId)),
      );
    }
    return kind === "content"
      ? nextContent(row, resolvePage(row))
      : nextResult(viewRow(row));
  };
  useEffect(() => {
    setSelected(new Set());
    setDraft(null);
    setDeleteIds([]);
    setQuery("");
    setFilter("");
    setPriorityFilter("");
    setPage(1);
  }, [project.id, kind]);
  useEffect(() => {
    if (!focusRowId || !formDraft.ready || formDraft.recovery) return;
    const row = rows.find((item) => item.id === focusRowId);
    if (row) { draftBaseline.current = rowFingerprint(row); draftOriginalRow.current = { ...row }; draftInitial.current = { ...row }; setDraft({ ...row }); setCreating(false); setError(""); }
    onFocusHandled?.();
  }, [focusRowId, rows, onFocusHandled, formDraft.ready, formDraft.recovery]);
  useEffect(() => {
    setPage(1);
  }, [query, filter, priorityFilter, sortKey, sortDirection]);
  const filtered = useMemo(() => {
    const search = normalized(query);
    const list = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        if (filter && row[info.filter] !== filter) return false;
        if (priorityFilter && row.priority !== priorityFilter) return false;
        if (!search) return true;
        const linked =
          kind === "pages"
            ? undefined
            : pageMap.get(
                text(kind === "content" ? row.targetPage : row.pageId),
              );
        return normalized(
          [
            ...Object.values(row),
            ...Object.values(row).map(translate),
            linked?.target,
            linked?.pkw,
            linked?.url,
          ].join(" "),
        ).includes(search);
      });
    if (sortKey)
      list.sort((a, b) => {
        const av = a.row[sortKey];
        const bv = b.row[sortKey];
        const result =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : collator.compare(text(av), text(bv));
        return (
          (sortDirection === "asc" ? result : -result) || a.index - b.index
        );
      });
    return list.map(({ row }) => row);
  }, [
    rows,
    query,
    filter,
    priorityFilter,
    sortKey,
    sortDirection,
    info.filter,
    kind,
    pageMap,
  ]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const selectedIds = rows
    .filter((row) => selected.has(row.id))
    .map((row) => row.id);
  const statusOptions =
    (LISTS as Record<string, string[]>)[info.statusList] || [];
  const edit = (row: Row) => {
    if (!formDraft.ready || formDraft.recovery) { notify("ابتدا پیش‌نویس قبلی را بازیابی یا کنار بگذارید."); return; }
    const copy = { ...row };
    if (kind !== "pages") {
      const key = kind === "content" ? "targetPage" : "pageId";
      const linked = pageMap.get(text(row[key]));
      if (linked) copy[key] = linked.id;
    }
    draftBaseline.current = rowFingerprint(row); draftOriginalRow.current = { ...row }; draftInitial.current = { ...copy };
    setDraft(copy);
    setCreating(false);
    setError("");
  };
  const create = () => {
    if (!formDraft.ready || formDraft.recovery) { notify("ابتدا پیش‌نویس قبلی را بازیابی یا کنار بگذارید."); return; }
    if (rows.length >= ROW_LIMIT) {
      notify(
        `سقف ${fa.format(ROW_LIMIT)} ${info.singular} برای این پروژه پر شده است.`,
      );
      return;
    }
    const initial = initialRow(kind, rows); draftBaseline.current = null; draftOriginalRow.current = null; draftInitial.current = { ...initial }; setDraft(initial);
    setCreating(true);
    setError("");
  };
  const commitRows = (next: Row[]) => {
    if (readOnly) return false;
    try { return onRowsChange(kind, next) !== false; }
    catch (cause) { notify(cause instanceof Error ? cause.message : "ذخیره انجام نشد؛ پیش‌نویس و انتخاب‌ها حفظ شده‌اند."); return false; }
  };
  const save = () => {
    if (readOnly) return;
    if (!draft) return;
    if (!creating && rowFingerprint(rows.find((row) => row.id === draft.id) || { id: "deleted" }) !== draftBaseline.current) {
      setError("این رکورد هم‌زمان تغییر کرده است. متن خود را کپی کنید و پنل را دوباره باز کنید.");
      return;
    }
    if (creating && rows.length >= ROW_LIMIT) {
      setError(
        `سقف ${fa.format(ROW_LIMIT)} ${info.singular} برای این پروژه پر شده است. یک مورد را حذف کنید و دوباره تلاش کنید.`,
      );
      return;
    }
    if (kind === "pages" && !text(draft.target).trim()) {
      setError("نام یا هدف صفحه را وارد کنید.");
      return;
    }
    if (kind === "content" && !text(draft.topic).trim()) {
      setError("عنوان یا موضوع محتوا را وارد کنید.");
      return;
    }
    if (kind === "results" && !draft.pageId && !text(draft.url).trim()) {
      setError("یک صفحه انتخاب کنید یا آدرس صفحه را وارد کنید.");
      return;
    }
    for (const field of SCHEMAS[kind].flatMap((section) => section.fields)) {
      if (field.type !== "number" || !present(draft[field.key])) continue;
      const value = Number(draft[field.key]);
      if (!Number.isFinite(value) || value < 0) {
        setError(`${field.label} باید یک عدد صفر یا بیشتر باشد.`);
        return;
      }
      if (["ctr", "previousCtr"].includes(field.key) && value > 100) {
        setError(`${field.label} باید بین صفر و ۱۰۰ باشد.`);
        return;
      }
    }
    const displayIdKey =
      kind === "pages" ? "pageId" : kind === "content" ? "contentId" : "";
    if (
      displayIdKey &&
      present(draft[displayIdKey]) &&
      rows.some(
        (row) =>
          row.id !== draft.id &&
          normalized(row[displayIdKey]) === normalized(draft[displayIdKey]),
      )
    ) {
      setError("این شناسه قبلاً استفاده شده است؛ یک شناسه یکتا وارد کنید.");
      return;
    }
    if (kind === "results") {
      const linked = pageMap.get(text(draft.pageId));
      const effectiveUrl = normalized(draft.url || linked?.url).replace(
        /\/$/,
        "",
      );
      const duplicate = rows.some(
        (row) =>
          row.id !== draft.id &&
          ((linked && pageMap.get(text(row.pageId))?.id === linked.id) ||
            (draft.pageId && row.pageId === draft.pageId) ||
            (effectiveUrl &&
              normalized(row.url || pageMap.get(text(row.pageId))?.url).replace(
                /\/$/,
                "",
              ) === effectiveUrl)),
      );
      if (duplicate) {
        setError(
          "برای این صفحه نتیجه ثبت شده است. همان رکورد را به‌روزرسانی کنید.",
        );
        return;
      }
    }
    const clean = Object.fromEntries(
      Object.entries(draft).map(([key, value]) => [
        key,
        typeof value === "string" ? value.trim() : value,
      ]),
    ) as Row;
    if (!commitRows(
      creating
        ? [...rows, clean]
        : rows.map((row) => (row.id === draft.id ? clean : row)),
    )) return;
    formDraft.clear();
    setDraft(null);
    notify(`${info.singular} ${creating ? "اضافه" : "به‌روزرسانی"} شد.`);
  };
  const remove = () => {
    if (readOnly) return;
    const ids = new Set(deleteIds);
    if (!commitRows(rows.filter((row) => !ids.has(row.id)))) return;
    setSelected(
      (current) => new Set([...current].filter((id) => !ids.has(id))),
    );
    setDeleteIds([]);
    notify(`${fa.format(ids.size)} ${info.singular} حذف شد.`);
  };
  const linkedCount =
    kind === "pages"
      ? project.content.filter((row) =>
          deleteIds.includes(
            pageMap.get(text(row.targetPage))?.id || text(row.targetPage),
          ),
        ).length +
        project.results.filter((row) =>
          deleteIds.includes(
            pageMap.get(text(row.pageId))?.id || text(row.pageId),
          ),
        ).length +
        project.keywords.filter((row) => deleteIds.includes(text(row.targetPage))).length +
        (project.tasks || []).filter((row) => deleteIds.includes(text(row.pageId))).length +
        (project.links || []).filter((row) => deleteIds.includes(text(row.fromPageId)) || deleteIds.includes(text(row.toPageId))).length
      : 0;
  const toggleAll = () =>
    setSelected((current) => {
      const next = new Set(current);
      const all = visible.every((row) => next.has(row.id));
      visible.forEach((row) => (all ? next.delete(row.id) : next.add(row.id)));
      return next;
    });
  const applyBulkStatus = () => {
    if (readOnly) return;
    if (!bulkStatus) return;
    if (!commitRows(
      rows.map((row) =>
        selected.has(row.id) ? { ...row, [info.filter]: bulkStatus } : row,
      ),
    )) return;
    notify(
      `وضعیت ${fa.format(selectedIds.length)} ${info.singular} تغییر کرد.`,
    );
    setBulkStatus("");
    setSelected(new Set());
  };
  const titleCell = (row: Row) => {
    const linked = resolvePage(row);
    const title =
      kind === "pages"
        ? text(row.target)
        : kind === "content"
          ? text(row.topic)
          : text(linked?.target || row.url || row.pkw || "صفحه بدون نام");
    const secondary =
      kind === "pages"
        ? text(row.pageId)
        : kind === "content"
          ? text(row.contentId)
          : text(viewRow(row).url);
    return (
      <button
        type="button"
        className="workspace-row-title"
        onClick={() => edit(row)}
      >
        <strong>{title || "بدون عنوان"}</strong>
        <span className="muted" dir={kind === "results" ? "ltr" : undefined}>
          {secondary || "ویرایش جزئیات"}
        </span>
      </button>
    );
  };
  const pageLinkCell = (row: Row) => {
    const linked = resolvePage(row);
    return linked ? (
      <span className="linked-page">
        <Layers3 size={13} />
        {text(linked.target)}
      </span>
    ) : (
      <span className="muted">
        {row.targetPage || row.pageId
          ? "صفحه حذف‌شده یا نامعتبر"
          : "انتخاب نشده"}
      </span>
    );
  };
  const columns: Column[] =
    kind === "pages"
      ? [
          { key: "target", label: "صفحه / هدف", render: titleCell },
          { key: "pkw", label: "کلمه کلیدی اصلی" },
          {
            key: "pageType",
            label: "نوع صفحه",
            render: (row) => <Chip value={row.pageType} />,
          },
          {
            key: "priority",
            label: "اولویت",
            render: (row) => <Chip value={row.priority} />,
          },
          {
            key: "status",
            label: "وضعیت",
            render: (row) => <Chip value={row.status} />,
          },
          {
            key: "nextAction",
            label: "قدم بعدی",
            render: (row) => (
              <span className="next-action">
                <ArrowUpRight size={14} />
                {nextAction(row)}
              </span>
            ),
          },
        ]
      : kind === "content"
        ? [
            { key: "topic", label: "موضوع محتوا", render: titleCell },
            { key: "targetPage", label: "صفحه هدف", render: pageLinkCell },
            {
              key: "contentType",
              label: "نوع محتوا",
              render: (row) => <Chip value={row.contentType} />,
            },
            {
              key: "writingStatus",
              label: "وضعیت تولید",
              render: (row) => <Chip value={row.writingStatus} />,
            },
            {
              key: "publishDate",
              label: "تاریخ انتشار",
              render: (row) => <span>{dateText(row.publishDate)}</span>,
            },
            {
              key: "nextAction",
              label: "قدم بعدی",
              render: (row) => (
                <span className="next-action">
                  <ArrowUpRight size={14} />
                  {nextAction(row)}
                </span>
              ),
            },
          ]
        : [
            { key: "pageId", label: "صفحه / آدرس", render: titleCell },
            {
              key: "pkw",
              label: "کلمه کلیدی اصلی",
              render: (row) => text(viewRow(row).pkw) || "—",
            },
            {
              key: "clicks",
              label: "کلیک",
              render: (row) => numberText(row.clicks),
            },
            {
              key: "impressions",
              label: "نمایش",
              render: (row) => numberText(row.impressions),
            },
            {
              key: "ctr",
              label: "CTR",
              render: (row) =>
                present(row.ctr) ? `${numberText(row.ctr)}٪` : "—",
            },
            {
              key: "position",
              label: "رتبه میانگین",
              render: (row) => numberText(row.position),
            },
            {
              key: "result",
              label: "ارزیابی",
              render: (row) => <Chip value={row.result} />,
            },
            ...(comparison
              ? [
                  {
                    key: "clicksChange",
                    label: "تغییر کلیک",
                    render: (row: Row) => (
                      <Delta
                        current={row.clicks}
                        previous={row.previousClicks}
                      />
                    ),
                  },
                ]
              : []),
            {
              key: "nextAction",
              label: "قدم بعدی",
              render: (row) => (
                <span className="next-action">
                  <ArrowUpRight size={14} />
                  {nextAction(row)}
                </span>
              ),
            },
          ];
  const sortOptions =
    kind === "pages"
      ? [
          { key: "target", label: "نام صفحه" },
          { key: "priority", label: "اولویت" },
          { key: "status", label: "وضعیت" },
        ]
      : kind === "content"
        ? [
            { key: "topic", label: "موضوع" },
            { key: "publishDate", label: "تاریخ انتشار" },
            { key: "writingStatus", label: "وضعیت تولید" },
          ]
        : [
            { key: "clicks", label: "تعداد کلیک" },
            { key: "impressions", label: "تعداد نمایش" },
            { key: "position", label: "رتبه میانگین" },
            { key: "lastChecked", label: "آخرین بررسی" },
          ];
  const calendarGroups = useMemo(() => {
    const groups = new Map<string, Row[]>();
    filtered.forEach((row) => {
      const date = toIsoDate(text(row.publishDate)) || "";
      const parts = getJalaliParts(date);
      if (parts && (parts.year !== calendarMonth.year || parts.month !== calendarMonth.month)) return;
      const key = parts ? date : "undated";
      groups.set(key, [...(groups.get(key) || []), row]);
    });
    return [...groups.entries()].sort(([a], [b]) =>
      a === "undated" ? 1 : b === "undated" ? -1 : a.localeCompare(b),
    );
  }, [filtered, calendarMonth.year, calendarMonth.month]);
  const calendarByDate = new Map(calendarGroups);
  const moveCalendarMonth = (delta: number) => {
    let year = calendarMonth.year, month = calendarMonth.month + delta;
    if (month < 1) { year--; month = 12; }
    if (month > 12) { year++; month = 1; }
    if (year < 1 || year > 3177) return;
    setCalendarMonth({ year, month, day: 1 });
  };
  return (
    <section className={`workspace page-workspace workspace-${kind}`}>
      <RowDraftRecovery draft={formDraft.recovery} error={formDraft.error} onDiscard={formDraft.clear} onRecover={() => {
        const saved = formDraft.recover();
        if (!saved) return;
        draftOriginalRow.current = saved.baseline; draftBaseline.current = saved.baseline ? rowFingerprint(saved.baseline) : null; draftInitial.current = saved.initial;
        setDraft({ ...saved.row }); setCreating(saved.creating); setError("");
      }}/>
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">{info.eyebrow}</span>
          <h1>
            {info.title}
            <span className="workspace-count">{fa.format(rows.length)}</span>
          </h1>
          <p className="muted">{info.description}</p>
        </div>
        <button
          className="btn btn-primary"
          disabled={readOnly || !formDraft.ready || !!formDraft.recovery || rows.length >= ROW_LIMIT}
          title={
            rows.length >= ROW_LIMIT
              ? "سقف تعداد رکوردهای این پروژه پر شده است"
              : undefined
          }
          onClick={create}
        >
          <Plus size={18} />
          {info.button}
        </button>
      </div>
      {kind === "results" && rows.length > 0 && (
        <div className="stat-strip results-stat-strip">
          <div>
            <span className="muted">مجموع کلیک‌های ثبت‌شده</span>
            <strong>
              {fa.format(
                rows.reduce((sum, row) => sum + (Number(row.clicks) || 0), 0),
              )}
            </strong>
          </div>
          <div>
            <span className="muted">مجموع نمایش‌های ثبت‌شده</span>
            <strong>
              {fa.format(
                rows.reduce(
                  (sum, row) => sum + (Number(row.impressions) || 0),
                  0,
                ),
              )}
            </strong>
          </div>
          <div>
            <span className="muted">صفحات در حال اندازه‌گیری</span>
            <strong>{fa.format(rows.length)}</strong>
          </div>
          <div className="results-stat-note">
            <span>اعداد واردشده از بازه‌های زمانی خودتان هستند.</span>
            <small>برای مقایسه دقیق، بازه‌های هم‌اندازه ثبت کنید.</small>
          </div>
        </div>
      )}
      <div className="toolbar workspace-toolbar">
        <label className="search-input">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={info.search}
            aria-label={info.search}
          />
        </label>
        <div className="workspace-filter-controls">
          <SlidersHorizontal size={16} className="muted" />
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="فیلتر وضعیت"
          >
            <option value="">همه وضعیت‌ها</option>
            {statusOptions.map((value) => (
              <option value={value} key={value}>
                {translate(value)}
              </option>
            ))}
          </select>
          {kind === "pages" && (
            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value)}
              aria-label="فیلتر اولویت"
            >
              <option value="">همه اولویت‌ها</option>
              {(
                (LISTS as Record<string, string[]>).priority || [
                  "P0",
                  "P1",
                  "P2",
                  "P3",
                  "Backlog",
                ]
              ).map((value) => (
                <option value={value} key={value}>
                  {translate(value)}
                </option>
              ))}
            </select>
          )}
          <select
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value)}
            aria-label="مرتب‌سازی"
          >
            <option value="">ترتیب ثبت</option>
            {sortOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          {sortKey && (
            <button
              className="icon-button"
              onClick={() =>
                setSortDirection((current) =>
                  current === "asc" ? "desc" : "asc",
                )
              }
              aria-label={
                sortDirection === "asc" ? "مرتب‌سازی نزولی" : "مرتب‌سازی صعودی"
              }
            >
              {sortDirection === "asc" ? (
                <ArrowUp size={16} />
              ) : (
                <ArrowDown size={16} />
              )}
            </button>
          )}
        </div>
        {kind === "content" && (
          <div className="workspace-view-toggle" aria-label="نوع نمایش">
            <button
              className={!calendar ? "active" : ""}
              onClick={() => setCalendar(false)}
              aria-pressed={!calendar}
            >
              <Layers3 size={15} />
              جدول
            </button>
            <button
              className={calendar ? "active" : ""}
              onClick={() => setCalendar(true)}
              aria-pressed={calendar}
            >
              <CalendarDays size={15} />
              تقویم
            </button>
          </div>
        )}
        {kind === "results" && (
          <label className="comparison-toggle">
            <input
              type="checkbox"
              checked={comparison}
              onChange={(event) => setComparison(event.target.checked)}
            />
            مقایسه
          </label>
        )}
      </div>
      {selectedIds.length > 0 && (
        <div className="workspace-bulk-bar">
          <span>
            <Check size={16} />
            {fa.format(selectedIds.length)} {info.singular} انتخاب شده
          </span>
          <select
            aria-label="وضعیت جدید برای موارد انتخاب‌شده"
            value={bulkStatus}
            onChange={(event) => setBulkStatus(event.target.value)}
          >
            <option value="">تغییر وضعیت…</option>
            {statusOptions.map((value) => (
              <option value={value} key={value}>
                {translate(value)}
              </option>
            ))}
          </select>
          <button
            className="btn btn-secondary"
            disabled={readOnly || !bulkStatus}
            onClick={applyBulkStatus}
          >
            اعمال
          </button>
          <button
            className="btn btn-danger"
            onClick={() => setDeleteIds(selectedIds)}
          >
            <Trash2 size={15} />
            حذف
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setSelected(new Set())}
          >
            لغو انتخاب
          </button>
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="table-card empty-state">
          <div className="workspace-empty-icon">
            <FileText size={29} />
          </div>
          <h2>{rows.length ? "موردی پیدا نشد" : info.emptyTitle}</h2>
          <p className="muted">
            {rows.length
              ? "عبارت جستجو یا فیلترها را تغییر دهید تا موارد دیگر را ببینید."
              : info.emptyText}
          </p>
          {rows.length ? (
            <button
              className="btn btn-secondary"
              onClick={() => {
                setQuery("");
                setFilter("");
                setPriorityFilter("");
              }}
            >
              پاک کردن فیلترها
            </button>
          ) : (
            <button disabled={readOnly} className="btn btn-primary" onClick={create}>
              <Plus size={16} />
              {info.button}
            </button>
          )}
        </div>
      ) : calendar && kind === "content" ? (
        <div className="content-calendar">
          <div className="shamsi-calendar-toolbar">
            <div>
              <button type="button" className="icon-btn" aria-label="ماه قبل تقویم محتوا" onClick={() => moveCalendarMonth(-1)}><ChevronRight size={18}/></button>
              <h3>{JALALI_MONTHS[calendarMonth.month - 1]} {fa.format(calendarMonth.year).replace(/٬/g, "")}</h3>
              <button type="button" className="icon-btn" aria-label="ماه بعد تقویم محتوا" onClick={() => moveCalendarMonth(1)}><ChevronLeft size={18}/></button>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => setCalendarMonth(getJalaliParts(todayIso())!)}>ماه جاری</button>
          </div>
          <div className="shamsi-content-grid" aria-label="تقویم ماهانه شمسی محتوا">
            {JALALI_WEEKDAYS.map((day) => <div className="shamsi-weekday" key={day}>{day}</div>)}
            {jalaliMonthGrid(calendarMonth.year, calendarMonth.month).map((day, index) => <div key={day?.iso || `blank-${index}`} className={`shamsi-content-day ${day?.weekday === 6 ? "friday" : ""} ${day?.iso === todayIso() ? "today" : ""}`}>
              {day && <>
                <span>{fa.format(day.day)}</span>
                {(calendarByDate.get(day.iso) || []).slice(0, 3).map((row) => <button type="button" key={row.id} title={text(row.topic)} onClick={() => edit(row)}>{text(row.topic) || "بدون موضوع"}</button>)}
                {(calendarByDate.get(day.iso)?.length || 0) > 3 && <button type="button" onClick={() => document.getElementById(`calendar-${day.iso}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>+ {fa.format(calendarByDate.get(day.iso)!.length - 3)} محتوای دیگر</button>}
              </>}
            </div>)}
          </div>
          {!calendarGroups.some(([date]) => date !== "undated") && <p className="muted">برای این ماه محتوایی زمان‌بندی نشده است. با دکمه‌های ماه قبل و بعد، برنامه ماه‌های دیگر را ببینید.</p>}
          {calendarGroups.map(([date, items]) => (
            <section className="calendar-date-group" key={date} id={`calendar-${date}`}>
              <div className="calendar-date-label">
                <CalendarDays size={19} />
                <h3>
                  {date === "undated"
                    ? "هنوز برنامه‌ریزی نشده"
                    : dateText(date)}
                </h3>
                <span className="muted">{fa.format(items.length)} محتوا</span>
              </div>
              <div className="calendar-items">
                {items.map((row) => (
                  <button
                    className="calendar-item"
                    key={row.id}
                    onClick={() => edit(row)}
                  >
                    <div>
                      <Chip value={row.contentType} />
                      <Chip value={row.writingStatus} />
                    </div>
                    <strong>{text(row.topic) || "بدون موضوع"}</strong>
                    <span className="muted">
                      {text(resolvePage(row)?.target) || "صفحه هدف انتخاب نشده"}
                    </span>
                    <div className="calendar-item-footer">
                      <span>{text(row.owner) || "بدون مسئول"}</span>
                      <ArrowUpRight size={17} />
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="table-card">
          <div className="workspace-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="workspace-checkbox-cell">
                    <input
                      type="checkbox"
                      aria-label="انتخاب همه موارد این صفحه"
                      checked={
                        visible.length > 0 &&
                        visible.every((row) => selected.has(row.id))
                      }
                      onChange={toggleAll}
                    />
                  </th>
                  {columns.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                  <th>
                    <span className="sr-only">عملیات</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.id}
                    className={selected.has(row.id) ? "row-selected" : ""}
                  >
                    <td className="workspace-checkbox-cell">
                      <input
                        type="checkbox"
                        aria-label={`انتخاب ${text(row.target || row.topic || resolvePage(row)?.target || row.url || row.id)}`}
                        checked={selected.has(row.id)}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            next.has(row.id)
                              ? next.delete(row.id)
                              : next.add(row.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    {columns.map((column) => (
                      <td key={column.key}>
                        {column.render ? (
                          column.render(row)
                        ) : present(row[column.key]) ? (
                          text(row[column.key])
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    ))}
                    <td>
                      <div className="workspace-row-actions">
                        <button
                          className="icon-button"
                          disabled={!formDraft.ready}
                          onClick={() => edit(row)}
                          aria-label={`ویرایش ${text(row.target || row.topic || resolvePage(row)?.target || row.id)}`}
                          title="ویرایش"
                        >
                          <ArrowUpRight size={17} />
                        </button>
                        <button
                          disabled={readOnly}
                          className="icon-button delete-row-button"
                          onClick={() => setDeleteIds([row.id])}
                          aria-label={`حذف ${text(row.target || row.topic || resolvePage(row)?.target || row.id)}`}
                          title="حذف"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span className="muted">
              {fa.format((currentPage - 1) * PAGE_SIZE + 1)}–
              {fa.format(Math.min(currentPage * PAGE_SIZE, filtered.length))} از{" "}
              {fa.format(filtered.length)} {info.singular}
            </span>
            <div className="pagination-controls">
              <button
                className="icon-button"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                aria-label="صفحه قبل"
              >
                <ChevronRight size={17} />
              </button>
              <span>
                صفحه {fa.format(currentPage)} از {fa.format(pageCount)}
              </span>
              <button
                className="icon-button"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
                aria-label="صفحه بعد"
              >
                <ChevronLeft size={17} />
              </button>
            </div>
          </div>
        </div>
      )}
      {draft && (
        <RowDrawer
          key={draft.id}
          draft={draft}
          initial={draftInitial.current || draft}
          readOnly={readOnly}
          setDraft={setDraft}
          kind={kind}
          settings={settings}
          project={project}
          creating={creating}
          error={error}
          onSave={save}
          onClose={() => { formDraft.clear(); setDraft(null); }}
          nextAction={nextAction(draft)}
          resolvePage={resolvePage}
          onNavigate={onNavigate}
          notify={notify}
        />
      )}
      {deleteIds.length > 0 && (
        <ConfirmDelete
          count={deleteIds.length}
          singular={info.singular}
          linkedCount={linkedCount}
          onCancel={() => setDeleteIds([])}
          onConfirm={remove}
        />
      )}
    </section>
  );
}

function Delta({
  current,
  previous,
  points = false,
  reversed = false,
}: {
  current: unknown;
  previous: unknown;
  points?: boolean;
  reversed?: boolean;
}) {
  if (
    !present(current) ||
    !present(previous) ||
    !Number.isFinite(Number(current)) ||
    !Number.isFinite(Number(previous))
  )
    return <span className="muted">بدون مبنا</span>;
  const currentNumber = Number(current);
  const previousNumber = Number(previous);
  if (!points && previousNumber === 0)
    return (
      <span className={currentNumber > 0 ? "delta-positive" : "muted"}>
        {currentNumber === 0 ? "بدون تغییر" : "از صفر؛ قابل محاسبه نیست"}
      </span>
    );
  const delta = points
    ? reversed
      ? previousNumber - currentNumber
      : currentNumber - previousNumber
    : ((currentNumber - previousNumber) / previousNumber) * 100;
  return (
    <span
      className={
        delta > 0 ? "delta-positive" : delta < 0 ? "delta-negative" : "muted"
      }
      dir="ltr"
    >
      {delta > 0 ? "+" : ""}
      {fa.format(delta)}
      {points ? "" : "٪"}
    </span>
  );
}

function useDialogFocus(
  ref: { current: HTMLDivElement | null },
  close: () => void,
) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const active =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = ref.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button',
    );
    (first || panel)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab" || !panel) return;
      const nodes = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ].filter((node) => node.getClientRects().length > 0);
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === firstNode) {
        event.preventDefault();
        lastNode?.focus();
      } else if (!event.shiftKey && document.activeElement === lastNode) {
        event.preventDefault();
        firstNode?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      active?.focus();
    };
  }, []);
}

function RowDrawer({
  draft,
  initial,
  setDraft,
  kind,
  settings,
  project,
  creating,
  error,
  onSave,
  onClose,
  nextAction,
  resolvePage,
  readOnly,
  onNavigate,
  notify,
}: {
  draft: Row;
  initial: Row;
  setDraft: (row: Row) => void;
  kind: WorkspaceKind;
  settings: WorkspaceProps["settings"];
  project: WorkspaceProps["project"];
  creating: boolean;
  error: string;
  onSave: () => void;
  onClose: () => void;
  nextAction: string;
  resolvePage: (row: Row) => Row | undefined;
  readOnly: boolean;
  onNavigate?: WorkspaceProps["onNavigate"];
  notify: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const original = useRef(rowFingerprint(initial));
  const dirty = rowFingerprint(draft) !== original.current;
  const requestClose = () => {
    if (
      dirty &&
      !window.confirm(
        "تغییرات ذخیره نشده‌اند. بدون ذخیره از این پنل خارج می‌شوید؟",
      )
    )
      return;
    onClose();
  };
  useDialogFocus(ref, requestClose);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const schemas = SCHEMAS[kind];
  const linked = kind === "pages" ? undefined : resolvePage(draft);
  const inputChange = (key: string, value: string, type?: Field["type"]) =>
    setDraft({
      ...draft,
      [key]: type === "number" && value !== "" ? Number(value) : value,
    });
  const control = (field: Field) => {
    const value = draft[field.key];
    const isPageSelect =
      (kind === "content" && field.key === "targetPage") ||
      (kind === "results" && field.key === "pageId");
    const id = `field-${kind}-${field.key}`;
    if (field.calculated) {
      const calculated =
        field.key === "nextAction"
          ? nextAction
          : fieldValue(draft, field.key, settings);
      return (
        <div className="field calculated-field" key={field.key}>
          <span>{field.label}</span>
          <output>{present(calculated) ? translate(calculated) : "—"}</output>
          {field.hint && <small>{field.hint}</small>}
        </div>
      );
    }
    const inherited =
      kind !== "pages" && field.key === "pkw"
        ? linked?.pkw
        : kind === "results" && field.key === "url"
          ? linked?.url
          : undefined;
    return (
      <label
        className={`field ${field.type === "textarea" ? "field-wide" : ""}`}
        key={field.key}
        htmlFor={id}
      >
        <span>
          {field.label}
          {((kind === "pages" && field.key === "target") ||
            (kind === "content" && field.key === "topic")) && (
            <span className="required-mark"> *</span>
          )}
        </span>
        {isPageSelect ? (
          <select
            id={id}
            value={text(value)}
            onChange={(event) => inputChange(field.key, event.target.value)}
          >
            <option value="">انتخاب صفحه هدف…</option>
            {value &&
              !project.pages.some(
                (row) => row.id === value || row.pageId === value,
              ) && <option value={text(value)}>صفحه حذف‌شده یا نامعتبر</option>}
            {project.pages.map((row) => (
              <option key={row.id} value={row.id}>
                {text(row.target) || "بدون نام"}
                {row.pageId ? ` · ${row.pageId}` : ""}
              </option>
            ))}
          </select>
        ) : field.type === "select" ? (
          <select
            id={id}
            value={text(value)}
            onChange={(event) => inputChange(field.key, event.target.value)}
          >
            <option value="">انتخاب کنید…</option>
            {value && !field.options?.includes(text(value)) && (
              <option value={text(value)}>{translate(value)}</option>
            )}
            {field.options?.map((option) => (
              <option value={option} key={option}>
                {translate(option)}
              </option>
            ))}
          </select>
        ) : field.type === "textarea" ? (
          <textarea
            maxLength={100000}
            id={id}
            rows={3}
            value={text(value)}
            onChange={(event) => inputChange(field.key, event.target.value)}
            placeholder={field.hint}
          />
        ) : field.type === "date" ? (
          <JalaliDateInput id={id} value={text(value)} onChange={(iso) => inputChange(field.key, iso)} aria-label={field.label}/>
        ) : (
          <input
            id={id}
            type={
              field.type === "number"
                ? "number"
                : "text"
            }
            value={text(value)}
            onChange={(event) =>
              inputChange(field.key, event.target.value, field.type)
            }
            min={field.type === "number" ? 0 : undefined}
            max={
              field.key === "ctr" || field.key === "previousCtr"
                ? 100
                : undefined
            }
            step={field.type === "number" ? "any" : undefined}
            inputMode={
              field.type === "number"
                ? "decimal"
                : field.type === "url"
                  ? "url"
                  : undefined
            }
            dir={
              [
                "url",
                "pageId",
                "contentId",
                "publishDate",
                "baselineDate",
                "lastChecked",
              ].includes(field.key)
                ? "ltr"
                : undefined
            }
            placeholder={inherited ? text(inherited) : field.hint}
          />
        )}
        {inherited && !value ? (
          <small>در صورت خالی بودن، از صفحه هدف نمایش داده می‌شود.</small>
        ) : field.hint && field.type !== "textarea" ? (
          <small>{field.hint}</small>
        ) : null}
      </label>
    );
  };
  const title = text(draft.proposedTitle || draft.currentTitle).trim();
  const meta = text(draft.proposedMeta || draft.currentMeta).trim();
  const titleLength = Number(fieldValue(draft, "titleLength", settings)) || 0;
  const metaLength = Number(fieldValue(draft, "metaLength", settings)) || 0;
  const h1Review = fieldValue(draft, "pkwInH1", settings);
  const reviewText = (value: string, min: number, max: number) =>
    !value
      ? "هنوز وارد نشده"
      : Array.from(value).length < min
        ? "کوتاه‌تر از بازه پیشنهادی"
        : Array.from(value).length > max
          ? "بلندتر از بازه پیشنهادی"
          : "در بازه پیشنهادی";
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        className="drawer workspace-drawer"
        data-unsaved={dirty ? "true" : "false"}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="row-drawer-title"
        tabIndex={-1}
      >
        <div className="drawer-header">
          <div>
            <span className="eyebrow">
              {creating ? "یک قدم تازه" : "جزئیات و ویرایش"}
            </span>
            <h2 id="row-drawer-title">
              {creating
                ? config[kind].button
                : text(
                    draft.target ||
                      draft.topic ||
                      linked?.target ||
                      "جزئیات نتیجه",
                  )}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={requestClose}
            aria-label="بستن پنل"
          >
            <X size={21} />
          </button>
        </div>
        <form
          className="workspace-drawer-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="drawer-body">
            {kind === "pages" && !creating && <section className="page-connections">
              <h3>فضای کار این صفحه</h3>
              <p>کلمات، محتوا و نتایج مرتبط با همین شناسهٔ ثابت صفحه.</p>
              <nav>
                <button type="button" disabled={readOnly} onClick={() => {
                  const proposal = buildBrief(project, draft); const next = { ...draft }; let count = 0;
                  for (const [key, value] of Object.entries(proposal)) if (!text(next[key]) && text(value)) { next[key] = value; count++; }
                  if (count) { setDraft(next); notify("بریف پیشنهادی در خانه‌های خالی آماده شد؛ بررسی و ذخیره کنید."); }
                  else notify("خانه‌های بریف از قبل تکمیل‌اند؛ اطلاعات دستی حفظ شد.");
                }}>آماده‌سازی بریف در خانه‌های خالی</button>
                {project.content.filter((row) => row.targetPage === draft.id).slice(0, 5).map((row) => <button type="button" key={row.id} onClick={() => onNavigate?.("content", row.id)}>محتوا: {text(row.topic) || "بدون عنوان"}</button>)}
                {project.results.filter((row) => row.pageId === draft.id || row.pageId && row.pageId === draft.pageId).slice(0, 3).map((row) => <button type="button" key={row.id} onClick={() => onNavigate?.("results", row.id)}>نتایج این صفحه</button>)}
              </nav>
              <details><summary>کلمات متصل به صفحه ({fa.format(project.keywords.filter((row) => row.targetPage === draft.id).length)})</summary><div className="connection-list">{project.keywords.filter((row) => row.targetPage === draft.id).slice(0, 100).map((row) => <button type="button" key={row.id} onClick={() => onNavigate?.("keywords", row.id)}>{text(row.keyword)}</button>)}</div></details>
            </section>}
            <fieldset className="readonly-fields" disabled={readOnly}>
            <div className="drawer-next-action">
              <span>
                <ArrowUpRight size={17} />
                قدم بعدی
              </span>
              <strong>{nextAction}</strong>
            </div>
            {schemas.map((section, index) =>
              index === 0 ? (
                <section className="drawer-core-section" key={section.key}>
                  <h3>{section.label}</h3>
                  <div className="form-grid">{section.fields.map(control)}</div>
                </section>
              ) : (
                <details className="section-accordion" key={section.key}>
                  <summary>
                    <span>{section.label}</span>
                    <Plus size={17} />
                  </summary>
                  <div className="section-accordion-body">
                    <div className="form-grid">
                      {section.fields.map(control)}
                    </div>
                    {kind === "pages" && section.key === "onPage" && (
                      <div className="seo-review-card">
                        <h4>بازبینی سریع متن‌های سئو</h4>
                        <div>
                          <span>
                            عنوان سئو{" "}
                            <small>
                              ({fa.format(settings.titleMin)} تا{" "}
                              {fa.format(settings.titleMax)} کاراکتر)
                            </small>
                          </span>
                          <strong>{fa.format(titleLength)} کاراکتر</strong>
                          <Chip
                            value={
                              title &&
                              titleLength >= settings.titleMin &&
                              titleLength <= settings.titleMax
                                ? "Passed"
                                : "Needs Review"
                            }
                          />
                          <small>
                            {reviewText(
                              title,
                              settings.titleMin,
                              settings.titleMax,
                            )}
                          </small>
                        </div>
                        <div>
                          <span>
                            توضیحات متا{" "}
                            <small>
                              ({fa.format(settings.metaMin)} تا{" "}
                              {fa.format(settings.metaMax)} کاراکتر)
                            </small>
                          </span>
                          <strong>{fa.format(metaLength)} کاراکتر</strong>
                          <Chip
                            value={
                              meta &&
                              metaLength >= settings.metaMin &&
                              metaLength <= settings.metaMax
                                ? "Passed"
                                : "Needs Review"
                            }
                          />
                          <small>
                            {reviewText(
                              meta,
                              settings.metaMin,
                              settings.metaMax,
                            )}
                          </small>
                        </div>
                        <div>
                          <span>کلمه کلیدی اصلی در H1</span>
                          <strong>
                            {present(h1Review)
                              ? translate(h1Review)
                              : "نیاز به اطلاعات"}
                          </strong>
                        </div>
                        <p className="muted">
                          طول متن فقط یک نشانه برای بازبینی است؛ امتیاز
                          رتبه‌بندی نیست. عنوان سئو و H1 می‌توانند متفاوت باشند.
                        </p>
                      </div>
                    )}
                    {kind === "results" && (
                      <div className="result-comparison-card">
                        <h4>تغییر نسبت به داده قبلی</h4>
                        <div>
                          <span>کلیک</span>
                          <Delta
                            current={draft.clicks}
                            previous={draft.previousClicks}
                          />
                        </div>
                        <div>
                          <span>نمایش</span>
                          <Delta
                            current={draft.impressions}
                            previous={draft.previousImpressions}
                          />
                        </div>
                        <div>
                          <span>CTR (واحد درصد)</span>
                          <Delta
                            current={draft.ctr}
                            previous={draft.previousCtr}
                            points
                          />
                        </div>
                        <div>
                          <span>بهبود رتبه (مثبت = بهتر)</span>
                          <Delta
                            current={draft.position}
                            previous={draft.previousPosition}
                            points
                            reversed
                          />
                        </div>
                        <small className="muted">
                          وقتی مبنا صفر است، درصد تغییر قابل محاسبه نیست. CTR را
                          به صورت درصد وارد کنید؛ مثلاً ۲٫۵.
                        </small>
                      </div>
                    )}
                  </div>
                </details>
              ),
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </fieldset></div>
          <div className="drawer-footer">
            <span className="muted">تغییرات با ذخیره ثبت می‌شوند.</span>
            <div>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={requestClose}
              >
                انصراف
              </button>
              <button disabled={readOnly} className="btn btn-primary" type="submit">
                <Check size={17} />
                ذخیره {config[kind].singular}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmDelete({
  count,
  singular,
  linkedCount,
  onCancel,
  onConfirm,
}: {
  count: number;
  singular: string;
  linkedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onCancel);
  return (
    <div
      className="drawer-backdrop workspace-confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="workspace-confirm-dialog"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        tabIndex={-1}
      >
        <div className="confirm-delete-icon">
          <Trash2 size={24} />
        </div>
        <h2 id="confirm-delete-title">
          حذف {fa.format(count)} {singular}؟
        </h2>
        <p className="muted">
          این موارد از پروژه حذف می‌شوند. برای حذف، دکمه زیر را انتخاب کنید.
        </p>
        {linkedCount > 0 && (
          <p className="form-error">
            {fa.format(linkedCount)} رکورد به این صفحات متصل است. آن
            رکوردها حفظ می‌شوند و باید صفحه هدف آن‌ها را دوباره انتخاب کنید.
          </p>
        )}
        <div className="workspace-confirm-actions">
          <button className="btn btn-secondary" onClick={onCancel}>
            انصراف
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            حذف {singular}
          </button>
        </div>
      </div>
    </div>
  );
}
