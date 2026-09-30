// 审计日志服务：包装 electron/audit.mts 的 createAuditLog，挂入 cordis 生命周期。
// 审计落盘本身无需清理动作；服务化后由 ctx.audit 统一访问，后续 IPC 装配
// 不再直接持有模块级单例。
import { Service } from "cordis";
import { createAuditLog } from "../../audit.mts";

declare module "cordis" {
  interface Context {
    audit: AuditService;
  }
}

export class AuditService extends Service {
  log;

  constructor(ctx, config = {} as any) {
    super(ctx, "audit");
    this.log = createAuditLog(config);
  }

  record(entry) {
    return this.log.record(entry);
  }
}
