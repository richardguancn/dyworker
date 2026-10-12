import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { installDashboardBrowserMocks, resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const rows = [
  { plan: "Free", creditBuyers: 1.3, paidPlus: -1.4, focused: -160, mixed: -2, previousCreditBuyers: 1, growthRate: -0.014, conversionRate: 0.014, target: -6 },
  { plan: "Go", creditBuyers: 5.8, paidPlus: -4.4, focused: -194, mixed: 4, previousCreditBuyers: 4, growthRate: -0.044, conversionRate: 0.044, target: -6 },
];
const cases = [
  { id: "measures", fields: ["creditBuyers", "paidPlus"], toggle: true },
  { id: "mixed-measures", fields: ["mixed", "paidPlus"], toggle: true },
  { id: "explicit-measures", fields: ["creditBuyers", "paidPlus"], colors: { paidPlus: "#9234ab" }, toggle: true },
  { id: "categories", fields: ["creditBuyers"], category: true },
  { id: "category-overrides", fields: ["mixed"], colors: { Free: "#123456", Go: "#abcdef" }, category: true },
  { id: "measure-override", fields: ["mixed"], colors: { mixed: "#123456", Free: "#abcdef" }, explicit: true },
  { id: "signed", fields: ["mixed"], signed: true },
  { id: "comparison", fields: ["creditBuyers", "previousCreditBuyers"], category: true, toggle: true },
  { id: "comparison-override", fields: ["creditBuyers", "previousCreditBuyers"], colors: { creditBuyers: "#123456" }, toggle: true },
  { id: "negative", fields: ["paidPlus"], zero: true },
  { id: "negative-focused", fields: ["focused"], startAtZero: false, zero: false },
  { id: "negative-percent", fields: ["growthRate"], axisPercentDigits: 0, zero: true },
  { id: "positive-percent", fields: ["conversionRate"], axisPercentDigits: 0, zero: true },
  { id: "secondary", fields: ["creditBuyers", "paidPlus"], rightAxisFields: ["paidPlus"], zero: true },
  { id: "benchmark", fields: ["paidPlus"], zero: true, annotations: [
    { id: "target", kind: "benchmark", label: "Reviewed target", field: "target", measure: "paidPlus" },
  ] },
];
const charts = ["bar", "horizontalBar"].flatMap(type => cases.map(entry => ({
  ...entry,
  id: `${type}-${entry.id}`,
  spec: {
    type, x: "plan", y: entry.fields[0], fields: entry.fields, showLegend: true,
    startAtZero: entry.startAtZero ?? true, rightAxisFields: entry.rightAxisFields ?? [],
    ...(entry.colors ? { colors: entry.colors } : {}),
    ...(entry.annotations ? { annotations: entry.annotations } : {}),
    ...(entry.axisPercentDigits === undefined ? {} : { axisPercentDigits: entry.axisPercentDigits }),
  },
})));

async function colors(chart) {
  return chart.locator(".recharts-bar").evaluateAll(groups => groups.map(group =>
    [...group.querySelectorAll(".recharts-bar-rectangle path")].map(mark => getComputedStyle(mark).fill)));
}

async function legendColors(chart) {
  return chart.locator(".chart-legend-mark").evaluateAll(marks =>
    marks.map(mark => getComputedStyle(mark).backgroundColor));
}

// Recharts can append a re-enabled SVG group after the surviving series.
const colorSequences = series => series.map(colors => JSON.stringify(colors)).sort();

async function axisValues(chart, horizontal) {
  return chart.locator(`.recharts-${horizontal ? "x" : "y"}Axis-tick-labels`).evaluateAll(axes =>
    axes.map(axis => [...axis.querySelectorAll(".recharts-cartesian-axis-tick-value")]
      .map(tick => Number(tick.textContent.replaceAll("−", "-").replaceAll(",", "").replace("%", "")))));
}

/** Exercise the shipped renderer through real legend controls and rendered marks. */
export async function verifySeriesVisibility({ browser, pluginRoot }) {
  const project = mkdtempSync(join(tmpdir(), "data-series-visibility-"));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "en-US" });
  const page = await context.newPage();
  const errors = [];
  const checks = [];
  page.on("pageerror", error => errors.push(error.message));
  const check = (description, fn) => {
    try { fn(); } catch (error) { checks.push(`${description}: ${error.message}`); }
  };
  try {
    cpSync(join(pluginRoot, "templates/data-app/base"), project, {
      recursive: true, filter: path => !path.includes("/node_modules") && !path.includes("/dist"),
    });
    const snapshotPath = join(project, "src/data.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.title = "Synthetic series-visibility regression";
    snapshot.filters = [];
    snapshot.queries = { visibility: { rows, source: { label: "Synthetic browser regression values" } } };
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`);
    writeFileSync(join(project, "src/content/dashboard/DashboardContent.jsx"), `
import React from "react";
import { ChartRenderer, DataComponent, useDataApp } from "../../data-app-public.jsx";
const charts = ${JSON.stringify(charts.map(({ id, spec }) => ({ id, spec })))};
export function DashboardContent() {
  const { reviewedRows } = useDataApp();
  const rows = reviewedRows("visibility");
  return <section style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 24, padding: 24 }}>
    {charts.map(({ id, spec }) => <DataComponent key={id} id={id} title={id} queryId="visibility" kind="chart"
      chart={spec} displayRows={rows}><ChartRenderer spec={spec} rows={rows} height={300} /></DataComponent>)}
  </section>;
}
`);
    const build = runDataAppFixtureBuild(project, { pluginRoot });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    await installDashboardBrowserMocks(page);
    await page.goto(pathToFileURL(join(project, "dist/index.html")).href, { waitUntil: "load" });

    for (const entry of charts) {
      const chart = page.locator(`[data-component-id="${entry.id}"]`);
      await chart.scrollIntoViewIfNeeded();
      await chart.locator(".recharts-bar-rectangle path").first().waitFor({ state: "visible" });
      const original = await colors(chart);
      const legend = await legendColors(chart);
      const horizontal = entry.spec.type === "horizontalBar";
      check(entry.id, () => assert.equal(original.length, entry.fields.length));
      if (entry.category) check(entry.id, () => assert.notEqual(original[0][0], original[0][1],
        "One logical measure retains distinct category colors"));
      if (entry.explicit) check(entry.id, () => assert.deepEqual(original[0], ["rgb(18, 52, 86)", "rgb(18, 52, 86)"],
        "An explicit measure color wins over automatic sign and category colors"));
      if (entry.id.endsWith("category-overrides")) check(entry.id, () => assert.deepEqual(original[0],
        ["rgb(18, 52, 86)", "rgb(171, 205, 239)"], "Explicit category colors win over automatic sign colors"));
      if (entry.signed) {
        const signColors = await chart.evaluate(element => {
          const sample = document.createElement("span"); element.append(sample);
          const result = ["negative", "positive"].map(sign => {
            sample.style.color = `var(--${sign})`; return getComputedStyle(sample).color;
          });
          sample.remove(); return result;
        });
        check(entry.id, () => assert.deepEqual(original[0], signColors, "A genuinely single signed measure retains sign colors"));
      }
      if (entry.zero !== undefined) {
        const axes = await axisValues(chart, horizontal);
        check(entry.id, () => {
          assert.ok(axes.length > 0 && axes.every(axis => axis.length > 1));
          for (const axis of axes) assert.equal(axis.includes(0), entry.zero,
            `startAtZero must govern every value axis: ${JSON.stringify(axes)}`);
        });
      }
      if (entry.annotations) {
        const benchmarks = await chart.locator(".recharts-reference-line line").count();
        const axes = await axisValues(chart, horizontal);
        check(entry.id, () => {
          assert.equal(benchmarks, 1, "The reviewed benchmark remains rendered");
          assert.ok(Math.min(...axes.flat()) <= -6, "The numeric axis retains space for the edge benchmark");
        });
      }
      if (!entry.toggle) continue;
      const buttons = chart.locator(".chart-legend-button");
      for (const hiddenIndex of [0, 1]) {
        await buttons.nth(hiddenIndex).click();
        const remaining = await colors(chart);
        const remainingIndex = 1 - hiddenIndex;
        const currentLegend = await legendColors(chart);
        check(`${entry.id} hidden ${entry.fields[hiddenIndex]}`, () => {
          assert.equal(remaining.length, 1);
          assert.deepEqual(remaining[0], original[remainingIndex], "Toggling a series must preserve the remaining mark colors");
        });
        check(`${entry.id} legend`, () => assert.equal(currentLegend[remainingIndex], legend[remainingIndex],
          "The remaining legend keeps its color"));
        if (!entry.category) {
          await chart.locator(".recharts-bar-rectangle path").first().hover();
          const tooltip = chart.locator(".chart-tooltip");
          await tooltip.waitFor({ state: "visible" });
          const swatches = await tooltip.locator("i").evaluateAll(elements => elements.map(element => {
            const style = getComputedStyle(element);
            return element.dataset.comparison === "previous-bar" ? style.outlineColor : style.backgroundColor;
          }));
          check(`${entry.id} tooltip`, () => assert.ok(swatches.includes(original[remainingIndex][0]),
            "Tooltip color agrees with the remaining series"));
          const axes = await axisValues(chart, horizontal);
          check(`${entry.id} zero after toggle`, () => assert.ok(axes.every(axis => axis.includes(0)),
            `A positive-only or negative-only visible measure retains zero: ${JSON.stringify(axes)}`));
        }
        await buttons.nth(hiddenIndex).click();
        const restored = await colors(chart);
        const restoredLegend = await legendColors(chart);
        check(`${entry.id} restored`, () => {
          assert.deepEqual(colorSequences(restored), colorSequences(original), "Re-enabling a series restores its original colors");
          assert.deepEqual(restoredLegend, legend, "Re-enabling a series restores the full legend");
        });
      }
      if (entry.id === `${entry.spec.type}-measures`) {
        await buttons.nth(1).press("Shift+Enter");
        const isolated = await colors(chart);
        const isolatedLegend = await legendColors(chart);
        const isolatedAxes = await axisValues(chart, horizontal);
        check(`${entry.id} isolated`, () => {
          assert.deepEqual(isolated, [original[1]], "Isolating a series preserves its measure colors");
          assert.equal(isolatedLegend[1], legend[1], "The isolated series retains its legend color");
          assert.ok(isolatedAxes.every(axis => axis.includes(0)), "An isolated negative measure retains zero");
        });
        await buttons.nth(1).press("Shift+Enter");
        const restored = await colors(chart);
        const restoredLegend = await legendColors(chart);
        check(`${entry.id} unisolated`, () => {
          assert.deepEqual(colorSequences(restored), colorSequences(original), "Unisolating restores all original measure colors");
          assert.deepEqual(restoredLegend, legend, "Unisolating restores the full legend");
        });
      }
    }
    assert.deepEqual(errors, [], "Legend changes must not cause browser errors");
    assert.deepEqual(checks, [], "Series color and zero-domain regressions");
    process.stdout.write(`${JSON.stringify({ test: "series-visibility", charts: charts.length, result: "pass" })}\n`);
  } finally {
    await context.close();
    rmSync(project, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  try {
    await verifySeriesVisibility({ browser, pluginRoot: resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..")) });
  } finally {
    await browser.close();
  }
}
