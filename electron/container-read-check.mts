// 只证明固定容器内的系统头文件查询。解析文本，不执行或展开 shell。
// 不复用宽松 shell 拆词：必须保留引号、管道和重定向的真实边界。
function literalSegments(text: string): string[][] | null {
  if (!text.trim() || /[\r\n]/.test(text)) return null;
  const segments: string[][] = [];
  let words: string[] = [], word = '', started = false, quote = '';
  const flush = () => { if (started) words.push(word); word = ''; started = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === "'") { if (ch === quote) quote = ''; else word += ch; continue; }
    if (ch === '\\') {
      if (i + 1 === text.length) return null;
      const next = text[++i];
      word += quote === '"' && !/[\$`"\\]/.test(next) ? '\\' + next : next;
      started = true; continue;
    }
    if (quote === '"') {
      if (ch === quote) quote = '';
      else { if (/[\$`]/.test(ch)) return null; word += ch; }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) { flush(); continue; }
    // 丢弃的重定向只能是明确的标准输出/错误输出到空设备或 2>&1。
    const redirect = !started && text.slice(i).match(/^(?:[12]?>\s*\/dev\/null|2>&1)(?=\s|[;|&]|$)/);
    if (redirect) { i += redirect[0].length - 1; continue; }
    if (/[<>$`(){}#]/.test(ch)) return null;
    if (';|&'.includes(ch)) {
      if (ch === '&' && text[i + 1] !== '&') return null;
      flush(); if (!words.length) return null;
      segments.push(words); words = [];
      if ((ch === '&' || ch === '|') && text[i + 1] === ch) i++;
      continue;
    }
    word += ch; started = true;
  }
  if (quote) return null;
  flush(); if (!words.length) return null;
  segments.push(words); return segments;
}

function headerPath(value: string) {
  return /^\/usr\/include\//.test(value) && !value.split('/').includes('..');
}

function headerQuery(words: string[]) {
  const [program, ...args] = words;
  if (program === 'echo') return true;
  if (program === 'head' || program === 'tail') {
    return args.length === 1 && /^-\d+$/.test(args[0]);
  }
  if (program !== 'grep') return false;
  let index = 0;
  while (index < args.length && /^-[rRnsvEiIFcloHwha]+$/.test(args[index])) index++;
  if (args[index] === '--') index++;
  if (index >= args.length || args[index].startsWith('-')) return false;
  // 第一个非选项是匹配文字，余下只能是系统头文件；没有文件时读取管道。
  return args.slice(index + 1).every(headerPath);
}

export function isContainerHeaderReadCommand(command: string) {
  const segments = literalSegments(String(command || ''));
  if (!segments) return false;
  let containers = 0;
  for (const words of segments) {
    if (words[0] === 'cd' && words.length === 2) continue;
    if (words[0] !== 'docker' || words[1] !== 'exec') return false;
    // 不接受提权、环境注入、用户切换、远端 daemon 或多层执行入口。
    if (words.length !== 6 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(words[2])
      || !['bash', 'sh'].includes(words[3]) || !['-c', '-lc'].includes(words[4])) return false;
    const queries = literalSegments(words[5]);
    if (!queries?.length || !queries.every(headerQuery)) return false;
    // 只有过滤管道而没有头文件输入不能作为容器查询证明。
    if (!queries.some(query => query[0] === 'grep' && query.slice(2).some(headerPath))) return false;
    containers++;
  }
  return containers > 0;
}
