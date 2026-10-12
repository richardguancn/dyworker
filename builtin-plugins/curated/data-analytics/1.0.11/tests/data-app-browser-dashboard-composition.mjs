import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { installDashboardBrowserMocks, runDataAppFixtureBuild } from "./browser-helpers.mjs";

export async function verifyDashboardFilterMenuGeometry({ browser, failures, dataAppPath, settleSelectionUi }) {
  const stableMenuPage = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  stableMenuPage.on("pageerror", (error) => failures.push(error.message));
  await stableMenuPage.addInitScript(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      get: () => document.documentElement.clientWidth + 17,
    });
  });
  await installDashboardBrowserMocks(stableMenuPage);
  await stableMenuPage.goto(pathToFileURL(dataAppPath).href, { waitUntil: "load" });
  const stableFilter = stableMenuPage.getByRole("button", { name: "Product segment" });
  await stableFilter.waitFor();
  await settleSelectionUi(stableMenuPage);
  const dashboardGeometry = () => stableMenuPage.evaluate(() => ({
    scrollY,
    elements: [".dashboard-topbar", "main", '[data-component-id="active-users"]',
      '[data-component-id="usage-trend"]', ".recharts-wrapper"].map((selector) => {
      const bounds = document.querySelector(selector).getBoundingClientRect();
      return { selector, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }),
  }));
  const menuBaseline = await dashboardGeometry();
  await stableFilter.click();
  await stableMenuPage.getByRole("menu").waitFor();
  await settleSelectionUi(stableMenuPage);
  assert.deepEqual(await dashboardGeometry(), menuBaseline,
    "Opening a modal filter must not shift the sticky top bar, dashboard cards, or responsive charts");
  assert.deepEqual(await stableMenuPage.evaluate(() => ({
    locked: document.body.hasAttribute("data-scroll-locked"),
    marginRight: getComputedStyle(document.body).marginRight,
    paddingRight: getComputedStyle(document.body).paddingRight,
  })), { locked: true, marginRight: "0px", paddingRight: "0px" },
  "Modal dashboard filters must preserve outside-interaction blocking without redundant scrollbar compensation");
  await stableMenuPage.keyboard.press("Escape");
  await settleSelectionUi(stableMenuPage);
  assert.deepEqual(await dashboardGeometry(), menuBaseline,
    "Closing a modal filter must leave the original dashboard geometry unchanged");
  await stableMenuPage.close();
}

export async function verifyTemporalAxisGeometry(page, reviewedTimes) {
  await page.locator("[data-temporal-axis-tick]").first().waitFor({state:"visible"});
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolveFrame => {
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
  }));
  const violations = await page.evaluate((reviewedTimes) => {
    const failures=[], axes=new Map();
    for (const label of document.querySelectorAll("[data-temporal-axis-tick]")) {
      const svg=label.closest("svg.recharts-surface");
      if (!svg) continue;
      const rect=label.getBoundingClientRect(), frame=svg.getBoundingClientRect();
      if (!rect.width || !frame.width) continue;
      if (rect.left<frame.left-1 || rect.right>frame.right+1 || rect.bottom>frame.bottom+1)
        failures.push({kind:"clipped",label:label.textContent,left:rect.left,right:rect.right,frameLeft:frame.left,frameRight:frame.right});
      const group=axes.get(svg) ?? []; group.push({left:rect.left,right:rect.right,center:(rect.left+rect.right)/2,label:label.textContent,value:label.dataset.axisValue});
      axes.set(svg,group);
    }
    for (const [svg,labels] of axes) {
      labels.sort((a,b)=>a.center-b.center);
      const domain=svg.querySelector("[data-temporal-axis-start]")?.dataset;
      if (domain?.temporalAxisScale === "time") {
        const start=Date.parse(domain.temporalAxisStart), end=Date.parse(domain.temporalAxisEnd);
        if (labels.some(label=>Number(label.value)<start || Number(label.value)>end)) failures.push({kind:"outside time extent"});
        const dates=labels.map(label=>new Date(Number(label.value)));
        const gaps=dates.slice(1).map((date,i)=>date-dates[i]);
        const monthIndexes=dates.map(date=>date.getUTCFullYear()*12+date.getUTCMonth());
        const monthGaps=monthIndexes.slice(1).map((month,i)=>month-monthIndexes[i]);
        const calendarCadence=dates.every(date=>date.getUTCDate()===1 && date.getUTCHours()===0)
          && monthGaps.every(gap=>gap>0 && gap===monthGaps[0]);
        if (!calendarCadence && !gaps.every(gap=>gap>0 && gap===gaps[0])) failures.push({kind:"irregular time cadence",labels});
        if (svg.closest('[data-component-id]')?.dataset.componentId === "usage-trend") {
          // This fixture hides resting dots. Its monotone path still ends each
          // cubic segment at the reviewed observation; inspect those vertices.
          const points=[...svg.querySelectorAll('.recharts-line-curve')].flatMap(path=>
            (path.getAttribute('d').match(/[MLC][^MLC]*/gu)??[]).map(command=>{
              const numbers=command.slice(1).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/giu).map(Number);
              return new DOMPoint(numbers.at(-2),numbers.at(-1)).matrixTransform(path.getScreenCTM()).x;
            }));
          for (const label of labels) {
            if (!reviewedTimes.includes(Number(label.value)) || !points.some(x=>Math.abs(x-label.center)<1))
              failures.push({kind:"regular date label detached from its observation",label});
          }
        }
      } else if (labels.length>2) {
        const gaps=labels.slice(1).map((label,i)=>label.center-labels[i].center);
        if (gaps.some(gap=>Math.abs(gap-gaps[0])>1)) failures.push({kind:"irregular bucket cadence",labels});
      }
      for (let index=1;index<labels.length;index++) {
        if (labels[index].left<labels[index-1].right+8) failures.push({kind:"overlap",labels:[labels[index-1].label,labels[index].label]});
      }
    }
    return failures;
  }, reviewedTimes);
  assert.deepEqual(violations,[],"Temporal labels must be contained, separated, and use a consistent time or bucket cadence");
}

async function verifySmoothCardSurfaces(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('[data-component-id]')].every((card) => {
    const surface = card.querySelector(':scope > .smooth-card-surface[data-ready]');
    if (!surface) return false;
    const bounds = card.getBoundingClientRect();
    const viewBox = surface.viewBox.baseVal;
    return Math.abs(viewBox.width - bounds.width) < .1 && Math.abs(viewBox.height - bounds.height) < .1;
  }));
  const surfaces = await page.locator('[data-component-id]').evaluateAll((cards) => cards.map((card) => {
    const surface = card.querySelector(':scope > .smooth-card-surface');
    const path = surface.querySelector('path');
    const style = getComputedStyle(card);
    const bounds = path.getBBox();
    return {
      smoothing: surface.dataset.cornerSmoothing,
      hasBezierTransitions: /c/iu.test(path.getAttribute('d')),
      width: bounds.width, height: bounds.height,
      expectedWidth: surface.viewBox.baseVal.width - parseFloat(style.borderTopWidth),
      expectedHeight: surface.viewBox.baseVal.height - parseFloat(style.borderTopWidth),
      fill: getComputedStyle(path).fill, stroke: getComputedStyle(path).stroke,
      transparentContainer: style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.borderTopColor === 'rgba(0, 0, 0, 0)',
      clip: style.clipPath, overflow: style.overflow, pointerEvents: getComputedStyle(surface).pointerEvents,
    };
  }));
  assert.ok(surfaces.length > 0, "The surface check must inspect rendered cards");
  for (const surface of surfaces) {
    assert.equal(surface.smoothing, '0.6');
    assert.equal(surface.hasBezierTransitions, true, 'Cards must paint smooth transition curves, not just round CSS corners');
    assert.ok(Math.abs(surface.width - surface.expectedWidth) < .1 && Math.abs(surface.height - surface.expectedHeight) < .1,
      'Smoothed surfaces must follow the card size without scaling the corner radius');
    assert.equal(surface.fill, 'rgb(255, 255, 255)');
    assert.equal(surface.stroke, 'rgb(237, 237, 237)');
    assert.equal(surface.transparentContainer, true, 'Do not paint the old circular border underneath the smoothed border');
    assert.equal(surface.clip, 'none', 'Smoothing must not clip tooltips or focus rings');
    assert.equal(surface.overflow, 'visible');
    assert.equal(surface.pointerEvents, 'none', 'Decorative card surfaces must not intercept controls');
  }
}

async function verifyFilterBarEdges(page) {
  const settleGeometry = () => page.evaluate(() => new Promise(resolveFrame => {
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
  }));
  const verifyGeometry = async (expectedScrollbarWidth = null) => {
    await settleGeometry();
    const geometry = await page.locator('.filter-bar').evaluate((bar) => {
      const bounds = bar.getBoundingClientRect();
      const root = document.querySelector('.dashboard-root').getBoundingClientRect();
      const style = getComputedStyle(bar);
      return {
        left: bounds.left, right: bounds.right, rootLeft: root.left, rootRight: root.right,
        scrollbarWidth: window.innerWidth - root.width,
        controlLeft: bar.firstElementChild.getBoundingClientRect().left,
        cardLeft: document.querySelector('[data-component-id]').getBoundingClientRect().left,
        pageWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
        stuck: bar.hasAttribute('data-stuck'),
        borderWidth: style.borderBottomWidth, borderColor: style.borderBottomColor,
      };
    });
    if (expectedScrollbarWidth != null) {
      assert.ok(Math.abs(geometry.scrollbarWidth - expectedScrollbarWidth) < .5,
        `The scrollbar regression must reserve ${expectedScrollbarWidth}px: ${JSON.stringify(geometry)}`);
    }
    assert.ok(Math.abs(geometry.left - geometry.rootLeft) < .5 && Math.abs(geometry.right - geometry.rootRight) < .5,
      `Sticky filter backgrounds must match both dashboard edges: ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(geometry.controlLeft - geometry.cardLeft) < 1,
      'Full-width filter backgrounds must keep controls aligned with the cards');
    assert.ok(geometry.pageWidth <= geometry.clientWidth, 'Full-width filters must not introduce horizontal page scrolling');
    assert.equal(geometry.borderWidth, '1px');
    assert.equal(geometry.borderColor, geometry.stuck ? 'rgb(237, 237, 237)' : 'rgba(0, 0, 0, 0)',
      'The full-width bottom border must be visible only while the filter bar is sticky');
  };
  await verifyGeometry();
  // An explicit width makes macOS use a classic scrollbar instead of an overlay.
  const scrollbarStyle = await page.addStyleTag({ content: 'html::-webkit-scrollbar { width: 15px; height: 15px; }' });
  try {
    await verifyGeometry(15);
  } finally {
    await scrollbarStyle.evaluate((element) => element.remove());
    await settleGeometry();
  }
}

export async function verifyDashboardVisualPolish(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.filter-bar:not([data-stuck])').waitFor();
  await verifyFilterBarEdges(page);
  await verifySmoothCardSurfaces(page);
  assert.deepEqual(await page.locator(".data-section-title").allTextContents(),
    ["Adoption and acquisition", "Engagement patterns", "Growth and outlook", "Feature and regional adoption", "Account health"]);
  const appearance = await page.evaluate(() => {
    const metrics = [...document.querySelectorAll('.metric-strip [data-component-id]')];
    const cards = [...document.querySelectorAll('[data-component-id]')];
    const trend = document.querySelector('[data-component-id="usage-trend"]');
    return {
      kpiGap: trend.getBoundingClientRect().top - Math.max(...metrics.map((card) => card.getBoundingClientRect().bottom)),
      background: getComputedStyle(document.querySelector('.dashboard-root')).backgroundColor,
      cardBackground: getComputedStyle(trend.querySelector('.smooth-card-surface > path')).fill,
      radii: [...new Set(cards.map((card) => getComputedStyle(card).borderRadius))],
      shadows: [...new Set(cards.map((card) => getComputedStyle(card).boxShadow))],
      headingsPinned: [...document.querySelectorAll('.data-section-title')]
        .every((heading) => !heading.closest('[data-sortable-item-id]')),
      sectionGaps: [...document.querySelectorAll('.dashboard-section-start')].map((row) => {
        const heading = row.querySelector('.sortable-row-header').getBoundingClientRect();
        const firstCard = row.querySelector('[data-component-id]').getBoundingClientRect();
        return firstCard.top - heading.bottom;
      }),
    };
  });
  assert.equal(appearance.kpiGap, 32, "The KPI-to-chart gap must total 32px, not stacked row padding");
  assert.notEqual(appearance.background, appearance.cardBackground, "The page must contrast with card surfaces");
  assert.deepEqual(appearance.radii, ["20px"], "The Figma polish must not change card radii");
  assert.deepEqual(appearance.shadows, ["rgba(0, 0, 0, 0.01) 0px 4px 12px 0px"]);
  assert.equal(appearance.headingsPinned, true);
  assert.deepEqual(appearance.sectionGaps, [20, 20, 20, 20, 20]);
  const filterAppearance = () => page.locator('.filter-bar').evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, image: style.backgroundImage, blur: style.backdropFilter };
  });
  const transparentFilter = { background: "rgba(0, 0, 0, 0)", image: "none", blur: "none" };
  assert.deepEqual(await filterAppearance(), transparentFilter,
    "Resting filters must not paint a background or blur the page");
  const supportingCards = page.locator('[data-component-id="segment-breakdown"], [data-component-id="priority-accounts"]');
  const initialHeights = await supportingCards.evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
  assert.ok(Math.abs(initialHeights[0] - initialHeights[1]) < 1, "Cards in the supporting row must stretch to equal heights");
  await page.getByRole('button', { name: 'Show 7 more', exact: true }).click();
  await page.locator('.filter-bar[data-stuck]').waitFor();
  const stickyFilter = await filterAppearance();
  assert.notEqual(stickyFilter.background, transparentFilter.background);
  assert.equal(stickyFilter.image, 'none', 'The divider must use the full border rather than an inset gradient');
  assert.equal(stickyFilter.blur, 'blur(14px)');
  await verifyFilterBarEdges(page);
  await page.waitForFunction((initialHeight) => {
    const list = document.querySelector('[data-component-id="segment-breakdown"]').getBoundingClientRect();
    const map = document.querySelector('[data-component-id="priority-accounts"]').getBoundingClientRect();
    return list.height > initialHeight && Math.abs(list.height - map.height) < 1;
  }, initialHeights[0]);
  await verifySmoothCardSurfaces(page);
  await page.getByRole('button', { name: 'Show fewer', exact: true }).click();
  await page.waitForFunction((initialHeight) => [...document.querySelectorAll('[data-component-id="segment-breakdown"], [data-component-id="priority-accounts"]')]
    .every((card) => Math.abs(card.getBoundingClientRect().height - initialHeight) < 1), initialHeights[0]);
  await verifySmoothCardSurfaces(page);
  const originalViewport = page.viewportSize();
  try {
    // Wider than the maximum content column: fixed negative gutters leave a gap.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.locator('.filter-bar[data-stuck]').waitFor();
    await verifyFilterBarEdges(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await verifyFilterBarEdges(page);
    await verifySmoothCardSurfaces(page);
  } finally {
    await page.setViewportSize(originalViewport);
  }
  const firstMetric = page.locator('[data-component-id="active-users"]');
  const originalStyle = await firstMetric.getAttribute('style');
  try {
    for (const radius of ['0px', '50%', '20px 4px']) {
      await firstMetric.evaluate((card, value) => { card.style.borderRadius = value; }, radius);
      await firstMetric.locator('.smooth-card-surface:not([data-ready])').waitFor({ state: 'attached' });
      assert.equal(await firstMetric.evaluate((card) => getComputedStyle(card).backgroundColor), 'rgb(255, 255, 255)',
        'Square, percentage, and nonuniform radii must retain the original CSS surface');
    }
  } finally {
    await firstMetric.evaluate((card, value) => value == null ? card.removeAttribute('style') : card.setAttribute('style', value), originalStyle);
  }
  await verifySmoothCardSurfaces(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.filter-bar:not([data-stuck])').waitFor();
  assert.deepEqual(await filterAppearance(), transparentFilter, "Scrolling back must remove the sticky filter treatment");
}

export async function verifyDashboardSectionFilters(page) {
  const filters = page.getByRole("region", { name: "Engagement filters", exact: true });
  const product = filters.getByRole("button", { name: "Product", exact: true });
  const scatter = page.locator('[data-component-id="engagement-scatter"]');
  const headline = page.locator('[data-component-id="active-users"] .metric-value');
  const beforeHeadline = await headline.innerText();
  const beforeEvidence = await page.locator('[data-component-id="usage-details"] tbody').innerText();
  const heatScale = page.locator('[aria-label="Sessions color scale"]');
  const beforeScale = await heatScale.innerText();
  await product.click();
  await page.getByRole("menuitemradio", { name: "Studio", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-component-id="engagement-scatter"] .recharts-scatter-symbol').length === 30);
  assert.notEqual(await heatScale.innerText(), beforeScale, "The local product filter must also update aggregated heatmap values");
  assert.equal(await headline.innerText(), beforeHeadline);
  assert.equal(await page.locator('[data-component-id="usage-details"] tbody').innerText(), beforeEvidence,
    "Engagement scope must not filter another section's table");
  for (const [id, title, count] of [["engagement-heatmap", "When customers are most active", 84],
    ["engagement-scatter", "Account size by engagement", 30]]) {
    await page.locator(`[data-component-id="${id}"]`).getByRole("button", { name: `${title} actions`, exact: true }).click();
    await page.getByRole("menuitem", { name: "View data source", exact: true }).click();
    const source = page.getByRole("complementary", { name: `Data source for ${title}`, exact: true });
    await source.getByRole("tab", { name: "Overview", exact: true }).click();
    assert.match(await source.innerText(), /Product: Studio/u);
    await source.getByRole("tab", { name: "Data preview", exact: true }).click();
    assert.match(await source.innerText(), new RegExp(`${count} results`, "u"));
    assert.equal(await source.getByRole("cell", { name: "Studio", exact: true }).count(),
      await source.locator("tbody tr").count(), "Source preview must retain scoped raw product rows");
    await source.getByRole("button", { name: "Close data source", exact: true }).click();
  }
  const pageProduct = page.getByRole("region", { name: "Data app filters", exact: true })
    .getByRole("button", { name: "Product segment", exact: true });
  await pageProduct.click();
  await page.getByRole("menuitemradio", { name: "Search", exact: true }).click();
  assert.equal(await scatter.locator(".recharts-scatter-symbol").count(), 0,
    "Conflicting page and section products must not silently broaden either scope");
  assert.equal(await filters.locator(".clear-filters").count(), 0, "Section filters should use their existing All option, not an extra reset button");
  await product.click();
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-component-id="engagement-scatter"] .recharts-scatter-symbol').length === 30);
  assert.match(await pageProduct.innerText(), /Search/u, "Clearing a section must leave its page filter intact");
  await pageProduct.click();
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-component-id="engagement-scatter"] .recharts-scatter-symbol').length === 90);
  const accountFilters = page.getByRole("region", { name: "Account health filters", exact: true });
  await accountFilters.getByRole("button", { name: "Risk", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Elevated", exact: true }).click();
  assert.equal(await page.locator('[data-component-id="usage-details"] tbody tr').count(), 3);
  assert.equal(await headline.innerText(), beforeHeadline);
  assert.equal(await scatter.locator(".recharts-scatter-symbol").count(), 90);
  await accountFilters.getByRole("button", { name: "Risk", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  await accountFilters.getByRole("button", { name: "Risk", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Elevated", exact: true }).click();
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  const moveTable = page.getByRole("button", { name: "Move Reviewed account-level evidence", exact: true });
  await moveTable.press("Space");
  await moveTable.press("ArrowUp");
  await moveTable.press("Space");
  const movedFilters = page.locator('[data-component-id="usage-details"]')
    .getByRole("region", { name: "Reviewed account-level evidence filters", exact: true });
  await movedFilters.waitFor();
  assert.match(await movedFilters.innerText(), /Elevated/u,
    "Moving a filtered table must keep its active controls available on the moved block");
  assert.equal(await page.locator('[data-component-id="usage-details"] tbody tr').count(), 3);
  assert.equal(await movedFilters.locator(".clear-filters").count(), 0, "Moved filters must omit the redundant reset action too");
  await movedFilters.getByRole("button", { name: "Risk", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  assert.equal(await page.locator('[data-component-id="usage-details"] tbody tr').count(), 8);
  await page.getByRole("button", { name: "Undo dashboard change", exact: true }).click();
  await accountFilters.waitFor();
  assert.equal(await page.locator('[data-component-id="usage-details"] .component-section-filters').count(), 0,
    "Returning a block to its scoped row must restore header controls without duplicates");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const label of ["Engagement filters", "Account health filters"]) {
    const bounds = await page.getByRole("region", { name: label, exact: true }).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, `${label} must fit the mobile section header`);
  }
  await page.setViewportSize(viewport);
  await page.evaluate(() => window.scrollTo(0, 0));
}

export async function verifyDashboardComposition({ page, failures, screenshots }) {
  await verifyDashboardVisualPolish(page);
  for (const width of [320, 390, 430, 650, 651, 760, 1440]) {
    await page.setViewportSize({ width, height: 1050 });
    const chartInfoAlignment = await page.locator(".component-title-tail:has(.info-wrap)").evaluateAll((tails) =>
      tails.map((tail) => {
        const text = document.createRange();
        text.selectNodeContents(tail.firstChild);
        const label = text.getBoundingClientRect();
        const icon = tail.querySelector(".info [data-dashboard-icon=info]").getBoundingClientRect();
        return { title: tail.textContent, gap: icon.left - label.right,
          centerOffset: (icon.top + icon.bottom - label.top - label.bottom) / 2 };
      }));
    assert.ok(chartInfoAlignment.length > 0, "The fixture needs a described chart title");
    assert.ok(chartInfoAlignment.every(({ gap, centerOffset }) =>
      gap >= 5 && gap <= 11 && Math.abs(centerOffset) <= 2),
    `Chart information icons should be spaced and centered at ${width}px: ${JSON.stringify(chartInfoAlignment)}`);
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  const dashboardContentTitles = page.locator("main .component-title-text");
  const initialDashboardTitles = await dashboardContentTitles.allInnerTexts();
  assert.equal(await page.locator(".dashboard-topbar-title").innerText(), "Product adoption and engagement");
  assert.ok(initialDashboardTitles.includes("Active accounts over time"));
  assert.ok(initialDashboardTitles.includes("Active accounts by feature"));
  assert.ok(initialDashboardTitles.indexOf("When customers are most active")
    < initialDashboardTitles.indexOf("Weekly change in active accounts"),
  "Customer activity and account size should appear before growth drivers and target attainment");
  assert.equal(await page.locator('[data-component-id="growth-drivers"] .chart-axis-label').count(), 0,
    "Clearly labeled waterfall categories should not repeat an unnecessary growth-driver axis title");
  assert.equal(await page.locator('[data-component-id="channel-composition"] .chart-legend')
    .evaluate((legend) => getComputedStyle(legend).marginTop), "6px",
  "Dashboard chart legends should sit closer to their x-axis tick labels");
  assert.equal(await page.locator(".data-metric-card").count(), 4,
    "Starter KPIs must consume the reusable public metric-card primitive");
  assert.equal(await page.locator(".date-range-trigger [data-dashboard-icon=calendar]").count(), 0,
    "Date-range controls should rely on their clear text label instead of a redundant calendar icon");
  assert.ok(Number(await page.locator(".chart-heatmap-cell").first().getAttribute("rx")) > 0,
    "Classic heatmaps should inherit the theme's rounded chart-mark geometry");
  const waterfallTotal = page.locator('[data-component-id="growth-drivers"] .recharts-bar-rectangle path').first();
  await waterfallTotal.hover();
  const waterfallTooltipSwatch = page.locator('[data-component-id="growth-drivers"] .chart-tooltip i').first();
  await waterfallTooltipSwatch.waitFor();
  assert.equal(await waterfallTooltipSwatch.evaluate((swatch) => getComputedStyle(swatch).backgroundColor),
    await waterfallTotal.evaluate((mark) => getComputedStyle(mark).fill),
    "Waterfall total tooltips must use the same neutral color as their reviewed beginning and ending bars");
  const chartTooltipTransition = await waterfallTooltipSwatch
    .locator("xpath=ancestor::*[contains(@class, 'recharts-tooltip-wrapper')]")
    .evaluate((tooltip) => getComputedStyle(tooltip).transition);
  assert.match(chartTooltipTransition, /opacity 0\.09s/u,
    "Chart tooltips should use a short, unobtrusive appearance transition");
  assert.doesNotMatch(chartTooltipTransition, /transform/u,
    "Chart tooltip positions must not animate in from the origin or jump between heatmap cells");
  assert.equal(await page.locator(".eyebrow, .hero-copy").count(), 0,
    "The dashboard starter must not render an autogenerated eyebrow or unnecessary subtitle");
  assert.equal(await page.getByRole("heading", {
    name: /executive summary|key insights|what this means|recommended next steps/iu,
  }).count(), 0, "The dashboard starter must not introduce narrative or recommendation sections");
  assert.ok(initialDashboardTitles.every((title) => !/\d+%|is surging|is accelerating/iu.test(title)),
    "Authored dashboard and chart headings must not encode snapshot-specific findings");
  assert.equal(await page.locator(".dashboard-fixture-label").count(), 0,
    "The protected application top bar should not contain a sample-data label");
  const funnel = page.locator('[data-component-id="activation-funnel"]');
  assert.deepEqual(await funnel.locator(".chart-funnel-stage-name").allTextContents(),
    ["Signed up", "Created workspace", "First key action", "Activated"]);
  await page.getByRole("button", { name: "Product segment", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Studio", exact: true }).click();
  assert.deepEqual(await funnel.locator(".chart-funnel-stage").evaluateAll((stages) =>
    stages.map((stage) => Number(stage.getAttribute("aria-label").match(/: ([\d,]+), /u)[1].replaceAll(",", "")))),
  [1247, 665, 470, 292], "The example funnel must show the selected Studio cohort, not all accounts");
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  assert.ok(await page.locator(".metric-mini-trend").count() >= 3,
    "KPI cards should show compact sparklines derived from reviewed historical values");
  assert.equal(await page.locator(".metric-item").first()
    .evaluate((metric) => getComputedStyle(metric).alignContent), "space-between",
  "KPI titles and values should occupy opposite ends of the existing card height");
  assert.ok(await page.locator(".metric-mini-trend linearGradient stop[offset='100%']").count() >= 3,
    "Reviewed KPI sparklines should fade into a subtle transparent vertical gradient");
  const priorityAccounts = page.locator('[data-component-id="priority-accounts"]');
  assert.equal(await priorityAccounts.locator(".regional-marker").count(), 3,
    "The regional activity map should show one marker for each reviewed region");
  assert.ok((await priorityAccounts.locator(".regional-map-land").getAttribute("d")).length >= 10000,
    "Regional activity should use detailed real-world Natural Earth coastline geometry");
  assert.equal(await priorityAccounts.locator(".regional-map-dot-field, #regional-map-dots").count(), 0,
    "Regional maps should render clean geography without hidden decorative dot textures");
  assert.deepEqual(await priorityAccounts.locator(".regional-summary-name").allInnerTexts(),
    ["North America", "EMEA", "APAC"], "The compact map legend must use the reviewed account regions");
  assert.deepEqual(await priorityAccounts.locator(".regional-marker-value").allInnerTexts(),
    ["5.4K", "4.2K", "2.9K"], "Reviewed regional account totals should appear directly on the map");
  assert.equal(await priorityAccounts.locator(".regional-summary-risk").count(), 0,
    "Regional risk details should remain in marker tooltips instead of crowding the legend");
  const emeaMarker = priorityAccounts.getByRole("button", {
    name: /EMEA: 4\.2K active users, 3 accounts, 2 elevated risk/u,
  });
  const regionalMapGeometry = await emeaMarker.evaluate((marker) => {
    const map = marker.closest(".regional-map");
    const surface = map.querySelector(".regional-map-surface");
    const position = surface.createSVGPoint();
    position.x = 303;
    position.y = 79;
    const anchor = position.matrixTransform(surface.getScreenCTM());
    const bounds = marker.getBoundingClientRect();
    return {
      height: map.getBoundingClientRect().height,
      aspectRatio: surface.getBoundingClientRect().width / surface.getBoundingClientRect().height,
      horizontalOffset: Math.abs(bounds.x + bounds.width / 2 - anchor.x),
      verticalOffset: Math.abs(bounds.y + bounds.height / 2 - anchor.y),
    };
  });
  assert.ok(regionalMapGeometry.height >= 168,
    "The regional map should use the extra space recovered by compact inline risk labels");
  assert.ok(Math.abs(regionalMapGeometry.aspectRatio - 560 / 220) <= .01,
    "The regional map must preserve its real-world projected proportions without stretching");
  assert.ok(regionalMapGeometry.horizontalOffset <= 1 && regionalMapGeometry.verticalOffset <= 1,
    "Regional activity markers must remain pinned to their actual geographic map coordinates");
  const regionalLegendLayout = await priorityAccounts.locator(".regional-legend")
    .evaluate((legend) => ({ display: getComputedStyle(legend).display,
      justification: getComputedStyle(legend).justifyContent }));
  assert.deepEqual(regionalLegendLayout, { display: "flex", justification: "center" },
    "Regional colors should use the same compact centered legend treatment as other charts");
  const regionalLegendBottom = await priorityAccounts.evaluate((card) => {
    const legend = card.querySelector(".regional-legend").getBoundingClientRect();
    return card.getBoundingClientRect().bottom - legend.bottom;
  });
  assert.ok(regionalLegendBottom <= 20,
    "The regional map legend should sit at the bottom like the other chart legends");
  await emeaMarker.hover();
  assert.match(await priorityAccounts.getByRole("tooltip").filter({ hasText: "EMEA" }).innerText(),
    /4\.2K active users[\s\S]*2 elevated risk/u,
    "Regional marker hover details must describe reviewed activity and elevated risk");
  for (const componentId of ["segment-composition", "channel-composition", "engagement-heatmap",
    "engagement-scatter"]) {
    const chart = page.locator(`[data-component-id="${componentId}"]`);
    assert.equal(await chart.count(), 1, `${componentId} must appear in the richer starter dashboard`);
    assert.ok(await chart.locator("svg.recharts-surface").count(),
      `${componentId} must render an actual chart rather than a decorative placeholder`);
  }
  assert.ok(await page.locator('[data-component-id="engagement-heatmap"] .chart-heatmap-cell').count() >= 70,
    "The starter heatmap should demonstrate a dense sequential color scale");
  const customerActivity = page.locator('[data-component-id="engagement-heatmap"]');
  assert.match(await customerActivity.innerText(), /12 AM/u,
    "Customer-activity time labels should use an understandable 12-hour clock");
  assert.match(await customerActivity.innerText(), /12 PM/u,
    "Customer-activity time labels should distinguish afternoon hours");
  assert.equal(await customerActivity.locator(".chart-axis-label").count(), 0,
    "Customer activity should omit redundant hour-of-day axis titles");
  const spacingViewport = page.viewportSize();
  for (const width of [spacingViewport.width, 1000, 760]) {
    await page.setViewportSize({ width, height: spacingViewport.height });
    for (const selector of [".visual-analysis-grid", ".diagnostic-layout", ".analysis-layout"]) {
      const spacing = await page.locator(selector).first().evaluate((section) => {
        const style = getComputedStyle(section);
        return { columnGap: style.columnGap, rowGap: style.rowGap, top: style.paddingTop,
          sectionStart: section.classList.contains("dashboard-section-start") };
      });
      assert.equal(spacing.columnGap, "20px", `${selector} should preserve the horizontal card gap`);
      assert.equal(spacing.rowGap, "20px", `${selector} should preserve the vertical card gap`);
      assert.equal(spacing.top, spacing.sectionStart ? "40px" : "20px",
        `${selector} should separate titled sections without changing the card gaps`);
    }
  }
  await page.setViewportSize(spacingViewport);
  for (const id of ["segment-composition", "channel-composition", "growth-drivers", "forecast-outlook",
    "engagement-heatmap", "engagement-scatter", "adoption-scenario", "segment-breakdown", "priority-accounts"]) {
    const card = page.locator(`[data-component-id="${id}"]`);
    assert.equal(await card.evaluate((element) => getComputedStyle(element).getPropertyValue("--dashboard-visualization-height").trim()), "320px",
      `${id} should inherit the shared compact visualization-height token`);
    assert.ok((await card.boundingBox()).height >= 250, `${id} must retain readable plot space inside the sortable row`);
    const cardDimensions = await card.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      children: [...element.children].map((child) => ({
        className: child.className,
        height: Math.round(child.getBoundingClientRect().height),
        bottom: Math.round(child.getBoundingClientRect().bottom - element.getBoundingClientRect().top),
      })),
    }));
    assert.ok(cardDimensions.scrollHeight <= cardDimensions.clientHeight + 2,
      `${id} should fit its chart, labels, and controls inside the compact card (${JSON.stringify(cardDimensions)})`);
  }
  const metricHeight = Math.round((await page.locator(".metric-item").first().boundingBox()).height);
  assert.ok(metricHeight >= 112 && metricHeight <= 156,
    `KPI cards fit a separate value and comparison row independently of visualization height: ${metricHeight}`);
  assert.ok(await page.locator('[data-component-id="engagement-scatter"] .recharts-scatter-symbol').count() >= 60,
    "The starter scatter plot should include enough reviewed account observations to show a distribution");
  const channelMix = page.locator('[data-component-id="channel-composition"]');
  async function assertAlignedStackClips(action) {
    const mismatches = await channelMix.evaluate((chart) => {
      const columns = new Map();
      for (const group of chart.querySelectorAll("g[data-stack-sign]")) {
        const clip = group.querySelector("clipPath path");
        const mark = group.querySelector("path[clip-path]");
        if (!clip || !mark) continue;
        const clipBounds = clip.getBBox();
        const markBounds = mark.getBBox();
        const key = Math.round(markBounds.x * 10) / 10;
        const entries = columns.get(key) ?? [];
        entries.push({ y: clipBounds.y, height: clipBounds.height });
        columns.set(key, entries);
      }
      return [...columns.entries()].flatMap(([column, clips]) => clips.slice(1).flatMap((clip) =>
        Math.abs(clip.y - clips[0].y) > 0.75 || Math.abs(clip.height - clips[0].height) > 0.75
          ? [{ column, clips }] : []));
    });
    assert.deepEqual(mismatches, [],
      `Visible stack segments must share one rounded outer clip ${action}: ${JSON.stringify(mismatches.slice(0, 2))}`);
  }
  const referralSeries = channelMix.getByRole("button", { name: "Toggle Referrals" });
  const communitySeries = channelMix.getByRole("button", { name: "Toggle Community" });
  await referralSeries.click();
  await assertAlignedStackClips("after hiding a middle legend item");
  await communitySeries.click();
  await assertAlignedStackClips("after hiding the exposed top legend item");
  await referralSeries.click();
  await assertAlignedStackClips("after restoring a middle legend item");
  await communitySeries.click();
  await assertAlignedStackClips("after restoring the exposed top legend item");
  assert.equal(await page.locator(".brand-mark, .showcase-mark").count(), 0);
  const initialChrome = await page.locator(".dashboard-topbar").boundingBox();
  const dashboardWidth = await page.locator(".dashboard-topbar")
    .evaluate((header) => header.closest(".dashboard-root").getBoundingClientRect().width);
  assert.equal(initialChrome.x, 0, "Dashboard header does not start at the viewport edge");
  assert.equal(initialChrome.y, 0, "Dashboard header is not aligned to the top of the viewport");
  assert.equal(initialChrome.width, dashboardWidth, "Dashboard header does not span the dashboard");
  assert.equal(await page.locator('[data-data-app-chrome="topbar"]').count(), 1,
    "Dashboards must retain exactly one protected application top bar");
  assert.equal(await page.locator('main[data-data-app-content="dashboard"]').count(), 1,
    "Dashboard composition must remain inside the authored content boundary");
  const reportingRange = page.getByRole("button", { name: "Date range" });
  await reportingRange.click();
  await page.getByRole("menuitem", { name: "Custom range…", exact: true }).click();
  const reportingCalendar = page.locator(".date-range-calendar");
  assert.equal(await reportingCalendar.count(), 1,
    `Opening the reporting range should show the calendar: ${failures.join("; ")}`);
  assert.equal(await reportingCalendar.getByRole("group", { name: "July 2026" }).count(), 1,
    `Custom reporting ranges should open the navigable calendar: ${await reportingCalendar.innerText()}`);
  assert.equal(await reportingCalendar.getByRole("group", { name: "June 2026" }).count(), 1,
    "The desktop range picker should show adjacent calendar months like the shadcn range-picker pattern");
  assert.equal(await reportingCalendar.locator('input[type="date"]').count(), 0,
    "The custom range should use the existing two-month calendar");
  await reportingCalendar.getByRole("button", { name: "Monday, July 6, 2026" }).click();
  assert.match(await reportingCalendar.innerText(), /Select an end date/u,
    "A real date-range picker should keep the calendar open after choosing the start date");
  await reportingCalendar.getByRole("button", { name: "Monday, July 20, 2026" }).click();
  assert.match(await reportingRange.innerText(), /Jul 6\s+–\s+20, 2026/u,
    "Selecting a reviewed range should display both endpoints in the compact same-month format");
  await reportingRange.click();
  await page.getByRole("menuitem", { name: "All available dates", exact: true }).click();
  assert.ok(await page.locator(".metric-mini-trend").count() >= 4,
    "Every KPI with reviewed historical observations should display its compact gradient sparkline");
  const usageTrend = page.locator('[data-component-id="usage-trend"]');
  assert.equal(await usageTrend.locator(".recharts-area").count(), 0,
    "Line charts must not render an area beneath the reviewed line");
  assert.equal(await usageTrend.locator(".trend-target-summary, .trend-target-marker").count(), 0,
    "The primary trend should not repeat target progress in a separate summary strip");
  await page.screenshot({ path: join(screenshots, "desktop-baseline.png"), fullPage: true });

  for (const width of [1440, 760]) {
    await page.setViewportSize({ width, height: 1050 });
    for (const trigger of await page.getByRole("button", { name: "More information" }).all()) {
      await trigger.evaluate((button) => button.scrollIntoView({ block: "center" }));
      await trigger.hover();
      const tooltip = await trigger.evaluate((button) => {
        const description = document.getElementById(button.getAttribute("aria-describedby"));
        if (!description) return { section: button.closest("[data-component-id]")?.dataset.componentId,
          visible: "missing", clippedBy: [] };
        const bounds = description.getBoundingClientRect();
        const component = button.closest("[data-component-id]");
        const componentBounds = component?.getBoundingClientRect();
        const componentLeft = componentBounds ? Math.max(12, componentBounds.left + 12) : 0;
        const componentRight = componentBounds
          ? Math.min(window.innerWidth - 12, componentBounds.right - 12) : window.innerWidth;
        const clippedBy = [];
        for (let ancestor = description.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          const frame = ancestor.getBoundingClientRect();
          if ([style.overflow, style.overflowX, style.overflowY].some((value) => /hidden|clip|auto|scroll/.test(value)) &&
            (bounds.left < frame.left || bounds.right > frame.right || bounds.top < frame.top || bounds.bottom > frame.bottom)) {
            clippedBy.push(ancestor.className);
          }
        }
        return { section: button.closest("[data-component-id]")?.dataset.componentId,
          visible: getComputedStyle(description).visibility,
          whiteSpace: getComputedStyle(description).whiteSpace,
          contentOverflow: description.scrollWidth - description.clientWidth,
          left: bounds.left,
          right: bounds.right,
          viewportWidth: window.innerWidth,
          componentLeft,
          componentRight,
          clippedBy,
          portaled: description.parentElement === document.body };
      });
      assert.equal(tooltip.visible, "visible", `${tooltip.section} information tooltip does not open on hover`);
      assert.equal(tooltip.portaled, true,
        `${tooltip.section} information tooltip should escape authored overflow through the document-level overlay`);
      assert.equal(tooltip.whiteSpace, "normal", `${tooltip.section} information tooltip does not wrap`);
      assert.ok(tooltip.contentOverflow <= 1,
        `${tooltip.section} information tooltip content overflows by ${tooltip.contentOverflow}px`);
      assert.ok(tooltip.left >= -1 && tooltip.right <= tooltip.viewportWidth + 1,
        `${tooltip.section} information tooltip escapes the viewport: ${JSON.stringify(tooltip)}`);
      if (tooltip.componentRight - tooltip.componentLeft >= 180) {
        assert.ok(tooltip.left >= tooltip.componentLeft - 1 && tooltip.right <= tooltip.componentRight + 1,
          `${tooltip.section} information tooltip escapes its component: ${JSON.stringify(tooltip)}`);
      }
      assert.deepEqual(tooltip.clippedBy, [], `${tooltip.section} information tooltip is clipped by ${tooltip.clippedBy.join(", ")}`);
    }
  }

  for (const width of [820, 760, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    const metrics = await page.locator(".metric-item").evaluateAll((items) => items.map((metric) => {
      const card = metric.getBoundingClientRect();
      const children = [...metric.querySelectorAll(".comparison, .metric-detail, .metric-sparkline, .data-metric-value, .data-metric-change, .data-metric-sparkline")].map((element) => {
        const bounds = element.getBoundingClientRect();
        return { className: element.className, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
          contentOverflow: element.scrollWidth - element.clientWidth,
          text: element.classList.contains("metric-sparkline") ? element.innerText.trim() : undefined };
      });
      const value = metric.querySelector(".data-metric-value").getBoundingClientRect();
      const change = metric.querySelector(".data-metric-change").getBoundingClientRect();
      return { id: metric.dataset.componentId, left: card.left, right: card.right, children,
        separated: value.bottom <= change.top };
    }));
    assert.ok(metrics.length > 0, "The starter should demonstrate optional metric cards without prescribing their count");
    assert.equal(metrics.some(({ children }) => children.some(({ className }) => className === "metric-sparkline")),
      false, "The starter should not add metric sparklines by default");
    for (const metric of metrics) {
      const value = metric.children.find(child => child.className.includes("data-metric-value"));
      const change = metric.children.find(child => child.className.includes("data-metric-change"));
      if (value && change) assert.ok(value.right <= change.left + 1 || change.right <= value.left + 1 || value.bottom <= change.top + 1 || change.bottom <= value.top + 1,
        `${metric.id} value and comparison overlap at ${width}px: ${JSON.stringify({value, change})}`);
      assert.ok(metric.separated, `${metric.id} value and comparison overlap at ${width}px`);
      for (const child of metric.children) {
        assert.ok(child.left >= metric.left - 1 && child.right <= metric.right + 1,
          `${metric.id} ${child.className} escapes its metric at ${width}px: ${JSON.stringify({ metric, child })}`);
        assert.ok(child.contentOverflow <= 1,
          `${metric.id} ${child.className} content overflows by ${child.contentOverflow}px at ${width}px`);
        if (child.className === "metric-sparkline") {
          assert.equal(child.text, "", `${metric.id} sparkline renders a stray footer label at ${width}px`);
        }
      }
    }
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(pageOverflow <= 1, `KPI content introduces ${pageOverflow}px of page overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  const supportingChart = page.locator('[data-component-id="segment-breakdown"]');
  const rankedRows = supportingChart.locator(".chart-ranked-list-row");
  assert.equal(await rankedRows.count(), 5, "Ranked examples should start compact");
  const rankedLayout = await rankedRows.first().evaluate((row) => {
    const card = row.closest(".dashboard-component");
    const style = getComputedStyle(card);
    return { rowWidth: row.getBoundingClientRect().width, cardWidth: card.getBoundingClientRect().width,
      inset: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2 };
  });
  assert.ok(Math.abs(rankedLayout.rowWidth - rankedLayout.cardWidth + rankedLayout.inset) <= 1,
    `Ranked rows should fill the panel: ${JSON.stringify(rankedLayout)}`);
  await supportingChart.getByRole("button", { name: "Show 7 more" }).click();
  assert.equal(await rankedRows.count(), 12);
  await supportingChart.getByRole("button", { name: "Show fewer" }).click();
  assert.equal(await rankedRows.count(), 5);
  assert.equal(await page.locator('[data-component-id="notes"]').count(), 0,
    "The dashboard should not include an unnecessary Notes block");
  assert.equal(await page.locator(".search").evaluate((input) => getComputedStyle(input).fontSize), "14px");
  const evidenceTable = page.locator('[data-component-id="usage-details"]');
  assert.equal(await evidenceTable.getByRole("columnheader", { name: "Net change" }).count(), 1);
  assert.ok(await evidenceTable.locator(".table-sparkline").count() >= 6,
    "Account rows should show compact trends derived entirely from reviewed account history");
  assert.ok(await evidenceTable.locator(".table-data-bar-track > span").count() >= 6,
    "Comparable engagement scores should show their position within the actual reviewed-account distribution");
  assert.ok(await evidenceTable.locator(".table-distribution-marker").count() >= 6,
    "Each reviewed-account distribution needs a marker for that specific account's engagement score");
  assert.ok(await evidenceTable.locator(".table-status[data-status]").count() >= 6,
    "Reviewed risk tiers should remain legible as colored text chips");
  assert.equal(await evidenceTable.locator(".table-status > span").count(), 0,
    "Risk chips should not include redundant colored dots");
  const usageTrendVisual = evidenceTable.locator(".table-cell-sparkline .table-visual-trigger").first();
  await usageTrendVisual.hover({ position: { x: 2, y: 10 } });
  const usageTooltip = page.getByRole("tooltip").filter({ hasText: "Usage trend" });
  const firstObservation = await usageTooltip.locator("strong").innerText();
  const usageBounds = await usageTrendVisual.boundingBox();
  await usageTrendVisual.hover({ position: { x: usageBounds.width - 2, y: 10 } });
  assert.notEqual(await usageTooltip.locator("strong").innerText(), firstObservation,
    "Reviewed usage sparklines should track the hovered observation");
  assert.doesNotMatch(await usageTooltip.innerText(), /→|\d+ of \d+/u,
    "Sparkline tooltips should not dump the entire history or expose meaningless point indexes");
  assert.equal(await usageTrendVisual.getAttribute("title"), null);
  const engagementVisual = evidenceTable.locator(".table-cell-bar .table-visual-trigger").first();
  await engagementVisual.hover();
  assert.match(await page.getByRole("tooltip").filter({ hasText: "Engagement" }).innerText(), /percentile/u,
    "Engagement distributions should explain the reviewed score and its percentile");
  const deltaCells = await evidenceTable.locator('td[data-delta]').evaluateAll((cells) => {
    const probe = document.createElement("span");
    document.body.append(probe);
    const expected = Object.fromEntries(["positive", "negative"].map((direction) => {
      probe.style.color = `var(--movement-${direction}, var(--${direction}))`;
      return [direction, getComputedStyle(probe).color];
    }));
    probe.remove();
    return cells.map((cell) => ({ direction: cell.dataset.delta, value: cell.innerText,
      color: getComputedStyle(cell).color, expected: expected[cell.dataset.delta] }));
  });
  assert.ok(deltaCells.some(({ direction, value }) => direction === "positive" && /^\+/.test(value)),
    "The example evidence table should include explicitly positive signed changes");
  assert.ok(deltaCells.some(({ direction, value }) => direction === "negative" && /^-/.test(value)),
    "The example evidence table should include explicitly negative signed changes");
  assert.ok(deltaCells.every(({ color, expected }) => color === expected),
    "Positive and negative table deltas must use their theme-aware semantic colors");
  const tableFilters = page.getByRole("region", { name: "Account health filters", exact: true });
  const tableHeader = page.locator('[data-sortable-row="dashboard:evidence"] .sortable-row-header');
  assert.ok((await tableHeader.boundingBox()).y < (await evidenceTable.boundingBox()).y,
    "Account health controls belong in the section header above their table");
  const tableProduct = tableFilters.getByRole("button", { name: "Product", exact: true });
  const tableRisk = tableFilters.getByRole("button", { name: "Risk", exact: true });
  assert.equal(await tableProduct.count(), 1, "Account health should offer a section-local product filter");
  assert.equal(await tableRisk.count(), 1, "Account health should offer a section-local risk filter");
  await tableProduct.click();
  await page.getByRole("menuitemradio", { name: "Studio" }).click();
  assert.equal(await evidenceTable.locator("tbody tr").count(), 3,
    "The table product filter should limit reviewed account rows to the selected product");
  await tableRisk.click();
  await page.getByRole("menuitemradio", { name: "Low" }).click();
  assert.equal(await evidenceTable.locator("tbody tr").count(), 2,
    "Product and risk filters should combine without changing other dashboard components");
  await tableRisk.click();
  await page.getByRole("menuitemradio", { name: "All" }).click();
  await tableProduct.click();
  await page.getByRole("menuitemradio", { name: "All" }).click();
  const scenarioPresets = page.getByRole("button", { name: "Scenario", exact: true });
  assert.equal(await scenarioPresets.count(), 0,
    "Direct scenario assumptions should not be duplicated by a redundant preset selector");
  assert.equal(await page.getByRole("button", { name: "Reset baseline" }).count(), 0,
    "Direct scenario assumptions must not introduce a redundant reset action");
  assert.equal(await page.locator('[data-component-id="adoption-scenario"] .recharts-line').count(), 3,
    "Scenario analysis should show only reviewed history, the baseline, and the modeled forecast");
  const activationLift = page.locator(".scenario-lever input").first();
  const scenarioHandleAlignment = await activationLift.locator("..").evaluate((lever) => {
    const handle = lever.querySelector(".data-slider-handle").getBoundingClientRect();
    const control = lever.getBoundingClientRect();
    return Math.abs(handle.top + handle.height / 2 - (control.top + control.height / 2));
  });
  assert.ok(scenarioHandleAlignment <= 1,
    "Scenario slider handles should remain vertically centered within the control");
  const initialProjection = await page.locator(".scenario-value").innerText();
  await activationLift.fill("7");
  assert.notEqual(await page.locator(".scenario-value").innerText(), initialProjection,
    "Changing a scenario assumption must update the modeled projection immediately");
  assert.equal(await page.locator(".scenario-change").getAttribute("data-direction"), "positive",
    "Positive modeled change should expose its semantic direction for theme-aware color treatment");
  await activationLift.fill("0");
  await page.evaluate(() => scrollTo(0, 0));
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.getByRole("button", { name: "Ask ChatGPT" }).click();
    const item = page.getByRole("dialog", { name: "Ask ChatGPT about this dashboard" }).getByRole("link").first();
    await item.hover();
    const hover = await item.evaluate((element) => ({
      item: getComputedStyle(element).backgroundColor,
      surface: getComputedStyle(element.closest(".dashboard-ask-zero-state")).backgroundColor,
      outline: getComputedStyle(element).outlineStyle,
      scheme: document.documentElement.getAttribute("data-color-scheme"),
      active: getComputedStyle(document.documentElement).getPropertyValue("--interaction-active"),
    }));
    assert.notEqual(hover.item, hover.surface,
      `${colorScheme} menu hover is indistinguishable from its surface: ${JSON.stringify(hover)}`);
    assert.equal(hover.outline, "none", `${colorScheme} menu hover unexpectedly shows a blue focus outline`);
    await page.keyboard.press("Escape");
  }
  await page.emulateMedia({ colorScheme: "light" });

  return { dashboardContentTitles, initialDashboardTitles };
}


// Small, deterministic regression fixture for the reported dashboard polish defects.
export function createDashboardPolishProject(template, project) {
  cpSync(template, project, { recursive: true, filter: (path) => !path.includes("/node_modules") && !path.includes("/dist") });
  const snapshot = JSON.parse(readFileSync(join(template, "src/data.json"), "utf8"));
  snapshot.id = "dashboard-polish-regressions";
  snapshot.title = "Dashboard polish regression fixtures";
  snapshot.filters = [];
  const query = Object.values(snapshot.queries)[0];
  snapshot.queries = {
    weekdays: { ...query, rows: ["Fri", "Mon", "Sat", "Sun", "Thu", "Tue", "Wed"].map((day, i) => ({ day, energy: 100 + i * 20 })) },
    months: { ...query, rows: Array.from({ length: 26 }, (_, i) => ({ month: `${2024 + Math.floor((i + 6) / 12)}-${String((i + 6) % 12 + 1).padStart(2, "0")}`, energy: 50 + (i * 37 % 160) })) },
    scales: { ...query, rows: [{ city: "Alpha", energy: 3000, cost: 30 }, { city: "Beta", energy: 1200, cost: 20 }, { city: "Gamma", energy: 2400, cost: 10 }] },
    shares: { ...query, rows: [0.004321, .75, .06, .04].map((share, i) => ({ name: `Item ${i + 1}`, share })) },
  };
  writeFileSync(join(project, "src/data.json"), JSON.stringify(snapshot));
  writeFileSync(join(project, "src/content/dashboard/DashboardContent.jsx"), `
import React from "react";
import { ChartRenderer, DataComponent, DataTable, SortableItem, SortableRegion, useDataApp } from "../../data-app-public.jsx";
const definitions = [
  { id: "weekdays", title: "Energy by weekday", queryId: "weekdays", chart: { type: "bar", x: "day", y: "energy", yLabel: "kWh" } },
  { id: "scales", title: "Energy and cost by city", queryId: "scales", chart: { type: "bar", x: "city", y: "energy", fields: ["energy", "cost"], yLabel: "kWh" } },
  { id: "months", title: "Energy delivered by month", queryId: "months", chart: { type: "bar", x: "month", y: "energy", yLabel: "kWh" } },
  { id: "line", title: "Line chart without area", queryId: "scales", chart: { type: "line", x: "city", y: "energy", fields: ["energy", "cost"], showArea: true, showYAxisLabel: false } },
  { id: "shares", title: "Share sorting", queryId: "shares" },
  ...["horizontalStackedBar", "horizontalStackedBar100"].map((type) => ({
    id: type, title: type, queryId: "weekdays", chart: { type, x: "day", y: "energy" },
  })),
];
const rows = [{ id: "first", items: ["weekdays", "scales"] }, { id: "monthly", items: ["months"] }, { id: "last", items: ["line", "shares"] },
  { id: "horizontal", items: ["horizontalStackedBar", "horizontalStackedBar100"] }];
export function DashboardContent() {
  const shell = useDataApp();
  return <article><h1>Dashboard polish regression fixtures</h1>
    <SortableRegion id="polish" variant="canvas" columns={12} rows={rows}>
      {definitions.filter(({ id }) => shell.visible(id)).map((definition) => {
        const chart = shell.chartOverrides[definition.id] ?? definition.chart;
        const data = shell.reviewedRows(definition.queryId);
        return <SortableItem key={definition.id} id={definition.id} label={definition.title} kind={definition.chart ? "chart" : "table"} span={definition.id === "months" ? 12 : 6}>
          <DataComponent {...definition} kind={definition.chart ? "chart" : "table"} chart={chart} displayRows={data}>
            {definition.chart ? <ChartRenderer {...shell.chartProps(definition.id)} spec={chart} rows={data} height={240} /> : <DataTable rows={data} columns={[{ field: "name", label: "Name" }, { field: "share", label: "Share", presentation: "percent" }]} />}
          </DataComponent>
        </SortableItem>;
      })}
    </SortableRegion>
  </article>;
}
`);
  const build = runDataAppFixtureBuild(project, { pluginRoot: resolve(template, "../../..") });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  return join(project, "dist/index.html");
}

export async function verifyDashboardPolish({ browser, template, project, screenshots }) {
  const path = createDashboardPolishProject(template, project);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path).href);
  await page.getByRole("heading", { name: "Energy by weekday" }).waitFor();
  const component = (id) => page.locator(`[data-component-id="${id}"]`);
  await component("weekdays").locator("svg text[data-axis-layout] tspan").first().waitFor();
  assert.deepEqual(await component("weekdays").locator("svg text[data-axis-layout] tspan").allTextContents(), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  for (const type of ["horizontalStackedBar", "horizontalStackedBar100"]) {
    await component(type).scrollIntoViewIfNeeded();
    const ticks = component(type).locator(".recharts-yAxis-tick-labels text");
    await ticks.first().waitFor();
    assert.deepEqual(await ticks.evaluateAll((elements) => elements.map((element) => [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(""))),
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], `${type} should use calendar order`);
  }
  const monthLabels = await component("months").locator('svg text[text-anchor="middle"]').allTextContents();
  assert.ok(monthLabels.includes("Jul 2024") && monthLabels.some(label=>label.endsWith("2026")), JSON.stringify(monthLabels));
  const monthTicks = await component("months").locator('[data-temporal-axis-tick]').evaluateAll(elements => elements.map(element=>({
    month:Number(element.dataset.axisValue.slice(0,4))*12+Number(element.dataset.axisValue.slice(5,7)),x:Number(element.getAttribute("x")),
  })));
  assert.ok(monthTicks.length>=3);
  for (let i=1;i<monthTicks.length;i++) {
    assert.equal(monthTicks[i].month-monthTicks[i-1].month,monthTicks[1].month-monthTicks[0].month,
      "Monthly bucket labels use a constant cadence, without forcing an uneven final interval");
    assert.ok(Math.abs(monthTicks[i].x-monthTicks[i-1].x-(monthTicks[1].x-monthTicks[0].x))<1);
  }
  assert.ok(monthLabels.every((label) => !label.includes("…")));
  assert.equal(await component("line").locator(".recharts-area").count(), 0);
  assert.ok(await component("scales").locator('text[orientation="right"]').count() >= 2);
  assert.deepEqual(await component("scales").locator(".recharts-label").allTextContents(), ["kWh", "Cost"]);
  assert.equal(await component("line").locator(".recharts-label").count(), 0,
    "Hiding Y-axis titles must apply to both axes without hiding ticks");
  assert.ok(await component("line").locator('text[orientation="right"]').count() >= 2);
  await component("shares").getByRole("button", { name: "Share", exact: true }).click();
  await component("shares").getByRole("button", { name: "Share ↑", exact: true }).click();
  assert.deepEqual(await component("shares").locator("tbody tr td:first-child").allTextContents(), ["Item 2", "Item 3", "Item 4", "Item 1"]);
  assert.deepEqual(await component("shares").locator("tbody tr td:last-child").allTextContents(), ["75%", "6%", "4%", "0%"]);
  await page.getByRole("button", { name: "Edit text and layout" }).click();
  const undo = page.getByRole("button", { name: "Undo dashboard change" });
  const redo = page.getByRole("button", { name: "Redo dashboard change" });
  async function checkHistoryTooltip(button, label, keyboard = false) {
    if (keyboard) {
      await page.mouse.move(0, 0);
      await button.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
    } else await button.hover();
    const tooltip = button.locator("..").getByRole("tooltip", { name: label, exact: true });
    await page.waitForFunction((element) => {
      for (let node = element; node; node = node.parentElement) {
        if (getComputedStyle(node).opacity !== "1") return false;
      }
      return true;
    }, await tooltip.elementHandle());
  }
  assert.equal(await undo.isEnabled(), false);
  await checkHistoryTooltip(undo, "Undo");
  await component("shares").getByRole("button", { name: "Share sorting actions" }).click();
  await page.getByRole("menuitem", { name: "Hide" }).click();
  await component("shares").waitFor({ state: "detached" });
  await checkHistoryTooltip(undo, "Undo", true);
  await undo.click();
  await component("shares").waitFor();
  await checkHistoryTooltip(redo, "Redo");
  await redo.click();
  await component("shares").waitFor({ state: "detached" });
  await undo.click();
  const handle = page.getByRole("separator", { name: "Resize Energy delivered by month", exact: true });
  const originalWidth = (await component("months").boundingBox()).width;
  await handle.press("ArrowLeft");
  await page.waitForFunction((width) => document.querySelector('[data-component-id="months"]').getBoundingClientRect().width < width - 50, originalWidth);
  const resizedWidth = (await component("months").boundingBox()).width;
  await undo.click();
  await page.waitForFunction((width) => Math.abs(document.querySelector('[data-component-id="months"]').getBoundingClientRect().width - width) < 2, originalWidth);
  await redo.click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Energy by weekday" }).waitFor();
  assert.ok(Math.abs((await component("months").boundingBox()).width - resizedWidth) < 2);
  await page.getByRole("button", { name: "Edit text and layout" }).click();
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - originalWidth / 6, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction((width) => document.querySelector('[data-component-id="months"]').getBoundingClientRect().width < width - 100, resizedWidth);
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForFunction((width) => Math.abs(document.querySelector('[data-component-id="months"]').getBoundingClientRect().width - width) < 2, resizedWidth);
  // Watch every resize, not only the final layout: a dropped preview field used to
  // make the standalone row expand during an unrelated reorder, then shrink again.
  await page.evaluate(() => {
    const chart = document.querySelector('[data-component-id="months"]');
    window.polishWidthSamples = [chart.getBoundingClientRect().width];
    window.polishWidthObserver = new ResizeObserver(() => window.polishWidthSamples.push(chart.getBoundingClientRect().width));
    window.polishWidthObserver.observe(chart);
  });
  const topOrder = () => page.locator('[data-sortable-row="first"] > [data-sortable-item-id]')
    .evaluateAll((items) => items.map((item) => item.dataset.sortableItemId));
  for (const reverse of [false, true]) {
    const header = component("weekdays").locator(".component-header");
    // A visible card can still have its header underneath the sticky toolbar.
    // Center the actual drag surface before sending raw pointer coordinates.
    await header.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    const origin = await header.boundingBox();
    const target = await component("scales").boundingBox();
    await page.mouse.move(origin.x + origin.width * .7, origin.y + origin.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width * (reverse ? .1 : .9), origin.y + origin.height / 2, { steps: 12 });
    const expected = reverse ? ["weekdays", "scales"] : ["scales", "weekdays"];
    await page.waitForFunction((ids) => JSON.stringify(Array.from(document.querySelectorAll('[data-sortable-row="first"] > [data-sortable-item-id]'), (item) => item.dataset.sortableItemId)) === JSON.stringify(ids), expected);
    assert.ok(Math.abs((await component("months").boundingBox()).width - resizedWidth) < 2, "Reorder preview must preserve the standalone width");
    await page.mouse.up();
    assert.deepEqual(await topOrder(), expected);
    await undo.click();
    await redo.click();
  }
  const moveWeekdays = page.getByRole("button", { name: "Move Energy by weekday", exact: true });
  for (const finish of ["Escape", "Space"]) {
    await moveWeekdays.press("Space");
    await moveWeekdays.press("ArrowRight");
    assert.deepEqual(await topOrder(), ["scales", "weekdays"]);
    assert.ok(Math.abs((await component("months").boundingBox()).width - resizedWidth) < 2);
    await moveWeekdays.press(finish);
  }
  const widthSamples = await page.evaluate(() => {
    window.polishWidthObserver.disconnect();
    return window.polishWidthSamples;
  });
  assert.ok(widthSamples.every((width) => Math.abs(width - resizedWidth) < 2), `Standalone width changed during reorder: ${widthSamples}`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
  await page.reload();
  await component("months").waitFor();
  assert.ok(Math.abs((await component("months").boundingBox()).width - resizedWidth) < 2);
  await page.getByRole("button", { name: "Edit text and layout" }).click();
  await component("scales").getByRole("button", { name: "Energy and cost by city actions" }).click();
  await page.getByRole("menuitem", { name: "Edit chart", exact: true }).click();
  await checkHistoryTooltip(page.getByRole("button", { name: "Undo chart change" }), "Undo");
  await checkHistoryTooltip(page.getByRole("button", { name: "Redo chart change" }), "Redo");
  await page.getByRole("button", { name: "Secondary axis", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Shared scale", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await component("scales").locator('text[orientation="right"]').count(), 0);
  await undo.click();
  await component("scales").locator('text[orientation="right"]').first().waitFor();
  await component("shares").getByRole("button", { name: "Share", exact: true }).click();
  await component("shares").getByRole("button", { name: "Share ↑", exact: true }).click();
  await page.screenshot({ path: join(screenshots, "dashboard-polish.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();
}

if (process.argv[2] === "--polish") {
  const { chromium } = await import("playwright-core");
  const { installDashboardBrowserMocks, resolveChromiumExecutable } = await import("./browser-helpers.mjs");
  const { verifyEditorAskChatGPTSelectionModes } = await import("./data-app-browser-ask-chatgpt.mjs");
  const screenshots = mkdtempSync(join(tmpdir(), "data-dashboard-polish-"));
  const project = join(screenshots, "app");
  const template = resolve(dirname(fileURLToPath(import.meta.url)), "../templates/data-app/base");
  const browser = await chromium.launch({
    executablePath: resolveChromiumExecutable(),
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  try {
    // Exercise the real example as well as isolated regressions, using the same
    // assertions as the broader delivery suite rather than duplicating them.
    cpSync(template, project, { recursive: true,
      filter: (path) => !path.includes("/node_modules") && !path.includes("/dist") });
    const build = runDataAppFixtureBuild(project, { pluginRoot: resolve(template, "../../..") });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await installDashboardBrowserMocks(page);
    await page.goto(pathToFileURL(join(project, "dist/index.html")).href);
    await verifyDashboardComposition({ page, failures, screenshots });
    await verifyEditorAskChatGPTSelectionModes(page);
    assert.deepEqual(failures, []);
    await page.close();
    rmSync(project, { recursive: true, force: true });
    await verifyDashboardPolish({ browser, template, project, screenshots });
    console.log(JSON.stringify({ status: "passed", screenshots,
      interactions: ["numeric percentage sorting", "calendar order and month labels", "line without area",
        "separate axes and editor override", "hide/undo/redo", "single-block keyboard and pointer resize",
        "stable standalone width during pointer and keyboard reordering", "undo keyboard shortcut",
        "reload persistence", "undo chart changes"] }, null, 2));
  } finally {
    await browser.close();
    rmSync(project, { recursive: true, force: true });
  }
}
