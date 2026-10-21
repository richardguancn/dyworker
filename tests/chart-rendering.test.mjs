import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, stop } from 'esbuild';
import { chartOptions } from './fixtures/chart-options.mjs';

// 使用产品实际注册的引擎，在不启动浏览器的情况下绘图；SVG 只供测试导出检查。
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-charts-'));
const outfile = path.join(root, 'render.mjs');
await build({
  stdin: { contents: `import { echarts } from './src/echarts-setup.ts';
    import { SVGRenderer } from 'echarts/renderers';
    echarts.use([SVGRenderer]);
    export function render(option, theme, width) {
      const chart = echarts.init(null, theme, { renderer: 'svg', ssr: true, width, height: 320 });
      try { chart.setOption({...option, animation: false}); return chart.renderToSVGString(); }
      finally { chart.dispose(); }
    }`, resolveDir: process.cwd(), sourcefile: 'chart-render-test.ts' },
  bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
});
await stop();
const { render } = await import(pathToFileURL(outfile).href);
test.after(() => fs.rm(root, { recursive: true, force: true }));

test('模型示例和实际引擎覆盖十种数据图表', () => {
  assert.deepEqual(new Set(chartOptions.flatMap(option => option.series.map(series => series.type))),
    new Set(['bar', 'line', 'pie', 'scatter', 'radar', 'funnel', 'gauge', 'heatmap', 'treemap', 'sunburst']));
});
for (const option of chartOptions) {
  const type = option.series[0].type;
  test(`${type} 在深浅色和窄面板下实际绘图`, () => {
    for (const theme of [null, 'dark']) {
      for (const width of [304, 680]) {
        const messages = [];
        const originalError = console.error;
        const originalWarn = console.warn;
        let svg;
        try {
          console.error = (...args) => messages.push(args.join(' '));
          console.warn = (...args) => messages.push(args.join(' '));
          svg = render(option, theme, width);
        } finally {
          console.error = originalError;
          console.warn = originalWarn;
        }
        assert.deepEqual(messages, [], '图表及其组件必须完整注册，不能只绘制标题而漏画数据');
        assert.match(svg, /<svg/);
        assert.match(svg, /<path/);
        assert.ok(svg.includes(option.title.text));
        assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
      }
    }
  });
}
