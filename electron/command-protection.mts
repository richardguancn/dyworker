import { StringDecoder } from 'node:string_decoder';

const containsSignature = (text: string, signatures: string[]) => {
  const lowered = text.toLowerCase();
  return signatures.some(signature => lowered.includes(signature.toLowerCase()));
};

export function protectionUnavailable(detail: string) {
  return Object.assign(new Error(detail), { code: 'SANDBOX_UNAVAILABLE' });
}

/** 本应用的受限命令要求完整写入保护；partial 不是可静默接受的成功。 */
export function requireCommandProtection(confined: any, mode = 'workspace-write') {
  if (!confined || !Array.isArray(confined.argv) || !confined.argv.length
    || confined.argv.some((value: any) => typeof value !== 'string') || !confined.argv[0]) {
    throw protectionUnavailable('执行保护没有提供有效的启动方式，命令未执行');
  }
  if (mode === 'danger-full-access' && confined.enforcement === 'explicit-host-grant') return confined;
  if (!['workspace-write', 'read-only'].includes(mode) || confined.enforcement !== 'full') {
    throw protectionUnavailable('当前执行保护不足以限制文件写入范围，命令未执行；没有自动扩大权限');
  }
  const strings = (value: any) => Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim());
  if (!strings(confined.denialSignatures) || !Array.isArray(confined.runnerFailureRules)
    || confined.runnerFailureRules.some((rule: any) => !rule || !strings(rule.fatalSignatures)
      || !rule.fatalSignatures.length
      || (rule.informationalLines !== undefined && !strings(rule.informationalLines))
      || (rule.allowedExitCodes !== undefined && (!Array.isArray(rule.allowedExitCodes)
        || !rule.allowedExitCodes.length || rule.allowedExitCodes.some((code: any) => !Number.isInteger(code) || code === 0))))) {
    throw protectionUnavailable('执行保护的检查依据不完整，命令未执行');
  }
  return confined;
}

/**
 * 与显示日志分开保存诊断依据，避免输出截断掩盖早期错误。
 * 按行排除 informationalLines；保留滚动片段，兼容跨 chunk 的签名且限制内存。
 */
export function createCommandDiagnostics(confined: any) {
  const rules = confined.runnerFailureRules || [];
  const signatures = confined.denialSignatures || [];
  const decoder = new StringDecoder('utf8');
  const width = Math.max(1, ...signatures.map((s: string) => s.length),
    ...rules.flatMap((rule: any) => [...rule.fatalSignatures, ...(rule.informationalLines || [])].map((s: string) => s.length)));
  let tail = '', linePrefix = '', lineLength = 0, lastCharacter = '';
  let denied = false, ended = false;
  const pending = new Set<number>();
  const evidence = new Map<number, string>();
  const endLine = () => {
    if (lastCharacter === '\r') {
      if (linePrefix.length === lineLength) linePrefix = linePrefix.slice(0, -1);
      lineLength--;
    }
    for (const index of pending) {
      const rule = rules[index];
      if ((rule.informationalLines || []).some((line: string) => lineLength === line.length && linePrefix.toLowerCase() === line.toLowerCase())) continue;
      if (!evidence.has(index)) evidence.set(index, linePrefix);
    }
    tail = ''; linePrefix = ''; lineLength = 0; lastCharacter = ''; pending.clear();
  };
  const admit = (text: string) => {
    for (const part of text.split(/(?<=\n)/)) {
      const combined = tail + part;
      if (containsSignature(combined, signatures)) denied = true;
      for (let i = 0; i < rules.length; i++) {
        if (containsSignature(combined, rules[i].fatalSignatures)) pending.add(i);
      }
      const body = part.replace(/\n$/, '');
      lineLength += body.length;
      if (body.length) lastCharacter = body.at(-1)!;
      linePrefix = (linePrefix + body).slice(0, Math.max(2048, width));
      tail = combined.slice(-width);
      if (part.endsWith('\n')) endLine();
    }
  };
  return {
    write(chunk: Buffer) { if (!ended) admit(decoder.write(chunk)); },
    finish(exitCode: number | null) {
      if (!ended) { admit(decoder.end()); endLine(); ended = true; }
      // 遵守官方规则的非零退出码及逐规则门槛；诊断优先于普通拒绝。
      for (const [index, detail] of evidence) {
        const rule = rules[index];
        if (exitCode !== null && exitCode !== 0 && (rule.allowedExitCodes === undefined || rule.allowedExitCodes.includes(exitCode))) {
          return { state: 'unavailable', errorCode: 'SANDBOX_UNAVAILABLE', detail };
        }
      }
      if (exitCode !== null && exitCode !== 0 && denied) return { state: 'denied', errorCode: 'SANDBOX_DENIED' };
      return { state: 'ready' };
    },
  };
}
