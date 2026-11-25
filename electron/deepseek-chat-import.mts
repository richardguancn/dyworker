// DeepSeek 网页版官方导出包（.zip 内的 conversations.json 或直接导出的 conversations.json）解析器：
// 零第三方依赖，直接通过 Node 内置 zlib 解析 ZIP Central Directory，
// 把树状分支 mapping 与 REQUEST/THINK/RESPONSE fragments 线性化为标准 DYWorker 会话。
import crypto from "node:crypto";
import { inflateRawSync } from "node:zlib";

const MAX_ZIP_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

export function isZipBuffer(buf: Buffer): boolean {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
  return (
    buf[0] === 0x50
    && buf[1] === 0x4b
    && ((buf[2] === 0x03 && buf[3] === 0x04) || (buf[2] === 0x05 && buf[3] === 0x06))
  );
}

export function extractConversationsJsonFromZip(
  zipBuffer: Buffer,
): { ok: true; jsonText: string } | { ok: false; error: string } {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) {
    return { ok: false, error: "压缩包格式无效或文件不完整" };
  }

  // ZIP 注释最长 65535 字节，EOCD 本身至少 22 字节
  const minScan = Math.max(0, zipBuffer.length - 65557);
  let eocdOffset = -1;
  for (let offset = zipBuffer.length - 22; offset >= minScan; offset -= 1) {
    if (zipBuffer.readUInt32LE(offset) !== EOCD_SIG) continue;
    const commentLen = zipBuffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLen <= zipBuffer.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    return { ok: false, error: "无法在压缩包中定位 ZIP 目录记录" };
  }

  const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  if (cdOffset + cdSize > zipBuffer.length) {
    return { ok: false, error: "ZIP 中央目录边界越界，文件可能已损坏" };
  }

  let cursor = cdOffset;
  const cdEnd = cdOffset + cdSize;
  let targetEntry: {
    method: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
  } | null = null;

  while (cursor + 46 <= cdEnd) {
    if (zipBuffer.readUInt32LE(cursor) !== CD_SIG) break;
    const method = zipBuffer.readUInt16LE(cursor + 10);
    const compressedSize = zipBuffer.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(cursor + 24);
    const nameLen = zipBuffer.readUInt16LE(cursor + 28);
    const extraLen = zipBuffer.readUInt16LE(cursor + 30);
    const commentLen = zipBuffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLen > cdEnd) break;

    const rawName = zipBuffer.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8").replace(/\\/g, "/");
    cursor += 46 + nameLen + extraLen + commentLen;

    if (!rawName || rawName.startsWith("__MACOSX/") || rawName.split("/").pop()?.startsWith("._")) {
      continue;
    }
    const lower = rawName.toLowerCase();
    if (lower === "conversations.json" || lower.endsWith("/conversations.json")) {
      targetEntry = { method, compressedSize, uncompressedSize, localHeaderOffset };
      if (lower === "conversations.json") break;
    }
  }

  if (!targetEntry) {
    return { ok: false, error: "压缩包里没有找到 conversations.json" };
  }
  if (targetEntry.uncompressedSize > MAX_ZIP_UNCOMPRESSED_BYTES) {
    return { ok: false, error: "conversations.json 体积过大，已拒绝解压" };
  }

  const lfh = targetEntry.localHeaderOffset;
  if (lfh + 30 > zipBuffer.length || zipBuffer.readUInt32LE(lfh) !== LFH_SIG) {
    return { ok: false, error: "ZIP 本地文件头损坏" };
  }
  const localNameLen = zipBuffer.readUInt16LE(lfh + 26);
  const localExtraLen = zipBuffer.readUInt16LE(lfh + 28);
  const dataStart = lfh + 30 + localNameLen + localExtraLen;
  const dataEnd = dataStart + targetEntry.compressedSize;
  if (dataEnd > zipBuffer.length) {
    return { ok: false, error: "ZIP 条目数据不完整" };
  }

  const compressedPayload = zipBuffer.subarray(dataStart, dataEnd);
  if (targetEntry.method === 0) {
    return { ok: true, jsonText: compressedPayload.toString("utf8") };
  }
  if (targetEntry.method === 8) {
    try {
      const inflated = inflateRawSync(compressedPayload, { maxOutputLength: MAX_ZIP_UNCOMPRESSED_BYTES });
      return { ok: true, jsonText: inflated.toString("utf8") };
    } catch (error: any) {
      return { ok: false, error: `解压 conversations.json 失败：${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return { ok: false, error: `暂不支持的 ZIP 压缩算法 (${targetEntry.method})` };
}

function normalizeIsoTimestamp(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value.trim());
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback;
}

function timestampMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value.trim());
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

export function isLikelyDeepSeekConversationsJson(parsed: unknown): boolean {
  if (!Array.isArray(parsed) || !parsed.length) return false;
  return parsed.some((item) =>
    item
    && typeof item === "object"
    && (
      (item as any).mapping && typeof (item as any).mapping === "object"
      || Array.isArray((item as any).chat_messages)
      || ("inserted_at" in item && ("title" in item || "id" in item))
    ));
}

function linearizeMappingNodes(mapping: Record<string, any>): any[] {
  const entries = Object.entries(mapping || {}).filter(([, node]) => node && typeof node === "object");
  if (!entries.length) return [];

  const nodesById = new Map<string, any>();
  const orderMap = new Map<string, number>();
  entries.forEach(([key, node], index) => {
    const id = String(node.id || key);
    nodesById.set(id, { ...node, id });
    orderMap.set(id, index);
  });

  // 找到所有叶子节点，选取时间戳/序号最新的一支回溯主干路径，兼容分叉重生分支
  const leaves: Array<{ id: string; score: number; order: number }> = [];
  for (const [id, node] of nodesById.entries()) {
    const children = Array.isArray(node.children)
      ? node.children.filter((cid: unknown) => nodesById.has(String(cid)))
      : [];
    if (!children.length && node.message) {
      const score = timestampMs(node.message?.inserted_at ?? node.message?.created_at ?? node.inserted_at);
      leaves.push({ id, score, order: orderMap.get(id) ?? 0 });
    }
  }

  if (leaves.length) {
    leaves.sort((a, b) => (b.score - a.score) || (b.order - a.order));
    const chain: any[] = [];
    const seen = new Set<string>();
    let cursorId: string | null = leaves[0].id;
    while (cursorId && nodesById.has(cursorId) && !seen.has(cursorId)) {
      seen.add(cursorId);
      const node = nodesById.get(cursorId);
      if (node.message) chain.push(node.message);
      cursorId = node.parent !== undefined && node.parent !== null ? String(node.parent) : null;
    }
    chain.reverse();
    if (chain.length) return chain;
  }

  // 兜底：无 parent 链时按原出现顺序返回非空消息
  return entries
    .map(([, node]) => node.message)
    .filter((msg) => msg && typeof msg === "object");
}

function convertRawMessageNodes(rawMessages: any[], fallbackIso: string): any[] {
  const out: any[] = [];
  for (const msg of rawMessages) {
    if (!msg || typeof msg !== "object") continue;
    const createdAt = normalizeIsoTimestamp(msg.inserted_at ?? msg.created_at ?? msg.createdAt, fallbackIso);

    if (Array.isArray(msg.fragments) && msg.fragments.length) {
      const requests: string[] = [];
      const thinks: string[] = [];
      const responses: string[] = [];
      for (const fragment of msg.fragments) {
        if (!fragment || typeof fragment !== "object") continue;
        const type = String(fragment.type || "").toUpperCase();
        const text = typeof fragment.content === "string" ? fragment.content : "";
        if (!text.trim()) continue;
        if (type === "REQUEST") requests.push(text);
        else if (type === "THINK") thinks.push(text);
        else if (type === "RESPONSE") responses.push(text);
      }
      if (requests.length) {
        out.push({
          id: crypto.randomUUID(),
          role: "user",
          content: requests.join("\n\n").trim(),
          createdAt,
        });
      }
      if (responses.length || thinks.length) {
        out.push({
          id: crypto.randomUUID(),
          role: "assistant",
          content: responses.join("\n\n").trim(),
          ...(thinks.length ? { reasoning: thinks.join("\n\n").trim() } : {}),
          createdAt,
          taskStatus: "done",
        });
      }
      continue;
    }

    const roleRaw = String(msg.role || "").toLowerCase();
    const role = roleRaw === "user" ? "user" : roleRaw === "assistant" ? "assistant" : "";
    if (!role) continue;
    const content = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((part: any) => (typeof part?.text === "string" ? part.text : "")).filter(Boolean).join("\n")
        : "";
    const reasoning = String(msg.reasoning_content ?? msg.thinking_content ?? msg.reasoning ?? "").trim();
    if (!content.trim() && !reasoning) continue;
    out.push({
      id: crypto.randomUUID(),
      role,
      content: content.trim(),
      ...(role === "assistant" && reasoning ? { reasoning } : {}),
      createdAt,
      ...(role === "assistant" ? { taskStatus: "done" } : {}),
    });
  }
  return out;
}

export function parseDeepSeekConversations(
  jsonText: string,
  options: { hasSession?: (id: string) => boolean } = {},
): { ok: true; sessions: any[]; renamed: number } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(jsonText || ""));
  } catch {
    return { ok: false, error: "conversations.json 不是合法的 JSON" };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "DeepSeek 导出格式无效：顶层应为对话数组" };
  }

  const nowIso = new Date().toISOString();
  const seenIds = new Set<string>();
  const sessions: any[] = [];
  let renamed = 0;

  for (const conv of parsed) {
    if (!conv || typeof conv !== "object") continue;
    const createdAt = normalizeIsoTimestamp((conv as any).inserted_at ?? (conv as any).created_at ?? (conv as any).createdAt, nowIso);
    const updatedAt = normalizeIsoTimestamp((conv as any).updated_at ?? (conv as any).updatedAt, createdAt);
    const rawNodes = (conv as any).mapping && typeof (conv as any).mapping === "object"
      ? linearizeMappingNodes((conv as any).mapping)
      : Array.isArray((conv as any).chat_messages)
        ? (conv as any).chat_messages
        : Array.isArray((conv as any).messages)
          ? (conv as any).messages
          : [];
    const messages = convertRawMessageNodes(rawNodes, createdAt);
    if (!messages.length) continue;

    let id = String((conv as any).id || "").trim() || crypto.randomUUID();
    if (seenIds.has(id) || options.hasSession?.(id)) {
      id = crypto.randomUUID();
      renamed += 1;
    }
    seenIds.add(id);

    const title = String((conv as any).title || (conv as any).name || "DeepSeek 导入对话").trim() || "DeepSeek 导入对话";
    sessions.push({
      id,
      title,
      titleCustom: true,
      workspacePath: "",
      createdAt,
      updatedAt,
      messages,
    });
  }

  return { ok: true, sessions, renamed };
}
