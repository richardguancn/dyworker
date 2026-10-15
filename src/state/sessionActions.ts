// 会话辅助函数（模块级 actions）。
//
// 整组函数原样从 App.tsx 搬出，只是把「读写 state 的裸标识符」改成经 store 的
// getState() 解构拿到，并把跨模块共享的 ref 换成 sharedRefs 里的模块级单例；
// 函数体、文案与行为均保持不变，供 App、IPC 订阅运行时等任意位置 import 调用。
import { closeWakingNote, formatWakeTime, rephraseSleepNote, settleResolvedSleepNote } from "../wakeNote";
import type { PendingWakeRecord, SessionRecord } from "../types";
import { useSessionStore } from "./sessionStore";
import { useLayoutStore } from "./layoutStore";
import { useViewStore } from "./viewStore";
import { sessionDraftsRef, sessionErrorTimersRef, sessionNoticeTimersRef, sessionRenameRequestsRef, sessionsRef, wakingSessionsRef } from "./sharedRefs";

export const refreshPendingWakes = async () => {
  const { setSleepingSessions, setSessions } = useSessionStore.getState();
  const list = await window.dyworker?.listPendingWakes?.();
  if (!Array.isArray(list)) return;
  const next: Record<string, PendingWakeRecord> = {};
  for (const item of list) {
    if (item?.sessionId) next[item.sessionId] = { ...item, sessionId: item.sessionId };
  }
  setSleepingSessions(next);
  // 这一觉已经走完（到点跑过 / 被取消 / 窗口关着时已触发）的会话：气泡里那句
  // "将于 X 自动唤醒继续"要收口成"原定 X 自动唤醒"，否则重启后它还在声称将来会唤醒。
  // 仍在待唤醒列表、或正在续跑中的会话不动。
  setSessions((current) => {
    let changedAny = false;
    const settled = current.map((session) => {
      if (next[session.id] || wakingSessionsRef.current[session.id]) return session;
      let changed = false;
      const messages = session.messages.map((message) => {
        if (message.role !== "assistant" || message.taskStatus !== "sleeping" || !message.content) return message;
        const content = String(message.content);
        const settledContent = settleResolvedSleepNote(content);
        if (settledContent === content) return message;
        changed = true;
        return { ...message, content: settledContent };
      });
      if (!changed) return session;
      changedAny = true;
      return { ...session, messages };
    });
    return changedAny ? settled : current;
  });
};

// 会话更新与通知工具：供渠道实时事件监听器与 runTask 共用
export const updateSession = (id: string, updater: (session: SessionRecord) => SessionRecord) => {
  const { setNewTaskDraft, setSessions } = useSessionStore.getState();
  setNewTaskDraft((current) => current?.id === id ? updater(current) : current);
  setSessions((current) => current.map((session) => session.id === id ? updater(session) : session));
};

// 续跑开始/结束时改写那条挂起气泡的说明（只动我们自己生成的那句，不碰模型正文）。
// 目标靠"将于/原定 {wakeAt} 自动唤醒"这个精确时间 + 注入的 marker 定位：同一会话可能
// 挂起过多轮，不能简单按"最后一条 sleeping"取，否则会把新一轮的挂起说明也改掉。
export const patchWakingSleepNote = (sessionId: string, wakeAt: string, marker: string, phase: "waking" | "woke", done = "") => {
  const wakeAtText = formatWakeTime(wakeAt);
  updateSession(sessionId, (session) => {
    let changed = false;
    const messages = session.messages.map((message) => {
      if (message.role !== "assistant" || !message.content) return message;
      const content = String(message.content);
      if (phase === "waking") {
        const next = rephraseSleepNote(content, wakeAtText, marker);
        if (next === content) return message;
        changed = true;
        return { ...message, content: next };
      }
      const next = closeWakingNote(content, marker, done);
      if (next === content) return message;
      changed = true;
      return { ...message, content: next };
    });
    return changed ? { ...session, messages } : session;
  });
};

export const clearSessionNotice = (sessionId: string) => {
  const { setSessionNotices } = useSessionStore.getState();
  const previous = sessionNoticeTimersRef.current.get(sessionId);
  if (previous) {
    window.clearTimeout(previous);
    sessionNoticeTimersRef.current.delete(sessionId);
  }
  setSessionNotices((current) => {
    if (!current[sessionId]) return current;
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
};

export const clearSessionError = (sessionId: string) => {
  const { setSessionErrors } = useSessionStore.getState();
  const previous = sessionErrorTimersRef.current.get(sessionId);
  if (previous) {
    window.clearTimeout(previous);
    sessionErrorTimersRef.current.delete(sessionId);
  }
  setSessionErrors((current) => {
    if (!current[sessionId]) return current;
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
};

export const showSessionNotice = (sessionId: string, message: string) => {
  const { setSessionNotices } = useSessionStore.getState();
  setSessionNotices((current) => ({ ...current, [sessionId]: message }));
  const previous = sessionNoticeTimersRef.current.get(sessionId);
  if (previous) window.clearTimeout(previous);
  const timeout = window.setTimeout(() => {
    setSessionNotices((current) => {
      if (current[sessionId] !== message) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    sessionNoticeTimersRef.current.delete(sessionId);
  }, 3200);
  sessionNoticeTimersRef.current.set(sessionId, timeout);
};

export const showSessionError = (sessionId: string, message: string, duration = 5000) => {
  const { setSessionErrors } = useSessionStore.getState();
  setSessionErrors((current) => ({ ...current, [sessionId]: message }));
  const previous = sessionErrorTimersRef.current.get(sessionId);
  if (previous) window.clearTimeout(previous);
  const timeout = window.setTimeout(() => {
    setSessionErrors((current) => {
      if (current[sessionId] !== message) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    sessionErrorTimersRef.current.delete(sessionId);
  }, duration);
  sessionErrorTimersRef.current.set(sessionId, timeout);
};

export function makeSession(workspacePath = ""): SessionRecord {
  const createdAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "新任务",
    workspacePath,
    createdAt,
    updatedAt: createdAt,
    messages: [],
  };
}

export const deleteSession = (id: string) => {
  const { activeId, setActiveId, setNewTaskDraft, setSessions, setSleepingSessions, setWakingSessions, setWorkspaceEntries, setWorkspacePath } = useSessionStore.getState();
  const { setSessionMenuId } = useLayoutStore.getState();
  setSessionMenuId(null);
  // 会话删除时,它登记的待唤醒一并取消,避免无主的自动续跑
  void window.dyworker?.cancelWakesForSession?.(id);
  setSleepingSessions((current) => {
    if (!(id in current)) return current;
    const next = { ...current };
    delete next[id];
    return next;
  });
  if (wakingSessionsRef.current[id]) {
    const next = { ...wakingSessionsRef.current };
    delete next[id];
    wakingSessionsRef.current = next;
    setWakingSessions(next);
  }
  delete sessionDraftsRef.current[id];
  setSessions((current) => {
    const remaining = current.filter((session) => session.id !== id);
    if (!remaining.length) {
      const fresh = makeSession();
      setWorkspacePath("");
      setWorkspaceEntries([]);
      setActiveId(fresh.id);
      setNewTaskDraft(fresh);
      return [];
    }
    if (id === activeId) setActiveId(remaining[0].id);
    return remaining;
  });
};

// 「立即继续」：取走主进程的待唤醒并马上续跑（不等约定时间）。
// 先乐观收起挂起卡片，失败时回主进程重新拉一次权威状态，避免界面与磁盘不一致。
export const resumeSleepingTask = async (sessionId: string) => {
  const { setRunningSessionIds, setRunningStartedAt, setSleepingSessions } = useSessionStore.getState();
  setSleepingSessions((current) => {
    if (!(sessionId in current)) return current;
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
  setRunningSessionIds((current) => new Set(current).add(sessionId));
  setRunningStartedAt((current) => ({ ...current, [sessionId]: Date.now() }));
  const result = await window.dyworker?.resumeWakeNow?.(sessionId);
  if (result && !result.ok) {
    // 主进程没接（会话占用/后台任务占着调度道）：乐观加上的运行态要撤回，
    // 否则会留下一个转不完的运行中图标和点不动的停止键
    setRunningSessionIds((current) => {
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
    setRunningStartedAt((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    void refreshPendingWakes();
    showSessionNotice(sessionId, result.error || "立即继续失败，任务仍会在到点时自动唤醒");
  }
};

// 「取消唤醒」：不打断已有内容，只是让这个会话重新可交互
export const cancelSleepingTask = async (sessionId: string) => {
  const { setSleepingSessions } = useSessionStore.getState();
  await window.dyworker?.cancelWakesForSession?.(sessionId);
  setSleepingSessions((current) => {
    if (!(sessionId in current)) return current;
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
  // 挂起气泡里的说明是历史留痕：不补一句，它会继续声称"到点自动唤醒"
  updateSession(sessionId, (session) => {
    const index = session.messages.map((message) => message.taskStatus === "sleeping").lastIndexOf(true);
    if (index < 0) return session;
    return {
      ...session,
      messages: session.messages.map((message, messageIndex) => messageIndex === index
        ? { ...message, content: `${message.content}\n\n**已取消自动唤醒**，本会话可以继续对话。`.trim() }
        : message),
    };
  });
  showSessionNotice(sessionId, "已取消自动唤醒");
};

export const unarchiveSession = (id: string) => {
  const { setSessionMenuId } = useLayoutStore.getState();
  setSessionMenuId(null);
  updateSession(id, (session) => ({ ...session, archived: false }));
};

export const togglePin = (id: string) => {
  const { setTopMenuOpen } = useLayoutStore.getState();
  setTopMenuOpen(false);
  updateSession(id, (session) => ({ ...session, pinned: !session.pinned }));
};

export const toggleWorkspacePin = (targetWorkspacePath: string) => {
  const { pinnedWorkspacePaths, setPinnedWorkspacePaths } = useSessionStore.getState();
  const { setWorkspaceMenuPath } = useLayoutStore.getState();
  const { setNotice } = useViewStore.getState();
  const pinned = pinnedWorkspacePaths.includes(targetWorkspacePath);
  setPinnedWorkspacePaths((current) => pinned
    ? current.filter((path) => path !== targetWorkspacePath)
    : [...current, targetWorkspacePath]);
  setWorkspaceMenuPath(null);
  setNotice(pinned ? "已取消置顶工作目录" : "工作目录已置顶");
};

export const openWorkspaceInFileManager = async (targetWorkspacePath: string) => {
  const { setWorkspaceMenuPath } = useLayoutStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  setWorkspaceMenuPath(null);
  if (!window.dyworker?.openPath) {
    setNotice("当前预览环境无法打开系统文件管理器");
    return;
  }
  try {
    const result = await window.dyworker.openPath(targetWorkspacePath);
    if (!result.ok) {
      setError(result.error || "无法打开工作目录");
      return;
    }
    setNotice("已在系统文件管理器中打开工作目录");
  } catch (openError) {
    setError(`无法打开工作目录：${openError instanceof Error ? openError.message : String(openError)}`);
  }
};

export const archiveSession = (id: string) => {
  const { activeId, sessions, setActiveId, setNewTaskDraft, setWorkspaceEntries, setWorkspacePath } = useSessionStore.getState();
  const { setTopMenuOpen } = useLayoutStore.getState();
  setTopMenuOpen(false);
  updateSession(id, (session) => ({ ...session, archived: true, pinned: false }));
  if (id === activeId) {
    const next = sessions.find((session) => session.id !== id && !session.archived);
    if (next) setActiveId(next.id);
    else {
      const fresh = makeSession();
      setWorkspacePath("");
      setWorkspaceEntries([]);
      setNewTaskDraft(fresh);
      setActiveId(fresh.id);
    }
  }
};

export const renameSession = async (id: string, title: string) => {
  const { setRenamingId } = useLayoutStore.getState();
  const { setNotice } = useViewStore.getState();
  const trimmed = title.trim();
  setRenamingId(null);
  if (!trimmed) return;
  const requested = trimmed.slice(0, 40);
  const existing = sessionsRef.current.find(session => session.id === id);
  if (!existing) return;
  if (existing.runtime !== 'dsh') {
    updateSession(id, session => ({...session,title:requested,titleCustom:true}));
    return;
  }
  // Enter and blur may settle the same edit; only the current accepted write updates the view.
  if (sessionRenameRequestsRef.current.get(id)?.title === requested) return;
  const request = {title:requested,token:Symbol(id)};
  sessionRenameRequestsRef.current.set(id,request);
  try {
    if (!window.dyworker?.dshOperation) throw new Error('当前应用不能保存 DSH 任务标题');
    const reply = await window.dyworker.dshOperation({sessionId:id,action:'session-rename',
      payload:{address:{kind:'session',sessionId:id},title:requested}});
    if (!reply?.ok || typeof reply.value?.title !== 'string')
      throw new Error(reply?.error?.message || '任务重命名失败');
    if (sessionRenameRequestsRef.current.get(id) !== request) return;
    updateSession(id, session => ({...session,title:reply.value.title,titleCustom:true}));
  } catch (error) {
    if (sessionRenameRequestsRef.current.get(id) === request)
      setNotice(error instanceof Error ? error.message : '任务重命名失败');
  } finally {
    if (sessionRenameRequestsRef.current.get(id) === request) sessionRenameRequestsRef.current.delete(id);
  }
};
