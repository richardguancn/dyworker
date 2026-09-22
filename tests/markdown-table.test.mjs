import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownTable } from "../src/markdownTable.ts";

test("GFM 表格解析:表头、对齐与数据行", () => {
  const table = parseMarkdownTable(
    "| 期次 | 发布日期 | 链接 |\n|:---|---:|:---:|---|\n| 1月简析 | 2026-03-30 | http://example.com/a | 备注 |\n| 2月简析 | 2026-04-30 | http://example.com/b | 备注 |",
  );
  assert.deepEqual(table.header, ["期次", "发布日期", "链接"]);
  assert.deepEqual(table.alignments, ["left", "right", "center", "left"]);
  assert.equal(table.body.length, 2);
  assert.deepEqual(table.body[0], ["1月简析", "2026-03-30", "http://example.com/a", "备注"]);
});

test("GFM 表格解析:转义竖线不拆列,无首末竖线也能解析", () => {
  const table = parseMarkdownTable("a | b\n--- | ---\nc \\| d | e");
  assert.deepEqual(table.header, ["a", "b"]);
  assert.deepEqual(table.body, [["c | d", "e"]]);
  assert.deepEqual(table.alignments, ["left", "left"]);
});

test("GFM 表格解析:空输入与缺失分隔行的兜底", () => {
  assert.deepEqual(parseMarkdownTable(""), { header: [], alignments: [], body: [] });
  const noDelimiter = parseMarkdownTable("只有一行");
  assert.deepEqual(noDelimiter.header, ["只有一行"]);
  assert.deepEqual(noDelimiter.body, []);
  assert.deepEqual(noDelimiter.alignments, []);
});
