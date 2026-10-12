import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = mkdtempSync(join(tmpdir(), "data-app-query-link-"));
const snowflakeUrl = "https://app.snowflake.com/org/account/#/worksheets/ws-1";
const databricksUrl = "https://adb-123.4.azuredatabricks.net/sql/editor/123?o=123";
const queries = {
  snowflake: { id: "snowflake", label: "Warehouse result", rows: [], source: {
    sql: "SELECT  'warehouse' AS origin;\n-- Preserve exact reviewed SQL on copy.",
    queryUrl: snowflakeUrl,
    links: [{ label: "Reviewed warehouse query", href: snowflakeUrl }, { label: "Review notes", href: "https://example.com/review-notes" }],
  } },
  databricks: { id: "databricks", label: "Lakehouse result", rows: [], source: {
    sql: "SELECT 'lakehouse' AS origin", query_url: databricksUrl,
  } },
  unavailable: { id: "unavailable", label: "Recorded SQL only", rows: [], source: {
    sql: "SELECT 'offline' AS origin", provider: "Snowflake",
  } },
};
const authored = `import React, { useState } from "react";
import { SourceInspector, SourceSidebar } from "../../data-app-public.jsx";
const queries = ${JSON.stringify(queries)};
const component = { id: "query-links", queryId: "snowflake", queryIds: Object.keys(queries), title: "Provider queries" };
const getSource = id => ({ query: queries[id], rows: queries[id].rows, filters: [] });
export function ReportContent() {
  const [open, setOpen] = useState(false);
  return <article className="report-content"><h1>Provider query links</h1>
    <button type="button" onClick={() => setOpen(true)}>Inspect queries</button>
    <section aria-label="Combined finding receipt">
      <SourceInspector component={component} receiptQueries={Object.values(queries)} />
    </section>
    {open && <SourceSidebar component={component} queries={queries} getSource={getSource} onClose={() => setOpen(false)} />}
  </article>;
}`;
let browser;
try {
  cpSync(join(root, "templates/data-app/base"), project, {
    recursive: true, filter: path => !path.includes("/node_modules") && !path.includes("/dist"),
  });
  writeFileSync(join(project, "src/content/report/ReportContent.jsx"), authored);
  writeFileSync(join(project, "src/data.json"), JSON.stringify({ id: "query-link-contract", surface: "report",
    title: "Provider query links", buildStatus: "complete", generatedAt: "2026-09-04T00:00:00Z", filters: [], queries }));
  const build = runDataAppFixtureBuild(project, { pluginRoot: root });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const errors = [];
  for (const width of [1100, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__copiedSql = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true,
        value: { writeText: async value => window.__copiedSql.push(value) } });
    });
    await page.goto(pathToFileURL(join(project, "dist/index.html")).href);
    await page.getByRole("button", { name: "Inspect queries", exact: true }).click();
    const sidebar = page.getByRole("complementary", { name: "Data source for Provider queries", exact: true });
    await sidebar.getByRole("tab", { name: "SQL query", exact: true }).click();
    const panel = sidebar.getByRole("tabpanel", { name: "SQL query", exact: true });
    const checkLink = async (scope, name, href) => {
      const link = scope.getByRole("link", { name, exact: true });
      assert.equal(await link.getAttribute("href"), href);
      assert.equal(await link.getAttribute("target"), "_blank");
      assert.deepEqual((await link.getAttribute("rel")).split(/\s+/u).sort(), ["noopener", "noreferrer"]);
      assert.equal(await scope.locator(`a[href="${href}"]`).count(), 1, "The provider destination is not duplicated");
      await link.focus();
      assert.equal(await link.evaluate(node => node === document.activeElement), true);
      const bounds = await link.boundingBox();
      assert.ok(bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width,
        "Provider actions remain readable within the source panel on mobile and desktop");
    };
    await checkLink(panel, "Open in Snowflake", snowflakeUrl);
    assert.equal(await panel.getByRole("link", { name: "Review notes", exact: true }).getAttribute("href"), "https://example.com/review-notes");
    await panel.getByRole("button", { name: "Copy", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__copiedSql), [queries.snowflake.source.sql]);
    await sidebar.getByRole("button", { name: "Choose reviewed data source", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Lakehouse result", exact: true }).click();
    await checkLink(panel, "Open in Databricks", databricksUrl);
    assert.equal(await panel.getByRole("link", { name: "Open in Snowflake", exact: true }).count(), 0);
    await panel.getByRole("button", { name: "Copy", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__copiedSql), [queries.snowflake.source.sql, queries.databricks.source.sql]);
    await sidebar.getByRole("button", { name: "Choose reviewed data source", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Recorded SQL only", exact: true }).click();
    assert.equal(await panel.getByRole("link").count(), 0, "A provider name alone cannot produce a query destination");
    assert.match(await panel.locator("pre").innerText(), /offline/u);
    await sidebar.getByRole("button", { name: "Close data source", exact: true }).click();
    await sidebar.waitFor({ state: "detached" });

    const receipt = page.getByRole("region", { name: "Combined finding receipt", exact: true });
    await receipt.getByRole("tab", { name: "SQL query", exact: true }).click();
    const receiptPanel = receipt.getByRole("tabpanel", { name: "SQL query", exact: true });
    await checkLink(receiptPanel.getByRole("region", { name: "Warehouse result", exact: true }), "Open in Snowflake", snowflakeUrl);
    await checkLink(receiptPanel.getByRole("region", { name: "Lakehouse result", exact: true }), "Open in Databricks", databricksUrl);
    assert.equal(await receiptPanel.getByRole("region", { name: "Recorded SQL only", exact: true }).getByRole("link").count(), 0);
    assert.equal(await receiptPanel.getByRole("button", { name: "Copy", exact: true }).count(), 0);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("Provider query links pass desktop/mobile source switching, exact SQL copying, link deduplication, receipt scoping, and missing-destination checks.");
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
