// 语音设置面板：从 SettingsDialog 抽出的「语音转写 + 语音合成」tab 整段。
// 纯展示组件：状态（voiceLocal/ttsLocal/下载进度等）仍由 SettingsDialog 持有，
// 避免切换 tab 时因子组件卸载而丢失；这里只通过 props 接收。
import type { Dispatch, SetStateAction } from "react";
import type { ProviderSettings, TtsLocalStatus, VoiceLocalStatus } from "../../types";

// 本地转写模型候选清单（与主进程 ASR_MODELS 的展示信息保持一致；下载状态从 voiceLocal.models 合并）
const localAsrModelOptions = [
  { id: "qwen3-asr-0.6b", label: "Qwen3-ASR-0.6B", note: "约 1GB · 最快，中文优先" },
  { id: "qwen3-asr-1.7b", label: "Qwen3-ASR-1.7B", note: "约 2.5GB · 更准确，中文优先" },
  { id: "ultravox-0.5-1b", label: "Ultravox-0.5-1B", note: "约 2.7GB · 多语言" },
  { id: "voxtral-mini-3b", label: "Voxtral-Mini-3B", note: "约 3.2GB · 多语言" },
];

// 本地合成模型候选清单（与主进程 TTS_MODELS 的展示信息保持一致；下载状态从 ttsLocal.models 合并）
const localTtsModelOptions = [
  { id: "qwen3-tts-1.7b-q4", label: "Qwen3-TTS-1.7B（Q4_K_M）", note: "约 1.5GB · 更小更快" },
  { id: "qwen3-tts-1.7b-q8", label: "Qwen3-TTS-1.7B（Q8_0）", note: "约 2.3GB · 音质更好" },
];

export function VoiceSettingsPanel({
  draft,
  setDraft,
  voiceLocal,
  voiceDownloading,
  voiceDownloadError,
  startVoiceLocalDownload,
  ttsLocal,
  ttsDownloading,
  ttsDownloadPhase,
  ttsDownloadError,
  startTtsLocalDownload,
  ttsVoiceConverting,
  ttsVoiceConvertHint,
  pickAndPrepareTtsVoice,
}: {
  draft: ProviderSettings;
  setDraft: Dispatch<SetStateAction<ProviderSettings>>;
  voiceLocal: VoiceLocalStatus | null;
  voiceDownloading: boolean;
  voiceDownloadError: string;
  startVoiceLocalDownload: (modelId?: string) => Promise<void>;
  ttsLocal: TtsLocalStatus | null;
  ttsDownloading: boolean;
  ttsDownloadPhase: string;
  ttsDownloadError: string;
  startTtsLocalDownload: (modelId?: string) => Promise<void>;
  ttsVoiceConverting: boolean;
  ttsVoiceConvertHint: string;
  pickAndPrepareTtsVoice: () => Promise<void>;
}) {
  return (<>
        <div className="dialog-section-title">语音转写</div>
        <label>
          转写引擎
          <select
            value={draft.transcriptionEngine}
            onChange={(event) => setDraft({ ...draft, transcriptionEngine: event.target.value as ProviderSettings["transcriptionEngine"] })}
          >
            <option value="cloud">云端服务（OpenAI 兼容 /audio/transcriptions）</option>
            <option value="local">本地引擎（离线可用，多模型可选）</option>
          </select>
        </label>
        {draft.transcriptionEngine === "local" && (() => {
          const selectedId = draft.asrModel || "qwen3-asr-0.6b";
          const statusById = new Map((voiceLocal?.models || []).map((model) => [model.id, model]));
          const selected = statusById.get(selectedId);
          const selectedOption = localAsrModelOptions.find((model) => model.id === selectedId) || localAsrModelOptions[0];
          return (
          <div className="dialog-note">
            <label>
              本地模型
              <select
                value={selectedId}
                onChange={(event) => setDraft({ ...draft, asrModel: event.target.value })}
              >
                {localAsrModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}（{model.note}{statusById.get(model.id)?.downloaded ? "，已下载" : ""}）
                  </option>
                ))}
              </select>
            </label>
            {selected?.downloaded
              ? `本地语音模型已就绪：${selectedOption.label}（已存本机）。首次转写按需启动引擎（约 2-5 秒），空闲 3 分钟后自动退出释放内存。`
              : `本地语音模型未下载：${selectedOption.label}（${selectedOption.note} + 引擎约 20MB），下载完成后无需联网即可把语音转成文字。`}
            {!selected?.downloaded && (
              <button type="button" className="settings-update-check" onClick={() => void startVoiceLocalDownload(selectedId)} disabled={voiceDownloading}>
                {voiceDownloading
                  ? `下载中 ${selected?.expectedBytes ? Math.min(99, Math.round((selected.sizeBytes / selected.expectedBytes) * 100)) : 0}%`
                  : "下载模型与引擎"}
              </button>
            )}
            {voiceDownloadError && <p style={{ color: "#c0392b" }}>{voiceDownloadError}</p>}
            <label>
              模型保存路径（可选）
              <span style={{ display: "flex", gap: 8 }}>
                <input
                  value={draft.asrModelDir}
                  placeholder="默认存到应用数据目录 models/asr"
                  onChange={(event) => setDraft({ ...draft, asrModelDir: event.target.value })}
                />
                <button
                  type="button"
                  className="settings-update-check"
                  onClick={async () => {
                    const picked = await window.dyworker?.chooseVoiceLocalDir();
                    if (picked?.path) setDraft({ ...draft, asrModelDir: picked.path });
                  }}
                >
                  浏览…
                </button>
              </span>
            </label>
            <label>
              自定义 llama-server 路径（可选）
              <input
                value={draft.llamaServerPath}
                placeholder="留空使用内置下载的语音引擎"
                onChange={(event) => setDraft({ ...draft, llamaServerPath: event.target.value })}
              />
            </label>
            <p>更改模型路径并保存后立即生效；若新目录里没有模型文件，重新点“下载模型与引擎”。切换模型后首次转写会重新加载引擎。</p>
          </div>
          );
        })()}
        {draft.transcriptionEngine !== "local" && (<>
        <label>
          转写服务地址
          <input
            value={draft.transcriptionEndpoint}
            placeholder="留空时根据模型服务地址自动生成"
            onChange={(event) => setDraft({ ...draft, transcriptionEndpoint: event.target.value })}
          />
        </label>
        <label>
          转写模型
          <input
            value={draft.transcriptionModel}
            placeholder="whisper-1"
            onChange={(event) => setDraft({ ...draft, transcriptionModel: event.target.value })}
          />
        </label>
        </>)}
        <div className="dialog-section-title" style={{ marginTop: 18 }}>语音合成（渠道语音发送）</div>
        <label>
          合成引擎
          <select
            value={draft.ttsEngine}
            onChange={(event) => setDraft({ ...draft, ttsEngine: event.target.value as ProviderSettings["ttsEngine"] })}
          >
            <option value="cloud">云端服务（OpenAI 兼容 /audio/speech）</option>
            <option value="local">本地引擎（Qwen3-TTS，离线可用）</option>
          </select>
        </label>
        {draft.ttsEngine === "local" && (() => {
          const selectedId = draft.ttsLocalModel || "qwen3-tts-1.7b-q8";
          const statusById = new Map((ttsLocal?.models || []).map((model) => [model.id, model]));
          const selected = statusById.get(selectedId);
          const selectedOption = localTtsModelOptions.find((model) => model.id === selectedId) || localTtsModelOptions[1];
          return (
          <div className="dialog-note">
            <label>
              本地模型
              <select
                value={selectedId}
                onChange={(event) => setDraft({ ...draft, ttsLocalModel: event.target.value })}
              >
                {localTtsModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}（{model.note}{statusById.get(model.id)?.downloaded ? "，已下载" : ""}）
                  </option>
                ))}
              </select>
            </label>
            {selected?.downloaded
              ? `本地语音合成模型已就绪：${selectedOption.label}（已存本机）。合成时按需启动引擎，无需联网。`
              : `本地语音合成模型未下载：${selectedOption.label}（${selectedOption.note} + 引擎与语音转写共用），下载完成后无需联网即可把文字合成语音。`}
            {!selected?.downloaded && (
              <button type="button" className="settings-update-check" onClick={() => void startTtsLocalDownload(selectedId)} disabled={ttsDownloading}>
                {ttsDownloading
                  ? (ttsDownloadPhase.startsWith("runtime:")
                    ? "下载引擎中…"
                    : `下载中 ${selected?.expectedBytes ? Math.min(99, Math.round((selected.sizeBytes / selected.expectedBytes) * 100)) : 0}%`)
                  : "下载模型与引擎"}
              </button>
            )}
            {ttsDownloadError && <p style={{ color: "#c0392b" }}>{ttsDownloadError}</p>}
            <label>
              模型保存路径（可选）
              <span style={{ display: "flex", gap: 8 }}>
                <input
                  value={draft.ttsModelDir}
                  placeholder="默认存到应用数据目录 models/tts"
                  onChange={(event) => setDraft({ ...draft, ttsModelDir: event.target.value })}
                />
                <button
                  type="button"
                  className="settings-update-check"
                  onClick={async () => {
                    const picked = await window.dyworker?.chooseTtsLocalDir();
                    if (picked?.path) setDraft({ ...draft, ttsModelDir: picked.path });
                  }}
                >
                  浏览…
                </button>
              </span>
            </label>
            <label>
              参考音色音频（可选）
              <span style={{ display: "flex", gap: 8 }}>
                <input
                  value={draft.ttsVoicePath}
                  placeholder="留空用模型默认音色；选一段 6-15 秒的人声可克隆音色"
                  onChange={(event) => setDraft({ ...draft, ttsVoicePath: event.target.value })}
                />
                <button
                  type="button"
                  className="settings-update-check"
                  onClick={() => void pickAndPrepareTtsVoice()}
                  disabled={ttsVoiceConverting}
                >
                  {ttsVoiceConverting ? "转换中…" : "浏览…"}
                </button>
              </span>
            </label>
            {ttsVoiceConvertHint && <p style={{ marginTop: 6 }}>{ttsVoiceConvertHint}</p>}
            <p>更改模型路径并保存后立即生效；若新目录里没有模型文件，重新点“下载模型与引擎”。切换模型后首次合成会使用新模型。</p>
          </div>
          );
        })()}
        {draft.ttsEngine !== "local" && (<>
        <label>
          合成服务地址
          <input
            value={draft.ttsEndpoint}
            placeholder="OpenAI 兼容的 /audio/speech 地址，留空则不提供语音发送"
            onChange={(event) => setDraft({ ...draft, ttsEndpoint: event.target.value })}
          />
        </label>
        <label>
          合成模型
          <input
            value={draft.ttsModel}
            placeholder="tts-1"
            onChange={(event) => setDraft({ ...draft, ttsModel: event.target.value })}
          />
        </label>
        <label>
          合成密钥
          <input
            type="password"
            value={draft.ttsApiKey}
            placeholder="留空时使用主模型密钥"
            onChange={(event) => setDraft({ ...draft, ttsApiKey: event.target.value })}
          />
        </label>
        </>)}
        <p className="dialog-note">切换服务商后只需核对模型名称并填入密钥。文本、图片附件和语音转写使用兼容 OpenAI 格式的服务。</p>
        </>);
}
