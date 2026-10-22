import {
Copy,
FileCode2,
FileImage,
FileText,
LoaderCircle,
Package,
Pencil,
Square,
Volume2
} from "lucide-react";
import { memo } from "react";
import { ForkBranchIcon } from "../../app/icons";
import { assistantImageAttachments } from "../../assistantImages.ts";
import { ImageAttachmentView } from "../../ImageAttachment";
import { InteractiveMessage } from "../../InteractiveMessage";
import { formatMessageTime } from "../../lib/format";
import {
messageVisibleText,
skillTokensInText,
stripControlMarkersCached
} from "../../lib/text";
import { messageWithDeliveryContent } from "../../processCommentary.ts";
import { speakMessageKey } from "../../state/messageActions";
import type { Attachment,ChatMessage } from "../../types";
import { MessageAnnotationChip } from "../annotations/SelectionOverlays";
import { ChangesSummary,MessagePasteBlocks } from "./Cards";
import { ClampedUserText } from "./ClampedText";
import { ProcessTimeline } from "./ProcessTimeline";
import { VoiceMessageBubble,isVoiceAttachment,isVoiceMessage } from "./VoiceMessage";


// ===== Codex 风格右侧面板:文本文件判断 / 代码查看 / 审阅 diff =====

// ===== 浏览器「导入 Cookie 和密码」对话框（对照 Codex 浏览器更多菜单） =====

export type MessageRowActions = { [Key in "openReferencedFile" | "openImagePreview" | "handleMessageContextMenu" | "togglePlayVoice" | "toggleActivityCollapse" | "copyMessage" | "startMessageEdit" | "toggleSpeakMessage" | "openMessageSession" | "forkSessionAt" | "openPluginReference" | "openReview" | "bindMessageRow"]: (...args: any[]) => any };

export const ConversationMessageRow = memo(function ConversationMessageRow({
  message, index, turnIndex, sessionId, workspacePath, isEditing, activeTaskRunning, isStreamingMessage,
  playingVoicePath, voiceLoadingPath, speakingMessageKey, speakingLoadingKey, collapsedActivities, actions,
}: {
  message: ChatMessage; index: number; turnIndex: number; sessionId: string; workspacePath: string;
  isEditing: boolean; activeTaskRunning: boolean; isStreamingMessage: boolean;
  playingVoicePath: string | null; voiceLoadingPath: string | null; speakingMessageKey: string | null; speakingLoadingKey: string | null;
  collapsedActivities: Set<string>; actions: MessageRowActions;
}) {
  message = messageWithDeliveryContent(message);
  // 仍在输出中的助手消息（没有终态 taskStatus）不显示时间/复制行；
  // 不能按最后一条下标判断——后面可能跟着排队占位消息
  const hideAssistantActions = message.role === "assistant"
    && activeTaskRunning
    && !message.taskStatus
    && isStreamingMessage;
  // 未定稿（仍在流式输出）的助手消息：交给 InteractiveMessage 走增量 Markdown 路径
  // （按块解析、已定稿的块 memo 冻结，见该组件 streaming 说明）。
  // streamingAssistantIndex 在无运行任务时为 -1，下标不可能等于 -1，故天然安全

  // 旧路径（非 DSH 回合）执行中：模型的话在过程流里实时出现，正文区只在收尾后
  // 显示最终答复，避免同一段文字在过程流和正文区各出现一次。
  // DSH 回合的正文本身就是逐条回复累积的会话输出，照旧显示。
  const liveOutputInProcess = isStreamingMessage && !message.dshTurnId;
  // 用户气泡：@文件 token 高亮 + 点击打开；/技能 token 内联随正文展示
  const inlineTokenNames = message.role === "user"
    ? new Set((message.attachments ?? []).filter((attachment) => attachment.inlineRef).map((attachment) => attachment.name))
    : new Set<string>();
  const messageSkillNames = message.role === "user"
    ? new Set(message.skillsUsed ?? [])
    : new Set<string>();
  // 用户气泡：@「标题」会话 token 高亮，点击切到被引会话
  const messageSessionTitles = message.role === "user"
    ? new Set((message.sessionRefs ?? []).map((ref) => ref.title))
    : new Set<string>();
  // 旧消息兼容：正文里没有 /技能名 token 时才退回 chip 展示（新消息已内联融合）
  const legacySkillChips = message.role === "user"
    ? (message.skillsUsed ?? []).filter((name) => !skillTokensInText(messageVisibleText(message)).has(name))
    : [];
  // 纯图片消息：占位文字已去掉，气泡里没有文字/chip/粘贴块/注释/语音时整个气泡不渲染，只留图片
  const bubbleHasContent = message.role === "user" && (
    isVoiceMessage(message)
    || Boolean(messageVisibleText(message).trim())
    || legacySkillChips.length > 0
    || Boolean(message.attachments?.some((attachment) => !attachment.isImage && !attachment.inlineRef && !isVoiceAttachment(attachment)))
    || Boolean(message.pasteBlocks?.length)
    || Boolean(message.annotations?.length)
    || Boolean(message.dshAttachmentNames?.length)
  );
  // 只有长文块或注释入口时，由入口本身承载内容，不再套一层气泡。
  const bubbleBare = message.role === "user"
    && Boolean(message.annotations?.length || message.pasteBlocks?.length)
    && !isVoiceMessage(message)
    && !messageVisibleText(message).trim()
    && !legacySkillChips.length
    && !message.attachments?.some((attachment) => !attachment.isImage && !attachment.inlineRef && !isVoiceAttachment(attachment))
    && !message.dshAttachmentNames?.length;
  const openMessageFile = (name: string) => {
    const recorded = (message.attachments ?? []).find((attachment) => attachment.inlineRef && attachment.name === name);
    void actions.openReferencedFile(name, recorded?.path);
  };
  const assistantImages = message.role === 'assistant' ? assistantImageAttachments(message) : [];
  const userImages: Attachment[] = message.role === 'user' ? [
    ...(message.attachments?.filter(attachment=>attachment.isImage) || []),
    ...(message.dshAttachments || []).flatMap((part,index)=>part.type === 'image' ? [{
      name:part.name || message.dshAttachmentNames?.[index] || '图片附件',path:'',mimeType:part.mediaType,
      size:Math.floor(part.data.length * 3 / 4),isImage:true,previewUrl:`data:${part.mediaType};base64,${part.data}`,
    }] : []),
  ] : [];
  // 点击气泡里的会话引用：切到对应会话（会话可能已被删除，找不到就提示）
  const openMessageSession = (title: string) => actions.openMessageSession(message, title);
  return (
  <div
    className={`message-row ${message.role}`}
    // key 用稳定的消息 id：此前拼 createdAt-index，任务收尾改写 createdAt 会让
    // 流式期间建好的整棵子树（高亮代码、mermaid 图）整体卸载重建
    // 旧版唤醒收尾曾给用户和助手写入同一个 id；按角色区分以兼容这些历史记录。
    key={`${message.role}:${message.id || `${message.createdAt}-${index}`}`}
    ref={(node) => actions.bindMessageRow(node, index, turnIndex, message.role === "user")}
  >
    {message.role === "system" ? null : message.role === "user" ? (
      <>
        <div className="user-message-stack">
          {/* 图片附件独立展示在气泡上方（微信风格方形缩略图），不与文本混排在气泡里 */}
          {Boolean(userImages.length) && (
            <div className="message-attachments">
              {userImages.map((attachment,index) => (
                attachment.path || attachment.previewUrl ? (
                  <ImageAttachmentView
                    key={`${message.createdAt}-${index}-${attachment.path || attachment.previewUrl}`}
                    attachment={attachment}
                    onPreview={(payload) => actions.openImagePreview(payload, userImages)}
                  />
                ) : (
                  <span key={`${message.createdAt}-${attachment.path}`}>
                    <FileImage size={13} />
                    图片
                  </span>
                )
              ))}
            </div>
          )}
          {bubbleHasContent && (
          <div
            className={`user-bubble${isEditing ? " editing" : ""}${isVoiceMessage(message) ? " voice-wrapper" : ""}${bubbleBare ? " bare" : ""}`}
            onContextMenu={(event) => actions.handleMessageContextMenu(event, message)}
          >
          {!!message.dshAttachmentNames?.length && <span className="message-inline-refs" aria-label="已发送的插件附件">
            {message.dshAttachmentNames.map((name,at)=><span className="ref-chip" key={at}><FileText size={13} /><span>{name}</span></span>)}
          </span>}
          {Boolean(legacySkillChips.length || message.attachments?.some((attachment) => !attachment.isImage && !attachment.inlineRef && !isVoiceAttachment(attachment))) && (
            <span className="message-inline-refs">
              {/* /技能名 已内联随正文高亮；这里只兜底旧消息（正文无 token）和手动添加的附件 chip */}
              {legacySkillChips.map((name) => (
                <span key={`${message.createdAt}-${name}`} className="ref-chip" title={`引用技能 /${name}`}>
                  <Package size={13} />
                  <span>{name}</span>
                </span>
              ))}
              {/* @token 内联引用已随正文高亮展示，这里只渲染手动添加的附件 chip */}
              {message.attachments?.filter((attachment) => !attachment.isImage && !attachment.inlineRef && !isVoiceAttachment(attachment)).map((attachment) => (
                <span key={`${message.createdAt}-${attachment.path}`} className="ref-chip" title={attachment.path}>
                  {/\.[cm]?[jt]sx?$/i.test(attachment.name) ? <FileCode2 size={13} /> : <FileText size={13} />}
                  <span>{attachment.name}</span>
                </span>
              ))}
            </span>
          )}
          {isVoiceMessage(message) ? (
            <VoiceMessageBubble
              message={message}
              playingPath={playingVoicePath}
              loadingPath={voiceLoadingPath}
              onTogglePlay={actions.togglePlayVoice}
              tokenNames={inlineTokenNames}
              skillNames={messageSkillNames}
              onFileToken={openMessageFile}
            />
          ) : (
            <ClampedUserText
              text={messageVisibleText(message)}
              tokenNames={inlineTokenNames}
              skillNames={messageSkillNames}
              onFileToken={openMessageFile}
              sessionTitles={messageSessionTitles}
              onSessionToken={openMessageSession}
              pluginReferences={message.pluginReferences}
              onPluginReference={ref => actions.openPluginReference(sessionId, ref)}
            />
          )}
          {Boolean(message.pasteBlocks?.length) && <MessagePasteBlocks blocks={message.pasteBlocks!} />}
          {Boolean(message.annotations?.length) && <MessageAnnotationChip annotations={message.annotations!} />}
          </div>
          )}
          <div className="message-actions user" aria-label="用户消息操作">
            <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
            <button type="button" onClick={() => void actions.copyMessage(message)} aria-label="复制消息" title="复制消息">
              <Copy size={16} />
            </button>
            {!activeTaskRunning && (
              <button type="button" onClick={() => actions.startMessageEdit(message, index)} aria-label="编辑消息" title="编辑消息">
                <Pencil size={16} />
              </button>
            )}
          </div>
        </div>
      </>
    ) : (
      <div className="assistant-message" onContextMenu={(event) => actions.handleMessageContextMenu(event, message)}>
          <ProcessTimeline
          message={message}
          messageIndex={index}
          isStreaming={activeTaskRunning && !message.taskStatus && isStreamingMessage}
          collapsedActivities={collapsedActivities}
          onToggleCollapse={actions.toggleActivityCollapse}
        />
        {message.content && !liveOutputInProcess && (
          <InteractiveMessage
            content={stripControlMarkersCached(message.content)}
            streaming={isStreamingMessage}
          />
        )}
        {assistantImages.length > 0 && <div className="message-attachments" aria-label="助手返回的图片">
          {assistantImages.map((attachment, imageIndex) => <ImageAttachmentView key={imageIndex}
            attachment={attachment} onPreview={payload => actions.openImagePreview(payload, assistantImages)} />)}
        </div>}
        {/* 改动文件卡片固定放在最后（对标 Codex：过程折叠条 → 结论 → 修改的文件） */}
        {Boolean(message.changes?.length) && (
          <ChangesSummary
            changes={message.changes!}
            workspacePath={workspacePath}
            onOpenReview={actions.openReview}
          />
        )}
        {!hideAssistantActions && (
          <div className="message-actions assistant" aria-label="助手消息操作">
            {Boolean(messageVisibleText(message).trim()) && (
              <button
                type="button"
                onClick={() => void actions.toggleSpeakMessage(message)}
                aria-label={speakingMessageKey === speakMessageKey(message) || speakingLoadingKey === speakMessageKey(message) ? "停止朗读" : "朗读回复"}
                title={speakingMessageKey === speakMessageKey(message) || speakingLoadingKey === speakMessageKey(message) ? "停止朗读" : "朗读回复"}
              >
                {speakingLoadingKey === speakMessageKey(message)
                  ? <LoaderCircle className="spin" size={16} />
                  : speakingMessageKey === speakMessageKey(message)
                    ? <Square size={16} />
                    : <Volume2 size={16} />}
              </button>
            )}
            <button type="button" onClick={() => void actions.copyMessage(message)} aria-label="复制消息" title="复制消息">
              <Copy size={16} />
            </button>
            <button type="button" onClick={() => actions.forkSessionAt(sessionId, index)} aria-label="从此处分叉新会话" title="从此处分叉：把会话开头到这里的对话复制为新会话">
              <ForkBranchIcon size={16} />
            </button>
            <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
            <span className="ai-disclaimer">由AI生成，请注意甄别</span>
          </div>
        )}
      </div>
    )}
  </div>
  );
});
