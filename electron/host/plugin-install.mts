// 把插件包装进 profile：调用包管理器在 <profile> 目录里安装，而不是去动 ~/.dsh。
//
// 安全默认：
//   - `--ignore-scripts`：**默认不跑安装脚本**（postinstall 是最常见的任意代码执行入口）；
//   - `--save-exact`：写死版本，配合锁定，避免"今天能跑明天换版"；
//   - `--no-audit --no-fund`：只为安装，不做多余网络往返；
//   - 限时：超时即中止并把命令原样报出来，方便人工重试。
//
// 可测性：包管理器调用以 `run` 注入（默认 spawn），测试可断言传了什么参数、
// 也可模拟失败，而不必真的联网。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";


/**
 * 向登录 shell 要真实的 PATH。
 *
 * 为什么必须这么做：macOS 上从 Finder/Dock 启动的 app 拿到的是极窄的 GUI PATH，
 * 里面既没有 nvm/Homebrew 的 node，也不含用户实际使用的 git。结果是：
 *   - 解析出的可能是 /usr/local 下 2023 年的旧 npm（11 之前，prepare git 依赖时会内部报错）；
 *   - 或 npm 找到了、但 PATH 里排在前面的 git 是 x86_64 的，spawn 直接 EBADARCH
 *     （真实报错：`spawn Unknown system error -86`）。
 * 登录 shell 的 PATH 才是用户真实环境，问一次并缓存。
 */
let cachedLoginPath = null;
export async function resolveLoginShellPath({ shell = process.env.SHELL || "/bin/zsh", spawn: spawnFn = spawn, timeoutMs = 6000 }: any = {}) {
  if (cachedLoginPath !== null) return cachedLoginPath;
  cachedLoginPath = "";
  try {
    const output = await new Promise((resolve) => {
      const child = spawnFn(shell, ["-lic", 'printf %s "$PATH"'], { stdio: ["ignore", "pipe", "ignore"] });
      let stdout = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill?.("SIGKILL");
        resolve("");
      }, timeoutMs);
      child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
      child.on("error", () => { if (!settled) { settled = true; clearTimeout(timer); resolve(""); } });
      child.on("close", () => { if (!settled) { settled = true; clearTimeout(timer); resolve(stdout); } });
    });
    // 交互式 shell 的 rc 可能打印别的内容：取最后一行含路径分隔符的
    const line = String(output).split("\n").map((item) => item.trim()).filter((item) => item.includes(path.delimiter)).pop() || "";
    cachedLoginPath = line;
  } catch {
    cachedLoginPath = "";
  }
  return cachedLoginPath;
}

/** 测试用：清掉登录 shell PATH 缓存 */
export function resetLoginPathCache() {
  cachedLoginPath = null;
}

/**
 * 找 npm 可执行文件。
 *
 * 为什么不能直接用 "npm"：macOS 上从 Finder/Dock 启动的 app 拿到的是极窄 PATH
 * （/usr/bin:/bin:/usr/sbin:/sbin），而 npm 通常装在 /usr/local/bin、/opt/homebrew/bin
 * 或 nvm/volta 目录下——直接用 "npm" 会 ENOENT，UI 上表现为"点安装没反应"。
 */
export async function resolveNpmPath({ explicit, env = process.env, exists = defaultExists, loginPath }: any = {}) {
  if (explicit) return explicit;
  if (env?.DYWORKER_NPM) return env.DYWORKER_NPM;

  const candidates = [];
  // 用户真实环境优先（登录 shell），其次进程 PATH，最后才是静态兜底路径。
  const seen = new Set();
  const push = (dir) => {
    if (!dir || seen.has(dir)) return;
    seen.add(dir);
    candidates.push(path.join(dir, "npm"));
  };
  const resolvedLoginPath = loginPath !== undefined ? loginPath : await resolveLoginShellPath();
  for (const dir of String(resolvedLoginPath || "").split(path.delimiter)) push(dir);
  for (const dir of String(env?.PATH || "").split(path.delimiter)) push(dir);
  candidates.push("/opt/homebrew/bin/npm", "/usr/local/bin/npm", "/usr/bin/npm");
  candidates.push(path.join(os.homedir(), ".volta", "bin", "npm"));

  // nvm：版本目录逐个找（取字典序最后一个，通常是当前使用的新版本）
  const nvmRoot = env?.NVM_DIR || path.join(os.homedir(), ".nvm");
  try {
    const versions = (await fs.readdir(path.join(nvmRoot, "versions", "node"))).sort();
    for (const version of versions.reverse()) {
      candidates.push(path.join(nvmRoot, "versions", "node", version, "bin", "npm"));
    }
  } catch {
    // 没装 nvm
  }

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function defaultExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

// 安装源：默认官方；中国大陆镜像用于 GitHub/npm 访问不畅的网络。
// npm 走 --registry；GitHub 走可替换前缀的代理（逐个回退，全失败才算失败）。
export const INSTALL_SOURCES = {
  default: {
    label: "官方源",
    npmRegistry: null,
    githubPrefixes: [""],
  },
  // 自定义地址：内网/私有 npm 源。GitHub 仍走直连（私有源不代表有 git 代理）。
  custom: {
    label: "自定义地址",
    npmRegistry: null, // 由调用方传入 customRegistry
    githubPrefixes: [""],
  },
  cn: {
    label: "中国大陆镜像源",
    // npm：npmmirror（阿里）/ 2026-10-03 实测 HTTP 200
    npmRegistry: "https://registry.npmmirror.com",
    // GitHub：第三方代理前缀，按顺序回退，最后直连兜底。
    // 2026-10-03 逐个 `git ls-remote` 实测：下面 3 个可用；
    // gitclone.com / github.moeyy.xyz / hub.gitmirror.com / ghproxy.cc / gh.llkk.cc / ghp.ci 当时均不可用。
    // 这些是第三方代理（会经手你拉取的代码），只在无法直连时使用；换机器/换时间请重新实测。
    githubPrefixes: [
      "https://ghfast.top/",
      "https://gh-proxy.com/",
      "https://ghproxy.net/",
      "",
    ],
  },
};

/**
 * 识别用户填的是什么：
 *   - GitHub 仓库地址（含 /tree/<branch>/<subdir> 子目录写法）
 *   - 本地目录 / tarball 路径
 *   - npm 包名（可带 @版本 或 @scope/name）
 * 返回 { kind, ... }，调用方据此决定用哪种 npm 参数。
 */
export function parsePluginSource(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("请输入插件包名、GitHub 仓库地址或本地目录路径");

  // GitHub（也接受 git+https / .git 结尾）
  const github = raw.match(/^(?:git\+)?(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/tree\/([^/\s]+)(?:\/([^\s#?]+))?)?$/i);
  if (github) {
    const [, owner, repo, branch, subdir] = github;
    return { kind: "github", owner, repo, branch: branch || "", subdir: subdir || "", raw };
  }
  if (/^git@github\.com:/i.test(raw)) {
    const [, owner, repo] = raw.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i) || [];
    if (owner) return { kind: "github", owner, repo, branch: "", subdir: "", raw };
  }

  // 本地目录 / 文件（含 ~ 展开、Windows 盘符）
  if (/^[.~/\\]|^[A-Za-z]:[\\/]/.test(raw)) {
    const target = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
    return { kind: "local", path: path.resolve(target), raw };
  }

  // npm 包名：@scope/name@version 或 name@version
  const scoped = raw.match(/^(@[^/]+\/[^@]+)(?:@(.+))?$/);
  const plain = raw.match(/^([^@/\s]+)(?:@(.+))?$/);
  const match = scoped || plain;
  if (match) return { kind: "npm", name: match[1], version: match[2] || "", raw };
  throw new Error(`无法识别的插件来源：${raw}`);
}

/**
 * 解析本次要用的 npm registry。
 * 自定义地址必须是 http(s)（凭据请放本机 ~/.npmrc，由 npm 自己读）。
 */
export function resolveNpmRegistry(source, customRegistry) {
  const preset = INSTALL_SOURCES[source] || INSTALL_SOURCES.default;
  if (source !== "custom") return preset.npmRegistry;
  const raw = String(customRegistry || "").trim();
  if (!raw) throw new Error("自定义地址不能为空，例如 https://npm.example.com/");
  if (!/^https?:\/\//i.test(raw)) throw new Error("自定义地址必须以 http:// 或 https:// 开头");
  return raw.replace(/\/+$/, "");
}

/** 构造 GitHub 安装规格；前缀为空即直连 */
export function githubInstallSpecs({ owner, repo, branch, subdir }: any, prefixes = [""]) {
  const base = `github.com/${owner}/${repo}`;
  const suffix = branch ? (subdir ? `//${subdir}` : "") : "";
  const ref = branch ? `#${branch}` : "";
  return prefixes.map((prefix) => {
    if (!prefix) return `git+https://${base}.git${ref}${suffix}`;
    // 代理前缀形如 https://gitclone.com/ → https://gitclone.com/github.com/o/r.git
    return `git+${prefix}${base}.git${ref}${suffix}`;
  });
}

export const DEFAULT_TIMEOUT_MS = 180_000;

/** 默认实现：把包管理器跑起来，收集 stdout/stderr 与退出码 */
export function spawnRunner(command, args, options: any = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ code: -1, stdout, stderr: `${stderr}\n[超时] 超过 ${options.timeoutMs}ms 未结束，已中止` });
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * 在 profile 里安装一个包。
 * @param dir profile 目录
 * @param spec 包名（可带 @版本）
 * @param version 可选精确版本；给了就钉住
 * @returns { ok, spec, version, command, args, stdout, stderr, error }
 */
export async function installPackageIntoProfile({
  dir,
  spec,
  input,
  version,
  source = "default",
  customRegistry,
  npmPath,
  ignoreScripts = true,
  /** DSH 自己发布的包之间 peer 版本线互相冲突（-rc/-alpha 混用），补运行时依赖时要放宽 */
  legacyPeerDeps = false,
  run = spawnRunner,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  loginPath: injectedLoginPath,
}: any = {}) {
  const rawInput = String(input || spec || "").trim();
  if (!rawInput) throw new Error("安装需要插件包名 / GitHub 地址 / 本地路径");

  const parsed = parsePluginSource(rawInput);
  const preset = INSTALL_SOURCES[source] || INSTALL_SOURCES.default;
  let registry = null;
  try {
    registry = resolveNpmRegistry(source, customRegistry);
  } catch (error: any) {
    return { ok: false, spec: rawInput, error: String(error?.message || error) };
  }
  const resolvedNpm = await resolveNpmPath({ explicit: npmPath, loginPath: injectedLoginPath });
  if (!resolvedNpm) {
    return {
      ok: false,
      spec: rawInput,
      command: npmPath || "npm",
      error: "找不到包管理器（已尝试 PATH、/usr/local/bin、/opt/homebrew/bin、nvm、volta）。"
        + `可设置环境变量 DYWORKER_NPM 指向 npm，或手动把插件包放进 ${dir}/node_modules`,
    };
  }

  // 关键：把包管理器所在目录加进 PATH。
  // npm 自己就是 `#!/usr/bin/env node` 的脚本，靠 PATH 找 node；GUI 应用（Finder/Dock 启动）
  // 的 PATH 很窄，即使解析出了 npm 的绝对路径，它仍会因为找不到 node 而以 127 失败
  // （真实报错：env: node: No such file or directory）。git 依赖的 prepare 阶段同样需要 node。
  const npmBinDir = path.dirname(resolvedNpm);
  const loginPath = injectedLoginPath !== undefined ? injectedLoginPath : await resolveLoginShellPath();
  const childDirs = [];
  const seenDir = new Set();
  const addDir = (dir) => {
    if (!dir || seenDir.has(dir)) return;
    seenDir.add(dir);
    childDirs.push(dir);
  };
  // 顺序：登录 shell 的真实 PATH → 进程 PATH → npm 所在目录（**追加**）。
  // npm 目录必须追加：npm/包管理器目录常常是 /usr/local/bin，前置它会让 npm 去 spawn
  // 那里的 x86_64 git，在 Apple Silicon 上直接 EBADARCH。
  for (const dir of String(loginPath || "").split(path.delimiter)) addDir(dir);
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) addDir(dir);
  addDir(npmBinDir);
  const childEnv = { ...process.env, PATH: childDirs.join(path.delimiter) };

  const baseArgs = ["install", "--prefix", dir, "--save-exact", "--no-audit", "--no-fund"];
  if (legacyPeerDeps) baseArgs.push("--legacy-peer-deps");
  // 注册表来源的包是构建好的产物，默认不跑安装脚本；
  // git / 本地来源往往需要 prepare 现场构建（TS 源码仓库的 lib/ 不在仓库里），
  // 因此这类来源默认允许脚本，并在界面上明确告知。
  const shouldIgnoreScripts = parsed.kind === "npm" ? ignoreScripts : false;
  if (shouldIgnoreScripts) baseArgs.push("--ignore-scripts");
  if (registry) baseArgs.push(`--registry=${registry}`);

  // 不同来源 → 不同的安装目标；GitHub 走镜像回退链，逐个试
  const targets = [];
  if (parsed.kind === "github") {
    for (const target of githubInstallSpecs(parsed as any, preset.githubPrefixes)) targets.push({ target, label: target });
  } else if (parsed.kind === "local") {
    targets.push({ target: parsed.path, label: parsed.path });
  } else {
    const pinned = version || parsed.version;
    targets.push({ target: pinned ? `${parsed.name}@${pinned}` : parsed.name, label: rawInput });
  }

  const attempts = [];
  for (const { target, label } of targets) {
    const args = [...baseArgs, target];
    let result;
    try {
      result = await run(resolvedNpm, args, { cwd: dir, timeoutMs, env: childEnv });
    } catch (error: any) {
      attempts.push({ label, error: String(error?.message || error) });
      if (error?.code === "ENOENT") {
        return {
          ok: false, spec: rawInput, kind: parsed.kind, command: resolvedNpm, args,
          error: `无法执行包管理器 ${resolvedNpm}；可手动把插件包放进 ${dir}/node_modules，或用 DYWORKER_NPM 指定路径`,
        };
      }
      continue;
    }
    if (result.code === 0) {
      return {
        ok: true,
        spec: rawInput,
        kind: parsed.kind,
        command: resolvedNpm,
        args,
        ranInstallScripts: !shouldIgnoreScripts,
        stdout: result.stdout,
        version: parsed.kind === "npm" ? (version || parsed.version || null) : null,
      };
    }
    attempts.push({ label, error: `退出码 ${result.code}：${(result.stderr || result.stdout || "").trim().split("\n").slice(-2).join(" ")}` });
  }

  const detail = attempts.map((item) => `${item.label} → ${item.error}`).join("；");
  return {
    ok: false,
    spec: rawInput,
    kind: parsed.kind,
    command: resolvedNpm,
    args: targets.map((item) => item.target),
    attempts,
    error: parsed.kind === "github" && attempts.length > 1
      ? `所有安装源都失败（已尝试直连与镜像）：${detail}`
      : `安装失败：${detail}`,
  };
}

/**
 * 找出这次装进来的包名。
 * 三种手段依次兜底（重复安装时 diff 会为空，必须靠后两种）：
 *   1. profile 依赖 diff（首次安装）
 *   2. 依赖里声明的 spec 与本次输入匹配（重复安装）
 *   3. git → 按仓库名找 node_modules 里的包；本地 → 读该目录的 package.json
 */
export async function detectInstalledPackageName(dir, before = {}, options: any = {}) {
  const after = await readProfileDependencies(dir);
  const added = Object.keys(after).filter((name) => !(name in before));
  if (added.length === 1) return added[0];
  if (added.length > 1) return added[added.length - 1];

  const raw = String(options.rawInput || "").trim();
  if (raw) {
    // 归一化后再比：同一个来源在依赖里可能写成 github:owner/repo、git+https://github.com/...、file:... 等
    const normalizeSpec = (value) => String(value || "")
      .trim()
      .replace(/^git\+/, "")
      .replace(/^github:/i, "github.com/")
      .replace(/^https?:\/\//, "")
      .replace(/^file:\/\//, "")
      .replace(/\.git$/, "")
      .replace(/\/+$/, "");
    const needle = normalizeSpec(raw);
    const matched = Object.entries(after).find(([, spec]) => {
      const value = normalizeSpec(spec);
      return value === needle || value.endsWith(needle) || needle.endsWith(value);
    });
    if (matched) return matched[0];
  }

  const parsed = options.parsed;
  if (parsed?.kind === "github" && parsed.repo) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(dir, "node_modules", parsed.repo, "package.json"), "utf8"));
      if (manifest?.name) return manifest.name;
    } catch {
      // 目录名与包名不一致时继续兜底
    }
  }
  if (parsed?.kind === "local" && parsed.path) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(parsed.path, "package.json"), "utf8"));
      if (manifest?.name) return manifest.name;
    } catch {
      // 读不到就算了
    }
  }
  return null;
}

/** 读 profile 当前依赖（安装前快照，用于 diff） */
export async function readProfileDependencies(dir) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
    return manifest.dependencies || {};
  } catch {
    return {};
  }
}


/**
 * DSH 插件的 peer 运行时依赖。
 *
 * 为什么必须装：DSH 插件（如 dsh-context）把 @deepseek-ai/dsh-session / dsh-settings 等
 * 声明为 **peerDependencies**，它们提供插件主机半边真正依赖的领域能力（会话日志、设置作用域…）。
 * 不装的话插件主入口 import 就失败——实测报 "does not provide an export named 'SessionLogOffset'"、
 * "Cannot find package '@deepseek-ai/dsh-scope'" 之类，插件永远不会 apply。
 *
 * 两条硬约束：
 *   1. 取**最新发布版**（含 prerelease）：这些包的 latest dist-tag 长期停在旧的 0.0.1-rc.1，
 *      直接 npm install 会装到过旧版本，所以用 versions 列表取最后一个。
 *   2. `@deepseek-ai/cordis` 绝不能装成独立副本：插件的 Context/Service 必须与宿主同一个模块实例，
 *      否则 cordis 认不出对方的服务。这里用软链指向宿主自己那份。
 */
export function dshPeerNames(manifest: any): string[] {
  const peers = manifest?.peerDependencies || {};
  return Object.keys(peers).filter((name) => name.startsWith("@deepseek-ai/") && name !== "@deepseek-ai/cordis");
}

/**
 * 插件声明的**客户端模块**（package.json 的 dsh.client.inject）。
 * 它们不是 peerDependencies，但同样是运行时必需：DSH 的客户端半边按包名加载它们
 * （实测 dsh-client-ui-trajectory 声明了 5 个，缺一个它的视图就注册不出来）。
 * 与 peer 依赖一样排除 cordis（必须共用宿主同一份）。
 */
export function dshClientModuleNames(manifest: any): string[] {
  const client = manifest?.dsh?.client || manifest?.dyworker?.client || {};
  const declared = Array.isArray(client.inject) ? client.inject : [];
  return declared.map(String).filter((name) => name.startsWith("@deepseek-ai/") && name !== "@deepseek-ai/cordis");
}

/** 取一个包的最新发布版本（含 prerelease）；取不到返回 null */
export async function newestVersion(pkg: string, { run = spawnRunner, npmPath }: any = {}): Promise<string | null> {
  const resolved = await resolveNpmPath({ explicit: npmPath });
  if (!resolved) return null;
  try {
    const result = await run(resolved, ["view", pkg, "versions", "--json"], { timeoutMs: 60_000 });
    if (result.code !== 0) return null;
    const parsed = JSON.parse(result.stdout);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.length ? String(list[list.length - 1]) : null;
  } catch {
    return null;
  }
}

/** 宿主自己那份 cordis 的目录（插件必须解析到同一份，否则 Service/Context 不共享） */
export function hostCordisDir(): string {
  try {
    const require = createRequire(import.meta.url);
    const resolved = path.dirname(require.resolve("@deepseek-ai/cordis/package.json"));
    // 打包后这个路径会落在 app.asar 里。asar 只对 Electron 打过补丁的 fs 透明，
    // **Node 的 ESM 加载器读不了** —— 插件 import 时就是 "Cannot find package"。
    // 因此打包时把 cordis 解包（asarUnpack），这里把 asar 路径映射到 app.asar.unpacked。
    const marker = `${path.sep}app.asar${path.sep}`;
    if (resolved.includes(marker)) {
      const unpacked = resolved.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`);
      try {
        if (existsSync(path.join(unpacked, "package.json"))) return unpacked;
      } catch {
        // 没解包成功就退回原路径，至少不改变非打包环境的行为
      }
    }
    return resolved;
  } catch {
    return "";
  }
}

/** 让插件能解析到宿主同一份 cordis（软链；已存在则覆盖） */
export async function linkHostCordis(dir: string, hostCordisDir: string): Promise<void> {
  const target = path.join(dir, "node_modules", "@deepseek-ai", "cordis");
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rm(target, { recursive: true, force: true });
    await fs.symlink(hostCordisDir, target, "dir");
  } catch {
    // 软链失败（权限/平台）不算致命：插件仍可尝试从自身依赖解析
  }
}
