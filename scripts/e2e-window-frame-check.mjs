// 对隔离运行的 DYWorker 检查外框不会被浏览器定位/聚焦操作横向滚动。
// 前置：启动配置了模型的测试实例并开放 CDP；安装 agent-browser。
// 用法：node scripts/e2e-window-frame-check.mjs 49632 [证据目录]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const port = process.argv[2];
assert.ok(/^\d+$/.test(port || ''), '请提供隔离测试实例的 CDP 端口');
const evidence = path.resolve(process.argv[3] || 'docs/verification/window-frame-2026-10-13');
mkdirSync(evidence, { recursive: true });
const session = `dyw-frame-${port}`;
const run = (...args) => {
  const output = execFileSync('agent-browser', ['--session', session, '--json', ...args], { encoding: 'utf8' });
  const response = JSON.parse(output);
  assert.equal(response.success, true, output);
  return response.data;
};
const evaluate = source => run('eval', source).result;
// Electron 窗口在后台时动画时钟可能停住；检查切换后的最终布局。
const settle = () => evaluate(`(async () => {
  await new Promise(resolve => setTimeout(resolve, 240));
  for (const animation of document.getAnimations()) {
    if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
  }
  return true;
})()`);
const results = [];
const check = label => {
  // 定位到右侧按钮会让旧版 #root 向右滚动 85px，连同左侧栏一起移出窗口。
  // 额外尝试直接滚动，覆盖菜单、弹窗和查找定位等不同入口。
  const state = evaluate(`(() => {
    document.querySelector('.composer-mode').scrollIntoView({ block: 'nearest', inline: 'center' });
    const frames = [document.documentElement, document.body, document.querySelector('#root')];
    for (const frame of frames) frame.scrollLeft = 10000;
    const rail = document.querySelector('.navigation-rail').getBoundingClientRect();
    return { width: innerWidth, railLeft: rail.left, scrollLeft: frames.map(frame => frame.scrollLeft),
      rootWidth: document.querySelector('#root').scrollWidth,
      rightCollapsed: document.querySelector('.app-shell').classList.contains('right-panel-collapsed') };
  })()`);
  results.push({ label, ...state });
  assert.equal(state.railLeft, 0, `${label}：主导航移出了左边界`);
  assert.deepEqual(state.scrollLeft, [0, 0, 0], `${label}：窗口外框被横向滚动`);
  assert.ok(state.rootWidth <= state.width, `${label}：外框被内容撑宽`);
};
const togglePanel = (expanded, openLabel, closeLabel) => {
  const current = evaluate(`document.querySelector('.app-shell').classList.contains('${expanded}')`);
  if (current) run('find', 'role', 'button', 'click', '--name', openLabel);
  else run('find', 'role', 'button', 'click', '--name', closeLabel);
  settle();
};

run('connect', port);
const initial = evaluate(`({width: innerWidth, height: innerHeight,
  sidebarCollapsed: document.querySelector('.app-shell').classList.contains('sidebar-collapsed'),
  rightCollapsed: document.querySelector('.app-shell').classList.contains('right-panel-collapsed')})`);
evaluate(`(() => {
  const style = document.createElement('style');
  style.id = 'window-frame-qa-motion';
  style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }';
  document.head.append(style);
  return true;
})()`);
try {
  for (const width of [1184, 960, 720, 420]) {
    run('set', 'viewport', String(width), '736');
    settle();
    run('press', 'Escape');
    check(`${width}：初始状态`);
    for (let cycle = 0; cycle < 2; cycle++) {
      togglePanel('right-panel-collapsed', '展开右侧工具栏', '收起右侧工具栏');
      check(`${width}：右侧工具栏切换 ${cycle + 1}`);
      togglePanel('sidebar-collapsed', '展开侧栏', '收起侧栏');
      check(`${width}：左侧栏切换 ${cycle + 1}`);
    }
    // 窄窗口的工具栏会覆盖对话区，先收起再操作输入框。
    if (!evaluate('document.querySelector(".app-shell").classList.contains("right-panel-collapsed")')) {
      togglePanel('right-panel-collapsed', '展开右侧工具栏', '收起右侧工具栏');
    }
    if (width <= 820 && !evaluate('document.querySelector(".app-shell").classList.contains("sidebar-collapsed")')) {
      togglePanel('sidebar-collapsed', '展开侧栏', '收起侧栏');
    }
    run('press', 'Escape');
    run('click', '.composer-mode');
    settle();
    assert.equal(evaluate('!!document.querySelector(".model-menu")'), true, `${width}：模型菜单未打开`);
    check(`${width}：模型菜单打开`);
    run('screenshot', path.join(evidence, `${width}-model-menu.png`));
    run('find', 'role', 'button', 'click', '--name', '管理档位…');
    const dialog = evaluate(`(() => { const r = document.querySelector('.reasoning-manager').getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight }; })()`);
    assert.ok(dialog.left >= 0 && dialog.right <= dialog.width && dialog.top >= 0 && dialog.bottom <= dialog.height,
      `${width}：档位管理超出窗口`);
    run('screenshot', path.join(evidence, `${width}-manager.png`));
    run('find', 'role', 'button', 'click', '--name', '取消');
    settle();
    check(`${width}：弹窗关闭恢复焦点`);
    if (evaluate('!!document.querySelector(".model-menu")')) run('click', '.composer-mode');
    if (evaluate('!!document.querySelector(".conversation-turn-marker")?.checkVisibility()')) {
      run('click', '.conversation-turn-marker-wrap:first-child .conversation-turn-marker');
      settle();
      check(`${width}：回合定位`);
    }
    console.log(`${width} 宽度检查通过`);
  }
  writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`通过 ${results.length} 次外框位置检查及 4 种窗口大小的弹窗检查；证据：${evidence}`);
} finally {
  run('set', 'viewport', String(initial.width), String(initial.height));
  for (const [key, label, openLabel, closeLabel] of [
    ['sidebarCollapsed', 'sidebar-collapsed', '展开侧栏', '收起侧栏'],
    ['rightCollapsed', 'right-panel-collapsed', '展开右侧工具栏', '收起右侧工具栏'],
  ]) {
    if (evaluate(`document.querySelector('.app-shell').classList.contains('${label}')`) !== initial[key]) {
      togglePanel(label, openLabel, closeLabel);
    }
  }
  evaluate('document.querySelector("#window-frame-qa-motion")?.remove(); true');
}
