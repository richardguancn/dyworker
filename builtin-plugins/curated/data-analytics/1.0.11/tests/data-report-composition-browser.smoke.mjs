import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
const project = mkdtempSync(join(tmpdir(), "data-report-composition-"));
const source = (name, date, rows) => ({
  label: `Ledger ${name}`, reportingField: "date", rows,
  source: {
    label: `Ledger ${name}`, sql: `SELECT value FROM ledger_${name.toLowerCase()}`,
    tables: [`ledger_${name.toLowerCase()}`], executedAt: `${date}T12:00:00Z`,
    metricDefinitions: [{ label: "Value", definition: `Definition ${name}` }],
    evidenceFlow: [{ title: `Evidence ${name}`, detail: `Reviewed ledger ${name}` }],
  },
});
const alphaRows = Array.from({ length: 9 }, (_, index) => ({ date: "2026-08-10", record: `A-${index + 1}`, value: index + 101 }));
const betaRows = [{ date: "2026-08-03", record: "B-included", value: 222 }];
const snapshot = {
  id: "report-composition-contract", surface: "report", title: "Evidence brief",
  generatedAt: "2026-08-11T12:00:00Z", status: "fixture", filters: [], includeLead: true,
  queries: {
    alpha: source("A", "2026-08-10", [...alphaRows, { date: "2026-08-11", record: "A-omitted", value: 999 }]),
    beta: source("B", "2026-08-03", [...betaRows, { date: "2026-08-04", record: "B-omitted", value: 888 }]),
  },
};
const checklistMarkdown = "- [ ] Pending **review**\n- [x] Done\n  - [ ] Nested\n- Ordinary bullet\n- \\[x] Escaped marker\n- `[x]` Code marker";
const authoredReport = `import React, { useState } from "react";
import { DataComponent, ReportSection, RichNarrative, useDataApp } from "../../data-app-public.jsx";
export function ReportContent() {
  const { snapshot, reviewedRows, visible, appTitle } = useDataApp();
  const [includeSecondary, setIncludeSecondary] = useState(true);
  const [sourceRevision, setSourceRevision] = useState(0);
  const alpha = reviewedRows("alpha").filter((row) => row.record !== "A-omitted");
  const beta = reviewedRows("beta").filter((row) => row.record !== "B-omitted");
  return <article className="report-content" aria-label="Composition fixture">
    <header className="report-hero"><h1>{appTitle}</h1></header>
    {snapshot.includeLead && visible("report-executive-summary") &&
      <ReportSection id="report-executive-summary" title="The finding" queryId="alpha" queryIds={["beta"]}
        sourceRowsByQuery={{ alpha, beta }}>
        <RichNarrative id="finding:body" value="The **reviewed evidence** supports this finding." label="Edit finding" />
      </ReportSection>}
    {visible("single-evidence") && <ReportSection id="single-evidence" title="A closer look" queryId="beta"
      sourceRows={beta} showHeading={false}>
      <RichNarrative id="detail:body" value={"## A closer look\\n\\nA single-source [explanation](https://example.com/evidence)."} />
    </ReportSection>}
    {visible("prose-only") && <ReportSection id="prose-only" title="One finding" queryId="beta"
      sourceRows={beta} showHeading={false}>
      <RichNarrative id="prose-only:body" label="Edit prose-only finding"
        value="A plain paragraph can answer the question without adding a heading. Its reviewed evidence and editable text must remain usable when this sentence wraps on a narrow screen." />
    </ReportSection>}
    <DataComponent id="legacy-plain" title="Legacy finding" kind="custom" queryId="beta">
      <p>Legacy paragraph content.</p>
    </DataComponent>
    <DataComponent id="legacy-merged" title="Merged finding" kind="custom" queryId="beta">
      <RichNarrative id="legacy:body" value="Editable legacy content." />
    </DataComponent>
    <DataComponent id="legacy-no-heading" title="Hidden heading" kind="custom" queryId="beta" showHeading={false}>
      <RichNarrative id="hidden:body" value="No forced heading." />
    </DataComponent>
    <ReportSection id="checklist" title="Review tasks" queryId="beta">
      <RichNarrative id="checklist:body" value={${JSON.stringify(checklistMarkdown)}} />
    </ReportSection>
    <ReportSection id="block-styles" title="Editable list" queryId="beta">
      <RichNarrative id="styles:body" label="Edit list" value={"- First **item**\\n- Second item"} />
    </ReportSection>
    <ReportSection id="clear-text" title="Editable text" queryId="beta">
      <RichNarrative id="clear:body" label="Clear finding" value="Text that can be cleared." />
    </ReportSection>
    <ReportSection id="partial-list" title="Partial list selection" queryId="beta">
      <RichNarrative id="partial:body" label="Edit one list item" value={"- Before\\n- Selected **item**\\n- After"} />
    </ReportSection>
    <ReportSection id="nested-list" title="Nested list selection" queryId="beta">
      <RichNarrative id="nested:body" label="Edit nested list" value={"- Parent\\n    - Nested first\\n    - Nested second\\n- After"} />
    </ReportSection>
    <ReportSection id="nested-middle" title="Nested middle selection" queryId="beta">
      <RichNarrative id="nested-middle:body" label="Edit nested middle" value={"- Parent\\n    - Nested first\\n    - Nested second\\n    - Nested third\\n- After"} />
    </ReportSection>
    <ReportSection id="nested-parent" title="Parent list selection" queryId="beta">
      <RichNarrative id="nested-parent:body" label="Edit parent item" value={"- Parent\\n    - Child one\\n    - Child two\\n- After"} />
    </ReportSection>
    <section aria-label="Live source controls">
      <button type="button" onClick={() => setIncludeSecondary((value) => !value)}>Toggle secondary source</button>
      <button type="button" onClick={() => setSourceRevision((value) => value + 1)}>Refresh source component</button>
      <ReportSection id="live-source-evidence" title={"Live source " + sourceRevision} queryId="alpha"
        queryIds={includeSecondary ? ["beta"] : []}
        sourceRowsByQuery={includeSecondary ? { alpha, beta } : { alpha }}>
        <RichNarrative id="live-source:body" value="Reviewed sources can change while their drawer is open." />
      </ReportSection>
    </section>
  </article>;
}`;

let browser;
const errors = [];
const block = (page, id) => page.locator(`[data-component-id="${id}"]`);
async function saveReportEdits(page) {
  await page.locator(".dashboard-topbar").getByRole("button", { name: "Save", exact: true }).click();
  await page.locator('.dashboard-topbar[data-mode="view"]').waitFor();
}
async function action(page, id, name) {
  await block(page, id).getByRole("button", { name: / actions$/u }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function openSource(page, id) {
  await action(page, id, "View data source");
  const drawer = page.getByRole("complementary", { name: /Data source for/u });
  await drawer.getByRole("tab", { name: "Overview", exact: true }).waitFor();
  return drawer;
}
async function selectSource(page, drawer, label) {
  await drawer.getByRole("button", { name: "Choose reviewed data source" }).click();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
}
async function closeSource(drawer) {
  await drawer.getByRole("button", { name: "Close data source", exact: true }).click();
  await drawer.waitFor({ state: "hidden" });
}
async function captureClipboard(page) {
  await page.addInitScript(() => {
    window.__compositionClipboard = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { writeText: async (value) => window.__compositionClipboard.push(value) } });
  });
}

async function assertProseMenuDoesNotOverlapText(component) {
  await component.page().waitForFunction((id) => {
    const menu = document.querySelector(`[data-component-id="${id}"] .menu-trigger`);
    return menu && getComputedStyle(menu).opacity === "1";
  }, await component.getAttribute("data-component-id"));
  const geometry = await component.evaluate((element) => {
    const menu = element.querySelector(".menu-trigger");
    const bounds = menu.getBoundingClientRect();
    const narrative = element.querySelector(".report-rich-editable, .rich-narrative-content");
    const walker = document.createTreeWalker(narrative, NodeFilter.SHOW_TEXT);
    let overlappingText = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let index = 0; index < node.textContent.length; index += 1) {
        if (!node.textContent[index].trim()) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        if ([...range.getClientRects()].some((rect) => rect.width > 0
          && Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left) > 0.5
          && Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top) > 0.5)) {
          overlappingText += node.textContent[index];
        }
      }
    }
    return { overlappingText, menuOpacity: getComputedStyle(menu).opacity,
      menu: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom } };
  });
  assert.equal(geometry.menuOpacity, "1", "Measure the visible source-action hit target");
  assert.equal(geometry.overlappingText, "", `Source actions must not overlap selectable prose: ${JSON.stringify(geometry)}`);
}

try {
  cpSync(template, project, { recursive: true, filter: (path) => !path.includes("/node_modules") && !path.includes("/dist") });
  writeFileSync(join(project, "src/data.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(join(project, "src/content/report/ReportContent.jsx"), authoredReport);
  const build = runDataAppFixtureBuild(project, { pluginRoot });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const compiledHtml = readFileSync(join(project, "dist/index.html"), "utf8");
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, locale: "en-US" });
  page.on("pageerror", (error) => errors.push(error.message));
  await captureClipboard(page);
  await page.goto(pathToFileURL(join(project, "dist/index.html")).href, { waitUntil: "load" });
  await page.getByRole("heading", { name: "The finding", exact: true }).waitFor();
  assert.equal(await block(page, "legacy-plain").getByRole("heading", { name: "Legacy finding" }).count(), 1);
  assert.equal(await block(page, "legacy-merged").getByRole("heading", { name: "Merged finding" }).count(), 1);
  assert.equal(await block(page, "legacy-no-heading").getByRole("heading").count(), 0);
  await closeSource(await openSource(page, "legacy-plain"));
  async function assertChecklists(target) {
    for (const selector of [".rich-narrative-content"]) {
      const content = block(target, "checklist").locator(selector);
      assert.deepEqual(await content.locator('input[type="checkbox"]').evaluateAll((inputs) =>
        inputs.map((input) => ({ checked: input.checked, disabled: input.disabled }))), [
        { checked: false, disabled: true }, { checked: true, disabled: true }, { checked: false, disabled: true },
      ]);
      assert.match(await content.innerText(), /\[x\] Escaped marker/u);
      assert.match(await content.innerText(), /\[x\] Code marker/u);
      assert.equal(await content.locator("strong").innerText(), "review");
      assert.equal(await content.locator("li.task-list-item").first().evaluate((node) =>
        getComputedStyle(node).listStyleType), "none");
    }
  }
  await assertChecklists(page);
  assert.equal(await page.getByRole("heading", { name: "Executive summary", exact: true }).count(), 0);
  const geometry = await block(page, "single-evidence").evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const title = element.querySelector("h2").getBoundingClientRect();
    const menu = element.querySelector(".menu-trigger").getBoundingClientRect();
    return { titleGap: title.top - frame.top, menuRight: frame.right - menu.right };
  });
  assert.ok(Math.abs(geometry.titleGap) <= 2 && Math.abs(geometry.menuRight) <= 8,
    `Markdown-owned headings must have right-aligned actions without an empty header row: ${JSON.stringify(geometry)}`);

  async function assertEditorialLink() {
    const evidenceLink = block(page, "single-evidence").getByRole("link", { name: "explanation", exact: true });
    const styles = await evidenceLink.evaluate((element) => ({
      color: getComputedStyle(element).color,
      surroundingColor: getComputedStyle(element.parentElement).color,
      decoration: getComputedStyle(element).textDecorationLine,
      style: getComputedStyle(element).textDecorationStyle,
    }));
    assert.equal(styles.color, styles.surroundingColor);
    assert.equal(styles.decoration, "underline");
    assert.equal(styles.style, "dotted");
    await evidenceLink.hover();
    assert.equal(await evidenceLink.evaluate((element) => getComputedStyle(element).textDecorationStyle), "solid");
    await page.mouse.move(0, 0);
  }
  await assertEditorialLink();

  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  await assertEditorialLink();
  const narrative = block(page, "report-executive-summary").getByRole("textbox", { name: "Edit finding" });
  await narrative.evaluate((element) => {
    element.focus();
    const selection = window.getSelection();
    selection.selectAllChildren(element);
    selection.collapseToEnd();
  });
  await narrative.pressSequentially(" Revised locally.");
  await narrative.blur();
  await saveReportEdits(page);
  await page.waitForFunction(() => Object.values(localStorage).some((value) => value.includes("Revised")));
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  await action(page, "report-executive-summary", "Hide");
  await block(page, "report-executive-summary").waitFor({ state: "hidden" });
  await saveReportEdits(page);
  await page.waitForFunction(() => Object.values(localStorage).some((value) =>
    JSON.parse(value).presentation?.hiddenBlocks?.includes("report-executive-summary")));
  await page.reload({ waitUntil: "load" });
  await block(page, "single-evidence").waitFor();
  assert.equal(await block(page, "report-executive-summary").count(), 0, "A custom-titled summary must stay hidden after reload");
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  await page.getByRole("button", { name: "Restore hidden (1)", exact: true }).click();
  await block(page, "report-executive-summary").waitFor();
  assert.match(await block(page, "report-executive-summary").innerText(), /Revised/u);
  await saveReportEdits(page);
  assert.equal(await block(page, "report-executive-summary").locator("strong").innerText(), "reviewed evidence");

  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  const detail = block(page, "single-evidence");
  const detailEditor = detail.locator('.report-rich-editable[contenteditable="true"]');
  await detailEditor.locator("h2").fill("A revised look");
  await detailEditor.locator("p").fill("A revised source explanation.");
  await detailEditor.locator("p").selectText();
  const formatToolbar = page.getByRole("toolbar", { name: "Format selected text" });
  await formatToolbar.waitFor();
  await formatToolbar.getByRole("button", { name: "Bold", exact: true }).click();
  await page.keyboard.press("Escape");
  await detailEditor.blur();
  await saveReportEdits(page);
  await page.waitForFunction(() => Object.values(localStorage).some((value) =>
    value.includes("## A revised look") && value.includes("**A revised source explanation.**")));
  await page.reload({ waitUntil: "load" });
  await detail.getByRole("heading", { name: "A revised look", exact: true }).waitFor();
  assert.equal(await detail.getByRole("heading").count(), 1, "Markdown-owned headings must not duplicate after editing");
  assert.equal(await detail.locator(".component-title-text").count(), 0);
  assert.equal(await detail.locator("strong").innerText(), "A revised source explanation.");
  await closeSource(await openSource(page, "single-evidence"));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit text and layout", exact: true }).click();
  const proseOnly = block(page, "prose-only");
  await proseOnly.scrollIntoViewIfNeeded();
  await assertProseMenuDoesNotOverlapText(proseOnly);
  const proseEditor = proseOnly.getByRole("textbox", { name: "Edit prose-only finding" });
  const proseText = await proseEditor.innerText();
  await proseEditor.locator("p").selectText();
  await formatToolbar.waitFor();
  await formatToolbar.getByRole("button", { name: "Bold", exact: true }).click();
  await page.keyboard.press("Escape");
  await proseEditor.blur();
  await assertProseMenuDoesNotOverlapText(proseOnly);
  await saveReportEdits(page);
  await page.waitForFunction(() => Object.values(localStorage).some((value) =>
    value.includes("**A plain paragraph") && value.includes("narrow screen.**")));
  await closeSource(await openSource(page, "prose-only"));
  await page.reload({ waitUntil: "load" });
  await proseOnly.locator("strong").waitFor();
  assert.equal(await proseOnly.locator("strong").innerText(), proseText);
  assert.equal(await proseOnly.getByRole("heading").count(), 0, "Prose-only evidence must not acquire a forced heading");
  await proseOnly.hover();
  await assertProseMenuDoesNotOverlapText(proseOnly);
  await closeSource(await openSource(page, "prose-only"));
  await page.setViewportSize({ width: 1100, height: 850 });

  let drawer = await openSource(page, "report-executive-summary");
  assert.match(await drawer.innerText(), /Definition A/u);
  assert.match(await drawer.innerText(), /Aug 10, 2026/u);
  await drawer.getByRole("tab", { name: "Data preview", exact: true }).click();
  assert.doesNotMatch(await drawer.innerText(), /A-omitted/u);
  await drawer.getByRole("button", { name: "Next page", exact: true }).click();
  assert.match(await drawer.innerText(), /A-9/u);
  await drawer.getByRole("textbox", { name: "Search data" }).fill("A-9");
  await selectSource(page, drawer, "Ledger B");
  assert.equal(await drawer.getByRole("textbox", { name: "Search data" }).inputValue(), "");
  assert.match(await drawer.innerText(), /B-included/u);
  assert.doesNotMatch(await drawer.innerText(), /A-9|B-omitted/u);
  await drawer.getByRole("tab", { name: "Overview", exact: true }).click();
  assert.match(await drawer.innerText(), /Definition B/u);
  assert.doesNotMatch(await drawer.innerText(), /Definition A/u);
  assert.match(await drawer.innerText(), /Aug 3, 2026/u);
  await drawer.getByRole("tab", { name: "Evidence flow", exact: true }).click();
  assert.match(await drawer.innerText(), /Evidence B/u);
  assert.doesNotMatch(await drawer.innerText(), /Evidence A/u);
  await drawer.getByRole("tab", { name: "SQL query", exact: true }).click();
  await drawer.getByRole("button", { name: "Copy", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__compositionClipboard.at(-1)), snapshot.queries.beta.source.sql);
  await selectSource(page, drawer, "Ledger A");
  await drawer.getByRole("button", { name: "Copy", exact: true }).waitFor();
  assert.match(await drawer.locator(".sql").innerText(), /ledger_a/u);
  assert.doesNotMatch(await drawer.locator(".sql").innerText(), /ledger_b/u);
  await closeSource(drawer);
  await action(page, "report-executive-summary", "Copy data");
  const copied = await page.evaluate(() => window.__compositionClipboard.at(-1));
  assert.match(copied, /^Ledger A\n/u);
  assert.match(copied, /A-9\t109/u);
  assert.match(copied, /\n\nLedger B\n/u);
  assert.match(copied, /B-included\t222/u);
  assert.doesNotMatch(copied, /A-omitted|B-omitted/u);
  drawer = await openSource(page, "single-evidence");
  assert.equal(await drawer.getByRole("button", { name: "Choose reviewed data source" }).count(), 0);
  await closeSource(drawer);

  drawer = await openSource(page, "live-source-evidence");
  await selectSource(page, drawer, "Ledger B");
  await drawer.getByRole("tab", { name: "Data preview", exact: true }).click();
  await drawer.getByRole("cell", { name: "B-included", exact: true }).waitFor();
  const liveDrawer = await drawer.elementHandle();
  // Trigger external React state updates without dismissing the open drawer's backdrop.
  await page.getByRole("button", { name: "Refresh source component", exact: true }).evaluate(button => button.click());
  await drawer.getByRole("heading", { name: "Live source 1", exact: true }).waitFor();
  assert.match(await drawer.innerText(), /B-included/u,
    "Updating the open component must retain its still-valid secondary-source selection");
  assert.doesNotMatch(await drawer.innerText(), /A-1|B-omitted/u);
  await page.getByRole("button", { name: "Toggle secondary source", exact: true }).evaluate(button => button.click());
  await drawer.getByRole("cell", { name: "A-1", exact: true }).waitFor();
  assert.equal(await drawer.getByRole("button", { name: "Choose reviewed data source" }).count(), 0);
  assert.doesNotMatch(await drawer.innerText(), /B-included|A-omitted/u,
    "Removing the selected secondary source must resolve the primary source before reading scoped rows");
  await page.getByRole("button", { name: "Refresh source component", exact: true }).evaluate(button => button.click());
  await drawer.getByRole("heading", { name: "Live source 2", exact: true }).waitFor();
  assert.match(await drawer.innerText(), /A-1/u, "The primary-source fallback survives subsequent component updates");
  assert.equal(await liveDrawer.evaluate(element => element.isConnected), true,
    "The regression must update the existing SourceSidebarHost drawer, not close and reopen it");
  await closeSource(drawer);

  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  const listEditor = block(page, "block-styles").getByRole("textbox", { name: "Edit list" });
  async function chooseStyle(name, target = listEditor, viewport) {
    if (target) await target.selectText();
    await formatToolbar.getByRole("button", { name: "Text styles" }).click();
    const menu = page.getByRole("menu", { name: "Text styles" });
    if (viewport) {
      await page.setViewportSize(viewport);
      await menu.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    const geometry = await menu.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const trigger = document.querySelector('[data-rich-format-toolbar] [aria-label="Text styles"]').getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
        height: bounds.height, triggerTop: trigger.top, triggerBottom: trigger.bottom,
        width: innerWidth, viewportHeight: innerHeight };
    });
    assert.ok(geometry.left >= 11 && geometry.right <= geometry.width - 11
      && geometry.top >= 11 && geometry.bottom <= geometry.viewportHeight - 11,
      `Every text-style option must be reachable inside the viewport: ${JSON.stringify(geometry)}`);
    if (geometry.triggerBottom + 8 + geometry.height > geometry.viewportHeight - 12
      && geometry.triggerTop - 8 - geometry.height >= 12) {
      assert.ok(geometry.bottom <= geometry.triggerTop - 7,
        "A submenu without space below opens above its trigger");
    }
    await menu.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).click();
  }
  for (const listStyle of ["Bulleted list", "Numbered list", "Checklist"]) {
    await chooseStyle(listStyle);
    assert.equal(await listEditor.locator("li").count(), 2);
    await chooseStyle("Heading");
    assert.equal(await listEditor.locator("h2").count(), 2, `${listStyle} converts to the requested heading, not a paragraph`);
    assert.equal(await listEditor.locator("li").count(), 0);
    assert.equal(await listEditor.locator("strong").innerText(), "item");
    await chooseStyle("Text");
    assert.equal(await listEditor.locator("p").count(), 2);
  }
  const partialEditor = block(page, "partial-list").getByRole("textbox", { name: "Edit one list item" });
  await chooseStyle("Heading", partialEditor.locator("li").nth(1));
  assert.deepEqual(await partialEditor.locator("li").allTextContents(), ["Before", "After"]);
  assert.equal(await partialEditor.locator("h2").innerText(), "Selected item");
  assert.equal(await partialEditor.locator("h2 strong").innerText(), "item");
  const nestedEditor = block(page, "nested-list").getByRole("textbox", { name: "Edit nested list" });
  await nestedEditor.scrollIntoViewIfNeeded();
  await nestedEditor.evaluate((element) => {
    element.focus();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    const first = nodes.find((node) => node.textContent === "Nested first");
    const last = nodes.find((node) => node.textContent === "After");
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.textContent.length);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  await chooseStyle("Heading", null);
  assert.deepEqual(await nestedEditor.locator("h2").allTextContents(), ["Nested first", "Nested second", "After"]);
  assert.deepEqual(await nestedEditor.locator("li").allTextContents(), ["Parent"]);
  const nestedMiddle = block(page, "nested-middle");
  await chooseStyle("Heading", nestedMiddle.getByText("Nested second", { exact: true }));
  assert.equal(await nestedMiddle.locator(".report-rich-editable h2").innerText(), "Nested second");
  const nestedParent = block(page, "nested-parent");
  await chooseStyle("Heading", nestedParent.getByText("Parent", { exact: true }), { width: 360, height: 500 });
  await page.setViewportSize({ width: 1100, height: 850 });
  assert.equal(await nestedParent.locator(".report-rich-editable h2").innerText(), "Parent");
  assert.equal(await nestedParent.locator("h2 ul,h2 ol").count(), 0,
    "Converting a parent must not put its child list inside the heading");
  const clearEditor = block(page, "clear-text").getByRole("textbox", { name: "Clear finding" });
  await clearEditor.fill("");
  const waitForCleared = () => page.waitForFunction(() =>
    document.querySelector('[data-editable-id="clear:body"] [contenteditable="true"]')?.textContent === "");
  await waitForCleared();
  await clearEditor.press("ControlOrMeta+z");
  await page.waitForFunction(() => document.querySelector('[data-editable-id="clear:body"]').textContent.includes("Text that can be cleared."));
  await clearEditor.press("ControlOrMeta+Shift+z");
  await waitForCleared();
  await saveReportEdits(page);
  await page.waitForFunction(() => Object.values(localStorage).some((value) =>
    JSON.parse(value).presentation?.textEdits?.["clear:body"] === ""));
  await page.reload({ waitUntil: "load" });
  assert.equal(await block(page, "clear-text").locator(".rich-narrative-content").innerText(), "");
  assert.equal(await nestedMiddle.locator("code, pre").count(), 0, "An unselected nested remainder must stay a list after save/reload");
  assert.equal(await nestedMiddle.getByText("Nested third", { exact: true }).evaluate((node) => node.tagName), "LI");
  assert.equal(await nestedParent.getByRole("heading", { name: "Parent", exact: true }).count(), 1);
  assert.deepEqual(await nestedParent.locator(".rich-narrative-content li").allTextContents(),
    ["Child one", "Child two", "After"], "Child list structure survives parent conversion and save/reload");
  await assertChecklists(page);

  const hosted = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  hosted.on("pageerror", (error) => errors.push(error.message));
  let hostedSnapshot = { ...snapshot, includeLead: false };
  const record = { canEdit: false, revision: 0, presentation: {} };
  const writes = [];
  await hosted.route("https://report.chatgpt.site/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/presentation" && route.request().method() === "PUT") {
      const change = JSON.parse(route.request().postData());
      writes.push(change);
      record.presentation = change.presentation;
      record.revision = change.revision + 1;
    }
    const value = pathname === "/api/snapshot" ? hostedSnapshot : pathname === "/api/presentation" ? record : undefined;
    await route.fulfill(value ? { contentType: "application/json", body: JSON.stringify(value) }
      : { contentType: "text/html", body: compiledHtml });
  });
  await hosted.goto("https://report.chatgpt.site/", { waitUntil: "load" });
  await block(hosted, "single-evidence").waitFor();
  assert.equal(await block(hosted, "report-executive-summary").count(), 0, "A report may omit a summary entirely");
  assert.equal(await hosted.getByRole("button", { name: "Edit text and layout", exact: true }).count(), 0);
  assert.equal(await hosted.locator('[contenteditable="true"]').count(), 0);
  await assertChecklists(hosted);
  drawer = await openSource(hosted, "single-evidence");
  await closeSource(drawer);
  assert.deepEqual(writes, [], "Viewer source inspection must not write shared presentation");
  record.canEdit = true;
  hostedSnapshot = { ...snapshot };
  await hosted.reload({ waitUntil: "load" });
  await hosted.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  const saved = hosted.waitForResponse((response) => response.url().endsWith("/api/presentation")
    && response.request().method() === "PUT" && response.ok());
  await block(hosted, "clear-text").getByRole("textbox", { name: "Clear finding" }).fill("");
  await saveReportEdits(hosted);
  await saved;
  assert.equal(record.presentation.textEdits["clear:body"], "");
  await hosted.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  const hiddenSaved = hosted.waitForResponse((response) => response.url().endsWith("/api/presentation")
    && response.request().method() === "PUT" && response.ok());
  await action(hosted, "report-executive-summary", "Hide");
  await saveReportEdits(hosted);
  await hiddenSaved;
  assert.ok(record.presentation.hiddenBlocks.includes("report-executive-summary"));
  record.canEdit = false;
  await hosted.reload({ waitUntil: "load" });
  await block(hosted, "single-evidence").waitFor();
  assert.equal(await block(hosted, "report-executive-summary").count(), 0, "Viewers receive the owner's hidden-section state");
  assert.equal(await hosted.getByRole("button", { name: "Edit text and layout", exact: true }).count(), 0);
  assert.equal(await block(hosted, "clear-text").locator(".rich-narrative-content").innerText(), "");
  assert.deepEqual(errors, [], "Generic report composition must not emit browser errors");
  console.log(JSON.stringify({ status: "passed", checks: ["optional summary", "custom summary title", "hide/reload/restore",
    "rich narrative persistence", "clear/undo/redo/reload", "read-only checklists", "list-to-heading conversion", "legacy custom headings",
    "editorial links in read/edit modes", "Markdown heading geometry and editing", "prose-only mobile source actions",
    "scoped multi-source inspection", "source state reset",
    "grouped clipboard", "single-source inspection", "hosted owner/viewer"] }, null, 2));
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
