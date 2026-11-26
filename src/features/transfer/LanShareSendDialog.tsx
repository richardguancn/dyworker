import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Edit3, Eye, EyeOff, Folder, Loader2, MessageSquare, Package, Radio, RefreshCw, Send, UserCheck, X } from "lucide-react";
import { useLanShareStore } from "../../state/lanShareStore";
import type { LanIdentity, LanOutgoingTransfer, LanPeerRecord, LanShareKind } from "../../types";

function kindLabel(kind: LanShareKind): string {
  if (kind === "project") return "项目";
  if (kind === "plugin") return "插件";
  return "任务会话";
}

function platformLabel(platform: string): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform || "未知系统";
}

function peerInitial(peer: { displayName?: string; account?: string }): string {
  const source = String(peer.displayName || peer.account || "同").trim();
  return source.slice(0, 1).toUpperCase() || "同";
}

export function LanShareSendDialog() {
  const sendTarget = useLanShareStore((s) => s.sendTarget);
  const closeLanShareSend = useLanShareStore((s) => s.closeLanShareSend);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selfInfo, setSelfInfo] = useState<LanIdentity | null>(null);
  const [discoverable, setDiscoverable] = useState(true);
  const [nickname, setNickname] = useState("");
  const [editingNick, setEditingNick] = useState(false);
  const [nickDraft, setNickDraft] = useState("");
  const [peers, setPeers] = useState<LanPeerRecord[]>([]);
  const [transfersByPeer, setTransfersByPeer] = useState<Record<string, LanOutgoingTransfer>>({});
  const [sendingPeerId, setSendingPeerId] = useState("");
  const [error, setError] = useState("");
  const [discoveryError, setDiscoveryError] = useState("");

  const bridge = typeof window !== "undefined" ? window.dyworker : undefined;

  useEffect(() => {
    if (!sendTarget) return;
    let active = true;
    setLoading(true);
    setError("");
    setEditingNick(false);
    setTransfersByPeer({});

    const loadState = async () => {
      if (!bridge?.getLanShareState) {
        if (active) {
          setError("当前环境不支持局域网分享");
          setLoading(false);
        }
        return;
      }
      try {
        const state = await bridge.getLanShareState();
        if (!active) return;
        if (!state?.ok) {
          setError(state?.error || "获取局域网状态失败");
        } else {
          setSelfInfo(state.self || null);
          setDiscoverable(state.discoverable !== false);
          setNickname(state.nickname || "");
          setNickDraft(state.nickname || "");
          setPeers(Array.isArray(state.peers) ? state.peers : []);
          setDiscoveryError(state.discoveryError || "");
        }
        // 打开弹窗时主动再发一次探测包，加快列表出现
        const refreshed = await bridge.refreshLanSharePeers?.().catch(() => null);
        if (active && refreshed?.ok) {
          setPeers(Array.isArray(refreshed.peers) ? refreshed.peers : []);
          if (refreshed.self) setSelfInfo(refreshed.self);
        }
      } catch (err: any) {
        if (active) setError(String(err?.message || err));
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadState();

    const offPeers = bridge?.onLanSharePeersUpdated?.((nextPeers) => {
      if (active) setPeers(Array.isArray(nextPeers) ? nextPeers : []);
    });
    const offTransfer = bridge?.onLanShareTransferUpdate?.((transfer) => {
      if (!active || !transfer?.peerId) return;
      setTransfersByPeer((prev) => ({
        ...prev,
        [transfer.peerId]: transfer,
      }));
    });

    return () => {
      active = false;
      offPeers?.();
      offTransfer?.();
    };
  }, [bridge, sendTarget]);

  if (!sendTarget) return null;

  const handleRefresh = async () => {
    if (!bridge?.refreshLanSharePeers || refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      const res = await bridge.refreshLanSharePeers();
      if (res?.ok) {
        setPeers(Array.isArray(res.peers) ? res.peers : []);
        if (res.self) setSelfInfo(res.self);
      }
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      window.setTimeout(() => setRefreshing(false), 300);
    }
  };

  const handleToggleDiscoverable = async () => {
    if (!bridge?.updateLanShareConfig) return;
    const nextEnabled = !discoverable;
    setDiscoverable(nextEnabled);
    const res = await bridge.updateLanShareConfig({ enabled: nextEnabled }).catch(() => null);
    if (res?.ok) {
      setDiscoverable(res.discoverable !== false);
      if (res.self) setSelfInfo(res.self);
    }
  };

  const handleSaveNickname = async () => {
    if (!bridge?.updateLanShareConfig) return;
    const res = await bridge.updateLanShareConfig({ nickname: nickDraft.trim() }).catch(() => null);
    if (res?.ok) {
      setNickname(res.nickname || "");
      setNickDraft(res.nickname || "");
      if (res.self) setSelfInfo(res.self);
    }
    setEditingNick(false);
  };

  const handleSendToPeer = async (peer: LanPeerRecord) => {
    if (!bridge?.sendLanShare || sendingPeerId) return;
    setError("");
    setSendingPeerId(peer.deviceId);
    try {
      const res = await bridge.sendLanShare({
        peerId: peer.deviceId,
        kind: sendTarget.kind,
        sessionId: sendTarget.sessionId,
        workspacePath: sendTarget.workspacePath,
        pluginTarget: sendTarget.pluginTarget,
        includeData: sendTarget.includeData,
      });
      if (res?.transfer) {
        setTransfersByPeer((prev) => ({
          ...prev,
          [peer.deviceId]: res.transfer!,
        }));
      }
      if (!res?.ok) {
        setError(res?.error || `发送给 ${peer.displayName} 失败`);
      }
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setSendingPeerId("");
    }
  };

  const handleCancelTransfer = async (transfer: LanOutgoingTransfer) => {
    if (!bridge?.cancelLanShare) return;
    await bridge.cancelLanShare({ transferId: transfer.transferId }).catch(() => null);
  };

  const KindIcon = sendTarget.kind === "project" ? Folder : sendTarget.kind === "plugin" ? Package : MessageSquare;

  return createPortal(
    <div className="dialog-overlay" role="dialog" aria-label="局域网分享">
      <div className="add-plugin-dialog lan-share-dialog">
        <header className="add-plugin-header">
          <div className="add-plugin-header-title">
            <h2>局域网分享</h2>
            <p className="add-plugin-sub">点击同一局域网内的在线用户发送分享请求，对方同意后自动传输并导入。</p>
          </div>
          <button className="icon-button subtle" onClick={closeLanShareSend} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="lan-share-target-card">
          <div className="lan-share-target-icon">
            <KindIcon size={18} />
          </div>
          <div className="lan-share-target-body">
            <div className="lan-share-target-head">
              <span className="plugin-tag">{kindLabel(sendTarget.kind)}</span>
              <strong>{sendTarget.title}</strong>
            </div>
            {sendTarget.subtitle ? <p>{sendTarget.subtitle}</p> : null}
          </div>
        </div>

        <div className="lan-share-self-bar">
          <div className="lan-share-self-info">
            <div className="lan-share-self-name-row">
              <span className="lan-share-self-label">本机显示名称：</span>
              {editingNick ? (
                <div className="lan-share-nick-edit">
                  <input
                    value={nickDraft}
                    maxLength={40}
                    placeholder="输入显示昵称（留空使用账号或系统名）"
                    onChange={(e) => setNickDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSaveNickname();
                      if (e.key === "Escape") { setNickDraft(nickname); setEditingNick(false); }
                    }}
                    autoFocus
                  />
                  <button type="button" className="plugins-text-button" onClick={() => void handleSaveNickname()}>保存</button>
                </div>
              ) : (
                <>
                  <strong>{selfInfo?.displayName || "本机"}</strong>
                  {selfInfo?.account ? (
                    <span className="lan-share-account-badge">
                      <UserCheck size={12} /> {selfInfo.account}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="lan-share-icon-link"
                    title="修改局域网显示昵称"
                    onClick={() => { setNickDraft(nickname); setEditingNick(true); }}
                  >
                    <Edit3 size={13} />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="lan-share-self-controls">
            <button
              type="button"
              className={`plugins-text-button ${discoverable ? "is-on" : ""}`}
              title={discoverable ? "当前允许局域网内其他设备发现和发送给你" : "当前处于隐身状态，其他设备不可见"}
              onClick={() => void handleToggleDiscoverable()}
            >
              {discoverable ? <Eye size={14} /> : <EyeOff size={14} />}
              <span>{discoverable ? "可被发现" : "已隐身"}</span>
            </button>
            <button
              type="button"
              className="plugins-text-button"
              onClick={() => void handleRefresh()}
              disabled={refreshing || loading}
            >
              <RefreshCw size={14} className={refreshing ? "spin" : ""} />
              <span>刷新</span>
            </button>
          </div>
        </div>

        {discoveryError ? (
          <div className="plugins-message warn">
            <AlertTriangle size={14} />
            <span>局域网发现端口初始化受限：{discoveryError}</span>
          </div>
        ) : null}

        {error ? (
          <div className="plugins-message bad">
            <AlertTriangle size={14} /> <span>{error}</span>
          </div>
        ) : null}

        <div className="lan-share-peers-section">
          <div className="lan-share-peers-head">
            <span><Radio size={14} /> 局域网在线用户（{peers.length}）</span>
          </div>

          {loading ? (
            <div className="add-plugin-created-loading">
              <Loader2 size={14} className="spin" /> 正在搜索同一局域网内的 DYWorker 用户…
            </div>
          ) : peers.length === 0 ? (
            <div className="lan-share-empty">
              <Radio size={22} />
              <strong>暂未发现其他在线用户</strong>
              <p>请确认接收方已打开 DYWorker、处于同一局域网（Wi-Fi / 内网），且未关闭「可被发现」。</p>
            </div>
          ) : (
            <div className="lan-share-peer-list">
              {peers.map((peer) => {
                const transfer = transfersByPeer[peer.deviceId];
                const isSendingThis = sendingPeerId === peer.deviceId;
                const isWaiting = transfer?.status === "waiting";
                const isTransferring = transfer?.status === "transferring";
                const isCompleted = transfer?.status === "completed";
                const isRejected = transfer?.status === "rejected";
                const isFailed = transfer?.status === "failed";

                return (
                  <div className="lan-share-peer-row" key={peer.deviceId}>
                    <div className="lan-share-peer-avatar">{peerInitial(peer)}</div>
                    <div className="lan-share-peer-info">
                      <div className="lan-share-peer-name">
                        <strong>{peer.displayName}</strong>
                        {peer.account ? (
                          <span className="lan-share-account-badge">
                            <UserCheck size={11} /> {peer.account}
                          </span>
                        ) : null}
                      </div>
                      <div className="lan-share-peer-meta">
                        <span>{peer.host || "未知设备"}</span>
                        <span>·</span>
                        <span>{platformLabel(peer.platform)}</span>
                        <span>·</span>
                        <span>{peer.ip}</span>
                      </div>
                      {isWaiting ? (
                        <div className="lan-share-peer-status waiting">等待对方点击同意…</div>
                      ) : isTransferring ? (
                        <div className="lan-share-peer-status waiting">正在传输并等待对方导入…</div>
                      ) : isCompleted ? (
                        <div className="lan-share-peer-status ok">对方已接收并完成导入</div>
                      ) : isRejected ? (
                        <div className="lan-share-peer-status warn">{transfer?.error || "对方已拒绝"}</div>
                      ) : isFailed ? (
                        <div className="lan-share-peer-status bad">{transfer?.error || "发送失败"}</div>
                      ) : null}
                    </div>
                    <div className="lan-share-peer-action">
                      {isWaiting && transfer ? (
                        <button
                          type="button"
                          className="plugins-text-button"
                          onClick={() => void handleCancelTransfer(transfer)}
                        >
                          取消
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="lan-share-send-btn"
                          disabled={Boolean(sendingPeerId) || isTransferring}
                          onClick={() => void handleSendToPeer(peer)}
                        >
                          {isSendingThis || isTransferring ? (
                            <Loader2 size={14} className="spin" />
                          ) : isCompleted ? (
                            <Check size={14} />
                          ) : (
                            <Send size={14} />
                          )}
                          <span>
                            {isSendingThis ? "发送中" : isCompleted ? "再次发送" : isRejected || isFailed ? "重发" : "发送"}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
