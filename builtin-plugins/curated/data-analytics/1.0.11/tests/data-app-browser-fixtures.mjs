import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDataAppFixtureBuild } from "./browser-helpers.mjs";

export function replaceUniqueAuthoredExpression(source, needle, replacement, description) {
  assert.equal(
    source.split(needle).length - 1,
    1,
    `The browser-only ${description} fixture must modify exactly one authored dashboard expression`,
  );
  return source.replace(needle, replacement);
}

export function withAuthoredFixturePages(source, emptyPage, otherPages) {
  source = replaceUniqueAuthoredExpression(
    source,
    "SortableRegion, useDataApp,",
    "SortableRegion, useDataApp, useDashboardTabs,",
    "dashboard pages public API import",
  );
  return replaceUniqueAuthoredExpression(
    source,
    "export function DashboardContent() {",
    "export function DashboardContent() {\n" +
      `  const { activeTabId: fixtureActiveTab } = useDashboardTabs(${JSON.stringify([emptyPage, ...otherPages])});\n` +
      `  if (fixtureActiveTab === ${JSON.stringify(emptyPage.id)}) return <h1>{${JSON.stringify(emptyPage.label)}}</h1>;\n` +
      "  return <FixtureDashboardContent fixtureActiveTab={fixtureActiveTab} />;\n" +
      "}\n" +
      "function FixtureDashboardContent({ fixtureActiveTab }) {",
    "authored dashboard page registration and content",
  );
}

export function createAuthoredPublishedFixtureBuilder({ template, pluginRoot, originatingThreadId, localThreadMetadata }) {
  return function buildAuthoredPublishedFixture(name, transform) {
    const fixtureRoot = mkdtempSync(join(tmpdir(), `data-dashboard-${name}-`));
    try {
      cpSync(template, fixtureRoot, {
        recursive: true,
        filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
      });
      const authoredPath = join(fixtureRoot, "src/content/dashboard/DashboardContent.jsx");
      writeFileSync(authoredPath, transform(readFileSync(authoredPath, "utf8")));
      const result = runDataAppFixtureBuild(fixtureRoot, {
        pluginRoot,
        env: { ...process.env, CODEX_SESSION_ID: originatingThreadId, CODEX_THREAD_ID: originatingThreadId },
      });
      assert.equal(result.status, 0, `${name}: ${result.stdout}\n${result.stderr}`);
      return readFileSync(join(fixtureRoot, "dist/index.html"), "utf8").replace(localThreadMetadata, "");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  };
}
