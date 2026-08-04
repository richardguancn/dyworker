const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dyworker", {
  getInitialState: () => ipcRenderer.invoke("app:initial-state"),
  saveSessions: (sessions) => ipcRenderer.invoke("sessions:save", sessions),
  savePinnedWorkspaces: (paths) => ipcRenderer.invoke("workspace-pins:save", paths),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  chooseAttachments: () => ipcRenderer.invoke("attachments:choose"),
  readLocalImage: (path) => ipcRenderer.invoke("local-image:read", path),
  refreshWorkspace: (path) => ipcRenderer.invoke("workspace:refresh", path),
  openPath: (path) => ipcRenderer.invoke("workspace:open", path),
  openBrowser: (payload) => ipcRenderer.invoke("browser:open", payload),
  onBrowserPanelRequest: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on("browser:panel-request", listener);
    return () => ipcRenderer.removeListener("browser:panel-request", listener);
  },
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  completeChat: (payload) => ipcRenderer.invoke("chat:complete", payload),
  sendTask: (payload) => ipcRenderer.invoke("agent:send", payload),
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
