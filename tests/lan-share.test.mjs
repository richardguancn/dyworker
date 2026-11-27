// 局域网发现与点对点分享端到端测试：
// - 身份展示优先级（自定义昵称 / 已登录账号 / 系统用户名 / 设备名）
// - 私网 IP 校验边界（拦截公网 IP）
// - 双节点 UDP 自动发现 + HTTP 请求确认 + 拉取 + SHA-256 校验 + 会话/项目/插件导入闭环
// - 对方拒绝、发送方取消、隐身拦截、防篡改与令牌校验
// - 设置持久化与前后端全场景接线契约
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

import {
  LanShareService,
  isAllowedLanPeerAddress,
  isPrivateLanAddress,
  parseManualPeerAddress,
  resolveLocalIdentity,
} from "../electron/lan-share.mts";
import { resolveLanLoginAccount } from "../electron/host/plugins/lan-share-ipc.mts";
import { deserializeSettings, serializeSettings } from "../electron/settings.mts";
import { buildTransferPackage, parseTransferPackage } from "../electron/session-transfer.mts";
import {
  SHARE_MANIFEST_FILE,
  SHARE_PACKAGE_FORMAT,
  SHARE_PACKAGE_VERSION,
  unpackSharePackageToManagedDir,
} from "../electron/plugin-share.mts";

async function mkSandbox(t, prefix = "dyworker-lan-") {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  return dir;
}

async function waitUntil(fn, timeoutMs = 4000, stepMs = 30) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await fn();
    if (val) return val;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error("等待条件超时");
}

test("身份展示优先级：自定义昵称 > 登录账号 > 系统用户名 > 设备名，且正确提取登录账号", () => {
  const withLogin = resolveLocalIdentity({
    deviceId: "d1",
    nickname: "",
    loginAccount: "zhangsan@company.com",
    username: "sysuser",
    hostname: "mac-01",
  });
  assert.equal(withLogin.displayName, "zhangsan@company.com");
  assert.equal(withLogin.account, "zhangsan@company.com");

  const withNickAndLogin = resolveLocalIdentity({
    deviceId: "d1",
    nickname: "张三（财务部）",
    loginAccount: "zhangsan@company.com",
    username: "sysuser",
    hostname: "mac-01",
  });
  assert.equal(withNickAndLogin.displayName, "张三（财务部）");
  assert.equal(withNickAndLogin.account, "zhangsan@company.com");

  const fallbackSys = resolveLocalIdentity({
    deviceId: "d1",
    nickname: "",
    loginAccount: "",
    username: "alice",
    hostname: "alice-mbp",
  });
  assert.equal(fallbackSys.displayName, "alice");
  assert.equal(fallbackSys.account, "");

  assert.equal(resolveLanLoginAccount({ account: { email: "li@corp.cn" } }), "li@corp.cn");
  assert.equal(resolveLanLoginAccount({ channels: { wechat: { userId: "wx-123" } } }), "wx-123");
  assert.equal(resolveLanLoginAccount({}), "");
});

test("私网 IP 白名单校验：放行局域网与环回，拒绝公网 IP", () => {
  for (const allowed of ["127.0.0.1", "::1", "::ffff:192.168.1.25", "10.0.5.12", "172.16.0.1", "172.31.255.4", "192.168.100.88", "169.254.10.2", "fe80::1", "fd12:3456::1"]) {
    assert.equal(isPrivateLanAddress(allowed), true, `应放行 ${allowed}`);
  }
  for (const blocked of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.0.1", "192.169.1.1", "11.0.0.1", ""]) {
    assert.equal(isPrivateLanAddress(blocked), false, `应拦截 ${blocked}`);
  }

  // 非标企业园区内网段（如 172.168.139.63 与 172.168.138.154 同 /16 段）与手工直连地址
  const localIfaces = [{ address: "172.168.139.63", netmask: "255.255.255.0" }];
  assert.equal(isAllowedLanPeerAddress("172.168.138.154", { localInterfaces: localIfaces }), true);
  assert.equal(isAllowedLanPeerAddress("100.64.12.8", { localInterfaces: localIfaces }), true);
  assert.equal(isAllowedLanPeerAddress("172.169.1.1", { localInterfaces: localIfaces }), false);
  assert.equal(isAllowedLanPeerAddress("8.8.8.8", { localInterfaces: localIfaces }), false);
  assert.equal(
    isAllowedLanPeerAddress("172.168.138.154", { localInterfaces: [], trustedHosts: ["172.168.138.154"] }),
    true,
  );
  assert.deepEqual(parseManualPeerAddress("http://172.168.138.154:41235/"), {
    host: "172.168.138.154",
    port: 41235,
    normalized: "172.168.138.154:41235",
  });
  assert.deepEqual(parseManualPeerAddress("172.168.138.154"), {
    host: "172.168.138.154",
    normalized: "172.168.138.154",
  });
  assert.equal(parseManualPeerAddress("bad host!"), null);
});

test("双节点局域网自动发现与会话直传闭环（含同意导入、完成后销毁、拒绝、取消与隐身拦截）", async (t) => {
  let aliceConfig = { discoverable: true, nickname: "Alice", loginAccount: "alice@corp.cn" };
  let bobConfig = { discoverable: true, nickname: "", loginAccount: "bob@corp.cn" };

  const aliceIncoming = [];
  const bobIncoming = [];
  const bobCancelled = [];
  const aliceUpdates = [];
  const bobImportedPayloads = [];

  const alice = new LanShareService({
    deviceId: "device-alice-001",
    appVersion: "0.4.0",
    discoveryPort: 0,
    bindHost: "127.0.0.1",
    broadcastTargets: ["127.0.0.1"],
    heartbeatIntervalMs: 60_000,
    getConfig: () => aliceConfig,
    onIncomingOffer: (offer) => aliceIncoming.push(offer),
    onTransferUpdate: (tr) => aliceUpdates.push(tr),
  });

  const bob = new LanShareService({
    deviceId: "device-bob-002",
    appVersion: "0.4.0",
    discoveryPort: 0,
    bindHost: "127.0.0.1",
    broadcastTargets: ["127.0.0.1"],
    heartbeatIntervalMs: 60_000,
    getConfig: () => bobConfig,
    onIncomingOffer: (offer) => bobIncoming.push(offer),
    onIncomingCancelled: (id) => bobCancelled.push(id),
    onImportPayload: async (offer, buffer) => {
      const parsed = parseTransferPackage(buffer.toString("utf8"));
      bobImportedPayloads.push({ offer, pkg: parsed.package });
      return { ok: parsed.ok, added: parsed.package?.sessions.length || 0 };
    },
  });

  await alice.start();
  await bob.start();
  t.after(async () => {
    await alice.stop();
    await bob.stop();
  });

  // 互相指向对方的 UDP 发现端口（同机双节点模拟局域网广播）
  alice.setPeerDiscoveryPorts([bob.getListeningDiscoveryPort()]);
  bob.setPeerDiscoveryPorts([alice.getListeningDiscoveryPort()]);
  alice.refreshPeers();
  bob.refreshPeers();

  // 1. 双向自动发现，包含各自登录账号与显示名
  const bobInAlice = await waitUntil(() => alice.getPeers().find((p) => p.deviceId === "device-bob-002"));
  const aliceInBob = await waitUntil(() => bob.getPeers().find((p) => p.deviceId === "device-alice-001"));
  assert.equal(bobInAlice.displayName, "bob@corp.cn");
  assert.equal(bobInAlice.account, "bob@corp.cn");
  assert.equal(aliceInBob.displayName, "Alice");
  assert.equal(aliceInBob.account, "alice@corp.cn");

  // 2. Alice 发会话分享给 Bob
  const pkg = buildTransferPackage({
    kind: "session",
    sessions: [{
      id: "sess-lan-1",
      title: "季度总结分析",
      workspacePath: "/tmp/proj",
      messages: [{ role: "user", content: "请帮我汇总数据" }],
    }],
  });
  const payloadBuf = Buffer.from(JSON.stringify(pkg), "utf8");
  const sendRes = await alice.sendOffer({
    peerId: "device-bob-002",
    kind: "session",
    title: "季度总结分析",
    fileName: "季度总结分析.dyworker",
    meta: { sessionCount: 1, attachmentCount: 0 },
    payloadBuffer: payloadBuf,
  });
  assert.equal(sendRes.ok, true, sendRes.error);

  const receivedOffer = await waitUntil(() => bobIncoming.find((o) => o.transferId === sendRes.transferId));
  assert.equal(receivedOffer.sender.displayName, "Alice");
  assert.equal(receivedOffer.sender.account, "alice@corp.cn");
  assert.equal(receivedOffer.title, "季度总结分析");

  // 错误令牌不能拉取文件
  const badDl = await new Promise((resolve) => {
    http.get(
      `http://127.0.0.1:${alice.getListeningHttpPort()}/lan-share/download?id=${encodeURIComponent(sendRes.transferId)}&token=wrong-token`,
      (res) => resolve(res.statusCode),
    );
  });
  assert.equal(badDl, 403);

  // 3. Bob 点同意 → 拉取 + SHA-256 校验 + 导入回调 → Alice 收到 completed 且临时文件销毁
  const respondRes = await bob.respondIncoming(sendRes.transferId, { accepted: true });
  assert.equal(respondRes.ok, true, respondRes.error);
  assert.equal(bobImportedPayloads.length, 1);
  assert.equal(bobImportedPayloads[0].pkg.sessions[0].title, "季度总结分析");

  const completedUpdate = await waitUntil(() =>
    aliceUpdates.find((u) => u.transferId === sendRes.transferId && u.status === "completed"),
  );
  assert.equal(completedUpdate.status, "completed");

  // 完成后旧 token 再次下载应 404（已销毁）
  const expiredDl = await new Promise((resolve) => {
    http.get(
      `http://127.0.0.1:${alice.getListeningHttpPort()}/lan-share/download?id=${encodeURIComponent(sendRes.transferId)}&token=${encodeURIComponent(receivedOffer.downloadToken)}`,
      (res) => resolve(res.statusCode),
    );
  });
  assert.equal(expiredDl, 404);

  // 4. Bob 拒绝另一条请求 → Alice 收到 rejected
  const sendRes2 = await alice.sendOffer({
    peerId: "device-bob-002",
    kind: "project",
    title: "测试拒绝项目",
    fileName: "proj.dyworker",
    payloadBuffer: payloadBuf,
  });
  assert.equal(sendRes2.ok, true);
  await waitUntil(() => bobIncoming.find((o) => o.transferId === sendRes2.transferId));
  const rejectRes = await bob.respondIncoming(sendRes2.transferId, { accepted: false });
  assert.equal(rejectRes.ok, true);
  assert.equal(rejectRes.accepted, false);
  const rejectedUpdate = await waitUntil(() =>
    aliceUpdates.find((u) => u.transferId === sendRes2.transferId && u.status === "rejected"),
  );
  assert.equal(rejectedUpdate.status, "rejected");

  // 5. Alice 主动取消 → Bob 收到取消回调
  const sendRes3 = await alice.sendOffer({
    peerId: "device-bob-002",
    kind: "session",
    title: "测试取消",
    fileName: "cancel.dyworker",
    payloadBuffer: payloadBuf,
  });
  assert.equal(sendRes3.ok, true);
  await waitUntil(() => bobIncoming.find((o) => o.transferId === sendRes3.transferId));
  await alice.cancelOutgoing(sendRes3.transferId);
  await waitUntil(() => bobCancelled.includes(sendRes3.transferId));
  assert.equal(bob.getIncomingOffers().some((o) => o.transferId === sendRes3.transferId), false);

  // 6. Bob 开启隐身 → 从列表移除并拒绝接收新请求
  bobConfig = { ...bobConfig, discoverable: false };
  bob.syncVisibility();
  await waitUntil(() => !alice.getPeers().some((p) => p.deviceId === "device-bob-002"));

  // 直接模拟残留缓存请求也被对方 403 拒收
  const stealthAttempt = await new Promise((resolve) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: bob.getListeningHttpPort(),
      path: "/lan-share/offer",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => resolve(res.statusCode));
    req.end(JSON.stringify({ transferId: "t-stealth", kind: "session", title: "x", sizeBytes: 10, sha256: "a", downloadToken: "t", sender: { deviceId: "d", httpPort: 1234 } }));
  });
  assert.equal(stealthAttempt, 403);
});

test("局域网插件直传闭环与 SHA-256 防篡改拦截", async (t) => {
  const receiverDataDir = await mkSandbox(t, "dyw-lan-plugin-rx-");
  const storageRoot = path.join(receiverDataDir, "plugins", "data");

  // 构造合法的 .dyplugin 压缩包 Buffer
  const zip = new AdmZip();
  zip.addFile("plugin/package.json", Buffer.from(JSON.stringify({
    name: "lan-shared-tool",
    version: "1.0.0",
    type: "module",
    main: "index.js",
    description: "局域网直传插件测试",
  }), "utf8"));
  zip.addFile("plugin/index.js", Buffer.from(`export const name = "lan-shared-tool"; export function apply() {}`, "utf8"));
  zip.addFile("data/lan-shared-tool/preset.json", Buffer.from(JSON.stringify({ ok: true }), "utf8"));
  zip.addFile(SHARE_MANIFEST_FILE, Buffer.from(JSON.stringify({
    format: SHARE_PACKAGE_FORMAT,
    version: SHARE_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: "0.4.0",
    packageName: "lan-shared-tool",
    displayName: "局域网插件",
    pluginVersion: "1.0.0",
    description: "局域网直传插件测试",
    hasClient: false,
    hasThirdPartyDeps: false,
    includesData: true,
    dataFiles: ["lan-shared-tool/preset.json"],
  }), "utf8"));
  const pluginZipBuf = zip.toBuffer();

  const sender = new LanShareService({
    deviceId: "lan-plugin-tx",
    discoveryPort: 0,
    bindHost: "127.0.0.1",
    broadcastTargets: ["127.0.0.1"],
    heartbeatIntervalMs: 60_000,
    getConfig: () => ({ discoverable: true, nickname: "发送者", loginAccount: "" }),
  });

  let unpackedResult = null;
  const receiver = new LanShareService({
    deviceId: "lan-plugin-rx",
    discoveryPort: 0,
    bindHost: "127.0.0.1",
    broadcastTargets: ["127.0.0.1"],
    heartbeatIntervalMs: 60_000,
    getConfig: () => ({ discoverable: true, nickname: "接收者", loginAccount: "" }),
    onImportPayload: async (offer, buffer, importOptions) => {
      unpackedResult = await unpackSharePackageToManagedDir({
        buffer,
        fileName: offer.fileName,
        dataDir: receiverDataDir,
        storageRoot,
        importData: importOptions.importData !== false,
        overwriteData: Boolean(importOptions.overwriteData),
      });
      return unpackedResult;
    },
  });

  await sender.start();
  await receiver.start();
  t.after(async () => {
    await sender.stop();
    await receiver.stop();
  });

  sender.setPeerDiscoveryPorts([receiver.getListeningDiscoveryPort()]);
  receiver.setPeerDiscoveryPorts([sender.getListeningDiscoveryPort()]);
  sender.refreshPeers();
  await waitUntil(() => sender.getPeers().some((p) => p.deviceId === "lan-plugin-rx"));

  const sendRes = await sender.sendOffer({
    peerId: "lan-plugin-rx",
    kind: "plugin",
    title: "局域网插件",
    fileName: "lan-shared-tool-v1.0.0.dyplugin",
    meta: { packageName: "lan-shared-tool", pluginVersion: "1.0.0", includesData: true },
    payloadBuffer: pluginZipBuf,
  });
  assert.equal(sendRes.ok, true);
  await waitUntil(() => receiver.getIncomingOffers().some((o) => o.transferId === sendRes.transferId));

  const rxRes = await receiver.respondIncoming(sendRes.transferId, {
    accepted: true,
    importOptions: { importData: true },
  });
  assert.equal(rxRes.ok, true, rxRes.error);
  assert.equal(unpackedResult?.ok, true);
  assert.deepEqual(unpackedResult?.importedDataFiles, ["lan-shared-tool/preset.json"]);

  // SHA-256 篡改检测：若下载响应体与 offer 声明 sha256 不一致，必须拦截拒绝
  const fakeSender = new LanShareService({
    deviceId: "lan-tamper-tx",
    discoveryPort: 0,
    bindHost: "127.0.0.1",
    broadcastTargets: ["127.0.0.1"],
    heartbeatIntervalMs: 60_000,
  });
  await fakeSender.start();
  t.after(async () => fakeSender.stop());

  // 直接给 receiver 投递一个 sha256 不匹配的 offer（指向一个返回不同内容的本地测试 HTTP server）
  const tamperSrv = http.createServer((_req, res) => {
    const body = Buffer.from("tampered-content");
    res.writeHead(200, { "Content-Length": body.length });
    res.end(body);
  });
  await new Promise((r) => tamperSrv.listen(0, "127.0.0.1", r));
  t.after(() => tamperSrv.close());
  const tamperPort = tamperSrv.address().port;

  await new Promise((resolve) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: receiver.getListeningHttpPort(),
      path: "/lan-share/offer",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.end(JSON.stringify({
      transferId: "tamper-1",
      kind: "session",
      title: "篡改测试",
      fileName: "t.dyworker",
      sizeBytes: 16,
      sha256: createHash("sha256").update("original-content").digest("hex"),
      downloadToken: "tok",
      sender: { deviceId: "tamper-dev", displayName: "T", account: "", host: "h", platform: "darwin", httpPort: tamperPort },
    }));
  });

  const tamperRes = await receiver.respondIncoming("tamper-1", { accepted: true });
  assert.equal(tamperRes.ok, false);
  assert.match(tamperRes.error, /校验失败|SHA-256/);
});

test("设置序列化与前端/Preload/主进程局域网分享接线契约", async () => {
  const secretStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (v) => Buffer.from(v, "utf8"),
    decryptString: (v) => v.toString("utf8"),
  };
  const stored = serializeSettings({
    lanShare: {
      enabled: false,
      nickname: " 测试昵称 ",
      manualPeers: ["172.168.138.154", "172.168.138.154:41235"],
    },
  }, secretStorage);
  assert.deepEqual(stored.lanShare, {
    enabled: false,
    nickname: "测试昵称",
    manualPeers: ["172.168.138.154", "172.168.138.154:41235"],
  });
  const restored = deserializeSettings(stored, secretStorage);
  assert.deepEqual(restored.lanShare, {
    enabled: false,
    nickname: "测试昵称",
    manualPeers: ["172.168.138.154", "172.168.138.154:41235"],
  });
  assert.deepEqual(deserializeSettings({}, secretStorage).lanShare, {
    enabled: true,
    nickname: "",
    manualPeers: [],
  });

  const read = (rel) => fs.readFile(new URL(rel, import.meta.url), "utf8");
  const [sidebar, shell, sharePlugin, appDialogs, sendDialog, preload, ipc, mainTs] = await Promise.all([
    read("../src/app/Sidebar.tsx"),
    read("../src/app/ShellLayout.tsx"),
    read("../src/SharePluginDialog.tsx"),
    read("../src/app/AppDialogs.tsx"),
    read("../src/features/transfer/LanShareSendDialog.tsx"),
    read("../electron/preload.cjs"),
    read("../electron/host/plugins/lan-share-ipc.mts"),
    read("../electron/main.mts"),
  ]);

  assert.match(sidebar, /局域网分享…/);
  assert.match(sidebar, /局域网分享项目…/);
  assert.match(shell, /局域网分享…/);
  assert.match(sharePlugin, /局域网分享…/);
  assert.match(appDialogs, /LanShareSendDialog/);
  assert.match(appDialogs, /LanShareIncomingDialog/);
  assert.match(sendDialog, /跨网段直连 IP/);
  assert.match(preload, /lan-share:get-state/);
  assert.match(preload, /lan-share:add-peer/);
  assert.match(preload, /lan-share:remove-peer/);
  assert.match(preload, /lan-share:send/);
  assert.match(preload, /lan-share:respond-incoming/);
  assert.match(ipc, /lan-share:get-state/);
  assert.match(ipc, /lan-share:add-peer/);
  assert.match(ipc, /lan-share:remove-peer/);
  assert.match(ipc, /lan-share:send/);
  assert.match(ipc, /lan-share:respond-incoming/);
  assert.match(mainTs, /lanShareIpcPlugin/);
  const readyIndex = mainTs.indexOf("app.whenReady()");
  const lanMountIndex = mainTs.indexOf("ctx.plugin(lanShareIpcPlugin");
  const createWindowIndex = mainTs.indexOf("createWindow();");
  assert.ok(readyIndex > -1 && lanMountIndex > -1 && createWindowIndex > -1);
  assert.ok(
    readyIndex < lanMountIndex && lanMountIndex < createWindowIndex,
    "lanShareIpcPlugin 必须在 app.whenReady() 之后、createWindow() 之前挂载",
  );
  assert.match(mainTs, /safeStorageForHost[\s\S]*?app\.isReady\(\)/);
});

test("跨网段无广播环境下支持手动输入 IP 探测并完成传输", async (t) => {
  const incomingOffers = [];
  const importedPayloads = [];

  const sender = new LanShareService({
    deviceId: "cross-subnet-sender",
    appVersion: "0.4.0",
    discoveryPort: 0,
    httpPort: 0,
    bindHost: "127.0.0.1",
    broadcastTargets: [],
    heartbeatIntervalMs: 60_000,
    getConfig: () => ({ enabled: true, nickname: "发送端", manualPeers: [] }),
  });

  const receiver = new LanShareService({
    deviceId: "cross-subnet-receiver",
    appVersion: "0.4.0",
    discoveryPort: 0,
    httpPort: 0,
    bindHost: "127.0.0.1",
    broadcastTargets: [],
    heartbeatIntervalMs: 60_000,
    getConfig: () => ({ enabled: true, nickname: "跨网段接收端", manualPeers: [] }),
    onIncomingOffer: (offer) => incomingOffers.push(offer),
    onImportPayload: async (offer, buffer) => {
      const parsed = parseTransferPackage(buffer.toString("utf8"));
      importedPayloads.push({ offer, pkg: parsed.package });
      return { ok: parsed.ok, added: parsed.package?.sessions.length || 0 };
    },
  });

  await sender.start();
  await receiver.start();
  t.after(async () => {
    await sender.stop();
    await receiver.stop();
  });

  const receiverPort = receiver.getListeningHttpPort();
  assert.ok(receiverPort > 0, "接收端 HTTP 服务应监听成功");
  assert.equal(sender.getPeers().length, 0, "无广播模式下初始不应发现节点");

  const probe = await sender.probeManualTarget(`127.0.0.1:${receiverPort}`);
  assert.equal(probe.ok, true, probe.error);
  assert.equal(probe.peer?.deviceId, "cross-subnet-receiver");
  assert.equal(probe.peer?.displayName, "跨网段接收端");
  assert.equal(probe.peer?.ip, "127.0.0.1");
  assert.equal(probe.peer?.httpPort, receiverPort);
  assert.equal(sender.getPeers().length, 1);

  const pkg = buildTransferPackage({
    kind: "session",
    sessions: [
      {
        id: "cross-subnet-sess-1",
        title: "跨网段传输测试",
        workspacePath: "/tmp/proj",
        messages: [{ role: "user", content: "ping" }],
      },
    ],
  });
  const offerRes = await sender.sendOffer({
    peerId: "cross-subnet-receiver",
    kind: "session",
    title: "跨网段传输测试",
    fileName: "cross-subnet.dyworker",
    payloadBuffer: Buffer.from(JSON.stringify(pkg), "utf8"),
  });
  assert.equal(offerRes.ok, true, offerRes.error);

  assert.equal(incomingOffers.length, 1);
  const acceptRes = await receiver.respondIncoming(offerRes.transferId, { accepted: true });
  assert.equal(acceptRes.ok, true, acceptRes.error);
  assert.equal(importedPayloads.length, 1);
  assert.equal(importedPayloads[0].pkg.sessions[0].title, "跨网段传输测试");
});
