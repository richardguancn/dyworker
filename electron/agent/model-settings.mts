// 推理强度和辅助模型设置。
import { effectiveReasoningEffort,getModelReasoningConfig } from "../model-reasoning.ts";


// 与设置页共用模型能力配置；旧档位先规范化，避免切换模型后发出非法参数。
export function reasoningRequestParams({ provider = null, effort = "", model = "", endpoint = "", overrides = undefined }) {
  const config = getModelReasoningConfig({ provider, model, endpoint, overrides });
  const value = effectiveReasoningEffort(config, effort);
  if (!value) return {};
  switch (config.kind) {
    case "deepseek":
    case "glm":
      if (value === "off") return { thinking: { type: "disabled" } };
      if (value === "on") return { thinking: { type: "enabled" } };
      return { reasoning_effort: value };
    case "kimi":
      if (value === "off" || value === "on") return { thinking: { type: value === "off" ? "disabled" : "enabled" } };
      return { reasoning_effort: value };
    case "qwen":
      if (value === "off" || value === "on") return { enable_thinking: value === "on" };
      return { enable_thinking: true, reasoning_effort: value };
    case "qwen-local":
      return value === "off"
        ? { chat_template_kwargs: { enable_thinking: false } }
        : { chat_template_kwargs: { enable_thinking: true }, reasoning_effort: value };
    case "minimax":
      if (value === "off" || value === "adaptive") return { thinking: { type: value === "off" ? "disabled" : "adaptive" } };
      return { reasoning_effort: value };
    case "doubao":
      if (["off", "on", "auto"].includes(value)) return { thinking: { type: value === "off" ? "disabled" : value === "on" ? "enabled" : "auto" } };
      return { reasoning_effort: value };
    default:
      return { reasoning_effort: value === "off" ? "none" : value };
  }
}

export function responsesReasoningParams({ provider, effort, model, endpoint, overrides }) {
  const config = getModelReasoningConfig({ provider, model, endpoint, overrides });
  const value = effectiveReasoningEffort(config, effort);
  if (!value || ["on", "auto", "adaptive"].includes(value)) return null;
  // 方舟的 minimal 才表示关闭思考；none 仅作为其兼容值。
  return { effort: value === "off" ? (config.kind === "doubao" ? "minimal" : "none") : value };
}

// 仅用于历史整理：能关闭则关闭，否则选择模型明确支持的较低档位。
// 不把不支持的 off 映射回 high/max，也不推测未知模型或自定义档位的强弱。
export function summarizationSettings(settings) {
  const config = getModelReasoningConfig({ endpoint: settings.endpoint, model: settings.model, overrides: settings.reasoningOverrides });
  const reasoningEffort = ["off", "minimal", "low"].find(effort => config.efforts.includes(effort)) || "";
  return { ...settings, reasoningEffort };
}

// 子代理模型：按 settings.subAgentProfileId 从模型档案解析专用配置；
// 未配置或档案缺失/不完整时原样返回（子代理跟随主模型），密钥为空时沿用主模型密钥
export function resolveSubAgentSettings(settings) {
  const profileId = String(settings?.subAgentProfileId || "").trim();
  if (!profileId) return settings;
  const profile = (Array.isArray(settings?.profiles) ? settings.profiles : [])
    .find((item) => item && item.id === profileId);
  const endpoint = String(profile?.endpoint || "").trim();
  const model = String(profile?.model || "").trim();
  if (!endpoint || !model) return settings;
  return {
    ...settings,
    endpoint,
    model,
    apiKey: String(profile.apiKey || "").trim() || settings.apiKey,
    reasoningEffort: String(profile.reasoningEffort || "").trim(),
  };
}
