// 前置：npm run dev -- --host 127.0.0.1 --port 5185
// 用法：node scripts/e2e-window-controls-check.mjs [URL] [证据目录]
// 使用真实应用预览与鼠标点击；窗口操作由预览记录，不关闭宿主窗口。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const origin = process.argv[2] || 'http://127.0.0.1:5185';
const evidence = path.resolve(process.argv[3] || 'docs/verification/window-controls-2026-10-15');
mkdirSync(evidence, { recursive: true });
const run = (...args) => {
  const response = JSON.parse(execFileSync('agent-browser', ['--session', 'linux-titlebar', '--json', ...args], { encoding: 'utf8' }));
  assert.equal(response.success, true, JSON.stringify(response));
  return response.data;
};
const evaluate = source => run('eval', source).result;
const results = [];
for (const platform of ['linux', 'win32', 'darwin']) {
  run('open', `${origin}/tests/fixtures/shell-preview.html?platform=${platform}`);
  run('wait', '.app-shell');
  evaluate(`(() => { const style = document.createElement('style'); style.textContent = '* { transition: none !important; animation: none !important; }'; document.head.append(style); return true; })()`);
  for (const width of [1184, 720, 420]) {
    run('set', 'viewport', String(width), '736');
    for (const theme of ['light', 'dark']) {
      evaluate(`(() => { document.documentElement.dataset.theme = '${theme}'; document.documentElement.dataset.glass = 'on'; document.documentElement.dataset.glassLightweight = '${theme === 'light'}'; return true; })()`);
      for (const expanded of [false, true]) {
        const collapsed = evaluate(`document.querySelector('.app-shell').classList.contains('right-panel-collapsed')`);
        if (collapsed === expanded) run('click', `[aria-label="${expanded ? '展开' : '收起'}右侧工具栏"]`);
        const state = evaluate(`(() => {
          const controls = document.querySelector('.window-controls');
          const buttons = [...controls.querySelectorAll('button')];
          const title = document.querySelector('.titlebar').getBoundingClientRect();
          const boxes = buttons.map(button => {
            const r = button.getBoundingClientRect();
            return { label: button.ariaLabel, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
              appRegion: getComputedStyle(button).getPropertyValue('-webkit-app-region'),
              clear: [.1,.5,.9].every(x => [.1,.5,.9].every(y => button.contains(document.elementFromPoint(r.left+r.width*x,r.top+r.height*y)))) };
          });
          return { width: innerWidth, hidden: getComputedStyle(controls).display === 'none', titleRight: title.right, boxes,
            panelTop: document.querySelector('.tool-panel').getBoundingClientRect().top,
            tabsRight: document.querySelector('.tool-panel-tabs').getBoundingClientRect().right };
        })()`);
        if (platform === 'darwin') {
          assert.equal(state.hidden, true, 'macOS 保留原生窗口按钮');
        } else {
          assert.equal(state.boxes.at(-1).right, width, '关闭按钮必须贴右边缘');
          assert.ok(state.titleRight <= state.boxes[0].left, '标题栏拖动区域不得覆盖窗口按钮');
          assert.ok(state.boxes.every(b => b.top === 0 && b.bottom === 44 && b.clear && b.appRegion === 'no-drag'), JSON.stringify(state));
          if (platform === 'linux' && expanded) {
            assert.ok(state.panelTop >= 44, 'Linux 面板本身不得跨入窗口按钮所在的标题行');
            assert.ok(state.tabsRight <= state.boxes[0].left, 'Linux 标签栏不得伸入窗口按钮区域');
          }
          evaluate('window.__windowControlCalls = []');
          for (const button of state.boxes) run('click', `[aria-label="${button.label}"]`);
          assert.deepEqual(evaluate('window.__windowControlCalls'), ['minimize', 'toggleMaximize', 'close']);
          // 窗口最右侧的最后一个像素也能点击关闭按钮。
          run('mouse', 'move', String(width - 1), '22');
          run('mouse', 'down'); run('mouse', 'up');
          assert.equal(evaluate('window.__windowControlCalls.at(-1)'), 'close');
          assert.equal(evaluate('window.__windowControlCalls.length'), 4);
        }
        results.push({ platform, width, theme, expanded, ...state });
        if (platform === 'linux' && expanded && width !== 720) run('screenshot', path.join(evidence, `linux-${width}-${theme}.png`));
      }
    }
    console.log(`${platform} ${width}：浅色/深色、右栏展开/收起通过`);
  }
}
writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`通过 ${results.length} 组布局检查，其中 24 组执行了窗口按钮及最右侧点击检查。`);
run('close');
