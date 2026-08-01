import {
  AlarmClock,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  FileCode2,
  File,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Hand,
  History,
  Landmark,
  ListTodo,
  LoaderCircle,
  MessageSquarePlus,
  MessagesSquare,
  MessageCircleQuestion,
  Mic,
  Minus,
  Monitor,
  Moon,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  Terminal,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { DragEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { contextUsageSummary, estimateSessionTokens, formatTokenCount } from "./contextUsage";
import { InteractiveMessage } from "./InteractiveMessage";
import type { ActivityRecord, AgentResult, ApprovalAction, ApprovalMode, Attachment, ChannelConnectionStatus, ChannelsConfig, ChannelsStatusMap, ChatMessage, DebugLogEntry, FileChange, HookRule, InboxItem, MemoryItem, ModelProfile, PlanStep, ProviderSettings, QuestionRequest, ScheduleRecord, SessionRecord, SkillRecord, StandingRule, UsageRecord, WorkspaceEntry } from "./types";
import { matchProvider, modelContextLimit, providerPresets } from "./providers";

const now = new Date().toISOString();
const WORKSPACE_FILE_DRAG_TYPE = "application/x-dyworker-workspace-file";

const previewSessions: SessionRecord[] = [
  {
    id: "codex-layout",
    title: "优化 UI 布局为 Codex 风格",
    workspacePath: "/workspace/dyworker",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        role: "user",
        createdAt: now,
        content: "主区域对话内容块的样式也要跟 Codex 对齐。",
      },
      {
        role: "assistant",
        createdAt: now,
        plan: [
          { title: "对比 Codex 参考截图与当前布局", status: "completed" },
          { title: "调整用户消息与助手回复样式", status: "completed" },
          { title: "统一 Markdown 内容层级", status: "completed" },
        ],
        changes: [
          {
            path: "src/styles.css",
            added: 3,
            removed: 2,
            diff: "--- a/src/styles.css\n+++ b/src/styles.css\n@@ -892,7 +892,7 @@\n .user-bubble {\n-  max-width: min(680px, 76%);\n-  padding: 11px 16px;\n+  max-width: min(680px, 78%);\n+  padding: 10px 16px;\n+  border-radius: 14px;\n   background: #efeee9;",
          },
          { path: "src/App.tsx", added: 58, removed: 23 },
        ],
        durationMs: 185_000,
        activities: [
          { id: "preview-act-1", kind: "read_file", title: "读取 src/App.tsx", detail: "界面主组件", status: "success" },
          { id: "preview-act-2", kind: "edit_file", title: "编辑 src/styles.css", detail: "已编辑 src/styles.css（+96 -41）", status: "success" },
        ],
        content:
          "**已完成主对话区优化：**\n\n- 用户消息改为 Codex 风格的浅灰内容块。\n- 助手回复采用开放式排版，不再堆叠卡片和分割线。\n- 统一了标题、正文、列表、引用、表格和代码内容的层级与间距。\n- 长内容更容易连续阅读，重要信息也更容易扫描。\n\n新界面已经切换到 Electron，后续可以继续完善任务执行和文件处理能力。",
      },
    ],
  },
  {
    id: "model-settings",
    title: "修复模型切换参数错误",
    workspacePath: "/workspace/dyworker",
    createdAt: now,
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    messages: [],
  },
  {
    id: "project-readme",
    title: "完善项目使用说明",
    workspacePath: "/workspace/dyworker",
    createdAt: now,
    updatedAt: new Date(Date.now() - 120_000).toISOString(),
    messages: [],
  },
];

const previewWorkspace: WorkspaceEntry[] = [
  { name: "build", path: "/dyworker/build", kind: "directory", children: [] },
  {
    name: "electron",
    path: "/dyworker/electron",
    kind: "directory",
    children: [
      { name: "channels", path: "/dyworker/electron/channels", kind: "directory", children: [] },
      { name: "main.mjs", path: "/dyworker/electron/main.mjs", kind: "file" },
      { name: "agent.mjs", path: "/dyworker/electron/agent.mjs", kind: "file" },
    ],
  },
  { name: "src", path: "/dyworker/src", kind: "directory", children: [] },
  { name: "tests", path: "/dyworker/tests", kind: "directory", children: [] },
];

const defaultSettings: ProviderSettings = {
  endpoint: "",
  model: "",
  apiKey: "",
  transcriptionEndpoint: "",
  transcriptionModel: "whisper-1",
  searxngEndpoint: "",
  bochaApiKey: "",
  domesticSearchOnly: false,
  preventSleep: "tasks",
  mcpServers: [],
  channels: { qq: { enabled: false, appId: "", appSecret: "" }, wechat: { enabled: false }, modelProfileId: "", approvalMode: "allow-writes" },
  profiles: [],
};

function settingsWithProfile(settings: ProviderSettings, profile: ModelProfile): ProviderSettings {
  return {
    ...settings,
    endpoint: profile.endpoint,
    model: profile.model,
    apiKey: profile.apiKey,
    transcriptionEndpoint: profile.transcriptionEndpoint ?? settings.transcriptionEndpoint,
    transcriptionModel: profile.transcriptionModel || settings.transcriptionModel,
  };
}

// 内置斜杠命令（对照 Codex /init），与工作模板一起出现在 / 菜单里
const builtinCommands = [
  {
    id: "builtin:goal",
    title: "/goal",
    detail: "设定长期目标，跨轮持续驱动直到达成（/goal 取消 可解除）",
    prompt: "/goal ",
  },
  {
    id: "builtin:init",
    title: "/init",
    detail: "分析工作区并生成 AGENTS.md 项目约定",
    prompt: "请分析当前工作区的目录结构和主要文件，总结这个工作区的用途、内容组织方式和处理时的注意事项，在工作区根目录创建 AGENTS.md，把这些长期约定写清楚，让以后的任务能自动遵循。如果已经有 AGENTS.md，先读取它，在原有基础上补充完善，保留仍然有效的约定。",
  },
];

const composerApprovalModes = [
  {
    value: "interactive" as ApprovalMode,
    label: "请求批准",
    description: "访问工作区外文件和使用互联网时始终询问",
    icon: Hand,
  },
  {
    value: "allow-writes" as ApprovalMode,
    label: "替我审批",
    description: "仅对检测到的风险操作请求批准",
    icon: ShieldCheck,
  },
  {
    value: "full-access" as ApprovalMode,
    label: "完全访问权限",
    description: "不受限制地访问互联网和您电脑上的任何文件",
    icon: ShieldAlert,
    warning: true,
  },
];

function makeSession(workspacePath = ""): SessionRecord {
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

function displayWorkspace(path: string) {
  if (!path) return "选择工作文件夹";
  const chunks = path.split(/[\\/]/).filter(Boolean);
  return chunks.at(-1) || path;
}

function pathDirname(filePath: string) {
  const index = filePath.lastIndexOf("/");
  return index > 0 ? filePath.slice(0, index) : filePath;
}

function shortTitle(content: string) {
  const title = content.replace(/[#*`>\n]/g, " ").replace(/\s+/g, " ").trim();
  return title.length > 28 ? `${title.slice(0, 28)}…` : title || "新任务";
}

function workspaceFileAttachment(file: WorkspaceEntry): Attachment {
  const isImage = /\.(png|jpe?g|gif|bmp|webp)$/i.test(file.name);
  return {
    name: file.name,
    path: file.path,
    size: 0,
    mimeType: isImage ? "image/*" : "text/plain",
    isImage,
  };
}

function WorkspaceNode({ entry, depth = 0 }: { entry: WorkspaceEntry; depth?: number }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isDirectory = entry.kind === "directory";
  const hasChildren = Boolean(entry.children?.length);

  const activate = () => {
    if (isDirectory) setExpanded((value) => !value);
    else void window.dyworker?.openPath(entry.path);
  };

  return (
    <div className="tree-node">
      <button
        className="tree-row"
        style={{ paddingLeft: 8 + depth * 16 }}
        draggable={!isDirectory}
        onDragStart={(event) => {
          if (isDirectory) return;
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(WORKSPACE_FILE_DRAG_TYPE, entry.path);
        }}
        onDoubleClick={activate}
        onClick={activate}
      >
        <span className="tree-chevron">
          {isDirectory && hasChildren ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
        </span>
        {isDirectory ? expanded ? <FolderOpen size={15} /> : <Folder size={15} /> : <File size={14} />}
        <span title={entry.path}>{entry.name}</span>
      </button>
      {expanded && entry.children?.map((child) => (
        <WorkspaceNode entry={child} depth={depth + 1} key={child.path} />
      ))}
    </div>
  );
}

// 控制台：展示模型请求/响应与工具调用的内部细节，便于理解 agent 的执行逻辑
const debugKindLabels: Record<DebugLogEntry["kind"], string> = {
  "model-request": "模型请求",
  "model-response": "模型响应",
  "tool-call": "工具调用",
  "tool-result": "工具结果",
};

function DebugConsole({ logs, onClear, onClose }: { logs: DebugLogEntry[]; onClear: () => void; onClose: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [logs.length]);
  return (
    <div className="debug-console">
      <div className="debug-console-header">
        <Terminal size={14} />
        <strong>控制台</strong>
        <span className="debug-console-count">{logs.length} 条</span>
        <span className="debug-console-spacer" />
        <button className="icon-button subtle tiny" aria-label="清空控制台" onClick={onClear}><Trash2 size={13} /></button>
        <button className="icon-button subtle tiny" aria-label="关闭控制台" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="debug-console-body" ref={bodyRef}>
        {logs.length === 0 ? (
          <div className="debug-console-empty">暂无日志。发起任务后，这里会显示每一轮模型请求的消息内容、响应（SSE 流式或 JSON）以及每次工具调用的参数与结果。</div>
        ) : logs.map((entry) => (
          <details className={`debug-entry debug-${entry.kind}`} key={entry.id}>
            <summary>
              <span className="debug-entry-kind">{debugKindLabels[entry.kind]}</span>
              <span className="debug-entry-time">{entry.time.slice(11, 19)}</span>
              <span className="debug-entry-title">{entry.title}</span>
            </summary>
            <pre>{entry.content}</pre>
          </details>
        ))}
      </div>
    </div>
  );
}

// Kimi Work / Codex 风格的任务计划清单：数据来自 agent 的 plan-update 事件
function PlanCard({ steps }: { steps: PlanStep[] }) {
  const completed = steps.filter((step) => step.status === "completed").length;
  return (
    <div className="plan-card">
      <div className="plan-card-header">
        <ListTodo size={15} />
        <strong>工作计划</strong>
        <span>{completed}/{steps.length} 已完成</span>
      </div>
      <ul className="plan-card-steps">
        {steps.map((step, index) => (
          <li className={`plan-step ${step.status}`} key={`${index}-${step.title}`}>
            <span className="plan-step-icon">
              {step.status === "completed"
                ? <Check size={13} />
                : step.status === "in_progress"
                  ? <LoaderCircle className="spin" size={13} />
                  : <Circle size={11} />}
            </span>
            <span>{step.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Codex 风格的文件变更摘要卡片：数据来自 agent 的 file-change 事件（真实 +N/-M 统计，可展开 unified diff）
function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="diff-view">
      {diff.split("\n").map((line, index) => (
        <span
          key={index}
          className={
            line.startsWith("+++") || line.startsWith("---")
              ? "diff-file"
              : line.startsWith("+")
                ? "diff-add"
                : line.startsWith("-")
                  ? "diff-del"
                  : line.startsWith("@@")
                    ? "diff-hunk"
                    : ""
          }
        >
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function ChangesSummary({ changes, workspacePath }: { changes: FileChange[]; workspacePath: string }) {
  const [open, setOpen] = useState(false);
  const [diffPath, setDiffPath] = useState("");
  const totals = changes.reduce(
    (accumulator, change) => ({ added: accumulator.added + change.added, removed: accumulator.removed + change.removed }),
    { added: 0, removed: 0 },
  );
  const openFile = (change: FileChange) => {
    if (!window.dyworker || !workspacePath) return;
    void window.dyworker.openPath(`${workspacePath.replace(/[\\/]+$/, "")}/${change.path}`);
  };
  return (
    <div className="tool-summary">
      <button className="tool-summary-header clickable" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <div>
          <FileCode2 size={16} />
          <strong>已修改 {changes.length} 个文件</strong>
        </div>
        <span className="tool-summary-side">
          <b>+{totals.added}</b> <em>-{totals.removed}</em>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>
      {open && changes.map((change) => (
        <div className="tool-file-block" key={change.path}>
          <div className={`tool-file-row ${change.diff ? "clickable" : ""}`}>
            <button
              className="tool-file-main"
              onClick={() => change.diff && setDiffPath((current) => current === change.path ? "" : change.path)}
              disabled={!change.diff}
              aria-expanded={change.diff ? diffPath === change.path : undefined}
              title={change.diff ? "点击查看修改内容" : change.path}
            >
              <span>{change.path}</span>
              <span className="tool-summary-side">
                <b>+{change.added}</b> <em>-{change.removed}</em>
                {change.diff ? (diffPath === change.path ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
              </span>
            </button>
            <button
              className="icon-button subtle tiny"
              onClick={() => openFile(change)}
              disabled={!workspacePath}
              aria-label={`打开 ${change.path}`}
              title="打开文件"
            >
              <FolderOpen size={13} />
            </button>
          </div>
          {diffPath === change.path && change.diff && <DiffView diff={change.diff} />}
        </div>
      ))}
    </div>
  );
}

function formatDuration(ms?: number) {
  if (ms == null) return "";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes} 分 ${seconds % 60} 秒` : `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function ActivityIcon({ kind }: { kind: ActivityRecord["kind"] }) {
  if (String(kind).startsWith("browser__")) return <Globe size={14} />;
  if (String(kind).startsWith("mcp__computer-use__")) return <Monitor size={14} />;
  switch (kind) {
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
    case "write_file":
      return <FileCode2 size={14} />;
    case "run_command":
      return <Terminal size={14} />;
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

function ActivityRow({ activity }: { activity: ActivityRecord }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(activity.detail);
  return (
    <div className={`activity-row ${activity.status}`}>
      <button
        className="activity-row-main"
        onClick={() => expandable && setOpen((value) => !value)}
        disabled={!expandable}
      >
        <span className="activity-status">
          {activity.status === "running"
            ? <LoaderCircle className="spin" size={13} />
            : activity.status === "error"
              ? <X size={13} />
              : <Check size={13} />}
        </span>
        <ActivityIcon kind={activity.kind} />
        <span className="activity-title">{activity.title}</span>
        {expandable && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
      </button>
      {open && activity.detail && <pre className="activity-detail">{activity.detail}</pre>}
    </div>
  );
}

function ActivityList({ activities }: { activities: ActivityRecord[] }) {
  if (!activities.length) return null;
  return (
    <div className="activity-list">
      {activities.map((activity) => <ActivityRow key={activity.id} activity={activity} />)}
    </div>
  );
}

function ApprovalCard({ action, onResolve }: { action: ApprovalAction; onResolve: (approved: boolean) => void }) {
  const [ruleError, setRuleError] = useState("");
  const allowAlways = async () => {
    if (!action.suggestedRule) return;
    const result = await window.dyworker?.addRule(action.suggestedRule);
    if (result && !result.ok) {
      setRuleError(result.error || "规则保存失败");
      return;
    }
    onResolve(true);
  };
  return (
    <div className="approval-card">
      <div className="approval-card-header">
        <ShieldAlert size={15} />
        <strong>操作需要确认</strong>
        <span>{action.title}</span>
      </div>
      {action.details && <pre className="approval-details">{action.details}</pre>}
      <div className="approval-actions">
        <button className="button-secondary" onClick={() => onResolve(false)}>拒绝</button>
        <button className="button-primary" onClick={() => onResolve(true)}>允许执行</button>
        {action.suggestedRule && (
          <button className="button-secondary" title={action.suggestedRule.label} onClick={() => void allowAlways()}>
            始终允许
          </button>
        )}
      </div>
      {action.suggestedRule && <p className="approval-rule-hint">{action.suggestedRule.label}</p>}
      {ruleError && <p className="approval-rule-hint error">{ruleError}</p>}
    </div>
  );
}

function QuestionCard({ request, onResolve }: { request: QuestionRequest; onResolve: (answer: string) => void }) {
  const [text, setText] = useState("");
  const submit = (answer: string) => {
    const trimmed = answer.trim();
    if (trimmed) onResolve(trimmed);
  };
  return (
    <div className="approval-card question-card">
      <div className="approval-card-header">
        <MessageCircleQuestion size={15} />
        <strong>助手向你提问</strong>
      </div>
      <p className="question-text">{request.question}</p>
      {request.options.length > 0 && (
        <div className="question-options">
          {request.options.map((option) => (
            <button key={option} className="button-secondary" onClick={() => submit(option)}>{option}</button>
          ))}
        </div>
      )}
      <form
        className="question-input-row"
        onSubmit={(event) => {
          event.preventDefault();
          submit(text);
        }}
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="输入你的回答…"
          autoFocus={!request.options.length}
        />
        <button type="submit" className="button-primary" disabled={!text.trim()}>提交回答</button>
      </form>
    </div>
  );
}

function InboxDialog({ items, onClose, onResolve, onDismiss }: {
  items: InboxItem[];
  onClose: () => void;
  onResolve: (item: InboxItem, resolution: { approved?: boolean; answer?: string }) => void;
  onDismiss: (id: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = items.filter((item) => item.status === "pending");
  const settled = items.filter((item) => item.status !== "pending").slice(-10).reverse();
  const resolve = async (item: InboxItem, resolution: { approved?: boolean; answer?: string }) => {
    const result = await window.dyworker?.resolveInbox({ id: item.id, ...resolution });
    if (result && !result.ok) setErrors((current) => ({ ...current, [item.id]: result.error || "处理失败" }));
    else onResolve(item, resolution);
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="settings-dialog inbox-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <span className="dialog-kicker">收件箱</span>
            <h2>审批收件箱</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="inbox-dialog-body">
          {!pending.length && <p className="panel-empty">没有待处理的事项。无人值守的定时任务需要确认或向你提问时，会出现在这里。</p>}
          {pending.map((item) => (
            <div className="inbox-item" key={item.id}>
              <div className="inbox-item-head">
                <span className={`inbox-kind ${item.kind}`}>{item.kind === "question" ? "提问" : "审批"}</span>
                <span className="inbox-title">{item.kind === "question" ? item.question : item.title}</span>
                <small>{new Date(item.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
              </div>
              {item.details && <pre className="approval-details">{item.details}</pre>}
              {item.kind === "question" && item.options && item.options.length > 0 && (
                <div className="question-options">
                  {item.options.map((option) => (
                    <button key={option} className="button-secondary" onClick={() => void resolve(item, { answer: option })}>{option}</button>
                  ))}
                </div>
              )}
              {item.kind === "question" && (
                <div className="question-input-row">
                  <input
                    value={answers[item.id] || ""}
                    onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="输入你的回答…"
                  />
                  <button
                    className="button-primary"
                    disabled={!(answers[item.id] || "").trim()}
                    onClick={() => void resolve(item, { answer: answers[item.id] || "" })}
                  >提交回答</button>
                </div>
              )}
              {item.kind === "approval" && (
                <div className="approval-actions">
                  <button className="button-secondary" onClick={() => void resolve(item, { approved: false })}>拒绝</button>
                  <button className="button-primary" onClick={() => void resolve(item, { approved: true })}>允许执行</button>
                </div>
              )}
              {errors[item.id] && <p className="approval-rule-hint error">{errors[item.id]}</p>}
            </div>
          ))}
          {settled.length > 0 && (
            <>
              <div className="dialog-section-title">最近已处理</div>
              {settled.map((item) => (
                <div className="inbox-item settled" key={item.id}>
                  <div className="inbox-item-head">
                    <span className={`inbox-kind ${item.status === "expired" ? "expired" : item.kind}`}>
                      {item.status === "expired" ? "已失效" : item.kind === "question" ? "提问" : "审批"}
                    </span>
                    <span className="inbox-title">{item.kind === "question" ? item.question : item.title}</span>
                    <button className="icon-button subtle tiny" onClick={() => onDismiss(item.id)} aria-label="移除这条记录">
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {item.resolution && <small className="inbox-resolution">{item.resolution}</small>}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MemoriesPanel({ items, onDelete }: { items: MemoryItem[]; onDelete: (id: string) => void }) {
  const kindLabels: Record<MemoryItem["kind"], string> = {
    preference: "偏好",
    rule: "规则",
    taboo: "禁忌",
    fact: "事实",
    experience: "经验",
  };
  if (!items.length) {
    return <p className="panel-empty">助手在任务中发现长期有用的偏好和事实时，会自动保存在这里。</p>;
  }
  return (
    <div className="panel-list">
      {items.map((item) => (
        <div className="memory-item" key={item.id}>
          <div className="memory-item-head">
            <div className="memory-meta">
              <span className="memory-category">{item.category}</span>
              <span className="memory-badge">{kindLabels[item.kind] || "事实"}</span>
              <span className="memory-badge">{item.scope === "workspace" ? "当前工作区" : "全部工作区"}</span>
              {item.relation === "supersedes" ? <span className="memory-badge accent">已更新旧记忆</span> : null}
            </div>
            <button className="icon-button subtle tiny" onClick={() => onDelete(item.id)} aria-label="删除这条记忆">
              <Trash2 size={13} />
            </button>
          </div>
          <p>{item.content}</p>
        </div>
      ))}
    </div>
  );
}

function SkillsPanel({
  items,
  onToggle,
  onDelete,
  onRefresh,
  onOpen,
}: {
  items: SkillRecord[];
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  onOpen: (skill: SkillRecord) => void;
}) {
  return (
    <div className="skills-panel">
      <div className="skill-management-head">
        <div>
          <strong>已发现 {items.length} 个技能</strong>
          <small>自动读取用户目录与当前工作区中的 SKILL.md</small>
        </div>
        <button type="button" className="button-secondary" onClick={onRefresh}>
          <RefreshCw size={13} />
          刷新技能
        </button>
      </div>
      {!items.length ? (
        <p className="panel-empty">还没有发现技能。可放在 ~/.agents/skills、~/.agent/skills、~/.codex/skills，或当前工作区对应的技能目录中。</p>
      ) : (
        <div className="panel-list">
          {items.map((skill) => (
            <div className={`skill-item ${skill.enabled ? "" : "disabled"}`} key={skill.id}>
              <div className="skill-item-head">
                <div className="skill-name-block">
                  <div className="skill-title-row">
                    <strong title={skill.description}>{skill.name}</strong>
                    <span className={`skill-source-badge ${skill.source || "saved"}`}>{skill.sourceLabel || "本地模板"}</span>
                  </div>
                  {skill.path && <small className="skill-path" title={skill.path}>{skill.path}</small>}
                </div>
                <label className="skill-switch" title={skill.enabled ? "点击停用" : "点击启用"}>
                  <input type="checkbox" checked={skill.enabled} onChange={(event) => onToggle(skill.id, event.target.checked)} />
                </label>
                {skill.path && (
                  <button className="icon-button subtle tiny" onClick={() => onOpen(skill)} aria-label={`打开技能 ${skill.name}`}>
                    <FolderOpen size={13} />
                  </button>
                )}
                {!skill.readOnly && (
                  <button className="icon-button subtle tiny" onClick={() => onDelete(skill.id)} aria-label={`删除技能 ${skill.name}`}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <p>{skill.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const recurrenceLabels: Record<string, string> = { once: "一次", hourly: "每小时", daily: "每天", weekly: "每周" };

function formatScheduleTime(iso: string) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function defaultNextRun() {
  const date = new Date(Date.now() + 3600_000);
  date.setMinutes(0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

interface ScheduleDraft {
  name: string;
  prompt: string;
  recurrence: ScheduleRecord["recurrence"];
  nextRun: string;
  allowWorkspaceWrites: boolean;
}

function PlansPanel({
  items,
  workspaceReady,
  onSave,
  onToggle,
  onDelete,
  onTrigger,
  seed,
}: {
  items: ScheduleRecord[];
  workspaceReady: boolean;
  onSave: (draft: ScheduleDraft) => Promise<boolean>;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
  seed?: { name: string; prompt: string } | null;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft>({ name: "", prompt: "", recurrence: "daily", nextRun: defaultNextRun(), allowWorkspaceWrites: false });

  useEffect(() => {
    if (!seed) return;
    setDraft((current) => ({ ...current, name: seed.name || current.name, prompt: seed.prompt || current.prompt }));
    setFormOpen(true);
  }, [seed]);

  const submit = async () => {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) {
      setFormOpen(false);
      setDraft({ name: "", prompt: "", recurrence: "daily", nextRun: defaultNextRun(), allowWorkspaceWrites: false });
    }
  };

  return (
    <div className="plans-panel">
      <button className="new-task-button plan-new-button" onClick={() => setFormOpen((value) => !value)}>
        <Plus size={16} />
        新建定时计划
      </button>
      {formOpen && (
        <div className="plan-form">
          <input value={draft.name} placeholder="计划名称，例如：每周五周报提醒" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <textarea value={draft.prompt} rows={3} placeholder="到时间要助手做什么，例如：汇总工作区本周的文档改动，整理成周报草稿" onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} />
          <div className="plan-form-row">
            <select value={draft.recurrence} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value as ScheduleRecord["recurrence"] })}>
              <option value="once">一次</option>
              <option value="hourly">每小时</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
            </select>
            <input type="datetime-local" value={draft.nextRun} onChange={(event) => setDraft({ ...draft, nextRun: event.target.value })} />
          </div>
          <label className={`plan-form-check ${draft.allowWorkspaceWrites ? "checked" : ""}`}>
            <input type="checkbox" checked={draft.allowWorkspaceWrites} onChange={(event) => setDraft({ ...draft, allowWorkspaceWrites: event.target.checked })} />
            <span className="plan-form-check-copy">
              <strong>允许修改工作区文件</strong>
              <small>开启后助手可以创建和修改文件；关闭时只查看内容</small>
            </span>
          </label>
          <button className="button-primary plan-save" disabled={saving || !workspaceReady} onClick={() => void submit()}>
            {saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
            {workspaceReady ? "保存计划" : "请先选择工作文件夹"}
          </button>
        </div>
      )}
      {!items.length && !formOpen && (
        <p className="panel-empty">定时计划会让助手在指定时间自动执行任务，结果保存到最近任务里。</p>
      )}
      <div className="panel-list">
        {items.map((plan) => (
          <div className={`plan-item ${plan.enabled ? "" : "disabled"}`} key={plan.id}>
            <div className="skill-item-head">
              <strong title={plan.prompt}>{plan.name}</strong>
              <label className="skill-switch" title={plan.enabled ? "点击停用" : "点击启用"}>
                <input type="checkbox" checked={plan.enabled} onChange={(event) => onToggle(plan.id, event.target.checked)} />
              </label>
              <button className="icon-button subtle tiny" onClick={() => onDelete(plan.id)} aria-label="删除这个计划">
                <Trash2 size={13} />
              </button>
            </div>
            <p>{recurrenceLabels[plan.recurrence] || plan.recurrence} · 下次 {formatScheduleTime(plan.nextRun)}</p>
            {plan.lastStatus && (
              <p className={`plan-status ${plan.lastStatus}`}>
                {plan.lastStatus === "running" ? "正在执行…" : plan.lastStatus === "sleeping" ? plan.lastSummary || "已挂起等待唤醒" : plan.lastStatus === "success" ? `上次完成：${plan.lastSummary || "正常"}` : `上次失败：${plan.lastSummary || "未知原因"}`}
              </p>
            )}
            <button className="bare-button plan-run-now" onClick={() => onTrigger(plan.id)} disabled={plan.lastStatus === "running"}>
              立即执行
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// 上下文用量圆环：当前会话已用标记 / 当前模型上下文上限
function ContextRing({ used, limit, exact }: { used: number; limit: number; exact?: boolean }) {
  const summary = contextUsageSummary(used, limit);
  const { ratio, percent } = summary;
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const level = ratio >= 0.95 ? "danger" : ratio >= 0.8 ? "warn" : "ok";
  return (
    <span
      className={`context-ring ${level}`}
      tabIndex={0}
      aria-label={`上下文窗口：${summary.percentLabel} 已用，已用 ${summary.usedLabel} 标记，共 ${summary.limitLabel}`}
    >
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r={radius} fill="none" strokeWidth="2.5" className="context-ring-track" />
        <circle
          cx="11"
          cy="11"
          r={radius}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="context-ring-value"
          strokeDasharray={`${(ratio * circumference).toFixed(1)} ${circumference.toFixed(1)}`}
          transform="rotate(-90 11 11)"
        />
      </svg>
      <span className="context-ring-text">{percent === 0 && used > 0 ? "<1%" : `${percent}%`}</span>
      <span className="context-ring-tooltip" role="tooltip">
        <span>上下文窗口：</span>
        <strong>{summary.percentLabel} 已用</strong>
        <span>已用 {summary.usedLabel} 标记，共 {summary.limitLabel}</span>
        {!exact && <small>当前为估算值，发送任务后按服务返回值更新</small>}
      </span>
    </span>
  );
}

interface ModelUsageSummary {
  requests: number;
  prompt: number;
  completion: number;
  estimated: number;
  todayPrompt: number;
  todayCompletion: number;
}

function UsageStatsPanel({ records }: { records: UsageRecord[] | null }) {
  const summary = useMemo(() => {
    const today = new Date().toDateString();
    const byModel = new Map<string, ModelUsageSummary>();
    for (const record of records || []) {
      const entry = byModel.get(record.model) || { requests: 0, prompt: 0, completion: 0, estimated: 0, todayPrompt: 0, todayCompletion: 0 };
      entry.requests += 1;
      entry.prompt += record.prompt;
      entry.completion += record.completion;
      if (record.estimated) entry.estimated += 1;
      if (new Date(record.time).toDateString() === today) {
        entry.todayPrompt += record.prompt;
        entry.todayCompletion += record.completion;
      }
      byModel.set(record.model, entry);
    }
    return [...byModel.entries()].sort((a, b) => (b[1].prompt + b[1].completion) - (a[1].prompt + a[1].completion));
  }, [records]);
  const totals = summary.reduce((sum, [, entry]) => ({
    requests: sum.requests + entry.requests,
    prompt: sum.prompt + entry.prompt,
    completion: sum.completion + entry.completion,
    today: sum.today + entry.todayPrompt + entry.todayCompletion,
  }), { requests: 0, prompt: 0, completion: 0, today: 0 });

  return (
    <>
      {records === null ? (
          <p className="dialog-note">正在读取…</p>
        ) : summary.length === 0 ? (
          <p className="dialog-note">还没有用量记录。发送任务后，每次模型调用的 token 用量会按模型累计在这里。</p>
        ) : (
          <>
            <p className="dialog-note">
              今日 {formatTokenCount(totals.today)} tokens · 累计 {totals.requests} 次请求，输入 {formatTokenCount(totals.prompt)} + 输出 {formatTokenCount(totals.completion)} = {formatTokenCount(totals.prompt + totals.completion)} tokens
            </p>
            <table className="usage-table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>请求</th>
                  <th>输入</th>
                  <th>输出</th>
                  <th>合计</th>
                  <th>今日</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(([model, entry]) => (
                  <tr key={model}>
                    <td className="usage-model">{model}</td>
                    <td>{entry.requests}</td>
                    <td>{formatTokenCount(entry.prompt)}</td>
                    <td>{formatTokenCount(entry.completion)}</td>
                    <td>{formatTokenCount(entry.prompt + entry.completion)}</td>
                    <td>{formatTokenCount(entry.todayPrompt + entry.todayCompletion)}</td>
                    <td>{entry.estimated > 0 ? `含 ${entry.estimated} 次估算` : "实测"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dialog-note">标注「估算」的记录来自不回 usage 的端点，按中文 1 token、其他字符约 4 个 1 token 估算；实测记录以端点返回的 usage 为准。</p>
          </>
        )}
    </>
  );
}

function UsageStatsDialog({ records, onClose, onClear }: { records: UsageRecord[] | null; onClose: () => void; onClear: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="settings-dialog usage-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <span className="dialog-kicker">Token 用量</span>
            <h2>用量统计</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭用量统计">
            <X size={18} />
          </button>
        </div>
        <UsageStatsPanel records={records} />
        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onClear}>清空记录</button>
          <button type="button" className="button-primary" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}

type SettingsTab = "model" | "voice" | "search" | "power" | "mcp" | "channels" | "memories" | "skills" | "plans" | "usage" | "hooks";

// Codex 风格设置导航:左侧分组 + 搜索,右侧分区内容
const settingsNav: { group: string; items: { id: SettingsTab; label: string; icon: typeof Settings }[] }[] = [
  { group: "服务", items: [
    { id: "model", label: "模型服务", icon: Settings },
    { id: "voice", label: "语音转写", icon: Mic },
    { id: "search", label: "搜索", icon: Search },
    { id: "channels", label: "消息渠道", icon: MessagesSquare },
  ] },
  { group: "偏好", items: [
    { id: "power", label: "电源", icon: Moon },
    { id: "mcp", label: "MCP 工具", icon: Bot },
  ] },
  { group: "资源", items: [
    { id: "memories", label: "记忆", icon: History },
    { id: "skills", label: "技能", icon: FileCode2 },
    { id: "plans", label: "定时计划", icon: ListTodo },
  ] },
  { group: "高级", items: [
    { id: "usage", label: "用量统计", icon: BarChart3 },
    { id: "hooks", label: "权限规则", icon: ShieldAlert },
  ] },
];

function hookRuleText(rule: HookRule) {
  const tools = Array.isArray(rule.tool) ? rule.tool.join("、") : rule.tool;
  const target = rule.path ? ` 路径 ${rule.path}` : rule.command ? ` 命令 ${rule.command}` : "";
  return { title: `${tools}${target}`, action: rule.action === "block" ? "阻止" : "强制审批", message: rule.message || "" };
}

function HooksPanel() {
  const [data, setData] = useState<{ builtin: HookRule[]; user: HookRule[]; userPath: string } | null>(null);
  const [rules, setRules] = useState<StandingRule[]>([]);
  useEffect(() => {
    if (window.dyworker?.listHooks) void window.dyworker.listHooks().then(setData);
    if (window.dyworker?.listRules) void window.dyworker.listRules().then(setRules);
  }, []);
  const deleteRule = (id: string) => {
    void window.dyworker?.deleteRule(id).then(() => window.dyworker?.listRules().then(setRules));
  };
  return (
    <div className="hooks-panel">
      <div className="dialog-section-title">常驻允许规则（「始终允许」后同类操作不再询问）</div>
      {rules.length ? rules.map((rule) => (
        <div className="hook-rule-row" key={rule.id}>
          <span className="hook-rule-action allow">允许</span>
          <span className="hook-rule-title">{rule.label || rule.pattern}</span>
          <button className="icon-button subtle tiny" onClick={() => deleteRule(rule.id)} aria-label="删除这条规则">
            <Trash2 size={13} />
          </button>
        </div>
      )) : <p className="dialog-note">还没有常驻规则。在审批卡片上点「始终允许」后会出现在这里；受信只读命令（ls/cat/grep 等）、同类文件写入、同域名网页可以规则化，本机界面操作永远逐次确认。</p>}
      <div className="dialog-section-title">内置规则（始终生效，不可覆盖）</div>
      {(data?.builtin || []).map((rule, index) => {
        const text = hookRuleText(rule);
        return (
          <div className="hook-rule-row" key={index}>
            <span className={`hook-rule-action ${rule.action}`}>{text.action}</span>
            <span className="hook-rule-title">{text.title}</span>
            <small>{text.message}</small>
          </div>
        );
      })}
      <div className="dialog-section-title">用户规则（对所有工作区生效）</div>
      {data?.user?.length ? data.user.map((rule, index) => {
        const text = hookRuleText(rule);
        return (
          <div className="hook-rule-row" key={index}>
            <span className={`hook-rule-action ${rule.action}`}>{text.action}</span>
            <span className="hook-rule-title">{text.title}</span>
            <small>{text.message}</small>
          </div>
        );
      }) : <p className="dialog-note">还没有用户规则。规则写在下方的 JSON 文件里，保存后下一个任务生效。</p>}
      <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="button-secondary" onClick={() => void window.dyworker?.openUserHooks?.()}>
          打开用户规则文件
        </button>
        <button type="button" className="button-secondary" onClick={() => void window.dyworker?.openAuditLog?.()}>
          打开审计日志
        </button>
      </div>
      <p className="dialog-note">审计日志记录所有文件修改、命令执行、联网与外部工具调用的审批与执行结果，可用于操作追溯。</p>
      <p className="dialog-note">
        工作区级规则放在当前工作区的 .dyworker/hooks.json，只对该工作区生效。规则格式：{'{ "tool": "delete_file", "path": "*.docx", "action": "block", "message": "说明" }'}；action 支持 block（直接阻止）和 require_approval（任何模式下都强制人工确认）。
      </p>
    </div>
  );
}

// 消息渠道面板:QQ 官方机器人 + 微信 ClawBot。配置改动即存(走 settings:save,主进程热生效);
// 连接状态由主进程 channels:status 推送,微信扫码登录二维码也经此下发。
const channelStatusText: Record<ChannelConnectionStatus, string> = {
  disabled: "未启用",
  connecting: "连接中…",
  "awaiting-scan": "等待扫码",
  online: "已连接",
  error: "错误",
};

function ChannelStatusLine({ status }: { status?: { status: ChannelConnectionStatus; detail: string; qrUrl?: string } }) {
  const current = status?.status ?? "disabled";
  return (
    <div className={`channel-status ${current}`}>
      <span className="channel-status-dot" />
      <span>{channelStatusText[current]}{status?.detail ? `：${status.detail}` : ""}</span>
    </div>
  );
}

function ChannelsPanel({ value, onSave }: {
  value: ProviderSettings;
  onSave: (value: ProviderSettings, successMessage?: string) => Promise<boolean>;
}) {
  const channels = value.channels ?? defaultSettings.channels;
  const [statusMap, setStatusMap] = useState<ChannelsStatusMap | null>(null);
  const [qqAppId, setQqAppId] = useState(channels.qq.appId);
  const [qqSecret, setQqSecret] = useState(channels.qq.appSecret);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let disposed = false;
    void window.dyworker?.getChannelsStatus?.().then((map) => {
      if (!disposed) setStatusMap(map);
    }).catch(() => { });
    const unsubscribe = window.dyworker?.onChannelsStatus?.((map) => setStatusMap(map));
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const saveChannels = async (next: ChannelsConfig, message: string) => {
    setSaving(true);
    try {
      await onSave({ ...value, channels: next }, message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="dialog-section-title">渠道任务模型</div>
      <div className="mcp-server-row">
        <span className="mcp-server-name">
          <strong>渠道对话使用的模型</strong>
          <small>默认跟随桌面端当前模型;也可固定为一个已保存的模型档案</small>
        </span>
        <select
          className="channel-model-select"
          value={channels.modelProfileId}
          disabled={saving}
          onChange={(event) => void saveChannels({ ...channels, modelProfileId: event.target.value }, "渠道模型已更新")}
        >
          <option value="">跟随当前模型（{value.model || "未配置"}）</option>
          {(value.profiles || []).map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}（{profile.model}）</option>
          ))}
        </select>
      </div>
      <div className="mcp-server-row">
        <span className="mcp-server-name">
          <strong>审批严格度</strong>
          <small>省心模式只对本机界面操作、工作区外写入、非常规命令要求确认</small>
        </span>
        <select
          className="channel-model-select"
          value={channels.approvalMode}
          disabled={saving}
          onChange={(event) => void saveChannels({ ...channels, approvalMode: event.target.value as ChannelsConfig["approvalMode"] }, "审批严格度已更新")}
        >
          <option value="allow-writes">省心（搜索/读写自动放行）</option>
          <option value="interactive">严格（联网与重要操作逐次确认）</option>
        </select>
      </div>

      <div className="dialog-section-title">QQ 机器人（官方）</div>
      <ChannelStatusLine status={statusMap?.qq} />
      <p className="dialog-note">
        在 <a href="https://q.qq.com" target="_blank" rel="noreferrer">QQ 开放平台</a> 创建机器人（个人主体即可，支持单聊与群聊），把 AppID 和 AppSecret 填到这里。群里需要 @机器人 才会响应，私聊直接对话。
      </p>
      <div className="mcp-add-form">
        <input
          value={qqAppId}
          placeholder="AppID"
          onChange={(event) => setQqAppId(event.target.value)}
        />
        <input
          value={qqSecret}
          type="password"
          placeholder="AppSecret(加密保存)"
          onChange={(event) => setQqSecret(event.target.value)}
        />
        <button
          type="button"
          className="button-secondary"
          disabled={saving}
          onClick={() => void saveChannels({ ...channels, qq: { ...channels.qq, appId: qqAppId.trim(), appSecret: qqSecret.trim() } }, "QQ 凭据已保存")}
        >保存凭据</button>
      </div>
      <div className="mcp-server-row">
        <label className="skill-switch" title={channels.qq.enabled ? "点击停用" : "点击启用"}>
          <input
            type="checkbox"
            checked={channels.qq.enabled}
            disabled={saving || !channels.qq.appId || !channels.qq.appSecret}
            onChange={(event) => void saveChannels({ ...channels, qq: { ...channels.qq, enabled: event.target.checked } }, event.target.checked ? "QQ 渠道已启用" : "QQ 渠道已停用")}
          />
        </label>
        <span className="mcp-server-name">
          <strong>{channels.qq.enabled ? "QQ 渠道运行中" : "启用 QQ 渠道"}</strong>
          <small>{channels.qq.appId ? "开关即时生效,无需重启" : "先在上方保存 AppID 和 AppSecret"}</small>
        </span>
      </div>

      <div className="dialog-section-title">微信（ClawBot 官方通道）</div>
      <ChannelStatusLine status={statusMap?.wechat} />
      {statusMap?.wechat?.status === "awaiting-scan" && statusMap.wechat.qrUrl ? (
        <div className="channel-qr">
          <img src={statusMap.wechat.qrUrl} alt="微信登录二维码" />
          <p className="dialog-note">用微信扫码并在手机上确认,登录后凭据加密保存在本机。</p>
        </div>
      ) : null}
      <p className="dialog-note">
        启用后用手机微信扫码登录,他人给你的微信发消息即可让 DyWork 处理并回复。群聊与文件/图片消息暂不支持。
      </p>
      <div className="mcp-server-row">
        <label className="skill-switch" title={channels.wechat.enabled ? "点击停用" : "点击启用"}>
          <input
            type="checkbox"
            checked={channels.wechat.enabled}
            disabled={saving}
            onChange={(event) => void saveChannels({ ...channels, wechat: { enabled: event.target.checked } }, event.target.checked ? "微信渠道已启用,请扫码登录" : "微信渠道已停用")}
          />
        </label>
        <span className="mcp-server-name">
          <strong>{channels.wechat.enabled ? "微信渠道运行中" : "启用微信渠道"}</strong>
          <small>{channels.wechat.enabled ? "凭据加密保存在本机,下次启动自动登录" : "开启后用手机微信扫码登录"}</small>
        </span>
      </div>

      <div className="dialog-section-title">说明</div>
      <p className="dialog-note">
        渠道消息会在左侧生成独立会话并完整留痕;需要确认的操作会同时发到 IM 和审批收件箱,回复「允许/拒绝」或在收件箱处理都可以。同一时间只执行一个任务,其余消息排队处理。
      </p>
    </>
  );
}

function SettingsDialog({
  value,
  onClose,
  onSave,
  memories,
  onDeleteMemory,
  skills,
  onToggleSkill,
  onDeleteSkill,
  onRefreshSkills,
  onOpenSkill,
  schedules,
  workspaceReady,
  onSaveSchedule,
  onToggleSchedule,
  onDeleteSchedule,
  onTriggerSchedule,
  usageRecords,
  onClearUsage,
  tab,
  onTabChange,
  planSeed,
}: {
  value: ProviderSettings;
  onClose: () => void;
  onSave: (value: ProviderSettings, successMessage?: string) => Promise<boolean>;
  memories: MemoryItem[];
  onDeleteMemory: (id: string) => void;
  skills: SkillRecord[];
  onToggleSkill: (id: string, enabled: boolean) => void;
  onDeleteSkill: (id: string) => void;
  onRefreshSkills: () => void;
  onOpenSkill: (skill: SkillRecord) => void;
  schedules: ScheduleRecord[];
  workspaceReady: boolean;
  onSaveSchedule: (draft: ScheduleDraft) => Promise<boolean>;
  onToggleSchedule: (id: string, enabled: boolean) => void;
  onDeleteSchedule: (id: string) => void;
  onTriggerSchedule: (id: string) => void;
  usageRecords: UsageRecord[] | null;
  onClearUsage: () => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  planSeed?: { name: string; prompt: string } | null;
}) {
  const [draft, setDraft] = useState(value);
  const [providerId, setProviderId] = useState(() => matchProvider(value.endpoint));
  const [mcpDraft, setMcpDraft] = useState({ name: "", command: "", args: "" });
  const [saving, setSaving] = useState(false);
  const [navQuery, setNavQuery] = useState("");
  const [profileId, setProfileId] = useState(() => (
    (value.profiles || []).find((item) => item.endpoint === value.endpoint && item.model === value.model)?.id || ""
  ));
  const profiles = draft.profiles || [];
  const activeLabel = settingsNav.flatMap((group) => group.items).find((item) => item.id === tab)?.label || "设置";
  const preset = providerPresets.find((item) => item.id === providerId) || providerPresets[providerPresets.length - 1];
  const modelComplete = Boolean(draft.endpoint.trim() && draft.model.trim() && draft.apiKey.trim());

  const applyProvider = (id: string) => {
    setProviderId(id);
    const next = providerPresets.find((item) => item.id === id);
    if (next?.id === "custom") {
      setProfileId("");
      setDraft((current) => ({
        ...current,
        endpoint: "",
        model: "",
        apiKey: "",
        transcriptionEndpoint: "",
      }));
      return;
    }
    if (next && next.id !== "custom") {
      const saved = profiles.find((item) => item.endpoint === next.endpoint && item.model === next.defaultModel)
        || profiles.find((item) => item.endpoint === next.endpoint);
      setProfileId(saved?.id || "");
      setDraft((current) => saved ? settingsWithProfile(current, saved) : {
        ...current,
        endpoint: next.endpoint,
        model: next.defaultModel,
        apiKey: "",
      });
    }
  };

  const applyProfile = (id: string) => {
    setProfileId(id);
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    setProviderId(matchProvider(profile.endpoint));
    setDraft((current) => settingsWithProfile(current, profile));
  };

  const applyEndpoint = (endpoint: string) => {
    const saved = profiles.find((item) => item.endpoint === endpoint.trim() && item.model === draft.model.trim());
    setProfileId(saved?.id || "");
    setProviderId(matchProvider(endpoint));
    setDraft((current) => saved ? settingsWithProfile(current, saved) : {
      ...current,
      endpoint,
      apiKey: endpoint.trim() === current.endpoint.trim() ? current.apiKey : "",
    });
  };

  const applyModel = (model: string) => {
    const saved = profiles.find((item) => item.endpoint === draft.endpoint.trim() && item.model === model.trim());
    setProfileId(saved?.id || "");
    setDraft((current) => ({
      ...current,
      model,
      apiKey: saved?.apiKey ?? current.apiKey,
      transcriptionEndpoint: saved?.transcriptionEndpoint ?? current.transcriptionEndpoint,
      transcriptionModel: saved?.transcriptionModel || current.transcriptionModel,
    }));
  };

  const saveCurrentModel = (current: ProviderSettings) => {
    let shortProvider = preset.name.replace(/（.*?）/g, "");
    if (preset.id === "custom") {
      try {
        shortProvider = new URL(current.endpoint.trim()).host;
      } catch {
        shortProvider = "自定义";
      }
    }
    const endpoint = current.endpoint.trim();
    const model = current.model.trim();
    const apiKey = current.apiKey.trim();
    const name = `${shortProvider} · ${model}`.trim();
    const existing = profiles.find((item) => item.id === profileId)
      || profiles.find((item) => item.endpoint === endpoint && item.model === model);
    const profile: ModelProfile = {
      id: existing?.id || crypto.randomUUID(),
      name,
      endpoint,
      model,
      apiKey,
      transcriptionEndpoint: current.transcriptionEndpoint,
      transcriptionModel: current.transcriptionModel,
    };
    const list = profiles.filter((item) => item.id !== profile.id
      && !(item.endpoint === endpoint && item.model === model));
    return {
      ...current,
      endpoint,
      model,
      apiKey,
      profiles: [...list, profile],
    };
  };

  const removeProfile = async () => {
    if (!profileId) return;
    if (!window.confirm("删除后会立即生效，关闭设置或点击取消也无法恢复。确定删除这套模型配置吗？")) return;
    const remaining = profiles.filter((item) => item.id !== profileId);
    const next = remaining[0];
    const nextDraft = next ? {
      ...settingsWithProfile(draft, next),
      profiles: remaining,
    } : {
      ...draft,
      endpoint: "",
      model: "",
      apiKey: "",
      transcriptionEndpoint: "",
      profiles: [],
    };
    setSaving(true);
    const saved = await onSave(nextDraft, "模型配置已删除");
    setSaving(false);
    if (!saved) return;
    setProfileId(next?.id || "");
    setProviderId(next ? matchProvider(next.endpoint) : "custom");
    setDraft(nextDraft);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (tab === "model" && !modelComplete) return;
    setSaving(true);
    const nextDraft = tab === "model" ? saveCurrentModel(draft) : draft;
    const saved = await onSave(
      nextDraft,
      tab === "model" ? "模型服务已保存并启用" : "设置已保存",
    );
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="settings-dialog settings-v2" onMouseDown={(event) => event.stopPropagation()}>
        <aside className="settings-nav">
          <div className="settings-nav-search">
            <Search size={13} />
            <input value={navQuery} placeholder="搜索设置…" onChange={(event) => setNavQuery(event.target.value)} />
          </div>
          {settingsNav.map((group) => {
            const items = group.items.filter((item) => !navQuery.trim() || item.label.toLowerCase().includes(navQuery.trim().toLowerCase()));
            if (!items.length) return null;
            return (
              <div key={group.group}>
                <div className="settings-nav-group">{group.group}</div>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`settings-nav-item ${tab === item.id ? "active" : ""}`}
                      onClick={() => onTabChange(item.id)}
                    >
                      <Icon size={14} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </aside>
        <div className="settings-content">
        <div className="dialog-header">
          <div>
            <span className="dialog-kicker">设置</span>
            <h2>{activeLabel}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭设置">
            <X size={18} />
          </button>
        </div>
        {["model", "voice", "search", "power", "mcp"].includes(tab) ? (
          <form onSubmit={submit}>
        {tab === "model" && (<>
        <div className="dialog-section-title">已保存的模型</div>
        <p className="profile-section-hint">选择一套配置后会自动填入下方内容，确认后点击“保存并使用”。</p>
        <div className="profile-row">
          <select value={profileId} onChange={(event) => applyProfile(event.target.value)}>
            <option value="">{profiles.length ? "选择要使用或编辑的模型…" : "还没有保存的模型"}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
          <button type="button" className="icon-button" onClick={() => void removeProfile()} disabled={!profileId || saving} aria-label="删除所选配置">
            <Trash2 size={15} />
          </button>
        </div>
        <div className="dialog-section-title">连接信息</div>
        <p className="profile-section-hint">保存后会立即用于后续任务，并加入上方列表，之后可以直接切换。</p>
        <label>
          服务商
          <select value={providerId} onChange={(event) => applyProvider(event.target.value)}>
            {providerPresets.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label>
          服务地址
          <input
            value={draft.endpoint}
            placeholder={providerId === "deepseek" ? "https://api.deepseek.com/responses" : "https://api.example.com/v1/chat/completions"}
            onChange={(event) => applyEndpoint(event.target.value)}
          />
        </label>
        <label>
          模型名称
          <input
            value={draft.model}
            list="preset-models"
            placeholder={preset.defaultModel || "填写服务商提供的模型名称"}
            onChange={(event) => applyModel(event.target.value)}
          />
          <datalist id="preset-models">
            {preset.models.map((model) => <option key={model} value={model} />)}
          </datalist>
        </label>
        <label>
          API 密钥
          <input
            value={draft.apiKey}
            type="password"
            placeholder={`仅保存在当前设备（${preset.keyHint}）`}
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
          />
        </label>
        </>)}
        {tab === "power" && (<>
        <div className="dialog-section-title">电源</div>
        <label>
          防止电脑休眠
          <select
            value={draft.preventSleep}
            onChange={(event) => setDraft({ ...draft, preventSleep: event.target.value as ProviderSettings["preventSleep"] })}
          >
            <option value="off">关闭</option>
            <option value="tasks">仅任务运行期间（推荐）</option>
            <option value="always">始终保持唤醒</option>
          </select>
        </label>
        <p className="dialog-note">只阻止系统挂起，屏幕照常关闭、照常锁定，锁屏安全不受影响；长任务（持续执行、/goal、定时计划）跑到一半电脑睡着时可开启。无人值守的机器建议选「仅任务运行期间」，「始终保持唤醒」请确认符合单位安全规定。Linux 依赖 systemd-logind，个别桌面环境可能不支持。</p>
        </>)}
        {tab === "search" && (<>
        <div className="dialog-section-title">搜索（可选）</div>
        <label>
          博查 API 密钥
          <input
            value={draft.bochaApiKey}
            type="password"
            placeholder="AI 搜索服务，结果带摘要，调研类任务更稳（bochaai.com）"
            onChange={(event) => setDraft({ ...draft, bochaApiKey: event.target.value })}
          />
        </label>
        <label>
          SearXNG 服务地址
          <input
            value={draft.searxngEndpoint}
            placeholder="自建开源搜索，如 http://192.168.1.10:8080；留空用国内引擎"
            onChange={(event) => setDraft({ ...draft, searxngEndpoint: event.target.value })}
          />
        </label>
        <label className="dialog-check">
          <input
            type="checkbox"
            checked={draft.domesticSearchOnly}
            onChange={(event) => setDraft({ ...draft, domesticSearchOnly: event.target.checked })}
          />
          仅使用境内搜索（推荐敏感单位开启：跳过必应，查询不发送给外企服务）
        </label>
        <p className="dialog-note">搜索优先级：博查 API → 自建 SearXNG → 必应国内版（带摘要）→ 360 / 搜狗抓取。涉密信息请勿使用任何联网搜索；政策法规建议用 gov_search 官方接口。自建 SearXNG 请只挂境内引擎后端，查询才不出境。</p>
        </>)}
        {tab === "mcp" && (<>
        <div className="dialog-section-title">MCP 工具服务器（可选）</div>
        <p className="dialog-note">本机应用操作已作为基础能力接入：macOS 自动使用 Codex Computer Use，麒麟 V10 等 Linux 电脑自动使用内置桌面操控，无需重复添加。</p>
        {draft.mcpServers.map((server) => (
          <div className="mcp-server-row" key={server.id}>
            <label className="skill-switch" title={server.enabled ? "点击停用" : "点击启用"}>
              <input
                type="checkbox"
                checked={server.enabled}
                onChange={(event) => setDraft({
                  ...draft,
                  mcpServers: draft.mcpServers.map((item) => item.id === server.id ? { ...item, enabled: event.target.checked } : item),
                })}
              />
            </label>
            <span className="mcp-server-name">
              <strong>{server.name || server.command}</strong>
              <small>{server.command} {server.args.join(" ")}</small>
            </span>
            <button
              type="button"
              className="icon-button subtle tiny"
              aria-label="删除这个 MCP 服务器"
              onClick={() => setDraft({ ...draft, mcpServers: draft.mcpServers.filter((item) => item.id !== server.id) })}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <div className="mcp-add-form">
          <input
            value={mcpDraft.name}
            placeholder="名称，例如：内部知识库"
            onChange={(event) => setMcpDraft({ ...mcpDraft, name: event.target.value })}
          />
          <input
            value={mcpDraft.command}
            placeholder="命令，例如：npx 或 /usr/local/bin/my-mcp"
            onChange={(event) => setMcpDraft({ ...mcpDraft, command: event.target.value })}
          />
          <input
            value={mcpDraft.args}
            placeholder="参数，例如：-y @scope/mcp-server --dir /data"
            onChange={(event) => setMcpDraft({ ...mcpDraft, args: event.target.value })}
          />
          <button
            type="button"
            className="button-secondary"
            disabled={!mcpDraft.command.trim()}
            onClick={() => {
              setDraft({
                ...draft,
                mcpServers: [...draft.mcpServers, {
                  id: crypto.randomUUID(),
                  name: mcpDraft.name.trim() || mcpDraft.command.trim(),
                  command: mcpDraft.command.trim(),
                  args: mcpDraft.args.split(" ").filter(Boolean),
                  enabled: true,
                }],
              });
              setMcpDraft({ name: "", command: "", args: "" });
            }}
          >
            <Plus size={14} />
            添加
          </button>
        </div>
        </>)}
        {tab === "voice" && (<>
        <div className="dialog-section-title">语音转写</div>
        <label>
          转写服务地址
          <input
            value={draft.transcriptionEndpoint}
            placeholder="留空时根据模型服务地址自动生成"
            onChange={(event) => setDraft({ ...draft, transcriptionEndpoint: event.target.value })}
          />
        </label>
        <label>
          转写模型
          <input
            value={draft.transcriptionModel}
            placeholder="whisper-1"
            onChange={(event) => setDraft({ ...draft, transcriptionModel: event.target.value })}
          />
        </label>
        <p className="dialog-note">切换服务商后只需核对模型名称并填入密钥。文本、图片附件和语音转写使用兼容 OpenAI 格式的服务。</p>
        </>)}
        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="button-primary" disabled={saving || (tab === "model" && !modelComplete)}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            {tab === "model" ? "保存并使用" : "保存设置"}
          </button>
        </div>
          </form>
        ) : tab === "memories" ? (
          <MemoriesPanel items={memories} onDelete={onDeleteMemory} />
        ) : tab === "skills" ? (
          <SkillsPanel
            items={skills}
            onToggle={onToggleSkill}
            onDelete={onDeleteSkill}
            onRefresh={onRefreshSkills}
            onOpen={onOpenSkill}
          />
        ) : tab === "usage" ? (
          <>
            <UsageStatsPanel records={usageRecords} />
            <div className="dialog-actions">
              <button type="button" className="button-secondary" onClick={onClearUsage}>清空记录</button>
            </div>
          </>
        ) : tab === "hooks" ? (
          <HooksPanel />
        ) : tab === "channels" ? (
          <ChannelsPanel value={value} onSave={onSave} />
        ) : (
          <PlansPanel
            items={schedules}
            workspaceReady={workspaceReady}
            onSave={onSaveSchedule}
            onToggle={onToggleSchedule}
            onDelete={onDeleteSchedule}
            onTrigger={onTriggerSchedule}
            seed={planSeed}
          />
        )}
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [sessions, setSessions] = useState<SessionRecord[]>(previewSessions);
  const [activeId, setActiveId] = useState(previewSessions[0].id);
  const [workspacePath, setWorkspacePath] = useState(previewSessions[0].workspacePath);
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>(previewWorkspace);
  const [settings, setSettings] = useState<ProviderSettings>(defaultSettings);
  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [runningStartedAt, setRunningStartedAt] = useState<Record<string, number>>({});
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [approvalMenuOpen, setApprovalMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [platform, setPlatform] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>({});
  const [sessionNotices, setSessionNotices] = useState<Record<string, string>>({});
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, ApprovalAction>>({});
  const [pendingQuestions, setPendingQuestions] = useState<Record<string, QuestionRequest>>({});
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("allow-writes");
  const [loopStates, setLoopStates] = useState<Record<string, { iteration: number; maximum: number; status: string }>>({});
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [mentionMenu, setMentionMenu] = useState<{ kind: "slash" | "at"; query: string; start: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionSkills, setMentionSkills] = useState<SkillRecord[]>([]);
  const [activeSkills, setActiveSkills] = useState<SkillRecord[]>([]);
  const [collapsedActivities, setCollapsedActivities] = useState<Set<string>>(new Set());
  const [, setElapsedTick] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [topMenuOpen, setTopMenuOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [usageStatsOpen, setUsageStatsOpen] = useState(false);
  const [usageStats, setUsageStats] = useState<UsageRecord[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("model");
  const [planSeed, setPlanSeed] = useState<{ name: string; prompt: string } | null>(null);
  const agentUnsubscribeRefs = useRef<Map<string, () => void>>(new Map());
  const runningRunIdsRef = useRef<Map<string, string>>(new Map());
  const sessionNoticeTimersRef = useRef<Map<string, number>>(new Map());
  const viewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const shouldScrollToBottomRef = useRef<string | null>(null);

  // 下拉菜单（会话项/顶栏/输入区“+”）：点击菜单容器之外或按 Esc 时关闭
  const anyMenuOpen = sessionMenuId !== null || topMenuOpen || addMenuOpen || modelMenuOpen || approvalMenuOpen;
  useEffect(() => {
    if (!anyMenuOpen) return;
    const closeAll = () => {
      setSessionMenuId(null);
      setTopMenuOpen(false);
      setAddMenuOpen(false);
      setModelMenuOpen(false);
      setApprovalMenuOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-menu-root]")) return;
      closeAll();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeAll();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anyMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!window.dyworker) {
        setReady(true);
        return;
      }
      try {
        const state = await window.dyworker.getInitialState();
        if (cancelled) return;
        const loaded = state.sessions.length ? state.sessions : [makeSession(state.workspacePath)];
        setSessions(loaded);
        setActiveId(loaded[0].id);
        setWorkspacePath(state.workspacePath);
        setWorkspaceEntries(state.workspaceEntries);
        setSettings(state.settings);
        setPlatform(state.platform || "");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !window.dyworker) return;
    const timeout = window.setTimeout(() => void window.dyworker?.saveSessions(sessions), 180);
    return () => window.clearTimeout(timeout);
  }, [ready, sessions]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight });
    setAtBottom(true);
  }, [activeId, ready]);

  useEffect(() => {
    if (shouldScrollToBottomRef.current !== activeId) return;
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" });
    shouldScrollToBottomRef.current = null;
  }, [sessions, runningSessionIds, activeId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => () => {
    recorderRef.current?.stop();
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    for (const unsubscribe of agentUnsubscribeRefs.current.values()) unsubscribe();
    agentUnsubscribeRefs.current.clear();
    for (const timeout of sessionNoticeTimersRef.current.values()) window.clearTimeout(timeout);
    sessionNoticeTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!settingsOpen || !window.dyworker) return;
    void window.dyworker.listMemories?.().then(setMemories);
    void window.dyworker.listSchedules?.().then(setSchedules);
  }, [settingsOpen, workspacePath]);

  useEffect(() => {
    if (!ready || !window.dyworker?.listSkills) return;
    void window.dyworker.listSkills(workspacePath).then((items) => {
      setSkills(items);
      setMentionSkills(items);
    });
  }, [ready, workspacePath, settingsOpen]);

  useEffect(() => {
    if ((!usageStatsOpen && !(settingsOpen && settingsTab === "usage")) || !window.dyworker) return;
    void window.dyworker.listUsageStats().then(setUsageStats);
  }, [usageStatsOpen, settingsOpen, settingsTab]);

  useEffect(() => {
    const offSchedules = window.dyworker?.onSchedulesChanged?.(() => {
      void window.dyworker?.listSchedules?.().then(setSchedules);
      void window.dyworker?.listMemories?.().then(setMemories);
    });
    const offPrepend = window.dyworker?.onSessionPrepend?.((session) => {
      setSessions((current) => [session, ...current]);
      setNotice(session.channel
        ? `收到${session.channel === "qq" ? "QQ" : "微信"}消息，渠道会话已建立`
        : "定时计划已执行，结果已保存到最近任务");
    });
    const offAppend = window.dyworker?.onSessionAppend?.((payload) => {
      setSessions((current) => {
        const existing = current.find((session) => session.id === payload.sessionId);
        if (existing) {
          return current.map((session) => session.id === payload.sessionId
            ? { ...session, messages: [...session.messages, ...payload.messages], updatedAt: new Date().toISOString() }
            : session);
        }
        const now = new Date().toISOString();
        return [{
          id: payload.sessionId,
          title: payload.channel ? `${payload.channel === "qq" ? "QQ" : "微信"}消息` : "到点自动唤醒续跑",
          workspacePath: payload.workspacePath,
          ...(payload.channel ? { channel: payload.channel } : {}),
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
    void window.dyworker?.listInbox?.().then(setInboxItems);
    return () => {
      offSchedules?.();
      offPrepend?.();
      offAppend?.();
      offInbox?.();
    };
  }, []);

  const refreshMemories = async () => {
    if (window.dyworker?.listMemories) setMemories(await window.dyworker.listMemories());
  };

  const refreshSkills = async (announce = false) => {
    if (!window.dyworker?.listSkills) return;
    const items = await window.dyworker.listSkills(workspacePath);
    setSkills(items);
    setMentionSkills(items);
    if (announce) setNotice(`已刷新技能，共发现 ${items.length} 个`);
  };

  useEffect(() => {
    if (!runningSessionIds.size) return;
    const timer = window.setInterval(() => setElapsedTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, [runningSessionIds]);

  const syncAtBottom = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setAtBottom(viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 48);
  };

  useEffect(() => {
    syncAtBottom();
  }, [sessions, runningSessionIds, activeId]);

  const activeSession = sessions.find((session) => session.id === activeId) || sessions[0];
  const activeTaskRunning = Boolean(activeSession?.id && runningSessionIds.has(activeSession.id));
  const activePendingApproval = activeSession?.id ? pendingApprovals[activeSession.id] || null : null;
  const activePendingQuestion = activeSession?.id ? pendingQuestions[activeSession.id] || null : null;
  const activeLoopState = activeSession?.id ? loopStates[activeSession.id] || null : null;
  const activeElapsedSeconds = activeSession?.id && runningStartedAt[activeSession.id]
    ? Math.floor((Date.now() - runningStartedAt[activeSession.id]) / 1000)
    : 0;
  const inboxPendingCount = inboxItems.filter((item) => item.status === "pending").length;
  const activeSessionError = activeSession?.id ? sessionErrors[activeSession.id] || "" : "";
  const activeSessionNotice = activeSession?.id ? sessionNotices[activeSession.id] || "" : "";
  const visibleSessions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const pool = sessions
      .filter((session) => showArchived || !session.archived)
      .filter((session) => !needle
        || `${session.title} ${session.messages.map((message) => message.content).join(" ")}`.toLocaleLowerCase().includes(needle));
    return [...pool].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }, [query, sessions, showArchived]);

  const updateSession = (id: string, updater: (session: SessionRecord) => SessionRecord) => {
    setSessions((current) => current.map((session) => session.id === id ? updater(session) : session));
  };

  const showSessionNotice = (sessionId: string, message: string) => {
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

  const createTask = () => {
    const session = makeSession(workspacePath);
    setSessions((current) => [session, ...current]);
    setActiveId(session.id);
    setComposer("");
    setAttachments([]);
    setNotice("");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const deleteSession = (id: string) => {
    setSessionMenuId(null);
    // 会话删除时,它登记的待唤醒一并取消,避免无主的自动续跑
    void window.dyworker?.cancelWakesForSession?.(id);
    setSessions((current) => {
      const remaining = current.filter((session) => session.id !== id);
      if (!remaining.length) {
        const fresh = makeSession(workspacePath);
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(remaining[0].id);
      return remaining;
    });
  };

  const unarchiveSession = (id: string) => {
    setSessionMenuId(null);
    updateSession(id, (session) => ({ ...session, archived: false }));
  };

  const togglePin = (id: string) => {
    setTopMenuOpen(false);
    updateSession(id, (session) => ({ ...session, pinned: !session.pinned }));
  };

  const archiveSession = (id: string) => {
    setTopMenuOpen(false);
    updateSession(id, (session) => ({ ...session, archived: true, pinned: false }));
    if (id === activeId) {
      const next = sessions.find((session) => session.id !== id && !session.archived);
      if (next) setActiveId(next.id);
      else {
        const fresh = makeSession(workspacePath);
        setSessions((current) => [fresh, ...current]);
        setActiveId(fresh.id);
      }
    }
  };

  const renameSession = (id: string, title: string) => {
    const trimmed = title.trim();
    setRenamingId(null);
    if (!trimmed) return;
    updateSession(id, (session) => ({ ...session, title: trimmed.slice(0, 40) }));
  };

  const workspaceFiles = useMemo(() => {
    const out: WorkspaceEntry[] = [];
    const walk = (entries: WorkspaceEntry[]) => {
      for (const entry of entries) {
        if (entry.kind === "file") out.push(entry);
        if (entry.children) walk(entry.children);
      }
    };
    walk(workspaceEntries);
    return out;
  }, [workspaceEntries]);

  const addWorkspaceFile = (file: WorkspaceEntry) => {
    const attachment = workspaceFileAttachment(file);
    setAttachments((current) => current.some((entry) => entry.path === attachment.path)
      ? current
      : [...current, attachment].slice(0, 12));
    setMentionMenu(null);
    setNotice(`已引用文件：${file.name}`);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleComposerDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(WORKSPACE_FILE_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setComposerDragActive(true);
  };

  const handleComposerDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setComposerDragActive(false);
  };

  const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    const filePath = event.dataTransfer.getData(WORKSPACE_FILE_DRAG_TYPE);
    if (!filePath) return;
    event.preventDefault();
    setComposerDragActive(false);
    const file = workspaceFiles.find((entry) => entry.path === filePath);
    if (file) addWorkspaceFile(file);
  };

  const mentionItems = useMemo((): { id: string; title: string; detail: string; skill?: SkillRecord; file?: WorkspaceEntry; prompt?: string }[] => {
    if (!mentionMenu) return [];
    const query = mentionMenu.query.toLowerCase();
    if (mentionMenu.kind === "slash") {
      const commands = builtinCommands
        .filter((command) => !query || command.title.toLowerCase().includes(query) || command.detail.toLowerCase().includes(query))
        .map((command) => ({ id: command.id, title: command.title, detail: command.detail, prompt: command.prompt }));
      const skills = mentionSkills
        .filter((skill) => skill.enabled !== false && (!query || skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((skill) => ({
          id: skill.id,
          title: `/${skill.name}`,
          detail: `${skill.sourceLabel || "本地模板"} · ${skill.description}`,
          skill,
        }));
      return [...commands, ...skills];
    }
    return workspaceFiles
      .filter((file) => !query || file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query))
      .slice(0, 8)
      .map((file) => ({ id: file.path, title: file.name, detail: file.path, file }));
  }, [mentionMenu, mentionSkills, workspaceFiles]);

  const updateComposer = (value: string) => {
    setComposer(value);
    const slashMatch = value.match(/^\s*\/([^\s@/]*)$/);
    const atMatch = value.match(/(?:^|\s)@([^\s@/]*)$/);
    const matched = slashMatch
      ? { kind: "slash" as const, query: slashMatch[1] }
      : atMatch
        ? { kind: "at" as const, query: atMatch[1] }
        : null;
    if (matched) {
      if (matched.kind === "slash" && mentionMenu?.kind !== "slash") {
        void window.dyworker?.listSkills?.(workspacePath).then((items) => {
          setSkills(items);
          setMentionSkills(items);
        });
      }
      setMentionMenu({ kind: matched.kind, query: matched.query, start: value.length - matched.query.length - 1 });
      setMentionIndex(0);
    } else if (mentionMenu) {
      setMentionMenu(null);
    }
  };

  const applyMention = (index: number) => {
    const item = mentionItems[index];
    if (!item || !mentionMenu) return;
    if (mentionMenu.kind === "slash" && item.prompt) {
      // 内置命令（如 /init）：把预设指令填入输入框，由用户确认后发送
      setComposer(item.prompt);
    } else {
      setComposer(composer.slice(0, mentionMenu.start));
      if (mentionMenu.kind === "slash" && item.skill) {
        const skill = item.skill;
        setActiveSkills((current) => current.some((entry) => entry.id === skill.id) ? current : [...current, skill]);
      } else if (mentionMenu.kind === "at" && item.file) {
        addWorkspaceFile(item.file);
      }
    }
    setMentionMenu(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const chooseWorkspace = async () => {
    setAddMenuOpen(false);
    setError("");
    try {
      const result = window.dyworker
        ? await window.dyworker.chooseWorkspace()
        : { canceled: false, path: "/workspace/dyworker", entries: previewWorkspace };
      if (result.canceled || !result.path) {
        setNotice("已取消选择工作文件夹");
        return;
      }
      setWorkspacePath(result.path);
      setWorkspaceEntries(result.entries || []);
      setWorkspaceOpen(true);
      setNotice(`工作文件夹已选择：${displayWorkspace(result.path)}`);
      if (activeSession) updateSession(activeSession.id, (session) => ({ ...session, workspacePath: result.path! }));
    } catch (workspaceError) {
      setError(`无法打开工作文件夹：${workspaceError instanceof Error ? workspaceError.message : String(workspaceError)}`);
    }
  };

  const chooseAttachments = async () => {
    setAddMenuOpen(false);
    setError("");
    try {
      const result = window.dyworker
        ? await window.dyworker.chooseAttachments()
        : {
            canceled: false,
            attachments: [{
              name: "界面需求说明.md",
              path: "/preview/界面需求说明.md",
              size: 1840,
              mimeType: "text/markdown",
              isImage: false,
            }],
          };
      if (result.canceled || !result.attachments.length) {
        setNotice("未添加附件");
        return;
      }
      setAttachments((current) => {
        const known = new Set(current.map((attachment) => attachment.path));
        return [...current, ...result.attachments.filter((attachment) => !known.has(attachment.path))].slice(0, 12);
      });
      setNotice(`已添加 ${result.attachments.length} 个附件`);
      textareaRef.current?.focus();
    } catch (attachmentError) {
      setError(`无法添加附件：${attachmentError instanceof Error ? attachmentError.message : String(attachmentError)}`);
    }
  };

  const finishRecording = async (recorder: MediaRecorder) => {
    const stream = microphoneStreamRef.current;
    microphoneStreamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
    recordingChunksRef.current = [];
    if (!blob.size) {
      setVoiceState("idle");
      setError("没有录到声音，请检查麦克风后重试");
      return;
    }
    setVoiceState("transcribing");
    setNotice("正在把录音转换成文字");
    try {
      if (!window.dyworker) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        setComposer((current) => `${current}${current ? "\n" : ""}请根据当前工作文件夹整理一份工作摘要。`);
      } else {
        const buffer = await blob.arrayBuffer();
        const result = await window.dyworker.transcribeAudio({
          settings,
          audio: Array.from(new Uint8Array(buffer)),
          mimeType: blob.type || "audio/webm",
        });
        setComposer((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}${result.text}`);
      }
      setNotice("语音已转换为文字");
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (voiceError) {
      setError(voiceError instanceof Error ? voiceError.message : String(voiceError));
    } finally {
      recorderRef.current = null;
      setVoiceState("idle");
    }
  };

  const toggleVoiceInput = async () => {
    setError("");
    if (voiceState === "transcribing") return;
    if (voiceState === "recording") {
      recorderRef.current?.stop();
      return;
    }
    if (!window.dyworker) {
      setVoiceState("transcribing");
      setNotice("正在把录音转换成文字");
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setComposer((current) => `${current}${current ? "\n" : ""}请根据当前工作文件夹整理一份工作摘要。`);
      setVoiceState("idle");
      setNotice("语音已转换为文字");
      return;
    }
    if (!settings.apiKey || (!settings.transcriptionEndpoint && !settings.endpoint)) {
      setError("请先在设置中配置模型密钥和语音转写服务");
      setSettingsOpen(true);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前系统没有提供可用的录音能力");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      microphoneStreamRef.current = stream;
      recorderRef.current = recorder;
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => void finishRecording(recorder);
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setVoiceState("idle");
        setError("录音中断，请检查麦克风权限后重试");
      };
      recorder.start(250);
      setVoiceState("recording");
      setNotice("正在录音，再次点击麦克风即可结束");
    } catch (voiceError) {
      setError(`无法使用麦克风：${voiceError instanceof Error ? voiceError.message : String(voiceError)}`);
    }
  };

  const refreshWorkspace = async () => {
    if (!window.dyworker || !workspacePath) return;
    setWorkspaceEntries(await window.dyworker.refreshWorkspace(workspacePath));
  };

  const sendMessage = async () => {
    let content = composer.trim();
    if ((!content && !attachments.length && !activeSkills.length) || activeTaskRunning || !activeSession) return;
    // /goal：设定会话级长期目标（跨轮驱动，借鉴 Claude Code /goal）
    const goalMatch = content.match(/^\/goal(?:\s+([\s\S]*))?$/);
    let goalDriven = false;
    if (goalMatch) {
      const argument = (goalMatch[1] || "").trim();
      if (!argument) {
        setNotice(activeSession.goal ? `当前目标：${activeSession.goal}（输入 /goal 取消 可解除）` : "用法：/goal 目标描述，例如 /goal 本周五前完成季度总结初稿");
        setComposer("");
        return;
      }
      if (["取消", "清除", "clear"].includes(argument)) {
        updateSession(activeSession.id, (session) => ({ ...session, goal: undefined }));
        setNotice("已解除长期目标");
        setComposer("");
        return;
      }
      // 设定目标并立即以目标驱动模式开始推进（强制持续执行）
      setNotice(`已设定长期目标：${argument}，将跨轮持续对照直到达成`);
      content = argument;
      goalDriven = true;
    }
    setError("");
    setComposer("");
    const selectedAttachments = attachments;
    const selectedSkills = activeSkills;
    setAttachments([]);
    setActiveSkills([]);
    setMentionMenu(null);
    const taskSessionId = activeSession.id;
    const taskRunId = crypto.randomUUID();
    runningRunIdsRef.current.set(taskSessionId, taskRunId);
    setSessionErrors((current) => {
      const next = { ...current };
      delete next[taskSessionId];
      return next;
    });
    setSessionNotices((current) => {
      const next = { ...current };
      delete next[taskSessionId];
      return next;
    });
    setRunningSessionIds((current) => {
      const next = new Set(current);
      next.add(taskSessionId);
      return next;
    });
    setRunningStartedAt((current) => ({ ...current, [taskSessionId]: Date.now() }));
    shouldScrollToBottomRef.current = taskSessionId;
    const skillsBlock = selectedSkills.length
      ? `请按照以下技能执行：\n${selectedSkills.map((skill) => {
          // 文件型技能带上目录位置:技能正文里"读取同目录的 xx.md"这类指引才能直接执行,不用再全盘搜索
          const location = skill.path ? `\n技能目录:${pathDirname(skill.path)}(入口文件:${skill.path})` : "";
          return `【${skill.name}】${skill.description}${location}\n执行要求:${skill.instructions}`;
        }).join("\n\n")}\n\n以下是我的任务:\n`
      : "";
    const message: ChatMessage = {
      role: "user",
      // content 带完整技能指令发给模型;气泡只显示用户输入与 /技能 标签(对齐 Codex/Kimi 的引用呈现)
      content: skillsBlock + (content || (selectedSkills.length ? "（按模板处理当前工作区）" : "请处理这些附件。")),
      ...(selectedSkills.length ? {
        displayContent: content || "（按模板处理当前工作区）",
        skillsUsed: selectedSkills.map((skill) => skill.name),
      } : {}),
      attachments: selectedAttachments,
      createdAt: new Date().toISOString(),
    };
    const updatedSession: SessionRecord = {
      ...activeSession,
      ...(goalDriven ? { goal: content } : {}),
      title: activeSession.messages.length === 0 ? shortTitle(content) : activeSession.title,
      workspacePath,
      updatedAt: new Date().toISOString(),
      messages: [...activeSession.messages, message],
    };
    setSessions((current) => current.map((session) => session.id === activeSession.id ? updatedSession : session));

    try {
      if (window.dyworker?.sendTask) {
        const assistantId = crypto.randomUUID();
        const taskStartedAt = Date.now();
        const patchAssistant = (updater: (current: ChatMessage) => ChatMessage) => {
          shouldScrollToBottomRef.current = taskSessionId;
          updateSession(activeSession.id, (session) => ({
            ...session,
            messages: session.messages.map((current) => current.id === assistantId ? updater(current) : current),
          }));
        };
        updateSession(activeSession.id, (session) => ({
          ...session,
          messages: [...session.messages, {
            id: assistantId,
            role: "assistant",
            content: "",
            createdAt: new Date().toISOString(),
            activities: [],
          }],
        }));
        const applyAgentResult = (result: AgentResult) => {
          patchAssistant((current) => {
            let content = result.finalText || current.content;
            if (result.status === "paused" && result.reason) {
              content = content ? `${content}\n\n**已暂停**：${result.reason}` : `**已暂停**：${result.reason}`;
            } else if (result.status === "sleeping" && result.wake) {
              const sleepNote = `**已主动挂起**：将于 ${new Date(result.wake.wakeAt).toLocaleString("zh-CN")} 自动唤醒继续（原因：${result.wake.reason}）。期间可以关闭应用，到点会照常继续。`;
              content = content ? `${content}\n\n${sleepNote}` : sleepNote;
            } else if (result.status === "cancelled") {
              content = content ? `${content}\n\n已按你的要求停止。` : "已按你的要求停止。";
            } else if (result.status === "error") {
              content = result.reason || content || "任务执行出错";
            }
            return { ...current, content, changes: result.changes?.length ? result.changes : current.changes, plan: result.plan?.length ? result.plan : current.plan, durationMs: Date.now() - taskStartedAt };
          });
          if (result.status === "done" && !result.demo) {
            showSessionNotice(taskSessionId, "任务已完成");
          } else if (result.status === "sleeping" && result.wake) {
            showSessionNotice(taskSessionId, `已挂起，将于 ${new Date(result.wake.wakeAt).toLocaleString("zh-CN")} 自动唤醒继续`);
          }
        };
        let finishedEventSeen = false;
        const unsubscribeAgent = window.dyworker.onAgentEvent((sessionAgentEvent) => {
          if (sessionAgentEvent.sessionId !== taskSessionId || sessionAgentEvent.runId !== taskRunId) return;
          const agentEvent = sessionAgentEvent.event;
          if (agentEvent.type === "activity") {
            patchAssistant((current) => ({ ...current, activities: [...(current.activities || []), agentEvent.activity] }));
          } else if (agentEvent.type === "activity-update") {
            patchAssistant((current) => ({
              ...current,
              activities: (current.activities || []).map((activity) =>
                activity.id === agentEvent.id
                  ? { ...activity, status: agentEvent.status, detail: agentEvent.detail ?? activity.detail }
                  : activity),
            }));
          } else if (agentEvent.type === "assistant-text") {
            patchAssistant((current) => ({ ...current, content: agentEvent.text }));
          } else if (agentEvent.type === "file-change") {
            patchAssistant((current) => ({ ...current, changes: agentEvent.changes }));
          } else if (agentEvent.type === "plan-update") {
            patchAssistant((current) => ({ ...current, plan: agentEvent.steps }));
          } else if (agentEvent.type === "approval-request") {
            setPendingApprovals((current) => ({ ...current, [taskSessionId]: agentEvent.action }));
          } else if (agentEvent.type === "ask-user") {
            setPendingQuestions((current) => ({ ...current, [taskSessionId]: agentEvent.request }));
          } else if (agentEvent.type === "loop-state") {
            setLoopStates((current) => {
              const next = { ...current };
              if (agentEvent.active) {
                next[taskSessionId] = { iteration: agentEvent.iteration, maximum: agentEvent.maximum, status: agentEvent.status };
              } else {
                delete next[taskSessionId];
              }
              return next;
            });
          } else if (agentEvent.type === "memory-saved") {
            void refreshMemories();
            showSessionNotice(taskSessionId, "已保存一条长期记忆");
          } else if (agentEvent.type === "skill-saved") {
            void refreshSkills();
            showSessionNotice(taskSessionId, `工作模板「${agentEvent.item.name}」已保存`);
          } else if (agentEvent.type === "skill-updated") {
            void refreshSkills();
            showSessionNotice(taskSessionId, `工作模板「${agentEvent.item.name}」已改进`);
          } else if (agentEvent.type === "debug-log") {
            setDebugLogs((logs) => [...logs.slice(-299), agentEvent.entry]);
          } else if (agentEvent.type === "context-usage") {
            const total = agentEvent.total ?? agentEvent.used + agentEvent.completion;
            updateSession(updatedSession.id, (session) => ({
              ...session,
              contextTokens: total,
              contextTokensExact: !agentEvent.estimated,
              contextModel: settings.model,
              contextEndpoint: settings.endpoint,
            }));
          } else if (agentEvent.type === "context-compacted") {
            updateSession(updatedSession.id, (session) => ({
              ...session,
              contextTokens: undefined,
              contextTokensExact: undefined,
              contextModel: undefined,
              contextEndpoint: undefined,
            }));
            showSessionNotice(taskSessionId, "上下文空间不足，已自动把早前工作压缩为摘要，任务继续");
          } else if (agentEvent.type === "agent-finished") {
            finishedEventSeen = true;
            void refreshMemories();
            applyAgentResult(agentEvent.result);
          }
        });
        agentUnsubscribeRefs.current.set(taskRunId, unsubscribeAgent);
        try {
          const response = await window.dyworker.sendTask({
            settings,
            workspacePath,
            sessionId: updatedSession.id,
            contextLimit: modelContextLimit(settings.model, settings.endpoint),
            goal: updatedSession.goal,
            messages: updatedSession.messages,
            loop: { enabled: goalDriven, maximum: goalDriven ? 10 : 1 },
            approvalMode,
            runId: taskRunId,
          });
          if (!response.ok || !response.result) throw new Error(response.error || "任务执行失败");
          if (!finishedEventSeen) applyAgentResult(response.result);
        } finally {
          // webContents.send 的尾部事件可能晚于 invoke 响应到达，延迟取消订阅避免丢事件
          const unsubscribe = agentUnsubscribeRefs.current.get(taskRunId);
          agentUnsubscribeRefs.current.delete(taskRunId);
          if (unsubscribe) window.setTimeout(unsubscribe, 1000);
          setLoopStates((current) => {
            const next = { ...current };
            delete next[taskSessionId];
            return next;
          });
        }
      } else {
        let response;
        if (window.dyworker) {
          response = await window.dyworker.completeChat({ settings, messages: updatedSession.messages });
        } else {
          await new Promise((resolve) => window.setTimeout(resolve, 650));
          response = {
            content:
              "**新任务已进入 Electron 工作区。**\n\n我会继续保持现在的阅读层级和紧凑布局。桌面版接入模型设置后，这里会直接显示真实回复。",
          };
        }
        const assistant: ChatMessage = {
          role: "assistant",
          content: response.content,
          createdAt: new Date().toISOString(),
        };
        shouldScrollToBottomRef.current = taskSessionId;
        updateSession(activeSession.id, (session) => ({
          ...session,
          updatedAt: assistant.createdAt,
          messages: [...session.messages, assistant],
        }));
      }
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : String(requestError);
      setSessionErrors((current) => ({ ...current, [taskSessionId]: detail }));
      updateSession(activeSession.id, (session) => ({
        ...session,
        messages: [...session.messages, {
          role: "assistant",
          content: `请求没有完成：${detail}`,
          createdAt: new Date().toISOString(),
        }],
      }));
    } finally {
      if (runningRunIdsRef.current.get(taskSessionId) === taskRunId) {
        runningRunIdsRef.current.delete(taskSessionId);
      }
      setRunningSessionIds((current) => {
        const next = new Set(current);
        next.delete(taskSessionId);
        return next;
      });
      setRunningStartedAt((current) => {
        const next = { ...current };
        delete next[taskSessionId];
        return next;
      });
      setPendingApprovals((current) => {
        const next = { ...current };
        delete next[taskSessionId];
        return next;
      });
      setPendingQuestions((current) => {
        const next = { ...current };
        delete next[taskSessionId];
        return next;
      });
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (mentionMenu) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((index) => mentionItems.length ? (index + 1) % mentionItems.length : 0);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((index) => mentionItems.length ? (index - 1 + mentionItems.length) % mentionItems.length : 0);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyMention(mentionIndex);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionMenu(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const saveProviderSettings = async (nextSettings: ProviderSettings, successMessage = "设置已保存") => {
    try {
      const result = await window.dyworker?.saveSettings(nextSettings);
      if (result && !result.ok) {
        setError(result.error || "模型设置保存失败");
        return false;
      }
      setSettings(nextSettings);
      setNotice(successMessage);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      return false;
    }
  };

  const activateModelProfile = async (profile: ModelProfile) => {
    const nextSettings = settingsWithProfile(settings, profile);
    setModelMenuOpen(false);
    await saveProviderSettings(nextSettings, `已切换到 ${profile.name}`);
  };

  const saveSchedule = async (draft: ScheduleDraft) => {
    const result = await window.dyworker?.saveSchedule({ ...draft, workspacePath });
    if (!result?.ok) {
      setError(result?.error || "保存计划失败");
      return false;
    }
    setNotice("定时计划已保存");
    setSchedules(await window.dyworker?.listSchedules() || []);
    return true;
  };

  const toggleSchedule = (id: string, enabled: boolean) => {
    setSchedules((current) => current.map((item) => item.id === id ? { ...item, enabled } : item));
    void window.dyworker?.setScheduleEnabled(id, enabled);
  };

  const deleteSchedule = (id: string) => {
    setSchedules((current) => current.filter((item) => item.id !== id));
    void window.dyworker?.deleteSchedule(id);
  };

  const triggerSchedule = (id: string) => {
    void window.dyworker?.triggerSchedule(id).then((result) => {
      if (!result?.ok) setError(result?.error || "无法执行");
      else setNotice("已开始执行这个计划任务");
    });
  };

  const hasModel = Boolean(settings.endpoint && settings.model && settings.apiKey);
  const activeApprovalMode = composerApprovalModes.find((option) => option.value === approvalMode) || composerApprovalModes[1];
  const ActiveApprovalIcon = activeApprovalMode.icon;
  const contextUsage = useMemo(() => {
    // 优先用服务返回的本轮完整上下文用量，并随会话、模型和服务地址保存；
    // 还没有实测数据时用与代理侧一致的轻量估算，避免把附件字节数直接当成标记数。
    if (activeSession?.contextTokens != null
      && activeSession.contextModel === settings.model
      && activeSession.contextEndpoint === settings.endpoint) {
      return {
        used: activeSession.contextTokens,
        limit: modelContextLimit(settings.model, settings.endpoint),
        exact: Boolean(activeSession.contextTokensExact),
      };
    }
    const tokens = estimateSessionTokens(activeSession?.messages || []);
    return { used: tokens, limit: modelContextLimit(settings.model, settings.endpoint), exact: false };
  }, [
    activeSession?.messages,
    activeSession?.contextTokens,
    activeSession?.contextTokensExact,
    activeSession?.contextModel,
    activeSession?.contextEndpoint,
    settings.model,
    settings.endpoint,
  ]);
  const canSend = Boolean((composer.trim() || attachments.length || activeSkills.length) && !activeTaskRunning && voiceState !== "transcribing");

  return (
    <div className={`app-shell platform-${platform || "linux"} ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <aside className="sidebar" aria-label="任务侧栏">
        <div className="native-controls-space" />
        <div className="sidebar-brand-row">
          <span className="brand-button" aria-label="DYWorker">
            <span>DYWorker</span>
          </span>
          <button className="icon-button subtle" aria-label="搜索任务" onClick={() => setQuery((value) => value ? "" : " ")}>
            <Search size={18} />
          </button>
        </div>

        <button className="new-task-button" onClick={createTask}>
          <MessageSquarePlus size={18} />
          新建任务
        </button>

        {query !== "" && (
          <div className="sidebar-search-wrap">
            <Search size={15} />
            <input autoFocus value={query.trimStart()} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" />
            <button className="bare-button" onClick={() => setQuery("")} aria-label="关闭搜索"><X size={14} /></button>
          </div>
        )}

        <div className="sidebar-scroll">
          <section className="sidebar-section recent-section">
            <span className="section-caption">最近任务</span>
            <div className="session-list">
              {visibleSessions.map((session) => (
                <div className={`session-item-wrap ${session.id === activeId ? "active" : ""} ${session.pinned ? "pinned" : ""} ${session.archived ? "archived" : ""}`} key={session.id} data-menu-root>
                  {renamingId === session.id ? (
                    <input
                      className="session-rename-input"
                      autoFocus
                      defaultValue={session.title}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") renameSession(session.id, event.currentTarget.value);
                        if (event.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={(event) => renameSession(session.id, event.target.value)}
                    />
                  ) : (
                    <button
                      className={`session-item ${session.id === activeId ? "active" : ""}`}
                      onClick={() => {
                        setSessionMenuId(null);
                        setActiveId(session.id);
                        if (session.workspacePath) setWorkspacePath(session.workspacePath);
                      }}
                      title={session.title}
                    >
                      {session.pinned && <Pin size={12} className="pin-icon" />}
                      {session.channel && (
                        <span className={`session-channel-badge ${session.channel}`}>{session.channel === "qq" ? "QQ" : "微信"}</span>
                      )}
                      <span>{session.title}</span>
                    </button>
                  )}
                  <button
                    className="icon-button subtle tiny session-menu-button"
                    aria-label="任务操作"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSessionMenuId(sessionMenuId === session.id ? null : session.id);
                    }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {sessionMenuId === session.id && (
                    <div className="session-menu" role="menu">
                      <button role="menuitem" onClick={() => { setSessionMenuId(null); setRenamingId(session.id); }}>重命名</button>
                      <button role="menuitem" onClick={() => { setSessionMenuId(null); togglePin(session.id); }}>
                        {session.pinned ? "取消置顶" : "置顶"}
                      </button>
                      {session.archived ? (
                        <button role="menuitem" onClick={() => unarchiveSession(session.id)}>取消归档</button>
                      ) : (
                        <button role="menuitem" onClick={() => { setSessionMenuId(null); archiveSession(session.id); }}>归档</button>
                      )}
                      <button role="menuitem" className="danger" onClick={() => deleteSession(session.id)}>删除</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {sessions.some((session) => session.archived) && (
              <button className="archived-toggle" onClick={() => setShowArchived((value) => !value)}>
                {showArchived ? "隐藏归档任务" : `显示归档任务（${sessions.filter((session) => session.archived).length}）`}
              </button>
            )}
          </section>

          <section className="sidebar-section workspace-section">
            <div className="section-caption-row">
              <button className="section-caption-button" onClick={() => setWorkspaceOpen((value) => !value)} aria-expanded={workspaceOpen}>
                {workspaceOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                工作区文件
              </button>
              <button className="icon-button subtle tiny" onClick={() => void refreshWorkspace()} aria-label="刷新文件列表" title="刷新文件列表">
                <RefreshCw size={13} />
              </button>
            </div>
            {workspaceOpen && (
              !workspacePath ? (
                <p className="panel-empty">选择工作文件夹后，在这里浏览文件。</p>
              ) : workspaceEntries.length ? (
                <div className="workspace-tree">
                  {workspaceEntries.map((entry) => <WorkspaceNode entry={entry} key={entry.path} />)}
                </div>
              ) : (
                <p className="panel-empty">这个文件夹是空的。</p>
              )
            )}
          </section>

        </div>

        <div className="sidebar-footer">
          <button className="profile-button">
            <span className="avatar"><UserRound size={14} /></span>
            <span>本地工作区</span>
          </button>
          <button className="icon-button subtle" onClick={() => setSettingsOpen(true)} aria-label="设置">
            <Settings size={18} />
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left no-drag">
            <Folder size={18} />
            <strong>{activeSession?.title || "新任务"}</strong>
            <button
              className="context-folder-chip"
              onClick={() => void chooseWorkspace()}
              title={workspacePath ? `上下文文件夹：${workspacePath}\n点击更换` : "为这个任务选择上下文文件夹"}
            >
              <FolderOpen size={13} />
              {displayWorkspace(workspacePath)}
            </button>
            <div className="topbar-menu-wrap" data-menu-root>
              <button
                className="icon-button subtle"
                aria-label="任务操作"
                onClick={() => setTopMenuOpen((value) => !value)}
              >
                <MoreHorizontal size={17} />
              </button>
              {topMenuOpen && activeSession && (
                <div className="session-menu topbar-menu" role="menu">
                  <button role="menuitem" onClick={() => { setTopMenuOpen(false); setRenamingId(activeSession.id); }}>重命名任务</button>
                  <button role="menuitem" onClick={() => togglePin(activeSession.id)}>
                    {activeSession.pinned ? "取消置顶" : "置顶任务"}
                  </button>
                  <button role="menuitem" onClick={() => archiveSession(activeSession.id)}>归档任务</button>
                  <button role="menuitem" onClick={() => {
                    setTopMenuOpen(false);
                    setPlanSeed({ name: activeSession.title, prompt: "" });
                    setSettingsTab("plans");
                    setSettingsOpen(true);
                  }}>添加计划任务</button>
                </div>
              )}
            </div>
          </div>
          <div className="topbar-right no-drag">
            <button
              className={`icon-button subtle inbox-button ${inboxOpen ? "active" : ""}`}
              aria-label="审批收件箱"
              title="审批收件箱：无人值守任务的审批与提问在这里处理"
              onClick={() => setInboxOpen(true)}
            >
              <Bell size={17} />
              {inboxPendingCount > 0 && <span className="inbox-badge">{inboxPendingCount > 9 ? "9+" : inboxPendingCount}</span>}
            </button>
            <button
              className={`icon-button subtle ${usageStatsOpen ? "active" : ""}`}
              aria-label="用量统计"
              title="用量统计：按模型累计 token 用量"
              onClick={() => {
                setUsageStatsOpen(true);
                if (window.dyworker) void window.dyworker.listUsageStats().then(setUsageStats);
              }}
            >
              <BarChart3 size={17} />
            </button>
            <button
              className={`icon-button subtle ${debugOpen ? "active" : ""}`}
              aria-label="控制台"
              title="控制台：查看模型请求/响应与工具调用的内部细节"
              onClick={() => setDebugOpen((value) => !value)}
            >
              <Terminal size={17} />
            </button>
            <div className="window-controls" aria-label="窗口控制">
              <button type="button" onClick={() => void window.dyworker?.minimize()} aria-label="最小化窗口" title="最小化">
                <Minus size={15} />
              </button>
              <button type="button" onClick={() => void window.dyworker?.toggleMaximize()} aria-label="最大化或还原窗口" title="最大化或还原">
                <Square size={11} />
              </button>
              <button type="button" className="window-close" onClick={() => void window.dyworker?.close()} aria-label="关闭窗口" title="关闭">
                <X size={15} />
              </button>
            </div>
          </div>
        </header>

        <div className="conversation-viewport" ref={viewportRef} onScroll={syncAtBottom}>
          <div className="conversation-column">
            {!activeSession?.messages.length ? (
              <div className="empty-conversation">
                <span className="empty-mark"><Sparkles size={25} /></span>
                <h1>从一个工作任务开始</h1>
                <p>选择工作文件夹，然后告诉 DYWorker 你希望完成什么。</p>
                <button className="button-secondary" onClick={() => void chooseWorkspace()}>
                  <FolderOpen size={16} />
                  选择工作文件夹
                </button>
              </div>
            ) : (
              activeSession.messages.map((message, index) => (
                <div className={`message-row ${message.role}`} key={`${message.createdAt}-${index}`}>
                  {message.role === "system" ? null : message.role === "user" ? (
                    <div className="user-bubble">
                      {Boolean(message.skillsUsed?.length) && (
                        <div className="message-attachments message-skills">
                          {message.skillsUsed?.map((name) => (
                            <span key={`${message.createdAt}-${name}`} className="skill-ref-chip">
                              <FileCode2 size={13} />
                              /{name}
                            </span>
                          ))}
                        </div>
                      )}
                      <span>{message.displayContent ?? message.content}</span>
                      {Boolean(message.attachments?.length) && (
                        <div className="message-attachments">
                          {message.attachments?.map((attachment) => (
                            attachment.isImage && attachment.previewUrl ? (
                              <figure className="message-attachment-image" key={`${message.createdAt}-${attachment.path}`}>
                                <img className="attachment-preview-image" src={attachment.previewUrl} alt={attachment.name} />
                                <figcaption title={attachment.path}>{attachment.name}</figcaption>
                              </figure>
                            ) : (
                              <span key={`${message.createdAt}-${attachment.path}`}>
                                {attachment.isImage ? <FileImage size={13} /> : <FileText size={13} />}
                                {attachment.name}
                              </span>
                            )
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="assistant-message">
                      {Boolean(message.plan?.length) && <PlanCard steps={message.plan!} />}
                      {(() => {
                        const visibleActivities = (message.activities || []).filter((activity) => activity.kind !== "thinking");
                        if (!visibleActivities.length) return null;
                        const messageKey = message.id || `${message.createdAt}-${index}`;
                        // 默认：执行中展开，完成后收起；用户点击后记住选择
                        // messageKey = 用户选择收起；messageKey:expanded = 用户选择展开；都没有则按默认
                        const collapsed = collapsedActivities.has(messageKey)
                          ? true
                          : collapsedActivities.has(`${messageKey}:expanded`)
                            ? false
                            : Boolean(message.durationMs);
                        const duration = formatDuration(message.durationMs);
                        return (
                          <>
                            <button
                              className="activity-divider clickable"
                              onClick={() => setCollapsedActivities((current) => {
                                const next = new Set(current);
                                if (collapsed) {
                                  next.delete(messageKey);
                                  next.add(`${messageKey}:expanded`);
                                } else {
                                  next.delete(`${messageKey}:expanded`);
                                  next.add(messageKey);
                                }
                                return next;
                              })}
                              aria-expanded={!collapsed}
                            >
                              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                              <span>
                                已处理
                                {duration ? ` · 用时 ${duration}` : ""}
                                {collapsed ? ` · ${visibleActivities.length} 步` : ""}
                              </span>
                            </button>
                            {!collapsed && <ActivityList activities={visibleActivities} />}
                          </>
                        );
                      })()}
                      {Boolean(message.changes?.length) && <ChangesSummary changes={message.changes!} workspacePath={activeSession.workspacePath || workspacePath} />}
                      {message.content && <InteractiveMessage content={message.content} />}
                    </div>
                  )}
                </div>
              ))
            )}

            {activeTaskRunning && (
              <div className="message-row assistant">
                <div className="assistant-working">
                  <LoaderCircle className="spin" size={17} />
                  <span>{activeLoopState ? `持续执行 第 ${activeLoopState.iteration}/${activeLoopState.maximum} 轮 · ${activeLoopState.status}` : `正在处理任务${activeElapsedSeconds > 1 ? ` · ${activeElapsedSeconds} 秒` : ""}`}</span>
                </div>
              </div>
            )}

            {activePendingApproval && (
              <div className="message-row assistant">
                <ApprovalCard
                  action={activePendingApproval}
                  onResolve={(approved) => {
                    if (!activeSession) return;
                    void window.dyworker?.resolveApproval(activeSession.id, activePendingApproval.id, approved);
                    setPendingApprovals((current) => {
                      const next = { ...current };
                      delete next[activeSession.id];
                      return next;
                    });
                  }}
                />
              </div>
            )}

            {activePendingQuestion && (
              <div className="message-row assistant">
                <QuestionCard
                  request={activePendingQuestion}
                  onResolve={(answer) => {
                    if (!activeSession) return;
                    void window.dyworker?.resolveQuestion(activeSession.id, activePendingQuestion.id, answer);
                    setPendingQuestions((current) => {
                      const next = { ...current };
                      delete next[activeSession.id];
                      return next;
                    });
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {debugOpen && (
          <DebugConsole logs={debugLogs} onClear={() => setDebugLogs([])} onClose={() => setDebugOpen(false)} />
        )}

        {inboxOpen && (
          <InboxDialog
            items={inboxItems}
            onClose={() => setInboxOpen(false)}
            onResolve={() => void window.dyworker?.listInbox?.().then(setInboxItems)}
            onDismiss={(id) => {
              void window.dyworker?.dismissInbox(id).then(() => window.dyworker?.listInbox().then(setInboxItems));
            }}
          />
        )}

        <div className="composer-dock">
          {(error || activeSessionError) && <div className="status-toast error" role="alert">{error || activeSessionError}</div>}
          {!error && !activeSessionError && (notice || activeSessionNotice) && (
            <div className="status-toast" role="status">{notice || activeSessionNotice}</div>
          )}
          <div
            className={`composer-card ${composerDragActive ? "drag-over" : ""}`}
            onDragOver={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
          >
            {activeSession?.goal && (
              <div className="goal-banner" title={`长期目标：${activeSession.goal}`}>
                <span className="goal-banner-icon"><Target size={13} /></span>
                <span className="goal-banner-label">长期目标</span>
                <span className="goal-banner-text">{activeSession.goal}</span>
                {activeTaskRunning && activeLoopState && (
                  <span className="goal-banner-status">
                    <LoaderCircle className="spin" size={11} />
                    推进中 {activeLoopState.iteration}/{activeLoopState.maximum} 轮
                  </span>
                )}
                <button
                  className="goal-banner-close"
                  aria-label="解除长期目标"
                  onClick={() => {
                    updateSession(activeSession.id, (session) => ({ ...session, goal: undefined }));
                    setNotice("已解除长期目标");
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {mentionMenu && (
              <div className="mention-menu" role="listbox">
                {mentionItems.length ? mentionItems.map((item, index) => (
                  <button
                    key={item.id}
                    role="option"
                    aria-selected={index === mentionIndex}
                    className={index === mentionIndex ? "active" : ""}
                    onMouseEnter={() => setMentionIndex(index)}
                    onClick={() => applyMention(index)}
                  >
                    <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                  </button>
                )) : (
                  <p className="mention-empty">{mentionMenu.kind === "slash" ? "没有匹配的技能" : "没有匹配的文件"}</p>
                )}
              </div>
            )}
            {Boolean(activeSkills.length || attachments.length) && (
              <div className="attachment-strip" aria-label={`已选择 ${activeSkills.length + attachments.length} 项`}>
                {activeSkills.map((skill) => (
                  <span className="attachment-chip skill-chip" key={skill.id}>
                    <FileCode2 size={14} />
                    <span title={skill.description}>/{skill.name}</span>
                    <button
                      type="button"
                      onClick={() => setActiveSkills((current) => current.filter((item) => item.id !== skill.id))}
                      aria-label={`移除技能 ${skill.name}`}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
                {attachments.map((attachment) => (
                  <span className={`attachment-chip${attachment.isImage && attachment.previewUrl ? " image-attachment-chip" : ""}`} key={attachment.path}>
                    {attachment.isImage && attachment.previewUrl
                      ? <img className="attachment-preview-image" src={attachment.previewUrl} alt={attachment.name} />
                      : attachment.isImage ? <FileImage size={14} /> : <FileText size={14} />}
                    <span title={attachment.path}>{attachment.name}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((current) => current.filter((item) => item.path !== attachment.path))}
                      aria-label={`移除附件 ${attachment.name}`}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={composer}
              onChange={(event) => updateComposer(event.target.value)}
              onKeyDown={onComposerKeyDown}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              placeholder="描述要完成的工作"
              lang="zh-CN"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              rows={3}
            />
            <div className="composer-toolbar">
              <div className="composer-actions">
                <div className="add-menu-wrap" data-menu-root>
                  <button
                    className={`icon-button ${addMenuOpen ? "active" : ""}`}
                    onClick={() => setAddMenuOpen((value) => !value)}
                    aria-label="添加内容"
                    aria-expanded={addMenuOpen}
                  >
                    <Plus size={19} />
                  </button>
                  {addMenuOpen && (
                    <div className="add-menu" role="menu">
                      <button role="menuitem" onClick={() => void chooseWorkspace()}>
                        <FolderOpen size={16} />
                        <span><strong>{workspacePath ? "更换工作文件夹" : "选择工作文件夹"}</strong><small>让 DYWorker 读取项目文件</small></span>
                      </button>
                      <button role="menuitem" onClick={() => void chooseAttachments()}>
                        <Paperclip size={16} />
                        <span><strong>添加附件</strong><small>支持文本、代码和图片</small></span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="model-menu-wrap" data-menu-root>
                  <button
                    className={`composer-mode ${modelMenuOpen ? "active" : ""}`}
                    onClick={() => {
                      if (settings.profiles?.length) setModelMenuOpen((value) => !value);
                      else {
                        setSettingsTab("model");
                        setSettingsOpen(true);
                      }
                    }}
                    aria-expanded={modelMenuOpen}
                  >
                    <Bot size={17} />
                    <span>{hasModel ? settings.model : "配置模型"}</span>
                    <ChevronDown size={13} />
                  </button>
                  {modelMenuOpen && (
                    <div className="model-menu" role="menu">
                      <div className="model-menu-title">选择模型</div>
                      {(settings.profiles || []).map((profile) => {
                        const active = profile.endpoint === settings.endpoint && profile.model === settings.model;
                        return (
                          <button
                            key={profile.id}
                            type="button"
                            role="menuitem"
                            className={active ? "active" : ""}
                            onClick={() => void activateModelProfile(profile)}
                          >
                            <span>
                              <strong>{profile.name}</strong>
                              <small>{profile.model}</small>
                            </span>
                            {active && <Check size={14} />}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        role="menuitem"
                        className="manage-models"
                        onClick={() => {
                          setModelMenuOpen(false);
                          setSettingsTab("model");
                          setSettingsOpen(true);
                        }}
                      >
                        <Settings size={14} />
                        管理模型配置
                      </button>
                    </div>
                  )}
                </div>
                <div className="approval-mode-wrap" data-menu-root>
                  <button
                    type="button"
                    className={`approval-mode-button ${approvalMenuOpen ? "active" : ""} ${approvalMode === "full-access" ? "warning" : ""}`}
                    onClick={() => setApprovalMenuOpen((value) => !value)}
                    aria-haspopup="menu"
                    aria-expanded={approvalMenuOpen}
                    title={activeApprovalMode.description}
                  >
                    <ActiveApprovalIcon size={15} />
                    <span>{activeApprovalMode.label}</span>
                    <ChevronDown size={13} />
                  </button>
                  {approvalMenuOpen && (
                    <div className="approval-mode-menu" role="menu">
                      <div className="approval-mode-menu-title">应如何批准 DYWorker 操作？</div>
                      {composerApprovalModes.map((option) => {
                        const OptionIcon = option.icon;
                        const selected = option.value === approvalMode;
                        return (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={`${selected ? "selected" : ""} ${option.warning ? "warning" : ""}`}
                            key={option.value}
                            onClick={() => {
                              setApprovalMode(option.value);
                              setApprovalMenuOpen(false);
                            }}
                          >
                            <OptionIcon size={19} />
                            <span>
                              <strong>{option.label}</strong>
                              <small>{option.description}</small>
                            </span>
                            {selected && <Check size={16} className="approval-mode-check" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="composer-actions">
                <ContextRing used={contextUsage.used} limit={contextUsage.limit} exact={contextUsage.exact} />
                <button className="icon-button" onClick={() => void chooseAttachments()} aria-label="添加附件" title="添加附件">
                  <Paperclip size={18} />
                </button>
                {activeTaskRunning ? (
                  <button
                    className="send-button stop"
                    onClick={() => {
                      if (!activeSession) return;
                      const runId = runningRunIdsRef.current.get(activeSession.id);
                      if (runId) void window.dyworker?.cancelTask(activeSession.id, runId);
                    }}
                    aria-label="停止任务"
                    title="停止任务"
                  >
                    <Square size={14} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    onClick={() => void sendMessage()}
                    disabled={!canSend}
                    aria-label="发送"
                    title="Enter 发送"
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
            </div>
          </div>
          {!atBottom && (
            <button className="jump-bottom" onClick={() => viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" })} aria-label="滚动到底部">
              <ArrowDown size={18} />
            </button>
          )}
        </div>
      </main>

      {settingsOpen && (
        <SettingsDialog
          value={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={saveProviderSettings}
          memories={memories}
          onDeleteMemory={(id) => {
            setMemories((current) => current.filter((item) => item.id !== id));
            void window.dyworker?.deleteMemory(id);
          }}
          skills={skills}
          onToggleSkill={(id, enabled) => {
            setSkills((current) => current.map((item) => item.id === id ? { ...item, enabled } : item));
            setMentionSkills((current) => current.map((item) => item.id === id ? { ...item, enabled } : item));
            void window.dyworker?.setSkillEnabled(id, enabled, workspacePath);
          }}
          onDeleteSkill={(id) => {
            setSkills((current) => current.filter((item) => item.id !== id));
            setMentionSkills((current) => current.filter((item) => item.id !== id));
            void window.dyworker?.deleteSkill(id);
          }}
          onRefreshSkills={() => void refreshSkills(true)}
          onOpenSkill={(skill) => {
            if (skill.path) void window.dyworker?.openPath(skill.path);
          }}
          schedules={schedules}
          workspaceReady={Boolean(workspacePath)}
          onSaveSchedule={saveSchedule}
          onToggleSchedule={toggleSchedule}
          onDeleteSchedule={deleteSchedule}
          onTriggerSchedule={triggerSchedule}
          usageRecords={usageStats}
          onClearUsage={() => {
            setUsageStats([]);
            void window.dyworker?.clearUsageStats();
          }}
          tab={settingsTab}
          onTabChange={setSettingsTab}
          planSeed={planSeed}
        />
      )}
      {usageStatsOpen && (
        <UsageStatsDialog
          records={usageStats}
          onClose={() => setUsageStatsOpen(false)}
          onClear={() => {
            setUsageStats([]);
            void window.dyworker?.clearUsageStats();
          }}
        />
      )}
    </div>
  );
}
