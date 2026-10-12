import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { buildDeliveryDiagnostic } from "../templates/data-app/base/examples/reports/delivery-diagnostic/build.mjs";

const example = buildDeliveryDiagnostic({ buildProject(project, options) {
  const reportPath = join(project, "src/content/report/ReportContent.jsx");
  const report = readFileSync(reportPath, "utf8");
  const closingArticle = "  </article>;";
  assert.equal(report.split(closingArticle).length, 2, "The explicit-card fixture is inserted once into the temporary report");
  const explicitCards = `
    <DataComponent id="shared-card-chart" title="Shared card" kind="chart" variant="card"
      queryId="weekly" sourceRows={reviewedRows("weekly")}>
      <div className="shared-card-content">Shared card fixture</div>
    </DataComponent>
    <DataComponent id="shared-card-reference" title="Shared card" kind="custom" variant="card"
      queryId="weekly" sourceRows={reviewedRows("weekly")}>
      <div className="shared-card-content">Shared card fixture</div>
    </DataComponent>
`;
  writeFileSync(reportPath, report.replace(closingArticle, explicitCards + closingArticle));
  return runDataAppFixtureBuild(project, options);
} });
const browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
const errors = [];
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1, `${message}: ${actual} vs ${expected}`);

async function assertChartMappingContract() {
  // Exercise real rendered marks, runtime validation after a local revision,
  // and recovery. These are synthetic rows, not customer operational data.
  const fields = ["Site A", "Site B"];
  const stages = ["Stage A", "Stage B", "Stage C", "Stage D", "Stage E"];
  const rows = [10, 18, 14].map((value, index) => ({
    period: `Period ${index + 1}`,
    ...Object.fromEntries(stages.map((field, fieldIndex) => [field, value + fieldIndex * 3])),
    "Site A": value, "Site B": value + 5,
  }));
  const cases = [
    { id: "wide-line", spec: { type: "line", x: "period", y: fields[0], fields }, series: 2 },
    { id: "wide-bar", spec: { type: "bar", x: "period", y: fields[0], fields }, bars: 6 },
    { id: "wide-stack", spec: { type: "stackedBar", x: "period", y: stages[0], fields: stages }, bars: 15 },
    { id: "scalar-line", spec: { type: "line", x: "period", y: fields[0] }, series: 1 },
    { id: "scalar-waterfall", spec: { type: "waterfall", x: "period", y: fields[0] }, bars: 3 },
  ];
  const mappingExample = buildDeliveryDiagnostic({ buildProject(project, options) {
    const dataPath = join(project, "src/data.json");
    const data = JSON.parse(readFileSync(dataPath, "utf8"));
    data.id = "synthetic-chart-mapping-contract";
    data.title = "Synthetic chart mapping contract";
    data.queries = { synthetic: { label: "Synthetic evidence", rows } };
    writeFileSync(dataPath, JSON.stringify(data));
    writeFileSync(join(project, "src/content/report/ReportContent.jsx"), `
import React, { useState } from "react";
import { ChartRenderer, DataComponent, useDataApp } from "../../data-app-public.jsx";
const cases = ${JSON.stringify(cases)};
export function ReportContent() {
  const { reviewedRows } = useDataApp();
  const [mapping, setMapping] = useState("valid");
  const rows = reviewedRows("synthetic");
  return <article className="report-content">
    <h1>Synthetic chart mapping contract</h1>
    <label>Chart mapping <select aria-label="Chart mapping" value={mapping} onChange={event => setMapping(event.target.value)}>
      <option value="valid">Valid mapping</option>
      <option value="array">Array y</option>
      <option value="nested">Nested fields</option>
    </select></label>
    {cases.map(fixture => {
      const fields = fixture.spec.fields ?? [fixture.spec.y];
      const spec = mapping === "array" ? { ...fixture.spec, fields: undefined, y: fields }
        : mapping === "nested" ? { ...fixture.spec, fields: [fields] }
        : fixture.spec;
      return <DataComponent key={fixture.id} id={fixture.id} title={fixture.id} kind="chart"
        queryId="synthetic" sourceRows={rows} chart={spec}>
        <ChartRenderer chartId={fixture.id} spec={spec} rows={rows} height={300} />
      </DataComponent>;
    })}
  </article>;
}
`);
    return runDataAppFixtureBuild(project, options);
  } });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(pathToFileURL(mappingExample.html).href);
    async function assertPaintedMarks() {
      for (const fixture of cases) {
        const chart = page.locator(`[data-component-id="${fixture.id}"]`);
        await chart.scrollIntoViewIfNeeded();
        await page.waitForFunction(({ id, series, bars }) => {
          const chart = document.querySelector(`[data-component-id="${id}"]`);
          const painted = selector => [...chart.querySelectorAll(selector)].filter(mark => {
            const box = mark.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && getComputedStyle(mark).visibility !== "hidden";
          }).length;
          return series ? painted(".recharts-line-curve") === series
            : painted(".recharts-bar-rectangle .recharts-rectangle") >= bars;
        }, fixture);
        assert.equal(await chart.getByRole("alert").count(), 0, `${fixture.id}: valid evidence is not a configuration error`);
      }
    }
    await assertPaintedMarks();
    const line = page.locator('[data-component-id="wide-line"]');
    await line.scrollIntoViewIfNeeded();
    const midpoint = await line.locator(".recharts-line-curve").first().evaluate(path => {
      const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM());
      return { x: point.x, y: point.y };
    });
    await page.mouse.move(midpoint.x, midpoint.y);
    const tooltip = line.locator(".chart-tooltip");
    await tooltip.waitFor({ state: "visible" });
    assert.match(await tooltip.innerText(), /Site A\s*18/u, "The first line displays its reviewed value");
    assert.match(await tooltip.innerText(), /Site B\s*23/u, "The second line displays its own reviewed value");
    await page.mouse.move(0, 0);
    for (const mapping of ["array", "nested"]) {
      await page.getByLabel("Chart mapping", { exact: true }).selectOption(mapping);
      for (const fixture of cases) {
        const chart = page.locator(`[data-component-id="${fixture.id}"]`);
        const diagnostic = chart.locator('[role="alert"][data-chart-config-error="true"]');
        await diagnostic.waitFor();
        assert.match(await diagnostic.innerText(), new RegExp(fixture.id), "The diagnostic identifies the affected chart");
        assert.match(await diagnostic.innerText(), mapping === "array" ? /single field|fields/iu : /chart\.fields|field names/iu,
          "A malformed mapping explains its correction instead of silently painting a blank chart");
        assert.equal(await chart.locator(".recharts-line-curve, .recharts-bar-rectangle .recharts-rectangle").count(), 0,
          "Invalid mappings cannot leave misleading marks from the previous render");
      }
      await page.getByLabel("Chart mapping", { exact: true }).selectOption("valid");
      await assertPaintedMarks();
    }
  } finally {
    await page.close();
    rmSync(mappingExample.project, { recursive: true, force: true });
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(example.html).href);
  await page.locator(".recharts-surface").first().waitFor();
  for (const width of [1280, 748, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForFunction(() => [...document.querySelectorAll(".chart-frame")].every((frame) => {
        const svg = frame.querySelector("svg.recharts-surface");
        return svg && Math.abs(svg.getBoundingClientRect().width - frame.getBoundingClientRect().width) < 1;
      }));
      const geometry = await page.evaluate(() => {
        const rect = (element) => {
          const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
          return { x, y, width, height, right, bottom };
        };
        const article = document.querySelector(".report-content");
        const heading = article.querySelector("h1");
        const paragraph = article.querySelector(".rich-narrative-content p");
        const titleStyle = (node) => {
          const style = getComputedStyle(node);
          return { size: style.fontSize, line: style.lineHeight, weight: style.fontWeight, tracking: style.letterSpacing };
        };
        const sharedTitleProbe = document.createElement("span");
        sharedTitleProbe.style.cssText = "position:absolute;visibility:hidden;font-size:var(--text-md-size);"
          + "line-height:var(--text-md-line);font-weight:500;letter-spacing:var(--text-title-3-tracking)";
        article.append(sharedTitleProbe);
        const sharedTitle = titleStyle(sharedTitleProbe);
        sharedTitleProbe.remove();
        return {
          sharedTitle,
          pageWidth: rect(article.closest(".dashboard-root")).width,
          width: rect(article).width, headingSize: getComputedStyle(heading).fontSize,
          dateTicks: [...article.querySelector('[data-component-kind="chart"]')
            .querySelectorAll('.recharts-xAxis-tick-labels text')].map((node) => ({ text: node.textContent, ...rect(node) })),
          headingWeight: getComputedStyle(heading).fontWeight, bodyLine: getComputedStyle(paragraph).lineHeight,
          overflow: document.documentElement.scrollWidth > innerWidth,
          narratives: [...article.querySelectorAll('[data-component-kind="narrative"]')].map((node) => ({
            border: getComputedStyle(node).borderTopWidth, shadow: getComputedStyle(node).boxShadow,
          })),
          cards: [...article.querySelectorAll('[data-component-kind="chart"]:not([data-component-variant="card"])')].map((node) => {
            const style = getComputedStyle(node);
            const frame = node.querySelector(".chart-frame");
            const header = node.querySelector(".component-header");
            const menu = [...header.querySelectorAll(".menu-trigger")]
              .find(control => control.getBoundingClientRect().width > 0);
            const svg = frame.querySelector("svg.recharts-surface");
            const bounds = rect(svg);
            return {
              rect: rect(node), article: rect(article), frame: rect(frame), header: rect(header), menu: rect(menu),
              menuPosition: getComputedStyle(menu).position,
              padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
              radius: style.borderTopLeftRadius, border: style.borderTopWidth, shadow: style.boxShadow,
              clippedText: [...svg.querySelectorAll(".chart-annotation-label text, .recharts-cartesian-axis-tick-label text")]
                .filter((text) => { const box = rect(text); return box.x < bounds.x - 1 || box.right > bounds.right + 1
                  || box.y < bounds.y - 1 || box.bottom > bounds.bottom + 1; }).map((text) => text.textContent),
              marks: [...svg.querySelectorAll(".recharts-bar-rectangle path, .recharts-line-curve")].length,
            };
          }),
          sharedCards: [...article.querySelectorAll('[data-component-id^="shared-card-"][data-component-variant="card"]')]
            .map((node) => {
              const style = getComputedStyle(node);
              const bounds = rect(node);
              const content = rect(node.querySelector(".shared-card-content"));
              const header = node.querySelector(".component-header");
              const menu = node.querySelector(".menu-trigger");
              return {
                width: bounds.width, contentWidth: content.width, contentLeft: content.x - bounds.x,
                height: bounds.height, contentTop: content.y - bounds.y,
                headerPadding: getComputedStyle(header).paddingInlineEnd,
                headerMargin: getComputedStyle(header).marginBottom,
                title: titleStyle(node.querySelector(".component-title")),
                menuTop: rect(menu).y - rect(header).y, menuRight: bounds.right - rect(menu).right,
                padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
                radius: style.borderTopLeftRadius, border: style.borderTopWidth,
                borderColor: style.borderTopColor, background: style.backgroundColor, shadow: style.boxShadow,
              };
            }),
          links: [...article.querySelectorAll(".report-task-link")].map((node) => {
            const bullet = node.previousElementSibling.querySelector("li");
            const range = document.createRange();
            range.selectNodeContents(bullet);
            return { left: rect(node).x, textLeft: range.getBoundingClientRect().left,
              size: getComputedStyle(node).fontSize, arrow: rect(node.querySelector(".dashboard-icon")),
              gap: rect(node).y - rect(node.previousElementSibling).bottom };
          }),
        };
      });
      close(geometry.width, Math.min(748, geometry.pageWidth - (width <= 640 ? 40 : 72)), "Actual usable report width");
      assert.equal(geometry.headingSize, width <= 640 ? "32px" : "44px");
      assert.equal(geometry.headingWeight, "600");
      close(parseFloat(geometry.bodyLine), 25.6, "Readable body leading");
      assert.equal(geometry.overflow, false, `No page overflow at ${width}/${scheme}`);
      assert.equal(geometry.cards.length, 3);
      assert.equal(geometry.sharedCards.length, 2);
      assert.deepEqual(geometry.sharedCards[0], geometry.sharedCards[1],
        `Explicit chart cards retain the shared card geometry and theme instead of report-default chart CSS at ${width}/${scheme}`);
      for (const card of geometry.sharedCards) assert.deepEqual(card.title, geometry.sharedTitle,
        "Explicit cards use shared title tokens and weight, not report-specific heading typography");
      const weeks = ["Jun 22", "Jun 29", "Jul 6", "Jul 13", "Jul 20", "Jul 27", "Aug 3", "Aug 10"];
      const positions = geometry.dateTicks.map(({ text }) => weeks.indexOf(text));
      assert.ok(positions.length >= 2 && positions.every((index) => index >= 0), "Date labels use actual reviewed weeks");
      const stride = positions[1] - positions[0];
      assert.ok(stride > 0 && positions.slice(1).every((index, i) => index - positions[i] === stride),
        `Date labels keep a consistent week interval at ${width}/${scheme}: ${JSON.stringify(geometry.dateTicks)}`);
      if (width >= 748) assert.deepEqual(geometry.dateTicks.map(({ text }) => text), weeks,
        "Roomy report charts show all eight weeks rather than skipping arbitrary dates");
      for (let index = 1; index < geometry.dateTicks.length; index++) {
        assert.ok(geometry.dateTicks[index].x - geometry.dateTicks[index - 1].right >= 8,
          "Responsive date labels retain breathing room instead of overlapping");
      }
      assert.ok(geometry.narratives.every((node) => node.border === "0px" && node.shadow === "none"));
      for (const card of geometry.cards) {
        close(card.rect.x, card.article.x, "Chart and narrative left edges");
        close(card.rect.width, card.article.width, "Chart and narrative widths");
        assert.deepEqual(card.padding, width <= 640 ? ["16px", "12px", "16px", "12px"] : Array(4).fill("24px"));
        assert.equal(card.radius, "24px");
        assert.equal(card.border, "1px");
        assert.notEqual(card.shadow, "none");
        close(card.frame.height, 300, "Chart content, not full card, is 300px");
        assert.ok(card.rect.height > 300);
        close(card.menu.right, card.header.right, `Menu stays on inner padding edge ${JSON.stringify({ width, scheme, card })}`);
        close(card.menu.y - card.rect.y, card.rect.right - card.menu.right, "Menu top and right clearances match");
        close(card.rect.right - card.menu.right, parseFloat(card.padding[1]) + 1, "Menu right clearance matches card padding");
        assert.deepEqual(card.clippedText, [], `No clipped labels at ${width}/${scheme}`);
        assert.ok(card.marks > 0, `Chart data renders at ${width}/${scheme}`);
      }
      assert.equal(geometry.links.length, 2);
      for (const link of geometry.links) {
        close(link.left, link.textLeft, "Task aligns with bullet text");
        close(link.gap, 12, "Prose to task spacing");
        assert.equal(link.size, "16px");
        close(link.arrow.width, 20, "Bundled arrow width");
        close(link.arrow.height, 20, "Bundled arrow height");
      }
    }
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  const disclosure = page.getByRole("button", { name: "Evidence and alternative explanations", exact: true });
  assert.equal(await disclosure.getAttribute("aria-expanded"), "false");
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  assert.equal(await page.locator(".report-task-link").count(), 0);
  assert.equal(await disclosure.getAttribute("aria-expanded"), "false", "Edit mode must not open evidence automatically");
  await disclosure.click();
  assert.equal(await disclosure.getAttribute("aria-expanded"), "true");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await disclosure.getAttribute("aria-expanded"), "true");
  await disclosure.click();

  const chart = page.locator('[data-component-id="delivery-bridge"]');
  await chart.getByRole("button", { name: / actions$/u }).click();
  await page.getByRole("menuitem", { name: "View data source", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: /Data source for/u });
  await drawer.waitFor();
  await drawer.getByRole("button", { name: "Close data source", exact: true }).click();

  // The chart editor is portaled outside .report-page and must inherit the same
  // contextual bar color, including in dark mode.
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForFunction((expected) => getComputedStyle(document.querySelector(
      '[data-component-id="delivery-bridge"] .recharts-bar-rectangle path')).fill === expected,
    scheme === "dark" ? "rgb(146, 146, 146)" : "rgb(212, 212, 212)");
    const comparisonFill = await chart.locator(".recharts-bar-rectangle path").first()
      .evaluate((node) => getComputedStyle(node).fill);
    await chart.getByRole("button", { name: / actions$/u }).click();
    await page.getByRole("menuitem", { name: "Edit chart", exact: true }).click();
    const dialog = page.getByRole("dialog");
    // Recharts can replace the initial mark while the preview settles. Read the
    // current mark and its color together instead of retaining a detached node.
    await page.waitForFunction((expected) => {
      const preview = document.querySelector('[role="dialog"] .explorer-chart[aria-busy="false"]');
      const mark = preview?.querySelector(".recharts-bar-rectangle path");
      return mark && getComputedStyle(mark).fill === expected;
    }, comparisonFill);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }

  // Editing a recommendation out of task bounds must never blank the report.
  const recommendation = page.locator('[data-component-id="delivery-packing-test"]');
  for (const text of ["A".repeat(4001)]) {
    await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
    const editor = recommendation.locator('.report-rich-editable[contenteditable="true"]');
    await editor.fill(text);
    await editor.blur();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction((length) => {
      const narrative = document.querySelector('[data-component-id="delivery-packing-test"] .rich-narrative-content');
      return narrative && narrative.textContent.trim().length === length;
    }, text.length);
    assert.equal(await recommendation.locator(".report-task-link").count(), 0, `Invalid saved recommendation (${text.length} characters) has no task link`);
    assert.equal(await page.locator(".report-content h1").isVisible(), true);
    assert.equal(await page.locator('[data-component-id="delivery-pickup-comparison"] .report-task-link').count(), 1);
  }

  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".report-task-link").first().isVisible(), false);
  assert.equal(await page.locator('[id="delivery-evidence:details"]').isVisible(), true);
  assert.equal(await page.locator('[id="delivery-scope:details"]').isVisible(), true);
  await assertChartMappingContract();
  assert.deepEqual(errors, []);
  console.log("Report visual defaults passed: 748px, chart cards, 300px content, light/dark/mobile, task spacing, edit/disclosure/source/print, chart mapping diagnostics and rendered-mark recovery.");
} finally {
  await browser.close();
  rmSync(example.project, { recursive: true, force: true });
}
