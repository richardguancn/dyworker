import assert from "node:assert/strict";

export async function verifyDashboardInlineEditing({ page, trend, activeUsers, settleSelectionUi }) {
  const topbarTitle = page.locator(".dashboard-topbar-title");
  await topbarTitle.dblclick();
  await page.waitForFunction(() => document.activeElement?.classList.contains("dashboard-topbar-title"));
  assert.equal(
    await topbarTitle.getAttribute("contenteditable"),
    "true",
    "Double-clicking the dashboard title should enter edit mode and focus it",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const chartTitle = trend.locator(".component-title-text");
  await chartTitle.dblclick();
  await page.waitForFunction(() => document.activeElement?.classList.contains("component-title-text"));
  assert.equal(
    await chartTitle.getAttribute("contenteditable"),
    "true",
    "Double-clicking a chart title should enter edit mode and focus it",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const sourceBackedDescription = page.locator(".analysis-caption[data-source-value]").first();
  await sourceBackedDescription.dblclick();
  await page.waitForFunction(() => document.activeElement?.closest?.(".analysis-caption[data-source-value]"));
  assert.equal(await sourceBackedDescription.locator('[contenteditable="true"]').count(), 1,
    "Source-backed authored captions must use the shared owner-only Lexical narrative editor");
  const editableTextSurfaces = [
    ["component title", chartTitle],
    ["narrative description", sourceBackedDescription.locator(".report-rich-editable")],
    ["top-bar title", topbarTitle],
  ];
  let expectedInteraction;
  for (const [name, target] of editableTextSurfaces) {
    // Scrolling can move the target while the sticky tabs expand or collapse.
    // Reacquire hover instead of sampling an unhovered element as the baseline.
    let hover;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await target.hover({ timeout: 5_000 });
      hover = await target.evaluate((element) => {
        if (!element.matches(":hover")) return null;
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, radius: style.borderRadius };
      });
      if (hover) break;
      await settleSelectionUi(page);
    }
    assert.ok(hover, `${name} must be hovered when sampling its styles`);
    await target.focus();
    const focus = await target.evaluate((element) => {
      if (!element.matches(":focus")) return null;
      const style = getComputedStyle(element);
      return {
        color: style.outlineColor,
        width: style.outlineWidth,
        style: style.outlineStyle,
        offset: style.outlineOffset,
      };
    });
    assert.ok(focus, `${name} must be focused when sampling its styles`);
    const interaction = { hover, focus };
    if (expectedInteraction) {
      assert.deepEqual(
        interaction,
        expectedInteraction,
        `${name} must use the same hover and focus treatment as other editable text`,
      );
    } else {
      expectedInteraction = interaction;
      assert.equal(
        hover.radius,
        "6px",
        "Editable-text hover and focus treatments should retain softly rounded corners",
      );
    }
  }
  const titleGeometry = await topbarTitle.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      editor: element.getBoundingClientRect().width,
      text: range.getBoundingClientRect().width,
    };
  });
  assert.ok(
    titleGeometry.editor <= titleGeometry.text + 16,
    "The top-bar title focus treatment should fit its text rather than the entire content column",
  );
  await topbarTitle.fill("A clearer adoption story.");
  await topbarTitle.press("Enter");
  assert.equal(await topbarTitle.innerText(), "A clearer adoption story.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
  await page.waitForFunction(() =>
    Object.values(localStorage).some((value) => value.includes("A clearer adoption story.")),
  );
  const savedTitle = await page.evaluate(
    () =>
      Object.values(localStorage)
        .map((value) => JSON.parse(value))
        .find((record) => record.presentation?.title === "A clearer adoption story.")?.presentation,
  );
  assert.equal(savedTitle.title, "A clearer adoption story.");
  assert.ok(
    !Object.values(savedTitle.textEdits ?? {}).includes("A clearer adoption story."),
    "Top-bar titles must persist once as the shared title, never as duplicate narrative text",
  );
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  assert.equal(
    await page.locator(".hero-copy").count(),
    0,
    "The starter should not render a separate dashboard description",
  );
  assert.ok(
    await page.locator('main .component-title-text[contenteditable="true"]').count(),
    "Meaningful section headings must be directly editable",
  );
  assert.ok(
    await page.locator('main :is(p[data-inline-editable="true"], [data-rich-narrative] [contenteditable="true"])').count(),
    "Meaningful narrative descriptions must be directly editable",
  );
  const protectedValueSelectors = [
    ".metric-value",
    ".forecast-value",
    ".scenario-value",
    ".scenario-caption",
    ".comparison",
    ".scenario-label",
    ".scenario-lever span",
    ".forecast-details dt",
    ".forecast-details dd",
    ".source-value",
    ".priority-list li",
    "output",
  ];
  for (const selector of protectedValueSelectors) {
    const values = page.locator(selector);
    assert.ok(await values.count(), `The starter does not exercise protected ${selector} content`);
    for (const value of await values.all()) {
      assert.notEqual(
        await value.getAttribute("contenteditable"),
        "true",
        `${selector} must remain read-only in Edit mode`,
      );
      assert.notEqual(
        await value.getAttribute("data-inline-editable"),
        "true",
        `${selector} must not become an editable presentation target`,
      );
    }
  }
  const chartDescription = page.locator(".analysis-caption[data-source-value]").first();
  await chartDescription.scrollIntoViewIfNeeded();
  assert.equal(await chartDescription.locator('[contenteditable="true"]').count(), 1,
    "An authored source-backed chart description uses the shared rich narrative editor");
  const chartDescriptionEditor = chartDescription.locator('[contenteditable="true"]');
  await chartDescriptionEditor.focus();
  await chartDescriptionEditor.press("Home");
  for (const _character of "of") await chartDescriptionEditor.press("Shift+ArrowRight");
  const dashboardFormatToolbar = page.getByRole("toolbar", { name: "Format selected text" });
  await dashboardFormatToolbar.waitFor();
  const textStyleTrigger = dashboardFormatToolbar.getByRole("button", { name: "Text styles" });
  assert.equal(await textStyleTrigger.innerText(), "Text");
  await textStyleTrigger.click();
  const textStyleMenu = page.getByRole("menu", { name: "Text styles" });
  assert.deepEqual(
    await textStyleMenu.getByRole("menuitemradio").evaluateAll((items) =>
      items.map((item) => item.firstElementChild.textContent)),
    ["Heading", "Text", "Numbered list", "Bulleted list", "Checklist"],
    "Shared narrative formatting must keep one report heading ahead of text and list styles",
  );
  assert.equal(await textStyleMenu.getByRole("menuitemradio", { name: /Text/ }).getAttribute("aria-checked"), "true");
  assert.equal(await textStyleTrigger.getAttribute("aria-expanded"), "true");
  await textStyleTrigger.click();
  await dashboardFormatToolbar.getByRole("button", { name: "Add link" }).click();
  const linkInput = dashboardFormatToolbar.getByRole("textbox", { name: "Link URL" });
  assert.equal(await linkInput.getAttribute("placeholder"), "Type or paste a link");
  assert.equal(await dashboardFormatToolbar.getByRole("button", { name: "Apply link" }).isDisabled(), true,
    "Unreviewed or invalid links cannot be applied");
  await dashboardFormatToolbar.getByRole("button", { name: "Cancel link entry" }).click();
  await dashboardFormatToolbar.getByRole("button", { name: "Bold" }).click();
  assert.equal(await chartDescription.locator("strong").innerText(), "of",
    "Dashboard narratives preserve selective medium-weight formatting");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
  await page.waitForFunction(() => Object.values(localStorage).some((value) =>
    value.includes("**of**")));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  assert.notEqual(
    await page.locator(".priority-list").first().getAttribute("data-reviewed-rows"),
    null,
    "Custom reviewed-row collections must be explicitly identified as source-backed data",
  );
  for (const [axis, selector] of [
    ["X", ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-label text"],
    ["Y", ".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-label text"],
  ]) {
    const labels = page.locator(selector);
    assert.ok(await labels.count(), `The starter should render actual ${axis}-axis tick labels`);
    for (const axisLabel of await labels.all()) {
      assert.notEqual(
        await axisLabel.getAttribute("contenteditable"),
        "true",
        `${axis}-axis tick labels must remain read-only`,
      );
    }
  }
  for (const [axis, selector] of [
    ["X", ".chart-axis-label"],
    ["Y", ".recharts-wrapper svg .recharts-label"],
  ]) {
    const titles = page.locator(selector);
    assert.ok(await titles.count(), `The starter should render an actual ${axis}-axis title`);
    for (const axisTitle of await titles.all()) {
      assert.notEqual(
        await axisTitle.getAttribute("contenteditable"),
        "true",
        `${axis}-axis titles should be changed through Edit chart rather than direct inline editing: ${await axisTitle.evaluate(
          (element) => element.outerHTML,
        )}`,
      );
    }
  }
  const tableCell = page.locator('[data-component-id="usage-details"] tbody td').first();
  assert.notEqual(
    await tableCell.getAttribute("contenteditable"),
    "true",
    "Reviewed table values must remain read-only",
  );
  assert.equal(
    await page.locator(".filter-trigger").first().getAttribute("contenteditable"),
    null,
    "Interactive dashboard filters must remain functional controls rather than editable text",
  );
  const editableTitle = activeUsers.getByLabel("Edit Weekly active accounts title");
  await editableTitle.fill("Reviewed active users");
  await editableTitle.press("Enter");
  assert.equal(await activeUsers.locator(".component-title-text").innerText(), "Reviewed active users");
}
