// 后台任务页（workbench Phase 2）：主会话 agent 拓扑。
// 数据来自统一 trace 事件流（activity / activity-update，含子代理 branch 与 depth）：
// 主会话活动为主干，dispatch_agent 派出的子代理作为嵌套分支展开（新子代理自动展开）；
// 实时输出非消费式查看（快照展示，不消费事件流）；运行中的会话支持两击确认强制终止。
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, GitBranch, Layers,
  LoaderCircle, Network, Search, Terminal, X,
} from "lucide-react";
import type { TraceEvent } from "./types";

export interface BackgroundTasksPanelProps {
  /** 会话级 trace 事件（含分支），随时间追加 */
  traces: TraceEvent[];
  sessionTitle?: string;
  /** 该会话当前是否有任务在跑（决定「终止」按钮是否可用） */
  running: boolean;
  /** 两击确认后的强制终止回调（调用 cancelTask） */
  onCancel: () => void;
  /** 打开轨迹控制台（定位执行记录） */
  onOpenConsole: () => void;
}

interface TaskNode {
  id: string;
  title: string;
  kind: string;
  status: "running" | "success" | "error";
  phase?: string;
  detail?: string;
  depth: number;
  parentId?: string;
  isBranch: boolean;
  branchTitle?: string;
  order: number;
  children: TaskNode[];
}

const KIND_LABELS: Record<string, string> = {
  run_command: "命令", write_file: "写入", edit_file: "编辑", append_file: "追加",
  make_directory: "建目录", copy_file: "复制", move_file: "移动", delete_file: "删除",
  list_files: "列目录", read_file: "读文件", find_files: "找文件", search_in_files: "检索",
  web_search: "网页搜索", gov_search: "政务搜索", fetch_web_page: "读网页",
  dispatch_agent: "子任务", ask_user: "提问", finish: "收尾", update_plan: "计划",
  save_memory: "记记忆", export_excel_workbook: "导出表格", get_datetime: "时间",
  thinking: "思考", activity: "活动",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] || kind.replace(/_/g, " ");
}

function buildTaskTree(traces: TraceEvent[]): { roots: TaskNode[]; total: number; runningCount: number; errorCount: number } {
  const nodes = new Map<string, TaskNode>();
  let order = 0;
  for (const trace of traces) {
    if (trace.kind === "activity" && trace.activityId) {
      if (nodes.has(trace.activityId)) continue;
      nodes.set(trace.activityId, {
        id: trace.activityId,
        title: trace.title || "(无标题活动)",
        kind: trace.activityKind || "activity",
        status: "running",
        phase: trace.phase,
        detail: trace.content || undefined,
        depth: trace.depth || 0,
        parentId: trace.branch?.parentId,
        isBranch: Boolean(trace.branch),
        branchTitle: trace.branch?.title,
        order: order++,
        children: [],
      });
    } else if (trace.kind === "activity-update" && trace.activityId) {
      const node = nodes.get(trace.activityId);
      if (node) {
        if (trace.status === "error") node.status = "error";
        else if (trace.status === "success") node.status = "success";
        if (trace.content) node.detail = trace.content;
      }
    }
  }
  const roots: TaskNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (list: TaskNode[]) => {
    list.sort((a, b) => a.order - b.order);
    for (const node of list) sortRec(node.children);
  };
  sortRec(roots);
  let total = 0;
  let runningCount = 0;
  let errorCount = 0;
  const countRec = (list: TaskNode[]) => {
    for (const node of list) {
      total += 1;
      if (node.status === "running") runningCount += 1;
      if (node.status === "error") errorCount += 1;
      countRec(node.children);
    }
  };
  countRec(roots);
  return { roots, total, runningCount, errorCount };
}

function statusIcon(status: TaskNode["status"]) {
  if (status === "success") return <Check size={12} className="bt-ok" />;
  if (status === "error") return <X size={12} className="bt-fail" />;
  return <LoaderCircle size={12} className="bt-spin spin" />;
}

function clampText(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function TaskNodeRow({
  node, depth, expanded, onToggle,
}: {
  node: TaskNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const open = expanded.has(node.id);
  return (
    <div className="bt-node">
      <button
        type="button"
        className="bt-row"
        style={{ paddingLeft: 8 + Math.min(depth, 6) * 16 }}
        onClick={() => hasChildren && onToggle(node.id)}
        aria-expanded={open}
        title={node.title}
      >
        <span className="bt-chevron">
          {hasChildren ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="bt-chevron-spacer" />}
        </span>
        {node.isBranch ? <GitBranch size={13} className="bt-branch-icon" /> : null}
        {statusIcon(node.status)}
        <span className={`bt-kind-badge ${node.status}`}>{kindLabel(node.kind)}</span>
        {node.isBranch && node.branchTitle && <span className="bt-branch-title">{clampText(node.branchTitle, 60)}</span>}
        <span className="bt-title">{clampText(node.title, 160)}</span>
        {node.phase && <span className={`bt-phase bt-phase-${node.phase}`}>{node.phase}</span>}
        {hasChildren && <span className="bt-count">{node.children.length}</span>}
      </button>
      {open && hasChildren && (
        <div className="bt-children">
          {node.children.map((child) => (
            <TaskNodeRow key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
          ))}
        </div>
      )}
      {open && node.detail && (
        <pre className="bt-detail">{node.detail.slice(0, 6000)}{node.detail.length > 6000 ? "\n…（内容过长，其余在轨迹控制台查看）" : ""}</pre>
      )}
    </div>
  );
}

export function BackgroundTasksPanel({ traces, sessionTitle, running, onCancel, onOpenConsole }: BackgroundTasksPanelProps) {
  const { roots, total, runningCount, errorCount } = useMemo(() => buildTaskTree(traces), [traces]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [armCancel, setArmCancel] = useState(false);

  // 新子代理自动展开：带子节点的分支默认展开（用户手动折叠后不再强制）
  useEffect(() => {
    if (!roots.length) return;
    setExpanded((current) => {
      const next = new Set(current);
      let changed = false;
      const walk = (list: TaskNode[]) => {
        for (const node of list) {
          if (node.children.length > 0 && !next.has(node.id)) {
            next.add(node.id);
            changed = true;
          }
          walk(node.children);
        }
      };
      walk(roots);
      return changed ? next : current;
    });
  }, [roots]);

  // 两击确认强制终止：第一次点击进入待确认状态，4 秒后自动复位
  useEffect(() => {
    if (!armCancel) return;
    const timer = window.setTimeout(() => setArmCancel(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armCancel]);

  return (
    <div className="background-tasks">
      <div className="bt-header">
        <Network size={14} />
        <strong>后台任务</strong>
        <span className="bt-header-title" title={sessionTitle}>{sessionTitle || "当前会话"}</span>
        <span className="bt-header-spacer" />
        {total > 0 && <span className="bt-meta">{total} 步</span>}
        {runningCount > 0 && <span className="bt-meta bt-meta-run">{runningCount} 进行中</span>}
        {errorCount > 0 && <span className="bt-meta bt-meta-fail">{errorCount} 失败</span>}
        <button type="button" className="icon-button subtle tiny" title="在轨迹控制台查看执行记录" aria-label="打开轨迹控制台" onClick={onOpenConsole}>
          <Terminal size={13} />
        </button>
        <button
          type="button"
          className={`code-open-external bt-cancel ${armCancel ? "bt-cancel-armed" : ""}`}
          onClick={() => {
            if (!running) return;
            if (armCancel) {
              setArmCancel(false);
              onCancel();
            } else {
              setArmCancel(true);
            }
          }}
          disabled={!running}
          title="两击确认强制终止当前任务"
        >
          {armCancel ? <AlertTriangle size={13} /> : <X size={13} />}
          {armCancel ? "再点一次确认终止" : "终止"}
        </button>
      </div>
      {traces.length === 0 ? (
        <div className="bt-empty">
          <Layers size={40} />
          <strong>还没有任务记录</strong>
          <span>发起任务后，这里会展示主会话与子代理的执行拓扑，可实时查看输出并强制终止。</span>
        </div>
      ) : roots.length === 0 ? (
        <div className="bt-empty">
          <Search size={40} />
          <strong>暂未采集到活动</strong>
          <span>任务事件正在写入，稍后自动出现。</span>
        </div>
      ) : (
        <div className="bt-tree">
          {roots.map((node) => (
            <TaskNodeRow
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={(id) => {
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
