import {
  AlarmClock,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  AtSign,
  BarChart3,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  Circle,
  ClipboardPaste,
  Cookie,
  Database,
  Copy,
  CornerUpLeft,
  FileCode2,
  FileDiff,
  File,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  ListTree,
  Hand,
  History,
  KeyRound,
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
  MoreVertical,
  Package,
  Paperclip,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Scissors,
  ShieldAlert,
  SquarePlus,
  SquarePen,
  SquareTerminal,
  Sparkles,
  Square,
  Target,
  Terminal,
  Trash2,
  GitCommitHorizontal,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import hljs from "highlight.js/lib/common";
import { CSSProperties, ClipboardEvent, createElement, DragEvent, FormEvent, KeyboardEvent, MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { contextUsageSummary, estimateSessionTokens, formatTokenCount } from "./contextUsage";
import { InteractiveMessage } from "./InteractiveMessage";
import { ProcessTimeline } from "./ProcessTimeline";
import { TraceConsole } from "./TraceConsole";
import { BackgroundTasksPanel } from "./BackgroundTasksPanel";
import { buildTaskTrace, traceEventsToAgentEvents } from "./taskTrace";
import type { ActivityRecord, AgentResult, AppUpdateStatus, ApprovalAction, ApprovalMode, Attachment, BrowserImportKinds, BrowserImportSource, ChannelConnectionStatus, ChannelsConfig, ChannelsStatusMap, ChatMessage, DebugLogEntry, FileChange, GitBranchesInfo, GitDiffStats, GitReviewFile, GitReviewOverview, HookRule, ImportedHistoryEntry, InboxItem, MemoryItem, ModelProfile, PlanStep, ProviderSettings, QuestionRequest, ScheduleRecord, SessionRecord, SkillLibraryConfig, SkillLibrarySearchResult, SkillRecord, StandingRule, TraceEvent, UsageRecord, UserIdentity, WorkspaceContext, WorkspaceEntry } from "./types";
import { matchProvider, modelContextLimit, providerPresets, usesResponsesApi } from "./providers";

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
  identity: null,
  endpoint: "",
  model: "",
  apiKey: "",
  visionEndpoint: "",
  visionModel: "",
  visionApiKey: "",
  transcriptionEndpoint: "",
  transcriptionModel: "whisper-1",
  ttsEndpoint: "",
  ttsModel: "",
  ttsApiKey: "",
  searxngEndpoint: "",
  bochaApiKey: "",
  deepseekSearchApiKey: "",
  domesticSearchOnly: false,
  enableNativeTools: true,
  nativeToolsDisabled: ["memory", "excel"],
  enableWebSearchBuiltin: false,
  approvalMode: "reviewer",
  preventSleep: "tasks",
  updateUrl: "https://github.com/richardguancn/dyworker",
  mcpServers: [],
  channels: { qq: { enabled: false, appId: "", appSecret: "" }, wechat: { enabled: false }, modelProfileId: "", approvalMode: "auto" },
  skillLibraries: [{
    id: "skillhub",
    name: "SkillHub",
    description: "面向中国用户的技能搜索与安装服务",
    websiteUrl: "https://skillhub.cn/",
    searchUrl: "https://api.skillhub.cn/api/v1/search",
    enabled: true,
  }],
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
    label: "请示批准",
    description: "遇到需要授权的操作时先征求你的同意",
    icon: Hand,
  },
  {
    value: "reviewer" as ApprovalMode,
    label: "替我审批",
    description: "低风险操作自动继续，只在越界、外发、破坏性或不明确时请示",
    icon: Bot,
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

function keepSingleUnstartedSession(items: SessionRecord[]) {
  let kept = false;
  return items.filter((session) => {
    if (session.archived || session.messages.length > 0) return true;
    if (kept) return false;
    kept = true;
    return true;
  });
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

// 任务完成提示音：两声短促的上行音（E5 → B5），用 WebAudio 合成，不依赖音频资源文件。
// 浏览器要求用户交互后才能出声，首次交互前的 AudioContext 处于 suspended，这里尝试 resume。
let completionAudioContext: AudioContext | null = null;
function playCompletionSound() {
  try {
    const AudioCtor = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    completionAudioContext = completionAudioContext || new AudioCtor();
    const ctx = completionAudioContext;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    [659.25, 987.77].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const start = now + index * 0.13;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.45);
    });
  } catch {
    // 音频不可用时静默跳过，不影响任务结果
  }
}

function plainConversationText(content: string) {
  return content
    .replace(CONTROL_MARKER_PATTERN, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMessageTime(createdAt: string) {
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

// 模型偶尔会把其他 agent 框架的控制标记（如 ::git-stage{cwd="..."}）原样输出到回复里，
// 展示、复制、生成标题时都应当过滤掉，避免用户看到原始指令文本。
const CONTROL_MARKER_PATTERN = /::[a-zA-Z][\w‐‑‒–—-]*(?:\{[^{}]*\})?/g;

function stripControlMarkers(text: string) {
  const stripped = String(text || "")
    .replace(CONTROL_MARKER_PATTERN, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped || String(text || "").trim();
}

function messageVisibleText(message: ChatMessage) {
  return stripControlMarkers(message.displayContent ?? message.content);
}

// 长消息折叠（Codex 风格“显示更多/收起”）：内容过长时默认收起，
// 折叠状态下测量是否真的超出，避免短消息出现多余按钮。
const LONG_TEXT_GATE = 300;

function useClampToggle<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!active || expanded) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(check);
    };
    schedule();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(el);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [active, expanded]);

  // 内容变短后复位展开状态，避免残留“收起”按钮
  useEffect(() => {
    if (!active) {
      setExpanded(false);
      setOverflowing(false);
    }
  }, [active]);

  return { ref, overflowing, expanded, setExpanded };
}

function ShowMoreToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="show-more-toggle"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      {expanded ? (
        <>收起<ChevronUp size={13} /></>
      ) : (
        <>显示更多<ChevronDown size={13} /></>
      )}
    </button>
  );
}

function ClampedUserText({ text }: { text: string }) {
  const active = text.length > LONG_TEXT_GATE;
  const { ref, overflowing, expanded, setExpanded } = useClampToggle<HTMLSpanElement>(active);
  return (
    <>
      <span
        ref={ref}
        className={`user-message-text${active && !expanded ? " clamped" : ""}${expanded ? " expanded" : ""}`}
      >
        {text}
      </span>
      {overflowing && (
        <ShowMoreToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
      )}
    </>
  );
}

function isMarkdownFile(filePath: string) {
  return /\.(?:md|markdown)$/i.test(filePath);
}

async function copyTextToClipboard(content: string) {
  if (!content) return false;
  try {
    if (window.dyworker?.writeClipboardText) {
      const result = await window.dyworker.writeClipboardText(content);
      if (result.ok) return true;
    }
  } catch {
    // 主进程剪贴板不可用时继续尝试渲染端方案。
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content);
      return true;
    }
  } catch {
    // Electron 的剪贴板权限被系统拦截时，继续尝试兼容方案。
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

function conversationTurnPreview(messages: ChatMessage[], messageIndex: number) {
  const userMessage = messages[messageIndex];
  const userText = plainConversationText(userMessage.displayContent ?? userMessage.content);
  const nextUserIndex = messages.findIndex((message, index) => index > messageIndex && message.role === "user");
  const assistantText = plainConversationText(
    messages
      .slice(messageIndex + 1, nextUserIndex === -1 ? undefined : nextUserIndex)
      .find((message) => message.role === "assistant")?.content || "",
  );
  const title = shortTitle(userText);
  const detail = userText.length > title.length
    ? userText.slice(title.length).trim()
    : assistantText || (userMessage.attachments?.length ? `包含 ${userMessage.attachments.length} 个附件` : "本轮对话");
  return {
    title,
    detail: detail.length > 140 ? `${detail.slice(0, 140)}…` : detail,
  };
}

function latestWorkingContext(messages: ChatMessage[]): string | undefined {
  const message = [...messages].reverse().find((item) => Object.prototype.hasOwnProperty.call(item, "workingContext"));
  return message ? message.workingContext : undefined;
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

type ToolPanelTab = {
  id: string;
  kind: "browser" | "files" | "review" | "chat" | "tasks";
  title: string;
  url?: string;
  loadedUrl?: string;
};

type BrowserWebviewElement = HTMLElement & {
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
  getURL?: () => string;
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
};

function WorkspaceNode({ entry, depth = 0, onOpenFile, onInsertFile, forceExpand = false }: {
  entry: WorkspaceEntry;
  depth?: number;
  onOpenFile: (entry: WorkspaceEntry) => void;
  /** 工作台：文件行尾「@引用」按钮，把文件引用到输入框（补齐拖拽之外的显式入口） */
  onInsertFile?: (entry: WorkspaceEntry) => void;
  forceExpand?: boolean;
}) {
  const [expandedState, setExpanded] = useState(depth === 0);
  const expanded = forceExpand || expandedState;
  const isDirectory = entry.kind === "directory";
  const hasChildren = Boolean(entry.children?.length);

  const activate = () => {
    if (isDirectory) setExpanded((value) => !value);
    else onOpenFile(entry);
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
      {!isDirectory && onInsertFile && (
        <button
          type="button"
          className="tree-ref-button"
          title="引用到输入框"
          aria-label={`引用 ${entry.name} 到输入框`}
          onClick={(event) => {
            event.stopPropagation();
            onInsertFile(entry);
          }}
        >
          <AtSign size={12} />
        </button>
      )}
      {expanded && entry.children?.map((child) => (
        <WorkspaceNode entry={child} depth={depth + 1} key={child.path} onOpenFile={onOpenFile} onInsertFile={onInsertFile} forceExpand={forceExpand} />
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

// process-chain：助手消息上的「查看过程链路」开关（默认折叠）。
// 有 trace 事件流数据（hasTrace）才渲染；老会话直接不出现，回退现有计划/活动卡片。
function MessageProcessTrace({
  events,
  request,
  durationMs,
  onLocateMessage,
  onOpenReview,
  onLocateLog,
}: {
  events: TraceEvent[];
  request: string;
  durationMs?: number;
  onLocateMessage: () => void;
  onOpenReview: (changes: FileChange[]) => void;
  onLocateLog: () => void;
}) {
  const trace = useMemo(() => {
    const built = buildTaskTrace(traceEventsToAgentEvents(events), request);
    if (built.deliver && typeof durationMs === "number" && durationMs > 0) {
      built.deliver = { ...built.deliver, durationMs };
    }
    return built;
  }, [events, request, durationMs]);
  const [open, setOpen] = useState(false);
  if (!trace.hasTrace) return null;
  const doneSteps = trace.steps.filter((step) => step.status === "completed").length;
  return (
    <div className="process-trace-wrap">
      <button
        type="button"
        className={`process-trace-toggle clickable ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="查看过程链路"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>查看过程链路</span>
        <span className="process-trace-meta">
          {trace.steps.length > 0 && `${doneSteps}/${trace.steps.length} 步`}
          {trace.branches.length > 0 && ` · ${trace.branches.length} 条子代理`}
          {trace.changes.length > 0 && ` · ${trace.changes.length} 个文件`}
          {trace.deliver ? " · 已交付" : " · 执行中"}
        </span>
      </button>
      {open && (
        <ProcessTimeline
          trace={trace}
          onLocateMessage={onLocateMessage}
          onOpenReview={onOpenReview}
          onLocateLog={onLocateLog}
        />
      )}
    </div>
  );
}

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

// ===== Codex 风格右侧面板:文本文件判断 / 代码查看 / 审阅 diff =====

// 可在代码标签页预览的文本文件类型(其余交给系统默认应用)
const TEXT_PREVIEW_EXTENSIONS = new Set([
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "json", "jsonc",
  "css", "scss", "less", "html", "htm", "svg", "xml",
  "py", "sh", "bash", "zsh", "md", "markdown", "txt", "log",
  "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "properties",
  "java", "c", "h", "cpp", "cc", "cxx", "hpp", "go", "rs", "rb", "php", "sql", "vue",
  "gitignore", "gitattributes", "editorconfig", "dockerignore", "npmignore",
]);

function fileExtension(filePath: string) {
  const name = filePath.split(/[\\/]/).pop() || "";
  if (name.startsWith(".") && !name.includes(".", 1)) return name.slice(1).toLowerCase(); // .gitignore 等点文件
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isTextPreviewFile(filePath: string) {
  return TEXT_PREVIEW_EXTENSIONS.has(fileExtension(filePath));
}

// 扩展名 → highlight.js 语言名(getLanguage 兜底校验)
const highlightLanguageMap: Record<string, string> = {
  mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  htm: "xml", svg: "xml", vue: "xml",
  sh: "bash", zsh: "bash",
  yml: "yaml", md: "markdown",
  h: "c", hpp: "cpp", cc: "cpp", cxx: "cpp",
  toml: "ini", cfg: "ini", conf: "ini", env: "ini", properties: "ini",
  gitignore: "plaintext", gitattributes: "plaintext", editorconfig: "ini", dockerignore: "plaintext", npmignore: "plaintext",
  txt: "plaintext", log: "plaintext",
};

function highlightLanguageFor(filePath: string) {
  const extension = fileExtension(filePath);
  const candidate = highlightLanguageMap[extension] || extension;
  return hljs.getLanguage(candidate) ? candidate : undefined;
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CODE_VIEW_MAX_CHARS = 400 * 1024;

// Codex 风格的代码查看:行号栏 + 整文件语法高亮
function CodeView({ content, filePath }: { content: string; filePath: string }) {
  const truncated = content.length > CODE_VIEW_MAX_CHARS;
  const shown = truncated ? content.slice(0, CODE_VIEW_MAX_CHARS) : content;
  const html = useMemo(() => {
    const language = highlightLanguageFor(filePath);
    try {
      return language ? hljs.highlight(shown, { language, ignoreIllegals: true }).value : escapeHtml(shown);
    } catch {
      return escapeHtml(shown);
    }
  }, [shown, filePath]);
  const lineNumbers = useMemo(() => {
    const count = shown.split("\n").length;
    return Array.from({ length: count }, (_value, index) => index + 1).join("\n");
  }, [shown]);
  return (
    <div className="code-view">
      <pre className="code-view-gutter" aria-hidden="true">{lineNumbers}</pre>
      <pre className="code-view-body"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
      {truncated && <div className="code-view-truncated">文件过大,仅显示前 400 KB</div>}
    </div>
  );
}

// 面包屑:工作区名 › 目录 › 文件
function codeBreadcrumbSegments(filePath: string, workspacePath: string) {
  const root = workspacePath.replace(/[\\/]+$/, "");
  let relative = filePath;
  if (root && (filePath.startsWith(`${root}/`) || filePath.startsWith(`${root}\\`))) {
    relative = filePath.slice(root.length + 1);
  }
  const workspaceName = root.split(/[\\/]/).pop() || root;
  return [workspaceName, ...relative.split(/[\\/]/).filter(Boolean)];
}

type ReviewDiffRow =
  | { type: "add" | "del" | "ctx"; oldNo?: number; newNo?: number; text: string }
  | { type: "gap"; count: number };

// 解析 unified diff:带行号输出,hunk 之间插入"N unmodified lines"折叠条(对照 Codex 审阅视图)
function parseReviewDiff(diff: string): ReviewDiffRow[] {
  const rows: ReviewDiffRow[] = [];
  const hunkPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const hunk = hunkPattern.exec(line);
    if (hunk) {
      const nextOld = Number(hunk[1]);
      if (inHunk) {
        const gap = nextOld - oldNo;
        if (gap > 0) rows.push({ type: "gap", count: gap });
      } else if (nextOld > 1) {
        rows.push({ type: "gap", count: nextOld - 1 });
      }
      oldNo = nextOld;
      newNo = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") rows.push({ type: "add", newNo: newNo++, text });
    else if (marker === "-") rows.push({ type: "del", oldNo: oldNo++, text });
    else if (marker === " ") rows.push({ type: "ctx", oldNo: oldNo++, newNo: newNo++, text });
  }
  return rows;
}

function ReviewDiffView({ diff }: { diff: string }) {
  const rows = useMemo(() => parseReviewDiff(diff), [diff]);
  if (!rows.length) return <p className="panel-empty">暂无可展示的修改内容。</p>;
  return (
    <div className="review-diff">
      {rows.map((row, index) => row.type === "gap" ? (
        <div className="review-diff-gap" key={index}>{row.count} unmodified lines</div>
      ) : (
        <div className={`review-diff-row ${row.type}`} key={index}>
          <span className="review-diff-no">{row.type !== "add" ? row.oldNo : ""}</span>
          <span className="review-diff-no">{row.type !== "del" ? row.newNo : ""}</span>
          <code className="review-diff-text">{row.text}</code>
        </div>
      ))}
    </div>
  );
}

// Codex 风格的审阅面板:上一轮改动汇总 + 文件列表 + 选中文件的内联 diff
function ReviewPanel({ changes, workspacePath }: { changes: FileChange[]; workspacePath: string }) {
  const [selectedPath, setSelectedPath] = useState(changes[0]?.path || "");
  const totals = changes.reduce(
    (accumulator, change) => ({ added: accumulator.added + change.added, removed: accumulator.removed + change.removed }),
    { added: 0, removed: 0 },
  );
  const selected = changes.find((change) => change.path === selectedPath) || changes[0];
  const openExternal = (change: FileChange) => {
    if (!workspacePath) return;
    void window.dyworker?.openPath(`${workspacePath.replace(/[\\/]+$/, "")}/${change.path}`);
  };
  return (
    <div className="review-panel-body">
      <div className="review-header">
        <span className="review-round">上一轮</span>
        <span className="review-totals"><b>+{totals.added}</b> <em>-{totals.removed}</em></span>
      </div>
      <div className="review-file-list">
        {changes.map((change) => (
          <div className={`review-file-row ${selected && change.path === selected.path ? "active" : ""}`} key={change.path}>
            <button className="review-file-main" onClick={() => setSelectedPath(change.path)} title={change.path}>
              <FileCode2 size={15} />
              <span className="review-file-path">{change.path}</span>
              <span className="tool-summary-side"><b>+{change.added}</b> <em>-{change.removed}</em></span>
            </button>
            <button
              className="icon-button subtle tiny"
              onClick={() => openExternal(change)}
              disabled={!workspacePath}
              aria-label={`打开 ${change.path}`}
              title="打开文件"
            >
              <FolderOpen size={13} />
            </button>
          </div>
        ))}
      </div>
      {selected && (selected.diff
        ? <ReviewDiffView diff={selected.diff} />
        : <p className="panel-empty">文件较大,仅显示变更统计。</p>)}
    </div>
  );
}

// ===== Codex 风格审阅视图:Git 工作区改动 vs 基线,左 diff 右文件树 =====

type ReviewTreeDir = { name: string; path: string; dirs: ReviewTreeDir[]; files: GitReviewFile[] };

// 把扁平的文件路径列表组装成目录树（对照 Codex 审阅页右侧的分组文件列表）
function buildReviewTree(files: GitReviewFile[]): ReviewTreeDir {
  const root: ReviewTreeDir = { name: "", path: "", dirs: [], files: [] };
  for (const file of files) {
    const segments = file.path.split("/");
    let node = root;
    for (let index = 0; index < segments.length - 1; index++) {
      const dirPath = segments.slice(0, index + 1).join("/");
      let next = node.dirs.find((dir) => dir.path === dirPath);
      if (!next) {
        next = { name: segments[index], path: dirPath, dirs: [], files: [] };
        node.dirs.push(next);
      }
      node = next;
    }
    node.files.push(file);
  }
  return root;
}

const reviewStatusLabels: Record<GitReviewFile["status"], string> = { M: "已修改", A: "新增", D: "已删除", U: "未跟踪" };

// 文件类型图标：按扩展名给彩色小方块（对照 Codex 审阅页的 JS/TS/{ } 图标）
const FILE_TYPE_STYLES: [RegExp, string, string][] = [
  [/\.tsx?$/i, "TS", "#3178c6"],
  [/\.jsx?$/i, "JS", "#c9a227"],
  [/\.mjs$/i, "JS", "#c9a227"],
  [/\.cjs$/i, "JS", "#c9a227"],
  [/\.jsonc?$/i, "{}", "#c9842d"],
  [/\.s?css$/i, "CSS", "#7c5cd6"],
  [/\.less$/i, "CSS", "#7c5cd6"],
  [/\.html?$/i, "<>", "#d1543a"],
  [/\.mdx?$/i, "MD", "#5f8a4b"],
  [/\.py$/i, "PY", "#3572a5"],
  [/\.go$/i, "GO", "#00add8"],
  [/\.rs$/i, "RS", "#b7410e"],
  [/\.java$/i, "JV", "#b07219"],
  [/\.ya?ml$/i, "YML", "#6d8086"],
  [/\.toml$/i, "TOML", "#6d8086"],
  [/\.sh$/i, "SH", "#4eaa25"],
  [/\.svg$/i, "SVG", "#d0881c"],
  [/\.png$/i, "IMG", "#8a6d3b"],
  [/\.jpe?g$/i, "IMG", "#8a6d3b"],
  [/\.gif$/i, "IMG", "#8a6d3b"],
];

function FileTypeIcon({ path, size = 15 }: { path: string; size?: number }) {
  const match = FILE_TYPE_STYLES.find(([pattern]) => pattern.test(path));
  if (!match) return <File size={size} className="file-type-icon-fallback" />;
  const [, label, color] = match;
  return (
    <span className="file-type-icon" style={{ color, width: size + 3, height: size + 1, fontSize: Math.max(7, size - 7) }} aria-hidden="true">
      {label}
    </span>
  );
}

// 状态徽标（对照 Codex：新增绿色 ⊕、修改橙点、删除红色 −）
function ReviewStatusIcon({ status }: { status: GitReviewFile["status"] }) {
  const className = `review-status-icon status-${status.toLowerCase()}`;
  if (status === "A" || status === "U") return <SquarePlus size={15} className={className} />;
  if (status === "D") return <Square size={15} className={className} />;
  return <SquarePen size={15} className={className} />;
}

function ReviewFileRow({ file, depth, selected, onSelect }: { file: GitReviewFile; depth: number; selected: boolean; onSelect: (path: string) => void }) {
  const name = file.path.split("/").pop() || file.path;
  return (
    <button
      className={`review-tree-row file ${selected ? "active" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onSelect(file.path)}
      title={`${file.path}（${reviewStatusLabels[file.status]}）`}
    >
      <FileTypeIcon path={file.path} size={14} />
      <span className="review-tree-name">{name}</span>
      <ReviewStatusIcon status={file.status} />
    </button>
  );
}

function ReviewDirNode({ dir, depth, selectedPath, onSelect }: { dir: ReviewTreeDir; depth: number; selectedPath: string; onSelect: (path: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="review-tree-dir">
      <button className="review-tree-row dir" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="review-tree-name">{dir.name}</span>
      </button>
      {expanded && (
        <>
          {dir.dirs.map((child) => <ReviewDirNode dir={child} depth={depth + 1} key={child.path} selectedPath={selectedPath} onSelect={onSelect} />)}
          {dir.files.map((file) => <ReviewFileRow file={file} depth={depth + 1} key={file.path} selected={file.path === selectedPath} onSelect={onSelect} />)}
        </>
      )}
    </div>
  );
}

// 单个文件的 diff 区块（堆叠在左栏；对照 Codex：所有文件的 diff 上下排列滚动浏览，可单独折叠）
function ReviewFileDiffSection({ workspacePath, base, file, active, collapsed, onToggleCollapse, onStage, onDiscard, busy }: {
  workspacePath: string;
  base: string;
  file: GitReviewFile;
  active: boolean;
  collapsed: boolean;
  onToggleCollapse: (path: string) => void;
  onStage?: (path: string) => void;
  onDiscard?: (path: string) => void;
  busy?: boolean;
}) {
  const [diff, setDiff] = useState<{ text: string; binary?: boolean; truncated?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (collapsed) return; // 折叠时不加载，展开后再拉取
    if (!window.dyworker?.gitFileDiff) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void window.dyworker.gitFileDiff({ workspacePath, base, path: file.path, untracked: file.status === "U" })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setDiff({ text: result.diff || "", binary: result.binary, truncated: result.truncated });
        else setDiff(null);
      })
      .catch(() => { if (!cancelled) setDiff(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspacePath, base, file.path, file.status, collapsed]);

  return (
    <section className={`review-file-section ${active ? "active" : ""} ${collapsed ? "collapsed" : ""}`} data-review-path={file.path}>
      <div className="review-diff-filebar-wrap">
        <button
          className="review-diff-filebar"
          title={`${file.path}（${collapsed ? "展开差异" : "折叠差异"}）`}
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapse(file.path)}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <FileTypeIcon path={file.path} />
          <span className="review-diff-filepath">{file.path}</span>
          <span className="tool-summary-side"><b>+{file.added}</b> <em>-{file.removed}</em></span>
        </button>
        {(onStage || onDiscard) && (
          <div className="review-file-actions">
            {onStage && (
              <button
                type="button"
                className="icon-button subtle tiny"
                title={`暂存 ${file.path}`}
                aria-label={`暂存 ${file.path}`}
                disabled={busy}
                onClick={() => onStage(file.path)}
              >
                <SquarePlus size={13} />
              </button>
            )}
            {onDiscard && (
              <button
                type="button"
                className="icon-button subtle tiny"
                title={`放弃 ${file.path} 的全部改动`}
                aria-label={`放弃 ${file.path} 的改动`}
                disabled={busy}
                onClick={() => onDiscard(file.path)}
              >
                <RotateCcw size={13} />
              </button>
            )}
          </div>
        )}
      </div>
      {!collapsed && (loading ? (
        <p className="panel-empty">正在生成对比…</p>
      ) : diff?.binary ? (
        <p className="panel-empty">二进制文件无法展示对比。</p>
      ) : diff && diff.text ? (
        <>
          <ReviewDiffView diff={diff.text} />
          {diff.truncated && <p className="panel-empty">对比内容过大，仅显示前 400 KB。</p>}
        </>
      ) : (
        <p className="panel-empty">暂无可展示的修改内容。</p>
      ))}
    </section>
  );
}

// Git 仓库走基线对比视图；非 Git 仓库回退到“上一轮改动”审阅
function GitReviewPanel({ workspacePath, fallbackChanges }: { workspacePath: string; fallbackChanges: FileChange[] }) {
  const [overview, setOverview] = useState<GitReviewOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [base, setBase] = useState("HEAD");
  const [baseMenuOpen, setBaseMenuOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [filter, setFilter] = useState("");
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const diffPaneRef = useRef<HTMLDivElement | null>(null);

  const load = async (targetBase: string) => {
    if (!window.dyworker?.gitReviewOverview) {
      // 预览环境没有桌面桥接：按非 Git 仓库处理，回退到上一轮改动审阅
      setOverview({ isRepo: false, current: "", upstream: "", base: "", files: [], totals: { added: 0, removed: 0 } });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await window.dyworker.gitReviewOverview({ workspacePath, base: targetBase });
      setOverview(result);
      setErrorText("");
    } catch {
      // 不把底层 IPC 错误原文抛给用户，友好提示并可重试
      setErrorText("读取 Git 状态失败，请点击右上角刷新重试");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setOverview(null);
    setBase("HEAD");
    setFilter("");
    setSelectedPath("");
    setCollapsedPaths(new Set());
    setActionError("");
    setCommitOpen(false);
    setCommitMessage("");
    void load("HEAD");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  // 工作台 Git 写操作：暂存 / 放弃（破坏性，先人工确认）/ 提交 / 推送（破坏性，先人工确认）
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [gitBusy, setGitBusy] = useState("");
  const [actionError, setActionError] = useState("");

  const runGitAction = async (kind: "stage" | "discard", path: string) => {
    if (gitBusy) return;
    if (kind === "discard" && !window.confirm(`放弃「${path}」的全部改动？已跟踪文件将恢复到最近提交，未跟踪文件将被删除。此操作不可恢复。`)) return;
    setGitBusy(`${kind}:${path}`);
    setActionError("");
    try {
      if (!window.dyworker?.gitStage || !window.dyworker?.gitDiscard) {
        setActionError("当前环境没有连接 Git 通道");
        return;
      }
      const result = kind === "stage"
        ? await window.dyworker.gitStage(workspacePath, [path])
        : await window.dyworker.gitDiscard(workspacePath, [path]);
      if (!result.ok) setActionError(result.error || (kind === "stage" ? "暂存失败" : "放弃失败"));
      else void load(base);
    } catch {
      setActionError(kind === "stage" ? "暂存失败" : "放弃失败");
    } finally {
      setGitBusy("");
    }
  };

  const commitAll = async () => {
    if (gitBusy) return;
    setGitBusy("commit");
    setActionError("");
    try {
      if (!window.dyworker?.gitCommit) {
        setActionError("当前环境没有连接 Git 通道");
        return;
      }
      const result = await window.dyworker.gitCommit({ workspacePath, message: commitMessage.trim(), includeUnstaged: true });
      if (!result.ok) setActionError(result.error || "提交失败");
      else {
        setCommitMessage("");
        setCommitOpen(false);
        void load(base);
      }
    } catch {
      setActionError("提交失败");
    } finally {
      setGitBusy("");
    }
  };

  const pushAll = async () => {
    if (gitBusy) return;
    if (!window.confirm("推送到远程仓库？所有未推送的提交将上传到远端，请确认内容无误。")) return;
    setGitBusy("push");
    setActionError("");
    try {
      if (!window.dyworker?.gitPush) {
        setActionError("当前环境没有连接 Git 通道");
        return;
      }
      const result = await window.dyworker.gitPush(workspacePath);
      if (!result.ok) setActionError(result.error || "推送失败");
      else void load(base);
    } catch {
      setActionError("推送失败");
    } finally {
      setGitBusy("");
    }
  };

  // 点击右侧文件树：左栏滚动到对应文件的 diff 区块（对照 Codex）
  const scrollToFile = (path: string) => {
    setSelectedPath(path);
    diffPaneRef.current
      ?.querySelector(`[data-review-path="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  if (!loading && overview && !overview.isRepo) {
    return fallbackChanges.length ? (
      <ReviewPanel changes={fallbackChanges} workspacePath={workspacePath} />
    ) : (
      <div className="browser-empty-state">
        <FileDiff size={46} />
        <strong>审阅改动</strong>
        <span>当前工作区不是 Git 仓库；助手修改文件后，可在这里审阅上一轮改动</span>
      </div>
    );
  }

  const filteredFiles = (overview?.files || []).filter((file) => !filter.trim() || file.path.toLowerCase().includes(filter.trim().toLowerCase()));
  const tree = buildReviewTree(filteredFiles);
  const totals = overview?.totals || { added: 0, removed: 0 };

  // 折叠/展开全部差异（对照 Codex 审阅头部工具按钮）
  const allCollapsed = filteredFiles.length > 0 && filteredFiles.every((file) => collapsedPaths.has(file.path));
  const toggleCollapseAll = () => {
    setCollapsedPaths(allCollapsed ? new Set() : new Set(filteredFiles.map((file) => file.path)));
  };
  const toggleCollapse = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="review-panel-body git-review">
      <div className="review-header">
        <div className="review-base-row" data-menu-root>
          <button
            className={`review-base-select ${baseMenuOpen ? "active" : ""}`}
            onClick={() => setBaseMenuOpen((value) => !value)}
            aria-expanded={baseMenuOpen}
            title="选择对比基线"
          >
            <span>{base === "HEAD" ? "HEAD（未提交改动）" : base}</span>
            <ChevronDown size={13} />
          </button>
          {baseMenuOpen && (
            <div className="session-menu review-base-menu" role="menu">
              <button role="menuitemradio" aria-checked={base === "HEAD"} onClick={() => { setBase("HEAD"); setBaseMenuOpen(false); void load("HEAD"); }}>
                <span>HEAD（未提交改动）</span>
                {base === "HEAD" && <Check size={14} />}
              </button>
              {overview?.upstream && (
                <button role="menuitemradio" aria-checked={base === overview.upstream} onClick={() => { setBase(overview.upstream); setBaseMenuOpen(false); void load(overview.upstream); }}>
                  <span>{overview.upstream}（含未推送提交）</span>
                  {base === overview.upstream && <Check size={14} />}
                </button>
              )}
            </div>
          )}
        </div>
        <span className="review-totals"><b>+{totals.added.toLocaleString()}</b> <em>-{totals.removed.toLocaleString()}</em></span>
        <span className="review-header-spacer" />
        <button
          className="icon-button subtle tiny"
          onClick={toggleCollapseAll}
          aria-label={allCollapsed ? "展开全部差异" : "折叠全部差异"}
          title={allCollapsed ? "展开全部差异" : "折叠全部差异"}
        >
          {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
        </button>
        <button className="icon-button subtle tiny" onClick={() => void load(base)} aria-label="刷新改动列表" title="刷新改动列表">
          <RefreshCw size={13} />
        </button>
        <button className="code-open-external review-commit-toggle" onClick={() => setCommitOpen((value) => !value)} disabled={Boolean(gitBusy)} title="提交改动（提交信息留空时按文件自动生成）">
          <GitCommitHorizontal size={13} />
          提交
        </button>
        <button className="code-open-external review-push-toggle" onClick={() => void pushAll()} disabled={Boolean(gitBusy)} title="推送到远程仓库">
          <ArrowUp size={13} />
          推送
        </button>
      </div>
      {commitOpen && (
        <div className="review-commit-box">
          <input
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void commitAll(); }}
            placeholder="提交信息（留空自动生成）"
            aria-label="提交信息"
          />
          <button className="button-secondary review-commit-go" onClick={() => void commitAll()} disabled={gitBusy === "commit"} title="Ctrl/Cmd+Enter 提交">
            {gitBusy === "commit" ? "提交中…" : "提交"}
          </button>
        </div>
      )}
      {actionError && <p className="panel-empty error-text">{actionError}</p>}
      {errorText && <p className="panel-empty error-text">{errorText}</p>}
      {loading && !overview ? (
        <p className="panel-empty">正在读取 Git 改动…</p>
      ) : overview && !overview.files.length ? (
        <div className="browser-empty-state">
          <FileDiff size={46} />
          <strong>没有待审阅的改动</strong>
          <span>{base === "HEAD" ? "工作区是干净的，助手修改文件后会出现在这里" : `与 ${base} 没有差异`}</span>
        </div>
      ) : (
        <div className="review-split">
          <div className="review-diff-pane" ref={diffPaneRef}>
            {filteredFiles.map((file) => (
              <ReviewFileDiffSection
                key={`${overview?.base}-${file.path}`}
                workspacePath={workspacePath}
                base={overview?.base || "HEAD"}
                file={file}
                active={file.path === selectedPath}
                collapsed={collapsedPaths.has(file.path)}
                onToggleCollapse={toggleCollapse}
                onStage={(path) => void runGitAction("stage", path)}
                onDiscard={(path) => void runGitAction("discard", path)}
                busy={Boolean(gitBusy)}
              />
            ))}
          </div>
          <div className="review-files-pane">
            <div className="tool-file-filter">
              <Search size={14} />
              <input
                placeholder="筛选文件…"
                aria-label="筛选改动文件"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              {filter.trim() && (
                <button className="icon-button subtle tiny" aria-label="清除筛选" title="清除筛选" onClick={() => setFilter("")}>
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="review-tree">
              {tree.dirs.map((dir) => <ReviewDirNode dir={dir} depth={0} key={dir.path} selectedPath={selectedPath} onSelect={scrollToFile} />)}
              {tree.files.map((file) => <ReviewFileRow file={file} depth={0} key={file.path} selected={file.path === selectedPath} onSelect={scrollToFile} />)}
              {!filteredFiles.length && <p className="panel-empty">没有匹配「{filter.trim()}」的文件。</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 侧边聊天：临时问答（不持久化，关闭应用后消失；对照 Codex 侧边聊天页） =====

function SideChatPanel({ settings }: { settings: ProviderSettings }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, sending]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text, createdAt: new Date().toISOString() }];
    setMessages(next);
    setDraft("");
    setSending(true);
    try {
      if (!window.dyworker?.completeChat) {
        setMessages([...next, { role: "assistant", content: "当前预览环境没有连接模型，这里只是界面演示。", createdAt: new Date().toISOString() }]);
        return;
      }
      const result = await window.dyworker.completeChat({ settings, messages: next });
      setMessages([...next, { role: "assistant", content: result.content || "（空回复）", createdAt: new Date().toISOString() }]);
    } catch (sendError) {
      setMessages([...next, { role: "assistant", content: `发送失败：${sendError instanceof Error ? sendError.message : String(sendError)}`, createdAt: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="side-chat-panel">
      <div className="side-chat-messages" ref={listRef}>
        {!messages.length ? (
          <div className="browser-empty-state side-chat-empty">
            <MessageSquarePlus size={46} />
            <strong>侧边聊天</strong>
            <span>侧边聊天是临时聊天，关闭应用后会消失。</span>
          </div>
        ) : (
          messages.map((message, index) => (
            <div className={`side-chat-message ${message.role}`} key={index}>
              {message.role === "user" ? (
                <span className="side-chat-bubble">{message.content}</span>
              ) : (
                <InteractiveMessage content={message.content} />
              )}
            </div>
          ))
        )}
        {sending && (
          <div className="side-chat-message assistant">
            <LoaderCircle className="spin" size={15} />
          </div>
        )}
      </div>
      <div className="side-chat-composer">
        <textarea
          placeholder="随心输入"
          aria-label="侧边聊天输入"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="side-chat-composer-bar">
          <button className="icon-button subtle" disabled title="附件暂未支持" aria-label="添加附件（暂未支持）">
            <Plus size={16} />
          </button>
          <span className="side-chat-model" title={settings.model ? `当前模型：${settings.model}` : "还没有配置模型"}>
            {settings.model || "未配置模型"}
          </span>
          <button
            className="side-chat-send"
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            aria-label="发送"
            title="发送"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}

// ===== Codex 风格文件浏览:左预览右目录树 =====

type FilePanelSelection = {
  path: string;
  name: string;
  kind: "markdown" | "code";
  content: string;
  loading: boolean;
  error?: string;
};

// 未保存草稿（工作台「编辑与保存」）：切文件、切面板、重启应用都不丢，保存后清除
const FILE_DRAFTS_KEY = "dyworker:file-drafts";
const MAX_FILE_DRAFTS = 50;

function loadFileDrafts(): Record<string, { content: string; savedAt: string }> {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILE_DRAFTS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistFileDrafts(drafts: Record<string, { content: string; savedAt: string }>) {
  try {
    localStorage.setItem(FILE_DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // 容量不足时放弃持久化，不阻塞编辑
  }
}

function FilesSplitPanel({
  workspacePath,
  workspaceEntries,
  workspaceOpen,
  onRefresh,
  onClearWorkspace,
  onError,
  onNotice,
  onInsertFile,
}: {
  workspacePath: string;
  workspaceEntries: WorkspaceEntry[];
  workspaceOpen: boolean;
  onRefresh: () => void;
  onClearWorkspace: () => void;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
  onInsertFile?: (entry: WorkspaceEntry) => void;
}) {
  const [fileFilter, setFileFilter] = useState("");
  const [selection, setSelection] = useState<FilePanelSelection | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const draftsRef = useRef<Record<string, { content: string; savedAt: string }>>(loadFileDrafts());
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const fileFilterActive = Boolean(fileFilter.trim());
  const visibleEntries = useMemo(
    () => filterWorkspaceEntries(workspaceEntries, fileFilter),
    [workspaceEntries, fileFilter],
  );

  const draftKeyFor = (path: string) => `${workspacePath}|${path}`;
  const currentDraft = selection ? draftsRef.current[draftKeyFor(selection.path)] : undefined;

  useEffect(() => {
    setSelection(null);
    setFileFilter("");
    setEditing(false);
    setDirty(false);
    setSaveError("");
  }, [workspacePath]);

  const previewFile = async (entry: WorkspaceEntry) => {
    const previewKind: "markdown" | "code" | "" = isMarkdownFile(entry.path) ? "markdown" : isTextPreviewFile(entry.path) ? "code" : "";
    if (!previewKind) {
      // 二进制/未知类型交给系统默认应用
      if (!window.dyworker?.openPath) return;
      const result = await window.dyworker.openPath(entry.path);
      if (!result.ok) onError(result.error || "无法打开文件");
      return;
    }
    setSelection({ path: entry.path, name: entry.name, kind: previewKind, content: "", loading: true });
    const readFile = previewKind === "markdown" ? window.dyworker?.readWorkspaceMarkdown : window.dyworker?.readWorkspaceFile;
    if (!readFile) {
      setSelection({ path: entry.path, name: entry.name, kind: previewKind, content: "", loading: false, error: "当前预览环境无法读取文件" });
      return;
    }
    try {
      const result = await readFile.call(window.dyworker, workspacePath, entry.path);
      if (!result.ok) {
        if ("binary" in result && result.binary) {
          // 后缀像文本但内容是二进制：交给系统打开
          setSelection(null);
          void window.dyworker?.openPath(entry.path);
          return;
        }
        setSelection({ path: entry.path, name: entry.name, kind: previewKind, content: "", loading: false, error: result.error || "文件读取失败" });
        return;
      }
      setSelection({ path: entry.path, name: entry.name, kind: previewKind, content: result.content || "", loading: false });
    } catch (previewError) {
      setSelection({ path: entry.path, name: entry.name, kind: previewKind, content: "", loading: false, error: `文件读取失败：${previewError instanceof Error ? previewError.message : String(previewError)}` });
    }
  };

  const startEdit = () => {
    if (!selection) return;
    const draft = draftsRef.current[draftKeyFor(selection.path)];
    setEditContent(draft ? draft.content : selection.content);
    setDirty(Boolean(draft));
    setSaveError("");
    setEditing(true);
    window.setTimeout(() => editorRef.current?.focus(), 0);
  };

  const updateDraft = (content: string) => {
    if (!selection) return;
    const key = draftKeyFor(selection.path);
    const draft = content === selection.content ? undefined : { content, savedAt: new Date().toISOString() };
    if (draft) {
      draftsRef.current[key] = draft;
      const keys = Object.keys(draftsRef.current);
      if (keys.length > MAX_FILE_DRAFTS) {
        const stale = keys
          .map((item) => ({ key: item, savedAt: draftsRef.current[item].savedAt }))
          .sort((a, b) => a.savedAt.localeCompare(b.savedAt))
          .slice(0, keys.length - MAX_FILE_DRAFTS);
        for (const entry of stale) delete draftsRef.current[entry.key];
      }
    } else {
      delete draftsRef.current[key];
    }
    persistFileDrafts(draftsRef.current);
  };

  const saveFile = async () => {
    if (!selection || saving) return;
    if (!window.dyworker?.writeWorkspaceFile) {
      setSaveError("当前预览环境没有写入文件的通道");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const result = await window.dyworker.writeWorkspaceFile(workspacePath, selection.path, editContent);
      if (!result.ok) {
        setSaveError(result.error || "保存失败");
        return;
      }
      const key = draftKeyFor(selection.path);
      delete draftsRef.current[key];
      persistFileDrafts(draftsRef.current);
      setSelection((current) => current ? { ...current, content: editContent } : current);
      setDirty(false);
      setEditing(false);
      onNotice?.(`已保存：${selection.name}`);
    } catch (saveError) {
      setSaveError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const discardEdit = () => {
    if (!selection) return;
    const key = draftKeyFor(selection.path);
    delete draftsRef.current[key];
    persistFileDrafts(draftsRef.current);
    setEditContent(selection.content);
    setDirty(false);
    setEditing(false);
    setSaveError("");
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+S 原子保存
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveFile();
    }
  };

  return (
    <div className="file-split">
      <div className="file-split-preview">
        {selection ? (
          <div className="file-split-preview-inner">
            <div className="code-panel-header">
              <div className="code-breadcrumb" title={selection.path}>
                {codeBreadcrumbSegments(selection.path, workspacePath).map((segment, index, segments) => (
                  <span className="code-breadcrumb-item" key={index}>
                    {index > 0 && <span className="code-breadcrumb-sep">›</span>}
                    <span className={index === segments.length - 1 ? "code-breadcrumb-current" : ""}>{segment}</span>
                  </span>
                ))}
              </div>
              {currentDraft && !editing && (
                <span className="file-draft-badge" title={`未保存草稿：${new Date(currentDraft.savedAt).toLocaleString("zh-CN")}`}>
                  有未保存草稿
                </span>
              )}
              {!editing && (
                <button
                  className="code-open-external"
                  onClick={startEdit}
                  title="切换到编辑模式（Ctrl/Cmd+S 保存）"
                  disabled={selection.loading || Boolean(selection.error)}
                >
                  <Pencil size={13} />
                  编辑
                </button>
              )}
              {editing && (
                <button className="code-open-external" onClick={() => void saveFile()} disabled={saving} title="保存到工作区（Ctrl/Cmd+S）">
                  <Check size={13} />
                  {saving ? "保存中…" : "保存"}
                </button>
              )}
              {editing && (
                <button className="code-open-external" onClick={discardEdit} title="放弃未保存的改动，恢复为磁盘内容">
                  放弃
                </button>
              )}
              <button
                className="code-open-external"
                onClick={() => void window.dyworker?.openPath(selection.path)}
                title="用系统默认应用打开"
              >
                打开
              </button>
            </div>
            {saveError && <p className="panel-empty error-text">{saveError}</p>}
            {selection.loading ? (
              <p className="panel-empty">正在读取文件…</p>
            ) : selection.error ? (
              <p className="panel-empty error-text">{selection.error}</p>
            ) : editing ? (
              <textarea
                ref={editorRef}
                className="file-editor"
                value={editContent}
                onChange={(event) => {
                  const value = event.target.value;
                  setEditContent(value);
                  setDirty(value !== selection.content);
                  updateDraft(value);
                }}
                onKeyDown={handleEditorKeyDown}
                spellCheck={false}
                aria-label={`编辑 ${selection.name}`}
              />
            ) : selection.kind === "markdown" ? (
              <article className="markdown-file-preview-content file-split-markdown">
                <InteractiveMessage content={selection.content} />
              </article>
            ) : (
              <CodeView content={selection.content} filePath={selection.path} />
            )}
          </div>
        ) : (
          <div className="browser-empty-state">
            <FolderOpen size={46} />
            <strong>打开文件</strong>
            <span>从工作区目录树中选择文件</span>
          </div>
        )}
      </div>
      <div className="file-split-tree">
        <div className="file-split-tree-header">
          <span className="file-split-tree-path" title={workspacePath}>
            <Folder size={14} />
            <span>{workspacePath ? displayWorkspace(workspacePath) : "未选择工作目录"}</span>
          </span>
          <button className="icon-button subtle tiny" onClick={onRefresh} aria-label="刷新文件列表" title="刷新文件列表" disabled={!workspacePath}>
            <RefreshCw size={13} />
          </button>
        </div>
        {workspacePath && (
          <div className="tool-file-filter">
            <Search size={14} />
            <input
              placeholder="筛选文件…"
              aria-label="筛选文件"
              value={fileFilter}
              onChange={(event) => setFileFilter(event.target.value)}
            />
            {fileFilterActive && (
              <button className="icon-button subtle tiny" aria-label="清除筛选" title="清除筛选" onClick={() => setFileFilter("")}>
                <X size={13} />
              </button>
            )}
          </div>
        )}
        {workspacePath && (
          <button className="tool-file-browser-clear" onClick={onClearWorkspace}>移除这个会话的工作目录</button>
        )}
        {workspaceOpen && (workspaceEntries.length ? (visibleEntries.length ? (
          <div className="workspace-tree">
            {visibleEntries.map((entry) => (
              <WorkspaceNode entry={entry} key={entry.path} onOpenFile={(item) => void previewFile(item)} onInsertFile={onInsertFile} forceExpand={fileFilterActive} />
            ))}
          </div>
        ) : (
          <p className="panel-empty">没有匹配「{fileFilter.trim()}」的文件。</p>
        )) : (
          workspacePath ? <p className="panel-empty">这个文件夹是空的。</p> : null
        ))}
        {!workspacePath && <p className="panel-empty">选择工作文件夹后，可以在这里浏览和引用文件。</p>}
      </div>
    </div>
  );
}

// ===== 浏览器「导入 Cookie 和密码」对话框（对照 Codex 浏览器更多菜单） =====

// 浏览器品牌色（导入对话框的图标圆点）
const BROWSER_BRAND_COLORS: Record<string, string> = {
  chrome: "#ea4335",
  edge: "#0c88c5",
  chromium: "#4d6fd1",
  brave: "#fb542b",
  browser360: "#3aa655",
  qaxbrowser: "#7b5cd6",
};

function BrowserBrandMark({ id, name }: { id: string; name: string }) {
  const color = BROWSER_BRAND_COLORS[id] || "#8a8f85";
  const initial = id === "qaxbrowser" ? "奇" : id === "browser360" ? "360" : name.trim().charAt(0).toUpperCase() || "?";
  return <span className="browser-brand-mark" style={{ background: color }} aria-hidden="true">{initial}</span>;
}

// 从浏览器导入（对照 Codex）：选择来源浏览器 + 用户画像 + 分类开关（密码/Cookie/浏览记录）
function BrowserImportDialog({ onClose, onDone, onError }: { onClose: () => void; onDone: (message: string) => void; onError: (message: string) => void }) {
  const [sources, setSources] = useState<BrowserImportSource[] | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [kinds, setKinds] = useState<BrowserImportKinds>({ passwords: true, cookies: true, history: true, localstorage: true });
  const [busy, setBusy] = useState(false);
  const [resultText, setResultText] = useState("");
  const [resultCounts, setResultCounts] = useState<Record<keyof BrowserImportKinds, number> | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!window.dyworker?.listImportableBrowsers) {
      setSources([]);
      return;
    }
    void window.dyworker.listImportableBrowsers()
      .then((list) => {
        if (cancelled) return;
        setSources(list);
        const first = list[0];
        if (first) setSelectedKey(`${first.id}|${first.userDataDir}`);
      })
      .catch(() => { if (!cancelled) setSources([]); });
    return () => { cancelled = true; };
  }, []);

  const selected = sources?.find((item) => `${item.id}|${item.userDataDir}` === selectedKey) || null;
  // 切换浏览器后画像选择回到该浏览器的第一个画像
  const effectiveProfileId = selected?.profiles.some((profile) => profile.id === profileId)
    ? profileId
    : selected?.profiles[0]?.id || "Default";
  const anyKindOn = kinds.passwords || kinds.cookies || kinds.history || kinds.localstorage;

  const runImport = async () => {
    if (!selected || !window.dyworker?.importBrowserData) return;
    if (busy) return;
    setBusy(true);
    setResultText("");
    setResultCounts(null);
    setWarnings([]);
    try {
      const result = await window.dyworker.importBrowserData({
        id: selected.id,
        userDataDir: selected.userDataDir,
        profileId: effectiveProfileId,
        kinds,
      });
      if (!result.ok) {
        onError(result.error || "导入失败");
        onClose();
        return;
      }
      const parts: string[] = [];
      if (kinds.passwords) parts.push(`${result.passwords ?? 0} 个密码`);
      if (kinds.cookies) parts.push(`${result.cookies ?? 0} 条 Cookie`);
      if (kinds.history) parts.push(`${result.history ?? 0} 条浏览记录`);
      if (kinds.localstorage) parts.push(`${result.localStorageOrigins ?? 0} 个站点的本地数据`);
      const summary = `已从${result.browser}导入 ${parts.join("、")}`
        + (result.weakProtection ? "（当前系统没有密钥链，密码以弱保护方式存储）" : "");
      setWarnings(result.warnings || []);
      setResultText(summary);
      setResultCounts({
        passwords: Number(result.passwords ?? 0),
        cookies: Number(result.cookies ?? 0),
        history: Number(result.history ?? 0),
        localstorage: Number(result.localStorageKeys ?? 0),
      });
      onDone(summary);
    } catch (importError) {
      onError(`导入失败：${importError instanceof Error ? importError.message : String(importError)}`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const kindRows: { key: keyof BrowserImportKinds; label: string; icon: typeof KeyRound; unit: string; note?: string }[] = [
    { key: "passwords", label: "已保存的密码", icon: KeyRound, unit: "个" },
    { key: "cookies", label: "Cookie", icon: Cookie, unit: "条" },
    { key: "history", label: "浏览记录", icon: History, unit: "条" },
    { key: "localstorage", label: "站点数据", icon: Database, unit: "项", note: "localStorage，kimi 等新站点的登录态在这里" },
  ];

  return (
    <div className="dialog-overlay" role="presentation" onClick={onClose}>
      <div className="browser-import-dialog" role="dialog" aria-modal="true" aria-label="从浏览器导入" onClick={(event) => event.stopPropagation()}>
        <div className="browser-import-header">
          <div className="browser-import-title">
            <strong>从浏览器导入</strong>
            <span>选择要导入到内置浏览器的数据</span>
          </div>
          <button className="icon-button subtle tiny" onClick={onClose} aria-label="关闭" title="关闭"><X size={15} /></button>
        </div>
        {sources === null ? (
          <p className="panel-empty">正在检测本机浏览器…</p>
        ) : !sources.length ? (
          <p className="panel-empty">没有检测到可导入的浏览器。支持 Chrome、Edge、Chromium、Brave，以及国产 Linux 环境下的 360 安全浏览器和奇安信可信浏览器。</p>
        ) : (
          <>
            <div className="browser-import-from">
              <span className="browser-import-from-label">从</span>
              <div className="browser-import-picker" data-menu-root>
                <button
                  className="browser-import-picker-button"
                  aria-haspopup="listbox"
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerOpen((value) => !value)}
                >
                  {selected && <BrowserBrandMark id={selected.id} name={selected.name} />}
                  <span className="browser-import-picker-name">{selected?.name || "选择浏览器"}</span>
                  <ChevronDown size={14} />
                </button>
                {pickerOpen && (
                  <div className="browser-import-picker-menu" role="listbox" aria-label="选择浏览器">
                    {sources.map((source) => {
                      const key = `${source.id}|${source.userDataDir}`;
                      return (
                        <button
                          role="option"
                          aria-selected={key === selectedKey}
                          className={key === selectedKey ? "active" : ""}
                          key={key}
                          onClick={() => { setSelectedKey(key); setPickerOpen(false); }}
                        >
                          <BrowserBrandMark id={source.id} name={source.name} />
                          <span className="browser-import-picker-name">{source.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            {selected && selected.profiles.length > 1 && (
              <div className="browser-import-from">
                <span className="browser-import-from-label">画像</span>
                <select
                  className="browser-import-profile-select"
                  value={effectiveProfileId}
                  onChange={(event) => setProfileId(event.target.value)}
                  aria-label="选择用户画像"
                >
                  {selected.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                  ))}
                </select>
              </div>
            )}
            {selected && <p className="browser-import-hint">导入前，请完全关闭 {selected.name}</p>}
            <div className="browser-import-kinds">
              {kindRows.map((row) => {
                const Icon = row.icon;
                const on = kinds[row.key];
                const imported = resultCounts && on ? resultCounts[row.key] : null;
                return (
                  <div className="browser-import-kind-row" key={row.key}>
                    <Icon size={18} />
                    <span>
                      {row.label}
                      {row.note && <small>{row.note}</small>}
                    </span>
                    {imported !== null && (
                      <em className="browser-import-kind-count">
                        <Check size={13} />已导入 {imported} {row.unit}
                      </em>
                    )}
                    <button
                      className={`browser-import-switch ${on ? "on" : ""}`}
                      role="switch"
                      aria-checked={on}
                      aria-label={row.label}
                      disabled={busy}
                      onClick={() => setKinds((current) => ({ ...current, [row.key]: !current[row.key] }))}
                    >
                      <span className="browser-import-switch-thumb" />
                    </button>
                  </div>
                );
              })}
            </div>
            {warnings.map((warning) => (
              <p className="browser-import-warning" key={warning}><AlertTriangle size={13} aria-hidden="true" />{warning}</p>
            ))}
            <div className="browser-import-actions">
              {resultText ? (
                <button className="button-primary" onClick={onClose}>完成</button>
              ) : (
                <>
                  <button className="button-secondary" onClick={onClose}>取消</button>
                  <button className="button-primary" disabled={!selected || !anyKindOn || busy} onClick={() => void runImport()}>
                    {busy ? "正在导入…" : "导入"}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 按名称筛选文件树:保留命中项的祖先目录链
function filterWorkspaceEntries(entries: WorkspaceEntry[], query: string): WorkspaceEntry[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return entries;
  const walk = (list: WorkspaceEntry[]): WorkspaceEntry[] => list.flatMap((entry) => {
    if (entry.kind === "directory") {
      const children = walk(entry.children || []);
      return children.length || entry.name.toLowerCase().includes(keyword) ? [{ ...entry, children }] : [];
    }
    return entry.name.toLowerCase().includes(keyword) ? [entry] : [];
  });
  return walk(entries);
}

function completedPlanForMessage(message: ChatMessage) {
  if (!message.plan?.length) return undefined;
  if (message.taskStatus === "done") {
    return message.plan.map((step) => ({ ...step, status: "completed" as const }));
  }
  // 兼容修复前已经保存的消息：有耗时且没有暂停、挂起、停止或报错提示时，视为正常完成。
  if (message.taskStatus || !message.durationMs || /已暂停|已主动挂起|已按你的要求停止|任务执行出错|任务失败|任务错误/.test(message.content)) {
    return message.plan;
  }
  return message.plan.map((step) => ({ ...step, status: "completed" as const }));
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

function ChangesSummary({ changes, workspacePath, onOpenReview }: { changes: FileChange[]; workspacePath: string; onOpenReview?: (changes: FileChange[]) => void }) {
  // 默认展开显示前 3 个修改文件，超过 3 个时出「再显示 xx 个文件」（对照 Codex）
  const [showAll, setShowAll] = useState(false);
  const [diffPath, setDiffPath] = useState("");
  const totals = changes.reduce(
    (accumulator, change) => ({ added: accumulator.added + change.added, removed: accumulator.removed + change.removed }),
    { added: 0, removed: 0 },
  );
  const openFile = (change: FileChange) => {
    if (!window.dyworker || !workspacePath) return;
    void window.dyworker.openPath(`${workspacePath.replace(/[\\/]+$/, "")}/${change.path}`);
  };
  const visibleChanges = showAll ? changes : changes.slice(0, 3);
  const hiddenCount = changes.length - visibleChanges.length;
  return (
    <div className="tool-summary">
      <div className="tool-summary-header changes-card">
        <FileCode2 size={16} />
        <span className="changes-card-text">
          <strong>已修改 {changes.length} 个文件</strong>
          {onOpenReview && (
            <button className="changes-review-link" onClick={() => onOpenReview(changes)}>
              查看更改 <ArrowUpRight size={12} />
            </button>
          )}
        </span>
        <span className="tool-summary-side changes-card-totals">
          <b>+{totals.added}</b> <em>-{totals.removed}</em>
        </span>
      </div>
      {visibleChanges.map((change) => (
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
      {hiddenCount > 0 && (
        <button className="changes-more" onClick={() => setShowAll(true)}>
          再显示 {hiddenCount} 个文件 <ChevronDown size={13} />
        </button>
      )}
      {showAll && changes.length > 3 && (
        <button className="changes-more" onClick={() => setShowAll(false)}>
          收起文件列表 <ChevronUp size={13} />
        </button>
      )}
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

function activityDisplayTitle(activity: ActivityRecord) {
  if (activity.kind !== "run_command") return activity.title;
  const command = activity.title.replace(/^运行命令[：:]\s*/, "");
  if (/^(已运行|正在运行|运行失败)\s/.test(activity.title)) return activity.title;
  if (activity.status === "running") return `正在运行 ${command}`;
  if (activity.status === "error") return `运行失败 ${command}`;
  return `已运行 ${command}`;
}

function ActivityRow({ activity }: { activity: ActivityRecord }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(activity.detail);
  const isCommand = activity.kind === "run_command";
  return (
    <div className={`activity-row ${activity.status} ${isCommand ? "command" : ""}`}>
      <button
        className="activity-row-main"
        onClick={() => expandable && setOpen((value) => !value)}
        disabled={!expandable}
      >
        <span className={`activity-status ${isCommand ? "activity-status-command" : ""}`}>
          {activity.status === "running"
            ? <LoaderCircle className="spin" size={13} />
            : activity.status === "error"
              ? <X size={13} />
              : isCommand
                ? <SquareTerminal size={16} />
                : <Check size={13} />}
        </span>
        {!isCommand && <ActivityIcon kind={activity.kind} />}
        <span className="activity-title">{activityDisplayTitle(activity)}</span>
        {expandable && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
      </button>
      {open && activity.detail && <pre className="activity-detail">{activity.detail}</pre>}
    </div>
  );
}

function ActivityList({ activities }: { activities: ActivityRecord[] }) {
  if (!activities.length) return null;
  const commandOnly = activities.every((activity) => activity.kind === "run_command");
  return (
    <div className={`activity-list ${commandOnly ? "command-list" : ""}`}>
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
      {action.suggestedRule && !String(action.details || "").includes("工作区外路径") && (
        <p className="approval-rule-hint">允许后本次任务内同类操作自动放行；「始终允许」则长期生效。</p>
      )}
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
              {item.builtIn ? <span className="memory-badge accent">内置</span> : null}
              {item.relation === "supersedes" ? <span className="memory-badge accent">已更新旧记忆</span> : null}
            </div>
            {!item.builtIn ? (
              <button className="icon-button subtle tiny" onClick={() => onDelete(item.id)} aria-label="删除这条记忆">
                <Trash2 size={13} />
              </button>
            ) : null}
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
  const [query, setQuery] = useState("");
  const filteredItems = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return items;
    return items.filter((skill) => [skill.name, skill.description, skill.path, skill.sourceLabel]
      .some((value) => String(value || "").toLowerCase().includes(text)));
  }, [items, query]);

  return (
    <div className="skills-panel">
      <div className="skill-management-head skill-management-head-enhanced">
        <div>
          <div className="skill-management-title">
            <strong>已安装技能</strong>
            <span className="skill-count-badge">{items.length}</span>
          </div>
          <small>自动读取用户目录与当前工作区中的 SKILL.md</small>
        </div>
        <button type="button" className="button-secondary" onClick={onRefresh}>
          <RefreshCw size={13} />
          刷新技能
        </button>
      </div>
      <div className="skill-search-field">
        <Search size={14} />
        <input
          value={query}
          aria-label="搜索已安装技能"
          placeholder="搜索名称、用途或路径"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button type="button" className="skill-search-clear" onClick={() => setQuery("")} aria-label="清除技能搜索">
            <X size={13} />
          </button>
        )}
      </div>
      {items.length > 0 && (
        <div className="skill-list-summary">
          <span>{query.trim() ? `找到 ${filteredItems.length} 个技能` : `共 ${items.length} 个技能`}</span>
          <span>{items.filter((skill) => skill.enabled).length} 个已启用</span>
        </div>
      )}
      {!items.length ? (
        <div className="skill-empty-state">
          <FileCode2 size={18} />
          <strong>还没有发现技能</strong>
          <p>可放在 ~/.agents/skills、~/.agent/skills、~/.codex/skills，或当前工作区对应的技能目录中。</p>
        </div>
      ) : !filteredItems.length ? (
        <div className="skill-empty-state">
          <Search size={18} />
          <strong>没有匹配的技能</strong>
          <p>换个名称、用途关键词，或清除搜索条件。</p>
          <button type="button" className="button-secondary" onClick={() => setQuery("")}>清除搜索</button>
        </div>
      ) : (
        <div className="panel-list skill-list">
          {filteredItems.map((skill) => (
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

function SkillLibrariesPanel({ value, onSave, onRefreshSkills }: {
  value: ProviderSettings;
  onSave: (value: ProviderSettings, successMessage?: string) => Promise<boolean>;
  onRefreshSkills: () => void | Promise<void>;
}) {
  const libraries = value.skillLibraries ?? defaultSettings.skillLibraries;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillLibrarySearchResult[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [installingSlug, setInstallingSlug] = useState("");
  const [saving, setSaving] = useState(false);

  const search = async (nextQuery = query) => {
    const text = nextQuery.trim();
    setSearching(true);
    setWarnings([]);
    try {
      const response = await window.dyworker?.searchSkillLibraries(text);
      if (!response?.ok) {
        setResults([]);
        setWarnings([response?.error || "技能库搜索失败"]);
        return;
      }
      setResults(response.results || []);
      setWarnings(response.warnings || []);
    } catch (error) {
      setResults([]);
      setWarnings([error instanceof Error ? error.message : String(error)]);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    void search("");
  }, []);

  const saveLibraries = async (next: SkillLibraryConfig[], message: string) => {
    setSaving(true);
    try {
      await onSave({ ...value, skillLibraries: next }, message);
    } finally {
      setSaving(false);
    }
  };

  const install = async (result: SkillLibrarySearchResult) => {
    setInstallingSlug(`${result.libraryId}:${result.slug}`);
    setWarnings([]);
    try {
      const response = await window.dyworker?.installSkillFromLibrary({ libraryId: result.libraryId, slug: result.slug });
      if (!response?.ok) {
        setWarnings([response?.error || "技能安装失败"]);
        return;
      }
      await onRefreshSkills();
      setWarnings([`已安装「${result.name}」，现在可以在“技能”中启用或使用。`]);
    } catch (error) {
      setWarnings([error instanceof Error ? error.message : String(error)]);
    } finally {
      setInstallingSlug("");
    }
  };

  return (
    <div className="skill-libraries-panel">
      <div className="skill-library-intro">
        <div>
          <span className="dialog-kicker">资源中心</span>
          <h3>发现新技能</h3>
        </div>
        <p>从技能库查找可复用能力，安装后会出现在“技能”列表中。</p>
      </div>
      <div className="dialog-section-title">技能库来源</div>
      <div className="panel-list skill-library-list">
        {libraries.map((library) => (
          <div className={`skill-library-row ${library.enabled ? "" : "disabled"}`} key={library.id}>
            <label className="skill-switch" title={library.enabled ? "点击停用" : "点击启用"}>
              <input
                type="checkbox"
                checked={library.enabled}
                disabled={saving}
                onChange={(event) => void saveLibraries(
                  libraries.map((item) => item.id === library.id ? { ...item, enabled: event.target.checked } : item),
                  `${library.name}已${event.target.checked ? "启用" : "停用"}`,
                )}
              />
            </label>
            <span className="mcp-server-name skill-library-name">
              <strong>{library.name}</strong>
              <small>{library.description || "未填写说明"}</small>
            </span>
            {library.websiteUrl && <a className="skill-library-link" href={library.websiteUrl} target="_blank" rel="noreferrer">打开官网 <ArrowUpRight size={12} /></a>}
          </div>
        ))}
      </div>

      <div className="dialog-section-title">搜索并安装</div>
      <p className="dialog-note">当前接入 SkillHub。需要先在本机安装 SkillHub CLI；安装时会写入用户技能目录，DYWorker 刷新后即可识别。</p>
      <div className="skill-library-search-form">
        <div className="skill-search-field">
          <Search size={14} />
          <input
            value={query}
            aria-label="搜索技能库"
            placeholder="搜索技能名称或用途，例如：PDF、网页自动化"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
          />
          {query && (
            <button type="button" className="skill-search-clear" onClick={() => { setQuery(""); void search(""); }} aria-label="清除技能库搜索">
              <X size={13} />
            </button>
          )}
        </div>
        <button type="button" className="button-secondary" onClick={() => void search()} disabled={searching}>
          {searching ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />}
          搜索
        </button>
      </div>
      {warnings.map((warning) => <p className="skill-library-message" key={warning}>{warning}</p>)}
      <div className="skill-library-results-head">
        <div>
          <strong>{query.trim() ? "搜索结果" : "技能列表"}</strong>
          <small>{searching ? "正在加载…" : results.length ? `显示 ${results.length} 个，可直接安装` : "暂时没有可显示的技能"}</small>
        </div>
        <button type="button" className="icon-button subtle tiny" onClick={() => void search()} disabled={searching} aria-label="刷新技能列表" title="刷新技能列表">
          <RefreshCw size={13} className={searching ? "spin" : ""} />
        </button>
      </div>
      {results.length ? (
        <div className="skill-library-results">
          {results.map((result) => {
            const installing = installingSlug === `${result.libraryId}:${result.slug}`;
            return (
              <div className="skill-library-result" key={`${result.libraryId}:${result.slug}`}>
                <div className="skill-library-result-mark"><Sparkles size={15} /></div>
                <div className="skill-library-result-main">
                  <div className="skill-library-result-title">
                    <strong>{result.name}</strong>
                    <span>{result.libraryName}</span>
                  </div>
                  <small>{result.slug}{result.version ? ` · ${result.version}` : ""}</small>
                  {result.description && <p>{result.description}</p>}
                </div>
                <button type="button" className="button-secondary" onClick={() => void install(result)} disabled={Boolean(installingSlug)}>
                  {installing ? <LoaderCircle size={13} className="spin" /> : <Plus size={13} />}
                  {installing ? "安装中…" : "安装"}
                </button>
              </div>
            );
          })}
        </div>
      ) : !searching ? (
        <div className="skill-library-empty">
          <Sparkles size={18} />
          <strong>{query.trim() ? "没有找到匹配技能" : "暂时没有技能列表"}</strong>
          <p>{query.trim() ? "换个关键词再试试。" : "请确认 SkillHub CLI 已安装，并检查网络连接。"}</p>
        </div>
      ) : null}
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
  workspacePath?: string;
}

function PlansPanel({
  items,
  workspaceReady,
  currentWorkspacePath,
  onSave,
  onToggle,
  onDelete,
  onTrigger,
  seed,
}: {
  items: ScheduleRecord[];
  workspaceReady: boolean;
  currentWorkspacePath?: string;
  onSave: (draft: ScheduleDraft) => Promise<boolean>;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
  seed?: { name: string; prompt: string } | null;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft>({ name: "", prompt: "", recurrence: "daily", nextRun: defaultNextRun(), allowWorkspaceWrites: false, workspacePath: "" });

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
      setDraft({ name: "", prompt: "", recurrence: "daily", nextRun: defaultNextRun(), allowWorkspaceWrites: false, workspacePath: "" });
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
          <div className="plan-form-row plan-form-workspace">
            <input
              value={draft.workspacePath || ""}
              placeholder={currentWorkspacePath ? `工作文件夹（留空使用：${currentWorkspacePath}）` : "工作文件夹（请选择工作文件夹）"}
              onChange={(event) => setDraft({ ...draft, workspacePath: event.target.value })}
              title="计划执行时使用的工作文件夹；留空则使用当前工作区"
            />
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

function FullAccessDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => Promise<boolean> }) {
  const [showDetails, setShowDetails] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  const confirm = async () => {
    setSaving(true);
    try {
      await onConfirm();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop full-access-backdrop" role="presentation" onMouseDown={() => !saving && onClose()}>
      <div
        className="full-access-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-access-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="full-access-title-row">
          <AlertTriangle size={29} strokeWidth={2.2} aria-hidden="true" />
          <h2 id="full-access-dialog-title">要开启完整访问权限吗?</h2>
        </div>
        <p className="full-access-intro">
          DYWorker 将能够在未经您许可的情况下，在这台计算机上的任何位置运行命令、使用互联网，以及创建和编辑文件。这包括但不限于：
        </p>
        <div className="full-access-capabilities">
          <div className="full-access-capability">
            <FolderOpen size={31} strokeWidth={1.8} aria-hidden="true" />
            <span>
              <strong>文件和文件夹</strong>
              <small>读取、创建、修改、上传或删除此计算机上任意位置的文件</small>
            </span>
          </div>
          <div className="full-access-capability">
            <SquareTerminal size={31} strokeWidth={1.8} aria-hidden="true" />
            <span>
              <strong>终端命令</strong>
              <small>运行命令、安装软件和更改系统设置</small>
            </span>
          </div>
          <div className="full-access-capability">
            <Globe size={31} strokeWidth={1.8} aria-hidden="true" />
            <span>
              <strong>互联网和已连接的应用</strong>
              <small>访问网站、发送数据并使用已启用的插件</small>
            </span>
          </div>
        </div>
        <p className="full-access-warning">
          这会带来敏感数据丢失或泄露以及提示注入等风险。你可以关闭此功能。
          <button type="button" className="full-access-learn-more" onClick={() => setShowDetails((value) => !value)}>
            了解更多
          </button>
        </p>
        {showDetails && (
          <p className="full-access-details">
            开启后，任务会减少逐次确认，更适合你明确承担风险并希望连续执行的场景。你可以随时从输入框旁的审批模式菜单切回替我审批或请示批准。
          </p>
        )}
        <div className="full-access-actions">
          <button type="button" className="full-access-cancel" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="full-access-confirm" onClick={() => void confirm()} disabled={saving}>
            <AlertTriangle size={17} aria-hidden="true" />
            {saving ? "开启中…" : "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}

function IdentitySetupDialog({ onChoose }: { onChoose: (identity: UserIdentity) => Promise<boolean> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const choose = async (identity: UserIdentity) => {
    setSaving(true);
    setError("");
    try {
      const saved = await onChoose(identity);
      if (!saved) setError("身份没有保存成功，请重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop identity-backdrop" role="presentation">
      <div className="identity-dialog" role="dialog" aria-modal="true" aria-labelledby="identity-dialog-title">
        <div className="identity-dialog-mark"><Sparkles size={21} aria-hidden="true" /></div>
        <span className="dialog-kicker">首次使用</span>
        <h2 id="identity-dialog-title">你准备怎样使用 DYWorker？</h2>
        <p className="identity-dialog-intro">选择后，助手会按对应场景组织回答和执行方式。这个选择会保存在当前设备上，之后也可以在设置中修改。</p>
        <div className="identity-options">
          <button type="button" className="identity-option" disabled={saving} onClick={() => void choose("general")}>
            <span className="identity-option-icon"><UserRound size={23} aria-hidden="true" /></span>
            <span className="identity-option-copy">
              <strong>通用身份</strong>
              <small>适合个人、企业、开发者和一般办公场景，使用更通用的工作助手设定。</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button type="button" className="identity-option" disabled={saving} onClick={() => void choose("government")}>
            <span className="identity-option-icon"><Landmark size={23} aria-hidden="true" /></span>
            <span className="identity-option-copy">
              <strong>政府单位</strong>
              <small>适合党政机关、事业单位等场景，优先遵循公文、政策和保密相关工作规则。</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        {saving && <p className="identity-dialog-status">正在保存选择…</p>}
        {error && <p className="identity-dialog-error">{error}</p>}
      </div>
    </div>
  );
}

function IdentitySettingsPanel({ value, onSave }: {
  value: ProviderSettings;
  onSave: (value: ProviderSettings, successMessage?: string) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  const select = async (identity: UserIdentity) => {
    if (identity === value.identity) return;
    setSaving(true);
    try {
      await onSave({ ...value, identity }, "身份设置已更新");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="identity-settings-panel">
      <div className="dialog-section-title">助手身份</div>
      <p className="profile-section-hint">身份只影响助手默认的工作语境，不会限制你使用其他功能。</p>
      <div className="identity-settings-options">
        <button type="button" className={`identity-option compact ${value.identity === "general" ? "selected" : ""}`} disabled={saving} onClick={() => void select("general")}>
          <span className="identity-option-icon"><UserRound size={20} aria-hidden="true" /></span>
          <span className="identity-option-copy"><strong>通用身份</strong><small>个人、企业、开发者和一般办公场景</small></span>
          {value.identity === "general" && <Check size={17} aria-hidden="true" />}
        </button>
        <button type="button" className={`identity-option compact ${value.identity === "government" ? "selected" : ""}`} disabled={saving} onClick={() => void select("government")}>
          <span className="identity-option-icon"><Landmark size={20} aria-hidden="true" /></span>
          <span className="identity-option-copy"><strong>政府单位</strong><small>党政机关、事业单位和政务办公场景</small></span>
          {value.identity === "government" && <Check size={17} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

function AppUpdateDialog({
  status,
  onClose,
  onCheck,
  onDownload,
  onInstall,
}: {
  status: AppUpdateStatus;
  onClose: () => void;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
}) {
  const isChecking = status.state === "checking";
  const isDownloading = status.state === "downloading";
  const progress = Math.round(Math.max(0, Math.min(100, status.percent || 0)));
  const title = status.state === "available"
    ? "发现新版本"
    : status.state === "downloaded"
      ? "更新已准备好"
      : status.state === "downloading"
        ? "正在下载更新"
        : status.state === "error"
          ? "更新检查失败"
          : "应用更新";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="app-update-dialog" role="dialog" aria-modal="true" aria-labelledby="app-update-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <span className="dialog-kicker">DYWorker</span>
            <h2 id="app-update-title">{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭更新提示">
            <X size={18} />
          </button>
        </div>
        <p className="app-update-version">当前版本 {status.currentVersion || "未知"}{status.version ? ` · 新版本 ${status.version}` : ""}</p>
        {status.state === "available" && (
          <p className="app-update-copy">GitHub 已发布新版本，下载完成后重启应用即可完成更新。</p>
        )}
        {isChecking && <p className="app-update-copy">正在检查 GitHub 标签对应的最新版本，请稍候。</p>}
        {isDownloading && (
          <div className="app-update-progress" aria-label={`下载进度 ${progress}%`}>
            <div className="app-update-progress-track"><span style={{ width: `${progress}%` }} /></div>
            <span>{progress}%</span>
          </div>
        )}
        {status.state === "downloaded" && <p className="app-update-copy">更新文件已下载完成，现在重启应用即可安装。</p>}
        {status.state === "not-available" && <p className="app-update-copy">当前已经是最新版本。</p>}
        {status.state === "unavailable" && <p className="app-update-copy">开发环境或当前安装方式暂不检查更新。</p>}
        {status.state === "error" && <p className="app-update-copy error-text">{status.error || "暂时无法连接 GitHub，请稍后重试。"}</p>}
        <div className="dialog-actions app-update-actions">
          <button type="button" className="button-secondary" onClick={onClose}>稍后</button>
          {status.state === "available" && <button type="button" className="button-primary" onClick={onDownload}>下载更新</button>}
          {status.state === "downloaded" && <button type="button" className="button-primary" onClick={onInstall}>重启并安装</button>}
          {(status.state === "not-available" || status.state === "error" || status.state === "unavailable") && (
            <button type="button" className="button-primary" onClick={onCheck} disabled={isChecking}>重新检查</button>
          )}
          {(isChecking || isDownloading) && <button type="button" className="button-primary" disabled><LoaderCircle size={14} className="spin" />处理中</button>}
        </div>
      </div>
    </div>
  );
}

type SettingsTab = "model" | "voice" | "search" | "power" | "mcp" | "updates" | "channels" | "identity" | "memories" | "skills" | "skill-libraries" | "plans" | "usage" | "hooks";

// Codex 风格设置导航:左侧分组 + 搜索,右侧分区内容
const settingsNav: { group: string; items: { id: SettingsTab; label: string; icon: typeof Settings }[] }[] = [
  { group: "服务", items: [
    { id: "model", label: "模型服务", icon: Settings },
    { id: "voice", label: "语音转写", icon: Mic },
    { id: "search", label: "搜索", icon: Search },
    { id: "channels", label: "消息渠道", icon: MessagesSquare },
  ] },
  { group: "偏好", items: [
    { id: "identity", label: "助手身份", icon: UserRound },
    { id: "power", label: "电源", icon: Moon },
    { id: "updates", label: "应用更新", icon: RefreshCw },
    { id: "mcp", label: "MCP 工具", icon: Bot },
  ] },
  { group: "资源", items: [
    { id: "memories", label: "记忆", icon: History },
    { id: "skills", label: "技能", icon: FileCode2 },
    { id: "skill-libraries", label: "技能库", icon: Globe },
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
      )) : <p className="dialog-note">还没有常驻规则。在审批卡片上点「始终允许」后会出现在这里；受信只读命令、常用开发命令（npm/python3/git 提交等）、同类文件写入、同域名网页可以规则化，本机界面操作永远逐次确认。</p>}
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
          <small>自动执行会放行工作区内读写、低风险命令与联网查询，只有越界路径、危险命令等仍需确认</small>
        </span>
        <select
          className="channel-model-select"
          value={channels.approvalMode}
          disabled={saving}
          onChange={(event) => void saveChannels({ ...channels, approvalMode: event.target.value as ChannelsConfig["approvalMode"] }, "审批严格度已更新")}
        >
          <option value="auto">自动执行（少打扰，推荐）</option>
          <option value="reviewer">替我审批（低风险操作自动放行）</option>
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
        启用后用手机微信扫码登录,他人给你的微信发消息即可让 DYWorker 处理并回复。群聊与文件/图片消息暂不支持。
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
      <p className="dialog-note">
        在 IM 里发送「更换工作目录至 /某个/路径」或「切换到 xxx 目录」可切换这个聊天的操作目录,相对路径基于当前目录;发送「停止」可中止正在执行或排队的任务。
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
  currentWorkspacePath,
  onSaveSchedule,
  onToggleSchedule,
  onDeleteSchedule,
  onTriggerSchedule,
  usageRecords,
  onClearUsage,
  tab,
  onTabChange,
  planSeed,
  appUpdate,
  onCheckUpdate,
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
  currentWorkspacePath?: string;
  onSaveSchedule: (draft: ScheduleDraft) => Promise<boolean>;
  onToggleSchedule: (id: string, enabled: boolean) => void;
  onDeleteSchedule: (id: string) => void;
  onTriggerSchedule: (id: string) => void;
  usageRecords: UsageRecord[] | null;
  onClearUsage: () => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  planSeed?: { name: string; prompt: string } | null;
  appUpdate: AppUpdateStatus;
  onCheckUpdate: () => void;
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
        {tab === "identity" ? (
          <IdentitySettingsPanel
            value={draft}
            onSave={async (next, message) => {
              const saved = await onSave(next, message);
              if (saved) setDraft(next);
              return saved;
            }}
          />
        ) : ["model", "voice", "search", "power", "updates", "mcp"].includes(tab) ? (
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
        <p className="dialog-note">
          {draft.endpoint.trim()
            ? (usesResponsesApi(draft.endpoint)
                ? "该地址将自动使用 Responses API 请求。"
                : "该地址将自动使用 OpenAI Chat Completions 请求。")
            : "系统会根据服务地址自动判断使用 Responses API 或 Chat Completions；DeepSeek 官方根地址会自动补全为 /responses。"}
        </p>
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
        {["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].some((m) => draft.model.trim().toLowerCase() === m) && (<>
        {draft.model.trim().toLowerCase() === "deepseek-v4-flash-vision-exp" ? (<>
          <div className="dialog-section-title">图片（DeepSeek V4 Flash Vision-Exp）</div>
          <p className="dialog-note">该模型原生支持图片输入（input_image / image_url），附件图片会原样随请求发送给 DeepSeek，无需再配置外部视觉服务。图片仅允许出现在用户消息中，支持 JPEG / PNG / GIF / WebP。</p>
        </>) : (<>
        <div className="dialog-section-title">图片识别（DeepSeek V4 Flash / Pro）</div>
        <p className="dialog-note">DeepSeek V4 系列模型本身负责文字理解。图片会先交给下方视觉服务识别，再把识别结果交给 DeepSeek；原图不会发送给纯文字接口。视觉服务需支持 OpenAI 兼容的 Chat Completions 和 image_url。</p>
        <label>
          视觉服务地址
          <input
            value={draft.visionEndpoint}
            placeholder="https://api.example.com/v1/chat/completions"
            onChange={(event) => setDraft({ ...draft, visionEndpoint: event.target.value })}
          />
        </label>
        <label>
          视觉模型名称
          <input
            value={draft.visionModel}
            placeholder="填写视觉服务提供的模型名称"
            onChange={(event) => setDraft({ ...draft, visionModel: event.target.value })}
          />
        </label>
        <label>
          视觉服务密钥
          <input
            value={draft.visionApiKey}
            type="password"
            placeholder="仅保存在当前设备"
            onChange={(event) => setDraft({ ...draft, visionApiKey: event.target.value })}
          />
        </label>
        </>)}
        </>)}
        {providerId === "kimi-open" && (<>
        <div className="dialog-section-title">Kimi 原生工具（开放平台）</div>
        <label className="dialog-check">
          <input
            type="checkbox"
            checked={draft.enableNativeTools !== false}
            onChange={(event) => setDraft({ ...draft, enableNativeTools: event.target.checked })}
          />
          启用 Kimi 官方工具（Formula API）
        </label>
        <label className="dialog-check">
          <input
            type="checkbox"
            checked={draft.enableWebSearchBuiltin === true}
            onChange={(event) => setDraft({ ...draft, enableWebSearchBuiltin: event.target.checked })}
          />
          启用内置联网搜索（$web_search，默认关闭）
        </label>
        <p className="dialog-note">
          默认关闭会向服务端持久化数据或上传文件的工具：memory（记忆）、excel（表格分析）。Kimi 公式 web_search 与网页抓取仍走本地联网审批。官方工具本体限时免费，恢复收费后按次计费；官方提示内置联网搜索正在升级，可能不稳定。
        </p>
        </>)}
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
        {tab === "updates" && (<>
        <div className="dialog-section-title">应用更新</div>
        <div className="settings-update-row">
          <span className="settings-update-status">
            当前版本 {appUpdate.currentVersion || "未知"}
            {appUpdate.state === "available" && ` · 发现新版本 ${appUpdate.version || ""}`}
            {appUpdate.state === "downloaded" && " · 更新已下载，可安装"}
            {appUpdate.state === "downloading" && ` · 正在下载 ${Math.round(appUpdate.percent || 0)}%`}
            {appUpdate.state === "checking" && " · 正在检查…"}
            {appUpdate.state === "not-available" && " · 已是最新"}
          </span>
          <button type="button" className="settings-update-check" onClick={onCheckUpdate}>
            {appUpdate.state === "downloaded" ? "安装更新" : appUpdate.state === "available" ? "查看更新" : "检查更新"}
          </button>
        </div>
        <div className="dialog-section-title">应用更新来源</div>
        <label>
          更新地址
          <input
            type="url"
            value={draft.updateUrl}
            placeholder="https://github.com/组织名/仓库名"
            onChange={(event) => setDraft({ ...draft, updateUrl: event.target.value })}
          />
        </label>
        <p className="dialog-note">默认使用 DYWorker 的 GitHub 仓库。你也可以改成自己的 GitHub 仓库；应用会按 v + 版本号的标签检查发布版本，例如 v0.1.17。</p>
        </>)}
        {tab === "search" && (<>
        <div className="dialog-section-title">搜索（可选）</div>
        <label>
          DeepSeek 搜索密钥
          <input
            value={draft.deepseekSearchApiKey}
            type="password"
            placeholder="platform.deepseek.com 申请；非 DeepSeek 模型时的默认搜索后端"
            onChange={(event) => setDraft({ ...draft, deepseekSearchApiKey: event.target.value })}
          />
        </label>
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
        <p className="dialog-note">搜索按模型厂商路由：Kimi 开放平台用 Kimi 官方搜索（公式 web_search，按次计费）；DeepSeek 模型用 DeepSeek 服务端搜索（复用会话密钥，每次搜索计一次模型调用）；其他模型默认也用 DeepSeek 搜索（需在此配置密钥）。以上都不可用时回退：博查 API → 自建 SearXNG → 必应国内版（带摘要）→ 360 / 搜狗抓取。涉密信息请勿使用任何联网搜索；政策法规建议用 gov_search 官方接口。自建 SearXNG 请只挂境内引擎后端，查询才不出境。</p>
        </>)}
        {tab === "mcp" && (<>
        <div className="dialog-section-title">MCP 工具服务器（可选）</div>
        <p className="dialog-note">本机应用操作已作为基础能力接入：macOS 与 Linux 均使用应用内置的桌面操控服务，无需额外安装；首次使用请允许 DYWorker 的辅助功能权限（macOS 另需屏幕录制权限用于查看界面截图）。</p>
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
        <div className="dialog-section-title" style={{ marginTop: 18 }}>语音合成（渠道语音发送）</div>
        <label>
          合成服务地址
          <input
            value={draft.ttsEndpoint}
            placeholder="OpenAI 兼容的 /audio/speech 地址，留空则不提供语音发送"
            onChange={(event) => setDraft({ ...draft, ttsEndpoint: event.target.value })}
          />
        </label>
        <label>
          合成模型
          <input
            value={draft.ttsModel}
            placeholder="tts-1"
            onChange={(event) => setDraft({ ...draft, ttsModel: event.target.value })}
          />
        </label>
        <label>
          合成密钥
          <input
            type="password"
            value={draft.ttsApiKey}
            placeholder="留空时使用主模型密钥"
            onChange={(event) => setDraft({ ...draft, ttsApiKey: event.target.value })}
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
        ) : tab === "skill-libraries" ? (
          <SkillLibrariesPanel value={value} onSave={onSave} onRefreshSkills={onRefreshSkills} />
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
            currentWorkspacePath={currentWorkspacePath}
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

// 图标来自 opensvg.dev（MynaUI 图标集）：mynaui:panel-left / mynaui:panel-right
function PanelLeftIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 3.5v17M3 9.4c0-2.24 0-3.36.436-4.216a4 4 0 0 1 1.748-1.748C6.04 3 7.16 3 9.4 3h5.2c2.24 0 3.36 0 4.216.436a4 4 0 0 1 1.748 1.748C21 6.04 21 7.16 21 9.4v5.2c0 2.24 0 3.36-.436 4.216a4 4 0 0 1-1.748 1.748C17.96 21 16.84 21 14.6 21H9.4c-2.24 0-3.36 0-4.216-.436a4 4 0 0 1-1.748-1.748C3 17.96 3 16.84 3 14.6z" />
    </svg>
  );
}

function PanelRightIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3.5v17M3 9.4c0-2.24 0-3.36.436-4.216a4 4 0 0 1 1.748-1.748C6.04 3 7.16 3 9.4 3h5.2c2.24 0 3.36 0 4.216.436a4 4 0 0 1 1.748 1.748C21 6.04 21 7.16 21 9.4v5.2c0 2.24 0 3.36-.436 4.216a4 4 0 0 1-1.748 1.748C17.96 21 16.84 21 14.6 21H9.4c-2.24 0-3.36 0-4.216-.436a4 4 0 0 1-1.748-1.748C3 17.96 3 16.84 3 14.6z" />
    </svg>
  );
}

export function App() {
  const [sessions, setSessions] = useState<SessionRecord[]>(previewSessions);
  const [activeId, setActiveId] = useState(previewSessions[0].id);
  const [workspacePath, setWorkspacePath] = useState(previewSessions[0].workspacePath);
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContext | null>(null);
  // 工作区 Git 状态：分支下拉与提交推送面板
  const [gitInfo, setGitInfo] = useState<GitBranchesInfo | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [commitPanelOpen, setCommitPanelOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [diffStats, setDiffStats] = useState<GitDiffStats | null>(null);
  const [gitBusy, setGitBusy] = useState<"" | "switch" | "commit" | "commit-push" | "push">("");
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>(previewWorkspace);
  const [pinnedWorkspacePaths, setPinnedWorkspacePaths] = useState<string[]>([]);
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
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [toolPanelWidth, setToolPanelWidth] = useState(() => {
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
    return Math.min(520, Math.max(340, Math.round(viewportWidth * 0.28)));
  });
  // 视口宽度跟随窗口变化：面板宽度只在拖动时按当时窗口夹取，窗口之后缩小
  // （如从高分屏搬到低分屏/笔记本屏）时必须重新夹取，否则固定像素宽度会吞掉整个主区域
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  // 夹取的是“生效宽度”而不是存储值：回到大窗口时用户拖出的宽度偏好自动恢复
  const appliedToolPanelWidth = Math.min(
    toolPanelWidth,
    Math.max(360, viewportWidth - (sidebarOpen ? sidebarWidth : 0) - 420),
  );
  const appliedSidebarWidth = Math.min(
    sidebarWidth,
    Math.max(260, viewportWidth - (rightPanelOpen ? appliedToolPanelWidth : 0) - 420),
  );
  // 初始没有任何标签页：浏览器只是菜单中的一个选项，用户选择之前什么都不打开（对照 Codex）
  const [toolPanelTabs, setToolPanelTabs] = useState<ToolPanelTab[]>([]);
  const [activeToolPanelTabId, setActiveToolPanelTabId] = useState("");
  const [browserOpening, setBrowserOpening] = useState(false);
  const [toolPanelMenuOpen, setToolPanelMenuOpen] = useState(false);
  const [toolPanelAddMenuOpen, setToolPanelAddMenuOpen] = useState(false);
  const [browserMoreOpen, setBrowserMoreOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  // 已导入的浏览记录：地址栏输入联想
  const [importedHistory, setImportedHistory] = useState<ImportedHistoryEntry[]>([]);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [workspaceGroupOpen, setWorkspaceGroupOpen] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);
  const [platform, setPlatform] = useState("");
  const [windowShadow, setWindowShadow] = useState(false);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>({});
  const [sessionNotices, setSessionNotices] = useState<Record<string, string>>({});
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, ApprovalAction>>({});
  const [pendingQuestions, setPendingQuestions] = useState<Record<string, QuestionRequest>>({});
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("reviewer");
  const [fullAccessDialogOpen, setFullAccessDialogOpen] = useState(false);
  const [loopStates, setLoopStates] = useState<Record<string, { iteration: number; maximum: number; status: string }>>({});
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  const [workspaceMenuPath, setWorkspaceMenuPath] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [mentionMenu, setMentionMenu] = useState<{ kind: "slash" | "at"; query: string; start: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionSkills, setMentionSkills] = useState<SkillRecord[]>([]);
  const [activeSkills, setActiveSkills] = useState<SkillRecord[]>([]);
  const [collapsedActivities, setCollapsedActivities] = useState<Set<string>>(new Set());
  const [hoveredTurnIndex, setHoveredTurnIndex] = useState<number | null>(null);
  const [, setElapsedTick] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [topMenuOpen, setTopMenuOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  // 统一轨迹事件流（trace-console）：当前 run 的 trace 缓存（含子代理分支，depth 区分），
  // 供轨迹控制台与「需求→实现」链路视图使用；内存上限 5000 条，历史靠 userData 落盘回放
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const traceEventsRef = useRef<TraceEvent[]>([]);
  // 子代理分支活动（process-chain）：带 branch 的活动不混入主活动流，单独缓存供链路视图
  const [subAgentActivities, setSubAgentActivities] = useState<{ runId: string; activity: ActivityRecord }[]>([]);
  const subAgentActivitiesRef = useRef<{ runId: string; activity: ActivityRecord }[]>([]);
  // 按 run 缓存 trace 事件（不可变更新，保证渲染端 useMemo 能感知新事件）：
  // 「需求→实现」链路视图按消息 runId 取本 run 的事件流归约
  const runTraceEventsRef = useRef<Map<string, TraceEvent[]>>(new Map());
  // 历史回放合并（轨迹控制台「载入历史」按钮）：把落盘的 TraceEvent 按 runId+seq 去重后
  // 并入内存流，同时按 runId 归位到 run 缓存，让链路视图也能随回放恢复
  const appendSessionTraces = (records: TraceEvent[]) => {
    if (!records.length) return;
    const known = new Set(traceEventsRef.current.map((entry) => `${entry.runId || ""}:${entry.seq}`));
    const fresh = records.filter((record) => !known.has(`${record.runId || ""}:${record.seq}`));
    if (!fresh.length) return;
    traceEventsRef.current = [...traceEventsRef.current, ...fresh].slice(-5000);
    setTraceEvents(traceEventsRef.current);
    for (const record of fresh) {
      if (!record.runId) continue;
      const previous = runTraceEventsRef.current.get(record.runId) || [];
      const next = [...previous, record];
      runTraceEventsRef.current.set(record.runId, next.length > 5000 ? next.slice(-5000) : next);
    }
  };
  const [usageStatsOpen, setUsageStatsOpen] = useState(false);
  const [usageStats, setUsageStats] = useState<UsageRecord[] | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateStatus>({ state: "idle", currentVersion: "" });
  const [appUpdateDialogOpen, setAppUpdateDialogOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("model");
  const [planSeed, setPlanSeed] = useState<{ name: string; prompt: string } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ sessionId: string; messageIndex: number; original: ChatMessage } | null>(null);
  const [imagePreview, setImagePreview] = useState<{ url: string; name: string } | null>(null);
  // 排队中的任务运行标识：同会话内串行执行，排队消息未执行前允许编辑或取消
  const [queuedRunIds, setQueuedRunIds] = useState<Set<string>>(new Set());
  // 队列卡片里 ⋯ 菜单当前挂在哪条排队消息上
  const [queueMenuRunId, setQueueMenuRunId] = useState<string | null>(null);
  // 右键菜单：消息文本选中复制、输入框复制/剪切/粘贴
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const queuedRunsRef = useRef<Map<string, Set<string>>>(new Map());
  const agentUnsubscribeRefs = useRef<Map<string, () => void>>(new Map());
  const runningRunIdsRef = useRef<Map<string, string>>(new Map());
  const sessionNoticeTimersRef = useRef<Map<string, number>>(new Map());
  const viewportRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef(activeId);
  const conversationTurnRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const browserWebviewRef = useRef<BrowserWebviewElement | null>(null);
  const panelResizeRef = useRef<{ edge: "left" | "right"; startX: number; startWidth: number } | null>(null);
  const toolPanelTabSequenceRef = useRef(1);
  const composingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const shouldScrollToBottomRef = useRef<string | null>(null);
  const newTaskGuardRef = useRef(false);

  // 会话更新与通知工具：定义在状态之后、各 effect 之前，供渠道实时事件监听器与 runTask 共用
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

  // 输入区高度随内容（编辑条、附件、提示条）变化，把实际高度写入 CSS 变量，
  // 对话列表底部 padding 据此预留空间，避免最后一条消息被输入框遮挡。
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // 会话列表快照 ref：渠道实时事件监听器（注册一次、长期存活）需要读取最新会话，
  // 用 ref 避免闭包捕获到旧的 sessions 状态
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // 工作台布局持久化：面板 Tab、分栏比例按会话保存到 localStorage，切换会话恢复、重启不丢。
  // 恢复先于保存执行，避免启动时用空状态覆盖已保存布局；没有自定义过布局（无 Tab）的会话不落盘。
  const PANEL_LAYOUT_PREFIX = "dyworker:panel-layout:v1:";
  const PANEL_LAYOUT_MAX = 30;
  useEffect(() => {
    if (!ready || !activeId) return;
    let saved: { tabs?: ToolPanelTab[]; activeTabId?: string; width?: number; open?: boolean } | null = null;
    try {
      const raw = localStorage.getItem(`${PANEL_LAYOUT_PREFIX}${activeId}`);
      if (raw) saved = JSON.parse(raw);
    } catch {
      saved = null;
    }
    if (!saved || !Array.isArray(saved.tabs) || !saved.tabs.length) return;
    setToolPanelTabs(saved.tabs);
    setActiveToolPanelTabId(saved.tabs.some((tab) => tab.id === saved.activeTabId) ? saved.activeTabId! : "");
    if (typeof saved.width === "number" && saved.width >= 300) setToolPanelWidth(saved.width);
    if (typeof saved.open === "boolean") setRightPanelOpen(saved.open);
  }, [ready, activeId]);

  useEffect(() => {
    if (!ready || !activeId) return;
    const key = `${PANEL_LAYOUT_PREFIX}${activeId}`;
    try {
      if (!toolPanelTabs.length) {
        // 会话没有自定义面板布局：不落盘（避免空状态覆盖已保存布局），并清理旧键
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, JSON.stringify({
        tabs: toolPanelTabs,
        activeTabId: activeToolPanelTabId,
        width: toolPanelWidth,
        open: rightPanelOpen,
        savedAt: Date.now(),
      }));
      // 陈旧会话清理：只保留最近 30 个会话的布局
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const itemKey = localStorage.key(index);
        if (itemKey?.startsWith(PANEL_LAYOUT_PREFIX)) keys.push(itemKey);
      }
      if (keys.length > PANEL_LAYOUT_MAX) {
        const stale = keys
          .map((itemKey) => {
            let savedAt = 0;
            try { savedAt = Number(JSON.parse(localStorage.getItem(itemKey) || "{}").savedAt || 0); } catch { /* 忽略坏键 */ }
            return { key: itemKey, savedAt };
          })
          .sort((a, b) => b.savedAt - a.savedAt)
          .slice(PANEL_LAYOUT_MAX);
        for (const entry of stale) localStorage.removeItem(entry.key);
      }
    } catch {
      // 布局持久化失败不影响使用
    }
  }, [ready, activeId, toolPanelTabs, activeToolPanelTabId, toolPanelWidth, rightPanelOpen]);

  useEffect(() => {
    const node = composerDockRef.current;
    if (!node) return;
    const update = () => {
      document.documentElement.style.setProperty("--composer-height", `${Math.ceil(node.getBoundingClientRect().height)}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 图片预览浮层支持 Esc 关闭
  useEffect(() => {
    if (!imagePreview) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setImagePreview(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [imagePreview]);

  // 模型浏览器工具与手动浏览共用右侧面板，避免再弹出独立窗口。
  useEffect(() => {
    const unsubscribe = window.dyworker?.onBrowserPanelRequest((request) => {
      if (request.action === "close") {        setRightPanelOpen(false);
        return;
      }
      const url = String(request.url || "").trim();
      if (!url) return;
      setRightPanelOpen(true);
      setToolPanelTabs((current) => {
        const browserTab = current.find((tab) => tab.kind === "browser");
        if (browserTab) {
          setActiveToolPanelTabId(browserTab.id);
          return current.map((tab) => tab.id === browserTab.id
            ? {
                ...tab,
                url,
                loadedUrl: url,
                title: url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "新标签页",
              }
            : tab);
        }
        const id = `browser-${toolPanelTabSequenceRef.current++}`;
        setActiveToolPanelTabId(id);
        return [...current, {
          id,
          kind: "browser",
          title: url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "新标签页",
          url,
          loadedUrl: url,
        }];
      });
    });
    return unsubscribe;
  }, []);

  // 下拉菜单（会话项/顶栏/输入区“+”）：点击菜单容器之外或按 Esc 时关闭
  const anyMenuOpen = sessionMenuId !== null || workspaceMenuPath !== null || topMenuOpen || addMenuOpen || modelMenuOpen || approvalMenuOpen || toolPanelMenuOpen || toolPanelAddMenuOpen || browserMoreOpen || branchMenuOpen || commitPanelOpen || queueMenuRunId !== null;
  useEffect(() => {
    if (!anyMenuOpen) return;
    const closeAll = () => {
      setSessionMenuId(null);
      setWorkspaceMenuPath(null);
      setTopMenuOpen(false);
      setAddMenuOpen(false);
      setModelMenuOpen(false);
      setApprovalMenuOpen(false);
      setToolPanelMenuOpen(false);
      setToolPanelAddMenuOpen(false);
      setBrowserMoreOpen(false);
      setBranchMenuOpen(false);
      setCommitPanelOpen(false);
      setQueueMenuRunId(null);
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
    const onPointerMove = (event: PointerEvent) => {
      const resize = panelResizeRef.current;
      if (!resize) return;
      if (resize.edge === "left") {
        const maxWidth = Math.max(260, window.innerWidth - (rightPanelOpen ? appliedToolPanelWidth : 0) - 420);
        setSidebarWidth(Math.min(Math.max(event.clientX, 220), Math.min(520, maxWidth)));
      } else {
        const nextWidth = window.innerWidth - event.clientX;
        const maxWidth = Math.max(360, window.innerWidth - (sidebarOpen ? appliedSidebarWidth : 0) - 420);
        setToolPanelWidth(Math.min(Math.max(nextWidth, 320), maxWidth));
      }
    };
    const onPointerUp = () => {
      panelResizeRef.current = null;
      document.body.classList.remove("resizing-panels");
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [rightPanelOpen, sidebarOpen, appliedSidebarWidth, appliedToolPanelWidth]);

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
        const loaded = keepSingleUnstartedSession(state.sessions.length ? state.sessions : [makeSession(state.workspacePath)]);
        setSessions(loaded);
        setActiveId(loaded[0].id);
        // 全局工作目录可能被上次的无目录会话清空，优先用当前会话保存的目录
        setWorkspacePath(loaded[0].workspacePath || state.workspacePath);
        setWorkspaceEntries(state.workspaceEntries);
        setSettings(state.settings);
        setPinnedWorkspacePaths(state.pinnedWorkspacePaths || []);
        setPlatform(state.platform || "");
        setWindowShadow(Boolean(state.windowShadow));
        setWindowMaximized(Boolean(state.windowMaximized));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  // Linux 透明窗口模式：由渲染端负责圆角、留白与阴影；最大化时贴满屏幕。
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("window-shadow", windowShadow);
    root.classList.toggle("window-maximized", windowMaximized);
  }, [windowShadow, windowMaximized]);

  useEffect(() => {
    if (!window.dyworker) return;
    const unsubscribe = window.dyworker.onWindowStateChange?.((maximized) =>
      setWindowMaximized(Boolean(maximized)),
    );
    return () => unsubscribe?.();
  }, []);

  // Linux 透明窗口输入健康检查：用户点击窗口后，主进程会确认窗口是否
  // 真正获得键盘焦点，拿不到时自动退回不透明窗口。
  useEffect(() => {
    if (!window.dyworker) return;
    const onPointerDown = () => window.dyworker?.reportWindowPointerDown?.();
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, []);

  useEffect(() => {
    if (!ready || !window.dyworker) return;
    const timeout = window.setTimeout(() => void window.dyworker?.saveSessions(sessions), 180);
    return () => window.clearTimeout(timeout);
  }, [ready, sessions]);

  useEffect(() => {
    if (!ready || !window.dyworker) return;
    const timeout = window.setTimeout(() => void window.dyworker?.savePinnedWorkspaces(pinnedWorkspacePaths), 180);
    return () => window.clearTimeout(timeout);
  }, [pinnedWorkspacePaths, ready]);

  // 审批模式记住上次选择：启动时从设置恢复，切换后立即落盘
  useEffect(() => {
    const saved = settings?.approvalMode;
    if (saved === "allow-writes") {
      setApprovalMode("reviewer");
    } else if (saved && ["interactive", "reviewer", "full-access", "deny-changes"].includes(saved)) {
      setApprovalMode(saved as ApprovalMode);
    }
  }, [settings?.approvalMode]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight });
    setAtBottom(true);
  }, [activeId, ready]);

  useEffect(() => {
    setHoveredTurnIndex(null);
  }, [activeId]);

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
    const updater = window.dyworker;
    if (!updater?.onAppUpdateStatus) return;
    const offUpdate = updater.onAppUpdateStatus((status) => {
      setAppUpdate(status);
      if (status.state === "available" || status.state === "downloaded") setAppUpdateDialogOpen(true);
    });
    void updater.getAppUpdateStatus().then(setAppUpdate);
    return () => offUpdate?.();
  }, []);

  useEffect(() => {
    const offSchedules = window.dyworker?.onSchedulesChanged?.(() => {
      void window.dyworker?.listSchedules?.().then(setSchedules);
      void window.dyworker?.listMemories?.().then(setMemories);
    });
    const offPrepend = window.dyworker?.onSessionPrepend?.((session) => {
      const workingContext = session.workingContext ?? latestWorkingContext(session.messages);
      setSessions((current) => [{ ...session, ...(workingContext !== undefined ? { workingContext } : {}) }, ...current]);
      setNotice(session.channel
        ? `收到${session.channel === "qq" ? "QQ" : "微信"}消息，渠道会话已建立`
        : "定时计划已执行，结果已保存到最近任务");
    });
    const offAppend = window.dyworker?.onSessionAppend?.((payload) => {
      const appendUnread = payload.sessionId !== activeIdRef.current;
      setSessions((current) => {
        const existing = current.find((session) => session.id === payload.sessionId);
        const workingContext = latestWorkingContext(payload.messages);
        if (existing) {
          return current.map((session) => session.id === payload.sessionId
            ? {
                ...session,
                // 渠道里用「更换工作目录至…」切换后，主进程随下一条消息带回新路径
                workspacePath: payload.workspacePath || session.workspacePath,
                ...(workingContext !== undefined ? { workingContext } : {}),
                ...(appendUnread ? { unread: true } : {}),
                messages: [...session.messages, ...payload.messages],
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
    void window.dyworker?.listInbox?.().then(setInboxItems);
    return () => {
      offSchedules?.();
      offPrepend?.();
      offAppend?.();
      offInbox?.();
    };
  }, []);

  // 渠道（QQ/微信）会话实时进度：主进程在渠道任务运行期间把关键 agent 事件
  // （活动流、正文流式、计划、循环状态、任务结束）通过 agent:event 转发过来，
  // 这里归约进对应会话的消息，让渠道回复像桌面任务一样边跑边显示，
  // 而不是等全部结束才一次性 append。与 runTask 内的监听器互不干扰：
  // 它只处理 taskSessionId+taskRunId，不碰渠道会话。
  useEffect(() => {
    if (!window.dyworker?.onAgentEvent) return;
    // 每个渠道会话当前正在流式更新的 assistant 占位消息 id（按 sessionId 记录）
    const channelStreamIds = new Map<string, string>();
    const patchChannelAssistant = (sessionId: string, updater: (current: ChatMessage) => ChatMessage) => {
      const targetId = channelStreamIds.get(sessionId);
      if (!targetId) return;
      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) => (message.id === targetId ? updater(message) : message)),
      }));
    };
    const ensureChannelAssistant = (sessionId: string): string => {
      const existing = channelStreamIds.get(sessionId);
      if (existing) return existing;
      const id = crypto.randomUUID();
      channelStreamIds.set(sessionId, id);
      updateSession(sessionId, (session) => ({
        ...session,
        messages: [...session.messages, {
          id,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          activities: [],
        }],
      }));
      return id;
    };
    const unsubscribe = window.dyworker.onAgentEvent((sessionAgentEvent) => {
      const { sessionId, event } = sessionAgentEvent;
      // 只处理渠道会话；桌面会话由 runTask 内注册的专属监听器处理
      const target = sessionsRef.current.find((session) => session.id === sessionId);
      if (!target || !target.channel) return;
      if (event.type === "queue-start") {
        ensureChannelAssistant(sessionId);
        setRunningSessionIds((current) => new Set(current).add(sessionId));
        setRunningStartedAt((current) => ({ ...current, [sessionId]: Date.now() }));
      } else if (event.type === "activity") {
        if (!event.activity.branch) {
          ensureChannelAssistant(sessionId);
          patchChannelAssistant(sessionId, (current) => ({ ...current, activities: [...(current.activities || []), event.activity] }));
        }
      } else if (event.type === "activity-update") {
        patchChannelAssistant(sessionId, (current) => ({
          ...current,
          activities: (current.activities || []).map((activity) =>
            activity.id === event.id
              ? { ...activity, status: event.status, detail: event.detail ?? activity.detail }
              : activity),
        }));
      } else if (event.type === "assistant-text") {
        ensureChannelAssistant(sessionId);
        patchChannelAssistant(sessionId, (current) => ({ ...current, content: event.text }));
      } else if (event.type === "plan-update") {
        ensureChannelAssistant(sessionId);
        patchChannelAssistant(sessionId, (current) => ({ ...current, plan: event.steps }));
      } else if (event.type === "file-change") {
        patchChannelAssistant(sessionId, (current) => ({ ...current, changes: event.changes }));
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
        // 收尾：用结果体把流式气泡收口为最终形态，并清掉运行标记
        const result = event.result;
        patchChannelAssistant(sessionId, (current) => {
          const plan = result.plan?.length ? result.plan : current.plan;
          const completedPlan = result.status === "done" && plan?.length
            ? plan.map((step) => ({ ...step, status: "completed" as const }))
            : plan;
          return {
            ...current,
            content: result.finalText || current.content,
            changes: result.changes?.length ? result.changes : current.changes,
            plan: completedPlan,
            durationMs: (result as { durationMs?: number }).durationMs,
            taskStatus: result.status,
          };
        });
        channelStreamIds.delete(sessionId);
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
        }
      }
    });
    return () => {
      unsubscribe?.();
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
  // 输入区展示的工作目录以当前会话为准，全局值仅作兜底（老会话可能保存了自己的目录）
  const composerWorkspacePath = String(activeSession?.workspacePath || workspacePath || "").trim();
  // 后台任务拓扑按当前会话隔离：只取本会话消息 runId 对应的轨迹，避免切换会话后串看别的会话
  const activeSessionTraceEvents = useMemo(() => {
    const runIds = new Set((activeSession?.messages || []).map((message) => message.runId).filter((runId): runId is string => Boolean(runId)));
    return runIds.size ? traceEvents.filter((entry) => Boolean(entry.runId) && runIds.has(entry.runId!)) : traceEvents;
  }, [traceEvents, activeSession?.messages]);

  // 重启后内存轨迹为空：活动会话切换时自动从落盘 jsonl 补载本会话历史轨迹（分页读全），
  // 让轨迹控制台与「需求→实现」链路视图都能回看历史；已补载过的会话不重复读
  const sessionHistoryLoadedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const sessionId = activeSession?.id;
    if (!sessionId || !window.dyworker?.readTraces) return;
    if (sessionHistoryLoadedRef.current.has(sessionId)) return;
    sessionHistoryLoadedRef.current.add(sessionId);
    let cancelled = false;
    const page = (offset: number) => {
      void window.dyworker!.readTraces({ sessionId, offset, limit: 2000 }).then((result) => {
        if (cancelled) return;
        if (result?.ok && Array.isArray(result.records) && result.records.length) {
          appendSessionTraces(result.records);
          const next = offset + result.records.length;
          if (next < (result.total || 0)) { page(next); return; }
        }
      });
    };
    page(0);
    return () => { cancelled = true; };
    // appendSessionTraces 读取最新的 ref 状态，无需加入依赖；仅在活动会话切换时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id]);

  // 点开会话即视为已读，清掉未读小绿点
  useEffect(() => {
    setSessions((current) => current.some((session) => session.id === activeId && session.unread)
      ? current.map((session) => session.id === activeId ? { ...session, unread: false } : session)
      : current);
  }, [activeId, sessions]);

  // 工作目录 chip 只在新建会话（尚无消息）时展示；已有会话的工作目录已固定，不再占用输入区空间
  const showComposerContext = Boolean(composerWorkspacePath) && (!activeSession || activeSession.messages.length === 0);

  useEffect(() => {
    if (!showComposerContext) {
      setWorkspaceContext(null);
      return;
    }
    setWorkspaceContext({ name: displayWorkspace(composerWorkspacePath), branch: "" });
    if (!ready || !window.dyworker?.getWorkspaceContext) return;
    let cancelled = false;
    void window.dyworker.getWorkspaceContext(composerWorkspacePath).then((context) => {
      if (!cancelled) setWorkspaceContext(context);
    }).catch(() => {
      // 工作目录仍可用时，至少保留目录名。
    });
    return () => { cancelled = true; };
  }, [ready, composerWorkspacePath, showComposerContext]);

  // 工作区 Git 状态：顶栏分支下拉与提交推送面板共用
  const refreshGitInfo = async () => {
    if (!ready || !window.dyworker?.gitBranches || !composerWorkspacePath) {
      setGitInfo(null);
      return;
    }
    try {
      const info = await window.dyworker.gitBranches(composerWorkspacePath);
      setGitInfo(info.isRepo ? info : null);
    } catch {
      setGitInfo(null);
    }
  };

  useEffect(() => {
    setBranchMenuOpen(false);
    setCommitPanelOpen(false);
    void refreshGitInfo();
  }, [ready, composerWorkspacePath]);

  const toggleBranchMenu = () => {
    setCommitPanelOpen(false);
    setBranchQuery("");
    setCreatingBranch(false);
    setBranchMenuOpen((value) => !value);
    void refreshGitInfo();
  };

  const openCommitPanel = () => {
    setBranchMenuOpen(false);
    setCommitPanelOpen(true);
    setDiffStats(null);
    if (window.dyworker?.gitDiffStats && composerWorkspacePath) {
      void window.dyworker.gitDiffStats(composerWorkspacePath).then(setDiffStats).catch(() => {});
    }
  };

  const switchBranch = async (name: string) => {
    if (!window.dyworker?.gitCheckout || gitBusy || name === gitInfo?.current) return;
    setGitBusy("switch");
    try {
      const result = await window.dyworker.gitCheckout(composerWorkspacePath, name);
      if (!result.ok) {
        setError(result.error || "切换分支失败");
        return;
      }
      setNotice(`已切换到分支 ${name}`);
      setBranchMenuOpen(false);
      await refreshGitInfo();
    } finally {
      setGitBusy("");
    }
  };

  const createBranch = async () => {
    const name = newBranchName.trim();
    if (!window.dyworker?.gitCreateBranch || !name || gitBusy) return;
    setGitBusy("switch");
    try {
      const result = await window.dyworker.gitCreateBranch(composerWorkspacePath, name);
      if (!result.ok) {
        setError(result.error || "创建分支失败");
        return;
      }
      setNotice(`已创建并切换到分支 ${name}`);
      setNewBranchName("");
      setCreatingBranch(false);
      setBranchMenuOpen(false);
      await refreshGitInfo();
    } finally {
      setGitBusy("");
    }
  };

  const runCommit = async (push: boolean) => {
    if (!window.dyworker?.gitCommit || gitBusy) return;
    setGitBusy(push ? "commit-push" : "commit");
    try {
      const commit = await window.dyworker.gitCommit({
        workspacePath: composerWorkspacePath,
        message: commitMessage,
        includeUnstaged,
      });
      if (!commit.ok) {
        setError(commit.error || "提交失败");
        return;
      }
      if (push && window.dyworker.gitPush) {
        const pushed = await window.dyworker.gitPush(composerWorkspacePath);
        if (!pushed.ok) setError(`已提交（${commit.message}），但推送失败：${pushed.error}`);
        else setNotice(`已提交并推送：${commit.message}`);
      } else {
        setNotice(`已提交：${commit.message}`);
      }
      setCommitMessage("");
      setCommitPanelOpen(false);
      await refreshGitInfo();
    } finally {
      setGitBusy("");
    }
  };

  const runPushOnly = async () => {
    if (!window.dyworker?.gitPush || gitBusy) return;
    setGitBusy("push");
    try {
      const result = await window.dyworker.gitPush(composerWorkspacePath);
      if (result.ok) setNotice("已推送到远程仓库");
      else setError(result.error || "推送失败");
      setCommitPanelOpen(false);
      await refreshGitInfo();
    } finally {
      setGitBusy("");
    }
  };

  const conversationTurns = useMemo(() => {
    if (!activeSession) return [];
    return activeSession.messages.reduce<Array<{ messageIndex: number; preview: ReturnType<typeof conversationTurnPreview> }>>((turns, message, messageIndex) => {
      if (message.role === "user") {
        turns.push({
          messageIndex,
          preview: conversationTurnPreview(activeSession.messages, messageIndex),
        });
      }
      return turns;
    }, []);
  }, [activeSession]);
  const activeTaskRunning = Boolean(activeSession?.id && runningSessionIds.has(activeSession.id));
  // 排队消息收在输入框上方的队列卡片里（对照 Codex），不插进对话流；
  // 主进程开始执行（queue-start 出队）后才作为正式消息渲染
  const activeQueuedMessages = useMemo(() => {
    if (!activeSession) return [] as { message: ChatMessage; messageIndex: number }[];
    return activeSession.messages
      .map((message, messageIndex) => ({ message, messageIndex }))
      .filter(({ message }) => message.role === "user" && Boolean(message.runId) && queuedRunIds.has(message.runId!));
  }, [activeSession, queuedRunIds]);
  // 仍在输出中的助手消息下标：没有终态 taskStatus 的最后一条助手消息。
  // 不能简单取 messages 末尾——后面可能跟着排队占位消息
  const streamingAssistantIndex = useMemo(() => {
    if (!activeSession || !activeTaskRunning) return -1;
    for (let index = activeSession.messages.length - 1; index >= 0; index -= 1) {
      const item = activeSession.messages[index];
      if (item.role === "assistant" && !item.taskStatus && !(item.runId && queuedRunIds.has(item.runId))) return index;
    }
    return -1;
  }, [activeSession, activeTaskRunning, queuedRunIds]);
  const markQueued = (sessionId: string, runId: string) => {
    const set = queuedRunsRef.current.get(sessionId) || new Set<string>();
    set.add(runId);
    queuedRunsRef.current.set(sessionId, set);
    setQueuedRunIds((current) => {
      const next = new Set(current);
      next.add(runId);
      return next;
    });
  };
  const unmarkQueued = (sessionId: string, runId: string) => {
    const set = queuedRunsRef.current.get(sessionId);
    if (!set) return;
    set.delete(runId);
    if (!set.size) queuedRunsRef.current.delete(sessionId);
    setQueuedRunIds((current) => {
      if (!current.has(runId)) return current;
      const next = new Set(current);
      next.delete(runId);
      return next;
    });
  };
  const sessionHasQueued = (sessionId: string) => Boolean(queuedRunsRef.current.get(sessionId)?.size);
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

  const workspaceSessionGroups = useMemo(() => {
    const groups = new Map<string, SessionRecord[]>();
    const recent: SessionRecord[] = [];
    for (const session of visibleSessions) {
      const path = String(session.workspacePath || "").trim();
      if (!path) {
        recent.push(session);
        continue;
      }
      const current = groups.get(path) || [];
      current.push(session);
      groups.set(path, current);
    }
    const order = (items: SessionRecord[]) => [...items].sort((a, b) => {
      const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      return pinned || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return {
      workspaces: [...groups.entries()]
        .map(([path, items]) => ({
          path,
          sessions: order(items),
          pinned: pinnedWorkspacePaths.includes(path),
        }))
        .sort((a, b) => {
          const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
          return pinned || new Date(b.sessions[0]?.updatedAt || 0).getTime() - new Date(a.sessions[0]?.updatedAt || 0).getTime();
        }),
      recent: order(recent),
    };
  }, [pinnedWorkspacePaths, visibleSessions]);

  // 切换会话/工作区时关掉旧工作区的审阅标签页（内容已过期）
  const closeFilePanelTabs = () => {
    if (!toolPanelTabs.some((tab) => tab.kind === "review")) return;
    const kept = toolPanelTabs.filter((tab) => tab.kind !== "review");
    setToolPanelTabs(kept);
    if (!kept.some((tab) => tab.id === activeToolPanelTabId)) setActiveToolPanelTabId(kept[0]?.id || "");
    if (kept.length === 0) setToolPanelMenuOpen(true);
  };

  const applyWorkspaceSelection = (targetWorkspacePath: string) => {
    setWorkspacePath(targetWorkspacePath);
    setWorkspaceMenuPath(null);
    if (targetWorkspacePath) {
      setWorkspaceOpen(true);
      setWorkspaceGroupOpen((current) => ({ ...current, [targetWorkspacePath]: true }));
      if (targetWorkspacePath !== workspacePath) {
        if (window.dyworker?.refreshWorkspace) {
          void window.dyworker.refreshWorkspace(targetWorkspacePath).then(setWorkspaceEntries).catch(() => setWorkspaceEntries([]));
        } else {
          setWorkspaceEntries(targetWorkspacePath === "/workspace/dyworker" ? previewWorkspace : []);
        }
      }
    } else {
      setWorkspaceEntries([]);
    }
  };

  const createTask = (targetWorkspacePath = workspacePath) => {
    const nextWorkspacePath = String(targetWorkspacePath || "");
    const unstartedSession = sessions.find((session) => !session.archived && session.messages.length === 0);
    if (unstartedSession) {
      setActiveId(unstartedSession.id);
      setWorkspaceMenuPath(null);
      if (unstartedSession.workspacePath !== nextWorkspacePath) {
        updateSession(unstartedSession.id, (session) => ({ ...session, workspacePath: nextWorkspacePath }));
        applyWorkspaceSelection(nextWorkspacePath);
      }
      window.setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }
    if (newTaskGuardRef.current) return;
    newTaskGuardRef.current = true;

    // 新任务继承当前工作目录，避免切换新会话后助手提示要先选目录；
    // 每个会话仍可在顶部或“+”菜单单独更换或移除工作目录。
    const session = makeSession(nextWorkspacePath);
    setSessions((current) => [session, ...current]);
    setActiveId(session.id);
    applyWorkspaceSelection(nextWorkspacePath);
    setComposer("");
    setAttachments([]);
    setActiveSkills([]);
    setEditingMessage(null);
    closeFilePanelTabs();
    setNotice("");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const deleteSession = (id: string) => {
    setSessionMenuId(null);
    newTaskGuardRef.current = false;
    // 会话删除时,它登记的待唤醒一并取消,避免无主的自动续跑
    void window.dyworker?.cancelWakesForSession?.(id);
    setSessions((current) => {
      const remaining = current.filter((session) => session.id !== id);
      if (!remaining.length) {
        const fresh = makeSession();
        setWorkspacePath("");
        setWorkspaceEntries([]);
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

  const toggleWorkspacePin = (targetWorkspacePath: string) => {
    const pinned = pinnedWorkspacePaths.includes(targetWorkspacePath);
    setPinnedWorkspacePaths((current) => pinned
      ? current.filter((path) => path !== targetWorkspacePath)
      : [...current, targetWorkspacePath]);
    setWorkspaceMenuPath(null);
    setNotice(pinned ? "已取消置顶工作目录" : "工作目录已置顶");
  };

  const openWorkspaceInFileManager = async (targetWorkspacePath: string) => {
    setWorkspaceMenuPath(null);
    if (!window.dyworker?.openPath) {
      setNotice("当前预览环境无法打开系统文件管理器");
      return;
    }
    try {
      const result = await window.dyworker.openPath(targetWorkspacePath);
      if (!result.ok) {
        setError(result.error || "无法打开工作目录");
        return;
      }
      setNotice("已在系统文件管理器中打开工作目录");
    } catch (openError) {
      setError(`无法打开工作目录：${openError instanceof Error ? openError.message : String(openError)}`);
    }
  };

  const archiveSession = (id: string) => {
    setTopMenuOpen(false);
    updateSession(id, (session) => ({ ...session, archived: true, pinned: false }));
    if (id === activeId) {
      const next = sessions.find((session) => session.id !== id && !session.archived);
      if (next) setActiveId(next.id);
      else {
        const fresh = makeSession();
        setWorkspacePath("");
        setWorkspaceEntries([]);
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

  const handleComposerPaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const image = imageItem?.getAsFile();
    if (!image) return;
    event.preventDefault();
    setError("");
    if (image.size > 12 * 1024 * 1024) {
      setError("剪贴板图片超过 12 MB，无法添加");
      return;
    }
    try {
      const bytes = Array.from(new Uint8Array(await image.arrayBuffer()));
      let attachment: Attachment | undefined;
      if (window.dyworker?.saveClipboardImage) {
        const result = await window.dyworker.saveClipboardImage({ data: bytes, mimeType: image.type || "image/png" });
        if (!result.ok || !result.attachment) throw new Error(result.error || "剪贴板图片保存失败");
        attachment = result.attachment;
      } else {
        const previewUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("剪贴板图片预览失败"));
          reader.readAsDataURL(image);
        });
        attachment = {
          name: "剪贴板图片.png",
          path: `clipboard-preview:${crypto.randomUUID()}`,
          size: image.size,
          mimeType: image.type || "image/png",
          isImage: true,
          previewUrl,
        };
      }
      setAttachments((current) => current.some((entry) => entry.path === attachment!.path)
        ? current
        : [...current, attachment!].slice(0, 12));
      setNotice("已粘贴剪贴板图片");
    } catch (pasteError) {
      setError(`无法添加剪贴板图片：${pasteError instanceof Error ? pasteError.message : String(pasteError)}`);
    }
  };

  const openContextMenu = (x: number, y: number, items: ContextMenuItem[]) => {
    setContextMenu({ x, y, items });
  };

  const closeContextMenu = () => setContextMenu(null);

  // 消息文本上右键：始终提供「复制」。有选中文本时复制选中内容，
  // 未选中时复制整条消息正文（跳过操作按钮、时间等非正文区域）。
  const handleMessageContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const selection = window.getSelection();
    const selected = selection?.toString().trim() ?? "";
    const anchor = selection?.anchorNode;
    const inside = Boolean(anchor && event.currentTarget.contains(anchor));
    const hasSelected = inside && selected.length > 0;
    const bodyEl = event.currentTarget.querySelector(".message-content, .user-message-text");
    const text = hasSelected ? selected : (bodyEl?.textContent ?? event.currentTarget.textContent ?? "").trim();
    if (!text) return;
    openContextMenu(event.clientX, event.clientY, [
      {
        key: "copy-selection",
        label: hasSelected ? "复制" : "复制消息",
        icon: <Copy size={15} />,
        onSelect: () => {
          void copyTextToClipboard(text).then((copied) => setNotice(copied ? "已复制" : "复制失败，请检查剪贴板权限"));
        },
      },
    ]);
  };

  // 输入框右键：复制 / 剪切 / 粘贴
  const handleComposerContextMenu = (event: MouseEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const hasSelection = end > start;
    const selected = composer.slice(start, end);
    openContextMenu(event.clientX, event.clientY, [
      {
        key: "copy",
        label: "复制",
        icon: <Copy size={15} />,
        disabled: !hasSelection,
        onSelect: () => {
          if (!hasSelection) return;
          void copyTextToClipboard(selected).then((copied) => setNotice(copied ? "已复制" : "复制失败，请检查剪贴板权限"));
          window.setTimeout(() => textareaRef.current?.focus(), 0);
        },
      },
      {
        key: "cut",
        label: "剪切",
        icon: <Scissors size={15} />,
        disabled: !hasSelection,
        onSelect: () => {
          if (!hasSelection) return;
          setComposer(composer.slice(0, start) + composer.slice(end));
          setMentionMenu(null);
          void copyTextToClipboard(selected).then((copied) => setNotice(copied ? "已剪切" : "剪切内容已删除，但复制到剪贴板失败"));
          window.setTimeout(() => {
            const target = textareaRef.current;
            if (target) {
              target.focus();
              target.setSelectionRange(start, start);
            }
          }, 0);
        },
      },
      {
        key: "paste",
        label: "粘贴",
        icon: <ClipboardPaste size={15} />,
        onSelect: () => {
          void pasteComposerText(start, end);
        },
      },
    ]);
  };

  // 向输入框光标处粘贴剪贴板文本；优先用异步剪贴板 API，被拦截时回退到 execCommand
  const pasteComposerText = async (start: number, end: number) => {
    const textarea = textareaRef.current;
    let text = "";
    // 主进程剪贴板读取不依赖渲染端权限，最可靠，优先使用
    try {
      if (window.dyworker?.readClipboardText) {
        text = await window.dyworker.readClipboardText();
      }
    } catch {
      text = "";
    }
    if (!text) {
      try {
        if (navigator.clipboard?.readText) {
          text = await navigator.clipboard.readText();
        }
      } catch {
        text = "";
      }
    }
    if (!text) {
      textarea?.focus();
      if (document.execCommand("paste")) {
        window.setTimeout(() => {
          const target = textareaRef.current;
          if (target && target.value !== composer) setComposer(target.value);
          setMentionMenu(null);
        }, 0);
      } else {
        setNotice("粘贴失败，请检查剪贴板权限");
      }
      return;
    }
    setComposer(composer.slice(0, start) + text + composer.slice(end));
    setMentionMenu(null);
    window.setTimeout(() => {
      const target = textareaRef.current;
      if (target) {
        target.focus();
        target.setSelectionRange(start + text.length, start + text.length);
      }
    }, 0);
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

  // 右侧面板快捷键（Codex 风格）：macOS 显示 ⌘/⌥/⌃，Windows/Linux 用 Ctrl/Alt 组合
  const isMacPlatform = platform === "darwin";
  const shortcutLabel = (mac: string, other: string) => (isMacPlatform ? mac : other);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modOnly = (isMacPlatform ? event.metaKey : event.ctrlKey) && !event.shiftKey && !event.altKey;
      if (modOnly && key === "t") {
        event.preventDefault();
        setRightPanelOpen(true);
        openToolPanelTab("browser");
      } else if (modOnly && key === "p") {
        event.preventDefault();
        setRightPanelOpen(true);
        openToolPanelTab("files");
      } else if (modOnly && key === "j") {
        event.preventDefault();
        setDebugOpen((value) => !value);
      } else if (event.ctrlKey && event.shiftKey && key === "g" && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setRightPanelOpen(true);
        openToolPanelTab("review");
      } else if (key === "s" && event.altKey && (isMacPlatform ? event.metaKey : event.ctrlKey)) {
        event.preventDefault();
        setRightPanelOpen(true);
        openToolPanelTab("chat");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const activeToolPanelTab = toolPanelTabs.find((tab) => tab.id === activeToolPanelTabId) || toolPanelTabs[0];
  const activeToolPanelKind = activeToolPanelTab?.kind || "browser";

  // 导入的 localStorage 注入：内置浏览器首次访问对应站点时，把暂存的键值写入页面 localStorage 并刷新一次。
  // SPA 站点（如 kimi）的登录令牌在 localStorage 里，刷新后页面带着令牌重新启动即恢复登录。
  useEffect(() => {
    const webview = browserWebviewRef.current;
    if (!webview || activeToolPanelKind !== "browser" || !activeToolPanelTab?.loadedUrl) return;
    let disposed = false;
    const handledUrls = new Set<string>(); // 每个 URL 只处理一次，注入后刷新不会死循环
    const onDomReady = () => {
      const url = webview.getURL?.() || "";
      if (disposed || !/^https?:\/\//i.test(url) || handledUrls.has(url)) return;
      handledUrls.add(url);
      let origin = "";
      try {
        origin = new URL(url).origin;
      } catch {
        return;
      }
      void (async () => {
        try {
          const entries = await window.dyworker?.getImportedLocalStorage?.(origin);
          if (!entries || disposed) return;
          await webview.executeJavaScript?.(
            `(() => { const data = ${JSON.stringify(entries)}; for (const [k, v] of Object.entries(data)) { try { localStorage.setItem(k, v); } catch { /* 单键失败不阻塞其余 */ } } })()`,
          );
          await window.dyworker?.markImportedLocalStorageDone?.(origin);
          if (!disposed) webview.reload?.();
        } catch {
          // 注入失败：保留暂存数据，下次访问该站点时重试
        }
      })();
    };
    webview.addEventListener("dom-ready", onDomReady);
    return () => {
      disposed = true;
      webview.removeEventListener("dom-ready", onDomReady);
    };
  }, [activeToolPanelTab?.id, activeToolPanelTab?.loadedUrl, activeToolPanelKind]);

  // 菜单页可见性派生：没有任何标签页时始终显示菜单页（即使全局 closeAll 把菜单状态关掉，
  // 比如拖动面板边框触发的外部点击关闭），避免出现空面板
  const menuPageShown = toolPanelMenuOpen || toolPanelTabs.length === 0;
  // 纯净菜单页:还没有任何标签页时,菜单页不显示标签栏和 + 按钮(对照 Codex)
  const pristineMenuPage = toolPanelTabs.length === 0;

  // 审阅面板数据:当前会话最近一轮的文件改动(对照 Codex 审阅页)
  const reviewChanges = useMemo(() => {
    const messages = activeSession?.messages || [];
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role === "assistant" && message.changes?.length) return message.changes;
    }
    return [];
  }, [activeSession]);

  // 「查看更改」点开的具体那条消息的改动（非 Git 工作区时作为审阅面板的数据源）
  const [reviewFocusChanges, setReviewFocusChanges] = useState<FileChange[] | null>(null);
  useEffect(() => { setReviewFocusChanges(null); }, [activeId]);

  const activeBrowserUrl = activeToolPanelTab?.kind === "browser" ? activeToolPanelTab.url || "" : "";

  // 加载已导入的浏览记录（地址栏联想）；导入成功后由对话框回调刷新
  const refreshImportedHistory = () => {
    if (!window.dyworker?.listImportedHistory) return;
    void window.dyworker.listImportedHistory().then(setImportedHistory).catch(() => {});
  };
  useEffect(refreshImportedHistory, []);

  const updateToolPanelTab = (id: string, patch: Partial<ToolPanelTab>) => {
    setToolPanelTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...patch } : tab));
  };

  const focusToolPanelTab = (id: string) => {
    setActiveToolPanelTabId(id);
    setToolPanelMenuOpen(false);
  };

  const openToolPanelTab = (kind: ToolPanelTab["kind"], createNew = false) => {
    if (!createNew) {
      const existing = toolPanelTabs.find((tab) => tab.kind === kind);
      if (existing) {
        focusToolPanelTab(existing.id);
        return existing.id;
      }
    }
    const sequence = toolPanelTabSequenceRef.current++;
    const tab: ToolPanelTab = {
      id: `${kind}-${sequence}`,
      kind,
      title: kind === "browser" ? "新标签页" : kind === "review" ? "审阅" : kind === "chat" ? "侧边聊天" : kind === "tasks" ? "后台任务" : "打开文件",
      ...(kind === "browser" ? { url: "" } : {}),
    };
    setToolPanelTabs((current) => [...current, tab]);
    setActiveToolPanelTabId(tab.id);
    setToolPanelMenuOpen(false);
    return tab.id;
  };

  const closeToolPanelTab = (id: string) => {
    const nextTabs = toolPanelTabs.filter((tab) => tab.id !== id);
    // 关掉最后一个标签页时回到菜单页，而不是再开一个空白浏览器（对照 Codex）
    if (!nextTabs.length) {
      setToolPanelTabs([]);
      setActiveToolPanelTabId("");
      setToolPanelMenuOpen(true);
      return;
    }
    setToolPanelTabs(nextTabs);
    if (id === activeToolPanelTabId) {
      const index = toolPanelTabs.findIndex((tab) => tab.id === id);
      setActiveToolPanelTabId(nextTabs[Math.max(0, index - 1)]?.id || nextTabs[0].id);
    }
  };

  const openBrowserUrl = async () => {
    const tab = activeToolPanelTab?.kind === "browser" ? activeToolPanelTab : undefined;
    const raw = activeBrowserUrl.trim();
    if (!tab) {
      openToolPanelTab("browser");
      return;
    }
    if (!raw) {
      setError("请输入网址");
      return;
    }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    updateToolPanelTab(tab.id, { url });
    setError("");
    setBrowserOpening(true);
    try {
      if (!window.dyworker?.openBrowser) {
        setNotice("当前预览环境没有连接浏览器窗口");
        return;
      }
      const result = await window.dyworker.openBrowser({ url, workspacePath });
      if (!result.ok) {
        setError(result.error || result.result || "网页打开失败");
        return;
      }
      const loadedUrl = result.url || url;
      updateToolPanelTab(tab.id, {
        url: loadedUrl,
        loadedUrl,
        title: loadedUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "新标签页",
      });
      setNotice("已在当前浏览器标签页打开网页");
    } catch (browserError) {
      setError(`网页打开失败：${browserError instanceof Error ? browserError.message : String(browserError)}`);
    } finally {
      setBrowserOpening(false);
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
    if (!settings.identity) {
      setNotice("请先选择 DYWorker 的使用身份");
      return;
    }
    let content = composer.trim();
    if ((!content && !attachments.length && !activeSkills.length) || !activeSession) return;
    const queueSupported = Boolean(window.dyworker?.sendTask);
    // 任务运行期间仍允许发送：桌面版进入消息队列，等当前任务结束后自动执行
    if (activeTaskRunning && !queueSupported) return;
    const editingTarget = editingMessage?.sessionId === activeSession.id
      ? activeSession.messages[editingMessage.messageIndex]
      : null;
    // 排队中的消息允许编辑：保留原 runId，主进程开始执行时按 runId 取会话里最新内容
    const editingQueuedRunId = editingTarget?.runId && queuedRunIds.has(editingTarget.runId)
      ? editingTarget.runId
      : undefined;
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
    newTaskGuardRef.current = false;
    const taskRunId = crypto.randomUUID();
    let queuedResponse = false;
    const messageRunId = editingQueuedRunId || taskRunId;
    const isQueuedEdit = Boolean(editingQueuedRunId);
    const queuedNow = isQueuedEdit || (!editingTarget && activeTaskRunning && queueSupported);
    // 桌面版当前正在执行的 runId 由主进程 queue-start 事件维护；预览模式无事件，这里直接记录
    if (!queueSupported) runningRunIdsRef.current.set(taskSessionId, taskRunId);
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
    if (!isQueuedEdit) setRunningStartedAt((current) => ({ ...current, [taskSessionId]: Date.now() }));
    shouldScrollToBottomRef.current = taskSessionId;
    const skillsBlock = selectedSkills.length
      ? `请按照以下技能执行：\n${selectedSkills.map((skill) => {
          // 文件型技能带上目录位置:技能正文里"读取同目录的 xx.md"这类指引才能直接执行,不用再全盘搜索
          const location = skill.path ? `\n技能目录:${pathDirname(skill.path)}(入口文件:${skill.path})` : "";
          return `【${skill.name}】${skill.description}${location}\n执行要求:${skill.instructions}`;
        }).join("\n\n")}\n\n以下是我的任务:\n`
      : "";
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      runId: messageRunId,
      // content 带完整技能指令发给模型;气泡只显示用户输入与 /技能 标签(对齐 Codex/Kimi 的引用呈现)
      content: skillsBlock + (content || (selectedSkills.length ? "（按模板处理当前工作区）" : "请处理这些附件。")),
      ...(selectedSkills.length ? {
        displayContent: content || "（按模板处理当前工作区）",
        skillsUsed: selectedSkills.map((skill) => skill.name),
      } : {}),
      attachments: selectedAttachments,
      createdAt: new Date().toISOString(),
    };
    const baseMessages = editingTarget && editingMessage
      ? activeSession.messages.slice(0, editingMessage.messageIndex)
      : activeSession.messages;
    // 编辑排队消息时保留原 assistant 占位（runId 不变），让已注册的事件监听器继续更新它
    const editingQueuedAssistant = isQueuedEdit && editingTarget && editingMessage
      ? activeSession.messages[editingMessage.messageIndex + 1]
      : null;
    const updatedSession: SessionRecord = {
      ...activeSession,
      ...(goalDriven ? { goal: content } : {}),
      ...(editingTarget ? { workingContext: undefined } : {}),
      title: baseMessages.length === 0 ? shortTitle(content) : activeSession.title,
      // 不能用空的全局值冲掉会话自己保存的工作目录（重启后全局值可能为空）
      workspacePath: workspacePath || activeSession.workspacePath || "",
      updatedAt: new Date().toISOString(),
      messages: [
        ...baseMessages,
        message,
        ...(editingQueuedAssistant?.role === "assistant" ? [editingQueuedAssistant] : []),
      ],
    };
    setEditingMessage(null);
    setSessions((current) => current.map((session) => session.id === activeSession.id ? updatedSession : session));

    // 编辑排队消息：不重新入队，只更新会话内容；主进程开始执行时会读到新内容
    if (isQueuedEdit) {
      setNotice("排队中的消息已更新，将在当前任务结束后按新内容执行");
      return;
    }

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
            runId: messageRunId,
            taskStatus: queuedNow ? "queued" : undefined,
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
            const plan = result.plan?.length ? result.plan : current.plan;
            const completedPlan = result.status === "done" && plan?.length
              ? plan.map((step) => ({ ...step, status: "completed" as const }))
              : plan;
            return {
              ...current,
              content,
              changes: result.changes?.length ? result.changes : current.changes,
              plan: completedPlan,
              durationMs: Date.now() - taskStartedAt,
              taskStatus: result.status,
              ...(result.workingContext !== undefined ? { workingContext: result.workingContext } : {}),
            };
          });
          if (result.workingContext !== undefined) {
            updateSession(activeSession.id, (session) => ({ ...session, workingContext: result.workingContext }));
          }
          // 非当前会话在后台完成时标记未读（列表小绿点），点开会话即清除
          if ((result.status === "done" || result.status === "error") && taskSessionId !== activeIdRef.current) {
            updateSession(taskSessionId, (session) => ({ ...session, unread: true }));
          }
          if (result.status === "done" && !result.demo) {
            playCompletionSound();
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
            // 子代理分支活动（带 branch）不进主活动流，单独缓存供链路视图
            if (agentEvent.activity.branch) {
              subAgentActivitiesRef.current.push({ runId: taskRunId, activity: agentEvent.activity });
              setSubAgentActivities(subAgentActivitiesRef.current.slice(-200));
            } else {
              patchAssistant((current) => ({ ...current, activities: [...(current.activities || []), agentEvent.activity] }));
            }
          } else if (agentEvent.type === "activity-update") {
            if (agentEvent.branch) {
              subAgentActivitiesRef.current = subAgentActivitiesRef.current.map((entry) =>
                entry.activity.id === agentEvent.id
                  ? { ...entry, activity: { ...entry.activity, status: agentEvent.status, detail: agentEvent.detail ?? entry.activity.detail } }
                  : entry);
              setSubAgentActivities(subAgentActivitiesRef.current.slice(-200));
            } else {
              patchAssistant((current) => ({
                ...current,
                activities: (current.activities || []).map((activity) =>
                  activity.id === agentEvent.id
                    ? { ...activity, status: agentEvent.status, detail: agentEvent.detail ?? activity.detail }
                    : activity),
              }));
            }
          } else if (agentEvent.type === "trace") {
            traceEventsRef.current.push(agentEvent.trace);
            if (traceEventsRef.current.length > 5000) traceEventsRef.current = traceEventsRef.current.slice(-5000);
            setTraceEvents(traceEventsRef.current);
            // 按 run 归位（不可变更新），供「需求→实现」链路视图按消息定位
            const runPrevious = runTraceEventsRef.current.get(taskRunId) || [];
            const runNext = [...runPrevious, agentEvent.trace];
            runTraceEventsRef.current.set(taskRunId, runNext.length > 5000 ? runNext.slice(-5000) : runNext);
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
          } else if (agentEvent.type === "queued") {
            markQueued(taskSessionId, taskRunId);
            setRunningSessionIds((current) => {
              const next = new Set(current);
              next.add(taskSessionId);
              return next;
            });
          } else if (agentEvent.type === "queue-start") {
            unmarkQueued(taskSessionId, taskRunId);
            runningRunIdsRef.current.set(taskSessionId, taskRunId);
            setRunningSessionIds((current) => {
              const next = new Set(current);
              next.add(taskSessionId);
              return next;
            });
            setRunningStartedAt((current) => ({ ...current, [taskSessionId]: Date.now() }));
            patchAssistant((current) => ({ ...current, taskStatus: undefined }));
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
            if (runningRunIdsRef.current.get(taskSessionId) === taskRunId) {
              runningRunIdsRef.current.delete(taskSessionId);
            }
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
            // 排队消息的监听器一直保留到真正执行完成，这里统一收尾
            const unsubscribe = agentUnsubscribeRefs.current.get(taskRunId);
            agentUnsubscribeRefs.current.delete(taskRunId);
            if (unsubscribe) window.setTimeout(unsubscribe, 1000);
            // 会话是否继续显示运行状态由队列决定：还有排队消息则保持，全部完成才收起
            if (!sessionHasQueued(taskSessionId)) {
              setRunningSessionIds((current) => {
                if (!current.has(taskSessionId)) return current;
                const next = new Set(current);
                next.delete(taskSessionId);
                return next;
              });
            }
          }
        });
        agentUnsubscribeRefs.current.set(taskRunId, unsubscribeAgent);
        try {
          const response = await window.dyworker.sendTask({
            settings,
            workspacePath,
            sessionId: updatedSession.id,
            contextLimit: modelContextLimit(settings.model, settings.endpoint),
            workingContext: updatedSession.workingContext,
            goal: updatedSession.goal,
            messages: updatedSession.messages,
            loop: { enabled: goalDriven, maximum: goalDriven ? 10 : 1 },
            approvalMode,
            runId: taskRunId,
          });
          if (response.queued) {
            queuedResponse = true;
            markQueued(taskSessionId, taskRunId);
          } else {
            if (!response.ok || !response.result) throw new Error(response.error || "任务执行失败");
            if (!finishedEventSeen) applyAgentResult(response.result);
          }
        } finally {
          if (runningRunIdsRef.current.get(taskSessionId) === taskRunId) {
            runningRunIdsRef.current.delete(taskSessionId);
          }
          // 非排队消息的监听器在此收尾；排队消息由 agent-finished 统一收尾（任务可能尚未开始）
          if (!queuedResponse) {
            // webContents.send 的尾部事件可能晚于 invoke 响应到达，延迟取消订阅避免丢事件
            const unsubscribe = agentUnsubscribeRefs.current.get(taskRunId);
            agentUnsubscribeRefs.current.delete(taskRunId);
            if (unsubscribe) window.setTimeout(unsubscribe, 1000);
          }
          // 预览模式没有主进程队列事件，由这里收起运行状态；桌面版由 agent-finished 维护
          if (!queueSupported) {
            setRunningSessionIds((current) => {
              if (!current.has(taskSessionId)) return current;
              const next = new Set(current);
              next.delete(taskSessionId);
              return next;
            });
          }
          // 排队消息尚未执行，不清理当前任务的循环状态（由 queue-start/agent-finished 维护）
          if (!queuedResponse) {
            setLoopStates((current) => {
              const next = { ...current };
              delete next[taskSessionId];
              return next;
            });
          }
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
      // 桌面版运行状态由主进程队列事件维护；预览模式（无队列事件）在这里收起
      if (!window.dyworker?.sendTask) {
        setRunningSessionIds((current) => {
          const next = new Set(current);
          next.delete(taskSessionId);
          return next;
        });
      }
      // 排队消息尚未执行：不清理当前任务的运行态，防止误删正在执行任务的审批/计时
      if (!queuedResponse) {
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
      setSettings({ ...nextSettings, updateUrl: result?.updateUrl || nextSettings.updateUrl });
      setNotice(successMessage);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      return false;
    }
  };

  const checkAppUpdate = async () => {
    setAppUpdateDialogOpen(true);
    try {
      const result = await window.dyworker?.checkForAppUpdate();
      if (result && !result.ok && result.error) setNotice(result.error);
    } catch (updateError) {
      setNotice(updateError instanceof Error ? updateError.message : String(updateError));
    }
  };

  const openAppUpdateDialog = () => {
    setAppUpdateDialogOpen(true);
    if (["idle", "not-available", "error", "unavailable"].includes(appUpdate.state)) void checkAppUpdate();
  };

  const downloadAppUpdate = () => {
    void window.dyworker?.downloadAppUpdate().then((result) => {
      if (!result.ok && result.error) setNotice(result.error);
    });
  };

  const installAppUpdate = () => {
    void window.dyworker?.installAppUpdate().then((result) => {
      if (!result.ok && result.error) setNotice(result.error);
    });
  };

  const chooseIdentity = (identity: UserIdentity) =>
    saveProviderSettings({ ...settings, identity }, "身份设置已保存");

  const selectApprovalMode = (nextMode: ApprovalMode) => {
    if (nextMode === "full-access") {
      setApprovalMenuOpen(false);
      setFullAccessDialogOpen(true);
      return;
    }
    setApprovalMode(nextMode);
    setApprovalMenuOpen(false);
    void saveProviderSettings({ ...settings, approvalMode: nextMode }, "审批模式已记住，下次启动继续生效");
  };

  const confirmFullAccess = async () => {
    const saved = await saveProviderSettings({ ...settings, approvalMode: "full-access" }, "完整访问权限已开启");
    if (!saved) return false;
    setApprovalMode("full-access");
    setFullAccessDialogOpen(false);
    return true;
  };

  const activateModelProfile = async (profile: ModelProfile) => {
    const nextSettings = settingsWithProfile(settings, profile);
    setModelMenuOpen(false);
    await saveProviderSettings(nextSettings, `已切换到 ${profile.name}`);
  };

  const saveSchedule = async (draft: ScheduleDraft) => {
    const planWorkspacePath = (draft.workspacePath || "").trim() || workspacePath;
    const result = await window.dyworker?.saveSchedule({ ...draft, workspacePath: planWorkspacePath });
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
  const identitySetupOpen = ready && settings.identity === null;
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
    const tokens = estimateSessionTokens(activeSession?.messages || [], activeSession?.workingContext || "");
    return { used: tokens, limit: modelContextLimit(settings.model, settings.endpoint), exact: false };
  }, [
    activeSession?.messages,
    activeSession?.workingContext,
    activeSession?.contextTokens,
    activeSession?.contextTokensExact,
    activeSession?.contextModel,
    activeSession?.contextEndpoint,
    settings.model,
    settings.endpoint,
  ]);
  // 任务运行期间仍可发送：桌面版消息进入队列，等当前任务结束后自动执行
  const canSend = Boolean(
    (composer.trim() || attachments.length || activeSkills.length)
    && (!activeTaskRunning || Boolean(window.dyworker?.sendTask))
    && voiceState !== "transcribing",
  );
  const recentExpanded = workspaceGroupOpen.__recent__ !== false;
  const fileManagerLabel = platform === "darwin"
    ? "在 Finder 中显示"
    : platform === "win32"
      ? "在文件资源管理器中显示"
      : "在文件管理器中显示";

  const selectSession = (session: SessionRecord) => {
    setSessionMenuId(null);
    setActiveId(session.id);
    setEditingMessage(null);
    closeFilePanelTabs();
    const path = String(session.workspacePath || "").trim();
    setWorkspacePath(path);
    if (!path) {
      setWorkspaceEntries([]);
      return;
    }
    if (window.dyworker?.refreshWorkspace) {
      void window.dyworker.refreshWorkspace(path).then(setWorkspaceEntries).catch(() => setWorkspaceEntries([]));
    }
  };

  const jumpToConversationTurn = (turnIndex: number) => {
    setHoveredTurnIndex(turnIndex);
    conversationTurnRefs.current[turnIndex]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const clearWorkspace = () => {
    if (!activeSession) return;
    setWorkspacePath("");
    setWorkspaceEntries([]);
    closeFilePanelTabs();
    updateSession(activeSession.id, (session) => ({ ...session, workspacePath: "" }));
    setNotice("已移除这个会话的工作目录，会话归入最近");
  };

  const copyMessage = async (message: ChatMessage) => {
    const copied = await copyTextToClipboard(messageVisibleText(message));
    setNotice(copied ? "消息已复制" : "消息复制失败，请检查剪贴板权限");
  };

  const startMessageEdit = (message: ChatMessage, messageIndex: number) => {
    if (!activeSession || message.role !== "user") return;
    // 任务运行期间只允许编辑排队中、尚未开始执行的消息
    if (activeTaskRunning && !(message.runId && queuedRunIds.has(message.runId))) return;
    setEditingMessage({ sessionId: activeSession.id, messageIndex, original: message });
    setComposer(messageVisibleText(message));
    setAttachments(message.attachments ? [...message.attachments] : []);
    setActiveSkills(message.skillsUsed?.length ? skills.filter((skill) => message.skillsUsed?.includes(skill.name)) : []);
    setMentionMenu(null);
    setNotice("已载入消息，修改后点击发送即可替换原消息并重新处理");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const cancelMessageEdit = () => {
    setEditingMessage(null);
    setComposer("");
    setAttachments([]);
    setActiveSkills([]);
    setNotice("已取消编辑");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // 从队列移除一条排队消息（同时移除它的空助手占位）
  const removeQueuedMessage = async (runId: string, messageIndex: number, notice = "已删除这条排队消息") => {
    if (!activeSession) return;
    const sessionId = activeSession.id;
    if (!runId || !queuedRunIds.has(runId)) return;
    if (window.dyworker?.removeQueuedTask) {
      const result = await window.dyworker.removeQueuedTask({ sessionId, runId });
      if (!result?.ok || result.removed === false) {
        // 队列项可能已开始执行或应用重启后已不存在，仍从会话中移除这条消息
      }
    }
    unmarkQueued(sessionId, runId);
    updateSession(sessionId, (session) => {
      const next = [...session.messages];
      next.splice(messageIndex, 1);
      // 同时移除紧随其后的空助手占位（排队消息尚未开始执行）
      const following = next[messageIndex];
      if (following?.role === "assistant" && following.runId === runId && !following.content) {
        next.splice(messageIndex, 1);
      }
      return { ...session, messages: next };
    });
    setNotice(notice);
  };

  const cancelQueuedMessage = async () => {
    if (!activeSession || !editingMessage) return;
    const runId = editingMessage.original.runId || "";
    await removeQueuedMessage(runId, editingMessage.messageIndex, "已取消这条排队消息");
    setEditingMessage(null);
    setComposer("");
    setAttachments([]);
    setActiveSkills([]);
  };

  // 立即执行：停下当前任务，这条排队消息插到队首马上运行
  // （主进程把它提到队首并取消当前任务，当前任务收尾时自动出队启动）
  const runQueuedMessageNow = async (entry: { message: ChatMessage; messageIndex: number }) => {
    if (!activeSession) return;
    const runId = entry.message.runId || "";
    // 用 ref 取最新排队状态，避免陈旧闭包导致点击被静默忽略
    if (!runId || !queuedRunsRef.current.get(activeSession.id)?.has(runId)) {
      setNotice("这条消息已不在排队中，无法立即执行");
      return;
    }
    // 先给即时反馈，避免主进程切换任务期间看起来像“没反应”
    setNotice("正在停下当前任务，马上执行这条消息…");
    try {
      const result = await window.dyworker?.runQueuedTaskNow({ sessionId: activeSession.id, runId });
      if (result?.ok) {
        setNotice("已停下当前任务，立即执行这条消息");
      } else {
        setNotice(result?.error || "这条消息已不在队列中");
      }
    } catch (error) {
      setNotice(`立即执行失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const renderSessionItem = (session: SessionRecord) => (
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
        <button className={`session-item ${session.id === activeId ? "active" : ""}`} onClick={() => selectSession(session)} title={session.title}>
          {session.pinned && <Pin size={12} className="pin-icon" />}
          {session.channel && (
            <span className={`session-channel-badge ${session.channel}`}>{session.channel === "qq" ? "QQ" : "微信"}</span>
          )}
          <span>{session.title}</span>
          {session.unread && <span className="session-unread-dot" role="status" aria-label="有新的完成结果" title="有新的完成结果" />}
          {runningSessionIds.has(session.id) && <LoaderCircle className="spin session-running-icon" size={15} />}
        </button>
      )}
      <button
        className="icon-button subtle tiny session-menu-button"
        aria-label="任务操作"
        onClick={(event) => {
          event.stopPropagation();
          setWorkspaceMenuPath(null);
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
  );

  const beginPanelResize = (edge: "left" | "right", event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    panelResizeRef.current = {
      edge,
      startX: event.clientX,
      startWidth: edge === "left" ? sidebarWidth : toolPanelWidth,
    };
    document.body.classList.add("resizing-panels");
  };

  const panelStyle = {
    "--sidebar-width": `${appliedSidebarWidth}px`,
    "--tool-panel-width": `${appliedToolPanelWidth}px`,
  } as CSSProperties;

  // 右侧面板菜单项（首页菜单页与 + 下拉菜单共用）。终端在底部打开，不改变面板内容，因此不关闭菜单页。
  const toolPanelMenuItems = [
    {
      key: "review",
      icon: <SquarePlus size={18} />,
      label: "审阅",
      shortcut: shortcutLabel("⌃⇧G", "Ctrl+Shift+G"),
      active: activeToolPanelKind === "review",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("review"); },
    },
    {
      key: "terminal",
      icon: <SquareTerminal size={18} />,
      label: "终端",
      shortcut: shortcutLabel("⌘J", "Ctrl+J"),
      active: debugOpen,
      visible: true,
      onClick: () => { setDebugOpen((value) => !value); },
    },
    {
      key: "browser",
      icon: <Globe size={18} />,
      label: "浏览器",
      shortcut: shortcutLabel("⌘T", "Ctrl+T"),
      active: activeToolPanelKind === "browser",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("browser"); },
    },
    {
      key: "files",
      icon: <FolderOpen size={18} />,
      label: "文件",
      shortcut: shortcutLabel("⌘P", "Ctrl+P"),
      active: activeToolPanelKind === "files",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("files"); },
    },
    {
      key: "side-chat",
      icon: <MessageSquarePlus size={18} />,
      label: "侧边聊天",
      shortcut: shortcutLabel("⌥⌘S", "Ctrl+Alt+S"),
      active: activeToolPanelKind === "chat",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("chat"); },
    },
    {
      key: "tasks",
      icon: <ListTree size={18} />,
      label: "后台任务",
      shortcut: "",
      active: activeToolPanelKind === "tasks",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("tasks"); },
    },
  ];

  const toolPanelMenu = (
    <div className="tool-panel-menu" role="menu">
      {toolPanelMenuItems.filter((item) => item.visible).map((item) => (
        <button
          role="menuitem"
          className={item.active ? "active" : ""}
          key={item.key}
          onClick={() => {
            // 终端在底部展开，面板保持菜单页不动（对照 Codex：点击终端后界面无变化）
            if (item.key !== "terminal") setToolPanelMenuOpen(false);
            item.onClick();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
          {item.key === "review" && reviewChanges.length > 0 && <small className="tool-panel-count">{reviewChanges.length}</small>}
          <span className="tool-panel-shortcut">{item.shortcut}</span>
        </button>
      ))}
    </div>
  );

  // + 按钮的下拉菜单（对照 Codex：已打开为标签页的类型不再出现，终端始终可选）
  const addMenuItems = toolPanelMenuItems.filter((item) => {
    if (item.key === "terminal") return true;
    const kind = item.key === "side-chat" ? "chat" : item.key;
    return !toolPanelTabs.some((tab) => tab.kind === kind);
  });
  const toolPanelAddMenu = toolPanelAddMenuOpen && (
    <div className="session-menu tool-panel-add-menu" role="menu">
      {addMenuItems.map((item) => (
        <button
          role="menuitem"
          className={item.active ? "active" : ""}
          key={item.key}
          onClick={() => {
            setToolPanelAddMenuOpen(false);
            item.onClick();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
          <span className="tool-panel-shortcut">{item.shortcut}</span>
        </button>
      ))}
    </div>
  );

  const taskMenu = (
    <div className="topbar-menu-wrap" data-menu-root>
      <button
        className="icon-button subtle"
        aria-label="任务操作"
        title="任务操作"
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
  );

  return (
    <div
      className={`app-shell platform-${platform || "linux"} ${sidebarOpen ? "" : "sidebar-collapsed"} ${rightPanelOpen ? "" : "right-panel-collapsed"}`}
      style={panelStyle}
    >
      <header className="titlebar" aria-label="标题栏">
        <div className="titlebar-left">
          <span className="titlebar-brand">DYWorker</span>
        </div>
        <div className="titlebar-right">
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
      <aside className="sidebar" aria-label="任务侧栏">
        <div className="native-controls-space" />
        <div className="sidebar-brand-row">
          <span className="brand-button" aria-label="DYWorker">
            <span>DYWorker</span>
          </span>
          <div className="sidebar-brand-actions">
            <button className="icon-button subtle" aria-label="搜索任务" onClick={() => setQuery((value) => value ? "" : " ")}>
              <Search size={18} />
            </button>
            <button
              className="icon-button subtle"
              aria-label="收起侧栏"
              title="收起侧栏"
              onClick={() => setSidebarOpen(false)}
            >
              <PanelLeftIcon size={18} />
            </button>
          </div>
        </div>

        <button className="new-task-button" onClick={() => createTask()}>
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
          {workspaceSessionGroups.workspaces.length > 0 && (
            <section className="sidebar-section workspace-session-section">
              <div className="workspace-session-list">
                {workspaceSessionGroups.workspaces.map((group) => {
                  const expanded = workspaceGroupOpen[group.path] ?? group.path === workspacePath;
                  return (
                    <div className={`workspace-session-group ${expanded ? "expanded" : ""} ${group.pinned ? "pinned" : ""}`} key={group.path} data-menu-root>
                      <div className="workspace-session-row">
                        <button
                          className="workspace-session-heading"
                          onClick={() => setWorkspaceGroupOpen((current) => ({ ...current, [group.path]: !expanded }))}
                          aria-expanded={expanded}
                          title={group.path}
                        >
                          {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
                          <span>{displayWorkspace(group.path)}</span>
                          {group.pinned && <Pin size={12} className="workspace-pin-indicator" aria-label="已置顶" />}
                        </button>
                        <div className="workspace-session-actions">
                          <button
                            className="icon-button subtle tiny"
                            aria-label={`${displayWorkspace(group.path)} 更多操作`}
                            title="更多操作"
                            aria-expanded={workspaceMenuPath === group.path}
                            onClick={() => {
                              setSessionMenuId(null);
                              setWorkspaceMenuPath((current) => current === group.path ? null : group.path);
                            }}
                          >
                            <MoreHorizontal size={15} />
                          </button>
                          <button
                            className="icon-button subtle tiny"
                            aria-label={`在 ${displayWorkspace(group.path)} 中新建对话`}
                            title="新建对话"
                            onClick={() => createTask(group.path)}
                          >
                            <SquarePen size={15} />
                          </button>
                        </div>
                      </div>
                      {workspaceMenuPath === group.path && (
                        <div className="session-menu workspace-menu" role="menu">
                          <button role="menuitem" onClick={() => toggleWorkspacePin(group.path)}>
                            <Pin size={15} />
                            <span>{group.pinned ? "取消置顶项目" : "置顶项目"}</span>
                          </button>
                          <button role="menuitem" onClick={() => void openWorkspaceInFileManager(group.path)}>
                            <FolderOpen size={15} />
                            <span>{fileManagerLabel}</span>
                          </button>
                        </div>
                      )}
                      {expanded && <div className="session-list workspace-session-items">{group.sessions.map(renderSessionItem)}</div>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="sidebar-section recent-section">
            <button
              className="recent-section-toggle"
              onClick={() => setWorkspaceGroupOpen((current) => ({ ...current, __recent__: !recentExpanded }))}
              aria-expanded={recentExpanded}
            >
              {recentExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>最近</span>
            </button>
            {recentExpanded && workspaceSessionGroups.recent.length ? (
              <div className="session-list">{workspaceSessionGroups.recent.map(renderSessionItem)}</div>
            ) : null}
            {sessions.some((session) => session.archived) && (
              <button className="archived-toggle" onClick={() => setShowArchived((value) => !value)}>
                {showArchived ? "隐藏归档任务" : `显示归档任务（${sessions.filter((session) => session.archived).length}）`}
              </button>
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

      {sidebarOpen && (
        <div
          className="panel-resize-handle panel-resize-left"
          role="separator"
          aria-label="调整左侧面板宽度"
          aria-orientation="vertical"
          onPointerDown={(event) => beginPanelResize("left", event)}
        />
      )}

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left no-drag">
            <button
              className="icon-button subtle sidebar-toggle"
              aria-label="展开侧栏"
              title="展开侧栏"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelRightIcon size={18} />
            </button>
            <Folder size={18} />
            <strong>{activeSession?.title || "新任务"}</strong>
            {taskMenu}
          </div>
          <div className="topbar-right no-drag">
            {gitInfo && (
              <div className="branch-menu-wrap" data-menu-root>
                <button
                  className={`branch-button ${branchMenuOpen || commitPanelOpen ? "active" : ""}`}
                  aria-label="分支管理"
                  title="分支管理与提交推送"
                  onClick={toggleBranchMenu}
                >
                  <GitBranch size={15} />
                  <span>{gitInfo.current}</span>
                  <ChevronDown size={13} />
                </button>
                {branchMenuOpen && (
                  <div className="branch-menu" role="menu" aria-label="分支管理">
                    <button className="branch-menu-action" role="menuitem" onClick={openCommitPanel}>
                      <GitCommitHorizontal size={16} />
                      <span>提交或推送</span>
                      {gitInfo.uncommitted > 0 && <small className="tool-panel-count">{gitInfo.uncommitted}</small>}
                    </button>
                    <div className="branch-search">
                      <Search size={14} />
                      <input
                        aria-label="搜索分支"
                        placeholder={`搜索 ${workspaceContext?.name || displayWorkspace(composerWorkspacePath)} 分支`}
                        value={branchQuery}
                        onChange={(event) => setBranchQuery(event.target.value)}
                      />
                    </div>
                    <div className="branch-list">
                      {gitInfo.branches
                        .filter((name) => !branchQuery.trim() || name.toLowerCase().includes(branchQuery.trim().toLowerCase()))
                        .map((name) => (
                          <button
                            className={`branch-item ${name === gitInfo.current ? "current" : ""}`}
                            role="menuitemradio"
                            aria-checked={name === gitInfo.current}
                            key={name}
                            disabled={gitBusy === "switch"}
                            onClick={() => void switchBranch(name)}
                          >
                            <GitBranch size={14} />
                            <span className="branch-item-name">{name}</span>
                            {name === gitInfo.current && (
                              <span className="branch-item-meta">未提交：{gitInfo.uncommitted} 个文件</span>
                            )}
                            {name === gitInfo.current && <Check size={15} />}
                          </button>
                        ))}
                      {gitInfo.branches.filter((name) => !branchQuery.trim() || name.toLowerCase().includes(branchQuery.trim().toLowerCase())).length === 0 && (
                        <div className="branch-empty">没有匹配的分支</div>
                      )}
                    </div>
                    {creatingBranch ? (
                      <div className="branch-create">
                        <input
                          autoFocus
                          aria-label="新分支名称"
                          placeholder="新分支名称，Enter 确认"
                          value={newBranchName}
                          onChange={(event) => setNewBranchName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void createBranch();
                            if (event.key === "Escape") { setCreatingBranch(false); setNewBranchName(""); }
                          }}
                        />
                        <button disabled={!newBranchName.trim() || gitBusy === "switch"} onClick={() => void createBranch()}>创建</button>
                      </div>
                    ) : (
                      <button className="branch-create-toggle" role="menuitem" onClick={() => setCreatingBranch(true)}>
                        <Plus size={14} />
                        <span>创建并检出新分支…</span>
                      </button>
                    )}
                  </div>
                )}
                {commitPanelOpen && (
                  <div className="commit-panel" role="dialog" aria-label="提交或推送">
                    <div className="commit-panel-branch">
                      <GitBranch size={15} />
                      <span>{gitInfo.current}</span>
                    </div>
                    <textarea
                      className="commit-message-input"
                      aria-label="提交信息"
                      placeholder="提交信息（留空将自动生成）"
                      rows={3}
                      value={commitMessage}
                      onChange={(event) => setCommitMessage(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void runCommit(true);
                      }}
                    />
                    <label className="commit-include-row">
                      <span className="commit-include-label">
                        <input
                          type="checkbox"
                          checked={includeUnstaged}
                          onChange={(event) => setIncludeUnstaged(event.target.checked)}
                        />
                        <span>包含未暂存的更改</span>
                      </span>
                      {diffStats && (diffStats.added > 0 || diffStats.removed > 0) && (
                        <span className="commit-diff-stats">
                          <span className="diff-added">+{diffStats.added.toLocaleString()}</span>
                          <span className="diff-removed">-{diffStats.removed.toLocaleString()}</span>
                        </span>
                      )}
                    </label>
                    <div className="commit-actions">
                      <button disabled={Boolean(gitBusy)} onClick={() => void runCommit(false)}>
                        <GitCommitHorizontal size={15} />
                        <span>{gitBusy === "commit" ? "提交中…" : "提交"}</span>
                      </button>
                      <button className="commit-primary" disabled={Boolean(gitBusy)} onClick={() => void runCommit(true)}>
                        <Upload size={15} />
                        <span>{gitBusy === "commit-push" ? "提交并推送中…" : "提交并推送"}</span>
                        <kbd>{platform === "darwin" ? "⌘↩" : "Ctrl+↩"}</kbd>
                      </button>
                      <button disabled={Boolean(gitBusy) || !gitInfo.hasRemote} title={gitInfo.hasRemote ? "推送当前分支到远程" : "当前仓库没有配置远程"} onClick={() => void runPushOnly()}>
                        <Upload size={15} />
                        <span>{gitBusy === "push" ? "推送中…" : "推送"}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
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
              aria-label="轨迹控制台"
              title="轨迹控制台：按轮次/步骤查看模型请求、工具调用、活动与文件变更的完整时间线（可回放历史）"
              onClick={() => setDebugOpen((value) => !value)}
            >
              <Terminal size={17} />
            </button>
            {!rightPanelOpen && (
              <button
                className="icon-button subtle tool-panel-toggle"
                aria-label="展开右侧工具栏"
                title="展开右侧工具栏"
                onClick={() => {
                  setRightPanelOpen(true);
                  // 还没有任何标签页时展示菜单页，由用户决定打开什么（对照 Codex）
                  setToolPanelMenuOpen(toolPanelTabs.length === 0);
                }}
              >
                <PanelRightIcon size={18} />
              </button>
            )}
          </div>
        </header>

        {conversationTurns.length > 5 && (
          <nav className="conversation-turn-rail" aria-label="对话回合导航">
            {conversationTurns.map((turn, turnIndex) => {
              const turnActive = turnIndex === hoveredTurnIndex
                || (hoveredTurnIndex === null && turnIndex === conversationTurns.length - 1);
              const waveDistance = hoveredTurnIndex === null
                ? null
                : Math.min(Math.abs(turnIndex - hoveredTurnIndex), 3);
              return (
                <div className="conversation-turn-marker-wrap" key={`${turn.messageIndex}-${turnIndex}`}>
                  <button
                    type="button"
                    className={`conversation-turn-marker${waveDistance === null ? "" : ` wave-distance-${waveDistance}`}`}
                    aria-label={`第 ${turnIndex + 1} 轮对话：${turn.preview.title}`}
                    aria-current={turnActive ? "step" : undefined}
                    aria-describedby={hoveredTurnIndex === turnIndex ? `conversation-turn-preview-${turnIndex}` : undefined}
                    onClick={() => jumpToConversationTurn(turnIndex)}
                    onMouseEnter={() => setHoveredTurnIndex(turnIndex)}
                    onMouseLeave={() => setHoveredTurnIndex(null)}
                    onFocus={() => setHoveredTurnIndex(turnIndex)}
                    onBlur={() => setHoveredTurnIndex(null)}
                  />
                  {hoveredTurnIndex === turnIndex && (
                    <div
                      id={`conversation-turn-preview-${turnIndex}`}
                      className="conversation-turn-preview"
                      role="tooltip"
                    >
                      <strong>{turn.preview.title}</strong>
                      <span>{turn.preview.detail}</span>
                      <small>第 {turnIndex + 1} 轮对话</small>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        )}

        <div className="conversation-viewport" ref={viewportRef} onScroll={syncAtBottom}>
          <div className="conversation-column">
            {!activeSession?.messages.length ? (
              <div className="empty-conversation">
                <span className="empty-mark"><Sparkles size={25} /></span>
                <h1>从一个工作任务开始</h1>
                <p>{workspacePath
                  ? "选择工作文件夹，然后告诉 DYWorker 你希望完成什么。"
                  : "还没有工作文件夹也能先提问；需要读取或保存文件时，先选择工作文件夹。"}</p>
                <button className="button-secondary" onClick={() => void chooseWorkspace()}>
                  <FolderOpen size={16} />
                  选择工作文件夹
                </button>
              </div>
            ) : (
              activeSession.messages.map((message, index) => {
                const turnIndex = message.role === "user"
                  ? conversationTurns.findIndex((turn) => turn.messageIndex === index)
                  : -1;
                const isEditing = editingMessage?.sessionId === activeSession.id && editingMessage.messageIndex === index;
                // 排队中的消息（含其空助手占位）不渲染在对话流里，统一收在输入框上方的队列卡片（对照 Codex）
                const isQueuedMessage = Boolean(message.runId && queuedRunIds.has(message.runId));
                if (isQueuedMessage) return null;
                // 仍在输出中的助手消息（没有终态 taskStatus）不显示时间/复制行；
                // 不能按最后一条下标判断——后面可能跟着排队占位消息
                const hideAssistantActions = message.role === "assistant"
                  && activeTaskRunning
                  && !message.taskStatus
                  && index === streamingAssistantIndex;
                return (
                <div
                  className={`message-row ${message.role}`}
                  key={`${message.createdAt}-${index}`}
                  ref={message.role === "user" ? (node) => { conversationTurnRefs.current[turnIndex] = node; } : undefined}
                >
                  {message.role === "system" ? null : message.role === "user" ? (
                    <>
                      <div className="user-message-stack">
                        <div
                          className={`user-bubble${isEditing ? " editing" : ""}`}
                          onContextMenu={handleMessageContextMenu}
                        >
                        {Boolean(message.skillsUsed?.length || message.attachments?.some((attachment) => !attachment.isImage)) && (
                          <span className="message-inline-refs">
                            {message.skillsUsed?.map((name) => (
                              <span key={`${message.createdAt}-${name}`} className="ref-chip" title={`引用技能 /${name}`}>
                                <Package size={13} />
                                <span>{name}</span>
                              </span>
                            ))}
                            {message.attachments?.filter((attachment) => !attachment.isImage).map((attachment) => (
                              <span key={`${message.createdAt}-${attachment.path}`} className="ref-chip" title={attachment.path}>
                                {/\.[cm]?[jt]sx?$/i.test(attachment.name) ? <FileCode2 size={13} /> : <FileText size={13} />}
                                <span>{attachment.name}</span>
                              </span>
                            ))}
                          </span>
                        )}
                        <ClampedUserText text={messageVisibleText(message)} />
                        {Boolean(message.attachments?.some((attachment) => attachment.isImage)) && (
                          <div className="message-attachments">
                            {message.attachments?.filter((attachment) => attachment.isImage).map((attachment) => (
                              attachment.isImage && attachment.previewUrl ? (
                                <figure
                                  className="message-attachment-image clickable"
                                  key={`${message.createdAt}-${attachment.path}`}
                                  aria-label="图片附件，点击预览"
                                  role="button"
                                  tabIndex={0}
                                  title="点击预览图片"
                                  onClick={() => setImagePreview({ url: attachment.previewUrl!, name: attachment.name || "图片" })}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      setImagePreview({ url: attachment.previewUrl!, name: attachment.name || "图片" });
                                    }
                                  }}
                                >
                                  <img className="attachment-preview-image" src={attachment.previewUrl} alt="上传的图片" />
                                </figure>
                              ) : (
                                <span key={`${message.createdAt}-${attachment.path}`}>
                                  <FileImage size={13} />
                                  图片
                                </span>
                              )
                            ))}
                          </div>
                        )}
                        </div>
                        <div className="message-actions user" aria-label="用户消息操作">
                          <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                          <button type="button" onClick={() => void copyMessage(message)} aria-label="复制消息" title="复制消息">
                            <Copy size={16} />
                          </button>
                          {!activeTaskRunning && (
                            <button type="button" onClick={() => startMessageEdit(message, index)} aria-label="编辑消息" title="编辑消息">
                              <Pencil size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="assistant-message" onContextMenu={handleMessageContextMenu}>
                      {Boolean(completedPlanForMessage(message)?.length) && <PlanCard steps={completedPlanForMessage(message)!} />}
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
                        const commandOnly = visibleActivities.every((activity) => activity.kind === "run_command");
                        return (
                          <>
                            <button
                              className={`activity-divider clickable ${commandOnly ? "command-summary" : ""}`}
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
                              {commandOnly && <SquareTerminal className="activity-summary-icon" size={16} />}
                              {!commandOnly && (collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />)}
                              <span className="activity-summary-label">
                                {commandOnly ? "运行了命令" : "已处理"}
                                {duration ? ` · 用时 ${duration}` : ""}
                                {collapsed ? ` · ${visibleActivities.length} 步` : ""}
                              </span>
                              {commandOnly && (collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />)}
                            </button>
                            {!collapsed && <ActivityList activities={visibleActivities} />}
                          </>
                        );
                      })()}
                      {Boolean(message.changes?.length) && (
                        <ChangesSummary
                          changes={message.changes!}
                          workspacePath={activeSession.workspacePath || workspacePath}
                          onOpenReview={(changes) => {
                            // 在右侧审阅窗口打开这条消息的文件改动（对照 Codex「查看更改」）
                            setReviewFocusChanges(changes);
                            setRightPanelOpen(true);
                            openToolPanelTab("review");
                          }}
                        />
                      )}
                      {message.content && <InteractiveMessage content={stripControlMarkers(message.content)} />}
                      {(() => {
                        if (!message.runId) return null;
                        let prevUserIndex = -1;
                        for (let i = index - 1; i >= 0; i--) {
                          if (activeSession.messages[i].role === "user") { prevUserIndex = i; break; }
                        }
                        const prevUser = prevUserIndex >= 0 ? activeSession.messages[prevUserIndex] : null;
                        const runEvents = runTraceEventsRef.current.get(message.runId) || [];
                        return (
                          <MessageProcessTrace
                            events={runEvents}
                            request={prevUser?.displayContent || prevUser?.content || ""}
                            durationMs={message.durationMs}
                            onLocateMessage={() => {
                              if (prevUserIndex < 0) return;
                              const turn = conversationTurns.find((entry) => entry.messageIndex === prevUserIndex);
                              if (turn) conversationTurnRefs.current[conversationTurns.indexOf(turn)]?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }}
                            onOpenReview={(changes) => {
                              setReviewFocusChanges(changes);
                              setRightPanelOpen(true);
                              openToolPanelTab("review");
                            }}
                            onLocateLog={() => setDebugOpen(true)}
                          />
                        );
                      })()}
                      {!hideAssistantActions && (
                        <div className="message-actions assistant" aria-label="助手消息操作">
                          <button type="button" onClick={() => void copyMessage(message)} aria-label="复制消息" title="复制消息">
                            <Copy size={16} />
                          </button>
                          <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })
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
          <TraceConsole
            traces={traceEvents}
            logs={debugLogs}
            sessionId={activeSession?.id}
            onClear={() => {
              traceEventsRef.current = [];
              setTraceEvents([]);
              runTraceEventsRef.current.clear();
              setDebugLogs([]);
            }}
            onClose={() => setDebugOpen(false)}
            onAppendTraces={appendSessionTraces}
          />
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

        {imagePreview && (
          <div
            className="image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`图片预览：${imagePreview.name}`}
            onClick={() => setImagePreview(null)}
          >
            <img src={imagePreview.url} alt={imagePreview.name} onClick={(event) => event.stopPropagation()} />
            <button
              type="button"
              className="image-lightbox-close"
              onClick={() => setImagePreview(null)}
              aria-label="关闭预览"
              title="关闭（Esc）"
            >
              <X size={18} />
            </button>
          </div>
        )}

        <div className="composer-dock" ref={composerDockRef}>
          {(error || activeSessionError) && <div className="status-toast error" role="alert">{error || activeSessionError}</div>}
          {(notice || activeSessionNotice) && (
            <div className="status-toast" role="status">{notice || activeSessionNotice}</div>
          )}
          <div
            className={`composer-card ${composerDragActive ? "drag-over" : ""}`}
            onDragOver={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
          >
            {activeTaskRunning && activeQueuedMessages.length > 0 && (
              <div className="queue-card" role="status" aria-label="排队中的消息">
                {activeQueuedMessages.map((entry) => (
                  <div className="queue-card-row" key={entry.message.runId}>
                    <CornerUpLeft size={14} className="queue-card-icon" />
                    <span className="queue-card-text" title={messageVisibleText(entry.message)}>
                      {messageVisibleText(entry.message)}
                    </span>
                    <span className="queue-card-actions">
                      <button
                        type="button"
                        className="queue-card-steer"
                        onClick={() => void runQueuedMessageNow(entry)}
                        title="停下当前任务，立即执行这条消息"
                      >
                        <Play size={13} />
                        立即执行
                      </button>
                      <button
                        type="button"
                        className="icon-button subtle tiny"
                        onClick={() => void removeQueuedMessage(entry.message.runId || "", entry.messageIndex)}
                        aria-label="删除这条排队消息"
                        title="删除这条排队消息"
                      >
                        <Trash2 size={14} />
                      </button>
                      <span className="queue-card-more-wrap" data-menu-root>
                        <button
                          type="button"
                          className="icon-button subtle tiny"
                          onClick={() => setQueueMenuRunId((current) => current === entry.message.runId ? null : entry.message.runId || null)}
                          aria-label="排队消息更多操作"
                          title="更多操作"
                          aria-expanded={queueMenuRunId === entry.message.runId}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {queueMenuRunId === entry.message.runId && (
                          <div className="session-menu queue-card-menu" role="menu">
                            <button
                              role="menuitem"
                              onClick={() => {
                                setQueueMenuRunId(null);
                                // 原地编辑：保持排队位置，开始执行时按新内容运行
                                startMessageEdit(entry.message, entry.messageIndex);
                              }}
                            >
                              编辑内容（保持排队位置）
                            </button>
                            <button
                              role="menuitem"
                              onClick={() => {
                                setQueueMenuRunId(null);
                                void copyMessage(entry.message);
                              }}
                            >
                              复制内容
                            </button>
                          </div>
                        )}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {showComposerContext && (
              <div className="composer-context" aria-label="当前工作上下文">
                <div className="context-folder-wrap">
                  <button
                    type="button"
                    className="context-folder-clear"
                    onClick={clearWorkspace}
                    aria-label="移除当前工作目录"
                    title="不在项目中工作"
                  >
                    <X size={13} strokeWidth={2.4} />
                    <span className="workspace-clear-tooltip" role="tooltip">不在项目中工作</span>
                  </button>
                  <button
                    type="button"
                    className="context-folder-chip"
                    onClick={() => void chooseWorkspace()}
                    title={composerWorkspacePath}
                  >
                    <span>{workspaceContext?.name || displayWorkspace(composerWorkspacePath)}</span>
                  </button>
                </div>
                {workspaceContext?.branch && (
                  <span className="composer-context-item">
                    <GitBranch size={17} />
                    <span>{workspaceContext.branch}</span>
                  </span>
                )}
              </div>
            )}
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
            {editingMessage?.sessionId === activeSession?.id && (
              <div className="message-editing-banner" role="status">
                <Pencil size={13} />
                <span>正在编辑：{shortTitle(messageVisibleText(editingMessage.original))}</span>
                {editingMessage.original.runId && queuedRunIds.has(editingMessage.original.runId) && (
                  <button type="button" className="danger" onClick={() => void cancelQueuedMessage()}>取消排队</button>
                )}
                <button type="button" onClick={cancelMessageEdit}>取消编辑</button>
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
            <div
              className={`attachment-strip${Boolean(activeSkills.length || attachments.length) ? " has-refs" : ""}`}
              aria-label={Boolean(activeSkills.length || attachments.length) ? `已选择 ${activeSkills.length + attachments.length} 项` : undefined}
            >
              {activeSkills.map((skill) => (
                <span className="attachment-chip ref-attachment-chip" key={skill.id}>
                  <Package size={14} />
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
                <span
                  className={`attachment-chip${attachment.isImage && attachment.previewUrl ? " image-attachment-chip" : " ref-attachment-chip"}`}
                  key={attachment.path}
                >
                  {attachment.isImage && attachment.previewUrl
                    ? (
                      <img
                        className="attachment-preview-image clickable"
                        src={attachment.previewUrl}
                        alt="待发送的图片，点击预览"
                        title="点击预览图片"
                        onClick={() => setImagePreview({ url: attachment.previewUrl!, name: attachment.name || "图片" })}
                      />
                    )
                    : attachment.isImage
                      ? <FileImage size={14} />
                      : /\.[cm]?[jt]sx?$/i.test(attachment.name) ? <FileCode2 size={14} /> : <FileText size={14} />}
                  {!(attachment.isImage && attachment.previewUrl) && (
                    <span title={attachment.path}>{attachment.isImage ? "图片" : attachment.name}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((item) => item.path !== attachment.path))}
                    aria-label={`移除附件 ${attachment.name}`}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
              <textarea
                ref={textareaRef}
                value={composer}
                onChange={(event) => updateComposer(event.target.value)}
                onPaste={(event) => void handleComposerPaste(event)}
                onContextMenu={handleComposerContextMenu}
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
            </div>
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
                    <span>{hasModel ? settings.model : "配置模型"}</span>
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
                            onClick={() => selectApprovalMode(option.value)}
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
                {/* 对照 Codex：运行中且没有可发送内容时，发送键变成停止键，只保留一个圆形按钮；
                    输入框有内容时仍是发送键（点击后消息进入队列） */}
                {activeTaskRunning && !canSend ? (
                  <button
                    className="send-button stop"
                    onClick={() => {
                      if (!activeSession) return;
                      const runId = runningRunIdsRef.current.get(activeSession.id);
                      if (runId) void window.dyworker?.cancelTask(activeSession.id, runId);
                    }}
                    aria-label="停止当前任务"
                    title="停止当前任务（排队中的消息仍会继续执行）"
                  >
                    <Square size={14} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    onClick={() => void sendMessage()}
                    disabled={!canSend}
                    aria-label={editingMessage ? "重新发送" : "发送"}
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

      {rightPanelOpen && (
        <div
          className="panel-resize-handle panel-resize-right"
          role="separator"
          aria-label="调整右侧面板宽度"
          aria-orientation="vertical"
          onPointerDown={(event) => beginPanelResize("right", event)}
        />
      )}

      <aside className={`tool-panel ${activeToolPanelKind === "browser" ? "browser-mode" : ""}`} aria-label="右侧工具栏">
        <div className="tool-panel-tabs" role="tablist" aria-label="打开的文件和网页">
          {!pristineMenuPage && toolPanelTabs.map((tab) => (
            <div className={`tool-panel-tab ${tab.id === activeToolPanelTabId ? "active" : ""}`} key={tab.id} role="presentation">
              <button
                className="tool-panel-tab-main"
                role="tab"
                aria-selected={tab.id === activeToolPanelTabId}
                onClick={() => focusToolPanelTab(tab.id)}
                title={tab.title}
              >
                {tab.kind === "browser" ? <Globe size={16} /> : tab.kind === "review" ? <SquarePlus size={16} /> : tab.kind === "chat" ? <MessageSquarePlus size={16} /> : <FolderOpen size={16} />}
                <span>{tab.title}</span>
              </button>
              <button className="tool-panel-tab-close" aria-label={`关闭${tab.title}`} onClick={(event) => { event.stopPropagation(); closeToolPanelTab(tab.id); }}>
                <X size={14} />
              </button>
            </div>
          ))}
          {!pristineMenuPage && (
            <div className="tool-panel-add-wrap" data-menu-root>
              <button
                className={`tool-panel-new-tab ${toolPanelAddMenuOpen ? "active" : ""}`}
                aria-label="打开侧边操作"
                title="打开侧边操作"
                aria-expanded={toolPanelAddMenuOpen}
                onClick={() => setToolPanelAddMenuOpen((value) => !value)}
              >
                <Plus size={18} />
              </button>
              {toolPanelAddMenu}
            </div>
          )}
          <div className="tool-panel-header-actions tool-panel-tabs-actions" data-menu-root>
            <button
              className="icon-button subtle"
              aria-label="收起右侧工具栏"
              title="收起右侧工具栏"
              onClick={() => setRightPanelOpen(false)}
            >
              <PanelRightIcon size={18} />
            </button>
          </div>
        </div>
        <div className={`tool-panel-scroll ${activeToolPanelKind === "browser" && !menuPageShown ? "browser-scroll" : ""}`}>
          {menuPageShown && <div className="tool-panel-menu-page" data-menu-root>{toolPanelMenu}</div>}
          {!menuPageShown && activeToolPanelTab && activeToolPanelKind === "browser" && (
            <section className="browser-panel">
              <div className="browser-toolbar">
                <button className="browser-toolbar-button" aria-label="后退" onClick={() => browserWebviewRef.current?.goBack?.()} disabled={!activeToolPanelTab?.loadedUrl}>
                  <ChevronRight size={17} className="browser-back-icon" />
                </button>
                <button className="browser-toolbar-button" aria-label="前进" onClick={() => browserWebviewRef.current?.goForward?.()} disabled={!activeToolPanelTab?.loadedUrl}>
                  <ChevronRight size={17} />
                </button>
                <button className="browser-toolbar-button" aria-label="刷新" onClick={() => browserWebviewRef.current?.reload?.()} disabled={!activeToolPanelTab?.loadedUrl}>
                  <RefreshCw size={16} />
                </button>
                <div className="browser-url-wrap">
                  <input
                    className="browser-url-input"
                    placeholder="输入 URL"
                    aria-label="网页地址"
                    list="browser-history-suggestions"
                    value={activeBrowserUrl}
                    onChange={(event) => activeToolPanelTab && updateToolPanelTab(activeToolPanelTab.id, { url: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void openBrowserUrl();
                    }}
                    disabled={browserOpening}
                  />
                  <datalist id="browser-history-suggestions">
                    {importedHistory.slice(0, 500).map((entry) => (
                      <option value={entry.url} key={entry.url}>{entry.title || entry.url}</option>
                    ))}
                  </datalist>
                  <button
                    className="browser-url-submit"
                    aria-label="打开网页"
                    title="打开网页"
                    onClick={() => void openBrowserUrl()}
                    disabled={browserOpening}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="browser-more-wrap" data-menu-root>
                  <button
                    className={`browser-toolbar-more ${browserMoreOpen ? "active" : ""}`}
                    aria-label="浏览器更多操作"
                    title="更多操作"
                    aria-expanded={browserMoreOpen}
                    onClick={() => setBrowserMoreOpen((value) => !value)}
                  >
                    <MoreVertical size={16} />
                  </button>
                  {browserMoreOpen && (
                    <div className="session-menu browser-more-menu" role="menu">
                      {/* <button role="menuitem" disabled title="暂未实现">在页面中查找</button>
                      <button role="menuitem" disabled title="暂未实现">打印</button>
                      <div className="browser-more-sep" />
                      <div className="browser-more-zoom" aria-label="缩放（暂未实现）">
                        <span>缩放</span>
                        <span className="browser-more-zoom-controls">
                          <button disabled title="暂未实现">−</button>
                          <span>100%</span>
                          <button disabled title="暂未实现">＋</button>
                        </span>
                      </div>
                      <button role="menuitem" disabled title="暂未实现">显示设备工具栏</button>
                      <button role="menuitem" disabled title="暂未实现">截取屏幕截图</button>
                      <div className="browser-more-sep" /> */}
                      <button role="menuitem" onClick={() => { setBrowserMoreOpen(false); setImportDialogOpen(true); }}>导入 Cookie 和密码…</button>
                      {/* <button role="menuitem" disabled title="暂未实现">密码和自动填充</button>
                      <button role="menuitem" disabled title="暂未实现">下载</button>
                      <button role="menuitem" disabled title="暂未实现">历史记录</button>
                      <button role="menuitem" disabled title="暂未实现">清除浏览数据</button>
                      <div className="browser-more-sep" />
                      <button role="menuitem" disabled title="暂未实现">浏览器设置</button> */}
                    </div>
                  )}
                </div>
              </div>
              <div className="browser-content">
                {activeToolPanelTab?.loadedUrl ? (
                  createElement("webview", {
                    key: activeToolPanelTab.id,
                    ref: (node: BrowserWebviewElement | null) => { browserWebviewRef.current = node; },
                    className: "browser-webview",
                    src: activeToolPanelTab.loadedUrl,
                    partition: "persist:dyworker-browser",
                    title: activeToolPanelTab.title,
                    allowpopups: false,
                  })
                ) : (
                  <div className="browser-empty-state">
                    <Globe size={46} />
                    <strong>开始浏览</strong>
                    <span>输入 URL 以打开页面</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {!menuPageShown && activeToolPanelKind === "files" && (
            <section className="tool-file-browser file-split-panel">
              <FilesSplitPanel
                workspacePath={workspacePath}
                workspaceEntries={workspaceEntries}
                workspaceOpen={workspaceOpen}
                onRefresh={() => void refreshWorkspace()}
                onClearWorkspace={clearWorkspace}
                onError={setError}
                onNotice={setNotice}
                onInsertFile={addWorkspaceFile}
              />
            </section>
          )}

          {!menuPageShown && activeToolPanelKind === "chat" && (
            <SideChatPanel settings={settings} />
          )}

          {!menuPageShown && activeToolPanelKind === "tasks" && (
            <section className="tool-panel-tasks">
              <BackgroundTasksPanel
                traces={activeSessionTraceEvents}
                sessionTitle={activeSession?.title}
                running={Boolean(activeSession?.id && runningSessionIds.has(activeSession.id))}
                onCancel={() => {
                  const sessionId = activeSession?.id;
                  if (!sessionId) return;
                  const runId = runningRunIdsRef.current.get(sessionId);
                  if (runId && window.dyworker?.cancelTask) {
                    void window.dyworker.cancelTask(sessionId, runId);
                    setNotice("已请求终止当前任务");
                  }
                }}
                onOpenConsole={() => setDebugOpen(true)}
              />
            </section>
          )}

          {!menuPageShown && activeToolPanelKind === "review" && (
            <section className="review-panel">
              {(activeSession?.workspacePath || workspacePath) ? (
                <GitReviewPanel
                  workspacePath={activeSession?.workspacePath || workspacePath}
                  fallbackChanges={reviewFocusChanges || reviewChanges}
                />
              ) : (reviewFocusChanges || reviewChanges).length ? (
                <ReviewPanel
                  key={`${(reviewFocusChanges || reviewChanges).length}-${(reviewFocusChanges || reviewChanges)[0].path}`}
                  changes={reviewFocusChanges || reviewChanges}
                  workspacePath=""
                />
              ) : (
                <div className="browser-empty-state">
                  <FileDiff size={46} />
                  <strong>审阅改动</strong>
                  <span>选择工作文件夹后，在这里按 Git 基线逐文件审阅改动</span>
                </div>
              )}
            </section>
          )}
        </div>
      </aside>

      {importDialogOpen && (
        <BrowserImportDialog
          onClose={() => setImportDialogOpen(false)}
          onDone={(message) => {
            setNotice(message);
            refreshImportedHistory();
            // 已打开的页面仍带着旧（未登录）状态，导入后刷新一次让新 Cookie 生效
            browserWebviewRef.current?.reload?.();
          }}
          onError={(message) => setError(message)}
        />
      )}

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
          currentWorkspacePath={workspacePath}
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
          appUpdate={appUpdate}
          onCheckUpdate={openAppUpdateDialog}
        />
      )}
      {appUpdateDialogOpen && (
        <AppUpdateDialog
          status={appUpdate}
          onClose={() => setAppUpdateDialogOpen(false)}
          onCheck={() => void checkAppUpdate()}
          onDownload={downloadAppUpdate}
          onInstall={installAppUpdate}
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
      {fullAccessDialogOpen && (
        <FullAccessDialog
          onClose={() => setFullAccessDialogOpen(false)}
          onConfirm={confirmFullAccess}
        />
      )}
      {identitySetupOpen && <IdentitySetupDialog onChoose={chooseIdentity} />}
      {contextMenu && <ContextMenuPopup menu={contextMenu} onClose={closeContextMenu} />}
    </div>
  );
}

type ContextMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
};

// 全局右键菜单：点击外部、滚动、失焦或按 Esc 时关闭，位置自动贴边
function ContextMenuPopup({
  menu,
  onClose,
}: {
  menu: { x: number; y: number; items: ContextMenuItem[] };
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const onDismiss = () => onClose();
    window.addEventListener("wheel", onDismiss, { passive: true });
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onDismiss);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onClose]);

  const MENU_WIDTH = 176;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8));
  const estimatedHeight = 40 + menu.items.length * 34;
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - estimatedHeight - 8));

  return (
    <div
      ref={popupRef}
      className="context-menu"
      role="menu"
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.items.map((item) => (
        <button
          type="button"
          key={item.key}
          role="menuitem"
          className="context-menu-item"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
