import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "data-app-print-"));
const records = Array.from({ length: 20 }, (_, i) => ({
  account: `Account ${String(i + 1).padStart(2, "0")}`, region: i % 2 ? "West" : "East",
  users: 100 + i * 7, status: i % 3 ? "Healthy" : "At risk", history: [i + 1, i + 3, i + 2, i + 5],
}));
const trend = Array.from({ length: 6 }, (_, i) => ({
  week: `2026-08-${String(3 + i * 4).padStart(2, "0")}`, users: 100 + i * 20, target: 110 + i * 18,
}));
const outputs = process.env.DATA_APP_PRINT_ARTIFACTS_DIR;
if (outputs) mkdirSync(outputs, { recursive: true });
let browser;
let server;
try {
  const html = new Map();
  for (const surface of ["dashboard", "report"]) {
    const project = join(scratch, surface);
    cpSync(join(root, "templates/data-app/base"), project, {
      recursive: true, filter: path => !path.includes("/node_modules") && !path.includes("/dist"),
    });
    cpSync(join(root, "tests/fixtures/print-content.jsx"), join(project, "src/content/dashboard/DashboardContent.jsx"));
    cpSync(join(root, "tests/fixtures/print-fixture.css"), join(project, "src/content/dashboard/print-fixture.css"));
    writeFileSync(join(project, "src/content/report/ReportContent.jsx"),
      'export { DashboardContent as ReportContent } from "../dashboard/DashboardContent.jsx";\n');
    writeFileSync(join(project, "src/data.json"), JSON.stringify({
      id: `print-regression-${surface}`, surface, title: "PDF export test dashboard", buildStatus: "complete",
      filters: [], queries: Object.fromEntries(Object.entries({ records, trend }).map(([id, rows]) => [id, {
        id, title: id, rows, source: { type: "fixture", classification: "synthetic", description: "Fictional print regression data." },
      }])),
    }));
    const build = runDataAppFixtureBuild(project, { pluginRoot: root });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    html.set(`/${surface}`, readFileSync(join(project, "dist/index.html")));
  }
  server = createServer((request, response) => {
    const body = html.get(request.url);
    response.writeHead(body ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
    response.end(body ?? "Not found");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const errors = [];
  for (const surface of ["dashboard", "report"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, colorScheme: "light" });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${surface}`);
    const table = page.locator('[data-component-id="records-table"]');
    const receipt = page.locator('[data-component-id="receipt-table"]');
    const search = table.getByRole("textbox", { name: "Search data" });
    const regionFilter = table.locator(".table-toolbar-controls").getByRole("button", { name: "Region", exact: true });
    const rows = () => table.locator("tbody tr").allTextContents();
    await search.waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("main [data-component-id]").count(), 12);
    assert.equal((await rows()).length, 8);
    // Native browser printing remains supported independently of the PDF menu handoff.
    // Emulation alone uses the screen width; also test at A4's printable width.
    await page.setViewportSize({ width: 704, height: 1000 });
    await page.emulateMedia({ media: "print" });
    for (const selector of [".search-field", ".table-row-action", ".table-pagination .actions",
      ".receipt-pagination > button", ".select-trigger .chevron", ".data-slider-input", ".data-switch-track"]) {
      assert.ok(await page.locator(selector).count() > 0, `${surface}: fixture covers ${selector}`);
      for (const element of await page.locator(selector).all()) assert.equal(await element.isVisible(), false, selector);
    }
    assert.equal(await table.locator("th").count(), 5, "Column labels inside buttons survive printing");
    assert.match(await table.locator(".table-pagination").innerText(), /1–8 of 20 results/u);
    assert.match(await receipt.locator(".receipt-pagination").innerText(), /Rows 1–8 of 20/u);
    assert.equal(await regionFilter.isVisible(), true);
    assert.equal(await page.locator('.data-segmented-control-button[aria-pressed="false"]').isVisible(), false);
    assert.equal(await page.locator('.data-segmented-control-button[aria-pressed="true"]').isVisible(), true);
    for (const value of await page.locator(".data-slider-value").all()) assert.equal(await value.isVisible(), true);
    assert.equal(await page.locator(".data-switch-label").isVisible(), true);
    for (const id of ["trend", "chart-0", "chart-1", "chart-2", "chart-3"]) {
      const card = page.locator(`[data-component-id="${id}"]`);
      const marks = card.locator(".recharts-line-curve, .recharts-area-area, .recharts-bar-rectangle path");
      assert.ok(await marks.count() > 0);
      const bounds = await card.boundingBox();
      for (const mark of await marks.all()) {
        const box = await mark.boundingBox();
        assert.ok(box && box.width > 0 && box.height > 0, `${id} retains plotted geometry`);
        assert.ok(box.x >= bounds.x - 1 && box.x + box.width <= bounds.x + bounds.width + 1,
          `${id} must fit the narrower print card`);
      }
    }
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    if (outputs) writeFileSync(join(outputs, `${surface}-after.pdf`), pdf);

    await page.emulateMedia({ media: "screen" });
    await table.getByRole("button", { name: "Next page", exact: true }).click();
    const pageTwo = await rows();
    await page.emulateMedia({ media: "print" });
    assert.deepEqual(await rows(), pageTwo);
    assert.match(await table.locator(".table-pagination").innerText(), /9–16 of 20/u);
    await page.emulateMedia({ media: "screen" });
    await search.fill("Account 13");
    assert.equal((await rows()).length, 1);
    assert.equal(await table.locator(".table-print-search").isVisible(), false);
    await page.emulateMedia({ media: "print" });
    assert.equal(await search.isVisible(), false);
    assert.match((await rows())[0], /Account 13/u);
    assert.equal(await table.locator(".table-print-search").innerText(), "Search: Account 13");
    const filteredPdf = await page.pdf({ format: "A4", printBackground: true });
    if (outputs) writeFileSync(join(outputs, `${surface}-filtered-after.pdf`), filteredPdf);
    await page.emulateMedia({ media: "screen" });
    await search.fill("<No matching account>");
    await page.emulateMedia({ media: "print" });
    assert.equal(await table.locator(".table-print-search").innerText(), "Search: <No matching account>");
    assert.match(await table.locator(".table-pagination").innerText(), /No results/u);
    await page.emulateMedia({ media: "screen" });
    await search.fill("");
    assert.equal(await table.locator(".table-print-search").count(), 0);
    await table.locator("th").getByRole("button", { name: /^Users/u }).click();
    await table.locator("th").getByRole("button", { name: /^Users/u }).click();
    assert.match((await rows())[0], /Account 20/u);
    await table.getByRole("button", { name: "View Account 20", exact: true }).click();
    assert.equal(await page.getByText("Selected account: Account 20", { exact: true }).isVisible(), true);
    await regionFilter.click();
    await page.getByRole("menuitemradio", { name: "East", exact: true }).click();
    for (const colorScheme of ["light", "dark"]) for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ media: "print", colorScheme });
      assert.ok((await rows()).every(row => row.includes("East")));
      assert.match(await table.locator(".table-pagination").innerText(), /of 10 results/u);
      assert.match(await regionFilter.innerText(), /East/u);
      assert.equal(await search.isVisible(), false);
      await page.emulateMedia({ media: "screen", colorScheme });
      assert.equal(await search.isVisible(), true);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("Dashboard/report native browser printing preserves data, page/search/filter context and chart geometry; print controls and screen restoration pass.");
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
}
