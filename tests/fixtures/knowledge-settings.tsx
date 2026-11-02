import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsDialog } from '../../src/features/settings/SettingsDialog';
import { clientHost } from '../../src/pluginRuntime/clientHostSingleton';
import knowledge from '../../builtin-plugins/dyworker-knowledge-base/src/client';
import { updateDraft } from '../../src/appearance/controller';
import '../../src/styles.css';
import '../../src/layout.css';

if (new URLSearchParams(location.search).get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
(window as any).dyworker = { exportKnowledge: async (body: unknown) => (await fetch('/api/kb/preview-export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() };
await clientHost().load(knowledge, 'dyworker-knowledge-base');
const noop = () => {};
const props: any = { sidebarWidth: 200, value: { endpoint: '', model: '', apiKey: '', profiles: [], mcpServers: [], channels: {} }, onClose: noop,
  onSave: async () => true, saveErrorRef: { current: '' }, memories: [], onDeleteMemory: noop, onEditMemory: noop, onLintMemories: noop,
  memoriesLinting: false, memoriesLintMessage: '', skills: [], onToggleSkill: noop, onDeleteSkill: noop, onEditSkill: noop,
  onRefreshSkills: noop, onOpenSkill: noop, onCreateSkill: noop, schedules: [], workspaceReady: false, approvalMode: 'interactive',
  onSaveSchedule: async () => true, onToggleSchedule: noop, onDeleteSchedule: noop, onTriggerSchedule: noop, usageRecords: [],
  onClearUsage: noop, appUpdate: {}, onCheckUpdate: noop, onCreatePlugin: noop };
function Fixture() {
  const [tab, setTab] = useState<any>('model');
  useEffect(() => { if (new URLSearchParams(location.search).get('theme') === 'dark') updateDraft(current => ({ ...current, theme: 'dark' })); }, []);
  return <SettingsDialog {...props} tab={tab} onTabChange={setTab} />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
