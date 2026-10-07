export type UserRole = "owner" | "editor" | "viewer";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface AuthSession {
  user: AuthUser;
  expiresAt?: string;
  mode: "online" | "offline" | "local";
  networkOnline?: boolean;
}

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  user?: AuthUser;
  expiresAt?: string;
}

export interface AuthActions {
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  offlineEnabled: boolean;
  setOfflineEnabled: (enabled: boolean) => void;
}

export interface TeamUser extends AuthUser {
  disabled: boolean;
  createdAt: string;
}

export const AUTH_EXPIRED_EVENT = "seo:auth-expired";
export const AUTH_LOGOUT_EVENT = "seo:logout";
export const REMEMBERED_SESSION_KEY = "seo-studio:personal-device:v1";
export const PENDING_LOGOUT_KEY = "seo-studio:pending-logout:v1";
const MAX_OFFLINE_AGE = 7 * 24 * 60 * 60 * 1000;

export class AuthApiError extends Error {
  constructor(public code: string, public status: number) {
    super(authErrorMessage(code));
    this.name = "AuthApiError";
  }
}

export function authErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: "نام کاربری یا رمز عبور درست نیست.",
    TOO_MANY_ATTEMPTS: "تعداد تلاش‌ها زیاد شده است. کمی بعد دوباره امتحان کنید.",
    TEAM_MIGRATION_REQUIRED: "جدول‌های حساب کاربری آماده نیستند. نصب‌کننده را دوباره اجرا کنید تا به‌روزرسانی کامل شود.",
    RECORD_SYNC_MIGRATION_REQUIRED: "جدول سابقهٔ تغییرات آماده نیست؛ نصب‌کنندهٔ آسان را دوباره اجرا کنید تا به‌روزرسانی کامل شود.",
    NOT_CONFIGURED: "اتصال ابری و رمز ورود هنوز تنظیم نشده‌اند.",
    UNAUTHORIZED: "اعتبار ورود شما تمام شده است. دوباره وارد شوید.",
    FORBIDDEN: "حساب شما دسترسی انجام این کار را ندارد.",
    USERNAME_EXISTS: "این نام کاربری قبلاً ثبت شده است.",
    USER_EXISTS: "این نام کاربری قبلاً ثبت شده است.",
    INVALID_USERNAME: "نام کاربری باید ۳ تا ۳۲ حرف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد و با حرف شروع شود.",
    INVALID_PASSWORD: "رمز عبور باید بین ۱۲ تا ۱۲۸ نویسه باشد.",
    PASSWORD_TOO_SHORT: "رمز عبور باید دست‌کم ۱۲ نویسه باشد.",
    PASSWORD_LENGTH: "رمز عبور باید بین ۱۲ تا ۱۲۸ نویسه باشد.",
    INVALID_ROLE: "نقش انتخاب‌شده معتبر نیست.",
    USER_NOT_FOUND: "این حساب پیدا نشد. فهرست را دوباره دریافت کنید.",
    USER_CHANGED: "این حساب هم‌زمان تغییر کرده است. فهرست را دوباره دریافت کنید.",
    TEAM_LIMIT_REACHED: "ظرفیت این فضای کاری تکمیل است؛ حداکثر ۱۰۰ حساب می‌توانید داشته باشید.",
    OWNER_PROTECTED: "حساب مالک قابل غیرفعال‌کردن یا تغییر نقش نیست.",
    INVALID_DISPLAY_NAME: "نام نمایشی را وارد کنید؛ حداکثر ۸۰ نویسه.",
    INVALID_NAME: "نام نمایشی را وارد کنید؛ حداکثر ۸۰ نویسه.",
    INVALID_INPUT: "اطلاعات واردشده را بررسی کنید.",
    INVALID_JSON: "اطلاعات ارسالی معتبر نیست. دوباره تلاش کنید.",
    ORIGIN_NOT_ALLOWED: "درخواست از این نشانی مجاز نیست. برنامه را از دامنه اصلی باز کنید.",
    BAD_ORIGIN: "درخواست از این نشانی مجاز نیست. برنامه را از دامنه اصلی باز کنید.",
    SERVICE_UNAVAILABLE: "سرویس ابری در دسترس نیست. کمی بعد دوباره تلاش کنید.",
  };
  return messages[code] ?? (code && /[\u0600-\u06ff]/.test(code)
    ? code
    : "این کار انجام نشد. دوباره تلاش کنید.");
}

export async function authRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; notifyUnauthorized?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal ?? AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const isJSON = response.headers.get("Content-Type")?.includes("application/json");
  if (!isJSON) throw new AuthApiError("API_UNAVAILABLE", response.status);
  const value = await response.json();
  if (!response.ok) {
    if (response.status === 401 && options.notifyUnauthorized !== false) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw new AuthApiError(value.error || "SERVICE_UNAVAILABLE", response.status);
  }
  return value as T;
}

export function validAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return typeof user.id === "string" && user.id.length > 0
    && typeof user.username === "string" && user.username.length > 0
    && typeof user.displayName === "string" && user.displayName.length > 0
    && (user.role === "owner" || user.role === "editor" || user.role === "viewer");
}

/** A remembered user is an explicit offline preference, never a server credential. */
export function parseRememberedSession(raw: string | null, now = Date.now()): AuthSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { user?: unknown; expiresAt?: unknown; savedAt?: unknown };
    if (!validAuthUser(value.user) || typeof value.expiresAt !== "string" || typeof value.savedAt !== "number") return null;
    const expires = Date.parse(value.expiresAt);
    if (!Number.isFinite(expires) || expires <= now || value.savedAt > now + 60_000 || now - value.savedAt > MAX_OFFLINE_AGE) return null;
    if (expires > value.savedAt + MAX_OFFLINE_AGE + 60_000) return null;
    return { user: value.user, expiresAt: value.expiresAt, mode: "offline" };
  } catch { return null; }
}

export function readRememberedSession(): AuthSession | null {
  try { return parseRememberedSession(localStorage.getItem(REMEMBERED_SESSION_KEY)); }
  catch { return null; }
}

export function rememberSession(session: AuthSession): boolean {
  if (!session.expiresAt || !validAuthUser(session.user)) return false;
  const value = { user: session.user, expiresAt: session.expiresAt, savedAt: Date.now() };
  if (!parseRememberedSession(JSON.stringify(value))) return false;
  try { localStorage.setItem(REMEMBERED_SESSION_KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function forgetRememberedSession() {
  try { localStorage.removeItem(REMEMBERED_SESSION_KEY); } catch { /* Storage may be unavailable. */ }
}

export const roleLabel: Record<UserRole, string> = {
  owner: "مالک", editor: "ویرایشگر", viewer: "مشاهده‌گر",
};
