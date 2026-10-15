import { LoaderCircle } from "lucide-react";
import { stripControlMarkers } from "../../lib/text";
import type { Attachment, ChatMessage } from "../../types";
import { ClampedUserText } from "./ClampedText";

export function isVoiceAttachment(attachment?: Attachment | null): boolean {
  if (!attachment) return false;
  return Boolean(
    attachment.isVoice ||
    attachment.mimeType?.startsWith("audio/") ||
    attachment.name === "语音" ||
    /\.(silk|wav|mp3|m4a|aac|opus|ogg|amr)$/i.test(attachment.name || attachment.path)
  );
}

export function isVoiceMessage(message: ChatMessage): boolean {
  if (message.attachments?.some(isVoiceAttachment)) return true;
  const content = String(message.content || "");
  return content.includes("[语音转写]") || content.trim() === "[语音]";
}

export function parseVoiceMessageDetails(message: ChatMessage) {
  const raw = String(message.displayContent ?? message.content ?? "").trim();
  let text = raw;
  let channelPrefix = "";

  // 匹配 [来自QQ 张三] 或 [来自微信] 等
  const channelMatch = text.match(/^(\[来自(?:QQ|微信|qq|wechat)[^\]]*\])\s*/i);
  if (channelMatch) {
    channelPrefix = channelMatch[1];
    text = text.slice(channelMatch[0].length).trim();
  }

  // 匹配 [语音转写] 或 [语音]
  const voiceTagMatch = text.match(/^\[(?:语音转写|语音)\]\s*/);
  if (voiceTagMatch) {
    text = text.slice(voiceTagMatch[0].length).trim();
  }

  // 清理 ASR 遗留的模型语言前缀或控制标记
  text = text.replace(/^\s*language\s+[A-Za-z-]+\s*/i, "");
  text = text.replace(/^\s*(?:zh|en|yue|ja|ko|fr|de|es|ru|ar|pt|it|vi|th|id|ms|hi|[a-z]{2}(?:-[A-Za-z]{2})?)\s*[\s,，、|｜:：-]+\s*/i, "");
  text = text.replace(/<\|[^|]*\|>/g, "").trim();

  const voiceAttachment = message.attachments?.find(isVoiceAttachment) || null;

  return {
    channelPrefix,
    asrText: stripControlMarkers(text),
    voiceAttachment,
  };
}

export function VoiceWaveIcon({ playing = false }: { playing?: boolean }) {
  return (
    <svg
      className={`voice-wave-svg${playing ? " playing" : ""}`}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <path className="wave-arc wave-1" d="M10 7.5a6.5 6.5 0 0 1 0 9" />
      <path className="wave-arc wave-2" d="M15 4a12 12 0 0 1 0 16" />
    </svg>
  );
}

export function VoiceMessageBubble({
  message,
  playingPath,
  loadingPath,
  onTogglePlay,
  tokenNames,
  skillNames,
  onFileToken,
}: {
  message: ChatMessage;
  playingPath: string | null;
  loadingPath: string | null;
  onTogglePlay: (attachment: Attachment) => void;
  tokenNames?: Set<string>;
  skillNames?: Set<string>;
  onFileToken?: (name: string) => void;
}) {
  const { channelPrefix, asrText, voiceAttachment } = parseVoiceMessageDetails(message);
  const pathKey = voiceAttachment ? (voiceAttachment.path || voiceAttachment.name) : "";
  const isPlaying = Boolean(pathKey && playingPath === pathKey);
  const isLoading = Boolean(pathKey && loadingPath === pathKey);

  // 预估或实际时长（优先 attachment.duration，其次按 silk 约 3KB/s 预估，最少 1 秒）
  const durationSec = voiceAttachment?.duration
    ? Math.round(voiceAttachment.duration)
    : (voiceAttachment?.size ? Math.max(1, Math.min(60, Math.round(voiceAttachment.size / 3000))) : 2);

  // 气泡按秒数伸缩宽度（min 72px ~ max 220px）
  const barWidth = Math.min(220, Math.max(72, 68 + durationSec * 6));

  return (
    <div className="voice-message-block">
      {channelPrefix && (
        <div className="voice-channel-tag">{channelPrefix}</div>
      )}
      {voiceAttachment && (
        <button
          type="button"
          className={`voice-play-bar${isPlaying ? " playing" : ""}${isLoading ? " loading" : ""}`}
          style={{ width: `${barWidth}px` }}
          onClick={() => onTogglePlay(voiceAttachment)}
          title={isPlaying ? "点击暂停" : "点击播放语音"}
          aria-label={isPlaying ? "暂停语音" : "播放语音"}
        >
          {isLoading ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <VoiceWaveIcon playing={isPlaying} />
          )}
          <span className="voice-duration">{durationSec}&quot;</span>
        </button>
      )}
      {Boolean(asrText) && (
        <div className="voice-asr-section">
          <ClampedUserText text={asrText} tokenNames={tokenNames} skillNames={skillNames} onFileToken={onFileToken} />
        </div>
      )}
    </div>
  );
}
