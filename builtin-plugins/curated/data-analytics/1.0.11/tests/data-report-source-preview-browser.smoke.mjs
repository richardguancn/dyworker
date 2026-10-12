import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(root, "templates/data-app/base");
const project = mkdtempSync(join(tmpdir(), "data-report-source-preview-"));
const href = "https://example.com/reviewed-source";
const title = "Synthetic experiment readout";
const longHref = "https://example.com/long-source";
const wrappedHref = "https://example.com/wrapped-source";
const summary = "The experiment measured repeat use. Its authors recommended another test; they did not record a rollout decision.";
const providerCases = [
  ["Google Docs", "https://docs.google.com/document/d/synthetic/edit", "google-docs"],
  ["Google Sheets", "https://docs.google.com/spreadsheets/d/synthetic/edit", "google-sheets"],
  ["Google Slides", "https://docs.google.com/presentation/d/synthetic/edit", "google-slides"],
  ["Google Drive", "https://drive.google.com/file/d/synthetic/view", "google-drive"],
  ["Slack", "https://example.slack.com/archives/synthetic", "slack"],
  ["Notion", "https://www.notion.so/synthetic", "notion"],
  ["GitHub", "https://github.com/example/synthetic", "github"],
  ["Statsig", "https://console.statsig.com/synthetic", "database"],
];
const previews = { [href]: { title, summary, source: "Experiment review", date: "August 2026", approvedForReport: true },
  [longHref]: { title: "Long source", summary: "Additional reviewed context. ".repeat(28), approvedForReport: true },
  [wrappedHref]: { title: "Wrapped source", summary: "A short reviewed summary.", approvedForReport: true },
  "https://example.com/restricted": { title: "Restricted title", summary: "RESTRICTED_PREVIEW_SENTINEL" } };
for (const [label, url] of providerCases) previews[url] = { title: `${label} fixture`, summary: "Synthetic source context.", approvedForReport: true };
const markdown = `The [reviewed experiment](${href}) informs the next test. [Ordinary source](https://example.com/ordinary). [Restricted source](https://example.com/restricted).`;
const authored = `import React from "react";
import { RichNarrative } from "../../data-app-public.jsx";
export function ReportContent() { return <article className="report-content"><h1>Source preview contract</h1>
<RichNarrative id="preview:body" value={${JSON.stringify(markdown)}} sourcePreviews={${JSON.stringify(previews)}} />
<RichNarrative id="preview:providers" value={${JSON.stringify(providerCases.map(([label,url])=>`[${label} fixture](${url})`).join(" · "))}} sourcePreviews={${JSON.stringify(previews)}} />
<div style={{height:500}} /><RichNarrative id="preview:long" value={${JSON.stringify(`[Long reviewed source](${longHref})`)}} sourcePreviews={${JSON.stringify(previews)}} /><div style={{height:500}} />
<div style={{width:240,marginInline:"auto"}}><RichNarrative id="preview:wrapped" value={${JSON.stringify(`Read the [complete reviewed source explaining the comparison and its limitations](${wrappedHref}).`)}} sourcePreviews={${JSON.stringify(previews)}} /></div><div style={{height:500}} />
<button type="button">Outside target</button></article>; }`;
let browser;
const errors = [];
try {
  cpSync(template, project, { recursive: true, filter: (path) => !path.includes("/node_modules") && !path.includes("/dist") });
  writeFileSync(join(project, "src/content/report/ReportContent.jsx"), authored);
  writeFileSync(join(project, "src/data.json"), JSON.stringify({ id: "source-preview-contract", surface: "report",
    title: "Source preview contract", status: "fixture", generatedAt: "2026-08-19T12:00:00Z", filters: [], queries: {} }));
  const build = runDataAppFixtureBuild(project, { pluginRoot: root });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  page.on("pageerror", (error) => errors.push(error.message));
  const sourceRequests = [];
  page.on("request", (request) => { if (request.url().startsWith("https://")) sourceRequests.push(request.url()); });
  const interceptSourceLinks = () => {
    window.__sourceLinks = [];
    document.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="https://example.com/"]');
      if (link && !event.defaultPrevented) { event.preventDefault(); window.__sourceLinks.push(link.href); }
    });
  };
  await page.addInitScript(interceptSourceLinks);
  const url = pathToFileURL(join(project, "dist/index.html")).href;
  await page.goto(url, { waitUntil: "load" });
  const link = page.getByRole("link", { name: "reviewed experiment", exact: true });
  const card = page.locator('.source-preview-card[role="tooltip"]');
  assert.equal(await link.getAttribute("href"), href);
  assert.equal(await page.getByRole("link", { name: "Ordinary source", exact: true }).getAttribute("aria-haspopup"), null);
  assert.equal(await page.getByRole("link", { name: "Restricted source", exact: true }).getAttribute("aria-haspopup"), null);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await link.hover();
  await page.clock.runFor(249);
  assert.equal(await card.count(), 0, "Passing over a link must not open its tooltip immediately");
  await page.mouse.move(5, 500);
  await page.clock.runFor(300);
  assert.equal(await card.count(), 0, "Leaving the link cancels a pending tooltip");
  await link.hover();
  await page.keyboard.press("Escape");
  await page.clock.runFor(300);
  assert.equal(await card.count(), 0, "Escape cancels a pending hover even before the tooltip opens");
  await page.mouse.move(5, 500);
  await link.hover();
  await page.clock.runFor(250);
  await card.waitFor();
  await page.clock.resume();
  assert.match(await card.innerText(), /did not record a rollout decision/u);
  assert.deepEqual(await card.evaluate((el) => {
    const meta = el.querySelector(".source-preview-meta");
    const title = el.querySelector(".source-preview-title");
    const summary = el.querySelector(".source-preview-summary");
    return { padding: getComputedStyle(el).padding, iconGap: getComputedStyle(meta).gap,
      metaToTitle: Math.round(title.getBoundingClientRect().top - meta.getBoundingClientRect().bottom),
      titleToSummary: Math.round(summary.getBoundingClientRect().top - title.getBoundingClientRect().bottom) };
  }), { padding: "16px", iconGap: "6px", metaToTitle: 8, titleToSummary: 4 },
  "The source card keeps its metadata spacing and groups the title with its description");
  assert.equal(await card.locator('[data-source-provider="web"]').count(), 1);
  const centered = await card.boundingBox();
  const centeredAnchor = await link.boundingBox();
  const expectedCenterLeft = Math.max(12, Math.min(centeredAnchor.x + centeredAnchor.width / 2 - centered.width / 2, 1000 - centered.width - 12));
  assert.ok(Math.abs(centered.x - expectedCenterLeft) < 1, "Source tooltip centers on its link unless constrained by the viewport");
  await card.hover();
  assert.equal(await card.isVisible(), true);
  assert.equal(await card.locator("a,button,[tabindex]").count(), 0, "The tooltip has no duplicate navigation control");
  assert.equal(await link.getAttribute("aria-describedby"), await card.getAttribute("id"));
  const accessibility = await page.context().newCDPSession(page);
  const { root: domRoot } = await accessibility.send("DOM.getDocument");
  const { nodeId } = await accessibility.send("DOM.querySelector", { nodeId: domRoot.nodeId, selector: `a[href="${href}"]` });
  const { nodes } = await accessibility.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
  assert.ok(nodes.some((node) => node.description?.value?.includes(summary)), "The accessible description must include the source summary");
  await accessibility.detach();
  assert.deepEqual(await page.evaluate(() => window.__sourceLinks), []);
  assert.deepEqual(sourceRequests, [], "Previews must not fetch linked content");
  await page.mouse.click(5, 500);
  assert.equal(await card.count(), 0);
  for (const [label, , provider] of providerCases) {
    await page.getByRole("link", { name: `${label} fixture`, exact: true }).focus();
    const icon = card.locator(`[data-source-provider="${provider}"]`);
    assert.equal(await icon.count(), 1, label);
    assert.ok((await card.innerText()).includes(label), `${label} has a readable fallback source name`);
    assert.equal(await icon.getAttribute("aria-hidden"), "true");
    const bounds = await icon.boundingBox();
    assert.equal(bounds.width, 16);
    assert.equal(bounds.height, 16);
    for (const img of await icon.locator("img").all())
      assert.ok(await img.evaluate(node => node.complete && node.naturalWidth > 0 && node.src.startsWith("data:")), `${label} icon is bundled`);
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(sourceRequests, [], "Provider icons must not request remote assets or source contents");
  for (const label of ["GitHub", "Notion"]) {
    const colors = [];
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction((scheme) => document.documentElement.dataset.colorScheme === scheme, colorScheme);
      await page.getByRole("button", { name: "Outside target", exact: true }).focus();
      await page.getByRole("link", { name: `${label} fixture`, exact: true }).focus();
      const mask = card.locator(".source-preview-provider-mask");
      const paint = await mask.evaluate(node => { const style = getComputedStyle(node); return {
        mask: style.maskImage, background: style.backgroundColor, color: style.color,
        width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
      }; });
      assert.match(paint.mask, /^url\(["']?data:image\/svg\+xml/u, `${label} mask is bundled`);
      assert.equal(paint.background, paint.color, `${label} follows the foreground color`);
      assert.equal(paint.width, 16);
      assert.equal(paint.height, 16);
      colors.push(paint.color);
      await page.keyboard.press("Escape");
    }
    assert.notEqual(colors[0], colors[1], `${label} adapts to light and dark appearance`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await link.focus();
  assert.equal(await card.count(), 1, "Keyboard focus opens without the hover delay");
  await page.keyboard.press("Tab");
  await card.waitFor({ state: "detached" });
  await link.focus();
  await page.keyboard.press("Escape");
  assert.equal(await card.count(), 0);
  assert.equal(await link.evaluate((node) => node === document.activeElement), true);
  await link.click();
  assert.deepEqual(await page.evaluate(() => window.__sourceLinks), [href], "Mouse click remains direct source navigation");
  await link.press("Enter");
  assert.deepEqual(await page.evaluate(() => window.__sourceLinks), [href, href], "Enter follows the original link");
  await page.mouse.move(5, 500);
  await link.hover();
  await page.emulateMedia({ media: "print" });
  assert.equal(await card.isVisible(), false);
  assert.equal(await link.getAttribute("href"), href);
  await page.emulateMedia({ media: "screen" });
  await page.mouse.click(5, 500);
  const wrapped = page.getByRole("link", { name: "complete reviewed source explaining the comparison and its limitations", exact: true });
  await wrapped.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const fragments = await wrapped.evaluate((node) => [...node.getClientRects()].map(({left,right,top,bottom,width,height}) => ({left,right,top,bottom,width,height})));
  assert.ok(fragments.length >= 2, "The fixture must exercise a multiline inline link");
  for (const fragment of [fragments[0], fragments.at(-1)]) {
    await page.mouse.move(fragment.left + fragment.width / 2, fragment.top + fragment.height / 2);
    await card.waitFor();
    await page.waitForFunction(({fragment}) => {
      const rect = document.querySelector('.source-preview-card')?.getBoundingClientRect();
      return rect && Math.abs(rect.left + rect.width / 2 - (fragment.left + fragment.width / 2)) < 1
        && rect.bottom <= fragment.top;
    }, {fragment});
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  assert.equal(await card.count(), 0);
  assert.equal(await page.locator('[data-editable-id="preview:body"] [contenteditable="true"]').count(), 1);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 600 }, hasTouch: true, isMobile: true });
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.addInitScript(interceptSourceLinks);
  await mobile.goto(url, { waitUntil: "load" });
  await mobile.getByRole("link", { name: "reviewed experiment", exact: true }).tap();
  const mobileCard = mobile.locator('.source-preview-card[role="tooltip"]');
  await mobileCard.waitFor();
  const currentViewUrl = new URL(url);
  currentViewUrl.searchParams.set("view", "1");
  assert.equal(mobile.url(), currentViewUrl.href, "First touch opens the preview without navigating");
  const bounds = await mobileCard.boundingBox();
  assert.ok(bounds.x >= 11 && bounds.x + bounds.width <= 391 && bounds.y >= 11 && bounds.y + bounds.height <= 601, JSON.stringify(bounds));
  assert.deepEqual(await mobile.evaluate(() => window.__sourceLinks), []);
  assert.equal(await mobileCard.locator("a,button,[tabindex]").count(), 0);
  await mobile.getByRole("link", { name: "reviewed experiment", exact: true }).tap();
  assert.deepEqual(await mobile.evaluate(() => window.__sourceLinks), [href], "Second touch follows the original link");
  assert.equal(await mobile.locator('.dashboard-topbar[data-mode="view"]').count(), 1,
    "Two source taps must not trigger double-click-to-edit");
  assert.equal(await mobile.locator('[contenteditable="true"]').count(), 0);
  assert.equal(await mobileCard.count(), 0);
  await mobile.getByRole("link", { name: "reviewed experiment", exact: true }).tap();
  await mobileCard.waitFor();
  await mobile.touchscreen.tap(5, 580);
  assert.equal(await mobileCard.count(), 0);
  await mobile.setViewportSize({ width: 390, height: 320 });
  const longLink = mobile.getByRole("link", { name: "Long reviewed source", exact: true });
  await longLink.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await longLink.tap();
  await mobileCard.waitFor();
  const longBounds = await mobileCard.boundingBox();
  const anchorBounds = await longLink.boundingBox();
  assert.ok(longBounds.y + longBounds.height <= anchorBounds.y || longBounds.y >= anchorBounds.y + anchorBounds.height,
    `Tooltip must leave its only navigation link reachable: ${JSON.stringify({longBounds,anchorBounds})}`);
  assert.ok(await mobileCard.evaluate((node) => node.scrollHeight > node.clientHeight), "Long context scrolls within the available side");
  await longLink.tap();
  assert.deepEqual(await mobile.evaluate(() => window.__sourceLinks), [href, longHref]);
  assert.deepEqual(errors, []);
  console.log("Source-preview browser smoke passed.");
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
