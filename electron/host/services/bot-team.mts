import { Service } from '@deepseek-ai/cordis';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateWithDyworker } from '../dsh-runtime/model-adapter.mts';
import { hasConfiguredModel } from '../dsh-runtime/model-settings.mts';
import { SessionHistoryController } from '../dsh-runtime/vendor/session-history.mjs';
import { Workspace, loadProjectInstructions } from '../../agent.mts';
import { skillContextSummary } from '../../skills.mts';
import { selectWikiPages } from '../../memory-wiki.mts';
import { normalizeApprovalMode } from '../../settings.mts';
import { createBotApproval, createBotHarnessTools } from '../dsh-runtime/bot-harness.mts';

// 机器人自己不做第二套权限判断：审批模式沿用应用设置，人工确认落到「机器人团队」面板。
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
/** 机器人从桌面任务继承的工具里，界面相关的那部分不接：由会话检索、插件工具、MCP 工具补足。 */
const BOT_DELEGATED_TOOL_NAMES = new Set(['list_sessions', 'search_sessions', 'read_session']);
// 上游能力库依赖独立的技能服务、MCP 加载器及审批页面；本适配继续使用应用自己的工具入口。
const BOT_UNAVAILABLE_TOOL_NAMES = new Set(['request_secret', 'list_secrets', 'list_capabilities',
  'save_capability', 'delete_capability', 'attach_capability', 'detach_capability']);

// The application and the official runtime have separate Cordis tools/storage
// contracts. Resolve runtime exports without merging their declaration worlds.
const { LlmAdapter, createUserMessage } = await import('@deepseek-ai/dsh-llm' as string);
const { installModelSelection } = await import('@deepseek-ai/dsh-agent' as string);
const { createOfficialDshContext } = await import(new URL(`../dsh-runtime/official-context.${import.meta.url.endsWith('.mts') ? 'mts' : 'mjs'}`, import.meta.url).href);

declare module '@deepseek-ai/cordis' { interface Context { botTeam: BotTeamService; } }

export function botModelProfiles(settings: any) {
  const candidates = [...(hasConfiguredModel(settings) ? [{ ...settings, id: 'current', name: '当前模型' }] : []),
    ...(Array.isArray(settings?.profiles) ? settings.profiles.filter(hasConfiguredModel) : [])];
  const seen = new Set<string>();
  return candidates.flatMap(profile => {
    const identity = `${profile.endpoint}\n${profile.model}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ ...profile, provider: `dyworker-${createHash('sha256').update(identity).digest('hex').slice(0, 12)}` }];
  });
}

// The upstream host uses only public DSH services. Its independent Session store
// keeps root Bots alive together without borrowing ordinary task ownership.
export async function createBotTeam({ dataDir, entryUrl, readSettings, host, generate = generateWithDyworker }: any) {
  const workspacePath = path.join(dataDir, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });
  const ctx: any = await createOfficialDshContext({ dataDir, workspacePath });
  // 机器人自己的运行环境里没有应用服务（技能、记忆、审批审计、插件工具都在宿主上下文里）。
  const hostCtx: any = host || ctx;
  const handles = new Map<string, any>(), opening = new Map<string, Promise<any>>();
  const selections = new Map<string, any>();
  const errors = new Map<string, string>();
  const selectionFile = path.join(dataDir, 'model-selections.json');
  let savedSelections: any = {};
  try { savedSelections = JSON.parse(await fs.readFile(selectionFile, 'utf8')); } catch (error: any) { if (error.code !== 'ENOENT') { await ctx.fiber.dispose(); throw error; } }
  let saving = Promise.resolve();
  const saveSelections = () => saving = saving.then(async () => {
    const temporary = `${selectionFile}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(savedSelections), 'utf8'); await fs.rename(temporary, selectionFile);
  });
  const workspace = { id: 'ds-bot-team', path: workspacePath, name: '机器人团队' };
  let closed = false, profiles: any[] = [], adapterKey = '', registration: any;
  const lifetime = new AbortController();
  const history = new SessionHistoryController(ctx, observation => observation[Symbol.dispose]());
  const resolvers = hostCtx.agent?.resolvers || {};
  const botWorkspace = new Workspace(workspacePath, {});
  const approvals = new Map<string, { record: any; settle: (value: boolean) => void }>();
  const routers = new Map<string, any>();
  let appSettings: any = {};
  const refreshSettings = async () => {
    try { appSettings = (await readSettings()) || {}; } catch (error: any) { if (error?.code !== 'ENOENT') appSettings = {}; }
    return appSettings;
  };
  const approvalMode = () => normalizeApprovalMode(appSettings.approvalMode);
  // 需要人工确认的操作在「机器人团队」面板弹确认卡：同意即执行，超时或停用按拒绝处理。
  // signal 结束时（用户停止、机器人团队停用）确认卡随之消失，不留挂起项。
  const requestApproval = ({ id, kind, title, details, sessionId, signal }: any) => new Promise<boolean>(resolve => {
    const finish = (value: boolean) => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', aborted);
      approvals.delete(id);
      resolve(value);
    };
    const aborted = () => finish(false);
    const timer = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS);
    timer.unref?.();
    approvals.set(id, { record: { id, kind, title, details, sessionId, createdAt: Date.now() },
      settle: finish });
    if (signal?.aborted) aborted(); else signal?.addEventListener?.('abort', aborted, { once: true });
  });
  const approve = createBotApproval({ workspace: botWorkspace, workspacePath, getApprovalMode: approvalMode,
    hooks: async () => (typeof resolvers.readHooks === 'function' ? await resolvers.readHooks(workspacePath) : []),
    standingRules: async () => (typeof resolvers.readStandingRules === 'function' ? await resolvers.readStandingRules() : []),
    settings: () => appSettings, requestApproval,
    audit: (item: any) => hostCtx.audit?.record?.({ ...item, approvalMode: approvalMode() }) });
  const routeFor = (sessionId: string) => {
    let route = routers.get(sessionId);
    if (!route && typeof resolvers.createExtraToolRouter === 'function') {
      route = resolvers.createExtraToolRouter(appSettings, workspacePath, { sessionId, signal: lifetime.signal });
      routers.set(sessionId, route);
    }
    return route;
  };
  const inheritedContext = async (sessionId: string) => {
    const skills = hostCtx.skills?.read ? await hostCtx.skills.read(workspacePath).catch(() => []) : [];
    const pages = selectWikiPages(await (resolvers.readMemoryPages?.(sessionId) ?? []), { workspacePath, query: '', limit: 3 });
    const instructions = await loadProjectInstructions(workspacePath).catch(() => '');
    return [
      `机器人能力说明：你可以像 DYWorker 任务一样直接使用工作文件夹里的文件工具、运行命令、联网检索与办公文档导出，工作文件夹是 ${workspacePath}。`,
      '需要改动文件、执行命令、访问联网或写入长期记忆时，应用会按当前审批设置判断；需要你确认的操作会在「机器人团队」面板弹出确认卡，等用户点「允许」后再执行，被拒绝时不要绕过。',
      skills.length ? `可用工作模板（先用 load_skill 读取完整要求）：\n${skillContextSummary(skills)}` : '',
      instructions ? `工作文件里的 AGENTS.md 约定（与用户当前要求冲突时以当前要求为准）：\n${instructions}` : '',
      pages.length ? `相关长期记忆（仅作背景，与当前要求冲突时以当前要求为准）：\n${pages.map((page: any) => `## ${page.title}\n${String(page.content || '').slice(0, 1600)}`).join('\n\n')}` : '',
    ].filter(Boolean).join('\n\n');
  };
  async function inheritHarnessContext(id: string, agent: any) {
    const existing = agent?.session?.snapshotEvents?.() || [];
    if (existing.some((event: any) => event.type === 'user/message'
      && JSON.stringify(event.data?.content || '').includes('机器人能力说明'))) return;
    const text = await inheritedContext(id);
    agent.inject(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'runtime-context' } } as any));
    await ctx.sessions.flush(agent.session);
  }

  class Models extends LlmAdapter {
    providerInfo(provider: string) { return { id: provider, name: profiles.find(p => p.provider === provider)?.name || 'DYWorker' }; }
    async listModels(provider: string) {
      return profiles.filter(p => p.provider === provider).map(p => ({ provider, id: p.model, name: p.model, inputModalities: ['text'] as const }));
    }
    async prepareCall(provider: string, model: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const profile = profiles.find(p => p.provider === provider && p.model === model);
      if (!profile) throw new Error('此机器人选择的模型已不可用，请重新选择模型');
      const settings = { ...profile };
      return { model: { provider, id: model, name: model, inputModalities: ['text'] as const },
        // This panel has no secure credential card. Do not advertise a tool
        // that would claim it displayed a card the user cannot answer.
        stream: (request: any) => generate(settings, { ...request,
          tools: request.tools?.filter((tool: any) => !BOT_UNAVAILABLE_TOOL_NAMES.has(tool.name)),
          system: `${request.system || ''}\n\nDYWorker 团队面板当前不提供凭据卡片、独立浏览器面板或 GitHub 连接。不得声称已经显示这些界面或请求用户把密码和密钥贴进聊天。`
            + '上游独立能力库管理尚未接入；工作模板、插件与 MCP 工具使用 DYWorker 已配置的入口，不要声称创建了上游能力库或显示其设置页面。'
            + '你可以使用工作文件夹里的文件、命令与联网工具；需要用户确认的操作会在面板弹出确认卡，被拒绝时不要绕过，也不要重复尝试同一操作。',
          signal: AbortSignal.any([request.signal, lifetime.signal]) }, { attachments: ctx.attachments }) };
    }
    async *stream(request: any) {
      const call = await this.prepareCall(request.provider, request.model, request.signal);
      yield* call.stream(request);
    }
  }
  async function syncModels() {
    profiles = botModelProfiles(await readSettings());
    const key = profiles.map(p => `${p.provider}/${p.model}`).join('|');
    if (key !== adapterKey) {
      registration?.();
      registration = profiles.length ? ctx.llm.registerAdapter(profiles.map(p => p.provider), new Models()) : undefined;
      adapterKey = key;
    }
  }
  const defaultSelection = () => profiles[0] ? { provider: profiles[0].provider, model: profiles[0].model } : undefined;
  async function resolveAgent(id: string) {
    if (closed) throw new Error('机器人团队已停用');
    if (handles.has(id)) return handles.get(id).agent;
    if (opening.has(id)) return (await opening.get(id)).agent;
    const pending = (async () => {
      const stored = await ctx.sessionPersistence.stat(id);
      if (!stored || path.resolve(stored.header.cwd) !== path.resolve(workspacePath)) throw new Error('对话不属于机器人团队');
      const selection = { current: savedSelections[id] || defaultSelection(), assembled: undefined };
      const handle = await ctx.agents.resume({ resumeSessionId: id,
        agentOptions: selection.current || {}, setup: (scope: any) => { installModelSelection(scope, selection); } });
      handles.set(id, handle); selections.set(id, selection);
      await inheritHarnessContext(id, handle.agent).catch(() => {});
      return handle;
    })();
    opening.set(id, pending);
    try { return (await pending).agent; } finally { opening.delete(id); }
  }
  async function authorize(id: string) {
    const live = ctx.sessions.get(id);
    const header = live?.header || (await ctx.sessionPersistence.stat(id))?.header;
    if (!header || path.resolve(header.cwd) !== path.resolve(workspacePath)) throw new Error('对话不属于机器人团队');
  }
  /** 读一次上游机器人状态；文件还没生成时返回空对象，不抛错。 */
  const readBotState = async () => {
    try { return JSON.parse(await fs.readFile(path.join(dataDir, 'bot/state.json'), 'utf8')) || {}; }
    catch { return {}; }
  };
  try {
    ctx.provide('workspaceRegistry', {
      get: (id: string) => id === workspace.id ? workspace : undefined,
      resolveByPath: async (value: string) => path.resolve(value) === path.resolve(workspacePath) ? workspace : undefined,
      create: async (value: string) => {
        if (path.resolve(value) !== path.resolve(workspacePath)) throw new Error('机器人团队只能使用自己的工作文件夹');
        return workspace;
      },
      archiveSession: async (id: string) => {
        await authorize(id);
        await handles.get(id)?.dispose(); handles.delete(id); selections.delete(id);
      },
    });
    ctx.provide('agentDefaultModel', { currentSelection: defaultSelection, saveSelection: async () => {} });
    ctx.provide('sessionController', {
      create: async ({ workspaceId }: any) => {
        if (closed || workspaceId !== workspace.id) throw new Error('机器人团队工作文件夹不可用');
        const sessionId = randomUUID(), selection = { current: defaultSelection(), assembled: undefined };
        const handle = await ctx.agents.create({ sessionId, meta: { cwd: workspacePath },
          agentOptions: selection.current || {}, setup: (scope: any) => { installModelSelection(scope, selection); } });
        handles.set(sessionId, handle); selections.set(sessionId, selection);
        await inheritHarnessContext(sessionId, handle.agent).catch(() => {});
        return { sessionId };
      },
      resolveAgent: async (id: string) => ({ agent: await resolveAgent(id) }),
      selectModel: async ({ sessionId, provider, model }: any) => {
        if (!profiles.some(p => p.provider === provider && p.model === model)) throw new Error('模型不可用');
        await resolveAgent(sessionId);
        selections.get(sessionId).current = { provider, model };
        savedSelections[sessionId] = { provider, model }; await saveSelections();
        return { provider, model };
      },
      prompt: async ({ sessionId, content }: any, signal: AbortSignal) => {
        signal?.throwIfAborted();
        const agent = await resolveAgent(sessionId);
        const chosen = selections.get(sessionId)?.current;
        if (!profiles.some(p => p.provider === chosen?.provider && p.model === chosen?.model))
          throw new Error('请先为此机器人选择一个可用模型');
        errors.delete(sessionId);
        agent.followup(createUserMessage({ content, source: { kind: 'user' } }));
        await ctx.sessions.flush(agent.session);
        return { accepted: true };
      },
      page: async (request: any, signal = lifetime.signal) => {
        await authorize(request.address.sessionId ?? request.address.childSessionId);
        return history.page(request, signal);
      },
      projections: async ({ sessionId }: any) => {
        await authorize(sessionId);
        const session = ctx.sessions.get(sessionId);
        if (session) return ctx.sessionProjections.snapshot(session);
        const observation = await ctx.sessionQuery.observeSession(sessionId);
        try { return { asOfSeq: observation.events.at(-1)?.seq ?? -1, values: {} }; }
        finally { observation[Symbol.dispose](); }
      },
      list: async () => ({ items: (await ctx.sessionPersistence.list()).filter((item: any) => item.header.cwd === workspacePath)
        .map((item: any) => ({ sessionId: item.header.id })) }),
    });
    ctx.on('agent/error', ({ agent, error }: any) => errors.set(agent.id,
      error?.code === 'AUTH' ? '模型验证失败，请检查模型设置' : String(error?.message || '模型请求失败').slice(0, 500)));
    // 机器人继承桌面任务的能力：工具面、审批、工作文件夹约定都走应用同一批实现。
    await refreshSettings();
    const mcpTools = typeof resolvers.mcpExtraTools === 'function' ? await resolvers.mcpExtraTools(appSettings) : [];
    const appTools: any[] = (typeof resolvers.agentExtraTools === 'function' ? resolvers.agentExtraTools(mcpTools) : mcpTools) || [];
    const delegated = appTools.map((tool: any) => tool.function ?? tool)
      .filter((tool: any) => BOT_DELEGATED_TOOL_NAMES.has(tool?.name) || String(tool?.name || '').startsWith('plugin__')
        || String(tool?.name || '').startsWith('mcp__'));
    const harness = createBotHarnessTools({ ctx, hostCtx, workspacePath, workspace: botWorkspace, approve,
      readSettings: refreshSettings, extraDefinitions: delegated,
      routeExtra: async (name: string, args: any, exec: any) => {
        const route = routeFor(String(exec?.sessionId || ''));
        if (!route) throw new Error('机器人团队没有可用的应用工具入口');
        return route(name, args);
      } });
    for (const tool of harness.tools) ctx.tools.register({ name: tool.name, description: tool.description || tool.name,
      parameters: tool.parameters || { type: 'object', properties: {} },
      execute: async (args: any, exec: any) => ({ text: await harness.execute(tool.name, args, exec) }),
      output: { schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
        render: (_args: any, value: any) => [{ type: 'text', text: String(value?.text ?? '') }] } });
    await syncModels();
    await ctx.plugin(await import(entryUrl), { home: path.join(dataDir, 'bot'), workspace: workspacePath,
      mainName: '总管', mainRole: '团队协调', browser: false, updateCheck: false, github: false });
    await ctx.fiber.await();
  } catch (error) { lifetime.abort(); await ctx.fiber.dispose(); throw error; }

  return {
    ctx,
    async dispatch(request: Request) {
      if (closed) throw new Error('机器人团队已停用');
      await syncModels();
      await refreshSettings();
      const body: any = await request.clone().json();
      if (body.endpoint === 'dyworker-approvals') {
        // 面板按「对话」筛选：机器人的对话 id 是机器人编号，而确认卡记录的是实际运行的会话编号，
        // 两者用上游状态里的分段信息对齐，避免卡片挂到错误的对话上。
        const wanted = String(body.payload?.sessionId || '');
        const state: any = wanted ? await readBotState() : null;
        const bot: any = state ? Object.values(state.bots || {}).find((item: any) => item.id === wanted || item.sessionId === wanted) : null;
        const room: any = state ? state.rooms?.[wanted] : null;
        const ids = new Set<string>([wanted, String(bot?.sessionId || ''),
          ...((bot?.segments || []).map((part: any) => String(part.sessionId || ''))),
          ...Object.values(room?.sessions || {}).map((value: any) => String(value || ''))].filter(Boolean));
        const records = [...approvals.values()].map(entry => entry.record);
        return Response.json({ ok: true, value: { items: wanted ? records.filter(item => ids.has(String(item.sessionId || ''))) : records,
          total: records.length } });
      }
      if (body.endpoint === 'dyworker-approve') {
        const entry = approvals.get(String(body.payload?.id || ''));
        if (!entry) return Response.json({ ok: true, value: { resolved: false } });
        entry.settle(body.payload?.allow === true);
        return Response.json({ ok: true, value: { resolved: true } });
      }
      if (body.endpoint === 'dyworker-history') {
        const id = String(body.payload?.sessionId || '');
        await authorize(id);
        const state = await readBotState();
        const room = state.rooms?.[id];
        const bot: any = Object.values(state.bots || {}).find((entry: any) => entry.id === id || entry.sessionId === id);
        const currentId = String(bot?.sessionId || id);
        const ids = [...new Set<string>([...(bot?.segments || []).map((part: any) => part.sessionId), currentId])];
        const events = [];
        for (const partId of ids) {
          await authorize(partId);
          const live = ctx.agents.get(partId)?.session;
          const observation = live ? undefined : await ctx.sessionQuery.observeSession(partId);
          try { events.push(...(live ? live.snapshotEvents() : observation.events).map((event: any) => ({ ...event, sessionId: partId }))); }
          finally { observation?.[Symbol.dispose](); }
        }
        const members = Object.values(room?.sessions || {}) as string[];
        const failure = [currentId, ...members].map(key => errors.get(key)).filter(Boolean).join('；');
        return Response.json({ ok: true, value: { events, groupLog: room?.log,
          running: [currentId, ...members].some(key => ctx.agents.get(key)?.status === 'running'), error: failure } });
      }
      if (body.endpoint === 'dyworker-stop') {
        const id = String(body.payload?.sessionId || ''); await authorize(id);
        const state = JSON.parse(await fs.readFile(path.join(dataDir, 'bot/state.json'), 'utf8'));
        const bot: any = Object.values(state.bots || {}).find((entry: any) => entry.id === id || entry.sessionId === id);
        const currentId = String(bot?.sessionId || id);
        const members = Object.values(state.rooms?.[id]?.sessions || {}) as string[];
        for (const key of [currentId, ...members]) { await authorize(key); ctx.agents.get(key)?.cancel({ kind: 'user' }); }
        return Response.json({ ok: true, value: true });
      }
      return ctx.connection.registry.entries.get('POST /api/bot').route.fetch(request);
    },
    async dispose() {
      if (closed) return;
      closed = true; lifetime.abort(new Error('机器人团队已停用'));
      for (const entry of approvals.values()) entry.settle(false);
      await Promise.allSettled([...routers.values()].map(route => route.dispose?.()));
      routers.clear();
      await saving;
      await Promise.allSettled([...opening.values()]);
      await Promise.allSettled([...handles.values()].map(handle => handle.dispose()));
      await ctx.fiber.dispose();
    },
  };
}

export class BotTeamService extends Service {
  options: any;
  constructor(ctx: any, options: any = {}) { super(ctx, 'botTeam'); this.options = options; }
  mount(entryUrl: string, options: any = {}) {
    // Opening the app only registers the plugin. First use starts its own data store.
    const host: any = this.ctx;
    const settings = { ...(this.options || {}), ...(options || {}) };
    let pending: Promise<any> | undefined, closed = false;
    return {
      dispatch: async (request: Request) => {
        if (closed) throw new Error('机器人团队已停用');
        const team = await (pending ??= createBotTeam({ dataDir: path.join(host.storage.hostDir, 'ds-bot'),
          entryUrl, host, readSettings: () => host.settings.read(), ...settings })
          .catch(error => { pending = undefined; throw error; }));
        if (closed) { await team.dispose(); throw new Error('机器人团队已停用'); }
        return team.dispatch(request);
      },
      dispose: async () => { closed = true; await (await pending?.catch(() => undefined))?.dispose(); },
    };
  }
}
