import {
  AlarmClock,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  Globe,
  History,
  Landmark,
  ListTodo,
  LoaderCircle,
  MessageCircleQuestion,
  Monitor,
  Pencil,
  ScanText,
  Search,
  ShieldAlert,
  Sparkles,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { activityDisplayTitle } from "../../lib/activity";
import { formatDuration, formatDurationCodex } from "../../lib/format";
import type { ActivityRecord, ChatMessage } from "../../types";
import { MarkdownSnippet } from "../../InteractiveMessage";
import { ArchivedPlan } from "../../PlanProgress";
import { formatWakeTime } from "../../wakeNote";
import { contentEchoesProcessCommentary, processActivitiesWithCommentary } from "../../processCommentary.ts";

export function ActivityIcon({ kind }: { kind: ActivityRecord["kind"] }) {
  if (String(kind).startsWith("browser__")) return <Globe size={14} />;
  if (String(kind).startsWith("mcp__computer-use__")) return <Monitor size={14} />;
  switch (kind) {
    case "thinking":
      return <Brain size={14} />;
    case "commentary":
      return <Sparkles size={14} />;
    case "update_plan":
      return <ListTodo size={14} />;
    case "list_files":
    case "make_directory":
    case "copy_file":
    case "move_file":
      return <Folder size={14} />;
    case "find_files":
    case "search_in_files":
      return <Search size={14} />;
    case "append_file":
    case "export_excel_workbook":
      return <FileCode2 size={14} />;
    case "delete_file":
      return <Trash2 size={14} />;
    case "read_file":
      return <FileText size={14} />;
    case "ocr_file":
      return <ScanText size={14} />;
    case "write_file":
      return <FileCode2 size={14} />;
    case "save_memory":
    case "search_history":
    case "read_history_context":
      return <History size={14} />;
    case "web_search":
    case "fetch_web_page":
      return <Globe size={14} />;
    case "gov_search":
      return <Landmark size={14} />;
    case "scan_sensitive_info":
      return <ShieldAlert size={14} />;
    case "dispatch_agent":
      return <Bot size={14} />;
    case "ask_user":
      return <MessageCircleQuestion size={14} />;
    case "sleep_until":
      return <AlarmClock size={14} />;
    case "check_official_document":
      return <FileText size={14} />;
    case "list_skills":
    case "load_skill":
    case "save_skill":
    case "update_skill":
      return <FileCode2 size={14} />;
    case "finish":
      return <Check size={14} />;
    default:
      return <Sparkles size={14} />;
  }
}

// 推理模型的思考过程：固定高度滚动框，流式期间自动跟随到底部显示最新内容。
// 用户主动上翻后停止跟随（避免打断阅读），滚回贴近底部时自动恢复跟随。
export function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  // 用户按住滚动条（或选中文本）期间挂起自动跟随，避免内容更新抢夺滚动位置
  const interactingRef = useRef(false);
  const dragStartTopRef = useRef(0);
  // 上翻宽限期：小幅上翻/触控板惯性时距底部仍 ≤24px，期间的 scroll 事件若按"贴近底部"
  // 恢复跟随，会立刻被下一次流式刷新拉回底部（表现为和用户抢滚动条）。窗口期内禁止恢复。
  const upGestureUntilRef = useRef(0);
  useEffect(() => {
    const node = contentRef.current;
    if (!node || !pinnedRef.current || interactingRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [text, streaming]);
  useEffect(() => {
    const endInteraction = () => {
      if (!interactingRef.current) return;
      interactingRef.current = false;
      const node = contentRef.current;
      if (!node) return;
      if (node.scrollTop < dragStartTopRef.current) {
        // 拖动滚动条上翻：与滚轮上翻同样处理，进入宽限期且不恢复跟随
        pinnedRef.current = false;
        upGestureUntilRef.current = performance.now() + 400;
        return;
      }
      pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 24;
    };
    window.addEventListener("pointerup", endInteraction);
    window.addEventListener("pointercancel", endInteraction);
    return () => {
      window.removeEventListener("pointerup", endInteraction);
      window.removeEventListener("pointercancel", endInteraction);
    };
  }, []);
  return (
    <details className="reasoning-block" open={streaming}>
      <summary>{streaming ? "正在深度思考…" : "思考过程"}</summary>
      <div
        className="reasoning-content"
        ref={contentRef}
        onPointerDown={() => {
          interactingRef.current = true;
          dragStartTopRef.current = contentRef.current?.scrollTop ?? 0;
        }}
        onWheel={(event) => {
          if (event.deltaY < 0) {
            // 用户向上滚动（含触控板惯性）立即停止跟随，并续期宽限期
            pinnedRef.current = false;
            upGestureUntilRef.current = performance.now() + 400;
          } else if (event.deltaY > 0) {
            // 向下滚动说明想回到底部：立即退出宽限期，滚到贴近底部即可恢复跟随
            upGestureUntilRef.current = 0;
          }
        }}
        onScroll={() => {
          const node = contentRef.current;
          if (!node || interactingRef.current) return;
          if (performance.now() < upGestureUntilRef.current) return;
          // 贴近底部（24px 内）视为跟随中；程序性滚动到底也会触发本事件，天然保持 true
          pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 24;
        }}
      >
        {text}
      </div>
    </details>
  );
}

export function ActivityRow({ activity }: { activity: ActivityRecord }) {
  const [open, setOpen] = useState(false);
  const childCount = activity.children?.length || 0;
  // 子代理（dispatch_agent）活动：children 有运行中条目时保持行首转圈，
  // 即使父活动自身已 success（父活动先于子代理流收尾属正常时序）
  const hasRunningChild = Boolean(activity.children?.some((child) => child.status === "running"));
  const expandable = Boolean(activity.detail) || childCount > 0;
  const isCommand = activity.kind === "run_command";
  return (
    <div className={`activity-row ${activity.status} ${isCommand ? "command" : ""}`}>
      <button
        className="activity-row-main"
        onClick={() => expandable && setOpen((value) => !value)}
        disabled={!expandable}
      >
        <span className={`activity-status ${isCommand ? "activity-status-command" : ""}`}>
          {activity.status === "running" || hasRunningChild
            ? <LoaderCircle className="spin" size={13} />
            : activity.status === "error"
              ? <X size={13} />
              : isCommand
                ? <SquareTerminal size={16} />
                : <Check size={13} />}
        </span>
        {!isCommand && <ActivityIcon kind={activity.kind} />}
        <span className="activity-title">{activityDisplayTitle(activity)}</span>
        {childCount > 0 && <span className="activity-child-count">{childCount} 项</span>}
        {expandable && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
      </button>
      {open && activity.detail && <pre className="activity-detail">{activity.detail}</pre>}
      {open && childCount > 0 && (
        <div className="activity-children">
          <ActivityList activities={activity.children || []} />
        </div>
      )}
    </div>
  );
}

export function ActivityList({ activities }: { activities: ActivityRecord[] }) {
  if (!activities.length) return null;
  const commandOnly = activities.every((activity) => activity.kind === "run_command");
  return (
    <div className={`activity-list ${commandOnly ? "command-list" : ""}`}>
      {activities.map((activity) => <ActivityRow key={activity.id} activity={activity} />)}
    </div>
  );
}

export function ProcessThoughtItem({ text, durationMs, streaming }: { text: string; durationMs?: number; streaming?: boolean }) {
  // 默认收起：思考内容只在用户点击时展开，流式进行中也不自动展开，
  // 否则一段长推理会把过程流整片顶开（行标题会用「正在深度思考…」提示仍在进行）
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (streaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [text, streaming]);

  const duration = durationMs ? formatDurationCodex(durationMs) : "";
  return (
    <div className={`process-thought-item ${streaming ? "streaming" : ""}`}>
      <button
        type="button"
        className="process-thought-header"
        onClick={() => setOpen((val) => !val)}
      >
        <Brain size={14} className="process-thought-icon" />
        <span className="process-thought-title">
          {streaming ? "正在深度思考…" : "思考过程"}
          {duration ? ` · ${duration}` : ""}
        </span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="process-thought-body" ref={contentRef}>
          <div className="process-thought-text">{text || (streaming ? "思考中..." : "")}</div>
        </div>
      )}
    </div>
  );
}

export function ProcessCommentaryItem({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="process-commentary-item">
      <MarkdownSnippet content={text} />
    </div>
  );
}

export function ProcessSubagentItem({ activity }: { activity: ActivityRecord }) {
  const [open, setOpen] = useState(false);
  const childCount = activity.children?.length || 0;
  const isRunning = activity.status === "running" || Boolean(activity.children?.some((c) => c.status === "running"));
  const taskTitle = activity.title.replace(/^派发子任务[：:]\s*/, "") || "子智能体任务";

  return (
    <div className={`process-subagent-item ${isRunning ? "running" : "completed"}`}>
      <button
        type="button"
        className="process-subagent-header"
        onClick={() => (childCount > 0 || activity.detail) && setOpen((val) => !val)}
        disabled={childCount === 0 && !activity.detail}
      >
        <span className="process-subagent-badge">
          {isRunning ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}
        </span>
        <span className="process-subagent-text">
          {isRunning ? `正在执行：${taskTitle}` : `${taskTitle} 已完成`}
        </span>
        {childCount > 0 && <span className="process-subagent-count">{childCount} 步</span>}
        {(childCount > 0 || activity.detail) && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
      </button>
      {open && activity.detail && (
        <div className="process-subagent-detail">
          <pre>{activity.detail}</pre>
        </div>
      )}
      {open && childCount > 0 && (
        <div className="process-subagent-children">
          <ActivityList activities={activity.children || []} />
        </div>
      )}
    </div>
  );
}

export function ProcessActionItem({ activity }: { activity: ActivityRecord }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(activity.detail);
  const isEdit = ["write_file", "edit_file", "append_file", "delete_file"].includes(activity.kind);
  const isCommand = activity.kind === "run_command";

  return (
    <div className={`process-action-item ${activity.status}`}>
      <button
        type="button"
        className="process-action-header"
        onClick={() => expandable && setOpen((val) => !val)}
        disabled={!expandable}
      >
        <span className="process-action-icon">
          {activity.status === "running" ? (
            <LoaderCircle className="spin" size={13} />
          ) : activity.status === "error" ? (
            <X size={13} />
          ) : isEdit ? (
            <Pencil size={13} />
          ) : isCommand ? (
            <SquareTerminal size={14} />
          ) : (
            <Check size={13} />
          )}
        </span>
        <span className="process-action-title">{activityDisplayTitle(activity)}</span>
        {expandable && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
      </button>
      {open && activity.detail && (
        <pre className="process-action-detail">{activity.detail}</pre>
      )}
    </div>
  );
}

// memo：已完成消息的 message 引用在流式期间不变，收起状态下整棵子树
// （含最多上百条 activities 的 map）在 App 重渲染时直接跳过。
// 依赖调用方传入稳定的 onToggleCollapse（见 transcript 渲染处的 useCallback）。
export const ProcessTimeline = memo(function ProcessTimeline({
  message,
  messageIndex,
  isStreaming,
  collapsedActivities,
  onToggleCollapse,
}: {
  message: ChatMessage;
  messageIndex: number;
  isStreaming: boolean;
  collapsedActivities: Set<string>;
  onToggleCollapse: (messageKey: string, nextCollapsed: boolean) => void;
}) {
  const activities = useMemo(() => processActivitiesWithCommentary(message), [message]);
  const hasReasoning = Boolean(message.reasoning?.trim());
  const hasArchivedPlan = !isStreaming && Boolean(message.plan?.length);
  const hasProcess = activities.length > 0 || hasReasoning || isStreaming || hasArchivedPlan;
  if (!hasProcess) return null;

  const messageKey = message.id || `${message.createdAt}-${messageIndex}`;
  const userCollapsed = collapsedActivities.has(messageKey);
  const userExpanded = collapsedActivities.has(`${messageKey}:expanded`);
  // 核心规则：执行中默认展开，执行完成默认收起为单行“用时 XX 〉”；若用户主动点击则记忆其选择
  const collapsed = userCollapsed ? true : userExpanded ? false : !isStreaming;

  const durationText = message.durationMs ? formatDurationCodex(message.durationMs) : "";
  const triggerLabel = durationText
    ? `用时 ${durationText}`
    : isStreaming
      ? "正在处理任务"
      : "处理过程";
  // 任务执行中直接平铺过程行（对标 Codex 执行中的排版：过程行与正文同一起始边，
  // 顶部不出现折叠条）；只有任务结束、或用户主动收起后才显示「用时 XX 〉」折叠条。
  const showTrigger = collapsed || !isStreaming;
  const liveText = isStreaming && !message.dshTurnId ? (message.content || "").trim() : "";
  if (!showTrigger && !activities.length && !hasReasoning && !liveText) return null;
  const showContent = showTrigger ? !collapsed : true;

  return (
    <div className={`process-collapse-container${showTrigger ? "" : " expanded-inline"}`}>
      {showTrigger && (
        <button
          type="button"
          className="process-collapse-trigger"
          onClick={() => onToggleCollapse(messageKey, !collapsed)}
          aria-expanded={!collapsed}
          title={collapsed ? "点击展开执行过程" : "点击收起执行过程"}
        >
          <span className="process-trigger-label">{triggerLabel}</span>
          {collapsed ? (
            <ChevronRight size={14} className="process-trigger-icon" />
          ) : (
            <ChevronDown size={14} className="process-trigger-icon" />
          )}
        </button>
      )}
      {showContent && (
        <div className="process-timeline-content">
          {hasArchivedPlan && <ArchivedPlan steps={message.plan!} />}
          {/* 旧消息兼容：如果 activities 中没有 thinking 项，但 message.reasoning 存在，在此渲染思考 */}
          {Boolean(hasReasoning && !activities.some((a) => a.kind === "thinking")) && (
            <ProcessThoughtItem
              text={message.reasoning!}
              streaming={isStreaming && !message.content}
            />
          )}
          {/* 按时序遍历各项活动 */}
          {activities.map((activity) => {
            if (activity.kind === "commentary") {
              return <ProcessCommentaryItem key={activity.id} text={activity.detail || activity.title} />;
            }
            if (activity.kind === "thinking") {
              const showThought = Boolean(activity.detail) || (activity.status === "running" && isStreaming);
              const showCommentary = Boolean(activity.commentary);
              if (!showThought && !showCommentary) return null;
              return (
                <div key={activity.id} className="process-thinking-group">
                  {showThought && (
                    <ProcessThoughtItem
                      text={activity.detail || ""}
                      durationMs={activity.durationMs}
                      streaming={isStreaming && activity.status === "running"}
                    />
                  )}
                  {showCommentary && (
                    <ProcessCommentaryItem text={activity.commentary!} />
                  )}
                </div>
              );
            }
            if (activity.kind === "dispatch_agent") {
              return <ProcessSubagentItem key={activity.id} activity={activity} />;
            }
            return <ProcessActionItem key={activity.id} activity={activity} />;
          })}
          {/* 执行中模型正在说的话：接在当前这一轮思考行后面实时出现（对标 Codex 会话输出：
             边说边出，位置就是它落定后的位置）。这一轮结束时同一段文字会成为该思考行的说明，
             位置不变、也不会在正文区再出现一次；正文区只在任务收尾后显示最终答复。 */}
          {liveText && !contentEchoesProcessCommentary(message, { streaming: true }) && (
            <ProcessCommentaryItem text={liveText} />
          )}
        </div>
      )}
    </div>
  );
});

// 任务运行状态行：耗时数字自持 1s 定时器，只重渲染这一行，
// 不再驱动整个 App 每秒重渲染（原 elapsedTick 方案）
// waking：本次运行是挂起任务的续跑，要显式说明"自动唤醒/按你的要求继续"，
// 否则用户只看到一句"正在处理任务"，会以为任务莫名其妙又跑起来了
export function RunningStatusLabel({ loopState, startedAt, waking }: { loopState: { iteration: number; maximum: number; status: string } | null; startedAt?: number; waking?: { wakeAt: string; manual?: boolean } }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt || loopState) return;
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, loopState]);
  const wakingPrefix = waking
    ? (waking.manual ? "已按你的要求立即继续" : `已到点自动唤醒（${formatWakeTime(waking.wakeAt)}）`)
    : "";
  if (loopState) {
    return <span>{`${wakingPrefix ? `${wakingPrefix} · ` : ""}持续执行 第 ${loopState.iteration}/${loopState.maximum} 轮 · ${loopState.status}`}</span>;
  }
  const elapsedSeconds = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const label = wakingPrefix ? `${wakingPrefix}，正在继续处理` : "正在处理任务";
  return <span>{`${label}${elapsedSeconds > 1 ? ` · ${formatDuration(elapsedSeconds * 1000)}` : ""}`}</span>;
}
