// Canonical build and server-render checks, not browser/visual acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareDataApp, readCatalog } from "../scripts/prepare-data-app.mjs";
import { build } from "../templates/data-app/base/node_modules/vite/dist/node/index.js";
import { temporalAxisLayout } from "../templates/data-app/base/src/charting/chart-data-shape.js";

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(plugin, "templates/data-app/base");
// Compare our geometry with the exact point/band scale implementation used by Recharts.
const {scalePoint,scaleBand,scaleLinear} = createRequire(join(base,"package.json"))("victory-vendor/d3-scale");
const axisDates = Array.from({length:28},(_,index)=>new Date(Date.UTC(2026,6,20+index)).toISOString().slice(0,10));
for (const plotWidth of [100,160,240,350,550]) for (const mode of ["time","point","band"]) {
  const banded=mode==="band", continuous=mode==="time";
  const layout = temporalAxisLayout(axisDates,{plotWidth,leftRoom:34,rightRoom:14,banded,continuous,measureLabel:()=>46});
  const scale=(continuous ? scaleLinear() : banded ? scaleBand() : scalePoint())
    .domain(continuous ? [Date.parse(axisDates[0]),Date.parse(axisDates.at(-1))] : axisDates)
    .range([layout.padding.left,plotWidth-layout.padding.right]);
  for (const bounds of layout.bounds) {
    const coordinate = scale(bounds.value) + (banded ? scale.bandwidth()/2 : 0);
    assert.ok(Math.abs(coordinate-bounds.x)<1e-7,"Temporal layout coordinates must match the native Recharts scale");
    assert.ok(coordinate+23 <= plotWidth+14-4+1e-7,"Native endpoint text must fit inside the SVG");
  }
}
const temporary = mkdtempSync(join(tmpdir(), "data-examples-build-"));
const originalWindow = globalThis.window;
const originalLocation = globalThis.location;

function verifyBuild(project) {
  // All references, including Performance's local calculation Worker, use the
  // default offline build before any maintainer-only SSR dependencies are linked.
  assert.ok(!existsSync(join(project, "node_modules")));
  const build = runDataAppFixtureBuild(project, { pluginRoot: plugin });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const html = readFileSync(join(project, "dist/index.html"), "utf8");
  const hash = createHash("sha256").update(readFileSync(join(project, "src/data.json"))).digest("hex");
  assert.ok(html.includes(`content="${hash}"`), "Built snapshot hash matches reviewed data");
  assert.ok(!html.includes('src="/src/'), "Standalone entrypoint has no external source module");
  assert.ok(!readdirSync(join(project,"dist"),{recursive:true}).some(path => /\.m?js$/.test(path)), "Standalone worker code must stay embedded, not become an external script");
  for (const sample of ["usage_summary", "account_health", "Product adoption and engagement"]) {
    assert.ok(!html.includes(sample), `No original gallery leakage: ${sample}`);
  }
}

async function renderer(project, performance = false) {
  // Server rendering is maintainer-only; the customer build above had no dependencies.
  if (!existsSync(join(project, "node_modules"))) symlinkSync(join(base, "node_modules"), join(project, "node_modules"), "dir");
  const surface = JSON.parse(readFileSync(join(project, "src/data.json"), "utf8")).surface ?? "dashboard";
  const content = surface === "report" ? "ReportContent" : "DashboardContent";
  const entry = join(project, "render-test.jsx");
  writeFileSync(entry, `import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataAppShell } from "./src/DataAppShell.jsx";
import { ${content}${performance ? ", PerformanceBody" : ""} } from "./src/content/${surface}/${content}.jsx";
${performance ? `import { createPerformanceEngine } from "./src/content/dashboard/performance-data.js";
import { CohortTable, CohortTooltip } from "./src/content/dashboard/CohortTable.jsx";
import { DashboardAskProvider } from "./src/components/DashboardAsk.jsx";
export function renderCohort(cells, selectedCell) { return renderToStaticMarkup(<DashboardAskProvider enabled={false} explorationEnabled><CohortTable cells={cells} selectedCell={selectedCell} onSelect={()=>{}}/></DashboardAskProvider>); }
export function renderCohortHover(cell) { return renderToStaticMarkup(<CohortTooltip cell={cell}/>); }
export function renderLocalPending(snapshot, localChanges, tab, loadingAll = false) {
  const filters = Object.fromEntries(snapshot.filters.map(filter => [filter.id,filter.defaultValue]));
  const {model,deep} = createPerformanceEngine(snapshot.queries).read(filters);
  return renderToStaticMarkup(<DataAppShell snapshot={snapshot} hosted={true}><PerformanceBody initialView={{accountId:"account-05"}} tab={tab} compare={true} grain="week" dimension="region" setDimension={()=>{}} model={model} deep={deep} localChanges={localChanges} loadingAll={loadingAll}/></DataAppShell>);
}
` : ""}
import { ChartTooltip } from "./src/charting/ChartTooltip.jsx";
import { PinnedChartCard } from "./src/components/DashboardAsk.jsx";
import { SelectedChartRegion } from "./src/charting/SelectedChartRegion.jsx";
export function renderTooltip(props) { return renderToStaticMarkup(<ChartTooltip {...props}/>); }
export function renderSelectedRegion(region) { return renderToStaticMarkup(<SelectedChartRegion region={region}/>); }
export function renderPinned(props) { return renderToStaticMarkup(<PinnedChartCard hoverCard={{content:<ChartTooltip {...props}/>,width:280,height:90,radius:"12px",shadow:"none",background:"white"}} actions={[{label:"View revenue",onSelect:()=>{}}]} panelRef={{current:null}}/>); }
export function render(snapshot, presentation = {}, initialView = {}) {
  return renderToStaticMarkup(<DataAppShell snapshot={snapshot} hosted={true}
    initialPresentation={presentation}><${content} initialView={initialView} /></DataAppShell>);
}
`);
  await build({ configFile: false, root: project, logLevel: "error",
    build: { ssr: entry, outDir: join(project, "ssr"), emptyOutDir: true } });
  globalThis.location = new URL(pathToFileURL(join(project, "dist/index.html")));
  globalThis.window = { location: globalThis.location };
  const module = await import(pathToFileURL(join(project, "ssr/render-test.js")));
  return Object.assign(module.render,{tooltip:module.renderTooltip,localPending:module.renderLocalPending,pinned:module.renderPinned,selectedRegion:module.renderSelectedRegion,
    cohort:module.renderCohort,cohortHover:module.renderCohortHover});
}

function metricValue(markup, id) {
  const start = markup.indexOf(`data-component-id="${id}"`);
  assert.ok(start >= 0, `Metric ${id} is rendered`);
  return markup.slice(start).match(/class="metric-value data-metric-value">([^<]*)</)?.[1];
}

function sumRevenue(snapshot, scope = {}, start = "2026-07-20", end = "2026-08-16") {
  const total = snapshot.queries.account_daily_performance.rows.filter(row => row.date >= start && row.date <= end
    && Object.entries(scope).every(([field, value]) => row[field] === value)).reduce((sum, row) => sum + row.revenueUsd, 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(total);
}

try {
  const project = (await prepareDataApp({ output: join(temporary, "performance"), example: "business-performance", allowDraft: true })).output;
  verifyBuild(project);
  const render = await renderer(project, true);
  const snapshot = JSON.parse(readFileSync(join(project, "src/data.json")));
  const raw = snapshot.queries.account_daily_performance.rows;
  const currentRows = raw.filter(row => row.date >= "2026-07-20");
  const money = value => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",maximumFractionDigits:0}).format(value);
  const nrrAt = end => {
    const back = days => new Date(Date.parse(end)-days*86400000).toISOString().slice(0,10);
    const current = new Map(), previous = new Map();
    for(const row of raw.filter(row=>row.date>=back(55) && row.date<=end)) {
      const group = row.date>=back(27) ? current : previous;
      group.set(row.accountId,(group.get(row.accountId)??0)+row.revenueUsd);
    }
    const baseline=[...previous].filter(([,value])=>value>0);
    return baseline.reduce((sum,[id])=>sum+(current.get(id)??0),0)/baseline.reduce((sum,[,value])=>sum+value,0);
  };
  const expectedNrr = `${(nrrAt("2026-08-16")*100).toFixed(1)}%`;
  const nrrDelta = `${((nrrAt("2026-08-16")-nrrAt("2026-07-19"))*100).toFixed(1)} pp`;
  const accountTotals=Object.values(Object.groupBy(currentRows,row=>row.accountId)).map(rows=>({name:rows[0].account,revenue:rows.reduce((sum,row)=>sum+row.revenueUsd,0)}));
  const firstAccount=accountTotals.sort((a,b)=>b.revenue-a.revenue)[0].name;

  const tooltip = render.tooltip({active:true,label:"Jun 8",comparisonMode:true,
    baseField: field => field.replace(/^previous /,""), formatLabel:item => item.dataKey,
    payload:[{dataKey:"subscriptions",value:50,color:"blue"},{dataKey:"previous subscriptions",value:30,color:"blue"},
      {dataKey:"previous usage",value:5,color:"purple"}]});
  assert.ok(tooltip.includes("comparison-tooltip-row") && tooltip.includes("usage") && tooltip.includes("—"), "Hidden current series must not erase a visible prior series from the tooltip");
  const comparisonProps = {active:true,label:"Aug 4",vertical:true,payload:[{dataKey:"previousRevenue",name:"Previous",value:110},{dataKey:"revenue",name:"Current",value:104}]};
  const currentFirst = render.tooltip(comparisonProps);
  assert.ok(currentFirst.indexOf("Current") < currentFirst.indexOf("Previous"), "Comparison order stays current-first even when prior is larger");
  const pinned = render.pinned(comparisonProps);
  assert.ok(!pinned.includes(currentFirst) && !pinned.includes("chart-pinned-details") && !pinned.includes("110") && !pinned.includes("104")
    && pinned.includes('aria-label="Selected chart data"') && pinned.includes("View revenue"), "Selection replaces hover values with actions");
  const selectedPoint = render.selectedRegion({selectionType:"point",left:149.5,top:20,width:1,height:200,cursorStroke:"#ccc",
    points:[{x:0.5,y:50,radius:5,fill:"#d43da0",stroke:"white",strokeWidth:3},
      {x:0.5,y:100,radius:5,fill:"#eda0d0",stroke:"white",strokeWidth:3}]});
  assert.match(selectedPoint, /<svg class="dashboard-ask-selected-region is-point"[^>]*width:1px/u);
  assert.equal((selectedPoint.match(/<circle /gu) ?? []).length, 2);
  assert.match(selectedPoint, /<line x1="0.5" x2="0.5"/u);
  assert.ok(!selectedPoint.includes("<rect") && !selectedPoint.includes("is-band"), "Point selections never render a filled time band");
  assert.match(render.selectedRegion({selectionType:"mark",left:20,top:30,width:40,height:50}), /<div class="dashboard-ask-selected-region is-mark"/u,
    "Bar selections retain their existing mark geometry");
  const datedComparison = render.tooltip({active:true,label:"Jun 29",comparisonMode:true,
    baseField:field => field.replace(/^previous /,""), formatLabel:item => item.dataKey.startsWith("previous ") ? "Mar 30" : item.dataKey,
    payload:[{dataKey:"subscriptions",value:50},{dataKey:"previous subscriptions",value:30},{dataKey:"usage",value:10},{dataKey:"previous usage",value:5}]});
  assert.equal((datedComparison.match(/Jun 29/g) ?? []).length,1);
  assert.ok(datedComparison.includes("Mar 30") && !datedComparison.includes(">Current<") && !datedComparison.includes("<strong>"), "Comparison dates occupy one header row");
  const pendingSegment = render.localPending(snapshot,["dimension"],"revenue");
  assert.equal((pendingSegment.match(/class="component-skeleton"/g) ?? []).length,2);
  assert.ok(!pendingSegment.replace(/<[^>]*>/g,"").includes("Updating "), "Loading labels are accessible attributes, not visible body text");
  assert.equal(metricValue(pendingSegment,"revenue-revenueUsd"),sumRevenue(snapshot));
  assert.ok(pendingSegment.includes('data-component-id="revenue-mix"') && !pendingSegment.includes('class="bp-loading"'));
  const pendingAccount = render.localPending(snapshot,["accountId"],"customers");
  assert.equal((pendingAccount.match(/class="component-skeleton"/g) ?? []).length,6);
  assert.ok(pendingAccount.includes('data-component-id="performance-accounts"') && pendingAccount.includes('data-component-id="account-revenueUsd"'));
  assert.ok(!pendingAccount.match(/data-component-id="account-revenueUsd"[\s\S]*?<\/section>/)[0].includes('data-metric-value'), "Pending account values must not remain visible");
  const pendingGlobal = render.localPending(snapshot,[],"dashboard",true);
  assert.equal((pendingGlobal.match(/class="component-skeleton"/g) ?? []).length,6);
  assert.ok(!pendingGlobal.includes('data-metric-value') && !pendingGlobal.includes(sumRevenue(snapshot)), "Global loading retains structure, never previous-scope numbers");
  const initial = render(snapshot);
  assert.ok(initial.includes("bp-overview-canvas"));
  for (const [row,spacing] of [["overview:outcomes","none"],["overview:health","content"],["overview:drivers","content"]]) {
    assert.ok(initial.includes(`data-sortable-row="${row}" data-section-kind="content" data-section-spacing="${spacing}"`));
  }
  assert.ok(initial.includes("--sortable-item-min-span:3") && !initial.includes("--sortable-item-min-span:4"));
  assert.equal(metricValue(initial, "performance-revenueUsd"), sumRevenue(snapshot));
  assert.equal(metricValue(initial, "performance-activeAccounts"), String(new Set(currentRows.filter(row=>row.completedRuns>0).map(row=>row.accountId)).size));
  assert.equal(metricValue(initial, "performance-netRevenueRetention"), expectedNrr);
  assert.equal((initial.match(/data-component-id=/g) ?? []).length, 6);
  assert.ok(initial.includes('data-sortable-region="performance:canvas"'));
  assert.equal((initial.match(/filters filter-bar/g) ?? []).length, 1);
  assert.ok(initial.includes('data-performance-tab="dashboard"'));
  for (const label of ["Northstar business performance", "Product economics", "Account movers", "Current", "Previous"]) assert.ok(initial.includes(label), label);
  for (const category of ["Workspace", "Automations", "API"]) {
    const productRows = currentRows.filter(row => row.product === category);
    const revenue = productRows.reduce((sum, row) => sum + row.revenueUsd, 0);
    const profit = productRows.reduce((sum, row) => sum + row.revenueUsd - row.costUsd, 0);
    assert.ok(initial.includes(`${category}: ${money(revenue)} revenue, ${money(profit)} gross profit`),
      "Product economics exposes each product's reviewed revenue and profit, not obsolete mix labels");
  }
  const trendStart = initial.indexOf('data-component-id="performance-revenueUsd"');
  const trendEnd = initial.indexOf('data-component-id="performance-activeAccounts"');
  assert.ok(initial.includes('aria-label="Interval"'));
  assert.ok(!initial.slice(trendStart, trendEnd).includes('aria-label="Interval"'));
  for (const removed of ["Weekly business review", "View EMEA", "View Americas", "Choose an account",
    "Fictional B2B workflow platform", "Revenue Usd", "Previous Revenue Usd", "Explore chart data"]) assert.ok(!initial.includes(removed), removed);

  assert.ok(initial.includes('role="switch"') && initial.includes('aria-checked="true"'));
  assert.ok(initial.includes(nrrDelta));
  assert.equal((initial.match(/class="data-metric-chart"/g) ?? []).length, 4);
  assert.ok(!initial.includes("13 weeks"));
  const product = render(snapshot, { filters: { product: "Automations" } });
  assert.equal(metricValue(product, "performance-revenueUsd"), sumRevenue(snapshot, { product: "Automations" }));
  const revenue = render(snapshot, {}, { tab: "revenue", dimension: "region" });
  assert.equal(metricValue(revenue, "revenue-grossProfitUsd"), money(currentRows.reduce((sum,row)=>sum+row.revenueUsd-row.costUsd,0)));
  for (const label of ["Revenue bridge (USD)", "Movement detail", "Segment economics", "Financial history", "$0", "Reactivated", "Contraction", "Break down by"]) assert.ok(revenue.includes(label), label);
  assert.ok(!revenue.includes("Dashed lines = previous period") && !revenue.includes('aria-label="Toggle Previous period"'));
  const adoption = render(snapshot, {}, { tab: "adoption" });
  assert.ok(metricValue(adoption, "performance-activation").endsWith("%"));
  for (const label of ["Activation by signup period", "Product engagement", "Seat utilization by product"]) assert.ok(adoption.includes(label), label);
  const retention = render(snapshot, {}, { tab: "retention" });
  assert.ok(retention.includes('data-performance-tab="retention"'));
  assert.ok(!adoption.includes('data-component-id="performance-cohorts"'));
  assert.ok(!retention.includes('aria-label="Date range"') && !retention.includes('aria-label="Interval"'));
  assert.ok(retention.includes("Nov 2025"));
  assert.ok(retention.includes("bp-cohort-table") && !retention.includes("chart-fixed-row-labels"));
  assert.ok(retention.includes('<th scope="col">First paid</th><th scope="col">Customers</th>'));
  assert.ok(retention.includes('scope="col">Month 8') && retention.includes('scope="row">Nov 2025'));
  assert.ok(retention.includes("12 customers retained") && !retention.includes("n=18") && !retention.includes("chart-heatmap-value-chip"));
  assert.ok(retention.includes("not yet observed"));
  const cohortStart = retention.indexOf('class="bp-cohort-table"');
  const cohortMarkup = retention.slice(cohortStart,retention.indexOf("</table>",cohortStart));
  assert.ok(cohortMarkup.includes('aria-haspopup="dialog"') && !cohortMarkup.includes('aria-pressed="true"'),
    "Default customer detail must not imply an explicit cell selection");
  assert.ok(!cohortMarkup.includes(' title="'), "Custom hover content replaces the delayed native title tooltip");
  const matureCell = {cohort:"2025-11",cohortLabel:"Nov 2025",age:3,retentionRate:2/3,retainedAccounts:12,eligibleAccounts:18,cutoff:"2026-02-28",mature:true};
  const cellMarkup = render.cohort([matureCell,{...matureCell,age:4,mature:false,retentionRate:null}],matureCell);
  assert.equal((cellMarkup.match(/aria-pressed="true"/gu) ?? []).length,1);
  assert.equal((cellMarkup.match(/data-chart-mark/gu) ?? []).length,1,"Unobserved cells cannot open selection actions");
  const cohortHover = render.cohortHover(matureCell);
  assert.ok(cohortHover.includes("67%") && cohortHover.includes("12 of 18 customers") && cohortHover.includes("Feb 28, 2026"));
  assert.ok(!cohortHover.includes("Retention (%)") && !cohortHover.includes("n=18"));
  assert.ok(retention.includes('class="table-toolbar-controls"'));
  assert.ok(retention.includes('data-row-action="true"'));
  assert.ok(retention.indexOf('class="table-pagination"') < 0 || retention.includes("of 12 results"));
  const monthly = render(snapshot, { filters:{date:"2026-05-18..2026-08-16"} }, { grain:"month" });
  assert.equal(metricValue(monthly,"performance-revenueUsd"), sumRevenue(snapshot,{},"2026-05-18","2026-08-16"));
  assert.equal(metricValue(monthly,"performance-netRevenueRetention"), expectedNrr);
  const customers = render(snapshot, {}, { tab: "customers" });
  assert.ok(!customers.includes('data-component-id="customers-topFiveShare"'));
  assert.ok(customers.includes("Account detail") && customers.includes(firstAccount));
  assert.ok(customers.includes('data-component-id="performance-account-products"'));
  assert.ok(customers.indexOf('data-component-id="performance-accounts"') < customers.indexOf('data-component-id="customers-concentration"'));
  assert.ok(customers.includes('class="table-row-action"'));
  const regional = render(snapshot, { filters: { region: "Americas" } }, { tab: "customers", accountId: "account-05" });
  assert.equal(metricValue(regional, "account-revenueUsd"), sumRevenue(snapshot, { accountId: "account-05", region: "Americas" }));
  assert.ok(regional.includes("Elm Works"));
  const scopedAway = render(snapshot, { filters: { region: "APAC" } }, { tab: "customers", accountId: "account-05" });
  assert.ok(!scopedAway.includes("Elm Works"));
  const week = render(snapshot, { filters: { date: "2026-08-10..2026-08-16" } });
  assert.equal(metricValue(week, "performance-revenueUsd"), sumRevenue(snapshot, {}, "2026-08-10", "2026-08-16"));
  const noComparison = render(snapshot, {}, { tab: "revenue", compare: false });
  assert.ok(!noComparison.includes("Previous-period coverage is incomplete"));
  assert.equal(metricValue(noComparison, "revenue-revenueUsd"), sumRevenue(snapshot));
  const nrrWithoutComparison = render(snapshot, {}, { compare: false });
  assert.equal(metricValue(nrrWithoutComparison, "performance-netRevenueRetention"), expectedNrr);
  assert.ok(nrrWithoutComparison.includes("data-metric-chart") && !nrrWithoutComparison.includes(nrrDelta));
  const hidden = render(snapshot, { hiddenBlocks: ["performance-trend"] });
  assert.equal((hidden.match(/class="data-metric-chart"/g) ?? []).length, 3);
  assert.ok(hidden.includes('data-component-id="performance-revenueUsd"'));
  const hiddenMetric = render(snapshot, { hiddenBlocks: ["performance-revenueUsd"] });
  assert.ok(!hiddenMetric.includes('data-component-id="performance-revenueUsd"'));
  const edited = render(snapshot, { chartOverrides: { "performance-trend": {
    type: "line", x: "date", y: "currentValue", fields: ["currentValue", "previousValue"] } } });
  assert.ok(edited.includes("Current") && edited.includes("Previous") && !edited.includes("Revenue Usd"));

  const missing = structuredClone(snapshot);
  missing.queries.account_daily_performance.rows.find(row => row.date === "2026-08-10").completedRuns = null;
  assert.equal(metricValue(render(missing), "performance-activeAccounts"), "—");
  const zero = structuredClone(snapshot);
  for (const row of zero.queries.account_daily_performance.rows) row.completedRuns = 0;
  assert.equal(metricValue(render(zero), "performance-activeAccounts"), "0");
  const gap = structuredClone(snapshot);
  gap.queries.account_daily_performance.rows = gap.queries.account_daily_performance.rows.filter(row => row.date !== "2026-04-01");
  const gapMarkup = render(gap, {filters:{date:"2026-05-18..2026-08-16"}});
  assert.ok(!gapMarkup.includes("Previous-period coverage is incomplete"));
  assert.equal(metricValue(gapMarkup, "performance-netRevenueRetention"), expectedNrr, "unrelated April gap does not erase June-August NRR");
  assert.equal(metricValue(render(snapshot, { filters: { product: "Unavailable" } }), "performance-revenueUsd"), "—");

  // An independently authored, table-only composition proves starter/runtime
  // flexibility. It is NOT a fresh-model evaluation of reference selection.
  const input = join(temporary, "inventory.json");
  writeFileSync(input, JSON.stringify({ title: "Inventory reconciliation", filters: [], status: "fixture", queries: {
    inventory: { rows: [{ item: "Part A", recorded: 9, counted: 7, discrepancy: -2 }, { item: "Part B", recorded: 5, counted: 5, discrepancy: 0 }],
      source: { label: "Synthetic supplied inventory", files: ["inventory.csv"] } },
  } }));
  const scratch = (await prepareDataApp({ output: join(temporary, "scratch"), snapshot: input })).output;
  writeFileSync(join(scratch, "src/content/dashboard/DashboardContent.jsx"), `import React from "react";
import {DataComponent, DataTable, SortableRegion, SortableItem, useDataApp} from "../../data-app-public.jsx";
export function DashboardContent() {
  const {reviewedRows, visible} = useDataApp();
  const rows = reviewedRows("inventory");
  return <SortableRegion id="inventory:canvas" label="Inventory blocks" variant="canvas" spacing="standard"
    rows={[{id:"inventory:items",items:["inventory-table"]}]}>
    {visible("inventory-table") && <SortableItem id="inventory-table" kind="table" span={12} minSpan={6}>
      <DataComponent id="inventory-table" queryId="inventory" kind="table" title="Counted and recorded inventory"
        variant="card" sourceRows={rows} displayRows={rows}><DataTable rows={rows} /></DataComponent>
    </SortableItem>}
  </SortableRegion>;
}
`);
  verifyBuild(scratch);
  const scratchHtml = readFileSync(join(scratch, "dist/index.html"), "utf8");
  assert.ok(!scratchHtml.includes("account_daily_performance"));
  assert.ok(!scratchHtml.includes("Synthetic account-day business performance"));
  const renderScratch = await renderer(scratch);
  const table = renderScratch(JSON.parse(readFileSync(join(scratch, "src/data.json"))));
  assert.equal((table.match(/data-component-id=/g) ?? []).length, 1);
  assert.ok(table.includes("Part A") && table.includes("-2"));
  const report = (await prepareDataApp({ output: join(temporary, "inventory-report"), surface: "report", snapshot: input })).output;
  writeFileSync(join(report, "src/content/report/ReportContent.jsx"), `import React from "react";
import { DataComponent, DataTable, useDataApp } from "../../data-app-public.jsx";
export function ReportContent() {
  const { reviewedRows, appTitle } = useDataApp();
  const rows = reviewedRows("inventory");
  return <article aria-label="Inventory report">
    <h1>{appTitle}</h1>
    <DataComponent id="inventory-report-table" queryId="inventory" kind="table" title="Reviewed inventory findings"
      sourceRows={rows} displayRows={rows}><DataTable rows={rows} /></DataComponent>
  </article>;
}
`);
  verifyBuild(report);
  const reportSnapshot = JSON.parse(readFileSync(join(report, "src/data.json"), "utf8"));
  assert.deepEqual(reportSnapshot.queries, JSON.parse(readFileSync(input, "utf8")).queries,
    "The report artifact preserves the supplied rows and their provenance");
  const renderReport = await renderer(report);
  const reportMarkup = renderReport(reportSnapshot);
  assert.match(reportMarkup, /class="page report-page"/u, "Report preparation selects the report shell");
  assert.match(reportMarkup, /aria-label="Inventory report"/u);
  assert.ok(reportMarkup.includes("Part A") && reportMarkup.includes("-2"), "Reviewed report values render through public components");
  assert.equal((reportMarkup.match(/data-component-id=/g) ?? []).length, 1, "No sample report sections are seeded");

  const blankReport = (await prepareDataApp({ output: join(temporary, "blank-report"), surface: "report", blank: true })).output;
  verifyBuild(blankReport);
  const renderBlankReport = await renderer(blankReport);
  const blankReportMarkup = renderBlankReport(JSON.parse(readFileSync(join(blankReport, "src/data.json"), "utf8")));
  assert.match(blankReportMarkup, /class="page report-page"/u);
  assert.ok(!blankReportMarkup.includes("data-component-id="), "An opt-in blank report renders without invented evidence blocks");

  for (const entry of readCatalog().examples.filter(entry => entry.id !== "business-performance")) {
    const project = (await prepareDataApp({output:join(temporary,entry.id),example:entry.id,surface:entry.kind ?? "dashboard",allowDraft:true})).output;
    verifyBuild(project);
    const renderReference = await renderer(project);
    const markup = renderReference(JSON.parse(readFileSync(join(project,"src/data.json"))));
    assert.ok(markup.includes("data-component-id="),`${entry.id}: real data components render`);
    assert.ok(!markup.includes("performance-revenueUsd"),`${entry.id}: no unrelated performance composition`);
    if (entry.id === "product-tracker") {
      const componentIds = [...markup.matchAll(/data-component-id="([^"]+)"/g)].map(match => match[1]);
      assert.equal(componentIds[0], "product-growth", "The combined metric/chart panel leads Overview");
      assert.ok(markup.includes('aria-label="Product growth metric"') && markup.includes('role="tabpanel"'), "Metrics control one associated trend panel");
      assert.ok(componentIds.includes("product-feedback-flow"), "The roadmap feedback Sankey remains on Overview");
      assert.equal(componentIds.filter(id => id === "product-growth").length, 1, "The growth chart is not duplicated outside the combined panel");
    }
    if (entry.id === "fleet-operations") {
      assert.ok(markup.includes('data-component-id="delivery-progress"') && markup.includes('class="invoice-column"'),
        "Fleet keeps delivery progress and the invoice workspace together in its custom layout");
      assert.ok(markup.includes('class="receivables-summary">'), "Cash summary labels must not inherit zero-width proportional columns");
      assert.ok(readFileSync(join(project,"src/content/dashboard/example.css"),"utf8").includes("@container fleet-invoices"),
        "Invoice summary responds to its own pane width");
    }
    if (entry.id === "acme-workflow") {
      for (const heading of ["installs", "activation", "flow", "activity", "retention"])
        assert.ok(markup.includes(`id="${heading}-heading"`), "Acme keeps its complete lifecycle on one page");
      assert.ok(markup.includes('aria-label="Dashboard sections"'), "Shared section navigation remains available");
      assert.ok(markup.includes('aria-label="Dashboard settings"') && !markup.includes(">Debug<"), "Density control uses the settings entry point");
      assert.ok(!markup.includes('id="plugin-deep-dive-title"'), "Filter bar must not repeat the dashboard title");
      assert.ok(!markup.includes('class="filter-typeahead"'), "The small plugin choice set uses a normal dropdown");
      if (entry.id === "acme-workflow") {
        assert.match(markup, /Acme Cloud/);
        assert.match(markup, /Acme Studio/);
        assert.doesNotMatch(markup, /Codex|Data Analytics|mock\.plugin_/);
        const prepared = JSON.parse(readFileSync(join(project, "src/data.json")));
        assert.equal(prepared.id, `example:${entry.id}:r${entry.revision}`);
        assert.equal(prepared.queries.installs.rows[0].openingInstalledUsers, 1560);
      }
    }
  }
  // Alternate source entrypoints must load shell CSS too; SSR alone cannot detect
  // a closed theme drawer appearing as unstyled page content after an import move.
  for (const name of ["base-template", "component-lab", "main-report", "infrastructure-capacity", "acme-workflow", "fleet-operations", "finance", "business-performance", "neutral-starter", "product-tracker"]) {
    const outDir = join(temporary, `gallery-${name}`);
    await build({ root: base, configFile: join(base, "vite.config.js"), logLevel: "error",
      build: { outDir, emptyOutDir: true, rolldownOptions: { input: join(base, "examples", name, "index.html") } } });
    const html = readFileSync(join(outDir, "examples", name, "index.html"), "utf8");
    assert.match(html, /\.theme-drawer\{[^}]*max-height:0/u, `${name}: closed drawer has its actual CSS`);
    assert.match(html, /\.theme-appearance-trigger\{/u, `${name}: theme control styling is bundled`);
    assert.match(html, /\.source-preview-card/u, `${name}: source preview styling is bundled`);
  }
  console.log("PASS: Canonical reference/dashboard/report builds, snapshot integrity, source-entry shell styles and server-rendered states. Browser and fresh-model evaluation remain separate.");
} finally {
  globalThis.window = originalWindow;
  globalThis.location = originalLocation;
  rmSync(temporary, { recursive: true, force: true });
}
