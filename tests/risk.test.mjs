// 统一风险分级（risk.mjs）与审批管线（evaluateApproval）的等价性测试。
// oracle：历史版 approvalDecision 的内联副本，确保管线重构零行为变化。
import test from "node:test";
import assert from "node:assert/strict";
import { RISK, classify, isConsequential } from "../electron/risk.mjs";
import { approvalDecision, evaluateApproval, isAutoApprovableCommand, isDevAutoApprovableCommand, isLowRiskCommand, isReviewerAutoApprovableCommand, toolDefinitions } from "../electron/agent.mjs";

// ---- 历史实现内联副本（oracle），仅用于等价性比对 ----
const oracleToolsNeedingApproval = new Set(["write_file", "edit_file", "make_directory", "append_file", "copy_file", "move_file", "delete_file", "run_command", "save_skill", "update_skill", "export_word_document", "export_excel_workbook"]);
const oracleWorkspaceWriteTools = new Set(["write_file", "edit_file", "make_directory", "append_file", "copy_file", "move_file", "delete_file", "export_word_document", "export_excel_workbook"]);
const oracleInternetApprovalTools = new Set(["web_search", "gov_search", "fetch_web_page", "browser__open"]);
const oracleBrowserReadOnlyTools = new Set(["browser__read", "browser__snapshot", "browser__close"]);

function oracleNeedsApproval(name, platform) {
  if (name.startsWith("browser__")) return !oracleBrowserReadOnlyTools.has(name);
  if (name.startsWith("mcp__computer-use__")) {
    const action = name.slice("mcp__computer-use__".length);
    if (!action || action === "list_apps" || action === "get_app_state" || action === "check_dependencies" || action === "check_permissions" || action === "prepare_dependency_install") return false;
    return true;
  }
  return oracleToolsNeedingApproval.has(name) || name.startsWith("mcp__");
}

function oracleApprovalDecision({ approvalMode = "interactive", name = "", args = {}, hasExternalPaths = false, hookRequiresApproval = false, platform = process.platform } = {}) {
  const normallyNeedsApproval = oracleNeedsApproval(name, platform);
  const computerUseMutation = name.startsWith("mcp__computer-use__") && normallyNeedsApproval;
  if (approvalMode === "deny-changes" && normallyNeedsApproval) return "deny";
  if (hookRequiresApproval) return "ask";
  if (approvalMode === "full-access") return computerUseMutation ? "ask" : "allow";
  if (approvalMode === "interactive" || approvalMode === "reviewer") {
    if (hasExternalPaths || oracleInternetApprovalTools.has(name)) return "ask";
    if (!normallyNeedsApproval) return "allow";
    if (oracleWorkspaceWriteTools.has(name)) return "allow";
    if (name === "run_command" && (
      isAutoApprovableCommand(args.command)
      || (approvalMode === "reviewer" && (isReviewerAutoApprovableCommand(args.command) || isLowRiskCommand(args.command)))
    )) return "allow";
    return "ask";
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

const TOOL_MATRIX = [
  ...toolDefinitions().map((tool) => tool.function.name),
  "mcp__some-server__do_thing",
  "mcp__computer-use__click",
  "mcp__computer-use__get_app_state",
  "mcp__computer-use__list_apps",
  "browser__open",
  "browser__read",
  "browser__click",
  "browser__close",
];

const ARG_VARIANTS = {
  run_command: [{ command: "ls -la" }, { command: "npm install" }, { command: "rm -rf build" }, { command: "python3 -c 1" }],
  fetch_web_page: [{ url: "https://www.gov.cn/x" }],
  browser__open: [{ url: "https://example.com" }],
};

function argsFor(name, index) {
  const variants = ARG_VARIANTS[name];
  if (variants) return variants[index % variants.length];
  return {};
}

test("classify 风险分级矩阵", () => {
  assert.equal(classify("read_file").risk, RISK.READ);
  assert.equal(classify("update_plan").risk, RISK.READ);
  assert.equal(classify("write_file").risk, RISK.WRITE_LOCAL);
  assert.equal(classify("export_word_document").risk, RISK.WRITE_LOCAL);
  assert.equal(classify("save_skill").risk, RISK.WRITE_LOCAL);
  assert.equal(classify("run_command").risk, RISK.EXEC);
  assert.equal(classify("web_search").risk, RISK.EXTERNAL);
  assert.equal(classify("fetch_web_page").internet, true);
  assert.equal(classify("browser__open").risk, RISK.EXTERNAL);
  assert.equal(classify("browser__read").risk, RISK.READ);
  assert.equal(classify("browser__click").risk, RISK.EXTERNAL);
  assert.equal(classify("mcp__other__tool").risk, RISK.EXTERNAL);
  assert.equal(classify("mcp__computer-use__click").computerUseMutation, true);
  assert.equal(classify("mcp__computer-use__list_apps").risk, RISK.READ);
  assert.equal(classify("mcp__computer-use__check_permissions").risk, RISK.READ);
  assert.equal(classify("mcp__computer-use__get_app_state", {}, { platform: "darwin" }).consequential, false);
  assert.equal(classify("mcp__computer-use__get_app_state", {}, { platform: "linux" }).consequential, false);
  assert.equal(isConsequential("read_file"), false);
  assert.equal(isConsequential("write_file"), true);
});

test("evaluateApproval 与历史 approvalDecision 全矩阵等价（无常驻规则）", () => {
  const modes = ["interactive", "reviewer", "allow-writes", "full-access", "deny-changes"];
  const platforms = ["darwin", "linux"];
  for (const name of TOOL_MATRIX) {
    for (const approvalMode of modes) {
      for (const platform of platforms) {
        for (const hasExternalPaths of [false, true]) {
          for (const hookRequiresApproval of [false, true]) {
            for (const argIndex of [0, 1, 2]) {
              const args = argsFor(name, argIndex);
              const input = { approvalMode, name, args, hasExternalPaths, hookRequiresApproval, platform };
              assert.equal(
                evaluateApproval({ ...input, standingRules: [] }),
                oracleApprovalDecision(input),
                `${approvalMode}/${platform} ${name} external=${hasExternalPaths} hook=${hookRequiresApproval} args=${JSON.stringify(args)}`,
              );
              // approvalDecision 包装器同样等价
              assert.equal(approvalDecision(input), oracleApprovalDecision(input));
            }
          }
        }
      }
    }
  }
});

test("常驻规则命中时 evaluateApproval 把 ask 改判为 allow", () => {
  const rules = [{ kind: "path-glob", tool: "write_file", pattern: "*.docx" }];
  const base = { approvalMode: "interactive", name: "write_file", args: { path: "材料/总结.docx" } };
  assert.equal(evaluateApproval({ ...base, hasExternalPaths: true }), "ask");
  assert.equal(evaluateApproval({ ...base, hasExternalPaths: true, standingRules: rules }), "allow");
  // 钩子强制审批压过常驻规则
  assert.equal(evaluateApproval({ ...base, hasExternalPaths: true, hookRequiresApproval: true, standingRules: rules }), "ask");
  // deny-changes 压过常驻规则
  assert.equal(evaluateApproval({ ...base, approvalMode: "deny-changes", standingRules: rules }), "deny");
});
