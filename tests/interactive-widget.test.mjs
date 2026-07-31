import assert from "node:assert/strict";
import { build, stop } from "esbuild";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-parser-"));
const bundlePath = path.join(tmpDir, "parser.mjs");
const entryPath = path.resolve("src/InteractiveMessage.tsx");
const renderEntryPath = path.join(tmpDir, "render-entry.tsx");
const renderBundlePath = path.join(tmpDir, "render.cjs");

fs.writeFileSync(renderEntryPath, [
  "import * as React from \"react\";",
  "import { renderToStaticMarkup } from \"react-dom/server\";",
  `import { InteractiveMessage } from ${JSON.stringify(entryPath)};`,
  "export function renderMessage(content) {",
  "  return renderToStaticMarkup(React.createElement(InteractiveMessage, { content }));",
  "}",
].join("\n"));

await build({
  entryPoints: ["src/InteractiveMessage.tsx"],
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

const { parseInteractiveMessage } = await import(pathToFileURL(bundlePath).href);
const require = createRequire(import.meta.url);
const { renderMessage } = require(renderBundlePath);
// 关闭 esbuild 常驻服务，避免 Windows 下测试结束后进程因残留句柄不退出。
await stop();

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function widgetBlock(json) {
  return `说明文字\n\n\`\`\`dyworker-ui\n${JSON.stringify(json)}\n\`\`\`\n\n结尾说明`;
}

test("steps 组件支持 current 为 0", () => {
  const content = widgetBlock({
    type: "steps",
    title: "中国篮球下一阶段赛程",
    current: 0,
    steps: [
      { label: "8月27日 男篮世预赛", description: "客场 vs 卡塔尔（第四窗口期）" },
      { label: "8月31日 男篮世预赛", description: "主场 vs 黎巴嫩（浙江诸暨）" },
      { label: "9月4-13日 女篮世界杯", description: "德国柏林" },
      { label: "9月19日-10月4日 亚运会", description: "日本名古屋" },
      { label: "10月底 CBA新赛季", description: "2026-27赛季常规赛开打" },
    ],
  });

  const segments = parseInteractiveMessage(content);
  assert.deepEqual(segments.map((segment) => segment.kind), ["markdown", "widget", "markdown"]);
  const widget = segments.find((segment) => segment.kind === "widget").widget;
  assert.equal(widget.type, "steps");
  assert.equal(widget.current, 0);
  assert.equal(widget.steps.length, 5);
});

test("steps 组件支持省略 current", () => {
  const segments = parseInteractiveMessage(widgetBlock({
    type: "steps",
    title: "办理步骤",
    steps: [{ label: "准备材料" }, { label: "提交审核" }],
  }));
  assert.equal(segments.filter((segment) => segment.kind === "widget").length, 1);
});

test("非法 current 会退回普通 Markdown", () => {
  for (const current of [-1, 1.5]) {
    const segments = parseInteractiveMessage(widgetBlock({
      type: "steps",
      title: "办理步骤",
      current,
      steps: [{ label: "准备材料" }],
    }));
    assert.ok(segments.every((segment) => segment.kind === "markdown"));
  }
});

test("空 steps 或非法 JSON 退回普通 Markdown", () => {
  const emptySteps = parseInteractiveMessage(widgetBlock({
    type: "steps",
    title: "办理步骤",
    steps: [],
  }));
  assert.ok(emptySteps.every((segment) => segment.kind === "markdown"));

  const badJson = parseInteractiveMessage("```dyworker-ui\n{not json}\n```");
  assert.ok(badJson.every((segment) => segment.kind === "markdown"));
});

test("其他组件类型仍正常解析", () => {
  const segments = parseInteractiveMessage(widgetBlock({
    type: "choice",
    title: "选择方案",
    options: [{ id: "a", label: "方案 A" }, { id: "b", label: "方案 B" }],
  }));
  assert.equal(segments.filter((segment) => segment.kind === "widget").length, 1);
});

test("用户的赛程内容能真实渲染为步骤组件", () => {
  const content = `\`\`\`dyworker-ui
{"type":"steps","title":"中国篮球下一阶段赛程","current":0,"steps":[{"label":"8月27日 男篮世预赛","description":"客场 vs 卡塔尔（第四窗口期）"},{"label":"8月31日 男篮世预赛","description":"主场 vs 黎巴嫩（浙江诸暨）"},{"label":"9月4-13日 女篮世界杯","description":"德国柏林，小组赛连战美国、捷克、意大利"},{"label":"9月19日-10月4日 亚运会","description":"日本名古屋，男女篮出战，女篮卫冕"},{"label":"10月底 CBA新赛季","description":"2026-27赛季常规赛开打"}]}
\`\`\``;

  const html = renderMessage(content);
  assert.match(html, /中国篮球下一阶段赛程/);
  assert.match(html, /8月27日 男篮世预赛/);
  assert.match(html, /10月底 CBA新赛季/);
  assert.match(html, /第 1 步/);
});
