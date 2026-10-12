import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = join(pluginRoot, "templates/data-app/base");
const projectRoot = mkdtempSync(join(tmpdir(), "data-creative-layout-"));
const snapshot = JSON.parse(readFileSync(join(templateRoot, "src/data.json"), "utf8"));

const dashboardSource = `import React from "react";
import { DataComponent, SortableItem, SortableRegion, useDataApp } from "../../data-app-public.jsx";

const bento = [{ id: "hero-visual", label: "Hero visual", featured: true },
  ...Array.from({ length: 8 }, (_, index) => ({ id: "bento-" + (index + 1), label: "Bento " + (index + 1) }))];
const fifths = Array.from({ length: 5 }, (_, index) => ({ id: "fifth-" + (index + 1), label: "Fifth " + (index + 1) }));
const dense = Array.from({ length: 7 }, (_, index) => ({ id: "dense-" + (index + 1), label: "Dense " + (index + 1) }));

function CreativeBlock({ id, label, featured = false, style }) {
  return <SortableItem id={id} label={label} kind="chart"
    className={featured ? "creative-feature" : "creative-tile"}
    style={featured ? { gridRow: "span 2", ...style } : style}>
    <DataComponent id={id} title={label} queryId="usage_summary" kind="chart">
      {featured ? <div className="creative-inner-grid" data-block-drag-surface="true">
        <span>Custom visual</span><span>Nested evidence</span></div>
        : <svg viewBox="0 0 30 12" aria-label={label + " chart"}><path d="M0 10 L10 6 L20 8 L30 2" /></svg>}
    </DataComponent>
  </SortableItem>;
}

export function DashboardContent() {
  const { visible } = useDataApp();
  return <>
    <h1>Creative layout regression dashboard</h1>
    <section className="fixed-art-direction" data-fixed-custom-layout="true">
      <DataComponent id="fixed-composition" title="Fixed composed visualization"
        queryId="usage_summary" kind="custom"><div className="creative-inner-grid">
          <span>Intentionally fixed visual</span><span>Custom evidence</span>
        </div></DataComponent>
    </section>
    <SortableRegion id="dashboard:creative:bento" label="Creative bento" variant="freeform"
      transferGroup="creative:compatible"
      authoredRevision={2} className="creative-bento" authoredOrder={bento.map(({ id }) => id)}>
      {bento.filter(({ id }) => visible(id)).map((item) => <CreativeBlock key={item.id} {...item} />)}
    </SortableRegion>
    <SortableRegion id="dashboard:creative:fifths" label="Exactly five columns"
      variant="freeform" transferGroup="creative:compatible"
      className="creative-fifths" authoredOrder={fifths.map(({ id }) => id)}>
      {fifths.filter(({ id }) => visible(id)).map((item) => <CreativeBlock key={item.id} {...item} />)}
    </SortableRegion>
    <SortableRegion id="dashboard:creative:dense" label="Seven compact visuals"
      variant="freeform" transferGroup="creative:compatible"
      className="creative-dense" authoredOrder={dense.map(({ id }) => id)}>
      {dense.filter(({ id }) => visible(id)).map((item) => <CreativeBlock key={item.id} {...item} />)}
    </SortableRegion>
    <SortableRegion id="dashboard:creative:offset" label="Offset authored component"
      variant="freeform" className="creative-offset">
      <CreativeBlock id="offset-chart" label="Offset chart" style={{ gridColumn: "3 / span 2" }} />
    </SortableRegion>
    <SortableRegion id="dashboard:creative:canvas" label="Standard editable canvas"
      variant="canvas" authoredRevision={3} columns={12}
      rows={[{ id: "creative:standard", items: ["canvas-major", "canvas-side"] }]}>
      <SortableItem id="canvas-major" label="Standard major visual" kind="chart" span={8} minSpan={3}>
        <DataComponent id="canvas-major" title="Standard major visual" queryId="usage_summary"
          kind="chart"><p>Standard resizable block</p></DataComponent>
      </SortableItem>
      <SortableItem id="canvas-side" label="Standard side visual" kind="chart" span={4} minSpan={3}>
        <DataComponent id="canvas-side" title="Standard side visual" queryId="usage_summary"
          kind="chart"><p>Standard supporting block</p></DataComponent>
      </SortableItem>
    </SortableRegion>
  </>;
}
`;

const creativeStyles = `
.fixed-art-direction { margin-block: 24px; }
.creative-bento, .creative-fifths, .creative-dense, .creative-offset {
  display: grid;
  gap: 14px;
  margin-block: 24px;
}
.creative-bento { grid-template-columns: repeat(7, minmax(0, 1fr)); grid-auto-rows: 112px; }
.creative-feature { grid-column: span 3; }
.creative-fifths { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.creative-dense { grid-template-columns: repeat(7, minmax(0, 1fr)); }
.creative-offset { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.creative-inner-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; }
.creative-tile svg { width: 100%; height: 32px; fill: none; stroke: currentColor; }
@media (max-width: 650px) {
  .creative-bento, .creative-fifths, .creative-dense, .creative-offset {
    grid-template-columns: minmax(0, 1fr);
  }
  .creative-feature { grid-column: auto; }
  .creative-offset > .sortable-item { grid-column: 1 / -1 !important; }
}
`;

cpSync(templateRoot, projectRoot, {
  recursive: true,
  filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
});
writeFileSync(join(projectRoot, "src/content/dashboard/DashboardContent.jsx"), dashboardSource);
writeFileSync(join(projectRoot, "src/content/dashboard/dashboard.css"),
  readFileSync(join(templateRoot, "src/content/dashboard/dashboard.css"), "utf8") + creativeStyles);
const build = runDataAppFixtureBuild(projectRoot, { pluginRoot });
assert.equal(build.status, 0, build.stdout + "\n" + build.stderr);

const browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
const failures = [];
const htmlPath = join(projectRoot, "dist/index.html");
const bentoOrder = ["hero-visual", ...Array.from({ length: 8 }, (_, index) => "bento-" + (index + 1))];
const denseOrder = Array.from({ length: 7 }, (_, index) => "dense-" + (index + 1));

function region(page, id) {
  return page.locator('[data-sortable-region="' + id + '"]');
}

async function order(locator) {
  return locator.locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => item.dataset.sortableItemId));
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.getByRole("heading", { name: "Creative layout regression dashboard" }).waitFor();
  assert.equal(await page.locator('[data-sortable-variant="freeform"]').count(), 4,
    "The model may compose independently authored editable freeform layout groups");
  assert.equal(await page.locator('[data-sortable-variant="freeform"] [data-sortable-row]').count(), 0,
    "Freeform compositions must not be rewritten into semantic canvas rows");
  assert.equal(await page.locator('[data-sortable-variant="canvas"]').count(), 1,
    "Bespoke authored layouts and ordinary resizable dashboard canvases may coexist");
  assert.equal(await page.locator('[data-fixed-custom-layout] [data-sortable-item-id]').count(), 0,
    "An intentionally fixed custom section must remain outside block movement without losing product actions");
  assert.equal(await page.locator('[data-component-id="fixed-composition"]')
    .getByRole("button", { name: "Fixed composed visualization actions" }).count(), 1,
  "Fixed authored compositions still inherit protected source-backed component actions");
  await page.locator('[data-component-id="fixed-composition"]')
    .getByRole("button", { name: "Fixed composed visualization actions" }).click();
  await page.getByRole("menuitem", { name: "View data source" }).click();
  const fixedSource = page.getByRole("complementary", { name: "Data source for Fixed composed visualization" });
  await fixedSource.getByRole("tab", { name: "Overview" }).waitFor();
  await fixedSource.getByRole("button", { name: "Close data source" }).click();

  const bento = region(page, "dashboard:creative:bento");
  const featured = await bento.locator('[data-sortable-item-id="hero-visual"]').boundingBox();
  const compact = await bento.locator('[data-sortable-item-id="bento-1"]').boundingBox();
  assert.ok(featured.height > compact.height * 1.8 && featured.width > compact.width * 2,
    "A bespoke bento hero must preserve authored vertical and horizontal multi-track spanning");
  assert.equal(await bento.locator('[data-sortable-item-id="hero-visual"] .creative-inner-grid').count(), 1,
    "A draggable composite must retain unrestricted nested authored React/CSS composition");

  const fifths = region(page, "dashboard:creative:fifths");
  const fifthWidths = await fifths.locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
  assert.equal(fifthWidths.length, 5);
  assert.ok(Math.max(...fifthWidths) - Math.min(...fifthWidths) < 1,
    "Exactly five equal authored columns must remain possible without twelve-column quantization");

  const dense = region(page, "dashboard:creative:dense");
  const denseGeometry = await dense.locator(":scope > [data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => ({ top: item.getBoundingClientRect().top,
      width: item.getBoundingClientRect().width, span: item.dataset.sortableSpan })));
  assert.equal(denseGeometry.length, 7,
    "An explicitly requested compact visualization strip may exceed the canvas's six-item policy");
  assert.ok(denseGeometry.every(({ top }) => Math.abs(top - denseGeometry[0].top) < 1),
    "Seven compact chart blocks must fit one authored freeform row without semantic chart minimums");
  assert.ok(denseGeometry.every(({ span }) => span === undefined),
    "Freeform block placement must not receive implicit twelve-column span constraints");

  const offsetGeometry = await region(page, "dashboard:creative:offset")
    .evaluate((container) => ({ parent: container.getBoundingClientRect().toJSON(),
      item: container.querySelector("[data-sortable-item-id]").getBoundingClientRect().toJSON() }));
  assert.ok(offsetGeometry.item.left > offsetGeometry.parent.left + 50
    && offsetGeometry.item.width < offsetGeometry.parent.width / 2,
  "A single custom component must retain authored empty columns and offset placement instead of filling its row");

  const priorDense = [...denseOrder].reverse();
  await page.evaluate(({ title, previousOrder, denseOrder }) => {
    const key = "data-app:presentation:v1:" + location.pathname + ":" + title;
    localStorage.setItem(key, JSON.stringify({ version: 1, presentation: {
      title: "Preserve this owner-edited title",
      componentTitles: { "bento-1": "Owner edited bento" },
      blockLayouts: {
        "dashboard:creative:bento": { order: previousOrder, authoredRevision: 1 },
        "dashboard:creative:dense": { order: denseOrder },
        "dashboard:creative:canvas": {
          authoredRevision: 2,
          order: ["canvas-side", "canvas-major"],
          rows: [{ id: "creative:standard", items: ["canvas-side", "canvas-major"] }],
          spans: { "canvas-side": 6, "canvas-major": 6 },
          preferredSpans: { "canvas-side": 6, "canvas-major": 6 },
        },
      },
    } }));
  }, { title: snapshot.title, previousOrder: [...bentoOrder].reverse(), denseOrder: priorDense });
  await page.reload({ waitUntil: "load" });
  assert.deepEqual(await order(bento), bentoOrder,
    "An explicit newer authored revision must replace its stale saved freeform arrangement");
  assert.deepEqual(await order(dense), priorDense,
    "Redesigning one authored region must preserve a different region's existing user arrangement");
  const standard = region(page, "dashboard:creative:canvas");
  assert.deepEqual(await order(standard.locator('[data-sortable-row="creative:standard"]')),
    ["canvas-major", "canvas-side"],
    "An explicit canvas redesign must replace stale saved row membership and ordering");
  assert.deepEqual(await standard.locator("[data-sortable-item-id]")
    .evaluateAll((items) => items.map((item) => Number(item.dataset.sortableSpan))), [8, 4],
  "An explicit canvas redesign must restore authored asymmetric preferred widths");
  await page.waitForFunction(() => Object.values(localStorage).some((value) => {
    const saved = JSON.parse(value).presentation;
    return saved?.blockLayouts?.["dashboard:creative:bento"]?.authoredRevision === 2
      && saved.blockLayouts["dashboard:creative:canvas"]?.authoredRevision === 3;
  }));
  const revisedPresentation = await page.evaluate(() => Object.values(localStorage)
    .map((entry) => JSON.parse(entry).presentation).find((entry) => entry?.blockLayouts));
  assert.equal(revisedPresentation.title, "Preserve this owner-edited title");
  assert.equal(revisedPresentation.componentTitles["bento-1"], "Owner edited bento");
  assert.deepEqual(revisedPresentation.blockLayouts["dashboard:creative:dense"].order, priorDense,
    "A layout redesign must not reset another region, personalized title, or component-title edits");

  await page.getByRole("button", { name: "Edit mode" }).click();
  assert.equal(await page.locator('[data-sortable-variant="freeform"] [data-block-resize-handle]').count(), 0,
    "Creative freeform groups must not show canvas-only width controls");
  assert.equal(await standard.locator("[data-block-resize-handle]").count(), 1,
    "A standard editable canvas may coexist with custom sections and retain its shared resize divider");
  const explicitDrag = bento.locator('[data-sortable-item-id="hero-visual"] [data-block-drag-surface]');
  const explicitBounds = await explicitDrag.boundingBox();
  await page.mouse.move(explicitBounds.x + 10, explicitBounds.y + explicitBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(explicitBounds.x + 35, explicitBounds.y + explicitBounds.height / 2);
  await page.locator(".block-drag-preview").waitFor();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual(await order(bento), bentoOrder,
    "Explicit authored custom drag surfaces must support pointer movement and safe cancellation");
  await bento.evaluate((element) => Promise.all([...element.querySelectorAll("[data-sortable-item-id]")]
    .flatMap((item) => item.getAnimations().map((animation) => animation.finished.catch(() => {})))));
  const compactBento = bento.locator('[data-sortable-item-id="bento-1"]');
  await compactBento.locator(".dashboard-component").evaluate((component) => {
    component.style.paddingTop = "24px";
  });
  await bento.evaluate((element) => {
    window.__creativeBentoHero = element.querySelector('[data-sortable-item-id="hero-visual"] .creative-inner-grid');
    window.__creativeBentoOrders = [];
    window.__creativeBentoObserver = new MutationObserver(() => {
      window.__creativeBentoOrders.push([...element.querySelectorAll(":scope > [data-sortable-item-id]")]
        .map((item) => item.dataset.sortableItemId).join(","));
    });
    window.__creativeBentoObserver.observe(element, { childList: true });
  });
  const compactBounds = await compactBento.boundingBox();
  const featuredBeforeMove = await bento.locator('[data-sortable-item-id="hero-visual"]').boundingBox();
  assert.equal(await page.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.closest("[data-sortable-item-id]")?.dataset.sortableItemId,
  { x: compactBounds.x + compactBounds.width * .7, y: compactBounds.y + 6 }), "bento-1",
  "A card's complete upper padding must be an honest, hittable drag surface");
  await page.mouse.move(compactBounds.x + compactBounds.width * .7, compactBounds.y + 6);
  await page.mouse.down();
  await page.mouse.move(featuredBeforeMove.x + 22, featuredBeforeMove.y + 18, { steps: 12 });
  await page.locator(".block-drag-preview:not(.is-settling)").waitFor();
  assert.equal((await order(bento))[0], "bento-1",
    "A small bento tile dragged from its upper padding should claim the leading slot and push the featured chart aside");
  const settledPreviewMutations = await page.evaluate(() => window.__creativeBentoOrders.length);
  for (let index = 0; index < 6; index += 1) {
    await page.mouse.move(featuredBeforeMove.x + 22 + index % 2, featuredBeforeMove.y + 18);
  }
  assert.equal(await page.evaluate(() => window.__creativeBentoOrders.length), settledPreviewMutations,
    "A stationary mixed-size drag must not repeatedly reshuffle a live bento layout");
  await page.mouse.up();
  assert.deepEqual((await order(bento)).slice(0, 2), ["bento-1", "hero-visual"],
    "Dropping a small tile onto a featured block must displace the large block without replacing it");
  const featuredAfterMove = await bento.locator('[data-sortable-item-id="hero-visual"]').boundingBox();
  assert.ok(Math.abs(featuredAfterMove.width - featuredBeforeMove.width) < 2
    && Math.abs(featuredAfterMove.height - featuredBeforeMove.height) < 2,
  "A displaced featured bento block must retain its full authored width and height");
  assert.equal(await bento.evaluate((element) =>
    window.__creativeBentoHero === element.querySelector('[data-sortable-item-id="hero-visual"] .creative-inner-grid')),
  true, "Stable freeform movement must keep expensive featured visual subtrees mounted");
  await page.evaluate(() => window.__creativeBentoObserver.disconnect());
  assert.equal(await page.getByRole("button", { name: /reset layout/u }).count(), 0,
    "Mixed-size layout editing must not introduce an unrequested reset action");
  await bento.evaluate((element) => Promise.all([...element.querySelectorAll("[data-sortable-item-id]")]
    .flatMap((item) => item.getAnimations().map((animation) => animation.finished.catch(() => {})))));
  const transferSource = bento.locator('[data-sortable-item-id="bento-1"]');
  const transferDestination = fifths.locator('[data-sortable-item-id="fifth-1"]');
  const transferSourceBounds = await transferSource.boundingBox();
  const transferDestinationBounds = await transferDestination.boundingBox();
  await page.mouse.move(transferSourceBounds.x + transferSourceBounds.width * .7,
    transferSourceBounds.y + 6);
  await page.mouse.down();
  await page.mouse.move(transferDestinationBounds.x + transferDestinationBounds.width / 2,
    transferDestinationBounds.y + transferDestinationBounds.height / 2, { steps: 16 });
  assert.equal(await transferDestination.getAttribute("data-block-transfer-target"), "true",
    "Explicitly compatible sections should expose a restrained valid transfer target");
  await page.mouse.up();
  await page.waitForFunction(() =>
    document.querySelector('[data-sortable-region="dashboard:creative:fifths"]')
      ?.querySelector('[data-sortable-item-id="bento-1"]')
    && document.querySelector('[data-sortable-region="dashboard:creative:bento"]')
      ?.querySelector('[data-sortable-item-id="fifth-1"]'));
  assert.equal(await page.locator('[data-sortable-item-id="bento-1"]').count(), 1,
    "Moving between compatible sections must preserve exactly one stable component identity");
  assert.equal(await bento.locator('[data-sortable-item-id="hero-visual"]').count(), 1,
    "Cross-section transfers must leave incompatible large featured blocks in their authored region");
  await page.waitForFunction(() => Object.values(localStorage).some((value) => {
    const layouts = JSON.parse(value).presentation?.blockLayouts;
    return layouts?.["dashboard:creative:bento"]?.order.includes("fifth-1")
      && layouts?.["dashboard:creative:fifths"]?.order.includes("bento-1");
  }));
  const denseFirst = page.getByRole("button", { name: "Move Dense 1", exact: true });
  await denseFirst.press("Space");
  await denseFirst.press("Home");
  await denseFirst.press("Enter");
  assert.equal((await order(dense))[0], "dense-1",
    "Arbitrarily composed freeform blocks must retain protected accessible keyboard reordering");
  await page.waitForFunction(() => Object.values(localStorage).some((value) =>
    JSON.parse(value).presentation?.blockLayouts?.["dashboard:creative:dense"]?.order[0] === "dense-1"));
  await page.reload({ waitUntil: "load" });
  assert.equal(await region(page, "dashboard:creative:fifths")
    .locator('[data-sortable-item-id="bento-1"]').count(), 1,
  "Opt-in compatible cross-section ownership must persist through an ordinary dashboard reload");
  assert.equal((await order(dense))[0], "dense-1",
    "Owner-reordered unusual layouts must persist through ordinary dashboard reloads");

  await page.setViewportSize({ width: 420, height: 1800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1,
    "Responsive behavior for a bespoke layout remains under authored CSS control without page overflow");

  const published = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  published.on("pageerror", (error) => failures.push(error.message));
  const writes = [];
  const hosted = { canEdit: false, revision: 4, presentation: {
    title: "Keep the shared owner title",
    blockLayouts: {
      "dashboard:creative:bento": { order: [...bentoOrder].reverse(), authoredRevision: 1 },
      "dashboard:creative:dense": { order: priorDense },
      "dashboard:creative:canvas": {
        authoredRevision: 2,
        order: ["canvas-side", "canvas-major"],
        rows: [{ id: "creative:standard", items: ["canvas-side", "canvas-major"] }],
        spans: { "canvas-side": 6, "canvas-major": 6 },
      },
    },
  } };
  await published.route("https://creative.chatgpt.site/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/presentation" && route.request().method() === "PUT") {
      const change = JSON.parse(route.request().postData());
      writes.push(change);
      hosted.presentation = change.presentation;
      hosted.revision = change.revision + 1;
    }
    const payload = pathname === "/api/snapshot" ? snapshot
      : pathname === "/api/presentation" ? hosted : undefined;
    return route.fulfill(payload ? { contentType: "application/json", body: JSON.stringify(payload) }
      : { contentType: "text/html", body: readFileSync(htmlPath, "utf8") });
  });
  await published.goto("https://creative.chatgpt.site/", { waitUntil: "load" });
  await published.getByRole("heading", { name: "Creative layout regression dashboard" }).waitFor();
  assert.deepEqual(await order(region(published, "dashboard:creative:bento")), bentoOrder,
    "A published read-only viewer must render the newer authored redesign even before its owner opens the Site");
  assert.deepEqual(writes, [], "Read-only hosted viewers must never write revised layout state");
  hosted.canEdit = true;
  const redesignWrite = published.waitForResponse((response) =>
    response.url().endsWith("/api/presentation") && response.request().method() === "PUT"
    && response.status() === 200);
  await published.reload({ waitUntil: "load" });
  await redesignWrite;
  assert.equal(writes.length, 1,
    "A hosted owner opening an explicitly redesigned dashboard should perform one bounded shared layout write");
  assert.equal(writes[0].revision, 4,
    "An authored redesign must preserve optimistic hosted revision guards");
  assert.equal(writes[0].presentation.blockLayouts["dashboard:creative:bento"].authoredRevision, 2);
  assert.deepEqual(writes[0].presentation.blockLayouts["dashboard:creative:bento"].order, bentoOrder);
  assert.equal(writes[0].presentation.blockLayouts["dashboard:creative:canvas"].authoredRevision, 3);
  assert.deepEqual(writes[0].presentation.blockLayouts["dashboard:creative:canvas"].spans,
    { "canvas-major": 8, "canvas-side": 4 },
    "Hosted Sites must persist explicitly redesigned canvas widths alongside creative freeform layouts");
  assert.deepEqual(writes[0].presentation.blockLayouts["dashboard:creative:dense"].order, priorDense);
  assert.equal(writes[0].presentation.title, "Keep the shared owner title");
  assert.equal(writes[0].presentation.queries, undefined,
    "Published authored layout redesigns must never write reviewed source data");
  hosted.presentation.hiddenBlocks = ["bento-8"];
  hosted.presentation.blockLayouts["dashboard:creative:bento"].spans = {
    "bento-1": 2, "bento-8": 1,
  };
  hosted.presentation.blockLayouts["dashboard:creative:bento"].preferredSpans = {
    "bento-1": 3, "bento-8": 1,
  };
  hosted.presentation.blockLayouts["dashboard:creative:fifths"] = {
    order: Array.from({ length: 5 }, (_, index) => `fifth-${index + 1}`),
    spans: { "fifth-1": 1 },
    preferredSpans: { "fifth-1": 2 },
  };
  const hiddenBentoPosition = hosted.presentation.blockLayouts["dashboard:creative:bento"]
    .order.indexOf("bento-8");
  await published.reload({ waitUntil: "load" });
  await published.getByRole("heading", { name: "Creative layout regression dashboard" }).waitFor();
  assert.equal(writes.length, 1,
    "Reloading unchanged published sizing and hidden-block metadata must not produce a redundant owner write");
  await published.getByRole("button", { name: "Edit mode" }).click();
  const publishedBento = region(published, "dashboard:creative:bento");
  const publishedFifths = region(published, "dashboard:creative:fifths");
  const hostedSource = publishedBento.locator('[data-sortable-item-id="bento-1"]');
  const hostedDestination = publishedFifths.locator('[data-sortable-item-id="fifth-1"]');
  await hostedSource.locator(".dashboard-component").evaluate((component) => {
    component.style.paddingTop = "24px";
  });
  await published.evaluate(() => Promise.all(document.getAnimations()
    .map((animation) => animation.finished.catch(() => {}))));
  const hostedSourceBounds = await hostedSource.boundingBox();
  const hostedDestinationBounds = await hostedDestination.boundingBox();
  await published.mouse.move(hostedSourceBounds.x + hostedSourceBounds.width * .7,
    hostedSourceBounds.y + 6);
  await published.mouse.down();
  await published.mouse.move(hostedDestinationBounds.x + hostedDestinationBounds.width / 2,
    hostedDestinationBounds.y + hostedDestinationBounds.height / 2, { steps: 14 });
  assert.equal(await hostedDestination.getAttribute("data-block-transfer-target"), "true",
    "A published owner should receive the same explicitly compatible transfer affordance as a local editor");
  const hostedTransferWrite = published.waitForResponse((response) =>
    response.url().endsWith("/api/presentation") && response.request().method() === "PUT"
    && response.status() === 200);
  await published.mouse.up();
  await hostedTransferWrite;
  assert.equal(writes.length, 2,
    "An owner transfer spanning two compatible regions must produce one bounded hosted presentation write");
  assert.equal(writes[1].revision, 5,
    "A grouped section transfer must preserve the hosted optimistic revision guard");
  assert.ok(writes[1].presentation.blockLayouts["dashboard:creative:bento"].order.includes("fifth-1")
    && writes[1].presentation.blockLayouts["dashboard:creative:fifths"].order.includes("bento-1"),
  "One published owner write must persist ownership changes for both compatible sections together");
  assert.equal(writes[1].presentation.blockLayouts["dashboard:creative:bento"]
    .order.indexOf("bento-8"), hiddenBentoPosition,
  "Compatible section transfers must preserve an already hidden block's original position");
  assert.deepEqual(writes[1].presentation.blockLayouts["dashboard:creative:bento"].spans,
    { "bento-8": 1, "fifth-1": 1 },
    "A transferred item must bring its authored width without retaining the departed item's width");
  assert.deepEqual(writes[1].presentation.blockLayouts["dashboard:creative:bento"].preferredSpans,
    { "bento-8": 1, "fifth-1": 2 },
    "A destination section must retain hidden-item widths and the incoming item's preferred width");
  assert.deepEqual(writes[1].presentation.blockLayouts["dashboard:creative:fifths"].spans,
    { "bento-1": 2 }, "The original block's width must follow it to the compatible destination");
  assert.deepEqual(writes[1].presentation.blockLayouts["dashboard:creative:fifths"].preferredSpans,
    { "bento-1": 3 }, "The original block's preferred width must follow it to the compatible destination");
  assert.equal(writes[1].presentation.queries, undefined,
    "Moving a block between compatible sections must never include reviewed query data");
  hosted.canEdit = false;
  await published.reload({ waitUntil: "load" });
  await published.waitForFunction(() =>
    document.querySelector('[data-sortable-region="dashboard:creative:bento"]')
      ?.querySelector('[data-sortable-item-id="fifth-1"]')
    && document.querySelector('[data-sortable-region="dashboard:creative:fifths"]')
      ?.querySelector('[data-sortable-item-id="bento-1"]'));
  const publishedBentoOrder = await order(region(published, "dashboard:creative:bento"));
  const publishedFifthsOrder = await order(region(published, "dashboard:creative:fifths"));
  assert.ok(publishedBentoOrder.includes("fifth-1") && publishedFifthsOrder.includes("bento-1"),
    `Published compatible-section transfers must survive owner persistence and read-only viewer reloads: ${JSON.stringify({ bento: publishedBentoOrder, fifths: publishedFifthsOrder })}`);

  assert.deepEqual(failures, [], "Creative authored layouts must not produce browser errors");
  console.log(JSON.stringify({ status: "passed", regions: 5,
    interactions: ["freeform bento with vertical and horizontal spans", "unrestricted nested authored content",
      "five exact equal columns", "seven individually editable compact chart tiles",
      "single offset block with intentional empty grid tracks", "fixed custom source-backed sections",
      "custom, freeform, and standard editable canvas composition coexist",
      "explicit authored direct-manipulation drag surfaces",
      "stable full-header freeform pointer dragging", "small tiles displace full-size bento features",
      "stationary drag geometry avoids repeated live-grid reshuffles",
      "explicit compatible cross-section transfers and reload persistence",
      "keyboard-accessible freeform block reordering", "local layout persistence",
      "targeted authored redesign revisions preserve unrelated regions and owner edits",
      "authored responsive mobile layout", "read-only hosted redesign rendering",
      "one revision-guarded owner Sites write", "single-write published compatible-section transfers",
      "published viewer redesign and transferred-layout persistence"] }, null, 2));
} finally {
  await browser.close();
  rmSync(projectRoot, { recursive: true, force: true });
}
