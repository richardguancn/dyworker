import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  APPEARANCE_VERSION,
  defaultAppearance,
  normalizeAppearance,
  readAppearance,
  saveAppearance,
} from "../electron/appearance.mts";
import { applyWindowBackdrop, getAppearanceCapabilities, windowBackgroundFor } from "../electron/appearance-platform.mts";
import { derivePalette } from "../src/appearance/tokens.ts";

async function makeTmpDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyw-appearance-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("默认外观结构符合方案 §4.1", () => {
  const defaults = defaultAppearance();
  assert.equal(defaults.version, 1);
  assert.equal(defaults.theme, "system");
  assert.deepEqual(defaults.background, {
    lightColor: null,
    darkColor: null,
    transparency: 0,
    imageId: null,
    imageFit: "cover",
    overlay: 20,
  });
  assert.deepEqual(defaults.glass, {
    enabled: false,
    strength: "standard",
    lightweight: false,
    systemBackdrop: false,
  });
  assert.deepEqual(defaults.typography, { family: "system", uiSize: 14, contentSize: 16 });
});

test("空配置与缺字段补默认", () => {
  assert.deepEqual(normalizeAppearance({}), defaultAppearance());
  assert.deepEqual(normalizeAppearance(null), defaultAppearance());
  assert.deepEqual(normalizeAppearance(undefined), defaultAppearance());
  const partial = normalizeAppearance({ theme: "dark", typography: { contentSize: 20 } });
  assert.equal(partial.theme, "dark");
  assert.equal(partial.typography.contentSize, 20);
  assert.equal(partial.typography.uiSize, 14);
  assert.equal(partial.background.overlay, 20);
});

test("非法枚举回落默认", () => {
  const settings = normalizeAppearance({
    theme: "neon",
    background: { imageFit: "stretch" },
    glass: { strength: "extreme" },
    typography: { uiSize: 15 },
  });
  assert.equal(settings.theme, "system");
  assert.equal(settings.background.imageFit, "cover");
  assert.equal(settings.glass.strength, "standard");
  assert.equal(settings.typography.uiSize, 14);
});

test("数值有限性检查与范围钳制", () => {
  const settings = normalizeAppearance({
    background: { transparency: NaN, overlay: 500 },
    typography: { contentSize: Infinity },
  });
  assert.equal(settings.background.transparency, 0);
  assert.equal(settings.background.overlay, 80);
  assert.equal(settings.typography.contentSize, 16);

  const clamped = normalizeAppearance({
    background: { transparency: 95, overlay: -3 },
    typography: { contentSize: 99 },
  });
  assert.equal(clamped.background.transparency, 70);
  assert.equal(clamped.background.overlay, 0);
  assert.equal(clamped.typography.contentSize, 24);
  assert.equal(normalizeAppearance({ typography: { contentSize: 10 } }).typography.contentSize, 14);
});

test("颜色校验与规范化", () => {
  const settings = normalizeAppearance({
    background: { lightColor: "#ABC", darkColor: "#AABBCCDD" },
  });
  assert.equal(settings.background.lightColor, "#aabbcc");
  assert.equal(settings.background.darkColor, "#aabbcc");
  for (const bad of ["red", "#ff", "#fffff", "#gggggg", 123, "#aabbccddeeff"]) {
    const one = normalizeAppearance({ background: { lightColor: bad } });
    assert.equal(one.background.lightColor, null, `颜色 ${bad} 应为 null`);
  }
  assert.equal(normalizeAppearance({ background: { darkColor: "" } }).background.darkColor, null);
});

test("字体家族支持中文与英文空格，防注入", () => {
  for (const good of ["PingFang SC", "微软雅黑", "宋体", "思源黑体", "Noto Sans CJK SC", "Courier's Font"]) {
    assert.equal(normalizeAppearance({ typography: { family: `  ${good}  ` } }).typography.family, good);
  }
  for (const bad of ["a;b", "a{}", "a<b>", "a\\b", "a\x01b", "a\"b", "a(b)", "a*b", "x".repeat(121), ""]) {
    const one = normalizeAppearance({ typography: { family: bad } });
    assert.equal(one.typography.family, "system", `字体 ${JSON.stringify(bad)} 应回落 system`);
  }
});

test("imageId 只接受资源 ID 格式", () => {
  const ok = normalizeAppearance({ background: { imageId: "abcdef0123456789abcdef0123456789.png" } });
  assert.equal(ok.background.imageId, "abcdef0123456789abcdef0123456789.png");
  for (const bad of ["../x.png", "a/b.png", "x.png", "ZZZZZZZZ.png", "abc.png", "abcdef0123456789.png", "abc12345.gif", 42]) {
    const one = normalizeAppearance({ background: { imageId: bad } });
    assert.equal(one.background.imageId, null, `imageId ${bad} 应为 null`);
  }
});

test("version 缺失视为 1，更高版本标记 unknownVersion", () => {
  assert.equal(normalizeAppearance({ theme: "dark" }).version, APPEARANCE_VERSION);
  const high = normalizeAppearance({ version: 99, theme: "dark" });
  assert.equal(high.unknownVersion, true);
  assert.deepEqual(high.settings, defaultAppearance());
});

test("文件缺失时读取默认配置，revision 为 0", async (t) => {
  const dir = await makeTmpDir(t);
  const file = path.join(dir, "appearance.json");
  const result = await readAppearance(file);
  assert.equal(result.ok, true);
  assert.equal(result.source, "default");
  assert.equal(result.revision, 0);
  assert.deepEqual(result.settings, defaultAppearance());
});

test("保存后读取往返一致，revision 递增", async (t) => {
  const dir = await makeTmpDir(t);
  const file = path.join(dir, "appearance.json");
  const saved = await saveAppearance(file, { theme: "dark", background: { lightColor: "#FFF" } });
  assert.equal(saved.ok, true);
  assert.equal(saved.revision, 1);
  assert.equal(saved.settings.theme, "dark");
  assert.equal(saved.settings.background.lightColor, "#ffffff");

  const read = await readAppearance(file);
  assert.equal(read.source, "file");
  assert.equal(read.revision, 1);
  assert.deepEqual(read.settings, saved.settings);

  const saved2 = await saveAppearance(file, { theme: "light" }, 1);
  assert.equal(saved2.ok, true);
  assert.equal(saved2.revision, 2);
  assert.equal((await readAppearance(file)).revision, 2);
});

test("expectedRevision 过期时拒绝写入且文件不变", async (t) => {
  const dir = await makeTmpDir(t);
  const file = path.join(dir, "appearance.json");
  await saveAppearance(file, { theme: "dark" });
  const stale = await saveAppearance(file, { theme: "light" }, 0);
  assert.equal(stale.ok, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.revision, 1);
  assert.equal(stale.settings.theme, "dark");
  const onDisk = await readAppearance(file);
  assert.equal(onDisk.settings.theme, "dark");
  assert.equal(onDisk.revision, 1);
});

test("expectedRevision 匹配时正常保存，非数字忽略", async (t) => {
  const dir = await makeTmpDir(t);
  const file = path.join(dir, "appearance.json");
  await saveAppearance(file, { theme: "dark" });
  const ok = await saveAppearance(file, { theme: "light" }, 1);
  assert.equal(ok.ok, true);
  const ignored = await saveAppearance(file, { theme: "system" }, "abc");
  assert.equal(ignored.ok, true);
});

test("磁盘上更高版本时不覆盖原文件", async (t) => {
  const dir = await makeTmpDir(t);
  const file = path.join(dir, "appearance.json");
  await fs.writeFile(file, JSON.stringify({ version: 99, futureField: "keep-me" }), "utf8");
  const read = await readAppearance(file);
  assert.equal(read.unknownVersion, true);
  const saved = await saveAppearance(file, { theme: "dark" });
  assert.equal(saved.ok, false);
  assert.equal(saved.unknownVersion, true);
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(raw.version, 99);
  assert.equal(raw.futureField, "keep-me");
});

test("保存请求本身是高版本时也拒绝", async (t) => {
  const dir = await makeTmpDir(t);
  const file = path.join(dir, "appearance.json");
  const saved = await saveAppearance(file, { version: 99, theme: "dark" });
  assert.equal(saved.ok, false);
  assert.equal(saved.unknownVersion, true);
  await assert.rejects(fs.access(file));
});

test("损坏文件恢复为默认并生成 .bak 备份", async (t) => {
  const dir = await makeTmpDir(t);
  const file = path.join(dir, "appearance.json");
  await fs.writeFile(file, "{ not json !!!", "utf8");
  const read = await readAppearance(file);
  assert.equal(read.ok, true);
  assert.equal(read.source, "recovered");
  assert.deepEqual(read.settings, defaultAppearance());
  const entries = await fs.readdir(dir);
  const backups = entries.filter((name) => name.startsWith("appearance.json.bak-"));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(dir, backups[0]), "utf8"), "{ not json !!!");
  await assert.rejects(fs.access(file));
});

test("结构非法（数组/字符串）同样恢复为默认", async (t) => {
  const dir = await makeTmpDir(t);
  const file = path.join(dir, "appearance.json");
  await fs.writeFile(file, JSON.stringify([1, 2, 3]), "utf8");
  const read = await readAppearance(file);
  assert.equal(read.source, "recovered");
  assert.deepEqual(read.settings, defaultAppearance());
});

test("保存失败后旧文件仍可读取", async (t) => {
  const dir = await makeTmpDir(t);
  const file = path.join(dir, "appearance.json");
  const first = await saveAppearance(file, { theme: "dark" });
  assert.equal(first.ok, true);
  // 只读目录让 POSIX 下临时文件写入失败；
  // Windows 下 chmod 目录无效，通过只读属性与文件句柄锁定使原子替换失败
  let lockHandle;
  await fs.chmod(dir, 0o555);
  if (process.platform === "win32") {
    try { await fs.chmod(file, 0o444); } catch {}
    try { lockHandle = await fs.open(file, "r+"); } catch {}
  }
  let saved;
  try {
    saved = await saveAppearance(file, { theme: "light" });
  } finally {
    if (lockHandle) {
      try { await lockHandle.close(); } catch {}
    }
    if (process.platform === "win32") {
      try { await fs.chmod(file, 0o666); } catch {}
    }
    await fs.chmod(dir, 0o755);
  }
  assert.equal(saved.ok, false);
  assert.equal(typeof saved.error, "string");
  const read = await readAppearance(file);
  assert.equal(read.settings.theme, "dark");
});

test("file 指向目录时保存失败且不抛出", async (t) => {
  const dir = await makeTmpDir(t);
  const saved = await saveAppearance(path.join(dir, "sub"), { theme: "dark" });
  // sub 不存在时会先成功创建目录再写；改用已存在的文件路径当目录来触发失败
  if (saved.ok) {
    const blocker = path.join(dir, "blocker");
    await fs.writeFile(blocker, "occupied", "utf8");
    const failed = await saveAppearance(path.join(blocker, "appearance.json"), { theme: "dark" });
    assert.equal(failed.ok, false);
  } else {
    assert.equal(typeof saved.error, "string");
  }
});

test("连续保存串行执行，revision 不倒序", async (t) => {
  const dir = await makeTmpDir(t);
  const file = path.join(dir, "appearance.json");
  const results = await Promise.all([
    saveAppearance(file, { theme: "dark" }),
    saveAppearance(file, { theme: "light" }),
    saveAppearance(file, { theme: "system" }),
  ]);
  const revisions = results.filter((r) => r.ok).map((r) => r.revision);
  assert.deepEqual([...revisions].sort((a, b) => a - b), [1, 2, 3]);
  const final = await readAppearance(file);
  assert.equal(final.revision, 3);
});

// ---- 平台能力 ----

test("macOS 能力：vibrancy 可用", () => {
  const caps = getAppearanceCapabilities({ platform: "darwin" });
  assert.deepEqual(caps.systemBackdrop, { available: true, kind: "vibrancy", reason: null });
  assert.equal(caps.glassDefault, "standard");
  assert.equal(caps.backdropFilter, true);
});

test("Windows 11 22H2+ 支持背景材质，旧版本降级", () => {
  const win11 = getAppearanceCapabilities({ platform: "win32", osRelease: "10.0.22621" });
  assert.deepEqual(win11.systemBackdrop, { available: true, kind: "background-material", reason: null });
  const win10 = getAppearanceCapabilities({ platform: "win32", osRelease: "10.0.19045" });
  assert.equal(win10.systemBackdrop.available, false);
  assert.match(win10.systemBackdrop.reason, /不支持系统背景材质/);
  const unparsable = getAppearanceCapabilities({ platform: "win32", osRelease: "unknown" });
  assert.equal(unparsable.systemBackdrop.available, false);
});

test("Linux 能力：应用内玻璃，默认轻量", () => {
  const caps = getAppearanceCapabilities({ platform: "linux", isLinux: true });
  assert.equal(caps.systemBackdrop.available, false);
  assert.equal(caps.systemBackdrop.kind, null);
  assert.match(caps.systemBackdrop.reason, /应用内玻璃效果/);
  assert.equal(caps.glassDefault, "lightweight");
});

test("硬件加速关闭时 backdropFilter 不可用并给出原因", () => {
  const caps = getAppearanceCapabilities({ platform: "darwin", hwAcceleration: false });
  assert.equal(caps.backdropFilter, false);
  assert.match(caps.backdropFilterReason, /硬件加速/);
  const linuxCaps = getAppearanceCapabilities({ platform: "linux", hwAcceleration: false });
  assert.equal(linuxCaps.backdropFilter, false);
  assert.equal(linuxCaps.backdropFilter, false);
});

test("applyWindowBackdrop：macOS 强度映射与总开关控制", () => {
  const caps = getAppearanceCapabilities({ platform: "darwin" });
  const calls = [];
  const stub = { setVibrancy: (value) => calls.push(["setVibrancy", value]) };

  // 必须同时开启玻璃总开关 enabled: true
  const subtle = applyWindowBackdrop(stub, { glass: { enabled: true, systemBackdrop: true, strength: "subtle" } }, caps);
  assert.deepEqual(subtle, { ok: true, applied: "vibrancy" });
  assert.deepEqual(calls.pop(), ["setVibrancy", "sidebar"]);

  const strong = applyWindowBackdrop(stub, { glass: { enabled: true, systemBackdrop: true, strength: "strong" } }, caps);
  assert.equal(strong.applied, "vibrancy");
  assert.deepEqual(calls.pop(), ["setVibrancy", "under-window"]);

  // 玻璃总开关关闭时即使 systemBackdrop: true 也不生效
  const disabled = applyWindowBackdrop(stub, { glass: { enabled: false, systemBackdrop: true } }, caps);
  assert.deepEqual(disabled, { ok: true, applied: "none" });
  assert.deepEqual(calls.pop(), ["setVibrancy", null]);
});

test("applyWindowBackdrop：Windows 材质映射与不调用旧系统", () => {
  const win11 = getAppearanceCapabilities({ platform: "win32", osRelease: "10.0.22631" });
  const calls = [];
  const stub = { setBackgroundMaterial: (value) => calls.push(value) };
  const acrylic = applyWindowBackdrop(stub, { glass: { enabled: true, systemBackdrop: true, strength: "standard" } }, win11);
  assert.equal(acrylic.applied, "background-material");
  assert.deepEqual(calls, ["acrylic"]);
  applyWindowBackdrop(stub, { glass: { enabled: true, systemBackdrop: true, strength: "strong" } }, win11);
  assert.deepEqual(calls, ["acrylic", "mica"]);

  // 不支持的 Windows：不调用 setBackgroundMaterial
  const win10 = getAppearanceCapabilities({ platform: "win32", osRelease: "10.0.19045" });
  calls.length = 0;
  const result = applyWindowBackdrop(stub, { glass: { enabled: true, systemBackdrop: true } }, win10);
  assert.equal(result.applied, "none");
  assert.deepEqual(calls, []);
});

test("applyWindowBackdrop：未启用时清除效果", () => {
  const caps = getAppearanceCapabilities({ platform: "darwin" });
  const calls = [];
  const stub = {
    setVibrancy: (value) => calls.push(["setVibrancy", value]),
    setBackgroundMaterial: (value) => calls.push(["setBackgroundMaterial", value]),
  };
  const result = applyWindowBackdrop(stub, { glass: { enabled: true, systemBackdrop: false } }, caps);
  assert.deepEqual(result, { ok: true, applied: "none" });
  assert.deepEqual(calls, [["setVibrancy", null]]);

  // Windows 11 上清除会调用 setBackgroundMaterial("none")
  const win11 = getAppearanceCapabilities({ platform: "win32", osRelease: "10.0.22621" });
  calls.length = 0;
  applyWindowBackdrop(stub, { glass: { enabled: true, systemBackdrop: false } }, win11);
  assert.deepEqual(calls, [["setBackgroundMaterial", "none"]]);
});

test("applyWindowBackdrop：窗口方法抛错时回退 none", () => {
  const caps = getAppearanceCapabilities({ platform: "darwin" });
  const stub = { setVibrancy: () => { throw new Error("not supported"); } };
  const result = applyWindowBackdrop(stub, { glass: { enabled: true, systemBackdrop: true } }, caps);
  assert.equal(result.ok, false);
  assert.equal(result.applied, "none");
  assert.match(result.reason, /not supported/);
});

test("applyWindowBackdrop：空窗口对象不调用任何方法", () => {
  const caps = getAppearanceCapabilities({ platform: "darwin" });
  const result = applyWindowBackdrop({}, { glass: { enabled: true, systemBackdrop: true } }, caps);
  assert.deepEqual(result, { ok: true, applied: "none" });
});

test("windowBackgroundFor：自定义色、默认底色与系统材质透出", () => {
  assert.equal(windowBackgroundFor(null, "light"), "#f7f7f4");
  assert.equal(windowBackgroundFor(null, "dark"), "#181916");
  const appearance = { background: { lightColor: "#ABCDEF", darkColor: "#102030" } };
  assert.equal(windowBackgroundFor(appearance, "light"), "#abcdef");
  assert.equal(windowBackgroundFor(appearance, "dark"), "#102030");
  // 系统材质激活时必须返回透明色
  assert.equal(windowBackgroundFor(appearance, "light", true), "#00000000");
  assert.equal(windowBackgroundFor(appearance, "dark", true), "#00000000");
  assert.equal(windowBackgroundFor({ background: { lightColor: "red" } }, "light"), "#f7f7f4");
});

// ---- 第二轮验收回归：R1 ~ R4 ----

test("R1: 主进程与渲染端契约在取消预览时返回已保存的系统材质 effective", async () => {
  const mainSrc = await fs.readFile(path.join(process.cwd(), "electron/main.mts"), "utf8");
  assert.match(mainSrc, /appearance:cancel-preview[\s\S]*?effective:\s*appearanceEffective/);
  const controllerSrc = await fs.readFile(path.join(process.cwd(), "src/appearance/controller.ts"), "utf8");
  assert.match(controllerSrc, /savedEffective:\s*AppearanceEffectiveState/);
  assert.match(controllerSrc, /effective:\s*restoredEffective/);
});

test("R2: 应急恢复外观时立即清除旧预览防抖定时器并递增会话代次", async () => {
  const controllerSrc = await fs.readFile(path.join(process.cwd(), "src/appearance/controller.ts"), "utf8");
  assert.match(controllerSrc, /onAppearanceReset[\s\S]*?clearTimeout\(previewTimer\)/);
  assert.match(controllerSrc, /onAppearanceReset[\s\S]*?previewTimer = null/);
  assert.match(controllerSrc, /onAppearanceReset[\s\S]*?sessionEpoch\+\+/);
});

test("R3: Linux 初始化保留全局应用菜单以保留应急恢复入口，仅隐藏窗口菜单栏", async () => {
  const mainSrc = await fs.readFile(path.join(process.cwd(), "electron/main.mts"), "utf8");
  assert.doesNotMatch(mainSrc, /createWindow[\s\S]*?Menu\.setApplicationMenu\(null\)/);
  assert.match(mainSrc, /mainWindow\.setMenuBarVisibility\(false\)/);
  assert.match(mainSrc, /mainWindow\.autoHideMenuBar = true/);
  assert.match(mainSrc, /CmdOrCtrl\+Alt\+R/);
});

test("R4: 聊天正文、用户气泡、编辑器与样例区基数字号统一为 16px", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "src/appearance/appearance.css"), "utf8");
  assert.match(css, /\.markdown-content\s*\{[\s\S]*?font-size:\s*calc\(16px \* var\(--font-content-scale/);
  assert.match(css, /\.user-bubble\s*\{[\s\S]*?font-size:\s*calc\(16px \* var\(--font-content-scale/);
  assert.match(css, /\.markdown-live-editor\s*\{[\s\S]*?font-size:\s*calc\(16px \* var\(--font-content-scale/);
  assert.match(css, /\.appearance-sample-content\s*\{[\s\S]*?font-size:\s*calc\(16px \* var\(--font-content-scale/);
});

test("防残影保护：系统背景下未设置背景图时通配禁用页面级 backdrop-filter 且 settings-nav 不参与玻璃模糊", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "src/appearance/appearance.css"), "utf8");
  assert.match(css, /html\[data-system-backdrop="true"\]:not\(\[data-has-bg-image="true"\]\)\s*\*[\s\S]*?backdrop-filter:\s*none\s*!important/);
  assert.doesNotMatch(css, /html\[data-glass\][\s\S]*?\.settings-nav/);
  const mainSrc = await fs.readFile(path.join(process.cwd(), "electron/main.mts"), "utf8");
  assert.match(mainSrc, /applyWindowAppearance[\s\S]*?mainWindow\.webContents\?\.invalidate\?\.\(\)/);
});

test("顶栏与标题栏背景随透明度与面板色联动（data-translucent 下避免重复叠加底色）", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "src/appearance/appearance.css"), "utf8");
  assert.match(css, /html\[data-translucent="true"\]\s*\.topbar[\s\S]*?background:\s*transparent/);
  assert.match(css, /html\[data-translucent="true"\]\s*\.titlebar[\s\S]*?background:\s*var\(--sidebar\)/);
});

test("macOS 液态玻璃效果：main-panel 参与毛玻璃模糊，背景图带有景深平滑与文本可读性微阴影", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "src/appearance/appearance.css"), "utf8");
  assert.match(css, /html\[data-glass\][\s\S]*?\.main-panel[\s\S]*?backdrop-filter:\s*blur/);
  assert.match(css, /html\[data-has-bg-image="true"\]\s*\.appearance-backdrop::before[\s\S]*?filter:\s*blur/);
  assert.match(css, /html\[data-has-bg-image="true"\]\s*\.markdown-content[\s\S]*?text-shadow/);
});

test("透明卡片不嵌套毛玻璃，避免系统材质和背景图组合下重新出现实色块", async () => {
  const css = (await fs.readFile(path.join(process.cwd(), "src/appearance/appearance.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const inner = /\.(?:topbar|composer-card|new-task-button|plan-card|tool-summary)\b/;
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  const blurred = rules.filter(([, , body]) => /backdrop-filter:\s*blur/.test(body));
  assert.ok(blurred.some(([, selector]) => selector.includes(".main-panel")));
  assert.ok(blurred.every(([, selector]) => !inner.test(selector)), "内层控件不能再次模糊父面板");
  for (const name of ["topbar", "composer-card", "new-task-button", "plan-card", "tool-summary"]) {
    assert.ok(rules.some(([, selector, body]) => selector.includes(`html[data-translucent="true"] .${name}`) && /backdrop-filter:\s*none/.test(body)), `${name} 应取消默认毛玻璃`);
  }
});

test("托底色派生：--card-raised 比 --card 更实且单调不减，玻璃下同样抬升", () => {
  const alphaOf = (value) => Number(/rgba\([\d.]+, [\d.]+, [\d.]+, ([\d.]+)\)/.exec(value)[1]);
  const rgbOf = (value) => /^rgba\(([\d.]+, [\d.]+, [\d.]+),/.exec(value)[1];
  const mid = derivePalette({ background: { transparency: 50 } }, "light");
  assert.equal(rgbOf(mid["--card-raised"]), rgbOf(mid["--card"]), "托底色与卡片色同色");
  assert.equal(alphaOf(mid["--card"]), 0.5);
  assert.equal(alphaOf(mid["--card-raised"]), 0.85);
  const opaque = derivePalette({ background: { lightColor: "#336699", darkColor: "#336699", transparency: 0 } }, "light");
  assert.equal(alphaOf(opaque["--card-raised"]), 1, "无透明度时托底不降低不透明度");
  const glass = derivePalette({ background: { transparency: 50 } }, "light", { glass: true });
  assert.ok(alphaOf(glass["--card-raised"]) > alphaOf(glass["--card"]));
});

test("输入框与悬浮层托底：data-translucent 下输入框/toast/排队卡用加浓卡片色，不再强制透明", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "src/appearance/appearance.css"), "utf8");
  assert.match(css, /html\[data-translucent="true"\]\s*\.composer-card\s*\{[^}]*background:\s*var\(--card-raised, var\(--card\)\)/);
  assert.match(css, /html\[data-translucent="true"\]\s*\.status-toast,\s*html\[data-translucent="true"\]\s*\.queue-card\s*\{[^}]*background:\s*var\(--card-raised, var\(--card\)\)/);
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  assert.ok(
    !rules.some(([, selector, body]) => selector.includes(".composer-card") && /background:\s*transparent/.test(body)),
    "输入框不允许再被置为全透明",
  );
});
