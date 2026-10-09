// 契约服务 ctx.tools：插件注册工具的唯一入口，也是"插件副作用受管"的落点。
//
// 四条硬规则（对应目标里的第 6 项）：
//   1. **名字由宿主生成**：插件给的名字一律加上 `plugin__<插件>__<工具>` 前缀，
//      插件无法冒充内置工具、也无法覆盖别人的工具；
//   2. **风险不降级**：凭主机侧 classify 判定，插件声明的 risk 只能用来"抬高"，
//      不能把有副作用的工具说成只读；
//   3. **内部调用也要受管**：非任务路径（插件在加载时/后台计时器/内部互调）触发
//      有副作用工具时直接拒绝，不能只保护模型调用入口；
//   4. **全程留痕**：每次调用（含被拒绝的）都写审计，记录工具名、归属插件事务、
//      决策与会话/任务标识。
//
// 与 electron 的边界：本文件不 import electron。
import { Service } from "@deepseek-ai/cordis";
import { RISK, classify } from "../../risk.mts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    tools: ToolsService;
  }
}

// 风险等级排序：插件声明的 risk 只能抬高，不能降低
const RISK_ORDER = [RISK.READ, RISK.EXTERNAL, RISK.WRITE_LOCAL, RISK.EXEC];
const riskRank = (risk) => Math.max(0, RISK_ORDER.indexOf(risk));
const higherRisk = (a, b) => (riskRank(a) >= riskRank(b) ? a : b);

export const PLUGIN_TOOL_PREFIX = "plugin__";
/** 将官方结构化输出转换为现有代理入口；文件变更只采纳宿主实际读回的记录。 */
export function pluginToolResult(output: any) {
  if (typeof output?.ok === "boolean") return output;
  return { ok: true,
    result: Array.isArray(output?.content) ? output.content.map(item => item.text || "").filter(Boolean).join("\n")
      : typeof output === "string" ? output : JSON.stringify(output),
    ...(output?.additionalContexts ? { additionalContexts: output.additionalContexts } : {}),
    ...(output?.concludesTurn ? { concludesTurn: true } : {}),
    changes: (output?.hostReceipts || []).map(receipt => ({ path: receipt.path, added: 0, removed: 0, receipt })),
  };
}

/** 工具名只留下安全字符，避免注入奇怪的名字 */
function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "tool";
}

export class ToolsService extends Service {
  static inject = ["audit"];

  /** 已注册工具：最终名 → 定义 */
  registry = new Map();
  /** 保留前缀：插件不得占用 */
  reserved;
  executionState = { count: 0 };
  get executing() { return this.executionState.count; }

  constructor(ctx, config = {} as any) {
    super(ctx, "tools");
    // 内置/保留名前缀：插件不得占用
    this.reserved = config.reserved || ["browser__", "mcp__", PLUGIN_TOOL_PREFIX];
  }

  /** 生成最终工具名（宿主决定，插件无法自选） */
  toolName(pluginId, name) {
    return `${PLUGIN_TOOL_PREFIX}${slug(pluginId)}__${slug(name)}`;
  }

  /**
   * 注册一个插件工具。
   * @returns 注销函数；请用 ctx.effect 绑定到插件生命周期
   */
  register({ plugin, name, description, parameters, risk, handler }) {
    const owner = String(plugin || "").trim();
    if (!owner) throw new Error("注册工具需要 plugin（归属插件标识）");
    const plain = String(name || "").trim();
    if (!plain) throw new Error("注册工具需要 name");
    if (typeof handler !== "function") throw new Error(`工具 ${plain} 需要 handler 函数`);

    const finalName = this.toolName(owner, plain);
    for (const prefix of this.reserved) {
      if (plain.startsWith(prefix) || finalName.startsWith(prefix) && prefix !== PLUGIN_TOOL_PREFIX) {
        throw new Error(`工具名 ${plain} 使用保留前缀 ${prefix}`);
      }
    }
    if (this.registry.has(finalName)) throw new Error(`工具已注册：${finalName}`);

    // 风险：宿主判定为准，插件的声明只能抬高
    const host = classify(finalName, {}, {});
    const declared = risk && RISK_ORDER.includes(risk) ? risk : RISK.READ;
    const effective = higherRisk(host.risk, declared);

    const entry = {
      name: finalName,
      plainName: plain,
      owner,
      description: String(description || "").slice(0, 500),
      parameters: parameters || { type: "object", properties: {} },
      declaredRisk: declared,
      risk: effective,
      consequential: host.consequential || riskRank(effective) > riskRank(RISK.READ),
      handler,
    };
    this.registry.set(finalName, entry);
    return () => {
      if (this.registry.get(finalName) === entry) this.registry.delete(finalName);
    };
  }

  owns(name) {
    return this.registry.has(String(name || ""));
  }

  list() {
    return [...this.registry.values()].map((entry) => ({
      name: entry.name,
      plainName: entry.plainName,
      owner: entry.owner,
      description: entry.description,
      risk: entry.risk,
      declaredRisk: entry.declaredRisk,
      consequential: entry.consequential,
    }));
  }

  /** 给模型看的工具定义（与内置/MCP 工具同形） */
  definitions() {
    return [...this.registry.values()].map((entry) => ({
      type: "function",
      function: {
        name: entry.name,
        description: entry.description,
        parameters: entry.parameters,
      },
    }));
  }

  /**
   * 执行插件工具。
   * @param source "agent"（模型在任务里调用，已经过审批链）| "internal"（插件内部/后台调用）
   */
  async execute(name, args = {}, { sessionId = "", runId = "", source = "internal", audit = true,
    signal = undefined, workspacePath = "", timeoutMs = 120_000 }: any = {}) {
    const entry = this.registry.get(String(name || ""));
    if (!entry) return { ok: false, error: `未知工具：${name}` };

    const auditEntry = async (decision, detail) => {
      if (!audit) return;
      try {
        // 等落盘：插件工具的调用留痕必须是持久的，不能只排队就返回
        await this.ctx.audit.record({
          tool: entry.name,
          riskClass: entry.risk,
          decision,
          sessionId,
          detail: detail ? String(detail).slice(0, 300) : undefined,
          ...(runId ? { runId } : {}),
        });
      } catch {
        // 审计失败不影响工具本身
      }
    };

    // 非任务路径的有副作用调用：拒绝并留痕，不能只保护模型入口
    if (source !== "agent" && entry.consequential) {
      const reason = `插件工具 ${entry.name} 属于有副作用调用（risk=${entry.risk}），不能在非任务路径（${source}）直接执行`;
      await auditEntry("blocked", reason);
      return { ok: false, error: reason, blocked: true };
    }

    try {
      this.executionState.count += 1;
      const executionSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
      executionSignal.throwIfAborted();
      const result = await entry.handler(args, { sessionId, runId, source, name: entry.name, signal: executionSignal, workspacePath });
      executionSignal.throwIfAborted();
      await auditEntry("executed", "");
      return { ok: true, result };
    } catch (error: any) {
      const reason = String(error?.message || error);
      await auditEntry("failed", reason);
      return { ok: false, error: reason };
    } finally { this.executionState.count = Math.max(0, this.executionState.count - 1); }
  }
}
