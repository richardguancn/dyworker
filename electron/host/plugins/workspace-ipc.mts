// IPC 域插件：工作区（workspace:* / workspace-pins:*）。
// 领域能力来自 electron/workspace.mts（纯函数，直接 import）；
// 桌面边界（原生目录选择器/系统打开/文件管理器定位）与状态文件由壳层注入。
import { snapshotFileBeforeOverwrite } from "../state-snapshot.mts";
import { getWorkspaceContext, listWorkspace, readWorkspaceFile, readWorkspaceMarkdown, writeWorkspaceFile } from "../../workspace.mts";

export function workspaceIpcPlugin(deps) {
  return {
    name: "ipc:workspace",
    apply(ctx) {
      const { trustedHandle, dataFile, readJson, writeJson, dialog, shell, getMainWindow, isTrustedRendererUrl } = deps;

      trustedHandle("workspace:choose", async () => {
        const result = await dialog.showOpenDialog(getMainWindow(), {
          title: "选择工作文件夹",
          properties: ["openDirectory", "createDirectory"],
        });
        if (result.canceled || !result.filePaths[0]) return { canceled: true };
        const selectedPath = result.filePaths[0];
        return { canceled: false, path: selectedPath, entries: await listWorkspace(selectedPath) };
      });

      trustedHandle("workspace:refresh", (_event, workspacePath) => listWorkspace(String(workspacePath || "")));

      // 工作区上下文（目录名/Git 分支）也在 git-ipc 里注册了一次；这里保留读取类通道
      trustedHandle("workspace:context", (_event, workspacePath) => getWorkspaceContext(String(workspacePath || "")));

      trustedHandle("workspace:read-markdown", (event, payload) => {
        if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许读取工作目录文件" };
        return readWorkspaceMarkdown(String(payload?.workspacePath || ""), String(payload?.filePath || ""));
      });

      trustedHandle("workspace:read-file", (event, payload) => {
        if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许读取工作目录文件" };
        return readWorkspaceFile(String(payload?.workspacePath || ""), String(payload?.filePath || ""));
      });

      trustedHandle("workspace:write-file", (event, payload) => {
        if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许写入工作目录文件" };
        return writeWorkspaceFile(String(payload?.workspacePath || ""), String(payload?.filePath || ""), String(payload?.content ?? ""));
      });

      trustedHandle("workspace:open", async (event, targetPath) => {
        if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许打开本地文件" };
        const error = await shell.openPath(String(targetPath || ""));
        return error ? { ok: false, error } : { ok: true };
      });

      // 在系统文件管理器中定位文件（访达/资源管理器选中该文件所在目录项）
      trustedHandle("workspace:reveal", async (event, targetPath) => {
        if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许打开本地文件" };
        const target = String(targetPath || "");
        if (!target) return { ok: false, error: "路径为空" };
        shell.showItemInFolder(target);
        return { ok: true };
      });

      trustedHandle("workspace-pins:save", async (_event, paths) => {
        try {
          const normalized = Array.isArray(paths)
            ? [...new Set(paths.map((item) => String(item || "").trim()).filter(Boolean))]
            : [];
          const file = dataFile("workspace-pins.json");
          // 由"有"变"无"时先留快照：整份覆盖曾是配置丢失的入口（异常启动把置顶冲成 []）
          if (!normalized.length) {
            const stored = await readJson(file, []);
            if (Array.isArray(stored) && stored.length) await snapshotFileBeforeOverwrite(file);
          }
          await writeJson(file, normalized);
          return { ok: true };
        } catch (error: any) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
    },
  };
}
