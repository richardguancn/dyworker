import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { prepareDataApp, readCatalog, readExampleFixture } from "../scripts/prepare-data-app.mjs";
import { runDataAppFixtureBuild } from "./browser-helpers.mjs";

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(plugin, "templates/data-app/base");
const examples = join(plugin, "templates/data-app/examples");
const catalog = readCatalog();
for (const entry of catalog.examples) await import(pathToFileURL(join(examples, entry.test)));

test("gallery report snapshot reproduces from the canonical diagnostic evidence", async () => {
  const root = join(base, "examples/reports/delivery-diagnostic");
  const { createDeliveryDiagnostic } = await import(pathToFileURL(join(root, "diagnostic.mjs")));
  const saved = JSON.parse(readFileSync(join(base, "examples/main-report/data.json"), "utf8"));
  const { snapshot, results } = createDeliveryDiagnostic(readFileSync(join(root, "evidence.json"), "utf8"), saved.generatedAt, { id: saved.id });
  assert.deepEqual(saved, snapshot);
  assert.equal(results.volumeExtra + results.deterioration, results.late - results.beforeLate);
  assert.equal(saved.filters.length, 0, "Report evidence has no invisible dashboard filters");
});

test("performance blocks hand raw scoped evidence to sources and plotted rows to editing", async () => {
  const requireBase = createRequire(join(base, "package.json"));
  const { createServer } = await import(pathToFileURL(requireBase.resolve("vite")));
  const publicId = "\0performance-evidence-public";
  const server = await createServer({ root: base, configFile: false, appType: "custom",
    resolve: { dedupe: ["react", "react-dom"] },
    optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, watch: null },
    plugins: [{ name: "performance-evidence-handoff", enforce: "pre", resolveId(source, importer) {
      if (source === "../../data-app-public.jsx" && importer?.includes("business-performance/content/dashboard/")
        && !importer.endsWith("DashboardContent.jsx")) return join(base, "src/data-app-public.jsx");
      if (!importer?.endsWith("business-performance/content/dashboard/DashboardContent.jsx")) return;
      if (source === "../../data-app-public.jsx") return publicId;
    }, load(id) {
      if (id === publicId) return `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
        export const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
        export const captured=[]; let shell; export const configure=value=>shell=value,useDataApp=()=>shell;
        export const useSectionFilters=()=>({values:{account:'all'},setFilter:()=>{},componentProps:()=>({})});
        export const useDashboardTabs=()=>({activeTabId:'dashboard'});
        ${["ChartRenderer","Icon","Switch","DataComponent","DataTable","Dropdown","Filters","MetricCard","Section","SectionHeader","SortableItem","SortableRegion"]
          .map(name=>`export const ${name}=props=>{captured.push({props});return props.children??null;};`).join("\n")}`;
    } }],
  });
  try {
    const snapshot = await readExampleFixture(catalog.examples.find(entry => entry.id === "business-performance"));
    const { buildPerformance, deepDiveModel, queryId, rosterQueryId } = await import(pathToFileURL(join(examples, "business-performance/content/dashboard/performance-data.js")));
    const filters = { date: "2026-07-20..2026-08-16", region: "EMEA", product: "API", segment: "all" };
    const model = buildPerformance(snapshot.queries, filters), deep = deepDiveModel(snapshot.queries, filters, model);
    const { PerformanceBody, PerformanceSkeleton } = await server.ssrLoadModule(join(examples, "business-performance/content/dashboard/DashboardContent.jsx"));
    const { configure, render, captured } = await server.ssrLoadModule(publicId);
    configure({ snapshot, queries: snapshot.queries, filters, chartProps:()=>({}), chartOverrides:{}, visible:()=>true,
      appTitle:snapshot.title, viewFocus:{}, setFilter:()=>{}, setAppTitle:()=>{} });
    const blocks = [];
    for (const tab of ["dashboard","revenue","adoption","retention","customers"]) {
      captured.length = 0;
      render(PerformanceBody,{initialView:{},tab,compare:true,grain:"week",dimension:"product",setDimension:()=>{},model,deep});
      blocks.push(...captured.filter(node=>node.props?.sourceRows));
    }
    const rawSets = { [queryId]: new Set(snapshot.queries[queryId].rows), [rosterQueryId]: new Set(snapshot.queries[rosterQueryId].rows) };
    assert.ok(blocks.length > 20);
    for (const {props} of blocks) {
      assert.ok(props.sourceRows.every(row=>rawSets[props.queryId].has(row)), `${props.id}: raw query grain`);
      assert.ok(props.sourceRows.every(row=>row.region==="EMEA" && row.product==="API"), `${props.id}: population`);
      if (props.chart) assert.equal(props.displayRows, props.children.props.rows, `${props.id}: editor/render rows`);
    }
    const block = id => blocks.find(node=>node.props.id===id).props;
    for (const id of ["performance-revenueUsd","revenue-mix","overview-products"]) {
      assert.ok(block(id).sourceRows.some(row=>row.date==="2026-06-22"), `${id}: prior evidence`);
      assert.ok(block(id).sourceRows.some(row=>row.date==="2026-08-16"), `${id}: current evidence`);
    }
    assert.ok(block("performance-netRevenueRetention").sourceRows.some(row=>row.date < "2026-06-22"));
    assert.ok(block("performance-account-history").sourceRows.every(row=>row.accountId===model.account.accountId));
    assert.ok(block("performance-activeAccounts").chart.stackable === false);
    assert.ok(block("adoption-active").chart.stackable === false);
    for (const tab of ["retention","adoption"]) {
      captured.length = 0;
      render(PerformanceSkeleton,{tab});
      assert.ok(captured.some(node=>node.props?.id===`loading-${tab}-heading`));
    }
  } finally { await server.close(); }
});

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), "data-example-contract-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("populated and opt-in blank starters preserve the runtime without copying sample evidence", async (t) => {
  const dir = temporary(t);
  const gallery = join(base, "examples/base-template");
  const { snapshot: gallerySnapshot } = await import(pathToFileURL(join(gallery, "data.js")));
  assert.deepEqual(gallerySnapshot, JSON.parse(readFileSync(join(base, "src/data.json"))),
    "The base gallery uses the canonical fixture, not a second dashboard snapshot");
  assert.match(readFileSync(join(gallery, "index.html"), "utf8"), /src="\.\.\/\.\.\/src\/main\.jsx"/u,
    "The base preview loads the real starter entrypoint, not a copied composition");
  for (const surface of ["dashboard", "report"]) for (const blank of [false, true]) {
    const output = join(dir, `${surface}-${blank ? "blank" : "default"}`);
    const result = await prepareDataApp({ output, blank, ...(surface === "report" ? { surface } : {}) });
    assert.deepEqual(result.documentation, {
      entryPoint: join(base, "docs/components/README.md"),
      copiedEntryPoint: join(output, "docs/components/README.md"),
    });
    assert.deepEqual(readFileSync(result.documentation.copiedEntryPoint), readFileSync(result.documentation.entryPoint),
      "New apps retain the component reference snapshot matching their copied source");
    const snapshot = JSON.parse(readFileSync(join(output, "src/data.json")));
    assert.deepEqual(snapshot.queries, {});
    assert.deepEqual(snapshot.filters, []);
    assert.equal(snapshot.surface, surface);
    assert.equal(snapshot.buildStatus, "creating");
    assert.equal(result.built, false);
    assert.equal(result.starter, blank ? "blank" : "base");
    assert.equal(result.needsAdaptation, blank ? undefined : true);
    if (blank) assert.equal(result.referenceOptions, undefined);
    else {
      assert.deepEqual(result.referenceOptions.map(({ id }) => id), catalog.examples.filter(entry => entry.status === "golden" && (entry.kind ?? "dashboard") === surface).map(({ id }) => id));
      for (const reference of result.referenceOptions) {
        assert.ok(reference.decision && reference.grain && reference.goodFit.length);
        assert.equal(reference.composition, catalog.examples.find(({ id }) => id === reference.id).composition);
        assert.ok(existsSync(reference.brief));
        assert.ok(existsSync(join(reference.content, surface, surface === "report" ? "ReportContent.jsx" : "DashboardContent.jsx")));
        assert.equal(reference.fixture, undefined, "Reference discovery must not supply fictional evidence");
      }
    }
    assert.equal(snapshot.status, "draft");
    assert.equal(readFileSync(join(output, "package-lock.json"), "utf8"), readFileSync(join(base, "package-lock.json"), "utf8"));
    assert.equal(readFileSync(join(output, "protected-runtime.json"), "utf8"), readFileSync(join(base, "protected-runtime.json"), "utf8"));
    const verified = spawnSync(process.execPath, ["scripts/verify-protected-runtime.mjs"], { cwd: output, encoding: "utf8" });
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    assert.ok(!existsSync(join(output, "examples")));
    assert.ok(!existsSync(join(output, "demos")), "The demo gallery must not ship inside authored apps");
    assert.equal(existsSync(join(output, "src/content/dashboard/dashboard-data.js")), surface === "dashboard" && !blank);
    const starterContent = join(plugin, "templates/data-app/starters", surface, "content");
    const contentSource = blank ? starterContent : join(base, "src/content");
    const entrypoint = join(surface, surface === "report" ? "ReportContent.jsx" : "DashboardContent.jsx");
    assert.equal(readFileSync(join(output, "src/content", entrypoint), "utf8"),
      readFileSync(join(contentSource, entrypoint), "utf8"));
    const inactive = surface === "report" ? "dashboard/DashboardContent.jsx" : "report/ReportContent.jsx";
    assert.equal(readFileSync(join(output, "src/content", inactive), "utf8"),
      readFileSync(join(starterContent, inactive), "utf8"), "Only the requested surface receives populated content");
  }
});

test("reviewed snapshots retain exact rows and sources but receive distinct new artifact identities", async (t) => {
  const dir = temporary(t);
  const input = join(dir, "reviewed.json");
  const data = { id: "do-not-reuse", buildStatus: "complete", title: "Inventory reconciliation", filters: [], queries: {
    inventory: { rows: [{ item: "Part A", counted: 7, recorded: 9 }], source: { label: "User supplied inventory", files: ["inventory.csv"] } },
  } };
  writeFileSync(input, JSON.stringify(data));
  const first = await prepareDataApp({ output: join(dir, "first"), snapshot: input });
  const second = await prepareDataApp({ output: join(dir, "second"), snapshot: input, fromReference: "product-tracker" });
  assert.notEqual(first.id, second.id);
  const actual = JSON.parse(readFileSync(join(first.output, "src/data.json")));
  assert.deepEqual(actual.queries, data.queries);
  assert.deepEqual(actual.filters, data.filters);
  assert.equal(actual.title, data.title);
  assert.notEqual(actual.id, data.id);
  assert.equal(actual.buildStatus, "creating");
  const adapted = JSON.parse(readFileSync(join(second.output, "src/data.json")));
  assert.deepEqual(adapted, { ...data, id: second.id, surface: "dashboard", buildStatus: "creating" });
  assert.equal(second.example, null);
  assert.equal(second.reference, "product-tracker");
  assert.equal(second.needsAdaptation, true);
  assert.equal(second.status, "authored");
  assert.deepEqual(JSON.parse(readFileSync(input)), data, "The input snapshot is not rewritten");
});

test("reviewed report preparation preserves provenance and starts a new app in progress", async (t) => {
  const dir = temporary(t);
  const input = join(dir, "report-evidence.json");
  const data = {
    id: "existing-dashboard", surface: "dashboard", title: "Inventory review", filters: [],
    generatedAt: "2026-08-25T12:00:00Z", report: { asOf: "2026-08-24" },
    queries: { inventory: {
      rows: [{ item: "Part A", counted: 0, recorded: 7 }, { item: "Part B", counted: null, recorded: 4 }],
      source: { label: "Reviewed inventory extract", files: ["inventory.csv"],
        sql: "select item, counted, recorded from reviewed_inventory", executedAt: "2026-08-25T11:00:00Z",
        caveats: ["A null count is unobserved, not zero."] },
    } },
  };
  writeFileSync(input, JSON.stringify(data));
  const first = await prepareDataApp({ output: join(dir, "report"), surface: "report", snapshot: input });
  const second = await prepareDataApp({ output: join(dir, "blank-report"), surface: "report", snapshot: input, blank: true });
  assert.notEqual(first.id, second.id);
  for (const result of [first, second]) {
    assert.match(result.id, /^report:[0-9a-f-]+$/u);
    assert.notEqual(result.id, data.id);
    const actual = JSON.parse(readFileSync(join(result.output, "src/data.json"), "utf8"));
    assert.deepEqual(actual, { ...data, id: result.id, surface: "report", buildStatus: "creating" },
      "No default fixture rows or unrelated metadata may enter reviewed report evidence");
  }
  assert.deepEqual(JSON.parse(readFileSync(input, "utf8")), data, "Report preparation leaves the input snapshot untouched");
});

test("reference adaptation never executes a fixture generator", async (t) => {
  const dir = temporary(t), root = join(dir, "catalog-root");
  for (const path of ["base", "examples/content/dashboard", "starters/dashboard/content/dashboard", "themes/codex-classic"]) mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, "examples/content/dashboard/DashboardContent.jsx"), "export default function DashboardContent() { return null; }");
  writeFileSync(join(root, "themes/codex-classic/theme.css"), ":root {}");
  writeFileSync(join(root, "examples/fixture.mjs"), 'throw new Error("Fixture must never execute during adaptation");');
  writeFileSync(join(root, "examples/resource.md"), "Reference");
  const entry = { ...catalog.examples[0], content: "content", fixture: "fixture.mjs", brief: "resource.md", contract: "resource.md", test: "resource.md" };
  writeFileSync(join(root, "examples/manifest.json"), JSON.stringify({ version: 1, examples: [entry] }));
  const snapshot = join(dir, "reviewed.json");
  writeFileSync(snapshot, JSON.stringify({ title: "Reviewed evidence", queries: { observed: { rows: [{ value: 0 }, { value: null }] } } }));
  const result = await prepareDataApp({ output: join(dir, "adapted"), fromReference: entry.id, snapshot, root });
  assert.deepEqual(JSON.parse(readFileSync(join(result.output, "src/data.json"))).queries, { observed: { rows: [{ value: 0 }, { value: null }] } });
  assert.ok(!existsSync(join(result.output, "examples")));
});

test("approved sample mode is explicit, isolated, and uses only the selected fixture", async (t) => {
  const dir = temporary(t);
  const entry = catalog.examples[0];
  await assert.rejects(() => prepareDataApp({ output: join(dir, "mixed"), example: entry.id, snapshot: "anything" }), /never both/);
  const preview = await prepareDataApp({ output: join(dir, "preview"), example: entry.id });
  const data = JSON.parse(readFileSync(join(preview.output, "src/data.json")));
  assert.equal(data.status, "fixture");
  assert.equal(data.buildStatus, "complete");
  assert.equal(data.id, `example:${entry.id}:r${entry.revision}`);
  assert.deepEqual(data.queries, (await readExampleFixture(entry)).queries);
  assert.ok(!existsSync(join(preview.output, "src/content/dashboard/dashboard-data.js")));
  const verified = spawnSync(process.execPath, ["scripts/verify-protected-runtime.mjs"], { cwd: preview.output, encoding: "utf8" });
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
});

test("every catalog reference prepares canonical content with isolated sample or reviewed data", async (t) => {
  const dir = temporary(t);
  const snapshot = join(dir, "reviewed.json"), reviewed = { title: "Reviewed dashboard", queries: { observations: { rows: [{ value: 7 }], source: { label: "Reviewed input" } } } };
  writeFileSync(snapshot, JSON.stringify(reviewed));
  for (const entry of catalog.examples) {
    const first = await readExampleFixture(entry), second = await readExampleFixture(entry);
    assert.deepEqual(first, second, `${entry.id}: deterministic fixture`);
    assert.notEqual(first, second, `${entry.id}: independent snapshot objects`);
    const output = join(dir, entry.id);
    const surface = entry.kind ?? "dashboard";
    const contentFile = join(surface, surface === "report" ? "ReportContent.jsx" : "DashboardContent.jsx");
    await prepareDataApp({ output, example: entry.id, surface });
    assert.deepEqual(JSON.parse(readFileSync(join(output,"src/data.json"))).queries, first.queries);
    assert.equal(readFileSync(join(output,"src/content",contentFile),"utf8"),
      readFileSync(join(examples,entry.content,contentFile),"utf8"));
    assert.ok(!existsSync(join(output,"examples")));
    assert.ok(!existsSync(join(output,"demos")));
    assert.ok(!existsSync(join(output,"fixtures")));
    const verified = spawnSync(process.execPath,["scripts/verify-protected-runtime.mjs"],{cwd:output,encoding:"utf8"});
    assert.equal(verified.status,0,`${entry.id}: ${verified.stdout}${verified.stderr}`);
    const adapted = await prepareDataApp({ output: join(dir, `${entry.id}-adapted`), fromReference: entry.id, snapshot, surface });
    assert.deepEqual(JSON.parse(readFileSync(join(adapted.output, "src/data.json"))).queries, reviewed.queries);
    assert.equal(readFileSync(join(adapted.output, "src/content", contentFile), "utf8"),
      readFileSync(join(examples, entry.content, contentFile), "utf8"));
    assert.equal(readFileSync(join(adapted.output, "protected-runtime.json"), "utf8"), readFileSync(join(base, "protected-runtime.json"), "utf8"));
    assert.ok(!existsSync(join(adapted.output, "fixtures")));
  }
});

test("preparation refuses existing outputs, source destinations, invalid snapshots, and unknown options", async (t) => {
  const dir = temporary(t);
  writeFileSync(join(dir, "keep.txt"), "User work");
  await assert.rejects(() => prepareDataApp({ output: dir }), /already exists/);
  assert.equal(readFileSync(join(dir, "keep.txt"), "utf8"), "User work");
  await assert.rejects(() => prepareDataApp({ output: join(plugin, "new-app") }), /outside the plugin/);
  await assert.rejects(() => prepareDataApp({ output: "relative" }), /absolute/);
  await assert.rejects(() => prepareDataApp({ output: join(dir, "unknown"), example: "unknown" }), /Unknown example/);
  await assert.rejects(() => prepareDataApp({ output: join(dir, "missing-snapshot"), fromReference: "product-tracker" }), /requires --snapshot/);
  await assert.rejects(() => prepareDataApp({ output: join(dir, "mixed-modes"), example: "product-tracker", fromReference: "product-tracker", snapshot: "anything" }), /never both/);
  await assert.rejects(() => prepareDataApp({ output: join(dir, "blank-example"), blank: true, example: "product-tracker" }), /never both/);
  await assert.rejects(() => prepareDataApp({ output: join(dir, "blank-reference"), blank: true, fromReference: "product-tracker", snapshot: "anything" }), /never both/);
  await assert.rejects(() => prepareDataApp({ output: join(dir, "draft-adaptation"), fromReference: "product-tracker", snapshot: "anything", allowDraft: true }), /requires --example/);
  const invalid = join(dir, "invalid.json");
  writeFileSync(invalid, "{}");
  await assert.rejects(() => prepareDataApp({ output: join(dir, "invalid-app"), snapshot: invalid }), /queries object/);
  assert.ok(!existsSync(join(dir, "invalid-app")));
  const reviewed = join(dir, "reviewed.json");
  writeFileSync(reviewed, JSON.stringify({ queries: { observed: { rows: [{ value: 42 }] } } }));
  const dashboardReference = catalog.examples.find(entry => (entry.kind ?? "dashboard") === "dashboard").id;
  for (const [name, options] of [
    ["invalid-surface", { surface: "spreadsheet" }],
    ["wrong-example-surface", { surface: "report", example: dashboardReference }],
    ["wrong-reference-surface", { surface: "report", fromReference: dashboardReference, snapshot: reviewed }],
  ]) {
    const output = join(dir, name);
    await assert.rejects(() => prepareDataApp({ output, ...options }), /surface|dashboard|report/iu);
    assert.equal(existsSync(output), false, `${name}: preflight failure must not create a partial app`);
  }
  assert.equal(readFileSync(join(dir, "keep.txt"), "utf8"), "User work");
  const cli = spawnSync(process.execPath, [join(plugin, "scripts/prepare-data-app.mjs"), "--force"], { cwd: dir, encoding: "utf8" });
  assert.notEqual(cli.status, 0);
});

test("CLI resolves bundled resources independently of the current working directory", async (t) => {
  const dir = temporary(t);
  const output = join(dir, "elsewhere");
  const cli = spawnSync(process.execPath, [join(plugin, "scripts/prepare-data-app.mjs"), "--output", output,
    "--example", "business-performance"], { cwd: dir, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).output, output);
  const actual = JSON.parse(readFileSync(join(output, "src/data.json")));
  assert.deepEqual(actual.queries, (await readExampleFixture(catalog.examples[0])).queries);
  const snapshot = join(dir, "reviewed.json");
  writeFileSync(snapshot, JSON.stringify({ queries: { observed: { rows: [{ value: 42 }] } } }));
  const adaptation = spawnSync(process.execPath, [join(plugin, "scripts/prepare-data-app.mjs"), "--output", join(dir, "adaptation"),
    "--from-reference", "product-tracker", "--snapshot", snapshot], { cwd: dir, encoding: "utf8" });
  assert.equal(adaptation.status, 0, adaptation.stderr);
  assert.equal(JSON.parse(adaptation.stdout).reference, "product-tracker");
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "adaptation/src/data.json"))).queries, { observed: { rows: [{ value: 42 }] } });
  const blank = spawnSync(process.execPath, [join(plugin, "scripts/prepare-data-app.mjs"), "--output", join(dir, "blank"),
    "--blank", "--surface", "report", "--snapshot", snapshot], { cwd: dir, encoding: "utf8" });
  assert.equal(blank.status, 0, blank.stderr);
  assert.equal(JSON.parse(blank.stdout).starter, "blank");
  const blankSnapshot = JSON.parse(readFileSync(join(dir, "blank/src/data.json")));
  assert.equal(blankSnapshot.surface, "report");
  assert.match(blankSnapshot.id, /^report:/u);
  assert.deepEqual(blankSnapshot.queries, { observed: { rows: [{ value: 42 }] } });
});

test("catalog traversal and duplicate identities fail closed, and output aliases cannot write into plugin source", async (t) => {
  const dir = temporary(t);
  mkdirSync(join(dir, "examples"));
  const manifest = join(dir, "examples/manifest.json");
  const entry = { ...catalog.examples[0], brief: "../../outside.md" };
  writeFileSync(manifest, JSON.stringify({ version: 1, examples: [entry] }));
  assert.throws(() => readCatalog(dir), /Invalid bundled path/);
  writeFileSync(join(dir, "examples/resource.txt"), "reference");
  const validPaths = { ...entry, brief: "resource.txt", contract: "resource.txt", content: ".", fixture: "resource.txt", test: "resource.txt" };
  writeFileSync(manifest, JSON.stringify({ version: 1, examples: [validPaths, validPaths] }));
  assert.throws(() => readCatalog(dir), /identity or status/);
  const saveEntry = changes => writeFileSync(manifest, JSON.stringify({ version: 1, examples: [{ ...validPaths, ...changes }] }));
  saveEntry({ status: "golden", review: { approvedBy: [] } });
  assert.throws(() => readCatalog(dir), /recorded review/);
  saveEntry({ status: "golden", review: { approvedBy: ["Reviewer"], approvedRevision: entry.revision - 1 } });
  assert.throws(() => readCatalog(dir), /current revision/);
  saveEntry({ status: "golden", review: { approvedBy: ["Reviewer"], approvedRevision: entry.revision } });
  assert.equal(readCatalog(dir).examples[0].status, "golden");
  for (const status of ["draft", "deprecated"]) {
    saveEntry({ status, review: { approvedBy: [] } });
    await assert.rejects(() => prepareDataApp({ output: join(dir, status), example: entry.id, root: dir }), /not approved/);
    await assert.rejects(() => prepareDataApp({ output: join(dir, `${status}-adapted`), fromReference: entry.id, snapshot: "anything", root: dir }), /not approved/);
    assert.ok(!existsSync(join(dir, status)));
  }
  symlinkSync(plugin, join(dir, "plugin-alias"), "dir");
  await assert.rejects(() => prepareDataApp({ output: join(dir, "plugin-alias/unwanted-project") }), /outside the plugin/);
  assert.ok(!existsSync(join(plugin, "unwanted-project")));
});
