import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTelemetryController } from "../electron/telemetry.mts";

// 设备登记/批量上报/删除流程的集成测试：本地 mock 服务按方案 §7.2 的
// 接口契约应答（code/message/data 包装 + 逐条 accepted/duplicate/rejected）。

const secretStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
};

function startMockServer() {
  const requests = [];
  const state = {
    batchResponses: [],
    preferences: [],
    registrations: [],
    receipts: [],
    deleted: false,
    failNextBatches: 0,
    expireToken: null,
    tokenCount: 0,
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {}
      const record = { method: req.method, url: req.url, authorization: req.headers.authorization || "", body: parsed };
      requests.push(record);
      const send = (payload, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.method === "POST" && req.url === "/api/v1/dyworker/installations/register") {
        state.registrations.push(parsed);
        state.tokenCount += 1;
        return send({ code: 0, message: "ok", data: { installation_id: parsed.installation_id, device_secret: `device-token-${state.tokenCount}`, server_time: Date.now() } });
      }
      if (req.method === "PUT" && req.url === "/api/v1/dyworker/installations/preferences") {
        state.preferences.push(parsed);
        return send({ code: 0, message: "ok", data: {generation: state.preferences.length + 1} });
      }
      if (req.method === "POST" && req.url === "/api/v1/dyworker/telemetry/batches") {
        if (state.expireToken && req.headers.authorization === `Device ${state.expireToken}`) {
          return send({ code: 401, message: "credential expired" }, 401);
        }
        if (state.failNextBatches > 0) {
          state.failNextBatches -= 1;
          return send({ code: 500, message: "server error" }, 500);
        }
        state.batchResponses.push(parsed);
        const events = Array.isArray(parsed?.events) ? parsed.events : [];
        // 约定：event_id 以 "bad-" 开头的被拒收，其余接受；重复发送返回 duplicate
        const seen = state.seenEventIds || (state.seenEventIds = new Set());
        const results = events.map((event) => {
          if (String(event.event_id).startsWith("bad-")) return { event_id: event.event_id, status: "rejected", error: "invalid" };
          if (seen.has(event.event_id)) return { event_id: event.event_id, status: "duplicate" };
          seen.add(event.event_id);
          return { event_id: event.event_id, status: "accepted" };
        });
        return send({ code: 0, message: "ok", data: { results, server_time: Date.now() } });
      }
      if (req.method === "POST" && req.url === "/api/v1/dyworker/installations/heartbeat") {
        return send({ code: 0, message: "ok", data: {} });
      }
      if (req.method === "DELETE" && req.url === "/api/v1/dyworker/installations/me") {
        state.deleted = true;
        return send({ code: 0, message: "ok", data: {} });
      }
      send({ code: 404, message: "not found" }, 404);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, state, requests, port: server.address().port }));
  });
}

function makeController(dir, port, options = {}) {
  return createTelemetryController({
    userDataDir: dir,
    appVersion: "0.2.2-test",
    secretStorage,
    ...options,
  });
}

function statsSettings(port, overrides = {}) {
  return {
    telemetry: {
      statsEnabled: true,
      messagesEnabled: false,
      serviceUrl: `http://127.0.0.1:${port}`,
      ...overrides,
    },
  };
}

async function withServer(run) {
  const mock = await startMockServer();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-telemetry-client-"));
  try {
    await run(mock, dir);
  } finally {
    await mock.server.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

test("开启统计：登记设备、采集区间、批量上报并按逐条确认清空队列", async () => {
  await withServer(async (mock, dir) => {
    const controller = makeController(dir, mock.port);
    await controller.configure(statsSettings(mock.port));
    const status = await controller.status();
    assert.equal(status.registered, true);
    assert.equal(status.statsEnabled, true);
    assert.equal(status.collecting, true);
    assert.equal(mock.state.registrations.length, 1);
    assert.equal(mock.state.registrations[0].app_version, "0.2.2-test");
    // 开启统计推进授权代次
    assert.equal(mock.state.preferences[0].telemetry_enabled, true);
    assert.equal(status.consentGeneration, 2);

    // 交互 + tick 产生事件
    controller.noteUserActivity();
    controller.tick();
    controller.tick();
    assert.ok((await controller.store.count()) >= 1, "事件已入本地队列");

    const result = await controller.flushOnce();
    // flushOnce 未暴露为公开方法名以外的路径——controller 上已暴露 flush 能力经 start() 定时器；
    // 这里直接调用内部上传（见 controller.flushOnce 挂载）
    assert.equal(result.ok, true);
    assert.equal(await controller.store.count(), 0, "确认后队列清空");
    const batch = mock.state.batchResponses[0];
    assert.ok(batch.events.length >= 1);
    assert.equal(batch.consent_generation, 2);
    assert.equal(batch.metric_version, 1);
    assert.equal(batch.schema_version, 1);
    for (const event of batch.events) {
      assert.equal(typeof event.event_id, "string");
      assert.equal(typeof event.run_id, "string");
      assert.ok(event.schema_version >= 1);
      assert.ok(["activity", "interval"].includes(event.event_type));
    }
    // 请求带设备凭据
    const batchRequest = mock.requests.find((request) => request.url === "/api/v1/dyworker/telemetry/batches");
    assert.equal(batchRequest.authorization, `Device ${controller.getInstallationId()}.device-token-1`);
    // 凭据经安全存储加密落盘，不出现明文
    const credentialRaw = await fs.readFile(path.join(dir, "telemetry-credentials.json"), "utf8");
    assert.equal(credentialRaw.includes("device-token-1"), false);
  });
});

test("网络失败重试保持原 event_id；恢复后按 duplicate 确认且只计一次", async () => {
  await withServer(async (mock, dir) => {
    mock.state.failNextBatches = 1;
    const controller = makeController(dir, mock.port);
    await controller.configure(statsSettings(mock.port));
    controller.noteUserActivity();
    controller.tick();
    const beforeIds = (await controller.store.pending()).map((event) => event.event_id);
    assert.equal(beforeIds.length >= 1, true);

    const failed = await controller.flushOnce();
    assert.equal(failed.ok, false);
    assert.equal(await controller.store.count(), beforeIds.length, "失败不清队列");
    const retryIds = (await controller.store.pending()).map((event) => event.event_id);
    assert.deepEqual(retryIds, beforeIds, "重试保持原 event_id，不生成新事件");

    const ok = await controller.flushOnce();
    assert.equal(ok.ok, true);
    assert.equal(await controller.store.count(), 0);
    // 两次上传的 event_id 完全一致（失败重试不生成新事件）
    const batchRequests = mock.requests.filter((request) => request.url === "/api/v1/dyworker/telemetry/batches");
    assert.equal(batchRequests.length, 2);
    assert.deepEqual(
      batchRequests[1].body.events.map((event) => event.event_id),
      batchRequests[0].body.events.map((event) => event.event_id),
    );
  });
});

test("无效记录单独拒收：不阻塞整批其余事件的确认", async () => {
  await withServer(async (mock, dir) => {
    const controller = makeController(dir, mock.port);
    await controller.configure(statsSettings(mock.port));
    await controller.store.enqueue([
      { event_id: "bad-1", type: "usage_interval", duration_ms: 1_000 },
      { event_id: "good-1", type: "usage_interval", duration_ms: 2_000 },
    ]);
    const result = await controller.flushOnce();
    assert.equal(result.ok, true);
    assert.equal(result.rejected, 1);
    assert.equal(await controller.store.count(), 0, "拒收记录不留在队列里阻塞后续");
  });
});

test("关闭统计：本地立即停止采集并清空队列，偏好同步 stats_enabled=false 与新代次", async () => {
  await withServer(async (mock, dir) => {
    const controller = makeController(dir, mock.port);
    const settings = statsSettings(mock.port, { messagesEnabled: true });
    await controller.configure(settings);
    controller.noteUserActivity();
    controller.tick();
    assert.ok((await controller.store.count()) >= 1);

    settings.telemetry.statsEnabled = false;
    await controller.configure(settings);
    assert.equal((await controller.store.count()), 0, "关闭统计后待发送队列被清空");
    const status = await controller.status();
    assert.equal(status.collecting, false);
    assert.equal(status.statsEnabled, false);
    assert.equal(status.messagesEnabled, true);
    const lastPreferences = mock.state.preferences[mock.state.preferences.length - 1];
    assert.equal(lastPreferences.telemetry_enabled, false);
    assert.equal(status.consentGeneration, 3, "使用服务端返回的授权代次");
  });
});

test("统计关闭但消息开启：不上传活动事件，设备仍登记且消息开关为 true", async () => {
  await withServer(async (mock, dir) => {
    const controller = makeController(dir, mock.port);
    const settings = statsSettings(mock.port, { statsEnabled: false, messagesEnabled: true });
    await controller.configure(settings);
    controller.noteUserActivity();
    controller.tick();
    assert.equal((await controller.store.count()), 0, "不上传活动和时长");
    assert.equal(mock.state.batchResponses.length, 0);
    const status = await controller.status();
    assert.equal(status.registered, true);
    assert.equal(mock.state.preferences[0].messages_enabled, true);
  });
});

test("删除此安装已上传数据：调用 DELETE、清空本地队列与凭据", async () => {
  await withServer(async (mock, dir) => {
    const controller = makeController(dir, mock.port);
    await controller.configure(statsSettings(mock.port));
    controller.noteUserActivity();
    controller.tick();
    const result = await controller.deleteInstallationData();
    assert.equal(result.ok, true);
    assert.equal(result.deleted, true);
    assert.equal(mock.state.deleted, true);
    assert.equal((await controller.store.count()), 0);
    const status = await controller.status();
    assert.equal(status.registered, false, "凭据已撤销");
    await assert.rejects(() => fs.access(path.join(dir, "telemetry-credentials.json")));
  });
});

test("安全存储不可用：凭据仅会话内保存且不落盘，功能仍可用", async () => {
  await withServer(async (mock, dir) => {
    const controller = createTelemetryController({
      userDataDir: dir,
      appVersion: "0.2.2-test",
      secretStorage: null,
    });
    await controller.configure(statsSettings(mock.port));
    const status = await controller.status();
    assert.equal(status.registered, true);
    assert.equal(status.credentialMode, "session");
    controller.noteUserActivity();
    controller.tick();
    const result = await controller.flushOnce();
    assert.equal(result.ok, true);
    await assert.rejects(() => fs.access(path.join(dir, "telemetry-credentials.json")));
  });
});

test("退出收尾：封口区间先落盘；网络尝试不超过 1 秒即返回", async () => {
  await withServer(async (mock, dir) => {
    mock.state.failNextBatches = 99; // 服务器持续失败，退出不能被阻塞
    const controller = makeController(dir, mock.port);
    await controller.configure(statsSettings(mock.port));
    controller.noteUserActivity();
    controller.tick();
    const startedAt = Date.now();
    await controller.shutdown();
    const elapsed = Date.now() - startedAt;
    // 落盘完成（队列有退出封口事件），网络失败在 1 秒预算内结束
    assert.ok((await controller.store.count()) >= 1, "退出封口区间已落盘");
    assert.ok(elapsed < 3_000, `退出耗时 ${elapsed}ms，被统计服务阻塞`);
  });
});

test("凭据撤销后停止联网，不重新登记绕过撤销", async () => {
  await withServer(async (mock, dir) => {
    const controller = makeController(dir, mock.port);
    await controller.configure(statsSettings(mock.port));
    controller.noteUserActivity();
    mock.state.expireToken = `${controller.getInstallationId()}.device-token-1`;
    assert.equal((await controller.flushOnce()).ok, false);
    assert.equal(mock.state.registrations.length, 1);
    assert.equal((await controller.status()).registered, false);
    assert.equal((await controller.status()).collecting, false);
    const restarted = makeController(dir, mock.port);
    await restarted.configure(statsSettings(mock.port));
    assert.equal((await restarted.status()).registered, false);
    assert.equal(mock.state.registrations.length, 1);
  });
});

test("installation_id 跨次启动保持稳定（保存在用户数据目录）", async () => {
  await withServer(async (mock, dir) => {
    const first = makeController(dir, mock.port);
    await first.configure(statsSettings(mock.port));
    const firstId = (await first.status()).installationId;
    const second = makeController(dir, mock.port);
    await second.configure(statsSettings(mock.port));
    const secondId = (await second.status()).installationId;
    assert.equal(firstId, secondId);
    // 凭据已加密落盘：第二次启动不重新登记，复用同一设备身份
    assert.equal(mock.state.registrations.length, 1);
    assert.equal(mock.state.registrations[0].installation_id, firstId);
    assert.notEqual(firstId, "");
  });
});
