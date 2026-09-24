import assert from "node:assert/strict";
import test from "node:test";
import {
  createUpdaterController,
  isReleaseTagForVersion,
  latestYmlFileNames,
  parseGithubUpdateUrl,
  releaseNotesFromUpdateYml,
  releaseTagForVersion,
} from "../electron/app-updater.mjs";

const offlineFetchText = async () => { throw new Error("测试环境不访问网络"); };

test("更新地址解析为 GitHub 仓库和版本标签配置", () => {
  assert.deepEqual(parseGithubUpdateUrl("https://github.com/example/dyworker-updates/"), {
    provider: "github",
    owner: "example",
    repo: "dyworker-updates",
    tagNamePrefix: "v",
  });
  assert.throws(() => parseGithubUpdateUrl("https://example.com/downloads"), /GitHub/);
});

test("发布标签严格对应应用版本", () => {
  assert.equal(releaseTagForVersion("0.1.17"), "v0.1.17");
  assert.equal(isReleaseTagForVersion("v0.1.17", "0.1.17"), true);
  assert.equal(isReleaseTagForVersion("v0.1.18", "0.1.17"), false);
  assert.equal(isReleaseTagForVersion("release-0.1.17", "0.1.17", "release-"), true);
});

test("更新控制器转发检查、下载和安装状态", async () => {
  const listeners = new Map();
  const sent = [];
  let installed = false;
  const feedUrls = [];
  const updater = {
    on(event, listener) {
      listeners.set(event, listener);
    },
    async checkForUpdates() {
      listeners.get("update-available")?.({ version: "0.1.17", releaseName: "修复版本" });
    },
    async downloadUpdate() {
      listeners.get("download-progress")?.({ percent: 42 });
      listeners.get("update-downloaded")?.({ version: "0.1.17" });
    },
    quitAndInstall() {
      installed = true;
    },
    setFeedURL(options) {
      feedUrls.push(options);
    },
  };
  const controller = createUpdaterController({
    updater,
    isPackaged: true,
    currentVersion: "0.1.16",
    updateUrl: "https://github.com/example/dyworker-updates",
    fetchText: offlineFetchText,
    getWindow: () => ({ webContents: { send: (_name, status) => sent.push(status) } }),
  });

  await controller.check();
  assert.equal(controller.getStatus().state, "available");
  assert.equal(controller.getStatus().version, "0.1.17");
  await controller.download();
  assert.equal(controller.getStatus().state, "downloaded");
  assert.deepEqual(controller.install(), { ok: true, state: "installing" });
  assert.equal(installed, true);
  assert.deepEqual(feedUrls[0], {
    provider: "github",
    owner: "example",
    repo: "dyworker-updates",
    tagNamePrefix: "v",
  });
  assert.ok(sent.some((status) => status.state === "downloading"));
});

test("开发环境不执行更新检查", async () => {
  let called = false;
  const controller = createUpdaterController({
    updater: { checkForUpdates: async () => { called = true; } },
    isPackaged: false,
    currentVersion: "0.1.16",
    getWindow: () => null,
  });
  const result = await controller.check();
  assert.equal(result.ok, false);
  assert.equal(result.state, "unavailable");
  assert.equal(called, false);
});

test("静默自动检查不推送 checking 状态，只在发现新版本时推送", async () => {
  const listeners = new Map();
  const sent = [];
  const updater = {
    on(event, listener) { listeners.set(event, listener); },
    setFeedURL() {},
    async checkForUpdates() {
      listeners.get("update-available")?.({
        version: "0.2.0",
        releaseNotes: [{ version: "0.2.0", note: "- 新增侧栏下载按钮\n- 显示更新内容" }],
      });
    },
    async downloadUpdate() {},
    quitAndInstall() {},
  };
  const controller = createUpdaterController({
    updater,
    isPackaged: true,
    currentVersion: "0.1.23",
    updateUrl: "https://github.com/example/dyworker",
    fetchText: offlineFetchText,
    getWindow: () => ({ webContents: { send: (_name, status) => sent.push(status) } }),
  });
  await controller.check({ silent: true });
  // 静默检查不推送 checking
  assert.ok(!sent.some((s) => s.state === "checking"));
  // 但发现新版本仍然推送 available，且带解析后的 releaseNotes 字符串
  const available = sent.find((s) => s.state === "available");
  assert.ok(available);
  assert.equal(available.version, "0.2.0");
  assert.equal(available.releaseNotes, "- 新增侧栏下载按钮\n- 显示更新内容");
  assert.equal(controller.getStatus().state, "available");
});

test("静默检查失败不推送 error 状态", async () => {
  const sent = [];
  const updater = {
    on() {},
    setFeedURL() {},
    async checkForUpdates() { throw new Error("网络不可达"); },
    async downloadUpdate() {},
    quitAndInstall() {},
  };
  const controller = createUpdaterController({
    updater,
    isPackaged: true,
    currentVersion: "0.1.23",
    updateUrl: "https://github.com/example/dyworker",
    fetchText: offlineFetchText,
    getWindow: () => ({ webContents: { send: (_name, status) => sent.push(status) } }),
  });
  const result = await controller.check({ silent: true });
  assert.equal(result.ok, false);
  assert.equal(result.state, "error");
  assert.ok(!sent.some((s) => s.state === "error"));
  assert.equal(controller.getStatus().state, "idle");
});

test("从 latest*.yml 文本解析块标量形式的 releaseNotes", () => {
  const yml = [
    "version: 0.2.1",
    "files:",
    "  - url: dyworker-0.2.1-arm64.dmg",
    "    sha512: abc",
    "releaseNotes: |",
    "  ### 新增",
    "",
    "  - 第一条更新",
    "  - 第二条更新",
    "releaseDate: '2026-09-24T00:00:00.000Z'",
    "",
  ].join("\n");
  assert.equal(releaseNotesFromUpdateYml(yml), "### 新增\n\n- 第一条更新\n- 第二条更新");
  assert.equal(releaseNotesFromUpdateYml("version: 0.2.1\n"), "");
  assert.equal(releaseNotesFromUpdateYml('releaseNotes: "单行说明"'), "单行说明");
});

test("各平台使用对应的 latest 清单文件名", () => {
  assert.deepEqual(latestYmlFileNames("darwin", "arm64"), ["latest-mac.yml"]);
  assert.deepEqual(latestYmlFileNames("win32", "x64"), ["latest.yml"]);
  assert.deepEqual(latestYmlFileNames("linux", "arm64"), ["latest-linux-arm64.yml", "latest-linux.yml"]);
  assert.deepEqual(latestYmlFileNames("linux", "x64"), ["latest-linux.yml"]);
});

test("发现新版本时从 latest*.yml 拉取 Markdown 更新说明覆盖 HTML", async () => {
  const listeners = new Map();
  const sent = [];
  const requestedUrls = [];
  const updater = {
    on(event, listener) { listeners.set(event, listener); },
    setFeedURL() {},
    async checkForUpdates() {
      listeners.get("update-available")?.({
        version: "0.2.1",
        releaseNotes: "<h2>0.1.24</h2><p>atom feed 的旧 HTML</p>",
      });
    },
    async downloadUpdate() {},
    quitAndInstall() {},
  };
  const controller = createUpdaterController({
    updater,
    isPackaged: true,
    currentVersion: "0.2.0",
    updateUrl: "https://github.com/example/dyworker",
    platform: "darwin",
    arch: "arm64",
    fetchText: async (url) => {
      requestedUrls.push(url);
      return "version: 0.2.1\nreleaseNotes: |\n  ### 新增\n\n  - 当前版本的更新说明\n";
    },
    getWindow: () => ({ webContents: { send: (_name, status) => sent.push(status) } }),
  });
  await controller.check();
  // 等异步的 yml 拉取落盘
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requestedUrls, ["https://github.com/example/dyworker/releases/download/v0.2.1/latest-mac.yml"]);
  assert.equal(controller.getStatus().releaseNotes, "### 新增\n\n- 当前版本的更新说明");
  assert.equal(controller.getStatus().updateUrl, "https://github.com/example/dyworker");
  // update-downloaded 不得用 atom feed 的 HTML 覆盖已拉到的 Markdown
  listeners.get("update-downloaded")?.({ version: "0.2.1", releaseNotes: "<p>HTML</p>" });
  assert.equal(controller.getStatus().releaseNotes, "### 新增\n\n- 当前版本的更新说明");
});

test("latest*.yml 没有 releaseNotes 时保留 electron-updater 原始内容", async () => {
  const listeners = new Map();
  const updater = {
    on(event, listener) { listeners.set(event, listener); },
    setFeedURL() {},
    async checkForUpdates() {
      listeners.get("update-available")?.({ version: "0.2.1", releaseNotes: "原始说明" });
    },
    async downloadUpdate() {},
    quitAndInstall() {},
  };
  const controller = createUpdaterController({
    updater,
    isPackaged: true,
    currentVersion: "0.2.0",
    updateUrl: "https://github.com/example/dyworker",
    platform: "darwin",
    fetchText: async () => "version: 0.2.1\nfiles: []\n",
    getWindow: () => null,
  });
  await controller.check();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getStatus().releaseNotes, "原始说明");
});
