const editAction = "Edit text and layout";
const sourceAction = "View data source";

// Standard single-choice filters expose a button on desktop and a native
// select on touch screens. Never wait for the hidden alternative.
export async function selectFilter(page, { label, option, scope = page }) {
  const timeout = { timeout: 2000 };
  const controls = scope.getByLabel(label, { exact: true }).and(
    scope.locator('button.select-trigger:visible, select.native-filter-control:visible'));
  const available = () => scope.locator('button.select-trigger:visible, select.native-filter-control:visible')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')).join(', ') || 'none');
  if (await controls.count() !== 1)
    throw new Error(`Expected one "${label}" filter in the supplied scope. Available filters: ${await available()}.`);
  let menu;
  try {
    if (await controls.evaluate(node => node.tagName === 'SELECT')) {
      const choices = await controls.locator('option').allTextContents();
      if (!choices.includes(option)) throw new Error(`Unknown choice "${option}". Available choices: ${choices.join(', ')}`);
      await controls.selectOption({ label: option }, timeout);
      const selected = await controls.locator('option:checked').textContent(timeout);
      if (selected !== option) throw new Error(`Selected "${selected}" instead of "${option}"`);
    } else {
      // A modal menu hides its surrounding region from the accessibility tree.
      // Retain the trigger's DOM identity before opening it.
      const triggerId = await controls.getAttribute('id', timeout);
      if (!triggerId) throw new Error('The filter has no stable trigger ID');
      await controls.click(timeout);
      const id = await page.locator('[id=' + JSON.stringify(triggerId) + ']').getAttribute('aria-controls', timeout);
      if (!id) throw new Error('The filter did not open its menu');
      menu = page.locator('[role="menu"][id=' + JSON.stringify(id) + ']');
      const choice = menu.getByRole('menuitemradio', { name: option, exact: true });
      if (await choice.count() !== 1) {
        const choices = await menu.getByRole('menuitemradio').allTextContents();
        throw new Error(`Unknown single choice "${option}". Available choices: ${choices.join(', ') || 'none'}`);
      }
      await choice.click(timeout);
      await menu.waitFor({ state: 'hidden', ...timeout });
    }
  } catch (error) {
    throw new Error(`Filter "${label}": ${error.message.split('\n')[0]}`, { cause: error });
  } finally {
    if (menu && await menu.isVisible()) await menu.press('Escape', timeout);
  }
}

// Drive the standard picker through its visible control. The calendar is
// portaled, so follow the chosen trigger's aria-controls back to its menu.
export async function selectDateRange(page, { start, end, label = "Date range", scope = page }) {
  const dates = [start, end];
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Pass two ISO calendar dates (YYYY-MM-DD).");
  }
  const hosts = scope.locator(".date-range-host").filter({ has: page.getByLabel(label, { exact: true }) });
  if (await hosts.count() !== 1) {
    const labels = await scope.locator(".date-range-native-select").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
    throw new Error(`Expected one "${label}" date picker in the supplied scope. Available date pickers: ${labels.join(", ") || "none"}.`);
  }
  const native = hosts.locator("select"), trigger = hosts.locator(".date-range-trigger");
  const coverage = await native.locator('option[value="all"]').textContent();
  const timeout = { timeout: 2000 };
  const openCalendar = async () => {
    const phone = await native.isVisible();
    if (phone) {
      // selectOption can fire on an offscreen control. The calendar needs its
      // real anchor in view, as it would be for a reader touching the picker.
      await hosts.scrollIntoViewIfNeeded(timeout);
      await native.selectOption("custom", timeout);
    } else await trigger.click(timeout);
    const id = await trigger.getAttribute("aria-controls");
    if (!id) throw new Error("The picker did not open its calendar menu");
    const menu = page.locator('[role="menu"][id=' + JSON.stringify(id) + ']');
    if (!phone) await menu.getByRole("menuitem", { name: "Custom range…", exact: true }).click(timeout);
    return menu;
  };
  const dayButton = async (menu, date) => {
    const name = await page.evaluate(iso => new Intl.DateTimeFormat(undefined,
      { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso)), date);
    const day = menu.getByRole("button", { name, exact: true });
    if (!await day.isVisible()) {
      // All retains ISO coverage even when a short menu has no presets. Use
      // that coverage (or older preset values) to order localized month headings.
      const direction = await native.evaluate((select, { date, heading }) => {
        const latest = [...select.options].map(option => (option.dataset.range ?? option.value).split("..").at(-1))
          .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort().at(-1);
        const formatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
        const cursor = new Date((latest ?? date).slice(0, 7) + "-01T00:00:00Z");
        while (cursor.toISOString().slice(0, 7) >= date.slice(0, 7)) {
          if (formatter.format(cursor) === heading) return "Previous month";
          cursor.setUTCMonth(cursor.getUTCMonth() - 1);
        }
        return "Next month";
      }, { date, heading: await menu.locator('[data-current-month="true"] [role="group"]').getAttribute("aria-label", timeout) });
      const until = Date.now() + timeout.timeout;
      while (!await day.isVisible()) {
        const nav = menu.getByRole("button", { name: direction, exact: true });
        if (Date.now() >= until || await nav.count() !== 1 || !await nav.isEnabled()) throw new Error(`${name} is unavailable`);
        await nav.click(timeout);
      }
    }
    if (!await day.isEnabled()) throw new Error(`${name} is outside the available dates`);
    return day;
  };
  let menu;
  try {
    menu = await openCalendar();
    for (const date of dates) await (await dayButton(menu, date)).click(timeout);
    await menu.waitFor({ state: "hidden", ...timeout });
    const expected = await page.evaluate(([start, end]) => {
      const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
      return start === end ? format.format(new Date(start)) : format.formatRange(new Date(start), new Date(end));
    }, [...dates].sort());
    // The trigger's title retains the selected dates even when its text shows a preset.
    const selected = await trigger.locator("span[title]").getAttribute("title", timeout);
    if (selected !== expected && !(coverage.endsWith(" · " + expected) && ["all", "All dates"].includes(selected))) {
      throw new Error(`Selected "${selected}", expected "${expected}"`);
    }
  } catch (error) {
    throw new Error(`Date picker "${label}", ${start} to ${end}: ${error.message.split("\n")[0].replace(/\.$/, "")}. ${coverage}.`, { cause: error });
  } finally {
    if (menu && await menu.isVisible()) await menu.press("Escape", timeout);
  }
}

// Reuse the shell's actual accessible panel contract in authored checks too.
// The callback sees loaded data; closing stays scoped even when a backdrop has
// the same accessible name as the panel's close button.
export async function withSourcePanel(page, trigger, inspect) {
  await trigger.click();
  const panel = page.getByRole("complementary", { name: /^Data source for / });
  try {
    const body = panel.locator('.source-sidebar-body[aria-busy="false"]');
    await body.waitFor();
    const preview = panel.getByRole("tab", { name: "Data preview", exact: true });
    if (await preview.isVisible()) await preview.click();
    return await inspect(panel);
  } finally {
    if (await panel.isVisible()) {
      await panel.getByRole("button", { name: "Close data source", exact: true }).click();
      await panel.waitFor({ state: "hidden" });
    }
  }
}

// The reusable report shell exposes desktop buttons and a narrow overflow menu.
async function chooseMenuAction(scope, trigger, name) {
  const native = scope.getByRole("combobox", { name: trigger });
  if (await native.isVisible()) return native.selectOption({ label: name });
  await scope.getByRole("button", { name: trigger }).click();
  await scope.page().getByRole("menuitem", { name, exact: true }).click();
}

// A report may use its own citation UI. For the supplied components, exercise the
// reader's claim and end-list controls and compare the evidence each one opens.
export async function verifyNumberedCitation(page) {
  const claims = page.locator('[data-report-citation="claim"]:visible');
  const entries = page.locator('[data-report-citation="list"]:visible');
  if (!await claims.count() && !await entries.count()) return null;
  if (!await claims.count() || !await entries.count()) throw new Error("Provide the numbered claim citation and its Sources list.");
  const claim = claims.first();
  const name = await claim.getAttribute("aria-label");
  const entry = entries.and(page.getByRole("button", { name, exact: true }));
  if (await entry.count() !== 1) throw new Error("The report needs one Sources entry for " + name);
  const evidence = [];
  for (const trigger of [claim, entry]) {
    evidence.push(await withSourcePanel(page, trigger, async panel => ({
      name: await panel.getAttribute("aria-label"), query: await panel.getAttribute("data-source-query"),
      body: await panel.locator('.source-sidebar-body').innerText(),
    })));
  }
  const [claimSource, listSource] = evidence;
  // A section citation can show a subset of the footer's dataset. Compare the
  // actual opened query; older runtimes without that identity retain exact comparison.
  const sameSource = claimSource.query && listSource.query
    ? claimSource.query === listSource.query : claimSource.body === listSource.body;
  if (!claimSource.body.trim() || !listSource.body.trim() || claimSource.name !== listSource.name || !sameSource)
    throw new Error("The claim and Sources entry opened different evidence for " + name);
  return name;
}

export async function verifyReportSection(page, sectionId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(sectionId))
    throw new Error("Pass the authored report section's stable component ID.");
  const numberedCitation = await verifyNumberedCitation(page);
  const section = page.locator('[data-component-id="' + sectionId + '"]');
  await section.waitFor();
  await chooseMenuAction(section, / actions$/i, sourceAction);
  const source = page.getByRole("complementary", { name: /^Data source for / });
  await source.locator('.source-sidebar-body[aria-busy="false"]').waitFor();
  const sourceName = await source.getAttribute("aria-label");
  await source.getByRole("button", { name: "Close data source", exact: true }).click();
  await source.waitFor({ state: "hidden" });

  const edit = page.getByRole("button", { name: editAction, exact: true });
  if (await edit.isVisible()) await edit.click();
  else await chooseMenuAction(page.locator(".dashboard-topbar"), "More", editAction);
  const narrative = section.locator("[data-rich-narrative]").first();
  const editor = narrative.locator('[contenteditable="true"]');
  const marker = " Report edit verification.";
  await editor.press("Control+End");
  await page.keyboard.insertText(marker);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await page.reload({ waitUntil: "load" });
  await narrative.filter({ hasText: marker.trim() }).waitFor();
  return { sectionId, sourceName, savedEditAfterReload: true, ...(numberedCitation && { numberedCitation }) };
}
