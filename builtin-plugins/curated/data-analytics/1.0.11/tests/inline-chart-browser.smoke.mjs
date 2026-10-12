import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Script } from "node:vm";

import { chromium } from "playwright-core";

import { resolveChromiumExecutable } from "./browser-helpers.mjs";
import { createInlineColorBrowserCases } from "./inline-chart-browser-colors.mjs";
import { createInlineSourcesBrowserCases } from "./inline-chart-browser-sources.mjs";
import { createWorkModePreview } from "./inline-chart-browser-work.mjs";
import { defaultInlineCacheDir, prepareInlineRuntime } from "../skills/visualize-data/scripts/inline-chart-build.mjs";
import { histogram } from "../templates/data-app/base/src/charting/chart-transforms.js";
import { INLINE_ICON_NAMES, inlineCapacityInput } from "../scripts/prebuilt/build.mjs";
import { inlineArtifactForChart } from "../templates/data-app/inline/chart-families.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// CI exercises a standalone plugin copy while reading the actual Codex host
// implementation from its reviewed repository checkout.
const monorepoRoot = resolve(process.env.DATA_INLINE_MONOREPO_ROOT || resolve(pluginRoot, "../../../.."));
const appRoot = join(monorepoRoot, "codex/codex-apps");
const inlineRenderer = join(pluginRoot, "skills/visualize-data/scripts/render-inline-chart.mjs");
const cacheRoot = resolve(process.env.DATA_INLINE_CACHE_DIR || defaultInlineCacheDir());
// Only the test's actual Codex host is compiled. Customer inline charts use the
// already-built runtime in the plugin and never borrow this dependency tree.
const hostDependencyRoot = resolve(
  process.env.DATA_INLINE_HOST_DEPENDENCY_ROOT || join(pluginRoot, "templates/data-app/base"),
);
const dependencyRequire = createRequire(join(hostDependencyRoot, "package.json"));
const executablePath = resolveChromiumExecutable();
const workspace = await mkdtemp(join(tmpdir(), "data-inline-chart-browser-"));
const rawSql = "SELECT active_users FROM restricted.raw_metric_input WHERE review_state = 'approved'";
const privateValue = "NEVER_EMBED_UNREVIEWED_PRIVATE_COLUMN";
const privateDefinition = "NEVER_EMBED_UNREVIEWED_PRIVATE_DEFINITION";
const privateSourceUrl = "https://reviewed-source.example.test/private-query";
const tabLabels = ["Overview", "Data preview", "SQL query", "Evidence flow"];
const marker = "<!--__INLINE_VISUALIZATION_FRAGMENT__-->";

const reviewedInput = {
  schemaVersion: 1,
  id: "reviewed-weekly-active-users",
  queryId: "reviewed-weekly-active-users-query",
  title: "Weekly active users by plan",
  chart: {
    type: "line",
    x: "week",
    y: "activeUsers",
    series: "plan",
    showArea: true,
    showXAxisLabel: false,
    yLabel: "Weekly active users",
    colors: { Pro: "var(--chart-1)", Team: "var(--chart-2)" },
    // Off-domain annotations must not promote private input columns into the artifact.
    annotations: [{ id: "unresolved-private-event", kind: "event", at: "2099-01-01",
      field: "unapprovedColumn", label: "UNAPPROVED_ANNOTATION_LABEL" }],
  },
  rows: [
    { week: "2026-07-13", plan: "Pro", activeUsers: 12400, unapprovedColumn: privateValue },
    { week: "2026-07-13", plan: "Team", activeUsers: 8200, unapprovedColumn: privateValue },
    { week: "2026-07-20", plan: "Pro", activeUsers: 13150, unapprovedColumn: privateValue },
    { week: "2026-07-20", plan: "Team", activeUsers: 8610, unapprovedColumn: privateValue },
    { week: "2026-07-27", plan: "Pro", activeUsers: 13800, unapprovedColumn: privateValue },
    { week: "2026-07-27", plan: "Team", activeUsers: 9040, unapprovedColumn: privateValue },
    { week: "2026-08-03", plan: "Pro", activeUsers: 14750, unapprovedColumn: privateValue },
    { week: "2026-08-03", plan: "Team", activeUsers: 9650, unapprovedColumn: privateValue },
    { week: "2026-08-10", plan: "Pro", activeUsers: 15800, unapprovedColumn: privateValue },
    { week: "2026-08-10", plan: "Team", activeUsers: 10290, unapprovedColumn: privateValue },
    { week: "2026-08-17", plan: "Pro", activeUsers: 17100, unapprovedColumn: privateValue },
    { week: "2026-08-17", plan: "Team", activeUsers: 11150, unapprovedColumn: privateValue },
  ],
  source: {
    label: "Reviewed product analytics",
    sql: rawSql,
    executedAt: "2026-08-17T16:00:00.000Z",
    tables: [{ name: "analytics.approved_weekly_users", href: `${privateSourceUrl}/table` }],
    files: [{ label: "Approved sample snapshot.csv", href: `${privateSourceUrl}/snapshot` }],
    links: [{ label: "Open reviewed query", href: privateSourceUrl }],
    metricDefinitions: [
      {
        label: "Weekly active users",
        field: "activeUsers",
        definition: "Unique accounts active during the reviewed week.",
      },
      {
        label: "Reporting week",
        field: "week",
        definition: "UTC reporting week when the reviewed account activity occurred.",
      },
      {
        label: "Plan attribution",
        field: "plan",
        definition: "Reviewed subscription plan attributed to the active account.",
      },
      {
        label: "Unapproved private attribution",
        field: "unapprovedColumn",
        definition: privateDefinition,
      },
    ],
    caveats: ["Reviewed sample contains no customer-level records."],
    evidenceFlow: [
      { title: "Approved reviewed snapshot", detail: "Twelve reviewed weekly plan observations." },
      { title: "Reviewed SQL query", detail: rawSql },
      { title: "Replacement metacharacters", detail: "$& $` $' $$ $1" },
    ],
  },
  generatedAt: "2026-08-17T16:05:00.000Z",
  height: 280,
  theme: "codex-classic",
};

const isolatedGapInput = {
  schemaVersion: 1,
  id: "reviewed-missing-week-wau",
  queryId: "reviewed-missing-week-wau-query",
  title: "Sample ChatGPT weekly active users",
  chart: {
    type: "line",
    x: "week",
    y: "wau",
    xLabel: "Week starting",
    yLabel: "Weekly active users",
    showLegend: false,
  },
  rows: [
    { week: "2026-07-27", wau: 120 },
    { week: "2026-08-03", wau: null },
    { week: "2026-08-10", wau: 145 },
  ],
  source: {
    label: "User-provided sample data",
    caveats: [
      "Sample values, not actual reported ChatGPT usage.",
      "August 3 is missing, not zero; no interpolation is applied.",
    ],
  },
  theme: "codex-classic",
};

const editableInput = {
  ...structuredClone(reviewedInput),
  id: "reviewed-inline-chart-editing",
  queryId: "reviewed-inline-chart-editing-query",
  title: "Reviewed editable weekly active users",
  description: "Twelve reviewed weekly plan observations.",
  chart: {
    ...reviewedInput.chart,
    showArea: false,
    showXAxisLabel: true,
    xLabel: "Reporting week",
    stackable: false,
  },
  columns: ["baseline"],
  rows: reviewedInput.rows.map((row) => ({ ...row, baseline: row.activeUsers - 250 })),
  source: {
    ...reviewedInput.source,
    metricDefinitions: [
      ...reviewedInput.source.metricDefinitions,
      { label: "Baseline", field: "baseline", definition: "The explicitly approved comparison value." },
    ],
  },
};

const metadataEditorInput = {
  ...structuredClone(editableInput),
  id: "reviewed-inline-chart-metadata",
  queryId: "reviewed-inline-chart-metadata-query",
  title:
    "Illustrative ChatGPT weekly active users by subscription plan, compared with the reviewed baseline for the six reporting weeks ending August 17, 2026",
  description:
    "These illustrative weekly values compare Pro and Team activity with an explicitly reviewed baseline. The reporting window runs from July 13 through August 17, 2026, and the reviewed payload retains every approved observation.\nThis is a presentation of the supplied sample, not an official report of ChatGPT usage; editing its title or description must not change the underlying values, metric definitions, or disclosure choices.",
};

const editedMetadata = {
  title:
    "ChatGPT weekly active users across Pro and Team plans — reviewed observations, baseline comparison, and reporting caveats for July 13 through August 17, 2026",
  description:
    "Compare the reviewed weekly activity for Pro and Team with the approved baseline, keeping the original reporting dates and subscription-plan attribution. This view is intended for the analytics launch review and uses illustrative sample values only.\nThe data source, twelve observations, metric definitions, and missing-value semantics remain unchanged. Title and description edits last only while this inline visualization remains loaded.",
};

const histogramEditorInput = {
  schemaVersion: 1,
  id: "reviewed-inline-histogram-editing",
  title: "Reviewed latency distribution",
  chart: { type: "histogram", y: "latencyMs", showLegend: false, showValues: true, showYAxisLabel: true, stackable: false },
  rows: [82, 95, 102, 110, 111, 135, 180, 260].map((latencyMs) => ({ latencyMs })),
  source: {
    label: "User-provided reviewed latency sample",
    caveats: ["Illustrative reviewed values, not production latency."],
  },
  theme: "codex-classic",
};

const histogramEditorBuckets = [
  { start: 0, end: 100, count: 2 },
  { start: 100, end: 200, count: 5 },
  { start: 200, end: 300, count: 1 },
];

const ratioHistogramInput = {
  schemaVersion: 1,
  id: "reviewed-inline-ratio-histogram-editing",
  title: "Reviewed conversion-rate distribution",
  chart: { ...histogramEditorInput.chart, y: "conversionRate" },
  rows: [0.12, 0.19].map((conversionRate) => ({ conversionRate })),
  source: {
    label: "User-provided reviewed conversion-rate sample",
    caveats: ["Illustrative reviewed ratios, not production conversion rates."],
  },
  theme: "codex-classic",
};

const axisWeeks = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"];
const closeThousandValues = [960, 976, 992, 1008, 1024, 1040];
const closeBillionValues = closeThousandValues.map((value) => value * 1_000_000);

function numericAxisInput(id, values, { type = "line", field = "activeUsers", chart = {}, rows } = {}) {
  return {
    schemaVersion: 1,
    id: `reviewed-readable-axis-${id}`,
    title: `Reviewed readable ${id} axis`,
    chart: {
      type,
      x: "week",
      y: field,
      startAtZero: false,
      showLegend: false,
      ...chart,
    },
    rows: rows ?? values.map((value, index) => ({ week: axisWeeks[index], [field]: value })),
    source: {
      label: "User-provided reviewed axis sample",
      caveats: ["Illustrative reviewed values; axis labels must remain distinct."],
    },
    theme: "codex-classic",
  };
}

const numericAxisCases = [
  {
    id: "scaled-millions",
    input: numericAxisInput("scaled-millions", closeThousandValues, {
      field: "activeUsersMillions",
      chart: { yLabel: "WAU (millions)" },
    }),
    axes: [{ orientation: "y", semantic: "small-integer" }],
  },
  {
    id: "raw-billion",
    input: numericAxisInput("raw-billion", closeBillionValues),
    axes: [{ orientation: "y", semantic: "large-compact" }],
  },
  {
    id: "negative-thousand",
    input: numericAxisInput(
      "negative-thousand",
      closeThousandValues.map((value) => -value),
    ),
    axes: [{ orientation: "y", semantic: "negative" }],
  },
  {
    id: "near-zero",
    input: numericAxisInput("near-zero", [-0.0002, -0.00012, -0.00004, 0.00004, 0.00012, 0.0002], {
      field: "measuredDelta",
    }),
    axes: [{ orientation: "y", semantic: "signed-near-zero" }],
  },
  {
    id: "tight-percentage",
    input: numericAxisInput("tight-percentage", [0.0995, 0.0997, 0.0999, 0.1001, 0.1003, 0.1005], {
      field: "conversionRate",
    }),
    axes: [{ orientation: "y", semantic: "precise-percentage" }],
  },
  {
    id: "horizontal-thousand",
    input: numericAxisInput("horizontal-thousand", closeThousandValues, {
      type: "horizontalBar",
      chart: { x: "plan", showYAxisLabel: false },
      rows: closeThousandValues.map((activeUsers, index) => ({
        plan: `Plan ${String.fromCodePoint(65 + index)}`,
        activeUsers,
      })),
    }),
    axes: [{ orientation: "x", semantic: "small-integer" }],
  },
  {
    id: "scatter-both-axes",
    input: numericAxisInput("scatter-both-axes", closeBillionValues, {
      type: "scatter",
      field: "revenue",
      chart: { x: "sessions", showYAxisLabel: false },
      rows: closeBillionValues.map((revenue, index) => ({
        sessions: closeThousandValues[index],
        revenue,
      })),
    }),
    axes: [
      { orientation: "x", semantic: "numeric" },
      { orientation: "y", semantic: "large-compact" },
    ],
  },
  {
    id: "composed-secondary",
    input: numericAxisInput("composed-secondary", closeThousandValues, {
      chart: { fields: ["activeUsers", "weeklyGrowth"], barFields: ["weeklyGrowth"] },
      rows: closeThousandValues.map((activeUsers, index) => ({
        week: axisWeeks[index],
        activeUsers,
        weeklyGrowth: closeBillionValues[index],
      })),
    }),
    axes: [
      { orientation: "y", semantic: "small-integer" },
      { orientation: "y", semantic: "large-compact" },
    ],
  },
  {
    id: "box-plot",
    input: numericAxisInput("box-plot", closeThousandValues, {
      type: "boxPlot",
      chart: { x: "plan", showYAxisLabel: false },
      rows: [
        { plan: "Pro", minimum: 960, lowerQuartile: 975, median: 990, upperQuartile: 1005, maximum: 1020 },
        { plan: "Team", minimum: 980, lowerQuartile: 995, median: 1010, upperQuartile: 1025, maximum: 1040 },
      ],
    }),
    axes: [{ orientation: "y", semantic: "numeric" }],
  },
];

let resources;

function requirePass(condition, message) {
  assert.ok(condition, message);
}

async function renderFixture(name, input, options = []) {
  const inputPath = join(workspace, `${name}.json`);
  const outputPath = join(workspace, `${name}.html`);
  await writeFile(inputPath, JSON.stringify(input));
  // Synthetic fixtures are reviewed here; production callers must make this
  // disclosure choice explicitly after reviewing their executed statement.
  const sqlOptions = options.includes("--omit-sql") || options.includes("--include-sql") ? [] : ["--include-sql"];
  const args = [inlineRenderer, "--input", inputPath, "--output", outputPath, "--offline", ...sqlOptions, ...options];
  args.push("--cache-dir", cacheRoot);
  const result = spawnSync(process.execPath, args, {
    cwd: pluginRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `Production inline renderer failed for ${name}:\n${result.stdout}\n${result.stderr}`);
  const metadata = JSON.parse(result.stdout.trim());
  const fragment = await readFile(outputPath, "utf8");
  assert.equal(
    metadata.path,
    await realpath(outputPath),
    "production renderer should report the canonical output path across /var aliases",
  );
  requirePass(metadata.prebuilt, "browser regressions must use the shipped prebuilt inline renderer");
  assert.equal(metadata.cacheHit, false, "A prebuilt inline renderer must not depend on a mutable compiler cache");
  requirePass(metadata.bytes < 1_000_000, "production fragments must remain below the 1 MB delivery limit");
  return { name, metadata, fragment, outputPath: metadata.path, root: `#${metadata.rootId}` };
}

async function buildActualVisualizationHost() {
  const kit = await readFile(join(monorepoRoot, "plugins/visualize/skills/visualize/assets/visualize.html"), "utf8");
  const styles = await readFile(
    join(monorepoRoot, "plugins/visualize/skills/visualize/assets/visualize.css"),
    "utf8",
  );
  const { build } = await import(pathToFileURL(dependencyRequire.resolve("vite")).href);
  const output = join(workspace, "actual-visualization-host");
  await build({
    root: workspace,
    configFile: false,
    cacheDir: join(workspace, ".vite-visualization-host"),
    logLevel: "silent",
    resolve: {
      alias: { "@": join(appRoot, "webview/src") },
    },
    define: {
      __RESTRICTED__: "false",
      __VISUALIZATION_HTML__: JSON.stringify(kit),
      __VISUALIZATION_STYLES__: JSON.stringify(styles),
    },
    build: {
      outDir: output,
      emptyOutDir: false,
      target: "node22",
      minify: false,
      lib: {
        entry: {
          "visualization-sandbox-html": join(appRoot, "webview/src/visualization/visualization-sandbox-html.ts"),
          "visualization-standalone-document": join(appRoot, "webview/src/visualization/visualization-standalone-document.ts"),
        },
        formats: ["es"],
        fileName: (_format, entryName) => `${entryName}.mjs`,
      },
    },
  });
  const host = await import(pathToFileURL(join(output, "visualization-sandbox-html.mjs")).href);
  const standalone = await import(pathToFileURL(join(output, "visualization-standalone-document.mjs")).href);
  return { ...host, ...standalone, kit, styles };
}

function extractRuntime(html, rootId) {
  const root = html.indexOf(`<div id="${rootId}"`);
  requirePass(root >= 0, "actual host HTML must contain the generated production chart root");
  const start = html.indexOf("<script>", root);
  requirePass(start >= 0, "production chart runtime script must survive host insertion");
  const end = html.indexOf("</script>", start);
  requirePass(end > start, "production chart runtime must remain a complete script");
  return html.slice(start + "<script>".length, end).trim();
}

function verifyHostInsertion(fixture, host) {
  const original = extractRuntime(fixture.fragment, fixture.metadata.rootId);
  const oldHost = host.kit.replace(marker, fixture.fragment);
  const actualHost = host.getVisualizationSandboxHtml(fixture.fragment);
  assert.equal(
    extractRuntime(oldHost, fixture.metadata.rootId),
    original,
    "production bundle must remain compatible with older String.replace-based Codex hosts",
  );
  assert.equal(
    extractRuntime(actualHost, fixture.metadata.rootId),
    original,
    "actual getVisualizationSandboxHtml must preserve the inline runtime byte-for-byte",
  );
  assert.doesNotThrow(() => new Script(original));
  assert.doesNotThrow(() => new Script(extractRuntime(oldHost, fixture.metadata.rootId)));
  assert.doesNotThrow(() => new Script(extractRuntime(actualHost, fixture.metadata.rootId)));
}

async function standalonePreview(fixture, host) {
  verifyHostInsertion(fixture, host);
  const destination = join(workspace, `${fixture.name}-actual-host.html`);
  await writeFile(
    destination,
    host.getStandaloneVisualizationHtml(fixture.fragment, {
      locale: "en",
      title: fixture.name,
      styles: `${host.styles}\n:root{--chart-1:#ff00aa;--mark-radius:97}`,
    }),
  );
  return destination;
}

async function createPageScenario(browser, preview, { width = 736, colorScheme = "light", height = 1200, reducedMotion = "reduce" } = {}) {
  const context = await browser.newContext({
    viewport: { width: width + 32, height },
    colorScheme,
    reducedMotion,
  });
  const network = [];
  const errors = [];
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("file:") || url.startsWith("data:") || url === "about:srcdoc") {
      await route.continue();
      return;
    }
    if (resources.has(url)) {
      await route.fulfill({
        path: resources.get(url),
        contentType: "application/javascript; charset=utf-8",
        headers: { "access-control-allow-origin": "*" },
      });
      return;
    }
    if (url === "https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js") {
      await route.fulfill({
        body: "globalThis.lucide={createIcons(){}};",
        contentType: "application/javascript; charset=utf-8",
        headers: { "access-control-allow-origin": "*" },
      });
      return;
    }
    network.push(url);
    await route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.goto(pathToFileURL(preview).href, { timeout: 30_000, waitUntil: "load" });
  return {
    context,
    errors,
    network,
    page,
    async verifyClean() {
      assert.deepEqual(network, [], "inline production chart must not make unexpected network requests");
      assert.deepEqual(errors, [], "inline production chart must not raise browser exceptions");
    },
  };
}

async function createScenario(browser, fixture, preview, options = {}) {
  const scenario = await createPageScenario(browser, preview, options);
  assert.equal(
    await scenario.page.locator("iframe").getAttribute("sandbox"),
    "allow-scripts",
    "browser regressions must use the real restricted Codex iframe",
  );
  const frame = scenario.page.frameLocator("iframe");
  const root = frame.locator(fixture.root);
  await root.locator(".recharts-wrapper").first().waitFor({ state: "visible", timeout: 20_000 });
  await assertNoInlineSources(root);
  return {
    ...scenario,
    frame,
    root,
    async verifyClean() {
      await assertNoInlineSources(root);
      await scenario.verifyClean();
    },
  };
}

async function assertNoInlineSources(root) {
  assert.equal(await root.getByRole("button", { name: "View data source" }).count(), 0,
    "Inline charts use the final answer's Sources view");
  assert.equal(await root.locator(".source-sidebar-layer,.source-tabs").count(), 0,
    "Inline charts must not mount a duplicate source inspector");
}

function generatedPayload(fixture) {
  const expression = new RegExp(
    `<script\\s+type="application/json"\\s+id="${fixture.metadata.rootId}-data">([\\s\\S]*?)<\\/script>`,
    "u",
  );
  const match = fixture.fragment.match(expression);
  requirePass(match, "Generated inline fragment must contain its reviewed JSON payload");
  return JSON.parse(match[1]);
}

const containedEditorSelector = ".chart-editor-dialog--contained";
const editorReadySelector = '.explorer-chart[data-ready="true"]';
const keyboardModifier = process.platform === "darwin" ? "Meta" : "Control";

async function readCollapsedGeometry(root) {
  return root.evaluate(async (element) => {
    const shadow = element.shadowRoot;
    const round = (value) => Math.round(value * 100) / 100;
    const read = () => {
      const host = element.getBoundingClientRect();
      const box = (node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { width: round(rect.width), height: round(rect.height), top: round(rect.top - host.top) };
      };
      const content = shadow.querySelector(".data-inline-chart-content");
      const layout = content?.querySelector(".chart-layout");
      const frame = content?.querySelector(".chart-frame");
      const responsive = frame?.querySelector(".recharts-responsive-container");
      const wrapper = frame?.querySelector(".recharts-wrapper");
      const svg = wrapper?.querySelector("svg.recharts-surface");
      return {
        root: box(element),
        stage: box(shadow.querySelector(".data-inline-chart-stage")),
        content: { box: box(content), alignSelf: content ? getComputedStyle(content).alignSelf : null },
        layout: box(layout),
        frame: {
          box: box(frame),
          minHeight: frame ? getComputedStyle(frame).minHeight : null,
          flex: frame ? getComputedStyle(frame).flex : null,
        },
        responsive: box(responsive),
        wrapper: box(wrapper),
        svg: svg
          ? {
              box: box(svg),
              width: svg.getAttribute("width"),
              height: svg.getAttribute("height"),
              viewBox: svg.getAttribute("viewBox"),
            }
          : null,
        viewport: {
          width: element.ownerDocument.documentElement.clientWidth,
          height: element.ownerDocument.documentElement.clientHeight,
        },
      };
    };
    const deadline = performance.now() + 3000;
    let previous;
    let stableFrames = 0;
    let observed;
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      observed = read();
      const signature = JSON.stringify({
        content: observed.content,
        layout: observed.layout,
        frame: observed.frame,
        responsive: observed.responsive,
        wrapper: observed.wrapper,
        svg: observed.svg,
      });
      stableFrames = signature === previous ? stableFrames + 1 : 0;
      previous = signature;
      if (stableFrames >= 3 && observed.wrapper?.width > 0 && observed.wrapper?.height > 0 && observed.svg) {
        return observed;
      }
    }
    throw new Error(`Collapsed chart geometry did not settle: ${JSON.stringify(observed)}`);
  });
}

function assertCollapsedGeometryUnchanged(actual, expected, phase, phases) {
  const chartBox = ({ content, layout, frame, responsive, wrapper, svg }) => ({
    content,
    layout,
    frame,
    responsive,
    wrapper,
    svg,
  });
  try {
    assert.deepEqual(chartBox(actual), chartBox(expected), `${phase} must not resize the chart behind the overlay`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ test: "inline-editor-underlying-geometry", phase, phases })}\n`);
    throw error;
  }
}

async function assertDescriptionTooltip(root, description) {
  const trigger = root.locator(".data-inline-chart-content .component-header")
    .getByRole("button", { name: "More information", exact: true });
  await trigger.focus();
  const tooltip = root.locator(".info-tooltip[role='tooltip']");
  await tooltip.waitFor({ state: "visible" });
  assert.equal(await tooltip.textContent(), description);
  assert.equal(await tooltip.locator("strong").count(), 0, "Descriptions remain plain text");
  await trigger.press("Escape");
  await tooltip.waitFor({ state: "detached" });
}

async function readCollapsedPresentation(root) {
  await readCollapsedGeometry(root);
  return root.evaluate((element) => {
    const content = element.shadowRoot.querySelector(".data-inline-chart-content");
    return {
      componentId: content.getAttribute("data-component-id"),
      queryId: content.getAttribute("data-query-id"),
      title: content.querySelector(".component-title-text")?.textContent,
      axisTitles: {
        footer: [...content.querySelectorAll(".chart-axis-label")].map((node) => node.textContent.trim()).sort(),
        // Recharts portals axis and mark labels into shared SVG layers. Their
        // insertion order is not semantic, and mark values are not axis titles.
        svg: [...content.querySelectorAll("text.recharts-label")]
          .filter((node) => !node.closest(".recharts-label-list"))
          .map((node) => ({
            text: node.textContent.trim(),
            rotation: Number(node.getAttribute("transform")?.match(/rotate\(\s*([+-]?[\d.]+)/u)?.[1] ?? 0),
          }))
          .sort((left, right) => left.rotation - right.rotation || left.text.localeCompare(right.text)),
      },
      curves: [...content.querySelectorAll(".recharts-line-curve")].map((curve) => ({
        path: curve.getAttribute("d"),
        stroke: getComputedStyle(curve).stroke,
      })),
      bars: content.querySelectorAll(".recharts-bar-rectangle").length,
      areas: content.querySelectorAll(".recharts-area-area").length,
      legends: [...content.querySelectorAll(".chart-legend-button")].map((button) => ({
        label: button.textContent.trim(),
        pressed: button.getAttribute("aria-pressed"),
      })),
    };
  });
}

async function assertReviewedPayloadUnchanged(root, fixture) {
  const actual = await root.evaluate((element, rootId) => {
    return JSON.parse(element.ownerDocument.getElementById(`${rootId}-data`).textContent);
  }, fixture.metadata.rootId);
  assert.deepEqual(
    actual,
    generatedPayload(fixture),
    "Presentation edits must not rewrite the approved inline payload",
  );
  assert.equal(actual.query.rows, undefined, "The immutable payload stores the shared reviewed rows only once");
  return actual;
}

async function readHostLocks(root) {
  return root.evaluate((element) => ({
    bodyOverflow: element.ownerDocument.body.style.overflow,
    bodyPointerEvents: element.ownerDocument.body.style.pointerEvents,
    documentOverflow: element.ownerDocument.documentElement.style.overflow,
  }));
}

async function assertContainedPortal(root, portal, label) {
  await portal.waitFor({ state: "visible", timeout: 10_000 });
  const hostId = await root.getAttribute("id");
  const bounds = await portal.evaluate((element) => {
    const host = element.getRootNode().host;
    const rect = element.getBoundingClientRect();
    const hostRect = host?.getBoundingClientRect();
    return {
      hostId: host?.id,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      hostLeft: hostRect?.left,
      hostRight: hostRect?.right,
      color: getComputedStyle(element).getPropertyValue("--chart-1").trim(),
      hostColor: host ? getComputedStyle(host).getPropertyValue("--chart-1").trim() : null,
      background: getComputedStyle(element).backgroundColor,
    };
  });
  assert.equal(bounds.hostId, hostId, `${label} must remain in its own chart's Shadow DOM`);
  assert.equal(bounds.color, bounds.hostColor, `${label} must inherit the chart's isolated theme`);
  requirePass(bounds.width > 0, `${label} must have visible geometry`);
  requirePass(
    bounds.left >= bounds.hostLeft - 1 && bounds.right <= bounds.hostRight + 1,
    `${label} must fit inside the inline chart: ${JSON.stringify(bounds)}`,
  );
  assert.notEqual(bounds.background, "rgba(0, 0, 0, 0)", `${label} must retain its shared surface styling`);
}

async function openChartEditor(root, { keyboard = false } = {}) {
  const accessibleTrigger = root.locator(".data-inline-chart-content .component-custom-actions button.menu-trigger");
  if (keyboard) {
    await accessibleTrigger.focus();
    await accessibleTrigger.press("Enter");
  } else {
    await accessibleTrigger.click();
  }
  assert.deepEqual(await root.getByRole("menuitem").allTextContents(),
    ["Edit chart", "Copy as image", "Copy data"]);
  await root.getByRole("menuitem", { name: "Edit chart", exact: true }).click();
  const editor = root.locator(containedEditorSelector);
  await editor.waitFor({ state: "visible", timeout: 10_000 });
  await editor.locator(editorReadySelector).waitFor({ state: "visible", timeout: 20_000 });
  const trigger = root.locator(".data-inline-chart-content .component-custom-actions button.menu-trigger");
  assert.equal(await root.locator(".data-inline-chart-content").evaluate((element) => element.inert), true);
  return { editor, trigger };
}

async function assertChartEditorClosed(root, editor, action) {
  await editor.waitFor({ state: "detached", timeout: 10_000 });
  const trigger = root.locator(".data-inline-chart-content .component-custom-actions button.menu-trigger");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  requirePass(
    await trigger.evaluate((element) => new Promise((resolve) => {
      // Wait for the closing commit and its focus restoration.
      let frames = 0;
      function check() {
        if (element.getRootNode().activeElement === element) return resolve(true);
        if (++frames >= 30) return resolve(false);
        requestAnimationFrame(check);
      }
      check();
    })),
    `${action} must restore focus to the inline chart's own edit trigger`,
  );
  assert.equal(await root.locator(".data-inline-chart-content").evaluate((element) => element.inert), false);
}

async function dismissChartEditor(root, editor, action = "Cancel") {
  await editor.getByRole("button", { name: action, exact: true }).click();
  await assertChartEditorClosed(root, editor, action);
}

async function sharedEditorSelect(root, editor, label) {
  const control = editor.getByRole("button", { name: label, exact: true });
  await control.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await control.getAttribute("aria-haspopup"), "menu");
  return control;
}

async function sharedSelectOptions(root, control) {
  if (await control.isDisabled()) return [{ label: await control.locator(".select-value").innerText() }];
  await control.click();
  const menu = root.locator(".select-content");
  await menu.waitFor({ state: "visible" });
  await assertContainedPortal(root, menu, "Shared dropdown");
  const labels = await menu.getByRole("menuitemradio").allTextContents();
  await menu.press("Escape");
  await menu.waitFor({ state: "detached" });
  return labels.map(label => ({ label: label.trim() }));
}

async function selectEditorChoice(root, editor, label, choice) {
  const control = await sharedEditorSelect(root, editor, label);
  await control.click();
  await root.getByRole("menuitemradio", { name: choice, exact: true }).click();
  assert.equal(await control.locator(".select-value").innerText(), choice);
}

async function assertEditorFocusLoop(page, editor) {
  const focusEdge = (element, edge) => {
    const candidates = [...element.querySelectorAll("a[href],button,input,select,textarea,[tabindex]")].filter(
      (candidate) =>
        candidate.tabIndex >= 0 &&
        !candidate.disabled &&
        candidate.getClientRects().length > 0 &&
        getComputedStyle(candidate).visibility !== "hidden",
    );
    const target = edge === "first" ? candidates[0] : candidates.at(-1);
    target?.focus();
    return Boolean(target);
  };
  requirePass(await editor.evaluate(focusEdge, "last"), "The inline editor must have keyboard-reachable controls");
  await page.keyboard.press("Tab");
  requirePass(
    await editor.evaluate((element) => element.contains(element.getRootNode().activeElement)),
    "Tab must not leave the contained editor for the inert chart behind it",
  );
  await editor.evaluate(focusEdge, "first");
  await page.keyboard.press("Shift+Tab");
  requirePass(
    await editor.evaluate((element) => element.contains(element.getRootNode().activeElement)),
    "Shift+Tab must not leave the contained editor",
  );
}

async function readReviewedSource(root, fixture) {
  const { rows, query, filters } = await assertReviewedPayloadUnchanged(root, fixture);
  const snapshot = { rows, query, filters };
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes(privateValue), "Editing must not expose unapproved row columns");
  assert.ok(!serialized.includes(privateDefinition), "Editing must not expose private metric definitions");
  if (!fixture.metadata.includedSql) assert.ok(!serialized.includes(rawSql));
  if (!fixture.metadata.includedSourceUrls) assert.ok(!serialized.includes(privateSourceUrl));
  return snapshot;
}

async function remountInlineChart(root, fixture) {
  await root.evaluate((element, rootId) => {
    const payload = JSON.parse(element.ownerDocument.getElementById(`${rootId}-data`).textContent);
    payload.query.rows = payload.rows;
    globalThis.CodexDataInlineChart.mountInlineChart(element, payload);
  }, fixture.metadata.rootId);
  await root.locator(".data-inline-chart-content .recharts-wrapper").waitFor({ state: "visible", timeout: 20_000 });
  await root.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await root.locator(".data-inline-react-root").count(), 1, "Remount must clean up the old React root");
  assert.equal(
    await root.locator("style[data-inline-dashboard-styles]").count(),
    1,
    "Remount must not duplicate styles",
  );
}

async function chooseEditorColor(page, root, editor, name, color) {
  const trigger = editor.getByRole("button", { name: `Color for ${name}`, exact: true });
  await trigger.click();
  const popover = root.locator(".explorer-color-popover");
  await assertContainedPortal(root, popover, `${name} color picker`);
  await popover.getByRole("button", { name: color, exact: true }).click();
  await popover.getByRole("button", { name: `Custom color for ${name}`, exact: true }).click();
  await popover.getByRole("textbox", { name: `Custom hex color for ${name}`, exact: true }).focus();
  await page.keyboard.press("Escape");
  await popover.waitFor({ state: "detached", timeout: 5_000 });
  requirePass(await editor.isVisible(), "Escape must close the color picker before the chart editor");
  requirePass(
    await trigger.evaluate((element) => element.getRootNode().activeElement === element),
    "Closing a color picker must restore focus to its own trigger inside the chart's Shadow DOM",
  );
  await trigger.getByText(color, { exact: true }).waitFor();
}

async function inspectEditorChoices(page, root, editor) {
  const type = await sharedEditorSelect(root, editor, "Chart type");
  assert.deepEqual(
    (await sharedSelectOptions(root, type)).map(({ label }) => label).sort(),
    ["Line", "Area", "Sparkline", "Bar", "Horizontal bar"].sort(),
    "Inline type changes must stay within compatible, unstacked chart families",
  );
  await type.click();
  const typeMenu = root.locator(".chart-type-menu");
  assert.deepEqual(await typeMenu.locator(".select-group-label").allTextContents(), ["Trends", "Comparisons"]);
  await typeMenu.press("Escape");
  requirePass(await editor.isVisible(), "Escape closes the dropdown without discarding the editor draft");

  const y = await sharedEditorSelect(root, editor, "Y axis");
  assert.deepEqual(
    (await sharedSelectOptions(root, y)).map(({ label }) => label).sort(),
    ["Active users", "Baseline"].sort(),
    "The measure picker must expose only finite numeric columns already approved in the fragment",
  );
  await selectEditorChoice(root, editor, "Y axis", "Baseline");
  await editor.getByRole("button", { name: "Undo chart change" }).click();
  await y.getByText("Active users", { exact: true }).waitFor();

  const x = await sharedEditorSelect(root, editor, "X axis");
  const xChoices = (await sharedSelectOptions(root, x)).map(({ label }) => label);
  assert.ok(xChoices.includes("Week"));
  assert.ok(!xChoices.includes("Plan"), "An X mapping must not collapse repeated reviewed row grain");
  assert.doesNotMatch(xChoices.join("\n"), /unapproved|private/iu);

  const split = await sharedEditorSelect(root, editor, "Split series by");
  const splitChoices = (await sharedSelectOptions(root, split)).map(({ label }) => label);
  assert.ok(splitChoices.includes("Plan"));
  assert.ok(!splitChoices.includes("No series"), "Removing a split must not collapse two reviewed rows per week");
  assert.doesNotMatch(splitChoices.join("\n"), /baseline|active users|unapproved|private/iu);
  assert.equal(await split.locator(".select-value").innerText(), "Plan");

  await chooseEditorColor(page, root, editor, "Pro", "Theme color 3");
  const color = editor.getByRole("button", { name: "Color for Pro", exact: true });
  await color.focus();
  await page.keyboard.press(`${keyboardModifier}+z`);
  await color.getByText("Theme color 1", { exact: true }).waitFor();
  await page.keyboard.press(`${keyboardModifier}+Shift+z`);
  await color.getByText("Theme color 3", { exact: true }).waitFor();
}

async function setEditedPresentation(root, editor, { title, description, type = "Bar" }) {
  await editor.getByRole("textbox", { name: "Chart title", exact: true }).fill(title);
  await editor.getByRole("textbox", { name: "Chart description", exact: true }).fill(description);
  await editor.getByRole("textbox", { name: "X axis title", exact: true }).fill("Reviewed reporting week");
  await editor.getByRole("textbox", { name: "Y axis title", exact: true }).fill("Reviewed active users");
  const legend = editor.getByRole("switch", { name: "Show legend", exact: true });
  if (await legend.isChecked()) await legend.click();
  await selectEditorChoice(root, editor, "Chart type", type);
  await editor.locator(".explorer-chart .recharts-bar-rectangle").first().waitFor({ state: "visible" });
  assert.equal(await editor.locator(".explorer-chart .chart-legend").count(), 0);
  assert.equal(await editor.getByRole("button", { name: "Apply", exact: true }).isDisabled(), false);
}

async function inspectEditorLifecycle(browser, fixture, preview, { width, colorScheme }) {
  const scenario = await createScenario(browser, fixture, preview, { width, colorScheme });
  const { context, page, root } = scenario;
  const original = generatedPayload(fixture).component;
  const editedTitle = "Reviewed weekly users — presentation edit";
  const editedDescription = "Reviewed values only; <strong>not new evidence</strong>.";
  try {
    const geometryPhases = { initial: await readCollapsedGeometry(root) };
    const baseline = await readCollapsedPresentation(root);
    const sourceBefore = await readReviewedSource(root, fixture);
    const hostLocks = await readHostLocks(root);
    let { editor } = await openChartEditor(root, { keyboard: true });
    geometryPhases.editorOpened = await readCollapsedGeometry(root);
    assertCollapsedGeometryUnchanged(
      geometryPhases.editorOpened,
      geometryPhases.initial,
      "Opening the chart editor before any draft change",
      geometryPhases,
    );
    assert.deepEqual(await readCollapsedPresentation(root), baseline, "Opening the editor must not mutate the chart");
    assert.equal(await root.getByRole("dialog", { name: original.title, exact: true }).count(), 1);
    await assertContainedPortal(root, editor, "Chart editor");
    assert.deepEqual(await readHostLocks(root), hostLocks, "A contained editor must not lock the host document body");
    await assertEditorFocusLoop(page, editor);
    assert.equal(await editor.getByRole("button", { name: "Apply", exact: true }).isDisabled(), true);
    assert.equal(await editor.getByRole("textbox", { name: "Chart title", exact: true }).inputValue(), original.title);
    assert.equal(
      await editor.getByRole("textbox", { name: "Chart description", exact: true }).inputValue(),
      original.description,
    );
    assert.doesNotMatch(await editor.innerText(), /not saved to the task or source data/iu);
    assert.equal(
      await editor
        .getByRole("button", {
          name: /^(?:Copy data|Copy as image|Refresh data|Publish|Share|Edit SQL|Run query|Add data)(?:$|\s)/iu,
        })
        .count(),
      0,
      "The inline editor must not expose unavailable host, storage, or data-mutation actions",
    );
    await inspectEditorChoices(page, root, editor);
    await setEditedPresentation(root, editor, { title: editedTitle, description: editedDescription });
    geometryPhases.editorDraft = await readCollapsedGeometry(root);
    assertCollapsedGeometryUnchanged(
      geometryPhases.editorDraft,
      geometryPhases.initial,
      "Changing the editor draft",
      geometryPhases,
    );
    assert.deepEqual(
      await readCollapsedPresentation(root),
      baseline,
      "Draft previews must not mutate the inline chart",
    );
    await assertReviewedPayloadUnchanged(root, fixture);
    await dismissChartEditor(root, editor);
    geometryPhases.editorClosed = await readCollapsedGeometry(root);
    assertCollapsedGeometryUnchanged(
      geometryPhases.editorClosed,
      geometryPhases.initial,
      "Canceling the chart editor",
      geometryPhases,
    );
    assert.deepEqual(
      await readCollapsedPresentation(root),
      baseline,
      "Cancel must discard every presentation draft field",
    );

    ({ editor } = await openChartEditor(root));
    assert.equal(await editor.getByRole("button", { name: "Apply", exact: true }).isDisabled(), true);
    assert.equal(await editor.getByRole("textbox", { name: "Chart title", exact: true }).inputValue(), original.title);
    await chooseEditorColor(page, root, editor, "Pro", "Theme color 3");
    await setEditedPresentation(root, editor, { title: editedTitle, description: editedDescription });
    await dismissChartEditor(root, editor, "Apply");
    await root.locator(".data-inline-chart-content .recharts-bar-rectangle").first().waitFor({ state: "visible" });
    await root.locator(".component-title-text").filter({ hasText: editedTitle }).waitFor();
    await assertDescriptionTooltip(root, editedDescription);
    const applied = await readCollapsedPresentation(root);
    assert.equal(applied.title, editedTitle);
    assert.ok(applied.bars > 0);
    assert.equal(applied.curves.length, 0);
    assert.equal(applied.legends.length, 0);
    assert.equal(applied.componentId, baseline.componentId);
    assert.equal(applied.queryId, baseline.queryId);
    await assertReviewedPayloadUnchanged(root, fixture);
    assert.deepEqual(
      await readReviewedSource(root, fixture),
      sourceBefore,
      "Apply must leave recorded source data unchanged",
    );

    ({ editor } = await openChartEditor(root));
    assert.equal(await editor.getByRole("textbox", { name: "Chart title", exact: true }).inputValue(), editedTitle);
    assert.equal(await editor.getByRole("button", { name: "Chart type", exact: true }).locator(".select-value").innerText(), "Bar");
    assert.equal(await editor.getByRole("button", { name: "Apply", exact: true }).isDisabled(), true);
    await editor.getByRole("button", { name: "Reset", exact: true }).click();
    await editor.locator(".explorer-chart .recharts-line-curve").first().waitFor({ state: "visible" });
    assert.equal(await editor.getByRole("textbox", { name: "Chart title", exact: true }).inputValue(), original.title);
    assert.deepEqual(await readCollapsedPresentation(root), applied, "Reset must remain a draft until Apply");
    await dismissChartEditor(root, editor);
    assert.deepEqual(
      await readCollapsedPresentation(root),
      applied,
      "Cancel after Reset must preserve the applied chart",
    );

    ({ editor } = await openChartEditor(root));
    await editor.getByRole("button", { name: "Reset", exact: true }).click();
    await dismissChartEditor(root, editor, "Apply");
    await root.locator(".data-inline-chart-content .recharts-line-curve").nth(1).waitFor({ state: "visible" });
    assert.deepEqual(
      await readCollapsedPresentation(root),
      baseline,
      "Applied Reset must restore the original presentation",
    );

    ({ editor } = await openChartEditor(root));
    await editor.getByRole("textbox", { name: "Chart title", exact: true }).fill("Session-only chart title");
    await editor.getByRole("textbox", { name: "Chart title", exact: true }).focus();
    await page.keyboard.press(`${keyboardModifier}+s`);
    await assertChartEditorClosed(root, editor, "Keyboard Apply");
    assert.equal((await readCollapsedPresentation(root)).title, "Session-only chart title");
    await remountInlineChart(root, fixture);
    assert.deepEqual(
      await readCollapsedPresentation(root),
      baseline,
      "Remount must restore the immutable generated presentation",
    );
    await assertReviewedPayloadUnchanged(root, fixture);
    assert.deepEqual(await readReviewedSource(root, fixture), sourceBefore);
    assert.deepEqual(await readHostLocks(root), hostLocks);
    const isolation = await root.evaluate((element) => ({
      outside: element.ownerDocument.querySelectorAll(".chart-editor-dialog,.chart-type-menu,.explorer-color-popover")
        .length,
      outerTheme: element.ownerDocument.documentElement.getAttribute("data-app-theme"),
      outerRadius: getComputedStyle(element.ownerDocument.documentElement).getPropertyValue("--mark-radius").trim(),
      scrollWidth: element.ownerDocument.documentElement.scrollWidth,
      clientWidth: element.ownerDocument.documentElement.clientWidth,
    }));
    assert.equal(isolation.outside, 0, "Editor portals must not escape into the unstyled host document");
    assert.equal(isolation.outerTheme, null);
    assert.equal(isolation.outerRadius, "97");
    requirePass(isolation.scrollWidth <= isolation.clientWidth + 1,
      `Editing must not introduce horizontal overflow: ${JSON.stringify({ width, colorScheme, isolation })}`);
    await scenario.verifyClean();
    process.stdout.write(
      `${JSON.stringify({ test: "shared-inline-chart-editing", width, colorScheme, result: "pass" })}\n`,
    );
  } finally {
    await context.close();
  }
}

async function readMetadataEditorLayout(editor) {
  await editor
    .locator(".chart-editor-metadata textarea.chart-editor-metadata-input")
    .first()
    .waitFor({ state: "visible" });
  await editor.locator(".dialog-header").focus();
  return editor.evaluate(async (element) => {
    const number = (value) => Number.parseFloat(value) || 0;
    const round = (value) => Math.round(value * 100) / 100;
    const box = (node) => {
      const rect = node.getBoundingClientRect();
      return Object.fromEntries(
        ["left", "right", "top", "bottom", "width", "height"].map((key) => [key, round(rect[key])]),
      );
    };
    const contentBox = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const left = rect.left + number(style.borderLeftWidth) + number(style.paddingLeft);
      const right = rect.right - number(style.borderRightWidth) - number(style.paddingRight);
      return { left: round(left), right: round(right), width: round(right - left) };
    };
    const controlStyle = (node) => {
      const style = getComputedStyle(node);
      return Object.fromEntries(
        [
          "backgroundColor",
          "color",
          "borderTopColor",
          "borderTopStyle",
          "borderTopWidth",
          "borderRadius",
          "fontFamily",
          "fontSize",
          "fontWeight",
          "paddingLeft",
          "paddingRight",
        ].map((key) => [key, style[key]]),
      );
    };
    const section = element.querySelector(".chart-editor-metadata");
    const panel = element.querySelector(".explorer-controls");
    const reference = element.querySelector('input[aria-label="X axis title"]');
    if (!section || !panel || !reference)
      throw new Error("The canonical metadata section and reference control must exist");
    const read = () => {
      const sectionStyle = getComputedStyle(section);
      return {
        section: contentBox(section),
        panel: { clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth },
        viewport: {
          clientWidth: element.ownerDocument.documentElement.clientWidth,
          scrollWidth: element.ownerDocument.documentElement.scrollWidth,
        },
        reference: controlStyle(reference),
        tokens: Object.fromEntries(
          ["--control", "--border", "--control-radius", "--text", "--font-sans"].map((name) => [
            name,
            sectionStyle.getPropertyValue(name).trim(),
          ]),
        ),
        fields: ["Chart title", "Chart description"].map((name) => {
          const control = section.querySelector(`textarea.chart-editor-metadata-input[aria-label="${name}"]`);
          const field = control?.closest(".chart-editor-metadata-field");
          const label = field?.querySelector(":scope > span");
          if (!control || !field || !label) throw new Error(`Missing canonical metadata field: ${name}`);
          const style = getComputedStyle(control);
          return {
            name,
            tag: control.tagName,
            value: control.value,
            rows: control.rows,
            wrap: control.wrap,
            box: box(control),
            field: contentBox(field),
            label: { box: box(label), clientWidth: label.clientWidth, scrollWidth: label.scrollWidth },
            clientWidth: control.clientWidth,
            scrollWidth: control.scrollWidth,
            clientHeight: control.clientHeight,
            scrollHeight: control.scrollHeight,
            contentHeight: control.clientHeight - number(style.paddingTop) - number(style.paddingBottom),
            lineHeight: number(style.lineHeight) || number(style.fontSize) * 1.2,
            boxSizing: style.boxSizing,
            whiteSpace: style.whiteSpace,
            style: controlStyle(control),
          };
        }),
      };
    };
    const deadline = performance.now() + 3000;
    let previous;
    let stableFrames = 0;
    let observed;
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      observed = read();
      const signature = JSON.stringify(observed);
      stableFrames = signature === previous ? stableFrames + 1 : 0;
      previous = signature;
      if (stableFrames >= 3 && observed.fields.every((field) => field.box.width > 0 && field.box.height > 0))
        return observed;
    }
    throw new Error(`Metadata control layout did not settle: ${JSON.stringify(observed)}`);
  });
}

async function assertMetadataEditorLayout(editor, expected, phase) {
  const observed = await readMetadataEditorLayout(editor);
  const close = (left, right) => Math.abs(left - right) <= 1.5;
  assert.ok(Object.values(observed.tokens).every(Boolean), `${phase}: metadata must inherit the chart theme tokens`);
  assert.notEqual(observed.reference.backgroundColor, "rgba(0, 0, 0, 0)");
  assert.ok(Number.parseFloat(observed.reference.borderRadius) > 0, `${phase}: canonical controls must remain rounded`);
  for (const [index, field] of observed.fields.entries()) {
    const key = index === 0 ? "title" : "description";
    const detail = `${phase}: ${field.name}: ${JSON.stringify(field)}`;
    assert.equal(field.tag, "TEXTAREA", detail);
    assert.equal(field.value, expected[key], `${phase}: preserve the complete ${key}`);
    assert.equal(field.rows, 1, detail);
    assert.notEqual(field.wrap, "off", detail);
    assert.equal(field.boxSizing, "border-box", detail);
    assert.ok(["pre-wrap", "break-spaces"].includes(field.whiteSpace), detail);
    assert.deepEqual(
      field.style,
      observed.reference,
      `${phase}: ${field.name} must use the existing themed input styling`,
    );
    assert.equal(field.style.borderTopStyle, "solid", detail);
    assert.ok(Number.parseFloat(field.style.borderTopWidth) >= 1, detail);
    requirePass(
      close(field.field.left, observed.section.left) &&
        close(field.field.right, observed.section.right) &&
        close(field.box.left, field.field.left) &&
        close(field.box.right, field.field.right),
      `${phase}: metadata must use the full available settings-panel width: ${JSON.stringify(observed)}`,
    );
    requirePass(
      field.label.box.bottom <= field.box.top + 1 &&
        close(field.label.box.left, field.box.left) &&
        field.label.scrollWidth <= field.label.clientWidth + 1,
      `${phase}: the metadata label must be fully readable above its control: ${detail}`,
    );
    requirePass(
      field.scrollWidth <= field.clientWidth + 1 && field.scrollHeight <= field.clientHeight + 1,
      `${phase}: the complete metadata value must fit without internal clipping: ${detail}`,
    );
    requirePass(
      field.contentHeight >= field.lineHeight * (index === 0 ? 1.8 : 2.8),
      `${phase}: long metadata must wrap and grow beyond a single-line input: ${detail}`,
    );
  }
  requirePass(
    observed.panel.scrollWidth <= observed.panel.clientWidth + 1 &&
      observed.viewport.scrollWidth <= observed.viewport.clientWidth + 1,
    `${phase}: metadata must not cause horizontal overflow: ${JSON.stringify(observed)}`,
  );
  return observed;
}

async function assertMetadataHeaderReadable(scope, expectedTitle, { editing = false, phase } = {}) {
  const observed = await scope.evaluate((element, editing) => {
    const header = element.querySelector(editing ? ".dialog-header" : ".component-header");
    const title = header?.querySelector(editing ? "h2" : ".component-title-text");
    if (!header || !title) throw new Error("The chart title and its header must exist");
    const box = (node) => {
      const rect = node.getBoundingClientRect();
      return Object.fromEntries(["left", "right", "top", "bottom", "width", "height"].map((key) => [key, rect[key]]));
    };
    const range = element.ownerDocument.createRange();
    // Check text glyphs here; the information control has its own placement check below.
    const textNodes = element.ownerDocument.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    const lines = [];
    while (textNodes.nextNode()) {
      if (textNodes.currentNode.parentElement.closest(".info-tooltip")) continue;
      range.selectNodeContents(textNodes.currentNode);
      lines.push(...range.getClientRects());
    }
    return {
      text: title.textContent,
      header: box(header),
      title: box(title),
      lines: lines.map((rect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      })),
      clientWidth: header.clientWidth,
      scrollWidth: header.scrollWidth,
      buttons: [...header.querySelectorAll("button")].filter(button => button.getClientRects().length).map((button) => ({
        name: button.getAttribute("aria-label") || button.textContent.trim(),
        box: box(button),
        visibility: getComputedStyle(button).visibility,
        clientWidth: button.clientWidth,
        scrollWidth: button.scrollWidth,
      })),
    };
  }, editing);
  const detail = `${phase}: ${JSON.stringify(observed)}`;
  const inside = (inner, outer) =>
    inner.left >= outer.left - 1.5 &&
    inner.right <= outer.right + 1.5 &&
    inner.top >= outer.top - 1.5 &&
    inner.bottom <= outer.bottom + 1.5;
  const overlaps = (left, right) =>
    Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 &&
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1;
  assert.equal(observed.text, expectedTitle, `${phase}: header must retain the complete chart title`);
  requirePass(observed.title.width > 0 && observed.title.height > 0 && inside(observed.title, observed.header), detail);
  requirePass(observed.lines.length > 0 && observed.lines.every((line) => inside(line, observed.title)), detail);
  requirePass(observed.scrollWidth <= observed.clientWidth + 1, detail);
  for (const button of observed.buttons) {
    const minimumTarget = button.name === "More information" ? 16 : 24;
    // The mobile info glyph stays inside the final word's inline title, while
    // its larger hit area may extend into the header's 16px bottom margin.
    const placed = button.name === "More information"
      ? button.box.left >= observed.title.left - 1.5 && button.box.right <= observed.header.right + 1.5
        && button.box.bottom <= observed.header.bottom + 16
      : inside(button.box, observed.header) && !overlaps(button.box, observed.title);
    requirePass(
      button.visibility === "visible" &&
        button.box.width >= minimumTarget &&
        button.box.height >= minimumTarget &&
        placed &&
        button.scrollWidth <= button.clientWidth + 1 &&
        button.box.left >= observed.header.left - 1.5,
      `${phase}: header action must remain readable and separate from the title: ${JSON.stringify(button)}; ${detail}`,
    );
  }
  for (const [index, button] of observed.buttons.entries()) {
    for (const other of observed.buttons.slice(index + 1)) {
      requirePass(!overlaps(button.box, other.box), `${phase}: ${button.name} must not overlap ${other.name}`);
    }
  }
  for (const name of editing ? ["Cancel", "Apply", "Reset"] : [`${expectedTitle} actions`]) {
    assert.ok(
      observed.buttons.some((button) => button.name === name),
      `${phase}: ${name} must remain available`,
    );
  }
}

async function inspectMetadataEditor(browser, fixture, preview, { colorScheme }) {
  const scenario = await createScenario(browser, fixture, preview, { width: 360, colorScheme });
  const { context, page, root } = scenario;
  try {
    const original = { title: metadataEditorInput.title, description: metadataEditorInput.description };
    const collapsed = root.locator(".data-inline-chart-content");
    const baseline = await readCollapsedPresentation(root);
    const sourceBefore = await readReviewedSource(root, fixture);
    const resize = async (width) => {
      await page.setViewportSize({ width: width + 32, height: 1200 });
      await readCollapsedGeometry(root);
    };
    const fillMetadata = async (editor, metadata) => {
      await editor.getByRole("textbox", { name: "Chart title", exact: true }).fill(metadata.title);
      await editor.getByRole("textbox", { name: "Chart description", exact: true }).fill(metadata.description);
    };
    const assertOriginalData = async () => {
      const payload = await assertReviewedPayloadUnchanged(root, fixture);
      assert.deepEqual(payload.rows, generatedPayload(fixture).rows);
      assert.deepEqual(payload.component.chart, generatedPayload(fixture).component.chart);
    };

    await assertMetadataHeaderReadable(collapsed, original.title, { phase: "Original metadata header" });
    let { editor } = await openChartEditor(root);
    await assertMetadataEditorLayout(editor, original, "Original long metadata");
    await fillMetadata(editor, editedMetadata);
    const narrow = await assertMetadataEditorLayout(editor, editedMetadata, "Edited metadata at 360px");
    await assertMetadataHeaderReadable(editor, original.title, { editing: true, phase: "Editor header at 360px" });
    await resize(600);
    const expanded = await assertMetadataEditorLayout(editor, editedMetadata, "Edited metadata at 600px");
    requirePass(
      expanded.fields[0].box.width > narrow.fields[0].box.width + 100 &&
        expanded.fields[0].box.height < narrow.fields[0].box.height &&
        expanded.fields[1].box.height <= narrow.fields[1].box.height,
      "Metadata must shrink vertically when a live resize gives the stacked controls more horizontal room",
    );
    await resize(736);
    await assertMetadataEditorLayout(editor, editedMetadata, "Edited metadata at the two-column breakpoint");
    await assertMetadataHeaderReadable(editor, original.title, { editing: true, phase: "Editor header at 736px" });
    await resize(360);
    const returned = await assertMetadataEditorLayout(
      editor,
      editedMetadata,
      "Edited metadata after returning to 360px",
    );
    assert.deepEqual(
      returned.fields.map(({ box }) => ({ width: box.width, height: box.height })),
      narrow.fields.map(({ box }) => ({ width: box.width, height: box.height })),
      "Autosized metadata must return to its original dimensions after a narrow-wide-narrow resize",
    );
    assert.deepEqual(
      await readCollapsedPresentation(root),
      baseline,
      "Long metadata drafts must not mutate the applied chart",
    );
    await dismissChartEditor(root, editor, "Cancel");
    assert.deepEqual(
      await readCollapsedPresentation(root),
      baseline,
      "Cancel must discard the complete metadata draft",
    );
    await assertOriginalData();

    ({ editor } = await openChartEditor(root));
    await assertMetadataEditorLayout(editor, original, "Metadata after Cancel");
    await fillMetadata(editor, editedMetadata);
    await assertMetadataEditorLayout(editor, editedMetadata, "Metadata before Apply");
    await dismissChartEditor(root, editor, "Apply");
    const applied = await readCollapsedPresentation(root);
    assert.equal(applied.title, editedMetadata.title);
    await assertDescriptionTooltip(root, editedMetadata.description);
    await assertMetadataHeaderReadable(collapsed, editedMetadata.title, { phase: "Applied metadata header at 360px" });
    await resize(736);
    await assertMetadataHeaderReadable(collapsed, editedMetadata.title, { phase: "Applied metadata header at 736px" });
    await resize(360);
    await assertOriginalData();
    assert.deepEqual(await readReviewedSource(root, fixture), sourceBefore);

    ({ editor } = await openChartEditor(root));
    await assertMetadataEditorLayout(editor, editedMetadata, "Reopened applied metadata");
    await assertMetadataHeaderReadable(editor, editedMetadata.title, {
      editing: true,
      phase: "Reopened metadata header",
    });
    await editor.getByRole("button", { name: "Reset", exact: true }).click();
    await assertMetadataEditorLayout(editor, original, "Reset long metadata draft");
    assert.deepEqual(await readCollapsedPresentation(root), applied, "Reset must remain a draft until Apply");
    await dismissChartEditor(root, editor, "Apply");
    assert.deepEqual(
      await readCollapsedPresentation(root),
      baseline,
      "Reset must restore both complete original metadata strings",
    );
    await assertMetadataHeaderReadable(collapsed, original.title, { phase: "Reset metadata header" });
    await assertOriginalData();
    assert.deepEqual(await readReviewedSource(root, fixture), sourceBefore);
    await scenario.verifyClean();
    process.stdout.write(`${JSON.stringify({ test: "inline-chart-metadata-layout", colorScheme, result: "pass" })}\n`);
  } finally {
    await context.close();
  }
}

async function assertHistogramAxisTitles(chart, titles, phase) {
  // Recharts 3 portals SVG Labels into a z-index layer, outside the axis group.
  const selectors = [
    ["x", ".chart-axis-label"],
    ["y", 'text.recharts-label[transform*="rotate(-90"]'],
  ];
  for (const [axis, selector] of selectors) {
    const label = chart.locator(selector);
    try {
      if (titles[axis]) {
        await label.filter({ hasText: titles[axis] }).waitFor({ state: "visible", timeout: 10_000 });
        assert.equal((await label.textContent()).trim(), titles[axis], `${phase}: effective ${axis} axis title`);
      } else {
        await label.waitFor({ state: "detached", timeout: 10_000 });
      }
    } catch (error) {
      const labels = await chart.evaluate((element) =>
        [...element.querySelectorAll(".chart-axis-label, text.recharts-label")].slice(0, 20).map((node) => ({
          text: node.textContent.trim(),
          transform: node.getAttribute("transform"),
          parentClass: node.parentElement?.getAttribute("class"),
        })),
      );
      process.stderr.write(
        `${JSON.stringify({ test: "inline-histogram-axis-title", phase, axis, expected: titles[axis], labels })}\n`,
      );
      throw error;
    }
  }
}

async function inspectCartesianTypeEditing(browser, fixture, preview) {
  const scenario = await createScenario(browser, fixture, preview, { width: 360, colorScheme: "dark" });
  const { root, context } = scenario;
  try {
    await root.locator(".data-inline-chart-content .recharts-bar-rectangle").first().waitFor();
    const { editor } = await openChartEditor(root);
    await selectEditorChoice(root, editor, "Chart type", "Area");
    await editor.locator(".recharts-area-area").first().waitFor({ state: "visible" });
    await dismissChartEditor(root, editor, "Apply");
    await root.locator(".data-inline-chart-content .recharts-area-area").first().waitFor({ state: "visible" });
    await assertReviewedPayloadUnchanged(root, fixture);
    await scenario.verifyClean();
    process.stdout.write(`${JSON.stringify({ test: "cartesian-bundle-to-trend-edit", result: "pass" })}\n`);
  } finally {
    await context.close();
  }
}

async function inspectSpecializedEditor(browser, fixture, preview) {
  const scenario = await createScenario(browser, fixture, preview, { width: 360, colorScheme: "light" });
  const { context, root } = scenario;
  try {
    const originalTitles = { x: "Latency Ms", y: "Observations" };
    const editedTitles = { x: "Latency (ms)", y: "Sample count" };
    const hiddenTitles = { x: "", y: "" };
    const collapsed = root.locator(".data-inline-chart-content");
    const expectedCounts = histogramEditorBuckets.map((bucket) => bucket.count);
    const expectedRanges = histogramEditorBuckets.map((bucket) => `${bucket.start}–${bucket.end}`);
    const assertHistogram = async (chart, titles, phase) => {
      await assertHistogramAxisTitles(chart, titles, phase);
      const observed = await chart.evaluate(async (element) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const texts = (selector) => [...element.querySelectorAll(selector)].map((node) => node.textContent.trim());
        return {
          bars: element.querySelectorAll(".recharts-bar-rectangle").length,
          counts: texts(".recharts-label-list text.recharts-label").map(Number),
          ranges: texts(".recharts-xAxis-tick-labels text title"),
          countTicks: texts(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value"),
        };
      });
      assert.equal(observed.bars, histogramEditorBuckets.length, `${phase}: all occupied histogram bins must remain`);
      assert.deepEqual(observed.counts, expectedCounts, `${phase}: rendered histogram counts must remain exact`);
      assert.equal(
        observed.counts.reduce((total, count) => total + count, 0),
        8,
        `${phase}: all raw observations count`,
      );
      requirePass(
        observed.ranges.length > 0 && observed.ranges.every((range) => expectedRanges.includes(range)),
        `${phase}: the histogram must retain canonical ranges: ${JSON.stringify(observed.ranges)}`,
      );
      const countTicks = observed.countTicks.map(parseNumericAxisLabel);
      requirePass(
        countTicks.length >= 2 &&
          Math.min(...countTicks) === 0 &&
          Math.max(...countTicks) >= 2 &&
          countTicks.every(Number.isInteger) &&
          observed.countTicks.every((tick) => !tick.includes("%")),
        `${phase}: the count axis must remain zero-based and integral: ${JSON.stringify(observed.countTicks)}`,
      );
    };
    const assertHistogramEditor = async (editor, titles, phase) => {
      const type = await sharedEditorSelect(root, editor, "Chart type");
      assert.equal(await type.locator(".select-value").innerText(), "Histogram");
      assert.equal(
        await type.isDisabled(),
        true,
        "A specialized original must not offer incompatible type conversions",
      );
      for (const label of ["X axis", "Y axis", "Group by", "Measure", "Split series by"]) {
        const control = editor.getByRole("button", { name: label, exact: true });
        assert.ok(
          !(await control.count()) || (await control.isDisabled()),
          `${label} must be locked for a specialized chart`,
        );
      }
      assert.equal(
        await editor.getByRole("switch", { name: "Start axis at zero", exact: true }).count(),
        0,
        "A histogram must not offer an ineffective count-axis baseline control",
      );
      for (const [axis, label] of [
        ["x", "X axis title"],
        ["y", "Y axis title"],
      ]) {
        const input = editor.getByRole("textbox", { name: label, exact: true });
        assert.equal(await input.isEditable(), true, `${phase}: ${label} must be editable`);
        assert.equal(await input.inputValue(), titles[axis], `${phase}: ${label} must reflect the effective title`);
      }
      await assertHistogram(editor.locator(editorReadySelector), titles, `${phase} preview`);
    };
    const assertOriginalData = async () => {
      const payload = await assertReviewedPayloadUnchanged(root, fixture);
      assert.equal(payload.component.chart.type, "histogram");
      assert.equal(payload.component.chart.y, "latencyMs");
      assert.deepEqual(
        payload.rows,
        histogramEditorInput.rows,
        "The approved payload must retain eight raw observations",
      );
      assert.deepEqual(histogram(payload.rows, "latencyMs"), histogramEditorBuckets);
      return payload;
    };

    await assertOriginalData();
    await assertHistogram(collapsed, originalTitles, "Original histogram");
    const baseline = await readCollapsedPresentation(root);
    const sourceBefore = await readReviewedSource(root, fixture);
    let { editor } = await openChartEditor(root);
    await assertHistogramEditor(editor, originalTitles, "Original histogram");
    await editor.getByRole("textbox", { name: "Chart title", exact: true }).fill("Edited latency distribution");
    await editor.getByRole("textbox", { name: "X axis title", exact: true }).fill(editedTitles.x);
    await editor.getByRole("textbox", { name: "Y axis title", exact: true }).fill(editedTitles.y);
    await assertHistogramEditor(editor, editedTitles, "Edited histogram draft");
    assert.deepEqual(
      await readCollapsedPresentation(root),
      baseline,
      "Histogram drafts must not mutate the applied chart",
    );
    await dismissChartEditor(root, editor, "Apply");
    assert.equal((await readCollapsedPresentation(root)).title, "Edited latency distribution");
    await assertHistogram(collapsed, editedTitles, "Applied histogram labels");
    await assertOriginalData();
    assert.deepEqual(
      await readReviewedSource(root, fixture),
      sourceBefore,
      "Histogram edits must retain the reviewed source",
    );

    ({ editor } = await openChartEditor(root));
    await assertHistogramEditor(editor, editedTitles, "Reopened histogram");
    await editor.getByRole("textbox", { name: "X axis title", exact: true }).fill("");
    await assertHistogram(
      editor.locator(editorReadySelector),
      { x: "", y: editedTitles.y },
      "Hidden measurement title",
    );
    await editor.getByRole("textbox", { name: "Y axis title", exact: true }).fill("");
    await assertHistogramEditor(editor, hiddenTitles, "Hidden histogram titles");
    await dismissChartEditor(root, editor, "Apply");
    await assertHistogram(collapsed, hiddenTitles, "Applied hidden histogram titles");
    await assertOriginalData();
    assert.deepEqual(await readReviewedSource(root, fixture), sourceBefore);

    ({ editor } = await openChartEditor(root));
    await assertHistogramEditor(editor, hiddenTitles, "Reopened hidden histogram titles");
    await editor.getByRole("button", { name: "Reset", exact: true }).click();
    assert.equal(
      await editor.getByRole("textbox", { name: "Chart title", exact: true }).inputValue(),
      histogramEditorInput.title,
    );
    await assertHistogramEditor(editor, originalTitles, "Reset histogram draft");
    await assertHistogram(collapsed, hiddenTitles, "Unapplied histogram reset");
    await dismissChartEditor(root, editor, "Apply");
    await assertHistogram(collapsed, originalTitles, "Reset histogram");
    assert.deepEqual(
      await readCollapsedPresentation(root),
      baseline,
      "Reset must restore the exact original histogram",
    );
    await assertOriginalData();
    assert.deepEqual(await readReviewedSource(root, fixture), sourceBefore);
    await scenario.verifyClean();
    process.stdout.write(`${JSON.stringify({ test: "specialized-inline-editor-restrictions", result: "pass" })}\n`);
  } finally {
    await context.close();
  }
}

async function inspectRatioHistogramTooltip(browser, fixture, preview) {
  const scenario = await createScenario(browser, fixture, preview, { width: 360, colorScheme: "dark" });
  const { context, page, root } = scenario;
  try {
    const collapsed = root.locator(".data-inline-chart-content");
    const originalTitles = { x: "Conversion Rate", y: "Observations" };
    const editedTitles = { x: "Reviewed conversion rate", y: "Observation count" };
    const assertCountTooltip = async (titles, phase) => {
      await assertHistogramAxisTitles(collapsed, titles, phase);
      const bars = collapsed.locator(".recharts-bar-rectangle");
      assert.equal(await bars.count(), 2, `${phase}: both raw ratios retain their canonical bins`);
      assert.deepEqual(
        (await collapsed.locator(".recharts-label-list text.recharts-label").allTextContents()).map((text) =>
          text.trim(),
        ),
        ["1", "1"],
        `${phase}: histogram mark labels must show plain observation counts`,
      );
      await bars.first().scrollIntoViewIfNeeded();
      const box = await bars.first().boundingBox();
      requirePass(box && box.width > 0 && box.height > 0, `${phase}: the histogram must have a real hover target`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const tooltip = collapsed.locator(".chart-tooltip");
      await tooltip.waitFor({ state: "visible", timeout: 5_000 });
      assert.equal((await tooltip.locator("strong").innerText()).trim(), "0.1–0.2");
      assert.deepEqual(
        (await tooltip.locator("b").allTextContents()).map((text) => text.trim()),
        ["1"],
        `${phase}: the ratio measurement must not turn an observation count into a percentage`,
      );
      assert.doesNotMatch(await tooltip.innerText(), /%/u, `${phase}: histogram tooltips must show counts, not rates`);
      await page.mouse.move(0, 0);
    };
    const assertOriginalData = async () => {
      const payload = await assertReviewedPayloadUnchanged(root, fixture);
      assert.equal(payload.component.chart.type, "histogram");
      assert.equal(payload.component.chart.y, "conversionRate");
      assert.deepEqual(payload.rows, ratioHistogramInput.rows);
      assert.deepEqual(histogram(payload.rows, "conversionRate").map(({ count }) => count), [1, 1]);
    };

    await assertOriginalData();
    await assertCountTooltip(originalTitles, "Original ratio histogram");
    const baseline = await readCollapsedPresentation(root);
    const sourceBefore = await readReviewedSource(root, fixture);
    let { editor } = await openChartEditor(root);
    const type = await sharedEditorSelect(root, editor, "Chart type");
    assert.equal(await type.locator(".select-value").innerText(), "Histogram");
    assert.equal(await type.isDisabled(), true);
    assert.equal(await editor.getByRole("switch", { name: "Start axis at zero", exact: true }).count(), 0);
    await editor.getByRole("textbox", { name: "Chart title", exact: true }).fill("Edited conversion-rate distribution");
    await editor.getByRole("textbox", { name: "X axis title", exact: true }).fill(editedTitles.x);
    await editor.getByRole("textbox", { name: "Y axis title", exact: true }).fill(editedTitles.y);
    await assertHistogramAxisTitles(editor.locator(editorReadySelector), editedTitles, "Ratio histogram draft");
    await dismissChartEditor(root, editor, "Apply");
    assert.equal((await readCollapsedPresentation(root)).title, "Edited conversion-rate distribution");
    await assertCountTooltip(editedTitles, "Edited ratio histogram");
    await assertOriginalData();
    assert.deepEqual(await readReviewedSource(root, fixture), sourceBefore);

    ({ editor } = await openChartEditor(root));
    assert.equal(await (await sharedEditorSelect(root, editor, "Chart type")).locator(".select-value").innerText(), "Histogram");
    await editor.getByRole("button", { name: "Reset", exact: true }).click();
    await dismissChartEditor(root, editor, "Apply");
    await assertCountTooltip(originalTitles, "Reset ratio histogram");
    assert.deepEqual(await readCollapsedPresentation(root), baseline);
    await assertOriginalData();
    assert.deepEqual(await readReviewedSource(root, fixture), sourceBefore);
    await scenario.verifyClean();
    process.stdout.write(`${JSON.stringify({ test: "ratio-inline-histogram-count-tooltip", result: "pass" })}\n`);
  } finally {
    await context.close();
  }
}

async function assertUnbridgedEditedGap(root) {
  const marks = await root.evaluate((element) => {
    const chart = element.shadowRoot.querySelector(".data-inline-chart-content");
    return {
      dots: [...chart.querySelectorAll('.recharts-line-dot[data-isolated-point="true"]')].map((dot) =>
        Number(dot.getAttribute("r")),
      ),
      curves: [...chart.querySelectorAll(".recharts-line-curve")].map((curve) => curve.getTotalLength()),
    };
  });
  assert.deepEqual(marks.dots, [3, 3], "Editing must preserve both real observations around the missing week");
  assert.ok(
    marks.curves.every((length) => length < 0.5),
    "Editing must not interpolate across a reviewed null",
  );
}

async function inspectEditedNullGap(browser, fixture, preview, { width, colorScheme }) {
  const scenario = await createScenario(browser, fixture, preview, { width, colorScheme });
  const { context, root } = scenario;
  try {
    const sourceBefore = await readReviewedSource(root, fixture);
    let { editor } = await openChartEditor(root);
    await editor.getByRole("textbox", { name: "X axis title", exact: true }).fill("Reviewed week");
    await editor.getByRole("switch", { name: "Start axis at zero", exact: true }).click();
    await dismissChartEditor(root, editor, "Apply");
    await assertUnbridgedEditedGap(root);
    assert.deepEqual(await readReviewedSource(root, fixture), sourceBefore);
    let payload = await assertReviewedPayloadUnchanged(root, fixture);
    assert.deepEqual(payload.rows, isolatedGapInput.rows);
    assert.deepEqual(Object.keys(payload.rows[0]), ["week", "wau"]);
    ({ editor } = await openChartEditor(root));
    await editor.getByRole("button", { name: "Reset", exact: true }).click();
    await dismissChartEditor(root, editor, "Apply");
    await assertUnbridgedEditedGap(root);
    payload = await assertReviewedPayloadUnchanged(root, fixture);
    assert.deepEqual(payload.rows, isolatedGapInput.rows);
    await scenario.verifyClean();
    process.stdout.write(`${JSON.stringify({ test: "edited-inline-null-gap", width, colorScheme, result: "pass" })}\n`);
  } finally {
    await context.close();
  }
}

async function inspectEditedSqlOptIn(browser, fixture, preview) {
  const scenario = await createScenario(browser, fixture, preview);
  const { context, root } = scenario;
  try {
    assert.equal(
      generatedPayload(fixture).query.source.sql,
      rawSql,
      "The explicitly approved fixture must embed the original SQL byte-for-byte",
    );
    const before = await readReviewedSource(root, fixture);
    assert.equal(before.query.source.sql, rawSql);
    const { editor } = await openChartEditor(root);
    await editor.getByRole("textbox", { name: "Chart title", exact: true }).fill("Edited approved SQL chart");
    await dismissChartEditor(root, editor, "Apply");
    const payload = await assertReviewedPayloadUnchanged(root, fixture);
    assert.equal(payload.query.source.sql, rawSql, "Editing must preserve the exact approved SQL");
    assert.deepEqual(
      await readReviewedSource(root, fixture),
      before,
      "Editing must preserve explicit source disclosure choices",
    );
    await scenario.verifyClean();
    process.stdout.write(`${JSON.stringify({ test: "edited-inline-source-disclosure", result: "pass" })}\n`);
  } finally {
    await context.close();
  }
}

function parseNumericAxisLabel(label) {
  const value = label.replaceAll(",", "").replace("−", "-").trim();
  const match = value.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:([KMBT])|(%))?$/iu);
  requirePass(match, `Visible numeric axis tick must remain readable: ${JSON.stringify(label)}`);
  const magnitude = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return Number(match[1]) * (match[2] ? magnitude[match[2].toUpperCase()] : match[3] ? 0.01 : 1);
}

async function inspectReadableAxes(browser, fixture, preview, descriptor, { width, colorScheme }) {
  const scenario = await createScenario(browser, fixture, preview, { width, colorScheme });
  const { context, errors, root } = scenario;
  try {
    await root.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const observed = await root.evaluate((element) => {
      const shadow = element.shadowRoot;
      const host = element.getBoundingClientRect();
      const box = (bounds) => ({
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      });
      const axes = [...shadow.querySelectorAll(".recharts-yAxis-tick-labels,.recharts-xAxis-tick-labels")]
        .map((axis) => {
          const svg = axis.closest("svg");
          return {
            orientation: axis.classList.contains("recharts-yAxis-tick-labels") ? "y" : "x",
            svg: svg ? box(svg.getBoundingClientRect()) : null,
            ticks: [...axis.querySelectorAll(".recharts-cartesian-axis-tick-value")]
              .map((tick) => {
                const styles = getComputedStyle(tick);
                const bounds = tick.getBoundingClientRect();
                return {
                  label: tick.textContent.replace(/\s+/gu, " ").trim(),
                  bounds: box(bounds),
                  visible:
                    styles.display !== "none" &&
                    styles.visibility !== "hidden" &&
                    bounds.width > 0 &&
                    bounds.height > 0,
                };
              })
              .filter((tick) => tick.visible),
          };
        })
        .filter(
          (axis) =>
            axis.ticks.length > 1 &&
            axis.ticks.every(({ label }) => /^[+\-−]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)\s*(?:[KMBT]|%)?$/iu.test(label)),
        );
      return {
        host: box(host),
        axes,
        rawAxes: [
          ...shadow.querySelectorAll(
            ".recharts-cartesian-axis,.recharts-yAxis,.recharts-xAxis," +
              ".recharts-yAxis-tick-labels,.recharts-xAxis-tick-labels",
          ),
        ].map((axis) => ({
          className: axis.getAttribute("class"),
          ticks: [...axis.querySelectorAll("text")].map((tick) => ({
            text: tick.textContent.replace(/\s+/gu, " ").trim(),
            className: tick.getAttribute("class"),
            bounds: box(tick.getBoundingClientRect()),
            display: getComputedStyle(tick).display,
            visibility: getComputedStyle(tick).visibility,
          })),
        })),
        svgText: [...shadow.querySelectorAll("svg text")].map((tick) => tick.textContent.replace(/\s+/gu, " ").trim()),
        document: { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      };
    });

    assert.equal(
      observed.axes.length,
      descriptor.axes.length,
      `${descriptor.id}: actual shared Recharts chart must expose every expected numeric axis; ` +
        `raw axis groups=${JSON.stringify(observed.rawAxes)}, all SVG text=${JSON.stringify(observed.svgText)}, ` +
        `browser errors=${JSON.stringify(errors)}`,
    );
    requirePass(
      observed.document.scrollWidth <= observed.document.width + 1,
      `${descriptor.id}: readable numeric labels must not overflow the ${width}px Codex document`,
    );

    for (const [index, expected] of descriptor.axes.entries()) {
      const axis = observed.axes[index];
      assert.equal(
        axis.orientation,
        expected.orientation,
        `${descriptor.id}: expected numeric ${expected.orientation}-axis at index ${index}`,
      );
      requirePass(axis.svg, `${descriptor.id}: numeric ${axis.orientation}-axis must belong to the native chart SVG`);
      requirePass(
        axis.ticks.length >= 3,
        `${descriptor.id}: ${width}px ${axis.orientation}-axis must show at least three readable values`,
      );
      const labels = axis.ticks.map(({ label }) => label);
      assert.equal(
        new Set(labels).size,
        labels.length,
        `${descriptor.id}: ${width}px ${axis.orientation}-axis repeats ambiguous labels ${JSON.stringify(labels)}`,
      );
      const values = labels.map(parseNumericAxisLabel);
      const direction = Math.sign(values[1] - values[0]);
      requirePass(
        direction !== 0 &&
          values.slice(1).every((value, position) => Math.sign(value - values[position]) === direction),
        `${descriptor.id}: ${axis.orientation}-axis labels must describe strictly monotone values ${JSON.stringify(
          labels,
        )}`,
      );

      const visual = [...axis.ticks].sort((left, right) =>
        expected.orientation === "x" ? left.bounds.left - right.bounds.left : left.bounds.top - right.bounds.top,
      );
      for (const [position, tick] of visual.entries()) {
        requirePass(
          tick.bounds.left >= axis.svg.left - 1 &&
            tick.bounds.right <= axis.svg.right + 1 &&
            tick.bounds.top >= axis.svg.top - 1 &&
            tick.bounds.bottom <= axis.svg.bottom + 1,
          `${descriptor.id}: ${width}px ${axis.orientation}-axis tick ${JSON.stringify(
            tick.label,
          )} is clipped by its SVG`,
        );
        if (!position) continue;
        const previous = visual[position - 1].bounds;
        requirePass(
          expected.orientation === "x"
            ? previous.right <= tick.bounds.left + 1
            : previous.bottom <= tick.bounds.top + 1,
          `${descriptor.id}: ${width}px ${axis.orientation}-axis labels overlap: ${JSON.stringify(labels)}`,
        );
      }

      if (expected.semantic === "small-integer") {
        requirePass(
          labels.every((label) => !/[KMBT]/iu.test(label)),
          `${descriptor.id}: nearby values below 10,000 should use grouped integers rather than ambiguous compact labels`,
        );
        requirePass(
          labels.some((label) => /1,0\d\d/u.test(label)),
          `${descriptor.id}: thousand-crossing axis should visibly distinguish values such as 1,000 and 1,020`,
        );
      }
      if (expected.semantic === "large-compact") {
        requirePass(
          labels.some((label) => /[MB]$/iu.test(label)),
          `${descriptor.id}: billion-scale numeric ticks should remain compact and readable`,
        );
      }
      if (expected.semantic === "negative") {
        requirePass(
          values.some((value) => value < 0) && values.every((value) => value <= 0),
          `${descriptor.id}: negative axis ticks must retain their actual sign`,
        );
        requirePass(
          labels.every((label, position) => values[position] === 0 || /^[-−]/u.test(label)),
          `${descriptor.id}: negative numeric labels must visibly include a minus sign`,
        );
      }
      if (expected.semantic === "signed-near-zero") {
        requirePass(
          values.some((value) => value < 0) && values.some((value) => value > 0),
          `${descriptor.id}: closely spaced values around zero must remain visible on both sides`,
        );
        requirePass(
          labels.every((label) => !/^[-−]0(?:\.0+)?$/u.test(label)),
          `${descriptor.id}: tiny negative values must not collapse into negative zero`,
        );
      }
      if (expected.semantic === "precise-percentage") {
        requirePass(
          labels.every((label) => label.endsWith("%") && !label.startsWith("+")),
          `${descriptor.id}: percentage axes must preserve percent units without introducing plus signs`,
        );
        requirePass(
          labels.some((label) => /\.\d{2,}%$/u.test(label)),
          `${descriptor.id}: close conversion rates require additional visible percentage precision`,
        );
      }
    }

    await scenario.verifyClean();
    process.stdout.write(
      `${JSON.stringify({
        test: "readable-native-numeric-axes",
        case: descriptor.id,
        width,
        colorScheme,
        axes: observed.axes.map((axis) => ({
          orientation: axis.orientation,
          labels: axis.ticks.map(({ label }) => label),
        })),
        result: "pass",
      })}\n`,
    );
  } finally {
    await context.close();
  }
}

async function inspectIsolatedGap(browser, fixture, preview, { width, colorScheme }) {
  const scenario = await createScenario(browser, fixture, preview, { width, colorScheme });
  const { context, page, root } = scenario;
  try {
    const dots = root.locator('.recharts-line-dot[data-isolated-point="true"]');
    await dots.first().waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(
      await dots.count(),
      2,
      "Single-measure values [120, null, 145] must render one persistent marker per isolated observation",
    );
    assert.equal(
      await root.locator(".recharts-line-dots circle, .recharts-line-dot").count(),
      2,
      "Null observations must not create a third persistent line marker",
    );

    const geometry = await root.evaluate((element) => {
      const shadow = element.shadowRoot;
      const markers = [...shadow.querySelectorAll('.recharts-line-dot[data-isolated-point="true"]')].map((dot) => ({
        radius: Number(dot.getAttribute("r")),
        cx: Number(dot.getAttribute("cx")),
        cy: Number(dot.getAttribute("cy")),
        fill: getComputedStyle(dot).fill,
        width: dot.getBoundingClientRect().width,
        height: dot.getBoundingClientRect().height,
      }));
      const curves = [...shadow.querySelectorAll(".recharts-line-curve")].map((path) => ({
        path: path.getAttribute("d"),
        length: path.getTotalLength(),
      }));
      return { markers, curves };
    });
    assert.deepEqual(
      geometry.markers.map((marker) => marker.radius),
      [3, 3],
      "Isolated dashboard observations must use canonical three-pixel point markers",
    );
    requirePass(
      geometry.markers.every((marker) => marker.width >= 5 && marker.height >= 5 && marker.fill !== "none"),
      "Isolated observations must be genuinely visible rather than zero-length invisible SVG marks",
    );
    requirePass(
      geometry.markers[0].cx < geometry.markers[1].cx,
      "The two genuine observations must retain their reviewed chronological order",
    );
    requirePass(
      geometry.curves.every((curve) => curve.length < 0.5),
      "Missing observations must not be interpolated or bridged by a positive-length line",
    );

    const firstBox = await dots.first().boundingBox();
    requirePass(firstBox, "The first isolated observation must provide a real pointer target");
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    const tooltip = root.locator(".chart-tooltip");
    await tooltip.waitFor({ state: "visible", timeout: 5_000 });
    const firstTooltip = await tooltip.innerText();
    assert.match(firstTooltip, /120/u);
    assert.match(firstTooltip, /WAU|Weekly active users/iu);
    assert.doesNotMatch(
      firstTooltip,
      /Before Gap|After Gap|Segment|Part\s*\d/u,
      "Canonical isolated-point handling must not invent artificial tooltip series labels",
    );

    const lastBox = await dots.last().boundingBox();
    requirePass(lastBox, "The second isolated observation must provide a real pointer target");
    await page.mouse.move(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2);
    await tooltip.waitFor({ state: "visible", timeout: 5_000 });
    assert.match(await tooltip.innerText(), /145/u);

    await page.mouse.move(
      (firstBox.x + firstBox.width / 2 + lastBox.x + lastBox.width / 2) / 2,
      (firstBox.y + firstBox.height / 2 + lastBox.y + lastBox.height / 2) / 2,
    );
    assert.equal(
      await root.locator(".recharts-active-dot").count(),
      0,
      "The missing reviewed week must not produce an active marker or synthetic zero value",
    );

    const payload = await assertReviewedPayloadUnchanged(root, fixture);
    assert.deepEqual(payload.rows, isolatedGapInput.rows);
    assert.deepEqual(payload.query.source.caveats, isolatedGapInput.source.caveats);

    await scenario.verifyClean();
    process.stdout.write(
      `${JSON.stringify({
        test: "canonical-isolated-missing-week",
        values: [120, null, 145],
        width,
        colorScheme,
        persistentDots: geometry.markers.length,
        pointRadius: 3,
        artificialFields: 0,
        result: "pass",
      })}\n`,
    );
  } finally {
    await context.close();
  }
}

async function inspectLineScenario(browser, fixture, preview, { width, colorScheme }) {
  const scenario = await createScenario(browser, fixture, preview, { width, colorScheme });
  const { context, errors, network, page, root } = scenario;

  try {
    const state = await root.evaluate((element) => {
      const shadow = element.shadowRoot;
      const curves = [...shadow.querySelectorAll(".recharts-line-curve")];
      return {
        shadow: Boolean(shadow),
        rootWidth: element.getBoundingClientRect().width,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        hostTheme: element.getAttribute("data-app-theme"),
        hostRadius: getComputedStyle(element).getPropertyValue("--mark-radius").trim(),
        outerTheme: document.documentElement.getAttribute("data-app-theme"),
        outerRadius: getComputedStyle(document.documentElement).getPropertyValue("--mark-radius").trim(),
        outerChartToken: getComputedStyle(document.documentElement).getPropertyValue("--chart-1").trim(),
        outerApplicationStyles: [...document.querySelectorAll("style")].some((style) =>
          style.textContent.includes(".chart-ranked-list"),
        ),
        innerApplicationStyles: [...shadow.querySelectorAll("style")].some((style) =>
          style.textContent.includes(".chart-ranked-list"),
        ),
        persistentDots: shadow.querySelectorAll(".recharts-line-dots circle, .recharts-line-dot").length,
        areas: shadow.querySelectorAll(".recharts-area-area").length,
        curves: curves.map((curve) => ({
          d: curve.getAttribute("d"),
          stroke: getComputedStyle(curve).stroke,
          width: curve.getAttribute("stroke-width"),
          cap: curve.getAttribute("stroke-linecap"),
          join: curve.getAttribute("stroke-linejoin"),
          length: curve.getTotalLength(),
        })),
      };
    });
    assert.equal(state.shadow, true, "shared dashboard components must remain inside Shadow DOM");
    assert.equal(state.curves.length, 2, "the real dashboard renderer should render both reviewed series");
    for (const curve of state.curves) {
      assert.match(curve.d, /C/u, "native dashboard trend lines should use smooth monotone interpolation");
      assert.equal(curve.width, "2.25", "native dashboard trend lines should retain 2.25px strokes");
      assert.equal(curve.cap, "round");
      assert.equal(curve.join, "round");
      requirePass(curve.length > 0, "native dashboard trend lines should have visible geometry");
    }
    assert.deepEqual(
      state.curves.map(({ stroke }) => stroke),
      colorScheme === "dark" ? ["rgb(102, 181, 255)", "rgb(173, 123, 249)"] : ["rgb(2, 133, 255)", "rgb(146, 79, 247)"],
      "dashboard theme colors must adapt to the actual Codex color scheme",
    );
    assert.equal(state.persistentDots, 0, "normal multi-point lines must not display permanent markers");
    assert.equal(state.areas, 0, "Line charts must not render area fills, even with a legacy showArea setting");
    requirePass(Math.abs(state.rootWidth - width) <= 1, `chart root should fill the ${width}px host`);
    requirePass(state.scrollWidth <= state.clientWidth + 1, "chart must not create host-document horizontal overflow");
    assert.equal(state.hostTheme, "codex-classic");
    assert.equal(state.hostRadius, "8");
    assert.equal(state.outerTheme, null, "embedding must never apply a dashboard theme to the host document");
    assert.equal(state.outerRadius, "97", "host-document sentinel tokens must remain untouched");
    assert.equal(state.outerChartToken, "#ff00aa", "dashboard color tokens must not leak into the host document");
    assert.equal(state.outerApplicationStyles, false, "canonical dashboard CSS must not leak outside Shadow DOM");
    assert.equal(state.innerApplicationStyles, true, "inline rendering must use the actual shared dashboard CSS");

    const graph = root.locator(".recharts-wrapper");
    const graphBox = await graph.boundingBox();
    requirePass(graphBox, "native Recharts wrapper must have a visible pointer target");
    await page.mouse.move(graphBox.x + graphBox.width * 0.58, graphBox.y + graphBox.height * 0.4);
    const tooltip = root.locator(".chart-tooltip");
    await tooltip.waitFor({ state: "visible", timeout: 5_000 });
    assert.match(await tooltip.innerText(), /Pro/u);
    assert.match(await tooltip.innerText(), /Team/u);
    const tooltipStyles = await tooltip.evaluate((element) => ({
      radius: getComputedStyle(element).borderRadius,
      shadow: getComputedStyle(element).boxShadow,
    }));
    assert.equal(tooltipStyles.radius, "12px");
    assert.match(
      tooltipStyles.shadow,
      /4px\s+14px/u,
      "theme-qualified Classic tooltip overrides must survive :root-to-:host scoping",
    );
    requirePass(
      (await root.locator(".recharts-active-dot").count()) > 0,
      "native dashboard hover markers must appear only while hovering",
    );
    await page.mouse.move(1, 1);

    const team = root.getByRole("button", { name: "Toggle Team" });
    await team.click();
    assert.equal(await team.getAttribute("aria-pressed"), "false");
    assert.equal(
      await root.locator(".recharts-line-curve").count(),
      1,
      "real shared dashboard legends must toggle native series",
    );
    await team.click();
    assert.equal(await root.locator(".recharts-line-curve").count(), 2);

    await readReviewedSource(root, fixture);

    await scenario.verifyClean();
    process.stdout.write(
      `${JSON.stringify({
        test: "shared-inline-dashboard",
        width,
        colorScheme,
        series: state.curves.length,
        reviewedRows: reviewedInput.rows.length,
        result: "pass",
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ width, colorScheme, errors, network })}\n`);
    throw error;
  } finally {
    await context.close();
  }
}

async function inspectSqlOptIn(browser, fixture, preview) {
  const scenario = await createScenario(browser, fixture, preview);
  const { context, root } = scenario;
  try {
    const { query } = await readReviewedSource(root, fixture);
    assert.equal(query.source.sql, rawSql, "The reviewed statement remains exact in the payload");
    assert.ok(query.source.links.some(({ href }) => href === privateSourceUrl),
      "Explicitly approved source links remain in reviewed metadata");
    await scenario.verifyClean();
    process.stdout.write(`${JSON.stringify({ test: "explicit-sql-and-source-urls", result: "pass" })}\n`);
  } finally {
    await context.close();
  }
}

async function inspectThemeRadius(browser, fixture, preview, { theme, radius, stroke, scheme }) {
  const scenario = await createScenario(browser, fixture, preview, { width: 360, colorScheme: "light" });
  const { context, root } = scenario;
  try {
    const cell = root.locator(".chart-heatmap-cell").first();
    await cell.waitFor({ state: "visible", timeout: 10_000 });
    const actual = await root.evaluate((element) => ({
      theme: element.getAttribute("data-app-theme"),
      radius: getComputedStyle(element).getPropertyValue("--mark-radius").trim(),
      scheme: getComputedStyle(element).colorScheme,
      mark: element.shadowRoot.querySelector(".chart-heatmap-cell")?.getAttribute("rx"),
      chartToken: getComputedStyle(element).getPropertyValue("--chart-1").trim(),
      outerRadius: getComputedStyle(document.documentElement).getPropertyValue("--mark-radius").trim(),
      outerTheme: document.documentElement.getAttribute("data-app-theme"),
    }));
    assert.equal(actual.theme, theme);
    assert.equal(actual.radius, String(radius));
    assert.equal(
      actual.mark,
      String(radius),
      "actual shared ChartRenderer must read mark geometry from its embedded theme root",
    );
    assert.equal(actual.chartToken, stroke);
    assert.equal(actual.outerRadius, "97", "non-default inline themes must not mutate global dashboard tokens");
    assert.equal(actual.outerTheme, null);
    if (scheme)
      assert.equal(actual.scheme, scheme, "fixed-scheme Data themes must remain dark even in a light Codex document");
    await scenario.verifyClean();
    process.stdout.write(`${JSON.stringify({ test: "embedded-dashboard-theme", theme, radius, result: "pass" })}\n`);
  } finally {
    await context.close();
  }
}

async function multiReferencePreview(
  fixtures,
  previews,
  width,
  { name = "separate-codex-inline-references", frameHeight = 650 } = {},
) {
  const frames = await Promise.all(
    fixtures.map(async (fixture, index) => {
      const standalone = await readFile(previews.get(fixture.name), "utf8");
      const embedded = standalone.match(/<iframe\b[^>]*\bdata-srcdoc="([^"]+)"/u);
      requirePass(
        embedded,
        "Each visualization reference must retain the exact real Codex-generated restricted sandbox document",
      );
      // This fixture embeds frames without the standalone shell that fills in initial state.
      const srcdoc = embedded[1].replace("__CODEX_VISUALIZATION_WIDGET_STATE__", "{}");
      return (
        `<iframe id="codex-inline-reference-${index}" sandbox="allow-scripts" scrolling="no" ` +
        `referrerpolicy="no-referrer" title="${fixture.name}" srcdoc="${srcdoc}"></iframe>`
      );
    }),
  );
  const path = join(workspace, `${name}-${width}.html`);
  await writeFile(
    path,
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<style>:root{color-scheme:light dark}html,body{margin:0}body{box-sizing:border-box;padding:16px}` +
      `iframe{display:block;width:100%;max-width:${width}px;height:${frameHeight}px;margin:0 auto 16px;border:0}</style>` +
      `</head><body>${frames.join("")}</body></html>`,
  );
  return path;
}

async function inspectSeparateReferenceIsolation(browser, line, isolated, previews, { width, colorScheme }) {
  const preview = await multiReferencePreview([line, isolated], previews, width);
  const scenario = await createPageScenario(browser, preview, { width, colorScheme, height: 1500 });
  const { context, page } = scenario;
  try {
    const frames = page.locator("iframe");
    assert.equal(
      await frames.count(),
      2,
      "Multiple visualization references must create separate actual restricted host iframes",
    );
    assert.deepEqual(
      await frames.evaluateAll((elements) => elements.map((element) => element.getAttribute("sandbox"))),
      ["allow-scripts", "allow-scripts"],
      "Every separate visualization must preserve its restricted sandbox",
    );

    const firstFrame = page.frameLocator("iframe").nth(0);
    const secondFrame = page.frameLocator("iframe").nth(1);
    const first = firstFrame.locator(line.root);
    const second = secondFrame.locator(isolated.root);
    await first.locator(".recharts-line-curve").first().waitFor({ state: "visible", timeout: 20_000 });
    await second
      .locator('.recharts-line-dot[data-isolated-point="true"]')
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await first.locator(".data-inline-react-root").count(), 1);
    assert.equal(await second.locator(".data-inline-react-root").count(), 1);
    assert.equal(await first.locator(".recharts-line-curve").count(), 2);
    assert.equal(await second.locator('.recharts-line-dot[data-isolated-point="true"]').count(), 2);

    const team = first.getByRole("button", { name: "Toggle Team" });
    await team.click();
    assert.equal(await team.getAttribute("aria-pressed"), "false");
    assert.equal(await first.locator(".recharts-line-curve").count(), 1);
    assert.equal(
      await second.locator('.recharts-line-dot[data-isolated-point="true"]').count(),
      2,
      "Toggling one chart's legend must not mutate an independent chart's native marks",
    );
    await team.click();
    assert.equal(await first.locator(".recharts-line-curve").count(), 2);

    await assertNoInlineSources(first);
    await assertNoInlineSources(second);
    await assertReviewedPayloadUnchanged(first, line);
    await assertReviewedPayloadUnchanged(second, isolated);
    await scenario.verifyClean();
    process.stdout.write(
      `${JSON.stringify({
        test: "separate-actual-codex-reference-isolation",
        frames: 2,
        width,
        colorScheme,
        first: reviewedInput.title,
        second: isolatedGapInput.title,
        result: "pass",
      })}\n`,
    );
  } finally {
    await context.close();
  }
}

async function inspectSeparateEditorIsolation(browser, fixture, previews, { width, colorScheme }) {
  // Repeating the same fragment deliberately reuses both component and root IDs.
  // Session presentation state must still belong to each actual restricted frame.
  const preview = await multiReferencePreview([fixture, fixture], previews, width, {
    name: "separate-codex-inline-editors",
    frameHeight: 1000,
  });
  const scenario = await createPageScenario(browser, preview, { width, colorScheme, height: 2200 });
  const { context, page } = scenario;
  try {
    const frames = page.locator("iframe");
    assert.equal(await frames.count(), 2);
    assert.deepEqual(
      await frames.evaluateAll((elements) => elements.map((element) => element.getAttribute("sandbox"))),
      ["allow-scripts", "allow-scripts"],
      "Each independently editable reference must keep the real restricted sandbox",
    );
    const first = page.frameLocator("iframe").nth(0).locator(fixture.root);
    const second = page.frameLocator("iframe").nth(1).locator(fixture.root);
    await first.locator(".recharts-line-curve").nth(1).waitFor({ state: "visible", timeout: 20_000 });
    await second.locator(".recharts-line-curve").nth(1).waitFor({ state: "visible", timeout: 20_000 });
    const firstBaseline = await readCollapsedPresentation(first);
    const secondBaseline = await readCollapsedPresentation(second);
    assert.equal(firstBaseline.componentId, secondBaseline.componentId);
    assert.equal(await first.getAttribute("id"), await second.getAttribute("id"));

    const firstOpen = await openChartEditor(first);
    await firstOpen.editor.getByRole("textbox", { name: "Chart title", exact: true }).fill("First reference draft");
    const secondOpen = await openChartEditor(second);
    const secondTitle = secondOpen.editor.getByRole("textbox", { name: "Chart title", exact: true });
    await secondTitle.fill("Second reference applied");
    await secondTitle.focus();
    await page.keyboard.press(`${keyboardModifier}+z`);
    assert.equal(await secondTitle.inputValue(), secondBaseline.title);
    await page.keyboard.press(`${keyboardModifier}+Shift+z`);
    assert.equal(await secondTitle.inputValue(), "Second reference applied");
    assert.equal(
      await firstOpen.editor.getByRole("textbox", { name: "Chart title", exact: true }).inputValue(),
      "First reference draft",
      "Undo/redo in a reused-ID reference must not touch another frame's draft history",
    );
    await dismissChartEditor(second, secondOpen.editor, "Apply");
    const secondApplied = await readCollapsedPresentation(second);
    assert.equal(secondApplied.title, "Second reference applied");
    requirePass(
      await firstOpen.editor.isVisible(),
      "Applying one editor must not close another restricted frame's editor",
    );
    assert.deepEqual(await readCollapsedPresentation(first), firstBaseline);

    await firstOpen.editor.getByRole("textbox", { name: "Chart title", exact: true }).focus();
    await page.keyboard.press("Escape");
    await assertChartEditorClosed(first, firstOpen.editor, "Escape");
    assert.deepEqual(await readCollapsedPresentation(first), firstBaseline);
    assert.deepEqual(await readCollapsedPresentation(second), secondApplied);

    let { editor } = await openChartEditor(first);
    await selectEditorChoice(first, editor, "Chart type", "Bar");
    await dismissChartEditor(first, editor, "Apply");
    await first.locator(".data-inline-chart-content .recharts-bar-rectangle").first().waitFor({ state: "visible" });
    assert.deepEqual(
      await readCollapsedPresentation(second),
      secondApplied,
      "Applying a chart-type change must not update a sibling reference with the same component ID",
    );
    await remountInlineChart(first, fixture);
    assert.deepEqual(await readCollapsedPresentation(first), firstBaseline);
    assert.deepEqual(await readCollapsedPresentation(second), secondApplied, "Remount must reset only its own frame");

    ({ editor } = await openChartEditor(second));
    await editor.getByRole("button", { name: "Reset", exact: true }).click();
    await dismissChartEditor(second, editor, "Apply");
    assert.deepEqual(await readCollapsedPresentation(second), secondBaseline);
    await assertReviewedPayloadUnchanged(first, fixture);
    await assertReviewedPayloadUnchanged(second, fixture);
    await scenario.verifyClean();
    process.stdout.write(
      `${JSON.stringify({
        test: "separate-actual-codex-editor-isolation",
        frames: 2,
        reusedComponentId: firstBaseline.componentId,
        width,
        colorScheme,
        result: "pass",
      })}\n`,
    );
  } finally {
    await context.close();
  }
}

async function inspectCapacityScenario(browser, fixture, preview, rowCount) {
  const scenario = await createScenario(browser, fixture, preview, {
    width: rowCount === 200 ? 360 : 736,
    colorScheme: "light",
  });
  const { context, root } = scenario;
  try {
    assert.equal(await root.locator(".recharts-line-curve").count(), 2);
    const payload = await assertReviewedPayloadUnchanged(root, fixture);
    assert.equal(payload.rows.length, rowCount);
    const icons = await root.locator("[data-dashboard-icon]").evaluateAll((elements) => elements.map((element) => ({
      name: element.dataset.dashboardIcon,
      mask: getComputedStyle(element).getPropertyValue("--dashboard-icon-mask"),
    })));
    requirePass(icons.length > 0, "Hydrated chart controls must retain their shared icons");
    for (const icon of icons) {
      assert.ok(INLINE_ICON_NAMES.includes(icon.name), `Unexpected inline icon: ${icon.name}`);
      assert.match(icon.mask, /data:image\/svg\+xml/u, `${icon.name} must retain its bundled SVG`);
    }
    await scenario.verifyClean();
    process.stdout.write(`${JSON.stringify({ test: "complete-fragment-capacity", rowCount,
      bytes: Buffer.byteLength(fixture.fragment), result: "pass" })}\n`);
  } finally {
    await context.close();
  }
}

const { receiptFixture, inspectSourcesReceipt, inspectShortOverview } = createInlineSourcesBrowserCases({
  pluginRoot, workspace, createPageScenario, tabLabels, generatedPayload,
});

const {
  renderFixtures: renderColorEditorFixtures,
  inspectEditor: inspectColorEditor,
  inspectAuthoredIdentity: inspectAuthoredColorIdentity,
} = createInlineColorBrowserCases({
  pluginRoot,
  workspace,
  isolatedGapInput,
  requirePass,
  renderFixture,
  createScenario,
  generatedPayload,
  readCollapsedPresentation,
  readReviewedSource,
  assertReviewedPayloadUnchanged,
  openChartEditor,
  dismissChartEditor,
  assertContainedPortal,
});

let browser;
try {
  const focusedCase = process.env.DATA_INLINE_BROWSER_CASE;
  const focusedReceiptCase = focusedCase === "sources";
  const focusedWorkCase = focusedCase === "work";
  const focusedEditorCase = focusedCase === "editing";
  const focusedHistogramCase = focusedCase === "histogram";
  const focusedMetadataCase = focusedCase === "metadata";
  const focusedColorCase = focusedCase === "colors";
  const focusedAxisCase =
    focusedReceiptCase || focusedWorkCase || focusedEditorCase || focusedHistogramCase || focusedMetadataCase || focusedColorCase ? undefined : focusedCase;
  const runEditorCases = !focusedCase || focusedEditorCase;
  const runHistogramCases = runEditorCases || focusedHistogramCase;
  const runMetadataCases = runEditorCases || focusedMetadataCase;
  const runColorCases = runEditorCases || focusedColorCase;
  const selectedAxisCases =
    focusedReceiptCase || focusedWorkCase || focusedEditorCase || focusedHistogramCase || focusedMetadataCase || focusedColorCase
      ? []
      : focusedAxisCase
        ? numericAxisCases.filter(({ id }) => id === focusedAxisCase)
        : numericAxisCases;
  requirePass(
    !focusedCase ||
      focusedReceiptCase ||
      focusedWorkCase ||
      focusedEditorCase ||
      focusedHistogramCase ||
      focusedMetadataCase ||
      focusedColorCase ||
      selectedAxisCases.length === 1,
    `Unknown focused inline-chart browser case: ${JSON.stringify(focusedCase)}`,
  );
  const line = await renderFixture("reviewed-inline-chart", reviewedInput, ["--omit-sql"]);
  const artifactName = inlineArtifactForChart(reviewedInput.chart.type);
  const preparedRuntime = await prepareInlineRuntime({
    pluginRoot,
    cacheDir: cacheRoot,
    offline: true,
    artifactName,
  });
  assert.equal(preparedRuntime.metadata.key, line.metadata.runtimeKey);
  assert.equal(preparedRuntime.prebuilt, true);
  assert.equal(preparedRuntime.cacheDir, null);
  assert.equal(preparedRuntime.metadata.source, "prebuilt");
  requirePass(
    typeof preparedRuntime.path === "string" && isAbsolute(preparedRuntime.path),
    "browser regressions must use the verified artifact shipped in the plugin",
  );
  assert.equal(
    await realpath(preparedRuntime.path),
    await realpath(join(pluginRoot, `assets/data-app-runtime/${artifactName}.js`)),
  );
  resources = new Map([
    [
      "https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js",
      join(dirname(dependencyRequire.resolve("@floating-ui/core/package.json")), "dist/floating-ui.core.umd.min.js"),
    ],
    [
      "https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js",
      join(dirname(dependencyRequire.resolve("@floating-ui/dom/package.json")), "dist/floating-ui.dom.umd.min.js"),
    ],
  ]);
  assert.equal(line.metadata.includedSql, false);
  assert.equal(line.metadata.includedSourceUrls, false);
  assert.equal(line.metadata.rowCount, reviewedInput.rows.length);
  assert.doesNotMatch(
    line.fragment,
    /restricted\.raw_metric_input/u,
    "explicitly omitted SQL and SQL-derived evidence must not enter generated fragments",
  );
  assert.doesNotMatch(
    line.fragment,
    /reviewed-source\.example\.test/u,
    "source URLs must not be embedded without explicit authorization",
  );
  assert.doesNotMatch(
    line.fragment,
    /NEVER_EMBED_UNREVIEWED_PRIVATE_COLUMN|unapprovedColumn|UNAPPROVED_ANNOTATION_LABEL/u,
    "unresolved annotation references must not disclose unapproved columns or labels",
  );
  assert.doesNotMatch(
    line.fragment,
    /NEVER_EMBED_UNREVIEWED_PRIVATE_DEFINITION/u,
    "definitions for unapproved private row fields must never enter the generated fragment",
  );
  assert.deepEqual(
    generatedPayload(line).query.source.metricDefinitions.map(({ field }) => field),
    ["activeUsers", "week", "plan"],
    "reviewed sources should retain displayed measure, temporal axis, and series attribution definitions only",
  );

  const explicitSql = await renderFixture("reviewed-inline-chart-with-sql", reviewedInput, [
    "--include-sql",
    "--include-source-urls",
  ]);
  assert.equal(explicitSql.metadata.includedSql, true);
  assert.equal(explicitSql.metadata.includedSourceUrls, true);
  assert.match(explicitSql.fragment, /restricted\.raw_metric_input/u);
  assert.match(explicitSql.fragment, /reviewed-source\.example\.test/u);

  const isolated = await renderFixture("reviewed-isolated-missing-week", isolatedGapInput);
  const isolatedPayload = generatedPayload(isolated);
  assert.equal(isolatedPayload.component.chart.y, "wau");
  assert.equal(
    isolatedPayload.component.chart.fields,
    undefined,
    "A missing week must not invent before-gap/after-gap series fields",
  );
  assert.deepEqual(
    isolatedPayload.rows,
    isolatedGapInput.rows,
    "Single-measure payloads must preserve reviewed dates, both values, and explicit missingness exactly",
  );
  assert.deepEqual(
    Object.keys(isolatedPayload.rows[0]),
    ["week", "wau"],
    "Single-measure payloads must not inject synthetic source-preview columns",
  );
  assert.equal(
    isolatedPayload.generatedAt,
    undefined,
    "User-provided examples without recorded freshness must not invent a render-time timestamp",
  );
  assert.equal(
    isolatedPayload.query.source.executedAt,
    undefined,
    "User-provided examples without recorded source execution must not invent source freshness",
  );
  assert.deepEqual(
    isolatedPayload.query.source.caveats,
    isolatedGapInput.source.caveats,
    "Missing-value and illustrative-data caveats must survive canonical source normalization verbatim",
  );

  const editing = runEditorCases || focusedWorkCase ? await renderFixture("reviewed-inline-editor", editableInput, ["--omit-sql"]) : null;
  const editingBar = runEditorCases ? await renderFixture("reviewed-inline-bar-editor", {
    ...editableInput, chart: { ...editableInput.chart, type: "bar" },
  }, ["--omit-sql"]) : null;
  const metadataEditor = runMetadataCases
    ? await renderFixture("reviewed-inline-metadata-editor", metadataEditorInput)
    : null;
  const histogramEditor = runHistogramCases
    ? await renderFixture("reviewed-inline-histogram-editor", histogramEditorInput)
    : null;
  const ratioHistogram = runHistogramCases
    ? await renderFixture("reviewed-inline-ratio-histogram-editor", ratioHistogramInput)
    : null;
  const colorFixtures = runColorCases ? await renderColorEditorFixtures() : [];
  if (editing) {
    assert.deepEqual(Object.keys(generatedPayload(editing).rows[0]), ["week", "plan", "activeUsers", "baseline"]);
    assert.doesNotMatch(editing.fragment, /NEVER_EMBED_UNREVIEWED_PRIVATE_(?:COLUMN|DEFINITION)/u);
    assert.doesNotMatch(editing.fragment, /restricted\.raw_metric_input|reviewed-source\.example\.test/u);
  }
  if (histogramEditor) {
    assert.equal(generatedPayload(histogramEditor).component.chart.x, undefined);
    assert.deepEqual(Object.keys(generatedPayload(histogramEditor).rows[0]), ["latencyMs"]);
    assert.equal(generatedPayload(ratioHistogram).component.chart.x, undefined);
    assert.deepEqual(Object.keys(generatedPayload(ratioHistogram).rows[0]), ["conversionRate"]);
  }

  const heatmap = (theme) => ({
    ...reviewedInput,
    id: `reviewed-heatmap-${theme}`,
    title: `Reviewed ${theme} heatmap`,
    chart: { type: "heatmap", x: "week", y: "activeUsers", series: "plan" },
    theme,
  });
  const classic = await renderFixture("reviewed-classic-heatmap", heatmap("codex-classic"));
  const scientific = await renderFixture("reviewed-scientific-heatmap", heatmap("scientific-blue"));
  const darkPixel = await renderFixture("reviewed-dark-pixel-heatmap", heatmap("dark-pixel"));
  const axisFixtures = await Promise.all(
    selectedAxisCases.map(async (descriptor) => ({
      descriptor,
      fixture: await renderFixture(`reviewed-readable-axis-${descriptor.id}`, descriptor.input),
    })),
  );
  const capacityFixtures = focusedCase ? [] : await Promise.all([100, 200].map(async (rowCount) => ({
    rowCount,
    fixture: await renderFixture(`reviewed-capacity-${rowCount}`, inlineCapacityInput(rowCount)),
  })));
  for (const { fixture, rowCount } of capacityFixtures) {
    assert.equal(generatedPayload(fixture).rows.length, rowCount);
    assert.equal(generatedPayload(fixture).query.rows, undefined, "The bootstrap restores shared reviewed rows");
    assert.ok(Buffer.byteLength(fixture.fragment) <= 1_000_000);
  }

  const host = await buildActualVisualizationHost();
  const receiptFixtures = focusedCase && !focusedReceiptCase ? [] : [await receiptFixture("single-sources"), await receiptFixture("multiple-sources", { multiple: true })];
  const fixtures = [
    line,
    explicitSql,
    isolated,
    classic,
    scientific,
    darkPixel,
    ...[editing, editingBar].filter(Boolean),
    ...(metadataEditor ? [metadataEditor] : []),
    ...(histogramEditor ? [histogramEditor, ratioHistogram] : []),
    ...colorFixtures.flatMap(({ fixture, authored }) => [fixture, authored]),
    ...axisFixtures.map(({ fixture }) => fixture),
    ...capacityFixtures.map(({ fixture }) => fixture),
    ...receiptFixtures,
  ];
  const previews = new Map(
    await Promise.all(fixtures.map(async (fixture) => [fixture.name, await standalonePreview(fixture, host)])),
  );

  browser = await chromium.launch({ executablePath, headless: true });
  if (!focusedCase || focusedWorkCase) {
    const workPreview = await createWorkModePreview({ monorepoRoot, workspace, dependencyRequire });
    for (const options of [{ width: 736, colorScheme: "light" }, { width: 360, colorScheme: "dark" }]) {
      await inspectEditorLifecycle(browser, editing, await workPreview(editing, options), options);
    }
  }
  for (const [index, fixture] of receiptFixtures.entries()) {
    for (const [width, colorScheme, reducedMotion] of [[736, "light", "no-preference"], [360, "dark", "no-preference"], [320, "light", "no-preference"], [360, "dark", "reduce"]])
      await inspectSourcesReceipt(browser, fixture, previews.get(fixture.name), { multiple: index > 0, width, colorScheme, reducedMotion });
  }
  if (!focusedCase || focusedReceiptCase) {
    const shortOverview = await receiptFixture("short-overview-sources", { shortOverview: true });
    await inspectShortOverview(browser, shortOverview, await standalonePreview(shortOverview, host));
  }
  for (const { fixture, rowCount } of capacityFixtures) {
    await inspectCapacityScenario(browser, fixture, previews.get(fixture.name), rowCount);
  }
  if (!focusedCase) {
    for (const width of [736, 360, 320]) {
      for (const colorScheme of ["light", "dark"]) {
        await inspectLineScenario(browser, line, previews.get(line.name), { width, colorScheme });
      }
    }
  }
  for (const { descriptor, fixture } of axisFixtures) {
    await inspectReadableAxes(browser, fixture, previews.get(fixture.name), descriptor, {
      width: 736,
      colorScheme: "light",
    });
    await inspectReadableAxes(browser, fixture, previews.get(fixture.name), descriptor, {
      width: 360,
      colorScheme: "dark",
    });
  }
  if (!focusedCase) {
    await inspectIsolatedGap(browser, isolated, previews.get(isolated.name), { width: 736, colorScheme: "light" });
    await inspectIsolatedGap(browser, isolated, previews.get(isolated.name), { width: 360, colorScheme: "dark" });
    await inspectSeparateReferenceIsolation(browser, line, isolated, previews, { width: 736, colorScheme: "light" });
    await inspectSeparateReferenceIsolation(browser, line, isolated, previews, { width: 360, colorScheme: "dark" });
    await inspectSqlOptIn(browser, explicitSql, previews.get(explicitSql.name));
    await inspectThemeRadius(browser, classic, previews.get(classic.name), {
      theme: "codex-classic",
      radius: 8,
      stroke: "light-dark(#0285ff, #66b5ff)",
    });
    await inspectThemeRadius(browser, scientific, previews.get(scientific.name), {
      theme: "scientific-blue",
      radius: 2,
      stroke: "#1769e0",
    });
    await inspectThemeRadius(browser, darkPixel, previews.get(darkPixel.name), {
      theme: "dark-pixel",
      radius: 0,
      stroke: "#b6ff3b",
      scheme: "dark",
    });
  }
  if (runEditorCases) {
    await inspectCartesianTypeEditing(browser, editingBar, previews.get(editingBar.name));
    for (const options of [
      { width: 736, colorScheme: "light" },
      { width: 360, colorScheme: "light" },
      { width: 360, colorScheme: "dark" },
    ]) {
      await inspectEditorLifecycle(browser, editing, previews.get(editing.name), options);
    }
  }
  if (runHistogramCases) {
    await inspectSpecializedEditor(browser, histogramEditor, previews.get(histogramEditor.name));
    await inspectRatioHistogramTooltip(browser, ratioHistogram, previews.get(ratioHistogram.name));
  }
  if (runMetadataCases) {
    for (const colorScheme of ["light", "dark"]) {
      await inspectMetadataEditor(browser, metadataEditor, previews.get(metadataEditor.name), { colorScheme });
    }
  }
  for (const { descriptor, fixture, authored } of colorFixtures) {
    for (const colorScheme of ["light", "dark"]) {
      const options = { theme: descriptor.theme, colorScheme, themeOneHex: descriptor.colors[colorScheme] };
      await inspectColorEditor(browser, fixture, previews.get(fixture.name), options);
      await inspectAuthoredColorIdentity(browser, authored, previews.get(authored.name), options);
    }
  }
  if (runEditorCases) {
    await inspectEditedSqlOptIn(browser, explicitSql, previews.get(explicitSql.name));
    for (const options of [
      { width: 736, colorScheme: "light" },
      { width: 360, colorScheme: "dark" },
    ]) {
      await inspectEditedNullGap(browser, isolated, previews.get(isolated.name), options);
      await inspectSeparateEditorIsolation(browser, editing, previews, options);
    }
  }
  process.stdout.write(
    focusedWorkCase
      ? "PASS: shared chart editing without duplicate source UI through the production Work Mode embedding and web app-block document.\n"
      : focusedReceiptCase
      ? "PASS: Sources receipts in the actual Codex sandbox at desktop and narrow widths.\n"
      : focusedColorCase
      ? "PASS: actual-Codex semantic and explicit color identities, theme-aware swatches, unclipped labels, exact palette selection, and immutable apply/cancel/reset.\n"
      : focusedMetadataCase
        ? "PASS: actual-Codex long chart metadata, theme-styled full-width controls, unclipped live resizing, readable headers, and exact apply/cancel/reset.\n"
        : focusedHistogramCase
          ? "PASS: actual-Codex histogram editing, effective axis titles, immutable raw observations and bins, fixed count axes, and plain count tooltips.\n"
          : focusedEditorCase
            ? "PASS: contained shared chart editing, session-only apply/cancel/reset, reviewed-data privacy, and separate actual-Codex sandbox isolation.\n"
            : focusedAxisCase
              ? `PASS: focused ${focusedAxisCase} numeric-axis browser regression at desktop and narrow widths.\n`
              : "PASS: production shared dashboard charts, actual Codex sandbox insertion, legacy String.replace compatibility, six adaptive widths/themes, readable responsive native numeric axes, canonical isolated missing-week observations, separate-reference sandbox isolation, final-answer Sources receipts and inline chart editing without duplicate source UI, session-only apply/cancel/reset, reviewed-data/SQL privacy, and theme-owned mark geometry.\n",
  );
} finally {
  if (browser) await browser.close();
  await rm(workspace, { recursive: true, force: true });
}
