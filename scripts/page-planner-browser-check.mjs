import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

// An isolated, synthetic React harness exercises the planner without accessing a live workspace.
const harness = `<!doctype html><html lang="fa" dir="rtl"><head><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from '/node_modules/.vite/deps/react.js';const {useEffect,useState}=React;
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';const {createRoot}=ReactDOM;
import {PagePlanner} from '/src/components/PagePlanner.tsx';
import {createProject} from '/src/domain.ts';
import '/src/styles.css';import '/src/dark-theme.css';import '/node_modules/@fontsource/vazirmatn/400.css';
function fixture(){const p=createProject('آزمون برنامه صفحات');p.id='planner-fixture-project';p.projectType='Ecommerce';p.keywords=[];
for(let group=0;group<100;group++)for(let row=0;row<20;row++)p.keywords.push({id:'model-'+group+'-'+row,keyword:(row%2?'خرید':'قیمت')+' دوربین مدل M-'+group,volume:100+row,decision:'Keep'});
p.keywords.push({id:'blog-a',keyword:'آموزش نصب دوربین مداربسته',volume:100,decision:'Keep'},{id:'blog-b',keyword:'نحوه نصب دوربین مداربسته',volume:90,decision:'Keep'},{id:'camera-a',keyword:'دوربین مداربسته',volume:500,decision:'Keep'},{id:'camera-b',keyword:'خرید دوربین مداربسته',volume:400,decision:'Keep'},{id:'manual',keyword:'دوربین داهوا',group:'تصمیم دستی',intent:'اطلاعاتی',notes:'حفظ شود',decision:'Keep'});
p.pages=[{id:'existing-page',pageId:'P-001',target:'دسته دوربین',pkw:'دوربین مداربسته',pageType:'دسته‌بندی محصول',url:'https://example.test/cameras/',notes:'اطلاعات دستی'}];p.content=[];p.results=[];return p;}
function Harness(){const [project,setProject]=useState(fixture),[readOnly,setReadOnly]=useState(false),[message,setMessage]=useState(''),[mounted,setMounted]=useState(true);useEffect(()=>{window.__project=project;window.__mutate=()=>setProject(p=>({...p,name:p.name+' جدید'}));window.__readonly=value=>setReadOnly(value);window.__mounted=value=>setMounted(value);},[project]);return React.createElement('main',{style:{maxWidth:1300,margin:'auto',padding:20}},mounted?React.createElement(PagePlanner,{project,onProjectChange:next=>{if(window.__rejectPlan)return false;setProject(next);return true;},notify:setMessage,readOnly}):null,React.createElement('output',{'data-test-notice':true},message));}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`;

const port = Number(process.env.PLANNER_QA_PORT || 5188);
const server = await createServer({
  server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: { ignored: ["**"] } },
  plugins: [{ name: "planner-qa-harness", configureServer(instance) { instance.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith("/__planner_qa__")) return next();
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(await instance.transformIndexHtml(request.url, harness));
  }); } }],
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [], external = [], checks = [];
page.on("pageerror", (error) => { errors.push(error.message); console.error("BROWSER", error.message); });
page.on("console", (message) => { if (message.type() === "error") console.error("CONSOLE", message.text()); });
page.on("request", (request) => { if (!request.url().startsWith(`http://127.0.0.1:${port}`) && !request.url().startsWith("data:")) external.push(request.url()); });
const check = (name) => { checks.push(name); console.log("PASS", name); };
const project = () => page.evaluate(() => window.__project);
const cards = page.locator(".planner-group");
async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); }
try {
  await mkdir("artifacts", { recursive: true });
  await page.goto(`http://127.0.0.1:${port}/__planner_qa__`);
  await cards.first().waitFor();
  assert.equal((await project()).keywords.length, 2005);
  assert.equal(await cards.count(), 60);
  assert.equal(await cards.locator('input[type="checkbox"]:checked').count(), 0);
  check("2005 keywords analyzed locally; at most 60 groups rendered and no silent selection");

  await page.getByRole("navigation", { name: "صفحه‌بندی بالای پیشنهادها", exact: true }).getByRole("button", { name: "بعدی", exact: true }).click();
  assert.ok(await cards.count() < 60);
  await page.getByRole("navigation", { name: "صفحه‌بندی بالای پیشنهادها", exact: true }).getByRole("button", { name: "قبلی", exact: true }).click();
  await page.getByLabel("جست‌وجوی پیشنهادهای صفحه").fill("M-99");
  assert.equal(await cards.count(), 1);
  assert.ok((await cards.first().textContent()).includes("۲۰ کلمه"));
  check("Search examines every keyword across pagination and reaches the final model group");

  await cards.first().getByRole("button", { name: "بررسی کلمات و جداسازی" }).click();
  await page.locator(".planner-keyword input").first().check();
  await page.getByLabel("نام گروه جدا شده").fill("مدل جداشده");
  await page.getByRole("button", { name: "جداکردن در پیشنهاد تازه" }).click();
  assert.equal((await project()).keywords.length, 2005);
  assert.equal((await project()).pages.length, 1);
  assert.equal(await cards.count(), 2);
  await page.getByRole("button", { name: "واگرد آخرین جداسازی / ادغام" }).click();
  assert.equal(await cards.count(), 1);
  check("Keyword split and undo change only the draft; original keywords and pages remain intact");

  await page.getByLabel("جست‌وجوی پیشنهادهای صفحه").fill("");
  await cards.nth(0).locator('input[type="checkbox"]').check();
  await cards.nth(1).locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "ادغام انتخاب‌ها", exact: true }).click();
  await page.getByLabel("نام پیشنهاد ادغام شده").fill("ادغام آزمایشی");
  await page.getByRole("button", { name: "ساخت پیشنهاد ادغام‌شده" }).click();
  await page.getByLabel("جست‌وجوی پیشنهادهای صفحه").fill("ادغام آزمایشی");
  assert.equal(await cards.count(), 1);
  assert.ok((await cards.first().textContent()).includes("۴۰ کلمه"));
  await page.getByRole("button", { name: "واگرد آخرین جداسازی / ادغام" }).click();
  await page.getByRole("button", { name: "لغو انتخاب", exact: true }).click();
  await page.getByLabel("جست‌وجوی پیشنهادهای صفحه").fill("");
  check("Selected groups merge into a review proposal with undo and no committed mutation");

  const originalLabel = await cards.first().locator(".planner-fields input").first().inputValue();
  await cards.first().locator(".planner-fields input").first().fill("پیش‌نویس ماندگار");
  await page.evaluate(() => window.__mounted(false));
  await page.locator(".page-planner").waitFor({ state: "detached" });
  await page.evaluate(() => window.__mounted(true));
  await page.getByText("پیش‌نویس قبلی شما بازیابی شد.", { exact: false }).waitFor();
  assert.ok(await page.locator(".planner-fields input").evaluateAll((inputs) => inputs.some((input) => input.value === "پیش‌نویس ماندگار")));
  await page.getByLabel("جست‌وجوی پیشنهادهای صفحه").fill("پیش‌نویس ماندگار");
  await cards.first().locator(".planner-fields input").first().fill(originalLabel);
  await page.getByLabel("جست‌وجوی پیشنهادهای صفحه").fill("");
  check("IndexedDB recovers the latest staged group edit even when unmounted before the debounce finishes");

  await page.getByLabel("فیلتر پیشنهادهای صفحه").selectOption("blog");
  const blog = cards.filter({ hasText: "آموزش نصب دوربین مداربسته" });
  assert.equal(await blog.count(), 1);
  await blog.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "بازبینی و ثبت برنامه" }).click();
  assert.equal((await project()).pages.length, 1);
  assert.equal((await project()).content.length, 0);
  const priorNotice = await page.locator("[data-test-notice]").textContent();
  await page.evaluate(() => { window.__rejectPlan = true; });
  await page.getByRole("button", { name: "تأیید و ثبت در پروژه" }).click();
  assert.equal((await project()).pages.length, 1);
  assert.equal((await project()).content.length, 0);
  assert.equal(await page.locator(".page-planner").getAttribute("data-dirty"), "true");
  assert.equal(await cards.locator('input[type="checkbox"]:checked').count(), 1);
  assert.equal(await page.locator("[data-test-notice]").textContent(), priorNotice);
  await page.getByRole("alert").waitFor();
  await page.evaluate(() => window.__mounted(false));
  await page.locator(".page-planner").waitFor({ state: "detached" });
  await page.evaluate(() => window.__mounted(true));
  await page.getByText("پیش‌نویس قبلی شما بازیابی شد.", { exact: false }).waitFor();
  await page.getByLabel("فیلتر پیشنهادهای صفحه").selectOption("blog");
  assert.equal(await cards.locator('input[type="checkbox"]:checked').count(), 1);
  check("Rejected project callback retains dirty selection and cached draft without a success notice");
  await page.evaluate(() => { window.__rejectPlan = false; });
  await page.getByRole("button", { name: "بازبینی و ثبت برنامه" }).click();
  await page.getByRole("button", { name: "تأیید و ثبت در پروژه" }).click();
  const planned = await project();
  assert.equal(planned.pages.length, 2);
  assert.equal(planned.content.length, 1);
  assert.ok(planned.keywords.find((row) => row.id === "blog-a").targetPage);
  assert.equal(planned.keywords.find((row) => row.id === "manual").notes, "حفظ شود");
  assert.equal(planned.pages.find((row) => row.id === "existing-page").url, "https://example.test/cameras/");
  check("Preview requires explicit confirmation; page, brief and keyword links commit together while manual values survive");

  await page.getByLabel("فیلتر پیشنهادهای صفحه").selectOption("all");
  await page.getByLabel("جست‌وجوی پیشنهادهای صفحه").fill("M-99");
  await cards.first().getByLabel(/صفحه هدف/).selectOption("__choose_page__");
  await page.getByLabel("جست‌وجوی صفحات موجود برای هدف").fill("دسته دوربین");
  await page.locator(".planner-target-list>button").first().click();
  assert.equal(await cards.first().getByLabel(/صفحه هدف/).inputValue(), "existing-page");
  check("Existing page chooser searches all pages and stores stable page IDs without a huge option list");

  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "خروجی CSV" }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /14\d{2}-\d{2}-\d{2}\.csv$/);
  const exported = await readFile(await download.path(), "utf8");
  assert.ok(exported.includes("دوربین مدل M-99"));
  assert.ok(exported.includes("existing-page"));
  check("CSV downloads as a real local file with Jalali filename and reviewed page choices");

  await cards.first().locator('input[type="checkbox"]').check();
  await page.evaluate(() => window.__mutate());
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("button", { name: "بازبینی و ثبت برنامه" }).isDisabled(), true);
  assert.equal((await project()).pages.length, 2);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "بازسازی پیشنهادها" }).click();
  assert.equal(await page.locator(".page-planner").getAttribute("data-dirty"), null);
  check("Concurrent project changes invalidate the draft and block overwriting until regeneration");

  await page.getByLabel("جست‌وجوی پیشنهادهای صفحه").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelectorAll(".planner-group").length === 10);
  const mobilePager = page.getByRole("navigation", { name: "صفحه‌بندی بالای پیشنهادها", exact: true });
  const draftLabel = "ویرایش محفوظ در صفحه موبایل";
  await cards.first().locator(".planner-fields input").first().fill(draftLabel);
  await cards.first().locator('input[type="checkbox"]').check();
  await mobilePager.getByRole("button", { name: "بعدی", exact: true }).click();
  assert.equal(await cards.count(), 10);
  assert.match(await mobilePager.innerText(), /صفحهٔ ۲ از/);
  await mobilePager.getByRole("button", { name: "قبلی", exact: true }).click();
  assert.equal(await cards.first().locator(".planner-fields input").first().inputValue(), draftLabel);
  assert.equal(await cards.first().locator('input[type="checkbox"]').isChecked(), true);
  assert.equal(await page.locator(".page-planner").getAttribute("data-dirty"), "true");
  check("Mobile shows at most ten cards and top pagination reaches page two without losing edits or selection");
  await page.getByRole("button", { name: "انتخاب همهٔ نتایج فیلتر", exact: true }).click();
  const total = Number((await page.locator(".planner-stats strong").first().innerText()).replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[,٬]/g, ""));
  assert.ok(total > 10);
  const selectedText = await page.locator(".planner-selection>span").innerText();
  assert.ok(selectedText.startsWith(total.toLocaleString("fa-IR")));
  await mobilePager.getByRole("button", { name: "بعدی", exact: true }).click();
  assert.equal(await cards.locator('input[type="checkbox"]:checked').count(), 10);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => document.querySelectorAll(".planner-group").length === 60);
  assert.match(await page.getByRole("navigation", { name: "صفحه‌بندی بالای پیشنهادها", exact: true }).innerText(), /صفحهٔ ۱ از/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelectorAll(".planner-group").length === 10);
  assert.equal(await cards.first().locator(".planner-fields input").first().inputValue(), draftLabel);
  check("Mobile select-all covers every filtered proposal; responsive page reset keeps desktop sixty-card view and drafts");

  await page.evaluate(() => window.__readonly(true));
  assert.equal(await cards.first().locator('input[type="checkbox"]').isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "انتخاب همهٔ نتایج فیلتر" }).isDisabled(), true);
  await cards.first().getByRole("button", { name: "بررسی کلمات و جداسازی" }).click();
  assert.equal(await page.locator(".planner-keyword input").first().isDisabled(), true);
  await page.getByRole("button", { name: "بستن بررسی برنامه صفحات" }).click();
  check("Viewer can inspect and export but cannot select, split, edit or apply project changes");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await noOverflow();
  await page.screenshot({ path: "artifacts/page-planner-dark-mobile.png", fullPage: true });
  await cards.first().getByRole("button", { name: "بررسی کلمات و جداسازی" }).click();
  await noOverflow();
  await page.screenshot({ path: "artifacts/page-planner-dialog-mobile.png" });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".planner-dialog").count(), 0);
  assert.equal(await cards.first().getByRole("button", { name: "بررسی کلمات و جداسازی" }).evaluate((node) => node === document.activeElement), true);
  check("390px dark layout and dialog fit; Escape closes and restores keyboard focus");

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  check("No browser exceptions or third-party network requests");
  await writeFile("artifacts/page-planner-browser-checks.json", JSON.stringify({ checks, errors, external }, null, 2));
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
