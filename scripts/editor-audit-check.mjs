import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.EDITOR_AUDIT_PORT || 5204);
const harness = `<!doctype html><html dir="rtl" lang="fa"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react';import ReactDOM from 'react-dom/client';import {BulkEditWorkspace} from '/src/components/BulkEditWorkspace.tsx';import {JalaliDateInput} from '/src/components/JalaliDateInput.tsx';import {KeywordWorkspace} from '/src/components/KeywordWorkspace.tsx';import {PageWorkspace} from '/src/components/PageWorkspaces.tsx';import '/src/styles.css';import '/src/dark-theme.css';
const fixture={id:'editor-project',name:'آزمون ویرایش',domain:'example.test',market:'ایران',language:'فارسی',projectType:'Ecommerce',goal:'',startDate:'',lastReview:'',keywords:[{id:'k0',keyword:'کلمه اول',volume:1,notes:'حفظ'},{id:'k1',keyword:'کلمه دوم',volume:2}],pages:[{id:'p0',pageId:'P-001',target:'صفحه اول'},{id:'p1',pageId:'P-002',target:'صفحه دوم'}],content:[{id:'c0',topic:'محتوا',targetPage:'p0',publishDate:'2026-09-01'}],results:[]};const settings={titleMin:30,titleMax:60,metaMin:120,metaMax:160};
function Harness(){const[project,setProject]=React.useState(fixture);const[date,setDate]=React.useState('');const[view,setView]=React.useState('date');const[notice,setNotice]=React.useState('');window.qaProject=project;window.qaSetProject=setProject;window.qaSetDate=setDate;window.qaSetView=setView;window.qaNotice=notice;const commit=(kind,rows)=>{if(window.qaThrow)throw Error('بازنشانی دسترسی');if(window.qaReject)return false;setProject(p=>({...p,[kind]:rows}));return true};return React.createElement('main',{style:{maxWidth:1400,margin:'auto',padding:20}},React.createElement('output',null,notice),view==='date'?React.createElement(JalaliDateInput,{value:date,onChange:setDate,'aria-label':'تاریخ آزمایشی'}):React.createElement(view==='bulk'?BulkEditWorkspace:view==='keywords'?KeywordWorkspace:PageWorkspace,{key:view,project,settings,onRowsChange:commit,notify:setNotice}))};ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`;
const server = await createServer({ root, cacheDir: "/tmp/seo-editor-audit-cache", server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: { ignored: ["**"] } }, plugins: [{ name: "editor-audit", configureServer(instance) { instance.middlewares.use(async (req, res, next) => { if (!req.url?.startsWith("/__editor_audit")) return next(); res.setHeader("Content-Type", "text/html;charset=utf-8"); res.end(await instance.transformIndexHtml(req.url, harness)); }); } }] }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const checks = [], errors = [], failures = [];
page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
async function check(name, run) { try { await run(); checks.push(name); console.log("PASS", name); } catch (error) { failures.push({ name, error: error.message }); console.log("FAIL", name, error.message); } }
const view = async name => { await page.evaluate(name => window.qaSetView(name), name); await page.locator(name === "bulk" ? ".bulk-workspace" : name === "keywords" ? ".kw-workspace" : ".row-workspace").waitFor(); if (name === "bulk") await page.waitForFunction(() => !document.querySelector(".bulk-workspace .btn-primary")?.disabled); };
const resetBulk = async () => {await page.evaluate(() => window.qaSetView('date'));await page.waitForTimeout(350);await page.evaluate(() => new Promise((resolve,reject) => {const r=indexedDB.open('seo-bulk-drafts-v1',1);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').clear();tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)} }));await view('bulk')};
const save = async () => { await page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).click(); await page.getByRole("button", { name: "ثبت نهایی", exact: true }).click(); };
try {
  await page.goto(`http://127.0.0.1:${port}/__editor_audit`); await page.getByLabel("تاریخ آزمایشی", { exact: true }).waitFor();
  await check("Controlled Jalali dates reflect an external reset to a previously emitted value", async () => {
    await page.getByLabel("تاریخ آزمایشی", { exact: true }).fill("۱۴۰۵/۰۷/۱۵");
    await page.evaluate(() => window.qaSetDate("2026-10-23")); await page.waitForTimeout(30);
    assert.equal(await page.getByLabel("تاریخ آزمایشی", { exact: true }).inputValue(), "۱۴۰۵/۰۸/۰۱");
    await page.evaluate(() => window.qaSetDate("2026-10-07")); await page.waitForTimeout(30);
    assert.equal(await page.getByLabel("تاریخ آزمایشی", { exact: true }).inputValue(), "۱۴۰۵/۰۷/۱۵");
  });
  await view("bulk");
  await check("A cloud change during inline typing cannot be overwritten by a late baseline", async () => {
    await page.locator('[data-cell="0:1"]').dblclick(); await page.locator(".bulk-cell-editor textarea").fill("77");
    await page.evaluate(() => window.qaSetProject(p => ({...p,keywords:p.keywords.map(k => k.id==='k0'?{...k,volume:99}:k)}))); await page.waitForTimeout(30);
    await page.locator(".bulk-cell-editor textarea").press("Enter");
    if (!await page.locator('.bulk-cell-editor').count()) await save();
    assert.equal(await page.evaluate(() => window.qaProject.keywords[0].volume), 99);
    assert.equal(await page.locator(".bulk-cell-editor textarea").inputValue(), "77");
  });
  await resetBulk();
  await check("Invalid visible Shamsi text blocks a bulk date change instead of reusing an older date", async () => {
    await page.locator('.bulk-tabs button').filter({hasText:'محتوا و تقویم'}).click();
    await page.getByLabel("انتخاب تمام نتایج جدول").check(); await page.getByLabel("فیلد تغییر گروهی").selectOption("publishDate");
    await page.getByLabel("مقدار تغییر گروهی", { exact: true }).fill("۱۴۰۵/۰۷/۱۵"); await page.getByLabel("مقدار تغییر گروهی", { exact: true }).fill("۱۴۰۵/۱۳/۴۰");
    await page.getByRole("button", { name: "اعمال روی ۱ ردیف", exact: true }).click();
    assert.equal(await page.locator('.bulk-workspace').getAttribute('data-unsaved'), 'false');
    assert.equal(await page.getByLabel("مقدار تغییر گروهی", { exact: true }).inputValue(), "۱۴۰۵/۱۳/۴۰");
    assert.equal(await page.evaluate(() => window.qaProject.content[0].publishDate), '2026-09-01');
  });
  await resetBulk();
  await check("A throwing save callback keeps the bulk transaction and shows its failure", async () => {
    await page.locator('[data-cell="0:1"]').dblclick(); await page.locator(".bulk-cell-editor textarea").fill("50"); await page.locator(".bulk-cell-editor textarea").press("Enter");
    const original = await page.evaluate(() => window.qaProject.keywords[0].volume);
    await page.evaluate(() => {window.qaThrow=true}); await save();
    assert.equal(await page.evaluate(() => window.qaProject.keywords[0].volume), original);
    assert.equal(await page.getByRole('dialog',{name:'ثبت تغییرات گروهی'}).count(), 1);
    assert.match(await page.locator('main > output').innerText(), /بازنشانی دسترسی/);
    await page.evaluate(() => {window.qaThrow=false});
  });
  await mkdir(`${root}artifacts`, { recursive: true }); await writeFile(`${root}artifacts/editor-audit-checks.json`, JSON.stringify({ checks, failures, errors }, null, 2));
  assert.deepEqual(failures, []); assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
