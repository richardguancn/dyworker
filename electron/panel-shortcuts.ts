export type PanelShortcut = 'browser' | 'files' | 'terminal' | 'review' | 'chat';

export interface PanelKeyInput {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}

// Option+S 在 macOS 上的 key 可能是 ß；优先使用物理键位。
export function resolvePanelShortcut(input: PanelKeyInput, platform: string): PanelShortcut | undefined {
  if (input.isComposing) return;
  const key = /^Key[A-Z]$/.test(input.code || '') ? input.code!.slice(3).toLowerCase() : input.key.toLowerCase();
  const mac = platform === 'darwin';
  const mod = mac ? input.metaKey && !input.ctrlKey : input.ctrlKey && !input.metaKey;
  if (input.ctrlKey && !input.metaKey && !input.altKey && !input.shiftKey
    && (input.code === 'Backquote' || input.key === '`')) return 'terminal';
  if (input.ctrlKey && input.shiftKey && !input.metaKey && !input.altKey && key === 'g') return 'review';
  if (!mod || input.shiftKey) return;
  if (input.altKey) return key === 's' ? 'chat' : undefined;
  if (key === 't') return 'browser';
  if (key === 'p') return 'files';
  if (key === 'j') return 'terminal';
}

export function panelShortcutFromNative(input: {
  key: string; code?: string; meta?: boolean; control?: boolean; alt?: boolean; shift?: boolean; isComposing?: boolean;
}, platform: string) {
  return resolvePanelShortcut({ key: input.key, code: input.code, metaKey: input.meta, ctrlKey: input.control,
    altKey: input.alt, shiftKey: input.shift, isComposing: input.isComposing }, platform);
}

export function forwardNativePanelShortcut(
  event: { preventDefault(): void },
  input: Parameters<typeof panelShortcutFromNative>[0] & { type: string; isAutoRepeat?: boolean },
  platform: string,
  send: (action: PanelShortcut) => void,
) {
  if (input.type !== 'keyDown') return false;
  const action = panelShortcutFromNative(input, platform);
  if (!action) return false;
  event.preventDefault();
  if (!input.isAutoRepeat) send(action);
  return true;
}
