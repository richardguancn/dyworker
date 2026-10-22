import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// 仅展开本次按职责拆出的模块，既有旁支仍由各自的测试覆盖。
// 定义排在入口之前，让旧有的源码定位检查继续找到实际实现。
export function readModuleSource(entry) {
  const file = entry instanceof URL ? fileURLToPath(entry) : path.resolve(entry);
  const directory = path.join(path.dirname(file), path.basename(file) === 'agent.mts' ? 'agent' : 'desktop');
  const seen = new Set();
  function visit(current) {
    if (seen.has(current)) return '';
    seen.add(current);
    const source = read(current);
    const dependencies = [...source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)]
      .map(match => path.resolve(path.dirname(current), match[1]))
      .filter(dependency => dependency.startsWith(directory + path.sep));
    return [...dependencies.map(visit), source].join('\n');
  }
  return visit(file);
}

// 严格按 @import 顺序展开样式，源码断言与页面实际加载顺序一致。
export function readStylesSource(entry) {
  const file = entry instanceof URL ? fileURLToPath(entry) : path.resolve(entry);
  return read(file).replace(/@import\s+["'](\.[^"']+)["'];/g, (_, dependency) =>
    readStylesSource(path.resolve(path.dirname(file), dependency)));
}
