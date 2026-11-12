import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { BrowserControlOverlay } from '../../src/BrowserControlOverlay';
import '../../src/styles/browser-panel.css';
import type { BrowserControlState } from '../../src/types';

function Fixture() {
  const [release, setRelease] = useState<'pending' | 'ready' | 'failed'>('pending');
  const [status, setStatus] = useState<'human_control' | 'stopped'>('human_control');
  (window as any).setTestRelease = setRelease;
  (window as any).setTestStatus = setStatus;
  const state: BrowserControlState = { status, inputReleaseState: release, controlSessionId: 'test', ownerSessionId: 'test', runId: 'test', tabId: 'test', webContentsId: 1, leaseEpoch: 1, actionText: '', pauseReason: '', elapsedMs: 0 };
  return <div style={{ position: 'relative', width: 900, height: 450, background: '#e5e7eb' }}><BrowserControlOverlay controlState={state} activeTabId="test" /></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
