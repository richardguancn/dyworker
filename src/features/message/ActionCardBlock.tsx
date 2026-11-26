// 对话后个性化推荐卡片（```action-card```）渲染与交互组件：
// 支持推荐位置选择、后台创建与取消、热挂载打开、撤销（保留源码）与一键恢复。
import { Blocks, Check, ExternalLink, LoaderCircle, RotateCcw, Share2, Sparkles, Undo2, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { SharePluginDialog } from "../../SharePluginDialog";
import { formatUnreportedCardDecisions, parseActionCardCode } from "../../lib/actionCards";
import { useSessionStore } from "../../state/sessionStore";
import { useSettingsStore } from "../../state/settingsStore";
import { pluginHotMountRef } from "../../state/sharedRefs";
import type { ActionCardDecision, ActionCardSlot, SessionRecord } from "../../types";

export { formatUnreportedCardDecisions, parseActionCardCode };

const SLOT_OPTIONS: Array<{ value: ActionCardSlot; label: string }> = [
  { value: "workspace.page", label: "独立页面" },
  { value: "sidebar.right.pane.tab", label: "右侧面板" },
  { value: "conversation.view", label: "会话视图" },
  { value: "custom", label: "自定义" },
];

export function ActionCardBlock({ code }: { code: string }) {
  const parsed = parseActionCardCode(code);
  const activeId = useSessionStore((s) => s.activeId);
  const session = useSessionStore((s) =>
    s.sessions.find((item) => item.id === s.activeId)
    || (s.newTaskDraft?.id === s.activeId ? s.newTaskDraft : undefined),
  );
  const globalWorkspacePath = useSessionStore((s) => s.workspacePath);
  const settings = useSettingsStore((s) => s.settings);
  const approvalMode = useSettingsStore((s) => s.approvalMode);

  const sessionId = session?.id || activeId || "";
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const [slotDraft, setSlotDraft] = useState<ActionCardSlot | null>(null);
  const [customDraft, setCustomDraft] = useState("");
  const [busyAction, setBusyAction] = useState<"" | "opening" | "undoing" | "restoring">("");
  const [localError, setLocalError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);

  const card = parsed.status === "ok" ? parsed.card : null;
  const savedDecision = card ? session?.actionCardDecisions?.[card.id] : undefined;
  const defaultSlot: ActionCardSlot = card?.recommendedSlot || "workspace.page";
  const chosenSlot: ActionCardSlot = savedDecision?.chosenSlot || slotDraft || defaultSlot;
  const customPlacement = savedDecision?.customPlacement ?? customDraft;

  const updateDecision = useCallback((patch: Partial<ActionCardDecision>) => {
    if (!card) return;
    const { activeId: currentActiveId, setSessions, setNewTaskDraft } = useSessionStore.getState();
    const targetId = sessionIdRef.current || currentActiveId;
    if (!targetId) return;
    const applyPatch = (target: SessionRecord): SessionRecord => {
      if (target.id !== targetId) return target;
      const prev = target.actionCardDecisions?.[card.id];
      const next: ActionCardDecision = {
        status: prev?.status || "idle",
        chosenSlot: prev?.chosenSlot || defaultSlot,
        reportedToModel: false,
        ...prev,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      return {
        ...target,
        actionCardDecisions: {
          ...(target.actionCardDecisions || {}),
          [card.id]: next,
        },
        updatedAt: new Date().toISOString(),
      };
    };
    setSessions((current) => current.map(applyPatch));
    setNewTaskDraft((current) => (current ? applyPatch(current) : current));
  }, [card, defaultSlot]);

  if (parsed.status === "incomplete") {
    return (
      <div className="action-card-box loading" role="status">
        <LoaderCircle size={15} className="spin" />
        <span>正在生成个性化页面建议…</span>
      </div>
    );
  }

  if (parsed.status === "invalid" || !card) {
    return (
      <pre className="action-card-fallback">
        <code>{code}</code>
      </pre>
    );
  }

  const status = savedDecision?.status || "idle";

  if (status === "dismissed") {
    return (
      <div className="action-card-box dismissed">
        <span className="action-card-dismissed-text">已忽略推荐：{card.title}</span>
        <button
          type="button"
          className="action-card-link-btn"
          onClick={() => updateDecision({ status: "idle", reportedToModel: false })}
        >
          展开
        </button>
      </div>
    );
  }

  const handleCreate = async () => {
    setLocalError("");
    const bridge = window.dyworker;
    if (!bridge?.createPluginFromCard || !sessionId) {
      setLocalError("当前环境不支持推荐卡片一键创建");
      return;
    }
    if (chosenSlot === "custom" && !customPlacement.trim()) {
      setLocalError("请先填写希望放置的自定义位置说明");
      return;
    }

    updateDecision({
      status: "creating",
      chosenSlot,
      ...(chosenSlot === "custom" ? { customPlacement: customPlacement.trim() } : { customPlacement: undefined }),
      error: undefined,
      reportedToModel: false,
    });

    const recentMessages = (session?.messages || [])
      .slice(-4)
      .map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 600) }));

    try {
      const result = await bridge.createPluginFromCard({
        sessionId,
        cardId: card.id,
        title: card.title,
        summary: card.summary,
        prompt: card.prompt,
        chosenSlot,
        ...(chosenSlot === "custom" ? { customPlacement: customPlacement.trim() } : {}),
        workspacePath: session?.workspacePath || globalWorkspacePath || "",
        recentMessages,
        settings,
        approvalMode,
      });

      if (result?.cancelled) {
        updateDecision({ status: "cancelled", error: undefined, reportedToModel: false });
        return;
      }
      if (!result?.ok || !result.pluginId) {
        updateDecision({
          status: "failed",
          pluginId: result?.pluginId,
          pluginDir: result?.pluginDir,
          error: result?.error || "插件创建失败",
          reportedToModel: false,
        });
        return;
      }

      const finalSlot = (result.slot as ActionCardSlot) || (chosenSlot === "custom" ? "workspace.page" : chosenSlot);
      await pluginHotMountRef.current.mountClientPlugin(result.pluginId, { openSlot: finalSlot });
      updateDecision({
        status: "created",
        pluginId: result.pluginId,
        pluginName: result.pkgName || card.title,
        pluginDir: result.pluginDir,
        chosenSlot: finalSlot,
        error: undefined,
        reportedToModel: false,
      });
    } catch (error: any) {
      updateDecision({
        status: "failed",
        error: String(error?.message || error || "创建请求异常"),
        reportedToModel: false,
      });
    }
  };

  const handleCancel = async () => {
    setLocalError("");
    if (sessionId) {
      await window.dyworker?.cancelCardPluginCreation?.({ sessionId, cardId: card.id }).catch(() => null);
    }
    updateDecision({ status: "cancelled", error: undefined, reportedToModel: false });
  };

  const handleOpen = async () => {
    const targetId = savedDecision?.pluginId || savedDecision?.pluginName;
    if (!targetId) return;
    setLocalError("");
    setBusyAction("opening");
    try {
      const activated = pluginHotMountRef.current.activateClientPluginSlot(targetId, chosenSlot === "custom" ? "workspace.page" : chosenSlot);
      if (!activated) {
        const mounted = await pluginHotMountRef.current.mountClientPlugin(targetId, {
          openSlot: chosenSlot === "custom" ? "workspace.page" : chosenSlot,
        });
        if (!mounted.ok) {
          setLocalError(mounted.error || "未能打开插件页面，请在插件页确认是否已启用");
        }
      }
    } finally {
      setBusyAction("");
    }
  };

  const handleUndo = async () => {
    const targetSpec = savedDecision?.pluginName || savedDecision?.pluginId;
    if (!targetSpec) return;
    setLocalError("");
    setBusyAction("undoing");
    try {
      await pluginHotMountRef.current.unmountClientPlugin(savedDecision?.pluginId || targetSpec, savedDecision?.pluginName || "");
      const res = await window.dyworker?.uninstallPlugin?.(targetSpec);
      if (res && !res.ok && !/不存在|找不到/.test(String(res.error || ""))) {
        setLocalError(res.error || "卸载插件失败");
        return;
      }
      updateDecision({ status: "undone", error: undefined, reportedToModel: false });
    } catch (error: any) {
      setLocalError(String(error?.message || error));
    } finally {
      setBusyAction("");
    }
  };

  const handleRestore = async () => {
    const dir = savedDecision?.pluginDir;
    const bridge = window.dyworker;
    if (!dir || !bridge?.installPluginPackage) {
      setLocalError("未记录源码目录，请点击重新创建");
      return;
    }
    setLocalError("");
    setBusyAction("restoring");
    try {
      const installed = await bridge.installPluginPackage({ input: dir, spec: dir });
      if (!installed?.ok) {
        setLocalError(installed?.error || "恢复安装失败");
        return;
      }
      let targetPluginId = savedDecision?.pluginId || savedDecision?.pluginName || dir;
      const list = await bridge.listPlugins?.().catch(() => null);
      if (Array.isArray(list?.entries)) {
        const found = list.entries.find((item: any) =>
          item && (item.id === savedDecision?.pluginId || item.name === savedDecision?.pluginName || item.name === installed.name || item.id === installed.id));
        if (found) {
          targetPluginId = found.id;
          if (found.disabled && bridge.enablePlugin) {
            await bridge.enablePlugin(found.id);
          }
        }
      } else if (bridge.enablePlugin && savedDecision?.pluginId) {
        await bridge.enablePlugin(savedDecision.pluginId).catch(() => null);
      }
      await pluginHotMountRef.current.mountClientPlugin(targetPluginId, {
        openSlot: chosenSlot === "custom" ? "workspace.page" : chosenSlot,
      });
      updateDecision({
        status: "created",
        pluginId: targetPluginId,
        error: undefined,
        reportedToModel: false,
      });
    } catch (error: any) {
      setLocalError(String(error?.message || error));
    } finally {
      setBusyAction("");
    }
  };

  const isCreating = status === "creating";
  const isCreated = status === "created";
  const isUndone = status === "undone";
  const displayError = localError || savedDecision?.error || "";

  return (
    <div className={`action-card-box state-${status}`} data-card-id={card.id}>
      <div className="action-card-header">
        <div className="action-card-title-wrap">
          <Sparkles size={15} className="action-card-icon" />
          <strong>{card.title}</strong>
        </div>
        {isCreated && (
          <span className="action-card-badge ok">
            <Check size={12} />
            已创建生效
          </span>
        )}
        {isUndone && (
          <span className="action-card-badge muted">源码已保留</span>
        )}
        {isCreating && (
          <span className="action-card-badge progress">
            <LoaderCircle size={12} className="spin" />
            构建中
          </span>
        )}
      </div>

      <p className="action-card-summary">{card.summary}</p>
      {card.slotReason && (status === "idle" || status === "failed" || status === "cancelled") && (
        <p className="action-card-reason">推荐理由：{card.slotReason}</p>
      )}

      {(status === "idle" || status === "failed" || status === "cancelled") && (
        <div className="action-card-slots" role="radiogroup" aria-label="选择放置位置">
          <span className="action-card-slots-label">挂载位置：</span>
          {SLOT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={chosenSlot === option.value}
              className={`action-card-slot-pill ${chosenSlot === option.value ? "active" : ""}`}
              onClick={() => {
                setSlotDraft(option.value);
                setLocalError("");
                if (savedDecision) {
                  updateDecision({ chosenSlot: option.value });
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {chosenSlot === "custom" && (status === "idle" || status === "failed" || status === "cancelled") && (
        <input
          type="text"
          className="action-card-custom-input"
          placeholder="说明想放置的页面位置（如：在左侧独立页展示并包含图表）"
          value={customPlacement}
          onChange={(e) => {
            const value = e.target.value;
            setCustomDraft(value);
            if (savedDecision) updateDecision({ customPlacement: value });
          }}
        />
      )}

      {displayError && (
        <div className="action-card-error" role="alert">{displayError}</div>
      )}
      {status === "cancelled" && !displayError && (
        <div className="action-card-hint">已取消本次构建，可调整位置后重新创建</div>
      )}

      <div className="action-card-actions">
        {(status === "idle" || status === "failed" || status === "cancelled") && (
          <>
            <button type="button" className="action-card-btn primary" onClick={() => void handleCreate()}>
              <Blocks size={14} />
              <span>{status === "failed" || status === "cancelled" ? "重试创建" : "立即创建"}</span>
            </button>
            <button
              type="button"
              className="action-card-btn secondary"
              onClick={() => updateDecision({ status: "dismissed", reportedToModel: false })}
            >
              <X size={14} />
              <span>暂不需要</span>
            </button>
          </>
        )}

        {isCreating && (
          <button type="button" className="action-card-btn secondary" onClick={() => void handleCancel()}>
            <X size={14} />
            <span>取消构建</span>
          </button>
        )}

        {isCreated && (
          <>
            <button
              type="button"
              className="action-card-btn primary"
              disabled={busyAction !== ""}
              onClick={() => void handleOpen()}
            >
              <ExternalLink size={14} />
              <span>{busyAction === "opening" ? "打开中…" : "打开页面"}</span>
            </button>
            {(savedDecision?.pluginDir || savedDecision?.pluginId || savedDecision?.pluginName) && (
              <button
                type="button"
                className="action-card-btn secondary"
                disabled={busyAction !== ""}
                onClick={() => setShareOpen(true)}
              >
                <Share2 size={14} />
                <span>分享</span>
              </button>
            )}
            <button
              type="button"
              className="action-card-btn secondary"
              disabled={busyAction !== ""}
              onClick={() => void handleUndo()}
            >
              <Undo2 size={14} />
              <span>{busyAction === "undoing" ? "卸载中…" : "撤销"}</span>
            </button>
          </>
        )}

        {isUndone && (
          <button
            type="button"
            className="action-card-btn primary"
            disabled={busyAction !== ""}
            onClick={() => void handleRestore()}
          >
            <RotateCcw size={14} />
            <span>{busyAction === "restoring" ? "恢复中…" : "恢复页面"}</span>
          </button>
        )}
      </div>
      {shareOpen && (savedDecision?.pluginDir || savedDecision?.pluginId || savedDecision?.pluginName) && (
        <SharePluginDialog
          target={savedDecision.pluginDir || savedDecision.pluginId || savedDecision.pluginName || ""}
          titleHint={card.title}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
