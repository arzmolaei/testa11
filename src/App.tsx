import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpLeft,
  ArrowLeft,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  CloudOff,
  Download,
  FileText,
  FolderPlus,
  Globe2,
  Home,
  Layers3,
  Leaf,
  LogOut,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Table2,
  Target,
  TrendingUp,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import type { Collection, Project, Row, Store } from "./types";
import {
  createProject,
  demoStore,
  LISTS,
  SCHEMAS,
  summarize,
  validateStore,
} from "./domain";
import {
  downloadJson,
  listBackups,
  loadLocal,
  recoverLocal,
  saveLocal,
} from "./storage";
import type { Stored } from "./storage";
import { KeywordWorkspace } from "./components/KeywordWorkspace";
import { BulkEditWorkspace } from "./components/BulkEditWorkspace";
import { AuthGate } from "./components/AuthGate";
import { TeamSettings } from "./components/TeamSettings";
import type { AuthActions, AuthSession } from "./auth";
import { useTheme } from "./theme";
import { formatDate, todayIso, jalaliFileDate } from "./dates";
import { JalaliDateInput } from "./components/JalaliDateInput";
import { cloudResumeDecision, fingerprintStore, readCloudLink, rememberCloudLink, forgetCloudLink } from "./cloud-link";
import type { ProjectPlaybook } from "./playbooks";
import { PROJECT_PLAYBOOKS, cloneProjectPlaybook } from "./playbooks";
import { applyChangeSet, buildChangeSet, loadCloudBase, saveCloudBase, clearCloudBase } from "./record-sync";
import "./intelligence.css";
import {
  PageWorkspace,
  ContentWorkspace,
  ResultsWorkspace,
} from "./components/PageWorkspaces";
const PagePlanner = lazy(() => import("./components/PagePlanner").then((module) => ({ default: module.PagePlanner })));
const ProjectAssistant = lazy(() => import("./components/ProjectAssistant").then((module) => ({ default: module.ProjectAssistant })));
const PageRelationships = lazy(() => import("./components/PageRelationships").then((module) => ({ default: module.PageRelationships })));
const SearchConsoleWorkspace = lazy(() => import("./components/SearchConsoleWorkspace").then((module) => ({ default: module.SearchConsoleWorkspace })));
const ProjectReport = lazy(() => import("./components/ProjectReport").then((module) => ({ default: module.ProjectReport })));
const PlaybookPicker = lazy(() => import("./components/PlaybookPicker").then((module) => ({ default: module.PlaybookPicker })));
const ProjectHistory = lazy(() => import("./components/ProjectHistory").then((module) => ({ default: module.ProjectHistory })));

function stampProject(previous: Project, incoming: Project): Project {
  const result = { ...incoming };
  const now = new Date().toISOString();
  for (const key of ["keywords", "pages", "content", "results", "tasks", "links"] as const) {
    if (!incoming[key]) continue;
    const old = new Map((previous[key] || []).map((row) => [row.id, row]));
    result[key] = incoming[key]!.map((row) => {
      const before = old.get(row.id);
      if (before && JSON.stringify(before) === JSON.stringify(row)) return row;
      return { ...row, createdAt: row.createdAt || before?.createdAt || now, updatedAt: now };
    });
  }
  return result;
}
function WorkspaceModes({ items, value, onChange }: { items: [string, string][]; value: string; onChange: (key: string) => void }) {
  return <nav className="workspace-modes" aria-label="نمای بخش">{items.map(([key, label]) => <button key={key} className={value === key ? "active" : ""} aria-pressed={value === key} onClick={() => onChange(key)}>{label}</button>)}</nav>;
}

type View = "start" | Collection | "settings" | "bulk";
const NAV = [
  { key: "start", label: "نمای کلی", sub: "مسیر و قدم بعدی", icon: Home },
  { key: "keywords", label: "کلمات کلیدی", sub: "کشف و تصمیم", icon: Search },
  { key: "bulk", label: "تغییر گروهی", sub: "ویرایش سریع و پیشنهاد گروه‌بندی", icon: Table2 },
  { key: "pages", label: "نقشه صفحات", sub: "هدف‌گذاری و سئو", icon: Layers3 },
  {
    key: "content",
    label: "محتوا و تقویم",
    sub: "از بریف تا انتشار",
    icon: FileText,
  },
  {
    key: "results",
    label: "نتایج و بهبود",
    sub: "اندازه‌گیری اثر",
    icon: TrendingUp,
  },
  {
    key: "settings",
    label: "تنظیمات و راهنما",
    sub: "پروژه، پشتیبان و فیلدها",
    icon: Settings2,
  },
] as const;
const fa = (n: number) => new Intl.NumberFormat("fa-IR").format(n);
const dateLabel = () =>
  formatDate(new Date().toISOString(), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Tehran",
  });
class CloudRequestError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
async function api(path: string, body?: unknown, method?: string) {
  const r = await fetch("/api/" + path, {
    signal: AbortSignal.timeout(20000),
    method: method ?? (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload;
  try {
    payload = await r.json();
  } catch {
    throw new Error("سرویس ابری در این اجرا در دسترس نیست.");
  }
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event("seo:auth-expired"));
    throw new CloudRequestError(String(payload.error || ""), ({ RECORD_CONFLICT: "یک فیلد هم‌زمان در دستگاه دیگری تغییر کرده است. تغییرات این دستگاه حفظ شدند؛ در تنظیمات پشتیبان و نسخهٔ ابری را بررسی کنید.", REVISION_CONFLICT: "نسخه ابری تغییر کرده؛ همگام‌سازی متوقف شد. ابتدا نسخه ابری را بررسی کنید.", STATE_REQUIRED: "فضای ابری خالی است؛ از تنظیمات، انتقال اولیه به ابر را انجام دهید.", RECORD_SYNC_MIGRATION_REQUIRED: "دیتابیس به به‌روزرسانی نیاز دارد؛ نصب‌کنندهٔ آسان را دوباره اجرا کنید.", SYNC_BUSY: "ابر در حال ثبت تغییرات دیگری است؛ تغییرات محلی محفوظ‌اند. دوباره همگام‌سازی کنید.", INVALID_CHANGES: "تغییرات برای ثبت ابری معتبر نیستند؛ نسخهٔ محلی حفظ شد.", PAYLOAD_TOO_LARGE: "حجم انتقال زیاد است؛ نسخهٔ محلی محفوظ است. در تنظیمات، انتقال کامل را بررسی کنید.", FORBIDDEN: "حساب شما اجازهٔ این تغییر را ندارد.", AUTH_REQUIRED: "برای ادامه دوباره وارد شوید.", TEAM_MIGRATION_REQUIRED: "نسخهٔ جدید دیتابیس باید با نصب‌کننده آماده شود.", TOO_MANY_ATTEMPTS: "تلاش‌های ورود زیاد است؛ کمی بعد دوباره امتحان کنید." } as Record<string, string>)[payload.error] ?? (r.status === 409 ? "نسخه ابری تغییر کرده؛ همگام‌سازی متوقف شد. ابتدا نسخه ابری را بررسی کنید." : payload.error ?? "ارتباط با ابر انجام نشد."));
  }
  return payload;
}

export default function App() {
  return <AuthGate>{(session, auth) => <WorkspaceApp key={session.user.id} session={session} auth={auth} />}</AuthGate>;
}

function initialWorkspace(localMode: boolean): Store {
  if (localMode) return demoStore();
  const project = createProject("پروژه سئو");
  return { version: 1, activeProjectId: project.id, projects: [project], settings: { titleMin: 30, titleMax: 60, metaMin: 100, metaMax: 160 } };
}

function hasDraft(): boolean {
  return Boolean(document.querySelector('[data-unsaved="true"], [data-dirty="true"]'));
}
function localNavigation(state: Store, activeProjectId: string): Store {
  return state.projects.some((project) => project.id === activeProjectId) ? { ...state, activeProjectId } : state;
}

function WorkspaceApp({ session, auth }: { session: AuthSession; auth: AuthActions }) {
  const { theme, toggleTheme } = useTheme();
  const viewer = session.user.role === "viewer";
  const [store, setStore] = useState<Store | null>(null);
  const [view, setView] = useState<View>("start");
  const [keywordMode, setKeywordMode] = useState("table");
  const [pageMode, setPageMode] = useState("table");
  const [resultsMode, setResultsMode] = useState("table");
  const [focusRowId, setFocusRowId] = useState<string>();
  const [toast, setToast] = useState("");
  const [saveStatus, setSaveStatus] = useState("loading");
  const [online, setOnline] = useState(session.mode === "offline" || session.networkOnline === false ? false : navigator.onLine);
  const [sidebar, setSidebar] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [newPlaybook, setNewPlaybook] = useState<ProjectPlaybook>(() => cloneProjectPlaybook(PROJECT_PLAYBOOKS[0]));
  const [cloud, setCloud] = useState({
    configured: false,
    authenticated: false,
    active: false,
    revision: 0,
  });
  const [cloudStatus, setCloudStatus] = useState("local");
  const [cloudError, setCloudError] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const flushLocalPending = useRef<(() => void) | null>(null);
  const onlineRef = useRef(navigator.onLine);
  const ownsTab = useRef(!navigator.locks);
  const cloudEpoch = useRef(0),
    transferInProgress = useRef(false),
    autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
  const damagedLocal = useRef<unknown>(null),
    forceBackup = useRef(false);
  const localRevision = useRef(0),
    ready = useRef(false),
    saving = useRef(Promise.resolve()),
    latest = useRef<Store | null>(null),
    unsaved = useRef(false),
    cloudRef = useRef(cloud),
    cloudBusy = useRef(false),
    cloudPending = useRef(false),
    cloudStateRef = useRef<Store | null>(null);
  const cloudBase = useRef<Store | null>(null);
  const busyRetries = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  if (store) latest.current = store;
  const notify = useCallback((s: string) => {
    setToast(s);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }, []);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const announce = () => setUpdateReady(true);
    window.addEventListener("seo:update-ready", announce);
    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (registration?.waiting) announce();
    }).catch(() => {});
    return () => window.removeEventListener("seo:update-ready", announce);
  }, []);
  useEffect(() => {
    cloudRef.current = cloud;
  }, [cloud]);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);
  useEffect(() => {
    if (session.mode === "offline" || session.networkOnline === false) setOnline(false);
    else if (session.mode === "online" || session.networkOnline === true) setOnline(true);
  }, [session.mode, session.networkOnline]);
  useEffect(() => {
    let mounted = true;
    const prepare = async () => {
      try {
        const local = await loadLocal();
        if (!mounted) return;
        damagedLocal.current = local;
        let state = local ? validateStore(local.state) : initialWorkspace(session.mode === "local");
        if (
          local &&
          (!Number.isSafeInteger(local.revision) ||
            local.revision < 1 ||
            !Number.isFinite(Date.parse(local.savedAt)))
        )
          throw new Error(
            "نسخه محلی معتبر نیست؛ داده خام را برای بازیابی دانلود کنید.",
          );
        localRevision.current = local?.revision ?? 0;
        damagedLocal.current = null;
        let saved = Boolean(local);
        if (session.mode !== "local") {
          const link = readCloudLink();
          let cached: Awaited<ReturnType<typeof loadCloudBase>> = null;
          let cacheFailed = false;
          try {
            cached = await loadCloudBase(session.user.id);
            if (cached) cloudBase.current = validateStore(cached.state);
          } catch {
            cacheFailed = true;
            cached = null;
            cloudBase.current = null;
            setCloudError("مبنای ذخیرهٔ ابری این دستگاه قابل خواندن نیست؛ دادهٔ محلی محفوظ است. در تنظیمات پشتیبان بگیرید و نسخهٔ ابری را بررسی کنید.");
          }
          if (!mounted) return;
          if (session.mode === "offline") {
            const resumed = { configured: true, authenticated: true, active: !cacheFailed && Boolean(cached || link) && !viewer && ownsTab.current, revision: cached?.revision ?? link?.revision ?? 0 };
            cloudRef.current = resumed;
            setCloud(resumed);
            setCloudStatus(link ? "pending" : "local");
          } else {
            try {
              const remote = await api("state");
              if (!mounted) return;
              let decision = cloudResumeDecision(local ? await fingerprintStore(state) : null, remote.revision, Boolean(remote.state), link);
              if (cacheFailed && local && !viewer) decision = "review";
              if (cached && cached.revision > remote.revision && local && !viewer) decision = "review";
              const remoteState = remote.state ? validateStore(remote.state) : null;
              const localActive = state.activeProjectId;
              if (remoteState && viewer) decision = "cloud";
              // The saved common base lets unrelated offline and team edits
              // merge without choosing one device's entire workspace.
              if (remoteState && local && cached && cached.revision <= remote.revision && !viewer) {
                const merged = await applyChangeSet(remoteState, await buildChangeSet(cloudBase.current!, state));
                if (!mounted) return;
                if (!merged.conflicts.length) {
                  state = localNavigation(validateStore(merged.state), localActive);
                  decision = "local";
                } else decision = "conflict";
              }
              let active = false;
              if (decision === "cloud") {
                state = localNavigation(remoteState!, localActive);
                if (ownsTab.current) {
                  const record = await saveLocal(state, localRevision.current, Boolean(local));
                  localRevision.current = record.revision;
                  saved = true;
                }
                active = !viewer && ownsTab.current;
              } else if (decision === "local") {
                if (ownsTab.current) {
                  // Commit merged foreign fields before advancing the durable
                  // common base; a crash between those writes is then harmless.
                  const record = await saveLocal(state, localRevision.current);
                  localRevision.current = record.revision;
                  saved = true;
                }
                active = !viewer && ownsTab.current;
              } else if (decision === "conflict") {
                setCloudError("بعضی فیلدهای محلی و ابری هم‌زمان تغییر کرده‌اند؛ نسخهٔ محلی حفظ شد. در تنظیمات، ابتدا پشتیبان بگیرید و نسخهٔ ابری را بررسی کنید.");
              }
              if (remoteState && (decision === "cloud" || decision === "local")) {
                cloudBase.current = remoteState;
                if (ownsTab.current) {
                  await saveCloudBase(remoteState, remote.revision, session.user.id);
                  await rememberCloudLink(remoteState, remote.revision);
                }
              }
              const resumed = { configured: true, authenticated: true, active, revision: remote.revision };
              cloudRef.current = resumed;
              setCloud(resumed);
              setCloudStatus(active ? (decision === "local" ? "pending" : "synced") : "local");
            } catch (error) {
              if (!mounted) return;
              if (error instanceof TypeError || (error as Error).name === "TimeoutError") setOnline(false);
              else setCloudError((error as Error).message);
              const networkFailure = error instanceof TypeError || (error as Error).name === "TimeoutError";
              const resumed = { configured: true, authenticated: true, active: !cacheFailed && networkFailure && Boolean(cached || link) && !viewer && ownsTab.current, revision: cached?.revision ?? link?.revision ?? 0 };
              cloudRef.current = resumed;
              setCloud(resumed);
            }
          }
        }
        if (!mounted) return;
        ready.current = true;
        latest.current = state;
        setStore(state);
        setSaveStatus(saved ? "saved" : "pending");
      } catch (e) {
        if (!mounted) return;
        setSaveStatus("error");
        setReadOnly(true);
        notify((e as Error).message);
        setStore(initialWorkspace(session.mode === "local"));
      }
    };
    void prepare();
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const unload = (e: BeforeUnloadEvent) => {
      if (unsaved.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      flushLocalPending.current?.();
      cloudEpoch.current++;
      cloudPending.current = false;
      cloudRef.current = { ...cloudRef.current, active: false };
      mounted = false;
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeunload", unload);
    };
  }, [notify]);
  useEffect(() => {
    if (!navigator.locks) return;
    let release: () => void = () => {};
    navigator.locks.request(
      "rooyesh-edit-lock",
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          setReadOnly(true);
          return;
        }
        ownsTab.current = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );
    return () => release();
  }, []);
  const syncCloud = useCallback(async (state: Store) => {
    if (!cloudRef.current.active) return;
    cloudStateRef.current = state;
    cloudPending.current = true;
    if (cloudBusy.current || !onlineRef.current) {
      setCloudStatus("pending");
      return;
    }
    cloudBusy.current = true;
    const epoch = cloudEpoch.current;
    try {
      while (cloudPending.current && cloudRef.current.active && epoch === cloudEpoch.current) {
        cloudPending.current = false;
        const sent = cloudStateRef.current!;
        setCloudStatus("syncing");
        const patch = cloudBase.current ? await buildChangeSet(cloudBase.current, sent) : null;
        if (epoch !== cloudEpoch.current || !cloudRef.current.active) break;
        if (patch && !patch.changes.length) continue;
        const r = patch
          ? await api("changes", { changes: patch, revision: cloudRef.current.revision })
          : await api("state", { state: sent, revision: cloudRef.current.revision }, "PUT");
        if (epoch !== cloudEpoch.current || !cloudRef.current.active) break;
        const server = validateStore(r.state ?? sent);
        // The server can include edits from another device. Rebase anything
        // typed while this request was in flight before updating the screen.
        let merged: Store = server;
        let current: Store;
        do {
          current = latest.current ?? sent;
          const pending = await applyChangeSet(server, await buildChangeSet(sent, current));
          if (epoch !== cloudEpoch.current || !cloudRef.current.active) return;
          if (pending.conflicts.length) throw new Error("در زمان ثبت ابری، یک فیلد دوباره تغییر کرده است. تغییرات محلی حفظ شدند؛ نسخهٔ ابری را در تنظیمات بررسی کنید.");
          merged = localNavigation(validateStore(pending.state), current.activeProjectId);
        } while (current !== latest.current);
        cloudBase.current = server;
        cloudRef.current = { ...cloudRef.current, revision: r.revision };
        setCloud((c) => ({ ...c, revision: r.revision }));
        if (JSON.stringify(merged) !== JSON.stringify(current)) {
          latest.current = merged;
          setStore(merged);
          unsaved.current = true;
          const snapshot = merged;
          const commit = saving.current.then(async () => {
            const record = await saveLocal(snapshot, localRevision.current);
            localRevision.current = record.revision;
            if (latest.current === snapshot) { unsaved.current = false; setSaveStatus("saved"); }
          });
          saving.current = commit.catch(() => {});
          try { await commit; }
          catch (error) { setSaveStatus("error"); setReadOnly(true); throw error; }
          if (epoch !== cloudEpoch.current || !cloudRef.current.active) return;
        }
        if (cloudPending.current) cloudStateRef.current = latest.current ?? merged;
        await saveCloudBase(server, r.revision, session.user.id);
        await rememberCloudLink(server, r.revision);
      }
      if (epoch === cloudEpoch.current && cloudRef.current.active) {
        busyRetries.current = 0;
        setCloudStatus("synced");
        setCloudError("");
      }
    } catch (e) {
      if (epoch !== cloudEpoch.current) return;
      cloudPending.current = true;
      if (e instanceof CloudRequestError && e.code === "SYNC_BUSY" && busyRetries.current < 3) {
        const delay = 1500 * 2 ** busyRetries.current++;
        setCloudStatus("pending");
        window.setTimeout(() => { if (epoch === cloudEpoch.current && cloudRef.current.active && latest.current) void syncCloud(latest.current); }, delay);
      } else if (e instanceof TypeError || (e as Error).name === "TimeoutError") {
        setCloudStatus("pending");
        setOnline(false);
        setCloudError("");
      } else {
        setCloudStatus("error");
        setCloudError((e as Error).message);
        cloudRef.current = { ...cloudRef.current, active: false };
        setCloud((c) => ({ ...c, active: false }));
      }
    } finally {
      cloudBusy.current = false;
    }
  }, [session.user.id]);
  useEffect(() => {
    if (!store || !ready.current || readOnly || viewer) return;
    latest.current = store;
    unsaved.current = true;
    setSaveStatus("pending");
    const epoch = cloudEpoch.current;
    let committed = false;
    const persist = () => {
      if (committed) return;
      committed = true;
      saving.current = saving.current.then(async () => {
        try {
          const r = await saveLocal(
            store,
            localRevision.current,
            forceBackup.current,
          );
          localRevision.current = r.revision;
          if (latest.current === store) {
            forceBackup.current = false;
          }
          if (latest.current === store) {
            unsaved.current = false;
            setSaveStatus("saved");
          }
          if (epoch === cloudEpoch.current) void syncCloud(store);
        } catch (e) {
          setSaveStatus("error");
          setReadOnly(true);
          notify((e as Error).message);
        }
      });
    };
    const timeout = setTimeout(persist, 400);
    autosaveTimer.current = timeout;
    flushLocalPending.current = persist;
    return () => {
      clearTimeout(timeout);
      if (flushLocalPending.current === persist)
        flushLocalPending.current = null;
    };
  }, [store, notify, readOnly, viewer, syncCloud]);
  useEffect(() => {
    if (
      online &&
      cloudRef.current.active &&
      cloudPending.current &&
      latest.current
    )
      void syncCloud(latest.current);
  }, [online, syncCloud]);
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") flushLocalPending.current?.();
    };
    const hide = () => flushLocalPending.current?.();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", hide);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", hide);
    };
  }, []);
  useEffect(() => {
    if (online || !cloud.active) return;
    const timer = setInterval(() => {
      api("status")
        .then((r) => {
          if (r.configured) setOnline(true);
        })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [online, cloud.active]);
  const mutate = useCallback(
    (fn: (s: Store) => Store) => {
      if (transferInProgress.current) {
        notify("انتقال داده در حال انجام است؛ چند لحظه صبر کنید.");
        return false;
      }
      if (readOnly || viewer) {
        notify(viewer ? "حساب شما فقط اجازهٔ مشاهده دارد." : "برای ویرایش، تب دیگر را ببندید و این صفحه را تازه کنید.");
        return false;
      }
        const s = latest.current;
        if (!s) return false;
        const next = fn(s);
        const count = next.projects.reduce(
          (n, p) =>
            n +
            p.keywords.length +
            p.pages.length +
            p.content.length +
            p.results.length,
          0,
        );
        if (count > 120000) {
          notify(
            "ظرفیت این فضای کاری ۱۲۰٬۰۰۰ رکورد در مجموع پروژه‌هاست؛ یک پشتیبان جدا برای پروژه‌های قدیمی نگه دارید.",
          );
          return false;
        }
        latest.current = next;
        setStore(next);
        return true;
    },
    [readOnly, viewer, notify],
  );
  const canLeave = () => !hasDraft() || confirm("تغییرات ویرایشگر هنوز ذخیره نشده‌اند. از آن‌ها صرف‌نظر شود؟");
  const navigate = (v: View, rowId?: string) => {
    if ((v !== view || rowId) && !canLeave()) return;
    if (rowId) {
      if (v === "keywords") setKeywordMode("table");
      if (v === "pages") setPageMode("table");
      if (v === "results") {
        const current = latest.current?.projects.find((item) => item.id === latest.current?.activeProjectId);
        const result = current?.results.find((row) => row.id === rowId || row.pageId === rowId);
        rowId = result?.id;
        setResultsMode(result ? "table" : current?.searchConsole?.current ? "console" : "table");
      }
    }
    setFocusRowId(rowId);
    setView(v);
    setSidebar(false);
    window.scrollTo({ top: 0 });
  };

  const replaceStore = async (incoming: Store) => {
    if (viewer) throw new Error("حساب شما فقط اجازهٔ مشاهده دارد.");
    const next = validateStore(incoming);
    if (readOnly && !ownsTab.current)
      throw new Error(
        "این تب فقط برای مشاهده است؛ بازیابی از تب فعال انجام می‌شود.",
      );
    if (saveStatus === "error") {
      const recovered = await recoverLocal(next);
      localRevision.current = recovered.revision;
      damagedLocal.current = null;
      ready.current = true;
      latest.current = next;
      unsaved.current = false;
      cloudEpoch.current++;
      cloudRef.current = { ...cloudRef.current, active: false };
      setCloud((c) => ({ ...c, active: false }));
      setCloudStatus("local");
      setReadOnly(false);
      setSaveStatus("saved");
      setStore(next);
      forgetCloudLink();
      cloudBase.current = null;
      await clearCloudBase(session.user.id);
    } else {
      forceBackup.current = true;
      mutate(() => next);
    }
  };
  const transferCloud = async (direction: "pull" | "push") => {
    if (viewer && direction === "push") throw new Error("حساب شما فقط اجازهٔ مشاهده دارد.");
    if (readOnly)
      throw new Error(
        "این تب فقط برای مشاهده است؛ انتقال ابری از تب فعال انجام می‌شود.",
      );
    if (transferInProgress.current)
      throw new Error("انتقال دیگری در حال انجام است.");
    transferInProgress.current = true;
    cloudEpoch.current++;
    cloudRef.current = { ...cloudRef.current, active: false };
    setCloud((c) => ({ ...c, active: false }));
    setCloudStatus("local");
    clearTimeout(autosaveTimer.current);
    flushLocalPending.current = null;
    try {
      while (cloudBusy.current)
        await new Promise((resolve) => setTimeout(resolve, 30));
      cloudPending.current = false;
      await saving.current;
      const snapshot = latest.current ?? store!;
      if (unsaved.current) {
        const saved = await saveLocal(snapshot, localRevision.current);
        localRevision.current = saved.revision;
        unsaved.current = false;
        setSaveStatus("saved");
      }
      const r = await api("state");
      let base: Store;
      if (direction === "pull") {
        if (!r.state) throw new Error("نسخه ابری هنوز خالی است.");
        base = validateStore(r.state);
        const next = localNavigation(base, snapshot.activeProjectId);
        if (
          !confirm(
            "نسخه ابری جای داده‌های دستگاه را بگیرد؟ پشتیبان محلی ابتدا دانلود می‌شود.",
          )
        )
          return;
        downloadJson(snapshot, "Alireza-SEO-local-before-cloud-" + jalaliFileDate() + ".json");
        const saved = await saveLocal(next, localRevision.current, true);
        localRevision.current = saved.revision;
        latest.current = next;
        unsaved.current = false;
        setStore(next);
        cloudRef.current = {
          configured: true,
          authenticated: true,
          active: !viewer,
          revision: r.revision,
        };
      } else {
        validateStore(snapshot);
        base = snapshot;
        if (
          r.state &&
          !confirm(
            "نسخه این دستگاه جای نسخه ابری را بگیرد؟ نسخه ابری ابتدا دانلود می‌شود.",
          )
        )
          return;
        if (r.state) downloadJson(r.state, "Alireza-SEO-cloud-before-replace-" + jalaliFileDate() + ".json");
        const saved = await api(
          "state",
          { state: snapshot, revision: r.revision },
          "PUT",
        );
        cloudRef.current = {
          configured: true,
          authenticated: true,
          active: true,
          revision: saved.revision,
        };
      }
      cloudBase.current = base;
      setCloud(cloudRef.current);
      await saveCloudBase(base, cloudRef.current.revision, session.user.id);
      await rememberCloudLink(base, cloudRef.current.revision);
      setCloudStatus("synced");
      setCloudError("");
      notify("همگام‌سازی فعال شد. تغییرات بعدی خودکار ذخیره می‌شوند.");
    } finally {
      transferInProgress.current = false;
    }
  };
  const exportFile = async () => {
    if (!store) return;
    try {
      notify("خروجی Excel در حال آماده‌سازی است…");
      await (
        await import("./export")
      ).downloadWorkbook(
        store.projects.find((p) => p.id === store.activeProjectId)!,
        store.settings,
      );
      notify("خروجی Excel آماده شد.");
    } catch (e) {
      notify("خروجی انجام نشد: " + (e as Error).message);
    }
  };
  const backup = () => {
    if (store) {
      downloadJson(
        damagedLocal.current ?? latest.current ?? store,
        "Alireza-SEO-backup-" + jalaliFileDate() + ".json",
      );
      notify("پشتیبان همه پروژه‌ها دانلود شد.");
    }
  };
  if (!store)
    return (
      <div className="loading-screen">
        <div className="brand-icon">
          <Leaf />
        </div>
        <h2>استودیوی سئوی علیرضا ملائی</h2>
        <p>فضای کاری شما در حال آماده شدن است…</p>
      </div>
    );
  const project =
    store.projects.find((p) => p.id === store.activeProjectId) ??
    store.projects[0];
  const updateProject = (changes: Partial<Project>) =>
    mutate((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id === project.id ? { ...p, ...changes } : p,
      ),
    }));
  const props = {
    project,
    settings: store.settings,
    onRowsChange: (key: Collection, rows: Project[Collection]) => {
      try {
        const previous = latest.current ?? store;
        const currentProject = previous.projects.find((item) => item.id === project.id);
        if (!currentProject) return false;
        const incoming = stampProject(currentProject, { ...currentProject, [key]: rows });
        validateStore({ ...previous, projects: previous.projects.map((item) => item.id === incoming.id ? incoming : item) });
        return updateProject({ [key]: incoming[key] });
      } catch (error) { notify((error as Error).message); return false; }
    },
    notify,
    readOnly: readOnly || viewer,
    focusRowId,
    onFocusHandled: () => setFocusRowId(undefined),
    onNavigate: navigate,
  };
  const replaceProject = (next: Project) => {
    if (readOnly || viewer || transferInProgress.current) { notify("ثبت تغییرات در این وضعیت ممکن نیست؛ پیش‌نویس حفظ شد."); return false; }
    if (next.id !== project.id) { notify("پروژه فعال تغییر کرده است؛ پیشنهادها را دوباره بررسی کنید."); return false; }
    try {
      const incoming = stampProject(project, next);
      validateStore({ ...store, projects: store.projects.map((item) => item.id === incoming.id ? incoming : item) });
      return updateProject(incoming);
    } catch (error) { notify((error as Error).message); return false; }
  };
  const changeMode = (key: string, setter: (key: string) => void) => { if (canLeave()) setter(key); };
  const logout = async () => {
    if (!canLeave()) return;
    try {
      flushLocalPending.current?.();
      await saving.current;
      if (unsaved.current) throw new Error("آخرین تغییرات ذخیره نشدند؛ پیش از خروج پشتیبان بگیرید.");
      cloudEpoch.current++;
      cloudPending.current = false;
      cloudRef.current = { ...cloudRef.current, active: false };
      await auth.logout();
    } catch (error) { notify((error as Error).message); }
  };
  const installUpdate = async () => {
    if (!canLeave()) return;
    try {
      flushLocalPending.current?.();
      await saving.current;
      if (unsaved.current) throw new Error("آخرین تغییرات ذخیره نشدند؛ پیش از به‌روزرسانی پشتیبان بگیرید.");
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration?.waiting) { setUpdateReady(false); return; }
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    } catch (error) { notify((error as Error).message); }
  };
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (sidebar ? "is-open" : "")}>
        <a
          className="brand brand-personal"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("start");
          }}
        >
          <span className="brand-icon">
            <Leaf size={25} />
          </span>
          <span>
            استودیوی سئو<small>علیرضا ملائی</small>
          </span>
        </a>
        <div className="sidebar-label">پروژه فعال</div>
        <div className="project-switch">
          <span className="project-avatar">{project.name.slice(0, 1)}</span>
          <select
            aria-label="پروژه فعال"
            value={project.id}
            onChange={(e) => {
              if (!canLeave()) return;
              const id = e.target.value;
              if (viewer) setStore((state) => state ? { ...state, activeProjectId: id } : state);
              else mutate((s) => ({ ...s, activeProjectId: id }));
            }}
          >
            {store.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <button
          disabled={readOnly || viewer}
          className="new-project-link"
          onClick={() => setNewProject(true)}
        >
          <Plus size={15} /> پروژه جدید
        </button>
        <div className="sidebar-label nav-label">فضای کار</div>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.key}
              className={"nav-item " + (view === n.key ? "active" : "")}
              onClick={() => navigate(n.key)}
            >
              <n.icon size={20} />
              <span>
                {n.label}
                <small>{n.sub}</small>
              </span>
              {n.key === "keywords" && <b>{fa(project.keywords.length)}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="mini-tip">
            <Sparkles size={18} />
            <strong>هر روز، یک قدم بهتر</strong>
            <p>
              فقط روی قدم بعدی تمرکز کن.
              <br />
              بقیه مسیر اینجاست.
            </p>
            <button onClick={() => navigate("settings")}>
              راهنمای استفاده <ArrowLeft size={14} />
            </button>
          </div>
          <div className="storage-label">
            <span
              className={
                saveStatus === "saved" ? "status-dot" : "status-dot amber"
              }
            />
            {saveStatus === "saved"
              ? "ذخیره‌شده روی این دستگاه"
              : saveStatus === "pending"
                ? "در حال ذخیره…"
                : saveStatus === "error"
                  ? "خطا در ذخیره؛ پشتیبان بگیرید"
                  : "در حال آماده‌سازی"}
            <ShieldCheck size={15} />
          </div>
        </div>
      </aside>
      {sidebar && (
        <div className="sidebar-shade" onClick={() => setSidebar(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="باز کردن منو"
              onClick={() => setSidebar(true)}
            >
              <Menu />
            </button>
            <span>فضای کار</span>
            <span className="crumb-sep">/</span>
            <strong>{NAV.find((n) => n.key === view)?.label}</strong>
          </div>
          <div className="topbar-actions">
            {updateReady && <button className="icon-button" onClick={() => void installUpdate()} aria-label="نصب نسخهٔ جدید برنامه" title="نسخهٔ جدید آماده است؛ ذخیره و به‌روزرسانی"><RefreshCw size={19} /></button>}
            <button className="icon-button" onClick={toggleTheme} aria-label={theme === "light" ? "فعال کردن حالت تاریک" : "فعال کردن حالت روشن"} title={theme === "light" ? "حالت تاریک" : "حالت روشن"}>
              {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
            </button>
            <span className="connection-state">
              {online ? <span className="status-dot" /> : <WifiOff size={14} />}
              <span>
                {online
                  ? cloudStatus === "synced"
                    ? "همگام با ابر"
                    : "حالت محلی"
                  : "آفلاین · ذخیره محلی"}
              </span>
            </span>
            <button
              className="icon-button"
              title="پشتیبان JSON همه پروژه‌ها"
              aria-label="دانلود پشتیبان"
              onClick={backup}
            >
              <ShieldCheck size={19} />
            </button>
            <button
              className="btn btn-secondary export-btn"
              onClick={exportFile}
            >
              <Download size={16} />
              <span>خروجی Excel</span>
            </button>
            <span className="user-avatar" title={session.user.displayName}>{session.user.displayName.slice(0, 1)}</span>
            {session.mode !== "local" && <button className="icon-button" onClick={() => void logout()} aria-label="خروج از حساب" title="خروج از حساب"><LogOut size={18} /></button>}
          </div>
        </header>
        {(readOnly || viewer || saveStatus === "error" || cloudError) && (
          <div className="warning-banner">
            <ShieldCheck size={17} />
            {saveStatus === "error"
              ? "ذخیره محلی انجام نشد. داده‌ها را پیش از بستن صفحه دانلود کنید و مشکل حافظه را بررسی کنید."
              : viewer ? "حساب شما فقط برای مشاهده است؛ تغییر داده‌ها توسط مدیر و ویرایشگر انجام می‌شود."
              : readOnly
                ? "این فضا در تب دیگری باز است. این تب فقط برای مشاهده است؛ برای ویرایش، تب دیگر را ببندید و صفحه را تازه کنید."
                : saveStatus === "error"
                  ? "ذخیره محلی انجام نشد. پیش از بستن صفحه پشتیبان دانلود کنید."
                  : cloudError}
            <button className="btn btn-ghost" onClick={backup}>
              پشتیبان بگیر
            </button>
          </div>
        )}
        <main className="main-content"><Suspense fallback={<div className="feature-loading" role="status">در حال آماده‌سازی فضای کار…</div>}>
          {view === "start" ? (
            <Dashboard
              project={project}
              store={store}
              navigate={navigate}
              updateProject={updateProject}
              onProjectChange={replaceProject}
              readOnly={readOnly || viewer}
              notify={notify}
              draftScope={session.user.id}
            />
          ) : view === "keywords" ? (
            <fieldset disabled={readOnly} className="workspace-access">
              <WorkspaceModes items={[["table", "جدول کلمات"], ["planner", "دستیار هدف‌گذاری"]]} value={keywordMode} onChange={(key) => changeMode(key, setKeywordMode)} />
              {keywordMode === "planner" ? <PagePlanner key={project.id} project={project} onProjectChange={replaceProject} notify={notify} readOnly={readOnly || viewer} onNavigate={navigate} /> : <KeywordWorkspace key={project.id} {...props} />}
            </fieldset>
          ) : view === "bulk" ? (
            <BulkEditWorkspace key={project.id} {...props} />
          ) : view === "pages" ? (
            <fieldset disabled={readOnly} className="workspace-access">
              <WorkspaceModes items={[["table", "نقشه صفحات"], ["relationships", "ارتباط صفحات و لینک‌سازی"]]} value={pageMode} onChange={(key) => changeMode(key, setPageMode)} />
              {pageMode === "relationships" ? <PageRelationships key={project.id} project={project} onProjectChange={replaceProject} notify={notify} readOnly={readOnly || viewer} /> : <PageWorkspace key={project.id} {...props} />}
            </fieldset>
          ) : view === "content" ? (
            <fieldset disabled={readOnly} className="workspace-access">
              <ContentWorkspace key={project.id} {...props} />
            </fieldset>
          ) : view === "results" ? (
            <fieldset disabled={readOnly} className="workspace-access">
              <WorkspaceModes items={[["table", "پایش صفحات"], ["console", "تحلیل Search Console"], ["report", "گزارش پروژه"]]} value={resultsMode} onChange={(key) => changeMode(key, setResultsMode)} />
              {resultsMode === "console" ? <SearchConsoleWorkspace key={project.id} project={project} onProjectChange={replaceProject} notify={notify} readOnly={readOnly || viewer} /> : resultsMode === "report" ? <ProjectReport key={project.id} project={project} notify={notify} readOnly={readOnly || viewer} /> : <ResultsWorkspace key={project.id} {...props} />}
            </fieldset>
          ) : (
            <SettingsPanel
              store={store}
              project={project}
              mutate={mutate}
              updateProject={updateProject}
              notify={notify}
              backup={backup}
              cloud={cloud}
              setCloud={setCloud}
              setCloudStatus={setCloudStatus}
              clearCloudError={() => setCloudError("")}
              transferCloud={transferCloud}
              readOnly={readOnly || viewer}
              viewer={viewer}
              session={session}
              auth={auth}
              logout={logout}
              replaceStore={replaceStore}
              requestSnapshot={() => {
                forceBackup.current = true;
              }}
            />
          )}
          </Suspense><footer className="page-footer">
            <span>استودیوی سئوی علیرضا ملائی</span>
            <span>داده‌ها متعلق به شماست.</span>
          </footer>
        </main>
      </div>
      {newProject && (
        <div className="modal-backdrop">
          <form
            role="dialog"
            aria-modal="true"
            aria-label="پروژه جدید"
            className="modal project-modal"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              if (store.projects.length >= 50) {
                notify("حداکثر ۵۰ پروژه در یک فضای کاری پشتیبانی می‌شود.");
                return;
              }
              const p = {
                ...createProject(name.trim()),
                domain: domain.trim(),
                playbook: cloneProjectPlaybook(newPlaybook),
                projectType: newPlaybook.projectType || "Mixed",
                goal: newPlaybook.conversionGoal,
              };
              mutate((s) => ({
                ...s,
                activeProjectId: p.id,
                projects: [...s.projects, p],
              }));
              setNewProject(false);
              setName("");
              setDomain("");
              navigate("start");
              notify("پروژه جدید آماده است. از اولین کلمه شروع کنید.");
            }}
          >
            <button
              type="button"
              className="icon-button modal-close"
              aria-label="بستن"
              onClick={() => setNewProject(false)}
            >
              <X />
            </button>
            <div className="modal-symbol">
              <FolderPlus size={28} />
            </div>
            <h2>یک شروع تازه</h2>
            <p className="muted">
              هر پروژه، داده‌ها و مسیر مستقل خودش را دارد.
            </p>
            <label className="field">
              نام پروژه
              <input
                autoFocus
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثلاً فروشگاه من"
              />
            </label>
            <label className="field">
              دامنه
              <input
                dir="ltr"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
              />
            </label>
            <Suspense fallback={<p className="muted">آماده‌سازی روال پروژه…</p>}><PlaybookPicker value={newPlaybook} onChange={setNewPlaybook} customPlaybooks={store.settings.playbooks} /></Suspense>
            <button className="btn btn-primary full-width" type="submit">
              ساخت پروژه <ArrowLeft size={17} />
            </button>
          </form>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button aria-label="بستن پیام" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function Dashboard({
  project,
  store,
  navigate,
  updateProject,
  onProjectChange,
  readOnly,
  notify,
  draftScope,
}: {
  project: Project;
  store: Store;
  navigate: (v: View, rowId?: string) => void;
  updateProject: (p: Partial<Project>) => void;
  onProjectChange: (project: Project) => boolean | void;
  readOnly: boolean;
  notify: (message: string) => void;
  draftScope: string;
}) {
  const summary = useMemo(
    () => summarize(project, store.settings),
    [project, store.settings],
  );
  const targets = [
    "keywords",
    "pages",
    "pages",
    "content",
    "results",
  ] as View[];
  const stage = Math.max(1, Math.min(5, summary.stage));
  const current = targets[stage - 1];
  const stats = [
    {
      label: "کلمات کلیدی",
      value: project.keywords.length,
      detail: fa(summary.totals.reviewed) + " کلمه بررسی‌شده",
      icon: Search,
      color: "mint",
    },
    {
      label: "صفحات هدف",
      value: project.pages.length,
      detail: fa(summary.totals.ready) + " صفحه آماده اجرا",
      icon: Layers3,
      color: "violet",
    },
    {
      label: "منتشرشده",
      value: summary.totals.published,
      detail: "از ایده تا صفحه واقعی",
      icon: CheckCircle2,
      color: "blue",
    },
    {
      label: "در حال پایش",
      value: summary.totals.monitored,
      detail: "اندازه‌گیری و بهبود مستمر",
      icon: TrendingUp,
      color: "amber",
    },
  ];
  return (
    <>
      <div className="workspace-heading dashboard-heading">
        <div>
          <div className="eyebrow">
            <span className="status-dot" /> {project.name}{" "}
            <span className="subtle-divider">/</span>{" "}
            <span dir="ltr">
              {project.domain || "دامنه را در تنظیمات وارد کنید"}
            </span>
          </div>
          <h1>
            هر قدم، یک فرصت رشد<span className="heading-dot">.</span>
          </h1>
          <p>دید روشن به پروژه، تمرکز روی کاری که حالا مهم است.</p>
        </div>
        <div className="today">
          <span>{dateLabel()}</span>
          <button
            className="btn btn-ghost"
            onClick={() => {
              updateProject({
                lastReview: todayIso(),
              });
            }}
          >
            ثبت مرور امروز <Check size={14} />
          </button>
        </div>
      </div>
      <section className="hero-card">
        <div className="hero-copy">
          <span className="hero-pill">
            <Sparkles size={14} /> قدم {fa(stage)} از ۵ · {summary.stageTitle}
          </span>
          <h2>{summary.action}</h2>
          <p>
            با یک تصمیم درست شروع کن. فیلدهای پیشرفته وقتی نیازشان داری در کنار
            تو هستند.
          </p>
          <button className="btn btn-primary" onClick={() => navigate(current)}>
            ادامه مسیر <ArrowUpLeft size={18} />
          </button>
          <small>
            قدم بعد: {summary.nextStage || "اندازه‌گیری و بهبود مستمر"}
          </small>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-halo" />
          <div className="art-line line-one" />
          <div className="art-line line-two" />
          <div className="art-card art-keyword">
            <span className="art-icon">
              <Search size={19} />
            </span>
            <span>
              فرصت تازه<small>کلمات هدفمند</small>
            </span>
            <CheckCircle2 size={16} />
          </div>
          <div className="art-card art-growth">
            <span className="mini-bars">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>
              رشد پایدار<small>از برنامه تا نتیجه</small>
            </span>
            <TrendingUp size={19} />
          </div>
          <span className="art-spark spark-one">✦</span>
          <span className="art-spark spark-two">✦</span>
          <div className="art-circle">
            <Leaf size={43} />
          </div>
        </div>
      </section>
      <section className="stats-grid">
        {stats.map((s) => (
          <button
            className="stat-card"
            key={s.label}
            onClick={() =>
              navigate(
                s.label === "کلمات کلیدی"
                  ? "keywords"
                  : s.label === "در حال پایش"
                    ? "results"
                    : "pages",
              )
            }
          >
            <div>
              <span className="stat-label">{s.label}</span>
              <strong>{fa(s.value)}</strong>
              <small>{s.detail}</small>
            </div>
            <span className={"stat-icon " + s.color}>
              <s.icon size={21} />
            </span>
          </button>
        ))}
      </section>
      <ProjectAssistant key={project.id} project={project} onProjectChange={onProjectChange} onNavigate={navigate} notify={notify} readOnly={readOnly} draftScope={draftScope} />
      <section className="journey-card">
        <div className="section-title">
          <div>
            <h3>مسیر پروژه</h3>
            <p>همه چیز سر جای خودش؛ از تحقیق تا بهبود.</p>
          </div>
          <span className="badge green">مرحله {fa(stage)} از ۵</span>
        </div>
        <div className="journey-steps">
          {[
            "تحقیق کلمات",
            "نقشه صفحات",
            "سئوی صفحه",
            "اجرا و انتشار",
            "نتایج و بهبود",
          ].map((s, i) => (
            <button
              className={
                "journey-step " +
                (i + 1 === stage ? "current" : i + 1 < stage ? "done" : "")
              }
              key={s}
              onClick={() => navigate(targets[i])}
            >
              <span>{i + 1 < stage ? <Check size={16} /> : fa(i + 1)}</span>
              <strong>{s}</strong>
              <small>
                {
                  [
                    "کشف · تحلیل · گروه‌بندی",
                    "صفحه · PKW · نیت جستجو",
                    "عنوان · ساختار · لینک",
                    "محتوا · بررسی · انتشار",
                    "پایش · یادگیری · بهینه‌سازی",
                  ][i]
                }
              </small>
            </button>
          ))}
        </div>
      </section>
      <div className="dashboard-bottom dashboard-summary-only">
        <section className="health-card">
          <div className="section-title">
            <div>
              <h3>پروژه در یک نگاه</h3>
              <p>فقط داده‌های واقعی همین پروژه</p>
            </div>
            <Globe2 size={20} />
          </div>
          {[
            ["نوع پروژه", project.projectType],
            ["زبان / بازار", project.language + " / " + project.market],
            ["شروع پروژه", project.startDate ? formatDate(project.startDate) : "ثبت نشده"],
            ["آخرین مرور", project.lastReview ? formatDate(project.lastReview) : "هنوز مرور نشده"],
          ].map(([l, v]) => (
            <div className="info-row" key={l}>
              <span>{l}</span>
              <strong>{v}</strong>
            </div>
          ))}
          <div className="goal-note">
            <span>هدف سئو</span>
            <p>{project.goal || "هدفت را در تنظیمات پروژه ثبت کن."}</p>
          </div>
          <button className="text-button" onClick={() => navigate("settings")}>
            تنظیمات پروژه <ArrowLeft size={15} />
          </button>
        </section>
      </div>
      {project.name === "دوربین۲۴" && project.keywords.length <= 6 && <div className="demo-notice">
        <BookOpen size={18} />
        <span>
          پروژه اولیه چند ردیف نمونه دارد؛ می‌توانی آن‌ها را ویرایش کنی یا از
          تنظیمات پاک کنی. پروژه جدید کاملاً خالی ساخته می‌شود.
        </span>
      </div>}
    </>
  );
}

function SettingsPanel({
  store,
  project,
  mutate,
  updateProject,
  notify,
  backup,
  cloud,
  setCloud,
  setCloudStatus,
  clearCloudError,
  transferCloud,
  readOnly,
  replaceStore,
  requestSnapshot,
  viewer,
  session,
  auth,
  logout,
}: {
  store: Store;
  project: Project;
  mutate: (fn: (s: Store) => Store) => void;
  updateProject: (p: Partial<Project>) => void;
  notify: (s: string) => void;
  backup: () => void;
  cloud: {
    configured: boolean;
    authenticated: boolean;
    active: boolean;
    revision: number;
  };
  setCloud: React.Dispatch<
    React.SetStateAction<{
      configured: boolean;
      authenticated: boolean;
      active: boolean;
      revision: number;
    }>
  >;
  setCloudStatus: (s: string) => void;
  clearCloudError: () => void;
  transferCloud: (direction: "pull" | "push") => Promise<void>;
  readOnly: boolean;
  replaceStore: (state: Store) => Promise<void>;
  requestSnapshot: () => void;
  viewer: boolean;
  session: AuthSession;
  auth: AuthActions;
  logout: () => Promise<void>;
}) {
  const [tab, setTab] = useState("project");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [snapshots, setSnapshots] = useState<Stored[]>([]);
  const [guideSearch, setGuideSearch] = useState("");
  const [remote, setRemote] = useState<{
    state: Store | null;
    revision: number;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    listBackups()
      .then(setSnapshots)
      .catch(() => {});
  }, [tab]);
  const restore = async (file: File) => {
    try {
      const next = validateStore(JSON.parse(await file.text()));
      if (
        !confirm(
          "پشتیبان معتبر است و " +
            next.projects.length +
            " پروژه دارد. داده‌های فعلی با این نسخه جایگزین شوند؟ ابتدا پشتیبان فعلی به‌صورت خودکار دانلود می‌شود.",
        )
      )
        return;
      backup();
      requestSnapshot();
      await replaceStore(next);
      notify("پشتیبان بازیابی شد.");
    } catch (e) {
      notify("فایل بازیابی نشد: " + (e as Error).message);
    }
  };
  const connect = async () => {
    setBusy(true);
    try {
      await api("login", { password });
      setPassword("");
      const r = await api("state");
      setRemote(r);
      setCloud((c) => ({ ...c, authenticated: true, revision: r.revision }));
      notify("ورود انجام شد. جهت همگام‌سازی را انتخاب کنید.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cloudOperation = async (direction: "pull" | "push") => {
    setBusy(true);
    try {
      await transferCloud(direction);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const guide = Object.entries(SCHEMAS)
    .flatMap(([collection, sections]) =>
      sections.flatMap((s) =>
        s.fields.map((f) => ({ ...f, collection, section: s.label })),
      ),
    )
    .filter((f) =>
      (f.label + " " + f.key + " " + f.hint).includes(guideSearch),
    );
  return (
    <>
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">کنترل پروژه</div>
          <h1>همه چیز، طبق نیاز شما</h1>
          <p>تنظیمات، امنیت داده‌ها و راهنمای مسیر سئو.</p>
        </div>
        <span className="workspace-symbol">
          <Settings2 />
        </span>
      </div>
      <div className="settings-tabs">
        {[
          ["project", "پروژه و تنظیمات"],
          ["backup", "پشتیبان و فضای ابری"],
          ["security", "حساب و تیم"],
          ["history", "سابقه تغییرات"],
          ["guide", "راهنمای فیلدها"],
        ].map(([k, v]) => (
          <button
            className={tab === k ? "active" : ""}
            key={k}
            onClick={() => {
              if (k !== tab && hasDraft() && !confirm("تغییرات این بخش هنوز ثبت نشده‌اند. از آن‌ها صرف‌نظر شود؟")) return;
              setTab(k);
            }}
          >
            {v}
          </button>
        ))}
      </div>
      {tab === "project" ? (
        <>
          <section className="settings-card">
            <h3>هویت پروژه</h3>
            <p className="muted">
              این اطلاعات فقط برای پروژه «{project.name}» است.
            </p>
            <div className="form-grid">
              {[
                ["name", "نام پروژه"],
                ["domain", "دامنه"],
                ["market", "بازار"],
                ["language", "زبان"],
                ["goal", "هدف سئو"],
                ["startDate", "تاریخ شروع"],
                ["lastReview", "آخرین مرور"],
              ].map(([k, l]) => (
                <label className="field" key={k}>
                  {l}
                  {k === "startDate" || k === "lastReview" ? <JalaliDateInput
                    disabled={readOnly}
                    value={String(project[k as keyof Project] ?? "")}
                    onChange={(value) => updateProject({ [k]: value })}
                    aria-label={l}
                  /> : <input
                    disabled={readOnly}
                    type="text"
                    value={String(project[k as keyof Project] ?? "")}
                    maxLength={10000}
                    onChange={(e) => {
                      if (k === "name" && !e.target.value.trim()) return;
                      updateProject({ [k]: e.target.value });
                    }}
                  />}
                </label>
              ))}
              <label className="field">
                نوع پروژه
                <select
                  disabled={readOnly}
                  value={project.projectType}
                  onChange={(e) =>
                    updateProject({ projectType: e.target.value })
                  }
                >
                  {LISTS.projectType.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <section className="settings-card">
            <h3>روال و مخاطب پروژه</h3><p className="muted">روال انتخابی، ساختار بریف‌ها و پیشنهادهای این پروژه را مشخص می‌کند.</p>
            <PlaybookPicker value={project.playbook} disabled={readOnly} customPlaybooks={store.settings.playbooks} onChange={(value) => updateProject({ playbook: cloneProjectPlaybook(value), projectType: value.projectType || project.projectType, goal: project.goal || value.conversionGoal })} onSave={(value) => {
              if (readOnly) return false;
              const existing = store.settings.playbooks || [];
              if (existing.length >= 30 && !existing.some((item) => item.id === value.id)) { notify("حداکثر ۳۰ روال شخصی قابل نگهداری است."); return false; }
              mutate((state) => ({ ...state, settings: { ...state.settings, playbooks: [...(state.settings.playbooks || []).filter((item) => item.id !== value.id), cloneProjectPlaybook(value)] } }));
              return true;
            }} />
          </section>
          <section className="settings-card">
            <h3>سیگنال‌های بررسی عنوان و متا</h3>
            <p className="muted">
              طول، فقط یادآور بازبینی است؛ امتیاز یا تضمین رتبه نیست.
            </p>
            <div className="form-grid thresholds">
              {[
                ["titleMin", "حداقل طول عنوان"],
                ["titleMax", "حداکثر طول عنوان"],
                ["metaMin", "حداقل طول متا"],
                ["metaMax", "حداکثر طول متا"],
              ].map(([k, l]) => (
                <label className="field" key={k}>
                  {l}
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={
                      store.settings[k as keyof typeof store.settings] as number
                    }
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 0 && n <= 1000)
                        mutate((s) => {
                          const settings = { ...s.settings, [k]: n };
                          if (k === "titleMin" && n > settings.titleMax)
                            settings.titleMax = n;
                          if (k === "titleMax" && n < settings.titleMin)
                            settings.titleMin = n;
                          if (k === "metaMin" && n > settings.metaMax)
                            settings.metaMax = n;
                          if (k === "metaMax" && n < settings.metaMin)
                            settings.metaMin = n;
                          return { ...s, settings };
                        });
                    }}
                  />
                </label>
              ))}
            </div>
            {(store.settings.titleMin > store.settings.titleMax ||
              store.settings.metaMin > store.settings.metaMax) && (
              <p className="validation-message">
                حداقل باید کوچک‌تر یا برابر حداکثر باشد.
              </p>
            )}
          </section>
          <section className="settings-card">
            <h3>فیلدهای اختصاصی</h3>
            <p className="muted">
              نام را تغییر بده؛ هویت داده‌های قبلی ثابت می‌ماند.
            </p>
            <div className="form-grid">
              {Array.from(
                { length: 10 },
                (_, i) => "custom" + String(i + 1).padStart(2, "0"),
              ).map((k, i) => (
                <label className="field" key={k}>
                  فیلد {fa(i + 1)}
                  <input
                    maxLength={100}
                    placeholder={"Custom " + String(i + 1).padStart(2, "0")}
                    value={store.settings.customLabels?.[k] ?? ""}
                    onChange={(e) =>
                      mutate((s) => ({
                        ...s,
                        settings: {
                          ...s.settings,
                          customLabels: {
                            ...s.settings.customLabels,
                            [k]: e.target.value,
                          },
                        },
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </section>
          <section className="settings-card danger-zone">
            <h3>مدیریت داده‌های پروژه</h3>
            <p className="muted">
              پیش از حذف، یک نسخه پشتیبان دانلود می‌شود. سایر پروژه‌ها حفظ
              می‌شوند.
            </p>
            <div className="action-row">
              <button
                disabled={readOnly}
                className="btn btn-secondary"
                onClick={() => {
                  if (
                    confirm(
                      "همه کلمات، صفحات، محتوا و نتایج این پروژه پاک شوند؟",
                    )
                  ) {
                    backup();
                    updateProject({
                      keywords: [],
                      pages: [],
                      content: [],
                      results: [],
                    });
                    notify(
                      "داده‌های پروژه پاک شدند؛ پشتیبان برای بازیابی در اختیار شماست.",
                    );
                  }
                }}
              >
                پاک‌سازی داده‌های این پروژه
              </button>
              {store.projects.length > 1 && (
                <button
                  disabled={readOnly}
                  className="btn btn-danger"
                  onClick={() => {
                    if (
                      confirm(
                        "پروژه «" +
                          project.name +
                          "» با همه داده‌هایش حذف شود؟",
                      )
                    ) {
                      backup();
                      mutate((s) => {
                        const projects = s.projects.filter(
                          (p) => p.id !== project.id,
                        );
                        return {
                          ...s,
                          projects,
                          activeProjectId: projects[0].id,
                        };
                      });
                      notify("پروژه حذف شد.");
                    }
                  }}
                >
                  حذف پروژه
                </button>
              )}
            </div>
          </section>
        </>
      ) : tab === "backup" ? (
        <>
          <section className="settings-card">
            <div className="section-title">
              <div>
                <h3>داده‌های شما، همیشه در اختیار شما</h3>
                <p>
                  پشتیبان JSON همه داده‌ها و تنظیمات را حفظ می‌کند؛ Excel برای
                  خروجی قابل اشتراک است.
                </p>
              </div>
              <ShieldCheck size={26} />
            </div>
            <div className="action-row">
              <button className="btn btn-primary" onClick={backup}>
                <Download size={16} /> دانلود پشتیبان کامل
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => input.current?.click()}
              >
                <Upload size={16} /> بازیابی پشتیبان
              </button>
              <input
                hidden
                ref={input}
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void restore(f);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="offline-explainer">
              <WifiOff size={20} />
              <div>
                <strong>حتی وقتی اینترنت قطع می‌شود</strong>
                <p>
                  اطلاعات در IndexedDB دستگاه ذخیره می‌شود. نسخه انتشار‌یافته پس
                  از اولین بارگذاری کامل، آفلاین باز می‌شود. پاک‌کردن داده
                  مرورگر ممکن است نسخه محلی را حذف کند؛ پشتیبان را خارج از این
                  دستگاه نگه دارید.
                </p>
              </div>
            </div>
          </section>
          <section className="settings-card">
            <h3>نسخه‌های محلی پیشین</h3>
            <p className="muted">
              تا ۸ نسخه اخیر همین دستگاه؛ جایگزین پشتیبان دانلودی نیست.
            </p>
            {snapshots.length ? (
              snapshots.map((s) => (
                <div className="snapshot-row" key={s.savedAt}>
                  <span>
                    {formatDate(s.savedAt, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                  <span>{fa(s.state.projects.length)} پروژه</span>
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      if (
                        confirm(
                          "این نسخه جایگزین داده‌های فعلی شود؟ پشتیبان فعلی دانلود می‌شود.",
                        )
                      ) {
                        backup();
                        requestSnapshot();
                        try {
                          await replaceStore(validateStore(s.state));
                          notify("نسخه محلی بازیابی شد.");
                        } catch (e) {
                          notify((e as Error).message);
                        }
                      }
                    }}
                  >
                    بازیابی
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">
                نسخه‌های پیشین با ادامه کار به‌صورت خودکار ثبت می‌شوند.
              </p>
            )}
          </section>
          <section className="settings-card cloud-card">
            <div className="section-title">
              <div>
                <h3>همراه شما، روی دستگاه‌های دیگر</h3>
                <p>
                  همگام‌سازی روی Cloudflare D1، با ورود محافظت‌شده و کنترل
                  اختلاف نسخه‌ها.
                </p>
              </div>
              <Cloud size={26} />
            </div>
            {!cloud.configured ? (
              <div className="cloud-empty">
                <span className="badge amber">ذخیره محلی فعال است</span>
                <p>
                  فضای ابری در این اجرا پیکربندی نشده است. راهنمای README پروژه
                  مراحل اتصال D1 و رمز ورود را دارد. رمز در سورس یا مرورگر ذخیره
                  نمی‌شود.
                </p>
              </div>
            ) : !cloud.authenticated ? (
              <form
                className="cloud-login"
                onSubmit={(e) => {
                  e.preventDefault();
                  void connect();
                }}
              >
                <label className="field">
                  رمز فضای ابری
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <button disabled={busy} className="btn btn-primary">
                  {busy ? "در حال اتصال…" : "اتصال به فضای ابری"}
                </button>
              </form>
            ) : (
              <>
                <span className={"badge " + (cloud.active ? "green" : "amber")}>
                  {cloud.active
                    ? "همگام‌سازی خودکار فعال"
                    : "وارد شده‌اید · جهت انتقال را انتخاب کنید"}
                </span>
                <p className="muted">
                  انتقال اولیه با انتخاب شما انجام می‌شود. اطلاعات متفاوت بدون
                  تأیید جایگزین نمی‌شوند.
                </p>
                <div className="action-row">
                  <button
                    disabled={busy || (readOnly && !viewer) || session.mode === "offline"}
                    className="btn btn-secondary"
                    onClick={() => void cloudOperation("pull")}
                  >
                    <Download size={16} /> دریافت نسخه ابری
                  </button>
                  <button
                    disabled={busy || readOnly}
                    className="btn btn-primary"
                    onClick={() => void cloudOperation("push")}
                  >
                    <Upload size={16} /> ارسال نسخه این دستگاه
                  </button>
                  <button
                    disabled={busy}
                    className="btn btn-ghost"
                    onClick={() => void logout()}
                  >
                    خروج
                  </button>
                </div>
                {remote?.state && (
                  <p className="muted">
                    نسخه ابری دارای {fa(remote.state.projects.length)} پروژه
                    است.
                  </p>
                )}
              </>
            )}
          </section>
        </>
      ) : tab === "history" ? (
        <ProjectHistory projectId={project.id} mode={session.mode} />
      ) : tab === "security" ? (
        <>
          <TeamSettings session={session} onSessionRefresh={auth.refresh} readOnly={session.mode === "offline"} />
          {session.mode !== "local" && <section className="settings-card">
            <h3>دسترسی آفلاین این دستگاه</h3>
            <label className="field offline-access-choice">
              <span><input type="checkbox" checked={auth.offlineEnabled} onChange={(event) => auth.setOfflineEnabled(event.target.checked)} /> این دستگاه شخصی است؛ دسترسی آفلاین فعال باشد</span>
            </label>
            <p className="muted">این انتخاب فقط برای همین مرورگر است. پس از خروج یا پایان اعتبار ورود، دسترسی آفلاین بسته می‌شود. روی دستگاه مشترک آن را فعال نکنید.</p>
          </section>}
        </>
      ) : (
        <>
          <section className="settings-card stage-guide">
            <h3>از کجا شروع کنم؟</h3>
            {[
              [
                "۱ · تحقیق کلمات",
                "کلمه، حجم، سختی، نیت، تصمیم و گروه را ثبت کن. عنوان و H1 را بعداً بررسی کن.",
              ],
              [
                "۲ · نقشه صفحات",
                "هر صفحه یک ردیف. PKW را با قضاوت انسانی انتخاب کن؛ SERP تعیین می‌کند کلمات روی یک صفحه باشند یا جدا.",
              ],
              [
                "۳ · سئوی صفحه",
                "در پنل صفحه، بخش عنوان/H1/متا و بریف را باز کن. H1 و Title لازم نیست یکسان باشند.",
              ],
              [
                "۴ · اجرا",
                "محتوا را تولید کن، لینک داخلی و بررسی فنی را انجام بده و تاریخ انتشار ثبت کن.",
              ],
              [
                "۵ · نتایج",
                "داده واقعی Search Console و فروش را وارد کن؛ بازه‌های برابر را مقایسه و اقدام بعدی را مشخص کن.",
              ],
            ].map(([t, d]) => (
              <div className="guide-step" key={t}>
                <strong>{t}</strong>
                <p>{d}</p>
              </div>
            ))}
          </section>
          <section className="settings-card">
            <h3>فرهنگ فیلدها</h3>
            <p className="muted">
              عدد صفر با مقدار خالی متفاوت است. فیلدهای محاسباتی قابل ویرایش
              نیستند؛ انتخاب‌های سئو همیشه انسانی‌اند.
            </p>
            <input
              className="search-input guide-search"
              placeholder="جستجوی نام یا کاربرد فیلد…"
              value={guideSearch}
              onChange={(e) => setGuideSearch(e.target.value)}
            />
            <div className="field-guide-grid">
              {guide.map((f, i) => (
                <div
                  className="field-guide-item"
                  key={f.collection + f.key + i}
                >
                  <span className="badge gray">{f.section}</span>
                  <h4>{f.label}</h4>
                  <p>
                    {f.hint ||
                      (
                        {
                          pkw: "کلمه اصلی هدف صفحه؛ پس از گروه‌بندی و بررسی نتایج جستجو انتخاب می‌شود.",
                          volume:
                            "تخمین تعداد جستجو در بازه ابزار؛ تضمین ترافیک نیست.",
                          pillar:
                            "موضوع مادر برای سازمان‌دهی محتوا و لینک داخلی.",
                          cluster: "خوشه موضوعی؛ صرف شباهت کلمات کافی نیست.",
                          position:
                            "میانگین جایگاه در Search Console؛ عدد کوچک‌تر معمولاً بهتر است.",
                          proposedTitle:
                            "عنوان پیشنهادی برای نتیجه جستجو؛ می‌تواند با H1 متفاوت باشد.",
                        } as Record<string, string>
                      )[f.key] ||
                      "در بخش «" +
                        f.section +
                        "» استفاده می‌شود. " +
                        (f.calculated
                          ? "از داده‌های همین رکورد محاسبه می‌شود."
                          : f.options
                            ? "یک گزینه از فهرست انتخاب کنید."
                            : "داده واقعی این مورد را وارد کنید؛ در صورت نامشخص بودن خالی بگذارید.")}
                  </p>
                  {f.options && <small>{f.options.join(" · ")}</small>}
                </div>
              ))}
            </div>
          </section>
          <section className="settings-card">
            <h3>فهرست‌های استاندارد</h3>
            <p className="muted">
              این گزینه‌ها در همه پروژه‌ها یکسان‌اند تا واردکردن و خروجی پایدار
              بماند.
            </p>
            {Object.entries(LISTS).map(([key, values]) => (
              <details className="section-accordion" key={key}>
                <summary>
                  {key} <ChevronDown size={14} />
                </summary>
                <div className="canonical-list">
                  {values.map((v: string) => (
                    <span className="badge gray" key={v}>
                      {v}
                    </span>
                  ))}
                </div>
              </details>
            ))}
          </section>
        </>
      )}
    </>
  );
}
