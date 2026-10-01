// 长期记忆服务 ctx.memory：把 main.mts 里的记忆队列、内置认知覆盖表、
// LLM Wiki（memory-wiki）读写与整合收编为 cordis 服务。
//
// 结构约定（沿用既有设计）：
//   - memory.json 只是「待整合队列」（raw sources），wiki 是唯一知识库；
//   - 内置模型认知不落盘，用户编辑写 memory-overrides.json，读取时套用；
//   - 会话记忆（scope: "session"）不参与 wiki 整合，按 sessionId 单独注入。
//
// 依赖：数据目录由宿主注入；整合需要模型配置，取 ctx.settings（cordis 服务）。
// 本文件不依赖 electron，可 node --test 直测（不触发整合时不需要模型）。
import { Service } from "cordis";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { requestModel } from "../../agent.mts";
import {
  applyBuiltinMemoryOverrides,
  buildMemoryRecord,
  isBuiltinMemoryId,
  normalizeMemoryItem,
  normalizeMemories,
} from "../../memory.mts";
import {
  applyConsolidation,
  buildConsolidationMessages,
  ensureWiki,
  integrateItems,
  listWikiPages,
  parseConsolidationResult,
  readWikiPages,
  removeWikiMemory,
  serializeMemoryRow,
  updateWikiMemory,
} from "../../memory-wiki.mts";
import { readJson, writeJson } from "../io.mts";

declare module "cordis" {
  interface Context {
    memory: MemoryService;
  }
}

export class MemoryService extends Service {
  dir;
  wikiReadyPromise = null;
  consolidationTimer = null;
  consolidationRunning = false;

  constructor(ctx, config = {} as any) {
    super(ctx, "memory");
    this.dir = config.dir;
    // wiki 整合的延后定时器属宿主资源：dispose 时清掉，避免退出后仍在跑
    ctx.effect(() => () => {
      if (this.consolidationTimer) clearTimeout(this.consolidationTimer);
      this.consolidationTimer = null;
    });
  }

  file(name) {
    return path.join(this.dir, name);
  }

  wikiRoot() {
    return path.join(this.dir, "memory-wiki");
  }

  async readSaved() {
    const items = await readJson(this.file("memory.json"), []);
    return normalizeMemories(items);
  }

  // 内置记忆的用户编辑覆盖表：内置条目不落 memory.json，编辑结果存这里，读取时套用
  async readOverrides() {
    const stored = await readJson(this.file("memory-overrides.json"), {});
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  }

  // 首次运行时把旧的扁平记忆列表一次性迁移成 wiki 页面，并备份原 memory.json；
  // 之后 memory.json 只作为待整合队列（raw sources），wiki 是唯一知识库。
  wikiReady() {
    this.wikiReadyPromise ??= (async () => {
      const root = this.wikiRoot();
      const items = await this.readSaved();
      // 会话记忆不迁移进 wiki，留在队列文件里按会话注入
      const migratable = items.filter((item) => item.scope !== "session");
      await ensureWiki(root, { items: migratable });
      if (migratable.length) {
        const backup = this.file("memory.json.pre-wiki-backup");
        if (!existsSync(backup)) await fs.copyFile(this.file("memory.json"), backup).catch(() => { });
        await writeJson(this.file("memory.json"), items.filter((item) => item.scope === "session"));
      }
    })();
    return this.wikiReadyPromise;
  }

  // 读取绑定某个任务会话的记忆，聚成一个伪页面；没有会话记忆时返回 null
  async sessionPage(sessionId) {
    const target = String(sessionId || "").trim();
    if (!target) return null;
    const items = (await this.readSaved()).filter((item) => item.scope === "session" && item.sessionId === target);
    if (!items.length) return null;
    const rows = items.map((item) => ({ id: item.id, kind: item.kind, category: item.category, name: item.name, content: item.content }));
    return {
      relPath: "pages/session.md",
      title: "本会话记忆",
      scope: "global",
      workspacePath: "",
      rows,
      content: `# 本会话记忆\n\n${rows.map(serializeMemoryRow).join("\n")}`,
    };
  }

  // 注入给模型的记忆页：wiki 页面 + 内置认知伪页面 + 会话记忆伪页面
  async pages(sessionId = "") {
    await this.wikiReady();
    const pages = await readWikiPages(this.wikiRoot());
    // 内置模型认知以只读伪页面参与选取：不落盘、不会出现在整合输入里，模型无法改写；
    // 用户的手动编辑通过覆盖表生效。
    const builtinRows = applyBuiltinMemoryOverrides(await this.readOverrides())
      .map((item: any) => ({ id: item.id, kind: item.kind, category: item.category, name: item.name || "", content: item.content }));
    const builtinPage = {
      relPath: "pages/builtin.md",
      title: "内置模型认知",
      scope: "global",
      workspacePath: "",
      rows: builtinRows,
      content: `# 内置模型认知\n\n${builtinRows.map((row) => `- ${row.content} <!--mem:${row.id}|${row.kind}|${row.category}-->`).join("\n")}`,
    };
    // 会话记忆：绑定当前任务会话的临时约定，以只读伪页面注入（不进全局 wiki）
    const sessionPage = await this.sessionPage(sessionId);
    return [...pages, builtinPage, ...(sessionPage ? [sessionPage] : [])];
  }

  scheduleConsolidation(delayMs = 3000) {
    if (this.consolidationTimer) clearTimeout(this.consolidationTimer);
    this.consolidationTimer = setTimeout(() => {
      this.consolidationTimer = null;
      void this.consolidate().catch((error) => console.log(`[memory-wiki] 整合失败：${error?.message || error}`));
    }, delayMs);
  }

  // 任务结束后批量把 memory.json 队列整合进 wiki：优先让当前模型做一次
  // 「合并 / 去重 / 修订矛盾」的页面维护；模型不可用或输出无效时回退规则式追加。
  async consolidate({ lint = false } = {} as any) {
    if (this.consolidationRunning) {
      this.scheduleConsolidation(8000);
      return { ok: false, error: "整合进行中，稍后自动重试" };
    }
    this.consolidationRunning = true;
    try {
      await this.wikiReady();
      const root = this.wikiRoot();
      const all = await this.readSaved();
      // 会话记忆只绑定单个任务会话，不参与 wiki 整合；清队时原样保留
      const sessionItems = all.filter((item) => item.scope === "session");
      const pending = all.filter((item) => item.scope !== "session");
      if (!lint && !pending.length) return { ok: true };
      const pages = await readWikiPages(root);
      const settings = await this.ctx.settings.read();
      let applied = 0;
      if (settings.endpoint && settings.model && settings.apiKey) {
        try {
          const message = await requestModel({ settings, messages: buildConsolidationMessages({ pages, pending, lint }), tools: false } as any);
          applied = await applyConsolidation(root, parseConsolidationResult(message?.content || ""));
        } catch (error: any) {
          console.log(`[memory-wiki] LLM 整合失败，回退规则式：${error?.message || error}`);
        }
      }
      if (applied) {
        // 模型漏掉的新记忆保留在队列里等下一轮，其余清空；会话记忆始终保留。
        const knownIds = new Set((await readWikiPages(root)).flatMap((page) => page.rows.map((row) => row.id)));
        const missed = pending.filter((item) => !knownIds.has(String(item?.id || "")));
        await writeJson(this.file("memory.json"), [...sessionItems, ...missed]);
        return { ok: true, applied };
      }
      if (pending.length) {
        await integrateItems(root, pending, { logTitle: "规则式整合" });
        await writeJson(this.file("memory.json"), sessionItems);
        return { ok: true, applied: 0 };
      }
      return { ok: false, error: lint ? "整理未产生有效结果" : "整合未产生有效结果" };
    } finally {
      this.consolidationRunning = false;
    }
  }

  async append(item, workspacePath, sessionId = "") {
    const items = await this.readSaved();
    const record = buildMemoryRecord(item, {
      id: crypto.randomUUID(),
      workspacePath,
      sessionId,
    });
    if (!record?.content) return null;
    const duplicate = items.find((existing) => (
      existing.content === record.content
      && existing.category === record.category
      && existing.kind === record.kind
      && existing.scope === record.scope
      && existing.workspacePath === record.workspacePath
      && existing.sessionId === record.sessionId
    ));
    if (duplicate) return duplicate;
    items.push(record);
    await writeJson(this.file("memory.json"), items);
    // 新记忆已入队，任务收尾后由 wiki 整合流程合并进页面。
    this.scheduleConsolidation();
    return record;
  }

  fromAgentResult(result) {
    if (Array.isArray(result?.memories)) return result.memories;
    return result?.memory ? [result.memory] : [];
  }

  // 记忆面板数据：空页面不展示；会话记忆与内置认知各成一张卡
  async list() {
    await this.wikiReady();
    // 空的核心页面不展示，避免面板出现一堆零条记忆的卡片
    const pages = (await listWikiPages(this.wikiRoot())).filter((page) => page.rows.length);
    // 会话记忆单独成卡展示（带所属会话标识），与全局 wiki 页面并列
    const sessionItems = (await this.readSaved()).filter((item) => item.scope === "session");
    if (sessionItems.length) {
      const rows = sessionItems.map((item) => ({ id: item.id, kind: item.kind, category: item.category, name: item.name, content: item.content, sessionId: item.sessionId }));
      pages.push({
        relPath: "pages/session.md",
        title: "会话记忆",
        scope: "global",
        workspacePath: "",
        rows,
        content: `# 会话记忆\n\n${rows.map(serializeMemoryRow).join("\n")}`,
        updated: "",
      });
    }
    // 内置模型认知也可在面板查看与编辑（编辑走覆盖表，不改发布内容）
    const builtinRows = applyBuiltinMemoryOverrides(await this.readOverrides())
      .map((item: any) => ({ id: item.id, kind: item.kind, category: item.category, name: item.name || "", content: item.content, builtIn: true }));
    pages.push({
      relPath: "pages/builtin.md",
      title: "内置模型认知",
      scope: "global",
      workspacePath: "",
      rows: builtinRows,
      content: "",
      updated: "",
    });
    return pages;
  }

  // 编辑一条记忆：内置条目写覆盖表；待整合队列（含会话记忆）改 memory.json；已整合的改 wiki 页面。
  async update(payload) {
    const id = String(payload?.id || "").trim();
    const content = String(payload?.content || "").trim();
    if (!id) return { ok: false, error: "缺少记忆 id" };
    if (!content) return { ok: false, error: "记忆内容不能为空" };
    const updates = {
      content,
      category: String(payload?.category || "").trim(),
      name: String(payload?.name || "").trim(),
      kind: String(payload?.kind || "").trim(),
    };
    if (isBuiltinMemoryId(id)) {
      const overrides = await this.readOverrides();
      overrides[id] = updates;
      await writeJson(this.file("memory-overrides.json"), overrides);
      return { ok: true };
    }
    await this.wikiReady();
    const items = await this.readSaved();
    const queued = items.find((item) => String(item.id) === id);
    if (queued) {
      const next = normalizeMemoryItem({
        ...queued,
        content: updates.content,
        category: updates.category || queued.category,
        name: updates.name,
        kind: updates.kind || queued.kind,
      });
      if (!next) return { ok: false, error: "记忆内容不合法" };
      await writeJson(this.file("memory.json"), items.map((item) => (String(item.id) === id ? next : item)));
      return { ok: true };
    }
    const updated = await updateWikiMemory(this.wikiRoot(), id, updates);
    return updated ? { ok: true } : { ok: false, error: "找不到这条记忆" };
  }

  async remove(id) {
    if (isBuiltinMemoryId(id)) return { ok: false, error: "内置记忆不能删除" };
    await this.wikiReady();
    // 队列和 wiki 页面各删一份：尚未整合的条目在队列里，已整合的在页面行上。
    const items = await this.readSaved();
    await writeJson(this.file("memory.json"), items.filter((item) => String(item.id) !== String(id)));
    const removed = await removeWikiMemory(this.wikiRoot(), String(id));
    return { ok: true, removed };
  }

  lint() {
    return this.consolidate({ lint: true });
  }
}
