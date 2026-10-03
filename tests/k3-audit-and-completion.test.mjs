import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyTaskEvidence,
  adaptMessagesForModel,
  sanitizeEndpointUrl,
  requestModel,
  runAgent,
} from "../electron/agent.mts";

test("通用命令输出草稿编号仍不能证明本次上传", () => {
  const check = verifyTaskEvidence({
    finalText: "新文章已上传，草稿编号：OLD-DRAFT-1234",
    executedTools: [{
      name: "run_command",
      args: { command: "curl -X POST http://127.0.0.1:1 -d '{}' ; cat old.json" },
      status: "success",
      result: '{"media_id":"OLD-DRAFT-1234"}',
    }],
  });
  assert.equal(check.verified, false);
  assert.equal(check.code, "NO_UPLOAD_ACTION");
  assert.match(check.reason, /命令输出不能单独证明/);
});

test("只有专门上传工具的有效回执才能支持上传成功", () => {
  const finalText = "新文章已上传，草稿编号：REAL-DRAFT-1234";
  const readOnly = verifyTaskEvidence({
    finalText,
    executedTools: [{ name: "mp__list_drafts", status: "success", result: '{"media_id":"REAL-DRAFT-1234"}' }],
  });
  assert.equal(readOnly.verified, false);

  const noReceipt = verifyTaskEvidence({
    finalText,
    executedTools: [{ name: "mp__upload_draft", status: "success", result: "上传完成" }],
  });
  assert.equal(noReceipt.verified, false);
  assert.equal(noReceipt.code, "NO_UPLOAD_RECEIPT");

  const uploaded = verifyTaskEvidence({
    finalText,
    executedTools: [{ name: "mp__upload_draft", status: "success", result: '{"errcode":0,"media_id":"REAL-DRAFT-1234"}' }],
  });
  assert.equal(uploaded.verified, true);
});

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

test("建议与备选方案不是完成声明：已发表的文章页/后台手动勾选不构成虚报上传", () => {
  // 真实线上案例（会话 a6e66ef2 的视频号查证交付）：summary 里给用户的建议含「或者已发表的文章页里
  // 手动转发到视频号」，旧判定把「已发表」当成助手已发表，纯咨询类交付会被误标为未经验证。
  const advice = verifyTaskEvidence({
    finalText: "查证结论：**视频号没有内容发布的 API，暂时发不进去。**\n\n**给晨报的实际建议**：\n1. 每天 6 点视频自动进草稿箱后，你发表时在后台顺手勾「发表后转为视频号视频」；\n2. 或者已发表的文章页里手动转发到视频号。\n\n这两条都只在你手动发表的瞬间发生。",
    executedTools: [{ name: "web_search", status: "success", result: "搜索结果", isReadOnly: true }],
    fileChanges: [],
    planSteps: null,
    isExplicitFinish: true,
  });
  assert.equal(advice.verified, true, "给用户的建议/对已发布内容的指代不是助手的完成声明");

  // 放宽不能过头：真实的完成声明仍要被拦下——包括定语形式（「已发布的 3 篇文章都同步成功了」）、
  // 定语 + 口语完成式（「已发布的文章都传上去了」）、入库、「可以/请」引导词、冒号后接完成声明的句式
  for (const finalText of [
    "本次已发表 3 篇文章到公众号。",
    "可以确认：6 篇已全部上传成功。",
    "请查收，已发布 2 篇文章。",
    "请放心：已发布的 3 篇文章都同步成功了。",
    "可以确认已上传的 6 篇草稿全部同步成功。",
    "如需核对：已上传的 6 篇草稿全部成功。",
    "已发布的 3 篇文章：draft_aaa111、draft_bbb222、draft_ccc333。",
    "已发布的文章都传上去了。",
    "已发表的文章我都转到视频号了。",
    "已发布的文章都发出去了。",
    "已同步的文章都进了草稿箱。",
    "6 篇均已入库。",
    "6 篇均已完成入库，编号见下表。",
  ]) {
    const claim = verifyTaskEvidence({
      finalText,
      executedTools: [{ name: "web_search", status: "success", result: "搜索结果", isReadOnly: true }],
      fileChanges: [],
      planSteps: null,
      isExplicitFinish: true,
    });
    assert.equal(claim.verified, false, `真实完成声明不能被放过：${finalText}`);
    assert.equal(claim.code, "NO_UPLOAD_ACTION");
  }

  // 如实汇报失败不能被当成虚报：否定词与动词之间常有「真正/实际/全部」等副词
  for (const finalText of [
    "经检查，这 6 篇并没有真正发布成功。",
    "本次并没有全部同步成功，还差 2 篇。",
    "确认没有实际上传成功。",
  ]) {
    const honest = verifyTaskEvidence({
      finalText,
      executedTools: [{ name: "web_search", status: "success", result: "搜索结果", isReadOnly: true }],
      fileChanges: [],
      planSteps: null,
      isExplicitFinish: true,
    });
    assert.equal(honest.verified, true, `如实的失败汇报不该被判成虚报：${finalText}`);
  }
});

test("口语完成式与歧义动词：编造发布要拦下，git 推送/邮件发送/发图不能误判", () => {
  const readOnly = [{ name: "web_search", status: "success", result: "搜索结果", isReadOnly: true }];
  const check = (finalText, executedTools = readOnly) => verifyTaskEvidence({
    finalText,
    executedTools,
    fileChanges: [],
    planSteps: null,
    isExplicitFinish: true,
  });

  // 口语完成式（书面词表漏掉的编造说法）
  for (const finalText of [
    "文章都已经传到公众号后台了。",
    "全部传上去了。",
    "已经推送成功，草稿已生成。",
    "已成功推送到公众号。",
    "文章已转存到草稿箱。",
    "都同步好了。",
    "文章已成功发出去。",
    "三篇都已经发好了。",
    "草稿都已经存好了。",
    "文章已经发到平台上了。",
    "上传完毕。",
  ]) {
    assert.equal(check(finalText).verified, false, `编造的发布声明不能被放过：${finalText}`);
  }
  // 处于发布语境（调用了发布类工具）时，「已全部发送」也要拦下
  assert.equal(check("已全部发送。", [{ name: "mp__publish_article", status: "success", result: "ok" }]).verified, false);

  // 歧义动词不能误判：git push / 发消息 / 发图都不是平台发布
  assert.equal(check("已推送。", [{ name: "run_command", status: "success", result: "ok" }]).verified, true, "git 推送不能被当成公众号发布");
  assert.equal(check("已发送。").verified, true);
  assert.equal(check("已发送。", [{ name: "send_media", status: "success", result: "已登记发送：图表.png" }]).verified, true);

  // 打算/尝试不是完成
  assert.equal(check("6 篇均已尝试入库，但都失败了。", [{ name: "mp__upload_article", status: "error", result: "失败" }]).verified, true, "「尝试入库」不是入库成功");
  // 如实说明部分失败时，成功数少于总数不能判「数量不符」
  assert.equal(check("已经上传的 3 篇文章中，有 2 篇发布失败。", [
    { name: "mp__upload_article", status: "success", result: '{"errcode":0,"media_id":"a"}' },
    { name: "mp__upload_article", status: "error", result: "失败" },
  ]).verified, true, "如实汇报部分失败不能再判数量不符");
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
  const { runAgent } = await import("../electron/agent.mts");
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


