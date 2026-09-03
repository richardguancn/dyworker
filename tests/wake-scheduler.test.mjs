import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateApproval, isLowRiskCommand } from "../electron/agent.mjs";
import { normalizeApprovalMode } from "../electron/settings.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

test("isLowRiskCommand: 多行安全命令逐行放行，包含危险命令或反引号时拦截", () => {
  // 单行安全命令
  assert.equal(isLowRiskCommand("node script.js"), true);
  assert.equal(isLowRiskCommand("python3 test.py"), true);

  // 多行安全命令（\n 与 \r\n 分隔）
  const multiLineSafe = "node build.js\npython3 test.py\ngit status";
  assert.equal(isLowRiskCommand(multiLineSafe), true);

  const multiLineSafeCrlf = "echo 'hello'\r\npytest tests/\r\nls -la";
  assert.equal(isLowRiskCommand(multiLineSafeCrlf), true);

  // 包含危险命令的多行命令被严格拦截
  const multiLineDangerous = "echo 'starting'\nrm -rf /tmp/data\nnode index.js";
  assert.equal(isLowRiskCommand(multiLineDangerous), false);

  // 包含反引号保守拦截
  assert.equal(isLowRiskCommand("echo `date`"), false);
  assert.equal(isLowRiskCommand("node test.js\necho `whoami`"), false);
});

test("evaluateApproval: reviewer 与 auto 模式放行多行安全命令，auto 放行技能维护工具", () => {
  // save_skill / update_skill 在 auto 自动推进模式下放行
  assert.equal(evaluateApproval({ approvalMode: "auto", name: "save_skill", args: { name: "test" } }), "allow");
  assert.equal(evaluateApproval({ approvalMode: "auto", name: "update_skill", args: { name: "test" } }), "allow");

  // 多行低风险命令在 reviewer 模式下放行
  assert.equal(evaluateApproval({
    approvalMode: "reviewer",
    name: "run_command",
    args: { command: "npm test\nnode check.js" },
  }), "allow");

  // 高危命令在 reviewer 模式下拦截 (ask)
  assert.equal(evaluateApproval({
    approvalMode: "reviewer",
    name: "run_command",
    args: { command: "rm -rf /" },
  }), "ask");

  // auto 模式支持
  assert.equal(evaluateApproval({ approvalMode: "auto", name: "save_skill", args: { name: "test" } }), "allow");
  assert.equal(evaluateApproval({
    approvalMode: "auto",
    name: "run_command",
    args: { command: "git status\nnode app.js" },
  }), "allow");
});

test("normalizeApprovalMode: 支持 auto 模式", () => {
  assert.equal(normalizeApprovalMode("auto"), "auto");
  assert.equal(normalizeApprovalMode("reviewer"), "reviewer");
  assert.equal(normalizeApprovalMode("interactive"), "interactive");
  assert.equal(normalizeApprovalMode("full-access"), "full-access");
});

test("main.mjs 唤醒与调度端到端契约：动态近邻定时器、休眠唤醒补偿、解耦守卫与强感知", async () => {
  const mainCode = await fs.readFile(path.join(root, "electron/main.mjs"), "utf8");

  // 1. 动态近邻定时器
  assert.match(mainCode, /function scheduleNextWakeCheck/);
  assert.match(mainCode, /void scheduleNextWakeCheck\(\)/);

  // 2. powerMonitor 休眠/唤醒监听
  assert.match(mainCode, /powerMonitor\.on\("resume"/);
  assert.match(mainCode, /powerMonitor\.on\("unlock-screen"/);

  // 3. 细粒度互斥守卫与解除锁死
  assert.match(mainCode, /runningWakeSessionIds/);
  assert.match(mainCode, /activeAgents\.has\(sid\)/);

  // 4. resumeWake 自主审批提升 (提升至 auto 模式自主推进)
  assert.match(mainCode, /sourceApprovalMode === "full-access" \? "full-access" : "auto"/);

  // 5. 审批等待期间释放 runningScheduledTask 锁
  assert.match(mainCode, /runningScheduledTask = false;[\s\S]*?awaitInboxWithTimeout[\s\S]*?runningScheduledTask = true;/);

  // 6. 异常留痕杜绝静默吞没
  assert.match(mainCode, /到点自动唤醒失败/);

  // 7. 原生桌面系统通知触发
  assert.match(mainCode, /Notification\.isSupported\(\)/);
  assert.match(mainCode, /new Notification\(/);

  // 8. 唤醒状态向渲染端同步
  assert.match(mainCode, /wake:status/);
});

test("App.tsx 契约：会话内直显待审批卡片、列表项橙点徽标、唤醒运行提示", async () => {
  const appCode = await fs.readFile(path.join(root, "src/App.tsx"), "utf8");

  // 1. 会话专属待审批计算与卡片就地渲染
  assert.match(appCode, /activeSessionPendingInboxApproval/);
  assert.match(appCode, /activeSessionPendingInboxQuestion/);
  assert.match(appCode, /activeSessionPendingInboxApproval && !activePendingApproval/);

  // 2. 侧边栏列表项待审批橙点
  assert.match(appCode, /session-pending-dot/);

  // 3. 监听 onWakeStatus 与 onInboxFocusItem
  assert.match(appCode, /onWakeStatus/);
  assert.match(appCode, /onInboxFocusItem/);
});
