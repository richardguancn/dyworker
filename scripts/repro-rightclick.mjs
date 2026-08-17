// 右键卡死复现脚本：以隔离 userData 启动真实主进程，向消息区注入右键事件，
// 检测渲染进程是否卡死、自定义菜单是否出现。仅用于本地调试，不参与打包。
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROJECT_ROOT = "/Users/gdy/Documents/My/App/dyworker";
const TEMP_USER_DATA = "/tmp/dyworker-repro";

app.setPath("userData", TEMP_USER_DATA);
if (!process.env.VITE_DEV_SERVER_URL) {
  process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173";
}

await import(pathToFileURL(path.join(PROJECT_ROOT, "electron/main.mjs")).href);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForWindow(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      try {
        const state = await win.webContents.executeJavaScript("document.readyState");
        if (state === "complete") return win;
      } catch {
        /* 渲染进程尚未就绪 */
      }
    }
    await sleep(400);
  }
  return null;
}

app.whenReady().then(async () => {
  try {
    const win = await waitForWindow(40000);
    if (!win) {
      console.log("REPRO_RESULT: window not ready");
      app.exit(2);
      return;
    }
    console.log("REPRO_RESULT: window ready, title =", JSON.stringify(win.getTitle()));

    win.webContents.on("render-process-gone", (_e, details) => {
      console.log("REPRO_RESULT: RENDER_PROCESS_GONE", JSON.stringify(details));
    });
    win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
      const text = String(message).slice(0, 400);
      console.log(`REPRO_RESULT: console[${level}] ${text} (${sourceId}:${line})`);
    });

    // 等 React 挂载完消息列表
    await sleep(6000);

    const target = await win.webContents
      .executeJavaScript(`(() => {
        const el = document.querySelector(".user-bubble") || document.querySelector(".assistant-message") || document.querySelector(".message-row");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: el.className };
      })()`)
      .catch((e) => {
        console.log("REPRO_RESULT: query target failed:", String(e));
        return null;
      });
    console.log("REPRO_RESULT: target =", JSON.stringify(target));
    if (!target) {
      console.log("REPRO_RESULT: no message element found");
      app.exit(3);
      return;
    }

    // 注入右键（按下+抬起），触发 contextmenu
    win.webContents.sendInputEvent({ type: "mouseDown", button: "right", x: target.x, y: target.y, clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", button: "right", x: target.x, y: target.y, clickCount: 1 });
    console.log(`REPRO_RESULT: right-click dispatched at (${target.x}, ${target.y})`);

    await sleep(800);

    // 检查自定义菜单是否出现在 DOM
    let menuShown = "n/a";
    try {
      menuShown = await win.webContents.executeJavaScript("!!document.querySelector('.context-menu')");
    } catch {
      menuShown = "query-failed";
    }
    console.log("REPRO_RESULT: context-menu in DOM =", menuShown);

    // 检测渲染进程是否卡死：3.5 秒内能否响应 executeJavaScript
    let responsive = false;
    try {
      responsive = await Promise.race([
        win.webContents.executeJavaScript("1+1").then((v) => v === 2),
        sleep(3500).then(() => false),
      ]);
    } catch {
      responsive = false;
    }
    console.log("REPRO_RESULT: renderer responsive after right-click =", responsive);

    const crashed = win.webContents.isCrashed();
    console.log("REPRO_RESULT: isCrashed =", crashed);

    app.exit(responsive ? 0 : 1);
  } catch (e) {
    console.log("REPRO_RESULT: error:", e instanceof Error ? e.stack : String(e));
    app.exit(9);
  }
});
