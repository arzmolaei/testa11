import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

// Simulate two deployments using the frozen production build and disposable
// loopback server. No remote account, source files, or existing D1 data are used.
const dist = resolve("dist");
const sourceWorker = await readFile(resolve(dist, "sw.js"), "utf8");
let deployedVersion = 1;
const MIME = {
  html: "text/html; charset=utf-8", js: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json", webmanifest: "application/manifest+json",
  svg: "image/svg+xml", png: "image/png", woff: "font/woff", woff2: "font/woff2",
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname.startsWith("/api/")) {
    response.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end("Local production preview has no cloud API.");
    return;
  }
  if (pathname === "/sw.js") {
    const name = `rooyesh-update-test-v${deployedVersion}`;
    const body = sourceWorker.replace(/const CACHE='[^']+';/, `const CACHE='${name}';`)
      + `\nself.addEventListener('message', e => { if(e.data?.type==='TEST_VERSION') e.ports[0]?.postMessage(${deployedVersion}); });\n`;
    response.writeHead(200, { "Content-Type": MIME.js, "Cache-Control": "no-store", "Service-Worker-Allowed": "/" });
    response.end(body);
    return;
  }
  const file = resolve(dist, pathname === "/" ? "index.html" : `.${decodeURIComponent(pathname)}`);
  if (file !== dist && !file.startsWith(dist + sep)) { response.writeHead(403); response.end(); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": MIME[file.split(".").pop()] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const checks = [], errors = [];
page.on("pageerror", error => errors.push(error.message));
const check = name => { checks.push(name); console.log("PASS", name); };
async function nav(name) { await page.locator(".sidebar .nav-item").filter({ hasText: name }).click(); }
async function until(predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Expected browser state did not settle.");
}
async function controllerVersion() {
  return page.evaluate(() => new Promise(resolve => {
    if (!navigator.serviceWorker.controller) { resolve(null); return; }
    const channel = new MessageChannel();
    channel.port1.onmessage = event => resolve(event.data);
    navigator.serviceWorker.controller.postMessage({ type: "TEST_VERSION" }, [channel.port2]);
    setTimeout(() => resolve(null), 3000);
  }));
}
async function localState() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("rooyesh-seo-v1", 1);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction("workspace").objectStore("workspace").get("state");
      read.onsuccess = () => { resolve(read.result?.state ?? null); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
    open.onerror = () => reject(open.error);
  }));
}
const committedKeyword = "کلمه محفوظ پیش از به‌روزرسانی";
const stagedKeyword = "پیش‌نویس محفوظ هنگام به‌روزرسانی";
let failure;
try {
  await mkdir("artifacts", { recursive: true });
  await page.goto(base);
  await page.locator(".sidebar").waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });
  assert.equal(await controllerVersion(), 1);
  assert.equal(await page.evaluate(() => localStorage.getItem("seo-studio:verified-local-development:v1")), "1");
  check("Production PWA installs and controls its first version; local preview is explicitly verified");

  await nav("تغییر گروهی");
  await page.getByRole("button", { name: "ردیف جدید", exact: true }).click();
  await page.locator(".bulk-cell-editor textarea").fill(committedKeyword);
  await page.locator(".bulk-cell-editor textarea").press("Enter");
  await page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).click();
  await page.getByRole("button", { name: "ثبت نهایی", exact: true }).click();
  await until(async () => (await localState())?.projects.some(project => project.keywords.some(keyword => keyword.keyword === committedKeyword)));
  const before = await localState();
  const committed = before.projects.flatMap(project => project.keywords).find(keyword => keyword.keyword === committedKeyword);
  assert.ok(committed?.id);
  check("Committed keyword with its stable ID is saved before updating");

  deployedVersion = 2;
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  const update = page.getByRole("button", { name: "نصب نسخهٔ جدید برنامه", exact: true });
  await update.waitFor();
  assert.equal(await controllerVersion(), 1);
  assert.equal(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)), true);
  check("Second deployment stays waiting and exposes the update button without replacing the active version");

  await page.getByRole("button", { name: "ردیف جدید", exact: true }).click();
  await page.locator(".bulk-cell-editor textarea").fill(stagedKeyword);
  await page.locator(".bulk-cell-editor textarea").press("Enter");
  await until(async () => await page.locator(".bulk-draft-saved").count() > 0);
  page.once("dialog", dialog => dialog.dismiss());
  await update.click();
  assert.equal(await controllerVersion(), 1);
  assert.equal(await page.locator('.bulk-workspace[data-unsaved="true"]').count(), 1);
  assert.equal(await page.getByRole("button", { name: stagedKeyword, exact: true }).count(), 1);
  check("Canceling the update confirmation preserves the active controller and the staged draft");

  page.once("dialog", dialog => dialog.accept());
  const navigation = page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame() });
  await update.click();
  await navigation;
  await page.locator(".sidebar").waitFor();
  await until(async () => await controllerVersion() === 2);
  const after = await localState();
  assert.deepEqual(after.projects.flatMap(project => project.keywords).find(keyword => keyword.id === committed.id), committed);
  assert.deepEqual((await page.evaluate(() => caches.keys())).filter(name => name.startsWith("rooyesh-update-test-")).sort(), ["rooyesh-update-test-v1", "rooyesh-update-test-v2"]);
  check("Accepting the update activates the waiting version, reloads, preserves committed IndexedDB data and keeps both asset caches");

  await nav("تغییر گروهی");
  await page.locator(".bulk-recovery").waitFor();
  await page.getByRole("button", { name: "بازیابی پیش‌نویس", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: stagedKeyword, exact: true }).count(), 1);
  check("An uncommitted draft survives the update and can be recovered for review");

  await context.setOffline(true);
  await page.reload();
  await page.locator(".sidebar").waitFor();
  const offline = await localState();
  assert.deepEqual(offline.projects.flatMap(project => project.keywords).find(keyword => keyword.id === committed.id), committed);
  assert.equal(await controllerVersion(), 2);
  check("Updated PWA reopens offline and retains the committed keyword with its original ID");
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error.stack || error.message;
  throw error;
} finally {
  await writeFile("artifacts/update-browser-checks.json", JSON.stringify({ timestamp: new Date().toISOString(), environment: "disposable loopback HTTP + frozen production assets + Chromium", passed: !failure, checks, errors, ...(failure ? { failure } : {}) }, null, 2));
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
