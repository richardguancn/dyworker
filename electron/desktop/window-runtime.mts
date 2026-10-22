// 从桌面入口拆出的窗口创建与应用菜单。
import { BrowserWindow,dialog,Menu,screen,shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { windowBackgroundFor } from "../appearance-platform.mts";
import { attachLinuxWindowShadow } from "../linux-window-shadow.mts";
import { forwardNativePanelShortcut } from "../panel-shortcuts.ts";

export function createWindowRuntime(deps: {
  here: string;
  appearanceState: any;
  resolvedAppearanceTheme: () => "light" | "dark";
  windowIcons: any;
  // 沿用入口的窗口类型，兼容不同 Electron 版本的事件参数与字体权限名称。
  mainWindow: any;
  applyWindowAppearance: (...args: any[]) => void;
  performAppearanceReset: (...args: any[]) => Promise<any>;
  ctx: any;
  isTrustedRendererUrl: (url: unknown) => boolean;
  isDevelopment: boolean;
  rendererEntryUrl: string;
}) {
  const { resolvedAppearanceTheme, applyWindowAppearance, performAppearanceReset, isTrustedRendererUrl } = deps;


function createWindow() {
  const preloadPath = path.join(deps.here, "preload.cjs");
  // 桥接文件缺失时绝不能静默启动：渲染端会失去 window.dyworker，而界面里
  // 全是 window.dyworker?.xxx(...)，于是每个操作都变成空操作——点「保存设置」
  // 照样提示已保存，磁盘上却什么都没写（MCP 保存不了的真实原因）。
  if (!existsSync(preloadPath)) {
    console.error(`[dyworker] 缺少 preload：${preloadPath}；界面能打开但无法读写配置，请重新构建（npm run build:electron）。`);
    dialog.showErrorBox(
      "安装包不完整",
      `缺少 ${preloadPath}\n\n界面仍会打开，但设置与对话都无法保存。请重新构建或重新安装 DYWorker。`,
    );
  }
  const windowOptions = {
    width: 1184,
    height: 736,
    minWidth: 980,
    minHeight: 660,
    backgroundColor: process.platform === "linux" ? "#00000000" : windowBackgroundFor(deps.appearanceState.settings, resolvedAppearanceTheme()),
    transparent: process.platform === "linux",
    show: process.platform === "linux",
    title: "DYWorker",
    ...(process.platform === "linux" ? { icon: deps.windowIcons.iconFor(resolvedAppearanceTheme()) } : {}),
    // Linux/Windows 使用应用工具栏，macOS 的原生红绿灯由 hidden 标题栏保留。
    // Linux 仅四角透明，由页面平滑裁切；阴影仍交给合成器绘制。
    frame: false,
    // mac 原生红绿灯位于独立的 44px 窗口工具栏，聊天侧栏品牌行不再占用窗口控件空间。
    // 16px 原生按钮在该行垂直居中；工具栏仍支持拖动窗口。
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 14 } } : {}),
    hasShadow: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  };

  deps.mainWindow = new BrowserWindow(windowOptions as any);
  attachLinuxWindowShadow(deps.mainWindow, {
    scaleFactor: screen.getDisplayMatching(deps.mainWindow.getBounds()).scaleFactor,
  });
  applyWindowAppearance();
  // preload 加载失败（文件缺失、语法错误、沙箱限制）以前只在 Linux 记录，
  // mac 上完全没有日志，现象就是「界面正常、保存全无效」。改为全平台记录。
  deps.mainWindow.webContents.on("preload-error", (_event, failedPath, error) => {
    console.log(
      `[dyworker] preload 加载失败：${failedPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (process.platform === "linux") {
    // Linux 下默认隐藏顶部菜单栏以保持界面纯净，但保留应用菜单及全局恢复入口
    deps.mainWindow.setMenuBarVisibility(false);
    deps.mainWindow.autoHideMenuBar = true;
  }
  // 注册按键级应急恢复外观监听（CmdOrCtrl+Alt+R），独立于菜单显示状态，界面字号过大时仍可触发
  deps.mainWindow.webContents.on("before-input-event", (event, input) => {
    if (forwardNativePanelShortcut(event, input, process.platform,
      action => deps.mainWindow?.webContents.send("panel:shortcut", action))) return;
    const isCmdOrCtrl = process.platform === "darwin" ? input.meta : input.control;
    if (isCmdOrCtrl && input.alt && input.key?.toLowerCase() === "r" && input.type === "keyDown") {
      // 阻止同一按键继续触发菜单 accelerator；长按也只恢复一次。
      event.preventDefault();
      if (input.isAutoRepeat) return;
      void performAppearanceReset().then((snapshot) => {
        if (deps.mainWindow && !deps.mainWindow.isDestroyed()) {
          deps.mainWindow.webContents.send("appearance:reset", snapshot);
        }
      });
    }
  });
  // 最大化/还原时确保窗口始终接收鼠标输入。
  deps.mainWindow.on("maximize", () => {
    deps.mainWindow?.setIgnoreMouseEvents(false);
    deps.mainWindow?.webContents.send("window:maximized-changed", true);
  });
  deps.mainWindow.on("unmaximize", () => {
    deps.mainWindow?.setIgnoreMouseEvents(false);
    deps.mainWindow?.webContents.send("window:maximized-changed", false);
  });
  deps.mainWindow.on("enter-full-screen", () => deps.mainWindow?.webContents.send("window:maximized-changed", true));
  deps.mainWindow.on("leave-full-screen", () => deps.mainWindow?.webContents.send("window:maximized-changed", deps.mainWindow.isMaximized()));
  // 使用统计的窗口状态信号：后台/最小化/失焦立即封口当前使用区间。
  // 关闭窗口（macOS 进程仍在）同样视为不可计时状态。
  const noteTelemetryWindowState = () => {
    if (!deps.mainWindow || deps.mainWindow.isDestroyed()) return;
    deps.ctx.telemetryController?.noteWindowState({
      visible: deps.mainWindow.isVisible(),
      minimized: deps.mainWindow.isMinimized(),
      focused: deps.mainWindow.isFocused(),
    });
  };
  for (const stateEvent of ["focus", "blur", "show", "hide", "minimize", "restore", "close"]) {
    deps.mainWindow.on(stateEvent, noteTelemetryWindowState);
  }
  // Linux 下无边框窗口首次显示后主动申请键盘焦点，避免点击窗口后按键仍
  // 被送到上一个窗口（X11/XWayland 无边框窗口的常见问题）。
  if (process.platform === "linux") {
    // Linux 下记录窗口几何、显示器和渲染器状态，便于真机排查“进程在但
    // 界面不显示”。正常环境这些日志不影响窗口与阴影。
    const logWindowGeometry = (label) => {
      if (!deps.mainWindow || deps.mainWindow.isDestroyed()) return;
      try {
        const bounds = deps.mainWindow.getBounds();
        const display = screen.getDisplayMatching(bounds);
        console.log(
          `[dyworker] linux window ${label}: bounds=${JSON.stringify(bounds)} ` +
            `display=${JSON.stringify(display.bounds)} scale=${display.scaleFactor} ` +
            `visible=${deps.mainWindow.isVisible()} minimized=${deps.mainWindow.isMinimized()} ` +
            `maximized=${deps.mainWindow.isMaximized()}`,
        );
      } catch (error: any) {
        console.log(`[dyworker] linux window geometry failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    setTimeout(() => logWindowGeometry("created"), 500);
    deps.mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) {
        console.log(
          `[dyworker] linux renderer load failed: ${errorCode} ${errorDescription} (${validatedURL})`,
        );
      }
    });
    deps.mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.log(
        `[dyworker] linux renderer gone: reason=${details?.reason || "unknown"} ` +
          `exitCode=${details?.exitCode ?? "unknown"}`,
      );
    });
    deps.mainWindow.webContents.on("console-message", (details, level, message, line, sourceId) => {
      const severity = details?.params?.level ?? ["verbose", "info", "warning", "error"][level] ?? String(level);
      if (severity === "error" || level === 3) {
        console.log(
          `[dyworker] linux renderer error: ${details?.params?.message ?? message} ` +
            `(${details?.params?.sourceId ?? sourceId}:${details?.params?.lineNumber ?? line})`,
        );
      }
    });
    deps.mainWindow.on("show", () => {
      if (!deps.mainWindow || deps.mainWindow.isDestroyed()) return;
      deps.mainWindow.focus();
      deps.mainWindow.webContents.focus();
    });
  }
  // 加载后检查界面是否挂载；空白时重载一次，保留诊断日志。
  if (process.platform === "linux") {
    let rendererReloaded = false;
    const inspectRendererContent = async () => {
      if (!deps.mainWindow || deps.mainWindow.isDestroyed()) return null;
      try {
        return await deps.mainWindow.webContents.executeJavaScript(`(() => {
          const root = document.getElementById("root");
          return {
            readyState: document.readyState,
            rootChildren: root ? root.children.length : -1,
            bodyTextLength: document.body ? (document.body.innerText || "").length : -1,
            hasBridge: Boolean(window.dyworker),
            hasFocus: document.hasFocus(),
            shadowClass: document.documentElement.classList.contains("window-shadow"),
          };
        })()`);
      } catch (error: any) {
        return { checkError: error instanceof Error ? error.message : String(error) };
      }
    };
    const ensureRendererContent = async () => {
      if (!deps.mainWindow || deps.mainWindow.isDestroyed()) return;
      const report = await inspectRendererContent();
      console.log(`[dyworker] linux renderer content: ${JSON.stringify(report)}`);
      if (!report || report.checkError || report.rootChildren > 0 || report.bodyTextLength > 0) return;
      if (!rendererReloaded) {
        rendererReloaded = true;
        console.log("[dyworker] linux renderer is blank; reloading once");
        deps.mainWindow.webContents.reload();
        return;
      }
      console.log("[dyworker] linux renderer still blank after reload");
    };
    deps.mainWindow.webContents.on("did-finish-load", () => {
      setTimeout(() => void ensureRendererContent(), 2000);
    });
  }
  deps.mainWindow.once("closed", () => {
    deps.mainWindow = undefined;
  });
  // 主窗口权限：media 沿用现有放行；本机字体枚举仅放行主窗口自身，内嵌网页不开放
  deps.mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) =>
    permission === "media" ||
    ((permission === "font-access" || permission === "local-fonts") && webContents === deps.mainWindow?.webContents));
  deps.mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(
      permission === "media" ||
      ((permission === "font-access" || permission === "local-fonts") && webContents === deps.mainWindow?.webContents),
    );
  });
  if (process.platform !== "linux") deps.mainWindow.once("ready-to-show", () => deps.mainWindow.show());
  deps.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 只把 http/https 交给系统浏览器，其余协议（file:、smb:、自定义协议等）一律拒绝，防止协议处理器滥用
    try {
      const target = new URL(url);
      if (target.protocol === "http:" || target.protocol === "https:") void shell.openExternal(target.toString());
    } catch {
      // Ignore malformed open targets.
    }
    return { action: "deny" };
  });
  deps.mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    try {
      const target = new URL(url);
      if (target.protocol === "http:" || target.protocol === "https:") void shell.openExternal(url);
    } catch {
      // Ignore malformed navigation targets.
    }
  });

  // 产物布局：main.mjs 在 dist/electron/，渲染产物在 dist/client/（package.json
  // build.files），故相对 here 是 ../client；写成 ../dist/client 会解析到
  // dist/dist/client 导致打包后窗口空白。
  const localHtmlPath = path.join(deps.here, "../client/index.html");
  if (process.env.VITE_DEV_SERVER_URL) {
    deps.mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (deps.isDevelopment && !existsSync(localHtmlPath)) {
    deps.mainWindow.loadURL(deps.rendererEntryUrl);
  } else {
    deps.mainWindow.loadFile(localHtmlPath);
  }

  deps.mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      console.log(`[dyworker] renderer load failed: ${errorCode} ${errorDescription} (${validatedURL})`);
      if (validatedURL.startsWith("http://127.0.0.1:5173") && existsSync(localHtmlPath)) {
        console.log("[dyworker] dev server unreachable, falling back to local built html");
        deps.mainWindow?.loadFile(localHtmlPath);
      }
    }
  });
}


// 应用菜单「恢复默认外观」应急入口：设置被不合适字号挤压时仍可恢复
function installApplicationMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "外观",
      submenu: [
        {
          label: "恢复默认外观",
          accelerator: "CmdOrCtrl+Alt+R",
          click: () => {
            void performAppearanceReset().then((snapshot) => {
              if (deps.mainWindow && !deps.mainWindow.isDestroyed()) deps.mainWindow.webContents.send("appearance:reset", snapshot);
            });
          },
        },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template as any));
}
  return { installApplicationMenu, createWindow };
}
