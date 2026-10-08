import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

// Exercise the generated production SW in Chromium without rebuilding dist or
// using private project data. Fixed-path assets deliberately change between releases.
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'seo-pwa-audit-'));
const run = promisify(execFile);
let deployedVersion = 1, unavailable = false, apiCalls = 0;
const releases = new Map();
const checks = [], errors = [];
let failure, browser, server;
const check = name => { checks.push(name); console.log('PASS', name); };
async function waitFor(predicate) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error('Expected service-worker state did not settle.');
}
try {
  for (const version of [1, 2]) {
    const root = path.join(temporary, String(version));
    const dist = path.join(root, 'dist');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    const assets = new Map([
      ['/index.html', `<!doctype html><meta charset="utf-8"><title>SEO PWA fixture</title><h1>Shell ${version}</h1>`],
      ['/manifest.webmanifest', JSON.stringify({ name: `SEO release ${version}` })],
      ['/app-icon.svg', `<svg xmlns="http://www.w3.org/2000/svg"><title>Icon ${version}</title></svg>`],
      [`/assets/chunk-v${version}.js`, `export const version = ${version};`],
    ]);
    for (const [name, body] of assets) await writeFile(path.join(dist, name), body);
    await run(process.execPath, [path.join(sourceRoot, 'scripts/build-sw.mjs')], { cwd: root });
    releases.set(version, { assets, worker: await readFile(path.join(dist, 'sw.js'), 'utf8') });
  }
  server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/api/state') {
      apiCalls++;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ call: apiCalls })); return;
    }
    if (pathname === '/index.html') {
      // Match Cloudflare's canonical index redirect: the cached response has a
      // redirected URL and must be reconstructed before serving a navigation.
      response.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
      response.end(); return;
    }
    if (pathname === '/missing') { response.writeHead(404); response.end('Missing'); return; }
    const release = releases.get(deployedVersion);
    if (pathname === '/sw.js') {
      response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
      response.end(release.worker); return;
    }
    if (unavailable && (pathname === '/' || pathname === '/recover')) {
      response.writeHead(503); response.end('Temporarily unavailable'); return;
    }
    const body = release.assets.get(pathname === '/' || pathname === '/recover' ? '/index.html' : pathname);
    if (body === undefined) { response.writeHead(404); response.end(); return; }
    const type = pathname.endsWith('.js') ? 'application/javascript' : pathname.endsWith('.svg') ? 'image/svg+xml' : pathname.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html; charset=utf-8';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'self'" });
    response.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  const textAt = pathname => page.evaluate(async name => (await fetch(name)).text(), pathname);
  assert.equal(JSON.parse(await textAt('/manifest.webmanifest')).name, 'SEO release 1');
  check('Initial production SW installs all local assets and controls the page');

  deployedVersion = 2;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await waitFor(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)));
  assert.equal(JSON.parse(await textAt('/manifest.webmanifest')).name, 'SEO release 1');
  check('A waiting update preserves the fixed-path assets of the active version');
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await new Promise(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  });
  assert.equal(JSON.parse(await textAt('/manifest.webmanifest')).name, 'SEO release 2');
  assert.match(await textAt('/app-icon.svg'), /Icon 2/);
  assert.equal((await page.evaluate(() => caches.keys())).filter(name => name.startsWith('rooyesh-')).length, 2);
  check('Activating an update serves its own manifest and icon while retaining the previous cache');
  assert.equal(await textAt('/assets/chunk-v1.js'), 'export const version = 1;');
  check('An older open tab can still load its previous lazy chunk after an update');

  assert.equal(JSON.parse(await textAt('/api/state')).call, 1);
  assert.equal(JSON.parse(await textAt('/api/state')).call, 2);
  assert.equal(await page.evaluate(async () => Boolean(await caches.match('/api/state'))), false);
  check('Private API responses always reach the server and never enter asset caches');

  unavailable = true;
  const recovered = await page.goto(`${origin}/recover`);
  assert.equal(recovered.status(), 200);
  assert.equal(await page.locator('h1').textContent(), 'Shell 2');
  assert.match(recovered.headers()['content-security-policy'], /object-src 'none'/);
  check('A temporary HTTP 503 opens the cached shell and retains its CSP');

  await context.setOffline(true);
  const offline = await page.reload();
  assert.equal(offline.status(), 200);
  assert.equal(await page.locator('h1').textContent(), 'Shell 2');
  assert.match(await textAt('/app-icon.svg'), /Icon 2/);
  check('Redirected index assets reopen offline with the current shell and icon');
  await context.setOffline(false);
  unavailable = false;
  const missing = await page.goto(`${origin}/missing`);
  assert.equal(missing.status(), 404);
  check('An actual missing route keeps its HTTP 404 instead of masking it with a shell');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error.stack || error.message;
  throw error;
} finally {
  await mkdir(path.join(sourceRoot, 'artifacts'), { recursive: true });
  await writeFile(path.join(sourceRoot, 'artifacts/service-worker-checks.json'), JSON.stringify({ timestamp: new Date().toISOString(), environment: 'generated SW + disposable fixtures + Chromium', passed: !failure, checks, errors, ...(failure ? { failure } : {}) }, null, 2));
  if (browser) await browser.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
