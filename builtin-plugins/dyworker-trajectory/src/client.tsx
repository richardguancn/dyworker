// 轨迹插件 · 客户端半边（源码；构建产物是同目录的 ../client.js）
//
// 视图本身复用仓库里的 TraceView（打包时一起打进来），插件负责的是：
//   1. 注册会话区「轨迹」标签（conversation.view 插槽）
//   2. 通过自己的主机路由 /api/dyworker-trajectory/read 增量取本会话的 trace 事件
//   3. 会话消息（用户输入兜底、思考正文）从 ctx.sessions.binding 拿
//
// 为什么增量取：一轮任务里 trace 是追加写的，每 2 秒只拉新增的那一段；
// total 变小说明文件被重写（换会话/重启），这时从头再来。

import * as React from "react";
import { TraceView } from "../../../src/TraceView";
import type { TraceEvent } from "../../../src/types";

const ROUTE = "/api/dyworker-trajectory/read";
const POLL_MS = 2000;
const PAGE_LIMIT = 4000;

interface PageResult {
  ok: boolean;
  records?: TraceEvent[];
  total?: number;
  offset?: number;
  hasMore?: boolean;
  error?: string;
}

/** 插件视图拿到的是壳层给的 props（sessionId / useProjection / t）+ 我们自己 inject 的 session */
interface PluginViewProps {
  sessionId?: string;
  session?: { messages?: unknown[] } | null;
}

function TrajectoryPluginView(props: PluginViewProps) {
  const sessionId = String(props.sessionId || "");
  const messages = props.session?.messages;
  const [records, setRecords] = React.useState<TraceEvent[]>([]);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const offset = React.useRef(0);

  // 换会话：已取到的记录与偏移都作废
  React.useEffect(() => {
    offset.current = 0;
    setRecords([]);
    setError("");
  }, [sessionId]);

  const load = React.useCallback(async () => {
    if (!sessionId) return;
    try {
      const response = await fetch(ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, offset: offset.current, limit: PAGE_LIMIT }),
      });
      const data = (await response.json()) as PageResult;
      if (!data?.ok) {
        setError(String(data?.error || `轨迹接口返回 ${response.status}`));
        return;
      }
      const total = Number(data.total) || 0;
      const incoming = Array.isArray(data.records) ? data.records : [];
      // 文件被重写（total 比已读偏移还小）或换了会话：从头重来
      if (total < offset.current) {
        offset.current = 0;
        setRecords(incoming);
        offset.current = incoming.length;
      } else if (incoming.length) {
        setRecords((previous) => [...previous, ...incoming]);
        offset.current += incoming.length;
      } else {
        offset.current = offset.current;
      }
      setError("");
      if (data.hasMore) setTimeout(() => { void load(); }, 0);
    } catch (fetchError: any) {
      setError(String(fetchError?.message || fetchError));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  React.useEffect(() => {
    if (!sessionId) return undefined;
    setLoading(true);
    void load();
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [sessionId, load]);

  if (!sessionId) {
    return React.createElement("p", { className: "plugins-empty" }, "先选一个会话。");
  }
  if (error) {
    return React.createElement("p", { className: "plugins-empty" }, `轨迹数据没取到：${error}`);
  }
  if (!records.length) {
    return React.createElement("p", { className: "plugins-empty" }, loading ? "正在读取轨迹…" : "这个会话还没有轨迹记录（发起任务后就会出现）。");
  }
  return React.createElement(TraceView, { traces: records, messages, sessionId });
}

export default {
  name: "dyworker-trajectory-client",
  inject: ["slots", "sessions"],
  apply(ctx: any) {
    ctx.slots.inject("conversation.view", () => ctx.slots.register({
      name: "conversation.view",
      id: "trajectory",
      key: "trajectory",
      order: 20,
      label: () => "轨迹",
      // 同步返回、不能抛：拿不到会话就给 null，视图自己显示空态
      inject: (sessionId: string) => ({
        session: ctx.sessions.binding(sessionId)?.session ?? null,
      }),
    }, TrajectoryPluginView));
  },
};
