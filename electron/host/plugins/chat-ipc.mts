// IPC 域插件：侧边聊天（chat:complete）。
// 只读检索工具循环留在本插件；模型请求与工具定义直接 import。
import { requestModel } from "../../agent.mts";
import { handleSideChatTool, sideChatToolDefinitions } from "../../session-tools.mts";

// 侧边聊天工具循环上限：只读检索工具，几轮足够定位；防止模型连续发工具调用不收尾
const SIDE_CHAT_TOOL_ROUNDS = 5;

// 
// 侧边聊天 = 用户临时问答区：只给 search/read 两个只读工具检索当前主会话，
// 不把会话正文灌进上下文（对照 Codex 侧边聊天定位）。
export function chatIpcPlugin(deps) {
  return {
    name: "ipc:chat",
    apply(ctx) {
      const { trustedHandle, providerMessageContent } = deps;

trustedHandle("chat:complete", async (_event, payload) => {
  const settings = payload?.settings || {};
  if (!settings.endpoint || !settings.model || !settings.apiKey) {
    return {
      demo: true,
      content:
        "模型还没有配置。打开左下角的“设置”，填写服务地址、模型名称和密钥后，就可以在这里直接处理任务。",
    };
  }
  const messages = await Promise.all((payload.messages || [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map(async (message) => ({ role: message.role, content: await providerMessageContent(message) })));
  // 渲染层随请求传入当前打开的主会话：不把会话正文灌进上下文，
  // 而是给模型 search/read 两个只读工具，按需在这一个会话内检索（对照 Codex 侧边聊天的轻量问答定位）
  const session = payload?.session || null;
  const hasSession = Boolean(session && Array.isArray(session.messages) && session.messages.length);
  if (hasSession) {
    const goal = !session.goalState || session.goalState.status === 'active' ? String(session.goal || "").trim() : '';
    messages.unshift({
      role: "system",
      content: `这是「侧边聊天」：用户的临时问答区。用户当前的主会话是「${String(session.title || "未命名会话").trim()}」，与它相关的提问先用 search_current_session 按关键词检索、或用 read_current_session 了解最近进展，再依据检索结果作答；不要尝试继续执行主会话里的任务。${goal ? `主会话长期目标：${goal}` : ""}`,
    });
  }
  const sideTools = hasSession ? sideChatToolDefinitions() : false;
  const toolCallArguments = (call) => {
    const raw = call?.function?.arguments;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  for (let round = 0; ; round += 1) {
    const result = await requestModel({ settings, messages, fetchImpl: fetch, tools: sideTools });
    const toolCalls = Array.isArray(result?.tool_calls) ? result.tool_calls : [];
    if (!toolCalls.length) {
      const content = result?.content;
      if (typeof content !== "string" || !content.trim()) throw new Error("模型没有返回可显示的内容");
      return { content };
    }
    if (round >= SIDE_CHAT_TOOL_ROUNDS) {
      const content = String(result?.content || "").trim();
      return { content: content || "侧边聊天的会话检索轮数已达上限，没能生成回答；请把问题说得更具体一些再试。" };
    }
    messages.push({ role: "assistant", content: result?.content || null, tool_calls: result.tool_calls });
    for (const call of toolCalls) {
      const outcome = handleSideChatTool(call?.function?.name, toolCallArguments(call), { session });
      messages.push({
        role: "tool",
        tool_call_id: String(call?.id || ""),
        content: outcome?.ok ? outcome.result : `检索失败：${outcome?.result || "未知错误"}`,
      });
    }
  }
});
    },
  };
}
