// 会话辅助函数（模块级 actions）。
//
// 整组函数原样从 App.tsx 搬出，只是把「读写 state 的裸标识符」改成经 store 的
// getState() 解构拿到，并把跨模块共享的 ref 换成 sharedRefs 里的模块级单例；
// 函数体、文案与行为均保持不变，供 App、IPC 订阅运行时等任意位置 import 调用。
import { closeWakingNote, formatWakeTime, rephraseSleepNote, settleResolvedSleepNote } from "../wakeNote";
import type { PendingWakeRecord, SessionRecord } from "../types";
import { useSessionStore } from "./sessionStore";
import { sessionErrorTimersRef, sessionNoticeTimersRef, wakingSessionsRef } from "./sharedRefs";

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
