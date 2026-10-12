import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";
import { presentationStorageKey, presentationVersion } from "../templates/data-app/base/src/presentation-state.js";
import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
const project = mkdtempSync(join(tmpdir(), "data-app-identity-"));
const snapshot = { ...JSON.parse(readFileSync(join(template, "src/data.json"), "utf8")),
  surface: "report", id: "stable-report-identity", title: "A new evidence-led title",
  legacyPresentationTitle: "Original report title" };
const htmlPath = join(project, "dist/index.html");
const url = pathToFileURL(htmlPath);
const oldKey = presentationStorageKey({ title: snapshot.legacyPresentationTitle }, url.pathname);
const newKey = presentationStorageKey(snapshot, url.pathname);
const oldPresentation = { title: "User-edited report title", textEdits: { "finding:body": "Saved finding" },
  hiddenBlocks: ["hidden-finding"], componentTitles: { finding: "Custom component title" },
  appearance: "light", chartOverrides: { chart: { type: "bar" } } };
const oldRecord = JSON.stringify({ version: presentationVersion, presentation: oldPresentation });
const content = `import React from "react";
import { ReportSection, RichNarrative, useDataApp } from "../../data-app-public.jsx";
export function ReportContent() {
  const { appTitle, setAppTitle, canEdit, mode, visible } = useDataApp();
  return <article className="report-content"><header className="report-hero">
    <h1 data-data-app-title contentEditable={canEdit && mode === "edit"} suppressContentEditableWarning
      aria-label={mode === "edit" ? "Edit report heading" : undefined}
      onBlur={(event) => setAppTitle(event.currentTarget.textContent)}>{appTitle}</h1></header>
    {visible("finding") && <ReportSection id="finding" title="Finding" queryId="usage_summary" showHeading={false}>
      <RichNarrative id="finding:body" value="Default finding" /></ReportSection>}
    {visible("hidden-finding") && <ReportSection id="hidden-finding" title="Hidden finding" queryId="usage_summary">
      <RichNarrative id="hidden-finding:body" value="This was hidden" /></ReportSection>}
  </article>;
}`;

let browser;
try {
  cpSync(template, project, { recursive: true,
    filter: (path) => !["node_modules", "dist", "examples"].some((part) =>
      path === join(template, part) || path.startsWith(`${join(template, part)}/`)) });
  writeFileSync(join(project, "src/data.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(join(project, "src/content/report/ReportContent.jsx"), content);
  const build = runDataAppFixtureBuild(project, { pluginRoot });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1050, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ oldKey, oldRecord }) => {
    if (localStorage.getItem(oldKey) === null) localStorage.setItem(oldKey, oldRecord);
    if (localStorage.getItem(`${oldKey}:viewer-appearance`) === null)
      localStorage.setItem(`${oldKey}:viewer-appearance`, "dark");
  }, { oldKey, oldRecord });
  await page.goto(url.href, { waitUntil: "load" });
  await page.getByRole("heading", { name: oldPresentation.title, exact: true }).waitFor();
  assert.equal(await page.getByText("Saved finding", { exact: true }).count(), 1);
  assert.equal(await page.locator('[data-component-id="hidden-finding"]').count(), 0);
  await page.waitForFunction((key) => localStorage.getItem(key) !== null, newKey);
  let stored = await page.evaluate(({ oldKey, newKey }) => ({
    old: localStorage.getItem(oldKey), current: JSON.parse(localStorage.getItem(newKey)).presentation,
    appearance: localStorage.getItem(`${newKey}:viewer-appearance`),
  }), { oldKey, newKey });
  assert.equal(stored.old, oldRecord, "Migration must not delete or rewrite legacy state");
  for (const key of ["title", "textEdits", "hiddenBlocks", "componentTitles", "chartOverrides"])
    assert.deepEqual(stored.current[key], oldPresentation[key], key);
  assert.equal(stored.appearance, "dark");
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  await page.getByRole("heading", { name: "Edit report heading", exact: true }).fill("A later user title");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).presentation.title === "A later user title", newKey);
  await page.reload({ waitUntil: "load" });
  await page.getByRole("heading", { name: "A later user title", exact: true }).waitFor();
  assert.equal(await page.getByText("Saved finding", { exact: true }).count(), 1);
  assert.equal(await page.locator('[data-component-id="hidden-finding"]').count(), 0);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), oldKey), oldRecord);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "passed", checks: ["legacy title lookup", "saved title/text/visibility",
    "component/chart overrides", "viewer appearance", "stable record wins after editing and reload",
    "legacy record retained"] }, null, 2));
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
