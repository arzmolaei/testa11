// Synthetic API only: this check never reads or writes a deployed database.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { applyChangeSet } from '../src/record-sync';
import type { Store } from '../src/types';
const base = process.env.PREVIEW_URL || 'http://localhost:4192';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local preview required');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
let state: Store | null = null, revision = 0, writes = 0;
async function open() {
  const context = await browser.newContext();
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let value: unknown = {};
    if (path === '/api/status') value = { configured: true, authenticated: true, user: { id: 'owner-test', username: 'alireza', displayName: 'Test', role: 'owner' } };
    else if (path === '/api/state') {
      if (request.method() === 'PUT') { state = request.postDataJSON().state; revision++; writes++; }
      value = { state, revision };
    } else if (path === '/api/changes') {
      const result = await applyChangeSet(state!, request.postDataJSON().changes);
      if (result.conflicts.length) { await route.fulfill({ status: 409, json: { error: 'RECORD_CONFLICT' } }); return; }
      state = result.state; revision++; writes++; value = { state, revision };
    }
    await route.fulfill({ json: value });
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.getByText('همگام با ابر', { exact: true }).waitFor();
  return { context, page };
}
async function localName(page: Awaited<ReturnType<typeof open>>['page']) {
  return page.evaluate(() => new Promise<string>(resolve => {
    const request = indexedDB.open('rooyesh-seo-v1', 1);
    request.onsuccess = () => {
      const db = request.result, query = db.transaction('workspace').objectStore('workspace').get('state');
      query.onsuccess = () => { resolve(query.result.state.projects[0].name); db.close(); };
    };
  }));
}
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 80; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Expected synchronization did not complete');
}
try {
  const a = await open();
  assert.ok(state); assert.equal(writes, 1);
  console.log('PASS fresh installation automatically saves to cloud');
  state!.projects[0].name = 'پروژه مشترک آزمایشی'; revision++;
  const b = await open();
  assert.equal(await localName(b.page), 'پروژه مشترک آزمایشی'); assert.equal(writes, 1);
  console.log('PASS independent browser receives cloud data without overwriting it');
  await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await until(async () => await localName(a.page) === 'پروژه مشترک آزمایشی');
  assert.equal(writes, 1);
  console.log('PASS already-open browser receives remote edits on focus without writing');
  await a.page.locator('.sidebar .nav-item').filter({ hasText: 'تنظیمات و راهنما' }).click();
  await a.page.getByLabel('نام پروژه', { exact: true }).fill('تغییر ذخیره شده');
  await until(async () => state!.projects[0].name === 'تغییر ذخیره شده');
  await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await until(async () => await localName(b.page) === 'تغییر ذخیره شده');
  await b.page.reload();
  await b.page.getByText('همگام با ابر', { exact: true }).waitFor();
  assert.equal(await localName(b.page), 'تغییر ذخیره شده');
  console.log('PASS edits sync across browsers and survive reload');
  await a.context.close(); await b.context.close();
} finally { await browser.close(); }
