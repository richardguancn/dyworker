// IPC 域插件：会话/项目的跨机迁移（sessions:export-package / sessions:import-package）。
// 领域逻辑在 electron/session-transfer.mts（纯函数），这里只接桌面边界：
// 原生保存/打开对话框、附件与包文件读写、会话存档落盘、项目置顶配置。
import os from "node:os";
import {
  TRANSFER_EXTENSION,
  applyImportPlan,
  buildTransferPackage,
  collectAttachments,
  exportFileName,
  parseTransferPackage,
  planImport,
  projectTitle,
  safeSegment,
} from "../../session-transfer.mts";

// 导入包大小上限：防一个误选的超大文件把主进程内存吃掉（正常包远小于此）
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;

export function transferIpcPlugin(deps) {
  return {
    name: "ipc:transfer",
    inject: ["sessions"],
    apply(ctx) {
      const { trustedHandle, dialog, fs, app, path, getMainWindow, dataFile, readJson, writeJson, readAllSessions, platform } = deps;

      const readAll = async () => {
        try {
          const loaded = await readAllSessions();
          return Array.isArray(loaded) ? loaded : [];
        } catch {
          return [];
        }
      };

      const readPinnedWorkspaces = async () => {
        const stored = await readJson(dataFile("workspace-pins.json"), []);
        return Array.isArray(stored) ? stored.filter((item) => typeof item === "string" && item.trim()) : [];
      };

      const isDirectory = async (target) => {
        if (!target) return false;
        try {
          return (await fs.stat(target)).isDirectory();
        } catch {
          return false;
        }
      };

      trustedHandle("sessions:export-package", async (_event, payload) => {
        try {
          const kind = payload?.kind === "project" ? "project" : "session";
          const all = await readAll();
          let sessions = [];
          let project = null;
          if (kind === "project") {
            const workspacePath = String(payload?.workspacePath || "").trim();
            if (!workspacePath) return { ok: false, error: "请先选择要导出的项目" };
            sessions = all.filter((session) => String(session?.workspacePath || "") === workspacePath);
            if (!sessions.length) return { ok: false, error: "这个项目下还没有任务，没有可导出的内容" };
            const pinned = await readPinnedWorkspaces();
            project = { path: workspacePath, title: projectTitle(workspacePath), pinned: pinned.includes(workspacePath) };
          } else {
            const sessionId = String(payload?.sessionId || "");
            const session = all.find((item) => String(item?.id) === sessionId) || ctx.sessions.get(sessionId);
            if (!session) return { ok: false, error: "找不到要导出的任务" };
            sessions = [session];
            project = session.workspacePath ? { path: String(session.workspacePath), title: projectTitle(session.workspacePath) } : null;
          }

          const title = kind === "project" ? project?.title || "项目" : String(sessions[0]?.title || "任务");
          const collected = payload?.includeAttachments === false
            ? { attachments: [], skippedAttachments: [], bytes: 0 }
            : await collectAttachments(sessions, async (filePath) => fs.readFile(filePath));

          const pkg = buildTransferPackage({
            kind,
            sessions,
            project,
            appVersion: app.getVersion(),
            platform: platform || process.platform,
            host: os.hostname(),
            attachments: collected.attachments,
            skippedAttachments: collected.skippedAttachments,
          });

          const result = await dialog.showSaveDialog(getMainWindow(), {
            title: kind === "project" ? "导出项目" : "导出任务",
            defaultPath: path.join(app.getPath("documents"), exportFileName(title, kind)),
            filters: [{ name: "DYWorker 迁移包", extensions: [TRANSFER_EXTENSION] }],
          });
          if (result.canceled || !result.filePath) return { ok: true, canceled: true };

          const target = result.filePath.endsWith(`.${TRANSFER_EXTENSION}`) ? result.filePath : `${result.filePath}.${TRANSFER_EXTENSION}`;
          // 用户可能在对话框里手打了还不存在的子目录，先建父目录再写
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, JSON.stringify(pkg, null, 2), "utf8");
          return {
            ok: true,
            canceled: false,
            path: target,
            title,
            sessions: pkg.sessions.length,
            attachments: pkg.attachments.length,
            skippedAttachments: pkg.skippedAttachments,
          };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });

      trustedHandle("sessions:import-package", async () => {
        try {
          const picked = await dialog.showOpenDialog(getMainWindow(), {
            title: "导入任务或项目",
            properties: ["openFile"],
            filters: [
              { name: "DYWorker 迁移包", extensions: [TRANSFER_EXTENSION, "json"] },
              { name: "全部文件", extensions: ["*"] },
            ],
          });
          if (picked.canceled || !picked.filePaths[0]) return { ok: true, canceled: true };

          const source = picked.filePaths[0];
          const stat = await fs.stat(source);
          if (stat.size > MAX_PACKAGE_BYTES) return { ok: false, error: "迁移包超过 512MB，无法导入" };
          const parsed = parseTransferPackage(await fs.readFile(source, "utf8"));
          if (!parsed.ok) return { ok: false, error: parsed.error };
          const pkg = parsed.package;

          // 包内工作目录是否已存在于本机：先异步探一遍，planImport 保持纯同步语义
          const candidates = new Set<string>();
          for (const session of pkg.sessions) {
            const workspacePath = String(session?.workspacePath || "");
            if (workspacePath) candidates.add(workspacePath);
          }
          if (pkg.project?.path) candidates.add(pkg.project.path);
          const existing = new Set<string>();
          for (const candidate of candidates) if (await isDirectory(candidate)) existing.add(candidate);

          const plan = planImport(pkg, {
            hasSession: (id) => !!ctx.sessions.get(id),
            workspaceExists: (workspacePath) => existing.has(workspacePath),
          });

          // 原机器的工作目录在本机大概率不存在：逐个问用户放到哪里。
          // 用户取消就保留原路径（历史照常导入，工作目录需要时再切换）。
          const workspaceMapping = {};
          for (const workspace of plan.workspaces) {
            if (workspace.exists) continue;
            const chosen = await dialog.showOpenDialog(getMainWindow(), {
              title: `选择项目「${workspace.title}」在本机的位置`,
              message: `原电脑上的目录：${workspace.path}\n不选则保留原路径（任务历史仍会导入，但工作目录不可用）。`,
              buttonLabel: "使用这个目录",
              properties: ["openDirectory", "createDirectory"],
            });
            const target = chosen.canceled ? "" : String(chosen.filePaths?.[0] || "");
            if (target) workspaceMapping[workspace.path] = target;
          }

          // 附件落到 userData/transfer-attachments/<会话>/ 下，按包内顺序编号避免重名覆盖
          const attachmentPaths = new Map<string, string>();
          const attachmentRoot = path.join(app.getPath("userData"), "transfer-attachments");
          let restoredAttachments = 0;
          const skipped = [...pkg.skippedAttachments].map((item) => item.name);
          for (const [index, attachment] of plan.attachments.entries()) {
            const folder = path.join(attachmentRoot, safeSegment(attachment.sessionId, "session"));
            const file = path.join(folder, `${String(index + 1).padStart(3, "0")}-${safeSegment(attachment.name, "attachment")}`);
            try {
              await fs.mkdir(folder, { recursive: true });
              await fs.writeFile(file, Buffer.from(attachment.dataBase64, "base64"));
              attachmentPaths.set(String(attachment.path), file);
              restoredAttachments += 1;
            } catch {
              skipped.push(attachment.name);
            }
          }

          const sessions = applyImportPlan(plan, { workspaceMapping, attachmentPaths });
          for (const session of sessions) await ctx.sessions.replace(session);

          // 项目原本置顶：导入后把映射过的目录也置顶（配置只追加，不动现有置顶）
          let pinnedAdded = "";
          if (plan.project?.pinned) {
            const targetPath = workspaceMapping[plan.project.path] || plan.project.path;
            if (targetPath && (await isDirectory(targetPath))) {
              const pinned = await readPinnedWorkspaces();
              if (!pinned.includes(targetPath)) {
                await writeJson(dataFile("workspace-pins.json"), [...pinned, targetPath]);
                pinnedAdded = targetPath;
              }
            }
          }

          const missingWorkspaces = plan.workspaces
            .filter((workspace) => !workspace.exists && !workspaceMapping[workspace.path])
            .map((workspace) => workspace.path);

          return {
            ok: true,
            canceled: false,
            kind: plan.kind,
            sessions,
            added: sessions.length,
            renamed: plan.entries.filter((entry) => entry.renamed).length,
            attachments: restoredAttachments,
            skippedAttachments: skipped,
            missingWorkspaces,
            pinnedWorkspace: pinnedAdded,
            project: plan.project ? { ...plan.project, path: workspaceMapping[plan.project.path] || plan.project.path } : null,
            source,
          };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
    },
  };
}
