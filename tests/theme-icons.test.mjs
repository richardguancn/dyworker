import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createWindowIconController } from "../electron/theme-icons.mts";
import { appearanceIpcPlugin } from "../electron/host/plugins/appearance-ipc.mts";
import { defaultAppearance } from "../electron/appearance.mts";

function fixture(platform = "linux", empty = false) {
  const reads = [];
  const changes = [];
  const warnings = [];
  const window = { isDestroyed: () => false, setIcon: image => changes.push(image.path) };
  const icons = createWindowIconController({
    platform, directory: "/icons",
    nativeImage: { createFromPath(file) { reads.push(file); return { path: file, isEmpty: () => empty }; } },
    warn: (...args) => warnings.push(args),
  });
  return { icons, window, reads, changes, warnings };
}

test("Linux 窗口从浅色切到深色，取消预览后恢复浅色图标", () => {
  const f = fixture();
  for (const theme of ["light", "dark", "light"]) assert.equal(f.icons.apply(f.window, theme), true);
  assert.deepEqual(f.changes, ["light", "dark", "light"].map(theme => path.join("/icons", `icon-${theme}.png`)));
  assert.equal(f.reads.length, 2, "恢复时复用已读取的图标");
});

test("同一窗口重复应用主题不刷新图标，新窗口仍得到图标", () => {
  const f = fixture();
  f.icons.apply(f.window, "dark");
  f.icons.apply(f.window, "dark");
  assert.equal(f.changes.length, 1);
  f.icons.apply({ ...f.window }, "dark");
  assert.equal(f.changes.length, 2);
  assert.equal(f.reads.length, 1);
});

test("其他平台与已销毁窗口不调用 Linux 窗口图标入口", () => {
  for (const platform of ["darwin", "win32"]) {
    const f = fixture(platform);
    assert.equal(f.icons.apply(f.window, "dark"), false);
    assert.equal(f.changes.length, 0);
    assert.equal(f.reads.length, 0);
  }
  const f = fixture();
  assert.equal(f.icons.apply({ isDestroyed: () => true }, "light"), false);
  assert.equal(f.icons.apply(null, "light"), false);
});

test("图标丢失或桌面拒绝更新时保留原图标，并允许后续重试", () => {
  const empty = fixture("linux", true);
  assert.equal(empty.icons.apply(empty.window, "light"), false);
  assert.equal(empty.changes.length, 0);
  assert.equal(empty.warnings.length, 1);
  const f = fixture();
  let fail = true;
  f.window.setIcon = image => {
    if (fail) throw new Error("模拟桌面拒绝");
    f.changes.push(image.path);
  };
  assert.equal(f.icons.apply(f.window, "dark"), false);
  fail = false;
  assert.equal(f.icons.apply(f.window, "dark"), true);
  assert.equal(f.changes.length, 1);
});

test("主题通知晚于预览请求时保留预览图标，取消后清除预览", async () => {
  const f = fixture();
  const saved = { ...defaultAppearance(), theme: "light" };
  let preview = null;
  let effective = {};
  const handlers = new Map();
  f.window.setBackgroundColor = () => {};
  const update = () => f.icons.apply(f.window, (preview ?? saved).theme);
  const nativeTheme = {
    set themeSource(value) { queueMicrotask(update); },
  };
  const bridge = {
    capabilities: { platform: "linux" },
    resolveNormalizedSettings: raw => raw,
    setWindowIconPreview: value => { preview = value; },
    resolvedTheme: settings => settings.theme,
    applyWindowIcon: settings => f.icons.apply(f.window, settings.theme),
    setEffective: value => { effective = value; },
    getEffective: () => effective,
    syncThemeSource: () => { nativeTheme.themeSource = saved.theme; },
    applyWindow: update,
    getState: () => ({ settings: saved }),
  };
  appearanceIpcPlugin({
    trustedHandle: (name, handler) => handlers.set(name, handler),
    bridge, nativeTheme, getMainWindow: () => f.window,
  }).apply({});
  update();
  await handlers.get("appearance:preview")(null, { ...saved, theme: "dark" });
  assert.equal(preview.theme, "dark");
  assert.equal(f.changes.at(-1), path.join("/icons", "icon-dark.png"));
  await handlers.get("appearance:cancel-preview")(null, {});
  assert.equal(preview, null);
  assert.deepEqual(f.changes, ["light", "dark", "light"].map(theme => path.join("/icons", `icon-${theme}.png`)));
});
