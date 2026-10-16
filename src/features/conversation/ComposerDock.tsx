// 输入区 dock：从 ConversationPane 抽出的 <div className="composer-dock"> 整段
// （状态提示 toast、待发送列表、目标横幅、项目栏、粘贴折叠、注释条、附件条、
// 输入框与镜像层、工具栏、模型/审批菜单、语音与发送按钮、回到底部按钮）。
// 机械搬运，不改类名/文案/aria；所有状态与回调仍由 App 经 ConversationPane 传入。
import { ArrowDown, ArrowUp, AtSign, Check, ChevronDown, CornerUpLeft, FileCode2, FileText, Folder, FolderOpen, GitBranch, LoaderCircle, MessageSquare, Mic, Moon, MoreHorizontal, Paperclip, Pencil, Play, Plus, Settings, Slash, Square, Trash2, X } from "lucide-react";
import { ContextRing } from "../usage/UsagePanels";
import { composerApprovalModes } from "../plans/PlansPanel";
import { displayWorkspace, messageVisibleText, shortTitle } from "../../lib/text";
import { renderInlineTokens } from "../message/ClampedText";
import { DshComposer } from "../../DshComposer";
import { GoalBanner } from "../../GoalBanner";
import { PlanProgress } from "../../PlanProgress";
import { ModsPanelView } from "../../ModsPluginsPage";
import { ReasoningControl } from "../../ReasoningControl";
import { ImageAttachmentThumb } from "../../ImageAttachment";
import { PluginSlotView } from "../../PluginSlotView";
import { formatWakeTime } from "../../wakeNote";
import { clientHost } from "../../pluginRuntime/clientHostSingleton.ts";
import { getModelReasoningConfig, reasoningModelKey, updateReasoningOverride } from "../../../electron/model-reasoning.ts";
import type { ConversationPaneProps } from "./ConversationPane";

export type ComposerDockProps = Pick<ConversationPaneProps,
  | "setComposerDockNode" | "error" | "activeSessionError" | "setError" | "clearSessionError"
  | "notice" | "activeSessionNotice" | "setNotice" | "clearSessionNotice"
  | "activeSession" | "activeId" | "activeSleeping" | "activeTaskRunning" | "activeScheduledRun"
  | "activeQueuedMessages" | "resumeSleepingTask" | "cancelSleepingTask"
  | "runQueuedMessageNow" | "removeQueuedMessage" | "setQueueMenuRunId" | "queueMenuRunId"
  | "startMessageEdit" | "copyMessage" | "handleGoalAction"
  | "chooseWorkspace" | "composerWorkspacePath" | "workspacePath" | "workspaceContext" | "clearWorkspace"
  | "streamingAssistantIndex"
  | "composerDragActive" | "handleComposerDragOver" | "handleComposerDragLeave" | "handleComposerDrop"
  | "editingMessage" | "queuedRunIds" | "cancelQueuedMessage" | "cancelMessageEdit"
  | "mentionMenu" | "mentionItems" | "mentionIndex" | "setMentionIndex" | "applyMention"
  | "composerPastes" | "setComposerPastes" | "expandedPasteId" | "setExpandedPasteId"
  | "annotations" | "setAnnotations" | "openAnnotationList" | "scheduleCloseAnnotationList"
  | "annotationListOpen" | "setAnnotationListOpen" | "setAnnotationEditor"
  | "attachments" | "setAttachments" | "openImagePreview"
  | "composerSessionId" | "composer" | "textareaRef" | "updateComposer" | "syncComposerDerivedState"
  | "onComposerKeyDown" | "handleComposerContextMenu" | "handleComposerPaste" | "composingRef" | "composerMirrorRef"
  | "activeTokenNames" | "activeSkillNames" | "activeSessionTitles"
  | "addMenuOpen" | "setAddMenuOpen" | "chooseAttachments"
  | "approvalMenuOpen" | "setApprovalMenuOpen" | "approvalMode" | "activeApprovalMode" | "ActiveApprovalIcon" | "selectApprovalMode"
  | "contextUsage"
  | "modelMenuOpen" | "setModelMenuOpen" | "settings" | "hasModel" | "ensureComposerModels" | "composerEffortLabel"
  | "activateModelProfile" | "composerModelsLoading" | "composerModels" | "switchComposerModel"
  | "saveProviderSettings" | "setSettingsTab" | "setSettingsOpen"
  | "voiceState" | "toggleVoiceInput"
  | "canSend" | "sendMessage" | "runningRunIdsRef"
  | "atBottom" | "viewportRef"
>;

export function ComposerDock(props: ComposerDockProps) {
  const {
    setComposerDockNode, error, activeSessionError, setError, clearSessionError,
    notice, activeSessionNotice, setNotice, clearSessionNotice,
    activeSession, activeId, activeSleeping, activeTaskRunning, activeScheduledRun,
    activeQueuedMessages, resumeSleepingTask, cancelSleepingTask,
    runQueuedMessageNow, removeQueuedMessage, setQueueMenuRunId, queueMenuRunId,
    startMessageEdit, copyMessage, handleGoalAction,
    chooseWorkspace, composerWorkspacePath, workspacePath, workspaceContext, clearWorkspace,
    streamingAssistantIndex,
    composerDragActive, handleComposerDragOver, handleComposerDragLeave, handleComposerDrop,
    editingMessage, queuedRunIds, cancelQueuedMessage, cancelMessageEdit,
    mentionMenu, mentionItems, mentionIndex, setMentionIndex, applyMention,
    composerPastes, setComposerPastes, expandedPasteId, setExpandedPasteId,
    annotations, setAnnotations, openAnnotationList, scheduleCloseAnnotationList,
    annotationListOpen, setAnnotationListOpen, setAnnotationEditor,
    attachments, setAttachments, openImagePreview,
    composerSessionId, composer, textareaRef, updateComposer, syncComposerDerivedState,
    onComposerKeyDown, handleComposerContextMenu, handleComposerPaste, composingRef, composerMirrorRef,
    activeTokenNames, activeSkillNames, activeSessionTitles,
    addMenuOpen, setAddMenuOpen, chooseAttachments,
    approvalMenuOpen, setApprovalMenuOpen, approvalMode, activeApprovalMode, ActiveApprovalIcon, selectApprovalMode,
    contextUsage,
    modelMenuOpen, setModelMenuOpen, settings, hasModel, ensureComposerModels, composerEffortLabel,
    activateModelProfile, composerModelsLoading, composerModels, switchComposerModel,
    saveProviderSettings, setSettingsTab, setSettingsOpen,
    voiceState, toggleVoiceInput,
    canSend, sendMessage, runningRunIdsRef,
    atBottom, viewportRef,
  } = props;
  return (
        <div className="composer-dock" ref={setComposerDockNode}>
          {(error || activeSessionError) && (
            <div className="status-toast error" role="alert">
              <span className="status-toast-text">{error || activeSessionError}</span>
              <button
                type="button"
                className="status-toast-dismiss"
                onClick={() => {
                  setError("");
                  if (activeSession?.id) clearSessionError(activeSession.id);
                }}
                title="关闭提示"
                aria-label="关闭提示"
              >
                ×
              </button>
            </div>
          )}
          {(notice || activeSessionNotice) && (
            <div className="status-toast" role="status">
              <span className="status-toast-text">{notice || activeSessionNotice}</span>
              <button
                type="button"
                className="status-toast-dismiss"
                onClick={() => {
                  setNotice("");
                  if (activeSession?.id) clearSessionNotice(activeSession.id);
                }}
                title="关闭提示"
                aria-label="关闭提示"
              >
                ×
              </button>
            </div>
          )}
          {/* 待发送列表：排队消息与挂起唤醒提示都独立成卡，统一收在输入框上方。
              输入框只负责正在编辑的这一条，不再和它们挤在同一张卡片里（对照 Codex） */}
          {(activeSleeping || (activeTaskRunning && activeQueuedMessages.length > 0)) && (
            <div className="composer-pending" aria-label="待发送列表">
              {activeSleeping && (
                <div className="sleep-card" role="status" aria-label="任务已挂起">
                  <Moon size={14} className="sleep-card-icon" />
                  <span className="sleep-card-text">
                    任务已挂起，将于 <strong>{formatWakeTime(activeSleeping.wakeAt)}</strong> 自动唤醒继续
                    {activeSleeping.reason ? `（原因：${activeSleeping.reason}）` : ""}；期间不再接收新消息
                  </span>
                  <span className="sleep-card-actions">
                    <button
                      type="button"
                      className="sleep-card-button primary"
                      onClick={() => activeSession && void resumeSleepingTask(activeSession.id)}
                    >
                      立即继续
                    </button>
                    <button
                      type="button"
                      className="sleep-card-button"
                      onClick={() => activeSession && void cancelSleepingTask(activeSession.id)}
                    >
                      取消唤醒
                    </button>
                  </span>
                </div>
              )}
              {activeTaskRunning && activeQueuedMessages.length > 0 && (
                <div className="queue-card" role="status" aria-label="待发送的消息">
                  <div className="queue-card-head">
                    <span className="queue-card-title">待发送</span>
                    <span className="queue-card-count">{activeQueuedMessages.length} 条</span>
                    <span className="queue-card-hint">当前任务结束后依次执行</span>
                  </div>
                  {activeQueuedMessages.map((entry) => (
                    <div className="queue-card-row" key={entry.message.runId}>
                      <CornerUpLeft size={14} className="queue-card-icon" />
                      <span className="queue-card-text" title={messageVisibleText(entry.message)}>
                        {messageVisibleText(entry.message)}
                      </span>
                      <span className="queue-card-actions">
                        <button
                          type="button"
                          className="queue-card-steer"
                          onClick={() => void runQueuedMessageNow(entry)}
                          title="停下当前任务，立即执行这条消息"
                        >
                          <Play size={13} />
                          立即执行
                        </button>
                        <button
                          type="button"
                          className="icon-button subtle tiny"
                          onClick={() => void removeQueuedMessage(entry.message.runId || "", entry.messageIndex)}
                          aria-label="删除这条排队消息"
                          title="删除这条排队消息"
                        >
                          <Trash2 size={14} />
                        </button>
                        <span className="queue-card-more-wrap" data-menu-root>
                          <button
                            type="button"
                            className="icon-button subtle tiny"
                            onClick={() => setQueueMenuRunId((current) => current === entry.message.runId ? null : entry.message.runId || null)}
                            aria-label="排队消息更多操作"
                            title="更多操作"
                            aria-expanded={queueMenuRunId === entry.message.runId}
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          {queueMenuRunId === entry.message.runId && (
                            <div className="session-menu queue-card-menu" role="menu">
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setQueueMenuRunId(null);
                                  // 原地编辑：保持排队位置，开始执行时按新内容运行
                                  startMessageEdit(entry.message, entry.messageIndex);
                                }}
                              >
                                编辑内容（保持排队位置）
                              </button>
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setQueueMenuRunId(null);
                                  void copyMessage(entry.message);
                                }}
                              >
                                复制内容
                              </button>
                            </div>
                          )}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {activeSession?.goal && activeSession.goalState?.status !== 'complete' && <GoalBanner key={`${activeSession.id}:${activeSession.goalState?.id || 'legacy'}`}
            session={activeSession} busy={activeTaskRunning} onAction={(action) => handleGoalAction(activeSession.id, action)} />}
          {!activeSession?.messages.length && <div className="composer-project-bar" aria-label="当前工作上下文">
            <div className="composer-project-selection">
              <button type="button" className="composer-project-button" onClick={() => void chooseWorkspace()}
                title={composerWorkspacePath || "选择工作文件夹"}>
                <Folder size={16} /><span>{composerWorkspacePath ? workspaceContext?.name || displayWorkspace(composerWorkspacePath) : "选择项目"}</span>
              </button>
              {composerWorkspacePath && <button type="button" className="icon-button subtle tiny" onClick={clearWorkspace}
                aria-label="移除当前工作目录" title="不在项目中工作"><X size={13} /></button>}
            </div>
            {workspaceContext?.branch && <span className="composer-context-item composer-project-branch"><GitBranch size={15} /><span>{workspaceContext.branch}</span></span>}
          </div>}
          <PlanProgress running={activeTaskRunning} message={activeSession?.messages[streamingAssistantIndex]} />
          <div
            className={`composer-card ${composerDragActive ? "drag-over" : ""}`}
            onDragOver={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
          >
            {editingMessage?.sessionId === activeSession?.id && (
              <div className="message-editing-banner" role="status">
                <Pencil size={13} />
                <span>正在编辑：{shortTitle(messageVisibleText(editingMessage.original))}</span>
                {editingMessage.original.runId && queuedRunIds.has(editingMessage.original.runId) && (
                  <button type="button" className="danger" onClick={() => void cancelQueuedMessage()}>取消排队</button>
                )}
                <button type="button" onClick={cancelMessageEdit}>取消编辑</button>
              </div>
            )}
            {mentionMenu && (
              <div className="mention-menu" role="listbox">
                {activeSession?.runtime === 'dsh' && clientHost().inputHeaders(activeSession.id).map(crumb => (
                  <button key={`${crumb.source}:${crumb.index}`} type="button" className="plugin-input-crumb" disabled={crumb.current}
                    aria-label={`返回 ${crumb.label}`} onClick={() => clientHost().pickInputCrumb(activeSession.id, crumb.source, crumb.index)}>{crumb.label}</button>
                ))}
                {mentionItems.length ? mentionItems.map((item, index) => (
                  <button
                    key={item.id}
                    role="option"
                    aria-selected={index === mentionIndex}
                    className={index === mentionIndex ? "active" : ""}
                    onMouseEnter={() => setMentionIndex(index)}
                    onClick={() => applyMention(index)}
                  >
                    <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                  </button>
                )) : (
                  <p className="mention-empty">{mentionMenu.kind === "slash" ? "没有匹配的技能" : "没有匹配的会话或文件"}</p>
                )}
              </div>
            )}
            {activeSession?.runtime === 'dsh' && clientHost().inputClaim(activeSession.id) && (
              <p className="plugin-input-claim" role="status">命令：{clientHost().inputClaim(activeSession.id)?.name}
                {clientHost().inputClaim(activeSession.id)?.invalid ? ' · 插件已停用，请重新选择' : clientHost().inputClaim(activeSession.id)?.hint ? ` · ${clientHost().inputClaim(activeSession.id)?.hint}` : ''}</p>
            )}
            {composerPastes.length > 0 && (
              <div className="composer-paste-folds">
                {composerPastes.map((block) => {
                  const expanded = expandedPasteId === block.id;
                  return (
                    <div className={`paste-fold${expanded ? " expanded" : ""}`} key={block.id}>
                      <div className="paste-fold-header">
                        <FileText size={14} />
                        <button
                          type="button"
                          className="paste-fold-toggle"
                          onClick={() => setExpandedPasteId(expanded ? "" : block.id)}
                          aria-expanded={expanded}
                        >
                          已折叠长文本 · {block.text.length.toLocaleString()} 字 · {expanded ? "收起" : "展开查看"}
                        </button>
                        <button
                          type="button"
                          className="paste-fold-remove"
                          onClick={() => setComposerPastes((current) => current.filter((item) => item.id !== block.id))}
                          aria-label="移除长文本"
                        >
                          <X size={13} />
                        </button>
                      </div>
                      {expanded && <pre className="paste-fold-preview">{block.text}</pre>}
                    </div>
                  );
                })}
              </div>
            )}
            {annotations.length > 0 && (
              <div
                className="annotation-strip"
                onMouseEnter={openAnnotationList}
                onMouseLeave={scheduleCloseAnnotationList}
              >
                <span className="annotation-chip">
                  <MessageSquare size={13} />
                  <span>{annotations.length} 条注释</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAnnotations([]);
                      setAnnotationListOpen(false);
                      setAnnotationEditor(null);
                    }}
                    aria-label="清空全部注释"
                    title="清空全部注释"
                  >
                    <X size={13} />
                  </button>
                </span>
                {annotationListOpen && (
                  <div className="annotation-list-popup" role="list">
                    {annotations.map((annotation, index) => (
                      <div className="annotation-list-item" key={annotation.id} role="listitem">
                        <span className="annotation-index">{index + 1}。</span>
                        <div className="annotation-item-main">
                          <div className="annotation-item-head">
                            <span className="annotation-field-label">所选文本：</span>
                            <span className="annotation-list-actions">
                              <button
                                type="button"
                                aria-label="编辑评论"
                                title="编辑评论"
                                onClick={(event) => {
                                  setAnnotationListOpen(false);
                                  setAnnotationEditor({ id: annotation.id, x: event.clientX, y: event.clientY });
                                }}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                aria-label="删除该注释"
                                title="删除该注释"
                                onClick={() => {
                                  setAnnotations((current) => current.filter((item) => item.id !== annotation.id));
                                  setAnnotationEditor((current) => current?.id === annotation.id ? null : current);
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </span>
                          </div>
                          <span className="annotation-quote" title={annotation.quote}>{annotation.quote}</span>
                          {annotation.comment.trim() && (
                            <>
                              <span className="annotation-field-label">用户评论：</span>
                              <span className="annotation-comment" title={annotation.comment}>{annotation.comment}</span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div
              className={`attachment-strip${attachments.length ? " has-refs" : ""}`}
              aria-label={attachments.length ? `已选择 ${attachments.length} 项` : undefined}
            >
              {/* 技能引用以 /技能名 内联 token 留在正文里（删 token 即移除），不再单独占一行 chip */}
              {attachments.map((attachment) => (
                <span
                  className={`attachment-chip${attachment.isImage ? " image-attachment-chip" : " ref-attachment-chip"}`}
                  key={attachment.path}
                >
                  {attachment.isImage
                    ? (
                      <ImageAttachmentThumb
                        attachment={attachment}
                        onPreview={(payload) => openImagePreview(payload, attachments.filter((item) => item.isImage))}
                      />
                    )
                    : /\.[cm]?[jt]sx?$/i.test(attachment.name) ? <FileCode2 size={14} /> : <FileText size={14} />}
                  {!attachment.isImage && (
                    <span title={attachment.path}>{attachment.isImage ? "图片" : attachment.name}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((item) => item.path !== attachment.path))}
                    aria-label={`移除附件 ${attachment.name}`}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
              {activeSession && <ModsPanelView sessionId={activeSession.id} />}
              {activeSession?.runtime === 'dsh' && <div className="dsh-input-overlay">
                <PluginSlotView key={activeSession.id} slot="conversation.input.overlay"
                  sessionId={activeSession.id} session={activeSession} hideEmpty />
              </div>}
              <div className="composer-input-wrap">
                {activeSession?.runtime === 'dsh' && composerSessionId !== activeId ? <p role="status">正在恢复本会话输入…</p> : activeSession?.runtime === 'dsh' ? <DshComposer key={activeSession.id} sessionId={activeSession.id}
                  value={composer} inputRef={textareaRef} onChange={updateComposer} onSelect={syncComposerDerivedState}
                  onKeyDown={onComposerKeyDown} onContextMenu={handleComposerContextMenu}
                  onPaste={event => void handleComposerPaste(event)}
                  onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} /> : <>
                {/* 镜像层：渲染在 textarea 之下，给正文里的 @文件/@「会话」token 画内联高亮底色 */}
                <div className="composer-mirror" ref={composerMirrorRef} aria-hidden>
                  {renderInlineTokens(composer, activeTokenNames, activeSkillNames, { keyPrefix: "mirror", sessionTitles: activeSessionTitles })}
                </div>
                <textarea
                  ref={node => { textareaRef.current = node; }}
                  value={composer}
                  onChange={(event) => updateComposer(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                  onPaste={(event) => void handleComposerPaste(event)}
                  onSelect={(event) => {
                    // 光标点击/移动时同步候选菜单：点回 @token//token 后面可重新唤起，移开即关闭。
                    // 这里只同步菜单、不写 composer：React 会把 onSelect 合成到 keydown/keyup，
                    // 而这两个事件派发在 DOM 更新之前，照抄 DOM 会把刚清空的正文写回去
                    // （实测 bug：回车发送后消息已发出、输入框内容还在）
                    if (composingRef.current) return;
                    const target = event.currentTarget;
                    if (target.selectionStart !== target.selectionEnd) return;
                    syncComposerDerivedState(target.value, target.selectionStart ?? target.value.length);
                  }}
                  onContextMenu={handleComposerContextMenu}
                  onKeyDown={onComposerKeyDown}
                  onScroll={(event) => {
                    if (composerMirrorRef.current) composerMirrorRef.current.scrollTop = event.currentTarget.scrollTop;
                  }}
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={() => { composingRef.current = false; }}
                  placeholder="描述要完成的工作"
                  lang="zh-CN"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  rows={2}
                />
                </>}
              </div>
            </div>
            <div className="composer-toolbar">
              <div className="composer-actions">
                <div className="add-menu-wrap" data-menu-root>
                  <button
                    className={`icon-button ${addMenuOpen ? "active" : ""}`}
                    onMouseDown={event => { if (activeSession?.runtime === 'dsh') event.preventDefault(); }}
                    onClick={() => setAddMenuOpen((value) => !value)}
                    aria-label="添加内容"
                    aria-expanded={addMenuOpen}
                  >
                    <Plus size={19} />
                  </button>
                  {addMenuOpen && (
                    <div className="add-menu" role="menu">
                      <button role="menuitem" onClick={() => void chooseWorkspace()}>
                        <FolderOpen size={16} />
                        <span><strong>{workspacePath ? "更换工作文件夹" : "选择工作文件夹"}</strong><small>让 DYWorker 读取项目文件</small></span>
                      </button>
                      <button role="menuitem" onClick={() => void chooseAttachments()}>
                        <Paperclip size={16} />
                        <span><strong>添加附件</strong><small>支持文本、代码和图片</small></span>
                      </button>
                      {activeSession?.runtime === 'dsh' && clientHost().inputSourcesForLaunch().map(source =>
                        <button role="menuitem" key={`input-source:${source.trigger}:${source.name}`}
                          onMouseDown={event => event.preventDefault()} onClick={() => {
                          setAddMenuOpen(false);
                          try { clientHost().toggleInputSource(activeSession.id, source.name, source.trigger); }
                          catch (error) { setNotice(String((error as any)?.message || error)); }
                        }}>
                          {source.trigger === '/' ? <Slash size={16} /> : <AtSign size={16} />}
                          <span><strong>{source.name}</strong><small>{source.trigger === '/' ? '选择插件命令' : '插入插件引用'}</small></span>
                        </button>)}
                    </div>
                  )}
                </div>
                <div className="approval-mode-wrap" data-menu-root>
                  <button
                    type="button"
                    className={`approval-mode-button ${approvalMenuOpen ? "active" : ""} ${approvalMode === "full-access" ? "warning" : ""}`}
                    onClick={() => setApprovalMenuOpen((value) => !value)}
                    aria-haspopup="menu"
                    aria-expanded={approvalMenuOpen}
                    aria-label={activeApprovalMode.label}
                    title={activeApprovalMode.description}
                  >
                    <ActiveApprovalIcon size={15} />
                    <span>{activeApprovalMode.label}</span>
                  </button>
                  {approvalMenuOpen && (
                    <div className="approval-mode-menu" role="menu">
                      <div className="approval-mode-menu-title">应如何批准 DYWorker 操作？</div>
                      {composerApprovalModes.map((option) => {
                        const OptionIcon = option.icon;
                        const selected = option.value === approvalMode;
                        return (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={`${selected ? "selected" : ""} ${option.warning ? "warning" : ""}`}
                            key={option.value}
                            onClick={() => selectApprovalMode(option.value)}
                          >
                            <OptionIcon size={19} />
                            <span>
                              <strong>{option.label}</strong>
                              <small>{option.description}</small>
                            </span>
                            {selected && <Check size={16} className="approval-mode-check" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <ContextRing used={contextUsage.used} limit={contextUsage.limit} exact={contextUsage.exact} stats={activeSession?.tokenStats} />
              </div>
              <div className="composer-actions composer-send-actions">
                <div className="model-menu-wrap" data-menu-root>
                  <button
                    className={`composer-mode ${modelMenuOpen ? "active" : ""}`}
                    title={hasModel ? settings.model : "配置模型"}
                    onClick={() => {
                      if (settings.profiles?.length || settings.endpoint) {
                        setModelMenuOpen((value) => {
                          const next = !value;
                          if (next) ensureComposerModels();
                          return next;
                        });
                      } else {
                        setSettingsTab("model");
                        setSettingsOpen(true);
                      }
                    }}
                    aria-expanded={modelMenuOpen}
                  >
                    <span>{hasModel ? `${settings.model}${composerEffortLabel ? ` · ${composerEffortLabel}` : ""}` : "配置模型"}</span>
                    {hasModel && <ChevronDown size={13} />}
                  </button>
                  {modelMenuOpen && (
                    <div className="model-menu" role="menu">
                      {(settings.profiles || []).length ? (<>
                        <div className="model-menu-title">已保存的模型</div>
                        {(settings.profiles || []).map((profile) => {
                          const active = profile.endpoint === settings.endpoint && profile.model === settings.model;
                          return (
                            <button
                              key={profile.id}
                              type="button"
                              role="menuitem"
                              className={active ? "active" : ""}
                              onClick={() => void activateModelProfile(profile)}
                            >
                              <span>
                                <strong>{profile.name}</strong>
                                <small>{profile.model}</small>
                              </span>
                              {active && <Check size={14} />}
                            </button>
                          );
                        })}
                      </>) : null}
                      {composerModelsLoading ? (
                        <div className="model-menu-title">
                          <LoaderCircle className="spin" size={12} />
                          正在获取此密钥可用的模型…
                        </div>
                      ) : composerModels?.length ? (<>
                        <div className="model-menu-title">此密钥可用的模型</div>
                        {composerModels
                          .filter((item) => !(settings.profiles || []).some((profile) => profile.endpoint === settings.endpoint && profile.model === item.id))
                          .map((item) => {
                            const active = settings.model === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                role="menuitem"
                                className={active ? "active" : ""}
                                onClick={() => void switchComposerModel(item.id)}
                              >
                                <span>
                                  <strong>{item.id}</strong>
                                  {item.contextLimit
                                    ? <small>{item.contextLimit >= 1048576 ? `${Math.round(item.contextLimit / 1048576)}M` : `${Math.round(item.contextLimit / 1024)}K`} 上下文</small>
                                    : null}
                                </span>
                                {active && <Check size={14} />}
                              </button>
                            );
                          })}
                      </>) : null}
                      {hasModel && <>
                        <ReasoningControl key={reasoningModelKey(settings.endpoint, settings.model)}
                          endpoint={settings.endpoint} model={settings.model} effort={settings.reasoningEffort} overrides={settings.reasoningOverrides}
                          onChange={reasoningEffort => void saveProviderSettings({
                            ...settings, reasoningEffort,
                            profiles: settings.profiles.map(profile => profile.endpoint === settings.endpoint && profile.model === settings.model
                              ? { ...profile, reasoningEffort } : profile),
                          }, "思考强度已更新")}
                          onConfigure={async override => {
                            const reasoningOverrides = updateReasoningOverride(settings.reasoningOverrides, settings.endpoint, settings.model, override);
                            const config = getModelReasoningConfig({ endpoint: settings.endpoint, model: settings.model, overrides: reasoningOverrides });
                            const reasoningEffort = config.efforts.includes(settings.reasoningEffort) ? settings.reasoningEffort : "";
                            return saveProviderSettings({ ...settings, reasoningOverrides, reasoningEffort,
                              profiles: settings.profiles.map(profile => reasoningModelKey(profile.endpoint, profile.model) === reasoningModelKey(settings.endpoint, settings.model)
                                ? { ...profile, reasoningEffort } : profile),
                            }, override ? "思考档位已保存" : "已恢复自动识别思考档位");
                          }} />
                        <p className="model-menu-hint">切换模型或思考强度会使已有的提示词缓存失效；介意额外的 token 消耗时，建议新建会话。</p>
                      </>}
                      <button
                        type="button"
                        role="menuitem"
                        className="manage-models"
                        onClick={() => {
                          setModelMenuOpen(false);
                          setSettingsTab("model");
                          setSettingsOpen(true);
                        }}
                      >
                        <Settings size={14} />
                        管理模型配置
                      </button>
                    </div>
                  )}
                </div>

                {/* 语音输入开关：点击开始录音，再次点击结束并转写进输入框 */}
                <button
                  type="button"
                  className={`icon-button voice-button ${voiceState === "recording" ? "recording" : ""} ${voiceState === "transcribing" ? "transcribing" : ""}`}
                  onClick={() => void toggleVoiceInput()}
                  disabled={voiceState === "transcribing"}
                  aria-label={voiceState === "recording" ? "结束录音" : "语音输入"}
                  title={voiceState === "recording" ? "正在录音，再次点击结束" : "语音输入"}
                >
                  {voiceState === "transcribing" ? <LoaderCircle size={19} className="spin" /> : <Mic size={19} />}
                </button>
                {/* 所有入口都登记可取消的运行标识；没有输入时停止，有输入时提交追加要求。 */}
                {activeTaskRunning && !canSend ? (
                    <button
                      className="send-button stop"
                      onClick={() => {
                        if (!activeSession) return;
                        const runId = runningRunIdsRef.current.get(activeSession.id);
                        if (runId) void window.dyworker?.cancelTask(activeSession.id, runId);
                      }}
                      aria-label="停止当前任务"
                      title={activeScheduledRun ? "停止当前计划任务（排队中的消息仍会继续执行）" : "停止当前任务（排队中的消息仍会继续执行）"}
                    >
                      <Square size={14} fill="currentColor" />
                    </button>
                ) : (
                  <button
                    className="send-button"
                    onClick={() => void sendMessage()}
                    disabled={!canSend}
                    aria-label={editingMessage ? "重新发送" : "发送"}
                    title={activeSleeping ? "任务已挂起，请先点【立即继续】或【取消唤醒】" : "Enter 发送"}
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
            </div>
          </div>
          {!atBottom && (
            <button className="jump-bottom" onClick={() => viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" })} aria-label="滚动到底部">
              <ArrowDown size={18} />
            </button>
          )}
        </div>
  );
}
