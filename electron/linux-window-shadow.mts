import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const helperPath = fileURLToPath(new URL("./scripts/linux_window_shadow.py", import.meta.url))
  .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);

// X11 无边框窗口不一定由桌面自动加阴影。向支持该协议的合成器提供
// _KDE_NET_WM_SHADOW 图像，助手同步裁出 8px 圆角。
// 不扩大窗口、不使用透明窗口或整窗鼠标穿透。
// Python 连接必须保持存活：断开 X11 连接会释放它持有的阴影 pixmap。
export function attachLinuxWindowShadow(window, {
  platform = process.platform,
  env = process.env,
  argv = process.argv,
  scaleFactor = 1,
  launch = spawn,
  log = (message) => console.log(`[dyworker] linux shadow: ${message}`),
} = {} as any) {
  if (platform !== "linux" || !env.DISPLAY || argv.includes("--ozone-platform=wayland")) return () => {};
  let child;
  let stopped = false;
  const listeners = new Map();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const [event, listener] of listeners) window.removeListener(event, listener);
    child?.stdin?.end();
  };
  try {
    const handle = window.getNativeWindowHandle();
    // X11 XID 的有效位是低 32 位，Electron 的 unsigned long 在 64 位上占 8 字节。
    const xid = handle.readUInt32LE(0);
    if (!xid) return stop;
    child = launch("/usr/bin/python3", [helperPath, String(xid), String(scaleFactor)], {
      env, stdio: ["pipe", "pipe", "pipe"],
    });
    const update = () => {
      if (stopped || window.isDestroyed() || !child.stdin?.writable) return;
      child.stdin.write(window.isMaximized() || window.isFullScreen() ? "hide\n" : "show\n");
    };
    // spawn 成功不代表系统已采用阴影；只记录助手报告的支持/提交状态。
    child.stdout?.on("data", (data) => log(String(data).trim().slice(0, 1024)));
    child.stderr?.on("data", (data) => log(String(data).trim().slice(0, 1024)));
    child.on("error", (error) => { log(error.message); stop(); });
    child.on("exit", () => stop());
    child.stdin?.on("error", () => stop());
    for (const event of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "show"]) {
      listeners.set(event, update);
      window.on(event, update);
    }
    listeners.set("closed", stop);
    window.once("closed", stop);
    update();
  } catch (error: any) {
    log(error.message);
    stop();
  }
  return stop;
}
