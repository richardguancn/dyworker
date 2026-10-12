import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = join(pluginRoot, "templates/data-app/base");
const projectRoot = mkdtempSync(join(tmpdir(), "data-authored-tab-url-"));
const snapshot = JSON.parse(readFileSync(join(templateRoot, "src/data.json"), "utf8"));
const tabs = [{ id: "dashboard", label: "Overview" }, { id: "segments", label: "Segments" }];
let browser;
try {
  cpSync(templateRoot, projectRoot, { recursive: true,
    filter: (path) => !path.includes("/node_modules") && !path.includes("/dist") });
  writeFileSync(join(projectRoot, "src/content/dashboard/DashboardContent.jsx"), `
import React from "react";
import { useDataApp, useDashboardTabs } from "../../data-app-public.jsx";
export function DashboardContent() {
  const { activeTabId } = useDashboardTabs(${JSON.stringify(tabs)});
  const { filters, exploreDashboard } = useDataApp();
  return <section data-authored-view={activeTabId}><h1>{activeTabId}</h1>
    <output>{filters.segment}</output><button onClick={() => exploreDashboard("segments", {filters:{segment:"Studio"}})}>Inspect segment</button></section>;
}`);
  const build = runDataAppFixtureBuild(projectRoot, { pluginRoot });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const html = readFileSync(join(projectRoot, "dist/index.html"), "utf8");
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  for (const savedTabs of [undefined, tabs]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const origin = "https://authored-tab-url.chatgpt.site";
    await page.route(`${origin}/**`, (route) => {
      const { pathname } = new URL(route.request().url());
      const payload = pathname === "/api/snapshot" ? snapshot
        : pathname === "/api/presentation" ? { canEdit: false,
          presentation: savedTabs ? { tabs: savedTabs } : {}, revision: 0 } : null;
      return route.fulfill(payload ? { contentType: "application/json", body: JSON.stringify(payload) }
        : { contentType: "text/html", body: html });
    });
    await page.goto(`${origin}/?tab=segments&f.segment=Studio`);
    await page.locator('[data-authored-view="segments"]').waitFor();
    assert.equal(await page.locator("output").innerText(), "Studio");
    assert.equal(new URL(page.url()).searchParams.get("tab"), "segments");
    const hostState = {router:{key:"host-route",scroll:[0,42]},hostSequence:7};
    await page.evaluate(host=>history.replaceState({...history.state,...host},""),hostState);
    const verifyHost = async () => assert.deepEqual(await page.evaluate(() => ({router:history.state.router,hostSequence:history.state.hostSequence})),hostState);
    await page.getByRole("tab", { name: "Overview" }).click();
    await page.locator('[data-authored-view="dashboard"]').waitFor();
    await verifyHost();
    await page.goBack();
    await page.locator('[data-authored-view="segments"]').waitFor();
    await verifyHost();
    assert.equal(await page.locator("output").innerText(), "Studio");
    await page.goForward();
    await page.locator('[data-authored-view="dashboard"]').waitFor();
    await verifyHost();
    await page.getByRole("button",{name:"Inspect segment",exact:true}).click();
    await page.locator('[data-authored-view="segments"]').waitFor();
    await verifyHost();
    await page.reload();
    await page.locator('[data-authored-view="segments"]').waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write("Authored dashboard tab URL hydration, history, and reload passed.\n");
} finally {
  await browser?.close();
  rmSync(projectRoot, { recursive: true, force: true });
}
