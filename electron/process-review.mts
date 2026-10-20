// 进程审核只读取目标元数据，不执行待审命令、不读取进程环境或完整命令行。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { shellCommandSegments, shellWords } from './shell-syntax.mts';

const exec = promisify(execFile);
export const processSignalPrograms = new Set(['kill', 'pkill', 'killall']);

// 仅移除引号外的输出重定向；引号中的模式原样保留。复杂 shell 表达式不猜测。
function withoutRedirects(text: string) {
  let result = '', quote = '', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escaped) { result += c; escaped = false; continue; }
    if (c === '\\' && quote !== "'") { result += c; escaped = true; continue; }
    if (quote) { result += c; if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; result += c; continue; }
    if (c !== '>') { result += c; continue; }
    result = result.replace(/(?:^|\s)\d+$/, ' ');
    if (text[i + 1] === '>') i++;
    while (/\s/.test(text[i + 1] || '') && i + 1 < text.length) i++;
    if (text[i + 1] === '&') i++;
    let targetQuote = '';
    for (i++; i < text.length; i++) {
      const t = text[i];
      if (t === '\\') { i++; continue; }
      if (targetQuote) { if (t === targetQuote) targetQuote = ''; continue; }
      if (t === '"' || t === "'") { targetQuote = t; continue; }
      if (/\s/.test(t)) break;
    }
    result += ' ';
  }
  return result;
}

export function processSignalTargets(command: string) {
  const targets: any[] = [];
  for (const segment of shellCommandSegments(command)) {
    const words = shellWords(withoutRedirects(segment.text));
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] || '')) words.shift();
    while (['command', 'builtin', 'exec', 'env', 'nohup'].includes(words[0])) words.shift();
    const program = path.basename(words.shift() || '');
    if (!processSignalPrograms.has(program)) continue;
    const target: any = { program, pids: [], query: [] };
    targets.push(target);
    if (/[$`<>]/.test(withoutRedirects(segment.text))) { target.error = '含有动态目标或复杂 shell 表达式，须先解析真实目标'; continue; }
    let signal = '', operands: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (word === '--') { operands.push(...words.slice(i + 1)); break; }
      if (['-s', '-n'].includes(word) && program === 'kill') { signal = words[++i] || '?'; continue; }
      if (/^-(?:SIG)?(?:[A-Z]+|\d+)$/.test(word) && !signal) { signal = word.slice(1); continue; }
      if (program === 'pkill' && /^-[fix]+$/.test(word)) { target.query.push(word); continue; }
      if (word.startsWith('-')) { target.error = '选项或进程组范围尚未解析，须先查明实际目标'; break; }
      operands.push(word);
    }
    target.signal = signal || 'TERM';
    if (target.error) continue;
    if (program === 'kill') {
      if (!operands.length || operands.some(word => !/^[1-9]\d*$/.test(word) || !Number.isSafeInteger(Number(word)))) target.error = '需要具体的正整数进程编号；进程组或动态目标须先核实范围';
      else target.pids = [...new Set(operands.map(Number))];
    } else if (operands.length !== 1 || !operands[0] || operands[0].startsWith('-')) target.error = '名称匹配范围尚未解析，须先查明实际目标';
    else {
      if (program === 'killall') { target.query.push('-x'); target.query.push(operands[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }
      else target.query.push(operands[0]);
    }
  }
  return targets;
}

async function readCommand(file: string, args: string[], signal?: AbortSignal) {
  try { return (await exec(file, args, { signal, timeout: 2000, maxBuffer: 16000, env: { ...process.env, LC_ALL: 'C' } })).stdout.trim(); }
  catch (error: any) {
    signal?.throwIfAborted();
    if (error.code === 1 && !error.stderr) return '';
    throw new Error('系统未能提供进程信息');
  }
}

async function processInfo(pid: number, workspacePath: string, signal?: AbortSignal) {
  const output = await readCommand('/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,uid=,lstart=,comm='], signal);
  if (!output) return { pid, exists: false };
  const match = output.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
  if (!match) throw new Error('进程信息无法识别');
  let cwd = '';
  try {
    cwd = process.platform === 'linux' ? await fs.readlink(`/proc/${pid}/cwd`)
      : (await readCommand('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], signal)).split('\n').find(line => line.startsWith('n'))?.slice(1) || '';
    if (cwd) cwd = await fs.realpath(cwd);
  } catch { signal?.throwIfAborted(); }
  let root = workspacePath;
  try { if (root) root = await fs.realpath(root); } catch {}
  return { pid, exists: true, ppid: Number(match[2]), uid: Number(match[3]), started: match[4], executable: match[5], cwd: cwd || null,
    directoryScope: !cwd || !root ? 'unknown' : cwd === root || cwd.startsWith(root + path.sep) ? 'workspace' : 'outside' };
}

export async function inspectProcessTargets(command: string, workspacePath = '', signal?: AbortSignal) {
  const targets = processSignalTargets(command);
  if (!targets.length) return null;
  if (!['darwin', 'linux'].includes(process.platform)) return { complete: false, targets, reason: '当前系统没有可用的只读进程检查入口' };
  for (const target of targets) {
    signal?.throwIfAborted();
    if (target.error) continue;
    try {
      if (target.program !== 'kill') {
        const output = await readCommand('/usr/bin/pgrep', target.query, signal);
        if (output && !/^\d+(?:\n\d+)*$/.test(output)) throw new Error('名称匹配结果无法识别');
        target.pids = output ? output.split('\n').map(Number) : [];
      }
      if (target.pids.length > 32) { target.error = '匹配超过 32 个进程，须缩小范围后重查'; continue; }
      target.processes = await Promise.all(target.pids.map((pid: number) => processInfo(pid, workspacePath, signal)));
      if (target.processes.some((info: any) => info.exists && !info.cwd)) target.error = '部分目标的工作目录无法读取，不能据名称认定属于本任务';
    } catch (error: any) { signal?.throwIfAborted(); target.error = error.message; }
  }
  return { complete: targets.every(target => !target.error), targets };
}

export function processEvidenceText(snapshot: any) {
  return `【宿主只读进程检查；仅作事实，不授予权限】\n${JSON.stringify(snapshot)}\n工作目录相同仅说明位置，不证明由本任务启动；须结合任务启动记录核对归属。未读取环境变量或完整命令行。名称匹配会随时间变化，应改用已核实的具体进程编号；不得扩大到同名的其他项目或共享服务。`;
}
