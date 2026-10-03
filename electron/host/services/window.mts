// 契约服务 ctx.window：插件访问桌面壳层能力（主窗口、原生对话框、系统外壳、
// 剪贴板、图标处理）的受控入口。
//
// 为什么要有它：这些能力原先散在壳层注入的 deps 大包里，插件拿到的是内部对象；
// 收成服务后语义清楚、可被兼容层替换（例如将来换成 DSH 的等价服务）。
//
// 实时读取（重要）：主窗口在插件挂载之后才创建，所以 `current` 必须是
// **调用期 getter**，不能在构造时快照——快照会永远拿到 undefined。
//
// 与 electron 的边界：本文件不 import electron，能力由壳层注入。
import { Service } from "@deepseek-ai/cordis";

declare module "@deepseek-ai/cordis" {
  interface Context {
    window: WindowService;
  }
}

const MISSING = (what: string) => {
  throw new Error(`壳层未注入 ${what}`);
};

export class WindowService extends Service {
  deps;

  constructor(ctx, config = {} as any) {
    super(ctx, "window");
    this.deps = config || {};
  }

  /** 主窗口；未创建/已销毁时为 null（调用期读取，不缓存） */
  get current() {
    return this.deps.getMainWindow?.() ?? null;
  }

  /** 主窗口是否可用且未销毁 */
  get available() {
    const win = this.current;
    return Boolean(win && !win.isDestroyed?.());
  }

  /** 把窗口置前并聚焦（无窗口时静默返回 false） */
  focus() {
    const win = this.current;
    if (!win || win.isDestroyed?.()) return false;
    if (win.isMinimized?.()) win.restore?.();
    win.show?.();
    win.focus?.();
    return true;
  }

  get dialog() {
    return this.deps.dialog || MISSING("dialog");
  }

  get shell() {
    return this.deps.shell || MISSING("shell");
  }

  get clipboard() {
    return this.deps.clipboard || MISSING("clipboard");
  }

  get nativeImage() {
    return this.deps.nativeImage || MISSING("nativeImage");
  }

  get nativeTheme() {
    return this.deps.nativeTheme || MISSING("nativeTheme");
  }

  /** 向渲染端广播（经壳层注入的 webContents 列表） */
  broadcast(channel, payload) {
    const targets = this.deps.getWebContents?.() ?? [];
    let sent = 0;
    for (const contents of targets) {
      if (!contents || contents.isDestroyed?.()) continue;
      contents.send?.(channel, payload);
      sent += 1;
    }
    return sent;
  }
}
