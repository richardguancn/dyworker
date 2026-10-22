// 工具执行钩子。


// 工具风险集合（toolsNeedingApproval / workspaceWriteTools / internetApprovalTools / browserReadOnlyTools）
// 已迁入 ./risk.mjs 作为单源，本文件顶部统一 import。

// ---- 工具钩子（借鉴 Claude Code hooks：用户/工作区级规则在工具执行前拦截）----
// 规则由主进程从用户级 hooks.json 与工作区 .dyworker/hooks.json 注入，格式：
//   { "event": "before_tool", "tool": "delete_file" 或 ["edit_file","write_file"] 或 "*",
//     "path": "*.docx"（可选，* 通配，匹配 args.path/source/target）,
//     "action": "block" | "require_approval", "message": "可选说明" }
// block = 直接阻止执行；require_approval = 任何模式（含自动修改）下都强制弹审批
export function hookPathMatcher(glob) {
  const source = String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${source}$`, "i");
}

// 内置钩子规则：永远生效且最先匹配（用户规则只能追加、不能覆盖）
// ① 钩子配置文件本身的写/改/删必须人工确认——防止 agent 在自动模式下静默削弱保护
// ② 灾难性命令直接阻止（提权、格式化、关机、写盘）
// 删除命令交给正常审批管线：完全访问遵循用户授权，reviewer 按上下文审核，
// 其余模式仍按命令风险询问。不能在这里仅凭 rm -rf 字样绕过所选权限模式。
export const builtinHooks = [
  { event: "before_tool", tool: ["write_file", "edit_file", "append_file", "delete_file", "move_file"], path: ".dyworker/hooks.json", action: "require_approval", message: "修改钩子规则属于高危操作，必须人工确认" },
  { event: "before_tool", tool: "run_command", command: "*sudo *", action: "block", message: "禁止提权运行命令" },
  { event: "before_tool", tool: "run_command", command: "sudo *", action: "block", message: "禁止提权运行命令" },
  { event: "before_tool", tool: "run_command", command: "*mkfs*", action: "block", message: "禁止格式化磁盘" },
  { event: "before_tool", tool: "run_command", command: "*shutdown*", action: "block", message: "禁止关机类命令" },
  { event: "before_tool", tool: "run_command", command: "*reboot*", action: "block", message: "禁止重启类命令" },
  { event: "before_tool", tool: "run_command", command: "*dd if=*", action: "block", message: "禁止直接写盘命令" },
];

export function evaluateHooks(hooks, event, name, args): { action: "block" | "require_approval"; message: string; reviewable?: boolean } | null {
  for (const rule of Array.isArray(hooks) ? hooks : []) {
    if (String(rule?.event || "before_tool") !== event) continue;
    const tools = Array.isArray(rule?.tool) ? rule.tool : [rule?.tool ?? "*"];
    if (!tools.some((tool) => tool === "*" || tool === name)) continue;
    if (rule?.path) {
      const target = String(args?.path ?? args?.target ?? args?.source ?? "");
      if (!hookPathMatcher(rule.path).test(target)) continue;
    }
    if (rule?.command) {
      if (!hookPathMatcher(rule.command).test(String(args?.command || ""))) continue;
    }
    return {
      action: rule?.action === "require_approval" ? "require_approval" : "block",
      message: String(rule?.message || ""),
    };
  }
  return null;
}
