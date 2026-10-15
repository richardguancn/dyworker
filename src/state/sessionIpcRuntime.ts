// 会话 IPC 运行时订阅：把主进程推送的会话转录 / 计划运行 / 渠道追加 / 唤醒状态 /
// 收件箱 / 运营消息事件集中订阅在一个 effect 里。整块 effect 从 App.tsx 原样搬入，
// 订阅注册与 cleanup 顺序、文案、行为均保持不变；App 本地的 ref 与工具函数经 deps 注入。
import { useEffect } from "react";
import type { RefObject } from "react";
import { forgetSessionStream, mergePrependedSession, reconcileChannelAppend, registerStreamMessage, takeStreamMessage } from "../channelStream";
import type { ChannelStreamRuns } from "../channelStream";
import { latestWorkingContext } from "../lib/text";
import { formatWakeTime, wakingNoteTexts } from "../wakeNote";
import type { SessionRecord } from "../types";
import { useSessionStore } from "./sessionStore";
import type { WakingSessionEntry } from "./sessionStore";
import { useViewStore } from "./viewStore";
import { usePanelStore } from "./panelStore";
import { useInboxStore } from "./inboxStore";
import { useLayoutStore } from "./layoutStore";

export interface SessionIpcRuntimeDeps {
  channelStreamRunsRef: RefObject<ChannelStreamRuns>;
  channelStreamIdsRef: RefObject<Map<string, string>>;
  runningRunIdsRef: RefObject<Map<string, string>>;
  manualRunScheduleRef: RefObject<string>;
  activeIdRef: RefObject<string>;
  wakingSessionsRef: RefObject<Record<string, WakingSessionEntry>>;
  refreshPendingWakes: () => Promise<void>;
  showSessionNotice: (sessionId: string, message: string) => void;
  patchWakingSleepNote: (sessionId: string, wakeAt: string, marker: string, phase: "waking" | "woke", done?: string) => void;
}

export function useSessionIpcRuntime(deps: SessionIpcRuntimeDeps) {
  const {
    channelStreamRunsRef, channelStreamIdsRef, runningRunIdsRef, manualRunScheduleRef, activeIdRef, wakingSessionsRef,
    refreshPendingWakes, showSessionNotice, patchWakingSleepNote,
  } = deps;
  const {
    setSessions, setActiveId, setRunningSessionIds, setRunningStartedAt, setScheduledRunSessions,
    setPendingAutoOpenSessionId, setSleepingSessions, setWakingSessions, setLoopStates,
  } = useSessionStore();
  const { setNotice } = useViewStore();
  const { setSchedules, setMemories } = usePanelStore();
  const { setInboxItems, setSystemMessagesUnread, setInboxTab, setSystemMessageFocusId, setInboxOpen } = useInboxStore();
  const { setSettingsOpen } = useLayoutStore();

  useEffect(() => {
    const offSchedules = window.dyworker?.onSchedulesChanged?.(() => {
      void window.dyworker?.listSchedules?.().then(setSchedules);
      void window.dyworker?.listMemories?.().then(setMemories);
    });
    const offPrepend = window.dyworker?.onSessionPrepend?.((session) => {
      const workingContext = session.workingContext ?? latestWorkingContext(session.messages);
      const incoming: SessionRecord = { ...session, ...(workingContext !== undefined ? { workingContext } : {}) };
      // 计划运行开始时已按同一个会话 id 乐观建过会话（schedules:run-started），这里必须按 id
      // 原位归并权威转录：直接 prepend 会在「最近任务」里多出一条同 id 的重复会话，一条停在
      // 运行中、一条已是最终结果（markdown 渲染也会因为 React key 重复而漂移）。
      // mergePrependedSession 是纯函数，可安全放进 updater（StrictMode 双调结果一致）。
      setSessions((current) => mergePrependedSession<SessionRecord>(current, incoming).sessions);
      // 一轮运行结束（完成/挂起/失败都会走到这里）：清掉这次运行的流式占位与运行标记，
      // 否则气泡永远停在"正在执行"，侧栏的转圈也不会停
      forgetSessionStream(channelStreamRunsRef.current, session.id);
      channelStreamIdsRef.current.delete(session.id);
      const finishedRun = [...session.messages].reverse().find(message => message.role === 'assistant')?.runId;
      if (finishedRun && runningRunIdsRef.current.get(session.id) === finishedRun) runningRunIdsRef.current.delete(session.id);
      setScheduledRunSessions((current) => {
        if (!current.has(session.id)) return current;
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
      setRunningSessionIds((current) => {
        if (!current.has(session.id)) return current;
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
      setLoopStates((current) => {
        if (!(session.id in current)) return current;
        const next = { ...current };
        delete next[session.id];
        return next;
      });
      // 计划主动挂起时，界面要立刻出「立即继续 / 取消唤醒」卡片（挂起状态以主进程
      // wakes.json 为权威）；已完成/失败的一轮也会借此清掉过期的挂起标记
      void refreshPendingWakes();
      setNotice(session.channel
        ? `收到${session.channel === "qq" ? "QQ" : "微信"}消息，渠道会话已建立`
        : "定时计划已执行，结果已保存到最近任务");
    });
    // 定时计划开始运行：主进程在起跑前就把本次运行的会话标识推过来，界面立刻建出会话与
    // 流式占位气泡（后续 agent:event 带 scheduleRun 打标实时填充）。以前只在运行结束（或
    // 挂起）时才 prepend 整段转录，一个跑几十分钟的计划这段时间里界面上什么都没有。
    const offScheduleRunStarted = window.dyworker?.onScheduleRunStarted?.((payload) => {
      const sessionId = String(payload?.sessionId || "");
      if (!sessionId) return;
      const runId = String(payload?.runId || sessionId);
      const startedAt = payload?.startedAt || new Date().toISOString();
      const assistantId = `${runId}:assistant`;
      runningRunIdsRef.current.set(sessionId,runId);
      // 占位气泡登记放在 updater 外：StrictMode 下 updater 会被双调，ref 写入必须只发生一次
      registerStreamMessage(channelStreamRunsRef.current, runId, { sessionId, messageId: assistantId });
      channelStreamIdsRef.current.set(sessionId, assistantId);
      setSessions((current) => mergePrependedSession<SessionRecord>(current, {
        id: sessionId,runtime:payload?.runtime === 'dsh' ? 'dsh' : 'dyworker',
        title: payload?.title || "计划任务",
        workspacePath: String(payload?.workspacePath || ""),
        createdAt: startedAt,
        updatedAt: startedAt,
        messages: [
          { id: `${runId}:user`,runId,role: "user", content: String(payload?.prompt || ""), createdAt: startedAt },
          { id: assistantId,runId,role: "assistant", content: "", createdAt: startedAt, activities: [] },
        ],
      }).sessions);
      setRunningSessionIds((current) => new Set(current).add(sessionId));
      setRunningStartedAt((current) => ({ ...current, [sessionId]: Date.now() }));
      setScheduledRunSessions((current) => new Set(current).add(sessionId));
      // 手动「立即执行」：用户点它就是要马上看到这次运行，直接把会话推到眼前
      // （到点自动执行的计划只进列表，不抢当前会话焦点）
      if (payload?.manual && manualRunScheduleRef.current === String(payload?.scheduleId || "")) {
        manualRunScheduleRef.current = "";
        setSettingsOpen(false);
        setPendingAutoOpenSessionId(sessionId);
      }
      showSessionNotice(sessionId, "计划任务已开始执行，进度实时显示在这里");
    });
    const offAppend = window.dyworker?.onSessionAppend?.((payload) => {
      const appendUnread = payload.sessionId !== activeIdRef.current;
      // 渠道任务收尾的落库消息与运行期间的流式占位气泡是同一条回复：凭 runId 找到占位气泡
      // 原位替换，否则会出现两条重复消息。takeStreamMessage 是 delete-on-read（替换只发生一次），
      // 必须在 setSessions updater 外调用——updater 在 StrictMode 下会被双调，里面要保持纯净。
      const streamRef = takeStreamMessage(channelStreamRunsRef.current, String(payload.runId || ""));
      const placeholderMessageId = streamRef && streamRef.sessionId === payload.sessionId ? streamRef.messageId : null;
      setSessions((current) => {
        const existing = current.find((session) => session.id === payload.sessionId);
        const workingContext = latestWorkingContext(payload.messages);
        if (existing) {
          const { messages: mergedMessages, replacedMessageId } = reconcileChannelAppend(existing.messages, placeholderMessageId, payload.messages);
          if (replacedMessageId) {
            // 占位气泡已被最终消息接管：随后的 agent-finished 补丁不得再覆盖它
            // （补丁只会写裸 finalText，会丢「已发送 N 个文件」等收尾注记）。delete 幂等，双调安全。
            channelStreamIdsRef.current.delete(payload.sessionId);
          }
          return current.map((session) => session.id === payload.sessionId
            ? {
                ...session,
                // 渠道里用「更换工作目录至…」切换后，主进程随下一条消息带回新路径
                workspacePath: payload.workspacePath || session.workspacePath,
                ...(payload.goalState && session.goalState?.id === payload.goalState.id && session.goalState.status === 'active' ? { goalState: payload.goalState } : {}),
                ...(workingContext !== undefined ? { workingContext } : {}),
                ...(appendUnread ? { unread: true } : {}),
                messages: mergedMessages,
                updatedAt: new Date().toISOString(),
              }
            : session);
        }
        const now = new Date().toISOString();
        return [{
          id: payload.sessionId,
          title: payload.channel ? `${payload.channel === "qq" ? "QQ" : "微信"}消息` : "到点自动唤醒续跑",
          workspacePath: payload.workspacePath,
          ...(payload.channel ? { channel: payload.channel } : {}),
          ...(workingContext !== undefined ? { workingContext } : {}),
          ...(appendUnread ? { unread: true } : {}),
          createdAt: now,
          updatedAt: now,
          messages: payload.messages,
        }, ...current];
      });
      setNotice(payload.channel
        ? `${payload.channel === "qq" ? "QQ" : "微信"}渠道任务有新进展`
        : "挂起的任务已到点自动唤醒，结果已写入任务记录");
    });
    const offInbox = window.dyworker?.onInboxChanged?.(() => {
      void window.dyworker?.listInbox?.().then(setInboxItems);
    });
    const offWakeStatus = window.dyworker?.onWakeStatus?.((payload) => {
      if (payload.status === "running") {
        setRunningSessionIds((current) => new Set(current).add(payload.sessionId));
        setRunningStartedAt((current) => ({ ...current, [payload.sessionId]: Date.now() }));
        // 主进程下发了续跑的 runId：登记后 ESC/停止按钮才能真的打断无人值守续跑
        if (payload.runId) runningRunIdsRef.current.set(payload.sessionId, payload.runId);
        // 已经开跑就不再是"挂起中"，避免挂起卡片和运行状态同时显示
        setSleepingSessions((current) => {
          if (!(payload.sessionId in current)) return current;
          const next = { ...current };
          delete next[payload.sessionId];
          return next;
        });
        // 记录"续跑中"：运行状态行与气泡说明都按这个状态改写，
        // 免得界面上还挂着"将于 X 自动唤醒"的将来时，下面却在跑任务
        const wakeAt = String(payload.wakeAt || "");
        const { marker, done } = wakingNoteTexts(formatWakeTime(wakeAt), Boolean(payload.manual));
        const wakingEntry: WakingSessionEntry = { wakeAt, manual: Boolean(payload.manual), marker, done };
        wakingSessionsRef.current = { ...wakingSessionsRef.current, [payload.sessionId]: wakingEntry };
        setWakingSessions(wakingSessionsRef.current);
        patchWakingSleepNote(payload.sessionId, wakeAt, marker, "waking");
        showSessionNotice(
          payload.sessionId,
          payload.manual ? "已按你的要求立即继续，正在处理..." : "已到点自动唤醒，正在自主推进任务...",
        );
      } else {
        setRunningSessionIds((current) => {
          const next = new Set(current);
          next.delete(payload.sessionId);
          return next;
        });
        if (runningRunIdsRef.current.get(payload.sessionId) === payload.runId) {
          runningRunIdsRef.current.delete(payload.sessionId);
        }
        // 续跑收尾：把气泡从"正在继续处理"收口为已完成时态，再清掉续跑标记。
        // 这里用 ref 读、状态更新保持纯净（updater 在 StrictMode 下会被双调）
        const finished = wakingSessionsRef.current[payload.sessionId];
        if (finished) {
          patchWakingSleepNote(payload.sessionId, finished.wakeAt, finished.marker, "woke", finished.done);
          const next = { ...wakingSessionsRef.current };
          delete next[payload.sessionId];
          wakingSessionsRef.current = next;
          setWakingSessions(next);
        }
        // 续跑可能又挂了新的一觉（或已被用户取消）：回主进程取权威状态
        void refreshPendingWakes();
      }
    });
    const offInboxFocus = window.dyworker?.onInboxFocusItem?.((item) => {
      if (item?.sessionId) {
        setActiveId(item.sessionId);
      }
      setInboxOpen(true);
    });
    // 运营消息：未读数随主进程消息中心变化自动刷新；系统通知点击后定位到对应消息
    const refreshSystemUnread = () => {
      void window.dyworker?.listSystemMessages?.().then((items) => {
        const now = Date.now();
        setSystemMessagesUnread((items || []).filter((message) =>
          !message.read_at && !message.revoked
          && !(message.expires_at && Number.isFinite(Date.parse(message.expires_at)) && Date.parse(message.expires_at) <= now),
        ).length);
      });
    };
    const offSystemMessages = window.dyworker?.onSystemMessagesChanged?.(refreshSystemUnread);
    const offSystemMessagesFocus = window.dyworker?.onSystemMessagesFocus?.(({ messageId }) => {
      setInboxTab("messages");
      setSystemMessageFocusId(String(messageId || ""));
      setInboxOpen(true);
    });
    refreshSystemUnread();
    // 人工活动信号：应用内点击/按键/滚动节流上报主进程，只记录发生时间（用于前台有效使用
    // 时长统计；不读取键盘内容、剪贴板或页面正文），统计关闭时主进程直接忽略
    let lastActivityReport = 0;
    const reportActivity = () => {
      const stamp = Date.now();
      if (stamp - lastActivityReport < 1000) return;
      lastActivityReport = stamp;
      window.dyworker?.reportUserActivity?.();
    };
    const activityOptions = { capture: true, passive: true } as AddEventListenerOptions;
    window.addEventListener("pointerdown", reportActivity, activityOptions);
    window.addEventListener("keydown", reportActivity, activityOptions);
    window.addEventListener("wheel", reportActivity, activityOptions);
    void window.dyworker?.listInbox?.().then(setInboxItems);
    return () => {
      offSchedules?.();
      offPrepend?.();
      offScheduleRunStarted?.();
      offAppend?.();
      offInbox?.();
      offWakeStatus?.();
      offInboxFocus?.();
      offSystemMessages?.();
      offSystemMessagesFocus?.();
      window.removeEventListener("pointerdown", reportActivity, activityOptions);
      window.removeEventListener("keydown", reportActivity, activityOptions);
      window.removeEventListener("wheel", reportActivity, activityOptions);
    };
  }, []);
}
