// 会话存档服务：统一包装「按会话拆分存档 + 合并写入器」。读路径（历史检索、
// 会话工具、渠道工作区推导）与写路径（渲染端增量/整档）都经由 ctx.sessions；
// dispose 时 flush 合并写入器，保证退出前排队中的会话写盘完成。
import { Service } from "@deepseek-ai/cordis";
import { createSessionArchive } from "../../session-archive.mts";
import { createCoalescedWriter } from "../../session-store.mts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    sessions: SessionsService;
  }
}

export class SessionsService extends Service {
  archive;
  writer;

  constructor(ctx, config = {} as any) {
    super(ctx, "sessions");
    this.archive = createSessionArchive({ dir: config.dir, legacyFile: config.legacyFile });
    this.writer = createCoalescedWriter({
      minIntervalMs: 2000,
      write: (sessions) => this.archive.saveAll(sessions),
    });
    ctx.effect(() => () => this.writer.flush());
  }

  // 各只读消费方（历史检索、会话工具、渠道工作区推导等）统一入口。
  // 注：DSH 插件用的 sessions.get(id) 就是下面的 get，无需另加。
  loadAll() {
    return this.archive.loadAll();
  }

  get(sessionId) {
    return this.archive.get(sessionId);
  }

  getActiveId() {
    return this.archive.getActiveId();
  }

  applyDelta(delta) {
    return this.archive.applyDelta(delta);
  }

  upsert(session) {
    return this.archive.upsert(session);
  }

  appendMessages(sessionId, messages) {
    return this.archive.appendMessages(sessionId, messages);
  }

  requestSave(sessions) {
    this.writer.requestSave(sessions);
  }

  async flush() {
    return this.writer.flush();
  }
}
