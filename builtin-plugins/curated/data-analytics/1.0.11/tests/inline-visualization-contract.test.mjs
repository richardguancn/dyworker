import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const index = read("../skills/index/SKILL.md");
const visualization = read("../skills/visualize-data/SKILL.md");
const visualizationMetadata = read("../skills/visualize-data/agents/openai.yaml");
const nativeVisualization = read("../skills/visualize-data/references/native-inline-visualizations.md");
const rendererReference = read("../skills/visualize-data/references/inline-chart-renderer.md");
const receiptReference = read("../skills/visualize-data/references/inline-sources-receipt.md");
const rendererCli = read("../skills/visualize-data/scripts/render-inline-chart.mjs");
const rendererBuild = read("../skills/visualize-data/scripts/inline-chart-build.mjs");
const rendererTheme = read("../skills/visualize-data/scripts/inline-chart-theme.mjs");
const cssSyntax = read("../scripts/css-syntax.mjs");
const releaseBuild = read("../scripts/prebuilt/build.mjs");
const rendererInput = read("../skills/visualize-data/scripts/inline-chart-input.mjs");
const inlineAdapter = read("../templates/data-app/inline/index.jsx");
const inlineStyles = read("../templates/data-app/inline/inline.css");
const inlineFragment = read("../skills/visualize-data/assets/inline-chart-fragment.html");
const inlineExample = JSON.parse(read("../skills/visualize-data/assets/inline-chart-example.json"));
const publicDataApp = read("../templates/data-app/base/src/data-app-public.jsx");
const sharedChartEditor = read("../templates/data-app/base/src/components/ChartEditor.jsx");
const chartExplorer = read("../templates/data-app/base/src/components/ChartExplorer.jsx");
const containedUi = read("../templates/data-app/base/src/components/contained-ui.jsx");
const chartRenderer = read("../templates/data-app/base/src/charting/ChartRenderer.jsx");
const chartTransforms = read("../templates/data-app/base/src/charting/chart-transforms.js");

function paragraphStartingWith(document, prefix) {
  const paragraph = document.split(/\n\s*\n/u).find((candidate) => candidate.startsWith(prefix));

  assert.ok(paragraph, `Missing routing paragraph starting with: ${prefix}`);
  return paragraph;
}

function section(document, heading, nextHeading) {
  const start = document.indexOf(heading);
  const end = document.indexOf(nextHeading, start + heading.length);

  assert.ok(start >= 0, `Missing section: ${heading}`);
  assert.ok(end > start, `Missing section boundary after ${heading}: ${nextHeading}`);
  return document.slice(start, end);
}

function inlineRouting() {
  return section(index, "### Inline Data Chart Delivery", "## Eligibility gate (read before routing)");
}

function responseMode() {
  return section(index, "## Response Mode", "### Inline Data Chart Delivery");
}

function sourceExecutionGate() {
  return section(index, "## Source Execution Gate", "## Response Mode");
}

test("the Data index owns response selection before its direct inline-delivery handoff", () => {
  const chatStop = index.indexOf("## ChatGPT web Chat mode stop gate (read first)");
  const sourceGate = index.indexOf("## Source Execution Gate");
  const responseStart = index.indexOf("## Response Mode");
  const inlineStart = index.indexOf("### Inline Data Chart Delivery");
  const eligibility = index.indexOf("## Eligibility gate (read before routing)");

  assert.equal(index.indexOf("## "), chatStop, "The existing Chat-mode stop gate must remain first");
  assert.ok(sourceGate > chatStop, "The source execution gate cannot bypass the Chat-mode stop gate");
  assert.ok(
    responseStart > sourceGate,
    "Source execution rules must appear before response routing and helper selection",
  );
  assert.ok(inlineStart > responseStart, "Choose the response mode before the inline renderer");
  assert.ok(eligibility > inlineStart, "Inline delivery guidance must precede general routing");
  assert.equal(index.match(/^## Source Execution Gate$/gmu)?.length, 1, "Keep one canonical source execution gate");
  assert.doesNotMatch(index, /## Standalone chart delivery gate/iu);
  assert.doesNotMatch(visualization, /## Mandatory Inline Chart Gate/iu);
});

test("focused skills preserve the selected mode and own only durable visualizations", () => {
  assert.match(responseMode(), /Focused analysis skills must not change the selected response mode\./u);
  assert.match(
    visualization,
    /^description: "[^"\n]*quantitative charts and figures[^"\n]*reports, dashboards, notebooks, and other durable artifacts\. Do not use for inline chat charts\."$/mu,
  );
  assert.match(visualization, /Inline Codex answers are not owned by this skill\./u);
  assert.match(visualization, /shared React\/Recharts inline renderer[^.]*`visualize:visualize`/u);
  assert.doesNotMatch(visualization, /inline-chart-design-language\.md/iu);
});

test("visualization frontmatter and discovery metadata advertise only durable chart surfaces", () => {
  const frontmatter = visualization.match(/^---\n([\s\S]*?)\n---/u)?.[1];

  assert.ok(frontmatter, "The visualization skill must have routing-visible frontmatter");
  assert.match(frontmatter, /reports, dashboards, notebooks, and other durable artifacts/iu);
  assert.match(frontmatter, /Do not use for inline chat charts\./u);
  assert.match(visualizationMetadata, /short_description:\s*"Design charts for reports, dashboards, and notebooks"/u);
  assert.match(visualizationMetadata, /default_prompt:\s*"Design or QA charts for a report, dashboard, or notebook/iu);
  assert.doesNotMatch(visualizationMetadata, /charts for analytical work/iu);
  assert.match(inlineRouting(), /Do not load `\$visualize-data` for this inline handoff/iu);
});

test("the index invokes Visualize directly without loading the durable visualization skill", () => {
  const guidance = inlineRouting();
  const desktopHandoff = paragraphStartingWith(guidance, "On Codex Desktop or in Work Mode,");

  assert.match(desktopHandoff, /read and follow the installed Visualize skill[^.]*directly and in full/iu);
  assert.match(desktopHandoff, /Do not load .\$visualize-data. for this inline handoff/iu);
  assert.match(
    desktopHandoff,
    /that focused skill owns charts for reports, dashboards, notebooks, and other durable artifacts/iu,
  );
  assert.match(guidance, /actual Visualize content reference[^.]*same final response/iu);
  assert.doesNotMatch(desktopHandoff, /genui|<iframe\b/iu);
});

test("the desktop index links the executable shared-renderer instructions directly", () => {
  const guidance = inlineRouting();
  const desktopHandoff = paragraphStartingWith(guidance, "On Codex Desktop or in Work Mode,");
  const indexUrl = new URL("../skills/index/SKILL.md", import.meta.url);
  const rendererPath = desktopHandoff.match(/\[inline-chart-renderer\.md\]\(([^)]+)\)/u)?.[1];

  assert.ok(rendererPath, "The index must route directly to the executable inline renderer");
  assert.equal(readFileSync(new URL(rendererPath, indexUrl), "utf8"), rendererReference);
  assert.match(
    desktopHandoff,
    /Run `"<codex-node>" "<data-plugin-root>\/skills\/visualize-data\/scripts\/render-inline-chart\.mjs" --input\b[^`]*--output\b[^`]*`/u,
    "The renderer must use the resolved Codex Node and installed plugin paths",
  );
  assert.match(guidance, /ChartRenderer/u);
  assert.match(guidance, /React\/Recharts/iu);
  assert.doesNotMatch(guidance, /inline-chart-design-language\.md/u);
  assert.doesNotMatch(rendererReference, /inline-chart-design-language\.md/u);
  assert.equal(
    existsSync(new URL("../skills/visualize-data/references/inline-chart-design-language.md", import.meta.url)),
    false,
    "Remove the obsolete hand-built D3/CSS bridge rather than maintaining two rendering paths",
  );
});

test("the inline renderer reference links the real executable, public API, adapter, and assets", () => {
  const referenceUrl = new URL("../skills/visualize-data/references/inline-chart-renderer.md", import.meta.url);
  const links = new Set(Array.from(rendererReference.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/gu), ([, target]) => target));

  for (const relativePath of [
    "../scripts/render-inline-chart.mjs",
    "../assets/inline-chart-example.json",
    "../assets/inline-chart-fragment.html",
    "../../../templates/data-app/inline/index.jsx",
    "../../../templates/data-app/base/src/data-app-public.jsx",
  ]) {
    assert.ok(links.has(relativePath), "Missing portable renderer-source link: " + relativePath);
    assert.ok(
      readFileSync(new URL(relativePath, referenceUrl), "utf8").length > 0,
      "The renderer-source link must resolve to a real file: " + relativePath,
    );
  }

  assert.match(rendererReference, /^# Inline Data Chart Renderer$/mu);
  assert.match(rendererReference, /^## Run The Shared Renderer$/mu);
  assert.match(rendererReference, /^## Reviewed Input And Source Safety$/mu);
  assert.match(rendererReference, /^## Runtime, Compatibility, And Verification$/mu);
});

test("the React adapter uses the shared pure renderer and public dashboard controls", () => {
  const sharedRendererImport = /import\s*\{\s*ChartRenderer\s*\}\s*from\s*["']\.\.\/base\/src\/charting\/ChartRenderer\.jsx["'];?/u;
  assert.match(inlineAdapter, sharedRendererImport, "Inline charts must reuse the shared pure renderer");

  assert.match(inlineAdapter, /import React\b/u);
  assert.match(inlineAdapter, /createRoot/u);
  assert.match(inlineAdapter, /<ChartEditor\b/u);
  assert.match(inlineAdapter, /<ChartRenderer\b/u);
  assert.doesNotMatch(
    inlineAdapter,
    /function\s+(?:ChartEditor|ChartExplorer|ChartRenderer|SourceSidebar|SourceInspector|Tabs)\b/u,
    "The inline host must not introduce a second editor, renderer, or source inspector",
  );
  assert.doesNotMatch(inlineAdapter, /\bd3\.(?:line|curveMonotoneX|select)\b/u);
});

test("the adapter uses shared dashboard styles and theme inside a Shadow DOM host", () => {
  const stylesheetInsertion = inlineAdapter.indexOf("shadow.append(stylesheet, container)");
  const reactRootCreation = inlineAdapter.indexOf("const root = createRoot(container)");

  assert.match(inlineAdapter, /from\s*["']\.\.\/base\/src\/styles\.css\?inline["']/u);
  assert.match(inlineAdapter, /from\s*["']\.\/inline\.css\?inline["']/u);
  assert.match(inlineAdapter, /payload\.theme\.css/u);
  assert.match(inlineAdapter, /attachShadow/u);
  assert.match(inlineAdapter, /scopeDashboardStyles/u);
  assert.match(inlineAdapter, /conditions\s*\?\s*`:host\(\$\{conditions\}\)`\s*:\s*["']:host["']/u);
  assert.ok(stylesheetInsertion >= 0, "Attach the canonical dashboard stylesheet to the shadow root");
  assert.ok(
    reactRootCreation > stylesheetInsertion,
    "Install canonical styles synchronously before creating the React chart root",
  );
  assert.match(inlineAdapter, /color-scheme/u);
  assert.match(inlineStyles, /:host\s*\{/u);
  assert.match(inlineStyles, /background:\s*transparent/u);
  assert.doesNotMatch(inlineAdapter, /#[\da-f]{6}(?![\da-f])/iu);
  assert.match(rendererCli, /themeCssPath/u);
  assert.match(rendererCli, /dataAppThemes/u);
});

test("inline chart editing is a contained presentation-only host for the shared editor", () => {
  const editorProps = inlineAdapter.match(/<ChartEditor\b([\s\S]*?)\/>/u)?.[1];

  assert.ok(editorProps, "The inline visualization must mount the canonical editor");
  assert.match(
    publicDataApp,
    /export\s*\{[^}]*\bChartEditor\b[^}]*\}\s*from\s*["']\.\/components\/ChartEditor\.jsx["']/u,
  );
  for (const symbol of ["ContainedDialog", "NativeSelect"]) {
    assert.match(
      publicDataApp,
      new RegExp(`export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*["']\\./components/contained-ui\\.jsx["']`, "u"),
      `The inline host must use the canonical lightweight ${symbol}`,
    );
  }
  assert.match(inlineAdapter, />Edit chart</u);
  for (const prop of [
    /DialogComponent=\{ContainedDialog\}/u,
    /SelectComponent=\{Select\}/u,
    /variant="contained"/u,
    /portalContainer=\{host\.shadowRoot\}/u,
    /saveLabel="Apply"/u,
    /\beditMetadata\b/u,
    /resetPresentation=\{originalPresentation\}/u,
    /validatePresentation=\{validatePresentation\}/u,
    /getCapabilities=\{getCapabilities\}/u,
    /onSave=\{applyPresentation\}/u,
  ]) {
    assert.match(editorProps, prop);
  }
  assert.match(inlineAdapter, /\bvalidateInlineChartPresentation\b/u);
  assert.match(inlineStyles, /\.chart-editor-layer--contained/u);
  assert.match(inlineStyles, /\.chart-editor-dialog--contained/u);
  const editorSignature = sharedChartEditor.match(/export function ChartEditor\(\{([\s\S]*?)\}\s*\)/u)?.[1];
  assert.ok(editorSignature, "The shared editor must expose its host primitive contract");
  for (const primitive of ["DialogComponent", "SelectComponent"]) {
    assert.match(editorSignature, new RegExp(`\\b${primitive}\\b`, "u"));
    assert.doesNotMatch(
      editorSignature,
      new RegExp(`\\b${primitive}\\s*=`, "u"),
      "Each editor host must explicitly provide its own dialog and select primitives",
    );
  }
  assert.match(chartExplorer, /SelectComponent\s*=\s*NativeSelect/u);
  assert.match(containedUi, /export function ContainedDialog\b/u);
  assert.match(containedUi, /export function NativeSelect\b/u);
  assert.match(containedUi, /<select\b/u);
  for (const sharedComponent of [sharedChartEditor, chartExplorer, containedUi]) {
    assert.doesNotMatch(
      sharedComponent,
      /from\s*["'](?:\.\/ui\.jsx|\.\/Controls\.jsx|@radix-ui\/)/u,
      "Host-neutral chart editing must not retain heavyweight durable-app dialog or select defaults",
    );
  }
  assert.doesNotMatch(
    inlineAdapter,
    /\b(?:submitDataAppAction|usePresentationPersistence|writeLocalPresentation|fetch)\s*\(|\bnew\s+(?:WebSocket|XMLHttpRequest)\b|\b(?:localStorage|sessionStorage|indexedDB)\s*\./u,
    "A contained inline edit must not invoke durable-app persistence, storage, or network operations",
  );
});

test("inline editor guidance states the reviewed-data boundary and actual persistence lifetime", () => {
  const guidance = section(rendererReference, "## Edit The Inline Chart", "## Reviewed Input And Source Safety");

  assert.match(inlineRouting(), /Edit chart/u);
  assert.match(guidance, /ChartEditor/u);
  assert.match(guidance, /`Apply` commits presentation changes only to that mounted chart/u);
  assert.match(guidance, /`Cancel` or Escape discards the current draft/u);
  assert.match(guidance, /`Reset`[^.]*original reviewed presentation[^.]*after `Apply`/u);
  assert.match(guidance, /independent state/u);
  assert.match(guidance, /do not survive a reload or reopening the task/u);
  assert.match(guidance, /already embedded[^.]*privacy-reviewed fields/u);
  assert.match(guidance, /reviewed grain/u);
  assert.match(guidance, /Stacked and percentage views keep the original reviewed measure and split/u);
  assert.match(guidance, /permission to stack the original chart does not authorize a different mapping/u);
  assert.match(guidance, /percentage normalization remains fixed/u);
  assert.match(guidance, /specialized[^.]*fixed/iu);
  assert.match(guidance, /Native histogram measurement and count axis labels are editable/u);
  assert.match(guidance, /raw observations, binning, and the count baseline remain fixed/u);
  assert.match(guidance, /nonnumeric or numeric-string measures[^.]*original type and mapping[^.]*do not coerce/u);
  assert.match(
    guidance,
    /Do not change the analytical chart family or preaggregate reviewed rows merely to unlock presentation controls/u,
  );
  assert.match(guidance, /explain genuinely unsupported options[^.]*another editor[^.]*unreviewed fields/u);
  assert.match(guidance, /original reviewed rows, query, source metadata, or provenance/u);
  for (const unavailable of ["queries", "publish", "backend"]) {
    assert.ok(guidance.toLowerCase().includes(unavailable), `Document the unavailable ${unavailable} operation`);
  }
});

test("the actual shared renderer owns smooth lines, active markers, and missing-value behavior", () => {
  assert.match(chartRenderer, /<Line\b[^>]*type="monotone"/su);
  assert.match(chartRenderer, /strokeLinecap="round"/u);
  assert.match(chartRenderer, /strokeLinejoin="round"/u);
  assert.match(chartRenderer, /activeDot=\{/u);
  assert.match(chartRenderer, /connectNulls=\{false\}/u);
  assert.match(inlineAdapter, /<ChartRenderer\b/u);
});

test("isolated one-point runs share the canonical transform without dots on connected lines", () => {
  assert.match(chartTransforms, /export function isolatedPointIndexes\(rows,\s*field\)/u);
  assert.match(chartTransforms, /Number\.isFinite\(rows\[index\]\?\.\[field\]\)/u);
  assert.match(chartTransforms, /present\(index\)\s*&&\s*!present\(index - 1\)\s*&&\s*!present\(index \+ 1\)/u);
  assert.match(chartRenderer, /\bisolatedPointIndexes\b[\s\S]{0,150}from\s*["']\.\/chart-transforms\.js["']/u);
  assert.match(chartRenderer, /new Set\(isolatedPointIndexes\(data,\s*field\)\)/u);
  assert.match(
    chartRenderer,
    /: isolatedPoints\.get\(field\)\?\.size\s*\?\s*<IsolatedLineDot\b[^>]*>\s*:\s*false\}/u,
  );
  assert.match(chartRenderer, /<ExploreDot[\s\S]{0,260}isolated=\{isolatedPoints\.get\(field\)\}/u);
  assert.match(chartRenderer, /if\s*\(!indexes\.has\(index\)\)\s*return null/u);
  assert.match(chartRenderer, /data-isolated-point="true"/u);
  assert.doesNotMatch(chartRenderer, /dot=\{[\s\S]{0,250}data\.filter\([^)]*\)[\s\S]{0,100}length === 1/u);
});

test("the executable CLI and self-contained fragment assets are wired to the actual adapter", () => {
  assert.match(rendererCli, /^#!\/usr\/bin\/env node$/mu);
  assert.match(rendererCli, /export async function renderInlineChart/u);
  assert.match(rendererCli, /export async function main/u);
  assert.match(rendererCli, /prepareInlineRuntime/u);
  assert.match(rendererCli, /normalizeInlineChartInput/u);
  assert.match(inlineFragment, /type="application\/json"/u);
  assert.match(inlineFragment, /__INLINE_PAYLOAD__/u);
  assert.match(inlineFragment, /__INLINE_RUNTIME__/u);
  assert.match(inlineFragment, /CodexDataInlineChart\.mountInlineChart/u);
  assert.match(inlineAdapter, /export function mountInlineChart/u);
  assert.doesNotMatch(inlineFragment, /<script[^>]*\bsrc\s*=|<iframe\b|https?:\/\//iu);
});

test("the renderer documents a concrete approved input, output, and same-response delivery command", () => {
  const flattenedCommands = rendererReference.replace(/\\\s*\n\s*/gu, " ");

  assert.match(
    flattenedCommands,
    /"<codex-node>"\s+"<data-plugin-root>\/skills\/visualize-data\/scripts\/render-inline-chart\.mjs"\s+--input\s+\/absolute\/path\/reviewed-chart\.json\s+--output\s+\/absolute\/approved\/visualizations\/weekly-active-users\.html/u,
  );
  assert.match(
    rendererReference,
    /visualize\{"path":"\/absolute\/approved\/visualizations\/weekly-active-users\.html"\}/u,
  );
  assert.match(rendererReference, /same (?:final )?(?:response|answer)|same-answer/iu);
  assert.match(inlineRouting(), /actual Visualize content reference[^.]*same final response/iu);
  assert.match(rendererCli, /Use --input chart\.json and --output/u);
});

test("explicit multiple-chart requests reuse one runtime and deliver every reviewed chart inline", () => {
  assert.match(responseMode(), /Honor an explicit request for multiple inline charts even when several are needed/iu);

  for (const guidance of [inlineRouting(), rendererReference]) {
    assert.match(guidance, /stable, distinct chart ID and output filename/iu);
    assert.match(guidance, /reuse the same shipped data-free runtime/iu);
    assert.match(guidance, /one actual Visualize content reference per chart in the same final response/iu);
    assert.match(guidance, /never concatenate complete fragments or rebuild the runtime for each chart/iu);
    assert.match(guidance, /Preserve missing observations as `null` in the real measure/iu);
    assert.match(guidance, /do not invent helper series or zero-fill missing values to force chart marks/iu);
  }
});

test("the renderer documents preparation, offline operation, compatibility options, themes, and inspection flags", () => {
  for (const option of [
    "--example",
    "--list-chart-types",
    "--prepare",
    "--offline",
    "--cache-dir",
    "--theme-css",
    "--include-sql",
    "--include-source-urls",
  ]) {
    assert.ok(rendererReference.includes(option), "Document the supported renderer option " + option);
    assert.ok(rendererCli.includes(option), "Implement the documented renderer option " + option);
  }

  assert.match(rendererReference, /codex-classic/u);
  assert.match(
    rendererReference,
    /(?:locked|pinned|prebuilt)[^.]*React\/Recharts|React\/Recharts[^.]*(?:locked|pinned|prebuilt)/iu,
  );
  assert.match(rendererReference, /does not compile it or install dependencies/iu);
  assert.match(rendererReference, /do not create or populate dependency caches/iu);
  assert.match(rendererReference, /cache/iu);
  assert.match(rendererReference, /offline/iu);
});

test("the bundled example supplies the reviewed chart contract without inventing real provenance", () => {
  assert.equal(inlineExample.schemaVersion, 1);
  assert.equal(typeof inlineExample.title, "string");
  assert.equal(typeof inlineExample.chart, "object");
  assert.equal(inlineExample.chart.type, "line");
  assert.equal(typeof inlineExample.chart.x, "string");
  assert.equal(typeof inlineExample.chart.y, "string");
  assert.ok(Array.isArray(inlineExample.rows) && inlineExample.rows.length > 0);
  assert.match(inlineExample.source.label, /illustrative|sample/iu);
  assert.ok(Array.isArray(inlineExample.source.caveats));
  assert.match(inlineExample.source.caveats.join(" "), /illustrative|sample/iu);

  for (const field of ["schemaVersion", "title", "chart", "rows", "source"]) {
    assert.ok(rendererReference.includes(field), "Document required reviewed input field " + field);
  }

  assert.match(rendererReference, /schemaVersion[^.\n]*1/iu);
});

test("reviewed inline inputs remain bounded and project rows to approved chart fields", () => {
  assert.match(rendererInput, /MAX_INLINE_ROWS\s*=\s*2_000/u);
  assert.match(rendererInput, /MAX_INLINE_INPUT_BYTES\s*=\s*2_000_000/u);
  assert.match(rendererInput, /MAX_INLINE_FRAGMENT_BYTES\s*=\s*1_000_000/u);
  assert.match(rendererInput, /Object\.fromEntries\(fields/u);
  assert.match(rendererReference, /2,000 (?:reviewed )?rows/iu);
  assert.match(rendererReference, /(?:2\s*MB[^.]*input|input[^.]*2\s*MB)/iu);
  assert.match(rendererReference, /(?:1\s*MB[^.]*(?:fragment|output)|(?:fragment|output)[^.]*1\s*MB)/iu);
  assert.match(rendererCli, /aggregate|downsample/iu);
  assert.match(inlineRouting(), /Include only bounded, reviewed values needed for the chart/iu);
});

test("inline source guidance preserves recorded freshness semantics", () => {
  assert.match(rendererReference, /Set `source\.executedAt` only from recorded query-execution metadata/iu);
  assert.match(rendererReference, /`generatedAt` only from actual reviewed snapshot creation or capture/iu);
  assert.match(rendererReference, /preserve materialization or source-refresh timestamps with their timezone/iu);
  assert.match(
    rendererReference,
    /original approved preview field or explicitly labeled `source\.caveats`\/`source\.evidenceFlow`/iu,
  );
  assert.match(rendererReference, /omit unknown timestamps/iu);
  assert.match(rendererReference, /never relabel freshness as query execution/iu);
  assert.match(inlineRouting(), /raw SQL unless explicitly requested/iu);
});

test("runtime preparation verifies the prebuilt data-free artifact without a customer toolchain", () => {
  assert.match(rendererBuild, /readPrebuiltManifest/u);
  assert.match(rendererBuild, /prebuilt:\s*true/u);
  assert.match(rendererBuild, /cacheDir:\s*null/u);
  assert.match(rendererBuild, /cacheHit:\s*false/u);
  assert.match(rendererBuild, /legacyCacheDir/u);
  assert.doesNotMatch(
    rendererBuild,
    /extractBundledToolchain|verifyBundledToolchain|readBundledToolchainManifest|withBundledNativeBinding|createRequire|dependencyDirectory|\bspawn\b|\bmkdtemp\b/u,
  );
  assert.match(rendererCli, /loadPrebuiltCompiler\(\{ pluginRoot \}\)/u);
  assert.doesNotMatch(rendererCli, /loadInlineToolchain|dependencyDirectory/u);
  assert.doesNotMatch(rendererBuild, /npmCommand|npm\.cmd|--no-audit|--no-fund/u);
  assert.match(rendererBuild, /cache outside the installed Data plugin/u);
  assert.match(rendererBuild, /offline/u);
  assert.match(rendererReference, /load_workspace_dependencies/u);
  assert.match(rendererReference, /offline/iu);
  assert.match(releaseBuild, /canonicalModules:\s*\[\.\.\.INLINE_CANONICAL_MODULES\]/u);
  assert.match(releaseBuild, /assertDataFreeChunk/u);
  assert.match(rendererCli, /Reviewed chart data must not be written into the shared renderer cache/u);
  assert.match(rendererReference, /data-free/iu);
  assert.match(rendererReference, /outside[^.]*installed (?:Data )?plugin/iu);
});

test("custom inline themes are inspected with a real escape-aware CSS AST", () => {
  assert.match(rendererTheme, /parseStrictCss\(css, compiler/u);
  assert.match(rendererTheme, /onInvalid:\s*reject/u);
  assert.match(cssSyntax, /parseCustomProperty:\s*true/u);
  assert.match(cssSyntax, /onParseError\(error\)/u);
  assert.match(cssSyntax, /node\.type === "Raw"/u);
  assert.match(rendererTheme, /walkCss\(ast/u);
  assert.match(rendererTheme, /decodeCssIdentifier\(node\.name\)/u);
  assert.match(rendererTheme, /resourceFunctions/u);
  assert.match(rendererTheme, /generateCss\(validatedAst\(css, compiler\)\)/u);
  assert.match(rendererTheme, /validatedAst\(output, compiler\)/u);
  assert.doesNotMatch(rendererTheme, /lightningcss|transformCss/u);
});

test("self-contained renderer output remains safe with current and legacy host replacement behavior", () => {
  assert.match(releaseBuild, /makeReplacementSafe/u);
  assert.match(releaseBuild, /assertReplacementSafe/u);
  assert.match(releaseBuild, /externalImports/u);
  assert.match(releaseBuild, /dynamicImports/u);
  assert.match(rendererBuild, /new Script\(code/u);
  assert.match(rendererBuild, /assertReplacementSafe\(code\)/u);
  assert.match(rendererBuild, /MAX_INLINE_FRAGMENT_BYTES/u);
  assert.match(rendererInput, /function inlineJson/u);
  assert.match(rendererInput, /function assertReplacementSafe/u);
  assert.match(rendererReference, /String\.replace/u);
  assert.match(rendererReference, /sandbox|browser/iu);
  assert.doesNotMatch(inlineFragment, /\bfetch\s*\(|\bWebSocket\b|XMLHttpRequest/u);
});

test("renderer failure guidance never announces an undelivered chart as rendered", () => {
  assert.match(rendererReference, /(?:fails?|failure|unavailable)/iu);
  assert.match(rendererReference, /(?:report|surface|explain)[^.]*error|actionable[^.]*error/iu);
  assert.match(
    rendererReference,
    /(?:do not|never)[^.]*claim[^.]*rendered|(?:do not|never)[^.]*deliver[^.]*nonexistent/iu,
  );
  assert.match(rendererCli, /process\.exitCode\s*=\s*1/u);
});

test("an available inline visualization cannot silently become Mermaid, Matplotlib, or an announced handoff", () => {
  const guidance = inlineRouting();

  assert.match(
    guidance,
    /A promised handoff, Mermaid diagram, Matplotlib image, code fence, downloadable HTML, or source preview does not replace an available inline chart\./u,
  );
  assert.match(guidance, /actual Visualize content reference[^.]*same final response/iu);
});

test("the shared React path changes only selected inline charts and preserves privacy", () => {
  assert.match(rendererReference, /inline/iu);
  assert.match(rendererReference, /Work Mode/iu);
  assert.match(rendererReference, /reviewed/iu);
  assert.match(rendererReference, /(?:source provenance|provenance|source details)/iu);
  assert.match(rendererReference, /(?:credentials|secrets|tokens)/iu);
  assert.match(rendererReference, /SQL/iu);
  assert.match(inlineRouting(), /Apply this section only after an .inline. response has been selected/iu);
});

test("the early source execution gate retains Data's response, authoritative source, and final answer", () => {
  const gate = sourceExecutionGate();
  const skillSelection = index.indexOf("#### Skill Selection");
  const customQuestion = index.indexOf("#### Custom-question access");

  assert.match(
    gate,
    /After the Chat mode stop gate clears, select the requested response mode and identify the authoritative source category and authority criteria/iu,
  );
  assert.match(
    gate,
    /before loading or starting any external helper, source-specific workflow, or full end-to-end answer router/iu,
  );
  assert.match(
    gate,
    /verify the actual controlling source through the compatible narrow helper's governed discovery/iu,
  );
  assert.match(gate, /Data owns the selected output, source authority, and final user-facing answer/iu);
  assert.match(gate, /compatible helpers return bounded reviewed evidence, rows, and provenance to Data/iu);
  assert.match(gate, /without replacing that output or answer/iu);
  assert.match(gate, /Helpers return material caveats, not provider-formatted response text\./u);
  assert.match(gate, /External narrow helpers are evidence-only/iu);
  assert.match(
    gate,
    /final-answer formatting, confidence, receipt, or response-delivery requirements never govern Data's final response/iu,
  );
  assert.match(gate, /preserve genuinely required source citations, permalinks, and governance/iu);
  assert.ok(
    index.indexOf("## Source Execution Gate") < customQuestion,
    "Execute the gate before source-helper selection",
  );
  assert.ok(
    index.indexOf("## Source Execution Gate") < skillSelection,
    "Execute the gate before external companion loading",
  );
});

test("source helper preflight is provider-neutral, narrow, and cannot replace the selected Data workflow", () => {
  const gate = sourceExecutionGate();
  const preflight = paragraphStartingWith(gate, "Before selecting a source-specific helper,");

  assert.match(
    preflight,
    /inspect candidate skill frontmatter and prerequisite contracts without invoking their workflow/iu,
  );
  assert.match(preflight, /actually callable or discoverable mandatory discovery tools/iu);
  assert.match(preflight, /supported read-only execution modes/iu);
  assert.match(preflight, /Prefer the narrowest directly relevant source, provider, or data-context helper/iu);
  assert.match(preflight, /mandatory tools are unavailable/iu);
  assert.match(preflight, /required engine is explicitly disabled/iu);
  assert.match(
    preflight,
    /Do not invoke a second full end-to-end analytics or answer router merely for source discovery/iu,
  );
  assert.match(
    preflight,
    /unless the user explicitly requests it or all prerequisites and its output\/source contract are proven compatible/iu,
  );
  assert.doesNotMatch(
    gate,
    /\b(?:athena|kepler|databricks|snowflake|bigquery|statsig|genie|trino|spark|openai)\b|mcp__|tool_search|ALL_TOOLS/iu,
    "Source execution gate must remain portable and provider-neutral",
  );
  assert.match(
    index,
    /external skill only for a necessary, narrow complementary source, semantic, method, or delivery task that passes `Source Execution Gate`/iu,
  );
  assert.match(index, /Data retains the selected output and final-answer ownership/iu);
});

test("governed source reads preserve controlling evidence, approvals, privacy, and no-fallback boundaries", () => {
  const gate = sourceExecutionGate();
  const access = section(index, "#### Custom-question access", "#### No-source completion invariant");
  const guardrail = section(index, "### Source Access Guardrail", "### Suggest Automations");

  assert.match(gate, /ordinary user-requested read-only analysis with no named-source restriction/iu);
  assert.match(gate, /already-authorized, callable governed workflow/iu);
  assert.match(gate, /independently verify and query the same controlling source/iu);
  assert.match(gate, /supported-engine rules/iu);

  for (const invariant of [
    "metric definition",
    "population",
    "filters",
    "grain",
    "period",
    "dimensions",
    "freshness",
    "privacy",
  ]) {
    assert.ok(gate.includes(invariant), "Preserve source evidence invariant: " + invariant);
  }

  assert.match(gate, /Do not ask for extra chat confirmation[^.]*normal read-only execution/iu);
  assert.match(gate, /Never select weaker or conflicting sources/iu);
  assert.match(gate, /bypass tool or consequential-action approvals/iu);
  assert.match(gate, /already-selected workflow's explicit no-fallback boundary/iu);
  assert.match(
    guardrail,
    /A broader, narrower, or differently defined metric is not equivalent to the requested metric/iu,
  );
  assert.match(guardrail, /never silently substitute one or hide a material scope difference/iu);
  assert.match(
    guardrail,
    /A dashboard title or an `overall`, `all`, or `total` label does not establish the requested population/iu,
  );
  assert.match(guardrail, /When scope is ambiguous, use the smallest governed read necessary/iu);
  assert.match(guardrail, /verify the governing metric definition and actual source measure, filter, and population/iu);
  assert.match(
    guardrail,
    /When a usable, authoritative measure matches the requested metric definition, product or population, and period, use that measure/iu,
  );
  assert.match(guardrail, /unless the user explicitly asks for the broader source-defined headline/iu);
  assert.match(guardrail, /executive prominence does not override verified scope/iu);
  assert.match(
    guardrail,
    /If only a broader or narrower measure is available and the existing source guardrails permit a substitute/iu,
  );
  assert.match(guardrail, /name its actual scope in the visible chart title and concise answer beside the chart/iu);
  assert.match(guardrail, /state that it is not equivalent/iu);
  assert.match(guardrail, /never leave that difference only in source metadata or the inspector/iu);
  assert.doesNotMatch(access, /Before selecting a source-specific helper,/iu);
});

test("source discovery is bounded and authoritative-first without scanning every unrelated source", () => {
  const discovery = section(index, "### Source Discovery And Verification", "### Source Access Guardrail");

  assert.match(discovery, /1\. \*\*Start with the authoritative source\.\*\*/u);
  assert.match(discovery, /select the strongest controlling source for the question/iu);
  assert.match(discovery, /smallest governed native read or discovery step needed/iu);
  assert.match(discovery, /2\. \*\*Expand only for a material gap or conflict\.\*\*/u);
  assert.match(discovery, /authoritative read is unavailable, insufficient, conflicting, or missing evidence/iu);
  assert.match(discovery, /verify selected data through live reads/iu);
  assert.match(discovery, /two plausible controlling sources or definitions whose differences would change the requested answer/iu);
  assert.match(discovery, /ask one focused source or metric clarification before substantive querying/iu);
  assert.match(discovery, /the existence of alternatives alone does not require a question/iu);
  assert.doesNotMatch(discovery, /Explore all possible sources|Search every connected or provided source/iu);
});

test("inline receipt presents provenance and limitations without a confidence tier", () => {
  assert.match(receiptReference, /The collapsed row reads \*\*Sources\*\* for one finding and \*\*Sources • N\*\* for multiple findings/iu);
  assert.match(receiptReference, /The Data Sources payload does not accept a `confidence` field/iu);
  assert.match(receiptReference, /explain what the evidence establishes and its most consequential limit/iu);
  assert.doesNotMatch(receiptReference, /\*\*High:\*\*|\*\*Medium:\*\*|\*\*Low:\*\*/iu);
});

test("run order preserves Data response ownership before helper preflight, selection, and governed reads", () => {
  const runOrder = section(index, "#### Run Order", "#### Skill Selection");
  const responseSelection = runOrder.indexOf("3. Choose and lock the response mode using `Response Mode`");
  const sourceGate = runOrder.indexOf("4. Apply `Source Execution Gate`");
  const focusedSelection = runOrder.indexOf(
    "5. Inspect relevant focused-skill frontmatter and candidate helper prerequisites",
  );
  const skillBodies = runOrder.indexOf("7. Read and follow only the selected skill bodies");
  const governedReads = runOrder.indexOf("8. Apply Source Discovery And Verification and the Source Access Guardrail");
  const reviewedEvidence = runOrder.indexOf("9. Return reviewed evidence, rows, and provenance from source helpers");
  const completion = runOrder.indexOf("10. Before final response, apply Response Mode's completion gate");

  assert.ok(responseSelection >= 0, "Choose the response mode before selecting any source helper");
  assert.ok(sourceGate > responseSelection, "Apply the source execution gate after choosing the response");
  assert.ok(focusedSelection > sourceGate, "Preflight focused helpers only after source and response ownership");
  assert.ok(skillBodies > focusedSelection, "Load only selected compatible skill bodies");
  assert.ok(governedReads > skillBodies, "Read sources only through the selected governed workflow");
  assert.ok(reviewedEvidence > governedReads, "Source helpers must return evidence to Data");
  assert.ok(completion > reviewedEvidence, "Apply Data completion gates after receiving reviewed evidence");
  assert.match(runOrder, /bounded, authoritative-first governed reads/iu);
  assert.match(runOrder, /preserve Data's selected response mode and final-answer ownership/iu);
  assert.match(runOrder, /existing data-context skills as read-only context/iu);
  assert.match(runOrder, /Saved-context creation is never a prerequisite/iu);
  assert.match(index, /Ordinary analytics workflows do not require saved data-context setup/iu);
  assert.doesNotMatch(runOrder, /create-data-context/u);
  assert.match(index, /\[create-data-context\]\(\.\.\/create-data-context\/SKILL\.md\)/u);
  assert.match(index, /then the focused workflow's completion gates/iu);
});

test("the focused visualization skill remains discoverable only for durable artifacts", () => {
  const skillListing = paragraphStartingWith(
    index,
    "Use $visualize-data to",
  );

  assert.match(skillListing, /reports, dashboards, decks, notebooks, and other durable artifacts/iu);
  assert.match(
    skillListing,
    /Inline Codex answers use Data's shared React\/Recharts inline renderer and native `visualize` structured output through `visualize:visualize`/iu,
  );
  assert.doesNotMatch(skillListing, /Use \$visualize-data[^.]*inline/iu);
  assert.match(visualization, /^name: visualize-data$/mu);
  assert.match(visualization, /Inline Codex answers are not owned by this skill/iu);
});

test("stakeholder-facing output preserves master copy restrictions and meaningful caveats", () => {
  const stakeholder = section(index, "### Stakeholder-Facing Output", "### Source Links");

  assert.match(
    index,
    /Keep stakeholder-facing inline answers and visible report or dashboard copy focused on the answer, evidence, implications, and caveats that change interpretation or action\./u,
  );
  assert.match(
    index,
    /Do not include analysis process, methodology choices, source selection, query strategy, validation steps, chart-choice rationale/iu,
  );
  assert.match(
    index,
    /Include methodology only when the user asks for it, the selected template requires it, or it materially changes interpretation or action\./u,
  );
  assert.match(
    stakeholder,
    /Never reinterpret unrelated provider, retrieval, or classification scores as confidence in a metric or analytical conclusion/iu,
  );
  assert.match(stakeholder, /whether in source evidence flow or final prose/iu);
  assert.match(
    stakeholder,
    /Before finalizing, scrub invented numeric or qualitative answer-confidence ratings/iu,
  );
  assert.match(stakeholder, /inline Sources receipt reports provenance and recorded qualifications, not an answer-confidence level/iu);
  assert.match(stakeholder, /explain the concrete source and result checks and the most consequential limit in native prose/iu);
  assert.match(
    stakeholder,
    /Preserve natural uncertainty, genuinely evidenced relevant statistical uncertainty, including confidence intervals, and material caveats/iu,
  );
  assert.match(
    stakeholder,
    /If the user explicitly asks how well a finding is supported/iu,
  );
  assert.match(stakeholder, /never invent a probability/iu);
  assert.doesNotMatch(stakeholder, /confidence or uncertainty quantity only when the user requests it/iu);
  assert.match(
    inlineRouting(),
    /material source links and caveats in concise surrounding prose without narrating methodology/iu,
  );
  assert.match(rendererReference, /(?:source provenance|provenance|caveats)/iu);
});

test("the native reference preserves upstream caveat and methodology guidance verbatim", () => {
  const upstreamCaveat =
    "- Keep material caveats that change interpretation or action in the surrounding response or concise visible notes. Cite useful sources when they help trust, but do not narrate source selection or methodology unless the user asks, the selected template requires it, or it materially changes interpretation or action.";

  assert.ok(nativeVisualization.includes(upstreamCaveat));
  assert.match(nativeVisualization, /or change the response mode selected by the Data index\./u);
  assert.doesNotMatch(
    nativeVisualization,
    /default report routing|Keep essential source links, methodology, and material caveats/iu,
  );
});

test("ordinary requested and lookup tables remain Markdown", () => {
  assert.match(inlineRouting(), /Return ordinary requested or lookup tables as Markdown\./u);
  assert.match(nativeVisualization, /Return an ordinary requested or lookup table directly as a Markdown table/iu);
  assert.match(nativeVisualization, /Compact Markdown table or prose/iu);
});

test("interactive tables require an explicit request and meaningful exploration", () => {
  assert.match(inlineRouting(), /Use an interactive table only when explicitly requested/iu);
  assert.match(inlineRouting(), /meaningful sorting, filtering, or exploration cannot be expressed by Markdown/iu);
});

test("unavailable Visualize execution preserves native and compact upstream fallbacks", () => {
  const fallback = paragraphStartingWith(
    inlineRouting(),
    "If the shared renderer, its required execution environment, an approved writable fragment surface, or Visualize delivery is unavailable,",
  );
  const native = fallback.search(/available native chart surface/iu);
  const compact = fallback.search(/compact table\/prose fallback/iu);

  assert.ok(native >= 0, "Consider a surfaced native renderer when Visualize is unavailable");
  assert.ok(compact > native, "Preserve the upstream compact table/prose fallback");
  assert.match(
    responseMode(),
    /If no native visualization is available, use the clearest compact table or prose fallback\./u,
  );
});

test("inline Visualize and native Work Mode embed only bounded reviewed evidence", () => {
  assert.match(inlineRouting(), /Include only bounded, reviewed values needed for the chart/iu);
  assert.match(rendererReference, /bounded reviewed[^.]*(?:rows|input)/iu);
  assert.match(nativeVisualization, /reviewed data embedded and bounded/iu);
  assert.match(
    nativeVisualization,
    /Embed only bounded fields needed for the displayed marks or requested interaction/iu,
  );
});

test("inline handoffs reject secrets, direct identifiers, and unnecessary sensitive fields", () => {
  assert.match(inlineRouting(), /Never embed hidden reasoning, credentials, tokens/iu);
  assert.match(inlineRouting(), /direct personal contact or payment identifiers/iu);
  assert.match(inlineRouting(), /unnecessary sensitive fields/iu);
  assert.match(rendererReference, /Never include credentials, tokens, hidden reasoning/iu);
  assert.match(rendererReference, /direct personal contact or payment identifiers/iu);
  assert.match(nativeVisualization, /hidden reasoning, credentials, secrets, tokens/iu);
  assert.match(nativeVisualization, /direct personal contact\/payment identifiers/iu);
});

test("source context and material caveats remain in concise surrounding prose", () => {
  assert.match(inlineRouting(), /material source links and caveats in concise surrounding prose/iu);
  assert.match(inlineRouting(), /without narrating methodology or exposing raw SQL unless explicitly requested/iu);
  assert.match(nativeVisualization, /visual grain, time window, units, denominator, and filters/iu);
});

test("inline Visualize output preserves host theming and both light and dark appearances", () => {
  assert.match(inlineRouting(), /selected theme|codex-classic/iu);
  assert.match(rendererReference, /preserve host light\/dark appearance/iu);
  assert.match(inlineAdapter, /scopeDashboardStyles/u);
  assert.match(inlineAdapter, /color-scheme/u);
  assert.match(inlineStyles, /:host\s*\{/u);
});

test("Work Mode preserves live native content references before considering fallback", () => {
  assert.match(nativeVisualization, /`charts_widget_v2` and `app_block` are host-native/iu);
  assert.match(
    nativeVisualization,
    /invoke it with the exact host-provided `genui` content-reference syntax before considering fallback/iu,
  );
  assert.match(nativeVisualization, /do not search for it, self-declare it unavailable/iu);
  assert.ok(nativeVisualization.includes('genui{"charts_widget_v2":{"content":{...}}}'));
  assert.match(nativeVisualization, /keep `app_block` conditional on the host surfacing it/iu);
});

test("native Work Mode preserves supported JSON charts and custom interactive app blocks", () => {
  assert.match(
    nativeVisualization,
    /supported simple chart families: `bar`, `line`, `pie`, and ordinary fixed-size `scatter`/iu,
  );
  assert.match(
    nativeVisualization,
    /For bubble charts, funnel charts, and any other inline chart family outside that JSON surface, use `app_block`/iu,
  );
  assert.match(
    nativeVisualization,
    /Do not decline the request, ask the user to repeat it, emit an unsupported JSON shape/iu,
  );
  assert.match(nativeVisualization, /live `app_block` `genui` content reference/iu);
});

test("native Work Mode failures preserve a static visual before a compact table", () => {
  const failure = paragraphStartingWith(
    nativeVisualization,
    "For exactly one supported `bar`, `line`, `pie`, or `scatter` chart,",
  );
  const nativeReference = failure.indexOf("live `genui` content reference");
  const staticChart = failure.search(/static\/Matplotlib chart/iu);
  const compact = failure.search(/compact table or prose/iu);

  assert.ok(nativeReference >= 0);
  assert.ok(staticChart > nativeReference);
  assert.ok(compact > staticChart);
  assert.match(failure, /rejected or fails to render/iu);
  assert.match(failure, /same reviewed rows/iu);
  assert.match(nativeVisualization, /Do not claim[^.]*rendered unless[^.]*actually rendered/iu);
});

test("inline routing preserves explicitly selected reports, dashboards, and exports", () => {
  assert.match(inlineRouting(), /Apply this section only after an `inline` response has been selected/iu);
  assert.match(
    inlineRouting(),
    /do not replace an explicitly requested report, dashboard, notebook, export, or static output/iu,
  );
  assert.match(nativeVisualization, /does not choose inline delivery/iu);
  assert.match(nativeVisualization, /Do not use this reference to waive or replace `\$build-report`/iu);
  assert.match(nativeVisualization, /If a report, dashboard, or HTML surface was selected, keep that surface/iu);
  assert.match(
    nativeVisualization,
    /User explicitly asks for Python, Matplotlib, a notebook, a standalone static image\/file, or an export/iu,
  );
});

test("durable report and dashboard visuals retain the shared React/Recharts Data app", () => {
  assert.match(visualization, /report or dashboard[^.]*\[Data App Contract\]/iu);
  assert.match(visualization, /`ChartRenderer`[^.]*React\/Recharts/iu);
  assert.match(visualization, /reviewed query rows and exact source metadata/iu);
  assert.match(visualization, /stable authored component and query IDs/iu);
  assert.match(index, /Build reports and dashboards with the shared Data app/iu);
});

test("MCP remains a valid reviewed data source without controlling inline rendering", () => {
  assert.match(index, /MCP servers and other callable tools remain valid data sources/iu);
  assert.match(nativeVisualization, /MCP servers and other callable tools can still supply reviewed source data/iu);
});
