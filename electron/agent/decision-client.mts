// Intern-Decision 决策模型客户端：结构化判定（校准概率），不是对话模型。
// 服务由用户自行启动（官方仓库 scripts/demo.sh），POST {state, questions} 到
// /v1/decisions，一次 forward 返回全部题目的概率分布 {answers: {字段: {probabilities}}}。
// 只读服务端返回的候选概率，不做任何形状猜测；读不出来按不可用处理（fail-closed）。
import { createHash } from "node:crypto";
import { estimateTextTokens } from "./messages.mts";
import { formatProbability } from "./review-probability.mts";
import { decideWithLocalDecision, localDecisionServerState } from "../local-decision-server.mts";

// 决策模型输入上限（DecisionEngine max_length=8192 token），留出题目 schema 与
// 聊天模板的余量；超出直接按容量不足处理，不做截断猜测。
export const DECISION_MAX_TOKENS = 8192;
const DECISION_INPUT_RESERVE_TOKENS = 1500;
// 工具组预路由的题目上限（服务约束 1–16 题）；超出部分留给主模型 load_toolset。
export const DECISION_MAX_QUESTIONS = 16;

// 端点不可达负缓存：服务未启动时避免每次会话/审批都白等一次连接超时。
// 只缓存「端点不可用」，不缓存任何判定结果；服务恢复后最多 5 分钟重新可用。
const unreachable = new Map<string, number>();

// 归一化服务地址：接受 base URL（http://127.0.0.1:7860）或完整路径
// （/v1/decisions、官方别名 /v1/jev）；其余情况原样拼接 /v1/decisions。
export function normalizeDecisionEndpoint(value: unknown) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (/\/v1\/(?:decisions|jev)$/i.test(raw)) return raw;
  return `${raw}/v1/decisions`;
}

function endpointKey(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

function markUnreachable(endpoint: string) {
  if (unreachable.size >= 64) unreachable.delete(unreachable.keys().next().value);
  unreachable.set(endpointKey(endpoint), Date.now() + 300_000);
}

export function decisionEndpointRecentlyUnavailable(endpoint: unknown) {
  const url = normalizeDecisionEndpoint(endpoint);
  return Boolean(url) && (unreachable.get(endpointKey(url)) || 0) > Date.now();
}

// 审批与预路由共用的 POST；返回原始 JSON 或 null（网络失败、非 2xx、超时）。
// 外层 signal（任务取消/审核超时）中止时直接抛出，不计入不可达缓存。
export async function postDecision({ endpoint, request, fetchImpl = fetch, signal = null, timeoutMs = 5000 } = {} as any) {
  const url = normalizeDecisionEndpoint(endpoint);
  if (!url || !request || typeof request !== "object") return null;
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new Error("决策模型服务超时")), Math.max(1, Number(timeoutMs) || 5000));
  try {
    combined.throwIfAborted();
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: combined,
    });
    if (!response?.ok) { markUnreachable(url); return null; }
    const result = await response.json();
    combined.throwIfAborted();
    return result && typeof result === "object" ? result : null;
  } catch (error: any) {
    signal?.throwIfAborted();
    markUnreachable(url);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 容错读取 answers：只接受 {字段: {probabilities: {选项: 正数}}} 的分布形状。
// 概率按总质量归一（服务端校准只应差浮点舍入）；任何字段读不出来整体返回 null。
export function readDecisionAnswers(result: unknown) {
  const answers = (result as any)?.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return null;
  const out: Record<string, Record<string, number>> = {};
  for (const [key, value] of Object.entries(answers as Record<string, any>)) {
    const probabilities = value?.probabilities;
    if (!probabilities || typeof probabilities !== "object" || Array.isArray(probabilities)) return null;
    const dist: Record<string, number> = {};
    let mass = 0;
    for (const [label, probability] of Object.entries(probabilities)) {
      const p = Number(probability);
      if (!Number.isFinite(p) || p < 0 || p > 1) return null;
      if (p > 0) { dist[String(label)] = p; mass += p; }
    }
    if (mass <= 0 || mass > 1 + 1e-6) return null;
    for (const [label, p] of Object.entries(dist)) dist[label] = p / mass;
    out[key] = dist;
  }
  return Object.keys(out).length ? out : null;
}

// 决策模型输入容量检查；review.mts 用它给出与本地小模型同款的容量提示。
export function fitsDecisionInput(text: unknown) {
  return estimateTextTokens(String(text || "")) <= DECISION_MAX_TOKENS - DECISION_INPUT_RESERVE_TOKENS;
}

// 审批分档：一道 choice 题（allow/ask/deny），criteria 顺序即符号映射顺序，须保持稳定。
export const DECISION_APPROVAL_QUESTIONS = {
  decision: {
    type: "choice",
    instructions: "根据以上用户授权、审核政策与待审操作，判断应如何处理当前操作。",
    criteria: {
      allow: "事实充分、影响符合已有授权且不触犯禁止边界，可以执行",
      ask: "事实不足、需要新增授权或须由用户本人确认",
      deny: "应拒绝：外发秘密、削弱安全保护、破坏性不可逆或绕过用户明确禁止",
    },
  },
};

// 决策服务方式：local = 内置托管（Python venv + 本地权重），remote = 用户自起服务/远程端点。
// 与 TTS 的 ttsEngine: "cloud"|"local" 同款显式开关，不做隐式推断。
export function decisionServiceMode(settings: unknown) {
  return String((settings as any)?.decisionService || "") === "local" ? "local" : "remote";
}

function toApprovalDistribution(dist: Record<string, number>) {
  return {
    source: "decision_model",
    calibrated: true,
    allow: Number(dist.allow ?? 0),
    ask: Number(dist.ask ?? 0),
    deny: Number(dist.deny ?? 0),
  };
}

// 审批分档请求：state = 审核政策 + 组合好的授权材料；返回 allow/ask/deny 的概率分布。
// 远程：端点未配置、最近不可达、超容量、服务故障或答案不可读都返回 null，由调用方 fail-closed。
// 本地：进程自管不查不可达负缓存；启动/请求失败向上抛具体原因（review.mts 会带出文案）。
export async function requestDecisionReview({ settings, policy = "", reviewText = "", fetchImpl = fetch, signal = null } = {} as any) {
  const state = `${String(policy || "").trim()}\n\n${String(reviewText || "")}`;
  if (!fitsDecisionInput(state)) return null;
  if (decisionServiceMode(settings) === "local") {
    const result = await decideWithLocalDecision({ request: { state, questions: DECISION_APPROVAL_QUESTIONS }, modelId: settings?.decisionLocalModel, signal });
    const dist = readDecisionAnswers(result)?.decision;
    if (!dist) return null;
    return toApprovalDistribution(dist);
  }
  const endpoint = String(settings?.decisionEndpoint || "").trim();
  if (!endpoint || decisionEndpointRecentlyUnavailable(endpoint)) return null;
  const result = await postDecision({ endpoint, request: { state, questions: DECISION_APPROVAL_QUESTIONS }, fetchImpl, signal });
  const answers = readDecisionAnswers(result);
  const dist = answers?.decision;
  if (!dist) return null;
  return toApprovalDistribution(dist);
}

// 阈值映射：p(allow) 达阈值自动放行、p(deny) 达阈值自动拒绝，其余转人工
// （ask 而非 unavailable，人工弹卡是正常路径不是服务故障）。
export function mapDecisionApproval(distribution: any, threshold: number) {
  const t = Math.min(0.99, Math.max(0.5, Number(threshold) || 0.9));
  const allow = Number(distribution?.allow ?? 0);
  const ask = Number(distribution?.ask ?? 0);
  const deny = Number(distribution?.deny ?? 0);
  const probability = { ...distribution, threshold: t };
  const summary = `决策模型判定：allow ${formatProbability(allow)}、ask ${formatProbability(ask)}、deny ${formatProbability(deny)}（阈值 ${Math.round(t * 100)}%；校准概率非实测准确率）`;
  if (allow >= t) return { decision: "allow", reason: `${summary}；支持在既有授权范围内执行当前操作`, probability };
  if (deny >= t) return { decision: "deny", reason: `${summary}；当前操作未执行`, probability };
  return { decision: "ask", reason: `${summary}；置信不足转人工确认`, probability };
}

// 工具组预路由：每组一道 noul 题，一次 forward 出全部组的概率；
// 返回 p(yes) ≥ 阈值的组名列表（题目数超上限时截断，内置组已由调用方按优先级排序）。
// 本地托管模式只在服务已在运行时参与——预路由预算 3 秒，不容忍 30-60 秒的权重冷加载；
// 未运行时返回空数组保持现状（主模型仍可随时显式调 load_toolset）。
export async function requestToolsetRoute({ settings, query = "", recentContext = "", groups = [], fetchImpl = fetch, signal = null, timeoutMs = 3000 } = {} as any) {
  const local = decisionServiceMode(settings) === "local";
  const endpoint = local ? "" : String(settings?.decisionEndpoint || "").trim();
  const list = Array.isArray(groups) ? groups.filter(group => group?.name) : [];
  const state = [String(query || "").trim(), String(recentContext || "").trim()]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 6000);
  const threshold = Math.min(0.99, Math.max(0.3, Number(settings?.toolsetRouteThreshold) || 0.5));
  if (!local && (!endpoint || decisionEndpointRecentlyUnavailable(endpoint))) return [];
  if (!state || !list.length) return [];
  const selected = list.slice(0, DECISION_MAX_QUESTIONS);
  const questions: Record<string, unknown> = {};
  for (const group of selected) {
    questions[String(group.name)] = {
      type: "noul",
      instructions: `本任务是否需要加载工具组「${String(group.name)}」（${String(group.summary || "")}）的工具？任务明显可能用到时选 yes，基本用不到时选 no。`,
    };
  }
  const request = { state, questions };
  const result = local
    ? (localDecisionServerState().running
      ? await decideWithLocalDecision({ request, modelId: settings?.decisionLocalModel, signal, timeoutMs }).catch(() => null)
      : null)
    : await postDecision({ endpoint, request, fetchImpl, signal, timeoutMs });
  const answers = readDecisionAnswers(result);
  if (!answers) return [];
  const matched: string[] = [];
  for (const group of selected) {
    const name = String(group.name);
    if (Number(answers[name]?.yes ?? 0) >= threshold) matched.push(name);
  }
  return matched;
}
