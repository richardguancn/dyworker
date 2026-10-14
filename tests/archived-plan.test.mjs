import assert from 'node:assert/strict';
import { build, stop } from 'esbuild';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyworker-archived-plan-'));
const output = path.join(temp, 'render.cjs');
await build({
  stdin: {
    contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { ArchivedPlan, PlanProgress } from './src/PlanProgress.tsx';
      export function render(message) {
        return { archive: renderToStaticMarkup(React.createElement(ArchivedPlan, {steps: message.plan})),
          live: renderToStaticMarkup(React.createElement(PlanProgress, {running: false, message})) };
      }`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', outfile: output, logLevel: 'silent',
});
const { render } = createRequire(import.meta.url)(output);
await stop();
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('结束后的计划保留实际完成数量，停止或失败的步骤不会变成已完成或继续转圈', () => {
  for (const taskStatus of ['done', 'stopped', 'failed']) {
    const message = { role: 'assistant', taskStatus, plan: [
      { title: '核对资料', status: 'completed' },
      { title: '整理结果', status: 'in_progress' },
      { title: '发布结果', status: 'pending' },
    ] };
    const { archive, live } = render(message);
    assert.equal(live, '');
    assert.match(archive, /1\/3 已完成/);
    assert.match(archive, /结束时进行中/);
    assert.match(archive, /待完成/);
    assert.doesNotMatch(archive, /class="spin"/);
    for (const step of message.plan) assert.ok(archive.includes(step.title));
    assert.equal(message.plan[1].status, 'in_progress');
  }
});
