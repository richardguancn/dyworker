import assert from "node:assert";
import { backgroundTasksManager } from "../electron/background-tasks.mjs";

async function runTests() {
  console.log("▶ 开始测试 background-tasks 模块...");

  const testSessionA = "session-a-123";
  const testSessionB = "session-b-456";

  // 1. 启动会话 A 的后台 HTTP 服务
  const taskA = await backgroundTasksManager.startTask({
    command: "python3 -m http.server 18765",
    sessionId: testSessionA,
    name: "测试 HTTP 服务 A",
  });

  console.log("✓ Task A 启动成功:", taskA.id, taskA.name, "PID:", taskA.pid);
  assert.strictEqual(taskA.status, "running");
  assert.strictEqual(taskA.sessionId, testSessionA);
  assert.ok(taskA.pid > 0);

  // 2. 启动会话 B 的后台任务
  const taskB = await backgroundTasksManager.startTask({
    command: "python3 -m http.server 18766",
    sessionId: testSessionB,
    name: "测试 HTTP 服务 B",
  });

  console.log("✓ Task B 启动成功:", taskB.id, taskB.name, "PID:", taskB.pid);
  assert.strictEqual(taskB.sessionId, testSessionB);

  // 等待 800ms 接收进程输出和端口探测
  await new Promise((r) => setTimeout(r, 800));

  // 3. 测试会话隔离过滤
  const sessionAList = backgroundTasksManager.listTasks(testSessionA);
  const sessionBList = backgroundTasksManager.listTasks(testSessionB);
  const allList = backgroundTasksManager.listTasks();

  console.log("✓ 会话 A 任务数:", sessionAList.length);
  console.log("✓ 会话 B 任务数:", sessionBList.length);
  console.log("✓ 全部任务数:", allList.length);

  assert.strictEqual(sessionAList.length, 1);
  assert.strictEqual(sessionAList[0].id, taskA.id);
  assert.strictEqual(sessionBList.length, 1);
  assert.strictEqual(sessionBList[0].id, taskB.id);
  assert.ok(allList.length >= 2);

  // 4. 验证端口探测与 URL 生成
  console.log("✓ Task A 端口:", sessionAList[0].ports, "URLs:", sessionAList[0].urls);
  assert.ok(sessionAList[0].ports.includes(18765));
  assert.ok(sessionAList[0].urls.includes("http://localhost:18765"));

  // 5. 测试停止 Task A
  console.log("▶ 停止 Task A...");
  const stopRes = await backgroundTasksManager.stopTask(taskA.id);
  assert.strictEqual(stopRes, true);

  await new Promise((r) => setTimeout(r, 500));
  const sessionAAfterStop = backgroundTasksManager.listTasks(testSessionA);
  console.log("✓ Task A 停止后状态:", sessionAAfterStop[0].status);
  assert.strictEqual(sessionAAfterStop[0].status, "stopped");

  // 6. 测试重启 Task A
  console.log("▶ 重启 Task A...");
  const restartedA = await backgroundTasksManager.restartTask(taskA.id);
  console.log("✓ Task A 重启后 ID:", restartedA.id, "PID:", restartedA.pid, "Status:", restartedA.status);
  assert.strictEqual(restartedA.status, "running");

  // 7. 清理全部
  console.log("▶ 清理全部测试后台任务...");
  backgroundTasksManager.cleanupAll();
  await backgroundTasksManager.stopTask(restartedA.id);
  await backgroundTasksManager.stopTask(taskB.id);

  console.log("✅ 全部后台任务管理器测试通过！");
}

runTests().catch((err) => {
  console.error("❌ 测试失败:", err);
  process.exit(1);
});
