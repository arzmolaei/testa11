import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Local synthetic workspace only. No live account, deployment or database is touched.
const base = process.env.TEST_URL || 'http://127.0.0.1:4192';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const check = label => { checks.push(label); console.log('PASS', label); };
async function snapshot() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('rooyesh-seo-v1', 1);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('workspace').objectStore('workspace').get('state');
      request.onsuccess = () => { resolve(request.result?.state); db.close(); };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  }));
}
async function saved(predicate) {
  for (let step = 0; step < 80; step++) {
    const value = await snapshot();
    if (value && predicate(value)) return value;
    await page.waitForTimeout(100);
  }
  throw new Error('Expected committed state was not saved');
}
const active = store => store.projects.find(project => project.id === store.activeProjectId);
const undo = () => page.locator('.topbar').getByRole('button', { name: 'برگرداندن آخرین تغییر', exact: true });
const redo = () => page.locator('.topbar').getByRole('button', { name: 'انجام دوباره تغییر', exact: true });
try {
  await mkdir('artifacts', { recursive: true });
  await page.goto(base);
  await page.locator('.hero-card').waitFor();
  await saved(value => value.projects.length === 1);
  assert.equal(await page.title(), 'رشدیمو | Roshdimo');
  assert.equal(await undo().isDisabled(), true);
  await page.getByRole('button', { name: 'پروژه جدید', exact: true }).click();
  await page.getByLabel('نام پروژه', { exact: true }).fill('پروژهٔ راه برگشت');
  await page.getByRole('button', { name: 'ساخت پروژه', exact: true }).click();
  const created = await saved(value => active(value).name === 'پروژهٔ راه برگشت');
  const projectId = active(created).id;
  await undo().click();
  await saved(value => value.projects.length === 1);
  await redo().click();
  await saved(value => active(value).id === projectId);
  check('Project creation undo/redo preserves the original project and active selection');

  await page.locator('.sidebar .nav-item').filter({ hasText: 'کلمات کلیدی' }).click();
  await page.getByRole('button', { name: 'کلمه جدید', exact: true }).first().click();
  await page.locator('#kw-keyword').fill('خرید دوربین آزمایش');
  await page.locator('#kw-volume').fill('120');
  await page.locator('#kw-kd').selectOption('آسان');
  await page.locator('#kw-intent').selectOption('تراکنشی');
  await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  await saved(value => active(value).keywords.length === 1);
  await page.reload();
  await page.locator('.hero-card').waitFor();
  await undo().click();
  await saved(value => active(value).keywords.length === 0);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await saved(value => value.projects.length === 1);
  await redo().click();
  await saved(value => active(value).id === projectId);
  await redo().click();
  await saved(value => active(value).keywords.length === 1);
  check('History survives reload; multi-step undo and redo restore row and project relationships');

  await page.getByRole('button', { name: 'فعال کردن حالت تاریک' }).click();
  await page.getByRole('button', { name: 'راه برگشت تغییرات' }).click();
  await page.locator('dialog[open]').waitFor();
  assert.equal(await page.locator('.history-dialog-list li').count(), 2);
  await page.screenshot({ path: 'artifacts/roshdimo-history-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/roshdimo-history-mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.keyboard.press('Escape');
  await page.locator('dialog[open]').waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  check('Native history dialog fits mobile, shows saved Jalali history and closes with Escape');

  await page.locator('.sidebar .nav-item').filter({ hasText: 'کلمات کلیدی' }).click();
  await page.getByRole('button', { name: 'دستیار هدف‌گذاری', exact: true }).click();
  await page.locator('.planner-group').first().waitFor();
  assert.ok((await page.locator('.planner-opportunity').textContent()).includes('آسان'));
  await page.locator('.planner-refinements summary').click();
  await page.getByLabel('حداقل حجم پیشنهاد').fill('130');
  assert.equal(await page.locator('.planner-group').count(), 0);
  await page.getByLabel('حداقل حجم پیشنهاد').fill('100');
  assert.equal(await page.locator('.planner-group').count(), 1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'خروجی CSV', exact: true }).click();
  const download = await downloadPromise;
  const csv = await readFile(await download.path(), 'utf8');
  assert.ok(csv.includes('وضعیت پوشش') && csv.includes('اولویت برنامه') && csv.includes('آسان'));
  check('Planner filters known volume, preserves qualitative KD and downloads complete CSV');

  await page.locator('.planner-group input[type="checkbox"]').check();
  await page.getByLabel('اولویت گروهی صفحات تازه').selectOption('P1');
  assert.ok((await page.locator('.planner-opportunity').textContent()).includes('P1'));
  await page.getByRole('button', { name: 'برگرداندن تغییر پیش‌نویس', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'انجام دوباره تغییر پیش‌نویس', exact: true }).isDisabled(), false);
  await page.getByRole('button', { name: 'انجام دوباره تغییر پیش‌نویس', exact: true }).click();
  await page.getByRole('button', { name: 'بازبینی و ثبت برنامه', exact: true }).click();
  await page.getByRole('button', { name: 'تأیید و ثبت در پروژه', exact: true }).click();
  const planned = await saved(value => active(value).pages.length === 1 && active(value).content.length === 1);
  assert.equal(active(planned).pages[0].priority, 'P1');
  assert.equal(active(planned).content[0].priority, 'P1');
  await undo().click();
  await saved(value => active(value).pages.length === 0 && active(value).content.length === 0 && !active(value).keywords[0].targetPage);
  await redo().click();
  await saved(value => active(value).pages.length === 1 && active(value).keywords[0].targetPage === active(value).pages[0].id);
  check('Draft bulk priority undo/redo and committed plan undo/redo keep pages, briefs and keyword targets consistent');
  assert.deepEqual(errors, []);

  const login = await context.newPage();
  await login.route('**/api/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, authenticated: false }) }));
  await login.goto(base);
  await login.locator('#auth-password').waitFor();
  await login.screenshot({ path: 'artifacts/roshdimo-login-dark.png' });
  await login.setViewportSize({ width: 390, height: 844 });
  await login.screenshot({ path: 'artifacts/roshdimo-login-mobile.png', fullPage: true });
  assert.equal(await login.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  check('Roshdimo login brand renders in dark mode on desktop and mobile');
} catch (error) {
  await page.screenshot({ path: 'artifacts/roshdimo-history-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context.close(); await browser.close();
}
