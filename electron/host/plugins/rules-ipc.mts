// IPC 域插件样板：常驻允许规则（rules:*）。
// 拆分模式（见 docs/architecture.md「IPC 拆分」）：
//   - trustedHandle 块从 main.mts 原样移入，通道名不变、preload 不动
//   - 领域依赖（读规则/写规则/suggest 校验）经 deps 注入，插件本身不 import electron
//   - main 装配点：ctx.plugin(rulesIpcPlugin(deps))
export function rulesIpcPlugin(deps) {
  return {
    name: "ipc:rules",
    apply(ctx: any) {
      const { trustedHandle, readStandingRules, writeStandingRules, suggestStandingRule, randomUUID } = deps;
      trustedHandle("rules:list", () => readStandingRules());

      trustedHandle("rules:add", async (_event, payload) => {
        const kind = String(payload?.kind || "");
        const tool = String(payload?.tool || "");
        const pattern = String(payload?.pattern || "").trim();
        const label = String(payload?.label || "").trim().slice(0, 120);
        if (!["path-glob", "domain", "mcp-tool", "command-prefix"].includes(kind)) return { ok: false, error: "规则类型无效" };
        if (!tool || !pattern) return { ok: false, error: "规则内容不完整" };
        // 用 agent 侧同一套判定确保规则确实能生效（不可规则化时 suggest 返回 null）
        const probeArgs =
          kind === "path-glob" ? { path: pattern }
          : kind === "domain" ? { url: `https://${pattern}/` }
          : kind === "command-prefix" ? { command: pattern }
          : {};
        const probeTool = kind === "mcp-tool" ? pattern : tool;
        if (!suggestStandingRule(probeTool, probeArgs)) return { ok: false, error: "这类操作不支持始终允许，需要逐次确认" };
        const rules = await readStandingRules();
        if (rules.some((rule) => rule.kind === kind && rule.tool === tool && rule.pattern === pattern)) {
          return { ok: true, duplicated: true };
        }
        rules.push({ id: randomUUID(), kind, tool, pattern, label: label || pattern, createdAt: new Date().toISOString() });
        await writeStandingRules(rules);
        return { ok: true };
      });

      trustedHandle("rules:delete", async (_event, id) => {
        const rules = await readStandingRules();
        await writeStandingRules(rules.filter((rule) => String(rule.id) !== String(id)));
        return { ok: true };
      });
    },
  };
}
