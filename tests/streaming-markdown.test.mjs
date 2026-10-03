// 流式未定稿正文的增量 Markdown 渲染回归测试：
// 1) splitStreamingBlocks 的切块规则（只在围栏/公式块之外的空行处切，绝不在代码块中间切）
// 2) 未定稿消息不再按纯文本显示 `**加粗**` 这类源码，而是与定稿走同一套 Markdown 管线
import assert from "node:assert/strict";
import { build, stop } from "esbuild";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-streaming-"));
const bundlePath = path.join(tmpDir, "interactive.mjs");
const renderEntryPath = path.join(tmpDir, "render-entry.tsx");
const renderBundlePath = path.join(tmpDir, "render.cjs");
const entryPath = path.resolve("src/InteractiveMessage.tsx");

fs.writeFileSync(renderEntryPath, [
  "import * as React from \"react\";",
  "import { renderToStaticMarkup } from \"react-dom/server\";",
  `import { InteractiveMessage } from ${JSON.stringify(entryPath)};`,
  "export function renderStreaming(content) {",
  "  return renderToStaticMarkup(React.createElement(InteractiveMessage, { content, streaming: true }));",
  "}",
  "export function renderSettled(content) {",
  "  return renderToStaticMarkup(React.createElement(InteractiveMessage, { content }));",
  "}",
].join("\n"));

await build({
  entryPoints: [entryPath],
  bundle: true,
  format: "esm",
  jsx: "automatic",
  platform: "node",
  outfile: bundlePath,
  logLevel: "silent",
});

await build({
  entryPoints: [renderEntryPath],
  bundle: true,
  format: "cjs",
  jsx: "automatic",
  platform: "node",
  absWorkingDir: process.cwd(),
  nodePaths: [path.resolve("node_modules")],
  outfile: renderBundlePath,
  logLevel: "silent",
});

const { splitStreamingBlocks } = await import(pathToFileURL(bundlePath).href);
const require = createRequire(import.meta.url);
const { renderStreaming, renderSettled } = require(renderBundlePath);
// 关闭 esbuild 常驻服务，避免测试结束后进程因残留句柄不退出。
await stop();

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("空行处切块，块数随段落增长", () => {
  const blocks = splitStreamingBlocks("第一段\n\n第二段");
  assert.deepEqual(blocks.map((block) => block.trim()), ["第一段", "第二段"]);
});

test("代码围栏内部的空行不会切块", () => {
  const blocks = splitStreamingBlocks("说明\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n结尾");
  assert.equal(blocks.length, 3);
  assert.match(blocks[1], /const a = 1;/);
  assert.match(blocks[1], /const b = 2;/);
  assert.match(blocks[1], /^```ts/);
  assert.match(blocks[1].trimEnd(), /```$/);
});

test("尚未收尾的代码围栏整段作为尾巴，不切块", () => {
  const blocks = splitStreamingBlocks("正文\n\n```ts\nconst a = 1;\n\nconst b = 2;");
  assert.equal(blocks.length, 2);
  assert.match(blocks[1], /const b = 2;/);
});

test("围栏收尾后即使没有空行也可以定稿", () => {
  const blocks = splitStreamingBlocks("```\na\n```\n正文");
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /```$/m);
  assert.equal(blocks[1], "正文");
});

test("跨行的 $$ 公式块不会被空行切开", () => {
  const blocks = splitStreamingBlocks("前文\n\n$$\nE = mc^2\n\nx = 1\n$$\n\n后文");
  assert.equal(blocks.length, 3);
  assert.match(blocks[1], /x = 1/);
});

test("单行 $$ 公式不会污染后续切块", () => {
  const blocks = splitStreamingBlocks("公式 $$E = mc^2$$\n\n后文");
  assert.deepEqual(blocks.map((block) => block.trim()), ["公式 $$E = mc^2$$", "后文"]);
});

test("正文里孤立的 $$ 不会把后面所有内容锁成一块", () => {
  const blocks = splitStreamingBlocks("价格按 $$ 计价，另有说明\n\n第二段\n\n第三段");
  assert.equal(blocks.length, 3);
});

test("CRLF 换行的正文同样按空行切块", () => {
  const blocks = splitStreamingBlocks("第一段\r\n\r\n```ts\r\nconst a = 1;\r\n```\r\n\r\n第二段");
  assert.equal(blocks.length, 3);
  assert.match(blocks[1], /const a = 1;/);
});

test("流式未定稿正文渲染 Markdown，而不是源码", () => {
  const html = renderStreaming("**端到端探测全部成功**，还拿到了关键字段：`vid: apiv_4720411979692310529`。我脚本里的判断只认 `wxv_` 前缀，会误判成降级——立刻修正：");

  assert.match(html, /<strong>端到端探测全部成功<\/strong>/);
  assert.match(html, /<code>vid: apiv_4720411979692310529<\/code>/);
  assert.match(html, /<code>wxv_<\/code>/);
  assert.doesNotMatch(html, /\*\*/);
  assert.match(html, /class="markdown-content streaming-markdown"/);
});

test("流式正文里的标题、列表、表格都即时渲染", () => {
  const html = renderStreaming("## 阶段性结论\n\n- 口径统一\n- 交付粒度按周拆分\n\n| 指标 | 本期 |\n| --- | ---: |\n| 营收 | 1200 |");

  assert.match(html, /<h2>阶段性结论<\/h2>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /^\s*\|/m);
});

test("流式正文里的代码块渲染为代码块而不是围栏源码", () => {
  const html = renderStreaming("先看这段脚本：\n\n```ts\nconst id = \"apiv_1\";\n```\n\n接下来继续说明");

  assert.match(html, /<pre>/);
  assert.match(html, /apiv_1/);
  assert.doesNotMatch(html, /```/);
});

test("流式正文里的 dyworker-ui 交互块与定稿一样渲染成组件", () => {
  const widget = JSON.stringify({ type: "steps", title: "办理步骤", steps: [{ label: "准备材料" }, { label: "提交审核" }] });
  const html = renderStreaming(`说明文字\n\n\`\`\`dyworker-ui\n${widget}\n\`\`\`\n\n结尾说明`);

  assert.match(html, /interactive-steps/);
  assert.match(html, /准备材料/);
  assert.match(html, /结尾说明/);
});

test("无 dyworker-ui 块时，流式与定稿渲染结果逐元素一致", () => {
  const doc = "## 标题\n\n**加粗** 与 `代码` 混排，中英 mixed 自动补空格。\n\n```ts\nconst a = 1;\n```\n\n- 一\n- 二\n\n> 引用";
  // 分块渲染时，块与块之间的换行文本节点（块级元素之间的空白，不影响排版）与
  // 整篇一次解析的产物不同，比较前先归一化掉标签之间的纯空白。
  const normalize = (html) => html.replace(/>\s+</g, "><");
  const streaming = normalize(renderStreaming(doc))
    .replace('class="markdown-content streaming-markdown"', 'class="markdown-content"');

  assert.equal(streaming, normalize(renderSettled(doc)));
});

test("空内容不会渲染出空的 Markdown 容器", () => {
  assert.equal(renderStreaming(""), renderSettled(""));
});
