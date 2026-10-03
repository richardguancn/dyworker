// 应用级客户端插件宿主单例。
// 单独放一个文件，避免 index.ts 与界面组件互相 import 形成环。

import { ClientPluginHost } from "./clientHost.ts";

let current: ClientPluginHost | null = null;

/** 取（必要时创建）客户端插件宿主 */
export function clientHost(): ClientPluginHost {
  if (!current) current = new ClientPluginHost();
  return current;
}

/** 测试用：丢弃单例 */
export function resetClientHost(): void {
  current = null;
}
