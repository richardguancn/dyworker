export async function applyBrowserPanelSwitch(
  request: { token?: string; ownerSessionId?: string; tabId?: string },
  currentOwner: () => string,
  validate: (request: { token: string; ownerSessionId: string; tabId: string }) => Promise<boolean>,
  activate: (tabId: string) => void,
) {
  const token = String(request.token || ''), ownerSessionId = String(request.ownerSessionId || ''), tabId = String(request.tabId || '');
  if (!token || !tabId || ownerSessionId !== currentOwner()) return false;
  try {
    if (!await validate({ token, ownerSessionId, tabId }) || ownerSessionId !== currentOwner()) return false;
    activate(tabId);
    return true;
  } catch { return false; }
}
