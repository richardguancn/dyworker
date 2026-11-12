// DYWorker 右侧浏览器 Computer Use 宿主控制浮层（BrowserControlOverlay）
// 包含：受控页细发光边框、底部胶囊浮条、运行计时器、动作提示、误触输入屏障、“我来接管”与“继续”切换
import React, { useEffect, useState, useMemo, useRef } from "react";
import { t } from "./i18n";
import type { BrowserControlState } from "./types";

interface BrowserControlOverlayProps {
  controlState: BrowserControlState | null;
  activeTabId: string;
  onTakeover?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}

export const BrowserControlOverlay: React.FC<BrowserControlOverlayProps> = ({
  controlState,
  activeTabId,
  onTakeover,
  onResume,
  onStop
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const barrierRef = useRef<HTMLDivElement>(null);

  const isControlledTab = useMemo(() => {
    if (!controlState) return false;
    if (controlState.status === "idle" || (controlState.status === "stopped" && controlState.inputReleaseState !== 'pending' && controlState.inputReleaseState !== 'failed')) return false;
    // 若未绑定特定 tabId，或 tabId 匹配当前激活标签页
    return !controlState.tabId || controlState.tabId === activeTabId;
  }, [controlState, activeTabId]);

  // 运行时间计数器
  useEffect(() => {
    if (!isControlledTab || !controlState || controlState.status !== "running") {
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isControlledTab, controlState?.status]);

  const handoffBlocked = isControlledTab && (controlState?.status === 'human_control' || controlState?.status === 'paused' || controlState?.status === 'stopped')
    && (controlState.inputReleaseState === 'pending' || controlState.inputReleaseState === 'failed');
  useEffect(() => { if (handoffBlocked) barrierRef.current?.focus(); }, [handoffBlocked]);

  if (!isControlledTab || !controlState) {
    return null;
  }

  const { status, actionText, pauseReason } = controlState;

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleTakeoverClick = () => {
    if (onTakeover) {
      onTakeover();
    } else {
      void window.dyworker?.takeoverBrowserControl?.();
    }
  };

  const handleResumeClick = () => {
    if (onResume) {
      onResume();
    } else {
      void window.dyworker?.resumeBrowserControl?.({
        ownerSessionId: controlState?.ownerSessionId,
        runId: controlState?.runId
      });
    }
  };

  const handleStopClick = () => {
    if (onStop) {
      onStop();
    } else {
      void window.dyworker?.stopBrowserControl?.();
    }
  };

  // 点击屏障：用户点击了正在被助手操作的网页区域，立即拦截该点击并切换为用户接管
  const handleBarrierClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    handleTakeoverClick();
  };

  const isRunning = status === "running" || status === "acquiring";
  const isHumanControl = status === "human_control";
  const isPaused = status === "paused";
  const isStopped = status === "stopped";
  const isCompleted = status === "completed";

  return (
    <div className={`browser-control-overlay-container ${status}`} role="region" aria-label={t("browserOverlay.ariaRegion", "助手浏览器操作控制")}>
      {/* 1. 受控发光边框 */}
      <div className={`browser-control-glow-border ${status}`} aria-hidden="true" />

      {/* 2. 误触拦截屏障：在助手运行状态下阻断直接鼠标按击，点击直接激活接管 */}
      {(isRunning || handoffBlocked) && (
        <div
          ref={barrierRef}
          className={`browser-control-input-barrier${handoffBlocked ? ' is-waiting' : ''}`}
          onClick={handoffBlocked ? e => { e.stopPropagation(); e.preventDefault(); } : handleBarrierClick}
          onKeyDown={handoffBlocked ? e => { e.stopPropagation(); e.preventDefault(); } : undefined}
          tabIndex={handoffBlocked ? -1 : undefined}
          title={handoffBlocked ? t("browserOverlay.barrierBlockedTitle", "正在结束之前的操作") : t("browserOverlay.barrierRunningTitle", "点击此处立即接管网页控制权")}
          aria-label={handoffBlocked ? t("browserOverlay.barrierBlockedAria", "暂时阻止网页输入") : t("browserOverlay.barrierRunningAria", "操作拦截屏障，点击以接管网页")}
        />
      )}

      {/* 3. 底部悬浮控制胶囊条 */}
      <div className={`browser-control-capsule ${status}`}>
        {isRunning && (
          <>
            <div className="browser-control-pulse-dot" aria-hidden="true" />
            <div className="browser-control-info">
              <span className="browser-control-title">{t("browserOverlay.assistantOperating", "助手正在操作")}</span>
              <span className="browser-control-separator">·</span>
              <span className="browser-control-timer">{formatTime(elapsedSeconds)}</span>
              {actionText && <span className="browser-control-action-text" title={actionText}>：{actionText}</span>}
            </div>
            <div className="browser-control-actions">
              <button
                type="button"
                className="browser-control-btn btn-takeover"
                onClick={handleTakeoverClick}
                title={t("browserOverlay.btnTakeoverTitle", "暂停助手并由您手动操作网页")}
              >
                {t("browserOverlay.btnTakeover", "我来接管")}
              </button>
              <button
                type="button"
                className="browser-control-btn btn-stop"
                onClick={handleStopClick}
                title={t("browserOverlay.btnStopTitle", "停止当前自动化任务")}
              >
                {t("browserOverlay.btnStop", "停止")}
              </button>
            </div>
          </>
        )}

        {(isHumanControl || isPaused || isStopped) && handoffBlocked && <div className="browser-control-info" role="status" aria-live="polite">
          {controlState.inputReleaseState === 'failed'
            ? <><span className="browser-control-title">{t("browserOverlay.releaseFailedTitle", "无法确认操作已结束")}</span><span className="browser-control-action-text">{t("browserOverlay.releaseFailedDesc", "：请关闭此网页后重新打开。")}</span></>
            : <><span className="browser-control-title">{isPaused || isStopped ? t("browserOverlay.releasingAction", "正在结束操作") : t("browserOverlay.preparingTakeover", "正在准备接管")}</span><span className="browser-control-action-text">{t("browserOverlay.pleaseWait", "：请稍候。")}</span></>}
        </div>}

        {isHumanControl && !handoffBlocked && (
          <>
            <div className="browser-control-user-badge" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div className="browser-control-info">
              <span className="browser-control-title">{t("browserOverlay.userTakenOver", "已由你接管")}</span>
              <span className="browser-control-action-text">{t("browserOverlay.freeInteraction", "（网页已恢复自由交互）")}</span>
            </div>
            <div className="browser-control-actions">
              <button
                type="button"
                className="browser-control-btn btn-resume"
                onClick={handleResumeClick}
                title={t("browserOverlay.btnResumeTitle", "手动操作完成，交回给助手继续执行")}
              >
                {t("browserOverlay.btnResume", "继续交给助手")}
              </button>
              <button
                type="button"
                className="browser-control-btn btn-stop"
                onClick={handleStopClick}
                title={t("browserOverlay.btnEndActionTitle", "结束自动化任务")}
              >
                {t("browserOverlay.btnEndAction", "结束操作")}
              </button>
            </div>
          </>
        )}

        {isPaused && !handoffBlocked && (
          <>
            <div className="browser-control-pause-badge" aria-hidden="true">⏸</div>
            <div className="browser-control-info">
              <span className="browser-control-title">{t("browserOverlay.actionPaused", "操作已暂停")}</span>
              {pauseReason && <span className="browser-control-action-text">：{pauseReason}</span>}
            </div>
            <div className="browser-control-actions">
              <button
                type="button"
                className="browser-control-btn btn-resume"
                onClick={handleResumeClick}
                title={t("browserOverlay.btnResumeActionTitle", "恢复助手继续操作")}
              >
                {t("browserOverlay.btnResume", "继续交给助手")}
              </button>
              <button
                type="button"
                className="browser-control-btn btn-stop"
                onClick={handleStopClick}
              >
                {t("browserOverlay.btnEndAction", "结束")}
              </button>
            </div>
          </>
        )}

        {isCompleted && (
          <>
            <div className="browser-control-check-badge" aria-hidden="true">✓</div>
            <div className="browser-control-info">
              <span className="browser-control-title">{t("browserOverlay.assistantCompleted", "助手操作已完成")}</span>
              {actionText && <span className="browser-control-action-text">：{actionText}</span>}
            </div>
            <div className="browser-control-actions">
              <button
                type="button"
                className="browser-control-btn btn-stop"
                onClick={handleStopClick}
              >
                {t("browserOverlay.btnFinish", "完成")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
