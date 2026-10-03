import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateApproval, isLowRiskCommand } from "../electron/agent.mts";
import { normalizeApprovalMode } from "../electron/settings.mts";

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
  const mainCode = await fs.readFile(path.join(root, "electron/main.mts"), "utf8");

  // 1. 动态近邻定时器
  // 近邻唤醒定时器已上收 ctx.scheduler
  const schedulerSource = readFileSync(new URL("../electron/host/services/scheduler.mts", import.meta.url), "utf8");
  // 支持最小延迟（退避）参数：到期但被忙碌守卫推迟时必须退避，不能 0 延迟自旋
  assert.match(schedulerSource, /async scheduleNextWakeCheck\(\{ minDelayMs = 0 \}/);
  assert.match(schedulerSource, /Math\.max\(Math\.min\(minWaitMs, 2 \* 3600 \* 1000\), minDelayMs\)/);
  assert.match(schedulerSource, /minDelayMs: deferred \? WAKE_DEFERRED_RETRY_MS : 0/);
  assert.match(mainCode, /void ctx\.scheduler\.scheduleNextWakeCheck\(\)/);

  // 2. powerMonitor 休眠/唤醒监听
  assert.match(mainCode, /powerMonitor\.on\("resume"/);
  assert.match(mainCode, /powerMonitor\.on\("unlock-screen"/);

  // 3. 细粒度互斥守卫与解除锁死
  // 细粒度互斥：会话是否活跃由壳层判定（hooks），"同一会话不重入"由服务持有
  assert.match(schedulerSource, /this\.runningWakeSessions\.has\(sid\)/);
  // 壳层的会话忙判定必须同时算上"唤醒续跑中"：只认 activeAgents 的话，
  // 续跑期间渲染端发的消息会被当成空闲会话并发起第二个 run（同一会话两个线程）
  assert.match(mainCode, /isSessionBusy: \(sessionId\) => isSessionBusy\(sessionId\)/);
  assert.match(mainCode, /const isSessionBusy = \(sessionId\) => activeAgents\.has\(String\(sessionId\)\) \|\| wakeRuns\.has\(String\(sessionId\)\)/);
  // 续跑登记占用 / 收尾释放并推进队列（唤醒续跑不走 executeAgentRun 的 finally）
  assert.match(mainCode, /wakeRuns\.set\(wakeSessionId, \{ runId: wakeRunId, abort: wakeAbort \}\)/);
  assert.match(mainCode, /wakeRuns\.delete\(wakeSessionId\);[\s\S]*?drainSessionQueue\(wakeSessionId\)/);
  // agent:send 必须复用同一份忙判定（否则队列语义与主进程不一致）
  const agentIpcSource = readFileSync(new URL("../electron/host/plugins/agent-ipc.mts", import.meta.url), "utf8");
  assert.match(agentIpcSource, /if \(isSessionBusy\(sessionId\)\) \{/);

  // 4. resumeWake 生效审批模式：折算规则上收 settings.mts（wakeApprovalMode，tests/settings.test.mjs
  //    有行为单测钉住），续跑入口必须走它。**reviewer（替我审批）不得降级成 auto**：降级后工作区内的
  //    ask 不经审核助手、直接弹人工审批卡（2026-10-02 带 rm/ffmpeg 的复合命令到点续跑弹卡即此原因），
  //    而同形态命令在 reviewer 下当天被审核助手放行过。
  assert.match(mainCode, /const approvalMode = wakeApprovalMode\(settings\.approvalMode, wake\.approvalMode\)/);
  assert.doesNotMatch(mainCode, /sourceApprovalMode === "full-access" \|\| sourceApprovalMode === "deny-changes" \? sourceApprovalMode : "auto"/);
  assert.doesNotMatch(mainCode, /sourceApprovalMode/);
  // 计划任务同样跟随全局完全访问，不再固定为 reviewer / deny-changes
  assert.match(mainCode, /approvalMode: unattendedApprovalMode\(settings\.approvalMode, record\.allowWorkspaceWrites \? "reviewer" : "deny-changes"\)/);
  assert.match(mainCode, /(unattendedApprovalMode|wakeApprovalMode)[^}]*\} from "\.\/settings\.mts"/);

  // 5. 审批等待期间释放 runningScheduledTask 锁（等待入口现为 ctx.inbox.awaitWithTimeout）
  assert.match(mainCode, /ctx\.scheduler\.running = false;[\s\S]*?ctx\.inbox\.awaitWithTimeout[\s\S]*?ctx\.scheduler\.running = true;/);

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

  // 4. 挂起等待唤醒期间禁止发送：发送键变灰 + 输入框上方的挂起卡片给出唯一两个出口
  assert.match(appCode, /const activeSleeping = activeSession\?\.id \? sleepingSessions\[activeSession\.id\] : undefined/);
  assert.match(appCode, /&& !activeSleeping\s*\n\s*&& voiceState !== "transcribing"/);
  assert.match(appCode, /className="sleep-card"/);
  assert.match(appCode, /立即继续/);
  assert.match(appCode, /取消唤醒/);
  assert.match(appCode, /window\.dyworker\?\.resumeWakeNow\?\.\(sessionId\)/);
  assert.match(appCode, /cancelWakesForSession\?\.\(sessionId\)/);
  // 发消息入口也要拦（Enter 直接走 sendMessage，不看 canSend）
  assert.match(appCode, /const targetSleeping = sleepingSessions\[targetSession\.id\]/);
  // 权威状态来自主进程（气泡上的 taskStatus=sleeping 取消后不会变）
  assert.match(appCode, /listPendingWakes/);

  // 5. 续跑进行中：状态行与气泡说明都要改口，不能一边说"将于 X 自动唤醒"一边在跑
  // 文案改写本身抽在 src/wakeNote.ts，由 tests/wake-note.test.mjs 做行为测试；
  // 这里只锁接线：状态、状态行、气泡改写三处都不能少
  assert.match(appCode, /const \[wakingSessions, setWakingSessions\]/);
  assert.match(appCode, /const activeWaking = activeSession\?\.id \? wakingSessions\[activeSession\.id\] : undefined/);
  // RunningStatusLabel 支持 waking：自动唤醒说"已到点自动唤醒（时间）"，手动续跑另说
  assert.match(appCode, /wakingPrefix = waking/);
  assert.match(appCode, /已到点自动唤醒（\$\{formatWakeTime\(waking\.wakeAt\)\}）/);
  assert.match(appCode, /已按你的要求立即继续/);
  // 气泡那句将来时在开跑时改写、收尾时收口
  assert.match(appCode, /patchWakingSleepNote\(payload\.sessionId, wakeAt, marker, "waking"\)/);
  assert.match(appCode, /patchWakingSleepNote\(payload\.sessionId, finished\.wakeAt, finished\.marker, "woke", finished\.done\)/);
  // 重启/窗口关闭期间已跑完的那一觉也要收口（"将于"→"原定"）
  assert.match(appCode, /settleResolvedSleepNote\(content\)/);
  assert.match(appCode, /wakingNoteTexts\(formatWakeTime\(wakeAt\), Boolean\(payload\.manual\)\)/);
});
