// 任务 / 会话切换与导出相关操作（模块级 actions）。
//
// 整组函数原样从 App.tsx 搬出，只是把「读写 state 的裸标识符」改成经 store 的
// getState() 解构拿到，并把跨模块共享的 ref 换成 sharedRefs 里的模块级单例；
// 仍留在 App 的实现（selectSession）经 sharedRefs 的回调 ref 调用。
// 函数体、文案与行为均保持不变。
import { authoringSkill } from "../../electron/authoring-skills";
import type { ExtensionCreationRequest } from "../ExtensionCreationDialog";
import { activeGoal, changeGoalStatus, startGoal } from "../goal";
import { buildSkillSummaryMessages, buildSkillSummaryTranscript, parseSkillDraft } from "../lib/text";
import { clientHost } from "../pluginRuntime/clientHostSingleton.ts";
import type { SessionRecord, SkillRecord } from "../types";
import { useComposerStore } from "./composerStore";
import { useInboxStore } from "./inboxStore";
import { useLayoutStore } from "./layoutStore";
import { usePanelStore } from "./panelStore";
import { previewWorkspace } from "./previewData";
import { cancelSleepingTask, makeSession, showSessionError, showSessionNotice, updateSession } from "./sessionActions";
import { useSessionStore } from "./sessionStore";
import { sendMessage } from "./sendMessageActions";
import { useSettingsStore } from "./settingsStore";
import { activeIdRef, conversationTurnRefs, runningRunIdsRef, selectSessionRef, sessionDraftsRef, sessionsRef, shouldScrollToBottomRef, textareaRef } from "./sharedRefs";
import { useViewStore } from "./viewStore";

// hover 弹层延迟关闭计时器：随这组开关函数从 App.tsx 的 useRef 挪到模块级
const annotationListCloseTimerRef = { current: 0 };
export const openAnnotationList = () => {
  const { setAnnotationListOpen } = useComposerStore.getState();
  window.clearTimeout(annotationListCloseTimerRef.current);
  setAnnotationListOpen(true);
};
export const scheduleCloseAnnotationList = () => {
  const { setAnnotationListOpen } = useComposerStore.getState();
  window.clearTimeout(annotationListCloseTimerRef.current);
  annotationListCloseTimerRef.current = window.setTimeout(() => setAnnotationListOpen(false), 200);
};

export const toggleTerminal = () => {
  const { terminalAvailable, setTerminalMounted, setTerminalOpen } = useLayoutStore.getState();
  const { setNotice } = useViewStore.getState();
  if (!terminalAvailable) { setNotice("请先启用内置终端插件。"); return; }
  setTerminalMounted(true);
  setTerminalOpen(value => !value);
};

export const sessionPendingInboxCount = (sessionId: string) => {
  const { inboxItems } = useInboxStore.getState();
  return inboxItems.filter((item) => item.status === "pending" && item.sessionId === sessionId).length;
};

// 切换会话/工作区时关掉旧工作区的审阅标签页（内容已过期）
export const closeFilePanelTabs = () => {
  const { toolPanelTabs, setToolPanelTabs, activeToolPanelTabId, setActiveToolPanelTabId, setToolPanelMenuOpen } = useLayoutStore.getState();
  if (!toolPanelTabs.some((tab) => tab.kind === "review")) return;
  const kept = toolPanelTabs.filter((tab) => tab.kind !== "review");
  setToolPanelTabs(kept);
  if (!kept.some((tab) => tab.id === activeToolPanelTabId)) setActiveToolPanelTabId(kept[0]?.id || "");
  if (kept.length === 0) setToolPanelMenuOpen(true);
};

export const applyWorkspaceSelection = (targetWorkspacePath: string) => {
  const { setWorkspacePath, workspacePath, setWorkspaceEntries } = useSessionStore.getState();
  const { setWorkspaceMenuPath, setWorkspaceOpen, setWorkspaceGroupOpen } = useLayoutStore.getState();
  setWorkspacePath(targetWorkspacePath);
  setWorkspaceMenuPath(null);
  if (targetWorkspacePath) {
    setWorkspaceOpen(true);
    setWorkspaceGroupOpen((current) => ({ ...current, [targetWorkspacePath]: true }));
    if (targetWorkspacePath !== workspacePath) {
      if (window.dyworker?.refreshWorkspace) {
        void window.dyworker.refreshWorkspace(targetWorkspacePath).then(setWorkspaceEntries).catch(() => setWorkspaceEntries([]));
      } else {
        setWorkspaceEntries(targetWorkspacePath === "/workspace/dyworker" ? previewWorkspace : []);
      }
    }
  } else {
    setWorkspaceEntries([]);
  }
};

export const createTask = (targetWorkspacePath = useSessionStore.getState().workspacePath) => {
  const { setPluginsPageOpen, setBotTeamPageOpen, setConversationView } = useLayoutStore.getState();
  const { newTaskDraft, setActiveId, setNewTaskDraft } = useSessionStore.getState();
  const { setActiveSkills, setComposer, setAttachments } = useComposerStore.getState();
  const { setEditingMessage, setNotice } = useViewStore.getState();
  setPluginsPageOpen(false);
  setBotTeamPageOpen(false);
  setConversationView("chat");
  const nextWorkspacePath = String(targetWorkspacePath || "");
  if (newTaskDraft) {
    setActiveId(newTaskDraft.id);
    updateSession(newTaskDraft.id, draft => ({ ...draft, workspacePath: nextWorkspacePath }));
    applyWorkspaceSelection(nextWorkspacePath);
    setActiveSkills([]);
    setEditingMessage(null);
    closeFilePanelTabs();
    setNotice("");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
    return;
  }

  // 新任务继承当前工作目录，避免切换新会话后助手提示要先选目录；
  // 每个会话仍可在顶部或“+”菜单单独更换或移除工作目录。
  const session = makeSession(nextWorkspacePath);
  setNewTaskDraft(session);
  setActiveId(session.id);
  applyWorkspaceSelection(nextWorkspacePath);
  setComposer("");
  setAttachments([]);
  setActiveSkills([]);
  setEditingMessage(null);
  closeFilePanelTabs();
  setNotice("");
  window.setTimeout(() => textareaRef.current?.focus(), 0);
};

export const prepareExtensionCreation = ({ kind, requirement, workspacePath: targetDirectory }: ExtensionCreationRequest) => {
  const { skills } = usePanelStore.getState();
  const { setSessions, setActiveId } = useSessionStore.getState();
  const { setActiveSkills, setMentionMenu } = useComposerStore.getState();
  const { setEditingMessage, setNotice } = useViewStore.getState();
  const { setCreationKind } = usePanelStore.getState();
  const { setSettingsOpen, setPluginsPageOpen, setConversationView } = useLayoutStore.getState();
  const bundled = authoringSkill(kind);
  const creator: SkillRecord = skills.find(item => item.id === bundled.id) || {
    ...bundled, enabled: true, builtIn: true, source: 'builtin', sourceLabel: '内置', createdAt: new Date().toISOString(),
  };
  const session = { ...makeSession(targetDirectory), title: kind === 'plugin' ? '制作插件' : '制作技能' };
  const text = `/${creator.name}\n请根据以下需求制作${kind === 'plugin' ? 'DYWorker 插件' : '可复用技能'}，完成后实际检查并说明如何使用。\n\n${requirement}`;
  // 先登记新会话的草稿，避免会话切换时的草稿恢复覆盖制作需求。
  sessionDraftsRef.current[session.id] = { text, pastes: [], annotations: [], attachments: [] };
  setSessions(current => [session, ...current]);
  setActiveId(session.id);
  setActiveSkills([creator]);
  setEditingMessage(null);
  setMentionMenu(null);
  setCreationKind(null);
  setSettingsOpen(false);
  setPluginsPageOpen(false);
  setConversationView('chat');
  applyWorkspaceSelection(targetDirectory);
  setNotice('制作需求已准备，发送后开始制作。');
  window.setTimeout(() => textareaRef.current?.focus(), 0);
};

// 从指定消息处分叉：复制会话开头到该消息(含)的内容为新会话，原会话保持不变（对照 Codex fork）
export const forkSession = async (session: SessionRecord, messageIndex: number) => {
  const { setSessions, setActiveId } = useSessionStore.getState();
  const { setNotice } = useViewStore.getState();
  if (session.runtime === 'dsh') {
    try {
      const message = session.messages[messageIndex];
      if (!message?.dshMessageId) throw new Error('这条消息还没有完整保存，请稍后再复制');
      const reply = await window.dyworker?.dshOperation?.({sessionId: '', action: 'session-fork', payload: {
        sourceRootId: session.id, address: {kind: 'session', sessionId: session.id},
        messageId: message.dshMessageId, ...(message.dshTurnId ? {turnId: message.dshTurnId} : {}),
      }});
      if (!reply?.ok || !reply.value?.nativeSession) throw new Error(reply?.error?.message || '复制任务失败');
      const forked = reply.value.nativeSession as SessionRecord;
      clientHost().acceptCreatedSession(forked);
      setSessions(current => [forked, ...current.filter(row => row.id !== forked.id)]);
      selectSessionRef.current(forked);
      shouldScrollToBottomRef.current = forked.id;
      setNotice('已从此处分叉出新任务，可继续独立对话');
    } catch (error) { setNotice(error instanceof Error ? error.message : '复制任务失败'); }
    return;
  }
  const now = new Date().toISOString();
  const forked: SessionRecord = {
    id: crypto.randomUUID(),
    title: `${session.title}（分支）`,
    workspacePath: session.workspacePath,
    ...(session.runtime ? { runtime: session.runtime } : {}),
    ...(session.goal ? { goal: session.goal, goalState: { ...startGoal(session.goal).goalState!, status: "paused", activeSince: undefined } } : {}),
    createdAt: now,
    updatedAt: now,
    messages: session.messages.slice(0, messageIndex + 1).map((message) => ({ ...message })),
  };
  setSessions((current) => [forked, ...current]);
  setActiveId(forked.id);
  shouldScrollToBottomRef.current = forked.id;
  setNotice("已从此处分叉出新任务，可继续独立对话");
};

const goalActionsRef = { current: new Set<string>() };
export const handleGoalAction = async (sessionId: string, action: 'pause' | 'resume' | 'remove' | 'complete') => {
  const { runningSessionIds, setSessions, sleepingSessions } = useSessionStore.getState();
  const session = sessionsRef.current.find(row => row.id === sessionId);
  if (!session?.goal || goalActionsRef.current.has(sessionId)) return;
  if (session.goalState?.status === 'complete' && action !== 'remove') return;
  goalActionsRef.current.add(sessionId);
  try {
    if (action === 'resume') {
      if (runningSessionIds.has(sessionId) || runningRunIdsRef.current.has(sessionId)) {
        showSessionNotice(sessionId, '当前任务结束后可继续目标。');
        return;
      }
      void sendMessage(`继续推进目标：${session.goal}\n先核对已有进展，完成剩余工作并验证结果。`, sessionId, undefined, undefined, true);
      return;
    }
    const next = action === 'remove' ? { ...session, goal: undefined, goalState: undefined }
      : changeGoalStatus(session, action === 'pause' ? 'paused' : 'complete');
    // Persist before cancellation drains the queue, so queued work cannot revive an old goal.
    const updated = sessionsRef.current.map(row => row.id === sessionId ? next : row);
    sessionsRef.current = updated;
    setSessions(updated);
    let saveError = "";
    if (window.dyworker?.saveSessions) {
      const saved = await window.dyworker.saveSessions({ changed: [next], removed: [], order: updated.map(row => row.id),
        activeId: activeIdRef.current, meta: updated.map(row => ({ id: row.id, channel: row.channel, workspacePath: row.workspacePath })) }).catch(error => ({ ok: false, error: String(error) }));
      if (!saved.ok) saveError = saved.error || '目标状态保存失败';
    }
    const runId = runningRunIdsRef.current.get(sessionId);
    if (activeGoal(session) && runId) await window.dyworker?.cancelTask(sessionId, runId);
    if (activeGoal(session) && sleepingSessions[sessionId]) await cancelSleepingTask(sessionId);
    if (saveError) throw new Error(saveError);
    showSessionNotice(sessionId, action === 'pause' ? '目标已暂停' : action === 'remove' ? '目标已删除' : '目标已标记完成');
  } catch (error) {
    showSessionError(sessionId, error instanceof Error ? error.message : '目标操作失败');
  } finally { goalActionsRef.current.delete(sessionId); }
};

export const jumpToConversationTurn = (turnIndex: number) => {
  const { setHoveredTurnIndex } = useViewStore.getState();
  setHoveredTurnIndex(turnIndex);
  conversationTurnRefs.current[turnIndex]?.scrollIntoView({ behavior: "smooth", block: "start" });
};

export const clearWorkspace = () => {
  const { sessions, newTaskDraft, activeId, setWorkspacePath, setWorkspaceEntries } = useSessionStore.getState();
  const { setNotice } = useViewStore.getState();
  const activeSession = newTaskDraft?.id === activeId ? newTaskDraft : sessions.find((session) => session.id === activeId) || sessions[0];
  if (!activeSession) return;
  setWorkspacePath("");
  setWorkspaceEntries([]);
  closeFilePanelTabs();
  updateSession(activeSession.id, (session) => ({ ...session, workspacePath: "" }));
  setNotice("已移除这个会话的工作目录，会话归入最近");
};

// 导出会话为 Markdown：正文用 displayContent（引用技能/长粘贴折叠时与气泡一致），
// 附件、技能标签与耗时一并带出，文件名含会话标题与日期
export const exportSessionMarkdown = (session: SessionRecord) => {
  const { setNotice } = useViewStore.getState();
  const lines: string[] = [
    `# ${session.title}`,
    "",
    `> 导出自 DYWorker · ${new Date().toLocaleString()}`,
    "",
  ];
  for (const message of session.messages) {
    const body = message.displayContent || message.content;
    if (!body.trim()) continue;
    const time = message.createdAt ? new Date(message.createdAt).toLocaleString() : "";
    const header = message.role === "user" ? "🧑 用户" : message.role === "assistant" ? "🤖 助手" : "系统";
    lines.push(`## ${header}${time ? ` · ${time}` : ""}`, "");
    lines.push(body.trim(), "");
    // 折叠的长粘贴块导出原文（与气泡展开后看到的一致），避免导出文件丢失内容
    for (const [index, block] of (message.pasteBlocks || []).entries()) {
      lines.push("", `<details><summary>长文本 ${block.text.length} 字（第 ${index + 1} 段）</summary>`, "", block.text, "", "</details>");
    }
    if (message.skillsUsed?.length) lines.push(`（使用技能：${message.skillsUsed.join("、")}）`, "");
    if (message.attachments?.length) {
      lines.push(`**附件：** ${message.attachments.map((item) => item.name).join("、")}`, "");
    }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `${session.title.replace(/[\\/:*?"<>|]/g, "_")}-${stamp}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
  setNotice("已导出会话为 Markdown 文件");
};

// 跨机迁移：导出一个任务的完整迁移包（含消息、附件、项目信息），
// 与「导出为 Markdown」的区别是可在另一台电脑的 DYWorker 里原样导入。
export const exportSessionPackage = async (session: SessionRecord) => {
  const { setNotice, setError } = useViewStore.getState();
  const api = window.dyworker?.exportSessionPackage;
  if (!api) { setError("当前环境不支持导出迁移包"); return; }
  try {
    const result = await api({ kind: "session", sessionId: session.id });
    if (!result?.ok) { setError(result?.error || "导出失败"); return; }
    if (result.canceled) return;
    const skipped = result.skippedAttachments?.length || 0;
    setNotice(`已导出任务迁移包：${result.path}${skipped ? `（${skipped} 个附件未随包导出）` : ""}`);
  } catch (error) {
    setError(error instanceof Error ? error.message : "导出失败");
  }
};

// 跨机迁移：导出整个项目（该工作目录下的全部任务 + 项目置顶状态）
export const exportProjectPackage = async (workspacePath: string) => {
  const { setNotice, setError } = useViewStore.getState();
  const api = window.dyworker?.exportSessionPackage;
  if (!api) { setError("当前环境不支持导出迁移包"); return; }
  const target = String(workspacePath || "").trim();
  if (!target) { setError("请先选择要导出的项目"); return; }
  try {
    const result = await api({ kind: "project", workspacePath: target });
    if (!result?.ok) { setError(result?.error || "导出失败"); return; }
    if (result.canceled) return;
    const skipped = result.skippedAttachments?.length || 0;
    setNotice(`已导出项目迁移包（${result.sessions || 0} 个任务）：${result.path}${skipped ? `（${skipped} 个附件未随包导出）` : ""}`);
  } catch (error) {
    setError(error instanceof Error ? error.message : "导出失败");
  }
};

// 跨机迁移：从迁移包导入任务/项目。主进程负责落盘（含附件、目录映射），
// 这里只把导入的会话并进列表并自动打开，随后由既有保存链路接管。
export const importSessionPackage = async () => {
  const { setSessions, setPendingAutoOpenSessionId, setPinnedWorkspacePaths } = useSessionStore.getState();
  const { setNotice, setError } = useViewStore.getState();
  const api = window.dyworker?.importSessionPackage;
  if (!api) { setError("当前环境不支持导入迁移包"); return; }
  try {
    const result = await api();
    if (!result?.ok) { setError(result?.error || "导入失败"); return; }
    if (result.canceled) return;
    const imported = Array.isArray(result.sessions) ? result.sessions : [];
    if (!imported.length) { setNotice("迁移包里没有可导入的任务"); return; }
    const importedIds = new Set(imported.map((session) => session.id));
    setSessions((current) => [...imported, ...current.filter((session) => !importedIds.has(session.id))]);
    if (result.pinnedWorkspace) {
      setPinnedWorkspacePaths((current) => current.includes(result.pinnedWorkspace!) ? current : [...current, result.pinnedWorkspace!]);
    }
    // 走「立即执行」同一套自动打开流程：等会话进列表后完成工作区切换与文件刷新
    setPendingAutoOpenSessionId(imported[0].id);
    const parts = [`已导入 ${result.added || imported.length} 个任务`];
    if (result.renamed) parts.push(`${result.renamed} 个与原任务编号重复已另存`);
    if (result.attachments) parts.push(`${result.attachments} 个附件`);
    if (result.skippedAttachments?.length) parts.push(`${result.skippedAttachments.length} 个附件未随包带来`);
    setNotice(parts.join("，"));
    if (result.missingWorkspaces?.length) {
      setError(`以下工作目录在本机不存在，任务已导入但工作目录不可用：${result.missingWorkspaces.join("、")}`);
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : "导入失败");
  }
};

// 总结为工作模板：把会话转录发给模型提炼草稿，弹可编辑对话框，确认后写入技能库
export const summarizeSessionToSkill = async (session: SessionRecord) => {
  const { skillSummarySessionId, setSkillSummarySessionId } = useSessionStore.getState();
  const { settings } = useSettingsStore.getState();
  const { setSkillDraft } = usePanelStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  if (skillSummarySessionId) return;
  if (buildSkillSummaryTranscript(session).length < 50) {
    setError("会话内容太少，还没有可总结的做法");
    return;
  }
  if (!window.dyworker?.completeChat) {
    setError("当前预览环境没有连接模型，无法提炼工作模板");
    return;
  }
  setSkillSummarySessionId(session.id);
  showSessionNotice(session.id, "正在提炼工作模板…");
  try {
    const messages = buildSkillSummaryMessages(session);
    let result = await window.dyworker.completeChat({ settings, messages });
    if (result.demo) {
      setError(result.content);
      return;
    }
    let draft = parseSkillDraft(result.content || "");
    if (!draft) {
      // 输出不是合法 JSON：追加强调后重试一次
      result = await window.dyworker.completeChat({
        settings,
        messages: [...messages, { role: "assistant" as const, content: result.content || "", createdAt: new Date().toISOString() }, { role: "user" as const, content: "上一次输出不是合法 JSON。请只输出一个 JSON 对象（name/description/instructions），不要用 Markdown 围栏，不要任何解释。", createdAt: new Date().toISOString() }],
      });
      if (result.demo) {
        setError(result.content);
        return;
      }
      draft = parseSkillDraft(result.content || "");
    }
    if (draft) {
      setSkillDraft(draft);
    } else {
      // 兜底：打开空草稿让用户手动填写，不让这次提炼白跑
      setSkillDraft({ name: session.title, description: "", instructions: "" });
      setNotice("模型没能生成初稿，请手动填写");
    }
  } catch (summaryError) {
    setError(`提炼失败：${summaryError instanceof Error ? summaryError.message : String(summaryError)}`);
  } finally {
    setSkillSummarySessionId(null);
  }
};
