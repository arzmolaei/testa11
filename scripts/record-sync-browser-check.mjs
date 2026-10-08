import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

const port = Number(process.env.RECORD_BASE_QA_PORT || 5192);
const harness = '<!doctype html><html><body><script type="module">import * as sync from "/src/record-sync.ts";window.sync=sync;window.ready=true;</script></body></html>';
const server = await createServer({ server: { host: "127.0.0.1", port, strictPort: true }, plugins: [{ name: "record-base-harness", configureServer(instance) { instance.middlewares.use(async (request, response, next) => {
  if (!request.url?.startsWith("/__record_base__")) return next();
  response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(await instance.transformIndexHtml(request.url, harness));
}); } }] });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext();
const page = await context.newPage();
const checks = [], errors = [], external = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => { if (!request.url().startsWith(`http://127.0.0.1:${port}`)) external.push(request.url()); });
function check(name) { checks.push(name); console.log("PASS", name); }
const state = { version: 1, activeProjectId: "p1", settings: { titleMin: 30, titleMax: 60, metaMin: 100, metaMax: 160 }, projects: [{ id: "p1", name: "آزمون حافظه", domain: "", market: "", language: "", projectType: "Ecommerce", goal: "", startDate: "", lastReview: "", keywords: [{ id: "k1", keyword: "دوربین", group: "", intent: "" }], pages: [], content: [], results: [] }] };
try {
  await page.goto(`http://127.0.0.1:${port}/__record_base__`);
  await page.waitForFunction(() => window.ready);
  assert.equal(await page.evaluate(() => window.sync.loadCloudBase("owner")), null);
  check("fresh browser has no inherited sync base");
  await page.evaluate(async (state) => { await window.sync.saveCloudBase(state, 10, "owner"); const another = structuredClone(state); another.projects[0].name = "همکار"; await window.sync.saveCloudBase(another, 4, "member"); }, state);
  assert.deepEqual(await page.evaluate(() => window.sync.loadCloudBase("owner")), { state, revision: 10, scope: "owner" });
  assert.equal((await page.evaluate(() => window.sync.loadCloudBase("member"))).state.projects[0].name, "همکار");
  check("IndexedDB bases are separated by account ID");
  await page.evaluate(async (state) => { const stale = structuredClone(state); stale.projects[0].name = "قدیمی"; await window.sync.saveCloudBase(stale, 9, "owner"); }, state);
  assert.equal((await page.evaluate(() => window.sync.loadCloudBase("owner"))).state.projects[0].name, state.projects[0].name);
  check("delayed lower-revision response cannot roll the base backward");
  await page.reload(); await page.waitForFunction(() => window.ready);
  assert.equal((await page.evaluate(() => window.sync.loadCloudBase("owner"))).revision, 10);
  check("merge base survives a cold browser reload");
  await context.setOffline(true);
  await page.evaluate(async (state) => { await window.sync.saveCloudBase(state, 11, "owner"); }, state);
  assert.equal((await page.evaluate(() => window.sync.loadCloudBase("owner"))).revision, 11);
  check("offline read/write uses device IndexedDB without external requests");
  const merge = await page.evaluate(async (state) => {
    const sent = structuredClone(state); sent.projects[0].keywords[0].intent = "Commercial";
    const server = structuredClone(sent); server.projects[0].keywords[0].group = "دوربین";
    const latest = structuredClone(sent); latest.projects[0].keywords[0].note = "حین ارسال";
    return window.sync.applyChangeSet(server, await window.sync.buildChangeSet(sent, latest));
  }, state);
  assert.equal(merge.conflicts.length, 0);
  assert.deepEqual(merge.state.projects[0].keywords[0], { ...state.projects[0].keywords[0], intent: "Commercial", group: "دوربین", note: "حین ارسال" });
  check("in-flight local edits merge with returned server fields");
  await page.evaluate(() => window.sync.clearCloudBase("owner"));
  assert.equal(await page.evaluate(() => window.sync.loadCloudBase("owner")), null);
  assert.equal((await page.evaluate(() => window.sync.loadCloudBase("member"))).revision, 4);
  check("unlinking one account preserves the other account base");
  await page.evaluate(() => window.sync.clearCloudBase());
  assert.equal(await page.evaluate(() => window.sync.loadCloudBase("member")), null);
  check("explicit base reset removes all stored merge bases");
  const performance = await page.evaluate(async (state) => {
    const base = structuredClone(state); base.projects[0].keywords = Array.from({ length: 2000 }, (_, index) => ({ id: `k${index}`, keyword: `دوربین ${index}`, intent: "" }));
    const next = structuredClone(base); next.projects[0].keywords.forEach((row) => row.intent = "Commercial");
    const start = performance.now(), patch = await window.sync.buildChangeSet(base, next);
    return { elapsed: performance.now() - start, bytes: new TextEncoder().encode(JSON.stringify(patch)).length, changes: patch.changes.length };
  }, state);
  assert.equal(performance.changes, 2000); assert.ok(performance.bytes < 1024 * 1024); assert.ok(performance.elapsed < 2000);
  check("2,000 edited rows produce a bounded incremental request");
  const fullBulk = await page.evaluate(async (state) => {
    const base = structuredClone(state); base.projects[0].keywords = Array.from({ length: 20000 }, (_, index) => ({ id: `full${index}`, keyword: `کلمه ${index}`, intent: "" }));
    const next = structuredClone(base); next.projects[0].keywords.forEach((row) => row.intent = "Commercial");
    const patch = await window.sync.buildChangeSet(base, next), start = performance.now();
    const result = await window.sync.applyChangeSet(base, patch);
    return { milliseconds: performance.now() - start, applied: result.applied.length, conflicts: result.conflicts.length, first: result.state.projects[0].keywords[0], last: result.state.projects[0].keywords.at(-1), unchangedInput: base.projects[0].keywords[0].intent === "" };
  }, state);
  assert.equal(fullBulk.applied, 20000); assert.equal(fullBulk.conflicts, 0); assert.equal(fullBulk.unchangedInput, true);
  assert.equal(fullBulk.first.intent, "Commercial"); assert.equal(fullBulk.last.id, "full19999"); assert.ok(fullBulk.milliseconds < 2000);
  check("20,000-row merge preserves input and ordering without repeated whole-table searches");
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/record-sync-browser-checks.json", JSON.stringify({ passed: checks.length, checks, errors, external, performance, fullBulk }, null, 2));
} finally { await context.close(); await browser.close(); await server.close(); }
