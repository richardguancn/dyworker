// 常驻允许规则的匹配与建议。
import path from "node:path";
import { isComputerUseTool } from "../computer-use.mts";
import { shellWords } from "../shell-syntax.mts";
import { basenameOf,commandChainingPattern,ruleDevProgramWidths,ruleEligibleDomainTools,ruleEligiblePathTools,ruleGitCommands,ruleNeverAllowCommands,ruleTrustedPrograms } from "./command-policy.mts";
import { hookPathMatcher } from "./hooks.mts";
import { mcpToolLabel,toolSummary } from "./tool-summary.mts";

function ruleDomainOf(url) {
  try {
    return new URL(String(url || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function matchStandingRule(rules, name, args = {} as any) {
  if (!Array.isArray(rules) || !rules.length) return false;
  if (isComputerUseTool(name)) return false;
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    if (rule.kind === "path-glob" && ruleEligiblePathTools.has(name) && rule.tool === name) {
      const target = String(args.path ?? args.target ?? args.source ?? "");
      if (target && hookPathMatcher(String(rule.pattern || "")).test(target)) return true;
    }
    if (rule.kind === "domain" && ruleEligibleDomainTools.has(name)) {
      const host = ruleDomainOf(args.url);
      const pattern = String(rule.pattern || "").toLowerCase();
      if (host && pattern && (host === pattern || host.endsWith(`.${pattern}`))) return true;
    }
    if (rule.kind === "mcp-tool" && name.startsWith("mcp__") && !isComputerUseTool(name)) {
      if (String(rule.pattern || "") === name) return true;
    }
    // 插件工具：与 mcp-tool 同款"逐工具精确白名单"。默认永远是问，
    // 只有用户显式"始终允许这个插件工具"才放行；只读模式（deny-changes）
    // 在更早处已直接拒绝，常驻规则不会覆盖它。
    if (rule.kind === "plugin-tool" && name.startsWith("plugin__")) {
      if (String(rule.pattern || "") === name) return true;
    }
    if (rule.kind === "command-prefix" && name === "run_command") {
      const command = String(args.command || "").trim();
      if (!command || /[\r\n]/.test(command) || commandChainingPattern.test(command)) continue;
      const words = shellWords(command);
      const patternWords = shellWords(String(rule.pattern || ""));
      if (patternWords.length && patternWords.every((word, index) => words[index] === word)) return true;
    }
  }
  return false;
}

// 为一次审批请求生成可"始终允许"的规则建议；不可规则化时返回 null。
export function suggestStandingRule(name, args = {} as any) {
  if (name === "run_command") {
    const command = String(args.command || "").trim();
    const words = shellWords(command);
    const program = words[0] || "";
    // 带路径的调用（/opt/homebrew/bin/bun）按 basename 匹配程序类别，
    // 但 pattern 仍用原始词构建，保证前缀匹配精确
    const programKey = basenameOf(program);
    // 只对简单命令（单行、无管道/复合）提供始终允许;系统级破坏性命令除外
    if (!command || /[\r\n]/.test(command) || commandChainingPattern.test(command)) return null;
    if (ruleNeverAllowCommands.has(program) || ruleNeverAllowCommands.has(programKey)) return null;
    let pattern = "";
    if (ruleTrustedPrograms.test(program)) pattern = program;
    else if (programKey === "git") {
      const subcommand = words[1] || "";
      if (!ruleGitCommands.has(subcommand)) return null;
      pattern = `${program} ${subcommand}`;
    } else if (ruleDevProgramWidths[programKey]) {
      pattern = words.slice(0, ruleDevProgramWidths[programKey]).join(" ");
    } else {
      pattern = words.join(" ");
    }
    if (!pattern) return null;
    return { kind: "command-prefix", tool: name, pattern, label: `以后以「${pattern}」开头的命令不再询问` };
  }
  if (ruleEligiblePathTools.has(name)) {
    const target = String(args.path || "");
    const extension = path.extname(target).toLowerCase();
    if (!extension) return null;
    return { kind: "path-glob", tool: name, pattern: `*${extension}`, label: `${toolSummary(name, args)}：以后所有 ${extension} 文件不再询问` };
  }
  if (ruleEligibleDomainTools.has(name)) {
    const host = ruleDomainOf(args.url);
    if (!host) return null;
    return { kind: "domain", tool: name, pattern: host, label: `以后访问 ${host} 不再询问` };
  }
  if (name.startsWith("mcp__") && !isComputerUseTool(name)) {
    return { kind: "mcp-tool", tool: name, pattern: name, label: `以后使用「${mcpToolLabel(name)}」不再询问` };
  }
  return null;
}
