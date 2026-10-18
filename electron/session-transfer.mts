// 会话/项目的跨机迁移：导出包（单个 .dyworker 文件，内容为 JSON）的构建、
// 校验与导入计划。
//
// 分层与其它领域模块一致：本文件是纯逻辑（不 import electron、不碰原生对话框），
// IPC 插件（host/plugins/transfer-ipc.mts）负责原生保存/打开对话框、读写文件、
// 落盘到会话存档；测试直接 import 本模块（tests/session-transfer.test.mjs）。
//
// 为什么是单 JSON 而不是 zip：不引入打包依赖，包内结构可直接用文本工具排查；
// 附件按需内联 base64，并有单文件/总量预算，超预算只带名单不带内容。

import path from "node:path";

export const TRANSFER_FORMAT = "dyworker-transfer";
export const TRANSFER_VERSION = 1;
// 导出文件扩展名（dialog 过滤器与默认文件名共用）
export const TRANSFER_EXTENSION = "dyworker";
// 附件预算：单个文件与整包上限，超过就只记录名单，避免把主进程内存或磁盘拖爆
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 64 * 1024 * 1024;

export type TransferKind = "session" | "project";

export interface TransferAttachment {
  // 附件在某条消息里出现时记录的会话与原始路径；导入端按 path 反查替换
  sessionId: string;
  path: string;
  name: string;
  mimeType?: string;
  size?: number;
  dataBase64: string;
}

export interface TransferProject {
  path: string;
  title: string;
  pinned?: boolean;
}

export interface TransferPackage {
  format: string;
  version: number;
  kind: TransferKind;
  exportedAt: string;
  app: { version?: string; platform?: string; host?: string };
  project?: TransferProject | null;
  sessions: any[];
  attachments: TransferAttachment[];
  skippedAttachments: Array<{ name: string; reason: string }>;
}

export interface ImportPlanEntry {
  session: any;
  originalId: string;
  id: string;
  renamed: boolean;
}

export interface ImportPlan {
  kind: TransferKind;
  project: (TransferProject & { sessionCount: number; exists: boolean }) | null;
  entries: ImportPlanEntry[];
  // 包内每个未知工作目录：导入端要为用户逐个确认落点
  workspaces: Array<{ path: string; title: string; sessionCount: number; exists: boolean }>;
  attachments: TransferAttachment[];
}

function text(value: any) {
  return String(value ?? "");
}

// 文件名/路径片段清洗：只用于本机落盘目录名，不影响会话标题
export function safeSegment(value: any, fallback = "item") {
  const base = text(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim();
  return base.slice(0, 80) || fallback;
}

export function projectTitle(workspacePath: any) {
  const raw = text(workspacePath);
  return raw.split(/[\\/]/).filter(Boolean).at(-1) || raw || "默认工作目录";
}

// 导出文件名：<标题>-<日期>.dyworker
export function exportFileName(title: any, kind: TransferKind, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  const suffix = kind === "project" ? "项目" : "任务";
  return `${safeSegment(title, suffix)}-${suffix}-${stamp}.${TRANSFER_EXTENSION}`;
}

// 收集会话消息里的全部附件引用（同一条路径只取一次，保留首条元数据）
export function collectAttachmentRefs(sessions: any[]) {
  const refs: Array<{ sessionId: string; path: string; name: string; mimeType?: string; size?: number }> = [];
  const seen = new Set<string>();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const sessionId = text(session?.id);
    for (const message of Array.isArray(session?.messages) ? session.messages : []) {
      for (const attachment of Array.isArray(message?.attachments) ? message.attachments : []) {
        // 渠道/浏览器上传等临时附件没有本地路径，跳过
        const localPath = text(attachment?.path);
        if (!localPath || seen.has(localPath)) continue;
        seen.add(localPath);
        refs.push({
          sessionId,
          path: localPath,
          name: text(attachment?.name) || path.basename(localPath),
          mimeType: attachment?.mimeType ? text(attachment.mimeType) : undefined,
          size: typeof attachment?.size === "number" ? attachment.size : undefined,
        });
      }
    }
  }
  return refs;
}

// 读取附件内容（base64 内联）。读不到/超预算的只进 skipped 名单，不让导出失败。
export async function collectAttachments(
  sessions: any[],
  readFileBuffer: (filePath: string) => Promise<Buffer | null>,
  { maxFileBytes = MAX_ATTACHMENT_BYTES, maxTotalBytes = MAX_ATTACHMENT_TOTAL_BYTES } = {},
) {
  const attachments: TransferAttachment[] = [];
  const skippedAttachments: Array<{ name: string; reason: string }> = [];
  let bytes = 0;
  for (const ref of collectAttachmentRefs(sessions)) {
    if (typeof ref.size === "number" && ref.size > maxFileBytes) {
      skippedAttachments.push({ name: ref.name, reason: `超过单文件上限 ${Math.round(maxFileBytes / 1024 / 1024)}MB` });
      continue;
    }
    const buffer = await readFileBuffer(ref.path).catch(() => null);
    if (!buffer) {
      skippedAttachments.push({ name: ref.name, reason: "文件已不在原位置，无法读取" });
      continue;
    }
    if (buffer.byteLength > maxFileBytes) {
      skippedAttachments.push({ name: ref.name, reason: `超过单文件上限 ${Math.round(maxFileBytes / 1024 / 1024)}MB` });
      continue;
    }
    if (bytes + buffer.byteLength > maxTotalBytes) {
      skippedAttachments.push({ name: ref.name, reason: `超过整包上限 ${Math.round(maxTotalBytes / 1024 / 1024)}MB` });
      continue;
    }
    bytes += buffer.byteLength;
    attachments.push({ ...ref, size: buffer.byteLength, dataBase64: buffer.toString("base64") });
  }
  return { attachments, skippedAttachments, bytes };
}

export function buildTransferPackage({
  kind,
  sessions,
  project = null,
  appVersion = "",
  platform = "",
  host = "",
  attachments = [],
  skippedAttachments = [],
  exportedAt = new Date().toISOString(),
}: {
  kind: TransferKind;
  sessions: any[];
  project?: TransferProject | null;
  appVersion?: string;
  platform?: string;
  host?: string;
  attachments?: TransferAttachment[];
  skippedAttachments?: Array<{ name: string; reason: string }>;
  exportedAt?: string;
}): TransferPackage {
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    kind: kind === "project" ? "project" : "session",
    exportedAt,
    app: { version: appVersion || undefined, platform: platform || undefined, host: host || undefined },
    project: project ? { path: text(project.path), title: text(project.title) || projectTitle(project.path), pinned: !!project.pinned } : null,
    sessions: (Array.isArray(sessions) ? sessions : []).filter((session) => session && text(session.id)),
    attachments: Array.isArray(attachments) ? attachments : [],
    skippedAttachments: Array.isArray(skippedAttachments) ? skippedAttachments : [],
  };
}

// 解析导入文件：只认本格式，版本高于本机能力时明确拒绝（不猜字段语义）。
// 返回结构用可选字段而不是判别联合：主进程 tsc 未开 strictNullChecks，
// 字面量判别属性收窄不可靠，调用方按 ok 判断即可。
export function parseTransferPackage(input: any): { ok: boolean; error?: string; package?: TransferPackage } {
  let parsed = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      return { ok: false, error: "文件内容不是有效的 JSON，可能不是 DYWorker 迁移包或文件已损坏" };
    }
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "文件内容为空或格式不正确" };
  if (parsed.format !== TRANSFER_FORMAT) return { ok: false, error: "这不是 DYWorker 的任务/项目迁移包" };
  const version = Number(parsed.version);
  if (!Number.isFinite(version) || version < 1) return { ok: false, error: "迁移包缺少版本号，无法识别" };
  if (version > TRANSFER_VERSION) {
    return { ok: false, error: `迁移包版本 ${version} 高于当前应用支持的 ${TRANSFER_VERSION}，请先升级 DYWorker` };
  }
  const sessions = Array.isArray(parsed.sessions) ? parsed.sessions.filter((item: any) => item && text(item.id)) : [];
  if (!sessions.length) return { ok: false, error: "迁移包里没有可导入的任务" };
  return {
    ok: true,
    package: {
      format: TRANSFER_FORMAT,
      version,
      kind: parsed.kind === "project" ? "project" : "session",
      exportedAt: text(parsed.exportedAt),
      app: parsed.app && typeof parsed.app === "object" ? parsed.app : {},
      project: parsed.project && typeof parsed.project === "object"
        ? { path: text(parsed.project.path), title: text(parsed.project.title), pinned: !!parsed.project.pinned }
        : null,
      sessions,
      attachments: Array.isArray(parsed.attachments)
        ? parsed.attachments.filter((item: any) => item && text(item.dataBase64) && text(item.path))
        : [],
      skippedAttachments: Array.isArray(parsed.skippedAttachments) ? parsed.skippedAttachments : [],
    },
  };
}

// 计算导入计划：id 冲突改名、包内 id 去重、字段降级，并汇总需要用户确认的工作目录。
// hasSession/workspaceExists 由调用方注入（主进程用会话存档与本机文件系统）。
export function planImport(
  pkg: TransferPackage,
  {
    hasSession = (_id: string) => false,
    workspaceExists = (_p: string) => true,
  }: { hasSession?: (id: string) => boolean; workspaceExists?: (workspacePath: string) => boolean } = {},
): ImportPlan {
  const taken = new Set<string>();
  const allocate = (originalId: string) => {
    if (!taken.has(originalId) && !hasSession(originalId)) {
      taken.add(originalId);
      return { id: originalId, renamed: false };
    }
    let counter = 1;
    let candidate = `${originalId}-${counter}`;
    // 上限兜底：hasSession 万一被注入成异步实现（永远返回真值），
    // 这里也不能无限递增把主进程内存吃光，退到带随机尾巴的编号。
    while ((taken.has(candidate) || hasSession(candidate)) && counter < 500) {
      counter += 1;
      candidate = `${originalId}-${counter}`;
    }
    if (taken.has(candidate) || hasSession(candidate)) {
      candidate = `${originalId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }
    taken.add(candidate);
    return { id: candidate, renamed: true };
  };

  const idMap = new Map<string, string>();
  const entries: ImportPlanEntry[] = pkg.sessions.map((session) => {
    const originalId = text(session.id);
    const { id, renamed } = allocate(originalId);
    idMap.set(originalId, id);
    return { session, originalId, id, renamed };
  });

  const workspaces = new Map<string, { path: string; title: string; sessionCount: number; exists: boolean }>();
  for (const entry of entries) {
    const workspacePath = text(entry.session.workspacePath);
    if (!workspacePath) continue;
    const known = workspaces.get(workspacePath);
    if (known) {
      known.sessionCount += 1;
      continue;
    }
    workspaces.set(workspacePath, {
      path: workspacePath,
      title: projectTitle(workspacePath),
      sessionCount: 1,
      exists: !!workspaceExists(workspacePath),
    });
  }
  const project = pkg.project
    ? {
        ...pkg.project,
        title: pkg.project.title || projectTitle(pkg.project.path),
        sessionCount: entries.length,
        exists: pkg.project.path ? !!workspaceExists(pkg.project.path) : false,
      }
    : null;
  if (project?.path && !workspaces.has(project.path)) {
    workspaces.set(project.path, { path: project.path, title: project.title, sessionCount: entries.length, exists: project.exists });
  }

  return {
    kind: pkg.kind,
    project,
    entries,
    workspaces: [...workspaces.values()],
    attachments: pkg.attachments,
  };
}

// 把导入计划落成可写入存档的会话：工作目录映射到本机、附件路径换成落盘位置、
// 会话 id 用计划里的新值。原始会话对象不被修改（导入可在同一进程里重试）。
export function applyImportPlan(
  plan: ImportPlan,
  {
    workspaceMapping = {} as Record<string, string>,
    attachmentPaths = new Map<string, string>(),
  } = {},
) {
  const mappedWorkspace = (workspacePath: string) => {
    const mapped = text(workspaceMapping[workspacePath]).trim();
    return mapped || workspacePath;
  };
  const idMap = new Map(plan.entries.map((entry) => [entry.originalId, entry.id]));
  return plan.entries.map((entry) => {
    const source = entry.session;
    const parentId = text(source.parentSessionId);
    const messages = (Array.isArray(source.messages) ? source.messages : []).map((message: any) => {
      if (!Array.isArray(message?.attachments) || !message.attachments.length) return message;
      return {
        ...message,
        attachments: message.attachments.map((attachment: any) => {
          const nextPath = attachmentPaths.get(text(attachment?.path));
          return nextPath ? { ...attachment, path: nextPath } : attachment;
        }),
      };
    });
    return {
      ...source,
      id: entry.id,
      // 换机器后插件任务的运行态目录不在包里：按普通任务导入，历史照常阅读与续聊
      runtime: source.runtime === "dsh" ? "dyworker" : source.runtime,
      parentSessionId: parentId ? (idMap.get(parentId) ?? parentId) : source.parentSessionId,
      workspacePath: mappedWorkspace(text(source.workspacePath)),
      // 未读/运行态标记属于原机器的一次性状态
      unread: false,
      messages,
    };
  });
}
