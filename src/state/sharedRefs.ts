// 跨模块共享的模块级 ref。
//
// 这几个 ref 原本在 App.tsx 内用 useRef 声明，随会话辅助函数一起搬到模块级 actions
// 后必须保证「同一实例」——App 的清理 effect、IPC 订阅运行时与 actions 三处读写都要
// 指向同一份数据，因此抽成普通 `{ current: … }` 对象（模块只求值一次，天然单例）。
import type { Attachment, MessageAnnotation, SessionRecord } from "../types";
import type { BrowserWebviewElement } from "../features/browser/browserUtils";
import type { ComposerPasteBlock } from "./composerStore";
import type { ToolPanelTab } from "./layoutStore";
import type { WakingSessionEntry } from "./sessionStore";
import { previewSessions } from "./previewData";

// 事件回调里要读"当前正在续跑的会话"做气泡收口，同时保持 setState updater 纯净
export const wakingSessionsRef: { current: Record<string, WakingSessionEntry> } = { current: {} };
export const sessionNoticeTimersRef: { current: Map<string, number> } = { current: new Map() };
export const sessionErrorTimersRef: { current: Map<string, number> } = { current: new Map() };
// 会话列表快照 ref：渠道实时事件监听器（注册一次、长期存活）需要读取最新会话，
// 用 ref 避免闭包捕获到旧的 sessions 状态
export const sessionsRef: { current: SessionRecord[] } = { current: previewSessions };
export const sessionRenameRequestsRef: { current: Map<string, {title:string;token:symbol}> } = { current: new Map() };
export const sessionDraftsRef: { current: Record<string, { text: string; pastes: ComposerPasteBlock[]; annotations: MessageAnnotation[]; attachments: Attachment[] }> } = { current: {} };

// 当前活动会话镜像：App 每次渲染写入，browserActions 上报页面归属时读取
export const activeIdRef: { current: string } = { current: previewSessions[0].id };

// 浏览器面板：每个标签页常驻一个 webview、以及按 tabId 缓存的 ref 回调
export const browserWebviewsRef: { current: Map<string, BrowserWebviewElement> } = { current: new Map() };
export const browserWebviewRefCallbacks: { current: Map<string, (node: BrowserWebviewElement | null) => void> } = { current: new Map() };
// 浏览器「继续交给助手」广播去抖，避免同一次恢复被重复处理
export const browserResumeGuardRef: { current: boolean } = { current: false };

// 面板标签页序号，以及当前标签 / 标签列表的渲染镜像（App 每次渲染刷新，模块函数读取）
export const toolPanelTabSequenceRef: { current: number } = { current: 1 };
export const activeToolPanelTabIdRef: { current: string } = { current: "" };
export const toolPanelTabsRef: { current: ToolPanelTab[] } = { current: [] };
export const closeToolPanelTabRef: { current: ((id: string) => void) | null } = { current: null };

// 打开文件预览：由 toolPanelActions 模块初始化后指向真正的实现
export const openFilePreviewRef: { current: (filePath: string, root: string) => void } = { current: () => {} };
