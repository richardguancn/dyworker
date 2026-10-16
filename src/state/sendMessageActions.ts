// 发消息与排队消息操作（模块级 actions）。
//
// 整组函数原样从 App.tsx 搬出，只是把「读写 state 的裸标识符」改成经 store 的
// getState() 解构拿到，并把跨模块共享的 ref 换成 sharedRefs 里的模块级单例；
// 仍留在 App 的本地实现（createTask / handleGoalAction / refreshMemories / refreshSkills /
// queueDebugLog / appendSessionTraces / playCompletionSound）经 sharedRefs 的回调 ref 调用。
// 函数体、文案与行为均保持不变。
import { formatAnnotationsForPrompt } from "../annotations";
import { patchDshAssistant, reconcileDshTurns } from "../dshTurns";
import { activeGoal, changeGoalStatus, settleGoal, startGoal } from "../goal";
import { appendBranchActivity, patchActivityTree } from "../lib/activity";
import { workspaceFileAttachment } from "../lib/files";
import { FILE_TOKEN_REGEX, SESSION_TOKEN_REGEX, formatSessionReference, pathDirname, shortTitle } from "../lib/text";
import { clientHost } from "../pluginRuntime/clientHostSingleton.ts";
import { modelContextLimit } from "../providers";
import { applyReasoningStream } from "../reasoningStream";
import { recordTaskFailure } from "../taskFailure.ts";
import type { AgentResult, Attachment, ChatMessage, SessionRecord } from "../types";
import { formatWakeTime } from "../wakeNote";
import { resolveTokenFile, resolveTokenSession } from "./composerActions";
import { useComposerStore } from "./composerStore";
import { clearSessionError, clearSessionNotice, refreshPendingWakes, showSessionError, showSessionNotice, updateSession } from "./sessionActions";
import { selectActiveSession, useSessionStore } from "./sessionStore";
import { useSettingsStore } from "./settingsStore";
import { activeIdRef, agentUnsubscribeRefs, appendSessionTracesRef, attachmentsRef, createTaskRef, handleGoalActionRef, mentionTokenPathsRef, playCompletionSoundRef, queueDebugLogRef, queuedRunsRef, refreshMemoriesRef, refreshSkillsRef, runningRunIdsRef, sessionTokenIdsRef, sessionsRef, shouldScrollToBottomRef, textareaRef } from "./sharedRefs";
import { useViewStore } from "./viewStore";

export const markQueued = (sessionId: string, runId: string) => {
  const { setQueuedRunIds } = useViewStore.getState();
  const set = queuedRunsRef.current.get(sessionId) || new Set<string>();
  set.add(runId);
  queuedRunsRef.current.set(sessionId, set);
  setQueuedRunIds((current) => {
    const next = new Set(current);
    next.add(runId);
    return next;
  });
};
export const unmarkQueued = (sessionId: string, runId: string) => {
  const { setQueuedRunIds } = useViewStore.getState();
  const set = queuedRunsRef.current.get(sessionId);
  if (!set) return;
  set.delete(runId);
  if (!set.size) queuedRunsRef.current.delete(sessionId);
  setQueuedRunIds((current) => {
    if (!current.has(runId)) return current;
    const next = new Set(current);
    next.delete(runId);
    return next;
  });
};
export const sessionHasQueued = (sessionId: string) => Boolean(queuedRunsRef.current.get(sessionId)?.size);

export const sendMessage = async (overridePrompt?: string, overrideSessionId?: string, overrideRunId?: string,
  pluginSubmission?: import('../pluginRuntime/conversation').ConversationSubmission, resumeGoal = false) => {
  // 会话 / 运行态：原为 App 渲染闭包里的同名变量，这里按字段归属从 store 快照
  const sessionState = useSessionStore.getState();
  const { sessions, sleepingSessions, runningSessionIds, workspacePath, setSessions, setNewTaskDraft, setRunningSessionIds, setRunningStartedAt, setSleepingSessions, setPendingApprovals, setPendingQuestions, setLoopStates } = sessionState;
  const { composer, attachments, activeSkills, composerPastes, annotations, setComposer, setAttachments, setActiveSkills, setComposerPastes, setAnnotations, setMentionMenu, setExpandedPasteId, setAnnotationListOpen } = useComposerStore.getState();
  const { setNotice, setError, editingMessage, setEditingMessage, queuedRunIds } = useViewStore.getState();
  const { settings, approvalMode } = useSettingsStore.getState();
  const activeSession = selectActiveSession(sessionState);
  const activeTaskRunning = Boolean(activeSession?.id && runningSessionIds.has(activeSession.id));
  if (pluginSubmission) {
    pluginSubmission.signal.throwIfAborted();
    const owned = sessions.find(session => session.id === pluginSubmission.sessionId);
    if (!owned || owned.runtime !== 'dsh') throw new Error('插件会话已关闭，输入未发送');
    if (!settings.identity) throw new Error('请先选择 DYWorker 的使用身份');
    if (!window.dyworker?.sendTask) throw new Error('当前应用没有真实任务发送入口');
    if (!owned.workspacePath) throw new Error('插件会话需要选择工作文件夹');
    if (sleepingSessions[owned.id]) throw new Error('此任务正在等待唤醒，输入已保留');
    if (!pluginSubmission.text.trim() && !pluginSubmission.attachments.length) throw new Error('消息和附件均为空');
  }
  let dshDraft: Awaited<ReturnType<ReturnType<typeof clientHost>['serializeInputDraft']>>;
  if (overridePrompt === undefined && activeSession?.runtime === 'dsh') {
    try {
      if (!clientHost().inputReady(activeSession.id)) throw new Error('引用编辑器正在准备，请稍后重试');
      const scopedInput = clientHost().sessionInput((clientHost().ctx as any).sessions.scope(activeSession.id));
      if (scopedInput.state.getSnapshot().attachmentIds.length) {
        scopedInput.submit('queue', 'enter'); return;
      }
      clientHost().setInputDraft(activeSession.id, composer);
      const owner = activeSession.id; const selected = attachments;
      const current = () => activeIdRef.current === owner && attachmentsRef.current === selected;
      if (await clientHost().matchInputEnter(owner, composer.trim(), {
        count: selected.length, current,
        async serialize(signal) {
          signal.throwIfAborted();
          if (!window.dyworker?.serializeCommandAttachments) throw new Error('当前应用不能传递插件命令附件');
          if (selected.some(file => !file.commandGrantId)) throw new Error('附件需要重新选择后才能交给插件命令');
          const result = await window.dyworker.serializeCommandAttachments({ sessionId: owner, grantIds: selected.map(file => file.commandGrantId!) });
          signal.throwIfAborted();
          if (!result.ok || !result.attachments) throw new Error(result.error || '附件保存失败');
          return result.attachments;
        },
        consume() { if (selected.length && current()) setAttachments([]); },
      }, setNotice)) { setMentionMenu(null); return; }
      dshDraft = await clientHost().serializeInputDraft(activeSession.id);
    } catch (error) { showSessionError(activeSession.id, String((error as any)?.message || error)); return; }
  }
  if (!settings.identity) {
    setNotice("请先选择 DYWorker 的使用身份");
    return;
  }
  const isOverride = typeof overridePrompt === "string";
  const targetSession = overrideSessionId
    ? sessionsRef.current.find((session) => session.id === overrideSessionId) || (pluginSubmission ? undefined : activeSession)
    : activeSession;
  if (!targetSession) return;

  let content = isOverride ? overridePrompt.trim() : (dshDraft?.clipboardText ?? composer).trim();
  const clipboardLeading = (dshDraft?.clipboardText ?? composer).length - (dshDraft?.clipboardText ?? composer).trimStart().length;
  const isPluginReference = (at: number) => dshDraft?.references.some(ref => at + clipboardLeading >= ref.offset && at + clipboardLeading < ref.offset + ref.length);
  if (!isOverride && (!content && !attachments.length && !activeSkills.length && !composerPastes.length && !annotations.length)) return;
  const goalCommand = !isOverride ? content.match(/^\/goal(?:\s+([\s\S]*))?$/i) : null;
  if (goalCommand) {
    const argument = (goalCommand[1] || '').trim();
    const action = ({ '暂停': 'pause', pause: 'pause', '继续': 'resume', resume: 'resume', '取消': 'remove', '清除': 'remove', clear: 'remove', '完成': 'complete' } as const)[argument.toLowerCase() as 'pause'];
    if (!argument || action) {
      setComposer('');
      setMentionMenu(null);
      if (!argument) setNotice(targetSession.goal ? `当前目标：${targetSession.goal}（可在目标栏暂停、继续或删除）` : '用法：/goal 目标描述');
      else await handleGoalActionRef.current(targetSession.id, action);
      return;
    }
    if (targetSession.goal && targetSession.goalState?.status !== 'complete') {
      setNotice('当前还有未完成的目标，请先完成或删除，再创建新目标。');
      return;
    }
  }
  const queueSupported = Boolean(window.dyworker?.sendTask);
  // 任务运行期间仍允许发送：桌面版进入消息队列，等当前任务结束后自动执行
  if (activeTaskRunning && !queueSupported) return;
  // 挂起等待唤醒期间不接收新消息：否则本会话会立刻起第二轮 run，而到点的自动续跑
  // 随后又把老任务的结果追进来，同一个回复框里就出现两个线程（正文互相穿插）
  const targetSleeping = sleepingSessions[targetSession.id];
  if (targetSleeping) {
    setNotice(`${formatWakeTime(targetSleeping.wakeAt)} 将自动唤醒继续；可点输入框上方的「立即继续」提前续跑，或「取消唤醒」后再发送`);
    return;
  }
  const editingTarget = !isOverride && editingMessage?.sessionId === targetSession.id
    ? targetSession.messages[editingMessage.messageIndex]
    : null;
  // 排队中的消息允许编辑：保留原 runId，主进程开始执行时按 runId 取会话里最新内容
  const editingQueuedRunId = editingTarget?.runId && queuedRunIds.has(editingTarget.runId)
    ? editingTarget.runId
    : undefined;

  let goalDriven = false;
  let pastedBlocks = composerPastes;
  let messageAnnotations = annotations;
  let annotationText = "";
  let pastedText = "";
  let selectedAttachments: Attachment[] = [];
  let selectedSkills = activeSkills;
  // @「标题」引用的历史会话：解析出的引用与模型可见的摘要块
  let sessionRefs: Array<{ id: string; title: string }> = [];
  let sessionText = "";

  if (!isOverride) {
    // /new：开启全新会话（对齐渠道快捷指令与斜杠菜单）
    const isPureNewSession = /^(?:\/new|\/reset|new|reset|新建会话|新会话|新任务|重置会话|重置对话|清空上下文)[。.!！?？\s]*$/i.test(content);
    if (isPureNewSession) {
      setComposer("");
      setAttachments([]);
      setActiveSkills([]);
      setComposerPastes([]);
      setAnnotations([]);
      if (targetSession.messages.length === 0) {
        setNotice("当前已是新会话");
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      } else {
        createTaskRef.current();
        setNotice("已开启新会话");
      }
      return;
    }
    if (goalCommand) {
      content = goalCommand[1].trim();
      goalDriven = true;
    }
    setError("");
    setComposer("");
    setComposerPastes([]);
    setExpandedPasteId("");
    setAnnotations([]);
    setAnnotationListOpen(false);
    annotationText = formatAnnotationsForPrompt(messageAnnotations);
    pastedText = pastedBlocks.length
      ? `\n\n${pastedBlocks.map((block, index) => `【粘贴的长文本 ${index + 1}｜共 ${block.text.length} 字】\n${block.text}`).join("\n\n")}`
      : "";
    const tokenAttachments: Attachment[] = [];
    const seenTokenPaths = new Set<string>();
    FILE_TOKEN_REGEX.lastIndex = 0;
    let tokenMatch: RegExpExecArray | null;
    while ((tokenMatch = FILE_TOKEN_REGEX.exec(content))) {
      if (isPluginReference(tokenMatch.index)) continue;
      const file = resolveTokenFile(tokenMatch[1]);
      if (file && !seenTokenPaths.has(file.path)) {
        seenTokenPaths.add(file.path);
        tokenAttachments.push({ ...workspaceFileAttachment(file), inlineRef: true });
      }
    }
    mentionTokenPathsRef.current.clear();
    // @「标题」会话引用：解析出被引会话，尾部摘要块随消息正文发给模型；
    // 气泡按 sessionRefs 高亮 token 并支持点击跳转，完整上下文由模型按 id 自取
    const resolvedSessionRefs: Array<{ id: string; title: string }> = [];
    const sessionBlocks: string[] = [];
    const seenSessionIds = new Set<string>();
    SESSION_TOKEN_REGEX.lastIndex = 0;
    let sessionMatch: RegExpExecArray | null;
    while ((sessionMatch = SESSION_TOKEN_REGEX.exec(content))) {
      if (isPluginReference(sessionMatch.index)) continue;
      const session = resolveTokenSession(sessionMatch[1]);
      if (session && !seenSessionIds.has(session.id)) {
        seenSessionIds.add(session.id);
        resolvedSessionRefs.push({ id: session.id, title: session.title });
        sessionBlocks.push(formatSessionReference(session));
      }
    }
    sessionRefs = resolvedSessionRefs;
    sessionText = sessionBlocks.length ? `\n\n${sessionBlocks.join("\n\n")}` : "";
    sessionTokenIdsRef.current.clear();
    selectedAttachments = [
      ...tokenAttachments,
      ...attachments.filter((attachment) => !seenTokenPaths.has(attachment.path)),
    ];
    setAttachments([]);
    setActiveSkills([]);
    setMentionMenu(null);
  } else {
    pastedBlocks = [];
    messageAnnotations = [];
    selectedAttachments = [];
    selectedSkills = [];
  }

  const taskSessionId = targetSession.id;
  const taskRunId = overrideRunId || crypto.randomUUID();
  const cancelPluginInput = () => { void window.dyworker?.cancelTask(targetSession.id, taskRunId); };
  if (pluginSubmission) { pluginSubmission.signal.throwIfAborted(); pluginSubmission.signal.addEventListener('abort', cancelPluginInput, {once:true}); }
  let queuedResponse = false;
  const messageRunId = editingQueuedRunId || overrideRunId || taskRunId;
  const targetTaskRunning = Boolean(targetSession.id && runningSessionIds.has(targetSession.id));
  const isQueuedEdit = Boolean(editingQueuedRunId);
  const queuedNow = isQueuedEdit || (!editingTarget && targetTaskRunning && queueSupported);
  if (!queueSupported) runningRunIdsRef.current.set(taskSessionId, taskRunId);
  clearSessionError(taskSessionId);
  clearSessionNotice(taskSessionId);
  setRunningSessionIds((current) => {
    const next = new Set(current);
    next.add(taskSessionId);
    return next;
  });
  if (!isQueuedEdit) setRunningStartedAt((current) => ({ ...current, [taskSessionId]: Date.now() }));
  shouldScrollToBottomRef.current = taskSessionId;
  const skillsBlock = selectedSkills.length
    ? `请按照以下技能执行：\n${selectedSkills.map((skill) => {
        const location = skill.path ? `\n技能目录:${pathDirname(skill.path)}(入口文件:${skill.path})` : "";
        return `【${skill.name}】${skill.description}${location}\n执行要求:${skill.instructions}`;
      }).join("\n\n")}\n\n以下是我的任务:\n`
    : "";
  const typedContent = content;
  const modelContent = dshDraft?.references.length ? dshDraft.text : typedContent || (selectedSkills.length ? "（按模板处理当前工作区）" : pastedBlocks.length ? "请处理这段粘贴的长文本。" : messageAnnotations.length ? "请处理以下引用注释。" : "请处理这些附件。");
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    runId: messageRunId,
    content: skillsBlock + modelContent + pastedText + annotationText + sessionText,
    ...(typedContent !== modelContent || selectedSkills.length || pastedBlocks.length || messageAnnotations.length || sessionRefs.length || dshDraft?.references.length ? {
      displayContent: dshDraft?.references.length ? dshDraft.clipboardText : typedContent,
      ...(selectedSkills.length ? { skillsUsed: selectedSkills.map((skill) => skill.name) } : {}),
    } : {}),
    ...(pastedBlocks.length ? { pasteBlocks: pastedBlocks.map((block, index) => ({ id: `paste-${index}`, text: block.text })) } : {}),
    ...(messageAnnotations.length ? { annotations: messageAnnotations } : {}),
    ...(sessionRefs.length ? { sessionRefs } : {}),
    ...(dshDraft?.references.length ? { pluginReferences: dshDraft.references } : {}),
    ...(pluginSubmission?.presentation?.references.length ? {
      displayContent: pluginSubmission.presentation.text, pluginReferences: pluginSubmission.presentation.references,
    } : {}),
    attachments: selectedAttachments,
    ...(pluginSubmission?.attachments.length ? {dshAttachments:[...pluginSubmission.attachments] as ChatMessage['dshAttachments']} : {}),
    ...(pluginSubmission?.attachmentNames?.length ? {dshAttachmentNames:[...pluginSubmission.attachmentNames]} : {}),
    createdAt: new Date().toISOString(),
  };
  const baseMessages = editingTarget && editingMessage
    ? activeSession.messages.slice(0, editingMessage.messageIndex)
    : targetSession.messages;
  const editingQueuedAssistant = isQueuedEdit && editingTarget && editingMessage
    ? targetSession.messages[editingMessage.messageIndex + 1]
    : null;
  const updatedSession: SessionRecord = {
    ...targetSession,
    ...(goalDriven ? startGoal(content) : (resumeGoal || targetSession.goalState?.status === "blocked") ? { goalState: { ...changeGoalStatus(targetSession, "active").goalState!, id: crypto.randomUUID() } } : {}),
    ...(editingTarget ? { workingContext: undefined } : {}),
    title: baseMessages.length === 0 ? shortTitle(content || (pastedBlocks.length ? "粘贴的长文本" : "")) : targetSession.title,
    workspacePath: pluginSubmission ? targetSession.workspacePath : workspacePath || targetSession.workspacePath || "",
    updatedAt: new Date().toISOString(),
    messages: [
      ...baseMessages,
      message,
      ...(editingQueuedAssistant?.role === "assistant" ? [editingQueuedAssistant] : []),
    ],
  };
  setEditingMessage(null);
  // 首条有效消息提交时，才把页面草稿提升为真实会话；在异步发送前同步快照。
  const submittedSessions = sessionsRef.current.some(session => session.id === targetSession.id)
    ? sessionsRef.current.map(session => session.id === targetSession.id ? updatedSession : session)
    : [updatedSession, ...sessionsRef.current];
  sessionsRef.current = submittedSessions;
  setSessions(current => current.some(session => session.id === targetSession.id)
    ? current.map(session => session.id === targetSession.id ? updatedSession : session)
    : [updatedSession, ...current]);
  setNewTaskDraft(current => current?.id === targetSession.id ? null : current);

  if (isQueuedEdit) {
    setNotice("排队中的消息已更新，将在当前任务结束后按新内容执行");
    return;
  }

  let requestAssistantId: string | undefined;
  try {
    if (window.dyworker?.sendTask) {
      const assistantId = crypto.randomUUID();
      requestAssistantId = assistantId;
      let activeDshTurnId: string | undefined;
      const taskStartedAt = Date.now();
      const patchAssistant = (updater: (current: ChatMessage) => ChatMessage) => {
        const turnId = activeDshTurnId;
        updateSession(targetSession.id, (session) => ({
          ...session,
          messages: patchDshAssistant(session.messages,{assistantId,runId:messageRunId,turnId},updater),
        }));
      };
      updateSession(targetSession.id, (session) => ({
        ...session,
        messages: [...session.messages, {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          activities: [],
          runId: messageRunId,
          taskStatus: queuedNow ? "queued" : undefined,
        }],
      }));
      const applyAgentResult = (result: AgentResult) => {
        patchAssistant((current) => {
          let content = result.finalText || current.content;
          if (result.status === "paused" && result.reason) {
            content = content ? `${content}\n\n**已暂停**：${result.reason}` : `**已暂停**：${result.reason}`;
          } else if (result.status === "sleeping" && result.wake) {
            const sleepNote = `**已主动挂起**：将于 ${formatWakeTime(result.wake.wakeAt)} 自动唤醒继续（原因：${result.wake.reason}）。期间可以关闭应用，到点会照常继续。`;
            content = content ? `${content}\n\n${sleepNote}` : sleepNote;
          } else if (result.status === "cancelled") {
            content = content ? `${content}\n\n已按你的要求停止。` : "已按你的要求停止。";
          } else if (result.status === "error") {
            content = [content,result.reason].filter(Boolean).join("\n\n") || "任务执行出错";
          }
          const plan = result.plan?.length ? result.plan : current.plan;
          return {
            ...current,
            content,
            // 占位气泡创建于消息提交时；这里在任务收尾打点，让气泡时间显示模型回复时间
            createdAt: new Date().toISOString(),
            changes: result.changes?.length ? result.changes : current.changes,
            plan,
            durationMs: Date.now() - taskStartedAt,
            taskStatus: result.status,
            ...(Array.isArray(result.executedMessages) && result.executedMessages.length
              ? { executedMessages: result.executedMessages }
              : {}),
            ...(result.workingContext !== undefined ? { workingContext: result.workingContext } : {}),
          };
        });
        if (result.dshTurns?.length && updatedSession.messages.at(-1)?.id) {
          updateSession(targetSession.id, session => ({...session,messages:reconcileDshTurns(session.messages,result.dshTurns!,{
            userId:updatedSession.messages.at(-1)!.id!,assistantId,runId:messageRunId,
          })}));
        }
        if (result.workingContext !== undefined) {
          updateSession(targetSession.id, (session) => ({ ...session, workingContext: result.workingContext }));
        }
        // 非当前会话在后台完成时标记未读（列表小绿点），点开会话即清除
        if ((result.status === "done" || result.status === "error") && taskSessionId !== activeIdRef.current) {
          updateSession(taskSessionId, (session) => ({ ...session, unread: true }));
        }
        if (result.status === "done" && !result.demo) {
          playCompletionSoundRef.current();
          showSessionNotice(taskSessionId, "任务已完成");
        } else if (result.status === "sleeping" && result.wake) {
          showSessionNotice(taskSessionId, `已挂起，将于 ${formatWakeTime(result.wake.wakeAt)} 自动唤醒继续`);
          // 挂起态以主进程登记为准（这里先给即时反馈，重启后的权威列表由 wakes:list-pending 拉取）
          setSleepingSessions((current) => ({
            ...current,
            [taskSessionId]: {
              sessionId: taskSessionId,
              wakeAt: result.wake!.wakeAt,
              reason: result.wake!.reason || "",
            },
          }));
          // 再回主进程核对一次：没有工作目录等情况下登记会被跳过（到点根本不会唤醒），
          // 只信本地标记会把输入框永久锁死，所以以磁盘上的 pending 列表为准自纠正
          void refreshPendingWakes();
        }
        updateSession(taskSessionId, (session) => settleGoal(session, updatedSession, result));
        if (result.status === 'done' && result.goalAchieved && activeGoal(sessionsRef.current.find(row => row.id === taskSessionId) || updatedSession)) {
          showSessionNotice(taskSessionId, "目标已完成");
        }
      };
      let finishedEventSeen = false;
      // 收尾结果只应用一次：agent-finished 事件与 sendTask 的返回值是两条通道，
      // 谁先到不保证；两边都应用会让"已按你的要求停止。"之类追加重叠出现两遍。
      let agentResultApplied = false;
      const applyAgentResultOnce = (result: AgentResult) => {
        if (agentResultApplied) return;
        agentResultApplied = true;
        applyAgentResult(result);
      };
      const unsubscribeAgent = window.dyworker.onAgentEvent((sessionAgentEvent) => {
        if (sessionAgentEvent.sessionId !== taskSessionId || sessionAgentEvent.runId !== taskRunId) return;
        const agentEvent = sessionAgentEvent.event;
        if (agentEvent.type === "dsh-conversation" && updatedSession.messages.at(-1)?.id) {
          activeDshTurnId = agentEvent.turns.at(-1)?.user.id;
          updateSession(targetSession.id, session => ({...session,messages:reconcileDshTurns(session.messages,agentEvent.turns,{
            userId:updatedSession.messages.at(-1)!.id!,assistantId,runId:messageRunId,live:true,
          })}));
        } else if (agentEvent.type === "activity") {
          // 子代理分支活动（带 branch）挂到父活动（dispatch_agent）的 children 上，
          // 随 message.activities 落盘；不再走单独的全局缓存（会跨会话串数据）
          if (agentEvent.activity.branch) {
            patchAssistant((current) => {
              const { list, attached } = appendBranchActivity(current.activities || [], agentEvent.activity);
              if (!attached) {
                console.warn("子代理分支活动找不到父活动，已丢弃", agentEvent.activity.id);
                return current;
              }
              return { ...current, activities: list };
            });
          } else {
            patchAssistant((current) => ({ ...current, activities: [...(current.activities || []), agentEvent.activity] }));
          }
        } else if (agentEvent.type === "activity-update") {
          // patchActivityTree 同时覆盖主活动与子代理 children，branch 标记无需区分
          patchAssistant((current) => ({
            ...current,
            activities: patchActivityTree(current.activities || [], agentEvent.id, agentEvent.status, agentEvent.detail, agentEvent.durationMs, agentEvent.commentary),
          }));
        } else if (agentEvent.type === "trace") {
          appendSessionTracesRef.current([agentEvent.trace]);
        } else if (agentEvent.type === "assistant-text" && !activeDshTurnId) {
          patchAssistant((current) => ({ ...current, content: agentEvent.text }));
        } else if (agentEvent.type === "assistant-reasoning" && !activeDshTurnId) {
          patchAssistant((current) => applyReasoningStream(current, agentEvent.text));
        } else if (agentEvent.type === "file-change") {
          patchAssistant((current) => ({ ...current, changes: agentEvent.changes }));
        } else if (agentEvent.type === "plan-update") {
          patchAssistant((current) => ({ ...current, plan: agentEvent.steps }));
        } else if (agentEvent.type === "approval-request") {
          setPendingApprovals((current) => ({ ...current, [taskSessionId]: agentEvent.action }));
        } else if (agentEvent.type === "approval-withdrawn") {
          setPendingApprovals(current => {
            if (current[taskSessionId]?.id !== agentEvent.actionId) return current;
            const next = { ...current }; delete next[taskSessionId]; return next;
          });
        } else if (agentEvent.type === "ask-user") {
          setPendingQuestions((current) => ({ ...current, [taskSessionId]: agentEvent.request }));
        } else if (agentEvent.type === "loop-state") {
          setLoopStates((current) => {
            const next = { ...current };
            if (agentEvent.active) {
              next[taskSessionId] = { iteration: agentEvent.iteration, maximum: agentEvent.maximum, status: agentEvent.status };
            } else {
              delete next[taskSessionId];
            }
            return next;
          });
        } else if (agentEvent.type === "queued") {
          markQueued(taskSessionId, taskRunId);
          setRunningSessionIds((current) => {
            const next = new Set(current);
            next.add(taskSessionId);
            return next;
          });
        } else if (agentEvent.type === "queue-start") {
          unmarkQueued(taskSessionId, taskRunId);
          runningRunIdsRef.current.set(taskSessionId, taskRunId);
          setRunningSessionIds((current) => {
            const next = new Set(current);
            next.add(taskSessionId);
            return next;
          });
          setRunningStartedAt((current) => ({ ...current, [taskSessionId]: Date.now() }));
          patchAssistant((current) => ({ ...current, taskStatus: undefined }));
        } else if (agentEvent.type === "memory-saved") {
          void refreshMemoriesRef.current();
          showSessionNotice(taskSessionId, "已保存一条长期记忆");
        } else if (agentEvent.type === "skill-saved") {
          void refreshSkillsRef.current();
          showSessionNotice(taskSessionId, `工作模板「${agentEvent.item.name}」已保存`);
        } else if (agentEvent.type === "skill-updated") {
          void refreshSkillsRef.current();
          showSessionNotice(taskSessionId, `工作模板「${agentEvent.item.name}」已改进`);
        } else if (agentEvent.type === "debug-log") {
          queueDebugLogRef.current(agentEvent.entry);
        } else if (agentEvent.type === "context-usage") {
          const total = agentEvent.total ?? agentEvent.used + agentEvent.completion;
          updateSession(updatedSession.id, (session) => ({
            ...session,
            contextTokens: total,
            contextTokensExact: !agentEvent.estimated,
            contextModel: settings.model,
            contextEndpoint: settings.endpoint,
          }));
        } else if (agentEvent.type === "token-usage") {
          // 会话累计用量：每次模型调用按服务端 usage（或估算）累加，圆环 tooltip 展示
          updateSession(updatedSession.id, (session) => ({
            ...session,
            tokenStats: {
              prompt: (session.tokenStats?.prompt || 0) + (Number(agentEvent.prompt) || 0),
              completion: (session.tokenStats?.completion || 0) + (Number(agentEvent.completion) || 0),
              requests: (session.tokenStats?.requests || 0) + 1,
            },
          }));
        } else if (agentEvent.type === "context-compacted") {
          patchAssistant(current => ({ ...current, activities: [...(current.activities || []), {
            id: crypto.randomUUID(), kind: "commentary", status: "success",
            title: "上下文已压缩", detail: "上下文已压缩，已保留继续任务所需的内容。",
          }] }));
          showSessionNotice(taskSessionId, "上下文已压缩，已保留继续任务所需的内容，任务继续");
        } else if (agentEvent.type === "agent-finished") {
          finishedEventSeen = true;
          unmarkQueued(taskSessionId, taskRunId);
          void refreshMemoriesRef.current();
          applyAgentResultOnce(agentEvent.result);
          if (runningRunIdsRef.current.get(taskSessionId) === taskRunId) {
            runningRunIdsRef.current.delete(taskSessionId);
          }
          if (!runningRunIdsRef.current.has(taskSessionId)) {
            setRunningStartedAt((current) => {
              const next = { ...current };
              delete next[taskSessionId];
              return next;
            });
            setPendingApprovals((current) => {
              const next = { ...current };
              delete next[taskSessionId];
              return next;
            });
            setPendingQuestions((current) => {
              const next = { ...current };
              delete next[taskSessionId];
              return next;
            });
          }
          // 排队消息的监听器一直保留到真正执行完成，这里统一收尾
          const unsubscribe = agentUnsubscribeRefs.current.get(taskRunId);
          agentUnsubscribeRefs.current.delete(taskRunId);
          if (unsubscribe) window.setTimeout(unsubscribe, 1000);
          // 会话是否继续显示运行状态由队列决定：还有排队消息则保持，全部完成才收起
          if (!sessionHasQueued(taskSessionId) && !runningRunIdsRef.current.has(taskSessionId)) {
            setRunningSessionIds((current) => {
              if (!current.has(taskSessionId)) return current;
              const next = new Set(current);
              next.delete(taskSessionId);
              return next;
            });
          }
        }
      });
      agentUnsubscribeRefs.current.set(taskRunId, unsubscribeAgent);
      try {
        // Goal controls and queued runs read the archive; publish the goal before admission.
        if (updatedSession.goal || targetSession.goal) {
          const saved = await window.dyworker.saveSessions({ changed: [updatedSession], removed: [],
            order: sessionsRef.current.map(row => row.id), activeId: activeIdRef.current,
            meta: sessionsRef.current.map(row => ({ id: row.id, channel: row.channel, workspacePath: row.workspacePath })) });
          if (!saved.ok) throw new Error(saved.error || '目标保存失败，请重试');
          const latest = sessionsRef.current.find(row => row.id === taskSessionId);
          if (activeGoal(updatedSession) && (!latest || !activeGoal(latest) || latest.goalState?.id !== updatedSession.goalState?.id)) {
            applyAgentResultOnce({ status: 'cancelled', finalText: '' });
            if (!runningRunIdsRef.current.has(taskSessionId)) setRunningSessionIds(current => {
              const next = new Set(current); next.delete(taskSessionId); return next;
            });
            return;
          }
        }
        const response = await window.dyworker.sendTask({
          settings,
          runtime: updatedSession.runtime,
          workspacePath: pluginSubmission ? targetSession.workspacePath : workspacePath,
          sessionId: updatedSession.id,
          contextLimit: modelContextLimit(settings.model, settings.endpoint),
          workingContext: updatedSession.workingContext,
          goal: activeGoal(updatedSession),
          goalId: updatedSession.goalState?.id,
          messages: updatedSession.messages,
          loop: { enabled: Boolean(activeGoal(updatedSession)), maximum: activeGoal(updatedSession) ? 10 : 1 },
          approvalMode,
          runId: taskRunId,
        });
        if (response.queued) {
          queuedResponse = !finishedEventSeen;
          if (!finishedEventSeen && runningRunIdsRef.current.get(taskSessionId) !== taskRunId) markQueued(taskSessionId, taskRunId);
        } else {
          if (!response.ok || !response.result) throw new Error(response.error || "任务执行失败");
          if (!finishedEventSeen) applyAgentResultOnce(response.result);
        }
      } finally {
        if (!queuedResponse && runningRunIdsRef.current.get(taskSessionId) === taskRunId) {
          runningRunIdsRef.current.delete(taskSessionId);
        }
        // 非排队消息的监听器在此收尾；排队消息由 agent-finished 统一收尾（任务可能尚未开始）
        if (!queuedResponse) {
          // webContents.send 的尾部事件可能晚于 invoke 响应到达，延迟取消订阅避免丢事件
          const unsubscribe = agentUnsubscribeRefs.current.get(taskRunId);
          agentUnsubscribeRefs.current.delete(taskRunId);
          if (unsubscribe) window.setTimeout(unsubscribe, 1000);
        }
        // invoke 的完整结果也能收尾，不能依赖结束事件一定先送达。
        // 若下一项已经开始，则不能清掉新任务的运行状态。
        if (!queuedResponse && !sessionHasQueued(taskSessionId)
          && !runningRunIdsRef.current.has(taskSessionId)) {
          setRunningSessionIds((current) => {
            if (!current.has(taskSessionId)) return current;
            const next = new Set(current);
            next.delete(taskSessionId);
            return next;
          });
        }
        // 排队消息尚未执行，不清理当前任务的循环状态（由 queue-start/agent-finished 维护）
        if (!queuedResponse && !runningRunIdsRef.current.has(taskSessionId)) {
          setLoopStates((current) => {
            const next = { ...current };
            delete next[taskSessionId];
            return next;
          });
        }
      }
    } else {
      let response;
      if (window.dyworker) {
        response = await window.dyworker.completeChat({ settings, messages: updatedSession.messages });
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        response = {
          content:
            "**新任务已进入 Electron 工作区。**\n\n我会继续保持现在的阅读层级和紧凑布局。桌面版接入模型设置后，这里会直接显示真实回复。",
        };
      }
      const assistant: ChatMessage = {
        role: "assistant",
        content: response.content,
        createdAt: new Date().toISOString(),
      };
      shouldScrollToBottomRef.current = taskSessionId;
      updateSession(taskSessionId, (session) => ({
        ...settleGoal(session, updatedSession, { status: "paused", finalText: "", reason: "当前环境仅展示预览，未执行目标。" }),
        updatedAt: assistant.createdAt,
        messages: [...session.messages, assistant],
      }));
    }
  } catch (requestError) {
    const detail = requestError instanceof Error ? requestError.message : String(requestError);
    showSessionError(taskSessionId, detail);
    updateSession(taskSessionId, (session) => ({
      ...settleGoal(session, updatedSession, { status: "error", finalText: "", reason: detail }),
      messages: recordTaskFailure(session.messages, { assistantId: requestAssistantId, runId: messageRunId,
        detail, createdAt: new Date().toISOString() }),
    }));
    if (pluginSubmission) throw requestError;
  } finally {
    pluginSubmission?.signal.removeEventListener('abort', cancelPluginInput);
    if (!queuedResponse && runningRunIdsRef.current.get(taskSessionId) === taskRunId) {
      runningRunIdsRef.current.delete(taskSessionId);
    }
    // 发送失败或响应先到时同样恢复输入状态；排队或新任务仍运行时保留。
    if (!queuedResponse && !sessionHasQueued(taskSessionId) && !runningRunIdsRef.current.has(taskSessionId)) {
      setRunningSessionIds((current) => {
        const next = new Set(current);
        next.delete(taskSessionId);
        return next;
      });
    }
    // 排队消息尚未执行：不清理当前任务的运行态，防止误删正在执行任务的审批/计时
    if (!queuedResponse && !runningRunIdsRef.current.has(taskSessionId)) {
      setRunningStartedAt((current) => {
        const next = { ...current };
        delete next[taskSessionId];
        return next;
      });
      setPendingApprovals((current) => {
        const next = { ...current };
        delete next[taskSessionId];
        return next;
      });
      setPendingQuestions((current) => {
        const next = { ...current };
        delete next[taskSessionId];
        return next;
      });
    }
  }
};

// 从队列移除一条排队消息（同时移除它的空助手占位）
export const removeQueuedMessage = async (runId: string, messageIndex: number, notice = "已删除这条排队消息") => {
  const { queuedRunIds, setNotice } = useViewStore.getState();
  const activeSession = selectActiveSession(useSessionStore.getState());
  if (!activeSession) return;
  const sessionId = activeSession.id;
  if (!runId || !queuedRunIds.has(runId)) return;
  if (window.dyworker?.removeQueuedTask) {
    const result = await window.dyworker.removeQueuedTask({ sessionId, runId });
    if (!result?.ok || result.removed === false) {
      // 队列项可能已开始执行或应用重启后已不存在，仍从会话中移除这条消息
    }
  }
  unmarkQueued(sessionId, runId);
  updateSession(sessionId, (session) => {
    const next = [...session.messages];
    next.splice(messageIndex, 1);
    // 同时移除紧随其后的空助手占位（排队消息尚未开始执行）
    const following = next[messageIndex];
    if (following?.role === "assistant" && following.runId === runId && !following.content) {
      next.splice(messageIndex, 1);
    }
    return { ...session, messages: next };
  });
  setNotice(notice);
};

export const cancelQueuedMessage = async () => {
  const { editingMessage, setEditingMessage } = useViewStore.getState();
  const { setComposer, setAttachments, setActiveSkills } = useComposerStore.getState();
  const activeSession = selectActiveSession(useSessionStore.getState());
  if (!activeSession || !editingMessage) return;
  const runId = editingMessage.original.runId || "";
  await removeQueuedMessage(runId, editingMessage.messageIndex, "已取消这条排队消息");
  setEditingMessage(null);
  setComposer("");
  setAttachments([]);
  setActiveSkills([]);
};

// 立即执行：停下当前任务，这条排队消息插到队首马上运行
// （主进程把它提到队首并取消当前任务，当前任务收尾时自动出队启动）
export const runQueuedMessageNow = async (entry: { message: ChatMessage; messageIndex: number }) => {
  const { setNotice } = useViewStore.getState();
  const activeSession = selectActiveSession(useSessionStore.getState());
  if (!activeSession) return;
  const runId = entry.message.runId || "";
  // 用 ref 取最新排队状态，避免陈旧闭包导致点击被静默忽略
  if (!runId || !queuedRunsRef.current.get(activeSession.id)?.has(runId)) {
    setNotice("这条消息已不在排队中，无法立即执行");
    return;
  }
  // 先给即时反馈，避免主进程切换任务期间看起来像“没反应”
  setNotice("正在停下当前任务，马上执行这条消息…");
  try {
    const result = await window.dyworker?.runQueuedTaskNow({ sessionId: activeSession.id, runId });
    if (result?.ok) {
      setNotice("已停下当前任务，立即执行这条消息");
    } else {
      setNotice(result?.error || "这条消息已不在队列中");
    }
  } catch (error) {
    setNotice(`立即执行失败：${error instanceof Error ? error.message : String(error)}`);
  }
};
