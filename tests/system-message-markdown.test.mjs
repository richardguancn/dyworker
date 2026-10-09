import assert from "node:assert/strict";
import { build, stop } from "esbuild";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-message-markdown-"));
const output = path.join(temporary, "render.cjs");
await build({
  stdin: {
    contents: `import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { SystemMessageMarkdown } from "./src/SystemMessagesPanel";
      export const render = (body) => renderToStaticMarkup(React.createElement(SystemMessageMarkdown, { body, onOpenLink() {} }));`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
const { render } = createRequire(import.meta.url)(output);
await stop();
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test("公告中的标题、列表和代码块按 Markdown 显示", () => {
  const html = render("# 今日公告\n\n## 国庆节\n- aa\n### 10-05\n```text\nabcd\n```\n####");
  assert.match(html, /<h1>今日公告<\/h1>/);
  assert.match(html, /<h2>国庆节<\/h2>/);
  assert.match(html, /<li>aa<\/li>/);
  assert.match(html, /<h3>10-05<\/h3>/);
  assert.match(html, /<pre><code class="language-text">abcd\n<\/code><\/pre>/);
});

test("表格、加粗、任务列表和普通文字都保留", () => {
  const html = render("普通文字 **重点**\n\n- [x] 已完成\n\n| 项目 | 结果 |\n| --- | --- |\n| 展示 | 正常 |");
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /disabled=""/);
  assert.match(html, /class="system-message-table"><table>/);
  assert.match(html, /<td>正常<\/td>/);
});

test("HTML 不执行，正文图片不自动联网，危险链接不可点击", () => {
  const html = render('<script>alert(1)</script>\n\n<img src="https://example.com/track">\n\n![图片说明](https://example.com/image.png)\n\n[危险](javascript:alert%281%29) [普通网页](http://example.com) [安全网页](https://example.com)');
  assert.doesNotMatch(html, /<script|<img|javascript:|href="http:/);
  assert.match(html, /图片说明/);
  assert.match(html, /<a href="https:\/\/example.com">安全网页<\/a>/);
});

test("未完成的代码围栏和空正文不会导致显示失败", () => {
  assert.match(render("```text\n未完成"), /<pre><code class="language-text">未完成\n/);
  assert.equal(render(""), '<div class="system-message-text markdown-content"></div>');
});
