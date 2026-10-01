import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, powerMonitor, powerSaveBlocker, safeStorage, screen, session, shell } from "electron";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHost, disposeHost } from "./host/context.mts";
import { UNATTENDED_PENDING_TIMEOUT_MS } from "./host/services/inbox.mts";
import { channelsPlugin, telemetryPlugin, remoteMessagesPlugin, backgroundTasksPlugin } from "./host/services/runtime-domains.mts";
import { rulesIpcPlugin } from "./host/plugins/rules-ipc.mts";
import { sensitivePathGuardPlugin } from "./host/plugins/sensitive-path-guard.mts";
import { inboxIpcPlugin } from "./host/plugins/inbox-ipc.mts";
import { schedulesIpcPlugin } from "./host/plugins/schedules-ipc.mts";
import { gitIpcPlugin } from "./host/plugins/git-ipc.mts";
import { tracesIpcPlugin } from "./host/plugins/traces-ipc.mts";
import { usageHooksIpcPlugin } from "./host/plugins/usage-hooks-ipc.mts";
import { auditIpcPlugin } from "./host/plugins/audit-ipc.mts";
import { windowIpcPlugin } from "./host/plugins/window-ipc.mts";
import { attachmentsIpcPlugin } from "./host/plugins/attachments-ipc.mts";
import { clipboardIpcPlugin } from "./host/plugins/clipboard-ipc.mts";
import { workspaceIpcPlugin } from "./host/plugins/workspace-ipc.mts";
import { appUpdateIpcPlugin } from "./host/plugins/app-update-ipc.mts";
import { localModelsIpcPlugin } from "./host/plugins/local-models-ipc.mts";
import { speechIpcPlugin } from "./host/plugins/speech-ipc.mts";
import { settingsIpcPlugin } from "./host/plugins/settings-ipc.mts";
import { sessionsIpcPlugin } from "./host/plugins/sessions-ipc.mts";
import { appIpcPlugin } from "./host/plugins/app-ipc.mts";
import { appearanceIpcPlugin } from "./host/plugins/appearance-ipc.mts";
import { browserIpcPlugin } from "./host/plugins/browser-ipc.mts";
import { browserControlIpcPlugin } from "./host/plugins/browser-control-ipc.mts";
import { browserImportIpcPlugin } from "./host/plugins/browser-import-ipc.mts";
import { agentIpcPlugin } from "./host/plugins/agent-ipc.mts";
import { chatIpcPlugin } from "./host/plugins/chat-ipc.mts";
import { backgroundTasksIpcPlugin } from "./host/plugins/background-tasks-ipc.mts";
import { channelsIpcPlugin } from "./host/plugins/channels-ipc.mts";
import { skillsIpcPlugin } from "./host/plugins/skills-ipc.mts";
import { memoriesIpcPlugin } from "./host/plugins/memories-ipc.mts";
import { telemetryIpcPlugin } from "./host/plugins/telemetry-ipc.mts";
import { bareModelName, builtinHooks, isResponsesEndpoint, isSafeBrowserUrl, listServerModels, normalizeModelEndpoint, parseModelJson, probeServerContextLimit, requestModel, sanitizeToolCalls } from "./agent.mts";
import { BrowserAgent, browserToolDefinitions } from "./browser.mts";
import { BrowserControlManager } from "./browser-control.mts";
import { CHANNEL_LABELS, createChannelManager } from "./channels/manager.mts";
import { CHANNEL_MEDIA_EXTENSIONS, MAX_MEDIA_BYTES, channelMediaToolDefinitions, mediaKindForExtension, verifyChannelMediaPath } from "./channels/media-tools.mts";
import { parseApprovalReply } from "./channels/qq-bot.mts";
import { isWorkspaceSwitchRequest, looksLikePathDirective, parseWorkspaceSwitch, resolveWorkspaceSwitch } from "./channels/workspace.mts";
import { COMPUTER_USE_INSTALL_TIMEOUT_MS, COMPUTER_USE_SERVER_ID, discoverComputerUseServer } from "./computer-use.mts";
import { applyBuiltinMemoryOverrides, buildMemoryRecord, extractExplicitMemoryInstructions, isBuiltinMemoryId, normalizeMemoryItem, normalizeMemories } from "./memory.mts";
import { applyConsolidation, buildConsolidationMessages, ensureWiki, integrateItems, listWikiPages, parseConsolidationResult, readWikiPages, removeWikiMemory, serializeMemoryRow, updateWikiMemory } from "./memory-wiki.mts";
import { McpClient } from "./mcp.mts";
import { countUndecryptableSecrets, decryptChannelSecret, encryptChannelSecret, normalizeApprovalMode, normalizePreventSleep, normalizeTranscriptionEngine, normalizeTtsEngine } from "./settings.mts";
import { discoverFileSkills, mergeSkillRecords } from "./skills.mts";
import { SESSION_TOOL_NAMES, handleSessionTool, handleSideChatTool, sessionToolDefinitions, sideChatToolDefinitions } from "./session-tools.mts";
import { installSkillFromLibrary, searchSkillLibraries } from "./skill-libraries.mts";
import { localImagePathFromSource, registerLocalImageIpc } from "./local-image.mts";
import { saveClipboardImage } from "./clipboard-image.mts";
import { importLegacyData } from "./legacy-data.mts";
import { configureLocalReviewer, downloadLocalReviewerModel, localReviewerModelStatus, resetLocalReviewerEngine } from "./local-reviewer.mts";
import { configureLocalAsr, downloadLocalAsrModel, downloadLocalAsrRuntime, localAsrAllModelsStatus, localAsrModelStatus, localAsrRuntimeStatus } from "./local-asr.mts";
import { stopLocalAsrServer, stripAsrText, transcribeWithLocalAsr } from "./local-asr-server.mts";
import { configureLocalTts, downloadLocalTtsModel, localTtsAllModelsStatus, localTtsModelStatus, localTtsRuntimeStatus, normalizeTtsModelId } from "./local-tts.mts";
import { synthesizeWithLocalTts } from "./local-tts-engine.mts";
import { getWorkspaceContext, listWorkspace, readWorkspaceFile, readWorkspaceMarkdown, writeWorkspaceFile } from "./workspace.mts";
import { gitCheckout, gitCommit, gitCommitDiff, gitCreateBranch, gitDiffStats, gitDiscard, gitFileDiff, gitPush, gitReviewOverview, gitStage, listGitBranches } from "./git.mts";
import { importBrowserData, listImportableBrowsers } from "./browser-import.mts";
import { SessionQueue } from "./session-queue.mts";
import { enforceDirTotalSize, halveFileIfOversized } from "./log-rotation.mts";
import { DEFAULT_UPDATE_URL, createUpdaterController } from "./app-updater.mts";
import { createBackgroundTasksManager } from "./background-tasks.mts";
import { collectOrphanAssets, commitStagedImage, defaultAppearance, discardStagedImage, importAppearanceImage, normalizeAppearance, readAppearance, readAppearanceImage, removeAppearanceImage, saveAppearance } from "./appearance.mts";
import { applyWindowBackdrop, getAppearanceCapabilities, windowBackgroundFor } from "./appearance-platform.mts";
import { createTelemetryController } from "./telemetry.mts";
import { createRemoteMessagesManager } from "./remote-messages.mts";

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
// 内置浏览器的 webview 登记：每个浏览器标签页常驻一个 webview，
// agent 的 browser__* 工具只作用于渲染进程上报的「当前显示」那个（无上报时回退最后创建的）
const embeddedBrowserContentsById = new Map();
let activeEmbeddedBrowserContentsId = 0;
let activeEmbeddedBrowserOwnerSessionId = "";
let embeddedBrowserContents = null;
// 渲染进程未上报（旧版本/预览环境）时的回退目标
let fallbackEmbeddedBrowserContentsId = 0;
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
  try {
    const actual = new URL(String(rawUrl || ""));
    const expected = new URL(rendererEntryUrl);
    if (isDevelopment) return actual.origin === expected.origin;
    return actual.protocol === "file:" && actual.pathname === expected.pathname;
  } catch {
    return false;
  }
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
  mainWindow.setBackgroundColor(windowBackgroundFor(appearanceState.settings, resolvedAppearanceTheme(), isBackdropActive));
  mainWindow.webContents?.invalidate?.();
}

// Linux 使用系统边框与阴影，不再为自绘阴影扩大应用的输入区域。
// 系统主题变化只在「跟随系统」时生效：显式主题下 themeSource 已固定，此事件不会因系统明暗切换而触发。
nativeTheme.on("updated", () => {
  applyWindowAppearance();
});

function dataFile(name) {
  return path.join(app.getPath("userData"), name);
}

// Cordis 宿主：主进程核心服务（审计/设置/会话存档/代理）统一挂入插件生命周期。
// safeStorage 与领域解析器在此注入；顶层 await 等待根 fiber 激活，
// 之后的模块级常量（sessionArchive/auditLog）即可同步访问服务。
const ctx = await createHost({
  userDataDir: app.getPath("userData"),
  homeDir: app.getPath("home"),
  safeStorage,
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
    isSessionBusy: (sessionId) => activeAgents.has(sessionId),
    isSystemBusy: () => activeAgents.size > 0 || runningChannelTaskCount > 0,
    runScheduledTask: (record) => runScheduledTask(record),
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
const SENSITIVE_JSON_FILES = new Set(["settings.json", "imported-passwords.json", "channel-credentials.json"]);
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

function defaultSessions() {
  const now = new Date().toISOString();
  return [
    {
      id: "welcome",
      title: "把工作交给 DYWorker",
      workspacePath: "",
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          role: "assistant",
          createdAt: now,
          content:
            "## 欢迎使用 DYWorker\n\n这里是你的本地工作助手。选择一个工作文件夹，然后直接描述要完成的事情。\n\n- 浏览和整理项目文件\n- 根据材料生成报告\n- 记录连续任务和处理结果\n\n你的任务记录保存在本机。",
        },
      ],
    },
  ];
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

const textExtensions = new Set([
  ".c", ".cc", ".cpp", ".css", ".csv", ".go", ".h", ".hpp", ".html", ".ini", ".java", ".js", ".json",
  ".jsx", ".log", ".md", ".mjs", ".py", ".rs", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);
const mimeTypes = new Map([
  [".bmp", "image/bmp"], [".gif", "image/gif"], [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"],
  [".png", "image/png"], [".webp", "image/webp"], [".csv", "text/csv"], [".html", "text/html"],
  [".json", "application/json"], [".md", "text/markdown"], [".txt", "text/plain"], [".xml", "application/xml"],
  [".silk", "audio/silk"], [".wav", "audio/wav"], [".mp3", "audio/mpeg"], [".m4a", "audio/mp4"],
  [".aac", "audio/aac"], [".ogg", "audio/ogg"], [".opus", "audio/opus"], [".amr", "audio/amr"],
]);

function attachmentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return mimeTypes.get(extension) || (textExtensions.has(extension) ? "text/plain" : "application/octet-stream");
}

async function describeAttachment(filePath) {
  const stat = await fs.stat(filePath);
  const mimeType = attachmentType(filePath);
  const isImage = mimeType.startsWith("image/");
  const extension = path.extname(filePath).toLowerCase();
  const isVoice = mimeType.startsWith("audio/") || extension === ".silk";
  // 不再内嵌缩略图：previewUrl 会随会话存档落盘，大图会让存档体积翻倍；
  // 渲染层统一走 local-image:read 按原尺寸读取，气泡/预览/复制共用同一份原图。
  return {
    name: path.basename(filePath),
    path: filePath,
    size: stat.size,
    mimeType,
    isImage,
    isVoice,
  };
}

async function providerMessageContent(message) {
  let text = String(message?.content || "").trim();
  const imageBlocks = [];
  // assistant 消息里的图片附件大多是展示/出站媒体（如渠道回复附带的截图），
  // 不是需要回传给模型的输入；DeepSeek 视觉模型也拒绝 assistant 消息携带图片（400）。
  // 因此对 assistant 角色只保留文本，不把图片展开成 image 块，避免模型输入被服务端拒绝。
  if (message?.role === "assistant") return text || "请处理已选择的附件。";
  for (const attachment of Array.isArray(message?.attachments) ? message.attachments : []) {
    const filePath = String(attachment?.path || "");
    if (!filePath) continue;
    try {
      const stat = await fs.stat(filePath);
      const mimeType = attachmentType(filePath);
      if (mimeType.startsWith("image/")) {
        if (stat.size > 12 * 1024 * 1024) {
          text += `\n\n[图片 ${path.basename(filePath)} 超过 12 MB，未发送]`;
          continue;
        }
        const encoded = (await fs.readFile(filePath)).toString("base64");
        imageBlocks.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${encoded}` } });
      } else if (textExtensions.has(path.extname(filePath).toLowerCase())) {
        if (stat.size > 2 * 1024 * 1024) {
          text += `\n\n[文本附件 ${path.basename(filePath)} 超过 2 MB，未展开]`;
          continue;
        }
        const content = await fs.readFile(filePath, "utf8");
        text += `\n\n--- 附件：${path.basename(filePath)} ---\n${content}`;
      } else {
        text += `\n\n[已选择附件 ${path.basename(filePath)}；当前通用模型接口仅直接读取文本和图片]`;
      }
    } catch (error: any) {
      text += `\n\n[附件 ${path.basename(filePath)} 读取失败：${error instanceof Error ? error.message : String(error)}]`;
    }
  }
  if (!imageBlocks.length) return text || "请处理已选择的附件。";
  return [{ type: "text", text: text || "请查看这些图片。" }, ...imageBlocks];
}

function transcriptionEndpoint(settings) {
  if (settings?.transcriptionEndpoint) return String(settings.transcriptionEndpoint).trim();
  const endpoint = String(settings?.endpoint || "").trim();
  if (!endpoint) return "";
  try {
    const url = new URL(endpoint);
    // 只有 Chat Completions 端点能可靠推导出同级语音转写地址；
    // Responses 端点（如 DeepSeek /responses）没有对应转写服务，返回空让用户显式配置。
    if (!/\/chat\/completions\/?$/.test(url.pathname)) return "";
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, "/audio/transcriptions");
    return url.toString();
  } catch {
    return "";
  }
}

function createWindow() {
  const windowOptions = {
    width: 1184,
    height: 736,
    minWidth: 980,
    minHeight: 660,
    backgroundColor: windowBackgroundFor(appearanceState.settings, resolvedAppearanceTheme()),
    show: process.platform === "linux",
    title: "DYWorker",
    frame: process.platform === "linux",
    // mac 隐藏系统标题栏，窗口内容直接贴顶；原生红绿灯嵌进第一行工具栏
    // （侧栏品牌行/顶栏高 54px，按钮高约 16px，y=(54-16)/2=19 垂直居中，x=14 对齐左侧留白），
    // 该行本身就是 -webkit-app-region: drag 拖拽区，窗口拖动不受影响
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 19 } } : {}),
    hasShadow: true,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  };

  mainWindow = new BrowserWindow(windowOptions as any);
  applyWindowAppearance();
  if (process.platform === "linux") {
    // Linux 下默认隐藏顶部菜单栏以保持界面纯净，但保留应用菜单及全局恢复入口
    mainWindow.setMenuBarVisibility(false);
    mainWindow.autoHideMenuBar = true;
  }
  // 注册按键级应急恢复外观监听（CmdOrCtrl+Alt+R），独立于菜单显示状态，界面字号过大时仍可触发
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const isCmdOrCtrl = process.platform === "darwin" ? input.meta : input.control;
    if (isCmdOrCtrl && input.alt && input.key?.toLowerCase() === "r" && input.type === "keyDown") {
      // 阻止同一按键继续触发菜单 accelerator；长按也只恢复一次。
      event.preventDefault();
      if (input.isAutoRepeat) return;
      void performAppearanceReset().then((snapshot) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("appearance:reset", snapshot);
        }
      });
    }
  });
  // 最大化/还原时确保窗口始终接收鼠标输入。
  mainWindow.on("maximize", () => {
    mainWindow?.setIgnoreMouseEvents(false);
    mainWindow?.webContents.send("window:maximized-changed", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow?.setIgnoreMouseEvents(false);
    mainWindow?.webContents.send("window:maximized-changed", false);
  });
  // 使用统计的窗口状态信号：后台/最小化/失焦立即封口当前使用区间。
  // 关闭窗口（macOS 进程仍在）同样视为不可计时状态。
  const noteTelemetryWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    ctx.telemetryController?.noteWindowState({
      visible: mainWindow.isVisible(),
      minimized: mainWindow.isMinimized(),
      focused: mainWindow.isFocused(),
    });
  };
  for (const stateEvent of ["focus", "blur", "show", "hide", "minimize", "restore", "close"]) {
    mainWindow.on(stateEvent, noteTelemetryWindowState);
  }
  // Linux 下无边框窗口首次显示后主动申请键盘焦点，避免点击窗口后按键仍
  // 被送到上一个窗口（X11/XWayland 无边框窗口的常见问题）。
  if (process.platform === "linux") {
    // Linux 下记录窗口几何、显示器和渲染器状态，便于真机排查“进程在但
    // 界面不显示”。正常环境这些日志不影响窗口与阴影。
    const logWindowGeometry = (label) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        const bounds = mainWindow.getBounds();
        const display = screen.getDisplayMatching(bounds);
        console.log(
          `[dyworker] linux window ${label}: bounds=${JSON.stringify(bounds)} ` +
            `display=${JSON.stringify(display.bounds)} scale=${display.scaleFactor} ` +
            `visible=${mainWindow.isVisible()} minimized=${mainWindow.isMinimized()} ` +
            `maximized=${mainWindow.isMaximized()}`,
        );
      } catch (error: any) {
        console.log(`[dyworker] linux window geometry failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    setTimeout(() => logWindowGeometry("created"), 500);
    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) {
        console.log(
          `[dyworker] linux renderer load failed: ${errorCode} ${errorDescription} (${validatedURL})`,
        );
      }
    });
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.log(
        `[dyworker] linux renderer gone: reason=${details?.reason || "unknown"} ` +
          `exitCode=${details?.exitCode ?? "unknown"}`,
      );
    });
    mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
      console.log(
        `[dyworker] linux preload error: ${preloadPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    mainWindow.webContents.on("console-message", (details, level, message, line, sourceId) => {
      const severity = details?.params?.level ?? ["verbose", "info", "warning", "error"][level] ?? String(level);
      if (severity === "error" || level === 3) {
        console.log(
          `[dyworker] linux renderer error: ${details?.params?.message ?? message} ` +
            `(${details?.params?.sourceId ?? sourceId}:${details?.params?.lineNumber ?? line})`,
        );
      }
    });
    mainWindow.on("show", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.focus();
      mainWindow.webContents.focus();
    });
  }
  // 加载后检查界面是否挂载；空白时重载一次，保留诊断日志。
  if (process.platform === "linux") {
    let rendererReloaded = false;
    const inspectRendererContent = async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return null;
      try {
        return await mainWindow.webContents.executeJavaScript(`(() => {
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
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const report = await inspectRendererContent();
      console.log(`[dyworker] linux renderer content: ${JSON.stringify(report)}`);
      if (!report || report.checkError || report.rootChildren > 0 || report.bodyTextLength > 0) return;
      if (!rendererReloaded) {
        rendererReloaded = true;
        console.log("[dyworker] linux renderer is blank; reloading once");
        mainWindow.webContents.reload();
        return;
      }
      console.log("[dyworker] linux renderer still blank after reload");
    };
    mainWindow.webContents.on("did-finish-load", () => {
      setTimeout(() => void ensureRendererContent(), 2000);
    });
  }
  mainWindow.once("closed", () => {
    mainWindow = undefined;
  });
  // 主窗口权限：media 沿用现有放行；本机字体枚举仅放行主窗口自身，内嵌网页不开放
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) =>
    permission === "media" ||
    ((permission === "font-access" || permission === "local-fonts") && webContents === mainWindow?.webContents));
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(
      permission === "media" ||
      ((permission === "font-access" || permission === "local-fonts") && webContents === mainWindow?.webContents),
    );
  });
  if (process.platform !== "linux") mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 只把 http/https 交给系统浏览器，其余协议（file:、smb:、自定义协议等）一律拒绝，防止协议处理器滥用
    try {
      const target = new URL(url);
      if (target.protocol === "http:" || target.protocol === "https:") void shell.openExternal(target.toString());
    } catch {
      // Ignore malformed open targets.
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
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
  const localHtmlPath = path.join(here, "../client/index.html");
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (isDevelopment && !existsSync(localHtmlPath)) {
    mainWindow.loadURL(rendererEntryUrl);
  } else {
    mainWindow.loadFile(localHtmlPath);
  }

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      console.log(`[dyworker] renderer load failed: ${errorCode} ${errorDescription} (${validatedURL})`);
      if (validatedURL.startsWith("http://127.0.0.1:5173") && existsSync(localHtmlPath)) {
        console.log("[dyworker] dev server unreachable, falling back to local built html");
        mainWindow?.loadFile(localHtmlPath);
      }
    }
  });
}

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

app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  embeddedBrowserContentsById.set(contents.id, contents);
  embeddedBrowserContents = contents;
  fallbackEmbeddedBrowserContentsId = contents.id;
  contents.once("destroyed", () => {
    embeddedBrowserContentsById.delete(contents.id);
    if (activeEmbeddedBrowserContentsId === contents.id) activeEmbeddedBrowserContentsId = 0;
    if (embeddedBrowserContents === contents) {
      embeddedBrowserContents = null;
      fallbackEmbeddedBrowserContentsId = 0;
    }
  });
  contents.on("will-navigate", (event, url) => {
    if (!isSafeBrowserUrl(url).ok) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  // 键盘输入拦截屏障（补充要求 6）：助手自动操作期间，拦截落入网页的原生按键并触发用户接管
  contents.on("before-input-event", (event, input) => {
    if (
      browserControlManager.getStatus().status === "running" &&
      browserControlManager.session?.webContentsId === contents.id
    ) {
      if (input.type === "keyDown" && !input.isAutoRepeat) {
        event.preventDefault();
        browserControlManager.takeover({ reason: "检测到用户键盘按键，已由你接管" });
      }
    }
  });
  // 下载进度跟踪：保存位置仍由 BrowserAgent 决定（工作区“下载”目录），
  // 这里只观察并广播给面板展示。持久分区所有 webview 共享，只挂一次。
  if (!(contents.session as any).__dyworkerDownloadTracker) {
    (contents.session as any).__dyworkerDownloadTracker = true;
    contents.session.on("will-download", (_event, item) => {
      const record = {
        id: `${item.getStartTime()}-${item.getFilename()}`,
        filename: item.getFilename() || "download",
        path: "",
        received: 0,
        total: item.getTotalBytes(),
        state: "progressing",
        startedAt: Date.now(),
      };
      const send = () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("browser:download-progress", record);
      };
      item.on("updated", (_e, state) => {
        record.received = item.getReceivedBytes();
        record.total = item.getTotalBytes();
        record.state = state === "interrupted" ? "interrupted" : "progressing";
        record.path = item.getSavePath() || "";
        send();
      });
      item.once("done", (_e, state) => {
        record.received = item.getTotalBytes();
        record.state = state === "completed" ? "completed" : state === "interrupted" ? "interrupted" : "cancelled";
        record.path = item.getSavePath() || "";
        send();
      });
      send();
    });
  }
});

// 当前显示的内置浏览器页面：优先渲染进程上报的激活 webview。
// forOwnerSessionId：调用方（某会话的任务）要求的归属；激活 webview 已上报归属
// 且归属他人时返回 null，防止 A 会话的后台任务拿到 B 会话正在看的页面（穿透）。
function activeEmbeddedBrowserContents({ forOwnerSessionId } = {} as any) {
  const contents = embeddedBrowserContentsById.get(activeEmbeddedBrowserContentsId)
    || embeddedBrowserContentsById.get(fallbackEmbeddedBrowserContentsId)
    || null;
  if (!contents || contents.isDestroyed?.()) return null;
  const owner = String(forOwnerSessionId || "");
  if (owner && activeEmbeddedBrowserOwnerSessionId && activeEmbeddedBrowserOwnerSessionId !== owner) {
    return null;
  }
  return contents;
}

const browserControlManager = new BrowserControlManager({
  onStateChange: (state) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("browser-control:state", state);
      }
    } catch {
      // 忽略主窗口销毁期间广播失败
    }
    // 电脑操控进行期间保守暂停人工计时，避免把自动输入算成人工
    ctx.telemetryController?.setAutomationActive(
      state?.status === "running" || state?.status === "acquiring",
    );
  },
});

function waitForEmbeddedBrowser(sender, url, tabId, { validate, ownerSessionId = "" } = {} as any) {
  return new Promise<any>((resolve) => {
    const startedAt = Date.now();
    let previousUrl = "";
    try {
      const active = activeEmbeddedBrowserContents({ forOwnerSessionId: ownerSessionId });
      if (active && !active.isDestroyed?.()) {
        previousUrl = active.getURL?.() || "";
      }
    } catch {
      // 忽略已销毁对象取 URL 异常
    }
    let observedContents = null;
    let timer = null;
    let settled = false;

    // 打开请求可能携带取消凭据：预占被接管、停止、过期或被新请求接替后，
    // 旧请求严禁再发起导航或确认成功 (C2_expired_open_stays_revoked)
    const stillValid = () => (typeof validate === "function" ? validate() : true);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (observedContents) {
        try {
          observedContents.removeListener("did-stop-loading", onStop);
          observedContents.removeListener("did-fail-load", onFail);
          observedContents.removeListener("destroyed", onDestroyed);
        } catch {
          // 忽略
        }
      }
      resolve(result);
    };
    const onStop = () => {
      const contents = observedContents;
      if (!contents || contents.isDestroyed()) return;
      if (!stillValid()) {
        finish({ ok: false, result: "打开请求已过期或已被新任务接替，自动跳转已取消" });
        return;
      }
      let currentUrl = "";
      try {
        currentUrl = contents.getURL();
      } catch {
        return;
      }
      if (!currentUrl || currentUrl === "about:blank" || currentUrl === previousUrl) return;
      finish({ ok: true, contents });
    };
    const onFail = (_event, errorCode, errorDescription) => {
      finish({ ok: false, result: `网页加载失败：${errorDescription || errorCode}` });
    };
    const onDestroyed = () => {
      observedContents = null;
      poll();
    };
    const poll = () => {
      if (settled) return;
      if (!stillValid()) {
        finish({ ok: false, result: "打开请求已过期或已被新任务接替，自动跳转已取消" });
        return;
      }
      if (!sender || sender.isDestroyed()) {
        finish({ ok: false, result: "当前任务窗口已关闭" });
        return;
      }
      if (Date.now() - startedAt > 20000) {
        finish({ ok: false, result: "右侧浏览器面板加载超时" });
        return;
      }
      // 面板激活页已归属其他会话（用户切走了）：本会话的打开请求立即失败，
      // 不能把网页打在别的会话正在看的面板上，也不再空等 20 秒
      const owner = String(ownerSessionId || "");
      if (owner && activeEmbeddedBrowserOwnerSessionId && activeEmbeddedBrowserOwnerSessionId !== owner) {
        finish({ ok: false, result: "当前浏览器面板正显示其他会话的页面，已取消本次打开" });
        return;
      }
      const contents = activeEmbeddedBrowserContents({ forOwnerSessionId: owner });
      if (contents && !contents.isDestroyed()) {
        if (observedContents !== contents) {
          observedContents = contents;
          try {
            contents.once("did-stop-loading", onStop);
            contents.once("did-fail-load", onFail);
            contents.once("destroyed", onDestroyed);
          } catch {
            // 忽略
          }
        }
        let currentUrl = "";
        let loading = false;
        try {
          currentUrl = contents.getURL();
          loading = contents.isLoading();
        } catch {
          return;
        }
        if (currentUrl === url && !loading) {
          finish({ ok: true, contents });
          return;
        }
      }
      timer = setTimeout(poll, 50);
    };

    // 实际发起导航前最后一次核验取消凭据：已撤销的请求不得触发页面跳转 (C2)
    if (!stillValid()) {
      finish({ ok: false, result: "打开请求已过期或已被新任务接替，自动跳转已取消" });
      return;
    }

    try {
      sender.send("browser:panel-request", { action: "open", url, tabId, ownerSessionId: String(ownerSessionId || "") });
    } catch (error: any) {
      finish({ ok: false, result: `无法打开右侧浏览器面板：${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    poll();
  });
}

function requestCloseEmbeddedBrowser(sender, ownerSessionId = "") {
  try {
    if (!sender || sender.isDestroyed()) return;
    sender.send("browser:panel-request", { action: "close", ownerSessionId: String(ownerSessionId || "") });
  } catch {
    // 忽略
  }
}

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
      settings,
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

// 渲染进程上报当前显示的内置浏览器 webview（及其所属激活会话）：
// agent 的 browser__* 工具只作用于可见页面
ipcMain.on("browser:active-contents", (event, webContentsId, ownerSessionId) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return;
  const id = Number(webContentsId) || 0;
  // 只接受登记过的 webview，防止渲染进程指向任意页面
  if (id && !embeddedBrowserContentsById.has(id)) return;
  const previousId = activeEmbeddedBrowserContentsId;
  activeEmbeddedBrowserContentsId = id;
  activeEmbeddedBrowserOwnerSessionId = id ? String(ownerSessionId || "") : "";

  // 若当前正在自动操作且显示的标签页被切走（换了页面，或页面还在但已归属
  // 其他会话），主动暂停控制，避免后台任务继续操作别的会话正在看的页面
  const runningOwner = browserControlManager.session?.ownerSessionId;
  const ownerChangedToOther = Boolean(
    activeEmbeddedBrowserOwnerSessionId &&
    runningOwner &&
    activeEmbeddedBrowserOwnerSessionId !== runningOwner
  );
  if (browserControlManager.getStatus().status === "running" && (ownerChangedToOther || (previousId && id !== previousId))) {
    browserControlManager.pause({ reason: "页面已切换，操作已暂停" });
  }
});

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
              if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("appearance:reset", snapshot);
            });
          },
        },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template as any));
}

// 凭证预检（auth check）：设置页保存 API Key 后立即验证可用性，避免运行任务时才发现配错。
// 发一个最小 chat 请求：200 = 通过；401/403 = 密钥无效；404 = 地址或模型名不对；其余按状态码归类。

// 模型列表拉取：同一服务地址 + 密钥下 GET /models，列出该账号可用的全部模型，
// 设置页「获取可用模型」按钮调用，用于在同一 Key 下直接切换模型。



// 语音转写：本地引擎（Qwen3-ASR-0.6B + llama-server）或 OpenAI 兼容 /audio/transcriptions；
// 桌面录音与 QQ 语音（silk 解码后）共用
async function transcribeAudio(audioBytes, mimeType, settings) {
  const audio = Uint8Array.from(audioBytes || []);
  if (!audio.length) throw new Error("没有收到录音内容");
  if (normalizeTranscriptionEngine(settings?.transcriptionEngine) === "local") {
    // 模型目录与所选模型已在 readSettings 里按最新设置应用；引擎路径变更同样即时生效
    const text = await transcribeWithLocalAsr({
      wav: audio,
      customServerPath: String(settings?.llamaServerPath || "").trim(),
      modelId: String(settings?.asrModel || "").trim(),
    });
    return { text };
  }
  const endpoint = transcriptionEndpoint(settings);
  if (!endpoint || !settings.apiKey) throw new Error("请先在设置中配置语音转写地址和 API 密钥");
  if (audio.byteLength > 25 * 1024 * 1024) throw new Error("录音超过 25 MB，请缩短后重试");
  const type = String(mimeType || "audio/webm");
  const extension = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : type.includes("wav") ? "wav" : "webm";
  const body = new FormData();
  body.append("file", new Blob([audio], { type }), `dyworker-recording.${extension}`);
  body.append("model", String(settings.transcriptionModel || "whisper-1"));
  // 转写服务偶发挂起时不能把渠道任务永久卡住（否则该聊天后续消息只排队不执行）。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.apiKey}` },
      body,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new Error("语音转写服务连接超时（60 秒无响应），请稍后重试");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`语音转写失败（${response.status}）：${detail}`);
  }
  const result = await parseModelJson(response, "语音转写服务", endpoint);
  const text = result?.text || result?.data?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("语音服务没有返回文字");
  return { text: text.trim() };
}

// QQ 语音附件是 silk 编码：silk → PCM → 补 WAV 头 → 走现有转写服务
async function transcribeQqVoice(filePath, settings) {
  const { decode } = await import("silk-wasm");
  const silk = await fs.readFile(filePath);
  const pcm = await decode(silk, 24000);
  const duration = pcm.duration ? Math.round(pcm.duration / 1000) : Math.max(1, Math.round(pcm.data.byteLength / (24000 * 2)));
  const wav = buildWavFromPcm(Buffer.from(pcm.data), 24000);
  const result = await transcribeAudio(wav, "audio/wav", settings);
  const rawText = result?.text || "";
  const text = stripAsrText(rawText);
  return { text, duration };
}

// PCM(s16le) + 采样率 → 标准 WAV（44 字节头），供转写服务读取
function buildWavFromPcm(pcm, sampleRate) {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcm.byteLength;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}


// ---- 本地代理 ----

const activeAgents = new Map();
const sessionQueue = new SessionQueue();
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
let usageStatsWriteTimer = null;

async function readUsageStats() {
  if (!usageStatsCache) {
    const items = await readJson(dataFile("usage-stats.json"), []);
    usageStatsCache = Array.isArray(items) ? items : [];
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
  const items = await readUsageStats();
  items.push({
    time: new Date().toISOString(),
    model: String(event.model || "未命名模型"),
    prompt: Math.max(0, Math.round(Number(event.prompt) || 0)),
    completion: Math.max(0, Math.round(Number(event.completion) || 0)),
    estimated: event.estimated === true,
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

// ---- MCP 工具服务器（stdio） ----

const mcpClients = new Map();
const mcpClientConnections = new Map();
const builtInComputerUseServer = discoverComputerUseServer();

function mcpServersOf(settings) {
  const list = Array.isArray(settings?.mcpServers) ? settings.mcpServers : [];
  const configured = list.filter((server) =>
    server
    && server.enabled !== false
    && String(server.command || "").trim()
    && String(server.id || "") !== COMPUTER_USE_SERVER_ID);
  return builtInComputerUseServer ? [builtInComputerUseServer, ...configured] : configured;
}

function mcpServerArgs(server) {
  if (Array.isArray(server.args)) return server.args.map(String);
  return String(server.args || "").split(" ").filter(Boolean);
}

async function getMcpClient(server) {
  if (mcpShuttingDown) throw new Error("应用正在退出，已停止新建本机操作连接");
  const key = String(server.id || server.name || server.command);
  const existing = mcpClients.get(key);
  if (existing?.process) return existing;
  const pendingConnection = mcpClientConnections.get(key);
  if (pendingConnection) return pendingConnection;
  const connection = (async () => {
    const client = new McpClient({
      command: String(server.command),
      args: mcpServerArgs(server),
      cwd: server.cwd ? String(server.cwd) : undefined,
      env: server.env && typeof server.env === "object" ? server.env : undefined,
      requestTimeoutMs: server.requestTimeoutMs,
    });
    try {
      await client.connect();
      if (mcpShuttingDown) {
        await client.close();
        throw new Error("应用正在退出，已停止新建本机操作连接");
      }
      mcpClients.set(key, client);
      return client;
    } catch (error: any) {
      await client.close();
      throw error;
    }
  })();
  mcpClientConnections.set(key, connection);
  try {
    return await connection;
  } finally {
    if (mcpClientConnections.get(key) === connection) mcpClientConnections.delete(key);
  }
}

// MCP 的 inputSchema 是通用 JSON Schema，可能带 $schema 声明或空的 required 数组，
// 严格校验的 OpenAI 兼容服务（vLLM/LM Studio 等）会拒绝，这里统一清洗成标准工具参数格式
function sanitizeMcpInputSchema(schema) {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  const { $schema, ...rest } = schema;
  const cleaned = { ...rest };
  if (cleaned.type !== "object") cleaned.type = "object";
  if (!cleaned.properties || typeof cleaned.properties !== "object") cleaned.properties = {};
  if (Array.isArray(cleaned.required) && !cleaned.required.length) delete cleaned.required;
  return cleaned;
}

async function mcpExtraTools(settings) {
  const extra = [];
  for (const server of mcpServersOf(settings)) {
    try {
      const client = await getMcpClient(server);
      for (const tool of client.tools) {
        extra.push({
          type: "function",
          function: {
            name: `mcp__${server.id || server.name}__${tool.name}`,
            description: server.id === COMPUTER_USE_SERVER_ID
              ? `【本机应用操作】${tool.description || tool.name}`
              : `【MCP:${server.name}】${tool.description || tool.name}`,
            parameters: sanitizeMcpInputSchema(tool.inputSchema),
          },
        });
      }
    } catch {
      // 单个服务器连不上不影响其他工具
    }
  }
  return extra;
}

async function callMcpTool(settings, fullName, args, { signal } = {} as any) {
  const rest = fullName.slice(5);
  for (const server of mcpServersOf(settings)) {
    const prefix = `${server.id || server.name}__`;
    if (!rest.startsWith(prefix)) continue;
    const client = await getMcpClient(server);
    try {
      const toolName = rest.slice(prefix.length);
      const result = await client.callTool(toolName, args, {
        requestTimeoutMs: server.id === COMPUTER_USE_SERVER_ID && toolName === "install_dependencies"
          ? COMPUTER_USE_INSTALL_TIMEOUT_MS
          : undefined,
        signal,
      });
      return { ok: !result.isError, result: result.text, images: result.images };
    } catch (error: any) {
      if (!client.process) mcpClients.delete(String(server.id || server.name || server.command));
      if (signal?.aborted) return { ok: false, result: "任务已停止" };
      if (server.id === COMPUTER_USE_SERVER_ID) {
        const guidance = process.platform === "linux"
          ? "请确认当前使用 X11 桌面会话，并已安装 xdotool、wmctrl、python3-pyatspi 和 ImageMagick。"
          : "请确认 DYWorker 已在 系统设置 → 隐私与安全性 → 辅助功能 和 屏幕录制 中启用；可先让助手调用 check_permissions 查看权限状态。";
        return {
          ok: false,
          result: `本机应用操作没有获得系统响应。${guidance}然后重试。原始原因：${error instanceof Error ? error.message : String(error)}`,
        };
      }
      throw error;
    }
  }
  return { ok: false, result: `没有找到 MCP 工具：${fullName}` };
}

async function closeAllMcpClients() {
  const clients = [...mcpClients.values()];
  mcpClients.clear();
  await Promise.allSettled(clients.map((client) => client.close()));
}

// ---- 浏览器协作（可见窗口，操作可审计） ----

function agentExtraTools(mcpTools) {
  // 会话检索工具全路径开放（桌面/定时/续跑/渠道）：纯只读、数据源是本机会话存档，无审批风险
  return [...mcpTools, ...browserToolDefinitions(), ...sessionToolDefinitions()];
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
    // 会话检索工具优先：只读查 sessions.json，不走浏览器/MCP
    if (SESSION_TOOL_NAMES.has(String(name))) {
      const sessions = await readAllSessions();
      return handleSessionTool(name, args, { sessions });
    }
    if (name.startsWith("browser__")) return browserAgent.handle(name, args);
    return callMcpTool(settings, name, args, { signal });
  };
  route.dispose = () => browserAgent.dispose();
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
      if (typeof session.goal === "string") freshPayload.goal = session.goal;
    }
  } catch {
    // 读档失败时退回入队时的快照，任务照常执行
  }
  return freshPayload;
}

// 会话首条消息触发、用当前主模型生成简短会话标题：与主任务并发执行，
// 不阻塞任务启动；失败静默（渲染端已有用户输入截断的兜底标题）。
async function generateSessionTitle(userText, settings) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const message = await requestModel({
      settings,
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
  if (activeAgents.has(sessionId)) return { ok: false, error: "这个任务还在执行，请先停止或等待完成" };
  const abortController = new AbortController();
  const agentState = { cancelled: false, pending: new Map(), sessionId, runId, abortController, sender };
  // 统一轨迹事件流（trace-console）：本 run 内所有 trace 记录先攒在内存，
  // 任务结束时异步追加到 userData/traces/<sessionId>.jsonl（append-only，可回放）
  const runTrace = [];
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
      runTrace.push(traceWithRun);
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
      runTrace.push(finishTrace);
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
        runTrace.push(planTrace);
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
    const workspacePath = String(payload?.workspacePath || "").trim();
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

    if (!settings.endpoint || !settings.model || !settings.apiKey) {
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
    if (isFirstUserMessage && latestUserText.trim()) {
      void generateSessionTitle(latestUserText, settings).then((title) => {
        if (title) emitToSession(sender, sessionId, runId, { type: "session-title", title });
      });
    }

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
      goal: String(payload?.goal || "").trim().slice(0, 500),
      conversation: sanitizeToolCalls(agentConversation),
      loop,
      loopStateEvents: true,
      routerOptions: { signal: abortController.signal, renderer: sender, sessionId, runId },
      requestApproval: (action) => new Promise<any>((resolve) => {
        agentState.pending.set(action.id, resolve);
        emit({ type: "approval-request", action });
      }),
      requestUserInput: (request) => new Promise<any>((resolve) => {
        agentState.pending.set(`q:${request.id}`, resolve);
        emit({ type: "ask-user", request });
      }),
      emit: (agentEvent) => {
        if (agentEvent?.type === "skill-updated") void updateSkill(agentEvent.item);
        emit(agentEvent);
      },
      isCancelled: () => agentState.cancelled,
      signal: abortController.signal,
      onCancelled: () => ctx.scheduler.cancelForSession(sessionId),
    });
    emit({ type: "loop-state", active: false, iteration: loop.iteration, maximum: loop.maximum, status: finalResult.status === "done" ? "已完成" : finalResult.status === "unverified" ? "未验证" : "已停止" });
    emit({ type: "agent-finished", result: finalResult });
    return { ok: true, result: finalResult };
  } catch (agentError: any) {
    const reason = agentError instanceof Error ? agentError.message : String(agentError);
    emit({ type: "agent-finished", result: { status: "error", finalText: "", reason } });
    return { ok: false, error: reason };
  } finally {
    // trace 落盘：异步追加，绝不阻塞任务结束；单个会话一个 jsonl（append-only，可回放）
    if (runTrace.length) {
      const traceDir = path.join(app.getPath("userData"), "traces");
      const traceFile = path.join(traceDir, `${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "") || "session"}.jsonl`);
      const lines = runTrace.map((trace) => JSON.stringify(trace)).join("\n") + "\n";
      void (async () => {
        try {
          await fs.mkdir(traceDir, { recursive: true });
          await fs.appendFile(traceFile, lines, "utf8");
          // 总量封顶：traces 只增不减会把 userData 吃满（实测一年 177MB），
          // 超过 128MB 时按最旧优先清理，当前文件保留
          await enforceDirTotalSize(traceDir, 128 * 1024 * 1024, { keep: [traceFile] });
        } catch {
          // 落盘失败不影响任务与界面，轨迹视图会降级为内存事件
        }
      })();
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
  void executeAgentRun({ payload: entry.payload, sender: entry.sender }).catch(() => {
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
ctx.plugin(schedulesIpcPlugin({ trustedHandle }));

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
  defaultSessions,
  syncChannelSessionWorkspaces,
  channelMetaOf,
  platform: process.platform,
  // 内置浏览器/控制权：实例与登记表都是壳层状态，经 getter 注入
  isSafeBrowserUrl,
  session,
  browserPasswordStorePath,
  safeStorage,
  browserControlManager,
  getEmbeddedBrowserContents: (id) => embeddedBrowserContentsById.get(id),
  // 桌面会话任务入口的壳层状态与执行函数（运行期 Map/队列 + 任务执行）
  isShuttingDown: () => mcpShuttingDown,
  activeAgents,
  sessionQueue,
  emitToSession,
  executeAgentRun,
  // 设置保存要联动的域（睡眠拦截/审核模型/语音/渠道/运营）
  saveSettings,
  applyPreventSleep,
  applyReviewerModelDir,
  reconcileChannels,
  applyTelemetrySettings,
  providerMessageContent,
};

ctx.plugin(tracesIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(usageHooksIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(auditIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(windowIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(attachmentsIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(clipboardIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(workspaceIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(appUpdateIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(localModelsIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(speechIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(settingsIpcPlugin({ trustedHandle, ...shellDeps }));
ctx.plugin(sessionsIpcPlugin({ trustedHandle, ...shellDeps }));
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




// 运行历史：每次执行追加一条（时间/结果/关联会话 id），保留最近 10 条；
// 会话 id 对应的转录会话可在任务列表中打开，查看完整过程


// 定时/续跑任务的转录落盘：应用窗口未运行时，主进程直接把带完整转录的会话
// 写进 sessions.json（下次启动经 app:initial-state 读回），不再丢失运行记录
// 窗口未运行时计划任务的转录落盘：写进按会话拆分的存档（下次启动经
// app:initial-state 读回），不再丢失运行记录
async function persistSessionRecord(session) {
  try {
    await sessionArchive.upsert(session);
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

async function resumeWake(wake) {
  ctx.scheduler.running = true;
  trackTaskStart();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("wake:status", {
      sessionId: wake.sessionId,
      status: "running",
      wakeAt: wake.wakeAt,
      reason: wake.reason,
    });
  }
  try {
    const settings = await readSettings();
    if (!settings.endpoint || !settings.model || !settings.apiKey) {
      throw new Error("模型还没有配置，无法续跑挂起的任务");
    }
    const prior = await visibleConversationForSession(wake.sessionId, wake.prompt, wake.finalText);
    const workingContext = await workingContextForSession(wake.sessionId);
    const wakeText = `你于 ${new Date(wake.createdAt).toLocaleString("zh-CN")} 主动挂起（原因：${wake.reason}），现在到达约定时间 ${new Date(wake.wakeAt).toLocaleString("zh-CN")}，请继续完成任务。`
      + (wake.finalText ? `\n此前的进展：\n${wake.finalText}` : "");
    const collector = createTranscriptCollector();
    // 自动唤醒任务是无人值守的自主推进：若原会话是交互确认(interactive)或审核模式，
    // 唤醒后自动提升为 auto 模式（工作区内读写、低风险命令与安全操作自动放行，仅高危操作拦截）；
    // 若原模式是 full-access 则保留
    const sourceApprovalMode = normalizeApprovalMode(wake.approvalMode);
    const approvalMode = sourceApprovalMode === "full-access" ? "full-access" : "auto";
    const result = await ctx.agent.run({
      settings,
      workspacePath: wake.workspacePath,
      sessionId: wake.sessionId,
      scheduleId: wake.scheduleId,
      approvalMode,
      // 唤醒记录仍登记原模式（下次续跑再评估提升）
      wakeApprovalMode: wake.approvalMode,
      prompt: wake.prompt,
      workingContext,
      conversation: [...prior, { role: "user", content: wakeText }],
      // 续跑无人值守：审批与提问进收件箱挂起等待；等待期间暂时释放 ctx.scheduler.running 锁，避免系统调度死锁 2 小时
      requestApproval: async (action) => {
        const pending = ctx.inbox.create({
          kind: "approval",
          sessionId: wake.sessionId,
          scheduleId: wake.scheduleId,
          tool: action.kind,
          title: `续跑任务申请：${action.title || action.kind}`,
          details: action.details,
          impact: action.impact,
        });
        ctx.scheduler.running = false;
        try {
          const resolution = await ctx.inbox.awaitWithTimeout(pending, "审批等待超时，已自动取消", UNATTENDED_PENDING_TIMEOUT_MS);
          return Boolean(resolution?.ok);
        } finally {
          ctx.scheduler.running = true;
        }
      },
      requestUserInput: (request) => {
        const pending = ctx.inbox.create({
          kind: "question",
          sessionId: wake.sessionId,
          scheduleId: wake.scheduleId,
          question: request.question,
          options: request.options,
          title: "续跑任务提问",
        });
        ctx.scheduler.running = false;
        try {
          return ctx.inbox.awaitWithTimeout(pending, "提问等待超时，按已有信息继续", UNATTENDED_PENDING_TIMEOUT_MS);
        } finally {
          ctx.scheduler.running = true;
        }
      },
      emit: (agentEvent) => collector.handle(agentEvent),
      afterWakeRegister: async (wakeResult) => {
        if (wake.scheduleId) await ctx.scheduler.markSleeping(wake.scheduleId, wakeResult.wake, wake.sessionId);
      },
    });
    if (result.status !== "sleeping" && wake.scheduleId) {
      await ctx.scheduler.markFinished(wake.scheduleId, result.status === "done", result.finalText || result.reason || "没有产出结果", wake.sessionId);
    }
    const wakeContent = result.status === "sleeping" && result.wake
      ? `${result.finalText || ""}\n\n已再次挂起，将于 ${new Date(result.wake.wakeAt).toLocaleString("zh-CN")} 自动唤醒继续（原因：${result.wake.reason}）。`.trim()
      : undefined;
    const wakeMessages = collector.buildMessages(`（到点自动唤醒）${wakeText}`, result, wakeContent);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("sessions:append", {
        sessionId: wake.sessionId,
        workspacePath: wake.workspacePath,
        messages: wakeMessages,
      });
    } else {
      // 窗口未运行：续跑转录追加落盘（按消息内容去重）
      await persistSessionAppend(wake.sessionId, wakeMessages);
    }
  } catch (error: any) {
    const errorReason = error instanceof Error ? error.message : String(error);
    console.error(`[wakes] 续跑任务异常 (${wake.sessionId}):`, errorReason);
    if (wake.scheduleId) {
      await ctx.scheduler.markFinished(wake.scheduleId, false, errorReason, wake.sessionId);
    }
    const failureMessages = [
      {
        role: "assistant",
        content: `（到点自动唤醒失败）系统尝试唤醒任务时发生异常：${errorReason}`,
        createdAt: new Date().toISOString(),
        taskStatus: "error",
      },
    ];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("sessions:append", {
        sessionId: wake.sessionId,
        workspacePath: wake.workspacePath,
        messages: failureMessages,
      });
    } else {
      await persistSessionAppend(wake.sessionId, failureMessages);
    }
  } finally {
    trackTaskEnd();
    ctx.scheduler.running = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("wake:status", {
        sessionId: wake.sessionId,
        status: "idle",
      });
    }
  }
}




// ---- 定时任务完整留痕：镜像渲染端 App.tsx 的 agent 事件归约，headless 运行也产出完整过程 ----
// （活动流、文件变更、计划、用时），不再只存最终一句话。
function createTranscriptCollector() {
  const activities = [];
  let changes = null;
  let plan = null;
  // 推理模型的思考流：事件带的是本次请求内的累积文本，保留最后一次即可
  let reasoning = null;
  const startedAt = Date.now();
  return {
    handle(agentEvent) {
      if (!agentEvent || typeof agentEvent !== "object") return;
      if (agentEvent.type === "activity" && agentEvent.activity) {
        activities.push({ ...agentEvent.activity });
      } else if (agentEvent.type === "activity-update") {
        const activity = activities.find((item) => item.id === agentEvent.id);
        if (activity) {
          activity.status = agentEvent.status;
          if (agentEvent.detail !== undefined) activity.detail = agentEvent.detail;
        }
      } else if (agentEvent.type === "file-change") {
        changes = agentEvent.changes;
      } else if (agentEvent.type === "plan-update") {
        plan = agentEvent.steps;
      } else if (agentEvent.type === "assistant-reasoning") {
        reasoning = String(agentEvent.text || "");
      }
    },
    // 供渠道任务收尾事件读取当前的文件变更与计划快照（只读，不改内部状态）
    changes: () => changes,
    plan: () => plan,
    // 注意：assistantContent 必须是「可选」而不是给默认值 ""。三处收尾调用只传
    // 2 个参数（定时任务 finished、渠道纯文本收尾、唤醒未再次挂起时传 undefined），
    // 依赖 `assistantContent ?? fallback` 回退到 result.finalText；默认成 "" 会让
    // `"" ?? fallback` 仍是空串，落盘/回传的助手正文变空。
    buildMessages(userText, result, assistantContent?: string) {
      const finalPlan = plan;
      return [
        { role: "user", content: userText, createdAt: new Date(startedAt).toISOString() },
        {
          role: "assistant",
          content: assistantContent ?? (result.finalText || result.reason || "（没有产出内容）"),
          createdAt: new Date().toISOString(),
          activities: activities.map((item) => ({ ...item })),
          durationMs: Date.now() - startedAt,
          taskStatus: result?.status,
          ...(reasoning ? { reasoning } : {}),
          ...(changes?.length ? { changes: changes.map((item) => ({ ...item })) } : {}),
          ...(finalPlan?.length ? { plan: finalPlan.map((item) => ({ ...item })) } : {}),
          ...(Array.isArray(result?.executedMessages) && result.executedMessages.length ? { executedMessages: result.executedMessages } : {}),
          ...(result?.workingContext ? { workingContext: result.workingContext } : {}),
        },
      ];
    },
  };
}

async function runScheduledTask(record) {
  ctx.scheduler.running = true;
  trackTaskStart();
  broadcastSchedulesChanged();
  // 本次执行的会话 id：收件箱条目、审计记录与最终留痕会话共用同一个
  const scheduleSessionId = crypto.randomUUID();
  try {
    const settings = await readSettings();
    if (!settings.endpoint || !settings.model || !settings.apiKey) {
      throw new Error("模型还没有配置，无法执行定时任务");
    }
    const collector = createTranscriptCollector();
    const result = await ctx.agent.run({
      settings,
      workspacePath: record.workspacePath,
      sessionId: scheduleSessionId,
      scheduleId: record.id,
      approvalMode: record.allowWorkspaceWrites ? "reviewer" : "deny-changes",
      prompt: record.prompt,
      conversation: [{ role: "user", content: record.prompt }],
      // 无人值守：需要确认的操作与提问进审批收件箱挂起等待（2 小时上限，超时按拒绝处理）
      requestApproval: async (action) => {
        const pending = ctx.inbox.create({
          kind: "approval",
          sessionId: scheduleSessionId,
          scheduleId: record.id,
          tool: action.kind,
          title: `定时任务「${record.name || "未命名"}」申请：${action.title || action.kind}`,
          details: action.details,
          impact: action.impact,
        });
        ctx.scheduler.running = false;
        try {
          const resolution = await ctx.inbox.awaitWithTimeout(pending, "审批等待超时，已自动取消", UNATTENDED_PENDING_TIMEOUT_MS);
          return Boolean(resolution?.ok);
        } finally {
          ctx.scheduler.running = true;
        }
      },
      requestUserInput: (request) => {
        const pending = ctx.inbox.create({
          kind: "question",
          sessionId: scheduleSessionId,
          scheduleId: record.id,
          question: request.question,
          options: request.options,
          title: `定时任务「${record.name || "未命名"}」提问`,
        });
        ctx.scheduler.running = false;
        try {
          return ctx.inbox.awaitWithTimeout(pending, "提问等待超时，按已有信息继续", UNATTENDED_PENDING_TIMEOUT_MS);
        } finally {
          ctx.scheduler.running = true;
        }
      },
      emit: (agentEvent) => collector.handle(agentEvent),
      afterWakeRegister: async (wakeResult) => {
        await ctx.scheduler.markSleeping(record.id, wakeResult.wake, scheduleSessionId);
      },
    });
    if (result.status === "sleeping" && result.wake) {
      // 主动挂起：登记唤醒与 sleeping 标记已在服务内完成，这里只做留痕
      const sleepingMessages = collector.buildMessages(
        record.prompt,
        result,
        `${result.finalText || ""}\n\n已主动挂起，将于 ${new Date(result.wake.wakeAt).toLocaleString("zh-CN")} 自动唤醒继续（原因：${result.wake.reason}）。`.trim(),
      );
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("sessions:prepend", {
          id: scheduleSessionId,
          title: `计划：${String(record.name || "未命名").slice(0, 24)}`,
          workspacePath: record.workspacePath,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: sleepingMessages,
        });
      } else {
        // 窗口未运行：转录直接落盘，下次启动读回
        await persistSessionRecord({
          id: scheduleSessionId,
          title: `计划：${String(record.name || "未命名").slice(0, 24)}`,
          workspacePath: record.workspacePath,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: sleepingMessages,
        });
      }
      return;
    }
    await ctx.scheduler.markFinished(record.id, result.status === "done", result.finalText || result.reason || "没有产出结果", scheduleSessionId);
    const finishedMessages = collector.buildMessages(record.prompt, result);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("sessions:prepend", {
        id: scheduleSessionId,
        title: `计划：${String(record.name || "未命名").slice(0, 24)}`,
        workspacePath: record.workspacePath,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: finishedMessages,
      });
    } else {
      // 窗口未运行：转录直接落盘，下次启动读回
      await persistSessionRecord({
        id: scheduleSessionId,
        title: `计划：${String(record.name || "未命名").slice(0, 24)}`,
        workspacePath: record.workspacePath,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: finishedMessages,
      });
    }
  } catch (error: any) {
    await ctx.scheduler.markFinished(record.id, false, error instanceof Error ? error.message : String(error), scheduleSessionId);
  } finally {
    trackTaskEnd();
    ctx.scheduler.running = false;
    broadcastSchedulesChanged();
  }
}



// ---- IM 消息渠道(QQ 官方机器人 / 微信 ClawBot)----
// IM 消息 → 渠道任务(与定时任务同构):串行队列 + 全局忙碌守卫,审批/提问同时进收件箱与 IM。
// 渠道任务全局占用用计数而非布尔：多个聊天队列在全局空闲时可能先后放行，
// 一个任务结束时不能把仍执行中的其他渠道任务误判为空闲（否则新消息会绕过守卫并发执行）。
let runningChannelTaskCount = 0;
// 渠道任务的按聊天中止:「停止」指令把 chatKey 放进 aborts,等待全局空闲的循环与 runAgent 的 isCancelled 都认它
const channelTaskKeys = new Set(); // 等待全局空闲中 + 执行中的渠道任务 chatKey
const channelTaskAborts = new Set(); // 收到「停止」的 chatKey

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
  // 「停止」:中止该聊天执行中/等待全局空闲的任务,并把挂起的审批/提问按取消决议
  onStopChat: async ({ channel, key, pending }) => {
    if (pending?.itemId) {
      const via = CHANNEL_LABELS[channel] || channel;
      ctx.inbox.expireNow(pending.itemId, `用户通过${via}停止了任务`);
    }
    if (!channelTaskKeys.has(key)) return false;
    channelTaskAborts.add(key);
    return true;
  },
  // 排队提示附带当前阻塞原因,让用户知道在等什么
  queueWaitHint: () => {
    const hint = activeAgents.size
      ? "电脑端有任务正在执行"
      : ctx.scheduler.running
        ? "有定时/挂起任务正在执行"
        : runningChannelTaskCount > 0
          ? "上一个渠道任务还在执行（可能在等待审批）"
          : "";
    // 排队提示出现时记录全局状态：如果三个占用标志都为空却仍在排队，
    // 说明队列本身没有前进，这是排查“排队后不执行”的关键证据。
    channelDebug("排队提示", {
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

// 入站媒体 → 桌面会话 Attachment[]：有落盘文件的走 describeAttachment（拿缩略图/元数据），
// 没落盘（如仅转写的语音）构造最小描述，保证桌面消息能渲染附件区
async function buildChannelAttachments(media) {
  const result = [];
  for (const item of Array.isArray(media) ? media : []) {
    if (!item || typeof item !== "object") continue;
    const ext = item.filePath ? path.extname(item.filePath).toLowerCase() : "";
    const isVoice = item.kind === "voice" || ext === ".silk" || (item.mimeType && item.mimeType.startsWith("audio/"));
    const fallback = {
      name: item.fileName || (item.kind === "voice" ? "语音" : "附件"),
      path: item.filePath || "",
      size: Number(item.size) || 0,
      mimeType: item.mimeType || (isVoice ? "audio/silk" : "application/octet-stream"),
      isImage: item.kind === "image",
      isVoice: Boolean(isVoice),
      ...(item.duration ? { duration: Number(item.duration) } : {}),
    };
    if (!item.filePath) {
      result.push(fallback);
      continue;
    }
    try {
      const desc = await describeAttachment(item.filePath);
      result.push({
        ...desc,
        isVoice: Boolean(isVoice || desc.isVoice),
        ...(item.duration ? { duration: Number(item.duration) } : {}),
      });
    } catch {
      result.push(fallback);
    }
  }
  return result;
}

// send_media 工具处理器：校验工作区路径、白名单扩展名与 50 MB 上限，登记到 pendingMedia
// （决策记录第 9 节：出站媒体不额外加审批，但严格限工作区、白名单与大小）
async function handleChannelSendMedia(args, { workspacePath, pendingMedia }) {
  const rawPath = String(args?.path || "").trim();
  const resolved = await verifyChannelMediaPath(workspacePath, rawPath);
  if (!resolved.ok) return { ok: false, result: resolved.error };
  const stat = await fs.stat(resolved.path).catch(() => null);
  if (!stat || !stat.isFile()) return { ok: false, result: `文件不存在：${rawPath}` };
  const extension = path.extname(resolved.path).toLowerCase();
  if (!CHANNEL_MEDIA_EXTENSIONS.has(extension)) {
    return { ok: false, result: `不支持发送 ${extension || "无扩展名"} 文件，只能发图片或常见文档` };
  }
  if (stat.size > MAX_MEDIA_BYTES) return { ok: false, result: "文件超过 50 MB，不能发送" };
  const name = path.basename(resolved.path);
  pendingMedia.push({
    kind: mediaKindForExtension(extension),
    filePath: resolved.path,
    fileName: name,
    ...(String(args?.caption || "").trim() ? { caption: String(args.caption).trim() } : {}),
  });
  return { ok: true, result: `已登记发送：${name}` };
}

// text_to_speech 工具处理器：TTS 合成（本地 Qwen3-TTS 或 OpenAI 兼容 /audio/speech）→ silk 编码 → 登记到 pendingMedia
async function handleChannelTextToSpeech(args, { workspacePath, pendingMedia, settings }) {
  const text = String(args?.text || "").trim();
  const rawPath = String(args?.path || "").trim();
  if (!text) return { ok: false, result: "text_to_speech 缺少 text 参数" };
  if (!rawPath) return { ok: false, result: "text_to_speech 缺少保存路径（工作区相对路径，.silk 结尾）" };
  const resolved = await verifyChannelMediaPath(workspacePath, rawPath, { mustExist: false });
  if (!resolved.ok) return { ok: false, result: resolved.error };
  if (path.extname(resolved.path).toLowerCase() !== ".silk") {
    return { ok: false, result: "语音文件必须以 .silk 结尾（平台要求 silk 格式）" };
  }
  // 引擎与本地模型路径以磁盘最新设置为准（改路径保存后立即生效）
  const saved = await readSettings();
  let wav;
  if (normalizeTtsEngine(settings?.ttsEngine || saved.ttsEngine) === "local") {
    try {
      const { wav: localWav } = await synthesizeWithLocalTts({
        text: text.slice(0, 2000),
        voicePath: String(saved.ttsVoicePath || "").trim(),
      });
      wav = Buffer.from(localWav);
    } catch (error: any) {
      return { ok: false, result: error instanceof Error ? error.message : String(error) };
    }
  } else {
    const ttsEndpoint = String(settings?.ttsEndpoint || "").trim();
    if (!ttsEndpoint) {
      return { ok: false, result: "语音合成服务还没有配置：请在电脑端设置中填写合成服务地址" };
    }
    const apiKey = String(settings?.ttsApiKey || settings?.apiKey || "").trim();
    const ttsUrl = ttsEndpoint.endsWith("/audio/speech")
      ? ttsEndpoint
      : `${ttsEndpoint.replace(/\/+$/, "")}/audio/speech`;
    let response;
    try {
      response = await fetch(ttsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          model: String(settings?.ttsModel || "tts-1"),
          input: text.slice(0, 2000),
          voice: "alloy",
          response_format: "wav",
        }),
      });
    } catch (error: any) {
      return { ok: false, result: `语音合成服务连接失败：${error instanceof Error ? error.message : String(error)}` };
    }
    if (!response.ok) return { ok: false, result: `语音合成失败（${response.status}），请检查服务配置` };
    wav = Buffer.from(await response.arrayBuffer());
  }
  const { encode, isWav } = await import("silk-wasm");
  if (!isWav(wav)) {
    return { ok: false, result: "语音合成服务没有返回 WAV 音频，请确认服务支持 response_format=wav" };
  }
  try {
    const silk = await encode(wav, 0);
    await fs.mkdir(path.dirname(resolved.path), { recursive: true });
    await fs.writeFile(resolved.path, Buffer.from(silk.data));
  } catch (error: any) {
    return { ok: false, result: `语音编码失败：${error instanceof Error ? error.message : String(error)}` };
  }
  const name = path.basename(resolved.path);
  pendingMedia.push({ kind: "voice", filePath: resolved.path, fileName: name });
  return { ok: true, result: `已合成语音并登记发送：${name}` };
}

// switch_workspace 工具处理器：模型在用户明确要求切换工作目录时调用，
// 与「更换工作目录至…」指令同口径（用户点名的目录直接切换，无需再单独审批），
// 落盘到 channel-chats.json 并同步内存记录，后续消息都在新目录里操作。
async function handleChannelSwitchWorkspace(args, { chatRecord, chatKey, workspacePath, userText }) {
  const rawPath = String(args?.path || "").trim();
  if (!rawPath) return { ok: false, result: "缺少目标目录路径" };
  if (!isWorkspaceSwitchRequest(userText)) {
    return { ok: false, result: "用户没有要求切换工作目录，不能自行更换" };
  }
  const resolved = await resolveWorkspaceSwitch(rawPath, workspacePath);
  if (!resolved.ok) return { ok: false, result: resolved.error };
  const nextPath = resolved.path;
  chatRecord.workspacePath = nextPath;
  chatRecord.updatedAt = new Date().toISOString();
  const chats = await readChannelChats();
  if (chats[chatKey]) {
    chats[chatKey].workspacePath = nextPath;
    chats[chatKey].updatedAt = chatRecord.updatedAt;
    await writeJson(dataFile("channel-chats.json"), chats);
  }
  channelDebug("渠道切换工作区(工具)", { chatKey, path: nextPath });
  return { ok: true, path: nextPath, result: `工作目录已切换为：${nextPath}。之后的任务都会在这个目录里操作。` };
}

// 渠道任务实时透传给渲染端的事件白名单：只转发会改变 UI 的轻量事件
// （活动流、正文流式、思考流、计划、循环状态、文件变更、审批/提问、上下文用量、任务开始/结束）。
// trace / token-usage / skill-saved / memory-saved 等只进本地留痕与统计，不打扰界面。
const CHANNEL_STREAM_EVENT_TYPES = new Set([
  "queue-start",
  "activity",
  "activity-update",
  "assistant-text",
  "assistant-reasoning",
  "file-change",
  "plan-update",
  "loop-state",
  "approval-request",
  "ask-user",
  "context-usage",
  "context-compacted",
  "agent-finished",
]);

// 渠道消息等待全局空闲的上限：桌面任务/定时任务/其他渠道任务长时间不结束时，
// 排队消息不能无限堆积（否则用户只会看到“排队数+1”而没有任何任务被执行）。
const CHANNEL_QUEUE_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

// 一条 IM 消息驱动的完整任务(范本:runScheduledTask)
async function runChannelTask({ channel, chat, chatKey, text, media, chatRecord, isNewChat, reply: rawReply, replyMedia, sendTyping, registerPending, clearPending }) {
  const myKey = String(chatKey || `${channel}:${chat?.chatId || ""}`);
  // 记录每次出站回复的实际内容：确认“回复内容=用户消息”是模型回显还是显示问题
  const reply = async (replyText) => {
    channelDebug("渠道回复", {
      chatKey: myKey,
      text: String(replyText || "").slice(0, 200),
    });
    return rawReply(replyText);
  };
  channelTaskKeys.add(myKey);
  const taskStartedAt = Date.now();
  channelDebug("渠道任务启动", {
    chatKey: myKey,
    text: String(text || "").slice(0, 80),
    messageId: String(chat?.messageId || ""),
    isNewChat,
  });
  // 渠道消息不可丢弃:桌面交互任务/定时任务执行期间,排队等待全局空闲；
  // 等待期间也要响应「停止」,否则会堵在守卫里无法中止
  // 等待本身必须有上限：头部任务若长时间不结束（网络/模型/审批等），
  // 后面的消息不能无限排队，否则用户只会看到“排队数+1”而没有任何任务被执行。
  const waitStartedAt = Date.now();
  while (!mcpShuttingDown && !channelTaskAborts.has(myKey) && (activeAgents.size || ctx.scheduler.running || runningChannelTaskCount > 0)) {
    await new Promise<any>((resolve) => setTimeout(resolve, 2000));
    if (!mcpShuttingDown && !channelTaskAborts.has(myKey) && Date.now() - waitStartedAt > CHANNEL_QUEUE_WAIT_TIMEOUT_MS) {
      channelDebug("渠道任务等待超时已跳过", {
        chatKey: myKey,
        text: String(text || "").slice(0, 80),
        activeAgents: activeAgents.size,
        runningScheduledTask: ctx.scheduler.running,
        runningChannelTaskCount,
        waitMs: Date.now() - waitStartedAt,
      });
      await reply("这条消息排队超过 10 分钟还没轮到（可能有更早的任务在长时间执行）。为避免一直阻塞后续消息，已取消这条，请重新发送。").catch(() => { });
      channelTaskKeys.delete(myKey);
      channelTaskAborts.delete(myKey);
      return;
    }
  }
  if (mcpShuttingDown || channelTaskAborts.has(myKey)) {
    channelDebug("渠道任务未执行已退出", { chatKey: myKey, text: String(text || "").slice(0, 80) });
    channelTaskKeys.delete(myKey);
    channelTaskAborts.delete(myKey);
    return;
  }
  runningChannelTaskCount += 1;
  trackTaskStart();
  // 本次渠道任务的运行 id：实时转发的 agent:event 信封与收尾 sessions:append 都带它，
  // 渲染端据此区分渠道运行与桌面运行（防重复气泡），并把收尾消息替换进流式占位气泡。
  const channelRunId = crypto.randomUUID();
  if (Date.now() - taskStartedAt > 2000) {
    channelDebug("渠道任务开始执行", {
      chatKey: myKey,
      text: String(text || "").slice(0, 80),
      waitedMs: Date.now() - taskStartedAt,
      activeAgents: activeAgents.size,
      runningScheduledTask: ctx.scheduler.running,
      runningChannelTaskCount,
    });
  }
  const channelLabel = CHANNEL_LABELS[channel] || channel;
  const sessionId = chatRecord.sessionId;
  // 双保险:manager 侧已修复历史脏数据,这里对非字符串值再做兜底重新推导
  const storedWorkspace = typeof chatRecord.workspacePath === "string" ? chatRecord.workspacePath.trim() : "";
  let workspacePath = storedWorkspace || await defaultChannelWorkspace();
  // 出站媒体登记（send_media / text_to_speech 工具写入，任务结束随最终回复发回）
  const pendingMedia = [];
  // 会话立即出现在列表里(先发用户消息,失败也留痕),助手结果随后追加。
  // userMessage 构造需要等待附件信息，放在 try 内完成（语音转写也改变文本内容）。
  let userText = "";
  let userMessage = null;
  const sendUserMessage = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (isNewChat) {
      mainWindow.webContents.send("sessions:prepend", {
        id: sessionId,
        title: String(chatRecord.title || `${channelLabel}消息`).slice(0, 40),
        workspacePath,
        channel,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [userMessage],
      });
    } else {
      mainWindow.webContents.send("sessions:append", { sessionId, workspacePath, channel, messages: [userMessage] });
    }
  };
  // 完成/挂起时只追加助手消息(buildMessages 的 [user, assistant] 里 user 已经上过屏)。
  // 带 runId：渲染端若已有本 run 的流式占位气泡则原位替换，而不是追加第二条。
  const sendAssistantMessages = (messages) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("sessions:append", { sessionId, workspacePath, channel, runId: channelRunId, messages });
  };
  // 渠道任务实时透传：把运行中的关键 agent 事件（活动/正文/计划/循环状态）转发到渲染端，
  // 让渠道会话像桌面任务一样边跑边显示，而不是等全部结束才一次性 append。
  // 只挑影响 UI 的轻量事件；trace/token-usage 等仍只进本地留痕。事件体再包一层 sessionId/runId，
  // 与桌面端 onAgentEvent 的负载形状一致，渲染端可用同一套归约逻辑处理。
  // channelRun: true 是渠道运行的标记：桌面端在同一渠道会话里发起的任务也发 agent:event，
  // 没有这个标记渲染端无法区分，会把同一条回复渲染成两个气泡。
  // 定义在 try 之外：catch 路径也要用它发收尾事件，若只在 try 内定义，
  // 早于定义行抛出的异常会让 catch 再抛 ReferenceError、吞掉真实错误。
  const forwardChannelEvent = (agentEvent) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!CHANNEL_STREAM_EVENT_TYPES.has(agentEvent?.type)) return;
    mainWindow.webContents.send("agent:event", { sessionId, runId: channelRunId, channelRun: true, event: agentEvent });
  };
  try {
    // 整条消息是「更换工作目录至…」时直接切换该聊天的操作目录，不经过模型。
    // 目录本身由用户点名的指令确认，等同在电脑端选择工作文件夹，无需再单独审批。
    const workspaceTarget = parseWorkspaceSwitch(text);
    if (workspaceTarget) {
      const switchResult = await resolveWorkspaceSwitch(workspaceTarget, workspacePath);
      // 明显是路径指令（成功解析，或带分隔符/盘符但目录不存在）才在这里直接答复；
      // 单 token 又不存在时更像任务正文里的说法，交给模型按普通消息处理。
      if (switchResult.ok || looksLikePathDirective(workspaceTarget)) {
        const switchText = switchResult.ok
          ? `工作目录已更换为：${switchResult.path}。之后的任务都会在这个目录里操作。`
          : switchResult.error;
        if (switchResult.ok) {
          workspacePath = switchResult.path;
          chatRecord.workspacePath = workspacePath;
          chatRecord.updatedAt = new Date().toISOString();
          const chats = await readChannelChats();
          if (chats[chatKey]) {
            chats[chatKey].workspacePath = workspacePath;
            chats[chatKey].updatedAt = chatRecord.updatedAt;
            await writeJson(dataFile("channel-chats.json"), chats);
          }
        }
        const attachments = await buildChannelAttachments(media);
        userText = `[来自${channelLabel}${chat.userName ? ` ${chat.userName}` : ""}] ${text}`;
        userMessage = {
          role: "user",
          content: userText,
          createdAt: new Date().toISOString(),
          ...(attachments.length ? { attachments } : {}),
        };
        const switchMessage = { role: "assistant", content: switchText, createdAt: new Date().toISOString() };
        sendUserMessage();
        sendAssistantMessages([switchMessage]);
        await reply(switchText).catch(() => { });
        return;
      }
    }
    const settings = await readSettings();
    // 渠道任务模型:默认跟随当前模型,可在渠道设置里固定为某个模型档案
    const profileId = String(settings.channels?.modelProfileId || "");
    const profile = profileId ? (settings.profiles || []).find((item) => item.id === profileId) : null;
    const taskSettings = profile
      ? { ...settings, endpoint: profile.endpoint, model: profile.model, apiKey: profile.apiKey, reasoningEffort: profile.reasoningEffort || "" }
      : settings;
    if (!taskSettings.endpoint || !taskSettings.model || !taskSettings.apiKey) {
      throw new Error("模型还没有配置,请先在电脑端完成设置");
    }
    if (!workspacePath) {
      throw new Error("还没有选择工作区,请先在电脑端打开 DYWorker 并选择工作区");
    }
    // QQ / 微信 语音附件是 silk/音频：解码 → WAV → 现有转写服务；失败/未配置时按占位文案进任务并提示
    let effectiveText = text;
    const voiceItem = (Array.isArray(media) ? media : []).find((item) => item?.kind === "voice" && item?.filePath);
    if (voiceItem) {
      if (channel === "qq" || !text || text === "[语音]") {
        try {
          const { text: transcribed, duration } = await transcribeQqVoice(voiceItem.filePath, taskSettings);
          if (transcribed) effectiveText = `[语音转写] ${transcribed}`;
          if (duration) voiceItem.duration = duration;
        } catch {
          if (channel === "qq") {
            await reply("收到语音，但语音识别服务还没有配置好。").catch(() => { });
          }
        }
      }
    }
    // 入站媒体 → 桌面附件（缩略图/文件名）；模型可见内容由 providerMessageContent 展开
    const attachments = await buildChannelAttachments(media);
    userText = `[来自${channelLabel}${chat.userName ? ` ${chat.userName}` : ""}] ${effectiveText}`;
    userMessage = {
      role: "user",
      content: userText,
      createdAt: new Date().toISOString(),
      ...(attachments.length ? { attachments } : {}),
    };
    sendUserMessage();
    // 渠道任务与桌面会话保持统一的审批权限（使用全局设置/桌面当前选择的审批模式）
    const approvalMode = normalizeApprovalMode(settings?.approvalMode);
    let baseRouter = createExtraToolRouter(taskSettings, workspacePath);
    // send_media / text_to_speech / switch_workspace 先由渠道处理器接管，其余交给现有 MCP/浏览器路由
    const routeExtraTool = async (name, args) => {
      if (name === "send_media") return handleChannelSendMedia(args, { workspacePath, pendingMedia });
      if (name === "text_to_speech") return handleChannelTextToSpeech(args, { workspacePath, pendingMedia, settings: taskSettings });
      if (name === "switch_workspace") {
        const result = await handleChannelSwitchWorkspace(args, { chatRecord, chatKey: myKey, workspacePath, userText: text });
        if (result.ok) {
          // 后续工具与本次任务收尾都用新目录；浏览器/MCP 路由也切到新工作区
          workspacePath = result.path;
          baseRouter.dispose();
          baseRouter = createExtraToolRouter(taskSettings, workspacePath);
          routeExtraTool.dispose = () => baseRouter.dispose();
        }
        return result;
      }
      return baseRouter(name, args);
    };
    routeExtraTool.dispose = () => baseRouter.dispose();
    const collector = createTranscriptCollector();
    const prior = await visibleConversationForSession(sessionId, "", "");
    const workingContext = await workingContextForSession(sessionId);
    // 模型可见内容：文本 + 图片块（复用桌面端 providerMessageContent）
    const contentForModel = await providerMessageContent({ content: userText, attachments });
    // 用「正在输入」状态提示处理中，不再以文字消息形式打扰
    await sendTyping().catch(() => { });
    const result = await ctx.agent.run({
      settings: taskSettings,
      // getter 形式：switch_workspace 中途切换后，记忆落盘/唤醒登记跟随最新目录
      workspacePath: () => workspacePath,
      sessionId,
      approvalMode,
      prompt: text,
      workingContext,
      conversation: [...prior, { role: "user", content: contentForModel }],
      auditExtras: { channel },
      extraTools: channelMediaToolDefinitions(),
      onExtraTool: routeExtraTool,
      isCancelled: () => channelTaskAborts.has(myKey),
      // 审批:收件箱(桌面可决议)+ IM 卡片(回复 允许/拒绝 决议),两侧共用 resolveInboxInternal
      // 等待有 10 分钟上限：超时按拒绝处理，避免渠道队列头部永久悬死
      requestApproval: async (action) => {
        const pending = ctx.inbox.create({
          kind: "approval",
          sessionId,
          tool: action.kind,
          title: `${channelLabel}消息申请：${action.title || action.kind}`,
          details: action.details,
          impact: action.impact,
        });
        registerPending({ itemId: pending.itemId, kind: "approval" });
        // IM 是纯文本：影响要点以纯文本列表附带，与桌面端 Markdown 渲染同一份内容
        const impactText = action.impact ? `\n\n操作影响：\n${action.impact}` : "";
        await reply(
          `⚠️ 需要审批\n${action.title || action.kind}\n${String(action.details || "").slice(0, 400)}${impactText}\n\n回复 1 允许 / 0 拒绝 / 2 停止整个任务。10 分钟未回复将自动取消。`.trim(),
        ).catch(() => { });
        const resolution = await ctx.inbox.awaitWithTimeout(pending, "审批等待超时，已自动取消");
        clearPending();
        if (resolution?.timedOut) {
          await reply("审批等待超时，已自动取消这次操作。").catch(() => { });
        }
        return Boolean(resolution?.ok);
      },
      requestUserInput: async (request) => {
        const pending = ctx.inbox.create({
          kind: "question",
          sessionId,
          question: request.question,
          options: request.options,
          title: `${channelLabel}消息提问`,
        });
        registerPending({ itemId: pending.itemId, kind: "question", options: request.options || [] });
        const optionsText = (request.options || []).map((option, index) => `${index + 1}. ${option}`).join("\n");
        await reply(`❓ ${request.question}${optionsText ? `\n\n${optionsText}\n回复序号或直接回答。` : ""}\n10 分钟未回复将按已有信息继续。`.trim()).catch(() => { });
        const resolution = await ctx.inbox.awaitWithTimeout(pending, "提问等待超时，按已有信息继续");
        clearPending();
        return resolution;
      },
      emit: (agentEvent) => {
        collector.handle(agentEvent);
        forwardChannelEvent(agentEvent);
      },
    });
    if (channelTaskAborts.has(myKey) || result.status === "cancelled") {
      // 「停止」指令已经回复过,这里只把半截结果留痕到桌面会话,不再发 IM 最终结果。
      // 半截正文保留在留痕里（与桌面端"已按你的要求停止"同口径），用户不至于丢失已生成的内容。
      const partial = String(result.finalText || "").trim();
      const cancelledContent = partial ? `${partial}\n\n（用户通过渠道消息停止了任务）` : "（用户通过渠道消息停止了任务）";
      sendAssistantMessages(collector.buildMessages(userText, { ...result, status: "cancelled" }, cancelledContent).slice(1));
      // 收尾事件：渲染端据此清掉运行标记（正常完成路径在 reply 之后同样会发）
      forwardChannelEvent({
        type: "agent-finished",
        result: { status: "cancelled", finalText: result.finalText || "", durationMs: Date.now() - taskStartedAt },
      });
      return;
    }
    if (result.status === "sleeping" && result.wake) {
      // 主动挂起:沿用 self-wake 机制,到点由 checkDueWakes 续跑(审批走收件箱)
      await ctx.scheduler.registerWake({
        sessionId,
        workspacePath,
        approvalMode,
        wake: result.wake,
        prompt: text,
        finalText: result.finalText,
      });
      const note = `已主动挂起,将于 ${new Date(result.wake.wakeAt).toLocaleString("zh-CN")} 自动继续(原因:${result.wake.reason})。`;
      await reply(note).catch(() => { });
      sendAssistantMessages(collector.buildMessages(userText, result, `${result.finalText || ""}\n\n${note}`.trim()).slice(1));
      // 挂起同样是本轮收尾：渲染端清掉运行标记,到点续跑由调度路径另行起会话
      forwardChannelEvent({
        type: "agent-finished",
        result: { status: "sleeping", finalText: result.finalText || "", wake: result.wake, durationMs: Date.now() - taskStartedAt },
      });
      return;
    }
    const finalText = result.finalText || result.reason || "没有产出结果";
    if (pendingMedia.length) {
      // 出站媒体：finalText 作为第一条 text part，随后每个媒体一条 media part；
      // 发送失败逐条降级为文字说明（决策记录第 9 节：与文本回复同权责）
      const parts = [
        { type: "text", text: finalText },
        ...pendingMedia.map((item) => ({
          type: "media",
          kind: item.kind,
          filePath: item.filePath,
          fileName: item.fileName,
          ...(item.caption ? { caption: item.caption } : {}),
        })),
      ];
      let sendFailed = false;
      let sendFailureNote = "";
      try {
        await replyMedia(parts);
      } catch (error: any) {
        sendFailed = true;
        const reason = error instanceof Error ? error.message : String(error);
        // 与任务级错误提示同口径：去掉原始 JSON/堆栈，截断后只留简明原因
        const friendly = (reason.replace(/\s*[{[].*$/s, "") || reason).slice(0, 160);
        sendFailureNote = `（发送失败：${friendly}）`;
        for (const part of parts) {
          if (part.type !== "media") continue;
          await reply(`[已生成 ${(part as any).fileName || "文件"}，但发送失败：${friendly}]`).catch(() => { });
        }
      }
      const sentNote = sendFailed ? sendFailureNote : `（已发送 ${pendingMedia.length} 个文件）`;
      // 出站媒体同步进桌面会话：和入站一样走 Attachment 描述，让图片/文件在对话里可见
      const outboundAttachments = await buildChannelAttachments(pendingMedia);
      const built = collector.buildMessages(userText, result, `${finalText}${sentNote}`);
      if (outboundAttachments.length) (built[1] as any).attachments = outboundAttachments;
      sendAssistantMessages(built.slice(1));
    } else {
      await reply(finalText).catch(() => { });
      sendAssistantMessages(collector.buildMessages(userText, result).slice(1));
    }
    // 通知渲染端本轮渠道任务已结束：渲染端据此给流式气泡打上最终状态、清掉运行标记。
    // 结果体带 plan/changes/durationMs，渲染端用它把已实时展示的 assistant 消息收口为最终形态。
    forwardChannelEvent({
      type: "agent-finished",
      result: {
        status: result.status,
        reason: result.reason,
        finalText: result.finalText,
        wake: result.wake,
        changes: collector.changes?.(),
        plan: collector.plan?.(),
        durationMs: Date.now() - taskStartedAt,
      },
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    // IM 侧给简明原因(截掉原始 JSON/堆栈),完整信息留在桌面会话里
    const friendly = (message.replace(/\s*[{[].*$/s, "") || message).slice(0, 200);
    await reply(`出错了:${friendly}`).catch(() => { });
    sendAssistantMessages([{ role: "assistant", content: `出错了:${message}`, createdAt: new Date().toISOString() }]);
    forwardChannelEvent({
      type: "agent-finished",
      result: { status: "error", reason: message, durationMs: Date.now() - taskStartedAt },
    });
  } finally {
    clearPending();
    trackTaskEnd();
    runningChannelTaskCount = Math.max(0, runningChannelTaskCount - 1);
    channelTaskKeys.delete(myKey);
    channelTaskAborts.delete(myKey);
    channelDebug("渠道任务结束", {
      chatKey: myKey,
      text: String(text || "").slice(0, 80),
      durationMs: Date.now() - taskStartedAt,
      runningChannelTaskCount,
    });
  }
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
    secretStorage: safeStorage,
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
    if (app.isPackaged) {
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
      void ctx.scheduler.checkDueWakes().then(() => ctx.scheduler.checkDueSchedules());
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
      app.quit();
    });
});
