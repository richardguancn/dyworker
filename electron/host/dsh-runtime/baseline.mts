// 固定到研究文档核对的官方发布组合；不跟随 npm latest 漂移。
export const DSH_VERSION = "0.2.1-alpha.1";
export const DSH_BASELINE = Object.freeze({
  "@deepseek-ai/cordis": "4.0.5-alpha.1",
  "@deepseek-ai/cordis-plugin-loader": "1.0.6-alpha.1",
  "@deepseek-ai/cordis-plugin-include": "1.0.10-alpha.1",
  "@deepseek-ai/cordis-plugin-group": "1.0.5-alpha.1",
  "@deepseek-ai/schemastery": "3.18.5-alpha.1",
  "@deepseek-ai/cordis-plugin-timer": "1.1.7-alpha.1",
  ...Object.fromEntries([
    "tools", "scope", "session", "system-prompt", "session-projection", "fs", "fs-local",
    "agent", "llm", "sandbox", "sandbox-policy", "ptc-runtime", "user-approval",
    "agent-loop", "session-persistence", "session-persistence-jsonl", "session-query", "session-query-sqlite",
    "session-title", "session-format-catalog", "settings", "config-editor", "storage", "storage-json", "storage-domain",
    "session-projection-cache", "compaction", "compaction-basic", "compaction-tool-result-pruner", "token-meter",
    "subagent", "subagent-spawn-in-process", "subagent-fork-in-process", "subagent-in-process-driver",
    "tool-subagent", "tool-subagent-control", "workflow", "workflow-ptc", "tool-workflow", "ptc-runtime-node",
    "workspace", "commands", "hmr", "app-boot", "subprocess", "agent-preset-registry", "attachment",
    "jobs", "permission-presets", "util-time", "llm-retry", "home-paths", "launch-environment", "client-store",
    "user-questions", "tool-ask-user",
    "subprocess-local", "sandbox-local", "timeout", "http-proxy", "skill", "shell", "cmdline",
    "jobs-local", "tool-jobs", "output-retention", "attachment-local", "lazy-require", "client-ui-dockkit", "client-file-upload",
  ].map(name => [`@deepseek-ai/dsh-${name}`, DSH_VERSION])),
});
// 提示服务由官方工具内部使用；尚未对接完整提示装配，不能向依赖它的插件声称支持。
export const DSH_RUNTIME_SERVICES = ["tools", "sessions", "sessionProjections", "fs"];
// 第二层实际装配的服务；不扩大第一层的能力声明。
export const DSH_SESSION_SERVICES = [...DSH_RUNTIME_SERVICES, "llm", "agents", "agentLoop", "systemPrompt",
  "sessionPersistence", "sessionQuery", "storage", "sessionProjectionCache", "tokenMeter", "compaction",
  "subagents", "userQuestions", "sandboxPolicy", "jobs", "ptcRuntime", "workflowEngine",
  "connection", "loader", "configEditor", "settings", "profileContext", "attachments", "commands", "fileUploads"];
export function isDshPackage(manifest: any) {
  return !manifest.dyworker && Boolean(manifest.dsh || /^(?:@deepseek-ai\/)?dsh-/.test(manifest.name || ""));
}
export const DSH_SUPPORT = Object.freeze([
  { name: "dsh-office-tools", version: "1.0.5", scope: "Word、Excel、PowerPoint 文件工具", runtime: DSH_VERSION },
  { name: "@deepseek-ai/dsh-tool-todo", version: DSH_VERSION, scope: "待办工具及会话记录", runtime: DSH_VERSION },
]);
