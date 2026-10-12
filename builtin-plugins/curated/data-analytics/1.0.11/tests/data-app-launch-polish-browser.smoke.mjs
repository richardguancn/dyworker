import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { installDashboardBrowserMocks, resolveChromiumExecutable, runDataAppFixtureBuild } from './browser-helpers.mjs';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = process.env.DATA_POLISH_OUTPUT;
assert.ok(workspace, 'Set DATA_POLISH_OUTPUT to a fresh evidence directory');
const project = join(workspace, 'app');
mkdirSync(workspace, { recursive: true });
cpSync(join(pluginRoot, 'templates/data-app/base'), project, { recursive: true,
  filter: path => !path.includes('/node_modules') && !path.includes('/dist'),
});
const snapshot = JSON.parse(readFileSync(join(project, 'src/data.json'), 'utf8'));
snapshot.id = 'launch-polish-regression';
snapshot.filters = [];
snapshot.queries = { signed: { ...Object.values(snapshot.queries)[0], rows: [
  { plan: 'Plus', change: 3010000 }, { plan: 'Business', change: -111300 }, { plan: 'Go', change: -2400 },
] } };
writeFileSync(join(project, 'src/data.json'), JSON.stringify(snapshot));
writeFileSync(join(project, 'src/content/dashboard/DashboardContent.jsx'), `
import React from 'react';
import { MetricCard, DataComponent, ChartRenderer, useDataApp } from '../../data-app-public.jsx';
export function DashboardContent() {
 const shell = useDataApp(); const rows = shell.reviewedRows('signed');
 const chart = {type:'horizontalBar', x:'plan', y:'change', showValues:true};
 return <div style={{display:'grid', gap:24}}>
 <MetricCard id="metric" title="Users who linked" queryId="signed" value="+0.75%" comparison="p=0.596" description="Experiment result" />
 <DataComponent id="signed" title="Contribution to weekly change by endpoint plan" queryId="signed" kind="chart" chart={chart} displayRows={rows} description="Reviewed changes by plan">
 <ChartRenderer {...shell.chartProps('signed')} rows={rows} spec={chart} height={300} />
 </DataComponent></div>;
}
`);
const build = runDataAppFixtureBuild(project, { pluginRoot });
assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
const browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
try {
 const page = await browser.newPage(); const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await installDashboardBrowserMocks(page);
 await page.goto(pathToFileURL(join(project, 'dist/index.html')).href);
 await page.locator('.recharts-bar-rectangle').first().waitFor();
 for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(200);
  const value = await page.locator('.data-metric-value').boundingBox();
  const comparison = await page.locator('.data-metric-change').boundingBox();
  assert.ok(comparison.y >= value.y + value.height, 'Comparison belongs below the metric value');
  const gap = await page.locator('.component-title-tail').evaluate(el => {
   const range = document.createRange(); range.selectNodeContents(el.firstChild);
   return el.querySelector('.info-wrap').getBoundingClientRect().left - range.getBoundingClientRect().right;
  });
  assert.ok(gap >= 5, `Info icon needs spacing at ${width}px: ${gap}`);
  const labels = await page.locator('.recharts-label-list text').evaluateAll(els => els.map(el => ({ text: el.textContent, x: el.getBoundingClientRect().x })));
  const categoryRight = await page.locator('.recharts-yAxis .recharts-cartesian-axis-tick').evaluateAll(els => Math.max(...els.map(el => el.getBoundingClientRect().right)));
  assert.equal(labels.length, 3, 'All values remain visible');
  assert.ok(labels.every(label => label.x > categoryRight), 'Signed values must not overlap category names');
  console.log(JSON.stringify({width, labels}));
  await page.screenshot({path:join(workspace, `polish-${width}.png`), fullPage:true});
 }
 assert.deepEqual(errors, []);
} finally { await browser.close(); }
