import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, powerSaveBlocker, safeStorage, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinHooks, requestModel, runAgent, suggestStandingRule } from "./agent.mjs";
import { createAuditLog } from "./audit.mjs";
import { BrowserAgent, browserToolDefinitions } from "./browser.mjs";
import { CHANNEL_LABELS, createChannelManager } from "./channels/manager.mjs";
import { parseApprovalReply } from "./channels/qq-bot.mjs";
import { COMPUTER_USE_INSTALL_TIMEOUT_MS, COMPUTER_USE_SERVER_ID, discoverComputerUseServer } from "./computer-use.mjs";
import { buildMemoryRecord, extractExplicitMemoryInstructions, isBuiltinMemoryId, mergeBuiltinMemories, normalizeMemories } from "./memory.mjs";
import { McpClient } from "./mcp.mjs";
import { decryptChannelSecret, deserializeSettings, encryptChannelSecret, needsSecretMigration, normalizePreventSleep, serializeSettings } from "./settings.mjs";
import { discoverFileSkills, mergeSkillRecords } from "./skills.mjs";

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
let mainWindow;

app.setName("DYWorker");
nativeTheme.themeSource = "system";
if (process.platform === "linux") {
  app.disableHardwareAcceleration();
}

function systemWindowBackground() {
  return nativeTheme.shouldUseDarkColors ? "#181916" : "#f7f7f4";
}

nativeTheme.on("updated", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(systemWindowBackground());
  }
});

function dataFile(name) {
  return path.join(app.getPath("userData"), name);
}

// 审计日志（audit.jsonl）：有副作用的工具调用，审批决策与执行结果逐条落盘
const auditLog = createAuditLog({ filePath: path.join(app.getPath("userData"), "audit.jsonl") });

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

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temporary, file);
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
  if (needsSecretMigration(stored)) {
    await writeJson(dataFile("settings.json"), serializeSettings(settings, safeStorage));
  }
  return settings;
}

async function saveSettings(settings) {
  await writeJson(dataFile("settings.json"), serializeSettings(settings, safeStorage));
}

const ignoredNames = new Set([".git", "node_modules", "dist", ".DS_Store"]);
const textExtensions = new Set([
  ".c", ".cc", ".cpp", ".css", ".csv", ".go", ".h", ".hpp", ".html", ".ini", ".java", ".js", ".json",
  ".jsx", ".log", ".md", ".mjs", ".py", ".rs", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);
const mimeTypes = new Map([
  [".bmp", "image/bmp"], [".gif", "image/gif"], [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"],
  [".png", "image/png"], [".webp", "image/webp"], [".csv", "text/csv"], [".html", "text/html"],
  [".json", "application/json"], [".md", "text/markdown"], [".txt", "text/plain"], [".xml", "application/xml"],
]);

function attachmentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return mimeTypes.get(extension) || (textExtensions.has(extension) ? "text/plain" : "application/octet-stream");
}

async function describeAttachment(filePath) {
  const stat = await fs.stat(filePath);
  const mimeType = attachmentType(filePath);
  const isImage = mimeType.startsWith("image/");
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
    ...(previewUrl ? { previewUrl } : {}),
  };
}

async function providerMessageContent(message) {
  let text = String(message?.content || "").trim();
  const imageBlocks = [];
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
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, "/audio/transcriptions");
    return url.toString();
  } catch {
    return "";
  }
}

async function listWorkspace(root, depth = 0, budget = { remaining: 500 }) {
  if (!root || depth > 4 || budget.remaining <= 0) return [];
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  directoryEntries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
  });
  const result = [];
  for (const entry of directoryEntries) {
    if (budget.remaining-- <= 0 || ignoredNames.has(entry.name)) break;
    const fullPath = path.join(root, entry.name);
    const item = {
      name: entry.name,
      path: fullPath,
      kind: entry.isDirectory() ? "directory" : "file",
    };
    if (entry.isDirectory()) item.children = await listWorkspace(fullPath, depth + 1, budget);
    result.push(item);
  }
  return result;
}

function createWindow() {
  if (process.platform === "linux") {
    Menu.setApplicationMenu(null);
  }

  const windowOptions = {
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 660,
    backgroundColor: systemWindowBackground(),
    show: process.platform === "linux",
    title: "DYWorker",
    frame: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  mainWindow = new BrowserWindow(windowOptions);
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

  if (isDevelopment) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  else mainWindow.loadFile(path.join(here, "../dist/client/index.html"));
}

ipcMain.handle("app:initial-state", async () => {
  const sessions = await readJson(dataFile("sessions.json"), defaultSessions());
  const workspacePath = sessions.find((session) => session.workspacePath)?.workspacePath || "";
  return {
    sessions,
    workspacePath,
    workspaceEntries: await listWorkspace(workspacePath),
    settings: await readSettings(),
    platform: process.platform,
  };
});

ipcMain.handle("sessions:save", async (_event, sessions) => {
  try {
    await writeJson(dataFile("sessions.json"), Array.isArray(sessions) ? sessions : []);
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

ipcMain.handle("workspace:refresh", (_event, workspacePath) => listWorkspace(String(workspacePath || "")));
ipcMain.handle("workspace:open", async (_event, targetPath) => {
  const error = await shell.openPath(String(targetPath || ""));
  return error ? { ok: false, error } : { ok: true };
});
ipcMain.handle("settings:save", async (_event, settings) => {
  try {
    await saveSettings(settings);
    sleepBlockMode = normalizePreventSleep(settings?.preventSleep);
    updateSleepBlocker();
    // 渠道配置热生效:按新设置 diff 启停 QQ/微信连接
    await reconcileChannels();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
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

ipcMain.handle("voice:transcribe", async (_event, payload) => {
  const settings = payload?.settings || {};
  const endpoint = transcriptionEndpoint(settings);
  if (!endpoint || !settings.apiKey) throw new Error("请先在设置中配置语音转写地址和 API 密钥");
  const audio = Uint8Array.from(Array.isArray(payload?.audio) ? payload.audio : []);
  if (!audio.length) throw new Error("没有收到录音内容");
  if (audio.byteLength > 25 * 1024 * 1024) throw new Error("录音超过 25 MB，请缩短后重试");
  const mimeType = String(payload?.mimeType || "audio/webm");
  const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
  const body = new FormData();
  body.append("file", new Blob([audio], { type: mimeType }), `dyworker-recording.${extension}`);
  body.append("model", String(settings.transcriptionModel || "whisper-1"));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`语音转写失败（${response.status}）：${detail}`);
  }
  const result = await response.json();
  const text = result?.text || result?.data?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("语音服务没有返回文字");
  return { text: text.trim() };
});

// ---- 本地代理 ----

const activeAgents = new Map();
let mcpShuttingDown = false;

async function readSavedMemories() {
  const items = await readJson(dataFile("memory.json"), []);
  return normalizeMemories(items);
}

async function readMemories() {
  return mergeBuiltinMemories(await readSavedMemories());
}

async function appendMemory(item, workspacePath) {
  const items = await readSavedMemories();
  const record = buildMemoryRecord(item, {
    id: crypto.randomUUID(),
    workspacePath,
  });
  if (!record?.content) return null;
  const duplicate = items.find((existing) => (
    existing.content === record.content
    && existing.category === record.category
    && existing.kind === record.kind
    && existing.scope === record.scope
    && existing.workspacePath === record.workspacePath
  ));
  if (duplicate) return duplicate;
  items.push(record);
  await writeJson(dataFile("memory.json"), items);
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
            parameters: tool.inputSchema && typeof tool.inputSchema === "object"
              ? tool.inputSchema
              : { type: "object", properties: {} },
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
          : "请确认 Codex Computer Use 已获得辅助功能和屏幕录制权限。";
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
  return [...mcpTools, ...browserToolDefinitions()];
}

function createExtraToolRouter(settings, workspacePath, { signal } = {}) {
  const browserAgent = new BrowserAgent();
  browserAgent.setWorkspace(workspacePath);
  const route = (name, args) => {
    if (name.startsWith("browser__")) return browserAgent.handle(name, args);
    return callMcpTool(settings, name, args, { signal });
  };
  route.dispose = () => browserAgent.dispose();
  return route;
}

ipcMain.handle("agent:send", async (event, payload) => {
  if (mcpShuttingDown) return { status: "cancelled", reason: "应用正在退出" };
  const settings = payload?.settings || {};
  const workspacePath = String(payload?.workspacePath || "").trim();
  const sessionId = String(payload?.sessionId || "").trim();
  const runId = String(payload?.runId || "").trim();
  if (!sessionId || !runId) return { ok: false, error: "任务标识无效，请新建任务后重试" };
  if (activeAgents.has(sessionId)) return { ok: false, error: "这个任务还在执行，请先停止或等待完成" };
  const abortController = new AbortController();
  const agentState = { cancelled: false, pending: new Map(), sessionId, runId, abortController };
  const sender = event.sender;
  const emit = (agentEvent) => {
    if (!sender.isDestroyed()) sender.send("agent:event", { sessionId, runId, event: agentEvent });
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
    const conversation = Array.isArray(payload?.messages) ? payload.messages : [];
    const latestUserText = String([...conversation].reverse().find((message) => message?.role === "user")?.content || "");
    const explicitMemories = extractExplicitMemoryInstructions(latestUserText);
    for (const memory of explicitMemories) {
      if (agentState.cancelled) return cancelledResponse();
      if (memory.scope === "workspace" && !workspacePath) continue;
      const record = await appendMemory(memory, workspacePath);
      if (record) emit({ type: "memory-saved", item: record });
    }
    if (agentState.cancelled) return cancelledResponse();

    if (!settings.endpoint || !settings.model || !settings.apiKey) {
      let filesNote = "";
      try {
        const entries = workspacePath ? await fs.readdir(workspacePath) : [];
        filesNote = workspacePath ? `文件列表读取正常（${entries.length} 项）。` : "还没有选择工作文件夹。";
      } catch {
        filesNote = "工作文件夹暂时无法访问。";
      }
      if (agentState.cancelled) return cancelledResponse();
      const demoResult = {
        status: "done",
        demo: true,
        finalText: `这是演示模式。我已经收到你的任务，当前工作文件夹可以正常访问。${filesNote}\n\n要让助手真正读取资料并完成任务，请在左下角“设置”中填写模型服务信息。`,
      };
      emit({ type: "agent-finished", result: demoResult });
      return { ok: true, result: demoResult };
    }
    if (!workspacePath) return { ok: false, error: "请先选择工作文件夹，助手只能在工作文件夹内操作" };

    const loop = payload?.loop?.enabled
      ? { enabled: true, iteration: 1, maximum: Math.min(Math.max(Number(payload.loop.maximum) || 5, 1), 20) }
      : { enabled: false, iteration: 1, maximum: 1 };
    const memories = await readMemories();
    const skills = await readSkills(workspacePath);
    // 每个任务结束前都做一次轻量判断；没有稳定价值的信息时不会保存。
    // 这样也覆盖同一会话切换话题的边界，不再依赖“每三轮”这种偶然触发。
    const memoryReviewDue = true;
    // 附件（图片/文本）展开为模型可读的多模态内容，与 chat:complete 同一套逻辑
    const agentConversation = await Promise.all(conversation.map(async (message) => ({
      role: message?.role,
      content: await providerMessageContent(message),
    })));
    const approvalMode = ["interactive", "deny-changes", "allow-writes", "full-access"].includes(payload?.approvalMode)
      ? payload.approvalMode
      : "interactive";
    const extraTools = agentExtraTools(await mcpExtraTools(settings));
    routeExtraTool = createExtraToolRouter(settings, workspacePath, { signal: abortController.signal });
    if (agentState.cancelled) return cancelledResponse();
    let iterationMessages = agentConversation;
    let finalResult = null;
    while (true) {
      emit({ type: "loop-state", active: loop.enabled, iteration: loop.iteration, maximum: loop.maximum, status: "正在执行" });
      const result = await runAgent({
        settings,
        workspacePath,
        contextLimit: Math.max(30000, Number(payload?.contextLimit) || 128000),
        hooks: await readHooks(workspacePath),
        goal: String(payload?.goal || "").trim().slice(0, 500),
        conversation: iterationMessages,
        memories,
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
        await appendMemory(memory, workspacePath);
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
    emit({ type: "loop-state", active: false, iteration: loop.iteration, maximum: loop.maximum, status: finalResult.status === "done" ? "已完成" : "已停止" });
    emit({ type: "agent-finished", result: finalResult });
    return { ok: true, result: finalResult };
  } catch (agentError) {
    const reason = agentError instanceof Error ? agentError.message : String(agentError);
    emit({ type: "agent-finished", result: { status: "error", finalText: "", reason } });
    return { ok: false, error: reason };
  } finally {
    routeExtraTool?.dispose();
    trackTaskEnd();
    if (activeAgents.get(sessionId) === agentState) activeAgents.delete(sessionId);
  }
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

ipcMain.handle("memories:list", () => readMemories());

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
// 运行命令、本机界面操作、浏览器变更操作永远逐次确认。

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
  const items = await readInbox();
  const item = items.find((entry) => String(entry.id) === String(id));
  if (!item || item.status !== "pending") return null;
  item.status = status;
  if (resolution) item.resolution = resolution;
  item.resolvedAt = new Date().toISOString();
  await writeInbox(items);
  broadcastInboxChanged();
  return item;
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

ipcMain.handle("inbox:list", () => readInbox());

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
  const items = await readSavedMemories();
  await writeJson(dataFile("memory.json"), items.filter((item) => String(item.id) !== String(id)));
  return { ok: true };
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

// ---- 定时计划 ----

let schedulerTimer = null;
let runningScheduledTask = false;

async function readSchedules() {
  const items = await readJson(dataFile("schedules.json"), []);
  return Array.isArray(items) ? items : [];
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

async function markScheduleFinished(id, success, summary) {
  const items = await readSchedules();
  const item = items.find((entry) => String(entry.id) === String(id));
  if (!item) return;
  const now = new Date();
  item.lastStatus = success ? "success" : "failed";
  item.lastSummary = String(summary || "").slice(0, 500);
  item.updatedAt = now.toISOString();
  if (item.recurrence === "once") item.enabled = false;
  else item.nextRun = nextOccurrence(item.recurrence, item.nextRun, now);
  await writeSchedules(items);
}

async function markScheduleSleeping(id, wake) {
  const items = await readSchedules();
  const item = items.find((entry) => String(entry.id) === String(id));
  if (!item) return;
  item.lastStatus = "sleeping";
  item.lastSummary = `已挂起，将于 ${new Date(wake.wakeAt).toLocaleString("zh-CN")} 自动唤醒继续（原因：${String(wake.reason || "").slice(0, 120)}）`;
  item.updatedAt = new Date().toISOString();
  await writeSchedules(items);
}

// ---- 自我唤醒（借鉴 openworker selfwake：agent 主动挂起,调度 tick 到点重新拉起）----
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
    approvalMode: String(approvalMode || "allow-writes"),
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
    const wakeText = `你于 ${new Date(wake.createdAt).toLocaleString("zh-CN")} 主动挂起（原因：${wake.reason}），现在到达约定时间 ${new Date(wake.wakeAt).toLocaleString("zh-CN")}，请继续完成任务。`
      + (wake.finalText ? `\n此前的进展：\n${wake.finalText}` : "");
    const collector = createTranscriptCollector();
    const approvalMode = ["interactive", "deny-changes", "allow-writes", "full-access"].includes(wake.approvalMode)
      ? wake.approvalMode
      : "allow-writes";
    const result = await runAgent({
      settings,
      workspacePath: wake.workspacePath,
      hooks: await readHooks(wake.workspacePath),
      conversation: [...prior, { role: "user", content: wakeText }],
      memories: await readMemories(),
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
      // 续跑同样无人值守：审批与提问进收件箱挂起等待
      requestApproval: async (action) => {
        const resolution = await createInboxItem({
          kind: "approval",
          sessionId: wake.sessionId,
          scheduleId: wake.scheduleId,
          tool: action.kind,
          title: `续跑任务申请：${action.title || action.kind}`,
          details: action.details,
        });
        return Boolean(resolution?.ok);
      },
      requestUserInput: (request) => createInboxItem({
        kind: "question",
        sessionId: wake.sessionId,
        scheduleId: wake.scheduleId,
        question: request.question,
        options: request.options,
        title: "续跑任务提问",
      }),
      emit: (agentEvent) => {
        collector.handle(agentEvent);
        if (agentEvent?.type === "skill-saved") void appendSkill(agentEvent.item);
        if (agentEvent?.type === "token-usage") void appendUsageStat(agentEvent);
      },
    });
    for (const memory of memoriesFromAgentResult(result)) await appendMemory(memory, wake.workspacePath);
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
      if (wake.scheduleId) await markScheduleSleeping(wake.scheduleId, result.wake);
    } else if (wake.scheduleId) {
      await markScheduleFinished(wake.scheduleId, result.status === "done", result.finalText || result.reason || "没有产出结果");
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      const content = result.status === "sleeping" && result.wake
        ? `${result.finalText || ""}\n\n已再次挂起，将于 ${new Date(result.wake.wakeAt).toLocaleString("zh-CN")} 自动唤醒继续（原因：${result.wake.reason}）。`.trim()
        : undefined;
      mainWindow.webContents.send("sessions:append", {
        sessionId: wake.sessionId,
        workspacePath: wake.workspacePath,
        messages: collector.buildMessages(`（到点自动唤醒）${wakeText}`, result, content),
      });
    }
  } catch (error) {
    if (wake.scheduleId) {
      await markScheduleFinished(wake.scheduleId, false, error instanceof Error ? error.message : String(error));
    }
  } finally {
    routeExtraTool?.dispose();
    trackTaskEnd();
    runningScheduledTask = false;
  }
}

async function checkDueWakes() {
  if (mcpShuttingDown || runningScheduledTask || runningChannelTask || activeAgents.size) return;
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
      }
    },
    buildMessages(userText, result, assistantContent) {
      return [
        { role: "user", content: userText, createdAt: new Date(startedAt).toISOString() },
        {
          role: "assistant",
          content: assistantContent ?? (result.finalText || result.reason || "（没有产出内容）"),
          createdAt: new Date().toISOString(),
          activities: activities.map((item) => ({ ...item })),
          durationMs: Date.now() - startedAt,
          ...(changes?.length ? { changes: changes.map((item) => ({ ...item })) } : {}),
          ...(plan?.length ? { plan: plan.map((item) => ({ ...item })) } : {}),
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
      memories: await readMemories(),
      memoryReviewDue: true,
      skills: await readSkills(record.workspacePath),
      history: { search: searchHistory, readContext: readHistoryContext },
      approvalMode: record.allowWorkspaceWrites ? "allow-writes" : "deny-changes",
      standingRules: await readStandingRules(),
      audit: (entry) => auditLog.record({ ...entry, sessionId: scheduleSessionId, approvalMode: record.allowWorkspaceWrites ? "allow-writes" : "deny-changes" }),
      extraTools: agentExtraTools(await mcpExtraTools(settings)),
      onExtraTool: routeExtraTool,
      isCancelled: () => mcpShuttingDown,
      sleepGuard: () => hasPendingWakeForSession(scheduleSessionId),
      // 无人值守：需要确认的操作与提问不再静默失败，改为进审批收件箱，任务挂起等待处理
      requestApproval: async (action) => {
        const resolution = await createInboxItem({
          kind: "approval",
          sessionId: scheduleSessionId,
          scheduleId: record.id,
          tool: action.kind,
          title: `定时任务「${record.name || "未命名"}」申请：${action.title || action.kind}`,
          details: action.details,
        });
        return Boolean(resolution?.ok);
      },
      requestUserInput: (request) => createInboxItem({
        kind: "question",
        sessionId: scheduleSessionId,
        scheduleId: record.id,
        question: request.question,
        options: request.options,
        title: `定时任务「${record.name || "未命名"}」提问`,
      }),
      emit: (agentEvent) => {
        collector.handle(agentEvent);
        if (agentEvent?.type === "skill-saved") void appendSkill(agentEvent.item);
        if (agentEvent?.type === "token-usage") void appendUsageStat(agentEvent);
      },
    });
    for (const memory of memoriesFromAgentResult(result)) await appendMemory(memory, record.workspacePath);
    if (result.status === "sleeping" && result.wake) {
      // 主动挂起：登记唤醒记录,本次不结算计划,到点由 checkDueWakes 续跑
      await registerWake({
        sessionId: scheduleSessionId,
        scheduleId: record.id,
        workspacePath: record.workspacePath,
        approvalMode: record.allowWorkspaceWrites ? "allow-writes" : "deny-changes",
        wake: result.wake,
        prompt: record.prompt,
        finalText: result.finalText,
      });
      await markScheduleSleeping(record.id, result.wake);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("sessions:prepend", {
          id: scheduleSessionId,
          title: `计划：${String(record.name || "未命名").slice(0, 24)}`,
          workspacePath: record.workspacePath,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: collector.buildMessages(
            record.prompt,
            result,
            `${result.finalText || ""}\n\n已主动挂起，将于 ${new Date(result.wake.wakeAt).toLocaleString("zh-CN")} 自动唤醒继续（原因：${result.wake.reason}）。`.trim(),
          ),
        });
      }
      return;
    }
    await markScheduleFinished(record.id, result.status === "done", result.finalText || result.reason || "没有产出结果");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("sessions:prepend", {
        id: scheduleSessionId,
        title: `计划：${String(record.name || "未命名").slice(0, 24)}`,
        workspacePath: record.workspacePath,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: collector.buildMessages(record.prompt, result),
      });
    }
  } catch (error) {
    await markScheduleFinished(record.id, false, error instanceof Error ? error.message : String(error));
  } finally {
    routeExtraTool?.dispose();
    trackTaskEnd();
    runningScheduledTask = false;
    broadcastSchedulesChanged();
  }
}

async function checkDueSchedules() {
  if (mcpShuttingDown || runningScheduledTask || runningChannelTask || activeAgents.size) return;
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
let runningChannelTask = false;

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

function broadcastChannelsStatus(statusMap) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("channels:status", statusMap);
  }
}

// 渠道会话的工作区推导:与 app:initial-state 同款,取最近一个带工作区的会话
async function defaultChannelWorkspace() {
  const sessions = await readJson(dataFile("sessions.json"), []);
  return (Array.isArray(sessions) ? sessions : []).find((session) => session?.workspacePath)?.workspacePath || "";
}

const channelManager = createChannelManager({
  readChats: readChannelChats,
  writeChats: (chats) => writeJson(dataFile("channel-chats.json"), chats),
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
  defaultWorkspace: defaultChannelWorkspace,
});

async function reconcileChannels() {
  const settings = await readSettings();
  const wechatCredentials = settings.channels?.wechat?.enabled ? await readWechatCredentials() : {};
  await channelManager.reconcile({
    qq: settings.channels?.qq || {},
    wechat: { ...(settings.channels?.wechat || {}), ...wechatCredentials },
  });
}

// 一条 IM 消息驱动的完整任务(范本:runScheduledTask)
async function runChannelTask({ channel, chat, text, chatRecord, isNewChat, reply, registerPending, clearPending }) {
  // 渠道消息不可丢弃:桌面交互任务/定时任务执行期间,排队等待全局空闲
  while (!mcpShuttingDown && (activeAgents.size || runningScheduledTask || runningChannelTask)) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (mcpShuttingDown) return;
  runningChannelTask = true;
  trackTaskStart();
  let routeExtraTool = null;
  const channelLabel = CHANNEL_LABELS[channel] || channel;
  const sessionId = chatRecord.sessionId;
  const workspacePath = String(chatRecord.workspacePath || "");
  const userText = `[来自${channelLabel}${chat.userName ? ` ${chat.userName}` : ""}] ${text}`;
  // 会话立即出现在列表里(先发用户消息,失败也留痕),助手结果随后追加
  const userMessage = { role: "user", content: userText, createdAt: new Date().toISOString() };
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
  // 完成/挂起时只追加助手消息(buildMessages 的 [user, assistant] 里 user 已经上过屏)
  const sendAssistantMessages = (messages) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("sessions:append", { sessionId, workspacePath, channel, messages });
  };
  try {
    sendUserMessage();
    const settings = await readSettings();
    // 渠道任务模型:默认跟随当前模型,可在渠道设置里固定为某个模型档案
    const profileId = String(settings.channels?.modelProfileId || "");
    const profile = profileId ? (settings.profiles || []).find((item) => item.id === profileId) : null;
    const taskSettings = profile
      ? { ...settings, endpoint: profile.endpoint, model: profile.model, apiKey: profile.apiKey }
      : settings;
    if (!taskSettings.endpoint || !taskSettings.model || !taskSettings.apiKey) {
      throw new Error("模型还没有配置,请先在电脑端完成设置");
    }
    if (!workspacePath) {
      throw new Error("还没有选择工作区,请先在电脑端打开 DyWork 并选择工作区");
    }
    // 渠道审批严格度:默认省心(allow-writes,搜索/读写自动放行),可在渠道设置切严格
    const approvalMode = settings.channels?.approvalMode === "interactive" ? "interactive" : "allow-writes";
    routeExtraTool = createExtraToolRouter(taskSettings, workspacePath);
    const collector = createTranscriptCollector();
    const prior = await visibleConversationForSession(sessionId, "", "");
    await reply("收到,正在处理…").catch(() => { });
    const result = await runAgent({
      settings: taskSettings,
      workspacePath,
      hooks: await readHooks(workspacePath),
      conversation: [...prior, { role: "user", content: userText }],
      memories: await readMemories(),
      memoryReviewDue: true,
      skills: await readSkills(workspacePath),
      history: { search: searchHistory, readContext: readHistoryContext },
      approvalMode,
      standingRules: await readStandingRules(),
      audit: (entry) => auditLog.record({ ...entry, sessionId, approvalMode, channel }),
      extraTools: agentExtraTools(await mcpExtraTools(taskSettings)),
      onExtraTool: routeExtraTool,
      isCancelled: () => mcpShuttingDown,
      sleepGuard: () => hasPendingWakeForSession(sessionId),
      // 审批:收件箱(桌面可决议)+ IM 卡片(回复 允许/拒绝 决议),两侧共用 resolveInboxInternal
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
          `⚠️ 需要审批\n${action.title || action.kind}\n${String(action.details || "").slice(0, 400)}\n\n回复「允许」执行,回复「拒绝」取消。`.trim(),
        ).catch(() => { });
        const resolution = await pending;
        clearPending();
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
        await reply(`❓ ${request.question}${optionsText ? `\n\n${optionsText}\n回复序号或直接回答。` : ""}`).catch(() => { });
        const resolution = await pending;
        clearPending();
        return resolution;
      },
      emit: (agentEvent) => {
        collector.handle(agentEvent);
        if (agentEvent?.type === "skill-saved") void appendSkill(agentEvent.item);
        if (agentEvent?.type === "token-usage") void appendUsageStat(agentEvent);
      },
    });
    for (const memory of memoriesFromAgentResult(result)) await appendMemory(memory, workspacePath);
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
      return;
    }
    const finalText = result.finalText || result.reason || "没有产出结果";
    await reply(finalText).catch(() => { });
    sendAssistantMessages(collector.buildMessages(userText, result).slice(1));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // IM 侧给简明原因(截掉原始 JSON/堆栈),完整信息留在桌面会话里
    const friendly = (message.replace(/\s*[{[].*$/s, "") || message).slice(0, 200);
    await reply(`出错了:${friendly}`).catch(() => { });
    sendAssistantMessages([{ role: "assistant", content: `出错了:${message}`, createdAt: new Date().toISOString() }]);
  } finally {
    routeExtraTool?.dispose();
    clearPending();
    trackTaskEnd();
    runningChannelTask = false;
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
  const storedSettings = await readSettings();
  sleepBlockMode = storedSettings.preventSleep;
  updateSleepBlocker();
  createWindow();
  await expireOrphanedInboxItems();
  startScheduler();
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
