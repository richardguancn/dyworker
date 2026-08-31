// 后台服务与任务管理面板：管理会话中启动的后台长驻进程（HTTP Server、本地开发服务、SSH、编译构建等）
// 支持会话隔离展示、端口与URL自动识别、一键在内置浏览器打开、实时日志查看、一键停止服务与重启。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  LoaderCircle,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type { BackgroundTaskRecord } from "./types";

export interface BackgroundTasksPanelProps {
  sessionId?: string;
  sessionTitle?: string;
  workspacePath?: string;
  onOpenUrl?: (url: string) => void;
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
}

function formatDuration(startTime: string, endTime?: string | null): string {
  const start = new Date(startTime).getTime();
  if (isNaN(start)) return "";
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  const diffSec = Math.max(0, Math.floor((end - start) / 1000));
  if (diffSec < 60) return `${diffSec} 秒`;
  const minutes = Math.floor(diffSec / 60);
  const seconds = diffSec % 60;
  if (minutes < 60) return `${minutes} 分 ${seconds} 秒`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours} 小时 ${remMinutes} 分`;
}

export function BackgroundTasksPanel({
  sessionId,
  sessionTitle,
  workspacePath,
  onOpenUrl,
  onNotice,
  onError,
}: BackgroundTasksPanelProps) {
  const [tasks, setTasks] = useState<BackgroundTaskRecord[]>([]);
  const [scope, setScope] = useState<"current" | "all">("current");
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [newCommand, setNewCommand] = useState("");
  const [starting, setStarting] = useState(false);
  const [armStopAll, setArmStopAll] = useState(false);
  const [, setTick] = useState(0);

  // 定时刷新时长
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // 刷新任务列表
  const refreshTasks = async () => {
    if (!window.dyworker?.listBackgroundTasks) return;
    try {
      const all = await window.dyworker.listBackgroundTasks();
      setTasks(all);
    } catch (err) {
      console.error("加载后台任务失败", err);
    }
  };

  useEffect(() => {
    void refreshTasks();
    if (!window.dyworker?.onBackgroundTaskUpdate) return;
    const unsubscribe = window.dyworker.onBackgroundTaskUpdate((event) => {
      setTasks((prev) => {
        const index = prev.findIndex((t) => t.id === event.task.id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = event.task;
          return next;
        }
        return [event.task, ...prev];
      });
    });
    return unsubscribe;
  }, []);

  // 根据 scope 与 sessionId 过滤任务（确保 A 会话与 B 会话隔离）
  const visibleTasks = useMemo(() => {
    if (scope === "all") return tasks;
    if (!sessionId) return tasks;
    return tasks.filter((t) => !t.sessionId || t.sessionId === sessionId);
  }, [tasks, scope, sessionId]);

  const runningTasks = useMemo(
    () => visibleTasks.filter((t) => t.status === "running"),
    [visibleTasks]
  );

  const toggleLog = (id: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 停止任务
  const handleStopTask = async (taskId: string) => {
    if (!window.dyworker?.stopBackgroundTask) return;
    try {
      await window.dyworker.stopBackgroundTask(taskId);
      onNotice?.("已停止后台服务并释放端口");
      await refreshTasks();
    } catch (err) {
      onError?.(`停止服务失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 重启任务
  const handleRestartTask = async (taskId: string) => {
    if (!window.dyworker?.restartBackgroundTask) return;
    try {
      await window.dyworker.restartBackgroundTask(taskId);
      onNotice?.("后台服务已重启");
      await refreshTasks();
    } catch (err) {
      onError?.(`重启服务失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 全部停止
  const handleStopAll = async () => {
    if (!window.dyworker?.stopBackgroundTask) return;
    const toStop = runningTasks;
    try {
      await Promise.all(toStop.map((t) => window.dyworker?.stopBackgroundTask(t.id)));
      onNotice?.(`已停止 ${toStop.length} 个后台服务`);
      setArmStopAll(false);
      await refreshTasks();
    } catch (err) {
      onError?.(`停止全部服务失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 手动启动后台服务
  const handleStartCommand = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cmd = newCommand.trim();
    if (!cmd || starting) return;
    if (!window.dyworker?.startBackgroundTask) return;

    setStarting(true);
    try {
      await window.dyworker.startBackgroundTask({
        command: cmd,
        cwd: workspacePath || undefined,
        sessionId: sessionId || undefined,
      });
      setNewCommand("");
      onNotice?.("后台任务已启动");
      await refreshTasks();
    } catch (err) {
      onError?.(`启动后台服务失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="background-tasks-container">
      {/* 顶部标题与控制栏 */}
      <div className="bt-header">
        <Radio size={14} className={runningTasks.length > 0 ? "bt-spin" : ""} />
        <strong>后台任务与服务</strong>
        <span className="bt-header-title" title={sessionTitle}>
          {scope === "current" ? (sessionTitle || "当前会话") : "全部会话"}
        </span>

        <span className="bt-header-spacer" />

        {/* 作用域切换 */}
        <div className="bt-scope-toggle">
          <button
            type="button"
            className={`bt-scope-btn ${scope === "current" ? "active" : ""}`}
            onClick={() => setScope("current")}
            title="仅展示当前会话启动的后台服务"
          >
            当前会话
          </button>
          <button
            type="button"
            className={`bt-scope-btn ${scope === "all" ? "active" : ""}`}
            onClick={() => setScope("all")}
            title="展示所有会话启动的后台服务"
          >
            全部
          </button>
        </div>

        {runningTasks.length > 0 && (
          <span className="bt-meta bt-meta-run">
            {runningTasks.length} 个运行中
          </span>
        )}

        {runningTasks.length > 0 && (
          <button
            type="button"
            className={`code-open-external bt-cancel ${armStopAll ? "bt-cancel-armed" : ""}`}
            onClick={() => {
              if (armStopAll) {
                void handleStopAll();
              } else {
                setArmStopAll(true);
                setTimeout(() => setArmStopAll(false), 4000);
              }
            }}
            title="停止并释放所有运行中的服务"
          >
            {armStopAll ? <AlertTriangle size={13} /> : <Square size={13} />}
            {armStopAll ? "确认全部停止" : "全部停止"}
          </button>
        )}
      </div>

      {/* 类似图一：运行中任务指示条（图一风格组件） */}
      {runningTasks.length > 0 && (
        <div className="bt-running-banner">
          <div className="bt-banner-title">
            <span>{runningTasks.length} tasks running</span>
          </div>
          <div className="bt-banner-list">
            {runningTasks.map((t) => (
              <div key={t.id} className="bt-banner-item">
                <LoaderCircle size={13} className="bt-spin spin" />
                <span className="bt-banner-cmd">{t.name || t.command}</span>
                {t.ports && t.ports.length > 0 && (
                  <span className="bt-banner-port">:{t.ports.join(", :")}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 快捷启动输入栏 */}
      <form className="bt-quick-launch" onSubmit={handleStartCommand}>
        <div className="bt-input-wrapper">
          <Terminal size={13} className="bt-input-icon" />
          <input
            type="text"
            className="bt-cmd-input"
            placeholder="启动后台服务，例如：python3 -m http.server 8080"
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            disabled={starting}
          />
        </div>
        <button
          type="submit"
          className="code-open-external bt-launch-btn"
          disabled={!newCommand.trim() || starting}
        >
          {starting ? <LoaderCircle size={13} className="spin" /> : <Play size={13} />}
          启动
        </button>
      </form>

      {/* 任务卡片列表 */}
      <div className="bt-tasks-scroll">
        {visibleTasks.length === 0 ? (
          <div className="bt-empty">
            <Radio size={40} />
            <strong>{scope === "current" ? "当前会话暂无后台任务" : "暂无任何后台任务"}</strong>
            <span>
              当会话中开启了 HTTP 服务（如 python3 -m http.server）、本地开发服务器或长驻后台命令时，将在此显示，便于随时查看状态、访问地址与关闭释放端口。
            </span>
            <div className="bt-empty-suggestions">
              <span className="bt-sug-title">常用快捷命令示例：</span>
              <button
                type="button"
                className="bt-sug-item"
                onClick={() => setNewCommand("python3 -m http.server 8000")}
              >
                python3 -m http.server 8000
              </button>
              <button
                type="button"
                className="bt-sug-item"
                onClick={() => setNewCommand("npm run dev")}
              >
                npm run dev
              </button>
            </div>
          </div>
        ) : (
          <div className="bt-cards-list">
            {visibleTasks.map((task) => {
              const isRunning = task.status === "running";
              const isError = task.status === "error";
              const isExpanded = expandedLogs.has(task.id);
              const durationText = formatDuration(task.startTime, task.endTime);

              return (
                <div key={task.id} className={`bt-task-card ${task.status}`}>
                  {/* 卡片头部 */}
                  <div className="bt-card-header">
                    <div className="bt-status-indicator">
                      {isRunning ? (
                        <LoaderCircle size={14} className="bt-spin spin" />
                      ) : isError ? (
                        <X size={14} className="bt-fail" />
                      ) : (
                        <Check size={14} className="bt-ok" />
                      )}
                      <span className={`bt-status-tag ${task.status}`}>
                        {isRunning ? "运行中" : isError ? "异常退出" : "已停止"}
                      </span>
                    </div>

                    <span className="bt-card-name" title={task.name}>
                      {task.name}
                    </span>

                    {task.pid && <span className="bt-pid-tag">PID {task.pid}</span>}

                    <span className="bt-duration">{durationText ? `已运行 ${durationText}` : ""}</span>
                  </div>

                  {/* 命令展示 */}
                  <div className="bt-card-command">
                    <code>{task.command}</code>
                  </div>

                  {/* 识别出的端口与访问 URL */}
                  {task.urls && task.urls.length > 0 && (
                    <div className="bt-card-urls">
                      <Globe size={13} className="bt-url-icon" />
                      <span className="bt-url-label">服务入口:</span>
                      {task.urls.map((url) => (
                        <button
                          key={url}
                          type="button"
                          className="bt-url-link"
                          onClick={() => {
                            if (onOpenUrl) onOpenUrl(url);
                            else if (window.dyworker?.openBrowser) {
                              void window.dyworker.openBrowser({ url });
                            }
                          }}
                          title="在内置浏览器打开服务页面"
                        >
                          {url}
                          <ExternalLink size={11} />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 操作按钮栏 */}
                  <div className="bt-card-actions">
                    <button
                      type="button"
                      className="bt-action-btn subtle"
                      onClick={() => toggleLog(task.id)}
                      title="展开/折叠运行日志"
                    >
                      <Terminal size={13} />
                      {isExpanded ? "收起日志" : "查看日志"}
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>

                    <div className="bt-actions-spacer" />

                    <button
                      type="button"
                      className="bt-action-btn subtle"
                      onClick={() => handleRestartTask(task.id)}
                      title="重启该后台服务"
                    >
                      <RefreshCw size={12} />
                      重启
                    </button>

                    {isRunning ? (
                      <button
                        type="button"
                        className="bt-action-btn stop"
                        onClick={() => handleStopTask(task.id)}
                        title="终止进程并释放端口"
                      >
                        <Square size={12} />
                        关闭服务
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="bt-action-btn subtle"
                        onClick={() => handleRestartTask(task.id)}
                        title="重新启动服务"
                      >
                        <Play size={12} />
                        重新启动
                      </button>
                    )}
                  </div>

                  {/* 展开的日志输出终端 */}
                  {isExpanded && (
                    <div className="bt-log-terminal">
                      <div className="bt-log-header">
                        <Terminal size={11} />
                        <span>实时日志（最近 {task.outputTail?.length || 0} 行）</span>
                      </div>
                      <pre className="bt-log-content">
                        {task.outputTail && task.outputTail.length > 0
                          ? task.outputTail.join("\n")
                          : "（暂无控制台输出）"}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
