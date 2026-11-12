import { applyBrowserPanelSwitch } from '../../src/state/browserPanelSwitch';

const api = (window as any).switchTest;
const pages = ['one', 'two'].map(id => document.getElementById(id) as any);
let active = 'one', hold = false, held: any = null;
const report = () => {
  const tabs = pages.map(page => ({ id: page.id, title: page.id, url: page.getURL(), active: page.id === active, webContentsId: page.getWebContentsId() }));
  api.reportTabs(tabs);
  api.reportActive(tabs.find(tab => tab.active)!.webContentsId);
};
const handle = (request: any) => applyBrowserPanelSwitch(request, () => 'one', api.validate, tabId => { active = tabId; report(); });
api.onRequest((request: any) => {
  if (request.action !== 'activate') return;
  if (hold) { held = request; return; }
  void handle(request);
});
(window as any).switchState = () => ({ active, held: Boolean(held) });
(window as any).holdSwitch = () => { hold = true; };
(window as any).releaseSwitch = async () => { const request = held; held = null; hold = false; if (request) await handle(request); };
Promise.all(pages.map(page => new Promise<void>(resolve => page.addEventListener('dom-ready', () => resolve(), { once: true })))).then(() => {
  report();
  (window as any).switchFixtureReady = true;
});
