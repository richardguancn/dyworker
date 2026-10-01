// IPC 域插件：设置保存与连通性探测（settings:save / settings:probe-credentials / settings:list-models）。
// 请求构造与端点归一化直接复用 agent.mts 的纯函数；保存后的副作用（睡眠拦截/审核模型目录/
// 语音引擎/渠道重连/运营设置）属壳层领域，经 deps 注入。
import { bareModelName, isResponsesEndpoint, listServerModels, normalizeModelEndpoint } from "../../agent.mts";

export function settingsIpcPlugin(deps) {
  return {
    name: "ipc:settings",
    apply(ctx) {
      const { trustedHandle, saveSettings, applyPreventSleep, applyReviewerModelDir, applyAsrSettings, applyTtsSettings, reconcileChannels, applyTelemetrySettings } = deps;

      // 保存设置的副作用编排：落盘走 ctx.settings 服务（saveSettings 内部转发），
      // 睡眠拦截/审核模型目录/语音引擎/渠道重连/运营设置都是壳层领域，经 deps 注入
      trustedHandle("settings:save", async (_event, settings) => {
        try {
          const updateUrl = await saveSettings(settings);
          applyPreventSleep(settings);
          applyReviewerModelDir(settings);
          applyAsrSettings(settings);
          applyTtsSettings(settings);
          // 渠道配置热生效:按新设置 diff 启停 QQ/微信连接
          await reconcileChannels();
          // 统计/消息设置热生效：开关、服务地址、免打扰等即时应用
          await applyTelemetrySettings(settings);
          return { ok: true, updateUrl };
        } catch (error: any) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });

      trustedHandle("settings:probe-credentials", async (_event, payload) => {
  const endpoint = String(payload?.endpoint || "").trim();
  const model = String(payload?.model || "").trim();
  const apiKey = String(payload?.apiKey || "").trim();
  if (!endpoint || !model) return { ok: false, error: "请先填写服务地址和模型名称" };
  // 模型名可能带 [1M]/[256K] 上下文后缀，请求前剥离
  const bareModel = bareModelName(model);
  // DeepSeek 官方根地址自动补全为 /responses；Responses API 与 Chat Completions 请求体不同
  const target = normalizeModelEndpoint(endpoint);
  const responsesApi = isResponsesEndpoint(target);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const startedAt = Date.now();
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 本地推理服务（vLLM/Ollama/LM Studio）常无需 Key，空 Key 时不带 Authorization 头
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(responsesApi
        ? { model: bareModel, input: [{ role: "user", content: "ping" }], max_output_tokens: 1 }
        : { model: bareModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
      signal: controller.signal,
    });
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
    const latencyMs = Date.now() - startedAt;
    if (response.ok) return { ok: true, status: response.status, latencyMs, message: `验证通过：服务可达，密钥与模型可用（${latencyMs} ms）` };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, latencyMs, error: `密钥被拒绝（HTTP ${response.status}）：${detail || "请检查 API Key 是否正确、是否过期或权限不足"}` };
    }
    if (response.status === 404) {
      return { ok: false, status: response.status, latencyMs, error: `地址或模型不存在（HTTP 404）：${detail || "请检查服务地址和模型名称是否填写正确"}` };
    }
    if (response.status === 429) {
      return { ok: false, status: response.status, latencyMs, error: `密钥有效但被限流或额度不足（HTTP 429）：${detail || "请稍后重试或检查账户额度"}` };
    }
    return { ok: false, status: response.status, latencyMs, error: `请求被拒绝（HTTP ${response.status}）：${detail || "服务可达，但请求未被接受"}` };
  } catch (error: any) {
    const aborted = error?.name === "AbortError";
    return { ok: false, error: aborted ? "验证超时（20 秒无响应），服务地址可能不可达" : `无法连接服务地址：${error?.message || error}` };
  } finally {
    clearTimeout(timer);
  }
});

trustedHandle("settings:list-models", async (_event, payload) => {
  const endpoint = String(payload?.endpoint || "").trim();
  if (!endpoint) return { ok: false, error: "请先填写服务地址" };
  return listServerModels({ endpoint, apiKey: String(payload?.apiKey || "").trim() });
});
    },
  };
}
