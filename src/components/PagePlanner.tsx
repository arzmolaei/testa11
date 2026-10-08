import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, FileText, Layers3, Merge, Redo2, RefreshCw, Search, ShieldCheck, Sparkles, Split, Undo2, X } from "lucide-react";
import { LISTS, uid } from "../domain";
import { formatDate, jalaliFileDate } from "../dates";
import { analyzePageCandidates, buildPagePlan } from "../page-intelligence";
import type { PageCandidate } from "../page-intelligence";
import { assessPageOpportunities, keywordMetric, type PageOpportunity } from "../page-opportunities";
import type { Project, Row } from "../types";
import "./PagePlanner.css";

type Props = {
  project: Project;
  onProjectChange: (project: Project) => boolean | void;
  notify: (message: string) => void;
  readOnly?: boolean;
  draftScope?: string;
  canRecoverLegacyDraft?: boolean;
  onNavigate?: (view: "pages" | "content", rowId?: string) => void;
};
type Selection = { candidateId: string; label?: string; primaryKeyword?: string; pageType?: string; targetPageId?: string; excluded?: boolean; priority?: string };
type Modal = { kind: "keywords"; id: string } | { kind: "target"; id: string } | { kind: "merge" } | { kind: "confirm" } | null;
type PlanSnapshot = { candidates: PageCandidate[]; choices: Record<string, Selection>; selected: Set<string>; createBriefs: boolean; source: string; dirty: boolean };
type SavedPlan = { version: 1; projectId: string; source: string; candidates: PageCandidate[]; choices: Record<string, Selection>; selected: string[]; createBriefs: boolean };
const pendingDrafts = new Map<string, Promise<unknown>>();
const draftKey = (projectId: string, scope: string) => JSON.stringify([scope, projectId]);
function openDrafts(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("seo-page-plans-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("حافظهٔ پیش‌نویس در دسترس نیست."));
  });
}
async function readDraft(key: string, projectId: string, recoverLegacy = false): Promise<SavedPlan | null> {
  const legacyProjectId = recoverLegacy ? projectId : undefined;
  await pendingDrafts.get(key)?.catch(() => {});
  const db = await openDrafts();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", legacyProjectId ? "readwrite" : "readonly");
    const store = tx.objectStore("drafts");
    let saved: SavedPlan | null = null;
    const request = store.get(key);
    request.onsuccess = () => {
      saved = request.result ?? null;
      if (saved && !validDraft(saved, projectId)) { reject(new Error("پیش‌نویس قبلی معتبر نیست و در دستگاه حفظ شده است.")); return; }
      if (saved || !legacyProjectId) return;
      const legacy = store.get(legacyProjectId);
      legacy.onsuccess = () => {
        if (!validDraft(legacy.result, legacyProjectId)) return;
        saved = legacy.result;
        store.put(saved, key); store.delete(legacyProjectId);
      };
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(saved);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
function writeDraft(key: string, draft: SavedPlan | null): Promise<void> {
  const snapshot = draft === null ? null : structuredClone(draft);
  const operation = (pendingDrafts.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const db = await openDrafts();
    try { await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite"), store = transaction.objectStore("drafts");
      if (snapshot) store.put(snapshot, key); else store.delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    }); } finally { db.close(); }
  });
  pendingDrafts.set(key, operation);
  operation.finally(() => { if (pendingDrafts.get(key) === operation) pendingDrafts.delete(key); }).catch(() => {});
  return operation;
}
function validDraft(value: unknown, projectId: string): value is SavedPlan {
  if (!value || typeof value !== "object") return false;
  const draft = value as SavedPlan;
  if (draft.version !== 1 || draft.projectId !== projectId || typeof draft.source !== "string" || typeof draft.createBriefs !== "boolean" || !Array.isArray(draft.candidates) || draft.candidates.length > 20000 || !Array.isArray(draft.selected) || draft.selected.length > 20000 || !draft.choices || typeof draft.choices !== "object") return false;
  const validString = (input: unknown) => typeof input === "string" && input.length <= 20000;
  if (!draft.selected.every(validString) || !Object.values(draft.choices).every((choice) => choice && typeof choice === "object" && Object.values(choice).every((part) => typeof part === "boolean" || validString(part)))) return false;
  return draft.candidates.every((candidate) => candidate && [candidate.id, candidate.label, candidate.primaryKeyword, candidate.pageType, candidate.intent].every(validString) && ["strong", "review"].includes(candidate.confidence) && typeof candidate.manual === "boolean" && [candidate.keywordIds, candidate.existingPageIds, candidate.reasons].every((items) => Array.isArray(items) && items.length <= 20000 && items.every(validString)));
}
const PAGE_SIZE = 60;
const MOBILE_PAGE_SIZE = 10;
const MOBILE_QUERY = "(max-width: 680px)";
const KEYWORD_PAGE_SIZE = 50;
const number = (value: number) => value.toLocaleString("fa-IR");
const text = (value: unknown) => String(value ?? "");
const normalize = (value: unknown) => text(value).toLocaleLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[\u200c\u200d]/g, " ").replace(/\s+/g, " ").trim();
const pageTypeLabel = (value: string) => value === "Needs Review" ? "نیاز به بررسی" : value === "Other" ? "سایر" : value;
const isArticle = (value: string) => ["مقاله", "راهنمای خرید", "مقایسه", "FAQ"].includes(value);

function exportPlan(candidates: PageCandidate[], selections: Record<string, Selection>, keywords: Map<string, Row>, selected: Set<string>, projectName: string, opportunities: Map<string, PageOpportunity>) {
  const escape = (value: unknown) => {
    let raw = text(value);
    if (/^[\t\r\n ]*[=+@-]/.test(raw)) raw = `'${raw}`;
    return `"${raw.replace(/"/g, '""')}"`;
  };
  const lines = [["پیشنهاد", "انتخاب‌شده", "نوع صفحه", "کلمه اصلی", "کلمات مرتبط", "نیت", "وضعیت بررسی", "دلیل", "شناسه صفحه انتخابی", "وضعیت پوشش", "حجم ثبت‌شده", "سختی ثبت‌شده", "کلمات بدون هدف", "اولویت برنامه", "کلیک فایل", "نمایش فایل", "شروع دوره", "پایان دوره"]];
  for (const candidate of candidates) {
    const choice = selections[candidate.id], evidence = opportunities.get(candidate.id)!;
    lines.push([choice?.label ?? candidate.label, selected.has(candidate.id) ? "بله" : "خیر", pageTypeLabel(choice?.pageType ?? candidate.pageType), choice?.primaryKeyword ?? candidate.primaryKeyword, candidate.keywordIds.map((id) => text(keywords.get(id)?.keyword)).join("\n"), candidate.intent, candidate.confidence === "strong" ? "نشانه‌های همسو" : "نیاز به بررسی", [...evidence.reasons, ...candidate.reasons].join("؛ "), choice?.targetPageId ?? (candidate.existingPageIds.length === 1 ? candidate.existingPageIds[0] : ""), ({ new: "صفحه تازه", extend: "توسعه صفحه موجود", covered: "دارای هدف", conflict: "نیازمند بررسی" })[evidence.coverage], evidence.volume === null ? "نامشخص" : String(evidence.volume), evidence.difficulty === null ? evidence.difficultyLabel || "نامشخص" : String(Math.round(evidence.difficulty)), String(evidence.unassigned), choice?.priority || evidence.priority, evidence.gsc ? String(evidence.gsc.clicks) : "", evidence.gsc ? String(evidence.gsc.impressions) : "", evidence.gsc ? formatDate(evidence.gsc.periodStart) : "", evidence.gsc ? formatDate(evidence.gsc.periodEnd) : ""]);
  }
  const blob = new Blob(["\uFEFF", lines.map((line) => line.map(escape).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-") || "Roshdimo"}-page-plan-${jalaliFileDate()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PagePlanner({ project, onProjectChange, notify, readOnly = false, draftScope = "local-development", canRecoverLegacyDraft = false, onNavigate }: Props) {
  const serialized = useMemo(() => JSON.stringify(project), [project]);
  const [source, setSource] = useState(serialized);
  const [candidates, setCandidates] = useState(() => analyzePageCandidates(project));
  const [choices, setChoices] = useState<Record<string, Selection>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [applyRejected, setApplyRejected] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("priority");
  const [minimumVolume, setMinimumVolume] = useState("");
  const [maximumDifficulty, setMaximumDifficulty] = useState("");
  const [page, setPage] = useState(0);
  const [compact, setCompact] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const pageSize = compact ? MOBILE_PAGE_SIZE : PAGE_SIZE;
  const [createBriefs, setCreateBriefs] = useState(true);
  const [modal, setModal] = useState<Modal>(null);
  const [keywordQuery, setKeywordQuery] = useState("");
  const [keywordPage, setKeywordPage] = useState(0);
  const [keywordSelection, setKeywordSelection] = useState<Set<string>>(new Set());
  const [newLabel, setNewLabel] = useState("");
  const [draftPast, setDraftPast] = useState<PlanSnapshot[]>([]);
  const [draftFuture, setDraftFuture] = useState<PlanSnapshot[]>([]);
  const lastDraftCapture = useRef<{ key: string; at: number } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const storageKey = draftKey(project.id, draftScope);
  const draftIdentity = useRef(storageKey);
  const latestDraft = useRef<{ key: string; ready: boolean; readOnly: boolean; draft: SavedPlan | null }>({ key: storageKey, ready: false, readOnly, draft: null });
  const stale = source !== serialized;
  const keywords = useMemo(() => new Map(project.keywords.map((row) => [row.id, row])), [project.keywords]);
  const keywordSearch = useMemo(() => new Map(project.keywords.map((row) => [row.id, normalize(row.keyword)])), [project.keywords]);
  const pageMap = useMemo(() => new Map(project.pages.map((row) => [row.id, row])), [project.pages]);
  const selectedCandidates = useMemo(() => candidates.filter((candidate) => selected.has(candidate.id)), [candidates, selected]);
  const selections = useMemo(() => selectedCandidates.map((candidate): Selection => ({
    ...(candidate.existingPageIds.length === 1 ? { targetPageId: candidate.existingPageIds[0] } : {}),
    ...choices[candidate.id],
    candidateId: candidate.id,
  })), [selectedCandidates, choices]);
  const preview = useMemo(() => selectedCandidates.length && !stale ? buildPagePlan(project, candidates, selections, { createBriefs }) : null, [project, candidates, selectedCandidates.length, selections, createBriefs, stale]);
  const opportunities = useMemo(() => assessPageOpportunities(project, candidates, choices), [project, candidates, choices]);
  const coverageCounts = useMemo(() => { const counts = { new: 0, extend: 0, covered: 0, conflict: 0 }; for (const item of opportunities.values()) counts[item.coverage]++; return counts; }, [opportunities]);
  const filtered = useMemo(() => {
    const needle = normalize(query);
    return candidates.filter((candidate) => {
      const type = choices[candidate.id]?.pageType ?? candidate.pageType;
      const opportunity = opportunities.get(candidate.id)!;
      if (["new", "extend", "covered", "conflict"].includes(filter) && opportunity.coverage !== filter) return false;
      const minimum = keywordMetric(minimumVolume), maximum = keywordMetric(maximumDifficulty, 100);
      if (minimumVolume && minimum === null || maximumDifficulty && maximum === null) return false;
      if (filter === "selected" && !selected.has(candidate.id)) return false;
      if (minimum !== null && (opportunity.volume === null || opportunity.volume < minimum)) return false;
      if (maximum !== null && (opportunity.difficulty === null || opportunity.difficulty > maximum)) return false;
      if (filter === "review" && candidate.confidence !== "review") return false;
      if (filter === "strong" && candidate.confidence !== "strong") return false;
      if (filter === "blog" && !isArticle(type)) return false;
      if (filter === "commerce" && !["دسته‌بندی محصول", "محصول", "برند"].includes(type)) return false;
      if (filter === "service" && !["خدمات", "لندینگ"].includes(type)) return false;
      if (filter === "manual" && !candidate.manual) return false;
      return !needle || normalize(`${choices[candidate.id]?.label ?? candidate.label} ${choices[candidate.id]?.primaryKeyword ?? candidate.primaryKeyword}`).includes(needle) || candidate.keywordIds.some((id) => keywordSearch.get(id)?.includes(needle));
    }).sort((a, b) => sort === "volume" ? (opportunities.get(b.id)!.volume ?? -1) - (opportunities.get(a.id)!.volume ?? -1) : sort === "keywords" ? b.keywordIds.length - a.keywordIds.length : sort === "difficulty" ? (opportunities.get(a.id)!.difficulty ?? 101) - (opportunities.get(b.id)!.difficulty ?? 101) : opportunities.get(b.id)!.score - opportunities.get(a.id)!.score);
  }, [candidates, query, filter, choices, keywordSearch, opportunities, sort, minimumVolume, maximumDifficulty, selected]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const activeCandidate = modal?.kind === "keywords" ? candidates.find((candidate) => candidate.id === modal.id) : undefined;
  const modalKeywords = useMemo(() => activeCandidate?.keywordIds.filter((id) => !normalize(keywordQuery) || keywordSearch.get(id)?.includes(normalize(keywordQuery))) ?? [], [activeCandidate, keywordQuery, keywordSearch]);
  const keywordPages = Math.max(1, Math.ceil(modalKeywords.length / KEYWORD_PAGE_SIZE));
  const actualKeywordPage = Math.min(keywordPage, keywordPages - 1);
  const targetPages = useMemo(() => modal?.kind === "target" ? project.pages.filter((row) => !normalize(keywordQuery) || normalize(`${row.target ?? ""} ${row.pkw ?? ""} ${row.pageId ?? ""} ${row.url ?? ""}`).includes(normalize(keywordQuery))) : [], [modal?.kind, project.pages, keywordQuery]);
  const targetPageCount = Math.max(1, Math.ceil(targetPages.length / KEYWORD_PAGE_SIZE));
  const actualTargetPage = Math.min(keywordPage, targetPageCount - 1);
  const candidateWarnings = useMemo(() => selectedCandidates.filter((candidate) => (candidate.existingPageIds.length > 1 || opportunities.get(candidate.id)?.coverage === "conflict") && !choices[candidate.id]?.targetPageId).length, [selectedCandidates, choices, opportunities]);
  const invalidChoices = useMemo(() => selectedCandidates.filter((candidate) => !(choices[candidate.id]?.label ?? candidate.label).trim() || !(choices[candidate.id]?.primaryKeyword ?? candidate.primaryKeyword).trim()).length, [selectedCandidates, choices]);
  const protectedCount = useMemo(() => {
    const ids = new Set(selectedCandidates.flatMap((candidate) => candidate.keywordIds));
    return [...ids].filter((id) => text(keywords.get(id)?.targetPage).trim()).length;
  }, [selectedCandidates, keywords]);
  const readyCount = preview ? preview.createdPages + preview.updatedPages + preview.linkedKeywords + preview.createdContent : 0;
  const newBriefCapacity = Math.max(0, 2000 - project.content.length);
  if (draftIdentity.current === storageKey) latestDraft.current = { key: storageKey, ready: draftReady && !draftError, readOnly, draft: dirty ? { version: 1, projectId: project.id, source, candidates, choices, selected: [...selected], createBriefs } : null };

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const resize = () => { setCompact(media.matches); setPage(0); };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);

  useEffect(() => {
    let canceled = false;
    if (draftIdentity.current !== storageKey) {
      draftIdentity.current = storageKey;
      latestDraft.current = { key: storageKey, ready: false, readOnly, draft: null };
      setCandidates(analyzePageCandidates(project)); setSource(serialized); setChoices({}); setSelected(new Set()); setCreateBriefs(true); setDirty(false); clearDraftHistory(); setModal(null); setQuery(""); setFilter("all"); setPage(0); setDraftError(false); setApplyRejected(false);
    }
    setDraftReady(false);
    setRecovered(false);
    if (readOnly) {
      if (latestDraft.current.draft) writeDraft(storageKey, latestDraft.current.draft).catch(() => setDraftError(true));
      setDraftReady(true); return;
    }
    readDraft(storageKey, project.id, canRecoverLegacyDraft).then((saved) => {
      if (canceled || !validDraft(saved, project.id)) return;
      setSource(saved.source); setCandidates(saved.candidates); setChoices(saved.choices); setSelected(new Set(saved.selected)); setCreateBriefs(saved.createBriefs); setDirty(true); setRecovered(true);
    }).catch(() => { if (!canceled) setDraftError(true); }).finally(() => { if (!canceled) setDraftReady(true); });
    return () => { canceled = true; };
  }, [project.id, storageKey, readOnly, canRecoverLegacyDraft]);
  useEffect(() => {
    if (!draftReady || readOnly || draftError) return;
    const timer = window.setTimeout(() => { writeDraft(storageKey, latestDraft.current.draft).catch(() => setDraftError(true)); }, 300);
    return () => window.clearTimeout(timer);
  }, [storageKey, draftReady, readOnly, draftError, dirty, candidates, choices, selected, source, createBriefs]);
  useEffect(() => () => {
    const latest = latestDraft.current;
    if (latest.key === storageKey && latest.ready && !latest.readOnly && !draftError) writeDraft(storageKey, latest.draft).catch(() => {});
  }, [storageKey]);

  function regenerate() {
    if (dirty && !window.confirm("پیش‌نویس فعلی کنار گذاشته شود و پیشنهادها از اطلاعات جدید ساخته شوند؟")) return;
    rememberUndo();
    setCandidates(analyzePageCandidates(project)); setSource(serialized); setChoices({}); setSelected(new Set()); setDirty(false); setRecovered(false); setApplyRejected(false); setModal(null); setPage(0);
  }
  useEffect(() => {
    if (!dirty && stale) {
      setCandidates(analyzePageCandidates(project)); setSource(serialized); setChoices({}); setSelected(new Set()); clearDraftHistory(); setRecovered(false);
    }
  }, [project, serialized, source, dirty, stale]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => dialog.current?.querySelector<HTMLElement>("button, input, select")?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setModal(null); return; }
      if (event.key !== "Tab" || !dialog.current) return;
      const nodes = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter((node) => node.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(timer); document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); if (previous?.isConnected) previous.focus(); };
  }, [Boolean(modal)]);

  function edit(id: string, patch: Partial<Selection>) {
    if (readOnly || stale || !draftReady) return;
    rememberUndo(`edit:${id}:${Object.keys(patch).join(",")}`);
    setChoices((old) => ({ ...old, [id]: { ...old[id], ...patch, candidateId: id } }));
    setDirty(true);
  }
  function toggle(id: string, value: boolean) {
    if (readOnly || stale || !draftReady) return;
    rememberUndo("selection");
    setSelected((old) => { const next = new Set(old); if (value) next.add(id); else next.delete(id); return next; }); setDirty(true);
  }
  function selectMatching(strongOnly: boolean) {
    if (readOnly || stale || !draftReady) return;
    rememberUndo();
    setSelected((old) => new Set([...old, ...filtered.filter((candidate) => !strongOnly || candidate.confidence === "strong" && opportunities.get(candidate.id)!.coverage !== "conflict" && opportunities.get(candidate.id)!.unassigned > 0).map((candidate) => candidate.id)])); setDirty(true);
  }
  function snapshot(): PlanSnapshot { return { candidates, choices, selected: new Set(selected), createBriefs, source, dirty }; }
  function clearDraftHistory() { setDraftPast([]); setDraftFuture([]); lastDraftCapture.current = null; }
  function rememberUndo(key = "") {
    const now = Date.now();
    if (!key || lastDraftCapture.current?.key !== key || now - lastDraftCapture.current.at > 650) setDraftPast(old => [...old, snapshot()].slice(-40));
    setDraftFuture([]); lastDraftCapture.current = { key, at: now };
  }
  function replayDraft(direction: "undo" | "redo") {
    if (readOnly || !draftReady) return;
    const from = direction === "undo" ? draftPast : draftFuture;
    const state = from.at(-1);
    if (!state) return;
    if (direction === "undo") { setDraftPast(from.slice(0, -1)); setDraftFuture(old => [...old, snapshot()].slice(-40)); }
    else { setDraftFuture(from.slice(0, -1)); setDraftPast(old => [...old, snapshot()].slice(-40)); }
    setCandidates(state.candidates); setChoices(state.choices); setSelected(new Set(state.selected)); setCreateBriefs(state.createBriefs); setSource(state.source); setDirty(state.dirty); setModal(null); lastDraftCapture.current = null;
  }
  function bulkChoice(kind: "type" | "priority" | "primary" | "target", value = "") {
    if (readOnly || stale || !draftReady || !selected.size) return;
    const next = { ...choices };
    let changed = 0;
    for (const candidate of selectedCandidates) {
      const previous = next[candidate.id] || { candidateId: candidate.id };
      const opportunity = opportunities.get(candidate.id)!;
      let patch: Partial<Selection> = {};
      if (kind === "type") patch = { pageType: value };
      else if (kind === "priority") patch = { priority: value === "suggested" ? opportunity.priority : value };
      else if (kind === "target" && opportunity.suggestedTarget && opportunity.coverage !== "conflict") patch = { targetPageId: opportunity.suggestedTarget };
      else if (kind === "primary") {
        const rows = candidate.keywordIds.map(id => keywords.get(id)).filter((row): row is Row => !!row && row.decision !== "Exclude" && !!text(row.keyword));
        const known = rows.filter(row => keywordMetric(row.volume) !== null).sort((a, b) => (keywordMetric(b.volume) || 0) - (keywordMetric(a.volume) || 0));
        if (known[0]) patch = { primaryKeyword: text(known[0].keyword) };
      }
      const updated = { ...previous, ...patch };
      if (JSON.stringify(previous) !== JSON.stringify(updated)) { next[candidate.id] = updated; changed++; }
    }
    if (!changed) { notify("برای پیشنهادهای انتخاب‌شده تغییر قابل اعمالی پیدا نشد؛ اطلاعات ثبت‌شده و مقصدهای مبهم را بررسی کنید."); return; }
    rememberUndo(); setChoices(next); setDirty(true);
    notify(`${number(changed)} پیشنهاد در پیش‌نویس تغییر کرد؛ پیش از ثبت، نتیجه را بررسی کنید.`);
  }
  function subsetCandidate(candidate: PageCandidate, keywordIds: string[]): PageCandidate {
    const ids = new Set(keywordIds);
    const subset = analyzePageCandidates({ ...project, keywords: project.keywords.filter((row) => ids.has(row.id)) });
    return { ...candidate, keywordIds, existingPageIds: [...new Set(subset.flatMap((item) => item.existingPageIds))], sourceFingerprints: candidate.sourceFingerprints ? Object.fromEntries(Object.entries(candidate.sourceFingerprints).filter(([id]) => ids.has(id))) : undefined };
  }
  function openKeywords(candidate: PageCandidate) {
    setKeywordQuery(""); setKeywordPage(0); setKeywordSelection(new Set()); setNewLabel(`${choices[candidate.id]?.label ?? candidate.label} — گروه جدا`); setModal({ kind: "keywords", id: candidate.id });
  }
  function separateKeywords(keepAsProposal: boolean) {
    if (!activeCandidate || !keywordSelection.size || readOnly || stale || !draftReady) return;
    const removed = activeCandidate.keywordIds.filter((id) => keywordSelection.has(id));
    if (!removed.length) return;
    if (keepAsProposal && !newLabel.trim()) { notify("برای گروه جداشده یک نام وارد کنید."); return; }
    rememberUndo();
    const remaining = activeCandidate.keywordIds.filter((id) => !keywordSelection.has(id));
    const newCandidate: PageCandidate = {
      ...subsetCandidate(activeCandidate, removed), id: `split-${uid()}`, label: newLabel.trim(),
      primaryKeyword: removed.map((id) => keywords.get(id)).sort((a, b) => Number(b?.volume ?? 0) - Number(a?.volume ?? 0)).map((row) => text(row?.keyword))[0] ?? "",
      confidence: "review", reasons: ["این پیشنهاد با انتخاب شما از گروه قبلی جدا شده است.", ...activeCandidate.reasons],
    };
    const remainingCandidate = remaining.length ? { ...subsetCandidate(activeCandidate, remaining), primaryKeyword: remaining.some((id) => text(keywords.get(id)?.keyword) === activeCandidate.primaryKeyword) ? activeCandidate.primaryKeyword : text(keywords.get(remaining[0])?.keyword) } : null;
    setCandidates((old) => old.flatMap((candidate) => candidate.id !== activeCandidate.id ? [candidate] : [...(remainingCandidate ? [remainingCandidate] : []), ...(keepAsProposal ? [newCandidate] : [])]));
    setSelected((old) => { const next = new Set(old); if (!remaining.length) next.delete(activeCandidate.id); return next; });
    setChoices((old) => { const next = { ...old }; if (next[activeCandidate.id]?.primaryKeyword && !remaining.some((id) => text(keywords.get(id)?.keyword) === next[activeCandidate.id].primaryKeyword)) next[activeCandidate.id] = { ...next[activeCandidate.id], primaryKeyword: text(keywords.get(remaining[0])?.keyword) }; return next; });
    setDirty(true); setModal(null);
    notify(keepAsProposal ? `${number(removed.length)} کلمه در یک پیشنهاد جدا قرار گرفت؛ هنوز چیزی ذخیره نشده است.` : `${number(removed.length)} کلمه فقط از این پیش‌نویس کنار گذاشته شد؛ کلمات پروژه حفظ شدند.`);
  }
  function mergeSelected() {
    if (selectedCandidates.length < 2 || !newLabel.trim() || readOnly || stale || !draftReady) return;
    rememberUndo();
    const ids = new Set(selectedCandidates.flatMap((candidate) => candidate.keywordIds));
    const primary = [...ids].map((id) => keywords.get(id)).sort((a, b) => Number(b?.volume ?? 0) - Number(a?.volume ?? 0)).map((row) => text(row?.keyword))[0] ?? "";
    const types = new Set(selectedCandidates.map((candidate) => choices[candidate.id]?.pageType ?? candidate.pageType));
    const intents = new Set(selectedCandidates.map((candidate) => candidate.intent));
    const merged: PageCandidate = { ...selectedCandidates[0], id: `merge-${uid()}`, label: newLabel.trim(), keywordIds: [...ids], primaryKeyword: primary, pageType: types.size === 1 ? [...types][0] : "Needs Review", intent: intents.size === 1 ? [...intents][0] : "ترکیبی", confidence: "review", manual: selectedCandidates.some((candidate) => candidate.manual), existingPageIds: [...new Set(selectedCandidates.flatMap((candidate) => candidate.existingPageIds))], reasons: ["این گروه‌ها با انتخاب شما برای بررسی یک صفحه مشترک ادغام شده‌اند.", "نوع صفحه و نیت را پیش از تأیید بررسی کنید."], sourceFingerprints: Object.assign({}, ...selectedCandidates.map((candidate) => candidate.sourceFingerprints ?? {})) };
    setCandidates((old) => [...old.filter((candidate) => !selected.has(candidate.id)), merged]); setSelected(new Set([merged.id])); setChoices((old) => Object.fromEntries(Object.entries(old).filter(([id]) => !selected.has(id)))); setDirty(true); setModal(null); notify("پیشنهاد ادغام آماده شد؛ اطلاعات دستی و صفحات موجود هنوز تغییر نکرده‌اند.");
  }
  function apply() {
    if (readOnly || !draftReady || source !== JSON.stringify(project) || !selections.length) { notify("اطلاعات پروژه تغییر کرده است؛ پیشنهادها را دوباره بررسی کنید."); setModal(null); return; }
    if (invalidChoices) { notify("موضوع و کلمهٔ اصلی پیشنهادهای انتخابی باید مشخص باشند."); return; }
    const result = buildPagePlan(project, candidates, selections, { createBriefs });
    if (!(result.createdPages + result.updatedPages + result.linkedKeywords + result.createdContent)) { notify("تغییری قابل اعمال نیست؛ صفحهٔ هدف و موارد نیازمند بررسی را کنترل کنید."); return; }
    try { if (onProjectChange(result.project) === false) { setApplyRejected(true); return; } }
    catch { setApplyRejected(true); notify("ثبت برنامه انجام نشد؛ پیش‌نویس و انتخاب‌های شما حفظ شده‌اند."); return; }
    setApplyRejected(false);
    setDirty(false); setRecovered(false); clearDraftHistory(); setSelected(new Set()); setChoices({}); setModal(null);
    notify(`${number(result.createdPages)} صفحه و ${number(result.createdContent)} بریف ساخته شد؛ ${number(result.linkedKeywords)} کلمه به صفحه متصل شد.${result.skipped ? ` ${number(result.skipped)} مورد برای حفظ اطلاعات موجود کنار گذاشته شد.` : ""}`);
  }

  const pagination = (position: "top" | "bottom") => filtered.length > pageSize && <nav className="planner-pagination" data-planner-pagination={position} aria-label={position === "top" ? "صفحه‌بندی بالای پیشنهادها" : "صفحه‌بندی پایین پیشنهادها"}><button className="btn btn-secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronRight size={16} />قبلی</button><span aria-live={position === "top" ? "polite" : undefined}>صفحهٔ {number(currentPage + 1)} از {number(pageCount)} · {number(filtered.length)} پیشنهاد</span><button className="btn btn-secondary" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>بعدی<ChevronLeft size={16} /></button></nav>;

  return <section className="page-planner" data-dirty={dirty ? "true" : undefined} aria-label="دستیار برنامه‌ریزی صفحات">
    <div className="planner-intro"><span className="planner-icon"><Sparkles size={23} /></span><div><h2>از هزاران کلمه به یک برنامهٔ روشن</h2><p>کلمات مناسب یک صفحه را کنار هم بررسی کنید؛ سپس به صفحهٔ موجود وصل کنید یا صفحه و بریف بسازید.</p></div><button className="btn btn-secondary" onClick={regenerate} disabled={!draftReady}><RefreshCw size={15} />بازسازی پیشنهادها</button></div>
    <div className="planner-note"><ShieldCheck size={18} /><p>تحلیل داخل برنامه انجام می‌شود. شباهت واژه، نیت و نوع پروژه بررسی می‌شوند؛ تأیید نهایی یک صفحهٔ مشترک به بررسی نتایج جست‌وجو نیاز دارد. گروه، نیت و اتصال دستی کلمات حفظ می‌شوند.</p></div>
    {recovered && <p className="planner-note" role="status">پیش‌نویس قبلی شما بازیابی شد. پیشنهادها هنوز در پروژه ثبت نشده‌اند.</p>}
    {draftError && <p className="planner-warning" role="status">ذخیرهٔ پیش‌نویس در این مرورگر در دسترس نیست. پیش از بستن، برنامه را ثبت یا خروجی CSV بگیرید.</p>}
    {readOnly && <p className="planner-warning" role="status">حساب شما مشاهده‌گر است؛ می‌توانید پیشنهادها را بررسی و دانلود کنید.</p>}
    {stale && <div className="planner-warning" role="alert"><strong>اطلاعات پروژه پس از تهیهٔ این پیش‌نویس تغییر کرده است.</strong><span>برای جلوگیری از جایگزینی تغییرات، اعمال متوقف شد. می‌توانید پیش‌نویس را دانلود و پیشنهادها را بازسازی کنید.</span></div>}
    <div className="planner-stats"><div><strong>{number(candidates.length)}</strong><span>پیشنهاد صفحه</span></div><div><strong>{number(candidates.filter((item) => item.confidence === "strong").length)}</strong><span>با نشانه‌های همسو</span></div><div><strong>{number(candidates.filter((item) => item.confidence === "review").length)}</strong><span>نیازمند بررسی</span></div><div><strong>{number(selectedCandidates.reduce((sum, item) => sum + item.keywordIds.length, 0))}</strong><span>کلمه در انتخاب شما</span></div></div>
    <div className="planner-coverage" aria-label="پوشش موضوعات">{([["new", "فرصت صفحهٔ جدید"], ["extend", "توسعهٔ صفحهٔ موجود"], ["covered", "پوشش داده‌شده"], ["conflict", "نیازمند تصمیم"]] as const).map(([key, label]) => <button key={key} className={filter === key ? "active" : ""} aria-pressed={filter === key} onClick={() => { setFilter(filter === key ? "all" : key); setPage(0); }}><strong>{number(coverageCounts[key])}</strong><span>{label}</span></button>)}</div>
    <div className="planner-toolbar"><label className="planner-search"><Search size={17} /><input aria-label="جست‌وجوی پیشنهادهای صفحه" placeholder="موضوع یا هر کلمه‌ای در گروه…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label><select aria-label="فیلتر پیشنهادهای صفحه" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}><option value="all">همهٔ پیشنهادها</option><option value="new">فرصت صفحهٔ جدید</option><option value="extend">توسعهٔ صفحهٔ موجود</option><option value="covered">از قبل پوشش داده‌شده</option><option value="conflict">تداخل / ارجاع نیازمند بررسی</option><option value="selected">فقط انتخاب‌های من</option><option value="strong">نشانه‌های همسو</option><option value="review">نیازمند بررسی</option><option value="blog">مقاله و راهنمای خرید</option><option value="commerce">محصول و دسته‌بندی</option><option value="service">خدمات و لندینگ</option><option value="manual">گروه‌های دستی</option></select><button className="btn btn-ghost" onClick={() => { exportPlan(filtered, choices, keywords, selected, project.name, opportunities); notify("فایل پیش‌نویس برنامهٔ صفحات دانلود شد."); }} disabled={!filtered.length} title="خروجی همین نتایج جست‌وجو و فیلتر"><Download size={15} />خروجی CSV</button></div>
    <details className="planner-refinements"><summary>مرتب‌سازی و فیلتر دقیق‌تر</summary><div><label>مرتب‌سازی<select aria-label="مرتب‌سازی پیشنهادها" value={sort} onChange={event => { setSort(event.target.value); setPage(0); }}><option value="priority">اولویت پیشنهادی</option><option value="volume">حجم جست‌وجوی ثبت‌شده</option><option value="difficulty">سختی کمتر</option><option value="keywords">تعداد کلمات بیشتر</option></select></label><label>حداقل حجم ثبت‌شده<input inputMode="decimal" aria-label="حداقل حجم پیشنهاد" value={minimumVolume} maxLength={12} onChange={event => { setMinimumVolume(event.target.value); setPage(0); }} placeholder="بدون محدودیت" aria-invalid={!!minimumVolume && keywordMetric(minimumVolume) === null} /></label><label>حداکثر میانگین سختی<input inputMode="decimal" aria-label="حداکثر سختی پیشنهاد" value={maximumDifficulty} maxLength={6} onChange={event => { setMaximumDifficulty(event.target.value); setPage(0); }} placeholder="۰ تا ۱۰۰" aria-invalid={!!maximumDifficulty && keywordMetric(maximumDifficulty, 100) === null} /></label><button className="btn btn-ghost" onClick={() => { setMinimumVolume(""); setMaximumDifficulty(""); setFilter("all"); setQuery(""); setPage(0); }}>پاک‌کردن فیلترها</button></div><p>اولویت از پوشش صفحه، داده‌های ثبت‌شده، نوع پروژه و فایل واردشده محاسبه می‌شود؛ پیش‌بینی رتبه یا ترافیک نیست. حجم عبارت‌های تکراری دوباره شمرده نمی‌شود؛ دادهٔ خالی صفر نیست. فیلتر سختی فقط دادهٔ عددی ثبت‌شده را بررسی می‌کند.</p>{(minimumVolume && keywordMetric(minimumVolume) === null || maximumDifficulty && keywordMetric(maximumDifficulty, 100) === null) && <p className="planner-filter-error" role="status">مقدار فیلتر باید عدد معتبر باشد؛ سختی بین صفر تا صد است.</p>}</details>
    <div className="planner-selection"><span>{number(selected.size)} پیشنهاد انتخاب‌شده</span><button onClick={() => selectMatching(true)} disabled={readOnly || stale || !draftReady}>انتخاب موارد با نشانه‌های همسو</button><button onClick={() => selectMatching(false)} disabled={readOnly || stale || !draftReady}>انتخاب همهٔ نتایج فیلتر</button><button onClick={() => { rememberUndo(); setSelected(new Set()); setDirty(true); }} disabled={readOnly || stale || !draftReady || !selected.size}>لغو انتخاب</button><button onClick={() => { setNewLabel(choices[selectedCandidates[0]?.id]?.label ?? selectedCandidates[0]?.label ?? ""); setModal({ kind: "merge" }); }} disabled={readOnly || stale || !draftReady || selected.size < 2}><Merge size={14} />ادغام انتخاب‌ها</button><button onClick={() => replayDraft("undo")} disabled={readOnly || !draftReady || !draftPast.length} aria-label="برگرداندن تغییر پیش‌نویس"><Undo2 size={14} />بازگشت پیش‌نویس</button><button onClick={() => replayDraft("redo")} disabled={readOnly || !draftReady || !draftFuture.length} aria-label="انجام دوباره تغییر پیش‌نویس"><Redo2 size={14} />انجام دوباره</button></div>
    {!!selected.size && <div className="planner-bulk-actions" aria-label="تصمیم گروهی پیشنهادها"><strong>تصمیم برای {number(selected.size)} پیشنهاد</strong><select value="" aria-label="نوع صفحهٔ گروهی" disabled={readOnly || stale || !draftReady} onChange={event => bulkChoice("type", event.target.value)}><option value="" disabled>تغییر نوع صفحه…</option>{LISTS.pageType.map(value => <option key={value} value={value}>{pageTypeLabel(value)}</option>)}</select><select value="" aria-label="اولویت گروهی صفحات تازه" disabled={readOnly || stale || !draftReady} onChange={event => bulkChoice("priority", event.target.value)}><option value="" disabled>اولویت صفحات تازه…</option><option value="suggested">اولویت پیشنهادی هر گروه</option><option value="P1">P1 · بالا</option><option value="P2">P2 · معمول</option><option value="P3">P3 · بعدی</option></select><button className="btn btn-ghost" disabled={readOnly || stale || !draftReady} onClick={() => bulkChoice("primary")}>کلمهٔ اصلی با بیشترین حجم</button><button className="btn btn-ghost" disabled={readOnly || stale || !draftReady || !selectedCandidates.some(item => opportunities.get(item.id)?.suggestedTarget)} onClick={() => bulkChoice("target")}>انتخاب مقصدهای شناسایی‌شده</button><small>تغییرها فقط در پیش‌نویس‌اند. نوع و اولویت صفحات موجود و اتصال دستی کلمات جایگزین نمی‌شوند.</small></div>}
    {pagination("top")}
    <div className="planner-groups">
      {filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((candidate) => {
        const choice = choices[candidate.id];
        const label = choice?.label ?? candidate.label;
        const primary = choice?.primaryKeyword ?? candidate.primaryKeyword;
        const type = choice?.pageType ?? candidate.pageType;
        const opportunity = opportunities.get(candidate.id)!;
        const target = choice?.targetPageId ?? (candidate.existingPageIds.length === 1 ? candidate.existingPageIds[0] : "");
        return <article key={candidate.id} className={`planner-group ${selected.has(candidate.id) ? "is-selected" : ""}`} data-candidate-id={candidate.id}>
          <div className="planner-group-heading"><label className="planner-check"><input type="checkbox" aria-label={`انتخاب پیشنهاد ${candidate.label}`} checked={selected.has(candidate.id)} disabled={readOnly || stale || !draftReady} onChange={(event) => toggle(candidate.id, event.target.checked)} /><strong>{number(candidate.keywordIds.length)} کلمه</strong></label><span className={`planner-confidence ${candidate.confidence}`}>{candidate.confidence === "strong" ? "نشانه‌های همسو" : "نیازمند بررسی"}</span>{candidate.manual && <span className="planner-manual">گروه دستی</span>}</div>
          <div className="planner-fields"><label className="field"><span>موضوع / هدف صفحه</span><input aria-label={`موضوع پیشنهاد ${candidate.label}`} value={label} disabled={readOnly || stale || !draftReady} maxLength={300} onChange={(event) => edit(candidate.id, { label: event.target.value })} /></label><label className="field"><span>نوع صفحه</span><select aria-label={`نوع صفحه ${candidate.label}`} value={type} disabled={readOnly || stale || !draftReady} onChange={(event) => edit(candidate.id, { pageType: event.target.value })}>{LISTS.pageType.map((item) => <option key={item} value={item}>{pageTypeLabel(item)}</option>)}</select></label><label className="field"><span>کلمهٔ اصلی پیشنهادی</span><input aria-label={`کلمه اصلی ${candidate.label}`} value={primary} disabled={readOnly || stale || !draftReady} maxLength={300} onChange={(event) => edit(candidate.id, { primaryKeyword: event.target.value })} /></label><label className="field"><span>صفحهٔ هدف</span><select aria-label={`صفحه هدف ${candidate.label}`} value={target} disabled={readOnly || stale || !draftReady} onChange={(event) => { if (event.target.value === "__choose_page__") { setKeywordQuery(""); setKeywordPage(0); setModal({ kind: "target", id: candidate.id }); } else edit(candidate.id, { targetPageId: event.target.value }); }}><option value="">{candidate.existingPageIds.length > 1 ? "یک صفحهٔ موجود انتخاب کنید…" : candidate.existingPageIds.length === 1 ? "انتخاب خودکار صفحهٔ مرتبط" : "ساخت صفحهٔ جدید"}</option>{[...new Set([...candidate.existingPageIds, ...(target ? [target] : [])])].map((id) => pageMap.get(id)).filter((item): item is Row => Boolean(item)).map((item) => <option key={item.id} value={item.id}>{text(item.target || item.pkw || item.pageId || item.url || "صفحه بدون عنوان")}{candidate.existingPageIds.includes(item.id) ? " · مرتبط" : ""}</option>)}{!!project.pages.length && <option value="__choose_page__">جست‌وجو و انتخاب از صفحات پروژه…</option>}</select></label></div>
          <div className="planner-opportunity"><div><span>حجم ثبت‌شده</span><strong>{opportunity.volume === null ? "نامشخص" : number(opportunity.volume)}</strong></div><div><span>{opportunity.difficulty === null ? "سخت‌ترین ارزیابی کیفی" : "میانگین سختی عددی"}</span><strong>{opportunity.difficulty === null ? opportunity.difficultyLabel || "نامشخص" : number(Math.round(opportunity.difficulty))}</strong></div><div><span>کلمهٔ بدون هدف</span><strong>{number(opportunity.unassigned)}</strong></div><div><span>{choice?.priority ? "اولویت برنامه" : "اولویت پیشنهادی"}</span><strong dir="ltr">{choice?.priority || opportunity.priority}</strong></div></div>
          <p className={`planner-coverage-label ${opportunity.coverage}`}>{({ new: "فرصت صفحهٔ تازه", extend: "قابل توسعه روی صفحهٔ موجود", covered: "کلمات دارای صفحهٔ هدف", conflict: "ابتدا تداخل یا ارجاع‌ها را بررسی کنید" })[opportunity.coverage]}</p>
          {opportunity.gsc && <p className="planner-gsc-evidence">فایل Search Console · {number(opportunity.gsc.clicks)} کلیک · {number(opportunity.gsc.impressions)} نمایش<br /><small>دورهٔ {formatDate(opportunity.gsc.periodStart)} تا {formatDate(opportunity.gsc.periodEnd)}؛ فقط عبارت‌های منطبق در فایل واردشده</small></p>}
          {opportunity.suggestedTarget && !target && <button className="btn btn-ghost planner-suggested-target" disabled={readOnly || stale || !draftReady} onClick={() => edit(candidate.id, { targetPageId: opportunity.suggestedTarget })}>استفاده از صفحهٔ شناسایی‌شده: {text(pageMap.get(opportunity.suggestedTarget)?.target || pageMap.get(opportunity.suggestedTarget)?.pkw || "صفحهٔ موجود")}</button>}
          <p className="planner-examples">{candidate.keywordIds.slice(0, 4).map((id) => text(keywords.get(id)?.keyword)).join(" · ")}{candidate.keywordIds.length > 4 ? ` · و ${number(candidate.keywordIds.length - 4)} کلمهٔ دیگر` : ""}</p>
          <div className="planner-group-bottom"><span>نیت پیشنهادی: {candidate.intent || "نیاز به بررسی"}</span><button className="btn btn-ghost" onClick={() => openKeywords(candidate)}><Layers3 size={15} />بررسی کلمات و جداسازی</button></div>
          <details className="planner-reasons"><summary>چرا این پیشنهاد؟</summary><ul>{[...opportunity.reasons, ...candidate.reasons].map((reason, index) => <li key={index}>{reason}</li>)}</ul>{candidate.existingPageIds.length > 0 && <p>صفحات مرتبط: {candidate.existingPageIds.map((id) => text(pageMap.get(id)?.target || pageMap.get(id)?.pkw || "صفحهٔ موجود")).join("، ")}</p>}</details>
        </article>;
      })}
      {!filtered.length && <div className="planner-empty"><FileText size={30} /><h3>{candidates.length ? "پیشنهادی با این فیلتر پیدا نشد" : "هنوز کلمه‌ای برای برنامه‌ریزی وجود ندارد"}</h3><p>{candidates.length ? "فیلتر یا عبارت جست‌وجو را تغییر دهید." : "کلمات کلیدی را وارد کنید؛ سپس پیشنهادهای صفحه اینجا آماده می‌شوند."}</p></div>}
    </div>
    {pagination("bottom")}
    <div className={`planner-footer ${selected.size ? "has-selection" : ""}`}><div><strong>{number(selected.size)} پیشنهاد آمادهٔ بازبینی</strong><span>{preview ? `${number(preview.createdPages)} صفحهٔ جدید · ${number(preview.updatedPages)} صفحهٔ موجود · ${number(preview.linkedKeywords)} اتصال کلمه` : "پیشنهادها را انتخاب کنید؛ پیش از ذخیره، خلاصهٔ تغییرات را می‌بینید."}</span></div><label className="planner-check"><input type="checkbox" checked={createBriefs} disabled={readOnly || stale || !draftReady} onChange={(event) => { rememberUndo(); setCreateBriefs(event.target.checked); setDirty(true); }} />بریف اولیه هم ساخته شود</label><button className="btn btn-primary" disabled={readOnly || stale || !draftReady || !selected.size || !readyCount || candidateWarnings > 0 || invalidChoices > 0} onClick={() => setModal({ kind: "confirm" })}>بازبینی و ثبت برنامه <ChevronLeft size={16} /></button>{invalidChoices > 0 && <p className="planner-footer-warning">موضوع و کلمهٔ اصلی {number(invalidChoices)} پیشنهاد انتخابی را کامل کنید.</p>}{candidateWarnings > 0 && <p className="planner-footer-warning">برای {number(candidateWarnings)} پیشنهاد، یک صفحهٔ موجود را به‌عنوان هدف انتخاب کنید.</p>}</div>
    {modal && <div className="modal-backdrop planner-backdrop" onClick={() => setModal(null)}><div ref={dialog} className="planner-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}><div className="planner-dialog-heading"><div><h2 id={titleId}>{modal.kind === "confirm" ? "برنامهٔ انتخابی را تأیید کنید" : modal.kind === "merge" ? "بررسی ادغام گروه‌ها" : modal.kind === "target" ? "انتخاب صفحهٔ هدف" : choices[activeCandidate?.id ?? ""]?.label ?? activeCandidate?.label ?? "بررسی کلمات"}</h2><p>{modal.kind === "keywords" ? "جداسازی فقط روی پیش‌نویس انجام می‌شود؛ کلمات پروژه حذف نمی‌شوند." : "تا تأیید نهایی، اطلاعات پروژه تغییر نمی‌کند."}</p></div><button className="btn btn-ghost" aria-label="بستن بررسی برنامه صفحات" onClick={() => setModal(null)}><X size={19} /></button></div>
      {modal.kind === "confirm" && preview && <><div className="planner-dialog-body planner-confirm">{applyRejected && <p className="planner-warning" role="alert">ثبت برنامه پذیرفته نشد. پیش‌نویس و انتخاب‌های شما حفظ شده‌اند؛ علت را بررسی و دوباره تلاش کنید.</p>}<ShieldCheck size={37} /><div className="planner-confirm-counts"><div><strong>{number(preview.createdPages)}</strong><span>صفحهٔ جدید</span></div><div><strong>{number(preview.updatedPages)}</strong><span>صفحهٔ موجود با کلمات تکمیلی</span></div><div><strong>{number(preview.createdContent)}</strong><span>بریف اولیه</span></div><div><strong>{number(preview.linkedKeywords)}</strong><span>اتصال کلمه به صفحه</span></div></div>{createBriefs && selected.size > newBriefCapacity && <p className="planner-warning">ظرفیت باقیماندهٔ بخش محتوا {number(newBriefCapacity)} ردیف است؛ تعداد واقعی بریف‌های قابل ساخت در خلاصه نمایش داده می‌شود.</p>}<p>این برنامه از {number(selected.size)} پیشنهاد انتخابی تهیه شده است. عنوان، آدرس و اطلاعات دستی صفحات موجود جایگزین نمی‌شوند.</p>{selectedCandidates.some((candidate) => candidate.confidence === "review") && <p className="planner-warning">{number(selectedCandidates.filter((candidate) => candidate.confidence === "review").length)} پیشنهاد نیازمند بررسی در انتخاب شماست. مناسب‌بودن یک صفحهٔ مشترک را تأیید کرده‌اید؟</p>}{protectedCount > 0 && <p className="planner-note">{number(protectedCount)} کلمه از قبل اتصال صفحه دارد؛ اتصال موجود حفظ می‌شود.</p>}{preview.skipped > 0 && <p className="planner-warning">{number(preview.skipped)} مورد قابل اعمال نیست یا برای حفظ اطلاعات موجود کنار گذاشته می‌شود.</p>}<div className="planner-confirm-list">{selectedCandidates.slice(0, 60).map((candidate) => <div key={candidate.id}><strong>{choices[candidate.id]?.label ?? candidate.label}</strong><span>{pageTypeLabel(choices[candidate.id]?.pageType ?? candidate.pageType)} · {number(candidate.keywordIds.length)} کلمه</span></div>)}{selectedCandidates.length > 60 && <p>و {number(selectedCandidates.length - 60)} پیشنهاد دیگر؛ فهرست کامل در خروجی CSV در دسترس است.</p>}</div></div><div className="planner-dialog-footer"><button className="btn btn-secondary" onClick={() => setModal(null)}>بازگشت به پیشنهادها</button><button className="btn btn-primary" disabled={readOnly || stale || !draftReady} onClick={apply}><Check size={16} />تأیید و ثبت در پروژه</button></div></>}
      {modal.kind === "merge" && <><div className="planner-dialog-body"><p>{number(selectedCandidates.length)} گروه و {number(selectedCandidates.reduce((sum, candidate) => sum + candidate.keywordIds.length, 0))} کلمه به یک پیشنهاد مشترک تبدیل می‌شوند.</p><label className="field"><span>نام پیشنهاد ادغام‌شده</span><input aria-label="نام پیشنهاد ادغام شده" value={newLabel} maxLength={300} onChange={(event) => setNewLabel(event.target.value)} /></label><p className="planner-warning">وجود واژه‌های مشابه به معنی یک صفحهٔ مشترک نیست. ادغام تنها پیش‌نویس را تغییر می‌دهد؛ نوع صفحه، نیت و صفحات مرتبط را بعد از ادغام بازبینی کنید.</p><ul className="planner-merge-list">{selectedCandidates.slice(0, 60).map((candidate) => <li key={candidate.id}>{choices[candidate.id]?.label ?? candidate.label} · {number(candidate.keywordIds.length)} کلمه</li>)}</ul></div><div className="planner-dialog-footer"><button className="btn btn-secondary" onClick={() => setModal(null)}>انصراف</button><button className="btn btn-primary" disabled={readOnly || stale || !draftReady || !newLabel.trim()} onClick={mergeSelected}><Merge size={15} />ساخت پیشنهاد ادغام‌شده</button></div></>}
      {modal.kind === "target" && <><div className="planner-dialog-body"><label className="planner-search"><Search size={16} /><input aria-label="جست‌وجوی صفحات موجود برای هدف" placeholder="نام، کلمه اصلی یا آدرس صفحه…" value={keywordQuery} onChange={(event) => { setKeywordQuery(event.target.value); setKeywordPage(0); }} /></label><div className="planner-target-list">{targetPages.slice(actualTargetPage * KEYWORD_PAGE_SIZE, (actualTargetPage + 1) * KEYWORD_PAGE_SIZE).map((row) => <button key={row.id} onClick={() => { edit(modal.id, { targetPageId: row.id }); setModal(null); }} disabled={readOnly || stale || !draftReady}><FileText size={16} /><span><strong>{text(row.target || row.pkw || row.pageId || "صفحهٔ بدون عنوان")}</strong><small>{text(row.url || row.pkw || row.pageId)}</small></span><ChevronLeft size={16} /></button>)}{!targetPages.length && <p className="planner-empty">صفحه‌ای با این جست‌وجو پیدا نشد.</p>}</div>{targetPageCount > 1 && <div className="planner-pagination"><button className="btn btn-secondary" disabled={!actualTargetPage} onClick={() => setKeywordPage(actualTargetPage - 1)}><ChevronRight size={15} />قبلی</button><span>{number(actualTargetPage + 1)} / {number(targetPageCount)}</span><button className="btn btn-secondary" disabled={actualTargetPage >= targetPageCount - 1} onClick={() => setKeywordPage(actualTargetPage + 1)}>بعدی<ChevronLeft size={15} /></button></div>}<p className="planner-note">اتصال قبلی کلمات به صفحهٔ دیگر حفظ می‌شود؛ کلمات بدون اتصال می‌توانند به صفحهٔ انتخابی وصل شوند.</p></div><div className="planner-dialog-footer"><button className="btn btn-secondary" onClick={() => setModal(null)}>بازگشت به پیشنهادها</button></div></>}
      {modal.kind === "keywords" && activeCandidate && <><div className="planner-dialog-body"><label className="planner-search"><Search size={16} /><input aria-label="جست‌وجو در کلمات پیشنهاد" value={keywordQuery} placeholder="جست‌وجو بین تمام کلمات این گروه…" onChange={(event) => { setKeywordQuery(event.target.value); setKeywordPage(0); }} /></label><div className="planner-keyword-selection"><span>{number(keywordSelection.size)} انتخاب</span><button className="btn btn-ghost" disabled={readOnly || stale || !draftReady} onClick={() => setKeywordSelection((old) => new Set([...old, ...modalKeywords]))}>انتخاب همهٔ نتایج</button><button className="btn btn-ghost" disabled={!keywordSelection.size} onClick={() => setKeywordSelection(new Set())}>لغو انتخاب</button></div><div className="planner-keywords">{modalKeywords.slice(actualKeywordPage * KEYWORD_PAGE_SIZE, (actualKeywordPage + 1) * KEYWORD_PAGE_SIZE).map((id) => { const row = keywords.get(id); return <label key={id} className="planner-keyword"><input type="checkbox" checked={keywordSelection.has(id)} disabled={readOnly || stale || !draftReady} onChange={(event) => setKeywordSelection((old) => { const next = new Set(old); if (event.target.checked) next.add(id); else next.delete(id); return next; })} /><span><strong>{text(row?.keyword)}</strong><small>{text(row?.intent) || "نیت مشخص نشده"}{text(row?.targetPage) ? " · اتصال صفحه حفظ می‌شود" : ""}</small></span><span className="planner-keyword-volume">{row?.volume !== undefined ? number(Number(row.volume) || 0) : "—"}</span></label>; })}{!modalKeywords.length && <p className="planner-empty">کلمه‌ای با این جست‌وجو پیدا نشد.</p>}</div>{keywordPages > 1 && <div className="planner-pagination"><button className="btn btn-secondary" disabled={!actualKeywordPage} onClick={() => setKeywordPage(actualKeywordPage - 1)}><ChevronRight size={15} />قبلی</button><span>{number(actualKeywordPage + 1)} / {number(keywordPages)}</span><button className="btn btn-secondary" disabled={actualKeywordPage >= keywordPages - 1} onClick={() => setKeywordPage(actualKeywordPage + 1)}>بعدی<ChevronLeft size={15} /></button></div>}<label className="field planner-split-name"><span>نام گروه جداشده</span><input aria-label="نام گروه جدا شده" value={newLabel} disabled={readOnly || stale || !draftReady} maxLength={300} onChange={(event) => setNewLabel(event.target.value)} /></label></div><div className="planner-dialog-footer"><button className="btn btn-secondary" disabled={readOnly || stale || !draftReady || !keywordSelection.size} onClick={() => separateKeywords(false)}>کنارگذاشتن از پیش‌نویس</button><button className="btn btn-primary" disabled={readOnly || stale || !draftReady || !keywordSelection.size || !newLabel.trim()} onClick={() => separateKeywords(true)}><Split size={16} />جداکردن در پیشنهاد تازه</button></div></>}
    </div></div>}
    {onNavigate && <div className="planner-next"><button className="btn btn-ghost" onClick={() => onNavigate("pages")}><FileText size={15} />رفتن به نقشهٔ صفحات<ArrowLeft size={14} /></button><button className="btn btn-ghost" onClick={() => onNavigate("content")}>دیدن بریف‌ها<ArrowLeft size={14} /></button></div>}
  </section>;
}
