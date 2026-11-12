import { promises as fs } from 'node:fs';
import path from 'node:path';

// 文件路径只在主进程解析，不将本地内容或路径嵌入网页脚本。
export async function resolveBrowserUploadFiles(files: unknown, workspacePath: string) {
  if (!Array.isArray(files) || !files.length || files.length > 20
    || files.some(file => typeof file !== 'string' || !file.trim() || file.includes('\0'))) {
    throw new Error('上传需要 1–20 个有效本地文件路径');
  }
  if (!workspacePath) throw new Error('上传前请选择文件所在的工作文件夹');
  const root = await fs.realpath(workspacePath);
  const resolved = [];
  for (const file of files) {
    const absolute = await fs.realpath(path.resolve(root, file));
    const relative = path.relative(root, absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`上传文件在工作区之外，请先将该文件放入当前工作文件夹：${file}`);
    }
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error(`上传目标不是普通文件：${file}`);
    await fs.access(absolute);
    resolved.push(absolute);
  }
  return resolved;
}

export function findObservedFileNode(root: any, observationId: string, ref: number): any {
  const attributes = root?.attributes || [];
  const attrs = new Map<string, string>();
  for (let i = 0; i < attributes.length; i += 2) attrs.set(attributes[i], attributes[i + 1]);
  if (String(root?.nodeName).toLowerCase() === 'input' && attrs.get('type')?.toLowerCase() === 'file'
    && attrs.get('data-dyworker-obs') === observationId && attrs.get('data-dyworker-ref') === String(ref)) return root;
  for (const child of [...(root?.children || []), ...(root?.shadowRoots || []), ...(root?.contentDocument ? [root.contentDocument] : [])]) {
    const match = findObservedFileNode(child, observationId, ref);
    if (match) return match;
  }
  return null;
}
