import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// Disposable browser storage only. This checks the actual built application,
// including lazy feature routes; it never visits or changes a live workspace.
const base = process.env.INTELLIGENCE_TEST_URL || "http://localhost:4182";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("An isolated local server is required.");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const checks = [], errors = [], external = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (!request.url().startsWith(new URL(base).origin) && !/^(data|blob):/.test(request.url())) external.push(request.url());
});
page.on("dialog", (dialog) => dialog.accept());
const check = (name) => { checks.push(name); console.log("PASS", name); };
const active = (state) => state.projects.find((project) => project.id === state.activeProjectId);
async function state() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("rooyesh-seo-v1", 1);
    open.onsuccess = () => {
      const db = open.result, read = db.transaction("workspace").objectStore("workspace").get("state");
      read.onsuccess = () => { db.close(); resolve(read.result?.state); };
      read.onerror = () => reject(read.error);
    };
    open.onerror = () => reject(open.error);
  }));
}
async function saved(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await state();
    if (current && predicate(active(current), current)) return current;
    await page.waitForTimeout(100);
  }
  throw new Error("Integrated saved state did not reach the expected content.");
}
async function nav(name) {
  if (await page.locator(".mobile-menu").isVisible()) await page.locator(".mobile-menu").click();
  await page.locator(".sidebar .nav-item").filter({ hasText: name }).click();
}
async function mode(name) { await page.locator(".workspace-modes").getByRole("button", { name, exact: true }).click(); }
async function noOverflow() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
}
async function download(button, filename) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const result = await event;
  assert.match(result.suggestedFilename(), /14\d{2}/);
  await result.saveAs(`artifacts/${filename}`);
  return readFile(await result.path(), "utf8");
}
async function importGsc(name, period, start, end, rows) {
  await page.locator('.gsc-workspace input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(`Query,Page,Clicks,Impressions,Position\n${rows}`, "utf8") });
  await page.getByRole("region", { name: "پیش‌نمایش ورود داده" }).waitFor();
  await page.locator(".gsc-import-fields select").first().selectOption(period);
  await page.getByLabel("شروع دوره Search Console", { exact: true }).fill(start);
  await page.getByLabel("پایان دوره Search Console", { exact: true }).fill(end);
  await page.getByRole("button", { name: "تأیید و ثبت دوره", exact: true }).click();
  await saved((project) => project.searchConsole?.[period]?.rows.length === 3);
}

let failure;
try {
  await mkdir("artifacts", { recursive: true });
  await page.goto(base);
  await page.locator(".hero-card").waitFor();
  await saved(() => true);
  assert.equal(await page.locator(".sidebar .nav-item").count(), 7);
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  check("Integrated RTL app preserves all seven primary navigation sections");

  await page.getByRole("button", { name: "پروژه جدید", exact: true }).click();
  await page.getByLabel("نام پروژه", { exact: true }).fill("آزمون یکپارچه سئو");
  await page.getByLabel("دامنه", { exact: true }).fill("example.test");
  await page.getByRole("group", { name: "انتخاب روال پروژه" }).getByRole("button", { name: "فروشگاهی", exact: true }).click();
  await page.getByRole("button", { name: "ساخت پروژه", exact: true }).click();
  let current = await saved((project) => project.name === "آزمون یکپارچه سئو" && project.playbook?.id === "ecommerce");
  assert.equal(active(current).projectType, "Ecommerce");
  assert.equal(active(current).keywords.length, 0);
  check("Project creation applies a copied ecommerce playbook without copying demo records");

  // Seed many rows only after a genuine UI-created project is committed. The
  // isolated fixture uses the same IndexedDB envelope as production autosave.
  const fixture = structuredClone(current), project = active(fixture);
  const special = [
    { id: "camera-head", keyword: "دوربین مداربسته", volume: 3000, decision: "Keep" },
    { id: "camera-buy", keyword: "خرید دوربین مداربسته", volume: 2000, decision: "Keep" },
    { id: "camera-price", keyword: "قیمت دوربین مداربسته", volume: 1000, decision: "Keep" },
    { id: "camera-install", keyword: "آموزش نصب دوربین مداربسته", volume: 600, decision: "Keep" },
    { id: "camera-how", keyword: "نحوه نصب دوربین مداربسته", volume: 500, decision: "Keep" },
    { id: "manual-preserved", keyword: "دوربین داهوا", group: "گروه دستی محفوظ", intent: "ناوبری", notes: "این یادداشت دستی باقی بماند", decision: "Keep" },
  ];
  project.keywords = [...special, ...Array.from({ length: 2000 - special.length }, (_, index) => ({ id: `model-${index}`, keyword: `${index % 2 ? "خرید" : "قیمت"} دوربین مدل M-${Math.floor(index / 20)}`, volume: 50 + index, decision: "Keep" }))];
  project.pages = [
    { id: "camera-page", pageId: "P-001", target: "فروش دوربین مداربسته", pkw: "دوربین مداربسته", supporting: "خرید دوربین مداربسته", pageType: "دسته‌بندی محصول", existing: "Existing", status: "Published", url: "https://example.test/cameras/", priority: "P1", pageBrief: "بریف دستی محفوظ" },
    { id: "guide-page", pageId: "P-002", target: "راهنمای انتخاب دوربین مداربسته", pkw: "راهنمای انتخاب دوربین مداربسته", supporting: "دوربین مداربسته", pageType: "راهنمای خرید", existing: "Existing", status: "Published", url: "https://example.test/camera-guide/", priority: "P2" },
  ];
  project.content = [{ id: "published-content", topic: "مطلب منتشرشدهٔ واقعی", targetPage: "guide-page", contentType: "Buying Guide", stage: "Published", publishDate: "2026-10-01", owner: "علیرضا", notes: "PRIVATE_REPORT_NOTE_12" }];
  project.results = [{ id: "manual-result", pageId: "camera-page", clicks: 10, impressions: 100, position: 8, lastChecked: "2026-10-02", notes: "PRIVATE_MANUAL_RESULT_12" }];
  project.tasks = [{ id: "done-task", title: "کار انجام‌شده در دوره", status: "done", priority: "P2", completedAt: "2026-10-01", createdAt: "2026-09-30", notes: "PRIVATE_TASK_NOTE_12" }];
  await page.waitForTimeout(600);
  await page.evaluate((state) => new Promise((resolve, reject) => {
    const open = indexedDB.open("rooyesh-seo-v1", 1);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("workspace", "readwrite"), store = tx.objectStore("workspace"), read = store.get("state");
      read.onsuccess = () => store.put({ state, revision: read.result.revision + 1, savedAt: new Date().toISOString() }, "state");
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), fixture);
  await page.reload();
  await page.locator(".hero-card").waitFor();
  await nav("کلمات کلیدی");
  await mode("دستیار هدف‌گذاری");
  await page.locator(".planner-group").first().waitFor();
  assert.ok(await page.locator(".planner-group").count() <= 60);
  assert.equal(await page.locator('.planner-group input[type="checkbox"]:checked').count(), 0);
  assert.equal(active(await state()).keywords.length, 2000);
  await page.getByLabel("جست‌وجوی پیشنهادهای صفحه").fill("M-99");
  assert.equal(await page.locator(".planner-group").count(), 1);
  await page.getByLabel("جست‌وجوی پیشنهادهای صفحه").fill("");
  await page.getByLabel("فیلتر پیشنهادهای صفحه").selectOption("blog");
  const proposal = page.locator(".planner-group").filter({ hasText: "آموزش نصب دوربین مداربسته" });
  assert.equal(await proposal.count(), 1);
  await proposal.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "بازبینی و ثبت برنامه", exact: true }).click();
  assert.equal(active(await state()).pages.length, 2);
  await page.getByRole("button", { name: "تأیید و ثبت در پروژه", exact: true }).click();
  current = await saved((project) => project.pages.length === 3 && project.content.length === 2);
  const plannedPage = active(current).pages.find((row) => !["camera-page", "guide-page"].includes(row.id));
  assert.equal(active(current).keywords.find((row) => row.id === "camera-install").targetPage, plannedPage.id);
  assert.equal(active(current).keywords.find((row) => row.id === "manual-preserved").notes, "این یادداشت دستی باقی بماند");
  assert.equal(active(current).pages.find((row) => row.id === "camera-page").pageBrief, "بریف دستی محفوظ");
  check("2,000-word page planning is bounded and searchable; reviewed blog plan atomically creates its page, brief and stable keyword links");

  await page.getByRole("button", { name: "رفتن به نقشهٔ صفحات", exact: true }).click();
  await page.getByRole("button", { name: `ویرایش ${plannedPage.target}`, exact: true }).click();
  await page.getByRole("heading", { name: "فضای کار این صفحه", exact: true }).waitFor();
  await page.getByRole("button", { name: /^محتوا:/ }).click();
  await page.locator(".workspace-drawer").waitFor();
  assert.equal(await page.locator("#field-content-targetPage").inputValue(), plannedPage.id);
  await page.getByRole("button", { name: "بستن پنل", exact: true }).click();
  await nav("نقشه صفحات");
  await page.getByRole("button", { name: `ویرایش ${plannedPage.target}`, exact: true }).click();
  await page.locator(".page-connections summary").click();
  await page.locator(".connection-list").getByRole("button", { name: "آموزش نصب دوربین مداربسته", exact: true }).click();
  assert.equal(await page.locator("#kw-keyword").inputValue(), "آموزش نصب دوربین مداربسته");
  assert.equal(await page.locator("#kw-targetPage").inputValue(), plannedPage.id);
  await page.getByRole("button", { name: "بستن ویرایش", exact: true }).click();
  await nav("نقشه صفحات");
  await page.getByRole("button", { name: "ویرایش راهنمای انتخاب دوربین مداربسته", exact: true }).click();
  await page.getByRole("button", { name: "آماده‌سازی بریف در خانه‌های خالی", exact: true }).click();
  await page.getByRole("button", { name: "ذخیره صفحه", exact: true }).click();
  await saved((project) => Boolean(project.pages.find((row) => row.id === "guide-page").pageBrief));
  check("Page workspace resolves stable content IDs across App navigation and local brief generation fills empty fields");

  await nav("نمای کلی");
  await page.getByRole("button", { name: "کار جدید", exact: true }).click();
  await page.getByLabel("عنوان کار پروژه").fill("بررسی عملی عنوان صفحه");
  await page.getByLabel("تاریخ انجام کار", { exact: true }).fill("۱۴۰۵/۰۷/۲۰");
  await page.getByLabel("اولویت کار").selectOption("P1");
  await page.getByLabel("صفحهٔ مرتبط با کار").selectOption("camera-page");
  await page.getByLabel("یادداشت کار").fill("یادداشت خصوصی کار روزانه");
  await page.getByRole("button", { name: "ذخیرهٔ کار", exact: true }).click();
  await saved((project) => project.tasks.some((task) => task.title === "بررسی عملی عنوان صفحه" && task.dueDate === "2026-10-12"));
  await page.getByRole("button", { name: "همهٔ کارها", exact: true }).click();
  let taskCard = page.locator(".assistant-action").filter({ has: page.getByRole("heading", { name: "بررسی عملی عنوان صفحه", exact: true }) });
  await taskCard.getByRole("button", { name: "انجام شد", exact: true }).click();
  await saved((project) => project.tasks.some((task) => task.title === "بررسی عملی عنوان صفحه" && task.status === "done" && task.completedAt));
  await page.getByLabel("نمایش کارهای بسته").check();
  await taskCard.getByRole("button", { name: "بازگرداندن", exact: true }).click();
  await saved((project) => project.tasks.some((task) => task.title === "بررسی عملی عنوان صفحه" && task.status === "open"));
  await page.getByLabel("نمایش کارهای بسته").uncheck();
  await taskCard.getByRole("button", { name: "ویرایش کار بررسی عملی عنوان صفحه", exact: true }).click();
  await page.getByLabel("عنوان کار پروژه").fill("بررسی عملی عنوان اصلاح‌شده");
  await page.getByRole("button", { name: "ذخیرهٔ کار", exact: true }).click();
  await saved((project) => project.tasks.some((task) => task.title === "بررسی عملی عنوان اصلاح‌شده"));
  await page.getByRole("button", { name: "حذف کار بررسی عملی عنوان اصلاح‌شده", exact: true }).click();
  await saved((project) => !project.tasks.some((task) => task.title === "بررسی عملی عنوان اصلاح‌شده"));
  check("Daily task CRUD, Shamsi due date, complete and reopen persist through the real project callback");

  await nav("نقشه صفحات");
  await mode("ارتباط صفحات و لینک‌سازی");
  const linkCard = page.locator(".relationship-card").filter({ hasText: "راهنمای انتخاب دوربین مداربسته" }).filter({ hasText: "فروش دوربین مداربسته" }).first();
  await linkCard.getByRole("button", { name: "ثبت برنامهٔ لینک", exact: true }).click();
  current = await saved((project) => project.links?.length === 1);
  const link = active(current).links[0];
  assert.ok(active(current).tasks.some((task) => task.source === `link:${link.fromPageId}:${link.toPageId}`));
  await page.getByRole("button", { name: "ارتباط‌های ثبت‌شده", exact: true }).click();
  await page.getByRole("button", { name: "ثبت اجرای واقعی", exact: true }).click();
  await saved((project) => project.links[0].status === "implemented");
  check("Reviewed internal link and its task are saved together; actual execution status remains a user decision");

  await nav("نتایج و بهبود");
  await mode("تحلیل Search Console");
  await importGsc("current-period.csv", "current", "۱۴۰۵/۰۷/۰۱", "۱۴۰۵/۰۷/۱۴", "خرید دوربین مداربسته,https://example.test/cameras/,8,2000,11\nراهنمای انتخاب دوربین,https://example.test/camera-guide/,15,500,7\nآموزش دوربین,https://example.test/cameras/,5,300,13");
  await importGsc("previous-period.csv", "previous", "۱۴۰۵/۰۶/۱۸", "۱۴۰۵/۰۶/۳۱", "خرید دوربین مداربسته,https://example.test/cameras/,100,2200,9\nراهنمای انتخاب دوربین,https://example.test/camera-guide/,20,500,7\nآموزش دوربین,https://example.test/cameras/,10,300,11");
  await page.getByRole("group", { name: "انتخاب دوره", exact: true }).getByRole("button", { name: /^دورهٔ فعلی/ }).click();
  await page.getByLabel("نوع فرصت").selectOption("decline");
  const insight = page.locator(".gsc-insight").first();
  await insight.waitFor();
  assert.ok((await insight.textContent()).includes("کلیک دورهٔ قبل"));
  await insight.getByRole("button", { name: "اضافه به کارها", exact: true }).click();
  current = await saved((project) => project.tasks.some((task) => String(task.source).startsWith("gsc:")));
  assert.equal(active(current).searchConsole.current.rows[0].clicks, 8);
  assert.ok(active(current).tasks.find((task) => String(task.source).startsWith("gsc:")).pageId === "camera-page");
  check("Local current/previous GSC imports align equal periods, expose measured decline and create a page-linked period-specific task");

  await mode("گزارش پروژه");
  assert.equal(await page.locator('.project-report-private input[type="checkbox"]').isChecked(), false);
  await page.getByRole("button", { name: "استفاده از دورهٔ واردشده", exact: true }).click();
  assert.equal(await page.getByLabel("شروع بازه گزارش", { exact: true }).inputValue(), "۱۴۰۵/۰۷/۰۱");
  const report = await download("دانلود گزارش", "intelligence-client-report.html");
  assert.ok(report.includes("کار انجام‌شده در دوره"));
  assert.ok(report.includes("مطلب منتشرشدهٔ واقعی"));
  assert.ok(report.includes("جمع ردیف‌های یک فایل"));
  assert.ok(!report.includes("PRIVATE_REPORT_NOTE_12"));
  assert.ok(!report.includes("PRIVATE_TASK_NOTE_12"));
  assert.ok(!report.includes("PRIVATE_MANUAL_RESULT_12"));
  const csv = await download("دادهٔ CSV", "intelligence-client-report.csv");
  assert.ok(csv.includes("کار انجام‌شده در دوره"));
  check("Real HTML/CSV report downloads use the imported Shamsi period and exclude private notes by default");

  await nav("تنظیمات و راهنما");
  await page.getByRole("button", { name: "مخاطب، بریف و قواعد پیشنهادی", exact: true }).click();
  await page.getByLabel("نام روال", { exact: true }).fill("روال دوربین اختصاصی");
  await page.getByRole("button", { name: "ذخیره به‌عنوان روال شخصی", exact: true }).click();
  current = await saved((project, state) => state.settings.playbooks?.some((item) => item.label === "روال دوربین اختصاصی"));
  assert.equal(active(current).playbook.label, "روال دوربین اختصاصی");
  assert.ok(current.projects.find((item) => item.id !== current.activeProjectId).playbook?.label !== "روال دوربین اختصاصی");
  await page.getByRole("button", { name: "سابقه تغییرات", exact: true }).click();
  await page.getByText("سابقهٔ تغییرات", { exact: true }).waitFor();
  assert.ok((await page.locator(".project-history").textContent()).includes("محلی"));
  check("Personal playbook persists independently; local history view explains its cloud requirement");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "فعال کردن حالت تاریک", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await nav("کلمات کلیدی");
  await mode("دستیار هدف‌گذاری");
  await page.locator(".page-planner").waitFor();
  await noOverflow();
  await page.screenshot({ path: "artifacts/intelligence-mobile-dark.png", fullPage: true });
  await nav("نتایج و بهبود");
  await mode("تحلیل Search Console");
  await page.locator(".gsc-workspace").waitFor(); await noOverflow();
  await mode("گزارش پروژه");
  await page.locator(".project-report-paper").waitFor(); await noOverflow();
  check("Planner, GSC and report retain mobile RTL dark layout without horizontal document overflow");

  if (process.env.INTELLIGENCE_SKIP_OFFLINE !== "1") {
    await page.evaluate(() => navigator.serviceWorker.ready);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await page.evaluate(async () => (await caches.keys()).some((name) => name.startsWith("rooyesh-")))) break;
      await page.waitForTimeout(100);
    }
    await context.setOffline(true);
    await page.reload();
    await page.locator(".hero-card").waitFor();
    await nav("کلمات کلیدی"); await mode("دستیار هدف‌گذاری"); await page.locator(".planner-group").first().waitFor();
    await nav("نقشه صفحات"); await mode("ارتباط صفحات و لینک‌سازی"); await page.locator(".page-relationships").waitFor();
    await nav("نتایج و بهبود"); await mode("تحلیل Search Console"); await page.locator(".gsc-workspace").waitFor();
    await mode("گزارش پروژه"); await page.locator(".project-report-paper").waitFor();
    assert.equal(active(await state()).keywords.length, 2000);
    check("Cold offline reload reaches cached lazy planner, links, GSC and report while preserving project data");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  check("No runtime errors or external service requests throughout integrated intelligence workflows");
} catch (error) {
  failure = error; console.error(error);
  await page.screenshot({ path: "artifacts/intelligence-integrated-failure.png", fullPage: true }).catch(() => {});
}
await writeFile("artifacts/intelligence-integrated-checks.json", JSON.stringify({ base, checks, errors, external, failure: failure?.message || null }, null, 2));
await browser.close();
if (failure) process.exitCode = 1;
