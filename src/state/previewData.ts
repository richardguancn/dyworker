import type { SessionRecord, WorkspaceEntry } from "../types";

const now = new Date().toISOString();

export const previewSessions: SessionRecord[] = [
  {
    id: "codex-layout",
    title: "优化 UI 布局为 Codex 风格",
    workspacePath: "/workspace/dyworker",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        role: "user",
        createdAt: now,
        content: "主区域对话内容块的样式也要跟 Codex 对齐。",
      },
      {
        role: "assistant",
        createdAt: now,
        plan: [
          { title: "对比 Codex 参考截图与当前布局", status: "completed" },
          { title: "调整用户消息与助手回复样式", status: "completed" },
          { title: "统一 Markdown 内容层级", status: "completed" },
        ],
        changes: [
          {
            path: "src/styles.css",
            added: 3,
            removed: 2,
            diff: "--- a/src/styles.css\n+++ b/src/styles.css\n@@ -892,7 +892,7 @@\n .user-bubble {\n-  max-width: min(680px, 76%);\n-  padding: 11px 16px;\n+  max-width: min(680px, 78%);\n+  padding: 10px 16px;\n+  border-radius: 14px;\n   background: #efeee9;",
          },
          { path: "src/App.tsx", added: 58, removed: 23 },
        ],
        durationMs: 185_000,
        activities: [
          { id: "preview-act-1", kind: "read_file", title: "读取 src/App.tsx", detail: "界面主组件", status: "success" },
          { id: "preview-act-2", kind: "edit_file", title: "编辑 src/styles.css", detail: "已编辑 src/styles.css（+96 -41）", status: "success" },
        ],
        content:
          "**已完成主对话区优化：**\n\n- 用户消息改为 Codex 风格的浅灰内容块。\n- 助手回复采用开放式排版，不再堆叠卡片和分割线。\n- 统一了标题、正文、列表、引用、表格和代码内容的层级与间距。\n- 长内容更容易连续阅读，重要信息也更容易扫描。\n\n新界面已经切换到 Electron，后续可以继续完善任务执行和文件处理能力。",
      },
    ],
  },
  {
    id: "model-settings",
    title: "修复模型切换参数错误",
    workspacePath: "/workspace/dyworker",
    createdAt: now,
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    messages: [],
  },
  {
    id: "project-readme",
    title: "完善项目使用说明",
    workspacePath: "/workspace/dyworker",
    createdAt: now,
    updatedAt: new Date(Date.now() - 120_000).toISOString(),
    messages: [],
  },
];

export const previewWorkspace: WorkspaceEntry[] = [
  { name: "build", path: "/dyworker/build", kind: "directory", children: [] },
  {
    name: "electron",
    path: "/dyworker/electron",
    kind: "directory",
    children: [
      { name: "channels", path: "/dyworker/electron/channels", kind: "directory", children: [] },
      { name: "main.mjs", path: "/dyworker/electron/main.mjs", kind: "file" },
      { name: "agent.mjs", path: "/dyworker/electron/agent.mjs", kind: "file" },
    ],
  },
  { name: "src", path: "/dyworker/src", kind: "directory", children: [] },
  { name: "tests", path: "/dyworker/tests", kind: "directory", children: [] },
];
