import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { installDashboardBrowserMocks, resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { verifySeriesVisibility } from "./data-app-browser-series-visibility.mjs";
import { stackedGeometryCharts, verifyStackedGeometry } from "./data-app-browser-stacked-geometry.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
const project = mkdtempSync(join(tmpdir(), "data-feature-coverage-smoke-"));
const trendRows = [10, 30, 20, 40].map((amount, step) => ({ step, amount }));
const charts = [
  ...stackedGeometryCharts,
  {
    id: "coverage-area",
    title: "Area trend",
    spec: { type: "area", x: "step", y: "amount", showValues: true, showLegend: false },
    rows: trendRows,
  },
  {
    id: "coverage-horizontal-stack-100",
    title: "Normalized horizontal stacks",
    spec: {
      type: "horizontalStackedBar100",
      x: "cohort",
      y: "core",
      fields: ["core", "addon"],
      showXAxisLabel: false,
      showYAxisLabel: false,
    },
    rows: [
      { cohort: "North", core: 10, addon: 30 },
      { cohort: "South", core: 60, addon: 20 },
    ],
  },
  {
    id: "coverage-histogram",
    title: "Latency distribution",
    spec: { type: "histogram", y: "latencyMs", showValues: true, showYAxisLabel: false },
    rows: [101, 105, 109, 111, 119, 121].map((latencyMs) => ({ latencyMs })),
  },
  {
    id: "coverage-sparkline",
    title: "ChartRenderer sparkline",
    spec: { type: "sparkline", x: "step", y: "amount", showValues: true, showLegend: false },
    rows: trendRows,
  },
  {
    id: "coverage-funnel",
    title: "Activation funnel",
    spec: { type: "funnel", x: "stage", y: "accounts", showLegend: false },
    rows: [
      { stage: "Visited", accounts: 100 },
      { stage: "Signed up", accounts: 60 },
      { stage: "Activated", accounts: 30 },
    ],
  },
  {
    id: "coverage-sankey",
    title: "Aggregated account flows",
    spec: { type: "sankey", source: "origin", target: "destination", y: "users", showLegend: false },
    rows: [
      { origin: "Signup", destination: "Activation", users: 5 },
      { origin: "Signup", destination: "Activation", users: 3 },
      { origin: "Signup", destination: "Churn", users: 2 },
    ],
  },
];
const tableScores = [10, 2, 18, 4, 16, 6, 14, 8, 12, 1, 17, 3, 15, 5, 13, 7, 11, 9];
const tableRows = tableScores.map((score) => ({
  account: `Account ${score}`,
  region: score % 2 === 0 ? "East" : "West",
  score,
}));

function closeTo(actual, expected, message, tolerance = 0.01) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

async function geometry(marks) {
  return marks.evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBBox();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }),
  );
}

let browser;
try {
  cpSync(template, project, {
    recursive: true,
    filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
  });
  const snapshot = JSON.parse(readFileSync(join(project, "src/data.json"), "utf8"));
  snapshot.title = "Synthetic feature-coverage dashboard";
  snapshot.filters = [];
  for (const { id, title, rows } of [...charts, { id: "coverage-table", title: "Account records", rows: tableRows }]) {
    snapshot.queries[id] = {
      rows,
      source: { label: `Synthetic browser fixture: ${title}`, sql: "-- deterministic regression fixture", tables: [] },
    };
  }
  writeFileSync(join(project, "src/data.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(
    join(project, "src/content/dashboard/DashboardContent.jsx"),
    `
import React from "react";
import { ChartRenderer, DataComponent, DataTable, useDataApp } from "../../data-app-public.jsx";

const charts = ${JSON.stringify(charts.map(({ id, title, spec }) => ({ id, title, spec })))};

export function DashboardContent() {
  const { reviewedRows } = useDataApp();
  const tableRows = reviewedRows("coverage-table");
  return <article className="feature-coverage-page">
    <div className="feature-coverage-grid">
      {charts.map(({ id, title, spec }) => {
        const rows = reviewedRows(id);
        return <DataComponent key={id} id={id} title={title} queryId={id} kind="chart"
          chart={spec} displayRows={rows} sourceRows={rows} className="feature-coverage-card">
          <ChartRenderer spec={spec} rows={rows} height={290} />
        </DataComponent>;
      })}
    </div>
    <DataComponent id="coverage-table" title="Account records" queryId="coverage-table" kind="table"
      displayRows={tableRows} sourceRows={tableRows} className="feature-coverage-card">
      <DataTable rows={tableRows} compactNumbers={false} columns={[
        { field: "account", label: "Account" },
        { field: "region", label: "Region" },
        { field: "score", label: "Score" },
      ]} />
    </DataComponent>
  </article>;
}
`,
  );
  writeFileSync(
    join(project, "src/content/dashboard/dashboard.css"),
    `
.feature-coverage-page { display: grid; gap: 20px; padding: 24px; }
.feature-coverage-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.feature-coverage-card { min-width: 0; padding: 20px; border: 1px solid var(--border);
  border-radius: var(--card-radius); background: var(--surface); }
@media (max-width: 650px) { .feature-coverage-grid { grid-template-columns: 1fr; } }
`,
  );

  const build = runDataAppFixtureBuild(project, { pluginRoot });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    locale: "en-US",
    colorScheme: "light",
  });
  const failures = [];
  const networkRequests = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route(/^https?:\/\//u, (route) => {
    networkRequests.push(route.request().url());
    return route.abort();
  });
  await installDashboardBrowserMocks(page);
  await page.goto(pathToFileURL(join(project, "dist/index.html")).href, { waitUntil: "load" });
  const component = (id) => page.locator(`[data-component-id="${id}"]`);

  const area = component("coverage-area");
  const areaFill = area.locator(".recharts-area-area");
  await areaFill.waitFor({ state: "visible" });
  assert.equal(await areaFill.count(), 1);
  assert.equal(await areaFill.getAttribute("fill-opacity"), "0.18");
  assert.equal(await area.locator(".recharts-area-curve").count(), 1);
  assert.equal(await area.locator(".recharts-area-curve").getAttribute("stroke-width"), "2");
  assert.equal(await area.locator(".recharts-line-curve").count(), 0, "Area must use its filled chart branch");
  const [areaBounds] = await geometry(areaFill);
  assert.ok(areaBounds.width > 0 && areaBounds.height > 0, "The area fill must have nonzero rendered geometry");
  assert.deepEqual(await area.locator(".recharts-label-list text").allTextContents(), ["10", "30", "20", "40"]);

  const normalized = component("coverage-horizontal-stack-100");
  const segments = await geometry(normalized.locator('g[data-stack-sign="positive"] > path[clip-path]'));
  assert.equal(segments.length, 4, "Each cohort must retain both positive stacked measures");
  const stackRows = [];
  for (const segment of segments.sort((left, right) => left.y - right.y || left.x - right.x)) {
    const row = stackRows.find((marks) => Math.abs(marks[0].y - segment.y) < 0.1);
    if (row) row.push(segment);
    else stackRows.push([segment]);
  }
  assert.equal(stackRows.length, 2);
  const totals = stackRows.map((row) => row.reduce((total, mark) => total + mark.width, 0));
  assert.ok(totals.every((total) => total > 0));
  closeTo(totals[0], totals[1], "Unequal raw cohort totals must occupy the same normalized width");
  for (const [index, row] of stackRows.entries()) {
    assert.equal(row.length, 2);
    closeTo(row[0].x + row[0].width, row[1].x, "Adjacent stack segments must meet");
    closeTo(row[0].width / totals[index], index === 0 ? 0.25 : 0.75, "Core share must be normalized per cohort");
    closeTo(row[1].width / totals[index], index === 0 ? 0.75 : 0.25, "Add-on share must be normalized per cohort");
  }
  const percentTicks = (
    await normalized.locator(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value").allTextContents()
  ).map((text) => text.replace(/\s+/gu, ""));
  assert.ok(
    percentTicks.includes("0%") && percentTicks.includes("100%"),
    `The normalized horizontal axis must display percentage endpoints: ${JSON.stringify(percentTicks)}`,
  );

  const histogram = component("coverage-histogram");
  const bins = (await geometry(histogram.locator(".recharts-bar-rectangle path"))).sort(
    (left, right) => left.x - right.x,
  );
  assert.equal(bins.length, 3);
  assert.deepEqual(
    await histogram.locator(".recharts-xAxis-tick-labels text[data-axis-layout] > title").allTextContents(),
    ["100–110", "110–120", "120–130"],
    "Raw latency rows must enter their expected automatic bins",
  );
  assert.deepEqual(await histogram.locator(".recharts-label-list text").allTextContents(), ["3", "2", "1"]);
  for (const [index, bin] of bins.entries()) {
    assert.ok(bin.width > 0 && bin.height > 0);
    closeTo(bin.width, bins[0].width, "Histogram bins must have equal widths");
    closeTo(bin.y + bin.height, bins[0].y + bins[0].height, "Histogram bars must share the zero baseline");
    closeTo(bin.height / bins[2].height, 3 - index, "Histogram height must encode the observed count");
  }

  const sparkline = component("coverage-sparkline");
  const sparklineCurve = sparkline.locator(".recharts-line-curve");
  assert.equal(await sparklineCurve.count(), 1);
  assert.equal(await sparklineCurve.getAttribute("stroke-width"), "2.25");
  const [sparklineBounds] = await geometry(sparklineCurve);
  assert.ok(sparklineBounds.width > 0 && sparklineBounds.height > 0);
  assert.deepEqual(await sparkline.locator(".recharts-label-list text").allTextContents(), ["10", "30", "20", "40"]);
  assert.equal(
    await sparkline
      .locator(".recharts-cartesian-axis, .recharts-cartesian-grid, .chart-axis-label, .recharts-area-area")
      .count(),
    0,
    "The ChartRenderer sparkline must omit axes, grids, and area fill",
  );

  const funnel = component("coverage-funnel");
  const funnelStages = funnel.getByRole("list", { name: "Funnel stages" }).getByRole("button");
  await funnelStages.first().waitFor({ state: "visible" });
  assert.deepEqual(
    await funnelStages.evaluateAll((stages) => stages.map((stage) => ({
      name: stage.querySelector(".chart-funnel-stage-name").textContent,
      value: stage.querySelector(".chart-funnel-stage-value").textContent,
      share: stage.querySelector(".chart-funnel-stage-share").textContent,
    }))),
    [
      { name: "Visited", value: "100", share: "100%" },
      { name: "Signed up", value: "60", share: "60%" },
      { name: "Activated", value: "30", share: "30%" },
    ],
    "Funnel stages must preserve reviewed order, counts, and share of the first stage",
  );
  const [ribbonBounds] = await geometry(funnel.locator(".chart-funnel-band"));
  assert.ok(ribbonBounds?.width > 0 && ribbonBounds.height > 0, "The funnel ribbon must render nonzero geometry");
  const stageBounds = await funnelStages.evaluateAll((stages) => stages.map((stage) => {
    const { x, width, height } = stage.getBoundingClientRect();
    return { x, width, height };
  }));
  for (const [index, bounds] of stageBounds.entries()) {
    assert.ok(bounds.width > 0 && bounds.height > 0);
    if (index) assert.ok(bounds.x >= stageBounds[index - 1].x + stageBounds[index - 1].width);
  }
  await funnelStages.nth(2).hover();
  const tooltip = funnel.locator(".chart-tooltip");
  await tooltip.waitFor({ state: "visible" });
  assert.equal(await tooltip.locator("strong").innerText(), "Activated");
  assert.match(await tooltip.innerText(), /Signed up → Activated/u);
  assert.match(await tooltip.innerText(), /Drop-off/u);
  assert.deepEqual(await tooltip.locator("b").allTextContents(), ["30", "50%", "−30"],
    "Hover must show the exact count, conversion from the previous stage (not 30% of total), and signed drop-off");
  await page.mouse.move(0, 0);

  const sankey = component("coverage-sankey");
  const nodes = await sankey.locator(".chart-sankey-node").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.querySelector("rect").getBBox();
      return { label: element.getAttribute("aria-label"), x: rect.x, height: rect.height, width: rect.width };
    }),
  );
  assert.equal(nodes.length, 3);
  assert.deepEqual(
    nodes.map(({ label }) => label).sort(),
    ["Activation, 8", "Churn, 2", "Signup, 10"],
    "Sankey must aggregate duplicate edges without losing or duplicating reviewed values",
  );
  const node = (name) => nodes.find(({ label }) => label.startsWith(`${name},`));
  for (const entry of nodes) {
    assert.equal(entry.width, 12);
    assert.ok(entry.height > 0);
  }
  assert.ok(node("Signup").x < node("Activation").x && node("Signup").x < node("Churn").x);
  closeTo(node("Activation").height / node("Churn").height, 4, "Sankey terminal heights must encode the 8:2 flow");
  const links = await sankey.locator("path.chart-sankey-link-visible").evaluateAll((elements) =>
    elements.map((element) => ({
      length: element.getTotalLength(),
      width: Number(element.getAttribute("stroke-width")),
    })),
  );
  assert.equal(links.length, 2, "Duplicate reviewed edges must become one weighted Sankey link");
  assert.ok(links.every(({ length, width }) => length > 0 && width > 0));

  const table = component("coverage-table");
  const previous = table.getByRole("button", { name: "Previous page" });
  const next = table.getByRole("button", { name: "Next page" });
  const search = table.getByRole("textbox", { name: "Search data" });
  const results = table.locator('.table-pagination [aria-live="polite"]');
  async function assertRows(scores, label) {
    const rendered = await table
      .locator("tbody tr")
      .evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent.trim())));
    assert.deepEqual(
      rendered,
      scores.map((score) => [`Account ${score}`, score % 2 === 0 ? "East" : "West", String(score)]),
      label,
    );
  }
  async function assertPage(number, count) {
    assert.equal(
      await table.locator(".table-pagination .source-value").filter({ hasText: /^Page /u }).innerText(),
      `Page ${number} of ${count}`,
    );
    assert.equal(await previous.isDisabled(), number === 1);
    assert.equal(await next.isDisabled(), number === count);
  }
  await assertRows(tableScores.slice(0, 8), "First page must preserve supplied row order");
  await assertPage(1, 3);
  await next.click();
  await assertRows(tableScores.slice(8, 16), "Next page must reveal the next eight exact records");
  await assertPage(2, 3);
  await next.click();
  await assertRows(tableScores.slice(16), "Final page must retain the two remaining records");
  await assertPage(3, 3);
  await previous.click();
  await assertRows(tableScores.slice(8, 16), "Previous page must return to the same records");
  await previous.click();
  await table.getByRole("button", { name: "Score", exact: true }).click();
  await assertRows([1, 2, 3, 4, 5, 6, 7, 8], "Numeric ascending sort must place 2 before 10");
  await next.click();
  await assertRows([9, 10, 11, 12, 13, 14, 15, 16], "Sorting must happen across all rows before pagination");
  await previous.click();
  await table.getByRole("button", { name: "Score ↑", exact: true }).click();
  await assertRows([18, 17, 16, 15, 14, 13, 12, 11], "The second header click must sort descending");
  assert.equal(await table.getByRole("button", { name: "Score ↓", exact: true }).count(), 1);
  await next.click();
  await search.fill("eAsT");
  await assertRows([18, 16, 14, 12, 10, 8, 6, 4], "Case-insensitive search must retain the active sort");
  await assertPage(1, 2);
  assert.equal(await results.innerText(), "1–8 of 9 results");
  await next.click();
  await assertRows([2], "Filtered pagination must include the final matching record");
  await assertPage(2, 2);
  await search.fill("aCcOuNt 1");
  await assertRows([18, 17, 16, 15, 14, 13, 12, 11], "Search must match the displayed account field");
  await assertPage(1, 2);
  assert.equal(await results.innerText(), "1–8 of 10 results");
  await next.click();
  await assertRows([10, 1], "Substring matches must not lose the exact Account 1 record");
  await search.fill("missing-synthetic-account");
  await assertRows([], "A search with no matches must not display stale rows");
  assert.equal(await results.innerText(), "No results");
  assert.equal(await previous.count(), 0);
  assert.equal(await next.count(), 0);
  await search.fill("");
  await assertRows([18, 17, 16, 15, 14, 13, 12, 11], "Clearing search must restore all rows and keep descending sort");
  await assertPage(1, 3);
  await table.getByRole("button", { name: "Account", exact: true }).click();
  await assertRows([1, 2, 3, 4, 5, 6, 7, 8], "Changing columns must begin with natural ascending text order");

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Switch theme" }).click();
  const picker = page.getByRole("region", { name: "Theme picker" });
  await picker.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("menuitemradio", { name: "Light", exact: true }).click();
  await picker.getByRole("button", { name: "Apply Sticker pop", exact: true }).click();
  await page.waitForFunction(() => Object.values(localStorage).some((value) => {
    try {
      const presentation = JSON.parse(value)?.presentation;
      return presentation?.theme === "sticker-pop" && presentation.appearance === "light";
    } catch { return false; }
  }));
  async function assertStickerPop() {
    const state = await area.evaluate((card) => ({
      theme: document.documentElement.dataset.appTheme,
      background: getComputedStyle(document.body).backgroundColor,
      font: getComputedStyle(document.body).fontFamily,
      radius: getComputedStyle(card).borderTopLeftRadius,
      chartStroke: getComputedStyle(card.querySelector(".recharts-area-curve")).stroke,
      accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    }));
    assert.equal(state.theme, "sticker-pop");
    assert.equal(state.background, "rgb(255, 248, 252)");
    assert.match(state.font, /ui-rounded/u);
    assert.equal(state.radius, "24px");
    assert.equal(state.chartStroke, "rgb(255, 94, 168)");
    assert.equal(state.accent, "#7450ff");
  }
  await assertStickerPop();
  await page.reload({ waitUntil: "load" });
  await areaFill.waitFor({ state: "visible" });
  await assertStickerPop();
  assert.deepEqual(networkRequests, [], "The standalone feature fixture must not download browser dependencies");
  assert.deepEqual(failures, []);
  await verifySeriesVisibility({ browser, pluginRoot });
  await verifyStackedGeometry({ browser, url: pathToFileURL(join(project, "dist/index.html")).href });
  console.log(
    JSON.stringify({
      ok: true,
      chartTypes: charts.map(({ spec }) => spec.type),
      normalizedCohortTotals: [40, 80],
      histogramCounts: [3, 2, 1],
      sankeyAggregatedEdges: links.length,
      tableRows: tableRows.length,
      tablePages: 3,
      tableActions: [
        "next",
        "previous",
        "numeric ascending",
        "numeric descending",
        "text ascending",
        "case-insensitive search",
        "empty search",
        "clear search",
      ],
      theme: "sticker-pop",
      themePersistedAfterReload: true,
      customerBuild: "prebuilt-no-package-manager",
      networkRequests: networkRequests.length,
    }),
  );
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
