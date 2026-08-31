import { spawn } from "node:child_process";
import path from "node:path";

const MAX_OUTPUT_LINES = 200;

class BackgroundTasksManager {
  constructor() {
    /** @type {Map<string, any>} */
    this.tasks = new Map();
    /** @type {((event: { type: string; task: any }) => void) | null} */
    this.broadcastCallback = null;
  }

  setBroadcastCallback(callback) {
    this.broadcastCallback = callback;
  }

  emit(type, task) {
    if (this.broadcastCallback) {
      try {
        this.broadcastCallback({ type, task: this.serializeTask(task) });
      } catch (err) {
        console.error("[background-tasks] Broadcast error:", err);
      }
    }
  }

  /**
   * 启动后台任务
   */
  startTask({ command, cwd, sessionId, name }) {
    const rawCmd = String(command || "").trim();
    if (!rawCmd) {
      throw new Error("命令不能为空");
    }

    const taskId = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const win32 = process.platform === "win32";
    const program = win32 ? "cmd.exe" : "/bin/bash";
    const args = win32 ? ["/d", "/s", "/c", rawCmd] : ["-lc", rawCmd];

    const detectedPorts = new Set();
    const detectedUrls = new Set();

    // 预先从命令行探测端口
    this.detectPortsFromText(rawCmd, detectedPorts, detectedUrls);

    const taskEntry = {
      id: taskId,
      sessionId: sessionId ? String(sessionId) : "",
      command: rawCmd,
      cwd: cwd ? String(cwd) : process.cwd(),
      name: name ? String(name).trim() : this.generateTaskName(rawCmd, detectedPorts),
      status: "running",
      startTime: new Date().toISOString(),
      endTime: null,
      exitCode: null,
      ports: [...detectedPorts],
      urls: [...detectedUrls],
      outputTail: [],
      childProcess: null,
      pid: undefined,
    };

    try {
      const child = spawn(program, args, {
        cwd: taskEntry.cwd,
        detached: !win32, // Unix 上创建独立进程组，便于整组杀死
        stdio: ["ignore", "pipe", "pipe"],
      });

      taskEntry.childProcess = child;
      taskEntry.pid = child.pid;

      const appendOutput = (text, isError = false) => {
        const lines = String(text).split(/\r?\n/);
        for (const line of lines) {
          if (!line && lines.length > 1) continue;
          const formatted = isError ? `[stderr] ${line}` : line;
          taskEntry.outputTail.push(formatted);
          if (taskEntry.outputTail.length > MAX_OUTPUT_LINES) {
            taskEntry.outputTail.shift();
          }
          // 从输出中动态检测端口与服务 URL
          if (this.detectPortsFromText(line, detectedPorts, detectedUrls)) {
            taskEntry.ports = [...detectedPorts];
            taskEntry.urls = [...detectedUrls];
            if (!name) {
              taskEntry.name = this.generateTaskName(rawCmd, detectedPorts);
            }
          }
        }
        this.emit("task-output", taskEntry);
      };

      child.stdout.on("data", (chunk) => appendOutput(chunk.toString()));
      child.stderr.on("data", (chunk) => appendOutput(chunk.toString(), true));

      child.on("error", (err) => {
        taskEntry.status = "error";
        taskEntry.endTime = new Date().toISOString();
        appendOutput(`[error] 进程启动失败: ${err.message}`, true);
        this.emit("task-status", taskEntry);
      });

      child.on("close", (code) => {
        taskEntry.status = code === 0 ? "stopped" : (taskEntry.status === "stopped" ? "stopped" : "error");
        taskEntry.exitCode = code;
        taskEntry.endTime = new Date().toISOString();
        this.emit("task-status", taskEntry);
      });

      this.tasks.set(taskId, taskEntry);
      this.emit("task-started", taskEntry);

      return this.serializeTask(taskEntry);
    } catch (err) {
      taskEntry.status = "error";
      taskEntry.endTime = new Date().toISOString();
      taskEntry.outputTail.push(`[error] 启动失败: ${err.message}`);
      this.tasks.set(taskId, taskEntry);
      this.emit("task-status", taskEntry);
      throw err;
    }
  }

  /**
   * 终止后台任务（杀死整棵进程树）
   */
  async stopTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status !== "running" || !task.childProcess || !task.pid) {
      task.status = "stopped";
      this.emit("task-status", task);
      return true;
    }

    task.status = "stopped";
    const pid = task.pid;
    const win32 = process.platform === "win32";

    try {
      if (win32) {
        spawn("taskkill", ["/pid", String(pid), "/T", "/F"]);
      } else {
        // Unix 上杀死进程组
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          process.kill(pid, "SIGTERM");
        }
        // 1.5 秒后若仍在运行则强制 SIGKILL
        setTimeout(() => {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            try {
              process.kill(pid, "SIGKILL");
            } catch {
              // 已经退出
            }
          }
        }, 1500);
      }
    } catch (err) {
      console.warn(`[background-tasks] Failed to kill process ${pid}:`, err);
    }

    task.endTime = new Date().toISOString();
    this.emit("task-status", task);
    return true;
  }

  /**
   * 重启后台任务
   */
  async restartTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("任务不存在");

    await this.stopTask(taskId);
    // 等待 300ms 确保旧端口释放
    await new Promise((resolve) => setTimeout(resolve, 300));

    return this.startTask({
      command: task.command,
      cwd: task.cwd,
      sessionId: task.sessionId,
      name: task.name,
    });
  }

  /**
   * 获取任务列表（可按会话过滤）
   */
  listTasks(sessionId) {
    const list = Array.from(this.tasks.values());
    const filtered = sessionId
      ? list.filter((t) => String(t.sessionId || "") === String(sessionId))
      : list;
    return filtered.map((t) => this.serializeTask(t));
  }

  /**
   * 获取指定任务的日志
   */
  getTaskLogs(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return [];
    return task.outputTail;
  }

  /**
   * 清理全部后台任务（应用退出时调用）
   */
  cleanupAll() {
    for (const task of this.tasks.values()) {
      if (task.status === "running" && task.pid) {
        try {
          if (process.platform === "win32") {
            spawn("taskkill", ["/pid", String(task.pid), "/T", "/F"]);
          } else {
            try {
              process.kill(-task.pid, "SIGKILL");
            } catch {
              process.kill(task.pid, "SIGKILL");
            }
          }
        } catch {
          // 忽略退出清理异常
        }
      }
    }
  }

  /**
   * 文本/日志中探测端口与 URL
   */
  detectPortsFromText(text, portSet, urlSet) {
    if (!text || typeof text !== "string") return false;
    let found = false;

    // 1. 匹配完整 URL (http://localhost:8080 等)
    const urlRegex = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d{2,5}))?(?:\/[^\s"']*)?)/gi;
    let urlMatch;
    while ((urlMatch = urlRegex.exec(text)) !== null) {
      const fullUrl = urlMatch[1];
      const portStr = urlMatch[2];
      if (portStr) {
        const portNum = parseInt(portStr, 10);
        if (portNum > 0 && portNum <= 65535) {
          portSet.add(portNum);
          urlSet.add(`http://localhost:${portNum}`);
          found = true;
        }
      } else if (fullUrl.startsWith("https:")) {
        portSet.add(443);
        urlSet.add(fullUrl.replace("0.0.0.0", "localhost"));
        found = true;
      } else {
        portSet.add(80);
        urlSet.add(fullUrl.replace("0.0.0.0", "localhost"));
        found = true;
      }
    }

    // 2. 匹配 "Serving HTTP on ... port 8000" / "port 8080" / "port: 3000" / "-p 8080" / "--port 8080"
    const portPatterns = [
      /(?:Serving HTTP on|listening on|running on|server at|port|端口)[:\s=]+(?:0\.0\.0\.0|127\.0\.0\.1|localhost)?[:\s]*(\d{2,5})/i,
      /(?:-p|--port)[=\s]+(\d{2,5})/i,
      /(?:http\.server)\s+(\d{2,5})/i,
    ];

    for (const pattern of portPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const portNum = parseInt(match[1], 10);
        if (portNum > 0 && portNum <= 65535) {
          portSet.add(portNum);
          urlSet.add(`http://localhost:${portNum}`);
          found = true;
        }
      }
    }

    return found;
  }

  generateTaskName(command, ports) {
    const cmd = command.trim();
    if (ports && ports.size > 0) {
      const portList = Array.from(ports).join(", ");
      if (/http\.server/i.test(cmd)) return `HTTP 服务 (:${portList})`;
      if (/npm|vite|webpack|dev/i.test(cmd)) return `开发服务 (:${portList})`;
      return `${cmd.slice(0, 30)} (:${portList})`;
    }
    if (/http\.server/i.test(cmd)) return "HTTP 服务";
    if (/ssh/i.test(cmd)) return "SSH 后台服务";
    if (/npm run|yarn|pnpm/i.test(cmd)) return cmd.slice(0, 40);
    return cmd.slice(0, 40);
  }

  serializeTask(t) {
    return {
      id: t.id,
      sessionId: t.sessionId,
      command: t.command,
      cwd: t.cwd,
      name: t.name,
      status: t.status,
      startTime: t.startTime,
      endTime: t.endTime,
      exitCode: t.exitCode,
      ports: t.ports || [],
      urls: t.urls || [],
      outputTail: t.outputTail || [],
      pid: t.pid,
    };
  }
}

export const backgroundTasksManager = new BackgroundTasksManager();
