import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent, ReactNode } from "react";
import { ArrowDownToLine, Check, Columns3, Copy, FileSpreadsheet, Plus, Search, SlidersHorizontal, Trash2, Undo2, X } from "lucide-react";
import { fieldValue, normalizeKeyword, SCHEMAS, uid } from "../domain";
import { encodeClipboard, parseBulkValue, previewPaste, validateBulkRows } from "../bulk-edit";
import { loadBulkDraft, saveBulkDraft, validBulkDraft } from "../bulk-draft";
import type { SavedBulkDraft } from "../bulk-draft";
import type { BulkCellChange, PastePreview } from "../bulk-edit";
import type { Collection, Field, Row, WorkspaceProps } from "../types";
import { formatDate, formatJalaliInput, jalaliFileDate, parseJalali } from "../dates";
import { downloadJson } from "../storage";
import { JalaliDateInput } from "./JalaliDateInput";
import { KeywordSuggestions } from "./KeywordSuggestions";
import "./bulk-edit-workspace.css";

const fa = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
const collections: { key: Collection; label: string }[] = [{ key: "keywords", label: "کلمات کلیدی" }, { key: "pages", label: "نقشه صفحات" }, { key: "content", label: "محتوا و تقویم" }, { key: "results", label: "نتایج" }];
const ROW_HEIGHT = 48;
const VISIBLE_ROWS = 24;
const labels: Record<string, string> = { Keep: "نگه‌داشتن", Review: "بررسی", Exclude: "کنارگذاشتن", "Not Started": "شروع نشده", "In Progress": "در حال انجام", Published: "منتشر شده", Complete: "تکمیل شده", Ready: "آماده", "Needs Review": "نیاز به بررسی", Existing: "موجود", New: "جدید", Unknown: "نامشخص", Research: "تحقیق", Writing: "نگارش", Editing: "ویرایش", "Brief Ready": "بریف آماده", Improving: "رو به رشد", Stable: "پایدار", Dropping: "افت عملکرد", "Needs Work": "نیاز به اصلاح", "Not Enough Data": "داده ناکافی" };
const text = (value: unknown) => String(value ?? "");
const fingerprint = (row: Row | undefined) => row ? JSON.stringify(Object.entries(row).filter(([, value]) => value !== undefined && value !== "").sort(([a], [b]) => a.localeCompare(b))) : "";
const savedRowsFingerprint = (rows: Row[]) => JSON.stringify(rows.map((row) => fingerprint({ ...row, createdAt: undefined, updatedAt: undefined })));
type Position = { row: number; col: number };
type SelectionRange = { start: Position; end: Position };
type Transaction = { patches: Map<string, Partial<Row>>; additions: Row[]; deleted: Set<string>; baselines: Map<string, Row> };
const emptyTransaction = (): Transaction => ({ patches: new Map(), additions: [], deleted: new Set(), baselines: new Map() });
function materialize(rows: Row[], tx: Transaction): Row[] {
  return [...rows, ...tx.additions].filter((r) => !tx.deleted.has(r.id)).map((r) => tx.patches.has(r.id) ? { ...r, ...tx.patches.get(r.id), id: r.id } : r);
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.focus();
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); }
      if (e.key === "Tab" && dialog) {
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]'));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (!first) { e.preventDefault(); dialog.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); before?.focus(); };
  }, []);
  return <div className="bulk-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="bulk-modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><header><h2>{title}</h2><button type="button" className="icon-button" aria-label="بستن" onClick={onClose}><X size={18}/></button></header>{children}</div></div>;
}

export function BulkEditWorkspace({ project, settings, onRowsChange, notify, readOnly: accessReadOnly = false, draftScope, canRecoverLegacyDraft = false }: WorkspaceProps & { readOnly?: boolean }) {
  const [collection, setCollection] = useState<Collection>("keywords");
  const [tx, setTx] = useState<Transaction>(emptyTransaction);
  const txRef = useRef(tx);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [filterField, setFilterField] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: "", desc: false });
  const [preset, setPreset] = useState("core");
  const [customColumns, setCustomColumns] = useState<string[]>([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [active, setActive] = useState<Position>({ row: 0, col: 0 });
  const [range, setRange] = useState<SelectionRange | null>(null);
  const [editing, setEditing] = useState<{ id: string; key: string; value: string } | null>(null);
  const [editError, setEditError] = useState("");
  const [bulkField, setBulkField] = useState(collection === "keywords" ? "group" : "");
  const [bulkValue, setBulkValue] = useState("");
  const [onlyBlank, setOnlyBlank] = useState(false);
  const [scope, setScope] = useState<"selected" | "filtered">("selected");
  const [start, setStart] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pastePlan, setPastePlan] = useState<PastePreview | null>(null);
  const [lastSave, setLastSave] = useState<{ before: Row[]; after: Row[] } | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [recovery, setRecovery] = useState<SavedBulkDraft | null>(null);
  const [draftError, setDraftError] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const readOnly = accessReadOnly || !draftReady || !!recovery;
  const persist = useRef<() => void>(() => {});
  const viewport = useRef<HTMLDivElement>(null);
  const bulkDateControl = useRef<HTMLDivElement>(null);
  const lastChecked = useRef(0);
  const focusAfter = useRef<Position | null>(null);
  const baseRows = project[collection];
  const rows = useMemo(() => materialize(baseRows, tx), [baseRows, tx]);
  const allFields = useMemo(() => SCHEMAS[collection].flatMap((section) => section.fields), [collection]);
  const editableFields = allFields.filter((field) => !field.calculated);
  const columns = useMemo(() => {
    const keys = preset === "custom" ? customColumns : (SCHEMAS[collection].find((s) => s.key === preset) || SCHEMAS[collection][0]).fields.map((f) => f.key);
    const first = collection === "keywords" ? "keyword" : collection === "pages" ? "target" : collection === "content" ? "topic" : "url";
    return [allFields.find((f) => f.key === first)!, ...allFields.filter((f) => keys.includes(f.key) && f.key !== first)].filter(Boolean);
  }, [collection, allFields, preset, customColumns]);
  const filtered = useMemo(() => {
    const term = normalizeKeyword(query);
    const found = rows.filter((row) => (!term || normalizeKeyword(Object.values(row).join(" ")).includes(term)) && (!filterField || !filterValue || String(row[filterField] ?? "") === filterValue));
    if (sort.key) {
      const field = allFields.find((f) => f.key === sort.key);
      const collator = new Intl.Collator("fa", { numeric: true, sensitivity: "base" });
      found.sort((a, b) => {
        const av = a[sort.key], bv = b[sort.key];
        const result = field?.type === "number" && av !== "" && bv !== "" && av !== undefined && bv !== undefined ? Number(av) - Number(bv) : collator.compare(text(av), text(bv));
        return sort.desc ? -result : result;
      });
    }
    return found;
  }, [rows, query, filterField, filterValue, sort, allFields]);
  const selectedIds = useMemo(() => new Set(rows.filter((row) => selected.has(row.id)).map((row) => row.id)), [rows, selected]);
  const targetIds = useMemo(() => scope === "filtered" ? new Set(filtered.map((r) => r.id)) : selectedIds, [scope, filtered, selectedIds]);
  const dirty = tx.patches.size > 0 || tx.additions.length > 0 || tx.deleted.size > 0;
  const field = editableFields.find((f) => f.key === bulkField) || editableFields[0];
  const filter = allFields.find((f) => f.key === filterField);
  const visible = filtered.slice(start, start + VISIBLE_ROWS);
  const allSelected = filtered.length > 0 && filtered.every((row) => selectedIds.has(row.id));
  const changedCells = Array.from(tx.patches.values()).reduce((total, patch) => total + Object.keys(patch).length, 0);
  const linkedDeleteCount = collection === "pages" ? project.keywords.filter((r) => targetIds.has(text(r.targetPage))).length
    + project.content.filter((r) => targetIds.has(text(r.targetPage))).length
    + project.results.filter((r) => targetIds.has(text(r.pageId))).length
    + (project.tasks || []).filter((r) => targetIds.has(text(r.pageId))).length
    + (project.links || []).filter((r) => targetIds.has(text(r.fromPageId)) || targetIds.has(text(r.toPageId))).length : 0;

  useEffect(() => {
    let live = true;
    setDraftReady(false); setRecovery(null); setDraftError(""); setDraftSaved(false);
    loadBulkDraft(project.id, collection, draftScope, canRecoverLegacyDraft && !accessReadOnly).then((saved) => {
      if (!live) return;
      if (saved && !validBulkDraft(saved, project.id, collection)) { setDraftError("پیش‌نویس قبلی قابل خواندن نیست؛ نسخه آن در حافظه حفظ شده است. پیش از تغییرات جدید از داده‌ها پشتیبان بگیرید."); }
      else if (saved) setRecovery(saved);
      setDraftReady(true);
    }).catch(() => { if (live) { setDraftReady(true); setDraftError("ذخیره خودکار پیش‌نویس در این مرورگر ممکن نیست؛ پیش از بستن، تغییرات را ثبت یا کپی کنید."); } });
    return () => { live = false; };
  }, [project.id, collection, draftScope, canRecoverLegacyDraft]);
  const createDraft = (): SavedBulkDraft => {
    const currentTx = txRef.current;
    const baselines = new Map(currentTx.baselines);
    const editedBase = editing && baseRows.find((r) => r.id === editing.id);
    if (editedBase && !baselines.has(editedBase.id)) baselines.set(editedBase.id, editedBase);
    return { version: 1, projectId: project.id, collection, savedAt: new Date().toISOString(), patches: [...currentTx.patches], additions: currentTx.additions, deleted: [...currentTx.deleted], baselines: [...baselines], editing };
  };
  persist.current = () => {
    if (!draftReady || recovery || draftError) return;
    const currentTx = txRef.current;
    const pending = currentTx.patches.size || currentTx.additions.length || currentTx.deleted.size || editing;
    if (accessReadOnly && !pending) return;
    void saveBulkDraft(project.id, collection, pending ? createDraft() : null, draftScope).then(() => setDraftSaved(!!pending)).catch(() => { setDraftError("ذخیره پیش‌نویس انجام نشد؛ فضای حافظه دستگاه را بررسی و تغییرات را پیش از بستن ثبت یا کپی کنید."); });
  };
  useEffect(() => {
    if (!draftReady || recovery || draftError) return;
    setDraftSaved(false);
    const timer = setTimeout(() => persist.current(), 250);
    return () => clearTimeout(timer);
  }, [tx, editing, draftReady, recovery, accessReadOnly, draftError]);
  useEffect(() => {
    const saveOnHide = () => { if (document.visibilityState === "hidden") persist.current(); };
    const saveNow = () => persist.current();
    window.addEventListener("pagehide", saveNow); window.addEventListener("offline", saveNow); window.addEventListener("seo:auth-expired", saveNow); document.addEventListener("visibilitychange", saveOnHide);
    return () => { saveNow(); window.removeEventListener("pagehide", saveNow); window.removeEventListener("offline", saveNow); window.removeEventListener("seo:auth-expired", saveNow); document.removeEventListener("visibilitychange", saveOnHide); };
  }, []);

  useEffect(() => {
    if (!dirty && !editing) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, editing]);
  useEffect(() => { setStart(0); if (viewport.current) viewport.current.scrollTop = 0; setRange(null); setActive({ row: 0, col: 0 }); }, [query, filterField, filterValue, sort.key, sort.desc, preset]);
  useEffect(() => {
    if (focusAfter.current) {
      const position = focusAfter.current;
      const handle = requestAnimationFrame(() => { viewport.current?.querySelector<HTMLElement>(`[data-cell="${position.row}:${position.col}"]`)?.focus(); focusAfter.current = null; });
      return () => cancelAnimationFrame(handle);
    }
  }, [start, editing, rows]);
  const push = (next: Transaction) => {
    if (readOnly) return;
    const before = txRef.current;
    txRef.current = next;
    setHistory((past) => [...past.slice(-19), before]); setTx(next); setLastSave(null); setEditError("");
  };
  const stage = (changes: BulkCellChange[]) => {
    if (readOnly || !changes.length) return;
    const currentTx = txRef.current;
    const next: Transaction = { ...currentTx, patches: new Map(currentTx.patches), baselines: new Map(currentTx.baselines) };
    const bases = new Map(baseRows.map((r) => [r.id, r]));
    changes.forEach(({ id, key, value }) => {
      const base = bases.get(id);
      if (base && !next.baselines.has(id)) next.baselines.set(id, base);
      const patch = { ...next.patches.get(id), [key]: value };
      if (base && String(base[key] ?? "") === String(value)) delete patch[key];
      if (Object.keys(patch).length) next.patches.set(id, patch); else next.patches.delete(id);
    });
    push(next);
  };
  const beginEdit = (row: Row, column: Field) => {
    if (readOnly || column.calculated) return;
    const currentTx = txRef.current;
    const base = baseRows.find((item) => item.id === row.id);
    if (base && !currentTx.patches.has(row.id) && !currentTx.deleted.has(row.id)) {
      txRef.current = { ...currentTx, baselines: new Map(currentTx.baselines).set(row.id, base) };
      setTx(txRef.current);
    }
    setEditing({ id: row.id, key: column.key, value: column.type === "date" ? formatJalaliInput(text(row[column.key]), false) : text(row[column.key]) }); setEditError("");
  };
  const focusCell = (position: Position, extend = false) => {
    const next = { row: Math.max(0, Math.min(filtered.length - 1, position.row)), col: Math.max(0, Math.min(columns.length - 1, position.col)) };
    setActive(next);
    setRange(extend ? { start: range?.start || active, end: next } : null);
    if (next.row < start || next.row >= start + VISIBLE_ROWS) {
      if (viewport.current) viewport.current.scrollTop = Math.max(0, next.row * ROW_HEIGHT - 2 * ROW_HEIGHT);
      setStart(Math.max(0, next.row - 2));
    }
    focusAfter.current = next;
    requestAnimationFrame(() => viewport.current?.querySelector<HTMLElement>(`[data-cell="${next.row}:${next.col}"]`)?.focus());
  };
  const finishEdit = (move?: Position) => {
    if (!editing) return true;
    const column = allFields.find((f) => f.key === editing.key)!;
    try {
      const baseline = txRef.current.baselines.get(editing.id);
      if (baseline && fingerprint(baseRows.find((row) => row.id === editing.id)) !== fingerprint(baseline)) {
        setEditError("این ردیف هنگام ویرایش تغییر کرده است؛ متن شما حفظ شد. آن را کپی کنید و آخرین نسخهٔ ردیف را دوباره باز کنید.");
        return false;
      }
      const value = parseBulkValue(column, editing.value, parseJalali);
      const row = rows.find((r) => r.id === editing.id);
      if (row && String(row[column.key] ?? "") !== String(value)) stage([{ id: row.id, key: column.key, value }]);
      setEditing(null); setEditError("");
      if (move) focusCell(move);
      return true;
    } catch (error) { setEditError((error as Error).message); return false; }
  };
  const activate = (position: Position, extend: boolean) => {
    if (!finishEdit()) return;
    setActive(position); setRange(extend ? { start: range?.start || active, end: position } : null);
  };
  const cellKeys = (event: KeyboardEvent<HTMLButtonElement>, row: Row, column: Field, position: Position) => {
    const arrows: Record<string, Position> = { ArrowDown: { ...position, row: position.row + 1 }, ArrowUp: { ...position, row: position.row - 1 }, ArrowLeft: { ...position, col: position.col + 1 }, ArrowRight: { ...position, col: position.col - 1 } };
    if (arrows[event.key]) { event.preventDefault(); focusCell(arrows[event.key], event.shiftKey); }
    if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); beginEdit(row, column); }
    if (event.key === "Tab") { event.preventDefault(); const next = position.col + (event.shiftKey ? -1 : 1); focusCell(next >= columns.length ? { row: position.row + 1, col: 0 } : next < 0 ? { row: position.row - 1, col: columns.length - 1 } : { ...position, col: next }); }
    if (event.key === "Escape") setRange(null);
    if (!readOnly && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !column.calculated) { event.preventDefault(); beginEdit(row, column); setEditing({ id: row.id, key: column.key, value: event.key }); }
  };
  const selectionRect = () => ({ top: Math.min(range?.start.row ?? active.row, range?.end.row ?? active.row), bottom: Math.max(range?.start.row ?? active.row, range?.end.row ?? active.row), left: Math.min(range?.start.col ?? active.col, range?.end.col ?? active.col), right: Math.max(range?.start.col ?? active.col, range?.end.col ?? active.col) });
  const editorDestination = (row: number, col: number, key: string, shift: boolean): Position => {
    if (key === "Enter") return { row: row + (shift ? -1 : 1), col };
    const next = col + (shift ? -1 : 1);
    return next >= columns.length ? { row: row + 1, col: 0 } : next < 0 ? { row: row - 1, col: columns.length - 1 } : { row, col: next };
  };
  const clipboardText = (selectedRows = false) => {
    const rect = selectionRect();
    const chosen = selectedRows ? rows.filter((row) => selectedIds.has(row.id)) : filtered.slice(rect.top, rect.bottom + 1);
    const fields = selectedRows ? columns : columns.slice(rect.left, rect.right + 1);
    return encodeClipboard(chosen.map((row) => ({ ...row, ...Object.fromEntries(fields.map((field) => [field.key, field.type === "date" ? formatJalaliInput(text(row[field.key]), false) : field.calculated ? fieldValue(row, field.key, settings) : row[field.key]])) })), fields);
  };
  const copy = async () => {
    const data = clipboardText(selectedIds.size > 0);
    if (!data) { notify("ابتدا یک خانه یا چند ردیف انتخاب کنید."); return; }
    try { await navigator.clipboard.writeText(data); notify("محدوده انتخابی کپی شد؛ در Excel یا Google Sheets بچسبانید."); }
    catch { setPasteText(data); setPastePlan(null); setPasteOpen(true); notify("مرورگر اجازه کپی نداد؛ متن را از کادر انتخاب و کپی کنید."); }
  };
  const preparePaste = (value: string) => {
    if (readOnly || !filtered.length) return;
    setPasteText(value); setPasteOpen(true);
    try { setPastePlan(previewPaste(value, filtered, columns, active.row, active.col, parseJalali)); }
    catch (error) { setPastePlan({ changes: [], errors: [(error as Error).message], rows: 0, columns: 0 }); }
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (readOnly || editing) return;
    event.preventDefault(); preparePaste(event.clipboardData.getData("text/plain"));
  };
  const applyBulk = () => {
    if (readOnly || !targetIds.size || !field || !finishEdit()) return;
    if (field.type === "date" && bulkDateControl.current?.querySelector<HTMLInputElement>("input")?.reportValidity() === false) return;
    try {
      const value = parseBulkValue(field, bulkValue, parseJalali);
      stage(materialize(baseRows, txRef.current).filter((r) => targetIds.has(r.id) && (!onlyBlank || !text(r[field.key]).trim()) && text(r[field.key]) !== String(value)).map((row) => ({ id: row.id, key: field.key, value })));
      notify(`تغییر ${field.label} در پیش‌نویس آماده شد؛ برای ثبت نهایی «ذخیره تغییرات» را بزنید.`);
    } catch (error) { notify((error as Error).message); }
  };
  const fillDown = () => {
    if (readOnly || !finishEdit()) return;
    const rect = selectionRect();
    const latestRows = new Map(materialize(baseRows, txRef.current).map((row) => [row.id, row]));
    const latestFiltered = filtered.map((row) => latestRows.get(row.id) || row);
    const selectedRows = latestFiltered.filter((row) => selectedIds.has(row.id));
    const targets = range ? latestFiltered.slice(rect.top, rect.bottom + 1) : selectedRows;
    const fields = range ? columns.slice(rect.left, rect.right + 1) : [columns[active.col]];
    if (targets.length < 2) { notify("حداقل دو ردیف یا یک محدوده چندردیفی انتخاب کنید؛ مقدار ردیف اول به پایین کپی می‌شود."); return; }
    const changes: BulkCellChange[] = [];
    try {
      fields.filter((column) => column && !column.calculated).forEach((column) => {
        const raw = column.type === "date" ? formatJalaliInput(text(targets[0][column.key]), false) : text(targets[0][column.key]);
        const value = parseBulkValue(column, raw, parseJalali);
        targets.slice(1).filter((row) => text(row[column.key]) !== String(value)).forEach((row) => changes.push({ id: row.id, key: column.key, value }));
      });
      stage(changes); notify("مقدار ردیف اول به ردیف‌های پایین در پیش‌نویس کپی شد.");
    } catch (error) { notify((error as Error).message); }
  };
  const save = () => {
    if (readOnly || !finishEdit()) return;
    const transaction = txRef.current;
    const finalRows = materialize(baseRows, transaction);
    const current = new Map(baseRows.map((row) => [row.id, row]));
    for (const [id, baseline] of transaction.baselines) {
      if (!transaction.patches.has(id) && !transaction.deleted.has(id)) continue;
      if (fingerprint(current.get(id)) !== fingerprint(baseline)) { notify("این ردیف در نسخه دیگری تغییر کرده است؛ پیش‌نویس را کپی کنید و دوباره با داده جدید ویرایش کنید."); return; }
    }
    const edited = new Set([...transaction.patches.keys(), ...transaction.additions.map((r) => r.id)]);
    const error = validateBulkRows(collection, finalRows, edited, project.pages);
    if (error) { notify(error); setReviewOpen(false); return; }
    const before = baseRows, after = finalRows;
    let accepted = false;
    try { accepted = onRowsChange(collection, after) !== false; }
    catch (error) { setEditError(error instanceof Error ? error.message : "ثبت تغییرات انجام نشد؛ پیش‌نویس حفظ شده است."); notify(error instanceof Error ? error.message : "ثبت تغییرات انجام نشد؛ پیش‌نویس حفظ شده است."); persist.current(); return; }
    if (!accepted) {
      const message = "ثبت تغییرات انجام نشد؛ پیش‌نویس جدول حفظ شده است. مشکل ذخیره را برطرف کنید و دوباره ثبت کنید.";
      setEditError(message); notify(message); persist.current(); return;
    }
    txRef.current = emptyTransaction();
    setTx(txRef.current); setHistory([]); setReviewOpen(false); setEditError(""); setLastSave({ before, after });
    notify("تغییرات گروهی ذخیره شد.");
  };
  const switchCollection = (next: Collection) => {
    if (next === collection) return;
    if ((dirty || editing) && !window.confirm("پیش‌نویس این جدول هنوز ذخیره نشده است. بدون ذخیره به جدول دیگر بروید؟")) return;
    if (dirty || editing) void saveBulkDraft(project.id, collection, null, draftScope).catch(() => {});
    txRef.current = emptyTransaction();
    setCollection(next); setTx(txRef.current); setHistory([]); setSelected(new Set()); setQuery(""); setFilterField(""); setFilterValue(""); setSort({ key: "", desc: false }); setPreset("core"); setCustomColumns([]); setBulkField(next === "keywords" ? "group" : next === "pages" ? "status" : next === "content" ? "writingStatus" : "result"); setBulkValue(""); setEditing(null); setLastSave(null); setStart(0); setRange(null); setActive({ row: 0, col: 0 });
    if (viewport.current) viewport.current.scrollTop = 0;
  };
  const toggleRow = (id: string, index: number, shift: boolean) => {
    setSelected((previous) => { const next = new Set(previous); const checked = !previous.has(id); const from = shift ? Math.min(index, lastChecked.current) : index, to = shift ? Math.max(index, lastChecked.current) : index; filtered.slice(from, to + 1).forEach((row) => checked ? next.add(row.id) : next.delete(row.id)); return next; }); lastChecked.current = index;
  };
  const add = () => {
    if (readOnly || !finishEdit()) return;
    const limit = collection === "keywords" ? 20000 : 2000;
    if (rows.length >= limit) { notify(`سقف ${fa.format(limit)} ردیف برای این جدول پر شده است.`); return; }
    const row: Row = collection === "keywords" ? { id: uid(), keyword: "", decision: "Review" } : collection === "pages" ? { id: uid(), target: "", status: "Not Started" } : collection === "content" ? { id: uid(), topic: "", writingStatus: "Not Started" } : { id: uid(), url: "" };
    push({ ...txRef.current, additions: [...txRef.current.additions, row] }); setQuery(""); setFilterField(""); setFilterValue(""); setSort({ key: "", desc: false });
    setTimeout(() => { if (viewport.current) viewport.current.scrollTop = rows.length * ROW_HEIGHT; setStart(Math.max(0, rows.length - VISIBLE_ROWS + 1)); setActive({ row: rows.length, col: 0 }); beginEdit(row, columns[0]); }, 0);
  };
  const renderValue = (row: Row, column: Field) => {
    const value = column.calculated ? fieldValue(row, column.key, settings) : row[column.key];
    if (column.type === "date") return formatDate(text(value));
    if ((["keywords", "content"].includes(collection) && column.key === "targetPage") || (collection === "results" && column.key === "pageId")) { const page = project.pages.find((p) => p.id === value); return page ? text(page.target || page.pkw || page.pageId) : value ? "صفحه حذف‌شده / نامشخص" : "—"; }
    if (column.type === "number" && value !== "" && value !== undefined && Number.isFinite(Number(value))) return fa.format(Number(value));
    return labels[text(value)] || text(value) || "—";
  };
  const recover = () => {
    if (!recovery || accessReadOnly) return;
    const restored: Transaction = { patches: new Map(recovery.patches), additions: recovery.additions, deleted: new Set(recovery.deleted), baselines: new Map(recovery.baselines) };
    txRef.current = restored; setTx(restored); setHistory([]); setEditing(recovery.editing); setRecovery(null); setDraftSaved(true);
    const editingIndex = recovery.editing ? materialize(baseRows, restored).findIndex((row) => row.id === recovery.editing!.id) : -1;
    if (editingIndex >= 0) { setStart(Math.max(0, editingIndex - 2)); setActive({ row: editingIndex, col: Math.max(0, columns.findIndex((column) => column.key === recovery.editing!.key)) }); }
    notify("پیش‌نویس بازیابی شد؛ تغییرات را بررسی و سپس ثبت کنید.");
  };
  const referenceOptions = (column: Field) => (((collection === "content" || collection === "keywords") && column.key === "targetPage") || (collection === "results" && column.key === "pageId")) ? project.pages.map((p) => ({ value: p.id, label: text(p.target || p.pkw || p.pageId) })) : null;

  return <section className="bulk-workspace" data-unsaved={dirty || editing ? "true" : "false"}>
    <div className="workspace-heading"><div><div className="eyebrow">WORKSPACE · تغییر گروهی</div><h1>تغییر گروهی</h1><p>تمام داده‌ها در یک جدول؛ انتخاب، چسباندن و ویرایش هزاران ردیف با یک بار ذخیره.</p></div><div className="action-row"><button className="btn btn-secondary" onClick={copy}><Copy size={15}/>کپی محدوده</button><button className="btn btn-primary" onClick={add} disabled={readOnly}><Plus size={16}/>ردیف جدید</button></div></div>
    <nav className="bulk-tabs" aria-label="جدول تغییر گروهی">{collections.map((item) => <button key={item.key} className={collection === item.key ? "active" : ""} onClick={() => switchCollection(item.key)} aria-pressed={collection === item.key}>{item.label}<span>{fa.format(project[item.key].length)}</span></button>)}</nav>
    {draftError && <div className="bulk-error" role="alert">{draftError}</div>}
    {recovery && <div className="bulk-recovery" role="status"><div><strong>یک پیش‌نویس ذخیره‌نشده از قبل باقی مانده است.</strong><p>آخرین ذخیره محلی: {formatDate(recovery.savedAt)} · تغییرات پیش از ثبت نهایی بررسی می‌شوند.</p></div><div><button className="btn btn-secondary" onClick={() => downloadJson(recovery, `SEO-draft-${jalaliFileDate()}.json`)}>دانلود پیش‌نویس</button><button className="btn btn-ghost" disabled={accessReadOnly} onClick={() => { if (window.confirm("پیش‌نویس قبلی از این دستگاه حذف شود؟ برای حفظ نسخه، ابتدا آن را دانلود کنید.")) { void saveBulkDraft(project.id, collection, null, draftScope).then(() => setRecovery(null)).catch(() => notify("حذف پیش‌نویس انجام نشد.")); } }}>کنارگذاشتن</button><button className="btn btn-primary" onClick={recover} disabled={accessReadOnly}>بازیابی پیش‌نویس</button></div></div>}
    <div className="bulk-card">
      <div className="bulk-toolbar"><label className="bulk-search"><Search size={17}/><input value={query} aria-label="جستجو در همه ردیف‌ها" placeholder="جستجو در تمام ردیف‌ها و یادداشت‌ها..." onChange={(e) => { if (finishEdit()) setQuery(e.target.value); }}/></label><div className="bulk-toolbar-controls"><select aria-label="ستون فیلتر" value={filterField} onChange={(e) => { if (finishEdit()) { setFilterField(e.target.value); setFilterValue(""); } }}><option value="">همه ردیف‌ها</option>{editableFields.filter((f) => f.type === "select" || f.key === "group" || f.key === "owner").map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>{filterField && <select aria-label="مقدار فیلتر" value={filterValue} onChange={(e) => { if (finishEdit()) setFilterValue(e.target.value); }}><option value="">همه مقدارها</option>{(filter?.options || [...new Set(rows.map((r) => text(r[filterField])).filter(Boolean))].sort()).map((value) => <option key={value} value={value}>{labels[value] || value}</option>)}</select>}<select value={preset} aria-label="نمای ستون‌ها" onChange={(e) => { if (finishEdit()) setPreset(e.target.value); }}><option value="core">ستون‌های اصلی</option>{SCHEMAS[collection].filter((section) => section.key !== "core").map((section) => <option value={section.key} key={section.key}>{section.label}</option>)}<option value="custom">ستون‌های دلخواه</option></select><button className="btn btn-ghost" onClick={() => setColumnsOpen(true)} title="انتخاب ستون‌ها" aria-label="انتخاب ستون‌ها"><Columns3 size={17}/></button></div></div>
      <div className="bulk-change-bar"><div className="bulk-scope"><SlidersHorizontal size={16}/><select aria-label="محدوده تغییر گروهی" value={scope} onChange={(e) => setScope(e.target.value as "selected" | "filtered")}><option value="selected">انتخاب‌شده‌ها ({fa.format(selectedIds.size)})</option><option value="filtered">همه نتایج جستجو ({fa.format(filtered.length)})</option></select></div><select aria-label="فیلد تغییر گروهی" value={field?.key || ""} onChange={(e) => { setBulkField(e.target.value); setBulkValue(""); }}>{editableFields.map((column) => <option key={column.key} value={column.key}>{settings.customLabels?.[column.key] || column.label}</option>)}</select>{field?.type === "date" ? <div ref={bulkDateControl}><JalaliDateInput key={field.key} value={parseJalali(bulkValue) || ""} onChange={(iso) => setBulkValue(formatJalaliInput(iso, false))} aria-label="مقدار تغییر گروهی"/></div> : field?.options || (field && referenceOptions(field)) ? <select aria-label="مقدار تغییر گروهی" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}><option value="">پاک‌کردن مقدار</option>{field.options ? field.options.map((value) => <option key={value} value={value}>{labels[value] || value}</option>) : referenceOptions(field)!.map((value) => <option key={value.value} value={value.value}>{value.label}</option>)}</select> : <input aria-label="مقدار تغییر گروهی" placeholder="مقدار جدید؛ خالی برای پاک‌کردن" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}/>}<label className="bulk-blank"><input type="checkbox" checked={onlyBlank} onChange={(e) => setOnlyBlank(e.target.checked)}/>فقط خانه‌های خالی</label><button className="btn btn-secondary" onClick={applyBulk} disabled={readOnly || !targetIds.size}>اعمال روی {fa.format(targetIds.size)} ردیف</button><button className="icon-button bulk-delete" title="حذف ردیف‌های محدوده" aria-label="حذف ردیف‌های محدوده" onClick={() => { if (finishEdit()) setDeleteOpen(true); }} disabled={readOnly || !targetIds.size}><Trash2 size={17}/></button></div>
      <div className="bulk-grid-meta"><span><strong>{fa.format(filtered.length)}</strong> ردیف از {fa.format(rows.length)} · {fa.format(selectedIds.size)} انتخاب‌شده{selectedIds.size > 0 && <button className="bulk-text-link" onClick={() => setSelected(new Set())}>لغو انتخاب</button>}</span><div><button className="bulk-text-link" onClick={() => setSelected(new Set(filtered.map((row) => row.id)))}>انتخاب همه {fa.format(filtered.length)} ردیف</button><button className="bulk-text-link" onClick={fillDown} disabled={readOnly}><ArrowDownToLine size={14}/>پرکردن به پایین</button><button className="bulk-text-link" onClick={() => { if (finishEdit()) { setPasteText(""); setPastePlan(null); setPasteOpen(true); } }} disabled={readOnly || !filtered.length}><FileSpreadsheet size={14}/>چسباندن از شیت</button>{collection === "keywords" && <KeywordSuggestions disabled={readOnly} applyLabel="افزودن به پیش‌نویس جدول" project={{ ...project, keywords: rows }} settings={settings} selectedIds={selectedIds} notify={notify} onRowsChange={(key, updated) => { if (readOnly || key !== "keywords") return false; const byId = new Map(rows.map((row) => [row.id, row])); const changes: BulkCellChange[] = []; updated.forEach((row) => { const old = byId.get(row.id); if (!old) return; Object.entries(row).forEach(([key, value]) => { if (key !== "id" && text(old[key]) !== text(value)) changes.push({ id: row.id, key, value: value ?? "" }); }); }); stage(changes); return true; }}/>}</div></div>
      {editError && <div role="alert" className="bulk-error">{editError}</div>}
      <div className="bulk-grid-scroll" ref={viewport} onScroll={(e) => { const top = Math.max(0, Math.floor((e.currentTarget.scrollTop - 42) / ROW_HEIGHT) - 3); setStart(Math.min(top, Math.max(0, filtered.length - 1))); }} onPaste={onPaste} onCopy={(e) => { if (editing) return; e.preventDefault(); e.clipboardData.setData("text/plain", clipboardText()); }}>
        <table className="bulk-grid" style={{ minWidth: 88 + columns.reduce((total, column) => total + (column.type === "textarea" || ["keyword", "target", "topic"].includes(column.key) ? 225 : 150), 0) }} role="grid" aria-label="جدول ویرایش گروهی" aria-rowcount={filtered.length + 1} aria-colcount={columns.length + 2}><thead><tr><th className="bulk-check-cell"><input type="checkbox" aria-label="انتخاب تمام نتایج جدول" checked={allSelected} onChange={() => setSelected((previous) => { const next = new Set(previous); filtered.forEach((row) => allSelected ? next.delete(row.id) : next.add(row.id)); return next; })}/></th><th className="bulk-number-cell">#</th>{columns.map((column) => <th key={column.key} style={{ width: column.type === "textarea" || column.key === "keyword" || column.key === "target" || column.key === "topic" ? 225 : 150 }}><button onClick={() => { if (finishEdit()) setSort({ key: column.key, desc: sort.key === column.key ? !sort.desc : false }); }}>{settings.customLabels?.[column.key] || column.label}{sort.key === column.key && <span>{sort.desc ? "↓" : "↑"}</span>}{column.calculated && <small>خودکار</small>}</button></th>)}</tr></thead><tbody>{start > 0 && <tr className="bulk-spacer" aria-hidden="true"><td colSpan={columns.length + 2} style={{ height: start * ROW_HEIGHT }}/></tr>}{visible.map((row, offset) => { const index = start + offset, rect = selectionRect(); return <tr key={row.id} aria-rowindex={index + 2} className={selectedIds.has(row.id) ? "bulk-row-selected" : ""}><td className="bulk-check-cell"><input type="checkbox" aria-label={`انتخاب ردیف ${index + 1}`} checked={selectedIds.has(row.id)} onClick={(e) => toggleRow(row.id, index, e.shiftKey)} onChange={() => {}}/></td><td className="bulk-number-cell">{fa.format(index + 1)}</td>{columns.map((column, col) => { const isEditing = editing?.id === row.id && editing.key === column.key; const inRange = index >= rect.top && index <= rect.bottom && col >= rect.left && col <= rect.right; const changed = Object.prototype.hasOwnProperty.call(tx.patches.get(row.id) || {}, column.key); const refs = referenceOptions(column); return <td key={column.key} className={`${inRange ? "bulk-cell-selected" : ""} ${changed ? "bulk-cell-changed" : ""} ${column.calculated ? "bulk-cell-calculated" : ""}`} data-field={column.key}>{isEditing ? <div className="bulk-cell-editor">{column.options || refs ? <select autoFocus aria-label={column.label} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onBlur={() => finishEdit()} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(null); setEditError(""); focusCell({ row: index, col }); } if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); finishEdit(editorDestination(index, col, e.key, e.shiftKey)); } }}><option value="">—</option>{column.options ? column.options.map((value) => <option key={value} value={value}>{labels[value] || value}</option>) : refs!.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <textarea autoFocus rows={1} value={editing.value} aria-label={column.label} placeholder={column.type === "date" ? "۱۴۰۵/۰۷/۱۵" : undefined} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onBlur={() => finishEdit()} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(null); setEditError(""); focusCell({ row: index, col }); } if ((e.key === "Enter" && !e.altKey) || e.key === "Tab") { e.preventDefault(); finishEdit(editorDestination(index, col, e.key, e.shiftKey)); } }}/>}</div> : <button className="bulk-cell-value" data-cell={`${index}:${col}`} tabIndex={active.row === index && active.col === col ? 0 : -1} title={`${renderValue(row, column)}${column.calculated ? " (محاسباتی)" : " — دوبار کلیک برای ویرایش"}`} onClick={(e) => activate({ row: index, col }, e.shiftKey)} onDoubleClick={() => beginEdit(row, column)} onKeyDown={(e) => cellKeys(e, row, column, { row: index, col })}>{renderValue(row, column)}</button>}</td>; })}</tr>; })}{Math.max(0, filtered.length - start - VISIBLE_ROWS) > 0 && <tr className="bulk-spacer" aria-hidden="true"><td colSpan={columns.length + 2} style={{ height: Math.max(0, filtered.length - start - VISIBLE_ROWS) * ROW_HEIGHT }}/></tr>}</tbody></table>{!filtered.length && <div className="bulk-empty"><FileSpreadsheet size={28}/><h3>{rows.length ? "نتیجه‌ای پیدا نشد" : "جدول آماده ویرایش است"}</h3><p>{rows.length ? "جستجو یا فیلتر را تغییر دهید." : "یک ردیف بسازید یا داده‌ها را از بخش ورود داده وارد کنید."}</p></div>}
      </div>
      <div className="bulk-footer"><span>دوبار کلیک یا Enter: ویرایش · جهت‌ها: حرکت · Shift: انتخاب محدوده · Ctrl+V: چسباندن · Alt+Enter: خط جدید</span><span>نمایش مجازی؛ تمام {fa.format(filtered.length)} ردیف قابل انتخاب است.</span></div>
    </div>
    <div className={`bulk-save-bar ${dirty ? "bulk-save-pending" : ""}`} aria-live="polite"><div><Check size={18}/>{dirty ? <span><strong>{fa.format(changedCells)}</strong> خانه ویرایش‌شده · {fa.format(tx.additions.length)} ردیف جدید · {fa.format(tx.deleted.size)} حذف در پیش‌نویس{draftSaved && <small className="bulk-draft-saved"> · پیش‌نویس روی این دستگاه محفوظ است</small>}</span> : <span>همه تغییرات ذخیره شده‌اند.</span>}</div><div><button className="btn btn-ghost" onClick={() => { if (!history.length || readOnly) return; txRef.current = history[history.length - 1]; setTx(txRef.current); setHistory(history.slice(0, -1)); setEditing(null); }} disabled={readOnly || !history.length}><Undo2 size={15}/>واگرد</button>{lastSave && !dirty && <button className="btn btn-ghost" onClick={() => { if (readOnly) return; if (savedRowsFingerprint(project[collection]) !== savedRowsFingerprint(lastSave.after)) { notify("داده‌ها پس از ذخیره تغییر کرده‌اند؛ بازگردانی مستقیم ایمن نیست."); return; } if (onRowsChange(collection, lastSave.before) === false) { notify("بازگردانی ثبت نشد؛ امکان بازگردانی ذخیره اخیر حفظ شده است."); return; } setLastSave(null); notify("ذخیره اخیر بازگردانده شد."); }}>بازگردانی ذخیره اخیر</button>}<button className="btn btn-ghost" disabled={readOnly || (!dirty && !editing)} onClick={() => { if (window.confirm("تمام تغییرات ذخیره‌نشده این جدول کنار گذاشته شود؟")) { txRef.current = emptyTransaction(); setTx(txRef.current); setHistory([]); setEditing(null); setEditError(""); } }}>کنارگذاشتن پیش‌نویس</button><button className="btn btn-primary" disabled={readOnly || (!dirty && !editing)} onClick={() => { if (finishEdit()) setReviewOpen(true); }}><Check size={16}/>ذخیره تغییرات</button></div></div>
    {columnsOpen && <Modal title="ستون‌های دلخواه" onClose={() => setColumnsOpen(false)}><p>فقط ستون‌هایی را نشان دهید که الان با آن‌ها کار دارید. ستون اصلی همیشه دیده می‌شود.</p><div className="bulk-column-picker">{SCHEMAS[collection].map((section) => <fieldset key={section.key}><legend>{section.label}</legend>{section.fields.map((column) => <label key={column.key}><input type="checkbox" checked={(preset === "custom" ? customColumns : columns.map((c) => c.key)).includes(column.key)} onChange={(e) => { const base = preset === "custom" ? customColumns : columns.map((c) => c.key); setCustomColumns(e.target.checked ? [...new Set([...base, column.key])] : base.filter((key) => key !== column.key)); setPreset("custom"); }}/>{settings.customLabels?.[column.key] || column.label}{column.calculated && <small>محاسباتی</small>}</label>)}</fieldset>)}</div><footer><button className="btn btn-primary" onClick={() => setColumnsOpen(false)}>نمایش جدول</button></footer></Modal>}
    {pasteOpen && <Modal title="چسباندن از Excel یا Google Sheets" onClose={() => setPasteOpen(false)}><p>خانه‌های جدول مبدا را کپی و اینجا بچسبانید. شروع: ردیف {fa.format(active.row + 1)}، ستون «{columns[active.col]?.label}». ترتیب ستون‌ها مطابق جدول فعلی است؛ عنوان ستون‌ها را کپی نکنید.</p><textarea className="bulk-paste-text" aria-label="داده‌های کپی‌شده از شیت" value={pasteText} onChange={(e) => { setPasteText(e.target.value); setPastePlan(null); }} placeholder="محتوای خانه‌ها را اینجا بچسبانید..."/>{pastePlan && <div className="bulk-paste-preview" aria-live="polite"><strong>{fa.format(pastePlan.rows)} ردیف × {fa.format(pastePlan.columns)} ستون · {fa.format(pastePlan.changes.length)} تغییر</strong>{pastePlan.errors.length ? <div role="alert" className="bulk-error">{pastePlan.errors.map((error, i) => <p key={i}>{error}</p>)}<p>تا اصلاح خطاها هیچ تغییری اعمال نمی‌شود.</p></div> : <ul>{pastePlan.changes.slice(0, 8).map((change, i) => <li key={i}>{allFields.find((f) => f.key === change.key)?.label}: <b>{allFields.find((f) => f.key === change.key)?.type === "date" ? formatDate(String(change.value)) : String(change.value) || "پاک‌کردن"}</b></li>)}{pastePlan.changes.length > 8 && <li>و {fa.format(pastePlan.changes.length - 8)} تغییر دیگر</li>}</ul>}</div>}<footer><button className="btn btn-secondary" onClick={() => preparePaste(pasteText)} disabled={!pasteText}>بررسی پیش‌نمایش</button><button className="btn btn-primary" disabled={readOnly || !pastePlan?.changes.length || !!pastePlan.errors.length} onClick={() => { if (pastePlan && !pastePlan.errors.length) { stage(pastePlan.changes); setPasteOpen(false); notify("داده‌ها به پیش‌نویس اضافه شدند؛ برای ثبت نهایی ذخیره کنید."); } }}>افزودن به پیش‌نویس</button></footer></Modal>}
    {deleteOpen && <Modal title={`حذف ${fa.format(targetIds.size)} ردیف`} onClose={() => setDeleteOpen(false)}><p>این ردیف‌ها از محدوده «{scope === "selected" ? "انتخاب‌شده‌ها" : "همه نتایج جستجو"}» حذف خواهند شد. تا ذخیره نهایی می‌توانید حذف را واگرد کنید.</p>{linkedDeleteCount > 0 && <div className="bulk-error">{fa.format(linkedDeleteCount)} رکورد مرتبط به این صفحات ارتباط دارد. خود رکوردهای مرتبط حفظ می‌شوند و ارجاعشان نیاز به اصلاح خواهد داشت.</div>}<footer><button className="btn btn-secondary" onClick={() => setDeleteOpen(false)}>انصراف</button><button className="btn btn-danger" disabled={readOnly} onClick={() => { const currentTx = txRef.current; const next = { ...currentTx, deleted: new Set([...currentTx.deleted, ...targetIds]), baselines: new Map(currentTx.baselines) }; baseRows.filter((r) => targetIds.has(r.id)).forEach((r) => next.baselines.set(r.id, currentTx.baselines.get(r.id) || r)); push(next); setSelected(new Set()); setDeleteOpen(false); }}>حذف از پیش‌نویس</button></footer></Modal>}
    {reviewOpen && <Modal title="ثبت تغییرات گروهی" onClose={() => setReviewOpen(false)}><p>تمام تغییرات این جدول با یک بار ذخیره ثبت می‌شوند.</p><div className="bulk-review-counts"><div><strong>{fa.format(tx.patches.size)}</strong><span>ردیف ویرایش‌شده</span></div><div><strong>{fa.format(tx.additions.length)}</strong><span>ردیف جدید</span></div><div><strong>{fa.format(tx.deleted.size)}</strong><span>ردیف حذف‌شده</span></div></div><p className="bulk-review-fields">ستون‌های تغییرکرده: {[...new Set([...tx.patches.values()].flatMap((patch) => Object.keys(patch)))].map((key) => allFields.find((f) => f.key === key)?.label || key).join("، ") || "—"}</p><footer><button className="btn btn-secondary" onClick={() => setReviewOpen(false)}>ادامه ویرایش</button><button className="btn btn-primary" onClick={save} disabled={readOnly}><ArrowDownToLine size={16}/>ثبت نهایی</button></footer></Modal>}
  </section>;
}
