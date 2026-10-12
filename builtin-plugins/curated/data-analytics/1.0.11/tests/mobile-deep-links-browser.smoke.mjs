import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { forceLocalDataAppMount, installDashboardBrowserMocks, resolveChromiumExecutable, runDataAppFixtureBuild } from './browser-helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = mkdtempSync(join(tmpdir(), 'data-mobile-links-'));
const snapshot = JSON.parse(readFileSync(join(root, 'templates/data-app/base/src/data.json'), 'utf8'));
const html = {};
let browser;

async function open(surface, hosted = true) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installDashboardBrowserMocks(page);
  await context.route('https://mobile-links.workspace-a.chatgpt.site/**', route => {
    const path = new URL(route.request().url()).pathname;
    const payload = path === '/api/snapshot' ? { ...snapshot, surface }
      : path === '/api/presentation' ? { canEdit: true, presentation: {}, revision: 0 } : null;
    return route.fulfill(payload
      ? { contentType: 'application/json', body: JSON.stringify(payload) }
      : { contentType: 'text/html', body: html[surface][hosted ? 'hosted' : 'static'] });
  });
  await page.goto(`https://mobile-links.workspace-a.chatgpt.site/${surface}`, { waitUntil: 'load' });
  await page.locator('.dashboard-topbar-title').waitFor();
  return { page, context, errors };
}

async function chooseNative(page, label) {
  const select = page.locator('.dashboard-native-overflow select');
  const value = await select.locator('option').evaluateAll((options, text) => options
    .find(option => option.textContent.trim() === text)?.value, label);
  assert.ok(value, `Missing ${label} from the mobile action menu`);
  await select.selectOption(value);
  assert.equal(await select.evaluate(element => element.selectedIndex), -1);
}

async function checkChooser(page, action, expectedPrompt) {
  const dialog = page.getByRole('dialog', { name: 'Open in ChatGPT', exact: true });
  await dialog.waitFor();
  const desktop = new URL(await dialog.getByRole('link', { name: 'Open in desktop' }).getAttribute('href'));
  const web = new URL(await dialog.getByRole('link', { name: 'Open on web' }).getAttribute('href'));
  assert.equal(desktop.protocol, 'codex:', action);
  assert.equal(web.origin, 'https://chatgpt.com', action);
  assert.equal(web.searchParams.get('disable_auto_send'), '1', action);
  assert.match(web.searchParams.get('q'), expectedPrompt, action);
  const before = await page.evaluate(() => window.__dashboardDeepLinks.length);
  await dialog.getByRole('link', { name: 'Open on web' }).click();
  await page.waitForFunction(count => window.__dashboardDeepLinks.length === count + 1, before);
  const event = await page.evaluate(() => window.__dashboardNavigationEvents.at(-1));
  assert.equal(event.trusted, true, `${action}: destination must open from a real tap, not a synthetic click`);
  await dialog.waitFor({ state: 'hidden' });
}

try {
  for (const surface of ['dashboard', 'report']) {
    const project = join(workspace, surface);
    cpSync(join(root, 'templates/data-app/base'), project, { recursive: true,
      filter: path => !path.includes('/node_modules') && !path.includes('/dist') });
    if (surface === 'report') writeFileSync(join(project, 'src/data.json'), JSON.stringify({ ...snapshot, surface }));
    const build = runDataAppFixtureBuild(project, { pluginRoot: root });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    const built = readFileSync(join(project, 'dist/index.html'), 'utf8');
    html[surface] = { hosted: built, static: forceLocalDataAppMount(built) };
  }
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  for (const hosted of [true, false]) {
    for (const surface of ['dashboard', 'report']) {
      const { page, context, errors } = await open(surface, hosted);
      let directCount = 0;
      const checkHandoff = hosted ? checkChooser : async (page, action, expectedPrompt) => {
        await page.waitForFunction(count => window.__dashboardDeepLinks.length === count + 1, directCount);
        directCount += 1;
        const href = new URL(await page.evaluate(() => window.__dashboardDeepLinks.at(-1)));
        assert.equal(href.origin, 'https://chatgpt.com', `${action}: static preview opens directly on web`);
        assert.equal(href.searchParams.get('disable_auto_send'), '1', action);
        assert.match(href.searchParams.get('q'), expectedPrompt, action);
        const event = await page.evaluate(() => window.__dashboardNavigationEvents.at(-1));
        assert.equal(event.connected, true, `${action}: the destination anchor must remain connected during activation`);
      };
      for (const [action, pattern] of [
        ...(surface === 'dashboard' ? [['Refresh now', /refresh this existing dashboard/u],
          ['Create a copy', /create a new, separate dashboard/u]] : []),
        ['PDF', /\$data-analytics:report-to-pdf\b/u],
        ['Word document', /DOCX/u], ['PowerPoint', /PPTX/u], ['Google Docs', /Google Doc/u],
        ['Google Slides', /Google Slides/u], ['Jupyter Notebook', /ipynb/u],
      ]) {
        await chooseNative(page, action);
        await checkHandoff(page, `${surface} ${hosted ? 'hosted' : 'static'} ${action}`, pattern);
      }
      assert.equal(await page.evaluate(() => window.__dashboardPrints), 0,
        `${surface}: native PDF export must hand off to the agent without opening browser print`);
      await chooseNative(page, 'Ask ChatGPT');
      const composer = page.getByRole('dialog', { name: 'Ask ChatGPT about this dashboard' });
      await composer.waitFor();
      await composer.getByRole('textbox', { name: 'Question for ChatGPT' }).fill('Explain this view.');
      await composer.getByRole('link', { name: 'Send to ChatGPT' }).click();
      await checkHandoff(page, `${surface} Ask`, /Explain this view\./u);
      await chooseNative(page, 'Ask ChatGPT');
      const suggestion = page.getByRole('dialog', { name: 'Ask ChatGPT about this dashboard' })
        .getByRole('link', { name: 'Share Key Insights' });
      await suggestion.click();
      await checkHandoff(page, `${surface} suggestion`, /summary/u);
      if (surface === 'report') {
        const followUp = page.locator('a.report-task-link').first();
        assert.ok(await followUp.count(), 'The report has an authored follow-up link');
        await followUp.click();
        await checkHandoff(page, `${surface} follow-up`, /report/u);
      }
      if (hosted) {
        const chart = page.locator('.dashboard-component[data-component-kind="chart"] .component-native-actions select').first();
        const copy = await chart.locator('option').evaluateAll(options => options.find(option => option.textContent === 'Copy link')?.value);
        assert.ok(copy, `${surface}: published chart has a mobile Copy link command`);
        const before = await page.evaluate(() => window.__dashboardClipboard.length);
        await chart.selectOption(copy);
        await page.waitForFunction(count => window.__dashboardClipboard.length === count + 1, before);
        const copied = await page.evaluate(() => window.__dashboardClipboard.at(-1));
        assert.match(copied, /^https:\/\/mobile-links\.workspace-a\.chatgpt\.site\/_data\/charts\//u);
        await page.goto(copied, { waitUntil: 'load' });
        await page.locator('[data-permalink-target="true"]').waitFor();
        await page.goto(`https://mobile-links.workspace-a.chatgpt.site/${surface}`, { waitUntil: 'load' });
        await page.locator('.dashboard-topbar-title').waitFor();
      }
      if (surface === 'dashboard' && hosted) {
        await chooseNative(page, 'Schedule refresh');
        const schedule = page.getByRole('dialog', { name: 'Schedule refresh' });
        await schedule.waitFor();
        await schedule.getByRole('button', { name: 'Schedule refresh' }).click();
        await checkHandoff(page, 'Schedule refresh', /schedule refreshes/u);
        await schedule.getByRole('button', { name: 'Close' }).click();
        const metric = page.locator('.dashboard-component[data-component-kind="metric"]').first();
        const select = metric.locator('.component-native-actions select');
        const value = await select.locator('option').evaluateAll(options => options.find(option => option.textContent === 'Copy link')?.value);
        assert.ok(value, 'Published metric has a mobile Copy link command');
        await select.selectOption(value);
        await page.waitForFunction(() => window.__dashboardClipboard.length > 0);
        const copied = await page.evaluate(() => window.__dashboardClipboard.at(-1));
        assert.match(copied, /^https:\/\/mobile-links\.workspace-a\.chatgpt\.site\/_data\/components\//u);
        await page.goto(copied, { waitUntil: 'load' });
        await page.locator('[data-permalink-target="true"]').waitFor();
        await page.evaluate(() => { document.cookie = 'data_app_handoff_destination_v1=web; Domain=.workspace-a.chatgpt.site; Path=/; Secure; SameSite=Lax'; });
        await chooseNative(page, 'Refresh now');
        await checkHandoff(page, 'Remembered web choice from native picker', /refresh this existing dashboard/u);
      }
      assert.deepEqual(errors, [], `${surface} ${hosted ? 'hosted' : 'static'} browser errors`);
      await context.close();
    }
  }
  console.log('PASS: mobile native handoffs, Ask, report follow-ups, refresh schedule, chart/metric permalinks, hosted and static examples');
} finally {
  await browser?.close();
  rmSync(workspace, { recursive: true, force: true });
}
