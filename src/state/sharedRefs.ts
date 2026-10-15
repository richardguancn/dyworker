// 跨模块共享的模块级 ref。
//
// 这几个 ref 原本在 App.tsx 内用 useRef 声明，随会话辅助函数一起搬到模块级 actions
// 后必须保证「同一实例」——App 的清理 effect、IPC 订阅运行时与 actions 三处读写都要
// 指向同一份数据，因此抽成普通 `{ current: … }` 对象（模块只求值一次，天然单例）。
import type { Attachment, MessageAnnotation, SessionRecord } from "../types";
import type { ComposerPasteBlock } from "./composerStore";
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
