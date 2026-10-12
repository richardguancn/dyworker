import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { installDashboardBrowserMocks, resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
const project = mkdtempSync(join(tmpdir(), "data-ranked-list-smoke-"));
cpSync(template, project, {
  recursive: true,
  filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
});
writeFileSync(join(project, "src/content/dashboard/DashboardContent.jsx"), `
import React, { useState } from "react";

import { ChartRenderer, DataComponent, EvidenceChart, useDataApp } from "../../data-app-public.jsx";

function Comparison({ id, title, rows, spec, tall = false, visibleSeries }) {
  const { chartOverrides, chartProps } = useDataApp();
  const chart = { ...spec, ...(chartOverrides[id] ?? {}) };
  const interactions = chartProps(id);
  return <DataComponent id={id} title={title} queryId="feature_movement" kind="chart" chart={chart}
    displayRows={rows} sourceRows={rows} className="dashboard-panel ranking-smoke-card">
    <ChartRenderer spec={chart} rows={rows} height={tall ? 410 : 220} {...interactions}
      visibleSeries={visibleSeries ?? interactions.visibleSeries} />
  </DataComponent>;
}

function DynamicReviewedPie({ rows }) {
  const [expanded, setExpanded] = useState(false);
  return <section>
    <button type="button" onClick={() => setExpanded((current) => !current)}>
      {expanded ? "Reduce reviewed plan categories" : "Expand reviewed plan categories"}
    </button>
    <Comparison id="dynamic-reviewed-pie" title="Dynamic reviewed plans" rows={expanded ? rows : rows.slice(0, 7)}
      spec={{ type: "pie", x: "plan", y: "users", groupOther: true }} />
  </section>;
}

export function DashboardContent() {
  const { reviewedRows } = useDataApp();
  const summary = reviewedRows("usage_summary").at(-1);
  const rows = reviewedRows("feature_movement", ["feature"])
    .filter((row) => row.week === summary?.week)
    .map((row, index) => ({ ...row, targetUsers: row.activeUsers + 50, change: index ? index * 10 : -15 }));
  const ranking = { x: "feature", y: "activeUsers" };
  const plans = rows.map((row) => ({ plan: row.feature, users: row.activeUsers }));
  const products = Array.from({ length: 20 }, (_, index) => ({
    product: "Long reviewed product category " + (index + 1), users: 100 - index,
  }));
  const codes = Array.from({ length: 20 }, (_, index) => ({ code: String.fromCharCode(65 + index), count: index + 1 }));
  const reviewedPlans = ["Plus", "Pro", "Team", "Free", "Business", "Enterprise", "Education", "Education Pro"]
    .map((plan, index) => ({ plan, users: (8 - index) * 10 }));

  return <article className="page ranking-smoke-page">
    <section className="ranking-smoke-pair">
      <Comparison id="adaptive-ranking" title="Adaptive leaderboard" rows={rows}
        spec={{ ...ranking, type: "rankedList" }} />
      <Comparison id="tall-neighbor" title="Taller comparison" rows={rows} tall
        spec={{ ...ranking, type: "bar" }} />
    </section>
    <section className="ranking-smoke-grid">
      <Comparison id="baseline-ranking" title="Baseline leaderboard" rows={rows}
        spec={{ ...ranking, type: "rankedList", colors: {
          Projects: "var(--chart-2)", Canvas: "var(--chart-3)",
        } }} />
      <Comparison id="legacy-leaderboard" title="Legacy leaderboard" rows={rows}
        spec={{ ...ranking, type: "leaderboard" }} />
      <Comparison id="horizontal-comparison" title="Horizontal comparison" rows={rows}
        spec={{ ...ranking, type: "horizontalBar" }} />
      <Comparison id="signed-comparison" title="Signed comparison" rows={rows}
        spec={{ ...ranking, type: "horizontalBar", y: "change" }} />
      <Comparison id="multiple-measures" title="Multiple measures" rows={rows}
        spec={{ ...ranking, type: "horizontalBar", fields: ["activeUsers", "targetUsers"] }} />
      <Comparison id="explicit-bars" title="Explicit bar chart" rows={rows}
        spec={{ ...ranking, type: "horizontalBar" }} />
      <Comparison id="axis-bars" title="Axis comparison" rows={rows}
        spec={{ ...ranking, type: "horizontalBar", xLabel: "Active accounts" }} />
      <Comparison id="unsafe-product-pie" title="Potentially overlapping product audiences" rows={products}
        spec={{ type: "pie", x: "product", y: "users" }} />
      <Comparison id="reviewed-plan-pie" title="Reviewed exclusive account plans" rows={plans}
        spec={{ type: "pie", x: "plan", y: "users", groupOther: true }} />
      <Comparison id="filtered-reviewed-plan-pie" title="Filtered reviewed account plans" rows={reviewedPlans}
        visibleSeries={reviewedPlans.filter((row) => row.plan !== "Education").map((row) => row.plan)}
        spec={{ type: "pie", x: "plan", y: "users", groupOther: true, showValues: true }} />
      <Comparison id="short-category-bars" title="Every reviewed category code" rows={codes}
        spec={{ type: "bar", x: "code", y: "count" }} />
      <Comparison id="spelled-horizontal-bars" title="Channel comparison" rows={[
        { channel: "Customer Story", count: 270 }, { channel: "Paid Search", count: 300 },
        { channel: "Paid Social", count: 180 }, { channel: "Partner Event", count: 360 },
      ]} spec={{ type: "horizontal-bar", x: "channel", y: "count" }} />
      <EvidenceChart id="signed-rate-comparison" queryId="feature_movement" title="Weekly growth comparison"
        variant="card" rows={[
          { feature: "A", previousGrowthRate: .174, currentGrowthRate: -.024 },
          { feature: "B", previousGrowthRate: .04, currentGrowthRate: .11 },
        ]} spec={{ type: "horizontalBar", x: "feature", y: "currentGrowthRate",
          fields: ["previousGrowthRate", "currentGrowthRate"], showLegend: false }} height={220}>
        <div data-detail-reading>Supporting reading</div>
      </EvidenceChart>
      <DynamicReviewedPie rows={plans} />
    </section>
  </article>;
}
`);
writeFileSync(join(project, "src/content/dashboard/dashboard.css"), `
.ranking-smoke-page { display: grid; gap: 20px; padding: 24px; }
.ranking-smoke-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.ranking-smoke-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; }
.ranking-smoke-card { min-width: 0; padding: 20px; border: 1px solid var(--border); border-radius: var(--card-radius); }
.ranking-smoke-grid > .ranking-smoke-card { align-self: start; }
@media (max-width: 600px) { .ranking-smoke-pair, .ranking-smoke-grid { grid-template-columns: 1fr; } }
`);

let browser;
try {
  const build = runDataAppFixtureBuild(project, { pluginRoot });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await installDashboardBrowserMocks(page);
  await page.goto(pathToFileURL(join(project, "dist/index.html")).href, { waitUntil: "load" });
  for (const viewport of [{ width: 1440, height: 1100 }, { width: 640, height: 1000 }]) {
    await page.setViewportSize(viewport);
    const channels = page.locator('[data-component-id="spelled-horizontal-bars"]');
    await channels.locator('.recharts-bar-rectangle').first().waitFor();
    assert.equal(await channels.locator('.recharts-yAxis-tick-labels text').count(), 4,
      "The horizontal spelling retains all four channel labels, including at narrow widths");
    const growth = page.locator('[data-component-id="signed-rate-comparison"]');
    await growth.locator('.recharts-bar-rectangle').first().waitFor();
    assert.equal(await growth.locator('.recharts-xAxis').count(), 1, "Compared growth rates share a single numeric axis");
    const ticks = await growth.locator('.recharts-xAxis-tick-labels text').allTextContents();
    assert.ok(ticks.length > 1 && ticks.every(tick => tick.includes('%')), `Negative growth keeps percentage ticks: ${JSON.stringify(ticks)}`);
    const gap = await growth.evaluate(element => element.querySelector('[data-detail-reading]').getBoundingClientRect().top
      - element.querySelector('.chart-layout').getBoundingClientRect().bottom);
    assert.ok(gap >= 15, "Supporting readings have breathing room below the plot and its axis labels");
    const bars = await growth.locator('.recharts-bar-rectangle').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width };
    }));
    assert.equal(bars.length, 4);
    assert.ok(Math.abs(bars[0].left - bars[2].right) < 2, "Positive and negative comparison bars meet the same zero");
    assert.ok(Math.abs(bars[0].width / bars[2].width - .174 / .024) < .1,
      "Bar lengths encode the compared rates on the same scale");
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  const baseline = page.locator('[data-component-id="baseline-ranking"]');
  await baseline.getByRole("button", { name: "Baseline leaderboard actions" }).click();
  const baselineMenu = page.getByRole("menu", { name: "Baseline leaderboard actions" });
  assert.equal(
    await baselineMenu.getByRole("menuitem", { name: "Download PNG" }).count(),
    0,
    "Chart components without a renderable image should not offer a PNG download",
  );
  assert.equal(
    await baselineMenu.getByRole("menuitem", { name: "Copy as image" }).count(),
    0,
    "Chart components without a renderable image should not offer image copying",
  );
  assert.equal(await baselineMenu.getByRole("menuitem", { name: "Export chart" }).count(), 0,
    "HTML-only charts should not open the SVG/canvas export dialog");
  await page.keyboard.press("Escape");
  const baselineRows = baseline.locator(".chart-ranked-list-row");
  assert.equal(await baselineRows.count(), 5, "Standalone leaderboards should default to five reviewed rows");
  const categoryFills = await baseline.locator(".chart-ranked-list-fill").evaluateAll((fills) =>
    fills.slice(0, 2).map((fill) => getComputedStyle(fill).backgroundColor));
  assert.notEqual(categoryFills[0], categoryFills[1],
    "Explicit reviewed category colors should produce matching distinct leaderboard tints");
  const adaptiveFills = page.locator('[data-component-id="adaptive-ranking"] .chart-ranked-list-fill');
  const defaultColors = await adaptiveFills.evaluateAll((fills) =>
    fills.slice(0, 5).map((fill) => getComputedStyle(fill).backgroundColor));
  assert.equal(new Set(defaultColors).size, 1,
    "Leaderboards should use one restrained theme-aware fill unless category colors are explicitly authored");
  const themedFill = adaptiveFills.first();
  const originalFill = await themedFill.evaluate((fill) => getComputedStyle(fill).backgroundColor);
  assert.equal(await themedFill.evaluate((fill) => fill.style.getPropertyValue("--ranked-list-fill")), "",
    "Default leaderboard fills should inherit their theme token without inventing per-category colors");
  const paletteToken = "chart-1";
  await page.evaluate((token) => {
    const root = document.documentElement;
    root.dataset.previousChartColor = root.style.getPropertyValue(`--${token}`);
    root.style.setProperty(`--${token}`, "rgb(255, 35, 140)");
  }, paletteToken);
  assert.notEqual(await themedFill.evaluate((fill) => getComputedStyle(fill).backgroundColor), originalFill,
    "Leaderboard fills should respond immediately when the active dashboard theme changes");
  await page.evaluate((token) => {
    const root = document.documentElement;
    if (root.dataset.previousChartColor) root.style.setProperty(`--${token}`, root.dataset.previousChartColor);
    else root.style.removeProperty(`--${token}`);
    delete root.dataset.previousChartColor;
  }, paletteToken);
  await baseline.getByRole("button", { name: "Show 7 more" }).click();
  assert.equal(await baselineRows.count(), 12, "Disclosure should reveal every additional reviewed category");
  await baseline.getByRole("button", { name: "Show fewer" }).click();
  assert.equal(await baselineRows.count(), 5, "Collapsing a standalone leaderboard should restore five rows");

  const adaptive = page.locator('[data-component-id="adaptive-ranking"]');
  const adaptiveRows = adaptive.locator(".chart-ranked-list-row");
  await page.waitForFunction(() =>
    document.querySelectorAll('[data-component-id="adaptive-ranking"] .chart-ranked-list-row').length > 5);
  const adaptiveCount = await adaptiveRows.count();
  assert.ok(adaptiveCount > 5 && adaptiveCount <= 12,
    `A taller adjacent chart should expose additional reviewed rows, received ${adaptiveCount}`);
  const bounds = await adaptive.evaluate((card) => ({
    card: card.getBoundingClientRect().bottom,
    content: (card.querySelector(".chart-ranked-list-toggle") ?? card.querySelector(".chart-ranked-list"))
      .getBoundingClientRect().bottom,
  }));
  assert.ok(bounds.content <= bounds.card + 1,
    `Adaptive rows and disclosure must remain inside their panel: ${JSON.stringify(bounds)}`);
  if (adaptiveCount < 12) {
    assert.equal(await adaptive.getByRole("button", { name: `Show ${12 - adaptiveCount} more` }).count(), 1,
      "Additional categories beyond the available card height must remain expandable");
  }
  await page.setViewportSize({ width: 540, height: 1100 });
  await page.waitForFunction(() =>
    document.querySelectorAll('[data-component-id="adaptive-ranking"] .chart-ranked-list-row').length === 5);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.waitForFunction(() =>
    document.querySelectorAll('[data-component-id="adaptive-ranking"] .chart-ranked-list-row').length > 5);

  for (const id of ["legacy-leaderboard"]) {
    const chart = page.locator(`[data-component-id="${id}"]`);
    assert.equal(await chart.locator(".chart-ranked-list-row").count(), 5,
      `${id} should resolve safe simple rankings to the compact leaderboard`);
  }
  for (const id of ["horizontal-comparison", "signed-comparison", "multiple-measures", "explicit-bars", "axis-bars"]) {
    const chart = page.locator(`[data-component-id="${id}"]`);
    assert.equal(await chart.locator(".chart-ranked-list").count(), 0,
      `${id} should preserve comparisons that genuinely need a bar chart`);
    assert.ok(await chart.locator(".recharts-surface").count(), `${id} should render a real bar-chart surface`);
  }

  const overlappingPie = page.locator('[data-component-id="unsafe-product-pie"]');
  assert.equal(await overlappingPie.locator(".chart-legend-button").count(), 20,
    "Unverified product audiences must remain separate rather than silently becoming Other");
  const overflowingLegend = overlappingPie.locator(".chart-legend");
  const expandLegend = overlappingPie.getByRole("button", { name: "Show all 20 categories" });
  await expandLegend.waitFor({ state: "visible" });
  await overflowingLegend.evaluate((legend) => { legend.scrollTop = legend.scrollHeight; });
  assert.equal(await expandLegend.isVisible(), true,
    "Scrolling to the end of a collapsed legend must not remove its expansion control");

  const reviewedPie = page.locator('[data-component-id="reviewed-plan-pie"]');
  assert.equal(await reviewedPie.locator(".chart-legend-button").count(), 7,
    "Explicitly reviewed mutually exclusive plans should retain six leaders plus Other");
  await reviewedPie.getByRole("button", { name: "Toggle Other" }).waitFor();

  const filteredPie = page.locator('[data-component-id="filtered-reviewed-plan-pie"]');
  const reviewedSliceValues = await filteredPie.locator(".recharts-label-list text")
    .evaluateAll((labels) => labels.map((label) => label.textContent.trim()));
  assert.equal(reviewedSliceValues.at(-1), "10",
    "The visible Other slice must exclude the hidden Education category instead of displaying its unfiltered total");

  const categoryBars = page.locator('[data-component-id="short-category-bars"]');
  assert.equal(await categoryBars.locator('[data-axis-layout]').count(), 20,
    "Every reviewed short categorical bar label must remain visible even when densely spaced");

  const dynamicPie = page.locator('[data-component-id="dynamic-reviewed-pie"]');
  const originalPlanToggle = dynamicPie.getByRole("button", { name: /^Toggle /u }).first();
  await originalPlanToggle.click();
  await page.getByRole("button", { name: "Expand reviewed plan categories" }).click();
  const groupedOther = dynamicPie.getByRole("button", { name: "Toggle Other" });
  assert.equal(await groupedOther.getAttribute("aria-pressed"), "true",
    "A newly grouped Other slice should inherit visibility from its reviewed constituent categories");
  await groupedOther.click();
  await page.getByRole("button", { name: "Reduce reviewed plan categories" }).click();
  assert.equal(await dynamicPie.getByRole("button", { name: /^Toggle /u }).nth(6).getAttribute("aria-pressed"), "false",
    "Hiding Other must preserve the hidden state of its source categories after grouping disappears");
  await page.getByRole("button", { name: "Expand reviewed plan categories" }).click();
  assert.equal(await groupedOther.getAttribute("aria-pressed"), "false",
    "Previously hidden source categories must remain hidden when Other becomes available again");
  await groupedOther.click();
  await page.getByRole("button", { name: "Reduce reviewed plan categories" }).click();
  assert.equal(await dynamicPie.getByRole("button", { name: /^Toggle /u }).nth(6).getAttribute("aria-pressed"), "true",
    "Showing Other must restore its source categories when the chart becomes ungrouped");
  await page.getByRole("button", { name: "Expand reviewed plan categories" }).click();
  await groupedOther.press("Shift+Enter");
  await page.getByRole("button", { name: "Reduce reviewed plan categories" }).click();
  const isolatedPlans = await dynamicPie.getByRole("button", { name: /^Toggle /u })
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-pressed")));
  assert.deepEqual(isolatedPlans, ["false", "false", "false", "false", "false", "false", "true"],
    "Isolating Other must persist the identities of its underlying reviewed categories");

  const horizontal = page.locator('[data-component-id="horizontal-comparison"]');
  await horizontal.getByRole("button", { name: "Horizontal comparison actions" }).click();
  await page.getByRole("menuitem", { name: "Edit chart" }).click();
  const editor = page.getByRole("dialog", { name: "Horizontal comparison" });
  const chartType = editor.getByRole("button", { name: "Chart type", exact: true });
  assert.equal((await chartType.innerText()).trim(), "Horizontal bar",
    "The chart editor should preserve the explicitly authored chart type");
  await editor.getByRole("button", { name: "Sort order" }).click();
  await page.getByRole("menuitemradio", { name: "Ascending", exact: true }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  const storedRanking = await page.evaluate(() => Object.values(localStorage)
    .map((value) => JSON.parse(value)).map((record) => record.presentation?.chartOverrides?.["horizontal-comparison"])
    .find(Boolean));
  assert.equal(storedRanking?.type, "horizontalBar",
    "Unrelated chart edits must preserve the authored horizontal-bar type");
  await horizontal.getByRole("button", { name: "Horizontal comparison actions" }).click();
  await page.getByRole("menuitem", { name: "Edit chart" }).click();
  await editor.waitFor();
  await chartType.click();
  assert.equal(await page.getByRole("menuitemradio", { name: "Leaderboard", exact: true }).count(), 1,
    "The chart editor should present one canonical leaderboard choice");
  assert.equal(await page.getByRole("menuitemradio", { name: "Ranked list", exact: true }).count(), 0,
    "The chart editor should not expose a second competing leaderboard label");
  await page.getByRole("menuitemradio", { name: "Horizontal bar", exact: true }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(await horizontal.locator(".chart-ranked-list").count(), 0,
    "An explicitly selected horizontal bar should opt out of automatic ranking conversion");
  assert.ok(await horizontal.locator(".recharts-surface").count(),
    "The explicit horizontal-bar editor choice should render as a chart");

  assert.deepEqual(failures, [], "Leaderboard rendering should not emit browser runtime errors");
  process.stdout.write(`Ranked-list browser smoke passed: five baseline rows, ${adaptiveCount} adaptive rows.\n`);
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
