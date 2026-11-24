import assert from "node:assert/strict";
import test from "node:test";
import { contextUsageSummary, estimateSessionTokens, formatTokenCount } from "../src/contextUsage.ts";
import { modelContextLimit, parseModelContextOverride } from "../src/providers.ts";
import { formatContextLimitInput, parseContextLimitInput, resolveModelContextLimit, updateContextLimitOverride } from "../electron/model-context.ts";

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

test('办公附件和未展开的大文本不按整个文件字节计入窗口，助手展示的附件不回传', () => {
  const base = estimateSessionTokens([{ role: 'user', content: '' }]);
  assert.equal(estimateSessionTokens([{ role: 'user', attachments: [{ name: '材料.pdf', size: 20_000_000 }] }]), base + 64);
  assert.equal(estimateSessionTokens([{ role: 'user', attachments: [{ name: '材料.txt', size: 20_000_000 }] }]), base + 64);
  assert.equal(estimateSessionTokens([{ role: 'assistant', attachments: [{ isImage: true, size: 500_000 }] }]), base);
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

test("modelContextLimit 优先使用显式覆盖，无覆盖时回退静态表与 1M 默认上限", () => {
  assert.equal(modelContextLimit("k3[1M]", "https://api.kimi.com/coding/v1/chat/completions"), 1048576);
  assert.equal(modelContextLimit("k3", "https://api.kimi.com/coding/v1/chat/completions"), 1048576);
  assert.equal(modelContextLimit("glm-5.4", "https://open.bigmodel.cn/api/paas/v4/chat/completions"), 1048576);
  assert.equal(modelContextLimit("glm-5.2", "https://open.bigmodel.cn/api/paas/v4/chat/completions"), 204800);
  assert.equal(modelContextLimit("deepseek-v4-next", "https://api.deepseek.com/responses"), 1048576);
  assert.equal(modelContextLimit("Qwen3.8-27B[16K]", "http://192.16.6.138:8000/v1/chat/completions"), 16384);
  assert.equal(modelContextLimit("Qwen3.8-27B", "http://192.16.6.138:8000/v1/chat/completions"), 262144);
});

test("contextLimitOverrides 支持输入解析、格式化及按模型覆盖优先级", () => {
  assert.equal(parseContextLimitInput("1M"), 1048576);
  assert.equal(parseContextLimitInput("100M"), 100 * 1048576);
  assert.equal(parseContextLimitInput("256k"), 262144);
  assert.equal(parseContextLimitInput("1,000,000"), 1000000);
  assert.equal(parseContextLimitInput("500"), null);
  assert.equal(parseContextLimitInput("abc"), null);
  assert.equal(formatContextLimitInput(1048576), "1M");
  assert.equal(formatContextLimitInput(262144), "256K");
  assert.equal(formatContextLimitInput(500000), "500000");
  assert.equal(formatTokenCount(1048576), "1M");
  assert.equal(formatTokenCount(100 * 1048576), "100M");

  const endpoint = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const overrides = updateContextLimitOverride([], endpoint, "glm-5.4[256K]", 2 * 1048576);
  assert.equal(modelContextLimit("glm-5.4", endpoint, overrides), 2 * 1048576, "无后缀时使用手动覆盖");
  assert.equal(modelContextLimit("glm-5.4[512K]", endpoint, overrides), 524288, "模型名后缀优先于手动覆盖");
  assert.equal(resolveModelContextLimit({ model: "glm-5.4", endpoint, serverContextLimit: 2097152 }), 2097152, "无覆盖时采信服务端自报上限");
  assert.equal(resolveModelContextLimit({ model: "glm-5.4", endpoint, overrides, serverContextLimit: 524288 }), 524288, "手动覆盖同时受限于更小的服务端上限");
});
