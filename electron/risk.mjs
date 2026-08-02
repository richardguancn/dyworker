// 统一风险分级（借鉴 openworker coworker/risk.py）：所有工具调用的唯一分类来源。
// 审批管线（agent.mjs evaluateApproval）、常设规则、审计日志都以此为准。
// 本文件不依赖 electron，方便用 node --test 直接测试。
import { computerUseAction, isComputerUseTool } from "./computer-use.mjs";

export const RISK = Object.freeze({
  READ: "read",
  WRITE_LOCAL: "write_local",
  EXEC: "exec",
  EXTERNAL: "external",
});

// 需要审批的内建工具（= 全部 consequential 内建工具，单源，agent.mjs 从这里 import）
export const toolsNeedingApproval = new Set(["write_file", "edit_file", "make_directory", "append_file", "copy_file", "move_file", "delete_file", "run_command", "save_skill", "update_skill", "export_word_document", "export_excel_workbook"]);
export const workspaceWriteTools = new Set(["write_file", "edit_file", "make_directory", "append_file", "copy_file", "move_file", "delete_file", "export_word_document", "export_excel_workbook"]);
export const internetApprovalTools = new Set(["web_search", "gov_search", "fetch_web_page", "browser__open"]);

// 浏览器协作中的只读操作（打开网页、点击、输入、截图都可能产生对外影响，需确认）
export const browserReadOnlyTools = new Set(["browser__read", "browser__snapshot", "browser__close"]);

// 本机界面操作是否属于变更（变更操作即使在完全访问模式下也必须逐次确认，
// 避免误点付款、删除、安全设置等高风险控件）。读取应用状态属于只读操作；
// 内置实现不会在读取时自动启动应用，启动必须先经过 launch_app 授权。
export function computerUseActionNeedsApproval(name, platform = process.platform) {
  const action = computerUseAction(name);
  if (
    !action
    || action === "list_apps"
    || action === "get_app_state"
    || action === "check_dependencies"
    || action === "check_permissions"
    || action === "prepare_dependency_install"
  ) return false;
  return true;
}

// 联网信息获取（搜索/读网页正文）不改变外部世界，只读语义：
// 互动模式下仍会逐次询问（internetApprovalTools），但只读模式（deny-changes）放行。
const internetReadTools = new Set(["web_search", "gov_search", "fetch_web_page"]);

// 把一次工具调用归入四级风险之一。返回：
//   risk                 RISK 之一
//   consequential        是否有副作用（等价于旧 needsApproval；权限引擎只关心 consequential 调用）
//   computerUseMutation  是否本机界面变更操作
//   internet             是否联网工具
export function classify(name, args = {}, { platform = process.platform } = {}) {
  const computerUseMutation = isComputerUseTool(name) && computerUseActionNeedsApproval(name, platform);
  if (computerUseMutation) {
    return { risk: RISK.EXTERNAL, consequential: true, computerUseMutation: true, internet: false };
  }
  if (isComputerUseTool(name)) {
    return { risk: RISK.READ, consequential: false, computerUseMutation: false, internet: false };
  }
  if (name.startsWith("browser__")) {
    if (browserReadOnlyTools.has(name)) {
      return { risk: RISK.READ, consequential: false, computerUseMutation: false, internet: false };
    }
    return { risk: RISK.EXTERNAL, consequential: true, computerUseMutation: false, internet: name === "browser__open" };
  }
  if (internetReadTools.has(name)) {
    return { risk: RISK.EXTERNAL, consequential: false, computerUseMutation: false, internet: true };
  }
  if (name.startsWith("mcp__")) {
    return { risk: RISK.EXTERNAL, consequential: true, computerUseMutation: false, internet: false };
  }
  if (name === "run_command") {
    return { risk: RISK.EXEC, consequential: true, computerUseMutation: false, internet: false };
  }
  if (workspaceWriteTools.has(name) || toolsNeedingApproval.has(name)) {
    return { risk: RISK.WRITE_LOCAL, consequential: true, computerUseMutation: false, internet: false };
  }
  return { risk: RISK.READ, consequential: false, computerUseMutation: false, internet: false };
}

export function isConsequential(name, args = {}, opts = {}) {
  return classify(name, args, opts).consequential;
}
