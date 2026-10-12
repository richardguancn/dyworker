import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { chooseHostedHandoff } from "./data-app-browser-handoff.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
const originatingThreadId = "550e8400-e29b-41d4-a716-446655440000";
const project = mkdtempSync(join(tmpdir(), "data-report-smoke-"));
cpSync(template, project, {
  recursive: true,
  filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
});
const dataPath = join(project, "src/data.json");
const snapshot = {
  ...JSON.parse(readFileSync(dataPath, "utf8")),
  surface: "report",
};
writeFileSync(dataPath, `${JSON.stringify(snapshot, null, 2)}\n`);
const authoredStyles = join(project, "src/content/report/report.css");
writeFileSync(
  authoredStyles,
  `${readFileSync(authoredStyles, "utf8")}\n` +
    ".report-page { --data-app-layout-intent: authored-report; --data-app-content-width: 720px; }\n" +
    ".report-methods { border: 2px solid red !important; }\n",
);
const build = runDataAppFixtureBuild(project, {
  pluginRoot,
  env: {
    ...process.env,
    CODEX_SESSION_ID: originatingThreadId,
    CODEX_THREAD_ID: originatingThreadId,
  },
});
assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
const compiledHtml = readFileSync(join(project, "dist/index.html"), "utf8");

const browser = await chromium.launch({
  executablePath: resolveChromiumExecutable(),
  headless: true,
});
const errors = [];

async function ensureOverflowMenu(page) {
  const menu = page.getByRole("menu", { name: "More", exact: true });
  if (!(await menu.isVisible())) await page.getByRole("button", { name: "More", exact: true }).click();
  return menu;
}

async function selectConversion(page, name) {
  const overflowMenu = await ensureOverflowMenu(page);
  const item = overflowMenu.getByRole("menuitem", { name, exact: true });
  assert.equal(await item.evaluate(element => element.tagName), "A", "Report exports must use genuine handoff links");
  await item.focus();
  await item.press("Enter");
}

async function saveReportEdits(page) {
  await page.locator(".dashboard-topbar").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
}

try {
  const page = await browser.newPage({
    userAgent: "CodexBrowser/1.0",
    viewport: { width: 1440, height: 1050 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((reportSnapshot) => {
    const key = `data-app:presentation:v1:${location.pathname}:${reportSnapshot.id ?? reportSnapshot.title ?? "app"}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          presentation: {
            hiddenBlocks: ["report-summary"],
            componentTitles: {},
            tabs: [{ id: "dashboard", label: "Dashboard" }],
            refreshSchedule: { frequency: "daily", time: "09:00" },
          },
        }),
      );
    }
    window.__reportPrompts = [];
    window.__reportDeepLinks = [];
    window.__reportTrustedActivations = [];
    window.__reportPrints = 0;
    document.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="codex://"], a[href^="https://chatgpt.com/?"]');
      if (!link) return;
      window.__reportTrustedActivations.push({
        connected: link.isConnected,
        trusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
        target: link.target,
      });
      if (event.defaultPrevented) return;
      event.preventDefault();
      window.__reportDeepLinks.push(link.href);
    });
    window.openai = {
      sendFollowUpMessage: async (message) => {
        window.__reportPrompts.push(message);
        return { isError: false };
      },
    };
    window.print = () => {
      window.__reportPrints += 1;
    };
  }, snapshot);
  await page.goto(pathToFileURL(join(project, "dist/index.html")).href, {
    waitUntil: "load",
  });
  assert.equal(new URL(page.url()).hash, "", "Local report previews must not require task URL fragments");
  assert.equal(
    await page.locator('meta[name="data-app-local-thread"]').getAttribute("content"),
    originatingThreadId,
    "Report builds must capture their originating task in transient HTML metadata",
  );
  const heading = page.locator(".report-hero h1");
  await heading.waitFor();
  assert.equal(await heading.innerText(), snapshot.title);

  const topbar = await page.locator(".dashboard-topbar").boundingBox();
  const rootWidth = await page.locator(".dashboard-topbar").evaluate((header) =>
    header.closest(".dashboard-root").getBoundingClientRect().width);
  assert.equal(topbar.x, 0);
  assert.equal(topbar.width, rootWidth, "Report chrome must remain full-width outside the editorial content");
  assert.equal(
    await page.locator('[data-data-app-chrome="topbar"]').count(),
    1,
    "Reports must retain exactly one protected application top bar",
  );
  assert.equal(
    await page.locator('main[data-data-app-content="report"]').count(),
    1,
    "Report composition must remain inside the authored content boundary",
  );
  assert.equal(await page.locator('[data-component-id="report-summary"]').count(), 0);
  const persisted = await page.evaluate(
    () =>
      Object.values(localStorage)
        .map((value) => JSON.parse(value))
        .find((record) => record.presentation)?.presentation,
  );
  assert.ok(
    persisted.hiddenBlocks.includes("report-summary"),
    "An authored summary must respect saved visibility",
  );
  assert.equal(persisted.tabs, undefined, "Report presentation must not persist dashboard tabs");
  assert.equal(
    persisted.refreshSchedule,
    undefined,
    "Report presentation must not persist dashboard refresh schedules",
  );
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  await page.getByRole("button", { name: /Restore hidden/u }).click();
  await saveReportEdits(page);
  const summarySection = page.locator('[data-component-id="report-summary"]');
  const initialSummaryHeading = await summarySection.locator("h2").innerText();
  assert.ok(initialSummaryHeading.length > 0, "The starter supplies an authored answer heading");
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction((scheme) => document.documentElement.dataset.colorScheme === scheme, colorScheme);
    for (const mode of ["edit", "view"]) {
      await page.getByRole("button", { name: mode === "edit" ? "Edit text and layout" : "Cancel", exact: true }).click();
      const colors = await summarySection.evaluate((section) => {
        const probe = document.createElement("span");
        section.append(probe);
        probe.style.color = "var(--data-app-report-body-text)";
        const bodyTone = getComputedStyle(probe).color;
        probe.style.color = "var(--secondary)";
        const secondary = getComputedStyle(probe).color;
        probe.style.color = "var(--text)";
        const primary = getComputedStyle(probe).color;
        probe.remove();
        const narrative = section.querySelector(".rich-narrative-content, .report-rich-editable");
        return { bodyTone, secondary, primary, paragraph: getComputedStyle(narrative.querySelector("p")).color,
          heading: getComputedStyle(narrative.querySelector("h2")).color };
      });
      assert.equal(colors.paragraph, colors.bodyTone, `${colorScheme} ${mode}: report prose uses the intermediate body token`);
      assert.notEqual(colors.paragraph, colors.secondary, "Body text is stronger than annotation/secondary text");
      assert.equal(colors.heading, colors.primary, `${colorScheme} ${mode}: report headings retain primary text`);
      assert.notEqual(colors.paragraph, colors.heading, "Report heading and body hierarchy remains distinct");
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  const reportLayout = await page.locator(".report-page").evaluate((main) => {
    const styles = getComputedStyle(main);
    const frame = main.getBoundingClientRect();
    const root = main.closest(".dashboard-root").getBoundingClientRect();
    const narrative = document.querySelector(".report-summary-lead").getBoundingClientRect();
    const heading = main.querySelector("h1").getBoundingClientRect();
    const headingStyles = getComputedStyle(main.querySelector("h1"));
    const chartHeading = main.querySelector('[data-component-kind="chart"] .component-header').getBoundingClientRect();
    const chartCard = main.querySelector('[data-component-kind="chart"]');
    const cardStyles = getComputedStyle(chartCard);
    const chrome = document.querySelector(".dashboard-topbar-title").getBoundingClientRect();
    return {
      frame: main.getBoundingClientRect().width,
      centeringError: Math.abs((frame.left - root.left) - (root.right - frame.right)),
      evidence:
        main.getBoundingClientRect().width -
        Number.parseFloat(styles.paddingLeft) -
        Number.parseFloat(styles.paddingRight),
      prose: narrative.width,
      narrativeLeft: narrative.left,
      headingLeft: heading.left + Number.parseFloat(headingStyles.paddingLeft),
      chartHeadingLeft: chartHeading.left,
      chartCardLeft: chartCard.getBoundingClientRect().left,
      chartInset: parseFloat(cardStyles.paddingLeft) + parseFloat(cardStyles.borderLeftWidth),
      chromeLeft: chrome.left,
      evidenceLeft: frame.left + Number.parseFloat(styles.paddingLeft),
    };
  });
  assert.equal(reportLayout.frame, 792, "This authored report frame adds gutters outside its editorial content width");
  assert.ok(reportLayout.centeringError < 1, "Editorial report frames are centered inside the full-width shell");
  assert.equal(reportLayout.evidence, 720, "The starter's chosen editorial width remains usable");
  assert.equal(
    reportLayout.prose,
    reportLayout.evidence,
    "Report narrative, titles, charts, and tables must share one content width",
  );
  assert.equal(
    reportLayout.narrativeLeft,
    reportLayout.evidenceLeft,
    "Report narrative must align with its visual evidence and protected chrome",
  );
  assert.equal(
    reportLayout.headingLeft,
    reportLayout.narrativeLeft,
    "Report titles and narrative share the report content column",
  );
  assert.equal(
    reportLayout.chartHeadingLeft,
    reportLayout.evidenceLeft + reportLayout.chartInset,
    "Chart titles must align with the chart card's padded content",
  );
  assert.equal(reportLayout.chartCardLeft, reportLayout.evidenceLeft, "Chart cards align with the narrative column");
  assert.equal(
    reportLayout.chromeLeft,
    36,
    "Protected report chrome spans the viewport using the report's desktop gutter",
  );
  const interruptedVisuals = await page
    .locator('[data-component-kind="chart"], [data-component-kind="table"]')
    .evaluateAll((components) =>
      components.flatMap((component) => {
        const header = component.querySelector(":scope > .component-header");
        const visual = component.querySelector("svg.recharts-surface, table");
        return [...component.querySelectorAll("[data-editable-narrative]")]
          .filter(
            (narrative) =>
              header.compareDocumentPosition(narrative) & Node.DOCUMENT_POSITION_FOLLOWING &&
              narrative.compareDocumentPosition(visual) & Node.DOCUMENT_POSITION_FOLLOWING,
          )
          .map(() => component.dataset.componentId);
      }),
    );
  assert.deepEqual(
    interruptedVisuals,
    [],
    "Report narrative must precede the chart/table component rather than separating its title from its visual",
  );
  assert.ok((await page.locator("svg.recharts-surface").count()) >= 1,
    "The base report includes rendered evidence for its question");
  assert.equal(
    await page.locator(".metric-strip, .diagnostic-layout, .analysis-layout").count(),
    0,
    "Reports must not render the dashboard grid composition",
  );

  const chart = page.locator('[data-component-kind="chart"]').first();
  await chart.getByRole("button", { name: /actions$/u }).click();
  await page.getByRole("menuitem", { name: "View data source" }).click();
  const chartSource = page.getByRole("complementary", { name: /Data source for/u });
  await chartSource.getByRole("tab", { name: "Overview", exact: true }).waitFor();
  assert.match(await chartSource.innerText(), /Signed active-account movement attributed to activation, expansion, or churn\./u,
    "The growth bridge must expose its actual reviewed driver definition");
  assert.doesNotMatch(await chartSource.innerText(), /Activated accounts divided by qualified sign-ups/u,
    "The bridge must not inherit a conversion definition from another query");
  assert.equal(await chartSource.getByRole("tab", { name: "Evidence flow", exact: true }).count(), 0,
    "Unrecorded evidence flow must not be invented from source metadata");
  for (const tab of ["Data preview", "SQL query", "Overview"]) {
    await page.getByRole("tab", { name: tab }).click();
  }
  await page.getByRole("button", { name: "Close data source" }).last().click();
  await page.locator(".source-sidebar-layer").waitFor({ state: "detached" });

  const expectedDefinitions = {
    "report-summary": /Distinct accounts active during the reporting week\./u,
    "report-metric-active": /Reviewed change in active accounts versus the preceding reporting week\./u,
    "report-metric-conversion": /Activated accounts divided by qualified sign-ups\./u,
    "report-methods": /Share of previously active accounts retained in the reporting week\./u,
    "report-drivers": /Signed active-account movement attributed to activation, expansion, or churn\./u,
  };
  for (const [id, definition] of Object.entries(expectedDefinitions)) {
    const section = page.locator(`[data-component-id="${id}"]`);
    await section.locator(":scope > .component-header").hover();
    await section.getByRole("button", { name: /actions$/u }).click();
    await page.getByRole("menuitem", { name: "View data source" }).click();
    const source = page.getByRole("complementary", { name: /Data source for/u });
    await source.getByRole("tab", { name: "Overview", exact: true }).waitFor();
    assert.match(await source.innerText(), definition, `${id} must expose its own reviewed definition`);
    if (id === "report-drivers") {
      await source.getByRole("button", { name: "Choose reviewed data source" }).click();
      await page.getByRole("menuitemradio", { name: snapshot.queries.usage_summary.source.label, exact: true }).click();
      assert.match(await source.innerText(), /Distinct accounts active during the reporting week\./u,
        "The bridge interpretation must expose the separate before/after total source");
      assert.doesNotMatch(await source.innerText(), /Signed active-account movement attributed/u);
    }
    if (id === "report-methods") {
      await source.getByRole("button", { name: "Choose reviewed data source" }).click();
      await page.getByRole("menuitemradio", { name: snapshot.queries.account_health.source.label, exact: true }).click();
      assert.match(await source.innerText(), /Reviewed categorical risk classification/u);
      await source.getByRole("tab", { name: "Data preview", exact: true }).click();
      const accountEvidence = await source.innerText();
      assert.match(accountEvidence, /Meridian Signals/u);
      assert.match(accountEvidence, /Lighthouse Query/u);
      assert.doesNotMatch(accountEvidence, /Orbit Cloud|Northstar Workshop/u,
        "The retention implication must expose only the named priority accounts it uses");
    }
    await source.getByRole("button", { name: "Close data source", exact: true }).click();
    await page.locator(".source-sidebar-layer").waitFor({ state: "detached" });
    await source.waitFor({ state: "hidden" });
  }

  await chart.getByRole("button", { name: /actions$/u }).click();
  await page.getByRole("menuitem", { name: "Edit chart" }).click();
  await page.getByRole("button", { name: "Chart type" }).waitFor();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Ask ChatGPT" }).click();
  const askComposer = page.getByRole("dialog", { name: "Ask ChatGPT about this dashboard" });
  for (const label of ["Share key insights", "Create a report", "Create a change alert"]) {
    const action = askComposer.getByRole("link", { name: label });
    assert.equal(await action.evaluate((element) => element.tagName), "A");
    assert.equal(await action.getAttribute("target"), "_self");
    assert.match(await action.getAttribute("href"), /^codex:\/\/threads\//u);
  }
  assert.equal(
    await askComposer.getByRole("link", { name: "Create a copy", exact: true }).count(),
    0,
    "Reports must not offer dashboard duplication",
  );
  assert.equal(await askComposer.getByRole("button", { name: "Switch theme" }).count(), 0);
  await page.keyboard.press("Escape");
  const overflowMenu = await ensureOverflowMenu(page);
  assert.equal(await overflowMenu.getByRole("menuitem", { name: "Create a copy", exact: true }).count(), 0,
    "Reports must not offer dashboard duplication in their overflow menu");
  await overflowMenu.getByRole("menuitem", { name: "Switch theme" }).click();
  await page.getByRole("region", { name: "Theme picker" }).waitFor();
  await page.getByRole("button", { name: "Apply Scientific blue" }).click();
  assert.equal(await page.locator("html").getAttribute("data-app-theme"), "scientific-blue");

  assert.equal(await page.getByRole("button", { name: "Refresh data" }).count(), 0);
  const freshness = page.locator(".dashboard-topbar .freshness-label");
  assert.equal(await freshness.count(), 1, "Reports retain their snapshot date as plain metadata");
  assert.equal(await freshness.evaluate((element) => element.tagName), "SPAN");
  assert.equal(await freshness.getAttribute("role"), null);
  assert.equal(await freshness.getAttribute("tabindex"), null);
  assert.equal(
    await page.getByText("Schedule refresh", { exact: true }).count(),
    0,
    "Reports must not offer dashboard refresh scheduling",
  );

  await selectConversion(page, "PDF");
  await page.waitForFunction(() => window.__reportDeepLinks.length === 1);
  const reportPdfLink = new URL(await page.evaluate(() => window.__reportDeepLinks[0]));
  assert.equal(`${reportPdfLink.protocol}//${reportPdfLink.host}${reportPdfLink.pathname}`,
    `codex://threads/${originatingThreadId}`);
  const reportPdfPrompt = reportPdfLink.searchParams.get("prompt");
  assert.match(reportPdfPrompt, /\[@Data\]\(plugin:\/\/data-analytics@openai-curated-remote\)/u);
  assert.match(reportPdfPrompt, /\$data-analytics:report-to-pdf\b/u);
  assert.match(reportPdfPrompt, /verified PDF\b/u);
  assert.ok(reportPdfPrompt.includes(join(project, "dist/index.html")), "File PDF export must retain the report artifact path");
  assert.match(reportPdfPrompt, /reader-visible collapsed evidence/u);
  assert.doesNotMatch(reportPdfPrompt, /entire dashboard/u);
  assert.equal(
    await page.evaluate(() => window.__reportPrints),
    0,
    "Report PDF export must hand off without invoking browser print",
  );
  assert.equal(
    await page.evaluate(() => window.__reportPrompts.length),
    0,
    "Report PDF export must not send a host follow-up prompt",
  );

  await page.emulateMedia({ media: "print" });
  assert.equal(
    await page.locator(".dashboard-topbar").evaluate((element) => getComputedStyle(element).display),
    "none",
    "Printed reports must omit application chrome",
  );
  assert.notEqual(
    await page.locator('main[data-data-app-content="report"]').evaluate((element) => getComputedStyle(element).display),
    "none",
    "Printed reports must retain the rendered report content",
  );
  await page.emulateMedia({ media: "screen" });

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const publicationReview = page.getByRole("dialog", { name: "Publish report", exact: true });
  assert.equal(
    await publicationReview.getByRole("radio", { name: "Invited people", exact: true }).isChecked(),
    true,
  );
  assert.equal(await publicationReview.getByRole("radio", { name: "Workspace members", exact: true }).isChecked(), false);
  await publicationReview.getByRole("link", { name: "Publish in ChatGPT", exact: true }).click();
  const reportPublicationLinks = await page.evaluate(() => window.__reportDeepLinks);
  assert.equal(reportPublicationLinks.length, 2, "Report PDF export and publishing must each use their protected Codex hyperlink");
  const reportPublicationLink = new URL(reportPublicationLinks.at(-1));
  assert.equal(
    `${reportPublicationLink.protocol}//${reportPublicationLink.host}${reportPublicationLink.pathname}`,
    `codex://threads/${originatingThreadId}`,
  );
  const reportPublicationPrompt = reportPublicationLink.searchParams.get("prompt");
  assert.match(reportPublicationPrompt, /\[@Sites\]\(plugin:\/\/sites@openai-curated-remote\)/u);
  assert.match(reportPublicationPrompt, /publish this report/u);
  assert.match(reportPublicationPrompt, /access limited to me until I invite others/u);
  assert.doesNotMatch(reportPublicationPrompt, /read-only and does not authorize|confirmation before publishing|permissions remain unresolved/u);
  assert.equal(
    reportPublicationLink.searchParams.get("prompt").includes(originatingThreadId),
    false,
    "Report handoff prompts must not expose the originating task",
  );
  assert.deepEqual(await page.evaluate(() => window.__reportTrustedActivations), [
    { connected: true, trusted: true, defaultPrevented: false, target: "_self" },
    { connected: true, trusted: true, defaultPrevented: false, target: "_self" },
  ]);
  const waitingForPublication = publicationReview.getByRole("link", { name: "Waiting for ChatGPT…", exact: true });
  assert.equal(await waitingForPublication.getAttribute("aria-disabled"), "true");
  assert.match(await publicationReview.getByRole("status").innerText(), /send.*ChatGPT.*wait/iu);
  await waitingForPublication.evaluate(element => { element.click(); element.click(); });
  await waitingForPublication.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => window.__reportDeepLinks.length), 2,
    "A pending report publication must ignore repeated mouse and keyboard activation");
  await publicationReview.getByRole("button", { name: "Close", exact: true }).click();
  await publicationReview.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  assert.equal(await publicationReview.getByRole("link", { name: "Publish in ChatGPT", exact: true }).isEnabled(), true);
  await page.keyboard.press("Escape");
  await publicationReview.waitFor({ state: "hidden" });

  for (const selector of ['[data-component-id="report-metric-active"] .component-title-text']) {
    const target = page.locator(selector).first();
    await target.dblclick();
    await page.waitForFunction((expected) => document.activeElement?.matches(expected), selector);
    assert.equal(
      await target.getAttribute("contenteditable"),
      "true",
      `Report ${selector} must enter editing directly from View mode`,
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await page.locator(".report-disclosure").dblclick();
  await page.waitForFunction(() => document.activeElement?.closest(".report-disclosure") != null);
  assert.equal(await page.locator('.report-disclosure [contenteditable="true"]').count(), 1,
    "Source disclosure should enter its shared rich-text editor directly from View mode");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  assert.equal(await heading.getAttribute("contenteditable"), "true");
  assert.equal(
    await heading.getAttribute("data-inline-editable"),
    null,
    "Report headings must persist only through the shared artifact-title state",
  );
  const reportHeadingGeometry = await heading.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      editor: element.getBoundingClientRect().width,
      text: range.getBoundingClientRect().width,
    };
  });
  assert.ok(
    reportHeadingGeometry.editor <= reportHeadingGeometry.text + 16,
    `The report-heading editor should fit its text instead of stretching across the editorial column: ${JSON.stringify(
      reportHeadingGeometry,
    )}`,
  );
  const summaryHeading = summarySection.locator(".report-rich-editable h2");
  assert.equal(await summaryHeading.innerText(), initialSummaryHeading,
    "The authored summary heading must live inside its editable Markdown narrative");
  assert.equal(await summaryHeading.evaluate((element) => element.parentElement.isContentEditable), true,
    "Report owners must be free to rename an authored summary heading in the same Markdown block");
  assert.equal(await summarySection.locator(".component-title-text").count(), 0,
    "Report text blocks must not render a separate title editing region");
  await summarySection.locator(":scope > .component-header").hover();
  await summarySection.getByRole("button", { name: /actions$/u }).click();
  assert.equal(
    await page.getByRole("menuitem", { name: "Hide", exact: true }).count(),
    1,
    "An authored summary can be hidden like any other section",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator('.dashboard-tabs-collapse[aria-hidden="false"]').count(),
    0,
    "Reports must not display dashboard tabs in edit mode",
  );
  for (const selector of ['[data-component-id="report-metric-active"] .component-title-text']) {
    const item = page.locator(selector).first();
    assert.equal(
      await item.getAttribute("contenteditable"),
      "true",
      `Authored report ${selector} text must remain editable`,
    );
  }
  for (const selector of [".report-summary-lead", ".report-analysis", ".report-caveat", ".report-disclosure"]) {
    const prose = page.locator(selector).first();
    assert.notEqual(await prose.getAttribute("data-rich-narrative"), null,
      `Report ${selector} prose must use the shared rich-text editor`);
    assert.equal(await prose.locator('[contenteditable="true"]').count(), 1,
      `Report ${selector} prose must expose the shared owner-only Lexical editing surface`);
  }
  const metricValue = page.locator(".report-facts .data-metric-value").first();
  assert.notEqual(
    await metricValue.getAttribute("contenteditable"),
    "true",
    "Reviewed report metric values must remain read-only",
  );
  const metricLabel = page.locator('[data-component-id="report-metric-active"] .component-title-text');
  await metricLabel.fill("Latest reviewed accounts");
  await metricLabel.blur();
  const disclosure = page.locator('.report-disclosure [contenteditable="true"]').first();
  await disclosure.fill("Sources: customer-approved operating datasets");
  await disclosure.blur();
  await summaryHeading.fill("Operating summary");
  await summaryHeading.blur();
  await saveReportEdits(page);
  await page.waitForFunction(() =>
    Object.values(localStorage).some(
      (value) =>
        value.includes("Latest reviewed accounts") &&
        value.includes("customer-approved operating datasets") &&
        value.includes("Operating summary"),
    ),
  );
  const savedTextEdits = await page.evaluate(
    () =>
      Object.values(localStorage)
        .map((value) => JSON.parse(value))
        .find((record) => record.presentation?.textEdits)?.presentation.textEdits,
  );
  const savedComponentTitles = await page.evaluate(() => Object.values(localStorage)
    .map((value) => JSON.parse(value)).find((record) => record.presentation)?.presentation.componentTitles);
  assert.equal(savedComponentTitles["report-metric-active"], "Latest reviewed accounts",
    "Public MetricCard titles must persist under their stable component identities");
  assert.equal(
    savedTextEdits["report:disclosure"],
    "Sources: customer-approved operating datasets",
    "Report source wording must persist under a stable semantic identifier",
  );
  await summarySection.locator(":scope > .component-header").hover();
  await summarySection.getByRole("button", { name: /actions$/u }).click();
  await page.getByRole("menuitem", { name: "View data source" }).click();
  await page.getByRole("tab", { name: "Data preview" }).click();
  const reviewedActiveUsers = snapshot.queries.usage_summary.rows.reduce(
    (latest, row) => (!latest || row.week > latest.week ? row : latest),
    undefined,
  ).activeUsers;
  await page.getByRole("tabpanel", { name: "Data preview" })
    .getByRole("textbox", { name: "Search data" }).fill(String(reviewedActiveUsers));
  assert.ok(
    (await page.getByRole("complementary", { name: /Data source for/u }).innerText()).includes(
      new Intl.NumberFormat().format(reviewedActiveUsers),
    ),
    "Editing presentation copy must not change underlying reviewed source rows",
  );
  await page.getByRole("button", { name: "Close data source" }).last().click();
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  const narrative = page.locator('[data-editable-id="report:description"] [contenteditable="true"]');
  assert.ok(await narrative.count(), "Report narrative must inherit shared rich editing");
  await narrative.fill("Updated report narrative");
  await narrative.blur();
  await saveReportEdits(page);
  await page.waitForFunction(() =>
    Object.values(localStorage).some((value) => value.includes("Updated report narrative")),
  );
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  await heading.fill("Revised protected report");
  await heading.blur();
  await page.waitForFunction(
    () => document.querySelector(".dashboard-topbar-title")?.textContent === "Revised protected report",
  );
  assert.equal(await page.locator(".markdown-editor, .markdown-editable").count(), 0);
  for (const action of ["Save", "Cancel"]) {
    assert.equal(await page.locator(".dashboard-topbar").getByRole("button", { name: action, exact: true }).count(), 1);
    assert.equal(await page.locator("main").getByRole("button", { name: action, exact: true }).count(), 0,
      "Report prose must not add duplicate Save/Cancel controls alongside the shared edit session");
  }

  const borders = await page
    .locator(".report-methods")
    .evaluateAll((components) => components.map((component) => getComputedStyle(component).borderTopWidth));
  assert.ok(
    borders.every((border) => border === "2px"),
    `Authored evidence treatment must remain possible: ${JSON.stringify(borders)}`,
  );

  const formattedNarrative = page.locator(".report-summary-lead");
  const summaryEditor = formattedNarrative.locator('[contenteditable="true"]');
  const emphasizedText = await formattedNarrative.locator("strong").first().innerText();
  assert.ok(emphasizedText.length > 0, "The example includes useful authored emphasis");
  const revisedNarrative = `${await formattedNarrative.innerText()} Keep activation on track.`;
  await summaryEditor.locator("p strong").first().selectText();
  await page.getByRole("toolbar", { name: "Format selected text" }).waitFor();
  await page.keyboard.press("Escape");
  await summaryEditor.evaluate((element) => {
    element.focus();
    const selection = window.getSelection();
    selection.selectAllChildren(element);
    selection.collapseToEnd();
  });
  await summaryEditor.pressSequentially(" Keep activation on track.");
  await summaryEditor.blur();
  assert.equal(
    await formattedNarrative.locator("strong").first().innerText(),
    emphasizedText,
    "Saving narrative should restore authored inline emphasis immediately",
  );
  await saveReportEdits(page);
  await page.waitForFunction(
    (emphasis) => Object.values(localStorage).some((record) =>
      record.includes(`**${emphasis}**`) && record.includes("Keep activation on track.")), emphasizedText,
  );
  await page.reload();
  await page.locator(".report-summary-lead").waitFor();
  assert.equal(
    await page.locator(".report-summary-lead").innerText(),
    revisedNarrative,
    "Edited report narrative should remain saved after reload",
  );
  assert.equal(
    await page.locator(".report-summary-lead strong").first().innerText(),
    emphasizedText,
    "Reloading saved narrative must preserve authored inline emphasis",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise((next) => requestAnimationFrame(() => requestAnimationFrame(next))));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 2, `Report overflows narrow viewport by ${overflow}px`);

  // Exercise the compiled starter with incomplete reviewed snapshots. A pure copy
  // helper test cannot catch rendering, scoping, or chart errors in these states.
  const edgePage = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  edgePage.on("pageerror", (error) => errors.push(error.message));
  await edgePage.addInitScript(() => {
    window.__reportPdfHandoffs = [];
    window.__reportPrints = 0;
    window.__reportPrompts = [];
    document.addEventListener("click", event => {
      const link = event.target.closest('a[href^="codex://"]');
      if (!link || event.defaultPrevented) return;
      window.__reportPdfHandoffs.push({
        href: link.href, connected: link.isConnected, trusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented, target: link.target,
      });
      event.preventDefault();
    });
    window.print = () => { window.__reportPrints += 1; };
    window.openai = { sendFollowUpMessage: async message => { window.__reportPrompts.push(message); } };
  });
  let edgeSnapshot;
  const edgeWrites = [];
  await edgePage.route("https://report-edge.chatgpt.site/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() !== "GET") edgeWrites.push({ pathname, method: route.request().method() });
    const value = pathname === "/api/snapshot" ? edgeSnapshot
      : pathname === "/api/presentation" ? { canEdit: false, revision: 0, presentation: {} } : undefined;
    await route.fulfill(value ? { contentType: "application/json", body: JSON.stringify(value) }
      : { contentType: "text/html", body: compiledHtml });
  });
  const prior = { week: "2026-07-20", segment: "all", region: "all", activeUsers: 11970, targetUsers: 11600, conversion: .318 };
  const current = { week: "2026-07-27", segment: "all", region: "all", activeUsers: 12480, targetUsers: 12000, conversion: .324 };
  const without = (row, field) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== field));
  const reviewedDrivers = snapshot.queries.growth_drivers.rows;
  const reviewedSegments = snapshot.queries.segment_usage.rows;
  const edgeCases = [
    { name: "missing-current-active", rows: [prior, without(current, "activeUsers")],
      title: "Active accounts are unavailable", facts: ["Unavailable", "32.4%"], delta: "+0.6 pp", bridge: false },
    { name: "null-current-active", rows: [prior, { ...current, activeUsers: null }],
      title: "Active accounts are unavailable", facts: ["Unavailable", "32.4%"], delta: "+0.6 pp", bridge: false },
    { name: "null-previous-active", rows: [{ ...prior, activeUsers: null }, current],
      title: "Active accounts are above plan", facts: ["12,480", "32.4%"], delta: "+0.6 pp", bridge: false },
    { name: "missing-current-conversion", rows: [prior, without(current, "conversion")],
      title: "Active accounts are above plan", facts: ["12,480", "Unavailable"], delta: "", bridge: true },
    { name: "null-current-conversion", rows: [prior, { ...current, conversion: null }],
      title: "Active accounts are above plan", facts: ["12,480", "Unavailable"], delta: "", bridge: true },
    { name: "null-previous-conversion", rows: [{ ...prior, conversion: null }, current],
      title: "Active accounts are above plan", facts: ["12,480", "32.4%"], delta: "", bridge: true },
    { name: "one-period", rows: [current],
      title: "Active accounts are above plan", facts: ["12,480", "32.4%"], delta: "", bridge: false },
    { name: "no-periods", rows: [], title: "Active accounts are unavailable",
      facts: ["Unavailable", "Unavailable"], delta: "", bridge: false },
    { name: "missing-drivers", rows: [prior, current], driverRows: [],
      title: "Active accounts are above plan", facts: ["12,480", "32.4%"], delta: "+0.6 pp", bridge: false },
    { name: "non-reconciling-drivers", rows: [prior, current], driverRows: reviewedDrivers.map((row) =>
      row.week === current.week && row.driver === "Churn" ? { ...row, change: -164 } : row),
      title: "Active accounts are above plan", facts: ["12,480", "32.4%"], delta: "+0.6 pp", bridge: false },
    { name: "null-driver", rows: [prior, current], driverRows: reviewedDrivers.map((row) =>
      row.week === current.week && row.driver === "Activation" ? { ...row, change: null } : row),
      title: "Active accounts are above plan", facts: ["12,480", "32.4%"], delta: "+0.6 pp", bridge: false },
    { name: "missing-segment", rows: [prior, current], segmentRows: reviewedSegments.filter((row) => row.segment !== "Search"),
      title: "Active accounts are above plan", facts: ["12,480", "32.4%"], delta: "+0.6 pp", bridge: true,
      attention: /Resolve the coverage gap/u },
    { name: "tied-segments", rows: [prior, current], segmentRows: reviewedSegments.map((row) =>
      row.segment === "Search" ? { ...row, retention: .91 } : row),
      title: "Active accounts are above plan", facts: ["12,480", "32.4%"], delta: "+0.6 pp", bridge: true,
      attention: /Several segments share the lowest retention/u },
  ];
  for (const scenario of edgeCases) {
    edgeSnapshot = { ...snapshot, id: `report-edge-${scenario.name}`, queries: {
      ...snapshot.queries, usage_summary: { ...snapshot.queries.usage_summary, rows: scenario.rows },
      growth_drivers: { ...snapshot.queries.growth_drivers, rows: scenario.driverRows ?? reviewedDrivers },
      segment_usage: { ...snapshot.queries.segment_usage, rows: scenario.segmentRows ?? reviewedSegments },
    } };
    await edgePage.goto(`https://report-edge.chatgpt.site/${scenario.name}`, { waitUntil: "load" });
    const summary = edgePage.locator('[data-component-id="report-summary"]');
    await summary.getByRole("heading", { name: scenario.title, exact: true }).waitFor();
    assert.deepEqual(await edgePage.locator(".report-facts .data-metric-value").allInnerTexts(), scenario.facts, scenario.name);
    const conversionMetric = edgePage.locator('[data-component-id="report-metric-conversion"]');
    assert.equal((await conversionMetric.locator(".data-metric-delta").allInnerTexts()).join(""), scenario.delta, scenario.name);
    const copy = `${await summary.innerText()} ${await edgePage.locator(".report-caveat").innerText()} `
      + await edgePage.locator(".report-analysis").innerText();
    assert.doesNotMatch(copy, /NaN|undefined/u, `${scenario.name} must not manufacture missing values`);
    assert.equal(await edgePage.locator('[data-component-id="report-trend"]').count(), scenario.bridge ? 1 : 0,
      `${scenario.name}: only a reconciled bridge can be charted`);
    if (!scenario.bridge) assert.match(await edgePage.locator(".report-analysis").innerText(), /do not reconcile/u);
    if (scenario.attention) {
      assert.match(await edgePage.locator(".report-caveat").innerText(), scenario.attention);
      const methods = edgePage.locator('[data-component-id="report-methods"]');
      await methods.locator(":scope > .component-header").hover();
      await methods.getByRole("button", { name: /actions$/u }).click();
      await edgePage.getByRole("menuitem", { name: "View data source", exact: true }).click();
      const source = edgePage.getByRole("complementary", { name: /Data source for/u });
      await source.getByRole("tab", { name: "Overview", exact: true }).waitFor();
      assert.equal(await source.getByRole("button", { name: "Choose reviewed data source" }).count(), 0,
        "No named-account source is attached without a defensible priority");
      await source.getByRole("button", { name: "Close data source", exact: true }).click();
      await source.waitFor({ state: "hidden" });
    }
    if (scenario.name === "one-period" || scenario.name === "null-previous-active") {
      assert.match(await summary.innerText(), /No comparable earlier total is available/u);
      assert.equal(await edgePage.locator('[data-component-id="report-metric-active"] .data-metric-delta').count(), 0);
    }
    assert.equal(await edgePage.getByRole("button", { name: "Edit text and layout", exact: true }).count(), 0);
    assert.equal(await edgePage.locator('[contenteditable="true"]').count(), 0);
  }
  await selectConversion(edgePage, "PDF");
  const hostedReportPdf = await chooseHostedHandoff(edgePage, "desktop");
  const expectedReportView = "https://report-edge.chatgpt.site/tied-segments?view=1";
  assert.equal(`${hostedReportPdf.protocol}//${hostedReportPdf.host}${hostedReportPdf.pathname}`, "codex://new");
  assert.equal(hostedReportPdf.searchParams.get("browserUrl"), expectedReportView);
  const hostedReportPdfPrompt = hostedReportPdf.searchParams.get("prompt");
  assert.match(hostedReportPdfPrompt, /\$data-analytics:report-to-pdf\b/u);
  assert.ok(hostedReportPdfPrompt.includes(`](<${expectedReportView}>)`));
  assert.match(hostedReportPdfPrompt, /Include reader-visible evidence; omit controls, editor-only and hidden content/u);
  assert.doesNotMatch(hostedReportPdfPrompt, /entire dashboard/u);
  assert.deepEqual(await edgePage.evaluate(() => window.__reportPdfHandoffs), [{
    href: hostedReportPdf.href, connected: true, trusted: true, defaultPrevented: false, target: "_self",
  }]);
  assert.equal(await edgePage.evaluate(() => window.__reportPrints), 0);
  assert.deepEqual(await edgePage.evaluate(() => window.__reportPrompts), []);
  assert.deepEqual(edgeWrites, [], "Rendering incomplete snapshots as a hosted viewer must not mutate data");
  await edgePage.close();
  assert.deepEqual(errors, [], "Report browser runtime emitted errors");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        components: await page.locator("[data-component-id]").count(),
        interactions: [
          "protected top bar",
          "optional, custom-titled summary",
          "editorial width",
          "component menus",
          "source tabs",
          "scoped metric, growth, and segment definitions",
          "chart editing",
          "theme switching",
          "plain snapshot date without report refresh",
          "export handoff",
          "publishing handoff",
          "inline title editing",
          "inline narrative editing",
          "editable metric labels with source-backed values",
          "editable source appendix",
          "editable authored-summary title",
          "unchanged reviewed source rows",
          "explicit Save persistence",
          "persistent authored inline emphasis",
          "no duplicate Save/Cancel",
          "authored evidence containers",
          "no dashboard scheduling, duplication, tabs, or grid",
          "mobile",
          "missing and single-period reviewed values",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  rmSync(project, { recursive: true, force: true });
}
