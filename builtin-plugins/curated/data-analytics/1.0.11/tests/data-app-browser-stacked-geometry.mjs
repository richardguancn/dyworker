import assert from "node:assert/strict";
import { installDashboardBrowserMocks } from "./browser-helpers.mjs";

const fields = ["desktop", "mobile", "unknown", "web"];
const rows = [
  { cohort: "Primary", desktop: 30, mobile: 45, unknown: 20, web: 55 },
  { cohort: "Mixed", desktop: 24, mobile: -30, unknown: 16, web: -10 },
  { cohort: "Sparse", desktop: 0, mobile: 1, unknown: 0, web: 0 },
];

export const stackedGeometryCharts = ["horizontalStackedBar", "stackedBar"].map(type => ({
  id: `coverage-geometry-${type}`,
  title: `${type} edge geometry`,
  spec: { type, x: "cohort", y: "desktop", fields, markRadius: 8,
    colors: Object.fromEntries(fields.map(field => [field, "#2685eb"])),
    showXAxisLabel: false, showYAxisLabel: false, showLegend: false },
  rows,
}));

async function readGeometry(chart, horizontal) {
  return chart.locator("g[data-stack-sign]").evaluateAll((groups, horizontal) => groups.map(group => {
    const mark = group.querySelector("path[clip-path]");
    const clip = group.querySelector("clipPath path");
    const markBox = mark.getBBox(), clipBox = clip.getBBox(), matrix = mark.getScreenCTM();
    const valueStart = horizontal ? markBox.x : markBox.y;
    const valueSize = horizontal ? markBox.width : markBox.height;
    const thicknessStart = horizontal ? clipBox.y : clipBox.x;
    const thickness = horizontal ? clipBox.height : clipBox.width;
    return {
      key: `${group.dataset.stackSign}:${thicknessStart.toFixed(3)}`,
      valueStart, valueSize, thicknessStart, thickness,
      clipStart: horizontal ? clipBox.x : clipBox.y,
      clipSize: horizontal ? clipBox.width : clipBox.height,
      center: horizontal ? (markBox.x + markBox.width / 2) * matrix.a + matrix.e
        : (markBox.y + markBox.height / 2) * matrix.d + matrix.f,
      edgeStart: horizontal ? clipBox.y * matrix.d + matrix.f : clipBox.x * matrix.a + matrix.e,
      edgeEnd: horizontal ? (clipBox.y + clipBox.height) * matrix.d + matrix.f
        : (clipBox.x + clipBox.width) * matrix.a + matrix.e,
    };
  }), horizontal);
}

async function assertSinglePaintedEdge({ page, chart, horizontal, ratio, description }) {
  const geometry = await readGeometry(chart, horizontal);
  const stacks = Map.groupBy(geometry, mark => mark.key);
  for (const marks of stacks.values()) {
    marks.sort((left, right) => left.valueStart - right.valueStart);
    for (let index = 1; index < marks.length; index++) {
      assert.ok(Math.abs(marks[index - 1].valueStart + marks[index - 1].valueSize - marks[index].valueStart) < 0.01,
        `${description}: quantitative segment boundaries must still meet`);
      assert.ok(Math.abs(marks[index].thickness - marks[0].thickness) < 0.01,
        `${description}: segments must share the same visible thickness`);
    }
    assert.ok(Math.abs(marks.reduce((sum, mark) => sum + mark.valueSize, 0) - marks[0].clipSize) < 0.01,
      `${description}: the clip must preserve the complete quantitative stack extent`);
  }
  const samples = [...stacks.values()].filter(marks => marks.length > 1)
    .flatMap(marks => marks.filter(mark => mark.valueSize >= 25));
  assert.ok(samples.length >= 2, `${description}: sample real interior and outer stack segments`);
  const actual = (await page.screenshot()).toString("base64");
  // One solid fill through the same rounded clip is the raster oracle.
  // Equal opaque colors isolate repeated edge coverage from palette differences.
  const originals = await chart.locator("g[data-stack-sign]").evaluateAll((groups, horizontal) => {
    const seen = new Set();
    return groups.map(group => {
      const mark = group.querySelector("path[clip-path]");
      const clip = group.querySelector("clipPath path"), bounds = clip.getBBox();
      const key = `${group.dataset.stackSign}:${(horizontal ? bounds.y : bounds.x).toFixed(3)}`;
      const original = { d: mark.getAttribute("d"), clip: mark.getAttribute("clip-path"), style: mark.getAttribute("style") };
      if (seen.has(key)) mark.style.visibility = "hidden";
      else {
        seen.add(key);
        mark.setAttribute("d", `M ${bounds.x - 4},${bounds.y - 4} h ${bounds.width + 8} v ${bounds.height + 8} h ${-bounds.width - 8} Z`);
      }
      return original;
    });
  }, horizontal);
  let expected;
  try { expected = (await page.screenshot()).toString("base64"); }
  finally {
    await chart.locator("g[data-stack-sign]").evaluateAll((groups, originals) => groups.forEach((group, index) => {
      const mark = group.querySelector(":scope > path"), original = originals[index];
      mark.setAttribute("d", original.d); mark.setAttribute("clip-path", original.clip);
      if (original.style === null) mark.removeAttribute("style"); else mark.setAttribute("style", original.style);
    }), originals);
  }
  const differences = await page.evaluate(async ({ actual, expected, samples, horizontal, ratio }) => {
    const decode = async value => {
      const image = new Image(); image.src = `data:image/png;base64,${value}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0); return context;
    };
    const [left, right] = await Promise.all([decode(actual), decode(expected)]);
    const differences = [];
    for (const sample of samples) for (const edge of [sample.edgeStart, sample.edgeEnd]) {
      for (let offset = -1; offset <= 1; offset++) {
        const along = Math.floor(sample.center * ratio), across = Math.floor(edge * ratio) + offset;
        const x = horizontal ? along : across, y = horizontal ? across : along;
        const before = left.getImageData(x, y, 1, 1).data, after = right.getImageData(x, y, 1, 1).data;
        const difference = Math.max(...[0, 1, 2].map(index => Math.abs(before[index] - after[index])));
        if (difference > 3) differences.push({ x, y, difference, actual: [...before], expected: [...after] });
      }
    }
    return differences;
  }, { actual, expected, samples, horizontal, ratio });
  assert.deepEqual(differences, [], `${description}: stack edges must match one painted outline: ${JSON.stringify(differences.slice(0, 3))}`);
}

export async function verifyStackedGeometry({ browser, url }) {
  for (const ratio of [1, 1.25, 2]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: ratio });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await installDashboardBrowserMocks(page);
    try {
      await page.goto(url, { waitUntil: "load" });
      for (const width of [736, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        for (const { id, spec } of stackedGeometryCharts) {
          const chart = page.locator(`[data-component-id="${id}"]`);
          await chart.locator("g[data-stack-sign]").first().waitFor({ state: "visible" });
          await chart.scrollIntoViewIfNeeded();
          // Change the origin after initial render; edge consistency must survive
          // fractional placement without relying on React to sample the screen again.
          await chart.evaluate(element => { element.style.transform = "translate(0.31px, 0.27px)"; });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await assertSinglePaintedEdge({ page, chart, horizontal: spec.type.startsWith("horizontal"), ratio,
            description: `${spec.type} at ${width}px / DPR ${ratio}` });
          await chart.evaluate(element => { element.style.transform = ""; });
        }
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
}
