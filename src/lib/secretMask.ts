export interface SecretSpan {
  start: number;
  end: number;
  kind: string;
  masked: string;
}

interface SecretRule {
  kind: string;
  pattern: RegExp;
  /** 可选捕获组索引（仅遮罩该捕获组，保留前缀/协议等上下文可读） */
  group?: number;
}

const SECRET_RULES: SecretRule[] = [
  {
    kind: "pem",
    pattern: /-----BEGIN [A-Z0-9 ]{1,40}PRIVATE KEY-----[\s\S]{1,16384}?-----END [A-Z0-9 ]{1,40}PRIVATE KEY-----/g,
  },
  {
    kind: "url-password",
    pattern: /https?:\/\/[^/\s:@]{1,64}:([^@\s/]{4,128})@/g,
    group: 1,
  },
  {
    kind: "sk",
    pattern: /\bsk-(?:proj-|ant-|or-)?[A-Za-z0-9_-]{16,}/g,
  },
  {
    kind: "github",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  },
  {
    kind: "aws",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    kind: "aliyun",
    pattern: /\bLTAI[A-Za-z0-9]{12,24}\b/g,
  },
  {
    kind: "tencent",
    pattern: /\bAKID[A-Za-z0-9]{13,32}\b/g,
  },
  {
    kind: "slack",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}/g,
  },
  {
    kind: "bearer",
    pattern: /\bBearer[ \t]+([A-Za-z0-9._~+/=-]{20,})/g,
    group: 1,
  },
];

export function maskSecretValue(raw: string, kind = ""): string {
  const value = String(raw || "");
  if (kind === "pem" || value.includes("PRIVATE KEY-----")) {
    return "[已遮罩私钥 PEM]";
  }
  if (kind === "url-password") {
    return "••••••";
  }
  if (value.length <= 10) {
    return "••••••••";
  }
  const head = value.startsWith("sk-") || value.startsWith("gh") || value.startsWith("LTAI") || value.startsWith("AKIA") || value.startsWith("AKID")
    ? Math.min(6, Math.max(3, value.length - 6))
    : 4;
  return `${value.slice(0, head)}••••${value.slice(-4)}`;
}

/** 线性扫描文本中的凭据片段，返回去重且按 start 升序的不重叠区间 */
export function findSecretSpans(text: string): SecretSpan[] {
  if (!text || text.length < 16) return [];
  const candidates: SecretSpan[] = [];
  for (const rule of SECRET_RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(text))) {
      let start = match.index;
      let secretText = match[0];
      if (rule.group && match[rule.group] !== undefined) {
        const sub = match[rule.group];
        const offset = match[0].indexOf(sub);
        if (offset < 0 || !sub) continue;
        start += offset;
        secretText = sub;
      }
      const end = start + secretText.length;
      candidates.push({
        start,
        end,
        kind: rule.kind,
        masked: maskSecretValue(secretText, rule.kind),
      });
    }
  }
  if (!candidates.length) return [];

  candidates.sort((a, b) => (a.start - b.start) || ((b.end - b.start) - (a.end - a.start)));
  const merged: SecretSpan[] = [];
  let cursor = 0;
  for (const item of candidates) {
    if (item.start < cursor) continue;
    merged.push(item);
    cursor = item.end;
  }
  return merged;
}
