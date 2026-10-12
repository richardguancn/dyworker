import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import { installDashboardBrowserMocks } from "./browser-helpers.mjs";

async function closeEditor(editor, action = "Cancel") {
  await editor.getByRole("button", { name: action, exact: true }).click();
  await editor.waitFor({ state: "hidden" });
}

export async function verifyDashboardChartColors({ browser, failures, dataAppPath, waitForDashboardTitle }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on("pageerror", (error) => failures.push(error.message));
  const themeToken = "var(--chart-3)";
  const blendedToken = "color-mix(in srgb, var(--chart-2) 42%, var(--surface))";

  async function openEditor(componentId, title) {
    await page
      .locator('[data-component-id="' + componentId + '"]')
      .getByRole("button", { name: title + " actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Edit chart", exact: true }).click();
    const editor = page.getByRole("dialog", { name: title, exact: true });
    await editor.locator(".explorer-chart svg").waitFor();
    return editor;
  }

  async function colorState(
    editor,
    name,
    label,
    color = null,
    markSelector = ".recharts-line-curve",
    paint = "stroke",
  ) {
    await editor.getByRole("button", { name: "Color for " + name, exact: true }).waitFor();
    const handle = await page.waitForFunction(
      ({ name, color, markSelector, paint }) => {
        const dialog = document.querySelector(".chart-editor-dialog");
        const trigger = [...(dialog?.querySelectorAll(".explorer-color-trigger") ?? [])].find(
          (button) => button.getAttribute("aria-label") === "Color for " + name,
        );
        const swatch = trigger?.querySelector("i");
        const token = swatch?.style.getPropertyValue("--explorer-swatch-color").trim();
        if (!token || (color !== null && token !== color)) return false;
        const mark = [...dialog.querySelectorAll(".explorer-chart " + markSelector)].find(
          (candidate) => candidate.getAttribute(paint) === token,
        );
        if (!mark) return false;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        const rgba = (value) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        return {
          label: trigger.querySelector("span")?.textContent.trim(),
          description: trigger.getAttribute("aria-description"),
          title: trigger.getAttribute("title"),
          token,
          swatch: rgba(getComputedStyle(swatch).backgroundColor),
          mark: rgba(getComputedStyle(mark)[paint]),
        };
      },
      { name, color, markSelector, paint },
    );
    const state = await handle.jsonValue();
    await handle.dispose();
    assert.deepEqual(
      { label: state.label, description: state.description, title: state.title },
      { label, description: label, title: label },
      "The visible and accessible color identity must describe the stored color role",
    );
    assert.deepEqual(state.swatch, state.mark, "The editor swatch must match the actual rendered chart mark");
    return state;
  }

  async function openPalette(editor, name) {
    await editor.getByRole("button", { name: "Color for " + name, exact: true }).click();
    const palette = page.getByRole("group", { name: "Chart series colors", exact: true });
    await palette.waitFor();
    return palette;
  }

  async function selectedPalette(palette, name = null) {
    assert.deepEqual(
      await palette
        .locator('[aria-pressed="true"]')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
      name === null ? [] : [name],
      "Only the exact explicitly stored palette token may be selected",
    );
  }

  try {
    await installDashboardBrowserMocks(page);
    await page.goto(pathToFileURL(dataAppPath).href, { waitUntil: "load" });
    await waitForDashboardTitle(page);
    const edgeColors = () => page.evaluate(() => ({
      browser: document.querySelector('meta[name="theme-color"]')?.content,
      page: getComputedStyle(document.body).backgroundColor,
      root: getComputedStyle(document.documentElement).backgroundColor,
    }));
    const initialEdges = await edgeColors();
    assert.equal(initialEdges.browser, initialEdges.page, "Browser edge must follow the page theme");
    assert.equal(initialEdges.root, initialEdges.page, "Safe-area fill must follow the page theme");
    const trend = page.locator('[data-component-id="usage-trend"]');
    const originalStrokes = await trend
      .locator(".recharts-line-curve")
      .evaluateAll((marks) => marks.map((mark) => mark.getAttribute("stroke")));
    let editor = await openEditor("usage-trend", "Active accounts over time");
    await colorState(editor, "Active users", "Automatic", "var(--chart-1)");
    await editor.getByRole("button", { name: "Y axis", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Growth", exact: true }).click();
    const automatic = await colorState(editor, "Growth", "Automatic");
    assert.match(automatic.token, /^oklch\(from var\(--chart-1\) /u);
    assert.match(automatic.token, /calc\(h \+ [1-9]\d*\)/u, "The fixture must exercise a hue-rotated semantic color");
    let palette = await openPalette(editor, "Growth");
    assert.equal(
      await palette.getByRole("button", { name: "Theme color 1", exact: true }).getAttribute("aria-pressed"),
      "false",
    );
    await selectedPalette(palette);
    await palette.getByRole("button", { name: "Theme color 3", exact: true }).click();
    await colorState(editor, "Growth", "Theme color 3", themeToken);
    await selectedPalette(palette, "Theme color 3");
    assert.deepEqual(
      await trend
        .locator(".recharts-line-curve")
        .evaluateAll((marks) => marks.map((mark) => mark.getAttribute("stroke"))),
      originalStrokes,
      "Color drafts must not mutate the dashboard before Save",
    );
    await closeEditor(editor, "Save");
    await page.waitForFunction((token) => {
      const marks = document.querySelectorAll('[data-component-id="usage-trend"] .recharts-line-curve');
      return marks.length === 1 && marks[0].getAttribute("stroke") === token;
    }, themeToken);

    editor = await openEditor("usage-trend", "Active accounts over time");
    const saved = await colorState(editor, "Growth", "Theme color 3", themeToken);
    assert.equal(await editor.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
    palette = await openPalette(editor, "Growth");
    await selectedPalette(palette, "Theme color 3");
    await palette.getByRole("button", { name: "Secondary", exact: true }).click();
    await colorState(editor, "Growth", "Secondary", "var(--secondary)");
    await selectedPalette(palette, "Secondary");
    await palette.getByRole("button", { name: "Theme color 2, blended", exact: true }).click();
    await colorState(editor, "Growth", "Theme color 2, blended", blendedToken);
    await selectedPalette(palette, "Theme color 2, blended");
    await palette.getByRole("button", { name: "Custom color for Growth", exact: true }).click();
    await page.getByRole("textbox", { name: "Custom hex color for Growth", exact: true }).fill("#2A6FCF");
    await colorState(editor, "Growth", "Custom #2A6FCF", "#2A6FCF");
    await selectedPalette(palette, "Custom color for Growth");
    await closeEditor(editor);
    editor = await openEditor("usage-trend", "Active accounts over time");
    await colorState(editor, "Growth", "Theme color 3", themeToken);
    palette = await openPalette(editor, "Growth");
    await selectedPalette(palette, "Theme color 3");
    await closeEditor(editor);

    editor = await openEditor("channel-composition", "Share of activations by source");
    await colorState(
      editor,
      "Referrals",
      "Custom color",
      "color-mix(in srgb, var(--chart-2) 76%, var(--surface))",
      "g[data-stack-sign] path[clip-path][fill]",
      "fill",
    );
    palette = await openPalette(editor, "Referrals");
    assert.equal(
      await palette.getByRole("button", { name: "Theme color 2, blended", exact: true }).getAttribute("aria-pressed"),
      "false",
    );
    await selectedPalette(palette);
    await closeEditor(editor);

    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Switch theme", exact: true }).click();
    await page
      .getByRole("region", { name: "Theme picker" })
      .getByRole("button", { name: "Apply Dark pixel", exact: true })
      .click();
    await page.waitForFunction(() => document.documentElement.dataset.appTheme === "dark-pixel");
    const darkEdges = await edgeColors();
    assert.equal(darkEdges.browser, darkEdges.page, "Theme changes must update Safari's status-area color");
    assert.equal(darkEdges.root, darkEdges.page, "Theme changes must update the page-edge fill");
    assert.notEqual(darkEdges.browser, initialEdges.browser);
    editor = await openEditor("usage-trend", "Active accounts over time");
    const themed = await colorState(editor, "Growth", "Theme color 3", themeToken);
    assert.notDeepEqual(
      themed.mark,
      saved.mark,
      "A saved theme token must re-resolve when the dashboard theme changes",
    );
    palette = await openPalette(editor, "Growth");
    await selectedPalette(palette, "Theme color 3");
    await closeEditor(editor);
    process.stdout.write(`${JSON.stringify({ test: "dashboard-chart-color-identities", result: "pass" })}\n`);
  } finally {
    await page.close();
  }
}
