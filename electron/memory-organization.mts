import path from 'node:path';
import { buildPageContent, parsePageContent, workspacePageRelPath } from './memory-wiki.mts';

export function pageRecords(pages) {
  return pages.flatMap(page => page.rows.map(row => ({ ...row, scope: page.scope, workspacePath: page.workspacePath || '' })));
}

function sameScope(a, b) {
  return a.scope === b.scope && path.normalize(a.workspacePath || '.') === path.normalize(b.workspacePath || '.');
}

// 在服务层校验全量记忆覆盖，禁止模型漏条、凭空新增、跨项目搬运或没有说明的覆盖。
export function validateOrganization(pages, result) {
  if (!result || !Array.isArray(result.pages)) throw new Error('整理结果格式不正确');
  const originals = new Map<string, any>(pageRecords(pages).map(row => [row.id, row]));
  const nextPages = new Map(pages.map(page => [page.relPath, page]));
  const changedPaths = new Set();
  for (const change of result.pages) {
    const relPath = String(change?.path || '');
    if (!/^pages\/(?:projects\/)?[\w\u3400-\u9fff][\w\u3400-\u9fff.-]*\.md$/.test(relPath)
      || typeof change.content !== 'string' || change.content.length > 120_000 || !/^# .+/m.test(change.content)
      || changedPaths.has(relPath)) throw new Error('整理结果包含无效或重复的页面');
    const page = parsePageContent(change.content, relPath);
    if (change.content.split('\n').some(line => line.trim() && !/^# |^> 工作区：|^- .*<!--mem:[^>]+-->$/.test(line))) throw new Error('整理结果包含无法追踪的额外内容');
    if (page.scope === 'workspace' && workspacePageRelPath(page.workspacePath) !== relPath) throw new Error('整理结果改变了项目范围');
    if (relPath.startsWith('pages/projects/') && page.scope !== 'workspace') throw new Error('项目记忆缺少所属项目');
    if (change.content.split('\n').some(line => /^\s*-\s+/.test(line) && !page.rows.some(row => line.includes(`<!--mem:${row.id}|`)))) throw new Error('整理结果存在无法追踪的内容');
    nextPages.set(relPath, page); changedPaths.add(relPath);
  }
  const finalRows = pageRecords([...nextPages.values()]);
  const final = new Map();
  for (const row of finalRows) {
    const original = originals.get(row.id);
    if (!original || final.has(row.id)) throw new Error('整理结果新增或重复了记忆编号');
    if (!sameScope(original, row)) throw new Error('整理结果改变了记忆适用范围');
    if (row.kind !== original.kind || row.name !== original.name) throw new Error('整理结果改变了记忆类型或名字');
    final.set(row.id, row);
  }
  const absorbed = new Set(), targets = new Set(), merges = [];
  for (const merge of result.merges || []) {
    const target = final.get(merge.targetId);
    if (!Array.isArray(merge.sourceIds)) throw new Error('合并来源必须是记忆编号列表');
    const ids = [...new Set<string>(merge.sourceIds.map(String))].filter(id => id !== merge.targetId);
    if (!target || !ids.length || targets.has(target.id)) throw new Error('合并记录缺少有效的目标或来源');
    targets.add(target.id);
    for (const id of ids) {
      const source = originals.get(id);
      if (!source || final.has(id) || absorbed.has(id) || !sameScope(source, target) || source.kind !== target.kind) throw new Error('合并来源无效，或属于不同范围和类型');
      absorbed.add(id);
    }
    const numbers = text => new Set((String(text).match(/[-+]?\d+(?:[.,]\d+)*(?:\s*(?:%|％|万元|亿元|元|万|亿|天|日|月|年|小时|分钟|秒|MB|GB|KB|毫秒|次|个|人|条))?/giu) || []).map(value => value.replace(/\s+/g, '').toLowerCase()));
    const finalNumbers = numbers(target.content);
    for (const id of [target.id, ...ids]) for (const value of numbers(originals.get(id).content)) {
      if (!finalNumbers.has(value)) throw new Error('合并结果遗漏或改变了数值和单位');
    }
    merges.push({ targetId: target.id, sourceIds: ids, reason: String(merge.reason || '同一内容的重复表达').slice(0, 300) });
  }
  for (const [id, original] of originals) {
    if (!final.has(id) && !absorbed.has(id)) throw new Error('整理结果遗漏了原有记忆');
    if (final.has(id) && !targets.has(id) && final.get(id).content !== original.content) throw new Error('整理结果改写了未参与合并的记忆');
  }
  const conflicts = (Array.isArray(result.conflicts) ? result.conflicts : []).filter(item => Array.isArray(item.ids) && item.ids.length > 1
    && item.ids.every(id => originals.has(id) && final.has(id) && !targets.has(id)))
    .map(item => ({ ids: [...new Set(item.ids)], reason: String(item.reason || '内容可能冲突').slice(0, 500) }));
  return { ...result, merges, conflicts };
}

// 没有模型时也能处理完全重复的条目；只规范空白，不丢弃标点、条件或数值。
export function exactDuplicateOrganization(pages) {
  const seen = new Map(), merges = new Map(), changed = [];
  for (const page of pages) {
    const rows = [];
    for (const row of page.rows) {
      const key = JSON.stringify([page.scope, page.workspacePath || '', row.kind, row.category, row.content.replace(/\s+/g, ' ').trim()]);
      const target = seen.get(key);
      if (!target) { seen.set(key, row); rows.push(row); continue; }
      if (!merges.has(target.id)) merges.set(target.id, { targetId: target.id, sourceIds: [], reason: '内容相同，合并重复记录' });
      merges.get(target.id).sourceIds.push(row.id);
    }
    if (rows.length !== page.rows.length) changed.push({ path: page.relPath, content: buildPageContent({ ...page, rows }) });
  }
  return { pages: changed, merges: [...merges.values()], conflicts: [], logEntry: '合并内容相同的重复记忆' };
}
