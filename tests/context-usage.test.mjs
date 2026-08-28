import assert from "node:assert/strict";
import test from "node:test";
import { contextUsageSummary, estimateSessionTokens } from "../src/contextUsage.ts";
import { modelContextLimit, parseModelContextOverride } from "../src/providers.ts";

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

test("会话回退估算包含隐藏的跨轮工作记录", () => {
  assert.equal(estimateSessionTokens([], "已读取文件内容"), 3 + 7);
});

test("模型名上下文覆盖后缀解析（k3[1M] / [256K] / [131072]）", () => {
  assert.deepEqual(parseModelContextOverride("k3[1M]"), { name: "k3", contextLimit: 1048576 });
  assert.deepEqual(parseModelContextOverride("Qwen3.8-27B [256k]"), { name: "Qwen3.8-27B", contextLimit: 262144 });
  assert.deepEqual(parseModelContextOverride("model[131072]"), { name: "model", contextLimit: 131072 });
  // 无后缀或非法后缀不覆盖
  assert.deepEqual(parseModelContextOverride("k3"), { name: "k3", contextLimit: null });
  assert.deepEqual(parseModelContextOverride("model[abc]"), { name: "model[abc]", contextLimit: null });
  assert.deepEqual(parseModelContextOverride(""), { name: "", contextLimit: null });
});

test("modelContextLimit 优先使用显式覆盖，无覆盖时回退静态表", () => {
  assert.equal(modelContextLimit("k3[1M]", "https://api.kimi.com/coding/v1/chat/completions"), 1048576);
  assert.equal(modelContextLimit("k3", "https://api.kimi.com/coding/v1/chat/completions"), 1048576);
  assert.equal(modelContextLimit("Qwen3.8-27B[16K]", "http://192.16.6.138:8000/v1/chat/completions"), 16384);
  assert.equal(modelContextLimit("Qwen3.8-27B", "http://192.16.6.138:8000/v1/chat/completions"), 262144);
});
