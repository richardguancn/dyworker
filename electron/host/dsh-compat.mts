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
//   3. 是否有浏览器半边（dsh.client）—— 那半边需要 DSH 的 Web shell，我们跑不了。
//
// 本文件为纯分析逻辑：只读文件、不碰 ctx、不 import electron。
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 本宿主提供的服务名（与 host/context.mts 的注册保持一致）
export const HOST_SERVICES = [
  "hostOptions",
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
export async function readDeclaredInject(entryUrl) {
  try {
    const mod = await import(entryUrl);
    const inject = mod?.inject ?? mod?.default?.inject;
    return Array.isArray(inject) ? inject.map(String) : [];
  } catch (error: any) {
    return { importError: String(error?.message || error) };
  }
}

/** 静态扫描：运行时注入（ctx.inject([...])）与 static inject，导出里读不到 */
export async function scanInjectHints(pkgDir) {
  const names = new Set();
  let files = [];
  try {
    files = (await fs.readdir(path.join(pkgDir, "lib"))).filter((name) => name.endsWith(".js"));
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
export async function analyzePlugin(profileManifest, spec, manifest, pkgDir) {
  const main = manifest.main || "index.js";
  const entry = path.join(pkgDir, main);
  const entryUrl = pathToFileURL(entry).href;

  const declared = await readDeclaredInject(entryUrl);
  const hints = await scanInjectHints(pkgDir);
  const importError = Array.isArray(declared) ? null : declared.importError;
  const inject = Array.isArray(declared) ? declared : [];

  const services = [...new Set([...inject, ...hints])].map(classifyService);
  const missingPackages = missingDshPackages(profileManifest, manifest);
  const client = manifest.dsh?.client || null;

  const reasons = [];
  let verdict = "runnable";

  if (client) {
    verdict = "unsupported";
    reasons.push(`含浏览器半边（dsh.client，platform=${client.platform || "?"}）：需要 DSH 的 Web shell 与 dsh-client-* 服务，本宿主不加载客户端插件`);
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
    reasons.push(`声明依赖 ${missingPackages.join(", ")} 未单独安装，但主入口可正常 import（可能已内联）`);
  }
  const blocking = services.filter((service) => service.state === "missing");
  if (blocking.length) {
    if (verdict !== "unsupported") verdict = "unsupported";
    reasons.push(`依赖本宿主未提供的服务：${blocking.map((service) => service.name).join(", ")}——cordis 的 inject 永不满足，插件不会被 apply`);
  }
  const nameOnly = services.filter((service) => service.state === "name-only");
  if (nameOnly.length && verdict === "runnable") {
    verdict = "partial";
    reasons.push(`同名但语义不同：${nameOnly.map((service) => `${service.name}（${service.reason}）`).join("；")}`);
  }
  if (verdict === "runnable") {
    reasons.push(services.length ? "声明依赖的服务本宿主均提供" : "未声明服务依赖，主入口可 import");
  }

  return {
    name: manifest.name || spec,
    version: manifest.version || "",
    hostHalf: { entry: main, importable: !importError, importError, inject, hints },
    clientHalf: client ? { platform: client.platform || "", inject: client.inject || [] } : null,
    missingPackages,
    services,
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
