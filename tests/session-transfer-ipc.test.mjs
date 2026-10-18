// 迁移迁移 IPC 的端到端集成测试（不启动 Electron）：
// 用假的 electron 边界（dialog/fs/app/path）驱动 transferIpcPlugin 注册的两个通道，
// 覆盖「真机导出的操作序列」：导出→包文件落到磁盘→另一个数据目录导入→存档读回。
// 这样验证的是主进程真实代码路径（对话框返回值、附件落盘、目录映射、编号冲突），
// 而不只是纯函数的单元行为。
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSessionArchive } from "../electron/session-archive.mts";
import { transferIpcPlugin } from "../electron/host/plugins/transfer-ipc.mts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 造一个数据目录 + 会话存档 + 假的壳层依赖
async function machine({ sessions = [], workspace = "", saveDialog = null, openDialogs = [] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-transfer-ipc-"));
  const userData = path.join(root, "userData");
  await fs.mkdir(userData, { recursive: true });
  const dir = path.join(userData, "sessions");
  const archive = createSessionArchive({ dir, legacyFile: path.join(userData, "sessions.json") });
  if (sessions.length) await archive.saveAll(sessions);

  const handlers = new Map();
  const dialogs = [];
  const saveAnswers = [...(saveDialog ? [saveDialog] : [])];
  const openAnswers = [...openDialogs];

  const deps = {
    trustedHandle: (channel, handler) => handlers.set(channel, handler),
    fs,
    path,
    platform: process.platform,
    app: {
      getVersion: () => "0.3.0",
      getPath: (name) => {
        if (name === "userData") return userData;
        if (name === "documents") return path.join(root, "Documents");
        return root;
      },
    },
    getMainWindow: () => null,
    dialog: {
      showSaveDialog: async () => {
        dialogs.push("save");
        return saveAnswers.length ? saveAnswers.shift() : { canceled: true };
      },
      showOpenDialog: async () => {
        dialogs.push("open");
        return openAnswers.length ? openAnswers.shift() : { canceled: true };
      },
    },
    dataFile: (name) => path.join(userData, name),
    readJson: async (file, fallback) => {
      try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
    },
    writeJson: async (file, value) => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
    },
    readAllSessions: () => archive.loadAll(),
  };
  const ctx = {
    sessions: {
      get: (id) => archive.getSync(id),
      replace: (session) => archive.replace(session),
    },
    effect: () => {},
  };
  transferIpcPlugin(deps).apply(ctx);
  return { root, userData, archive, handlers, dialogs, workspace };
}

const sessionOf = (id, extra = {}) => ({
  id,
  title: `任务 ${id}`,
  workspacePath: "/Users/alice/Documents/公文",
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-02T00:00:00.000Z",
  messages: [
    { role: "user", content: "把会议记录整理成通知", createdAt: "2026-03-01T00:00:00.000Z" },
    { role: "assistant", content: "已起草", createdAt: "2026-03-01T00:05:00.000Z" },
  ],
  ...extra,
});

test("导出：走原生保存对话框写包，取消时不写文件", async () => {
  const source = await machine({ sessions: [sessionOf("t1")] });
  const cancel = await source.handlers.get("sessions:export-package")({}, { kind: "session", sessionId: "t1" });
  assert.equal(cancel.ok, true);
  assert.equal(cancel.canceled, true);

  const target = path.join(source.root, "out", "t1.dyworker");
  const machine2 = await machine({
    sessions: [sessionOf("t1")],
    saveDialog: { canceled: false, filePath: target },
  });
  const result = await machine2.handlers.get("sessions:export-package")({}, { kind: "session", sessionId: "t1" });
  assert.equal(result.ok, true);
  assert.equal(result.canceled, false);
  assert.equal(result.path, target);
  const pkg = JSON.parse(await fs.readFile(target, "utf8"));
  assert.equal(pkg.format, "dyworker-transfer");
  assert.equal(pkg.sessions.length, 1);
  assert.equal(pkg.sessions[0].messages.length, 2);
});

test("导出：不存在的任务、空项目被明确拒绝", async () => {
  const machine1 = await machine({ sessions: [sessionOf("t1")] });
  const missing = await machine1.handlers.get("sessions:export-package")({}, { kind: "session", sessionId: "nope" });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /找不到要导出的任务/);
  const emptyProject = await machine1.handlers.get("sessions:export-package")({}, { kind: "project", workspacePath: "/Users/alice/nowhere" });
  assert.equal(emptyProject.ok, false);
  assert.match(emptyProject.error, /还没有任务/);
});

test("项目导出带走项目下全部任务与置顶状态", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-transfer-proj-"));
  const target = path.join(root, "proj.dyworker");
  const machine1 = await machine({
    sessions: [sessionOf("a"), sessionOf("b"), sessionOf("c", { workspacePath: "/Users/alice/other" })],
    saveDialog: { canceled: false, filePath: target },
  });
  await machine1.handlers.get("sessions:export-package"); // 不存在，仅确保没有多余通道
  await fs.writeFile(path.join(machine1.userData, "workspace-pins.json"), JSON.stringify(["/Users/alice/Documents/公文"]), "utf8");
  const result = await machine1.handlers.get("sessions:export-package")({}, { kind: "project", workspacePath: "/Users/alice/Documents/公文" });
  assert.equal(result.ok, true);
  assert.equal(result.sessions, 2);
  const pkg = JSON.parse(await fs.readFile(target, "utf8"));
  assert.equal(pkg.kind, "project");
  assert.equal(pkg.project.pinned, true);
  assert.deepEqual(pkg.sessions.map((session) => session.id), ["a", "b"]);
});

test("导入：附件随包恢复、目录映射生效、置顶项目补登记", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-transfer-round-"));
  const attachmentFile = path.join(root, "会议记录.png");
  await fs.writeFile(attachmentFile, Buffer.from("PNG-DATA"), "utf8");
  const packageFile = path.join(root, "bundle.dyworker");

  const source = await machine({
    sessions: [sessionOf("t1", {
      messages: [{ role: "user", content: "看图", createdAt: "2026-03-01T00:00:00.000Z",
        attachments: [{ name: "会议记录.png", path: attachmentFile, size: 8, mimeType: "image/png" }] }],
    })],
    saveDialog: { canceled: false, filePath: packageFile },
  });
  await fs.writeFile(path.join(source.userData, "workspace-pins.json"), JSON.stringify(["/Users/alice/Documents/公文"]), "utf8");
  const exported = await source.handlers.get("sessions:export-package")({}, { kind: "project", workspacePath: "/Users/alice/Documents/公文" });
  assert.equal(exported.ok, true);
  assert.equal(exported.attachments, 1);

  // 目标机器：本机已有同 id 任务；原目录不存在，用户选了新目录
  const localWorkspace = path.join(root, "本机公文目录");
  await fs.mkdir(localWorkspace, { recursive: true });
  const target = await machine({
    sessions: [sessionOf("t1", { title: "本机已有任务", messages: [] })],
    openDialogs: [
      { canceled: false, filePaths: [packageFile] },
      { canceled: false, filePaths: [localWorkspace] },
    ],
  });
  const imported = await target.handlers.get("sessions:import-package")();
  assert.equal(imported.ok, true);
  assert.equal(imported.added, 1);
  assert.equal(imported.renamed, 1);
  assert.equal(imported.attachments, 1);
  assert.equal(imported.pinnedWorkspace, localWorkspace);
  const session = imported.sessions[0];
  assert.equal(session.id, "t1-1");
  assert.equal(session.workspacePath, localWorkspace);
  const restored = session.messages[0].attachments[0].path;
  assert.notEqual(restored, attachmentFile);
  assert.equal(await fs.readFile(restored, "utf8"), "PNG-DATA");

  // 存档真的落盘：新开一个 archive 读同一目录仍能看到
  const reopened = createSessionArchive({
    dir: path.join(target.userData, "sessions"),
    legacyFile: path.join(target.userData, "sessions.json"),
  });
  const rows = await reopened.loadAll();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.id).sort(), ["t1", "t1-1"]);

  // 置顶配置被追加进本机列表，原置顶不丢
  const pins = JSON.parse(await fs.readFile(path.join(target.userData, "workspace-pins.json"), "utf8"));
  assert.deepEqual(pins, [localWorkspace]);
});

test("导入：用户不给目录时保留原路径并如实回报不可用目录", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-transfer-nodir-"));
  const packageFile = path.join(root, "bundle.dyworker");
  const source = await machine({
    sessions: [sessionOf("t1")],
    saveDialog: { canceled: false, filePath: packageFile },
  });
  await source.handlers.get("sessions:export-package")({}, { kind: "session", sessionId: "t1" });

  const target = await machine({
    openDialogs: [
      { canceled: false, filePaths: [packageFile] },
      { canceled: true },
    ],
  });
  const imported = await target.handlers.get("sessions:import-package")();
  assert.equal(imported.ok, true);
  assert.equal(imported.sessions[0].workspacePath, "/Users/alice/Documents/公文");
  assert.deepEqual(imported.missingWorkspaces, ["/Users/alice/Documents/公文"]);
  assert.equal(imported.renamed, 0);
});

test("导入：取消对话框、选错文件、包版本过高都不动存档", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-transfer-bad-"));
  const cancelMachine = await machine({ openDialogs: [{ canceled: true }] });
  const cancelled = await cancelMachine.handlers.get("sessions:import-package")();
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.canceled, true);

  const wrongFile = path.join(root, "random.json");
  await fs.writeFile(wrongFile, JSON.stringify({ hello: "world" }), "utf8");
  const wrongMachine = await machine({ openDialogs: [{ canceled: false, filePaths: [wrongFile] }] });
  const wrong = await wrongMachine.handlers.get("sessions:import-package")();
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /不是 DYWorker 的任务\/项目迁移包/);

  const futureFile = path.join(root, "future.dyworker");
  await fs.writeFile(futureFile, JSON.stringify({
    format: "dyworker-transfer", version: 99, sessions: [sessionOf("x")],
  }), "utf8");
  const futureMachine = await machine({ openDialogs: [{ canceled: false, filePaths: [futureFile] }] });
  const future = await futureMachine.handlers.get("sessions:import-package")();
  assert.equal(future.ok, false);
  assert.match(future.error, /请先升级 DYWorker/);
  assert.equal((await futureMachine.archive.loadAll()).length, 0);
});
