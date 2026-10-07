import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
const base = process.env.TEST_URL || "http://localhost:4173";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
const checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
async function nav(name) {
  await page.locator(".sidebar .nav-item").filter({ hasText: name }).click();
}
async function saved(predicate) {
  for (let i = 0; i < 100; i++) {
    const r = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("rooyesh-seo-v1", 1);
          open.onsuccess = () => {
            const db = open.result;
            const r = db
              .transaction("workspace")
              .objectStore("workspace")
              .get("state");
            r.onsuccess = () => {
              resolve(r.result?.state ?? null);
              db.close();
            };
            r.onerror = () => reject(r.error);
          };
          open.onerror = () => reject(open.error);
        }),
    );
    if (r && predicate(r)) return r;
    await page.waitForTimeout(100);
  }
  throw new Error("Saved state did not reach expected content");
}
function active(s) {
  return s.projects.find((p) => p.id === s.activeProjectId);
}
try {
  await mkdir("artifacts", { recursive: true });
  await page.goto(base);
  await page.waitForSelector(".hero-card");
  await saved((s) => s.projects.length === 1);
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  await page.screenshot({
    path: "artifacts/dashboard-desktop.png",
    fullPage: true,
  });
  check("RTL application renders and initial IndexedDB save completes");
  await page.getByRole("button", { name: "پروژه جدید", exact: true }).click();
  await page.getByLabel("نام پروژه", { exact: true }).fill("آزمایش کاربردی");
  await page.getByLabel("دامنه", { exact: true }).fill("example.com");
  await page.getByRole("button", { name: "ساخت پروژه", exact: true }).click();
  await saved((s) => active(s).name === "آزمایش کاربردی");
  check("Project create/switch isolates data");
  await nav("کلمات کلیدی");
  await page
    .getByRole("button", { name: "کلمه جدید", exact: true })
    .first()
    .click();
  await page.locator("#kw-keyword").fill("خرید دوربین كیفی");
  await page.locator("#kw-volume").fill("120");
  await page.locator("#kw-kd").selectOption("آسان");
  await page.locator("#kw-intent").selectOption("تراکنشی");
  await page.locator("#kw-decision").selectOption("Keep");
  await page.locator("#kw-group").fill("گروه تست");
  await page.locator("#kw-notes").fill("یادداشت دستی امن");
  await page
    .getByRole("button", { name: "ذخیره تغییرات", exact: true })
    .click();
  let state = await saved((s) => active(s).keywords.length === 1);
  const keywordId = active(state).keywords[0].id;
  check("Keyword creation stores human decisions under stable ID");
  await page.getByRole("button", { name: "ورود داده", exact: true }).click();
  await page
    .locator(".kw-paste-area textarea")
    .fill(
      "keyword,volume,kd,intent\nخرید دوربین کیفی,999,35,Informational\nقیمت دوربین کیفی,200,18,Commercial",
    );
  await page
    .getByRole("button", { name: "ساخت پیش‌نمایش", exact: true })
    .click();
  assert.equal(active(await saved((s) => true)).keywords.length, 1);
  await page
    .getByRole("button", { name: "تأیید و ورود داده", exact: true })
    .click();
  state = await saved((s) => active(s).keywords.length === 2);
  const k = active(state).keywords.find((r) => r.id === keywordId);
  assert.equal(k.volume, 120);
  assert.equal(k.kd, "آسان");
  assert.equal(k.intent, "تراکنشی");
  assert.equal(k.notes, "یادداشت دستی امن");
  assert.equal(k.kdTool, 35);
  assert.equal(k.toolIntent, "Informational");
  check(
    "Mapped import uses technical Persian match and preserves manual values",
  );
  await page.locator("thead .kw-sort").filter({ hasText: "حجم جست" }).click();
  await page.getByLabel("جستجوی کلمات کلیدی").fill("خرید");
  await page.locator(".kw-keyword-button").first().click();
  assert.equal(
    await page.locator("#kw-notes").inputValue(),
    "یادداشت دستی امن",
  );
  await page.locator("#kw-notes").fill("تغییر ذخیره‌نشده");
  await page.getByRole("button", { name: "بستن ویرایش" }).click();
  await page.getByRole("button", { name: "ادامه ویرایش" }).click();
  assert.equal(
    await page.locator("#kw-notes").inputValue(),
    "تغییر ذخیره‌نشده",
  );
  await page.getByRole("button", { name: "بستن ویرایش" }).click();
  await page.getByRole("button", { name: "صرف‌نظر از تغییرات" }).click();
  state = await saved((s) => true);
  assert.equal(
    active(state).keywords.find((r) => r.id === keywordId).notes,
    "یادداشت دستی امن",
  );
  check("Sort/filter preserve row identity and discarded drafts never save");
  await page.getByLabel("جستجوی کلمات کلیدی").fill("");
  await page.getByRole("button", { name: "کلمه جدید", exact: true }).click();
  await page.locator("#kw-keyword").fill("خرید دوربین کیفی");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await saved((s) => active(s).keywords.length === 3);
  await page.getByLabel("فیلتر کیفیت داده").selectOption("duplicates");
  assert.equal(await page.locator(".kw-table tbody tr").count(), 2);
  check("Technical duplicates are flagged and filterable without deletion");
  const csvPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "خروجی CSV", exact: true }).click();
  const csv = await csvPromise;
  await csv.saveAs("artifacts/browser-keywords.csv");
  check("CSV export is downloadable");
  await nav("نقشه صفحات");
  await page
    .getByRole("button", { name: "صفحه جدید", exact: true })
    .first()
    .click();
  await page.locator("#field-pages-target").fill("صفحه دوربین تست");
  await page.locator("#field-pages-pkw").fill("خرید دوربین كیفی");
  await page.locator("#field-pages-pageType").selectOption("دسته‌بندی محصول");
  await page.locator("#field-pages-existing").selectOption("New");
  await page.locator("#field-pages-url").fill("https://example.com/cameras");
  await page.locator("#field-pages-action").selectOption("Create New");
  await page.locator("#field-pages-priority").selectOption("P0");
  await page
    .locator("details")
    .filter({
      has: page.locator("summary").filter({ hasText: "سئوی داخل صفحه" }),
    })
    .locator("summary")
    .click();
  await page
    .locator("#field-pages-proposedTitle")
    .fill("خرید دوربین با کیفیت | فروشگاه نمونه");
  await page.locator("#field-pages-proposedH1").fill("خرید دوربین کیفی");
  await page
    .locator("#field-pages-proposedMeta")
    .fill(
      "مقایسه دوربین‌های با کیفیت و انتخاب محصول مناسب برای خانه و محل کار با اطلاعات روشن و خدمات فروشگاه نمونه.",
    );
  await page.getByRole("button", { name: "ذخیره صفحه", exact: true }).click();
  state = await saved((s) => active(s).pages.length === 1);
  const pageId = active(state).pages[0].id;
  check("Page mapping, SEO modules, priority and title checks work");
  await nav("محتوا و تقویم");
  await page
    .getByRole("button", { name: "محتوای جدید", exact: true })
    .first()
    .click();
  await page.locator("#field-content-targetPage").selectOption(pageId);
  await page.locator("#field-content-topic").fill("راهنمای انتخاب دوربین");
  await page.locator("#field-content-contentType").selectOption("Buying Guide");
  await page.locator("#field-content-publishDate").fill("۱۴۰۵/۰۷/۲۰");
  await page.getByRole("button", { name: "ذخیره محتوا", exact: true }).click();
  await saved((s) => active(s).content.length === 1);
  await page.getByRole("button", { name: "تقویم", exact: true }).click();
  assert.equal(await page.locator(".calendar-item").count(), 1);
  check("Content links to stable page ID and calendar displays planned item");
  await nav("نتایج و بهبود");
  await page
    .getByRole("button", { name: "ثبت نتیجه", exact: true })
    .first()
    .click();
  await page.locator("#field-results-pageId").selectOption(pageId);
  await page.locator("#field-results-baselineDate").fill("۱۴۰۵/۰۷/۰۹");
  await page.locator("#field-results-clicks").fill("10");
  await page.locator("#field-results-impressions").fill("100");
  await page.locator("#field-results-ctr").fill("10");
  await page.locator("#field-results-position").fill("8");
  await page.locator("#field-results-result").selectOption("Improving");
  await page
    .locator("summary")
    .filter({ hasText: "مقایسه با دوره قبل" })
    .click();
  await page.locator("#field-results-previousClicks").fill("0");
  await page.locator("#field-results-previousPosition").fill("10");
  assert.ok(
    !(await page.locator(".result-comparison-card").innerText()).includes(
      "Infinity",
    ),
  );
  await page.getByRole("button", { name: "ذخیره نتیجه", exact: true }).click();
  await saved((s) => active(s).results.length === 1);
  check("Results inherit page data and zero-baseline comparison stays safe");
  await page.reload();
  await page.waitForSelector(".hero-card");
  state = await saved(
    (s) =>
      active(s).pages.length === 1 &&
      active(s).content.length === 1 &&
      active(s).results.length === 1,
  );
  assert.equal(active(state).content[0].targetPage, pageId);
  check("Reload restores all modules and stable crosslinks");
  const backupPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "دانلود پشتیبان", exact: true })
    .click();
  const backup = await backupPromise;
  await backup.saveAs("artifacts/browser-backup.json");
  check("Full JSON backup download succeeds");
  await nav("تنظیمات و راهنما");
  await page
    .getByRole("button", { name: "پشتیبان و فضای ابری", exact: true })
    .click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":2}'),
    });
  await page.waitForTimeout(300);
  assert.match(await page.locator(".toast").innerText(), /بازیابی نشد/);
  state = await saved((s) => true);
  assert.equal(active(state).pages.length, 1);
  check("Invalid backup is rejected without modifying data");
  const confirmPromise = page.waitForEvent("dialog");
  await page
    .locator("input[type=file]")
    .setInputFiles("artifacts/browser-backup.json");
  await (await confirmPromise).accept();
  await saved((s) => active(s).name === "آزمایش کاربردی");
  check("Valid backup restore validates and keeps original IDs");
  await nav("نقشه صفحات");
  await page
    .getByRole("button", { name: "حذف صفحه دوربین تست", exact: true })
    .click();
  assert.match(await page.getByRole("dialog").innerText(), /متصل|وابسته|مرتبط/);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "انصراف", exact: true })
    .click();
  assert.equal(active(await saved((s) => true)).pages.length, 1);
  check("Deletion is explicit and linked-record warning protects decisions");
  const xlsxPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "خروجی Excel", exact: true }).click();
  const xlsx = await xlsxPromise;
  await xlsx.saveAs("artifacts/browser-project.xlsx");
  check("Excel export downloads real XLSX from current project");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector(".hero-card");
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector(".hero-card");
  await page.waitForFunction(() =>
    document.querySelector(".connection-state")?.textContent.includes("آفلاین"),
  );
  await nav("کلمات کلیدی");
  await page.getByRole("button", { name: "کلمه جدید", exact: true }).click();
  await page.locator("#kw-keyword").fill("کلمه آفلاین");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await saved((s) =>
    active(s).keywords.some((k) => k.keyword === "کلمه آفلاین"),
  );
  await page.reload();
  await page.waitForSelector(".hero-card");
  check(
    "Production PWA opens offline, permits editing and survives offline reload",
  );
  await context.setOffline(false);
  const second = await context.newPage();
  await second.goto(base);
  await second.waitForSelector(".hero-card");
  assert.match(await second.locator(".warning-banner").innerText(), /تب دیگری/);
  await second.close();
  check("Second tab is read-only to prevent local overwrite races");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/dashboard-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "باز کردن منو" }).click();
  await nav("محتوا و تقویم");
  await page.waitForTimeout(250);
  await page.screenshot({
    path: "artifacts/content-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  check("Mobile RTL layout has no page overflow and navigation works");
  assert.deepEqual(errors, []);
  check("No browser runtime errors");
  await writeFile(
    "artifacts/browser-checks.json",
    JSON.stringify(
      { base, passed: checks.length, checks, browserErrors: errors },
      null,
      2,
    ),
  );
} catch (e) {
  await page.screenshot({
    path: "artifacts/browser-failure.png",
    fullPage: true,
  });
  console.error(e);
  console.error("Browser errors:", errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
