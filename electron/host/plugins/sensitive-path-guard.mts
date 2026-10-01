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
const SENSITIVE_PATH_PATTERNS = [
  { re: /(^|[\\/])\.ssh([\\/]|$)/, label: "SSH 目录（可能含私钥）" },
  { re: /(^|[\\/])id_(rsa|dsa|ecdsa|ed25519)$/i, label: "SSH 私钥" },
  { re: /(^|[\\/])\.aws([\\/]|$)/, label: "AWS 凭据" },
  { re: /(^|[\\/])\.(git-credentials|netrc)([\\/]|$)/, label: "Git/HTTP 凭据" },
  { re: /(^|[\\/])\.npmrc([\\/]|$)/, label: "npm 令牌" },
  { re: /(^|[\\/])\.docker[\\/]config\.json$/, label: "Docker 凭据" },
  { re: /(^|[\\/])\.kube[\\/]config$/, label: "Kubernetes 凭据" },
  { re: /(^|[\\/])\.env(\.[A-Za-z0-9_-]+)?$/, label: "环境变量文件" },
  { re: /(channel-credentials|imported-passwords)\.json$/i, label: "DYWorker 凭据库" },
];

// 工具入参里路径可能出现在任意深度（args.path、args.command、args.files[i]…），
// 递归把所有字符串收集出来再逐条匹配；不解析命令语法，宁可多问一次
function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, out);
  return out;
}

// 返回首个命中的 { label, sample }，未命中返回 null
export function findSensitiveReference(args) {
  for (const text of collectStrings(args)) {
    for (const { re, label } of SENSITIVE_PATH_PATTERNS) {
      if (re.test(text)) return { label, sample: text.slice(0, 200) };
    }
  }
  return null;
}

export function sensitivePathGuardPlugin(options: any = {}) {
  const action: "block" | "require_approval" = options.action || "require_approval";
  return {
    name: "policy:sensitive-path-guard",
    apply(ctx: any) {
      ctx.on("tools/pre-execute", (name, args, current, next) => {
        const hit = findSensitiveReference(args);
        // 未命中：必须调 next() 委托给后续监听器（返回 null 会截断整条链）
        if (!hit) return next();
        return {
          action,
          message: `「${name}」触碰敏感文件（${hit.label}）：${hit.sample}。请确认是否允许读取。`,
        };
      });
    },
  };
}
