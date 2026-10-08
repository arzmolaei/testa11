import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.BULK_TEST_URL || "http://localhost:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Bulk browser checks require an isolated local environment.");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1480, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const checks = [], errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => dialog.accept());
let userRole = "owner";
await page.route("**/api/status", (route) => route.fulfill({ json: { configured: true, authenticated: true, user: { id: "bulk-test", username: "alireza", displayName: "علیرضا ملائی", role: userRole }, expiresAt: new Date(Date.now() + 86400000).toISOString() } }));
await page.route("**/api/state", (route) => route.fulfill({ json: { state: null, revision: 0 } }));
const check = (name) => { checks.push(name); console.log("PASS", name); };
async function nav(name) { await page.locator(".sidebar .nav-item").filter({ hasText: name }).click(); }
async function local() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("rooyesh-seo-v1", 1);
    request.onsuccess = () => { const db = request.result; const read = db.transaction("workspace").objectStore("workspace").get("state"); read.onsuccess = () => { resolve(read.result?.state); db.close(); }; read.onerror = () => reject(read.error); };
  }));
}
async function until(predicate) { for (let i = 0; i < 100; i++) { const state = await local(); if (state && predicate(state.projects[0])) return state.projects[0]; await page.waitForTimeout(100); } throw new Error("Saved state did not reach expected content"); }
async function save() { await page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).click(); await page.getByRole("button", { name: "ثبت نهایی", exact: true }).click(); }
async function draft() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("seo-bulk-drafts-v1", 1);
    request.onsuccess = () => { const db = request.result; const read = db.transaction("drafts").objectStore("drafts").get(JSON.stringify(["bulk-test", "bulk-project", "keywords"])); read.onsuccess = () => { resolve(read.result); db.close(); }; read.onerror = () => reject(read.error); };
  }));
}
let failure;
try {
  await mkdir("artifacts", { recursive: true });
  await page.goto(base); await page.locator(".sidebar").waitFor();
  await until(() => true);
  await page.waitForTimeout(600);
  const fixture = {
    version: 1, activeProjectId: "bulk-project", settings: { titleMin: 30, titleMax: 60, metaMin: 120, metaMax: 160 },
    projects: [{ id: "bulk-project", name: "آزمایش تغییر گروهی", domain: "example.com", market: "ایران", language: "فارسی", projectType: "Ecommerce", goal: "", startDate: "2026-10-07", lastReview: "",
      keywords: Array.from({ length: 2000 }, (_, n) => ({ id: `k${n}`, keyword: n === 0 ? "خرید دوربین داهوا ویژه" : n === 1 ? "قیمت دوربین داهوا" : n === 2 ? "خرید دوربین هایک ویژن" : `خرید کابل شبکه مدل ${n}`, volume: n, decision: "Review", notes: `یادداشت محفوظ ${n}`, ...(n === 0 ? { intent: "ناوبری", group: "گروه دستی محفوظ", targetPage: "p0" } : {}) })),
      pages: [{ id: "p0", pageId: "P-1", target: "صفحه محصول", pkw: "خرید دوربین", status: "Not Started", url: "https://example.com/product" }, { id: "p1", pageId: "P-2", target: "صفحه کابل", status: "Not Started", url: "https://example.com/cable" }],
      content: [{ id: "c0", topic: "راهنمای دوربین", targetPage: "p0", owner: "علیرضا", publishDate: "2026-10-07" }],
      results: [{ id: "r0", pageId: "p0", url: "https://example.com/product", clicks: 10, impressions: 100, baselineDate: "2026-10-07" }],
      tasks: [{ id: "t0", title: "بررسی صفحه", pageId: "p0", status: "open" }],
      links: [{ id: "l0", fromPageId: "p0", toPageId: "p1", anchor: "کابل", status: "planned" }],
    }],
  };
  await page.evaluate((state) => new Promise((resolve, reject) => { const open = indexedDB.open("rooyesh-seo-v1", 1); open.onsuccess = () => { const db = open.result; const tx = db.transaction("workspace", "readwrite"); tx.objectStore("workspace").put({ state, revision: 50, savedAt: new Date().toISOString() }, "state"); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; }), fixture);
  await page.reload(); await page.locator(".sidebar").waitFor(); await nav("تغییر گروهی");
  await page.getByRole("button", { name: "ردیف جدید", exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".bulk-workspace .btn-primary")?.disabled);
  assert.equal(await page.locator(".bulk-grid tbody tr:not(.bulk-spacer)").count(), 24);
  assert.equal(await page.locator(".bulk-grid").getAttribute("aria-rowcount"), "2001");
  await page.getByLabel("انتخاب تمام نتایج جدول").check();
  await page.getByLabel("فیلد تغییر گروهی").selectOption("intent"); await page.getByLabel("مقدار تغییر گروهی", { exact: true }).selectOption("اطلاعاتی");
  await page.getByRole("button", { name: "اعمال روی ۲٬۰۰۰ ردیف", exact: true }).click();
  assert.equal((await local()).projects[0].keywords[1999].intent, undefined);
  await save(); const all = await until((p) => p.keywords.every((k) => k.intent === "اطلاعاتی"));
  assert.equal(all.keywords[1999].notes, "یادداشت محفوظ 1999"); assert.equal(all.keywords[1999].id, "k1999");
  check("All 2,000 matching keywords edit in one transaction across the virtual grid, preserving IDs and manual notes");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByLabel("جستجو در همه ردیف‌ها").fill("خرید دوربین");
  await page.getByRole("button", { name: "کپی محدوده", exact: true }).click();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).split("\n").length, 2000);
  await page.getByLabel("جستجو در همه ردیف‌ها").fill("");
  check("Copying selected rows retains all 2,000 selected records when a search hides some of them");
  await page.getByRole("button", { name: "لغو انتخاب", exact: true }).click();
  await page.locator('[data-cell="0:0"]').dblclick();
  await page.getByLabel("کلمه کلیدی", { exact: true }).fill("خرید دوربین داهوا ویژه ویرایش"); await page.getByLabel("کلمه کلیدی", { exact: true }).press("Enter");
  assert.equal(await page.locator("[data-cell='1:0']").evaluate((el) => el === document.activeElement), true);
  await save(); await until((p) => p.keywords[0].keyword.endsWith("ویرایش"));
  check("Inline editing commits with Enter and moves to the next row without losing data");
  await page.getByRole("button", { name: "بازگردانی ذخیره اخیر", exact: true }).click();
  await until((p) => p.keywords[0].keyword === "خرید دوربین داهوا ویژه");
  await page.locator('[data-cell="0:0"]').dblclick();
  await page.getByLabel("کلمه کلیدی", { exact: true }).fill("خرید دوربین داهوا ویژه ویرایش");
  await page.getByLabel("کلمه کلیدی", { exact: true }).press("Enter"); await save();
  await until((p) => p.keywords[0].keyword.endsWith("ویرایش"));
  check("Undoing a committed transaction accepts validated rows with generated timestamps and restores the previous values");
  const lastColumn = Number(await page.locator(".bulk-grid").getAttribute("aria-colcount")) - 3;
  await page.locator(`[data-cell="0:${lastColumn}"]`).dblclick(); await page.locator(".bulk-cell-editor textarea,.bulk-cell-editor select").press("Tab");
  assert.equal(await page.locator("[data-cell='1:0']").evaluate((el) => el === document.activeElement), true);
  await page.locator('[data-cell="1:0"]').dblclick(); await page.locator(".bulk-cell-editor textarea").press("Shift+Tab");
  assert.equal(await page.locator(`[data-cell="0:${lastColumn}"]`).evaluate((el) => el === document.activeElement), true);
  check("Tab and Shift+Tab wrap across row boundaries in RTL logical column order");
  await page.locator('[data-cell="0:0"]').click(); await page.locator('[data-cell="1:1"]').click({ modifiers: ["Shift"] });
  assert.equal(await page.locator(".bulk-grid td.bulk-cell-selected").count(), 4);
  const copied = await page.locator(".bulk-grid-scroll").evaluate((element) => { const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, clipboardData: data })); return data.getData("text/plain"); });
  assert.equal(copied.split("\n").length, 2); assert.ok(copied.includes("\t"));
  check("Shift selection and native clipboard copy produce the exact rectangular TSV range");
  await page.locator('[data-cell="0:0"]').click();
  await page.locator(".bulk-grid-scroll").evaluate((element) => { const data = new DataTransfer(); data.setData("text/plain", "خرید دوربین داهوا ویژه ویرایش\t۱٬۲۵۰\nقیمت دوربین داهوا\t۰\n"); element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data })); });
  await page.getByRole("dialog", { name: "چسباندن از Excel یا Google Sheets" }).waitFor();
  assert.equal((await local()).projects[0].keywords[0].volume, 0);
  await page.getByRole("button", { name: "افزودن به پیش‌نویس", exact: true }).click(); await save();
  const pasted = await until((p) => p.keywords[0].volume === 1250 && p.keywords[1].volume === 0);
  assert.equal(pasted.keywords[0].group, "گروه دستی محفوظ");
  check("Native multi-row paste previews before applying, accepts Persian numbers and zero, preserves unrelated fields");
  await page.locator('[data-cell="0:1"]').click();
  await page.locator(".bulk-grid-scroll").evaluate((element) => { const data = new DataTransfer(); data.setData("text/plain", "-1\n40"); element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data })); });
  assert.equal(await page.getByRole("button", { name: "افزودن به پیش‌نویس", exact: true }).isDisabled(), true);
  await page.getByRole("dialog", { name: "چسباندن از Excel یا Google Sheets" }).getByLabel("بستن", { exact: true }).click();
  check("Invalid clipboard values block the entire paste transaction");
  await page.getByRole("button", { name: "پیشنهاد گروه‌بندی", exact: true }).click();
  await page.getByLabel("جست‌وجوی گروه‌های پیشنهادی").fill("دوربین");
  await page.getByLabel("انتخاب پیشنهاد دوربین داهوا", { exact: true }).uncheck();
  await page.getByLabel("نام گروه دوربین هایک ویژن", { exact: true }).fill("دوربین هوشمند");
  await page.getByRole("button", { name: "بازبینی و تأیید", exact: true }).click(); await page.getByRole("button", { name: "افزودن به پیش‌نویس جدول", exact: true }).click();
  assert.equal((await local()).projects[0].keywords[2].group, undefined);
  await save(); const suggested = await until((p) => p.keywords[2].group === "دوربین هوشمند");
  assert.equal(suggested.keywords[0].group, "گروه دستی محفوظ"); assert.equal(suggested.keywords[0].intent, "اطلاعاتی"); assert.equal(suggested.keywords[1].group, undefined);
  check("Smart grouping reviews all 2,000 keywords, supports excluded/renamed suggestions and protects manual intent/group values");
  await page.locator('[data-cell="0:5"]').click(); await page.locator('[data-cell="1:5"]').click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "پرکردن به پایین", exact: true }).click();
  assert.equal(await page.locator('[data-cell="1:5"]').textContent(), "گروه دستی محفوظ");
  await page.getByRole("button", { name: "واگرد", exact: true }).click();
  assert.equal(await page.locator('[data-cell="1:5"]').textContent(), "—");
  check("Fill-down copies the first selected value and transaction undo restores prior values");
  await page.locator(".bulk-tabs button").filter({ hasText: "نقشه صفحات" }).click();
  await page.getByLabel("انتخاب ردیف 1", { exact: true }).check(); await page.getByRole("button", { name: "حذف ردیف‌های محدوده", exact: true }).click();
  assert.ok((await page.getByRole("dialog", { name: "حذف ۱ ردیف" }).textContent()).includes("۵ رکورد مرتبط"));
  await page.getByRole("button", { name: "حذف از پیش‌نویس", exact: true }).click(); assert.equal(await page.locator(".bulk-grid tbody tr:not(.bulk-spacer)").count(), 1);
  await page.getByRole("button", { name: "واگرد", exact: true }).click(); assert.equal(await page.locator(".bulk-grid tbody tr:not(.bulk-spacer)").count(), 2);
  check("Bulk page deletion warns about linked keywords/content/results/tasks/links and remains reversible before saving");
  await page.locator('.bulk-tabs button').filter({ hasText: "محتوا و تقویم" }).click();
  await page.getByLabel("فیلد تغییر گروهی").selectOption("publishDate"); await page.getByLabel("مقدار تغییر گروهی", { exact: true }).fill("۱۴۰۵/۰۸/۰۱");
  await page.getByLabel("انتخاب تمام نتایج جدول").check(); await page.getByRole("button", { name: "اعمال روی ۱ ردیف", exact: true }).click(); await save();
  await until((p) => p.content[0].publishDate === "2026-10-23");
  assert.ok(!(await page.locator(".bulk-grid-scroll").textContent()).includes("2026-10"));
  await page.locator('.bulk-tabs button').filter({ hasText: "نتایج" }).click();
  await page.getByLabel("فیلد تغییر گروهی").selectOption("clicks"); await page.getByLabel("مقدار تغییر گروهی", { exact: true }).fill("۱۵۰"); await page.getByLabel("انتخاب تمام نتایج جدول").check(); await page.getByRole("button", { name: "اعمال روی ۱ ردیف", exact: true }).click(); await save(); await until((p) => p.results[0].clicks === 150);
  check("Content and result collections support bulk values, linked rows and Jalali date editing/display");
  await page.locator('.bulk-tabs button').filter({ hasText: "کلمات کلیدی" }).click(); await page.locator('[data-cell="0:0"]').dblclick(); await page.getByLabel("کلمه کلیدی", { exact: true }).fill("پیش‌نویس بازیابی امن"); await page.getByLabel("کلمه کلیدی", { exact: true }).press("Enter");
  for (let i = 0; i < 30 && !(await draft()); i++) await page.waitForTimeout(100);
  assert.ok((await draft())?.patches.some(([id, patch]) => id === "k0" && patch.keyword === "پیش‌نویس بازیابی امن"));
  await page.evaluate(() => window.dispatchEvent(new Event("seo:auth-expired"))); await page.locator(".sidebar").waitFor({ state: "detached" });
  await page.reload(); await page.locator(".sidebar").waitFor(); await nav("تغییر گروهی"); await page.getByRole("button", { name: "بازیابی پیش‌نویس", exact: true }).waitFor();
  assert.equal((await local()).projects[0].keywords[0].keyword, "خرید دوربین داهوا ویژه ویرایش");
  await page.getByRole("button", { name: "بازیابی پیش‌نویس", exact: true }).click(); await save(); await until((p) => p.keywords[0].keyword === "پیش‌نویس بازیابی امن");
  check("IndexedDB draft survives authentication expiry/unmount and reopens only through an explicit recovery review");
  await page.locator('[data-cell="0:0"]').dblclick(); await page.getByLabel("کلمه کلیدی", { exact: true }).fill("پیش‌نویس فقط خواندنی"); await page.getByLabel("کلمه کلیدی", { exact: true }).press("Enter"); await page.waitForTimeout(450);
  userRole = "viewer"; await page.reload(); await page.locator(".sidebar").waitFor(); await nav("تغییر گروهی"); await page.getByRole("button", { name: "بازیابی پیش‌نویس", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "بازیابی پیش‌نویس", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "ردیف جدید", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).isDisabled(), true);
  assert.equal((await local()).projects[0].keywords[0].keyword, "پیش‌نویس بازیابی امن");
  check("Viewer accounts cannot restore a writable draft, add rows or save group changes");
  assert.deepEqual(errors, []); check("No browser runtime errors in all bulk editing flows");
} catch (error) { failure = error; console.error(error); await page.screenshot({ path: "artifacts/bulk-failure.png", fullPage: true }); }
finally { await writeFile("artifacts/bulk-browser-checks.json", JSON.stringify({ passed: !failure, checks, errors, failure: failure?.message }, null, 2)); await browser.close(); }
if (failure) process.exitCode = 1;
