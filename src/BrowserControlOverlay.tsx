// DYWorker 右侧浏览器 Computer Use 宿主控制浮层（BrowserControlOverlay）
// 包含：受控页细发光边框、底部胶囊浮条、运行计时器、动作提示、误触输入屏障、“我来接管”与“继续”切换
import React, { useEffect, useState, useMemo } from "react";
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

  const isControlledTab = useMemo(() => {
    if (!controlState) return false;
    if (controlState.status === "idle" || controlState.status === "stopped") return false;
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
  const isCompleted = status === "completed";

  return (
    <div className={`browser-control-overlay-container ${status}`} role="region" aria-label="助手浏览器操作控制">
      {/* 1. 受控发光边框 */}
      <div className={`browser-control-glow-border ${status}`} aria-hidden="true" />

      {/* 2. 误触拦截屏障：在助手运行状态下阻断直接鼠标按击，点击直接激活接管 */}
      {isRunning && (
        <div
          className="browser-control-input-barrier"
          onClick={handleBarrierClick}
          title="点击此处立即接管网页控制权"
          aria-label="操作拦截屏障，点击以接管网页"
        />
      )}

      {/* 3. 底部悬浮控制胶囊条 */}
      <div className={`browser-control-capsule ${status}`}>
        {isRunning && (
          <>
            <div className="browser-control-pulse-dot" aria-hidden="true" />
            <div className="browser-control-info">
              <span className="browser-control-title">助手正在操作</span>
              <span className="browser-control-separator">·</span>
              <span className="browser-control-timer">{formatTime(elapsedSeconds)}</span>
              {actionText && <span className="browser-control-action-text" title={actionText}>：{actionText}</span>}
            </div>
            <div className="browser-control-actions">
              <button
                type="button"
                className="browser-control-btn btn-takeover"
                onClick={handleTakeoverClick}
                title="暂停助手并由您手动操作网页"
              >
                我来接管
              </button>
              <button
                type="button"
                className="browser-control-btn btn-stop"
                onClick={handleStopClick}
                title="停止当前自动化任务"
              >
                停止
              </button>
            </div>
          </>
        )}

        {isHumanControl && (
          <>
            <div className="browser-control-user-badge" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div className="browser-control-info">
              <span className="browser-control-title">已由你接管</span>
              <span className="browser-control-action-text">（网页已恢复自由交互）</span>
            </div>
            <div className="browser-control-actions">
              <button
                type="button"
                className="browser-control-btn btn-resume"
                onClick={handleResumeClick}
                title="手动操作完成，交回给助手继续执行"
              >
                继续交给助手
              </button>
              <button
                type="button"
                className="browser-control-btn btn-stop"
                onClick={handleStopClick}
                title="结束自动化任务"
              >
                结束操作
              </button>
            </div>
          </>
        )}

        {isPaused && (
          <>
            <div className="browser-control-pause-badge" aria-hidden="true">⏸</div>
            <div className="browser-control-info">
              <span className="browser-control-title">操作已暂停</span>
              {pauseReason && <span className="browser-control-action-text">：{pauseReason}</span>}
            </div>
            <div className="browser-control-actions">
              <button
                type="button"
                className="browser-control-btn btn-resume"
                onClick={handleResumeClick}
                title="恢复助手继续操作"
              >
                继续交给助手
              </button>
              <button
                type="button"
                className="browser-control-btn btn-stop"
                onClick={handleStopClick}
              >
                结束
              </button>
            </div>
          </>
        )}

        {isCompleted && (
          <>
            <div className="browser-control-check-badge" aria-hidden="true">✓</div>
            <div className="browser-control-info">
              <span className="browser-control-title">助手操作已完成</span>
              {actionText && <span className="browser-control-action-text">：{actionText}</span>}
            </div>
            <div className="browser-control-actions">
              <button
                type="button"
                className="browser-control-btn btn-stop"
                onClick={handleStopClick}
              >
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
