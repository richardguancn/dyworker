import { localSourcePath } from './local-source.js';

// 内容关联是可解释的候选关系；不会把词面相近当作事实关系，也不据此删除记忆。
const genericCategories = new Set(['', '未分类', '默认', '常用信息', '用户偏好', '个人记忆', '项目', '项目规则', '项目事实', '偏好', '规则', '事实', '经验', '用户画像', '用户禁忌', '技术', '办公', '其他', '资料', '文档', '个人', '工作', '通用规则', '经验教训']);
const stopWords = new Set(['用户', '需要', '可以', '使用', '进行', '相关', '内容', '这个', '一个', '我们', '时候', '必须', '不要', '默认', '以后', '当前', '通过', '以及', '或者', '对于', '支持', '应该', 'the', 'and', 'for', 'with', 'that', 'this']);
export const documentNodeId = source => `document:${encodeURIComponent(source)}`;
export const memoryNodeId = id => `memory:${id}`;
export const relationKey = (a, b) => JSON.stringify([a, b].sort());

function tokens(text) {
  const result = new Set();
  for (const word of String(text || '').toLowerCase().match(/[a-z][a-z0-9_+.-]*|[\p{Script=Han}]+/gu) || []) {
    if (/^[a-z]/.test(word)) { if (word.length > 1 && !stopWords.has(word)) result.add(word); continue; }
    for (let i = 0; i < word.length - 1; i++) {
      const token = word.slice(i, i + 2);
      if (!stopWords.has(token)) result.add(token);
    }
  }
  return result;
}

function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.codePointAt(0), 16777619);
  return value >>> 0;
}

function compatible(a, b) {
  return !(a.scope === 'workspace' && b.scope === 'workspace' && a.workspacePath !== b.workspacePath);
}

export function knowledgeNodes(memories, documents) {
  const nodes = memories.map(item => ({
    id: memoryNodeId(item.id), memoryId: item.id, kind: 'memory',
    name: item.name || String(item.content).split(/[。\n]/)[0].slice(0, 28),
    category: item.category || '', content: item.content, source: '个人记忆',
    scope: item.scope, workspacePath: item.workspacePath || '', tags: [],
    origins: item.origins || [],
  }));
  const files = new Map();
  for (const item of documents) {
    const source = item.source || `条目 ${item.id}`;
    const id = documentNodeId(source);
    if (!files.has(id)) files.set(id, { id, kind: 'document', name: localSourcePath(source),
      category: item.category, content: '', source, scope: 'global', workspacePath: '', tags: [], chunks: 0 });
    const node = files.get(id);
    node.content += `${node.content ? '\n\n' : ''}${typeof item.payload === 'string' ? item.payload : item.summary || ''}`;
    node.tags = [...new Set([...node.tags, ...(item.tags || [])])];
    node.chunks++;
  }
  return [...nodes, ...files.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildKnowledgeGraph(nodes, saved = [], aliases = {}) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const resolve = id => {
    const seen = new Set();
    while (aliases[id] && !seen.has(id)) { seen.add(id); id = aliases[id]; }
    return id;
  };
  const links = new Map(), excluded = new Set();
  for (const item of saved) {
    const source = resolve(item.source), target = resolve(item.target);
    if (source === target || !byId.has(source) || !byId.has(target) || !compatible(byId.get(source), byId.get(target))) continue;
    const key = relationKey(source, target);
    if (item.dismissed) { excluded.add(key); links.delete(key); }
    else { excluded.delete(key); links.set(key, { source, target, label: item.label || '相关', kind: 'manual', score: 1 }); }
  }
  const features = nodes.map(node => {
    const weights = new Map();
    for (const [text, weight] of [[node.content.slice(0, 8000), 1], [node.name, 3], [node.tags.join(' '), 4]]) {
      for (const token of tokens(text)) weights.set(token, (weights.get(token) || 0) + weight);
    }
    if (!genericCategories.has(node.category)) weights.set(`分类:${node.category}`, 3);
    return weights;
  });
  const frequencies = new Map(), postings = new Map();
  features.forEach((weights, index) => {
    for (const token of weights.keys()) {
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
      if (!postings.has(token)) postings.set(token, []);
      postings.get(token).push(index);
    }
  });
  const norms = features.map(weights => {
    let sum = 0;
    for (const [token, weight] of weights) {
      const value = weight * (1 + Math.log((nodes.length + 1) / (frequencies.get(token) + 1)));
      weights.set(token, value); sum += value * value;
    }
    return Math.sqrt(sum) || 1;
  });
  const parent = nodes.map((_, index) => index);
  const root = index => { while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; } return index; };
  // 从标题中找反复出现的具体主题词，不要求不同类型的记忆正文高度相似。
  const titleTerms = nodes.map(node => {
    const terms = new Set();
    for (const part of node.name.toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\p{Script=Han}]+/gu) || []) {
      if (/^[a-z]/.test(part)) { if (!stopWords.has(part)) terms.add(part); continue; }
      for (let i = 0; i <= part.length - 3; i++) {
        const term = part.slice(i, i + 3);
        if (!['工作区', '相关的', '需要用', '需要在', '使用的', '如何使用', '进行的'].includes(term)) terms.add(term);
      }
    }
    return terms;
  });
  const titleCounts = new Map();
  for (const terms of titleTerms) for (const term of terms) titleCounts.set(term, (titleCounts.get(term) || 0) + 1);
  const hints = titleTerms.map(terms => [...terms].filter(term => titleCounts.get(term) >= 3)
    .sort((a, b) => titleCounts.get(b) - titleCounts.get(a) || b.length - a.length || a.localeCompare(b))[0] || '');
  const hintAnchors = new Map();
  hints.forEach((hint, index) => {
    if (!hint) return;
    if (hintAnchors.has(hint)) parent[index] = root(hintAnchors.get(hint));
    else hintAnchors.set(hint, index);
  });
  // 用户已有的具体主题归档也是分组依据；通用类型（事实、偏好等）不能当作主题。
  // 分类只影响颜色，不会凭空生成事实关联线。
  const categoryAnchors = new Map();
  nodes.forEach((node, index) => {
    if (genericCategories.has(node.category)) return;
    const key = `${node.category}\0${hints[index]}`;
    if (categoryAnchors.has(key)) { const a = root(index), b = root(categoryAnchors.get(key)); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
    else categoryAnchors.set(key, index);
  });
  const candidates = [];
  // 倒排候选避免对所有节点做全文两两比较；过于常见的词不单独触发关联。
  features.forEach((weights, i) => {
    const pairs = new Set();
    for (const token of weights.keys()) {
      const matches = postings.get(token);
      if (matches.length > Math.max(60, nodes.length * .4)) continue;
      for (const j of matches) if (j > i) pairs.add(j);
    }
    for (const j of pairs) {
      if (!compatible(nodes[i], nodes[j])) continue;
      let dot = 0; const shared = [];
      for (const [token, weight] of weights) if (features[j].has(token)) {
        dot += weight * features[j].get(token);
        shared.push({ token, weight: weight * features[j].get(token) });
      }
      const score = dot / (norms[i] * norms[j]);
      const contentShared = shared.filter(item => !item.token.startsWith('分类:'));
      if (score < .2 || contentShared.length < 2) continue;
      shared.sort((a, b) => b.weight - a.weight || a.token.localeCompare(b.token));
      candidates.push({ i, j, score, terms: shared.filter(item => !item.token.startsWith('分类:')).slice(0, 3).map(item => item.token) });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
  const degree = new Map();
  for (const { i, j, score, terms } of candidates) {
    // 聚类采用更高门槛；连线和聚类分开，避免一条弱关联把所有主题串成同色。
    const differentTopics = !genericCategories.has(nodes[i].category) && !genericCategories.has(nodes[j].category) && nodes[i].category !== nodes[j].category;
    if ((!hints[i] || !hints[j] || hints[i] === hints[j]) && score >= (differentTopics ? .5 : .3)) {
      const a = root(i), b = root(j);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
    const source = nodes[i].id, target = nodes[j].id, key = relationKey(source, target);
    if (links.has(key) || excluded.has(key) || (degree.get(source) || 0) >= 4 || (degree.get(target) || 0) >= 4) continue;
    links.set(key, { source, target, kind: 'similar', label: '内容相近', score: Math.round(score * 100) / 100, reason: `共同内容：${terms.join('、')}` });
    degree.set(source, (degree.get(source) || 0) + 1); degree.set(target, (degree.get(target) || 0) + 1);
  }
  // 用少量主题相近的候选线串起同一主题；不将这些弱关系用于任务检索扩展。
  for (const hint of hintAnchors.keys()) {
    const members = nodes.map((node, i) => ({ node, i })).filter(item => hints[item.i] === hint);
    for (let i = 0; i < members.length; i++) {
      for (let step = 1; step <= 2 && step < members.length; step++) {
        const source = members[i].node, target = members[(i + step) % members.length].node;
        const key = relationKey(source.id, target.id);
        if (!compatible(source, target) || excluded.has(key) || links.has(key) || (degree.get(source.id) || 0) >= 5 || (degree.get(target.id) || 0) >= 5) continue;
        links.set(key, { source: source.id, target: target.id, kind: 'similar', label: '主题相近', score: .2, reason: `共同主题：${hint}` });
        degree.set(source.id, (degree.get(source.id) || 0) + 1); degree.set(target.id, (degree.get(target.id) || 0) + 1);
      }
    }
  }
  const clusters = new Map();
  nodes.forEach((node, index) => { const id = root(index); if (!clusters.has(id)) clusters.set(id, []); clusters.get(id).push(node); });
  const topics = [], topicOf = new Map(), usedHues = [];
  for (const [anchor, members] of clusters) {
    const categories = members.map(node => node.category).filter(category => !genericCategories.has(category));
    const category = categories.sort((a, b) => categories.filter(x => x === b).length - categories.filter(x => x === a).length || a.localeCompare(b))[0];
    const counts = new Map();
    for (const node of members) for (const token of tokens(node.name)) counts.set(token, (counts.get(token) || 0) + 1);
    const term = [...counts].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0]?.[0];
    const commonHint = hints[anchor];
    const label = commonHint ? `${commonHint}相关` : category || (members.length > 1 && term ? `${term}相关` : members[0].name.slice(0, 12));
    const id = `topic:${nodes[anchor].id}`;
    let hue = hash(label) % 360;
    for (let attempt = 0; attempt < 24 && usedHues.some(value => Math.min(Math.abs(value - hue), 360 - Math.abs(value - hue)) < 22); attempt++) hue = (hue + 137.508) % 360;
    usedHues.push(hue);
    const topic = { id, label, color: `hsl(${Math.round(hue)}, 57%, 46%)`, count: members.length };
    topics.push(topic); for (const node of members) topicOf.set(node.id, topic);
  }
  return { nodes: nodes.map(node => ({ ...node, content: node.content.slice(0, 8000), truncated: node.content.length > 8000,
    topicId: topicOf.get(node.id).id, color: topicOf.get(node.id).color })), links: [...links.values()], topics };
}
