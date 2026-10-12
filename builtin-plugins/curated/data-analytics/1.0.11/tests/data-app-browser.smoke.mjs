import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { componentPermalinkId, componentPermalinkShortId } from "../templates/data-app/base/src/chart-permalink.js";
import {
  installPublishedDashboardActionMocks,
  verifyCodexEditorDashboardActions,
  verifyLocalDashboardHandoffs,
  verifyPublishedDashboardActions,
  verifyPublishedViewerHandoffs,
  verifyWidgetPermalinkPdfExport,
} from "./data-app-browser-exports.mjs";
import { installDashboardBrowserMocks, resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { chooseHostedHandoff } from "./data-app-browser-handoff.mjs";
import { verifyDashboardComposition, verifyDashboardFilterMenuGeometry, verifyDashboardPolish, verifyTemporalAxisGeometry } from "./data-app-browser-dashboard-composition.mjs";
import { createAuthoredPublishedFixtureBuilder, replaceUniqueAuthoredExpression, withAuthoredFixturePages } from "./data-app-browser-fixtures.mjs";
import { verifyDashboardChartColors } from "./data-app-browser-colors.mjs";
import { verifyAskChatGPTSelectionContext } from "./data-app-browser-ask-chatgpt.mjs";
import { verifyDashboardInlineEditing } from "./data-app-browser-inline-editing.mjs";
import { verifyHostedTextEditing } from "./data-app-browser-text-editing.mjs";
import { verifyDashboardVerificationReminder } from "./data-app-browser-verification-reminder.mjs";
import {
  verifyChartOverridePrecedence,
  verifyChartPngDownload,
  verifyDashboardChartInteractions,
} from "./data-app-browser-chart-interactions.mjs";

function completeViewUrl(value) {
  const url = new URL(value);
  const tab = url.searchParams.get("tab") ?? "dashboard";
  url.searchParams.delete("view");
  url.searchParams.delete("tab");
  url.searchParams.set("view", "1");
  url.searchParams.set("tab", tab);
  return url.href;
}

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
const project = mkdtempSync(join(tmpdir(), "data-dashboard-smoke-"));
const originatingThreadId = "550e8400-e29b-41d4-a716-446655440000";
cpSync(template, project, {
  recursive: true,
  filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
});
const build = runDataAppFixtureBuild(project, {
  pluginRoot,
  env: {
    ...process.env,
    CODEX_SESSION_ID: originatingThreadId,
    CODEX_THREAD_ID: originatingThreadId,
  },
});
assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
const dataAppPath = join(project, "dist/index.html");
const localHtml = readFileSync(dataAppPath, "utf8");
const localThreadMetadata = new RegExp(`<meta name="data-app-local-thread" content="${originatingThreadId}">\\s*`, "u");
assert.ok(
  localThreadMetadata.test(localHtml),
  "The local dashboard build must capture its originating Codex task in transient HTML metadata",
);
const sensitivePreviewPattern = new RegExp(`secret|private-section|codexThreadId|${originatingThreadId}`, "u");
const dataAppSnapshot = JSON.parse(readFileSync(resolve(pluginRoot, "templates/data-app/base/src/data.json"), "utf8"));

const buildAuthoredPublishedFixture = createAuthoredPublishedFixtureBuilder({
  template, pluginRoot, originatingThreadId, localThreadMetadata,
});

const screenshots = mkdtempSync(join(tmpdir(), "data-app-"));
const browser = await chromium.launch({
  executablePath: resolveChromiumExecutable(),
  headless: true,
  ignoreDefaultArgs: ['--hide-scrollbars'],
});
const failures = [];

async function settleSelectionUi(page) {
  await page.evaluate(
    () =>
      new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
      }),
  );
}

async function waitForDashboardTitle(page) {
  const title = page.locator(".dashboard-topbar-title");
  await title.waitFor().catch(async error => {
    throw new Error(`${error.message}\nBrowser errors: ${JSON.stringify(failures)}\nPage: ${(await page.locator("body").innerText()).slice(0, 1500)}`);
  });
  assert.equal((await title.innerText()).trim(), dataAppSnapshot.title);
}


try {
  const page = await browser.newPage({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1050 },
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await installDashboardBrowserMocks(page);
  await page.goto(pathToFileURL(dataAppPath).href, { waitUntil: "load" });
  assert.equal(new URL(page.url()).hash, "", "Local dashboard previews must not require task URL fragments");
  assert.equal(await page.locator('meta[name="data-app-local-thread"]').getAttribute("content"), originatingThreadId);
  await waitForDashboardTitle(page);
  await verifyDashboardChartColors({ browser, failures, dataAppPath, waitForDashboardTitle });
  for (const width of [1440,820,760,390]) {
    await page.setViewportSize({width,height:1050});
    await verifyTemporalAxisGeometry(page, [...new Set(dataAppSnapshot.queries.usage_summary.rows.map(row=>Date.parse(row.week)))]);
  }
  await page.setViewportSize({width:1440,height:1050});
  await settleSelectionUi(page);
  assert.equal(
    await page.getByRole("button", { name: "Mark dashboard as verified" }).count(),
    0,
    "Unpublished dashboards must not offer verification without an authenticated dashboard creator",
  );
  await verifyDashboardFilterMenuGeometry({ browser, failures, dataAppPath, settleSelectionUi });
  const { dashboardContentTitles, initialDashboardTitles } = await verifyDashboardComposition({
    page,
    failures,
    screenshots,
  });
  const trend = page.locator('[data-component-id="usage-trend"]');
  await trend.getByRole("button", { name: "Active accounts over time actions" }).click();
  assert.equal(
    await page.getByRole("menuitem", { name: "Copy link", exact: true }).count(),
    0,
    "Unpublished dashboard charts must not offer links that cannot be shared",
  );
  assert.equal(
    await page.getByRole("menuitem", { name: "Copy chart link" }).count(),
    0,
    "Unpublished dashboard charts must not expose an obsolete specialized share label",
  );
  assert.equal(
    await page.getByRole("menuitem", { name: "Copy widget link" }).count(),
    0,
    "Unpublished dashboard charts must not expose an obsolete generic share label",
  );
  assert.equal(
    await page.getByRole("menuitem", { name: "Copy chart detail link" }).count(),
    0,
    "Unpublished dashboard charts must not offer detail links that cannot be shared",
  );
  await page.keyboard.press("Escape");
  const legend = trend.getByRole("button", { name: "Toggle Active Users" });
  assert.equal(await legend.getAttribute("aria-pressed"), "true");
  await legend.click();
  assert.equal(await legend.getAttribute("aria-pressed"), "false");
  await legend.click();

  const inlineDriverChart = page.locator('[data-component-id="growth-drivers"]');
  const scopedEvidence = page.locator('[data-component-id="usage-details"]');
  const scopedProduct = page.getByRole("region", { name: "Account health filters", exact: true }).getByRole("button", { name: "Product" });
  assert.deepEqual(
    await scopedProduct.evaluate((control) => ({
      section: control.closest("[data-sortable-row]")?.dataset.sortableRow,
      inGlobalFilters: Boolean(control.closest(".filter-bar")),
    })),
    { section: "dashboard:evidence", inGlobalFilters: false },
    "A table-only filter must stay beside its affected component instead of joining the page-wide filter bar",
  );
  const headlineBeforeLocalFilter = await page.locator('[data-component-id="active-users"] .metric-value').innerText();
  const trendBeforeLocalFilter = await trend
    .locator(".recharts-line-curve")
    .evaluateAll((marks) => marks.map((mark) => mark.getAttribute("d")));
  await scopedProduct.click();
  await page.getByRole("menuitemradio", { name: "Studio" }).click();
  assert.equal(
    await page.locator('[data-component-id="active-users"] .metric-value').innerText(),
    headlineBeforeLocalFilter,
    "Component-local filters must not change unrelated headline metrics",
  );
  assert.deepEqual(
    await trend.locator(".recharts-line-curve").evaluateAll((marks) => marks.map((mark) => mark.getAttribute("d"))),
    trendBeforeLocalFilter,
    "Component-local filters must not change the unrelated primary trend",
  );
  await scopedEvidence.getByRole("button", { name: "Reviewed account-level evidence actions" }).click();
  await page.getByRole("menuitem", { name: "View data source" }).click();
  const scopedSource = page.getByRole("complementary", { name: "Data source for Reviewed account-level evidence" });
  await scopedSource.getByRole("tab", { name: "Data preview" }).click();
  assert.equal(
    await scopedSource.getByRole("cell", { name: "Studio", exact: true }).count(),
    await scopedSource.locator("tbody tr").count(),
    "A component-local filter must update its reviewed source preview without affecting page-wide components",
  );
  await scopedSource.getByRole("button", { name: "Close data source" }).click();
  await scopedProduct.click();
  await page.getByRole("menuitemradio", { name: "All" }).click();
  assert.equal(
    await inlineDriverChart.getByRole("button", { name: "Product" }).count(),
    0,
    "The weekly-change visualization should not duplicate dashboard or table product filters",
  );
  await page.getByRole("button", { name: "Product segment" }).click();
  await page.getByRole("menuitemradio", { name: "Search" }).click();
  assert.ok(
    await inlineDriverChart.locator(".recharts-bar-rectangle").count(),
    "The growth-driver chart should continue to reflect the selected global product scope",
  );
  await page.getByRole("button", { name: "Product segment" }).click();
  await page.getByRole("menuitemradio", { name: "All" }).click();

  await page.getByRole("button", { name: "Product segment" }).click();
  const checked = page.getByRole("menuitemradio", { name: "All" });
  const checkAlignment = await checked.evaluate((item) => {
    const check = item.querySelector(".menu-check").getBoundingClientRect();
    const bounds = item.getBoundingClientRect();
    return bounds.right - check.right;
  });
  assert.ok(checkAlignment < 20, `Filter checkmark is not right aligned: ${checkAlignment}px`);
  const headlineBeforeGlobalFilter = await page.locator('[data-component-id="active-users"] .metric-value').innerText();
  const trendBeforeGlobalFilter = await trend
    .locator(".recharts-line-curve")
    .evaluateAll((marks) => marks.map((mark) => mark.getAttribute("d")));
  await page.getByRole("menuitemradio", { name: "Studio" }).click();
  assert.match(await page.locator('[data-component-id="active-users"] .metric-value').innerText(), /5\.4K/);
  assert.notEqual(
    await page.locator('[data-component-id="active-users"] .metric-value').innerText(),
    headlineBeforeGlobalFilter,
    "Page-wide filters must update the primary headline metric",
  );
  assert.notDeepEqual(
    await trend.locator(".recharts-line-curve").evaluateAll((marks) => marks.map((mark) => mark.getAttribute("d"))),
    trendBeforeGlobalFilter,
    "Page-wide filters must update the primary trend as well as the headline metric",
  );
  assert.deepEqual(
    await dashboardContentTitles.allInnerTexts(),
    initialDashboardTitles,
    "Changing filters must update source-backed values without rewriting authored dashboard or chart headings",
  );
  assert.ok(await page.getByRole("button", { name: "Clear all" }).count());

  const activeUsers = page.locator('[data-component-id="active-users"]');
  await activeUsers.getByRole("button", { name: "Weekly active accounts actions" }).click();
  assert.equal(
    await page.getByRole("menuitem", { name: "Copy link", exact: true }).count(),
    0,
    "Unpublished dashboard metrics must not offer links that cannot be shared",
  );
  await page.keyboard.press("Escape");
  await activeUsers.getByRole("button", { name: "Weekly active accounts actions" }).click();
  await page.getByRole("menuitem", { name: "View data source" }).click();
  const sidebar = page.getByRole("complementary", {
    name: "Data source for Weekly active accounts",
  });
  await sidebar.waitFor();
  await sidebar.locator(".source-metadata dt").first().waitFor();
  assert.deepEqual(
    await sidebar.locator(".source-metadata dt").allInnerTexts(),
    ["Reporting period"],
    "Source overview must not infer query execution from the fixture's preparation timestamp",
  );
  assert.deepEqual(
    await sidebar.locator(".source-trust").allInnerTexts(),
    ["Table"],
    "Source rows should identify their type without inventing provider, adoption, or verification metadata",
  );
  assert.equal(await sidebar.locator(".source-usage-note").count(), 0,
    "A table without observed usage must not invent a usage explanation");
  assert.deepEqual(
    await sidebar.locator(".source-group .source-label").allInnerTexts(),
    ["Filters", "Definitions", "Sources"],
    "Tables and linked assets should share one concise Sources section",
  );
  assert.equal(
    await sidebar.locator('.source-row[data-source-kind="table"] [data-dashboard-icon="database"]').count(),
    1,
    "Warehouse tables should use the same source-row treatment and a recognizable table icon",
  );
  assert.equal(
    await sidebar.getByText(/Query \/ dataset|Source filters|Active filters/u).count(),
    0,
    "Source overview should not show the older redundant metadata or filter-chip sections",
  );
  assert.equal(
    await sidebar.getByRole("button", { name: "Close data source" }).locator('[data-dashboard-icon="cross"]').count(),
    1,
  );
  const overviewTab = sidebar.getByRole("tab", { name: "Overview" });
  const overviewPanel = sidebar.getByRole("tabpanel");
  assert.equal(await overviewTab.getAttribute("aria-controls"), await overviewPanel.getAttribute("id"));
  assert.equal(await overviewPanel.getAttribute("aria-labelledby"), await overviewTab.getAttribute("id"));
  assert.equal(await sidebar.getByRole("tab", { name: "Evidence flow" }).count(), 0,
    "Sources without recorded evidence flow must not expose a fabricated trace");
  await overviewTab.press("End");
  assert.equal(await sidebar.getByRole("tab", { name: "SQL query" }).getAttribute("aria-selected"), "true");
  await sidebar.getByRole("tab", { name: "SQL query" }).press("Home");
  assert.equal(await overviewTab.getAttribute("aria-selected"), "true");
  const reviewedLinks = sidebar.locator('.source-row[href][data-source-kind]:not([data-source-kind="table"])');
  if (await reviewedLinks.count()) {
    const sourceLink = reviewedLinks.first();
    const sourceTitle = (await sourceLink.locator(".source-row-title").innerText()).trim();
    assert.ok(sourceTitle, "Reviewed source links must have descriptive visible titles");
    assert.equal(
      await sourceLink.getAttribute("title"),
      null,
      "Visible source names must not generate redundant native browser tooltips",
    );
  }
  assert.equal(await sidebar.locator(".source-trace").count(), 0);
  assert.match(
    await sidebar.innerText(),
    /Product segment: Studio/,
    "Active filter provenance must remain available in the source Overview",
  );
  await sidebar.getByRole("tab", { name: "Data preview" }).click();
  assert.match(await sidebar.innerText(), /Studio/);
  assert.doesNotMatch(await sidebar.innerText(), /Search|APAC/);
  const sourceNumbers = await sidebar.locator("tbody td.numeric").allInnerTexts();
  assert.ok(
    sourceNumbers.every((value) => !/\.\d{3,}/u.test(value)),
    "Reviewed-data previews should display no more than two decimal places by default",
  );
  await sidebar.getByRole("tab", { name: "SQL query" }).click();
  assert.match(await sidebar.innerText(), /FROM/);
  assert.match(await sidebar.innerText(), /analytics\.product_adoption_summary/);
  await sidebar.getByRole("button", { name: "Copy", exact: true }).click();
  await sidebar.getByRole("button", { name: "Close data source" }).click();

  await activeUsers.getByRole("button", { name: "Weekly active accounts actions" }).click();
  await page.getByRole("menuitem", { name: "Copy data" }).click();
  const copied = await page.evaluate(() => window.__dashboardClipboard);
  assert.ok(copied.some((value) => value.includes("SELECT reporting_week")));
  assert.ok(copied.some((value) => value.includes("Studio")));

  await trend.getByRole("button", { name: "Active accounts over time actions" }).click();
  await page.getByRole("menuitem", { name: "Copy as image" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /Chart image for .* copied/u })
    .waitFor();
  const copiedChart = (await page.evaluate(() => window.__dashboardClipboard)).find(
    (item) => item?.type === "image/png",
  );
  assert.ok(copiedChart, "The complete chart should be copied as a PNG");
  assert.ok(copiedChart.text.includes("Active accounts over time"), "The copied chart should include its title");
  assert.equal(
    copiedChart.text.includes("Reporting week"),
    false,
    "Copied date-based charts should omit the redundant reporting-period axis title",
  );
  for (const label of await trend.locator(".chart-legend-button span:last-child").allInnerTexts()) {
    assert.ok(copiedChart.text.includes(label), `The copied chart should include its ${label} legend entry`);
  }
  const legendLabels = await trend.locator(".chart-legend-button span:last-child").allInnerTexts();
  const legendDraws = copiedChart.draws.filter(({ text }) => legendLabels.includes(text));
  assert.ok(
    legendDraws.length >= 2 && legendDraws.every(({ baseline }) => baseline === "middle"),
    "Copied chart legend labels should align to the vertical center of their markers",
  );
  assert.equal(
    new Set(legendDraws.map(({ y }) => y)).size,
    1,
    "A single-row copied chart legend should keep its entries on one aligned baseline",
  );
  const expectedLegendCenter = await trend.evaluate((component) => {
    const chart = component.getBoundingClientRect();
    const footer = component.querySelector(".chart-footer").getBoundingClientRect();
    return 20 + footer.left - chart.left + footer.width / 2;
  });
  const copiedLegendCenter = (legendDraws[0].x - 24 + legendDraws.at(-1).x + legendDraws.at(-1).width) / 2;
  assert.ok(
    Math.abs(copiedLegendCenter - expectedLegendCenter) < 1,
    "Copied chart legends should align with the actual plot and x-axis label",
  );
  assert.ok(
    copiedChart.height > (await trend.locator(".recharts-wrapper svg").boundingBox()).height * 2,
    "The copied chart should include additional space for its title, axes, and legend",
  );

  await verifyDashboardChartInteractions({ page, trend });
  await verifyChartOverridePrecedence({ browser, pluginRoot });
  await verifyHostedTextEditing({ browser, pluginRoot });

  await verifyDashboardInlineEditing({ page, trend, activeUsers, settleSelectionUi });
  const remainingMetric = page.locator('[data-component-id="growth"]');
  const initialMetricWidth = (await remainingMetric.boundingBox()).width;
  await activeUsers.getByRole("button", { name: "Reviewed active users actions" }).click();
  await page.getByRole("menuitem", { name: "Hide" }).click();
  assert.equal(await page.locator('[data-component-id="active-users"]').count(), 0);
  assert.ok(
    (await remainingMetric.boundingBox()).width > initialMetricWidth,
    "Remaining metric cards should expand when a neighboring card is hidden",
  );
  const growthDrivers = page.locator('[data-component-id="growth-drivers"]');
  const diagnosticLayout = page.locator(".diagnostic-layout");
  await diagnosticLayout.evaluate((section) => {
    section.className = "model-authored-chart-grid";
    section.style.display = "grid";
    section.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    section.style.columnGap = "34px";
  });
  const generatedChartGrid = page.locator(".model-authored-chart-grid");
  const initialGrowthWidth = (await growthDrivers.boundingBox()).width;
  await page
    .locator('[data-component-id="forecast-outlook"]')
    .getByRole("button", { name: "Target attainment actions" })
    .click();
  await page.getByRole("menuitem", { name: "Hide" }).click();
  assert.ok(
    (await growthDrivers.boundingBox()).width > initialGrowthWidth,
    "Growth charts should expand after their neighboring forecast is hidden",
  );
  assert.ok(
    Math.abs((await growthDrivers.boundingBox()).width - (await generatedChartGrid.boundingBox()).width) <= 1,
    "A remaining chart should span a model-authored grid even when its class is unknown to the starter",
  );
  await generatedChartGrid.evaluate((section) => {
    section.className = "diagnostic-layout";
    section.removeAttribute("style");
  });
  await growthDrivers.getByRole("button", { name: "Weekly change in active accounts actions" }).click();
  await page.getByRole("menuitem", { name: "Hide" }).click();
  assert.equal(
    await diagnosticLayout.evaluate((section) => getComputedStyle(section).display),
    "none",
    "An empty diagnostic row should collapse entirely",
  );
  const reflowSupportingChart = page.locator('[data-component-id="segment-breakdown"]');
  const initialSupportingWidth = (await reflowSupportingChart.boundingBox()).width;
  await page
    .locator('[data-component-id="priority-accounts"]')
    .getByRole("button", { name: "Active accounts by region actions" })
    .click();
  await page.getByRole("menuitem", { name: "Hide" }).click();
  assert.ok(
    (await reflowSupportingChart.boundingBox()).width > initialSupportingWidth,
    "Supporting charts should expand when the neighboring analysis is hidden",
  );
  await reflowSupportingChart.getByRole("button", { name: "Active accounts by feature actions" }).click();
  await page.getByRole("menuitem", { name: "Hide" }).click();
  assert.equal(
    await page.locator(".analysis-layout").evaluate((section) => getComputedStyle(section).display),
    "none",
    "An empty supporting-analysis row should collapse entirely",
  );
  await page.getByRole("button", { name: "Restore hidden (5)", exact: true }).click();
  assert.equal(await page.locator('[data-component-id="active-users"]').count(), 1);
  assert.equal(await page.locator('[data-component-id="growth-drivers"]').count(), 1);
  assert.equal(await page.locator('[data-component-id="segment-breakdown"]').count(), 1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();

  await verifyCodexEditorDashboardActions(page, { originatingThreadId });
  await page.getByRole("button", { name: "More", exact: true }).click();
  assert.equal(
    await page.getByRole("group", { name: "Dashboard appearance" }).count(),
    0,
    "Appearance controls should not appear in the dashboard overflow menu",
  );
  assert.ok(
    (await page.getByRole("menuitem").allInnerTexts()).includes("Switch theme"),
    "Dashboard actions must retain Switch theme even when other sharing actions precede it",
  );
  const themeAction = page.getByRole("menuitem", { name: "Switch theme" });
  assert.equal(
    await themeAction.locator('[data-dashboard-icon="palette"]').count(),
    1,
    "Switch theme does not use the Figma paint-palette icon",
  );
  await themeAction.click();
  const themePicker = page.getByRole("region", { name: "Theme picker" });
  assert.equal(
    await themePicker.evaluate((drawer) => drawer.inert),
    false,
    "An open theme drawer must allow keyboard interaction",
  );
  assert.equal(await themePicker.getByRole("button", { name: "Close theme picker" }).getAttribute("tabindex"), "0");
  const appearanceTrigger = themePicker.getByRole("button", {
    name: "Appearance",
  });
  assert.match(await appearanceTrigger.innerText(), /System/);
  await appearanceTrigger.focus();
  assert.equal(
    await appearanceTrigger.evaluate((button) => getComputedStyle(button).outlineStyle),
    "none",
    "Appearance controls should not show automatic focus rings",
  );
  await appearanceTrigger.click();
  const appearanceOptions = page.locator('[role="menu"][aria-label="Dashboard appearance"]');
  const appearanceItems = appearanceOptions.locator('[role="menuitemradio"]');
  await appearanceItems.first().waitFor();
  assert.deepEqual(await appearanceItems.allInnerTexts(), ["Light", "Dark", "System"]);
  const classicThemePreview = themePicker.getByRole("button", { name: "Apply Classic" }).locator(".theme-preview");
  const darkOnlyThemePreview = themePicker.getByRole("button", { name: "Apply Dark pixel" }).locator(".theme-preview");
  await appearanceItems.filter({ hasText: "Dark" }).click();
  assert.equal(
    await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor),
    "rgb(24, 24, 24)",
    "Dark appearance must change production-rendered colors",
  );
  assert.equal(
    await classicThemePreview.evaluate((preview) => getComputedStyle(preview).backgroundColor),
    "rgb(24, 24, 24)",
    "Theme previews must immediately follow the selected dark appearance",
  );
  await appearanceTrigger.click();
  await appearanceItems.filter({ hasText: "Light" }).click();
  assert.equal(
    await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor),
    "rgb(255, 255, 255)",
    "Light appearance must change production-rendered colors",
  );
  assert.equal(
    await classicThemePreview.evaluate((preview) => getComputedStyle(preview).backgroundColor),
    "rgb(255, 255, 255)",
    "Theme previews must not remain dark after switching back to light",
  );
  assert.equal(
    await darkOnlyThemePreview.evaluate((preview) => getComputedStyle(preview).backgroundColor),
    "rgb(18, 19, 21)",
    "Dark-only theme previews must remain dark in light appearance",
  );
  await appearanceTrigger.click();
  await appearanceItems.filter({ hasText: "System" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.colorScheme === "dark");
  assert.equal(
    await classicThemePreview.evaluate((preview) => getComputedStyle(preview).backgroundColor),
    "rgb(24, 24, 24)",
    "Theme previews must follow system appearance changes to dark",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset.colorScheme === "light");
  assert.equal(
    await classicThemePreview.evaluate((preview) => getComputedStyle(preview).backgroundColor),
    "rgb(255, 255, 255)",
    "Theme previews must follow system appearance changes back to light",
  );
  assert.equal(
    await themePicker
      .getByRole("button", { name: "Close theme picker" })
      .locator('[data-dashboard-icon="cross"]')
      .evaluate((icon) => {
        const style = getComputedStyle(icon);
        return `${style.width}:${style.opacity}`;
      }),
    "20px:1",
    "The theme drawer must use the lighter, actual OpenAI design-system cross icon",
  );
  assert.equal(
    await page.locator("html").getAttribute("data-app-theme"),
    null,
    "Opening the theme drawer must not preview whichever card happens to appear under the pointer",
  );
  assert.equal(await themePicker.locator(".theme-card").count(), 5);
  assert.equal(
    await themePicker.getByRole("button", { name: "Apply Original theme" }).count(),
    0,
    "The original theme duplicates the identical Classic preset",
  );
  assert.equal(await themePicker.getByRole("button", { name: "Apply Classic" }).getAttribute("aria-pressed"), "true");
  const themeBounds = await themePicker.boundingBox();
  const themeDashboardWidth = await themePicker
    .evaluate((drawer) => drawer.closest(".dashboard-root").getBoundingClientRect().width);
  assert.equal(themeBounds.x, 0, "Theme drawer does not start at the viewport edge");
  assert.equal(themeBounds.width, themeDashboardWidth, "Theme drawer does not span the dashboard");
  assert.match(
    await themePicker.locator(".theme-preview").first().textContent(),
    /Sans serif|Monospace|Rounded/,
    "Theme previews do not display their typography and geometry",
  );
  assert.doesNotMatch(
    await themePicker.locator(".theme-preview").first().innerText(),
    /radius|Filter|Square corners/,
    "Theme previews should communicate their styling visually without overflowing descriptive labels",
  );
  assert.equal(await themePicker.locator(".theme-preview").first().locator(".theme-preview-swatches i").count(), 5);
  await themePicker.getByRole("button", { name: "Apply Dark pixel" }).hover();
  assert.equal(
    await page.locator("html").getAttribute("data-app-theme"),
    "dark-pixel",
    "Hovering a theme preview must immediately preview its appearance",
  );
  await themePicker.locator(".theme-drawer-header").hover();
  assert.equal(
    await page.locator("html").getAttribute("data-app-theme"),
    "original",
    "Leaving a theme preview must restore the selected Data app appearance",
  );
  const themeClip = await themePicker.evaluate((drawer) => {
    const list = drawer.querySelector(".theme-card-list");
    const card = list.querySelector(".theme-card");
    return {
      list: list.getBoundingClientRect().left,
      card: card.getBoundingClientRect().left,
      scroll: list.scrollLeft,
    };
  });
  assert.equal(themeClip.scroll, 0, "Theme picker reopens at a clipped horizontal scroll position");
  assert.ok(themeClip.card >= themeClip.list + 2, "The first theme card is clipped by the horizontal scroller");
  for (const width of [1050, 760, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    const themeEdges = await themePicker.evaluate((drawer) => {
      const content = drawer.querySelector(".theme-drawer-content");
      const list = drawer.querySelector(".theme-card-list");
      const cards = [...list.querySelectorAll(".theme-card")];
      const inset = Number.parseFloat(getComputedStyle(list).paddingLeft);
      list.scrollLeft = 0;
      const first = cards[0].getBoundingClientRect();
      const bounds = list.getBoundingClientRect();
      const root = drawer.closest(".dashboard-root").getBoundingClientRect();
      list.scrollLeft = list.scrollWidth - list.clientWidth;
      const last = cards.at(-1).getBoundingClientRect();
      list.scrollLeft = 0;
      return {
        left: bounds.left,
        right: bounds.right,
        rootLeft: root.left,
        rootRight: root.right,
        first: first.left,
        content: content.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(content).paddingLeft),
        last: last.right,
        inset,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    assert.ok(
      Math.abs(themeEdges.left - themeEdges.rootLeft) < 1 && Math.abs(themeEdges.right - themeEdges.rootRight) < 1,
      `Theme scroll viewport does not extend edge-to-edge at ${width}px: ${JSON.stringify(themeEdges)}`,
    );
    assert.ok(
      Math.abs(themeEdges.first - themeEdges.content) < 2,
      `First theme card does not align with the dashboard content at ${width}px: ${JSON.stringify(themeEdges)}`,
    );
    assert.ok(
      themeEdges.last <= themeEdges.rootRight - themeEdges.inset + 2,
      `The last theme card cannot scroll fully into view at ${width}px: ${JSON.stringify(themeEdges)}`,
    );
    assert.ok(
      themeEdges.pageOverflow <= 1,
      `Opening the theme carousel introduces page overflow at ${width}px: ${JSON.stringify(themeEdges)}`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await themePicker.getByRole("button", { name: "Apply Classic" }).click();
  assert.equal(await page.locator("html").getAttribute("data-app-theme"), "codex-classic");
  const tooltipRadius = await page.evaluate(() => {
    const sample = document.createElement("div");
    sample.className = "chart-tooltip";
    document.body.append(sample);
    const radius = Number.parseFloat(getComputedStyle(sample).borderTopLeftRadius);
    sample.remove();
    return radius;
  });
  assert.ok(tooltipRadius <= 12, `Chart tooltip inherits a circular control radius: ${tooltipRadius}px`);
  const classicTreatment = await page.evaluate(() => {
    const metric = document.querySelector(".metric-item");
    const chart = document.querySelector(".feature-chart");
    const chip = document.querySelector(".filter-trigger");
    const strip = document.querySelector(".metric-strip");
    return {
      metricRadius: getComputedStyle(metric).borderTopLeftRadius,
      chartRadius: getComputedStyle(chart).borderTopLeftRadius,
      authoredCardRadius: getComputedStyle(document.documentElement).getPropertyValue("--card-radius").trim(),
      authoredControlRadius: getComputedStyle(document.documentElement).getPropertyValue("--control-radius").trim(),
      metricBorder: getComputedStyle(metric).borderTopWidth,
      chipRadius: getComputedStyle(chip).borderTopLeftRadius,
      gap: getComputedStyle(strip).columnGap,
      divider: getComputedStyle(document.querySelector(".filter-bar")).borderTopWidth,
      eyebrowCount: document.querySelectorAll(".eyebrow").length,
      headingWeight: getComputedStyle(document.querySelector(".feature-chart .component-title")).fontWeight,
      cardRadius: getComputedStyle(document.documentElement).getPropertyValue("--card-radius").trim(),
      controlRadius: getComputedStyle(document.documentElement).getPropertyValue("--control-radius").trim(),
    };
  });
  assert.equal(classicTreatment.metricRadius, "20px", "Classic KPI cards should use the requested 20px card treatment");
  assert.equal(
    classicTreatment.chartRadius,
    "20px",
    "Classic chart containers should match the requested 20px KPI-card treatment",
  );
  assert.equal(
    classicTreatment.authoredCardRadius,
    "16px",
    "Dashboard card overrides should not modify the underlying theme card-radius token",
  );
  assert.equal(classicTreatment.metricBorder, "1px");
  assert.equal(
    classicTreatment.chipRadius,
    classicTreatment.authoredControlRadius,
    "Dashboard filters should follow the active control-radius token",
  );
  assert.equal(classicTreatment.gap, "12px");
  assert.equal(classicTreatment.divider, "0px");
  assert.equal(classicTreatment.eyebrowCount, 0, "The Classic starter must not include decorative eyebrow labels");
  assert.equal(classicTreatment.headingWeight, "500");
  const classicMark = await page
    .locator('[data-component-id="channel-composition"] .recharts-bar-rectangle path')
    .first()
    .getAttribute("d");
  assert.ok(
    (classicMark.match(/A\s/g) ?? []).length >= 2,
    `The outer end of a Classic stacked bar must be rounded: ${classicMark}`,
  );
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--chart-2").trim()),
    "#924ff7",
    "The Classic theme must preserve the shared blue, purple, green categorical series order",
  );
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Switch theme" }).click();
  await themePicker.getByRole("button", { name: "Apply Dark pixel" }).click();
  assert.equal(await page.locator("html").getAttribute("data-app-theme"), "dark-pixel");
  assert.equal(
    await page.locator(".chart-heatmap-cell").first().getAttribute("rx"),
    "0",
    "Dark Pixel heatmaps must inherit square theme corners instead of a hard-coded rounded radius",
  );
  assert.equal(
    await page.locator(".pixel-chart-shaders, [id^='pixel-chart-dither']").count(),
    0,
    "Dark Pixel should not inject decorative shader or dithering definitions",
  );
  const darkPixelArea = page.locator('[data-component-id="segment-composition"] .recharts-area-area').first();
  const darkAreaAppearance = await darkPixelArea.evaluate((mark) => ({
    fill: getComputedStyle(mark).fill,
    mask: getComputedStyle(mark).maskImage,
  }));
  assert.doesNotMatch(
    darkAreaAppearance.fill,
    /pixel-chart-dither|url\(/u,
    "Dark Pixel area charts should use clean semantic category fills",
  );
  assert.equal(darkAreaAppearance.mask, "none", "Dark Pixel area charts should not add decorative pixel masks");
  const darkPixelBar = page.locator('[data-component-id="segment-breakdown"] .chart-ranked-list-fill').first();
  await page.mouse.move(0, 0);
  await darkPixelBar.evaluate((mark) => Promise.all(mark.getAnimations().map((animation) => animation.finished)));
  const rankedColors = await darkPixelBar.evaluate((mark) => {
    const probe = document.createElement("span");
    probe.style.background = mark.style.getPropertyValue("--ranked-list-fill") ||
      "var(--ranked-list-fill, color-mix(in srgb, var(--chart-1) 16%, var(--surface)))";
    mark.parentElement.append(probe);
    const colors = [getComputedStyle(mark).backgroundColor, getComputedStyle(probe).backgroundColor];
    probe.remove();
    return colors;
  });
  assert.equal(rankedColors[0], rankedColors[1], "Dark Pixel ranked lists should use their theme-aware semantic fill");
  const mixedStackedBar = page
    .locator('[data-component-id="channel-composition"] ' + '.recharts-bar-rectangle path[fill*="--chart-2"]')
    .first();
  const darkBarAppearance = await mixedStackedBar.evaluate((mark) => ({
    fill: getComputedStyle(mark).fill,
    mask: getComputedStyle(mark).maskImage,
  }));
  assert.doesNotMatch(
    darkBarAppearance.fill,
    /pixel-chart-dither|url\(/u,
    "Dark Pixel stacked bars should retain clean, distinct category colors",
  );
  assert.equal(darkBarAppearance.mask, "none", "Dark Pixel bars should not add decorative pixel masks");
  assert.equal(
    await page.locator('[data-component-id="engagement-heatmap"] .chart-heatmap-cell')
      .first().evaluate((cell) => getComputedStyle(cell).maskImage),
    "none",
    "Dark Pixel heatmaps should use clean uninterrupted reviewed intensity fills",
  );
  assert.doesNotMatch(
    await page
      .locator('.metric-mini-trend[data-direction="positive"] polygon')
      .first()
      .evaluate((trend) => getComputedStyle(trend).fill),
    /pixel-chart-dither/u,
    "Positive KPI trends should retain their ordinary legible sparkline gradient",
  );
  assert.equal(
    await page
      .locator(".regional-marker-core")
      .first()
      .evaluate((marker) => getComputedStyle(marker).backgroundImage),
    "none",
    "Regional activity markers should retain clean, solid semantic colors",
  );
  assert.equal(
    await page.locator(".theme-drawer").getAttribute("aria-hidden"),
    "true",
    "Applying a theme must close its drawer",
  );
  assert.equal(
    await page.locator(".theme-drawer").evaluate((drawer) => drawer.inert),
    true,
    "Closed theme drawers must not leave invisible controls in the keyboard focus order",
  );
  assert.equal(await page.locator('[aria-label="Close theme picker"]').getAttribute("tabindex"), "-1");
  const darkChrome = await page
    .locator(".dashboard-topbar")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.match(darkChrome, /18,\s*19,\s*21|0\.0705882\s+0\.0745098\s+0\.0823529/);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Switch theme" }).click();
  assert.equal(
    await themePicker.getByRole("button", { name: "Apply Dark pixel" }).getAttribute("aria-pressed"),
    "true",
  );
  await themePicker.getByRole("button", { name: "Apply Neutral" }).click();
  await page.waitForFunction(() => document.documentElement.dataset.appTheme === "default");
  assert.equal(await page.locator("html").getAttribute("data-app-theme"), "default");
  assert.doesNotMatch(
    await darkPixelArea.evaluate((mark) => getComputedStyle(mark).fill),
    /pixel-chart-dither/u,
    "Pixelated chart fills must remain exclusive to the Dark pixel theme",
  );
  assert.equal(await page.locator(".theme-drawer").getAttribute("aria-hidden"), "true");

  await page.getByRole("button", { name: "Clear all" }).click();
  assert.match(await page.locator('[data-component-id="active-users"] .metric-value').innerText(), /12\.5K/);
  assert.ok(await page.getByRole("button", { name: "Next page" }).count(), "Table pagination must use icon buttons");
  const footerSpacing = await page.locator(".table-pagination").evaluateAll(footers => footers.map(footer => parseFloat(getComputedStyle(footer).paddingTop)));
  assert.ok(footerSpacing.every(padding => padding >= 12), "Table footers need separation from the final row divider");

  assert.equal(await page.getByRole("tablist", { name: "Dashboard pages" }).count(), 0,
    "A one-page dashboard must not show a tab strip in view mode");
  await page.getByRole("button", { name: "Edit text and layout" }).click();
  assert.equal(await page.getByRole("tablist", { name: "Dashboard pages" }).count(), 0,
    "A one-page dashboard must not show a tab strip in edit mode");
  assert.equal(await page.getByRole("button", { name: "Add dashboard tab" }).count(), 0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  const selectedBar = page
    .locator('[data-component-id="channel-composition"] .recharts-bar-rectangle path[fill]')
    .first();
  await selectedBar.scrollIntoViewIfNeeded();
  await selectedBar.click();
  await settleSelectionUi(page);
  const selectionActions = page.getByRole("dialog", {
    name: "Selection actions",
  });
  // File previews use the ordinary-browser policy: View allows selection,
  // while Edit, localhost, and the packaged Codex browser disable it.
  await page.getByRole("dialog", { name: /^(Selection actions|Selected chart data)$/u }).waitFor();
  const barSelection = page.locator('[data-component-id="channel-composition"] .dashboard-ask-selected-region');
  await barSelection.waitFor({ state: "visible" });
  const selectedBarBounds = await selectedBar.boundingBox(), selectionBounds = await barSelection.boundingBox();
  assert.ok(["x", "y", "width", "height"].every(key => Math.abs(selectedBarBounds[key] - selectionBounds[key]) <= 2),
    `The visible selection must follow the clicked bar: ${JSON.stringify({ selectedBarBounds, selectionBounds })}`);
  await page.keyboard.press("Escape");

  const selectedLine = page.locator('[data-component-id="adoption-scenario"] .recharts-line-curve').first();
  await selectedLine.scrollIntoViewIfNeeded();
  await selectedLine.hover({ force: true });
  const lineComponent = page.locator('[data-component-id="adoption-scenario"]');
  await lineComponent.locator(".chart-tooltip").waitFor();
  const hoverCursor = await lineComponent.locator(".recharts-tooltip-cursor").boundingBox();
  const hoverPoints = await lineComponent.locator(".recharts-active-dot circle").evaluateAll(dots => dots.map(dot => {
    const rect = dot.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, fill: getComputedStyle(dot).fill };
  }));
  await selectedLine.click({ force: true });
  await settleSelectionUi(page);
  await page.getByRole("dialog", { name: "Selected chart data", exact: true }).waitFor();
  const pinnedPoint = lineComponent.locator(".dashboard-ask-selected-region.is-point");
  const pointBounds = await pinnedPoint.boundingBox();
  assert.ok(pointBounds.width <= 2, "Selecting one date cannot expand to the interval between axis labels");
  assert.ok(Math.abs(pointBounds.x + pointBounds.width / 2 - hoverCursor.x - hoverCursor.width / 2) < 1);
  assert.equal(await pinnedPoint.evaluate(element => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
  const selectedPoints = await pinnedPoint.locator("circle").evaluateAll(dots => dots.map(dot => {
    const rect = dot.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, fill: getComputedStyle(dot).fill };
  }));
  assert.equal(selectedPoints.length, hoverPoints.length);
  selectedPoints.forEach((point, index) => {
    assert.ok(Math.abs(point.x - hoverPoints[index].x) < 1 && Math.abs(point.y - hoverPoints[index].y) < 1);
    assert.equal(point.fill, hoverPoints[index].fill);
  });
  const frozenMarkup = await pinnedPoint.innerHTML();
  await page.mouse.move(pointBounds.x + 40, pointBounds.y + 40);
  await settleSelectionUi(page);
  assert.equal(await pinnedPoint.innerHTML(), frozenMarkup, "Pointer movement cannot move the pinned date markers");
  await page.keyboard.press("Escape");
  assert.equal(await pinnedPoint.count(), 0);

  const zoomableChart = page.locator('[data-component-id="adoption-scenario"] .recharts-surface');
  const zoomRange = await zoomableChart.evaluate((surface) => {
    const bounds = surface.getBoundingClientRect();
    const ticks = [...surface.querySelectorAll(".recharts-xAxis-tick-labels text")].map((tick) => {
      const tickBounds = tick.getBoundingClientRect();
      return { x: tickBounds.x + tickBounds.width / 2, label: tick.textContent.trim() };
    });
    return { start: ticks[1], end: ticks.at(-2), y: bounds.y + bounds.height * 0.45 };
  });
  assert.ok(
    zoomRange.start &&
      zoomRange.end &&
      zoomRange.end.x > zoomRange.start.x &&
      zoomRange.start.label !== zoomRange.end.label,
    "The zoom fixture must expose two distinct interior date ticks",
  );
  const zoomTooltip = page.locator('[data-component-id="adoption-scenario"] .chart-tooltip strong');
  await page.mouse.move(zoomRange.start.x, zoomRange.y);
  // Recharts RAF-throttles moves, but handles down/up immediately using the stored label.
  await zoomTooltip.getByText(zoomRange.start.label, { exact: true }).waitFor();
  await page.mouse.down();
  await page.mouse.move(zoomRange.end.x, zoomRange.y, { steps: 8 });
  await zoomTooltip.getByText(zoomRange.end.label, { exact: true }).waitFor();
  await page.locator('[data-component-id="adoption-scenario"] .recharts-reference-area-rect').waitFor();
  await page.mouse.up();
  const resetZoom = page.locator('[data-component-id="adoption-scenario"]').getByRole("button", { name: "Reset zoom" });
  await resetZoom.waitFor();
  assert.equal(
    await selectionActions.count(),
    0,
    "Completing a drag-to-zoom must not also open chart-point selection actions",
  );
  await resetZoom.click();

  const selectableText = page.locator(".feature-chart .component-title-text");
  await selectableText.scrollIntoViewIfNeeded();
  await selectableText.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await settleSelectionUi(page);
  await selectionActions.waitFor();
  assert.equal(
    await page.locator(".dashboard-ask-selected-mark").count(),
    0,
    "Selecting dashboard text must not leave stale chart-mark highlights",
  );
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("dashboard-ask-selection")),
    true,
    "Selected dashboard text must have a native text-selection highlight",
  );
  await verifyAskChatGPTSelectionContext(page, {
    componentTitle: await selectableText.innerText(),
    selectedContextIncludes: `Selected text · “${await selectableText.innerText()}”`,
  });
  assert.equal(await page.evaluate(() => CSS.highlights.has("dashboard-ask-selection")), false,
    "Dismissing the composer clears its text-selection highlight");
  await page.evaluate(() => window.getSelection()?.removeAllRanges());

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(screenshots, "mobile-baseline.png"),
    fullPage: true,
  });
  const { overflow, offenders } = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    offenders: [...document.querySelectorAll("body *")]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
  }));
  assert.ok(overflow <= 1, `mobile dashboard overflows viewport by ${overflow}px: ${offenders.join(", ")}`);
  assert.equal(
    await page
      .locator("main[data-data-app-content=dashboard]")
      .evaluate((main) => getComputedStyle(main).paddingInlineStart),
    "16px",
    "Dashboard pages must retain the shared mobile gutter even when authored content changes",
  );

  await verifyLocalDashboardHandoffs(browser, {
    dataAppPath,
    title: dataAppSnapshot.title,
    originatingThreadId,
    failures,
  });

  // Sibling dashboard tabs must share an explicit context for cookie tests.
  const publishedContext = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1050 },
  });
  const publishedPage = await publishedContext.newPage();
  publishedPage.on("pageerror", (error) => failures.push(error.message));
  const publishedRequests = [];
  let publishedSnapshot = dataAppSnapshot;
  const publishedPresentationWrites = [];
  const originalPublishedHtml = localHtml.replace(localThreadMetadata, "");
  let publishedHtml = originalPublishedHtml;
  const publishedVerifierEmail = "publisher@example.com";
  const publishedVerifierTimestamp = "2040-05-06T07:08:09.123Z";
  let persistPublishedPresentationWrites = false;
  let failNextVerificationAction = null;
  let holdNextVerificationResponse = false;
  let notifyHeldVerificationRequest;
  let releaseHeldVerificationResponse;
  let publishedPresentation = {
    canEdit: true,
    presentation: {},
    revision: 0,
  };
  const handlePublishedRoute = async (route) => {
    const { pathname } = new URL(route.request().url());
    publishedRequests.push(pathname);
    if (pathname === "/api/presentation" && route.request().method() === "PUT") {
      const submitted = route.request().postData();
      publishedPresentationWrites.push(submitted);
      const { presentation, verificationAction } = JSON.parse(submitted);
      if (failNextVerificationAction && verificationAction === failNextVerificationAction) {
        failNextVerificationAction = null;
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Verification save failed. Try again." }),
        });
      }
      if (persistPublishedPresentationWrites && publishedPresentation.canEdit) {
        const existingVerification = publishedPresentation.presentation.verification;
        const verification = verificationAction === "remove"
          ? undefined
          : verificationAction === "verify"
            ? existingVerification ?? {
                verifiedBy: publishedVerifierEmail,
                verifiedAt: publishedVerifierTimestamp,
              }
            : existingVerification;
        const nextPresentation = { ...presentation };
        if (verification) nextPresentation.verification = verification;
        else delete nextPresentation.verification;
        publishedPresentation = {
          ...publishedPresentation,
          presentation: nextPresentation,
          revision: publishedPresentation.revision + 1,
        };
        if (["verify", "remove"].includes(verificationAction) && holdNextVerificationResponse) {
          holdNextVerificationResponse = false;
          const heldResponse = new Promise((resolve) => {
            releaseHeldVerificationResponse = resolve;
          });
          notifyHeldVerificationRequest?.();
          await heldResponse;
        }
      }
    }
    const payload =
      pathname === "/api/snapshot"
        ? publishedSnapshot
        : pathname === "/api/presentation"
          ? publishedPresentation
          : undefined;
    return route.fulfill(
      payload
        ? {
            contentType: "application/json",
            body: JSON.stringify(payload),
          }
        : {
            contentType: "text/html",
            body: publishedHtml,
          },
    );
  };
  await publishedPage.route("https://*.chatgpt.site/**", handlePublishedRoute);
  await installPublishedDashboardActionMocks(publishedPage);
  await publishedPage.goto(
    `https://dashboard.chatgpt.site/published?token=secret&codexThreadId=${originatingThreadId}#private-section`,
    { waitUntil: "load" },
  );
  await waitForDashboardTitle(publishedPage);
  assert.equal(
    await publishedPage.locator('meta[name="data-app-local-thread"]').count(),
    0,
    "Published dashboards must not include local-task metadata",
  );
  await publishedPage.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  assert.ok(publishedRequests.includes("/api/snapshot"), "The published Site must load its hosted reviewed snapshot");
  assert.ok(publishedRequests.includes("/api/presentation"), "The published Site must resolve creator editing access");
  assert.equal(
    Object.hasOwn(publishedPresentation, "viewerEmail"),
    false,
    "Authored dashboard code must never receive the authenticated creator's raw email before verification",
  );
  const markDashboardVerified = publishedPage.getByRole("button", {
    name: "Mark dashboard as verified",
  });
  const removeDashboardVerification = publishedPage.getByRole("button", {
    name: "Remove dashboard verification",
  });
  const editPublishedDashboard = publishedPage.getByRole("button", { name: "Edit text and layout", exact: true });
  const savePublishedDashboard = publishedPage.getByRole("button", { name: "Save", exact: true });
  const cancelPublishedDashboard = publishedPage.getByRole("button", { name: "Cancel", exact: true });
  const verificationDialog = publishedPage.getByRole("dialog", { name: "What verification means" });
  async function setVerificationDraft(verified) {
    await (verified ? markDashboardVerified : removeDashboardVerification).click();
    if (verified) {
      await verificationDialog.getByRole("button", { name: "Got it", exact: true }).click();
      await verificationDialog.waitFor({ state: "hidden" });
    }
  }
  async function assertVerificationView(verified) {
    await editPublishedDashboard.waitFor();
    const badge = publishedPage.getByRole("img", {
      name: verified ? "Verified dashboard" : "Unverified dashboard", exact: true,
    });
    await badge.waitFor();
    for (const toggle of [markDashboardVerified, removeDashboardVerification]) {
      assert.equal(await toggle.count(), 0, "View mode must not offer a verification mutation control");
    }
    return badge;
  }
  async function assertVerificationHoverColor(target) {
    await publishedPage.mouse.move(0, 0);
    await settleSelectionUi(publishedPage);
    const color = await target.evaluate((element) => getComputedStyle(element).color);
    await target.hover();
    await settleSelectionUi(publishedPage);
    assert.equal(await target.evaluate((element) => getComputedStyle(element).color), color,
      "Hover must preserve the badge's verified or unverified color");
    return color;
  }
  async function assertPendingVerificationTooltip() {
    const text = await publishedPage.locator("#dashboard-verification-tooltip").innerText();
    assert.match(text, /\bsav(?:e|ed|ing)\b/iu, "A draft verification choice must explain its Save boundary");
    assert.doesNotMatch(text, /Verified (?:by|at):/u,
      "A draft verification choice must not claim an authoritative verifier or timestamp");
  }
  async function cancelVerificationDraft(verified) {
    const badge = await assertVerificationView(verified);
    const writesBeforeDraft = publishedPresentationWrites.length;
    const baseline = structuredClone(publishedPresentation.presentation.verification);
    await badge.click();
    await editPublishedDashboard.click();
    const toggle = verified ? removeDashboardVerification : markDashboardVerified;
    const color = await assertVerificationHoverColor(toggle);
    await setVerificationDraft(!verified);
    await (verified ? markDashboardVerified : removeDashboardVerification).waitFor();
    await assertPendingVerificationTooltip();
    // Cross the persistence debounce so an unintended draft autosave cannot pass.
    await publishedPage.waitForTimeout(400);
    assert.equal(publishedPresentationWrites.length, writesBeforeDraft,
      "Neither a View-mode badge click nor a draft verification choice may write before Save");
    assert.deepEqual(publishedPresentation.presentation.verification, baseline,
      "An unsaved verification choice must leave the shared record unchanged");
    await cancelPublishedDashboard.click();
    await assertVerificationView(verified);
    await publishedPage.waitForTimeout(400);
    assert.equal(publishedPresentationWrites.length, writesBeforeDraft,
      "Cancel must discard the verification draft without writing it");
    assert.deepEqual(publishedPresentation.presentation.verification, baseline,
      "Cancel must preserve the original shared verification record");
    return color;
  }
  async function assertVerificationSaveLocked() {
    for (const control of [savePublishedDashboard, cancelPublishedDashboard,
      publishedPage.getByRole("button", { name: /^(?:Mark dashboard as verified|Remove dashboard verification)$/u })]) {
      assert.equal(await control.isDisabled(), true,
        "Save, Cancel, and verification toggles must be disabled while verification is saving");
    }
    await assertPendingVerificationTooltip();
  }
  async function assertNetZeroVerificationSave(verified) {
    const baseline = structuredClone(publishedPresentation);
    const writesBeforeDraft = publishedPresentationWrites.length;
    await editPublishedDashboard.click();
    await setVerificationDraft(!verified);
    await setVerificationDraft(verified);
    await savePublishedDashboard.click();
    await assertVerificationView(verified);
    await publishedPage.waitForTimeout(400);
    assert.equal(publishedPresentationWrites.length, writesBeforeDraft,
      "Saving a verification draft toggled back to its original state must not send a PUT");
    assert.deepEqual(publishedPresentation, baseline,
      "A net-zero verification Save must preserve the shared presentation and revision");
  }
  async function failVerificationSave(action) {
    const baseline = structuredClone(publishedPresentation);
    const writesBeforeSave = publishedPresentationWrites.length;
    failNextVerificationAction = action;
    const failedSave = publishedPage.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/presentation" &&
      response.request().method() === "PUT" &&
      response.request().postDataJSON()?.verificationAction === action);
    await savePublishedDashboard.click();
    assert.equal((await failedSave).status(), 500);
    await publishedPage.locator('.dashboard-save-status[data-status="error"]').waitFor();
    for (const control of [savePublishedDashboard, cancelPublishedDashboard,
      action === "verify" ? removeDashboardVerification : markDashboardVerified]) {
      assert.equal(await control.isEnabled(), true,
        "A failed verification Save must retain the draft with editing and retry controls enabled");
    }
    await assertPendingVerificationTooltip();
    await publishedPage.waitForTimeout(400);
    assert.equal(publishedPresentationWrites.length, writesBeforeSave + 1,
      "A failed verification Save must wait for the owner's explicit retry");
    assert.deepEqual(publishedPresentation, baseline,
      "A failed verification Save must not mutate the shared presentation or revision");
  }
  persistPublishedPresentationWrites = true;
  await assertVerificationView(false);
  await editPublishedDashboard.click();
  const writesBeforeVerification = publishedPresentationWrites.length;
  for (const dismiss of ["Escape", "Close", "backdrop"]) {
    await markDashboardVerified.click();
    await verificationDialog.waitFor();
    assert.match(await verificationDialog.innerText(), /sources, calculations, and conclusions/u,
      "Verification should explain what the owner is confirming");
    assert.equal(await publishedPage.locator(".dashboard-verification.is-verified").count(), 0,
      "Opening the reminder must not mark the page as verified");
    assert.equal(await verificationDialog.getByRole("checkbox", { name: "Don't show again", exact: true }).isChecked(), false,
      "Remembering the reminder preference requires an explicit choice");
    if (dismiss === "Escape") await publishedPage.keyboard.press("Escape");
    else if (dismiss === "backdrop") await publishedPage.locator(".dialog-backdrop").click({ position: { x: 5, y: 5 } });
    else await verificationDialog.getByRole("button", { name: dismiss, exact: true }).click();
    await verificationDialog.waitFor({ state: "hidden" });
    assert.equal(await markDashboardVerified.evaluate(element => element === document.activeElement), true,
      "Dismissing verification must restore keyboard focus to its badge");
  }
  assert.equal(publishedPresentationWrites.length, writesBeforeVerification,
    "Opening or dismissing the reminder must not save verification");
  await markDashboardVerified.click();
  await verificationDialog.waitFor();
  assert.equal(await verificationDialog.getByRole("checkbox").isChecked(), false);
  await verificationDialog.getByRole("button", { name: "Close", exact: true }).click();
  await verificationDialog.waitFor({ state: "hidden" });
  await cancelPublishedDashboard.click();
  await assertVerificationView(false);
  const publishedTopbarTitle = publishedPage.locator(".dashboard-topbar-title");
  const titleAfterVerification = `${dataAppSnapshot.title} (verified)`;
  const unverifiedBadgeColor = await cancelVerificationDraft(false);
  await assertNetZeroVerificationSave(false);
  await editPublishedDashboard.click();
  await setVerificationDraft(true);
  await failVerificationSave("verify");
  holdNextVerificationResponse = true;
  const heldVerificationRequest = new Promise((resolve) => {
    notifyHeldVerificationRequest = resolve;
  });
  const verificationSaved = publishedPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/presentation" &&
      response.request().method() === "PUT" &&
      response.request().postDataJSON()?.verificationAction === "verify" &&
      response.request().postDataJSON()?.presentation?.title === dataAppSnapshot.title,
  );
  await savePublishedDashboard.click();
  await heldVerificationRequest;
  await assertVerificationSaveLocked();
  releaseHeldVerificationResponse();
  const verificationResponse = await verificationSaved;
  const verifiedBadge = await assertVerificationView(true);
  const verifiedBadgeColor = await assertVerificationHoverColor(verifiedBadge);
  assert.notEqual(verifiedBadgeColor, unverifiedBadgeColor,
    "Verified and unverified badges must use distinct colors");
  const verificationRequest = verificationResponse.request().postDataJSON();
  assert.equal(
    verificationRequest.verificationAction,
    "verify",
    "Dashboard verification must request a trusted Worker-side verification action",
  );
  assert.equal(
    Object.hasOwn(verificationRequest.presentation, "verification"),
    false,
    "Dashboard verification requests must never fabricate their creator identity or timestamp",
  );
  assert.equal(
    verificationRequest.presentation.title,
    dataAppSnapshot.title,
    "Creator verification must preserve the saved dashboard title",
  );
  const storedDashboardVerification = structuredClone(publishedPresentation.presentation.verification);
  assert.equal(storedDashboardVerification.verifiedBy, publishedVerifierEmail);
  assert.equal(storedDashboardVerification.verifiedAt, publishedVerifierTimestamp,
    "The creator badge must use the authoritative Worker-stamped verification timestamp");
  await publishedPage.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  const verifiedTitleSaved = publishedPage.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/presentation" &&
      response.request().method() === "PUT" &&
      response.request().postDataJSON()?.presentation?.title === titleAfterVerification,
  );
  await publishedTopbarTitle.fill(titleAfterVerification);
  await publishedTopbarTitle.press("Enter");
  await publishedPage.getByRole("button", { name: "Save", exact: true }).click();
  await verifiedTitleSaved;
  await publishedPage.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
  assert.deepEqual(publishedPresentation.presentation.verification, storedDashboardVerification,
    "Explicitly saving a creator's title edit must preserve the authoritative verification");
  await publishedPage.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  const verifiedTitleRestored = publishedPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/presentation" &&
      response.request().method() === "PUT" &&
      Boolean(response.request().postDataJSON()?.presentation?.verification) &&
      response.request().postDataJSON()?.presentation?.title === dataAppSnapshot.title,
  );
  await publishedTopbarTitle.fill(dataAppSnapshot.title);
  await publishedTopbarTitle.press("Enter");
  await publishedPage.getByRole("button", { name: "Save", exact: true }).click();
  await verifiedTitleRestored;
  await publishedPage.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
  assert.deepEqual(
    publishedPresentation.presentation.verification,
    storedDashboardVerification,
    "An unrelated creator edit must preserve the original authoritative verifier and verification timestamp",
  );
  await verifiedBadge.hover();
  const ownerVerificationTooltip = publishedPage
    .locator('.dashboard-topbar [role="tooltip"]')
    .filter({ hasText: "Verified by:" });
  await ownerVerificationTooltip.waitFor({ state: "visible" });
  assert.match(
    await ownerVerificationTooltip.innerText(),
    /Verified at:/u,
    "The creator's verification badge must disclose when the dashboard was verified",
  );
  assert.match(
    await ownerVerificationTooltip.innerText(),
    /Verified by:\s*publisher@example\.com/u,
    "The creator's verification badge must disclose the accountable verifier",
  );
  await publishedPage.reload({ waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  await assertVerificationView(true);
  assert.equal(await cancelVerificationDraft(true), verifiedBadgeColor,
    "The verified badge must retain its color when its owner enters Edit mode");
  await assertNetZeroVerificationSave(true);
  await editPublishedDashboard.click();
  await removeDashboardVerification.click();
  await failVerificationSave("remove");
  const titleAfterUnverification = `${dataAppSnapshot.title} (unverified)`;
  holdNextVerificationResponse = true;
  const heldUnverificationRequest = new Promise((resolve) => {
    notifyHeldVerificationRequest = resolve;
  });
  const verificationRemoved = publishedPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/presentation" &&
      response.request().method() === "PUT" &&
      response.request().postDataJSON()?.verificationAction === "remove" &&
      response.request().postDataJSON()?.presentation?.title === dataAppSnapshot.title,
  );
  await savePublishedDashboard.click();
  await heldUnverificationRequest;
  await assertVerificationSaveLocked();
  releaseHeldVerificationResponse();
  const unverificationResponse = await verificationRemoved;
  assert.equal(
    unverificationResponse.request().postDataJSON().presentation.title,
    dataAppSnapshot.title,
    "Removing creator verification must preserve the saved dashboard title",
  );
  assert.equal(unverificationResponse.request().postDataJSON().verificationAction, "remove",
    "Dashboard unverification must request an explicit trusted Worker-side action");
  await assertVerificationView(false);
  assert.equal(
    Object.hasOwn(publishedPresentation.presentation, "verification"),
    false,
    "Removing creator verification must clear its shared dashboard presentation record",
  );
  await publishedPage.reload({ waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  assert.equal(await assertVerificationHoverColor(await assertVerificationView(false)), unverifiedBadgeColor,
    "Removed verification must remain light gray and noninteractive after reloading");
  await publishedPage.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  const unverifiedTitleSaved = publishedPage.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/presentation" &&
      response.request().method() === "PUT" &&
      response.request().postDataJSON()?.presentation?.title === titleAfterUnverification,
  );
  await publishedTopbarTitle.fill(titleAfterUnverification);
  await publishedTopbarTitle.press("Enter");
  await publishedPage.getByRole("button", { name: "Save", exact: true }).click();
  await unverifiedTitleSaved;
  await publishedPage.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
  assert.equal(Object.hasOwn(publishedPresentation.presentation, "verification"), false,
    "Explicitly saving a title edit must not restore removed verification");
  await publishedPage.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  const unverifiedTitleRestored = publishedPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/presentation" &&
      response.request().method() === "PUT" &&
      !Object.hasOwn(response.request().postDataJSON()?.presentation ?? {}, "verification") &&
      response.request().postDataJSON()?.presentation?.title === dataAppSnapshot.title,
  );
  await publishedTopbarTitle.fill(dataAppSnapshot.title);
  await publishedTopbarTitle.press("Enter");
  await publishedPage.getByRole("button", { name: "Save", exact: true }).click();
  await unverifiedTitleRestored;
  await publishedPage.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();

  await verifyDashboardVerificationReminder(publishedPage, {
    getSnapshot: () => publishedSnapshot,
    setSnapshot: snapshot => { publishedSnapshot = snapshot; },
    getPresentation: () => publishedPresentation,
    setPresentation: presentation => { publishedPresentation = presentation; },
    presentationWrites: publishedPresentationWrites,
    storedVerification: storedDashboardVerification,
    waitForDashboardTitle,
    assertVerificationView,
    assertPendingVerificationTooltip,
    createBrowserSession: async (sameBrowser = false) => {
      const next = sameBrowser ? await publishedContext.newPage()
        : await browser.newPage({ viewport: { width: 1440, height: 1050 } });
      next.on("pageerror", error => failures.push(error.message));
      await next.route("https://*.chatgpt.site/**", handlePublishedRoute);
      return next;
    },
  });
  persistPublishedPresentationWrites = false;
  publishedPresentation = {
    canEdit: true,
    presentation: {},
    revision: 0,
  };
  const publishedTitles = await publishedPage.locator("main .component-title-text").allInnerTexts();
  const initialPublishedValue = await publishedPage
    .locator('[data-component-id="active-users"] .metric-value')
    .innerText();
  publishedSnapshot = structuredClone(dataAppSnapshot);
  const latestReviewedUsage = publishedSnapshot.queries.usage_summary.rows.findLast(
    ({ segment, region }) => segment === "all" && region === "all",
  );
  latestReviewedUsage.activeUsers += 2000;
  publishedSnapshot.queries.usage_summary.source.tables = [
    {
      name: "analytics.product_adoption_summary",
      href: "https://catalog.example.com/product-adoption",
      trust: {
        provider: "Snowflake",
        uniqueUsers: 207,
        queryCount: 8967,
        windowDays: 30,
        usageAsOf: "2026-09-04T12:00:00.000Z",
        lastQueriedAt: "2026-09-03T12:00:00.000Z",
        usageNote: "Successful queries, including reads through views.",
        verified: true,
      },
    },
    {
      name: "analytics.product_adoption_history",
      trust: {
        provider: "Snowflake",
        queryCount: 0,
        windowDays: 30,
        usageAsOf: "2026-09-04T12:00:00.000Z",
      },
    },
  ];
  publishedSnapshot.queries.usage_summary.source.links = [
    {
      kind: "dashboard",
      label: "Weekly revenue overview",
      href: "https://bi.example.com/revenue",
      trust: {
        provider: "Omni",
        viewCount: 123,
        favoriteCount: 17,
        editedAt: "2026-08-10T12:00:00.000Z",
      },
    },
  ];
  await publishedPage.reload({ waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  assert.notEqual(
    await publishedPage.locator('[data-component-id="active-users"] .metric-value').innerText(),
    initialPublishedValue,
    "Refreshing reviewed data must update its source-backed metric",
  );
  assert.deepEqual(
    await publishedPage.locator("main .component-title-text").allInnerTexts(),
    publishedTitles,
    "Refreshing reviewed data must not rewrite authored dashboard or chart headings",
  );
  const publishedMetric = publishedPage.locator('[data-component-id="active-users"]');
  await publishedMetric.getByRole("button", { name: "Weekly active accounts actions" }).click();
  await publishedPage.getByRole("menuitem", { name: "View data source" }).click();
  const reviewedSource = publishedPage.getByRole("complementary", {
    name: "Data source for Weekly active accounts",
  });
  await reviewedSource.getByText("Sources", { exact: true }).waitFor();
  assert.equal(
    await reviewedSource.getByText("Sources", { exact: true }).count(),
    1,
    "Tables and related dashboards should appear together under one Sources heading",
  );
  const tableSource = reviewedSource.locator('.source-row[data-source-kind="table"]')
    .filter({ hasText: "analytics.product_adoption_summary" });
  const unusedTableSource = reviewedSource.locator('.source-row[data-source-kind="table"]')
    .filter({ hasText: "analytics.product_adoption_history" });
  const dashboardSource = reviewedSource.locator('.source-row[data-source-kind="dashboard"]');
  assert.equal(
    await tableSource.locator(".source-row-title").innerText(),
    "analytics.product_adoption_summary",
    "Table rows should show their complete reviewed warehouse identifier",
  );
  assert.equal(
    await tableSource.getAttribute("title"),
    null,
    "Complete table identifiers must not generate redundant native browser tooltips",
  );
  assert.equal(
    await tableSource.getAttribute("href"),
    "https://catalog.example.com/product-adoption",
    "Tables with reviewed catalog URLs must open their canonical source asset",
  );
  assert.equal(await tableSource.locator('[data-dashboard-icon="database"]').count(), 1);
  assert.equal(await dashboardSource.locator('[data-dashboard-icon="monitor"]').count(), 1);
  assert.match(
    await tableSource.locator(".source-trust").innerText(),
    /Table · Snowflake · 207 users · 8,967 queries over 30 days ending Sep 4, 2026 · Last queried Sep 3, 2026 · Verified/u,
    "Table usage must retain its observed population, fixed reporting window, and last query date after loading a published snapshot",
  );
  assert.equal(await tableSource.locator(".source-usage-note").innerText(),
    "Successful queries, including reads through views.",
    "The source row must show the provider's counting scope separately from usage metrics");
  assert.equal(await unusedTableSource.locator(".source-trust").innerText(),
    "Table · Snowflake · 0 queries over 30 days ending Sep 4, 2026",
    "An observed zero must remain visible without inventing a last query date");
  assert.equal(await unusedTableSource.locator(".source-usage-note").count(), 0,
    "Usage notes must remain scoped to their source table");
  assert.equal(
    await reviewedSource.locator('.source-row [data-dashboard-icon="check"]').count(),
    0,
    "Source verification should not add a separate checkmark",
  );
  assert.equal(
    await reviewedSource.locator('.source-row [role="tooltip"]').count(),
    0,
    "Source verification should not add a separate tooltip",
  );
  assert.match(
    await dashboardSource.locator(".source-trust").innerText(),
    /Dashboard · Omni · 123 views · 17 favorites · Edited Aug 10/u,
    "External source assets should display only the adoption signals their provider supplies",
  );
  assert.doesNotMatch(
    await dashboardSource.locator(".source-trust").innerText(),
    /Verified/u,
    "Unverified assets must not inherit another source's verified status",
  );
  assert.doesNotMatch(
    await dashboardSource.locator(".source-trust").innerText(),
    /Last \d+ days/u,
    "A provider without a documented reporting window must not invent one",
  );
  const externalArrow = dashboardSource.locator('[data-dashboard-icon="arrowUpRight"]');
  const sourceTitle = dashboardSource.locator(".source-row-title");
  const unhoveredTitleColor = await sourceTitle.evaluate((element) => getComputedStyle(element).color);
  assert.equal(
    await externalArrow.evaluate((element) => getComputedStyle(element).opacity),
    "0",
    "The external-link indicator should remain hidden until interaction",
  );
  await dashboardSource.hover();
  await publishedPage.waitForFunction(
    (element) => getComputedStyle(element).opacity === "1",
    await externalArrow.elementHandle(),
  );
  assert.equal(
    await externalArrow.evaluate((element) => getComputedStyle(element).opacity),
    "1",
    "Hovering a source row should reveal its external-link indicator",
  );
  assert.equal(
    await sourceTitle.evaluate((element) => getComputedStyle(element).color),
    unhoveredTitleColor,
    "Hovering a source link should not change its neutral text color",
  );
  await reviewedSource.getByRole("button", { name: "Close data source" }).click();
  const publishedChartUrl = publishedPage.url();
  await verifyChartPngDownload({
    page: publishedPage,
    chart: publishedPage.locator('[data-component-id="usage-trend"]'),
    actionsLabel: "Active accounts over time actions",
    expectedFilename: "Active-accounts-over-time.png",
  });
  assert.equal(
    publishedPage.url(),
    publishedChartUrl,
    "Published chart downloads should remain local browser downloads without navigating the Site",
  );
  assert.equal(await publishedPage.evaluate(() => typeof window.openai), "undefined");
  await verifyPublishedDashboardActions(publishedPage);
  const previousPublishedLinkCount = await publishedPage.evaluate(() => window.__dashboardDeepLinks.length);
  await publishedPage.getByRole("button", { name: "Ask ChatGPT" }).click();
  await publishedPage.getByRole("dialog", { name: "Ask ChatGPT about this dashboard" })
    .getByRole("link", { name: "Share key insights" }).click();
  await chooseHostedHandoff(publishedPage, "web");
  await publishedPage.waitForFunction(
    (count) => window.__dashboardDeepLinks.length === count + 1,
    previousPublishedLinkCount,
  );
  const publishedShare = new URL(await publishedPage.evaluate(() => window.__dashboardDeepLinks.at(-1)));
  assert.equal(`${publishedShare.origin}${publishedShare.pathname}`, "https://chatgpt.com/");
  assert.match(
    publishedShare.searchParams.get("q"),
    /\[@Data\]\(plugin:\/\/data-analytics@openai-curated-remote\) and invoke \$share-artifact-summary/u,
    "Published sharing must explicitly invoke its dedicated Data skill",
  );
  assert.doesNotMatch(publishedShare.toString(), sensitivePreviewPattern);

  await publishedMetric.getByRole("button", { name: "Weekly active accounts actions" }).click();
  const publishedMetricMenu = publishedPage.getByRole("menu", {
    name: "Weekly active accounts actions",
  });
  assert.equal(
    await publishedPage.getByRole("menuitem", { name: "Copy chart link" }).count(),
    0,
    "Published metrics must not expose obsolete chart-specific share labels",
  );
  assert.equal(
    await publishedPage.getByRole("menuitem", { name: "Copy chart detail link" }).count(),
    0,
    "Published chart detail permalinks must not be offered for metrics or other non-chart components",
  );
  assert.equal(
    await publishedMetricMenu.getByRole("menuitem", { name: "Copy widget link" }).count(),
    0,
    "Published metrics must not expose obsolete widget-specific share labels",
  );
  assert.equal(
    await publishedMetricMenu.getByRole("menuitem", { name: "Copy link", exact: true }).count(),
    1,
    "A published dashboard metric must offer exactly one plainly labeled Copy link action",
  );
  await publishedPage.keyboard.press("Escape");

  const publishedComponents = [
    { id: "active-users", kind: "metric", title: "Weekly active accounts" },
    { id: "growth", kind: "metric", title: "Week-over-week growth" },
    { id: "conversion", kind: "metric", title: "Activation rate" },
    { id: "forecast-gap", kind: "metric", title: "Forecast to target" },
    { id: "usage-trend", kind: "chart", title: "Active accounts over time" },
    { id: "segment-composition", kind: "chart", title: "Active accounts by product over time" },
    { id: "channel-composition", kind: "chart", title: "Share of activations by source" },
    { id: "activation-funnel", kind: "chart", title: "Account activation journey" },
    { id: "engagement-heatmap", kind: "chart", title: "When customers are most active" },
    { id: "engagement-scatter", kind: "chart", title: "Account size by engagement" },
    { id: "growth-drivers", kind: "chart", title: "Weekly change in active accounts" },
    { id: "forecast-outlook", kind: "custom", title: "Target attainment" },
    { id: "adoption-scenario", kind: "chart", title: "Projected active accounts" },
    { id: "segment-breakdown", kind: "chart", title: "Active accounts by feature" },
    { id: "priority-accounts", kind: "custom", title: "Active accounts by region" },
    { id: "usage-details", kind: "table", title: "Reviewed account-level evidence" },
  ];
  assert.deepEqual(
    await publishedPage.locator("[data-component-id]").evaluateAll((components) =>
      components.map((component) => ({
        id: component.dataset.componentId,
        kind: component.dataset.componentKind,
        title: component.querySelector(".component-title-text").textContent.trim(),
      })),
    ),
    publishedComponents,
    "The published starter must exercise stable identities and share actions for every triple-dot component",
  );

  const dashboardOrigin = "https://dashboard.chatgpt.site";
  const componentShortIdPattern = /^[A-Za-z0-9_-]{8}$/u;
  const componentAliases = new Map();
  let copiedPublishedLinks = 1;
  for (const widget of publishedComponents.filter(({ kind }) => kind !== "chart")) {
    const component = publishedPage.locator(`[data-component-id="${widget.id}"]`);
    await component.getByRole("button", { name: `${widget.title} actions` }).click();
    const componentMenu = publishedPage.getByRole("menu", {
      name: `${widget.title} actions`,
    });
    const copyLink = componentMenu.getByRole("menuitem", {
      name: "Copy link",
      exact: true,
    });
    assert.equal(
      await copyLink.count(),
      1,
      `${widget.id} ${widget.kind} must offer exactly one plainly labeled Copy link action`,
    );
    assert.equal(
      await componentMenu.getByRole("menuitem", { name: "Copy widget link" }).count(),
      0,
      `${widget.id} ${widget.kind} must not expose an obsolete widget-specific share label`,
    );
    assert.equal(
      await componentMenu.getByRole("menuitem", { name: "Copy chart link" }).count(),
      0,
      `${widget.id} ${widget.kind} must not expose an obsolete chart-specific share label`,
    );
    assert.equal(
      await componentMenu.getByRole("menuitem", { name: "Copy chart detail link" }).count(),
      0,
      `${widget.id} ${widget.kind} must not expose chart-detail editing`,
    );
    await copyLink.click();
    copiedPublishedLinks += 1;
    await publishedPage.waitForFunction(
      (length) => window.__dashboardClipboard.length === length,
      copiedPublishedLinks,
    );
    await publishedPage
      .getByRole("status")
      .filter({ hasText: `${widget.title} link copied` })
      .waitFor();
    const copiedUrl = new URL(await publishedPage.evaluate(() => window.__dashboardClipboard.at(-1)));
    const alias = copiedUrl.pathname.split("/").at(-1);
    assert.match(
      alias,
      componentShortIdPattern,
      `${widget.id} ${widget.kind} must receive an exactly eight-character URL-safe permalink identity`,
    );
    assert.equal(
      alias,
      componentPermalinkShortId(dashboardOrigin, widget.id),
      `${widget.id} ${widget.kind} short identity must derive deterministically from the canonical Site origin`,
    );
    assert.equal(
      copiedUrl.href,
      completeViewUrl(`${dashboardOrigin}/_data/components/${alias}`),
      `${widget.id} ${widget.kind} must copy its stable, origin-rooted compact widget permalink`,
    );
    assert.equal(
      copiedUrl.pathname.includes(widget.id),
      false,
      `${widget.id} ${widget.kind} permalink must never expose its authored component slug`,
    );
    componentAliases.set(widget.id, alias);
    assert.equal(copiedUrl.search, "?view=1&tab=dashboard", `${widget.id} widget permalink includes only the current view, without tokens`);
    assert.equal(copiedUrl.hash, "", `${widget.id} widget permalink must never include private fragments`);
    assert.doesNotMatch(
      copiedUrl.href,
      sensitivePreviewPattern,
      `${widget.id} widget permalink must never expose credentials or originating task context`,
    );
  }

  const publishedCharts = publishedComponents.filter(({ kind }) => kind === "chart");
  assert.deepEqual(
    await publishedPage
      .locator('[data-component-kind="chart"]')
      .evaluateAll((charts) => charts.map(({ dataset }) => dataset.componentId)),
    publishedCharts.map(({ id }) => id),
    "Every chart in the published starter must exercise its stable permalink",
  );
  for (const chart of publishedCharts) {
    const component = publishedPage.locator(`[data-component-id="${chart.id}"]`);
    await component.getByRole("button", { name: `${chart.title} actions` }).click();
    const componentMenu = publishedPage.getByRole("menu", {
      name: `${chart.title} actions`,
    });
    const copyLink = componentMenu.getByRole("menuitem", {
      name: "Copy link",
      exact: true,
    });
    assert.equal(await copyLink.count(), 1, `${chart.id} must expose exactly one plainly labeled Copy link action`);
    assert.equal(
      await componentMenu.getByRole("menuitem", { name: "Copy widget link" }).count(),
      0,
      `${chart.id} must not expose an obsolete widget-specific share label`,
    );
    assert.equal(
      await componentMenu.getByRole("menuitem", { name: "Copy chart link" }).count(),
      0,
      `${chart.id} must not expose an obsolete chart-specific share label`,
    );
    assert.equal(
      await componentMenu.getByRole("menuitem", { name: "Copy chart detail link" }).count(),
      0,
      `${chart.id} must not expose a redundant chart-detail sharing action`,
    );
    await copyLink.click();
    copiedPublishedLinks += 1;
    await publishedPage.waitForFunction(
      (length) => window.__dashboardClipboard.length === length,
      copiedPublishedLinks,
    );
    await publishedPage
      .getByRole("status")
      .filter({ hasText: `${chart.title} link copied` })
      .waitFor();
    const copiedUrl = new URL(await publishedPage.evaluate(() => window.__dashboardClipboard.at(-1)));
    const alias = copiedUrl.pathname.split("/").at(-1);
    assert.match(
      alias,
      componentShortIdPattern,
      `${chart.id} must receive an exactly eight-character URL-safe chart permalink identity`,
    );
    assert.equal(
      alias,
      componentPermalinkShortId(dashboardOrigin, chart.id),
      `${chart.id} short identity must derive deterministically from the canonical Site origin`,
    );
    assert.equal(
      copiedUrl.href,
      completeViewUrl(`${dashboardOrigin}/_data/charts/${alias}`),
      `${chart.id} must copy its stable, origin-rooted compact chart permalink`,
    );
    assert.equal(
      copiedUrl.pathname.includes(chart.id),
      false,
      `${chart.id} chart permalink must never expose its authored component slug`,
    );
    componentAliases.set(chart.id, alias);
    assert.equal(copiedUrl.search, "?view=1&tab=dashboard", `${chart.id} permalink includes only the current view, without access tokens`);
    assert.equal(copiedUrl.hash, "", `${chart.id} permalink must never include fragments or Codex task IDs`);
    assert.doesNotMatch(
      copiedUrl.href,
      sensitivePreviewPattern,
      `${chart.id} permalink must never expose dashboard credentials or originating task context`,
    );
  }
  assert.equal(
    componentAliases.size,
    publishedComponents.length,
    "Every authored dashboard component must receive a shareable eight-character opaque permalink identity",
  );
  assert.equal(
    new Set(componentAliases.values()).size,
    publishedComponents.length,
    "Every chart, metric, custom card, and table must receive a distinct compact permalink identity",
  );

  const metricPermalink = `${dashboardOrigin}/_data/components/${componentAliases.get("active-users")}`;
  const chartPermalink = `${dashboardOrigin}/_data/charts/${componentAliases.get("usage-trend")}`;
  const secondaryPermalink = `${dashboardOrigin}/_data/charts/${componentAliases.get("segment-breakdown")}`;
  await publishedPage.reload({ waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  const reloadedMetric = publishedPage.locator('[data-component-id="active-users"]');
  await reloadedMetric.getByRole("button", { name: "Weekly active accounts actions" }).click();
  await publishedPage
    .getByRole("menu", { name: "Weekly active accounts actions" })
    .getByRole("menuitem", { name: "Copy link", exact: true })
    .click();
  await publishedPage.waitForFunction(() => window.__dashboardClipboard.length === 1);
  assert.deepEqual(
    await publishedPage.evaluate(() => window.__dashboardClipboard),
    [completeViewUrl(metricPermalink)],
    "Reloading a dirty dashboard URL must preserve the same clean compact component identity",
  );

  publishedPresentation = {
    canEdit: true,
    presentation: { componentTitles: { "active-users": "Renamed users" } },
    revision: 0,
  };
  await publishedPage.goto(metricPermalink, { waitUntil: "load" });
  const renamedMetric = publishedPage.locator('[data-component-id="active-users"]');
  await renamedMetric.getByRole("button", { name: "Renamed users actions" }).click();
  await publishedPage
    .getByRole("menu", { name: "Renamed users actions" })
    .getByRole("menuitem", { name: "Copy link", exact: true })
    .click();
  await publishedPage.waitForFunction(() => window.__dashboardClipboard.length === 1);
  assert.deepEqual(
    await publishedPage.evaluate(() => window.__dashboardClipboard),
    [completeViewUrl(metricPermalink)],
    "Renaming dashboard presentation text must never change a component's stable compact identity",
  );

  publishedPresentation = { canEdit: true, presentation: {}, revision: 0 };
  const alternateOrigin = "https://alternate-dashboard.chatgpt.site";
  await publishedPage.goto(`${alternateOrigin}/?token=other-site#private-section`, {
    waitUntil: "load",
  });
  await waitForDashboardTitle(publishedPage);
  for (const [index, component] of [
    { id: "active-users", title: "Weekly active accounts", family: "components" },
    { id: "usage-trend", title: "Active accounts over time", family: "charts" },
  ].entries()) {
    const target = publishedPage.locator(`[data-component-id="${component.id}"]`);
    await target.getByRole("button", { name: `${component.title} actions` }).click();
    await publishedPage
      .getByRole("menu", { name: `${component.title} actions` })
      .getByRole("menuitem", { name: "Copy link", exact: true })
      .click();
    await publishedPage.waitForFunction((length) => window.__dashboardClipboard.length === length, index + 1);
    const copiedUrl = new URL(await publishedPage.evaluate(() => window.__dashboardClipboard.at(-1)));
    const alternateAlias = copiedUrl.pathname.split("/").at(-1);
    assert.match(
      alternateAlias,
      componentShortIdPattern,
      `${component.id} must retain exactly eight URL-safe characters on a second hosted Site`,
    );
    assert.equal(
      alternateAlias,
      componentPermalinkShortId(alternateOrigin, component.id),
      `${component.id} must scope its deterministic compact identity to the second Site origin`,
    );
    assert.notEqual(
      alternateAlias,
      componentAliases.get(component.id),
      `${component.id} must not expose the same compact identity across different Site origins`,
    );
    assert.equal(
      copiedUrl.href,
      completeViewUrl(`${alternateOrigin}/_data/${component.family}/${alternateAlias}`),
      `${component.id} must preserve its path family and omit private URL state on another Site`,
    );
  }
  await publishedPage.goto(`${alternateOrigin}/_data/components/${componentAliases.get("active-users")}`, {
    waitUntil: "load",
  });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("status").filter({ hasText: "The linked component is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.locator('[data-component-id="active-users"]').getAttribute("data-permalink-target"),
    null,
    "A compact component link copied from another Site origin must not resolve or focus a local widget",
  );

  const legacyPermalinks = [
    {
      id: "active-users",
      url: `${dashboardOrigin}/_data/components/active-users`,
      format: "readable",
    },
    {
      id: "usage-trend",
      url: `${dashboardOrigin}/_data/charts/usage-trend`,
      format: "readable",
    },
    {
      id: "active-users",
      url: `${dashboardOrigin}/_data/components/` + componentPermalinkId(dashboardOrigin, "active-users"),
      format: "full UUID",
    },
    {
      id: "usage-trend",
      url: `${dashboardOrigin}/_data/charts/` + componentPermalinkId(dashboardOrigin, "usage-trend"),
      format: "full UUID",
    },
  ];
  for (const legacy of legacyPermalinks) {
    await publishedPage.goto(legacy.url, { waitUntil: "load" });
    await publishedPage.waitForFunction((id) => {
      const target = [...document.querySelectorAll("[data-component-id]")].find(
        (component) => component.dataset.componentId === id,
      );
      return !!target && (document.activeElement === target || target.contains(document.activeElement));
    }, legacy.id);
    assert.equal(
      publishedPage.url(),
      completeViewUrl(legacy.url),
      `${legacy.id} legacy ${legacy.format} permalink must continue resolving without changing its route`,
    );
  }
  const legacyChartPermalink = `${dashboardOrigin}/_data/charts/usage-trend`;
  await publishedPage.goto(`${legacyChartPermalink}/detail`, { waitUntil: "load" });
  const legacyExplorer = publishedPage.getByRole("dialog", { name: "Active accounts over time" });
  await legacyExplorer.waitFor();
  await legacyExplorer.getByRole("button", { name: "Cancel", exact: true }).click();
  await legacyExplorer.waitFor({ state: "hidden" });
  assert.equal(
    publishedPage.url(),
    completeViewUrl(legacyChartPermalink),
    "Closing a legacy readable chart detail must preserve its original readable chart token",
  );
  const legacyUuidChartPermalink =
    `${dashboardOrigin}/_data/charts/` + componentPermalinkId(dashboardOrigin, "usage-trend");
  await publishedPage.goto(`${legacyUuidChartPermalink}/detail`, {
    waitUntil: "load",
  });
  await legacyExplorer.waitFor();
  await legacyExplorer.getByRole("button", { name: "Cancel", exact: true }).click();
  await legacyExplorer.waitFor({ state: "hidden" });
  assert.equal(
    publishedPage.url(),
    completeViewUrl(legacyUuidChartPermalink),
    "Closing an existing full-UUID chart detail must preserve its original full-UUID chart token",
  );

  await publishedPage.emulateMedia({ reducedMotion: "reduce" });
  const widgetSamples = [
    { id: "active-users", kind: "metric", title: "Weekly active accounts" },
    { id: "forecast-outlook", kind: "custom", title: "Target attainment" },
    { id: "usage-details", kind: "table", title: "Reviewed account-level evidence" },
    { id: "usage-trend", kind: "chart", title: "Active accounts over time" },
  ];
  const presentationWritesBeforeWidgetPermalinks = publishedPresentationWrites.length;
  for (const widget of widgetSamples) {
    const widgetUrl = `${dashboardOrigin}/_data/components/${componentAliases.get(widget.id)}`;
    await publishedPage.goto(
      widget.id === "active-users"
        ? `${widgetUrl}?token=secret&codexThreadId=${originatingThreadId}#private-section`
        : widgetUrl,
      { waitUntil: "load" },
    );
    await waitForDashboardTitle(publishedPage);
    await publishedPage.waitForFunction((id) => {
      const target = [...document.querySelectorAll("[data-component-id]")].find(
        (component) => component.dataset.componentId === id,
      );
      return !!target && (document.activeElement === target || target.contains(document.activeElement));
    }, widget.id);
    const component = publishedPage.locator(`[data-component-id="${widget.id}"]`);
    assert.equal(
      await component.getByRole("heading", { name: widget.title, level: 2 }).count(),
      1,
      `${widget.id} ${widget.kind} permalink must preserve its descriptive accessible heading`,
    );
    const widgetFocus = await component.evaluate((target) => {
      const style = getComputedStyle(target);
      const bounds = target.getBoundingClientRect();
      return {
        tabIndex: target.getAttribute("tabindex"),
        permalinkTarget: target.getAttribute("data-permalink-target"),
        outline: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        animationName: style.animationName,
        top: bounds.top,
        bottom: bounds.bottom,
        viewportHeight: innerHeight,
      };
    });
    assert.equal(widgetFocus.tabIndex, "-1", `${widget.id} ${widget.kind} must accept programmatic focus`);
    assert.equal(widgetFocus.permalinkTarget, "true", `${widget.id} ${widget.kind} must identify its target`);
    assert.ok(
      widgetFocus.outline !== "none" && Number.parseFloat(widgetFocus.outlineWidth) > 0,
      `${widget.id} ${widget.kind} must have a visible target outline: ${JSON.stringify(widgetFocus)}`,
    );
    assert.equal(
      widgetFocus.animationName,
      "none",
      `${widget.id} ${widget.kind} target animation must honor reduced motion`,
    );
    assert.ok(
      widgetFocus.bottom > 0 && widgetFocus.top < widgetFocus.viewportHeight,
      `${widget.id} ${widget.kind} must scroll into the viewport: ${JSON.stringify(widgetFocus)}`,
    );
    const widgetScrolls = await publishedPage.evaluate(
      (id) => window.__dashboardScrollCalls.filter(({ componentId }) => componentId === id),
      widget.id,
    );
    assert.ok(
      widgetScrolls.some(({ options }) => options?.block === "center"),
      `${widget.id} ${widget.kind} must request centered scrolling: ${JSON.stringify(widgetScrolls)}`,
    );
    assert.equal(
      widgetScrolls.some(({ options }) => options?.behavior === "smooth"),
      false,
      `${widget.id} ${widget.kind} scrolling must honor reduced motion`,
    );
    assert.equal(
      await publishedPage.getByRole("dialog").count(),
      0,
      `${widget.id} ${widget.kind} component permalink must not open a chart-detail editor`,
    );

    await component.getByRole("button", { name: `${widget.title} actions` }).click();
    await publishedPage.getByRole("menuitem", { name: "View data source" }).click();
    const widgetSource = publishedPage.getByRole("complementary", {
      name: `Data source for ${widget.title}`,
    });
    await widgetSource.waitFor();
    await widgetSource.getByRole("tab", { name: "SQL query" }).click();
    assert.match(
      await widgetSource.innerText(),
      /FROM/u,
      `${widget.id} ${widget.kind} permalink must retain reviewed source evidence`,
    );
    await widgetSource.getByRole("button", { name: "Close data source" }).click();

    if (widget.id === "active-users") {
      await publishedPage.getByRole("button", { name: "More", exact: true }).click();
      await publishedPage
        .getByRole("menu", { name: "More", exact: true })
        .getByRole("menuitem", { name: "Copy link", exact: true })
        .click();
      await publishedPage.waitForFunction(() => window.__dashboardClipboard.length === 1);
      assert.deepEqual(
        await publishedPage.evaluate(() => window.__dashboardClipboard),
        [completeViewUrl("https://dashboard.chatgpt.site/")],
        "Dashboard sharing from a widget permalink must copy the canonical Site root without private state",
      );
      await component.getByRole("button", { name: `${widget.title} actions` }).click();
      await publishedPage
        .getByRole("menu", { name: `${widget.title} actions` })
        .getByRole("menuitem", { name: "Copy link", exact: true })
        .click();
      await publishedPage.waitForFunction(() => window.__dashboardClipboard.length === 2);
      assert.equal(
        await publishedPage.evaluate(() => window.__dashboardClipboard.at(-1)),
        completeViewUrl(metricPermalink),
        "A widget permalink must remain canonical when copied from its own dirty route",
      );
      await verifyWidgetPermalinkPdfExport(publishedPage);
    }
  }
  assert.equal(
    publishedPresentationWrites.length,
    presentationWritesBeforeWidgetPermalinks,
    "Opening, inspecting, or copying widget permalinks must never mutate shared presentation state",
  );

  await publishedPage.goto(chartPermalink, { waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.waitForFunction(() => {
    const target = document.querySelector('[data-component-id="usage-trend"]');
    return !!target && (document.activeElement === target || target.contains(document.activeElement));
  });
  const focusedTrend = publishedPage.locator('[data-component-id="usage-trend"]');
  assert.equal(
    await focusedTrend.getByRole("heading", { name: "Active accounts over time", level: 2 }).count(),
    1,
    "A focused chart permalink must retain its descriptive, accessible chart heading",
  );
  const chartFocus = await focusedTrend.evaluate((component) => {
    const bounds = component.getBoundingClientRect();
    const style = getComputedStyle(component);
    return {
      tabIndex: component.getAttribute("tabindex"),
      className: component.className,
      permalinkTarget:
        component.getAttribute("data-permalink-target") ?? component.getAttribute("data-chart-permalink-target"),
      outline: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
      animationName: style.animationName,
      top: bounds.top,
      bottom: bounds.bottom,
      viewportHeight: innerHeight,
    };
  });
  assert.equal(chartFocus.tabIndex, "-1", "Linked charts must become programmatically keyboard-focusable");
  assert.equal(chartFocus.permalinkTarget, "true", "Linked charts must expose their semantic target marker");
  assert.ok(
    chartFocus.outline !== "none" && Number.parseFloat(chartFocus.outlineWidth) > 0,
    `Linked charts must receive a visible, accessible target treatment: ${JSON.stringify(chartFocus)}`,
  );
  assert.equal(
    chartFocus.animationName,
    "none",
    "Linked chart highlighting must disable animation for viewers who prefer reduced motion",
  );
  assert.ok(
    Math.abs((chartFocus.top + chartFocus.bottom) / 2 - chartFocus.viewportHeight / 2) <= 64,
    `Linked charts must scroll to the center of the viewport: ${JSON.stringify(chartFocus)}`,
  );
  const chartScrolls = await publishedPage.evaluate(() =>
    window.__dashboardScrollCalls.filter(({ componentId }) => componentId === "usage-trend"),
  );
  assert.ok(
    chartScrolls.some(({ options }) => options?.block === "center"),
    `Linked charts must request centered scrolling: ${JSON.stringify(chartScrolls)}`,
  );
  assert.equal(
    chartScrolls.some(({ options }) => options?.behavior === "smooth"),
    false,
    "Linked chart scrolling must honor prefers-reduced-motion",
  );

  await focusedTrend.getByRole("button", { name: "Active accounts over time actions" }).click();
  await publishedPage.getByRole("menuitem", { name: "View data source" }).click();
  const linkedSource = publishedPage.getByRole("complementary", { name: "Data source for Active accounts over time" });
  await linkedSource.waitFor();
  await linkedSource.getByRole("tab", { name: "SQL query" }).click();
  assert.match(
    await linkedSource.innerText(),
    /FROM/u,
    "Chart permalinks must preserve access to the chart's reviewed data source",
  );
  await linkedSource.getByRole("button", { name: "Close data source" }).click();

  await publishedPage.getByRole("button", { name: "More", exact: true }).click();
  await publishedPage
    .getByRole("menu", { name: "More", exact: true })
    .getByRole("menuitem", { name: "Copy link", exact: true })
    .click();
  await publishedPage.waitForFunction(() => window.__dashboardClipboard.length === 1);
  assert.deepEqual(
    await publishedPage.evaluate(() => window.__dashboardClipboard),
    [completeViewUrl("https://dashboard.chatgpt.site/")],
    "Dashboard-level sharing from a chart permalink must still copy the canonical Site root",
  );

  await publishedPage.goto(`${chartPermalink}/detail`, { waitUntil: "load" });
  const linkedExplorer = publishedPage.getByRole("dialog", { name: "Active accounts over time" });
  await linkedExplorer.waitFor();
  assert.equal(
    await linkedExplorer.getByRole("button", { name: "Chart type" }).count(),
    1,
    "A chart /detail permalink must open the existing accessible chart explorer",
  );
  for (const [index, dismiss] of ["close", "escape"].entries()) {
    const privateContext = `?token=private-${dismiss}#codexThreadId=${originatingThreadId}`;
    await publishedPage.goto(`${chartPermalink}/detail${privateContext}`, {
      waitUntil: "load",
    });
    await linkedExplorer.waitFor();
    await publishedPage.evaluate(
      (method) => history.replaceState({ reviewDismissal: method }, "", location.href),
      dismiss,
    );
    const historyBeforeDismissal = await publishedPage.evaluate(() => ({
      length: history.length,
      state: history.state,
      replacements: window.__dashboardHistoryReplacements.length,
    }));
    if (dismiss === "close") await linkedExplorer.getByRole("button", { name: "Cancel", exact: true }).click();
    else await publishedPage.keyboard.press("Escape");
    await linkedExplorer.waitFor({ state: "hidden" });
    assert.equal(
      publishedPage.url(),
      completeViewUrl(`${chartPermalink}${privateContext}`),
      `${dismiss} must replace only the chart detail pathname and preserve browser-local context`,
    );
    const historyAfterDismissal = await publishedPage.evaluate(() => ({
      length: history.length,
      state: history.state,
      replacements: window.__dashboardHistoryReplacements,
    }));
    assert.equal(
      historyAfterDismissal.length,
      historyBeforeDismissal.length,
      `${dismiss} must replace the current history entry without pushing another route`,
    );
    assert.deepEqual(
      historyAfterDismissal.state,
      historyBeforeDismissal.state,
      `${dismiss} must preserve existing browser history state`,
    );
    assert.equal(
      historyAfterDismissal.replacements.length,
      historyBeforeDismissal.replacements + 1,
      `${dismiss} must perform exactly one route-owned chart detail history replacement`,
    );
    assert.equal(
      new URL(historyAfterDismissal.replacements.at(-1).url, chartPermalink).pathname,
      new URL(chartPermalink).pathname,
      `${dismiss} must leave the original eight-character chart token unchanged in browser history`,
    );

    if (index === 0) {
      await publishedPage.getByRole("button", { name: "Refresh data" }).click();
      await publishedPage.getByRole("menuitem", { name: "Refresh now" }).click();
      await chooseHostedHandoff(publishedPage, "web");
      await publishedPage.waitForFunction(() => window.__dashboardDeepLinks.length === 1);
      const bridgeAction = new URL(await publishedPage.evaluate(() => window.__dashboardDeepLinks[0]));
      assert.equal(
        `${bridgeAction.origin}${bridgeAction.pathname}`,
        "https://chatgpt.com/",
        "Closing route-owned chart details must preserve the supported ChatGPT handoff",
      );
      assert.match(
        bridgeAction.searchParams.get("q"),
        /https:\/\/dashboard\.chatgpt\.site\//u,
        "The handoff prompt must retain the clean canonical dashboard URL",
      );
      assert.doesNotMatch(
        bridgeAction.toString(),
        /token=private|codexThreadId/u,
        "Browser-local tokens and task fragments must not leak into exported dashboard action URLs",
      );
      await publishedPage.getByRole("button", { name: "More", exact: true }).click();
      await publishedPage
        .getByRole("menu", { name: "More", exact: true })
        .getByRole("menuitem", { name: "Copy link", exact: true })
        .click();
      assert.deepEqual(
        await publishedPage.evaluate(() => window.__dashboardClipboard),
        [completeViewUrl("https://dashboard.chatgpt.site/")],
        "Closing chart details must never copy private browser query or task-fragment context",
      );
    }

    await publishedPage.reload({ waitUntil: "load" });
    await waitForDashboardTitle(publishedPage);
    assert.equal(
      publishedPage.url(),
      completeViewUrl(`${chartPermalink}${privateContext}`),
      `Reload after ${dismiss} must retain private browser context on the plain chart route`,
    );
    assert.equal(
      await publishedPage.getByRole("dialog", { name: "Active accounts over time" }).count(),
      0,
      `Reload after ${dismiss} must not reopen a dismissed route-owned chart explorer`,
    );
  }

  const manuallyOpenedChart = publishedPage.locator('[data-component-id="usage-trend"]');
  const manualChartUrl = publishedPage.url();
  const manualHistoryReplacements = await publishedPage.evaluate(() => window.__dashboardHistoryReplacements.length);
  await manuallyOpenedChart.getByRole("button", { name: "Active accounts over time actions" }).click();
  await publishedPage.getByRole("menuitem", { name: "Edit chart" }).click();
  await linkedExplorer.waitFor();
  await linkedExplorer.getByRole("button", { name: "Cancel", exact: true }).click();
  await linkedExplorer.waitFor({ state: "hidden" });
  assert.equal(
    publishedPage.url(),
    manualChartUrl,
    "Closing an editor opened manually must never rewrite its unrelated chart URL",
  );
  assert.equal(
    await publishedPage.evaluate(() => window.__dashboardHistoryReplacements.length),
    manualHistoryReplacements,
    "Closing a manually opened chart editor must not mutate browser history",
  );

  await publishedPage.goto(`${chartPermalink}/detail`, { waitUntil: "load" });
  await linkedExplorer.waitFor();
  async function navigateChartHistory(pathname, replace = false) {
    await publishedPage.evaluate(
      ({ nextPathname, replaceEntry }) => {
        history[replaceEntry ? "replaceState" : "pushState"]({ chartPermalinkSmoke: true }, "", nextPathname);
        dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
      },
      { nextPathname: pathname, replaceEntry: replace },
    );
  }

  await navigateChartHistory(new URL(chartPermalink).pathname, true);
  await linkedExplorer.waitFor({ state: "hidden" });
  assert.equal(
    publishedPage.url(),
    completeViewUrl(chartPermalink),
    "Navigating from a chart detail to its plain route must close the route-owned chart explorer",
  );
  await navigateChartHistory(`${new URL(chartPermalink).pathname}/detail`);
  await linkedExplorer.waitFor();
  await publishedPage.goBack();
  await linkedExplorer.waitFor({ state: "hidden" });
  assert.equal(
    publishedPage.url(),
    completeViewUrl(chartPermalink),
    "Browser Back from a chart detail must close its route-owned chart explorer",
  );
  await publishedPage.goForward();
  await linkedExplorer.waitFor();
  assert.equal(
    publishedPage.url(),
    completeViewUrl(`${chartPermalink}/detail`),
    "Browser Forward to a chart detail must reopen the existing chart explorer",
  );

  await navigateChartHistory(new URL(secondaryPermalink).pathname);
  await linkedExplorer.waitFor({ state: "hidden" });
  await publishedPage.waitForFunction(() => {
    const chart = document.querySelector('[data-component-id="segment-breakdown"]');
    return !!chart && (document.activeElement === chart || chart.contains(document.activeElement));
  });
  assert.equal(
    await publishedPage.getByRole("dialog").count(),
    0,
    "Navigating to a different chart must close the previous chart's route-owned explorer",
  );
  await publishedPage.goBack();
  await linkedExplorer.waitFor();

  await navigateChartHistory(new URL(metricPermalink).pathname);
  await linkedExplorer.waitFor({ state: "hidden" });
  await publishedPage.waitForFunction(() => {
    const metric = document.querySelector('[data-component-id="active-users"]');
    return !!metric && (document.activeElement === metric || metric.contains(document.activeElement));
  });
  assert.equal(
    await publishedPage.getByRole("dialog").count(),
    0,
    "Navigating from chart details to a widget permalink must close the old chart explorer",
  );
  await publishedPage.goBack();
  await linkedExplorer.waitFor();

  await navigateChartHistory("/");
  await linkedExplorer.waitFor({ state: "hidden" });
  assert.equal(
    publishedPage.url(),
    completeViewUrl("https://dashboard.chatgpt.site/"),
    "Navigating to the dashboard root must close a route-owned chart explorer",
  );
  await publishedPage.goBack();
  await linkedExplorer.waitFor();

  await navigateChartHistory("/_data/charts/not-a-chart");
  await linkedExplorer.waitFor({ state: "hidden" });
  await publishedPage.getByRole("status").filter({ hasText: "The linked chart is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.getByRole("dialog").count(),
    0,
    "Navigating to an unavailable chart must close the previous chart's route-owned explorer",
  );
  await publishedPage.goBack();
  await linkedExplorer.waitFor();
  await linkedExplorer.getByRole("button", { name: "Cancel", exact: true }).click();

  publishedHtml = buildAuthoredPublishedFixture("empty-page", (source) =>
    withAuthoredFixturePages(source, { id: "empty-page", label: "Empty page" }, [
      { id: "dashboard", label: "Dashboard" },
    ]),
  );
  publishedPresentation = {
    canEdit: true,
    presentation: {
      tabs: [
        { id: "empty-page", label: "Empty page" },
        { id: "dashboard", label: "Dashboard" },
      ],
    },
    revision: 0,
  };
  await publishedPage.goto(secondaryPermalink, { waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.waitForFunction(() => {
    const target = document.querySelector('[data-component-id="segment-breakdown"]');
    return !!target && (document.activeElement === target || target.contains(document.activeElement));
  });
  await publishedPage.evaluate(() => scrollTo(0, 0));
  const dashboardTab = publishedPage.getByRole("tab", { name: "Dashboard" });
  const emptyTab = publishedPage.getByRole("tab", { name: "Empty page" });
  assert.equal(
    await dashboardTab.getAttribute("aria-selected"),
    "true",
    "Direct chart links must reveal the dashboard tab containing their target",
  );
  assert.equal(await emptyTab.getAttribute("aria-selected"), "false");
  await emptyTab.click();
  await publishedPage.getByRole("heading", { name: "Empty page", level: 1 }).waitFor();
  assert.equal(
    await publishedPage.locator("main").getAttribute("data-dashboard-page"),
    "empty-page",
    "A chart permalink must not trap the viewer on its original dashboard tab",
  );
  await dashboardTab.click();
  await publishedPage.locator('[data-component-id="segment-breakdown"]').waitFor();

  // Author the fixture through the public React API. Matching generated Vite
  // variable names would couple this behavioral regression to one compiler.
  publishedHtml = buildAuthoredPublishedFixture("secondary-tab", (source) => {
    source = withAuthoredFixturePages(source, { id: "first-page", label: "First page" }, [
      { id: "dashboard", label: "Dashboard" },
      { id: "secondary-tab", label: "Secondary tab" },
    ]);
    source = replaceUniqueAuthoredExpression(
      source,
      "metrics.filter(({ id }) => visible(id))",
      'metrics.filter(({ id }) => visible(id) && (id !== "active-users" || fixtureActiveTab === "secondary-tab"))',
      "secondary-tab metric ownership",
    );
    return replaceUniqueAuthoredExpression(
      source,
      'visible("usage-trend") &&',
      'visible("usage-trend") && fixtureActiveTab === "secondary-tab" &&',
      "secondary-tab chart ownership",
    );
  });
  publishedPresentation = {
    canEdit: true,
    presentation: {
      tabs: [
        { id: "first-page", label: "First page" },
        { id: "dashboard", label: "Dashboard" },
        { id: "secondary-tab", label: "Secondary tab" },
      ],
    },
    revision: 0,
  };
  await publishedPage.goto("https://dashboard.chatgpt.site/", {
    waitUntil: "load",
  });
  await publishedPage.getByRole("heading", { name: "First page", level: 1 }).waitFor();
  await publishedPage.getByRole("tab", { name: "Dashboard" }).click();
  await waitForDashboardTitle(publishedPage);
  assert.equal(
    await publishedPage.locator('[data-component-id="active-users"]').count(),
    0,
    "The authored secondary-tab metric fixture must not exist on the primary dashboard",
  );
  assert.equal(
    await publishedPage.locator('[data-component-id="usage-trend"]').count(),
    0,
    "The authored secondary-tab chart fixture must not exist on the primary dashboard",
  );
  await publishedPage.getByRole("tab", { name: "Secondary tab" }).click();
  assert.equal(await publishedPage.locator("main").getAttribute("data-dashboard-page"), "secondary-tab");
  assert.equal(
    await publishedPage.locator('[data-component-id="active-users"]').count(),
    1,
    "The authored fixture must mount an actual metric exclusively on its secondary dashboard tab",
  );
  assert.equal(
    await publishedPage.locator('[data-component-id="usage-trend"]').count(),
    1,
    "The authored fixture must mount an actual chart exclusively on its secondary dashboard tab",
  );

  const presentationWritesBeforeTabProbe = publishedPresentationWrites.length;
  await publishedPage.goto(metricPermalink, { waitUntil: "load" });
  await publishedPage.waitForFunction(() => {
    const target = document.querySelector('[data-component-id="active-users"]');
    return (
      document.querySelector("main")?.dataset.dashboardPage === "secondary-tab" &&
      !!target &&
      (document.activeElement === target || target.contains(document.activeElement))
    );
  });
  assert.equal(
    await publishedPage.locator("main").getAttribute("data-dashboard-page"),
    "secondary-tab",
    "A metric permalink must select the actual owning secondary dashboard tab",
  );
  assert.equal(
    new URL(publishedPage.url()).searchParams.get("tab"),
    "secondary-tab",
    "A legacy metric permalink must keep its discovered owning dashboard tab in the browser URL",
  );
  assert.equal(
    await publishedPage.locator('[data-component-id="active-users"]').getAttribute("data-permalink-target"),
    "true",
    "A secondary-tab metric permalink must focus and visibly highlight its actual target",
  );
  assert.equal(
    await publishedPage.getByRole("status").filter({ hasText: "The linked component is unavailable" }).count(),
    0,
    "A successfully probed secondary-tab metric must not announce an unavailable target",
  );
  assert.equal(
    publishedPresentationWrites.length,
    presentationWritesBeforeTabProbe,
    "Transient dashboard tab probing must not write shared presentation state",
  );

  await publishedPage.goto(`${chartPermalink}/detail`, { waitUntil: "load" });
  const secondaryTabChartExplorer = publishedPage.getByRole("dialog", { name: "Active accounts over time" });
  await secondaryTabChartExplorer.waitFor();
  assert.equal(
    await publishedPage.locator("main").getAttribute("data-dashboard-page"),
    "secondary-tab",
    "A chart detail permalink must select the actual owning secondary dashboard tab",
  );
  assert.equal(
    await publishedPage.locator('[data-component-id="usage-trend"]').getAttribute("data-permalink-target"),
    "true",
    "A secondary-tab chart detail must visibly target the actual authored chart",
  );
  assert.equal(
    publishedPresentationWrites.length,
    presentationWritesBeforeTabProbe,
    "Opening a secondary-tab chart detail must not persist transient dashboard tab probing",
  );
  await secondaryTabChartExplorer.getByRole("button", { name: "Cancel", exact: true }).click();
  await secondaryTabChartExplorer.waitFor({ state: "hidden" });
  assert.equal(
    publishedPage.url(),
    completeViewUrl(`${chartPermalink}?tab=secondary-tab`),
    "Closing a secondary-tab chart detail must preserve its plain chart route and actual owning tab",
  );
  assert.equal(
    await publishedPage.locator("main").getAttribute("data-dashboard-page"),
    "secondary-tab",
    "Closing a secondary-tab chart detail must keep its actual owning tab selected",
  );

  await publishedPage.goto("https://dashboard.chatgpt.site/_data/components/missing-on-every-tab", {
    waitUntil: "load",
  });
  await publishedPage.getByRole("status").filter({ hasText: "The linked component is unavailable" }).waitFor();
  await publishedPage.waitForFunction(() => document.querySelector("main")?.dataset.dashboardPage === "first-page");
  assert.equal(
    await publishedPage.locator("main").getAttribute("data-dashboard-page"),
    "first-page",
    "Exhausted secondary-tab probing must restore the original active dashboard tab",
  );
  assert.equal(
    await publishedPage.evaluate(
      () =>
        window.__dashboardStatusAnnouncements.filter((message) =>
          message.includes("The linked component is unavailable"),
        ).length,
    ),
    1,
    "An unknown component must announce its unavailable state exactly once after bounded tab probing",
  );
  assert.equal(
    publishedPresentationWrites.length,
    presentationWritesBeforeTabProbe,
    "Exhausted dashboard tab probing must not mutate shared presentation state",
  );
  publishedHtml = originalPublishedHtml;

  publishedPresentation = {
    canEdit: false,
    presentation: { verification: storedDashboardVerification },
    revision: 1,
  };
  const presentationWritesBeforeViewerDetail = publishedPresentationWrites.length;
  await publishedPage.goto("https://dashboard.chatgpt.site/", { waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  const viewerVerificationBadge = publishedPage.getByRole("img", { name: "Verified dashboard", exact: true });
  assert.equal(
    await viewerVerificationBadge.count(),
    1,
    "Every published dashboard viewer must see its creator's verified status",
  );
  const viewerVerificationTarget = await viewerVerificationBadge.evaluate((badge) => ({
    tagName: badge.tagName,
    tabIndex: badge.tabIndex,
  }));
  assert.notEqual(
    viewerVerificationTarget.tagName,
    "BUTTON",
    "A published dashboard viewer's verification badge must never become a mutation control",
  );
  assert.ok(
    viewerVerificationTarget.tabIndex >= 0,
    "A published dashboard viewer's verification details must remain keyboard accessible",
  );
  await viewerVerificationBadge.focus();
  const viewerVerificationTooltip = publishedPage
    .locator('.dashboard-topbar [role="tooltip"]')
    .filter({ hasText: "Verified by:" });
  await viewerVerificationTooltip.waitFor({ state: "visible" });
  assert.match(
    await viewerVerificationTooltip.innerText(),
    /Verified at:/u,
    "A published dashboard viewer must be able to inspect its verification timestamp",
  );
  assert.match(
    await viewerVerificationTooltip.innerText(),
    /Verified by:\s*publisher@example\.com/u,
    "A published dashboard viewer must be able to inspect the accountable verifier",
  );
  await viewerVerificationBadge.hover();
  assert.equal(
    await viewerVerificationTooltip.isVisible(),
    true,
    "A published dashboard viewer's verification details should also be available on hover",
  );
  for (const label of ["Edit text and layout", "Mark dashboard as verified", "Remove dashboard verification"]) {
    assert.equal(
      await publishedPage.getByRole("button", { name: label }).count(),
      0,
      `A read-only published dashboard viewer must not receive the ${label.toLowerCase()} control`,
    );
  }
  assert.equal(
    publishedPresentationWrites.length,
    presentationWritesBeforeViewerDetail,
    "Inspecting a published dashboard's verification must never mutate its shared presentation",
  );
  publishedPresentation = { canEdit: false, presentation: {}, revision: 0 };
  await publishedPage.goto(`${secondaryPermalink}/detail`, { waitUntil: "load" });
  const viewerExplorer = publishedPage.getByRole("dialog", { name: "Active accounts by feature" });
  await viewerExplorer.waitFor();
  assert.equal(
    await publishedPage.locator(".dashboard-verification").count(),
    0,
    "An unverified published dashboard must not display a verification badge to its viewers",
  );
  assert.equal(
    await viewerExplorer.locator(".explorer-controls").count(),
    0,
    "Opening a chart detail permalink must not grant presentation-editing controls to a viewer",
  );
  assert.equal(
    await viewerExplorer.getByRole("button", { name: "Apply" }).count(),
    0,
    "Opening a chart detail permalink must not grant presentation-editing actions to a viewer",
  );
  await viewerExplorer.getByRole("button", { name: "Close" }).click();
  const viewerChart = publishedPage.locator('[data-component-id="segment-breakdown"]');
  await viewerChart.getByRole("button", { name: "Active accounts by feature actions" }).click();
  const viewerChartMenu = publishedPage.getByRole("menu", { name: "Active accounts by feature actions" });
  assert.equal(
    await publishedPage.getByRole("menuitem", { name: "Edit chart" }).count(),
    0,
    "Published chart permalink viewers must not gain chart-editing permission",
  );
  assert.equal(
    await viewerChartMenu.getByRole("menuitem", { name: "Copy link", exact: true }).count(),
    1,
    "Published chart permalink viewers must retain one plainly labeled Copy link action",
  );
  assert.equal(
    await viewerChartMenu.getByRole("menuitem", { name: "Copy chart link" }).count(),
    0,
    "Published chart permalink viewers must not see obsolete chart-specific share labels",
  );
  assert.equal(
    await viewerChartMenu.getByRole("menuitem", { name: "Copy chart detail link" }).count(),
    0,
    "Published chart permalink viewers must see only the single chart-sharing action",
  );
  await publishedPage.getByRole("menuitem", { name: "View data source" }).click();
  const viewerSource = publishedPage.getByRole("complementary", {
    name: "Data source for Active accounts by feature",
  });
  await viewerSource.waitFor();
  await viewerSource.getByRole("tab", { name: "SQL query" }).click();
  assert.match(
    await viewerSource.innerText(),
    /FROM/u,
    "Read-only chart detail permalinks must preserve access to reviewed source evidence",
  );
  await viewerSource.getByRole("button", { name: "Close data source" }).click();
  assert.equal(
    publishedPresentationWrites.length,
    presentationWritesBeforeViewerDetail,
    "Opening or inspecting a viewer chart detail permalink must never write shared presentation state",
  );

  await publishedPage.goto(`${metricPermalink}?token=viewer-secret#private-viewer`, {
    waitUntil: "load",
  });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.waitForFunction(() => {
    const metric = document.querySelector('[data-component-id="active-users"]');
    return !!metric && (document.activeElement === metric || metric.contains(document.activeElement));
  });
  const viewerMetric = publishedPage.locator('[data-component-id="active-users"]');
  await viewerMetric.getByRole("button", { name: "Weekly active accounts actions" }).click();
  const viewerMetricMenu = publishedPage.getByRole("menu", {
    name: "Weekly active accounts actions",
  });
  assert.equal(
    await viewerMetricMenu.getByRole("menuitem", { name: "Copy link", exact: true }).count(),
    1,
    "A read-only published dashboard viewer must retain one plainly labeled Copy link action",
  );
  assert.equal(
    await viewerMetricMenu.getByRole("menuitem", { name: "Copy widget link" }).count(),
    0,
    "A read-only dashboard viewer must not see obsolete widget-specific share labels",
  );
  assert.equal(
    await viewerMetricMenu.getByRole("menuitem", { name: "Copy chart detail link" }).count(),
    0,
    "A read-only metric permalink must never grant chart-detail editing",
  );
  await viewerMetricMenu.getByRole("menuitem", { name: "Copy link", exact: true }).click();
  await publishedPage.waitForFunction(() => window.__dashboardClipboard.length === 1);
  assert.deepEqual(
    await publishedPage.evaluate(() => window.__dashboardClipboard),
    [completeViewUrl(metricPermalink)],
    "A read-only viewer must copy a clean, stable widget permalink without private URL state",
  );
  assert.equal(
    publishedPresentationWrites.length,
    presentationWritesBeforeViewerDetail,
    "Opening or copying a viewer widget permalink must never write shared presentation state",
  );

  publishedPresentation = {
    canEdit: false,
    presentation: { hiddenBlocks: ["usage-trend"] },
    revision: 0,
  };
  await publishedPage.goto(`${chartPermalink}/detail`, { waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("status").filter({ hasText: "The linked chart is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.locator('[data-component-id="usage-trend"]').count(),
    0,
    "A read-only chart detail permalink must never disclose a hidden chart",
  );
  assert.equal(
    await publishedPage.getByRole("dialog", { name: "Active accounts over time" }).count(),
    0,
    "A read-only hidden chart detail must never open its chart explorer",
  );
  assert.equal(
    await publishedPage.getByRole("button", { name: "Edit text and layout" }).count(),
    0,
    "A read-only viewer must never receive hidden-component restoration controls",
  );
  assert.equal(
    publishedPresentationWrites.length,
    presentationWritesBeforeViewerDetail,
    "A read-only hidden chart permalink must never mutate shared presentation state",
  );

  publishedPresentation = {
    canEdit: true,
    presentation: { hiddenBlocks: ["active-users"] },
    revision: 0,
  };
  await publishedPage.goto(metricPermalink, { waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("status").filter({ hasText: "The linked component is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.locator('[data-component-id="active-users"]').count(),
    0,
    "A widget permalink must not reveal a metric hidden from the published presentation",
  );
  assert.equal(
    await publishedPage.locator('[data-component-id="usage-trend"]').count(),
    1,
    "Hidden widget permalinks must leave the remaining reviewed dashboard usable",
  );
  assert.equal(
    await publishedPage.evaluate(
      () =>
        window.__dashboardStatusAnnouncements.filter((message) =>
          message.includes("The linked component is unavailable"),
        ).length,
    ),
    1,
    "A hidden component permalink must announce its unavailable state exactly once",
  );
  await publishedPage.getByRole("button", { name: "Edit text and layout" }).click();
  assert.equal(
    await publishedPage.evaluate(
      () =>
        window.__dashboardStatusAnnouncements.filter((message) =>
          message.includes("The linked component is unavailable"),
        ).length,
    ),
    1,
    "An unrelated owner rerender must not repeatedly announce the same hidden component permalink",
  );
  await publishedPage.getByRole("button", { name: "Restore hidden (1)", exact: true }).click();
  await publishedPage.waitForFunction(() => {
    const target = document.querySelector('[data-component-id="active-users"]');
    return !!target && (document.activeElement === target || target.contains(document.activeElement));
  });
  assert.equal(
    await publishedPage.locator('[data-component-id="active-users"]').getAttribute("data-permalink-target"),
    "true",
    "A hidden component permalink must retry and focus its target after the owner restores it",
  );
  assert.equal(
    await publishedPage.getByRole("status").filter({ hasText: "The linked component is unavailable" }).count(),
    0,
    "Restoring a linked component must clear its obsolete unavailable notification",
  );

  publishedPresentation = {
    canEdit: true,
    presentation: { hiddenBlocks: ["usage-trend"] },
    revision: 0,
  };
  await publishedPage.goto(`${chartPermalink}/detail`, { waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  assert.equal(
    await publishedPage.locator('[data-component-id="usage-trend"]').count(),
    0,
    "A direct chart link must not unhide a chart removed from the published presentation",
  );
  assert.equal(
    await publishedPage.locator('[data-component-id="segment-breakdown"]').count(),
    1,
    "Hidden-chart permalinks must leave the remaining published dashboard usable",
  );
  await publishedPage.getByRole("status").filter({ hasText: "The linked chart is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.evaluate(
      () =>
        window.__dashboardStatusAnnouncements.filter((message) => message.includes("The linked chart is unavailable"))
          .length,
    ),
    1,
    "A hidden chart detail permalink must announce its unavailable state exactly once",
  );
  await publishedPage.getByRole("button", { name: "Edit text and layout" }).click();
  assert.equal(
    await publishedPage.evaluate(
      () =>
        window.__dashboardStatusAnnouncements.filter((message) => message.includes("The linked chart is unavailable"))
          .length,
    ),
    1,
    "An unrelated owner rerender must not repeatedly announce the same hidden chart detail",
  );
  await publishedPage.getByRole("button", { name: "Restore hidden (1)", exact: true }).click();
  const restoredChartExplorer = publishedPage.getByRole("dialog", { name: "Active accounts over time" });
  await restoredChartExplorer.waitFor();
  assert.equal(
    await publishedPage.locator('[data-component-id="usage-trend"]').getAttribute("data-permalink-target"),
    "true",
    "Restoring a hidden chart must retry and visibly focus the pending detail permalink",
  );
  assert.ok(
    await publishedPage.evaluate(() =>
      window.__dashboardScrollCalls.some(
        ({ componentId, options }) => componentId === "usage-trend" && options?.block === "center",
      ),
    ),
    "Restoring a hidden chart must scroll the pending target to the center before opening its detail",
  );
  assert.equal(
    await publishedPage.getByRole("status").filter({ hasText: "The linked chart is unavailable" }).count(),
    0,
    "Restoring a linked chart must clear its obsolete unavailable notification",
  );
  await restoredChartExplorer.getByRole("button", { name: "Cancel", exact: true }).click();
  await restoredChartExplorer.waitFor({ state: "hidden" });
  assert.equal(
    publishedPage.url(),
    completeViewUrl(chartPermalink),
    "Closing a chart detail opened after hidden-target restoration must normalize its route",
  );

  publishedPresentation = { canEdit: true, presentation: {}, revision: 0 };
  await publishedPage.goto("https://dashboard.chatgpt.site/_data/charts/active-users", {
    waitUntil: "load",
  });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("status").filter({ hasText: "The linked chart is unavailable" }).waitFor();
  const unlinkedMetric = publishedPage.locator('[data-component-id="active-users"]');
  assert.equal(
    await unlinkedMetric.count(),
    1,
    "A non-chart permalink must leave its existing metric visible on the published dashboard",
  );
  assert.notEqual(
    await unlinkedMetric.getAttribute("data-permalink-target"),
    "true",
    "A non-chart permalink must never promote a metric into a linked chart target",
  );
  assert.equal(
    await unlinkedMetric.evaluate(
      (metric) => document.activeElement === metric || metric.contains(document.activeElement),
    ),
    false,
    "A non-chart permalink must never focus an unrelated metric as a chart",
  );

  const selectorBreakingChartId = 'usage-trend"][';
  await publishedPage.goto(
    `https://dashboard.chatgpt.site/_data/charts/${encodeURIComponent(selectorBreakingChartId)}`,
    { waitUntil: "load" },
  );
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("status").filter({ hasText: "The linked chart is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.locator('[data-component-id="usage-trend"]').count(),
    1,
    "An encoded chart ID containing selector characters must never break or retarget the dashboard",
  );
  assert.equal(
    await publishedPage.locator('[data-permalink-target="true"]').count(),
    0,
    "An encoded chart ID containing selector characters must never focus a different chart",
  );

  const selectorBreakingWidgetId = 'active-users"][';
  await publishedPage.goto(
    `https://dashboard.chatgpt.site/_data/components/${encodeURIComponent(selectorBreakingWidgetId)}`,
    { waitUntil: "load" },
  );
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("status").filter({ hasText: "The linked component is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.locator('[data-component-id="active-users"]').count(),
    1,
    "An encoded widget ID containing selector characters must never break or retarget the dashboard",
  );
  assert.equal(
    await publishedPage.locator('[data-permalink-target="true"]').count(),
    0,
    "An encoded widget ID containing selector characters must never focus another component",
  );

  await publishedPage.goto("https://dashboard.chatgpt.site/_data/components/not-a-widget", {
    waitUntil: "load",
  });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("status").filter({ hasText: "The linked component is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.locator('[data-component-id="not-a-widget"]').count(),
    0,
    "Unknown widget permalinks must never invent or reveal a dashboard component",
  );
  assert.equal(
    await publishedPage.locator('[data-component-id="usage-details"]').count(),
    1,
    "Unknown widget permalinks must preserve access to the remaining reviewed dashboard",
  );

  const unknownShortAlias = "ZZZZZZZZ";
  assert.match(unknownShortAlias, componentShortIdPattern);
  assert.equal([...componentAliases.values()].includes(unknownShortAlias), false);
  await publishedPage.goto(`${dashboardOrigin}/_data/components/${unknownShortAlias}`, {
    waitUntil: "load",
  });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("status").filter({ hasText: "The linked component is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.locator('[data-permalink-target="true"]').count(),
    0,
    "An unknown eight-character component token must never resolve or focus an unrelated widget",
  );

  await publishedPage.goto(`${dashboardOrigin}/_data/charts/${unknownShortAlias}`, {
    waitUntil: "load",
  });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("status").filter({ hasText: "The linked chart is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.locator('[data-permalink-target="true"]').count(),
    0,
    "An unknown eight-character chart token must never resolve or focus an unrelated chart",
  );

  const unknownComponentAlias = "00000000-0000-5000-8000-000000000000";
  assert.equal([...componentAliases.values()].includes(unknownComponentAlias), false);
  await publishedPage.goto(`${dashboardOrigin}/_data/components/${unknownComponentAlias}`, {
    waitUntil: "load",
  });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("status").filter({ hasText: "The linked component is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.locator('[data-permalink-target="true"]').count(),
    0,
    "A well-formed but unknown component UUID must never resolve or focus an unrelated widget",
  );

  await publishedPage.goto(`${dashboardOrigin}/_data/charts/${unknownComponentAlias}`, {
    waitUntil: "load",
  });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("status").filter({ hasText: "The linked chart is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.locator('[data-permalink-target="true"]').count(),
    0,
    "A well-formed but unknown chart UUID must never resolve or focus an unrelated chart",
  );

  await publishedPage.goto("https://dashboard.chatgpt.site/_data/charts/not-a-chart", {
    waitUntil: "load",
  });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("status").filter({ hasText: "The linked chart is unavailable" }).waitFor();
  assert.equal(
    await publishedPage.locator('[data-component-id="not-a-chart"]').count(),
    0,
    "Unknown chart permalinks must not invent or reveal a dashboard component",
  );
  assert.equal(
    await publishedPage.locator('[data-component-id="usage-trend"]').count(),
    1,
    "Unknown chart permalinks must leave the published dashboard and reviewed charts available",
  );

  publishedHtml = buildAuthoredPublishedFixture("unsafe-ids", (source) => {
    source = replaceUniqueAuthoredExpression(
      source,
      'id: "active-users",',
      'id: "unsafe/metric",',
      "unsafe metric identity",
    );
    return replaceUniqueAuthoredExpression(
      source,
      'id="usage-trend" title="Active accounts over time"',
      'id="unsafe/chart" title="Active accounts over time"',
      "unsafe chart identity",
    );
  });
  await publishedPage.goto("https://dashboard.chatgpt.site/", {
    waitUntil: "load",
  });
  await waitForDashboardTitle(publishedPage);
  for (const invalidComponent of [
    { id: "unsafe/metric", title: "Weekly active accounts", chart: false },
    { id: "unsafe/chart", title: "Active accounts over time", chart: true },
  ]) {
    const component = publishedPage.locator(`[data-component-id="${invalidComponent.id}"]`);
    assert.equal(
      await component.count(),
      1,
      `${invalidComponent.title} must continue rendering even if its stable ID cannot form a safe permalink`,
    );
    await component.getByRole("button", { name: `${invalidComponent.title} actions` }).click();
    const invalidMenu = publishedPage.getByRole("menu", {
      name: `${invalidComponent.title} actions`,
    });
    assert.equal(
      await invalidMenu.getByRole("menuitem", { name: "Copy link", exact: true }).count(),
      0,
      `${invalidComponent.title} must never offer an unusable permalink for an invalid component ID`,
    );
    assert.equal(
      await invalidMenu.getByRole("menuitem", { name: "Copy data" }).count(),
      1,
      `${invalidComponent.title} must preserve reviewed-data copying when sharing is unavailable`,
    );
    assert.equal(
      await invalidMenu.getByRole("menuitem", { name: "View data source" }).count(),
      1,
      `${invalidComponent.title} must preserve reviewed-source inspection when sharing is unavailable`,
    );
    if (invalidComponent.chart) {
      assert.equal(
        await invalidMenu.getByRole("menuitem", { name: "Copy as image" }).count(),
        1,
        "An unshareable chart must preserve its existing chart-image action",
      );
    }
    await invalidMenu.getByRole("menuitem", { name: "View data source" }).click();
    const invalidSource = publishedPage.getByRole("complementary", {
      name: `Data source for ${invalidComponent.title}`,
    });
    await invalidSource.waitFor();
    await invalidSource.getByRole("button", { name: "Close data source" }).click();
  }
  publishedHtml = originalPublishedHtml;

  publishedPresentation = { canEdit: false, presentation: {}, revision: 0 };
  await verifyPublishedViewerHandoffs(publishedPage, {
    title: dataAppSnapshot.title,
    originatingThreadId,
    sensitivePreviewPattern,
  });
  await publishedContext.close();

  await verifyDashboardPolish({ browser, template, project: join(project, "polish-fixture"), screenshots });

  assert.deepEqual(failures, []);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        components: publishedComponents.length,
        interactions: [
          "neutral dashboard headings",
          "no autogenerated eyebrows or narrative",
          "filter-invariant headings",
          "layout-stable modal filters with desktop scrollbar gutters",
          "reviewed-data refresh preserves authored headings",
          "legend",
          "global filter",
          "source tabs",
          "provider-neutral reviewed source trust signals",
          "copy",
          "copy chart image",
          "chart editing",
          "chart color identities, exact palette selection, and theme-aware saved colors",
          "waterfall and line-chart zero-axis toggles",
          "inline title editing",
          "inline narrative editing",
          "read-only reviewed values, models, controls, and tables",
          "hide/restore",
          "dashboard tabs",
          "refresh",
          "duplicate as editor or viewer",
          "grouped export",
          "environment-aware ChatGPT handoffs without a host integration",
          "creator-only published dashboard verification, accountable verifier details, and read-only viewer badges",
          "published Sites refresh, PDF export, sanitized web handoffs, and desktop browser reopening",
          "origin-scoped compact permalinks for every metric, chart, custom card, and table",
          "published chart permalinks, reduced-motion focus, chart details, dashboard tabs, and missing-chart fallback",
          "route-owned detail dismissal, authored secondary-tab targeting, restored hidden links, and unsafe ID gating",
          "private-by-default publishing",
          "unclipped information tooltips",
          "light and dark menu hover",
          "theme drawer",
          "theme switching",
          "right-aligned menu checks",
          "mobile",
        ],
        screenshots,
        desktop: join(screenshots, "desktop-baseline.png"),
        mobile: join(screenshots, "mobile-baseline.png"),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  rmSync(project, { recursive: true, force: true });
}
