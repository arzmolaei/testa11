import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, ShieldCheck, UserCheck, UserRound, UsersRound, UserX, X } from "lucide-react";
import { AuthApiError, authRequest, roleLabel, type AuthSession, type TeamUser, type UserRole } from "../auth";
import "./TeamSettings.css";

type MemberDraft = {
  user: TeamUser | null;
  username: string;
  displayName: string;
  role: "editor" | "viewer";
  password: string;
};
const emptyDraft = (): MemberDraft => ({ user: null, username: "", displayName: "", role: "editor", password: "" });
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Tehran",
  }).format(date) : "—";
};
const errorMessage = (cause: unknown) => cause instanceof AuthApiError ? cause.message
  : "ارتباط برقرار نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.";

function PasswordInput({ id, value, onChange, disabled, autoComplete, label, minLength = 12, maxLength = 128, required = true }: {
  id: string; value: string; onChange: (value: string) => void; disabled?: boolean;
  autoComplete: string; label: string; minLength?: number; maxLength?: number; required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="team-field"><label htmlFor={id}>{label}</label><div className="team-password-input">
    <input id={id} name={id} type={visible ? "text" : "password"} dir="ltr" autoComplete={autoComplete} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} minLength={minLength} maxLength={maxLength} required={required} />
    <button type="button" aria-label={visible ? `پنهان‌کردن ${label}` : `نمایش ${label}`} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
  </div></div>;
}

export function TeamSettings({ session, onSessionRefresh, readOnly = false }: {
  session: AuthSession;
  onSessionRefresh?: () => Promise<void>;
  readOnly?: boolean;
}) {
  const owner = session.user.role === "owner";
  const online = session.mode === "online" && navigator.onLine;
  const canManage = owner && online && !readOnly;
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<MemberDraft | null>(null);
  const [draftError, setDraftError] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const draftRef = useRef(draft);
  const requestNumber = useRef(0);
  const mounted = useRef(true);
  draftRef.current = draft;
  const passwordDirty = Boolean(currentPassword || newPassword || confirmPassword);
  const memberDirty = Boolean(draft && (draft.password !== ""
    || draft.username !== (draft.user?.username ?? "")
    || draft.displayName !== (draft.user?.displayName ?? "")
    || draft.role !== (draft.user?.role ?? "editor")));
  const hasUnsavedForm = passwordDirty || memberDirty;

  const loadUsers = useCallback(async () => {
    if (!owner || !online) return;
    const request = ++requestNumber.current;
    setLoading(true);
    setError("");
    try {
      const data = await authRequest<{ users: TeamUser[] }>("users");
      if (mounted.current && request === requestNumber.current) setUsers(data.users);
    } catch (cause) {
      if (mounted.current && request === requestNumber.current) setError(errorMessage(cause));
    } finally {
      if (mounted.current && request === requestNumber.current) setLoading(false);
    }
  }, [owner, online]);

  useEffect(() => {
    mounted.current = true;
    void loadUsers();
    return () => { mounted.current = false; requestNumber.current++; };
  }, [loadUsers]);

  useEffect(() => {
    if (draft && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!draft && dialog.current?.open) dialog.current.close();
  }, [draft]);

  useEffect(() => {
    if (!hasUnsavedForm) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasUnsavedForm]);

  function togglePasswordForm() {
    if (busy === "password") return;
    if (passwordOpen && passwordDirty && !window.confirm("تغییر رمز هنوز ذخیره نشده است. فرم بسته شود؟")) return;
    if (passwordOpen) {
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setPasswordError(""); setPasswordNotice("");
    }
    setPasswordOpen(!passwordOpen);
  }

  function closeDraft() {
    if (busy === "member") return;
    const value = draftRef.current;
    const dirty = value && (value.password !== ""
      || value.username !== (value.user?.username ?? "")
      || value.displayName !== (value.user?.displayName ?? "")
      || value.role !== (value.user?.role ?? "editor"));
    if (dirty && !window.confirm("تغییرات این حساب ذخیره نشده است. از فرم خارج شوید؟")) return;
    setDraft(null);
    setDraftError("");
  }

  function openDraft(user: TeamUser | null) {
    setNotice("");
    setDraftError("");
    setDraft(user ? { user, username: user.username, displayName: user.displayName,
      role: user.role === "viewer" ? "viewer" : "editor", password: "" } : emptyDraft());
  }

  async function saveMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !canManage || busy) return;
    const username = draft.username.trim().toLowerCase();
    const displayName = draft.displayName.trim();
    if (!displayName || displayName.length > 80) { setDraftError("نام نمایشی را وارد کنید؛ حداکثر ۸۰ نویسه."); return; }
    if (!draft.user && !/^[a-z][a-z0-9_.-]{2,31}$/.test(username)) {
      setDraftError("نام کاربری باید ۳ تا ۳۲ نویسه انگلیسی باشد و با حرف شروع شود."); return;
    }
    if ((!draft.user || draft.password) && (draft.password.length < 12 || draft.password.length > 128)) {
      setDraftError("رمز عبور باید بین ۱۲ تا ۱۲۸ نویسه باشد."); return;
    }
    setBusy("member");
    setDraftError("");
    try {
      await authRequest(draft.user ? `users/${encodeURIComponent(draft.user.id)}` : "users", {
        method: draft.user ? "PATCH" : "POST",
        body: draft.user ? { displayName, role: draft.role, ...(draft.password ? { password: draft.password } : {}) }
          : { username, displayName, role: draft.role, password: draft.password },
      });
      if (!mounted.current) return;
      setDraft(null);
      setNotice(draft.user ? "اطلاعات حساب به‌روزرسانی شد." : "حساب جدید ساخته شد. نام کاربری و رمز را به همکار خود بدهید.");
      await loadUsers();
    } catch (cause) {
      if (mounted.current) setDraftError(errorMessage(cause));
    } finally { if (mounted.current) setBusy(""); }
  }

  async function toggleUser(user: TeamUser) {
    if (!canManage || busy || user.role === "owner") return;
    const message = user.disabled
      ? `دسترسی «${user.displayName}» دوباره فعال شود؟`
      : `دسترسی «${user.displayName}» غیرفعال شود؟ این شخص دیگر نمی‌تواند وارد شود. اطلاعات پروژه‌ها حفظ می‌شوند.`;
    if (!window.confirm(message)) return;
    setBusy(user.id);
    setError("");
    setNotice("");
    try {
      await authRequest(`users/${encodeURIComponent(user.id)}`, { method: "PATCH", body: { disabled: !user.disabled } });
      if (!mounted.current) return;
      setNotice(user.disabled ? "دسترسی این حساب فعال شد." : "دسترسی این حساب غیرفعال شد.");
      await loadUsers();
    } catch (cause) { if (mounted.current) setError(errorMessage(cause)); }
    finally { if (mounted.current) setBusy(""); }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online || busy) return;
    if (newPassword.length < 12 || newPassword.length > 128) { setPasswordError("رمز جدید باید بین ۱۲ تا ۱۲۸ نویسه باشد."); return; }
    if (newPassword !== confirmPassword) { setPasswordError("تکرار رمز با رمز جدید یکسان نیست."); return; }
    if (newPassword === currentPassword) { setPasswordError("یک رمز تازه انتخاب کنید."); return; }
    setBusy("password");
    setPasswordError("");
    setPasswordNotice("");
    try {
      await authRequest("password", { body: { currentPassword, password: newPassword }, notifyUnauthorized: false });
      if (!mounted.current) return;
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setPasswordNotice("رمز ورود عوض شد. برای ورود بعدی از رمز جدید استفاده کنید.");
      await onSessionRefresh?.();
    } catch (cause) { if (mounted.current) setPasswordError(cause instanceof AuthApiError && cause.code === "INVALID_CREDENTIALS" ? "رمز فعلی درست نیست." : errorMessage(cause)); }
    finally { if (mounted.current) setBusy(""); }
  }

  return <div className="team-settings" dir="rtl" data-unsaved={hasUnsavedForm ? "true" : undefined}>
    <section className="team-card team-account-card">
      <div className="team-card-heading"><span className="team-section-icon"><ShieldCheck size={21} /></span><div><h3>حساب و امنیت</h3><p>ورود اختصاصی برای شما و اعضای تیم</p></div></div>
      <div className="team-current-user"><span className="team-avatar">{session.user.displayName.trim().slice(0, 1)}</span><div><b>{session.user.displayName}</b><small dir="ltr">{session.user.username}</small></div><span className={`team-role team-role-${session.user.role}`}>{roleLabel[session.user.role]}</span></div>
      {!online && <p className="team-offline-note">{session.mode === "local" ? "مدیریت حساب‌ها پس از انتشار و اتصال به Cloudflare فعال می‌شود." : "برای تغییر رمز و مدیریت اعضای تیم به اینترنت وصل شوید."}</p>}
      <button className="team-password-toggle" type="button" aria-expanded={passwordOpen} onClick={togglePasswordForm} disabled={busy === "password"}><KeyRound size={16} /> تغییر رمز ورود <span>{passwordOpen ? "بستن" : "بازکردن"}</span></button>
      {passwordOpen && <form className="team-change-password" onSubmit={changePassword}>
        <div className="team-password-grid">
          <PasswordInput id="team-current-password" value={currentPassword} onChange={setCurrentPassword} label="رمز فعلی" autoComplete="current-password" minLength={1} maxLength={1024} disabled={!online || Boolean(busy)} />
          <PasswordInput id="team-new-password" value={newPassword} onChange={setNewPassword} label="رمز جدید" autoComplete="new-password" disabled={!online || Boolean(busy)} />
          <PasswordInput id="team-confirm-password" value={confirmPassword} onChange={setConfirmPassword} label="تکرار رمز جدید" autoComplete="new-password" disabled={!online || Boolean(busy)} />
        </div>
        <p className="team-field-help">برای رمز جدید دست‌کم ۱۲ نویسه انتخاب کنید.</p>
        {passwordError && <p className="team-message team-message-error" role="alert">{passwordError}</p>}
        {passwordNotice && <p className="team-message team-message-success" role="status"><Check size={16} />{passwordNotice}</p>}
        <button className="team-button team-button-primary" type="submit" disabled={!online || Boolean(busy)}>{busy === "password" ? <LoaderCircle className="auth-spin" size={16} /> : <Check size={16} />} ذخیره رمز جدید</button>
      </form>}
    </section>

    <section className="team-card">
      <div className="team-card-topline"><div className="team-card-heading"><span className="team-section-icon team-section-icon-purple"><UsersRound size={21} /></span><div><h3>اعضای تیم</h3><p>{owner ? "همکاران با حساب خودشان وارد فضای کاری مشترک می‌شوند." : "نقش و دسترسی شما را مالک فضای کاری مشخص می‌کند."}</p></div></div>
        {owner && <div className="team-actions"><button className="team-button team-button-quiet" type="button" onClick={() => void loadUsers()} disabled={!online || loading || Boolean(busy)} aria-label="دریافت دوباره اعضای تیم"><RefreshCw size={16} /></button><button className="team-button team-button-primary" type="button" onClick={() => openDraft(null)} disabled={!canManage || Boolean(busy)}><Plus size={16} /> عضو جدید</button></div>}
      </div>
      <div className="team-role-guide"><span><b>مالک</b>مدیریت حساب‌ها و همه پروژه‌ها</span><span><b>ویرایشگر</b>افزودن، ویرایش و حذف داده‌های پروژه</span><span><b>مشاهده‌گر</b>مشاهده پروژه‌ها و گرفتن خروجی</span></div>
      {error && <p className="team-message team-message-error" role="alert">{error}</p>}
      {notice && <p className="team-message team-message-success" role="status"><Check size={16} />{notice}</p>}
      {owner && <>
        {loading && users.length === 0 ? <p className="team-list-status" role="status"><LoaderCircle className="auth-spin" size={18} /> در حال دریافت اعضای تیم…</p>
          : !online && users.length === 0 ? <p className="team-list-status">فهرست اعضا با اتصال به سرویس ابری نمایش داده می‌شود.</p>
          : <div className="team-member-list">{users.map(user => <div className={`team-member ${user.disabled ? "team-member-disabled" : ""}`} key={user.id}>
            <span className="team-avatar"><UserRound size={18} /></span><div className="team-member-identity"><b>{user.displayName}</b><small><span dir="ltr">{user.username}</span><span>عضویت: {dateLabel(user.createdAt)}</span></small></div>
            <span className={`team-role team-role-${user.role}`}>{roleLabel[user.role as UserRole]}</span><span className={`team-member-status ${user.disabled ? "is-disabled" : ""}`}>{user.disabled ? "غیرفعال" : "فعال"}</span>
            {user.role !== "owner" && <div className="team-member-actions"><button className="team-icon-button" type="button" aria-label={`ویرایش حساب ${user.displayName}`} title="ویرایش نقش یا تغییر رمز" onClick={() => openDraft(user)} disabled={!canManage || Boolean(busy)}><Pencil size={16} /></button><button className={`team-icon-button ${user.disabled ? "" : "team-icon-button-danger"}`} type="button" aria-label={`${user.disabled ? "فعال‌کردن" : "غیرفعال‌کردن"} حساب ${user.displayName}`} title={user.disabled ? "فعال‌کردن دسترسی" : "غیرفعال‌کردن دسترسی"} onClick={() => void toggleUser(user)} disabled={!canManage || Boolean(busy)}>{busy === user.id ? <LoaderCircle className="auth-spin" size={16} /> : user.disabled ? <UserCheck size={16} /> : <UserX size={16} />}</button></div>}
          </div>)}</div>}
        <p className="team-field-help team-access-note">اعضای فعال به همه پروژه‌های این فضای کاری دسترسی دارند. غیرفعال‌کردن حساب، داده‌های پروژه را حذف نمی‌کند.</p>
      </>}
    </section>

    <dialog ref={dialog} className="team-dialog" onCancel={event => { event.preventDefault(); closeDraft(); }} onClick={event => { if (event.target === event.currentTarget) closeDraft(); }}>
      {draft && <form onSubmit={saveMember} className="team-dialog-content">
        <button className="team-dialog-close team-icon-button" type="button" onClick={closeDraft} disabled={busy === "member"} aria-label="بستن فرم حساب"><X size={19} /></button>
        <span className="team-section-icon"><UserRound size={24} /></span>
        <h3>{draft.user ? "ویرایش حساب همکار" : "افزودن عضو تیم"}</h3>
        <p className="team-dialog-description">{draft.user ? "نام، نقش و در صورت نیاز رمز این حساب را تغییر دهید." : "برای هر همکار یک نام کاربری و رمز اختصاصی تعیین کنید."}</p>
        <div className="team-field"><label htmlFor="team-display-name">نام نمایشی</label><input id="team-display-name" autoComplete="off" value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })} maxLength={80} required disabled={Boolean(busy)} autoFocus /></div>
        <div className="team-field"><label htmlFor="team-username">نام کاربری</label><input id="team-username" autoComplete="off" autoCapitalize="none" spellCheck={false} dir="ltr" value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })} maxLength={32} minLength={3} required disabled={Boolean(busy) || Boolean(draft.user)} placeholder="example.name" /><small>انگلیسی، بدون فاصله؛ نام کاربری پس از ساخت ثابت است.</small></div>
        <div className="team-field"><label htmlFor="team-role">نقش در فضای کاری</label><select id="team-role" value={draft.role} onChange={event => setDraft({ ...draft, role: event.target.value as "editor" | "viewer" })} disabled={Boolean(busy)}><option value="editor">ویرایشگر — مشاهده و تغییر داده‌ها</option><option value="viewer">مشاهده‌گر — مشاهده و خروجی</option></select></div>
        <PasswordInput id="team-member-password" label={draft.user ? "رمز تازه (اختیاری)" : "رمز ورود"} value={draft.password} onChange={value => setDraft({ ...draft, password: value })} autoComplete="new-password" required={!draft.user} disabled={Boolean(busy)} />
        <p className="team-field-help">{draft.user ? "اگر رمز خالی بماند، رمز قبلی حفظ می‌شود. تغییر رمز، نشست‌های قبلی این همکار را می‌بندد." : "دست‌کم ۱۲ نویسه؛ رمز را فقط به صاحب همین حساب بدهید."}</p>
        {draftError && <p className="team-message team-message-error" role="alert">{draftError}</p>}
        <div className="team-dialog-buttons"><button className="team-button team-button-primary" type="submit" disabled={Boolean(busy)}>{busy === "member" ? <LoaderCircle className="auth-spin" size={16} /> : <Check size={16} />}{draft.user ? "ذخیره تغییرات" : "ساخت حساب"}</button><button className="team-button team-button-quiet" type="button" onClick={closeDraft} disabled={Boolean(busy)}>انصراف</button></div>
      </form>}
    </dialog>
  </div>;
}
