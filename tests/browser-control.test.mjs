import test from "node:test";
import assert from "node:assert/strict";
import { BrowserControlManager, CONTROL_STATUS } from "../electron/browser-control.mjs";
import { BrowserAgent } from "../electron/browser.mjs";

function createMockWebContents() {
  return {
    id: 101,
    isDestroyed: () => false,
    once: () => {},
    getURL: () => "https://example.com/form",
    executeJavaScript: async (script) => {
      if (typeof script === "string" && (script.includes("NOT_FOUND_OR_REPLACED") || script.includes("coords"))) {
        return { ok: true, coords: { x: 80, y: 62 }, isContentEditable: false };
      }
      return {
        title: "表单页面",
        url: "https://example.com/form",
        totalCount: 1,
        elements: [{ ref: 0, tag: "button", role: "button", name: "提交", rect: { x: 50, y: 50, width: 60, height: 25 }, enabled: true }],
        viewport: { cssWidth: 800, cssHeight: 600, devicePixelRatio: 1 }
      };
    },
    capturePage: async () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 800, height: 600 }),
      toPNG: () => Buffer.from("dummy")
    }),
    debugger: {
      isAttached: () => false,
      attach: () => {},
      detach: () => {},
      on: () => {},
      sendCommand: async () => ({ ok: true })
    }
  };
}

test("BrowserControlManager: 状态机基础流转 (idle -> running -> stopped)", async () => {
  const stateUpdates = [];
  const manager = new BrowserControlManager({
    onStateChange: (state) => stateUpdates.push(state.status)
  });

  assert.equal(manager.getStatus().status, CONTROL_STATUS.IDLE);

  const mockContents = createMockWebContents();
  await manager.acquireControl({
    ownerSessionId: "session-1",
    runId: "run-1",
    tabId: "tab-1",
    webContents: mockContents
  });

  assert.equal(manager.getStatus().status, CONTROL_STATUS.RUNNING);
  assert.equal(manager.getStatus().ownerSessionId, "session-1");
  assert.equal(manager.getStatus().leaseEpoch, 1);

  manager.stop();
  assert.equal(manager.getStatus().status, CONTROL_STATUS.STOPPED);
  assert.equal(manager.getStatus().leaseEpoch, 2);

  manager.dispose();
});

test("BrowserControlManager: 接管 (takeover) 立即同步递增 leaseEpoch 并使在途任务作废", async () => {
  const manager = new BrowserControlManager();
  const mockContents = createMockWebContents();

  await manager.acquireControl({
    ownerSessionId: "session-1",
    runId: "run-1",
    tabId: "tab-1",
    webContents: mockContents
  });

  const epochBefore = manager.getStatus().leaseEpoch;

  // 模拟一个稍微耗时的任务加入串行队列
  let taskRan = false;
  const longTaskPromise = manager.runExclusive(async (_adapter, { signal }) => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (signal.aborted) throw new Error("ABORTED");
    taskRan = true;
    return { ok: true };
  });

  // 随后立刻发生用户接管
  const takeoverRes = manager.takeover({ reason: "用户点击我来接管" });
  assert.equal(takeoverRes.ok, true);
  assert.equal(takeoverRes.status, CONTROL_STATUS.HUMAN_CONTROL);

  // 验证 leaseEpoch 已经同步递增
  assert.equal(manager.getStatus().leaseEpoch, epochBefore + 1);

  // 等待在途任务完成，验证其已被中断或作废
  const res = await longTaskPromise;
  assert.equal(res.ok, false);
  assert.equal(taskRan, false);

  // 接管状态下新发起的动作必须直接被拒绝
  const nextActionRes = await manager.act({
    observationId: "any",
    action: { type: "click", ref: 0 }
  });
  assert.equal(nextActionRes.ok, false);
  assert.equal(nextActionRes.errorCode, "HUMAN_TAKEOVER");

  manager.dispose();
});

test("BrowserControlManager: 恢复控制 (resume) 必须匹配 session 并重置观察", async () => {
  const manager = new BrowserControlManager();
  const mockContents = createMockWebContents();

  await manager.acquireControl({
    ownerSessionId: "session-1",
    runId: "run-1",
    tabId: "tab-1",
    webContents: mockContents
  });

  // 先观察一次
  const obs1 = await manager.observe();
  assert.equal(obs1.ok, true);
  assert.ok(obs1.data.observationId);

  // 接管
  manager.takeover();
  assert.equal(manager.getStatus().status, CONTROL_STATUS.HUMAN_CONTROL);

  // 错误会话尝试 resume 失败
  const wrongResume = manager.resume({ ownerSessionId: "session-attacker" });
  assert.equal(wrongResume.ok, false);

  // 正确会话 resume
  const resumeRes = manager.resume({ ownerSessionId: "session-1", runId: "run-2" });
  assert.equal(resumeRes.ok, true);
  assert.equal(manager.getStatus().status, CONTROL_STATUS.RUNNING);

  // 此时使用接管前的旧 observationId 操作必须被拒绝 (STALE_OBSERVATION)
  const staleAct = await manager.act({
    observationId: obs1.data.observationId,
    action: { type: "click", ref: 0 }
  });
  assert.equal(staleAct.ok, false);
  assert.equal(staleAct.errorCode, "STALE_OBSERVATION");

  // 必须重新 observe
  const obs2 = await manager.observe();
  assert.equal(obs2.ok, true);
  assert.notEqual(obs2.data.observationId, obs1.data.observationId);

  // 用新 observationId 即可成功操作
  const validAct = await manager.act({
    observationId: obs2.data.observationId,
    action: { type: "click", ref: 0 }
  });
  assert.equal(validAct.ok, true);

  manager.dispose();
});

test("BrowserControlManager: 目标页面已销毁时拒绝控制获取", async () => {
  const manager = new BrowserControlManager();
  const deadContents = {
    id: 999,
    isDestroyed: () => true
  };

  await assert.rejects(
    async () => {
      await manager.acquireControl({
        ownerSessionId: "session-1",
        runId: "run-1",
        tabId: "tab-1",
        webContents: deadContents
      });
    },
    /TARGET_UNAVAILABLE/
  );

  manager.dispose();
});

test("BrowserAgent 端到端闭环：打开页面、观察、填写、选择与提交", async () => {
  const mockContents = createMockWebContents();
  const agent = new BrowserAgent({
    openPanel: async (url) => ({ ok: true, contents: mockContents }),
    closePanel: async () => {},
    getContents: () => mockContents
  });
  agent.setContext({ ownerSessionId: "session-test", runId: "run-test" });

  // 1. 打开页面（自动返回页面快照与截图）
  const openRes = await agent.handle("browser__open", { url: "https://example.com/form" });
  assert.equal(openRes.ok, true);
  assert.ok(openRes.result.includes("当前页面快照"));
  assert.ok(openRes.data.observationId);

  const initialObsId = openRes.data.observationId;

  // 2. 观察页面
  const obsRes = await agent.handle("browser__observe");
  assert.equal(obsRes.ok, true);
  assert.ok(obsRes.data.observationId);

  // 3. 执行动作
  const actRes = await agent.handle("browser__act", {
    observationId: obsRes.data.observationId,
    actionId: "act-test-1",
    action: { type: "click", ref: 0 }
  });
  assert.equal(actRes.ok, true);
  assert.ok(actRes.result.includes("操作后最新页面"));

  // 4. 请求人工接管
  const handoffRes = await agent.handle("browser__handoff", { reason: "检测到滑块验证码" });
  assert.equal(handoffRes.ok, true);
  assert.ok(handoffRes.result.includes("已暂停自动操作并转交给用户接管"));

  // 5. 接管后动作应被拦截
  const blockedAct = await agent.handle("browser__act", {
    observationId: obsRes.data.observationId,
    actionId: "act-test-2",
    action: { type: "click", ref: 0 }
  });
  assert.equal(blockedAct.ok, false);
  assert.equal(blockedAct.errorCode, "HUMAN_TAKEOVER");

  agent.dispose();
});


test("BrowserControlManager: 打开预占绑定唯一凭据，过期接替后旧凭据失效 (D2)", () => {
  const manager = new BrowserControlManager();
  const resA = manager.reserveOpen({ ownerSessionId: "task-a", runId: "run-a" });
  assert.ok(resA.token);
  assert.equal(manager.isOpenReservationValid(resA.token), true);

  // 未过期时其他任务禁止抢占
  assert.throws(
    () => manager.reserveOpen({ ownerSessionId: "task-b", runId: "run-b" }),
    /TARGET_BUSY/
  );

  // 模拟预占超过有效期限（真实 31 秒等待由验收脚本覆盖，这里拨动时间戳）
  manager.openReservation.reservedAt -= 31000;
  assert.equal(manager.isOpenReservationValid(resA.token), false);

  // 过期后 B 接替成功，A 的旧凭据同步失效
  const resB = manager.reserveOpen({ ownerSessionId: "task-b", runId: "run-b" });
  assert.equal(manager.isOpenReservationValid(resB.token), true);
  assert.equal(manager.isOpenReservationValid(resA.token), false);
});

test("BrowserControlManager: 清理预占必须凭据或归属匹配，禁止清理他人预占 (D2)", () => {
  const manager = new BrowserControlManager();
  const resA = manager.reserveOpen({ ownerSessionId: "task-a", runId: "run-a" });

  // 凭据不匹配：不得清理
  manager.clearOpenReservation({ ownerSessionId: "task-a", token: "open_fake_token" });
  assert.equal(manager.isOpenReservationValid(resA.token), true);

  // 归属不匹配：不得清理
  manager.clearOpenReservation({ ownerSessionId: "task-b" });
  assert.equal(manager.isOpenReservationValid(resA.token), true);

  // 自己的凭据：允许清理
  manager.clearOpenReservation({ ownerSessionId: "task-a", token: resA.token });
  assert.equal(manager.isOpenReservationValid(resA.token), false);
  assert.equal(manager.openReservation, null);
});

test("BrowserControlManager: 接管与停止都会撤销在途打开预占 (D2)", async () => {
  const manager = new BrowserControlManager();

  const res1 = manager.reserveOpen({ ownerSessionId: "s", runId: "r" });
  manager.takeover();
  assert.equal(manager.isOpenReservationValid(res1.token), false);

  const mockContents = createMockWebContents();
  await manager.acquireControl({ ownerSessionId: "s", runId: "r", tabId: "", webContents: mockContents });
  const res2 = manager.reserveOpen({ ownerSessionId: "s", runId: "r" });
  assert.equal(manager.isOpenReservationValid(res2.token), true);
  manager.stop();
  assert.equal(manager.isOpenReservationValid(res2.token), false);

  manager.dispose();
});

test("BrowserAgent: 打开等待期间用户接管，旧请求不得导航或回退页面 (D1 无会话)", async () => {
  const manager = new BrowserControlManager();
  const loadURLCalls = [];
  const mockContents = {
    ...createMockWebContents(),
    getURL: () => "https://example.com/second",
    loadURL: async (u) => { loadURLCalls.push(u); }
  };
  let releasePanel;
  const agent = new BrowserAgent({
    openPanel: () => new Promise((resolve) => {
      releasePanel = () => resolve({ ok: true, contents: mockContents });
    }),
    closePanel: async () => {},
    getContents: () => mockContents,
    controlManager: manager
  });
  agent.setContext({ ownerSessionId: "session-d1", runId: "run-d1" });

  const openPromise = agent.open("https://example.com/first");
  while (!manager.openReservation) await new Promise((r) => setImmediate(r));

  // 用户在等待期间接管（清空输入、进入其他页面均由用户侧完成，这里只撤销预占）
  manager.takeover({ reason: "用户点击我来接管" });
  releasePanel();

  const res = await openPromise;
  assert.equal(res.ok, false);
  // 严禁任何形式的导航或刷新，包括“回退到上一页”
  assert.equal(loadURLCalls.length, 0);
  assert.equal(manager.session, null);

  agent.dispose();
});

test("BrowserAgent: 接管状态下返回的旧打开请求保持用户页面状态 (D1 有会话)", async () => {
  const manager = new BrowserControlManager();
  const loadURLCalls = [];
  const mockContents = {
    ...createMockWebContents(),
    getURL: () => "https://example.com/second",
    loadURL: async (u) => { loadURLCalls.push(u); }
  };
  let releasePanel;
  const agent = new BrowserAgent({
    openPanel: () => new Promise((resolve) => {
      releasePanel = () => resolve({ ok: true, contents: mockContents });
    }),
    closePanel: async () => {},
    getContents: () => mockContents,
    controlManager: manager
  });
  agent.setContext({ ownerSessionId: "session-d1", runId: "run-d1" });

  // 已有同身份控制会话，打开新页面过程中用户接管
  await manager.acquireControl({
    ownerSessionId: "session-d1",
    runId: "run-d1",
    tabId: "",
    webContents: mockContents
  });

  const openPromise = agent.open("https://example.com/first");
  while (!manager.openReservation) await new Promise((r) => setImmediate(r));
  manager.takeover({ reason: "用户点击我来接管" });
  releasePanel();

  const res = await openPromise;
  assert.equal(res.ok, false);
  assert.equal(res.errorCode, "HUMAN_TAKEOVER");
  assert.equal(loadURLCalls.length, 0);
  assert.equal(manager.session.status, CONTROL_STATUS.HUMAN_CONTROL);

  agent.dispose();
});

test("BrowserAgent: 过期打开请求被接替后不得再导航或覆盖新任务页面 (D2)", async () => {
  const manager = new BrowserControlManager();
  const loadURLCalls = [];
  const mockContents = {
    ...createMockWebContents(),
    getURL: () => "https://example.com/second",
    loadURL: async (u) => { loadURLCalls.push(u); }
  };

  let releaseA;
  const agentA = new BrowserAgent({
    openPanel: () => new Promise((resolve) => {
      releaseA = () => resolve({ ok: true, contents: mockContents });
    }),
    closePanel: async () => {},
    getContents: () => mockContents,
    controlManager: manager
  });
  agentA.setContext({ ownerSessionId: "task-a", runId: "run-a" });

  const agentB = new BrowserAgent({
    openPanel: async () => ({ ok: true, contents: mockContents }),
    closePanel: async () => {},
    getContents: () => mockContents,
    controlManager: manager
  });
  agentB.setContext({ ownerSessionId: "task-b", runId: "run-b" });

  // 任务 A 预占打开权限，面板回调保持等待
  const openA = agentA.open("https://example.com/first");
  while (!manager.openReservation) await new Promise((r) => setImmediate(r));

  // 预占过期（拨动时间戳模拟 31 秒真实流逝），B 接替打开 /second
  manager.openReservation.reservedAt -= 31000;
  const resB = await agentB.open("https://example.com/second");
  assert.equal(resB.ok, true);
  assert.equal(manager.session.ownerSessionId, "task-b");

  // 随后释放 A 的旧回调：A 必须失败，且不得发起任何导航或事后回退
  releaseA();
  const resA = await openA;
  assert.equal(resA.ok, false);
  assert.equal(loadURLCalls.length, 0);
  assert.equal(manager.session.ownerSessionId, "task-b");
  assert.equal(mockContents.getURL(), "https://example.com/second");

  agentA.dispose();
  agentB.dispose();
});

test("BrowserControlManager 与 BrowserAgent: 会话绑定的 webContents 销毁后 stop 和 dispose 绝不抛错", async () => {
  const manager = new BrowserControlManager();
  let destroyed = false;
  const mockContents = {
    id: 888,
    isDestroyed: () => destroyed,
    get debugger() {
      if (destroyed) throw new TypeError("Object has been destroyed");
      return {
        isAttached: () => false,
        attach: () => {},
        detach: () => {},
        on: () => {},
        sendCommand: async () => {}
      };
    },
    getURL: () => (destroyed ? "" : "https://example.com"),
    executeJavaScript: async () => {
      if (destroyed) throw new TypeError("Object has been destroyed");
      return "ok";
    },
    on: () => {},
    once: () => {},
    removeListener: () => {}
  };

  await manager.acquireControl({
    ownerSessionId: "session-1",
    runId: "run-1",
    tabId: "tab-1",
    webContents: mockContents
  });

  const agent = new BrowserAgent({
    openPanel: async () => ({ ok: true, contents: mockContents }),
    closePanel: async () => {},
    getContents: () => mockContents,
    controlManager: manager
  });
  agent.setContext({ ownerSessionId: "session-1", runId: "run-1" });

  // 模拟 webContents 被销毁
  destroyed = true;

  // 1. controlManager.stop() 绝不抛错
  assert.doesNotThrow(() => {
    manager.stop({ reason: "网页被关闭" });
  });

  // 2. browserAgent.dispose() 绝不抛错
  assert.doesNotThrow(() => {
    agent.dispose();
  });
});
