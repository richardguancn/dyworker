import { createOfficialDshContext } from './official-context.mts';
import { mountDshProfile } from './profile.mts';
import { registerPluginModules } from '../plugin-module-cache.mts';
import { createPtcProxy } from './ptc-proxy.mts';
import { DSH_SESSION_SERVICES } from './baseline.mts';

// 在临时目录真实启动插件。没有模型、用户提问或程序执行的应用授权。
process.once('message', async (input: any) => {
  let ctx: any;
  try {
    registerPluginModules(input.profileDir);
    const ptc = createPtcProxy(async () => { throw new Error('兼容检查不能执行工作流程序'); });
    ctx = await createOfficialDshContext({ ...input, ptc });
    await mountDshProfile(ctx, { ...input, plugins: [{ id: 'compatibility-probe', entryUrl: input.entryUrl, config: input.config || {} }] });
    const services = DSH_SESSION_SERVICES.filter(name => Boolean(ctx.get(name)));
    process.send?.({ ok: true, services });
  } catch (error: any) { process.send?.({ ok: false, error: String(error?.message || error) + (error?.resource ? `（${error.resource}）` : '') }); }
  finally { await ctx?.fiber.dispose(); process.disconnect?.(); }
});
