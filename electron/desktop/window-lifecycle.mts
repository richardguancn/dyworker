// 后台浏览器窗口不是用户可见的应用窗口。
const backgroundWindows = new WeakSet<object>();

export function markBackgroundWindow(window: object) {
  backgroundWindows.add(window);
}

export function unmarkBackgroundWindow(window: object) {
  backgroundWindows.delete(window);
}

export function needsMainWindow(window: any) {
  return !window || window.isDestroyed();
}

export function onlyBackgroundWindowsRemain(windows: any[]) {
  const remaining = windows.filter(window => !window.isDestroyed());
  return remaining.length > 0 && remaining.every(window => backgroundWindows.has(window));
}
