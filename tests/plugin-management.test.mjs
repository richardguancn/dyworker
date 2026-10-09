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
    `export const inject = ["sessionPersistence"];\nexport function apply() {}\nexport default { name: "needs-projection", inject, apply };`, "utf8");

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
  assert.ok(String(calls[0].command).endsWith("npm-cli.js"), `应优先使用应用自带 npm，实际 ${calls[0].command}`);
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

test("应用自带包管理器在 PATH 没有 Node/npm 时完成安装，且不执行安装脚本", async (t) => {
  const { resolveNpmPath, spawnRunner, hostPackageDir } = await import("../electron/host/plugin-install.mts");
  const root = await tempDir(t);
  const source = path.join(root, "source");
  const profile = path.join(root, "profile");
  const marker = path.join(root, "script-ran");
  await fs.mkdir(source);
  await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, "package.json"), JSON.stringify({ name: "clean-profile", private: true }));
  await fs.writeFile(path.join(source, "package.json"), JSON.stringify({ name: "clean-plugin", version: "1.2.3",
    scripts: { prepare: `node -e "require('fs').writeFileSync('script-ran','bad')"` } }));
  await fs.writeFile(path.join(source, "index.js"), "module.exports = 'original-package';");
  const command = await resolveNpmPath({ env: { PATH: "", NVM_DIR: path.join(root, "missing") }, loginPath: "" });
  assert.equal(command, path.join(hostPackageDir("npm"), "bin", "npm-cli.js"));
  const result = await spawnRunner(command, ["install", "--prefix", profile, "--ignore-scripts", "--no-audit", "--no-fund", source], {
    cwd: profile, env: { PATH: "", HOME: root, SystemRoot: process.env.SystemRoot,
      npm_config_userconfig: path.join(root, "empty.npmrc"), npm_config_cache: path.join(root, "cache") }, timeoutMs: 30_000 });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(await fs.readFile(path.join(profile, "node_modules", "clean-plugin", "package.json"))).version, "1.2.3");
  assert.equal(await fs.readFile(path.join(profile, "node_modules", "clean-plugin", "index.js"), "utf8"), "module.exports = 'original-package';");
  await assert.rejects(fs.access(marker), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(source, "script-ran")), { code: "ENOENT" });
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

test("脚本策略：所有来源默认不跑安装脚本，源码包应提供预先构建的产物", async () => {
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
  assert.ok(git.args.includes("--ignore-scripts"), "git 来源也不能在检查前执行 prepare");
  assert.equal(git.result.ranInstallScripts, false);
});

test("安装源：自定义地址走 --registry，非法地址明确报错", async () => {
  const { installPackageIntoProfile, resolveNpmRegistry } = await import("../electron/host/plugin-install.mts");
  // 解析
  assert.equal(resolveNpmRegistry("default", null), "https://registry.npmjs.org");
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
  assert.match(info.entries[0].url, /^dyworker-plugin:\/\/client\/with-client\/0\?rev=/);

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

test("插件 HTTP 路由服务：可派发和列出，注销后不可调用且不共享全局表", async () => {
  const { ConnectionService, clearPluginRoutes, listPluginRoutes } = await import("../electron/host/services/connection.mts");
  const { Context } = await import("@deepseek-ai/cordis");
  const ctx = new Context();
  const service = new ConnectionService(ctx);

  // DSH 插件全部走 connection.fetch.register 注册路由，门面必须在
  // （处理函数字段名是 fetch，路由表在模块级——两处都踩过坑，见 connection.mts 注释）
  assert.equal(typeof service.fetch.register, "function");
  assert.equal(typeof service.register, "function");
  assert.equal(typeof service.dispatch, "function");

  const off = service.fetch.register({
    path: "/api/demo/ping",
    methods: ["POST"],
    requestBody: "buffered",
    // 注意：DSH 插件的处理函数字段名就是 fetch（不是 handler）
    fetch: () => Response.json({ ok: true, from: "demo" }, { headers: { "cache-control": "no-store" } }),
  });
  assert.deepEqual(service.list(), ["POST /api/demo/ping"]);
  assert.equal(service.routes.length, 1, "routes 只读视图要反映注册表（不能是静态空数组）");

  const ok = await service.dispatch({ path: "/api/demo/ping", method: "POST", body: "{}" });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { ok: true, from: "demo" });
  assert.equal(ok.headers["cache-control"], "no-store", "响应头要透传回去");

  // 方法不匹配 / 路径不存在：如实 404，不伪造成功
  assert.equal((await service.dispatch({ path: "/api/demo/ping", method: "GET" })).status, 404);
  assert.equal((await service.dispatch({ path: "/api/nope", method: "POST" })).status, 404);

  // handler 抛错：500 + 错误信息，不把宿主带崩
  const throwing = service.register({ path: "/api/demo/boom", methods: ["POST"], fetch: () => { throw new Error("炸了"); } });
  const failed = await service.dispatch({ path: "/api/demo/boom", method: "POST" });
  assert.equal(failed.status, 500);
  assert.match(failed.body, /炸了/);
  throwing();

  // 路由注册是**粘性**的：cordis 的 inject fiber 重启会把 effect 的 disposer 调一遍，
  // 若在这里注销，插件的路由永远留不住（实测"注册→立刻注销"循环）。真正卸载走 clearPluginRoutes。
  await off();
  assert.equal((await service.dispatch({ path: "/api/demo/ping", method: "POST" })).status, 404);
  assert.deepEqual(listPluginRoutes(), [], "服务实例不能写入全局注册表");
  await ctx.fiber.dispose();
});

test("会话投影：把我们的消息流折成 DSH 的 contextTimeline 状态（字段形状对齐消费端）", async () => {
  const { foldContextTimeline, CONTEXT_TIMELINE_KEY } = await import("../electron/host/services/projections.mts");

  // 空会话：如实"还没有投影"
  assert.equal(foldContextTimeline({ messages: [] }), undefined);
  assert.equal(foldContextTimeline({}), undefined);

  const session = {
    id: "s1",
    messages: [
      { role: "system", content: "你是助手" },
      { role: "user", content: "帮我看看这段代码" },
      { role: "assistant", content: "好的，我来分析", tool_calls: [{ function: { name: "read_file", arguments: "{}" } }] },
      { role: "tool", toolName: "read_file", content: "文件内容" },
      { role: "assistant", content: "分析完成" },
    ],
  };
  const state = foldContextTimeline(session);

  // 消费端（dsh-context 的 headFieldsOf/detailCollectionsOf）只读这些字段
  assert.deepEqual(Object.keys(state.sums).sort(), ["assistant", "inject", "skill", "tool", "user"]);
  assert.ok(state.systemTokens > 0, "系统提示词要单独计入");
  assert.ok(state.toolsTokens > 0, "工具结果计入工具占用");
  assert.ok(state.sums.user > 0 && state.sums.assistant > 0);
  assert.equal(state.requests.length, 2, "每条助手消息 = 一次请求");
  assert.deepEqual(state.requests.map((r) => r.turn), [1, 2]);
  assert.ok(state.requests.every((r) => typeof r.seq === "number" && typeof r.total === "number" && typeof r.prompt === "number"));
  assert.equal(state.turnRuns, 2);
  assert.ok(state.surface.length >= 4, "用户/助手/工具消息都要成为界面节点");
  assert.ok(state.surface.every((n) => typeof n.seq === "number" && typeof n.tokens === "number" && typeof n.cat === "string"));
  assert.equal(state.surface.find((n) => n.cat === "tool").tool, "read_file");
  // 四个集合必须是数组（客户端 recordsOnly 校验）
  for (const key of ["events", "archived", "fileOps", "spans"]) assert.ok(Array.isArray(state[key]), `${key} 要是数组`);
  assert.equal(state.detailRev, session.messages.length, "修订号随消息数变化，客户端据此重取详情");
  assert.equal(CONTEXT_TIMELINE_KEY, "contextTimeline");
});

test("会话投影：客户端线格式视图（客户端 timelineOf 校验要求 current 在顶层）", async () => {
  const { foldContextTimeline, timelineWireView } = await import("../electron/host/services/projections.mts");
  const state = foldContextTimeline({
    messages: [
      { role: "system", content: "系统提示" },
      { role: "user", content: "问题" },
      { role: "assistant", content: "回答" },
    ],
  });
  const view = timelineWireView(state);

  // 客户端校验：current 的 8 个字段都是有限数字 + 四个集合都是对象数组
  for (const key of ["system", "tools", "user", "inject", "skill", "assistant", "tool", "total"]) {
    assert.equal(typeof view.current[key], "number", `current.${key} 要是数字`);
    assert.ok(Number.isFinite(view.current[key]));
  }
  for (const key of ["requests", "events", "nodes", "archive"]) {
    assert.ok(Array.isArray(view[key]) && view[key].every((e) => e && typeof e === "object"), `${key} 要是对象数组`);
  }
  assert.equal(view.current.total, view.current.system + view.current.tools + view.current.user + view.current.assistant);
  assert.equal(view.counts.turns, 1);
  assert.equal(view.detailRev, 3);
  assert.equal(timelineWireView(undefined), null, "没有投影时如实返回 null");
});

test("会话读取是同步语义：DSH 插件按同步方式用 sessions.get(id)", async (t) => {
  const { ctx } = await hostWithManagement(t);
  // 契约要点：返回的是会话对象或 undefined，**不是 Promise**
  // （返回 Promise 会让插件拿到一个对象壳，投影永远算不出来——实测踩过）
  const missing = ctx.sessions.get("not-here");
  assert.equal(typeof missing?.then, "undefined", "不能返回 Promise");
  assert.equal(missing, undefined, "不存在的会话如实返回 undefined");
  assert.equal(typeof ctx.sessions.getAsync, "function", "需要异步语义时用 getAsync");
});

test("内置插件：目录扫描、默认启用、并在条目上打内置标记", async (t) => {
  const { createHost, disposeHost } = await import("../electron/host/context.mts");
  const { dshClientModuleNames } = await import("../electron/host/plugin-install.mts");

  // dsh.client.inject 声明的是客户端模块，也要纳入运行时依赖（排除 cordis：必须共用宿主同一份）
  assert.deepEqual(dshClientModuleNames({
    dsh: { client: { inject: ["@deepseek-ai/dsh-api-gateway/client", "@deepseek-ai/cordis", "react"] } },
  }), ["@deepseek-ai/dsh-api-gateway/client"]);
  assert.deepEqual(dshClientModuleNames({}), []);

  // 用**夹具**内置插件验证机制本身（不再依赖任何具体插件：原先内置的 DSH 轨迹插件已移除）
  const builtinRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-builtin-"));
  const builtinPkg = path.join(builtinRoot, "@acme", "builtin-demo");
  await fs.mkdir(path.join(builtinPkg, "lib"), { recursive: true });
  await fs.writeFile(path.join(builtinPkg, "package.json"), JSON.stringify({
    name: "@acme/builtin-demo", version: "1.0.0", main: "lib/index.js",
    exports: { ".": { default: "./lib/index.js" }, "./client": "./lib/client.js" },
    dsh: { client: { platform: "web", inject: [] } },
  }), "utf8");
  await fs.writeFile(path.join(builtinPkg, "lib", "index.js"), "export function apply() {}\n", "utf8");
  await fs.writeFile(path.join(builtinPkg, "lib", "client.js"), "window.__ModuleLoader__.load({ id: '@acme/builtin-demo', factory: () => ({}) });\n", "utf8");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-builtin-profile-"));
  const ctx = await createHost({
    userDataDir: dir,
    mountPlugins: true,
    builtinPluginsDir: builtinRoot,
    contracts: { ipcRegister: () => {}, ipcUnregister: () => {} },
  });
  try {
    const builtins = ctx.plugins.builtinPlugins();
    assert.ok(builtins.some((entry) => entry.name === "@acme/builtin-demo"),
      `应发现内置插件，实际：${JSON.stringify(builtins.map((e) => e.name))}`);

    const entry = ctx.plugins.entries().find((item) => item.name === "@acme/builtin-demo");
    assert.ok(entry, "内置插件应出现在条目里");
    assert.equal(entry.builtin, true, "要打上内置标记（界面据此显示「内置」）");
    assert.equal(entry.disabled, false, "内置插件默认启用");
    assert.equal(entry.active, true, `内置插件应已激活：${entry.error || ""}`);

    // 客户端半边从内置目录解析（它不在 npm 管理的插件目录里）
    const info = await ctx.plugins.clientBundles("@acme/builtin-demo");
    assert.equal(info.ok, true, info.error);
    assert.equal(info.entries?.[0]?.relative, "lib/client.js");
  } finally {
    await disposeHost(ctx);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(builtinRoot, { recursive: true, force: true });
  }
});

test("插件清单：只收录已验证的具体版本，支持搜索和安装判定", async () => {
  const { PLUGIN_CATALOG, filterCatalog, catalogSorted, isInstalled, isVerifiedEntry } = await import("../src/pluginCatalog.ts");
  assert.deepEqual(PLUGIN_CATALOG.map(p=>p.install).sort(),['@deepseek-ai/dsh-tool-todo@0.2.1-alpha.1','dsh-office-tools@1.0.5']);
  assert.equal(new Set(PLUGIN_CATALOG.map(p=>p.id)).size,PLUGIN_CATALOG.length);
  for(const plugin of PLUGIN_CATALOG){
    assert.equal(plugin.install,`${plugin.packageName}@${plugin.support.version}`);
    assert.ok(plugin.support.scope&&plugin.support.date&&plugin.displayName);
  }
  assert.equal(filterCatalog('excel')[0].packageName,'dsh-office-tools');
  assert.equal(filterCatalog('待办')[0].packageName,'@deepseek-ai/dsh-tool-todo');
  assert.equal(filterCatalog('', '政务公文').length,0);
  assert.equal(filterCatalog('这个肯定搜不到').length,0);
  assert.deepEqual(catalogSorted(),catalogSorted([...PLUGIN_CATALOG].reverse()));
  const plugin=PLUGIN_CATALOG.find(p=>p.packageName==='dsh-office-tools');
  const entry={id:'custom-id',name:'dsh-office-tools'};
  assert.equal(isInstalled(plugin,[entry]),true);
  assert.equal(isVerifiedEntry(entry,'1.0.5'),true);
  assert.equal(isVerifiedEntry(entry,'1.0.6'),false);
  assert.equal(isVerifiedEntry(entry,undefined),false);
  assert.equal(isVerifiedEntry({id:'unknown',name:'unknown'},'1.0.0'),false);
  assert.equal(isVerifiedEntry({id:plugin.id,name:'unknown'},'1.0.5'),false,'不能用相同显示编号冒充已验证包');
  assert.equal(isVerifiedEntry({id:'builtin',name:'builtin',builtin:true},undefined,[]),true);
  assert.equal(isVerifiedEntry(entry,'1.0.5',[]),false);
});

test("客户端模块闭包：扫客户端半边的 require，纯库模块回退主入口", async (t) => {
  const { createHost, disposeHost } = await import("../electron/host/context.mts");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-plan-"));
  const plugins = path.join(dir, "plugins");
  const mods = path.join(plugins, "node_modules", "@deepseek-ai");
  const write = async (rel, body) => {
    const file = path.join(mods, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  };
  // 纯库模块：没有 ./client 导出，只有主入口——但它是运行时必需
  await write("lib-lib/package.json", JSON.stringify({ name: "@deepseek-ai/lib-lib", version: "1.0.0", main: "lib/index.js" }));
  await write("lib-lib/lib/index.js", "exports.thing = 1;");
  // 两半都有的模块：require 写在客户端半边（lib/client.js），主入口是主机半边
  await write("mod-with-half/package.json", JSON.stringify({
    name: "@deepseek-ai/mod-with-half", version: "1.0.0", main: "lib/index.js",
    exports: { ".": { default: "./lib/index.js" }, "./client": { default: "./lib/client.js" } },
  }));
  await write("mod-with-half/lib/index.js", "exports.hostOnly = 1;");
  await write("mod-with-half/lib/client.js", 'module.exports = require("@deepseek-ai/lib-lib");');
  // 插件包放在 node_modules 根下（不是 @deepseek-ai/ 里）
  const pluginDir = path.join(plugins, "node_modules", "plugin-a");
  await fs.mkdir(path.join(pluginDir, "lib"), { recursive: true });
  await fs.writeFile(path.join(pluginDir, "package.json"), JSON.stringify({
    name: "plugin-a", version: "1.0.0", main: "lib/index.js",
    exports: { ".": { default: "./lib/index.js" } },
    dsh: { client: { platform: "web", inject: ["@deepseek-ai/mod-with-half"] } },
  }));
  await fs.writeFile(path.join(pluginDir, "lib", "index.js"), "exports.apply = () => {};");
  await fs.writeFile(path.join(plugins, "dyworker.yml"), "- id: plugin-a\n  name: plugin-a\n");

  const ctx = await createHost({
    userDataDir: dir,
    pluginsDir: plugins,
    mountPlugins: true,
    contracts: { ipcRegister: () => {}, ipcUnregister: () => {} },
  });
  try {
    const plan = await ctx.plugins.clientModulePlan("plugin-a");
    const specs = plan.ordered.map((node) => node.spec);
    // ① 客户端半边里的 require 必须被扫到（否则运行时"宿主未提供该模块"）
    assert.ok(specs.includes("@deepseek-ai/lib-lib"), `要扫到客户端半边的 require，实际：${JSON.stringify(specs)}`);
    // ② 纯库模块没有客户端半边，也要在计划里（回退主入口），不能被当成缺失丢掉
    const libNode = plan.ordered.find((node) => node.spec === "@deepseek-ai/lib-lib");
    assert.ok(libNode?.file.endsWith("lib/index.js"), `纯库模块要回退主入口：${libNode?.file}`);
    assert.deepEqual(plan.missing, [], "不该有缺失模块");
    // ③ 协议取文件也要能拿到纯库模块
    assert.ok(ctx.plugins.clientModuleFile("@deepseek-ai/lib-lib", 0).endsWith("lib/index.js"));
    // ④ 依赖在前：@deepseek-ai/lib-lib 要排在 @deepseek-ai/mod-with-half 之前
    assert.ok(specs.indexOf("@deepseek-ai/lib-lib") < specs.indexOf("@deepseek-ai/mod-with-half"), "依赖要先于使用者");
  } finally {
    await disposeHost(ctx);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("会话视图运行时：按 DSH 契约把会话事件折成视图快照", async () => {
  const { SessionViewRuntime } = await import("../src/pluginRuntime/sessionViewRuntime.ts");
  const { buildSessionEvents } = await import("../src/pluginRuntime/sessionEvents.ts");

  // ① 用**真实插件同款契约**造一个最小视图：每条助手消息装配成一个节点
  const runtime = new SessionViewRuntime();
  runtime.registerView({ target: "demo", create: () => {
    const nodes = new Map();
    return {
      apply({ upserts }) { for (const node of upserts) nodes.set(node.key, node); },
      replace({ nodes: list }) { nodes.clear(); for (const node of list) nodes.set(node.key, node); },
      snapshot() { return { nodes: [...nodes.values()] }; },
    };
  } });
  runtime.registerEvent({
    kind: "demo-assistant", target: "demo",
    match: (event) => (event.type === "assistant/message" ? { id: `t${event.data?.turn ?? 0}`, role: "update" } : null),
    start: () => ({ turns: 0 }),
    update: (context) => ({ turns: (context.state?.turns ?? 0) + 1 }),
    publication: () => "immediate",
    buildViewNode: (context) => ({ key: context.key, anchorSeq: context.matches[0]?.event?.seq ?? 0, turns: context.state.turns }),
  });

  const events = buildSessionEvents([
    { role: "system", content: "系统提示" },
    { role: "user", content: "你好" },
    { role: "assistant", content: "回答一" },
    { role: "user", content: "再来" },
    { role: "assistant", content: "回答二" },
  ]);
  // 事件映射要覆盖插件认的类型，seq 单调递增
  assert.ok(events.some((e) => e.type === "user/message"));
  assert.ok(events.some((e) => e.type === "assistant/message"));
  assert.ok(events.some((e) => e.type === "step/start"));
  assert.ok(events.some((e) => e.type === "turn/end"));
  for (let i = 1; i < events.length; i += 1) assert.ok(events[i].seq > events[i - 1].seq, "seq 要单调递增");

  runtime.ingest(events);
  const snapshots = runtime.snapshots();
  assert.deepEqual(runtime.targetsOf(), ["demo"]);
  assert.ok(snapshots.get("demo"), "要有 demo 快照");
  // 两条助手消息属于同一 target 但 key 不同……
  // 这里 key 都是 t0（映射里没给 turn），所以断言"至少装配出一个节点且有状态"
  assert.ok(snapshots.get("demo").nodes.length >= 1);

  // ② 定义抛错不能把运行时带崩
  const fragile = new SessionViewRuntime();
  fragile.registerView({ target: "fragile", create: () => ({ apply() { throw new Error("装配器炸了"); }, snapshot: () => ({ ok: true }) }) });
  fragile.registerEvent({ target: "fragile", match: () => ({ id: "x", role: "update" }), update: () => ({}), buildViewNode: () => ({ key: "x", anchorSeq: 1 }) });
  fragile.ingest([{ type: "user/message", seq: 1, time: 1, data: {} }]);
  assert.equal(fragile.snapshots().get("fragile").ok, true, "装配器抛错时要保留上一次快照");
});

test("会话事件形状：插件必读字段一个都不能缺（缺了就渲染崩）", async () => {
  const { buildSessionEvents } = await import("../src/pluginRuntime/sessionEvents.ts");
  const events = buildSessionEvents([
    { role: "user", content: "你好" },
    { role: "assistant", content: "回答", tool_calls: [{ id: "c1", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", toolName: "read_file", content: "文件内容" },
  ], { provider: "deepseek", model: "deepseek-chat" });

  const byType = (type) => events.filter((e) => e.type === type);
  // 助手事件：turn/step（key 靠它拼）、usage（finalNode 直读）、source（节点产出条件）
  const assistant = byType("assistant/message")[0];
  assert.equal(typeof assistant.data.turn, "number", "要有 turn");
  assert.equal(typeof assistant.data.step, "number", "要有 step");
  assert.ok(assistant.data.usage && typeof assistant.data.usage === "object", "要有 usage 对象");
  assert.equal(assistant.data.message.source.provider, "deepseek");
  assert.equal(assistant.data.message.source.model, "deepseek-chat");
  assert.ok(Array.isArray(assistant.data.message.content), "content 要是内容块数组（插件会遍历）");
  assert.equal(typeof assistant.data.message.id, "string", "要有 message.id");

  // 用户事件：顶层 content + source.kind（trajectory-input-message 直接读）
  const user = byType("user/message")[0];
  assert.ok(Array.isArray(user.data.content), "用户事件要有顶层 content 块数组");
  assert.equal(user.data.source.kind, "user");
  assert.equal(typeof user.data.id, "string");

  // 工具事件：call 与 result 的 callId 要能对上
  const call = byType("tool/call")[0];
  const result = byType("tool/result")[0];
  assert.equal(call.data.callId, "c1");
  assert.equal(result.data.message.source.callId, "c1", "结果的 callId 要与 call 对应");
  assert.ok(Array.isArray(result.data.message.content));

  // 每轮一个 turn/end，且 reason 必填（turn-end 定义读 data.reason.kind）
  const turnEnd = byType("turn/end")[0];
  assert.equal(typeof turnEnd.data.turn, "number");
  assert.equal(typeof turnEnd.data.reason.kind, "string");
});

test("版本查询沿用所选来源、筛选声明范围，不依赖版本列表顺序", async () => {
  const { newestVersion } = await import('../electron/host/plugin-install.mts');
  let received;
  const version = await newestVersion('@deepseek-ai/example', {
    npmPath: '/fake/npm', source: 'custom', customRegistry: 'https://packages.example.com/', range: '^1.0.0',
    run: async (command, args, options) => {
      received = { args, options };
      return { code: 0, stdout: JSON.stringify(['2.0.0', '1.5.0-rc.1', '1.0.0']), stderr: '' };
    },
  });
  assert.equal(version, '1.5.0-rc.1');
  assert.ok(received.args.includes('--registry=https://packages.example.com'));
  assert.ok(received.options.env.PATH.includes('/fake'));
});

test("安装自动修复残缺和过旧依赖，并递归补齐间接依赖", async (t) => {
  const { ctx, profile } = await hostWithManagement(t);
  const rootName = 'runtime-repair';
  const dep = '@deepseek-ai/repair-dep';
  const leaf = '@deepseek-ai/repair-leaf';
  const calls = [];
  let installDir = profile;
  const writePackage = async (name, version, source, peers = {}) => {
    const dir = path.join(installDir, 'node_modules', name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module', main: 'index.js', peerDependencies: peers }));
    await fs.writeFile(path.join(dir, 'index.js'), source);
  };
  // 旧包清单存在但入口已丢失，不能把它当成安装完成。
  await writePackage(dep, '0.0.1-rc.1', '');
  await fs.rm(path.join(profile, 'node_modules', dep, 'index.js'));
  const result = await ctx.plugins.installPackage({
    input: rootName, source: 'custom', customRegistry: 'https://packages.example.com', npmPath: '/fake/npm',
    run: async (command, args) => {
      calls.push(args);
      if (args[0] === 'view') return { code: 0, stdout: JSON.stringify(['0.0.1-rc.1', '1.0.0']), stderr: '' };
      installDir = args[args.indexOf('--prefix') + 1];
      const target = args.at(-1);
      if (target === rootName) await writePackage(rootName, '1.0.0', `import '${dep}'; export function apply(ctx) { globalThis.__repairApplied = true; }`, { [dep]: '>=1.0.0' });
      else if (target === `${dep}@1.0.0`) await writePackage(dep, '1.0.0', `import '${leaf}'; export const dependency = true;`, { [leaf]: '^1.0.0' });
      else if (target === `${leaf}@1.0.0`) await writePackage(leaf, '1.0.0', 'export const leaf = true;');
      else assert.fail(`unexpected target ${target}`);
      return { code: 0, stdout: 'installed', stderr: '' };
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(globalThis.__repairApplied, true);
  assert.deepEqual(result.dependencies.installed, [`${dep}@1.0.0`, `${leaf}@1.0.0`]);
  assert.ok(calls.every(args => args.includes('--registry=https://packages.example.com')));
  assert.ok(calls.filter(args => args[0] === 'install').every(args => args.includes('--ignore-scripts')));
  assert.ok(calls.filter(args => args[0] === 'install').every(args => args.includes('--legacy-peer-deps')));
});

test("只补实际使用的依赖，不递归下载声明的宿主服务", async (t) => {
  const { ctx, profile } = await hostWithManagement(t);
  const name = 'small-plugin';
  const dir = await writePluginPackage(profile, name);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  manifest.peerDependencies = { '@deepseek-ai/dsh-agent': '*', '@deepseek-ai/dsh-sandbox': '*', '@deepseek-ai/schemastery': '*' };
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(dir, 'index.mjs'), "import schema from '@deepseek-ai/schemastery'; export function apply() {};");
  const result = await ctx.plugins.ensureRuntimePeers(name, {
    run: async () => assert.fail('宿主已有公共库和未使用的服务都不应下载'),
  });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.installed, []);
  assert.ok(result.reused.includes('@deepseek-ai/schemastery'));
  assert.ok((await fs.lstat(path.join(profile, 'node_modules/@deepseek-ai/schemastery'))).isSymbolicLink());
});

test("客户端依赖只扫描客户端入口，不带入同包的后台依赖", async (t) => {
  const { ctx, profile } = await hostWithManagement(t);
  const root = await writePluginPackage(profile, 'client-only-dependency');
  const dep = '@deepseek-ai/browser-library';
  const helper = '@deepseek-ai/browser-helper';
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  manifest.dsh = { client: { entry: './client.js', inject: [dep] } };
  await fs.writeFile(path.join(root, 'client.js'), `require('${dep}'); require('react'); require('@deepseek-ai/dsh-client-ui-primitives');`);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
  const library = await writePluginPackage(profile, dep);
  const libraryManifest = JSON.parse(await fs.readFile(path.join(library, 'package.json'), 'utf8'));
  libraryManifest.exports = { '.': './index.mjs', './client': './client.js' };
  await fs.writeFile(path.join(library, 'package.json'), JSON.stringify(libraryManifest));
  await fs.writeFile(path.join(library, 'index.mjs'), "import '@deepseek-ai/dsh-sandbox';");
  await fs.writeFile(path.join(library, 'client.js'), `require('${helper}');`);
  const result = await ctx.plugins.ensureRuntimePeers('client-only-dependency', {
    run: async (command, args) => {
      if (args[0] === 'view') { assert.equal(args[1], helper); return { code: 0, stdout: '["1.0.0"]' }; }
      assert.equal(args.at(-1), `${helper}@1.0.0`);
      await writePluginPackage(profile, helper);
      return { code: 0, stdout: '' };
    },
  });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.installed, [`${helper}@1.0.0`]);
  assert.ok(result.reused.includes('react'));
  assert.ok(result.reused.includes('@deepseek-ai/dsh-client-ui-primitives'));
});

test("依赖下载失败回传真实原因和来源，不能强行启用或当成成功", async (t) => {
  const { ctx, profile } = await hostWithManagement(t);
  const name = 'dependency-failure';
  const result = await ctx.plugins.installPackage({
    input: name, source: 'cn', npmPath: '/fake/npm', allowIncompatible: true,
    run: async (command, args) => {
      if (args[0] === 'view') return { code: 1, stdout: '', stderr: 'network error' };
      const dir = await writePluginPackage(args[args.indexOf('--prefix') + 1], name);
      const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
      manifest.peerDependencies = { '@deepseek-ai/unavailable-dep': '^1.0.0' };
      await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(manifest));
      await fs.writeFile(path.join(dir, 'index.mjs'), "import '@deepseek-ai/unavailable-dep'; export function apply() {}");
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'dependencies');
  assert.equal(result.source.source, 'cn');
  assert.equal(result.source.kind, 'npm');
  assert.match(result.error, /unavailable-dep/);
  assert.deepEqual(ctx.plugins.entries(), []);
});

test("npm 冲突代码不会被长日志末尾淹没", async () => {
  const result = await installPackageIntoProfile({
    input: 'peer-conflict', dir: '/tmp/profile', npmPath: '/fake/npm',
    run: async () => ({ code: 1, stdout: '', stderr: 'npm error code ERESOLVE\n' + 'detail\n'.repeat(20) + 'npm error log file' }),
  });
  assert.match(result.error, /ERESOLVE/);
});

test("客户端 bundle 未声明的 require 依赖也会自动补齐", async (t) => {
  const { ctx, profile } = await hostWithManagement(t);
  const pkg = 'client-literal-install';
  const dep = '@deepseek-ai/literal-client-dep';
  const dir = await writePluginPackage(profile, pkg);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  manifest.dsh = { client: { platform: 'web' } };
  manifest.exports = { '.': './index.mjs', './client': './lib/client.js' };
  await fs.mkdir(path.join(dir, 'lib'));
  await fs.writeFile(path.join(dir, 'lib/client.js'), `require('${dep}');`);
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(manifest));
  const result = await ctx.plugins.ensureRuntimePeers(pkg, {
    npmPath: '/fake/npm', source: 'cn',
    run: async (command, args) => {
      assert.ok(args.includes('--registry=https://registry.npmmirror.com'));
      if (args[0] === 'view') return { code: 0, stdout: '["1.0.0"]' };
      assert.equal(args.at(-1), `${dep}@1.0.0`);
      await writePluginPackage(profile, dep);
      return { code: 0, stdout: '' };
    },
  });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.installed, [`${dep}@1.0.0`]);
});
