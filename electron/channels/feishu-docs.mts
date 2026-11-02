// 飞书云文档工具集（feishu_read_doc / feishu_search_docs / feishu_create_doc / feishu_write_doc / feishu_grant_doc_permission）：
// 纯 Node 模块，不依赖 electron，方便用 node --test 直接单测。
// 桌面端会话、定时任务与所有消息渠道共用；只要设置里配置了飞书 App ID 和 App Secret 即可调用。

import { FEISHU_OPEN_BASE, FeishuChannelError, getFeishuTenantToken } from "./feishu.mts";

export const FEISHU_DOC_TOOL_NAMES = new Set([
  "feishu_read_doc",
  "feishu_search_docs",
  "feishu_create_doc",
  "feishu_write_doc",
  "feishu_grant_doc_permission",
  "feishu_bitable_inspect",
  "feishu_bitable_read_records",
  "feishu_bitable_write_records",
  "feishu_sheet_read",
  "feishu_sheet_write",
]);

const MAX_DOC_READ_CHARS = 24_000;
const MAX_BLOCKS_PER_BATCH = 50;

export interface FeishuDocRef {
  type: "docx" | "wiki" | "doc" | "file" | "sheet" | "bitable";
  token: string;
  domain?: string;
  tableId?: string;
  viewId?: string;
  sheetId?: string;
}

// 解析飞书云文档或多维表格/电子表格 URL 或纯 Token
// 支持形如：
//   https://xxx.feishu.cn/docx/AbCdEf12345
//   https://xxx.feishu.cn/wiki/WiKiTok12345
//   https://xxx.feishu.cn/sheets/shtcnAbCdEf?sheet=shtId123
//   https://xxx.feishu.cn/base/bascnAbCdEf?table=tbl12345&view=vew67890
//   https://xxx.larksuite.com/docs/DocTok12345
//   或直接传入 Token 字符串
export function parseFeishuDocReference(input: string, fallbackType: FeishuDocRef["type"] = "docx"): FeishuDocRef | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      const domain = `${url.protocol}//${url.host}`;
      const tableId = url.searchParams.get("table")?.trim() || undefined;
      const viewId = url.searchParams.get("view")?.trim() || undefined;
      const sheetId = url.searchParams.get("sheet")?.trim() || undefined;
      const match = url.pathname.match(/\/(docx|wiki|docs|doc|file|sheets|base|bitable)\/([A-Za-z0-9_-]+)/i);
      if (match) {
        const segment = match[1].toLowerCase();
        const token = match[2];
        const type: FeishuDocRef["type"] = segment === "wiki"
          ? "wiki"
          : segment === "docs" || segment === "doc"
            ? "doc"
            : segment === "file"
              ? "file"
              : segment === "sheets"
                ? "sheet"
                : segment === "base" || segment === "bitable"
                  ? "bitable"
                  : "docx";
        return {
          type,
          token,
          domain,
          ...(tableId ? { tableId } : {}),
          ...(viewId ? { viewId } : {}),
          ...(sheetId ? { sheetId } : {}),
        };
      }
    }
  } catch {
    // 非法 URL 按普通字符串继续解析
  }
  const tokenMatch = raw.match(/^([A-Za-z0-9_-]{8,64})$/);
  if (tokenMatch) {
    const tok = tokenMatch[1];
    const inferredType: FeishuDocRef["type"] = fallbackType === "docx" && /^wik/i.test(tok)
      ? "wiki"
      : fallbackType === "docx" && /^bas/i.test(tok)
        ? "bitable"
        : fallbackType === "docx" && /^sht/i.test(tok)
          ? "sheet"
          : fallbackType;
    return { type: inferredType, token: tok };
  }
  return null;
}

// 递归剥离飞书 /blocks/convert 返回块中的只读字段（如 table.merge_info），避免批量写入时报错
export function sanitizeConvertedBlocks(input: any): any {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeConvertedBlocks(item));
  }
  if (!input || typeof input !== "object") return input;
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "merge_info") continue;
    if (key === "parent_id" || key === "block_id" || key === "children") continue;
    result[key] = sanitizeConvertedBlocks(value);
  }
  return result;
}

// 解析行内 Markdown（粗体、斜体、行内代码、链接）为飞书 Docx TextElement 数组
export function parseInlineMarkdownElements(line: string): any[] {
  const text = String(line ?? "");
  if (!text) return [{ text_run: { content: "" } }];
  const elements: any[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push({ text_run: { content: text.slice(lastIndex, match.index) } });
    }
    if (match[2] !== undefined) {
      elements.push({
        text_run: {
          content: match[2],
          text_element_style: { bold: true },
        },
      });
    } else if (match[3] !== undefined) {
      elements.push({
        text_run: {
          content: match[3],
          text_element_style: { inline_code: true },
        },
      });
    } else if (match[4] !== undefined && match[5] !== undefined) {
      elements.push({
        text_run: {
          content: match[4],
          text_element_style: { link: { url: encodeURI(match[5]) } },
        },
      });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    elements.push({ text_run: { content: text.slice(lastIndex) } });
  }
  return elements.length ? elements : [{ text_run: { content: text } }];
}

// 本地将 Markdown 文本转换为飞书 Docx Block 数组（作为内置转换器与 /blocks/convert 的高可靠回退）
export function markdownToFeishuBlocks(markdown: string): any[] {
  const source = String(markdown || "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  const lines = source.split("\n");
  const blocks: any[] = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    // 围栏代码块 ```lang ... ```
    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        block_type: 14,
        code: {
          style: { language: 1 },
          elements: [{ text_run: { content: codeLines.join("\n") } }],
        },
      });
      continue;
    }

    // 分割线 --- / ***
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push({ block_type: 22, divider: {} });
      index += 1;
      continue;
    }

    // 标题 # ~ ######
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length);
      const blockType = 2 + level; // heading1 = 3 .. heading6 = 8
      const fieldName = `heading${level}`;
      blocks.push({
        block_type: blockType,
        [fieldName]: {
          elements: parseInlineMarkdownElements(headingMatch[2].trim()),
        },
      });
      index += 1;
      continue;
    }

    // 待办事项 - [ ] / - [x]
    const todoMatch = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (todoMatch) {
      const done = todoMatch[1].toLowerCase() === "x";
      blocks.push({
        block_type: 17,
        todo: {
          style: { done },
          elements: parseInlineMarkdownElements(todoMatch[2].trim()),
        },
      });
      index += 1;
      continue;
    }

    // 无序列表 - / * / +
    const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push({
        block_type: 12,
        bullet: {
          elements: parseInlineMarkdownElements(bulletMatch[1].trim()),
        },
      });
      index += 1;
      continue;
    }

    // 有序列表 1. xxx
    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      blocks.push({
        block_type: 13,
        ordered: {
          elements: parseInlineMarkdownElements(orderedMatch[1].trim()),
        },
      });
      index += 1;
      continue;
    }

    // 引用块 > xxx
    const quoteMatch = trimmed.match(/^>\s*(.+)$/);
    if (quoteMatch) {
      blocks.push({
        block_type: 15,
        quote: {
          elements: parseInlineMarkdownElements(quoteMatch[1].trim()),
        },
      });
      index += 1;
      continue;
    }

    // 普通文本段落
    blocks.push({
      block_type: 2,
      text: {
        elements: parseInlineMarkdownElements(trimmed),
      },
    });
    index += 1;
  }

  return blocks;
}

// ---- 飞书云文档 API 客户端封装 ----

function createDocApiHelper({
  appId,
  appSecret,
  baseUrl = FEISHU_OPEN_BASE,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}: {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  const effectiveBaseUrl = String(baseUrl || FEISHU_OPEN_BASE).replace(/\/+$/, "");

  async function request(apiPath: string, { method = "GET", body }: { method?: string; body?: any } = {}) {
    const token = await getFeishuTenantToken({
      appId,
      appSecret,
      baseUrl: effectiveBaseUrl,
      fetchImpl,
      timeoutMs,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || 30_000));
    let response: Response;
    try {
      response = await fetchImpl(`${effectiveBaseUrl}${apiPath}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (error: any) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        throw new FeishuChannelError(`飞书云文档请求超时：${method} ${apiPath}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
      const err = new FeishuChannelError(
        `飞书云文档 API 失败 (${payload.code || response.status})：${payload.msg || payload.message || "请求被拒绝"}`,
      );
      err.code = payload.code || response.status;
      throw err;
    }
    return payload.data !== undefined ? payload.data : payload;
  }

  // 若引用的是 wiki 节点，先解析出实际的文档 obj_token 与类型
  async function resolveDocxToken(ref: FeishuDocRef): Promise<{ documentId: string; title?: string; wikiToken?: string; objType?: string }> {
    if (ref.type === "wiki") {
      const nodeData = await request(`/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(ref.token)}`);
      const node = nodeData?.node || nodeData || {};
      const objToken = String(node.obj_token || "").trim();
      const objType = String(node.obj_type || "docx").toLowerCase();
      if (!objToken) {
        throw new FeishuChannelError(`无法解析知识库节点 ${ref.token} 对应的文档 token`);
      }
      if (objType === "bitable") {
        throw new FeishuChannelError(`该知识库节点是多维表格（app_token=${objToken}），请使用 feishu_bitable_inspect 或 feishu_bitable_read_records 工具读取。`);
      }
      if (objType !== "docx" && objType !== "doc") {
        throw new FeishuChannelError(`该知识库节点类型为 ${objType}（token=${objToken}），当前仅支持读取文档类型（docx/doc）或多维表格（bitable）`);
      }
      return { documentId: objToken, title: String(node.title || "").trim() || undefined, wikiToken: ref.token, objType };
    }
    return { documentId: ref.token, objType: ref.type };
  }

  // 解析多维表格 app_token（兼容 /base/xxx、知识库 /wiki/xxx 内嵌多维表格及裸 token）
  async function resolveBitableToken(ref: FeishuDocRef): Promise<{ appToken: string; title?: string; tableId?: string; viewId?: string }> {
    if (ref.type === "wiki") {
      const nodeData = await request(`/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(ref.token)}`);
      const node = nodeData?.node || nodeData || {};
      const objToken = String(node.obj_token || "").trim();
      const objType = String(node.obj_type || "").toLowerCase();
      if (!objToken) {
        throw new FeishuChannelError(`无法解析知识库节点 ${ref.token} 对应的多维表格 token`);
      }
      if (objType && objType !== "bitable") {
        throw new FeishuChannelError(`该知识库节点类型为 ${objType}（token=${objToken}），并非多维表格（bitable）`);
      }
      return {
        appToken: objToken,
        title: String(node.title || "").trim() || undefined,
        tableId: ref.tableId,
        viewId: ref.viewId,
      };
    }
    return {
      appToken: ref.token,
      tableId: ref.tableId,
      viewId: ref.viewId,
    };
  }

  // 解析电子表格 spreadsheet_token（兼容 /sheets/xxx、知识库 /wiki/xxx 内嵌表格及裸 token）
  async function resolveSheetToken(ref: FeishuDocRef): Promise<{ spreadsheetToken: string; title?: string; sheetId?: string }> {
    if (ref.type === "wiki") {
      const nodeData = await request(`/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(ref.token)}`);
      const node = nodeData?.node || nodeData || {};
      const objToken = String(node.obj_token || "").trim();
      const objType = String(node.obj_type || "").toLowerCase();
      if (!objToken) {
        throw new FeishuChannelError(`无法解析知识库节点 ${ref.token} 对应的电子表格 token`);
      }
      if (objType && objType !== "sheet") {
        throw new FeishuChannelError(`该知识库节点类型为 ${objType}（token=${objToken}），并非电子表格（sheet）`);
      }
      return {
        spreadsheetToken: objToken,
        title: String(node.title || "").trim() || undefined,
        sheetId: ref.sheetId,
      };
    }
    return {
      spreadsheetToken: ref.token,
      sheetId: ref.sheetId,
    };
  }

  // 将 Markdown 转换为可插入的顶层块列表（优先调用官方 /blocks/convert，若无子块嵌套则剥离只读字段；失败或含复杂嵌套时回退本地解析）
  async function prepareBlocksFromMarkdown(markdown: string): Promise<any[]> {
    const text = String(markdown || "").trim();
    if (!text) return [];
    try {
      const converted = await request("/open-apis/docx/v1/documents/blocks/convert", {
        method: "POST",
        body: { content_type: "markdown", content: text },
      });
      const firstLevelIds: string[] = Array.isArray(converted?.first_level_block_ids) ? converted.first_level_block_ids : [];
      const allBlocks: any[] = Array.isArray(converted?.blocks) ? converted.blocks : [];
      if (allBlocks.length > 0) {
        const blockById = new Map<string, any>();
        for (const b of allBlocks) {
          if (b && b.block_id) blockById.set(String(b.block_id), b);
        }
        const orderedRaw = firstLevelIds.length > 0
          ? firstLevelIds.map((id) => blockById.get(String(id))).filter(Boolean)
          : allBlocks;
        // 仅当顶层块不依赖子块 ID 引用（如简单段落/标题/列表/代码块）时直接使用转换结果；
        // 若包含需要二次挂载子块的复杂容器（如 table 含 children IDs），使用 sanitized 顶层块或回退本地解析
        const hasUnresolvedChildren = orderedRaw.some((b) => Array.isArray(b?.children) && b.children.length > 0);
        if (!hasUnresolvedChildren && orderedRaw.length > 0) {
          return sanitizeConvertedBlocks(orderedRaw);
        }
      }
    } catch {
      // 应用未开通 docx:document.block:convert 权限或接口报错时，无缝回退本地转换
    }
    return markdownToFeishuBlocks(text);
  }

  async function appendBlocksToDocument(documentId: string, blocks: any[]) {
    if (!blocks.length) return 0;
    let inserted = 0;
    for (let offset = 0; offset < blocks.length; offset += MAX_BLOCKS_PER_BATCH) {
      const batch = blocks.slice(offset, offset + MAX_BLOCKS_PER_BATCH);
      await request(`/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children`, {
        method: "POST",
        body: {
          index: -1,
          children: batch,
        },
      });
      inserted += batch.length;
    }
    return inserted;
  }

  return {
    request,
    resolveDocxToken,
    resolveBitableToken,
    resolveSheetToken,
    prepareBlocksFromMarkdown,
    appendBlocksToDocument,
  };
}

// ---- 五个工具的具体实现 ----

async function readFeishuDoc(api: ReturnType<typeof createDocApiHelper>, args: any) {
  const rawInput = String(args?.url_or_token || args?.document_id || args?.url || args?.token || "").trim();
  const explicitType = String(args?.doc_type || "").trim().toLowerCase();
  const fallbackType: FeishuDocRef["type"] = explicitType === "wiki" ? "wiki" : "docx";
  const ref = parseFeishuDocReference(rawInput, fallbackType);
  if (!ref) {
    return { error: "请提供有效的飞书云文档链接（如 https://xxx.feishu.cn/docx/... 或 /wiki/...）或文档 token。" };
  }

  let resolved: { documentId: string; title?: string; wikiToken?: string };
  try {
    resolved = await api.resolveDocxToken(ref);
  } catch (error: any) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  let docId = resolved.documentId;
  let title = resolved.title || "";
  let rawContent = "";

  try {
    const [meta, contentData] = await Promise.all([
      api.request(`/open-apis/docx/v1/documents/${encodeURIComponent(docId)}`).catch(() => ({})),
      api.request(`/open-apis/docx/v1/documents/${encodeURIComponent(docId)}/raw_content?lang=0`),
    ]);
    title = String(meta?.document?.title || title || "未命名飞书文档").trim();
    rawContent = String(contentData?.content ?? "").trim();
  } catch (firstError: any) {
    // 若用户只传了纯 token 且未标注 wiki，尝试按 wiki 节点二次解析
    if (ref.type === "docx" && !explicitType) {
      try {
        const wikiResolved = await api.resolveDocxToken({ type: "wiki", token: ref.token });
        docId = wikiResolved.documentId;
        const [meta, contentData] = await Promise.all([
          api.request(`/open-apis/docx/v1/documents/${encodeURIComponent(docId)}`).catch(() => ({})),
          api.request(`/open-apis/docx/v1/documents/${encodeURIComponent(docId)}/raw_content?lang=0`),
        ]);
        title = String(meta?.document?.title || wikiResolved.title || "未命名飞书文档").trim();
        rawContent = String(contentData?.content ?? "").trim();
      } catch {
        return { error: firstError instanceof Error ? firstError.message : String(firstError) };
      }
    } else {
      return { error: firstError instanceof Error ? firstError.message : String(firstError) };
    }
  }

  const truncated = rawContent.length > MAX_DOC_READ_CHARS
    ? `${rawContent.slice(0, MAX_DOC_READ_CHARS)}\n\n…（文档较长，已截断前 ${MAX_DOC_READ_CHARS} 字符）`
    : rawContent || "（文档内容为空）";

  return {
    text: `📄 飞书文档「${title}」（document_id=${docId}）\n\n${truncated}`,
  };
}

async function searchFeishuDocs(api: ReturnType<typeof createDocApiHelper>, args: any) {
  const query = String(args?.query || args?.keyword || "").trim();
  const limit = Math.min(50, Math.max(1, Math.floor(Number(args?.limit) || 15)));
  const items: Array<{ title: string; type: string; token: string; url?: string }> = [];
  const seen = new Set<string>();

  const pushItem = (title: string, type: string, token: string, url?: string) => {
    const cleanToken = String(token || "").trim();
    if (!cleanToken || seen.has(cleanToken)) return;
    seen.add(cleanToken);
    items.push({
      title: String(title || "未命名文档").trim(),
      type: String(type || "docx"),
      token: cleanToken,
      ...(url ? { url: String(url) } : {}),
    });
  };

  // 1. 尝试调用搜索接口（/open-apis/suite/docs-api/search/object）
  if (query) {
    try {
      const searchData = await api.request("/open-apis/suite/docs-api/search/object", {
        method: "POST",
        body: { search_key: query, count: limit, offset: 0 },
      });
      const entities = Array.isArray(searchData?.docs_entities) ? searchData.docs_entities : [];
      for (const entity of entities) {
        pushItem(entity.title, entity.docs_type || entity.type, entity.docs_token || entity.token, entity.url);
      }
    } catch {
      // tenant_access_token 在部分租户下不支持 suite/docs-api/search/object，继续走云盘与知识库列表过滤
    }
  }

  // 2. 查询应用可见的云空间文件清单（/open-apis/drive/v1/files）
  if (items.length < limit) {
    try {
      const driveData = await api.request(`/open-apis/drive/v1/files?page_size=${Math.min(50, limit * 2)}`);
      const files = Array.isArray(driveData?.files) ? driveData.files : [];
      for (const file of files) {
        const name = String(file?.name || file?.title || "").trim();
        if (query && !name.toLowerCase().includes(query.toLowerCase())) continue;
        pushItem(name, file?.type || "docx", file?.token, file?.url);
        if (items.length >= limit) break;
      }
    } catch {
      // 忽略云盘列表权限不足
    }
  }

  // 3. 查询应用可见的知识库空间与一级节点（/open-apis/wiki/v2/spaces）
  if (items.length < limit) {
    try {
      const spacesData = await api.request("/open-apis/wiki/v2/spaces?page_size=20");
      const spaces = Array.isArray(spacesData?.items) ? spacesData.items : [];
      for (const space of spaces) {
        const spaceId = String(space?.space_id || "").trim();
        const spaceName = String(space?.name || "").trim();
        if (!spaceId) continue;
        const nodesData = await api.request(`/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes?page_size=50`).catch(() => ({}));
        const nodes = Array.isArray(nodesData?.items) ? nodesData.items : [];
        for (const node of nodes) {
          const nodeTitle = String(node?.title || "").trim();
          const fullTitle = spaceName ? `${spaceName} / ${nodeTitle}` : nodeTitle;
          if (query && !fullTitle.toLowerCase().includes(query.toLowerCase())) continue;
          pushItem(fullTitle, node?.obj_type || "wiki", node?.obj_token || node?.node_token);
          if (items.length >= limit) break;
        }
        if (items.length >= limit) break;
      }
    } catch {
      // 忽略知识库列表权限不足
    }
  }

  if (!items.length) {
    return {
      text: query
        ? `没有找到包含「${query}」的飞书云文档或知识库节点。若文档已存在，可直接将飞书文档链接提供给 feishu_read_doc。`
        : "当前飞书应用名下暂无可见的云空间文档或知识库节点。",
    };
  }

  const lines = items.slice(0, limit).map((item, idx) => {
    const linkPart = item.url ? ` · 链接: ${item.url}` : ` · https://feishu.cn/docx/${item.token}`;
    return `${idx + 1}. 「${item.title}」 [${item.type}] · token=${item.token}${linkPart}`;
  });
  return {
    text: `找到 ${lines.length} 个飞书云文档：\n${lines.join("\n")}`,
  };
}

async function createFeishuDoc(
  api: ReturnType<typeof createDocApiHelper>,
  args: any,
  context: { defaultOpenId?: string } = {},
) {
  const title = String(args?.title || "").trim();
  if (!title) {
    return { error: "缺少文档标题（title）。" };
  }
  const folderToken = String(args?.folder_token || "").trim();
  const markdown = String(args?.markdown ?? args?.content ?? "").trim();

  const created = await api.request("/open-apis/docx/v1/documents", {
    method: "POST",
    body: {
      title,
      ...(folderToken ? { folder_token: folderToken } : {}),
    },
  });
  const doc = created?.document || created || {};
  const documentId = String(doc.document_id || "").trim();
  if (!documentId) {
    return { error: "飞书云文档创建失败：响应缺少 document_id" };
  }

  let insertedBlocks = 0;
  if (markdown) {
    const blocks = await api.prepareBlocksFromMarkdown(markdown);
    insertedBlocks = await api.appendBlocksToDocument(documentId, blocks);
  }

  // 若指定了协作者 open_id 或当前处于飞书单聊/群聊会话，自动为发起人添加可管理权限
  const targetOpenId = String(args?.grant_open_id || context.defaultOpenId || "").trim();
  let permissionNote = "";
  if (targetOpenId && targetOpenId.startsWith("ou_")) {
    try {
      await api.request(
        `/open-apis/drive/v1/permissions/${encodeURIComponent(documentId)}/members?type=docx&need_notification=false`,
        {
          method: "POST",
          body: {
            member_type: "openid",
            member_id: targetOpenId,
            perm: "full_access",
          },
        },
      );
      permissionNote = `，已自动授予当前飞书用户（${targetOpenId}）可管理权限`;
    } catch {
      // 若未开启云空间权限管理接口，尝试开启组织内链接可编辑作为兜底
      try {
        await api.request(`/open-apis/drive/v1/permissions/${encodeURIComponent(documentId)}/public?type=docx`, {
          method: "PATCH",
          body: {
            external_access: true,
            security_entity: "anyone_can_view",
            comment_entity: "anyone_can_view",
            share_entity: "anyone",
            link_share_entity: "tenant_editable",
          },
        });
        permissionNote = "，已开启企业内持链接可编辑权限";
      } catch {
        permissionNote = "（提示：如需个人账号编辑，请调用 feishu_grant_doc_permission 或在飞书后台开启 drive:permission 权限）";
      }
    }
  } else {
    // 桌面端创建时，默认尝试开启组织内链接可编辑，方便用户在浏览器打开即可编辑
    try {
      await api.request(`/open-apis/drive/v1/permissions/${encodeURIComponent(documentId)}/public?type=docx`, {
        method: "PATCH",
        body: {
          link_share_entity: "tenant_editable",
        },
      });
      permissionNote = "，已开启企业内持链接可编辑";
    } catch {
      // 忽略权限设置错误
    }
  }

  const docUrl = String(doc.url || `https://feishu.cn/docx/${documentId}`);
  return {
    text: `已创建飞书云文档「${title}」\n- document_id: ${documentId}\n- 链接: ${docUrl}\n- 写入段落块数: ${insertedBlocks}${permissionNote}`,
  };
}

async function writeFeishuDoc(api: ReturnType<typeof createDocApiHelper>, args: any) {
  const rawInput = String(args?.url_or_token || args?.document_id || args?.url || args?.token || "").trim();
  const markdown = String(args?.markdown ?? args?.content ?? "").trim();
  const mode = String(args?.mode || "append").trim().toLowerCase() === "replace" ? "replace" : "append";
  if (!rawInput) {
    return { error: "请提供目标飞书文档链接或 document_id（url_or_token）。" };
  }
  if (!markdown) {
    return { error: "请提供要写入的 Markdown 内容（markdown）。" };
  }
  const ref = parseFeishuDocReference(rawInput, "docx");
  if (!ref) {
    return { error: "无法解析目标飞书文档链接或 token。" };
  }
  const { documentId } = await api.resolveDocxToken(ref);

  if (mode === "replace") {
    const rootBlock = await api.request(
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}`,
    ).catch(() => null);
    const children = Array.isArray(rootBlock?.block?.children)
      ? rootBlock.block.children
      : Array.isArray(rootBlock?.children)
        ? rootBlock.children
        : [];
    if (children.length > 0) {
      await api.request(
        `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children/batch_delete`,
        {
          method: "DELETE",
          body: {
            start_index: 0,
            end_index: children.length,
          },
        },
      );
    }
  }

  const blocks = await api.prepareBlocksFromMarkdown(markdown);
  const insertedBlocks = await api.appendBlocksToDocument(documentId, blocks);
  return {
    text: `已${mode === "replace" ? "覆写" : "追加"}飞书云文档（document_id=${documentId}），共写入 ${insertedBlocks} 个内容块。`,
  };
}

async function grantFeishuDocPermission(
  api: ReturnType<typeof createDocApiHelper>,
  args: any,
  context: { defaultOpenId?: string } = {},
) {
  const rawInput = String(args?.url_or_token || args?.document_id || args?.token || "").trim();
  if (!rawInput) {
    return { error: "请提供目标飞书文档链接或 token（url_or_token）。" };
  }
  const ref = parseFeishuDocReference(rawInput, "docx");
  if (!ref) {
    return { error: "无法解析目标飞书文档链接或 token。" };
  }
  const { documentId, objType } = ref.type === "bitable"
    ? { documentId: ref.token, objType: "bitable" }
    : ref.type === "sheet"
      ? { documentId: ref.token, objType: "sheet" }
      : await api.resolveDocxToken(ref);
  const docType = String(args?.doc_type || objType || (ref.type === "wiki" ? "docx" : ref.type) || "docx").toLowerCase();

  const memberId = String(args?.member_id || context.defaultOpenId || "").trim();
  const memberType = String(
    args?.member_type || (memberId.includes("@") ? "email" : memberId.startsWith("oc_") ? "openchat" : "openid"),
  ).trim().toLowerCase();
  const perm = ["view", "edit", "full_access"].includes(String(args?.perm || "").toLowerCase())
    ? String(args.perm).toLowerCase()
    : "edit";
  const linkShare = String(args?.link_share_entity || "").trim();

  const actions: string[] = [];

  if (memberId) {
    await api.request(
      `/open-apis/drive/v1/permissions/${encodeURIComponent(documentId)}/members?type=${encodeURIComponent(docType)}&need_notification=false`,
      {
        method: "POST",
        body: {
          member_type: memberType,
          member_id: memberId,
          perm,
        },
      },
    );
    actions.push(`已为用户 ${memberId}（${memberType}）授予 ${perm} 权限`);
  }

  if (linkShare) {
    await api.request(
      `/open-apis/drive/v1/permissions/${encodeURIComponent(documentId)}/public?type=${encodeURIComponent(docType)}`,
      {
        method: "PATCH",
        body: {
          link_share_entity: linkShare,
        },
      },
    );
    actions.push(`已更新链接分享权限为 ${linkShare}`);
  }

  if (!actions.length) {
    return {
      error: "请提供协作者标识（member_id，如飞书 open_id 或邮箱）或链接分享范围（link_share_entity，如 tenant_readable / tenant_editable）。",
    };
  }

  return {
    text: `飞书文档（${documentId}）权限设置成功：${actions.join("；")}。`,
  };
}

// ---- 飞书多维表格（Bitable）工具实现 ----

const BITABLE_FIELD_TYPE_LABELS: Record<number, string> = {
  1: "多行文本(Text)",
  2: "数字(Number)",
  3: "单选(SingleSelect)",
  4: "多选(MultiSelect)",
  5: "日期(DateTime)",
  7: "复选框(Checkbox)",
  11: "人员(User)",
  13: "电话号码(Phone)",
  15: "超链接(Url)",
  17: "附件(Attachment)",
  18: "单向关联(SingleLink)",
  19: "查找引用(Lookup)",
  20: "公式(Formula)",
  21: "双向关联(DuplexLink)",
  22: "地理位置(Location)",
  23: "群组(GroupChat)",
  1001: "创建时间(CreatedTime)",
  1002: "最后更新时间(ModifiedTime)",
  1003: "创建人(CreatedUser)",
  1004: "修改人(ModifiedUser)",
  1005: "自动编号(AutoNumber)",
};

// 将飞书多维表格单元格值（如富文本段落数组、人员对象数组、超链接对象等）扁平化为易读格式
export function formatBitableCellValue(value: any): any {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    // 飞书 v1 search 接口多行文本返回 [{ type: "text" | "url" | "mention", text: "..." }]
    if (value.length > 0 && value.every((item) => item && typeof item === "object" && ("text" in item || item.type === "text"))) {
      return value.map((item) => String(item.text ?? "")).join("");
    }
    // 人员字段 [{ id: "ou_xxx", name: "张三" }]
    if (value.length > 0 && value.every((item) => item && typeof item === "object" && ("name" in item || "en_name" in item) && "id" in item)) {
      return value.map((item) => `${item.name || item.en_name || item.id}(${item.id})`);
    }
    // 附件字段 [{ name: "a.pdf", file_token: "..." }]
    if (value.length > 0 && value.every((item) => item && typeof item === "object" && "file_token" in item)) {
      return value.map((item) => ({ name: item.name, file_token: item.file_token, size: item.size }));
    }
    return value.map((item) => formatBitableCellValue(item));
  }
  if (typeof value === "object") {
    // 超链接字段 { text: "...", link: "..." }
    if ("link" in value && typeof value.link === "string") {
      return value.text && value.text !== value.link ? `${value.text} (${value.link})` : value.link;
    }
    // 公式/引用包装 { type: 1, value: [...] }
    if ("value" in value && Object.keys(value).length <= 3) {
      return formatBitableCellValue(value.value);
    }
  }
  return value;
}

function parseJsonOrObject(input: any): any {
  if (!input) return undefined;
  if (typeof input === "object") return input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function inspectFeishuBitable(api: ReturnType<typeof createDocApiHelper>, args: any) {
  const rawInput = String(args?.url_or_token || args?.app_token || args?.url || args?.token || "").trim();
  const ref = parseFeishuDocReference(rawInput, "bitable");
  if (!ref) {
    return { error: "请提供有效的飞书多维表格链接（如 https://xxx.feishu.cn/base/bascn... 或 /wiki/...）或 app_token。" };
  }

  let resolved: { appToken: string; title?: string; tableId?: string; viewId?: string };
  try {
    resolved = await api.resolveBitableToken(ref);
  } catch (error: any) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const appToken = resolved.appToken;
  const requestedTableId = String(args?.table_id || resolved.tableId || "").trim();

  const [appMeta, tablesData] = await Promise.all([
    api.request(`/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}`).catch(() => ({})),
    api.request(`/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?page_size=100`),
  ]);

  const appName = String(appMeta?.app?.name || resolved.title || "未命名多维表格").trim();
  const tables: any[] = Array.isArray(tablesData?.items) ? tablesData.items : [];
  if (!tables.length) {
    return {
      text: `📊 飞书多维表格「${appName}」（app_token=${appToken}）当前没有任何数据表。`,
    };
  }

  const activeTable = (requestedTableId && tables.find((t) => t.table_id === requestedTableId)) || tables[0];
  const activeTableId = String(activeTable?.table_id || requestedTableId || "").trim();
  const activeTableName = String(activeTable?.name || activeTableId).trim();

  let fields: any[] = [];
  if (activeTableId) {
    const fieldsData = await api
      .request(`/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(activeTableId)}/fields?page_size=100`)
      .catch(() => ({}));
    fields = Array.isArray(fieldsData?.items) ? fieldsData.items : [];
  }

  const tableLines = tables.map((t, idx) => {
    const marker = t.table_id === activeTableId ? "（当前查看）" : "";
    return `  ${idx + 1}. 「${t.name || "未命名表"}」 · table_id=${t.table_id}${marker}`;
  });

  const fieldLines = fields.map((f, idx) => {
    const typeNum = Number(f.type);
    const typeLabel = BITABLE_FIELD_TYPE_LABELS[typeNum] || f.ui_type || `type=${f.type}`;
    const options = Array.isArray(f?.property?.options)
      ? f.property.options.map((o: any) => o.name).filter(Boolean)
      : [];
    const optionsNote = options.length > 0 ? ` · 可选项: [${options.slice(0, 20).join(", ")}]` : "";
    return `  ${idx + 1}. 「${f.field_name}」 [${typeLabel}] · field_id=${f.field_id}${optionsNote}`;
  });

  return {
    text: [
      `📊 飞书多维表格「${appName}」（app_token=${appToken}）`,
      ``,
      `包含数据表（共 ${tables.length} 张）：`,
      ...tableLines,
      ``,
      `数据表「${activeTableName}」（table_id=${activeTableId}）字段定义（共 ${fields.length} 列）：`,
      ...(fieldLines.length ? fieldLines : ["  （未读取到字段信息）"]),
    ].join("\n"),
  };
}

async function readFeishuBitableRecords(api: ReturnType<typeof createDocApiHelper>, args: any) {
  const rawInput = String(args?.url_or_token || args?.app_token || args?.url || args?.token || "").trim();
  const ref = parseFeishuDocReference(rawInput, "bitable");
  if (!ref) {
    return { error: "请提供有效的飞书多维表格链接（如 https://xxx.feishu.cn/base/bascn...）或 app_token。" };
  }

  const resolved = await api.resolveBitableToken(ref);
  const appToken = resolved.appToken;
  let tableId = String(args?.table_id || resolved.tableId || "").trim();
  const viewId = String(args?.view_id || resolved.viewId || "").trim();

  if (!tableId) {
    const tablesData = await api.request(`/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?page_size=20`);
    const tables: any[] = Array.isArray(tablesData?.items) ? tablesData.items : [];
    tableId = String(tables[0]?.table_id || "").trim();
    if (!tableId) {
      return { error: `多维表格（app_token=${appToken}）中未找到任何数据表。` };
    }
  }

  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(args?.page_size || args?.limit) || 50)));
  const pageToken = String(args?.page_token || "").trim();
  const filterObj = parseJsonOrObject(args?.filter);
  const sortObj = parseJsonOrObject(args?.sort);
  const fieldNamesObj = parseJsonOrObject(args?.field_names);

  const queryParams = new URLSearchParams({ page_size: String(pageSize) });
  if (pageToken) queryParams.set("page_token", pageToken);

  let recordsData: any;
  try {
    const searchBody: Record<string, any> = {};
    if (viewId) searchBody.view_id = viewId;
    if (filterObj) searchBody.filter = filterObj;
    if (Array.isArray(sortObj)) searchBody.sort = sortObj;
    if (Array.isArray(fieldNamesObj)) searchBody.field_names = fieldNamesObj;

    recordsData = await api.request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/search?${queryParams.toString()}`,
      {
        method: "POST",
        body: searchBody,
      },
    );
  } catch {
    // 回退到旧版 GET /records 接口
    recordsData = await api.request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?${queryParams.toString()}`,
    );
  }

  const items: any[] = Array.isArray(recordsData?.items) ? recordsData.items : [];
  const total = Number(recordsData?.total ?? items.length);
  const hasMore = Boolean(recordsData?.has_more);
  const nextPageToken = String(recordsData?.page_token || "").trim();

  const normalizedRecords = items.map((item) => {
    const rawFields = item?.fields && typeof item.fields === "object" ? item.fields : {};
    const cleanFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(rawFields)) {
      cleanFields[k] = formatBitableCellValue(v);
    }
    return {
      record_id: item.record_id,
      fields: cleanFields,
    };
  });

  const jsonPreview = JSON.stringify(normalizedRecords, null, 2);
  const truncated = jsonPreview.length > MAX_DOC_READ_CHARS
    ? `${jsonPreview.slice(0, MAX_DOC_READ_CHARS)}\n…（记录内容较长，已截断，请减小 page_size 或使用 filter 筛选）`
    : jsonPreview;

  return {
    text: [
      `📊 多维表格记录查询结果（app_token=${appToken}, table_id=${tableId}）`,
      `共匹配 ${total} 条记录，本次返回 ${normalizedRecords.length} 条${hasMore ? `（还有更多记录，下一页 page_token=${nextPageToken}）` : ""}：`,
      ``,
      truncated,
    ].join("\n"),
  };
}

async function writeFeishuBitableRecords(
  api: ReturnType<typeof createDocApiHelper>,
  args: any,
  context: { defaultOpenId?: string } = {},
) {
  const action = String(args?.action || "add_records").trim().toLowerCase();

  // 1. 创建全新的多维表格应用
  if (action === "create_app") {
    const name = String(args?.name || args?.title || "新建多维表格").trim();
    const folderToken = String(args?.folder_token || "").trim();
    const created = await api.request("/open-apis/bitable/v1/apps", {
      method: "POST",
      body: {
        name,
        ...(folderToken ? { folder_token: folderToken } : {}),
      },
    });
    const appObj = created?.app || created || {};
    const appToken = String(appObj.app_token || "").trim();
    const defaultTableId = String(appObj.default_table_id || "").trim();
    const url = String(appObj.url || `https://feishu.cn/base/${appToken}`);
    if (!appToken) {
      return { error: "创建飞书多维表格失败：响应缺少 app_token" };
    }

    // 自动为当前飞书会话用户或指定 open_id 授予 full_access 权限
    const targetOpenId = String(args?.grant_open_id || context.defaultOpenId || "").trim();
    let permNote = "";
    if (targetOpenId && targetOpenId.startsWith("ou_")) {
      try {
        await api.request(
          `/open-apis/drive/v1/permissions/${encodeURIComponent(appToken)}/members?type=bitable&need_notification=false`,
          {
            method: "POST",
            body: {
              member_type: "openid",
              member_id: targetOpenId,
              perm: "full_access",
            },
          },
        );
        permNote = `，已自动授予飞书用户（${targetOpenId}）可管理权限`;
      } catch {
        // 忽略权限异常
      }
    }

    return {
      text: `已创建飞书多维表格「${name}」\n- app_token: ${appToken}${defaultTableId ? `\n- 默认数据表 table_id: ${defaultTableId}` : ""}\n- 链接: ${url}${permNote}`,
    };
  }

  // 其余操作均针对已有多维表格
  const rawInput = String(args?.url_or_token || args?.app_token || args?.url || args?.token || "").trim();
  const ref = parseFeishuDocReference(rawInput, "bitable");
  if (!ref) {
    return { error: "请提供目标飞书多维表格链接或 app_token（url_or_token）。" };
  }
  const resolved = await api.resolveBitableToken(ref);
  const appToken = resolved.appToken;

  // 2. 在多维表格中新建数据表
  if (action === "create_table") {
    const tableName = String(args?.table_name || args?.name || args?.title || "").trim();
    if (!tableName) {
      return { error: "create_table 操作需要提供新数据表名称（table_name）。" };
    }
    const fieldsInput = parseJsonOrObject(args?.fields);
    const tablePayload: Record<string, any> = { name: tableName };
    if (Array.isArray(fieldsInput) && fieldsInput.length > 0) {
      tablePayload.fields = fieldsInput;
    }
    const createdTable = await api.request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`,
      {
        method: "POST",
        body: { table: tablePayload },
      },
    );
    const newTableId = String(createdTable?.table_id || "").trim();
    return {
      text: `已在多维表格（${appToken}）中新建数据表「${tableName}」（table_id=${newTableId}）。`,
    };
  }

  // 3/4/5. 针对具体数据表的记录增删改
  let tableId = String(args?.table_id || resolved.tableId || "").trim();
  if (!tableId) {
    const tablesData = await api.request(`/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?page_size=20`);
    const tables: any[] = Array.isArray(tablesData?.items) ? tablesData.items : [];
    tableId = String(tables[0]?.table_id || "").trim();
    if (!tableId) {
      return { error: `多维表格（app_token=${appToken}）中未找到任何数据表，请先创建数据表或显式指定 table_id。` };
    }
  }

  if (action === "add_records") {
    const rawRecords = parseJsonOrObject(args?.records);
    const list = Array.isArray(rawRecords) ? rawRecords : rawRecords && typeof rawRecords === "object" ? [rawRecords] : [];
    if (!list.length) {
      return { error: "add_records 需要提供 records 数组（每项为字段键值对对象或 { fields: {...} }）。" };
    }
    const formatted = list.map((item) => ({
      fields: item && typeof item === "object" && item.fields && typeof item.fields === "object" ? item.fields : item,
    }));
    const res = await api.request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_create`,
      {
        method: "POST",
        body: { records: formatted },
      },
    );
    const createdRecords: any[] = Array.isArray(res?.records) ? res.records : [];
    const ids = createdRecords.map((r) => r.record_id).filter(Boolean);
    return {
      text: `已向多维表格（app_token=${appToken}, table_id=${tableId}）新增 ${createdRecords.length || formatted.length} 条记录${ids.length ? `（record_ids: ${ids.join(", ")}）` : ""}。`,
    };
  }

  if (action === "update_records") {
    const rawRecords = parseJsonOrObject(args?.records);
    const list = Array.isArray(rawRecords) ? rawRecords : rawRecords && typeof rawRecords === "object" ? [rawRecords] : [];
    if (!list.length || !list.every((item) => item && item.record_id && item.fields)) {
      return { error: "update_records 需要提供 records 数组，且每项必须包含 record_id 与 fields，例如 [{ \"record_id\": \"recxxx\", \"fields\": { \"状态\": \"已完成\" } }]。" };
    }
    const formatted = list.map((item) => ({
      record_id: String(item.record_id).trim(),
      fields: item.fields,
    }));
    const res = await api.request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_update`,
      {
        method: "POST",
        body: { records: formatted },
      },
    );
    const updatedRecords: any[] = Array.isArray(res?.records) ? res.records : [];
    return {
      text: `已更新多维表格（app_token=${appToken}, table_id=${tableId}）中的 ${updatedRecords.length || formatted.length} 条记录。`,
    };
  }

  if (action === "delete_records") {
    const rawIds = parseJsonOrObject(args?.record_ids ?? args?.records);
    const idList = (Array.isArray(rawIds) ? rawIds : typeof args?.record_ids === "string" ? args.record_ids.split(",") : [])
      .map((item: any) => String(typeof item === "object" ? item?.record_id || "" : item).trim())
      .filter(Boolean);
    if (!idList.length) {
      return { error: "delete_records 需要提供要删除的 record_ids 数组（如 [\"recxxx\"]）。" };
    }
    await api.request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_delete`,
      {
        method: "POST",
        body: { records: idList },
      },
    );
    return {
      text: `已从多维表格（app_token=${appToken}, table_id=${tableId}）删除 ${idList.length} 条记录。`,
    };
  }

  return {
    error: `不支持的多维表格操作 action="${action}"，可选值为：create_app、create_table、add_records、update_records、delete_records。`,
  };
}

// ---- 飞书电子表格（Sheet）工具实现 ----

export function formatSheetValuesAsMarkdown(values: any[][]): string {
  if (!Array.isArray(values) || !values.length) return "（工作表暂无数据）";
  const rows = values.map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? "").replace(/[\r\n]+/g, " ").trim()) : []));
  const maxCols = Math.max(...rows.map((r) => r.length), 1);
  const normalizedRows = rows.map((r) => {
    const padded = [...r];
    while (padded.length < maxCols) padded.push("");
    return padded;
  });
  const header = normalizedRows[0].map((cell, idx) => cell || `列${idx + 1}`);
  const separator = header.map(() => "---");
  const dataRows = normalizedRows.slice(1);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...dataRows.map((r) => `| ${r.join(" | ")} |`),
  ];
  return lines.join("\n");
}

async function readFeishuSheet(api: ReturnType<typeof createDocApiHelper>, args: any) {
  const rawInput = String(args?.url_or_token || args?.spreadsheet_token || args?.url || args?.token || "").trim();
  const ref = parseFeishuDocReference(rawInput, "sheet");
  if (!ref) {
    return { error: "请提供有效的飞书电子表格链接（如 https://xxx.feishu.cn/sheets/shtcn... 或 /wiki/...）或 spreadsheet_token。" };
  }

  let resolved: { spreadsheetToken: string; title?: string; sheetId?: string };
  try {
    resolved = await api.resolveSheetToken(ref);
  } catch (error: any) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const spreadsheetToken = resolved.spreadsheetToken;
  const [meta, sheetsData] = await Promise.all([
    api.request(`/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}`).catch(() => ({})),
    api.request(`/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query`),
  ]);

  const docTitle = String(meta?.spreadsheet?.title || resolved.title || "未命名电子表格").trim();
  const sheets: any[] = Array.isArray(sheetsData?.sheets) ? sheetsData.sheets : [];
  if (!sheets.length) {
    return {
      text: `📈 飞书电子表格「${docTitle}」（spreadsheet_token=${spreadsheetToken}）未包含任何工作表。`,
    };
  }

  const requestedSheetId = String(args?.sheet_id || resolved.sheetId || "").trim();
  const requestedRange = String(args?.range || "").trim();

  let targetSheet = sheets[0];
  if (requestedSheetId) {
    targetSheet = sheets.find((s) => s.sheet_id === requestedSheetId) || targetSheet;
  } else if (requestedRange && requestedRange.includes("!")) {
    const sheetPrefix = requestedRange.split("!")[0].trim();
    targetSheet = sheets.find((s) => s.title === sheetPrefix || s.sheet_id === sheetPrefix) || targetSheet;
  }

  const targetSheetId = String(targetSheet?.sheet_id || "").trim();
  const targetSheetTitle = String(targetSheet?.title || targetSheetId).trim();
  const readRange = requestedRange
    ? (requestedRange.includes("!") ? requestedRange : `${targetSheetId}!${requestedRange}`)
    : targetSheetId;

  let values: any[][] = [];
  try {
    const valueData = await api.request(
      `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${encodeURIComponent(readRange)}?valueRenderOption=ToString&dateTimeRenderOption=FormattedString`,
    );
    values = Array.isArray(valueData?.valueRange?.values) ? valueData.valueRange.values : [];
  } catch (err: any) {
    return { error: `读取电子表格数据失败 (${readRange})：${err instanceof Error ? err.message : String(err)}` };
  }

  const sheetLines = sheets.map((s, idx) => {
    const marker = s.sheet_id === targetSheetId ? "（当前查看）" : "";
    const rows = s?.grid_properties?.row_count ?? "?";
    const cols = s?.grid_properties?.column_count ?? "?";
    return `  ${idx + 1}. 「${s.title}」 · sheet_id=${s.sheet_id} (${rows}行 × ${cols}列)${marker}`;
  });

  const mdTable = formatSheetValuesAsMarkdown(values);
  const truncatedTable = mdTable.length > MAX_DOC_READ_CHARS
    ? `${mdTable.slice(0, MAX_DOC_READ_CHARS)}\n\n…（数据较多，已截断前 ${MAX_DOC_READ_CHARS} 字符，可指定具体 range 范围查看）`
    : mdTable;

  return {
    text: [
      `📈 飞书电子表格「${docTitle}」（spreadsheet_token=${spreadsheetToken}）`,
      ``,
      `包含工作表（共 ${sheets.length} 个）：`,
      ...sheetLines,
      ``,
      `工作表「${targetSheetTitle}」（范围: ${readRange}，共 ${values.length} 行数据）：`,
      truncatedTable,
    ].join("\n"),
  };
}

async function writeFeishuSheet(
  api: ReturnType<typeof createDocApiHelper>,
  args: any,
  context: { defaultOpenId?: string } = {},
) {
  const action = String(args?.action || "append").trim().toLowerCase();

  // 1. 创建全新电子表格
  if (action === "create") {
    const title = String(args?.title || args?.name || "新建电子表格").trim();
    const folderToken = String(args?.folder_token || "").trim();
    const created = await api.request("/open-apis/sheets/v3/spreadsheets", {
      method: "POST",
      body: {
        title,
        ...(folderToken ? { folder_token: folderToken } : {}),
      },
    });
    const spreadsheet = created?.spreadsheet || created || {};
    const spreadsheetToken = String(spreadsheet.spreadsheet_token || "").trim();
    const url = String(spreadsheet.url || `https://feishu.cn/sheets/${spreadsheetToken}`);
    if (!spreadsheetToken) {
      return { error: "创建飞书电子表格失败：响应缺少 spreadsheet_token" };
    }

    // 如提供初始数据，写入默认工作表
    const rawValues = parseJsonOrObject(args?.values);
    if (Array.isArray(rawValues) && rawValues.length > 0) {
      try {
        const sheetsData = await api.request(`/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query`);
        const firstSheetId = sheetsData?.sheets?.[0]?.sheet_id;
        if (firstSheetId) {
          await api.request(
            `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values`,
            {
              method: "PUT",
              body: {
                valueRange: {
                  range: `${firstSheetId}!A1`,
                  values: Array.isArray(rawValues[0]) ? rawValues : [rawValues],
                },
              },
            },
          );
        }
      } catch {
        // 初始数据写入失败不阻断创建结果
      }
    }

    // 自动为当前飞书会话用户授权
    const targetOpenId = String(args?.grant_open_id || context.defaultOpenId || "").trim();
    let permNote = "";
    if (targetOpenId && targetOpenId.startsWith("ou_")) {
      try {
        await api.request(
          `/open-apis/drive/v1/permissions/${encodeURIComponent(spreadsheetToken)}/members?type=sheet&need_notification=false`,
          {
            method: "POST",
            body: {
              member_type: "openid",
              member_id: targetOpenId,
              perm: "full_access",
            },
          },
        );
        permNote = `，已自动授予飞书用户（${targetOpenId}）可管理权限`;
      } catch {
        // 忽略授权失败
      }
    }

    return {
      text: `已创建飞书电子表格「${title}」\n- spreadsheet_token: ${spreadsheetToken}\n- 链接: ${url}${permNote}`,
    };
  }

  // 其余操作需指定已有表格
  const rawInput = String(args?.url_or_token || args?.spreadsheet_token || args?.url || args?.token || "").trim();
  const ref = parseFeishuDocReference(rawInput, "sheet");
  if (!ref) {
    return { error: "请提供目标飞书电子表格链接或 spreadsheet_token（url_or_token）。" };
  }
  const resolved = await api.resolveSheetToken(ref);
  const spreadsheetToken = resolved.spreadsheetToken;

  // 2. 新建子工作表
  if (action === "add_sheet") {
    const sheetTitle = String(args?.sheet_title || args?.title || args?.name || "新工作表").trim();
    const res = await api.request(
      `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets_batch_update`,
      {
        method: "POST",
        body: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetTitle,
                },
              },
            },
          ],
        },
      },
    );
    const addedSheetId = res?.replies?.[0]?.addSheet?.properties?.sheetId || "";
    return {
      text: `已在电子表格（${spreadsheetToken}）中新增工作表「${sheetTitle}」${addedSheetId ? `（sheet_id=${addedSheetId}）` : ""}。`,
    };
  }

  // 3. 追加或更新单元格数据
  const rawValues = parseJsonOrObject(args?.values);
  const values = Array.isArray(rawValues)
    ? (Array.isArray(rawValues[0]) ? rawValues : [rawValues])
    : [];
  if (!values.length) {
    return { error: `${action} 操作需要提供二维数据数组 values，例如 [["张三", 28, "研发"], ["李四", 32, "产品"]]。` };
  }

  // 确定工作表与目标范围
  let targetSheetId = String(args?.sheet_id || resolved.sheetId || "").trim();
  let range = String(args?.range || "").trim();
  if (!targetSheetId && !range) {
    const sheetsData = await api.request(`/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query`);
    targetSheetId = String(sheetsData?.sheets?.[0]?.sheet_id || "").trim();
    if (!targetSheetId) {
      return { error: `电子表格（${spreadsheetToken}）中未找到任何工作表。` };
    }
  }

  const effectiveRange = range
    ? (range.includes("!") ? range : `${targetSheetId || ""}${targetSheetId ? "!" : ""}${range}`)
    : targetSheetId;

  if (action === "append") {
    const res = await api.request(
      `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values_append`,
      {
        method: "POST",
        body: {
          valueRange: {
            range: effectiveRange,
            values,
          },
        },
      },
    );
    const updatedRows = res?.updates?.updatedRows ?? values.length;
    return {
      text: `已向电子表格（${spreadsheetToken}）的工作表（${effectiveRange}）末尾追加 ${updatedRows} 行数据。`,
    };
  }

  if (action === "update") {
    const res = await api.request(
      `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values`,
      {
        method: "PUT",
        body: {
          valueRange: {
            range: effectiveRange,
            values,
          },
        },
      },
    );
    const updatedCells = res?.updates?.updatedCells ?? (values.length * (values[0]?.length || 1));
    return {
      text: `已更新电子表格（${spreadsheetToken}）中范围（${effectiveRange}）的数据（共更新 ${updatedCells} 个单元格）。`,
    };
  }

  return {
    error: `不支持的电子表格操作 action="${action}"，可选值为：create、append、update、add_sheet。`,
  };
}

// ---- 工具定义与分发入口 ----

const stringArg = (description: string) => ({ type: "string", description });

export function feishuDocToolDefinitions() {
  const tool = (name: string, description: string, properties: Record<string, any>, required: string[] = []) => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  });
  return [
    tool(
      "feishu_read_doc",
      "读取飞书云文档（Docx）或飞书知识库节点（Wiki）的标题与正文内容。支持直接传入飞书文档/知识库 URL（如 https://xxx.feishu.cn/docx/... 或 /wiki/...）或文档 token。",
      {
        url_or_token: stringArg("飞书云文档/知识库链接 URL，或文档 token"),
        doc_type: stringArg("可选：文档类型（docx 或 wiki），传入完整 URL 时会自动识别"),
      },
      ["url_or_token"],
    ),
    tool(
      "feishu_search_docs",
      "在飞书云空间（Drive）与知识库（Wiki）中搜索或列出当前飞书应用可访问的云文档，返回文档标题、类型、token 和访问链接。",
      {
        query: stringArg("可选：搜索关键词；留空则列出最近可见的云文档与知识库节点"),
        limit: stringArg("可选：最多返回条数，默认 15，最大 50"),
      },
    ),
    tool(
      "feishu_create_doc",
      "创建一篇新的飞书云文档（Docx），支持直接传入 Markdown 内容写入文档（支持标题、粗体、行内代码、超链接、列表、待办、代码块、引用和分割线），并返回飞书云文档链接。",
      {
        title: stringArg("新飞书云文档的标题"),
        markdown: stringArg("可选：要写入文档的 Markdown 正文内容"),
        folder_token: stringArg("可选：目标云空间文件夹 token，留空则创建在应用根目录"),
        grant_open_id: stringArg("可选：自动授予可管理权限的飞书用户 open_id（在飞书聊天中会自动使用当前提问用户的 open_id）"),
      },
      ["title"],
    ),
    tool(
      "feishu_write_doc",
      "向已有的飞书云文档（Docx 或 Wiki 节点文档）追加（append）或覆写（replace）Markdown 内容。",
      {
        url_or_token: stringArg("目标飞书云文档链接 URL 或 document_id"),
        markdown: stringArg("要写入的 Markdown 正文内容"),
        mode: stringArg("写入模式：append（在末尾追加，默认）或 replace（清空原内容后覆写）"),
      },
      ["url_or_token", "markdown"],
    ),
    tool(
      "feishu_grant_doc_permission",
      "为飞书云文档添加协作者权限（如授予用户可查看/可编辑/可管理权限）或设置链接分享范围。",
      {
        url_or_token: stringArg("目标飞书云文档链接 URL 或 token"),
        member_id: stringArg("可选：协作者标识（如飞书 open_id 'ou_xxx' 或邮箱；飞书会话中留空则默认授权给当前对话用户）"),
        member_type: stringArg("可选：协作者类型，openid（默认）、email、userid 或 openchat"),
        perm: stringArg("可选：权限级别，view（可阅读）、edit（可编辑，默认）或 full_access（可管理）"),
        link_share_entity: stringArg("可选：链接分享范围，tenant_readable（组织内可读）、tenant_editable（组织内可编辑）、anyone_readable、anyone_editable 或 closed"),
      },
      ["url_or_token"],
    ),
    tool(
      "feishu_bitable_inspect",
      "读取飞书多维表格（Bitable）的应用信息、全部数据表（table_id）列表以及当前数据表的字段定义（字段名、类型、单选/多选可选项）。支持直接传入多维表格链接（如 https://xxx.feishu.cn/base/bascn... 或知识库内嵌多维表格 /wiki/...）或 app_token。读写记录前建议先调用本工具了解表结构。",
      {
        url_or_token: stringArg("飞书多维表格链接 URL（支持 /base/... 或 /wiki/...）或 app_token"),
        table_id: stringArg("可选：指定查看字段结构的数据表 table_id（如 tblxxx；若链接中已含 ?table=tblxxx 或未指定则自动识别）"),
      },
      ["url_or_token"],
    ),
    tool(
      "feishu_bitable_read_records",
      "查询或筛选飞书多维表格（Bitable）数据表中的记录，自动将单元格内容转换为易读的 JSON 格式返回。",
      {
        url_or_token: stringArg("飞书多维表格链接 URL 或 app_token"),
        table_id: stringArg("可选：数据表 table_id（若 URL 含 ?table=tblxxx 或多维表格只有一张表则自动识别）"),
        view_id: stringArg("可选：视图 view_id"),
        filter: stringArg("可选：飞书标准筛选对象 JSON 字符串（例如 {\"conjunction\":\"and\",\"conditions\":[{\"field_name\":\"状态\",\"operator\":\"is\",\"value\":[\"进行中\"]}]}）"),
        sort: stringArg("可选：排序规则 JSON 数组字符串（例如 [{\"field_name\":\"创建时间\",\"desc\":true}]）"),
        field_names: stringArg("可选：仅返回指定列名 JSON 数组字符串（例如 [\"标题\",\"负责人\"]）"),
        page_size: stringArg("可选：每页返回条数，默认 50，最大 200"),
        page_token: stringArg("可选：分页游标 token"),
      },
      ["url_or_token"],
    ),
    tool(
      "feishu_bitable_write_records",
      "创建飞书多维表格、新建数据表，或对多维表格数据表执行批量新增记录（add_records）、批量更新记录（update_records）、批量删除记录（delete_records）。",
      {
        action: stringArg("操作类型：create_app（新建多维表格）、create_table（新建数据表）、add_records（新增记录，默认）、update_records（修改记录）、delete_records（删除记录）"),
        url_or_token: stringArg("目标飞书多维表格链接 URL 或 app_token（action 为 create_app 时无需提供）"),
        table_id: stringArg("可选：目标数据表 table_id（若 URL 中包含 ?table=tblxxx 或只有一张表会自动选择）"),
        name: stringArg("可选：当 action=create_app 时为多维表格名称；当 action=create_table 时为新数据表名称"),
        fields: stringArg("可选：当 action=create_table 时传入初始字段定义 JSON 数组，如 [{\"field_name\":\"任务名称\",\"type\":1},{\"field_name\":\"优先级\",\"type\":3}]"),
        records: stringArg("当 action=add_records 时传入记录数组 JSON（如 [{\"任务名称\":\"任务A\",\"优先级\":\"高\"}]）；当 action=update_records 时传入含 record_id 的数组 JSON（如 [{\"record_id\":\"recxxx\",\"fields\":{\"优先级\":\"低\"}}]）"),
        record_ids: stringArg("当 action=delete_records 时传入要删除的 record_id 数组 JSON（如 [\"recxxx\",\"recyyy\"]）"),
        folder_token: stringArg("可选：当 action=create_app 时指定云空间目录 token"),
      },
      ["action"],
    ),
    tool(
      "feishu_sheet_read",
      "读取飞书电子表格（Sheet）的信息、工作表（sheet_id）列表与单元格数据，自动格式化为 Markdown 表格输出。支持直接传入电子表格链接（如 https://xxx.feishu.cn/sheets/shtcn... 或知识库内嵌表格 /wiki/...）或 spreadsheet_token。",
      {
        url_or_token: stringArg("飞书电子表格链接 URL 或 spreadsheet_token"),
        sheet_id: stringArg("可选：指定读取的子工作表 sheet_id（若链接中已含 ?sheet=xxx 或未指定则自动选择）"),
        range: stringArg("可选：读取单元格范围（例如 'A1:H30' 或 '工作表1!A1:D10'；留空则读取整张工作表）"),
      },
      ["url_or_token"],
    ),
    tool(
      "feishu_sheet_write",
      "创建飞书电子表格（create）、在工作表末尾追加行数据（append）、更新指定区域单元格数据（update）或新增工作表（add_sheet）。",
      {
        action: stringArg("操作类型：create（新建电子表格）、append（向工作表末尾追加行数据，默认）、update（更新指定范围单元格）、add_sheet（新建子工作表）"),
        url_or_token: stringArg("目标飞书电子表格链接 URL 或 spreadsheet_token（action=create 时无需提供）"),
        sheet_id: stringArg("可选：目标工作表 sheet_id（若未提供且 action!=create，默认使用第一个工作表）"),
        range: stringArg("可选：当 action=update 时指定写入单元格起始或范围（例如 'A1' 或 'A1:C5'）；当 action=append 时可选指定追加区域"),
        title: stringArg("可选：当 action=create 时为表格标题；当 action=add_sheet 时为新工作表名称"),
        values: stringArg("要写入的二维数据数组 JSON 字符串，例如 '[[\"姓名\",\"年龄\"],[\"张三\",28]]'"),
        folder_token: stringArg("可选：当 action=create 时指定云空间目录 token"),
      },
      ["action"],
    ),
  ];
}

export async function handleFeishuDocTool(
  name: string,
  args: any,
  {
    appId,
    appSecret,
    baseUrl = FEISHU_OPEN_BASE,
    fetchImpl = fetch,
    defaultOpenId = "",
  }: {
    appId: string;
    appSecret: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    defaultOpenId?: string;
  },
) {
  if (!FEISHU_DOC_TOOL_NAMES.has(String(name))) {
    return { ok: false, result: `未知的飞书云文档工具：${name}` };
  }
  const cleanAppId = String(appId || "").trim();
  const cleanAppSecret = String(appSecret || "").trim();
  if (!cleanAppId || !cleanAppSecret) {
    return {
      ok: false,
      result: "尚未配置飞书应用凭据（App ID / App Secret）。请先在「设置 → 消息渠道 → 飞书」中保存 App ID 和 App Secret。",
    };
  }
  const api = createDocApiHelper({
    appId: cleanAppId,
    appSecret: cleanAppSecret,
    baseUrl,
    fetchImpl,
  });
  const payload = args && typeof args === "object" ? args : {};
  try {
    let outcome: { text?: string; error?: string };
    if (name === "feishu_read_doc") {
      outcome = await readFeishuDoc(api, payload);
    } else if (name === "feishu_search_docs") {
      outcome = await searchFeishuDocs(api, payload);
    } else if (name === "feishu_create_doc") {
      outcome = await createFeishuDoc(api, payload, { defaultOpenId });
    } else if (name === "feishu_write_doc") {
      outcome = await writeFeishuDoc(api, payload);
    } else if (name === "feishu_grant_doc_permission") {
      outcome = await grantFeishuDocPermission(api, payload, { defaultOpenId });
    } else if (name === "feishu_bitable_inspect") {
      outcome = await inspectFeishuBitable(api, payload);
    } else if (name === "feishu_bitable_read_records") {
      outcome = await readFeishuBitableRecords(api, payload);
    } else if (name === "feishu_bitable_write_records") {
      outcome = await writeFeishuBitableRecords(api, payload, { defaultOpenId });
    } else if (name === "feishu_sheet_read") {
      outcome = await readFeishuSheet(api, payload);
    } else {
      outcome = await writeFeishuSheet(api, payload, { defaultOpenId });
    }
    return outcome.error
      ? { ok: false, result: outcome.error }
      : { ok: true, result: outcome.text || "执行成功" };
  } catch (error: any) {
    return {
      ok: false,
      result: `飞书云文档操作失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
