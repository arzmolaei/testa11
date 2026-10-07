import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// This suite changes accounts and shared project data; it refuses remote hosts.
// Point TEAM_TEST_URL and TEAM_TEST_VARS at a disposable local Worker+D1 database.
const base = process.env.TEAM_TEST_URL || "http://127.0.0.1:8895";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Team browser tests require a disposable local Worker.");
const variables = await readFile(process.env.TEAM_TEST_VARS || "/tmp/team-ui-smoke/.dev.vars", "utf8");
const raw = variables.match(/^APP_PASSWORD=(.+)$/m)?.[1]?.trim();
if (!raw) throw new Error("A disposable local APP_PASSWORD is required.");
const ownerPassword = raw.startsWith('"') ? JSON.parse(raw) : raw.replace(/^'|'$/g, "");
const memberPassword = "team-browser-member-password-123";
const changedOwnerPassword = "team-browser-changed-owner-password-456";
const runId = Date.now().toString(36);
const editorName = `editor-${runId}`, viewerName = `viewer-${runId}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const ownerContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 950 } });
const page = await ownerContext.newPage();
const errors = [], checks = [], contexts = [ownerContext];
function observe(p) { p.on("pageerror", (error) => errors.push(error.message)); p.on("dialog", (dialog) => dialog.accept()); }
observe(page);
function check(name) { checks.push(name); console.log("PASS", name); }
async function until(fn, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Expected state not reached");
}
async function nav(p, name) { await p.locator(".sidebar .nav-item").filter({ hasText: name }).click(); }
async function login(p, username, password) {
  await p.locator("#auth-username").waitFor();
  await p.locator("#auth-username").fill(username);
  await p.locator("#auth-password").fill(password);
  await p.getByRole("button", { name: "ورود به استودیو", exact: true }).click();
  await p.locator(".sidebar").waitFor();
}
async function api(p, path, method = "GET", body) {
  return p.evaluate(async ({ path, method, body }) => {
    const response = await fetch(`/api/${path}`, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { path, method, body });
}
async function local(p) {
  return p.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("rooyesh-seo-v1", 1);
    request.onsuccess = () => { const db = request.result; const read = db.transaction("workspace").objectStore("workspace").get("state"); read.onsuccess = () => { resolve(read.result?.state ?? null); db.close(); }; read.onerror = () => { reject(read.error); db.close(); }; };
    request.onerror = () => reject(request.error);
  }));
}
async function newDevice(username, password) {
  const context = await browser.newContext({ acceptDownloads: true }); contexts.push(context);
  const p = await context.newPage(); observe(p); await p.goto(base); await login(p, username, password);
  return { context, page: p };
}
let editorId, viewerId, editor, viewer, failure;
try {
  await mkdir("artifacts", { recursive: true });
  await page.goto(base);
  await page.locator("#auth-username").waitFor();
  assert.equal(await page.locator(".sidebar").count(), 0);
  assert.deepEqual(await page.evaluate(async () => (await indexedDB.databases()).map(item => item.name)), []);
  assert.equal((await api(page, "state")).status, 401);
  check("Anonymous visits show only login; private IndexedDB is not mounted and API state is unauthorized");
  await page.screenshot({ path: "artifacts/login-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "فعال‌کردن حالت تاریک", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.screenshot({ path: "artifacts/login-dark.png", fullPage: true });
  await page.getByRole("button", { name: "فعال‌کردن حالت روشن", exact: true }).click();
  check("Login supports the same light palette and persistent dark theme");
  await login(page, "alireza", ownerPassword);
  assert.equal((await api(page, "me")).body.user.role, "owner");
  await nav(page, "تنظیمات و راهنما");
  await page.getByRole("button", { name: "حساب و تیم", exact: true }).click();
  for (const [username, name, role] of [[editorName, "همکار ویرایشگر آزمایش", "editor"], [viewerName, "همکار مشاهده‌گر آزمایش", "viewer"]]) {
    await page.getByRole("button", { name: "عضو جدید", exact: true }).click();
    await page.locator("#team-display-name").fill(name);
    await page.locator("#team-username").fill(username);
    await page.locator("#team-role").selectOption(role);
    await page.locator("#team-member-password").fill(memberPassword);
    await page.getByRole("button", { name: "ساخت حساب", exact: true }).click();
    await page.locator(".team-member").filter({ hasText: username }).waitFor();
  }
  const members = (await api(page, "users")).body.users;
  editorId = members.find(user => user.username === editorName).id;
  viewerId = members.find(user => user.username === viewerName).id;
  assert.ok(members.every(user => !Object.keys(user).some(key => key.includes("password"))));
  check("Owner creates independent editor and viewer accounts through the account/team UI");
  await page.getByRole("button", { name: "پروژه و تنظیمات", exact: true }).click();
  const projectName = `پروژه اختصاصی آزمایش ${runId}`;
  await page.getByLabel("نام پروژه", { exact: true }).fill(projectName);
  await nav(page, "تغییر گروهی");
  await page.getByRole("button", { name: "ردیف جدید", exact: true }).click();
  await page.locator(".bulk-cell-editor textarea").fill("کلمه خصوصی مالک");
  await page.locator(".bulk-cell-editor textarea").press("Enter");
  await page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).click();
  await page.getByRole("button", { name: "ثبت نهایی", exact: true }).click();
  await nav(page, "تنظیمات و راهنما");
  await page.getByRole("button", { name: "پشتیبان و فضای ابری", exact: true }).click();
  await page.getByRole("button", { name: "ارسال نسخه این دستگاه", exact: true }).click();
  await until(async () => (await api(page, "state")).body.state?.projects.some(project => project.name === projectName && project.keywords.some(keyword => keyword.keyword === "کلمه خصوصی مالک")));
  check("Owner's project and bulk-edited private keyword save to actual Cloudflare D1");
  viewer = await newDevice(viewerName, memberPassword);
  await until(async () => (await local(viewer.page))?.projects.some(project => project.name === projectName));
  await nav(viewer.page, "تغییر گروهی");
  await viewer.page.getByRole("button", { name: "کلمه خصوصی مالک", exact: true }).waitFor();
  assert.equal(await viewer.page.getByRole("button", { name: "ردیف جدید", exact: true }).isDisabled(), true);
  assert.equal(await viewer.page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).isDisabled(), true);
  await viewer.page.getByRole("button", { name: "کلمه خصوصی مالک", exact: true }).dblclick();
  assert.equal(await viewer.page.locator(".bulk-cell-editor").count(), 0);
  assert.equal((await api(viewer.page, "state", "PUT", {})).status, 403);
  assert.equal((await api(viewer.page, "users")).status, 403);
  check("A fresh viewer device loads private cloud state; bulk editing and backend writes stay read-only");
  const backup = await Promise.all([viewer.page.waitForEvent("download"), viewer.page.getByRole("button", { name: "دانلود پشتیبان", exact: true }).click()]);
  assert.ok(backup[0].suggestedFilename().endsWith(".json"));
  check("Viewer can download a backup without changing shared data");
  editor = await newDevice(editorName, memberPassword);
  await until(async () => (await local(editor.page))?.projects.some(project => project.name === projectName));
  await nav(editor.page, "تنظیمات و راهنما");
  await editor.page.getByLabel("نام پروژه", { exact: true }).fill(projectName + " · ویرایش همکار");
  await until(async () => (await api(page, "state")).body.state?.projects.some(project => project.name === projectName + " · ویرایش همکار"));
  assert.equal((await api(editor.page, "users")).status, 403);
  check("Fresh editor login loads cloud data and ordinary UI edits synchronize automatically");
  assert.equal((await api(page, `users/${editorId}`, "PATCH", { role: "viewer" })).status, 200);
  assert.equal((await api(editor.page, "me")).status, 401);
  await editor.page.evaluate(() => window.dispatchEvent(new Event("online")));
  await editor.page.locator("#auth-username").waitFor();
  assert.equal(await editor.page.locator(".sidebar").count(), 0);
  check("Changed member roles revoke existing sessions and the UI closes the private workspace on revalidation");
  await page.getByRole("button", { name: "حساب و تیم", exact: true }).click();
  await page.getByRole("button", { name: "غیرفعال‌کردن حساب همکار مشاهده‌گر آزمایش", exact: true }).click();
  await until(async () => (await api(page, "users")).body.users.find(user => user.id === viewerId)?.disabled === true);
  await viewer.page.evaluate(() => window.dispatchEvent(new Event("online")));
  await viewer.page.locator("#auth-username").waitFor();
  await viewer.page.locator("#auth-username").fill(viewerName);
  await viewer.page.locator("#auth-password").fill(memberPassword);
  await viewer.page.getByRole("button", { name: "ورود به استودیو", exact: true }).click();
  await viewer.page.locator(".auth-error").waitFor();
  assert.equal(await viewer.page.locator(".sidebar").count(), 0);
  check("Disabling a team member through the UI closes the session and prevents another login");
  await page.getByRole("button", { name: /تغییر رمز ورود/ }).click();
  await page.locator("#team-current-password").fill(ownerPassword);
  await page.locator("#team-new-password").fill(changedOwnerPassword);
  await page.locator("#team-confirm-password").fill(changedOwnerPassword);
  await page.getByRole("button", { name: "ذخیره رمز جدید", exact: true }).click();
  await page.getByText("رمز ورود عوض شد. برای ورود بعدی از رمز جدید استفاده کنید.", { exact: true }).waitFor();
  assert.equal((await api(page, "me")).status, 200);
  await page.getByRole("button", { name: "خروج از حساب", exact: true }).click();
  await page.locator("#auth-username").waitFor();
  assert.equal(await page.locator(".sidebar").count(), 0);
  await page.locator("#auth-username").fill("alireza");
  await page.locator("#auth-password").fill(ownerPassword);
  await page.getByRole("button", { name: "ورود به استودیو", exact: true }).click();
  await page.locator(".auth-error").waitFor();
  assert.equal(await page.locator(".sidebar").count(), 0);
  await login(page, "alireza", changedOwnerPassword);
  check("Owner changes password in the UI, logs out safely, and the previous bootstrap password no longer works");
  await ownerContext.setOffline(true);
  await page.locator("#auth-username").waitFor();
  assert.equal(await page.locator(".sidebar").count(), 0);
  await ownerContext.setOffline(false);
  await page.locator(".sidebar").waitFor();
  check("Offline access is opt-in; disconnecting a shared device closes private data until connection returns");
  await page.getByRole("button", { name: "خروج از حساب", exact: true }).click();
  await login(page, editorName, memberPassword);
  await nav(page, "تغییر گروهی");
  assert.equal(await page.getByRole("button", { name: "ردیف جدید", exact: true }).isDisabled(), true);
  assert.equal((await api(page, "me")).body.user.role, "viewer");
  await page.getByRole("button", { name: "خروج از حساب", exact: true }).click();
  await login(page, "alireza", changedOwnerPassword);
  check("Different accounts can use one browser after logout without inheriting the previous user's editing permissions");
  await nav(page, "تنظیمات و راهنما");
  await page.getByRole("button", { name: "حساب و تیم", exact: true }).click();
  await page.getByLabel("این دستگاه شخصی است؛ دسترسی آفلاین فعال باشد", { exact: true }).check();
  await until(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).active)));
  await page.reload();
  await page.locator(".sidebar").waitFor();
  await until(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
  const cacheProof = await page.evaluate(async () => ({
    shell: Boolean(await caches.match("/index.html", { ignoreVary: true })),
    privateApiRequests: (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat().filter(path => path.startsWith("/api/")),
  }));
  assert.equal(cacheProof.shell, true);
  assert.deepEqual(cacheProof.privateApiRequests, []);
  check("The production Service Worker controls the page, caches its shell and excludes private API responses");
  await ownerContext.setOffline(true);
  await page.reload();
  await page.locator(".sidebar").waitFor();
  await nav(page, "تغییر گروهی");
  await page.getByRole("button", { name: "کلمه خصوصی مالک", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "ردیف جدید", exact: true }).isDisabled(), false);
  await ownerContext.setOffline(false);
  await page.locator(".sidebar").waitFor();
  check("Explicit personal-device access allows an authenticated offline reload of the saved private workspace");
  assert.deepEqual(errors, []);
  check("Real login, accounts, theme and cloud UI emit no browser runtime errors");
} catch (cause) {
  failure = cause instanceof Error ? cause.message : String(cause);
  throw cause;
} finally {
  await writeFile("artifacts/team-browser-checks.json", JSON.stringify({ timestamp: new Date().toISOString(), environment: "disposable local Wrangler + D1 + Chromium", passed: !failure, checks, errors, ...(failure ? { failure } : {}) }, null, 2));
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
}
