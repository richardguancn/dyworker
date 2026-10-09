// 独立探测进程：只返回插件声明，不向插件注入应用设置、凭据和服务。
import { Inject } from "@deepseek-ai/cordis";
import { registerPluginModules } from "../plugin-module-cache.mts";
process.once("message", async (input: any) => {
  try {
    const cleanup = registerPluginModules(input.profileDir);
    const mod = await import(input.entryUrl);
    const plugin = mod.default ?? mod;
    const inject = mod.inject ?? plugin?.inject;
    const result = { inject: Object.keys(Inject.resolve(inject)), name: String(mod.name ?? plugin?.name ?? "") };
    cleanup?.();
    process.send?.(result, () => process.exit(0));
  } catch (error: any) { process.send?.({ importError: String(error?.message || error) }, () => process.exit(0)); }
});
