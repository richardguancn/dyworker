// 跨模块共享的模块级 ref。
//
// 这几个 ref 原本在 App.tsx 内用 useRef 声明，随会话辅助函数一起搬到模块级 actions
// 后必须保证「同一实例」——App 的清理 effect、IPC 订阅运行时与 actions 三处读写都要
// 指向同一份数据，因此抽成普通 `{ current: … }` 对象（模块只求值一次，天然单例）。
import type { WakingSessionEntry } from "./sessionStore";

// 事件回调里要读"当前正在续跑的会话"做气泡收口，同时保持 setState updater 纯净
export const wakingSessionsRef: { current: Record<string, WakingSessionEntry> } = { current: {} };
export const sessionNoticeTimersRef: { current: Map<string, number> } = { current: new Map() };
export const sessionErrorTimersRef: { current: Map<string, number> } = { current: new Map() };
