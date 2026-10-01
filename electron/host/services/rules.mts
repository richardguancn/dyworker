// 常驻允许规则服务（ctx.rules）：把「读/写 standing-rules.json + 规则可生效性校验」
// 从 main.mts 与 IPC 插件里收编为 cordis 服务。
// 职责边界：
//   - list()：读规则数组（文件损坏/缺失时返回空数组）
//   - add()：校验 kind/工具/模式，并用 agent 侧同一套 suggestStandingRule 判定
//     「这类操作是否真的可以始终允许」，通过后去重写入
//   - remove()：按 id 删除
// 本文件不依赖 electron：规则文件路径由宿主注入，可 node --test 直测。
import { Service } from "cordis";
import crypto from "node:crypto";
import { suggestStandingRule } from "../../agent.mts";
import { readJson, writeJson } from "../io.mts";

declare module "cordis" {
  interface Context {
    rules: RulesService;
  }
}

// 可规则化的四类：路径 glob、域名、MCP 工具名、命令前缀
const RULE_KINDS = ["path-glob", "domain", "mcp-tool", "command-prefix"];

export class RulesService extends Service {
  filePath;

  constructor(ctx, config = {} as any) {
    super(ctx, "rules");
    this.filePath = config.filePath;
  }

  async list() {
    const rules = await readJson(this.filePath, []);
    return Array.isArray(rules) ? rules : [];
  }

  // 校验用探针参数：与 agent 侧匹配规则时构造的入参保持同一形状，
  // 否则「保存时能规则化、运行时匹配不上」会静默失效
  probeArgs(kind, tool, pattern) {
    return kind === "path-glob" ? { path: pattern }
      : kind === "domain" ? { url: `https://${pattern}/` }
      : kind === "command-prefix" ? { command: pattern }
      : {};
  }

  async add(payload) {
    const kind = String(payload?.kind || "");
    const tool = String(payload?.tool || "");
    const pattern = String(payload?.pattern || "").trim();
    const label = String(payload?.label || "").trim().slice(0, 120);
    if (!RULE_KINDS.includes(kind)) return { ok: false, error: "规则类型无效" };
    if (!tool || !pattern) return { ok: false, error: "规则内容不完整" };
    // 用 agent 侧同一套判定确保规则确实能生效（不可规则化时 suggest 返回 null）
    const probeTool = kind === "mcp-tool" ? pattern : tool;
    if (!suggestStandingRule(probeTool, this.probeArgs(kind, tool, pattern))) {
      return { ok: false, error: "这类操作不支持始终允许，需要逐次确认" };
    }
    const rules = await this.list();
    if (rules.some((rule) => rule.kind === kind && rule.tool === tool && rule.pattern === pattern)) {
      return { ok: true, duplicated: true };
    }
    rules.push({ id: crypto.randomUUID(), kind, tool, pattern, label: label || pattern, createdAt: new Date().toISOString() });
    await writeJson(this.filePath, rules);
    return { ok: true };
  }

  async remove(id) {
    const rules = await this.list();
    await writeJson(this.filePath, rules.filter((rule) => String(rule.id) !== String(id)));
    return { ok: true };
  }
}
