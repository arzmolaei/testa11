import { useEffect, useMemo, useState } from "react";
import { ArrowUpLeft, Check, Link2, Search, Trash2 } from "lucide-react";
import { uid } from "../domain";
import { todayIso } from "../dates";
import { analyzePageRelationships, canonicalPageUrl } from "../workflow";
import type { LinkSuggestion } from "../workflow";
import type { Project, Row } from "../types";
import "./PageRelationships.css";

type Props = { project: Project; onProjectChange: (project: Project) => boolean | void; readOnly?: boolean; notify: (message: string) => void };
const text = (value: unknown) => String(value ?? "");
const number = (value: number) => value.toLocaleString("fa-IR");

export function PageRelationships({ project, onProjectChange, readOnly = false, notify }: Props) {
  const [tab, setTab] = useState<"suggestions" | "links" | "overlaps">("suggestions");
  const [query, setQuery] = useState("");
  const [anchors, setAnchors] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(30);
  const analysis = useMemo(() => analyzePageRelationships(project), [project]);
  const links = project.links || [];
  const pages = useMemo(() => new Map(project.pages.map((page) => [page.id, page])), [project.pages]);
  const pageName = (id: unknown) => { const page = pages.get(text(id)); return page ? text(page.target || page.pkw || page.pageId) || "صفحهٔ بدون نام" : "صفحهٔ حذف‌شده"; };
  const matching = (ids: unknown[], extra = "") => !query.trim() || `${ids.map(pageName).join(" ")} ${extra}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const suggestions = analysis.suggestions.filter((item) => matching([item.fromPageId, item.toPageId], item.anchor));
  const registered = links.filter((item) => matching([item.fromPageId, item.toPageId], text(item.anchor)));
  const overlaps = analysis.overlaps.filter((item) => matching(item.pageIds, item.phrases.join(" ")));
  const dirty = analysis.suggestions.some((item) => anchors[item.id] !== undefined && anchors[item.id] !== item.anchor);
  useEffect(() => { setAnchors({}); setQuery(""); setVisible(30); }, [project.id]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const validAnchor = (value: string) => value.trim().length > 0 && value.trim().length <= 200;
  function commit(next: Project) {
    if (readOnly) return false;
    try { return onProjectChange(next) !== false; }
    catch (error) { notify(error instanceof Error ? error.message : "ذخیرهٔ ارتباط انجام نشد؛ انتخاب شما حفظ شده است."); return false; }
  }
  function plan(suggestion: LinkSuggestion) {
    if (readOnly) return;
    const anchor = (anchors[suggestion.id] ?? suggestion.anchor).trim();
    if (!validAnchor(anchor)) { notify("متن لینک را بین ۱ تا ۲۰۰ نویسه وارد کنید."); return; }
    if (links.some((link) => link.fromPageId === suggestion.fromPageId && link.toPageId === suggestion.toPageId)) { notify("این ارتباط قبلاً ثبت شده است."); return; }
    if (!pages.has(suggestion.fromPageId) || !pages.has(suggestion.toPageId)) { notify("یکی از صفحات این پیشنهاد حذف شده است."); return; }
    const link: Row = { id: uid(), fromPageId: suggestion.fromPageId, toPageId: suggestion.toPageId, anchor, status: "planned", notes: suggestion.reason, createdAt: todayIso() };
    const tasks = project.tasks || [];
    if (!commit({ ...project, links: [...links, link], tasks: tasks.some((task) => task.source === suggestion.id) ? tasks : [...tasks, { id: uid(), title: `بررسی و افزودن لینک از «${pageName(suggestion.fromPageId)}» به «${pageName(suggestion.toPageId)}»`, status: "open", priority: "P2", pageId: suggestion.fromPageId, source: suggestion.id, createdAt: todayIso(), notes: `متن پیشنهادی: ${anchor}\n${suggestion.reason}\nپس از افزودن واقعی لینک در سایت، وضعیت ارتباط را انجام‌شده ثبت کنید.` }] })) return;
    notify("برنامهٔ لینک و کار مرتبط ثبت شد؛ هنوز تغییری در سایت انجام نشده است.");
  }
  function updateLink(id: string, patch: Partial<Row>) {
    if (readOnly) return;
    const link = links.find((item) => item.id === id);
    if (!link) return;
    const next = links.map((item) => item.id === id ? { ...item, ...patch, ...(patch.status ? { implementedAt: patch.status === "implemented" ? todayIso() : "" } : {}) } : item);
    const tasks = (project.tasks || []).map((task) => task.source === `link:${link.fromPageId}:${link.toPageId}` ? { ...task, status: patch.status === "implemented" ? "done" : "open", completedAt: patch.status === "implemented" ? todayIso() : "" } : task);
    if (!commit({ ...project, links: next, tasks })) return;
    notify(patch.status === "implemented" ? "اجرای این لینک در سوابق پروژه ثبت شد." : "لینک به برنامهٔ اجرا برگشت.");
  }
  function removeLink(link: Row) {
    if (readOnly || !window.confirm("این ارتباط و کار مرتبط با آن از برنامهٔ پروژه حذف شود؟ لینک واقعی سایت تغییر نمی‌کند.")) return;
    if (!commit({ ...project, links: links.filter((item) => item.id !== link.id), tasks: (project.tasks || []).filter((task) => task.source !== `link:${link.fromPageId}:${link.toPageId}`) })) return;
    notify("ارتباط از برنامهٔ پروژه حذف شد.");
  }
  const pageLink = (id: string) => { const page = pages.get(id); const url = canonicalPageUrl(page?.url, project.domain); return url ? <a className="relationship-page-link" href={url} target="_blank" rel="noopener noreferrer">{pageName(id)}<ArrowUpLeft size={14}/></a> : <span>{pageName(id)}</span>; };
  const displayedCount = tab === "suggestions" ? suggestions.length : tab === "links" ? registered.length : overlaps.length;

  return <section className="page-relationships" aria-labelledby="page-relationships-title" data-dirty={dirty ? "true" : undefined}>
    <div className="relationships-heading"><span className="relationships-icon"><Link2 size={22}/></span><div><h2 id="page-relationships-title">ارتباط صفحات و لینک‌سازی داخلی</h2><p>پیشنهادهای مرتبط را بررسی و اجرای واقعی لینک‌ها را ثبت کنید.</p></div></div>
    <div className="relationships-summary"><span><strong>{number(analysis.suggestions.length)}</strong> پیشنهاد لینک</span><span><strong>{number(links.filter((link) => link.status === "planned").length)}</strong> لینک برنامه‌ریزی‌شده</span><span><strong>{number(analysis.overlaps.length)}</strong> همپوشانی قابل بررسی</span></div>
    <div className="relationships-toolbar"><div className="relationships-tabs" role="group" aria-label="نمای ارتباط صفحات">{([ ["suggestions", "پیشنهاد لینک"], ["links", "ارتباط‌های ثبت‌شده"], ["overlaps", "همپوشانی هدف"] ] as const).map(([value, label]) => <button key={value} className={tab === value ? "active" : ""} onClick={() => { setTab(value); setVisible(30); }}>{label}</button>)}</div><label className="relationships-search"><Search size={15}/><input aria-label="جست‌وجوی ارتباط صفحات" placeholder="جست‌وجوی صفحه یا عبارت…" value={query} onChange={(event) => { setQuery(event.target.value); setVisible(30); }}/></label></div>
    {tab === "suggestions" && <>
      <p className="relationships-explanation">پیشنهادها از کلمات و خوشه‌های ثبت‌شده ساخته می‌شوند. فقط صفحات دارای آدرس معتبر و وضعیت موجود یا منتشرشده بررسی می‌شوند؛ محل مناسب و طبیعی لینک را خودتان تأیید کنید.</p>
      <div className="relationships-list">{suggestions.slice(0, visible).map((item) => <article key={item.id} className="relationship-card"><div className="relationship-route"><span><small>از صفحهٔ</small>{pageLink(item.fromPageId)}</span><Link2 size={17}/><span><small>به صفحهٔ</small>{pageLink(item.toPageId)}</span></div><p>{item.reason}</p><div className="relationship-plan"><label className="field"><span>متن لینک پیشنهادی، قابل ویرایش</span><input disabled={readOnly} maxLength={200} aria-label={`متن لینک به ${pageName(item.toPageId)}`} value={anchors[item.id] ?? item.anchor} onChange={(event) => setAnchors((old) => ({ ...old, [item.id]: event.target.value }))}/></label><button className="btn btn-secondary" disabled={readOnly || !validAnchor(anchors[item.id] ?? item.anchor)} onClick={() => plan(item)}><Check size={15}/>ثبت برنامهٔ لینک</button></div></article>)}</div>
      {!!analysis.orphanPageIds.length && <details className="relationships-orphans"><summary>{number(analysis.orphanPageIds.length)} صفحه بدون لینک ورودی ثبت‌شده</summary><p>این فهرست از سوابق همین پروژه ساخته شده و نبود لینک در سایت را اثبات نمی‌کند. لینک‌های اجراشده یا اطلاعات «لینک‌های ورودی» صفحه را ثبت کنید.</p><div>{analysis.orphanPageIds.slice(0, 60).map((id) => <span key={id}>{pageLink(id)}</span>)}</div>{analysis.orphanPageIds.length > 60 && <small>۶۰ صفحهٔ اول نمایش داده شده است؛ برای بررسی بیشتر از نقشهٔ صفحات استفاده کنید.</small>}</details>}
    </>}
    {tab === "links" && <div className="relationships-list">{registered.slice(0, visible).map((link) => <article key={link.id} className="relationship-card"><div className="relationship-route"><span><small>از صفحهٔ</small>{pageLink(text(link.fromPageId))}</span><Link2 size={17}/><span><small>به صفحهٔ</small>{pageLink(text(link.toPageId))}</span></div><p>متن لینک: <strong>{text(link.anchor)}</strong></p>{link.notes && <p>{text(link.notes)}</p>}<div className="relationship-record-actions"><span className={`relationship-status ${link.status === "implemented" ? "implemented" : ""}`}>{link.status === "implemented" ? "اجراشده ثبت شده" : "در برنامهٔ اجرا"}</span><button className="btn btn-secondary" disabled={readOnly || !pages.has(text(link.fromPageId)) || !pages.has(text(link.toPageId))} onClick={() => updateLink(link.id, { status: link.status === "implemented" ? "planned" : "implemented" })}>{link.status === "implemented" ? "بازگشت به برنامه" : "ثبت اجرای واقعی"}</button><button className="btn btn-ghost" disabled={readOnly} aria-label={`حذف ارتباط ${pageName(link.fromPageId)} به ${pageName(link.toPageId)}`} onClick={() => removeLink(link)}><Trash2 size={16}/></button></div></article>)}</div>}
    {tab === "overlaps" && <><p className="relationships-explanation">وجود عبارت مشترک در هدف‌گذاری، نشانهٔ بررسی است. تصمیم دربارهٔ ادغام یا تفکیک صفحات به نیت جست‌وجو و دادهٔ نتایج نیاز دارد.</p><div className="relationships-list">{overlaps.slice(0, visible).map((item) => <article key={item.id} className="relationship-card relationship-overlap"><div className="relationship-route"><span>{pageLink(item.pageIds[0])}</span><span>{pageLink(item.pageIds[1])}</span></div><p>{item.reason}</p><div className="relationship-phrases">{item.phrases.map((phrase) => <span key={phrase}>{phrase}</span>)}</div></article>)}</div></>}
    {!displayedCount && <div className="relationships-empty"><Link2 size={28}/><h3>{query ? "ارتباطی با این جست‌وجو پیدا نشد" : tab === "links" ? "ارتباطی ثبت نشده است" : tab === "overlaps" ? "همپوشانی دقیقی در کلمات ثبت‌شده پیدا نشد" : "پیشنهاد مرتبطی با اطلاعات فعلی پیدا نشد"}</h3><p>{tab === "suggestions" ? "آدرس، وضعیت صفحه و کلمات مرتبط را در نقشهٔ صفحات کامل کنید. پیشنهادها عمداً محدود به ارتباط‌های قابل توضیح‌اند." : "این بخش فقط بر اساس اطلاعات ثبت‌شدهٔ پروژه کار می‌کند."}</p></div>}
    {displayedCount > visible && <button className="btn btn-secondary relationships-more" onClick={() => setVisible((count) => count + 30)}>نمایش {number(Math.min(30, displayedCount - visible))} مورد بعدی</button>}
  </section>;
}

export { analyzePageRelationships } from "../workflow";
