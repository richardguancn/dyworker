// 外观自定义实机验收驱动（macOS）：通过 CDP 操作真实 Electron 窗口。
// 前置：vite dev server 在 127.0.0.1:5173，electron 以 --remote-debugging-port=9333 启动，
// 且 DYWORKER_USER_DATA_DIR 指向隔离目录。
// 用法：node scripts/e2e-appearance-check.mjs phase1|phase2 [证据目录]
import fs from "node:fs";
import path from "node:path";

const phase = process.argv[2] || "phase1";
const evidenceDir = process.argv[3] || "docs/verification/appearance-2026-09-27";
const userDataDir = process.env.DYWORKER_USER_DATA_DIR || "/tmp/dyw-appearance-test";
fs.mkdirSync(evidenceDir, { recursive: true });

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
      const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1:5173"));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 还没起 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("无法连接 CDP（9333）");
}

let msgId = 0;
const pending = new Map();
let ws;
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} 超时`)); } }, 15000);
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`页面内执行失败: ${JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails.text)}`);
  return result.result?.value;
}

async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(evidenceDir, name), Buffer.from(shot.data, "base64"));
}

async function waitFor(expression, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evaluate(expression)) return true; } catch { /* 页面还在加载 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  record(label, false, "等待超时");
  return false;
}

const clickByText = (selector, text) => `
  (() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => n.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return false;
    el.click();
    return true;
  })()
`;

async function openAppearanceSettings() {
  if (!(await evaluate(`(() => { const b = document.querySelector('button[aria-label="设置"]'); if (!b) return false; b.click(); return true; })()`))) return false;
  await new Promise((r) => setTimeout(r, 600));
  return evaluate(clickByText(".settings-nav-item", "外观"));
}

const wsUrl = await connect();
ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg.result); pending.delete(msg.id); }
};
await send("Runtime.enable");
await send("Page.enable");

if (phase === "phase1") {
  // S1 启动：无闪烁地解析主题
  if (await waitFor(`Boolean(document.querySelector('.app-shell'))`, "启动渲染主界面")) {
    const theme = await evaluate(`document.documentElement.dataset.theme`);
    record("启动时输出明确的 data-theme", theme === "light" || theme === "dark", `data-theme=${theme}`);
    fs.writeFileSync(path.join(evidenceDir, "initial-theme.txt"), String(theme));
    await screenshot("01-initial.png");
  }

  // S2 设置入口与搜索
  if (await openAppearanceSettings()) {
    record("设置导航存在「外观」栏目并可直接打开", await waitFor(`Boolean(document.querySelector('.appearance-panel'))`, "外观面板渲染"));
    await screenshot("02-appearance-panel.png");
  }

  // S3 主题预览：切深色立即生效但不落盘
  if (await evaluate(clickByText('.appearance-segmented[aria-label="主题"] button', "深色"))) {
    await new Promise((r) => setTimeout(r, 400));
    record("切换深色立即预览", (await evaluate(`document.documentElement.dataset.theme`)) === "dark");
    record("显示「预览中，保存后保留」", await evaluate(`[...document.querySelectorAll('.appearance-status')].some((n) => n.textContent.includes("预览中"))`));
    record("预览未落盘", !fs.existsSync(path.join(userDataDir, "appearance.json")), "appearance.json 不应存在");
    await screenshot("03-dark-preview.png");
  } else record("主题控件可点击", false, "未找到深色选项");

  // S4 Esc 恢复已保存值
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await new Promise((r) => setTimeout(r, 500));
  const initialTheme = fs.readFileSync(path.join(evidenceDir, "initial-theme.txt"), "utf8");
  record("Esc 关闭设置并恢复已保存外观",
    (await evaluate(`Boolean(document.querySelector('.settings-dialog'))`)) === false &&
    (await evaluate(`document.documentElement.dataset.theme`)) === initialTheme);

  // S5 保存持久化
  await openAppearanceSettings();
  await evaluate(clickByText('.appearance-segmented[aria-label="主题"] button', "深色"));
  await new Promise((r) => setTimeout(r, 400));
  // 玻璃开启（macOS 应可用背景模糊）
  await evaluate(`(() => { const box = [...document.querySelectorAll('.appearance-panel input[type="checkbox"]')][0]; if (box && !box.checked) box.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 600));
  record("玻璃开启后 html 标记与模糊材质生效",
    (await evaluate(`document.documentElement.dataset.glass`)) !== "off" &&
    (await evaluate(`getComputedStyle(document.querySelector('.sidebar')).backdropFilter`)).includes("blur"));
  await evaluate(clickByText(".appearance-actions button", "保存外观"));
  record("保存成功提示", await waitFor(`[...document.querySelectorAll('.appearance-status')].some((n) => n.textContent.includes("已保存"))`, "保存提示"));
  await new Promise((r) => setTimeout(r, 400));
  const savedFile = path.join(userDataDir, "appearance.json");
  const saved = fs.existsSync(savedFile) ? JSON.parse(fs.readFileSync(savedFile, "utf8")) : null;
  record("保存写入独立 appearance.json（theme=dark, glass 开启）",
    saved?.theme === "dark" && saved?.glass?.enabled === true, saved ? `theme=${saved.theme}` : "文件不存在");
  record("模型设置文件不含外观字段（存储独立）", (() => {
    const f = path.join(userDataDir, "settings.json");
    return !fs.existsSync(f) || !("theme" in JSON.parse(fs.readFileSync(f, "utf8")));
  })());
  await screenshot("05-saved-dark-glass.png");
  ws.close();
  console.log(JSON.stringify({ phase, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length }));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

if (phase === "phase3") {
  // 预置：userData 里已手工放好 appearance.json（浅色+图片+透明度35%+标准玻璃）与图片资源
  if (await waitFor(`Boolean(document.querySelector('.app-shell'))`, "启动渲染主界面")) {
    await new Promise((r) => setTimeout(r, 1200));
    record("透明度/图片/玻璃启用面板透出标记", (await evaluate(`document.documentElement.dataset.translucent`)) === "true");
    const surface = await evaluate(`document.documentElement.style.getPropertyValue('--surface')`);
    record("无自定义色时透明度也派生面板变量", /rgba\(/.test(surface) && parseFloat(surface.split(",")[3]) < 1, `--surface=${surface}`);
    const mainBg = await evaluate(`getComputedStyle(document.querySelector('.main-panel')).backgroundColor`);
    record("中间会话区面板半透明（图片可透出）", /rgba/.test(mainBg) && parseFloat(mainBg.split(",")[3]) < 0.9, mainBg);
    const img = await evaluate(`getComputedStyle(document.querySelector('.appearance-backdrop'), '::before').backgroundImage`);
    record("背景层加载了图片", /blob:|url\(/.test(img), img.slice(0, 48));
    const blur = await evaluate(`getComputedStyle(document.querySelector('.sidebar')).backdropFilter`);
    record("玻璃模糊实际生效", blur.includes("blur"), blur);
    await screenshot("10-bg-image-translucent.png");
  }

  // 拖透明度滑块：先关玻璃验证 0% 完全不透明，再开玻璃验证透出
  const setSlider = (value) => `(() => {
    const slider = document.querySelectorAll('.appearance-panel input[type="range"]')[0];
    if (!slider) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(slider, ${value});
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`;
  await openAppearanceSettings();
  await screenshot("11-panel-ui.png");
  // 关掉玻璃主开关（玻璃会故意保留少量透出，否则 0% 无法验证不透明）
  await evaluate(`(() => { const box = document.querySelectorAll('.appearance-panel input[type="checkbox"]')[0]; if (box && box.checked) box.click(); return true; })()`);
  await evaluate(setSlider(0));
  await new Promise((r) => setTimeout(r, 500));
  const solid = await evaluate(`getComputedStyle(document.querySelector('.main-panel')).backgroundColor`);
  record("玻璃关闭且透明度 0% 时面板完全不透明", /^rgb\(/.test(solid), solid);
  // 开回玻璃：0% 透明度下仍保留少量透出（玻璃可见性的设计行为）
  await evaluate(`(() => { const box = document.querySelectorAll('.appearance-panel input[type="checkbox"]')[0]; if (box && !box.checked) box.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 400));
  const glassSolid = await evaluate(`getComputedStyle(document.querySelector('.main-panel')).backgroundColor`);
  record("玻璃开启时正文区保持高不透明度（≥0.8）", parseFloat(glassSolid.split(",")[3]) >= 0.8, glassSolid);
  await evaluate(setSlider(70));
  await new Promise((r) => setTimeout(r, 500));
  const sheer = await evaluate(`getComputedStyle(document.querySelector('.main-panel')).backgroundColor`);
  record("透明度 70% 时面板明显透出", parseFloat(sheer.split(",")[3]) < 0.7, sheer);
  record("滑块过程不写盘（未保存）", await evaluate(`[...document.querySelectorAll('.appearance-status')].some((n) => n.textContent.includes("预览中"))`));
  await screenshot("12-transparency-70.png");

  ws.close();
  console.log(JSON.stringify({ phase, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length }));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
if (phase === "phase2") {
  // S6 重启后保存的外观恢复
  if (await waitFor(`Boolean(document.querySelector('.app-shell'))`, "重启后渲染主界面")) {
    await new Promise((r) => setTimeout(r, 800));
    record("重启恢复已保存深色主题", (await evaluate(`document.documentElement.dataset.theme`)) === "dark");
    record("重启恢复玻璃标记", (await evaluate(`document.documentElement.dataset.glass`)) !== "off");
    await screenshot("04-after-restart.png");
  }

  // S7 界面字号：特大 → 取消恢复
  await openAppearanceSettings();
  const picked = await evaluate(clickByText(".appearance-segmented button", "特大"));
  if (picked) {
    await new Promise((r) => setTimeout(r, 300));
    const scale = await evaluate(`document.documentElement.style.getPropertyValue('--font-ui-scale')`);
    record("特大界面字号写入缩放变量", Math.abs(parseFloat(scale) - 18 / 14) < 0.01, `--font-ui-scale=${scale}`);
    await evaluate(clickByText(".appearance-actions button", "取消"));
    await new Promise((r) => setTimeout(r, 300));
    const restored = await evaluate(`document.documentElement.style.getPropertyValue('--font-ui-scale')`) || "1";
    record("取消后字号恢复已保存基准", Math.abs(parseFloat(restored) - 1) < 0.01, `scale=${restored}`);
  } else record("字号控件可点击", false, "未找到特大选项");

  // S8 自定义颜色 + 恢复默认（当前主题为深色：必须点「深色背景色」行的色板）
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.appearance-row')].find((r) => r.textContent.includes("深色背景色"));
    const s = row && [...row.querySelectorAll('.appearance-swatch')].find((b) => b.title.startsWith("#"));
    if (s) { s.click(); return true; } return false;
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  record("自定义背景色派生面板变量", Boolean(await evaluate(`document.documentElement.style.getPropertyValue('--surface')`)));
  await evaluate(clickByText(".appearance-actions button", "恢复默认"));
  await new Promise((r) => setTimeout(r, 300));
  record("恢复默认清除自定义面板变量（草稿）", (await evaluate(`document.documentElement.style.getPropertyValue('--surface')`)) === "");
  await evaluate(clickByText(".appearance-actions button", "保存外观"));
  await waitFor(`[...document.querySelectorAll('.appearance-status')].some((n) => n.textContent.includes("已保存"))`, "恢复默认后保存");
  await screenshot("06-final.png");

  ws.close();
  console.log(JSON.stringify({ phase, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length }));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
