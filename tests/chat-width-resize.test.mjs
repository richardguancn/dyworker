import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHAT_CONTENT_WIDTH_DEFAULT,
  CHAT_CONTENT_WIDTH_KEY,
  CHAT_CONTENT_WIDTH_MAX,
  CHAT_CONTENT_WIDTH_MIN,
  clampChatContentWidth,
  computeSymmetricChatWidth,
  persistChatContentWidth,
  readSavedChatContentWidth,
} from "../src/state/layoutStore.ts";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("clampChatContentWidth: 非有限数回落默认值，正常值按上下限夹取并取整", () => {
  assert.equal(clampChatContentWidth(Number.NaN), CHAT_CONTENT_WIDTH_DEFAULT);
  assert.equal(clampChatContentWidth(Number.POSITIVE_INFINITY), CHAT_CONTENT_WIDTH_DEFAULT);
  assert.equal(clampChatContentWidth(300), CHAT_CONTENT_WIDTH_MIN);
  assert.equal(clampChatContentWidth(960.4), 960);
  assert.equal(clampChatContentWidth(3000), CHAT_CONTENT_WIDTH_MAX);
  assert.equal(clampChatContentWidth(1200, 1000), 1000);
  // 若传入的上限小于最小值，以最小值为底线
  assert.equal(clampChatContentWidth(500, 400), CHAT_CONTENT_WIDTH_MIN);
});

test("computeSymmetricChatWidth: 左右手柄对称扩缩并在边界夹取", () => {
  // 左侧手柄向左拖 50px，居中列左右各扩 50px -> 总宽度 +100px
  assert.equal(computeSymmetricChatWidth("chat-left", 740, 200, 150, 1400), 840);
  // 左侧手柄向右拖 40px -> 总宽度 -80px
  assert.equal(computeSymmetricChatWidth("chat-left", 740, 200, 240, 1400), 660);
  // 右侧手柄向右拖 60px -> 总宽度 +120px
  assert.equal(computeSymmetricChatWidth("chat-right", 740, 940, 1000, 1400), 860);
  // 右侧手柄向左拖 150px -> 触及最小值 560
  assert.equal(computeSymmetricChatWidth("chat-right", 740, 940, 790, 1400), CHAT_CONTENT_WIDTH_MIN);
  // 超过当前可用上限时夹取到 maxWidth
  assert.equal(computeSymmetricChatWidth("chat-right", 900, 940, 1300, 1180), 1180);
});

test("readSavedChatContentWidth / persistChatContentWidth: 安全持久化与异常兜底", () => {
  const map = new Map();
  const storage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };

  assert.equal(readSavedChatContentWidth(storage), CHAT_CONTENT_WIDTH_DEFAULT);

  persistChatContentWidth(1024.6, storage);
  assert.equal(map.get(CHAT_CONTENT_WIDTH_KEY), "1025");
  assert.equal(readSavedChatContentWidth(storage), 1025);

  map.set(CHAT_CONTENT_WIDTH_KEY, "bad-number");
  assert.equal(readSavedChatContentWidth(storage), CHAT_CONTENT_WIDTH_DEFAULT);

  map.set(CHAT_CONTENT_WIDTH_KEY, "120");
  assert.equal(readSavedChatContentWidth(storage), CHAT_CONTENT_WIDTH_MIN);
});

test("layout.css 与组件源码契约: --chat-width 联动、对称手柄与窄窗隐藏", () => {
  const layoutCss = read("../src/layout.css");
  const paneSource = read("../src/features/conversation/ConversationPane.tsx");
  const bubbleCss = read("../src/styles/message-bubbles.css");
  const markdownCss = read("../src/styles/markdown.css");

  assert.match(layoutCss, /--chat-width:\s*min\(var\(--chat-max-width,\s*740px\),\s*calc\(100%\s*-\s*48px\)\);/);
  assert.match(layoutCss, /\.reference-layout\s+\.composer-project-bar\s*\{[^}]*width:\s*calc\(var\(--chat-width\)\s*-\s*28px\)/);
  assert.match(layoutCss, /\.reference-layout\s+\.chat-width-handle-left\s*\{[^}]*left:\s*calc\(50%\s*-\s*var\(--chat-width\)\s*\/\s*2\s*-\s*20px\)/);
  assert.match(layoutCss, /\.reference-layout\s+\.chat-width-handle-right\s*\{[^}]*right:\s*calc\(50%\s*-\s*var\(--chat-width\)\s*\/\s*2\s*-\s*20px\)/);
  assert.match(layoutCss, /\.reference-layout\s+\.chat-width-handle::after\s*\{[^}]*opacity:\s*0;/);
  assert.match(layoutCss, /@media\s*\(max-width:\s*820px\)\s*\{[^}]*\.reference-layout\s+\.chat-width-handle\s*\{\s*display:\s*none;\s*\}/);

  assert.match(paneSource, /className="chat-width-handle chat-width-handle-left"/);
  assert.match(paneSource, /className="chat-width-handle chat-width-handle-right"/);
  assert.match(paneSource, /onDoubleClick=\{resetChatContentWidth\}/);

  assert.match(bubbleCss, /\.user-message-stack\s*\{[^}]*max-width:\s*76%;/);
  assert.match(markdownCss, /\.markdown-local-image\s*\{[^}]*max-width:\s*100%;/);
  assert.match(markdownCss, /\.echarts-canvas\s*\{[^}]*max-width:\s*100%;/);
});
