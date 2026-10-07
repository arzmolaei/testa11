import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { buildWorkbook } from "../src/export";
import { demoStore } from "../src/domain";

const store = demoStore();
const stressRows = Number(process.env.SEO_EXPORT_ROWS || 0);
if (stressRows) {
  if (!Number.isInteger(stressRows) || stressRows < 1 || stressRows > 20000)
    throw new Error("Stress rows must be 1–20000.");
  store.projects[0].keywords = Array.from(
    { length: stressRows },
    (_, index) => ({
      id: `stable-keyword-${index}`,
      keyword: `کلمه تست ${index}`,
      volume: index,
      kd: "متوسط",
      intent: "تراکنشی",
      decision: "Keep",
      group: `گروه ${index % 30}`,
      notes: `یادداشت دستی ${index}`,
    }),
  ).reverse();
}
const directory = resolve("artifacts");
await mkdir(directory, { recursive: true });
const destination = stressRows
  ? resolve("/tmp", `SEO-Studio-stress-${stressRows}.xlsx`)
  : resolve(directory, "SEO-Studio.xlsx");
const started = performance.now();
const workbook = await buildWorkbook(store.projects[0], store.settings);
await workbook.xlsx.writeFile(destination);
const file = await stat(destination);
if (!file.isFile() || file.size < 10000)
  throw new Error("Workbook artifact verification failed.");
console.log(
  JSON.stringify(
    {
      artifact: destination,
      bytes: file.size,
      rows: store.projects[0].keywords.length,
      durationMs: Math.round(performance.now() - started),
      sheets: workbook.worksheets.map((sheet) => sheet.name),
    },
    null,
    2,
  ),
);
