import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 统一读成 LF，避免 Windows 检出 CRLF 时多行正则失效。
const readSource = (url) => fs.readFileSync(url, "utf8").replace(/\r\n/g, "\n");

const app = readSource(new URL("../src/App.tsx", import.meta.url));
const interactiveMessage = readSource(new URL("../src/InteractiveMessage.tsx", import.meta.url));
const preload = readSource(new URL("../electron/preload.cjs", import.meta.url));
const main = readSource(new URL("../electron/main.mjs", import.meta.url));
const agent = readSource(new URL("../electron/agent.mjs", import.meta.url));
const browserSource = readSource(new URL("../electron/browser.mjs", import.meta.url));
const browserImport = readSource(new URL("../electron/browser-import.mjs", import.meta.url));
const localstorageImport = readSource(new URL("../electron/localstorage-import.mjs", import.meta.url));
const linuxComputerUseSource = readSource(new URL("../electron/linux-computer-use-server.mjs", import.meta.url));
const settingsStorage = readSource(new URL("../electron/settings.mjs", import.meta.url));
const appUpdater = readSource(new URL("../electron/app-updater.mjs", import.meta.url));
const releaseWorkflow = readSource(new URL("../.github/workflows/release.yml", import.meta.url));
const afterPack = readSource(new URL("../build/afterPack.cjs", import.meta.url));
const packageJson = readSource(new URL("../package.json", import.meta.url));
const providers = readSource(new URL("../src/providers.ts", import.meta.url));
const types = readSource(new URL("../src/types.ts", import.meta.url));
const styles = readSource(new URL("../src/styles.css", import.meta.url));
const html = readSource(new URL("../index.html", import.meta.url));

test("desktop controls are connected across renderer, preload, and main process", () => {
  for (const action of ["chooseAttachments", "saveClipboardImage", "readClipboardText", "writeClipboardText", "transcribeAudio"]) {
    assert.match(app, new RegExp(`dyworker\\.${action}`));
    assert.match(preload, new RegExp(`${action}:`));
  }
  assert.match(main, /ipcMain\.handle\("attachments:choose"/);
  assert.match(main, /ipcMain\.handle\("attachments:save-clipboard-image"/);
  assert.match(main, /ipcMain\.handle\("clipboard:read-text"/);
  assert.match(main, /ipcMain\.handle\("clipboard:write-text"/);
  assert.match(main, /ipcMain\.handle\("voice:transcribe"/);
});

test("内置本地审核模型的下载与进度链路贯穿三端", () => {
  for (const action of ["getReviewerLocalStatus", "downloadReviewerLocalModel", "chooseReviewerLocalDir", "onReviewerLocalDownloadProgress"]) {
    assert.match(app, new RegExp(`dyworker\\??\\.${action}`));
    assert.match(preload, new RegExp(`${action}:`));
  }
  assert.match(main, /ipcMain\.handle\("reviewer-local:status"/);
  assert.match(main, /ipcMain\.handle\("reviewer-local:download"/);
  assert.match(main, /ipcMain\.handle\("reviewer-local:choose-dir"/);
  assert.match(main, /reviewer-local:download-progress/);
  assert.match(main, /configureLocalReviewer\(/);
  assert.match(main, /applyReviewerModelDir\(/);
  assert.match(main, /resetLocalReviewerEngine\(\)/);
});

test("本地语音转写引擎（Qwen3-ASR）的下载、设置与转写链路贯穿三端", () => {
  for (const action of ["getVoiceLocalStatus", "downloadVoiceLocalModel", "chooseVoiceLocalDir", "onVoiceLocalDownloadProgress"]) {
    assert.match(app, new RegExp(`dyworker\\??\\.${action}`));
    assert.match(preload, new RegExp(`${action}:`));
  }
  assert.match(main, /ipcMain\.handle\("voice-local:status"/);
  assert.match(main, /ipcMain\.handle\("voice-local:download"/);
  assert.match(main, /ipcMain\.handle\("voice-local:choose-dir"/);
  assert.match(main, /voice-local:download-progress/);
  // 转写主链路：本地引擎分支走 transcribeWithLocalAsr，云引擎保持原路径
  assert.match(main, /transcriptionEngine.*===.*"local"/);
  assert.match(main, /transcribeWithLocalAsr\(/);
  // 模型目录与审核模型同款策略：读取与保存设置时即时应用，下载前先落最新目录
  assert.match(main, /applyAsrSettings\(settings\)/);
  // 渲染端本地引擎把录音转成 16k 单声道 WAV；引擎选择与下载入口在设置里
  assert.match(app, /blobToWav16kMono/);
  assert.match(app, /transcriptionEngine === "local"/);
  assert.match(app, /downloadVoiceLocalModel/);
  assert.match(settingsStorage, /normalizeTranscriptionEngine/);
  // 输入框里有语音输入开关，接通 toggleVoiceInput，并带录音/转写状态样式
  assert.match(app, /onClick=\{\(\) => void toggleVoiceInput\(\)\}/);
  assert.match(app, /voice-button \$\{voiceState === "recording" \? "recording" : ""\}/);
});

test("本地语音合成引擎（Qwen3-TTS）的下载、设置与合成链路贯穿三端", () => {
  for (const action of ["getTtsLocalStatus", "downloadTtsLocalModel", "chooseTtsLocalDir", "chooseTtsVoice", "onTtsLocalDownloadProgress"]) {
    assert.match(app, new RegExp(`dyworker\\??\\.${action}`));
    assert.match(preload, new RegExp(`${action}:`));
  }
  assert.match(main, /ipcMain\.handle\("tts-local:status"/);
  assert.match(main, /ipcMain\.handle\("tts-local:download"/);
  assert.match(main, /ipcMain\.handle\("tts-local:choose-dir"/);
  assert.match(main, /ipcMain\.handle\("tts-local:choose-voice"/);
  assert.match(main, /tts-local:download-progress/);
  // 合成主链路：本地引擎分支走 synthesizeWithLocalTts，云引擎保持原 /audio/speech 路径
  assert.match(main, /normalizeTtsEngine/);
  assert.match(main, /synthesizeWithLocalTts\(/);
  assert.match(main, /applyTtsSettings\(settings\)/);
  // 引擎二进制与 ASR 共用同一份 llama.cpp 运行时
  assert.match(main, /downloadLocalAsrRuntime\(/);
  assert.match(app, /ttsEngine === "local"/);
  assert.match(app, /downloadTtsLocalModel/);
  assert.match(settingsStorage, /normalizeTtsEngine/);
});

test("消息框可以把剪贴板图片加入待发送附件", () => {
  assert.match(app, /onPaste=\{\(event\) => void handleComposerPaste\(event\)\}/);
  assert.match(app, /getAsFile\(\)/);
  assert.match(app, /已粘贴剪贴板图片/);
  assert.match(preload, /saveClipboardImage: \(payload\)/);
  assert.match(styles, /\.attachment-preview-image/);
});

test("首次启动必须选择身份,并可在设置中重新选择", () => {
  assert.match(app, /IdentitySetupDialog/);
  assert.match(app, /首次使用/);
  assert.match(app, /通用身份/);
  assert.match(app, /政府单位/);
  assert.match(app, /identitySetupOpen/);
  assert.match(app, /identity: null/);
  assert.match(app, /助手身份/);
  assert.match(styles, /\.identity-dialog/);
  assert.match(settingsStorage, /normalizeIdentity/);
  assert.match(settingsStorage, /identity: normalized\.identity/);
  // 签名身份变化导致密钥暂时解不开时，迁移/保存都必须保留旧密文而非写空值（否则密钥永久丢失）
  assert.match(settingsStorage, /preserveUndecryptableSecrets/);
  assert.match(main, /preserveUndecryptableSecrets\(serializeSettings/);
});

test("身份会切换代理的默认工作语境", () => {
  const agent = readSource(new URL("../electron/agent.mjs", import.meta.url));
  assert.match(agent, /settings\?\.identity/);
  assert.match(agent, /面向个人、企业、开发者和各类组织/);
  assert.match(agent, /governmentMode/);
  assert.match(agent, /# 公文与政府事务/);
});

test("Responses 端点不会把语音转写请求误发到模型地址", () => {
  assert.match(main, /completions\\\/\?\$\/\.test\(url\.pathname\)\) return ""/);
});

test("composer preserves input method composition before keyboard submission", () => {
  assert.match(app, /onCompositionStart=/);
  assert.match(app, /onCompositionEnd=/);
  assert.match(app, /nativeEvent\.isComposing/);
  assert.match(app, /keyCode === 229/);
});

test("conversation tasks can run concurrently without leaking runtime state", () => {
  assert.match(app, /setRunningSessionIds/);
  assert.match(app, /runningSessionIds\.has\(activeSession\.id/);
  assert.match(app, /pendingApprovals\[activeSession\.id/);
  assert.match(app, /sessionAgentEvent\.sessionId !== taskSessionId \|\| sessionAgentEvent\.runId !== taskRunId/);
  assert.match(app, /cancelTask\(activeSession\.id, runId\)/);
  assert.match(app, /runningRunIdsRef\.current\.set\(taskSessionId, taskRunId\)/);
  assert.match(app, /agentUnsubscribeRefs\.current\.set\(taskRunId, unsubscribeAgent\)/);
  assert.doesNotMatch(app, /\|\| busy \|\|/);
  assert.match(main, /const activeAgents = new Map\(\)/);
  assert.match(main, /activeAgents\.has\(sessionId\)/);
  assert.match(main, /activeAgents\.set\(sessionId, agentState\)/);
  assert.match(main, /activeAgents\.delete\(sessionId\)/);
  assert.match(main, /sender\.send\("agent:event", \{ sessionId, runId, event: agentEvent \}\)/);
  assert.match(main, /activeAgents\.set\(sessionId, agentState\);\n\s*trackTaskStart\(\);\n\s*try \{/);
  assert.match(main, /agentState\.abortController\.abort\(\)/);
  assert.match(main, /if \(agentState\.cancelled\) \{\n\s*await cancelWakesForSession\(sessionId\)/);
  assert.match(main, /const mcpClientConnections = new Map\(\)/);
  assert.match(main, /if \(pendingConnection\) return pendingConnection/);
  assert.match(preload, /cancelTask: \(sessionId, runId\)/);
  assert.match(app, /shouldScrollToBottomRef\.current !== activeId/);
  assert.match(app, /sessionNotices\[activeSession\.id\]/);
  assert.match(app, /sessionErrors\[activeSession\.id\]/);
});

test("任务运行期间发送消息进入会话队列，排队消息未执行前可编辑或取消", () => {
  // 主进程：同一会话已有任务时入队并立即返回 queued，任务结束后自动推进下一条
  assert.match(main, /const sessionQueue = new SessionQueue\(\)/);
  assert.match(main, /sessionQueue\.push\(\{ sessionId, runId, payload, sender: event\.sender \}\)/);
  assert.match(main, /queued: true, runId/);
  assert.match(main, /drainSessionQueue\(sessionId\)/);
  assert.match(main, /queue-start/, "队列项开始执行时通知渲染端");
  assert.match(main, /queuedPayloadFromSession/, "执行前从会话存档取排队消息的最新内容");
  assert.match(main, /messages\.slice\(0, queuedIndex \+ 1\)/, "只截取到本条排队消息，不提前带入后面的排队消息");
  assert.match(main, /ipcMain\.handle\("agent:remove-queued"/);
  // 立即执行：提到队首 + 取消当前任务，复用既有出队链路
  assert.match(main, /ipcMain\.handle\("agent:run-queued-now"/);
  assert.match(main, /sessionQueue\.promote\(sessionId, runId\)/);
  // 预加载桥接
  assert.match(preload, /removeQueuedTask/);
  assert.match(preload, /agent:remove-queued/);
  assert.match(preload, /runQueuedTaskNow/);
  assert.match(preload, /agent:run-queued-now/);
  // 渲染端：运行中允许发送、排队状态与编辑/取消入口
  assert.match(app, /queuedRunIds/);
  assert.match(app, /agentEvent\.type === "queued"/);
  assert.match(app, /agentEvent\.type === "queue-start"/);
  assert.match(app, /activeTaskRunning && !queueSupported/);
  assert.match(app, /排队中的消息允许编辑/);
  assert.match(app, /editingQueuedRunId/);
  assert.match(app, /取消排队/);
  assert.match(app, /removeQueuedTask\(/);
  assert.match(app, /排队中/);
  // 排队消息不插进对话流渲染，统一收在输入框上方的队列卡片（对照 Codex）
  assert.match(app, /activeQueuedMessages/);
  assert.match(app, /不渲染在对话流里/);
  assert.match(app, /queue-card/);
  assert.match(app, /立即执行/);
  assert.match(app, /runQueuedMessageNow/);
  assert.match(app, /runQueuedTaskNow\(/);
  assert.match(app, /removeQueuedMessage/);
  // 立即执行不允许静默失败：点击即给反馈，invoke 异常显示可见错误而不是无反应
  assert.match(app, /正在停下当前任务，马上执行这条消息…/);
  assert.match(app, /这条消息已不在排队中，无法立即执行/);
  assert.match(app, /立即执行失败：/);
  // 提示条不被错误提示遮挡：error 存在时 notice 也要能显示出来
  assert.doesNotMatch(app, /!error && !activeSessionError && \(notice/);
  assert.match(app, /queueMenuRunId/);
  assert.match(app, /编辑内容（保持排队位置）/);
  assert.match(styles, /\.queue-card/);
  assert.match(styles, /\.queue-card-steer/);
  // 队列消息的监听器保留到真正执行完成，避免排队期间被提前取消
  assert.match(app, /排队消息的监听器一直保留到真正执行完成/);
  assert.match(app, /非排队消息的监听器在此收尾/);
});

test("多轮任务会保存并传递上一轮工作记录", () => {
  assert.match(app, /workingContext/);
  assert.match(app, /workingContext: updatedSession\.workingContext/);
  assert.match(main, /workingContext: String\(payload\?\.workingContext \|\| ""\)/);
  assert.match(agent, /前几轮已经完成的工作记录/);
  assert.match(agent, /buildWorkingContext/);
});

test("应用更新基于 GitHub 标签，并贯通界面、预加载和主进程", () => {
  assert.match(packageJson, /"provider": "github"/);
  assert.match(packageJson, /"owner": "richardguancn"/);
  assert.match(packageJson, /"repo": "dyworker"/);
  assert.match(packageJson, /"tagNamePrefix": "v"/);
  assert.match(releaseWorkflow, /tags:\s*\n\s*- "v\*"/);
  assert.match(releaseWorkflow, /tag_version=.*GITHUB_REF_NAME#v/);
  assert.match(releaseWorkflow, /gh release create/);
  assert.match(appUpdater, /isReleaseTagForVersion/);
  assert.match(appUpdater, /parseGithubUpdateUrl/);
  assert.match(appUpdater, /setFeedURL/);
  assert.match(main, /createUpdaterController/);
  assert.match(main, /storedSettings\.updateUrl/);
  assert.match(main, /appUpdater\.getUpdateUrl\(\)/);
  assert.match(main, /appUpdater\.configure\(updateUrl\)/);
  assert.match(main, /ipcMain\.handle\("app-update:check"/);
  assert.match(main, /updater\.autoDownload = false/);
  // electron-updater 动态加载：缺失时只禁用自动更新，不影响窗口启动
  assert.match(main, /loadElectronUpdater/);
  assert.match(main, /module\.autoUpdater \|\| module\.default\?\.autoUpdater/);
  assert.match(main, /electron-updater 不可用，自动更新已禁用/);
  assert.match(main, /createWindow\(\)[\s\S]*loadElectronUpdater\(\)/);
  assert.match(packageJson, /"node_modules\/\*\*\/\*"/);
  assert.match(preload, /onAppUpdateStatus/);
  assert.match(preload, /downloadAppUpdate/);
  assert.match(app, /AppUpdateDialog/);
  assert.match(app, /checkForAppUpdate/);
  assert.match(app, /更新地址/);
  assert.match(app, /draft\.updateUrl/);
  assert.match(settingsStorage, /updateUrl/);
  // macOS 无证书构建：afterPack 里 ad-hoc 重签名（Electron 自带 linker 签名过不了 ShipIt 深度校验），
  // 指定要求锚定 bundle identifier（默认 cdhash 每次构建都变，更新校验必然失败），
  // 并在构建期就做 codesign --verify，签名不合格直接失败
  assert.match(packageJson, /"afterPack": "build\/afterPack\.cjs"/);
  assert.match(afterPack, /--force/);
  assert.match(afterPack, /--deep/);
  assert.match(afterPack, /--sign", "-"/);
  assert.match(afterPack, /-r=designated => identifier/);
  assert.match(afterPack, /--verify/);
  assert.match(afterPack, /CSC_LINK/);
  // 旧版本签名校验过旧无法自动升级时，给出可操作的指引而不是原始英文报错
  assert.match(appUpdater, /did not pass validation/);
  assert.match(appUpdater, /手动安装一次后，之后的版本即可正常自动更新/);
  // 更新错误常带无空格的长 URL/路径，对话框文本必须允许任意位置断行，否则会撑出窗口
  assert.match(styles, /\.app-update-copy[\s\S]*?overflow-wrap:\s*anywhere/);
});

test("opening a conversation starts at the latest message", () => {
  assert.match(app, /scrollTo\(\{ top: viewport\.scrollHeight \}\)/);
});

test("任务完成时自动收口工作计划", () => {
  assert.match(app, /result\.status === "done" && plan\?\.length/);
  assert.match(app, /status: "completed" as const/);
  assert.match(app, /function completedPlanForMessage/);
  assert.match(app, /taskStatus: result\.status/);
  assert.match(main, /finalResult\?\.status === "done" && Array\.isArray\(finalResult\.plan\)/);
  assert.match(main, /emit\(\{ type: "plan-update", steps: completedPlan \}\)/);
  assert.match(main, /const finalPlan = result\?\.status === "done" && plan\?\.length/);
});

test("workspace files can be dragged into the composer as references", () => {
  assert.match(app, /WORKSPACE_FILE_DRAG_TYPE/);
  assert.match(app, /draggable=\{!isDirectory\}/);
  assert.match(app, /onDrop=\{handleComposerDrop\}/);
  // 拖拽/@引用统一走内联 token 插入，不再堆成附件 chip
  assert.match(app, /insertFileToken\(file\)/);
  assert.match(app, /const insertFileToken = \(file: WorkspaceEntry\)/);
});

test("@ 引用文件按顺序内联展示，输入 / 可继续过滤路径", () => {
  // @ 查询允许包含 /：输入路径分隔符不再中断候选菜单
  assert.match(app, /@\(\[\^\\s@\]\*\)\$/);
  // 候选菜单选中后在 @ 位置原地插入「@文件名 」token
  assert.match(app, /const token = `@\$\{item\.file\.name\} `/);
  assert.match(app, /mentionTokenPathsRef/);
  // 发送时按出现顺序把 token 解析成内联引用附件
  assert.match(app, /inlineRef: true/);
  // 输入框镜像层给 token 画高亮底色；气泡正文同步内联高亮，不再重复渲染 chip
  assert.match(app, /composer-mirror/);
  assert.match(app, /renderFileTokenText/);
  assert.match(app, /attachment\.inlineRef/);
  assert.match(styles, /\.composer-mirror/);
  assert.match(styles, /\.file-token/);
});

test("消息支持复制、时间显示和编辑后重新发送", () => {
  assert.match(app, /formatMessageTime/);
  assert.match(app, /copyMessage/);
  assert.match(app, /className="message-actions user"/);
  assert.match(app, /className="message-actions assistant"/);
  assert.match(app, /hideAssistantActions/);
  // 仍在输出中的助手消息（无终态 taskStatus）不显示时间/复制行；不能按末尾下标判断（后面可能有排队占位）
  assert.match(app, /streamingAssistantIndex/);
  assert.match(app, /!message\.taskStatus/);
  assert.doesNotMatch(app, /index === activeSession\.messages\.length - 1/);
  assert.match(app, /startMessageEdit/);
  assert.match(app, /setEditingMessage\(null\)/);
  assert.match(app, /activeSession\.messages\.slice\(0, editingMessage\.messageIndex\)/);
  assert.match(app, /重新发送/);
  assert.match(preload, /readWorkspaceMarkdown/);
  assert.match(styles, /\.message-actions/);
});

test("文件面板为左右分栏，Markdown 在内联预览（Codex 风格）", () => {
  assert.match(app, /isMarkdownFile/);
  assert.match(app, /previewKind === "markdown" \? window\.dyworker\?\.readWorkspaceMarkdown : window\.dyworker\?\.readWorkspaceFile/);
  assert.match(app, /function FilesSplitPanel/);
  assert.match(app, /从工作区目录树中选择文件/);
  assert.match(app, /<InteractiveMessage content=\{selection\.content\}/);
  assert.match(main, /ipcMain\.handle\("workspace:read-markdown"/);
  assert.match(main, /readWorkspaceMarkdown/);
  assert.match(styles, /\.file-split/);
  assert.match(styles, /\.file-split-markdown/);
  assert.match(styles, /\.markdown-file-preview-content/);
});

test("任意文本文件在文件面板内联预览：语法高亮、面包屑与文件筛选（Codex 风格）", () => {
  assert.match(app, /isTextPreviewFile/);
  assert.match(app, /TEXT_PREVIEW_EXTENSIONS/);
  assert.match(app, /<CodeView content=\{selection\.content\}/);
  assert.match(app, /function CodeView/);
  assert.match(app, /highlight\.js\/lib\/common/);
  assert.match(app, /hljs\.highlight/);
  assert.match(app, /codeBreadcrumbSegments/);
  assert.match(app, /用系统默认应用打开/);
  assert.match(app, /filterWorkspaceEntries/);
  assert.match(app, /筛选文件…/);
  assert.match(app, /forceExpand/);
  assert.match(preload, /readWorkspaceFile/);
  assert.match(main, /ipcMain\.handle\("workspace:read-file"/);
  assert.match(styles, /\.code-view-gutter/);
  assert.match(styles, /\.code-breadcrumb/);
  assert.match(styles, /\.tool-file-filter/);
});

test("审阅面板按 Git 基线逐文件展示 diff（Codex 风格）", () => {
  assert.match(app, /kind: "browser" \| "files" \| "review"/);
  assert.match(app, /activeToolPanelKind === "review"/);
  assert.match(app, /function GitReviewPanel/);
  assert.match(app, /function parseReviewDiff/);
  assert.match(app, /unmodified lines/);
  // 非 Git 仓库回退到上一轮改动审阅
  assert.match(app, /message\.role === "assistant" && message\.changes\?\.length/);
  assert.match(app, /上一轮/);
  assert.match(app, /gitReviewOverview/);
  assert.match(app, /gitFileDiff/);
  assert.match(app, /openToolPanelTab\("review"\)/);
  assert.match(preload, /git:review-overview/);
  assert.match(preload, /git:file-diff/);
  assert.match(main, /ipcMain\.handle\("git:review-overview"/);
  assert.match(main, /ipcMain\.handle\("git:file-diff"/);
  assert.match(styles, /\.review-diff-row\.add/);
  assert.match(styles, /\.review-diff-gap/);
  assert.match(styles, /\.review-file-row/);
  assert.match(styles, /\.review-split/);
  assert.match(styles, /\.review-status-badge/);
  // 左栏堆叠展示全部文件 diff，点文件树滚动定位（对照 Codex）
  assert.match(app, /function ReviewFileDiffSection/);
  assert.match(app, /data-review-path/);
  assert.match(app, /scrollIntoView/);
  // 文件树带类型彩色图标与状态图标徽标
  assert.match(app, /function FileTypeIcon/);
  assert.match(app, /function ReviewStatusIcon/);
  assert.match(styles, /\.file-type-icon/);
  assert.match(styles, /\.review-status-icon/);
  // 基线选择器并入头部第一行，错误提示友好化（不抛 IPC 原文）
  assert.match(app, /读取 Git 状态失败，请点击右上角刷新重试/);
  assert.doesNotMatch(app, /review-base-arrow/);
  // 差异支持折叠/展开：单文件区块可折叠 + 头部「展开/折叠全部差异」按钮（对照 Codex）
  assert.match(app, /折叠全部差异/);
  assert.match(app, /展开全部差异/);
  assert.match(app, /collapsedPaths/);
  assert.match(app, /onToggleCollapse/);
  // 会话里的「查看更改」在右侧审阅窗口打开这条消息的改动（对照 Codex）
  assert.match(app, /查看更改/);
  assert.match(app, /setReviewFocusChanges\(changes\)/);
  assert.match(app, /fallbackChanges=\{reviewFocusChanges \|\| reviewChanges\}/);
});

test("+ 按钮打开下拉菜单，终端在底部打开且面板界面无变化（Codex 风格）", () => {
  assert.match(app, /toolPanelAddMenuOpen/);
  assert.match(app, /setToolPanelAddMenuOpen\(\(value\) => !value\)/);
  // 终端在底部展开，不关闭菜单页、不切换标签页
  assert.match(app, /终端在底部展开，面板保持菜单页不动/);
  assert.match(app, /if \(item\.key !== "terminal"\) setToolPanelMenuOpen\(false\)/);
  assert.match(app, /setDebugOpen\(\(value\) => !value\)/);
  assert.match(styles, /\.tool-panel-add-menu/);
  // 标签栏层叠上下文必须高于面板内的吸顶表头（z-index:2），否则表头会盖住下拉菜单顶部条目并拦截点击
  assert.match(styles, /\.tool-panel-tabs\s*\{[^}]*z-index:\s*[3-9]/s);
});

test("浏览器更多菜单支持导入 Cookie 和密码（含国产 Linux 浏览器）", () => {
  assert.match(app, /browserMoreOpen/);
  assert.match(app, /导入 Cookie 和密码…/);
  assert.match(app, /BrowserImportDialog/);
  assert.match(app, /listImportableBrowsers/);
  assert.match(app, /importBrowserData/);
  assert.match(preload, /browser-import:list/);
  assert.match(preload, /browser-import:import/);
  assert.match(main, /ipcMain\.handle\("browser-import:list"/);
  assert.match(main, /ipcMain\.handle\("browser-import:import"/);
  assert.match(main, /persist:dyworker-browser/);
  // 会话级 Cookie（登录态多为这种）导入时必须补有效期，否则持久分区重启即丢
  assert.match(main, /400 \* 86400/);
  assert.match(main, /imported-passwords\.json/);
  assert.match(browserImport, /browser360/);
  assert.match(browserImport, /qaxbrowser/);
  assert.match(browserImport, /peanuts/);
  assert.match(browserImport, /find-generic-password/);
  assert.match(browserImport, /node:sqlite/);
  // Chromium 时间戳（1601 纪元微秒，约 1.3e16）超出 2^53，必须按 BigInt 读取否则整个查询抛错
  assert.match(browserImport, /readBigInts:\s*true/);
  // localStorage 导入：SPA 站点（如 kimi）登录态在 localStorage，只导 Cookie 无法迁移
  assert.match(browserImport, /readLocalStorageLeveldb/);
  assert.match(main, /imported-localstorage\.json/);
  assert.match(main, /browser-import:localstorage-entries/);
  assert.match(main, /browser-import:localstorage-done/);
  assert.match(preload, /getImportedLocalStorage/);
  assert.match(preload, /markImportedLocalStorageDone/);
  assert.match(app, /站点数据/);
  // 只勾选站点数据时导入按钮也应可用
  assert.match(app, /anyKindOn = kinds\.passwords \|\| kinds\.cookies \|\| kinds\.history \|\| kinds\.localstorage/);
  // localStorage 值自带 1 字节编码标签（0x01=Latin-1/0x00=UTF-16LE），不剥掉令牌首字符会被污染
  assert.match(localstorageImport, /record\.value\[0\] === 1/);
  assert.match(localstorageImport, /record\.value\.subarray\(1\)/);
  assert.match(app, /getImportedLocalStorage/);
  assert.match(app, /markImportedLocalStorageDone/);
  // 对话框为 Codex 风格：标题 + 来源选择行 + 分类开关（密码/Cookie/浏览记录）
  assert.match(app, /从浏览器导入/);
  assert.match(app, /选择要导入到内置浏览器的数据/);
  assert.match(app, /导入前，请完全关闭/);
  assert.match(app, /已保存的密码/);
  assert.match(app, /浏览记录/);
  assert.match(app, /browser-import-switch/);
  // 浏览记录：读取 History 库（无需解密）落盘，地址栏用 datalist 联想
  assert.match(browserImport, /History/);
  assert.match(browserImport, /FROM urls/);
  assert.match(main, /imported-history\.json/);
  assert.match(main, /ipcMain\.handle\("browser-import:history"/);
  assert.match(preload, /browser-import:history/);
  assert.match(app, /browser-history-suggestions/);
  // 只导入浏览记录时不触发密钥链（不解析解密密钥）
  assert.match(browserImport, /wantCookies \|\| wantPasswords/);
  assert.match(styles, /\.browser-more-menu/);
  assert.match(styles, /\.browser-import-dialog/);
  assert.match(styles, /\.browser-import-kinds/);
});

test("image attachments render real previews before and after sending", () => {
  assert.match(main, /previewUrl/);
  assert.match(app, /attachment\.isImage && attachment\.previewUrl/);
  assert.match(app, /className="attachment-preview-image"/);
  assert.doesNotMatch(app, /<figcaption[^>]*>\{attachment\.name\}<\/figcaption>/);
  assert.match(app, /!\(attachment\.isImage && attachment\.previewUrl\) && \(/);
  assert.match(app, /attachment\.isImage \? "图片" : attachment\.name/);
  assert.match(styles, /\.attachment-preview-image/);
  assert.match(styles, /\.image-attachment-chip > button\s*\{[^}]*position:\s*absolute/s);
});

test("title bar does not show a workspace folder chooser", () => {
  const topbar = app.match(/<header className="topbar">([\s\S]*?)<div className="topbar-menu-wrap"/)?.[1] || "";
  assert.doesNotMatch(topbar, /context-folder-chip/);
  assert.doesNotMatch(topbar, /chooseWorkspace/);
});

test("工作目录支持新建对话、置顶和在系统文件管理器中打开", () => {
  assert.match(types, /pinnedWorkspacePaths: string\[\]/);
  assert.match(app, /workspaceMenuPath/);
  assert.match(app, /pinnedWorkspacePaths\.includes\(path\)/);
  assert.match(app, /toggleWorkspacePin/);
  assert.match(app, /createTask\(group\.path\)/);
  assert.match(app, /openWorkspaceInFileManager\(group\.path\)/);
  assert.match(app, /在 Finder 中显示/);
  assert.match(app, /在文件资源管理器中显示/);
  assert.match(app, /在文件管理器中显示/);
  assert.match(app, /Number\(Boolean\(b\.pinned\)\) - Number\(Boolean\(a\.pinned\)\)/);
  assert.match(styles, /\.workspace-session-actions/);
  assert.match(styles, /\.workspace-menu/);
  assert.match(preload, /savePinnedWorkspaces: \(paths\).*workspace-pins:save/);
  assert.match(main, /ipcMain\.handle\("workspace-pins:save"/);
});

test("主对话区为每个用户回合提供定位线和悬停简介", () => {
  assert.match(app, /conversationTurnPreview/);
  assert.match(app, /hoveredTurnIndex/);
  assert.match(app, /conversation-turn-marker/);
  assert.match(app, /conversationTurnRefs/);
  assert.match(app, /jumpToConversationTurn/);
  assert.match(app, /scrollIntoView\(\{ behavior: "smooth"/);
  assert.match(app, /conversation-turn-rail/);
  assert.match(app, /aria-describedby=\{hoveredTurnIndex === turnIndex/);
  assert.match(app, /role="tooltip"/);
  assert.match(styles, /\.conversation-turn-rail/);
  assert.match(app, /conversationTurns\.length > 5/);
  assert.match(styles, /\.conversation-turn-rail \{[\s\S]*top: 50%;[\s\S]*transform: translateY\(-50%\);/);
  assert.match(styles, /\.conversation-turn-rail \{[\s\S]*gap: 0;/);
  assert.match(styles, /\.conversation-turn-marker::before \{[\s\S]*width: 6px;[\s\S]*height: 2px;/);
  assert.match(styles, /\.conversation-turn-marker\.wave-distance-0::before[\s\S]*width: 26px;/);
  assert.match(styles, /\.conversation-turn-marker\.wave-distance-1::before[\s\S]*width: 20px;/);
  assert.match(app, /waveDistance/);
  assert.doesNotMatch(styles, /\.conversation-turn-marker\.active::before/);
  assert.match(styles, /\.conversation-turn-marker-wrap/);
  assert.match(styles, /\.conversation-turn-preview/);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*conversation-turn-rail \{ display: none; \}/);
});

test("模型浏览器工具复用当前任务的右侧浏览器面板", () => {
  assert.match(app, /onBrowserPanelRequest/);
  assert.match(app, /setRightPanelOpen\(true\)/);
  assert.match(app, /createElement\("webview"/);
  assert.match(preload, /onBrowserPanelRequest/);
  assert.match(main, /browser:panel-request/);
  assert.match(main, /waitForEmbeddedBrowser/);
  assert.match(main, /new BrowserAgent\(\{[\s\S]*openPanel:/);
  assert.match(browserSource, /openPanel/);
  assert.match(browserSource, /右侧浏览器面板/);
  assert.doesNotMatch(browserSource, /new BrowserWindow/);
});

test("assistant local images only stay loaded near the viewport and share in-flight reads", () => {
  assert.match(interactiveMessage, /IntersectionObserver/);
  assert.match(interactiveMessage, /rootMargin:\s*"400px 0px"/);
  assert.match(interactiveMessage, /setShouldLoad\(entry\.isIntersecting\)/);
  assert.match(interactiveMessage, /localImageReads/);
  assert.match(interactiveMessage, /maxConcurrentLocalImageReads\s*=\s*3/);
  assert.match(interactiveMessage, /activeLocalImageReads\s*<\s*maxConcurrentLocalImageReads/);
  assert.match(interactiveMessage, /setState\(\{ status: "loading" \}\)/);
});

test("assistant local image reader is exposed only to the trusted renderer", () => {
  assert.match(preload, /readLocalImage:\s*\(path\).*local-image:read/);
  assert.match(main, /registerLocalImageIpc\(ipcMain,\s*\{\s*isTrustedSender:/s);
  assert.match(main, /isTrustedRendererUrl\(event\.senderFrame\?\.url\)/);
  assert.match(main, /webContents\.on\("will-navigate"/);
});

test("built-in model knowledge is always loaded and cannot be deleted as user memory", () => {
  assert.match(main, /mergeBuiltinMemories/);
  assert.match(main, /return mergeBuiltinMemories\(await readSavedMemories\(\)\)/);
  assert.match(main, /if \(isBuiltinMemoryId\(id\)\)/);
  assert.match(app, /item\.builtIn/);
  assert.match(app, />内置</);
});

test("composer uses the Codex permission menu and keeps secondary controls compact", () => {
  assert.match(app, /请示批准/);
  assert.match(app, /替我审批/);
  assert.match(app, /完全访问权限/);
  assert.doesNotMatch(app, /自动审核/);
  assert.match(app, /approval-mode-menu/);
  assert.match(app, /title="Enter 发送"/);
  assert.doesNotMatch(app, /className="shortcut-hint"/);
  assert.doesNotMatch(app, /className="loop-toggle"/);
  // 语音输入开关已回到输入框（mic 按钮接通 toggleVoiceInput，见本地语音契约测试）
  // 对照 Codex：运行中发送键与停止键合并为一个圆形按钮（有内容时是发送，空输入时是停止）
  assert.match(app, /activeTaskRunning && !canSend/);
  assert.match(app, /发送键变成停止键/);
  // 任务完成播放提示音（WebAudio 合成，不依赖资源文件）
  assert.match(app, /playCompletionSound/);
  assert.match(app, /AudioContext/);
});

test("开启完全访问权限前必须经过明确确认", () => {
  assert.match(app, /fullAccessDialogOpen/);
  assert.match(app, /要开启完整访问权限吗\?/);
  assert.match(app, /文件和文件夹/);
  assert.match(app, /终端命令/);
  assert.match(app, /互联网和已连接的应用/);
  assert.match(app, /setFullAccessDialogOpen\(true\)/);
  assert.match(app, /setApprovalMode\("full-access"\)/);
  assert.match(app, /完整访问权限已开启/);
  assert.match(styles, /\.full-access-dialog/);
  assert.match(styles, /\.full-access-confirm/);
});

test("Codex skills are refreshed for the active workspace and managed in settings", () => {
  assert.match(preload, /listSkills: \(workspacePath\)/);
  assert.match(app, /listSkills\?\.\(workspacePath\)/);
  assert.match(app, /label: "技能"/);
  assert.match(app, /skill-source-badge/);
  assert.match(app, /刷新技能/);
  assert.match(app, /搜索已安装技能/);
  assert.match(app, /没有匹配的技能/);
  assert.match(styles, /\.skill-search-field/);
  assert.doesNotMatch(app, /\[\.\.\.commands, \.\.\.skills\]\.slice/);
  assert.match(main, /readSkills\(workspacePath\)/);
});

test("技能库设置贯通配置、主进程和渲染端", () => {
  assert.match(types, /skillLibraries: SkillLibraryConfig\[\]/);
  assert.match(settingsStorage, /normalizeSkillLibraries/);
  assert.match(preload, /searchSkillLibraries: \(query\)/);
  assert.match(preload, /installSkillFromLibrary: \(payload\)/);
  assert.match(main, /ipcMain\.handle\("skill-libraries:search"/);
  assert.match(main, /ipcMain\.handle\("skill-libraries:install"/);
  assert.match(app, /label: "技能库"/);
  assert.match(app, /searchSkillLibraries\(text\)/);
  assert.match(app, /search\(""\)/);
  assert.match(app, /技能列表/);
  assert.match(app, /没有找到匹配技能/);
  assert.match(app, /installSkillFromLibrary\(\{ libraryId: result\.libraryId, slug: result\.slug \}\)/);
});

test("Computer Use 作为 macOS 基础能力自动接入，不需要用户重复配置", () => {
  assert.match(main, /discoverComputerUseServer\(\)/);
  assert.match(main, /builtInComputerUseServer/);
  assert.match(main, /COMPUTER_USE_SERVER_ID/);
  assert.match(main, /closeAllMcpClients/);
  assert.match(main, /app\.on\("before-quit"/);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /closeAllMcpClients\(\)\.finally\(\(\) => app\.quit\(\)\)/);
  assert.match(main, /if \(mcpShuttingDown\) throw new Error/);
  assert.match(main, /agentState\.cancelled \|\| mcpShuttingDown/);
  assert.match(main, /clearInterval\(schedulerTimer\)/);
  assert.match(main, /请确认当前使用 X11 桌面会话/);
  assert.match(main, /toolName === "install_dependencies"/);
  assert.match(main, /COMPUTER_USE_INSTALL_TIMEOUT_MS/);
  assert.match(main, /signal: abortController\.signal/);
  assert.doesNotMatch(main, /await client\.close\(\);\n\s*mcpClients\.delete/);
  assert.match(main, /请确认 DYWorker 已在 系统设置 → 隐私与安全性 → 辅助功能 和 屏幕录制 中启用/);
  assert.match(app, /本机应用操作已作为基础能力接入/);
  assert.match(packageJson, /electron\/scripts\/linux_computer_use\.py/);
  assert.match(packageJson, /electron\/scripts\/macos_computer_use\.js/);
});

test("context ring exposes used tokens, total capacity, and percentage", () => {
  assert.match(app, /contextUsageSummary/);
  assert.match(app, /上下文窗口/);
  assert.match(app, /已用.*标记/);
});

test("linux launch includes the white-screen compatibility fallback", () => {
  assert.match(main, /process\.platform === "linux"/);
  assert.match(main, /app\.disableHardwareAcceleration\(\)/);
  assert.match(main, /Menu\.setApplicationMenu\(null\)/);
});

test("linux wayland sessions use X11 and show the window without waiting for renderer paint", () => {
  assert.match(main, /process\.env\.XDG_SESSION_TYPE === "wayland"/);
  assert.match(main, /process\.env\.DISPLAY/);
  // The ozone platform is chosen before JavaScript runs, so the flag must be
  // added by relaunching the process with it on the real command line.
  assert.match(main, /"--ozone-platform=x11"/);
  assert.match(main, /DYWORKER_X11_RELAUNCH/);
  assert.match(main, /show: process\.platform === "linux"/);
  assert.match(main, /if \(process\.platform !== "linux"\) mainWindow\.once\("ready-to-show"/);
});

test("desktop theme follows the macOS and Linux system appearance", () => {
  assert.match(main, /nativeTheme/);
  assert.match(main, /nativeTheme\.themeSource = "system"/);
  assert.match(main, /nativeTheme\.shouldUseDarkColors/);
  assert.match(main, /nativeTheme\.on\("updated"/);
  assert.match(main, /!mainWindow\.isDestroyed\(\)/);
  assert.match(main, /mainWindow\.setBackgroundColor/);
  assert.match(styles, /color-scheme:\s*light dark/);
  assert.match(styles, /@media \(prefers-color-scheme:\s*dark\)/);
  assert.match(html, /name="color-scheme" content="light dark"/);
});

test("主窗口使用应用自己的标题栏和窗口按钮", () => {
  assert.match(main, /frame:\s*false/);
  assert.doesNotMatch(main, /titleBarStyle|titleBarOverlay/);
  assert.match(app, /window-controls/);
  assert.match(app, /dyworker\?\.minimize/);
  assert.match(app, /dyworker\?\.toggleMaximize/);
  assert.match(app, /dyworker\?\.close/);
  // 单独的全宽标题栏：菜单与三个窗口按钮固定在右上角
  assert.match(app, /className="titlebar"/);
  assert.match(app, /titlebar-brand/);
  assert.match(app, /titlebar-right/);
});

test("linux 默认用透明窗口自绘阴影，拿不到键盘焦点时自动回退不透明窗口", () => {
  assert.match(main, /supportsLinuxWindowShadow/);
  assert.match(main, /_NET_WM_CM_S0/);
  assert.match(main, /xprop/);
  assert.match(main, /DYWORKER_NO_WINDOW_SHADOW/);
  assert.match(main, /DYWORKER_FORCE_WINDOW_SHADOW/);
  assert.match(main, /XDG_SESSION_TYPE === "wayland"/);
  assert.match(main, /linux window shadow/);
  assert.match(main, /transparent:\s*true/);
  // 透明窗口拿不到焦点时自动重建为不透明窗口，保证输入可用
  assert.match(main, /solidFallback/);
  assert.match(main, /describeLinuxWindowState/);
  assert.match(main, /xwininfo/);
  assert.match(main, /document\.hasFocus\(\)/);
  assert.match(main, /rebuilding as a solid window without shadow/);
  assert.match(main, /window:pointer-down/);
  // 无边框窗口显示后主动申请键盘焦点，并记录渲染端焦点状态便于排查
  assert.match(main, /mainWindow\.on\("show"/);
  assert.match(main, /mainWindow\.focus\(\)/);
  assert.match(main, /"window:maximized-changed"/);
  assert.match(main, /windowShadow:/);
  assert.match(main, /windowMaximized:/);
  assert.match(preload, /onWindowStateChange/);
  assert.match(preload, /window:maximized-changed/);
  assert.match(app, /window-shadow/);
  assert.match(app, /window-maximized/);
  assert.match(app, /onWindowStateChange/);
  assert.match(app, /reportWindowPointerDown/);
  assert.match(styles, /html\.window-shadow/);
  assert.match(styles, /html\.window-shadow\.window-maximized/);
  assert.match(styles, /box-shadow:/);
  assert.match(types, /windowShadow: boolean/);
  assert.match(types, /onWindowStateChange/);
  assert.match(types, /reportWindowPointerDown/);
  assert.match(preload, /reportWindowPointerDown/);
});

test("linux 透明窗口启动后主动检查接管状态，未接管或重建时不会退出应用", () => {
  // 纯 Wayland（无 DISPLAY/XWayland）不启用透明阴影，避免老合成器下窗口
  // 无法映射导致“进程在但界面不显示”
  assert.match(main, /waylandSession && Boolean\(process\.env\.DISPLAY\)/);
  // 窗口显示后主动检查是否被窗口管理器接管，未接管自动重建为不透明窗口
  assert.match(main, /checkWindowMapped/);
  assert.match(main, /is not managed/);
  assert.match(main, /mainWindow\.once\("show"[\s\S]*setTimeout\(checkWindowMapped, 1200\)/);
  // xwininfo 缺失时用 xprop 兜底判断接管状态
  assert.match(main, /managed\(xprop\)/);
  // 重建窗口期间不触发 window-all-closed 退出，避免进程活着但界面消失
  assert.match(main, /rebuildLinuxWindowAsSolid/);
  assert.match(main, /recreatingWindow/);
  assert.match(main, /window-all-closed[\s\S]*!recreatingWindow/);
});

test("linux 记录窗口与渲染器诊断，渲染空白时先重载再强制不透明", () => {
  // 启动时记录窗口几何、显示器信息，便于真机定位“进程在但界面不显示”
  assert.match(main, /logWindowGeometry/);
  assert.match(main, /screen\.getDisplayMatching/);
  // 渲染器加载失败、进程退出、preload 报错、控制台错误都输出日志
  assert.match(main, /did-fail-load/);
  assert.match(main, /render-process-gone/);
  assert.match(main, /preload-error/);
  assert.match(main, /console-message/);
  // 透明模式下检查渲染器是否真的挂载了内容；空白先重载一次，仍空白则
  // 重建为不透明窗口，保证用户至少能看到界面
  assert.match(main, /inspectRendererContent/);
  assert.match(main, /rootChildren/);
  assert.match(main, /renderer is blank; reloading once/);
  assert.match(main, /renderer still blank after reload; forcing solid window/);
});

test("codex alignment surfaces are wired end to end", () => {
  const agent = readSource(new URL("../electron/agent.mjs", import.meta.url));
  // AGENTS.md 项目指令、edit_file 局部编辑、update_plan 计划、file-change 变更事件
  assert.match(agent, /loadProjectInstructions/);
  assert.match(agent, /AGENTS\.md/);
  assert.match(agent, /case "edit_file"/);
  assert.match(agent, /case "update_plan"/);
  assert.match(agent, /type: "file-change"/);
  assert.match(agent, /type: "plan-update"/);
  // 渲染端消费事件并展示计划卡片与变更摘要
  assert.match(app, /agentEvent\.type === "file-change"/);
  assert.match(app, /agentEvent\.type === "plan-update"/);
  assert.match(app, /ChangesSummary/);
  assert.match(app, /PlanCard/);
  // 改动卡片默认展开前 3 个文件，超出时「再显示 xx 个文件」点击展开（对照 Codex）
  assert.match(app, /changes\.slice\(0, 3\)/);
  assert.match(app, /再显示 \{hiddenCount\} 个文件/);
  assert.match(styles, /\.changes-more/);
  // /diff 视图与受信只读命令免审批
  assert.match(agent, /unifiedDiff/);
  assert.match(agent, /isAutoApprovableCommand/);
  assert.match(app, /DiffView/);
  // 政府办公：保密检查、公文格式检查、内置政务模板合并
  assert.match(agent, /scanSensitiveInfo/);
  assert.match(agent, /checkOfficialDocument/);
  assert.match(agent, /GB\/T 9704/);
  assert.match(main, /收发文登记/);
  assert.match(main, /信息简报/);
  assert.match(main, /领导摘要/);
  assert.match(main, /skills-dismissed\.json/);
  // 时限计算、Word 导出、浏览器协作
  assert.match(agent, /calculateWorkdays/);
  assert.match(agent, /exportWordDocument/);
  assert.ok(fs.existsSync(new URL("../electron/scripts/make_docx.py", import.meta.url)));
  assert.match(main, /browserToolDefinitions/);
  assert.match(main, /routeExtraTool/);
  assert.ok(fs.existsSync(new URL("../electron/browser.mjs", import.meta.url)));
  assert.match(browserSource, /webContents\?\.id !== webContentsId/);
  assert.match(browserSource, /removeListener\("will-download", this\.downloadHandler\)/);
  assert.match(browserSource, /dispose\(\)/);
  assert.match(main, /routeExtraTool\?\.dispose\(\)/);
  assert.match(linuxComputerUseSource, /message\.method === "notifications\/cancelled"/);
  assert.match(linuxComputerUseSource, /cancelledToolRequests\.add\(requestId\)/);
  assert.match(linuxComputerUseSource, /cancelled: cancelledToolRequests\.delete\(message\.id\)/);
  assert.match(linuxComputerUseSource, /activeToolRequest\?\.cancelled/);
  assert.match(agent, /browserReadOnlyTools/);
  // 变更卡片可直接打开产出文件
  assert.match(app, /dyworker\.openPath/);
  // 侧栏工作区文件树与 /init 内置命令
  assert.match(app, /WorkspaceNode entry=\{entry\}/);
  assert.match(app, /\/init/);
  // 深度调研：博查 API 优先、摘要解析、SearXNG 摘要、内置深度调研技能
  assert.match(agent, /parseBochaResults/);
  assert.match(agent, /api\.bochaai\.com\/v1\/web-search/);
  assert.match(agent, /parseBingResults/);
  assert.match(agent, /cn\.bing\.com\/search/);
  assert.match(agent, /domesticSearchOnly/);
  assert.match(settingsStorage, /domesticSearchOnly/);
  assert.match(app, /domesticSearchOnly/);
  assert.match(app, /仅使用境内搜索/);
  assert.match(agent, /摘要：\$\{snippet\}/);
  assert.match(settingsStorage, /bochaApiKey/);
  assert.match(app, /bochaApiKey/);
  assert.match(main, /深度调研/);
  // 子代理派发：dispatch_agent 工具、深度限制防递归、审批串行化、渲染端活动类型
  assert.match(agent, /case "dispatch_agent"/);
  assert.match(agent, /子代理不能再派发子代理/);
  assert.match(agent, /queuedApproval/);
  assert.match(app, /dispatch_agent/);
  // 下拉菜单失焦关闭：统一 data-menu-root 标记 + 外部点击/Esc 监听
  assert.match(app, /data-menu-root/);
  assert.match(app, /anyMenuOpen/);
  // Hermes 式学习闭环：update_skill 技能自我改进、skill-updated 持久化、用户画像记忆
  assert.match(agent, /case "update_skill"/);
  assert.match(agent, /type: "skill-updated"/);
  assert.match(main, /skill-updated/);
  assert.match(main, /updateSkill/);
  assert.match(app, /skill-updated/);
  assert.match(agent, /用户画像/);
  // 控制台：debug-log 事件（模型请求/响应、工具调用/结果、SSE/JSON 传输标注）与渲染端抽屉
  assert.match(agent, /type: "debug-log"/);
  assert.match(agent, /onTransport/);
  assert.match(agent, /SSE 流式/);
  assert.match(app, /DebugConsole/);
  assert.match(app, /debug-log/);
  // 上下文占用：优先端点实测 usage（SSE include_usage / JSON usage），渲染端回退中文估算
  assert.match(agent, /include_usage/);
  assert.match(agent, /type: "context-usage"/);
  assert.match(agent, /onUsage/);
  assert.match(app, /contextTokens/);
  assert.match(app, /context-usage/);
  assert.match(providers, /k3:\s*1048576/);
  assert.match(providers, /deepseek-v4-flash-vision-exp/);
  assert.match(agent, /isDeepSeekNativeVisionModel/);
  assert.match(agent, /validateImagesForNativeVisionModel/);
  assert.match(agent, /DEEPSEEK_VISION_IMAGE_ROLES/);
  assert.match(app, /agentEvent\.used \+ agentEvent\.completion/);
  assert.match(app, /contextTokens:\s*total/);
  // 用量统计：token-usage 事件按模型落盘，渲染端表格汇总
  assert.match(agent, /type: "token-usage"/);
  assert.match(agent, /estimateMessagesTokens/);
  assert.match(main, /appendUsageStat/);
  assert.match(main, /usage:list/);
  assert.match(preload, /listUsageStats/);
  assert.match(app, /listUsageStats/);
  assert.match(app, /用量统计/);
  // Claude Code 借鉴：系统提示词静态/动态分层、工具描述分工策略、read_file 分页、microcompact 裁剪
  assert.match(agent, /# 任务纪律/);
  assert.match(agent, /静态纪律在前、会话动态信息在尾/);
  assert.match(agent, /读文件内容用 read_file（不要 cat）/);
  assert.match(agent, /sliceLines/);
  assert.match(agent, /pruneOldToolResults/);
  assert.match(agent, /contextLimit/);
  assert.match(main, /contextLimit/);
  assert.match(app, /contextLimit/);
  // 工具扩充：查找/检索/追加/复制/移动/删除/日期/Excel 导出
  assert.match(agent, /find_files/);
  assert.match(agent, /search_in_files/);
  assert.match(agent, /append_file/);
  assert.match(agent, /delete_file/);
  assert.match(agent, /get_datetime/);
  assert.match(agent, /export_excel_workbook/);
  // hooks 体系：before_tool 拦截，block / require_approval，用户级 + 工作区级
  assert.match(agent, /evaluateHooks/);
  assert.match(agent, /require_approval/);
  assert.match(main, /hooks\.json/);
  assert.match(main, /readHooks/);
  // 自动 compact 摘要：独立无工具请求、结构化摘要、失败熔断
  assert.match(agent, /compactConversation/);
  assert.match(agent, /tools === false/);
  assert.match(agent, /context-compacted/);
  assert.match(app, /context-compacted/);
  // 服务端判定上下文超限（本地估不准时）的兜底：强制压缩后重试，而不是直接终止任务
  assert.match(agent, /isContextOverflowError/);
  assert.match(agent, /context_length_exceeded|context\[_ \]\?length/);
  assert.match(agent, /服务端判定上下文超限，强制压缩/);
  assert.match(agent, /overflowRetries/);
  assert.match(agent, /pruneOldToolResults\(messages, contextLimit, true\)/);
  // 老式 .doc 转换器探测链 + 内置 hooks（保护 hooks.json、拦灾难命令）
  assert.match(agent, /extractLegacyDoc/);
  assert.match(agent, /textutil/);
  assert.match(agent, /builtinHooks/);
  assert.match(agent, /\.dyworker\/hooks\.json/);
  // /goal 跨轮目标驱动:斜杠命令 → 会话级 goal → 注入系统提示,goalDriven 强制持续执行
  assert.match(app, /builtin:goal/);
  assert.match(app, /goalDriven/);
  assert.match(app, /goal-banner/);
  assert.match(main, /payload\?\.goal/);
  assert.match(agent, /长期目标是/);
  // 防止休眠:prevent-app-suspension(屏幕照常锁屏)、任务计数跟踪、三档设置
  assert.match(main, /powerSaveBlocker/);
  assert.match(main, /prevent-app-suspension/);
  assert.match(main, /trackTaskStart/);
  assert.match(main, /normalizePreventSleep/);
  assert.match(app, /preventSleep/);
  assert.match(app, /仅任务运行期间/);
  // Codex 风格设置:双栏导航 + 搜索 + 分区;用量统计与钩子规则并入设置页
  assert.match(app, /settings-nav/);
  assert.match(app, /搜索设置…/);
  assert.match(app, /HooksPanel/);
  assert.match(app, /UsageStatsPanel/);
  assert.match(main, /hooks:list/);
  assert.match(main, /hooks:open-user/);
  assert.match(preload, /listHooks/);
  assert.match(preload, /openUserHooks/);
  // 多模型配置：设置页维护、输入区快速切换、主进程逐条加密保存密钥
  assert.match(app, /saveCurrentModel/);
  assert.match(app, /保存并使用/);
  assert.doesNotMatch(app, /把当前填写保存为配置/);
  assert.match(app, /删除后会立即生效/);
  assert.match(app, /activateModelProfile/);
  assert.match(app, /model-menu/);
  assert.match(main, /serializeSettings/);
  assert.match(main, /deserializeSettings/);
  assert.match(main, /needsSecretMigration/);
  assert.match(settingsStorage, /profiles: normalized\.profiles\.map/);
  assert.match(settingsStorage, /encryptSecret\(profile\.apiKey/);
  // 长期记忆：普通任务和定时任务都复盘；定时任务完成后同步刷新设置页记忆
  assert.match(main, /const memoryReviewDue = true/);
  assert.match(main, /memories: await readMemories\(\),\n\s+memoryReviewDue: true/);
  assert.match(app, /onSchedulesChanged[\s\S]*listMemories/);
  assert.match(main, /extractExplicitMemoryInstruction/);
  const agentSend = main.slice(main.indexOf('ipcMain.handle("agent:send"'));
  assert.ok(agentSend.indexOf("const explicitMemories") < agentSend.indexOf("if (!settings.endpoint"));
  assert.match(agent, /externalPathsForTool/);
  assert.match(agent, /withModelTimeout/);
  // 工作区外路径:用户批准的目录授权在本次任务内覆盖子路径,审核助手放行仍单次
  assert.match(agent, /isAuthorized\(relativePath\)/);
  assert.match(agent, /批准后本次任务内有效；批准的是目录时，其子路径同样有效/);
  assert.match(agent, /persistExternalAuthorization/);
});

test("openworker 移植机制端到端接线(风险分级/常驻规则/收件箱/自我唤醒/留痕/审计)", () => {
  const agent = readSource(new URL("../electron/agent.mjs", import.meta.url));
  const risk = readSource(new URL("../electron/risk.mjs", import.meta.url));
  const auditSource = readSource(new URL("../electron/audit.mjs", import.meta.url));

  // 1. 统一风险分级:risk.mjs 为单源,审批管线 evaluateApproval 驱动,approvalDecision 保持兼容包装
  assert.match(risk, /export const RISK/);
  assert.match(risk, /export function classify/);
  assert.match(agent, /from "\.\/risk\.mjs"/);
  assert.match(agent, /export function evaluateApproval/);
  assert.match(agent, /export function approvalDecision\(opts = \{\}\) \{\n\s+return evaluateApproval/);

  // 2. 常驻允许规则:匹配/建议、rules IPC、审批卡始终允许按钮;
  //    run_command 支持受信只读命令与常用开发命令按 argv 前缀规则化(command-prefix),
  //    系统破坏命令、computer-use 永不规则化
  assert.match(agent, /export function matchStandingRule/);
  assert.match(agent, /export function suggestStandingRule/);
  assert.match(agent, /shell asks forever/);
  assert.match(agent, /command-prefix/);
  assert.match(agent, /ruleTrustedPrograms/);
  assert.match(agent, /commandChainingPattern/);
  // 审核助手:规则定边界、模型做判断,系统破坏/外部路径/本机界面/钩子绕过审核
  assert.match(agent, /REVIEWER_POLICY/);
  assert.match(agent, /export async function reviewApproval/);
  assert.match(agent, /export function isReviewerEligible/);
  assert.match(agent, /reviewer-allowed/);
  // 审计与调试日志标明决策来源模型（本地内置/自定义端点/当前模型）
  assert.match(agent, /本地内置 Qwen3-0\.6B/);
  assert.match(agent, /model: reviewerModelLabel/);
  assert.match(auditSource, /entry\?\.model/);
  assert.match(main, /"reviewer"/);
  assert.match(main, /standing-rules\.json/);
  assert.match(main, /ipcMain\.handle\("rules:list"/);
  assert.match(main, /ipcMain\.handle\("rules:add"/);
  assert.match(main, /ipcMain\.handle\("rules:delete"/);
  assert.match(main, /standingRules: await readStandingRules\(\)/);
  assert.match(main, /kind === "command-prefix" \? \{ command: pattern \}/);
  assert.match(preload, /listRules:/);
  assert.match(preload, /addRule:/);
  assert.match(preload, /deleteRule:/);
  assert.match(app, /始终允许/);
  assert.match(app, /suggestedRule/);

  // 3. 审计日志:audit.mjs 追加+轮转,agent 决策点上报,渲染端可打开
  assert.match(auditSource, /export function createAuditLog/);
  assert.match(agent, /auditRecord\(/);
  assert.match(main, /createAuditLog/);
  assert.match(main, /audit\.jsonl/);
  assert.match(main, /ipcMain\.handle\("audit:open"/);
  assert.match(preload, /openAuditLog:/);
  assert.match(app, /打开审计日志/);

  // 4. 审批收件箱 + ask_user:无人值守审批/提问进收件箱挂起,解决后原地恢复;重启孤儿条目标已失效
  assert.match(agent, /functionTool\("ask_user"/);
  assert.match(agent, /case "ask_user"/);
  assert.match(agent, /requestUserInput/);
  assert.match(main, /inbox\.json/);
  assert.match(main, /createInboxItem/);
  assert.match(main, /ipcMain\.handle\("inbox:list"/);
  assert.match(main, /ipcMain\.handle\("inbox:resolve"/);
  assert.match(main, /ipcMain\.handle\("inbox:dismiss"/);
  assert.match(main, /expireOrphanedInboxItems/);
  assert.match(main, /expireAllPendingInbox/);
  // 孤儿 pending 条目（等待 promise 已消失）在读取列表前自动判为失效，杜绝“已失效钉子户”卡片
  assert.match(main, /sweepOrphanedInboxItems/);
  assert.match(main, /await sweepOrphanedInboxItems\(\)/);
  assert.match(main, /inboxPending\.has\(item\.id\)/);
  // settle 与 create 共用落盘队列，避免 read-modify-write 互相覆盖
  assert.match(main, /const run = inboxPersistQueue\.then/);
  // 渲染层：决议失败也刷新列表（过期卡片移入“最近已处理”）；打开收件箱时重新拉取
  assert.match(app, /无论成败都刷新/);
  assert.match(app, /setInboxOpen\(true\);\s*\/\/ 打开时重新拉取/);
  assert.match(main, /ipcMain\.handle\("agent:resolve-question"/);
  assert.match(preload, /listInbox:/);
  assert.match(preload, /resolveInbox:/);
  assert.match(preload, /resolveQuestion:/);
  assert.match(preload, /onInboxChanged:/);
  assert.match(app, /审批收件箱/);
  assert.match(app, /InboxDialog/);
  assert.match(app, /QuestionCard/);
  assert.match(app, /agentEvent\.type === "ask-user"/);
  assert.match(app, /inbox-badge/);

  // 5. 自我唤醒:sleep_until 工具 → sleeping 结果 → wakes.json 落盘 → 调度 tick 到点续跑 → sessions:append 回写
  assert.match(agent, /functionTool\("sleep_until"/);
  assert.match(agent, /case "sleep_until"/);
  assert.match(agent, /status: "sleeping"/);
  assert.match(main, /wakes\.json/);
  assert.match(main, /registerWake/);
  assert.match(main, /checkDueWakes/);
  assert.match(main, /resumeWake/);
  assert.match(main, /visibleConversationForSession/);
  assert.match(main, /sessions:append/);
  assert.match(main, /ipcMain\.handle\("wakes:cancel-for-session"/);
  assert.match(preload, /onSessionAppend:/);
  assert.match(preload, /cancelWakesForSession:/);
  assert.match(app, /onSessionAppend/);
  assert.match(app, /result\.status === "sleeping"/);

  // 6. 定时任务完整留痕:headless 运行也产出完整活动流/变更/计划
  assert.match(main, /createTranscriptCollector/);
  assert.match(main, /collector\.buildMessages/);
  assert.match(main, /scheduleSessionId/);
  // 渲染端与 main 的留痕归约处理同一组事件,防漂移
  for (const eventType of ["activity-update", "file-change", "plan-update"]) {
    assert.match(app, new RegExp(agentEventTypeRegex(eventType)));
    assert.match(main, new RegExp(`agentEvent\\.type === "${eventType}"`));
  }
});

test("技能引用消息只显示标签与正文,不回显完整提示词", () => {
  const types = readSource(new URL("../src/types.ts", import.meta.url));
  // 完整技能指令仍在 content 里发给模型;气泡只渲染 displayContent + 技能标签
  assert.match(types, /displayContent\?: string/);
  assert.match(types, /skillsUsed\?: string\[\]/);
  assert.match(app, /skillsUsed: selectedSkills/);
  assert.match(app, /message\.displayContent \?\? message\.content/);
  // 引用以 Codex 风格的绿色 chip 内联展示（消息与输入框共用）
  assert.match(app, /ref-chip/);
  assert.match(app, /ref-attachment-chip/);
  assert.match(styles, /\.ref-chip/);
  assert.match(styles, /\.ref-attachment-chip/);
  // 文件型技能注入技能目录位置,agent 不必再全盘搜索技能文件
  assert.match(app, /技能目录:/);
  assert.match(app, /pathDirname/);
});

test("IM 消息渠道端到端接线(QQ 官方机器人 / 微信 ClawBot)", () => {
  const qqBot = readSource(new URL("../electron/channels/qq-bot.mjs", import.meta.url));
  const wechat = readSource(new URL("../electron/channels/wechat.mjs", import.meta.url));
  const manager = readSource(new URL("../electron/channels/manager.mjs", import.meta.url));
  const workspaceCmd = readSource(new URL("../electron/channels/workspace.mjs", import.meta.url));
  const types = readSource(new URL("../src/types.ts", import.meta.url));

  // 1. QQ 官方机器人:手写协议(appSecret→token、gateway、WSS identify/心跳/resume)、归一化与出站切片
  assert.match(qqBot, /getAppAccessToken/);
  assert.match(qqBot, /api\.sgroup\.qq\.com/);
  assert.match(qqBot, /export function createQqBotClient/);
  assert.match(qqBot, /export function normalizeQqEvent/);
  // chunkText 已移至 shared.mjs，qq-bot 保留 re-export（对外导出形态不变）
  assert.match(qqBot, /export \{ chunkText \}/);
  assert.match(qqBot, /export function parseApprovalReply/);
  assert.match(qqBot, /C2C_MESSAGE_CREATE/);
  assert.match(qqBot, /GROUP_AT_MESSAGE_CREATE/);
  assert.match(qqBot, /input_notify/);

  // 2. 微信 ClawBot:扫码登录(官方 ilink 接口)+ weixin-clawbot 长轮询,凭据由 onLogin 回调落盘
  assert.match(wechat, /ilink\/bot\/get_bot_qrcode/);
  assert.match(wechat, /ilink\/bot\/get_qrcode_status/);
  assert.match(wechat, /await import\("weixin-clawbot"\)/);
  assert.match(wechat, /export function createWechatChannel/);
  assert.match(wechat, /async sendTyping/);

  // 3. 管理层:reconcile 热切换、每聊天串行队列、待决路由(审批回复不进任务队列)
  assert.match(manager, /export function createChannelManager/);
  assert.match(manager, /pendingByChat/);
  assert.match(manager, /reconcile/);
  assert.match(manager, /adapter\.sendTyping/);

  // 4. 主进程接线:渠道任务引擎、全局忙碌守卫、决议共用入口、状态广播、生命周期
  assert.match(main, /from "\.\/channels\/manager\.mjs"/);
  assert.match(main, /async function runChannelTask/);
  assert.match(main, /activeAgents\.size \|\| runningScheduledTask \|\| runningChannelTaskCount > 0/);
  assert.match(main, /resolveInboxInternal/);
  assert.match(main, /ipcMain\.handle\("channels:get-status"/);
  assert.match(main, /broadcastChannelsStatus/);
  assert.match(main, /channelManager\.stopAll\(\)/);
  assert.match(main, /channel-chats\.json/);
  assert.match(main, /channel-credentials\.json/);
  // 设置保存与启动时热生效
  assert.match(main, /await reconcileChannels\(\)/);
  assert.match(main, /void reconcileChannels\(\)\.catch/);
  // 渠道内可整条发送「更换工作目录至…」切换该聊天操作目录,并回写 channel-chats.json
  assert.match(workspaceCmd, /export function parseWorkspaceSwitch/);
  assert.match(workspaceCmd, /export async function resolveWorkspaceSwitch/);
  assert.match(workspaceCmd, /export function looksLikePathDirective/);
  assert.match(main, /from "\.\/channels\/workspace\.mjs"/);
  assert.match(main, /parseWorkspaceSwitch\(text\)/);
  assert.match(main, /resolveWorkspaceSwitch\(workspaceTarget, workspacePath\)/);
  assert.match(main, /looksLikePathDirective\(workspaceTarget\)/);
  assert.match(main, /工作目录已更换为/);

  // 5. 设置存储:channels 序列化、QQ appSecret 加密、微信凭据独立加密落盘
  assert.match(settingsStorage, /normalizeChannels/);
  assert.match(settingsStorage, /encryptChannelSecret/);
  assert.match(settingsStorage, /decryptChannelSecret/);

  // 6. 渲染端:消息渠道 tab、凭据表单、扫码二维码、状态订阅
  assert.match(app, /消息渠道/);
  assert.match(app, /ChannelsPanel/);
  assert.match(app, /getChannelsStatus/);
  assert.match(app, /onChannelsStatus/);
  assert.match(app, /awaiting-scan/);
  assert.match(preload, /getChannelsStatus:/);
  assert.match(preload, /onChannelsStatus:/);
  assert.match(types, /ChannelsConfig/);
  assert.match(types, /ChannelsStatusMap/);
  assert.match(styles, /\.channel-status-dot/);

  // 7. 渠道会话:立即上屏(先发用户消息)、失败也留痕、列表渠道徽标、可固定渠道模型
  assert.match(main, /sendUserMessage\(\)/);
  assert.match(main, /sendAssistantMessages/);
  assert.match(main, /channel,\s*\n\s*createdAt/);
  assert.match(main, /出错了:\$\{message\}/);
  assert.match(main, /modelProfileId/);
  assert.match(settingsStorage, /modelProfileId/);
  assert.match(types, /channel\?: "qq" \| "wechat"/);
  assert.match(app, /session-channel-badge/);
  assert.match(app, /渠道任务模型/);
  assert.match(app, /workspacePath: payload\.workspacePath \|\| session\.workspacePath/);
  assert.match(main, /await sendTyping\(\)/);
  assert.doesNotMatch(main, /收到,正在处理…/);
  assert.match(main, /outboundAttachments = await buildChannelAttachments\(pendingMedia\)/);
  assert.match(main, /built\[1\]\.attachments = outboundAttachments/);
  assert.match(styles, /\.session-channel-badge/);

  // 7b. 渠道会话实时进度：运行期间把关键 agent 事件流式转发渲染端，
  //     不再等全部结束才一次性 append（否则用户只看到用户消息、AI 侧长时间无动静）
  assert.match(main, /CHANNEL_STREAM_EVENT_TYPES/, "渠道实时事件白名单");
  assert.match(main, /forwardChannelEvent/, "渠道任务运行期间转发事件");
  assert.match(main, /forwardChannelEvent\(agentEvent\)/, "emit 时透传运行中事件");
  assert.match(main, /type: "agent-finished"/, "渠道任务结束时发收尾事件");
  assert.match(app, /const target = sessionsRef\.current\.find/, "渲染端按会话定位渠道任务");
  assert.match(app, /!target\.channel/, "只处理渠道会话，不碰桌面会话");
  assert.match(app, /ensureChannelAssistant/, "渠道会话流式 assistant 占位");
  assert.match(app, /channelStreamIds/, "按会话跟踪流式消息 id");

  // 8. 渠道审批:createInboxItem 不能把内层 promise 包进 async 外层(会吞掉 .itemId,
  //    IM 回复「允许」路由不到挂起条目——regression);审批严格度可调,默认自动审核
  assert.doesNotMatch(main, /async function createInboxItem/);
  assert.match(main, /pending\.itemId = item\.id/);
  assert.match(main, /inboxPersistQueue/);
  assert.match(main, /settings\.channels\?\.approvalMode/);
  assert.match(settingsStorage, /approvalMode = source\.approvalMode === "auto"/);
  assert.match(app, /审批严格度/);
  assert.match(app, /value="auto"/);
  assert.match(app, /value="reviewer"/);
});

function agentEventTypeRegex(eventType) {
  return `agentEvent\\.type === "${eventType}"`;
}

test("main-process modules pass node --check syntax validation", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = new URL("../electron/", import.meta.url);
  for (const entry of fs.readdirSync(dir)) {
    if (!/\.(mjs|cjs)$/.test(entry)) continue;
    execFileSync(process.execPath, ["--check", fileURLToPath(new URL(entry, dir))], { stdio: "pipe" });
  }
});

test("分支管理与提交推送端到端接线（Codex 风格）", () => {
  // 顶栏分支按钮与下拉：搜索、当前分支打勾、创建并检出
  assert.match(app, /className=\{`branch-button/);
  assert.match(app, /创建并检出新分支/);
  assert.match(app, /未提交：\{gitInfo\.uncommitted\} 个文件/);
  assert.match(app, /switchBranch/);
  // 提交面板：留空自动生成、包含未暂存的更改、diff 统计、三个动作
  assert.match(app, /提交信息（留空将自动生成）/);
  assert.match(app, /包含未暂存的更改/);
  assert.match(app, /commit-diff-stats/);
  assert.match(app, /提交并推送/);
  // 主进程与 preload 的 Git 通道
  assert.match(main, /ipcMain\.handle\("git:branches"/);
  assert.match(main, /ipcMain\.handle\("git:commit"/);
  assert.match(main, /ipcMain\.handle\("git:push"/);
  assert.match(preload, /gitBranches/);
  assert.match(preload, /gitCommit/);
  assert.match(preload, /gitPush/);
  assert.match(styles, /\.branch-menu,/);
  assert.match(styles, /\.commit-panel\s*\{/);
});

test("右侧面板默认展示菜单且快捷键多平台适配", () => {
  // 初始没有任何标签页：浏览器只是菜单里的一个选项，用户选择之前什么都不打开（对照 Codex）
  assert.match(app, /useState<ToolPanelTab\[\]>\(\[\]\)/);
  // 展开右侧面板且还没有标签页时展示菜单页
  assert.match(app, /setToolPanelMenuOpen\(toolPanelTabs\.length === 0\)/);
  // 菜单作为面板页面内容展示(对照 Codex),不是下拉浮层
  assert.match(app, /tool-panel-menu-page/);
  assert.doesNotMatch(app, /tool-panel-menu-host/);
  // 纯净菜单页(还没有真实标签页)不显示标签栏和 + 按钮；无标签页时始终派生显示菜单页
  // （拖动面板边框触发外部点击关闭也不会出现空白面板）
  assert.match(app, /menuPageShown = toolPanelMenuOpen \|\| toolPanelTabs\.length === 0/);
  assert.match(app, /pristineMenuPage = toolPanelTabs\.length === 0/);
  assert.match(app, /\{!pristineMenuPage && toolPanelTabs\.map/);
  // 关掉最后一个标签页回到菜单页，而不是再开一个空白浏览器
  assert.doesNotMatch(app, /kind: "browser", title: "新标签页", url: "" \}\);\s*\n\s*setActiveToolPanelTabId\(id\)/);
  // 快捷键标签按平台切换（macOS 符号 / Windows·Linux 文字）
  assert.match(app, /shortcutLabel\("⌘T", "Ctrl\+T"\)/);
  assert.match(app, /shortcutLabel\("⌘P", "Ctrl\+P"\)/);
  assert.match(app, /shortcutLabel\("⌥⌘S", "Ctrl\+Alt\+S"\)/);
  // 快捷键实际接线
  assert.match(app, /key === "t"/);
  assert.match(app, /key === "p"/);
});

test("应用更新入口在设置的应用更新页,而不是会话顶栏或侧栏", () => {
  assert.doesNotMatch(app, /app-update-button/);
  assert.match(app, /tab === "updates"/);
  assert.match(app, /settings-update-row/);
  assert.match(app, /onCheckUpdate=\{openAppUpdateDialog\}/);
  assert.match(app, /当前版本 \{appUpdate\.currentVersion/);
  assert.match(styles, /\.settings-update-row/);
});

test("消息文本右键可复制选中内容,输入框右键支持复制/剪切/粘贴", () => {
  // 消息文本：选中后右键出现「复制」，只复制选中的文本
  assert.match(app, /handleMessageContextMenu/);
  assert.match(app, /window\.getSelection\(\)/);
  assert.match(app, /event\.currentTarget\.contains\(anchor\)/);
  assert.match(app, /copy-selection/);
  // 输入框：右键菜单含复制/剪切/粘贴，未选中时禁用复制与剪切
  assert.match(app, /handleComposerContextMenu/);
  assert.match(app, /selectionStart/);
  assert.match(app, /disabled: !hasSelection/);
  assert.match(app, /execCommand\("paste"\)/);
  assert.match(app, /navigator\.clipboard\?\.readText/);
  assert.match(app, /readClipboardText/);
  assert.match(app, /writeClipboardText/);
  assert.match(preload, /readClipboardText: \(\) =>/);
  assert.match(preload, /writeClipboardText: \(text\) =>/);
  assert.match(app, /已剪切/);
  assert.match(app, /粘贴失败，请检查剪贴板权限/);
  // 菜单关闭与贴边定位
  assert.match(app, /pointerdown/);
  assert.match(app, /context-menu/);
  assert.match(styles, /\.context-menu-item/);
  assert.match(styles, /\.context-menu\s*\{/);
});
