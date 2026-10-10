// 会话区标签栏与输入框的三条版式/行为契约（用户实报，靠源码文本钉住）：
//
// 1) 回车发送后输入框必须清空。React 会把 onSelect 合成到 keydown/keyup 上，而这两个
//    事件的派发发生在 DOM 更新之前：发送刚把 composer 清空时读到的 DOM 仍是旧正文，
//    在 onSelect 里 updateComposer(照抄 DOM) 就把清空撤销了（实测：消息已发出、
//    输入框内容还在，且时好时坏——只有选区变化触发 onSelect 的那几次才复发）。
// 2) 会话视图标签栏（对话/轨迹/上下文）是绝对定位浮层，消息视口必须从它下方开始，
//    否则第一条消息顶到标签栏上（用户口径：加了 tab 页后第一条消息跟上面没空隙）。
// 3) 侧栏收起/展开不换图：两个状态用同一个面板图标。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const app = read("../src/App.tsx");
const css = read("../src/styles.css");

/** 取出某个选择器的规则体（源码文本层面，够用且不依赖 CSS 解析器） */
function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start > 0, `styles.css 里应有 ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

/** 取出某个 aria-label 按钮的整段 JSX（含结束标签） */
function buttonBlock(label) {
  const at = app.indexOf(`aria-label="${label}"`);
  assert.ok(at > 0, `App.tsx 里应有 aria-label="${label}" 的按钮`);
  const open = app.lastIndexOf("<button", at);
  const close = app.indexOf("</button>", at);
  assert.ok(open > 0 && close > open, `应能取到「${label}」按钮的 JSX`);
  return app.slice(open, close);
}

test("回车发送后输入框清空：onSelect 只同步候选菜单，绝不回写 composer", () => {
  const onSelectAt = app.indexOf("onSelect={(event) => {");
  assert.ok(onSelectAt > 0, "输入框应挂 onSelect（点回 @token//token 后面重新唤起候选菜单）");
  const onSelectBody = app.slice(onSelectAt, app.indexOf("onContextMenu", onSelectAt));
  assert.doesNotMatch(
    onSelectBody,
    /updateComposer\(/,
    "onSelect 不能调 updateComposer：它会把陈旧 DOM 正文写回 composer，撤销发送后的清空",
  );
  assert.match(
    onSelectBody,
    /syncComposerDerivedState\(target\.value/,
    "onSelect 只应同步候选菜单/技能引用（不写正文）",
  );
  // onChange 仍走完整路径：写 composer + 同步候选菜单
  assert.match(app, /onChange=\{\(event\) => updateComposer\(event\.target\.value/);
  assert.match(app, /const syncComposerDerivedState = \(value: string, caret\?: number\) => \{/);
  assert.match(
    app,
    /const updateComposer = \(value: string, caret\?: number\) => \{\s+setComposer\(value\);\s+syncComposerDerivedState\(value, caret\);/,
    "updateComposer 应写 composer 后复用同一套菜单同步逻辑",
  );
});

test("会话视图标签栏不遮挡消息区：视口与搜索条都排在标签栏下方", () => {
  assert.match(css, /--conversation-tabs-height:\s*34px/, "标签栏高度要有统一变量，别在各处写 34px");
  assert.match(rule(".conversation-tabs"), /height:\s*var\(--conversation-tabs-height\)/);
  assert.match(
    rule(".conversation-viewport"),
    /inset:\s*calc\(var\(--topbar-height\) \+ var\(--conversation-tabs-height\)\) 0 0/,
    "消息视口要从标签栏下方开始，并把留白交给 .conversation-column 的 padding-top",
  );
  assert.match(
    rule(".conversation-view-panel"),
    /top:\s*calc\(var\(--topbar-height\) \+ var\(--conversation-tabs-height\)\)/,
    "插件视图面板与消息视口用同一套顶边（切标签不跳）",
  );
  // 会话内搜索条是浮层：也得让到标签栏下面，否则压在标签上
  assert.match(
    rule(".conversation-search"),
    /top:\s*calc\(var\(--topbar-height\) \+ var\(--conversation-tabs-height\) \+ 10px\)/,
  );
  // 留白本身：列顶内边距必须大于 0（标签栏与第一条消息之间的空隙）
  const padding = /padding:\s*(\d+)px 0 calc\(var\(--composer-height/.exec(rule(".conversation-column"));
  assert.ok(padding && Number(padding[1]) >= 12, "第一条消息与标签栏之间要有可见留白");
});

test("侧栏收起/展开用同一个图标，不换图", () => {
  const toolbar = app.slice(app.indexOf('<header className="titlebar"'), app.indexOf('</header>', app.indexOf('<header className="titlebar"')));
  assert.match(toolbar, /aria-label=\{sidebarOpen \? "收起侧栏" : "展开侧栏"\}/);
  assert.match(toolbar, /onClick=\{\(\) => setSidebarOpen\(open => !open\)\}/);
  assert.match(toolbar, /<PanelLeftIcon size=\{18\} \/>/);
  const collapsed = buttonBlock("展开侧栏");
  assert.match(collapsed, /<PanelLeftIcon size=\{18\} \/>/);
  assert.doesNotMatch(collapsed, /<PanelRightIcon/);
  assert.match(app, /function PanelLeftIcon/, "面板图标组件应仍然存在");
});
