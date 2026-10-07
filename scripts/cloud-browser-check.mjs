import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const base = process.env.CLOUD_TEST_URL || "http://localhost:8787";
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Cloud integration tests replace data; only a local test Worker is allowed.');
const variables = await readFile(process.env.CLOUD_TEST_VARS || "/tmp/rooyesh-full/.dev.vars", "utf8");
const rawPassword = variables.match(/^APP_PASSWORD=(.+)$/m)?.[1]?.trim();
if (!rawPassword) throw new Error("A disposable local APP_PASSWORD is required.");
const password = rawPassword.startsWith('"') ? JSON.parse(rawPassword) : rawPassword.replace(/^'|'$/g, "");
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
async function nav(name) {
  await page.locator(".sidebar .nav-item").filter({ hasText: name }).click();
}
async function cloudState() {
  return page.evaluate(async () => {
    const r = await fetch("/api/state");
    if (!r.ok) throw new Error("State unavailable");
    return r.json();
  });
}
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await page.waitForTimeout(100);
  }
  throw new Error("Expected state not reached");
}
async function local() {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("rooyesh-seo-v1", 1);
        r.onsuccess = () => {
          const db = r.result;
          const q = db
            .transaction("workspace")
            .objectStore("workspace")
            .get("state");
          q.onsuccess = () => {
            resolve(q.result.state);
            db.close();
          };
        };
      }),
  );
}
try {
  await page.goto(base);
  await page.locator("#auth-username").waitFor();
  await page.locator("#auth-username").fill("alireza");
  await page.locator("#auth-password").fill(password);
  await page.locator(".auth-remember input").check();
  await page.getByRole("button", { name: "ورود به استودیو", exact: true }).click();
  await page.waitForSelector(".hero-card");
  await nav("تنظیمات و راهنما");
  await page.getByLabel("نام پروژه", { exact: true }).fill("نسخه دستگاه اول");
  await page
    .getByRole("button", { name: "پشتیبان و فضای ابری", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ارسال نسخه این دستگاه", exact: true })
    .waitFor();
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "ارسال نسخه این دستگاه", exact: true })
    .click();
  await until(async () => {
    const s = await cloudState();
    return (
      s.state?.projects.find((p) => p.id === s.state.activeProjectId).name ===
      "نسخه دستگاه اول"
    );
  });
  check("Real Worker login and explicit initial cloud transfer work");
  await page
    .getByRole("button", { name: "پروژه و تنظیمات", exact: true })
    .click();
  await page
    .getByLabel("نام پروژه", { exact: true })
    .fill("ویرایش خودکار ابری");
  await until(async () => {
    const s = await cloudState();
    return (
      s.state.projects.find((p) => p.id === s.state.activeProjectId).name ===
      "ویرایش خودکار ابری"
    );
  });
  check("Committed UI edits autosave through real D1 API");
  await page
    .getByRole("button", { name: "پشتیبان و فضای ابری", exact: true })
    .click();
  const state = await cloudState();
  const other = structuredClone(state.state);
  other.projects.find((p) => p.id === other.activeProjectId).goal =
    "تغییر همزمان دستگاه دوم";
  await page.evaluate(
    async ({ state, revision }) => {
      const r = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, revision }),
      });
      if (!r.ok) throw new Error("External update failed");
    },
    { state: other, revision: state.revision },
  );
  await page
    .getByRole("button", { name: "پروژه و تنظیمات", exact: true })
    .click();
  await page.getByLabel("هدف سئو", { exact: true }).fill("تغییر محلی محفوظ");
  await until(async () => (await page.locator(".warning-banner").count()) > 0);
  const conflict = await cloudState();
  assert.equal(
    conflict.state.projects.find((p) => p.id === conflict.state.activeProjectId)
      .goal,
    "تغییر همزمان دستگاه دوم",
  );
  assert.equal(
    ((s) => s.projects.find((p) => p.id === s.activeProjectId).goal)(
      await local(),
    ),
    "تغییر محلی محفوظ",
  );
  check("Concurrent cloud conflict pauses sync and retains local decisions");
  await page
    .getByRole("button", { name: "پشتیبان و فضای ابری", exact: true })
    .click();
  await page
    .getByRole("button", { name: "دریافت نسخه ابری", exact: true })
    .click();
  await until(
    async () => (await page.locator(".warning-banner").count()) === 0,
  );
  assert.equal(
    ((s) => s.projects.find((p) => p.id === s.activeProjectId).goal)(
      await local(),
    ),
    "تغییر همزمان دستگاه دوم",
  );
  await page.waitForTimeout(800);
  assert.equal(
    (await cloudState()).state.projects.find(
      (p) => p.id === other.activeProjectId,
    ).goal,
    "تغییر همزمان دستگاه دوم",
  );
  check(
    "Cloud pull creates recovery snapshot and old pending writes cannot overwrite it",
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector(".hero-card");
  await nav("تنظیمات و راهنما");
  await page
    .getByRole("button", { name: "پشتیبان و فضای ابری", exact: true })
    .click();
  await page
    .getByRole("button", { name: "دریافت نسخه ابری", exact: true })
    .click();
  await until(
    async () =>
      (await page
        .locator(".badge.green")
        .filter({ hasText: "همگام‌سازی خودکار فعال" })
        .count()) > 0,
  );
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "پروژه و تنظیمات", exact: true })
    .click();
  await page
    .getByLabel("هدف سئو", { exact: true })
    .fill("ویرایش آفلاین برای همگام‌سازی");
  await until(async () => {
    const s = await local();
    return (
      s.projects.find((p) => p.id === s.activeProjectId).goal ===
      "ویرایش آفلاین برای همگام‌سازی"
    );
  });
  await context.setOffline(false);
  await until(async () => {
    const s = await cloudState();
    return (
      s.state.projects.find((p) => p.id === s.state.activeProjectId).goal ===
      "ویرایش آفلاین برای همگام‌سازی"
    );
  });
  check("Offline local edits automatically sync after connectivity returns");
  const device = await browser.newContext();
  const second = await device.newPage();
  second.on("pageerror", (error) => errors.push(error.message));
  await second.goto(base);
  await second.locator("#auth-username").waitFor();
  await second.locator("#auth-username").fill("alireza");
  await second.locator("#auth-password").fill(password);
  await second.getByRole("button", { name: "ورود به استودیو", exact: true }).click();
  await second.waitForSelector(".hero-card");
  await second.locator(".sidebar .nav-item").filter({ hasText: "تنظیمات و راهنما" }).click();
  // A fresh authenticated device receives cloud state during workspace startup.
  assert.equal(
    await second.getByLabel("هدف سئو", { exact: true }).inputValue(),
    "ویرایش آفلاین برای همگام‌سازی",
  );
  await device.close();
  check("A separate device retrieves the saved cloud workspace");
  assert.deepEqual(errors, []);
  check("No browser runtime errors with Worker security policy");
  await writeFile(
    "artifacts/cloud-browser-checks.json",
    JSON.stringify(
      { passed: checks.length, completed: true, checks, productionDeployed: false },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(e);
  await page.screenshot({
    path: "artifacts/cloud-browser-failure.png",
    fullPage: true,
  });
  await writeFile("artifacts/cloud-browser-checks.json", JSON.stringify({ passed: checks.length, completed: false, checks, errors, failure: e instanceof Error ? e.message : String(e), productionDeployed: false }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
