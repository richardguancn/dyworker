// DSH 兼容层：判断一个 dsh-* 插件包在本宿主里**能不能真的跑起来**，并给出原因。
//
// 为什么需要它：cordis 的 inject 只按**服务名**判断，不看形状。一个 DSH 插件
// inject ["skills"] 时，只要宿主恰好有叫 skills 的服务，插件就会被 apply——
// 然后它按 DSH 的 API 去调，抛在深处。更糟的情况是服务名缺失，inject 永不满足，
// 插件永远不 apply，界面上只表现为"装了什么都没发生"。
// 所以这里把结论前置：装之前就把"能跑 / 只能部分跑 / 跑不了"和理由讲清楚。
//
// 判定依据（全部来自插件包自身，不靠猜）：
//   1. 模块能否被 import —— 它依赖的 @deepseek-ai/* 包在 profile 里是否齐；
//   2. 声明的服务需求 —— 模块导出的 inject / static inject（cordis 真正读取的那份），
//      外加对 ctx.inject([...]) 的静态扫描（运行时注入，读不到导出）；
//   3. 客户端平台（dsh.client）—— web 可由渲染端加载，其他平台尚不支持。
//
// 静态读取与受限子进程探测；不在应用进程导入插件，不依赖 Electron。
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnPluginProcess, terminatePluginProcess } from "./dsh-runtime/process.mts";
import { DSH_VERSION, DSH_RUNTIME_SERVICES, DSH_SESSION_SERVICES, isDshPackage } from "./dsh-runtime/baseline.mts";
import { evaluatePluginCompatibility, readProfileVersionExemptions } from '@deepseek-ai/dsh-app-boot';
import { resolvePluginModule } from './plugin-module-cache.mts';
import { probeDshSessionPlugin } from "./dsh-runtime/session-compat.mts";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HOST_CLIENT_MODULES } from "./plugin-client.mts";

// 本宿主提供的服务名（与 host/context.mts 的注册保持一致）
export const HOST_SERVICES = [
  "hostOptions",
  // cordis 官方 loader（@deepseek-ai/cordis-plugin-loader）挂成的服务：
  // 有的 DSH 插件用它做热加载/子树管理，本宿主确实提供，不能漏报。
  "loader",
  "ipc",
  "storage",
  "window",
  "audit",
  "settings",
  "sessions",
  "rules",
  "skills",
  "memory",
  "inbox",
  "scheduler",
  "agent",
  "plugins",
  // 插件工具服务：插件通过它注册自己的工具（统一走 plugin__<plugin>__<tool> 命名与审批）
  "tools",
  "connection", "sessionProjections", "sessionProjectionCache",
];

// 已知的 DSH 服务名（扫描本机 DSH 发布包得到），用于把"缺什么"说成人话
export const DSH_SERVICES = [
  "agents", "agentLoop", "agentDefaultModel", "agentPresets", "approval", "attachments",
  "authorization", "clientModules", "codeRuntime", "commands", "compaction", "credentials",
  "dynamicCordisRunner", "fileReferences", "fs", "goals", "jobs", "llm", "messageFeedback",
  "permissionPresets", "planMode", "pluginInventory", "sandbox", "sandboxPolicy",
  "sessionPersistence", "sessionProjections", "sessionQuery", "sessionReferenceResolver",
  "skills", "spillStore", "subagents", "subprocess", "systemPrompt", "terminals",
  "tokenMeter", "toolResultPruner", "tools", "typert", "typertGateway", "userQuestions",
  "web", "webServer", "workflowEngine", "workspaceRegistry",
];

// 同名但语义不同的服务：inject 能满足，但按 DSH API 调用会失败——必须让用户知道
const NAME_ONLY = new Set(["skills", "settings", "sessions", "fs", "tools"]);

/**
 * 一个服务名在本宿主里的状态：
 *   fulfilled  同名服务存在，语义按本宿主实现（DSH 插件直接调用可能不兼容）
 *   name-only  同名但语义明确不同
 *   missing    不存在 → inject 永不满足，插件不会 apply
 */
export function classifyService(name) {
  if (HOST_SERVICES.includes(name)) {
    return NAME_ONLY.has(name)
      ? { name, state: "name-only", reason: `本宿主的 ${name} 与 DSH 同名服务语义不同，按 DSH API 调用会失败` }
      : { name, state: "fulfilled", reason: `由本宿主提供：${name}` };
  }
  if (DSH_SERVICES.includes(name)) {
    return { name, state: "missing", reason: `DSH 服务 ${name} 本宿主未提供` };
  }
  return { name, state: "missing", reason: `未知服务 ${name}（本宿主未提供）` };
}

/** 从模块导出里读 cordis 真正使用的 inject 声明 */
export async function readDeclaredInject(entryUrl: string, { profileDir, packageDir, timeoutMs = 10_000 }: any = {}) {
  return new Promise<string[] | { importError: string }>((resolve) => {
    let settled = false;
    const child = spawnPluginProcess("probe", { profileDir: profileDir || path.dirname(fileURLToPath(entryUrl)), packageDir: packageDir || path.dirname(fileURLToPath(entryUrl)) });
    const finish = async (value: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await terminatePluginProcess(child);
      resolve(value);
    };
    const timer = setTimeout(() => finish({ importError: "插件检查超时，检查进程已停止" }), timeoutMs);
    child.once("message", (result: any) => finish(result?.importError ? { importError: result.importError } : result.inject || []));
    child.once("error", error => finish({ importError: error.message }));
    child.once("exit", code => { if (!settled) finish({ importError: `插件检查进程意外退出（${code}）` }); });
    child.send({ entryUrl, profileDir: profileDir || path.dirname(fileURLToPath(entryUrl)) });
  });
}

/** 静态扫描主机部分的运行时注入和内部服务声明；客户端服务不计入主机需求 */
export async function scanInjectHints(pkgDir) {
  const names = new Set();
  let files = [];
  try {
    files = (await fs.readdir(path.join(pkgDir, "lib"))).filter((name) => name.endsWith(".js") && !name.startsWith("client"));
  } catch {
    return [];
  }
  for (const file of files) {
    let text = "";
    try {
      text = await fs.readFile(path.join(pkgDir, "lib", file), "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(/ctx\.inject\(\s*\[([^\]]*)\]/g)) {
      for (const item of match[1].split(",")) {
        const name = item.trim().replace(/^["']|["']$/g, "");
        if (name) names.add(name);
      }
    }
    for (const match of text.matchAll(/static\s+inject\s*=\s*\[([^\]]*)\]/g)) {
      for (const item of match[1].split(",")) {
        const name = item.trim().replace(/^["']|["']$/g, "");
        if (name) names.add(name);
      }
    }
  }
  return [...names];
}

/** 插件声明依赖的 @deepseek-ai/* 包，哪些在 profile 里解析不到 */
export function missingDshPackages(profileManifest, manifest) {
  const profileRequire = createRequire(profileManifest);
  const declared = [
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.peerDependencies || {}),
    ...Object.keys(manifest.peerDependenciesMeta || {}),
  ].filter((name) => name.startsWith("@deepseek-ai/"));
  const missing = [];
  for (const name of new Set(declared)) {
    if ((manifest.dsh?.client || manifest.dyworker?.client) && HOST_CLIENT_MODULES.has(name)) continue;
    try {
      profileRequire.resolve(name);
    } catch {
      missing.push(name);
    }
  }
  return missing;
}

/**
 * 分析一个插件包的兼容性。
 * @returns {{
 *   name, version, hostHalf: {entry, importable, inject, hints},
 *   clientHalf, missingPackages, services, verdict, reasons
 * }}
 */
export async function analyzePlugin(profileManifest, spec, manifest, pkgDir,
  { config = {}, entryUrl: suppliedEntry, metadataOnly = false,
    versionExemptions = readProfileVersionExemptions(path.dirname(profileManifest)) }: any = {}) {
  const exported = manifest.exports?.["."] ?? (typeof manifest.exports === "string" ? manifest.exports : null);
  const main = (typeof exported === "string" ? exported : exported?.import || exported?.default) || manifest.main || "index.js";
  const entry = path.join(pkgDir, main);
  const entryUrl = suppliedEntry || (!metadataOnly && resolvePluginModule(spec, path.dirname(profileManifest))) || pathToFileURL(entry).href;

  const versionIssue = isDshPackage(manifest) ? evaluatePluginCompatibility(manifest, versionExemptions, DSH_VERSION) : undefined;
  const versionError = versionIssue && !versionIssue.exempted
    ? `插件要求的 DSH 版本与当前 ${DSH_VERSION} 不一致：${Object.entries(versionIssue.peers).map(([name, range]) => `${name} ${range}`).join('、')}`
    : null;

  // 与官方预检一致：版本不匹配时，不先执行插件主入口。
  const declared = versionError ? { importError: versionError } : metadataOnly ? []
    : await readDeclaredInject(entryUrl, { profileDir: path.dirname(profileManifest), packageDir: pkgDir });
  const hints = metadataOnly ? [] : await scanInjectHints(pkgDir);
  const importError = Array.isArray(declared) ? null : declared.importError;
  const inject = Array.isArray(declared) ? declared : [];

  const isolated = isDshPackage(manifest);
  const requiresSession = isolated && ([...inject, ...hints] as string[]).some(name =>
    !DSH_RUNTIME_SERVICES.includes(name) && DSH_SESSION_SERVICES.includes(name));
  const sessionCheck = requiresSession && !importError && inject.every(name => DSH_SESSION_SERVICES.includes(name))
    ? await probeDshSessionPlugin({ profileDir: path.dirname(profileManifest), packageDir: pkgDir, entryUrl, config }) : null;
  const available = sessionCheck?.ok ? sessionCheck.services : DSH_RUNTIME_SERVICES;
  const services = [...new Set<string>([...inject, ...hints] as string[])].map(name => isolated
    ? available.includes(name)
      ? { name, state: "fulfilled", reason: "由固定版本的官方 DSH 运行环境提供" }
      : { name, state: "missing", reason: `独立运行环境暂未提供 ${name}` }
    : classifyService(name));
  const missingPackages = missingDshPackages(profileManifest, manifest);
  const client = manifest.dyworker?.client || manifest.dsh?.client || null;

  const reasons = [];
  let verdict = "runnable";
  if (sessionCheck?.ok) reasons.push('已在临时 DSH 会话中实际启动；使用时请选择“DSH 插件会话”');
  else if (sessionCheck) reasons.push(`DSH 会话启动检查失败：${sessionCheck.error}`);

  if (client) {
    if (client.platform && client.platform !== "web") {
      verdict = "unsupported";
      reasons.push(`客户端平台 ${client.platform} 暂不支持，当前只支持 web 插件界面`);
    } else {
      reasons.push("包含插件界面，宿主已提供客户端加载能力；具体功能仍取决于插件所需服务");
    }
  }
  if (importError) {
    verdict = "unsupported";
    reasons.push(`主入口无法 import：${importError}`);
    if (missingPackages.length) {
      reasons.push(`缺少依赖包：${missingPackages.join(", ")}（未安装到 profile）`);
    }
  } else if (missingPackages.length) {
    // 声明了但解析不到、主入口却 import 成功 → 该依赖被上游内联/提升，不构成阻断。
    // （实测：DSH 部分包声明 @deepseek-ai/dsh-util-values，但并未单独发布。）
    reasons.push(`声明的包 ${missingPackages.join(", ")} 未单独安装，但主入口可正常加载；可能已内联或未使用，不需要仅按声明补装`);
  }
  const blocking = services.filter((service) => service.state === "missing" && inject.includes(service.name));
  if (blocking.length) {
    if (verdict !== "unsupported") verdict = "unsupported";
    reasons.push(`依赖本宿主未提供的服务：${blocking.map((service) => service.name).join(", ")}——cordis 的 inject 永不满足，插件不会被 apply`);
  }
  const deferred = services.filter((service) => service.state === "missing" && !inject.includes(service.name));
  if (deferred.length) {
    if (verdict === "runnable") verdict = "partial";
    reasons.push(`部分功能所需服务尚未提供：${deferred.map((service) => service.name).join(", ")}；这些功能等待服务就绪，不阻止主入口加载`);
  }
  const nameOnly = services.filter((service) => service.state === "name-only");
  if (nameOnly.length) {
    // 同名语义不同一律要报出来：即使最终判定已经不是 runnable（例如另有真正缺失的服务），
    // 用户也需要知道"这个服务名虽然存在、但按 DSH API 调用会失败"，否则会误以为只差一项。
    if (verdict === "runnable") verdict = "partial";
    reasons.push(`同名但语义不同：${nameOnly.map((service) => `${service.name}（${service.reason}）`).join("；")}`);
  }
  if (verdict === "runnable") {
    reasons.push(metadataOnly ? "插件包仅提供配置；配置中的条目分别装载"
      : services.length ? "声明依赖的服务本宿主均提供" : "未声明服务依赖，主入口可 import");
  }

  return {
    name: manifest.name || spec,
    version: manifest.version || "",
    hostHalf: { entry: metadataOnly ? '' : main, importable: metadataOnly && !importError ? null : !importError,
      metadataOnly, importError, inject, hints },
    clientHalf: client ? { platform: client.platform || "", inject: client.inject || [] } : null,
    missingPackages,
    versionIssue: versionIssue || null,
    services,
    runtime: sessionCheck?.ok ? "dsh-session" : isolated ? "tool-bridge" : "host",
    verdict,
    reasons,
  };
}

/** 一行行打印的兼容矩阵（便于日志/CLI 输出） */
export function formatMatrix(analysis) {
  const icon = { runnable: "✅", partial: "⚠️", unsupported: "❌" }[analysis.verdict] || "?";
  const lines = [`${icon} ${analysis.name}@${analysis.version} — ${analysis.verdict}`];
  for (const reason of analysis.reasons) lines.push(`   · ${reason}`);
  if (analysis.services.length) {
    lines.push(`   · 服务需求：${analysis.services.map((service) => `${service.name}[${service.state}]`).join(", ")}`);
  }
  return lines.join("\n");
}
