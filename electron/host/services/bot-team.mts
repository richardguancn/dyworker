import { Service } from '@deepseek-ai/cordis';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateWithDyworker } from '../dsh-runtime/model-adapter.mts';
import { hasConfiguredModel } from '../dsh-runtime/model-settings.mts';
import { SessionHistoryController } from '../dsh-runtime/vendor/session-history.mjs';

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
export async function createBotTeam({ dataDir, entryUrl, readSettings, generate = generateWithDyworker }: any) {
  const workspacePath = path.join(dataDir, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });
  const ctx: any = await createOfficialDshContext({ dataDir, workspacePath });
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
          tools: request.tools?.filter((tool: any) => !['request_secret', 'list_secrets'].includes(tool.name)),
          system: `${request.system || ''}\n\nDYWorker 团队面板当前不提供凭据卡片、独立浏览器或 GitHub 连接。不得声称已经显示这些界面或请求用户把密码和密钥贴进聊天。`,
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
      const body: any = await request.clone().json();
      if (body.endpoint === 'dyworker-history') {
        const id = String(body.payload?.sessionId || '');
        await authorize(id);
        const state = JSON.parse(await fs.readFile(path.join(dataDir, 'bot/state.json'), 'utf8'));
        const room = state.rooms?.[id];
        const bot: any = Object.values(state.bots || {}).find((entry: any) => entry.id === id || entry.sessionId === id);
        const ids = [...new Set<string>([...(bot?.segments || []).map((part: any) => part.sessionId), id])];
        const events = [];
        for (const partId of ids) {
          await authorize(partId);
          const live = ctx.agents.get(partId)?.session;
          const observation = live ? undefined : await ctx.sessionQuery.observeSession(partId);
          try { events.push(...(live ? live.snapshotEvents() : observation.events).map((event: any) => ({ ...event, sessionId: partId }))); }
          finally { observation?.[Symbol.dispose](); }
        }
        const members = Object.values(room?.sessions || {}) as string[];
        const failure = [id, ...members].map(key => errors.get(key)).filter(Boolean).join('；');
        return Response.json({ ok: true, value: { events, groupLog: room?.log,
          running: [id, ...members].some(key => ctx.agents.get(key)?.status === 'running'), error: failure } });
      }
      if (body.endpoint === 'dyworker-stop') {
        const id = String(body.payload?.sessionId || ''); await authorize(id);
        const state = JSON.parse(await fs.readFile(path.join(dataDir, 'bot/state.json'), 'utf8'));
        const members = Object.values(state.rooms?.[id]?.sessions || {}) as string[];
        for (const key of [id, ...members]) { await authorize(key); ctx.agents.get(key)?.cancel({ kind: 'user' }); }
        return Response.json({ ok: true, value: true });
      }
      return ctx.connection.registry.entries.get('POST /api/bot').route.fetch(request);
    },
    async dispose() {
      if (closed) return;
      closed = true; lifetime.abort(new Error('机器人团队已停用'));
      await saving;
      await Promise.allSettled([...opening.values()]);
      await Promise.allSettled([...handles.values()].map(handle => handle.dispose()));
      await ctx.fiber.dispose();
    },
  };
}

export class BotTeamService extends Service {
  constructor(ctx: any) { super(ctx, 'botTeam'); }
  mount(entryUrl: string) {
    // Opening the app only registers the plugin. First use starts its own data store.
    const host: any = this.ctx;
    let pending: Promise<any> | undefined, closed = false;
    return {
      dispatch: async (request: Request) => {
        if (closed) throw new Error('机器人团队已停用');
        const team = await (pending ??= createBotTeam({ dataDir: path.join(host.storage.hostDir, 'ds-bot'),
          entryUrl, readSettings: () => host.settings.read() }).catch(error => { pending = undefined; throw error; }));
        if (closed) { await team.dispose(); throw new Error('机器人团队已停用'); }
        return team.dispatch(request);
      },
      dispose: async () => { closed = true; await (await pending?.catch(() => undefined))?.dispose(); },
    };
  }
}
