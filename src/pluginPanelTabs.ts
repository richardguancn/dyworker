export type PluginPanelTab = {
  id: string;
  kind: 'plugin';
  title: string;
  pluginId: string;
  pluginKey: string;
};

type PanelTab = { id: string; kind: string; title: string; pluginId?: string; pluginKey?: string };
type Contribution = { pluginId?: string; meta: Record<string, unknown> };
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
const CLOSED_PANELS_KEY = 'dyworker:closed-plugin-panels:v1';

export function pluginPanelTab(pluginId: string, key: string, title: string): PluginPanelTab {
  return { id: `plugin-${encodeURIComponent(pluginId)}-${encodeURIComponent(key)}`,
    kind: 'plugin', title, pluginId, pluginKey: key };
}

export function availablePluginPanels(contributions: Contribution[]): PluginPanelTab[] {
  const panels = new Map<string, PluginPanelTab>();
  for (const contribution of contributions) {
    const key = String(contribution.meta.key ?? contribution.meta.id ?? '').trim();
    if (!key) continue;
    const label = contribution.meta.label;
    const panel = pluginPanelTab(contribution.pluginId || '', key,
      String(typeof label === 'function' ? label() : label ?? key));
    if (!panels.has(panel.id)) panels.set(panel.id, panel);
  }
  return [...panels.values()];
}

/** 关闭是用户选择；插槽刷新、任务切换和重启都不能撤销。只有主动打开才撤销。 */
export class PluginPanelPreferences {
  private closed = new Set<string>();
  private storage: PreferenceStorage;

  constructor(storage: PreferenceStorage) {
    this.storage = storage;
    try {
      const saved: unknown = JSON.parse(storage.getItem(CLOSED_PANELS_KEY) || '[]');
      if (Array.isArray(saved)) this.closed = new Set(saved.filter((id): id is string => typeof id === 'string'));
    } catch { /* 损坏的偏好不影响面板使用 */ }
  }

  close(panel: PanelTab): void {
    if (panel.kind !== 'plugin') return;
    this.closed.add(pluginPanelTab(panel.pluginId || '', panel.pluginKey || '', panel.title).id);
    this.save();
  }

  open(panel: PluginPanelTab, explicit = true): boolean {
    if (!explicit) return !this.closed.has(panel.id);
    this.closed.delete(panel.id);
    this.save();
    return true;
  }

  reconcile<T extends PanelTab>(current: T[], available: PluginPanelTab[]): Array<T | PluginPanelTab> {
    const next: Array<T | PluginPanelTab> = [];
    for (const tab of current) {
      if (tab.kind !== 'plugin') { next.push(tab); continue; }
      const panel = available.find(panel => tab.pluginKey === panel.pluginKey && (tab.pluginId || '') === panel.pluginId);
      if (panel && !this.closed.has(panel.id) && !next.some(tab => tab.id === panel.id)) next.push({ ...tab, ...panel });
    }
    // 每个插件的每个页面最多一个标签，且保留其它面板的内容。
    for (const panel of available) {
      if (this.closed.has(panel.id) || next.some(tab => tab.id === panel.id)) continue;
      next.push(panel);
    }
    return next;
  }

  private save(): void {
    try { this.storage.setItem(CLOSED_PANELS_KEY, JSON.stringify([...this.closed])); }
    catch { /* 存储不可用时仍在本次运行中记住关闭选择 */ }
  }
}
