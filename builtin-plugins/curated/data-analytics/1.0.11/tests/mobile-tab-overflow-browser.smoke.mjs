import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright-core';
import { forceLocalDataAppMount, resolveChromiumExecutable, runDataAppFixtureBuild } from './browser-helpers.mjs';

const plugin = join(dirname(fileURLToPath(import.meta.url)), '..');
const project = mkdtempSync(join(tmpdir(), 'data-tab-overflow-'));
const pages = Array.from({ length: 9 }, (_, index) => ({ id: `page-${index}`, label: `Dashboard page ${index + 1}` }));
const generic = Array.from({ length: 8 }, (_, index) => ({ id: `section-${index}`, label: `Analysis section ${index + 1}` }));
const metrics = Array.from({ length: 6 }, (_, index) => ({ id: `metric-${index}`, title: `Metric ${index + 1}`, value: `${index + 1}K` }));

try {
  cpSync(join(plugin, 'templates/data-app/base'), project, { recursive: true,
    filter: path => !path.includes('/node_modules') && !path.includes('/dist') });
  writeFileSync(join(project, 'src/content/dashboard/DashboardContent.jsx'), `
import React, { useState } from 'react';
import { MetricCardTabs, Tabs, useDashboardTabs } from '../../data-app-public.jsx';
export function DashboardContent() {
  const { activeTabId } = useDashboardTabs(${JSON.stringify(pages)});
  const [section, setSection] = useState('section-0');
  const [metric, setMetric] = useState('metric-0');
  return <article data-active-page={activeTabId} style={{ width: 'min(100%, 420px)', padding: 8 }}>
    <Tabs label="Analysis sections" items={${JSON.stringify(generic)}} value={section} onChange={setSection} />
    <MetricCardTabs ariaLabel="Metrics" items={${JSON.stringify(metrics)}} selectedId={metric} onChange={setMetric} />
  </article>;
}`);
  const build = runDataAppFixtureBuild(project, { pluginRoot: plugin });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const html = forceLocalDataAppMount(readFileSync(join(project, 'dist/index.html'), 'utf8'));
  if (process.env.DATA_TAB_QA_OUTPUT) writeFileSync(process.env.DATA_TAB_QA_OUTPUT, html);

  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch(engine === chromium ? { executablePath: resolveChromiumExecutable(), headless: true } : { headless: true });
    try {
      for (const width of [390, 1100]) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390 });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://tabs-qa.chatgpt.site/**', route => route.fulfill({ contentType: 'text/html', body: html }));
        await page.goto('https://tabs-qa.chatgpt.site/dashboard.html');
        assert.equal(await page.locator('.dashboard-tabs-collapse.is-open .dashboard-tabs-collapse-inner')
          .evaluate(node => getComputedStyle(node).opacity), '1',
        `${engine.name()} ${width}: the open dashboard tabs must be visible`);
        const underline = () => page.evaluate(() => {
          const bounds = selector => document.querySelector(selector).getBoundingClientRect();
          const mark = bounds('.dashboard-tabs .tab-active-indicator');
          const text = bounds('.dashboard-tab[aria-selected="true"] .dashboard-tab-label');
          const header = bounds('.dashboard-topbar');
          return { x: mark.x, width: mark.width, y: mark.y, textX: text.x, textWidth: text.width,
            borderY: header.bottom - parseFloat(getComputedStyle(document.querySelector('.dashboard-topbar')).borderBottomWidth) };
        });
        const assertUnderline = async context => {
          const result = await underline();
          assert.ok(Math.abs(result.y - result.borderY) <= 1,
            `${engine.name()} ${width} ${context}: underline must sit on the header divider: ${JSON.stringify(result)}`);
          assert.ok(Math.abs(result.x - result.textX) < 1 && Math.abs(result.width - result.textWidth) < 1,
            `${engine.name()} ${width} ${context}: underline must align with the label: ${JSON.stringify(result)}`);
        };
        await assertUnderline('initial tab');
        for (const selector of ['.dashboard-tabs-inner', '.tabs[aria-label="Analysis sections"]', '.data-metric-card-tabs-list']) {
          const strip = page.locator(selector);
          await strip.waitFor();
          const initial = await strip.evaluate(node => ({ width: node.clientWidth, total: node.scrollWidth,
            left: node.scrollLeft, fade: getComputedStyle(node).maskImage, right: node.dataset.scrollRight }));
          assert.ok(initial.total > initial.width + 30, `${engine.name()} ${width} ${selector} should overflow: ${JSON.stringify(initial)}; tabs=${await strip.locator('[role="tab"]').count()}`);
          assert.equal(initial.right, 'true', `${selector} should indicate more tabs to the right`);
          assert.ok(initial.fade.includes('gradient'), `${selector} needs a visible edge fade`);

          await strip.scrollIntoViewIfNeeded();
          if (width === 390 && engine === chromium) {
            const bounds = await strip.boundingBox();
            const client = await page.context().newCDPSession(page);
            const y = bounds.y + bounds.height / 2, x = bounds.x + bounds.width * .8;
            await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 21 }] });
            for (let step = 1; step <= 8; step++) {
              await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - step * 26, y, id: 21 }] });
            }
            await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await page.waitForTimeout(200);
            assert.ok(await strip.evaluate(node => node.scrollLeft) > 20,
              `A mobile swipe beginning on a tab must scroll ${selector}`);
          } else if (width === 1100) {
            const bounds = await strip.boundingBox();
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            await page.mouse.wheel(0, 145);
            assert.ok(await strip.evaluate(node => node.scrollLeft) > 20,
              `Desktop wheel should scroll ${selector} horizontally`);
          }
          await strip.evaluate(node => node.scrollLeft = node.scrollWidth);
          await page.waitForFunction(selector => document.querySelector(selector)?.dataset.scrollLeft === 'true' &&
            document.querySelector(selector)?.dataset.scrollRight === 'false', selector);
          assert.equal(await strip.locator('[role="tab"]').last().isVisible(), true);
        }
        await page.getByRole('tab', { name: 'Dashboard page 1' }).click();
        await page.getByRole('tab', { name: 'Dashboard page 9' }).focus();
        await page.keyboard.press('Enter');
        await page.locator('[data-active-page="page-8"]').waitFor();
        await page.waitForTimeout(240);
        await assertUnderline('selected tab after scrolling');
        assert.ok(await page.locator('.dashboard-tabs-inner').evaluate(node => node.scrollLeft > 0),
          'Keyboard selection must reveal a tab beyond the visible edge');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          'Tab overflow stays within its strip rather than widening the page');
        assert.deepEqual(errors, [], `${engine.name()} ${width} runtime errors`);
        await page.close();
      }
      const wide = await browser.newPage({ viewport: { width: 1920, height: 844 } });
      await wide.route('https://tabs-qa.chatgpt.site/**', route => route.fulfill({ contentType: 'text/html', body: html }));
      await wide.goto('https://tabs-qa.chatgpt.site/dashboard.html');
      const noOverflow = await wide.locator('.dashboard-tabs-inner').evaluate(node => ({
        fits: node.scrollWidth <= node.clientWidth + 1,
        left: node.dataset.scrollLeft,
        right: node.dataset.scrollRight,
        mask: getComputedStyle(node).maskImage,
      }));
      assert.deepEqual(noOverflow, { fits: true, left: 'false', right: 'false', mask: 'none' },
        `${engine.name()}: tabs that fit should not show a fade`);
      await wide.close();
    } finally { await browser.close(); }
  }
  console.log('PASS: horizontal tab overflow, fades, touch swipe, desktop wheel, and keyboard reveal in Chromium and WebKit.');
} finally { rmSync(project, { recursive: true, force: true }); }
