const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dyworker", {
  getInitialState: () => ipcRenderer.invoke("app:initial-state"),
  saveSessions: (sessions) => ipcRenderer.invoke("sessions:save", sessions),
  savePinnedWorkspaces: (paths) => ipcRenderer.invoke("workspace-pins:save", paths),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  chooseAttachments: () => ipcRenderer.invoke("attachments:choose"),
  saveClipboardImage: (payload) => ipcRenderer.invoke("attachments:save-clipboard-image", payload),
  readClipboardText: () => ipcRenderer.invoke("clipboard:read-text"),
  writeClipboardText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  readLocalImage: (path) => ipcRenderer.invoke("local-image:read", path),
  refreshWorkspace: (path) => ipcRenderer.invoke("workspace:refresh", path),
  getWorkspaceContext: (path) => ipcRenderer.invoke("workspace:context", path),
  readWorkspaceMarkdown: (workspacePath, filePath) => ipcRenderer.invoke("workspace:read-markdown", { workspacePath, filePath }),
  readWorkspaceFile: (workspacePath, filePath) => ipcRenderer.invoke("workspace:read-file", { workspacePath, filePath }),
  writeWorkspaceFile: (workspacePath, filePath, content) => ipcRenderer.invoke("workspace:write-file", { workspacePath, filePath, content }),
  listTraces: (sessionId) => ipcRenderer.invoke("traces:list", sessionId),
  readTraces: (payload) => ipcRenderer.invoke("traces:read", payload),
  gitBranches: (workspacePath) => ipcRenderer.invoke("git:branches", workspacePath),
  gitDiffStats: (workspacePath) => ipcRenderer.invoke("git:diff-stats", workspacePath),
  gitCheckout: (workspacePath, branch) => ipcRenderer.invoke("git:checkout", { workspacePath, branch }),
  gitCreateBranch: (workspacePath, branch) => ipcRenderer.invoke("git:create-branch", { workspacePath, branch }),
  gitCommit: (payload) => ipcRenderer.invoke("git:commit", payload),
  gitPush: (workspacePath) => ipcRenderer.invoke("git:push", workspacePath),
  gitReviewOverview: (payload) => ipcRenderer.invoke("git:review-overview", payload),
  gitFileDiff: (payload) => ipcRenderer.invoke("git:file-diff", payload),
  gitStage: (workspacePath, paths) => ipcRenderer.invoke("git:stage", { workspacePath, paths }),
  gitDiscard: (workspacePath, paths) => ipcRenderer.invoke("git:discard", { workspacePath, paths }),
  listImportableBrowsers: () => ipcRenderer.invoke("browser-import:list"),
  importBrowserData: (payload) => ipcRenderer.invoke("browser-import:import", payload),
  listImportedHistory: () => ipcRenderer.invoke("browser-import:history"),
  getImportedLocalStorage: (origin) => ipcRenderer.invoke("browser-import:localstorage-entries", origin),
  markImportedLocalStorageDone: (origin) => ipcRenderer.invoke("browser-import:localstorage-done", origin),
  openPath: (path) => ipcRenderer.invoke("workspace:open", path),
  openBrowser: (payload) => ipcRenderer.invoke("browser:open", payload),
  onBrowserPanelRequest: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on("browser:panel-request", listener);
    return () => ipcRenderer.removeListener("browser:panel-request", listener);
  },
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  getReviewerLocalStatus: () => ipcRenderer.invoke("reviewer-local:status"),
  downloadReviewerLocalModel: () => ipcRenderer.invoke("reviewer-local:download"),
  chooseReviewerLocalDir: () => ipcRenderer.invoke("reviewer-local:choose-dir"),
  onReviewerLocalDownloadProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("reviewer-local:download-progress", listener);
    return () => ipcRenderer.removeListener("reviewer-local:download-progress", listener);
  },
  getVoiceLocalStatus: () => ipcRenderer.invoke("voice-local:status"),
  downloadVoiceLocalModel: () => ipcRenderer.invoke("voice-local:download"),
  chooseVoiceLocalDir: () => ipcRenderer.invoke("voice-local:choose-dir"),
  onVoiceLocalDownloadProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("voice-local:download-progress", listener);
    return () => ipcRenderer.removeListener("voice-local:download-progress", listener);
  },
  getTtsLocalStatus: () => ipcRenderer.invoke("tts-local:status"),
  downloadTtsLocalModel: () => ipcRenderer.invoke("tts-local:download"),
  chooseTtsLocalDir: () => ipcRenderer.invoke("tts-local:choose-dir"),
  chooseTtsVoice: () => ipcRenderer.invoke("tts-local:choose-voice"),
  onTtsLocalDownloadProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("tts-local:download-progress", listener);
    return () => ipcRenderer.removeListener("tts-local:download-progress", listener);
  },
  getAppUpdateStatus: () => ipcRenderer.invoke("app-update:status"),
  checkForAppUpdate: () => ipcRenderer.invoke("app-update:check"),
  downloadAppUpdate: () => ipcRenderer.invoke("app-update:download"),
  installAppUpdate: () => ipcRenderer.invoke("app-update:install"),
  onAppUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("app-update:status", listener);
    return () => ipcRenderer.removeListener("app-update:status", listener);
  },
  completeChat: (payload) => ipcRenderer.invoke("chat:complete", payload),
  sendTask: (payload) => ipcRenderer.invoke("agent:send", payload),
  removeQueuedTask: (payload) => ipcRenderer.invoke("agent:remove-queued", payload),
  runQueuedTaskNow: (payload) => ipcRenderer.invoke("agent:run-queued-now", payload),
  resolveApproval: (sessionId, actionId, approved) => ipcRenderer.invoke("agent:resolve-approval", { sessionId, actionId, approved }),
  cancelTask: (sessionId, runId) => ipcRenderer.invoke("agent:cancel", { sessionId, runId }),
  onAgentEvent: (callback) => {
    const listener = (_event, agentEvent) => callback(agentEvent);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  listMemories: () => ipcRenderer.invoke("memories:list"),
  listUsageStats: () => ipcRenderer.invoke("usage:list"),
  listHooks: () => ipcRenderer.invoke("hooks:list"),
  openUserHooks: () => ipcRenderer.invoke("hooks:open-user"),
  listRules: () => ipcRenderer.invoke("rules:list"),
  addRule: (rule) => ipcRenderer.invoke("rules:add", rule),
  deleteRule: (id) => ipcRenderer.invoke("rules:delete", id),
  openAuditLog: () => ipcRenderer.invoke("audit:open"),
  listInbox: () => ipcRenderer.invoke("inbox:list"),
  resolveInbox: (payload) => ipcRenderer.invoke("inbox:resolve", payload),
  dismissInbox: (id) => ipcRenderer.invoke("inbox:dismiss", id),
  resolveQuestion: (sessionId, requestId, answer) => ipcRenderer.invoke("agent:resolve-question", { sessionId, requestId, answer }),
  onInboxChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("inbox:changed", listener);
    return () => ipcRenderer.removeListener("inbox:changed", listener);
  },
  clearUsageStats: () => ipcRenderer.invoke("usage:clear"),
  deleteMemory: (id) => ipcRenderer.invoke("memories:delete", id),
  listSkills: (workspacePath) => ipcRenderer.invoke("skills:list", workspacePath),
  setSkillEnabled: (id, enabled, workspacePath) => ipcRenderer.invoke("skills:set-enabled", { id, enabled, workspacePath }),
  deleteSkill: (id) => ipcRenderer.invoke("skills:delete", id),
  searchSkillLibraries: (query) => ipcRenderer.invoke("skill-libraries:search", { query }),
  installSkillFromLibrary: (payload) => ipcRenderer.invoke("skill-libraries:install", payload),
  listSchedules: () => ipcRenderer.invoke("schedules:list"),
  saveSchedule: (payload) => ipcRenderer.invoke("schedules:save", payload),
  deleteSchedule: (id) => ipcRenderer.invoke("schedules:delete", id),
  setScheduleEnabled: (id, enabled) => ipcRenderer.invoke("schedules:set-enabled", { id, enabled }),
  triggerSchedule: (id) => ipcRenderer.invoke("schedules:trigger-now", id),
  onSchedulesChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("schedules:changed", listener);
    return () => ipcRenderer.removeListener("schedules:changed", listener);
  },
  onSessionPrepend: (callback) => {
    const listener = (_event, session) => callback(session);
    ipcRenderer.on("sessions:prepend", listener);
    return () => ipcRenderer.removeListener("sessions:prepend", listener);
  },
  onSessionAppend: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("sessions:append", listener);
    return () => ipcRenderer.removeListener("sessions:append", listener);
  },
  cancelWakesForSession: (sessionId) => ipcRenderer.invoke("wakes:cancel-for-session", sessionId),
  getChannelsStatus: () => ipcRenderer.invoke("channels:get-status"),
  onChannelsStatus: (callback) => {
    const listener = (_event, statusMap) => callback(statusMap);
    ipcRenderer.on("channels:status", listener);
    return () => ipcRenderer.removeListener("channels:status", listener);
  },
  transcribeAudio: (payload) => ipcRenderer.invoke("voice:transcribe", payload),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  onWindowStateChange: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on("window:maximized-changed", listener);
    return () => ipcRenderer.removeListener("window:maximized-changed", listener);
  },
  reportWindowPointerDown: () => ipcRenderer.send("window:pointer-down"),
});
