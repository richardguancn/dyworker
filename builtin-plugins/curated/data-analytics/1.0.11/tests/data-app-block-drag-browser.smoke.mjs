import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { verifyDashboardSectionFilters, verifyDashboardVisualPolish } from "./data-app-browser-dashboard-composition.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = join(pluginRoot, "templates/data-app/base");
const dashboardRoot = mkdtempSync(join(tmpdir(), "data-block-dashboard-"));
cpSync(templateRoot, dashboardRoot, {
  recursive: true,
  filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
});
const dashboardBuild = runDataAppFixtureBuild(dashboardRoot, { pluginRoot });
assert.equal(dashboardBuild.status, 0, `${dashboardBuild.stdout}\n${dashboardBuild.stderr}`);
const dashboardPath = join(dashboardRoot, "dist/index.html");
const snapshot = JSON.parse(readFileSync(join(templateRoot, "src/data.json"), "utf8"));
const reportRoot = mkdtempSync(join(tmpdir(), "data-block-report-"));
const browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
const failures = [];

function region(page, id) {
  return page.locator(`[data-sortable-region="${id}"]`);
}

function row(page, id) {
  return page.locator(`[data-sortable-row="${id}"]`);
}

async function order(locator) {
  return locator.locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => item.dataset.sortableItemId));
}

async function presentation(page) {
  return page.evaluate(() => Object.values(localStorage)
    .map((value) => JSON.parse(value)).find((record) => record.presentation)?.presentation);
}

async function beginPointerDrag(page, componentId, destination, { steps = 2 } = {}) {
  const component = page.locator(`[data-component-id="${componentId}"]`);
  const previousScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  const header = component.locator(".component-header");
  await (await header.count() ? header : component).scrollIntoViewIfNeeded();
  const currentScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  // Destinations are measured by callers before scrolling the drag source into view.
  destination = {
    x: destination.x - (currentScroll.x - previousScroll.x),
    y: destination.y - (currentScroll.y - previousScroll.y),
  };
  const origin = await component.evaluate((element) => {
    const header = element.querySelector(".component-header");
    const bounds = (header ?? element).getBoundingClientRect();
    const unsafe = "button, a, input, textarea, select, [contenteditable='true'], [role='button']";
    for (const fraction of [.7, .55, .85, .4]) {
      const x = bounds.left + bounds.width * fraction;
      const y = bounds.top + bounds.height / 2;
      const target = document.elementFromPoint(x, y);
      if (target?.closest(".component-header, .metric-item") && !target.closest(unsafe)) return { x, y };
    }
    return null;
  });
  assert.ok(origin, `${componentId} must expose a safe direct-manipulation surface`);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps });
  await page.locator(".block-drag-preview").waitFor();
  return page.locator(`[data-sortable-item-id="${componentId}"] [data-block-drag-handle]`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(pathToFileURL(dashboardPath).href, { waitUntil: "load" });
  await page.locator(".dashboard-topbar-title").filter({ hasText: snapshot.title }).waitFor();
  await verifyDashboardVisualPolish(page);
  await verifyDashboardSectionFilters(page);

  const canvas = region(page, "dashboard:dashboard:canvas");
  const metrics = row(page, "dashboard:metrics");
  const diagnostics = row(page, "dashboard:diagnostics");
  const authoredMetrics = await order(metrics);
  assert.deepEqual(authoredMetrics, ["active-users", "growth", "conversion", "forecast-gap"]);
  assert.equal(await page.locator("[data-sortable-region]").count(), 1,
    "Dashboard blocks must share one canvas instead of separate nested row and block drag scopes");
  assert.equal(await page.locator('[data-sortable-kind="group"], .block-drag-handle').count(), 0,
    "Dashboard rows must not introduce a second visible row-level drag handle");
  assert.equal(await page.locator("[data-block-drag-handle]").count(), 0,
    "View mode must never expose block movement controls");
  assert.equal(await page.locator(".hero [data-sortable-item-id], .filter-bar [data-sortable-item-id]").count(), 0,
    "Dashboard titles and shared filters must remain pinned outside sortable regions");

  async function gridColumns() {
    return metrics.evaluate((container) => getComputedStyle(container).gridTemplateColumns.split(" ").length);
  }
  assert.equal(await gridColumns(), 12,
    "Dashboard rows should share a readable 12-column desktop canvas");
  await page.setViewportSize({ width: 760, height: 1800 });
  assert.equal(await gridColumns(), 6,
    "Dashboard rows should reduce to six usable columns at tablet widths");
  assert.equal(await page.locator(".sortable-item .recharts-wrapper").evaluateAll((charts) =>
    charts.every((chart) => chart.getBoundingClientRect().right
      <= chart.closest("[data-sortable-item-id]").getBoundingClientRect().right + 1)), true,
  "Charts must stay inside their block immediately while responsive observers catch up with a narrower layout");
  assert.equal(await page.evaluate(() => {
    const grid = document.createElement("div");
    grid.className = "sortable-region";
    grid.dataset.sortableColumns = "2";
    grid.style.setProperty("--sortable-columns", "2");
    document.body.append(grid);
    const count = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    grid.remove();
    return count;
  }), 2, "A two-column authored sortable grid must remain two columns at tablet widths");
  assert.equal(await row(page, "dashboard:trend").locator(":scope > [data-sortable-item-id]").first()
    .evaluate((item) => getComputedStyle(item).gridColumn), "1 / -1",
  "A wide dashboard block should become full width when its authored span exceeds the tablet grid");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await gridColumns(), 1,
    "Dashboard rows should collapse to a single readable column on mobile");
  await page.setViewportSize({ width: 1440, height: 1800 });

  await page.getByRole("button", { name: "Edit mode" }).click();
  await page.setViewportSize({ width: 760, height: 1800 });
  await page.waitForFunction(() => {
    const items = [...document.querySelectorAll('[data-sortable-row="dashboard:metrics"] > [data-sortable-item-id]')];
    const handles = items.map((item) => item.querySelector("[data-block-resize-handle]"));
    return handles[0] && !handles[0].hidden && handles[1]?.hidden && handles[2] && !handles[2].hidden;
  });
  assert.deepEqual(await metrics.locator(":scope > [data-sortable-item-id]").evaluateAll((items) =>
    items.map((item) => {
      const handle = item.querySelector("[data-block-resize-handle]");
      return handle ? { hidden: handle.hidden, disabled: handle.disabled } : null;
    })), [{ hidden: false, disabled: false }, { hidden: true, disabled: true },
    { hidden: false, disabled: false }, null],
  "Tablet layouts must expose resize grips only between real horizontal neighbors, not across wrapped rows");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => [...document.querySelectorAll("[data-block-resize-handle]")]
    .every((handle) => handle.hidden && handle.disabled));
  assert.equal(await page.locator("[data-block-resize-handle]:visible").count(), 0,
    "A single-column phone layout must not expose nonfunctional resize dividers");
  await page.setViewportSize({ width: 1440, height: 1800 });
  await page.waitForFunction(() => {
    const handle = document.querySelector('[data-sortable-item-id="active-users"] [data-block-resize-handle]');
    return handle && !handle.hidden && !handle.disabled;
  });
  const dividerAlignment = await page.locator("[data-block-resize-handle][data-resize-neighbor]:not([hidden])").evaluateAll((handles) =>
    handles.map((handle) => {
      const item = handle.closest("[data-sortable-item-id]");
      const neighbor = item.nextElementSibling;
      const source = item.getBoundingClientRect();
      const adjacent = neighbor.getBoundingClientRect();
      const divider = handle.getBoundingClientRect();
      return {
        id: item.dataset.sortableItemId,
        horizontal: divider.left + divider.width / 2 - (source.right + adjacent.left) / 2,
        vertical: divider.top + divider.height / 2
          - (Math.max(source.top, adjacent.top) + Math.min(source.bottom, adjacent.bottom)) / 2,
      };
    }));
  assert.ok(dividerAlignment.every(({ horizontal, vertical }) =>
    Math.abs(horizontal) <= 1 && Math.abs(vertical) <= 1),
  `Every resize grip must be centered both between its cards and along their shared height: ${
    JSON.stringify(dividerAlignment)}`);
  assert.equal(await page.getByRole("button", { name: "Move Weekly active users" }).count(), 1);
  assert.ok(await metrics.locator("[data-block-resize-handle]").count() >= 1,
    "Two-column metric minimums should expose useful resizing when an existing metric row has real flexibility");
  const leadingMetricDivider = metrics.locator('[data-sortable-item-id="active-users"] [data-block-resize-handle]');
  assert.equal(await leadingMetricDivider.getAttribute("aria-valuemin"), "2",
    "A long metric title must not silently increase the intended two-column metric minimum");
  await leadingMetricDivider.press("ArrowLeft");
  assert.deepEqual(await metrics.locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => Number(item.dataset.sortableSpan))), [2, 4, 3, 3],
  "The first metric should shrink to two columns and transfer its released width to the next card");
  await leadingMetricDivider.press("ArrowRight");
  const trailingMetric = metrics.locator('[data-sortable-item-id="conversion"]');
  const trailingMetricDivider = trailingMetric.locator('[data-block-resize-handle="true"]');
  assert.equal(await trailingMetricDivider.getAttribute("data-resize-neighbor"), "forecast-gap",
    "The final divider should explicitly target the last card rather than an unrelated earlier card");
  await trailingMetricDivider.press("ArrowLeft");
  assert.deepEqual(await metrics.locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => Number(item.dataset.sortableSpan))), [3, 3, 2, 4],
  "Adjusting the last shared divider must change only the final two metric cards");
  await trailingMetricDivider.press("ArrowRight");
  assert.deepEqual(await metrics.locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => Number(item.dataset.sortableSpan))), [3, 3, 3, 3],
  "The final divider must remain reversible so the last metric can return to its original width");
  await metrics.evaluate((section) => {
    const [first, second] = section.querySelectorAll("[data-block-resize-handle]:not([hidden])");
    const firstBounds = first.getBoundingClientRect();
    const secondBounds = second.getBoundingClientRect();
    first.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, button: 0, pointerId: 31, clientX: firstBounds.x, clientY: firstBounds.y,
    }));
    second.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, button: 0, pointerId: 32, clientX: secondBounds.x, clientY: secondBounds.y,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 32, clientX: secondBounds.x + 200, clientY: secondBounds.y,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 32, clientX: secondBounds.x + 200, clientY: secondBounds.y,
    }));
    window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 31 }));
  });
  assert.deepEqual(await metrics.locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => Number(item.dataset.sortableSpan))), [3, 3, 3, 3],
  "A second simultaneous touch divider gesture must not replace or corrupt an in-progress resize");
  const activeComponent = page.locator('[data-component-id="active-users"]');
  const activeHeader = activeComponent.locator(".component-header");
  const activeTitle = activeComponent.locator(".component-title-text");
  assert.equal(await page.locator(".component-drag-affordance, [data-dashboard-icon='move']").count(), 0,
    "Dashboard headers must not add position icons or decorative drag handles");
  const headerAlignment = await activeHeader.evaluate((header) => {
    const title = header.querySelector(".component-title").getBoundingClientRect();
    const menu = header.querySelector(".menu-trigger").getBoundingClientRect();
    return { title: title.top + title.height / 2, menu: menu.top + menu.height / 2 };
  });
  assert.ok(Math.abs(headerAlignment.title - headerAlignment.menu) <= 1,
    "Component titles and overflow actions must share the same visual centerline");
  const compactChartHeader = await diagnostics.locator('[data-sortable-item-id="growth-drivers"]')
    .evaluate((item) => {
      item.style.width = "184px";
      const title = item.querySelector(".component-title").getBoundingClientRect();
      const menu = item.querySelector(".menu-trigger").getBoundingClientRect();
      item.style.removeProperty("width");
      return { titleRight: title.right, menuLeft: menu.left };
    });
  assert.ok(compactChartHeader.titleRight <= compactChartHeader.menuLeft + 1,
    "Compact dashboard blocks must reserve space between their titles and overflow menus");
  const forecastValue = diagnostics.locator('[data-component-id="forecast-outlook"] .forecast-value');
  const forecastValueBounds = await forecastValue.boundingBox();
  await page.mouse.move(forecastValueBounds.x + 4, forecastValueBounds.y + forecastValueBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(forecastValueBounds.x + 30, forecastValueBounds.y + forecastValueBounds.height / 2);
  await page.mouse.up();
  assert.equal(await page.locator(".block-drag-preview").count(), 0,
    "Reviewed custom-card values must remain selectable without accidentally dragging the whole block");
  await activeHeader.hover({ position: { x: (await activeHeader.boundingBox()).width - 48, y: 10 } });
  assert.equal(await activeHeader.evaluate((header) => getComputedStyle(header).backgroundColor), "rgba(0, 0, 0, 0)",
    "Dragging must not add a second background hover treatment to the entire block header");
  assert.equal(await activeHeader.evaluate((header) => getComputedStyle(header).cursor), "grab",
    "The existing header's grab cursor should communicate direct manipulation without additional chrome");
  await activeTitle.hover();
  const titleHover = await activeTitle.evaluate((title) => ({
    background: getComputedStyle(title).backgroundColor,
    cursor: getComputedStyle(title).cursor,
    radius: getComputedStyle(title).borderRadius,
  }));
  assert.notEqual(titleHover.background, "rgba(0, 0, 0, 0)",
    "Editable component titles must retain their original shared text-edit hover background");
  assert.equal(titleHover.cursor, "text",
    "Editable component titles must communicate text editing instead of block dragging");
  assert.equal(titleHover.radius, "6px",
    "Editable component titles must retain their original shared rounded text-edit treatment");
  await activeTitle.focus();
  assert.equal(await activeTitle.evaluate((title) => getComputedStyle(title).outlineStyle), "solid",
    "Focused editable titles must retain their original shared accessible text-edit focus treatment");
  await activeTitle.press("Escape");
  assert.equal(await metrics.locator('[data-sortable-item-id="active-users"]')
    .evaluate((item) => getComputedStyle(item).outlineStyle), "none",
  "Hover affordances must not draw a distracting outline around the full dashboard block");
  assert.equal(await page.getByRole("button", { name: "Move Weekly active users" }).evaluate((button) => {
    const styles = getComputedStyle(button);
    return styles.clipPath.includes("inset") && button.getBoundingClientRect().width <= 1;
  }), true, "Keyboard Move controls should remain visually hidden until focused");
  // Hold animation callbacks to reproduce pointerup arriving before the first drag frame.
  const quickSource = await metrics.locator('[data-sortable-item-id="active-users"]').boundingBox();
  const quickTarget = await metrics.locator('[data-sortable-item-id="growth"]').boundingBox();
  await page.evaluate(() => {
    const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame, callbacks = new Map();
    let next = -1;
    window.requestAnimationFrame = callback => { const id = next--; callbacks.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { if (!callbacks.delete(id)) cancel.call(window, id); };
    window.restoreDragFrames = () => {
      window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel;
      for (const callback of callbacks.values()) request.call(window, callback);
      delete window.restoreDragFrames;
    };
  });
  try {
    await page.mouse.move(quickSource.x + 4, quickSource.y + 4);
    await page.mouse.down();
    await page.mouse.move(quickTarget.x + quickTarget.width * .8, quickTarget.y + 4);
    await page.mouse.up();
  } finally {
    await page.evaluate(() => window.restoreDragFrames());
  }
  assert.notDeepEqual(await order(metrics), authoredMetrics, "A completed quick drag must not be discarded before its first frame");
  await page.getByRole("button", { name: "Undo dashboard change", exact: true }).click();
  assert.deepEqual(await order(metrics), authoredMetrics);
  const neighboringMetric = await metrics.locator('[data-sortable-item-id="growth"]').boundingBox();
  const earlyCursor = {
    x: neighboringMetric.x + neighboringMetric.width * .3,
    y: neighboringMetric.y + neighboringMetric.height / 2,
  };
  await beginPointerDrag(page, "active-users", earlyCursor, { steps: 1 });
  assert.ok(earlyCursor.x < neighboringMetric.x + neighboringMetric.width / 2,
    "The collision scenario must keep the actual pointer before the resting block's midpoint");
  const leadingPreview = await page.locator(".block-drag-preview").boundingBox();
  assert.ok(leadingPreview.x + leadingPreview.width > neighboringMetric.x + neighboringMetric.width / 2,
  "The visible dragged block's leading edge should already extend beyond the resting block's midpoint");
  assert.deepEqual(await order(metrics), ["growth", "active-users", "conversion", "forecast-gap"],
    "Neighbors should displace as soon as the dragged block crosses their midpoint, not when its cursor does");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual(await order(metrics), authoredMetrics,
    "Canceling a geometry-driven preview must restore the authored block positions");
  const targetMetric = await metrics.locator('[data-sortable-item-id="conversion"]').boundingBox();
  const metricHandle = await beginPointerDrag(page, "active-users", {
    x: targetMetric.x + targetMetric.width * .82,
    y: targetMetric.y + targetMetric.height / 2,
  });
  const floating = page.locator(".block-drag-preview");
  assert.equal(await floating.getAttribute("aria-hidden"), "true");
  assert.ok(await floating.getAttribute("inert") !== null,
    "The floating dragged block must remain outside the accessibility and focus trees");
  assert.equal(await floating.locator("[data-component-id], [data-query-id], [id]").count(), 0,
    "The floating dragged block must not duplicate component identity, source identity, or DOM IDs");
  assert.equal(await page.locator('[data-component-id="active-users"]').count(), 1,
    "Dragging a block must retain exactly one registered source-backed component");
  assert.ok(Number(await metrics.locator('[data-sortable-item-id="active-users"]')
    .evaluate((item) => getComputedStyle(item).opacity)) < 1,
  "The original block should become translucent while its body-portal preview floats");
  assert.equal(await floating.getAttribute("data-drag-direction"), "1",
    "Dragging toward the right should apply a positive directional tilt");
  const preservedPreview = await floating.evaluate((element) => ({
    container: Math.round(element.getBoundingClientRect().width),
    content: Math.round(element.firstElementChild.getBoundingClientRect().width),
  }));
  assert.ok(Math.abs(preservedPreview.container - preservedPreview.content) < 8,
    "The detached drag preview must retain the block's original measured width without collapsing");
  await page.evaluate(() => {
    window.__blockDropTiming = { charts: [...document.querySelectorAll(".recharts-wrapper")] };
    window.addEventListener("pointerup", () => {
      window.__blockDropTiming.released = performance.now();
      const preview = document.querySelector(".block-drag-preview");
      const destination = document.querySelector('[data-sortable-item-id="active-users"]');
      const previewBounds = preview?.getBoundingClientRect();
      const destinationBounds = destination?.getBoundingClientRect();
      window.__blockDropTiming.before = previewBounds && destinationBounds ? {
        x: previewBounds.x, y: previewBounds.y,
        destinationX: destinationBounds.x, destinationY: destinationBounds.y,
      } : null;
      requestAnimationFrame(() => {
        window.__blockDropTiming.painted = performance.now();
        const firstBounds = document.querySelector(".block-drag-preview")?.getBoundingClientRect();
        window.__blockDropTiming.first = firstBounds && { x: firstBounds.x, y: firstBounds.y };
      });
    }, { capture: true, once: true });
  });
  await page.mouse.up();
  const releasedState = await page.evaluate(() => {
    const item = document.querySelector('[data-sortable-item-id="active-users"]');
    const preview = document.querySelector(".block-drag-preview");
    return { dragging: item.classList.contains("is-dragging"),
      opacity: getComputedStyle(item).opacity,
      resizeHandles: item.closest("[data-sortable-row]").querySelectorAll("[data-block-resize-handle]").length,
      settling: preview?.dataset.dragSettling,
      duration: preview && getComputedStyle(preview).transitionDuration,
      properties: preview && getComputedStyle(preview).transitionProperty };
  });
  assert.equal(releasedState.settling, "true",
    "A released dragged block should remain visible while it animates into its final position");
  assert.equal(releasedState.dragging, false,
    "Pointer release must immediately end the live gesture while its inert visual preview settles");
  assert.equal(releasedState.opacity, "1",
    "A dropped block must regain full opacity immediately instead of lingering in its dragging state");
  assert.ok(releasedState.resizeHandles > 0,
    "Resize controls must become available immediately without waiting for the cosmetic drop animation");
  assert.equal(releasedState.duration, "0.22s",
    "The drop animation should settle over the restrained default duration instead of snapping");
  assert.equal(releasedState.properties, "transform",
    "The drop animation should use a compositor-friendly transform without animating layout properties");
  await page.waitForFunction(() => window.__blockDropTiming?.painted);
  const dropPerformance = await page.evaluate(() => ({
    duration: window.__blockDropTiming.painted - window.__blockDropTiming.released,
    preservedCharts: window.__blockDropTiming.charts.every((chart) => chart.isConnected),
    before: window.__blockDropTiming.before,
    first: window.__blockDropTiming.first,
  }));
  assert.ok(dropPerformance.duration < 100,
    `Dropping a block should paint promptly instead of synchronously rebuilding charts (${Math.round(dropPerformance.duration)} ms)`);
  assert.equal(dropPerformance.preservedCharts, true,
    "Persisting a block layout should leave expensive chart subtrees mounted");
  assert.ok(dropPerformance.before && dropPerformance.first,
    "The floating drag preview must remain measurable through the first settled animation frame");
  const beforeDropDistance = Math.hypot(
    dropPerformance.before.x - dropPerformance.before.destinationX,
    dropPerformance.before.y - dropPerformance.before.destinationY,
  );
  const firstDropDistance = Math.hypot(
    dropPerformance.first.x - dropPerformance.before.destinationX,
    dropPerformance.first.y - dropPerformance.before.destinationY,
  );
  assert.ok(firstDropDistance <= beforeDropDistance + 4,
    `The first drop frame must not jump away from its resting position (${beforeDropDistance.toFixed(1)}px`
      + ` to ${firstDropDistance.toFixed(1)}px)`);
  await floating.waitFor({ state: "hidden" });
  assert.deepEqual(await order(metrics), ["growth", "conversion", "active-users", "forecast-gap"],
    "Directly dragging a metric surface should reorder its dashboard row");
  await page.waitForFunction(() => Object.values(localStorage).some((value) =>
    value.includes('"blockLayouts"') && value.includes('"dashboard:dashboard:canvas"')));
  const savedMetricLayout = await presentation(page);
  assert.deepEqual(savedMetricLayout.blockLayouts["dashboard:dashboard:canvas"].rows
    .find(({ id }) => id === "dashboard:metrics").items,
  ["growth", "conversion", "active-users", "forecast-gap"]);
  assert.equal(savedMetricLayout.queries, undefined,
    "Block ordering must persist presentation only, never reviewed source rows");
  assert.equal(savedMetricLayout.blockLayouts["dashboard:dashboard:canvas"].preferredSpans["active-users"], 3,
    "Dragging a block must preserve its original preferred width separately from temporary row allocation");
  assert.equal(await metricHandle.evaluate((handle) => handle === document.activeElement), false,
    "Pointer drops must not reveal the keyboard Move label or cover the component title");
  assert.equal(await metricHandle.evaluate((handle) => {
    const styles = getComputedStyle(handle);
    return styles.clipPath.includes("inset") && handle.getBoundingClientRect().width <= 1;
  }), true, "Keyboard Move controls must remain hidden after direct pointer interaction");

  const growthHandle = page.getByRole("button", { name: "Move Week-over-week growth", exact: true });
  await growthHandle.focus();
  const keyboardPlacement = await growthHandle.evaluate((handle) => ({
    control: handle.getBoundingClientRect().bottom,
    title: handle.closest("[data-sortable-item-id]").querySelector(".component-title")
      .getBoundingClientRect().top,
  }));
  assert.ok(keyboardPlacement.control <= keyboardPlacement.title,
    "A keyboard-focused Move control must appear above the header without overlapping its title");
  await growthHandle.press("Space");
  assert.equal(await growthHandle.getAttribute("aria-pressed"), "true");
  await growthHandle.press("ArrowRight");
  await growthHandle.press("Enter");
  assert.deepEqual(await order(metrics), ["conversion", "growth", "active-users", "forecast-gap"],
    "Space, arrow keys, and Enter should preserve accessible block movement without a permanent grip");
  assert.match(await canvas.locator(':scope > [role="status"]').innerText(), /Moved Week-over-week growth/u,
    "Accessible reordering should announce the moved block and its final position");

  const conversion = page.locator('[data-component-id="conversion"]');
  await conversion.getByRole("button", { name: "Activation rate actions" }).click();
  await page.getByRole("menuitem", { name: "Hide" }).click();
  assert.deepEqual(await order(metrics), ["growth", "active-users", "forecast-gap"]);
  await growthHandle.focus();
  await growthHandle.press("Space");
  await growthHandle.press("ArrowRight");
  await growthHandle.press("Enter");
  await page.waitForFunction(() => Object.values(localStorage).some((value) => {
    const metricRow = JSON.parse(value).presentation?.blockLayouts?.["dashboard:dashboard:canvas"]?.rows
      .find(({ id }) => id === "dashboard:metrics");
    return metricRow?.items[1] === "active-users";
  }));
  assert.deepEqual((await presentation(page)).blockLayouts["dashboard:dashboard:canvas"].rows
    .find(({ id }) => id === "dashboard:metrics").items,
  ["conversion", "active-users", "growth", "forecast-gap"],
  "Moving visible neighbors must preserve a hidden component's original relative slot");
  await page.getByRole("button", { name: "Ask ChatGPT" }).click();
  await page.getByRole("dialog", { name: "Ask ChatGPT about this dashboard" })
    .getByRole("button", { name: "Restore hidden (1)" }).click();
  assert.deepEqual(await order(metrics), ["conversion", "active-users", "growth", "forecast-gap"]);

  await diagnostics.locator('[data-component-id="forecast-outlook"]').evaluate((component) => {
    const table = document.createElement("table");
    table.className = "table";
    table.dataset.layoutRegression = "dynamic-schema";
    const headings = table.createTHead().insertRow();
    for (const label of ["Customer", "Segment", "Region", "Forecast", "Target", "Confidence", "Owner"]) {
      const heading = document.createElement("th");
      heading.textContent = label;
      headings.append(heading);
    }
    const wrapper = document.createElement("div");
    wrapper.className = "table-wrap";
    wrapper.append(table);
    component.append(wrapper);
  });
  await page.evaluate(() => new Promise((resolveFrame) =>
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const changedSchemaTarget = await diagnostics.locator('[data-sortable-item-id="forecast-outlook"]').boundingBox();
  await beginPointerDrag(page, "active-users", {
    x: changedSchemaTarget.x + changedSchemaTarget.width * .82,
    y: changedSchemaTarget.y + Math.min(80, changedSchemaTarget.height / 2),
  }, { steps: 1 });
  assert.deepEqual(await order(diagnostics), ["growth-drivers", "forecast-outlook", "active-users"],
    "An expanded reviewed table schema must not silently prevent a semantic three-column neighboring block");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await diagnostics.locator('[data-layout-regression="dynamic-schema"]').evaluate((table) =>
    table.parentElement.remove());
  await page.evaluate(() => new Promise((resolveFrame) =>
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));

  const forecast = await diagnostics.locator('[data-sortable-item-id="forecast-outlook"]').boundingBox();
  await beginPointerDrag(page, "active-users", {
    x: forecast.x + forecast.width * .82,
    y: forecast.y + forecast.height / 2,
  }, { steps: 1 });
  assert.equal(await diagnostics.locator('[data-sortable-item-id="forecast-outlook"]')
    .getAttribute("data-block-drop-placement"), "after",
  "A left/right destination should retain a precise internal in-row insertion target");
  assert.equal(await diagnostics.locator('[data-sortable-item-id="forecast-outlook"]')
    .evaluate((item) => getComputedStyle(item, "::after").content), "none",
  "Live neighboring block movement should replace the redundant blue insertion line");
  await page.mouse.up();
  assert.deepEqual(await order(metrics), ["conversion", "growth", "forecast-gap"],
    "A dashboard block should be movable out of its authored source row");
  assert.deepEqual(await order(diagnostics), ["growth-drivers", "forecast-outlook", "active-users"],
    "A dashboard block should join a different row beside its destination block");
  assert.deepEqual(await diagnostics.locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => Number(item.dataset.sortableSpan))), [4, 4, 4],
  "Flexible chart minimums should allow a balanced three-block row while preserving readable sizes");
  assert.deepEqual(await metrics.locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => Number(item.dataset.sortableSpan))), [4, 4, 4],
  "Remaining source-row blocks should expand into the released width");

  const evidence = row(page, "dashboard:evidence");
  const denseTable = await evidence.locator('[data-sortable-item-id="usage-details"]').boundingBox();
  await beginPointerDrag(page, "active-users", {
    x: denseTable.x + denseTable.width * .8,
    y: denseTable.y + Math.min(80, denseTable.height / 2),
  }, { steps: 1 });
  assert.deepEqual(await order(evidence), ["usage-details", "active-users"],
    "A dense reviewed table must accept a neighboring block and scroll its reviewed columns internally");
  const denseTableSpan = Number(await evidence.locator('[data-sortable-item-id="usage-details"]')
    .getAttribute("data-sortable-span"));
  assert.ok(denseTableSpan >= 3 && denseTableSpan < 12,
    "A reviewed table should be resizable down to its semantic three-column floor");
  const tableContainment = await evidence.locator('[data-sortable-item-id="usage-details"]')
    .evaluate((item) => {
      const itemBounds = item.getBoundingClientRect();
      const tableBounds = item.querySelector(".table-wrap").getBoundingClientRect();
      return { itemRight: itemBounds.right, tableRight: tableBounds.right,
        overflow: getComputedStyle(item.querySelector(".table-wrap")).overflowX };
    });
  assert.ok(tableContainment.tableRight <= tableContainment.itemRight + 1,
    "Dense reviewed evidence must remain visually contained within its own dashboard block");
  assert.equal(tableContainment.overflow, "auto",
    "Dense reviewed evidence must expose horizontal scrolling instead of overflowing its card");
  await page.keyboard.press("Escape");
  await page.mouse.up();

  const trendBounds = await row(page, "dashboard:trend")
    .locator('[data-sortable-item-id="usage-trend"]').boundingBox();
  await beginPointerDrag(page, "forecast-gap", {
    x: trendBounds.x + trendBounds.width * .8,
    y: trendBounds.y + 4,
  }, { steps: 1 });
  assert.deepEqual(await order(row(page, "dashboard:trend")), ["usage-trend", "forecast-gap"],
    "Dragging onto the upper edge of a chart should still favor joining its existing row");
  const joinedRowSpacing = await row(page, "dashboard:trend")
    .locator(":scope > [data-sortable-item-id]").evaluateAll((items) => {
      const [first, second] = items.map((item) => item.getBoundingClientRect());
      return second.left - first.right;
    });
  assert.ok(joinedRowSpacing >= 20,
    "Moving a block into a previously single-item row must retain a visible horizontal gutter");
  assert.equal(await row(page, "row:forecast-gap").count(), 0,
    "Passing over a block edge must not immediately create an empty row");
  await page.keyboard.press("Escape");
  await page.mouse.up();

  const boundaries = await page.evaluate(() => {
    const upper = document.querySelector('[data-sortable-row="dashboard:metrics"]');
    const lower = document.querySelector('[data-sortable-item-id="usage-trend"]');
    const upperBottom = Math.max(...[...upper.querySelectorAll(":scope > [data-sortable-item-id]")]
      .map((item) => item.getBoundingClientRect().bottom));
    const lowerBounds = lower.getBoundingClientRect();
    return { top: upperBottom, bottom: lowerBounds.top,
      x: lowerBounds.left + lowerBounds.width * .8 };
  });
  assert.ok(boundaries.bottom > boundaries.top,
    "The authored dashboard must expose genuine whitespace between its metric and chart rows");
  assert.equal(await row(page, "row:forecast-gap").count(), 0,
    "Canceling an existing-row preview must not leave a generated row in the layout");
  const gap = { x: boundaries.x, y: (boundaries.top + boundaries.bottom) / 2 };
  const quickStarted = Date.now();
  await beginPointerDrag(page, "forecast-gap", gap, { steps: 1 });
  assert.equal(await page.locator('[data-row-dropzone="active"]').count(), 1,
    "A real between-row target should reveal a visible neutral insertion slot");
  assert.equal(await row(page, "row:forecast-gap").count(), 0,
    `Entering the actual gap between rows must not create a row immediately (elapsed ${Date.now() - quickStarted} ms)`);
  await page.mouse.up();
  assert.equal(await row(page, "row:forecast-gap").count(), 0,
    "Releasing before the hover delay must not create an accidental dashboard row");
  await page.locator(".block-drag-preview").waitFor({ state: "hidden" });

  const dwellStarted = Date.now();
  await beginPointerDrag(page, "forecast-gap", gap, { steps: 1 });
  await page.waitForTimeout(70);
  assert.equal(await row(page, "row:forecast-gap").count(), 0,
    "A short pause in a gap should remain biased toward the existing dashboard rows");
  assert.equal(await page.locator('[data-row-dropzone="active"]').count(), 1,
    "The intended row insertion zone must remain visible throughout its deliberate hover delay");
  const insertedRow = row(page, "row:forecast-gap");
  await insertedRow.waitFor({ state: "visible", timeout: 1500 });
  assert.ok(Date.now() - dwellStarted >= 350,
    "A new dashboard row should open only after an intentional approximately 450 ms dwell");
  assert.equal(await page.locator('[data-sortable-item-id="usage-trend"]')
    .evaluate((item) => getComputedStyle(item, "::after").content), "none",
  "An opened destination row should communicate placement without a blue horizontal rule");
  await page.mouse.up();
  assert.deepEqual(await order(insertedRow), ["forecast-gap"],
    "Intentionally dwelling in the actual gap should create a semantic dashboard row");
  assert.equal(await insertedRow.locator('[data-sortable-item-id="forecast-gap"]')
    .getAttribute("data-sortable-span"), "12",
  "An inserted standalone block should expand to the row's full available width");
  await floating.waitFor({ state: "hidden" });

  const diagnosticsChart = diagnostics.locator('[data-sortable-item-id="growth-drivers"]');
  const resizeHandle = diagnosticsChart.locator('[data-block-resize-handle="true"]');
  assert.equal(await resizeHandle.count(), 1,
    "Shared dashboard rows should expose a restrained gutter-centered resizing control");
  assert.equal(await resizeHandle.evaluate((element) => getComputedStyle(element).cursor), "col-resize");
  const rightNeighbor = diagnostics.locator('[data-sortable-item-id="forecast-outlook"]');
  await rightNeighbor.hover({ position: { x: 24, y: 80 } });
  await page.waitForFunction(() => {
    const item = document.querySelector('[data-sortable-item-id="growth-drivers"]');
    const divider = item?.querySelector("[data-block-resize-handle]");
    return divider && Number.parseFloat(getComputedStyle(divider, "::before").opacity) >= .35;
  });
  // Header heights can put the grip below the viewport even while the neighbor
  // hover point is visible. Scroll the actual pointer target before measuring it.
  await resizeHandle.scrollIntoViewIfNeeded();
  const boundary = await resizeHandle.boundingBox();
  const leftBounds = await diagnosticsChart.boundingBox();
  const rightBounds = await rightNeighbor.boundingBox();
  const expectedGutterCenter = (leftBounds.x + leftBounds.width + rightBounds.x) / 2;
  assert.ok(Math.abs(boundary.x + boundary.width / 2 - expectedGutterCenter) <= 1,
    "The resize control must be centered in the actual gap between neighboring blocks, not on chart content");
  assert.ok(boundary.width >= 36,
    "The gutter resize control should have a generous easy-to-discover pointer target");
  const gripGeometry = await resizeHandle.evaluate((element) => {
    const grip = getComputedStyle(element, "::before");
    const marks = getComputedStyle(element, "::after");
    return { height: Number.parseFloat(grip.height), width: Number.parseFloat(grip.width),
      marksHeight: Number.parseFloat(marks.height), title: element.title };
  });
  assert.ok(gripGeometry.height <= 24 && gripGeometry.width <= 3 && gripGeometry.marksHeight === 0,
    "Resize should use one restrained centered stroke rather than a prominent pill or long divider");
  assert.match(gripGeometry.title, /^Drag to resize \(\d+–\d+%\)$/u,
    "The resizing grip should describe the actual available size range in its tooltip");
  await page.mouse.move(boundary.x + boundary.width / 2, boundary.y + boundary.height / 2);
  await page.mouse.down();
  await page.mouse.move(boundary.x + boundary.width / 2 + 125, boundary.y + boundary.height / 2);
  await page.mouse.up();
  assert.equal(await diagnosticsChart.getAttribute("data-sortable-span"), "5",
    "A compact chart should grow into available neighboring space instead of remaining locked at half width");

  const growthComponent = page.locator('[data-component-id="growth-drivers"]');
  await growthComponent.getByRole("button", { name: /actions$/u }).click();
  const widthMenu = page.getByRole("menuitem", { name: "Width" });
  assert.equal(await widthMenu.count(), 0,
    "Component action menus should not expose a Width submenu when resizing belongs on the canvas");
  await page.keyboard.press("Escape");

  const forecastItem = diagnostics.locator('[data-sortable-item-id="forecast-outlook"]');
  const forecastDivider = forecastItem.locator('[data-block-resize-handle="true"]');
  await diagnostics.evaluate(async (section) => {
    await Promise.all([...section.querySelectorAll("[data-sortable-item-id]")]
      .flatMap((item) => item.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  });
  await forecastDivider.scrollIntoViewIfNeeded();
  const forecastBoundary = await forecastDivider.boundingBox();
  const canvasBounds = await canvas.boundingBox();
  const forecastBoundaryY = forecastBoundary.y + forecastBoundary.height / 2;
  await page.mouse.move(forecastBoundary.x + forecastBoundary.width / 2, forecastBoundaryY);
  await page.mouse.down();
  await page.mouse.move(forecastBoundary.x + forecastBoundary.width / 2
    + canvasBounds.width / 12, forecastBoundaryY);
  await page.mouse.up();
  assert.deepEqual(await diagnostics.locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => Number(item.dataset.sortableSpan))), [5, 4, 3],
  "Dragging a contextual divider must transfer one readable column between its neighbors while preserving every other block");
  await forecastDivider.press("ArrowLeft");
  assert.equal(await forecastItem.getAttribute("data-sortable-span"), "3",
    "The constrained resizing divider must support keyboard adjustment");
  await forecastDivider.press("ArrowRight");
  assert.equal(await forecastItem.getAttribute("data-sortable-span"), "4",
    "Repeated keyboard divider adjustments must use the latest allocated dashboard width");
  await page.waitForFunction(() => Object.values(localStorage).some((value) => {
    const layout = JSON.parse(value).presentation?.blockLayouts?.["dashboard:dashboard:canvas"];
    return layout?.preferredSpans?.["forecast-outlook"] === 4;
  }), null, { timeout: 3000 });
  assert.equal((await presentation(page)).blockLayouts["dashboard:dashboard:canvas"]
    .preferredSpans["forecast-outlook"], 4,
  "Pointer and keyboard divider adjustments must persist the owner's selected preferred width");

  const beforeCancel = await order(diagnostics);
  const cancelTarget = await diagnostics.locator('[data-sortable-item-id="forecast-outlook"]').boundingBox();
  await beginPointerDrag(page, "active-users", {
    x: cancelTarget.x + cancelTarget.width * .8,
    y: cancelTarget.y + cancelTarget.height / 2,
  });
  await page.keyboard.press("Escape");
  await floating.waitFor({ state: "hidden" });
  await page.mouse.up();
  assert.deepEqual(await order(diagnostics), beforeCancel,
    "Escape must cancel a pointer drag without persisting a provisional reorder");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('[data-component-id="growth"]').evaluate((element) =>
    element.scrollIntoView({ block: "center", behavior: "instant" }));
  const reducedTarget = await metrics.locator('[data-sortable-item-id="conversion"]').boundingBox();
  await beginPointerDrag(page, "growth", {
    x: reducedTarget.x + reducedTarget.width * .75,
    y: reducedTarget.y + reducedTarget.height / 2,
  });
  assert.equal(await floating.getAttribute("data-drag-direction"), "0",
    "Reduced motion must disable directional drag tilt");
  assert.equal(await floating.evaluate((element) => Number.parseFloat(
    getComputedStyle(element).getPropertyValue("--block-drag-rotation-duration"))), 0,
  "Reduced motion must disable rotation animation");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.reload({ waitUntil: "load" });
  await page.locator(".dashboard-topbar-title").filter({ hasText: snapshot.title }).waitFor();
  assert.deepEqual(await order(row(page, "dashboard:diagnostics")),
    ["growth-drivers", "forecast-outlook", "active-users"],
    "Committed dashboard cross-row placement must survive reload");
  assert.equal(await row(page, "dashboard:diagnostics")
    .locator('[data-sortable-item-id="forecast-outlook"]').getAttribute("data-sortable-span"), "4",
  "A divider-resized dashboard block must retain its explicit width after reload");
  assert.equal(await row(page, "row:growth-drivers").count(), 0,
    "A resize gesture should not unexpectedly promote a block into a separate row");
  assert.deepEqual(await order(row(page, "row:forecast-gap")), ["forecast-gap"],
    "Newly created dashboard rows must survive reload as presentation-only layout metadata");
  assert.equal(await page.locator("[data-block-drag-handle]").count(), 0,
    "A reloaded dashboard should return to View mode while preserving its shared block layout");

  const hiddenGenerated = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  hiddenGenerated.on("pageerror", (error) => failures.push(error.message));
  await hiddenGenerated.goto(pathToFileURL(dashboardPath).href, { waitUntil: "load" });
  await hiddenGenerated.evaluate(({ title, layout }) => {
    const key = `data-app:presentation:v1:${location.pathname}:${title}`;
    localStorage.setItem(key, JSON.stringify({ version: 1, presentation: {
      title,
      hiddenBlocks: ["forecast-gap"],
      blockLayouts: { "dashboard:dashboard:canvas": layout },
    } }));
  }, { title: snapshot.title, layout: (await presentation(page)).blockLayouts["dashboard:dashboard:canvas"] });
  await hiddenGenerated.reload({ waitUntil: "load" });
  await hiddenGenerated.getByRole("button", { name: "Edit mode" }).click();
  const hiddenNeighbor = hiddenGenerated.getByRole("button", { name: "Move Week-over-week growth", exact: true });
  await hiddenNeighbor.press("Space");
  await hiddenNeighbor.press("ArrowLeft");
  await hiddenNeighbor.press("Enter");
  await hiddenGenerated.waitForFunction(() => Object.values(localStorage).some((value) => {
    const layout = JSON.parse(value).presentation?.blockLayouts?.["dashboard:dashboard:canvas"];
    return layout?.rows.find((entry) => entry.id === "dashboard:metrics")?.items[0] === "growth"
      && layout.rows.find((entry) => entry.id === "row:forecast-gap")?.items.includes("forecast-gap");
  }));
  assert.deepEqual((await presentation(hiddenGenerated)).blockLayouts["dashboard:dashboard:canvas"].rows
    .find((entry) => entry.id === "row:forecast-gap")?.items, ["forecast-gap"],
  "Moving another block must preserve a generated row whose only saved occupant is temporarily hidden");
  await hiddenGenerated.getByRole("button", { name: "Ask ChatGPT" }).click();
  await hiddenGenerated.getByRole("dialog", { name: "Ask ChatGPT about this dashboard" })
    .getByRole("button", { name: "Restore hidden (1)" }).click();
  assert.deepEqual(await order(row(hiddenGenerated, "row:forecast-gap")), ["forecast-gap"],
    "Restoring a hidden generated-row block must return it to its user-selected row");
  await hiddenGenerated.close();

  cpSync(templateRoot, reportRoot, {
    recursive: true,
    filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
  });
  writeFileSync(join(reportRoot, "src/data.json"),
    `${JSON.stringify({ ...snapshot, surface: "report" }, null, 2)}\n`);
  // A third test-only section exercises hidden-slot reconciliation without making
  // the minimal starter grow sections merely to satisfy a drag-test fixture.
  const reportContentPath = join(reportRoot, "src/content/report/ReportContent.jsx");
  const reportContent = readFileSync(reportContentPath, "utf8");
  const extendedReport = reportContent
    .replace('const sectionOrder = ["report-trend", "report-methods"];',
      'const sectionOrder = ["report-trend", "report-methods", "report-test-appendix"];')
    .replace("</SortableRegion>", `{visible("report-test-appendix") && <SortableItem
      id="report-test-appendix" label="Additional evidence" kind="narrative">
      <ReportSection id="report-test-appendix" title="Additional evidence" queryId="usage_summary"
        sourceRows={history} showHeading={false}>
        <RichNarrative id="report-test-appendix:body" value="## Additional evidence" />
      </ReportSection>
    </SortableItem>}</SortableRegion>`);
  assert.notEqual(extendedReport, reportContent, "The report ordering fixture must add its third section");
  assert.match(extendedReport, /const sectionOrder = \["report-trend", "report-methods", "report-test-appendix"\]/u);
  writeFileSync(reportContentPath, extendedReport);
  const reportBuild = runDataAppFixtureBuild(reportRoot, { pluginRoot });
  assert.equal(reportBuild.status, 0, `${reportBuild.stdout}\n${reportBuild.stderr}`);

  const report = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  report.on("pageerror", (error) => failures.push(error.message));
  await report.goto(pathToFileURL(join(reportRoot, "dist/index.html")).href, { waitUntil: "load" });
  await report.locator(".report-hero h1").waitFor();
  assert.equal(await report.locator(".report-hero [data-sortable-item-id], "
    + '[data-component-id="report-summary"] [data-sortable-item-id]').count(), 0,
  "This authored starter keeps its introduction and opening outside the optional stack");
  await report.getByRole("button", { name: "Edit mode" }).click();
  const reportSections = region(report, "report:sections");
  const reportHandle = report.locator('[data-sortable-item-id="report-trend"] [data-block-drag-handle]');
  await reportHandle.focus();
  await reportHandle.press("Enter");
  await reportHandle.press("End");
  await reportHandle.press("Space");
  assert.deepEqual(await order(reportSections), [
    "report-methods", "report-test-appendix", "report-trend",
  ], "Report block ordering must preserve authored editorial sections without creating a dashboard grid");
  await report.waitForFunction(() => Object.values(localStorage).some((value) =>
    value.includes('"report:sections"')));
  assert.equal(await report.locator(".metric-strip, .diagnostic-layout, .analysis-layout").count(), 0);

  const hiddenReport = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  hiddenReport.on("pageerror", (error) => failures.push(error.message));
  await hiddenReport.goto(pathToFileURL(join(reportRoot, "dist/index.html")).href, { waitUntil: "load" });
  await hiddenReport.getByRole("button", { name: "Edit mode" }).click();
  const hiddenSections = region(hiddenReport, "report:sections");
  await hiddenReport.locator('[data-component-id="report-methods"]')
    .getByRole("button", { name: /actions$/u }).click();
  await hiddenReport.getByRole("menuitem", { name: "Hide" }).click();
  assert.deepEqual(await order(hiddenSections),
    ["report-trend", "report-test-appendix"]);
  const hiddenReportHandle = hiddenReport.locator('[data-sortable-item-id="report-test-appendix"] [data-block-drag-handle]');
  await hiddenReportHandle.press("Space");
  await hiddenReportHandle.press("Home");
  await hiddenReportHandle.press("Enter");
  await hiddenReport.waitForFunction(() => Object.values(localStorage).some((value) =>
    Boolean(JSON.parse(value).presentation?.blockLayouts?.["report:sections"])));
  assert.deepEqual((await presentation(hiddenReport)).blockLayouts["report:sections"].order,
    ["report-test-appendix", "report-methods", "report-trend"],
    "A report hidden before its first reorder must remain in its authored slot inside persisted layout metadata");
  await hiddenReport.getByRole("button", { name: "Ask ChatGPT" }).click();
  await hiddenReport.getByRole("dialog", { name: "Ask ChatGPT about this dashboard" })
    .getByRole("button", { name: "Restore hidden (1)" }).click();
  assert.deepEqual(await order(hiddenSections),
    ["report-test-appendix", "report-methods", "report-trend"],
    "Restoring an initially hidden report section must recover its original relative slot");
  await hiddenReport.close();

  const published = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const writes = [];
  let conflictPresentation = null;
  const hostedRows = [
    { id: "dashboard:metrics", items: ["forecast-gap", "growth", "conversion", "active-users"] },
    { id: "dashboard:trend", items: ["usage-trend"] },
    { id: "dashboard:composition", items: ["segment-composition", "channel-composition"] },
    { id: "dashboard:engagement", items: ["engagement-heatmap", "engagement-scatter"] },
    { id: "dashboard:diagnostics", items: ["growth-drivers", "forecast-outlook"] },
    { id: "dashboard:scenario", items: ["adoption-scenario"] },
    { id: "dashboard:supporting", items: ["segment-breakdown", "priority-accounts"] },
    { id: "dashboard:evidence", items: ["usage-details"] },
  ];
  const hostedPresentation = {
    canEdit: false,
    revision: 0,
    presentation: { blockLayouts: {
      "dashboard:dashboard:canvas": {
        authoredRevision: 2,
        order: hostedRows.flatMap(({ items }) => items), rows: hostedRows,
        spans: { "forecast-gap": 4, growth: 2, conversion: 3, "active-users": 3 },
        preferredSpans: { "forecast-gap": 4, growth: 2, conversion: 3, "active-users": 3 },
      },
    } },
  };
  published.on("pageerror", (error) => failures.push(error.message));
  await published.route("https://dashboard.chatgpt.site/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/presentation" && route.request().method() === "PUT") {
      const change = JSON.parse(route.request().postData());
      if (conflictPresentation) {
        hostedPresentation.presentation = conflictPresentation;
        hostedPresentation.revision += 1;
        conflictPresentation = null;
        return route.fulfill({ status: 409, contentType: "application/json",
          body: JSON.stringify(hostedPresentation) });
      }
      writes.push(change);
      hostedPresentation.presentation = change.presentation;
      hostedPresentation.revision = change.revision + 1;
    }
    const value = pathname === "/api/snapshot" ? snapshot
      : pathname === "/api/presentation" ? hostedPresentation : undefined;
    return route.fulfill(value ? { contentType: "application/json", body: JSON.stringify(value) }
      : { contentType: "text/html", body: readFileSync(dashboardPath, "utf8") });
  });
  await published.goto("https://dashboard.chatgpt.site/", { waitUntil: "load" });
  await published.locator(".dashboard-topbar-title").filter({ hasText: snapshot.title }).waitFor();
  assert.deepEqual(await order(row(published, "dashboard:metrics")),
    ["forecast-gap", "growth", "conversion", "active-users"],
    "Published viewers should see the owner's committed shared block layout");
  assert.deepEqual(await row(published, "dashboard:metrics")
    .locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => Number(item.dataset.sortableSpan))), [4, 2, 3, 3],
  "Published viewers should receive the owner's exact persisted block widths as well as block ordering");
  assert.equal(await published.locator("[data-block-drag-handle]").count(), 0,
    "Published viewers must never receive unauthorized movement controls");
  assert.equal(await published.getByRole("button", { name: "Edit mode" }).count(), 0,
    "Published viewers must never be allowed to enter block-edit mode");
  assert.deepEqual(writes, [], "Viewing an ordered published dashboard must not write presentation state");

  hostedPresentation.canEdit = true;
  await published.reload({ waitUntil: "load" });
  await published.locator(".dashboard-topbar-title").filter({ hasText: snapshot.title }).waitFor();
  await published.getByRole("button", { name: "Edit mode" }).click();
  const ownerHandle = published.getByRole("button", { name: "Move Forecast to target", exact: true });
  const writeResponse = published.waitForResponse((response) =>
    response.url().endsWith("/api/presentation") && response.request().method() === "PUT");
  await ownerHandle.focus();
  await ownerHandle.press("Space");
  await ownerHandle.press("ArrowDown");
  await ownerHandle.press("Enter");
  await writeResponse;
  assert.equal(writes.length, 1,
    "A published owner block drop must produce exactly one revision-guarded shared presentation write");
  assert.deepEqual(writes[0].presentation.blockLayouts["dashboard:dashboard:canvas"].rows
    .find(({ id }) => id === "dashboard:metrics").items,
    ["growth", "forecast-gap", "conversion", "active-users"]);
  assert.equal(writes[0].presentation.queries, undefined,
    "Published block ordering must never submit reviewed rows or query provenance");

  conflictPresentation = structuredClone(hostedPresentation.presentation);
  const concurrentRows = conflictPresentation.blockLayouts["dashboard:dashboard:canvas"].rows;
  const concurrentMetrics = concurrentRows.find(({ id }) => id === "dashboard:metrics");
  concurrentMetrics.items = ["growth", "forecast-gap", "active-users", "conversion"];
  conflictPresentation.blockLayouts["dashboard:dashboard:canvas"].order = concurrentRows.flatMap(({ items }) => items);
  const retryResponse = published.waitForResponse((response) =>
    response.url().endsWith("/api/presentation") && response.request().method() === "PUT" && response.status() === 200);
  const concurrentMove = published.getByRole("button", { name: "Move Week-over-week growth", exact: true });
  await concurrentMove.press("Space");
  await concurrentMove.press("ArrowRight");
  await concurrentMove.press("Enter");
  await retryResponse;
  assert.deepEqual(writes.at(-1).presentation.blockLayouts["dashboard:dashboard:canvas"].rows
    .find(({ id }) => id === "dashboard:metrics").items,
  ["forecast-gap", "growth", "active-users", "conversion"],
  "An actual hosted 409 retry must preserve independently reordered blocks in the same dashboard row");

  await published.reload({ waitUntil: "load" });
  await published.getByRole("button", { name: "Edit mode" }).click();
  const hostedResize = row(published, "dashboard:metrics")
    .locator('[data-sortable-item-id="forecast-gap"] [data-block-resize-handle]');
  const resizeResponse = published.waitForResponse((response) =>
    response.url().endsWith("/api/presentation") && response.request().method() === "PUT" && response.status() === 200);
  await hostedResize.press("ArrowLeft");
  await resizeResponse;
  const resizedHostedLayout = writes.at(-1).presentation.blockLayouts["dashboard:dashboard:canvas"];
  assert.deepEqual({ forecast: resizedHostedLayout.spans["forecast-gap"], growth: resizedHostedLayout.spans.growth },
    { forecast: 3, growth: 3 }, "A published owner resize must persist the selected neighboring block widths");
  assert.deepEqual({ forecast: resizedHostedLayout.preferredSpans["forecast-gap"],
    growth: resizedHostedLayout.preferredSpans.growth }, { forecast: 3, growth: 3 },
  "A published owner resize must persist preferred widths alongside its actual layout");
  hostedPresentation.canEdit = false;
  await published.reload({ waitUntil: "load" });
  await published.locator(".dashboard-topbar-title").filter({ hasText: snapshot.title }).waitFor();
  assert.deepEqual(await order(row(published, "dashboard:metrics")),
    ["forecast-gap", "growth", "active-users", "conversion"],
    "A new read-only Sites viewer must see the persisted owner and concurrent-editor ordering");
  assert.deepEqual(await row(published, "dashboard:metrics").locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => Number(item.dataset.sortableSpan))), [3, 3, 3, 3],
  "A new read-only Sites viewer must see an owner's latest persisted block resizing after reload");

  const touch = await browser.newPage({ viewport: { width: 1440, height: 950 }, hasTouch: true });
  touch.on("pageerror", (error) => failures.push(error.message));
  await touch.goto(pathToFileURL(dashboardPath).href, { waitUntil: "load" });
  await touch.getByRole("button", { name: "Edit mode" }).click();
  const touchMetrics = row(touch, "dashboard:metrics");
  const touchGrowth = touch.getByRole("button", { name: "Move Week-over-week growth", exact: true });
  await touchGrowth.press("Space");
  await touchGrowth.press("ArrowRight");
  await touchGrowth.press("ArrowRight");
  await touchGrowth.press("Enter");
  assert.deepEqual(await order(touchMetrics), ["active-users", "conversion", "forecast-gap", "growth"]);
  const edgeMetricDivider = touchMetrics.locator(
    '[data-sortable-item-id="forecast-gap"] [data-block-resize-handle]');
  await edgeMetricDivider.press("ArrowRight");
  assert.equal(await touchMetrics.locator('[data-sortable-item-id="growth"]').getAttribute("data-sortable-span"), "2",
    "A long-titled metric must remain shrinkable to two columns when positioned at the row's trailing edge");
  await edgeMetricDivider.press("ArrowLeft");
  await touchGrowth.press("Space");
  await touchGrowth.press("ArrowLeft");
  await touchGrowth.press("ArrowLeft");
  await touchGrowth.press("Enter");

  const sourceHeader = touch.locator('[data-component-id="active-users"] .component-header');
  assert.equal(await sourceHeader.evaluate((header) => getComputedStyle(header).touchAction), "none",
    "An intentional draggable header must reserve trusted touch gestures for block movement");
  assert.equal(await touchMetrics.locator('[data-sortable-item-id="active-users"] [data-block-resize-handle]')
    .evaluate((divider) => getComputedStyle(divider).touchAction), "none",
    "A resize boundary must reserve trusted touch gestures for width adjustments");
  const touchOrigin = await sourceHeader.evaluate((header) => {
    const bounds = header.getBoundingClientRect();
    const unsafe = "button, a, input, textarea, select, [contenteditable='true'], [role='button']";
    for (const fraction of [.7, .55, .85, .4]) {
      const x = bounds.left + bounds.width * fraction;
      const y = bounds.top + bounds.height / 2;
      if (!document.elementFromPoint(x, y)?.closest(unsafe)) return { x, y };
    }
    return null;
  });
  assert.ok(touchOrigin, "A metric header must expose a safe touch-drag surface");
  await touchMetrics.evaluate(async (section) => {
    await Promise.all([...section.querySelectorAll("[data-sortable-item-id]")]
      .flatMap((item) => item.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  });
  const touchDestination = await touchMetrics.locator('[data-sortable-item-id="growth"]').boundingBox();
  const touchClient = await touch.context().newCDPSession(touch);
  const dispatchTouch = (type, coordinates) => touchClient.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: coordinates ? [{ ...coordinates, radiusX: 5, radiusY: 5, force: 1, id: 1 }] : [],
  });
  await dispatchTouch("touchStart", touchOrigin);
  await dispatchTouch("touchMove", { x: touchOrigin.x + 18, y: touchOrigin.y });
  await dispatchTouch("touchMove", {
    x: touchDestination.x + touchDestination.width * .3,
    y: touchDestination.y + touchDestination.height / 2,
  });
  await touch.locator(".block-drag-preview").waitFor();
  await dispatchTouch("touchEnd");
  assert.deepEqual(await order(touchMetrics), ["growth", "active-users", "conversion", "forecast-gap"],
    "Trusted touchscreen input should reorder dashboard blocks without browser pointer cancellation");

  const chartBody = touch.locator(".recharts-wrapper").first();
  await chartBody.scrollIntoViewIfNeeded();
  assert.notEqual(await chartBody.evaluate((chart) => getComputedStyle(chart).touchAction), "none",
    "Chart content outside a draggable header must remain available for normal touchscreen scrolling");
  const chartBounds = await chartBody.boundingBox();
  const initialScroll = await touch.evaluate(() => scrollY);
  await touchClient.send("Input.synthesizeScrollGesture", {
    x: chartBounds.x + chartBounds.width / 2,
    y: Math.min(chartBounds.y + chartBounds.height / 2, 850),
    yDistance: -260,
    gestureSourceType: "touch",
  });
  assert.ok(await touch.evaluate((before) => scrollY > before, initialScroll),
    "Touch gestures over chart content must continue scrolling the dashboard normally");
  await touch.close();

  assert.deepEqual(failures, [], "Dashboard and report drag interactions must not produce browser errors");
  console.log(JSON.stringify({
    status: "passed",
    interactions: [
      "one dashboard canvas without nested or visible row handles",
      "direct-manipulation metric and header dragging", "floating inert body portal",
      "single component identity", "directional tilt", "responsive 12/6/1-column semantic rows",
      "cross-row insertion and minimum-width-constrained automatic rebalancing",
      "existing-row priority even at tall block edges", "delayed gap-only full-width new rows",
      "quick-drop rejection and deliberate 450 ms dwell", "visible sticky between-row targets",
      "fixed-size original drag previews and persistent preferred widths",
      "three-column scrollable dense tables accept neighbors without overlap",
      "dynamic reviewed table schemas preserve flexible semantic resizing",
      "constrained boundary resizing and accessible width actions",
      "resize grips appear only between actual same-row responsive neighbors",
      "overlapping pointer-resize gestures cannot corrupt an active resize",
      "independently mounted chart subtrees and prompt compositor-only drops",
      "ordinary chart and reviewed body content remains selectable without accidental dragging",
      "trusted touchscreen dragging with ordinary chart-content scrolling",
      "reversible first and last metric resizing regardless of title length",
      "layout feedback without blue insertion lines",
      "focus-visible keyboard controls",
      "keyboard pick up/move/drop", "screen-reader announcements", "Escape cancellation",
      "reduced motion", "reload persistence", "pinned dashboard chrome and report introductions",
      "hidden-component position preservation and retained hidden-only generated rows",
      "single-column editorial report section ordering",
      "read-only published viewer ordering", "one revision-guarded owner drop write",
      "published owner sizing and preferred widths persist across read-only Sites viewer reloads",
      "same-region concurrent owner edits survive hosted 409 retries",
      "initially hidden report sections retain their authored position",
      "narrow authored sortable grids remain narrow on tablets",
    ],
  }, null, 2));
} finally {
  await browser.close();
  rmSync(dashboardRoot, { recursive: true, force: true });
  rmSync(reportRoot, { recursive: true, force: true });
}
