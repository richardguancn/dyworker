// IPC 域插件：局域网发现与点对点分享（lan-share:*）。
// - 启动即通过 UDP 广播自动发现同网段在线 DYWorker 用户（默认开启，可隐身、可自定义昵称）
// - 会话/项目分享复用 transfer-ipc.mts 的迁移打包与导入落盘流水线
// - 本地插件分享复用 plugin-share.mts 的 .dyplugin 打包与受管目录解包安装流水线

import { randomBytes } from "node:crypto";
import { promises as fsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LanShareService } from "../../lan-share.mts";
import { tryBuildOfflineLocalInstallRunner } from "../../plugin-authoring.mts";
import { exportPluginSharePackage, unpackSharePackageToManagedDir } from "../../plugin-share.mts";
import { exportFileName, parseTransferPackage } from "../../session-transfer.mts";
import { commitTransferPackageImport, prepareTransferPackagePayload } from "./transfer-ipc.mts";

function loadOrCreateDeviceId(dataDir: string): string {
  const file = path.join(dataDir, "lan-device-id.txt");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (/^[a-f0-9]{16,64}$/i.test(existing)) return existing;
  } catch {}
  const generated = randomBytes(16).toString("hex");
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, `${generated}\n`, "utf8");
  } catch {}
  return generated;
}

export function resolveLanLoginAccount(settings: any): string {
  const candidates = [
    settings?.account?.username,
    settings?.account?.email,
    settings?.account?.displayName,
    settings?.account?.name,
    typeof settings?.account === "string" ? settings.account : "",
    settings?.channels?.wechat?.userId,
  ];
  for (const item of candidates) {
    const text = String(item || "").trim();
    if (text) return text;
  }
  return "";
}

export function lanShareIpcPlugin(deps: any) {
  return {
    name: "ipc:lan-share",
    inject: ["sessions", "plugins"],
    apply(ctx: any) {
      const {
        trustedHandle,
        app,
        appVersion,
        readSettings,
        saveSettings,
        getMainWindow,
        getWebContents,
        notifyPluginsUpdated,
        notifyLanIncoming,
      } = deps;

      const dataDir = String(deps.dataDir || app?.getPath?.("userData") || os.tmpdir());
      const deviceId = loadOrCreateDeviceId(dataDir);

      let cachedSettings: any = { lanShare: { enabled: true, nickname: "" } };
      const refreshSettingsSnapshot = async () => {
        try {
          cachedSettings = await readSettings();
        } catch {}
      };
      void refreshSettingsSnapshot();

      const broadcast = (channel: string, payload: any) => {
        const list = typeof getWebContents === "function" ? getWebContents() : [];
        for (const wc of list) {
          if (!wc || wc.isDestroyed?.()) continue;
          try {
            wc.send?.(channel, payload);
          } catch {}
        }
      };

      const service = new LanShareService({
        deviceId,
        appVersion: String(appVersion || app?.getVersion?.() || ""),
        getConfig: () => ({
          discoverable: cachedSettings?.lanShare?.enabled !== false,
          nickname: String(cachedSettings?.lanShare?.nickname || ""),
          loginAccount: resolveLanLoginAccount(cachedSettings),
        }),
        onPeersChanged: (peers) => {
          broadcast("lan-share:peers-updated", peers);
        },
        onIncomingOffer: (offer) => {
          broadcast("lan-share:incoming-request", offer);
          const win = getMainWindow?.();
          const needNotify = !win || win.isDestroyed?.() || !win.isVisible?.() || win.isMinimized?.() || !win.isFocused?.();
          if (needNotify) {
            notifyLanIncoming?.(offer);
          }
        },
        onIncomingCancelled: (transferId) => {
          broadcast("lan-share:incoming-cancelled", { transferId });
        },
        onTransferUpdate: (transfer) => {
          broadcast("lan-share:transfer-update", transfer);
        },
        onImportPayload: async (offer, buffer, importOptions) => {
          if (offer.kind === "plugin") {
            const storageRoot = ctx.get("storage")?.root || path.join(ctx.plugins?.dir || dataDir, "data");
            const unpacked = await unpackSharePackageToManagedDir({
              buffer,
              fileName: offer.fileName,
              dataDir,
              storageRoot,
              importData: importOptions?.importData !== false,
              overwriteData: Boolean(importOptions?.overwriteData),
            });
            if (!unpacked?.ok || !unpacked.pluginDir) {
              return unpacked;
            }
            const localFast = await tryBuildOfflineLocalInstallRunner(unpacked.pluginDir);
            const installed = await ctx.plugins.installPackage({
              input: unpacked.pluginDir,
              allowIncompatible: Boolean(importOptions?.allowIncompatible),
              ...(localFast?.ok && localFast.run ? { run: localFast.run } : {}),
            });
            if (!installed?.ok) {
              return installed;
            }
            const entries = typeof ctx.plugins.entries === "function" ? ctx.plugins.entries() : [];
            const matched = entries.find((item: any) =>
              item && (item.id === installed.id || item.name === unpacked.packageName || item.id === unpacked.packageName),
            );
            const entryId = String(matched?.id || installed.id || unpacked.packageName);
            if (matched?.disabled) {
              await ctx.plugins.setEnabled(entryId, true).catch(() => null);
            }
            notifyPluginsUpdated?.();
            const result = {
              ...installed,
              ok: true,
              entryId,
              packageName: unpacked.packageName,
              displayName: unpacked.displayName,
              version: unpacked.version,
              pluginDir: unpacked.pluginDir,
              importedDataFiles: unpacked.importedDataFiles,
              skippedDataFiles: unpacked.skippedDataFiles,
            };
            broadcast("lan-share:imported", { kind: "plugin", offer, result });
            return result;
          }

          // 会话 / 项目迁移包导入
          const parsed = parseTransferPackage(buffer.toString("utf8"));
          if (!parsed.ok || !parsed.package) {
            return { ok: false, error: parsed.error || "收到的会话数据格式无效" };
          }
          const result = await commitTransferPackageImport(ctx, deps, parsed.package, { source: "lan" });
          if (result?.ok) {
            broadcast("lan-share:imported", { kind: offer.kind, offer, result });
          }
          return result;
        },
      });

      void refreshSettingsSnapshot().then(() => service.start()).catch(() => {});
      ctx.effect(() => () => service.stop());

      trustedHandle("lan-share:get-state", async () => {
        await refreshSettingsSnapshot();
        return { ok: true, ...service.getState() };
      });

      trustedHandle("lan-share:update-config", async (_event, payload) => {
        try {
          const current = await readSettings();
          const prev = current?.lanShare || { enabled: true, nickname: "" };
          const nextLanShare = {
            enabled: payload?.enabled !== undefined ? Boolean(payload.enabled) : prev.enabled !== false,
            nickname: payload?.nickname !== undefined ? String(payload.nickname || "").trim().slice(0, 40) : String(prev.nickname || ""),
          };
          const saved = await saveSettings({ ...current, lanShare: nextLanShare });
          cachedSettings = saved;
          service.syncVisibility();
          return { ok: true, ...service.getState() };
        } catch (error: any) {
          return { ok: false, error: String(error?.message || error) };
        }
      });

      trustedHandle("lan-share:refresh-peers", async () => {
        await refreshSettingsSnapshot();
        const peers = service.refreshPeers();
        return { ok: true, peers, self: service.getIdentity() };
      });

      trustedHandle("lan-share:send", async (_event, payload) => {
        try {
          await refreshSettingsSnapshot();
          const peerId = String(payload?.peerId || "").trim();
          const kind = payload?.kind === "project" ? "project" : payload?.kind === "plugin" ? "plugin" : "session";

          if (kind === "plugin") {
            const target = String(payload?.pluginTarget || "").trim();
            if (!target) return { ok: false, error: "缺少要分享的插件标识" };
            const storageRoot = ctx.get("storage")?.root || path.join(ctx.plugins?.dir || dataDir, "data");
            const tempDir = await fsSync.mkdtemp(path.join(os.tmpdir(), "dyworker-lan-plugin-"));
            const tempFile = path.join(tempDir, "share.dyplugin");
            try {
              const exported = await exportPluginSharePackage(ctx, {
                target,
                outputPath: tempFile,
                includeData: Boolean(payload?.includeData),
                dataDir,
                storageRoot,
                appVersion: String(appVersion || app?.getVersion?.() || ""),
              });
              if (!exported?.ok || !exported.path) {
                return { ok: false, error: exported?.error || "插件打包失败" };
              }
              const buffer = await fsSync.readFile(exported.path);
              return await service.sendOffer({
                peerId,
                kind: "plugin",
                title: exported.displayName || exported.packageName || target,
                fileName: path.basename(exported.path),
                meta: {
                  packageName: exported.packageName,
                  pluginVersion: exported.version,
                  includesData: exported.includesData,
                  includedDataFiles: exported.includedDataFiles || [],
                  warningsCount: exported.warnings?.length || 0,
                },
                payloadBuffer: buffer,
              });
            } finally {
              await fsSync.rm(tempDir, { recursive: true, force: true }).catch(() => {});
            }
          }

          const prepared = await prepareTransferPackagePayload(ctx, deps, {
            kind,
            sessionId: payload?.sessionId,
            workspacePath: payload?.workspacePath,
            includeAttachments: payload?.includeAttachments !== false,
          });
          if (!prepared.ok) return prepared;

          const { title, pkg } = prepared;
          const payloadBuffer = Buffer.from(JSON.stringify(pkg), "utf8");
          return await service.sendOffer({
            peerId,
            kind,
            title,
            fileName: exportFileName(title, kind),
            meta: {
              sessionCount: pkg.sessions.length,
              attachmentCount: pkg.attachments.length,
              skippedAttachmentCount: pkg.skippedAttachments.length,
              projectTitle: pkg.project?.title || "",
            },
            payloadBuffer,
          });
        } catch (error: any) {
          return { ok: false, error: String(error?.message || error) };
        }
      });

      trustedHandle("lan-share:cancel-send", async (_event, payload) => {
        return await service.cancelOutgoing(String(payload?.transferId || "").trim());
      });

      trustedHandle("lan-share:respond-incoming", async (_event, payload) => {
        const transferId = String(payload?.transferId || "").trim();
        const accepted = Boolean(payload?.accepted);
        return await service.respondIncoming(transferId, {
          accepted,
          importOptions: {
            importData: payload?.importData !== false,
            overwriteData: Boolean(payload?.overwriteData),
            allowIncompatible: Boolean(payload?.allowIncompatible),
          },
        });
      });
    },
  };
}
