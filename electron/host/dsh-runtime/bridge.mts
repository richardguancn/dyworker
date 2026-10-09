import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnPluginProcess, terminatePluginProcess } from "./process.mts";
const sessionQueues = new Map<string, Promise<unknown>>();

/** 每个插件、会话和任务拥有自己的执行进程；取消不终止其他会话。 */
export class DshPluginBridge {
  runs = new Map<string, any>();
  closing = false;
  schemas: any[] = [];
  readonly options: any;
  constructor(options: any) { this.options = options; }

  async start(extra: any = {}, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const child = spawnPluginProcess("worker", { ...this.options, ...extra });
    let stderr = "";
    child.stderr?.on("data", data => { stderr = (stderr + data).slice(-4000); });
    const ready = await new Promise<any>((resolve, reject) => {
      const finish = (error?: any, value?: any) => {
        clearTimeout(timer); signal?.removeEventListener("abort", aborted);
        child.off("message", message); child.off("exit", exited); child.off("error", finish);
        if (error) reject(error); else resolve(value);
      };
      const message = (value: any) => { if (value.type === "ready") finish(undefined, value); else if (value.type === "error") finish(new Error(value.error)); };
      const exited = (code: any) => finish(new Error(`插件进程退出（${code}）：${stderr}`));
      const aborted = () => finish(signal?.reason || new Error("任务已停止"));
      const timer = setTimeout(() => finish(new Error("插件启动超时")), 15_000);
      child.on("message", message); child.once("exit", exited); child.once("error", finish);
      signal?.addEventListener("abort", aborted, { once: true });
      child.send({ ...this.options, ...extra });
    }).catch(async error => { await terminatePluginProcess(child); throw error; });
    return { child, ready, pending: new Map(), queue: Promise.resolve(), stop: () => terminatePluginProcess(child) };
  }
  async discover() {
    const run = await this.start();
    try { this.schemas = run.ready.schemas; return this.schemas; }
    finally { await run.stop(); }
  }
  stateFile(sessionId: string) {
    // 会话事件按 DSH 环境与会话保存，不向插件开放宿主数据目录。
    const key = createHash("sha256").update(sessionId).digest("hex");
    return path.join(this.options.profileDir, "data", "dsh-sessions", key + ".json");
  }
  async execute(name: string, args: any, execution: any) {
    const file = this.stateFile(execution.sessionId);
    const prior = sessionQueues.get(file) || Promise.resolve();
    const next = prior.catch(() => {}).then(() => this.executeSerial(name, args, execution));
    sessionQueues.set(file, next);
    try { return await next; }
    finally { if (sessionQueues.get(file) === next) sessionQueues.delete(file); }
  }
  async executeSerial(name: string, args: any, execution: any) {
    const { sessionId, runId, workspacePath, signal } = execution;
    if (this.closing) throw new Error("插件已停用");
    if (!sessionId || !runId || !workspacePath) throw new Error("DSH 工具需要所属任务和工作目录");
    signal?.throwIfAborted();
    const before = await this.fileSnapshot(workspacePath, args?.path);
    const key = JSON.stringify([sessionId, runId, path.resolve(workspacePath), randomUUID()]);
    const entry = this.createRun({ sessionId, runId, workspacePath }, signal);
    this.runs.set(key, entry);
    let run: any;
    try { run = await entry; }
    catch (error) { this.runs.delete(key); throw error; }
    const task = async () => {
      signal?.throwIfAborted();
      if (this.closing || run.child.exitCode != null || run.child.signalCode != null) throw new Error("插件进程已停止");
      const callId = randomUUID();
      let result: any;
      try {
        result = await new Promise<any>((resolve, reject) => {
          run.pending.set(callId, { resolve, reject });
          run.child.send({ type: "execute", callId, name, args });
        });
      } finally { run.pending.delete(callId); }
      signal?.throwIfAborted();
      if (result.isError) throw new Error(result.error?.message || result.content?.map(item => item.text).join("\n") || "插件工具执行失败");
      if (result.concludesTurn) throw new Error("该插件工具需要 DSH 的任务轮次控制，目前暂不支持");
      const after = await this.fileSnapshot(workspacePath, args?.path);
      const changed = after?.exists && after.sha256 !== before?.sha256;
      return { ...result, hostReceipts: changed ? [{ path: after.path, sha256: after.sha256, sizeBytes: after.sizeBytes }] : [] };
    };
    try { return await task(); }
    finally { this.runs.delete(key); await run.stop(); }
  }
  async fileSnapshot(workspacePath: string, fileName: unknown) {
    if (typeof fileName !== "string" || !fileName) return null;
    const root = await fs.realpath(workspacePath);
    let candidate = path.resolve(root, fileName);
    try { candidate = await fs.realpath(candidate); }
    catch (error: any) { if (error.code === "ENOENT") return { exists: false }; return null; }
    const relative = path.relative(root, candidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    const stat = await fs.stat(candidate);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return null;
    const bytes = await fs.readFile(candidate);
    return { exists: true, path: relative, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  async createRun(input: any, signal?: AbortSignal) {
    input = { ...input, workspacePath: await fs.realpath(input.workspacePath) };
    let events = [];
    const file = this.stateFile(input.sessionId);
    try { events = JSON.parse(await fs.readFile(file, "utf8")).events || []; } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    const run = await this.start({ ...input, events }, signal);
    const stopProcess = run.stop;
    const fileOperations = new Set<Promise<void>>();
    run.stop = async () => { await stopProcess(); await Promise.allSettled([...fileOperations]); };
    const fail = () => { for (const pending of run.pending.values()) pending.reject(new Error("插件任务已停止")); };
    const aborted = async () => {
      if (run.child.connected) run.child.send({ type: "cancel" });
      // 先给合作代码传递停止信号；不合作或阻塞事件循环时由进程终止兜底。
      await Promise.race([new Promise(resolve => run.child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 100))]);
      await run.stop(); fail();
    };
    signal?.addEventListener("abort", aborted, { once: true });
    run.child.once("exit", () => { signal?.removeEventListener("abort", aborted); fail(); });
    run.child.on("message", async (message: any) => {
      if (message.type === "file-handle") {
        const operation = (async () => {
        let error: string | undefined;
        try {
          const root = await fs.realpath(input.workspacePath);
          const file = await fs.realpath(String(message.file));
          const relative = path.relative(root, file);
          if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("文件操作越出工作目录");
          if (!(await fs.stat(file)).isFile()) throw new Error("文件操作只允许普通文件");
          if (message.operation === "chmod" && Number.isInteger(message.mode) && message.mode >= 0 && message.mode <= 0o777) await fs.chmod(file, message.mode);
          else if (message.operation === "sync") {
            const handle = await fs.open(file, "r+");
            try { await handle.sync(); } finally { await handle.close(); }
          } else throw new Error("不支持的文件操作");
        } catch (failure: any) { error = String(failure?.message || failure); }
        if (run.child.connected) run.child.send({ type: "file-handle-result", id: message.id, error });
        })();
        fileOperations.add(operation);
        try { await operation; } finally { fileOperations.delete(operation); }
        return;
      }
      const pending = run.pending.get(message.callId);
      if (!pending) return;
      if (message.type === "error") { pending.reject(new Error(message.error)); return; }
      if (message.type !== "result") return;
      try {
        // 结果返回后立刻结束代码执行，再落盘；防止计时器在调用结束后继续写。
        run.pending.delete(message.callId);
        await run.stop();
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temp = file + "." + randomUUID() + ".tmp";
        await fs.writeFile(temp, JSON.stringify({ version: 1, events: message.events }), "utf8");
        await fs.rename(temp, file);
        pending.resolve(message.result);
      } catch (error) { pending.reject(error); }
    });
    if (signal?.aborted) await aborted();
    return run;
  }
  async stopRun(sessionId: string, runId: string) {
    const targets = [...this.runs.entries()].filter(([key]) => { const values = JSON.parse(key); return values[0] === sessionId && values[1] === runId; });
    await Promise.all(targets.map(async ([key, value]) => { this.runs.delete(key); await (await value.catch(() => null))?.stop(); }));
  }
  async dispose() {
    this.closing = true;
    const targets = [...this.runs.values()]; this.runs.clear();
    await Promise.all(targets.map(async value => { const run = await value.catch(() => null); await run?.stop(); }));
  }
}
