import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { installDashboardBrowserMocks, resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { prepareDataApp } from "../scripts/prepare-data-app.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
const reviewDirectory = process.env.DATA_APP_REVIEW_DIR && resolve(process.env.DATA_APP_REVIEW_DIR);
if (reviewDirectory) mkdirSync(reviewDirectory, { recursive: true });

async function assertComponentLabGeometry(browser) {
  const directory = mkdtempSync(join(tmpdir(), "data-lab-layout-"));
  const page = await browser.newPage();
  try {
    const { build } = await import(pathToFileURL(join(template, "node_modules/vite/dist/node/index.js")));
    await build({ root: template, configFile: join(template, "vite.config.js"), logLevel: "error",
      build: { outDir: directory, emptyOutDir: true, rolldownOptions: { input: join(template, "examples/component-lab/index.html") } } });
    await installDashboardBrowserMocks(page);
    await page.goto(pathToFileURL(join(directory, "examples/component-lab/index.html")).href);
    assert.equal(await page.locator(".page-rulers, .page-ruler, .ruler-guide").count(), 0);
    for (const width of [1920, 1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const grouped = page.locator(".library-chart-grid .bar-family-grouped-list");
      await grouped.scrollIntoViewIfNeeded();
      const values = await grouped.locator(".bar-family-grouped-bar").evaluateAll(bars => bars.map(bar => {
        const track=bar.querySelector(".bar-family-grouped-track").getBoundingClientRect();
        const value=bar.querySelector(".bar-family-grouped-value").getBoundingClientRect();
        const fill=bar.querySelector(".bar-family-grouped-track > span").getBoundingClientRect();
        return {gap:value.left-track.right, trackHeight:track.height, fillHeight:fill.height,
          alignment:Math.abs((track.top+track.bottom-value.top-value.bottom)/2)};
      }));
      assert.equal(values.length,10);
      for(const value of values) {
        assert(value.gap>=10,`Grouped value overlaps the track at ${width}px`);
        assert.equal(value.trackHeight,12);assert.equal(value.fillHeight,12);
        assert(value.alignment<1,`Grouped value not centered at ${width}px`);
      }
      const first=grouped.locator(".bar-family-grouped-bar").first();
      const geometry = () => first.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const group = element.closest(".bar-family-grouped-list").getBoundingClientRect();
        return { x: rect.x - group.x, y: rect.y - group.y, width: rect.width, height: rect.height,
          groupWidth: group.width, groupHeight: group.height };
      });
      const before=await geometry();await first.hover();
      const after = await geometry();
      assert.ok(Object.keys(before).every(key => Math.abs(after[key] - before[key]) <= 1),
        `Hover must not change grouped-bar geometry: ${JSON.stringify({ width, before, after })}`);
      const segment=page.locator('[data-component-id="library-chart-bar-segmented"]');
      const composition = await segment.evaluate(card => {
        const bounds = card.getBoundingClientRect();
        const root = card.querySelector(".bar-family-segmented");
        const rows = [...card.querySelectorAll(".bar-family-segment-annotations > div")].map(row => row.getBoundingClientRect());
        const peers = [...card.parentElement.children].map(peer => peer.getBoundingClientRect()).filter(peer => Math.abs(peer.top - bounds.top) < 1);
        return { rootWidth: root.clientWidth, firstTop: rows[0].top, secondTop: rows[1].top,
          bottom: bounds.bottom, rowBottom: Math.max(...peers.map(peer => peer.bottom)),
          contained: rows.every(row => row.left >= bounds.left && row.right <= bounds.right) };
      });
      assert(Math.abs(composition.bottom - composition.rowBottom) < 1, "Composition card fills its grid row");
      assert.equal(Math.abs(composition.firstTop - composition.secondTop) < 1, composition.rootWidth > 560,
        "Composition annotations use one column in narrow cards, two when labels have room");
      assert(composition.contained, "Composition annotations stay inside the card");
      await page.evaluate(()=>window.scrollTo(0,0));
      const sidebar=page.locator(".library-navigation");
      if(width>760) {
        assert((await sidebar.boundingBox()).x<2,"Inventory sidebar must dock to the page edge");
        const scrollInset = await sidebar.evaluate(sidebar => sidebar.getBoundingClientRect().right - sidebar.querySelector(".library-nav-items").getBoundingClientRect().right);
        assert(scrollInset < 2, "Sidebar scrollbar belongs at the divider, not inside its content padding");
        assert(await sidebar.locator(".library-nav-items").evaluate(nav=>nav.scrollHeight>nav.clientHeight),"Sidebar owns its overflow");
      } else assert(await sidebar.getByRole("button",{name:/Components/}).isVisible());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    }
  } finally { await page.close();rmSync(directory,{recursive:true,force:true}); }
}

async function assertReferenceLayoutContainment(browser) {
  const directory = mkdtempSync(join(tmpdir(), "data-reference-layout-"));
  try {
    for (const example of ["fleet-operations", "acme-workflow", "business-performance", "infrastructure-capacity", "finance", "product-tracker"]) {
      const { output } = await prepareDataApp({ output: join(directory, example), example, allowDraft: true });
      const build = runDataAppFixtureBuild(output, { pluginRoot });
      assert.equal(build.status, 0, build.stdout + build.stderr);
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await installDashboardBrowserMocks(page);
      await page.goto(pathToFileURL(join(output, "dist/index.html")).href, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector('main [data-component-id]')
        && !document.querySelector('main [aria-busy="true"]'));
      for (const width of [390, 768, 1024, ...(example === "finance" ? [1200] : []), 1440, 1599, 1600, 2400]) {
        await page.setViewportSize({ width, height: 900 });
        if (example === "finance") {
          // Wait for ResizeObserver to update the chart before measuring its SVG labels.
          await page.waitForFunction(() => {
            const chart = document.querySelector(".finance-combined-chart");
            const svg = chart?.querySelector("svg");
            return svg && Math.abs(svg.viewBox.baseVal.width - chart.getBoundingClientRect().width) < 1;
          });
        }
        const frame = await page.locator(example === "fleet-operations" ? ".fleet-operations-page"
          : example === "finance" ? ".finance-example-page" : 'main[data-data-app-content="dashboard"]').evaluate(element => {
          const rect = element.getBoundingClientRect(), styles = getComputedStyle(element);
          const gutter = parseFloat(styles.getPropertyValue("--data-app-layout-gutter")) || 0;
          const left = parseFloat(styles.paddingLeft) || 0, right = parseFloat(styles.paddingRight) || 0;
          const panelPadding = parseFloat(styles.getPropertyValue("--fleet-panel-padding-inline")) || 0;
          return { width: rect.width, left, right, gutter, panelPadding,
            viewport: element.closest(".dashboard-root").getBoundingClientRect().width };
        });
        if (["fleet-operations", "finance"].includes(example)) {
          assert.ok(Math.abs(frame.width - frame.viewport) <= 1, example + " preserves its full-width custom frame");
          if (example === "finance") {
            assert.equal(frame.left, 0, "Finance keeps its full-width viewport shell");
            assert.equal(frame.right, frame.left);
            const watchlist = await page.locator(".finance-watchlist-card").evaluate(card => {
              const box = card.getBoundingClientRect(), rail = card.parentElement;
              const list = card.querySelector(".finance-stock-list");
              const group = document.querySelector(".finance-hero").getBoundingClientRect();
              const main = document.querySelector(".finance-main-column").getBoundingClientRect();
              const support = document.querySelector(".finance-right-rail").getBoundingClientRect();
              return { left: box.left, bottom: box.bottom, variant: card.dataset.componentVariant,
                groupLeft: group.left, groupRight: group.right, mainWidth: main.width,
                watchlistGap: main.left - box.right, supportGap: support.left - main.right,
                railBorder: getComputedStyle(rail).borderRightWidth, overflow: getComputedStyle(list).overflowY,
                listBottom: list.getBoundingClientRect().bottom, viewportHeight: innerHeight };
            });
            assert.equal(watchlist.variant, "card", "Watchlist uses the shared card surface");
            assert.equal(watchlist.left - watchlist.groupLeft, width <= 820 ? 16 : width <= 1280 ? 24 : 32, "Watchlist floats inside the responsive gutter");
            assert.ok(Math.abs(watchlist.groupLeft - (frame.viewport - watchlist.groupRight)) <= 1, "The whole Finance group stays centered");
            assert.ok(watchlist.mainWidth <= 960 + 1, "Middle content is capped at 960px");
            if (width > 1280) {
              assert.equal(watchlist.watchlistGap, 32, "Watchlist remains close to the middle content");
              assert.equal(watchlist.supportGap, 32, "Supporting rail remains close to the middle content");
            }
            assert.equal(watchlist.railBorder, "0px", "No full-height sidebar divider");
            assert.ok(watchlist.bottom <= watchlist.viewportHeight, "Watchlist fits its viewport");
            assert.ok(watchlist.listBottom <= watchlist.bottom, "Stock list stays inside its card");
            if (width > 820) assert.equal(watchlist.overflow, "auto", "Watchlist owns its vertical scrolling");
            if (width <= 820) {
              const geometry = await page.locator(".finance-stock-list").evaluate(nav => ({
                cards: [...nav.children].map(card => ({ width: card.clientWidth, content: card.scrollWidth })),
                axes: [...document.querySelectorAll(".finance-combined-chart .finance-axis-label, .finance-position-value")]
                  .map(label => label.getBoundingClientRect().right),
              }));
              assert.ok(geometry.cards.every(card => card.content <= card.width + 1), "Watch cards must not overlap adjacent stocks");
              assert.ok(geometry.axes.every(right => right <= frame.viewport), "Price and volume labels remain inside the viewport");
            }
          } else {
            assert.equal(frame.gutter, 0, "Fleet viewport has no outer page gutter");
            assert.equal(frame.panelPadding, width <= 720 ? 24 : 64, "Fleet keeps its independent panel padding");
          }
        } else {
          assert.ok(frame.width <= 1440 + 64 + 1, example + " content cap at " + width);
          assert.equal(frame.left, width <= 650 ? 16 : 32, example + " left gutter at " + width);
          assert.equal(frame.right, frame.left, example + " symmetric gutters");
        }
        const header = await page.locator(".dashboard-topbar").boundingBox();
        assert.ok(Math.abs(header.width - frame.viewport) <= 1, example + " full-width shell header");
        if (reviewDirectory && [390, 1440].includes(width)) {
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: join(reviewDirectory, `${example}-${width}.png`), animations: "disabled" });
        }
        if (example === "infrastructure-capacity" && width <= 650) {
          const legend = page.locator(".operating-envelope-card .chart-legend");
          const labels = await legend.locator("li:not([data-collapsed]) .chart-legend-button > span:last-child").evaluateAll(items =>
            items.map(item => ({ height: item.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(item).lineHeight) })));
          assert.ok(labels.length > 0);
          assert.ok(labels.every(label => label.height <= label.lineHeight + 1), "Regional labels wrap as legend items, not single-character columns");
          assert.ok(await page.getByRole("button", { name: "Show all 7 categories", exact: true }).isVisible());
        }
        if (example === "acme-workflow") {
          const navigator = page.getByRole("navigation", { name: "Dashboard sections", includeHidden: true });
          await page.waitForFunction(() => {
            const nav = document.querySelector(".section-navigator"), content = nav.parentElement;
            const left = content.getBoundingClientRect().left + (parseFloat(getComputedStyle(content).paddingLeft) || 0);
            return nav.dataset.fitsGutter === String(left >= 12 + nav.offsetWidth + 16);
          });
          assert.equal(await navigator.isVisible(), frame.viewport >= 1600, "Persistent navigator fits outside content from 1600px of usable width");
          if (await navigator.isVisible()) {
            await navigator.locator("button").hover();
            const menu = navigator.locator(".section-navigator-menu");
            await menu.waitFor({state:"visible"});
            const right = (await navigator.boundingBox()).x + (await navigator.boundingBox()).width;
            const contentLeft = await navigator.evaluate(nav => nav.parentElement.getBoundingClientRect().left + (parseFloat(getComputedStyle(nav.parentElement).paddingLeft) || 0));
            assert.ok(right + 16 <= contentLeft, "Persistent navigation must not overlap content; the open menu is a popover");
            await page.mouse.move(width / 2, 10);
            await menu.waitFor({ state: "hidden" });
          }
          continue;
        }
        if (example !== "fleet-operations") continue;
        // An open modal menu hides its trigger from the accessibility tree.
        // Retain the trigger locator while verifying its expanded state.
        const trigger = page.getByRole("button", { name: "Day", exact: true, includeHidden: true });
        await trigger.scrollIntoViewIfNeeded();
        const targets = await trigger.evaluate(button => [".filter-label", ".select-value", ".chevron", null].map(selector => {
          const box = (selector ? button.querySelector(selector) : button).getBoundingClientRect();
          const x = box.left + box.width / 2, y = selector ? box.top + box.height / 2 : box.bottom - 3;
          const hit = document.elementFromPoint(x, y);
          return { selector: selector ?? "bottom padding", x, y, belongsToTrigger: button.contains(hit),
            interceptedBy: hit?.className };
        }));
        for (const target of targets) {
          assert.ok(target.belongsToTrigger, `${width}px ${target.selector} covered by ${target.interceptedBy}`);
          await page.mouse.click(target.x, target.y);
          assert.equal(await trigger.getAttribute("aria-expanded"), "true", `Day opens from ${target.selector}`);
          await page.keyboard.press("Escape");
        }
        await trigger.click();
        const option = page.getByRole("menuitemradio").first();
        const chosen = (await option.innerText()).trim();
        await option.click();
        assert.ok((await trigger.innerText()).includes(chosen), "Selecting a day updates the shared trigger");
        const geometry = await page.locator(".fleet-dashboard-columns").evaluate(grid => {
          const delivery = grid.querySelector(".deliveries-column"), invoice = grid.querySelector(".invoice-column");
          const bounds = element => { const b = element.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
          return { delivery: bounds(delivery), invoice: bounds(invoice), sections: [...delivery.children].map(bounds),
            horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
        });
        assert.equal(geometry.horizontalOverflow, false, `Fleet page width at ${width}px`);
        for (let index = 1; index < geometry.sections.length; index++)
          assert.ok(geometry.sections[index].top >= geometry.sections[index - 1].bottom - 1, `Fleet sections overlap at ${width}px`);
        assert.ok(width <= 1180 ? geometry.invoice.top >= geometry.delivery.bottom - 1
          : geometry.invoice.left >= geometry.delivery.right - 1, `Fleet panels overlap at ${width}px`);
      }
      if (example === "fleet-operations") {
        const tracks = await page.locator('.cost-comparison-bar').evaluateAll(bars => bars.map(bar => bar.getBoundingClientRect().width));
        assert.ok(tracks.length > 1 && tracks.every(width => Math.abs(width - tracks[0]) < 1),
          "Variance captions must not give each cost bar a different numeric scale");
        const route = page.locator('[data-component-id="route-exceptions"]').getByRole("button", { name: /^View invoices for / }).first();
        const customer = (await route.getAttribute("aria-label")).replace("View invoices for ", "");
        await route.click();
        const invoices = page.locator('[data-component-id="invoice-workspace"]');
        assert.equal(await invoices.getByRole("textbox", {name:"Search data",exact:true}).inputValue(), customer);
        assert.ok((await invoices.locator("tbody tr").allTextContents()).every(text => text.includes(customer)));
        await invoices.getByRole("textbox", {name:"Search data",exact:true}).fill("");
      }
      if (example === "finance") {
        assert.equal(await page.getByRole("complementary", {name:"Watchlist",exact:true}).count(), 1);
        const newsStocks = [
          ["COST", "Costco"], ["WM", "Waste Management"], ["GRMN", "Garmin"],
          ["AZO", "AutoZone"], ["FDX", "FedEx"],
          ["CTAS", "Cintas"], ["MKC", "McCormick"], ["FAST", "Fastenal"],
        ];
        for (const [ticker, company] of newsStocks) {
          await page.getByRole("button", {name: new RegExp(`^${ticker} ${company} `)}).click();
          assert.equal(await page.locator('.finance-security-title strong').innerText(), company);
          const links = await page.locator('.finance-story-list a').evaluateAll(items => items.map(item => item.href));
          assert.ok(links.length >= 4 && new Set(links).size === links.length, `${ticker} has four distinct sourced cards`);
        }
        await page.getByRole("button", {name:/^COST Costco /}).click();
        const analystGeometry = await page.locator('.finance-analyst-card').evaluate(card => {
          const content = card.querySelector('.finance-consensus-renderer').getBoundingClientRect();
          return { bottomGap: card.getBoundingClientRect().bottom - content.bottom,
            padding: parseFloat(getComputedStyle(card).paddingBottom) };
        });
        assert.ok(analystGeometry.bottomGap <= analystGeometry.padding + 2,
          "Supporting chart cards keep their intrinsic height, including beside a taller trade card");
        const notes = page.locator('.finance-story-list a');
        const surfaces = await page.locator('[data-component-id="finance-market-overview"], .finance-news-card').evaluateAll(cards =>
          cards.map(card => ({ background: getComputedStyle(card).getPropertyValue('--card-surface'),
            radius: getComputedStyle(card).borderRadius, smooth: Boolean(card.querySelector('.smooth-card-surface')) })));
        assert.ok(surfaces.length > 1 && surfaces.every(surface => surface.smooth));
        assert.ok(surfaces.every(surface => surface.background === surfaces[0].background && surface.radius === surfaces[0].radius),
          "News uses the same shared card surface as Market overview in every theme");
        const original = await notes.allTextContents();
        await page.getByRole("button", {name:"1M",exact:true}).click();
        const visible = await notes.allTextContents();
        assert.ok(visible.length > 0);
        assert.deepEqual(visible, original, "Real news retains publication dates independently of the synthetic price window");
        assert.ok((await notes.evaluateAll(links => links.map(link => link.href))).every(url => url.startsWith("https://")));
        await page.getByRole("button", {name:/^GRMN Garmin /}).click();
        assert.ok((await notes.allTextContents()).every(text => text.includes("Garmin")), "Company selection scopes the sourced news");
        await page.getByRole("button", {name:/^COST Costco /}).click();
        assert.ok(!(await page.locator('.finance-market-metrics').innerText()).includes("P/E"));
        await page.getByRole("button", {name:"1Y",exact:true}).click();
        await page.getByRole("button", {name:/^AZO AutoZone /}).click();
        await page.getByRole("spinbutton", {name:"Shares",exact:true}).fill("100");
        for (const theme of ["Classic", "Neutral", "Dark pixel", "Scientific blue", "Sticker pop"]) {
          await page.getByRole("button", {name:"More",exact:true}).click();
          await page.getByRole("menuitem", {name:"Switch theme",exact:true}).click();
          await page.getByRole("button", {name:`Apply ${theme}`,exact:true}).click();
          for (const width of [390, 768, 1024, 1200, 1440]) {
            await page.setViewportSize({width, height:900});
            // Let responsive SVG observers consume the new CSS grid dimensions.
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const planner = await page.locator('.finance-planner-card').evaluate(card => {
              const bounds = card.getBoundingClientRect();
              const content = [...card.querySelectorAll('.finance-order-side, .finance-share-input, .finance-outlook-slider, .finance-outlook-chart, .finance-outlook-values strong')];
              const values = [...card.querySelectorAll('.finance-outlook-values strong')].map(item => item.getBoundingClientRect());
              return { contained: content.every(item => {
                const box = item.getBoundingClientRect();
                return box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
              }), overflow: card.scrollWidth > card.clientWidth + 1,
              valuesOverlap: values.length === 2 && values[0].right > values[1].left && values[0].bottom > values[1].top };
            });
            assert.deepEqual(planner, {contained:true, overflow:false, valuesOverlap:false},
              `${theme}/${width}: large scenario values must not enlarge the card's grid track`);
          }
        }
      }
      if (example === "infrastructure-capacity") {
        const densePlot = page.locator('#regional-pool-load-plot .recharts-wrapper');
        await densePlot.scrollIntoViewIfNeeded();
        const plotBounds = await densePlot.boundingBox();
        for (const x of [.4, .5, .6]) {
          await densePlot.hover({position: {x:plotBounds.width*x,y:80}});
          await page.waitForFunction(() => {
            const tip = document.querySelector('#regional-pool-load-plot .chart-tooltip');
            const bounds = tip?.getBoundingClientRect();
            return bounds?.width > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight;
          });
          assert.equal(await densePlot.locator('.chart-tooltip > span').count(), 18);
        }
        const micro = page.locator('[data-component-id="available-trend"] .recharts-wrapper');
        await micro.scrollIntoViewIfNeeded();
        await micro.hover();
        assert.equal(await micro.locator('.chart-tooltip > span').evaluate(row => {
          const text = [...row.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.includes('Available'));
          const range = document.createRange(); range.selectNodeContents(text);
          return range.getClientRects().length;
        }), 1, "Short metric names must not split into fragments inside small-chart tooltips");
        await page.getByRole('button', {name:/^Queue recovery:/}).hover();
        assert.equal(await page.locator('.chart-mark-tooltip').count(), 0, "Recovery does not repeat an already visible percentage");
        const pool = page.getByRole("button", {name:"Accelerator pool",exact:true});
        await pool.click();
        await page.getByRole("menuitemradio", {name:"H100",exact:true}).click();
        assert.equal(await pool.evaluate(element => getComputedStyle(element).outlineStyle), "none",
          "Pointer menu selection restores focus without a keyboard ring");
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        assert.equal(await pool.evaluate(element => getComputedStyle(element).outlineStyle), "solid",
          "Keyboard navigation retains a visible focus ring");
        await pool.click();
        await page.getByRole("menuitemradio", {name:"All",exact:true}).click();
        assert.equal(await pool.evaluate(element => getComputedStyle(element).outlineStyle), "none",
          "Returning to pointer input clears keyboard-only decoration");
        await page.getByRole("button", {name:"Inspect Japan H200",exact:true}).click();
        assert.match(await page.locator('.filter-trigger[aria-label="Region"]').innerText(), /Japan/);
        assert.match(await page.getByRole("button", {name:"Accelerator pool",exact:true}).innerText(), /H200/);
        await page.getByRole("button", {name:"Clear all",exact:true}).click();
        await page.getByRole("button", { name: "Regional operating envelope actions", exact: true }).click();
        await page.getByRole("menuitem", { name: "Edit chart", exact: true }).click();
        const editor = page.getByRole("dialog", { name: "Regional operating envelope", exact: true });
        await editor.locator('.explorer-chart[data-ready="true"]').waitFor();
        const strokes = await editor.locator(".recharts-line-curve").evaluateAll(paths => paths.map(path => getComputedStyle(path).stroke));
        assert.equal(strokes.length, 7);
        assert.ok(strokes.every(stroke => stroke !== "none" && stroke !== "rgba(0, 0, 0, 0)"),
          "Portaled previews inherit the chart's authored color tokens");
        assert.equal(await editor.locator(".dialog-header").evaluate(header => getComputedStyle(header).outlineStyle), "none",
          "Initial dialog focus must not outline the entire header");
        await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      }
      assert.deepEqual(errors, [], `${example} has no browser errors`);
      await page.close();
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
const project = mkdtempSync(join(tmpdir(), "data-custom-layout-smoke-"));
cpSync(template, project, {
  recursive: true,
  filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
});
writeFileSync(join(project, "src/content/dashboard/DashboardContent.jsx"), `
import React, { useState } from "react";

import { ChartRenderer, DataComponent, MetricCard, useDataApp } from "../../data-app-public.jsx";
import { SortableDashboardLayout } from "../shared/SortableDashboardLayout.jsx";

function Chart({ id, title, className }) {
  const { reviewedRows, chartProps } = useDataApp();
  const rows = reviewedRows("usage_summary");
  const chart = { type: "line", x: "week", y: "activeUsers" };
  return <DataComponent id={id} title={title} description={"Reviewed source-backed explanation for " + title + "."}
    queryId="usage_summary" kind="chart"
    chart={chart} sourceRows={rows} displayRows={rows} className={
      ["custom-layout-card", className].filter(Boolean).join(" ")
    }>
    <ChartRenderer spec={chart} rows={rows} height={180} {...chartProps(id)} />
  </DataComponent>;
}

export function DashboardContent() {
  const [showEarlierSection, setShowEarlierSection] = useState(false);
  return <article className="page custom-layout-page">
    <button type="button" onClick={() => setShowEarlierSection((current) => !current)}>
      Toggle earlier section
    </button>
    <SortableDashboardLayout scope="custom-smoke">
      {showEarlierSection && <section><p>Conditionally available earlier section</p></section>}
      <section className="custom-metrics" aria-label="Key metrics">
        <MetricCard id="metric-one" title="First metric" description="Reviewed explanation for the first metric."
          queryId="usage_summary" value="20" />
        <MetricCard id="metric-two" title="Second metric" description="Reviewed explanation for the second metric."
          queryId="usage_summary" value="30" />
        <MetricCard id="metric-three" title="Long reviewed cohort percentile across every selected product"
          description="Reviewed explanation for the third metric."
          queryId="usage_summary" value="40" />
      </section>
      <section id="reviewed-trend-grid" className="custom-chart-grid" aria-label="Reviewed trends">
        <Chart id="wide-trend" kind="chart" title="Wide trend" className="editorial-featured-column" />
        <Chart id="narrow-trend" kind="chart" title="Narrow trend" className="editorial-support-column" />
        <Chart id="left-trend" kind="chart" title="Left trend" className="chart-span-6" />
        <Chart id="right-trend" kind="chart" title="Right trend" className="chart-span-6" />
        <Chart id="full-trend" kind="chart" title="Full trend" className="chart-span-12" />
      </section>
      <section className="bespoke-chart-grid" aria-label="Bespoke visualizations">
        <Chart id="bespoke-one" kind="chart" title="Bespoke one" />
        <Chart id="bespoke-two" kind="chart" title="Bespoke two" />
      </section>
      <section className="visually-ordered-chart-grid" aria-label="Explicitly positioned visualizations">
        <Chart id="dom-first-visually-right" kind="chart" title="Visually right" className="authored-right-position" />
        <Chart id="dom-second-visually-left" kind="chart" title="Visually left" className="authored-left-position" />
      </section>
    </SortableDashboardLayout>
  </article>;
}
`);
writeFileSync(join(project, "src/content/dashboard/dashboard.css"), `
.custom-layout-page { display: grid; gap: 20px; padding: 24px; }
.custom-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.custom-metrics .data-metric-card { min-height: 104px; gap: 11px; padding: 16px 18px;
  background: color-mix(in srgb, var(--chart-1) 8%, var(--surface)); }
.custom-metrics .component-title { overflow: hidden; font-size: 13px; font-weight: 450; }
.custom-metrics .data-metric-value { font-size: 35px; font-weight: 650; letter-spacing: -1px; }
.custom-chart-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
.custom-chart-grid .component-title { font-size: 15px; font-weight: 610; letter-spacing: -.6px; }
.bespoke-chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-areas: "featured side"; gap: 14px; }
.visually-ordered-chart-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
.authored-right-position { grid-column: 7 / span 6; grid-row: 1; }
.authored-left-position { grid-column: 1 / span 6; grid-row: 1; }
.chart-span-8 { grid-column: span 8; }
.editorial-featured-column { grid-column: span 8; }
.editorial-support-column { grid-column: span 4; }
.chart-span-6 { grid-column: span 6; }
.chart-span-4 { grid-column: span 4; }
.chart-span-12 { grid-column: 1 / -1; }
.custom-layout-card { min-width: 0; padding: 14px; overflow: hidden; border: 1px solid var(--border); }
@media (max-width: 650px) {
  .custom-metrics, .custom-chart-grid, .bespoke-chart-grid { grid-template-columns: minmax(0, 1fr); }
  .chart-span-8, .chart-span-6, .chart-span-4, .chart-span-12,
  .editorial-featured-column, .editorial-support-column { grid-column: 1; }
}
`);

// Deliberately omit both example stylesheets: ordinary public components must
// carry their own presentation and data scope on either application surface.
async function assertDropdownInteractions(page) {
  const scope = page.getByRole("region", { name: "Dropdown behavior", exact: true });
  const values = async () => JSON.parse(await page.getByTestId("dropdown-values").textContent());
  const menu = scope.getByRole("button", { name: "Menu metric", exact: true });
  assert.match(await menu.innerText(), /Active users/u);
  await menu.locator(".filter-label").click();
  assert.equal(await page.getByRole("menu").getByText("Business", { exact: true }).isVisible(), true);
  await page.getByRole("menuitemradio", { name: "Retention rate", exact: true }).click();
  assert.equal((await values()).single, "retention");
  assert.equal(await page.getByRole("menu").count(), 0, "Scalar selection closes the menu");
  assert.match(await menu.innerText(), /Retention rate/u);

  const search = scope.getByRole("combobox", { name: "Search metric", exact: true });
  assert.equal(await search.inputValue(), "Active users");
  await search.fill("retention rate");
  const options = page.getByRole("listbox", { name: "Search metric", exact: true });
  assert.deepEqual(await options.getByRole("option").allTextContents(), ["Retention rate"]);
  await search.press("Enter");
  assert.equal((await values()).searched, "retention", "Keyboard search emits the raw reviewed choice");
  assert.equal(await search.inputValue(), "Retention rate");
  assert.equal(await search.getAttribute("aria-expanded"), "false");

  await scope.getByRole("button", { name: "Menu metrics", exact: true }).click();
  const retained = page.getByRole("menuitemcheckbox", { name: "Retention rate", exact: true });
  await retained.click();
  assert.equal(await retained.getAttribute("aria-checked"), "true");
  assert.deepEqual((await values()).multiple, ["retention"]);
  await page.getByRole("menuitemcheckbox", { name: "Revenue", exact: true }).click();
  assert.deepEqual((await values()).multiple, ["retention", "revenue"]);
  await retained.click();
  assert.deepEqual((await values()).multiple, ["revenue"]);
  await page.getByRole("menuitemcheckbox", { name: "All metrics", exact: true }).click();
  assert.deepEqual((await values()).multiple, []);
  await page.keyboard.press("Escape");

  const multi = scope.getByRole("combobox", { name: "Search metrics", exact: true });
  await multi.fill("active users");
  await multi.press("Enter");
  assert.deepEqual((await values()).searchedMultiple, ["active_users"]);
  assert.equal(await multi.getAttribute("aria-expanded"), "true", "Multiple selection keeps the menu open");
  const multiOptions = page.getByRole("listbox", { name: "Search metrics", exact: true });
  assert.equal(await multiOptions.getAttribute("aria-multiselectable"), "true");
  assert.equal(await multiOptions.getByRole("option", { name: "Active users", exact: true }).getAttribute("aria-selected"), "true");
  await multi.fill("revenue");
  await multi.press("Enter");
  assert.deepEqual((await values()).searchedMultiple, ["active_users", "revenue"]);
  await multiOptions.getByRole("option", { name: "Active users", exact: true }).click();
  assert.deepEqual((await values()).searchedMultiple, ["revenue"]);
  await multiOptions.getByRole("option", { name: "All metrics", exact: true }).click();
  assert.deepEqual((await values()).searchedMultiple, []);
  const visibleOption = multiOptions.getByRole("option", { name: "Revenue", exact: true });
  assert.equal(await visibleOption.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return element.contains(hit);
  }), true, "Options extending below the sticky filter bar remain clickable");
  await multi.press("Escape");
  assert.equal(await multi.inputValue(), "All metrics");
}

async function assertChartInteractions(page) {
  const scope = page.getByRole("region", { name: "Chart interaction regressions", exact: true });
  for (const id of ["hidden-date-line", "hidden-date-bar"]) {
    const chart = page.locator(`[data-component-id="${id}"]`);
    await chart.locator(".recharts-surface").waitFor({ state: "visible" });
    assert.equal(await chart.locator("[data-temporal-axis-tick]").count(), 0,
      `${id}: hiding date ticks must remove painted labels`);
    assert.ok(await chart.locator(".recharts-line-curve,.recharts-bar-rectangle").count() > 0,
      "Hiding the category labels must retain the chart marks");
  }
  await scope.getByRole("button", { name: "Show date labels", exact: true }).click();
  await page.waitForFunction(() => ["hidden-date-line", "hidden-date-bar"].every(id =>
    document.querySelector(`[data-component-id="${id}"] [data-temporal-axis-tick]`)));
  await scope.getByRole("button", { name: "Hide date labels", exact: true }).click();
  assert.equal(await scope.locator("[data-temporal-axis-tick]").count(), 0);

  const heatmap = page.locator('[data-component-id="heatmap-gaps"]');
  const cells = heatmap.locator("[data-heatmap-cell]");
  await cells.first().waitFor({ state: "visible" });
  assert.equal(await cells.count(), 4);
  const unknown = cells.filter({ hasText: "—" });
  assert.equal(await unknown.count(), 2, "Both null observations and absent combinations stay unobserved");
  for (const cell of await unknown.all()) {
    assert.equal(await cell.getAttribute("role"), null);
    assert.equal(await cell.getAttribute("tabindex"), null);
    await cell.locator(".chart-heatmap-cell").click();
    assert.equal(await page.getByRole("dialog", { name: "Selected chart data", exact: true }).count(), 0,
      "Clicking unobserved evidence must not open mark actions");
  }
  const observed = heatmap.locator(".chart-explore-mark");
  assert.equal(await observed.count(), 2);
  assert.equal(await observed.first().getAttribute("tabindex"), "0",
    "Keyboard entry starts at the first observed cell even when the first matrix cell is missing");
  await observed.first().focus();
  await observed.first().press("Enter");
  await page.getByRole("button", { name: "View cohort records", exact: true }).click();
  assert.equal(await page.getByTestId("selected-cohort").textContent(), "B / Week 1",
    "An observed zero remains actionable by keyboard");
  await observed.last().locator(".chart-heatmap-cell").click();
  await page.getByRole("button", { name: "View cohort records", exact: true }).click();
  assert.equal(await page.getByTestId("selected-cohort").textContent(), "A / Week 2",
    "Pointer activation selects the same reviewed row as keyboard activation");
}

async function assertIndependentComponents(browser) {
  const independent = mkdtempSync(join(tmpdir(), "data-independent-components-"));
  try {
    cpSync(template, independent, {
      recursive: true,
      filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
    });
    for (const surface of ["dashboard", "report"]) {
      writeFileSync(join(independent, `src/content/${surface}/${surface}.css`), "");
      writeFileSync(join(independent, `src/content/${surface}/${surface === "dashboard" ? "Dashboard" : "Report"}Content.jsx`),
        `export { IndependentContent as ${surface === "dashboard" ? "Dashboard" : "Report"}Content } from "../shared/IndependentContent.jsx";\n`);
    }
    writeFileSync(join(independent, "src/content/shared/IndependentContent.jsx"), `
import React from "react";
import { ChartRenderer, DataComponent, DataTable, Dropdown, Filters, MetricCard, Section, SectionHeader,
  SortableItem, SortableRegion, useDataApp, useSectionFilters } from "../../data-app-public.jsx";

const queryId = "usage_summary";
const definitions = [
  { id: "segment", field: "segment", label: "Local product", defaultValue: "all", queryIds: [queryId] },
  { id: "region", field: "region", label: "Local geography", defaultValue: "all", queryIds: [queryId] },
];
const chart = { type: "line", x: "week", y: "activeUsers" };
const tableColumns = [
  { field: "account", label: "Account", presentation: "identity", secondaryField: "region" },
  { field: "activeUsers", label: "Active users" },
  { field: "retention", label: "Retention", presentation: "percent" },
  { field: "usageTrend", label: "Usage trend", presentation: "sparkline" },
  { field: "engagementScore", label: "Engagement", presentation: "bar", max: 100 },
  { field: "riskTier", label: "Risk", presentation: "status" },
];

function ScopedSection({ id, title }) {
  const { chartOverrides, chartProps } = useDataApp();
  const scoped = useSectionFilters(definitions);
  const rows = scoped.reviewedRows(queryId);
  const chartId = id + "-chart";
  const spec = chartOverrides[chartId] ?? { type: "bar", x: "segment", y: "activeUsers" };
  const breakdown = [spec.x, spec.series].filter(Boolean);
  return <Section id={id} title={title} columns={1} spacing="content"
    filters={<Filters {...scoped.filterProps} ariaLabel={title + " filters"} />}>
    <DataComponent id={id + "-value"} title={title + " value"} queryId={queryId}
      kind="metric" variant="card" {...scoped.componentProps(queryId)}>
      <output data-testid={id + "-rows"} data-rows={JSON.stringify(rows)} data-reviewed-value>
        {rows.map((row) => row.activeUsers).join(", ") || "No matching rows"}
      </output>
    </DataComponent>
    <DataComponent id={chartId} title={title + " chart"} queryId={queryId} kind="chart" chart={spec}
      {...scoped.componentProps(queryId, breakdown)}>
      <ChartRenderer spec={spec} rows={scoped.reviewedRows(queryId, breakdown)} height={120} {...chartProps(chartId)} />
    </DataComponent>
  </Section>;
}

function DropdownControls() {
  const [single, setSingle] = React.useState("active_users");
  const [searched, setSearched] = React.useState("active_users");
  const [multiple, setMultiple] = React.useState([]);
  const [searchedMultiple, setSearchedMultiple] = React.useState([]);
  const labels = { active_users: "Active users", retention: "Retention rate", revenue: "Revenue" };
  const choices = ["all", ...Object.keys(labels)];
  const groups = [{ label: "Usage", choices: choices.slice(0, 3) }, { label: "Business", choices: ["revenue"] }];
  const props = { choices, groups, formatChoice: choice => labels[choice], allLabel: "All metrics", showLabel: true };
  return <Filters sticky ariaLabel="Dropdown behavior" queries={{}} values={{}}>
    <Dropdown {...props} label="Menu metric" value={single} onChange={setSingle} />
    <Dropdown {...props} label="Search metric" searchable value={searched} onChange={setSearched} />
    <Dropdown {...props} label="Menu metrics" multiple value={multiple} onChange={setMultiple} />
    <Dropdown {...props} label="Search metrics" searchable multiple value={searchedMultiple} onChange={setSearchedMultiple} />
    <output hidden data-testid="dropdown-values" data-reviewed-value>{JSON.stringify({ single, searched, multiple, searchedMultiple })}</output>
  </Filters>;
}

function ChartRegressionControls() {
  const { queries } = useDataApp();
  const [showDates, setShowDates] = React.useState(false);
  const [selectedCohort, setSelectedCohort] = React.useState("");
  const dates = queries.interaction_dates.rows;
  const cohortRows = queries.interaction_cohorts.rows;
  const heatmap = { type: "heatmap", x: "age", y: "retentionRate", series: "cohort",
    missingValues: "gap", showValues: true, categoryOrder: ["Week 1", "Week 2"], seriesOrder: ["A", "B"] };
  return <section aria-label="Chart interaction regressions">
    <button type="button" onClick={() => setShowDates(value => !value)}>{showDates ? "Hide date labels" : "Show date labels"}</button>
    {["line", "bar"].map(type => {
      const id = "hidden-date-" + type;
      const spec = { type, x: "week", y: "activeUsers", showCategoryTicks: showDates, showLegend: false };
      return <DataComponent key={id} id={id} title={type + " date labels"} kind="chart" queryId="interaction_dates"
        chart={spec} sourceRows={dates} displayRows={dates}>
        <ChartRenderer spec={spec} rows={dates} height={180} />
      </DataComponent>;
    })}
    <DataComponent id="heatmap-gaps" title="Observed cohort evidence" kind="chart" queryId="interaction_cohorts"
      chart={heatmap} sourceRows={cohortRows} displayRows={cohortRows}>
      <ChartRenderer spec={heatmap} rows={cohortRows} height={220}
        getMarkActions={({ row }) => [{ label: "View cohort records",
          onSelect: () => setSelectedCohort(row.cohort + " / " + row.age) }]} />
    </DataComponent>
    <output data-testid="selected-cohort" data-reviewed-value>{selectedCohort}</output>
  </section>;
}

function DateSection() {
  const scoped = useSectionFilters([{ id: "week", field: "week", label: "Local dates", mode: "through",
    defaultValue: "all", queryIds: [queryId] }], { week: "2026-07-27" });
  return <Section id="local-dates" title="Dated evidence" spacing="content"
    filters={<Filters {...scoped.filterProps} ariaLabel="Local date filters" />}>
    <output data-testid="local-date-value" data-reviewed-value>{scoped.values.week}</output>
  </Section>;
}

export function IndependentContent() {
  const { snapshot, queries, filters, setFilter, reviewedRows, chartProps } = useDataApp();
  const rows = reviewedRows(queryId);
  return <article aria-label="Independent public components">
    {snapshot.surface === "report" && <DataComponent id="report-executive-summary"
      title="Executive summary" queryId={queryId} kind="custom"><p>Reviewed component test fixture.</p></DataComponent>}
    <Filters filters={snapshot.filters} queries={queries} values={filters} onChange={setFilter}
      ariaLabel="Page filters" clearLabel="Clear page" />
    <SectionHeader id="standalone-heading" title="Independent heading" />
    <DropdownControls />
    <ChartRegressionControls />
    <Section id="cards" title="Card geometry" columns={2}>
      <DataComponent id="standard-card" title="Standard card" queryId={queryId} kind="custom" variant="card">
        <p data-reviewed-value>Standard padding</p>
      </DataComponent>
      <DataComponent id="spacious-card" title="Spacious card" queryId={queryId} kind="custom" variant="card" padding="spacious">
        <p data-reviewed-value>Spacious padding</p>
      </DataComponent>
    </Section>
    <Section id="metrics" title="Independent metrics" columns={2} kind="metrics" spacing="metrics">
      <MetricCard id="standalone-metric" title="Standalone metric" queryId={queryId} value="100" />
      <DataComponent id="plain-metric" title="Plain metric" queryId={queryId} kind="metric">
        <p data-reviewed-value>100</p>
      </DataComponent>
    </Section>
    <Section id="plain-chart-section" title="Plain evidence" spacing="after-metrics">
      <DataComponent id="plain-chart" title="Plain chart" queryId={queryId} kind="chart" chart={chart}>
        <ChartRenderer spec={chart} rows={rows} height={120} {...chartProps("plain-chart")} />
      </DataComponent>
    </Section>
    <ScopedSection id="local-a" title="First section" />
    <ScopedSection id="local-b" title="Second section" />
    <DataComponent id="shared-funnel" title="Conversion funnel" queryId="funnel" kind="chart"
      variant="card" chart={{ type: "funnel", x: "stage", y: "count" }}
      sourceRows={queries.funnel.rows} displayRows={queries.funnel.rows}>
      <ChartRenderer spec={{ type: "funnel", x: "stage", y: "count" }} rows={queries.funnel.rows}
        height={240} {...chartProps("shared-funnel")} />
    </DataComponent>
    <DataComponent id="funnel-gaps" title="Missing-stage funnel" queryId="funnel_quality" kind="chart"
      chart={{ type: "funnel", x: "stage", y: "count" }}>
      <ChartRenderer spec={{ type: "funnel", x: "stage", y: "count", colors: { A: "red", B: "green", C: "blue" } }}
        rows={queries.funnel_quality.rows} height={180} />
    </DataComponent>
    <DataComponent id="funnel-ratios" title="Ratio funnel" queryId="funnel_quality" kind="chart"
      chart={{ type: "funnel", x: "stage", y: "conversionRate" }}>
      <ChartRenderer spec={{ type: "funnel", x: "stage", y: "conversionRate" }}
        rows={queries.funnel_quality.rows} height={180} />
    </DataComponent>
    <DataComponent id="funnel-repeated" title="Repeated-stage funnel" queryId="funnel_repeated" kind="chart"
      chart={{ type: "funnel", x: "stage", y: "count" }} sourceRows={queries.funnel_repeated.rows}>
      <ChartRenderer spec={{ type: "funnel", x: "stage", y: "count" }}
        rows={queries.funnel_repeated.rows} height={240} {...chartProps("funnel-repeated")} />
    </DataComponent>
    <DateSection />
    <Section id="rich-table-section" title="Independent rich table" spacing="content">
      <DataComponent id="rich-table" title="Reviewed accounts" queryId="rich_table" kind="table">
        <DataTable rows={reviewedRows("rich_table")} columns={tableColumns} searchable={false} />
      </DataComponent>
    </Section>
    <Section id="no-spacing" title="No extra spacing" spacing="none"
      filters={<Filters filters={[]} />}><p>Fixed composition.</p></Section>
    <Section id="continuation-spacing" title="Continued evidence" spacing="continuation">
      <div>Reviewed continuation content.</div>
    </Section>
    {snapshot.surface === "dashboard" && <SortableRegion id="independent:canvas" label="Independent canvas"
      variant="canvas" spacing="standard" columns={12} rows={[
        { id: "canvas-metrics", items: ["canvas-one", "canvas-two"], kind: "metrics", spacing: "metrics",
          header: <SectionHeader id="canvas-heading" title="Canvas metrics" filters={<Filters filters={[]} />} /> },
        { id: "canvas-content", items: ["canvas-three"], spacing: "after-metrics" },
        { id: "canvas-continuation", items: ["canvas-four"], spacing: "continuation" },
      ]}>
      <SortableItem id="canvas-one" kind="metric" span={6}><MetricCard id="canvas-one" title="Canvas one" queryId={queryId} value="40" /></SortableItem>
      <SortableItem id="canvas-two" kind="metric" span={6}><MetricCard id="canvas-two" title="Canvas two" queryId={queryId} value="60" /></SortableItem>
      <SortableItem id="canvas-three" kind="custom" span={12}><DataComponent id="canvas-three" title="Canvas content"
        queryId={queryId} kind="custom" variant="card"><p>Reviewed canvas content.</p></DataComponent></SortableItem>
      <SortableItem id="canvas-four" kind="custom" span={12}><DataComponent id="canvas-four" title="Continued canvas content"
        queryId={queryId} kind="custom" variant="card"><p>Reviewed continuation content.</p></DataComponent></SortableItem>
    </SortableRegion>}
  </article>;
}
`);
    const snapshot = JSON.parse(readFileSync(join(template, "src/data.json"), "utf8"));
    snapshot.filters = [{ id: "segment", field: "segment", label: "Page product", defaultValue: "all" }];
    snapshot.queries = { funnel_quality: { source: snapshot.queries.usage_summary.source, rows: [
      { stage: "A", count: 100, conversionRate: 1 }, { stage: "B", count: null, conversionRate: .6 },
      { stage: "C", count: 25, conversionRate: .312345 },
    ] }, funnel: { source: snapshot.queries.usage_summary.source, rows: [
      { stage: "Visited", count: 100000 }, { stage: "Signed up", count: 75000 },
      { stage: "Started", count: 60000 }, { stage: "Invited", count: 45000 },
      { stage: "Shared", count: 30000 }, { stage: "Returned", count: 20000 },
      { stage: "Purchased", count: 12000 }, { stage: "Activated", count: 6000 },
    ] }, rich_table: { source: snapshot.queries.account_health.source, rows: [
      { account: "Alpha", region: "North America", activeUsers: 1234, retention: .92,
        usageTrend: [2, 4, 8], engagementScore: 75, riskTier: "High risk" },
      { account: "Beta", region: "EMEA", activeUsers: 840, retention: .75,
        usageTrend: [9, 6, 3], engagementScore: 90, riskTier: "Moderate" },
      { account: "Gamma", region: "APAC", activeUsers: 320, retention: .6,
        usageTrend: [3, 5, 7], engagementScore: 30, riskTier: "Low risk" },
      ...[0, null, "", "unknown"].map((engagementScore, index) => ({
        account: `Incomplete ${index}`, engagementScore,
      })),
    ] }, usage_summary: { ...snapshot.queries.usage_summary, source: {
      ...snapshot.queries.usage_summary.source,
      evidenceFlow: [{ title: "Reviewed population", detail: "All products in the captured source." }],
    }, rows: [
      { week: "2026-07-27", segment: "all", region: "all", activeUsers: 100 },
      { week: "2026-07-27", segment: "Studio", region: "North America", activeUsers: 40 },
      { week: "2026-07-27", segment: "Search", region: "EMEA", activeUsers: 60 },
    ] } };

    snapshot.queries.interaction_dates = { source: snapshot.queries.usage_summary.source, rows: [
      { week: "2026-07-27", activeUsers: 10 }, { week: "2026-07-28", activeUsers: 14 },
      { week: "2026-07-29", activeUsers: 12 },
    ] };
    snapshot.queries.interaction_cohorts = { source: snapshot.queries.usage_summary.source, rows: [
      { age: "Week 1", cohort: "A", retentionRate: null },
      { age: "Week 2", cohort: "A", retentionRate: .5 },
      { age: "Week 1", cohort: "B", retentionRate: 0 },
    ] };
    snapshot.queries.funnel_repeated = { ...snapshot.queries.funnel, rows: [
      { stage: "UnbrokenStageName".repeat(6), count: 1e20 }, { stage: null, count: 80 },
      { stage: "UnbrokenStageName".repeat(6), count: 60 }, { stage: "Last", count: 20 },
    ] };
    for (const surface of ["dashboard", "report"]) {
      writeFileSync(join(independent, "src/data.json"), JSON.stringify({ ...snapshot, surface }));
      const build = runDataAppFixtureBuild(independent, { pluginRoot });
      assert.equal(build.status, 0, `${surface} independent build: ${build.stdout}\n${build.stderr}`);
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, hasTouch: true });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await installDashboardBrowserMocks(page);
      await page.goto(pathToFileURL(join(independent, "dist/index.html")).href, { waitUntil: "load" });
      if (surface === "dashboard") {
        for (const [width, top, bottom] of [[1440, 24, 96], [390, 18, 56]]) {
          await page.setViewportSize({ width, height: 1100 });
          await page.locator("main > article").waitFor();
          const edges = await page.locator("main").evaluate((main) => {
            const page = main.getBoundingClientRect();
            const content = main.firstElementChild.getBoundingClientRect();
            return { top: content.top - page.top, bottom: page.bottom - content.bottom };
          });
          assert.deepEqual(edges, { top, bottom },
            `Dashboard page edges must retain breathing room at ${width}px without example CSS`);
        }
        await page.setViewportSize({ width: 1440, height: 1100 });
      }
      if (surface === "dashboard") await assertDropdownInteractions(page);
      await assertChartInteractions(page);
      const component = (id) => page.locator(`[data-component-id="${id}"]`);
      const section = (id) => page.locator(`[data-editable-id="${id}"]`).locator("xpath=ancestor::section[1]");
      const localRows = async (id) => JSON.parse(await page.getByTestId(`${id}-rows`).getAttribute("data-rows"));
      const selectProduct = async (region, label, value, keyboard = false) => {
        const trigger = page.getByRole("region", { name: region, exact: true }).getByRole("button", { name: label, exact: true });
        if (keyboard) {
          // The nonmodal source drawer covers pointer access to the page. Drive
          // the existing controlled filter by keyboard without dismissing it.
          await trigger.focus();
          await trigger.press("Enter");
          const choice = page.getByRole("menuitemradio", { name: value, exact: true });
          await choice.focus();
          await choice.press("Enter");
        } else {
          await trigger.click();
          await page.getByRole("menuitemradio", { name: value, exact: true }).click();
        }
      };
      for (const id of ["standalone-heading", "cards", "metrics", "local-a", "local-b"]) {
        assert.equal(await page.locator(`[data-editable-id="${id}"]`).count(), 1,
          `${surface} section headings expose their authored stable editing identity`);
      }
      assert.equal(await page.locator('[data-editable-id="standalone-heading"]').locator("..").locator(".filters").count(), 0,
        "SectionHeader must support a heading without a filter slot");

      for (const [theme, radius] of [["Classic", 20], ["Neutral", 16], ["Dark pixel", 0], ["Scientific blue", 8], ["Sticker pop", 24]]) {
        if (!(await page.getByRole("region", { name: "Theme picker" }).isVisible())) {
          const menu = page.getByRole("menu", { name: "More", exact: true });
          if (!(await menu.isVisible())) await page.getByRole("button", { name: "More", exact: true }).click();
          await menu.getByRole("menuitem", { name: "Switch theme", exact: true }).click();
        }
        await page.getByRole("button", { name: `Apply ${theme}`, exact: true }).click();
        const controlHeights = await page.locator("main .filter-trigger").evaluateAll((controls) =>
          controls.map((control) => ({ label: control.textContent, height: control.getBoundingClientRect().height }))
            .filter((control) => control.height > 0));
        assert.ok(controlHeights.length > 0, `${surface}/${theme} must render shared filters`);
        for (const control of controlHeights) {
          assert.ok(control.height >= 32 && control.height <= 44,
            `${surface}/${theme}/${control.label} has an unusable control height: ${control.height}`);
        }
        for (const [id, padding] of [["standard-card", [16, 20, 16, 20]], ["spacious-card", [20, 20, 20, 20]],
          ["standalone-metric", [20, 20, 20, 20]]]) {
          const geometry = await component(id).evaluate((element) => {
            const style = getComputedStyle(element);
            return { radius: parseFloat(style.borderTopLeftRadius),
              padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(parseFloat),
              variant: element.dataset.componentVariant };
          });
          assert.deepEqual(geometry, { radius, padding, variant: "card" },
            `${surface}/${theme}/${id} must retain shared geometry without example styles`);
        }
        for (const id of ["plain-metric", "plain-chart"]) {
          const geometry = await component(id).evaluate((element) => {
            const style = getComputedStyle(element);
            return { padding: style.padding, border: style.borderTopWidth, radius: style.borderTopLeftRadius,
              background: style.backgroundColor, shadow: style.boxShadow, surfaces: element.querySelectorAll(".smooth-card-surface").length };
          });
          assert.deepEqual(geometry, { padding: "0px", border: "0px", radius: "0px",
            background: "rgba(0, 0, 0, 0)", shadow: "none", surfaces: 0 },
          `${surface}/${theme}/${id} must stay unframed`);
        }
      }
      await page.keyboard.press("Escape");
      for (const [id, padding, gap] of [["cards", 40, 20], ["metrics", 16, 12],
        ["plain-chart-section", 32, 20], ["local-a", 20, 20], ["no-spacing", 0, 20],
        ["continuation-spacing", 20, 20]]) {
        const geometry = await section(id).evaluate((element) => {
          const style = getComputedStyle(element);
          return { padding: parseFloat(style.paddingTop), gap: parseFloat(style.columnGap) };
        });
        assert.deepEqual(geometry, { padding, gap }, `${surface}/${id} shared spacing`);
        if (id !== "no-spacing") {
          const headerGap = await section(id).evaluate((element) => {
            const header = element.querySelector(":scope > .data-section-header");
            return header.nextElementSibling.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
          });
          assert.equal(headerGap, 20, `${surface}/${id} visible heading-to-content gap`);
        }
      }
      if (surface === "dashboard") {
        const canvas = await page.locator('[data-sortable-row="canvas-metrics"]').evaluate((element) => {
          const style = getComputedStyle(element);
          const header = element.querySelector(".sortable-row-header");
          return { padding: parseFloat(style.paddingTop), gap: parseFloat(style.columnGap),
            headerGap: element.querySelector(".sortable-item").getBoundingClientRect().top - header.getBoundingClientRect().bottom,
            heading: element.querySelector('[data-editable-id="canvas-heading"]')?.textContent };
        });
        assert.deepEqual(canvas, { padding: 16, gap: 12, headerGap: 20, heading: "Canvas metrics" },
          "Canvas row metadata must use the shared metric spacing and heading presentation");
        const continuationGap = await page.evaluate(() =>
          document.querySelector('[data-component-id="canvas-four"]').getBoundingClientRect().top
          - document.querySelector('[data-component-id="canvas-three"]').getBoundingClientRect().bottom);
        assert.equal(continuationGap, 20, "Continuation cards must have a real 20px edge-to-edge gap");
      }

      const richTable = component("rich-table");
      const accountHeader = richTable.locator("th").first();
      await accountHeader.getByRole("button").click();
      assert.equal(await accountHeader.getAttribute("aria-sort"), "ascending");
      await accountHeader.getByRole("button").click();
      assert.equal(await accountHeader.getAttribute("aria-sort"), "descending");
      assert.match(await richTable.locator("tbody tr").first().innerText(), /Incomplete 3/u);
      await accountHeader.getByRole("button").click();
      assert.match(await richTable.locator("tbody tr").first().innerText(), /Alpha/u);
      const tableRegion = richTable.getByRole("region", { name: "Reviewed data table", exact: true });
      await page.setViewportSize({ width: 390, height: 1100 });
      await page.waitForFunction(() => document.querySelector('[data-component-id="rich-table"] .table-wrap')?.tabIndex === 0);
      assert.equal(await tableRegion.evaluate(element => element.scrollWidth > element.clientWidth), true);
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.waitForFunction(() => !document.querySelector('[data-component-id="rich-table"] .table-wrap')?.hasAttribute("tabindex"));
      const richGeometry = await richTable.evaluate((element) => {
        const style = (selector) => getComputedStyle(element.querySelector(selector));
        const bounds = (selector) => {
          const { width, height } = element.querySelector(selector).getBoundingClientRect();
          return { width, height };
        };
        const identity = element.querySelector(".table-identity");
        return {
          identity: { display: style(".table-identity").display,
            secondarySize: style(".table-identity > span").fontSize,
            secondaryBelow: identity.lastElementChild.getBoundingClientRect().top
              >= identity.firstElementChild.getBoundingClientRect().bottom },
          percentage: { text: element.querySelector(".table-cell-percent").textContent,
            align: style(".table-cell-percent").textAlign },
          numericAlign: style("td.numeric").textAlign,
          sparkline: bounds(".table-sparkline"),
          trendColors: [...element.querySelectorAll(".table-sparkline")].map((entry) => getComputedStyle(entry).color),
          distribution: bounds(".table-data-bar-track"),
          marker: bounds(".table-distribution-marker"),
          bars: [...element.querySelectorAll(".table-data-bar-track")][0].querySelectorAll(".table-data-bar-segment").length,
          paintedBars: [...element.querySelectorAll(".table-data-bar-segment")].every((bar) => {
            const rect = bar.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && getComputedStyle(bar).backgroundColor !== "rgba(0, 0, 0, 0)";
          }),
          statuses: [...element.querySelectorAll(".table-status")].map((entry) => ({
            tone: entry.dataset.status, display: getComputedStyle(entry).display,
            padding: getComputedStyle(entry).padding, size: getComputedStyle(entry).fontSize,
            color: getComputedStyle(entry).color, background: getComputedStyle(entry).backgroundColor,
          })),
        };
      });
      assert.deepEqual(richGeometry.identity, { display: "grid", secondarySize: "12px", secondaryBelow: true },
        `${surface} identity cells must stack their secondary labels without dashboard CSS`);
      assert.deepEqual(richGeometry.percentage, { text: "92%", align: "right" });
      assert.equal(richGeometry.numericAlign, "right");
      assert.deepEqual(richGeometry.sparkline, { width: 112, height: 28 }, `${surface} rich-table sparkline dimensions`);
      assert.notEqual(richGeometry.trendColors[0], richGeometry.trendColors[1],
        "Positive and negative reviewed sparklines must retain distinct theme colors");
      assert.deepEqual(richGeometry.distribution, { width: 112, height: 22 });
      assert.deepEqual(richGeometry.marker, { width: 2, height: 26 });
      assert.equal(richGeometry.bars, 12);
      assert.equal(richGeometry.paintedBars, true, `${surface} distribution cells need actual visible bars`);
      assert.deepEqual(richGeometry.statuses.slice(0, 3).map(({ tone }) => tone), ["negative", "warning", "positive"]);
      assert.equal(new Set(richGeometry.statuses.slice(0, 3).map(({ color }) => color)).size, 3);
      assert.ok(richGeometry.statuses.slice(3).every(({ tone }) => tone === "neutral"),
        "Missing statuses must remain neutral rather than acquire a risk color");
      for (const status of richGeometry.statuses) {
        assert.equal(status.display, "inline-flex");
        assert.equal(status.padding, "2px 8px");
        assert.equal(status.size, "12px");
        assert.notEqual(status.background, "rgba(0, 0, 0, 0)");
      }
      const trendVisual = richTable.locator(".table-cell-sparkline .table-visual-trigger").first();
      await trendVisual.hover({ position: { x: 2, y: 10 } });
      const trendTooltip = page.getByRole("tooltip").filter({ hasText: "Usage trend" });
      assert.equal(await trendTooltip.locator("strong").innerText(), "2");
      await trendVisual.hover({ position: { x: 110, y: 10 } });
      assert.equal(await trendTooltip.locator("strong").innerText(), "8",
        "Rich-table hover must track the reviewed observation");
      await page.mouse.move(0, 0);
      await trendVisual.focus();
      await trendTooltip.waitFor({ state: "visible" });
      assert.equal(await trendTooltip.locator("strong").innerText(), "8",
        "Keyboard focus must expose the latest reviewed sparkline value");
      assert.equal(await trendVisual.getAttribute("aria-describedby"), await trendTooltip.getAttribute("id"));
      assert.equal(await trendTooltip.evaluate((element) => element.parentElement === document.body), true);
      const distributionVisual = richTable.locator(".table-cell-bar .table-visual-trigger").first();
      await distributionVisual.focus();
      const distributionTooltip = page.getByRole("tooltip").filter({ hasText: "Engagement" });
      assert.match(await distributionTooltip.innerText(), /75.*75th percentile/u,
        "Keyboard focus must explain the reviewed engagement score and distribution position");
      const distributionCells = richTable.locator(".table-cell-bar");
      await distributionCells.nth(3).locator(".table-visual-trigger").focus();
      assert.match(await distributionTooltip.innerText(), /0.*25th percentile/u, "Zero is a reviewed score");
      for (const index of [4, 5, 6]) {
        await distributionCells.nth(index).locator(".table-visual-trigger").focus();
        assert.equal(await distributionTooltip.locator("strong").innerText(), "No reviewed value");
        assert.equal(await distributionCells.nth(index).locator(".table-distribution-marker").count(), 0);
      }
      await distributionVisual.evaluate((element) => element.blur());

      assert.deepEqual((await localRows("local-a")).map((row) => row.activeUsers), [100]);
      await selectProduct("First section filters", "Local product", "Studio");
      assert.deepEqual((await localRows("local-a")).map((row) => row.activeUsers), [40],
        "Local exact filtering must retain detail hidden by the page All aggregate");
      assert.deepEqual((await localRows("local-b")).map((row) => row.activeUsers), [100],
        "A local change must not mutate another section with the same filter ID");
      await component("local-a-value").getByRole("button", { name: "First section value actions" }).click();
      await page.getByRole("menuitem", { name: "Copy data", exact: true }).click();
      const copied = await page.evaluate(() => window.__dashboardClipboard.at(-1));
      assert.match(copied, /Studio/u, "Component copy must use locally displayed rows");
      assert.doesNotMatch(copied, /Search/u, "Component copy must not leak unselected detail rows");
      await component("local-a-value").getByRole("button", { name: "First section value actions" }).click();
      await page.getByRole("menuitem", { name: "View data source", exact: true }).click();
      const inspector = page.getByRole("complementary", { name: "Data source for First section value" });
      await inspector.getByRole("tab", { name: "Evidence flow", exact: true }).click();
      assert.match(await inspector.innerText(), /Local product: Studio/u,
        "Source evidence must retain the local scope metadata");
      assert.match(await inspector.innerText(), /All products in the captured source/u,
        "Current scope must supplement, not rewrite, the authored source evidence");
      assert.equal(await inspector.locator('.source-trace[data-evidence-origin="provided"]').count(), 1);
      assert.match(await inspector.innerText(), /Current component filters/u,
        "Authored evidence must distinguish current component scope from the original population");
      await inspector.getByRole("tab", { name: "Data preview", exact: true }).click();
      assert.equal(await inspector.locator("tbody tr").count(), 1,
        "Source inspection must show exactly the locally displayed reviewed rows");
      assert.match(await inspector.locator("tbody").innerText(), /Studio/u);
      await inspector.evaluate((element) => { element.dataset.smokeOpenInstance = "original"; });
      await selectProduct("First section filters", "Local product", "Search", true);
      assert.deepEqual((await localRows("local-a")).map((row) => row.activeUsers), [60]);
      assert.equal(await inspector.getAttribute("data-smoke-open-instance"), "original",
        "A scope change must update the existing source drawer without remounting it");
      assert.match(await inspector.locator("tbody").innerText(), /Search/u,
        "The currently open source preview must follow local rows");
      assert.doesNotMatch(await inspector.locator("tbody").innerText(), /Studio/u);
      await inspector.getByRole("tab", { name: "Evidence flow", exact: true }).click();
      assert.match(await inspector.innerText(), /Local product: Search/u,
        "The currently open source evidence must follow local scope metadata");
      assert.doesNotMatch(await inspector.innerText(), /Local product: Studio/u,
        "An open authored evidence flow must not retain its previous section filter");
      await selectProduct("First section filters", "Local product", "Studio", true);
      assert.match(await inspector.innerText(), /Local product: Studio/u);
      await inspector.getByRole("button", { name: "Close data source" }).click();

      await component("local-a-chart").getByRole("button", { name: "First section chart actions" }).click();
      await page.getByRole("menuitem", { name: "Edit chart", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "First section chart", exact: true });
      await editor.locator('.explorer-chart[data-ready="true"]').waitFor();
      const editorMotion = await editor.evaluate(element => ({ animation: getComputedStyle(element).animationName,
        transform: getComputedStyle(element).transform, x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y }));
      assert.equal(editorMotion.animation, "none", "Fullscreen editor must not inherit centered dialog motion");
      assert.equal(editorMotion.transform, "none");
      assert.equal(editorMotion.x, 0); assert.equal(editorMotion.y, 0);
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(await editor.locator(".explorer-controls").evaluate(element => getComputedStyle(element).animationName), "none");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      assert.match(await editor.locator(".explorer-chart svg").textContent(), /Studio/u,
        "The chart editor preview must start from the local section rows");
      assert.doesNotMatch(await editor.locator(".explorer-chart svg").textContent(), /Search/u);
      await editor.getByRole("textbox", { name: "X axis title", exact: true }).fill("Scoped product");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      assert.match(await component("local-a-chart").innerText(), /Scoped product/u,
        "The authored local chart must apply its saved shared chart override");
      await component("local-a-chart").getByRole("button", { name: "First section chart actions" }).click();
      await page.getByRole("menuitem", { name: "Copy data", exact: true }).click();
      const chartCopy = await page.evaluate(() => window.__dashboardClipboard.at(-1));
      assert.match(chartCopy, /Studio/u);
      assert.doesNotMatch(chartCopy, /Search/u, "Saving a local chart must preserve scoped copy rows");

      await component("standard-card").locator('.smooth-card-surface[data-ready="true"]').waitFor({ state: "attached" });
      await page.emulateMedia({ media: "print" });
      const printed = await component("standard-card").evaluate((element) => {
        const style = getComputedStyle(element);
        return { svg: getComputedStyle(element.querySelector(".smooth-card-surface")).display,
          nativeBackground: style.backgroundColor, nativeBorder: style.borderTopColor,
          borderWidth: style.borderTopWidth };
      });
      assert.equal(printed.svg, "none", "Print must not paint stale screen-sized smooth card SVGs");
      assert.notEqual(printed.nativeBackground, "rgba(0, 0, 0, 0)", "Print must paint the native card background");
      assert.notEqual(printed.nativeBorder, "rgba(0, 0, 0, 0)", "Print must paint the native card border");
      assert.equal(printed.borderWidth, "1px");
      const printedFilter = page.getByRole("region", { name: "First section filters", exact: true })
        .getByRole("button", { name: "Local product", exact: true });
      assert.equal(await printedFilter.isVisible(), true, "Printed local filter values must remain visible");
      assert.match(await printedFilter.innerText(), /Studio/u);
      await page.emulateMedia({ media: null });

      const funnel = component("shared-funnel");
      assert.deepEqual(await funnel.locator(".chart-funnel-stage-name").allTextContents(),
        ["Visited", "Signed up", "Started", "Invited", "Shared", "Returned", "Purchased", "Activated"]);
      assert.deepEqual(await funnel.locator(".chart-funnel-stage-share").allTextContents(),
        ["100%", "75%", "60%", "45%", "30%", "20%", "12%", "6%"]);
      assert.equal(await funnel.locator(".chart-funnel-caption").count(), 0);
      const stageColors = () => funnel.locator('stop[data-stage-stop="start"]').evaluateAll(
        (stops) => stops.map((stop) => getComputedStyle(stop).stopColor));
      const restingColors = await stageColors();
      assert.equal(new Set(restingColors).size, 8, "Stages need distinct tonal shades");
      const valueType = (element) => {
        const style = getComputedStyle(element);
        return [style.fontFamily, style.fontSize, style.lineHeight, style.fontWeight, style.letterSpacing];
      };
      const funnelValueType = await funnel.locator(".chart-funnel-stage-value").first().evaluate(valueType);
      const metricValueType = await component("standalone-metric").locator(".metric-value").evaluate(valueType);
      assert.equal(funnelValueType[0], metricValueType[0]);
      assert.equal(funnelValueType[3], metricValueType[3], "Responsive values retain shared KPI family and weight");
      await component("plain-chart").locator(".recharts-wrapper").hover();
      const sharedTooltipType = await component("plain-chart").locator(".chart-tooltip").evaluate(valueType);
      const signup = funnel.getByRole("button", { name: "Signed up: 75,000, 75% of Visited", exact: true });
      await signup.hover();
      let funnelTooltip = funnel.getByRole("tooltip");
      await funnelTooltip.waitFor();
      assert.deepEqual(await funnelTooltip.locator(".chart-tooltip").evaluate(valueType), sharedTooltipType,
        "Funnel tooltip typography must match shared Recharts tooltips on both surfaces");
      assert.match(await funnelTooltip.innerText(), /75,000/u, "Funnel tooltips show exact rather than compact counts");
      assert.match(await funnelTooltip.innerText(), /Drop-off.*25,000/su);
      assert.equal(await funnelTooltip.locator(".chart-tooltip-heading b").innerText(), "75,000");
      assert.match(await funnelTooltip.innerText(), /Visited → Signed up.*75%/su);
      assert.match(await funnelTooltip.innerText(), /Drop-off.*−25,000/su);
      assert.doesNotMatch(await funnelTooltip.innerText(), /of Visited|Exact count/u);
      assert.deepEqual((await stageColors()).map((color, index) => color !== restingColors[index]),
        [false, true, false, false, false, false, false, false], "Only the active ribbon segment should highlight");
      assert.equal(await signup.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)",
        "Hover must not paint an unrelated full-column background");
      await signup.click();
      await page.getByRole("dialog", { name: "Selection actions", exact: true }).waitFor();
      assert.equal(await page.locator(".dashboard-ask-selected-region").count(), 1,
        "Funnel stages must still support mark-level Ask selection");
      await page.keyboard.press("Escape");
      await funnel.getByRole("button", { name: "Started: 60,000, 60% of Visited", exact: true }).focus();
      assert.match(await funnelTooltip.innerText(), /Signed up → Started.*80%/su,
        "Step conversion must use the previous stage denominator, not the first stage");
      assert.doesNotMatch(await funnelTooltip.innerText(), /60%/u);
      await page.keyboard.press("Escape");
      assert.equal(await funnelTooltip.count(), 0);
      for (const [width, layout, size] of [[1152, "horizontal", "32px"], [1040, "compact", "24px"], [360, "vertical", "24px"]]) {
        await funnel.locator(".chart-funnel").evaluate((element, value) => { element.style.width = `${value}px`; }, width);
        await page.waitForFunction(({ width, layout }) => {
          const element = document.querySelector('[data-component-id="shared-funnel"] .chart-funnel');
          return element.dataset.funnelLayout === layout && Math.abs(element.clientWidth - width) < 1;
        }, { width, layout });
        assert.equal(await funnel.locator(".chart-funnel-stage-value").first().evaluate((element) => getComputedStyle(element).fontSize), size);
        assert.equal(await funnel.locator(".chart-funnel-ribbon").isVisible(), layout !== "vertical");
        if (layout === "vertical") {
          const widths = await funnel.locator(".chart-funnel-stage-bar-fill").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
          assert.ok(Math.abs(widths[1] / widths[0] - .75) < .001, "Vertical bar length must preserve stage proportions");
          assert.equal(await funnel.locator(".chart-funnel-stage-bar-fill").first().evaluate((element) => getComputedStyle(element).borderTopLeftRadius), "6px",
            "Sticker pop (the last applied theme) keeps its capped bar radius in vertical rendering");
        }
      }
      await funnel.locator(".chart-funnel").evaluate((element) => { element.style.removeProperty("width"); });
      await funnel.getByRole("button", { name: "Conversion funnel actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Edit chart", exact: true }).click();
      const funnelEditor = page.getByRole("dialog", { name: "Conversion funnel", exact: true });
      await funnelEditor.locator('.explorer-chart[data-ready="true"]').waitFor();
      await funnelEditor.getByRole("button", { name: "Cancel", exact: true }).hover();
      const funnelColors = await funnelEditor.evaluate((element) => ({
        marks: [...element.querySelectorAll('stop[data-stage-stop="start"]')].map((stop) => getComputedStyle(stop).stopColor),
        controls: [...element.querySelectorAll(".explorer-color-trigger > i")].map((swatch) => getComputedStyle(swatch).backgroundColor),
      }));
      assert.equal(funnelColors.marks.length, 8);
      assert.deepEqual(funnelColors.controls, funnelColors.marks, "Funnel editor swatches must describe the colors actually rendered");
      await funnelEditor.getByRole("button", { name: "Cancel", exact: true }).click();
      await funnelEditor.waitFor({ state: "hidden" });
      const repeated = component("funnel-repeated");
      await repeated.getByRole("button", { name: "Repeated-stage funnel actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Edit chart", exact: true }).click();
      const repeatedEditor = page.getByRole("dialog", { name: "Repeated-stage funnel", exact: true });
      await repeatedEditor.locator('.explorer-chart[data-ready="true"]').waitFor();
      await repeatedEditor.getByRole("button", { name: "Cancel", exact: true }).hover();
      const repeatedColors = await repeatedEditor.evaluate((element) => ({
        marks: [...element.querySelectorAll('stop[data-stage-stop="start"]')].map((stop) => getComputedStyle(stop).stopColor),
        controls: [...element.querySelectorAll(".explorer-color-trigger > i")].map((swatch) => getComputedStyle(swatch).backgroundColor),
      }));
      assert.deepEqual(repeatedColors.controls, [repeatedColors.marks[0], repeatedColors.marks[3]],
        "Repeated names use their first occurrence tint; unnamed stages still occupy a tint position");
      await repeatedEditor.getByRole("button", { name: "Cancel", exact: true }).click();
      await repeatedEditor.waitFor({ state: "hidden" });
      const gaps = component("funnel-gaps");
      assert.equal(await gaps.locator(".chart-funnel-band").count(), 2, "Missing values must leave a real break in the ribbon");
      assert.deepEqual(await gaps.locator("linearGradient").evaluate((gradient) => ({
        units: gradient.getAttribute("gradientUnits"), width: gradient.x2.baseVal.value,
      })), { units: "userSpaceOnUse", width: 300 }, "Disconnected paths must use one color coordinate system, not restart the gradient");
      assert.equal(await gaps.locator(".chart-funnel-stage-value").nth(1).textContent(), "—");
      const ratios = component("funnel-ratios");
      await ratios.getByRole("button", { name: "B: 60%, 60% of A", exact: true }).focus();
      assert.match(await ratios.getByRole("tooltip").innerText(), /A → B.*60%/su);
      assert.match(await ratios.getByRole("tooltip").innerText(), /Drop-off.*−40 pp/su);
      await ratios.locator(".chart-funnel-stage").nth(2).focus();
      assert.equal(await ratios.locator(".chart-tooltip-heading b").innerText(), "31.2345%",
        "Rounded ratio labels must expose the precise reviewed percentage");
      await gaps.locator(".chart-funnel-stage").nth(2).focus();
      assert.equal(await gaps.locator(".chart-tooltip-heading b").innerText(), "25");
      assert.match(await gaps.getByRole("tooltip").innerText(), /B → C.*—.*Drop-off.*—/su);
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 390, height: 844 });
      await signup.tap();
      const pinned = funnel.getByRole("dialog", { name: "Signed up details", exact: true });
      await pinned.waitFor();
      assert.equal(await page.getByRole("dialog", { name: "Selection actions", exact: true }).count(), 0,
        "A touch inspection must not automatically open Ask selection");
      assert.equal(await pinned.evaluate((element) => element.contains(document.activeElement)), true);
      await pinned.getByRole("button", { name: "Done", exact: true }).tap();
      await pinned.waitFor({ state: "hidden" });
      assert.equal(await signup.evaluate((element) => element === document.activeElement), true,
        "Dismissal returns focus to the inspected stage");
      assert.equal(await funnelTooltip.count(), 0, "Restoring focus must not immediately reopen details");
      await signup.tap();
      await pinned.waitFor();
      await page.keyboard.press("Escape");
      await pinned.waitFor({ state: "hidden" });
      assert.equal(await signup.evaluate((element) => element === document.activeElement), true);
      await signup.tap();
      await pinned.waitFor();
      await pinned.getByRole("button", { name: "Ask about this stage", exact: true }).tap();
      await page.getByRole("dialog", { name: "Selection actions", exact: true }).waitFor();
      assert.equal(await page.locator(".dashboard-ask-selected-region").count(), 1);
      await page.keyboard.press("Escape");
      await signup.tap();
      await pinned.waitFor();
      const outside = funnel.getByRole("combobox", { name: "Conversion funnel actions", exact: true });
      await page.getByRole("heading", { name: "Independent heading", exact: true }).tap();
      await pinned.waitFor({ state: "hidden" });
      await outside.focus();
      await page.keyboard.press("Tab");
      await funnelTooltip.waitFor();
      assert.match(await funnelTooltip.innerText(), /Visited/u,
        "Keyboard entry after touch dismissal must not inherit stale touch modality");
      await page.keyboard.press("Escape");
      await repeated.locator(".chart-funnel-stage").first().focus();
      assert.equal(await repeated.getByRole("tooltip").evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return [...element.querySelectorAll(".chart-tooltip, strong, span, b")].every((child) => {
          const rect = child.getBoundingClientRect();
          return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
        });
      }), true, "Long stage names and exact large values must fit within the mobile tooltip");
      assert.equal(await repeated.getByRole("tooltip").locator(".chart-tooltip > span").count(), 0,
        "The first stage has no previous stage to compare");
      const lastStage = funnel.getByRole("button", { name: "Activated: 6,000, 6% of Visited", exact: true });
      await lastStage.focus();
      await funnelTooltip.waitFor();
      assert.match(await funnelTooltip.innerText(), /Activated/u, "Keyboard focus must reveal the last vertical stage details");
      assert.equal(await funnel.locator(".chart-funnel").evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const tip = element.querySelector('[role="tooltip"]').getBoundingClientRect();
        return tip.left >= bounds.left - 1 && tip.right <= bounds.right + 1
          && tip.top >= bounds.top - 1 && tip.bottom <= bounds.bottom + 1;
      }), true, "Mobile tooltip must stay inside the visible chart, not the scrolled canvas");
      const scrolling = await funnel.locator(".chart-funnel-scroll").evaluate((element) => ({
        overflowing: element.scrollWidth > element.clientWidth, scrolled: element.scrollLeft > 0,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      assert.deepEqual(scrolling, { overflowing: false, scrolled: false, pageOverflow: false },
        "Narrow funnels must show all stages vertically without horizontal scrolling");
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        const serialize = XMLSerializer.prototype.serializeToString;
        XMLSerializer.prototype.serializeToString = function (element) {
          const markup = serialize.call(this, element);
          if (element.tagName.toLowerCase() === "svg") window.__funnelExportSvg = markup;
          return markup;
        };
        const write = navigator.clipboard.write;
        navigator.clipboard.write = async (items) => {
          window.__funnelClipboardBlob = await items[0].getType("image/png");
          return write(items);
        };
      });
      await funnel.getByRole("combobox", { name: "Conversion funnel actions", exact: true })
        .selectOption({ label: "Copy as image" });
      await page.waitForFunction(() => window.__dashboardClipboard.at(-1)?.type === "image/png");
      const funnelImage = await page.evaluate(() => ({ ...window.__dashboardClipboard.at(-1),
        text: [...new DOMParser().parseFromString(window.__funnelExportSvg, "image/svg+xml").querySelectorAll("text")]
          .map((text) => text.textContent) }));
      assert.ok(funnelImage.height > funnelImage.width, "Narrow PNG must export every vertical stage rather than a hidden ribbon");
      for (const expected of ["Visited", "100K", "100%", "Activated", "6K", "6%"]) {
        assert.ok(funnelImage.text.includes(expected), `${surface} funnel image must include ${expected}`);
      }
      assert.ok(!funnelImage.text.includes("Percent of Visited"), "Removed footer must not survive in exports");
      await page.emulateMedia({ media: "print" });
      const printBounds = await funnel.evaluate((element) => {
        const viewport = element.querySelector(".chart-funnel-scroll").getBoundingClientRect();
        const stages = [...element.querySelectorAll(".chart-funnel-stage")].map((stage) => stage.getBoundingClientRect());
        return { allVisible: stages.every((stage) => stage.left >= viewport.left - 1 && stage.right <= viewport.right + 1),
          overflow: getComputedStyle(element.querySelector(".chart-funnel-scroll")).overflowX };
      });
      assert.deepEqual(printBounds, { allVisible: true, overflow: "visible" }, "Print must include every stage in the responsive layout");
      await page.emulateMedia({ media: null });
      await page.setViewportSize({ width: 1440, height: 1100 });
      for (const [width, layout] of [[1152, "horizontal"], [1040, "compact"]]) {
        await funnel.locator(".chart-funnel").evaluate((element, value) => { element.style.width = `${value}px`; }, width);
        await page.waitForFunction((layout) => document.querySelector('[data-component-id="shared-funnel"] .chart-funnel').dataset.funnelLayout === layout, layout);
        let ltrPixels;
        for (const direction of ["ltr", "rtl"]) {
          await funnel.evaluate((element, value) => { element.dir = value; }, direction);
          const stageGeometry = await funnel.locator(".chart-funnel").evaluate((element) => {
            const ribbon = element.querySelector(".chart-funnel-ribbon");
            const bounds = ribbon.getBoundingClientRect();
            const paths = [...ribbon.querySelectorAll(".chart-funnel-band")];
            return [...element.querySelectorAll(".chart-funnel-stage")].map((stage) => {
              const box = stage.getBoundingClientRect();
              const x = box.left + box.width / 2;
              let height = 0;
              for (let y = 0; y < 200; y++) {
                const point = new DOMPoint(x, bounds.top + (y + .5) / 200 * bounds.height);
                if (paths.some((path) => path.isPointInFill(point.matrixTransform(path.getScreenCTM().inverse())))) height++;
              }
              return { x, height };
            });
          });
          assert.equal(stageGeometry[0].x > stageGeometry.at(-1).x, direction === "rtl",
            `${layout} stage labels must follow inherited ${direction} direction`);
          for (const [index, share] of [1, .75, .6, .45, .3, .2, .12, .06].entries()) {
            assert.ok(Math.abs(stageGeometry[index].height - share * 180) <= 2,
              `${layout} ${direction} ribbon beneath stage ${index} must encode its own reviewed value`);
          }
          const beforeCopy = await page.evaluate(() => window.__dashboardClipboard.length);
          await funnel.getByRole("button", { name: "Conversion funnel actions", exact: true }).click();
          await page.getByRole("menuitem", { name: "Copy as image", exact: true }).click();
          await page.waitForFunction((count) => window.__dashboardClipboard.length > count, beforeCopy);
          const exported = await page.evaluate(() => {
            const svg = new DOMParser().parseFromString(window.__funnelExportSvg, "image/svg+xml");
            return { ...window.__dashboardClipboard.at(-1), paths: svg.querySelectorAll("path").length,
              text: [...svg.querySelectorAll("text")].map((element) => element.textContent) };
          });
          assert.ok(exported.paths > 0 && exported.width >= width * 2 && exported.height < exported.width,
            `${layout} exports must retain the visible ribbon at its full width`);
          assert.ok(exported.text.includes("Visited") && exported.text.includes("Activated"));
          const pixels = await funnel.evaluate(async (element) => {
            const image = await createImageBitmap(window.__funnelClipboardBlob);
            const canvas = document.createElement("canvas");
            canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
            const scene = element.querySelector(".chart-funnel-canvas").getBoundingClientRect();
            const ribbon = element.querySelector(".chart-funnel-ribbon").getBoundingClientRect();
            const scale = image.width / Math.ceil(Math.max(element.getBoundingClientRect().width, scene.width) + 40);
            const stages = [...element.querySelectorAll(".chart-funnel-stage")];
            const samples = [[0, .15], [1, .25], [stages.length - 1, .15]].map(([index, y]) => {
              const stage = stages[index].getBoundingClientRect();
              return [...context.getImageData(Math.round((20 + stage.left + stage.width / 2 - scene.left) * scale),
                Math.round((48 + ribbon.top - scene.top + ribbon.height * y) * scale), 1, 1).data];
            });
            image.close();
            return samples;
          });
          if (direction === "ltr") ltrPixels = pixels;
          else assert.ok(pixels.every((pixel, index) => pixel.every((channel, color) =>
            Math.abs(channel - ltrPixels[index][color]) <= 2)),
            `${layout} RTL PNG must preserve each label's ribbon thickness and gradient color, not the LTR picture`);
        }
      }
      await funnel.locator(".chart-funnel").evaluate((element) => { element.style.width = "360px"; });
      await page.waitForFunction(() => document.querySelector('[data-component-id="shared-funnel"] .chart-funnel').dataset.funnelLayout === "vertical");
      const rtlBars = await funnel.locator(".chart-funnel-stage-bar-fill").evaluateAll((bars) => bars.map((bar) => {
        const bounds = bar.getBoundingClientRect();
        return { width: bounds.width, end: bounds.right - bar.parentElement.getBoundingClientRect().right };
      }));
      assert.ok(rtlBars.every(({ end }) => Math.abs(end) < 1), "Vertical RTL bars remain anchored at inline start");
      assert.ok(Math.abs(rtlBars[1].width / rtlBars[0].width - .75) < .001, "Vertical RTL proportions remain unchanged");
      await funnel.evaluate((element) => { element.removeAttribute("dir"); });
      await funnel.locator(".chart-funnel").evaluate((element) => { element.style.removeProperty("width"); });
      const copiedImages = await page.evaluate(() => window.__dashboardClipboard.length);
      await component("plain-chart").getByRole("button", { name: "Plain chart actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Copy as image", exact: true }).click();
      await page.waitForFunction((count) => window.__dashboardClipboard.length > count, copiedImages);
      assert.equal(await page.evaluate(() => window.__dashboardClipboard.at(-1).type), "image/png",
        "Existing Recharts images must still copy after the funnel export path is added");

      await selectProduct("Page filters", "Page product", "Search");
      assert.deepEqual(await localRows("local-a"), [], "Conflicting global and local exact filters must intersect");
      assert.deepEqual((await localRows("local-b")).map((row) => row.activeUsers), [60]);
      assert.equal(await page.getByRole("region", { name: "First section filters", exact: true }).locator(".clear-filters").count(), 0,
        "An active section selection should reset via its dropdown, without a separate clear action");
      await selectProduct("First section filters", "Local product", "All");
      assert.deepEqual((await localRows("local-a")).map((row) => row.activeUsers), [60],
        "Local All must not undo the exact page filter with the same ID");
      assert.equal(await page.getByRole("button", { name: "Clear page", exact: true }).count(), 1,
        "Clearing the section must leave the page filter active");
      await page.getByRole("button", { name: "Clear page", exact: true }).click();
      assert.deepEqual((await localRows("local-a")).map((row) => row.activeUsers), [100]);
      await page.getByRole("region", { name: "Local date filters", exact: true })
        .getByRole("button", { name: "Date range", exact: true }).click();
      await page.getByRole("menuitem", { name: "All available dates", exact: true }).click();
      assert.equal(await page.getByTestId("local-date-value").textContent(), "all",
        "A local date picker's All available dates action must restore literal All, not an exact latest date");
      assert.equal(await page.getByRole("region", { name: "Local date filters", exact: true })
        .getByRole("button", { name: "Clear section", exact: true }).count(), 0,
      "Local date controls should not add a separate reset button");

      const heading = page.locator('[data-editable-id="local-a"]');
      const headingActions = (id) => page.locator(`[data-editable-id="${id}"]`).locator("..")
        .getByRole("button", { name: "Section heading actions", exact: true });
      const headingMenu = headingActions("local-a");
      assert.equal(await headingMenu.count(), 0, "Heading controls belong only in Edit mode");
      await selectProduct("First section filters", "Local product", "Studio");
      await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
      const menuGeometry = await headingMenu.evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        const header = button.closest(".data-section-header").getBoundingClientRect();
        return { opacity: getComputedStyle(button).opacity,
          contained: bounds.left >= header.left && bounds.right <= header.right
            && bounds.top >= header.top && bounds.bottom <= header.bottom };
      });
      assert.deepEqual(menuGeometry, { opacity: "1", contained: true }, "Heading actions must be visible inside their own header");
      await heading.fill("Edited section heading");
      await heading.press("Enter");
      await headingMenu.click();
      await page.getByRole("menuitem", { name: "Hide heading", exact: true }).click();
      assert.equal(await heading.isVisible(), false, `${surface} hides the heading`);
      assert.equal(await component("local-a-value").isVisible(), true, "Hiding a heading must not hide its content");
      const localFilter = page.getByRole("region", { name: "First section filters", exact: true });
      assert.equal(await localFilter.isVisible(), true, "Hiding a heading must not hide its active filters");
      assert.match(await localFilter.innerText(), /Studio/u);
      assert.deepEqual((await localRows("local-a")).map((row) => row.activeUsers), [40]);
      await page.getByRole("button", { name: `Undo ${surface} change`, exact: true }).click();
      assert.equal(await heading.isVisible(), true);
      assert.equal(await heading.textContent(), "Edited section heading", "Undo hide preserves the edited title");
      await page.getByRole("button", { name: `Redo ${surface} change`, exact: true }).click();
      assert.equal(await heading.isVisible(), false);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
      await page.reload({ waitUntil: "load" });
      assert.equal(await heading.isVisible(), false, "Heading visibility survives reload");
      assert.equal(await headingMenu.count(), 0);
      assert.equal(await heading.textContent(), "Edited section heading", "Hidden titles retain saved edits");
      assert.equal(await localFilter.isVisible(), true);
      await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
      await headingActions("standalone-heading").click();
      await page.getByRole("menuitem", { name: "Hide heading", exact: true }).click();
      assert.equal(await page.locator('[data-editable-id="standalone-heading"]').locator("..").isVisible(), false,
        "A hidden standalone heading without filters must collapse entirely");
      await headingActions("no-spacing").click();
      await page.getByRole("menuitem", { name: "Hide heading", exact: true }).click();
      assert.equal(await section("no-spacing").locator(".data-section-header").isVisible(), false,
        "A filter slot rendering no controls must not keep a hidden heading's empty grid track");
      let hiddenCount = 3;
      if (surface === "dashboard") {
        await headingActions("canvas-heading").click();
        await page.getByRole("menuitem", { name: "Hide heading", exact: true }).click();
        const row = page.locator('[data-sortable-row="canvas-metrics"]');
        assert.equal(await row.locator(".sortable-row-header").isVisible(), false,
          "Hiding a canvas heading must also collapse its outer grid wrapper");
        const leadingGap = await row.evaluate((element) =>
          element.querySelector(".sortable-item").getBoundingClientRect().top
          - element.getBoundingClientRect().top - parseFloat(getComputedStyle(element).paddingTop));
        assert.equal(leadingGap, 0, "Hidden canvas headings must leave no empty grid track or extra gap");
        hiddenCount += 1;
      }
      await page.getByRole("button", { name: `Restore hidden (${hiddenCount})`, exact: true }).click();
      assert.equal(await heading.isVisible(), true);
      assert.equal(await heading.textContent(), "Edited section heading");
      assert.equal(await page.locator('[data-editable-id="standalone-heading"]').isVisible(), true);
      if (surface === "dashboard") assert.equal(await page.locator('[data-editable-id="canvas-heading"]').isVisible(), true);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
      assert.equal(await headingMenu.count(), 0, "View mode must remove heading actions again");

      await page.setViewportSize({ width: 390, height: 844 });
      const mobileMetrics = await section("metrics").evaluate((element) => {
        const [first, second] = element.querySelectorAll("[data-component-id]");
        const a = first.getBoundingClientRect();
        const b = second.getBoundingClientRect();
        return { tracks: getComputedStyle(element).gridTemplateColumns.split(" ").length,
          gap: b.top - a.bottom, aligned: a.left === b.left && a.width === b.width };
      });
      assert.deepEqual(mobileMetrics, { tracks: 1, gap: 12, aligned: true },
        `${surface} mobile metrics must use one actual track and a 12px KPI gap`);
      if (surface === "dashboard") {
        await page.getByRole("combobox", { name: "More" }).selectOption("edit");
        const mobileCanvas = await page.locator('[data-sortable-row="canvas-metrics"]').evaluate((element) => {
          const [first, second] = element.querySelectorAll(":scope > .sortable-item");
          const a = first.getBoundingClientRect();
          const b = second.getBoundingClientRect();
          return { tracks: getComputedStyle(element).gridTemplateColumns.split(" ").length,
            gap: b.top - a.bottom, aligned: a.left === b.left && a.width === b.width };
        });
        assert.deepEqual(mobileCanvas, { tracks: 1, gap: 12, aligned: true },
          "Mobile canvas metrics must stack into one track with a real 12px gap");
        const continuationGap = await page.evaluate(() =>
          document.querySelector('[data-component-id="canvas-four"]').closest('.sortable-item').getBoundingClientRect().top
          - document.querySelector('[data-component-id="canvas-three"]').closest('.sortable-item').getBoundingClientRect().bottom);
        assert.equal(continuationGap, 20, "Mobile editing blocks, including their touch handles, retain a real 20px gap");
        const singletonHandle = page.locator('[data-sortable-item-id="canvas-three"] [data-block-resize-handle]');
        assert.equal(await singletonHandle.isVisible(), false,
          "Mobile singleton cards must not show a desktop resize handle");
      }
      await page.getByRole("region", { name: "First section filters", exact: true }).scrollIntoViewIfNeeded();
      const mobile = await section("local-a").evaluate((element) => {
        const title = element.querySelector(".data-section-title").getBoundingClientRect();
        const controls = element.querySelector(".filters").getBoundingClientRect();
        return { wraps: controls.top >= title.bottom,
          inside: controls.left >= 0 && controls.right <= innerWidth,
          overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      assert.deepEqual(mobile, { wraps: true, inside: true, overflow: false },
        `${surface} shared section filters must wrap without viewport overflow`);
      assert.deepEqual(errors, [], `${surface} independent components should not emit browser errors`);
      await page.close();
    }
  } finally {
    rmSync(independent, { recursive: true, force: true });
  }
}

let browser;
try {
  const build = runDataAppFixtureBuild(project, { pluginRoot });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 1100 }, hasTouch: true });
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await installDashboardBrowserMocks(page);
  await page.goto(pathToFileURL(join(project, "dist/index.html")).href, { waitUntil: "load" });

  const charts = page.locator('[data-sortable-region]').filter({
    has: page.locator('[data-sortable-item-id="wide-trend"]'),
  });
  const originalChartRegionId = await charts.getAttribute("data-sortable-region");
  const metrics = page.locator('[data-sortable-region]').filter({
    has: page.locator('[data-sortable-item-id="metric-one"]'),
  });
  const bespoke = page.locator('[data-sortable-region]').filter({
    has: page.locator('[data-sortable-item-id="bespoke-one"]'),
  });
  const visualOrder = page.locator('[data-sortable-region]').filter({
    has: page.locator('[data-sortable-item-id="dom-first-visually-right"]'),
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.waitForFunction(() => document.querySelector(
    '[data-sortable-region="dashboard:custom-smoke:reviewed-trend-grid"]')?.dataset.sortableVariant === "canvas");
  assert.equal(await charts.getAttribute("data-sortable-variant"), "canvas",
    "A grid first mounted in a narrow preview must gain resizing when there is room");
  assert.equal(await charts.evaluate((element) => {
    const first = element.querySelector('[data-sortable-item-id="wide-trend"]').getBoundingClientRect();
    const second = element.querySelector('[data-sortable-item-id="narrow-trend"]').getBoundingClientRect();
    return second.left - first.right;
  }), 14,
    "Promoting an authored canvas must preserve its deliberate 14px chart gap");
  assert.equal(originalChartRegionId, "dashboard:custom-smoke:reviewed-trend-grid",
    "An authored wrapper ID must contribute to the stable namespaced sortable identity");
  assert.equal(await charts.getAttribute("id"), "reviewed-trend-grid",
    "Adaptive sortable layouts must preserve the authored wrapper's actual HTML identity");
  assert.equal(await metrics.getAttribute("data-sortable-variant"), "canvas",
    "Ordinary authored metric rows should inherit smooth canvas movement and resizing");
  assert.equal(await bespoke.getAttribute("data-sortable-variant"), "freeform",
    "Genuinely bespoke grid-area layouts should retain their authored freeform composition");
  assert.equal(await visualOrder.getAttribute("data-sortable-variant"), "canvas",
    "Explicitly positioned ordinary grids should retain smooth canvas interactions");
  assert.deepEqual(await visualOrder.locator('[data-sortable-item-id]').evaluateAll((items) =>
    items.map((item) => item.dataset.sortableItemId)),
  ["dom-second-visually-left", "dom-first-visually-right"],
  "Canvas promotion must preserve measured left-to-right visual placement rather than DOM order");
  assert.equal(await page.locator('[data-sortable-item-id="wide-trend"]').getAttribute("data-sortable-span"), "8");
  assert.equal(await page.locator('[data-sortable-item-id="narrow-trend"]').getAttribute("data-sortable-span"), "4");
  assert.equal(await page.locator('[data-sortable-item-id="wide-trend"]').evaluate((item) =>
    item.classList.contains("editorial-featured-column")), true,
  "Nonstandard authored grid-placement classes must survive insertion of sortable wrappers");
  assert.equal(await page.locator('[data-sortable-item-id="full-trend"]').getAttribute("data-sortable-span"), "12");

  for (const id of ["metric-one", "metric-three", "wide-trend"]) {
    const component = page.locator(`[data-component-id="${id}"]`);
    const trigger = component.getByRole("button", { name: "More information" });
    assert.equal(await trigger.evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
        ?.closest("button") === button;
    }), true, `${id} information icon must remain reachable instead of hiding under component actions`);
    await trigger.hover();
    const tooltip = page.locator('[role="tooltip"][data-tooltip-portal="true"]');
    await tooltip.waitFor({ state: "visible" });
    const tooltipState = await tooltip.evaluate((description) => {
      const bounds = description.getBoundingClientRect();
      return {
        portaled: description.parentElement === document.body,
        readable: description.textContent.trim().length > 15,
        insideViewport: bounds.left >= 0 && bounds.right <= window.innerWidth
          && bounds.top >= 0 && bounds.bottom <= window.innerHeight,
      };
    });
    assert.deepEqual(tooltipState, { portaled: true, readable: true, insideViewport: true },
      `${id} information tooltip should escape clipped titles and cards without leaving the viewport`);
    assert.equal(await trigger.getAttribute("aria-describedby"), await tooltip.getAttribute("id"),
      `${id} information tooltip should remain connected to its accessible trigger`);
    await trigger.focus();
    await trigger.press("Escape");
    await tooltip.waitFor({ state: "hidden" });
    await page.mouse.move(0, 0);
  }

  await page.getByRole("button", { name: "Edit text and layout" }).click();
  assert.equal(await charts.locator('[data-block-resize-handle][data-resize-neighbor]:not([hidden])').count(), 2,
    "Each authored chart row should expose its actual adjacent-card resize divider");
  assert.equal(await metrics.locator('[data-block-resize-handle][data-resize-neighbor]:not([hidden])').count(), 2,
    "Authored metric rows should expose adjacent metric resize dividers");

  async function assertFaithfulPreview(sourceId, targetId) {
    const item = page.locator(`[data-sortable-item-id="${sourceId}"]`);
    await item.scrollIntoViewIfNeeded();
    await item.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const component = item.locator("[data-component-id]");
    const origin = await component.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const header = (element.querySelector(".component-header") ?? element).getBoundingClientRect();
      for (const y of [bounds.top + 7, header.top + header.height * .35, header.top + header.height * .75]) {
        for (const fraction of [.75, .55, .35, .15]) {
          const x = bounds.left + bounds.width * fraction;
          const hit = document.elementFromPoint(x, y);
          if (hit && element.contains(hit)
            && !hit.closest("button, a, input, textarea, select, [contenteditable='true'], [role='button']")) {
            return { x, y };
          }
        }
      }
      return null;
    });
    assert.ok(origin, `${sourceId} should expose a safe direct-manipulation drag surface`);
    const target = await page.locator(`[data-sortable-item-id="${targetId}"]`).boundingBox();
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width * .7, target.y + 18, { steps: 12 });
    await page.locator(".block-drag-preview").waitFor({ state: "visible", timeout: 5000 });
    const mismatches = await page.evaluate((id) => {
      const source = document.querySelector(`[data-sortable-item-id="${id}"]`);
      const preview = document.querySelector(".block-drag-preview");
      const selectors = [".dashboard-component", ".component-title", ".data-metric-value", ".chart-frame",
        ".chart-legend", "svg path"];
      const properties = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing",
        "color", "background-color", "padding", "gap", "fill", "stroke"];
      return selectors.flatMap((selector) => {
        const original = source.querySelector(selector);
        const clone = preview.querySelector(selector);
        if (!original || !clone) return [];
        const sourceStyles = getComputedStyle(original);
        const cloneStyles = getComputedStyle(clone);
        return properties.filter((property) => sourceStyles.getPropertyValue(property)
          !== cloneStyles.getPropertyValue(property))
          .map((property) => ({ selector, property,
            source: sourceStyles.getPropertyValue(property),
            preview: cloneStyles.getPropertyValue(property) }));
      });
    }, sourceId);
    assert.deepEqual(mismatches, [],
      `${sourceId} drag preview should preserve authored typography, spacing, card styling, and chart marks`);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.locator(".block-drag-preview").waitFor({ state: "hidden" });
    await item.locator("..").evaluate(async (row) => {
      await Promise.all([...row.querySelectorAll("[data-sortable-item-id]")]
        .flatMap((entry) => entry.getAnimations().map((animation) => animation.finished.catch(() => {}))));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }

  await assertFaithfulPreview("metric-one", "metric-two");
  await assertFaithfulPreview("wide-trend", "narrow-trend");

  const source = page.locator('[data-sortable-item-id="wide-trend"]');
  const neighbor = page.locator('[data-sortable-item-id="narrow-trend"]');
  const handle = source.locator('[data-block-resize-handle]');
  const sourceBefore = await source.boundingBox();
  const neighborBefore = await neighbor.boundingBox();
  const control = await handle.boundingBox();
  const dividerAlignment = await handle.evaluate((element) => {
    const current = element.closest("[data-sortable-item-id]").getBoundingClientRect();
    const adjacent = element.closest("[data-sortable-item-id]").nextElementSibling.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return {
      horizontal: bounds.left + bounds.width / 2 - (current.right + adjacent.left) / 2,
      vertical: bounds.top + bounds.height / 2
        - (Math.max(current.top, adjacent.top) + Math.min(current.bottom, adjacent.bottom)) / 2,
    };
  });
  assert.ok(Math.abs(dividerAlignment.horizontal) <= 1,
  "The authored chart resize grip should sit in the exact center of the gap between adjacent cards");
  assert.ok(Math.abs(dividerAlignment.vertical) <= 1,
  "The authored chart resize grip should sit at the exact vertical midpoint of its adjacent cards");
  await page.mouse.move(control.x + control.width / 2, control.y + control.height / 2);
  await page.mouse.down();
  await page.mouse.move(control.x + control.width / 2 - 115, control.y + control.height / 2, { steps: 12 });
  await page.mouse.up();
  const sourceAfter = await source.boundingBox();
  const neighborAfter = await neighbor.boundingBox();
  for (const item of [source, neighbor]) {
    const painted = await item.locator(".recharts-surface").first().boundingBox();
    assert.ok(painted.width > 100 && painted.height > 100,
      "Resized charts must have a painted viewport, not only data paths inside a zero-width SVG");
  }
  assert.ok(sourceAfter.width < sourceBefore.width - 60,
    "Dragging an authored chart divider should reduce the selected card width");
  assert.ok(neighborAfter.width > neighborBefore.width + 60,
    "The actual adjacent chart should grow as its neighbor shrinks");

  await page.getByRole("button", { name: "Toggle earlier section" }).click();
  assert.equal(await charts.getAttribute("data-sortable-region"), originalChartRegionId,
    "An earlier conditional section must not change a later region's stable identity");
  assert.ok(Math.abs((await source.boundingBox()).width - sourceAfter.width) < 3,
    "Adding an earlier section must preserve owner-adjusted chart widths");
  await page.getByRole("button", { name: "Toggle earlier section" }).click();
  assert.equal(await charts.getAttribute("data-sortable-region"), originalChartRegionId,
    "Removing an earlier conditional section must not discard a region's saved layout");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
  await page.reload({ waitUntil: "load" });
  await source.waitFor({ state: "visible" });
  assert.ok(Math.abs((await source.boundingBox()).width - sourceAfter.width) < 3,
    "Owner-adjusted authored chart widths must survive reload");
  assert.deepEqual(failures, [], "Adaptive authored dashboard layouts should not emit browser errors");
  console.log(JSON.stringify({ phase: "authored-canvas", status: "passed", narrowFirstMount: true,
    pointerResize: true, resizedWidthPersisted: true, paintedChartsAfterResize: true }));
  await assertComponentLabGeometry(browser);
  await assertIndependentComponents(browser);
  await assertReferenceLayoutContainment(browser);
  console.log(JSON.stringify({ status: "passed", chartRows: 3, chartResizeHandles: 2,
    metricResizeHandles: 2, bespokeFallback: "freeform", resizedWidthPersisted: true,
    dragPreviewMatchesSource: true, clippedTooltipsEscaped: true,
    independentSurfaces: ["dashboard", "report"], independentThemes: ["Classic", "Dark pixel", "Scientific blue"],
    localFilterSourceParity: true, mobileMetricGap: 12 }));
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
