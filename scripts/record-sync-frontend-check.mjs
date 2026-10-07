import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// This test replaces shared data and creates an editor. Use a disposable local
// Wrangler + D1 instance with the production assets and all migrations applied.
const origin = process.env.RECORD_FRONTEND_URL || "http://127.0.0.1:8896";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Record frontend checks require a disposable local Worker.");
const vars = await readFile(process.env.RECORD_FRONTEND_VARS || "/tmp/record-sync-smoke/.dev.vars", "utf8");
const raw = /^APP_PASSWORD=(.+)$/m.exec(vars)?.[1]?.trim();
if (!raw) throw new Error("Disposable Worker password is missing.");
const password = raw.startsWith('"') ? JSON.parse(raw) : raw.replace(/^'|'$/g, "");
const runId = Date.now().toString(36), editorUsername = `sync-${runId}`;
const editorPassword = "disposable-record-editor-password-123";
const projectId = `record-frontend-${runId}`, keywordId = `keyword-${runId}`;
const project = {
  id: projectId, name: "آزمون دو دستگاه", domain: "https://example.com", market: "", language: "fa-IR", projectType: "Ecommerce", goal: "", startDate: "", lastReview: "",
  keywords: [{ id: keywordId, keyword: "دوربین مداربسته", group: "", intent: "", decision: "Review", notes: "" }, { id: `${keywordId}-second`, keyword: "خرید دوربین مداربسته", group: "", intent: "" }], pages: [], content: [], results: [],
};
const seed = { version: 1, activeProjectId: projectId, settings: { titleMin: 30, titleMax: 60, metaMin: 120, metaMax: 160 }, projects: [project] };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const contexts = [], checks = [], errors = [], requests = [], external = [];
let owner, editor, failure, releaseResponse;
const check = (name) => { checks.push(name); console.log("PASS", name); };
async function until(fn, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error("Expected record-sync state was not reached.");
}
async function api(context, path, method = "GET", body) {
  const response = await context.request.fetch(origin + path, { method, headers: body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }, ...(body === undefined ? {} : { data: JSON.stringify(body) }) });
  return { status: response.status(), body: await response.json() };
}
async function local(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("rooyesh-seo-v1", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction("workspace").objectStore("workspace").get("state");
      read.onsuccess = () => { resolve(read.result?.state ?? null); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  }));
}
function currentProject(state) { return state?.projects.find((item) => item.id === projectId); }
async function navigate(page, label) { await page.locator(".sidebar .nav-item").filter({ hasText: label }).click(); }
async function settings(page) {
  await navigate(page, "تنظیمات و راهنما");
  await page.getByRole("button", { name: "پروژه و تنظیمات", exact: true }).click();
}
async function device(username, pass) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } }); contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin && !["data:", "blob:"].includes(url.protocol)) external.push(request.url());
    if (["/api/changes", "/api/state"].includes(url.pathname)) requests.push({ username, method: request.method(), path: url.pathname });
  });
  await page.goto(origin);
  await page.locator("#auth-username").fill(username);
  await page.locator("#auth-password").fill(pass);
  await page.locator(".auth-remember input").check();
  await page.getByRole("button", { name: "ورود به استودیو", exact: true }).click();
  await page.locator(".hero-card").waitFor();
  await until(async () => currentProject(await local(page))?.name === project.name);
  return { context, page };
}
try {
  await mkdir("artifacts", { recursive: true });
  const seeder = await browser.newContext(); contexts.push(seeder);
  assert.equal((await api(seeder, "/api/login", "POST", { username: "alireza", password })).status, 200);
  const saved = await api(seeder, "/api/state");
  assert.equal((await api(seeder, "/api/state", "PUT", { revision: saved.body.revision, state: seed })).status, 200);
  assert.equal((await api(seeder, "/api/users", "POST", { username: editorUsername, displayName: "همکار آزمون همگام‌سازی", role: "editor", password: editorPassword })).status, 201);
  owner = await device("alireza", password); editor = await device(editorUsername, editorPassword);
  check("Two independent authenticated devices load the shared workspace from actual D1");

  await Promise.all([navigate(owner.page, "کلمات کلیدی"), navigate(editor.page, "کلمات کلیدی")]);
  await Promise.all([owner.page.getByRole("button", { name: "ویرایش دوربین مداربسته", exact: true }).click(), editor.page.getByRole("button", { name: "ویرایش دوربین مداربسته", exact: true }).click()]);
  await owner.page.locator("#kw-intent").selectOption("بررسی تجاری");
  await editor.page.locator("#kw-group").fill("دوربین برای خرید");
  await Promise.all([owner.page.locator(".kw-drawer").getByRole("button", { name: "ذخیره تغییرات", exact: true }).click(), editor.page.locator(".kw-drawer").getByRole("button", { name: "ذخیره تغییرات", exact: true }).click()]);
  await until(async () => {
    const row = currentProject((await api(seeder, "/api/state")).body.state)?.keywords.find((item) => item.id === keywordId);
    return row?.intent === "بررسی تجاری" && row.group === "دوربین برای خرید";
  });
  assert.equal(await owner.page.locator(".warning-banner").count(), 0); assert.equal(await editor.page.locator(".warning-banner").count(), 0);
  check("Separate fields on one stamped keyword merge through the actual UI without false conflicts");
  await Promise.all([owner.page.reload(), editor.page.reload()]);
  await until(async () => [await local(owner.page), await local(editor.page)].every((state) => {
    const row = currentProject(state)?.keywords.find((item) => item.id === keywordId); return row?.intent === "بررسی تجاری" && row.group === "دوربین برای خرید";
  }));
  check("Reloading either device retains both independently committed keyword fields");

  const foreignRowId = `foreign-${runId}`;
  const beforeForeign = (await api(seeder, "/api/state")).body;
  assert.equal((await api(seeder, "/api/changes", "POST", {
    revision: beforeForeign.revision,
    changes: { version: 1, changes: [{ kind: "create", collection: "keywords", projectId, rowId: foreignRowId, after: { id: foreignRowId, keyword: "ردیف افزوده‌شده در دستگاه دیگر", notes: "نباید با بارگذاری مجدد حذف شود" } }] },
  })).status, 200);
  await settings(owner.page);
  await owner.page.getByLabel("هدف سئو", { exact: true }).fill("هدف پس از دریافت تغییر تیم");
  await until(() => owner.page.evaluate(async ({ projectId, foreignRowId }) => {
    const cache = await new Promise((resolve, reject) => {
      const request = indexedDB.open("seo-studio-cloud-base-v1", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, read = db.transaction("base").objectStore("base").getAll(); read.onsuccess = () => { resolve(read.result); db.close(); }; read.onerror = () => { reject(read.error); db.close(); }; };
    });
    return cache.some((base) => base.state.projects.find((item) => item.id === projectId)?.keywords.some((row) => row.id === foreignRowId));
  }, { projectId, foreignRowId }));
  assert.ok(currentProject(await local(owner.page)).keywords.some((row) => row.id === foreignRowId), "durable local state must include returned foreign rows before the durable base advances");
  await owner.page.reload(); await owner.page.locator(".sidebar").waitFor();
  await until(async () => currentProject(await local(owner.page))?.keywords.some((row) => row.id === foreignRowId));
  assert.ok(currentProject((await api(seeder, "/api/state")).body.state).keywords.some((row) => row.id === foreignRowId));
  check("A returned teammate row is committed locally before its merge base advances and survives immediate reload");

  await settings(owner.page);
  let hold = true, captured;
  const responseCaptured = new Promise((resolve) => { captured = resolve; });
  const delayed = new Promise((resolve) => { releaseResponse = resolve; });
  await owner.page.route("**/api/changes", async (route) => {
    if (!hold) return route.continue();
    hold = false; const response = await route.fetch(); captured(); await delayed; await route.fulfill({ response });
  });
  await owner.page.getByLabel("هدف سئو", { exact: true }).fill("هدف ثبت‌شده هنگام ارسال");
  await Promise.race([responseCaptured, new Promise((_, reject) => setTimeout(() => reject(new Error("Incremental request was not captured.")), 15000))]);
  await owner.page.getByLabel("نام پروژه", { exact: true }).fill("ویرایش دوم در زمان ارسال");
  await until(async () => currentProject(await local(owner.page))?.name === "ویرایش دوم در زمان ارسال");
  releaseResponse();
  await until(async () => { const value = currentProject((await api(seeder, "/api/state")).body.state); return value?.goal === "هدف ثبت‌شده هنگام ارسال" && value.name === "ویرایش دوم در زمان ارسال"; });
  assert.equal(await owner.page.locator(".warning-banner").count(), 0);
  await owner.page.unroute("**/api/changes");
  check("A second edit made during an in-flight response stays local and is subsequently synchronized");

  await Promise.all([owner.page.reload(), editor.page.reload()]);
  await Promise.all([settings(owner.page), settings(editor.page)]);
  await until(() => owner.page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
  await owner.context.setOffline(true);
  await owner.page.getByLabel("هدف سئو", { exact: true }).fill("تغییر آفلاین محفوظ پس از بارگذاری مجدد");
  await until(async () => currentProject(await local(owner.page))?.goal === "تغییر آفلاین محفوظ پس از بارگذاری مجدد");
  await owner.page.reload();
  await owner.page.locator(".sidebar").waitFor();
  await editor.page.getByLabel("دامنه", { exact: true }).fill("https://second-device.example.com");
  await until(async () => currentProject((await api(seeder, "/api/state")).body.state)?.domain === "https://second-device.example.com");
  await owner.context.setOffline(false);
  await until(async () => { const value = currentProject((await api(seeder, "/api/state")).body.state); return value?.goal === "تغییر آفلاین محفوظ پس از بارگذاری مجدد" && value.domain === "https://second-device.example.com"; });
  assert.equal(await owner.page.locator(".warning-banner").count(), 0);
  check("A cold offline reload reuses its durable merge base and preserves another device's unrelated online edit");

  await Promise.all([owner.page.reload(), editor.page.reload()]);
  await Promise.all([settings(owner.page), settings(editor.page)]);
  await owner.page.getByLabel("هدف سئو", { exact: true }).fill("تصمیم نهایی مالک");
  await until(async () => currentProject((await api(seeder, "/api/state")).body.state)?.goal === "تصمیم نهایی مالک");
  await editor.page.getByLabel("هدف سئو", { exact: true }).fill("تصمیم هم‌زمان محفوظ همکار");
  await until(async () => (await editor.page.locator(".warning-banner").count()) > 0);
  assert.equal(currentProject((await api(seeder, "/api/state")).body.state).goal, "تصمیم نهایی مالک");
  assert.equal(currentProject(await local(editor.page)).goal, "تصمیم هم‌زمان محفوظ همکار");
  check("A genuine same-field conflict stops synchronization and preserves the teammate's local decision");

  const history = await api(seeder, `/api/history?projectId=${projectId}`);
  assert.equal(history.status, 200);
  const keywordEvents = history.body.events.filter((event) => event.rowId === keywordId);
  assert.ok(keywordEvents.some((event) => event.actorName === "علیرضا ملائی"));
  assert.ok(keywordEvents.some((event) => event.actorName === "همکار آزمون همگام‌سازی"));
  assert.ok(keywordEvents.some((event) => event.summary.includes("نیت")));
  assert.ok(keywordEvents.some((event) => event.summary.includes("گروه")));
  check("History identifies the actual owner and editor for their independently merged keyword changes");
  assert.equal(requests.filter((request) => request.path === "/api/state" && request.method === "PUT").length, 0);
  assert.ok(requests.some((request) => request.path === "/api/changes" && request.method === "POST"));
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  check("Ordinary UI saves use incremental requests and produce no browser errors or external dependency requests");
} catch (cause) {
  failure = cause instanceof Error ? cause.message : String(cause);
  releaseResponse?.();
  if (owner) await owner.page.screenshot({ path: "artifacts/record-sync-frontend-failure-owner.png", fullPage: true }).catch(() => {});
  if (editor) await editor.page.screenshot({ path: "artifacts/record-sync-frontend-failure-editor.png", fullPage: true }).catch(() => {});
  console.error(cause); process.exitCode = 1;
} finally {
  await writeFile("artifacts/record-sync-frontend-checks.json", JSON.stringify({ checkedAt: new Date().toISOString(), passed: checks.length, completed: !failure, checks, errors, external, ...(failure ? { failure } : {}) }, null, 2));
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
}
