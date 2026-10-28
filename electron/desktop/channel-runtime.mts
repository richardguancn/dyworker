// 从桌面入口拆出的渠道任务执行与媒体处理。
import { promises as fs } from "node:fs";
import path from "node:path";
import { CHANNEL_LABELS } from "../channels/manager.mts";
import { CHANNEL_MEDIA_EXTENSIONS,channelMediaToolDefinitions,MAX_MEDIA_BYTES,mediaKindForExtension,verifyChannelMediaPath } from "../channels/media-tools.mts";
import { formatChannelApproval } from "../channels/shared.mts";
import { isWorkspaceSwitchRequest,looksLikePathDirective,parseWorkspaceSwitch,resolveWorkspaceSwitch } from "../channels/workspace.mts";
import { hasConfiguredModel } from "../host/dsh-runtime/model-settings.mts";
import { mergeDshTranscript } from '../host/dsh-runtime/presentation.mts';
import { synthesizeWithLocalTts } from "../local-tts-engine.mts";
import { settingsForSession } from "../session-model.mts";
import { normalizeApprovalMode,normalizeTtsEngine } from "../settings.mts";
import { taskResultText } from "../task-result.mts";

export function createChannelRuntime(deps: {
  describeAttachment: (...args: any[]) => Promise<any>;
  readSettings: (...args: any[]) => Promise<any>;
  readChannelChats: (...args: any[]) => Promise<any>;
  writeJson: (...args: any[]) => Promise<any>;
  dataFile: (name: string) => string;
  channelDebug: (...args: any[]) => void;
  channelTaskKeys: Set<string>;
  defaultChannelWorkspace: () => Promise<string>;
  mcpShuttingDown: boolean;
  channelTaskAborts: Set<string>;
  workspaceBlockers: (...args: any[]) => any;
  activeAgents: Map<string, any>;
  ctx: any;
  runningChannelTaskCount: number;
  trackTaskStart: (...args: any[]) => void;
  entryRuns: Map<string, any>;
  mainWindow: import("electron").BrowserWindow | null;
  CHANNEL_STREAM_EVENT_TYPES: Set<string>;
  transcribeQqVoice: (...args: any[]) => Promise<any>;
  visibleConversationForSession: (...args: any[]) => Promise<any>;
  createExtraToolRouter: (...args: any[]) => any;
  createTranscriptCollector: (...args: any[]) => any;
  workingContextForSession: (...args: any[]) => Promise<any>;
  providerMessageContent: (...args: any[]) => Promise<any>;
  trackTaskEnd: (...args: any[]) => void;
  drainSessionQueue: (...args: any[]) => void;
}) {
  const { describeAttachment, readSettings, readChannelChats, writeJson, dataFile, channelDebug, defaultChannelWorkspace, workspaceBlockers, trackTaskStart, transcribeQqVoice, visibleConversationForSession, createExtraToolRouter, createTranscriptCollector, workingContextForSession, providerMessageContent, trackTaskEnd, drainSessionQueue } = deps;


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

// 渠道消息等待同一工作区空闲的上限：同工作区的头部任务长时间不结束时，
// 排在后面的消息不能无限堆积（否则用户只会看到“排队数+1”而没有任何任务被执行）。
const CHANNEL_QUEUE_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
// 被同一工作区的任务挡住时，超过这么久就先回一条说明，避免用户无声干等
const CHANNEL_WAIT_NOTICE_DELAY_MS = 5000;

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
  deps.channelTaskKeys.add(myKey);
  const taskStartedAt = Date.now();
  channelDebug("渠道任务启动", {
    chatKey: myKey,
    text: String(text || "").slice(0, 80),
    messageId: String(chat?.messageId || ""),
    isNewChat,
  });
  // 渠道消息不可丢弃，但只等「同一工作区」的任务：不同工作区互不阻塞。
  // 等待期间也要响应「停止」,否则会堵在守卫里无法中止。
  // 等待本身保留上限：同工作区头部任务若长时间不结束（网络/模型/审批等），
  // 后面的消息不能无限排队，否则用户只会看到“排队数+1”而没有任何任务被执行。
  // 双保险:manager 侧已修复历史脏数据,这里对非字符串值再做兜底重新推导
  const storedWorkspace = typeof chatRecord.workspacePath === "string" ? chatRecord.workspacePath.trim() : "";
  let workspacePath = storedWorkspace || await defaultChannelWorkspace();
  const sessionId = chatRecord.sessionId;
  const waitStartedAt = Date.now();
  let waitNotified = false;
  while (!deps.mcpShuttingDown && !deps.channelTaskAborts.has(myKey)) {
    const blockers = workspaceBlockers(workspacePath, sessionId);
    if (!blockers.length) break;
    // 只有 position>1 才会收到「排队中」提示；被同一工作区的他人任务挡住时 position 是 1，
    // 用户此前完全收不到反馈、只能干等到超时被取消，这里补一条一次性说明。
    if (!waitNotified && Date.now() - waitStartedAt >= CHANNEL_WAIT_NOTICE_DELAY_MS) {
      waitNotified = true;
      await reply(`已收到，正在等同一工作目录下的${blockers[0].kind}结束，它结束后会自动开始，无需重发；回复「停止」可取消。`).catch(() => { });
    }
    await new Promise<any>((resolve) => setTimeout(resolve, 2000));
    if (!deps.mcpShuttingDown && !deps.channelTaskAborts.has(myKey) && Date.now() - waitStartedAt > CHANNEL_QUEUE_WAIT_TIMEOUT_MS) {
      channelDebug("渠道任务等待超时已跳过", {
        chatKey: myKey,
        text: String(text || "").slice(0, 80),
        workspacePath,
        blockers: blockers.map((item) => item.kind),
        activeAgents: deps.activeAgents.size,
        runningScheduledTask: deps.ctx.scheduler.running,
        runningChannelTaskCount: deps.runningChannelTaskCount,
        waitMs: Date.now() - waitStartedAt,
      });
      await reply("这条消息等同一工作目录下的任务结束已超过 10 分钟，为避免一直阻塞后续消息，已取消这条。可以先停掉那个任务，或更换工作目录（回复「更换工作目录至…」）后重发。").catch(() => { });
      deps.channelTaskKeys.delete(myKey);
      deps.channelTaskAborts.delete(myKey);
      return;
    }
  }
  if (deps.mcpShuttingDown || deps.channelTaskAborts.has(myKey)) {
    channelDebug("渠道任务未执行已退出", { chatKey: myKey, text: String(text || "").slice(0, 80) });
    deps.channelTaskKeys.delete(myKey);
    deps.channelTaskAborts.delete(myKey);
    return;
  }
  deps.runningChannelTaskCount += 1;
  trackTaskStart();
  // 本次渠道任务的运行 id：实时转发的 agent:event 信封与收尾 sessions:append 都带它，
  // 渲染端据此区分渠道运行与桌面运行（防重复气泡），并把收尾消息替换进流式占位气泡。
  const channelRunId = crypto.randomUUID();
  if (Date.now() - taskStartedAt > 2000) {
    channelDebug("渠道任务开始执行", {
      chatKey: myKey,
      text: String(text || "").slice(0, 80),
      waitedMs: Date.now() - taskStartedAt,
      activeAgents: deps.activeAgents.size,
      runningScheduledTask: deps.ctx.scheduler.running,
      runningChannelTaskCount: deps.runningChannelTaskCount,
    });
  }
  const channelLabel = CHANNEL_LABELS[channel] || channel;
  // 出站媒体登记（send_media / text_to_speech 工具写入，任务结束随最终回复发回）
  const pendingMedia = [];
  // 会话立即出现在列表里(先发用户消息,失败也留痕),助手结果随后追加。
  // userMessage 构造需要等待附件信息，放在 try 内完成（语音转写也改变文本内容）。
  let userText = "";
  let userMessage = null;
  let channelRuntime;
  const channelAbort = new AbortController();
  deps.entryRuns.set(sessionId,{runId:channelRunId,abort:channelAbort,chatKey:myKey,kind:"渠道任务",workspacePath});
  const sendUserMessage = () => {
    if (!deps.mainWindow || deps.mainWindow.isDestroyed()) return;
    if (isNewChat) {
      deps.mainWindow.webContents.send("sessions:prepend", {
        id: sessionId,
        title: String(chatRecord.title || `${channelLabel}消息`).slice(0, 40),
        workspacePath,
        channel,runtime:channelRuntime,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [userMessage],
      });
    } else {
      deps.mainWindow.webContents.send("sessions:append", { sessionId, workspacePath, channel, messages: [userMessage] });
    }
  };
  // 完成/挂起时只追加助手消息(buildMessages 的 [user, assistant] 里 user 已经上过屏)。
  // 带 runId：渲染端若已有本 run 的流式占位气泡则原位替换，而不是追加第二条。
  const sendAssistantMessages = async (messages) => {
    const saved=await deps.ctx.sessions.getAsync(sessionId) || {id:sessionId,channel,title:String(chatRecord.title || `${channelLabel}消息`).slice(0,40),workspacePath,
      createdAt:new Date().toISOString(),messages:userMessage ? [userMessage] : []};
    await deps.ctx.sessions.replace({...saved,workspacePath,runtime:channelRuntime || saved.runtime || 'dyworker',
      messages:mergeDshTranscript(saved.messages || [],messages),updatedAt:new Date().toISOString()});
    if (!deps.mainWindow || deps.mainWindow.isDestroyed()) return;
    const transcript = messages.some(message=>message.dshTurnId) ? messages : messages.filter(message=>message.role!=='user');
    deps.mainWindow.webContents.send("sessions:append", { sessionId, workspacePath, channel, runId: channelRunId, messages:transcript });
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
    if (!deps.mainWindow || deps.mainWindow.isDestroyed()) return;
    if (!deps.CHANNEL_STREAM_EVENT_TYPES.has(agentEvent?.type)) return;
    deps.mainWindow.webContents.send("agent:event", { sessionId, runId: channelRunId, channelRun: true, event: agentEvent });
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
          // 本 run 的占用记录同步换工作区，否则后续渠道消息仍按旧目录判忙
          const ownRun = deps.entryRuns.get(sessionId);
          if (ownRun) ownRun.workspacePath = workspacePath;
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
        await sendAssistantMessages([switchMessage]);
        await reply(switchText).catch(() => { });
        return;
      }
    }
    const settings = await readSettings();
    // 已有会话保留自己的模型；新渠道会话使用渠道默认配置。
    const profileId = String(settings.channels?.modelProfileId || "");
    const profile = profileId ? (settings.profiles || []).find((item) => item.id === profileId) : null;
    const taskSettings = settingsForSession(profile
      ? { ...settings, endpoint: profile.endpoint, model: profile.model, apiKey: profile.apiKey, reasoningEffort: profile.reasoningEffort || "" }
      : settings, await deps.ctx.sessions.getAsync(sessionId));
    if (!hasConfiguredModel(taskSettings)) {
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
    const prior = await visibleConversationForSession(sessionId, "", "");
    const storedSession = await deps.ctx.sessions.getAsync(sessionId);
    channelRuntime = settings.channels?.runtime || storedSession?.runtime || 'dyworker';
    // 入站媒体 → 桌面附件（缩略图/文件名）；模型可见内容由 providerMessageContent 展开
    const attachments = await buildChannelAttachments(media);
    userText = `[来自${channelLabel}${chat.userName ? ` ${chat.userName}` : ""}] ${effectiveText}`;
    userMessage = {
      id:`${channelRunId}:user`,runId:channelRunId,
      role: "user",
      content: userText,
      createdAt: new Date().toISOString(),
      ...(attachments.length ? { attachments } : {}),
    };
    const now=new Date().toISOString();
    await deps.ctx.sessions.replace({...storedSession,id:sessionId,runtime:channelRuntime,channel,
      title:storedSession?.title || String(chatRecord.title || `${channelLabel}消息`).slice(0,40),workspacePath,
      createdAt:storedSession?.createdAt || now,updatedAt:now,messages:[...(storedSession?.messages || []),userMessage]});
    sendUserMessage();
    // 渠道任务与桌面会话保持统一的审批权限（使用全局设置/桌面当前选择的审批模式）
    const approvalMode = normalizeApprovalMode(settings?.approvalMode);
    let routerExecution: any = { sessionId, runId: channelRunId };
    let baseRouter = createExtraToolRouter(taskSettings, workspacePath, routerExecution);
    // send_media / text_to_speech / switch_workspace 先由渠道处理器接管，其余交给现有 MCP/浏览器路由
    const routeExtraTool = async (name, args) => {
      if (name === "send_media") return handleChannelSendMedia(args, { workspacePath, pendingMedia });
      if (name === "text_to_speech") return handleChannelTextToSpeech(args, { workspacePath, pendingMedia, settings: taskSettings });
      if (name === "switch_workspace") {
        const result = await handleChannelSwitchWorkspace(args, { chatRecord, chatKey: myKey, workspacePath, userText: text });
        if (result.ok) {
          // 后续工具与本次任务收尾都用新目录；浏览器/MCP 路由也切到新工作区
          workspacePath = result.path;
          await baseRouter.dispose();
          baseRouter = createExtraToolRouter(taskSettings, workspacePath, routerExecution);
          routeExtraTool.dispose = () => baseRouter.dispose();
        }
        return result;
      }
      return baseRouter(name, args);
    };
    routeExtraTool.dispose = () => baseRouter.dispose();
    routeExtraTool.setExecutionContext = (execution: any) => {
      routerExecution = { ...execution, sessionId, runId: channelRunId };
      baseRouter = createExtraToolRouter(taskSettings, workspacePath, routerExecution);
    };
    const collector = createTranscriptCollector({runId:channelRunId,userMessage});
    const workingContext = await workingContextForSession(sessionId);
    // 模型可见内容：文本 + 图片块（复用桌面端 providerMessageContent）
    const contentForModel = await providerMessageContent({ content: userText, attachments });
    // 用「正在输入」状态提示处理中，不再以文字消息形式打扰
    await sendTyping().catch(() => { });
    forwardChannelEvent({type:"queue-start",count:0});
    const result = await deps.ctx.agent.run({
      runtime:channelRuntime,runId:channelRunId,signal:channelAbort.signal,
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
      isCancelled: () => deps.channelTaskAborts.has(myKey) || channelAbort.signal.aborted,
      // 审批:收件箱(桌面可决议)+ IM 卡片(回复 允许/拒绝 决议),两侧共用 resolveInboxInternal
      // 等待有 10 分钟上限：超时按拒绝处理，避免渠道队列头部永久悬死
      requestApproval: async (action, approvalSignal?: AbortSignal) => {
        const pending = deps.ctx.inbox.create({
          kind: "approval",
          sessionId,
          tool: action.kind,
          title: `${channelLabel}消息申请：${action.title || action.kind}`,
          details: action.details,
          impact: action.impact,
        }, {signal: approvalSignal ? AbortSignal.any([approvalSignal, channelAbort.signal]) : channelAbort.signal});
        registerPending({ itemId: pending.itemId, kind: "approval" });
        await reply(formatChannelApproval(action)).catch(() => { });
        const resolution = await deps.ctx.inbox.awaitWithTimeout(pending, "审批等待超时，已自动取消");
        clearPending();
        if (resolution?.timedOut) {
          await reply("审批等待超时，已自动取消这次操作。").catch(() => { });
        } else if (resolution?.reason && String(resolution.reason).includes("权限已更新")) {
          // 审批权限被调宽后这张卡已按新权限撤回并继续执行；不告知的话用户会继续去回
          // 一张已经作废的审批卡，然后被「请先回复 1」拦住。
          await reply("审批权限已更新，这次操作不用再确认了，任务继续。").catch(() => { });
        }
        return Boolean(resolution?.ok);
      },
      requestUserInput: async (request, questionSignal?: AbortSignal) => {
        const pending = deps.ctx.inbox.create({
          kind: "question",
          sessionId,
          question: request.question,
          options: request.options,
          title: `${channelLabel}消息提问`,
          questionPresentation: request.answerFormat === 'dsh' ? request : undefined,
        }, { signal: questionSignal ? AbortSignal.any([questionSignal,channelAbort.signal]) : channelAbort.signal });
        registerPending({ itemId: pending.itemId, kind: "question", options: request.options || [] });
        const optionsText = (request.options || []).map((option, index) => `${index + 1}. ${option}${request.optionDescriptions?.[index] ? `：${request.optionDescriptions[index]}` : ''}`).join("\n");
        await reply(`❓ ${request.question}${request.detail ? `\n\n${request.detail}` : ''}${optionsText ? `\n\n${optionsText}\n${request.multiSelect ? '多项选择请打开桌面的任务提问卡；也可以在这里直接补充文字回答。' : '回复序号或直接回答。'}` : ""}\n10 分钟未回复将按已有信息继续。`.trim()).catch(() => { });
        const resolution = await deps.ctx.inbox.awaitWithTimeout(pending, "提问等待超时，按已有信息继续");
        clearPending();
        return resolution;
      },
      emit: (agentEvent) => {
        collector.handle(agentEvent);
        forwardChannelEvent(agentEvent);
      },
    });
    if (deps.channelTaskAborts.has(myKey) || result.status === "cancelled") {
      // 「停止」指令已经回复过,这里只把半截结果留痕到桌面会话,不再发 IM 最终结果。
      // 半截正文保留在留痕里（与桌面端"已按你的要求停止"同口径），用户不至于丢失已生成的内容。
      const partial = String(result.finalText || "").trim();
      const stopNote = deps.channelTaskAborts.has(myKey) ? "（用户通过渠道消息停止了任务）" : "已按你的要求停止。";
      const cancelledContent = partial ? `${partial}\n\n${stopNote}` : stopNote;
      await sendAssistantMessages(collector.buildMessages(userText, { ...result, status: "cancelled" }, cancelledContent));
      // 收尾事件：渲染端据此清掉运行标记（正常完成路径在 reply 之后同样会发）
      forwardChannelEvent({
        type: "agent-finished",
        result: { ...result, status: "cancelled", finalText: result.finalText || "", durationMs: Date.now() - taskStartedAt },
      });
      return;
    }
    if (result.status === "sleeping" && result.wake) {
      // 主动挂起:沿用 self-wake 机制,到点由 checkDueWakes 续跑(审批走收件箱)
      await deps.ctx.scheduler.registerWake({
        sessionId,
        workspacePath,
        approvalMode,
        wake: result.wake,
        prompt: text,
        finalText: result.finalText,
      });
      const note = `已主动挂起,将于 ${new Date(result.wake.wakeAt).toLocaleString("zh-CN")} 自动继续(原因:${result.wake.reason})。`;
      await reply(note).catch(() => { });
      await sendAssistantMessages(collector.buildMessages(userText, result, `${result.finalText || ""}\n\n${note}`.trim()));
      // 挂起同样是本轮收尾：渲染端清掉运行标记,到点续跑由调度路径另行起会话
      forwardChannelEvent({
        type: "agent-finished",
        result: { ...result, status: "sleeping", finalText: result.finalText || "", wake: result.wake, durationMs: Date.now() - taskStartedAt },
      });
      return;
    }
    const finalText = taskResultText(result, "", "没有产出结果");
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
      if (outboundAttachments.length) (built.at(-1) as any).attachments = outboundAttachments;
      await sendAssistantMessages(built);
    } else {
      await reply(finalText).catch(() => { });
      await sendAssistantMessages(collector.buildMessages(userText, result));
    }
    // 通知渲染端本轮渠道任务已结束：渲染端据此给流式气泡打上最终状态、清掉运行标记。
    // 结果体带 plan/changes/durationMs，渲染端用它把已实时展示的 assistant 消息收口为最终形态。
    forwardChannelEvent({
      type: "agent-finished",
      result: {
        ...result, status: result.status,
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
    await sendAssistantMessages([{ role: "assistant", content: `出错了:${message}`, createdAt: new Date().toISOString() }]);
    forwardChannelEvent({
      type: "agent-finished",
      result: { status: "error", reason: message, durationMs: Date.now() - taskStartedAt },
    });
  } finally {
    clearPending();
    trackTaskEnd();
    deps.entryRuns.delete(sessionId);
    drainSessionQueue(sessionId);
    deps.runningChannelTaskCount = Math.max(0, deps.runningChannelTaskCount - 1);
    deps.channelTaskKeys.delete(myKey);
    deps.channelTaskAborts.delete(myKey);
    channelDebug("渠道任务结束", {
      chatKey: myKey,
      text: String(text || "").slice(0, 80),
      durationMs: Date.now() - taskStartedAt,
      runningChannelTaskCount: deps.runningChannelTaskCount,
    });
  }
}
  return { runChannelTask };
}
