// 从桌面入口拆出的休眠唤醒和计划任务执行。
import { queuedGoalPayload,settledStoredGoal } from "../goal.mts";
import { hasConfiguredModel } from "../host/dsh-runtime/model-settings.mts";
import { mergeDshTranscript,patchDshAssistant,reconcileDshMessages } from '../host/dsh-runtime/presentation.mts';
import { UNATTENDED_PENDING_TIMEOUT_MS } from "../host/services/inbox.mts";
import { settingsForSession } from "../session-model.mts";
import { unattendedApprovalMode,wakeApprovalMode } from "../settings.mts";

export function createAutomationRuntime(deps: {
  ctx: any;
  trackTaskStart: (...args: any[]) => void;
  wakeRuns: Map<string, any>;
  mainWindow: import("electron").BrowserWindow | null;
  readSettings: (...args: any[]) => Promise<any>;
  visibleConversationForSession: (...args: any[]) => Promise<any>;
  workingContextForSession: (...args: any[]) => Promise<any>;
  CHANNEL_STREAM_EVENT_TYPES: Set<string>;
  persistSessionAppend: (...args: any[]) => Promise<any>;
  trackTaskEnd: (...args: any[]) => void;
  drainSessionQueue: (...args: any[]) => void;
  broadcastSchedulesChanged: (...args: any[]) => void;
  entryRuns: Map<string, any>;
  sendScheduleRunStarted: (...args: any[]) => void;
  persistSessionRecord: (...args: any[]) => Promise<any>;
}) {
  const { trackTaskStart, readSettings, visibleConversationForSession, workingContextForSession, persistSessionAppend, trackTaskEnd, drainSessionQueue, broadcastSchedulesChanged, sendScheduleRunStarted, persistSessionRecord } = deps;


// options.manual：「立即继续」按钮触发的手动续跑（不是到点自动唤醒）。
// 渲染端要据此说"已按你的要求立即继续"，而不是谎称"已到点自动唤醒"。
async function resumeWake(wake, options: any = {}) {
  const wakeSessionId = String(wake?.sessionId || "");
  const manualWake = Boolean(options.manual);
  deps.ctx.scheduler.running = true;
  trackTaskStart();
  // 登记占用：唤醒续跑与前台任务共用同一条"会话忙"判定，这段无人值守执行期间
  // 渲染端发来的消息才会被排队而不是并发起第二个 run。
  // runId 一并下发给渲染端，让运行中的续跑也能被 ESC/停止按钮中止。
  const wakeRunId = crypto.randomUUID();
  const wakeAbort = new AbortController();
  // workspacePath 供渠道任务按工作区判忙；取不到时视为未知，不参与互斥
  if (wakeSessionId) deps.wakeRuns.set(wakeSessionId, {
    runId: wakeRunId, abort: wakeAbort, kind: "续跑任务",
    workspacePath: String(wake?.workspacePath || deps.ctx.sessions.get(wakeSessionId)?.workspacePath || ""),
  });
  try {
    // 状态广播放在 try 内：任何后续异常都必须走 finally 释放占用，否则这个会话会被永久锁死
    if (deps.mainWindow && !deps.mainWindow.isDestroyed()) {
      deps.mainWindow.webContents.send("wake:status", {
        sessionId: wake.sessionId,
        status: "running",
        runId: wakeRunId,
        wakeAt: wake.wakeAt,
        reason: wake.reason,
        ...(manualWake ? { manual: true } : {}),
      });
    }
    const settings = settingsForSession(await readSettings(), await deps.ctx.sessions.getAsync(wake.sessionId));
    if (!hasConfiguredModel(settings)) {
      throw new Error("此会话的模型配置不可用，请重新选择模型后继续");
    }
    const prior = await visibleConversationForSession(wake.sessionId, wake.prompt, wake.finalText);
    const workingContext = await workingContextForSession(wake.sessionId);
    const wakeGoal = queuedGoalPayload({}, deps.ctx.sessions.get(wake.sessionId) || {});
    const wakeText = `你于 ${new Date(wake.createdAt).toLocaleString("zh-CN")} 主动挂起（原因：${wake.reason}），现在到达约定时间 ${new Date(wake.wakeAt).toLocaleString("zh-CN")}，请继续完成任务。`
      + (wake.finalText ? `\n此前的进展：\n${wake.finalText}` : "");
    const collector = createTranscriptCollector({runId:wakeRunId});
    // 先发唤醒消息再开跑（与定时任务、渠道任务同一口径）：续跑开始前就把"谁在什么时候
    // 因为什么把任务唤醒"写进会话并推给界面。等收尾才和回答一起补上去的话，模型跑多久，
    // 用户在聊天里就有多久看不到这次唤醒的来由，中途崩溃/被关掉还会连同记录一起丢。
    const wakeSessionBefore = await deps.ctx.sessions.getAsync(wake.sessionId);
    // DSH 会话的唤醒提示就是 DSH 轮次正文（不带「（到点自动唤醒）」前缀），归档也按轮次回写；
    // 两处口径要一致，否则开跑前上屏的这条会在收尾归并时被改写一次。
    const wakeUserMessage = {
      id:`${wakeRunId}:user`,runId:wakeRunId,role:"user",
      content:wakeSessionBefore?.runtime === "dsh" ? wakeText : `（到点自动唤醒）${wakeText}`,
      createdAt:new Date().toISOString(),
    };
    if (wakeSessionBefore) {
      await deps.ctx.sessions.replace({...wakeSessionBefore,messages:mergeDshTranscript(wakeSessionBefore.messages || [],[wakeUserMessage]),updatedAt:new Date().toISOString()});
    } else {
      // 会话存档缺失（历史被清理过）时也要留痕：不建的话这次续跑整段都无处落地
      await deps.ctx.sessions.upsert({id:wake.sessionId,workspacePath:wake.workspacePath,
        createdAt:wakeUserMessage.createdAt,updatedAt:wakeUserMessage.createdAt,messages:[wakeUserMessage]});
    }
    if (deps.mainWindow && !deps.mainWindow.isDestroyed()) {
      deps.mainWindow.webContents.send("sessions:append", {
        runId:wakeRunId,sessionId: wake.sessionId,
        workspacePath: wake.workspacePath,
        messages:[wakeUserMessage],
      });
    }
    // 到点续跑的生效审批模式：interactive 提升为 auto；reviewer（替我审批）保持 reviewer，
    // 让审核助手继续逐条把关——工作区内的低风险操作（含带 rm/ffmpeg 的复合命令）由助手放行，
    // 只在越界、外发、破坏性或助手判不准时才转人工收件箱。降级成 auto 会让工作区内的 ask
    // 不经审核助手直接弹人工审批卡，无人值守反而更打扰（2026-10-02 到点续跑弹卡即此原因）。
    // full-access / deny-changes / auto 保持原模式，全局「完全访问权限」同样生效。
    // 折算规则见 settings.mts 的 wakeApprovalMode / unattendedApprovalMode（有单测钉住）。
    const approvalMode = wakeApprovalMode(settings.approvalMode, wake.approvalMode);
    const result = await deps.ctx.agent.run({
      runId:wakeRunId,
      settings,
      workspacePath: wake.workspacePath,
      sessionId: wake.sessionId,
      scheduleId: wake.scheduleId,
      approvalMode,
      // 唤醒记录仍登记原模式（下次续跑再评估提升）
      wakeApprovalMode: wake.approvalMode,
      prompt: wake.prompt,
      workingContext,
      goal: wakeGoal.goal,
      ...(wakeGoal.goal ? { loop: { enabled: true, iteration: 1, maximum: 10 } } : {}),
      conversation: [...prior, { role: "user", content: wakeText }],
      // 续跑中止信号：渲染端「停止」/ESC 能真正打断无人值守续跑
      signal: wakeAbort.signal,
      isCancelled: () => wakeAbort.signal.aborted,
      // 续跑无人值守：审批与提问进收件箱挂起等待；等待期间暂时释放 ctx.scheduler.running 锁，避免系统调度死锁 2 小时
      requestApproval: async (action, approvalSignal?: AbortSignal) => {
        const pending = deps.ctx.inbox.create({
          kind: "approval",
          sessionId: wake.sessionId,
          scheduleId: wake.scheduleId,
          tool: action.kind,
          title: `续跑任务申请：${action.title || action.kind}`,
          details: action.details,
          impact: action.impact,
        }, {signal: approvalSignal ? AbortSignal.any([approvalSignal, wakeAbort.signal]) : wakeAbort.signal});
        deps.ctx.scheduler.running = false;
        try {
          const resolution = await deps.ctx.inbox.awaitWithTimeout(pending, "审批等待超时，已自动取消", UNATTENDED_PENDING_TIMEOUT_MS);
          return Boolean(resolution?.ok);
        } finally {
          deps.ctx.scheduler.running = true;
        }
      },
      requestUserInput: (request, questionSignal?: AbortSignal) => {
        const pending = deps.ctx.inbox.create({
          kind: "question",
          sessionId: wake.sessionId,
          scheduleId: wake.scheduleId,
          question: request.question,
          options: request.options,
          title: "续跑任务提问",
          questionPresentation: request.answerFormat === 'dsh' ? request : undefined,
        }, { signal: questionSignal ? AbortSignal.any([questionSignal,wakeAbort.signal]) : wakeAbort.signal });
        deps.ctx.scheduler.running = false;
        try {
          return deps.ctx.inbox.awaitWithTimeout(pending, "提问等待超时，按已有信息继续", UNATTENDED_PENDING_TIMEOUT_MS);
        } finally {
          deps.ctx.scheduler.running = true;
        }
      },
      emit: (agentEvent) => {
        collector.handle(agentEvent);
        if (deps.mainWindow && !deps.mainWindow.isDestroyed() && deps.CHANNEL_STREAM_EVENT_TYPES.has(agentEvent?.type))
          deps.mainWindow.webContents.send('agent:event',{sessionId:wake.sessionId,runId:wakeRunId,wakeRun:true,event:agentEvent});
      },
      afterWakeRegister: async (wakeResult) => {
        if (wake.scheduleId) await deps.ctx.scheduler.markSleeping(wake.scheduleId, wakeResult.wake, wake.sessionId);
      },
    });
    if (result.status !== "sleeping" && wake.scheduleId) {
      await deps.ctx.scheduler.markFinished(wake.scheduleId, result.status === "done", result.finalText || result.reason || "没有产出结果", wake.sessionId, result.status);
    }
    const wakeContent = result.status === "sleeping" && result.wake
      ? `${result.finalText || ""}\n\n已再次挂起，将于 ${new Date(result.wake.wakeAt).toLocaleString("zh-CN")} 自动唤醒继续（原因：${result.wake.reason}）。`.trim()
      : undefined;
    const wakeMessages = collector.buildMessages(`（到点自动唤醒）${wakeText}`, result, wakeContent);
    const savedWake=await deps.ctx.sessions.getAsync(wake.sessionId);
    const settledWake = settledStoredGoal(savedWake, wakeGoal, result);
    if (savedWake) await deps.ctx.sessions.replace({...settledWake,messages:mergeDshTranscript(savedWake.messages || [],wakeMessages),updatedAt:new Date().toISOString()});
    if (deps.mainWindow && !deps.mainWindow.isDestroyed()) {
      // 唤醒消息已在开跑前上屏（见上面的 sessions:append），收尾只补助手消息，
      // 让同一轮用户消息只有一条；DSH 转录按轮次整段下发时不拆。
      const wakeTranscript = wakeMessages.some(message=>message.dshTurnId)
        ? wakeMessages : wakeMessages.filter(message=>message.role!=="user");
      deps.mainWindow.webContents.send("sessions:append", {
        runId:wakeRunId,sessionId: wake.sessionId,
        workspacePath: wake.workspacePath,
        messages: wakeTranscript,
        goalState: settledWake?.goalState,
      });
      deps.mainWindow.webContents.send('agent:event',{sessionId:wake.sessionId,runId:wakeRunId,wakeRun:true,event:{type:'agent-finished',result}});
    } else {
      // 窗口未运行：续跑转录追加落盘（按消息内容去重）
      if (!savedWake) await persistSessionAppend(wake.sessionId, wakeMessages);
    }
  } catch (error: any) {
    const errorReason = error instanceof Error ? error.message : String(error);
    console.error(`[wakes] 续跑任务异常 (${wake.sessionId}):`, errorReason);
    if (wake.scheduleId) {
      await deps.ctx.scheduler.markFinished(wake.scheduleId, false, errorReason, wake.sessionId);
    }
    const failureMessages = [
      {
        role: "assistant",
        content: `（到点自动唤醒失败）系统尝试唤醒任务时发生异常：${errorReason}`,
        createdAt: new Date().toISOString(),
        taskStatus: "error",
      },
    ];
    if (deps.mainWindow && !deps.mainWindow.isDestroyed()) {
      deps.mainWindow.webContents.send("sessions:append", {
        sessionId: wake.sessionId,
        workspacePath: wake.workspacePath,
        messages: failureMessages,
      });
    } else {
      await persistSessionAppend(wake.sessionId, failureMessages);
    }
  } finally {
    trackTaskEnd();
    deps.ctx.scheduler.running = false;
    // idle 必须带上本次续跑的 runId（渲染端按键比对清除可停止的 runId），
    // 且要在 drainSessionQueue 之前发出：出队消息的 queue-start 会写入新的 runId
    if (deps.mainWindow && !deps.mainWindow.isDestroyed()) {
      deps.mainWindow.webContents.send("wake:status", {
        sessionId: wake.sessionId,
        status: "idle",
        runId: wakeRunId,
      });
    }
    if (wakeSessionId) {
      deps.wakeRuns.delete(wakeSessionId);
      // 续跑期间用户在输入框发的消息已在队列里：这里与 executeAgentRun 同一出口推进，
      // 否则它们会一直卡在队列中（唤醒续跑不走 executeAgentRun 的 finally）
      try {
        drainSessionQueue(wakeSessionId);
      } catch (drainError: any) {
        console.warn("[wakes] 续跑收尾推进队列失败:", drainError);
      }
    }
  }
}




// ---- 定时任务完整留痕：镜像渲染端 App.tsx 的 agent 事件归约，headless 运行也产出完整过程 ----
// （活动流、文件变更、计划、用时），不再只存最终一句话。
function createTranscriptCollector(options: any = {}) {
  const runId = options.runId || crypto.randomUUID();
  const userId = options.userMessage?.id || `${runId}:user`;
  const assistantId = `${runId}:assistant`;
  let turns: any[] = [];
  let messages: any[] = [];
  let activeTurn: string | undefined;
  const patch = (update) => { messages = patchDshAssistant(messages,{assistantId,runId,turnId:activeTurn},update); };
  const activities = [];
  let changes = null;
  let plan = null;
  // 推理模型的思考流：事件带的是本次请求内的累积文本，保留最后一次即可
  let reasoning = null;
  const startedAt = Date.now();
  return {
    handle(agentEvent) {
      if (!agentEvent || typeof agentEvent !== "object") return;
      if (agentEvent.type === 'dsh-conversation') {
        turns = agentEvent.turns;
        activeTurn = turns.at(-1)?.user.id;
        if (!messages.length) messages = [
          {...options.userMessage,id:userId,role:'user',content:turns[0]?.user.text || '',createdAt:new Date(startedAt).toISOString(),runId},
          {id:assistantId,role:'assistant',content:'',createdAt:new Date(startedAt).toISOString(),runId,activities:[]},
        ];
        messages = reconcileDshMessages(messages,turns,{userId,assistantId,runId,live:true});
      } else if (agentEvent.type === "activity" && agentEvent.activity) {
        activities.push({ ...agentEvent.activity });
        patch(message=>({...message,activities:[...(message.activities || []),{...agentEvent.activity}]}));
      } else if (agentEvent.type === "activity-update") {
        // 定时任务、唤醒与渠道共用这份存档；不能只保存思考/工具详情，
        // 否则中途正文与思考耗时在收尾替换实时消息时会丢失。
        const update = {
          status: agentEvent.status,
          ...(agentEvent.detail !== undefined ? { detail: agentEvent.detail } : {}),
          ...(agentEvent.durationMs !== undefined ? { durationMs: agentEvent.durationMs } : {}),
          ...(agentEvent.commentary !== undefined ? { commentary: agentEvent.commentary } : {}),
        };
        const activity = activities.find((item) => item.id === agentEvent.id);
        if (activity) Object.assign(activity, update);
        messages = messages.map(message=>({...message,activities:message.activities?.map(item=>item.id===agentEvent.id ? {...item,...update} : item)}));
      } else if (agentEvent.type === "file-change") {
        patch(message=>({...message,changes:agentEvent.changes}));
        changes = agentEvent.changes;
      } else if (agentEvent.type === "plan-update") {
        patch(message=>({...message,plan:agentEvent.steps}));
        plan = agentEvent.steps;
      } else if (agentEvent.type === "assistant-reasoning") {
        reasoning = String(agentEvent.text || "");
      }
    },
    // 供渠道任务收尾事件读取当前的文件变更与计划快照（只读，不改内部状态）
    changes: () => changes,
    plan: () => plan,
    // 注意：assistantContent 必须是「可选」而不是给默认值 ""。三处收尾调用只传
    // 2 个参数（定时任务 finished、渠道纯文本收尾、唤醒未再次挂起时传 undefined），
    // 依赖 `assistantContent ?? fallback` 回退到 result.finalText；默认成 "" 会让
    // `"" ?? fallback` 仍是空串，落盘/回传的助手正文变空。
    buildMessages(userText, result, assistantContent?: string) {
      const finalPlan = plan;
      const base = [
        { ...options.userMessage, id:userId, runId, role: "user", content: userText, createdAt: new Date(startedAt).toISOString() },
        {
          id:assistantId, runId, role: "assistant",
          content: assistantContent ?? (result.finalText || result.reason || "（没有产出内容）"),
          createdAt: new Date().toISOString(),
          activities: activities.map((item) => ({ ...item })),
          durationMs: Date.now() - startedAt,
          taskStatus: result?.status,
          ...(reasoning ? { reasoning } : {}),
          ...(changes?.length ? { changes: changes.map((item) => ({ ...item })) } : {}),
          ...(finalPlan?.length ? { plan: finalPlan.map((item) => ({ ...item })) } : {}),
          ...(Array.isArray(result?.executedMessages) && result.executedMessages.length ? { executedMessages: result.executedMessages } : {}),
          ...(result?.workingContext ? { workingContext: result.workingContext } : {}),
        },
      ];
      const finalTurns = result.dshTurns || turns;
      if (!finalTurns.length) return base;
      if (!messages.length) messages = base;
      else patch(message=>({...message,...base[1],id:message.id,
        activities:message.activities || [],reasoning:message.reasoning || base[1].reasoning}));
      return reconcileDshMessages(messages,finalTurns,{userId,assistantId,runId,finalContent:assistantContent});
    },
  };
}

async function runScheduledTask(record, meta) {
  deps.ctx.scheduler.running = true;
  trackTaskStart();
  broadcastSchedulesChanged();
  // 本次执行的会话 id：收件箱条目、审计记录与最终留痕会话共用同一个
  const scheduleSessionId = crypto.randomUUID();
  // 实时转发的运行标识 + 会话标题：与渠道运行同一套信封（用 scheduleRun 打标区分）
  const scheduleRunId = scheduleSessionId;
  const scheduleAbort = new AbortController();
  deps.entryRuns.set(scheduleSessionId,{runId:scheduleRunId,abort:scheduleAbort,kind:"定时任务",
    workspacePath:String(record.workspacePath || "")});
  const scheduleTitle = `计划：${String(record.name || "未命名").slice(0, 24)}`;
  const scheduleStartedAt = new Date().toISOString();
  const collector = createTranscriptCollector({runId:scheduleRunId});
  // 起跑前先建会话：界面立刻能看到"这次运行",后续事件边跑边填,不用等任务结束
  sendScheduleRunStarted({
    sessionId: scheduleSessionId,
    runId: scheduleRunId,
    scheduleId: String(record.id || ""),
    runtime:record.runtime === 'dsh' ? 'dsh' : 'dyworker',
    title: scheduleTitle,
    workspacePath: record.workspacePath,
    prompt: record.prompt,
    startedAt: scheduleStartedAt,
    manual: Boolean(meta?.manual),
  });
  // 运行期把关键 agent 事件实时转发（白名单与渠道运行共用；trace/token-usage 只进本地留痕）。
  // 定义在 try 之外：catch 路径也要用它发收尾事件，若只在 try 内定义，
  // 早于定义行抛出的异常会让 catch 再抛 ReferenceError、吞掉真实错误。
  const forwardRunEvent = (agentEvent) => {
    if (!deps.mainWindow || deps.mainWindow.isDestroyed()) return;
    if (!deps.CHANNEL_STREAM_EVENT_TYPES.has(agentEvent?.type)) return;
    deps.mainWindow.webContents.send("agent:event", {
      sessionId: scheduleSessionId,
      runId: scheduleRunId,
      scheduleRun: true,
      event: agentEvent,
    });
  };
  // 收尾：把权威转录交给渲染端（原位归并进运行开始时建的会话）或直接落盘。
  // 运行开始/结束是两条路径：起跑下发 schedules:run-started 建会话，收尾用 sessions:prepend
  // 下发完整转录（渲染端按会话 id 归并，不会出现两条同 id 会话）。
  const finishSession = async (messages) => {
    const session = {
      id: scheduleSessionId,runtime:record.runtime === 'dsh' ? 'dsh' : 'dyworker',
      title: scheduleTitle,
      workspacePath: record.workspacePath,
      createdAt: scheduleStartedAt,
      updatedAt: new Date().toISOString(),
      messages,
    };
    const priorSession=await deps.ctx.sessions.getAsync(scheduleSessionId);
    session.messages=mergeDshTranscript(priorSession?.messages || [],session.messages);
    await persistSessionRecord(session);
    if (deps.mainWindow && !deps.mainWindow.isDestroyed()) deps.mainWindow.webContents.send("sessions:prepend", session);
  };
  try {
    const settings = await readSettings();
    if (!hasConfiguredModel(settings)) {
      throw new Error("模型还没有配置，无法执行定时任务");
    }
    await deps.ctx.sessions.upsert({id:scheduleSessionId,runtime:record.runtime === 'dsh' ? 'dsh' : 'dyworker',
      title:scheduleTitle,workspacePath:record.workspacePath,createdAt:scheduleStartedAt,updatedAt:scheduleStartedAt,
      messages:[{id:`${scheduleRunId}:user`,runId:scheduleRunId,role:'user',content:record.prompt,createdAt:scheduleStartedAt}]});
    const result = await deps.ctx.agent.run({
      runtime:record.runtime === 'dsh' ? 'dsh' : 'dyworker',runId:scheduleRunId,
      signal:scheduleAbort.signal,isCancelled:()=>scheduleAbort.signal.aborted,
      settings,
      workspacePath: record.workspacePath,
      sessionId: scheduleSessionId,
      scheduleId: record.id,
      // 计划任务自身只有"是否允许写工作区"（reviewer / deny-changes）；
      // 用户全局选了「完全访问权限」时同样生效，否则会出现界面显示完全访问、
      // 计划任务却逐条弹审批卡的口径分裂（渠道任务一直按全局模式运行）。
      approvalMode: unattendedApprovalMode(settings.approvalMode, record.allowWorkspaceWrites ? "reviewer" : "deny-changes"),
      prompt: record.prompt,
      conversation: [{ role: "user", content: record.prompt }],
      // 无人值守：需要确认的操作与提问进审批收件箱挂起等待（2 小时上限，超时按拒绝处理）
      requestApproval: async (action, approvalSignal?: AbortSignal) => {
        const pending = deps.ctx.inbox.create({
          kind: "approval",
          sessionId: scheduleSessionId,
          scheduleId: record.id,
          tool: action.kind,
          title: `定时任务「${record.name || "未命名"}」申请：${action.title || action.kind}`,
          details: action.details,
          impact: action.impact,
        }, {signal: approvalSignal ? AbortSignal.any([approvalSignal, scheduleAbort.signal]) : scheduleAbort.signal});
        deps.ctx.scheduler.running = false;
        try {
          const resolution = await deps.ctx.inbox.awaitWithTimeout(pending, "审批等待超时，已自动取消", UNATTENDED_PENDING_TIMEOUT_MS);
          return Boolean(resolution?.ok);
        } finally {
          deps.ctx.scheduler.running = true;
        }
      },
      requestUserInput: (request, questionSignal?: AbortSignal) => {
        const pending = deps.ctx.inbox.create({
          kind: "question",
          sessionId: scheduleSessionId,
          scheduleId: record.id,
          question: request.question,
          options: request.options,
          title: `定时任务「${record.name || "未命名"}」提问`,
          questionPresentation: request.answerFormat === 'dsh' ? request : undefined,
        }, { signal: questionSignal ? AbortSignal.any([questionSignal,scheduleAbort.signal]) : scheduleAbort.signal });
        deps.ctx.scheduler.running = false;
        try {
          return deps.ctx.inbox.awaitWithTimeout(pending, "提问等待超时，按已有信息继续", UNATTENDED_PENDING_TIMEOUT_MS);
        } finally {
          deps.ctx.scheduler.running = true;
        }
      },
      emit: (agentEvent) => {
        collector.handle(agentEvent);
        // 留痕与实时转发各走各的：collector 收全量（含 trace），界面只收影响 UI 白名单事件
        forwardRunEvent(agentEvent);
      },
      afterWakeRegister: async (wakeResult) => {
        await deps.ctx.scheduler.markSleeping(record.id, wakeResult.wake, scheduleSessionId);
      },
    });
    if (result.status === "sleeping" && result.wake) {
      // 主动挂起：登记唤醒与 sleeping 标记已在服务内完成，这里只做留痕
      const sleepingMessages = collector.buildMessages(
        record.prompt,
        result,
        `${result.finalText || ""}\n\n已主动挂起，将于 ${new Date(result.wake.wakeAt).toLocaleString("zh-CN")} 自动唤醒继续（原因：${result.wake.reason}）。`.trim(),
      );
      await finishSession(sleepingMessages);
      return;
    }
    await deps.ctx.scheduler.markFinished(record.id, result.status === "done", result.finalText || result.reason || "没有产出结果", scheduleSessionId, result.status);
    await finishSession(collector.buildMessages(record.prompt, result));
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.ctx.scheduler.markFinished(record.id, false, message, scheduleSessionId);
    // 失败也要收口：运行开始时已经建过会话并标了"运行中"，不收尾的话界面上的气泡
    // 会永远停在执行中，用户看不到失败原因（以前失败路径连会话都不落）
    try {
      await finishSession(collector.buildMessages(
        record.prompt,
        { status: "error", finalText: `计划执行失败：${message}`, reason: message },
      ));
    } catch (finishError: any) {
      console.log(`[schedules] 失败收尾落盘失败：${finishError?.message || finishError}`);
    }
  } finally {
    deps.entryRuns.delete(scheduleSessionId);
    trackTaskEnd();
    deps.ctx.scheduler.running = false;
    drainSessionQueue(scheduleSessionId);
    broadcastSchedulesChanged();
  }
}
  return { runScheduledTask, resumeWake, createTranscriptCollector };
}
