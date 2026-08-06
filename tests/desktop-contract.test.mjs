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
const linuxComputerUseSource = readSource(new URL("../electron/linux-computer-use-server.mjs", import.meta.url));
const settingsStorage = readSource(new URL("../electron/settings.mjs", import.meta.url));
const appUpdater = readSource(new URL("../electron/app-updater.mjs", import.meta.url));
const releaseWorkflow = readSource(new URL("../.github/workflows/release.yml", import.meta.url));
const packageJson = readSource(new URL("../package.json", import.meta.url));
const providers = readSource(new URL("../src/providers.ts", import.meta.url));
const types = readSource(new URL("../src/types.ts", import.meta.url));
const styles = readSource(new URL("../src/styles.css", import.meta.url));
const html = readSource(new URL("../index.html", import.meta.url));

test("desktop controls are connected across renderer, preload, and main process", () => {
  for (const action of ["chooseAttachments", "saveClipboardImage", "transcribeAudio"]) {
    assert.match(app, new RegExp(`dyworker\\.${action}`));
    assert.match(preload, new RegExp(`${action}:`));
  }
  assert.match(main, /ipcMain\.handle\("attachments:choose"/);
  assert.match(main, /ipcMain\.handle\("attachments:save-clipboard-image"/);
  assert.match(main, /ipcMain\.handle\("voice:transcribe"/);
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
  assert.match(main, /autoUpdater\.autoDownload = false/);
  assert.match(preload, /onAppUpdateStatus/);
  assert.match(preload, /downloadAppUpdate/);
  assert.match(app, /AppUpdateDialog/);
  assert.match(app, /checkForAppUpdate/);
  assert.match(app, /更新地址/);
  assert.match(app, /draft\.updateUrl/);
  assert.match(settingsStorage, /updateUrl/);
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
  assert.match(app, /addWorkspaceFile\(file\)/);
});

test("消息支持复制、时间显示和编辑后重新发送", () => {
  assert.match(app, /formatMessageTime/);
  assert.match(app, /copyMessage/);
  assert.match(app, /className="message-actions user"/);
  assert.match(app, /className="message-actions assistant"/);
  assert.match(app, /hideAssistantActions/);
  assert.match(app, /activeTaskRunning[\s\S]*index === activeSession\.messages\.length - 1/);
  assert.match(app, /startMessageEdit/);
  assert.match(app, /setEditingMessage\(null\)/);
  assert.match(app, /activeSession\.messages\.slice\(0, editingMessage\.messageIndex\)/);
  assert.match(app, /重新发送/);
  assert.match(preload, /readWorkspaceMarkdown/);
  assert.match(styles, /\.message-actions/);
});

test("右侧文件面板支持直接预览 Markdown", () => {
  assert.match(app, /isMarkdownFile/);
  assert.match(app, /readWorkspaceMarkdown\(workspacePath, entry\.path\)/);
  assert.match(app, /ReactMarkdown remarkPlugins=\{\[remarkGfm\]\}/);
  assert.match(app, /返回文件/);
  assert.match(main, /ipcMain\.handle\("workspace:read-markdown"/);
  assert.match(main, /readWorkspaceMarkdown/);
  assert.match(styles, /\.markdown-file-preview/);
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
  assert.match(app, /自动审核/);
  assert.match(app, /完全访问权限/);
  assert.doesNotMatch(app, /替我审批/);
  assert.match(app, /approval-mode-menu/);
  assert.match(app, /title="Enter 发送"/);
  assert.doesNotMatch(app, /className="shortcut-hint"/);
  assert.doesNotMatch(app, /className="loop-toggle"/);
  assert.doesNotMatch(app, /className=\{`icon-button voice-button/);
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
  assert.match(app, /skill-ref-chip/);
  assert.match(styles, /\.message-skills > \.skill-ref-chip/);
  // 文件型技能注入技能目录位置,agent 不必再全盘搜索技能文件
  assert.match(app, /技能目录:/);
  assert.match(app, /pathDirname/);
});

test("IM 消息渠道端到端接线(QQ 官方机器人 / 微信 ClawBot)", () => {
  const qqBot = readSource(new URL("../electron/channels/qq-bot.mjs", import.meta.url));
  const wechat = readSource(new URL("../electron/channels/wechat.mjs", import.meta.url));
  const manager = readSource(new URL("../electron/channels/manager.mjs", import.meta.url));
  const types = readSource(new URL("../src/types.ts", import.meta.url));

  // 1. QQ 官方机器人:手写协议(appSecret→token、gateway、WSS identify/心跳/resume)、归一化与出站切片
  assert.match(qqBot, /getAppAccessToken/);
  assert.match(qqBot, /api\.sgroup\.qq\.com/);
  assert.match(qqBot, /export function createQqBotClient/);
  assert.match(qqBot, /export function normalizeQqEvent/);
  assert.match(qqBot, /export function chunkText/);
  assert.match(qqBot, /export function parseApprovalReply/);
  assert.match(qqBot, /C2C_MESSAGE_CREATE/);
  assert.match(qqBot, /GROUP_AT_MESSAGE_CREATE/);

  // 2. 微信 ClawBot:扫码登录(官方 ilink 接口)+ weixin-clawbot 长轮询,凭据由 onLogin 回调落盘
  assert.match(wechat, /ilink\/bot\/get_bot_qrcode/);
  assert.match(wechat, /ilink\/bot\/get_qrcode_status/);
  assert.match(wechat, /await import\("weixin-clawbot"\)/);
  assert.match(wechat, /export function createWechatChannel/);

  // 3. 管理层:reconcile 热切换、每聊天串行队列、待决路由(审批回复不进任务队列)
  assert.match(manager, /export function createChannelManager/);
  assert.match(manager, /pendingByChat/);
  assert.match(manager, /reconcile/);

  // 4. 主进程接线:渠道任务引擎、全局忙碌守卫、决议共用入口、状态广播、生命周期
  assert.match(main, /from "\.\/channels\/manager\.mjs"/);
  assert.match(main, /async function runChannelTask/);
  assert.match(main, /runningChannelTask \|\| activeAgents\.size/);
  assert.match(main, /resolveInboxInternal/);
  assert.match(main, /ipcMain\.handle\("channels:get-status"/);
  assert.match(main, /broadcastChannelsStatus/);
  assert.match(main, /channelManager\.stopAll\(\)/);
  assert.match(main, /channel-chats\.json/);
  assert.match(main, /channel-credentials\.json/);
  // 设置保存与启动时热生效
  assert.match(main, /await reconcileChannels\(\)/);
  assert.match(main, /void reconcileChannels\(\)\.catch/);

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
  assert.match(styles, /\.session-channel-badge/);

  // 8. 渠道审批:createInboxItem 不能把内层 promise 包进 async 外层(会吞掉 .itemId,
  //    IM 回复「允许」路由不到挂起条目——regression);审批严格度可调,默认自动审核
  assert.doesNotMatch(main, /async function createInboxItem/);
  assert.match(main, /pending\.itemId = item\.id/);
  assert.match(main, /inboxPersistQueue/);
  assert.match(main, /settings\.channels\?\.approvalMode/);
  assert.match(settingsStorage, /approvalMode: source\.approvalMode === "interactive"/);
  assert.match(app, /审批严格度/);
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
