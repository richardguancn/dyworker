// 渠道（QQ/微信）/定时计划会话实时进度归约：把主进程在任务运行期间转发过来的
// agent:event（活动流、正文流式、计划、循环状态、任务结束）实时归约进对应会话的消息。
// 整块 effect 从 App.tsx 原样搬入，占位气泡归约、文案、订阅注册与 cleanup 顺序、
// 行为均保持不变；App 本地的 ref 与工具函数经 deps 注入。
import { useEffect } from "react";
import type { RefObject } from "react";
import { patchDshAssistant, reconcileDshTurns } from "../dshTurns";
import { forgetStreamMessage, isChannelRunEnvelope, isScheduleRunEnvelope, isWakeRunEnvelope, registerStreamMessage } from "../channelStream";
import type { ChannelStreamRuns } from "../channelStream";
import { appendBranchActivity, patchActivityTree } from "../lib/activity";
import { applyReasoningStream } from "../reasoningStream";
import { formatWakeTime } from "../wakeNote";
import type { ChatMessage, SessionRecord } from "../types";
import { useSettingsStore } from "./settingsStore";
import { settingsForSession } from "../../electron/session-model.mts";
import { useSessionStore } from "./sessionStore";

export interface SessionStreamRuntimeDeps {
  channelStreamIdsRef: RefObject<Map<string, string>>;
  channelStreamRunsRef: RefObject<ChannelStreamRuns>;
  runningRunIdsRef: RefObject<Map<string, string>>;
  sessionsRef: RefObject<SessionRecord[]>;
  updateSession: (id: string, updater: (session: SessionRecord) => SessionRecord) => void;
  showSessionNotice: (sessionId: string, message: string) => void;
  refreshPendingWakes: () => Promise<void>;
  playCompletionSound: () => void;
}

export function useSessionStreamRuntime(deps: SessionStreamRuntimeDeps) {
  const {
    channelStreamIdsRef, channelStreamRunsRef, runningRunIdsRef, sessionsRef,
    updateSession, showSessionNotice, refreshPendingWakes, playCompletionSound,
  } = deps;
  const {
    setRunningSessionIds, setRunningStartedAt, setPendingApprovals, setPendingQuestions,
    setLoopStates, setSleepingSessions,
  } = useSessionStore();

  useEffect(() => {
    if (!window.dyworker?.onAgentEvent) return;
    // 每个流式会话当前正在更新的 assistant 占位消息 id（按 sessionId 记录）
    const channelStreamIds = channelStreamIdsRef.current;
    const streamRuns = channelStreamRunsRef.current;
    const activeDshTurns = new Map<string,string>();
    const patchChannelAssistant = (sessionId: string, updater: (current: ChatMessage) => ChatMessage) => {
      const targetId = channelStreamIds.get(sessionId);
      if (!targetId) return;
      const runId = [...streamRuns.entries()].find(([,ref])=>ref.sessionId===sessionId && ref.messageId===targetId)?.[0] || '';
      const turnId = activeDshTurns.get(runId);
      updateSession(sessionId, (session) => ({
        ...session,
        messages: patchDshAssistant(session.messages,{assistantId:targetId,runId,turnId},updater),
      }));
    };
    const ensureChannelAssistant = (sessionId: string, runId: string): string => {
      const existing = channelStreamIds.get(sessionId);
      if (existing) return existing;
      const id = `${runId}:assistant`;
      channelStreamIds.set(sessionId, id);
      // 登记 runId → 占位位置：收尾 sessions:append 凭它原位替换占位气泡，而不是追加第二条
      registerStreamMessage(streamRuns, runId, { sessionId, messageId: id });
      updateSession(sessionId, (session) => ({
        ...session,
        messages: [...session.messages, {
          id, runId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          activities: [],
        }],
      }));
      return id;
    };
    const unsubscribe = window.dyworker.onAgentEvent((sessionAgentEvent) => {
      const { sessionId, runId, event } = sessionAgentEvent;
      if (sessionAgentEvent.childRun) {
        if (event.type === 'queue-start') {
          runningRunIdsRef.current.set(sessionId,runId);
          setRunningSessionIds(current => new Set(current).add(sessionId));
        } else if (runningRunIdsRef.current.get(sessionId) === runId) {
          if (event.type === 'approval-request') setPendingApprovals(current => ({...current,[sessionId]:event.action}));
          if (event.type === 'approval-withdrawn') setPendingApprovals(current => { if (current[sessionId]?.id !== event.actionId) return current; const next={...current}; delete next[sessionId]; return next; });
          if (event.type === 'ask-user') setPendingQuestions(current => ({...current,[sessionId]:event.request}));
          if (event.type === 'agent-finished') {
            runningRunIdsRef.current.delete(sessionId);
            setRunningSessionIds(current => {const next=new Set(current);next.delete(sessionId);return next;});
            setPendingApprovals(current => {const next={...current};delete next[sessionId];return next;});
            setPendingQuestions(current => {const next={...current};delete next[sessionId];return next;});
            showSessionNotice(sessionId,event.result.status === 'done' ? '子任务本轮已结束' : event.result.reason || '子任务已停止');
          }
        }
        return;
      }
      // 自动会话标题在全局监听器处理（桌面与渠道运行都算）：按 sessionId 更新，
      // 不依赖 runTask 的 runId 专属监听器，任务先结束、标题后生成也能收到
      if (event.type === "session-title") {
        const title = String(event.title || "").trim().slice(0, 40);
        if (title) {
          updateSession(sessionId, (session) => (session.titleCustom ? session : { ...session, title }));
        }
        return;
      }
      // 只处理带运行标记的转发事件：桌面会话由 runTask 内注册的专属监听器处理，
      // 桌面端在渠道会话里发起的运行（信封无 channelRun 标记）也归它，这里必须跳过
      const scheduledRun = isScheduleRunEnvelope(sessionAgentEvent);
      const wakingRun = isWakeRunEnvelope(sessionAgentEvent);
      if (!isChannelRunEnvelope(sessionAgentEvent) && !scheduledRun && !wakingRun) return;
      const target = sessionsRef.current.find((session) => session.id === sessionId);
      if (!target) return;
      // 渠道归约只认渠道会话（桌面端可能在同一个渠道会话里起运行，那是 runTask 的事）；
      // 计划运行只认本次运行已经建好占位气泡的会话（run-started 先到，标识在 channelStreamIds 里）
      if (!scheduledRun && !wakingRun && !target.channel) return;
      if (wakingRun && runningRunIdsRef.current.get(sessionId)!==runId) return;
      if (scheduledRun && !channelStreamIds.has(sessionId)) return;
      if (event.type === 'dsh-conversation') {
        const assistantId = ensureChannelAssistant(sessionId,runId);
        activeDshTurns.set(runId,event.turns.at(-1)?.user.id || '');
        updateSession(sessionId,session=> {
          let messages = session.messages;
          let user = messages.find(message=>message.role==='user' && message.runId===runId);
          if (!user) {
            user={id:`${runId}:user`,role:'user',runId,content:event.turns[0]?.user.text || '',createdAt:new Date().toISOString()};
            const index=messages.findIndex(message=>message.id===assistantId);
            messages=[...messages.slice(0,index),user,...messages.slice(index)];
          }
          return {...session,messages:reconcileDshTurns(messages,event.turns,{userId:user.id!,assistantId,runId,live:true})};
        });
      } else if (event.type === "queue-start") {
        runningRunIdsRef.current.set(sessionId,runId);
        ensureChannelAssistant(sessionId, runId);
        setRunningSessionIds((current) => new Set(current).add(sessionId));
        setRunningStartedAt((current) => ({ ...current, [sessionId]: Date.now() }));
      } else if (event.type === "activity") {
        ensureChannelAssistant(sessionId, runId);
        if (event.activity.branch) {
          // 子代理分支活动挂到父活动 children（与桌面 runTask 监听器同一套归约）
          patchChannelAssistant(sessionId, (current) => {
            const { list, attached } = appendBranchActivity(current.activities || [], event.activity);
            if (!attached) {
              console.warn("子代理分支活动找不到父活动，已丢弃", event.activity.id);
              return current;
            }
            return { ...current, activities: list };
          });
        } else {
          patchChannelAssistant(sessionId, (current) => ({ ...current, activities: [...(current.activities || []), event.activity] }));
        }
      } else if (event.type === "activity-update") {
        patchChannelAssistant(sessionId, (current) => ({
          ...current,
          activities: patchActivityTree(current.activities || [], event.id, event.status, event.detail, event.durationMs, event.commentary),
        }));
      } else if (event.type === "assistant-text" && !activeDshTurns.has(runId)) {
        ensureChannelAssistant(sessionId, runId);
        patchChannelAssistant(sessionId, (current) => ({ ...current, content: event.text }));
      } else if (event.type === "assistant-reasoning" && !activeDshTurns.has(runId)) {
        ensureChannelAssistant(sessionId, runId);
        patchChannelAssistant(sessionId, (current) => applyReasoningStream(current, event.text));
      } else if (event.type === "plan-update") {
        ensureChannelAssistant(sessionId, runId);
        patchChannelAssistant(sessionId, (current) => ({ ...current, plan: event.steps }));
      } else if (event.type === "file-change") {
        patchChannelAssistant(sessionId, (current) => ({ ...current, changes: event.changes }));
      } else if (event.type === "context-usage") {
        updateSession(sessionId, session => ({ ...session,
          contextTokens: event.total ?? event.used + event.completion, contextTokensExact: !event.estimated,
          contextModel: settingsForSession(useSettingsStore.getState().settings, session).model,
          contextEndpoint: settingsForSession(useSettingsStore.getState().settings, session).endpoint,
        }));
      } else if (event.type === "token-usage") {
        updateSession(sessionId, session => ({ ...session, tokenStats: {
          prompt: (session.tokenStats?.prompt || 0) + event.prompt,
          completion: (session.tokenStats?.completion || 0) + event.completion,
          requests: (session.tokenStats?.requests || 0) + 1,
        } }));
      } else if (event.type === "context-compacted") {
        ensureChannelAssistant(sessionId, runId);
        patchChannelAssistant(sessionId, current => ({ ...current, activities: [...(current.activities || []), {
          id: crypto.randomUUID(), kind: "commentary", status: "success",
          title: "上下文已压缩", detail: "上下文已压缩，已保留继续任务所需的内容。",
        }] }));
      } else if (event.type === "loop-state") {
        setLoopStates((current) => {
          const next = { ...current };
          if (event.active) {
            next[sessionId] = { iteration: event.iteration, maximum: event.maximum, status: event.status };
          } else {
            delete next[sessionId];
          }
          return next;
        });
      } else if (event.type === "agent-finished") {
        // 收尾：用结果体把流式气泡收口为最终形态，并清掉运行标记。
        // 若收尾 append 已原位替换占位气泡，channelStreamIds 条目已被清掉，这里的补丁自然落空，
        // 不会用裸 finalText 覆盖落库消息。
        const result = event.result;
        patchChannelAssistant(sessionId, (current) => {
          const plan = result.plan?.length ? result.plan : current.plan;
          return {
            ...current,
            content: result.finalText || current.content,
            // 占位气泡创建于消息提交时；这里在任务收尾打点，让气泡时间显示模型回复时间
            createdAt: new Date().toISOString(),
            changes: result.changes?.length ? result.changes : current.changes,
            plan,
            durationMs: (result as { durationMs?: number }).durationMs,
            taskStatus: result.status,
          };
        });
        if (result.dshTurns?.length && channelStreamIds.has(sessionId)) {
          const assistantId=channelStreamIds.get(sessionId)!;
          updateSession(sessionId,session=> {
            const user=session.messages.find(message=>message.role==='user' && message.runId===runId);
            return user ? {...session,messages:reconcileDshTurns(session.messages,result.dshTurns!,{userId:user.id!,assistantId,runId})} : session;
          });
        }
        activeDshTurns.delete(runId);
        if (runningRunIdsRef.current.get(sessionId) === runId) runningRunIdsRef.current.delete(sessionId);
        channelStreamIds.delete(sessionId);
        forgetStreamMessage(streamRuns, runId);
        setRunningSessionIds((current) => {
          const next = new Set(current);
          next.delete(sessionId);
          return next;
        });
        setLoopStates((current) => {
          const next = { ...current };
          delete next[sessionId];
          return next;
        });
        if (result.status === "done" && !result.demo) {
          playCompletionSound();
          showSessionNotice(sessionId, "任务已完成");
        } else if (result.status === "sleeping" && result.wake) {
          // 渠道会话同样会有主动挂起：挂起期间也不该再起新一轮（会与到点续跑撞车）
          setSleepingSessions((current) => ({
            ...current,
            [sessionId]: {
              sessionId,
              wakeAt: result.wake!.wakeAt,
              reason: result.wake!.reason || "",
            },
          }));
          showSessionNotice(sessionId, `已挂起，将于 ${formatWakeTime(result.wake.wakeAt)} 自动唤醒继续`);
          // 以主进程 pending 列表为准自纠正（登记被跳过时不该把输入框锁死）
          void refreshPendingWakes();
        }
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, []);
}
