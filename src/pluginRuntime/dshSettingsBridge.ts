import { Context } from '@deepseek-ai/cordis';
import { ConfigForms, type ConfigForm } from './vendor/dsh-settings/config-form.js';
import { SettingsDescribeMirror } from './vendor/dsh-settings/settings-mirror.js';
import { SettingsSchemaService } from './vendor/dsh-settings/schema.js';

type Transport = (payload: { sessionId: string; action: string; payload?: unknown }) => Promise<any>;
const unavailable = Object.freeze({ status: 'unavailable', value: undefined, writable: false, mode: 'host' });

/** 选择会话只切换读取来源；每个在途写入绑定发起时的会话。 */
export class DshSettingsBridge {
  private selected = '';
  private current?: { ctx: Context; forms: ConfigForms; mirror: SettingsDescribeMirror };
  private readonly listeners = new Set<() => void>();
  private readonly bindings = new Map<string, ConfigForm>();
  private readonly subscriptions = new Map<string, () => void>();
  private readonly transport: Transport;
  constructor(transport: Transport) { this.transport = transport; }
  private notify() { for (const listener of [...this.listeners]) { try { listener(); } catch (error) { console.error('[DSH settings] subscriber failed', error); } } }
  setSession(sessionId: string) {
    if (sessionId === this.selected) { void this.current?.mirror.ensure(); return; }
    const previous = this.current;
    this.current = undefined; this.selected = sessionId;
    for (const off of this.subscriptions.values()) off(); this.subscriptions.clear();
    void previous?.ctx.fiber.dispose();
    if (sessionId) {
      const ctx = new Context();
      const invoke = (action: string, payload?: unknown) => this.transport({ sessionId, action, payload });
      ctx.provide('remote', { settings: {
        describe: async () => { const response = await invoke('settings-describe'); return response.ok
          ? { ok: true, value: { namespaces: response.value, writable: true, hasDocument: true } } : response; },
        mutate: async (namespace: string, ops: unknown[], revision?: number) => {
          const response = await invoke('settings-mutate', { namespace, ops, revision });
          if (!response.ok) return response;
          const value = response.value.find((row: any) => row.ns === namespace);
          return value ? { ok: true, value } : { ok: false, error: { message: '插件设置已不再可用' } };
        },
      } });
      const mirror = new SettingsDescribeMirror(ctx);
      const schema = new SettingsSchemaService(ctx);
      const forms = new ConfigForms(ctx, { mirror, schema, persistence: 'host' });
      this.current = { ctx, mirror, forms };
      mirror.subscribe(() => this.notify());
      for (const namespace of this.bindings.keys()) this.attach(namespace);
      void mirror.ensure();
    }
    this.notify();
  }
  sessionId() { return this.selected; }
  async refresh() { await this.current?.mirror.load(); }
  private attach(namespace: string) {
    if (!this.current || this.subscriptions.has(namespace)) return;
    this.subscriptions.set(namespace, this.current.forms.get(namespace).subscribe(() => this.notify()));
  }
  get(namespace: string): ConfigForm {
    let form = this.bindings.get(namespace);
    if (form) return form;
    form = {
      getSnapshot: () => this.current?.forms.get(namespace).getSnapshot() ?? unavailable,
      subscribe: listener => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; },
      set: (field, value) => this.current?.forms.get(namespace).set(field, value) ?? Promise.resolve(false),
      unset: field => this.current?.forms.get(namespace).unset(field) ?? Promise.resolve(false),
      mutate: (ops, revision) => this.current?.forms.get(namespace).mutate(ops, revision) ?? Promise.resolve(false),
    };
    this.bindings.set(namespace, form); this.attach(namespace); return form;
  }
  whileServed(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) {
    let off: (() => void) | undefined;
    const sync = () => {
      const served = new Set<string>(this.current?.mirror.getSnapshot().view?.namespaces.map((row: any) => row.ns) ?? []);
      if (namespaces.some(namespace => served.has(namespace))) { off ??= register(served); }
      else { off?.(); off = undefined; }
    };
    this.listeners.add(sync); sync();
    return () => { this.listeners.delete(sync); off?.(); off = undefined; };
  }
  async dispose() {
    const previous = this.current; this.setSession(''); this.bindings.clear(); this.listeners.clear();
    await previous?.ctx.fiber.dispose();
  }
}
