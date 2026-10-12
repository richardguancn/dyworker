import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright-core';
import { resolveChromiumExecutable, runDataAppFixtureBuild } from './browser-helpers.mjs';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const template = join(pluginRoot, 'templates/data-app/base');
const workspace = mkdtempSync(join(tmpdir(), 'data-mobile-responsive-'));
const viewports = [
  { name: 'small-phone', width: 320, height: 700 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'large-phone', width: 430, height: 932 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'desktop', width: 1440, height: 900 },
];

function buildApp(surface) {
  const project = join(workspace, surface);
  cpSync(template, project, { recursive: true, filter: path => !path.includes('/node_modules') && !path.includes('/dist') });
  if (surface === 'dashboard') {
    const contentPath = join(project, 'src/content/dashboard/DashboardContent.jsx');
    const content = readFileSync(contentPath, 'utf8');
    const table = '<DataComponent variant="card" id="usage-details" title="Reviewed account-level evidence" kind="table"';
    assert.ok(content.includes(table), 'The responsive fixture needs its account-level table');
    writeFileSync(contentPath, content.replace(table,
      `${table.replace('Reviewed account-level evidence', 'Reviewed account-level evidence and conversion by channel')}
        description="Reviewed account-level source rows."`));
  }
  if (surface === 'report') {
    const dataPath = join(project, 'src/data.json');
    writeFileSync(dataPath, JSON.stringify({ ...JSON.parse(readFileSync(dataPath, 'utf8')), surface }));
  }
  const build = runDataAppFixtureBuild(project, { pluginRoot });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  return join(project, 'dist/index.html');
}

function buildInline(kind) {
  const output = join(workspace, `${kind}.html`);
  const script = join(pluginRoot, `skills/visualize-data/scripts/render-inline-${kind}.mjs`);
  const input = join(pluginRoot, `skills/visualize-data/assets/inline-${kind}-example.json`);
  const fixture = kind === 'chart' ? join(workspace, 'described-inline-chart.json') : input;
  if (kind === 'chart') writeFileSync(fixture, JSON.stringify({ ...JSON.parse(readFileSync(input, 'utf8')),
    title: 'Weekly active users by plan and signup channel',
    description: 'Illustrative weekly active users by plan.' }));
  execFileSync(process.execPath, [script, '--input', fixture, '--output', output], { stdio: 'pipe' });
  const hosted = join(workspace, `${kind}-host.html`);
  writeFileSync(hosted, `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:16px">${readFileSync(output, 'utf8')}</body>`);
  return hosted;
}

async function checkWidth(page, label) {
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  assert.ok(width.content <= width.viewport + 1, `${label} overflows horizontally: ${JSON.stringify(width)}`);
}

async function checkPhoneChrome(page, label) {
  const touch = await page.evaluate(() => {
    const rect = element => element.getBoundingClientRect().toJSON();
    const topbar = document.querySelector('.dashboard-topbar');
    const title = rect(topbar.querySelector('.dashboard-topbar-title'));
    const context = topbar.querySelector('.dashboard-topbar-copy .freshness');
    const controls = [...topbar.querySelectorAll('.dashboard-topbar-inner button, .dashboard-topbar-inner select')]
      .filter(element => element.getBoundingClientRect().width && element.getBoundingClientRect().height)
      .map(element => ({ name: element.getAttribute('aria-label') || element.textContent.trim(), box: rect(element) }));
    const filters = [...document.querySelectorAll('.filter-bar .filter-trigger')]
      .filter(element => element.getBoundingClientRect().width).map(rect);
    const menus = [...document.querySelectorAll('.dashboard-component .component-native-actions')].map(rect);
    const info = [...document.querySelectorAll('.dashboard-component .info-wrap > button.info')].map(rect);
    const overlaps = [...document.querySelectorAll('.dashboard-component')].flatMap(component => {
      const information = component.querySelector('.info-wrap > button.info');
      const menu = component.querySelector('.component-native-actions');
      if (!information || !menu) return [];
      const a = information.getBoundingClientRect();
      const b = menu.getBoundingClientRect();
      return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
        ? [component.dataset.componentId] : [];
    });
    const edition = document.querySelector('.dashboard-mobile-report-date');
    return { title, context: context && rect(context), edition: edition && rect(edition),
      header: rect(topbar), controls, filters, menus, info, overlaps };
  });
  const targets = [...touch.controls.map(({ box }) => box), ...touch.filters, ...touch.menus, ...touch.info];
  assert.ok(targets.every(({ width, height }) => width >= 44 && height >= 44),
    `${label}: primary phone controls need 44px hit regions: ${JSON.stringify(touch)}`);
  assert.deepEqual(touch.overlaps, [], `${label}: information and menu hit regions must not overlap`);
  assert.equal(touch.header.height, 56, `${label}: reading mode uses a single row app bar`);
  assert.equal(touch.controls.length, 1, `${label}: reading mode exposes one overflow control`);
  assert.equal(touch.controls[0].name, 'More');
  if (touch.edition) assert.ok(touch.edition.top >= touch.header.bottom - 1,
    `${label}: the prepared date should be in report content, below the bar`);
}

async function checkTitleInfoSpacing(page, viewport, label, { inline = false } = {}) {
  const headings = await page.locator('.component-title:has(.info-wrap)')
    .evaluateAll(elements => elements.map(heading => {
      const tail = heading.querySelector('.component-title-tail');
      const label = tail || heading.querySelector('.component-title-text');
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      let text;
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        if (node.textContent.trim()) text = node;
      const range = document.createRange();
      const lastCharacter = text.textContent.trimEnd().length;
      range.setStart(text, lastCharacter - 1);
      range.setEnd(text, lastCharacter);
      const word = range.getBoundingClientRect();
      const icon = heading.querySelector('.info .dashboard-icon').getBoundingClientRect();
      const component = heading.closest('.dashboard-component');
      return { kind: component?.classList.contains('data-inline-chart-content') ? 'inline-chart' : component?.dataset.componentKind,
        title: text.textContent, gap: icon.left - word.right,
        centerOffset: (icon.top + icon.bottom - word.top - word.bottom) / 2 };
    }));
  assert.ok(headings.length > 0, `${label}: expected at least one information icon`);
  if (inline) assert.ok(headings.some(({ kind }) => kind === 'inline-chart'), `${label}: inline chart information icon`);
  else if (label.includes('dashboard'))
    for (const kind of ['chart', 'metric', 'table'])
      assert.ok(headings.some(heading => heading.kind === kind), `${label}: missing ${kind} information icon`);
  const misaligned = headings.filter(({ kind, gap, centerOffset }) => {
    return gap < 5 || gap > 7 || Math.abs(centerOffset) > 2;
  });
  assert.deepEqual(misaligned, [], `${label}: information glyph should follow its final word with its intended visual gap and alignment`);
}

async function checkPhoneActionMenu(page, viewport, label) {
  const picker = await page.getByRole('combobox', { name: 'More' }).evaluate(element => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, width: box.width, height: box.height,
      selectedIndex: element.selectedIndex,
      groups: [...element.querySelectorAll('optgroup')].map(group => ({ label: group.label,
        items: [...group.querySelectorAll('option')].map(option => ({
          label: option.textContent.trim(), text: option.textContent.trim(), value: option.value,
        })) })) };
  });
  assert.ok(picker.width >= 44 && picker.height >= 44 && picker.right <= viewport.width - 12,
    `${label}: native action picker needs a full phone tap target: ${JSON.stringify(picker)}`);
  assert.equal(picker.selectedIndex, -1, `${label}: actions must not have a selected checkmark`);
  assert.ok(picker.groups.every(group => group.items.every(item => item.text !== 'Choose action'
    && item.text === item.label)),
    `${label}: native options should be plain text commands without a placeholder: ${JSON.stringify(picker)}`);
  if (label.includes('dashboard')) assert.deepEqual(picker.groups.find(group => group.label === 'Refresh')?.items.map(item => item.label),
    ['Refresh now', 'Schedule refresh'], `${label}: refresh commands should have their own group`);
  assert.ok(picker.groups.some(group => group.label === 'Export' && group.items.some(item => item.label === 'PDF')),
    `${label}: export actions must remain available`);
}

async function chooseTopAction(page, label) {
  const value = await page.locator('.dashboard-native-overflow option').evaluateAll((options, name) =>
    options.find(option => option.textContent.trim() === name)?.value, label);
  assert.ok(value, `Missing native action: ${label}`);
  const picker = page.locator('.dashboard-native-overflow select');
  await picker.selectOption(value);
  assert.equal(await page.evaluate(() => document.querySelector('.dashboard-native-overflow select')?.selectedIndex ?? -1), -1,
    `${label}: native command should reset selection for repeat use`);
}

async function checkDashboard(page, viewport, browserName) {
  await page.locator('.forecast-progress-labels').waitFor();
  await checkWidth(page, `${browserName} dashboard ${viewport.name}`);
  await checkTitleInfoSpacing(page, viewport, `${browserName} dashboard ${viewport.name}`);
  if (browserName === 'chromium' && viewport.name === 'landscape') {
    const picker = page.locator('.dashboard-native-overflow select');
    await picker.waitFor({ state: 'visible' });
    await chooseTopAction(page, 'Ask ChatGPT');
    const dialog = page.getByRole('dialog', { name: 'Ask ChatGPT about this dashboard' });
    await dialog.waitFor();
    const location = await dialog.boundingBox();
    const trigger = await picker.boundingBox();
    assert.ok(location.x + location.width > trigger.x - 60,
      `Landscape Ask should anchor beside the visible native More control: ${JSON.stringify({ location, trigger })}`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
  }
  if (viewport.width <= 430) {
    await checkPhoneChrome(page, `${browserName} dashboard ${viewport.name}`);
    const chrome = await page.evaluate(() => {
      const rect = element => element.getBoundingClientRect().toJSON();
      const filters = [...document.querySelectorAll('.filters.filter-bar .filter-trigger')]
        .filter(element => element.getBoundingClientRect().width);
      const actions = [...document.querySelectorAll('.dashboard-topbar-actions > *')]
        .filter(element => element.getBoundingClientRect().width);
      const cardMenus = [...document.querySelectorAll('.dashboard-component[data-component-variant="card"] > .component-header .component-native-actions')];
      return { filters: filters.map(rect), actions: actions.map(rect), menus: cardMenus.map(menu => ({
        button: rect(menu), card: rect(menu.closest('.dashboard-component')),
        metric: menu.closest('.dashboard-component').dataset.componentKind === 'metric',
      })) };
    });
    assert.ok(chrome.filters[0].width < viewport.width - 80 && chrome.filters[1].left < viewport.width - 45,
      `Filter chips should show the next filter on a phone: ${JSON.stringify(chrome.filters)}`);
    assert.ok(chrome.actions[0].right <= viewport.width - 12,
      `Phone overflow button should fit against the trailing inset: ${JSON.stringify(chrome.actions)}`);
    assert.ok(chrome.menus.every(({ button, card, metric }) => metric
      ? button.top >= card.top + 12 && button.top <= card.top + 36 && card.right - button.right >= 10
      : Math.abs(button.top - card.top - (card.right - button.right)) <= 2),
    `Card actions should align with metric labels or have even chart insets: ${JSON.stringify(chrome.menus)}`);
    const accountFilters = await page.locator('.evidence-section .data-section-filters').evaluate(element =>
      [...element.querySelectorAll('.native-filter-shell')].map(control => control.getBoundingClientRect().toJSON()));
    assert.equal(accountFilters.length, 2);
    assert.ok(Math.abs(accountFilters[0].top - accountFilters[1].top) <= 1 &&
      accountFilters[0].right + 6 <= accountFilters[1].left &&
      accountFilters[1].right <= viewport.width - 12,
    `${browserName} ${viewport.name}: Account health filters should share one row: ${JSON.stringify(accountFilters)}`);
    const heading = await page.locator('[data-component-id="engagement-heatmap"]').evaluate(card => {
      const text = card.querySelector('.component-title-tail').firstChild;
      const lastWord = text.textContent.lastIndexOf('active');
      const range = document.createRange();
      range.setStart(text, lastWord);
      range.setEnd(text, lastWord + 'active'.length);
      const word = range.getBoundingClientRect();
      const icon = card.querySelector('.info-wrap').getBoundingClientRect();
      const infoTarget = card.querySelector('.info-wrap > button').getBoundingClientRect();
      const actionTarget = card.querySelector('.component-native-actions select').getBoundingClientRect();
      return { word: word.toJSON(), icon: icon.toJSON(), infoTarget: infoTarget.toJSON(),
        actionTarget: actionTarget.toJSON() };
    });
    assert.ok(Math.abs((heading.word.top + heading.word.bottom - heading.icon.top - heading.icon.bottom) / 2) <= 10,
      `Chart info icon should follow the title's last line: ${JSON.stringify(heading)}`);
    assert.ok(heading.infoTarget.right + 4 <= heading.actionTarget.left,
      `Chart info and action hit targets need separate space: ${JSON.stringify(heading)}`);
    if (viewport.name === 'phone') {
      const flow = await page.locator('[data-component-id="engagement-heatmap"] .component-title-text').evaluate(element => {
        const prefix = element.firstChild;
        const range = document.createRange();
        range.setStart(prefix, prefix.textContent.indexOf('most'));
        range.setEnd(prefix, prefix.textContent.indexOf('most') + 4);
        return { most: range.getBoundingClientRect().top, first: element.getBoundingClientRect().top };
      });
      assert.ok(Math.abs(flow.most - flow.first) <= 6,
        `Phone chart title should use available space on its first line: ${JSON.stringify(flow)}`);
    }
  }
  const labels = await page.locator('.forecast-progress-labels').evaluate(element => {
    const target = element.querySelector('.forecast-progress-target-label').getBoundingClientRect();
    const projected = element.lastElementChild.getBoundingClientRect();
    const track = element.previousElementSibling.getBoundingClientRect();
    return { target: target.toJSON(), projected: projected.toJSON(), markerX: track.left + track.width * .8 };
  });
  const separated = labels.target.bottom <= labels.projected.top + 1 || labels.projected.bottom <= labels.target.top + 1
    || labels.target.right <= labels.projected.left + 1 || labels.projected.right <= labels.target.left + 1;
  assert.ok(separated, `${browserName} ${viewport.name}: target and projected labels overlap: ${JSON.stringify(labels)}`);
  assert.ok(Math.abs((labels.target.left + labels.target.right) / 2 - labels.markerX) <= 2,
    `${browserName} ${viewport.name}: target label must point to its bar marker`);
  if (browserName !== 'chromium' || !['small-phone', 'phone'].includes(viewport.name)) return;
  await checkPhoneActionMenu(page, viewport, `${browserName} dashboard ${viewport.name}`);
  await chooseTopAction(page, 'Schedule refresh');
  const schedule = page.getByRole('dialog', { name: 'Schedule refresh' });
  await schedule.waitFor();
  const scheduleIcon = await schedule.locator('.dialog-title-group').evaluate(group => {
    const label = group.querySelector('[role="heading"]')?.getBoundingClientRect()
      || group.querySelector('h2')?.getBoundingClientRect();
    const icon = group.querySelector('.info .dashboard-icon').getBoundingClientRect();
    return { gap: icon.left - label.right,
      centerOffset: (icon.top + icon.bottom - label.top - label.bottom) / 2 };
  });
  assert.ok(scheduleIcon.gap >= 5 && scheduleIcon.gap <= 7 && Math.abs(scheduleIcon.centerOffset) <= 2,
    `Schedule dialog information icon should align with its heading: ${JSON.stringify(scheduleIcon)}`);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await chooseTopAction(page, 'Edit text and layout');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const table = page.locator('.table-wrap').first();
  const scroll = await table.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
  assert.ok(scroll.content > scroll.width, 'Dense mobile table should scroll within its card');
  const chartActions = page.getByRole('combobox', { name: /Active accounts over time actions/ });
  assert.equal(await chartActions.locator('optgroup').count(), 0,
    'The phone chart picker should list actions without section headings');
  const chartSections = await chartActions.evaluate(element => [...element.children].map(child =>
    child.tagName === 'HR' ? 'separator' : child.textContent));
  assert.deepEqual(chartSections.slice(0, 3),
    ['Edit chart', 'View data source', 'separator'],
    `Phone chart actions should retain a divider without a heading: ${chartSections}`);
  assert.ok(chartSections[3]?.startsWith('Copy '),
    `The second group should contain copy and export actions: ${chartSections}`);
  const options = await chartActions.locator('option').allTextContents();
  assert.ok(options.includes('Edit chart') && options.includes('View data source')
    && options.includes('Export chart'), `Chart actions should remain in the phone picker: ${options}`);
  await chartActions.selectOption({ label: 'Edit chart' });
  const editor = page.locator('.chart-editor-dialog');
  const header = await editor.locator('.dialog-header').evaluate(element => ({
    title: element.querySelector('h2').getBoundingClientRect().toJSON(),
    actions: element.querySelector('.dialog-header-actions').getBoundingClientRect().toJSON(),
    save: element.querySelector('.chart-editor-save').getBoundingClientRect().toJSON(),
  }));
  assert.ok(header.title.bottom <= header.actions.top + 1,
    `Dashboard chart editor title must have its own mobile row: ${JSON.stringify(header)}`);
  assert.ok(header.save.right <= viewport.width + 1,
    `Dashboard chart editor Save must fit within the viewport: ${JSON.stringify(header)}`);
  const editorButtons = await editor.locator('.dialog-header-actions').evaluate(element => ({
    cancel: element.querySelector('.chart-editor-cancel')?.getBoundingClientRect().toJSON(),
    save: element.querySelector('.chart-editor-save')?.getBoundingClientRect().toJSON(),
  }));
  assert.ok(editorButtons.cancel && editorButtons.save.left - editorButtons.cancel.right <= 12,
    `Dashboard editor Cancel and Save should be grouped: ${JSON.stringify(editorButtons)}`);
  const settings = await editor.locator('[aria-label="Reviewed data settings"]').evaluate(element => {
    const fields = [...element.querySelectorAll(':scope > label')];
    const value = fields[1].querySelector('.select-value');
    return { first: fields[0].getBoundingClientRect().toJSON(), second: fields[1].getBoundingClientRect().toJSON(),
      valueWidth: value.clientWidth, valueContent: value.scrollWidth };
  });
  assert.ok(settings.first.bottom <= settings.second.top + 1 && settings.valueContent <= settings.valueWidth + 1,
    `Dashboard editor fields and selected values must be readable on phones: ${JSON.stringify(settings)}`);
  const panes = await editor.evaluate(element => {
    const preview = element.querySelector('.explorer-preview');
    const controls = element.querySelector('.explorer-controls');
    return { preview: preview.getBoundingClientRect().toJSON(), controls: controls.getBoundingClientRect().toJSON(),
      previewHeight: preview.clientHeight, chartHeight: preview.scrollHeight, overflow: getComputedStyle(preview).overflowY };
  });
  assert.ok(panes.preview.bottom <= panes.controls.top + 1 && panes.chartHeight >= panes.previewHeight
    && panes.overflow === 'auto', `Dashboard chart preview must scroll within its pane: ${JSON.stringify(panes)}`);
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await chartActions.selectOption({ label: 'Export chart' });
  await page.waitForFunction(() => {
    const card = document.querySelector('.chart-export-preview')?.getBoundingClientRect();
    return card && card.right <= innerWidth - 15;
  });
  const exportHeader = await page.locator('.chart-export-dialog .dialog-header').evaluate(element => ({
    title: element.querySelector('h2').getBoundingClientRect().toJSON(),
    close: element.querySelector('button').getBoundingClientRect().toJSON(),
    height: element.getBoundingClientRect().height,
    top: element.querySelector('button').getBoundingClientRect().top - element.getBoundingClientRect().top,
    bottom: element.getBoundingClientRect().bottom - element.querySelector('button').getBoundingClientRect().bottom,
  }));
  assert.ok(Math.abs((exportHeader.title.top + exportHeader.title.bottom - exportHeader.close.top - exportHeader.close.bottom) / 2) <= 2
    && exportHeader.close.right <= viewport.width - 12
    && Math.abs(exportHeader.top - exportHeader.bottom) <= 1,
  `Export title and Close should share one row: ${JSON.stringify(exportHeader)}`);
  assert.equal(await page.locator('.chart-export-footer > button, .chart-export-footer > a').count(), 2,
    'The Close icon already provides a way to dismiss Export chart');
  const exportLayout = await page.locator('.chart-export-dialog').evaluate(element => {
    const rect = selector => element.querySelector(selector).getBoundingClientRect();
    const preview = rect('.chart-export-preview');
    const artwork = element.querySelector('.chart-export-artwork');
    const presets = [...element.querySelectorAll('.chart-export-presets button')].map(button => button.getBoundingClientRect());
    const footer = [...element.querySelectorAll('.chart-export-footer > button, .chart-export-footer > a')]
      .map(button => button.getBoundingClientRect());
    return { titleX: rect('.dialog-header h2').left, previewLeft: preview.left, previewRight: preview.right,
      artworkWidth: artwork.style.width, previewWidth: preview.width, presets: presets.map(box => ({ top: box.top, height: box.height })),
      footer: footer.map(box => ({ left: box.left, top: box.top, width: box.width, height: box.height })) };
  });
  assert.ok(Math.abs(exportLayout.titleX - exportLayout.previewLeft) <= 1
    && Math.abs(viewport.width - exportLayout.previewRight - exportLayout.previewLeft) <= 1,
  `Export title and preview should share even phone gutters: ${JSON.stringify(exportLayout)}`);
  assert.ok(exportLayout.footer.every(box => box.height >= 44) && exportLayout.presets.every(box => box.height >= 44),
    `Export actions must retain phone tap targets: ${JSON.stringify(exportLayout)}`);
  if (viewport.name === 'phone') {
    assert.ok(exportLayout.presets.every(box => Math.abs(box.top - exportLayout.presets[0].top) < 1)
      && exportLayout.footer.every(box => Math.abs(box.width - exportLayout.footer[0].width) < 1),
    `390px export presets and footer should fit one balanced row: ${JSON.stringify(exportLayout)}`);
  }
  await page.getByRole('button', { name: 'Slide', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.chart-export-preview')?.getBoundingClientRect().right <= innerWidth - 15);
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await page.locator('.chart-export-dialog .dialog-header button').click();
  await chooseTopAction(page, 'Switch theme');
  await page.locator('.theme-drawer.is-open').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const drawer = await page.evaluate(() => {
    const topbar = document.querySelector('.dashboard-topbar').getBoundingClientRect();
    const picker = document.querySelector('.theme-drawer').getBoundingClientRect();
    const filter = document.querySelector('.filter-bar').getBoundingClientRect();
    return { headerBottom: topbar.bottom, pickerTop: picker.top, pickerBottom: picker.bottom, filterTop: filter.top };
  });
  assert.ok(drawer.pickerTop >= drawer.headerBottom - 1 && drawer.filterTop >= drawer.pickerBottom - 1,
    `Theme picker should sit below the topbar and above filters: ${JSON.stringify(drawer)}`);
  await page.getByRole('button', { name: 'Close theme picker' }).click();
}

async function checkReport(page, viewport, browserName) {
  await page.locator('.report-page').waitFor();
  await checkWidth(page, `${browserName} report ${viewport.name}`);
  await checkTitleInfoSpacing(page, viewport, `${browserName} report ${viewport.name}`);
  if (viewport.width <= 430) {
    await checkPhoneChrome(page, `${browserName} report ${viewport.name}`);
    const type = await page.evaluate(() => {
      const style = selector => {
        const element = document.querySelector(selector);
        const css = getComputedStyle(element);
        return { size: css.fontSize, weight: css.fontWeight, spacing: css.letterSpacing };
      };
      return { title: style('.report-hero h1'), lead: style('.report-summary-lead h2'), section: style('.report-section .report-analysis h2') };
    });
    assert.equal(type.title.size, '32px');
    assert.equal(type.title.weight, '600');
    assert.equal(type.lead.weight, '500');
    assert.equal(type.lead.spacing, '-0.4px');
    assert.deepEqual(type.section, type.lead, 'Peer report section headings should use one mobile type style');
  }
  if (browserName !== 'chromium' || viewport.width > 430) return;
  await checkPhoneActionMenu(page, viewport, `${browserName} report ${viewport.name}`);
  if (viewport.name !== 'phone') return;
  await chooseTopAction(page, 'Publish');
  await page.getByRole('dialog', { name: /Publish report/ }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await chooseTopAction(page, 'Edit text and layout');
  await page.locator('.dashboard-topbar').getByRole('button', { name: 'Cancel', exact: true }).click();
}

async function checkInline(page, viewport, browserName) {
  const actions = page.locator('.component-native-actions select');
  await page.locator('.data-inline-chart-content').waitFor();
  const native = await actions.isVisible();
  await checkWidth(page, `${browserName} inline ${viewport.name}`);
  await checkTitleInfoSpacing(page, viewport, `${browserName} inline ${viewport.name}`, { inline: true });
  if (!['small-phone', 'phone'].includes(viewport.name)) return;
  assert.ok(native, `${browserName} ${viewport.name}: inline actions use the native mobile picker`);
  if (process.env.DATA_CAPTURE_PR && browserName === 'chromium' && viewport.name === 'phone')
    await page.locator('.data-inline-chart-content').screenshot({ path: '/tmp/data-mobile-inline-chart-pr.png' });
  if (native) await actions.selectOption('edit');
  else {
    await page.locator('.component-custom-actions button.menu-trigger').click();
    await page.getByRole('menuitem', { name: 'Edit chart' }).click();
  }
  const editor = page.locator('.chart-editor-dialog--contained');
  await editor.waitFor();
  const positions = await editor.evaluate(element => Object.fromEntries(
    ['history', 'reset', 'cancel', 'save'].map(name => [name,
      element.querySelector(`.chart-editor-${name}`).getBoundingClientRect().toJSON()])));
  assert.ok(positions.history.bottom <= positions.cancel.top + 1 && positions.reset.bottom <= positions.save.top + 1,
    `${browserName} ${viewport.name}: editor actions must form two balanced rows: ${JSON.stringify(positions)}`);
  assert.ok(positions.cancel.right <= positions.save.left + 1,
    `${browserName} ${viewport.name}: Cancel and Apply must sit together`);
  await checkWidth(page, `${browserName} inline editor ${viewport.name}`);
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await editor.waitFor({ state: 'hidden' });
}

async function checkSources(page, viewport, browserName) {
  const disclosure = page.locator('.receipt-disclosure');
  await disclosure.waitFor();
  await checkWidth(page, `${browserName} sources ${viewport.name}`);
  if (!['small-phone', 'phone'].includes(viewport.name)) return;
  const disclosureHeight = await disclosure.evaluate(element => element.getBoundingClientRect().height);
  assert.ok(disclosureHeight >= 44, `${browserName} ${viewport.name}: Sources disclosure needs a 44px touch region`);
  await disclosure.click();
  await page.locator('.receipt-card').waitFor();
  const expander = page.locator('.receipt-expander');
  assert.equal(await expander.getAttribute('data-open'), 'true', `${browserName} ${viewport.name}: Sources must expand on tap`);
  await expander.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
  assert.ok(await expander.evaluate(element => Number(getComputedStyle(element).opacity) > .99),
    `${browserName} ${viewport.name}: expanded Sources must be visible`);
  const targets = await page.locator('.receipt-card').first().evaluate(card => ({
    toggle: card.querySelector('.receipt-card-toggle')?.getBoundingClientRect().height,
    tabs: [...card.querySelectorAll('[role="tab"]')].map(tab => ({
      height: tab.getBoundingClientRect().height,
      fontSize: parseFloat(getComputedStyle(tab).fontSize),
      padding: parseFloat(getComputedStyle(tab).paddingInlineStart),
    })),
  }));
  assert.ok((targets.toggle === undefined || targets.toggle >= 44) && targets.tabs.every(tab => tab.height >= 44),
    `${browserName} ${viewport.name}: Sources card actions need 44px touch regions: ${JSON.stringify(targets)}`);
  assert.ok(targets.tabs.every(tab => tab.fontSize >= 15 && tab.padding >= 12),
    `${browserName} ${viewport.name}: Sources tabs need readable labels and room around them: ${JSON.stringify(targets)}`);
  const readingSizes = await page.locator('.sources-receipt').evaluate(receipt =>
    ['.receipt-disclosure', '.receipt-qualification-list li', '.source-row-title']
      .map(selector => receipt.querySelector(selector))
      .filter(Boolean)
      .map(element => parseFloat(getComputedStyle(element).fontSize)));
  assert.ok(readingSizes.length >= 2 && readingSizes.every(size => size >= 14),
    `${browserName} ${viewport.name}: Sources labels and body must remain legible: ${readingSizes}`);
  if (process.env.DATA_CAPTURE_PR && browserName === 'chromium' && viewport.name === 'phone')
    await page.locator('.sources-receipt').screenshot({ path: '/tmp/data-mobile-sources-card-pr.png' });
  const lastTab = page.getByRole('tab', { name: 'Evidence flow' });
  await lastTab.click();
  assert.equal(await lastTab.getAttribute('aria-selected'), 'true');
  await checkWidth(page, `${browserName} expanded sources ${viewport.name}`);
}

try {
  const targets = { dashboard: buildApp('dashboard'), report: buildApp('report'), inline: buildInline('chart'), sources: buildInline('sources') };
  for (const [browserName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    let browser = null;
    try {
      for (const [surface, path] of Object.entries(targets)) {
        for (const viewport of viewports) {
          // WebKit's inspector can close after a single-file app interaction on this host.
          // Keep static app checks isolated; inline interactions run in both engines.
          if (!browser || !browser.isConnected()) browser = await engine.launch(browserName === 'chromium'
            ? { executablePath: resolveChromiumExecutable(), headless: true } : { headless: true });
          const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height },
            hasTouch: true, isMobile: viewport.name !== 'desktop', colorScheme: 'light' });
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.goto(pathToFileURL(path).href, { waitUntil: 'load' });
          if (surface === 'dashboard') await checkDashboard(page, viewport, browserName);
          else if (surface === 'report') await checkReport(page, viewport, browserName);
          else if (surface === 'inline') await checkInline(page, viewport, browserName);
          else await checkSources(page, viewport, browserName);
          assert.deepEqual(errors, [], `${browserName} ${surface} ${viewport.name} page errors`);
          await page.close().catch(() => {});
          if (browserName === 'webkit' && ['dashboard', 'report'].includes(surface)) {
            await browser.close().catch(() => {});
            browser = null;
          }
        }
      }
    } finally { await browser?.close().catch(() => {}); }
  }
  const desktopBrowser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  try {
    for (const width of [390, 760]) {
      const page = await desktopBrowser.newPage({ viewport: { width, height: 844 } });
      await page.goto(pathToFileURL(targets.dashboard).href);
      const controls = await page.locator('.filters.filter-bar .custom-select-host > .filter-trigger')
        .evaluateAll(elements => elements.map(element => ({
          label: element.querySelector('.filter-label')?.getBoundingClientRect().height,
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        })));
      assert.ok(controls[0].width >= 150 && controls[0].label <= 22 && controls[0].height <= 44 &&
        controls[1].width >= 100,
      `Narrow desktop filter chips should keep full labels without shrinking: ${width} ${JSON.stringify(controls)}`);
      if (width === 390) {
        assert.ok(await page.locator('.dashboard-custom-overflow button.dashboard-header-overflow-button').isVisible(),
          'Narrow mouse layouts retain the custom More menu');
        assert.equal(await page.locator('.dashboard-native-overflow').isVisible(), false,
          'The native picker appears only with a coarse touch pointer');
      }
      await checkWidth(page, `narrow desktop dashboard ${width}`);
      await page.close();
    }
  } finally { await desktopBrowser.close(); }
  console.log('PASS: touch-enabled mobile, tablet, landscape, and desktop geometry in Chromium and WebKit; app actions in Chromium; inline editing and Sources tabs in both engines.');
} finally { rmSync(workspace, { recursive: true, force: true }); }
