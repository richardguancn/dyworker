// 策略插件样板：敏感凭据路径守卫（tools/pre-execute 的第一个真实消费者）。
//
// 接缝语义（见 host/events.mts 与 docs/architecture.md）：
//   - 事件在 runAgent 判定「用户/工作区钩子没有结论」之后才被咨询；
//   - 事件只能**追加限制**：这里对敏感文件强制审批，不能把已被钩子拦下的操作放行；
//   - 返回 { action: "require_approval" } 会经 hookRequiresApproval 走「ask」分支，
//     该分支在 evaluateApproval 里压过常驻允许规则与 full-access 放行
//     （agent.mts：hookRequiresApproval 判定在 full-access 之前）。
//
// 为什么值得默认开启：凭据类文件（私钥、.env、凭据库）一旦被读取，内容就进了模型
// 上下文与转录留痕，事后无法回收。审批是「收紧」而不是「阻断」——用户点一次即可继续。
//
// 本文件不依赖 electron，node --test 直测。
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
const FILE_TARGET_TOOLS = new Set(["read_file", "write_file", "edit_file", "append_file", "delete_file", "make_directory",
  "list_files", "find_files", "search_in_files", "copy_file", "move_file", "scan_sensitive_info",
  "check_official_document", "export_word_document", "export_excel_workbook"]);
const PUBLIC_SSH_REFERENCE = /(^|[\s"'=;|(&])(?:[^\s"'<>;|&()]*[\\/])?\.ssh[\\/](?:[^\s/\\]+\.pub|authorized_keys|known_hosts)(?=$|[\s"'<>;|&()])/g;
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
  if (name === "save_memory") return null;
  const values = FILE_TARGET_TOOLS.has(name) ? { path: args?.path, source: args?.source, target: args?.target } : args;
  const texts = collectStrings(values);
  // 公钥文件不能通过软链接伪装成私钥。这里仅解析文件名，不读取文件内容。
  if (name === "read_file" && typeof args?.path === "string") {
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
    // 复合/远程命令中只出现公共 SSH 文件时不直接放行，也不把它断言成私钥读取。
    // 审核助手须结合当前脚本、用户任务与实际读写方向判断；出现任何私钥/目录/
    // 其他秘密引用仍强制人工确认，不能被同一命令中的公钥引用掩盖。
    if (name === "run_command" && !sensitiveMatch(text.replace(PUBLIC_SSH_REFERENCE, "$1[公共 SSH 文件]"))) {
      publicReference = { label: "SSH 公共文件（需核对读写用途）", sample: text.slice(0, 200), reviewable: true };
    } else return { label, sample: text.slice(0, 200) };
  }
  return publicReference;
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
          message: `「${name}」涉及受保护的文件（${hit.label}）：${hit.sample}。请核对本次访问的用途与影响。`,
        };
      });
    },
  };
}
