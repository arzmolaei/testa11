import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

// Exercise the real gate in two browser tabs. API responses are held or made
// malformed deliberately; no production account or Cloudflare secret is used.
const port = Number(process.env.AUTH_AUDIT_QA_PORT || 5206);
const harness = `<!doctype html><html><body><div id="root"></div><script type="module">
import React from "react"; import {createRoot} from "react-dom/client";
import {AuthGate} from "/src/components/AuthGate.tsx";
createRoot(document.getElementById("root")).render(React.createElement(AuthGate, null, (session, actions) => {
 window.authQa = {session, actions};
 return React.createElement("div", {id:"workspace"}, React.createElement("input", {
   id:"offline-enabled", type:"checkbox", checked:actions.offlineEnabled,
   onChange:event => actions.setOfflineEnabled(event.target.checked)
 }), React.createElement("button", {id:"refresh", onClick:()=>actions.refresh()}, "refresh"));
}));</script></body></html>`;
const server = await createServer({ server: { host: "127.0.0.1", port, strictPort: true }, plugins: [{ name: "auth-audit-harness", configureServer(instance) {
  instance.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith("/__auth_audit__")) return next();
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(await instance.transformIndexHtml(request.url, harness));
  });
} }] });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext();
const checks = [], errors = [];
const user = { id: "audit-owner", username: "alireza", displayName: "علیرضا", role: "owner" };
const status = { configured: true, authenticated: true, user, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
let malformed = false, invalidCredentials = false;
await context.route("**/api/status", route => route.fulfill({ status: 200, contentType: "application/json", body: malformed ? "{broken" : JSON.stringify(invalidCredentials ? { configured: true, authenticated: false } : status) }));
function check(name) { checks.push(name); console.log("PASS", name); }
async function openTab() {
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/__auth_audit__`); await page.locator("#workspace").waitFor(); return page;
}
let failure;
try {
  const first = await openTab();
  await first.locator("#offline-enabled").check();
  const second = await openTab();
  assert.equal(await second.locator("#offline-enabled").isChecked(), true);
  await first.locator("#offline-enabled").uncheck();
  await second.waitForFunction(() => !window.authQa.actions.offlineEnabled, undefined, { timeout: 2500 });
  await second.locator("#refresh").click();
  await second.waitForFunction(() => window.authQa.session.mode === "online");
  assert.equal(await second.evaluate(() => localStorage.getItem("seo-studio:personal-device:v1")), null);
  check("disabling offline access in one tab cannot be reversed by another tab's refresh");

  await second.locator("#offline-enabled").check();
  await first.reload(); await first.locator("#workspace").waitFor();
  await second.evaluate(() => localStorage.clear());
  await first.waitForFunction(() => !window.authQa.actions.offlineEnabled, undefined, { timeout: 2500 });
  await first.locator("#refresh").click();
  assert.equal(await first.evaluate(() => localStorage.getItem("seo-studio:personal-device:v1")), null);
  check("clearing device preferences also clears other tabs' in-memory offline grants");

  await first.locator("#offline-enabled").check(); malformed = true;
  await first.locator("#refresh").click();
  await first.locator("#workspace").waitFor({ state: "detached" });
  await first.getByText("ارتباط در دسترس نیست", { exact: true }).waitFor();
  check("malformed server JSON never gets mistaken for an offline network failure");

  malformed = false; invalidCredentials = true;
  await first.getByRole("button", { name: "تلاش دوباره", exact: true }).click();
  await first.locator("#auth-username").waitFor();
  assert.equal(await first.evaluate(() => localStorage.getItem("seo-studio:personal-device:v1")), null);
  invalidCredentials = false;
  await first.evaluate(() => window.dispatchEvent(new Event("online")));
  await first.locator("#workspace").waitFor();
  assert.equal(await first.locator("#offline-enabled").isChecked(), false);
  check("a revoked or expired identity cannot silently inherit a remembered offline grant after reauthentication");
  assert.deepEqual(errors, []);
} catch (cause) { failure = cause instanceof Error ? cause.message : String(cause); throw cause; }
finally {
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/auth-lifecycle-audit-checks.json", JSON.stringify({ checks, errors, passed: !failure, ...(failure ? { failure } : {}) }, null, 2));
  await context.close(); await browser.close(); await server.close();
}
