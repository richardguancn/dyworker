// 应用级客户端插件宿主单例。
// 单独放一个文件，避免 index.ts 与界面组件互相 import 形成环。

import { ClientPluginHost } from "./clientHost.ts";

let current: ClientPluginHost | null = null;

/** 插件要求打开右侧面板标签的订阅（壳层订阅它来开标签） */
const panelHandlers = new Set<(kind: string, detail?: unknown) => void>();

export function onPanelOpenRequest(handler: (kind: string, detail?: unknown) => void): () => void {
  panelHandlers.add(handler);
  return () => panelHandlers.delete(handler);
}

/** 插件要求跳转会话的订阅（壳层订阅它去切 activeSession） */
const sessionHandlers = new Set<(sessionId: string) => void>();

export function onOpenSessionRequest(handler: (sessionId: string) => void): () => void {
  sessionHandlers.add(handler);
  return () => sessionHandlers.delete(handler);
}

/** 插件请求弹出应用级提示条（Toast）的订阅 */
const notifyHandlers = new Set<(message: string) => void>();

export function onNotifyRequest(handler: (message: string) => void): () => void {
  notifyHandlers.add(handler);
  return () => notifyHandlers.delete(handler);
}

/** 插件请求打开设置页并切换到指定分区的订阅 */
const settingsHandlers = new Set<(tabId: string) => void>();

export function onOpenSettingsRequest(handler: (tabId: string) => void): () => void {
  settingsHandlers.add(handler);
  return () => settingsHandlers.delete(handler);
}

/** 取（必要时创建）客户端插件宿主 */
export function clientHost(): ClientPluginHost {
  if (!current) {
    current = new ClientPluginHost({
      onPanelRequest: (kind, detail) => {
        for (const handler of panelHandlers) handler(kind, detail);
      },
      onOpenSession: (sessionId) => {
        for (const handler of sessionHandlers) handler(sessionId);
      },
      onNotify: (message) => {
        for (const handler of notifyHandlers) handler(message);
      },
      onOpenSettings: (tabId) => {
        for (const handler of settingsHandlers) handler(tabId);
      },
    });
  }
  return current;
}

/** 测试用：丢弃单例 */
export function resetClientHost(): void {
  current = null;
}
