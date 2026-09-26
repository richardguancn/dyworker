import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyTaskEvidence,
  adaptMessagesForModel,
  sanitizeEndpointUrl,
  requestModel,
  runAgent,
} from "../electron/agent.mjs";

test("场景 1：没有操作，却声称上传完成（零工具调用虚报）", () => {
  const check = verifyTaskEvidence({
    finalText: "6 篇全部上传成功！草稿箱已经就绪。",
    executedTools: [],
    fileChanges: [],
    planSteps: null,
  });
  assert.equal(check.verified, false);
  assert.equal(check.verdict, "unverified");
  assert.equal(check.code, "NO_UPLOAD_ACTION");
  assert.match(check.reason, /未检测到真实上传操作/);
});

test("场景 2：操作失败，却声称成功（如微信 IP 白名单拦截）", () => {
  const check = verifyTaskEvidence({
    finalText: "成功了，6 篇全部上传草稿箱！",
    executedTools: [
      {
        name: "mp__upload_draft",
        args: { title: "文章1" },
        status: "error",
        result: '{"errcode": 61007, "errmsg": "api is unauthorized to no ip white list"}',
        isReadOnly: false,
      },
    ],
    fileChanges: [],
    planSteps: null,
  });
  assert.equal(check.verified, false);
  assert.equal(check.verdict, "failed");
  assert.equal(check.code, "FAILED_CLAIMED_SUCCESS");
  assert.match(check.reason, /实际执行失败/);
});

test("场景 3：编造草稿编号或伪造回执", () => {
  const check = verifyTaskEvidence({
    finalText: "上传成功！草稿编号：998877",
    executedTools: [
      {
        name: "mp__upload_draft",
        args: { title: "文章1" },
        status: "success",
        result: '{"media_id": "draft_real_123456"}',
        isReadOnly: false,
      },
    ],
    fileChanges: [],
    planSteps: null,
  });
  assert.equal(check.verified, false);
  assert.equal(check.verdict, "unverified");
  assert.equal(check.code, "FABRICATED_ID");
  assert.match(check.reason, /虚构凭证编号/);
});

test("场景 4：仅读取文件成功，却声称上传成功", () => {
  const check = verifyTaskEvidence({
    finalText: "全部文章已成功上传到公众号草稿箱！",
    executedTools: [
      {
        name: "read_file",
        args: { path: "articles/sep24.md" },
        status: "success",
        result: "# 9月24日文章内容...",
        isReadOnly: true,
      },
      {
        name: "list_files",
        args: { path: "articles" },
        status: "success",
        result: "sep24.md",
        isReadOnly: true,
      },
    ],
    fileChanges: [],
    planSteps: null,
  });
  assert.equal(check.verified, false);
  assert.equal(check.verdict, "unverified");
  assert.equal(check.code, "NO_UPLOAD_ACTION");
  assert.match(check.reason, /未检测到真实上传操作执行记录/);
});

test("场景 5：真实操作成功且草稿凭据吻合", () => {
  const check = verifyTaskEvidence({
    finalText: "文章已成功上传草稿箱，草稿编号：draft_real_123456",
    executedTools: [
      {
        name: "mp__upload_draft",
        args: { title: "文章1" },
        status: "success",
        result: '{"errcode": 0, "media_id": "draft_real_123456"}',
        isReadOnly: false,
      },
    ],
    fileChanges: [],
    planSteps: null,
  });
  assert.equal(check.verified, true);
  assert.equal(check.verdict, "verified");
});

test("场景 6：普通文本问答不被误拦截", () => {
  const check = verifyTaskEvidence({
    finalText: "这是关于9月24日的工作总结提纲：\n1. 上午完成方案审核\n2. 下午完成编写",
    executedTools: [],
    fileChanges: [],
    planSteps: null,
  });
  assert.equal(check.verified, true);
  assert.equal(check.verdict, "not_required");
});

test("场景 7：计划未完成却声称全部完成", () => {
  const check = verifyTaskEvidence({
    finalText: "全部完成了！请查阅。",
    executedTools: [],
    fileChanges: [],
    planSteps: [
      { title: "步骤1：编写草稿", status: "completed" },
      { title: "步骤2：上传草稿箱", status: "pending" },
    ],
  });
  assert.equal(check.verified, false);
  assert.equal(check.verdict, "unverified");
  assert.equal(check.code, "PLAN_INCOMPLETE");
  assert.match(check.reason, /计划中仍有未完成的步骤/);
});

test("场景 8：400 内容安全拦截保证单次请求，禁止非流式重发", async () => {
  let callCount = 0;
  const mockFetch = async (url) => {
    callCount += 1;
    return {
      ok: false,
      status: 400,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify({
        error: {
          code: "content_filter",
          message: "The response was blocked by content_filter with sensitive words.",
        },
      }),
    };
  };

  const settings = {
    endpoint: "https://api.kimi.com/coding/v1/chat/completions?token=secret_token_123",
    model: "k3",
    apiKey: "secret_api_key_456",
  };

  await assert.rejects(
    async () => {
      await requestModel({
        settings,
        messages: [{ role: "user", content: "敏感内容测试" }],
        fetchImpl: mockFetch,
        retryLimit: 0,
      });
    },
    (error) => {
      // 必须带 contentFiltered 标识
      assert.equal(error.contentFiltered, true);
      // 报错文案中不包含 secret 凭证
      assert.equal(error.message.includes("secret_token_123"), false);
      assert.equal(error.message.includes("secret_api_key_456"), false);
      // 端点脱敏
      assert.match(error.message, /https:\/\/api\.kimi\.com\/coding\/v1\/chat\/completions/);
      return true;
    },
  );

  // 关键断言：只调用了 1 次，没有触发非流式二次重试！
  assert.equal(callCount, 1);
});

test("场景 9：端点脱敏函数正确移除 query 参数与 token", () => {
  const sanitized = sanitizeEndpointUrl("https://api.moonshot.cn/v1/chat/completions?auth=xyz123&user=456");
  assert.equal(sanitized, "https://api.moonshot.cn/v1/chat/completions");
});

test("场景 10：非破坏性模型切换（Kimi/DeepSeek 保持思考，严格模型仅在副本清洗）", () => {
  const originalMessages = [
    {
      role: "assistant",
      content: "思考完毕，开始回答",
      reasoning_content: "这是模型的深度思考过程",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "test_tool", arguments: "{}" } }],
    },
  ];

  // 1. 发给 Kimi K3：完整保留 reasoning_content
  const kimiMessages = adaptMessagesForModel(originalMessages, {
    endpoint: "https://api.kimi.com/coding/v1/chat/completions",
    model: "k3",
  });
  assert.equal(kimiMessages[0].reasoning_content, "这是模型的深度思考过程");

  // 2. 发给 DeepSeek R1：完整保留 reasoning_content
  const deepseekMessages = adaptMessagesForModel(originalMessages, {
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-reasoner",
  });
  assert.equal(deepseekMessages[0].reasoning_content, "这是模型的深度思考过程");

  // 3. 发给严格的 OpenAI 官方非思考模型：副本中清洗 reasoning_content
  const openaiMessages = adaptMessagesForModel(originalMessages, {
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o",
  });
  assert.equal("reasoning_content" in openaiMessages[0], false);
  assert.equal(openaiMessages[0].content, "思考完毕，开始回答");

  // 4. 关键验证：原数组未被破坏！切回 K3 时数据依然完整！
  assert.equal(originalMessages[0].reasoning_content, "这是模型的深度思考过程");
});

test("场景 11：runAgent 端到端验证——模型口头宣称上传成功，软件返回 unverified 状态并追加核验提示", async () => {
  const { runAgent } = await import("../electron/agent.mjs");
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({
      choices: [
        {
          message: {
            role: "assistant",
            content: "6 篇全部上传成功！草稿箱已经就绪。",
            reasoning_content: "我来假装自己上传了",
          },
          finish_reason: "stop",
        },
      ],
    }),
  });

  const result = await runAgent({
    settings: {
      endpoint: "https://api.kimi.com/coding/v1/chat/completions",
      model: "k3",
      apiKey: "test-key",
    },
    workspacePath: "/tmp",
    conversation: [{ role: "user", content: "请把文章上传到公众号" }],
    fetchImpl: mockFetch,
  });

  // 验收标准：模型即使编造成功，软件也决不能把它显示为 done（已核实完成）！
  assert.equal(result.status, "unverified");
  assert.match(result.finalText, /⚠️ \*\*系统核验提示\*\*：未检测到真实上传操作执行记录/);
  assert.equal(result.verification.verified, false);
});

test("场景 12：runAgent 返回完整的 executedMessages 工具与思考链，支持跨轮完整传递", async () => {
  let round = 0;
  const mockFetch = async () => {
    round++;
    if (round === 1) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                reasoning_content: "思考查询时间",
                tool_calls: [
                  {
                    id: "call-time-1",
                    type: "function",
                    function: { name: "get_datetime", arguments: "{}" },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: "时间已查询完毕。",
              reasoning_content: "思考完成",
            },
            finish_reason: "stop",
          },
        ],
      }),
    };
  };

  const result = await runAgent({
    settings: {
      endpoint: "https://api.kimi.com/coding/v1/chat/completions",
      model: "k3",
      apiKey: "test-key",
    },
    workspacePath: "/tmp",
    conversation: [{ role: "user", content: "查询时间" }],
    fetchImpl: mockFetch,
  });

  assert.equal(result.status, "done");
  assert.ok(Array.isArray(result.executedMessages), "必须返回 executedMessages 数组");
  assert.equal(result.executedMessages.length, 3, "包含 assistant(tool_calls)、tool(result)、assistant(final)");
  assert.equal(result.executedMessages[0].role, "assistant");
  assert.equal(result.executedMessages[0].reasoning_content, "思考查询时间");
  assert.equal(result.executedMessages[0].tool_calls[0].function.name, "get_datetime");
  assert.equal(result.executedMessages[1].role, "tool");
  assert.equal(result.executedMessages[1].tool_call_id, "call-time-1");
  assert.equal(result.executedMessages[2].role, "assistant");
  assert.equal(result.executedMessages[2].content, "时间已查询完毕。");
});

test("场景 13：跨轮传递 executedMessages 时，模型下一轮请求中完整保留 tool_calls、tool 回执与 reasoning", async () => {
  const previousRunExecutedMessages = [
    {
      role: "assistant",
      content: "",
      reasoning_content: "SYNTHETIC_CROSS_ROUND_REASONING",
      tool_calls: [
        {
          id: "call-previous-1",
          type: "function",
          function: { name: "get_datetime", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call-previous-1",
      content: "成功\n2026-09-26 23:55:00",
    },
    {
      role: "assistant",
      content: "当前时间是 2026-09-26 23:55:00。",
    },
  ];

  const conversation = [
    { role: "user", content: "查询时间" },
    {
      role: "assistant",
      content: "当前时间是 2026-09-26 23:55:00。",
      executedMessages: previousRunExecutedMessages,
    },
    { role: "user", content: "继续" },
  ];

  let nextRoundReceivedMessages = null;
  const mockFetch = async (_url, opt) => {
    const body = JSON.parse(opt.body);
    nextRoundReceivedMessages = body.messages;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        choices: [
          {
            message: { role: "assistant", content: "已收到继续指令。" },
            finish_reason: "stop",
          },
        ],
      }),
    };
  };

  const result = await runAgent({
    settings: {
      endpoint: "https://api.kimi.com/coding/v1/chat/completions",
      model: "k3",
      apiKey: "test-key",
    },
    workspacePath: "/tmp",
    conversation,
    fetchImpl: mockFetch,
  });

  assert.equal(result.status, "done");
  assert.ok(nextRoundReceivedMessages, "模型请求必须收到 messages");

  // 跨轮关键指标验证：确保上一轮的 tool_calls、tool 回执与思考全部完整传递给模型
  const assistantWithTools = nextRoundReceivedMessages.find((m) => Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
  assert.ok(assistantWithTools, "下一轮请求必须包含上一轮的 tool_calls assistant 消息");
  assert.equal(assistantWithTools.reasoning_content, "SYNTHETIC_CROSS_ROUND_REASONING", "必须保留上一轮思考内容");
  assert.equal(assistantWithTools.tool_calls[0].id, "call-previous-1");

  const toolMessage = nextRoundReceivedMessages.find((m) => m.role === "tool");
  assert.ok(toolMessage, "下一轮请求必须包含上一轮的 tool 结果消息");
  assert.equal(toolMessage.tool_call_id, "call-previous-1");
  assert.match(toolMessage.content, /2026-09-26 23:55:00/);
});



