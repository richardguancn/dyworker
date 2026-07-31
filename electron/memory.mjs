import path from "node:path";

export const memoryKinds = ["preference", "rule", "taboo", "fact", "experience"];
export const memoryScopes = ["global", "workspace"];
export const memoryRelations = ["extends", "refines", "supersedes"];

function clean(value) {
  return String(value || "").trim();
}

function normalizeWorkspacePath(value) {
  const workspacePath = clean(value);
  if (!workspacePath) return "";
  const normalized = path.normalize(workspacePath);
  const root = path.parse(normalized).root;
  return normalized === root ? root : normalized.replace(/[\\/]+$/, "");
}

function inferKind(item) {
  const text = `${clean(item?.category)} ${clean(item?.content)}`;
  if (/禁忌|禁止|不得|不要/.test(text)) return "taboo";
  if (/偏好|习惯|喜欢|惯用/.test(text)) return "preference";
  if (/规则|约束|要求|必须/.test(text)) return "rule";
  if (/经验|做法|流程|教训/.test(text)) return "experience";
  return "fact";
}

function containsSensitiveMemory(text) {
  return /(?:api[_ -]?key|access[_ -]?token|secret|password|密码|口令|密钥|令牌).{0,12}(?:是|为|[:：=])/i.test(text)
    || /(?<!\d)\d{17}[\dXx](?!\d)/.test(text)
    || /(?<!\d)1[3-9]\d{9}(?!\d)/.test(text)
    || /(?<!\d)\d{16,19}(?!\d)/.test(text);
}

function buildExplicitMemory(contentValue) {
  let content = clean(contentValue);
  content = content.replace(/^(?:这件事|这点|这条|以下内容)[：:，,\s]*/, "").trim();
  if (!content
    || content.length > 500
    || /^(?:这|那|以下|上述|\d+|[一二两三四五六七八九十]+)?(?:条)?(?:内容|规则|要求|事情|信息)$/.test(content)
    || containsSensitiveMemory(content)) return null;
  const kind = /(?:以后|今后).*(?:给我|汇报|回复|表达|格式|语气)/.test(content)
    ? "preference"
    : inferKind({ content });
  const scope = /(?:本项目|这个项目|当前项目|本工作区|当前工作区|本仓库|当前仓库|本系统|这个系统)/.test(content)
    ? "workspace"
    : "global";
  const category = kind === "preference"
    ? "用户偏好"
    : kind === "taboo"
      ? "用户禁忌"
      : scope === "workspace" && kind === "rule"
        ? "项目规则"
        : scope === "workspace" && kind === "experience"
          ? "项目经验"
          : "常用信息";
  return { category, content, kind, scope, relation: "extends", relatedMemoryId: "" };
}

// 用户用明确祈使句要求“记住”时，先在本地可靠落盘，不把成败完全交给模型自行判断。
// 只识别句首命令或“这点请记住”这类句尾命令，避免把“记忆功能没有记下来”等讨论误存为记忆。
export function extractExplicitMemoryInstructions(value) {
  const text = clean(value);
  if (!text) return [];
  const sentences = text.split(/[\n。！？!?；;]+/).map(clean).filter(Boolean);
  const memories = [];
  let collectingList = false;
  for (const sentence of sentences) {
    const leading = sentence.match(/^(?:请|麻烦)?(?:你|帮我|把这条|把这点|把以下内容)?(?:务必|一定)?(?:要)?(?:记住|记下来|记一下|保存到(?:长期)?记忆(?:里|中)?)(?:这件事|这点|这条|以下内容)?[：:，,\s]*(.+)$/);
    const trailing = sentence.match(/^(.{2,}?)[，,]\s*(?:这个|这点|这条)?(?:请)?(?:记住|记下来|记一下)$/);
    if (collectingList && /^(?:然后|接着|再请|再帮|请帮|另外请|现在请)/.test(sentence)) collectingList = false;
    const memory = buildExplicitMemory(leading?.[1] || trailing?.[1] || (collectingList ? sentence : ""));
    if (memory && !memories.some((item) => item.content === memory.content)) memories.push(memory);
    if (leading) collectingList = /(?:记住|记下来|记一下)以下内容|把以下内容/.test(sentence);
    else if (trailing) collectingList = false;
  }
  return memories;
}

export function extractExplicitMemoryInstruction(value) {
  return extractExplicitMemoryInstructions(value)[0] || null;
}

export function normalizeMemoryItem(item) {
  if (!item || typeof item !== "object") return null;
  const content = clean(item.content);
  if (!content) return null;
  const requestedScope = memoryScopes.includes(item.scope) ? item.scope : "global";
  const workspacePath = requestedScope === "workspace" ? normalizeWorkspacePath(item.workspacePath) : "";
  const scope = requestedScope === "workspace" && workspacePath ? "workspace" : "global";
  return {
    id: clean(item.id),
    category: clean(item.category) || "常用信息",
    content,
    kind: memoryKinds.includes(item.kind) ? item.kind : inferKind(item),
    scope,
    workspacePath: scope === "workspace" ? workspacePath : "",
    relation: memoryRelations.includes(item.relation) ? item.relation : "extends",
    relatedMemoryId: clean(item.relatedMemoryId),
    createdAt: clean(item.createdAt),
  };
}

export function normalizeMemories(items) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeMemoryItem).filter(Boolean);
}

export function buildMemoryRecord(item, { id, workspacePath, now } = {}) {
  const scope = item?.scope === "workspace" && clean(workspacePath) ? "workspace" : "global";
  return normalizeMemoryItem({
    ...item,
    id: clean(id),
    scope,
    workspacePath: scope === "workspace" ? workspacePath : "",
    createdAt: clean(now) || new Date().toISOString(),
  });
}

function textTokens(value) {
  const text = clean(value).toLowerCase();
  const tokens = new Set();
  for (const word of text.match(/[a-z0-9][a-z0-9._/-]*/g) || []) {
    if (word.length >= 2) tokens.add(word);
  }
  for (const sequence of text.match(/[\u3400-\u9fff]+/g) || []) {
    if (sequence.length <= 20) tokens.add(sequence);
    for (let index = 0; index < sequence.length - 1; index += 1) {
      tokens.add(sequence.slice(index, index + 2));
    }
    for (let index = 0; index < sequence.length - 2; index += 1) {
      tokens.add(sequence.slice(index, index + 3));
    }
  }
  return tokens;
}

function relevanceScore(memory, query, queryTokens) {
  const searchable = `${memory.category} ${memory.content}`.toLowerCase();
  const memoryTokens = textTokens(searchable);
  let score = 0;
  for (const token of queryTokens) {
    if (memoryTokens.has(token)) score += token.length >= 3 ? 2 : 1;
  }
  const normalizedQuery = clean(query).toLowerCase();
  if (normalizedQuery.length >= 2 && searchable.includes(normalizedQuery)) score += 8;
  if (memory.content.length >= 2 && normalizedQuery.includes(memory.content.toLowerCase())) score += 8;
  if (memory.kind === "rule") score += 1.5;
  else if (memory.kind === "taboo") score += 1.4;
  else if (memory.kind === "preference") score += 0.6;
  if (memory.scope === "workspace") score += 0.4;
  return score;
}

export function selectRelevantMemories(items, { workspacePath = "", query = "", limit = 5 } = {}) {
  const normalizedWorkspace = normalizeWorkspacePath(workspacePath);
  const applicable = normalizeMemories(items).filter((item) => (
    item.scope === "global" || (
      item.scope === "workspace"
      && item.workspacePath === normalizedWorkspace
    )
  ));
  const supersededIds = new Set(
    applicable
      .filter((item) => item.relation === "supersedes" && item.relatedMemoryId)
      .map((item) => item.relatedMemoryId),
  );
  const queryTokens = textTokens(query);
  return applicable
    .filter((item) => !supersededIds.has(item.id))
    .map((item) => ({
      item,
      score: relevanceScore(item, query, queryTokens),
      time: Date.parse(item.createdAt) || 0,
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.time - left.time || left.item.id.localeCompare(right.item.id))
    .slice(0, Math.max(0, Math.min(20, Number(limit) || 5)))
    .map(({ item }) => item);
}
