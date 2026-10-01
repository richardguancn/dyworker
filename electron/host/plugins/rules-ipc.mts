// IPC 域插件样板：常驻允许规则（rules:*）。
// 拆分模式（见 docs/architecture.md「IPC 拆分」）：
//   - trustedHandle 块从 main.mts 移入，通道名不变、preload 不动
//   - 领域逻辑（读写规则、可生效性校验）在 ctx.rules 服务里，插件只做通道映射
//   - 依赖用 cordis inject 声明：ctx.rules 就绪前插件不会被 apply，
//     不再是「手工塞一包 deps」——漏接依赖会直接不激活，而不是运行期 undefined
//   - 只有 electron 边界的 trustedHandle 仍由壳层注入（host 不 import electron）
export function rulesIpcPlugin(deps) {
  return {
    name: "ipc:rules",
    inject: ["rules"],
    apply(ctx) {
      const { trustedHandle } = deps;

      trustedHandle("rules:list", () => ctx.rules.list());

      trustedHandle("rules:add", (_event, payload) => ctx.rules.add(payload));

      trustedHandle("rules:delete", (_event, id) => ctx.rules.remove(id));
    },
  };
}
