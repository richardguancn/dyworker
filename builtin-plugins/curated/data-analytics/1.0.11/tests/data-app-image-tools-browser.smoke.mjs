import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { installDashboardBrowserMocks, resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
const project = mkdtempSync(join(tmpdir(), "data-image-tools-"));
const unusualId = 'card "quoted"]\\:雪';
const names = ["list_data_app_cards", "get_data_app_card_image", "get_data_app_card_images",
  "get_data_app_context", "get_data_app_query_rows", "get_data_app_text"];
const snapshot = {
  id: "image-tools-browser-fixture", surface: "dashboard", title: "Synthetic card image fixture",
  generatedAt: "2026-08-28T12:00:00Z", filters: [],
  queries: {
    evidence: {
      rows: [{ period: "First", value: 24 }, { period: "Second", value: 62 }, { period: "Third", value: 91 }],
      source: { label: "Synthetic reviewed evidence", sql: "SELECT period, value FROM synthetic_fixture",
        tables: ["synthetic_fixture"], executedAt: "2026-08-28T12:00:00Z" },
    },
  },
};
const content = `import React from "react";
import { ChartRenderer, DataComponent, DataTable, MetricCard, useDashboardTabs, useDataApp } from "../../data-app-public.jsx";

export function DashboardContent() {
  const { reviewedRows, chartProps } = useDataApp();
  const { activeTabId } = useDashboardTabs([{ id: "dashboard", label: "Overview" }, { id: "secondary", label: "Other cards" }]);
  const rows = reviewedRows("evidence");
  const chart = { type: "bar", x: "period", y: "value", showXAxisLabel: false };
  if (activeTabId === "secondary") return <article className="image-fixture" data-fixture-tab="secondary">
    <MetricCard id="other-tab-card" title="Other tab evidence" queryId="evidence" value="91" />
  </article>;
  return <article className="image-fixture" data-fixture-tab="dashboard">
    <DataComponent id="chart-card" title="Shared title" queryId="evidence" kind="chart" chart={chart}
      variant="card" sourceRows={rows} displayRows={rows}>
      <ChartRenderer rows={rows} spec={chart} height={210} {...chartProps("chart-card")} />
    </DataComponent>
    <div className="image-fixture-pair">
      <MetricCard id="metric-card" title="Shared title" queryId="evidence" value="91"
        comparison="+29" trendValues={[24, 62, 91]} sourceRows={rows} />
      <DataComponent id="table-card" title="Shared title" queryId="evidence" kind="table" variant="card"
        sourceRows={rows} displayRows={rows}>
        <DataTable rows={rows} columns={[{ field: "period", label: "Period" }, { field: "value", label: "Count" }]} />
      </DataComponent>
    </div>
    <div hidden><MetricCard id="hidden-card" title="Hidden evidence" queryId="evidence" value="91" /></div>
    <div className="image-fixture-offscreen">
      <DataComponent id={${JSON.stringify(unusualId)}} title="Offscreen exact ID" queryId="evidence"
        kind="custom" variant="card" sourceRows={rows}>
        <p data-reviewed-rows>Reviewed count: <strong>91</strong></p>
        <div data-fixture-scroll style={{ height: 40, overflow: "auto" }}>
          <div style={{ height: 120 }}>Reviewed periods: First 24, Second 62, Third 91.</div>
        </div>
      </DataComponent>
    </div>
    <div className="image-fixture-pair">
      <MetricCard id="duplicate-id" title="First duplicate" queryId="evidence" value="24" />
      <MetricCard id="duplicate-id" title="Second duplicate" queryId="evidence" value="91" />
    </div>
    <svg width="0" height="0" aria-hidden="true"><defs>
      <linearGradient id="outside-card-gradient"><stop offset="0" stopColor="red" /><stop offset="1" stopColor="red" /></linearGradient>
    </defs></svg>
    <DataComponent id="external-defs-card" title="Evidence with a shared paint definition" queryId="evidence"
      kind="custom" variant="card">
      <svg width="200" height="100"><rect width="200" height="100" fill="url(#outside-card-gradient)" /></svg>
    </DataComponent>
  </article>;
}`;

async function installTools(page) {
  await installDashboardBrowserMocks(page);
  await page.addInitScript(() => {
    window.__imageTools = new Map();
    window.__imageToolFetches = [];
    window.__imageToolDownloads = [];
    Object.defineProperty(document, "modelContext", { configurable: true, value: {
      registerTool(tool, { signal } = {}) {
        if (signal?.aborted) return;
        window.__imageTools.set(tool.name, tool);
        signal?.addEventListener("abort", () => {
          if (window.__imageTools.get(tool.name) === tool) window.__imageTools.delete(tool.name);
        }, { once: true });
      },
    } });
    const fetch = window.fetch;
    window.fetch = function (...args) {
      window.__imageToolFetches.push({ url: String(args[0]), method: args[1]?.method ?? "GET" });
      return fetch.apply(this, args);
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__imageToolDownloads.push(this.download);
      return click.call(this);
    };
  });
}

const invoke = (page, name, input = {}) => page.evaluate(({ toolName, args }) =>
  window.__imageTools.get(toolName).execute(args), { toolName: name, args: input });

async function rejectTool(page, name, input, expected) {
  const result = await page.evaluate(async ({ toolName, args }) => {
    try { await window.__imageTools.get(toolName).execute(args); return { succeeded: true }; }
    catch (error) { return { error: String(error.message) }; }
  }, { toolName: name, args: input });
  assert.match(result.error ?? "Unexpected successful export", expected);
}

async function readerState(page) {
  return page.evaluate(() => ({
    url: location.href, scroll: [scrollX, scrollY], tab: document.querySelector("[data-fixture-tab]")?.dataset.fixtureTab,
    focus: { tag: document.activeElement?.tagName, id: document.activeElement?.id,
      label: document.activeElement?.getAttribute("aria-label") },
    storage: Object.entries(localStorage).sort(([left], [right]) => left.localeCompare(right)),
    fetches: window.__imageToolFetches, downloads: window.__imageToolDownloads,
    clipboard: window.__dashboardClipboard, prompts: window.__dashboardPrompts,
  }));
}

async function inspectPng(page, result, { scale = 2, bodySelector } = {}) {
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.encoding, "base64");
  assert.deepEqual(result.queryIds, ["evidence"]);
  assert.match(result.filename, /^[a-z0-9-]+\.png$/iu);
  const bytes = Buffer.from(result.data, "base64");
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), result.width);
  assert.equal(bytes.readUInt32BE(20), result.height);
  const pixels = await page.evaluate(async ({ imageResult, imageScale, contentSelector }) => {
    const card = [...document.querySelectorAll("main [data-component-id]")]
      .find((element) => element.dataset.componentId === imageResult.cardId);
    const bounds = card.getBoundingClientRect();
    const image = new Image();
    image.src = `data:image/png;base64,${imageResult.data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    function regionStats(rect) {
      const left = Math.max(0, Math.floor((rect.left - bounds.left) * imageScale));
      const top = Math.max(0, Math.floor((rect.top - bounds.top) * imageScale));
      const width = Math.min(canvas.width - left, Math.max(1, Math.floor(rect.width * imageScale)));
      const height = Math.min(canvas.height - top, Math.max(1, Math.floor(rect.height * imageScale)));
      const data = context.getImageData(left, top, width, height).data;
      let opaque = 0;
      let minimum = 255;
      let maximum = 0;
      let brightness = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] < 200) continue;
        opaque += 1;
        const value = (data[index] + data[index + 1] + data[index + 2]) / 3;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
        brightness += value;
      }
      return { opaque, range: maximum - minimum, brightness: opaque ? brightness / opaque : 0 };
    }
    return {
      expectedWidth: Math.ceil(bounds.width * imageScale), expectedHeight: Math.ceil(bounds.height * imageScale),
      whole: regionStats(bounds),
      title: regionStats(card.querySelector(".component-title-text").getBoundingClientRect()),
      body: contentSelector ? regionStats(card.querySelector(contentSelector).getBoundingClientRect()) : null,
    };
  }, { imageResult: result, imageScale: scale, contentSelector: bodySelector });
  assert.equal(result.width, pixels.expectedWidth, "PNG width matches the exact card at requested scale");
  assert.equal(result.height, pixels.expectedHeight, "PNG height matches the exact card at requested scale");
  for (const [region, stats] of Object.entries({ whole: pixels.whole, title: pixels.title, ...(pixels.body && { body: pixels.body }) })) {
    assert.ok(stats.opaque > 20 && stats.range > 30,
      `${result.cardId} ${region} must contain visible evidence, not a blank/transparent rectangle: ${JSON.stringify(stats)}`);
  }
  return pixels;
}

async function ready(page) {
  await page.waitForFunction((toolNames) => toolNames.every((name) => window.__imageTools.has(name)), names);
  await page.locator('[data-component-id="chart-card"] .recharts-surface').waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

let browser;
try {
  cpSync(template, project, { recursive: true,
    filter: (path) => !path.includes("/node_modules") && !path.includes("/dist") });
  writeFileSync(join(project, "src/data.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(join(project, "src/content/dashboard/DashboardContent.jsx"), content);
  writeFileSync(join(project, "src/content/dashboard/dashboard.css"), `
.image-fixture { display: grid; gap: 24px; max-width: 680px; padding-block: 24px; }
.image-fixture-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.image-fixture-offscreen { margin-top: 1000px; }
`);
  const build = runDataAppFixtureBuild(project, { pluginRoot });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const html = readFileSync(join(project, "dist/index.html"), "utf8");
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const failures = [];
  const local = await browser.newPage({ viewport: { width: 1100, height: 850 }, colorScheme: "light" });
  local.on("pageerror", (error) => failures.push(error.message));
  await installTools(local);
  await local.goto(pathToFileURL(join(project, "dist/index.html")).href, { waitUntil: "load" });
  await ready(local);
  // An unrelated element elsewhere in the host document cannot shadow a card.
  await local.evaluate(() => {
    const unrelated = document.createElement("section");
    unrelated.dataset.componentId = "chart-card";
    unrelated.textContent = "OUTSIDE_DATA_APP_ROOT";
    document.body.prepend(unrelated);
  });
  const before = await readerState(local);
  const renderedText = await invoke(local, "get_data_app_text", { id: "chart-card" });
  assert.ok(renderedText.text.includes("Shared title"));
  assert.doesNotMatch(renderedText.text, /OUTSIDE_DATA_APP_ROOT/u,
    "Text retrieval is scoped to the Data app root");
  await rejectTool(local, "get_data_app_text", { id: "hidden-card" }, /not visible/iu);
  await rejectTool(local, "get_data_app_text", { id: "duplicate-id" }, /ambiguous/iu);
  await rejectTool(local, "get_data_app_text", { id: "other-tab-card" }, /not visible/iu);
  const listed = await invoke(local, names[0]);
  assert.deepEqual(listed.cards.filter(({ title }) => title === "Shared title").map(({ cardId }) => cardId),
    ["chart-card", "metric-card", "table-card"], "Duplicate titles retain independent stable IDs");
  assert.equal(listed.view.tabId, "dashboard");
  assert.ok(!listed.cards.some(({ cardId }) => cardId === "other-tab-card"), "Unmounted tabs are not discovered");
  assert.equal(listed.cards.find(({ cardId }) => cardId === "hidden-card").imageAvailable, false);
  assert.equal(listed.cards.filter(({ cardId }) => cardId === "duplicate-id").length, 2);
  assert.ok(listed.cards.filter(({ cardId }) => cardId === "duplicate-id").every(({ imageAvailable }) => !imageAvailable));
  assert.equal(listed.cards.find(({ cardId }) => cardId === unusualId).imageAvailable, true);
  const chart = await invoke(local, names[1], { cardId: "chart-card" });
  assert.equal(chart.title, "Shared title");
  assert.deepEqual(chart.view, listed.view);
  const lightChart = await inspectPng(local, chart, { bodySelector: ".recharts-wrapper" });
  const batch = await invoke(local, names[2], { cardIds: ["table-card", "metric-card", unusualId], scale: 1 });
  assert.deepEqual(batch.images.map(({ cardId }) => cardId), ["table-card", "metric-card", unusualId]);
  assert.deepEqual(batch.view, listed.view);
  for (const [index, selector] of ["tbody", ".metric-value", "[data-reviewed-rows]"].entries()) {
    await inspectPng(local, batch.images[index], { scale: 1, bodySelector: selector });
  }
  assert.equal(await local.evaluate((id) => [...document.querySelectorAll("main [data-component-id]")]
    .find((element) => element.dataset.componentId === id).getBoundingClientRect().top > innerHeight, unusualId), true,
  "The exact-ID export also captures a mounted card below the viewport");

  for (const [input, error] of [
    [{ cardId: "Shared title" }, /not mounted/iu],
    [{ cardId: "other-tab-card" }, /not mounted/iu],
    [{ cardId: "hidden-card" }, /hidden/iu],
    [{ cardId: "duplicate-id" }, /ambiguous/iu],
    [{ cardId: "external-defs-card" }, /definitions|references|embedded/iu],
    [{ cardId: "" }, /exact cardId/iu],
    [{ cardId: "chart-card", scale: 0 }, /scale/iu],
    [{ cardId: "chart-card", extra: true }, /invalid/iu],
  ]) await rejectTool(local, names[1], input, error);
  await rejectTool(local, names[2], { cardIds: ["chart-card", "missing-card"] }, /not mounted/iu);
  await rejectTool(local, names[2], { cardIds: ["chart-card", "chart-card"] }, /unique/iu);
  assert.deepEqual(await readerState(local), before,
    "Discovery, single/batch exports and rejected requests preserve focus, view, storage and all external side effects");
  await local.locator("[data-fixture-scroll]").evaluate((element) => { element.scrollTop = 30; });
  await rejectTool(local, names[1], { cardId: unusualId }, /scroll/iu);
  assert.equal(await local.locator("[data-fixture-scroll]").evaluate((element) => element.scrollTop), 30,
    "Unsupported nested scrolling fails explicitly without changing the reader's scroll position");

  await local.getByRole("tab", { name: "Other cards", exact: true }).click();
  await local.locator('[data-component-id="other-tab-card"]').waitFor();
  const nextView = await invoke(local, names[0]);
  assert.deepEqual(nextView.cards.map(({ cardId }) => cardId), ["other-tab-card"]);
  assert.equal(nextView.view.tabId, "secondary");
  await rejectTool(local, names[1], { cardId: "chart-card" }, /not mounted/iu);

  const viewer = await browser.newPage({ viewport: { width: 1100, height: 850 }, colorScheme: "light" });
  viewer.on("pageerror", (error) => failures.push(error.message));
  await installTools(viewer);
  const writes = [];
  await viewer.route("https://card-image-fixture.chatgpt.site/**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") writes.push({ method: request.method(), url: request.url() });
    const { pathname } = new URL(request.url());
    const json = pathname === "/api/snapshot" ? snapshot : pathname === "/api/presentation"
      ? { canEdit: false, revision: 0, presentation: {
        appearance: "dark", componentTitles: { "chart-card": "Saved viewer chart title" },
      } } : null;
    return route.fulfill({ contentType: json ? "application/json" : "text/html", body: json ? JSON.stringify(json) : html });
  });
  await viewer.goto("https://card-image-fixture.chatgpt.site/", { waitUntil: "load" });
  await ready(viewer);
  assert.deepEqual(await viewer.evaluate(() => [...window.__imageTools.keys()]), names,
    "Hosted viewers receive image readers without query mutation tools");
  assert.equal(await viewer.getByRole("button", { name: "Edit text and layout", exact: true }).count(), 0);
  const viewerBefore = await readerState(viewer);
  const savedTitleImage = await invoke(viewer, names[1], { cardId: "chart-card" });
  assert.equal(savedTitleImage.title, "Saved viewer chart title", "Stable IDs survive saved title edits");
  const darkChart = await inspectPng(viewer, savedTitleImage, { bodySelector: ".recharts-wrapper" });
  assert.ok(lightChart.whole.brightness - darkChart.whole.brightness > 80,
    "The exported card retains the viewer's current dark surface and readable title/chart colors");
  assert.deepEqual(await readerState(viewer), viewerBefore, "Viewer export has no write, clipboard, download or navigation effects");
  assert.deepEqual(writes, []);
  assert.deepEqual(failures, []);
  console.log("Data app image tools: real chart/table/KPI/custom PNGs, exact IDs, current view, read-only viewer and dark-theme checks passed.");
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
