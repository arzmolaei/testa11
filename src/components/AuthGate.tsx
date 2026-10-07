import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Eye, EyeOff, KeyRound, Leaf, LockKeyhole, Moon, RefreshCw, ShieldCheck, Sparkles, Sun, UsersRound, WifiOff } from "lucide-react";
import {
  AUTH_EXPIRED_EVENT, AUTH_LOGOUT_EVENT, AuthApiError, authRequest,
  forgetRememberedSession, PENDING_LOGOUT_KEY, readRememberedSession,
  rememberSession, REMEMBERED_SESSION_KEY, validAuthUser,
  type AuthActions, type AuthSession, type AuthStatus,
} from "../auth";
import "./AuthGate.css";
import { useTheme } from "../theme";

const LOCAL_SESSION: AuthSession = {
  mode: "local",
  user: { id: "local-development", username: "alireza", displayName: "علیرضا ملائی", role: "owner" },
};
const isLocalDevelopment = () => import.meta.env.DEV
  || ["localhost", "127.0.0.1", "[::1]", "::1"].includes(window.location.hostname);
const isLoopback = () => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(window.location.hostname);
const VERIFIED_LOCAL_KEY = "seo-studio:verified-local-development:v1";
function verifiedLocalDevelopment() {
  if (!isLoopback()) return false;
  try { return localStorage.getItem(VERIFIED_LOCAL_KEY) === "1"; } catch { return false; }
}
function markLocalDevelopment(value: boolean) {
  try {
    if (value && isLoopback()) localStorage.setItem(VERIFIED_LOCAL_KEY, "1");
    else localStorage.removeItem(VERIFIED_LOCAL_KEY);
  } catch { /* Local development continues without the optional offline marker. */ }
}
type GateState = "checking" | "login" | "setup" | "unavailable";

function pendingLogout(): boolean {
  try { return localStorage.getItem(PENDING_LOGOUT_KEY) === "1"; } catch { return false; }
}
function setPendingLogout(value: boolean) {
  try {
    if (value) localStorage.setItem(PENDING_LOGOUT_KEY, "1");
    else localStorage.removeItem(PENDING_LOGOUT_KEY);
  } catch { /* In private mode, the in-memory gate still closes. */ }
}

export function AuthGate({ children }: {
  children: (session: AuthSession, actions: AuthActions) => ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [state, setState] = useState<GateState>("checking");
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offlineEnabled, setOffline] = useState(() => Boolean(readRememberedSession()));
  const sessionRef = useRef<AuthSession | null>(null);
  const offlineRef = useRef(offlineEnabled);
  const generation = useRef(0);
  const alive = useRef(true);
  const checking = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);

  const acceptSession = useCallback((next: AuthSession) => {
    sessionRef.current = next;
    setSession(next);
    setError("");
    setPassword("");
    if (offlineRef.current && next.mode === "online") {
      if (!rememberSession(next)) {
        offlineRef.current = false;
        setOffline(false);
        forgetRememberedSession();
      }
    }
  }, []);

  const lock = useCallback((message = "") => {
    generation.current++;
    sessionRef.current = null;
    setSession(null);
    setState("login");
    setPassword("");
    setError(message);
  }, []);

  const refresh = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    const currentGeneration = generation.current;
    const updateAllowed = () => alive.current && generation.current === currentGeneration;
    try {
      if (pendingLogout()) {
        await authRequest("logout", { method: "POST", notifyUnauthorized: false });
        setPendingLogout(false);
      }
      const status = await authRequest<AuthStatus>("status", { notifyUnauthorized: false });
      if (!updateAllowed()) return;
      if (!status || typeof status.configured !== "boolean" || typeof status.authenticated !== "boolean") {
        throw new AuthApiError("API_UNAVAILABLE", 200);
      }
      markLocalDevelopment(false);
      if (!status.configured) {
        forgetRememberedSession();
        sessionRef.current = null;
        setSession(null);
        setState("setup");
      } else if (status.authenticated && validAuthUser(status.user)) {
        acceptSession({ user: status.user, expiresAt: status.expiresAt, mode: "online" });
      } else {
        forgetRememberedSession();
        lock(sessionRef.current ? "اعتبار ورود شما تمام شده است. دوباره وارد شوید." : "");
      }
    } catch (cause) {
      if (!updateAllowed()) return;
      if (cause instanceof AuthApiError && cause.code === "API_UNAVAILABLE" && isLocalDevelopment()) {
        markLocalDevelopment(true);
        acceptSession({ ...LOCAL_SESSION, networkOnline: true });
      } else {
        if (cause instanceof AuthApiError) markLocalDevelopment(false);
        // Only network failure permits an explicitly remembered offline session.
        const networkFailure = !(cause instanceof AuthApiError);
        if (networkFailure && verifiedLocalDevelopment() && !pendingLogout()) {
          acceptSession({ ...LOCAL_SESSION, networkOnline: false });
          return;
        }
        const remembered = networkFailure && !pendingLogout() ? readRememberedSession() : null;
        if (remembered) acceptSession(remembered);
        else {
          sessionRef.current = null;
          setSession(null);
          setState("unavailable");
          setError(cause instanceof AuthApiError ? cause.message
            : "ارتباط برقرار نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.");
        }
      }
    } finally { checking.current = false; }
  }, [acceptSession, lock]);

  const setOfflineEnabled = useCallback((enabled: boolean) => {
    if (enabled && sessionRef.current?.mode === "online" && !rememberSession(sessionRef.current)) {
      offlineRef.current = false;
      setOffline(false);
      return;
    }
    offlineRef.current = enabled;
    setOffline(enabled);
    if (!enabled) {
      forgetRememberedSession();
      if (sessionRef.current?.mode === "offline") {
        lock("دسترسی آفلاین این دستگاه بسته شد. برای ورود دوباره به اینترنت وصل شوید.");
      }
    }
  }, [lock]);

  const logout = useCallback(async () => {
    if (!window.dispatchEvent(new Event("seo:before-logout", { cancelable: true }))) return;
    window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
    generation.current++;
    forgetRememberedSession();
    setPendingLogout(true);
    offlineRef.current = false;
    setOffline(false);
    lock();
    setBusy(true);
    try {
      await authRequest("logout", { method: "POST", notifyUnauthorized: false });
      setPendingLogout(false);
    } catch {
      setError("از این دستگاه خارج شدید. با اتصال اینترنت، خروج از نشست ابری هم کامل می‌شود.");
    } finally { if (alive.current) setBusy(false); }
  }, [lock]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const expired = () => {
      forgetRememberedSession();
      lock("اعتبار ورود شما تمام شده است. دوباره وارد شوید.");
    };
    const online = () => { void refresh(); };
    const offline = () => {
      if (sessionRef.current?.mode === "local") return;
      const remembered = readRememberedSession();
      if (remembered && !pendingLogout()) acceptSession(remembered);
      else lock("برای ورود به اینترنت وصل شوید. دسترسی آفلاین این دستگاه فعال نیست.");
    };
    const storage = (event: StorageEvent) => {
      if ((event.key === PENDING_LOGOUT_KEY && event.newValue === "1")
        || (event.key === REMEMBERED_SESSION_KEY && event.newValue === null && sessionRef.current?.mode === "offline")) {
        offlineRef.current = false;
        setOffline(false);
        lock("از حساب در پنجره دیگری خارج شدید.");
      }
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("storage", storage);
    const timer = setInterval(() => {
      const current = sessionRef.current;
      if (current?.expiresAt && Date.parse(current.expiresAt) <= Date.now()) expired();
      else if (current && current.mode !== "local" && navigator.onLine && document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => {
      alive.current = false;
      generation.current++;
      clearInterval(timer);
      window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("storage", storage);
    };
  }, [acceptSession, lock, refresh]);

  useEffect(() => {
    if (!session?.expiresAt) return;
    const remaining = Date.parse(session.expiresAt) - Date.now();
    const expire = () => {
      forgetRememberedSession();
      lock("اعتبار ورود شما تمام شده است. دوباره وارد شوید.");
    };
    const timer = setTimeout(expire, Math.max(0, remaining));
    const visible = () => {
      if (document.visibilityState === "visible" && Date.parse(session.expiresAt!) <= Date.now()) expire();
    };
    document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [session, lock]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    generation.current++;
    const currentGeneration = generation.current;
    try {
      if (pendingLogout()) {
        await authRequest("logout", { method: "POST", notifyUnauthorized: false });
        setPendingLogout(false);
      }
      await authRequest("login", {
        body: { username: username.trim().toLowerCase(), password }, notifyUnauthorized: false,
      });
      const status = await authRequest<AuthStatus>("status", { notifyUnauthorized: false });
      if (!alive.current || generation.current !== currentGeneration) return;
      if (!status.authenticated || !validAuthUser(status.user)) throw new AuthApiError("UNAUTHORIZED", 401);
      acceptSession({ user: status.user, expiresAt: status.expiresAt, mode: "online" });
    } catch (cause) {
      if (!alive.current || generation.current !== currentGeneration) return;
      setError(cause instanceof AuthApiError ? cause.message
        : "ورود انجام نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.");
      setPassword("");
      passwordInput.current?.focus();
    } finally { if (alive.current && generation.current === currentGeneration) setBusy(false); }
  }

  if (session) return children(session, { logout, refresh, offlineEnabled, setOfflineEnabled });

  return <main className="auth-gate" dir="rtl">
    <button className="auth-theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "فعال‌کردن حالت روشن" : "فعال‌کردن حالت تاریک"} title={theme === "dark" ? "حالت روشن" : "حالت تاریک"}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
    <div className="auth-layout">
      <section className="auth-intro" aria-label="استودیوی سئو">
        <div className="auth-brand"><span className="auth-brand-icon"><Leaf size={27} /></span><span>استودیوی سئو<small>علیرضا ملائی</small></span></div>
        <span className="auth-eyebrow"><Sparkles size={14} /> فضای اختصاصی کار شما</span>
        <h1>همه‌چیز برای<br />قدم بعدیِ سئو.</h1>
        <p>از پژوهش کلمات تا برنامه‌ریزی محتوا و بررسی نتیجه؛ پروژه‌ها و تیم شما در یک فضای منظم و امن.</p>
        <div className="auth-feature-list">
          <span><ShieldCheck size={18} /> ورود اختصاصی و دسترسی مشخص</span>
          <span><UsersRound size={18} /> همکاری با حساب‌های مستقل تیم</span>
          <span><Check size={18} /> ادامه کار از همان‌جایی که بودید</span>
        </div>
        <div className="auth-accent-card" aria-hidden="true">
          <span className="auth-accent-symbol"><Sparkles size={22} /></span>
          <div><b>فکر کمتر به ابزار، تمرکز بیشتر روی رشد</b><small>ساده، مرتب و آماده برای کار هر روز</small></div>
        </div>
      </section>
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-panel-symbol">{state === "checking" ? <RefreshCw className="auth-spin" size={25} /> : state === "unavailable" ? <WifiOff size={25} /> : <LockKeyhole size={25} />}</div>
        {state === "checking" ? <>
          <h2 id="auth-title">در حال بررسی ورود</h2>
          <p className="auth-description" role="status">چند لحظه صبر کنید؛ فضای کاری شما آماده می‌شود.</p>
        </> : state === "setup" ? <>
          <h2 id="auth-title">یک قدم تا شروع</h2>
          <p className="auth-description">ورود امن این نسخه هنوز راه‌اندازی نشده است. نصب‌کننده ویندوز را اجرا کنید تا اتصال ابری، حساب مالک و رمز ورود آماده شوند.</p>
          <button className="auth-submit" type="button" onClick={() => { setState("checking"); void refresh(); }}><RefreshCw size={16} /> بررسی دوباره</button>
        </> : state === "unavailable" ? <>
          <h2 id="auth-title">ارتباط در دسترس نیست</h2>
          <p className="auth-description">برای بررسی ورود، به اینترنت نیاز دارید. اگر دسترسی آفلاین را روی این دستگاه فعال کرده باشید، می‌توانید تا پایان اعتبار ورود به کار ادامه دهید.</p>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" type="button" onClick={() => { setError(""); setState("checking"); void refresh(); }}><RefreshCw size={16} /> تلاش دوباره</button>
        </> : <>
          <h2 id="auth-title">خوش آمدید</h2>
          <p className="auth-description">برای ورود به فضای کاری، اطلاعات حساب خود را وارد کنید.</p>
          <form className="auth-form" onSubmit={login}>
            <label htmlFor="auth-username">نام کاربری</label>
            <input id="auth-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" placeholder="alireza" maxLength={32} value={username} onChange={event => setUsername(event.target.value)} disabled={busy} required />
            <label htmlFor="auth-password">رمز عبور</label>
            <div className="auth-password-field">
              <input ref={passwordInput} id="auth-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" dir="ltr" maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required />
              <button type="button" aria-label={showPassword ? "پنهان‌کردن رمز عبور" : "نمایش رمز عبور"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </div>
            <label className="auth-remember"><input type="checkbox" checked={offlineEnabled} onChange={event => setOfflineEnabled(event.target.checked)} disabled={busy} /><span>این دستگاه شخصی است؛ دسترسی آفلاین فعال شود<small>دسترسی روی همین مرورگر، تا پایان اعتبار ورود. در دستگاه مشترک فعال نکنید.</small></span></label>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? <RefreshCw className="auth-spin" size={17} /> : <ArrowLeft size={17} />} {busy ? "در حال ورود…" : "ورود به استودیو"}</button>
          </form>
          <p className="auth-owner-hint"><KeyRound size={13} /> نام کاربری اولیه مالک: <b dir="ltr">alireza</b></p>
        </>}
        <div className="auth-footer"><ShieldCheck size={14} /> اطلاعات پروژه‌ها فقط پس از ورود نمایش داده می‌شوند.</div>
      </section>
    </div>
    <p className="auth-page-footer">استودیوی سئوی علیرضا ملائی · فضای کاری اختصاصی شما و تیمتان</p>
  </main>;
}
