// 独立的官方 DSH Context。DYWorker 的同名服务和已解密设置不会进入此进程。
import { Context, Inject } from "@deepseek-ai/cordis";
import Tools from "@deepseek-ai/dsh-tools";
import Sessions from "@deepseek-ai/dsh-session";
import Projections from "@deepseek-ai/dsh-session-projection";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import FileSystem from "@deepseek-ai/dsh-fs-local";
import { registerPluginModules } from "../plugin-module-cache.mts";
import { DSH_RUNTIME_SERVICES } from "./baseline.mts";
import { installFileHandleBridge } from "./file-handles.mts";

installFileHandleBridge();

let ctx: any;
let session: any;
const controllers = new Map<string, AbortController>();
const send = (message: any) => process.send?.(message);
process.once("message", async (input: any) => {
  try {
    registerPluginModules(input.profileDir);
    ctx = new Context();
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false });
    await ctx.plugin(Sessions);
    await ctx.plugin(Projections);
    await ctx.plugin(FileSystem, { cwd: input.workspacePath || input.profileDir, diffBasisMaxBytes: 10 * 1024 * 1024 });
    await ctx.plugin(Tools, { mode: "native" });
    const mod = await import(input.entryUrl);
    const plugin = mod.default ?? mod;
    const inject = Inject.resolve(mod.inject ?? plugin.inject);
    const missing = Object.keys(inject).filter(name => !DSH_RUNTIME_SERVICES.includes(name));
    if (missing.length) throw new Error(`此运行环境暂不支持：${missing.join("、")}`);
    const fiber = ctx.plugin(plugin, input.config ?? {});
    await fiber;
    await ctx.fiber.await();
    if (fiber.state !== 2) throw new Error(`插件未启动（状态 ${fiber.state}）`);
    if (input.sessionId) {
      session = ctx.sessions.create(input.sessionId, { meta: { cwd: input.workspacePath }, seed: input.events || [] });
    }
    send({ type: "ready", schemas: ctx.tools.schemas(), state: "active" });
    process.on("message", async (call: any) => {
      if (call.type === "cancel") { for (const controller of controllers.values()) controller.abort(new Error("任务已停止")); return; }
      if (call.type !== "execute") return;
      try {
        if (!session) throw new Error("工具执行缺少所属会话");
        const controller = new AbortController(); controllers.set(call.callId, controller);
        const agent = Object.freeze({ id: input.runId, session, ctx });
        const result = await ctx.tools.execute({ callId: call.callId, name: call.name, arguments: call.args,
          agent, signal: controller.signal });
        const events = Array.from({ length: session.seq }, (_, seq) => session.eventAt(seq));
        send({ type: "result", callId: call.callId, result, events });
      } catch (error: any) { send({ type: "error", callId: call.callId, error: String(error?.message || error) }); }
      finally { controllers.delete(call.callId); }
    });
  } catch (error: any) { send({ type: "error", error: String(error?.message || error) }); }
});
