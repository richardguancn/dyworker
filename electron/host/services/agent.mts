// 代理服务：四个任务入口（桌面会话 / 定时唤醒续跑 / 定时任务 / IM 渠道）
// 统一的 runAgent 装配与收尾。此前每个入口各自拼 ~15 项公共选项
// （hooks/记忆页/技能/常驻规则/审计/MCP 工具/守卫回调）并重复实现
// 记忆落盘与 sleeping→唤醒登记；现在由本服务一次实现，入口只声明差异。
//
// 领域解析器（resolvers）由宿主注入：记忆/技能/唤醒/MCP 目前仍是 main.mts
// 的领域函数，后续插件化（ctx.memory/ctx.skills/...）后逐一替换。
// 本文件不依赖 electron，node --test 直测。
import { Service } from "cordis";
import { runAgent } from "../../agent.mts";
import "../events.mts";

declare module "cordis" {
  interface Context {
    agent: AgentService;
  }
}

// 循环续跑的推进提示（原 desktop 入口逐字保留）
const LOOP_CONTINUE_PROMPT = "请继续推进任务：实际检查结果，完成剩余工作，全部满足验收条件后再交付。";

export class AgentService extends Service {
  resolvers;
  startBackgroundTask;

  constructor(ctx, config = {} as any) {
    super(ctx, "agent");
    this.resolvers = config.resolvers;
    this.startBackgroundTask = config.startBackgroundTask;
  }

  // 入口取消信号（agentState.cancelled、渠道中止表等）与全局退出信号合并
  combinedIsCancelled(options) {
    return () => Boolean(this.resolvers.isShuttingDown() || options.isCancelled?.());
  }

  async run(options = {} as any) {
    const { settings, sessionId, approvalMode, prompt = "" } = options;
    // 渠道任务的 workspacePath 会被 switch_workspace 工具中途改写：支持传函数，
    // 运行起始用调用时的值，记忆落盘/唤醒登记用当时的最新值
    const resolveWorkspacePath = () => String(
      typeof options.workspacePath === "function" ? options.workspacePath() : options.workspacePath || "",
    ).trim();
    const workspacePath = resolveWorkspacePath();
    const isCancelled = this.combinedIsCancelled(options);
    // MCP 工具由服务统一装配；入口通过 extraTools 追加渠道媒体等额外工具
    const extraTools = [
      ...this.resolvers.agentExtraTools(await this.resolvers.mcpExtraTools(settings)),
      ...(options.extraTools || []),
    ];
    // 外部工具路由：入口可传入定制路由（渠道媒体接管/工作区切换重建），否则按
    // routerOptions 自建；dispose 统一在收尾执行（含入口定制路由的 .dispose）
    const onExtraTool = options.onExtraTool
      ?? this.resolvers.createExtraToolRouter(settings, workspacePath, options.routerOptions);
    const emit = (agentEvent) => {
      if (agentEvent?.type === "skill-saved") void this.resolvers.appendSkill(agentEvent.item);
      if (agentEvent?.type === "token-usage") void this.resolvers.appendUsageStat(agentEvent);
      options.emit?.(agentEvent);
    };
    const loop = options.loop || { enabled: false, iteration: 1, maximum: 1 };
    let iterationMessages = options.conversation;
    try {
      while (true) {
        if (options.loopStateEvents) {
          emit({ type: "loop-state", active: loop.enabled, iteration: loop.iteration, maximum: loop.maximum, status: "正在执行" });
        }
        const result = await runAgent({
          settings,
          workspacePath,
          ...(options.contextLimit !== undefined ? { contextLimit: options.contextLimit } : {}),
          ...(options.workingContext !== undefined ? { workingContext: options.workingContext } : {}),
          hooks: await this.resolvers.readHooks(workspacePath),
          ...(options.goal !== undefined ? { goal: options.goal } : {}),
          conversation: iterationMessages,
          memoryPages: await this.resolvers.readMemoryPages(sessionId),
          memoryReviewDue: true,
          skills: await this.resolvers.readSkills(workspacePath),
          history: this.resolvers.history(),
          loop,
          approvalMode,
          standingRules: await this.resolvers.readStandingRules(),
          audit: (entry) => this.resolvers.auditRecord({ ...entry, ...(options.auditExtras || {}), sessionId, approvalMode }),
          extraTools,
          onExtraTool,
          // 插件策略接缝：tools/pre-execute waterfall 事件（见 host/events.mts）。
          // 用户/工作区钩子在 runAgent 内先行判定，事件只能追加限制
          beforeToolExecute: async ({ name, args }) => {
            return await this.ctx.waterfall("tools/pre-execute", name, args, null);
          },
          emit,
          isCancelled,
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          sleepGuard: () => this.resolvers.hasPendingWakeForSession(sessionId),
          sessionId,
          startBackgroundTask: (p) => this.startBackgroundTask({ ...p, sessionId: p.sessionId || sessionId }),
          requestApproval: options.requestApproval,
          requestUserInput: options.requestUserInput,
        });
        // 每轮任务结束前都做记忆复盘落盘（四个入口原行为一致）
        const memoryWorkspacePath = resolveWorkspacePath();
        for (const memory of this.resolvers.memoriesFromAgentResult(result)) {
          if (isCancelled()) break;
          await this.resolvers.appendMemory(memory, memoryWorkspacePath, sessionId);
        }
        if (isCancelled()) {
          await options.onCancelled?.();
          return { status: "cancelled", finalText: result.finalText || "" };
        }
        if (result.status === "sleeping" && result.wake) {
          // 主动挂起（self-wake）：登记唤醒记录，到点由调度 tick 续跑
          await this.resolvers.registerWake({
            sessionId,
            ...(options.scheduleId ? { scheduleId: options.scheduleId } : {}),
            workspacePath: resolveWorkspacePath(),
            // 续跑入口把运行模式提升为 auto，但唤醒记录仍登记原模式
            approvalMode: options.wakeApprovalMode ?? approvalMode,
            wake: result.wake,
            prompt,
            finalText: result.finalText,
          });
          if (isCancelled()) {
            await options.onCancelled?.();
            return { status: "cancelled", finalText: result.finalText || "" };
          }
          // 唤醒登记后的入口收尾（定时计划标记 sleeping 等）
          await options.afterWakeRegister?.(result);
          return result;
        }
        const shouldContinue = loop.enabled
          && result.status === "done"
          && !result.finish
          && loop.iteration < loop.maximum;
        if (!shouldContinue) return result;
        loop.iteration += 1;
        iterationMessages = [
          ...iterationMessages,
          { role: "assistant", content: result.finalText || "" },
          { role: "user", content: LOOP_CONTINUE_PROMPT },
        ];
      }
    } finally {
      try {
        onExtraTool?.dispose?.();
      } catch (disposeError: any) {
        console.warn("[agent] onExtraTool dispose failed:", disposeError);
      }
    }
  }
}
