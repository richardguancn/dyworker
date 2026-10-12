import assert from "node:assert/strict";
import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { installDashboardBrowserMocks, resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { buildContextualStories } from "../templates/data-app/base/examples/reports/contextual-stories/build.mjs";

const example = buildContextualStories({ buildProject: runDataAppFixtureBuild });
const snapshot = JSON.parse(readFileSync(join(example.project, "src/data.json"), "utf8"));
const browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
const errors = [];
function figureProblems() {
  const problems = [];
  const hero = document.querySelector('.report-hero');
  const title = hero.querySelector('h1');
  if (Math.abs(title.getBoundingClientRect().top - hero.getBoundingClientRect().top) > 1)
    problems.push('Unexpected margin above the report title');
  const overlap = (a,b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const story of document.querySelectorAll('.contextual-story')) {
    const prose = story.querySelector('.rich-narrative').getBoundingClientRect();
    const chart = story.querySelector('[data-component-id$="-chart"]');
    const frame = chart.getBoundingClientRect();
    if (Math.abs(prose.x-frame.x)>1 || Math.abs(prose.width-frame.width)>1) problems.push('Prose and chart widths differ');
    const svg = chart.querySelector('svg.recharts-surface');
    if (story.dataset.contextualStory === 'adjustment') {
      if (svg.querySelector('.chart-annotation-mark--event')) problems.push('Billing context incorrectly uses a date line');
      if (svg.querySelector('.chart-annotation-mark--point circle')) problems.push('Billing annotation adds a dot over the bar');
      const bars = [...svg.querySelectorAll('.recharts-bar-rectangle .recharts-rectangle')];
      const peak = bars.sort((a,b) => b.getBoundingClientRect().height-a.getBoundingClientRect().height)[0];
      const arrow = svg.querySelector('[data-annotation-arrow]');
      if (!arrow && innerWidth >= 600) problems.push('Billing context has no visible edge connector');
      if (arrow) {
        const toBar = point => point.matrixTransform(arrow.getScreenCTM()).matrixTransform(peak.getScreenCTM().inverse());
        const shaft = [...arrow.getAttribute('d').matchAll(/([MQL])\s+([^MQL]+)/g)][1][2]
          .trim().split(/\s+/).map(Number);
        const end = toBar(new DOMPoint(...shaft.slice(-2)));
        let closest = Infinity;
        for (let at=0;at<=peak.getTotalLength();at+=.5) {
          const p=peak.getPointAtLength(at); closest=Math.min(closest,Math.hypot(p.x-end.x,p.y-end.y));
        }
        if (closest<4.5 || closest>7 || peak.isPointInFill(end)) problems.push('Billing arrow does not leave a small gap from the visible bar edge');
        for (let at=0;at<=arrow.getTotalLength();at+=.5)
          if (peak.isPointInFill(toBar(arrow.getPointAtLength(at))))
            problems.push('Billing arrow crosses the bar fill');
      }
    }
    const bounds = svg.getBoundingClientRect();
    for (const text of svg.querySelectorAll('.chart-annotation-label text,.recharts-cartesian-axis-tick-label text')) {
      const box = text.getBoundingClientRect();
      if(box.left<bounds.left-1 || box.right>bounds.right+1 || box.top<bounds.top-1 || box.bottom>bounds.bottom+1)
        problems.push('Clipped chart text: '+text.textContent);
    }
    for(const text of svg.querySelectorAll('.chart-annotation-label text')) {
      const box = text.getBoundingClientRect();
      const grid = svg.querySelector('.recharts-cartesian-grid line');
      const x=Number(grid.getAttribute('x')), y=Number(grid.getAttribute('y'));
      const start=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM());
      const end=new DOMPoint(x+Number(grid.getAttribute('width')),y+Number(grid.getAttribute('height'))).matrixTransform(svg.getScreenCTM());
      if(box.left<start.x-1 || box.right>end.x+1 || box.top<start.y-1 || box.bottom>end.y+1)
        problems.push('Annotation is outside the actual plot: '+text.textContent);
      for(const mark of svg.querySelectorAll('.recharts-bar-rectangle .recharts-rectangle,.recharts-line-dot,.recharts-area-dot,.chart-annotation-mark--event .recharts-reference-line-line,.chart-annotation-mark--benchmark .recharts-reference-line-line'))
        if(overlap(box,mark.getBoundingClientRect())) problems.push('Annotation covers data');
      for(const area of svg.querySelectorAll('.recharts-area-area')) {
        const inverse=area.getScreenCTM().inverse();
        for(let x=box.left;x<=box.right;x+=2) for(let y=box.top;y<=box.bottom;y+=2)
          if(area.isPointInFill(new DOMPoint(x,y).matrixTransform(inverse))) problems.push('Annotation covers area fill');
      }
      for(const path of svg.querySelectorAll('.recharts-line-curve,.recharts-area-curve'))
        for(let at=0;at<=path.getTotalLength();at+=2) {
          const p=path.getPointAtLength(at).matrixTransform(path.getScreenCTM());
          if(p.x>=box.left-2 && p.x<=box.right+2 && p.y>=box.top-2 && p.y<=box.bottom+2) problems.push('Annotation covers curve');
        }
    }
    const labels=[...chart.querySelectorAll('.chart-annotation-label')].map(n=>n.dataset.chartAnnotation);
    const notes=[...chart.querySelectorAll('.chart-annotation-note')];
    const hidden=n=>getComputedStyle(n).clipPath==='inset(50%)';
    const visible=notes.filter(n=>!hidden(n)).map(n=>n.dataset.annotationNote);
    if(JSON.stringify([...labels,...visible].sort())!==JSON.stringify(notes.map(n=>n.dataset.annotationNote).sort()))
      problems.push('Missing or duplicated visible context');
    for(const note of notes.filter(n=>!hidden(n)))
      if(note.scrollWidth>note.clientWidth+1 || note.getBoundingClientRect().right>innerWidth+1) problems.push('Fallback overflow');
  }
  return problems;
}
try {
  const page = await browser.newPage({viewport:{width:1100,height:900},colorScheme:'light'});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
  await installDashboardBrowserMocks(page);
  await page.goto(pathToFileURL(example.html).href,{waitUntil:'load'});
  const stories=page.locator('.contextual-story');
  await page.waitForFunction(()=>document.querySelectorAll('.contextual-story svg.recharts-surface').length===3);
  assert.equal(await stories.count(),3);
  assert.match(await page.locator('main').innerText(),/fictional/i,'The examples disclose their fictional evidence');
  assert.equal(await page.locator('.chart-annotation-note').count(),3,'Each case contains one contextual annotation');
  const evidence = Object.values(snapshot.queries).map(query => query.rows.filter(row => row.context));
  assert.ok(evidence.every(records => records.length === 1));
  const expected = evidence.map(records => records[0].context);
  assert.equal(new Set(expected).size,3);
  assert.deepEqual(await page.locator('.chart-annotation-note > span:first-child').allTextContents(), expected,
    'Each annotation contains the contextual fact from its reviewed source record');
  for(const colorScheme of ['light','dark']) {
    await page.emulateMedia({colorScheme});
    await page.waitForFunction(s=>document.documentElement.dataset.colorScheme===s,colorScheme);
    for(const width of [1100,390]) {
      await page.setViewportSize({width,height:900});
      await page.waitForFunction(()=>[...document.querySelectorAll('.contextual-story svg.recharts-surface')]
        .every(svg=>Math.abs(svg.viewBox.baseVal.width-svg.getBoundingClientRect().width)<1));
      await page.evaluate(async()=>{await document.fonts.ready; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
      assert.deepEqual(await page.evaluate(figureProblems),[],`${colorScheme} ${width}px`);
      assert.equal(await page.locator('.chart-annotation-label-background,.chart-annotation-tooltip,.chart-annotation-badge').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    }
  }
  await page.setViewportSize({width:1100,height:900});
  await page.emulateMedia({colorScheme:'light'});
  for(const [index, story] of (await stories.all()).entries()) {
    const chart=story.locator('[data-component-id$="-chart"]');
    await chart.getByRole('button',{name:/ actions$/}).click();
    await page.getByRole('menuitem',{name:'View data source',exact:true}).click();
    const source=page.getByRole('complementary',{name:/^Data source for /});
    await source.getByRole('cell').filter({hasText:/fictional/i}).first().waitFor();
    assert.match(await source.innerText(),/fictional/i);
    await source.getByRole('tab',{name:'Data preview',exact:true}).click();
    await source.getByRole('cell',{name:expected[index],exact:true}).waitFor();
    assert.ok(await source.getByRole('columnheader').count()>2,'Source retains contextual evidence alongside chart values');
    assert.ok((await source.innerText()).includes(expected[index]), 'Data preview contains the exact contextual statement');
    assert.ok((await source.innerText()).includes(evidence[index][0].contextId), 'Data preview retains the stable source record ID');
    await source.getByRole('button',{name:'Close data source',exact:true}).click();
  }
  const firstChart=stories.first().locator('[data-component-id$="-chart"]');
  await firstChart.getByRole('button',{name:/ actions$/}).click();
  await page.getByRole('menuitem',{name:'Copy as image',exact:true}).click();
  await page.waitForFunction(()=>window.__dashboardClipboard.some(item=>item?.type==='image/png'));
  const png=await page.evaluate(()=>window.__dashboardClipboard.find(item=>item?.type==='image/png'));
  assert.ok(png.width>0 && png.height>0);
  assert.ok(png.text.join(' ').includes(expected[0]),'Image retains the complete contextual statement');
  assert.match(png.text.join(' '), /fictional/i, 'Standalone images disclose the fictional example');
  await page.emulateMedia({media:'print'});
  for(const note of await page.locator('.chart-annotation-note').all())
    assert.equal(await note.evaluate(n=>getComputedStyle(n).clipPath),'none','Print retains context and source evidence');
  await page.emulateMedia({media:'screen'});
  await page.getByRole('button',{name:'Edit text and layout',exact:true}).click();
  assert.deepEqual(await page.locator('.chart-annotation-note > span:first-child').allTextContents(),expected);
  assert.deepEqual(errors,[]);
  assert.equal(Object.keys(snapshot.queries).length,3,'Each figure has one combined reviewed query');
  console.log('Contextual annotation stories: desktop/mobile light/dark, alignment, data visibility, source, PNG, print, and editor checks passed.');
} finally {
  await browser.close();
  rmSync(example.project,{recursive:true,force:true});
}
