// 客户端插件宿主：在渲染端起一个 cordis 容器，把插件声明的客户端服务提供出来。
//
// 关键事实（从真实 bundle 反推，不是猜的）：
//   - 插件 bundle 的 module.exports 就是一个 **cordis 插件**：{ name, inject, apply }
//   - 它 inject 的是**服务名**，不是包名：dsh-context 要 ["slots","locale"]，
//     dsh-better-sidebar 要 ["slots","sessions","connection","workspaces","locale"]
//   - 插槽 API：ctx.slots.inject(名字, () => ctx.slots.register(meta, 组件))
//     实测插槽名：sidebar.right.pane.tab（右侧面板标签）、conversation.view、
//     conversation.chat.turnTail、conversation.chat.assistant-actions、
//     conversation.input.overlay、settings.section
//   - 文案 API：ctx.locale.register(ns, {zh,en}) / register(ns, 语言, 词表) / bind(ns) → t
//
// 只声明**我们真的会渲染**的插槽：slots.inject 只在宿主提供该插槽时执行注册，
// 因此插件里那些我们还没接的位置会自动跳过，不会报错、也不会出现"注册了但没人渲染"。

import { Context, Service } from "@deepseek-ai/cordis";
import { SessionViewRuntime } from "./sessionViewRuntime.ts";
import { DshSettingsBridge } from './dshSettingsBridge.ts';
import { awaitInput, consumeInputToken, replaceInputSpan, type InputClaim, type InputSource, type InputSpan, type RegisteredInputCandidate } from './inputTriggers.ts';
import { InputTriggerController } from './vendor/dsh-input-controller/index.js';
import { DshDraftEditor } from './dshDraftEditor.ts';
import type { ReferenceInsert } from './vendor/dsh-draft-editor/index.js';
import { BrowserFileUpload } from './fileUpload.ts';
import { SessionInputShell } from './vendor/dsh-draft-editor/index.js';
import { OwnedConversation, type ConversationSubmission } from './conversation.ts';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { UiConversation, MutableSessionEventSource } from './vendor/dsh-conversation-assembly/index.js';
import { createSessionHistoryFace, createSessionHistoryClient } from './sessionHistory.ts';
import { createSessionMutationClient } from './sessionMutation.ts';
import {createSessionCatalog} from './sessionCatalog.ts';
import { scopeOf as originalScopeOf, RemoteError } from './vendor/dsh-session-controller/index.js';
import { UiSession, SlotRegistry } from './vendor/dsh-ui-session/index.js';

/** 官方窗口的应用生命周期边界：范围一旦关闭，迟到写入和新订阅立即失效。 */
class ScopedSessionEventSource extends MutableSessionEventSource {
  closed = false;
  override subscribe(listener: () => void) {
    return this.closed ? () => {} : super.subscribe(() => { if (!this.closed) listener(); });
  }
  override replace(entries: readonly any[], hasMore: boolean) { if (!this.closed) super.replace(entries, hasMore); }
  override prepend(entries: readonly any[], hasMore: boolean) { if (!this.closed) super.prepend(entries, hasMore); }
  override append(entry: any) { if (!this.closed) super.append(entry); }
  override settleAssistant(attemptId: string, entry?: any) { if (!this.closed) super.settleAssistant(attemptId, entry); }
}

export interface SlotMeta {
  name: string;
  /** 同一个插槽里多个贡献者用 id / key 区分 */
  id?: string;
  key?: string;
  order?: number;
  priority?: number;
  label?: unknown;
  locale?: string;
  select?: unknown;
  inject?: unknown;
  registrant?: string;
  [key: string]: unknown;
}

export interface SlotContribution {
  slot: string;
  meta: SlotMeta;
  /** 插件给的组件（React 组件或返回 React 元素的函数） */
  component: unknown;
  /** 注册顺序，用于稳定排序 */
  sequence: number;
  /** 哪个插件登记的：停用/卸载时要按它把贡献收回去 */
  pluginId?: string;
}

export interface PluginLoadRecord {
  id: string;
  ok: boolean;
  error?: string;
  /** 这个插件最终注册进哪些插槽 */
  slots: string[];
  /** 它调用过但我们未实现的服务方法（下一步要补什么，直接看这里） */
  missingCalls: string[];
}

/** 宿主真正渲染的插槽。没列在这里的插槽，插件的 inject 会自动跳过。 */
export const HOST_SLOTS = [
  // 会话区的视图标签（dsh-context 默认位置就是这里）
  "conversation.view",
  // 右侧面板的标签（我们的工具面板就是它）
  "sidebar.right.pane.tab",
  "sidebar.right.pane.tab.title",
  // 设置页分区
  "settings.section",
  "plugins.bundle.config",
  "sidebar.footer.action",
  "shell.overlay",
  "conversation.input.overlay",
] as const;

type Listener = () => void;

class OwnedClientSlots extends SlotRegistry {
  private readonly host: ClientPluginHost;
  constructor(ctx: Context, host: ClientPluginHost) { super(ctx); this.host = host; }
  has(name: string) { return this.host.availableSlots.has(String(name)); }
  inject(name: string, factory: () => unknown) { if (!this.has(name)) return () => {}; const dispose = factory(); return typeof dispose === 'function' ? dispose : () => {}; }
  register(meta: SlotMeta, component: unknown) {
    const dispose = this.host.registerOwnedSlot(meta, component, this.ctx.fiber);
    this.ctx.effect(() => dispose); return dispose;
  }
}

/** Only original Controller events are published; subscribing owns no execution or retention. */
function createOwnedSessionRemotes(ctx:Context) {
  const listeners=new Map<string,Set<(...args:any[])=>void>>();
  class OwnedSessionRemotes extends Service {
    constructor() {super(ctx,'remote');}
    $on(name:string,listener:(...args:any[])=>void) {
      if(!['api-session/added','api-session/removed','api-session/status','api-session/activity','api-session/error'].includes(name))
        throw new Error(`当前应用尚未提供此 DSH 事件：${name}`);
      return this.ctx.effect(()=>{
        const set=listeners.get(name)??new Set();listeners.set(name,set);set.add(listener);
        return ()=>{set.delete(listener);if(!set.size)listeners.delete(name);};
      });
    }
  }
  new OwnedSessionRemotes();
  return {publish(name:string,args:any[]) {
    for(const listener of [...listeners.get(name)??[]]) {
      try {listener(...args);} catch(error) {console.error('[plugin] DSH 会话事件订阅失败：',error);}
    }
  }};
}

class OwnedInputTriggers extends Service {
  private readonly host: ClientPluginHost;
  constructor(ctx: Context, host: ClientPluginHost) { super(ctx, 'inputTriggers'); this.host = host; }
  registerSource(source: InputSource) {
    const dispose = this.host.registerInputSource(source, this.ctx.fiber);
    this.ctx.effect(() => dispose); return dispose;
  }
  sessionOf(scope: Context) { return this.host.inputController(scope); }
}

export interface ClientHostOptions {
  locale?: string;
  slots?: readonly string[];
  /** 诊断：插件调用了未实现的服务方法 */
  onMissingCall?: (service: string, method: string) => void;
  /**
   * 会话数据提供者（壳层注入）：插件用 ctx.sessions.binding(id) 拿当前会话。
   * 我们不在客户端存会话，直接由壳层把活动会话给它——这是真实数据，不是占位。
   */
  sessionProvider?: (sessionId: string) => unknown;
  /**
   * 插件要求打开右侧面板标签时回调（kind 即插槽贡献里的 key）。
   * 壳层据此在**已有的工具面板**里开标签——这正是 sidebarRight.openTab 的语义。
   */
  onPanelRequest?: (kind: string, detail?: unknown) => void;
  /**
   * 插件要求跳转到某个会话时回调（uiConversation.openSession 的语义）。
   * 跨会话视图（例如上下文仪表盘的会话卡片）靠它实现"一键进入会话"。
   */
  onOpenSession?: (sessionId: string) => void;
  onInputSubmit?: (input: ConversationSubmission) => Promise<{kind:'success'|'error';text?:string}>;
}

export class ClientPluginHost {
  readonly ctx: Context;
  readonly localeCode: string;
  readonly availableSlots: Set<string>;

  private readonly contributions = new Map<string, SlotContribution[]>();
  private readonly listeners = new Set<Listener>();
  private readonly dictionaries = new Map<string, Record<string, Record<string, unknown>>>();
  private readonly localeEntries = new Set<{ ns: string; owner: string; table: Record<string, Record<string, unknown>> }>();
  private readonly records: PluginLoadRecord[] = [];
  private sequence = 0;
  private readonly inputSources = new Map<string, { source: InputSource; facade: InputSource; owner: string }>();
  private readonly inputSourceListeners = new Set<Listener>();
  private readonly inputDrafts = new Map<string, { text: string; revision: number }>();
  private readonly inputConsumers = new Set<(sessionId: string, text: string, edit?: { caret: number; continue?: boolean }) => boolean>();
  private readonly inputScopes = new Map<string, Context>();
  private readonly inputEpochs = new Map<string, symbol>();
  private readonly inputControllers = new Map<string, InputTriggerController>();
  private readonly inputMenuListeners = new Set<(id: string) => void>();
  private readonly inputMenuDisposers = new Map<string, () => void>();
  private readonly launchedInputHits = new Map<string, object>();
  private readonly claimOwners = new WeakMap<InputClaim, InputSource>();
  private readonly inputClaims = new Map<string, { source: InputSource; claim: InputClaim; invalid?: boolean }>();
  private readonly inputEditors = new Map<string, DshDraftEditor>();
  private readonly inputShells = new Map<string, SessionInputShell>();
  private readonly inputFaces = new Map<string, any>();
  private readonly inputInboxes = new Map<string, ReturnType<typeof createSnapshotStore<any>>>();
  private readonly inputInboxStops = new Map<string, () => void>();
  private readonly inputQueueListeners = new Set<(change: {sessionId:string;itemId:string;action:any}) => void>();
  private readonly sessionBindings = new Map<string, {sessionId: string; ctx: Context; session: any; eventSource: ScopedSessionEventSource; eventKeys: string[]; rootId: string; fiber: any; closed: boolean; stopView?: () => void; history?: ReturnType<typeof createSessionHistoryFace>}>();
  private readonly sessionClients = new Map<string, ReturnType<typeof createSessionHistoryClient>>();
  private readonly searchLifetime=new AbortController();
  private readonly pendingNativeRows=new Map<string,any>();
  private readonly observedBirthRows=new Set<string>();
  private mutationClient?:ReturnType<typeof createSessionMutationClient>;
  private mainSessionReference?:any;
  private readonly sessionRemotes:ReturnType<typeof createOwnedSessionRemotes>;
  private readonly retentionObservers=new Map<string,{source:any;listeners:Set<()=>void>;client?:ReturnType<typeof createSessionHistoryClient>;off?:()=>void}>();
  private readonly emptyRetention=Object.freeze({referenceCount:0,retainedBy:Object.freeze(Object.create(null))});
  readonly conversation: OwnedConversation;
  private inputSubmit?: ClientHostOptions['onInputSubmit'];
  private nativeAttachments?: (id: string) => import('./inputTriggers').InputAttachmentSubmission | undefined;
  private readonly mountedInputEditors = new Set<string>();
  private readonly inputSemanticKeys = new Map<string, string>();
  private readonly inputEditorErrors = new Map<string, string>();
  private readonly inputAttempts = new Map<string, { controller: AbortController; source?: InputSource }>();
  private readonly families = new Map<string, Record<string, any>>();
  private readonly familyRequests = new Map<string, Promise<void>>();
  private readonly familyRequestEpochs = new Map<string, symbol | undefined>();
  private readonly familyRefreshAgain = new Set<string>();
  private disposed = false;
  private sessionsSnapshot: any = { ids: [], byId: {}, current: '', phase:'pending', projectionsBySession:{} };
  private workspacesSnapshot: any = { items: [], current: null, archivedSessionIds: [] };
  private overviewRows: any = { byId: {} };
  private refreshPending?: Promise<void>;
  private catalogClient?:ReturnType<typeof createSessionCatalog>;
  private catalogRouting:any={rootIdBySession:{},addresses:{}};
  private catalogGeneration=0;
  private catalogRootKeys=new Map<string,string>();
  private catalogRoots=new Map<string,string>();
  private catalogSnapshotCache?:{base:any;native:any;counts:any[];value:any};
  private catalogStarted=false;
  private catalogCollectionKey='';
  private catalogRefreshTimer?:ReturnType<typeof setTimeout>;
  readonly sessionCatalogStore={getSnapshot:()=>{
    const base=this.catalog().sessions.list.getSnapshot(),native=this.sessionsSnapshot;
    const visible=(id:string)=>{const root=this.catalogRouting.rootIdBySession[id];return !!root&&this.catalogRoots.has(root)&&this.catalogRootKeys.get(root)===this.catalogRoots.get(root);};
    const rows=Object.values(base.byId).filter((row:any)=>visible(row.id)) as any[];
    const counts=rows.map(row=>this.sessionClients.get(this.catalogRouting.rootIdBySession[row.id])?.sessions.retainInfo(row.id).getSnapshot().retainedBy??this.emptyRetention.retainedBy);
    const previous=this.catalogSnapshotCache;
    if(previous&&previous.base===base&&previous.native===native&&counts.every((count,index)=>count===previous.counts[index]))return previous.value;
    const value={...base,ids:base.ids.filter(visible),byId:Object.fromEntries(rows.map((row,index)=>[row.id,{...row,retainedBy:counts[index]}])),
      current:native.current,projectionsBySession:Object.fromEntries(Object.entries(base.projectionsBySession).filter(([id])=>visible(id)))};
    this.catalogSnapshotCache={base,native,counts,value};return value;
  },subscribe:(listener:Listener)=>{const offCatalog=this.catalog().sessions.list.subscribe(listener),offNative=this.subscribe(listener);return()=>{offCatalog();offNative();};}};
  readonly sessionListStore = { getSnapshot: () => this.sessionsSnapshot, subscribe: (listener: Listener) => this.subscribe(listener) };
  private statusListCache?:{root:any;origins:any[];value:any};
  private readonly statusListStore={getSnapshot:()=>{
    const root=this.sessionsSnapshot;
    const origins=[...this.sessionClients].filter(([id])=>root.ids.includes(id)).map(([,client])=>client.sessions.list.getSnapshot());
    const previous=this.statusListCache;
    if(previous&&previous.root===root&&previous.origins.length===origins.length&&origins.every((source,index)=>source===previous.origins[index]))return previous.value;
    // UiSession can establish child running from actual Controller list rows.
    // Application navigation still lists roots; inferred catalog rows stay excluded.
    const ids=[...new Set([...root.ids,...origins.flatMap(source=>source.ids)])];
    const actualRows=Object.fromEntries(origins.flatMap(source=>source.ids.map((id:string)=>[id,source.byId[id]])));
    const value={...root,ids,byId:{...root.byId,...actualRows}};this.statusListCache={root,origins,value};return value;
  },subscribe:(listener:Listener)=>this.subscribe(listener)};
  readonly workspaceListStore = { getSnapshot: () => this.workspacesSnapshot, subscribe: (listener: Listener) => this.subscribe(listener) };
  private readonly fibers: any[] = [];
  /** 每个插件一份 fiber，停用/卸载时按 id 回收它登记的界面贡献 */
  private readonly fibersById = new Map<string, any[]>();
  /** 正在加载的插件 id：registerSlot 用它给贡献打归属（加载是逐个 await 的） */
  private activePluginId = "";
  private readonly owners = new Map<number, string>();
  readonly dshSettings = new DshSettingsBridge(payload => {
    const bridge = (globalThis as any).dyworker ?? (globalThis as any).window?.dyworker;
    if (!bridge?.dshOperation) return Promise.resolve({ ok: false, error: { message: '当前应用不能读取 DSH 会话设置' } });
    return bridge.dshOperation(payload);
  });
  /** DSH 使用固定版本的官方装配服务；原生消息转换独立保留，不能冒充官方历史。 */
  readonly uiConversation: UiConversation;
  readonly uiSession:UiSession;
  private readonly nativeViews = new Map<string, {runtime: SessionViewRuntime; events: any[]}>();

  constructor(options: ClientHostOptions = {}) {
    this.localeCode = options.locale || "zh";
    this.availableSlots = new Set(options.slots || HOST_SLOTS);
    this.ctx = new Context();

    // 未实现的方法应明确失败，不能把空结果当作成功。
    const recordMissing = (service: string, method: string) => {
      options.onMissingCall?.(service, method);
      for (const record of this.records) {
        const key = `${service}.${method}`;
        if (!record.missingCalls.includes(key)) record.missingCalls.push(key);
      }
    };

    new OwnedClientSlots(this.ctx, this);
    this.sessionRemotes=createOwnedSessionRemotes(this.ctx);
    new OwnedInputTriggers(this.ctx, this);
    new BrowserFileUpload(this.ctx, input => {
      const bridge = (globalThis as any).dyworker ?? (globalThis as any).window?.dyworker;
      if (!bridge?.browserFileUpload) return Promise.reject(new Error('当前应用没有浏览器文件上传入口'));
      return bridge.browserFileUpload(input);
    }, id => !this.disposed && (this.nativeSession(id) as any)?.runtime === 'dsh');
    this.inputSubmit = options.onInputSubmit;
    this.conversation = new OwnedConversation(this.ctx, {
      for: (scope: Context) => this.sessionInput(scope),
      requestDraftInitialization: (binding: any, options: any) => {
        const id = [...this.sessionBindings].find(([, retained]) => retained === binding)?.[0];
        if (!id || !this.inputScope(id)) throw new Error('草稿初始化需要当前仍被保留的会话');
        this.ensureInputEditor(id);
        return this.inputShells.get(id)!.requestDraftInitialization(options);
      },
    }, {
      retained: id => !this.disposed && !!this.inputScope(id),
      scope: scope => { if (!this.retainedInputScope(scope)) throw new Error('conversation 需要仍被保留的 DSH 会话范围'); return String((scope as any).dshSessionId); },
      submit: async input => {
        input.signal.throwIfAborted();
        if (!this.inputScope(input.sessionId) || this.disposed) throw new Error('会话已关闭，输入未发送');
        const block = this.conversation.blocks.storeFor(input.sessionId).getSnapshot();
        if (block) throw new Error(block.reason);
        if (!this.inputSubmit) throw new Error('当前应用没有连接会话发送入口');
        return this.inputSubmit(input);
      },
      operation: (id, action, payload) => this.inputOperation(id, action, payload),
    });
    const host = this;
    (this.ctx as any).on('slash/input-consume-token', function(this: any, request: any) {
      return host.retainedInputScope(this) && host.consumeDraft(host.scopedSessionId(this)!, request?.guard) ? true : undefined;
    });
    (this.ctx as any).on('slash/input-insert-text', function(this: any, request: any) {
      return host.retainedInputScope(this) && host.applyInputOutcome(host.scopedSessionId(this)!, request, request?.span) ? true : undefined;
    });
    (this.ctx as any).on('slash/input-begin-command', function(this: any, request: any) {
      return host.retainedInputScope(this) && host.applyInputOutcome(host.scopedSessionId(this)!, request, request?.span) ? true : undefined;
    });
    (this.ctx as any).on('slash/input-insert-reference', function(this: any, request: any) {
      return host.retainedInputScope(this) && host.applyInputOutcome(host.scopedSessionId(this)!, { insert: request?.reference }, request?.span) ? true : undefined;
    });
    this.ctx.provide('configForms', this.dshSettings);

    this.ctx.provide("locale", {
      register: (ns: string, a: unknown, b?: unknown) => this.registerLocale(ns, a, b),
      bind: (ns: string) => this.bindLocale(ns),
      getLocale: () => ({ active: this.localeCode }),
      getSnapshot: () => ({ locale: this.localeCode }),
      subscribe: (fn: Listener) => { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    });

    // 会话 / 连接 / 工作区：先把 inject 满足（否则插件根本不会 apply），
    // 方法按需补——插件用到未实现的方法会记进 missingCalls，而不是静默失效
    this.onOpenSession = options.onOpenSession;
    this.sessionProvider = options.sessionProvider;
    this.ctx.provide("sessions", this.stubService("sessions", {
      scope: (id: string) => this.inputScope(String(id || '')),
      scopeOf: (scope: Context) => this.scopedSession(scope)?.sessionId ?? (this.retainedInputScope(scope) ? this.scopedSessionId(scope) : undefined),
      list: this.sessionCatalogStore,
      searchResultLimit:this.catalog().sessions.searchResultLimit,
      refresh: () => this.refreshSessions(),
      search: (query:string,signal?:AbortSignal) => this.searchSessions(query,signal),
      create:(options:any={})=>this.sessionMutations().create(options),
      fork:(options:any)=>this.sessionMutations().fork(options),
      refreshSubagents: (id: string) => this.refreshSubagents(id),
      open: (id: string) => this.openSession(id),
      current: () => this.sessionCollection ? this.sessionCollection().current : this.unsupported("sessions.current"),
      // 插件按 binding(id).session 取会话；没有就返回 undefined（插件会如实抛出"会话不可用"）
      binding: (sessionId: string) => this.sessionBinding(String(sessionId || '')),
      retain: (target:any, options:any) => this.retainSession(target,options),
      using: async (target:any,options:any,operation:any) => {
        const reference=this.retainSession(target,options);
        try {await reference.ready;return await operation(reference);}finally{reference.release();}
      },
      sessionOf:(scope:Context)=>this.scopedSession(scope),
      retainInfo:(id:string)=>this.sessionRetainInfo(id),
      refreshProjections:async(id:string)=>{
        const root=this.bindingRoot(id);if(!root)throw new Error('此投影不是已登记的 DSH 任务');
        const client=this.sessionClient(root);if(id!==root)await client.sessions.refresh();
        return client.sessions.refreshProjections(id);
      },
      subagentAddress:(id:string)=>{const root=this.bindingRoot(id);return root?this.catalogRouting.addresses[id]??this.sessionClient(root).sessions.subagentAddress(id):undefined;},
    }));
    this.ctx.provide("connection", this.stubService("connection", {
      scope: (id?:string) => {
        const selected=id??(this.sessionCollection?.().current as any)?.id;
        const root=selected?this.bindingRoot(selected):undefined;
        if(!root)throw new Error('当前页面没有已登记的 DSH 任务连接');
        return this.sessionClient(root).connection;
      },
      status: () => {
        const selected=(this.sessionCollection?.().current as any)?.id;
        const root=selected?this.bindingRoot(selected):undefined;
        return {state:root?this.sessionClients.get(root)?.connection.state.getSnapshot():undefined};
      },
    }));
    // Each renderer source uses the exact original binding returned by retain().
    // The legacy navigation facade remains separate from Controller identity.
    this.uiSession=new UiSession(this.ctx,{
      list:this.statusListStore,
      binding:(id:string)=>{
        const root=this.bindingRoot(id);
        return root?this.sessionClients.get(root)?.sessions.binding(id):undefined;
      },
      retainInfo:(id:string)=>this.sessionRetainInfo(id),
    });
    (this.ctx as any).slots.provideRoot({hooks:{sessions:this.sessionCatalogStore,sessionStatus:this.uiSession.sessionStatus},
      keyedHooks:{sessionRetainInfo:(id:string)=>this.sessionRetainInfo(id)}});
    (this.ctx as any).slots.installScope('session',this.uiSession.adapter);
    // sidebarRight：插件用它打开右侧面板（实测 API：openTab(kind) / openResource(address)）。
    // 直接接我们已有的工具面板，而不是另造容器。
    this.ctx.provide("sidebarRight", {
      openTab: (kind: string) => {
        const key = String(kind || "");
        const exists = this.contributionsFor("sidebar.right.pane.tab").some(item => String(item.meta.key ?? item.meta.id ?? "") === key);
        if (!options.onPanelRequest || !exists) return this.unsupported(`sidebarRight.openTab(${key})`);
        options.onPanelRequest(key); return true;
      },
      openResource: () => this.unsupported("sidebarRight.openResource"),
      closeTab: () => this.unsupported("sidebarRight.closeTab"),
      has: (kind: string) => this.availableSlots.has(String(kind)),
    });

    this.uiConversation = new UiConversation(this.ctx, {binding: id => this.sessionBinding(id)});
    const conversationBinding=this.uiConversation.binding.bind(this.uiConversation);
    this.uiConversation.binding=(source:any)=>{
      if(typeof source!=='string'&&source){
        const root=this.bindingRoot(source.sessionId);
        const exact=root?this.sessionClients.get(root)?.sessions.binding(source.sessionId):undefined;
        // The original UI service passes Controller references; the application
        // conversation route has its own mirrored source. Validate before routing.
        if(exact===source)return conversationBinding(this.sessionBinding(source.sessionId)!);
      }
      return conversationBinding(source);
    };
    // 老插件的两个注册入口共用官方注册表，登记和注销仍由调用方的 Cordis 范围负责。
    Object.assign(this.uiConversation.events, {list: () => this.uiConversation.events.entries()});
    Object.assign(this.uiConversation.views, {list: () => this.uiConversation.views.entries()});
    this.ctx.provide('conversationEvents', this.uiConversation.events);
    this.ctx.provide('conversationViews', this.uiConversation.views);
    this.ctx.effect(() => {
      const changed = () => {
        for (const [id, current] of this.nativeViews) {
          const runtime = this.createNativeViewRuntime(); runtime.ingest(current.events);
          this.nativeViews.set(id, {runtime, events: current.events});
        }
        this.notify();
      };
      const offEvents = this.uiConversation.events.subscribe(changed);
      const offViews = this.uiConversation.views.subscribe(changed);
      return () => { offEvents(); offViews(); };
    }, 'dyworker native conversation definitions');
    Object.assign(this.uiConversation, {
      openSession: (sessionId: string) => {
        const id = String(sessionId || "");
        if (!id || !this.onOpenSession) return false;
        this.onOpenSession(id);
        return true;
      },
    });
    this.ctx.provide('uiWorkspace', { openSession: (id: string) => this.openSession(id) });

    this.ctx.provide("workspaces", this.stubService("workspaces", {
      scope: () => this.stubService("workspaces.scope", {}),
      list: this.workspaceListStore,
      current: () => this.workspaceCollection ? this.workspaceCollection().current : this.unsupported("workspaces.current"),
    }));
  }

  /** 壳层更新会话数据来源（活动会话变化时调用） */
  setSessionProvider(provider: ((sessionId: string) => unknown) | undefined) {
    this.sessionProvider = provider;
    for (const id of this.inputScopes.keys()) if ((this.nativeSession(id) as any)?.runtime !== 'dsh') this.disposeInputScope(id);
    this.reconcileSessionBindings();
  }
  private bindingRoot(id: string): string | undefined {
    if (this.disposed) return undefined;
    if ((this.nativeSession(id) as any)?.runtime === 'dsh') return id;
    const child = this.subagent(id);
    return child && (this.nativeSession(child.rootSessionId) as any)?.runtime === 'dsh' ? child.rootSessionId : undefined;
  }
  private releaseSessionBinding(id: string) {
    const binding = this.sessionBindings.get(id); if (!binding) return;
    binding.closed = true; this.sessionBindings.delete(id);
    binding.eventSource.closed = true;
    binding.stopView?.();
    void binding.history?.dispose().catch(() => {});
    // 关闭标记即时拒绝迟到结果；范围销毁完成后，官方缓存撤销此范围的所有图片。
    void Promise.resolve(binding.fiber.dispose()).catch(() => {});
  }
  private reconcileSessionBindings() {
    for (const [id, binding] of this.sessionBindings) if (this.bindingRoot(id) !== binding.rootId) this.releaseSessionBinding(id);
    for(const [root,client]of this.sessionClients)if(this.disposed||(this.nativeSession(root) as any)?.runtime!=='dsh'){
      this.sessionClients.delete(root);void client.dispose().catch(()=>{});
      for(const [id,observer]of this.retentionObservers)if(observer.client===client)this.bindRetentionObserver(id,observer);
    }
  }
  private sessionClient(root:string) {
    let client=this.sessionClients.get(root);
    if(!client) {
      const scope=this.inputScope(root);if(!scope)throw new Error('会话读取所属根任务已关闭');
      const created=createSessionHistoryClient(root,async input=>{
        const bridge=(globalThis as any).dyworker ?? (globalThis as any).window?.dyworker;
        if(!bridge?.dshOperation)throw new Error('当前应用没有会话读取入口');
        return bridge.dshOperation(input);
      },()=>!this.disposed&&this.sessionClients.get(root)===created&&(this.nativeSession(root) as any)?.runtime==='dsh',scope,()=>this.sessionMutations().remote,
        (name,args)=>this.sessionRemotes.publish(name,args));
      client=created;this.sessionClients.set(root,client);
      let queued=false;
      created.subscribe(()=>{
        if(queued)return;queued=true;
        queueMicrotask(()=>{queued=false;if(!this.disposed&&this.sessionClients.get(root)===created)this.updateCollections();});
      });
      for(const [id,observer]of this.retentionObservers)if(this.bindingRoot(id)===root)this.bindRetentionObserver(id,observer);
    }
    return client;
  }
  private scopedSession(scope:Context) {
    if(this.disposed)return undefined;
    for(const client of this.sessionClients.values()){const session=client.sessions.sessionOf(scope);if(session)return session;}
    return undefined;
  }
  private scopedSessionId(scope:any) {
    if(!scope)return undefined;
    const tagged=originalScopeOf(scope);
    return tagged===undefined ? scope?.dshSessionId : this.scopedSession(scope)?.sessionId;
  }
  private bindRetentionObserver(id:string,observer:{source:any;listeners:Set<()=>void>;client?:ReturnType<typeof createSessionHistoryClient>;off?:()=>void}) {
    const root=this.bindingRoot(id),client=root?this.sessionClients.get(root):undefined;
    if(client===observer.client)return;
    observer.off?.();observer.client=client;
    observer.off=client?.sessions.retainInfo(id).subscribe(()=>{for(const listener of observer.listeners)listener();});
    for(const listener of observer.listeners)listener();
  }
  private sessionRetainInfo(id:string) {
    let observer=this.retentionObservers.get(id);
    if(!observer){
      const listeners=new Set<()=>void>();
      observer={listeners,source:{getSnapshot:()=>{
        const root=this.bindingRoot(id);return (root?this.sessionClients.get(root)?.sessions.retainInfo(id).getSnapshot():undefined)??this.emptyRetention;
      },subscribe:(listener:()=>void)=>{listeners.add(listener);return ()=>listeners.delete(listener);}}};
      this.retentionObservers.set(id,observer);this.bindRetentionObserver(id,observer);
    }
    return observer.source;
  }
  private retainSession(target:any,options:any) {
    options?.signal?.throwIfAborted();
    if(typeof options?.source!=='string')throw new Error('会话读取需要明确的来源名称');
    const id=typeof target==='string'?target:target?.childSessionId;
    const binding=this.sessionBinding(id);
    if(!binding?.history)throw new Error('此会话不是仍被保留的 DSH 任务');
    if(typeof target!=='string'){
      const child=this.subagent(id);
      if(!child||target.parentSessionId!==child.parentId||!['unknown',child.address?.mode??child.projectionValues?.subagent?.mode].includes(target.mode))
        throw new Error('子任务地址不属于指定的直接父任务');
    }
    const reference=binding.history.sessions.retain(target,options);
    const client=this.sessionClient(binding.rootId);
    void client.open(reference.binding.session).catch(error=>{
      if(!this.disposed&&this.sessionClients.get(binding.rootId)===client)
        console.warn('[plugin] 会话读取更新失败：',String(error?.message||error));
    });
    return reference;
  }
  /** Application selection owns one original main-view reference, independent of readers. */
  selectMainSession(id:string=''):Promise<void> {
    if(this.disposed)return Promise.reject(new Error('插件客户端已关闭'));
    if(this.mainSessionReference?.sessionId===id&&this.bindingRoot(id))return this.mainSessionReference.ready.then(()=>{});
    this.mainSessionReference?.release();this.mainSessionReference=undefined;
    if(!id){this.updateCollections();return Promise.resolve();}
    try {
      const reference=this.retainSession(id,{source:'mainView'});
      this.mainSessionReference=reference;this.updateCollections();return reference.ready.then(()=>{});
    } catch(error) {this.updateCollections();return Promise.reject(error);}
  }
  private sessionBinding(id: string) {
    const rootId = this.bindingRoot(id); if (!rootId) { this.releaseSessionBinding(id); return undefined; }
    let binding = this.sessionBindings.get(id);
    if (binding?.rootId !== rootId) { this.releaseSessionBinding(id); binding = undefined; }
    if (!binding) {
      const retained = {sessionId: id, ctx: this.ctx, session: {} as any, history:undefined as ReturnType<typeof createSessionHistoryFace> | undefined,
        eventSource: new ScopedSessionEventSource(), eventKeys: [] as string[], rootId, fiber:undefined as any, closed:false,stopView:undefined as (()=>void)|undefined};
      const live = () => !retained.closed && this.sessionBindings.get(id) === retained && this.bindingRoot(id) === rootId
        && (!retained.history || retained.history.sessions.sessionOf(retained.ctx)===retained.history.session);
      const child = this.subagent(id);
      const face = createSessionHistoryFace(rootId,id,child ? {parentSessionId:child.parentId,childSessionId:id,mode:child.address?.mode??child.projectionValues?.subagent?.mode ?? 'unknown'} : undefined,
        async input => {
          const bridge = (globalThis as any).dyworker ?? (globalThis as any).window?.dyworker;
          if (!bridge?.dshOperation) throw new Error('当前应用没有会话读取入口');
          return bridge.dshOperation(input);
        },live,this.sessionClient(rootId));
      retained.history = face;
      retained.ctx=face.ctx.extend({dshSessionId:id});
      retained.fiber=face.ctx.fiber;
      const offEvents = face.session.eventSource.subscribe(() => {
        if (!live()) return;
        const window = face.session.eventSource.getSnapshot(), change = window.change;
        if (change.kind === 'replace') retained.eventSource.replace(change.entries,window.hasMore);
        else if (change.kind === 'prepend') retained.eventSource.prepend(change.entries,window.hasMore);
        else if (change.kind === 'append') for (const entry of change.entries) retained.eventSource.append(entry);
        else if (change.kind === 'settle-assistant') retained.eventSource.settleAssistant(change.attemptId,change.entry);
        this.notify();
      });
      const offState = face.session.subscribe(() => {if(live()) this.notify();});
      const offProjection = face.session.projections.subscribeAny(() => {if(live()) this.notify();});
      const offErrors = face.errors.subscribe(() => {if(live())this.notify();});
      let familyStamp='';
      const offCatalog = face.sessions.list.subscribe(() => {
        if(!live()||!this.sessionsSnapshot.ids.includes(rootId))return;
        const snapshot=face.sessions.list.getSnapshot();
        const stamp=JSON.stringify(snapshot.ids.map((id:string)=>[id,snapshot.byId[id]?.running,
          snapshot.projectionsBySession[id]?.values.subagentCatalog]));
        if(stamp===familyStamp)return;familyStamp=stamp;
        void this.refreshSubagents(rootId).catch(error=>{console.warn('[plugin] 子任务目录更新失败：',String(error?.message||error));});
      });
      retained.ctx.effect(() => () => {
        retained.closed=true;retained.eventSource.closed=true;retained.stopView?.();
        if(this.sessionBindings.get(id)===retained)this.sessionBindings.delete(id);
        offEvents();offState();offProjection();offErrors();offCatalog();return face.dispose();
      });
      const source = this.nativeSession(id) ?? this.sessionsSnapshot.byId[id];
      retained.session = new Proxy({readAttachment: async (attachmentId: string) => {
        try {
          if (!live()) throw new Error('历史图片所属任务已经关闭');
          const bridge = (globalThis as any).dyworker ?? (globalThis as any).window?.dyworker;
          if (!bridge?.dshOperation) throw new Error('当前应用没有历史图片读取入口');
          const result = await bridge.dshOperation({sessionId:rootId, action:'session-image', payload:{targetSessionId:id,attachmentId}});
          if (!live()) throw new Error('历史图片所属任务已经关闭');
          if (!result?.ok) return {ok:false,error:result?.error ?? {code:'gateway/internal',message:'历史图片读取失败'}};
          const binary = atob(result.value.data);
          return {ok:true,value:{attachment:result.value.attachment,data:Uint8Array.from(binary, char=>char.charCodeAt(0))}};
        } catch (error: any) { return {ok:false,error:{code:error?.code ?? 'gateway/internal',message:String(error?.message || error)}}; }
      }}, {get: (target, key, receiver) => {
        if (key in target) return Reflect.get(target,key,receiver);
        if (key === 'open') return face.open;
        if (key in face.session) {const value=Reflect.get(face.session,key);return typeof value === 'function' ? value.bind(face.session) : value;}
        return Reflect.get((this.nativeSession(id) ?? this.sessionsSnapshot.byId[id] ?? source) as object,key);
      }});
      binding = retained; this.sessionBindings.set(id,binding);
    }
    return binding;
  }
  setInputSubmit(submit: ClientHostOptions['onInputSubmit']) { this.inputSubmit = submit; }
  setNativeAttachmentProvider(capture?: (id: string) => import('./inputTriggers').InputAttachmentSubmission | undefined) { this.nativeAttachments = capture; }
  private async inputOperation(id: string, action: string, payload: any = {}) {
    if (!this.inputScope(id) || this.disposed) throw new Error('此会话输入已经关闭');
    const bridge = (globalThis as any).dyworker ?? (globalThis as any).window?.dyworker;
    if (!bridge?.dshOperation) throw new Error('当前应用没有会话队列操作入口');
    const result = await bridge.dshOperation({sessionId:id,action,payload});
    if (!result?.ok) throw Object.assign(new Error(result?.error?.message || '会话队列操作失败'),{code:result?.error?.code,details:result?.error?.details});
    if (action === 'input-update-queue') for (const listener of this.inputQueueListeners) listener({sessionId:id,itemId:payload.itemId,action:payload.action});
    if (action !== 'input-snapshot') await this.refreshInputInbox(id);
    return result.value;
  }
  subscribeInputQueue(listener: (change: {sessionId:string;itemId:string;action:any}) => void) {
    this.inputQueueListeners.add(listener);return () => {this.inputQueueListeners.delete(listener);};
  }
  async refreshInputInbox(id: string) {
    const scope = this.inputScopes.get(id), store = this.inputInboxes.get(id);
    if (!scope || !store || !this.retainedInputScope(scope)) return;
    const value = await this.inputOperation(id,'input-snapshot');
    if (!this.retainedInputScope(scope) || this.inputInboxes.get(id) !== store) return;
    if (JSON.stringify(store.getSnapshot()) !== JSON.stringify(value.inbox)) store.set(value.inbox);
  }
  private watchInputInbox(id: string) {
    if (this.inputInboxStops.has(id)) return;
    const bridge = (globalThis as any).dyworker ?? (globalThis as any).window?.dyworker;
    if (!bridge?.dshOperation) return;
    let ended = false, running = false;
    const refresh = async () => {
      if (ended || running) return;running = true;
      try { await this.refreshInputInbox(id); } catch { /* 实际操作失败会返回错误；只读刷新不编造队列数据。 */ }
      finally { running = false; }
    };
    const timer = setInterval(() => void refresh(),750);void refresh();
    this.inputInboxStops.set(id, () => {ended=true;clearInterval(timer);});
  }

  private sessionProvider?: (sessionId: string) => unknown;
  nativeSession(id:string):any{
    const pending=this.pendingNativeRows.get(id),native:any=this.sessionProvider?.(id);
    return pending&&native?{...native,title:pending.title,titleCustom:pending.titleCustom}:pending||native;
  }
  acceptCreatedSession(record:any){
    if(this.disposed||record?.runtime!=='dsh'||typeof record.id!=='string')return;
    if((this.sessionProvider?.(record.id) as any)?.runtime==='dsh'&&!this.pendingNativeRows.has(record.id))return;
    this.pendingNativeRows.set(record.id,record);
    if(this.sessionCollection)this.updateCollections();
    else{
      this.sessionsSnapshot={...this.sessionsSnapshot,ids:[record.id,...this.sessionsSnapshot.ids.filter((id:string)=>id!==record.id)],byId:{...this.sessionsSnapshot.byId,
        [record.id]:{id:record.id,title:record.title,cwd:record.workspacePath,blank:!record.messages.length,updatedAt:Date.parse(record.updatedAt)||0}}};
      this.notify();
    }
  }
  private sessionMutations(){
    if(this.disposed)throw new Error('插件客户端已关闭');
    return this.mutationClient??=createSessionMutationClient(this.ctx,{
      operation:input=>{
        const bridge=(globalThis as any).dyworker??(globalThis as any).window?.dyworker;
        if(!bridge?.dshOperation)throw new Error('当前应用没有任务创建入口');return bridge.dshOperation(input);
      },published:async record=>{this.acceptCreatedSession(record);await this.refreshPublishedSession();},defaultSession:()=>this.sessionsSnapshot.current||'',summary:id=>this.sessionCatalogStore.getSnapshot().byId[id],
      renamed:async(id,title)=>{
        const row:any=this.sessionProvider?.(id)||this.pendingNativeRows.get(id);
        if(row&&!this.disposed){this.pendingNativeRows.set(id,{...row,title,titleCustom:true});this.updateCollections();}
        await this.refreshPublishedSession();
      },
      source:id=>{
        const root=this.bindingRoot(id);if(!root)return undefined;
        const child=id===root?undefined:this.subagent(id);
        return {rootId:root,address:child?{kind:'subagent',childSessionId:id,parentSessionId:child.parentId,mode:child.address?.mode??child.projectionValues?.subagent?.mode??'unknown'}:{kind:'session',sessionId:id}};
      },
    });
  }
  private sessionCollection?: () => { items: unknown[]; current: unknown };
  private workspaceCollection?: () => { items: unknown[]; current: unknown; archivedSessionIds?: string[] };
  setCollections(sessions: () => { items: unknown[]; current: unknown }, workspaces: () => { items: unknown[]; current: unknown; archivedSessionIds?: string[] }) {
    this.sessionCollection = sessions; this.workspaceCollection = workspaces; this.updateCollections();
    const key=JSON.stringify((sessions().items as any[]).filter(row=>row.runtime==='dsh').map(row=>
      [row.id,row.createdAt,row.workspacePath,row.title,row.updatedAt,row.messages?.length,row.messages?.at(-1)?.taskStatus]));
    if(key!==this.catalogCollectionKey){this.catalogCollectionKey=key;this.scheduleCatalogRefresh();}
  }
  private scheduleCatalogRefresh(){
    if(this.disposed||!this.catalogStarted||this.catalogRefreshTimer)return;
    this.catalogRefreshTimer=setTimeout(()=>{
      this.catalogRefreshTimer=undefined;
      void (async()=>{await this.refreshPending?.catch(()=>{});if(!this.disposed)await this.refreshSessions();})().catch(()=>{});
    },750);
  }
  private openSession(id: string) {
    if (!id || !this.onOpenSession || !this.sessionsSnapshot.byId[id]) return false;
    this.onOpenSession(id); return true;
  }
  private async refreshPublishedSession(){
    // A mutation changes the authorized corpus. Drain an older generation,
    // then read the committed task rather than returning its stale result.
    await this.refreshPending?.catch(()=>{});
    await this.refreshSessions();
  }
  private catalogVersion(){return String(this.catalogGeneration)+':'+JSON.stringify([...this.catalogRoots].sort(([a],[b])=>a.localeCompare(b)));}
  private catalog(){
    return this.catalogClient??=createSessionCatalog(this.ctx,{version:()=>this.catalogVersion(),live:()=>!this.disposed,
      operation:async signal=>{
        const bridge=(globalThis as any).dyworker??(globalThis as any).window?.dyworker;
        if(!bridge?.dshOperation)throw new Error('当前应用没有全局任务目录入口');
        signal.throwIfAborted();
        const listId=globalThis.crypto.randomUUID();
        const cancel=()=>{void bridge.dshOperation({sessionId:'',action:'global-list-cancel',payload:{listId}}).catch(()=>{});};
        signal.addEventListener('abort',cancel,{once:true});
        try{const reply=await bridge.dshOperation({sessionId:'',action:'global-list',payload:{listId}});signal.throwIfAborted();return reply;}
        finally{signal.removeEventListener('abort',cancel);}
      },published:(value,state)=>{
        this.catalogRouting=value;this.catalogRootKeys=new Map(this.catalogRoots);
        for(const root of this.catalogRoots.keys()){
          const byId=Object.fromEntries(Object.values(state.byId).filter((row:any)=>value.rootIdBySession[row.id]===root).map((row:any)=>[row.id,{...row,rootSessionId:root,
            ...(value.addresses[row.id]?{address:value.addresses[row.id]}:{})}]));
          this.families.set(root,byId);
        }
        this.updateCollections();
      }});
  }
  private updateCollections() {
    const collection = this.sessionCollection?.();
    if (collection) {
      const native=collection.items as any[];
      for(const id of this.pendingNativeRows.keys()){
        if(native.some(row=>row.id===id&&row.runtime==='dsh'))this.observedBirthRows.add(id);
        else if(this.observedBirthRows.has(id))this.pendingNativeRows.delete(id);
      }
      for(const row of native)if(row.runtime==='dsh'&&this.pendingNativeRows.get(row.id)?.title===row.title)this.pendingNativeRows.delete(row.id);
      const items = [...this.pendingNativeRows.keys()].map(id=>this.nativeSession(id)).concat(native.filter(row=>!this.pendingNativeRows.has(row.id))).filter((row: any) => row.runtime === 'dsh') as any[];
      const rootIds = new Set(items.map(row => row.id));
      const roots=new Map<string,string>(items.map(row=>[row.id,JSON.stringify([row.createdAt,row.workspacePath])]));
      for(const [root,key]of this.catalogRoots)if(roots.get(root)!==key){
        const selected=this.mainSessionReference?.sessionId;
        if(selected===root||(selected&&this.subagent(selected)?.rootSessionId===root)){
          this.mainSessionReference?.release();this.mainSessionReference=undefined;
        }
        const client=this.sessionClients.get(root);this.sessionClients.delete(root);
        void client?.dispose().catch(()=>{});
        for(const [id,binding]of this.sessionBindings)if(binding.rootId===root)this.releaseSessionBinding(id);
        this.disposeInputScope(root);this.families.delete(root);
      }
      if(JSON.stringify([...roots])!==JSON.stringify([...this.catalogRoots])){this.catalogGeneration++;this.catalogRoots=roots;}
      if(this.mainSessionReference&&!this.bindingRoot(this.mainSessionReference.sessionId)){
        this.mainSessionReference.release();this.mainSessionReference=undefined;
      }
      for (const id of this.inputScopes.keys()) if (!rootIds.has(id)) this.disposeInputScope(id);
      for (const root of this.families.keys()) if (!rootIds.has(root)) this.families.delete(root);
      const children = Object.fromEntries([...this.families.entries()].flatMap(([root, rows]) =>
        Object.entries(rows).filter(([id]) => id !== root).map(([id,row])=>[id,{...(row as any),
          ...this.sessionClients.get(root)?.sessions.list.getSnapshot().byId[id],
          retainedBy:this.sessionClients.get(root)?.sessions.retainInfo(id).getSnapshot().retainedBy??this.emptyRetention.retainedBy}])));
      const selectedId=(collection.current as any)?.id;
      this.sessionsSnapshot = { ids: items.map(row => row.id), current: rootIds.has(selectedId)?selectedId:'',
        phase:'ready',projectionsBySession:Object.assign({},...[...this.sessionClients.values()].map(client=>client.sessions.list.getSnapshot().projectionsBySession)),
        byId: { ...children, ...Object.fromEntries(items.map(row => [row.id, { ...this.overviewRows.byId?.[row.id],
          ...this.families.get(row.id)?.[row.id], ...this.sessionClients.get(row.id)?.sessions.list.getSnapshot().byId[row.id], id: row.id,
          retainedBy:this.sessionClients.get(row.id)?.sessions.retainInfo(row.id).getSnapshot().retainedBy??this.emptyRetention.retainedBy,
          title: row.title, displayTitle:row.title||String(row.workspacePath||'').split(/[\\/]/).filter(Boolean).at(-1)||row.id,
          cwd: row.workspacePath, updatedAt: Date.parse(row.updatedAt) || 0,
          ...(row.parentSessionId?{parentSessionId:row.parentSessionId}:{}),
          blank: !row.messages?.length }])) } };
      this.reconcileSessionBindings();
    }
    const workspaces = this.workspaceCollection?.();
    if (workspaces) this.workspacesSnapshot = { ...workspaces, archivedSessionIds: workspaces.archivedSessionIds || [] };
    this.notify();
  }
  refreshSessions(): Promise<void> {
    this.catalogStarted=true;
    if(this.catalogRefreshTimer){clearTimeout(this.catalogRefreshTimer);this.catalogRefreshTimer=undefined;}
    if (this.refreshPending) return this.refreshPending;
    const pending = this.catalog().refresh();
    this.refreshPending = pending;
    void pending.finally(() => { if (this.refreshPending === pending) this.refreshPending = undefined; }).catch(() => {});
    return pending;
  }
  private async searchSessions(query:string,signal?:AbortSignal) {
    const errorOf=(error:any)=>new RemoteError(error?.code||'gateway/internal',String(error?.message||error||'跨任务搜索失败'),error?.details||{});
    const combined=AbortSignal.any([this.searchLifetime.signal,...(signal?[signal]:[])]);
    let cancel:(()=>void)|undefined;
    try {
      combined.throwIfAborted();
      if(this.disposed)throw new Error('插件客户端已关闭');
      const bridge=(globalThis as any).dyworker ?? (globalThis as any).window?.dyworker;
      if(!bridge?.dshOperation)throw new Error('当前应用没有跨任务搜索入口');
      const searchId=globalThis.crypto.randomUUID();
      cancel=()=>{void bridge.dshOperation({sessionId:'',action:'global-search-cancel',payload:{searchId}}).catch(()=>{});};
      const pending=bridge.dshOperation({sessionId:'',action:'global-search',payload:{query,searchId}});
      combined.addEventListener('abort',cancel,{once:true});
      if(combined.aborted)cancel();
      const result=await pending;
      combined.throwIfAborted();
      if(this.disposed)throw new Error('插件客户端已关闭');
      if(!result?.ok)return {ok:false,error:errorOf(result?.error)};
      return {ok:true,value:result.value};
    }catch(error){return {ok:false,error:errorOf(error)};}
    finally{if(cancel)combined.removeEventListener('abort',cancel);}
  }
  /** 根任务列表仍只列根；子任务用官方目录与自己的投影进入 byId。 */
  refreshSubagents(root: string): Promise<void> {
    if(this.disposed)return Promise.reject(new Error('子任务读取所属客户端已关闭'));
    this.inputScope(root);
    const epoch=this.inputEpochs.get(root);
    const prior = this.familyRequests.get(root);
    if (prior && this.familyRequestEpochs.get(root)===epoch) {this.familyRefreshAgain.add(root);return prior;}
    let pending!: Promise<void>;
    pending = (async () => {
      if (!this.sessionsSnapshot.ids.includes(root)) throw new Error('此任务不是已登记的 DSH 根任务');
      const bridge = (globalThis as any).dyworker ?? (globalThis as any).window?.dyworker;
      if (!bridge?.dshOperation) throw new Error('当前应用不能读取 DSH 子任务');
      do {
        this.familyRefreshAgain.delete(root);
        const result = await bridge.dshOperation({ sessionId: root, action: 'family' });
        if (!result?.ok) throw new Error(result?.error?.message || '子任务目录读取失败');
        if (this.disposed || !this.sessionsSnapshot.ids.includes(root) || this.inputEpochs.get(root)!==epoch
          || this.familyRequests.get(root)!==pending) return;
        if (JSON.stringify(this.families.get(root)) !== JSON.stringify(result.value.byId)) {
          this.families.set(root, result.value.byId); this.updateCollections();
        }
      } while(this.familyRefreshAgain.has(root));
    })();
    this.familyRequests.set(root, pending);
    this.familyRequestEpochs.set(root,epoch);
    void pending.finally(() => {
      if (this.familyRequests.get(root) === pending) {
        this.familyRequests.delete(root);this.familyRequestEpochs.delete(root);this.familyRefreshAgain.delete(root);
      }
    }).catch(() => {});
    return pending;
  }
  subagent(id: string) {
    const row = this.sessionsSnapshot.byId[id];
    return row?.parentId && row?.rootSessionId ? row : undefined;
  }
  private unsupported(name: string): never { throw new Error(`此插件功能暂不支持：${name}`); }
  private readonly onOpenSession?: (sessionId: string) => void;

  private inputScope(id: string) {
    if (!id || (this.nativeSession(id) as any)?.runtime !== 'dsh') return undefined;
    let scope = this.inputScopes.get(id);
    if (!scope) {
      const epoch = Symbol(id); this.inputEpochs.set(id, epoch);
      scope = this.ctx.extend({ dshSessionId: id, dyworkerInputEpoch: epoch } as any); this.inputScopes.set(id, scope);
    }
    return scope;
  }
  private retainedInputScope(scope: any) {
    const id=this.scopedSessionId(scope);
    return !this.disposed && typeof id === 'string'
      && this.inputEpochs.get(id) === scope.dyworkerInputEpoch
      && this.inputEpochs.has(id) && (this.nativeSession(id) as any)?.runtime === 'dsh';
  }
  inputController(scope: Context): InputTriggerController {
    if (!this.retainedInputScope(scope)) throw new Error('inputTriggers.sessionOf 需要仍被保留的 DSH 会话范围');
    const id = this.scopedSessionId(scope)!;
    let controller = this.inputControllers.get(id);
    if (!controller) {
      controller = new InputTriggerController({ actx: this.inputScopes.get(id), sessionId: id,
        roster: { sources: trigger => [...this.inputSources.values()].filter(row => row.source.trigger === trigger)
          .sort((a, b) => (a.source.order || 0) - (b.source.order || 0)).map(row => row.facade),
          all: () => [...this.inputSources.values()].map(row => row.facade) } });
      this.inputControllers.set(id, controller);
      const changed = () => {
        const state = controller!.menu.getSnapshot();
        if (!state.open || !state.hit) this.launchedInputHits.delete(id);
        else if (controller!.launcher.getSnapshot()) this.launchedInputHits.set(id, state.hit);
        else if (this.launchedInputHits.get(id) !== state.hit) this.launchedInputHits.delete(id);
        for (const listener of this.inputMenuListeners) listener(id);
      };
      const offMenu = controller.menu.subscribe(changed);
      const offLauncher = controller.launcher.subscribe(changed);
      const offHeaders = controller.headers.subscribe(changed);
      this.inputMenuDisposers.set(id, () => { offMenu(); offLauncher(); offHeaders(); });
    }
    return controller;
  }
  private disposeInputScope(id: string) {
    this.inputInboxStops.get(id)?.(); this.inputInboxStops.delete(id); this.inputInboxes.delete(id);
    this.inputMenuDisposers.get(id)?.(); this.inputMenuDisposers.delete(id); this.launchedInputHits.delete(id);
    this.inputEditors.get(id)?.dispose(); this.inputEditors.delete(id); this.mountedInputEditors.delete(id);
    this.inputShells.get(id)?.dispose(); this.inputShells.delete(id); this.inputFaces.delete(id);
    this.releaseSessionBinding(id); this.conversation.releaseSession(id);
    this.inputSemanticKeys.delete(id); this.inputEditorErrors.delete(id);
    this.inputDrafts.delete(id);
    this.cancelInput(id); this.inputControllers.get(id)?.dispose(); this.inputControllers.delete(id);
    this.inputScopes.delete(id); this.inputEpochs.delete(id); this.inputClaims.delete(id);
  }
  private ensureInputEditor(id: string, initialText = '') {
    const scope = this.inputScope(id); if (!scope) throw new Error('引用编辑器需要已登记的 DSH 根会话');
    let editor = this.inputEditors.get(id);
    if (!editor) {
      const inbox = createSnapshotStore<any>(undefined);this.inputInboxes.set(id,inbox);
      const shell = new SessionInputShell({actx:scope,
        captureAttachments: () => this.nativeAttachments?.(id),
        inbox,
        inputTriggers: () => this.retainedInputScope(scope) ? this.inputController(scope) : undefined, popup: () => ({dismiss: () => this.dismissInputMenu(id)}),
        defaultSink: (text, ids, mode, signal, context) => this.conversation.sendSession({sessionId:id}, text, ids, mode, signal, context),
        commandAttachments: {
          serialize: ids => this.conversation.serializeFor(id, ids),
          release: ids => { for (const draft of ids) this.conversation.releaseDraftAttachment(draft); },
          unsupportedNotice: token => `插件命令 ${token.trim()} 不接受附件，输入已保留`,
        },
      });
      this.inputShells.set(id, shell);
      editor = new DshDraftEditor(id, {
        changed: () => { if (editor && this.inputEditors.get(id) === editor) { this.setInputDraft(id, editor.projection.clipboardText); editor.refreshSources(); } },
        error: error => { this.inputEditorErrors.set(id, `引用草稿保存或恢复失败：${String((error as any)?.message || error)}`); this.notify(); },
        controller: () => this.inputController(scope), claimToken: () => this.inputClaims.get(id)?.claim.token || null,
        hasSource: name => [...this.inputSources.values()].some(row => row.source.name === name && typeof row.source.codec?.serialize === 'function'),
      }, initialText, shell);
      this.inputEditors.set(id, editor);
      shell.bindDraftPersistence(() => editor!.flush());
      this.watchInputInbox(id);
    }
    this.setInputDraft(id, editor.projection.clipboardText); return editor;
  }
  mountInputEditor(id: string, initialText = '') {
    const editor = this.ensureInputEditor(id, initialText); this.mountedInputEditors.add(id); return editor;
  }
  sessionInput(scope: Context) {
    if (!this.retainedInputScope(scope)) throw new Error('conversation.input.for 需要仍被保留的 DSH 会话范围');
    const id = String((scope as any).dshSessionId); this.ensureInputEditor(id);
    let face = this.inputFaces.get(id); if (face) return face;
    const shell = this.inputShells.get(id)!;
    const guard = () => { if (!this.retainedInputScope(scope) || this.inputShells.get(id) !== shell) throw new Error('此会话输入已经关闭'); };
    const add = (ids: readonly string[]) => { guard(); this.conversation.assertOwned(id, ids); return shell.addAttachments(ids); };
    const actions = {...shell.actions,
      addAttachments:add, removeAttachment:(draft:string) => { guard(); shell.removeAttachment(draft); },
      pruneAttachments:(ids:readonly string[]) => { guard(); shell.pruneAttachments(ids.filter(draft => this.conversation.availableFor(id).includes(draft))); },
    };
    face = {state:shell.state, notices:shell.notices,
      setDraft:(text:string) => { guard(); shell.setDraft(text); },
      addAttachments:add, removeAttachment:(draft:string) => { guard(); return shell.removeAttachment(draft); },
      pruneAttachments:actions.pruneAttachments,
      beginCommand:(claim:InputClaim, span:InputSpan) => { guard(); return shell.beginCommand(this.protectedInputClaim(id, claim), span); },
      insertReference:(ref:ReferenceInsert, span:InputSpan) => { guard(); return shell.insertReference(ref, span); },
      submit:(mode:'queue'|'steer' = 'queue', source?:'click'|'enter') => { guard(); shell.submit(mode, source); },
      notify:(level:'info'|'error', text:string) => { guard(); shell.notify(level, text); },
      focus:() => { guard(); shell.focus(); },
      actions:new Proxy(actions, {get:(target:any, key:string) => typeof target[key] === 'function'
        ? (...args:any[]) => { guard(); return target[key](...args); } : target[key]}),
    };
    this.inputFaces.set(id, face); return face;
  }
  private protectedInputClaim(id: string, claim: InputClaim): InputClaim {
    const owner = this.claimOwners.get(claim);
    if (!owner || this.inputSources.get(`${owner.trigger}${owner.name}`)?.source !== owner) throw new Error('插件命令来源已经变化，请重新选择');
    return {...claim, submit:async (args, scope, attachments) => {
      if (!this.retainedInputScope(scope) || String((scope as any).dshSessionId) !== id
        || this.inputSources.get(`${owner.trigger}${owner.name}`)?.source !== owner) throw new Error('插件命令来源已停用');
      const result = await claim.submit(args, scope, attachments);
      if (!this.retainedInputScope(scope) || this.inputSources.get(`${owner.trigger}${owner.name}`)?.source !== owner) throw new Error('插件命令来源已停用');
      return result;
    }};
  }
  unmountInputEditor(id: string) { this.mountedInputEditors.delete(id); this.cancelInput(id); this.dismissInputMenu(id); this.inputEditors.get(id)?.flush(); }
  inputEditor(id: string) { return this.inputEditors.get(id); }
  inputEditorError(id: string) { return this.inputEditorErrors.get(id); }
  inputProjection(id: string, fallback = '') { const editor = this.inputEditors.get(id); return editor ? editor.projection.detectText : fallback; }
  inputCaret(id: string, fallback: number) { return this.inputEditors.get(id)?.runtime.caretSpan().end ?? fallback; }
  inputReady(id: string) { return this.mountedInputEditors.has(id); }
  openInputReference(id: string, reference: Pick<ReferenceInsert, 'source' | 'ref' | 'appearance'>) {
    const scope = this.inputScope(id); return scope ? this.inputController(scope).openReference(reference.source, reference) : false;
  }
  private refreshInputEditors() { for (const editor of this.inputEditors.values()) editor.refreshSources(); }
  private inputOwner(fiber: any) {
    const seen = new Set();
    while (fiber && !this.owners.has(fiber.uid) && !seen.has(fiber.uid)) { seen.add(fiber.uid); fiber = fiber.parent?.fiber; }
    const owner = this.owners.get(fiber?.uid) || this.activePluginId;
    if (!owner) throw new Error('无法确定插件输入来源的归属');
    return owner;
  }
  registerInputSource(source: InputSource, fiber: any) {
    if (!source || !['/', '@'].includes(source.trigger) || typeof source.name !== 'string' || !source.name
      || typeof source.candidates !== 'function' || typeof source.onPick !== 'function') throw new Error('插件输入来源声明无效');
    const key = `${source.trigger}${source.name}`;
    if (this.inputSources.has(key)) throw new Error(`slash source "${key}" is already registered`);
    const mark = (outcome: any, id: string) => {
      if (outcome?.claim && typeof outcome.claim === 'object') {
        this.claimOwners.set(outcome.claim, source);
        const claim = this.protectedInputClaim(id, outcome.claim); this.claimOwners.set(claim, source);
        return {...outcome, claim};
      }
      return outcome;
    };
    const facade: InputSource = { ...source, candidates: source.candidates.bind(source),
      onPick: pick => mark(source.onPick(pick), pick.session.sessionId),
      ...(source.warm ? { warm: source.warm.bind(source) } : {}),
      ...(source.header ? { header: source.header.bind(source) } : {}),
      ...(source.lexicon ? { lexicon: source.lexicon.bind(source) } : {}),
      ...(source.subscribeLexicon ? { subscribeLexicon: source.subscribeLexicon.bind(source) } : {}),
      ...(source.openReference ? { openReference: source.openReference.bind(source) } : {}),
      ...(source.codec ? {codec: {...source.codec, serialize: async (ref, signal) => {
        const value = await awaitInput(Promise.resolve(source.codec!.serialize(ref, signal)), signal);
        if (this.inputSources.get(key)?.source !== source) throw new Error('引用来源已停用');
        if (typeof value !== 'string') throw new Error('插件引用转换结果不是文字');
        return value;
      }}} : {}),
      ...(source.matchSpace ? { matchSpace: (session, token) => mark(source.matchSpace!(session, token), session.sessionId) } : {}),
      ...(source.matchEnter ? { matchEnter: async (session, line, signal, envelope) => {
        const attempt = this.inputAttempts.get(session.sessionId); if (attempt) attempt.source = source;
        return mark(await source.matchEnter!(session, line, signal, envelope), session.sessionId);
      } } : {}) };
    const registration = { source, facade, owner: this.inputOwner(fiber) }; this.inputSources.set(key, registration);
    for (const controller of this.inputControllers.values()) {
      try { controller.sourceAdded(facade); } catch (error) { console.error(`[plugin-input] ${key} 预热失败`, error); }
    }
    this.refreshInputEditors(); this.notifyInputSources(); this.notify();
    return () => { if (this.inputSources.get(key) === registration) {
      this.cancelInputSource(source); this.inputSources.delete(key);
      for (const controller of this.inputControllers.values()) controller.sourceRemoved(facade);
      for (const row of this.inputClaims.values()) if (row.source === source) row.invalid = true;
      this.refreshInputEditors(); this.notifyInputSources(); this.notify();
    } };
  }
  private cancelInputSource(source: InputSource) {
    for (const attempt of this.inputAttempts.values()) if (attempt.source === source)
      attempt.controller.abort(new Error('插件命令已停用，请重试'));
  }
  private notifyInputSources() { for (const listener of this.inputSourceListeners) listener(); }
  subscribeInputSources(listener: Listener) { this.inputSourceListeners.add(listener); return () => { this.inputSourceListeners.delete(listener); }; }
  setInputDraft(sessionId: string, text: string) {
    const editor = this.inputEditors.get(sessionId);
    const semantic = editor ? JSON.stringify(editor.projection.occurrences) : '';
    if (editor) text = editor.projection.detectText;
    const prior = this.inputDrafts.get(sessionId);
    if (prior?.text === text && (this.inputSemanticKeys.get(sessionId) || '') === semantic) return this.inputShells.get(sessionId)?.snapshot.draftRev ?? prior.revision;
    this.inputSemanticKeys.set(sessionId, semantic);
    this.inputAttempts.get(sessionId)?.controller.abort(new Error('输入已经变化，请重试'));
    const row = this.inputClaims.get(sessionId);
    if (row && !(text.startsWith(row.claim.token) || text === row.claim.token.trimEnd())) this.inputClaims.delete(sessionId);
    const revision = this.inputShells.get(sessionId)?.snapshot.draftRev ?? (prior?.revision || 0) + 1;
    this.inputDrafts.set(sessionId, { text, revision }); return revision;
  }
  subscribeInputConsumer(consumer: (sessionId: string, text: string, edit?: { caret: number; continue?: boolean }) => boolean) {
    this.inputConsumers.add(consumer); return () => { this.inputConsumers.delete(consumer); };
  }
  cancelInput(sessionId: string) {
    const attempt = this.inputAttempts.get(sessionId); if (!attempt) return false;
    attempt.controller.abort(new Error('插件命令已取消')); return true;
  }
  cancelPublicInput(sessionId: string) { this.inputShells.get(sessionId)?.cancelPending(); }
  private consumeDraft(id: string, guard: unknown) {
    const draft = this.inputDrafts.get(id); if (!draft) return false;
    const text = consumeInputToken(draft.text, draft.revision, guard); if (text === undefined) return false;
    const editor = this.inputEditors.get(id);
    if (editor) {
      if (!this.mountedInputEditors.has(id)) return false;
      if ((guard as any).kind === 'bare-token') { editor.clearCommitted(); return true; }
      return editor.replaceText((guard as any).span, '');
    }
    return this.applyDraft(id, text, { caret: text.length });
  }
  private applyDraft(id: string, text: string, edit: { caret: number; continue?: boolean }) {
    const editor = this.inputEditors.get(id);
    if (editor) {
      if (!this.mountedInputEditors.has(id)) return false;
      if (text === '') editor.clearCommitted(); else editor.setPlain(text);
      this.inputClaims.delete(id); editor.refreshClaim(); this.notify(); return true;
    }
    const prior = this.inputDrafts.get(id);
    for (const consumer of this.inputConsumers) if (consumer(id, text, edit)) {
      const row = this.inputClaims.get(id);
      if (row && !(text.startsWith(row.claim.token) || text === row.claim.token.trimEnd())) this.inputClaims.delete(id);
      this.inputDrafts.set(id, { text, revision: (prior?.revision || 0) + 1 }); this.notify(); return true;
    }
    return false;
  }
  private applyInputOutcome(id: string, outcome: any, span: InputSpan): boolean {
    if (outcome === 'handled') return true;
    if (outcome === undefined) return false;
    const draft = this.inputDrafts.get(id); if (!draft) return false;
    if (typeof outcome?.text === 'string') {
      const text = replaceInputSpan(draft.text, draft.revision, span, outcome.text);
      const editor = this.inputEditors.get(id);
      if (editor) return text !== undefined && this.mountedInputEditors.has(id) && editor.replaceText(span, outcome.text);
      return text !== undefined && this.applyDraft(id, text, { caret: span.start + outcome.text.length, continue: outcome.continue === true });
    }
    if (outcome?.claim) {
      const claim = outcome.claim as InputClaim;
      const source = this.claimOwners.get(claim);
      if (!source || this.inputSources.get(`${source.trigger}${source.name}`)?.source !== source) throw new Error('插件命令来源已经变化，请重新选择');
      if (typeof claim.name !== 'string' || !claim.name || typeof claim.token !== 'string' || !claim.token.trim() || typeof claim.submit !== 'function') throw new Error('插件命令声明无效');
      // 官方 beginCommand 只接收行首命令，并去掉命令前的空白。
      // 内联候选不能把正文改成命令；范围和修订号仍按选择时的快照检查。
      if (!span || replaceInputSpan(draft.text, draft.revision, span, claim.token) === undefined
        || draft.text.slice(0, span.start).trim() !== '') return false;
      const text = replaceInputSpan(draft.text, draft.revision, { ...span, start: 0 }, claim.token);
      const editor = this.inputEditors.get(id);
      if (text === undefined || (editor ? !this.mountedInputEditors.has(id) || !(editor.shell ? editor.shell.beginCommand(this.protectedInputClaim(id, claim), span) : editor.replaceText({start: 0, end: span.end}, claim.token)) : !this.applyDraft(id, text, { caret: claim.token.length }))) return false;
      this.inputClaims.set(id, { source, claim });
      editor?.refreshClaim();
      this.notify(); return true;
    }
    if (outcome?.insert) {
      const reference = outcome.insert as ReferenceInsert;
      if (typeof reference.source !== 'string' || !reference.source || typeof reference.ref !== 'string'
        || typeof reference.label !== 'string' || typeof reference.clipboardText !== 'string' || !reference.clipboardText
        || /[\uE100-\uE11D\uFFFC]/u.test(reference.clipboardText)
        || (reference.appearance !== undefined && !['session', 'file', 'folder'].includes(reference.appearance))) throw new Error('插件引用声明无效');
      const editor = this.inputEditors.get(id);
      if (!editor || !this.mountedInputEditors.has(id)) throw new Error('当前引用编辑器没有挂载，输入已保留');
      if (!span || replaceInputSpan(draft.text, draft.revision, span, '') === undefined) return false;
      const applied = editor.insertReference(span, reference); if (applied) editor.refreshSources(); return applied;
    }
    throw new Error('插件输入返回了未知结果，输入已保留');
  }
  inputClaim(id: string) {
    const row = this.inputClaims.get(id); return row ? { name: row.claim.name, hint: row.claim.hint, invalid: row.invalid } : undefined;
  }
  dismissInputMenu(id: string) { this.inputControllers.get(id)?.dismiss(); }
  inputSourcesForLaunch() {
    return [...this.inputSources.values()].sort((a, b) => (a.source.order || 0) - (b.source.order || 0))
      .map(({ source, owner }) => ({ name: source.name, trigger: source.trigger, pluginId: owner }));
  }
  toggleInputSource(id: string, name: string, trigger: '/' | '@') {
    const scope = this.inputScope(id); const editor = this.inputEditors.get(id);
    if (!scope || !editor || !this.mountedInputEditors.has(id)) throw new Error('本会话输入尚未就绪');
    if (this.inputAttempts.has(id)) throw new Error('请等待当前插件输入处理完成');
    if (!this.inputSources.has(`${trigger}${name}`)) throw new Error('此插件输入来源已停用');
    const span = editor.runtime.caretSpan();
    this.inputController(scope).toggleSource(name, { trigger, query: '', quoted: false,
      position: editor.projection.detectText.slice(0, span.start).trim() === '' ? 'leading' : 'inline',
      span: { ...span, draftRev: this.setInputDraft(id, editor.projection.clipboardText) } });
  }
  subscribeInputMenus(listener: (id: string) => void) { this.inputMenuListeners.add(listener); return () => { this.inputMenuListeners.delete(listener); }; }
  inputMenuSnapshot(id: string) {
    const controller = this.inputControllers.get(id); if (!controller) return undefined;
    const state = controller.menu.getSnapshot();
    return { state, launched: state.open && this.launchedInputHits.get(id) === state.hit,
      candidates: this.inputMenuCandidates(state) };
  }
  trackInputMenu(id: string, text: string, caret: number) {
    const scope = this.inputScope(id); if (!scope) return;
    this.inputController(scope).track(this.inputProjection(id, text), this.inputCaret(id, caret),
      { tier: this.inputClaims.has(id) ? 'claimed' : 'plain' }, this.setInputDraft(id, text));
  }
  private inputMenuCandidates(state: ReturnType<InputTriggerController['menu']['getSnapshot']>): RegisteredInputCandidate[] {
    const results: RegisteredInputCandidate[] = []; const trigger = state.hit?.trigger;
    if (!state.open || !trigger) return results;
    for (const group of state.groups) {
      const source = this.inputSources.get(`${trigger}${group.source}`)?.source; if (!source || group.status !== 'ready') continue;
      for (const candidate of group.items) if (typeof candidate?.name === 'string' && candidate.name)
        results.push({ id: `plugin-input:${trigger}${source.name}:${candidate.name}`, source, candidate, position: state.hit!.position });
    }
    return results;
  }
  async inputCandidates(sessionId: string, query: string, start: number, text: string, signal: AbortSignal, trigger: '/' | '@' = '/', caret = start + query.length + 1): Promise<RegisteredInputCandidate[]> {
    if ((this.nativeSession(sessionId) as any)?.runtime !== 'dsh') return [];
    signal.throwIfAborted();
    const scope = this.inputScope(sessionId); if (!scope) return [];
    const controller = this.inputController(scope); const revision = this.setInputDraft(sessionId, text);
    text = this.inputProjection(sessionId, text);
    controller.track(text, caret, { tier: this.inputClaims.has(sessionId) ? 'claimed' : 'plain' }, revision);
    signal.throwIfAborted();
    const generation = controller.menu.getSnapshot().generation;
    const state = await awaitInput(new Promise<ReturnType<typeof controller.menu.getSnapshot>>((resolve, reject) => {
      let off = () => {};
      const check = () => { const state = controller.menu.getSnapshot();
        if (state.generation !== generation) { off(); reject(new Error('输入已经变化，请重新选择')); }
        else if (!state.open || state.groups.every(group => group.status === 'ready')) { off(); resolve(state); }
      };
      off = controller.menu.subscribe(check); signal.addEventListener('abort', off, { once: true });
      const finish = off; off = () => { finish(); signal.removeEventListener('abort', finish); }; check();
    }), signal);
    const results: RegisteredInputCandidate[] = [];
    if (state.hit?.trigger !== trigger) return results;
    for (const group of state.groups) {
      const source = this.inputSources.get(`${trigger}${group.source}`)?.source; if (!source || group.status !== 'ready') continue;
      for (const candidate of group.items) if (typeof candidate?.name === 'string' && candidate.name)
        results.push({ id: `plugin-input:${trigger}${source.name}:${candidate.name}`, source, candidate, position: state.hit.position });
    }
    return results;
  }
  pickInputCandidate(id: string, item: RegisteredInputCandidate, span: InputSpan, action: 'pick' | 'drill' = 'pick') {
    if (this.inputSources.get(`${item.source.trigger}${item.source.name}`)?.source !== item.source) throw new Error('此插件输入来源已停用');
    const draft = this.inputDrafts.get(id);
    if (!draft || draft.revision !== span.draftRev) throw new Error('输入已经变化，请重新选择命令');
    const controller = this.inputControllers.get(id);
    if (!this.inputMenuSnapshot(id)?.launched) controller?.track(draft.text, span.end, { tier: this.inputClaims.has(id) ? 'claimed' : 'plain' }, draft.revision);
    const state = controller?.menu.getSnapshot();
    const group = state?.groups.find(row => row.source === item.source.name);
    const index = group?.items.indexOf(item.candidate) ?? -1;
    if (!controller || !state?.open || state.hit?.span.start !== span.start || state.hit?.span.end !== span.end || group?.status !== 'ready' || index < 0) throw new Error('候选已经变化，请重新选择');
    controller.pick(item.source.name, index, action);
  }
  inputHeaders(id: string) {
    return [...(this.inputControllers.get(id)?.headers.getSnapshot() || new Map())].flatMap(([source, crumbs]) =>
      crumbs.map((crumb: any, index: number) => ({ ...crumb, source, index })));
  }
  pickInputCrumb(id: string, source: string, index: number) { this.inputControllers.get(id)?.pickCrumb(source, index); }
  matchInputSpace(id: string, text: string, caret: number) {
    const scope = this.inputScope(id); if (!scope) return false;
    const controller = this.inputController(scope);
    controller.track(this.inputProjection(id, text), this.inputCaret(id, caret), { tier: this.inputClaims.has(id) ? 'claimed' : 'plain' }, this.setInputDraft(id, text));
    return controller.onSpace();
  }
  async matchInputEnter(id: string, line: string, attachmentInput: number | import('./inputTriggers').InputAttachmentSubmission = 0, onNotice?: (text: string) => void) {
    const attachments = typeof attachmentInput === 'number' ? attachmentInput : attachmentInput.count;
    const submission = typeof attachmentInput === 'number' ? undefined : attachmentInput;
    const assertAttachments = () => { if (submission && !submission.current()) throw new Error('附件或会话已经变化，输入已保留'); };
    if ((this.nativeSession(id) as any)?.runtime !== 'dsh') return false;
    line = this.inputEditors.get(id)?.projection.detectText.trim() ?? line;
    if (!line.startsWith('/') && !line.startsWith('@') && !this.inputClaims.has(id)) return false;
    if (this.inputAttempts.has(id)) throw new Error('上一个插件命令仍在处理');
    const controller = new AbortController(); const attempt: { controller: AbortController; source?: InputSource } = { controller };
    this.inputAttempts.set(id, attempt);
    const revision = this.inputDrafts.get(id)?.revision;
    try {
      assertAttachments();
      let row = this.inputClaims.get(id);
      if (!row) {
      const scope = this.inputScope(id); if (!scope) return false;
      const result = await awaitInput(this.inputController(scope).adjudicate(line, controller.signal, { attachments }), controller.signal);
      if (this.inputDrafts.get(id)?.revision !== revision) throw new Error('输入已经变化，请重试');
      if (result === undefined) return false;
      const source = attempt.source;
      if (!source || this.inputSources.get(`${source.trigger}${source.name}`)?.source !== source) throw new Error('命令或输入已经变化，请重试');
      if (!(result as any)?.claim) {
        const draft = this.inputDrafts.get(id)!;
        return this.applyInputOutcome(id, result, { start: 0, end: draft.text.length, draftRev: draft.revision });
      }
      row = { source, claim: (result as any).claim };
      if (typeof row.claim.name !== 'string' || !row.claim.name || typeof row.claim.token !== 'string' || !row.claim.token.trim() || typeof row.claim.submit !== 'function') throw new Error('插件命令声明无效');
      this.inputClaims.set(id, row);
      }
      if (row.invalid || this.inputSources.get(`${row.source.trigger}${row.source.name}`)?.source !== row.source) throw new Error('此插件命令已停用，请重新选择');
      attempt.source = row.source;
      if (attachments && !row.claim.attachments) throw new Error('此插件命令不接收附件，输入已保留');
      if (attachments && !submission) throw new Error('附件尚未准备好，输入已保留');
      const prepared = attachments ? await awaitInput(submission!.serialize(controller.signal), controller.signal) : [];
      assertAttachments();
      if (prepared.length !== attachments) throw new Error('附件转换不完整，输入已保留');
      const original = this.inputDrafts.get(id)!;
      const encoded = await this.encodeInputDraft(id, controller.signal);
      const draft = (encoded?.text ?? line).trimStart(); const token = row.claim.token;
      const base = token.trimEnd();
      const args = draft.startsWith(token) ? draft.slice(token.length)
        : draft.startsWith(base) ? draft.slice(base.length).replace(/^\s/, '') : '';
      assertAttachments();
      const result = await awaitInput(Promise.resolve().then(() => { controller.signal.throwIfAborted(); assertAttachments();
        return row!.claim.submit(args, this.inputScope(id), prepared); }), controller.signal);
      if (result?.kind !== 'success') throw new Error(result?.text || '插件命令执行失败，输入已保留');
      if (result.text !== undefined && typeof result.text !== 'string') throw new Error('插件命令返回的提示无效，输入已保留');
      if (this.inputDrafts.get(id)?.revision !== original.revision) throw new Error('输入已经变化，请重试');
      assertAttachments();
      if (!this.applyDraft(id, '', { caret: 0 })) throw new Error('当前输入框已切换，命令输入未消费');
      submission?.consume();
      this.inputClaims.delete(id); if (result.text) onNotice?.(result.text); this.notify(); return true;
    } finally { if (this.inputAttempts.get(id) === attempt) this.inputAttempts.delete(id); }
  }

  private async encodeInputDraft(id: string, signal: AbortSignal) {
    const editor = this.inputEditors.get(id); if (!editor) return undefined;
    if (!this.mountedInputEditors.has(id)) throw new Error('当前引用编辑器已切换，输入已保留');
    const snapshot = editor.snapshot(); const revision = this.inputDrafts.get(id)?.revision;
    const scope = this.inputScope(id); if (!scope) throw new Error('引用所属会话已关闭');
    const controller = this.inputController(scope); let cursor = 0; const pieces: string[] = [];
    const owners = new Map(snapshot.references.map(ref => [ref.source, [...this.inputSources.values()].find(row => row.source.name === ref.source)?.source]));
    for (const ref of snapshot.references) {
      signal.throwIfAborted(); if (ref.invalid) throw new Error(`引用来源已不可用：${ref.source}`);
      pieces.push(snapshot.text.slice(cursor, ref.offset));
      const text = await awaitInput(controller.serializeReference(ref.source, ref.ref, signal), signal);
      if (typeof text !== 'string') throw new Error(`插件引用转换结果不是文字：${ref.source}`);
      pieces.push(text); cursor = ref.offset + ref.length;
    }
    signal.throwIfAborted();
    if (!this.mountedInputEditors.has(id) || this.inputDrafts.get(id)?.revision !== revision || this.inputEditors.get(id) !== editor
      || [...owners].some(([name, source]) => [...this.inputSources.values()].find(row => row.source.name === name)?.source !== source)) throw new Error('引用或输入已经变化，请重试');
    pieces.push(snapshot.text.slice(cursor)); return { text: pieces.join(''), clipboardText: snapshot.text, references: snapshot.references };
  }
  async serializeInputDraft(id: string) {
    if (this.inputAttempts.has(id)) throw new Error('上一个插件输入仍在处理');
    const attempt = { controller: new AbortController() }; this.inputAttempts.set(id, attempt);
    try { return await this.encodeInputDraft(id, AbortSignal.any([attempt.controller.signal, AbortSignal.timeout(30000)])); }
    finally { if (this.inputAttempts.get(id) === attempt) this.inputAttempts.delete(id); }
  }

  /** 未实现的服务：未知方法记名后明确报错。 */
  private stubService(name: string, methods: Record<string, unknown>) {
    return new Proxy(methods, {
      get: (target, prop) => {
        const key = String(prop);
        if (key in target) return target[key];
        if (key === "then" || typeof prop === "symbol") return undefined;
        return (..._args: unknown[]) => {
          this.noteMissingCall(name, key);
          return this.unsupported(`${name}.${key}`);
        };
      },
    });
  }

  private noteMissingCall(service: string, method: string) {
    const record = this.records.find(record => record.id === this.activePluginId) ?? this.records.at(-1);
    const key = `${service}.${method}`;
    if (record && !record.missingCalls.includes(key)) record.missingCalls.push(key);
  }

  private createNativeViewRuntime() {
    const runtime = new SessionViewRuntime((stage, error, detail) => {
      console.warn(`[plugin-view] ${stage} 失败：`, String((error as any)?.message || error), detail ?? '');
    });
    for (const definition of this.uiConversation.views.entries()) runtime.registerView(definition);
    for (const definition of this.uiConversation.events.entries()) runtime.registerEvent(definition);
    return runtime;
  }

  /** 每个 DSH 绑定保留自己的权威历史；相同记录不触发替换，正常增长按原样事件追加。 */
  ingestSessionEvents(events: any[], sessionId: string, expectedBinding?: {sessionId: string}): boolean {
    const id = String(sessionId || ''); if (!id || this.disposed) return false;
    const binding = this.sessionBinding(id);
    if (expectedBinding && binding !== expectedBinding) return false;
    // An opened original Session owns its paged window; full legacy snapshots cannot overwrite it.
    if (binding?.history && binding.history.session.getSnapshot().openState !== 'cold') return false;
    if (!binding) {
      if ((this.nativeSession(id) as any)?.runtime === 'dsh' || this.subagent(id)) return false;
      const runtime = this.createNativeViewRuntime(); runtime.ingest(events);
      this.nativeViews.set(id, {runtime, events}); this.notify(); return true;
    }
    if (!Array.isArray(events)) throw new Error('DSH 历史记录必须是事件数组');
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (!event || typeof event.type !== 'string' || !Number.isSafeInteger(event.seq) || event.seq < 0
        || (index > 0 && event.seq !== events[index - 1].seq + 1)) throw new Error('DSH 历史事件次序不连续');
    }
    const keys = events.map(event => JSON.stringify(event));
    const previous = binding.eventKeys;
    const extendsPrevious = previous.length <= keys.length && previous.every((key, index) => key === keys[index]);
    if (extendsPrevious && previous.length === keys.length) return true;
    const entries = events.map(event => ({type:'event' as const, event}));
    if (extendsPrevious && previous.length > 0) {
      for (const entry of entries.slice(previous.length)) binding.eventSource.append(entry);
    } else binding.eventSource.replace(entries, events.length > 0 && events[0].seq > 0);
    binding.eventKeys = keys;
    this.notify();
    return true;
  }

  /** 壳层挂载所选页面时激活目标，避免在 React 渲染期间发布订阅更新。 */
  async openSessionHistory(sessionId: string) {
    const binding = this.sessionBinding(sessionId);
    if (!binding?.history) throw new Error('DSH 会话不可用');
    await binding.history.open();
  }
  sessionHistorySnapshot(sessionId: string) {return this.sessionBinding(sessionId)?.history?.session.getSnapshot();}
  sessionHistoryControlError(sessionId:string) {return this.sessionBinding(sessionId)?.history?.errors.getSnapshot();}
  sessionHistoryProjections(sessionId:string) {return this.sessionBinding(sessionId)?.history?.session.projections.values();}
  acceptSessionHistoryState(sessionId: string, value:any, expectedBinding?: {sessionId:string}): boolean {
    const binding = this.sessionBinding(sessionId);
    if (!binding?.history || (expectedBinding && binding !== expectedBinding)) return false;
    if (value.projections) binding.history.session.projections.seed(value.projections);
    binding.history.session.handleRunning(value.running === true);
    return true;
  }
  activateSessionView(sessionId: string, target: string): void {
    const binding = this.sessionBinding(String(sessionId || '')); if (!binding || !target) return;
    const view = this.uiConversation.binding(binding);
    if (!binding.stopView) binding.stopView = view.snapshot.subscribe(() => this.notify());
    view.activate(target);
  }

  /** 返回确切会话的官方装配快照。 */
  sessionViewSnapshots(sessionId: string): {get(target: string): any} {
    const binding = this.sessionBinding(String(sessionId || ''));
    if (!binding) return this.nativeViews.get(sessionId)?.runtime.snapshots() ?? new Map();
    const view = this.uiConversation.binding(binding);
    if (!binding.stopView) binding.stopView = view.snapshot.subscribe(() => this.notify());
    return view.snapshot.getSnapshot().views;
  }

  /** 当前已装配的视图 target（调试与测试用） */
  sessionViewTargets(): string[] {
    return this.uiConversation.views.entries().map(definition => definition.target);
  }

  /** 已登记的对话事件/视图定义（调试与测试用） */
  conversationPartsOf(kind: string): unknown[] {
    return [...(kind === 'events' ? this.uiConversation.events.entries() : kind === 'views' ? this.uiConversation.views.entries() : [])];
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  /** slots.inject：只有当宿主提供该插槽时才执行注册回调 */
  private injectSlot(name: string, factory: () => unknown) {
    const slot = String(name || "");
    if (!this.availableSlots.has(slot)) return () => undefined;
    const dispose = factory();
    return typeof dispose === "function" ? (dispose as () => void) : () => undefined;
  }

  /** slots.register：登记一个界面贡献 */
  private registerSlot(meta: SlotMeta, component: unknown) {
    const slot = String(meta?.name || "");
    if (!slot) return () => undefined;
    const contribution: SlotContribution = { slot, meta: { ...meta }, component, sequence: this.sequence++, ...(this.activePluginId ? { pluginId: this.activePluginId } : {}) };
    // 同一个插件可能被登记两次：内置插件开机自动加载后，用户又在插件页点了「加载界面半边」，
    // 或者同一个 bundle 被作为依赖模块和插件入口各加载一次。不去重的话界面上会出现
    // **两个一模一样的标签**（实测「对话 | 轨迹 | 轨迹」）。按 (slot, key) 去重，后来的替换先前的。
    const key = String(meta?.key ?? meta?.id ?? "");
    const list = (this.contributions.get(slot) || []).filter((item) => {
      if (!key) return true;
      return String(item.meta?.key ?? item.meta?.id ?? "") !== key || item.pluginId !== contribution.pluginId;
    });
    list.push(contribution);
    this.contributions.set(slot, list);
    const record = this.records.find(record => record.id === contribution.pluginId);
    if (record && !record.slots.includes(slot)) record.slots.push(slot);
    this.notify();
    return () => {
      const current = this.contributions.get(slot) || [];
      this.contributions.set(slot, current.filter((item) => item !== contribution));
      this.notify();
    };
  }

  registerOwnedSlot(meta: SlotMeta, component: unknown, fiber: any) {
    const caller = fiber;
    const seen = new Set();
    while (fiber && !this.owners.has(fiber.uid) && !seen.has(fiber.uid)) { seen.add(fiber.uid); fiber = fiber.parent?.fiber; }
    const owner = this.owners.get(fiber?.uid) || this.activePluginId;
    if (!owner) throw new Error('无法确定插件界面的归属');
    if (caller?.uid != null && !this.owners.has(caller.uid)) this.owners.set(caller.uid, owner);
    const previous = this.activePluginId; this.activePluginId = owner;
    try { return this.registerSlot(meta, component); } finally { this.activePluginId = previous; }
  }

  /** locale.register：兼容 register(ns, {zh,en}) 与 register(ns, 语言, 词表) 两种形态 */
  private registerLocale(ns: string, a: unknown, b?: unknown) {
    const key = String(ns || "");
    const table: Record<string, Record<string, unknown>> = {};
    if (b === undefined && a && typeof a === "object") {
      for (const [lang, dict] of Object.entries(a as Record<string, unknown>)) {
        table[lang] = { ...(table[lang] || {}), ...(dict as Record<string, unknown>) };
      }
    } else if (typeof a === "string") {
      table[a] = { ...(table[a] || {}), ...((b as Record<string, unknown>) || {}) };
    }
    const entry = { ns: key, owner: this.activePluginId, table };
    this.localeEntries.add(entry);
    this.rebuildLocales();
    return () => { this.localeEntries.delete(entry); this.rebuildLocales(); };
  }

  private rebuildLocales() {
    this.dictionaries.clear();
    for (const entry of this.localeEntries) {
      const table = this.dictionaries.get(entry.ns) || {};
      for (const [lang, dict] of Object.entries(entry.table)) table[lang] = { ...(table[lang] || {}), ...dict };
      this.dictionaries.set(entry.ns, table);
    }
    this.notify();
  }

  /** locale.bind(ns)：返回 t(key, params) */
  private bindLocale(ns: string) {
    const key = String(ns || "");
    return (text: string, params?: Record<string, unknown>) => {
      const table = this.dictionaries.get(key) || {};
      const dict = table[this.localeCode] || table.zh || table.en || {};
      let value = String(dict[text] ?? text);
      if (params) {
        for (const [name, replacement] of Object.entries(params)) {
          value = value.replace(new RegExp(`\\{${name}\\}`, "g"), String(replacement));
        }
      }
      return value;
    };
  }

  /**
   * 加载一个插件（bundle 的 module.exports）。
   * 失败记录在返回值里，不向上抛：第三方代码出错不该带崩宿主界面。
   */
  async load(plugin: any, id: string): Promise<PluginLoadRecord> {
    const record: PluginLoadRecord = { id: String(id || plugin?.name || ""), ok: false, slots: [], missingCalls: [] };
    this.records.push(record);
    const previousActive = this.activePluginId;
    this.activePluginId = record.id;
    try {
      const fiber = this.ctx.plugin(plugin as any);
      if (fiber.uid != null) this.owners.set(fiber.uid, record.id);
      this.fibers.push(fiber);
      const list = this.fibersById.get(record.id) || [];
      list.push(fiber);
      this.fibersById.set(record.id, list);
      // cordis 的 plugin 是异步生效的：fiber 是 thenable，await 到它就代表启动完成
      await Promise.resolve(fiber);
      if (fiber.state !== 2) throw new Error("插件界面尚未启动，所需能力未就绪");
      if (record.missingCalls.length) throw new Error(`插件界面需要未支持能力：${record.missingCalls.join("、")}`);
      record.ok = true;
    } catch (error: any) {
      record.error = String(error?.message || error);
    } finally {
      this.activePluginId = previousActive;
    }
    return record;
  }

  /**
   * 卸载一个插件的客户端半边：停用它登记的插槽贡献、停掉它的 fiber。
   *
   * 为什么必须有：插件里 `slots.inject(name, () => slots.register(...))` 的注销函数
   * 没有被登记成 cordis effect，fiber 停掉时贡献仍留在插槽表里——插件页点「停用」后
   * 标签还在（实测就是这个），必须由宿主按插件 id 回收。
   */
  async unload(id: string): Promise<boolean> {
    const key = String(id || "");
    if (!key) return false;
    const fibers = this.fibersById.get(key) || [];
    for (const fiber of fibers) {
      try {
        await Promise.resolve(fiber?.dispose?.());
      } catch {
        // fiber 已经停了：继续收贡献
      }
    }
    this.fibersById.delete(key);
    for (const [sourceKey, registration] of this.inputSources) if (registration.owner === key) {
      this.cancelInputSource(registration.source); this.inputSources.delete(sourceKey);
    }
    this.notifyInputSources();
    for (const [uid, owner] of this.owners) if (owner === key) this.owners.delete(uid);
    for (const entry of this.localeEntries) if (entry.owner === key) this.localeEntries.delete(entry);
    this.rebuildLocales();
    let removed = 0;
    for (const [slot, list] of this.contributions) {
      const kept = list.filter((item) => item.pluginId !== key);
      removed += list.length - kept.length;
      if (kept.length) this.contributions.set(slot, kept);
      else this.contributions.delete(slot);
    }
    const recordIndex = this.records.findIndex((item) => item.id === key);
    if (recordIndex >= 0) this.records.splice(recordIndex, 1);
    if (removed || fibers.length) this.notify();
    await this.dshSettings.refresh();
    return removed > 0 || fibers.length > 0;
  }

  /** 当前登记了界面贡献的插件 id（诊断与测试用） */
  pluginIdsWithContributions(): string[] {
    const ids = new Set<string>();
    for (const list of this.contributions.values()) {
      for (const item of list) if (item.pluginId) ids.add(item.pluginId);
    }
    return [...ids];
  }

  records_(): PluginLoadRecord[] {
    return this.records.map((record) => ({ ...record, slots: [...record.slots], missingCalls: [...record.missingCalls] }));
  }

  contributionsFor(slot: string): SlotContribution[] {
    const list = [...(this.contributions.get(String(slot)) || [])];
    return list.sort((a, b) => {
      const orderA = Number(a.meta.order ?? 0);
      const orderB = Number(b.meta.order ?? 0);
      if (orderA !== orderB) return orderA - orderB;
      const priorityA = Number(a.meta.priority ?? 0);
      const priorityB = Number(b.meta.priority ?? 0);
      if (priorityA !== priorityB) return priorityB - priorityA;
      return a.sequence - b.sequence;
    });
  }

  slotNames(): string[] {
    return [...this.contributions.keys()];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if(this.catalogRefreshTimer){clearTimeout(this.catalogRefreshTimer);this.catalogRefreshTimer=undefined;}
    this.mainSessionReference?.release();this.mainSessionReference=undefined;
    this.searchLifetime.abort(new Error('插件客户端已关闭'));
    await this.mutationClient?.dispose();this.pendingNativeRows.clear();this.observedBirthRows.clear();
    await this.catalogClient?.dispose();
    this.disposed = true;
    await this.dshSettings.dispose();
    this.contributorCleanup();
    // 卸载插件 fiber（cordis 的 fiber 自带 dispose）
    for (const fiber of this.fibers.splice(0)) {
      try {
        await fiber?.dispose?.();
      } catch {
        // 第三方插件卸载异常不该影响宿主
      }
    }
    this.owners.clear();
    await this.ctx.fiber.dispose();
  }

  private contributorCleanup = () => {
    for (const dispose of this.inputMenuDisposers.values()) dispose();
    this.inputMenuDisposers.clear(); this.inputMenuListeners.clear(); this.launchedInputHits.clear();
    for (const editor of this.inputEditors.values()) editor.dispose();
    this.inputEditors.clear();
    for (const [id, shell] of this.inputShells) { shell.dispose(); this.conversation.releaseSession(id); }
    this.inputShells.clear(); this.inputFaces.clear();
    for (const id of this.sessionBindings.keys()) this.releaseSessionBinding(id);
    for(const client of this.sessionClients.values())void client.dispose().catch(()=>{});
    this.sessionClients.clear();
    for(const observer of this.retentionObservers.values()){observer.off?.();for(const listener of observer.listeners)listener();observer.listeners.clear();}
    this.retentionObservers.clear();
    this.inputSubmit = undefined; this.nativeAttachments = undefined;
    for (const stop of this.inputInboxStops.values()) stop();this.inputInboxStops.clear();this.inputInboxes.clear();
    this.inputQueueListeners.clear();
    this.mountedInputEditors.clear(); this.inputSemanticKeys.clear(); this.inputEditorErrors.clear();
    this.contributions.clear();
    this.inputSources.clear(); this.inputSourceListeners.clear(); this.inputDrafts.clear(); this.inputConsumers.clear(); this.inputScopes.clear();
    for (const controller of this.inputControllers.values()) controller.dispose();
    this.inputControllers.clear(); this.inputEpochs.clear(); this.inputClaims.clear();
    for (const attempt of this.inputAttempts.values()) attempt.controller.abort(new Error('插件界面已关闭'));
    this.inputAttempts.clear();
    this.families.clear(); this.familyRequests.clear();this.familyRequestEpochs.clear();this.familyRefreshAgain.clear();
    this.nativeViews.clear();
    this.listeners.clear();
  };
}
