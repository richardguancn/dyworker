// 工具审批路由。
import { computerUseAction,isComputerUseTool } from "../computer-use.mts";
import { classify,internetApprovalTools,internetReadTools,workspaceWriteTools } from "../risk.mts";
import { isAutoApprovableCommand,isDevAutoApprovableCommand,isLowRiskCommand,isReviewerAutoApprovableCommand } from "./command-policy.mts";
import { matchStandingRule } from "./standing-rules.mts";

// 浏览器只读集合与本机界面变更判定（computerUseActionNeedsApproval）在 risk.mjs 定义、顶部 re-export。
export function needsApproval(name, platform = process.platform) {
  return classify(name, {}, { platform }).consequential;
}


// 统一审批管线（借鉴 openworker coworker/permissions.py 的 evaluate 流程）：
// 分级(classify) → 只读模式拦截 → 钩子强制 → 常驻规则放行 → 各模式判定。
// approvalDecision 是它的薄包装（无常驻规则），行为与历史版本完全一致。
export function evaluateApproval({
  approvalMode = "interactive",
  name = "",
  args = {},
  hasExternalPaths = false,
  hookRequiresApproval = false,
  platform = process.platform,
  standingRules = [],
} = {} as any) {
  const normallyNeedsApproval = needsApproval(name, platform);
  const computerUseMutation = isComputerUseTool(name) && normallyNeedsApproval;
  if (approvalMode === "deny-changes" && normallyNeedsApproval) return "deny";
  // 钩子强制审批永远压过常驻规则（保守：用户可用钩子撤销"始终允许"的效果）
  if (hookRequiresApproval) return "ask";
  // 常驻允许规则：命中用户"始终允许"或本次会话允许的规则时直接放行，且永不覆盖 deny-changes 与钩子
  if (matchStandingRule(standingRules, name, args)) return "allow";
  // 完全访问模式：放行所有常规命令、工作区读写与本机界面操作（避免弹窗夺取焦点冲掉下拉菜单）；
  // 仅系统级管理员安装（install_dependencies，需提权修改操作系统）保留确认。
  if (approvalMode === "full-access") {
    return (isComputerUseTool(name) && computerUseAction(name) === "install_dependencies") ? "ask" : "allow";
  }

  if (approvalMode === "interactive" || approvalMode === "reviewer") {
    if (hasExternalPaths) return "ask";
    // 替我审批（reviewer）：公开网络只读工具（搜索与读取网页正文）直接放行，不再要求人工审批
    if (approvalMode === "reviewer" && internetReadTools.has(name)) return "allow";
    if (internetApprovalTools.has(name)) return "ask";
    if (!normallyNeedsApproval) return "allow";
    // 删除不可恢复：不随"工作区写操作"直接放行，interactive 弹卡、reviewer 交审核助手把关
    // （含已授权的工作区外路径——路径授权只免"越界"问询，不免删除确认）
    if (name === "delete_file") return "ask";
    if (workspaceWriteTools.has(name)) return "allow";
    // 替我审批只对可证明只读的命令（含 env/nohup 包装下的只读命令）直接放行；
    // 会落盘、装包、跑脚本、提交的命令交审核助手结合用户任务判断，不再按程序名静默放行。
    if (name === "run_command" && (
      isAutoApprovableCommand(args.command)
      || (approvalMode === "reviewer" && isReviewerAutoApprovableCommand(args.command))
    )) return "allow";
    return "ask";
  }

  // 渠道「自动执行」：工作区内读写、低风险命令与联网读取直接放行；
  // 越界路径先交审核助手按上下文把关（见 isReviewerEligible 的 forExternalPaths），
  // 本机界面变更、危险命令与外发操作仍需人工确认。
  if (approvalMode === "auto") {
    if (hasExternalPaths || computerUseMutation) return "ask";
    if (name === "run_command") {
      return (isAutoApprovableCommand(args.command) || isLowRiskCommand(args.command)) ? "allow" : "ask";
    }
    if (internetReadTools.has(name)) return "allow";
    // 含数据外发的联网工具（ocr_file 上传文件内容到智谱云端）不在 internetReadTools，
    // 自动执行下也保持人工确认
    if (internetApprovalTools.has(name)) return "ask";
    if (workspaceWriteTools.has(name)) return "allow";
    if (name === "save_skill" || name === "update_skill") return "allow";
    return normallyNeedsApproval ? "ask" : "allow";
  }

  if (approvalMode === "allow-writes") {
    if (hasExternalPaths) return "ask";
    if (computerUseMutation) return "ask";
    if (name === "run_command") {
      return (isAutoApprovableCommand(args.command) || isDevAutoApprovableCommand(args.command)) ? "allow" : "ask";
    }
    return "allow";
  }

  if (hasExternalPaths) return "ask";
  return normallyNeedsApproval ? "ask" : "allow";
}

export function approvalDecision(opts = {} as any) {
  return evaluateApproval({ ...opts, standingRules: [] });
}
