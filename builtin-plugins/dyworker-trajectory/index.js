// 轨迹插件 · 主机半边
//
// 只做一件事：把某个会话落盘的 trace 事件流（userData/traces/<id>.jsonl）按页读出来，
// 交给客户端半边。为什么不复用渲染端内存里的轨迹：插件是独立的一份代码，
// 走自己的 /api 路由才能既服务活动会话、又服务几十天前的历史会话。
//
// 客户端半边按 offset 增量拉取（见 src/client.tsx）：一轮任务里事件是追加写的，
// 每次只取新增部分，避免每次轮询都把整个 jsonl 传一遍。

import fs from "node:fs/promises";
import path from "node:path";

export const name = "dyworker-trajectory";
/** storage 提供 userData 路径；connection 提供插件自己的 HTTP 路由 */
export const inject = ["connection", "storage"];

const READ_ROUTE = "/api/dyworker-trajectory/read";
const DEFAULT_LIMIT = 4000;
const MAX_LIMIT = 20000;

/** 会话 id 进文件名前必须净化：只允许常规字符，防目录穿越 */
function safeSessionId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 200) return "";
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return "";
  return id;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * 读一页 trace 事件。
 * 请求：{ sessionId, offset?, limit? }
 * 响应：{ ok, records, total, offset, hasMore, updatedAt }
 */
async function readTraces(ctx, request) {
  let payload = {};
  try {
    payload = await request.json();
  } catch {
    // 空 body 也照常回答：返回 400 让调用方知道自己漏了参数
  }
  const sessionId = safeSessionId(payload?.sessionId);
  if (!sessionId) return jsonResponse({ ok: false, error: "sessionId 缺失或非法" }, 400);

  const base = String(ctx.storage?.hostDir || "");
  if (!base) return jsonResponse({ ok: false, error: "插件拿不到 userData 路径" }, 500);

  const offset = Math.max(0, Number(payload?.offset) || 0);
  const limit = Math.min(Math.max(1, Number(payload?.limit) || DEFAULT_LIMIT), MAX_LIMIT);
  const file = path.join(base, "traces", `${sessionId}.jsonl`);

  let updatedAt = "";
  try {
    updatedAt = (await fs.stat(file)).mtime.toISOString();
  } catch {
    // 没有落盘文件：如实回空，界面显示"这个会话还没有轨迹记录"
    return jsonResponse({ ok: true, records: [], total: 0, offset, hasMore: false, updatedAt: "" });
  }

  let content = "";
  try {
    content = await fs.readFile(file, "utf8");
  } catch (error) {
    return jsonResponse({ ok: false, error: `读取轨迹失败：${String(error?.message || error)}` }, 500);
  }
  const lines = content.split("\n").filter(Boolean);
  const slice = lines.slice(offset, offset + limit);
  const records = [];
  for (const line of slice) {
    try {
      records.push(JSON.parse(line));
    } catch {
      // 半截行（正在追加写）：跳过，下一次轮询会重新读到
    }
  }
  return jsonResponse({
    ok: true,
    records,
    total: lines.length,
    offset,
    hasMore: offset + slice.length < lines.length,
    updatedAt,
  });
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: READ_ROUTE,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: (request) => readTraces(ctx, request),
    }),
    "trajectory: read route",
  );
}
