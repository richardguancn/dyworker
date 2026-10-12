import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright-core';
import { forceLocalDataAppMount, resolveChromiumExecutable, runDataAppFixtureBuild } from './browser-helpers.mjs';

const plugin = join(dirname(fileURLToPath(import.meta.url)), '..');
const project = mkdtempSync(join(tmpdir(), 'data-chart-touch-'));
try {
  cpSync(join(plugin, 'templates/data-app/base'), project, { recursive: true,
    filter: path => !path.includes('/node_modules') && !path.includes('/dist') });
  const build = runDataAppFixtureBuild(project, { pluginRoot: plugin });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const html = forceLocalDataAppMount(readFileSync(join(project, 'dist/index.html'), 'utf8'));
  const browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('crash', () => errors.push('Page crashed'));
    await page.route('https://qa-static.chatgpt.site/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: html,
    }));
    await page.goto('https://qa-static.chatgpt.site/dashboard.html');
    const chart = page.locator('[data-component-id="engagement-heatmap"]');
    const cells = chart.locator('[data-heatmap-cell]');
    await cells.first().scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const tap = async locator => {
      const box = await locator.boundingBox();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.touchscreen.tap(point.x, point.y);
      return point;
    };
    const first = await tap(cells.nth(5));
    const tooltip = chart.locator('.recharts-tooltip-wrapper .chart-tooltip');
    await tooltip.waitFor({ state: 'visible' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    let bounds = await tooltip.boundingBox();
    assert.ok(bounds.y + bounds.height <= first.y - 20,
      `First touch should reveal a tooltip clear of the finger: ${JSON.stringify({ first, bounds })}`);
    assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0);

    const second = await tap(cells.nth(6));
    await tooltip.waitFor({ state: 'visible' });
    bounds = await tooltip.boundingBox();
    assert.ok(bounds.y + bounds.height <= second.y - 20,
      `Moving to another cell should keep the tooltip above the finger: ${JSON.stringify({ second, bounds })}`);
    assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0,
      'A different cell starts a new preview instead of opening Ask');
    await page.touchscreen.tap(8, 80);
    await tooltip.waitFor({ state: 'hidden', timeout: 1500 });
    await tap(cells.nth(6));
    assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0,
      'After tapping away, the same mark needs a fresh preview');
    await tap(cells.nth(6));
    await page.getByRole('dialog', { name: 'Selected chart data' }).waitFor();
    await page.touchscreen.tap(8, 80);
    await page.getByRole('dialog', { name: 'Selected chart data' }).waitFor({ state: 'hidden' });

    const scatter = page.locator('[data-component-id="engagement-scatter"]');
    const dots = scatter.locator('.recharts-scatter-symbol');
    await dots.first().scrollIntoViewIfNeeded();
    assert.ok(await dots.count() > 1, 'The scatter fixture has distinct marks');
    const scatterPoint = await tap(dots.first());
    const scatterTip = scatter.locator('.chart-tooltip');
    await scatterTip.waitFor({ state: 'visible' });
    const scatterBounds = await scatterTip.boundingBox();
    assert.ok(scatterBounds.y + scatterBounds.height <= scatterPoint.y - 20 ||
      scatterBounds.y >= scatterPoint.y + 20,
    `Scatter tooltip should avoid the finger: ${JSON.stringify({ scatterPoint, scatterBounds })}`);
    assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0,
      'The first scatter tap previews its tooltip');
    await tap(dots.nth(1));
    await scatterTip.waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0,
      'A different scatter point previews instead of selecting');
    await tap(dots.nth(1));
    await page.getByRole('dialog', { name: 'Selected chart data' }).waitFor();
    await page.touchscreen.tap(8, 80);
    await page.getByRole('dialog', { name: 'Selected chart data' }).waitFor({ state: 'hidden' });

    // A finger scrub must resolve the point beneath the finger, rather than
    // retaining the payload from touchstart while merely moving its card.
    await dots.first().scrollIntoViewIfNeeded();
    const dotPositions = await dots.evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }).filter(point => point.x > 0 && point.x < innerWidth && point.y > 0 && point.y < innerHeight));
    const [from, to] = dotPositions.reduce((best, first) => dotPositions.reduce((pair, second) =>
      Math.abs(second.x - first.x) > 70 && Math.abs(second.x - first.x) > Math.abs(second.y - first.y) * 1.25 &&
      Math.abs(second.x - first.x) > Math.abs(pair[1].x - pair[0].x) ? [first, second] : pair, best),
    [dotPositions[0], dotPositions[0]]);
    assert.ok(Math.abs(to.x - from.x) > 70, 'Scatter fixture has horizontally separated visible points');
    const scrubClient = await page.context().newCDPSession(page);
    await page.touchscreen.tap(from.x, from.y);
    await scatterTip.waitFor({ state: 'visible' });
    const initialScatterTip = await scatterTip.innerText();
    await scrubClient.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 11 }] });
    for (let step = 1; step <= 12; step++) {
      const x = from.x + (to.x - from.x) * step / 12;
      const y = from.y + (to.y - from.y) * step / 12;
      await scrubClient.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 11 }] });
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(100);
    const endingScatterTip = await scatterTip.innerText();
    await scrubClient.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.notEqual(endingScatterTip, initialScatterTip,
      `Scatter scrub must change the active row: ${JSON.stringify({ initialScatterTip, endingScatterTip })}`);
    assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0,
      'Scrubbing scatter points must not open Ask');
    assert.deepEqual(errors, [], 'Scatter scrub must leave the page mounted');
    await page.touchscreen.tap(8, 80);
    await scatterTip.waitFor({ state: 'hidden' });
    await page.touchscreen.tap(to.x, to.y);
    assert.equal(await scatterTip.innerText(), endingScatterTip,
      'The scrub should end on the same data point as a direct tap');
    await page.touchscreen.tap(8, 80);
    await scatterTip.waitFor({ state: 'hidden' });
    await scatter.locator('.chart-frame').evaluate((frame, point) => frame.dispatchEvent(
      new CustomEvent('data-chart-scrub', { bubbles: true, detail: point })), to);
    await scatterTip.waitFor({ state: 'visible' });
    assert.equal(await scatterTip.innerText(), endingScatterTip,
      'A later gesture can reactivate the same point after dismissing the tooltip');
    await page.touchscreen.tap(8, 80);
    await scatterTip.waitFor({ state: 'hidden' });

    // WebKit can send a zero-detail compatibility click after touch release,
    // sometimes preceded by a mouse pointerdown on an inner SVG mark.
    for (const mark of [cells.nth(5), dots.first()]) {
      await mark.scrollIntoViewIfNeeded();
      await mark.evaluate(element => {
        const box = element.getBoundingClientRect();
        const options = { bubbles: true, clientX: box.left + box.width / 2,
          clientY: box.top + box.height / 2 };
        element.dispatchEvent(new PointerEvent('pointerdown', { ...options, pointerId: 77, pointerType: 'touch' }));
        element.dispatchEvent(new PointerEvent('pointerup', { ...options, pointerId: 77, pointerType: 'touch' }));
        element.dispatchEvent(new PointerEvent('pointerdown', { ...options, pointerId: 1, pointerType: 'mouse' }));
        element.dispatchEvent(new MouseEvent('click', { ...options, detail: 0 }));
      });
      assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0,
        'A zero-detail compatibility click after a touch previews instead of selecting');
      await page.touchscreen.tap(8, 80);
    }

    const frame = chart.locator('.chart-frame');
    const plot = await frame.boundingBox();
    await page.touchscreen.tap(plot.x + plot.width - 5, plot.y + 3);
    assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0,
      'A touch on empty plot space cannot launch Ask');
    const start = await cells.nth(9).boundingBox();
    const client = await page.context().newCDPSession(page);
    const x = start.x + start.width / 2, y = start.y + start.height / 2;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 95, id: 1 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0,
      'A scroll gesture through a mark cannot select it');
    assert.equal(await page.locator('.dashboard-ask-panel[data-phase="compose"]').count(), 0,
      'A chart drag cannot open the Ask composer');
    await tooltip.waitFor({ state: 'hidden', timeout: 1500 });

    const line = page.locator('[data-component-id="usage-trend"] .recharts-line-curve').first();
    await page.locator('[data-component-id="usage-trend"]').evaluate(element => element.scrollIntoView({ block: 'center' }));
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await line.scrollIntoViewIfNeeded({ timeout: 3000 }); break; }
      catch (error) { if (attempt === 2) throw error; }
    }
    const linePoint = await line.evaluate(element => {
      const point = element.getPointAtLength(element.getTotalLength() * .4)
        .matrixTransform(element.getScreenCTM());
      return { x: point.x, y: point.y };
    });
    await page.touchscreen.tap(linePoint.x, linePoint.y);
    const lineTooltip = page.locator('[data-component-id="usage-trend"] .chart-tooltip');
    await lineTooltip.waitFor({ state: 'visible' });
    const lineBounds = await lineTooltip.boundingBox();
    assert.ok(lineBounds.y + lineBounds.height <= linePoint.y - 20,
      `Line chart touch details should clear the finger: ${JSON.stringify({ linePoint, lineBounds })}`);
    assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0);
    await page.touchscreen.tap(8, 80);
    await lineTooltip.waitFor({ state: 'hidden' });
    await page.mouse.move(linePoint.x, linePoint.y);
    await lineTooltip.waitFor({ state: 'visible' });
    await page.mouse.move(8, 80);
    await lineTooltip.waitFor({ state: 'hidden' });

    const bars = page.locator('[data-component-id="growth-drivers"] .recharts-bar-rectangle');
    await bars.nth(1).scrollIntoViewIfNeeded();
    const barPoint = await tap(bars.nth(1));
    const barTooltip = page.locator('[data-component-id="growth-drivers"] .chart-tooltip');
    await barTooltip.waitFor({ state: 'visible' });
    const barBounds = await barTooltip.boundingBox();
    assert.ok(barBounds.y + barBounds.height <= barPoint.y - 20,
      `Standard bar chart tooltips should clear the finger: ${JSON.stringify({ barPoint, barBounds })}`);
    assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0);
    await tap(bars.nth(1));
    await page.getByRole('dialog', { name: 'Selected chart data' }).waitFor();
    await page.touchscreen.tap(8, 80);
    await page.getByRole('dialog', { name: 'Selected chart data' }).waitFor({ state: 'hidden' });

    // Repeated touch previews and scroll starts used to destabilize the phone
    // page. Exercise distinct marks so a second tap never intentionally pins.
    for (let index = 0; index < 24; index++) {
      await cells.nth(5).scrollIntoViewIfNeeded();
      await tap(cells.nth(index % 2 ? 5 : 6));
      if (index % 6 === 5) {
        const cell = await cells.nth(5).boundingBox();
        const dragX = cell.x + cell.width / 2, dragY = cell.y + cell.height / 2;
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: dragX, y: dragY, id: 2 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: dragX, y: dragY - 75, id: 2 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      assert.ok(await page.locator('[data-component-id="engagement-heatmap"]').count(),
        `Chart page should remain mounted after touch ${index + 1}`);
    }
    // Slow movement used to reach Recharts before the 12px scroll threshold.
    // Include pointer cancellation: iOS continues Touch Events after it cancels
    // the corresponding Pointer Events for native page scrolling.
    await chart.evaluate(element => {
      element.dataset.touchMoves = "0";
      element.addEventListener('touchmove', () => {
        element.dataset.touchMoves = String(Number(element.dataset.touchMoves) + 1);
      });
    });
    await cells.nth(5).scrollIntoViewIfNeeded();
    const slow = await cells.nth(5).boundingBox();
    const slowX = slow.x + slow.width / 2, slowY = slow.y + slow.height / 2;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: slowX, y: slowY, id: 3 }] });
    for (const distance of [1, 3, 7, 11, 16, 32, 64]) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: slowX, y: slowY - distance, id: 3 }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await chart.getAttribute('data-touch-moves'), '0',
      'Scroll movement must never reach live chart touch handlers, even below activation threshold');
    assert.deepEqual(errors, [], 'Repeated chart touches should not crash the page');

    const stage = page.locator('[data-component-id="activation-funnel"] .chart-funnel-stage').nth(2);
    await stage.scrollIntoViewIfNeeded();
    // The stress gestures above can leave the document in motion. Center the
    // stage and wait for its hit target to settle before testing a tap.
    await stage.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() =>
      requestAnimationFrame(resolve))));
    const hit = await stage.evaluate(element => {
      const box = element.getBoundingClientRect();
      const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { stage: element.contains(target), target: target?.className?.baseVal || target?.className || target?.tagName,
        box: { x: box.x, y: box.y, width: box.width, height: box.height } };
    });
    assert.ok(hit.stage, `Funnel stage must be the touch hit target: ${JSON.stringify(hit)}`);
    const stagePoint = await tap(stage);
    const stageTip = page.locator('[data-component-id="activation-funnel"] .chart-funnel-tooltip[data-pinned]');
    try { await stageTip.waitFor({ state: 'visible', timeout: 2000 }); }
    catch (error) {
      const state = await stage.evaluate(element => ({ active: element.dataset.active,
        focused: document.activeElement?.className,
        tooltip: element.closest('.chart-funnel')?.querySelector('.chart-funnel-tooltip')?.outerHTML.slice(0, 300) }));
      throw new Error(`Funnel touch did not pin its tooltip: ${JSON.stringify({ stagePoint, hit, state })}`, { cause: error });
    }
    const stageBounds = await stageTip.boundingBox();
    assert.ok(stageBounds.y + stageBounds.height <= stagePoint.y - 20 || stageBounds.y >= stagePoint.y + 20,
      `Funnel touch details must avoid the finger: ${JSON.stringify({ stagePoint, stageBounds })}`);
    assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0);
    await stageTip.getByRole('button', { name: 'Done' }).click();
    assert.deepEqual(errors, [], 'No chart touch runtime errors');
    await page.close();
  } finally { await browser.close(); }
  // Linux WPE MiniBrowser can abort in its EGL renderer on repeated SVG touches.
  // Keep the complete WebKit gesture coverage on macOS; CI still runs this
  // script's Chromium gestures and WebKit responsive coverage separately.
  if (process.env.DATA_APP_SKIP_WEBKIT_TOUCH !== '1') {
    const safari = await webkit.launch({ headless: true });
    try {
      const page = await safari.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('crash', () => errors.push('Page crashed'));
      await page.route('https://qa-static.chatgpt.site/**', route => route.fulfill({
        status: 200, contentType: 'text/html', body: html,
      }));
      await page.goto('https://qa-static.chatgpt.site/dashboard.html');
      for (const [id, selector] of [
        ['engagement-heatmap', '[data-heatmap-cell]'],
        ['engagement-scatter', '.recharts-scatter-symbol'],
      ]) {
        const chart = page.locator(`[data-component-id="${id}"]`);
        const marks = chart.locator(selector);
        await marks.first().scrollIntoViewIfNeeded();
        const bounds = await marks.first().boundingBox();
        await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await chart.locator('.chart-tooltip').waitFor({ state: 'visible' });
        assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0,
          `The first ${id} tap must show a tooltip without Ask in WebKit`);
        const other = await marks.nth(1).boundingBox();
        await page.touchscreen.tap(other.x + other.width / 2, other.y + other.height / 2);
        assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0,
          `A different ${id} mark must update the preview in WebKit`);
        await page.touchscreen.tap(other.x + other.width / 2, other.y + other.height / 2);
        await page.getByRole('dialog', { name: 'Selected chart data' }).waitFor();
        await page.touchscreen.tap(8, 80);
        await page.getByRole('dialog', { name: 'Selected chart data' }).waitFor({ state: 'hidden' });
      }
      const scatter = page.locator('[data-component-id="engagement-scatter"]');
      const dots = scatter.locator('.recharts-scatter-symbol');
      await dots.first().scrollIntoViewIfNeeded();
      const points = await dots.evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }).filter(point => point.x > 0 && point.x < innerWidth && point.y > 0 && point.y < innerHeight));
      const [start, end] = points.reduce((best, first) => points.reduce((pair, second) =>
        Math.abs(second.x - first.x) > 70 && Math.abs(second.x - first.x) > Math.abs(second.y - first.y) * 1.25 &&
        Math.abs(second.x - first.x) > Math.abs(pair[1].x - pair[0].x) ? [first, second] : pair, best),
      [points[0], points[0]]);
      assert.ok(Math.abs(end.x - start.x) > 70, 'WebKit has horizontally separated scatter points');
      await page.touchscreen.tap(start.x, start.y);
      const firstTip = await scatter.locator('.chart-tooltip').innerText();
      await page.evaluate(async ({ start, end }) => {
        const root = document.querySelector('[data-component-id="engagement-scatter"] .chart-frame');
        for (let step = 1; step <= 12; step++) {
          const x = start.x + (end.x - start.x) * step / 12;
          const y = start.y + (end.y - start.y) * step / 12;
          root.dispatchEvent(new CustomEvent('data-chart-scrub', { bubbles: true, detail: { x, y } }));
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      }, { start, end });
      await page.waitForTimeout(100);
      const endTip = await scatter.locator('.chart-tooltip').innerText();
      assert.notEqual(endTip, firstTip,
        'WebKit scatter scrub should move the active tooltip between distinct points');
      assert.equal(await page.getByRole('dialog', { name: 'Selected chart data' }).count(), 0);
      await page.touchscreen.tap(8, 80);
      await page.touchscreen.tap(end.x, end.y);
      assert.equal(await scatter.locator('.chart-tooltip').innerText(), endTip,
        'WebKit should resolve the same destination as a direct tap');
      assert.deepEqual(errors, [], 'WebKit first taps leave both chart types mounted');
      await page.close();
    } finally { await safari.close(); }
  }
  console.log(process.env.DATA_APP_SKIP_WEBKIT_TOUCH === '1'
    ? 'PASS: Chromium chart gestures; WebKit chart gestures skipped on Linux WPE CI.'
    : 'PASS: Chromium and WebKit scatter scrubs update the tooltip; heatmap/scatter first taps preview, repeated taps select, and drags do not open Ask.');
} finally { rmSync(project, { recursive: true, force: true }); }
