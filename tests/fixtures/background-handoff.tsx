import { createRoot } from 'react-dom/client';
import { BackgroundBrowserHandoff } from '../../src/features/browser/BackgroundBrowserHandoff';
import '../../src/styles/browser-panel.css';

let listener: ((entries: any[]) => void) | undefined;
let entry = { id: 'test-id', ownerSessionId: 'test-session', state: 'waiting', reason: '需要完成验证', filePending: false };
const notify = () => listener?.([entry]);
(window as any).dyworker = {
  listBackgroundBrowserHandoffs: async () => [entry],
  onBackgroundBrowserHandoffs: (callback: typeof listener) => { listener = callback; return () => { listener = undefined; }; },
  showBackgroundBrowserHandoff: async () => { entry = { ...entry, state: 'human', filePending: true }; notify(); return { ok: true }; },
  chooseBackgroundBrowserFile: async () => { entry = { ...entry, filePending: false }; notify(); return { ok: true }; },
  readyBackgroundBrowserHandoff: async () => { entry = { ...entry, state: 'ready' }; notify(); return { ok: true, ownerSessionId: 'test-session', runId: 'resumed-run' }; },
  discardBackgroundBrowserHandoff: async () => { listener?.([]); return { ok: true }; },
};
createRoot(document.getElementById('root')!).render(<BackgroundBrowserHandoff sessionId="test-session" running={false}
  onContinue={async (_prompt, owner, run) => { document.body.dataset.resumed = `${owner}:${run}`; }} />);
