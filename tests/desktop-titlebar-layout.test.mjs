// 窗口标题栏排布契约（源码文本层面，够用且不依赖 CSS 解析器）。
//
// Linux 与 Windows 的窗口都由应用自绘标题栏：品牌与侧栏同列，收起手柄贴着品牌，
// 侧栏首行放新建任务与收件箱。macOS 保留原生红绿灯，不参与这套排布。
// 这类改动一旦漏掉某个平台，表现就是"某一侧的标题栏空一块"，靠源码钉住。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const layout = read("../src/layout.css");
const app = read("../src/App.tsx");

test("标题栏品牌排布同时覆盖 Windows 与 Linux", () => {
  assert.match(layout, /:is\(\.platform-win32, \.platform-linux\) \.titlebar-left \{/, "标题栏左区要同时匹配 win32 与 linux");
  assert.match(layout, /:is\(\.platform-win32, \.platform-linux\) \.titlebar-brand \{/, "品牌文字要同时匹配 win32 与 linux");
  assert.match(layout, /:is\(\.platform-win32, \.platform-linux\) \.titlebar-app-logo \{/, "导航栏顶部的应用图标要同时匹配 win32 与 linux");
  assert.doesNotMatch(layout, /\.platform-linux \.titlebar-left\s*\{/, "标题栏排布不能只留给 Linux");
});

test("收起侧栏与窄窗口沿用同一套标题栏排布", () => {
  assert.match(layout, /:is\(\.platform-win32, \.platform-linux\)\.sidebar-collapsed \.titlebar-left \{/);
  assert.match(layout, /:is\(\.platform-win32, \.platform-linux\)\.sidebar-collapsed \.titlebar-brand \{ display: none; \}/);
  assert.match(layout, /--titlebar-content-left: calc\(var\(--rail-width\) \+ 40px\)/);
});

test("窗口外框的细线收边只用于 Linux", () => {
  // Windows 有系统绘制的窗口外框与阴影，不需要再补一圈细线把窗口和桌面分开。
  assert.match(layout, /html \.reference-layout\.platform-linux \{\s*outline: 1px solid/);
  assert.doesNotMatch(layout, /:is\(\.platform-win32, \.platform-linux\)\s*\{\s*outline/);
});

test("窗口按钮贴着窗口右上角：标题栏右内边距与窗口留白都不参与", () => {
  // 关闭键离窗口右边缘原来是「标题栏右内边距 + 内容区右侧留白」两段间隔，用户口径：去掉。
  assert.match(layout, /:is\(\.platform-win32, \.platform-linux\) \.titlebar \{ padding-right: 0; \}/);
  assert.match(
    layout,
    /:is\(\.platform-win32, \.platform-linux\) \.titlebar-right \{ margin-left: auto; margin-right: calc\(-1 \* var\(--frame-gap\)\); \}/,
  );
});

test("右侧标签条不声明窗口拖动区域：否则会截走窗口按钮上的点击", () => {
  // 标签条横跨标题栏、压在右上角三个窗口按钮下面。它一旦自己声明 drag，
  // 鼠标落在按钮上会先被拖动区域截走，按钮点不动（Windows 实报，Linux 同一套规则）。
  assert.match(layout, /\.reference-layout \.tool-panel-tabs \{ -webkit-app-region: initial; \}/, "参考布局里标签条必须清掉自己的拖动区域");
  // styles.css 里给旧布局写的 drag 不受影响，但参考布局的标签条规则一条都不能再声明 drag
  const tabsRules = [...layout.matchAll(/\.reference-layout[^{}]*\.tool-panel-tabs[^{}]*\{([^}]*)\}/g)];
  assert.ok(tabsRules.length > 0, "layout.css 应有作用于参考布局标签条的规则");
  for (const rule of tabsRules) assert.doesNotMatch(rule[1], /app-region: drag/);
});

test("界面按「除 macOS 外都自绘标题栏」决定排布，且不留 Linux 专用分支", () => {
  assert.match(app, /const desktopToolbarLayout = \(platform \|\| "linux"\) !== "darwin";/);
  assert.doesNotMatch(app, /const linuxLayout/, "旧变量应已改名，避免只在 Linux 生效");
  for (const usage of [
    'desktopToolbarLayout && <span className="titlebar-app-logo">',
    'desktopToolbarLayout && <span className="titlebar-brand">',
    'desktopToolbarLayout ? "sidebar-primary-row" : "sidebar-brand-row"',
    '{!desktopToolbarLayout && newTaskButton}',
  ]) {
    assert.ok(app.includes(usage), `App.tsx 应使用共享排布：${usage}`);
  }
});
