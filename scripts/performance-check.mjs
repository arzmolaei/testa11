import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
async function stored() {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const o = indexedDB.open("rooyesh-seo-v1", 1);
        o.onsuccess = () => {
          const db = o.result;
          const r = db
            .transaction("workspace")
            .objectStore("workspace")
            .get("state");
          r.onsuccess = () => {
            resolve(r.result?.state);
            db.close();
          };
        };
      }),
  );
}
try {
  await page.goto(process.env.TEST_URL || "http://localhost:4173");
  await page.waitForSelector(".hero-card");
  await page.waitForTimeout(550);
  const original = await stored();
  for (const count of [100, 1000, 10000, 20000]) {
    const state = structuredClone(original),
      p = state.projects[0];
    p.name = "آزمایش ظرفیت " + count;
    p.keywords = Array.from({ length: count }, (_, i) => ({
      id: "fixed-" + i,
      keyword: "کلمه آزمایشی " + i,
      volume: i,
      kd: "آسان",
      intent: "اطلاعاتی",
      decision: "Keep",
      group: "گروه " + (i % 5),
      notes: "یادداشت ثابت " + i,
    }));
    p.pages = [
      {
        id: "stable-page",
        pageId: "P-001",
        target: "صفحه آزمایش",
        pkw: "کلمه آزمایشی 42",
        pageType: "مقاله",
        existing: "New",
        url: "https://example.com/test",
        action: "Create New",
        status: "Mapping",
      },
    ];
    p.content = [
      {
        id: "stable-content",
        contentId: "C-001",
        topic: "موضوع ثابت",
        targetPage: "stable-page",
      },
    ];
    p.results = [];
    if (count === 20000) {
      const firstPage = p.pages[0],
        firstContent = p.content[0];
      p.pages = Array.from({ length: 2000 }, (_, i) => ({
        ...firstPage,
        id: i === 0 ? "stable-page" : "page-" + i,
        pageId: "P-" + (i + 1),
        target: "صفحه " + i,
        pkw: "کلمه آزمایشی " + i,
        url: "https://example.com/test/" + i,
        serpCheck: "Checked",
        status: i < 1000 ? "Published" : "Mapping",
      }));
      p.content = Array.from({ length: 2000 }, (_, i) => ({
        ...firstContent,
        id: "content-" + i,
        contentId: "C-" + (i + 1),
        topic: "موضوع " + i,
        targetPage: p.pages[i].id,
      }));
      p.results = Array.from({ length: 2000 }, (_, i) => ({
        id: "result-" + i,
        pageId: p.pages[i].id,
        url: p.pages[i].url,
        clicks: 10,
        impressions: 100,
        position: 8,
        result: "Stable",
        baselineDate: "2026-09-07",
        lastChecked: "2026-10-07",
      }));
    }

    await page
      .locator(".sidebar .nav-item")
      .filter({ hasText: "تنظیمات و راهنما" })
      .click();
    await page
      .getByRole("button", { name: "پشتیبان و فضای ابری", exact: true })
      .click();
    const start = performance.now();
    const dialog = page.waitForEvent("dialog");
    await page.locator("input[type=file]").setInputFiles({
      name: "capacity.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(state)),
    });
    await (await dialog).accept();
    await page.waitForTimeout(600);
    await page
      .locator(".sidebar .nav-item")
      .filter({ hasText: "کلمات کلیدی" })
      .click();
    await page.getByLabel("جستجوی کلمات کلیدی").fill("کلمه آزمایشی 42");
    await page.waitForTimeout(150);
    await page
      .locator(".kw-keyword-button")
      .filter({ hasText: "کلمه آزمایشی 42" })
      .first()
      .click();
    assert.equal(
      await page.locator("#kw-notes").inputValue(),
      "یادداشت ثابت 42",
    );
    await page.getByRole("button", { name: "بستن ویرایش" }).click();
    await page.getByLabel("جستجوی کلمات کلیدی").fill("");
    await page.locator("thead .kw-sort").filter({ hasText: "حجم جست" }).click();
    assert.equal(await page.locator(".kw-table tbody tr").count(), 50);
    const after = await stored();
    const current = after.projects.find((p) => p.id === after.activeProjectId);
    assert.equal(current.keywords.length, count);
    assert.equal(
      current.keywords.find((k) => k.id === "fixed-42").notes,
      "یادداشت ثابت 42",
    );
    assert.equal(current.content[0].targetPage, "stable-page");
    const dashboardStart = performance.now();
    await page
      .locator(".sidebar .nav-item")
      .filter({ hasText: "نمای کلی" })
      .click();
    await page.waitForSelector(".hero-card");
    const dashboardMs = Math.round(performance.now() - dashboardStart);
    const result = {
      dashboardMs,
      pageRows: current.pages.length,
      contentRows: current.content.length,
      resultRows: current.results.length,
      rows: count,
      restoreAndSearchMs: Math.round(performance.now() - start),
      renderedRows: 50,
      manualIdentityPreserved: true,
      crosslinksPreserved: true,
    };
    results.push(result);
    console.log("PASS", JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/performance-checks.json",
    JSON.stringify({ results, browserErrors: errors }, null, 2),
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
  await page.screenshot({
    path: "artifacts/performance-failure.png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
