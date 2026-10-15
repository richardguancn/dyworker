// 窗口壳层预览入口：用指定平台标识和最小桥接桩渲染真实界面，供核对标题栏/侧栏排布。
// 用法：dev server 下打开 /tests/fixtures/shell-preview.html?platform=win32|linux|darwin
//
// 注意：除下面显式给出的初始状态外，所有桥接能力都返回空数组，事件订阅是空操作。
// 这个页面只用来比较不同平台的壳层排布，不能用来验证任何真实功能。

const platform = new URLSearchParams(location.search).get("platform") || "win32";

const settings = {
  identity: "general",
  endpoint: "",
  model: "",
  reasoningEffort: "",
  subAgentProfileId: "",
  apiKey: "",
  visionEndpoint: "",
  visionModel: "",
  visionApiKey: "",
  transcriptionEndpoint: "",
  transcriptionModel: "whisper-1",
  transcriptionEngine: "cloud",
  asrModel: "qwen3-asr-0.6b",
  asrModelDir: "",
  llamaServerPath: "",
  ttsEndpoint: "",
  ttsModel: "",
  ttsEngine: "cloud",
  ttsLocalModel: "qwen3-tts-1.7b-q8",
  ttsModelDir: "",
  ttsVoicePath: "",
  ttsApiKey: "",
  reviewerEndpoint: "",
  reviewerModel: "",
  reviewerApiKey: "",
  reviewerBackend: "main",
  reviewerModelDir: "",
  searxngEndpoint: "",
  bochaApiKey: "",
  deepseekSearchApiKey: "",
  domesticSearchOnly: false,
  enableNativeTools: true,
  nativeToolsDisabled: ["memory", "excel"],
  enableWebSearchBuiltin: false,
  telemetry: {
    statsEnabled: false,
    messagesEnabled: false,
    serviceUrl: "",
    notifyNewMessages: true,
    notifyMarketing: false,
    quietHours: "",
    dailyPopupLimit: 3,
  },
  approvalMode: "reviewer",
  preventSleep: "tasks",
  updateUrl: "https://github.com/richardguancn/dyworker",
  mcpServers: [],
  channels: { qq: { enabled: false, appId: "", appSecret: "" }, wechat: { enabled: false }, modelProfileId: "" },
  skillLibraries: [],
  profiles: [],
};

// 记录预览中的窗口操作；验收真实鼠标点击是否到达对应入口，不操作宿主窗口。
(window as any).__windowControlCalls = [];
const recordWindowControl = async (action: string) => {
  (window as any).__windowControlCalls.push(action);
};
const bridge = {
  minimize: () => recordWindowControl("minimize"),
  toggleMaximize: () => recordWindowControl("toggleMaximize"),
  close: () => recordWindowControl("close"),
  platform,
  getInitialState: async () => ({
    sessions: [],
    activeSessionId: null,
    workspacePath: "/tmp/dyworker-preview",
    workspaceEntries: [],
    pinnedWorkspacePaths: [],
    settings,
    platform,
    windowMaximized: false,
  }),
};

// 未实现的能力一律返回空数组（列表方法占绝大多数）；事件订阅返回空的取消函数。
(window as any).dyworker = new Proxy(bridge, {
  get(target, prop: string) {
    if (prop in target) return (target as any)[prop];
    if (prop.startsWith("on")) return () => () => {};
    return () => Promise.resolve([]);
  },
});

void import("../../src/main.tsx");
