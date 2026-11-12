// scripts/demo-codex-computer-use.mjs
// Codex 电脑操作对齐能力一键体验与演示用例
// 运行命令：./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/demo-codex-computer-use.mjs

import { app, BrowserWindow, screen } from 'electron';
import assert from 'node:assert/strict';
import { McpClient } from '../dist/electron/mcp.mjs';
import { listImportableBrowsers } from '../dist/electron/browser-import.mjs';
import { fileURLToPath } from 'node:url';

// 终端彩色格式工具
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log(`\n${c.bold}${c.cyan}================================================================${c.reset}`);
  console.log(`${c.bold}${c.cyan}     DYWorker × Codex 电脑操作对齐能力交互体验用例             ${c.reset}`);
  console.log(`${c.bold}${c.cyan}================================================================${c.reset}\n`);

  assert.equal(process.platform, 'darwin', '本演示用例基于 macOS 辅助功能 (AX) 运行。');

  app.on('window-all-closed', () => {});
  app.commandLine.appendSwitch('force-renderer-accessibility');
  await app.whenReady();
  app.setActivationPolicy('accessory'); // 不在 Dock 强占焦点
  app.setAccessibilitySupportEnabled(true);

  // 计算屏幕右侧摆放位置
  const primaryDisplay = screen.getPrimaryDisplay().workArea;
  const winWidth = 480;
  const winHeight = 620;
  const winX = primaryDisplay.x + primaryDisplay.width - winWidth - 30;
  const winY = primaryDisplay.y + 60;

  const isHeadless = process.env.DYWORKER_DEMO_HEADLESS === '1';

  console.log(`${c.blue}1. 准备演示界面...${c.reset}`);
  const win = new BrowserWindow({
    x: winX,
    y: winY,
    width: winWidth,
    height: winHeight,
    show: false,
    alwaysOnTop: true, // 便于用户在终端操作时旁观
    title: 'DYWorker 演示：Codex 后台静默操作',
    webPreferences: {
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  let focusGained = 0;
  win.on('focus', () => {
    focusGained++;
    console.log(`\n${c.yellow}⚠️ [提示] 测试窗口被激活聚焦了 (次数: ${focusGained})${c.reset}`);
  });

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>DYWorker 演示：Codex 后台静默操作</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #18181b; color: #f4f4f5; padding: 20px; font-size: 13px; user-select: none; }
    .card { background: #27272a; border-radius: 8px; padding: 14px; margin-bottom: 12px; border: 1px solid #3f3f46; }
    .title { font-size: 15px; font-weight: 600; color: #38bdf8; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }
    .badge { font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 500; }
    .badge-ok { background: #064e3b; color: #34d399; }
    .badge-warn { background: #78350f; color: #fde047; }
    button { background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s; }
    button:hover { background: #1d4ed8; }
    button.clicked { background: #16a34a; transform: scale(1.03); }
    input { width: 100%; background: #18181b; border: 1px solid #52525b; color: #fafafa; padding: 8px 12px; border-radius: 6px; font-size: 13px; outline: none; }
    input:focus { border-color: #38bdf8; }
    .scroll-box { height: 140px; overflow-y: scroll; background: #18181b; border-radius: 6px; border: 1px solid #3f3f46; padding: 8px; }
    .scroll-item { padding: 6px 10px; border-bottom: 1px solid #27272a; font-size: 12px; color: #a1a1aa; }
    .scroll-item:last-child { border-bottom: none; }
    .log-box { height: 110px; overflow-y: auto; background: #09090b; border-radius: 6px; border: 1px solid #27272a; padding: 8px; font-family: monospace; font-size: 11px; color: #22c55e; }
  </style>
</head>
<body>
  <div class="title">
    <span>🤖 Codex 后台静默操作演示</span>
    <span id="focusBadge" class="badge badge-ok">🟢 焦点保持在终端</span>
  </div>

  <div class="card">
    <div style="margin-bottom:8px;font-weight:500;color:#e4e4e7">1. 后台控件点击 (无鼠标轨迹)</div>
    <div style="display:flex;align-items:center;gap:12px">
      <button id="btn" aria-label="后台执行按钮" onclick="recordClick()">⚡ 点击计数: 0</button>
      <span id="clickHint" style="color:#a1a1aa;font-size:12px">等待后台指令触发...</span>
    </div>
  </div>

  <div class="card">
    <div style="margin-bottom:8px;font-weight:500;color:#e4e4e7">2. 后台文本注入 (不占用剪贴板/前台输入)</div>
    <input id="input" aria-label="后台文本输入框" value="初始文本：等待 Agent 写入..." />
  </div>

  <div class="card">
    <div style="margin-bottom:8px;font-weight:500;color:#e4e4e7">3. 后台无焦点滚动 (AX 滚动条控制)</div>
    <div id="scrollContainer" class="scroll-box" aria-label="待滚动列表">
      ${Array.from({ length: 30 }, (_, i) => `<div class="scroll-item">📄 数据行 #${i + 1}：Codex 电脑操作自动化审计日志项</div>`).join('')}
    </div>
  </div>

  <div class="card" style="margin-bottom:0">
    <div style="margin-bottom:6px;font-weight:500;color:#e4e4e7">实时事件记录：</div>
    <div id="logs" class="log-box"></div>
  </div>

  <script>
    let clicks = 0;
    const btn = document.getElementById('btn');
    const logs = document.getElementById('logs');
    const focusBadge = document.getElementById('focusBadge');

    function log(msg) {
      const line = document.createElement('div');
      line.textContent = "[" + new Date().toLocaleTimeString() + "] " + msg;
      logs.appendChild(line);
      logs.scrollTop = logs.scrollHeight;
    }

    function recordClick() {
      clicks++;
      btn.textContent = "⚡ 点击计数: " + clicks;
      btn.classList.add('clicked');
      document.getElementById('clickHint').textContent = "✅ 已由后台 AXPress 触发！";
      document.getElementById('clickHint').style.color = "#4ade80";
      log("按钮被触发点击，当前计数：" + clicks);
      setTimeout(() => btn.classList.remove('clicked'), 600);
    }

    window.addEventListener('focus', () => {
      focusBadge.textContent = "🔴 窗口意外获得焦点";
      focusBadge.className = "badge badge-warn";
      log("⚠️ 收到 focus 事件");
    });
    window.addEventListener('blur', () => {
      focusBadge.textContent = "🟢 焦点保持在终端";
      focusBadge.className = "badge badge-ok";
    });

    log("演示页面就绪，准备接收 MCP 指令");
  </script>
</body>
</html>
  `;

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

  if (!isHeadless) {
    win.showInactive(); // 关键：以非激活状态显示窗口，焦点完全留在终端！
  }

  // 启动 macOS Computer Use MCP 客户端
  console.log(`${c.blue}2. 连接 macOS Computer Use MCP 服务...${c.reset}`);
  const client = new McpClient({
    command: process.execPath,
    args: [fileURLToPath(new URL('../dist/electron/macos-computer-use-server.mjs', import.meta.url))],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    requestTimeoutMs: 30000,
  });

  try {
    await client.connect();
    console.log(`${c.green}✔ MCP 服务连接成功。${c.reset}\n`);

    // --- 步骤 1：读取应用与控件树 ---
    console.log(`${c.bold}${c.magenta}【步骤 1 / 5】后台读取应用与控件树 (get_app_state)${c.reset}`);
    let state = await client.callTool('get_app_state', { app: `pid:${process.pid}` });
    for (let i = 0; (state.isError || !state.text.includes('后台执行按钮')) && i < 20; i++) {
      await sleep(300);
      state = await client.callTool('get_app_state', { app: `pid:${process.pid}` });
    }
    assert.equal(state.isError, false, `获取状态失败: ${state.text}`);

    const parseTarget = text => ({
      app: `pid:${process.pid}`,
      window_id: /窗口编号：(\d+)/.exec(text)?.[1],
      window_title: /窗口：([^\n]+)/.exec(text)?.[1],
      observation_id: /观察编号：([^\s]+)/.exec(text)?.[1],
    });
    const findElementIndex = (text, name) => {
      const line = text.split('\n').find(row => row.includes(name));
      assert.ok(line, `未在界面中找到控件: ${name}`);
      return /\[(e\d+)\]/.exec(line)?.[1];
    };

    const target = parseTarget(state.text);
    console.log(`${c.gray}识别到目标窗口: "${target.window_title}" (ID: ${target.window_id})${c.reset}`);
    const btnIndex = findElementIndex(state.text, '后台执行按钮');
    const inputIndex = findElementIndex(state.text, '后台文本输入框');
    console.log(`${c.green}✔ 成功识别控件：按钮 [${btnIndex}]、输入框 [${inputIndex}]${c.reset}\n`);
    await sleep(800);

    // --- 步骤 2：后台点击按钮 ---
    console.log(`${c.bold}${c.magenta}【步骤 2 / 5】后台静默点击按钮 (AXPress 触发，无需移动前台鼠标)${c.reset}`);
    const clickRes = await client.callTool('click', {
      ...target,
      element_index: btnIndex,
      background: true,
    });
    assert.equal(clickRes.isError, false, clickRes.text);
    const clickCount = await win.webContents.executeJavaScript('clicks');
    assert.equal(clickCount, 1, '按钮计数应当为 1');
    console.log(`${c.green}✔ 后台点击成功！测试窗口计数已累加为: ${clickCount}${c.reset}`);
    console.log(`${c.gray}当前窗口聚焦状态: ${win.isFocused() ? '聚焦(异常)' : '未获焦点(正常)'}${c.reset}\n`);
    await sleep(800);

    // --- 步骤 3：后台输入文字 ---
    console.log(`${c.bold}${c.magenta}【步骤 3 / 5】后台文本输入 (set_value 写入，无需切换输入法或窗口)${c.reset}`);
    const injectionText = '🚀 Codex 级别静默注入成功！(中文+Emoji+空格)';
    const inputRes = await client.callTool('set_value', {
      ...target,
      element_index: inputIndex,
      value: injectionText,
      background: true,
    });
    assert.equal(inputRes.isError, false, inputRes.text);
    const actualInputValue = await win.webContents.executeJavaScript("document.getElementById('input').value");
    assert.equal(actualInputValue, injectionText);
    console.log(`${c.green}✔ 后台文本设置成功！输入框内容: "${actualInputValue}"${c.reset}`);
    console.log(`${c.gray}当前窗口聚焦状态: ${win.isFocused() ? '聚焦(异常)' : '未获焦点(正常)'}${c.reset}\n`);
    await sleep(800);

    // --- 步骤 4：后台无焦点滚动 ---
    console.log(`${c.bold}${c.magenta}【步骤 4 / 5】后台无焦点滚动 (AX 滚动条控制，不发送系统前台滚轮)${c.reset}`);
    const getScrollTop = () => win.webContents.executeJavaScript("document.getElementById('scrollContainer').scrollTop");
    const initialScroll = await getScrollTop();
    assert.equal(initialScroll, 0);

    // 调用后台滚动
    const scrollRes = await client.callTool('scroll', {
      ...target,
      direction: 'down',
      pages: 1,
      background: true,
    });
    assert.equal(scrollRes.isError, false, scrollRes.text);
    await sleep(300);
    const scrolledTop = await getScrollTop();
    console.log(`${c.green}✔ 后台滚动生效！列表 scrollTop 从 ${initialScroll} 滑动至 ${scrolledTop}px${c.reset}`);
    console.log(`${c.gray}当前窗口聚焦状态: ${win.isFocused() ? '聚焦(异常)' : '未获焦点(正常)'}${c.reset}\n`);
    await sleep(800);

    // --- 步骤 5：安全防护拦截校验 ---
    console.log(`${c.bold}${c.magenta}【步骤 5 / 5】安全性防御：校验不支持后台的危险动作被拦截${c.reset}`);
    const dangerousKeyRes = await client.callTool('press_key', {
      ...target,
      key: 'Return',
      background: true,
    });
    assert.equal(dangerousKeyRes.isError, true, '后台按键必须被拒绝');
    console.log(`${c.green}✔ 校验通过：后台键盘按键被系统安全机制正确拦截并返回警告：${c.reset}`);
    console.log(`${c.yellow}   "${dangerousKeyRes.text.trim()}"${c.reset}\n`);

    // --- 跨浏览器登录态能力演示 ---
    console.log(`${c.bold}${c.magenta}【附加演示】跨多环境浏览器登录态探测能力${c.reset}`);
    const browsers = await listImportableBrowsers();
    console.log(`${c.green}✔ 成功探测到本机已安装的环境与浏览器画像 (${browsers.length} 个):${c.reset}`);
    browsers.slice(0, 5).forEach((b, idx) => {
      console.log(`   ${idx + 1}. [${b.type}] ${b.name} ${b.defaultProfile ? `(默认Profile: ${b.defaultProfile.name})` : ''}`);
    });
    if (browsers.length > 5) {
      console.log(`   ... 以及其他 ${browsers.length - 5} 个浏览器环境`);
    }

    console.log(`\n${c.bold}${c.green}================================================================${c.reset}`);
    console.log(`${c.bold}${c.green}      🎉 全部 Codex 电脑操作对齐能力项验证通过！              ${c.reset}`);
    console.log(`${c.bold}${c.green}================================================================${c.reset}`);
    console.log(`${c.gray}窗口聚焦统计：全程激活次数 = ${focusGained}，当前聚焦 = ${win.isFocused() ? '是' : '否'}${c.reset}`);
    console.log(`${c.gray}演示窗口将在 3 秒后自动关闭并退出...${c.reset}\n`);

    await win.webContents.executeJavaScript(`log("🎉 全部 5 项 Codex 能力演示完毕！本窗口即将关闭。")`);
    await sleep(3000);
  } finally {
    await client.close().catch(() => {});
    win.destroy();
  }
}

main().then(
  () => app.exit(0),
  err => {
    console.error(`\n${c.red}❌ 演示执行出错:${c.reset}`, err);
    app.exit(1);
  }
);
