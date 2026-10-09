// 只读取实际入口的 import / require 图，不把 peerDependencies 当成安装清单。
// 一个包同时有客户端和主机入口时，两张图保持分开，客户端不能拉入后台服务。
import fs from 'node:fs/promises';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { splitModuleSpec } from './plugin-client.mts';

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

export function readRuntimeImports(source: string): string[] {
  const names = new Set<string>();
  // 轻量词法扫描：注释与字符串各自成为一个 token，字符串里的示例不当作代码。
  const tokens: Array<{ value: string; string: boolean }> = [];
  const pattern = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g;
  for (const match of source.matchAll(pattern)) {
    const value = match[0];
    if (value.startsWith('//') || value.startsWith('/*')) continue;
    const string = value.startsWith('"') || value.startsWith("'") || value.startsWith('`');
    tokens.push({ value: string ? value.slice(1, -1) : value, string });
  }
  const add = (token: { value: string; string: boolean } | undefined) => {
    if (token?.string && !builtins.has(token.value) && !token.value.startsWith('node:')) names.add(token.value);
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.string) continue;
    if (token.value === 'require' && tokens[index + 1]?.value === '(') add(tokens[index + 2]);
    if (token.value !== 'import' && token.value !== 'export') continue;
    const next = tokens[index + 1];
    if (next?.string && token.value === 'import') { add(next); continue; }
    if (next?.value !== '{' && next?.value !== '*' && token.value === 'export') continue;
    if (next?.value === '(' || next?.value === '.') continue; // 动态 import / import.meta
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].value === ';' && !tokens[cursor].string) break;
      if (tokens[cursor].value === 'from' && !tokens[cursor].string) { add(tokens[cursor + 1]); break; }
    }
  }
  return [...names];
}

/** 包内相对入口继续扫描，外部包返回给安装队列；不执行插件代码。 */
export async function runtimeImportsOf(pkgDir: string, entries: string[]): Promise<string[]> {
  const queue = [...entries];
  const seen = new Set<string>();
  const external = new Set<string>();
  while (queue.length && seen.size < 256) {
    const file = path.resolve(queue.shift()!);
    if (seen.has(file)) continue;
    seen.add(file);
    const relative = path.relative(pkgDir, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const source = await fs.readFile(file, 'utf8');
    for (const spec of readRuntimeImports(source)) {
      if (spec.startsWith('.')) queue.push(path.resolve(path.dirname(file), spec));
      else if (/^(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w./-]+)?$/.test(spec)) external.add(spec);
    }
  }
  if (queue.length) throw new Error('插件入口文件过多，已停止依赖扫描');
  return [...external];
}

export function runtimePackageName(spec: string): string { return splitModuleSpec(spec).name; }
