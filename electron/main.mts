import './mac-store-bootstrap.mts';
import { app,BrowserWindow,clipboard,dialog,ipcMain,nativeImage,nativeTheme,Notification,powerMonitor,powerSaveBlocker,protocol,safeStorage,session,shell } from "electron";
import { spawn } from "node:child_process";
import { appendFileSync,existsSync,promises as fs,readFileSync,statSync,writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import { builtinHooks,isSafeBrowserUrl,probeServerContextLimit,requestModel,sanitizeToolCalls,summarizationSettings } from "./agent.mts";
import { createUpdaterController,DEFAULT_UPDATE_URL } from "./app-updater.mts";
import { createMacStoreFileAccess } from "./mac-store-file-access.mts";
import { applyWindowBackdrop,getAppearanceCapabilities,windowBackgroundFor } from "./appearance-platform.mts";
import { collectOrphanAssets,commitStagedImage,defaultAppearance,normalizeAppearance,readAppearance,removeAppearanceImage,saveAppearance } from "./appearance.mts";
import { createBackgroundTasksManager } from "./background-tasks.mts";
import { BrowserAgent,browserToolDefinitions } from "./browser.mts";
import { CHANNEL_LABELS,createChannelManager } from "./channels/manager.mts";
import { parseApprovalReply } from "./channels/qq-bot.mts";
import { saveClipboardImage } from "./clipboard-image.mts";
import { providerMessageContent, describeAttachment, attachmentType } from "./desktop/attachments.mts";
import { transcribeAudio, buildWavFromPcm, transcribeQqVoice } from "./desktop/audio.mts";
import { createAutomationRuntime } from "./desktop/automation-runtime.mts";
import { createBrowserRuntime } from "./desktop/browser-runtime.mts";
import { createChannelRuntime } from "./desktop/channel-runtime.mts";
import { createMcpRuntime } from "./desktop/mcp-runtime.mts";
import { createWindowRuntime } from "./desktop/window-runtime.mts";
import { filePreviewToolDefinitions,requestFilePreview } from "./file-preview.mts";
import { gitCommitDiff } from "./git.mts";
import { queuedGoalPayload,settledStoredGoal } from "./goal.mts";
import { snapshotCriticalFiles } from "./host/boot-backup.mts";
import { createHost,disposeHost } from "./host/context.mts";
import { createChildEntry } from './host/dsh-runtime/child-entry.mts';
import { assertDshModelSettings,hasConfiguredModel } from "./host/dsh-runtime/model-settings.mts";
import { agentIpcPlugin } from "./host/plugins/agent-ipc.mts";
import { appIpcPlugin } from "./host/plugins/app-ipc.mts";
import { appUpdateIpcPlugin } from "./host/plugins/app-update-ipc.mts";
import { appearanceIpcPlugin } from "./host/plugins/appearance-ipc.mts";
import { attachmentsIpcPlugin } from "./host/plugins/attachments-ipc.mts";
import { auditIpcPlugin } from "./host/plugins/audit-ipc.mts";
import { backgroundTasksIpcPlugin } from "./host/plugins/background-tasks-ipc.mts";
import { browserControlIpcPlugin } from "./host/plugins/browser-control-ipc.mts";
import { browserImportIpcPlugin } from "./host/plugins/browser-import-ipc.mts";
import { browserIpcPlugin } from "./host/plugins/browser-ipc.mts";
import { channelsIpcPlugin } from "./host/plugins/channels-ipc.mts";
import { chatIpcPlugin } from "./host/plugins/chat-ipc.mts";
import { clipboardIpcPlugin } from "./host/plugins/clipboard-ipc.mts";
import { gitIpcPlugin } from "./host/plugins/git-ipc.mts";
import { inboxIpcPlugin } from "./host/plugins/inbox-ipc.mts";
import { localModelsIpcPlugin } from "./host/plugins/local-models-ipc.mts";
import { memoriesIpcPlugin } from "./host/plugins/memories-ipc.mts";
import { pluginApiIpcPlugin } from "./host/plugins/plugin-api-ipc.mts";
import { pluginsIpcPlugin } from "./host/plugins/plugins-ipc.mts";
import { rulesIpcPlugin } from "./host/plugins/rules-ipc.mts";
import { schedulesIpcPlugin } from "./host/plugins/schedules-ipc.mts";
import { sensitivePathGuardPlugin } from "./host/plugins/sensitive-path-guard.mts";
import { sessionsIpcPlugin } from "./host/plugins/sessions-ipc.mts";
import { settingsIpcPlugin } from "./host/plugins/settings-ipc.mts";
import { skillsIpcPlugin } from "./host/plugins/skills-ipc.mts";
import { speechIpcPlugin } from "./host/plugins/speech-ipc.mts";
import { telemetryIpcPlugin } from "./host/plugins/telemetry-ipc.mts";
import { tracesIpcPlugin } from "./host/plugins/traces-ipc.mts";
import { transferIpcPlugin } from "./host/plugins/transfer-ipc.mts";
import { usageHooksIpcPlugin } from "./host/plugins/usage-hooks-ipc.mts";
import { windowIpcPlugin } from "./host/plugins/window-ipc.mts";
import { workspaceIpcPlugin } from "./host/plugins/workspace-ipc.mts";
import { backgroundTasksPlugin,channelsPlugin,remoteMessagesPlugin,telemetryPlugin } from "./host/services/runtime-domains.mts";
import { pluginToolResult } from "./host/services/tools.mts";
import { importLegacyData } from "./legacy-data.mts";
import { stopLocalAsrServer } from "./local-asr-server.mts";
import { configureLocalAsr } from "./local-asr.mts";
import { localImagePathFromSource,registerLocalImageIpc } from "./local-image.mts";
import { configureLocalReviewer,resetLocalReviewerEngine } from "./local-reviewer.mts";
import { configureLocalTts,normalizeTtsModelId } from "./local-tts.mts";
import { enforceDirTotalSize,halveFileIfOversized } from "./log-rotation.mts";
import { importMcpBundle } from "./mcp-bundle.mts";
import { extractExplicitMemoryInstructions } from "./memory.mts";
import { createRemoteMessagesManager } from "./remote-messages.mts";
import { isTrustedAppRendererUrl } from "./renderer-origin.mts";
import { SessionQueue } from "./session-queue.mts";
import { handleSessionTool,SESSION_TOOL_NAMES,sessionToolDefinitions } from "./session-tools.mts";
import { countUndecryptableSecrets,decryptChannelSecret,encryptChannelSecret,normalizeApprovalMode,normalizePreventSleep } from "./settings.mts";
import { installSkillFromLibrary,searchSkillLibraries } from "./skill-libraries.mts";
import { createTelemetryController } from "./telemetry.mts";
import { createDockIconController,createWindowIconController } from "./theme-icons.mts";
import { createTraceWriter } from "./trace-writer.mts";
import { findWorkspaceBlockers } from "./workspace-busy.mts";
import { listWorkspace } from "./workspace.mts";

// Older UKUI Wayland compositors do not expose the surface and text-input
// protocols required by current Electron releases, so the window never maps.
// The ozone platform is selected before any JavaScript runs, which makes
// app.commandLine.appendSwitch("ozone-platform", ...) too late to help — the
// flag must be present on the real command line. Relaunch the process with it
// once, so the XWayland display is used and IME keeps working.
if (
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE === "wayland" || process.env.WAYLAND_DISPLAY) &&
  process.env.DISPLAY &&
  !process.argv.includes("--ozone-platform=x11") &&
  !process.env.DYWORKER_X11_RELAUNCH
) {
  const child = spawn(
    process.execPath,
    [...process.argv.slice(1), "--ozone-platform=x11"],
    {
      env: { ...process.env, DYWORKER_X11_RELAUNCH: "1" },
      detached: true,
      stdio: "inherit",
    },
  );
  child.unref();
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const windowIcons = createWindowIconController({ platform: process.platform, directory: path.join(here, "assets"), nativeImage });
const dockIcons = createDockIconController({ platform: process.platform, directory: path.join(here, "assets"), nativeImage, getDock: () => app.dock });

// 崩溃兜底：任务执行期间任何未捕获异常不能再让整个进程无声退出。
// 先记到终端标准输出，再持久化到 userData/crash.log（桌面图标启动时
// 终端输出会丢，崩溃日志是唯一的排查依据）。
function crashLogFile() {
  try {
    return path.join(app.getPath("userData"), "crash.log");
  } catch {
    return "";
  }
}
function reportFatal(kind, error) {
  const detail = error instanceof Error ? (error.stack || error.message) : String(error);
  console.error(`[dyworker] ${kind}: ${detail}`);
  const file = crashLogFile();
  if (!file) return;
  try {
    // 崩溃日志超过 2 MB 时截掉前半，只保留近期记录，防止占满磁盘
    try {
      if (statSync(file).size > 2 * 1024 * 1024) {
        const content = readFileSync(file, "utf8");
        writeFileSync(file, content.slice(Math.floor(content.length / 2)), "utf8");
      }
    } catch {
      // 文件不存在或读取失败时直接追加即可
    }
    appendFileSync(file, `[${new Date().toISOString()}] ${kind}: ${detail}\n`, "utf8");
  } catch {
    // 崩溃日志写失败不能再次触发异常
  }
}
process.on("uncaughtException", (error) => {
  reportFatal("uncaughtException", error);
});
process.on("unhandledRejection", (reason) => {
  reportFatal("unhandledRejection", reason instanceof Error ? reason : new Error(String(reason)));
});

const isDevelopment = !app.isPackaged;
const rendererEntryUrl = isDevelopment
  ? process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173"
  : pathToFileURL(path.join(here, "../client/index.html")).href;
let mainWindow;
let appUpdater;
let appUpdateTimer = null;
let appUpdateInterval = null;
// 运营统计与消息中心不再由本模块持有实例：由运行期域插件创建并 provide，
// 消费点统一走 ctx.telemetryController / ctx.remoteMessages（服务端故障静默降级）

function broadcastSystemMessagesChanged() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("system-messages:changed");
    }
  } catch {
    // 主窗口销毁期间忽略
  }
}

// 系统通知展示能力取决于平台和安装配置；不支持时消息中心仍可查，不虚报状态
function showRemoteMessageNotification(message, onClick) {
  if (typeof Notification !== "function" || !Notification.isSupported()) return;
  try {
    const notification = new Notification({
      title: String(message.title || "DYWorker 系统消息").slice(0, 80),
      body: String(message.body || "").replace(/\s+/g, " ").slice(0, 120),
    });
    notification.on("click", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send("system-messages:focus", { messageId: message.message_id });
      }
      onClick?.();
    });
    notification.show();
  } catch {
    // 通知失败不影响消息入库
  }
}
function isTrustedRendererUrl(rawUrl) {
  return isTrustedAppRendererUrl(
    rawUrl,
    pathToFileURL(path.join(here, "../client/index.html")).href,
    isDevelopment ? rendererEntryUrl : undefined,
  );
}

// 全部 IPC handler 的统一入口：校验调用方是主渲染进程（webview 客页面只能走
// sendToHost 到渲染层，到不了这里）。纵深防御——渲染层一旦出现注入（XSS/供应链），
// 未经此校验的 handler 会成为任意文件读写、git 操作、后台命令的直达通道。
function trustedHandle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedRendererUrl(event.senderFrame?.url)) {
      throw new Error(`不受信任的 IPC 调用来源：${channel}`);
    }
    return handler(event, ...args);
  });
}

app.setName("DYWorker");
// 测试/验收可用独立数据目录并行启动，避免与正在运行的正式实例共用 userData
if (process.env.DYWORKER_USER_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.DYWORKER_USER_DATA_DIR));
}
nativeTheme.themeSource = "system";
if (process.platform === "linux") {
  app.disableHardwareAcceleration();
}

// ---- 外观自定义：已保存值 + 平台能力 + 实际效果状态（与用户选择分开记录）----
const appearanceFile = dataFile("appearance.json");
const appearanceAssetsDir = dataFile("appearance-assets");
const appearanceCapabilities = getAppearanceCapabilities({
  hwAcceleration: process.platform !== "linux",
});
let appearanceState = { settings: defaultAppearance(), revision: 0 };
// nativeTheme 的更新事件可能晚于预览请求；图标以当前预览为准，取消或保存后清空。
let windowIconPreviewSettings = null;
let appearanceEffective: any = { applied: "none", reason: null };

function resolvedAppearanceTheme(settings = appearanceState.settings) {
  if (settings.theme === "dark" || settings.theme === "light") return settings.theme;
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

// 显式主题下把 themeSource 固定为用户选择，系统主题事件不再改变窗口底色
function syncNativeThemeSource() {
  const theme = appearanceState.settings.theme;
  nativeTheme.themeSource = (theme === "system" ? "system" : theme) as "system" | "dark" | "light";
}

function applyWindowAppearance() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  appearanceEffective = applyWindowBackdrop(mainWindow, appearanceState.settings, appearanceCapabilities);
  const isBackdropActive = appearanceEffective.applied === "vibrancy" || appearanceEffective.applied === "background-material";
  mainWindow.setBackgroundColor(process.platform === "linux" ? "#00000000" : windowBackgroundFor(appearanceState.settings, resolvedAppearanceTheme(), isBackdropActive));
  windowIcons.apply(mainWindow, resolvedAppearanceTheme(windowIconPreviewSettings ?? appearanceState.settings));
  dockIcons.apply((windowIconPreviewSettings ?? appearanceState.settings).dockIcon);
  mainWindow.webContents?.invalidate?.();
}

// Linux 原生阴影由独立 X11 助手提供；外观变化不扩大输入区域。
// 系统主题变化只在「跟随系统」时生效：显式主题下 themeSource 已固定，此事件不会因系统明暗切换而触发。
nativeTheme.on("updated", () => {
  applyWindowAppearance();
});

function dataFile(name) {
  return path.join(app.getPath("userData"), name);
}

const macStoreFileAccess = createMacStoreFileAccess({
  enabled: process.mas === true,
  startAccess: (bookmark) => app.startAccessingSecurityScopedResource(bookmark),
  load: () => readJson(dataFile('mac-workspace-bookmarks.json'), {}),
  save: (records) => writeJson(dataFile('mac-workspace-bookmarks.json'), records),
});

// Cordis 宿主：主进程核心服务（审计/设置/会话存档/代理）统一挂入插件生命周期。
// safeStorage 与领域解析器在此注入；顶层 await 等待根 fiber 激活，
// 之后的模块级常量（sessionArchive/auditLog）即可同步访问服务。
// 插件客户端 bundle 走自定义协议：渲染端 CSP 是 script-src 'self'，eval 与内联脚本都被禁，
// 第三方预打包 bundle（window.__ModuleLoader__.load(...)）只能作为同源 <script src> 加载。
// 必须在 app ready 之前声明为特权 scheme，否则注册会失败。
protocol.registerSchemesAsPrivileged([
  { scheme: "dyworker-plugin", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

/**
 * 自动化/排查用的安全存储替身：设了 DYWORKER_SKIP_SAFE_STORAGE=1 就不碰系统钥匙串。
 *
 * 为什么需要：用临时 userData 启动做验证时，macOS 会弹「允许访问钥匙串」并要求输入登录密码——
 * 本机调试不该反复打扰用户。替身明确报告"加密不可用"：已有密文保持原样，密钥读取为空，
 * 新密钥保存会被拒绝。免密回环服务仍可用于隔离验收，不改变正式密钥存储规则。
 */
const safeStorageForHost = process.env.DYWORKER_SKIP_SAFE_STORAGE
  ? {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(String(value), "utf8"),
      decryptString: (buffer: Buffer) => Buffer.from(buffer).toString("utf8"),
    }
  : safeStorage;

const ctx = await createHost({
  userDataDir: app.getPath("userData"),
  homeDir: app.getPath("home"),
  safeStorage: safeStorageForHost,
  // 插件宿主：启动时读 userData/plugins/dyworker.yml 装载插件
  //（官方 cordis loader 负责生命周期；清单与解析见 host/plugin-host.mts）
  mountPlugins: true,
  // 内置插件（如 DSH 轨迹视图）：随应用分发，不走 npm 管理的插件目录
  // getAppPath()：开发时是仓库根，打包后是 app.asar 根——内置插件随 files 打进产物，
  // Electron 的 fs 补丁能直接从 asar 里读，所以两条路径都成立
  builtinPluginsDir: path.join(app.getAppPath(), "builtin-plugins"),
  // 契约服务的壳层能力：插件通过 ctx.ipc/storage/window 使用，而不是内部 deps 大包
  contracts: {
    ipcRegister: (channel, handler) => trustedHandle(channel, handler),
    ipcUnregister: (channel) => ipcMain.removeHandler(channel),
    getMainWindow: () => mainWindow,
    getWebContents: () => BrowserWindow.getAllWindows().map((win) => win.webContents),
    dialog, shell, clipboard, nativeImage, nativeTheme,
  },
  settingsMigrators: [applyReviewerModelDir, applyAsrSettings, applyTtsSettings],
  // 代理服务的领域解析器：记忆/技能/唤醒/MCP 领域函数仍是本模块实现，
  // 逐域插件化后改为 ctx.<domain> 直连
  agentResolvers: {
    isShuttingDown: () => mcpShuttingDown,
    readHooks,
    readMemoryPages,
    readSkills,
    readStandingRules,
    appendMemory,
    memoriesFromAgentResult,
    appendSkill,
    appendUsageStat,
    history: () => ({ search: searchHistory, readContext: readHistoryContext }),
    // 唤醒登记已上收 ctx.scheduler；解析器在调用时（不 early）读取服务
    hasPendingWakeForSession: (sessionId) => ctx.scheduler.hasPendingForSession(sessionId),
    registerWake: (wake) => ctx.scheduler.registerWake(wake),
    mcpExtraTools,
    agentExtraTools,
    createExtraToolRouter,
    auditRecord: (entry) => auditLog.record(entry),
  },
  // 后台任务管理器由插件创建（ctx.backgroundTasksManager），此处只留转发
  startBackgroundTask: (p) => ctx.backgroundTasksManager.startTask(p),
  // 收件箱的 electron 边界：渲染端广播 + 系统通知（host 侧不 import electron）
  inboxBroadcast: () => broadcastInboxChanged(),
  inboxNotify: (item) => notifyInboxItem(item),
  // 调度服务的壳层边界：忙碌/关机判定 + 任务执行 + 渲染端广播
  schedulerHooks: {
    isShuttingDown: () => mcpShuttingDown,
    isSessionBusy: (sessionId) => isSessionBusy(sessionId),
    isSystemBusy: () => activeAgents.size > 0 || runningChannelTaskCount > 0,
    // meta.manual：本轮是用户点「立即执行」还是到点自动跑（透传给 schedules:run-started）
    runScheduledTask: (record, meta) => runScheduledTask(record, meta),
    resumeWake: (wake) => resumeWake(wake),
    broadcast: () => broadcastSchedulesChanged(),
  },
});
// 运行期域不在此处经 createHost 的 registerService 挂载：该回调在 createHost
// 内部的顶层 await 期间同步执行，此时本模块后面声明的绑定仍处于 TDZ，任何引用
// 都会抛 ReferenceError 让主进程启动即崩。运行期域改为在各自创建点 ctx.plugin
// 挂载（插件负责创建 + 提供 ctx.<name> + 停机）。

// 会话存档：按会话拆分为 sessions/<id>.json + index.json（迁移见
// session-archive.mts）。读路径走 ctx.sessions，写路径经合并写入器承接
// （整档写盘按间隔合并，防写放大），dispose 时统一 flush。
const sessionArchive = ctx.sessions;
// 各只读消费方（历史检索、会话工具、渠道工作区推导等）统一入口
function readAllSessions() {
  return sessionArchive.loadAll();
}

// 自动更新模块属于可选能力：如果打包产物缺少 electron-updater（历史上曾
// 导致 Linux 主进程启动即崩溃、窗口无法创建），动态加载失败时只禁用自动
// 更新，不影响应用正常打开。
let electronUpdaterPromise = null;
function loadElectronUpdater() {
  if (process.mas) return Promise.resolve(null);
  electronUpdaterPromise ??= import("electron-updater")
    .then((module) => module.autoUpdater || module.default?.autoUpdater || null)
    .catch((error) => {
      console.log(
        `[dyworker] electron-updater 不可用，自动更新已禁用：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    });
  return electronUpdaterPromise;
}

function initializeAppUpdater(updateUrl = DEFAULT_UPDATE_URL, updater) {
  appUpdater = createUpdaterController({
    updater: updater || null,
    isPackaged: app.isPackaged,
    currentVersion: app.getVersion(),
    getWindow: () => mainWindow,
    updateUrl,
  });
  if (!app.isPackaged) return;
  if (updater) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
  }
}

async function checkForAppUpdate() {
  return appUpdater?.check() || { ok: false, state: "unavailable", error: "更新服务尚未准备好" };
}



// 审计日志（audit.jsonl）：有副作用的工具调用，审批决策与执行结果逐条落盘。
// 由 cordis 宿主的 ctx.audit 服务承接（createHost 内按 userDataDir 装配）。
const auditLog = ctx.audit;

// ---- 内置本地审核模型（Qwen3-0.6B，llama.cpp 推理）----
// 模型默认存 userData/models/reviewer/，设置里可自定义保存目录、一键下载（ModelScope 优先）
const defaultReviewerModelDir = path.join(app.getPath("userData"), "models", "reviewer");
let reviewerModelDirApplied = defaultReviewerModelDir;
configureLocalReviewer({ dir: defaultReviewerModelDir });

// 设置里的保存目录变更时切换并丢弃已加载引擎；重复调用幂等
function applyReviewerModelDir(settingsValue) {
  const custom = String(settingsValue?.reviewerModelDir || "").trim();
  const dir = custom || defaultReviewerModelDir;
  if (dir === reviewerModelDirApplied) return;
  configureLocalReviewer({ dir });
  resetLocalReviewerEngine();
  reviewerModelDirApplied = dir;
}


// ---- 本地语音转写（Qwen3-ASR-0.6B + llama-server）----
// 模型默认存 userData/models/asr/，引擎二进制存 userData/bin/llama.cpp/，设置里可自定义。
const defaultAsrModelDir = path.join(app.getPath("userData"), "models", "asr");
const defaultAsrBinDir = path.join(app.getPath("userData"), "bin", "llama.cpp");
let asrModelDirApplied = "";
let asrModelIdApplied = "";
let asrServerPathApplied = "";
configureLocalAsr({ modelDir: defaultAsrModelDir, binDir: defaultAsrBinDir });
asrModelDirApplied = defaultAsrModelDir;

function asrSettingsFrom(saved) {
  return {
    engine: String(saved?.transcriptionEngine || "") === "local" ? "local" : "cloud",
    modelId: String(saved?.asrModel || "").trim(),
    modelDir: String(saved?.asrModelDir || "").trim(),
    serverPath: String(saved?.llamaServerPath || "").trim(),
  };
}

function applyAsrSettings(saved) {
  const { modelId, modelDir, serverPath } = asrSettingsFrom(saved);
  const modelDirResolved = modelDir || defaultAsrModelDir;
  const changed = modelDirResolved !== asrModelDirApplied || modelId !== asrModelIdApplied;
  configureLocalAsr({ modelDir: modelDirResolved, binDir: defaultAsrBinDir });
  if (changed) {
    // 模型目录或所选模型变更后旧进程还指着旧文件：停掉，下次转写按新配置重启
    stopLocalAsrServer();
    asrModelDirApplied = modelDirResolved;
    asrModelIdApplied = modelId;
  }
  asrServerPathApplied = serverPath;
  return modelId;
}




// ---- 本地语音合成（Qwen3-TTS + llama-tts，多模型可选）----
// 与 ASR 共用同一个 llama.cpp 运行时包；模型默认存 userData/models/tts/。
const defaultTtsModelDir = path.join(app.getPath("userData"), "models", "tts");
let ttsModelDirApplied = "";
let ttsModelIdApplied = "";
configureLocalTts({ modelDir: defaultTtsModelDir });
ttsModelDirApplied = defaultTtsModelDir;

function applyTtsSettings(saved) {
  const modelDir = String(saved?.ttsModelDir || "").trim() || defaultTtsModelDir;
  const modelId = normalizeTtsModelId(saved?.ttsLocalModel);
  // 模型目录/模型只在变更时重配；llama-tts 每次合成都是新进程，无需像 ASR 一样停旧进程
  if (modelDir !== ttsModelDirApplied || modelId !== ttsModelIdApplied) {
    configureLocalTts({ modelDir, modelId });
    ttsModelDirApplied = modelDir;
    ttsModelIdApplied = modelId;
  }
  return modelId;
}




// 选择参考音色音频（本地 TTS 克隆音色用；wav/mp3 等格式，压缩格式由渲染层转码后写回）

// 读取参考音色音频原始字节给渲染层解码（Web Audio 认识 m4a/aac/opus，llama.cpp 不认识）

// 保存渲染层转码出的 24kHz 单声道 wav（m4a 等格式 llama.cpp 解不了，统一落一份 wav 供合成使用）

// 会话内朗读：把文本合成为 wav 返回给渲染层播放（与渠道语音发送同一套 TTS 设置，
// 不走 silk 编码、不登记发送）。本地引擎用 Qwen3-TTS，云端引擎走 OpenAI 兼容 /audio/speech。

// 读取语音附件音频数据供渲染层播放（支持 .silk 解码为 wav，其他音频直接返回 bytes）

// ---- 防止电脑休眠 ----
// 安全设计:只用 prevent-app-suspension(阻止系统挂起),不用 prevent-display-sleep——
// 屏幕照常关闭、照常锁屏,长任务继续跑而物理安全(锁屏)不受影响。
// 三档:off 关闭 / tasks 仅任务运行期间(默认,无人值守机器该睡还睡) / always 始终唤醒。
// Linux 走 systemd-logind / freedesktop D-Bus(麒麟/UOS 尽力支持,不支持时静默降级)。
let sleepBlockerId = null;
let sleepBlockMode = "tasks";
let runningTaskCount = 0;

function updateSleepBlocker() {
  const shouldBlock = sleepBlockMode === "always" || (sleepBlockMode === "tasks" && runningTaskCount > 0);
  try {
    if (shouldBlock && sleepBlockerId === null) {
      const id = powerSaveBlocker.start("prevent-app-suspension");
      sleepBlockerId = powerSaveBlocker.isStarted(id) ? id : null;
    } else if (!shouldBlock && sleepBlockerId !== null) {
      powerSaveBlocker.stop(sleepBlockerId);
      sleepBlockerId = null;
    }
  } catch {
    sleepBlockerId = null; // 当前桌面环境不支持时静默降级
  }
}

function trackTaskStart() {
  runningTaskCount += 1;
  updateSleepBlocker();
}

function trackTaskEnd() {
  runningTaskCount = Math.max(0, runningTaskCount - 1);
  updateSleepBlocker();
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

// 同一文件的并发写入串行化 + 唯一临时文件名：避免多个 token-usage 事件同时
// 追加 usage-stats.json 时共用同一个 .tmp，导致 rename 互相踩踏（ENOENT 未捕获异常）
const jsonWriteChains = new Map();
// 含密钥/凭据的落盘文件收紧到仅属主可读写（safeStorage 不可用时的明文回退也受保护）
const SENSITIVE_JSON_FILES = new Set(["settings.json", "imported-passwords.json", "channel-credentials.json", "mac-workspace-bookmarks.json"]);
async function writeJson(file, value) {
  const previous = jsonWriteChains.get(file) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(temporary, file);
    if (SENSITIVE_JSON_FILES.has(path.basename(file))) await fs.chmod(file, 0o600).catch(() => {});
  });
  jsonWriteChains.set(file, next);
  try {
    await next;
  } finally {
    if (jsonWriteChains.get(file) === next) jsonWriteChains.delete(file);
  }
}

// 渠道诊断日志：追加写入 userData/channel-debug.log，不阻塞任务。
// 排队/等待类问题复现后，从这里能看到每条消息何时入队、被什么阻塞、任务是否收尾。
let channelDebugChain = Promise.resolve();
function channelDebug(event, payload = {} as any) {
  const line = `[${new Date().toISOString()}] ${event} ${JSON.stringify(payload)}`;
  console.log("[channel-debug]", line);
  const file = path.join(app.getPath("userData"), "channel-debug.log");
  channelDebugChain = channelDebugChain
    .catch(() => {})
    .then(async () => {
      try {
        // 只增不减的日志会把 userData 吃满：超过 5MB 截掉前半，只留近期记录
        await halveFileIfOversized(file, 5 * 1024 * 1024);
        await fs.appendFile(file, line + "\n", "utf8");
      } catch {
        // 日志写失败不影响运行
      }
    });
  return channelDebugChain;
}

async function readSettings() {
  // 持久化/解密/migrator/密文回写逻辑在 ctx.settings 服务（host/services/settings.mts）
  return ctx.settings.read();
}

async function saveSettings(settings) {
  // 落盘与 updateUrl 规范化在服务内完成；appUpdater 联动属于壳层反应，留在 main
  const updateUrl = await ctx.settings.write(settings);
  if (appUpdater && appUpdater.getUpdateUrl() !== updateUrl) appUpdater.configure(updateUrl);
  return updateUrl;
}

// 应用由 DYWork 改名为 DYWorker，用户数据目录随之改变。
// 首次启动 DYWorker 时把旧目录里的配置与对话记录搬过来；
// 旧版加密密钥（macOS/Linux 的加密口令绑定应用名）需要提示用户重新填写。
async function migrateLegacyDataOnFirstRun() {
  let result;
  try {
    result = await importLegacyData({ currentDirectory: app.getPath("userData") });
  } catch {
    return;
  }
  if (!result.imported) return;

  let stuckSecrets = 0;
  try {
    const stored = await readJson(dataFile("settings.json"), {});
    stuckSecrets += countUndecryptableSecrets(stored, safeStorage);
    const credentials = await readJson(dataFile("channel-credentials.json"), {});
    if (
      credentials?.wechatToken
      && credentials.wechatTokenEncrypted === true
      && !decryptChannelSecret(credentials.wechatToken, true, safeStorage)
    ) {
      stuckSecrets += 1;
    }
  } catch {
    // 密钥检查失败不阻塞启动，用户仍可自行核对设置
  }

  const message = stuckSecrets > 0
    ? `已把 DYWork 的配置和对话记录导入 DYWorker。\n\n应用改名后系统加密不再认识旧口令，有 ${stuckSecrets} 项密钥需要重新填写（模型 API Key、QQ 机器人或微信渠道凭据）。`
    : "已把 DYWork 的配置和对话记录导入 DYWorker。";
  await dialog.showMessageBox({
    type: "info",
    title: "已导入旧版数据",
    message,
    buttons: ["知道了"],
  });
}


const windowRuntime = createWindowRuntime({
  get here() { return here; },
  get appearanceState() { return appearanceState; },
  set appearanceState(value) { appearanceState = value; },
  resolvedAppearanceTheme,
  get windowIcons() { return windowIcons; },
  get mainWindow() { return mainWindow; },
  set mainWindow(value) { mainWindow = value; },
  applyWindowAppearance,
  performAppearanceReset,
  get ctx() { return ctx; },
  isTrustedRendererUrl,
  get isDevelopment() { return isDevelopment; },
  get rendererEntryUrl() { return rendererEntryUrl; },
});
const { installApplicationMenu, createWindow } = windowRuntime;


// 右侧浏览器标签页使用 webview 内嵌网页；远程页面始终关闭 Node 能力。
// 协议白名单校验（http/https、禁 userinfo）；localhost/内网地址按产品决策放行
// （用户可全程看到面板内容，查看本地开发服务是正当需求）。
app.on("will-attach-webview" as any, (event: any, webPreferences: any, params: any) => {
  // 远程页面始终关闭 Node 能力；preload 只注入最小桥接（webview-preload.cjs：
  // 仅暴露“报告密码表单提交”一个函数，供面板的保存密码提示使用）
  webPreferences.preload = path.join(here, "webview-preload.cjs");
  webPreferences.nodeIntegration = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  if (params.src && params.src !== "about:blank" && !isSafeBrowserUrl(params.src).ok) event.preventDefault();
});
const browserRuntime = createBrowserRuntime({
  get mainWindow() { return mainWindow; },
  set mainWindow(value) { mainWindow = value; },
  get ctx() { return ctx; },
  isTrustedRendererUrl,
});
const { waitForEmbeddedBrowser, browserControlManager, requestCloseEmbeddedBrowser, activeEmbeddedBrowserContents, browserPanelTabsFor, activateBrowserPanelTab, closeBrowserPanelTab, embeddedBrowserContentsById } = browserRuntime;


registerLocalImageIpc(ipcMain, {
  isTrustedSender: (event) => isTrustedRendererUrl(event.senderFrame?.url),
});

// 电脑端给渠道会话更换工作区的内存基线：sessionId -> workspacePath。
// 只对比变化，避免每次 sessions:save 都全量重读存档。入参是轻量 meta
// （id/channel/workspacePath），整档与增量两条保存路径统一形状。
let lastChannelWorkspaceBySession = new Map();

async function syncChannelSessionWorkspaces(meta) {
  for (const session of Array.isArray(meta) ? meta : []) {
    if (!session?.channel) continue;
    const id = String(session.id || "");
    const after = String(session.workspacePath || "").trim();
    const before = lastChannelWorkspaceBySession.get(id);
    lastChannelWorkspaceBySession.set(id, after);
    // 首次见到且桌面端已有有效路径时也同步一次（兼容旧版本桌面已换、渠道未同步的数据）；
    // 首次为空字符串只建立基线，避免用渲染端旧空值误清渠道记录。
    if (before !== after && (before !== undefined || after)) {
      await ctx.channelManager.updateChatWorkspaceBySession(id, after);
    }
  }
}


// 整档数组（旧渲染端）与增量对象（新渲染端）统一推导渠道同步用的轻量 meta
function channelMetaOf(sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .filter((session) => session?.channel)
    .map((session) => ({ id: session.id, channel: session.channel, workspacePath: session.workspacePath }));
}







// 渲染进程的 navigator.clipboard.write/ClipboardItem 在部分 Electron 版本不可用，
// 复制图片改走主进程原生剪贴板（clipboard.writeImage），粘贴到画图/聊天等应用最稳。

// 一次写入「文本 + 图片」：clipboard.write 会把两者放进同一剪贴板项，
// 粘贴到微信/备忘录/Word 等应用时图文一起出现。
// 同时写入 HTML 格式（dataURL 内嵌图片），让支持 HTML 粘贴的应用能同时拿到图文。

// 提交信息由独立按钮触发、用当前主模型生成：给改动统计与 diff，按内置提交信息规范输出。
// 本地 0.6B 审批小模型实测只会复读 few-shot 示例，不适合自由摘要，故走主模型。
async function generateCommitMessage(workspacePath) {
  const material = await gitCommitDiff(workspacePath);
  if (!material) throw new Error("当前没有需要提交的更改");
  const settings = await readSettings();
  if (!settings.endpoint || !settings.model || !settings.apiKey) throw new Error("请先在设置中配置模型服务");
  const controller = new AbortController();
  // 推理型模型首 token 前的思考阶段常超 30 秒，总超时给足 3 分钟；
  // 连接假死由 requestModel 内部的空闲看门狗负责中断，不靠这里的总超时兜底
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const message = await requestModel({
      // 辅助请求：能关闭思考就关闭，减少占用模型时间
      settings: summarizationSettings(settings),
      tools: false,
      fetchImpl: fetch,
      signal: controller.signal,
      messages: [
        {
          role: "system",
          content: "你负责为代码提交生成提交信息，规范如下：\n- 必须使用简体中文\n- 使用简洁的祈使句，主题不超过 50 个字符\n- 允许使用 feat、fix、docs、style、refactor、perf、test、chore 等英文类型前缀，但标题和正文必须使用中文\n- 概括改动意图，不要罗列文件名\n只输出一行提交信息，不要引号、句号、多余解释或 markdown 代码块。",
        },
        {
          role: "user",
          content: `改动统计：\n${material.stat || "（无）"}\n\n新增文件：\n${material.untracked.length ? material.untracked.join("\n") : "（无）"}\n\ndiff${material.truncated ? "（过长已截断）" : ""}：\n${material.diff || "（无）"}`,
        },
      ],
    });
    const content = typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? message.content.filter((part) => part?.type === "text").map((part) => String(part?.text || "")).join("\n")
        : "";
    const firstLine = content.split("\n").map((line) => line.trim()).filter(Boolean)[0] || "";
    const cleaned = firstLine
      .replace(/^[\"'「『]+|[\"'」』]+$/g, "")
      .replace(/^提交信息[:：]?\s*/, "")
      .replace(/^(feat|fix|docs|style|refactor|perf|test|chore)(\([^)]*\))?\s*[:：]\s*/i, "$1: ")
      .trim()
      .slice(0, 80);
    if (!cleaned) throw new Error("模型没有返回可用的提交信息");
    return cleaned;
  } catch (error: any) {
    // abort 触发的 DOMException 消息是英文 "This operation was aborted"，翻译成可读提示
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error("生成提交信息超时（3 分钟），模型响应过慢。请重试，或在设置中换用更快的模型");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}




// 已导入的浏览记录：地址栏联想用，不含敏感信息

// 待注入的 localStorage：webview 首访对应站点时取出注入，成功后确认删除

// 在系统文件管理器中定位文件（访达/资源管理器选中该文件所在目录项）
// 轨迹事件流（trace-console）：会话级 append-only jsonl，分页读取供轨迹视图回放
const safeTraceSessionId = (sessionId) => String(sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "") || "session";

// 浏览器 Computer Use 控制 IPC

// 在系统默认浏览器打开（仅 http/https，复用内置浏览器的地址白名单）

// ===== 内置浏览器密码管理 =====
// 与导入的密码同库（userData/imported-passwords.json，safeStorage 加密）。
// 列表接口不返回密码明文；填充时按 origin+username 单条解密。
const browserPasswordStorePath = () => path.join(app.getPath("userData"), "imported-passwords.json");





// ===== 清除浏览数据（仅内置浏览器的 persist 分区）=====

// ===== 设备模拟（手机/平板视图）=====

// 统计与消息设置应用：登记/启停采集、同步授权代次、重建订阅。
// 开发环境默认不连接运营服务（测试设备单独标记；本地联调用 DYWORKER_TELEMETRY_DEV=1 打开）
async function applyTelemetrySettings(settings) {
  if (!ctx.telemetryController) return;
  const devEnabled = process.env.DYWORKER_TELEMETRY_DEV === "1";
  const effective = !isDevelopment || devEnabled
    ? settings
    : { ...settings, telemetry: { ...(settings?.telemetry || {}), statsEnabled: false, messagesEnabled: false } };
  // 设置变更先停止旧订阅并隔离迟到响应，不等待设备设置的网络同步。
  if (ctx.remoteMessages) await ctx.remoteMessages.configure({ ...(effective?.telemetry || {}), messagesEnabled: false });
  await ctx.telemetryController.configure(effective);
  if (ctx.remoteMessages) await ctx.remoteMessages.configure(effective?.telemetry || {});
}

// ===== 外观自定义（独立存储 userData/appearance.json，不随模型设置整包覆盖）=====
function appearanceSnapshot(extra = {} as any) {
  return {
    ok: true,
    settings: appearanceState.settings,
    revision: appearanceState.revision,
    effective: appearanceEffective,
    capabilities: { ...appearanceCapabilities, platform: process.platform },
    ...extra,
  };
}

// nativeImage 重编码：按 EXIF 方向归一、最长边压到 3840、剥离元数据。
// 所有格式统一进行 nativeImage 解码检查；WebP 转换为受控无损 PNG 存储。
function processAppearanceImageBuffer(buffer, { format }) {
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw new Error("图片解码失败");
  const { width, height } = image.getSize();
  const longest = Math.max(width, height);
  const scaled = longest > 3840
    ? image.resize({
        width: Math.max(1, Math.round((width * 3840) / longest)),
        height: Math.max(1, Math.round((height * 3840) / longest)),
        quality: "good",
      })
    : image;
  return format === "jpeg" ? scaled.toJPEG(92) : scaled.toPNG();
}

async function applySavedAppearanceResult(result, previousImageId) {
  windowIconPreviewSettings = null;
  appearanceState = { settings: result.settings, revision: result.revision };
  syncNativeThemeSource();
  applyWindowAppearance();
  const nextImageId = result.settings.background.imageId;
  // 保存成功后才把暂存图片转正、回收旧图，避免取消预览时误删
  if (nextImageId && nextImageId !== previousImageId) {
    await commitStagedImage(appearanceAssetsDir, nextImageId).catch(() => {});
  }
  if (previousImageId && previousImageId !== nextImageId) {
    await removeAppearanceImage(appearanceAssetsDir, previousImageId).catch(() => {});
  }
}






function resolveNormalizedSettings(raw) {
  const normalized = normalizeAppearance(raw);
  return (normalized && typeof normalized === "object" && "settings" in normalized)
    ? normalized.settings
    : normalized;
}

// 原生预览只覆盖窗口底色/系统材质；纯页面样式预览在渲染端完成


async function performAppearanceReset() {
  const previousImageId = appearanceState.settings.background.imageId;
  const defaults = defaultAppearance();
  defaults.glass.lightweight = appearanceCapabilities.glassDefault === "lightweight";
  const result = await saveAppearance(appearanceFile, defaults, appearanceState.revision);
  if (result.ok) await applySavedAppearanceResult(result, previousImageId);
  return result.ok ? appearanceSnapshot() : { ok: false, error: result.error, settings: appearanceState.settings, revision: appearanceState.revision };
}


// ---- 本地代理 ----

const activeAgents = new Map();
const sessionQueue = new SessionQueue();
// 到点自动唤醒的续跑（resumeWake）不经过 executeAgentRun，必须单独登记"占用中"：
// 两种占用合并成同一条会话忙判定后，续跑期间渲染端再发消息才会进队列，
// 而不是被当成空闲会话并发起第二个 run（两个 run 同时写一个会话会让回复气泡串味）。
const wakeRuns = new Map();
const entryRuns = new Map();
const isSessionBusy = (sessionId) => activeAgents.has(String(sessionId)) || wakeRuns.has(String(sessionId)) || entryRuns.has(String(sessionId));
let mcpShuttingDown = false;

// ---- 长期记忆 ----
// 领域逻辑已上收为宿主服务 ctx.memory（host/services/memory.mts）：
// 记忆队列、内置认知覆盖表、LLM Wiki 页面读写与整合都在服务里（含整合定时器的
// dispose 清理）。本模块只保留 AgentService 解析器与桌面留痕需要的转发入口。
async function readMemoryPages(sessionId = "") {
  return await ctx.memory.pages(sessionId);
}

async function appendMemory(item, workspacePath, sessionId = "") {
  return await ctx.memory.append(item, workspacePath, sessionId);
}

function memoriesFromAgentResult(result) {
  return ctx.memory.fromAgentResult(result);
}


// ---- 工作模板 ----
// 领域逻辑已上收为宿主服务 ctx.skills（host/services/skills.mts）：
// 内置模板合并、文件技能发现、覆盖表、启停/删除都在服务里。本模块只保留
// AgentService 解析器与桌面 skill-updated 事件需要的三个转发入口。
async function readSkills(workspacePath = "") {
  return await ctx.skills.read(workspacePath);
}

async function appendSkill(item) {
  return await ctx.skills.append(item);
}

async function updateSkill(item) {
  return await ctx.skills.update(item);
}

// ---- 工具钩子：用户级 hooks.json + 工作区 .dyworker/hooks.json（格式见 AGENTS.md）----

async function readHooks(workspacePath) {
  const userRules = await readJson(dataFile("hooks.json"), []);
  let workspaceRules = [];
  if (workspacePath) {
    workspaceRules = await readJson(path.join(String(workspacePath), ".dyworker", "hooks.json"), []);
  }
  return [...(Array.isArray(userRules) ? userRules : []), ...(Array.isArray(workspaceRules) ? workspaceRules : [])];
}

// ---- token 用量统计（按模型累计，端点实测优先，估算记录 estimated 标记）----

const USAGE_STATS_LIMIT = 20000;

// 进程内缓存 + 防抖落盘：此前每次用量事件都把整个文件（上限 2 万条、可达数 MB）
// 读-改-写一遍；现在读一次常驻内存，写入合并到 1 秒一次的尾沿
let usageStatsCache = null;
let usageStatsLoadPromise = null;
let usageStatsWriteTimer = null;

async function readUsageStats() {
  if (usageStatsCache === null) {
    if (!usageStatsLoadPromise) {
      usageStatsLoadPromise = readJson(dataFile("usage-stats.json"), []).then((items) => {
        // 初始化共用一次读取；读取期间若已清空，不让旧记录覆盖清空结果。
        if (usageStatsCache === null) usageStatsCache = Array.isArray(items) ? items : [];
      }).finally(() => { usageStatsLoadPromise = null; });
    }
    await usageStatsLoadPromise;
  }
  return usageStatsCache;
}

function scheduleUsageStatsWrite() {
  if (usageStatsWriteTimer) clearTimeout(usageStatsWriteTimer);
  usageStatsWriteTimer = setTimeout(() => {
    usageStatsWriteTimer = null;
    void writeJson(dataFile("usage-stats.json"), usageStatsCache || []).catch(() => {});
  }, 1000);
}

async function appendUsageStat(event) {
  await readUsageStats();
  const items = usageStatsCache;
  items.push({
    time: new Date().toISOString(),
    model: String(event.model || "未命名模型"),
    prompt: Math.max(0, Math.round(Number(event.prompt) || 0)),
    completion: Math.max(0, Math.round(Number(event.completion) || 0)),
    estimated: event.estimated === true,
    ...Object.fromEntries(["cacheRead", "cacheWrite", "reasoning"]
      .filter(key => event[key] != null && Number.isFinite(Number(event[key])) && Number(event[key]) >= 0)
      .map(key => [key, Math.round(Number(event[key]))])),
  });
  if (items.length > USAGE_STATS_LIMIT) usageStatsCache = items.slice(-USAGE_STATS_LIMIT);
  scheduleUsageStatsWrite();
}

// ---- 跨会话历史搜索 ----

function historyMessageText(message) {
  return String(message?.content || "");
}

async function searchHistory(query, limit = 10, offset = 0) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return "请提供要查找的关键词";
  const sessions = await readAllSessions();
  const matches = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    for (let index = 0; index < (session.messages || []).length; index++) {
      const message = session.messages[index];
      const text = historyMessageText(message);
      if (!text.toLowerCase().includes(needle)) continue;
      matches.push({
        sessionId: session.id,
        title: session.title || "未命名任务",
        index,
        role: message.role,
        excerpt: text.slice(0, 160),
      });
    }
  }
  if (!matches.length) return `没有找到包含「${query}」的历史消息`;
  const page = matches.slice(offset, offset + Math.min(Math.max(limit, 1), 30));
  const lines = page.map((item) =>
    `任务 ${item.sessionId}（${item.title}）第 ${item.index} 条 [${item.role}]：${item.excerpt}`);
  const remaining = matches.length - offset - page.length;
  if (remaining > 0) lines.push(`…还有 ${remaining} 条结果，可用 offset 翻页`);
  return lines.join("\n\n");
}

async function readHistoryContext(sessionId, messageIndex, before = 4, after = 4) {
  const sessions = await readAllSessions();
  const session = (Array.isArray(sessions) ? sessions : []).find((item) => String(item.id) === String(sessionId));
  if (!session) return `没有找到任务：${sessionId}`;
  const messages = session.messages || [];
  const start = Math.max(0, messageIndex - Math.min(Math.max(before, 0), 20));
  const end = Math.min(messages.length, messageIndex + Math.min(Math.max(after, 0), 20) + 1);
  if (!messages.length || messageIndex >= messages.length) return "消息位置超出范围";
  return messages.slice(start, end)
    .map((message, i) => `第 ${start + i} 条 [${message.role}]：${historyMessageText(message).slice(0, 500)}`)
    .join("\n\n");
}
const mcpRuntime = createMcpRuntime({
  get mcpShuttingDown() { return mcpShuttingDown; },
  set mcpShuttingDown(value) { mcpShuttingDown = value; },
});
const { callMcpTool, closeAllMcpClients } = mcpRuntime;

function mcpExtraTools(...args: Parameters<typeof mcpRuntime.mcpExtraTools>) {
  return mcpRuntime.mcpExtraTools(...args);
}


// ---- 浏览器协作（可见窗口，操作可审计） ----

function agentExtraTools(mcpTools) {
  // 会话检索工具全路径开放（桌面/定时/续跑/渠道）：纯只读、数据源是本机会话存档，无审批风险。
  // 插件工具（plugin__*）也在这里进入模型可见的工具面，风险由 host/risk.mts 按名字判定为
  // 有副作用，因此和外部工具一样要走审批与审计。
  return [...mcpTools, ...browserToolDefinitions(), ...filePreviewToolDefinitions(), ...sessionToolDefinitions(), ...ctx.tools.definitions()];
}

function createExtraToolRouter(settings, workspacePath, { signal, renderer, sessionId = "", runId = "" } = {} as any) {
  const browserAgent = new BrowserAgent({
    openPanel: renderer
      ? (url, tabId, credential) =>
          waitForEmbeddedBrowser(renderer, url, tabId, {
            ownerSessionId: sessionId,
            validate: credential?.token
              ? () => browserControlManager.isOpenReservationValid(credential.token)
              : undefined
          })
      : undefined,
    closePanel: renderer ? () => requestCloseEmbeddedBrowser(renderer, sessionId) : undefined,
    getContents: (ownerSessionId) => activeEmbeddedBrowserContents({ forOwnerSessionId: ownerSessionId }),
    listTabs: (ownerSessionId) => browserPanelTabsFor(ownerSessionId),
    activateTab: (tabId, ownerSessionId) => activateBrowserPanelTab(renderer, tabId, { ownerSessionId }),
    closeTab: (tabId, ownerSessionId) => closeBrowserPanelTab(renderer, tabId, { ownerSessionId }),
    controlManager: browserControlManager,
  });
  browserAgent.setContext({ ownerSessionId: sessionId, runId });
  browserAgent.setWorkspace(workspacePath);
  if (signal) {
    signal.addEventListener("abort", () => {
      browserControlManager.pause({ reason: "任务已取消或中断" });
    });
  }
  const route = async (name, args) => {
    if (name === "open_file") return requestFilePreview(args, { workspacePath, sessionId, renderer });
    // 会话检索工具优先：只读查 sessions.json，不走浏览器/MCP
    if (SESSION_TOOL_NAMES.has(String(name))) {
      const sessions = await readAllSessions();
      return handleSessionTool(name, args, { sessions });
    }
    if (name.startsWith("browser__")) return browserAgent.handle(name, args);
    // 插件工具：经 ctx.tools 派发（内部做风险闸门与审计留痕）
    if (ctx.tools.owns(name)) {
      const executed = await ctx.tools.execute(name, args, { sessionId, runId, source: "agent", signal, workspacePath });
      if (!executed.ok) throw new Error(executed.error || "插件工具执行失败");
      return pluginToolResult(executed.result);
    }
    return callMcpTool(settings, name, args, { signal });
  };
  route.dispose = async () => { await ctx.plugins.stopRun(sessionId, runId); await browserAgent.dispose(); };
  return route;
}

function emitToSession(sender, sessionId, runId, agentEvent) {
  try {
    if (!sender || sender.isDestroyed()) return;
    sender.send("agent:event", { sessionId, runId, event: agentEvent });
  } catch {
    // 渲染进程被销毁时不向外抛错
  }
}

// 执行排队消息时，从会话存档取该条消息的最新内容（用户可能已编辑），
// 并截断到本条用户消息为止，避免把后面仍在排队的消息提前带进本轮对话。
async function queuedPayloadFromSession({ sessionId, runId, payload }) {
  const freshPayload = { ...(payload || {}) };
  try {
    const stored = await readAllSessions();
    const session = Array.isArray(stored) ? stored.find((item) => String(item?.id) === String(sessionId)) : null;
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    const queuedIndex = messages.findIndex((message) => String(message?.runId || "") === String(runId) && message?.role === "user");
    if (queuedIndex >= 0) freshPayload.messages = messages.slice(0, queuedIndex + 1);
    if (session) {
      if (typeof session.workingContext === "string") freshPayload.workingContext = session.workingContext;
      Object.assign(freshPayload, queuedGoalPayload(freshPayload, session));
    }
  } catch {
    // 读档失败时退回入队时的快照，任务照常执行
  }
  return freshPayload;
}

// 本机或内网地址的模型端点（Ollama、LM Studio、vLLM 等自建服务）。
function isLocalModelEndpoint(endpoint) {
  let host = "";
  try { host = new URL(String(endpoint || "")).hostname.replace(/^\[|\]$/g, ""); } catch { return false; }
  return host === "localhost" || host === "::1" || host.endsWith(".local")
    || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

// 会话首条消息触发、用当前主模型生成简短会话标题：与主任务并发执行，
// 不阻塞任务启动；失败静默（渲染端已有用户输入截断的兜底标题）。
async function generateSessionTitle(userText, settings) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const message = await requestModel({
      // 标题是辅助请求：能关闭思考就关闭，减少占用模型时间
      settings: summarizationSettings(settings),
      tools: false,
      fetchImpl: fetch,
      signal: controller.signal,
      messages: [
        {
          role: "system",
          content: "你负责为用户的首条请求生成会话标题，规范如下：\n- 必须使用简体中文（用户原文为英文时可用英文）\n- 不超过 16 个字符，概括请求意图\n只输出标题本身，不要引号、句号、多余解释或 markdown。",
        },
        { role: "user", content: userText.slice(0, 2000) },
      ],
    });
    const content = typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? message.content.filter((part) => part?.type === "text").map((part) => String(part?.text || "")).join("\n")
        : "";
    const firstLine = content.split("\n").map((line) => line.trim()).filter(Boolean)[0] || "";
    return firstLine.replace(/^[\"'「『#*`>]+|[\"'」』。…]+$/g, "").trim().slice(0, 40);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// 一条会话消息完整执行：原 agent:send 主体。同一会话同时只能有一个在执行，
// 其余消息进入 sessionQueue，由 drainSessionQueue 依次推进。
async function executeAgentRun({ payload: initialPayload, sender }) {
  let payload = initialPayload;
  if (mcpShuttingDown) return { status: "cancelled", reason: "应用正在退出" };
  const sessionId = String(payload?.sessionId || "").trim();
  const runId = String(payload?.runId || "").trim();
  if (!sessionId || !runId) return { ok: false, error: "任务标识无效，请新建任务后重试" };
  // 占用判定同样覆盖唤醒续跑：续跑期间入队的消息只能排队，不能起并发 run
  if (isSessionBusy(sessionId)) return { ok: false, error: "这个任务还在执行，请先停止或等待完成" };
  const abortController = new AbortController();
  // workspacePath 让渠道任务能按「同一工作区」判忙（见 workspaceBlockers），
  // 不同工作区的任务不再互相阻塞。
  const agentState = { cancelled: false, pending: new Map(), sessionId, runId, abortController, sender,
    workspacePath: String(payload?.workspacePath || "") };
  // 统一轨迹事件流（trace-console）：本 run 内所有 trace 记录先攒在内存，
  // 运行中分批追加到 userData/traces/<sessionId>.jsonl（append-only，可回放）
  const traceDir = path.join(app.getPath("userData"), "traces");
  const traceFile = path.join(traceDir, `${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "") || "session"}.jsonl`);
  const traceWriter = createTraceWriter(traceFile);
  // run 内统一重编号：子代理自带从 1 起的 seq，与主代理重叠，这里统一递增，
  // 保证 runId+seq 唯一（渲染端列表 key 与回放去重都依赖它），并同步重映射 parentSeq
  let runTraceSeq = 0;
  let lastTraceTurnStep = { turn: 0, step: 0 };
  let lastProjectedPlanContent = "";
  const seqByOriginal = new Map();
  // 流式文本事件（assistant-text / assistant-reasoning）每个 token 携带累积全文，
  // 逐 token 发 IPC 是 O(n²) 的结构化克隆；这里按 50ms 合并只发最新快照。
  // 其他事件（工具调用、收尾）到达前先冲刷缓冲，保证事件顺序不错位。
  let pendingStreamEvents = null;
  let streamFlushTimer = null;
  const flushPendingStreamEvents = () => {
    if (streamFlushTimer) {
      clearTimeout(streamFlushTimer);
      streamFlushTimer = null;
    }
    if (!pendingStreamEvents) return;
    const buffered = [...pendingStreamEvents.values()];
    pendingStreamEvents = null;
    for (const pending of buffered) emitToSession(sender, sessionId, runId, pending);
  };
  const emit = (agentEvent) => {
    if (agentEvent?.type === "assistant-text" || agentEvent?.type === "assistant-reasoning") {
      if (!pendingStreamEvents) pendingStreamEvents = new Map();
      pendingStreamEvents.set(agentEvent.type, agentEvent);
      if (!streamFlushTimer) {
        streamFlushTimer = setTimeout(() => {
          streamFlushTimer = null;
          flushPendingStreamEvents();
        }, 50);
      }
      return;
    }
    flushPendingStreamEvents();
    if (agentEvent?.type === "trace" && agentEvent.trace) {
      // 渲染端与落盘都带 runId：同会话多轮次时 trace.seq 会重置，控制台用 runId+seq 区分
      runTraceSeq += 1;
      const originalSeq = Number(agentEvent.trace.seq);
      seqByOriginal.set(originalSeq, runTraceSeq);
      const traceWithRun = {
        runId,
        ...agentEvent.trace,
        seq: runTraceSeq,
        ...(agentEvent.trace.parentSeq !== undefined && seqByOriginal.has(Number(agentEvent.trace.parentSeq))
          ? { parentSeq: seqByOriginal.get(Number(agentEvent.trace.parentSeq)) }
          : {}),
      };
      lastTraceTurnStep = { turn: Number(traceWithRun.turn) || 0, step: Number(traceWithRun.step) || 0 };
      if (traceWithRun.kind === "plan-update") lastProjectedPlanContent = String(traceWithRun.content || "");
      traceWriter.push(traceWithRun);
      emitToSession(sender, sessionId, runId, { ...agentEvent, trace: traceWithRun });
      return;
    }
    // 主进程收尾事件也投影进 trace：agent-finished 让「需求→实现」链路能出交付节点，
    // 最终的 plan-update（步骤全部 completed）让时间线步骤状态收口
    if (agentEvent?.type === "agent-finished" && agentEvent.result) {
      runTraceSeq += 1;
      const finishTrace = {
        runId,
        seq: runTraceSeq,
        time: new Date().toISOString(),
        turn: lastTraceTurnStep.turn,
        step: lastTraceTurnStep.step,
        kind: "agent-finished",
        direction: "out",
        target: "system",
        title: "任务结束",
        content: JSON.stringify(agentEvent.result),
      };
      traceWriter.push(finishTrace);
      emitToSession(sender, sessionId, runId, { type: "trace", trace: finishTrace });
    }
    if (agentEvent?.type === "plan-update" && Array.isArray(agentEvent.steps)) {
      // 避免与 agent.mjs traceEmit 已投影的同内容 plan-update 重复；只补主进程收尾的最终计划
      const content = JSON.stringify(agentEvent.steps);
      if (content !== lastProjectedPlanContent) {
        runTraceSeq += 1;
        const planTrace = {
          runId,
          seq: runTraceSeq,
          time: new Date().toISOString(),
          turn: lastTraceTurnStep.turn,
          step: lastTraceTurnStep.step,
          kind: "plan-update",
          direction: "out",
          target: "system",
          title: "计划更新",
          content,
        };
        traceWriter.push(planTrace);
        emitToSession(sender, sessionId, runId, { type: "trace", trace: planTrace });
        lastProjectedPlanContent = content;
      }
    }
    emitToSession(sender, sessionId, runId, agentEvent);
  };
  const cancelledResponse = () => {
    const result = { status: "cancelled", finalText: "" };
    emit({ type: "agent-finished", result });
    return { ok: true, result };
  };
  activeAgents.set(sessionId, agentState);
  trackTaskStart();
  try {
    // 排队消息：开始执行时从会话存档取最新内容（用户可能已编辑），
    // 并在占用会话之后读取，避免读档期间新的发送请求并发进入同一会话
    payload = await queuedPayloadFromSession({ sessionId, runId, payload });
    // 统一通知渲染端本条消息已开始执行（首条消息与队列项都适用），
    // 渲染端据此切换“排队中→执行中”并记录可停止的 runId
    emit({ type: "queue-start", count: sessionQueue.count(sessionId) });
    const settings = payload?.settings || {};
    assertDshModelSettings(payload?.runtime ?? ctx.sessions.get(sessionId)?.runtime, settings);
    const workspacePath = String(payload?.workspacePath || "").trim();
    agentState.workspacePath = workspacePath;
    const conversation = Array.isArray(payload?.messages) ? payload.messages : [];
    const latestUserText = String([...conversation].reverse().find((message) => message?.role === "user")?.content || "");
    const explicitMemories = extractExplicitMemoryInstructions(latestUserText);
    for (const memory of explicitMemories) {
      if (agentState.cancelled) return cancelledResponse();
      if (memory.scope === "workspace" && !workspacePath) continue;
      const record = await appendMemory(memory, workspacePath, sessionId);
      if (record) emit({ type: "memory-saved", item: record });
    }
    if (agentState.cancelled) return cancelledResponse();

    if (!hasConfiguredModel(settings)) {
      let filesNote = "";
      try {
        const entries = workspacePath ? await fs.readdir(workspacePath) : [];
        filesNote = workspacePath ? `文件列表读取正常（${entries.length} 项）。` : "当前还没有选择工作文件夹，选择后助手才能读取工作区资料。";
      } catch {
        filesNote = "工作文件夹暂时无法访问。";
      }
      if (agentState.cancelled) return cancelledResponse();
      const demoResult = {
        status: "done",
        demo: true,
        finalText: `这是演示模式。我已经收到你的任务。${filesNote}\n\n要让助手真正读取资料并完成任务，请在左下角“设置”中填写模型服务信息。`,
      };
      emit({ type: "agent-finished", result: demoResult });
      return { ok: true, result: demoResult };
    }

    // 首条用户消息：并发让模型生成更友好的会话标题，就绪后经 session-title 事件回传；
    // 渲染端只在用户未手动重命名过时采用，否则保留 shortTitle 的兜底标题
    const isFirstUserMessage = conversation.filter((message) => message?.role === "user").length === 1
      && !conversation.some((message) => message?.role === "assistant");
    // 本地/内网端点通常单槽位推理：标题请求与主请求并发会排队并冲刷前缀缓存，
    // 因此本地端点改为主任务结束后再生成标题；云端端点仍并发生成。
    const requestTitle = () => void generateSessionTitle(latestUserText, settings).then((title) => {
      if (title) emitToSession(sender, sessionId, runId, { type: "session-title", title });
    });
    const deferTitle = isFirstUserMessage && latestUserText.trim() && isLocalModelEndpoint(settings?.endpoint);
    if (isFirstUserMessage && latestUserText.trim() && !deferTitle) requestTitle();

    const loop = payload?.loop?.enabled
      ? { enabled: true, iteration: 1, maximum: Math.min(Math.max(Number(payload.loop.maximum) || 5, 1), 20) }
      : { enabled: false, iteration: 1, maximum: 1 };
    // 附件（图片/文本）展开为模型可读的多模态内容，同时保留思考与工具执行链
    const agentConversation = [];
    for (const message of conversation) {
      if (message?.role === "assistant" && Array.isArray(message.executedMessages) && message.executedMessages.length > 0) {
        for (const m of message.executedMessages) {
          agentConversation.push({
            role: m.role,
            content: m.content || "",
            ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
            ...(Array.isArray(m.tool_calls) && m.tool_calls.length ? { tool_calls: m.tool_calls } : {}),
            ...(m.role === "tool" && m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          });
        }
      } else {
        const entry: any = {
          role: message?.role,
          content: await providerMessageContent(message),
        };
        if (message?.role === "assistant") {
          const reasoning = String(message?.reasoning || message?.reasoning_content || "").trim();
          if (reasoning) entry.reasoning_content = reasoning;
          if (Array.isArray(message?.tool_calls) && message.tool_calls.length) {
            entry.tool_calls = message.tool_calls;
          }
        }
        if (message?.role === "tool" && message?.tool_call_id) {
          entry.tool_call_id = message.tool_call_id;
        }
        agentConversation.push(entry);
      }
    }
    const approvalMode = normalizeApprovalMode(payload?.approvalMode);
    // 服务器自报的实际上限（vLLM 等在 /models 里带 max_model_len）：本地/自建模型常远小于
    // 渲染端静态表的 128k 默认值，按默认值累积上下文会把超限请求发出去，甚至打垮引擎。
    // 探测失败（端点不支持/网络异常）返回 null，回退为渲染端报上来的值。
    const serverContextLimit = await probeServerContextLimit(settings);
    if (serverContextLimit) {
      console.log(`[agent] 服务器自报上下文上限 ${serverContextLimit}（${settings.model} @ ${settings.endpoint}），按此钳制`);
    }
    const extraTools = agentExtraTools(await mcpExtraTools(settings));
    if (agentState.cancelled) return cancelledResponse();
    // 统一代理入口：公共选项装配（hooks/记忆/技能/常驻规则/审计/MCP 工具/守卫）、
    // 循环续跑、记忆落盘与 sleeping→唤醒登记都在 ctx.agent.run 内；
    // 桌面入口只声明差异：流式合并 emit、pending-map 审批、abort 信号与循环事件
    const finalResult = await ctx.agent.run({
      settings,
      runtime: payload?.runtime,
      workspacePath,
      sessionId,
      approvalMode,
      prompt: latestUserText,
      contextLimit: (() => {
        // 渲染端按模型静态表或 k3[1M] 式显式覆盖报上来的值，不再设 30000 下限——
        // 显式写小上下文（如 model[16K]）是用户意图，需原样尊重；未上报时回退 128k。
        const requested = Number(payload?.contextLimit) || 128000;
        return serverContextLimit ? Math.max(8000, Math.min(requested, serverContextLimit)) : requested;
      })(),
      workingContext: String(payload?.workingContext || ""),
      goal: String(payload?.goal || "").trim(),
      conversation: sanitizeToolCalls(agentConversation),
      loop,
      loopStateEvents: true,
      routerOptions: { signal: abortController.signal, renderer: sender, sessionId, runId },
      requestApproval: (action, approvalSignal?: AbortSignal) => new Promise<any>((resolve) => {
        const abort = () => {
          agentState.pending.delete(action.id);
          emit({ type: "approval-withdrawn", actionId: action.id });
          resolve(false);
        };
        agentState.pending.set(action.id, value => {
          approvalSignal?.removeEventListener('abort', abort);
          resolve(value);
        });
        emit({ type: "approval-request", action });
        approvalSignal?.addEventListener('abort', abort, { once: true });
        if (approvalSignal?.aborted) abort();
      }),
      requestUserInput: (request, questionSignal?: AbortSignal) => new Promise<any>((resolve) => {
        agentState.pending.set(`q:${request.id}`, resolve);
        emit({ type: "ask-user", request });
        if (questionSignal) {
          const abort = () => { agentState.pending.delete(`q:${request.id}`); resolve({ ok: false, reason: '任务已停止' }); };
          questionSignal.addEventListener('abort', abort, { once: true });
          agentState.pending.set(`q:${request.id}`, value => { questionSignal.removeEventListener('abort', abort); resolve(value); });
          if (questionSignal.aborted) abort();
        }
      }),
      emit: (agentEvent) => {
        if (agentEvent?.type === "skill-updated" && !agentEvent.persisted) void updateSkill(agentEvent.item);
        emit(agentEvent);
      },
      isCancelled: () => agentState.cancelled,
      signal: abortController.signal,
      onCancelled: () => ctx.scheduler.cancelForSession(sessionId),
    });
    if (deferTitle) requestTitle();
    // Save the goal outcome before draining queued messages, even if the renderer is closed.
    const storedGoalSession = ctx.sessions.get(sessionId);
    const settled = settledStoredGoal(storedGoalSession, payload, finalResult);
    if (settled && settled !== storedGoalSession) await ctx.sessions.upsert(settled);
    emit({ type: "loop-state", active: false, iteration: loop.iteration, maximum: loop.maximum, status: finalResult.status === "done" ? "已完成" : finalResult.status === "unverified" ? "未验证" : "已停止" });
    emit({ type: "agent-finished", result: finalResult });
    return { ok: true, result: finalResult };
  } catch (agentError: any) {
    const reason = agentError instanceof Error ? agentError.message : String(agentError);
    emit({ type: "agent-finished", result: { status: "error", finalText: "", reason } });
    return { ok: false, error: reason };
  } finally {
    // 每秒/每批持续落盘，收尾只冲刷剩余内容；完整记录仍保留在原来的 jsonl 文件。
    // 等待最后一批写入，避免调用方收到结束后立即退出时丢掉队列中的轨迹。
    try {
      await traceWriter.close();
      if (traceWriter.stats().writtenBytes) {
        await enforceDirTotalSize(traceDir, 128 * 1024 * 1024, { keep: [traceFile] });
      }
    } catch (error) {
      console.warn("[trace] 最后一批轨迹暂未保存，进程存活期间将继续重试", error);
    }
    trackTaskEnd();
    if (activeAgents.get(sessionId) === agentState) {
      activeAgents.delete(sessionId);
      try {
        drainSessionQueue(sessionId);
      } catch (drainError: any) {
        console.warn("[agent] drainSessionQueue failed:", drainError);
      }
    }
  }
}

function drainSessionQueue(sessionId) {
  if (mcpShuttingDown) {
    sessionQueue.clear();
    return;
  }
  const entry = sessionQueue.shift(sessionId);
  if (!entry) return;
  if (!entry.sender || entry.sender.isDestroyed()) {
    drainSessionQueue(sessionId);
    return;
  }
  void executeAgentRun({ payload: entry.payload, sender: entry.sender }).then((result: any) => {
    // 出队后才发现会话被别的占用挡下（唤醒续跑抢跑的极小窗口）：放回队首等占用方收尾推进，
    // 否则这条消息既没执行也不在队列里，渲染端会永远显示"排队中"
    if (result && result.ok === false && isSessionBusy(sessionId)) {
      sessionQueue.unshift(entry);
    }
  }).catch(() => {
    // executeAgentRun 内部已把失败上报给渲染端，这里只保证队列继续推进
  });
}



// “立即执行”排队消息：提到队首并取消当前任务，
// 当前任务收尾时 drainSessionQueue 会自动从队首启动它，
// 复用既有出队链路（queue-start 事件、从存档取最新内容等）保持一致行为




// background-tasks:* 已拆到 host/plugins/background-tasks-ipc.mts（inject: ["backgroundTasksManager"]）

// memories:* 已拆到 host/plugins/memories-ipc.mts（inject: ["memory"]）




// ---- 常驻允许规则（审批卡片上的「始终允许」，借鉴 openworker standing rules）----
// 只覆盖可安全规则化的工具：工作区内按扩展名的文件写入、按域名的网页访问、按名称的外部 MCP 工具；
// 运行命令支持受信只读命令与常用开发命令（npm/python3/git 提交等）按 argv 前缀规则化，
// 系统级破坏性命令（rm/sudo/dd 等）、本机界面操作、浏览器变更操作永远逐次确认。

// 常驻规则读写收编进宿主 ctx.rules（host/services/rules.mts），本模块只剩转发，
// 供 agent 服务经解析器取用。
async function readStandingRules() {
  return await ctx.rules.list();
}

// rules:* IPC 已拆到 host/plugins/rules-ipc.mts（IPC 域拆分样板，
// 见 docs/architecture.md）：通道名与 preload 不变；领域逻辑在 ctx.rules 服务里，
// 插件用 inject: ["rules"] 声明依赖，只有 electron 边界的 trustedHandle 由壳层注入
ctx.plugin(rulesIpcPlugin({ trustedHandle }));

// skills:* / skill-libraries:*：领域在 ctx.skills（模板）+ ctx.settings（技能库源配置），
// 技能库检索/安装是纯网络+落盘能力，由壳层注入
ctx.plugin(skillsIpcPlugin({ trustedHandle, searchSkillLibraries, installSkillFromLibrary }));

// memories:*：领域在 ctx.memory（记忆队列 + wiki 页面与整合）
ctx.plugin(memoriesIpcPlugin({ trustedHandle }));

// inbox:*：领域在 ctx.inbox（无人值守审批/提问的挂起与决议）
ctx.plugin(inboxIpcPlugin({ trustedHandle }));

// schedules:* / wakes:*：领域在 ctx.scheduler（计划存储 + 调度循环）
// 「立即继续」要多跑一次壳层的 resumeWake，占用判定同样来自壳层
ctx.plugin(schedulesIpcPlugin({ trustedHandle, resumeWake, isSessionBusy }));

// git:* / workspace:context：领域是纯函数（git.mts/workspace.mts），只有"生成提交信息"要模型
ctx.plugin(gitIpcPlugin({ trustedHandle, generateCommitMessage }));

// ---- 壳层边界依赖包 ----
// host/plugins/* 不 import electron：平台能力（对话框/剪贴板/主窗口/shell）与壳层 helper
// 统一从这里取。只放"边界"能力，领域逻辑仍在各域模块或 ctx 服务里。
// 睡眠拦截热生效：保存设置后按新值更新系统级 sleep blocker（原 settings:save 内联两步）
function applyPreventSleep(settings) {
  sleepBlockMode = normalizePreventSleep(settings?.preventSleep);
  updateSleepBlocker();
}

function clearUsageStats() {
  if (usageStatsWriteTimer) {
    clearTimeout(usageStatsWriteTimer);
    usageStatsWriteTimer = null;
  }
  usageStatsCache = [];
  return writeJson(dataFile("usage-stats.json"), []).then(() => ({ ok: true }));
}

const shellDeps = {
  macStoreFileAccess,
  dataFile,
  readJson,
  writeJson,
  existsSync,
  fs,
  path,
  app,
  dialog,
  shell,
  clipboard,
  nativeImage,
  isTrustedRendererUrl,
  getMainWindow: () => mainWindow,
  builtinHooks,
  describeAttachment,
  localImagePathFromSource,
  saveClipboardImage,
  safeTraceSessionId,
  readUsageStats,
  clearUsageStats,
  // 本地模型/语音域的壳层状态与 helper（"已应用"的目录在 main 里维护）
  applyAsrSettings,
  asrSettingsFrom,
  applyTtsSettings,
  getAsrServerPath: () => asrServerPathApplied,
  transcribeAudio,
  buildWavFromPcm,
  attachmentType,
  getUpdater: () => appUpdater,
  appVersion: () => app.getVersion(),
  readAllSessions,
  readSettings,
  listWorkspace,
  syncChannelSessionWorkspaces,
  channelMetaOf,
  platform: process.platform,
  // 内置浏览器/控制权：实例与登记表都是壳层状态，经 getter 注入
  isSafeBrowserUrl,
  session,
  browserPasswordStorePath,
  safeStorage: safeStorageForHost,
  browserControlManager,
  getEmbeddedBrowserContents: (id) => embeddedBrowserContentsById.get(id),
  // 桌面会话任务入口的壳层状态与执行函数（运行期 Map/队列 + 任务执行）
  isShuttingDown: () => mcpShuttingDown,
  activeAgents,
  sessionQueue,
  // 会话忙判定（前台 run ∪ 唤醒续跑）：agent:send 的排队判定必须与调度器共用同一份
  isSessionBusy,
  // 唤醒续跑中止信号（agent:cancel 用来打断无人值守续跑）
  wakeRuns, entryRuns,
  emitToSession,
  executeAgentRun,
  executeChildRun: createChildEntry({sessions:ctx.sessions,agent:ctx.agent,readSettings,
    isShuttingDown:()=>mcpShuttingDown,isSessionBusy,activeAgents,
    queueCount:(id)=>sessionQueue.count(id),drainSessionQueue,trackStart:trackTaskStart,trackEnd:trackTaskEnd,
    emit:(sender,envelope)=>{try {if(sender&&!sender.isDestroyed())sender.send('agent:event',envelope);}catch {}}}),
  // 设置保存要联动的域（睡眠拦截/审核模型/语音/渠道/运营）
  mcpStats: async () => mcpRuntime.cachedMcpStats(await readSettings()),
  importMcpBundle: async () => {
    const result = await dialog.showOpenDialog(mainWindow, {properties: ['openFile'], filters: [{name: 'MCP Bundle', extensions: ['mcpb']}]});
    if (result.canceled) return {canceled: true};
    return {ok: true, server: await importMcpBundle(result.filePaths[0], path.join(app.getPath('userData'), 'mcp-bundles'))};
  },
  saveSettings,
  applyPreventSleep,
  applyReviewerModelDir,
  reconcileChannels,
  applyTelemetrySettings,
  providerMessageContent,
};

ctx.plugin(tracesIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(usageHooksIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(auditIpcPlugin());
// 插件管理通道（走契约层：ctx.ipc / ctx.plugins）
ctx.plugin(pluginsIpcPlugin());
ctx.plugin(pluginApiIpcPlugin());
ctx.plugin(windowIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(attachmentsIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(clipboardIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(workspaceIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(appUpdateIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(localModelsIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(speechIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(settingsIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(sessionsIpcPlugin({ trustedHandle, ...shellDeps }));
// 任务/项目跨机迁移：导出包打包与导入落盘（领域逻辑在 session-transfer.mts）
ctx.plugin(transferIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(appIpcPlugin({ trustedHandle, ...shellDeps }));

// 外观域的壳层状态桥：外观状态与应用逻辑被设置页/应用菜单/系统主题事件共用，
// 仍留在 main；IPC 插件经这层读写同一份状态（不复制出去）。
const appearanceBridge = {
  getState: () => appearanceState,
  setState: (next) => { appearanceState = next; },
  getEffective: () => appearanceEffective,
  setEffective: (next) => { appearanceEffective = next; },
  capabilities: appearanceCapabilities,
  file: appearanceFile,
  assetsDir: appearanceAssetsDir,
  snapshot: () => appearanceSnapshot(),
  syncThemeSource: () => syncNativeThemeSource(),
  applyWindow: () => applyWindowAppearance(),
  applyWindowIcon: (settings) => windowIcons.apply(mainWindow, resolvedAppearanceTheme(settings)),
  applyDockIcon: (settings) => dockIcons.apply(settings.dockIcon),
  setWindowIconPreview: (settings) => { windowIconPreviewSettings = settings; },
  resolvedTheme: (settings) => resolvedAppearanceTheme(settings),
  applySavedResult: (result, previousImageId) => applySavedAppearanceResult(result, previousImageId),
  processImageBuffer: (buffer, options) => processAppearanceImageBuffer(buffer, options),
  resolveNormalizedSettings: (raw) => resolveNormalizedSettings(raw),
  reset: () => performAppearanceReset(),
};

ctx.plugin(appearanceIpcPlugin({ trustedHandle, bridge: appearanceBridge, dialog, nativeTheme, getMainWindow: () => mainWindow }));
ctx.plugin(browserIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(browserControlIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(browserImportIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(agentIpcPlugin({ trustedHandle, ...shellDeps, drainSessionQueue }));
ctx.plugin(chatIpcPlugin({ trustedHandle, ...shellDeps }));

// tools/pre-execute 策略接缝的第一个真实消费者：敏感凭据文件强制确认。
// 事件只收紧不放行，因此在 full-access/auto 下也能拦住读取私钥、.env、凭据库；
// 命中后走正常审批链路（含审计、收件箱、IM 卡片），不绕过既有治理
ctx.plugin(sensitivePathGuardPlugin());

// ---- 审批收件箱 ----
// 状态与语义已上收为宿主服务 ctx.inbox（host/services/inbox.mts）：条目落盘、
// 决议恢复、超时收尾、孤儿兜底都在服务里，逐条有 tests/inbox.test.mjs 钉住。
// 本模块保留两个 electron 边界回调（注入给服务）与 IPC 插件挂载点。

// 收件箱有变化 → 通知渲染端刷新（作为 inboxBroadcast 注入）
function broadcastInboxChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("inbox:changed");
}

// 新条目 → 弹系统通知，点击聚焦窗口并定位到该条目（作为 inboxNotify 注入）。
// 通知能力取决于平台与安装配置，不支持时静默跳过，不影响业务流程。
function notifyInboxItem(item) {
  if (typeof Notification?.isSupported === "function" && Notification.isSupported()) {
    try {
      const notifTitle = item.kind === "question" ? "DYWorker 任务提问" : "DYWorker 审批申请";
      const notifBody = item.title || (item.kind === "question" ? "后台任务有新的提问需要您回复" : "自动任务申请执行关键操作，请确认");
      const notification = new Notification({
        title: notifTitle,
        body: notifBody,
        silent: false,
      });
      notification.on("click", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
          mainWindow.webContents.send("inbox:focus-item", item);
        }
      });
      notification.show();
    } catch {
      // 系统通知失败不影响业务流程
    }
  }
}

// inbox:* IPC 已拆到 host/plugins/inbox-ipc.mts（inject: ["inbox"]）



// ---- 使用统计与运营消息（受信 IPC：不暴露设备凭据，凭据只在主进程保存）----

// 渲染端人工活动信号（点击/按键/滚动节流后 fire-and-forget）：只记录发生时间
ipcMain.on("telemetry:activity", (event) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return;
  ctx.telemetryController?.noteUserActivity();
});

// telemetry:* / system-messages:* 已拆到 host/plugins/telemetry-ipc.mts
// （inject: ["telemetryController", "remoteMessages"]，在 createWindow() 之前挂载）

// memories:delete / memories:lint 同上，已拆到 host/plugins/memories-ipc.mts


// skills:* / skill-libraries:* 已拆到 host/plugins/skills-ipc.mts
// （inject: ["skills", "settings"]）；技能库检索/安装能力由壳层注入

// ---- 定时计划 ----



function broadcastSchedulesChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("schedules:changed");
}

// 计划运行开始：起跑前先把本次运行的会话标识与元信息推给渲染端。渲染端据此立刻建出
// 会话（用户消息 + 流式占位气泡），后续 agent:event（scheduleRun 打标）边跑边填充。
// 以前只在结束/挂起时才 sessions:prepend 整段转录，一个跑二十分钟的计划在这段时间里
// 「最近任务」里什么都没有——用户点了「立即执行」只能干等，分不清是在跑还是没跑起来。
function sendScheduleRunStarted(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("schedules:run-started", payload);
}




// 运行历史：每次执行追加一条（时间/结果/关联会话 id），保留最近 10 条；
// 会话 id 对应的转录会话可在任务列表中打开，查看完整过程


// 定时/续跑任务的转录落盘：应用窗口未运行时，主进程直接把带完整转录的会话
// 写进 sessions.json（下次启动经 app:initial-state 读回），不再丢失运行记录
// 窗口未运行时计划任务的转录落盘：写进按会话拆分的存档（下次启动经
// app:initial-state 读回），不再丢失运行记录
async function persistSessionRecord(session) {
  try {
    await sessionArchive.replace(session);
  } catch (error: any) {
    console.log(`[schedules] 转录落盘失败：${error?.message || error}`);
  }
}

// 窗口未运行时的续跑追加：往已落盘的会话里补转录消息（按消息内容去重，避免重复段落）
async function persistSessionAppend(sessionId, messages) {
  try {
    await sessionArchive.appendMessages(sessionId, messages);
  } catch (error: any) {
    console.log(`[schedules] 续跑转录落盘失败：${error?.message || error}`);
  }
}
// wakes.json 条目：{ id, sessionId, scheduleId?, workspacePath, approvalMode, wakeAt, reason,
//   prompt, finalText, status: "pending" | "fired" | "cancelled", createdAt, firedAt? }
// pending → fired 一次性转移,杜绝重复唤醒;会话被删除/任务被取消时置 cancelled。







// 从会话存档中重建可见对话（只读,渲染端仍是唯一写者）；找不到时退回唤醒记录里的提示与进展
async function visibleConversationForSession(sessionId, fallbackPrompt, fallbackFinalText) {
  const sessions = await readAllSessions();
  const session = Array.isArray(sessions) ? sessions.find((item) => String(item?.id) === String(sessionId)) : null;
  const visible = (session?.messages || [])
    .filter((message) => message?.role === "user" || message?.role === "assistant" || message?.role === "tool")
    .map((message) => {
      const entry: any = { role: message.role, content: String(message.content || "") };
      if (message.role === "assistant") {
        const reasoning = String(message.reasoning || message.reasoning_content || "").trim();
        if (reasoning) entry.reasoning_content = reasoning;
        if (Array.isArray(message.tool_calls) && message.tool_calls.length) entry.tool_calls = message.tool_calls;
        if (Array.isArray(message.executedMessages) && message.executedMessages.length) entry.executedMessages = message.executedMessages;
      }
      if (message.role === "tool" && message.tool_call_id) entry.tool_call_id = message.tool_call_id;
      return entry;
    })
    .filter((message) => message.content.trim() || message.reasoning_content || message.tool_calls || message.executedMessages?.length)
    .slice(-20);
  if (visible.length) return visible;
  const fallback = [];
  if (fallbackPrompt) fallback.push({ role: "user", content: fallbackPrompt });
  if (fallbackFinalText) fallback.push({ role: "assistant", content: fallbackFinalText });
  return fallback;
}

async function workingContextForSession(sessionId) {
  const sessions = await readAllSessions();
  const session = Array.isArray(sessions) ? sessions.find((item) => String(item?.id) === String(sessionId)) : null;
  if (!session) return "";
  const messageContext = [...(session.messages || [])]
    .reverse()
    .find((message) => Object.prototype.hasOwnProperty.call(message || {}, "workingContext"))
    ?.workingContext;
  return String(session.workingContext ?? messageContext ?? "").trim();
}
const automationRuntime = createAutomationRuntime({
  get ctx() { return ctx; },
  trackTaskStart,
  get wakeRuns() { return wakeRuns; },
  get mainWindow() { return mainWindow; },
  set mainWindow(value) { mainWindow = value; },
  readSettings,
  visibleConversationForSession,
  workingContextForSession,
  get CHANNEL_STREAM_EVENT_TYPES() { return CHANNEL_STREAM_EVENT_TYPES; },
  persistSessionAppend,
  trackTaskEnd,
  drainSessionQueue,
  broadcastSchedulesChanged,
  get entryRuns() { return entryRuns; },
  sendScheduleRunStarted,
  persistSessionRecord,
});
const { createTranscriptCollector } = automationRuntime;

function resumeWake(...args: Parameters<typeof automationRuntime.resumeWake>) {
  return automationRuntime.resumeWake(...args);
}

function runScheduledTask(...args: Parameters<typeof automationRuntime.runScheduledTask>) {
  return automationRuntime.runScheduledTask(...args);
}




// ---- IM 消息渠道(QQ 官方机器人 / 微信 ClawBot)----
// IM 消息 → 渠道任务(与定时任务同构):串行队列 + 同一工作区忙碌守卫,审批/提问同时进收件箱与 IM。
// 渠道任务占用用计数而非布尔：多个聊天队列可能先后放行，
// 一个任务结束时不能把仍执行中的其他渠道任务误判为空闲。
let runningChannelTaskCount = 0;
// 渠道任务的按聊天中止:「停止」指令把 chatKey 放进 aborts,等待工作区空闲的循环与 runAgent 的 isCancelled 都认它
const channelTaskKeys = new Set<string>(); // 等待工作区空闲中 + 执行中的渠道任务 chatKey
const channelTaskAborts = new Set<string>(); // 收到「停止」的 chatKey

async function readChannelChats() {
  const stored = await readJson(dataFile("channel-chats.json"), {});
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

// 微信扫码登录凭据:safeStorage 加密后单独落盘,不进 settings(避免渲染端陈旧值覆盖)
async function readWechatCredentials() {
  const stored = await readJson(dataFile("channel-credentials.json"), {});
  if (!stored || typeof stored !== "object") return {};
  return {
    token: decryptChannelSecret(stored.wechatToken, stored.wechatTokenEncrypted === true, safeStorage),
    userId: String(stored.wechatUserId || ""),
    baseUrl: String(stored.wechatBaseUrl || ""),
  };
}

async function writeWechatCredentials(credentials) {
  const secret = encryptChannelSecret(credentials.token, safeStorage);
  await writeJson(dataFile("channel-credentials.json"), {
    wechatToken: secret.value,
    wechatTokenEncrypted: secret.encrypted,
    wechatUserId: String(credentials.userId || ""),
    wechatBaseUrl: String(credentials.baseUrl || ""),
  });
}

// 微信凭据被服务端判定过期(errcode -14)时清空落盘凭据:
// 不重启应用时适配器会自动弹扫码;重启后直接进扫码登录,不再拿死 token 撞错
async function clearWechatCredentials() {
  await writeJson(dataFile("channel-credentials.json"), {});
}

function broadcastChannelsStatus(statusMap) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("channels:status", statusMap);
  }
}

// 渠道会话的工作区推导:与 app:initial-state 同款,取最近一个带工作区的会话
async function defaultChannelWorkspace() {
  const sessions = await readAllSessions();
  // 只接受非空字符串,避免把历史脏数据(对象/占位字符串)再次当作工作区
  return (Array.isArray(sessions) ? sessions : []).find((session) =>
    typeof session?.workspacePath === "string" && session.workspacePath.trim()
  )?.workspacePath || "";
}

// 入站媒体暂存目录:userData/channel-media（决策记录第 9 节：不写进工作区，只当数据读取）。
// 目录本身由各适配器下载时递归创建，这里只提供同步路径供 createChannelManager 注入。
function channelMediaDir() {
  return path.join(app.getPath("userData"), "channel-media");
}

// 微信 ClawBot SDK 的本地状态目录：打包后的应用从访达/程序坞启动时 process.cwd() 是 /，
// SDK 默认拼出 /.weixin-clawbot 会导致 mkdir ENOENT；固定放到 userData 下规避。
function channelWechatStateRoot() {
  return path.join(app.getPath("userData"), "wechat-state");
}

// 渠道域实例由插件在 apply 时创建（ctx.channelManager）：本模块只提供依赖
// （领域回调 + 路径），不再持有模块级渠道管理器。挂载点见下方 ctx.plugin。
ctx.plugin(channelsPlugin(() => createChannelManager({
  readChats: readChannelChats,
  writeChats: (chats) => writeJson(dataFile("channel-chats.json"), chats),
  mediaDir: channelMediaDir(),
  wechatStateRoot: channelWechatStateRoot(),
  onStatus: broadcastChannelsStatus,
  onRunTask: runChannelTask,
  onResolvePending: async ({ channel, pending, replyText, userName }) => {
    // 决议来源标注到人：审批留痕可追溯到具体 IM 用户（群聊里即任务发起人）
    const via = `${CHANNEL_LABELS[channel] || channel}${userName ? `·${String(userName).slice(0, 24)}` : ""}`;
    if (pending.kind === "approval") {
      const approved = parseApprovalReply(replyText);
      if (approved === null) return false;
      const result = await ctx.inbox.resolve(pending.itemId, { approved, via });
      return result.ok;
    }
    // 提问:序号命中选项,否则取原文
    let answer = String(replyText || "").trim();
    if (/^\d+$/.test(answer) && Array.isArray(pending.options) && pending.options.length) {
      const index = Number(answer) - 1;
      if (index < 0 || index >= pending.options.length) return false;
      answer = pending.options[index];
    }
    if (!answer) return false;
    const result = await ctx.inbox.resolve(pending.itemId, { answer, via });
    return result.ok;
  },
  onSaveWechatCredentials: writeWechatCredentials,
  onWechatSessionExpired: clearWechatCredentials,
  defaultWorkspace: defaultChannelWorkspace,
  onDebug: (payload) => channelDebug("渠道入站", payload),
  // 「停止」:中止该聊天执行中/等待工作区空闲的任务,并把挂起的审批/提问按取消决议
  onStopChat: async ({ channel, key, pending }) => {
    if (pending?.itemId) {
      const via = CHANNEL_LABELS[channel] || channel;
      ctx.inbox.expireNow(pending.itemId, `用户通过${via}停止了任务`);
    }
    if (!channelTaskKeys.has(key)) return false;
    channelTaskAborts.add(key);
    for (const run of entryRuns.values()) if (run.chatKey===key) run.abort.abort();
    return true;
  },
  // 排队提示附带当前阻塞原因,让用户知道在等什么。
  // 只有同一工作区的任务才会阻塞渠道任务，别的工作区的桌面任务/定时任务不算。
  queueWaitHint: ({ workspacePath = "" } = {} as any) => {
    const blockers = workspaceBlockers(workspacePath);
    const hint = blockers.length
      ? `同一工作目录下的${blockers[0].kind}正在执行（可能在等待审批）`
      : "";
    // 排队提示出现时记录判忙依据：没有同工作区占用却仍在排队，说明队列本身没前进，
    // 这是排查"排队后不执行"的关键证据。
    channelDebug("排队提示", {
      workspacePath,
      blockers: blockers.map((item) => item.kind),
      activeAgents: activeAgents.size,
      runningScheduledTask: ctx.scheduler.running,
      runningChannelTaskCount,
      hint,
    });
    return hint;
  },
})));

// 渠道域就绪后挂它的 IPC 插件（inject: ["channelManager"]；规则同下）
ctx.plugin(channelsIpcPlugin({ trustedHandle }));

// 运行期域挂载点（channels 已在自身创建点 ctx.plugin，此处是其余域）。
// ctx.plugin 在模块顶层执行：createHost 的 registerService 回调在顶层 await 期间跑，
// 那时本模块靠后的声明仍处于 TDZ（曾因此启动即崩），所以域插件一律在依赖绑定就绪
// 之后挂载。注册顺序决定 dispose 逆序：channels 先注册 → 退出时先停后台任务再停渠道
// （与旧 before-quit 手工链同序）。
ctx.plugin(backgroundTasksPlugin(() => createBackgroundTasksManager()));
ctx.plugin(backgroundTasksIpcPlugin({ trustedHandle }));

async function reconcileChannels() {
  const settings = await readSettings();
  const wechatCredentials = settings.channels?.wechat?.enabled ? await readWechatCredentials() : {};
  await ctx.channelManager.reconcile({
    qq: settings.channels?.qq || {},
    wechat: { ...(settings.channels?.wechat || {}), ...wechatCredentials },
  });
}
const channelRuntime = createChannelRuntime({
  describeAttachment,
  readSettings,
  readChannelChats,
  writeJson,
  dataFile,
  channelDebug,
  get channelTaskKeys() { return channelTaskKeys; },
  defaultChannelWorkspace,
  get mcpShuttingDown() { return mcpShuttingDown; },
  set mcpShuttingDown(value) { mcpShuttingDown = value; },
  get channelTaskAborts() { return channelTaskAborts; },
  workspaceBlockers,
  get activeAgents() { return activeAgents; },
  get ctx() { return ctx; },
  get runningChannelTaskCount() { return runningChannelTaskCount; },
  set runningChannelTaskCount(value) { runningChannelTaskCount = value; },
  trackTaskStart,
  get entryRuns() { return entryRuns; },
  get mainWindow() { return mainWindow; },
  set mainWindow(value) { mainWindow = value; },
  get CHANNEL_STREAM_EVENT_TYPES() { return CHANNEL_STREAM_EVENT_TYPES; },
  transcribeQqVoice,
  visibleConversationForSession,
  createExtraToolRouter,
  createTranscriptCollector,
  workingContextForSession,
  providerMessageContent,
  trackTaskEnd,
  drainSessionQueue,
});
const { runChannelTask } = channelRuntime;


// 渠道任务实时透传给渲染端的事件白名单：只转发会改变 UI 的轻量事件
// （活动流、正文流式、思考流、计划、循环状态、文件变更、审批/提问、上下文用量、任务开始/结束）。
// trace / token-usage / skill-saved / memory-saved 等只进本地留痕与统计，不打扰界面。
const CHANNEL_STREAM_EVENT_TYPES = new Set([
  "queue-start",
  "activity",
  "activity-update",
  "assistant-text",
  "assistant-reasoning",
  "dsh-conversation",
  "file-change",
  "plan-update",
  "loop-state",
  "approval-request",
  "ask-user",
  "context-usage",
  "context-compacted",
  "agent-finished",
]);

// 当前所有正在执行的任务（含各自占用的工作区）。三种占用分开登记过，这里汇总成
// 判忙用的视图：桌面任务在 activeAgents、到点续跑在 wakeRuns、定时/渠道任务在 entryRuns。
function runningTaskEntries() {
  const list = [];
  for (const [sessionId, state] of activeAgents) list.push({ sessionId, workspacePath: state?.workspacePath, kind: "电脑端任务" });
  for (const [sessionId, run] of wakeRuns) list.push({ sessionId, workspacePath: run?.workspacePath, kind: run?.kind || "续跑任务" });
  for (const [sessionId, run] of entryRuns) list.push({ sessionId, workspacePath: run?.workspacePath, kind: run?.kind || "另一个渠道任务" });
  return list;
}

// 工作区维度的占用判定。不同工作区各写各的目录，互不影响；只有同一工作区的两个任务
// 同时跑才可能互相覆盖文件，才需要互斥。
// 早前渠道任务等的是「整机空闲」（任何桌面任务、定时任务、其他渠道任务都算占用），
// 电脑端一有长任务，QQ/微信消息就干等满 10 分钟再被丢弃——这是"每次都超过 10 分钟"的成因。
function workspaceBlockers(workspacePath, ignoreSessionId = "") {
  return findWorkspaceBlockers(runningTaskEntries(), workspacePath, ignoreSessionId);
}

// channels:get-status 已拆到 host/plugins/channels-ipc.mts（inject: ["channelManager"]）






// Linux 不启用整窗鼠标穿透：边缘移入与点击之间存在竞态，且部分桌面
// 无法可靠查询全局光标，轮询不能保证恢复。保留旧消息的安全兼容处理，
// 无论请求值或最大化/阴影状态如何，都恢复接收输入。
ipcMain.on("window:set-ignore-mouse", (event, _ignore) => {
  if (process.platform !== "linux") return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (event.sender !== mainWindow.webContents) return;
  mainWindow.setIgnoreMouseEvents(false);
});

app.whenReady().then(async () => {
  const failedBookmarks = await macStoreFileAccess.restore();
  if (failedBookmarks.length) console.warn(`[dyworker] ${failedBookmarks.length} 个工作区需要重新选择以恢复文件授权`);
  // 插件客户端 bundle 协议：dyworker-plugin://client/<条目id>/<序号>
  protocol.handle("dyworker-plugin", async (request) => {
    const notFound = (message) => new Response(`// ${message}\n`, {
      status: 404, headers: { "content-type": "text/javascript; charset=utf-8" },
    });
    try {
      const url = new URL(request.url);
      if (url.hostname === "bundle") {
        const combo = url.search.startsWith("??") ? url.search.slice(2).split("&")[0] : null;
        const resource = combo || url.pathname.slice(1);
        const end = resource.lastIndexOf("/");
        if (end < 1) return notFound("插件资源地址不合法");
        const owner = decodeURIComponent(resource.slice(0, end));
        const fileName = decodeURIComponent(resource.slice(end + 1));
        const rev = /[?&]rev=([^&]+)/.exec(request.url)?.[1];
        const file = await ctx.plugins.clientResourceFile(owner, fileName, rev && decodeURIComponent(rev));
        return new Response(await fs.readFile(file, "utf8"), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
      }
      const segments = url.pathname.split("/").filter(Boolean);
      if (!segments.length) return notFound("协议地址不合法");
      const index = Number(segments[segments.length - 1] ?? "0");
      if (!Number.isInteger(index) || index < 0) return notFound("协议地址不合法");
      // client/<条目id>/<序号>：插件自己的客户端半边
      // module/<客户端模块包名>/<序号>：插件声明的客户端模块（dsh.client.inject）
      const kind = url.hostname;
      const target = decodeURIComponent(segments.slice(0, -1).join("/"));
      if (!target) return notFound("协议地址不合法");
      const file = kind === "client"
        ? await ctx.plugins.clientBundleFile(target, index)
        : kind === "module"
          ? ctx.plugins.clientModuleFile(target, index)
          : null;
      if (!file) return notFound(`未知的插件协议主机：${kind}`);
      const source = await fs.readFile(file, "utf8");
      return new Response(source, {
        headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" },
      });
    } catch (error) {
      // 插件 bundle 加载失败必须留痕：否则渲染端只能看到"脚本加载失败"，无从定位
      console.warn(`[plugin-protocol] ${request.url} → ${String((error as any)?.message || error)}`);
      return notFound(String((error as any)?.message || error));
    }
  });

  // 启动快照：在任何读写（迁移/窗口/渲染端保存）之前，先把用户不可再生的状态文件复制一份。
  // 与业务逻辑完全解耦的兜底——即使写入路径整个坏掉，也还有 .backups/<时间戳>/ 可回滚。
  await snapshotCriticalFiles({ dir: app.getPath("userData") });
  await migrateLegacyDataOnFirstRun();
  // 旧扁平记忆列表一次性迁移成 wiki 页面（迁移前自动备份 memory.json）
  void ctx.memory.wikiReady().catch((error) => console.log(`[memory-wiki] 迁移失败：${error?.message || error}`));
  const storedSettings = await readSettings();
  sleepBlockMode = storedSettings.preventSleep;
  updateSleepBlocker();
  // 外观先读取再建窗，窗口底色/主题从启动即与用户选择一致，避免默认色闪烁
  const storedAppearance = await readAppearance(appearanceFile);
  appearanceState = { settings: storedAppearance.settings, revision: storedAppearance.revision };
  if (storedAppearance.source === "default" && appearanceCapabilities.glassDefault === "lightweight") {
    appearanceState.settings.glass.lightweight = true;
  }
  syncNativeThemeSource();
  installApplicationMenu();
  // 启动时清理未被已保存配置引用的暂存/孤儿图片（不误删当前引用）
  void collectOrphanAssets(
    appearanceAssetsDir,
    [appearanceState.settings.background.imageId].filter(Boolean),
  ).catch(() => {});
  // 使用统计与运营消息：初始化后按设置决定是否登记/采集/订阅；服务不可用时静默降级。
  // 实例由插件在 apply 时创建（ctx.telemetryController / ctx.remoteMessages），壳层只提供依赖。
  // 必须排在 createWindow() 之前：这两个服务是 telemetryIpcPlugin 的 inject 依赖，
  // 依赖未就绪时对应的 IPC 通道尚未注册，而窗口一创建渲染端就会开始 invoke。
  await ctx.plugin(telemetryPlugin(() => createTelemetryController({
    userDataDir: app.getPath("userData"),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    releaseChannel: app.isPackaged ? "stable" : "dev",
    secretStorage: safeStorageForHost,
    onRegistered: () => {
      // 设备登记完成后立即补拉消息并建立实时订阅
      ctx.remoteMessages?.noteOnline();
    },
  })));
  // 运营消息 inject 用量统计，故先 await 前者就绪
  await ctx.plugin(remoteMessagesPlugin((hostCtx) => createRemoteMessagesManager({
    file: dataFile("system-messages.json"),
    client: hostCtx.telemetryController.getClient(),
    showNotification: showRemoteMessageNotification,
    onChanged: broadcastSystemMessagesChanged,
  })));
  await applyTelemetrySettings(storedSettings);
  ctx.telemetryController.start();
  ctx.remoteMessages.start();
  // 两个服务都就绪后再挂 IPC 插件（inject 满足即注册通道，早于窗口创建）
  await ctx.plugin(telemetryIpcPlugin({ trustedHandle }));
  createWindow();
  ctx.backgroundTasksManager.setBroadcastCallback((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("background-tasks:update", event);
    }
  });
  // 窗口先创建，自动更新初始化不阻塞界面；electron-updater 缺失时仅禁用更新
  // 启动 8 秒后、之后每 6 小时静默自动检查一次新版本（不改 checking 状态，只在发现新版本时推送）
  void loadElectronUpdater().then((updater) => {
    initializeAppUpdater(storedSettings.updateUrl, updater);
    if (app.isPackaged && !process.mas) {
      const silentCheck = () => void appUpdater?.check({ silent: true });
      appUpdateTimer = setTimeout(silentCheck, 8_000);
      appUpdateInterval = setInterval(silentCheck, 6 * 60 * 60 * 1000);
    }
  });
  await ctx.inbox.expireOrphaned();
  // 启动调度（内部会先恢复中断的计划，再挂 10s tick / 首帧补偿 / 近邻唤醒定时器）
  await ctx.scheduler.start();
  // 平台事件：睡眠恢复/解锁后立即补跑一次到期检查（electron 边界留在壳层）
  if (typeof powerMonitor?.on === "function") {
    const catchUp = () => {
      void ctx.scheduler.checkDueWakes();
      void ctx.scheduler.checkDueSchedules();
      void ctx.scheduler.scheduleNextWakeCheck();
    };
    powerMonitor.on("resume", catchUp);
    powerMonitor.on("unlock-screen", catchUp);
  }
  // 电源事件：睡眠/锁屏立即封口使用区间（区间恢复后不补记）；恢复/解锁后补拉消息
  if (typeof powerMonitor?.on === "function") {
    powerMonitor.on("suspend", () => ctx.telemetryController?.noteSuspend());
    powerMonitor.on("resume", () => {
      ctx.telemetryController?.noteResume();
      ctx.remoteMessages?.noteOnline();
    });
    // lock-screen/unlock-screen 仅 macOS/Windows 支持；Linux 靠窗口状态与输入超时保守处理
    powerMonitor.on("lock-screen", () => ctx.telemetryController?.noteLocked());
    powerMonitor.on("unlock-screen", () => {
      ctx.telemetryController?.noteUnlocked();
      ctx.remoteMessages?.noteOnline();
    });
  }
  // IM 渠道(QQ/微信)按设置启动;失败不影响主程序
  void reconcileChannels().catch(() => { });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let mcpShutdownStarted = false;
app.on("before-quit", (event) => {
  if (mcpShutdownStarted) return;
  mcpShutdownStarted = true;
  mcpShuttingDown = true;
  event.preventDefault();
  // 用量统计的防抖写也立即落盘，避免丢失最后一秒的记录
  if (usageStatsWriteTimer) {
    clearTimeout(usageStatsWriteTimer);
    usageStatsWriteTimer = null;
    void writeJson(dataFile("usage-stats.json"), usageStatsCache || []).catch(() => {});
  }
  if (appUpdateTimer) clearTimeout(appUpdateTimer);
  if (appUpdateInterval) clearInterval(appUpdateInterval);
  appUpdateTimer = null;
  appUpdateInterval = null;
  for (const agentState of activeAgents.values()) {
    agentState.cancelled = true;
    for (const resolve of agentState.pending.values()) resolve(false);
    agentState.pending.clear();
  }
  void ctx.inbox.expireAll("应用在等待处理期间关闭，任务已终止")
    .catch(() => { })
    .finally(async () => {
      // 待决议条目清空后再停域：等待审批的 IM 任务要靠渠道适配器把「任务已终止」
      // 回给用户，渠道先停会让这条消息发不出去（旧 before-quit 手工链把
      // ctx.channelManager.stopAll() 放在 expireAllPendingInbox 之后）。
      // disposeHost 现在会 await 各域停机与会话存档 flush；上限 1.5s 只防网络
      // 收尾拖住退出，定时器 unref 不会自己撑住进程。
      await Promise.race([
        Promise.resolve(disposeHost(ctx)).catch((error) => {
          console.warn("[dyworker] 宿主 dispose 失败：", error);
        }),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 1_500);
          timer.unref?.();
        }),
      ]);
      await closeAllMcpClients();
      await macStoreFileAccess.dispose();
      app.quit();
    });
});
