import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

import { installDashboardBrowserMocks, resolveChromiumExecutable } from "./browser-helpers.mjs";
import { chooseHostedHandoff } from "./data-app-browser-handoff.mjs";
import { exportOfflineDataApp, readSeparateDataBundle } from "../scripts/data-app-separate.mjs";
import { createPublicationAssets } from "../skills/publish-artifact-to-sites/scripts/publication-assets.mjs";
import { createPublicationSnapshotIndex } from "../skills/publish-artifact-to-sites/scripts/publication-snapshot-index.mjs";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const template = join(pluginRoot, "templates/data-app/base");
const project = mkdtempSync(join(tmpdir(), "data-app-query-loading-browser-"));
const origin = "https://query-loading.openai.chatgpt.site";
let browser;
const pageErrors = [];
const snapshot = {
  ...JSON.parse(readFileSync(join(template, "src/data.json"))),
  id: "query-loading-test", title: "Query loading test", buildStatus: "complete",
  filters: ["first", "second"].map(id => ({ id: `${id}Segment`, label: "Segment", field: "segment", queryIds: [id], defaultValue: "all" })),
  queries: Object.fromEntries([
    ["first", [{ segment: "A", value: 11 }, { segment: "B", value: 22 }]],
    ["second", [{ segment: "A", value: 33 }, { segment: "B", value: 44 }]],
    ["contextOnly", [{ value: 5 }, { value: 6 }, { value: 7 }]],
  ].map(([id, rows]) => [id, { rows, source: { label: `${id} reviewed source`, sql: "SELECT segment, value FROM reviewed_fixture" } }])),
};
const content = `
import React, { useLayoutEffect } from "react";
import { EvidenceChart, Filters, QueryDataBoundary, useDataApp, useDashboardTabs } from "../../data-app-public.jsx";
const tabs = [{ id: "first", label: "First", filterIds: ["firstSegment"] }, { id: "second", label: "Second", filterIds: ["secondSegment"] }];
function PaletteProbe() {
  const { resolveColor, queries } = useDataApp();
  useLayoutEffect(() => {
    (globalThis.__paletteResolvers ??= new Set()).add(resolveColor);
    globalThis.__paletteLoaded = Object.keys(queries).filter(id => Array.isArray(queries[id].rows));
  }, [resolveColor, queries]);
  return null;
}
function QueryView({ queryId }) {
  const shell = useDataApp();
  const rows = shell.reviewedRows(queryId, ["segment"]);
  return <section>
    <Filters filters={shell.snapshot.filters.filter(filter => filter.queryIds.includes(queryId))} queries={shell.queries} values={shell.filters} onChange={shell.setFilter} />
    <p data-testid="row-summary">{queryId}:{rows.map(row => row.value).join(",")}</p>
    <EvidenceChart id={"chart-" + queryId} queryId={queryId} title={queryId + " reviewed values"}
      spec={{ type: "bar", x: "segment", y: "value", showValues: true }} rows={rows} sourceRows={rows} height={240} />
  </section>;
}
function TabsDashboard() {
  const { activeTabId } = useDashboardTabs(tabs);
  const queryId = tabs.find(tab => tab.id === activeTabId)?.id;
  return <section><p data-testid="metadata-ready">Reviewed dashboard metadata ready</p>
    {queryId && <QueryDataBoundary queryIds={[queryId]}><QueryView queryId={queryId} /></QueryDataBoundary>}
  </section>;
}
function SingleDashboard() {
  const shell = useDataApp();
  return <section><button onClick={() => shell.setFilter("firstSegment", "B")}>Choose B while loading</button>
    <QueryDataBoundary queryIds={["first"]} loadingLayout="component"><QueryView queryId="first" /></QueryDataBoundary>
  </section>;
}
export function DashboardContent() {
  return <><PaletteProbe />{new URLSearchParams(globalThis.location.search).has("single") ? <SingleDashboard /> : <TabsDashboard />}</>;
}
`;

function build(authored) {
  writeFileSync(join(project, "src/data.json"), JSON.stringify(snapshot));
  writeFileSync(join(project, "src/content/dashboard/DashboardContent.jsx"), authored);
  const result = spawnSync(process.execPath, [join(pluginRoot, "scripts/data-app.mjs"), "build", "--project-dir", project, "--separate-data"],
    { encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return readSeparateDataBundle({ projectDir: project });
}
function publication(bundle, queryLoading) {
  const snapshotBytes = readFileSync(bundle.snapshotPath);
  return createPublicationAssets({ html: bundle.htmlBytes.toString("utf8"), seedSnapshot: snapshot,
    projectId: "project_query_loading", separateData: true, snapshotBytes,
    indexedSnapshot: { bytes: snapshotBytes, ...createPublicationSnapshotIndex(snapshotBytes) },
    ...(queryLoading ? { queryLoading } : {}) });
}
async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__queryTools = new Map();
    Object.defineProperty(document, "modelContext", { configurable: true, value: {
      registerTool(tool) { window.__queryTools.set(tool.name, tool); },
      unregisterTool(name) { window.__queryTools.delete(name); },
    } });
    const fetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const response = await fetch(...args);
      if (new URL(response.url).pathname === "/api/query-rows") {
        response.json = response.text = () => { throw new Error("Reviewed query data must use streaming parsing"); };
      }
      return response;
    };
  });
  return page;
}
async function serve(page, assets, { headSupported = true, canEdit = true, firstGate, failSecondOnce = false, changedSecond = false } = {}) {
  const requests = [], queryIds = [];
  let failed = false;
  await page.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    if (url.pathname === "/api/snapshot/head") return route.fulfill({ json: headSupported ? {
      supported: true, snapshotSha256: assets.deploymentAssets.snapshot.sha256,
      queries: Object.fromEntries(Object.keys(snapshot.queries).map(id => [id, { revision: "seed" }])),
    } : { supported: false } });
    if (url.pathname === "/api/snapshot") return route.fulfill({ json: snapshot });
    if (url.pathname === "/api/presentation") return route.fulfill({ json: { presentation: {}, revision: 0, canEdit } });
    if (url.pathname.startsWith("/api/queries/")) {
      assert.equal(route.request().method(), "PUT");
      assert.equal(canEdit, true);
      const queryId = decodeURIComponent(url.pathname.slice("/api/queries/".length));
      assert.ok(Object.hasOwn(snapshot.queries, queryId));
      return route.fulfill({ json: { queryId, rows: route.request().postDataJSON().rows,
        generatedAt: "2026-09-08T22:00:00.000Z" } });
    }
    if (url.pathname === "/api/query-rows") {
      const id = url.searchParams.get("queryId");
      assert.equal(url.searchParams.get("snapshot"), assets.deploymentAssets.snapshot.sha256);
      assert.equal(url.searchParams.get("revision"), "seed");
      assert.ok(Object.hasOwn(snapshot.queries, id));
      queryIds.push(id);
      if (id === "first" && firstGate) await firstGate;
      if (id === "second" && changedSecond) return route.fulfill({ status: 409, body: "Snapshot changed" });
      if (id === "second" && failSecondOnce && !failed) {
        failed = true;
        return route.fulfill({ status: 503, body: "Temporary fixture failure" });
      }
      return route.fulfill({ json: snapshot.queries[id].rows });
    }
    return route.fulfill({ contentType: "text/html", body: assets.bytes.html });
  });
  return { requests, queryIds };
}
const readContext = page => page.evaluate(() => window.__queryTools.get("get_data_app_context").execute({}));
async function rowSummary(page, expected) {
  await page.waitForFunction(value => document.querySelector('[data-testid="row-summary"]')?.textContent === value, expected);
}

try {
  cpSync(template, project, { recursive: true, filter: path => !["node_modules", "dist", "examples"].some(name => path === join(template, name) || path.startsWith(`${join(template, name)}/`)) });
  const bundle = build(content);
  const assets = publication(bundle, "on-demand");
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const page = await newPage();
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const network = await serve(page, assets, { firstGate, failSecondOnce: true });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByTestId("metadata-ready").waitFor();
  await page.locator(".dashboard-topbar-title").waitFor();
  await page.getByRole("status", { name: "Loading reviewed data" }).waitFor();
  const tabLoading = page.locator(".dashboard-shell-loading-embedded");
  assert.equal(await tabLoading.locator(".dashboard-shell-loading-heading").count(), 1);
  assert.equal(await tabLoading.locator(".dashboard-shell-loading-metrics > .dashboard-shell-loading-card").count(), 4);
  assert.equal(await tabLoading.locator(".dashboard-shell-loading-charts > .dashboard-shell-loading-card").count(), 2);
  assert.equal(await page.locator(".dashboard-topbar").count(), 1, "The native top bar remains available");
  assert.equal(await page.locator(".dashboard-shell-loading-topbar").count(), 0, "Tab loading adds no second top bar");
  assert.equal(await page.locator("main").count(), 1, "Tab loading adds no second main landmark");
  await page.getByRole("tab", { name: "First", exact: true }).waitFor();
  assert.equal(await page.locator('[data-component-id="chart-first"]').count(), 0);
  assert.deepEqual(network.queryIds, ["first"]);
  assert.equal(network.requests.includes("/api/snapshot"), false);
  await page.waitForFunction(() => window.__queryTools.has("get_data_app_context"));
  const initial = await readContext(page);
  assert.equal(await page.evaluate(() => window.__paletteResolvers.size), 1);
  assert.equal(initial.queries.first.rowCount, 2);
  assert.equal(initial.queries.second.rowCount, 2);
  assert.equal(initial.queries.second.loaded, false);
  assert.deepEqual(initial.queries.second.columns, ["segment", "value"]);
  assert.equal(Object.hasOwn(initial.snapshot.queries.second, "rows"), false);
  const contextRows = await page.evaluate(contextVersion => window.__queryTools.get("get_data_app_query_rows").execute({
    queryId: "contextOnly", offset: 0, limit: 500, contextVersion,
  }), initial.contextVersion);
  assert.equal(contextRows.totalRows, 3);
  assert.deepEqual(contextRows.rows, snapshot.queries.contextOnly.rows);
  assert.deepEqual(network.queryIds, ["first", "contextOnly"]);
  await page.waitForFunction(() => window.__paletteLoaded.includes("contextOnly"));
  assert.equal(await page.evaluate(() => window.__paletteResolvers.size), 1, "Hydrating an unrelated query reuses the complete reviewed palette");
  releaseFirst();
  await rowSummary(page, "first:11,22");
  assert.equal(await tabLoading.count(), 0, "The page skeleton is replaced by loaded content");
  const firstChart = page.locator('[data-component-id="chart-first"]');
  await firstChart.locator(".recharts-bar-rectangle path").first().waitFor();
  await firstChart.getByRole("button", { name: "first reviewed values actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit chart", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "Export chart", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "View data source", exact: true }).click();
  const source = page.getByRole("complementary", { name: "Data source for first reviewed values" });
  await source.getByRole("tab", { name: "Data preview", exact: true }).click();
  await source.getByRole("cell", { name: "11", exact: true }).waitFor();
  await source.getByRole("cell", { name: "22", exact: true }).waitFor();
  await source.getByRole("button", { name: "Close data source", exact: true }).click();
  await source.waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "Second", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator('[data-component-id="chart-second"]').count(), 0);
  assert.deepEqual(network.queryIds, ["first", "contextOnly", "second"]);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await rowSummary(page, "second:33,44");
  await page.getByRole("tab", { name: "First", exact: true }).click();
  await rowSummary(page, "first:11,22");
  assert.deepEqual(network.queryIds, ["first", "contextOnly", "second", "second"]);
  assert.equal(await page.evaluate(() => window.__paletteResolvers.size), 1, "Tab hydration and revisits reuse the same palette resolver");
  for (const [index, value] of [55, 66].entries()) {
    await page.evaluate(value => window.__queryTools.get("update_data_app_query").execute({
      queryId: "first", rows: [{ segment: "C", value }],
    }), value);
    await rowSummary(page, `first:${value}`);
    assert.equal(await page.evaluate(() => window.__paletteResolvers.size), index + 2, "Owner edits recompute the palette from current complete queries");
    assert.equal(Object.hasOwn((await readContext(page)).snapshot, "_dataAppQueryLoading"), false);
  }
  await page.close();

  const deep = await newPage();
  const deepNetwork = await serve(deep, assets, { canEdit: false });
  await deep.goto(`${origin}/?view=1&tab=second&f.secondSegment=B`, { waitUntil: "domcontentloaded" });
  await rowSummary(deep, "second:44");
  assert.deepEqual(deepNetwork.queryIds, ["second"]);
  assert.equal((await readContext(deep)).view.filters.secondSegment, "B");
  assert.equal(await deep.getByRole("button", { name: "Edit text and layout", exact: true }).count(), 0);
  await deep.getByRole("button", { name: "Segment", exact: true }).click();
  await deep.getByRole("menuitemradio", { name: "A", exact: true }).click();
  await rowSummary(deep, "second:33");
  assert.deepEqual(deepNetwork.queryIds, ["second"]);
  await deep.close();

  const changed = await newPage();
  const changedNetwork = await serve(changed, assets, { changedSecond: true });
  await changed.goto(`${origin}/?tab=second`, { waitUntil: "domcontentloaded" });
  await changed.getByRole("alert").getByText("Dashboard data changed.", { exact: true }).waitFor();
  assert.equal(await changed.getByRole("button", { name: "Try again", exact: true }).count(), 0);
  assert.deepEqual(changedNetwork.queryIds, ["second"]);
  await changed.close();

  const single = await newPage();
  let releaseSingle;
  const singleGate = new Promise(resolve => { releaseSingle = resolve; });
  const singleNetwork = await serve(single, assets, { firstGate: singleGate });
  await single.goto(`${origin}/?single=1`, { waitUntil: "domcontentloaded" });
  await single.getByRole("status", { name: "Loading reviewed data" }).waitFor();
  assert.equal(await single.locator(".component-loading-body").count(), 1,
    "A narrow section can use the chart-sized loading placeholder");
  assert.equal(await single.locator(".dashboard-shell-loading-embedded").count(), 0);
  await single.getByRole("button", { name: "Choose B while loading", exact: true }).click();
  releaseSingle();
  await rowSummary(single, "first:22");
  assert.equal((await readContext(single)).presentation.filters.firstSegment, "B");
  assert.deepEqual(singleNetwork.queryIds, ["first"]);
  await single.close();

  const pdfExport = await newPage();
  await installDashboardBrowserMocks(pdfExport);
  let releasePdf;
  const pdfGate = new Promise(resolve => { releasePdf = resolve; });
  const pdfNetwork = await serve(pdfExport, assets, { firstGate: pdfGate });
  await pdfExport.goto(`${origin}/?view=1&tab=first&f.firstSegment=B`, { waitUntil: "domcontentloaded" });
  await pdfExport.getByTestId("metadata-ready").waitFor();
  await pdfExport.getByRole("status", { name: "Loading reviewed data" }).waitFor();
  await pdfExport.waitForFunction(() => window.__queryTools.has("get_data_app_context"));
  const pdfContext = await readContext(pdfExport);
  await pdfExport.getByRole("button", { name: "More", exact: true }).click();
  await pdfExport.getByRole("menuitem", { name: "PDF", exact: true }).click();
  const pdfHandoff = await chooseHostedHandoff(pdfExport, "desktop");
  assert.equal(pdfHandoff.href.startsWith("codex://new?"), true);
  assert.equal(pdfHandoff.searchParams.get("browserUrl"), pdfContext.viewUrl);
  assert.equal(new URL(pdfContext.viewUrl).searchParams.get("tab"), "first");
  assert.equal(new URL(pdfContext.viewUrl).searchParams.get("f.firstSegment"), "B");
  assert.match(pdfHandoff.searchParams.get("prompt"), /\$data-analytics:report-to-pdf to export the entire /u);
  assert.ok(pdfHandoff.searchParams.get("prompt").includes(`](<${pdfContext.viewUrl}>)`));
  assert.deepEqual(await pdfExport.evaluate(() => window.__dashboardDeepLinks), [pdfHandoff.href]);
  assert.deepEqual(await pdfExport.evaluate(() => window.__dashboardPrompts), [], "PDF handoff never sends through the host bridge");
  assert.equal(await pdfExport.evaluate(() => window.__dashboardPrints), 0, "PDF handoff does not invoke native printing");
  assert.deepEqual(pdfNetwork.queryIds, ["first"], "PDF handoff does not force deferred queries to load");
  const pendingPdfContext = await readContext(pdfExport);
  assert.equal(pendingPdfContext.queries.first.loaded, false, "PDF handoff does not wait for pending reviewed rows");
  assert.equal(pendingPdfContext.queries.second.loaded, false);
  assert.equal(pendingPdfContext.queries.contextOnly.loaded, false);
  releasePdf();
  await rowSummary(pdfExport, "first:22");
  assert.deepEqual(pdfNetwork.queryIds, ["first"]);
  assert.equal(await pdfExport.evaluate(() => window.__dashboardPrints), 0);
  await pdfExport.close();

  const fallback = await newPage();
  const fallbackNetwork = await serve(fallback, assets, { headSupported: false });
  await fallback.goto(origin, { waitUntil: "domcontentloaded" });
  await rowSummary(fallback, "first:11,22");
  assert.deepEqual(fallbackNetwork.queryIds, []);
  assert.equal(fallbackNetwork.requests.filter(path => path === "/api/snapshot").length, 1);
  await fallback.close();

  const eagerBundle = build(`
import React from "react";
import snapshot from "../../data.json";
import { QueryDataBoundary } from "../../data-app-public.jsx";
const captured = snapshot.queries.second.rows[1].value;
export function DashboardContent() { return <QueryDataBoundary queryIds={["second"]}><h2>Captured {captured} at module scope</h2></QueryDataBoundary>; }
`);
  const eagerAssets = publication(eagerBundle);
  const eager = await newPage(), eagerNetwork = await serve(eager, eagerAssets);
  await eager.goto(origin, { waitUntil: "domcontentloaded" });
  await eager.getByRole("heading", { name: "Captured 44 at module scope", exact: true }).waitFor();
  assert.equal(eagerNetwork.requests.includes("/api/snapshot/head"), false);
  assert.equal(eagerNetwork.requests.filter(path => path === "/api/snapshot").length, 1);
  assert.deepEqual(eagerNetwork.queryIds, []);
  await eager.close();

  const local = await newPage(), localRequests = [];
  await local.route("http://localhost:18471/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    localRequests.push(pathname);
    return pathname === `/${eagerBundle.manifest.snapshot.path}`
      ? route.fulfill({ contentType: "application/json", body: readFileSync(eagerBundle.snapshotPath) })
      : route.fulfill({ contentType: "text/html", body: eagerBundle.htmlBytes });
  });
  await local.goto("http://localhost:18471/", { waitUntil: "domcontentloaded" });
  await local.getByRole("heading", { name: "Captured 44 at module scope", exact: true }).waitFor();
  assert.equal(localRequests.some(path => path.startsWith("/api/")), false);
  await local.close();
  const exported = await exportOfflineDataApp({ projectDir: project });
  const offline = await newPage(), offlineRequests = [];
  offline.on("request", request => { if (/^https?:/u.test(request.url())) offlineRequests.push(request.url()); });
  await offline.goto(pathToFileURL(exported.htmlPath).href);
  await offline.getByRole("heading", { name: "Captured 44 at module scope", exact: true }).waitFor();
  assert.deepEqual(offlineRequests, []);
  await offline.close();
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ status: "passed", checks: ["native shell and tab-wide page skeleton before query rows", "no duplicate top bar or main landmark", "loaded content replaces page skeleton", "optional component-sized loading placeholder", "only active tab dependencies loaded", "metadata-only context with exact deferred counts", "explicit context row load", "palette reuse through hydration and recomputation after owner edits", "full native chart and Source actions", "failed query retry and changed-snapshot reload guidance", "PDF handoff preserves the exact view without eager loading or printing", "single-tab filter changes survive hydration", "cached tab revisit", "deep-link filter preservation and interaction", "read-only viewer", "unsupported-head eager fallback", "default eager module-scope imports", "local separate-data compatibility", "complete offline export without network"] }));
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
