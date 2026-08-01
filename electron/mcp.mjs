// MCP（Model Context Protocol）stdio 客户端：换行分隔的 JSON-RPC 2.0
// 不依赖 electron，可用 node --test 直接测试。
import { spawn } from "node:child_process";

const REQUEST_TIMEOUT_MS = 30_000;

export class McpClient {
  constructor({ command, args = [], env, cwd, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
    this.requestTimeoutMs = Math.max(1, Number(requestTimeoutMs) || REQUEST_TIMEOUT_MS);
    this.process = null;
    this.buffer = "";
    this.stderrTail = "";
    this.nextId = 1;
    this.pending = new Map();
    this.tools = [];
  }

  async connect() {
    if (this.process) return;
    this.process = spawn(this.command, this.args, {
      env: this.env || { ...process.env },
      cwd: this.cwd || undefined,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.on("error", () => this.failAll(new Error(`MCP 服务器启动失败：${this.command}`)));
    this.process.on("exit", () => {
      const detail = this.stderrTail.trim();
      this.failAll(new Error(`MCP 服务器意外退出${detail ? `：${detail}` : ""}`));
      this.process = null;
    });
    this.process.stdout.on("data", (chunk) => this.handleData(chunk));
    // 必须持续读取 stderr，避免服务日志写满管道后反向阻塞整个 MCP 连接。
    this.process.stderr.on("data", (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-8_000);
    });
    try {
      const result = await this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "dyworker", version: "0.1" },
      });
      this.notify("notifications/initialized");
      this.serverInfo = result?.serverInfo;
      const list = await this.request("tools/list", {});
      this.tools = Array.isArray(list?.tools) ? list.tools : [];
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  handleData(chunk) {
    this.buffer += chunk.toString("utf8");
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id == null) continue;
      const entry = this.pending.get(message.id);
      if (!entry) continue;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      entry.signal?.removeEventListener("abort", entry.onAbort);
      if (message.error) entry.reject(new Error(message.error.message || "MCP 调用失败"));
      else entry.resolve(message.result);
    }
  }

  failAll(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.signal?.removeEventListener("abort", entry.onAbort);
      entry.reject(error);
    }
    this.pending.clear();
  }

  send(payload) {
    if (!this.process?.stdin.writable) throw new Error("MCP 服务器没有连接");
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  request(method, params, requestTimeoutMs = this.requestTimeoutMs, signal) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("任务已停止"));
        return;
      }
      const normalizedTimeout = Number(requestTimeoutMs);
      const effectiveTimeout = normalizedTimeout === 0
        ? 0
        : Math.max(1, normalizedTimeout || this.requestTimeoutMs);
      const onAbort = () => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        this.notify("notifications/cancelled", { requestId: id, reason: "任务已停止" });
        reject(new Error("任务已停止"));
      };
      const timer = effectiveTimeout > 0
        ? setTimeout(() => {
          const entry = this.pending.get(id);
          this.pending.delete(id);
          entry?.signal?.removeEventListener("abort", entry.onAbort);
          reject(new Error(`MCP 请求超时：${method}`));
        }, effectiveTimeout)
        : null;
      this.pending.set(id, { resolve, reject, timer, signal, onAbort });
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      }
    });
  }

  notify(method, params) {
    try {
      this.send({ jsonrpc: "2.0", method, params });
    } catch {
      // 通知失败不影响主流程
    }
  }

  async callTool(name, args, { requestTimeoutMs, signal } = {}) {
    const result = await this.request("tools/call", { name, arguments: args || {} }, requestTimeoutMs, signal);
    const parts = Array.isArray(result?.content) ? result.content : [];
    const text = parts
      .filter((part) => part?.type === "text")
      .map((part) => part.text)
      .join("\n");
    const structured = result?.structuredContent && typeof result.structuredContent === "object"
      ? JSON.stringify(result.structuredContent)
      : "";
    const images = parts
      .filter((part) =>
        part?.type === "image"
        && typeof part.data === "string"
        && part.data.length > 0
        && part.data.length <= 20_000_000
        && /^image\/(png|jpeg|webp)$/i.test(String(part.mimeType || "")))
      .slice(0, 2)
      .map((part) => ({ data: part.data, mimeType: part.mimeType }));
    const imageNote = images.length ? `\n（同时获取到 ${images.length} 张界面截图。）` : "";
    const fallback = parts.length
      ? parts.map((part) => part?.type === "image" ? `[界面截图 ${part.mimeType || "image"}]` : JSON.stringify(part)).join("\n")
      : JSON.stringify(result ?? {});
    return {
      isError: Boolean(result?.isError),
      text: `${text || structured || fallback}${imageNote}`.trim(),
      images,
    };
  }

  async close() {
    this.failAll(new Error("MCP 连接已关闭"));
    const child = this.process;
    if (!child) return;
    this.process = null;
    if (child.exitCode != null || child.signalCode != null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]);
    if (!graceful && child.exitCode == null && child.signalCode == null) {
      child.kill("SIGKILL");
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    }
  }
}
