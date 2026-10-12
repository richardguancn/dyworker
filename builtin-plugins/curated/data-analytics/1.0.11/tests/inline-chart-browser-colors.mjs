import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { semanticColorResolver } from "../templates/data-app/base/src/charting/chart-theme.js";
import { chartColorOptions } from "../templates/data-app/base/src/components/chart-color-utils.js";

/** Bind color-only regressions to the shared actual-Codex browser harness. */
export function createInlineColorBrowserCases({
  pluginRoot,
  workspace,
  isolatedGapInput,
  requirePass,
  renderFixture,
  createScenario,
  generatedPayload,
  readCollapsedPresentation,
  readReviewedSource,
  assertReviewedPayloadUnchanged,
  openChartEditor,
  dismissChartEditor,
  assertContainedPortal,
}) {
  const semanticWauColor = "oklch(from var(--chart-1) l max(c, 0.16) calc(h + 180))";
  const colorEditorInput = {
    ...structuredClone(isolatedGapInput),
    id: "reviewed-inline-chart-color-identity",
    queryId: "reviewed-inline-chart-color-identity-query",
    title: "Illustrative ChatGPT weekly active users",
    chart: { ...isolatedGapInput.chart, stackable: false },
    rows: [
      { week: "2026-07-27", wau: 120 },
      { week: "2026-08-03", wau: 132 },
      { week: "2026-08-10", wau: 145 },
    ],
    source: {
      label: "User-provided reviewed WAU sample",
      caveats: ["Illustrative sample values, not actual reported ChatGPT usage."],
    },
  };

  const expectedColorOptions = [
    ...Array.from({ length: 7 }, (_, index) => ({
      label: `Theme color ${index + 1}`,
      token: `var(--chart-${index + 1})`,
    })),
    { label: "Secondary", token: "var(--secondary)" },
    ...Array.from({ length: 7 }, (_, index) => ({
      label: `Theme color ${index + 1}, blended`,
      token: `color-mix(in srgb, var(--chart-${index + 1}) 42%, var(--surface))`,
    })),
  ];

  async function renderColorEditorFixtures() {
    assert.deepEqual(
      chartColorOptions,
      expectedColorOptions,
      "Shared palette labels must preserve the existing token choices",
    );
    const classicCss = await readFile(join(pluginRoot, "templates/data-app/themes/codex-classic/theme.css"), "utf8");
    const rootTokens = /^:root\s*\{([\s\S]*?)\}/u.exec(classicCss)?.[1];
    requirePass(rootTokens, "The authored color fixture must start from the canonical Classic theme tokens");
    const amberPath = join(workspace, "reviewed-amber-theme.css");
    await writeFile(
      amberPath,
      `:root {${rootTokens.replace(/^\s*color-scheme\s*:[^;]+;\s*/mu, "")}\n` +
        "--chart-1: light-dark(#d97706, #fbbf24);\n" +
        "--chart-3: light-dark(#0f766e, #5eead4);\n}\n",
    );
    const descriptors = [
      { theme: "classic", options: [], colors: { light: "#0285FF", dark: "#66B5FF" } },
      { theme: "amber", options: ["--theme-css", amberPath], colors: { light: "#D97706", dark: "#FBBF24" } },
    ];
    return Promise.all(
      descriptors.map(async (descriptor) => {
        const input = {
          ...colorEditorInput,
          id: `${colorEditorInput.id}-${descriptor.theme}`,
          queryId: `${colorEditorInput.queryId}-${descriptor.theme}`,
        };
        return {
          descriptor,
          fixture: await renderFixture(`reviewed-inline-colors-${descriptor.theme}`, input, descriptor.options),
          authored: await renderFixture(
            `reviewed-inline-authored-color-${descriptor.theme}`,
            { ...input, id: `${input.id}-authored`, chart: { ...input.chart, colors: { wau: semanticWauColor } } },
            descriptor.options,
          ),
        };
      }),
    );
  }

  async function readElementColor(locator, property) {
    return locator.evaluate((element, property) => {
      const css = getComputedStyle(element)[property];
      const canvas = element.ownerDocument.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const rgba = [...context.getImageData(0, 0, 1, 1).data];
      return {
        css,
        hex: `#${rgba
          .slice(0, 3)
          .map((channel) => channel.toString(16).padStart(2, "0"))
          .join("")}`.toUpperCase(),
        alpha: rgba[3],
      };
    }, property);
  }

  async function readSingleLineColor(chart) {
    const curve = chart.locator(".recharts-line-curve");
    await curve.waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(await curve.count(), 1, "The reviewed color fixture must retain one real line series");
    const color = await readElementColor(curve, "stroke");
    assert.equal(color.alpha, 255, "The reviewed line must retain an opaque, visible color");
    return color.hex;
  }

  async function assertEditorColorIdentity(editor, name, { label, color, hex }, phase) {
    const trigger = editor.getByRole("button", { name: `Color for ${name}`, exact: true });
    await trigger.getByText(label, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
    const observed = await trigger.evaluate(
      async (element, expected) => {
        const swatch = element.querySelector(":scope > i");
        const label = element.querySelector(":scope > span");
        const editor = element.closest(".chart-editor-dialog");
        const canvas = element.ownerDocument.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        const sample = (css) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = css;
          context.fillRect(0, 0, 1, 1);
          const rgba = [...context.getImageData(0, 0, 1, 1).data];
          return {
            hex: `#${rgba
              .slice(0, 3)
              .map((channel) => channel.toString(16).padStart(2, "0"))
              .join("")}`.toUpperCase(),
            alpha: rgba[3],
          };
        };
        const box = (node) => {
          const rect = node.getBoundingClientRect();
          return Object.fromEntries(
            ["left", "right", "top", "bottom", "width", "height"].map((key) => [key, rect[key]]),
          );
        };
        const read = () => {
          const curve = editor.querySelector(".explorer-chart .recharts-line-curve");
          const range = element.ownerDocument.createRange();
          range.selectNodeContents(label);
          return {
            action: element.getAttribute("aria-label"),
            description: element.getAttribute("aria-description"),
            title: element.getAttribute("title"),
            label: label.textContent,
            color: swatch.style.getPropertyValue("--explorer-swatch-color").trim(),
            swatch: sample(getComputedStyle(swatch).backgroundColor),
            mark: curve ? sample(getComputedStyle(curve).stroke) : null,
            triggerBox: box(element),
            swatchBox: box(swatch),
            labelBox: box(label),
            lineBoxes: [...range.getClientRects()].map((rect) => ({
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
            })),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            labelClientWidth: label.clientWidth,
            labelScrollWidth: label.scrollWidth,
            labelClientHeight: label.clientHeight,
            labelScrollHeight: label.scrollHeight,
          };
        };
        const deadline = performance.now() + 5000;
        let observed;
        let stableFrames = 0;
        while (performance.now() < deadline) {
          await new Promise(requestAnimationFrame);
          observed = read();
          const matches =
            observed.label === expected.label &&
            observed.color === expected.color &&
            observed.swatch.alpha === 255 &&
            observed.mark?.alpha === 255 &&
            observed.mark.hex === observed.swatch.hex &&
            (!expected.hex || observed.swatch.hex === expected.hex);
          stableFrames = matches ? stableFrames + 1 : 0;
          if (stableFrames >= 3) return observed;
        }
        return observed;
      },
      { label, color, hex },
    );
    const detail = `${phase}: ${JSON.stringify(observed)}`;
    const inside = (inner, outer) =>
      inner.left >= outer.left - 1.5 &&
      inner.right <= outer.right + 1.5 &&
      inner.top >= outer.top - 1.5 &&
      inner.bottom <= outer.bottom + 1.5;
    assert.equal(observed.action, `Color for ${name}`, detail);
    assert.equal(observed.label, label, detail);
    assert.equal(observed.description, label, detail);
    assert.equal(observed.title, label, detail);
    assert.equal(observed.color, color, detail);
    assert.equal(observed.swatch.alpha, 255, detail);
    assert.equal(observed.mark?.alpha, 255, detail);
    assert.equal(observed.mark?.hex, observed.swatch.hex, `${phase}: the real chart and color swatch must agree`);
    if (hex) assert.equal(observed.swatch.hex, hex, detail);
    requirePass(
      observed.triggerBox.height >= 36 &&
        inside(observed.swatchBox, observed.triggerBox) &&
        inside(observed.labelBox, observed.triggerBox) &&
        observed.lineBoxes.length > 0 &&
        observed.lineBoxes.every((line) => inside(line, observed.labelBox)) &&
        observed.scrollWidth <= observed.clientWidth + 1 &&
        observed.scrollHeight <= observed.clientHeight + 1 &&
        observed.labelScrollWidth <= observed.labelClientWidth + 1 &&
        observed.labelScrollHeight <= observed.labelClientHeight + 1,
      `${phase}: the complete color identity must remain visible without clipping: ${detail}`,
    );
    return { trigger, hex: observed.swatch.hex };
  }

  async function openEditorColorPalette(root, editor, name = "WAU") {
    const trigger = editor.getByRole("button", { name: `Color for ${name}`, exact: true });
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    const popover = root.locator(`.explorer-color-popover[aria-label="Choose color for ${name}"]`);
    await assertContainedPortal(root, popover, `${name} color palette`);
    return { trigger, popover };
  }

  async function assertEditorColorPalette(popover, explicitColor, { customHex = false, name = "WAU" } = {}) {
    const options = await popover
      .getByRole("group", { name: "Chart series colors", exact: true })
      .locator(".explorer-color-option:not(.explorer-custom-color)")
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          label: button.getAttribute("aria-label"),
          title: button.getAttribute("title"),
          description: button.getAttribute("aria-description"),
          token: button.style.getPropertyValue("--explorer-swatch-color").trim(),
          pressed: button.getAttribute("aria-pressed"),
        })),
      );
    assert.deepEqual(
      options.map(({ label, token }) => ({ label, token })),
      expectedColorOptions,
      "Palette actions must use truthful theme-role labels without changing the approved token values",
    );
    for (const option of options) {
      assert.ok(option.description?.trim(), "Palette options retain the resolved theme hue as accessible context");
      assert.equal(option.title, `${option.label} (${option.description})`);
      assert.equal(
        option.pressed,
        String(option.token === explicitColor),
        "Only an exact explicit token may be selected",
      );
    }
    assert.equal(
      await popover.getByRole("button", { name: `Custom color for ${name}`, exact: true }).getAttribute("aria-pressed"),
      String(customHex),
    );
  }

  async function dismissEditorColorPalette(page, editor, trigger, popover) {
    await trigger.focus();
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "detached", timeout: 5_000 });
    requirePass(await editor.isVisible(), "Closing a color palette must retain the surrounding editor");
    requirePass(
      await trigger.evaluate((element) => element.getRootNode().activeElement === element),
      "Closing a color palette must restore focus to its own trigger",
    );
  }

  async function inspectColorEditor(browser, fixture, preview, { theme, colorScheme, themeOneHex }) {
    const scenario = await createScenario(browser, fixture, preview, { width: 360, colorScheme });
    const { context, page, root } = scenario;
    try {
      const collapsed = root.locator(".data-inline-chart-content");
      const automatic = { label: "Automatic", color: semanticWauColor };
      const direct = { label: "Theme color 1", color: "var(--chart-1)", hex: themeOneHex };
      const blended = {
        label: "Theme color 3, blended",
        color: "color-mix(in srgb, var(--chart-3) 42%, var(--surface))",
      };
      const custom = { label: "Custom #C2410C", color: "#C2410C", hex: "#C2410C" };
      const payloadBefore = generatedPayload(fixture);
      assert.equal(
        payloadBefore.component.chart.colors,
        undefined,
        "The WAU regression must use its genuine automatic semantic color",
      );
      assert.equal(semanticColorResolver({ reviewed: payloadBefore.query })({ field: "wau" }), semanticWauColor);
      const baseline = await readCollapsedPresentation(root);
      const originalHex = await readSingleLineColor(collapsed);
      const sourceBefore = await readReviewedSource(root, fixture);
      const assertOriginalData = async () => {
        const payload = await assertReviewedPayloadUnchanged(root, fixture);
        assert.deepEqual(payload.rows, colorEditorInput.rows);
        assert.deepEqual(payload.query.source, payloadBefore.query.source);
      };
      const selectPaletteColor = async (editor, choice, previousColor) => {
        const { trigger, popover } = await openEditorColorPalette(root, editor);
        await assertEditorColorPalette(popover, previousColor);
        const option = popover.getByRole("button", { name: choice.label, exact: true });
        const optionHex = (await readElementColor(option, "backgroundColor")).hex;
        if (choice.hex)
          assert.equal(optionHex, choice.hex, `${theme}/${colorScheme}: the authored palette must be active`);
        await option.click();
        const selected = await assertEditorColorIdentity(
          editor,
          "WAU",
          { ...choice, hex: optionHex },
          `Selected ${choice.label}`,
        );
        await assertEditorColorPalette(popover, choice.color);
        await dismissEditorColorPalette(page, editor, trigger, popover);
        return selected.hex;
      };

      let { editor } = await openChartEditor(root);
      const initial = await assertEditorColorIdentity(
        editor,
        "WAU",
        { ...automatic, hex: originalHex },
        "Automatic WAU color",
      );
      let palette = await openEditorColorPalette(root, editor);
      await assertEditorColorPalette(palette.popover, null);
      assert.notEqual(
        (
          await readElementColor(
            palette.popover.getByRole("button", { name: "Theme color 1", exact: true }),
            "backgroundColor",
          )
        ).hex,
        originalHex,
        "The hue-rotated WAU color must not be mistaken for the unrotated first palette slot",
      );
      await dismissEditorColorPalette(page, editor, initial.trigger, palette.popover);
      await selectPaletteColor(editor, direct, null);
      assert.deepEqual(
        await readCollapsedPresentation(root),
        baseline,
        "A color draft must not change the applied chart",
      );
      await dismissChartEditor(root, editor, "Cancel");
      assert.deepEqual(
        await readCollapsedPresentation(root),
        baseline,
        "Cancel must preserve the original semantic color",
      );
      await assertOriginalData();

      ({ editor } = await openChartEditor(root));
      await assertEditorColorIdentity(
        editor,
        "WAU",
        { ...automatic, hex: originalHex },
        "Automatic color after Cancel",
      );
      const directHex = await selectPaletteColor(editor, direct, null);
      await dismissChartEditor(root, editor, "Apply");
      assert.equal(await readSingleLineColor(collapsed), directHex);
      await assertOriginalData();

      ({ editor } = await openChartEditor(root));
      await assertEditorColorIdentity(editor, "WAU", direct, "Reopened direct theme color");
      const blendedHex = await selectPaletteColor(editor, blended, direct.color);
      await dismissChartEditor(root, editor, "Apply");
      assert.equal(await readSingleLineColor(collapsed), blendedHex);
      await assertOriginalData();

      ({ editor } = await openChartEditor(root));
      await assertEditorColorIdentity(editor, "WAU", { ...blended, hex: blendedHex }, "Reopened blended theme color");
      palette = await openEditorColorPalette(root, editor);
      await assertEditorColorPalette(palette.popover, blended.color);
      await palette.popover.getByRole("button", { name: "Custom color for WAU", exact: true }).click();
      const hexInput = palette.popover.getByRole("textbox", { name: "Custom hex color for WAU", exact: true });
      assert.equal(
        await hexInput.inputValue(),
        blendedHex,
        "The custom picker must start from the actual rendered blended color",
      );
      await hexInput.fill(custom.color);
      await assertEditorColorIdentity(editor, "WAU", custom, "Explicit custom color");
      await assertEditorColorPalette(palette.popover, custom.color, { customHex: true });
      await dismissEditorColorPalette(page, editor, palette.trigger, palette.popover);
      await dismissChartEditor(root, editor, "Apply");
      assert.equal(await readSingleLineColor(collapsed), custom.hex);
      await assertOriginalData();
      assert.deepEqual(await readReviewedSource(root, fixture), sourceBefore);

      ({ editor } = await openChartEditor(root));
      await assertEditorColorIdentity(editor, "WAU", custom, "Reopened custom color");
      palette = await openEditorColorPalette(root, editor);
      await assertEditorColorPalette(palette.popover, custom.color, { customHex: true });
      await dismissEditorColorPalette(page, editor, palette.trigger, palette.popover);
      await editor.getByRole("button", { name: "Reset", exact: true }).click();
      await assertEditorColorIdentity(editor, "WAU", { ...automatic, hex: originalHex }, "Reset automatic color draft");
      palette = await openEditorColorPalette(root, editor);
      await assertEditorColorPalette(palette.popover, null);
      await dismissEditorColorPalette(page, editor, palette.trigger, palette.popover);
      assert.equal(await readSingleLineColor(collapsed), custom.hex, "Reset must remain a draft until Apply");
      await dismissChartEditor(root, editor, "Apply");
      assert.deepEqual(
        await readCollapsedPresentation(root),
        baseline,
        "Reset must restore the exact original WAU presentation",
      );
      assert.equal(await readSingleLineColor(collapsed), originalHex);
      await assertOriginalData();
      assert.deepEqual(await readReviewedSource(root, fixture), sourceBefore);
      await scenario.verifyClean();
      process.stdout.write(
        `${JSON.stringify({ test: "inline-chart-color-identity", theme, colorScheme, result: "pass" })}\n`,
      );
    } finally {
      await context.close();
    }
  }

  async function inspectAuthoredColorIdentity(browser, fixture, preview, { theme, colorScheme }) {
    const scenario = await createScenario(browser, fixture, preview, { width: 360, colorScheme });
    const { context, page, root } = scenario;
    try {
      const collapsed = root.locator(".data-inline-chart-content");
      const baseline = await readCollapsedPresentation(root);
      const originalHex = await readSingleLineColor(collapsed);
      assert.equal(generatedPayload(fixture).component.chart.colors.wau, semanticWauColor);
      const { editor } = await openChartEditor(root);
      await assertEditorColorIdentity(
        editor,
        "WAU",
        { label: "Custom color", color: semanticWauColor, hex: originalHex },
        "Explicit non-palette semantic CSS",
      );
      const { trigger, popover } = await openEditorColorPalette(root, editor);
      await assertEditorColorPalette(popover, semanticWauColor);
      await dismissEditorColorPalette(page, editor, trigger, popover);
      await dismissChartEditor(root, editor, "Cancel");
      assert.deepEqual(await readCollapsedPresentation(root), baseline);
      await assertReviewedPayloadUnchanged(root, fixture);
      await scenario.verifyClean();
      process.stdout.write(
        `${JSON.stringify({ test: "authored-inline-chart-color-identity", theme, colorScheme, result: "pass" })}\n`,
      );
    } finally {
      await context.close();
    }
  }

  return {
    renderFixtures: renderColorEditorFixtures,
    inspectEditor: inspectColorEditor,
    inspectAuthoredIdentity: inspectAuthoredColorIdentity,
  };
}
