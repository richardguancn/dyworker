import { promises as fsp } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// 个人记忆知识库（参考 Karpathy 的 LLM Wiki 模式）：
//   index.md  派生目录（每次写操作后按页面文件重新生成，不手工维护）
//   log.md    追加式时间线（ingest / lint / delete）
//   pages/    LLM 维护的记忆页面，每条记忆一行 `- 内容 <!--mem:编号|类型|分类-->`
// 记忆原始队列仍在 memory.json：save_memory 只入队，任务结束后由主进程做
// 一次 LLM 整合（合并/去重/修订矛盾后写回页面），失败时回退到规则式追加。

export const corePageDefs = [
  { relPath: "pages/profile.md", title: "用户画像", scope: "global" },
  { relPath: "pages/preferences.md", title: "用户偏好", scope: "global" },
  { relPath: "pages/rules.md", title: "通用规则", scope: "global" },
  { relPath: "pages/taboos.md", title: "用户禁忌", scope: "global" },
  { relPath: "pages/facts.md", title: "常用信息", scope: "global" },
  { relPath: "pages/experiences.md", title: "经验教训", scope: "global" },
];

const corePageByRelPath = new Map(corePageDefs.map((page) => [page.relPath, page]));
export const MEM_ROW_PREFIX = "- ";
// 行尾标记第 4 段（名字）可选：旧格式 3 段行依旧可解析，name 为空串
export const MEM_ROW_MARKER = /<!--mem:([^|>]+)\|([^|>]*)\|([^|>]*)(?:\|([^|>]*))?-->$/;
const MAX_PAGE_CHARS = 120_000;

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

export function workspacePageRelPath(workspacePath) {
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!normalized) return "";
  const base = clean(path.basename(normalized)).replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "workspace";
  const hash = crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 6);
  return `pages/projects/${base}-${hash}.md`;
}

// 路由：用户画像 → profile；工作区记忆 → 项目页；其余按类型落核心页面。
export function pageRelPathForItem(item) {
  const category = clean(item?.category);
  const kind = clean(item?.kind);
  if (item?.scope === "workspace" && clean(item?.workspacePath)) return workspacePageRelPath(item.workspacePath);
  if (category === "用户画像") return "pages/profile.md";
  if (kind === "taboo") return "pages/taboos.md";
  if (kind === "rule") return "pages/rules.md";
  if (kind === "experience") return "pages/experiences.md";
  if (kind === "fact") return "pages/facts.md";
  return "pages/preferences.md";
}

export function serializeMemoryRow({ content, id, kind, category, name }) {
  const namePart = clean(name) ? `|${clean(name)}` : "";
  return `- ${clean(content)} <!--mem:${clean(id)}|${clean(kind)}|${clean(category)}${namePart}-->`;
}

export function parseMemoryRow(line) {
  const text = String(line || "").trimEnd();
  if (!text.startsWith(MEM_ROW_PREFIX)) return null;
  const match = text.match(MEM_ROW_MARKER);
  if (!match) return null;
  const content = text.slice(MEM_ROW_PREFIX.length, text.lastIndexOf("<!--mem:")).trim();
  if (!content) return null;
  return { id: match[1], kind: match[2], category: match[3], name: clean(match[4]), content };
}

export function buildPageContent({ title, rows, workspacePath = "" }) {
  const header = `# ${clean(title)}`;
  const workspaceLine = workspacePath ? `\n> 工作区：${workspacePath}` : "";
  const body = rows.length ? `\n\n${rows.map(serializeMemoryRow).join("\n")}` : "";
  return `${header}${workspaceLine}${body}\n`;
}

export function parsePageContent(content, relPath) {
  const text = String(content || "");
  const title = clean((text.match(/^# (.+)$/m) || [])[1]) || path.basename(relPath, ".md");
  const workspaceMatch = text.match(/^> 工作区：(.+)$/m);
  const rows = text.split("\n").map(parseMemoryRow).filter(Boolean);
  const core = corePageByRelPath.get(relPath);
  const workspacePath = clean(workspaceMatch?.[1]);
  return {
    relPath,
    title,
    scope: core ? "global" : workspacePath ? "workspace" : "global",
    workspacePath: workspacePath || "",
    rows,
    content: text,
  };
}

async function fileExists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(file) {
  try {
    return await fsp.readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function writeTextFile(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, "utf8");
}

async function listPageFiles(root) {
  const pagesDir = path.join(root, "pages");
  const files = [];
  if (!await fileExists(pagesDir)) return files;
  for (const entry of await fsp.readdir(pagesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(`pages/${entry.name}`);
    if (entry.isDirectory() && entry.name === "projects") {
      const projectsDir = path.join(pagesDir, "projects");
      for (const projectEntry of await fsp.readdir(projectsDir, { withFileTypes: true })) {
        if (projectEntry.isFile() && projectEntry.name.endsWith(".md")) files.push(`pages/projects/${projectEntry.name}`);
      }
    }
  }
  files.sort();
  return files;
}

export async function readWikiPages(root) {
  const files = await listPageFiles(root);
  const pages = [];
  for (const relPath of files) {
    const content = await readTextFile(path.join(root, relPath));
    if (!content) continue;
    pages.push(parsePageContent(content, relPath));
  }
  return pages;
}

export async function listWikiPages(root) {
  const pages = await readWikiPages(root);
  const withMeta = [];
  for (const page of pages) {
    const stat = await fsp.stat(path.join(root, page.relPath)).catch(() => null);
    withMeta.push({ ...page, updated: stat?.mtime?.toISOString?.() || "" });
  }
  return withMeta;
}

export function deriveIndexContent(pages) {
  const ordered = [
    ...corePageDefs.map((def) => pages.find((page) => page.relPath === def.relPath)).filter(Boolean),
    ...pages.filter((page) => !corePageByRelPath.has(page.relPath)),
  ];
  const lines = ordered.map((page) => {
    const scope = page.scope === "workspace" ? "工作区" : "全局";
    return `- [${page.title}](${page.relPath})｜${scope}｜${page.rows.length} 条`;
  });
  return `# 记忆库目录\n\n${lines.join("\n")}\n`;
}

async function rewriteIndex(root) {
  const pages = await readWikiPages(root);
  await writeTextFile(path.join(root, "index.md"), deriveIndexContent(pages));
}

async function appendLog(root, action, detail, now) {
  const time = now || new Date().toISOString();
  const file = path.join(root, "log.md");
  const previous = await readTextFile(file);
  const entry = `## [${time}] ${action} | ${clean(detail).replace(/\s+/g, " ").slice(0, 120)}\n`;
  await writeTextFile(file, previous ? `${previous.trimEnd()}\n\n${entry}` : `# 记忆库日志\n\n${entry}`);
}

// 规则式整合（LLM 失败或未配置模型时的兜底）：按路由把队列条目追加到对应页面。
export async function integrateItems(root, items, { now, logTitle = "规则式整合" } = {}) {
  // 会话记忆只绑定单个任务会话，不进入全局 wiki 页面
  const valid = (Array.isArray(items) ? items : []).filter((item) => clean(item?.content) && clean(item?.id) && item?.scope !== "session");
  if (!valid.length) return 0;
  const existingPages = await readWikiPages(root);
  const existingIds = new Set(existingPages.flatMap((page) => page.rows.map((row) => row.id)));
  const byRelPath = new Map(existingPages.map((page) => [page.relPath, page]));
  let added = 0;
  for (const item of valid) {
    if (existingIds.has(clean(item.id))) continue;
    const relPath = pageRelPathForItem(item);
    if (!byRelPath.has(relPath)) {
      const workspacePath = item?.scope === "workspace" ? normalizeWorkspacePath(item?.workspacePath) : "";
      byRelPath.set(relPath, {
        relPath,
        title: workspacePath ? `项目：${path.basename(workspacePath) || workspacePath}` : corePageByRelPath.get(relPath)?.title || path.basename(relPath, ".md"),
        scope: workspacePath ? "workspace" : "global",
        workspacePath,
        rows: [],
        content: "",
      });
    }
    byRelPath.get(relPath).rows.push({
      id: clean(item.id),
      kind: clean(item.kind),
      category: clean(item.category),
      name: clean(item.name),
      content: clean(item.content),
    });
    existingIds.add(clean(item.id));
    added += 1;
  }
  for (const [relPath, page] of byRelPath) {
    if (!page.rows.length && !corePageByRelPath.has(relPath)) continue;
    await writeTextFile(path.join(root, relPath), buildPageContent(page));
  }
  await rewriteIndex(root);
  await appendLog(root, "ingest", `${logTitle}：新增 ${added} 条记忆`, now);
  return added;
}

// 初始化或迁移：wiki 不存在时创建骨架；传入的条目按规则式直接导入。
export async function ensureWiki(root, { items = [], now } = {}) {
  const indexFile = path.join(root, "index.md");
  const existed = await fileExists(indexFile);
  if (!existed) {
    for (const def of corePageDefs) {
      const file = path.join(root, def.relPath);
      if (!await fileExists(file)) await writeTextFile(file, buildPageContent({ title: def.title, rows: [] }));
    }
  }
  const integrated = await integrateItems(root, items, { now, logTitle: existed ? "补录" : "初始化导入" });
  if (!existed) await appendLog(root, "init", "记忆库初始化", now);
  return { created: !existed, integrated };
}

async function removePageIfEmpty(root, relPath) {
  if (corePageByRelPath.has(relPath)) return false;
  const file = path.join(root, relPath);
  const content = await readTextFile(file);
  const rows = content.split("\n").map(parseMemoryRow).filter(Boolean);
  if (rows.length) return false;
  await fsp.rm(file, { force: true });
  return true;
}

// 删除一条记忆：从所属页面移除该行（按 <!--mem:id--> 定位），并同步目录与日志。
export async function removeWikiMemory(root, id, { now } = {}) {
  const target = clean(id);
  if (!target) return false;
  const pages = await readWikiPages(root);
  const page = pages.find((item) => item.rows.some((row) => row.id === target));
  if (!page) return false;
  page.rows = page.rows.filter((row) => row.id !== target);
  const file = path.join(root, page.relPath);
  if (!page.rows.length && !corePageByRelPath.has(page.relPath)) {
    await fsp.rm(file, { force: true });
  } else {
    await writeTextFile(file, buildPageContent(page));
  }
  await rewriteIndex(root);
  await appendLog(root, "delete", `删除记忆 ${target}`, now);
  return true;
}

function tokenize(value) {
  const text = clean(value).toLowerCase();
  const tokens = new Set();
  for (const word of text.match(/[a-z0-9][a-z0-9._/-]*/g) || []) {
    if (word.length >= 2) tokens.add(word);
  }
  for (const sequence of text.match(/[\u3400-\u9fff]+/g) || []) {
    if (sequence.length <= 20) tokens.add(sequence);
    for (let index = 0; index < sequence.length - 1; index += 1) tokens.add(sequence.slice(index, index + 2));
    for (let index = 0; index < sequence.length - 2; index += 1) tokens.add(sequence.slice(index, index + 3));
  }
  return tokens;
}

function pageScore(page, query, queryTokens) {
  const searchable = `${page.title} ${page.rows.map((row) => `${row.category} ${row.content}`).join(" ")}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (searchable.includes(token)) score += token.length >= 3 ? 2 : 1;
  }
  const normalizedQuery = clean(query).toLowerCase();
  if (normalizedQuery.length >= 2 && searchable.includes(normalizedQuery)) score += 6;
  const kinds = new Set(page.rows.map((row) => row.kind));
  if (kinds.has("rule")) score += 1.5;
  if (kinds.has("taboo")) score += 1.4;
  else if (kinds.has("preference")) score += 0.6;
  return score;
}

// 页面级选取：等价于旧的 selectRelevantMemories，但以 wiki 页面为单位注入。
export function selectWikiPages(pages, { workspacePath = "", query = "", limit = 3 } = {}) {
  const normalizedWorkspace = normalizeWorkspacePath(workspacePath);
  const queryTokens = tokenize(query);
  return (Array.isArray(pages) ? pages : [])
    .filter((page) => page.scope !== "workspace" || (normalizedWorkspace && page.workspacePath === normalizedWorkspace))
    .map((page) => ({ page, score: pageScore(page, query, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.page.relPath.localeCompare(right.page.relPath))
    .slice(0, Math.max(0, Math.min(10, Number(limit) || 3)))
    .map(({ page }) => page);
}

// ---- LLM 整合 ----

export function buildConsolidationMessages({ pages, pending = [], lint = false }) {
  const pageSections = (Array.isArray(pages) ? pages : [])
    .map((page) => `### ${page.relPath}\n${page.content}`)
    .join("\n\n");
  const pendingLines = (Array.isArray(pending) ? pending : [])
    .map((item) => `- 编号 ${clean(item?.id)}｜类型 ${clean(item?.kind) || "fact"}｜分类 ${clean(item?.category) || "常用信息"}｜${clean(item?.scope) === "workspace" ? "工作区" : "全局"}｜内容：${clean(item?.content)}`)
    .join("\n");
  const system = [
    "你是用户个人记忆知识库（wiki）的维护者。wiki 由 markdown 页面组成：一级标题是页面名，正文每条记忆一行，行格式必须是 `- 内容 <!--mem:编号|类型|分类-->`，编号注释必须原样保留（这是删除和追踪的依据）。",
    "整合要求：",
    "- 把新信息合并进最合适的页面；语义重复的条目要合并成一条（保留其中一个编号注释即可）；",
    "- 新旧矛盾时以新信息为准，删除或改写被取代的旧说法；",
    "- 可以新建页面（路径形如 pages/主题.md）承载新主题，也可以输出变少的既有页面全文；",
    "- 只输出需要写入的页面全文，未提及的页面保持不变；不要发明输入里没有的事实；",
    "- 敏感信息（密钥、口令、身份证号、手机号）不得写入页面；",
    "输出只包含一个 JSON 对象，格式：",
    '{"pages":[{"path":"pages/preferences.md","content":"# 用户偏好\\n\\n- 以后汇报用中文 <!--mem:编号|preference|用户偏好-->"}],"logEntry":"一句话记录本次做了什么"}',
  ];
  if (lint) {
    system.push("本次没有新记忆，做一次健康检查：合并语义重复、修正互相矛盾、把放错页面的条目移到合适的页面，并保持编号注释。");
  }
  const userParts = [`当前 wiki 页面：\n\n${pageSections || "（空）"}`];
  if (pendingLines) userParts.push(`待整合的新记忆：\n${pendingLines}`);
  else if (!lint) userParts.push("待整合的新记忆：\n（无）");
  return [
    { role: "system", content: system.join("\n") },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

export function parseConsolidationResult(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const candidates = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  candidates.push(raw);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.pages)) return parsed;
    } catch {
      // 尝试下一个候选
    }
  }
  return null;
}

function safePageRelPath(root, relPath) {
  const value = clean(relPath);
  if (!/^pages\/[\w\u3400-\u9fff][\w\u3400-\u9fff.-]*\.md$/.test(value) && !/^pages\/projects\/[\w\u3400-\u9fff][\w\u3400-\u9fff.-]*\.md$/.test(value)) return null;
  const resolved = path.resolve(root, value);
  if (resolved !== path.resolve(root) && !resolved.startsWith(`${path.resolve(root)}${path.sep}`)) return null;
  return value;
}

// 应用 LLM 整合结果：先整体校验再写盘，全部合法才生效；返回写入的页面数。
export async function applyConsolidation(root, result, { now } = {}) {
  if (!result || !Array.isArray(result.pages) || !result.pages.length) return 0;
  const planned = [];
  for (const page of result.pages) {
    const relPath = safePageRelPath(root, page?.path);
    const content = clean(page?.content);
    if (!relPath || !content || content.length > MAX_PAGE_CHARS || !/^# .+/m.test(content)) continue;
    planned.push({ relPath, content: `${content.trimEnd()}\n` });
  }
  if (!planned.length) return 0;
  for (const { relPath, content } of planned) {
    await writeTextFile(path.join(root, relPath), content);
    await removePageIfEmpty(root, relPath);
  }
  await rewriteIndex(root);
  await appendLog(root, "ingest", clean(result.logEntry) || `整合 ${planned.length} 个页面`, now);
  return planned.length;
}
