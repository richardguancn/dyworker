import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { installDashboardBrowserMocks, resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { buildAnnotationExample as buildExample } from "../templates/data-app/base/examples/component-lab/chart-annotations/build.mjs";
import { buildContextualStories } from "../templates/data-app/base/examples/reports/contextual-stories/build.mjs";
import { annotationSnapshot, chartSpec } from "../templates/data-app/base/examples/component-lab/chart-annotations/fixture.mjs";

const allIds = chartSpec.annotations.map(({ id }) => id).sort();
const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const buildAnnotationExample = (surface) => buildExample(surface, { buildProject: runDataAppFixtureBuild });
const projects = [];
const errors = [];
let browser;

async function annotationIds(chart) {
  return chart.locator(".chart-annotation-note").evaluateAll((notes) =>
    notes.map((note) => note.getAttribute("data-annotation-note")).sort());
}

async function assertAnnotations(chart, expected, message, { print = false } = {}) {
  await chart.page().waitForFunction(({ ids }) => {
    const notes = [...document.querySelectorAll('[data-component-id="annotated-history"] .chart-annotation-note')];
    return JSON.stringify(notes.map((note) => note.getAttribute("data-annotation-note")).sort()) === JSON.stringify(ids);
  }, { ids: [...expected].sort() }).catch(async (error) => {
    throw new Error(`${message}: ${error.message}; rendered=${JSON.stringify(await annotationIds(chart))}; notes=${JSON.stringify(await chart.locator(".chart-annotation-note").allTextContents())}; browserErrors=${JSON.stringify(errors)}`);
  });
  assert.deepEqual(await annotationIds(chart), [...expected].sort(), message);
  const state = await chart.evaluate((node) => {
    const hidden = (element) => getComputedStyle(element).clipPath === "inset(50%)";
    return {
      labels: [...node.querySelectorAll(".chart-annotation-label")].map((label) => ({
        id: label.getAttribute("data-chart-annotation"), kind: label.getAttribute("data-annotation-kind"),
        role: label.getAttribute("role"), tabIndex: label.getAttribute("tabindex"),
        pointerEvents: getComputedStyle(label).pointerEvents,
        controls: label.querySelectorAll("rect,button,a,[role=button],[tabindex]").length,
      })),
      notes: [...node.querySelectorAll(".chart-annotation-note")].map((note) => ({
        id: note.getAttribute("data-annotation-note"), hidden: hidden(note), text: note.textContent,
      })),
    };
  });
  const placed = state.labels.map(({ id }) => id).sort();
  assert.equal(new Set(placed).size, placed.length, `${message}: each on-chart label has one stable identity`);
  for (const label of state.labels) {
    assert.ok(expected.includes(label.id), `${message}: labels cannot outlive their reviewed evidence`);
    assert.equal(label.kind, chartSpec.annotations.find(({ id }) => id === label.id).kind);
    assert.equal(label.role, null, `${message}: annotations are not buttons`);
    assert.equal(label.tabIndex, null, `${message}: annotations do not add keyboard stops`);
    assert.equal(label.pointerEvents, "none", `${message}: annotations do not intercept chart gestures`);
    assert.equal(label.controls, 0, `${message}: annotations contain plain text, not boxes or controls`);
  }
  if (print) {
    assert.ok(state.notes.every(({ hidden }) => !hidden), `${message}: print exposes every complete note`);
  } else {
    assert.deepEqual(state.notes.filter(({ hidden }) => hidden).map(({ id }) => id).sort(), placed,
      `${message}: only notes whose full text fits on the plot are visually hidden`);
    assert.deepEqual([...placed, ...state.notes.filter(({ hidden }) => !hidden).map(({ id }) => id)].sort(), [...expected].sort(),
      `${message}: every resolved annotation is readable on the plot or below it, exactly once`);
  }
  assert.equal(await chart.locator(".chart-annotation-badge,.chart-annotation-label-background,.chart-annotation-tooltip,[data-annotation-collapsed]").count(), 0,
    `${message}: no interactive or collapsed annotation treatment remains`);
}

async function openAction(page, chart, name) {
  await chart.getByRole("button", { name: "Daily account activity actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function waitForChartBounds(chart, viewportWidth) {
  await chart.page().waitForFunction(({ viewportWidth }) => {
    const chart = document.querySelector('[data-component-id="annotated-history"]');
    const container = chart?.querySelector(".recharts-responsive-container");
    const svg = chart?.querySelector(".recharts-surface");
    if (!container || !svg) return false;
    const parent = container.getBoundingClientRect();
    const bounds = svg.getBoundingClientRect();
    return parent.width > 0 && bounds.width > 0 && bounds.left >= -1 && bounds.right <= viewportWidth + 1
      && Math.abs(Number(svg.getAttribute("width")) - parent.width) <= 1
      && Math.abs(svg.viewBox.baseVal.width - parent.width) <= 1;
  }, { viewportWidth });
  await chart.evaluate(async (node) => {
    await document.fonts.ready;
    let previous;
    let stableFrames = 0;
    for (let frame = 0; frame < 120; frame++) {
      await new Promise(requestAnimationFrame);
      const values = [...node.querySelectorAll(".recharts-surface,.chart-annotation-label text,.chart-annotation-note")].map((element) => {
        const box = element.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height, getComputedStyle(element).clipPath];
      });
      const current = JSON.stringify(values);
      stableFrames = current === previous ? stableFrames + 1 : 0;
      if (stableFrames >= 2) return;
      previous = current;
    }
    throw new Error("Chart bounds did not settle after resize");
  });
}

async function assertLabelGeometry(chart, viewportWidth, message) {
  await waitForChartBounds(chart, viewportWidth);
  const labels = await chart.locator(".chart-annotation-label").evaluateAll((nodes) => {
    const rect = (node) => {
      const bounds = node.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    return nodes.map((node) => {
      const text = node.querySelector("text");
      const style = getComputedStyle(text);
      return { id: node.getAttribute("data-chart-annotation"),
        text: rect(text), textContent: text.textContent,
        fontSize: Number.parseFloat(style.fontSize), fontFamily: style.fontFamily,
        fontWeight: style.fontWeight, letterSpacing: style.letterSpacing };
    });
  });
  const plot = await chart.evaluate((node) => {
    const svg = node.querySelector(".recharts-surface");
    const mark = svg.querySelector(".recharts-cartesian-grid line");
    const x = Number(mark.getAttribute("x")), y = Number(mark.getAttribute("y"));
    const width = Number(mark.getAttribute("width")), height = Number(mark.getAttribute("height"));
    const a = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
    const b = new DOMPoint(x + width, y + height).matrixTransform(svg.getScreenCTM());
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  });
  for (const label of labels) {
    const { text } = label;
    const diagnostic = `${message}: ${JSON.stringify(label)}`;
    assert.ok(text.x >= Math.max(-1, plot.x - 1) && text.x + text.width <= Math.min(viewportWidth + 1, plot.x + plot.width + 1)
      && text.y >= plot.y - 1 && text.y + text.height <= plot.y + plot.height + 1,
    `Actual annotation glyphs fit inside the resized data plot, not an outer label band: ${diagnostic}`);
    assert.equal(label.fontSize, 14, `Plain annotation text uses 14px: ${diagnostic}`);
  }
  for (let index = 0; index < labels.length; index++) for (const other of labels.slice(index + 1)) {
    const a = labels[index].text;
    const b = other.text;
    assert.ok(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1
      || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1,
    `${message}: on-chart labels ${labels[index].id} and ${other.id} must not collide`);
  }
  const problems = await chart.evaluate((node) => {
    const problems = [];
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const svg = node.querySelector(".recharts-surface");
    const label = svg.querySelector(".chart-annotation-label text");
    const probe = document.createElement("span");
    probe.style.color = "var(--secondary)";
    node.append(probe);
    const secondary = getComputedStyle(probe).color;
    probe.remove();
    for (const note of node.querySelectorAll(".chart-annotation-note"))
      if (getComputedStyle(note).color !== secondary) problems.push("Annotation fallback does not use secondary text");
    if (label) {
      const color = getComputedStyle(label).fill;
      if (color !== secondary) problems.push("Annotation label does not use secondary text");
      for (const mark of svg.querySelectorAll("[data-annotation-arrow],.chart-annotation-mark--event line,.chart-annotation-mark--benchmark line,.chart-annotation-mark--point circle"))
        if (getComputedStyle(mark).stroke !== color) problems.push("Annotation text and connector colors differ");
      for (const band of svg.querySelectorAll(".chart-annotation-mark--range .recharts-reference-area-rect"))
        if (getComputedStyle(band).fill !== color) problems.push("Annotation text and period band hues differ");
      for (const text of svg.querySelectorAll(".chart-annotation-label text")) {
        const benchmark=text.closest('[data-annotation-kind="benchmark"]');
        const reference=svg.querySelector(".chart-annotation-mark--benchmark line")?.getBoundingClientRect();
        const edge=benchmark&&reference&&reference.width>reference.height;
        if (!(edge?["start","end"]:["start"]).includes(getComputedStyle(text).textAnchor))
          problems.push("Only a horizontal benchmark can use plot-edge text justification");
      }
    }
    for (const arrow of svg.querySelectorAll("[data-annotation-arrow]")) {
      const path=arrow.getAttribute("d");
      if ((path.match(/L/g) ?? []).length !== (path.includes("Q")?2:3))
        problems.push("Displaced annotation connector lacks its two-sided arrowhead");
    }
    for (const label of svg.querySelectorAll(".chart-annotation-label text")) {
      const box = label.getBoundingClientRect();
      for (const mark of svg.querySelectorAll(".recharts-bar-rectangle .recharts-rectangle,.recharts-line-dot,.recharts-area-dot,.recharts-label-list text,.chart-annotation-mark--event .recharts-reference-line-line,.chart-annotation-mark--benchmark .recharts-reference-line-line"))
        if (overlap(box, mark.getBoundingClientRect())) problems.push("Annotation covers a data mark");
      for (const area of svg.querySelectorAll(".recharts-area-area")) {
        const inverse = area.getScreenCTM().inverse();
        for (let x = box.left; x <= box.right; x += 2) for (let y = box.top; y <= box.bottom; y += 2)
          if (area.isPointInFill(new DOMPoint(x, y).matrixTransform(inverse))) problems.push("Annotation covers an actual area fill");
      }
      for (const path of svg.querySelectorAll(".recharts-line-curve,.recharts-area-curve")) {
        const length = path.getTotalLength();
        for (let at = 0; at < length + 2; at += 2) {
          const point = path.getPointAtLength(Math.min(at, length)).matrixTransform(path.getScreenCTM());
          if (point.x >= box.left - 2 && point.x <= box.right + 2 && point.y >= box.top - 2 && point.y <= box.bottom + 2)
            problems.push("Annotation covers a plotted curve");
        }
      }
    }
    for (const note of node.querySelectorAll(".chart-annotation-note")) {
      if (getComputedStyle(note).clipPath === "inset(50%)") continue;
      const box = note.getBoundingClientRect();
      if (box.left < -1 || box.right > innerWidth + 1 || note.scrollWidth > note.clientWidth + 1)
        problems.push("Full-text fallback overflows the viewport");
    }
    return problems;
  });
  assert.deepEqual(problems, [], `${message}: annotations preserve the painted evidence and readable fallback`);
}

function buildWideGlyphExample() {
  const example = buildAnnotationExample("report");
  projects.push(example.project);
  const labels = ["W".repeat(45), "ＷＷＷＷＷＷＷＷ", "Wide glyph comparison", "W".repeat(160)];
  const wideSpec = { ...chartSpec, legend: { position: "right" }, showXAxisLabel: true, xLabel: "Reviewed date",
    annotations: chartSpec.annotations.map((annotation, index) =>
    ({ ...annotation, label: labels[index] })) };
  // Change only this disposable project's authored module, never the default fixture.
  writeFileSync(join(example.project, "src/content/shared/chart-annotations/fixture.mjs"),
    `export const chartSpec = ${JSON.stringify(wideSpec)};\n`);
  const build = runDataAppFixtureBuild(example.project, { pluginRoot });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  return { ...example, wideSpec };
}

async function assertBarEdge(chart, horizontal, message) {
  await chart.locator("[data-annotation-arrow]").waitFor().catch(async(error)=>{
    throw new Error(`${message}: ${error.message}; labels=${JSON.stringify(await chart.locator('.chart-annotation-label').allTextContents())}; notes=${JSON.stringify(await chart.locator('.chart-annotation-note').allTextContents())}`);
  });
  assert.equal(await chart.locator(".chart-annotation-mark--point").count(),0,`${message}: no extra dot on a bar`);
  const result=await chart.evaluate((node,{horizontal})=>{
    const svg=node.querySelector(".recharts-surface");
    const bars=[...svg.querySelectorAll(".recharts-bar-rectangle .recharts-rectangle")];
    const arrow=svg.querySelector("[data-annotation-arrow]");
    const path=arrow.getAttribute("d");
    const shaft=path.split(" M ")[0].match(/-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/giu).map(Number);
    const [sx,sy]=shaft,[ex,ey]=shaft.slice(-2);
    const target=bars.reduce((largest,bar)=>bar.getBBox()[horizontal?"width":"height"]>
      largest.getBBox()[horizontal?"width":"height"]?bar:largest);
    const toLocal=(bar,p)=>new DOMPoint(p.x,p.y).matrixTransform(svg.getScreenCTM()).matrixTransform(bar.getScreenCTM().inverse());
    const end=toLocal(target,{x:ex,y:ey});
    let nearest=Infinity;
    for(let at=0;at<=target.getTotalLength()+0.25;at+=0.25){
      const p=target.getPointAtLength(Math.min(at,target.getTotalLength()));
      nearest=Math.min(nearest,Math.hypot(p.x-end.x,p.y-end.y));
    }
    let overlaps=0;
    for(let at=0;at<=arrow.getTotalLength()+0.5;at+=0.5){
      const p=arrow.getPointAtLength(Math.min(at,arrow.getTotalLength()));
      for(const bar of bars)if(bar.isPointInFill(toLocal(bar,p)))overlaps++;
    }
    return {nearest,inside:target.isPointInFill(end),overlaps,length:Math.hypot(ex-sx,ey-sy),path};
  },{horizontal});
  assert.ok(result.nearest>=5&&result.nearest<6.2,`${message}: tip has6px padding from the actual rounded outline of the reviewed peak bar: ${JSON.stringify(result)}`);
  assert.equal(result.inside,false,`${message}: arrowhead tip stays outside the fill`);
  assert.equal(result.overlaps,0,`${message}: shaft and arrowhead never cover a bar`);
  assert.ok(result.length>18,`${message}: the padded shaft retains room for its arrowhead`);
  assert.ok(result.path.includes("Q"),`${message}: the roomy bar example uses a gentle curve`);
}

async function verifyDualAxisAnnotations() {
  const example = buildAnnotationExample("report");
  projects.push(example.project);
  const dataPath = join(example.project, "src/data.json");
  const snapshot = JSON.parse(readFileSync(dataPath, "utf8"));
  snapshot.filters = [];
  snapshot.queries.annotation_history.rows = [0, 1, 2, 3].map((index) => ({
    date: `2026-08-0${index + 1}`, count: 100 + index * 50, amount: 10000 + index * 10000,
    rate: 0.2 + index * 0.2, countTarget: 300, amountTarget: 50000, rateTarget: 0.9,
    event: index === 1 ? "Reviewed change" : "",
  }));
  writeFileSync(dataPath, JSON.stringify(snapshot));
  writeFileSync(join(example.project, "src/content/report/ReportContent.jsx"), `
import React, { useState } from "react";
import { ChartRenderer, DataComponent, useDataApp } from "../../data-app-public.jsx";
export function ReportContent() {
  const { reviewedRows } = useDataApp();
  const [type, setType] = useState("line"), [ratio, setRatio] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true), [primary, setPrimary] = useState(false);
  const field = ratio ? "rate" : "amount";
  const rows = reviewedRows("annotation_history");
  const spec = { type, x: "date", y: "count", fields: ["count", field], showAnnotations,
    showXAxisLabel: false, showYAxisLabel: false, rightAxisFields: primary ? [] : [field],
    colors: { count: "#b24422", [field]: "#1255aa" }, annotations: [
      { id: "primary-target", kind: "benchmark", label: "Count target", field: "countTarget", measure: "count" },
      { id: "secondary-target", kind: "benchmark", label: "Other target", field: field + "Target", measure: field },
      { id: "secondary-point", kind: "point", label: "First observation", field, at: "2026-08-01" },
      { id: "dual-event", kind: "event", label: "Reviewed change", field: "event", at: "2026-08-02" },
      { id: "dual-range", kind: "range", label: "Reviewed period", at: "2026-08-01", end: "2026-08-03" },
    ] };
  return <article className="report-content">
    <select aria-label="Dual-axis geometry" value={type} onChange={event => setType(event.target.value)}>
      { ["line", "area", "bar", "horizontalBar"].map(value => <option key={value}>{value}</option>) }
    </select>
    <button onClick={() => setRatio(!ratio)}>Change units</button>
    <button onClick={() => setPrimary(!primary)}>Change axis</button>
    <button onClick={() => setShowAnnotations(!showAnnotations)}>Toggle annotations</button>
    <DataComponent id="annotated-history" title="Daily account activity" queryId="annotation_history" kind="chart" chart={spec}>
      <ChartRenderer spec={spec} rows={rows} height={300} />
    </DataComponent>
  </article>;
}`);
  const build = runDataAppFixtureBuild(example.project, { pluginRoot });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", (error) => errors.push(`dual axes: ${error.message}`));
  await installDashboardBrowserMocks(page);
  await page.goto(pathToFileURL(example.html).href);
  const chart = page.locator('[data-component-id="annotated-history"]');
  async function geometry(type) {
    await waitForChartBounds(chart, 1100);
    return chart.evaluate((node, type) => {
      const svg = node.querySelector(".recharts-surface");
      const point = svg.querySelector('circle[data-annotation-mark="secondary-point"]');
      const curve = svg.querySelector('.recharts-line-curve[stroke="#1255aa"], .recharts-area-curve[stroke="#1255aa"]');
      const expected = curve?.getPointAtLength(0);
      const reference = svg.querySelector('line[data-annotation-mark="secondary-target"]');
      const horizontal = type === "horizontalBar";
      const primaryTicks = [...svg.querySelectorAll(`text[orientation="${horizontal ? "bottom" : "left"}"]`)]
        .map((tick) => Number(tick.textContent.replaceAll(",", ""))).filter(Number.isFinite);
      return { point: point && { x: Number(point.getAttribute("cx")), y: Number(point.getAttribute("cy")) },
        expected: expected && { x: expected.x, y: expected.y }, reference: Boolean(reference), primaryTicks };
    }, type);
  }
  for (const type of ["line", "area"]) {
    await page.getByLabel("Dual-axis geometry").selectOption(type);
    for (const ratio of [false, true]) {
      if (ratio) await page.getByRole("button", { name: "Change units", exact: true }).click();
      let state = await geometry(type);
      assert.ok(state.point && state.expected && state.reference, `${type}: secondary numeric marks must render`);
      assert.ok(Math.hypot(state.point.x - state.expected.x, state.point.y - state.expected.y) < 1,
        `${type}: the secondary point must coincide with its series, not the primary scale: ${JSON.stringify(state)}`);
      assert.ok(state.primaryTicks.length > 1 && Math.max(...state.primaryTicks) < 1000,
        `${type}: secondary values and benchmarks cannot stretch the primary count domain`);
      await chart.getByRole("button", { name: "Toggle Count", exact: true }).click();
      state = await geometry(type);
      assert.ok(state.point && state.expected && Math.hypot(state.point.x - state.expected.x, state.point.y - state.expected.y) < 1,
        "Hiding the primary series does not rebind the remaining annotation to its empty axis");
      assert.equal(await chart.locator('[data-annotation-note="primary-target"]').count(), 0);
      assert.equal(await chart.locator('[data-annotation-note="dual-event"], [data-annotation-note="dual-range"]').count(), 2);
      await chart.getByRole("button", { name: "Toggle Count", exact: true }).click();
      await page.getByRole("button", { name: "Toggle annotations", exact: true }).click();
      assert.equal(await chart.locator(".chart-annotation-note, [data-annotation-mark]").count(), 0);
      await page.getByRole("button", { name: "Toggle annotations", exact: true }).click();
      if (ratio) await page.getByRole("button", { name: "Change units", exact: true }).click();
    }
  }
  for (const type of ["bar", "horizontalBar"]) {
    await page.getByLabel("Dual-axis geometry").selectOption(type);
    await chart.getByRole("button", { name: "Toggle Count", exact: true }).click();
    await waitForChartBounds(chart, 1100);
    assert.equal(await chart.locator('[data-annotation-note="secondary-point"]').count(), 1,
      "A single visible secondary bar retains its reviewed point evidence");
    assert.equal(await chart.locator('line[data-annotation-mark="secondary-target"]').count(), 1,
      `${type}: a secondary benchmark must render on its numeric axis`);
    await chart.getByRole("button", { name: "Toggle Count", exact: true }).click();
  }
  await page.getByLabel("Dual-axis geometry").selectOption("line");
  await page.getByRole("button", { name: "Change axis", exact: true }).click();
  const state = await geometry("line");
  assert.ok(state.point && state.expected && Math.hypot(state.point.x - state.expected.x, state.point.y - state.expected.y) < 1,
    "An explicit single-axis edit moves the annotation with its plotted series");
  await openAction(page, chart, "Copy as image");
  await page.waitForFunction(() => window.__dashboardClipboard.some((item) => item?.type === "image/png"));
  const copied = await page.evaluate(() => window.__dashboardClipboard.find((item) => item?.type === "image/png"));
  assert.match(copied.text.join(" "), /Other target.*50,000/u);
  await page.close();
}

async function verifySortableAnnotationStability() {
  const example = buildAnnotationExample("dashboard");
  projects.push(example.project);
  const dataPath = join(example.project, "src/data.json");
  const data = JSON.parse(readFileSync(dataPath, "utf8"));
  data.id = "chart-annotation-sortable-stability";
  data.title = "Congress after the election";
  data.filters = [];
  const source = { label: "Fixed 2024 election layout regression", caveats: ["Historical fixture, not current membership."] };
  data.queries = {
    house_results: { source, rows: [
      { party: "Republican", seats: 220, majorityThreshold: 218 },
      { party: "Democratic", seats: 215, majorityThreshold: 218 },
    ] },
    senate_results: { source, rows: [
      { party: "Republican", seats: 53, majorityThreshold: 51 },
      { party: "Democratic", seats: 45, majorityThreshold: 51 },
      { party: "Independent", seats: 2, majorityThreshold: 51 },
    ] },
  };
  writeFileSync(dataPath, JSON.stringify(data));
  writeFileSync(join(example.project, "src/content/dashboard/DashboardContent.jsx"), `
import React from "react";
import { EvidenceChart, SectionHeader, SortableItem, SortableRegion, useDataApp } from "../../data-app-public.jsx";
export function DashboardContent() {
  const { reviewedRows } = useDataApp();
  return <article>
    <SortableRegion id="annotation-stability" variant="canvas" spacing="standard" columns={12}
      label="Congress results" rows={[{ id: "congress", items: ["house-seats", "senate-seats"],
        header: <SectionHeader id="congress-heading" title="Congress after the election" /> }]}>
      {[["house", "House seats won", "218 for a majority"], ["senate", "Senate seats", "51 for a majority"]].map(([chamber, title, label]) => {
        const rows = reviewedRows(chamber + "_results");
        return <SortableItem key={chamber} id={chamber + "-seats"} label={title} kind="chart" span={6}>
          <EvidenceChart id={chamber + "-seats"} queryId={chamber + "_results"} title={title}
            variant="card" rows={rows} sourceRows={rows} height={220}
            spec={{ type: "horizontalBar", x: "party", y: "seats", showValues: true, valueDecimals: 0,
              showXAxisLabel: false, showYAxisLabel: false,
              colors: { Republican: "#c23c4d", Democratic: "#386ac9", Independent: "#8a909b" },
              annotations: [{ id: chamber + "-majority", kind: "benchmark", measure: "seats", field: "majorityThreshold", label }] }} />
        </SortableItem>;
      })}
    </SortableRegion>
  </article>;
}`);
  const build = runDataAppFixtureBuild(example.project, { pluginRoot });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", (error) => errors.push(`sortable annotation stability: ${error.message}`));
  await installDashboardBrowserMocks(page);
  await page.goto(pathToFileURL(example.html).href, { waitUntil: "load" });
  // Both cards can stretch to their row's height. A full-text note in one card
  // must not make its sibling alternate between inline and fallback placement.
  for (const width of [823, 1100, 1200, 1440, 900, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => {
      const charts = [...document.querySelectorAll('[data-sortable-row="congress"] [data-component-kind="chart"]')];
      return charts.length === 2 && charts.every((chart) => {
        const container = chart.querySelector(".recharts-responsive-container");
        const svg = chart.querySelector(".recharts-surface");
        return container && svg && container.getBoundingClientRect().width > 0
          && Math.abs(svg.viewBox.baseVal.width - container.getBoundingClientRect().width) < 1;
      });
    });
    const samples = await page.evaluate(async () => {
      await document.fonts.ready;
      const charts = [...document.querySelectorAll('[data-sortable-row="congress"] [data-component-kind="chart"]')];
      const rect = (node) => {
        const box = node.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 100) / 100);
      };
      const samples = [];
      for (let frame = 0; frame < 120; frame++) {
        await new Promise(requestAnimationFrame);
        if (frame < 30) continue;
        samples.push(charts.map((chart) => ({
          card: rect(chart), plot: rect(chart.querySelector(".recharts-responsive-container")),
          svg: chart.querySelector(".recharts-surface").getAttribute("viewBox"),
          labels: [...chart.querySelectorAll(".chart-annotation-label")].map((label) => ({
            id: label.dataset.chartAnnotation, rect: rect(label),
            text: [...label.querySelectorAll("tspan")].map((line) => line.textContent).join(" "),
          })),
          notes: [...chart.querySelectorAll(".chart-annotation-note")].map((note) => ({
            id: note.dataset.annotationNote, rect: rect(note), text: note.textContent,
            hidden: getComputedStyle(note).clipPath === "inset(50%)",
          })),
        })));
      }
      return samples;
    });
    const states = [...new Set(samples.map((sample) => JSON.stringify(sample)))];
    assert.equal(states.length, 1,
      `Equal-height annotated cards must stay settled throughout 90 frames at ${width}px: ${JSON.stringify(states.slice(0, 3))}`);
    const [house, senate] = samples.at(-1);
    assert.ok(Math.abs(house.card[1] - senate.card[1]) <= 1 && Math.abs(house.card[3] - senate.card[3]) <= 1,
      "The native two-column row retains aligned, equal-height cards");
    for (const [state, chamber, label] of [[house, "house", "218 for a majority"], [senate, "senate", "51 for a majority"]]) {
      assert.ok(state.plot[3] >= 219.99, "Stable plots preserve their authored minimum height while allowing row stretch");
      assert.ok(Math.abs(Number(state.svg.split(" ")[3]) - state.plot[3]) < 1,
        "The SVG catches up to its responsive plot instead of repeating one resize behind");
      assert.equal(state.notes.length, 1);
      assert.equal(state.notes[0].id, `${chamber}-majority`);
      assert.ok(state.notes[0].text.includes(label), "Fallback preserves the complete reviewed explanation");
      assert.equal(state.labels.length + Number(!state.notes[0].hidden), 1,
        "The complete explanation is visible exactly once, on the plot or below it");
      if (state.labels.length) {
        assert.equal(state.labels[0].id, `${chamber}-majority`);
        assert.equal(state.labels[0].text, label);
      }
    }
  }
  await page.close();
}

try {
  assert.deepEqual(annotationSnapshot("report").queries, annotationSnapshot("dashboard").queries,
    "The report and dashboard must use identical reviewed evidence");
  const reviewed = annotationSnapshot("report").queries.annotation_history.rows;
  assert.ok(reviewed[0].targetAccounts > Math.max(...reviewed.map((row) => row.repeatAccounts)),
    "The single-series bar fixture must exercise a benchmark above all plotted values");
  const examples = ["report", "dashboard"].map((surface) => {
    const example = buildAnnotationExample(surface);
    projects.push(example.project);
    return example;
  });
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  await verifyDualAxisAnnotations();
  await verifySortableAnnotationStability();

  for (const example of examples) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, colorScheme: "light" });
    page.on("pageerror", (error) => errors.push(`${example.surface}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${example.surface}: ${message.text()}`);
    });
    await installDashboardBrowserMocks(page);
    await page.addInitScript(() => {
      window.__annotationSvgExports = [];
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        if (blob.type.startsWith("image/svg+xml")) blob.text().then((text) => window.__annotationSvgExports.push(text));
        return create(blob);
      };
    });
    await page.goto(pathToFileURL(example.html).href, { waitUntil: "load" });
    const chart = page.locator('[data-component-id="annotated-history"]');
    await chart.locator(".recharts-surface").waitFor();
    await assertAnnotations(chart, allIds, `${example.surface}: complete evidence`);
    await assertLabelGeometry(chart, 1000, `${example.surface}: initial full labels`);
    assert.equal(Number(await chart.locator(".recharts-surface").getAttribute("height")), 300,
      "Annotations do not add a permanent outer band or change the authored chart height");
    assert.ok(await chart.locator(".chart-annotation-label").count() > 0,
      "A full label appears directly on a roomy chart");
    for (const note of await chart.locator(".chart-annotation-note").all()) {
      const id = await note.getAttribute("data-annotation-note");
      assert.ok((await note.textContent()).includes(chartSpec.annotations.find((annotation) => annotation.id === id).label),
        "The accessible note retains the complete authored label");
    }

    for (const geometry of ["line", "area", "bar", "horizontalBar"]) {
      await page.getByLabel("Chart geometry", { exact: true }).selectOption(geometry);
      await assertAnnotations(chart, allIds, `${example.surface}: ${geometry}`);
      await assertLabelGeometry(chart, 1000, `${example.surface}: ${geometry}`);
      if (["bar", "horizontalBar"].includes(geometry)) {
        assert.equal(await chart.locator(".chart-annotation-mark--point").count(),0,"Bar points do not add a dot");
        const line = chart.locator('.chart-annotation-mark--benchmark .recharts-reference-line-line');
        const lineBounds = await line.boundingBox();
        const plotBounds = await chart.locator(".recharts-surface").boundingBox();
        assert.ok(lineBounds && (lineBounds.width > 100 || lineBounds.height > 100)
          && lineBounds.x >= plotBounds.x - 1 && lineBounds.y >= plotBounds.y - 1
          && lineBounds.x + lineBounds.width <= plotBounds.x + plotBounds.width + 1
          && lineBounds.y + lineBounds.height <= plotBounds.y + plotBounds.height + 1,
        "An above-domain benchmark extends the value axis and retains a visible reference line");
      } else assert.equal(await chart.locator(".chart-annotation-mark--point circle").count(),1,
        "Line and area points retain their exact reviewed reference dot");
    }
    await page.getByLabel("Chart geometry", { exact: true }).selectOption("line");
    await waitForChartBounds(chart, 1000);
    await chart.locator(".recharts-surface").scrollIntoViewIfNeeded();
    const curvePoint = await chart.locator(".recharts-line-curve").first().evaluate((path) => {
      const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM());
      return { x: point.x, y: point.y };
    });
    await page.mouse.move(curvePoint.x, curvePoint.y);
    await chart.locator(".chart-tooltip").waitFor({ state: "visible" });
    assert.equal(await page.locator(".chart-annotation-tooltip").count(), 0,
      "Hover reveals ordinary data values without an annotation tooltip");
    await page.mouse.move(0, 0);
    await chart.getByRole("button", { name: /^Toggle Repeat accounts$/iu }).click();
    await assertAnnotations(chart, ["release", "review-window"], "Hiding a measure removes its point and benchmark annotations");
    await chart.getByRole("button", { name: /^Toggle Repeat accounts$/iu }).click();
    await assertAnnotations(chart, allIds, "Showing the reviewed series restores its annotation");

    await page.getByLabel("Example period", { exact: true }).selectOption("2026-08-01..2026-08-03");
    await assertAnnotations(chart, ["operating-target", "release"], "Missing point and range endpoints are omitted, not relocated");
    await page.getByLabel("Example period", { exact: true }).selectOption("2026-08-06..2026-08-08");
    await assertAnnotations(chart, ["operating-target", "repeat-peak"], "An event outside the filtered domain is omitted");
    await page.getByLabel("Example period", { exact: true }).selectOption("all");
    await assertAnnotations(chart, allIds, "Restoring evidence restores all four marks");

    const svg = chart.locator(".recharts-surface");
    await svg.scrollIntoViewIfNeeded();
    const plot = await svg.boundingBox();
    const tickX = (date) => chart.locator(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-label text")
      .filter({ hasText: new RegExp(`^${date}$`, "u") })
      .evaluate((node) => new DOMPoint(Number(node.getAttribute("x")), Number(node.getAttribute("y")))
        .matrixTransform(node.getScreenCTM()).x);
    await page.mouse.move(await tickX("Aug 1") + 1, plot.y + plot.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(await tickX("Aug 3"), plot.y + plot.height * 0.45, { steps: 8 });
    await page.mouse.up();
    const resetZoom = chart.getByRole("button", { name: "Reset zoom", exact: true });
    await resetZoom.waitFor();
    await assertAnnotations(chart, ["operating-target", "release"], "Real drag-to-zoom omits anchors outside its exact domain");
    await resetZoom.click();
    await assertAnnotations(chart, allIds, "Reset zoom restores reviewed annotation anchors");
    await waitForChartBounds(chart, 1000);
    const pointLabel = await chart.locator(".chart-annotation-label text").evaluateAll((labels) => {
      const boxes = labels.map((label) => {
        const { x, y, width, height } = label.getBoundingClientRect();
        return { x, y, width, height };
      });
      return boxes.sort((a, b) => b.x - a.x)[0];
    });
    assert.ok(pointLabel, "The drag regression includes actual on-chart annotation text");
    const restoredPlot = await svg.boundingBox();
    await page.mouse.move(await tickX("Aug 1") + 1, restoredPlot.y + restoredPlot.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(pointLabel.x + pointLabel.width / 2, restoredPlot.y + restoredPlot.height * 0.45, { steps: 8 });
    await page.mouse.move(pointLabel.x + pointLabel.width / 2, pointLabel.y + pointLabel.height / 2, { steps: 12 });
    await page.mouse.up();
    await resetZoom.waitFor();
    assert.equal(await resetZoom.isVisible(), true, "A chart drag ending on an annotation still completes zoom");
    await resetZoom.click();
    await assertAnnotations(chart, allIds, "Resetting a drag that ended on an annotation restores all anchors");

    await page.emulateMedia({ media: "print" });
    for (const note of await chart.locator(".chart-annotation-note").all()) {
      assert.equal(await note.isVisible(), true, "Annotation evidence remains visible when printing");
      for (const evidence of await note.locator("span").all())
        assert.notEqual(await evidence.evaluate((node) => getComputedStyle(node).clipPath), "inset(50%)",
          "Printed notes expose the exact source evidence, not just their label");
    }
    await assertAnnotations(chart, allIds, "Print retains chart labels and evidence", { print: true });
    await page.emulateMedia({ media: "screen" });

    await openAction(page, chart, "View data source");
    const source = page.getByRole("complementary", { name: "Data source for Daily account activity" });
    await source.getByText("Constant reviewed operating target for this synthetic period.", { exact: true }).waitFor();
    assert.ok((await source.innerText()).includes("Reviewed record of the fictional release"));
    await source.getByRole("tab", { name: "Data preview", exact: true }).click();
    assert.equal(await source.getByRole("columnheader", { name: /^Target accounts$/iu }).count(), 1);
    assert.equal(await source.getByRole("columnheader", { name: /^Release evidence$/iu }).count(), 1);
    await source.getByRole("button", { name: "Close data source", exact: true }).click();
    await source.waitFor({ state: "detached" });

    await openAction(page, chart, "Copy as image");
    await page.waitForFunction(() => window.__dashboardClipboard.some((item) => item?.type === "image/png"));
    const copied = await page.evaluate(() => window.__dashboardClipboard.find((item) => item?.type === "image/png"));
    assert.ok(copied.width > 0 && copied.height > 0, "The copied image is a real PNG");
    const copiedText = copied.text.join(" ");
    for (const { label } of chartSpec.annotations) assert.ok(copiedText.includes(label), `Copied image retains ${label}`);
    assert.match(copiedText, /target accounts.*120/iu, "Copied annotations retain benchmark evidence");
    assert.match(copiedText, /release evidence/iu, "Copied annotations retain event evidence");
    const arrows = await chart.locator("[data-annotation-arrow]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("d")));
    const exportedArrows = await page.evaluate(() => {
      const svg = new DOMParser().parseFromString(window.__annotationSvgExports.at(-1), "image/svg+xml");
      return [...svg.querySelectorAll("[data-annotation-arrow]")].map((node) => node.getAttribute("d"));
    });
    assert.deepEqual(exportedArrows, arrows, "PNG rasterizes the same arrow shafts and arrowheads as the figure");

    const noteColors = [];
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction((scheme) => document.documentElement.dataset.colorScheme === scheme, colorScheme);
      for (const width of [1000, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await waitForChartBounds(chart, width);
        await assertAnnotations(chart, allIds, `${example.surface}: ${colorScheme}, ${width}px`);
        await assertLabelGeometry(chart, width, `${example.surface}: ${colorScheme}, ${width}px`);
      }
      noteColors.push(await chart.locator(".chart-annotation-note").first().evaluate((node) => getComputedStyle(node).color));
    }
    assert.notEqual(noteColors[0], noteColors[1], "Annotation text follows the selected theme");

    await page.setViewportSize({ width: 1000, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await openAction(page, chart, "Edit chart");
    const editor = page.getByRole("dialog", { name: "Daily account activity", exact: true });
    const visibility = editor.getByRole("switch", { name: "Show annotations", exact: true });
    const preview = editor.locator(".explorer-chart-content");
    const waitForPreviewAnnotations = (visible) => page.waitForFunction(({ visible, count }) => {
      const preview = document.querySelector(".chart-editor-dialog .explorer-chart-content");
      return preview?.querySelector(".recharts-surface")
        && preview.querySelectorAll(".chart-annotation-note").length === (visible ? count : 0);
    }, { visible, count: allIds.length });
    await waitForPreviewAnnotations(true);
    assert.equal(await visibility.isChecked(), true, "Existing authored annotations default to visible");
    await visibility.click();
    await waitForPreviewAnnotations(false);
    assert.equal(await preview.locator(".chart-annotation-label,.chart-annotation-mark,[data-annotation-arrow]").count(), 0,
      "Hiding annotations removes labels, marks, ranges, arrows, and notes from the draft preview");
    await assertAnnotations(chart, allIds, "Unsaved visibility does not change the report or dashboard");
    await editor.getByRole("button", { name: "Undo chart change", exact: true }).click();
    await waitForPreviewAnnotations(true);
    assert.equal(await visibility.isChecked(), true);
    await editor.getByRole("button", { name: "Redo chart change", exact: true }).click();
    await waitForPreviewAnnotations(false);
    assert.equal(await visibility.isChecked(), false);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    await assertAnnotations(chart, allIds, "Cancel discards annotation visibility edits");

    await openAction(page, chart, "Edit chart");
    assert.equal(await visibility.isChecked(), true);
    await visibility.click();
    await waitForPreviewAnnotations(false);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    await assertAnnotations(chart, [], "Save hides all annotation kinds");
    await page.reload({ waitUntil: "load" });
    await chart.locator(".recharts-surface").waitFor();
    await assertAnnotations(chart, [], "Annotation visibility survives reload");
    assert.equal(await chart.locator(".chart-annotation-label,.chart-annotation-mark,[data-annotation-arrow]").count(), 0);
    await page.emulateMedia({ media: "print" });
    await assertAnnotations(chart, [], "Print respects hidden annotations", { print: true });
    await page.emulateMedia({ media: "screen" });
    await openAction(page, chart, "Copy as image");
    await page.waitForFunction(() => window.__dashboardClipboard.some((item) => item?.type === "image/png"));
    const hiddenImage = await page.evaluate(() => window.__dashboardClipboard.find((item) => item?.type === "image/png"));
    assert.ok(hiddenImage.width > 0 && hiddenImage.height > 0);
    for (const { label } of chartSpec.annotations) assert.ok(!hiddenImage.text.join(" ").includes(label),
      `Copied image omits hidden annotation: ${label}`);
    assert.equal(await page.evaluate(() => {
      const svg = new DOMParser().parseFromString(window.__annotationSvgExports.at(-1), "image/svg+xml");
      return svg.querySelectorAll(".chart-annotation-label,.chart-annotation-mark,[data-annotation-arrow]").length;
    }), 0, "Copied SVG does not retain hidden marks or arrows");

    await openAction(page, chart, "Edit chart");
    assert.equal(await visibility.isChecked(), false, "The off switch remains available on reopening");
    await visibility.click();
    await waitForPreviewAnnotations(true);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    await page.reload({ waitUntil: "load" });
    await assertAnnotations(chart, allIds, "Re-enabling restores every authored annotation after reload");
    await openAction(page, chart, "Edit chart");
    await editor.getByRole("button", { name: "Y axis", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /^Target accounts$/iu }).click();
    await editor.getByRole("button", { name: "Y axis", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /^Active accounts$/iu }).click();
    assert.equal(await chart.locator('.chart-annotation-note[data-annotation-note="operating-target"]').count(), 1,
      "An unsaved editor draft must not change the displayed chart");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    await assertAnnotations(chart, ["release", "review-window"], "Saving a new measure removes the old measure's benchmark and point");
    await page.getByLabel("Chart geometry", { exact: true }).selectOption("bar");
    await assertAnnotations(chart, ["release", "review-window"], "An explicit geometry choice does not reintroduce a removed measure");
    await page.reload({ waitUntil: "load" });
    await assertAnnotations(chart, ["release", "review-window"], "The saved chart edit and annotation omissions survive reload");
    assert.equal(await page.getByLabel("Chart geometry", { exact: true }).inputValue(), "line",
      "Reload restores the saved chart type rather than the temporary geometry demonstration");
    await openAction(page, chart, "Edit chart");
    await editor.getByRole("button", { name: "Y axis", exact: true }).waitFor();
    assert.match(await editor.getByRole("button", { name: "Y axis", exact: true }).innerText(), /active accounts/iu);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    await page.close();
  }

  // The area bounds cover almost the whole plot, but its low end leaves genuine
  // empty space. A bbox-only obstacle implementation would force this into notes.
  const slopeExample = buildAnnotationExample("report");
  projects.push(slopeExample.project);
  const slopeDataPath = join(slopeExample.project, "src/data.json");
  const slopeData = JSON.parse(readFileSync(slopeDataPath, "utf8"));
  const slope = [0, 4, 8, 20, 40, 60, 80, 100];
  slopeData.queries.annotation_history.rows.forEach((row, index) => { row.repeatAccounts = slope[index]; });
  writeFileSync(slopeDataPath, JSON.stringify(slopeData));
  const slopeSpec = { ...chartSpec, type: "area", y: "repeatAccounts", fields: ["repeatAccounts"],
    showLegend: false, annotations: chartSpec.annotations.filter(({ id }) => id === "release") };
  writeFileSync(join(slopeExample.project, "src/content/shared/chart-annotations/fixture.mjs"),
    `export const chartSpec = ${JSON.stringify(slopeSpec)};\n`);
  const slopeBuild = runDataAppFixtureBuild(slopeExample.project, { pluginRoot });
  assert.equal(slopeBuild.status, 0, `${slopeBuild.stdout}\n${slopeBuild.stderr}`);
  const slopePage = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  slopePage.on("pageerror", (error) => errors.push(`sloped area: ${error.message}`));
  await installDashboardBrowserMocks(slopePage);
  await slopePage.goto(pathToFileURL(slopeExample.html).href, { waitUntil: "load" });
  const slopeChart = slopePage.locator('[data-component-id="annotated-history"]');
  for (const width of [1000, 390]) {
    await slopePage.setViewportSize({ width, height: 800 });
    await assertAnnotations(slopeChart, ["release"], "Sloped area retains its contextual source");
    await assertLabelGeometry(slopeChart, width, "Sloped area uses actual empty plot space");
    assert.equal(await slopeChart.locator('.chart-annotation-label[data-chart-annotation="release"]').count(), 1,
      "The full label fits inside the empty part of the sloped area chart");
  }
  await slopePage.close();

  // A narrow closure band between high observations leaves room for a full
  // three-line note at its leading edge, but not at the default top inset.
  const closureExample = buildAnnotationExample("report");
  projects.push(closureExample.project);
  // Preserve the original curve pocket, not just the outer SVG width: temporal
  // endpoint containment now reserves about 10px inside the plot. Add that to
  // the original 720px figure plus the card's 24px padding and 1px borders.
  // Default-width and narrow layouts remain covered by the other scenarios.
  const closureStyles = join(closureExample.project, "src/content/report/report.css");
  writeFileSync(closureStyles, readFileSync(closureStyles, "utf8")
    + "\n.report-page { --data-app-layout-intent: authored-report; --data-app-content-width: 780px; }\n");
  const closureDataPath = join(closureExample.project, "src/data.json");
  const closureData = JSON.parse(readFileSync(closureDataPath, "utf8"));
  closureData.queries.annotation_history.rows = [142, 146, 151, 149, 153, 0, 0, 150, 154, 156, 152, 158]
    .map((activeAccounts, index) => ({ date: `2026-08-${String(index + 3).padStart(2, "0")}`, activeAccounts }));
  writeFileSync(closureDataPath, JSON.stringify(closureData));
  const closureSpec = { ...chartSpec, fields: ["activeAccounts"], yLabel: "Shipped orders", showLegend: false,
    annotations: [{ id: "review-window", kind: "range", at: "2026-08-08", end: "2026-08-09",
      label: "Warehouse closed for stock count" }] };
  writeFileSync(join(closureExample.project, "src/content/shared/chart-annotations/fixture.mjs"),
    `export const chartSpec = ${JSON.stringify(closureSpec)};\n`);
  const closureBuild = runDataAppFixtureBuild(closureExample.project, { pluginRoot });
  assert.equal(closureBuild.status, 0, `${closureBuild.stdout}\n${closureBuild.stderr}`);
  const closurePage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  closurePage.on("pageerror", (error) => errors.push(`closure range: ${error.message}`));
  await installDashboardBrowserMocks(closurePage);
  await closurePage.goto(pathToFileURL(closureExample.html).href, { waitUntil: "load" });
  const closureChart = closurePage.locator('[data-component-id="annotated-history"]');
  for (const colorScheme of ["light", "dark"]) {
    await closurePage.emulateMedia({ colorScheme });
    await closurePage.waitForFunction((scheme) => document.documentElement.dataset.colorScheme === scheme, colorScheme);
    for (const width of [1100, 390]) {
      await closurePage.setViewportSize({ width, height: 900 });
      await assertAnnotations(closureChart, ["review-window"], "Closure range retains its full context");
      await assertLabelGeometry(closureChart, width, "Closure label avoids the rising curve");
      if (width === 1100) {
        const placement = await closureChart.evaluate((node) => {
          const band = node.querySelector(".chart-annotation-mark--range path").getBoundingClientRect();
          const text = node.querySelector(".chart-annotation-label text");
          return { inset: text.getBoundingClientRect().left - band.left,
            lines: [...text.querySelectorAll("tspan")].map((line) => line.textContent) };
        });
        assert.ok(Math.abs(placement.inset - 12) < 1, `Closure text starts inside the shaded leading edge: ${JSON.stringify(placement)}`);
        assert.equal(placement.lines.join(" "), closureSpec.annotations[0].label);
      }
    }
  }
  await closurePage.close();

  // These labels must explain their own category/threshold, not merely find
  // empty pixels somewhere on the chart. All rows below are synthetic fixtures.
  for(const scenario of["supplier","capacity","focused-axis"]){
    const supplier=scenario==="supplier",focused=scenario==="focused-axis",example=buildAnnotationExample("report");projects.push(example.project);
    const dataPath=join(example.project,"src/data.json"),data=JSON.parse(readFileSync(dataPath,"utf8"));
    // Mesa's complete note needs room beyond its bar. With an exact maximum
    // of 10, the remaining 20% cannot fit it plus the protected arrow clearance;
    // the correct behavior there is the note fallback tested at narrow widths.
    data.queries.annotation_history.rows=supplier
      ?["North","Harbor","Mesa","Cedar"].map((date,index)=>({date,quotedDays:[4,6,8,12][index]}))
      :[160,174,176,180,185,186,194,188].map((proposedParcels,index)=>({date:`2026-08-${index+24}`,
        proposedParcels:focused&&[2,4,7].includes(index)?[null,undefined,null][[2,4,7].indexOf(index)]:proposedParcels,
        reservedParcels:focused?190:180,...(focused?{secondaryAmount:index%2?1e6:-2e6}:{})}));
    writeFileSync(dataPath,JSON.stringify(data));
    const annotation=supplier
      ?{id:"repeat-peak",kind:"point",at:"Mesa",field:"quotedDays",label:"Mesa’s quote excludes final-mile delivery."}
      :{id:"operating-target",kind:"benchmark",field:"reservedParcels",measure:"proposedParcels",label:`Above ${focused?190:180} parcels/day requires written approval.`};
    const measure=supplier?"quotedDays":"proposedParcels";
    const spec={...chartSpec,type:supplier?"horizontalBar":focused?"line":"bar",y:measure,
      fields:focused?[measure,"secondaryAmount"]:[measure],...(focused?{barFields:["secondaryAmount"],startAtZero:false}:{}),showLegend:false,
      showXAxisLabel:false,showYAxisLabel:false,annotations:[annotation]};
    writeFileSync(join(example.project,"src/content/shared/chart-annotations/fixture.mjs"),`export const chartSpec=${JSON.stringify(spec)};\n`);
    const composition=join(example.project,"src/content/shared/chart-annotations/SharedAnnotationExample.jsx");
    writeFileSync(composition,readFileSync(composition,"utf8").replace("height={300}","height={260}"));
    const build=runDataAppFixtureBuild(example.project,{pluginRoot});
    assert.equal(build.status,0,`${build.stdout}\n${build.stderr}`);
    const page=await browser.newPage({viewport:{width:1100,height:900}});
    page.on("pageerror",error=>errors.push(`${scenario} association: ${error.message}`));
    await installDashboardBrowserMocks(page);await page.goto(pathToFileURL(example.html).href,{waitUntil:"load"});
    const chart=page.locator('[data-component-id="annotated-history"]');
    for(const colorScheme of["light","dark"])for(const width of[1100,390]){
      await page.emulateMedia({colorScheme});await page.setViewportSize({width,height:900});
      await assertAnnotations(chart,[annotation.id],`${scenario}: reviewed identity survives resize`);
      await assertLabelGeometry(chart,width,`${scenario}: readable text avoids painted evidence`);
      const state=await chart.evaluate((node)=>{
        const text=node.querySelector(".chart-annotation-label"),box=text?.getBoundingClientRect();
        const bars=[...node.querySelectorAll(".recharts-bar-rectangle .recharts-rectangle")].map(bar=>bar.getBoundingClientRect());
        const line=node.querySelector(".chart-annotation-mark--benchmark line")?.getBoundingClientRect();
        const arrow=node.querySelector("[data-annotation-arrow]");
        const numbers=arrow?.getAttribute("d").split(" M ")[0].match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/giu)?.map(Number);
        const end=numbers&&new DOMPoint(numbers.at(-2),numbers.at(-1)).matrixTransform(arrow.getScreenCTM());
        const start=numbers&&new DOMPoint(numbers[0],numbers[1]).matrixTransform(arrow.getScreenCTM());
        const note=node.querySelector(".chart-annotation-note");
        return{label:box&&{x:box.x,y:box.y,width:box.width,height:box.height},
          text:text?.textContent,bars:bars.map(bar=>({x:bar.x,y:bar.y,width:bar.width,height:bar.height})),
          textAnchor:text?.querySelector("text")?.getAttribute("text-anchor"),
          lines:[...(text?.querySelectorAll("tspan")??[])].map(span=>{const bounds=span.getBoundingClientRect();
            return{x:bounds.x,right:bounds.right,width:bounds.width,anchor:span.getAttribute("x")};}),
          line:line&&{x:line.x,y:line.y,width:line.width},end:end&&{x:end.x,y:end.y},start:start&&{x:start.x,y:start.y},
          ticks:[...(node.querySelector(".recharts-yAxis-tick-labels")?.querySelectorAll(".recharts-cartesian-axis-tick-value")??[])].map(tick=>tick.textContent),
          hidden:getComputedStyle(note).clipPath==="inset(50%)",note:note.textContent,
          height:node.querySelector(".recharts-responsive-container").getBoundingClientRect().height};
      });
      assert.equal(state.height,260,"Explanation placement never changes authored chart height");
      if(!supplier){
        assert.ok(state.ticks.length&&state.ticks.every(value=>Number.isInteger(Number(value))),`The padded axis uses readable whole-number ticks: ${JSON.stringify(state.ticks)}`);
        if(focused)assert.ok(state.ticks.every(value=>Number(value)>=160&&Number(value)<=250),
          "Missing primary values and million-scale secondary bars cannot become zero or distort the focused primary domain");
      }
      if(width===1100)assert.ok(state.label,`${scenario}: default desktop context stays on chart: ${JSON.stringify(state)}`);
      if(supplier&&state.label){
        const target=state.bars[2],center=state.label.y+state.label.height/2;
        assert.ok(center>=target.y&&center<=target.y+target.height,`Mesa's note stays on Mesa's row: ${JSON.stringify(state)}`);
        assert.ok(state.label.x>=target.x+target.width+4,"Use available space beyond Mesa, not above Harbor");
        assert.ok(state.end&&state.end.y>=target.y&&state.end.y<=target.y+target.height);
        assert.ok(Math.abs(state.end.x-target.x-target.width-6)<1,"The label points to the real Mesa edge with padding");
        assert.ok(Math.abs(state.label.x-state.start.x-6)<1,"The shaft also leaves breathing room beside Mesa's text");
      }else if(!supplier&&state.label){
        assert.ok(state.line,"Keep the reviewed 180-parcel reference line");
        assert.ok(["start","end"].includes(state.textAnchor));
        const edge=state.textAnchor==="end"?state.line.x+state.line.width:state.line.x;
        assert.ok(state.lines.every(line=>Math.abs((state.textAnchor==="end"?line.right:line.x)-edge)<1.5),
          `Every unequal line is flush with its justified plot edge: ${JSON.stringify(state)}`);
        assert.equal(new Set(state.lines.map(line=>line.anchor)).size,1,"All wrapped lines share the same SVG text edge");
        if(width===1100&&!focused){
          assert.equal(state.textAnchor,"end","The clear right edge is the default benchmark placement");
          assert.ok(Math.max(...state.lines.map(line=>line.width))-Math.min(...state.lines.map(line=>line.width))>1,
            "The browser fixture must exercise unequal line widths, not merely box alignment");
        }
        assert.ok(state.end?Math.abs(state.end.y-state.line.y)<1
          :Math.min(Math.abs(state.label.y-state.line.y),Math.abs(state.label.y+state.label.height-state.line.y))<=24,
          `Benchmark context stays next to or explicitly connected to its line: ${JSON.stringify(state)}`);
      }else{
        assert.equal(state.hidden,false,"A narrow chart uses a visible full note, never misleading placement");
        assert.ok(state.note.includes(annotation.label),"The fallback names Mesa or the exact180-parcel threshold");
      }
    }
    if (supplier) {
      await page.setViewportSize({ width: 1100, height: 900 });
      await openAction(page, chart, "Edit chart");
      const editor = page.getByRole("dialog", { name: "Daily account activity", exact: true });
      const arrow = editor.locator('[data-annotation-arrow="repeat-peak"]');
      const label = editor.locator('[data-chart-annotation="repeat-peak"]');
      await arrow.waitFor();
      assert.equal(await label.count(), 1, "The bar annotation starts inside the editor plot");
      const visibility = editor.getByRole("switch", { name: "Show annotations", exact: true });
      await visibility.click();
      await arrow.waitFor({ state: "detached" });
      await visibility.click();
      await arrow.waitFor();
      assert.equal(await label.count(), 1,
        "Restoring a bar annotation measures its portal again instead of leaving it in fallback notes");
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    await page.close();
  }

  for(const sign of[1,-1,0]) {
    const example=buildAnnotationExample("report");projects.push(example.project);
    const dataPath=join(example.project,"src/data.json");
    const data=JSON.parse(readFileSync(dataPath,"utf8"));
    data.queries.annotation_history.rows=[12000,12500,37200,13200,12900,13400]
      .map((value,index)=>({date:`2026-08-0${index+1}`,netAdjustment:sign*value}));
    writeFileSync(dataPath,JSON.stringify(data));
    const spec={...chartSpec,type:"bar",y:"netAdjustment",fields:["netAdjustment"],showLegend:false,
      annotations:[{id:"repeat-peak",kind:"point",at:"2026-08-03",field:"netAdjustment",label:"Catch-up adjustment posted"}]};
    writeFileSync(join(example.project,"src/content/shared/chart-annotations/fixture.mjs"),`export const chartSpec=${JSON.stringify(spec)};\n`);
    const built=runDataAppFixtureBuild(example.project,{pluginRoot});
    assert.equal(built.status,0,`${built.stdout}\n${built.stderr}`);
    const page=await browser.newPage({viewport:{width:1100,height:900}});
    page.on("pageerror",error=>errors.push(`signed bar edge: ${error.message}`));
    await installDashboardBrowserMocks(page);await page.goto(pathToFileURL(example.html).href,{waitUntil:"load"});
    const chart=page.locator('[data-component-id="annotated-history"]');
    for(const geometry of["bar","horizontalBar"]){
      await page.getByLabel("Chart geometry",{exact:true}).selectOption(geometry);
      for(const colorScheme of["light","dark"])for(const width of[1100,390]){
        await page.emulateMedia({colorScheme});await page.setViewportSize({width,height:900});
        await assertAnnotations(chart,["repeat-peak"],`${sign}: ${geometry} retains source evidence`);
        await assertLabelGeometry(chart,width,`${sign}: ${geometry} preserves painted bars`);
        const labelCount=await chart.locator(".chart-annotation-label").count();
        assert.equal(labelCount,await chart.locator("[data-annotation-arrow]").count(),
          "A bar point without a resolved connector must be a visible full note, never floating text near another bar");
        if(sign!==0&&(geometry==="bar"&&width===1100||labelCount))await assertBarEdge(chart,geometry==="horizontalBar",`${sign}: ${geometry} ${colorScheme}${width}`);
        if(sign!==0&&!labelCount)assert.notEqual(await chart.locator(".chart-annotation-note").evaluate(node=>getComputedStyle(node).clipPath),"inset(50%)",
          "A full-width horizontal bar uses its readable note when its own row has no text space");
        if(sign===0)assert.equal(labelCount,0,"Zero-height bars have no visible fill edge to attach to");
      }
    }
    await page.close();
  }
  const billing=buildContextualStories({buildProject:runDataAppFixtureBuild});projects.push(billing.project);
  const billingPage=await browser.newPage({viewport:{width:1100,height:900}});
  billingPage.on("pageerror",error=>errors.push(`contextual billing edge: ${error.message}`));
  await installDashboardBrowserMocks(billingPage);await billingPage.goto(pathToFileURL(billing.html).href,{waitUntil:"load"});
  const billingChart=billingPage.locator('[data-component-id="context-adjustment-chart"]');
  for(const colorScheme of["light","dark"])for(const width of[1100,390]){
    await billingPage.emulateMedia({colorScheme});await billingPage.setViewportSize({width,height:900});
    await billingPage.evaluate(async()=>{for(let frame=0;frame<8;frame++)await new Promise(requestAnimationFrame);});
    const labels=await billingChart.locator(".chart-annotation-label").count();
    assert.equal(labels,await billingChart.locator("[data-annotation-arrow]").count(),"Billing context cannot become floating text after resize or theme replacement");
    if(width===1100||labels)await assertBarEdge(billingChart,false,`Actual contextual billing example ${colorScheme}${width}`);
    else assert.notEqual(await billingChart.locator(".chart-annotation-note").evaluate(node=>getComputedStyle(node).clipPath),"inset(50%)",
      "Narrow layouts retain the full visible billing note when no connector fits");
  }
  await billingPage.close();

  const wideExample = buildWideGlyphExample();
  const widePage = await browser.newPage({ viewport: { width: 1000, height: 800 }, colorScheme: "light" });
  widePage.on("pageerror", (error) => errors.push(`wide glyphs: ${error.message}`));
  widePage.on("console", (message) => {
    if (message.type() === "error") errors.push(`wide glyphs: ${message.text()}`);
  });
  await installDashboardBrowserMocks(widePage);
  await widePage.goto(pathToFileURL(wideExample.html).href, { waitUntil: "load" });
  const wideChart = widePage.locator('[data-component-id="annotated-history"]');
  await assertAnnotations(wideChart, allIds, "Wide-glyph reviewed labels");
  await assertLabelGeometry(wideChart, 1000, "Wide-glyph desktop labels");
  assert.ok(await wideChart.locator(".chart-annotation-label").count() > 0,
    "The wide-glyph fixture exercises full on-chart text as well as fallback notes");
  const desktopIds = await wideChart.locator(".chart-annotation-label").evaluateAll((labels) =>
    labels.map((label) => label.getAttribute("data-chart-annotation")));
  const longNote = wideChart.locator('.chart-annotation-note[data-annotation-note="repeat-peak"]');
  const assertLongFallback = async () => {
    assert.notEqual(await longNote.evaluate((node) => getComputedStyle(node).clipPath), "inset(50%)",
      "A label that cannot fit remains readable without hover or a numbered marker");
    assert.ok((await longNote.textContent()).includes(wideExample.wideSpec.annotations[3].label),
      "Fallback preserves the entire long label without ellipsis");
    const note = await longNote.boundingBox();
    const footer = await wideChart.locator(".chart-footer").boundingBox();
    const legend = await wideChart.locator(".chart-legend").boundingBox();
    const layout = await wideChart.locator(".chart-layout").boundingBox();
    assert.ok(Math.abs(note.x - layout.x) <= 1 && Math.abs(note.width - layout.width) <= 1,
      "Fallback spans the complete figure width, not the narrow right-legend column");
    assert.ok(note.y >= Math.max(footer.y + footer.height, legend.y + legend.height) - 1,
      "Fallback follows the plot, x-axis footer, and right-side legend");
  };
  await assertLongFallback();
  await widePage.setViewportSize({ width: 390, height: 800 });
  await waitForChartBounds(wideChart, 390);
  await assertAnnotations(wideChart, allIds, "Wide-glyph narrow labels");
  await assertLabelGeometry(wideChart, 390, "Wide-glyph narrow labels");
  await assertLongFallback();
  // A very narrow figure forces a previously fitted label into the note without
  // changing its source, identity, or wording. Normal390px coverage stays above.
  let narrowIds = desktopIds;
  for (const width of [260, 220, 180, 140]) {
    await widePage.setViewportSize({ width, height: 800 });
    await waitForChartBounds(wideChart, width);
    await assertAnnotations(wideChart, allIds, "Constrained-width full-text fallback");
    await assertLabelGeometry(wideChart, width, "Constrained-width full-text fallback");
    narrowIds = await wideChart.locator(".chart-annotation-label").evaluateAll((labels) =>
      labels.map((label) => label.getAttribute("data-chart-annotation")));
    if (desktopIds.some((id) => !narrowIds.includes(id))) break;
  }
  assert.ok(desktopIds.some((id) => !narrowIds.includes(id)),
    "Resize moves an existing annotation from the plot into readable full-text fallback");
  await widePage.emulateMedia({ media: "print" });
  await assertAnnotations(wideChart, allIds, "Wide-glyph print fallback", { print: true });
  assert.ok((await longNote.innerText()).includes(wideExample.wideSpec.annotations[3].label));
  assert.match(await longNote.innerText(), /repeat accounts.*88/iu,
    "Printed fallback includes the exact reviewed point evidence");
  await widePage.emulateMedia({ media: "screen" });
  await widePage.setViewportSize({ width: 1000, height: 800 });
  await waitForChartBounds(wideChart, 1000);
  await assertAnnotations(wideChart, allIds, "Widening restores the same annotation identities");
  assert.deepEqual(await wideChart.locator(".chart-annotation-label").evaluateAll((labels) =>
    labels.map((label) => label.getAttribute("data-chart-annotation"))), desktopIds,
  "The same full labels return when space is available again");
  await openAction(widePage, wideChart, "Copy as image");
  await widePage.waitForFunction(() => window.__dashboardClipboard.some((item) => item?.type === "image/png"));
  const fallbackPng = await widePage.evaluate(() => window.__dashboardClipboard.find((item) => item?.type === "image/png"));
  assert.ok(fallbackPng.width > 0 && fallbackPng.height > 0);
  assert.ok(fallbackPng.text.join("").includes(wideExample.wideSpec.annotations[3].label),
    "PNG retains every character of the full-text fallback, including a long unbroken token");
  assert.match(fallbackPng.text.join(" "), /repeat accounts.*88/iu,
    "PNG retains the fallback annotation's exact source evidence");
  await widePage.close();
  const axisExample = buildAnnotationExample("report");
  projects.push(axisExample.project);
  const axisPage = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  axisPage.on("pageerror", (error) => errors.push(error.message));
  // Disposable axis stress fixture, never part of the authored report/data.
  writeFileSync(join(axisExample.project, 'src/content/report/ReportContent.jsx'), `
    import React from 'react';
    import { ChartRenderer } from '../../data-app-public.jsx';
    const wide = ['Search', 'Studio', 'ＷＷＷＷＷＷＷＷ', 'A much longer category name'].map((category, index) => ({category, count:10+index}));
    export function ReportContent() { return <article className="report-content">
      {[false,true].map(title => <section className="axis-stress" key={String(title)}><ChartRenderer spec={{type:'horizontalBar',x:'category',y:'count',preserveBarChart:true,showYAxisLabel:title}} rows={wide}/></section>)}
    </article>; }
  `);
  const build = runDataAppFixtureBuild(axisExample.project, { pluginRoot });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  await axisPage.goto(pathToFileURL(axisExample.html).href, { waitUntil: 'load' });
  for (const width of [1000,390]) {
    await axisPage.setViewportSize({width,height:900});
    await axisPage.waitForFunction(() => document.querySelectorAll('.axis-stress svg.recharts-surface').length===2);
    await axisPage.waitForFunction(() => {
      const charts = [...document.querySelectorAll('.axis-stress svg.recharts-surface')];
      return charts.every(svg => Math.abs(svg.viewBox.baseVal.width - svg.getBoundingClientRect().width) < 1)
        && [...charts.at(-1).querySelectorAll('text > title')]
          .filter(title => title.parentNode.getBoundingClientRect().width > 0).length >= 2;
    });
    await axisPage.waitForFunction(() => [...document.querySelectorAll('.axis-stress svg text > title')].every(title => {
      const text=title.parentNode, frame=text.closest('svg').getBoundingClientRect(), box=text.getBoundingClientRect();
      return box.left >= frame.left-1 && box.right <= frame.right+1 && box.top >= frame.top-1 && box.bottom <= frame.bottom+1;
    }));

  }
  assert.deepEqual(errors, []);
  await axisPage.close();
  assert.deepEqual(errors, [], "Both surfaces must remain free of browser errors");
  console.log("Shared chart-annotation browser smoke passed.");
} finally {
  await browser?.close();
  for (const project of projects) rmSync(project, { recursive: true, force: true });
}
