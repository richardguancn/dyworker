import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Folder, Loader2, MessageSquare, Package, Radio, UserCheck, X } from "lucide-react";
import { PluginGlyph, pluginTileStyle } from "../../lib/pluginIcons";
import { formatShareBytes } from "../../lib/pluginShare";
import { useLanShareStore } from "../../state/lanShareStore";
import { useSessionStore } from "../../state/sessionStore";
import { pluginHotMountRef } from "../../state/sharedRefs";
import { useViewStore } from "../../state/viewStore";
import type { LanShareKind, SessionRecord } from "../../types";

function kindTitle(kind: LanShareKind): string {
  if (kind === "project") return "项目";
  if (kind === "plugin") return "插件";
  return "任务会话";
}

function platformLabel(platform: string): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform || "";
}

export function LanShareIncomingDialog() {
  const incomingQueue = useLanShareStore((s) => s.incomingQueue);
  const setIncomingQueue = useLanShareStore((s) => s.setIncomingQueue);
  const pushIncomingOffer = useLanShareStore((s) => s.pushIncomingOffer);
  const removeIncomingOffer = useLanShareStore((s) => s.removeIncomingOffer);

  const [busyAction, setBusyAction] = useState<"" | "accept" | "reject">("");
  const [importData, setImportData] = useState(true);
  const [overwriteData, setOverwriteData] = useState(false);
  const [error, setError] = useState("");

  const current = incomingQueue[0] || null;
  const bridge = typeof window !== "undefined" ? window.dyworker : undefined;

  useEffect(() => {
    if (!current) return;
    setImportData(Boolean(current.meta?.includesData));
    setOverwriteData(false);
    setError("");
  }, [current?.transferId]);

  useEffect(() => {
    if (!bridge) return;
    void bridge.getLanShareState?.().then((state) => {
      if (state?.ok && Array.isArray(state.incoming) && state.incoming.length) {
        setIncomingQueue(state.incoming);
      }
    }).catch(() => {});

    const offIncoming = bridge.onLanShareIncoming?.((offer) => {
      pushIncomingOffer(offer);
    });
    const offCancelled = bridge.onLanShareIncomingCancelled?.((payload) => {
      if (payload?.transferId) removeIncomingOffer(payload.transferId);
    });
    const offImported = bridge.onLanShareImported?.((payload) => {
      const { setNotice, setError: setViewError } = useViewStore.getState();
      if (payload?.kind === "plugin") {
        const res = payload.result || {};
        const entryId = String(res.entryId || res.packageName || "");
        if (entryId) {
          void pluginHotMountRef.current.mountClientPlugin(entryId, { openSlot: true }).catch(() => null);
        }
        setNotice(`已从局域网接收并安装插件「${res.displayName || payload.offer?.title || entryId}」`);
        return;
      }

      const res = payload?.result;
      const imported: SessionRecord[] = Array.isArray(res?.sessions) ? res.sessions : [];
      if (!imported.length) return;
      const { setSessions, setPendingAutoOpenSessionId, setPinnedWorkspacePaths } = useSessionStore.getState();
      const importedIds = new Set(imported.map((item) => item.id));
      setSessions((list) => [...imported, ...list.filter((item) => !importedIds.has(item.id))]);
      if (res?.pinnedWorkspace) {
        setPinnedWorkspacePaths((list) => (list.includes(res.pinnedWorkspace) ? list : [...list, res.pinnedWorkspace]));
      }
      setPendingAutoOpenSessionId(imported[0].id);

      const parts = [`已从局域网接收并导入 ${res?.added || imported.length} 个任务`];
      if (res?.attachments) parts.push(`${res.attachments} 个附件`);
      if (res?.renamed) parts.push(`${res.renamed} 个任务编号重复已另存`);
      setNotice(parts.join("，"));
      if (res?.missingWorkspaces?.length) {
        setViewError(`以下工作目录在本机不存在，任务已导入但工作目录不可用：${res.missingWorkspaces.join("、")}`);
      }
    });

    return () => {
      offIncoming?.();
      offCancelled?.();
      offImported?.();
    };
  }, [bridge, pushIncomingOffer, removeIncomingOffer, setIncomingQueue]);

  if (!current) return null;

  const handleRespond = async (accepted: boolean) => {
    if (!bridge?.respondLanShareIncoming || busyAction) return;
    setError("");
    setBusyAction(accepted ? "accept" : "reject");
    try {
      const res = await bridge.respondLanShareIncoming({
        transferId: current.transferId,
        accepted,
        importData,
        overwriteData,
      });
      if (!accepted) {
        removeIncomingOffer(current.transferId);
        return;
      }
      if (!res?.ok) {
        setError(res?.error || "接收并导入失败");
        return;
      }
      removeIncomingOffer(current.transferId);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusyAction("");
    }
  };

  const KindIcon = current.kind === "project" ? Folder : current.kind === "plugin" ? Package : MessageSquare;
  const senderLabel = current.sender?.displayName || current.sender?.account || current.sender?.host || "局域网用户";
  const hasPluginData = current.kind === "plugin" && Boolean(current.meta?.includesData);
  const pluginIconId = current.kind === "plugin" ? String(current.meta?.icon || "").trim() : "";
  const pluginIconColor = current.kind === "plugin" ? String(current.meta?.iconColor || "").trim() : "";
  const pluginAuthor = current.kind === "plugin" ? String(current.meta?.author || "").trim() : "";
  const pluginTileCss = current.kind === "plugin"
    ? pluginTileStyle(pluginIconColor, String(current.meta?.packageName || current.title))
    : undefined;

  return createPortal(
    <div className="dialog-overlay" role="dialog" aria-label="收到局域网分享">
      <div className="add-plugin-dialog lan-share-incoming-dialog">
        <header className="add-plugin-header">
          <div className="add-plugin-header-title">
            <h2>
              收到局域网分享
              {incomingQueue.length > 1 ? `（1 / ${incomingQueue.length}）` : ""}
            </h2>
            <p className="add-plugin-sub">确认接收后将自动从发送方传输并导入到你的 DYWorker。</p>
          </div>
          <button
            className="icon-button subtle"
            disabled={busyAction !== ""}
            onClick={() => void handleRespond(false)}
            aria-label="拒绝并关闭"
          >
            <X size={16} />
          </button>
        </header>

        <div className="lan-share-sender-card">
          <div className="lan-share-peer-avatar">{senderLabel.slice(0, 1).toUpperCase()}</div>
          <div className="lan-share-peer-info">
            <div className="lan-share-peer-name">
              <strong>{senderLabel}</strong>
              {current.sender?.account ? (
                <span className="lan-share-account-badge">
                  <UserCheck size={11} /> {current.sender.account}
                </span>
              ) : null}
            </div>
            <div className="lan-share-peer-meta">
              <Radio size={11} />
              <span>{current.sender?.host || "未知设备"}</span>
              {current.sender?.platform ? (
                <>
                  <span>·</span>
                  <span>{platformLabel(current.sender.platform)}</span>
                </>
              ) : null}
              <span>·</span>
              <span>{current.senderIp}</span>
            </div>
          </div>
        </div>

        <div className="lan-share-target-card">
          <div className="lan-share-target-icon" style={pluginTileCss}>
            {current.kind === "plugin"
              ? <PluginGlyph iconId={pluginIconId} color={pluginIconColor} size={18} />
              : <KindIcon size={18} />}
          </div>
          <div className="lan-share-target-body">
            <div className="lan-share-target-head">
              <span className="plugin-tag">{kindTitle(current.kind)}</span>
              <strong>{current.title}</strong>
              {pluginAuthor ? <span className="plugin-tag">{pluginAuthor}</span> : null}
              <span className="plugin-tag">{formatShareBytes(current.sizeBytes)}</span>
            </div>
            <p>
              {current.kind === "plugin"
                ? `包名：${current.meta?.packageName || current.fileName}${current.meta?.pluginVersion ? ` · v${current.meta.pluginVersion}` : ""}`
                : `${current.meta?.sessionCount || 1} 个任务${current.meta?.attachmentCount ? ` · ${current.meta.attachmentCount} 个附件` : ""}`}
            </p>
          </div>
        </div>

        {hasPluginData ? (
          <div className="plugin-share-data-box">
            <label className="plugin-share-checkbox">
              <input
                type="checkbox"
                checked={importData}
                disabled={busyAction !== ""}
                onChange={(e) => setImportData(e.target.checked)}
              />
              <span>导入发送方附带的插件数据（{Array.isArray(current.meta?.includedDataFiles) ? current.meta.includedDataFiles.length : 1} 个文件）</span>
            </label>
            {importData ? (
              <label className="plugin-share-checkbox plugin-share-overwrite">
                <input
                  type="checkbox"
                  checked={overwriteData}
                  disabled={busyAction !== ""}
                  onChange={(e) => setOverwriteData(e.target.checked)}
                />
                <span>如本机已有同名数据文件，允许覆盖（默认跳过保留本机数据）</span>
              </label>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="plugins-message bad">
            <AlertTriangle size={14} /> <span>{error}</span>
          </div>
        ) : null}

        <div className="add-plugin-actions">
          <button
            type="button"
            className="plugins-text-button"
            disabled={busyAction !== ""}
            onClick={() => void handleRespond(false)}
          >
            {busyAction === "reject" ? <Loader2 size={14} className="spin" /> : null}
            <span>拒绝</span>
          </button>
          <button
            type="button"
            className="add-plugin-submit"
            disabled={busyAction !== ""}
            onClick={() => void handleRespond(true)}
          >
            {busyAction === "accept" ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
            <span>{busyAction === "accept" ? "正在传输并导入…" : "同意并导入"}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
