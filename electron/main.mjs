import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, powerSaveBlocker, safeStorage, screen, session, shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bareModelName, builtinHooks, isResponsesEndpoint, isSafePublicUrl, normalizeModelEndpoint, parseModelJson, probeServerContextLimit, requestModel, runAgent, suggestStandingRule } from "./agent.mjs";
import { createAuditLog } from "./audit.mjs";
import { BrowserAgent, browserToolDefinitions } from "./browser.mjs";
import { CHANNEL_LABELS, createChannelManager } from "./channels/manager.mjs";
import { CHANNEL_MEDIA_EXTENSIONS, MAX_MEDIA_BYTES, channelMediaToolDefinitions, mediaKindForExtension, verifyChannelMediaPath } from "./channels/media-tools.mjs";
import { parseApprovalReply } from "./channels/qq-bot.mjs";
import { isWorkspaceSwitchRequest, looksLikePathDirective, parseWorkspaceSwitch, resolveWorkspaceSwitch } from "./channels/workspace.mjs";
import { COMPUTER_USE_INSTALL_TIMEOUT_MS, COMPUTER_USE_SERVER_ID, discoverComputerUseServer } from "./computer-use.mjs";
import { buildMemoryRecord, builtinMemories, extractExplicitMemoryInstructions, isBuiltinMemoryId, normalizeMemories } from "./memory.mjs";
import { applyConsolidation, buildConsolidationMessages, ensureWiki, integrateItems, listWikiPages, parseConsolidationResult, readWikiPages, removeWikiMemory, serializeMemoryRow } from "./memory-wiki.mjs";
import { McpClient } from "./mcp.mjs";
import { countUndecryptableSecrets, decryptChannelSecret, deserializeSettings, encryptChannelSecret, needsSecretMigration, normalizeApprovalMode, normalizePreventSleep, normalizeTranscriptionEngine, normalizeTtsEngine, preserveUndecryptableSecrets, serializeSettings } from "./settings.mjs";
import { discoverFileSkills, mergeSkillRecords } from "./skills.mjs";
import { SESSION_TOOL_NAMES, handleSessionTool, sessionToolDefinitions } from "./session-tools.mjs";
import { installSkillFromLibrary, searchSkillLibraries } from "./skill-libraries.mjs";
import { registerLocalImageIpc } from "./local-image.mjs";
import { saveClipboardImage } from "./clipboard-image.mjs";
import { importLegacyData } from "./legacy-data.mjs";
import { configureLocalReviewer, downloadLocalReviewerModel, localReviewerModelStatus, resetLocalReviewerEngine } from "./local-reviewer.mjs";
import { configureLocalAsr, downloadLocalAsrModel, downloadLocalAsrRuntime, localAsrAllModelsStatus, localAsrModelStatus, localAsrRuntimeStatus } from "./local-asr.mjs";
import { stopLocalAsrServer, stripAsrText, transcribeWithLocalAsr } from "./local-asr-server.mjs";
import { configureLocalTts, downloadLocalTtsModel, localTtsAllModelsStatus, localTtsModelStatus, localTtsRuntimeStatus, normalizeTtsModelId } from "./local-tts.mjs";
import { synthesizeWithLocalTts } from "./local-tts-engine.mjs";
import { getWorkspaceContext, listWorkspace, readWorkspaceFile, readWorkspaceMarkdown, writeWorkspaceFile } from "./workspace.mjs";
import { gitCheckout, gitCommit, gitCommitDiff, gitCreateBranch, gitDiffStats, gitDiscard, gitFileDiff, gitPush, gitReviewOverview, gitStage, listGitBranches } from "./git.mjs";
import { importBrowserData, listImportableBrowsers } from "./browser-import.mjs";
import { SessionQueue } from "./session-queue.mjs";
import { DEFAULT_UPDATE_URL, createUpdaterController, normalizeUpdateUrl, parseGithubUpdateUrl } from "./app-updater.mjs";
import { backgroundTasksManager } from "./background-tasks.mjs";

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
const isDevelopment = !app.isPackaged;
const rendererEntryUrl = isDevelopment
  ? process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173"
  : pathToFileURL(path.join(here, "../dist/client/index.html")).href;
let mainWindow;
let embeddedBrowserContents = null;
let appUpdater;
let appUpdateTimer = null;
let appUpdateInterval = null;
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

app.setName("DYWorker");
nativeTheme.themeSource = "system";
if (process.platform === "linux") {
  app.disableHardwareAcceleration();
}

function systemWindowBackground() {
  return nativeTheme.shouldUseDarkColors ? "#181916" : "#f7f7f4";
}

// Linux 无边框窗口默认没有系统阴影，需要透明窗口由渲染端自绘。
// 默认启用条件：
// - Wayland 会话（应用走 XWayland）：由 Wayland 合成器负责混合透明窗口；
// - X11 会话：检测到合成器（_NET_WM_CM_S0）。
// 透明窗口在部分 X11/XWayland 桌面上会拿不到键盘焦点（窗口未被窗口管理器
// 接管，表现为能点但无法打字）。创建后会做焦点健康检查，确认拿不到焦点时
// 自动重建为不透明窗口（见 createWindow 内 Linux 分支），保证输入可用。
// 环境变量覆盖：DYWORKER_NO_WINDOW_SHADOW=1 强制关闭；
// DYWORKER_FORCE_WINDOW_SHADOW=1 强制开启（保留诊断日志，不自动回退）。
let linuxWindowShadowCache;
let currentWindowShadow = false;
// 重建窗口期间置位：销毁最后一个窗口会触发 window-all-closed，若此时应用
// 退出，就表现为“进程还在但界面消失”。重建期间不退出，等新窗口接管。
let recreatingWindow = false;
function supportsLinuxWindowShadow() {
  if (process.platform !== "linux") return false;
  if (linuxWindowShadowCache !== undefined) return linuxWindowShadowCache;
  if (process.env.DYWORKER_NO_WINDOW_SHADOW === "1") {
    linuxWindowShadowCache = false;
    return false;
  }
  if (process.env.DYWORKER_FORCE_WINDOW_SHADOW === "1") {
    linuxWindowShadowCache = true;
    return true;
  }
  const waylandSession =
    process.env.XDG_SESSION_TYPE === "wayland" || Boolean(process.env.WAYLAND_DISPLAY);
  // 纯 Wayland（无 DISPLAY/XWayland）下老合成器既可能不映射窗口，也可能
  // 不支持透明混合；此时不启用透明阴影，保证窗口可显示。
  let composited = waylandSession && Boolean(process.env.DISPLAY);
  if (!composited && process.env.DISPLAY) {
    try {
      const probe = spawnSync("xprop", ["-root", "_NET_WM_CM_S0"], {
        encoding: "utf8",
        timeout: 2000,
      });
      composited = probe.status === 0 && String(probe.stdout || "").includes("window id");
    } catch {
      composited = false;
    }
  }
  linuxWindowShadowCache = composited;
  console.log(
    `[dyworker] linux window shadow: ${composited ? "enabled" : "disabled"}` +
      ` (session=${process.env.XDG_SESSION_TYPE || "x11"}, wayland=${Boolean(process.env.WAYLAND_DISPLAY)})`,
  );
  return linuxWindowShadowCache;
}

nativeTheme.on("updated", () => {
  if (mainWindow && !mainWindow.isDestroyed() && !currentWindowShadow) {
    mainWindow.setBackgroundColor(systemWindowBackground());
  }
});

// 诊断：检查 X11 窗口是否被窗口管理器接管。透明无边框窗口拿不到键盘焦点
// 的常见原因是窗口成了 override-redirect（不受 WM 管理）。
function describeLinuxWindowState(win) {
  try {
    const handle = win.getNativeWindowHandle();
    if (!handle || handle.length < 4) return "no-native-handle";
    const xid = `0x${handle.readUInt32LE(0).toString(16)}`;
    const probe = spawnSync("xwininfo", ["-id", xid], { encoding: "utf8", timeout: 2000 });
    if (probe.status === 0) {
      const override = /Override Redirect State:\s*(yes|no)/i.exec(probe.stdout);
      const managed = /WM_STATE/i.test(probe.stdout) ? "managed" : "no-wm-state";
      return override ? `override-redirect=${override[1]},${managed}` : `xwininfo-parse-miss,${managed}`;
    }
    // xwininfo 缺失时退而用 xprop 判断窗口是否被窗口管理器接管
    //（xprop 已用于合成器检测，作为兜底依赖更常见）。
    const fallback = spawnSync("xprop", ["-id", xid, "WM_STATE", "_NET_WM_STATE"], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (fallback.status === 0) {
      if (/WM_STATE\s*:/.test(fallback.stdout) || /_NET_WM_STATE\s*:/.test(fallback.stdout)) {
        return "override-redirect=unknown,managed(xprop)";
      }
      return "override-redirect=unknown,no-wm-state";
    }
    const detail = String(fallback.stderr || fallback.error?.message || "unknown").trim().slice(0, 60);
    return `xwininfo-failed(${detail || "no-stderr"})`;
  } catch (error) {
    return `xwininfo-error(${error instanceof Error ? error.message : String(error)})`;
  }
}

// Linux 透明窗口故障时重建为不透明窗口。重建期间置位 recreatingWindow，
// 避免窗口销毁触发 window-all-closed 退出应用（表现为进程在但界面消失）。
function rebuildLinuxWindowAsSolid() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  const maximized = mainWindow.isMaximized();
  recreatingWindow = true;
  try {
    mainWindow.destroy();
  } finally {
    try {
      createWindow({ solidFallback: true });
    } finally {
      recreatingWindow = false;
    }
  }
  if (mainWindow) {
    if (maximized) mainWindow.maximize();
    else mainWindow.setBounds(bounds);
  }
}

function dataFile(name) {
  return path.join(app.getPath("userData"), name);
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

ipcMain.handle("app-update:status", () => appUpdater?.getStatus() || {
  state: "unavailable",
  currentVersion: app.getVersion(),
});

ipcMain.handle("app-update:check", () => checkForAppUpdate());
ipcMain.handle("app-update:download", () => appUpdater?.download() || {
  ok: false,
  state: "unavailable",
  error: "更新服务尚未准备好",
});
ipcMain.handle("app-update:install", () => appUpdater?.install() || {
  ok: false,
  state: "unavailable",
  error: "更新服务尚未准备好",
});

// 审计日志（audit.jsonl）：有副作用的工具调用，审批决策与执行结果逐条落盘
const auditLog = createAuditLog({ filePath: path.join(app.getPath("userData"), "audit.jsonl") });

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

ipcMain.handle("reviewer-local:status", () => localReviewerModelStatus());
ipcMain.handle("reviewer-local:download", async () => {
  try {
    const result = await downloadLocalReviewerModel({
      onProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("reviewer-local:download-progress", progress);
        }
      },
    });
    return { ok: true, ...result, status: localReviewerModelStatus() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("reviewer-local:choose-dir", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择审核模型保存目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

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

ipcMain.handle("voice-local:status", async () => {
  const saved = await readSettings();
  const modelId = applyAsrSettings(saved);
  return {
    engine: asrSettingsFrom(saved).engine,
    model: localAsrModelStatus(modelId),
    models: localAsrAllModelsStatus(),
    runtime: localAsrRuntimeStatus(asrServerPathApplied),
  };
});

ipcMain.handle("voice-local:download", async (_event, payload) => {
  try {
    // 先应用磁盘上的最新设置：改了保存路径后无需重启，下载直接落到新目录
    const saved = await readSettings();
    const savedModelId = applyAsrSettings(saved);
    // 下载界面当前选中的模型（未指定时用设置里保存的模型）
    const requestedModelId = String(payload?.modelId || "").trim() || savedModelId;
    // 再拉引擎二进制（十几 MB），最后拉模型两个文件（约 1-3GB），进度统一推送
    await downloadLocalAsrRuntime({
      onProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("voice-local:download-progress", progress);
        }
      },
    });
    await downloadLocalAsrModel({
      modelId: requestedModelId,
      onProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("voice-local:download-progress", { ...progress, modelId: requestedModelId });
        }
      },
    });
    return {
      ok: true,
      status: {
        model: localAsrModelStatus(requestedModelId),
        models: localAsrAllModelsStatus(),
        runtime: localAsrRuntimeStatus(asrServerPathApplied),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("voice-local:choose-dir", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择语音模型保存目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

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

ipcMain.handle("tts-local:status", async () => {
  const saved = await readSettings();
  const modelId = applyTtsSettings(saved);
  return {
    engine: normalizeTtsEngine(saved.ttsEngine),
    model: localTtsModelStatus(modelId),
    models: localTtsAllModelsStatus(),
    runtime: localTtsRuntimeStatus(),
  };
});

ipcMain.handle("tts-local:download", async (_event, payload) => {
  try {
    // 先应用磁盘上的最新设置：改了保存路径后无需重启，下载直接落到新目录
    const saved = await readSettings();
    const savedModelId = applyTtsSettings(saved);
    // 下载界面当前选中的模型（未指定时用设置里保存的模型）
    const requested = String(payload?.modelId || "").trim();
    const requestedModelId = requested ? normalizeTtsModelId(requested) : savedModelId;
    // 引擎二进制与 ASR 共用（llama-tts 在同一压缩包里），没有就先拉运行时，再拉模型（约 1.5-2.3GB）
    await downloadLocalAsrRuntime({
      onProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("tts-local:download-progress", { ...progress, phase: `runtime:${progress.phase}` });
        }
      },
    });
    await downloadLocalTtsModel({
      modelId: requestedModelId,
      onProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("tts-local:download-progress", { ...progress, modelId: requestedModelId });
        }
      },
    });
    return {
      ok: true,
      status: {
        model: localTtsModelStatus(requestedModelId),
        models: localTtsAllModelsStatus(),
        runtime: localTtsRuntimeStatus(),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("tts-local:choose-dir", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择语音合成模型保存目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

// 选择参考音色音频（本地 TTS 克隆音色用；wav/mp3 等格式，压缩格式由渲染层转码后写回）
ipcMain.handle("tts-local:choose-voice", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择参考音色音频",
    properties: ["openFile"],
    filters: [{ name: "音频", extensions: ["wav", "mp3", "flac", "ogg", "m4a", "aac", "opus", "webm"] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

// 读取参考音色音频原始字节给渲染层解码（Web Audio 认识 m4a/aac/opus，llama.cpp 不认识）
ipcMain.handle("tts-local:read-voice", async (_event, payload) => {
  const voicePath = String(payload?.path || "").trim();
  if (!voicePath) return { ok: false, error: "缺少音频路径" };
  try {
    const stat = await fs.stat(voicePath);
    if (stat.size > 100 * 1024 * 1024) return { ok: false, error: "音频文件过大（超过 100MB）" };
    return { ok: true, bytes: new Uint8Array(await fs.readFile(voicePath)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// 保存渲染层转码出的 24kHz 单声道 wav（m4a 等格式 llama.cpp 解不了，统一落一份 wav 供合成使用）
ipcMain.handle("tts-local:write-voice", async (_event, payload) => {
  const bytes = payload?.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.length <= 44) {
    return { ok: false, error: "转换结果无效" };
  }
  try {
    const target = path.join(app.getPath("userData"), "tts-voice-converted.wav");
    await fs.writeFile(target, Buffer.from(bytes));
    return { ok: true, path: target };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// 会话内朗读：把文本合成为 wav 返回给渲染层播放（与渠道语音发送同一套 TTS 设置，
// 不走 silk 编码、不登记发送）。本地引擎用 Qwen3-TTS，云端引擎走 OpenAI 兼容 /audio/speech。
ipcMain.handle("tts:speak", async (_event, payload) => {
  const text = String(payload?.text || "").trim();
  if (!text) return { ok: false, error: "没有可朗读的文本" };
  const saved = await readSettings();
  applyTtsSettings(saved);
  if (normalizeTtsEngine(saved.ttsEngine) === "local") {
    try {
      const { wav } = await synthesizeWithLocalTts({
        text: text.slice(0, 2000),
        voicePath: String(saved.ttsVoicePath || "").trim(),
      });
      return { ok: true, wav };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const ttsEndpoint = String(saved.ttsEndpoint || "").trim();
  if (!ttsEndpoint) {
    return { ok: false, error: "语音合成服务还没有配置：请在设置中填写合成服务地址或切换到本地引擎" };
  }
  const apiKey = String(saved.ttsApiKey || saved.apiKey || "").trim();
  const ttsUrl = ttsEndpoint.endsWith("/audio/speech")
    ? ttsEndpoint
    : `${ttsEndpoint.replace(/\/+$/, "")}/audio/speech`;
  let response;
  try {
    response = await fetch(ttsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: String(saved.ttsModel || "tts-1"),
        input: text.slice(0, 2000),
        voice: "alloy",
        response_format: "wav",
      }),
    });
  } catch (error) {
    return { ok: false, error: `语音合成服务连接失败：${error instanceof Error ? error.message : String(error)}` };
  }
  if (!response.ok) return { ok: false, error: `语音合成失败（${response.status}），请检查服务配置` };
  return { ok: true, wav: new Uint8Array(await response.arrayBuffer()) };
});

// 读取语音附件音频数据供渲染层播放（支持 .silk 解码为 wav，其他音频直接返回 bytes）
ipcMain.handle("audio:read-attachment", async (_event, payload) => {
  const targetPath = String(payload?.path || "").trim();
  if (!targetPath) return { ok: false, error: "缺少音频文件路径" };
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isFile()) return { ok: false, error: "音频文件不存在" };
    const rawBuffer = await fs.readFile(targetPath);
    const { decode, isSilk, isWav } = await import("silk-wasm");
    const ext = path.extname(targetPath).toLowerCase();

    // 检查是否为 silk 编码（无论是 .silk 后缀，还是由于历史原因存成 .bin 的 silk 数据，或包含 #!SILK 魔数）
    if (isSilk(rawBuffer) || ext === ".silk" || rawBuffer.includes(Buffer.from("#!SILK"))) {
      try {
        const pcm = await decode(rawBuffer, 24000);
        const duration = pcm.duration ? Math.round(pcm.duration / 1000) : Math.max(1, Math.round(pcm.data.byteLength / (24000 * 2)));
        const wav = buildWavFromPcm(Buffer.from(pcm.data), 24000);
        return { ok: true, wav: new Uint8Array(wav), mimeType: "audio/wav", duration };
      } catch (silkError) {
        // silk 解码失败时继续往下走普通音频分支
      }
    }

    // 如果本身就是 WAV 格式
    if (isWav(rawBuffer) || ext === ".wav") {
      return { ok: true, wav: new Uint8Array(rawBuffer), mimeType: "audio/wav" };
    }

    // 其他音频类型（mp3 / m4a / aac / ogg / opus 等）
    const mimeType = attachmentType(targetPath);
    const resolvedMime = mimeType.startsWith("audio/") ? mimeType : (ext === ".mp3" ? "audio/mpeg" : (ext === ".ogg" ? "audio/ogg" : "audio/wav"));
    return { ok: true, bytes: new Uint8Array(rawBuffer), mimeType: resolvedMime };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

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
async function writeJson(file, value) {
  const previous = jsonWriteChains.get(file) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(temporary, file);
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
function channelDebug(event, payload = {}) {
  const line = `[${new Date().toISOString()}] ${event} ${JSON.stringify(payload)}`;
  console.log("[channel-debug]", line);
  const file = path.join(app.getPath("userData"), "channel-debug.log");
  channelDebugChain = channelDebugChain
    .catch(() => {})
    .then(async () => {
      try {
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
  const stored = await readJson(dataFile("settings.json"), {});
  const settings = deserializeSettings(stored, safeStorage);
  applyReviewerModelDir(settings);
  // 语音模型目录与审核模型同款策略：每次读设置都应用最新目录，改路径保存后立即生效
  applyAsrSettings(settings);
  applyTtsSettings(settings);
  const approvalModeMigrated = stored?.approvalMode !== settings.approvalMode
    || stored?.channels?.approvalMode === "allow-writes";
  const updateUrlMigrated = stored?.updateUrl !== settings.updateUrl;
  if (needsSecretMigration(stored) || approvalModeMigrated || updateUrlMigrated) {
    // 解不开的密钥密文必须原样保留（签名变化导致暂时解不开时，写空值会永久毁掉密钥）
    await writeJson(dataFile("settings.json"), preserveUndecryptableSecrets(serializeSettings(settings, safeStorage), stored, safeStorage));
  }
  return settings;
}

async function saveSettings(settings) {
  const rawUpdateUrl = String(settings?.updateUrl || DEFAULT_UPDATE_URL).trim() || DEFAULT_UPDATE_URL;
  parseGithubUpdateUrl(rawUpdateUrl);
  const updateUrl = normalizeUpdateUrl(rawUpdateUrl);
  const nextSettings = { ...settings, updateUrl };
  const stored = await readJson(dataFile("settings.json"), {});
  await writeJson(dataFile("settings.json"), preserveUndecryptableSecrets(serializeSettings(nextSettings, safeStorage), stored, safeStorage));
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
  let previewUrl;
  if (isImage) {
    const source = nativeImage.createFromPath(filePath);
    if (!source.isEmpty()) {
      const size = source.getSize();
      const scale = Math.min(1, 480 / Math.max(1, size.width), 320 / Math.max(1, size.height));
      const preview = scale < 1
        ? source.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: "good",
          })
        : source;
      previewUrl = `data:image/png;base64,${preview.toPNG().toString("base64")}`;
    }
  }
  return {
    name: path.basename(filePath),
    path: filePath,
    size: stat.size,
    mimeType,
    isImage,
    isVoice,
    ...(previewUrl ? { previewUrl } : {}),
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
    } catch (error) {
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

function createWindow({ solidFallback = false } = {}) {
  if (process.platform === "linux") {
    Menu.setApplicationMenu(null);
  }

  const linuxWindowShadow = !solidFallback && supportsLinuxWindowShadow();
  currentWindowShadow = linuxWindowShadow;
  const windowOptions = {
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 660,
    backgroundColor: linuxWindowShadow ? "#00000000" : systemWindowBackground(),
    show: process.platform === "linux",
    title: "DYWorker",
    frame: false,
    ...(linuxWindowShadow ? { transparent: true } : {}),
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  };

  mainWindow = new BrowserWindow(windowOptions);
  mainWindow.on("maximize", () => mainWindow?.webContents.send("window:maximized-changed", true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("window:maximized-changed", false));
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
      } catch (error) {
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
  // 透明窗口健康检查：部分 X11/XWayland 桌面上透明无边框窗口拿不到键盘
  // 焦点（override-redirect，能点但无法打字）。用户点击窗口后若仍拿不到
  // 焦点，自动重建为不透明窗口，保证输入可用。仅在用户实际点击窗口后
  // 检查，避免在用户使用其他窗口时抢焦点。
  if (process.platform === "linux" && linuxWindowShadow) {
    let everFocused = false;
    mainWindow.on("focus", () => {
      everFocused = true;
    });
    // 启动后主动确认透明窗口被窗口管理器接管：部分 X11/XWayland 桌面上
    // 透明无边框窗口会成为 override-redirect（不受 WM 管理），可能不显示
    // 也不在任务栏。此时无法靠点击触发键盘焦点检查，改为窗口显示后定时
    // 检查接管状态，未接管则自动重建为不透明窗口。
    const checkWindowMapped = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!mainWindow.isVisible()) {
        console.log("[dyworker] linux transparent window is not visible; rebuilding as solid");
        rebuildLinuxWindowAsSolid();
        return;
      }
      const windowState = describeLinuxWindowState(mainWindow);
      if (
        !windowState ||
        windowState.includes("xwininfo-failed") ||
        windowState.includes("xwininfo-error") ||
        windowState.includes("xwininfo-parse-miss")
      ) {
        console.log(`[dyworker] linux window state check skipped: ${windowState || "unknown"}`);
        return;
      }
      if (windowState.includes("override-redirect=yes") || windowState.includes("no-wm-state")) {
        console.log(
          `[dyworker] linux transparent window is not managed (${windowState}); rebuilding as solid`,
        );
        rebuildLinuxWindowAsSolid();
        return;
      }
      console.log(`[dyworker] linux window state check: ${windowState}`);
    };
    mainWindow.once("show", () => {
      setTimeout(checkWindowMapped, 1200);
    });
    const tryEnsureFocus = () => {
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
      if (everFocused || mainWindow.isFocused()) return;
      mainWindow.focus();
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const windowState = describeLinuxWindowState(mainWindow);
        mainWindow.webContents
          .executeJavaScript("document.hasFocus()")
          .then((hasFocus) => {
            if (hasFocus || mainWindow.isFocused()) return;
            if (process.env.DYWORKER_FORCE_WINDOW_SHADOW === "1") {
              console.log(
                `[dyworker] linux transparent window cannot gain keyboard focus (${windowState}); ` +
                  "DYWORKER_FORCE_WINDOW_SHADOW=1 keeps it for diagnosis",
              );
              return;
            }
            console.log(
              `[dyworker] linux transparent window cannot gain keyboard focus (${windowState}); ` +
                "rebuilding as a solid window without shadow",
            );
            rebuildLinuxWindowAsSolid();
          })
          .catch(() => {
            // 诊断失败不影响窗口使用
          });
      }, 400);
    };
    ipcMain.on("window:pointer-down", tryEnsureFocus);
    mainWindow.once("closed", () => {
      ipcMain.removeListener("window:pointer-down", tryEnsureFocus);
    });
  }
  // Linux 透明窗口下如果渲染器没有挂载任何内容，整个窗口是完全透明的，
  // 表现为“进程在但界面不显示”。加载完成后检查一次渲染内容，空白时
  // 先重新加载一次，仍空白则重建为不透明窗口，保证至少能看到界面。
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
      } catch (error) {
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
      console.log("[dyworker] linux renderer still blank after reload; forcing solid window for visibility");
      if (currentWindowShadow) {
        rebuildLinuxWindowAsSolid();
      }
    };
    mainWindow.webContents.on("did-finish-load", () => {
      setTimeout(() => void ensureRendererContent(), 2000);
    });
  }
  mainWindow.once("closed", () => {
    mainWindow = undefined;
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => permission === "media");
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  if (process.platform !== "linux") mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
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

  const localHtmlPath = path.join(here, "../dist/client/index.html");
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

// 右侧浏览器标签页使用 webview 内嵌网页；远程页面始终关闭 Node 能力，并拦截本机/内网跳转。
app.on("will-attach-webview", (event, webPreferences, params) => {
  delete webPreferences.preload;
  webPreferences.nodeIntegration = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  if (params.src && params.src !== "about:blank" && !isSafePublicUrl(params.src).ok) event.preventDefault();
});

app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  embeddedBrowserContents = contents;
  contents.once("destroyed", () => {
    if (embeddedBrowserContents === contents) embeddedBrowserContents = null;
  });
  contents.on("will-navigate", (event, url) => {
    if (!isSafePublicUrl(url).ok) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});

function waitForEmbeddedBrowser(sender, url) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const previousUrl = embeddedBrowserContents?.getURL?.() || "";
    let observedContents = null;
    let timer = null;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (observedContents) {
        observedContents.removeListener("did-stop-loading", onStop);
        observedContents.removeListener("did-fail-load", onFail);
        observedContents.removeListener("destroyed", onDestroyed);
      }
      resolve(result);
    };
    const onStop = () => {
      const contents = observedContents;
      if (!contents || contents.isDestroyed()) return;
      const currentUrl = contents.getURL();
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
      if (!sender || sender.isDestroyed()) {
        finish({ ok: false, result: "当前任务窗口已关闭" });
        return;
      }
      if (Date.now() - startedAt > 20000) {
        finish({ ok: false, result: "右侧浏览器面板加载超时" });
        return;
      }
      const contents = embeddedBrowserContents;
      if (contents && !contents.isDestroyed()) {
        if (observedContents !== contents) {
          observedContents = contents;
          contents.once("did-stop-loading", onStop);
          contents.once("did-fail-load", onFail);
          contents.once("destroyed", onDestroyed);
        }
        const currentUrl = contents.getURL();
        if (currentUrl === url && !contents.isLoading()) {
          finish({ ok: true, contents });
          return;
        }
      }
      timer = setTimeout(poll, 50);
    };

    try {
      sender.send("browser:panel-request", { action: "open", url });
    } catch (error) {
      finish({ ok: false, result: `无法打开右侧浏览器面板：${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    poll();
  });
}

function requestCloseEmbeddedBrowser(sender) {
  if (!sender || sender.isDestroyed()) return;
  sender.send("browser:panel-request", { action: "close" });
}

registerLocalImageIpc(ipcMain, {
  isTrustedSender: (event) => isTrustedRendererUrl(event.senderFrame?.url),
});

// 电脑端给渠道会话更换工作区的内存基线：sessionId -> workspacePath。
// 只对比变化，避免每次 sessions:save 都全量重读 sessions.json。
let lastChannelWorkspaceBySession = new Map();

async function syncChannelSessionWorkspaces(incoming) {
  for (const session of incoming) {
    if (!session?.channel) continue;
    const id = String(session.id || "");
    const after = String(session.workspacePath || "").trim();
    const before = lastChannelWorkspaceBySession.get(id);
    lastChannelWorkspaceBySession.set(id, after);
    // 首次见到且桌面端已有有效路径时也同步一次（兼容旧版本桌面已换、渠道未同步的数据）；
    // 首次为空字符串只建立基线，避免用渲染端旧空值误清渠道记录。
    if (before !== after && (before !== undefined || after)) {
      await channelManager.updateChatWorkspaceBySession(id, after);
    }
  }
}

ipcMain.handle("app:initial-state", async () => {
  const sessions = await readJson(dataFile("sessions.json"), defaultSessions());
  const workspacePath = sessions.find((session) => session.workspacePath)?.workspacePath || "";
  const pinnedWorkspacePaths = await readJson(dataFile("workspace-pins.json"), []);
  return {
    sessions,
    workspacePath,
    workspaceEntries: await listWorkspace(workspacePath),
    settings: await readSettings(),
    pinnedWorkspacePaths: Array.isArray(pinnedWorkspacePaths)
      ? pinnedWorkspacePaths.filter((item) => typeof item === "string" && item.trim())
      : [],
    platform: process.platform,
    windowShadow: currentWindowShadow,
    windowMaximized: mainWindow?.isMaximized() ?? false,
  };
});

ipcMain.handle("sessions:save", async (_event, sessions) => {
  try {
    const incoming = Array.isArray(sessions) ? sessions : [];
    await writeJson(dataFile("sessions.json"), incoming);
    // 电脑端给渠道会话（QQ/微信）更换工作区时，同步到渠道聊天记录；
    // 否则下一条 IM 消息仍按旧目录执行（渠道记录与桌面会话各自持有一份工作区）。
    // 用内存基线对比，避免每次保存都全量重读 sessions.json。
    await syncChannelSessionWorkspaces(incoming);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("workspace-pins:save", async (_event, paths) => {
  try {
    const normalized = Array.isArray(paths)
      ? [...new Set(paths.map((item) => String(item || "").trim()).filter(Boolean))]
      : [];
    await writeJson(dataFile("workspace-pins.json"), normalized);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("workspace:choose", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择工作文件夹",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const selectedPath = result.filePaths[0];
  return { canceled: false, path: selectedPath, entries: await listWorkspace(selectedPath) };
});

ipcMain.handle("attachments:choose", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "添加附件",
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true, attachments: [] };
  const attachments = [];
  for (const filePath of result.filePaths.slice(0, 12)) {
    try {
      attachments.push(await describeAttachment(filePath));
    } catch {
      // Ignore files that disappeared or cannot be read after the native picker closes.
    }
  }
  return { canceled: false, attachments };
});
ipcMain.handle("attachments:save-clipboard-image", async (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许读取剪贴板图片" };
  try {
    const saved = await saveClipboardImage(payload, path.join(app.getPath("userData"), "clipboard-images"));
    return { ok: true, attachment: await describeAttachment(saved.filePath) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("clipboard:read-text", (event) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return "";
  try {
    return clipboard.readText();
  } catch {
    return "";
  }
});

ipcMain.handle("clipboard:write-text", (event, text) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false };
  clipboard.writeText(String(text ?? ""));
  return { ok: true };
});

ipcMain.handle("workspace:refresh", (_event, workspacePath) => listWorkspace(String(workspacePath || "")));

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
  } catch (error) {
    // abort 触发的 DOMException 消息是英文 "This operation was aborted"，翻译成可读提示
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error("生成提交信息超时（3 分钟），模型响应过慢。请重试，或在设置中换用更快的模型");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

ipcMain.handle("workspace:context", (_event, workspacePath) => getWorkspaceContext(String(workspacePath || "")));
ipcMain.handle("git:branches", (_event, workspacePath) => listGitBranches(String(workspacePath || "")));
ipcMain.handle("git:diff-stats", (_event, workspacePath) => gitDiffStats(String(workspacePath || "")));
ipcMain.handle("git:checkout", (_event, payload) => gitCheckout(String(payload?.workspacePath || ""), String(payload?.branch || "")));
ipcMain.handle("git:create-branch", (_event, payload) => gitCreateBranch(String(payload?.workspacePath || ""), String(payload?.branch || "")));
ipcMain.handle("git:suggest-commit-message", async (_event, workspacePath) => {
  try {
    const message = await generateCommitMessage(String(workspacePath || ""));
    return { ok: true, message };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("git:commit", (_event, payload) => gitCommit(String(payload?.workspacePath || ""), {
  message: String(payload?.message || ""),
  includeUnstaged: payload?.includeUnstaged !== false,
}));
ipcMain.handle("git:push", (_event, workspacePath) => gitPush(String(workspacePath || "")));
ipcMain.handle("git:review-overview", (_event, payload) => gitReviewOverview(String(payload?.workspacePath || ""), String(payload?.base || "HEAD")));
ipcMain.handle("git:file-diff", (_event, payload) => gitFileDiff(
  String(payload?.workspacePath || ""),
  String(payload?.base || "HEAD"),
  String(payload?.path || ""),
  Boolean(payload?.untracked),
));
ipcMain.handle("git:stage", (_event, payload) => gitStage(String(payload?.workspacePath || ""), payload?.paths));
ipcMain.handle("git:discard", (_event, payload) => gitDiscard(String(payload?.workspacePath || ""), payload?.paths));

// ---- 浏览器数据导入（导入 Cookie 和密码，对照 Codex 浏览器更多菜单） ----

ipcMain.handle("browser-import:list", async (event) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return [];
  const browsers = await listImportableBrowsers();
  // keyNames 只用于主进程解密，不下发给渲染进程
  return browsers.map(({ keyNames, ...browser }) => browser);
});

ipcMain.handle("browser-import:import", async (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许导入浏览器数据" };
  try {
    const kinds = {
      cookies: payload?.kinds?.cookies !== false,
      passwords: payload?.kinds?.passwords !== false,
      history: payload?.kinds?.history !== false,
      localstorage: payload?.kinds?.localstorage !== false,
    };
    const result = await importBrowserData(
      { id: String(payload?.id || ""), userDataDir: String(payload?.userDataDir || "") },
      String(payload?.profileId || "Default"),
      kinds,
    );
    if (!result.ok) return result;
    // Cookie 写入右侧面板 webview 共用的持久分区
    const targetSession = session.fromPartition("persist:dyworker-browser");
    let cookieCount = 0;
    for (const cookie of result.cookies) {
      if (!cookie.host || !cookie.name) continue;
      try {
        const sameSite = cookie.sameSite === 0 ? "no_restriction" : cookie.sameSite === 1 ? "lax" : cookie.sameSite === 2 ? "strict" : "unspecified";
        // 会话级 Cookie（源浏览器里无有效期）写入持久分区后重启即被 Chromium 丢弃——
        // 登录态大多靠这种 Cookie，表现为“导入了但还是要登录”。
        // 导入时给一个 Chromium 上限（400 天）的有效期，让登录态跨重启保留。
        const expirationDate = cookie.expires > 0 ? cookie.expires : Math.floor(Date.now() / 1000) + 400 * 86400;
        await targetSession.cookies.set({
          url: `http${cookie.secure ? "s" : ""}://${cookie.host.replace(/^\./, "")}${cookie.path || "/"}`,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.host,
          path: cookie.path || "/",
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite,
          expirationDate,
        });
        cookieCount += 1;
      } catch {
        // 单条 Cookie 不合法（如域与 URL 不匹配）时跳过，不中断整体导入
      }
    }
    // 密码经 safeStorage 加密后存入 userData，供后续自动填充使用
    let passwordCount = 0;
    if (result.passwords.length) {
      const storePath = path.join(app.getPath("userData"), "imported-passwords.json");
      const existing = await readJson(storePath, []);
      const known = new Set(existing.map((item) => `${item.origin}\n${item.username}`));
      for (const item of result.passwords) {
        const key = `${item.origin}\n${item.username}`;
        if (known.has(key)) continue;
        known.add(key);
        existing.push({
          origin: item.origin,
          username: item.username,
          passwordEnc: safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(item.password).toString("base64") : "",
          passwordPlain: safeStorage.isEncryptionAvailable() ? undefined : item.password,
          source: result.browser,
          importedAt: new Date().toISOString(),
        });
        passwordCount += 1;
      }
      await writeJson(storePath, existing);
    }
    // 浏览记录存入 userData，供内置浏览器地址栏联想；按 URL 去重保留最近访问
    let historyCount = 0;
    if (result.history?.length) {
      const storePath = path.join(app.getPath("userData"), "imported-history.json");
      const existing = await readJson(storePath, []);
      const byUrl = new Map(existing.map((item) => [item.url, item]));
      for (const item of result.history) {
        const known = byUrl.get(item.url);
        if (known && Number(known.lastVisit || 0) >= Number(item.lastVisit || 0)) continue;
        byUrl.set(item.url, { url: item.url, title: item.title, visits: Math.max(Number(known?.visits || 0), item.visits), lastVisit: item.lastVisit });
        if (!known) historyCount += 1;
      }
      const merged = [...byUrl.values()].sort((a, b) => Number(b.lastVisit || 0) - Number(a.lastVisit || 0)).slice(0, 5000);
      await writeJson(storePath, merged);
    }
    // localStorage 暂存 userData：SPA 站点（如 kimi）的登录令牌在这里。
    // 渲染端在内置浏览器首次访问对应站点时取出注入，注入成功后清除（见 browser-import:localstorage-*）
    let localStorageOriginCount = 0;
    let localStorageKeyCount = 0;
    if (result.localStorage && typeof result.localStorage === "object") {
      const storePath = path.join(app.getPath("userData"), "imported-localstorage.json");
      const existing = await readJson(storePath, {});
      const store = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
      for (const [origin, entries] of Object.entries(result.localStorage)) {
        if (!/^https?:\/\//i.test(origin) || !entries || typeof entries !== "object") continue;
        const target = { ...(store[origin] || {}) };
        for (const [key, value] of Object.entries(entries)) {
          target[String(key)] = String(value);
          localStorageKeyCount += 1;
        }
        store[origin] = target;
        localStorageOriginCount += 1;
      }
      if (localStorageOriginCount) await writeJson(storePath, store);
    }
    return {
      ok: true,
      browser: result.browser,
      cookies: cookieCount,
      passwords: passwordCount,
      history: historyCount,
      localStorageOrigins: localStorageOriginCount,
      localStorageKeys: localStorageKeyCount,
      warnings: result.warnings,
      weakProtection: !safeStorage.isEncryptionAvailable() && passwordCount > 0,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// 已导入的浏览记录：地址栏联想用，不含敏感信息
ipcMain.handle("browser-import:history", async (event) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return [];
  const storePath = path.join(app.getPath("userData"), "imported-history.json");
  return readJson(storePath, []);
});

// 待注入的 localStorage：webview 首访对应站点时取出注入，成功后确认删除
ipcMain.handle("browser-import:localstorage-entries", async (event, origin) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return null;
  const storePath = path.join(app.getPath("userData"), "imported-localstorage.json");
  const store = await readJson(storePath, {});
  if (!store || typeof store !== "object" || Array.isArray(store)) return null;
  const entries = store[String(origin || "")];
  return entries && typeof entries === "object" ? entries : null;
});

ipcMain.handle("browser-import:localstorage-done", async (event, origin) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false };
  const storePath = path.join(app.getPath("userData"), "imported-localstorage.json");
  const store = await readJson(storePath, {});
  if (store && typeof store === "object" && !Array.isArray(store) && store[String(origin || "")]) {
    delete store[String(origin || "")];
    await writeJson(storePath, store);
  }
  return { ok: true };
});
ipcMain.handle("workspace:read-markdown", (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许读取工作目录文件" };
  return readWorkspaceMarkdown(String(payload?.workspacePath || ""), String(payload?.filePath || ""));
});
ipcMain.handle("workspace:read-file", (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许读取工作目录文件" };
  return readWorkspaceFile(String(payload?.workspacePath || ""), String(payload?.filePath || ""));
});
ipcMain.handle("workspace:write-file", (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许写入工作目录文件" };
  return writeWorkspaceFile(String(payload?.workspacePath || ""), String(payload?.filePath || ""), String(payload?.content ?? ""));
});
ipcMain.handle("workspace:open", async (_event, targetPath) => {
  const error = await shell.openPath(String(targetPath || ""));
  return error ? { ok: false, error } : { ok: true };
});
// 轨迹事件流（trace-console）：会话级 append-only jsonl，分页读取供轨迹视图回放
const safeTraceSessionId = (sessionId) => String(sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "") || "session";
ipcMain.handle("traces:list", async (_event, sessionId) => {
  const file = path.join(app.getPath("userData"), "traces", `${safeTraceSessionId(sessionId)}.jsonl`);
  try {
    const stat = await fs.stat(file);
    const content = await fs.readFile(file, "utf8");
    return { ok: true, count: content.split("\n").filter(Boolean).length, size: stat.size, updatedAt: stat.mtime.toISOString() };
  } catch {
    return { ok: true, count: 0, size: 0, updatedAt: "" };
  }
});
ipcMain.handle("traces:read", async (_event, payload) => {
  const file = path.join(app.getPath("userData"), "traces", `${safeTraceSessionId(payload?.sessionId)}.jsonl`);
  const offset = Math.max(0, Number(payload?.offset) || 0);
  const limit = Math.min(Math.max(1, Number(payload?.limit) || 500), 2000);
  try {
    const content = await fs.readFile(file, "utf8");
    const lines = content.split("\n").filter(Boolean);
    const records = lines.slice(offset, offset + limit)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
    return { ok: true, records, total: lines.length, offset };
  } catch {
    return { ok: true, records: [], total: 0, offset };
  }
});
ipcMain.handle("browser:open", async (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "浏览器请求来源无效" };
  const check = isSafePublicUrl(String(payload?.url || ""));
  if (!check.ok) return { ok: false, result: check.error };
  return { ok: true, url: check.url.toString(), result: "已在当前浏览器标签页打开网页" };
});
ipcMain.handle("settings:save", async (_event, settings) => {
  try {
    const updateUrl = await saveSettings(settings);
    sleepBlockMode = normalizePreventSleep(settings?.preventSleep);
    updateSleepBlocker();
    applyReviewerModelDir(settings);
    applyAsrSettings(settings);
    applyTtsSettings(settings);
    // 渠道配置热生效:按新设置 diff 启停 QQ/微信连接
    await reconcileChannels();
    return { ok: true, updateUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// 凭证预检（auth check）：设置页保存 API Key 后立即验证可用性，避免运行任务时才发现配错。
// 发一个最小 chat 请求：200 = 通过；401/403 = 密钥无效；404 = 地址或模型名不对；其余按状态码归类。
ipcMain.handle("settings:probe-credentials", async (_event, payload) => {
  const endpoint = String(payload?.endpoint || "").trim();
  const model = String(payload?.model || "").trim();
  const apiKey = String(payload?.apiKey || "").trim();
  if (!endpoint || !model) return { ok: false, error: "请先填写服务地址和模型名称" };
  // 模型名可能带 [1M]/[256K] 上下文后缀，请求前剥离
  const bareModel = bareModelName(model);
  // DeepSeek 官方根地址自动补全为 /responses；Responses API 与 Chat Completions 请求体不同
  const target = normalizeModelEndpoint(endpoint);
  const responsesApi = isResponsesEndpoint(target);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const startedAt = Date.now();
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 本地推理服务（vLLM/Ollama/LM Studio）常无需 Key，空 Key 时不带 Authorization 头
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(responsesApi
        ? { model: bareModel, input: [{ role: "user", content: "ping" }], max_output_tokens: 1 }
        : { model: bareModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
      signal: controller.signal,
    });
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
    const latencyMs = Date.now() - startedAt;
    if (response.ok) return { ok: true, status: response.status, latencyMs, message: `验证通过：服务可达，密钥与模型可用（${latencyMs} ms）` };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, latencyMs, error: `密钥被拒绝（HTTP ${response.status}）：${detail || "请检查 API Key 是否正确、是否过期或权限不足"}` };
    }
    if (response.status === 404) {
      return { ok: false, status: response.status, latencyMs, error: `地址或模型不存在（HTTP 404）：${detail || "请检查服务地址和模型名称是否填写正确"}` };
    }
    if (response.status === 429) {
      return { ok: false, status: response.status, latencyMs, error: `密钥有效但被限流或额度不足（HTTP 429）：${detail || "请稍后重试或检查账户额度"}` };
    }
    return { ok: false, status: response.status, latencyMs, error: `请求被拒绝（HTTP ${response.status}）：${detail || "服务可达，但请求未被接受"}` };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return { ok: false, error: aborted ? "验证超时（20 秒无响应），服务地址可能不可达" : `无法连接服务地址：${error?.message || error}` };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle("chat:complete", async (_event, payload) => {
  const settings = payload?.settings || {};
  if (!settings.endpoint || !settings.model || !settings.apiKey) {
    return {
      demo: true,
      content:
        "模型还没有配置。打开左下角的“设置”，填写服务地址、模型名称和密钥后，就可以在这里直接处理任务。",
    };
  }
  const messages = await Promise.all((payload.messages || [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map(async (message) => ({ role: message.role, content: await providerMessageContent(message) })));
  const result = await requestModel({ settings, messages, fetchImpl: fetch, tools: false });
  const content = result?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("模型没有返回可显示的内容");
  return { content };
});

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
  } catch (error) {
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

ipcMain.handle("voice:transcribe", async (_event, payload) => {
  const payloadSettings = payload?.settings || {};
  // 引擎选择与本地模型路径以磁盘最新设置为准（改路径保存后立即生效）；
  // 云引擎沿用渲染端传来的地址与密钥
  const saved = await readSettings();
  const settings = {
    ...payloadSettings,
    transcriptionEngine: saved.transcriptionEngine,
    asrModel: saved.asrModel,
    asrModelDir: saved.asrModelDir,
    llamaServerPath: saved.llamaServerPath,
  };
  const audio = Uint8Array.from(Array.isArray(payload?.audio) ? payload.audio : []);
  const mimeType = String(payload?.mimeType || "audio/webm");
  return transcribeAudio(audio, mimeType, settings);
});

// ---- 本地代理 ----

const activeAgents = new Map();
const sessionQueue = new SessionQueue();
let mcpShuttingDown = false;

async function readSavedMemories() {
  const items = await readJson(dataFile("memory.json"), []);
  return normalizeMemories(items);
}

// ---- 个人记忆知识库（LLM Wiki）----

function wikiRoot() {
  return path.join(app.getPath("userData"), "memory-wiki");
}

let memoryWikiReadyPromise = null;
function memoryWikiReady() {
  // 首次运行时把旧的扁平记忆列表一次性迁移成 wiki 页面，并备份原 memory.json；
  // 之后 memory.json 只作为待整合队列（raw sources），wiki 是唯一知识库。
  memoryWikiReadyPromise ??= (async () => {
    const root = wikiRoot();
    const items = await readSavedMemories();
    // 会话记忆不迁移进 wiki，留在队列文件里按会话注入
    const migratable = items.filter((item) => item.scope !== "session");
    await ensureWiki(root, { items: migratable });
    if (migratable.length) {
      const backup = dataFile("memory.json.pre-wiki-backup");
      if (!existsSync(backup)) await fs.copyFile(dataFile("memory.json"), backup).catch(() => { });
      await writeJson(dataFile("memory.json"), items.filter((item) => item.scope === "session"));
    }
  })();
  return memoryWikiReadyPromise;
}

async function readMemoryPages(sessionId = "") {
  await memoryWikiReady();
  const pages = await readWikiPages(wikiRoot());
  // 内置模型认知以只读伪页面参与选取：不落盘、不会出现在整合输入里，模型无法改写。
  const builtinRows = builtinMemories.map((item) => ({ id: item.id, kind: item.kind, category: item.category, content: item.content }));
  const builtinPage = {
    relPath: "pages/builtin.md",
    title: "内置模型认知",
    scope: "global",
    workspacePath: "",
    rows: builtinRows,
    content: `# 内置模型认知\n\n${builtinRows.map((row) => `- ${row.content} <!--mem:${row.id}|${row.kind}|${row.category}-->`).join("\n")}`,
  };
  // 会话记忆：绑定当前任务会话的临时约定，以只读伪页面注入（不进全局 wiki）
  const sessionPage = await readSessionMemoryPage(sessionId);
  return [...pages, builtinPage, ...(sessionPage ? [sessionPage] : [])];
}

// 读取绑定某个任务会话的记忆，聚成一个伪页面；没有会话记忆时返回 null
async function readSessionMemoryPage(sessionId) {
  const target = String(sessionId || "").trim();
  if (!target) return null;
  const items = (await readSavedMemories()).filter((item) => item.scope === "session" && item.sessionId === target);
  if (!items.length) return null;
  const rows = items.map((item) => ({ id: item.id, kind: item.kind, category: item.category, name: item.name, content: item.content }));
  return {
    relPath: "pages/session.md",
    title: "本会话记忆",
    scope: "global",
    workspacePath: "",
    rows,
    content: `# 本会话记忆\n\n${rows.map(serializeMemoryRow).join("\n")}`,
  };
}

let wikiConsolidationTimer = null;
let wikiConsolidationRunning = false;
function scheduleWikiConsolidation(delayMs = 3000) {
  if (wikiConsolidationTimer) clearTimeout(wikiConsolidationTimer);
  wikiConsolidationTimer = setTimeout(() => {
    wikiConsolidationTimer = null;
    void runWikiConsolidation().catch((error) => console.log(`[memory-wiki] 整合失败：${error?.message || error}`));
  }, delayMs);
}

// 任务结束后批量把 memory.json 队列整合进 wiki：优先让当前模型做一次
// 「合并 / 去重 / 修订矛盾」的页面维护；模型不可用或输出无效时回退规则式追加。
async function runWikiConsolidation({ lint = false } = {}) {
  if (wikiConsolidationRunning) {
    scheduleWikiConsolidation(8000);
    return { ok: false, error: "整合进行中，稍后自动重试" };
  }
  wikiConsolidationRunning = true;
  try {
    await memoryWikiReady();
    const root = wikiRoot();
    const all = await readSavedMemories();
    // 会话记忆只绑定单个任务会话，不参与 wiki 整合；清队时原样保留
    const sessionItems = all.filter((item) => item.scope === "session");
    const pending = all.filter((item) => item.scope !== "session");
    if (!lint && !pending.length) return { ok: true };
    const pages = await readWikiPages(root);
    const settings = await readSettings();
    let applied = 0;
    if (settings.endpoint && settings.model && settings.apiKey) {
      try {
        const message = await requestModel({ settings, messages: buildConsolidationMessages({ pages, pending, lint }), tools: false });
        applied = await applyConsolidation(root, parseConsolidationResult(message?.content || ""));
      } catch (error) {
        console.log(`[memory-wiki] LLM 整合失败，回退规则式：${error?.message || error}`);
      }
    }
    if (applied) {
      // 模型漏掉的新记忆保留在队列里等下一轮，其余清空；会话记忆始终保留。
      const knownIds = new Set((await readWikiPages(root)).flatMap((page) => page.rows.map((row) => row.id)));
      const missed = pending.filter((item) => !knownIds.has(String(item?.id || "")));
      await writeJson(dataFile("memory.json"), [...sessionItems, ...missed]);
      return { ok: true, applied };
    }
    if (pending.length) {
      await integrateItems(root, pending, { logTitle: "规则式整合" });
      await writeJson(dataFile("memory.json"), sessionItems);
      return { ok: true, applied: 0 };
    }
    return { ok: false, error: lint ? "整理未产生有效结果" : "整合未产生有效结果" };
  } finally {
    wikiConsolidationRunning = false;
  }
}

async function appendMemory(item, workspacePath, sessionId = "") {
  const items = await readSavedMemories();
  const record = buildMemoryRecord(item, {
    id: crypto.randomUUID(),
    workspacePath,
    sessionId,
  });
  if (!record?.content) return null;
  const duplicate = items.find((existing) => (
    existing.content === record.content
    && existing.category === record.category
    && existing.kind === record.kind
    && existing.scope === record.scope
    && existing.workspacePath === record.workspacePath
    && existing.sessionId === record.sessionId
  ));
  if (duplicate) return duplicate;
  items.push(record);
  await writeJson(dataFile("memory.json"), items);
  // 新记忆已入队，任务收尾后由 wiki 整合流程合并进页面。
  scheduleWikiConsolidation();
  return record;
}

function memoriesFromAgentResult(result) {
  if (Array.isArray(result?.memories)) return result.memories;
  return result?.memory ? [result.memory] : [];
}

// ---- 工作模板 ----

const builtInSkills = [
  {
    id: "builtin-official-draft",
    name: "公文起草",
    description: "起草通知、请示、报告、函等党政机关公文",
    instructions: "1. 先确认文种（通知/请示/报告/函）、主送单位和行文依据；2. 结构：标题（发文机关+事由+文种）→ 主送单位 → 正文（依据目的—具体事项—执行要求）→ 落款和日期；3. 用语庄重准确，请示一文一事，报告不得夹带请示事项；4. 涉及政策依据时用政府官网搜索核实文号和条款并注明来源；5. 完成后通读检查格式、称谓和落款。",
  },
  {
    id: "builtin-meeting-minutes",
    name: "会议纪要",
    description: "把会议记录整理成规范纪要",
    instructions: "1. 从记录中提取：时间地点、主持人、出席人员、议题；2. 按“会议认为/会议指出/会议议定”组织正文；3. 议定事项逐条列出，明确责任单位和完成时限；4. 语言客观，不添加记录中没有的内容；5. 末尾列出任务分工表。",
  },
  {
    id: "builtin-policy-brief",
    name: "政策解读",
    description: "解读政策法规文件并核对权威来源",
    instructions: "1. 先在政府官网找到政策原文并打开核对；2. 提炼：适用范围、核心条款、办理流程、时限、新旧变化；3. 结合本单位实际说明影响和要做的事；4. 所有文号、数字、期限必须与原文一致并附来源网址；5. 不确定的地方明确标注，不得推测。",
  },
  {
    id: "builtin-materials-summary",
    name: "材料汇总",
    description: "从工作区多份材料中提取要点并汇总成稿",
    instructions: "1. 列出工作区文件，识别与主题相关的材料；2. 逐份读取并记录关键事实、数据、结论；3. 合并同类内容并标注出处；4. 按用户要求的体裁成稿；5. 数据有出入时并列说明，不擅自取舍。",
  },
  {
    id: "builtin-mail-register",
    name: "收发文登记",
    description: "登记来文来件并维护收发文台账",
    instructions: "1. 台账固定为工作区根目录的 收发文台账.csv（没有则创建，表头：序号,日期,来文单位,文号,标题,承办人,办理状态,备注）；2. 每收到一份文件，读取文件提取来文单位、文号、标题和日期，追加一行，序号顺延；3. 文号保留原文〔〕格式，日期统一 YYYY-MM-DD；4. 办理状态默认“待办”，用户说明进展时更新对应行；5. 用户需要时汇总未办结事项清单。",
  },
  {
    id: "builtin-info-brief",
    name: "信息简报",
    description: "把工作动态、经验做法整理成政务信息简报",
    instructions: "1. 结构：报头（单位、期号、日期）→ 标题（一句话点明主题）→ 导语（时间、地点、事项）→ 正文（措施、成效、数据，条目化）→ 结尾（下一步打算）；2. 一事一报，控制在一页以内；3. 数据必须来自工作区材料并注明出处；4. 语言客观简练，不用修饰性空话；5. 交付前先扫描敏感信息，涉及个人信息的提醒脱敏。",
  },
  {
    id: "builtin-leader-summary",
    name: "领导摘要",
    description: "把长篇材料压缩成一页纸决策摘要",
    instructions: "1. 通读材料后先写“核心结论”（不超过 3 条，每条一句话）；2. 再列“关键数据与事实”（注明来源文件）；3. 然后列“风险与问题”；4. 最后写“建议事项”（需要领导决定或批示的）；5. 全篇约 500 字、不超过一页，不用套话。",
  },
  {
    id: "builtin-deep-research",
    name: "深度调研",
    description: "围绕一个主题（市场、公司、行业、政策）做多角度检索和交叉验证，产出带来源的调研报告",
    instructions: "1. 先用 update_plan 把调研主题拆成 3-6 个子问题（如：基本情况、经营与财务、行业地位、政策环境、风险与争议）；相互独立的子问题可用 dispatch_agent 并行派发子代理调研（任务描述要完整自足），有依赖关系的自己按顺序做；2. 每个子问题至少用 2 组不同关键词检索，避免单一角度；3. 优先精读一手来源：公司官网、公告年报、政府部门和监管机构发布、权威媒体；用 fetch_web_page 打开原文，不只依赖搜索摘要；4. 关键事实必须有两个独立来源相互印证，数字注明口径和日期；5. 每完成一个子问题更新计划；发现信息缺口就补检索，至少完成一轮“检索—精读—验证”后再考虑收尾；6. 公司工商信息以国家企业信用信息公示系统或官方公告为准，第三方平台（天眼查、企查查等）数据要标注来源属性；7. 产出结构化调研报告：概述 → 分子问题分析 → 关键数据与事实（逐条带出处网址和日期）→ 矛盾与不确定项（明确标注，不猜测）→ 风险与关注建议 → 来源清单；报告写入工作区，用户需要正式文档时再用 export_word_document 导出。",
  },
];

async function readDismissedBuiltins() {
  const items = await readJson(dataFile("skills-dismissed.json"), []);
  return Array.isArray(items) ? items : [];
}

async function readStoredSkills() {
  const file = dataFile("skills.json");
  const items = await readJson(file, []);
  const list = Array.isArray(items) ? items : [];
  // 合并新增的内置模板（老用户升级也能获得）；用户删除过的内置模板不复活
  const dismissed = new Set(await readDismissedBuiltins());
  const present = new Set(list.map((item) => String(item?.name || "")));
  const missing = builtInSkills.filter((skill) => !present.has(skill.name) && !dismissed.has(skill.name));
  if (!missing.length) return list;
  const merged = [
    ...list,
    ...missing.map((skill) => ({ ...skill, enabled: true, builtIn: true, createdAt: new Date().toISOString() })),
  ];
  await writeJson(file, merged);
  return merged;
}

async function readSkillOverrides() {
  const stored = await readJson(dataFile("skill-overrides.json"), {});
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

async function readSkills(workspacePath = "") {
  const [storedSkills, fileSkills, overrides] = await Promise.all([
    readStoredSkills(),
    discoverFileSkills({ homeDir: app.getPath("home"), workspacePath }),
    readSkillOverrides(),
  ]);
  return mergeSkillRecords(storedSkills, fileSkills, overrides);
}

async function writeSkills(items) {
  await writeJson(dataFile("skills.json"), items);
}

async function appendSkill(item) {
  const skills = await readStoredSkills();
  skills.push({
    id: crypto.randomUUID(),
    name: String(item.name || ""),
    description: String(item.description || ""),
    instructions: String(item.instructions || ""),
    enabled: true,
    createdAt: new Date().toISOString(),
  });
  await writeSkills(skills);
}

// 技能自我改进（借鉴 Hermes Agent 的学习闭环）：按 id 更新已有模板的说明与执行要求
async function updateSkill(item) {
  const skills = await readStoredSkills();
  const index = skills.findIndex((skill) => String(skill.id) === String(item.id));
  if (index < 0) return;
  skills[index] = {
    ...skills[index],
    description: String(item.description || skills[index].description || ""),
    instructions: String(item.instructions || skills[index].instructions || ""),
  };
  await writeSkills(skills);
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

async function readUsageStats() {
  const items = await readJson(dataFile("usage-stats.json"), []);
  return Array.isArray(items) ? items : [];
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
  await writeJson(dataFile("usage-stats.json"), items.slice(-USAGE_STATS_LIMIT));
}

// ---- 跨会话历史搜索 ----

function historyMessageText(message) {
  return String(message?.content || "");
}

async function searchHistory(query, limit = 10, offset = 0) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return "请提供要查找的关键词";
  const sessions = await readJson(dataFile("sessions.json"), []);
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
  const sessions = await readJson(dataFile("sessions.json"), []);
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
    } catch (error) {
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

async function callMcpTool(settings, fullName, args, { signal } = {}) {
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
    } catch (error) {
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

function createExtraToolRouter(settings, workspacePath, { signal, renderer } = {}) {
  const browserAgent = new BrowserAgent({
    openPanel: renderer ? (url) => waitForEmbeddedBrowser(renderer, url) : undefined,
    closePanel: renderer ? () => requestCloseEmbeddedBrowser(renderer) : undefined,
    getContents: () => embeddedBrowserContents,
  });
  browserAgent.setWorkspace(workspacePath);
  const route = async (name, args) => {
    // 会话检索工具优先：只读查 sessions.json，不走浏览器/MCP
    if (SESSION_TOOL_NAMES.has(String(name))) {
      const sessions = await readJson(dataFile("sessions.json"), []);
      return handleSessionTool(name, args, { sessions });
    }
    if (name.startsWith("browser__")) return browserAgent.handle(name, args);
    return callMcpTool(settings, name, args, { signal });
  };
  route.dispose = () => browserAgent.dispose();
  return route;
}

function emitToSession(sender, sessionId, runId, agentEvent) {
  if (!sender || sender.isDestroyed()) return;
  sender.send("agent:event", { sessionId, runId, event: agentEvent });
}

// 执行排队消息时，从会话存档取该条消息的最新内容（用户可能已编辑），
// 并截断到本条用户消息为止，避免把后面仍在排队的消息提前带进本轮对话。
async function queuedPayloadFromSession({ sessionId, runId, payload }) {
  const freshPayload = { ...(payload || {}) };
  try {
    const stored = await readJson(dataFile("sessions.json"), []);
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
  const emit = (agentEvent) => {
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
  let routeExtraTool = null;
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

    const loop = payload?.loop?.enabled
      ? { enabled: true, iteration: 1, maximum: Math.min(Math.max(Number(payload.loop.maximum) || 5, 1), 20) }
      : { enabled: false, iteration: 1, maximum: 1 };
    const memoryPages = await readMemoryPages(sessionId);
    const skills = await readSkills(workspacePath);
    // 每个任务结束前都做一次轻量判断；没有稳定价值的信息时不会保存。
    // 这样也覆盖同一会话切换话题的边界，不再依赖“每三轮”这种偶然触发。
    const memoryReviewDue = true;
    // 附件（图片/文本）展开为模型可读的多模态内容，与 chat:complete 同一套逻辑
    const agentConversation = await Promise.all(conversation.map(async (message) => ({
      role: message?.role,
      content: await providerMessageContent(message),
    })));
    const approvalMode = normalizeApprovalMode(payload?.approvalMode);
    // 服务器自报的实际上限（vLLM 等在 /models 里带 max_model_len）：本地/自建模型常远小于
    // 渲染端静态表的 128k 默认值，按默认值累积上下文会把超限请求发出去，甚至打垮引擎。
    // 探测失败（端点不支持/网络异常）返回 null，回退为渲染端报上来的值。
    const serverContextLimit = await probeServerContextLimit(settings);
    if (serverContextLimit) {
      console.log(`[agent] 服务器自报上下文上限 ${serverContextLimit}（${settings.model} @ ${settings.endpoint}），按此钳制`);
    }
    const extraTools = agentExtraTools(await mcpExtraTools(settings));
    routeExtraTool = createExtraToolRouter(settings, workspacePath, { signal: abortController.signal, renderer: sender });
    if (agentState.cancelled) return cancelledResponse();
    let iterationMessages = agentConversation;
    let finalResult = null;
    while (true) {
      emit({ type: "loop-state", active: loop.enabled, iteration: loop.iteration, maximum: loop.maximum, status: "正在执行" });
      const result = await runAgent({
        settings,
        workspacePath,
        contextLimit: (() => {
          // 渲染端按模型静态表或 k3[1M] 式显式覆盖报上来的值，不再设 30000 下限——
          // 显式写小上下文（如 model[16K]）是用户意图，需原样尊重；未上报时回退 128k。
          const requested = Number(payload?.contextLimit) || 128000;
          return serverContextLimit ? Math.max(8000, Math.min(requested, serverContextLimit)) : requested;
        })(),
        workingContext: String(payload?.workingContext || ""),
        hooks: await readHooks(workspacePath),
        goal: String(payload?.goal || "").trim().slice(0, 500),
        conversation: iterationMessages,
        memoryPages,
        skills,
        history: { search: searchHistory, readContext: readHistoryContext },
        loop,
        memoryReviewDue,
        approvalMode,
        standingRules: await readStandingRules(),
        audit: (entry) => auditLog.record({ ...entry, sessionId, approvalMode }),
        extraTools,
        onExtraTool: routeExtraTool,
        emit: (agentEvent) => {
          if (agentEvent?.type === "skill-saved") void appendSkill(agentEvent.item);
          if (agentEvent?.type === "skill-updated") void updateSkill(agentEvent.item);
          if (agentEvent?.type === "token-usage") void appendUsageStat(agentEvent);
          emit(agentEvent);
        },
        isCancelled: () => agentState.cancelled || mcpShuttingDown,
        signal: abortController.signal,
        sleepGuard: () => hasPendingWakeForSession(sessionId),
        sessionId,
        startBackgroundTask: (p) => backgroundTasksManager.startTask({ ...p, sessionId: p.sessionId || sessionId }),
        requestApproval: (action) => new Promise((resolve) => {
          agentState.pending.set(action.id, resolve);
          emit({ type: "approval-request", action });
        }),
        requestUserInput: (request) => new Promise((resolve) => {
          agentState.pending.set(`q:${request.id}`, resolve);
          emit({ type: "ask-user", request });
        }),
      });
      for (const memory of memoriesFromAgentResult(result)) {
        if (agentState.cancelled) break;
        await appendMemory(memory, workspacePath, sessionId);
      }
      finalResult = result;
      if (agentState.cancelled) {
        await cancelWakesForSession(sessionId);
        finalResult = { status: "cancelled", finalText: result.finalText || "" };
        break;
      }
      // 主动挂起（self-wake）：登记唤醒记录,到点由调度 tick 续跑,不再进入下一轮
      if (result.status === "sleeping" && result.wake) {
        await registerWake({
          sessionId,
          workspacePath,
          approvalMode,
          wake: result.wake,
          prompt: latestUserText,
          finalText: result.finalText,
        });
        if (agentState.cancelled) {
          await cancelWakesForSession(sessionId);
          finalResult = { status: "cancelled", finalText: result.finalText || "" };
        }
        break;
      }
      const shouldContinue = loop.enabled
        && result.status === "done"
        && !result.finish
        && loop.iteration < loop.maximum;
      if (!shouldContinue) break;
      loop.iteration += 1;
      iterationMessages = [
        ...iterationMessages,
        { role: "assistant", content: result.finalText || "" },
        { role: "user", content: "请继续推进任务：实际检查结果，完成剩余工作，全部满足验收条件后再交付。" },
      ];
    }
    if (finalResult?.status === "done" && Array.isArray(finalResult.plan) && finalResult.plan.length) {
      const completedPlan = finalResult.plan.map((step) => ({ ...step, status: "completed" }));
      finalResult = { ...finalResult, plan: completedPlan };
      emit({ type: "plan-update", steps: completedPlan });
    }
    emit({ type: "loop-state", active: false, iteration: loop.iteration, maximum: loop.maximum, status: finalResult.status === "done" ? "已完成" : "已停止" });
    emit({ type: "agent-finished", result: finalResult });
    return { ok: true, result: finalResult };
  } catch (agentError) {
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
        } catch {
          // 落盘失败不影响任务与界面，轨迹视图会降级为内存事件
        }
      })();
    }
    routeExtraTool?.dispose();
    trackTaskEnd();
    if (activeAgents.get(sessionId) === agentState) {
      activeAgents.delete(sessionId);
      drainSessionQueue(sessionId);
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

ipcMain.handle("agent:send", async (event, payload) => {
  if (mcpShuttingDown) return { status: "cancelled", reason: "应用正在退出" };
  const sessionId = String(payload?.sessionId || "").trim();
  const runId = String(payload?.runId || "").trim();
  if (!sessionId || !runId) return { ok: false, error: "任务标识无效，请新建任务后重试" };
  if (activeAgents.has(sessionId)) {
    const count = sessionQueue.push({ sessionId, runId, payload, sender: event.sender });
    emitToSession(event.sender, sessionId, runId, { type: "queued", count });
    return { ok: true, queued: true, runId };
  }
  return executeAgentRun({ payload, sender: event.sender });
});

ipcMain.handle("agent:remove-queued", (_event, payload) => {
  const sessionId = String(payload?.sessionId || "").trim();
  const runId = String(payload?.runId || "").trim();
  const removed = sessionQueue.remove(sessionId, runId);
  return { ok: true, removed };
});

// “立即执行”排队消息：提到队首并取消当前任务，
// 当前任务收尾时 drainSessionQueue 会自动从队首启动它，
// 复用既有出队链路（queue-start 事件、从存档取最新内容等）保持一致行为
ipcMain.handle("agent:run-queued-now", async (_event, payload) => {
  const sessionId = String(payload?.sessionId || "").trim();
  const runId = String(payload?.runId || "").trim();
  if (!sessionId || !runId) return { ok: false, error: "任务标识无效" };
  if (!sessionQueue.promote(sessionId, runId)) return { ok: false, error: "这条消息已不在队列中" };
  const agentState = activeAgents.get(sessionId);
  if (!agentState) {
    // 当前任务恰好已结束，队列不会自动推进，这里直接启动队首
    drainSessionQueue(sessionId);
    return { ok: true };
  }
  agentState.cancelled = true;
  agentState.abortController.abort();
  for (const resolve of agentState.pending.values()) resolve(false);
  agentState.pending.clear();
  await cancelWakesForSession(sessionId);
  return { ok: true };
});

ipcMain.handle("agent:resolve-approval", (_event, payload) => {
  const agentState = activeAgents.get(String(payload?.sessionId || ""));
  const resolve = agentState?.pending.get(String(payload?.actionId || ""));
  if (!resolve) return { ok: false };
  agentState.pending.delete(String(payload?.actionId || ""));
  resolve(Boolean(payload?.approved));
  return { ok: true };
});

ipcMain.handle("agent:resolve-question", (_event, payload) => {
  const agentState = activeAgents.get(String(payload?.sessionId || ""));
  const key = `q:${String(payload?.requestId || "")}`;
  const resolve = agentState?.pending.get(key);
  if (!resolve) return { ok: false };
  agentState.pending.delete(key);
  resolve({ ok: true, answer: String(payload?.answer || "") });
  return { ok: true };
});

ipcMain.handle("agent:cancel", async (_event, payload) => {
  const sessionId = String(payload?.sessionId || "");
  const runId = String(payload?.runId || "");
  if (!sessionId || !runId) return { ok: false };
  const agentState = activeAgents.get(sessionId);
  if (!agentState) return { ok: false };
  if (agentState.runId !== runId) return { ok: false };
  agentState.cancelled = true;
  agentState.abortController.abort();
  for (const resolve of agentState.pending.values()) resolve(false);
  agentState.pending.clear();
  // 任务被取消时,它登记的待唤醒一并取消
  await cancelWakesForSession(sessionId);
  return { ok: true };
});

ipcMain.handle("background-tasks:list", (_event, sessionId) => backgroundTasksManager.listTasks(sessionId));
ipcMain.handle("background-tasks:start", (_event, payload) => backgroundTasksManager.startTask(payload));
ipcMain.handle("background-tasks:stop", async (_event, taskId) => ({ ok: await backgroundTasksManager.stopTask(taskId) }));
ipcMain.handle("background-tasks:restart", async (_event, taskId) => backgroundTasksManager.restartTask(taskId));
ipcMain.handle("background-tasks:get-logs", (_event, taskId) => backgroundTasksManager.getTaskLogs(taskId));

ipcMain.handle("memories:list", async () => {
  await memoryWikiReady();
  // 空的核心页面不展示，避免面板出现一堆零条记忆的卡片
  const pages = (await listWikiPages(wikiRoot())).filter((page) => page.rows.length);
  // 会话记忆单独成卡展示（带所属会话标识），与全局 wiki 页面并列
  const sessionItems = (await readSavedMemories()).filter((item) => item.scope === "session");
  if (sessionItems.length) {
    const rows = sessionItems.map((item) => ({ id: item.id, kind: item.kind, category: item.category, name: item.name, content: item.content, sessionId: item.sessionId }));
    pages.push({
      relPath: "pages/session.md",
      title: "会话记忆",
      scope: "global",
      workspacePath: "",
      rows,
      content: `# 会话记忆\n\n${rows.map(serializeMemoryRow).join("\n")}`,
      updated: "",
    });
  }
  return pages;
});

ipcMain.handle("usage:list", () => readUsageStats());

ipcMain.handle("hooks:list", async () => {
  const userPath = dataFile("hooks.json");
  const userRules = await readJson(userPath, []);
  return {
    builtin: builtinHooks,
    user: Array.isArray(userRules) ? userRules : [],
    userPath,
  };
});

ipcMain.handle("hooks:open-user", async () => {
  const userPath = dataFile("hooks.json");
  if (!existsSync(userPath)) await writeJson(userPath, []);
  return shell.openPath(userPath);
});

// ---- 常驻允许规则（审批卡片上的「始终允许」，借鉴 openworker standing rules）----
// 只覆盖可安全规则化的工具：工作区内按扩展名的文件写入、按域名的网页访问、按名称的外部 MCP 工具；
// 运行命令支持受信只读命令与常用开发命令（npm/python3/git 提交等）按 argv 前缀规则化，
// 系统级破坏性命令（rm/sudo/dd 等）、本机界面操作、浏览器变更操作永远逐次确认。

async function readStandingRules() {
  const rules = await readJson(dataFile("standing-rules.json"), []);
  return Array.isArray(rules) ? rules : [];
}

ipcMain.handle("rules:list", () => readStandingRules());

ipcMain.handle("rules:add", async (_event, payload) => {
  const kind = String(payload?.kind || "");
  const tool = String(payload?.tool || "");
  const pattern = String(payload?.pattern || "").trim();
  const label = String(payload?.label || "").trim().slice(0, 120);
  if (!["path-glob", "domain", "mcp-tool", "command-prefix"].includes(kind)) return { ok: false, error: "规则类型无效" };
  if (!tool || !pattern) return { ok: false, error: "规则内容不完整" };
  // 用 agent 侧同一套判定确保规则确实能生效（不可规则化时 suggest 返回 null）
  const probeArgs =
    kind === "path-glob" ? { path: pattern }
    : kind === "domain" ? { url: `https://${pattern}/` }
    : kind === "command-prefix" ? { command: pattern }
    : {};
  const probeTool = kind === "mcp-tool" ? pattern : tool;
  if (!suggestStandingRule(probeTool, probeArgs)) return { ok: false, error: "这类操作不支持始终允许，需要逐次确认" };
  const rules = await readStandingRules();
  if (rules.some((rule) => rule.kind === kind && rule.tool === tool && rule.pattern === pattern)) {
    return { ok: true, duplicated: true };
  }
  rules.push({ id: crypto.randomUUID(), kind, tool, pattern, label: label || pattern, createdAt: new Date().toISOString() });
  await writeJson(dataFile("standing-rules.json"), rules);
  return { ok: true };
});

ipcMain.handle("rules:delete", async (_event, id) => {
  const rules = await readStandingRules();
  await writeJson(dataFile("standing-rules.json"), rules.filter((rule) => String(rule.id) !== String(id)));
  return { ok: true };
});

ipcMain.handle("audit:open", async () => {
  const auditPath = dataFile("audit.jsonl");
  if (!existsSync(auditPath)) await fs.writeFile(auditPath, "", "utf8");
  return shell.openPath(auditPath);
});

// ---- 审批收件箱（借鉴 openworker inbox：无人值守任务的审批/提问进收件箱，任务挂起等待处理）----
// 条目：{ id, sessionId, scheduleId?, kind: "approval" | "question", tool?, title?, details?,
//        question?, options?, createdAt, status: "pending" | "resolved" | "expired", resolution? }
// 挂起语义：runAgent 的审批/提问 promise 挂在本模块的 inboxPending 里，用户处理后原地恢复；
// 应用退出时统一以拒绝解决并把残留条目标记为已失效（重启后可见，不会静默丢失）。

const inboxPending = new Map(); // itemId → resolve({ ok, approved?, answer?, reason? })

async function readInbox() {
  const items = await readJson(dataFile("inbox.json"), []);
  return Array.isArray(items) ? items : [];
}

async function writeInbox(items) {
  // 已处理/已失效条目只保留最近 100 条，pending 永不丢弃
  const pending = items.filter((item) => item.status === "pending");
  const settled = items.filter((item) => item.status !== "pending").slice(-100);
  await writeJson(dataFile("inbox.json"), [...pending, ...settled]);
}

function broadcastInboxChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("inbox:changed");
}

// 落盘串行化,避免并发创建时 read-modify-write 互相覆盖
let inboxPersistQueue = Promise.resolve();

// 创建挂起条目并返回决议 promise(promise 上带 itemId,渠道审批需要按 id 路由 IM 回复)。
// 注意:不能用 async 函数直接 return 内层 promise——外层包装会吞掉 .itemId 属性。
function createInboxItem(partial) {
  const item = {
    id: crypto.randomUUID(),
    kind: partial.kind === "question" ? "question" : "approval",
    sessionId: String(partial.sessionId || ""),
    ...(partial.scheduleId ? { scheduleId: String(partial.scheduleId) } : {}),
    ...(partial.tool ? { tool: String(partial.tool) } : {}),
    ...(partial.title ? { title: String(partial.title).slice(0, 200) } : {}),
    ...(partial.details ? { details: String(partial.details).slice(0, 2000) } : {}),
    ...(partial.question ? { question: String(partial.question).slice(0, 1000) } : {}),
    ...(Array.isArray(partial.options) && partial.options.length ? { options: partial.options.map(String).slice(0, 5) } : {}),
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  const pending = new Promise((resolve) => {
    inboxPending.set(item.id, resolve);
  });
  pending.itemId = item.id;
  inboxPersistQueue = inboxPersistQueue.then(async () => {
    const items = await readInbox();
    items.push(item);
    await writeInbox(items);
    broadcastInboxChanged();
  }).catch(() => { });
  return pending;
}

async function settleInboxItem(id, status, resolution) {
  // 与 createInboxItem 共用同一落盘队列：settle 是 read-modify-write，
  // 不排队会与创建写入互相覆盖（条目丢失或复活成 pending 钉子户）
  const run = inboxPersistQueue.then(async () => {
    const items = await readInbox();
    const item = items.find((entry) => String(entry.id) === String(id));
    if (!item || item.status !== "pending") return null;
    item.status = status;
    if (resolution) item.resolution = resolution;
    item.resolvedAt = new Date().toISOString();
    await writeInbox(items);
    broadcastInboxChanged();
    return item;
  });
  inboxPersistQueue = run.catch(() => { });
  return run;
}

// 兜底清“钉子户”：pending 条目的等待 promise 已不在 inboxPending 里（任务提前退出、
// 计时器丢失等），界面会永远显示为待处理，点击只报“该事项已处理或已失效”且无法删除。
// 每次读取列表前把这类孤儿条目自动落盘为已失效，卡片随之移入“最近已处理”，可手动移除。
function sweepOrphanedInboxItems() {
  const run = inboxPersistQueue.then(async () => {
    const items = await readInbox();
    let changed = false;
    for (const item of items) {
      if (item.status !== "pending" || inboxPending.has(item.id)) continue;
      item.status = "expired";
      item.resolution = "任务已结束，该事项自动失效";
      item.resolvedAt = new Date().toISOString();
      changed = true;
    }
    if (changed) {
      await writeInbox(items);
      broadcastInboxChanged();
    }
  });
  inboxPersistQueue = run.catch(() => { });
  return run;
}

// 挂起条目的等待必须有界：无人处理时任务（及其身后的渠道队列/全局守卫）会永久悬死。
// 渠道交互等待 10 分钟；无人值守的定时/唤醒续跑放宽到 2 小时。
const CHANNEL_PENDING_TIMEOUT_MS = 10 * 60 * 1000;
const UNATTENDED_PENDING_TIMEOUT_MS = 2 * 3600 * 1000;
// 渠道消息等待全局空闲的上限：桌面任务/定时任务/其他渠道任务长时间不结束时，
// 排队消息不能无限堆积（否则用户只会看到“排队数+1”而没有任何任务被执行）。
const CHANNEL_QUEUE_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

// 立即以失效处理挂起条目：解决等待中的 promise（ok:false）并落盘留痕
function expireInboxItemNow(id, reason) {
  const resolve = inboxPending.get(id);
  inboxPending.delete(id);
  if (resolve) resolve({ ok: false, reason });
  void settleInboxItem(id, "expired", reason);
}

// await 挂起条目并附加上限；超时按拒绝/未回答处理，任务据此正常收尾
function awaitInboxWithTimeout(pending, reason, timeoutMs = CHANNEL_PENDING_TIMEOUT_MS) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      expireInboxItemNow(pending.itemId, reason);
      resolve({ ok: false, reason, timedOut: true });
    }, timeoutMs);
    // 不让计时器拖住进程退出
    if (typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}

// 应用退出：所有挂起条目以拒绝解决（任务循环正常收尾），条目标记已失效
async function expireAllPendingInbox(reason) {
  const items = await readInbox();
  let changed = false;
  for (const item of items) {
    if (item.status !== "pending") continue;
    item.status = "expired";
    item.resolution = reason;
    changed = true;
    const resolve = inboxPending.get(item.id);
    if (resolve) {
      inboxPending.delete(item.id);
      resolve({ ok: false, reason });
    }
  }
  if (changed) await writeInbox(items);
}

// 重启后：上一次运行残留的 pending 条目所对应的任务早已退出，标记为已失效
async function expireOrphanedInboxItems() {
  const items = await readInbox();
  let changed = false;
  for (const item of items) {
    if (item.status !== "pending") continue;
    item.status = "expired";
    item.resolution = "应用在等待处理期间关闭，任务已终止";
    changed = true;
  }
  if (changed) await writeInbox(items);
}

ipcMain.handle("inbox:list", async () => {
  await sweepOrphanedInboxItems();
  return readInbox();
});

// 决议挂起条目(收件箱 UI 与 IM 渠道共用);via 标注决议来源,留痕可审计
async function resolveInboxInternal(id, { approved, answer, via = "desktop" } = {}) {
  const resolve = inboxPending.get(id);
  if (!resolve) return { ok: false, error: "该事项已处理或已失效" };
  const items = await readInbox();
  const item = items.find((entry) => String(entry.id) === id);
  if (!item || item.status !== "pending") return { ok: false, error: "该事项已处理或已失效" };
  const suffix = via === "desktop" ? "" : `(来自 ${via})`;
  if (item.kind === "question") {
    const text = String(answer || "").trim();
    if (!text) return { ok: false, error: "回答不能为空" };
    inboxPending.delete(id);
    await settleInboxItem(id, "resolved", `已回答：${text.slice(0, 200)}${suffix}`);
    resolve({ ok: true, answer: text });
  } else {
    const ok = Boolean(approved);
    inboxPending.delete(id);
    await settleInboxItem(id, "resolved", `${ok ? "已允许" : "已拒绝"}${suffix}`);
    resolve({ ok, reason: ok ? "" : "用户拒绝了这次操作" });
  }
  return { ok: true };
}

ipcMain.handle("inbox:resolve", async (_event, payload) =>
  resolveInboxInternal(String(payload?.id || ""), { approved: payload?.approved, answer: payload?.answer }));

ipcMain.handle("inbox:dismiss", async (_event, id) => {
  const items = await readInbox();
  const item = items.find((entry) => String(entry.id) === String(id));
  if (item?.status === "pending") return { ok: false, error: "待处理事项不能移除，请先处理" };
  await writeInbox(items.filter((entry) => String(entry.id) !== String(id)));
  broadcastInboxChanged();
  return { ok: true };
});

ipcMain.handle("usage:clear", async () => {
  await writeJson(dataFile("usage-stats.json"), []);
  return { ok: true };
});

ipcMain.handle("memories:delete", async (_event, id) => {
  if (isBuiltinMemoryId(id)) return { ok: false, error: "内置记忆不能删除" };
  await memoryWikiReady();
  // 队列和 wiki 页面各删一份：尚未整合的条目在队列里，已整合的在页面行上。
  const items = await readSavedMemories();
  await writeJson(dataFile("memory.json"), items.filter((item) => String(item.id) !== String(id)));
  const removed = await removeWikiMemory(wikiRoot(), String(id));
  return { ok: true, removed };
});

// 记忆整理（lint）：让模型对 wiki 做一次健康检查——合并重复、修订矛盾、归位条目。
ipcMain.handle("memories:lint", async () => {
  try {
    return await runWikiConsolidation({ lint: true });
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
});

ipcMain.handle("skills:list", (_event, workspacePath) => readSkills(String(workspacePath || "")));

ipcMain.handle("skills:set-enabled", async (_event, payload) => {
  const id = String(payload?.id || "");
  const storedSkills = await readStoredSkills();
  const storedSkill = storedSkills.find((item) => String(item.id) === id);
  if (storedSkill) {
    storedSkill.enabled = Boolean(payload?.enabled);
    await writeSkills(storedSkills);
    return { ok: true };
  }
  const allSkills = await readSkills(String(payload?.workspacePath || ""));
  if (!allSkills.some((item) => String(item.id) === id && item.readOnly)) return { ok: false };
  const overrides = await readSkillOverrides();
  overrides[id] = Boolean(payload?.enabled);
  await writeJson(dataFile("skill-overrides.json"), overrides);
  return { ok: true };
});

ipcMain.handle("skills:delete", async (_event, id) => {
  const skills = await readStoredSkills();
  const target = skills.find((item) => String(item.id) === String(id));
  if (!target) return { ok: false, error: "文件技能请在来源目录中管理" };
  await writeSkills(skills.filter((item) => String(item.id) !== String(id)));
  if (target?.builtIn) {
    const dismissed = await readDismissedBuiltins();
    if (!dismissed.includes(target.name)) {
      dismissed.push(target.name);
      await writeJson(dataFile("skills-dismissed.json"), dismissed);
    }
  }
  return { ok: true };
});

ipcMain.handle("skill-libraries:search", async (_event, payload) => {
  try {
    const settings = await readSettings();
    return { ok: true, ...(await searchSkillLibraries(settings.skillLibraries, payload?.query)) };
  } catch (error) {
    return { ok: false, results: [], warnings: [], error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("skill-libraries:install", async (_event, payload) => {
  try {
    const settings = await readSettings();
    const result = await installSkillFromLibrary(settings.skillLibraries, payload?.libraryId, payload?.slug);
    return { ok: true, slug: result.slug, targetDir: result.targetDir };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ---- 定时计划 ----

let schedulerTimer = null;
let runningScheduledTask = false;

async function readSchedules() {
  const items = await readJson(dataFile("schedules.json"), []);
  const list = Array.isArray(items) ? items : [];
  // 兼容旧版（DYWork 时代）定时计划字段：workspace → workspacePath、schedule.type → recurrence；
  // 缺失 allowWorkspaceWrites 时按只读处理（不擅自授予写权限）。检测到旧字段自动归一化并回写，
  // 避免升级后计划因拿不到工作目录而每次执行失败。
  let changed = false;
  for (const item of list) {
    if (!item.workspacePath && item.workspace) {
      item.workspacePath = String(item.workspace);
      changed = true;
    }
    if (!item.recurrence && item.schedule?.type) {
      item.recurrence = String(item.schedule.type);
      changed = true;
    }
    if (item.allowWorkspaceWrites === undefined) {
      item.allowWorkspaceWrites = false;
      changed = true;
    }
  }
  if (changed) await writeJson(dataFile("schedules.json"), list);
  return list;
}

async function writeSchedules(items) {
  await writeJson(dataFile("schedules.json"), items);
}

function broadcastSchedulesChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("schedules:changed");
}

function nextOccurrence(recurrence, currentIso, now) {
  const seconds = recurrence === "hourly" ? 3600 : recurrence === "weekly" ? 7 * 86400 : 86400;
  let next = new Date(currentIso);
  if (Number.isNaN(next.getTime())) next = new Date(now.getTime() + seconds * 1000);
  while (next <= now) next = new Date(next.getTime() + seconds * 1000);
  return next.toISOString();
}

async function recoverInterruptedSchedules() {
  const items = await readSchedules();
  let recovered = false;
  for (const item of items) {
    if (item.lastStatus !== "running") continue;
    item.lastStatus = "failed";
    item.lastSummary = "应用在上次执行过程中关闭，任务已恢复等待重新执行";
    item.nextRun = new Date().toISOString();
    item.enabled = true;
    recovered = true;
  }
  if (recovered) await writeSchedules(items);
}

async function markScheduleFinished(id, success, summary, sessionId = "") {
  const items = await readSchedules();
  const item = items.find((entry) => String(entry.id) === String(id));
  if (!item) return;
  const now = new Date();
  item.lastStatus = success ? "success" : "failed";
  item.lastSummary = String(summary || "").slice(0, 500);
  item.updatedAt = now.toISOString();
  appendScheduleHistory(item, {
    at: now.toISOString(),
    status: item.lastStatus,
    summary: item.lastSummary,
    sessionId: String(sessionId || ""),
  });
  if (item.recurrence === "once") item.enabled = false;
  else item.nextRun = nextOccurrence(item.recurrence, item.nextRun, now);
  await writeSchedules(items);
}

// 运行历史：每次执行追加一条（时间/结果/关联会话 id），保留最近 10 条；
// 会话 id 对应的转录会话可在任务列表中打开，查看完整过程
function appendScheduleHistory(item, entry) {
  if (!Array.isArray(item.history)) item.history = [];
  item.history.unshift(entry);
  item.history = item.history.slice(0, 10);
}

async function markScheduleSleeping(id, wake, sessionId = "") {
  const items = await readSchedules();
  const item = items.find((entry) => String(entry.id) === String(id));
  if (!item) return;
  item.lastStatus = "sleeping";
  item.lastSummary = `已挂起，将于 ${new Date(wake.wakeAt).toLocaleString("zh-CN")} 自动唤醒继续（原因：${String(wake.reason || "").slice(0, 120)}）`;
  item.updatedAt = new Date().toISOString();
  appendScheduleHistory(item, {
    at: new Date().toISOString(),
    status: "sleeping",
    summary: item.lastSummary,
    sessionId: String(sessionId || ""),
  });
  await writeSchedules(items);
}

// 定时/续跑任务的转录落盘：应用窗口未运行时，主进程直接把带完整转录的会话
// 写进 sessions.json（下次启动经 app:initial-state 读回），不再丢失运行记录
async function persistSessionRecord(session) {
  try {
    const sessions = await readJson(dataFile("sessions.json"), []);
    if (!Array.isArray(sessions)) return;
    if (sessions.some((item) => item?.id === session.id)) return;
    sessions.unshift(session);
    await writeJson(dataFile("sessions.json"), sessions);
  } catch (error) {
    console.log(`[schedules] 转录落盘失败：${error?.message || error}`);
  }
}

// 窗口未运行时的续跑追加：往已落盘的会话里补转录消息（按消息内容去重，避免重复段落）
async function persistSessionAppend(sessionId, messages) {
  try {
    const sessions = await readJson(dataFile("sessions.json"), []);
    if (!Array.isArray(sessions)) return;
    const session = sessions.find((item) => item?.id === sessionId);
    if (!session || !Array.isArray(messages)) return;
    const known = new Set((session.messages || []).map((message) => `${message?.role}:${message?.content}`));
    for (const message of messages) {
      if (!known.has(`${message?.role}:${message?.content}`)) session.messages.push(message);
    }
    session.updatedAt = new Date().toISOString();
    await writeJson(dataFile("sessions.json"), sessions);
  } catch (error) {
    console.log(`[schedules] 续跑转录落盘失败：${error?.message || error}`);
  }
}
// wakes.json 条目：{ id, sessionId, scheduleId?, workspacePath, approvalMode, wakeAt, reason,
//   prompt, finalText, status: "pending" | "fired" | "cancelled", createdAt, firedAt? }
// pending → fired 一次性转移,杜绝重复唤醒;会话被删除/任务被取消时置 cancelled。

async function readWakes() {
  const wakes = await readJson(dataFile("wakes.json"), []);
  return Array.isArray(wakes) ? wakes : [];
}

async function writeWakes(wakes) {
  const pending = wakes.filter((wake) => wake.status === "pending");
  const settled = wakes.filter((wake) => wake.status !== "pending").slice(-50);
  await writeJson(dataFile("wakes.json"), [...pending, ...settled]);
}

async function hasPendingWakeForSession(sessionId) {
  const wakes = await readWakes();
  return wakes.some((wake) => wake.status === "pending" && String(wake.sessionId) === String(sessionId));
}

async function registerWake({ sessionId, scheduleId, workspacePath, approvalMode, wake, prompt, finalText }) {
  if (!sessionId || !workspacePath || !wake?.wakeAt) return;
  const wakes = await readWakes();
  if (wakes.some((entry) => entry.status === "pending" && String(entry.sessionId) === String(sessionId))) return;
  wakes.push({
    id: crypto.randomUUID(),
    sessionId: String(sessionId),
    ...(scheduleId ? { scheduleId: String(scheduleId) } : {}),
    workspacePath: String(workspacePath),
    approvalMode: normalizeApprovalMode(approvalMode),
    wakeAt: wake.wakeAt,
    reason: String(wake.reason || "等待约定时间").slice(0, 300),
    prompt: String(prompt || "").slice(0, 2000),
    finalText: String(finalText || "").slice(0, 1500),
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  await writeWakes(wakes);
}

async function cancelWakesForSession(sessionId) {
  const wakes = await readWakes();
  let changed = false;
  for (const wake of wakes) {
    if (wake.status === "pending" && String(wake.sessionId) === String(sessionId)) {
      wake.status = "cancelled";
      changed = true;
    }
  }
  if (changed) await writeWakes(wakes);
}

// 从会话存档中重建可见对话（只读,渲染端仍是唯一写者）；找不到时退回唤醒记录里的提示与进展
async function visibleConversationForSession(sessionId, fallbackPrompt, fallbackFinalText) {
  const sessions = await readJson(dataFile("sessions.json"), []);
  const session = Array.isArray(sessions) ? sessions.find((item) => String(item?.id) === String(sessionId)) : null;
  const visible = (session?.messages || [])
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message) => ({ role: message.role, content: String(message.content || "") }))
    .filter((message) => message.content.trim())
    .slice(-20);
  if (visible.length) return visible;
  const fallback = [];
  if (fallbackPrompt) fallback.push({ role: "user", content: fallbackPrompt });
  if (fallbackFinalText) fallback.push({ role: "assistant", content: fallbackFinalText });
  return fallback;
}

async function workingContextForSession(sessionId) {
  const sessions = await readJson(dataFile("sessions.json"), []);
  const session = Array.isArray(sessions) ? sessions.find((item) => String(item?.id) === String(sessionId)) : null;
  if (!session) return "";
  const messageContext = [...(session.messages || [])]
    .reverse()
    .find((message) => Object.prototype.hasOwnProperty.call(message || {}, "workingContext"))
    ?.workingContext;
  return String(session.workingContext ?? messageContext ?? "").trim();
}

async function resumeWake(wake) {
  runningScheduledTask = true;
  trackTaskStart();
  let routeExtraTool = null;
  try {
    const settings = await readSettings();
    if (!settings.endpoint || !settings.model || !settings.apiKey) {
      throw new Error("模型还没有配置，无法续跑挂起的任务");
    }
    routeExtraTool = createExtraToolRouter(settings, wake.workspacePath);
    const prior = await visibleConversationForSession(wake.sessionId, wake.prompt, wake.finalText);
    const workingContext = await workingContextForSession(wake.sessionId);
    const wakeText = `你于 ${new Date(wake.createdAt).toLocaleString("zh-CN")} 主动挂起（原因：${wake.reason}），现在到达约定时间 ${new Date(wake.wakeAt).toLocaleString("zh-CN")}，请继续完成任务。`
      + (wake.finalText ? `\n此前的进展：\n${wake.finalText}` : "");
    const collector = createTranscriptCollector();
    const approvalMode = normalizeApprovalMode(wake.approvalMode);
    const result = await runAgent({
      settings,
      workspacePath: wake.workspacePath,
      hooks: await readHooks(wake.workspacePath),
      workingContext,
      conversation: [...prior, { role: "user", content: wakeText }],
      memoryPages: await readMemoryPages(wake.sessionId),
      memoryReviewDue: true,
      skills: await readSkills(wake.workspacePath),
      history: { search: searchHistory, readContext: readHistoryContext },
      approvalMode,
      standingRules: await readStandingRules(),
      audit: (entry) => auditLog.record({ ...entry, sessionId: wake.sessionId, approvalMode }),
      extraTools: agentExtraTools(await mcpExtraTools(settings)),
      onExtraTool: routeExtraTool,
      isCancelled: () => mcpShuttingDown,
      sleepGuard: () => hasPendingWakeForSession(wake.sessionId),
      sessionId: wake.sessionId,
      startBackgroundTask: (p) => backgroundTasksManager.startTask({ ...p, sessionId: p.sessionId || wake.sessionId }),
      // 续跑同样无人值守：审批与提问进收件箱挂起等待（2 小时上限，超时按拒绝处理）
      requestApproval: async (action) => {
        const pending = createInboxItem({
          kind: "approval",
          sessionId: wake.sessionId,
          scheduleId: wake.scheduleId,
          tool: action.kind,
          title: `续跑任务申请：${action.title || action.kind}`,
          details: action.details,
        });
        const resolution = await awaitInboxWithTimeout(pending, "审批等待超时，已自动取消", UNATTENDED_PENDING_TIMEOUT_MS);
        return Boolean(resolution?.ok);
      },
      requestUserInput: (request) => {
        const pending = createInboxItem({
          kind: "question",
          sessionId: wake.sessionId,
          scheduleId: wake.scheduleId,
          question: request.question,
          options: request.options,
          title: "续跑任务提问",
        });
        return awaitInboxWithTimeout(pending, "提问等待超时，按已有信息继续", UNATTENDED_PENDING_TIMEOUT_MS);
      },
      emit: (agentEvent) => {
        collector.handle(agentEvent);
        if (agentEvent?.type === "skill-saved") void appendSkill(agentEvent.item);
        if (agentEvent?.type === "token-usage") void appendUsageStat(agentEvent);
      },
    });
    for (const memory of memoriesFromAgentResult(result)) await appendMemory(memory, wake.workspacePath, wake.sessionId);
    if (result.status === "sleeping" && result.wake) {
      // 再次挂起：登记下一段唤醒
      await registerWake({
        sessionId: wake.sessionId,
        scheduleId: wake.scheduleId,
        workspacePath: wake.workspacePath,
        approvalMode,
        wake: result.wake,
        prompt: wake.prompt,
        finalText: result.finalText,
      });
      if (wake.scheduleId) await markScheduleSleeping(wake.scheduleId, result.wake, wake.sessionId);
    } else if (wake.scheduleId) {
      await markScheduleFinished(wake.scheduleId, result.status === "done", result.finalText || result.reason || "没有产出结果", wake.sessionId);
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
  } catch (error) {
    if (wake.scheduleId) {
      await markScheduleFinished(wake.scheduleId, false, error instanceof Error ? error.message : String(error), wake.sessionId);
    }
  } finally {
    routeExtraTool?.dispose();
    trackTaskEnd();
    runningScheduledTask = false;
  }
}

async function checkDueWakes() {
  if (mcpShuttingDown || runningScheduledTask || runningChannelTaskCount > 0 || activeAgents.size) return;
  const now = new Date();
  const wakes = await readWakes();
  const due = wakes.find((wake) => wake.status === "pending" && wake.wakeAt && new Date(wake.wakeAt) <= now);
  if (!due) return;
  // 先落盘 fired 再执行：pending → fired 一次性转移,应用中途退出也不会重复唤醒
  due.status = "fired";
  due.firedAt = now.toISOString();
  await writeWakes(wakes);
  await resumeWake(due);
}

ipcMain.handle("wakes:cancel-for-session", async (_event, sessionId) => {
  await cancelWakesForSession(String(sessionId || ""));
  return { ok: true };
});

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
    buildMessages(userText, result, assistantContent) {
      const finalPlan = result?.status === "done" && plan?.length
        ? plan.map((step) => ({ ...step, status: "completed" }))
        : plan;
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
          ...(result?.workingContext ? { workingContext: result.workingContext } : {}),
        },
      ];
    },
  };
}

async function runScheduledTask(record) {
  runningScheduledTask = true;
  trackTaskStart();
  broadcastSchedulesChanged();
  // 本次执行的会话 id：收件箱条目、审计记录与最终留痕会话共用同一个
  const scheduleSessionId = crypto.randomUUID();
  let routeExtraTool = null;
  try {
    const settings = await readSettings();
    if (!settings.endpoint || !settings.model || !settings.apiKey) {
      throw new Error("模型还没有配置，无法执行定时任务");
    }
    routeExtraTool = createExtraToolRouter(settings, record.workspacePath);
    const collector = createTranscriptCollector();
    const result = await runAgent({
      settings,
      workspacePath: record.workspacePath,
      hooks: await readHooks(record.workspacePath),
      conversation: [{ role: "user", content: record.prompt }],
      memoryPages: await readMemoryPages(scheduleSessionId),
      memoryReviewDue: true,
      skills: await readSkills(record.workspacePath),
      history: { search: searchHistory, readContext: readHistoryContext },
      approvalMode: record.allowWorkspaceWrites ? "reviewer" : "deny-changes",
      standingRules: await readStandingRules(),
      audit: (entry) => auditLog.record({ ...entry, sessionId: scheduleSessionId, approvalMode: record.allowWorkspaceWrites ? "reviewer" : "deny-changes" }),
      extraTools: agentExtraTools(await mcpExtraTools(settings)),
      onExtraTool: routeExtraTool,
      isCancelled: () => mcpShuttingDown,
      sleepGuard: () => hasPendingWakeForSession(scheduleSessionId),
      sessionId: scheduleSessionId,
      startBackgroundTask: (p) => backgroundTasksManager.startTask({ ...p, sessionId: p.sessionId || scheduleSessionId }),
      // 无人值守：需要确认的操作与提问进审批收件箱挂起等待（2 小时上限，超时按拒绝处理）
      requestApproval: async (action) => {
        const pending = createInboxItem({
          kind: "approval",
          sessionId: scheduleSessionId,
          scheduleId: record.id,
          tool: action.kind,
          title: `定时任务「${record.name || "未命名"}」申请：${action.title || action.kind}`,
          details: action.details,
        });
        const resolution = await awaitInboxWithTimeout(pending, "审批等待超时，已自动取消", UNATTENDED_PENDING_TIMEOUT_MS);
        return Boolean(resolution?.ok);
      },
      requestUserInput: (request) => {
        const pending = createInboxItem({
          kind: "question",
          sessionId: scheduleSessionId,
          scheduleId: record.id,
          question: request.question,
          options: request.options,
          title: `定时任务「${record.name || "未命名"}」提问`,
        });
        return awaitInboxWithTimeout(pending, "提问等待超时，按已有信息继续", UNATTENDED_PENDING_TIMEOUT_MS);
      },
      emit: (agentEvent) => {
        collector.handle(agentEvent);
        if (agentEvent?.type === "skill-saved") void appendSkill(agentEvent.item);
        if (agentEvent?.type === "token-usage") void appendUsageStat(agentEvent);
      },
    });
    for (const memory of memoriesFromAgentResult(result)) await appendMemory(memory, record.workspacePath, scheduleSessionId);
    if (result.status === "sleeping" && result.wake) {
      // 主动挂起：登记唤醒记录,本次不结算计划,到点由 checkDueWakes 续跑
      await registerWake({
        sessionId: scheduleSessionId,
        scheduleId: record.id,
        workspacePath: record.workspacePath,
        approvalMode: record.allowWorkspaceWrites ? "reviewer" : "deny-changes",
        wake: result.wake,
        prompt: record.prompt,
        finalText: result.finalText,
      });
      await markScheduleSleeping(record.id, result.wake, scheduleSessionId);
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
    await markScheduleFinished(record.id, result.status === "done", result.finalText || result.reason || "没有产出结果", scheduleSessionId);
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
  } catch (error) {
    await markScheduleFinished(record.id, false, error instanceof Error ? error.message : String(error), scheduleSessionId);
  } finally {
    routeExtraTool?.dispose();
    trackTaskEnd();
    runningScheduledTask = false;
    broadcastSchedulesChanged();
  }
}

async function checkDueSchedules() {
  if (mcpShuttingDown || runningScheduledTask || runningChannelTaskCount > 0 || activeAgents.size) return;
  const now = new Date();
  const items = await readSchedules();
  const due = items.find((item) => item.enabled && item.nextRun && new Date(item.nextRun) <= now);
  if (!due) return;
  due.lastStatus = "running";
  due.lastRun = now.toISOString();
  due.updatedAt = now.toISOString();
  await writeSchedules(items);
  await runScheduledTask(due);
}

function startScheduler() {
  void recoverInterruptedSchedules().then(() => {
    if (mcpShuttingDown) return;
    // 同一 tick 先看到点的主动唤醒（self-wake）再到期的定时计划；两者共用忙碌守卫，串行执行
    const tick = () => void checkDueWakes().then(() => checkDueSchedules());
    schedulerTimer = setInterval(tick, 30_000);
    setTimeout(tick, 1500);
  });
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
  const sessions = await readJson(dataFile("sessions.json"), []);
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

const channelManager = createChannelManager({
  readChats: readChannelChats,
  writeChats: (chats) => writeJson(dataFile("channel-chats.json"), chats),
  mediaDir: channelMediaDir(),
  wechatStateRoot: channelWechatStateRoot(),
  onStatus: broadcastChannelsStatus,
  onRunTask: runChannelTask,
  onResolvePending: async ({ channel, pending, replyText }) => {
    const via = CHANNEL_LABELS[channel] || channel;
    if (pending.kind === "approval") {
      const approved = parseApprovalReply(replyText);
      if (approved === null) return false;
      const result = await resolveInboxInternal(pending.itemId, { approved, via });
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
    const result = await resolveInboxInternal(pending.itemId, { answer, via });
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
      expireInboxItemNow(pending.itemId, `用户通过${via}停止了任务`);
    }
    if (!channelTaskKeys.has(key)) return false;
    channelTaskAborts.add(key);
    return true;
  },
  // 排队提示附带当前阻塞原因,让用户知道在等什么
  queueWaitHint: () => {
    const hint = activeAgents.size
      ? "电脑端有任务正在执行"
      : runningScheduledTask
        ? "有定时/挂起任务正在执行"
        : runningChannelTaskCount > 0
          ? "上一个渠道任务还在执行（可能在等待审批）"
          : "";
    // 排队提示出现时记录全局状态：如果三个占用标志都为空却仍在排队，
    // 说明队列本身没有前进，这是排查“排队后不执行”的关键证据。
    channelDebug("排队提示", {
      activeAgents: activeAgents.size,
      runningScheduledTask,
      runningChannelTaskCount,
      hint,
    });
    return hint;
  },
});

async function reconcileChannels() {
  const settings = await readSettings();
  const wechatCredentials = settings.channels?.wechat?.enabled ? await readWechatCredentials() : {};
  await channelManager.reconcile({
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
    } catch (error) {
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
    } catch (error) {
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
  } catch (error) {
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
  while (!mcpShuttingDown && !channelTaskAborts.has(myKey) && (activeAgents.size || runningScheduledTask || runningChannelTaskCount > 0)) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (!mcpShuttingDown && !channelTaskAborts.has(myKey) && Date.now() - waitStartedAt > CHANNEL_QUEUE_WAIT_TIMEOUT_MS) {
      channelDebug("渠道任务等待超时已跳过", {
        chatKey: myKey,
        text: String(text || "").slice(0, 80),
        activeAgents: activeAgents.size,
        runningScheduledTask,
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
      runningScheduledTask,
      runningChannelTaskCount,
    });
  }
  let routeExtraTool = null;
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
    // 渠道审批严格度：auto 自动执行(少打扰)/interactive 严格逐次确认，其余回退 reviewer。
    const channelMode = settings.channels?.approvalMode;
    const approvalMode = channelMode === "auto" || channelMode === "interactive" ? channelMode : "reviewer";
    let baseRouter = createExtraToolRouter(taskSettings, workspacePath);
    // send_media / text_to_speech / switch_workspace 先由渠道处理器接管，其余交给现有 MCP/浏览器路由
    routeExtraTool = async (name, args) => {
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
    // 渠道任务实时透传：把运行中的关键 agent 事件（活动/正文/计划/循环状态）转发到渲染端，
    // 让渠道会话像桌面任务一样边跑边显示，而不是等全部结束才一次性 append。
    // 只挑影响 UI 的轻量事件；trace/token-usage 等仍只进本地留痕。事件体再包一层 sessionId/runId，
    // 与桌面端 onAgentEvent 的负载形状一致，渲染端可用同一套归约逻辑处理。
    // channelRun: true 是渠道运行的标记：桌面端在同一渠道会话里发起的任务也发 agent:event，
    // 没有这个标记渲染端无法区分，会把同一条回复渲染成两个气泡。
    const forwardChannelEvent = (agentEvent) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!CHANNEL_STREAM_EVENT_TYPES.has(agentEvent?.type)) return;
      mainWindow.webContents.send("agent:event", { sessionId, runId: channelRunId, channelRun: true, event: agentEvent });
    };
    const prior = await visibleConversationForSession(sessionId, "", "");
    const workingContext = await workingContextForSession(sessionId);
    // 模型可见内容：文本 + 图片块（复用桌面端 providerMessageContent）
    const contentForModel = await providerMessageContent({ content: userText, attachments });
    // 用「正在输入」状态提示处理中，不再以文字消息形式打扰
    await sendTyping().catch(() => { });
    const result = await runAgent({
      settings: taskSettings,
      workspacePath,
      hooks: await readHooks(workspacePath),
      workingContext,
      conversation: [...prior, { role: "user", content: contentForModel }],
      memoryPages: await readMemoryPages(sessionId),
      memoryReviewDue: true,
      skills: await readSkills(workspacePath),
      history: { search: searchHistory, readContext: readHistoryContext },
      approvalMode,
      standingRules: await readStandingRules(),
      audit: (entry) => auditLog.record({ ...entry, sessionId, approvalMode, channel }),
      extraTools: [...agentExtraTools(await mcpExtraTools(taskSettings)), ...channelMediaToolDefinitions()],
      onExtraTool: routeExtraTool,
      isCancelled: () => mcpShuttingDown || channelTaskAborts.has(myKey),
      sleepGuard: () => hasPendingWakeForSession(sessionId),
      sessionId,
      startBackgroundTask: (p) => backgroundTasksManager.startTask({ ...p, sessionId: p.sessionId || sessionId }),
      // 审批:收件箱(桌面可决议)+ IM 卡片(回复 允许/拒绝 决议),两侧共用 resolveInboxInternal
      // 等待有 10 分钟上限：超时按拒绝处理，避免渠道队列头部永久悬死
      requestApproval: async (action) => {
        const pending = createInboxItem({
          kind: "approval",
          sessionId,
          tool: action.kind,
          title: `${channelLabel}消息申请：${action.title || action.kind}`,
          details: action.details,
        });
        registerPending({ itemId: pending.itemId, kind: "approval" });
        await reply(
          `⚠️ 需要审批\n${action.title || action.kind}\n${String(action.details || "").slice(0, 400)}\n\n回复 1 允许 / 0 拒绝 / 2 停止整个任务。10 分钟未回复将自动取消。`.trim(),
        ).catch(() => { });
        const resolution = await awaitInboxWithTimeout(pending, "审批等待超时，已自动取消");
        clearPending();
        if (resolution?.timedOut) {
          await reply("审批等待超时，已自动取消这次操作。").catch(() => { });
        }
        return Boolean(resolution?.ok);
      },
      requestUserInput: async (request) => {
        const pending = createInboxItem({
          kind: "question",
          sessionId,
          question: request.question,
          options: request.options,
          title: `${channelLabel}消息提问`,
        });
        registerPending({ itemId: pending.itemId, kind: "question", options: request.options || [] });
        const optionsText = (request.options || []).map((option, index) => `${index + 1}. ${option}`).join("\n");
        await reply(`❓ ${request.question}${optionsText ? `\n\n${optionsText}\n回复序号或直接回答。` : ""}\n10 分钟未回复将按已有信息继续。`.trim()).catch(() => { });
        const resolution = await awaitInboxWithTimeout(pending, "提问等待超时，按已有信息继续");
        clearPending();
        return resolution;
      },
      emit: (agentEvent) => {
        collector.handle(agentEvent);
        forwardChannelEvent(agentEvent);
        if (agentEvent?.type === "skill-saved") void appendSkill(agentEvent.item);
        if (agentEvent?.type === "token-usage") void appendUsageStat(agentEvent);
      },
    });
    for (const memory of memoriesFromAgentResult(result)) await appendMemory(memory, workspacePath, sessionId);
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
      await registerWake({
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
      } catch (error) {
        sendFailed = true;
        const reason = error instanceof Error ? error.message : String(error);
        // 与任务级错误提示同口径：去掉原始 JSON/堆栈，截断后只留简明原因
        const friendly = (reason.replace(/\s*[{[].*$/s, "") || reason).slice(0, 160);
        sendFailureNote = `（发送失败：${friendly}）`;
        for (const part of parts) {
          if (part.type !== "media") continue;
          await reply(`[已生成 ${part.fileName || "文件"}，但发送失败：${friendly}]`).catch(() => { });
        }
      }
      const sentNote = sendFailed ? sendFailureNote : `（已发送 ${pendingMedia.length} 个文件）`;
      // 出站媒体同步进桌面会话：和入站一样走 Attachment 描述，让图片/文件在对话里可见
      const outboundAttachments = await buildChannelAttachments(pendingMedia);
      const built = collector.buildMessages(userText, result, `${finalText}${sentNote}`);
      if (outboundAttachments.length) built[1].attachments = outboundAttachments;
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
  } catch (error) {
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
    routeExtraTool?.dispose();
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

ipcMain.handle("channels:get-status", () => channelManager.status());

ipcMain.handle("schedules:list", () => readSchedules());

ipcMain.handle("schedules:save", async (_event, payload) => {
  const name = String(payload?.name || "").trim();
  const prompt = String(payload?.prompt || "").trim();
  const workspacePath = String(payload?.workspacePath || "").trim();
  const recurrence = String(payload?.recurrence || "daily");
  const nextRun = new Date(payload?.nextRun || "");
  if (!name || !prompt) return { ok: false, error: "计划名称和任务内容不能为空" };
  if (!workspacePath) return { ok: false, error: "请先选择工作文件夹" };
  if (!["once", "hourly", "daily", "weekly"].includes(recurrence)) return { ok: false, error: "重复方式无效" };
  if (Number.isNaN(nextRun.getTime())) return { ok: false, error: "首次执行时间无效" };
  const items = await readSchedules();
  const existing = payload?.id ? items.find((item) => String(item.id) === String(payload.id)) : null;
  if (existing) {
    Object.assign(existing, {
      name, prompt, workspacePath, recurrence,
      nextRun: nextRun.toISOString(),
      allowWorkspaceWrites: Boolean(payload?.allowWorkspaceWrites),
      updatedAt: new Date().toISOString(),
    });
  } else {
    items.push({
      id: crypto.randomUUID(),
      name, prompt, workspacePath, recurrence,
      nextRun: nextRun.toISOString(),
      lastRun: "",
      enabled: true,
      allowWorkspaceWrites: Boolean(payload?.allowWorkspaceWrites),
      lastStatus: "",
      lastSummary: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  await writeSchedules(items);
  broadcastSchedulesChanged();
  return { ok: true };
});

ipcMain.handle("schedules:delete", async (_event, id) => {
  const items = await readSchedules();
  await writeSchedules(items.filter((item) => String(item.id) !== String(id)));
  broadcastSchedulesChanged();
  return { ok: true };
});

ipcMain.handle("schedules:set-enabled", async (_event, payload) => {
  const items = await readSchedules();
  const item = items.find((entry) => String(entry.id) === String(payload?.id));
  if (!item) return { ok: false };
  item.enabled = Boolean(payload?.enabled);
  item.updatedAt = new Date().toISOString();
  await writeSchedules(items);
  broadcastSchedulesChanged();
  return { ok: true };
});

ipcMain.handle("schedules:trigger-now", async (_event, id) => {
  const items = await readSchedules();
  const item = items.find((entry) => String(entry.id) === String(id));
  if (!item) return { ok: false, error: "没有找到这个定时任务" };
  if (item.lastStatus === "running") return { ok: false, error: "这个任务正在执行" };
  item.enabled = true;
  item.nextRun = new Date().toISOString();
  await writeSchedules(items);
  void checkDueSchedules();
  return { ok: true };
});

ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:toggle-maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle("window:close", () => mainWindow?.close());

app.whenReady().then(async () => {
  await migrateLegacyDataOnFirstRun();
  // 旧扁平记忆列表一次性迁移成 wiki 页面（迁移前自动备份 memory.json）
  void memoryWikiReady().catch((error) => console.log(`[memory-wiki] 迁移失败：${error?.message || error}`));
  const storedSettings = await readSettings();
  sleepBlockMode = storedSettings.preventSleep;
  updateSleepBlocker();
  createWindow();
  backgroundTasksManager.setBroadcastCallback((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("background-tasks:update", event);
    }
  });
  // 窗口先创建，自动更新初始化不阻塞界面；electron-updater 缺失时仅禁用更新
  void loadElectronUpdater().then((updater) => {
    initializeAppUpdater(storedSettings.updateUrl, updater);
    if (app.isPackaged) {
      appUpdateTimer = setTimeout(() => void checkForAppUpdate(), 8_000);
      appUpdateInterval = setInterval(() => void checkForAppUpdate(), 6 * 60 * 60 * 1000);
    }
  });
  await expireOrphanedInboxItems();
  startScheduler();
  // IM 渠道(QQ/微信)按设置启动;失败不影响主程序
  void reconcileChannels().catch(() => { });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !recreatingWindow) app.quit();
});

let mcpShutdownStarted = false;
app.on("before-quit", (event) => {
  if (mcpShutdownStarted) return;
  mcpShutdownStarted = true;
  mcpShuttingDown = true;
  event.preventDefault();
  backgroundTasksManager.cleanupAll();
  if (appUpdateTimer) clearTimeout(appUpdateTimer);
  if (appUpdateInterval) clearInterval(appUpdateInterval);
  appUpdateTimer = null;
  appUpdateInterval = null;
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  for (const agentState of activeAgents.values()) {
    agentState.cancelled = true;
    for (const resolve of agentState.pending.values()) resolve(false);
    agentState.pending.clear();
  }
  void expireAllPendingInbox("应用在等待处理期间关闭，任务已终止")
    .catch(() => { })
    .finally(() => channelManager.stopAll()
      .catch(() => { })
      .finally(() => closeAllMcpClients().finally(() => app.quit())));
});
