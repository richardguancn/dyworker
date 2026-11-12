// 代理系统提示和旧记忆兼容。
import { workspaceFileGuidance } from '../active-permissions.mts';
import { chartGuidance } from '../host/chart-guidance.mts';
import { communicationGuidance } from '../host/communication-guidance.mts';
import { commandGuidance } from '../host/command-guidance.mts';
import { computerUseGuidance } from '../host/computer-use-guidance.mts';
import { getPromptDefinition } from './prompt-locales.mts';

export { getPromptDefinition } from './prompt-locales.mts';

// 系统提示词按「身份与静态纪律在前、会话动态信息在尾」组织（借鉴 Claude Code 的静态/动态分层），
// 同一身份与语言下的固定部分跨会话保持稳定，让 DeepSeek/GLM 等端点的自动前缀缓存命中率最大化。
export function systemPrompt(workspacePath, loop, memoryReviewDue, goal = "", identity = "general", locale = "zh-CN") {
  const governmentMode = identity === "government";
  const def = getPromptDefinition(governmentMode ? "zh-CN" : locale);

  const loopLine = loop?.enabled
    ? def.loopLine(loop.iteration, loop.maximum)
    : def.loopDoneLine;
  const reviewLine = memoryReviewDue ? def.reviewLine : "";

  const governmentSections = governmentMode ? [
    "# 公文与政府事务\n"
    + "- 公文遵循 GB/T 9704，成稿用 check_official_document 自查、export_word_document 导出；时限用 calculate_workdays，政策先 gov_search 再 fetch_web_page 核原文（附网址），外发前用 scan_sensitive_info 检查。",
  ] : [];

  const toolsSection = locale.startsWith("zh") || governmentMode
    ? `# 工具与安全\n- ${workspaceFileGuidance}\n` + def.tools.replace(/^# 工具与安全\n?/, "")
    : def.tools + `\n- ${workspaceFileGuidance}`;

  const staticSections = [
    governmentMode
      ? "你是 DYWorker，服务政府单位办公人员的本地工作助手，目标是直接完成工作并交付验证后的结果。"
      : def.identity,

    def.discipline,
    toolsSection,
    commandGuidance(),
    computerUseGuidance,
    def.applicationSafety,
    ...governmentSections,
    def.memory,
    locale.startsWith("zh") || governmentMode ? communicationGuidance : def.communication,
    chartGuidance,
  ];

  const goalLine = goal ? def.goalLine(goal) : "";
  const workspaceLine = workspacePath ? def.workspaceLine(workspacePath) : def.noWorkspaceLine;

  const dynamicSections = [
    workspaceLine,
    goalLine,
    loopLine,
    reviewLine,
  ].filter(Boolean);

  return [...staticSections, ...dynamicSections].join("\n\n");
}

// 兼容旧的扁平 memories 参数：每条记忆视作一个单行页面，保持按相关性逐条选取的行为。
export function memoriesAsPagesFallback(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => String(item?.content || "").trim())
    .map((item) => {
      const rows = [{
        id: String(item?.id || ""),
        kind: String(item?.kind || ""),
        category: String(item?.category || ""),
        content: String(item.content || "").trim(),
      }];
      return {
        relPath: `pages/flat/${rows[0].id || rows[0].content.slice(0, 12)}.md`,
        title: rows[0].category || "长期记忆",
        scope: item?.scope === "workspace" ? "workspace" : "global",
        workspacePath: String(item?.workspacePath || ""),
        rows,
        content: `# ${rows[0].category || "长期记忆"}\n\n- ${rows[0].content} <!--mem:${rows[0].id}|${rows[0].kind}|${rows[0].category}-->`,
      };
    });
}
