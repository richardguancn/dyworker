import assert from "node:assert/strict";
import test from "node:test";
import { contextUsageSummary, estimateSessionTokens } from "../src/contextUsage.ts";

test("上下文提示按已用量和总容量计算 Codex 风格摘要", () => {
  assert.deepEqual(contextUsageSummary(155_000, 258_000), {
    ratio: 155_000 / 258_000,
    percent: 60,
    percentLabel: "60%",
    usedLabel: "155k",
    limitLabel: "258k",
  });
});

test("非空的极小上下文不显示为 0%", () => {
  assert.equal(contextUsageSummary(12, 258_000).percentLabel, "不足 1%");
  assert.equal(contextUsageSummary(0, 258_000).percentLabel, "0%");
});

test("会话回退估算使用文本四字符一标记并区分图片", () => {
  const used = estimateSessionTokens([
    {
      role: "user",
      content: "abcd你好",
      attachments: [
        { name: "资料.txt", path: "/资料.txt", size: 400, mimeType: "text/plain" },
        { name: "图片.png", path: "/图片.png", size: 500_000, mimeType: "image/png", isImage: true },
      ],
    },
  ]);
  assert.equal(used, 4 + 3 + 100 + 1024 + 3);
});
