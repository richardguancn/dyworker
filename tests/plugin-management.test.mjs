// 插件管理：通道表面（plugins:*）+ 从包管理器装进 profile。
//
// 覆盖目标里的第 (4) 项：安装/启用/停用/配置/卸载/错误可见。
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHost, disposeHost } from "../electron/host/context.mts";
import { pluginsIpcPlugin } from "../electron/host/plugins/plugins-ipc.mts";
import { installPackageIntoProfile } from "../electron/host/plugin-install.mts";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-plugin-mgmt-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });
  return dir;
}

function fakeIpc() {
  const handlers = new Map();
  return {
    handlers,
    register(channel, handler) {
      if (handlers.has(channel)) throw new Error(`duplicate handler: ${channel}`);
      handlers.set(channel, handler);
    },
    unregister(channel) { handlers.delete(channel); },
  };
}

const pluginSource = (name) => `
export const name = ${JSON.stringify(name)};
export function apply(ctx, config) {
  globalThis.__log = globalThis.__log || [];
  globalThis.__log.push({ plugin: ${JSON.stringify(name)}, event: "apply" });
  ctx.effect(() => () => globalThis.__log.push({ plugin: ${JSON.stringify(name)}, event: "dispose" }));
}
export default { name: ${JSON.stringify(name)}, apply };
`;

async function writePluginPackage(profileDir, pkgName) {
  const pkgDir = path.join(profileDir, "node_modules", pkgName);
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, "package.json"), JSON.stringify({
    name: pkgName, version: "1.0.0", type: "module", main: "index.mjs",
  }, null, 2), "utf8");
  await fs.writeFile(path.join(pkgDir, "index.mjs"), pluginSource(pkgName), "utf8");
  return pkgDir;
}

async function hostWithManagement(t, extra = {}) {
  const dir = await tempDir(t);
  globalThis.__log = [];
  const ipc = fakeIpc();
  const ctx = await createHost({
    userDataDir: dir,
    mountPlugins: true,
    contracts: { ipcRegister: ipc.register, ipcUnregister: ipc.unregister, ...(extra.contracts || {}) },
  });
  ctx.plugin(pluginsIpcPlugin());
  await new Promise((resolve) => setTimeout(resolve, 150));
  t.after(async () => { await disposeHost(ctx); });
  return { dir, ctx, ipc, profile: path.join(dir, "plugins") };
}

const call = (ipc, channel, arg) => ipc.handlers.get(channel)({}, arg);

test("管理通道齐全，且都走契约层注册", async (t) => {
  const { ipc } = await hostWithManagement(t);
  const expected = [
    "plugins:list", "plugins:compatibility", "plugins:install", "plugins:install-package",
    "plugins:enable", "plugins:disable", "plugins:configure", "plugins:uninstall", "plugins:reload",
  ];
  for (const channel of expected) {
    assert.ok(ipc.handlers.has(channel), `缺少通道 ${channel}`);
  }
});

test("管理通道：列表 / 安装 / 启停 / 配置 / 卸载 全链路", async (t) => {
  const { ctx, ipc, profile } = await hostWithManagement(t);
  await writePluginPackage(profile, "mgmt-demo");

  // 初始为空
  let listed = await call(ipc, "plugins:list");
  assert.deepEqual(listed.entries, []);
  assert.equal(listed.status.count, 0);

  // 安装
  const installed = await call(ipc, "plugins:install", { spec: "mgmt-demo", id: "demo" });
  assert.equal(installed.ok, true, JSON.stringify(installed));
  listed = await call(ipc, "plugins:list");
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].id, "demo");
  assert.equal(listed.entries[0].active, true);
  assert.equal(listed.bundles.length, 1);

  // 停用 → 释放
  assert.equal((await call(ipc, "plugins:disable", "demo")).ok, true);
  assert.equal(globalThis.__log.filter((e) => e.event === "dispose").length, 1);
  assert.equal((await call(ipc, "plugins:list")).entries[0].active, false);

  // 重新启用
  assert.equal((await call(ipc, "plugins:enable", "demo")).ok, true);
  assert.equal((await call(ipc, "plugins:list")).entries[0].active, true);

  // 配置
  assert.equal((await call(ipc, "plugins:configure", { id: "demo", config: { a: 1 } })).ok, true);
  assert.deepEqual((await call(ipc, "plugins:list")).entries[0].config, { a: 1 });

  // 卸载（bundle 记录随之移除）
  assert.equal((await call(ipc, "plugins:uninstall", "mgmt-demo")).ok, true);
  listed = await call(ipc, "plugins:list");
  assert.deepEqual(listed.entries, []);
  assert.deepEqual(listed.bundles, []);
});

test("管理通道：真正缺失服务的插件被拒绝；同名语义不同的只标部分兼容", async (t) => {
  const { ipc, profile } = await hostWithManagement(t);

  // ① 依赖本宿主完全没有的服务 → inject 永不满足 → 拒绝安装
  const missingDir = path.join(profile, "node_modules", "needs-projection");
  await fs.mkdir(missingDir, { recursive: true });
  await fs.writeFile(path.join(missingDir, "package.json"), JSON.stringify({
    name: "needs-projection", version: "1.0.0", type: "module", main: "index.mjs",
  }), "utf8");
  await fs.writeFile(path.join(missingDir, "index.mjs"),
    `export const inject = ["sessionProjections"];\nexport function apply() {}\nexport default { name: "needs-projection", inject, apply };`, "utf8");

  const compat = await call(ipc, "plugins:compatibility", "needs-projection");
  assert.equal(compat.verdict, "unsupported");
  assert.match(compat.matrix, /needs-projection/);

  const refused = await call(ipc, "plugins:install", { spec: "needs-projection" });
  assert.equal(refused.ok, false);
  assert.equal(refused.incompatible, true);
  assert.ok(refused.matrix, "界面要能拿到矩阵文本");
  assert.deepEqual((await call(ipc, "plugins:list")).entries, []);

  // ② 只依赖同名但语义不同的 tools → 插件会 apply，标部分兼容并可显式安装
  const toolsDir = path.join(profile, "node_modules", "needs-tools");
  await fs.mkdir(toolsDir, { recursive: true });
  await fs.writeFile(path.join(toolsDir, "package.json"), JSON.stringify({
    name: "needs-tools", version: "1.0.0", type: "module", main: "index.mjs",
  }), "utf8");
  await fs.writeFile(path.join(toolsDir, "index.mjs"),
    `export const inject = ["tools"];\nexport function apply() {}\nexport default { name: "needs-tools", inject, apply };`, "utf8");

  const partial = await call(ipc, "plugins:compatibility", "needs-tools");
  assert.equal(partial.verdict, "partial", "同名语义不同只算部分兼容，不能当成不支持");
  assert.match(partial.matrix, /语义不同/);
});

test("管理通道：手工改过 dyworker.yml 后可以 reload", async (t) => {
  const { ctx, ipc, profile } = await hostWithManagement(t);
  await writePluginPackage(profile, "manual-demo");
  await fs.writeFile(path.join(profile, "dyworker.yml"),
    "# 手工编辑\n- id: manual\n  name: manual-demo\n", "utf8");
  const result = await call(ipc, "plugins:reload");
  assert.equal(result.ok, true);
  assert.equal(ctx.plugins.entries()[0].id, "manual");
  assert.equal(ctx.plugins.entries()[0].active, true);
});

test("管理通道：宿主销毁后插件注册的通道全部注销", async (t) => {
  const dir = await tempDir(t);
  const ipc = fakeIpc();
  const ctx = await createHost({
    userDataDir: dir,
    mountPlugins: true,
    contracts: { ipcRegister: ipc.register, ipcUnregister: ipc.unregister },
  });
  ctx.plugin(pluginsIpcPlugin());
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(ipc.handlers.size >= 9, `应注册管理通道，实际 ${ipc.handlers.size}`);

  await disposeHost(ctx);
  assert.equal(ipc.handlers.size, 0, "宿主销毁必须注销插件注册的全部通道（否则泄漏/二次注册撞崩）");
});

// ---- installPackageIntoProfile：装进 profile 的参数与安全默认 ----

test("安装到 profile：默认带 --ignore-scripts 与 --save-exact，并钉住版本", async () => {
  const calls = [];
  const result = await installPackageIntoProfile({
    dir: "/tmp/profile",
    spec: "demo-plugin",
    version: "1.2.3",
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return { code: 0, stdout: "added 1 package", stderr: "" };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.ok(String(calls[0].command).endsWith("npm"), `命令应是解析出的 npm 路径，实际 ${calls[0].command}`);
  assert.ok(calls[0].args.includes("--ignore-scripts"), "默认禁跑安装脚本");
  assert.ok(calls[0].args.includes("--save-exact"), "钉住版本");
  assert.ok(calls[0].args.includes("demo-plugin@1.2.3"), "安装的是指定版本");
  assert.ok(calls[0].args.includes("/tmp/profile"), "装进 profile 而不是别处");
  assert.equal(result.version, "1.2.3");
});

test("安装到 profile：可以显式允许安装脚本（少数需要编译的插件）", async () => {
  const calls = [];
  await installPackageIntoProfile({
    dir: "/tmp/profile",
    spec: "needs-build",
    ignoreScripts: false,
    run: async (command, args) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; },
  });
  assert.ok(!calls[0].includes("--ignore-scripts"), "显式关闭时不应带该参数");
});

test("安装到 profile：失败时报出退出码与末尾日志", async () => {
  const result = await installPackageIntoProfile({
    dir: "/tmp/profile",
    spec: "broken-plugin",
    run: async () => ({ code: 1, stdout: "", stderr: "npm ERR! 404 Not Found\nnpm ERR! broken-plugin" }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /退出码 1/);
  assert.match(result.error, /404/);
});

test("安装到 profile：包管理器不可用时给出可执行的替代路径", async () => {
  // 解析不到 npm（窄 PATH + 无候选路径）
  const unresolved = await installPackageIntoProfile({
    dir: "/tmp/profile", spec: "demo-plugin",
    npmPath: null,
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
  });
  if (!unresolved.ok) {
    assert.match(unresolved.error, /找不到包管理器/);
    assert.match(unresolved.error, /DYWORKER_NPM|node_modules/, "要告诉用户可以手动放包");
  } else {
    // 本机确实有 npm：走"能解析到"的分支
    assert.equal(unresolved.ok, true);
  }
  // 解析到了但执行失败（例如被权限拦下）→ 报出命令与原因
  const failed = await installPackageIntoProfile({
    dir: "/tmp/profile", spec: "demo-plugin", npmPath: "/definitely/not/executable",
    run: async () => { const error = new Error("spawn ENOENT"); error.code = "ENOENT"; throw error; },
  });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /无法执行包管理器/);
  assert.match(failed.error, /node_modules|DYWORKER_NPM/);
});

test("安装到 profile：超时被中止并说明", async () => {
  const result = await installPackageIntoProfile({
    dir: "/tmp/profile",
    spec: "slow-plugin",
    run: async () => ({ code: -1, stdout: "", stderr: "[超时] 超过 100ms 未结束，已中止" }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /超时|退出码/);
});

test("管理通道：启停/配置同时接受条目 id 与插件包名（避免界面传错）", async (t) => {
  const { ctx, ipc, profile } = await hostWithManagement(t);
  // 一个 bundle：包名与它插入的条目 id 不同
  const pkgDir = path.join(profile, "node_modules", "acme-plugin");
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, "package.json"), JSON.stringify({
    name: "acme-plugin", version: "2.0.0", type: "module", main: "index.mjs",
    dsh: { bundle: { patch: "./cordis.patch.yml" } },
  }, null, 2), "utf8");
  await fs.writeFile(path.join(pkgDir, "cordis.patch.yml"), "- insert:\n    - id: acme\n      name: acme-plugin\n", "utf8");
  await fs.writeFile(path.join(pkgDir, "index.mjs"), pluginSource("acme-plugin"), "utf8");

  assert.equal((await call(ipc, "plugins:install", { spec: "acme-plugin" })).ok, true);
  assert.equal(ctx.plugins.entries()[0].id, "acme");

  // 用包名停用 / 启用
  assert.equal((await call(ipc, "plugins:disable", "acme-plugin")).ok, true, "应接受插件包名");
  assert.equal(ctx.plugins.entries()[0].active, false);
  assert.equal((await call(ipc, "plugins:enable", "acme-plugin")).ok, true);
  assert.equal(ctx.plugins.entries()[0].active, true);

  // 用条目 id 配置
  assert.equal((await call(ipc, "plugins:configure", { id: "acme", config: { n: 1 } })).ok, true);
  assert.deepEqual(ctx.plugins.entries()[0].config, { n: 1 });

  // 都匹配不到时，错误里给出可用取值，界面能直接展示
  const missing = await call(ipc, "plugins:disable", "no-such-thing");
  assert.equal(missing.ok, false);
  assert.match(missing.error, /acme/);
});

test("npm 路径探测：Finder 启动的窄 PATH 下仍能找到 nvm/homebrew 里的 npm", async () => {
  const { resolveNpmPath } = await import("../electron/host/plugin-install.mts");
  const present = new Set([
    "/opt/homebrew/bin/npm",
    `${process.env.HOME}/.nvm/versions/node/v22.21.0/bin/npm`,
  ]);
  const exists = async (target) => present.has(target);

  // 窄 PATH（Finder 启动的典型值）里没有 npm，但候选路径能找到
  const found = await resolveNpmPath({ env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }, exists });
  assert.ok(found && found.endsWith("/npm"), `应找到 npm，实际 ${found}`);

  // 显式指定 / 环境变量优先
  assert.equal(await resolveNpmPath({ explicit: "/custom/npm", env: {}, exists }), "/custom/npm");
  assert.equal(await resolveNpmPath({ env: { DYWORKER_NPM: "/env/npm", PATH: "" }, exists }), "/env/npm");

  // 都没有时返回 null（调用方给出可执行的替代路径）
  assert.equal(await resolveNpmPath({ env: { PATH: "/nonexistent", NVM_DIR: "/nonexistent" }, exists: async () => false }), null);
});

// ---- 三种安装来源：包名 / GitHub 仓库 / 本地目录 ----

test("来源识别：包名 / GitHub / 本地目录 各自解析正确", async () => {
  const { parsePluginSource } = await import("../electron/host/plugin-install.mts");
  assert.deepEqual(parsePluginSource("dsh-context"), { kind: "npm", name: "dsh-context", version: "", raw: "dsh-context" });
  assert.deepEqual(parsePluginSource("@deepseek-ai/dsh-agent-instructions@0.1.3"),
    { kind: "npm", name: "@deepseek-ai/dsh-agent-instructions", version: "0.1.3", raw: "@deepseek-ai/dsh-agent-instructions@0.1.3" });

  const gh = parsePluginSource("https://github.com/bowenliang123/dsh-context");
  assert.equal(gh.kind, "github");
  assert.equal(gh.owner, "bowenliang123");
  assert.equal(gh.repo, "dsh-context");

  const ghTree = parsePluginSource("https://github.com/owner/repo/tree/main/packages/plugin");
  assert.equal(ghTree.kind, "github");
  assert.equal(ghTree.branch, "main");
  assert.equal(ghTree.subdir, "packages/plugin");

  const local = parsePluginSource("~/dev/my-plugin");
  assert.equal(local.kind, "local");
  assert.ok(local.path.startsWith("/"), "本地路径应展开为绝对路径");
  assert.equal(parsePluginSource("/abs/path/plugin").kind, "local");
});

test("GitHub 安装规格：直连 + 镜像前缀，子目录/分支写法带进 spec", async () => {
  const { githubInstallSpecs } = await import("../electron/host/plugin-install.mts");
  const direct = githubInstallSpecs({ owner: "o", repo: "r", branch: "", subdir: "" }, [""]);
  assert.deepEqual(direct, ["git+https://github.com/o/r.git"]);
  const mirrored = githubInstallSpecs({ owner: "o", repo: "r", branch: "main", subdir: "packages/p" },
    ["https://gitclone.com/", ""]);
  assert.equal(mirrored[0], "git+https://gitclone.com/github.com/o/r.git#main//packages/p");
  assert.equal(mirrored[1], "git+https://github.com/o/r.git#main//packages/p");
});

test("GitHub 安装：镜像源逐个回退，前面的失败不阻断后面的成功", async () => {
  const { installPackageIntoProfile } = await import("../electron/host/plugin-install.mts");
  const calls = [];
  const result = await installPackageIntoProfile({
    dir: "/tmp/profile",
    input: "https://github.com/owner/repo",
    source: "cn",
    npmPath: "/fake/npm",
    run: async (command, args) => {
      calls.push(args[args.length - 1]);
      if (calls.length < 4) return { code: 128, stdout: "", stderr: "fatal: unable to access" };
      return { code: 0, stdout: "added 1 package", stderr: "" };
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.kind, "github");
  assert.equal(calls.length, 4, "中国大陆镜像源共 4 个候选（3 个代理 + 直连），依次回退");
  assert.ok(calls[0].startsWith("git+https://ghfast.top/"), "先试第一个代理");
  assert.ok(calls[1].startsWith("git+https://gh-proxy.com/"), "再试第二个代理");
  assert.ok(calls[3].startsWith("git+https://github.com/owner/repo"), "最后直连 GitHub");
});

test("GitHub 安装：全部来源失败时给出逐个失败的明细", async () => {
  const { installPackageIntoProfile } = await import("../electron/host/plugin-install.mts");
  const result = await installPackageIntoProfile({
    dir: "/tmp/profile",
    input: "https://github.com/owner/repo",
    source: "cn",
    npmPath: "/fake/npm",
    run: async () => ({ code: 128, stdout: "", stderr: "fatal: could not resolve host" }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /所有安装源都失败/);
  assert.match(result.error, /ghfast|gh-proxy/);
});

test("npm 安装：中国大陆镜像源加 --registry，包名带版本钉住", async () => {
  const { installPackageIntoProfile } = await import("../electron/host/plugin-install.mts");
  const calls = [];
  const result = await installPackageIntoProfile({
    dir: "/tmp/profile",
    input: "dsh-context",
    version: "1.2.3",
    source: "cn",
    npmPath: "/fake/npm",
    run: async (command, args) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; },
  });
  assert.equal(result.ok, true);
  assert.ok(calls[0].includes("dsh-context@1.2.3"));
  assert.ok(calls[0].includes("--registry=https://registry.npmmirror.com"));
  assert.ok(calls[0].includes("--ignore-scripts"));
});

test("本地目录安装：直接把绝对路径交给 npm", async () => {
  const { installPackageIntoProfile } = await import("../electron/host/plugin-install.mts");
  const calls = [];
  const result = await installPackageIntoProfile({
    dir: "/tmp/profile",
    input: "/Users/someone/dev/my-plugin",
    npmPath: "/fake/npm",
    run: async (command, args) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "local");
  assert.equal(calls[0][calls[0].length - 1], "/Users/someone/dev/my-plugin");
});

test("装完能识别包名：git/本地来源靠 profile 依赖 diff", async () => {
  const { detectInstalledPackageName, readProfileDependencies } = await import("../electron/host/plugin-install.mts");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-install-"));
  try {
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "p", private: true, dependencies: { existing: "1.0.0" } }), "utf8");
    const before = await readProfileDependencies(dir);
    assert.deepEqual(before, { existing: "1.0.0" });

    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
      name: "p", private: true,
      dependencies: { existing: "1.0.0", "my-plugin": "git+https://github.com/o/r.git" },
    }), "utf8");
    assert.equal(await detectInstalledPackageName(dir, before), "my-plugin", "应识别出新装的包名");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("PATH 处理：保持用户登录 shell 的 PATH 顺序，npm 目录只追加到末尾", async () => {
  const { installPackageIntoProfile } = await import("../electron/host/plugin-install.mts");
  let captured = null;
  const loginPath = "/custom/nvm/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  const result = await installPackageIntoProfile({
    dir: "/tmp/profile",
    input: "some-plugin",
    npmPath: "/usr/local/bin/npm",
    loginPath,
    run: async (command, args, options) => {
      captured = options;
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.ok, true);
  const dirs = String(captured?.env?.PATH || "").split(":").filter(Boolean);
  const loginDirs = loginPath.split(":");
  assert.deepEqual(dirs.slice(0, loginDirs.length), loginDirs,
    "登录 shell 的顺序必须原样保留在最前面");
  assert.equal(dirs[0], "/custom/nvm/bin", "用户自己的 node 必须优先（GUI 应用的 PATH 里没有 nvm/Homebrew）");
  // 本质不变量：npm 目录绝不能排在用户登录 PATH 的目录之前
  // （提前会让 npm 去 spawn 该目录里可能跑不起来的 git，实测报 Unknown system error -86）。
  const finalIndex = dirs.indexOf("/usr/local/bin");
  assert.ok(finalIndex >= 0, "npm 目录必须在 PATH 里可达");
  assert.ok(finalIndex >= loginDirs.length,
    `npm 目录不得排到登录 PATH 之前（登录 PATH ${loginDirs.length} 项，实际位置 ${finalIndex}）`);
});

test("登录 shell PATH：从交互式 shell 取真实 PATH（GUI 应用的 PATH 不含 nvm/Homebrew）", async () => {
  const { resolveLoginShellPath, resetLoginPathCache } = await import("../electron/host/plugin-install.mts");
  resetLoginPathCache();
  const { EventEmitter } = await import("node:events");
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.emit("data", "some noise from rc\n");
      child.stdout.emit("data", "/Users/u/.nvm/versions/node/v22/bin:/opt/homebrew/bin:/usr/bin\n");
      child.emit("close", 0);
    });
    return child;
  };
  const loginPath = await resolveLoginShellPath({ shell: "/bin/zsh", spawn: fakeSpawn });
  assert.match(loginPath, /nvm\/versions\/node\/v22\/bin/, "应取到最后一行里的真实 PATH");
  assert.ok(!loginPath.includes("noise"), "shell rc 的其它输出要忽略");
  resetLoginPathCache();
});

test("包名识别：重复安装时 diff 为空，靠依赖 spec 匹配 / 仓库目录兜底", async () => {
  const { detectInstalledPackageName } = await import("../electron/host/plugin-install.mts");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-name-"));
  try {
    // ① 已存在（重复安装）：diff 为空，用 spec 匹配
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
      name: "p", private: true,
      dependencies: { "dsh-context": "github:bowenliang123/dsh-context" },
    }), "utf8");
    assert.equal(
      await detectInstalledPackageName(dir, { "dsh-context": "github:bowenliang123/dsh-context" },
        { rawInput: "https://github.com/bowenliang123/dsh-context" }),
      "dsh-context", "重复安装时应靠 spec 匹配识别");

    // ② 依赖里没有：按 git 仓库名去 node_modules 找包名
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "p", private: true, dependencies: {} }), "utf8");
    await fs.mkdir(path.join(dir, "node_modules", "my-repo"), { recursive: true });
    await fs.writeFile(path.join(dir, "node_modules", "my-repo", "package.json"),
      JSON.stringify({ name: "@scope/real-name", version: "1.0.0" }), "utf8");
    assert.equal(
      await detectInstalledPackageName(dir, {}, { parsed: { kind: "github", repo: "my-repo" }, rawInput: "https://github.com/o/my-repo" }),
      "@scope/real-name", "目录名与包名不一致时要读包的 package.json");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("脚本策略：注册表来源默认不跑安装脚本，git/本地来源必须允许（否则 TS 仓库没有构建产物）", async () => {
  const { installPackageIntoProfile } = await import("../electron/host/plugin-install.mts");
  const capture = async (input) => {
    const calls = [];
    const result = await installPackageIntoProfile({
      dir: "/tmp/profile", input, npmPath: "/fake/npm",
      run: async (command, args) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; },
    });
    return { args: calls[0], result };
  };

  const npm = await capture("dsh-context");
  assert.ok(npm.args.includes("--ignore-scripts"), "npm 包是构建好的产物，默认不跑脚本");
  assert.equal(npm.result.ranInstallScripts, false);

  const git = await capture("https://github.com/owner/repo");
  assert.ok(!git.args.includes("--ignore-scripts"), "git 来源需要 prepare 现场构建");
  assert.equal(git.result.ranInstallScripts, true);
});

test("安装源：自定义地址走 --registry，非法地址明确报错", async () => {
  const { installPackageIntoProfile, resolveNpmRegistry } = await import("../electron/host/plugin-install.mts");
  // 解析
  assert.equal(resolveNpmRegistry("default", null), null);
  assert.equal(resolveNpmRegistry("cn", null), "https://registry.npmmirror.com");
  assert.equal(resolveNpmRegistry("custom", "https://npm.corp.local/"), "https://npm.corp.local");
  assert.throws(() => resolveNpmRegistry("custom", ""), /不能为空/);
  assert.throws(() => resolveNpmRegistry("custom", "npm.corp.local"), /http:\/\/ 或 https:\/\//);

  // 安装参数
  const calls = [];
  const ok = await installPackageIntoProfile({
    dir: "/tmp/profile", input: "some-plugin", source: "custom", customRegistry: "https://npm.corp.local",
    npmPath: "/fake/npm",
    run: async (command, args) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; },
  });
  assert.equal(ok.ok, true);
  assert.ok(calls[0].includes("--registry=https://npm.corp.local"), "自定义源要真的传给 npm");

  // 非法地址在安装入口就被拒，不发起任何命令
  let ran = false;
  const bad = await installPackageIntoProfile({
    dir: "/tmp/profile", input: "some-plugin", source: "custom", customRegistry: "ftp://x",
    npmPath: "/fake/npm",
    run: async () => { ran = true; return { code: 0, stdout: "", stderr: "" }; },
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /http:\/\/ 或 https:\/\//);
  assert.equal(ran, false, "非法地址不应发起任何安装命令");
});

test("兼容矩阵不能漏报本宿主确实提供的服务（loader / tools）", async () => {
  const { classifyService, HOST_SERVICES } = await import("../electron/host/dsh-compat.mts");
  // 这两个服务宿主都挂了：loader 由官方 cordis-plugin-loader 提供，tools 由 ToolsService 提供。
  // 漏报会让本来能跑的插件被误判为"不支持"（dsh-better-sidebar 就因此被多报了两项）。
  assert.ok(HOST_SERVICES.includes("loader"), "loader 应计入宿主提供的服务（漏报会把能跑的插件误判为不支持）");
  assert.ok(HOST_SERVICES.includes("tools"), "tools 也应计入：宿主确实有同名服务，只是语义不同");
  // loader 用的是 DSH 同一个官方包 → 语义相同，属于真正可用
  assert.equal(classifyService("loader").state, "fulfilled");
  // tools 是宿主自己的插件工具注册表，与 DSH 的 agent 工具运行时不是一套 API →
  // 插件会 apply，但按 DSH API 调用会失败，所以是"同名语义不同"而不是"可用"
  assert.equal(classifyService("tools").state, "name-only");
  assert.match(classifyService("tools").reason, /语义不同/);
});

test("客户端半边：宿主能解析入口并给出协议 URL，路径不会越出包目录", async (t) => {
  const { ctx, profile } = await hostWithManagement(t);
  const pkgDir = path.join(profile, "node_modules", "with-client");
  await fs.mkdir(path.join(pkgDir, "lib"), { recursive: true });
  await fs.writeFile(path.join(pkgDir, "package.json"), JSON.stringify({
    name: "with-client", version: "2.1.0", type: "module", main: "index.mjs",
    exports: { ".": "./index.mjs", "./client": { types: "./lib/client.d.ts", default: "./lib/client.js" } },
    dsh: { client: { platform: "web", inject: ["@deepseek-ai/dsh-client-ui-sidebar-right"] } },
  }, null, 2), "utf8");
  await fs.writeFile(path.join(pkgDir, "lib", "client.js"), "// client bundle\n", "utf8");
  // 主机半边也要是可加载的：add() 在激活失败时会把条目从清单里移除
  await fs.writeFile(path.join(pkgDir, "index.mjs"),
    `export function apply() {}\nexport default { name: "with-client", apply };`, "utf8");
  const added = await ctx.plugins.add({ id: "with-client", name: "with-client" });
  assert.equal(added.ok, true, `条目应当加进清单：${added.error}`);

  const info = await ctx.plugins.clientBundles("with-client");
  assert.equal(info.ok, true, JSON.stringify(info));
  assert.equal(info.version, "2.1.0");
  assert.equal(info.platform, "web");
  assert.deepEqual(info.inject, ["@deepseek-ai/dsh-client-ui-sidebar-right"], "要把插件声明的客户端服务带出来（第 2 步据此接线）");
  assert.equal(info.entries.length, 1);
  assert.equal(info.entries[0].subpath, "./client");
  assert.equal(info.entries[0].relative, "lib/client.js");
  assert.equal(info.entries[0].primary, true);
  // URL 里只有条目 id 与序号——协议处理器再回到宿主解析真实路径，URL 本身没有文件路径可用
  assert.equal(info.entries[0].url, "dyworker-plugin://client/with-client/0");

  const file = await ctx.plugins.clientBundleFile("with-client", 0);
  // macOS 的 /var 是 /private/var 的软链，比较前统一取 realpath
  assert.equal(file, await fs.realpath(path.join(pkgDir, "lib", "client.js")), "协议处理器要拿到包内绝对路径");
  await assert.rejects(() => ctx.plugins.clientBundleFile("with-client", 9), /客户端入口不存在/);

  // 没有客户端半边的插件要给出明确原因，而不是空数组
  await writePluginPackage(profile, "host-only");
  await ctx.plugins.add({ id: "host-only", name: "host-only" });
  const none = await ctx.plugins.clientBundles("host-only");
  assert.equal(none.ok, false);
  assert.match(none.error, /没有声明客户端半边/);
});

test("DSH 插件 peer 运行时依赖：只挑 @deepseek-ai/*（排除 cordis），取最新发布版", async () => {
  const { dshPeerNames, newestVersion, linkHostCordis } = await import("../electron/host/plugin-install.mts");

  // 只挑 DSH 运行时包；cordis 必须用宿主同一份，不能装成独立副本
  assert.deepEqual(dshPeerNames({
    peerDependencies: {
      "@deepseek-ai/dsh-session": ">=0.1.5-rc.1",
      "@deepseek-ai/cordis": "^4.0.2",
      react: "^18.3.1",
      "@deepseek-ai/dsh-settings": ">=0.1.5-rc.1",
    },
  }), ["@deepseek-ai/dsh-session", "@deepseek-ai/dsh-settings"]);
  assert.deepEqual(dshPeerNames({}), []);

  // 最新发布版含 prerelease：这些包的 latest dist-tag 长期停在旧的 0.0.1-rc.1，
  // 直接 npm install 会装到过旧版本，所以要从 versions 列表取最后一个
  const calls = [];
  const version = await newestVersion("@deepseek-ai/dsh-session", {
    npmPath: "/fake/npm",
    run: async (command, args) => {
      calls.push(args);
      return { code: 0, stdout: JSON.stringify(["0.0.1-rc.1", "0.1.7-rc.2", "0.2.1-alpha.1"]), stderr: "" };
    },
  });
  assert.equal(version, "0.2.1-alpha.1");
  assert.ok(calls[0].includes("versions"), "要列全部版本而不是拿 latest 标签");
  assert.ok(calls[0].includes("--json"));

  // 拿不到版本时返回 null（调用方回落到"不指定版本"），不抛错
  const none = await newestVersion("@deepseek-ai/nope", {
    npmPath: "/fake/npm",
    run: async () => ({ code: 1, stdout: "", stderr: "ERR" }),
  });
  assert.equal(none, null);

  // cordis 软链：指向宿主同一份
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-link-"));
  try {
    const hostDir = path.join(dir, "host-cordis");
    await fs.mkdir(hostDir, { recursive: true });
    const profileDir = path.join(dir, "profile");
    await fs.mkdir(profileDir, { recursive: true });
    await linkHostCordis(profileDir, hostDir);
    const link = path.join(profileDir, "node_modules", "@deepseek-ai", "cordis");
    assert.equal(await fs.realpath(link), await fs.realpath(hostDir), "插件要解析到宿主同一份 cordis");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
