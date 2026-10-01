// IPC 域插件：使用统计与工具钩子（usage:* / hooks:*）。
// 两者都是"读一个 JSON + 交给系统打开"，逻辑留在本插件，边界能力由壳层注入。
export function usageHooksIpcPlugin(deps) {
  return {
    name: "ipc:usage-hooks",
    apply(ctx) {
      const { trustedHandle, dataFile, readJson, writeJson, existsSync, shell, builtinHooks, readUsageStats, clearUsageStats } = deps;

      trustedHandle("usage:list", () => readUsageStats());

      trustedHandle("usage:clear", () => clearUsageStats());

      trustedHandle("hooks:list", async () => {
        const userPath = dataFile("hooks.json");
        const userRules = await readJson(userPath, []);
        return {
          builtin: builtinHooks,
          user: Array.isArray(userRules) ? userRules : [],
          userPath,
        };
      });

      trustedHandle("hooks:open-user", async () => {
        const userPath = dataFile("hooks.json");
        if (!existsSync(userPath)) await writeJson(userPath, []);
        return shell.openPath(userPath);
      });
    },
  };
}
