import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { chromeContrastRatio, parseChromeColor } from "../templates/data-app/base/src/chrome-contrast.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(root, "templates/data-app/base");
const project = mkdtempSync(join(tmpdir(), "data-app-table-delta-"));
const rows = [
  { metric: "Adoption", change: "+12.34%", tone: "positive" },
  { metric: "Reach", change: "+0.0007%", tone: "neutral" },
  { metric: "Lower cost", change: "−4.25%", tone: "positive" },
  { metric: "More errors", change: "+8.12%", tone: "negative" },
  { metric: "Trade-off", change: "−0.45%", tone: "neutral" },
  { metric: "Unknown", change: "+1.00%", tone: "invalid" },
  { metric: "Broken rule", change: "+2.00%", tone: "throws" },
  { metric: "No change", change: "0.00%", tone: "neutral" },
  { metric: "Last page", change: "−3.00%", tone: "negative" },
];
const authored = `import React from "react";
import { Chart, DataTable } from "../../data-app-public.jsx";
const rows = ${JSON.stringify(rows)};
const columns = [{field:"metric",label:"Metric"},{field:"change",label:"Relative change",
  deltaTone: (value,row) => {
    (window.__deltaToneCalls ??= []).push({metric:row.metric,value});
    if(row.tone === "throws") throw new Error("Bad color rule"); return row.tone;
  }}];
export function ReportContent(){return <article className="report-content"><h1>Delta presentation fixture</h1>
<DataTable rows={rows} columns={columns} signedDeltas label="Semantic deltas" />
<section id="explicit-neutral"><Chart height={180} spec={{type:"horizontalBar",x:"category",y:"change",colorBySign:false,
  colors:{A:"var(--secondary)",B:"var(--secondary)"},showLegend:false,showXAxisLabel:false,showYAxisLabel:false}}
  rows={[{category:"A",change:-2},{category:"B",change:3}]} /></section>
<section id="all-negative"><Chart height={180} spec={{type:"horizontalBar",x:"category",y:"change",colorBySign:true,
  startAtZero:true,showLegend:false,showXAxisLabel:false,showYAxisLabel:false}}
  rows={[{category:"A",change:-2},{category:"B",change:-3}]} /></section>
</article>;}`;
let browser;
try {
  cpSync(template, project, { recursive: true, filter: (path) => !path.includes("/node_modules") && !path.includes("/dist") });
  writeFileSync(join(project, "src/content/report/ReportContent.jsx"), authored);
  writeFileSync(join(project, "src/data.json"), JSON.stringify({ id: "delta-tone-contract", surface: "report",
    title: "Delta presentation fixture", generatedAt: "2026-08-20T12:00:00Z", filters: [], queries: {} }));
  const build = runDataAppFixtureBuild(project, { pluginRoot: root });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const errors = [];
  for (const colorScheme of ["light", "dark"]) for (const width of [1100, 390]) {
    const context = await browser.newContext({ colorScheme, viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(join(project, "dist/index.html")).href);
    const table = page.getByRole("table", { name: "Semantic deltas", exact: true });
    await table.waitFor();
    await page.waitForFunction(scheme => document.documentElement.dataset.colorScheme === scheme, colorScheme);
    for (const [id, fill] of [["explicit-neutral", "var(--secondary)"], ["all-negative", "var(--negative)"]]) {
      const bars = page.locator(`#${id} .recharts-bar-rectangle path`);
      await bars.nth(1).waitFor();
      const rendered = await bars.evaluateAll(elements => elements.map(element => ({
        fill: element.getAttribute("fill"), width: element.getBoundingClientRect().width,
      })));
      assert.equal(rendered.length, 2, "All-negative bars retain a zero baseline and remain visible");
      assert.ok(rendered.every(bar => bar.fill === fill && bar.width > 0), "Explicit semantic color overrides survive rendering");
    }
    const checkVisible = async () => {
      const cells = await table.locator("tbody tr").evaluateAll(elements => elements.map(element => {
        const [metric, change] = element.querySelectorAll("td");
        const probe = document.createElement("span");
        probe.style.color = change.dataset.delta === "positive" ? "var(--movement-positive)"
          : change.dataset.delta === "negative" ? "var(--movement-negative)" : "var(--secondary)";
        change.append(probe);
        const tokenColor = getComputedStyle(probe).color;
        probe.style.color = "var(--background)";
        const background = getComputedStyle(probe).color;
        probe.remove();
        return { metric: metric.textContent, change: change.textContent,
          tone: change.dataset.delta, color: getComputedStyle(change).color, tokenColor, background };
      }));
      for (const cell of cells) {
        const expected = rows.find(row => row.metric === cell.metric);
        assert.equal(cell.change, expected.change, "Color must not rewrite the signed value");
        assert.equal(cell.tone, ["positive", "negative"].includes(expected.tone) ? expected.tone : "neutral");
        assert.equal(cell.color, cell.tokenColor, "Semantic colors use the active theme; neutral retains secondary text");
        assert.ok(chromeContrastRatio(parseChromeColor(cell.color), parseChromeColor(cell.background)) >= 4.5,
          `${colorScheme} ${cell.tone} delta text must meet 4.5:1 contrast`);
      }
      return cells;
    };
    assert.equal((await checkVisible()).length, 8);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    assert.equal((await checkVisible())[0].metric, "Last page");
    await page.getByRole("button", { name: "Previous page", exact: true }).click();
    for (let direction = 0; direction < 2; direction++) {
      await table.getByRole("button", { name: /^Metric/u }).click();
      await checkVisible();
      await page.getByRole("button", { name: "Next page", exact: true }).click();
      await checkVisible();
      await page.getByRole("button", { name: "Previous page", exact: true }).click();
    }
    const ascending = ["Lower cost", "Last page", "Trade-off", "No change", "Reach",
      "Unknown", "Broken rule", "More errors", "Adoption"];
    for (const expected of [ascending, [...ascending].reverse()]) {
      await table.getByRole("button", { name: /^Relative change/u }).click();
      const firstPage = await checkVisible();
      await page.getByRole("button", { name: "Next page", exact: true }).click();
      const secondPage = await checkVisible();
      assert.deepEqual([...firstPage, ...secondPage].map(cell => cell.metric), expected,
        "Signed percentages sort by numeric value in both directions across pages");
      await page.getByRole("button", { name: "Previous page", exact: true }).click();
    }
    await page.getByRole("textbox", { name: "Search data", exact: true }).fill("Lower cost");
    assert.equal((await checkVisible())[0].tone, "positive", "A negative value can represent an improvement");
    await page.getByRole("textbox", { name: "Search data", exact: true }).fill("");
    await page.emulateMedia({ media: "print" });
    await checkVisible();
    const deltaToneCalls = await page.evaluate(() => window.__deltaToneCalls);
    assert.ok(deltaToneCalls.length > 0);
    for (const call of deltaToneCalls) assert.equal(call.value, rows.find(row => row.metric === call.metric).change,
      "Delta callbacks receive the original reviewed value, not a numeric sort key or formatted replacement");
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("Shared delta tones pass desktop/mobile light/dark, numeric sorting, original-value callbacks, pagination, search, and print-media checks.");
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
