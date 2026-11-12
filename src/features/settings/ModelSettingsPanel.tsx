// 模型服务设置面板：从 SettingsDialog 抽出的「模型服务」tab 整段。
// 纯展示组件：draft、profiles、凭证预检、本地审核模型下载等状态仍由 SettingsDialog 持有，
// 避免切换 tab 时因子组件卸载而丢失；这里只通过 props 接收。
import { LoaderCircle, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { isLocalModelEndpoint } from "../../../electron/host/dsh-runtime/model-settings.mts";
import { isGlmNativeVisionModel, providerPresets, usesResponsesApi } from "../../providers";
import { t } from "../../i18n";
import type { DecisionLocalStatus, ModelProfile, ProviderSettings, ReviewerLocalStatus } from "../../types";

// 阈值数字输入（审批放行/预路由两档共用）
function ThresholdField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input value={value} type="number" min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

// 本地模型保存路径字段（审核/决策两个本地分支共用）
function LocalModelDirField({ value, onPick, onChange, placeholder }: { value: string; onPick: () => Promise<void>; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label>
      {t("model.reviewerSavePath", "保存路径（可选）")}
      <span style={{ display: "flex", gap: 8 }}>
        <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        <button type="button" className="settings-update-check" onClick={onPick}>{t("model.reviewerBrowse", "浏览…")}</button>
      </span>
    </label>
  );
}

// 决策模型下载阶段文案：环境准备（检查 Python/建 venv/装依赖）合并展示，模型阶段带整体百分比
function decisionPhaseText(phase: string, decisionLocal: DecisionLocalStatus | null) {
  if (phase === "model" && decisionLocal?.model.expectedBytes) {
    return `${t("model.decisionPhaseModel", "下载权重")} ${Math.min(99, Math.round((decisionLocal.model.sizeBytes / decisionLocal.model.expectedBytes) * 100))}%`;
  }
  return t("model.decisionPhaseRuntime", "准备环境…");
}

export function ModelSettingsPanel({
  draft,
  setDraft,
  profiles,
  profileId,
  providerId,
  preset,
  saving,
  applyProfile,
  removeProfile,
  applyProvider,
  applyEndpoint,
  applyModel,
  probing,
  probeResult,
  runCredentialProbe,
  modelsFetching,
  modelOptions,
  modelsError,
  modelChoices,
  reviewerLocal,
  reviewerDownloading,
  reviewerDownloadError,
  startReviewerLocalDownload,
  decisionLocal,
  decisionDownloading,
  decisionDownloadPhase,
  decisionDownloadError,
  startDecisionLocalDownload,
}: {
  draft: ProviderSettings;
  setDraft: Dispatch<SetStateAction<ProviderSettings>>;
  profiles: ModelProfile[];
  profileId: string;
  providerId: string;
  preset: (typeof providerPresets)[number];
  saving: boolean;
  applyProfile: (id: string) => void;
  removeProfile: () => Promise<void>;
  applyProvider: (id: string) => void;
  applyEndpoint: (endpoint: string) => void;
  applyModel: (model: string) => void;
  probing: boolean;
  probeResult: { ok: boolean; text: string } | null;
  runCredentialProbe: () => Promise<void>;
  modelsFetching: boolean;
  modelOptions: Array<{ id: string; contextLimit?: number }> | null;
  modelsError: string;
  modelChoices: Array<{ id: string; contextLimit?: number }>;
  reviewerLocal: ReviewerLocalStatus | null;
  reviewerDownloading: boolean;
  reviewerDownloadError: string;
  startReviewerLocalDownload: () => Promise<void>;
  decisionLocal: DecisionLocalStatus | null;
  decisionDownloading: boolean;
  decisionDownloadPhase: string;
  decisionDownloadError: string;
  startDecisionLocalDownload: () => Promise<void>;
}) {
  return (<>
        <div className="dialog-section-title">{t("model.savedProfiles", "常用模型")}</div>
        <p className="profile-section-hint">{t("model.savedHint", "点击快速切换，修改后可随时保存。")}</p>
        <div className="profile-row">
          <select value={profileId} onChange={(event) => applyProfile(event.target.value)}>
            <option value="">{profiles.length ? t("model.selectProfile", "选择要使用或编辑的模型…") : t("model.noProfiles", "还没有保存的模型")}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
          <button type="button" className="icon-button" onClick={() => void removeProfile()} disabled={!profileId || saving} aria-label={t("model.deleteProfile", "删除所选配置")}>
            <Trash2 size={15} />
          </button>
        </div>
        <div className="dialog-section-title">{t("model.connection", "服务连接")}</div>
        <p className="profile-section-hint">{t("model.connectionHint", "配置生效后立即用于新对话。")}</p>
        <label>
          {t("model.provider", "模型厂商")}
          <select value={providerId} onChange={(event) => applyProvider(event.target.value)}>
            {providerPresets.map((item) => (
              <option key={item.id} value={item.id}>{t("provider." + item.id, item.name)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("model.endpoint", "接口地址")}
          <input
            value={draft.endpoint}
            placeholder={providerId === "deepseek" ? "https://api.deepseek.com/responses" : "https://api.example.com/v1/chat/completions"}
            onChange={(event) => applyEndpoint(event.target.value)}
          />
        </label>
        <p className="dialog-note">
          {draft.endpoint.trim()
            ? (usesResponsesApi(draft.endpoint)
                ? t("model.usesResponses", "该地址将自动使用 Responses API 请求。")
                : t("model.usesChatCompletions", "该地址将自动使用 OpenAI Chat Completions 请求。"))
            : t("model.endpointAutoHint", "系统会根据服务地址自动判断使用 Responses API 或 Chat Completions；DeepSeek 官方根地址会自动补全为 /responses。")}
        </p>
        <label>
          {t("model.apiKey", "访问密钥")}
          <input
            value={draft.apiKey}
            type="password"
            placeholder={`${t("model.apiKeyStoredLocally", "仅保存在当前设备")}（${preset.keyHint}）`}
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
          />
        </label>
        {isLocalModelEndpoint(draft.endpoint) ? <p className="dialog-note">{t("model.localModelKeyHint", "本机服务如果不要求密钥，可以留空；若服务要求验证，请填写对应密钥。")}</p> : null}
        <div className="credential-probe">
          <button type="button" className="button-secondary" onClick={() => void runCredentialProbe()} disabled={probing || saving}>
            {probing ? <LoaderCircle className="spin" size={14} /> : null}
            {probing ? t("model.probing", "正在测试…") : t("model.probe", "测试连接")}
          </button>
          {probeResult ? <p className={`credential-probe-result ${probeResult.ok ? "ok" : "bad"}`}>{probeResult.text}</p> : null}
        </div>
        <label>
          {t("model.modelName", "模型名称")}
          <input
            value={draft.model}
            list="preset-models"
            placeholder={modelsFetching ? t("model.fetchingModels", "正在获取可用模型…") : preset.defaultModel || t("model.defaultModelPlaceholder", "填写服务商提供的模型名称")}
            onChange={(event) => applyModel(event.target.value)}
          />
          <datalist id="preset-models">
            {modelChoices.map((item) => <option key={item.id} value={item.id} />)}
          </datalist>
        </label>
        {modelsFetching ? <p className="dialog-note">正在获取该密钥可用的模型…</p> : null}
        {!modelsFetching && modelOptions ? (
          <p className="dialog-note">{t("model.modelsCount", "已获取 {count} 个可用模型，点击上方输入框即可下拉选择；也可手动输入其他名称。", { count: modelOptions.length })}</p>
        ) : null}
        {modelsError ? <p className="credential-probe-result bad">{modelsError}</p> : null}
        <p className="dialog-note">
          {t("model.contextSuffixHint", "可在模型名后加 [1M]、[256K] 或 [131072] 后缀指定上下文上限（如 k3[1M]），仅用于本地用量统计与裁剪；请求时自动剥离后缀。")}
        </p>
        <label>
          {t("model.subAgent", "子代理模型")}
          <select
            value={draft.subAgentProfileId || ""}
            onChange={(event) => setDraft({ ...draft, subAgentProfileId: event.target.value })}
          >
            <option value="">{t("model.subAgentFollowMain", "跟随主模型")}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
        </label>
        <p className="dialog-note">
          {t("model.subAgentHint", "子代理默认与主模型一致，可在此选用更轻量快速的模型跑收集任务。")}
        </p>
        {(() => {
          const modelName = draft.model.trim();
          const deepseekVision = modelName.toLowerCase() === "deepseek-v4-flash-vision-exp";
          const deepseekText = ["deepseek-v4-flash", "deepseek-v4-pro"].includes(modelName.toLowerCase());
          const glmVision = providerId === "glm" && isGlmNativeVisionModel(modelName);
          const glmText = providerId === "glm" && /^glm-/i.test(modelName) && !glmVision;
          if (!(deepseekVision || deepseekText || glmVision || glmText)) return null;
          if (deepseekVision || glmVision) return (<>
          <div className="dialog-section-title">{t("model.visionSection", "图片（{name}）", { name: modelName })}</div>
          <p className="dialog-note">{glmVision
            ? "该模型是 GLM 原生多模态模型，附件图片会以 image_url 原样随请求发送给智谱，无需配置外部视觉服务。"
            : "该模型原生支持图片输入（input_image / image_url），附件图片会原样随请求发送给 DeepSeek，无需再配置外部视觉服务。图片仅允许出现在用户消息中，支持 JPEG / PNG / GIF / WebP。"}</p>
          </>);
          return (<>
        <div className="dialog-section-title">{t("model.visionAltSection", "图片识别（{name}）", { name: deepseekText ? "DeepSeek V4 Flash / Pro" : "GLM 纯文本模型" })}</div>
        <p className="dialog-note">{deepseekText
          ? "DeepSeek V4 系列模型本身负责文字理解。图片会先交给下方视觉服务识别，再把识别结果交给 DeepSeek；原图不会发送给纯文字接口。视觉服务需支持 OpenAI 兼容的 Chat Completions 和 image_url。"
          : `GLM 纯文本模型不接收图片。可以把模型换成多模态的 glm-5.3-flash（推荐，图片直接发给智谱），或配置下方视觉服务：图片先交给视觉服务识别，再把识别结果交给 GLM，原图不会发送给纯文字接口。视觉服务需支持 OpenAI 兼容的 Chat Completions 和 image_url（如智谱 glm-4.5v）。`}</p>
        <label>
          {t("model.visionEndpoint", "视觉服务地址")}
          <input
            value={draft.visionEndpoint}
            placeholder="https://api.example.com/v1/chat/completions"
            onChange={(event) => setDraft({ ...draft, visionEndpoint: event.target.value })}
          />
        </label>
        <label>
          {t("model.visionModel", "视觉模型名称")}
          <input
            value={draft.visionModel}
            placeholder={t("model.visionModelPlaceholder", "填写视觉服务提供的模型名称")}
            onChange={(event) => setDraft({ ...draft, visionModel: event.target.value })}
          />
        </label>
        <label>
          {t("model.visionApiKey", "视觉服务密钥")}
          <input
            value={draft.visionApiKey}
            type="password"
            placeholder={t("model.apiKeyStoredLocally", "仅保存在当前设备")}
            onChange={(event) => setDraft({ ...draft, visionApiKey: event.target.value })}
          />
        </label>
          </>);
        })()}
        {providerId === "kimi-open" && (<>
        <div className="dialog-section-title">{t("model.kimiPlatform", "Kimi 原生工具（开放平台）")}</div>
        <label className="dialog-check">
          <input
            type="checkbox"
            checked={draft.enableNativeTools !== false}
            onChange={(event) => setDraft({ ...draft, enableNativeTools: event.target.checked })}
          />
          {t("model.enableKimiTools", "启用 Kimi 官方工具（Formula API）")}
        </label>
        <label className="dialog-check">
          <input
            type="checkbox"
            checked={draft.enableWebSearchBuiltin === true}
            onChange={(event) => setDraft({ ...draft, enableWebSearchBuiltin: event.target.checked })}
          />
          启用内置联网搜索（$web_search，默认关闭）
        </label>
        <p className="dialog-note">
          默认关闭会向服务端持久化数据或上传文件的工具：memory（记忆）、excel（表格分析）。Kimi 公式 web_search 与网页抓取仍走本地联网审批。官方工具本体限时免费，恢复收费后按次计费；官方提示内置联网搜索正在升级，可能不稳定。
        </p>
        </>)}
        <div className="dialog-section-title">{t("model.reviewerSection", "审核模型")}</div>
        <p className="dialog-note">
          {t("model.reviewerHint", "选择“替我审批”时，由助手根据当前任务独立决定是否放行操作。")}
        </p>
        <label>
          {t("model.reviewerBackend", "审核来源")}
          <select
            value={draft.reviewerBackend}
            onChange={(event) => setDraft({ ...draft, reviewerBackend: event.target.value as ProviderSettings["reviewerBackend"] })}
          >
            <option value="main">{t("model.reviewerMain", "跟随当前模型")}</option>
            <option value="local">{t("model.reviewerLocal", "本地离线模型")}</option>
            <option value="custom">{t("model.reviewerCustom", "自定义接口")}</option>
            <option value="decision">{t("model.reviewerDecision", "决策模型（Intern-Decision）")}</option>
          </select>
        </label>
        {draft.reviewerBackend === "local" && (
          <div className="dialog-note">
            <p>本地小模型仅供离线检查，不能独立批准操作。“替我审批”请使用当前模型或自定义审核服务。服务能力不足时会明确停止待审操作，不会要求你逐条接管。</p>
            {reviewerLocal?.downloaded
              ? "模型已就绪：Qwen3-0.6B（610 MB，已存本机）。任务运行时按需加载，空闲 5 分钟后自动释放。"
              : "模型未下载：Qwen3-0.6B（约 610 MB），从 ModelScope 下载到保存目录，下载完成后离线可用。"}
            {!reviewerLocal?.downloaded && (
              <button type="button" className="settings-update-check" onClick={startReviewerLocalDownload} disabled={reviewerDownloading}>
                {reviewerDownloading
                  ? `下载中 ${reviewerLocal?.expectedBytes ? Math.min(99, Math.round((reviewerLocal.sizeBytes / reviewerLocal.expectedBytes) * 100)) : 0}%`
                  : t("model.reviewerDownload", "下载模型")}
              </button>
            )}
            {reviewerDownloadError && <p style={{ color: "#c0392b" }}>{reviewerDownloadError}</p>}
            <LocalModelDirField
              value={draft.reviewerModelDir}
              placeholder={t("model.reviewerPathPlaceholder", "默认存到应用数据目录 models/reviewer")}
              onChange={(value) => setDraft({ ...draft, reviewerModelDir: value })}
              onPick={async () => {
                const picked = await window.dyworker?.chooseReviewerLocalDir();
                if (picked?.path) setDraft({ ...draft, reviewerModelDir: picked.path });
              }}
            />
            <p>{t("model.reviewerPathNote", "更改路径并保存后立即生效；若新目录里没有模型文件，重新点“下载模型”或把旧的 Qwen3-0.6B-Q8_0.gguf 手动移过去。")}</p>
          </div>
        )}
        {draft.reviewerBackend === "custom" && (<>
        <label>
          {t("model.reviewerEndpoint", "审核服务地址")}
          <input
            value={draft.reviewerEndpoint}
            placeholder="http://127.0.0.1:11434/v1/chat/completions"
            onChange={(event) => setDraft({ ...draft, reviewerEndpoint: event.target.value })}
          />
        </label>
        <label>
          {t("model.reviewerModel", "审核模型名称")}
          <input
            value={draft.reviewerModel}
            placeholder="qwen3:4b"
            onChange={(event) => setDraft({ ...draft, reviewerModel: event.target.value })}
          />
        </label>
        <label>
          审核 API 密钥
          <input
            value={draft.reviewerApiKey}
            type="password"
            placeholder="本地服务通常留空"
            onChange={(event) => setDraft({ ...draft, reviewerApiKey: event.target.value })}
          />
        </label>
        </>)}
        {draft.reviewerBackend === "decision" && (<>
        <label>
          {t("model.decisionService", "服务方式")}
          <select
            value={draft.decisionService}
            onChange={(event) => setDraft({ ...draft, decisionService: event.target.value as ProviderSettings["decisionService"] })}
          >
            <option value="remote">{t("model.decisionServiceRemote", "远程服务")}</option>
            <option value="local">{t("model.decisionServiceLocal", "本地托管")}</option>
          </select>
        </label>
        {draft.decisionService === "local" ? (
          <div className="dialog-note">

            <label>
              {t("model.decisionLocalModel", "决策模型")}
              <select
                value={draft.decisionLocalModel}
                onChange={(event) => setDraft({ ...draft, decisionLocalModel: event.target.value })}
              >
                {(decisionLocal?.models ?? []).map((model) => (
                  <option key={model.id} value={model.id}>{model.label}{model.note ? `（${model.note}）` : ""}</option>
                ))}
              </select>
            </label>
            {!decisionLocal?.model.downloaded && (
              <button type="button" className="settings-update-check" onClick={startDecisionLocalDownload} disabled={decisionDownloading}>
                {decisionDownloading ? decisionPhaseText(decisionDownloadPhase, decisionLocal) : t("model.reviewerDownload", "下载模型")}
              </button>
            )}
            <p>{decisionLocal?.model.downloaded ? t("model.decisionLocalReady", "模型已就绪。") : t("model.decisionLocalHint", "首次下载需安装 Python 依赖。")}</p>
            {decisionDownloadError && <p style={{ color: "#c0392b" }}>{decisionDownloadError}</p>}
            <LocalModelDirField
              value={draft.decisionModelDir}
              placeholder={t("model.decisionPathPlaceholder", "默认存到应用数据目录")}
              onChange={(value) => setDraft({ ...draft, decisionModelDir: value })}
              onPick={async () => {
                const picked = await window.dyworker?.chooseDecisionLocalDir();
                if (picked?.path) setDraft({ ...draft, decisionModelDir: picked.path });
              }}
            />
          </div>
        ) : (
          <label>
            {t("model.decisionEndpoint", "决策模型服务地址")}
            <input
              value={draft.decisionEndpoint}
              placeholder="http://127.0.0.1:7860"
              onChange={(event) => setDraft({ ...draft, decisionEndpoint: event.target.value })}
            />
          </label>
        )}
        <ThresholdField
          label={t("model.decisionApprovalThreshold", "审批放行阈值")}
          value={draft.reviewerDecisionThreshold} min={0.5} max={0.99} step={0.01}
          onChange={(value) => setDraft({ ...draft, reviewerDecisionThreshold: value })}
        />
        <ThresholdField
          label={t("model.decisionRouteThreshold", "工具组预路由阈值")}
          value={draft.toolsetRouteThreshold} min={0.3} max={0.99} step={0.05}
          onChange={(value) => setDraft({ ...draft, toolsetRouteThreshold: value })}
        />
        <p className="dialog-note">
          {t("model.decisionNote", "概率达到阈值才自动放行或拒绝，其余转人工确认；服务未就绪时回退人工。")}
        </p>
        </>)}
        </>);
}
