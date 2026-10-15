import { shellWords, shellCommandSegments } from './shell-syntax.mts';

const envFile = (value: string) => /(?:^|[\\/])\.env(?:\.[A-Za-z0-9_-]+)?$/.test(value);
const namesPattern = (value: string) => /^\^\[(?:A-Z|a-z|0-9|_)+\]\+=$/.test(value);

// 仅证明特定输入的输出受限，不授予执行权限。当前整条操作仍由审核助手按任务判断。
// 不尝试理解任意脚本或任意正则：无法证明不输出值时，保留敏感文件强制确认。
export function sensitiveMetadataInspection(command: unknown) {
  const source = String(command || '');
  if (/<<|`|\$\(|<\(|>\(/.test(source)) return { residual: source, facts: [] as string[] };
  const residual = [], facts: string[] = [];
  for (const { text, operator } of shellCommandSegments(source)) {
    // 只移除无数据的标准错误重定向；其他重定向、变量扩展或动态执行不参与证明。
    const clean = text.replace(/\s+2>\s*\/dev\/null(?=\s|$)|\s+2>&1(?=\s|$)/g, ' ');
    if (/[<>$]/.test(clean)) { residual.push(text + operator); continue; }
    const words = shellWords(clean);
    const program = words[0];
    let proved = '';
    if (program === 'wc') {
      let index = 1, flags = '';
      while (/^-[lcm]+$/.test(words[index] || '')) flags += words[index++].slice(1);
      if (words[index] === '--') index++;
      if (flags && index < words.length && words.slice(index).every(envFile)) proved = '仅统计配置文件的行数、字节数或字符数，不输出配置值';
    } else if (program === 'grep') {
      let index = 1, flags = '';
      while (/^-[Eoch]+$/.test(words[index] || '')) flags += words[index++].slice(1);
      if (words[index] === '--') index++;
      const pattern = words[index++], files = words.slice(index);
      if (files.length && files.every(envFile)) {
        if (flags.includes('o') && flags.includes('E') && !flags.includes('c') && namesPattern(pattern)) proved = '仅提取配置键名及等号，不输出配置值';
        if (flags === 'c' && ['.', '^'].includes(pattern)) proved = '仅统计配置文件行数，不按秘密值探测，也不输出行内容';
      }
    } else if (program === 'ls') {
      let index = 1;
      while (/^-[ladhtn]+$/.test(words[index] || '')) index++;
      if (words[index] === '--') index++;
      if (index < words.length && words.slice(index).every(value => /(?:^|[\\/])\.ssh[\\/]?$/.test(value))) proved = '仅列出 SSH 目录文件名和属性，不读取文件内容';
    } else if (['echo', 'printf'].includes(program) && !/[<>$`]/.test(text)) {
      // 普通输出文字中的路径不是文件访问。其余命令和真正的重定向继续扫描。
      residual.push(operator); continue;
    }
    if (proved) { facts.push(proved); residual.push(operator); }
    else residual.push(text + operator);
  }
  return { residual: residual.join('\n'), facts: [...new Set(facts)] };
}
