import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright-core';
import { forceLocalDataAppMount, resolveChromiumExecutable, runDataAppFixtureBuild } from './browser-helpers.mjs';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = mkdtempSync(join(tmpdir(), 'data-mobile-touch-'));
const hostedPages = {};
function buildApp(surface) {
  const project = join(workspace, surface);
  cpSync(join(pluginRoot, 'templates/data-app/base'), project, { recursive: true,
    filter: path => !path.includes('/node_modules') && !path.includes('/dist') });
  if (surface === 'report') {
    const path = join(project, 'src/data.json');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), surface }));
  }
  const result = runDataAppFixtureBuild(project, { pluginRoot });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const path = join(project, 'dist/index.html');
  hostedPages[surface] = readFileSync(path, 'utf8');
  writeFileSync(path, forceLocalDataAppMount(hostedPages[surface]));
  return pathToFileURL(path).href;
}
const targets = { dashboard: buildApp('dashboard'), report: buildApp('report') };
async function chooseTopAction(page, label) {
  await page.locator('.dashboard-topbar-title').waitFor();
  const value = await page.locator('.dashboard-native-overflow option').evaluateAll((options, name) =>
    options.find(option => option.textContent.trim() === name)?.value, label);
  assert.ok(value, `Missing native action: ${label}`);
  const more = page.locator('.dashboard-native-overflow select');
  await more.selectOption(value);
  assert.equal(await page.evaluate(() => document.querySelector('.dashboard-native-overflow select')?.selectedIndex ?? -1), -1,
    `${label}: selecting a command must leave no checkmarked option`);
}
try {
for (const [name, engine] of process.env.DATA_TOUCH_WEBKIT === '1'
  ? [['webkit', webkit]] : [['chromium', chromium]]) {
  const browser = await engine.launch(name === 'chromium'
    ? { executablePath: resolveChromiumExecutable(), headless: true } : { headless: true });
  try {
    for (const surface of ['dashboard', 'report']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(targets[surface], { waitUntil: 'load' });
      const more = page.getByRole('combobox', { name: 'More' });
      await more.waitFor();
      assert.ok((await more.boundingBox()).width >= 44,
        `${name} ${surface}: native actions need a usable hit target`);
      assert.equal(await more.evaluate(element => element.selectedIndex), -1,
        `${name} ${surface}: native action menu starts without a selection`);
      assert.equal(await more.locator('option').filter({ hasText: 'Choose action' }).count(), 0,
        `${name} ${surface}: native action menu has no placeholder option`);
      assert.ok((await more.locator('option').allTextContents()).every(text => /^[\p{L}\p{N}]/u.test(text)),
        `${name} ${surface}: native commands should have text labels instead of decorative glyphs`);
      const chartActions = page.locator('.dashboard-component[data-component-kind="chart"] .component-native-actions select').first();
      await chartActions.waitFor();
      const chartBox = await chartActions.boundingBox();
      assert.ok(chartBox?.width >= 44,
        `${name} ${surface}: card actions need a usable native picker target: ${JSON.stringify(chartBox)}`);
      const chartOptions = await chartActions.locator('option').allTextContents();
      assert.equal(await chartActions.evaluate(element => element.selectedIndex), -1,
        `${name} ${surface}: chart actions should start without a selected checkmark`);
      assert.ok(!chartOptions.includes('Choose action'), `${name} ${surface}: chart actions should have no placeholder`);
      assert.ok(chartOptions.includes('View data source')
        && (surface === 'report' || chartOptions.includes('Export chart')),
        `${name} ${surface}: chart actions should appear in the native picker: ${chartOptions}`);
      await chartActions.selectOption({ label: 'View data source' });
      assert.equal(await chartActions.evaluate(element => element.selectedIndex), -1,
        `${name} ${surface}: chart actions should reset after selection`);
      await page.locator('.source-sidebar').waitFor({ state: 'visible' });
      await page.locator('.source-sidebar').getByRole('button', { name: 'Close data source' }).click();
      await page.locator('.source-sidebar').waitFor({ state: 'hidden' });
      await chartActions.selectOption({ label: 'View data source' });
      await page.locator('.source-sidebar').waitFor({ state: 'visible' });
      await page.locator('.source-sidebar').getByRole('button', { name: 'Close data source' }).click();
      await page.locator('.source-sidebar').waitFor({ state: 'hidden' });
      if (surface === 'dashboard') {
        const date = page.getByRole('combobox', { name: 'Date range' });
        assert.ok((await date.boundingBox()).height >= 44, `${name}: date presets use a native hit region`);
        await date.selectOption({ index: 2 });
        assert.equal(await date.inputValue(), '', `${name}: the same date preset can be selected again`);
        await date.selectOption('custom');
        const calendar = page.locator('.date-range-calendar');
        await calendar.waitFor();
        if (process.env.DATA_TOUCH_CUSTOM_SCREENSHOT_PATH)
          await page.screenshot({ path: process.env.DATA_TOUCH_CUSTOM_SCREENSHOT_PATH });
        assert.equal(await calendar.locator('input[type="date"]').count(), 0,
          `${name}: custom dates should use the existing calendar`);
        await calendar.getByRole('button', { name: 'Monday, July 6, 2026' }).click();
        await calendar.getByRole('button', { name: 'Monday, July 20, 2026' }).click();
        await calendar.waitFor({ state: 'hidden' });
        const nativeSegment = page.locator('.native-filter-control[aria-label="Product segment"]');
        await nativeSegment.selectOption('Studio');
        assert.equal(await nativeSegment.inputValue(), 'Studio');
        assert.match(await page.locator('.native-filter-shell').filter({ has: nativeSegment }).textContent(), /Studio/);
        if (process.env.DATA_TOUCH_FILTER_SCREENSHOT_PATH)
          await page.screenshot({ path: process.env.DATA_TOUCH_FILTER_SCREENSHOT_PATH });
        await chooseTopAction(page, 'Schedule refresh');
        const scheduleDialog = page.getByRole('dialog', { name: 'Schedule refresh' });
        const repeat = page.locator('.native-filter-control[aria-label="Repeat schedule"]');
        assert.equal(await scheduleDialog.evaluate(element => element.contains(document.activeElement)
          && document.activeElement.classList.contains('dialog-header')), true,
        `${name}: opening Schedule refresh focuses its heading, not the native Repeat picker`);
        assert.equal(await repeat.evaluate(element => element === document.activeElement), false,
          `${name}: Repeat should wait for an intentional tap`);
        await repeat.selectOption('weekly');
        assert.equal(await repeat.inputValue(), 'weekly');
        const time = page.locator('.native-filter-control[aria-label="Refresh time"]');
        await time.selectOption({ index: 1 });
        assert.notEqual(await time.inputValue(), '');
        await page.getByRole('dialog', { name: 'Schedule refresh' }).getByRole('button', { name: 'Close' }).click();
        await chooseTopAction(page, 'Switch theme');
        await page.locator('.theme-drawer.is-open').waitFor();
        await page.getByRole('button', { name: 'Close theme picker' }).click();
        await chooseTopAction(page, 'Switch theme');
        await page.locator('.theme-drawer.is-open').waitFor();
        await page.getByRole('button', { name: 'Close theme picker' }).click();
      }
      const info = page.locator('.dashboard-component .info-wrap > button.info').first();
      await info.scrollIntoViewIfNeeded();
      const infoBox = await info.boundingBox();
      await page.touchscreen.tap(infoBox.x + infoBox.width / 2, infoBox.y + infoBox.height / 2);
      await page.locator('.info-tooltip[data-tooltip-portal="true"]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.info-tooltip[data-tooltip-portal="true"]').count(), 1,
        `${name} ${surface}: tap should show one tooltip`);
      await page.touchscreen.tap(infoBox.x + infoBox.width / 2, infoBox.y + infoBox.height / 2);
      await page.locator('.info-tooltip[data-tooltip-portal="true"]').waitFor({ state: 'hidden' });
      await page.touchscreen.tap(infoBox.x + infoBox.width / 2, infoBox.y + infoBox.height / 2);
      await page.locator('.info-tooltip[data-tooltip-portal="true"]').waitFor({ state: 'visible' });
      await page.touchscreen.tap(20, 310);
      await page.locator('.info-tooltip[data-tooltip-portal="true"]').waitFor({ state: 'hidden' });
      await page.mouse.move(infoBox.x + infoBox.width / 2, infoBox.y + infoBox.height / 2);
      await page.locator('.info-tooltip[data-tooltip-portal="true"]').waitFor({ state: 'visible' });
      await page.mouse.move(20, 310);
      await page.locator('.info-tooltip[data-tooltip-portal="true"]').waitFor({ state: 'hidden' });
      await info.focus();
      await page.locator('.info-tooltip[data-tooltip-portal="true"]').waitFor({ state: 'visible' });
      await page.keyboard.press('Tab');
      await page.locator('.info-tooltip[data-tooltip-portal="true"]').waitFor({ state: 'hidden' });
      assert.deepEqual(errors, [], `${name} ${surface} page errors`);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(targets.dashboard, { waitUntil: 'load' });
    await chooseTopAction(page, 'Ask ChatGPT');
    const dialog = page.getByRole('dialog', { name: 'Ask ChatGPT about this dashboard' });
    await dialog.waitFor();
    if (process.env.DATA_TOUCH_SCREENSHOT_PATH)
      await page.screenshot({ path: process.env.DATA_TOUCH_SCREENSHOT_PATH });
    const shape = await dialog.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { bottom: box.bottom, width: box.width, height: box.height, viewport: window.innerHeight };
    });
    assert.ok(shape.height >= 700 && shape.width === 390 && Math.abs(shape.bottom - shape.viewport) < 1,
      `${name}: Ask composer should fill the phone viewport: ${JSON.stringify(shape)}`);
    assert.equal(await dialog.getAttribute('aria-modal'), 'true', `${name}: phone composer traps focus`);
    await page.setViewportSize({ width: 844, height: 390 });
    assert.equal(await dialog.getAttribute('aria-modal'), null, `${name}: landscape composer releases modal semantics`);
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden',
      `${name}: rotating to landscape releases page scroll`);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await dialog.getAttribute('aria-modal'), 'true', `${name}: portrait composer restores modal semantics`);
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden',
      `${name}: rotating back to portrait locks page scroll`);
    assert.equal(await dialog.evaluate(element => getComputedStyle(element).boxShadow), 'none',
      `${name}: the full-screen Ask view should have no bottom edge above the keyboard`);
    const askHeader = await dialog.evaluate(element => {
      const header = element.querySelector('.dashboard-ask-mobile-heading');
      const title = header.querySelector('span');
      const close = header.querySelector('button');
      return { height: header.getBoundingClientRect().height, fontSize: getComputedStyle(title).fontSize,
        fontWeight: getComputedStyle(title).fontWeight, icon: close.querySelector('[data-dashboard-icon="cross"]')?.getBoundingClientRect().width,
        closeTop: close.getBoundingClientRect().top - header.getBoundingClientRect().top,
        closeBottom: header.getBoundingClientRect().bottom - close.getBoundingClientRect().bottom };
    });
    assert.ok(askHeader.height === 50 && askHeader.fontSize === '16px' && askHeader.fontWeight === '500'
      && askHeader.icon === 20 && Math.abs(askHeader.closeTop - askHeader.closeBottom) <= 1,
    `${name}: Ask header should match the balanced Export chart mobile header: ${JSON.stringify(askHeader)}`);
    const suggestions = dialog.getByRole('group', { name: 'Suggested actions' });
    const initialSuggestions = await suggestions.locator('a, button').count();
    assert.ok(initialSuggestions > 0, `${name}: Ask composer should offer suggestions`);
    await dialog.getByRole('textbox', { name: 'Question for ChatGPT' }).fill('What changed?');
    assert.equal(await suggestions.locator('a, button').count(), initialSuggestions,
      `${name}: typing on a phone should keep suggestions available`);
    const icons = await dialog.evaluate(element => ({
      close: element.querySelector('.dashboard-ask-mobile-heading button [data-dashboard-icon="cross"]')?.getBoundingClientRect().width,
      send: element.querySelector('.dashboard-ask-submit [data-dashboard-icon="sendUp"]')?.getBoundingClientRect().width,
    }));
    assert.ok(icons.close >= 20 && icons.send >= 20,
      `${name}: close and send icons should be legible on a phone: ${JSON.stringify(icons)}`);
    const assertSendInside = async () => {
      const field = await dialog.getByRole('textbox', { name: 'Question for ChatGPT' }).boundingBox();
      const send = await dialog.locator('.dashboard-ask-submit').boundingBox();
      assert.ok(send.x >= field.x && send.y >= field.y
        && send.x + send.width <= field.x + field.width
        && send.y + send.height <= field.y + field.height,
        `Send must remain inside the filled field: ${JSON.stringify({ field, send })}`);
    };
    await assertSendInside();
    await page.setViewportSize({ width: 390, height: 420 });
    await assertSendInside();
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.getByRole('button', { name: 'Close Ask ChatGPT' }).click();
    await dialog.waitFor({ state: 'hidden' });
    if (name === 'chromium') {
      await chooseTopAction(page, 'Edit text and layout');
      const handles = page.locator('.block-drag-keyboard');
      const firstCard = await page.locator('.sortable-item > .dashboard-component').nth(0).boundingBox();
      const nextCard = await page.locator('.sortable-item > .dashboard-component').nth(1).boundingBox();
      assert.ok(nextCard.y - (firstCard.y + firstCard.height) <= 20,
        'Mobile edit cards keep their normal spacing without visible Move controls');
      assert.ok((await handles.first().boundingBox()).width <= 1,
        'The keyboard move control remains available without taking up layout space');
      const saveStyle = await page.getByRole('button', { name: 'Save', exact: true }).evaluate(element => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, text: style.color };
      });
      assert.notEqual(saveStyle.background, 'rgba(0, 0, 0, 0)', 'Save stays a primary action on phones');
      assert.notEqual(saveStyle.background, saveStyle.text, 'Save keeps contrasting text');
      if (process.env.DATA_MOBILE_EDIT_SCREENSHOT_PATH)
        await page.screenshot({ path: process.env.DATA_MOBILE_EDIT_SCREENSHOT_PATH });
      const order = () => page.locator('.sortable-item[data-sortable-item-id]')
        .evaluateAll(elements => elements.map(element => element.dataset.sortableItemId));
      const originalOrder = await order();
      const client = await page.context().newCDPSession(page);
      let x = firstCard.x + 70, y = firstCard.y + 26;
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 55, id: 1 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.deepEqual(await order(), originalOrder, 'A swipe before the hold threshold scrolls without moving a card');
      await page.locator('.sortable-item[data-sortable-item-id="active-users"]')
        .scrollIntoViewIfNeeded();
      const heldCard = await page.locator('.sortable-item > .dashboard-component').nth(0).boundingBox();
      const destination = await page.locator('.sortable-item > .dashboard-component').nth(1).boundingBox();
      x = heldCard.x + 70; y = heldCard.y + 72;
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(420);
      for (let step = 1; step <= 12; step++) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
          x, y: y + (destination.y + destination.height / 2 - y) * step / 12, id: 1,
        }] });
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.notDeepEqual(await order(), originalOrder, 'A touch drag reorders the stacked phone cards');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.deepEqual(await order(), originalOrder, 'Cancel restores the original order after a touch drag');
      await page.locator('.block-drag-preview').waitFor({ state: 'hidden' });
      const chartActions = page.locator('[data-component-id="usage-trend"] .component-native-actions select');
      await chartActions.selectOption({ label: 'Edit chart' });
      const chartEditor = page.locator('.chart-editor-dialog');
      await chartEditor.waitFor({ state: 'visible' });
      const split = chartEditor.getByRole('combobox', { name: 'Split series by' });
      await split.waitFor();
      assert.ok((await split.locator('option').allTextContents()).includes('No series'),
        'The native Split by picker labels its empty series choice');
      assert.equal(await split.evaluate(element => element.parentElement?.querySelector('.select-value')?.textContent), 'No series',
        'The collapsed Split by control also labels the empty selection');
      await split.selectOption({ label: 'Segment' });
      assert.equal(await split.inputValue(), 'segment');
      const editorSave = chartEditor.getByRole('button', { name: 'Save', exact: true });
      assert.equal(await editorSave.isEnabled(), true, 'Save becomes available after editing the chart');
      const editorSaveStyle = await editorSave.evaluate(element => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, text: style.color };
      });
      assert.notEqual(editorSaveStyle.background, 'rgba(0, 0, 0, 0)', 'Chart editor Save has a filled primary style');
      assert.notEqual(editorSaveStyle.background, editorSaveStyle.text, 'Chart editor Save has contrasting text');
      if (process.env.DATA_MOBILE_CHART_EDITOR_SCREENSHOT_PATH)
        await page.screenshot({ path: process.env.DATA_MOBILE_CHART_EDITOR_SCREENSHOT_PATH });
      await chartEditor.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    assert.deepEqual(pageErrors, [], `${name} mobile editing page errors`);
    await page.close();
    if (name === 'chromium') {
      const hosted = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await hosted.route('https://qa.example.chatgpt.site/**', route => {
        const path = new URL(route.request().url()).pathname;
        const payload = path === '/api/snapshot'
          ? JSON.parse(readFileSync(join(pluginRoot, 'templates/data-app/base/src/data.json'), 'utf8'))
          : path === '/api/presentation' ? { canEdit: true, presentation: {}, revision: 0 } : null;
        return route.fulfill(payload
          ? { contentType: 'application/json', body: JSON.stringify(payload) }
          : { contentType: 'text/html', body: hostedPages.dashboard });
      });
      await hosted.goto('https://qa.example.chatgpt.site/dashboard', { waitUntil: 'load' });
      await chooseTopAction(hosted, 'Create a copy');
      const handoff = hosted.getByRole('dialog', { name: 'Open in ChatGPT', exact: true });
      await handoff.waitFor();
      const openOnWeb = handoff.getByRole('link', { name: 'Open on web' });
      assert.match(await openOnWeb.getAttribute('href'), /^https:\/\/chatgpt\.com\//,
        `${name}: the native picker exposes a real ChatGPT destination link`);
      const popupPromise = hosted.waitForEvent('popup', { timeout: 5000 });
      await openOnWeb.click();
      const popup = await popupPromise;
      await popup.waitForURL(/^https:\/\/chatgpt\.com\//, { timeout: 10000 });
      assert.match(popup.url(), /^https:\/\/chatgpt\.com\//,
        `${name}: a menu command must preserve the hosted ChatGPT handoff`);
      await popup.close();
      await hosted.close();
    }
  } finally { await browser.close(); }
}
console.log(`PASS: touch release, drag cancellation, tooltip tap and dismissal, mobile Ask in ${process.env.DATA_TOUCH_WEBKIT === '1' ? 'WebKit' : 'Chromium'}`);
} finally { rmSync(workspace, { recursive: true, force: true }); }
