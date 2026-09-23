import assert from "node:assert/strict";
import test from "node:test";
import { formatAnnotationsForPrompt, normalizeQuote } from "../src/annotations.ts";

test("normalizeQuote 压缩连续空白并去除首尾空白", () => {
  assert.equal(normalizeQuote("   hello \n\n\t world  "), "hello world");
  assert.equal(normalizeQuote("a  b   c"), "a b c");
});

test("normalizeQuote 截断到 2000 字", () => {
  const long = "x".repeat(3000);
  assert.equal(normalizeQuote(long).length, 2000);
  assert.equal(normalizeQuote("短文本"), "短文本");
});

test("formatAnnotationsForPrompt 空数组返回空串", () => {
  assert.equal(formatAnnotationsForPrompt([]), "");
});

test("formatAnnotationsForPrompt 按编号拼出引用与评论", () => {
  const result = formatAnnotationsForPrompt([
    { id: "a", quote: "第一段", comment: "这里写错了" },
    { id: "b", quote: "第二段", comment: "" },
  ]);
  assert.equal(
    result,
    '\n\n【引用注释】\n  1. 所选文本：「第一段」\n     评论：这里写错了\n  2. 所选文本：「第二段」',
  );
});

test("formatAnnotationsForPrompt 评论只有空白时省略评论行", () => {
  const result = formatAnnotationsForPrompt([{ id: "a", quote: "引文", comment: "   " }]);
  assert.equal(result, "\n\n【引用注释】\n  1. 所选文本：「引文」");
});
