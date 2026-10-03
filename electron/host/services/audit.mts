// 审计日志服务：包装 electron/audit.mts 的 createAuditLog，挂入 cordis 生命周期。
// 审计落盘本身无需清理动作；服务化后由 ctx.audit 统一访问，后续 IPC 装配
// 不再直接持有模块级单例。
import { Service } from "@deepseek-ai/cordis";
import { createAuditLog } from "../../audit.mts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    audit: AuditService;
  }
}

export class AuditService extends Service {
  log;
  filePath;

  constructor(ctx, config = {} as any) {
    super(ctx, "audit");
    this.log = createAuditLog(config);
    // 审计日志落在 userData 根（不在插件数据目录内）。谁的文件谁负责暴露路径——
    // 插件不该自己拼，否则会写到别处（迁移到契约层时踩过）。
    this.filePath = String(config?.filePath || "");
  }

  /** 审计日志文件路径（不存在则为空串） */
  file() {
    return this.filePath;
  }

  record(entry) {
    return this.log.record(entry);
  }
}
