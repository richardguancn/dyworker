import { readStylesSource } from "./helpers/module-source.mjs";
// 右侧面板标签条「标签多到放不下」的交互契约（用户实报，靠源码文本钉住）：
//
// 1) 标签条必须真的能横向滚动。Chromium 不会把鼠标竖向滚轮转成横向滚动，
//    所以必须自己挂一个非 passive 的 wheel 监听把位移交给标签条；
//    用被动监听会拿不到 preventDefault，滚到头就会把外层内容一起带着滚。
// 2) 溢出要有可见线索：溢出方向上有隐藏标签时，那一端渐隐并浮出滚动按钮；
//    标签不多时必须完全回到原样（不出现按钮、不留渐隐）。
// 3) 滚动按钮落在窗口拖拽区（.tool-panel-tabs 是 -webkit-app-region: drag）里，
//    漏掉 no-drag 的话点击会变成拖窗口，按钮点不动。
// 4) 当前标签始终要可见（切标签、开新标签、改面板宽度后都带进视野）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readRendererSource } from "./helpers/renderer-source.mjs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");
// App.tsx 已按域拆分，契约断言改为扫整个渲染层源码。
const app = readRendererSource();
const css = readStylesSource(new URL("../src/styles.css", import.meta.url));

/** 取出某个选择器的规则体（源码文本层面，够用且不依赖 CSS 解析器） */
function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start > 0, `styles.css 里应有 ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

test("标签条横向可滚：滚轮监听非被动，滚到头不带着外层一起滚", () => {
  const start = app.indexOf("const onWheel = (event: WheelEvent) => {");
  assert.ok(start > 0, "标签条应有自己的 wheel 处理");
  const body = app.slice(start, app.indexOf("}, [rightPanelOpen, pristineMenuPage, toolPanelTabs.length]);", start));
  assert.match(body, /strip\.scrollLeft = next;/, "滚轮位移应写回标签条自身的 scrollLeft");
  assert.match(body, /event\.preventDefault\(\);/, "处理完要阻止默认滚动，否则滚到头会把外层内容带走");
  assert.match(body, /maxScrollLeft <= 0\) return;/, "不溢出时直接放行，不抢外层滚轮");
  assert.match(
    app,
    /strip\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/,
    "必须用非 passive 监听：React 的 onWheel 是 passive，preventDefault 会失效",
  );
  assert.match(rule(".tool-panel-tab-strip"), /overflow-x:\s*auto/, "标签条要能横向滚动");
  assert.match(rule(".tool-panel-tab-strip"), /overscroll-behavior-x:\s*contain/);
  assert.match(rule(".tool-panel-tab-strip::-webkit-scrollbar"), /display:\s*none/);
});

test("溢出线索按溢出方向出现：两端渐隐 + 滚动按钮，标签不多时完全回到原样", () => {
  assert.match(app, /data-overflow-start=\{toolPanelTabOverflow\.start \? "true" : "false"\}/);
  assert.match(app, /data-overflow-end=\{toolPanelTabOverflow\.end \? "true" : "false"\}/);
  assert.match(
    css,
    /\.tool-panel-tab-strip\[data-overflow-end="true"\]\s*\{[^}]*mask-image:\s*linear-gradient\(to left/,
    "右侧还有隐藏标签时该端要渐隐",
  );
  assert.match(
    css,
    /\.tool-panel-tab-strip\[data-overflow-start="true"\]\[data-overflow-end="true"\]\s*\{[^}]*mask-image:\s*linear-gradient\(to right[^}]*transparent calc\(100% - 16px\)/,
    "两端都有隐藏标签时两端一起渐隐",
  );
  assert.match(
    css,
    /\.tool-panel-tab-strip\[data-overflow-end="true"\][^}]*mask-image:\s*linear-gradient\(to left, transparent 16px/,
    "最外侧要留出一段完全透明区给滚动按钮，别让标签内容顶在箭头上",
  );
  assert.match(
    app,
    /\{!pristineMenuPage && toolPanelTabOverflow\.start && \(\s*<button\s+className="tool-panel-tab-scroll prev"/,
    "只有左侧确实藏了标签才渲染左滚动按钮",
  );
  assert.match(
    app,
    /\{!pristineMenuPage && toolPanelTabOverflow\.end && \(\s*<button\s+className="tool-panel-tab-scroll next"/,
    "只有右侧确实藏了标签才渲染右滚动按钮",
  );
  // 状态已迁入 layoutStore（zustand），默认值不变
  assert.match(app, /toolPanelTabOverflow: \{ start: false, end: false \}/);
  assert.match(app, /setToolPanelTabOverflow: \(value\) => set/);
  const sync = app.slice(app.indexOf("const syncToolPanelTabOverflow = useCallback("), app.indexOf("}, []);", app.indexOf("const syncToolPanelTabOverflow = useCallback(")));
  assert.match(sync, /start:\s*strip\.scrollLeft > 1/);
  assert.match(sync, /end:\s*maxScrollLeft - strip\.scrollLeft > 1/);
  assert.match(sync, /current\.start === next\.start && current\.end === next\.end \? current : next/,
    "状态没变就不要 setState，避免每次滚动都重渲染");
  assert.match(app, /new ResizeObserver\(\(\) => syncToolPanelTabOverflow\(\)\)/, "面板宽度变化要重新判断溢出");
  assert.match(app, /strip\.addEventListener\("scroll", syncToolPanelTabOverflow, \{ passive: true \}\)/, "滚动过程要持续更新两端状态");
});

test("滚动按钮与面板布局：落在拖拽区里但点得动，不遮住右上角按钮", () => {
  assert.match(rule(".tool-panel-tab-strip-wrap"), /position:\s*relative/, "按钮要相对标签条定位");
  const button = rule(".tool-panel-tab-scroll");
  assert.match(button, /-webkit-app-region:\s*no-drag/, "漏掉 no-drag 会让点击变成拖窗口");
  assert.match(rule(".tool-panel-tab-scroll.prev"), /left:\s*0/);
  assert.match(rule(".tool-panel-tab-scroll.next"), /right:\s*0/);
  assert.match(
    app,
    /onClick=\{\(\) => scrollToolPanelTabStrip\(-1\)\}/,
    "左按钮要往回滚",
  );
  assert.match(app, /onClick=\{\(\) => scrollToolPanelTabStrip\(1\)\}/, "右按钮要往后滚");
  assert.match(
    app,
    /aria-label="向前滚动标签页"/,
    "按钮要有可读名称（图标按钮靠 aria-label 验收）",
  );
  assert.match(app, /aria-label="向后滚动标签页"/);
});

test("当前标签始终可见，键盘聚焦也要带进视野", () => {
  assert.match(app, /ref=\{toolPanelTabStripRef\}/, "标签条要能被脚本直接拿到");
  assert.match(app, /data-tool-panel-tab-id=\{tab\.id\}/, "要靠 data 属性定位当前标签");
  assert.match(
    app,
    /onFocus=\{\(event\) => event\.currentTarget\.closest<HTMLElement>\("\.tool-panel-tab"\)\?\.scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)\}/,
    "键盘切到藏起来的标签时要滚进视野",
  );
  const effect = app.slice(app.indexOf("// 当前标签必须可见"), app.indexOf("const scrollToolPanelTabStrip ="));
  assert.match(effect, /strip\.scrollLeft -= stripRect\.left - tabRect\.left;/);
  assert.match(effect, /strip\.scrollLeft \+= tabRect\.right - stripRect\.right;/);
  assert.doesNotMatch(app, /document\.querySelector\("\.tool-panel-tab-strip"\)/,
    "改用 ref 后不该再按类名全局查询标签条");
});
