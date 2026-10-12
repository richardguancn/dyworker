import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { createPublicationAssets } from "../skills/publish-artifact-to-sites/scripts/publication-assets.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
const project = mkdtempSync(join(tmpdir(), "data-app-deferred-"));
let browser;
try {
  cpSync(template, project, { recursive: true, filter: file => !["node_modules", "dist", "examples"].some(name => file === join(template, name) || file.startsWith(`${join(template, name)}/`)) });
  const snapshot = { ...JSON.parse(readFileSync(join(project, "src/data.json"))), id: "deferred-test", title: "Deferred test", buildStatus: "complete",
    queries: { q: { rows: [{ value: 42 }], columns: [{ name: "value", type: "number" }] } } };
  writeFileSync(join(project, "src/data.json"), JSON.stringify(snapshot));
  writeFileSync(join(project, "src/content/dashboard/DashboardContent.jsx"), `
import React, { useState } from "react";
import snapshot from "../../data.json";
import { useDataApp } from "../../data-app-public.jsx";
const captured = snapshot.queries.q.rows[0].value;
export function DashboardContent() {
  const [clicks, setClicks] = useState(0);
  const { appTitle, setAppTitle } = useDataApp();
  return <section><h1>Captured {captured}</h1><p>{appTitle}</p>
    <button onClick={() => setClicks(clicks + 1)}>Count {clicks}</button>
    <button onClick={() => setAppTitle("Updated dashboard")}>Change title</button></section>;
}`);
  const build = runDataAppFixtureBuild(project, { pluginRoot });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const fullHtml = readFileSync(join(project, "dist/index.html"), "utf8");
  const publication = createPublicationAssets({ html: fullHtml, seedSnapshot: snapshot, projectId: "project_deferred" });
  const thinHtml = publication.bytes.html.toString("utf8");
  assert.equal(publication.thinBootstrap, true);
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let releaseSnapshot;
  const gate = new Promise(resolveGate => { releaseSnapshot = resolveGate; });
  await page.route("https://deferred-test.openai.chatgpt.site/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/snapshot") {
      await gate;
      return route.fulfill({ json: snapshot });
    }
    if (pathname === "/api/presentation") return route.fulfill({ json: { presentation: {}, revision: 0, canEdit: true } });
    return route.fulfill({ contentType: "text/html", body: thinHtml });
  });
  await page.goto("https://deferred-test.openai.chatgpt.site/", { waitUntil: "domcontentloaded" });
  await page.getByText("Loading Data app…", { exact: true }).waitFor();
  assert.deepEqual(errors, [], "Authored modules must not evaluate against the empty bootstrap");
  releaseSnapshot();
  await page.getByRole("heading", { name: "Captured 42", exact: true }).waitFor();
  await page.getByRole("button", { name: "Count 0", exact: true }).click();
  await page.getByRole("button", { name: "Change title", exact: true }).click();
  await page.getByRole("button", { name: "Count 1", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "passed", checks: ["default dependency-free build", "thin bootstrap", "delayed authored module evaluation", "complete captured data", "state preserved during shell updates"] }));
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
