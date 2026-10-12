import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { renderInlineSources } from "../skills/visualize-data/scripts/render-inline-sources.mjs";

// Seek the real CSS transition instead of relying on CI rendering a frame
// inside its short wall-clock duration. Measurements still come from the DOM.
function armReceiptTransition(element, { targetSelector, attributeSelector, property, measure }) {
  const scope = element.shadowRoot ?? element;
  const target = scope.querySelector(targetSelector);
  const attributeTarget = attributeSelector ? scope.querySelector(attributeSelector) : element;
  const readValue = () => {
    if (measure === "height") return target.getBoundingClientRect().height;
    const transform = getComputedStyle(target).transform;
    const matrix = new DOMMatrixReadOnly(transform === "none" ? undefined : transform);
    return Math.abs(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
  };
  element.receiptMotionElement ??= target;
  readValue();
  element.receiptMotion = new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      observer.disconnect();
      try {
        const transition = target.getAnimations().find((animation) => animation.transitionProperty === property);
        if (!transition) return resolve({ values: [readValue()], duration: 0 });
        const duration = Number(transition.effect.getComputedTiming().duration);
        transition.pause();
        // Reduced motion uses an effectively instant transition; check its endpoints.
        const checkpoints = duration <= 1 ? [0, 1] : [0, 0.25, 0.5, 0.75, 1];
        const values = checkpoints.map((progress) => {
          transition.currentTime = duration * progress;
          return readValue();
        });
        transition.finish();
        resolve({ values, duration });
      } catch (error) {
        reject(error);
      }
    });
    observer.observe(attributeTarget, { attributes: true, attributeFilter: ["data-open"] });
  });
}

export function createInlineSourcesBrowserCases({ pluginRoot, workspace, createPageScenario, tabLabels, generatedPayload }) {
  async function receiptFixture(name, { multiple = false, shortOverview = false } = {}) {
    const input = JSON.parse(await readFile(join(pluginRoot, "skills/visualize-data/assets/inline-sources-example.json"), "utf8"));
    input.items[0].queries[0].sourceRoles = [{ kind: "file", label: "sample-activation.csv",
      role: "Supplies the eligible and activated counts used in this calculation." }];
    input.items[0].queries[0].source.tables = [{ name: "analytics.product_adoption_summary", trust: {
      provider: "Snowflake", queryCount: 8967, uniqueUsers: 207, windowDays: 30,
      usageAsOf: "2026-09-04T12:00:00.000Z", lastQueriedAt: "2026-09-03T12:00:00.000Z",
      usageNote: "Successful queries, including reads through views.",
    } }];
    input.items[0].queries[0].source.filters.push("Eligibility: Active accounts in the same seven-day window, including all supported product experiences without summing overlapping source groups.");
    input.items[0].queries[0].source.metricDefinitions.push({ label: "Eligible accounts",
      definition: "Accounts that had access to setup during the reporting week." });
    if (multiple) {
      input.items[0].queries.push({ id: "python-export", source: { label: "CSV calculation", files: [{ label: "sample.csv" }], sql: "SELECT period, value FROM sample_csv;" },
        methods: [{ language: "python", code: "rate = activated / eligible\nchange = rate[-1] - rate[0]" }],
        columns: ["period", "value"], rows: Array.from({ length: 117 }, (_, index) => ({ period: `Week ${index + 1}`, value: index })),
        preview: { kind: "partial", note: "First 117 recorded rows.", totalRows: 130 } });
      input.items.push({ id: "release-context", title: "What changed in the release?", queries: [{ id: "release-note",
        summary: "The note records a setup change, not its effect on activation.",
        source: { label: "Synthetic release note", links: [{ label: "Release note", href: "https://example.com/releases" }] } }] });
    }
    if (shortOverview) {
      const finding = input.items[0];
      finding.assumptions = [];
      const query = finding.queries[0];
      query.summary = "A comparison of the two supplied weeks.";
      query.source.metricDefinitions = [];
      query.source.filters = [];
      query.source.caveats = [];
    }
    const metadata = await renderInlineSources({ input, output: join(workspace, `${name}.html`) });
    return { name, metadata, fragment: await readFile(metadata.path, "utf8"), root: `#${metadata.rootId}` };
  }

  async function inspectSourcesReceipt(browser, fixture, preview, { multiple, ...options }) {
    const scenario = await createPageScenario(browser, preview, { height: 700, ...options });
    try {
      const { page } = scenario;
      assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
      await page.locator("iframe").evaluate((el) => {
        const following = document.createElement("p");
        following.id = "following-conversation";
        following.textContent = "Conversation continues below Sources.";
        el.after(following);
      });
      const root = page.frameLocator("iframe").locator(fixture.root);
      const summary = multiple ? "Sources • 2" : "Sources";
      const toggle = root.getByRole("button", { name: summary, exact: true });
      await toggle.waitFor({ state: "visible" });
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      const label = toggle.locator(":scope > span").first();
      assert.equal(await label.innerText(), summary, "The disclosure labels its finding cards as before");
      const labelStyle = await label.evaluate((el) => ({
        color: getComputedStyle(el).color, weight: getComputedStyle(el).fontWeight,
        background: getComputedStyle(el).backgroundColor,
      }));
      assert.deepEqual(labelStyle, {
        color: await toggle.evaluate((el) => getComputedStyle(el).color), weight: "400",
        background: "rgba(0, 0, 0, 0)",
      }, "The original disclosure text inherits the neutral button style");
      const resting = await toggle.evaluate((el) => ({
        background: getComputedStyle(el).backgroundColor,
        left: el.getBoundingClientRect().left,
        parentLeft: el.closest(".sources-receipt").getBoundingClientRect().left,
      }));
      assert.ok(Math.abs(resting.left - resting.parentLeft) <= 1, "Sources aligns with the receipt's left edge");
      await toggle.hover();
      const hovering = await toggle.evaluate(async (el) => {
        await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {})));
        return { background: getComputedStyle(el).backgroundColor, opacity: Number(getComputedStyle(el).opacity) };
      });
      assert.equal(hovering.background, resting.background, "Hover does not add a background highlight");
      assert.ok(hovering.opacity < 1 && hovering.opacity > .6, "Hover highlights Sources through opacity");
      await page.mouse.move(0, 0);
      await root.evaluate(armReceiptTransition, {
        targetSelector: ".receipt-expander", attributeSelector: ".receipt-expander",
        property: "grid-template-rows", measure: "height",
      });
      await toggle.click();
      const focusStyle = (element) => element.evaluate((el) => ({
        focused: el.matches(":focus"),
        outline: getComputedStyle(el).outlineStyle,
        cardOutline: getComputedStyle(el, "::after").outlineStyle,
      }));
      assert.equal((await focusStyle(toggle)).outline, "none", "Clicking Sources must not show a keyboard focus ring");
      const motion = await root.evaluate(async (el) => {
        const result = await el.receiptMotion;
        await Promise.all(el.shadowRoot.querySelector(".receipt-expander").getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})));
        return result;
      });
      const heights = motion.values;
      const finalHeight = heights.at(-1);
      if (options.reducedMotion !== "reduce") {
        assert.ok(motion.duration > 0, "Disclosure must create a real layout transition");
        assert.ok(heights.some((height) => height > 1 && height < finalHeight - 1), "Disclosure must interpolate its layout height");
      } else {
        assert.ok(motion.duration <= 1, "Reduced motion must settle within one millisecond");
        assert.ok(heights.every((height) => height < 1 || Math.abs(height - finalHeight) <= 1),
          `Reduced motion must settle without intermediate layouts: ${JSON.stringify(heights)}`);
      }
      // Model entering the sandboxed receipt after Tab began in its parent: the
      // receipt sees the new focus and keyup, but not the parent's keydown.
      await toggle.focus();
      await toggle.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keyup", { key: "Tab", bubbles: true, composed: true })));
      assert.equal((await focusStyle(toggle)).outline, "solid", "Tab entry from the host restores keyboard focus styling");
      const card = root.getByRole("article", { name: "How did activation change?", exact: true });
      assert.equal(await card.evaluate((el) => getComputedStyle(el).boxShadow), "none",
        "The Sources card border must not rely on a shadow that clips in the expanding container");
      if (multiple) {
        assert.equal(await card.getAttribute("data-open"), "false");
        const sampleChevron = async () => card.evaluate(armReceiptTransition, {
          targetSelector: '.receipt-card-toggle [data-dashboard-icon="chevronDown"]',
          property: "transform", measure: "angle",
        });
        const verifyChevron = async (expanded) => {
          const result = await card.evaluate(async (el) => {
            const motion = await el.receiptMotion;
            await Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
            return { angles: motion.values, duration: motion.duration,
              sameNode: el.receiptMotionElement === el.querySelector('.receipt-card-toggle [data-dashboard-icon="chevronDown"]') };
          });
          assert.equal(result.sameNode, true, "Expand/collapse must rotate the existing chevron rather than replace it");
          assert.ok(Math.abs(result.angles.at(-1) - (expanded ? 180 : 0)) < 1);
          if (options.reducedMotion !== "reduce") {
            assert.ok(result.duration > 0, "The chevron must create a real transform transition");
            assert.ok(result.angles.some((angle) => angle > 1 && angle < 179), "The chevron must interpolate its rotation");
          } else {
            assert.ok(result.duration <= 1, "Reduced motion must settle within one millisecond");
            assert.ok(result.angles.every((angle) => angle < 1 || angle > 179));
          }
        };
        for (const edge of ["left", "right", "top", "bottom"]) {
          const bounds = await card.boundingBox();
          const position = { x: edge === "left" ? 2 : edge === "right" ? bounds.width - 2 : bounds.width / 2,
            y: edge === "top" ? 2 : edge === "bottom" ? bounds.height - 2 : bounds.height / 2 };
          await sampleChevron();
          await card.click({ position });
          assert.equal(await card.getAttribute("data-open"), "true", `Clicking the ${edge} card padding must expand it`);
          assert.equal(await card.evaluate((el) => getComputedStyle(el).boxShadow), "none",
            "Expanded Sources cards retain a clean border without a clipped shadow");
          await verifyChevron(true);
          await sampleChevron();
          await card.getByRole("button", { name: "Collapse How did activation change?", exact: true }).click();
          assert.equal(await card.getAttribute("data-open"), "false");
          await verifyChevron(false);
          const collapsedFocus = await focusStyle(card.getByRole("button", { name: "How did activation change?", exact: true }));
          assert.equal(collapsedFocus.outline, "none");
          assert.equal(collapsedFocus.cardOutline, "none", "Pointer collapse must not leave the full-card keyboard ring");
        }
        await card.getByRole("button", { name: "How did activation change?", exact: true }).press("Enter");
        assert.equal(await card.getAttribute("data-open"), "true");
        await card.getByRole("button", { name: "Collapse How did activation change?", exact: true }).press("Tab");
        assert.equal(await card.evaluate((el) => el.getRootNode().activeElement?.getAttribute("role")), "tab",
          "Tab from the expanded toggle must enter this card's content, not skip to the next card");
        await card.getByRole("tab", { name: "Overview", exact: true }).press("Shift+Tab");
        await card.getByRole("button", { name: "Collapse How did activation change?", exact: true }).press("Escape");
        assert.equal(await card.getAttribute("data-open"), "false");
        assert.equal(await toggle.getAttribute("aria-expanded"), "true", "Escape from the persistent toggle closes its card first");
        assert.equal((await focusStyle(card.getByRole("button", { name: "How did activation change?", exact: true }))).cardOutline,
          "solid", "Keyboard Escape restores visible focus to the collapsed card");
        await card.getByRole("button", { name: "How did activation change?", exact: true }).click();
      } else assert.equal(await card.getByRole("button", { name: /Collapse/ }).count(), 0);
      await card.evaluate(async (el) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
      });
      assert.equal(await card.locator(".receipt-details").count(), 0, "Overview has no secondary Details disclosure");
      const overviewLayout = await card.locator(".receipt-overview").first().evaluate((el) => {
        const definition = el.querySelector(".receipt-definitions");
        return { order: [...el.children].slice(0, 4).map((child) => child.className),
          background: getComputedStyle(definition).backgroundColor,
          overviewBackground: getComputedStyle(el).backgroundColor,
          padding: getComputedStyle(definition).paddingLeft,
          left: definition.getBoundingClientRect().left,
          overviewLeft: el.getBoundingClientRect().left,
          labelCount: definition.querySelectorAll(".source-label").length };
      });
      assert.deepEqual(overviewLayout.order, ["receipt-definitions", "source-group receipt-qualifications", "source-group"]);
      assert.equal(overviewLayout.background, overviewLayout.overviewBackground, "Definitions have no separate surface");
      assert.equal(overviewLayout.padding, "0px");
      assert.ok(Math.abs(overviewLayout.left - overviewLayout.overviewLeft) <= 1);
      assert.equal(overviewLayout.labelCount, 1, "Definitions use the same quiet heading as neighboring sections");
      assert.equal(await card.locator(".receipt-definitions .source-label").innerText(), "Definitions");
      assert.deepEqual(await card.locator(".receipt-definition-entry > p").allTextContents(), [
        "Activation rate is the share of eligible accounts that completed setup during the week.",
        "Eligible accounts: Accounts that had access to setup during the reporting week.",
      ], "Every definition names its term, including when the sentence does not repeat its label");
      assert.ok(await card.locator(".receipt-definition-list li").evaluateAll((entries) =>
        entries.length === 2 && entries.every((el) => getComputedStyle(el).display === "list-item"
          && getComputedStyle(el).listStyleType === "disc"
          && getComputedStyle(el).borderTopWidth === "0px"
          && getComputedStyle(el, "::marker").color === getComputedStyle(el).color)),
      "Definitions use text-colored bullets without per-entry dividers");
      assert.equal(await card.locator(".receipt-definition-entry .receipt-definition-metadata").count(), 0,
        "The example omits calculation detail that restates its definition");
      assert.equal(await card.locator(".receipt-definition-list").evaluate((el) => getComputedStyle(el).rowGap),
        "4px", "Definition bullets have the requested spacing");
      assert.equal(await card.locator(".receipt-definitions strong").first().evaluate((el) => getComputedStyle(el).fontWeight),
        "600", "Definition terms remain semibold");
      const qualifications = card.locator(".receipt-qualifications");
      assert.equal(await qualifications.locator(".source-label").innerText(), "Assumptions and caveats");
      assert.deepEqual(await qualifications.evaluate((el) => ({ border: getComputedStyle(el).borderTopWidth,
        padding: getComputedStyle(el).paddingTop })), { border: "0px", padding: "0px" },
      "Section boundaries remain free of an extra divider");
      assert.deepEqual(await qualifications.locator(".receipt-qualification-list li").allTextContents(),
        ["The two supplied weeks use the same activation definition.",
          "Synthetic example; no external source was queried."]);
      assert.equal(await qualifications.locator(".receipt-qualification-list").evaluate((el) => getComputedStyle(el).rowGap),
        "4px", "Assumption and caveat bullets have the requested spacing");
      assert.deepEqual(await qualifications.locator(".receipt-qualification-list li").first().evaluate((el) => ({
        display: getComputedStyle(el).display, marker: getComputedStyle(el).listStyleType,
      })), { display: "list-item", marker: "disc" }, "Each qualification keeps a visible list marker");
      assert.equal(await qualifications.locator(".receipt-qualification-list li").first().evaluate((el) => ({
        marker: getComputedStyle(el, "::marker").color, text: getComputedStyle(el).color,
      })).then(({ marker, text }) => marker === text), true, "The bullet and its text use the same color");
      const settlePanel = async () => {
        const panel = await card.evaluate(async (el) => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
          const panels = el.querySelector(".receipt-panels");
          const active = panels.querySelector('[role="tabpanel"]:not([hidden])');
          return { container: panels.getBoundingClientRect().height, content: active.getBoundingClientRect().height,
            contentScrollHeight: active.scrollHeight, contentClientHeight: active.clientHeight,
            card: el.getBoundingClientRect().height, anchored: panels.hasAttribute("data-anchored"),
            lineHeight: parseFloat(getComputedStyle(panels).lineHeight) };
        });
        const host = await page.evaluate(async () => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const frame = document.querySelector("iframe").getBoundingClientRect();
          return { frame: frame.height, frameBottom: frame.bottom,
            following: document.getElementById("following-conversation").getBoundingClientRect().top,
            scroll: window.scrollY };
        });
        return { ...panel, ...host };
      };
      const overviewSize = await settlePanel();
      const assertVisiblePanel = async (action) => {
        const actual = await settlePanel();
        assert.ok(Math.abs(actual.container - actual.content) <= 1,
          `${action} must size the active panel to its container: ${JSON.stringify(actual)}`);
        assert.ok(actual.following >= actual.frameBottom - 1,
          `${action} must leave following conversation below the iframe: ${JSON.stringify(actual)}`);
        return actual;
      };
      assert.equal(overviewSize.anchored, false, "Overview retains its natural height without blank space");
      assert.ok(overviewSize.contentScrollHeight <= overviewSize.contentClientHeight + 1);
      const assertAnchoredPanel = async (action, baseline) => {
        const actual = await assertVisiblePanel(action);
        assert.equal(actual.anchored, true, `${action} must use the measured Overview anchor`);
        if (options.width <= 440) {
          assert.ok(actual.contentScrollHeight <= actual.contentClientHeight + 1,
            `${action} must grow naturally on mobile without trapping content`);
          return actual;
        }
        for (const key of ["container", "card", "frame"]) {
          assert.ok(Math.abs(actual[key] - baseline[key]) <= 1,
            `${action} must preserve ${key}: ${JSON.stringify({ baseline, actual })}`);
        }
        assert.ok(Math.abs(actual.following + actual.scroll - baseline.following - baseline.scroll) <= 1,
          `${action} must preserve the following conversation's document position`);
        return actual;
      };
      assert.equal(await card.locator(".receipt-overview .receipt-filters").count(), 0);
      const usageSource = card.locator('.receipt-overview .source-row[data-source-kind="table"]');
      assert.equal(await usageSource.locator(".source-trust").innerText(),
        "Table · Snowflake · 207 users · 8,967 queries over 30 days ending Sep 4, 2026 · Last queried Sep 3, 2026",
        "Warehouse usage must survive receipt generation and retain its observation window and last query date");
      assert.equal(await usageSource.locator(".source-usage-note").innerText(),
        "Successful queries, including reads through views.");
      const fileSource = card.locator('.receipt-overview .source-row[data-source-title="sample-activation.csv"]');
      assert.equal(await fileSource.locator(".source-trust").innerText(), "File",
        "A file must not inherit usage from the neighboring warehouse table");
      assert.equal(await fileSource.locator(".source-usage-note").count(), 0);
      const regularFont = await card.evaluate((el) => getComputedStyle(el).fontFamily);
      const sourceFonts = await card.locator(".receipt-overview .source-row-title").evaluateAll((elements) =>
        elements.map((el) => getComputedStyle(el).fontFamily));
      assert.ok(sourceFonts.length >= 2 && sourceFonts.every((font) => font === regularFont),
        "Table and file source names use the receipt's regular text font");
      assert.equal(await card.evaluate((el) => {
        const overview = el.querySelector(".receipt-overview");
        const box = overview.getBoundingClientRect();
        return [...overview.querySelectorAll("p, li, .source-row, .source-trust, .source-usage-note")].filter((entry) => entry.getClientRects().length).every((entry) => {
          const rect = entry.getBoundingClientRect();
          return rect.left >= box.left - 1 && rect.right <= box.right + 1 && entry.scrollWidth <= entry.clientWidth + 1;
        });
      }), true, "Long definitions, source labels, and warehouse usage wrap inside Overview");
      const sourceChip = fileSource;
      await sourceChip.scrollIntoViewIfNeeded();
      assert.equal(await sourceChip.evaluate((el) => getComputedStyle(el).cursor), "default",
        "Sources without a destination keep the default cursor");
      const restingSourceBackground = await sourceChip.evaluate((el) => getComputedStyle(el).backgroundColor);
      await sourceChip.hover();
      await sourceChip.evaluate(async (el) => Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))));
      const sourceHoverBackground = await sourceChip.evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.notEqual(sourceHoverBackground, restingSourceBackground,
        "A non-clickable source receives the same visible hover treatment as a link");
      await sourceChip.focus();
      const sourceTooltip = root.getByRole("tooltip");
      const iconParity = (chip) => chip.evaluate((el) => {
        const chipIcon = el.querySelector(".receipt-source-icon");
        const cardIcon = el.closest(".sources-receipt").querySelector(".receipt-tooltip .receipt-source-icon");
        const inspect = (icon) => {
          const style = getComputedStyle(icon);
          const rect = icon.getBoundingClientRect();
          return { kind: icon.dataset.sourceKind, variant: icon.dataset.sourceIcon,
            mask: style.maskImage, maskSize: style.maskSize,
            color: style.color, background: style.backgroundColor, width: rect.width, height: rect.height };
        };
        return { chip: inspect(chipIcon), card: inspect(cardIcon),
          wrapper: cardIcon.parentElement.getBoundingClientRect().toJSON() };
      });
      await sourceTooltip.waitFor({ state: "visible" });
      assert.equal(await sourceTooltip.locator(".source-preview-title").innerText(), await sourceChip.getAttribute("data-source-title"));
      assert.match(await sourceTooltip.locator(".source-preview-meta").innerText(), /File/u);
      assert.equal(await sourceTooltip.locator(".source-preview-summary").innerText(), await sourceChip.getAttribute("data-source-reason"));
      assert.deepEqual(await sourceTooltip.evaluate((el) => {
        const meta = el.querySelector(".source-preview-meta");
        const title = el.querySelector(".source-preview-title");
        const summary = el.querySelector(".source-preview-summary");
        return { padding: getComputedStyle(el).padding, iconGap: getComputedStyle(meta).gap,
          metaToTitle: Math.round(title.getBoundingClientRect().top - meta.getBoundingClientRect().bottom),
          titleToSummary: Math.round(summary.getBoundingClientRect().top - title.getBoundingClientRect().bottom) };
      }), { padding: "16px", iconGap: "6px", metaToTitle: 8, titleToSummary: 4 },
      "The receipt card uses the same tightened report spacing");
      const fileIcon = await iconParity(sourceChip);
      assert.deepEqual(fileIcon.card, fileIcon.chip, "The file card reuses the chip's exact icon mask and color");
      assert.equal(fileIcon.chip.variant, "file", "CSV inputs retain a generic file icon");
      assert.equal(fileIcon.card.maskSize, "contain", "The table/file icon keeps its native painted size");
      assert.deepEqual([fileIcon.card.width, fileIcon.card.height, fileIcon.wrapper.width, fileIcon.wrapper.height],
        [16, 16, 16, 16], "The card and chip icons occupy the same optical size");
      assert.deepEqual(await sourceTooltip.evaluate((el) => {
        const reference = el.ownerDocument.createElement("div");
        reference.className = "popover source-preview-card";
        el.parentElement.append(reference);
        const properties = ["display", "width", "padding", "borderWidth", "borderRadius", "backgroundColor",
          "boxShadow", "fontFamily", "fontSize", "lineHeight", "color"];
        const differences = properties.filter((property) =>
          getComputedStyle(el)[property] !== getComputedStyle(reference)[property]);
        reference.remove();
        return differences;
      }), [], "The receipt source card shares the report preview's computed styling");
      const tooltipBounds = await sourceTooltip.boundingBox();
      assert.ok(tooltipBounds.x >= 0 && tooltipBounds.width <= options.width,
        "Source inspection stays inside the narrow host");
      assert.equal(await sourceChip.evaluate((el) => {
        const next = el.closest(".receipt-overview").querySelector('.source-row[data-source-kind="table"]');
        el.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: next }));
        next.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", relatedTarget: el }));
        const tooltip = el.closest(".sources-receipt").querySelector(".receipt-tooltip");
        return !tooltip.hidden && tooltip.querySelector(".source-preview-title")?.textContent === next.dataset.sourceTitle;
      }), true, "An adjacent source replaces an already-open tooltip without another delay");
      const tableIcon = await iconParity(usageSource);
      assert.deepEqual(tableIcon.card, tableIcon.chip, "The adjacent table card retains its matching chip icon");
      assert.equal(tableIcon.chip.variant, "table");
      assert.notEqual(fileIcon.chip.mask, tableIcon.chip.mask, "Tables and files use distinct glyphs");
      assert.notEqual(fileIcon.chip.color, tableIcon.chip.color, "Tables and files use distinct colors");
      await sourceChip.press("Escape");
      await sourceTooltip.waitFor({ state: "hidden" });
      assert.equal(await toggle.getAttribute("aria-expanded"), "true", "Escape dismisses the tooltip before collapsing the receipt");
      assert.equal(await sourceChip.evaluate((el) => {
        el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
        return el.closest(".sources-receipt").querySelector(".receipt-tooltip").hidden;
      }), true, "A fresh hover starts with a delay when no tooltip is open");
      await sourceTooltip.waitFor({ state: "visible" });
      await sourceChip.press("Escape");
      await sourceTooltip.waitFor({ state: "hidden" });
      const overviewTab = card.getByRole("tab", { name: "Overview", exact: true });
      await overviewTab.focus();
      await page.mouse.move(0, 0);
      await sourceChip.hover();
      await overviewTab.press("Escape");
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert.equal(await sourceTooltip.isVisible(), false, "Escape cancels the initial delayed hover");
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      await card.getByRole("tab", { name: "SQL query", exact: true }).click();
      assert.equal((await focusStyle(card.getByRole("tab", { name: "SQL query", exact: true }))).outline, "none");
      const anchoredSize = await assertVisiblePanel("Switching to SQL query");
      assert.equal(anchoredSize.anchored, true);
      if (options.width <= 440) {
        assert.ok(anchoredSize.container < overviewSize.container,
          "Mobile SQL panels use their natural height without a blank Overview-sized gap");
      } else {
        assert.ok(anchoredSize.container >= overviewSize.container - 1);
        assert.ok(anchoredSize.container <= Math.max(overviewSize.container, 10 * overviewSize.lineHeight) + 2,
          "Only short Overviews receive a line-height-based reading floor");
      }
      const sqlPanel = card.getByRole("tabpanel", { name: "SQL query", exact: true });
      assert.equal(await sqlPanel.locator(".receipt-trace-chip").count(), 0,
        "Exact SQL is not preceded by a duplicate filter summary");
      const firstSql = multiple ? sqlPanel.getByRole("region", { name: "Illustrative activation export", exact: true }) : sqlPanel;
      assert.equal((await firstSql.locator("code").innerText()).replace(/^1\s*/u, ""),
        "SELECT week, activated, eligible FROM sample_activation ORDER BY week;");
      assert.deepEqual(await card.getByRole("tab").allTextContents(), tabLabels);
      assert.equal(await card.getByRole("button", { name: /^Source for /u }).count(), 0);
      assert.equal(await card.getByRole("button", { name: "Copy", exact: true }).count(), 0);
      await card.getByRole("tab", { name: "Data preview", exact: true }).click();
      await assertAnchoredPanel("Switching to Data preview", anchoredSize);
      await card.getByRole("tab", { name: "SQL query", exact: true }).click();
      await card.getByRole("tab", { name: "SQL query", exact: true }).press("ArrowRight");
      assert.equal(await card.getByRole("tab", { name: "Evidence flow", exact: true }).getAttribute("aria-selected"), "true");
      assert.deepEqual(await focusStyle(card.getByRole("tab", { name: "Evidence flow", exact: true })),
        { focused: true, outline: "solid", cardOutline: "none" }, "Arrow-key navigation must show keyboard focus");
      const evidencePanel = card.getByRole("tabpanel", { name: "Evidence flow", exact: true });
      await assertAnchoredPanel("Switching to Evidence flow with the keyboard", anchoredSize);
      assert.equal(await card.locator(".receipt-attribution").count(), 0, "Receipt prose does not append source-name annotations");
      await evidencePanel.locator('[data-checkpoint="filter"] summary').click();
      assert.equal(await evidencePanel.locator(".receipt-trace-chips").count(), 1,
        "Filters use one wrapping list without unexplained source sections");
      assert.equal(await evidencePanel.locator(":scope > :not(.source-trace)").count(), 0,
        "All supporting evidence belongs inside checkpoints");
      const filterTypography = await evidencePanel.locator(".receipt-trace-chip").evaluateAll((elements) => elements.map((el) => {
        const style = getComputedStyle(el);
        return { text: el.textContent, childCount: el.children.length,
          typography: [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.color] };
      }));
      const periodQuery = generatedPayload(fixture).items[0].queries[0];
      const periodScope = multiple ? `${periodQuery.source.label}: ` : "";
      assert.deepEqual(filterTypography.filter(({ text }) => text.includes("Reporting period = ")).map(({ text }) => text),
        [`${periodScope}Reporting period = ${periodQuery.reportingPeriod}`],
        "The reporting period appears once and retains its owning source in a multi-source card");
      assert.ok(filterTypography.every(({ childCount, typography }) => childCount === 0
        && JSON.stringify(typography) === JSON.stringify(filterTypography[0].typography)),
        "Reporting period and filters share typography without nested source attribution");
      assert.match(await evidencePanel.locator(".receipt-trace-chips").innerText(), /including all supported product experiences/u);
      assert.equal(await evidencePanel.locator(".receipt-trace-chips").evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll(".receipt-trace-chip")].every((entry) => {
          const rect = entry.getBoundingClientRect();
          return rect.left >= box.left - 1 && rect.right <= box.right + 1 && entry.scrollWidth <= entry.clientWidth + 1;
        });
      }), true, "The complete filter list wraps in Evidence flow");
      const detail = evidencePanel.locator('[data-checkpoint="source"] details');
      assert.equal(await detail.getAttribute("open"), null);
      await detail.locator("summary").click();
      assert.equal((await focusStyle(detail.locator("summary"))).outline, "none", "Pointer disclosure does not show a keyboard focus ring");
      assert.match(await detail.innerText(), /Supplies the eligible and activated counts/u);
      assert.doesNotMatch(await evidencePanel.innerText(), /Recorded inputs|Snapshot captured/u);
      const arithmetic = evidencePanel.locator("details").filter({ hasText: "240 / 400 × 100 = 60%" });
      await arithmetic.locator("summary").click();
      assert.equal(await arithmetic.locator(".receipt-calculation-text").last().innerText(), "240 / 400 × 100 = 60%\n280 / 400 × 100 = 70%\nChange: +10 percentage points");
      assert.equal(await arithmetic.locator(".receipt-trace-section-label").filter({ hasText: /^Calculation$/u }).count(), 0);
      const calculationTypography = await arithmetic.locator(".receipt-calculation-text").evaluateAll((elements) => elements.map((el) => {
        const style = getComputedStyle(el); return [style.fontFamily, style.fontSize, style.color, style.lineHeight];
      }));
      assert.ok(calculationTypography.every((value) => JSON.stringify(value) === JSON.stringify(calculationTypography[0])),
        "Supplemental formulas and worked arithmetic use the same body typography");
      await assertAnchoredPanel("Expanding evidence checkpoints", anchoredSize);
      if (multiple) {
        const python = evidencePanel.locator("details").filter({ hasText: "rate = activated / eligible" });
        assert.equal(await python.getAttribute("open"), "", "Python shares the already expanded Calculation checkpoint");
        assert.match(await python.locator(".receipt-method").last().innerText(), /rate = activated \/ eligible/u);
        await card.getByRole("tab", { name: "SQL query", exact: true }).click();
        assert.match(await sqlPanel.getByRole("region", { name: "CSV calculation", exact: true }).innerText(), /SELECT period, value FROM sample_csv/u);
        await card.getByRole("tab", { name: "Data preview", exact: true }).click();
        const dataPanel = card.getByRole("tabpanel", { name: "Data preview", exact: true });
        const csvData = dataPanel.getByRole("region", { name: "CSV calculation", exact: true });
        const longPreviewSize = await assertAnchoredPanel("Opening a long data preview", anchoredSize);
        if (options.width <= 440) {
          assert.ok(longPreviewSize.contentScrollHeight <= longPreviewSize.contentClientHeight + 1,
            "The long preview grows with the page on mobile");
        } else {
          assert.ok(longPreviewSize.contentScrollHeight > longPreviewSize.contentClientHeight + 100,
            "The long preview scrolls inside the Overview-sized tab area");
        }
        if (options.width === 736) {
          await page.setViewportSize({ width: 352, height: 700 });
          const resized = await assertVisiblePanel("Resizing with a long preview active");
          assert.equal(resized.anchored, true, "A width change must keep non-Overview tabs bounded");
          assert.ok(resized.contentScrollHeight <= resized.contentClientHeight + 1,
            "The long preview grows with the page after the receipt narrows");
          await card.getByRole("tab", { name: "Overview", exact: true }).click();
          const narrowOverview = await assertVisiblePanel("Measuring the narrow Overview");
          assert.equal(narrowOverview.anchored, false);
          assert.ok(narrowOverview.container > overviewSize.container,
            "The visible Overview remeasures its wrapped content at the new width");
          assert.ok(resized.container > narrowOverview.container,
            "The mobile data preview uses its own natural height");
          await card.getByRole("tab", { name: "Data preview", exact: true }).click();
          const narrowPreview = await assertVisiblePanel("Showing the narrow data preview");
          assert.equal(narrowPreview.anchored, true);
          assert.ok(Math.abs(narrowPreview.container - resized.container) <= 1);
          await page.setViewportSize({ width: 768, height: 700 });
          const restoredPreview = await assertVisiblePanel("Keeping the data preview bounded while widening");
          assert.equal(restoredPreview.anchored, true);
          await card.getByRole("tab", { name: "Overview", exact: true }).click();
          const restoredOverview = await assertVisiblePanel("Remeasuring Overview at its original width");
          assert.ok(Math.abs(restoredOverview.container - overviewSize.container) <= 1);
          assert.ok(Math.abs(restoredPreview.container - restoredOverview.container) <= 1,
            "Widening while Data preview is active immediately restores the Overview height");
          await card.getByRole("tab", { name: "Data preview", exact: true }).click();
          await assertAnchoredPanel("Restoring the width with a long preview active", anchoredSize);
        }
        if (options.width > 440) {
          await dataPanel.focus();
          await dataPanel.press("End");
          const keyboardScroll = await dataPanel.evaluate(async (el) => {
            const start = performance.now();
            while (el.scrollTop <= 0 && performance.now() - start < 1500)
              await new Promise(requestAnimationFrame);
            return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
              focused: el.getRootNode().activeElement === el, overflowY: getComputedStyle(el).overflowY };
          });
          assert.ok(keyboardScroll.scrollTop > 0,
            `A keyboard user can scroll the long preview inside its tab panel: ${JSON.stringify(keyboardScroll)}`);
        }
        await assertAnchoredPanel("Scrolling the preview", anchoredSize);
        assert.equal(await dataPanel.getByRole("table").count(), 2, "Separate result sets stay separate within one shared tab");
        assert.match(await csvData.innerText(), /117 of 130 recorded rows/u);
        await csvData.getByRole("button", { name: "Next page", exact: true }).click();
        await csvData.getByRole("button", { name: "Next page", exact: true }).click();
        const shortPageSize = await assertAnchoredPanel("Paging to the shorter last result page", anchoredSize);
        assert.ok(shortPageSize.contentScrollHeight < longPreviewSize.contentScrollHeight,
          "The final result page is shorter inside the stable panel");
        assert.match(await csvData.getByRole("table", { name: "Reviewed data", exact: true }).innerText(), /Week 117/u);
        assert.equal(await csvData.getByRole("button", { name: "Next page", exact: true }).isEnabled(), false);
        assert.match(await dataPanel.getByRole("region", { name: "Illustrative activation export", exact: true }).innerText(), /240/u);
        await card.getByRole("tab", { name: "Overview", exact: true }).click();
        const returnedOverview = await assertVisiblePanel("Returning to Overview");
        assert.equal(returnedOverview.anchored, false);
        assert.ok(Math.abs(returnedOverview.container - overviewSize.container) <= 1);
        const overview = card.getByRole("tabpanel", { name: "Overview", exact: true });
        assert.equal(await overview.getByRole("heading", { level: 3 }).count(), 0, "Overview is organized around the finding, not repeated source blocks");
        assert.equal(await overview.getByText("Sources", { exact: true }).count(), 1);
        assert.doesNotMatch(await overview.innerText(), /240 \/ 400|280 \/ 400/u, "Worked arithmetic belongs in Evidence flow");
        await card.getByRole("tab", { name: "Data preview", exact: true }).click();
        assert.match(await csvData.getByRole("table", { name: "Reviewed data", exact: true }).innerText(), /Week 117/u,
          "Each source's paging state survives shared tab changes");
        await card.getByRole("tab", { name: "Data preview", exact: true }).press("Escape");
        await card.getByRole("button", { name: "How did activation change?", exact: true }).waitFor({ state: "visible" });
        assert.equal(await card.evaluate((el) => el.getRootNode().activeElement?.getAttribute("aria-label")), "How did activation change?");
        const other = root.getByRole("article", { name: "What changed in the release?", exact: true });
        await other.getByRole("button", { name: "What changed in the release?", exact: true }).click();
        assert.equal(await other.getByRole("tab").count(), 0);
        assert.equal(await other.getByRole("tabpanel").count(), 0);
        assert.equal(await other.locator(".receipt-confidence-callout, .receipt-confidence").count(), 0,
          "No finding renders a confidence label");
        assert.equal(await other.getByRole("button", { name: "Collapse What changed in the release?", exact: true }).getAttribute("aria-description"), null);
        assert.match(await other.getByRole("region", { name: "Source details", exact: true }).innerText(), /The note records a setup change, not its effect on activation/u);
        assert.equal(await other.getByText("What this supports", { exact: true }).count(), 0);
        const linkedSource = other.getByRole("link", { name: "Release note", exact: true });
        assert.equal(await linkedSource.getAttribute("href"), "https://example.com/releases");
        assert.equal(await linkedSource.locator(".source-row-title").evaluate((el) => getComputedStyle(el).fontFamily),
          await other.evaluate((el) => getComputedStyle(el).fontFamily),
          "Linked document source names use the same regular text font");
        assert.equal(await linkedSource.evaluate((el) => getComputedStyle(el).cursor), "pointer");
        await linkedSource.hover();
        await linkedSource.evaluate(async (el) => Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))));
        assert.equal(await linkedSource.evaluate((el) => getComputedStyle(el).backgroundColor), sourceHoverBackground,
          "Linked and non-linked source chips share the same hover surface");
        await linkedSource.focus();
        await sourceTooltip.waitFor({ state: "visible" });
        const documentIcon = await iconParity(linkedSource);
        assert.deepEqual(documentIcon.card, documentIcon.chip,
          "The linked document card retains the chip's exact icon mask, tone, and size");
        assert.equal(documentIcon.card.maskSize, "108%", "The linked source's inset SVG is optically balanced in both places");
        await linkedSource.press("Escape");
        await other.getByRole("button", { name: "Collapse What changed in the release?", exact: true }).click();
        assert.equal(await other.getAttribute("data-open"), "false");
        await other.getByRole("button", { name: "What changed in the release?", exact: true }).click();
        await other.locator(".receipt-card-title").click();
        assert.equal(await other.getAttribute("data-open"), "false", "The tab-free card header retains click-to-collapse");
      }
      if (!multiple && options.width === 736) {
        await card.getByRole("tab", { name: "Overview", exact: true }).click();
        const wide = await assertVisiblePanel("Returning to wide Overview");
        await page.setViewportSize({ width: 352, height: 700 });
        const narrow = await assertVisiblePanel("Reflowing the visible Overview");
        assert.ok(narrow.container > wide.container, "The Overview grows naturally as its content wraps at a narrow width");
        await card.getByRole("tab", { name: "SQL query", exact: true }).click();
        const narrowSql = await assertVisiblePanel("Showing a narrow SQL tab without unused space");
        assert.equal(narrowSql.anchored, true);
        assert.ok(narrowSql.container < narrow.container,
          "Mobile receipt tabs use their natural height instead of preserving the taller Overview");
        await page.setViewportSize({ width: 768, height: 700 });
        await card.getByRole("tab", { name: "Overview", exact: true }).click();
        const restored = await assertVisiblePanel("Recalculating Overview after resize");
        assert.ok(Math.abs(restored.container - wide.container) <= 1);
      }
      assert.equal(await root.evaluate((el) => {
        const receipt = el.shadowRoot.querySelector(".sources-receipt");
        return receipt.scrollWidth <= receipt.clientWidth + 1;
      }), true, "Receipt must not overflow its inline width");
      // Exercise live host tokens, not just the operating system's light/dark
      // preference. A bundled theme inside the shadow root must not mask them.
      if (await card.getAttribute("data-open") === "false")
        await card.getByRole("button", { name: "How did activation change?", exact: true }).click();
      await card.getByRole("tab", { name: "Overview", exact: true }).click();
      for (const palette of [
        { background: "rgb(248, 243, 230)", text: "rgb(48, 42, 32)", secondary: "rgb(105, 91, 70)", border: "rgb(191, 174, 146)", popover: "rgb(255, 250, 238)", accent: "rgb(128, 60, 20)" },
        { background: "rgb(24, 32, 43)", text: "rgb(230, 237, 247)", secondary: "rgb(168, 185, 207)", border: "rgb(67, 85, 108)", popover: "rgb(34, 45, 61)", accent: "rgb(155, 201, 255)" },
      ]) {
        await root.evaluate((el, palette) => {
          const style = el.ownerDocument.documentElement.style;
          style.colorScheme = palette.background === "rgb(248, 243, 230)" ? "light" : "dark";
          for (const [token, value] of Object.entries({ background: palette.background, foreground: palette.text,
            "muted-foreground": palette.secondary, border: palette.border, popover: palette.popover,
            "accent-foreground": palette.accent })) style.setProperty(`--${token}`, value);
        }, palette);
        const colors = await card.evaluate(async (el) => {
          await Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
          return { background: getComputedStyle(el).backgroundColor, text: getComputedStyle(el).color,
            border: getComputedStyle(el).borderTopColor,
            secondary: getComputedStyle(el.querySelector('.source-tabs [aria-selected="false"]')).color };
        });
        assert.deepEqual(colors, { background: palette.background, text: palette.text,
          border: palette.border, secondary: palette.secondary }, "Receipt follows live custom host colors");
        await sourceChip.focus();
        await sourceTooltip.waitFor({ state: "visible" });
        assert.equal(await sourceTooltip.evaluate((el) => getComputedStyle(el).backgroundColor), palette.popover,
          "Source hover card follows the local popover surface");
        await sourceChip.press("Escape");
        await card.getByRole("tab", { name: "SQL query", exact: true }).click();
        assert.equal(await card.locator('.sql-keyword').first().evaluate((el) => getComputedStyle(el).color), palette.accent,
          "SQL keywords follow the local text accent");
        await card.getByRole("tab", { name: "Overview", exact: true }).click();
        if (!multiple && options.width === 736)
          await page.screenshot({ path: join(workspace, `receipt-theme-${palette.background === "rgb(248, 243, 230)" ? "warm" : "slate"}.png`), fullPage: true });
      }
      await scenario.verifyClean();
      process.stdout.write(`${JSON.stringify({ test: "inline-sources-receipt", multiple, ...options, result: "pass" })}\n`);
    } finally { await scenario.context.close(); }
  }

  async function inspectShortOverview(browser, fixture, preview) {
    const scenario = await createPageScenario(browser, preview, { width: 736, height: 700 });
    try {
      const root = scenario.page.frameLocator("iframe").locator(fixture.root);
      await root.getByRole("button", { name: "Sources", exact: true }).click();
      const card = root.getByRole("article", { name: "How did activation change?", exact: true });
      const panels = card.locator(".receipt-panels");
      const overview = card.getByRole("tabpanel", { name: "Overview", exact: true });
      await overview.waitFor({ state: "visible" });
      const before = await panels.evaluate(async (el) => {
        await Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
        return { height: el.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(el).lineHeight), anchored: el.hasAttribute("data-anchored") };
      });
      assert.equal(before.anchored, false);
      assert.equal(await card.locator(".receipt-definitions").count(), 0,
        "A brief document-backed explanation must not invent a Definitions section");
      assert.ok(before.height < 10 * before.lineHeight,
        "The sparse Overview exercises the readable-height exception");
      await card.getByRole("tab", { name: "Data preview", exact: true }).click();
      const dataHeight = await panels.evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(dataHeight >= 10 * before.lineHeight - 1 && dataHeight > before.height,
        "Other tabs show a usable reading area without padding the sparse Overview");
      await card.getByRole("tab", { name: "SQL query", exact: true }).click();
      assert.ok(Math.abs(await panels.evaluate((el) => el.getBoundingClientRect().height) - dataHeight) <= 1,
        "The short-Overview floor remains stable across non-Overview tabs");
      await card.getByRole("tab", { name: "Overview", exact: true }).click();
      assert.ok(Math.abs(await panels.evaluate((el) => el.getBoundingClientRect().height) - before.height) <= 1,
        "Returning to the sparse Overview removes the reading-height floor");
      await scenario.verifyClean();
      process.stdout.write(`${JSON.stringify({ test: "inline-sources-short-overview", result: "pass" })}\n`);
    } finally { await scenario.context.close(); }
  }

  return { receiptFixture, inspectSourcesReceipt, inspectShortOverview };
}
