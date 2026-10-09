// 面板分隔线与弹窗层级：这两条都是"看着像坏掉"的版式契约，靠源码文本钉住。
//
// 1) 分隔线只是边界提示，太深会抢视线（用户口径：再浅一点）。
// 2) 弹窗层必须压在分隔条之上。分隔条是 app-shell 的直接子元素（z-index: 40），
//    而插件页 .plugins-page 自带 z-index、会形成层叠上下文；弹窗若留在它内部，
//    fixed 定位会被封顶在分隔条之下，表现为竖线切穿弹窗。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const css = read("../src/styles.css");
const dialog = read("../src/AddPluginDialog.tsx");

/** 取出某个选择器的规则体（源码文本层面，够用且不依赖 CSS 解析器） */
function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start > 0, `styles.css 里应有 ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

const lineAlpha = (block) => Number(/background: rgba\(128, 132, 124, ([\d.]+)\)/.exec(block)?.[1]);

test("面板分隔线：静止时几乎看不见，悬停/拖动加深但也克制", () => {
  const idle = lineAlpha(rule(".panel-resize-handle::after"));
  const active = lineAlpha(css.slice(css.indexOf("body.resizing-panels .panel-resize-handle::after")));
  assert.ok(idle > 0 && idle <= 0.2, `静止时分隔线要足够浅，实际 alpha=${idle}`);
  assert.ok(active > idle, "悬停/拖动要比静止更容易看见");
  assert.ok(active <= 0.45, `悬停/拖动也只是一条淡线，实际 alpha=${active}`);
});

test("弹窗层压在面板分隔条之上：弹窗 portal 到 body，不被插件页的层叠上下文封顶", () => {
  const handleZ = Number(/z-index:\s*(\d+)/.exec(rule(".panel-resize-handle"))?.[1]);
  const overlayZ = Number(/z-index:\s*(\d+)/.exec(rule(".dialog-overlay"))?.[1]);
  assert.ok(handleZ > 0, "分隔条应浮在面板内容之上");
  assert.ok(overlayZ > handleZ, `弹窗层 z-index（${overlayZ}）必须高于分隔条（${handleZ}）`);

  // 插件页自己带 z-index：这正是弹窗必须 portal 出去的原因，改动前先确认前提还在
  assert.match(rule(".plugins-page"), /z-index:\s*\d+/, "插件页应是层叠上下文的来源");

  assert.match(dialog, /return createPortal\(/, "「添加插件」弹窗要 portal 出去");
  assert.match(dialog, /document\.body,\s*\)/, "portal 目标要落在 body（根层叠上下文）");
});
