// 敏感路径是风险证据，不等于秘密已被读取或外发。
// 文件工具可能将内容直接交给模型，命令也可能只在进程内使用
// 配置，必须将完整命令和风险证据交给审核助手判断。reviewable 不是放行，
// 只在用户选择「替我审批」时允许自动审核；用户钩子和 block 仍优先。
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sensitiveMetadataInspection } from "../../sensitive-metadata.mts";
const SENSITIVE_PATH_PATTERNS = [
  { re: /(^|[\\/])\.ssh([\\/]|$)/, label: "SSH 目录（可能含私钥）" },
  { re: /(^|[\\/])id_(rsa|dsa|ecdsa|ed25519)$/i, label: "SSH 私钥" },
  { re: /(^|[\\/])\.aws([\\/]|$)/, label: "AWS 凭据" },
  { re: /(^|[\\/])\.(git-credentials|netrc)([\\/]|$)/, label: "Git/HTTP 凭据" },
  { re: /(^|[\\/])\.npmrc([\\/]|$)/, label: "npm 配置（可能含令牌）" },
  { re: /(^|[\\/])\.docker[\\/]config\.json$/, label: "Docker 凭据" },
  { re: /(^|[\\/])\.kube[\\/]config$/, label: "Kubernetes 凭据" },
  { re: /(^|[\\/])\.env(\.[A-Za-z0-9_-]+)?$/, label: "环境变量文件" },
  { re: /(channel-credentials|imported-passwords)\.json$/i, label: "DYWorker 凭据库" },
];
const FILE_TARGET_TOOLS = new Set(["read_file", "view_image", "write_file", "edit_file", "append_file", "delete_file", "make_directory",
  "list_files", "find_files", "search_in_files", "copy_file", "move_file", "scan_sensitive_info",
  "check_official_document", "export_word_document", "export_excel_workbook"]);
function sensitiveMatch(text: string) {
  for (const token of [text, ...text.split(/[\s"'=<>;|&()]+/)]) {
    for (const { re, label } of SENSITIVE_PATH_PATTERNS) if (re.test(token)) return label;
  }
  return "";
}

// 未知工具继续保守扫描。已知文件工具只扫描真正的访问对象，正文提到路径不是访问。
function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, out);
  return out;
}

// 返回首个命中的 { label, sample }，未命中返回 null
export function findSensitiveReference(args, name = "") {
  if (["save_memory", "save_skill", "update_skill"].includes(name)) return null;
  const values = FILE_TARGET_TOOLS.has(name) ? { path: args?.path, source: args?.source, target: args?.target } : args;
  const metadata = name === "run_command" ? sensitiveMetadataInspection(args?.command) : null;
  const texts = collectStrings(metadata?.facts.length ? { ...args, command: metadata.residual } : values);
  // 公钥文件不能通过软链接伪装成私钥。这里仅解析文件名，不读取文件内容。
  if (["read_file", "view_image"].includes(name) && typeof args?.path === "string") {
    try { texts.push(realpathSync(args.path.startsWith("~/") ? path.join(os.homedir(), args.path.slice(2)) : args.path)); } catch {}
  }
  const fingerprintOnly = name === "run_command" && /^\s*ssh-keygen\s+-lf\s+(?:'[^']+'|"[^"$`]+"|[^\s;$`|&<>()"']+)\s*$/.test(String(args?.command || ""));
  // 守卫没有任务工作目录；相对路径不能用进程目录代替任务目录验证软链接。
  const publicRead = name === "read_file" && typeof args?.path === "string" && (path.isAbsolute(args.path) || args.path.startsWith("~/"));
  let publicReference: any = null;
  for (const text of texts) {
    // .pub 明确是公钥材料；authorized_keys/known_hosts 仅在直接读取时豁免，
    // 修改这些文件仍须确认，未知工具和目录访问不能用公钥文件名覆盖私钥访问。
    const publicFiles = publicRead ? "(?:[^\\s/\\\\]+\\.pub|authorized_keys|known_hosts)" : "[^\\s/\\\\]+\\.pub";
    const checked = publicRead || fingerprintOnly
      ? text.replace(new RegExp(`(^|[\\s\\"'=;|(&])(?:[^\\s\\"'<>;|&()]*[\\\\/])?\\.ssh[\\\\/]${publicFiles}(?=$|[\\s\\"'<>;|&()])`, "g"), "$1[公开 SSH 文件]") : text;
    const label = sensitiveMatch(checked);
    if (!label) continue;
    if (name === "run_command") {
      publicReference = { label, sample: text.slice(0, 200), reviewable: true };
    } else return { label, sample: text.slice(0, 200), reviewable: true };
  }
  return publicReference || (metadata?.facts.length ? { label: "受限元信息检查", sample: metadata.facts.join("；"), reviewable: true } : null);
}

export function sensitivePathGuardPlugin(options: any = {}) {
  const action: "block" | "require_approval" = options.action || "require_approval";
  return {
    name: "policy:sensitive-path-guard",
    apply(ctx: any) {
      ctx.on("tools/pre-execute", (name, args, current, next) => {
        const hit = findSensitiveReference(args, name);
        // 未命中：必须调 next() 委托给后续监听器（返回 null 会截断整条链）
        if (!hit) return next();
        return {
          action,
          reviewable: action === "require_approval" && hit.reviewable === true,
          message: `「${name}」涉及受保护的文件（${hit.label}）：${hit.sample}。这是路径风险提示，不代表已读取或泄露秘密。请结合完整操作核对：配置是否仅在进程内正常使用、输出哪些值、发送给谁、是否符合用户任务。不得仅凭注释或文件名放行。`,
        };
      });
    },
  };
}
