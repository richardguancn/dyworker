import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright-core';
import { forceLocalDataAppMount, resolveChromiumExecutable, runDataAppFixtureBuild } from './browser-helpers.mjs';

const plugin = join(dirname(fileURLToPath(import.meta.url)), '..');
const project = mkdtempSync(join(tmpdir(), 'data-mobile-scrub-'));
try {
  cpSync(join(plugin, 'templates/data-app/base'), project, { recursive: true,
    filter: path => !path.includes('/node_modules') && !path.includes('/dist') });
  const build = runDataAppFixtureBuild(project, { pluginRoot: plugin });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const html = join(project, 'dist/index.html');
  writeFileSync(html, forceLocalDataAppMount(readFileSync(html, 'utf8')));
  const browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('crash', () => errors.push('Renderer crashed'));
    await page.goto(pathToFileURL(html).href);
    const client = await page.context().newCDPSession(page);
    const touch = async (points, id = 1, inspect = () => {}) => {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points[0], id }] });
      for (const point of points.slice(1)) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id }] });
        await page.evaluate(() => new Promise(requestAnimationFrame));
        await inspect();
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    for (let index = 0; index < 2; index++) {
      const lever = page.locator('.scenario-lever').nth(index);
      await lever.scrollIntoViewIfNeeded();
      const input = lever.locator('input[type="range"]');
      const before = Number(await input.inputValue());
      const handle = await lever.locator('.data-slider-handle').boundingBox();
      const control = await lever.locator('.data-slider-control').boundingBox();
      const y = handle.y + handle.height / 2;
      await touch(Array.from({ length: 13 }, (_, step) => ({
        x: Math.min(control.x + control.width - 12, handle.x + 1 + step * 9), y,
      })), index + 1);
      const after = Number(await input.inputValue());
      assert.ok(after > before, `Dragging ${await input.getAttribute('id')} changes its value: ${before} -> ${after}`);
    }
    const chart = page.locator('[data-component-id="usage-trend"]');
    await chart.scrollIntoViewIfNeeded();
    const wrapper = chart.locator('.recharts-wrapper');
    const box = await wrapper.boundingBox();
    const yy = box.y + box.height / 2;
    const observed = new Set();
    await touch(Array.from({ length: 80 }, (_, index) => ({
      x: box.x + 55 + index * (box.width - 110) / 79, y: yy,
    })), 3, async () => {
      const label = await chart.locator('.chart-tooltip > strong').first().textContent({ timeout: 100 }).catch(() => null);
      if (label) observed.add(label);
    });
    assert.ok(observed.size >= 2, `A horizontal chart scrub should show successive values: ${[...observed]}`);
    assert.deepEqual(errors, [], 'Horizontal chart scrubbing leaves the page alive');
    assert.ok(await chart.count(), 'The chart remains mounted after scrubbing');
    if (process.env.DATA_MOBILE_SCRUB_SCREENSHOT_PATH)
      await page.screenshot({ path: process.env.DATA_MOBILE_SCRUB_SCREENSHOT_PATH });
    await page.close();
  } finally { await browser.close(); }
  // Linux WPE aborts in its SVG renderer on repeated chart touches. WebKit's
  // inspector cannot dispatch trusted drags, so check its DOM touch handlers
  // locally while CI keeps the Chromium gesture check.
  if (process.env.DATA_APP_SKIP_WEBKIT_TOUCH !== '1') {
    const safari = await webkit.launch({ headless: true });
    try {
      const page = await safari.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('crash', () => errors.push('Renderer crashed'));
      await page.goto(pathToFileURL(html).href);
      const lever = page.locator('.scenario-lever').first();
      await lever.scrollIntoViewIfNeeded();
      const before = Number(await lever.locator('input').inputValue());
      await lever.evaluate(async element => {
        const target = element.querySelector('input');
        const rect = element.querySelector('.data-slider-control').getBoundingClientRect();
        const send = (type, x) => {
          const point = { identifier: 1, target, clientX: x, clientY: rect.top + rect.height / 2 };
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] },
            changedTouches: { value: [point] }, targetTouches: { value: type === 'touchend' ? [] : [point] } });
          target.dispatchEvent(event);
        };
        send('touchstart', rect.left + rect.width * .5);
        for (let step = 1; step <= 10; step++) {
          send('touchmove', rect.left + rect.width * (.5 + step * .04));
          await new Promise(requestAnimationFrame);
        }
        send('touchend', rect.left + rect.width * .9);
      });
      assert.ok(Number(await lever.locator('input').inputValue()) > before,
        'WebKit touch handlers update the slider while dragging');
      const chart = page.locator('[data-component-id="usage-trend"]');
      await chart.scrollIntoViewIfNeeded();
      const observed = await chart.evaluate(async element => {
        const target = element.querySelector('.recharts-surface');
        const rect = target.getBoundingClientRect();
        const labels = new Set();
        const y = rect.top + rect.height / 2;
        const down = new MouseEvent('pointerdown', { bubbles: true, clientX: rect.left + 45, clientY: y });
        Object.defineProperties(down, { pointerId: { value: 7 }, pointerType: { value: 'touch' } });
        target.dispatchEvent(down);
        for (let step = 0; step <= 28; step++) {
          const x = rect.left + 45 + step * (rect.width - 90) / 28;
          const point = { identifier: 7, target, clientX: x, clientY: y };
          const move = new Event('touchmove', { bubbles: true, cancelable: true });
          Object.defineProperties(move, { touches: { value: [point] }, changedTouches: { value: [point] },
            targetTouches: { value: [point] } });
          target.dispatchEvent(move);
          await new Promise(requestAnimationFrame);
          const label = element.querySelector('.chart-tooltip > strong')?.textContent;
          if (label) labels.add(label);
        }
        return [...labels];
      });
      assert.ok(observed.length >= 2, `WebKit horizontal scrub advances chart values: ${observed}`);
      assert.deepEqual(errors, [], 'WebKit scrub has no page errors');
      await page.close();
    } finally { await safari.close(); }
  }
  console.log(process.env.DATA_APP_SKIP_WEBKIT_TOUCH === '1'
    ? 'PASS: Chromium mobile sliders and chart scrub; WebKit chart scrub skipped on Linux WPE CI.'
    : 'PASS: mobile sliders and chart scrub advance values without page errors in Chromium and WebKit');
} finally { rmSync(project, { recursive: true, force: true }); }
