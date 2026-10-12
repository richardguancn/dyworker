import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { installDashboardBrowserMocks, runDataAppFixtureBuild } from "./browser-helpers.mjs";

async function numericAxisTicks(chart) {
  return chart.locator('svg text[text-anchor="end"]').allTextContents();
}

export async function verifyChartOverridePrecedence({ browser, pluginRoot }) {
  const project = mkdtempSync(join(tmpdir(), "data-chart-overrides-"));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    cpSync(join(pluginRoot, "templates/data-app/base"), project, {
      recursive: true,
      filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
    });
    const snapshotPath = join(project, "src/data.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.id = "chart-override-regression";
    snapshot.title = "Chart override regression";
    snapshot.filters = [];
    snapshot.queries = {
      edited: {
        rows: [
          { week: "2026-07-06", segment: "A", activeUsers: 100, activeAccounts: 10 },
          { week: "2026-07-13", segment: "A", activeUsers: 200, activeAccounts: 30 },
        ],
        source: { label: "Synthetic chart-edit regression fixture" },
      },
    };
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`);
    // Reproduce the generated app's mistake at both the plot and metadata:
    // reading saved settings, then forcing the original design back over them.
    writeFileSync(join(project, "src/content/dashboard/DashboardContent.jsx"), `
import React from "react";
import { Chart, ChartRenderer, DataComponent, useDataApp } from "../../data-app-public.jsx";
const defaults = { type: "line", x: "week", y: "activeUsers", fields: ["activeUsers"],
  series: "segment", xLabel: "Original week", yLabel: "Original users", showLegend: true,
  colors: { A: "#112233" } };
export function DashboardContent() {
  const { chartOverrides, chartProps, reviewedRows } = useDataApp();
  const rows = reviewedRows("edited");
  return <section>{[["renderer", ChartRenderer], ["alias", Chart]].map(([id, Plot]) => {
    const chart = { ...(chartOverrides[id] ?? defaults), ...defaults };
    return <DataComponent key={id} id={id} queryId="edited" kind="chart" title={id}
      chart={chart} displayRows={rows}>
      <Plot {...chartProps(id)} spec={chart} rows={rows} height={240} />
    </DataComponent>;
  })}</section>;
}
`);
    const build = runDataAppFixtureBuild(project, { pluginRoot });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    await installDashboardBrowserMocks(page);
    await page.goto(pathToFileURL(join(project, "dist/index.html")).href, { waitUntil: "load" });

    async function openEditor(id) {
      await page.getByRole("button", { name: `${id} actions`, exact: true }).click();
      await page.getByRole("menuitem", { name: "Edit chart", exact: true }).click();
      const editor = page.getByRole("dialog", { name: id, exact: true });
      await editor.locator('.explorer-chart[data-ready="true"]').waitFor();
      return editor;
    }
    async function select(editor, control, choice) {
      await editor.getByRole("button", { name: control, exact: true }).click();
      await page.getByRole("menuitemradio", { name: choice, exact: true }).click();
    }
    async function closeEditor(editor, action) {
      await editor.getByRole("button", { name: action, exact: true }).click();
      await editor.waitFor({ state: "hidden" });
    }
    async function assertSavedChart(id) {
      const chart = page.locator(`[data-component-id="${id}"]`);
      await chart.locator(".recharts-bar-rectangle").first().waitFor();
      assert.equal(await chart.locator(".recharts-line-curve").count(), 0);
      assert.equal(await chart.locator(".chart-legend").count(), 0);
      await chart.getByText("Edited accounts", { exact: true }).waitFor();
      for (const [index, value] of ["10", "30"].entries()) {
        await chart.locator(".recharts-bar-rectangle").nth(index).hover();
        const tooltip = chart.locator(".chart-tooltip");
        await tooltip.getByText(value, { exact: true }).waitFor();
        assert.deepEqual(await tooltip.locator("b").allTextContents(), [value],
          "The saved plot must show activeAccounts values, not the authored activeUsers values");
      }
      const editor = await openEditor(id);
      assert.match(await editor.getByRole("button", { name: "Chart type", exact: true }).innerText(), /Bar/);
      assert.match(await editor.getByRole("button", { name: "Y axis", exact: true }).innerText(), /Active accounts/);
      assert.equal(await editor.getByRole("textbox", { name: "Y axis title" }).inputValue(), "Edited accounts");
      assert.equal(await editor.getByRole("switch", { name: "Show legend" }).isChecked(), false);
      return editor;
    }

    for (const id of ["renderer", "alias"]) {
      const chart = page.locator(`[data-component-id="${id}"]`);
      await chart.locator(".recharts-line-curve").first().waitFor();
      let editor = await openEditor(id);
      await select(editor, "Chart type", "Bar");
      await select(editor, "Y axis", "Active accounts");
      await editor.getByRole("textbox", { name: "Y axis title" }).fill("Edited accounts");
      await editor.getByRole("switch", { name: "Show legend" }).click();
      await editor.locator(".recharts-bar-rectangle").first().waitFor();
      assert.equal(await chart.locator(".recharts-bar-rectangle").count(), 0,
        "Unsaved drafts must not change the dashboard");
      await closeEditor(editor, "Save");
      editor = await assertSavedChart(id);
      await select(editor, "Chart type", "Line");
      await editor.locator(".recharts-line-curve").first().waitFor();
      await editor.getByRole("button", { name: "Undo chart change" }).click();
      await editor.locator(".recharts-bar-rectangle").first().waitFor();
      await editor.getByRole("button", { name: "Redo chart change" }).click();
      await editor.locator(".recharts-line-curve").first().waitFor();
      await closeEditor(editor, "Cancel");
      assert.equal(await chart.locator(".recharts-line-curve").count(), 0,
        "Cancel must leave the saved chart in place");
    }
    await page.reload({ waitUntil: "load" });
    for (const id of ["renderer", "alias"]) {
      await closeEditor(await assertSavedChart(id), "Cancel");
    }
    assert.deepEqual(errors, [], "Chart edits must survive authored defaults without browser errors");
  } finally {
    await context.close();
    rmSync(project, { recursive: true, force: true });
  }
}

export async function verifyChartPngDownload({ page, chart, actionsLabel, expectedFilename }) {
  await chart.getByRole("button", { name: actionsLabel }).click();
  const menu = page.getByRole("menu", { name: actionsLabel });
  assert.equal(await menu.getByRole("menuitem", { name: "Export chart" }).count(), 1,
    "Renderable charts should offer one export dialog");
  assert.equal(await menu.getByRole("menuitem", { name: "Download PNG" }).count(), 0,
    "Chart menus should not duplicate the download action inside the export dialog");
  assert.equal(
    await menu.getByRole("menuitem", { name: "Copy as image" }).count(),
    1,
    "Chart menus should retain quick clipboard image copying",
  );
  await menu.getByRole("menuitem", { name: "Export chart" }).click();
  const dialog = page.getByRole("dialog", { name: "Export chart", exact: true });
  assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).count(), 0,
    "Export chart should have one Close action at every viewport size");
  const downloadLink = dialog.getByRole("link", { name: "Download PNG", exact: true });
  await downloadLink.waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    downloadLink.click(),
  ]);
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    download.suggestedFilename(),
    expectedFilename,
    "Downloaded chart images should use a readable PNG filename",
  );
  const downloadPath = await download.path();
  assert.ok(downloadPath, "The PNG chart download should produce a browser-owned file");
  const downloadHeader = Buffer.alloc(8);
  const handle = await open(downloadPath, "r");
  try {
    await handle.read(downloadHeader, 0, downloadHeader.length, 0);
  } finally {
    await handle.close();
  }
  assert.deepEqual(
    [...downloadHeader],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "Downloaded chart images should be encoded as PNG files",
  );
}

export async function verifyDashboardChartInteractions({ page, trend }) {
  const driverChart = page.locator('[data-component-id="growth-drivers"]');
  await verifyChartPngDownload({
    page,
    chart: driverChart,
    actionsLabel: "Weekly change in active accounts actions",
    expectedFilename: "Weekly-change-in-active-accounts.png",
  });
  const previousImageCount = await page.evaluate(
    () => window.__dashboardClipboard.filter((item) => item?.type === "image/png").length,
  );
  await driverChart.getByRole("button", { name: "Weekly change in active accounts actions" }).click();
  await page.getByRole("menuitem", { name: "Copy as image" }).click();
  await page.waitForFunction(
    (count) => window.__dashboardClipboard.filter((item) => item?.type === "image/png").length > count,
    previousImageCount,
  );
  const describedChart = (await page.evaluate(() => window.__dashboardClipboard))
    .filter((item) => item?.type === "image/png")
    .at(-1);
  assert.ok(
    describedChart.text.includes("Weekly change in active accounts"),
    "The copied chart should include its title",
  );
  assert.ok(
    describedChart.text.some((line) => /Reviewed before and after totals/.test(line)),
    "The copied chart should include its available source-backed description",
  );

  async function selectEditorType(editor, name) {
    await editor.getByRole("button", { name: "Chart type", exact: true }).click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
  }
  async function closeEditor(editor, action = "Cancel") {
    await editor.getByRole("button", { name: action, exact: true }).click();
    await editor.waitFor({ state: "hidden" });
  }
  await driverChart.getByRole("button", { name: "Weekly change in active accounts actions" }).click();
  await page.getByRole("menuitem", { name: "Edit chart" }).click();
  const waterfallEditor = page.getByRole("dialog", { name: "Weekly change in active accounts" });
  await waterfallEditor.locator(".explorer-chart svg").waitFor();
  const originalWaterfall = await numericAxisTicks(driverChart);
  const waterfallZero = waterfallEditor.getByRole("switch", { name: "Start axis at zero" });
  await waterfallZero.click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('.chart-editor-dialog svg text[text-anchor="end"]')].some(
        (node) => node.textContent === "0",
      ),
  );
  assert.deepEqual(
    await numericAxisTicks(driverChart),
    originalWaterfall,
    "Drafts must not mutate the dashboard before Save",
  );
  await closeEditor(waterfallEditor, "Save");
  assert.ok(!(await numericAxisTicks(driverChart)).includes("0"));
  await driverChart.getByRole("button", { name: "Weekly change in active accounts actions" }).click();
  await page.getByRole("menuitem", { name: "Edit chart" }).click();
  await waterfallEditor.locator(".explorer-chart svg").waitFor();
  assert.equal(await waterfallZero.isChecked(), false);
  for (const type of ["Stacked bar", "Horizontal stacked bar"]) {
    await selectEditorType(waterfallEditor, type);
    const negative = waterfallEditor.locator('g[data-stack-sign="negative"] path[clip-path]');
    await negative.first().waitFor();
    const bounds = await negative.first().boundingBox();
    assert.ok(bounds.width > 0 && bounds.height > 0, `${type} must preserve negative values`);
  }
  await closeEditor(waterfallEditor);

  await trend.getByRole("button", { name: "Active accounts over time actions" }).click();
  await page.getByRole("menuitem", { name: "Edit chart" }).click();
  const explorer = page.getByRole("dialog", { name: "Active accounts over time" });
  const preview = explorer.locator(".explorer-chart");
  await preview.locator("svg").waitFor();
  assert.equal(await explorer.locator("table").count(), 0);
  assert.equal(await explorer.getByRole("button", { name: "Close", exact: true }).count(), 0);
  assert.equal(await explorer.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
  assert.match(await explorer.getByRole("button", { name: "X axis", exact: true }).innerText(), /Week/);
  assert.match(await explorer.getByRole("button", { name: "Y axis", exact: true }).innerText(), /Active users/);
  const showLegend = explorer.getByRole("switch", { name: "Show legend" });
  assert.equal(await explorer.getByRole("switch", { name: "Show annotations" }).count(), 0,
    "Charts without authored annotations do not offer an annotation visibility control");
  await showLegend.click();
  await preview.locator(".chart-legend").waitFor({ state: "hidden" });
  assert.ok(await trend.locator(".chart-legend").count());
  await explorer.getByRole("button", { name: "Undo chart change" }).click();
  await preview.locator(".chart-legend").waitFor();
  await explorer.getByRole("button", { name: "Redo chart change" }).click();
  await preview.locator(".chart-legend").waitFor({ state: "hidden" });
  await explorer.getByRole("button", { name: "Undo chart change" }).click();
  await selectEditorType(explorer, "Heatmap");
  await preview.locator(".chart-heatmap-cell").first().waitFor();
  const xTitle = explorer.getByRole("textbox", { name: "X axis title" });
  const yTitle = explorer.getByRole("textbox", { name: "Y axis title" });
  await xTitle.fill("");
  await yTitle.fill("Accounts");
  await page.waitForFunction(
    () => document.querySelector(".chart-editor-dialog svg text.recharts-label")?.textContent === "Accounts",
  );
  assert.equal(await preview.locator(".chart-axis-label").count(), 0, "An absent X title reserves no footer");
  await xTitle.fill("Week");
  await preview.getByText("Week", { exact: true }).last().waitFor();
  await yTitle.fill("");
  await page.waitForFunction(() => !document.querySelector(".chart-editor-dialog svg text.recharts-label"));
  assert.equal(
    await preview.locator(".chart-axis-label").innerText(),
    "Week",
    "Heatmap X and Y titles are independent",
  );
  await closeEditor(explorer);
  assert.equal(await trend.locator(".chart-heatmap-cell").count(), 0, "Cancel discards chart-type edits");
}
