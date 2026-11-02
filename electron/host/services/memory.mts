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
import { Service } from "@deepseek-ai/cordis";
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
  deriveIndexContent,
  pageRelPathForItem,
} from "../../memory-wiki.mts";
import { exactDuplicateOrganization, pageRecords, validateOrganization } from '../../memory-organization.mts';
import { readJson, writeJson } from "../io.mts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    memory: MemoryService;
  }
}

export class MemoryService extends Service {
  dir;
  wikiReadyPromise = null;
  consolidationTimer = null;
  consolidationRunning = false;
  mutationChain = Promise.resolve();

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

  mutate<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.mutationChain.catch(() => {}).then(operation);
    this.mutationChain = result.then(() => {}, () => {});
    return result;
  }

  async provenance() {
    const data = await readJson(this.file('memory-provenance.json'), {});
    return { aliases: data.aliases || {}, sources: data.sources || {} };
  }

  async organizationState() {
    return { pages: (await readWikiPages(this.wikiRoot())).map(page => ({ relPath: page.relPath, content: page.content })),
      pending: (await this.readSaved()).filter(item => item.scope !== 'session'), provenance: await this.provenance() };
  }

  stateFingerprint(state) {
    return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
  }

  async restoreOrganizationState(state) {
    const root = this.wikiRoot();
    for (const page of await readWikiPages(root)) await fs.rm(path.join(root, page.relPath), { force: true });
    for (const page of state.pages) {
      if (!/^pages\/(?:projects\/)?[\w\u3400-\u9fff][\w\u3400-\u9fff.-]*\.md$/.test(page.relPath)) throw new Error('恢复记录包含无效页面');
      const file = path.join(root, page.relPath);
      await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, page.content, 'utf8');
    }
    const sessions = (await this.readSaved()).filter(item => item.scope === 'session');
    await writeJson(this.file('memory.json'), [...sessions, ...state.pending]);
    await writeJson(this.file('memory-provenance.json'), state.provenance);
    await fs.writeFile(path.join(root, 'index.md'), deriveIndexContent(await readWikiPages(root)), 'utf8');
  }

  async organizationHistory() {
    return this.mutate(() => this.organizationHistoryUnlocked());
  }

  async organizationHistoryUnlocked() {
    await this.wikiReady();
    const history = await readJson(this.file('memory-organization-history.json'), []);
    const fingerprint = this.stateFingerprint(await this.organizationState());
    return { rows: history.map((item, index) => ({ id: item.id, createdAt: item.createdAt, merged: item.merged,
      merges: item.merges, conflicts: item.conflicts, message: item.message, undone: !!item.undone,
      canUndo: index === 0 && !item.undone && item.afterFingerprint === fingerprint })) };
  }

  async undoOrganization(id) {
    return this.mutate(async () => {
      await this.wikiReady();
      const history = await readJson(this.file('memory-organization-history.json'), []);
      const latest = history[0];
      if (!latest || latest.id !== id || latest.undone) return { ok: false, error: '只能撤销最近一次整理' };
      if (latest.afterFingerprint !== this.stateFingerprint(await this.organizationState())) return { ok: false, error: '整理后记忆已有新增或修改，为保留这些内容，无法直接撤销' };
      const current = await this.organizationState(), previousHistory = JSON.parse(JSON.stringify(history));
      await writeJson(this.file('memory-organization-journal.json'), { before: current, history: previousHistory });
      try {
        await this.restoreOrganizationState(latest.before);
        latest.undone = true;
        await writeJson(this.file('memory-organization-history.json'), history);
        await fs.appendFile(path.join(this.wikiRoot(), 'log.md'), `\n## [${new Date().toISOString()}] undo | 撤销整理 ${id}\n`);
        await fs.rm(this.file('memory-organization-journal.json'), { force: true });
        return { ok: true, message: '已恢复整理前的记忆和关联' };
      } catch (error) {
        await this.restoreOrganizationState(current);
        await writeJson(this.file('memory-organization-history.json'), previousHistory);
        await fs.rm(this.file('memory-organization-journal.json'), { force: true }); throw error;
      }
    });
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
      const journal = await readJson(this.file('memory-organization-journal.json'), null);
      if (journal?.before) {
        await this.restoreOrganizationState(journal.before);
        const history = await readJson(this.file('memory-organization-history.json'), []);
        await writeJson(this.file('memory-organization-history.json'), journal.history || history.filter(item => item.id !== journal.id));
        await fs.rm(this.file('memory-organization-journal.json'), { force: true });
      }
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
    try { return await this.mutate(async () => {
      await this.wikiReady();
      const root = this.wikiRoot();
      const all = await this.readSaved();
      // 会话记忆只绑定单个任务会话，不参与 wiki 整合；清队时原样保留
      const sessionItems = all.filter((item) => item.scope === "session");
      const pending = all.filter((item) => item.scope !== "session");
      if (!lint && !pending.length) return { ok: true };
      const before = await this.organizationState();
      const transactionId = crypto.randomUUID();
      const previousHistory = await readJson(this.file('memory-organization-history.json'), []);
      await writeJson(this.file('memory-organization-journal.json'), { id: transactionId, before, history: previousHistory });
      try {
        await integrateItems(root, pending, { logTitle: "规则式整合" });
        await writeJson(this.file("memory.json"), sessionItems);
        let pages = await readWikiPages(root);
        const originals = new Map(pageRecords(pages).map(row => [row.id, row]));
        const exact = validateOrganization(pages, exactDuplicateOrganization(pages));
        let applied = await applyConsolidation(root, exact), modelUsed = false, modelError = '';
        const merges = [...exact.merges]; let conflicts = [];
        pages = await readWikiPages(root);
        const settings = await this.ctx.settings.read();
        if (settings.endpoint && settings.model && pageRecords(pages).length > 1) {
          let result = null;
          try {
            const message = await requestModel({ settings, messages: buildConsolidationMessages({ pages, pending: [], lint }), tools: false, fetchImpl: fetch } as any);
            result = validateOrganization(pages, parseConsolidationResult(message?.content || ''));
          } catch (error: any) {
            modelError = 'AI 整理未完成，本次仅合并完全重复的内容。';
            console.log(`[memory-wiki] 保留原记忆：${error?.message || error}`);
          }
          if (result) {
            applied += await applyConsolidation(root, result);
            merges.push(...result.merges); conflicts = result.conflicts; modelUsed = true;
          }
        }
        const provenance = await this.provenance();
        for (const merge of merges) {
          const ids = [merge.targetId, ...merge.sourceIds], origins = new Map();
          for (const id of ids) for (const row of provenance.sources[id] || [originals.get(id)].filter(Boolean)) origins.set(row.id, row);
          provenance.sources[merge.targetId] = [...origins.values()];
          for (const id of merge.sourceIds) {
            provenance.aliases[id] = merge.targetId;
            for (const [from, to] of Object.entries(provenance.aliases)) if (to === id) provenance.aliases[from] = merge.targetId;
          }
        }
        await writeJson(this.file('memory-provenance.json'), provenance);
        const merged = merges.reduce((sum, merge) => sum + merge.sourceIds.length, 0);
        const message = `${merged ? `已合并 ${merged} 条重复记忆。` : '未发现可自动合并的重复记忆。'}${conflicts.length ? `有 ${conflicts.length} 组内容需要确认，已保留原文。` : ''}${modelError || (!modelUsed ? '相近表达的进一步整理需要可用的 AI 模型。' : '')}`;
        if (lint || merges.length) {
          const after = await this.organizationState();
          const history = await readJson(this.file('memory-organization-history.json'), []);
          const final = new Map(pageRecords(await readWikiPages(root)).map(row => [row.id, row]));
          const record = { id: transactionId, createdAt: new Date().toISOString(), before,
            afterFingerprint: this.stateFingerprint(after), merged, message,
            merges: merges.map(merge => ({ ...merge, before: [merge.targetId, ...merge.sourceIds].map(id => originals.get(id)).filter(Boolean), after: final.get(provenance.aliases[merge.targetId] || merge.targetId) })),
            conflicts: conflicts.map(item => ({ ...item, memories: item.ids.map(id => originals.get(id)) })) };
          await writeJson(this.file('memory-organization-history.json'), [record, ...history].slice(0, 10));
        }
        await fs.rm(this.file('memory-organization-journal.json'), { force: true });
        return { ok: true, applied, merged, conflicts: conflicts.length, message };
      } catch (error) {
        await this.restoreOrganizationState(before);
        await writeJson(this.file('memory-organization-history.json'), previousHistory);
        await fs.rm(this.file('memory-organization-journal.json'), { force: true });
        throw error;
      }
    });
    } finally {
      this.consolidationRunning = false;
    }
  }

  async append(item, workspacePath, sessionId = "") {
    return this.mutate(() => this.appendUnlocked(item, workspacePath, sessionId));
  }

  async appendUnlocked(item, workspacePath, sessionId = "") {
    await this.wikiReady();
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
    if (record.scope !== 'session') {
      const provenance = await this.provenance();
      provenance.sources[record.id] = [{ ...record, originSessionId: sessionId }];
      await writeJson(this.file('memory-provenance.json'), provenance);
    }
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
    const wikiPages = await listWikiPages(this.wikiRoot());
    const pages = wikiPages.filter((page) => page.rows.length);
    // 待整合的长期记忆已保存成功，应立即出现在面板中，不必等待后台整理。
    const queued = (await this.readSaved()).filter((item) => item.scope !== 'session');
    const knownIds = new Set(pages.flatMap(page => page.rows.map(row => row.id)));
    for (const item of queued) {
      if (knownIds.has(item.id)) continue;
      const relPath = pageRelPathForItem(item);
      let page = pages.find(page => page.relPath === relPath);
      if (!page) {
        page = wikiPages.find(candidate => candidate.relPath === relPath) ||
          { relPath, title: item.scope === 'workspace' ? `项目：${path.basename(item.workspacePath)}` : item.category,
            scope: item.scope, workspacePath: item.workspacePath || '', rows: [], content: '', updated: '' };
        pages.push(page);
      }
      page.rows.push({ id: item.id, name: item.name, kind: item.kind, category: item.category, content: item.content });
      knownIds.add(item.id);
    }
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

  // 直接读取记忆原始数据供知识库检索，避免复制后的陈旧内容；会话和项目范围仍受限。
  async knowledgeRows({ workspacePath = '', sessionId = '', allWorkspaces = false } = {} as any) {
    await this.wikiReady();
    const normalize = (value: any) => { const normalized = value ? path.normalize(String(value)) : '';
      return normalized === path.parse(normalized).root ? normalized : normalized.replace(/[\\/]+$/, ''); };
    const normalizedWorkspace = normalize(workspacePath);
    const allowed = (item: any) => item.scope === 'global'
      || (item.scope === 'workspace' && (allWorkspaces || (normalizedWorkspace && normalize(item.workspacePath) === normalizedWorkspace)))
      || (item.scope === 'session' && sessionId && item.sessionId === sessionId);
    const rows = new Map<string, any>();
    for (const page of await readWikiPages(this.wikiRoot())) {
      if (!allowed(page)) continue;
      for (const row of page.rows) rows.set(String(row.id), { ...row, scope: page.scope, workspacePath: page.workspacePath || '' });
    }
    // 尚在整合队列中的新记忆也要立即可查；同一条记忆以待整合版本为准。
    for (const item of await this.readSaved()) {
      if (allowed(item)) rows.set(String(item.id), { id: item.id, name: item.name, category: item.category,
        kind: item.kind, content: item.content, scope: item.scope, workspacePath: item.workspacePath || '' });
    }
    return [...rows.values()];
  }

  async knowledgeSnapshot(options = {} as any) {
    return this.mutate(async () => {
      await this.wikiReady();
      return { rows: await this.knowledgeRows(options), provenance: await this.provenance() };
    });
  }

  // 编辑一条记忆：内置条目写覆盖表；待整合队列（含会话记忆）改 memory.json；已整合的改 wiki 页面。
  async update(payload) {
    return this.mutate(() => this.updateUnlocked(payload));
  }

  async updateUnlocked(payload) {
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
    return this.mutate(() => this.removeUnlocked(id));
  }

  async removeUnlocked(id) {
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
