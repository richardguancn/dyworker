import assert from "node:assert/strict";
import test from "node:test";
import { createUpdaterController, isReleaseTagForVersion, parseGithubUpdateUrl, releaseTagForVersion } from "../electron/app-updater.mjs";

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
