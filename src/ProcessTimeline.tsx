// process-chain 视图层：对话「需求 → 实现」链路时间线。
// 数据来自 src/taskTrace.ts 的 buildTaskTrace 归约结果（事件层 trace 投影 + 活动/计划/变更事件）。
// 纯展示组件：状态色、分支缩进、失败重试环、交付收口；点击定位到消息 / 文件差异。
// 老会话（hasTrace=false）由父组件决定是否渲染（不渲染即回退现有卡片）。
import { useMemo, useState } from "react";
import {
  Activity, Check, ChevronDown, ChevronRight, Circle, FileDiff,
  GitBranch, ListTodo, LoaderCircle, PackageCheck, RotateCcw,
  Target, X, Zap,
} from "lucide-react";
import type { ActivityRecord, FileChange } from "./types";
import type { TaskTrace, TaskTraceBranch, TaskTraceStep } from "./taskTrace";

export interface ProcessTimelineProps {
  trace: TaskTrace;
  /** 点击「定位消息」时回调（滚动到对应消息） */
  onLocateMessage?: () => void;
  /** 点击某条文件变更时回调（右侧审阅窗口打开 diff） */
  onOpenReview?: (changes: FileChange[]) => void;
  /** 点击「查看日志」时回调（打开轨迹控制台） */
  onLocateLog?: () => void;
}

// —— 小工具 ——

function phaseLabel(phase?: string): string {
  const labels: Record<string, string> = {
    plan: "计划", execute: "执行", verify: "验证", fix: "修复", deliver: "交付",
  };
  return phase ? labels[phase] || phase : "";
}

function statusIcon(status: ActivityRecord["status"]) {
  if (status === "success") return <Check size={12} className="pt-ok" />;
  if (status === "error") return <X size={12} className="pt-fail" />;
  return <LoaderCircle size={12} className="pt-spin spin" />;
}

function clampText(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

// —— 活动行（可展开详情）——

function ActivityRow({ activity, depth }: { activity: ActivityRecord; depth: number }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(activity.detail);
  return (
    <div className="pt-activity" style={{ paddingLeft: 8 + depth * 16 }}>
      <button
        type="button"
        className={`pt-activity-main ${hasDetail ? "clickable" : ""}`}
        onClick={() => hasDetail && setOpen((value) => !value)}
        aria-expanded={open}
        title={activity.title}
      >
        {statusIcon(activity.status)}
        <span className="pt-activity-title">{activity.title || "(无标题活动)"}</span>
        {phaseLabel(activity.phase) && <span className={`pt-phase pt-phase-${activity.phase}`}>{phaseLabel(activity.phase)}</span>}
        {hasDetail && <span className="pt-activity-toggle">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>}
      </button>
      {open && hasDetail && (
        <pre className="pt-activity-detail">{activity.detail}</pre>
      )}
    </div>
  );
}

// —— 文件变更行（点击打开审阅）——

function ChangeRows({ changes, onOpenReview }: { changes: FileChange[]; onOpenReview?: (changes: FileChange[]) => void }) {
  if (!changes.length) return null;
  return (
    <div className="pt-changes">
      {changes.map((change) => (
        <button
          type="button"
          key={change.path}
          className={`pt-change clickable ${onOpenReview ? "" : "noop"}`}
          onClick={() => onOpenReview?.([change])}
          title="点击在右侧审阅窗口查看差异"
        >
          <FileDiff size={12} />
          <span className="pt-change-path">{change.path}</span>
          <span className="pt-change-nums">
            {change.added > 0 && <span className="pt-add">+{change.added}</span>}
            {change.removed > 0 && <span className="pt-del">-{change.removed}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

// —— 重试环（验证失败 → 修复 → 成功）——

function RetryLoops({ step }: { step: TaskTraceStep }) {
  if (!step.retries.length) return null;
  return (
    <div className="pt-retries">
      {step.retries.map((retry, index) => (
        <div className="pt-retry" key={`${step.id}-retry-${index}`}>
          <span className="pt-retry-node pt-retry-fail" title="验证失败">
            <X size={12} /> 失败
          </span>
          <RotateCcw size={12} className="pt-retry-arrow" />
          <span className="pt-retry-node pt-retry-fix" title="修复后重试">
            <RotateCcw size={12} /> 重试
          </span>
          <span className="pt-retry-node pt-retry-ok" title="重试成功">
            <Check size={12} /> 通过
          </span>
          {retry.failed.title && <span className="pt-retry-detail">{clampText(retry.failed.title, 80)}</span>}
        </div>
      ))}
    </div>
  );
}

// —— 单个计划步骤节点 ——

function StepNode({ step, onOpenReview }: { step: TaskTraceStep; onOpenReview?: (changes: FileChange[]) => void }) {
  const [open, setOpen] = useState(true);
  const completed = step.status === "completed";
  const failedActivities = step.activities.filter((activity) => activity.status === "error").length;
  return (
    <div className={`pt-step ${step.status}`}>
      <div className="pt-node-head">
        <span className="pt-node-icon">
          {completed ? <Check size={14} /> : step.status === "in_progress" ? <LoaderCircle size={14} className="pt-spin spin" /> : <Circle size={12} />}
        </span>
        <button
          type="button"
          className="pt-node-title clickable"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {step.title || "执行"}
        </button>
        <span className="pt-node-meta">
          {failedActivities > 0 && <span className="pt-meta-fail">{failedActivities} 步失败</span>}
          {step.retries.length > 0 && <span className="pt-meta-retry">{step.retries.length} 次重试</span>}
          {step.activities.length > 0 && <span className="pt-meta-count">{step.activities.length} 步</span>}
          {step.changes.length > 0 && <span className="pt-meta-count">{step.changes.length} 个文件</span>}
          <span className="pt-node-toggle">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        </span>
      </div>
      {open && (
        <div className="pt-node-body">
          {step.activities.length === 0 && step.retries.length === 0 && step.changes.length === 0 && (
            <div className="pt-empty">该步骤暂无展开记录</div>
          )}
          {step.activities.map((activity) => <ActivityRow key={activity.id} activity={activity} depth={0} />)}
          <RetryLoops step={step} />
          <ChangeRows changes={step.changes} onOpenReview={onOpenReview} />
        </div>
      )}
    </div>
  );
}

// —— 子代理分支节点（独立通道，与主链路明显区分）——

function BranchNode({ branch, onOpenReview }: { branch: TaskTraceBranch; onOpenReview?: (changes: FileChange[]) => void }) {
  const [open, setOpen] = useState(false);
  const lastActivities = branch.activities.slice(-5);
  return (
    <div className={`pt-branch depth-${branch.depth}`} style={{ marginLeft: 8 + (branch.depth - 1) * 18 }}>
      <div className="pt-branch-head">
        <GitBranch size={13} className="pt-branch-icon" />
        <button type="button" className="pt-branch-title clickable" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {branch.title || "子任务"}
        </button>
        <span className="pt-branch-meta">
          <span className="pt-branch-depth">子代理·深度 {branch.depth}</span>
          <span className="pt-meta-count">{branch.activities.length} 步</span>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </div>
      {open && (
        <div className="pt-branch-body">
          {lastActivities.map((activity) => <ActivityRow key={activity.id} activity={activity} depth={1} />)}
          {branch.activities.length > 5 && <div className="pt-branch-more">…共 {branch.activities.length} 步（已折叠较早记录）</div>}
          {branch.result && <div className="pt-branch-result"><strong>结果：</strong>{clampText(branch.result, 160)}</div>}
        </div>
      )}
    </div>
  );
}

// —— 链路时间线主体 ——

export function ProcessTimeline({ trace, onLocateMessage, onOpenReview, onLocateLog }: ProcessTimelineProps) {
  const stepTotal = useMemo(() => trace.steps.length, [trace.steps]);
  const doneSteps = useMemo(() => trace.steps.filter((step) => step.status === "completed").length, [trace.steps]);
  const branchCount = trace.branches.length;
  const changeCount = useMemo(() => {
    let total = trace.changes.length;
    for (const step of trace.steps) total += step.changes.length;
    return total;
  }, [trace]);
  const failedAny = useMemo(() => trace.steps.some((step) => step.activities.some((activity) => activity.status === "error")), [trace.steps]);

  return (
    <div className="process-timeline">
      <div className="pt-header">
        <Activity size={14} />
        <strong>需求 → 实现链路</strong>
        <span className="pt-header-meta">
          {stepTotal > 0 && <span>{doneSteps}/{stepTotal} 步</span>}
          {branchCount > 0 && <span>{branchCount} 条子代理分支</span>}
          {changeCount > 0 && <span>{changeCount} 个文件</span>}
        </span>
        <span className="pt-header-spacer" />
        {failedAny && <span className="pt-badge pt-badge-fail">含失败重试</span>}
        <span className={`pt-badge ${trace.deliver ? "pt-badge-done" : "pt-badge-run"}`}>
          {trace.deliver ? "已交付" : "执行中"}
        </span>
        <button type="button" className="icon-button subtle tiny" title="定位到该消息" aria-label="定位到该消息" onClick={() => onLocateMessage?.()}>
          <Target size={13} />
        </button>
        {onLocateLog && (
          <button type="button" className="icon-button subtle tiny" title="打开轨迹控制台" aria-label="打开轨迹控制台" onClick={onLocateLog}>
            <ListTodo size={13} />
          </button>
        )}
      </div>

      <div className="pt-body">
        {/* 需求节点 */}
        <div className="pt-node pt-request">
          <div className="pt-node-head">
            <span className="pt-node-icon pt-request-icon"><Target size={14} /></span>
            <span className="pt-node-title">需求</span>
            <span className="pt-meta-count">{clampText(trace.request || "（无文本摘要）", 90)}</span>
          </div>
        </div>

        {/* 计划步骤 */}
        {stepTotal === 0 && !trace.deliver && (
          <div className="pt-empty">没有可展示的步骤记录（老会话可回退现有卡片）</div>
        )}
        {trace.steps.map((step) => <StepNode key={step.id} step={step} onOpenReview={onOpenReview} />)}

        {/* 未能挂到步骤的变更（无 plan 会话） */}
        {trace.changes.length > 0 && (
          <div className="pt-node pt-unassigned">
            <div className="pt-node-head">
              <span className="pt-node-icon"><Zap size={13} /></span>
              <span className="pt-node-title">执行产出</span>
              <span className="pt-meta-count">{trace.changes.length} 个文件</span>
            </div>
            <div className="pt-node-body"><ChangeRows changes={trace.changes} onOpenReview={onOpenReview} /></div>
          </div>
        )}

        {/* 子代理分支 */}
        {trace.branches.map((branch) => <BranchNode key={branch.parentActivityId} branch={branch} onOpenReview={onOpenReview} />)}

        {/* 交付节点 */}
        {trace.deliver && (
          <div className="pt-node pt-deliver">
            <div className="pt-node-head">
              <span className="pt-node-icon pt-deliver-icon"><PackageCheck size={14} /></span>
              <span className="pt-node-title">交付</span>
              <span className="pt-meta-count">
                {trace.deliver.status === "done" ? "成功" : trace.deliver.status}
                {trace.deliver.durationMs > 0 && ` · ${formatTraceDuration(trace.deliver.durationMs)}`}
              </span>
            </div>
            <div className="pt-node-body">
              <div className="pt-deliver-text">{clampText(trace.deliver.text || "（无最终答复）", 240)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function formatTraceDuration(ms: number): string {
  if (ms < 1000) return `${ms} 毫秒`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
}
