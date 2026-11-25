import { readFileSync } from "node:fs";

// Only the authored placeholders supplied by our starter. Bracketed citations,
// template headings and ordinary Markdown links are not completion signals.
const starter = readFileSync(new URL("../report/ReportContent.jsx", import.meta.url), "utf8");
const placeholders = [...new Set(starter.match(/\[[A-Z][^\[\]\n]{6,}\]/g) ?? [])];
const chartOwner = '[data-component-kind="chart"][data-component-id]';
const plotMarks = [
  '[data-chart-mark]', '.recharts-line-curve', '.recharts-line-dot', '.recharts-bar-rectangle path',
  '.recharts-bar-rectangle rect', '.recharts-area-area', '.recharts-pie-sector path', '.recharts-scatter-symbol',
  '.chart-ranked-list-row', '.chart-heatmap-cell', '.chart-box-plot', '.chart-sankey-node', '.chart-funnel-stage',
  '.recharts-trapezoid', '.recharts-radial-bar-sector',
].join(',');

// One browser snapshot for the viewport. Check every chart for a known error
// before waiting on any other chart's renderer.
function observeCharts({ owner, marks, required, custom, wait }) {
  const main = document.querySelector("main");
  const charts = [], errors = [], pending = [];
  const shown = node => node.getClientRects().length && getComputedStyle(node).visibility !== "hidden" &&
    getComputedStyle(node).opacity !== "0" && !node.closest("[hidden]");
  for (const el of main.querySelectorAll('[data-chart-config-error],[role="alert"],p[role="status"]')) {
    const scope = el.closest(owner), root = el.closest('[data-chart-id],[data-chart-root]');
    if (!shown(el)) continue;
    const message = (el.innerText ?? el.textContent).trim();
    const id = scope?.dataset.componentId || root?.dataset.chartId || root?.getAttribute("aria-label");
    if (/^Loading chart/i.test(message)) {
      if (!scope) pending.push(`"${id || "Report chart"}": still loading`);
      continue;
    }
    if (el.matches('.component-data-state[role="status"]')) continue;
    // A rejected config or hosted library may render its error before any chart card exists.
    if (scope || root || el.hasAttribute("data-chart-config-error") || /^Charts couldn.t load/i.test(message)) {
      errors.push(`${id ? 'Chart "' + id + '"' : 'Report chart'}: ${message}`);
    }
  }
  function plotState(scope) {
    const empty = scope.querySelector('.component-data-state[role="status"]');
    if (empty && shown(empty)) return { evidence: "empty", description: empty.innerText };
    const count = [...scope.querySelectorAll(marks)].filter(el => {
      if (!shown(el) || el.closest(".component-skeleton")) return false;
      const bounds = el.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) return true;
      // An exact horizontal or vertical trend can have a zero-area bounding box.
      return el.matches(".recharts-line-curve") && getComputedStyle(el).stroke !== "none" && el.getTotalLength?.() > 0;
    }).length;
    if (count) return { evidence: "plot", marks: count };
    const expected = Number(scope.dataset.chartZeroBars);
    if (expected > 0) {
      // Recharts emits empty point slots for zero bars with value labels. With labels
      // off it omits the point slots altogether, but still mounts the bar series.
      const series = [...scope.querySelectorAll("svg.recharts-surface .recharts-bar .recharts-bar-rectangles")];
      const visible = node => {
        const bounds = node.ownerSVGElement?.getBoundingClientRect();
        if (!bounds?.width || !bounds.height) return false;
        for (let el = node; el && el !== scope.parentElement; el = el.parentElement) {
          const css = getComputedStyle(el);
          if (css.display === "none" || css.visibility !== "visible" || css.opacity === "0") return false;
        }
        return true;
      };
      const slots = series.flatMap(group => [...group.querySelectorAll(".recharts-bar-rectangle")]);
      if (series.length && series.every(group => visible(group) && group.firstElementChild) &&
          (slots.length === 0 || (slots.length === expected && slots.every(visible)))) {
        return { evidence: "zero bars", values: expected, series: series.length, slots: slots.length };
      }
    }
    return null;
  }
  const scopes = [...main.querySelectorAll(owner)];
  const ids = new Set(scopes.map(scope => scope.dataset.componentId));
  for (const id of required) if (!ids.has(id)) errors.push(`Expected chart "${id}" is missing from the report.`);
  for (const scope of scopes) {
    const id = scope.dataset.componentId;
    if (!shown(scope)) { errors.push(`Report chart "${id}" is hidden at this width.`); continue; }
    const observed = custom.includes(id) ? { evidence: "author check" } : plotState(scope);
    if (observed) charts.push({ id, ...observed });
    else {
      const loading = [...scope.querySelectorAll('.component-skeleton,[aria-busy="true"],p[role="status"]')]
        .some(el => shown(el) && (!el.matches('p[role="status"]') || /^Loading chart/i.test(el.innerText)));
      pending.push(`"${id}": ${loading ? "still loading" : "no plotted marks or reviewed empty state"}`);
    }
  }
  for (const id of custom) {
    if (ids.has(id)) continue;
    const node = main.querySelector('#' + CSS.escape(id) + ',[data-component-id="' + CSS.escape(id) + '"]');
    if (!node || !shown(node)) errors.push(`Custom chart "${id}" is missing or hidden at this width.`);
    else charts.push({ id, evidence: "author check" });
  }
  return wait && !errors.length && pending.length ? false : { charts, errors, pending };
}

// Check each numbered dataset in the delivered UI. A citation title or an
// inferred date range can open Overview even when no provenance was supplied.
async function checkCitedSources(page) {
  for (const entry of await page.locator('[data-report-citation="list"]:visible').all()) {
    await entry.click();
    const panel = page.getByRole("complementary", { name: /^Data source for / });
    await panel.locator('.source-sidebar-body[aria-busy="false"]').waitFor();
    if (await panel.getByRole("tab", { name: "Data preview", exact: true }).isVisible()) {
      const overview = panel.getByRole("tab", { name: "Overview", exact: true });
      const origin = panel.locator('.source-row:is([data-source-kind="file"], [data-source-kind="table"], a):visible');
      const sql = await panel.getByRole("tab", { name: "SQL query", exact: true }).isVisible();
      const flow = panel.getByRole("tab", { name: "Evidence flow", exact: true });
      const scope = panel.locator(".source-caveats li:visible, .source-definitions tr:visible");
      const hasOrigin = sql || await origin.count() > 0;
      const hasContext = sql || await scope.count() > 0 || await flow.isVisible();
      if (!await overview.isVisible() || !hasOrigin || !hasContext) {
        throw new Error(`${await entry.innerText()} needs source detail. Add the reviewed origin and scope in src/data.json using the source template in output_formats/html/report.md.`);
      }
    }
    await panel.getByRole("button", { name: "Close data source", exact: true }).click();
    await panel.waitFor({ state: "hidden" });
  }
}

export async function inspectFinishedReport(page, { chartIds = [], customChartIds = [], chartTimeoutMs = 5000 }) {
  const renderDeadline = Date.now() + chartTimeoutMs;
  const main = page.locator("main");
  const runtimeError = page.locator('[data-data-status="error"]');
  if (await runtimeError.count()) {
    // React's error boundary catches render failures, so pageerror alone cannot
    // reject them. Read the existing sanitized logs before checking report body.
    const logs = runtimeError.first().locator('textarea[aria-label="Error logs"]');
    let message;
    try { message = JSON.parse(await logs.inputValue()).error?.message; } catch {}
    throw new Error(`Report runtime error: ${typeof message === "string" && message || "The visualization failed to render. Inspect its error logs."}`);
  }
  const article = main.locator("article").first();
  const body = await article.count() ? article : main;
  const text = await body.innerText();
  const leftover = placeholders.find(slot => text.includes(slot));
  if (leftover) throw new Error(`Replace the report starter text: ${leftover}`);
  const hasBody = await body.evaluate(el => [...el.querySelectorAll("p,li,table,[data-rich-narrative],[data-component-kind=chart],figure")]
    .some(node => !node.closest("header,.report-sources,nav,aside") && node.getClientRects().length &&
      (node.matches('figure,[data-component-kind=chart]') || node.textContent.trim().length > 0)));
  const args = { owner: chartOwner, marks: plotMarks, required: chartIds, custom: customChartIds };
  let observation;
  try {
    const result = await page.waitForFunction(observeCharts, { ...args, wait: true },
      { timeout: Math.max(1, renderDeadline - Date.now()), polling: 50 });
    observation = await result.jsonValue();
    await result.dispose();
  } catch (error) {
    if (error.name !== "TimeoutError") throw error;
    observation = await page.evaluate(observeCharts, args);
  }
  const { charts, errors, pending } = observation;
  if (errors.length) throw new Error([...errors, ...pending].join("\n"));
  if (pending.length) {
    throw Object.assign(new Error(`Chart rendering remains unverified after ${chartTimeoutMs / 1000}s. ${pending.join(". ")}. Check renderer access, chart fields, and reviewed rows. For an authored plot use --custom-chart and --checks.`), { code: "DATA_CHART_NOT_READY" });
  }
  if (!hasBody) throw new Error("The report has no authored body. Add the requested findings before finishing.");
  await checkCitedSources(page);
  const sections = main.locator('[data-component-kind="narrative"][data-query-id]').filter({ has: page.locator("[data-rich-narrative]") });
  return { charts, sectionId: await sections.count() ? await sections.first().getAttribute("data-component-id") : null };
}
