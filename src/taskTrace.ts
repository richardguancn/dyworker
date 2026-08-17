// process-chain 归约层：从统一事件流构建「需求 → 计划 → 执行 → 验证 → 修复 → 交付」链路树。
// 纯函数、全部字段可选、向后兼容：老会话（没有新字段）时 hasTrace=false，界面回退现有卡片。
// 事件源是渲染端 onAgentEvent 收集到的 AgentEvent 列表（含 trace 投影与 branch 分支事件）。
import type { ActivityRecord, AgentEvent, FileChange, PlanStep, TraceEvent } from "./types";

export type TaskPhase = "plan" | "execute" | "verify" | "fix" | "deliver";

export interface TaskTraceStep {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
  // 挂在该步骤下的活动（按时间顺序；超过上限时折叠为摘要）
  activities: ActivityRecord[];
  // 该步骤产生的文件变更
  changes: FileChange[];
  // 失败 → 修复重试组（同一步骤内 verify 失败后 fix 成功配对）
  retries: Array<{ failed: ActivityRecord; fixed: ActivityRecord }>;
}

export interface TaskTraceBranch {
  parentActivityId: string;
  title: string;
  depth: number;
  activities: ActivityRecord[];
  // 子代理最终结果摘要（最后一个非 thinking 活动的内容，可为空）
  result?: string;
}

export interface TaskTrace {
  // 本条用户消息摘要
  request: string;
  // plan 步骤；没有 plan-update 时退化为一个「执行」默认步骤（老会话兼容）
  steps: TaskTraceStep[];
  // 子代理分支
  branches: TaskTraceBranch[];
  // 未能挂到具体步骤的变更（无 plan 或 plan 已完成的步骤之后）
  changes: FileChange[];
  // 交付：agent-finished 的最终答复、耗时与状态
  deliver?: { text: string; durationMs: number; status: string };
  // 是否有新事件流数据；false = 老会话，界面用现有卡片
  hasTrace: boolean;
}

const ACTIVITY_LIMIT = 50;
const BRANCH_DEPTH_LIMIT = 3;
const TRACE_EVENT_TYPES = new Set(["trace", "activity", "activity-update", "plan-update", "file-change", "agent-finished"]);

export function buildTaskTrace(events: AgentEvent[], request = ""): TaskTrace {
  const steps = new Map<string, TaskTraceStep>();
  const defaultStepId = "__default__";
  steps.set(defaultStepId, { id: defaultStepId, title: "执行", status: "in_progress", activities: [], changes: [], retries: [] });
  // 最近一次 plan-update 的步骤顺序（无 plan 时保持默认步骤）
  let planOrder: string[] = [defaultStepId];
  let currentStepId = defaultStepId;
  const branches = new Map<string, TaskTraceBranch>();
  const activitiesById = new Map<string, ActivityRecord>();
  // 等待 fix 配对的 verify 失败活动（按步骤 id 分组）
  const pendingVerifyFails = new Map<string, ActivityRecord>();
  const unassignedChanges: FileChange[] = [];
  let finished = false;
  // 有新字段（trace 事件、活动带 phase/stepId/branch、计划步骤带 id）才算新事件流；老会话降级
  let hasTrace = false;
  const branchLastActivity = new Map<string, ActivityRecord>();

  const ensureStep = (stepId: string): TaskTraceStep => {
    let step = steps.get(stepId);
    if (!step) {
      step = { id: stepId, title: "执行", status: "in_progress", activities: [], changes: [], retries: [] };
      steps.set(stepId, step);
    }
    return step;
  };

  for (const event of events) {
    if (!event) continue;
    if (event.type === "trace") hasTrace = true;
    if (event.type === "activity" && (event.activity?.phase || event.activity?.stepId || event.activity?.branch)) hasTrace = true;
    if (event.type === "activity-update" && event.branch) hasTrace = true;
    if (event.type === "plan-update") {
      if ((event.steps || []).some((step) => step.id)) hasTrace = true;
      const ordered: string[] = [];
      for (const step of event.steps || []) {
        const stepId = step.id || `plan-${step.title}`;
        const existing = steps.get(stepId);
        if (existing) {
          existing.title = step.title;
          existing.status = step.status;
        } else {
          steps.set(stepId, { id: stepId, title: step.title, status: step.status, activities: [], changes: [], retries: [] });
        }
        ordered.push(stepId);
      }
      planOrder = ordered.length ? ordered : planOrder;
      const inProgress = (event.steps || []).find((step) => step.status === "in_progress");
      if (inProgress?.id) currentStepId = inProgress.id;
      continue;
    }
    if (event.type === "activity") {
      const activity = event.activity;
      if (!activity) continue;
      activitiesById.set(activity.id, activity);
      if (activity.kind === "thinking") continue;
      if (activity.branch) {
        // 子代理分支：按父活动 id 归并
        const key = activity.branch.parentId || activity.branch.title || "sub";
        const depth = Math.min(activity.branch.depth || 1, BRANCH_DEPTH_LIMIT);
        let branch = branches.get(key);
        if (!branch) {
          branch = { parentActivityId: key, title: activity.branch.title || "子任务", depth, activities: [] };
          branches.set(key, branch);
        }
        if (branch.activities.length < ACTIVITY_LIMIT) {
          branch.activities.push(activity);
          branchLastActivity.set(key, activity);
        }
        continue;
      }
      const stepId = activity.stepId || currentStepId;
      const step = ensureStep(stepId);
      if (step.activities.length < ACTIVITY_LIMIT) step.activities.push(activity);
      continue;
    }
    if (event.type === "activity-update") {
      const existing = activitiesById.get(event.id);
      if (!existing) continue;
      const updated = { ...existing, status: event.status, detail: event.detail ?? existing.detail };
      activitiesById.set(event.id, updated);
      // 在主活动列表里同步状态
      const targetStepId = updated.stepId || currentStepId;
      const step = steps.get(targetStepId);
      if (step) {
        const index = step.activities.findIndex((activity) => activity.id === event.id);
        if (index >= 0) step.activities[index] = updated;
      }
      // 分支活动状态同步
      for (const branch of branches.values()) {
        const index = branch.activities.findIndex((activity) => activity.id === event.id);
        if (index >= 0) {
          branch.activities[index] = updated;
          branchLastActivity.set(branch.parentActivityId, updated);
        }
      }
      // verify 失败 → 记入待配对；fix 成功 → 与最近的失败配对成重试组
      if (updated.phase === "verify" && updated.status === "error") {
        pendingVerifyFails.set(updated.stepId || currentStepId, updated);
      } else if (updated.phase === "fix" && updated.status === "success") {
        const stepId = updated.stepId || currentStepId;
        const failed = pendingVerifyFails.get(stepId);
        if (failed) {
          pendingVerifyFails.delete(stepId);
          const step = ensureStep(stepId);
          if (step.retries.length < 10) step.retries.push({ failed, fixed: updated });
        }
      }
      continue;
    }
    if (event.type === "file-change") {
      const step = steps.get(currentStepId);
      if (step && planOrder.length > 1) {
        // 有明确 plan 时把变更挂到当前执行步骤
        for (const change of event.changes || []) {
          if (!step.changes.some((item) => item.path === change.path)) step.changes.push(change);
        }
      } else {
        for (const change of event.changes || []) {
          if (!unassignedChanges.some((item) => item.path === change.path)) unassignedChanges.push(change);
        }
      }
      continue;
    }
    if (event.type === "agent-finished") {
      finished = true;
      const result = event.result;
      if (result) {
        const changes = result.changes || [];
        for (const change of changes) {
          if (!unassignedChanges.some((item) => item.path === change.path)) unassignedChanges.push(change);
        }
      }
      continue;
    }
  }

  // 分支结果摘要：取分支内最后一个非 thinking 活动的 detail 或 title
  for (const branch of branches.values()) {
    const last = branchLastActivity.get(branch.parentActivityId);
    if (last && (last.detail || last.title)) branch.result = (last.detail || last.title).slice(0, 120);
  }

  // 交付信息：从 events 里补 agent-finished 的耗时与状态
  const finishedEvent = [...events].reverse().find((event) => event.type === "agent-finished");
  // durationMs 由渲染端运行时计算（从任务开始到结束），事件流里不携带；这里先占位，调用方可补充
  const deliver = finishedEvent?.type === "agent-finished" && finishedEvent.result
    ? {
        text: finishedEvent.result.finalText || "",
        durationMs: 0,
        status: finishedEvent.result.status || "done",
      }
    : undefined;

  const stepList = planOrder
    .map((id) => steps.get(id))
    .filter((step): step is TaskTraceStep => Boolean(step))
    .map((step) => ({
      ...step,
      // 把该步骤的变更合并进去（plan 步骤里的变更已在事件处理时挂入）
      changes: step.changes,
    }));
  // 默认步骤（无 plan）时把它作为唯一步骤展示
  if (stepList.length === 1 && stepList[0].id === defaultStepId) {
    stepList[0].changes = unassignedChanges;
  }

  void finished;

  return {
    request,
    steps: stepList,
    branches: [...branches.values()].sort((a, b) => a.depth - b.depth),
    changes: unassignedChanges,
    ...(deliver ? { deliver } : {}),
    hasTrace,
  };
}

// 供测试与调试：把 trace 事件流（TraceEvent[]）归一为 AgentEvent[] 再归约。
// trace 投影与旧事件内容重叠，优先用旧事件（activity/plan-update/file-change/agent-finished），
// trace 只在旧事件缺失时兜底（如历史回放只读到了 trace 文件）。
export function traceEventsToAgentEvents(traces: TraceEvent[]): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const trace of traces) {
    if (trace.kind === "activity") {
      events.push({
        type: "activity",
        activity: {
          id: String(trace.activityId || `trace-act-${trace.seq}`),
          kind: "run_command",
          title: String(trace.title || ""),
          detail: String(trace.content || ""),
          status: "running",
          ...(typeof trace.phase === "string" ? { phase: trace.phase as ActivityRecord["phase"] } : {}),
          ...(typeof trace.stepId === "string" ? { stepId: trace.stepId } : {}),
          ...(trace.branch && typeof trace.branch === "object" ? { branch: trace.branch as ActivityRecord["branch"] } : {}),
        },
      });
    } else if (trace.kind === "activity-update") {
      let status: "error" | "success" | "running" = trace.status === "error" ? "error" : trace.status === "success" ? "success" : "running";
      let detail: string | undefined;
      try {
        const parsed = JSON.parse(String(trace.content || ""));
        if (parsed && typeof parsed === "object") {
          status = parsed.status === "error" ? "error" : parsed.status === "success" ? "success" : "running";
          if (typeof parsed.detail === "string" && parsed.detail) detail = parsed.detail;
        }
      } catch {
        // 旧格式（纯状态字符串）或非法 JSON：按 trace.status 兜底
      }
      events.push({
        type: "activity-update",
        id: String(trace.activityId || ""),
        status,
        ...(detail ? { detail } : {}),
        ...(trace.branch && typeof trace.branch === "object" ? { branch: trace.branch as ActivityRecord["branch"] } : {}),
      });
    } else if (trace.kind === "plan-update") {
      const steps = JSON.parse(String(trace.content || "[]")) as PlanStep[];
      events.push({ type: "plan-update", steps });
    } else if (trace.kind === "file-change") {
      const changes = JSON.parse(String(trace.content || "[]")) as FileChange[];
      events.push({ type: "file-change", changes });
    } else if (trace.kind === "agent-finished") {
      const result = JSON.parse(String(trace.content || "{}")) as { status: string; finalText: string; durationMs?: number; changes?: FileChange[] };
      events.push({
        type: "agent-finished",
        result: {
          status: result.status === "done" ? "done" : "error",
          finalText: result.finalText || "",
          ...(typeof result.durationMs === "number" ? { durationMs: result.durationMs } : {}),
          ...(Array.isArray(result.changes) ? { changes: result.changes } : {}),
        },
      });
    }
  }
  return events;
}
