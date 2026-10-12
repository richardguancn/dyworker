import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(root, "templates/data-app/base");
const workspace = mkdtempSync(join(tmpdir(), "data-app-header-alignment-"));
const scenarios = [
  {
    id: "standard-dashboard",
    surface: "dashboard",
    contentWidth: 1440,
    styles: "",
  },
  {
    id: "wide-dashboard",
    surface: "dashboard",
    contentWidth: 1600,
    styles:
      ".page { --data-app-layout-intent: wide; " +
      "--data-app-content-width: var(--data-app-dashboard-wide-content-width); }",
  },
  {
    id: "full-bleed-dashboard",
    surface: "dashboard",
    contentWidth: 1440,
    fullBleed: true,
    styles:
      // Override the protected frame fallback explicitly; a bare .page loses
      // to main[data-data-app-content] in both the source and prebuilt CSS.
      'main.page[data-data-app-content="dashboard"] { ' +
      "--data-app-layout-intent: full-bleed; max-width: none; padding-inline: 0; } " +
      ".filters.filter-bar { margin-inline: 0; " +
      "padding-inline: max(var(--data-app-layout-gutter), " +
      "calc((100vw - var(--data-app-content-width)) / 2)); }",
  },
  {
    id: "inset-dashboard-filters",
    surface: "dashboard",
    contentWidth: 1440,
    styles: ".filter-bar { padding-inline: 36px; }",
  },
  {
    id: "standard-editorial-report",
    surface: "report",
    contentWidth: 720,
    styles: "",
  },
  {
    id: "explicit-custom-dashboard",
    surface: "dashboard",
    contentWidth: 1800,
    styles: ".page { --data-app-layout-intent: user-requested; --data-app-content-width: 1800px; }",
  },
  {
    id: "explicit-custom-report",
    surface: "report",
    contentWidth: 1200,
    styles: ".report-page { --data-app-layout-intent: user-requested; --data-app-content-width: 1200px; }",
  },
];

const browser = await chromium.launch({
  executablePath: resolveChromiumExecutable(),
  headless: true,
});
const results = [];

try {
  for (const scenario of scenarios) {
    const project = join(workspace, scenario.id);
    cpSync(template, project, {
      recursive: true,
      filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
    });
    const snapshotPath = join(project, "src/data.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    writeFileSync(snapshotPath, `${JSON.stringify({ ...snapshot, surface: scenario.surface }, null, 2)}\n`);
    const stylesheet = join(project, `src/content/${scenario.surface}/${scenario.surface}.css`);
    writeFileSync(stylesheet, `${readFileSync(stylesheet, "utf8")}\n${scenario.styles}\n`);
    const build = runDataAppFixtureBuild(project, { pluginRoot: root });
    assert.equal(build.status, 0, `${scenario.id}: ${build.stdout}\n${build.stderr}`);

    const page = await browser.newPage({
      viewport: { width: 1920, height: 1050 },
    });
    await page.goto(pathToFileURL(join(project, "dist/index.html")).href, {
      waitUntil: "load",
    });
    await page.locator(scenario.surface === "report" ? "main h1" : "main .filter-bar > *").first().waitFor();
    for (const width of [1920, 1440, 901, 900, 760, 600, 599, 390, 320]) {
      await page.setViewportSize({ width, height: 1050 });
      await page.evaluate(
        () =>
          new Promise((next) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(next)))),
      );
      const alignment = await page.evaluate((surface) => {
        const main = document.querySelector("main");
        const mainBounds = main.getBoundingClientRect();
        const styles = getComputedStyle(main);
        const headingElement = main.querySelector(surface === "report" ? "h1" : ".filter-bar > *");
        const heading = headingElement.getBoundingClientRect();
        const headingStyles = getComputedStyle(headingElement);
        const title = document.querySelector(".dashboard-topbar-title").getBoundingClientRect();
        const actions = document.querySelector(".dashboard-topbar-actions").getBoundingClientRect();
        const fullFreshness = document.querySelector(".dashboard-freshness-full");
        const compactFreshness = document.querySelector(".dashboard-freshness-compact");
        const askButton = document.querySelector(".dashboard-ask-button");
        const publishButton = document.querySelector(".dashboard-publish-button");
        const refreshCaret = document.querySelector(".dashboard-refresh-trigger-chevron");
        const inset = Math.max(0, heading.left - mainBounds.left - Number.parseFloat(styles.paddingLeft));
        const narrative = main.querySelector(".report-summary-lead, .report-analysis");
        const chartTitle = main.querySelector('[data-component-kind="chart"] .component-header');
        return {
          heading: heading.left,
          headingText: heading.left + Number.parseFloat(headingStyles.paddingLeft),
          title: title.left,
          titleWidth: title.width,
          actions: innerWidth - actions.right,
          frame: mainBounds.width,
          paddingLeft: Number.parseFloat(styles.paddingLeft),
          paddingRight: Number.parseFloat(styles.paddingRight),
          contentWidth:
            mainBounds.width - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight),
          proseWidth: narrative?.getBoundingClientRect().width,
          proseLeft: narrative?.getBoundingClientRect().left,
          chartTitleLeft: chartTitle?.getBoundingClientRect().left,
          contentEnd: innerWidth - mainBounds.right + Number.parseFloat(styles.paddingRight) + inset,
          overflow: document.documentElement.scrollWidth - innerWidth,
          askHit: askButton?.contains(document.elementFromPoint(
            askButton.getBoundingClientRect().x + askButton.getBoundingClientRect().width / 2,
            askButton.getBoundingClientRect().y + askButton.getBoundingClientRect().height / 2)),
          fullFreshnessDisplay: fullFreshness ? getComputedStyle(fullFreshness).display : null,
          compactFreshnessDisplay: compactFreshness ? getComputedStyle(compactFreshness).display : null,
          compactFreshnessText: compactFreshness?.textContent?.trim(),
          askButtonCount: document.querySelectorAll(".dashboard-ask-button").length,
          askButtonLabel: askButton?.getAttribute("aria-label"),
          askButtonText: askButton?.innerText?.trim(),
          publishButtonCount: document.querySelectorAll(".dashboard-publish-button").length,
          publishButtonText: publishButton?.innerText?.trim(),
          publishButtonIconCount: publishButton?.querySelectorAll(".dashboard-icon").length,
          refreshCaretDisplay: refreshCaret ? getComputedStyle(refreshCaret).display : null,
        };
      }, scenario.surface);
      const report = scenario.surface === "report";
      const evidenceStart = (width - alignment.contentWidth) / 2;
      const viewportGutter = scenario.fullBleed ? (width <= 650 ? 16 : 32) : alignment.paddingLeft;
      const expectedTitle = viewportGutter;
      const expectedActions = scenario.fullBleed ? viewportGutter : alignment.paddingRight;
      assert.ok(
        Math.abs(alignment.title - expectedTitle) <= 1,
        `${scenario.id} at ${width}px does not keep the protected title at the viewport gutter: ${JSON.stringify(alignment)}`,
      );
      assert.ok(
        Math.abs(alignment.actions - expectedActions) <= 1,
        `${scenario.id} at ${width}px does not keep protected actions at the viewport gutter: ${JSON.stringify(alignment)}`,
      );
      assert.ok(
        alignment.overflow <= 1,
        `${scenario.id} at ${width}px introduces horizontal overflow: ${JSON.stringify(alignment)}`,
      );
      assert.equal(alignment.publishButtonCount, 1, `${scenario.id} must retain one Publish control`);
      assert.equal(alignment.askButtonCount, 1, `${scenario.id} at ${width}px must retain the visible Ask control`);
      assert.equal(alignment.askHit, true, `${scenario.id} at ${width}px must keep Ask clickable`);
      assert.match(alignment.publishButtonText, /^Publish(?: changes)?$/u);
      assert.equal(alignment.publishButtonIconCount, 0, `${scenario.id} must keep Publish text-only`);
      if (width === 760) {
        assert.equal(alignment.fullFreshnessDisplay, "none", `${scenario.id} must hide the full date below 900px`);
        assert.notEqual(
          alignment.compactFreshnessDisplay,
          "none",
          `${scenario.id} must show the month-day date below 900px`,
        );
        assert.match(alignment.compactFreshnessText, /^[A-Z][a-z]{2} \d{1,2}$/u);
        assert.equal(alignment.askButtonCount, 1, `${scenario.id} must retain the Ask button from 600px to 899px`);
        assert.equal(alignment.askButtonLabel, "Ask ChatGPT");
        assert.equal(alignment.askButtonText, "Ask");
        if (alignment.refreshCaretDisplay != null) {
          assert.equal(alignment.refreshCaretDisplay, "none", `${scenario.id} must hide the refresh caret below 900px`);
        }
      }
      const gutter = scenario.surface === "report" ? (width <= 640 ? 20 : 36) : width <= 650 ? 16 : 32;
      const expectedWidth = Math.min(scenario.contentWidth, width - 2 * gutter);
      const actualWidth = scenario.fullBleed ? width - 2 * alignment.heading : alignment.contentWidth;
      assert.ok(
        Math.abs(actualWidth - expectedWidth) <= 1,
        `${scenario.id} at ${width}px uses an unexpected actual content width: ${JSON.stringify(alignment)}`,
      );
      if (!scenario.fullBleed) {
        assert.equal(alignment.paddingLeft, gutter, `${scenario.id} at ${width}px has an unexpected left gutter`);
        assert.equal(alignment.paddingRight, gutter, `${scenario.id} at ${width}px has an unexpected right gutter`);
      }
      if (report) {
        assert.ok(
          Math.abs(alignment.proseWidth - alignment.contentWidth) <= 1,
          `${scenario.id} at ${width}px gives report narrative and visual evidence different widths`,
        );
        assert.ok(
          Math.abs(alignment.headingText - evidenceStart) <= 1,
          `${scenario.id} at ${width}px misaligns the report title: ${JSON.stringify(alignment)}`,
        );
        assert.ok(
          Math.abs(alignment.proseLeft - evidenceStart) <= 1,
          `${scenario.id} at ${width}px misaligns report narrative: ${JSON.stringify(alignment)}`,
        );
        assert.ok(
          Math.abs(alignment.chartTitleLeft - evidenceStart) <= 1,
          `${scenario.id} at ${width}px separates chart headings from their wider visual evidence: ${JSON.stringify(alignment)}`,
        );
      }
      results.push({
        id: scenario.id,
        width,
        contentWidth: actualWidth,
        gutter,
      });
    }

    if (scenario.id === "standard-dashboard") {
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      const ask = page.getByRole("button", { name: "Ask ChatGPT", exact: true });
      await ask.click();
      const composer = page.getByRole("dialog", { name: "Ask ChatGPT about this dashboard" });
      await composer.waitFor();
      await page.waitForFunction(() => {
        const panel = document.querySelector('.dashboard-ask-panel[data-header-morph="true"]');
        return panel?.getAnimations({ subtree: true }).every((animation) => animation.playState === "finished");
      });
      const entranceDuration = await composer.evaluate(
        (element) => Number.parseFloat(getComputedStyle(element).animationDuration) * 1000,
      );
      const compactBounds = await composer.boundingBox();
      await composer.getByRole("textbox", { name: "Question for ChatGPT" }).fill("What changed?");
      await page.waitForFunction(
        () =>
          document.querySelector('.dashboard-ask-panel[data-header-morph="true"]')?.getBoundingClientRect().height >=
          68,
      );
      const expandedBounds = await composer.boundingBox();
      assert.equal(Math.round(expandedBounds.height), 68, "Typing must expand the header composer");
      assert.ok(
        Math.abs(expandedBounds.y - compactBounds.y) <= 1,
        `The header composer must grow downward without moving its top edge: ${JSON.stringify({ compactBounds, expandedBounds })}`,
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => document.querySelector('.dashboard-ask-panel[data-header-morph="true"]')?.dataset.closing === "true",
      );
      const exitDuration = await composer.evaluate(
        (element) => Number.parseFloat(getComputedStyle(element).animationDuration) * 1000,
      );
      assert.equal(Math.round(exitDuration - entranceDuration), 50, "The header Ask exit must be 50ms longer");
      await composer.waitFor({ state: "detached" });
    }

    if (scenario.surface === "dashboard") {
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await page.evaluate(
        () => new Promise((next) => requestAnimationFrame(() => requestAnimationFrame(next))),
      );
      const tabCount = await page.getByRole("tab").count();
      if (tabCount > 1) {
        await page.getByRole("button", { name: "Edit mode" }).click();
        await page.waitForFunction(
          () => document.querySelector(".dashboard-tabs-collapse")?.getAttribute("aria-hidden") === "false",
        );
        const tabs = await page.evaluate(() => {
          const inner = document.querySelector(".dashboard-tabs-inner");
          const title = document.querySelector(".dashboard-topbar-title");
          return {
            gutter: inner.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(inner).paddingLeft),
            chrome: title.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(title).paddingLeft),
          };
        });
        assert.ok(
          Math.abs(tabs.gutter - tabs.chrome) <= 1,
          `${scenario.id} misaligns dashboard tabs with full-width protected chrome: ${JSON.stringify(tabs)}`,
        );
      }
    }
    if (scenario.id === "standard-dashboard") {
      await page.setViewportSize({ width: 390, height: 1050 });
      await page.getByRole("button", { name: "More", exact: true }).click();
      const menuItems = await page.locator(".dashboard-header-action-menu [role=menuitem]").allTextContents();
      assert.ok(!menuItems.includes("Ask ChatGPT"), "More must not duplicate the visible Ask action");
      await page.keyboard.press("Escape");
      const ask = page.getByRole("button", { name: "Ask ChatGPT", exact: true });
      const askBounds = await ask.boundingBox();
      await ask.click();
      const composer = page.getByRole("dialog", { name: "Ask ChatGPT about this dashboard" });
      await composer.waitFor();
      const composerBounds = await composer.boundingBox();
      assert.equal(Math.round(composerBounds.height), 36, "The empty Ask composer must remain a compact capsule");
      assert.equal(
        await composer.evaluate((element) => getComputedStyle(element).borderRadius),
        "18px",
        "The empty Ask composer must use a radius equal to half its height",
      );
      assert.ok(Math.abs(composerBounds.y + composerBounds.height / 2 - askBounds.y - askBounds.height / 2) <= 1,
        "The mobile composer must retain the direct button's anchored morph");
      assert.deepEqual(
        await composer.locator(".dashboard-ask-zero-state > *").allTextContents(),
        [
          "Draft a team updateShare the highlights in a message",
          "Refresh a documentUpdate a file with fresh data",
          "Set up an alertNotify you of important changes",
          "Remix this dashboard",
        ],
      );
      await composer.getByRole("textbox", { name: "Question for ChatGPT" }).fill("What changed?");
      assert.equal(await composer.locator(".dashboard-ask-zero-state").count(), 0);
      assert.equal(Math.round((await composer.boundingBox()).height), 68);
    }
    await page.close();
  }
} finally {
  await browser.close();
  rmSync(workspace, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      scenarios: scenarios.length,
      viewportChecks: results.length,
      results,
    },
    null,
    2,
  ),
);
