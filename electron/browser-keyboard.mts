// Chromium Input 使用的按键码和修饰键；拒绝未知组合，避免把字符串当成已执行的快捷键。
export function browserKeyDefinition(input: string, platform = process.platform) {
  const source = String(input);
  const plusKey = source === '+' || source.endsWith('++');
  const parts = (plusKey ? source.slice(0, -1) : source).split('+');
  const raw = plusKey ? '+' : parts.pop();
  if (plusKey && parts.at(-1) === '') parts.pop();
  if (!raw) throw new Error('按键不能为空');
  let modifiers = 0;
  for (const part of parts) {
    const flag = ({ alt: 1, option: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, super: 4, shift: 8,
      controlormeta: platform === 'darwin' ? 4 : 2 } as any)[part.toLowerCase()];
    if (!flag) throw new Error(`未知修饰键：${part}`);
    modifiers |= flag;
  }
  const definitions: any = {
    enter: ['Enter', 13], return: ['Enter', 13], backspace: ['Backspace', 8], tab: ['Tab', 9],
    escape: ['Escape', 27], esc: ['Escape', 27], delete: ['Delete', 46], space: [' ', 32],
    left: ['ArrowLeft', 37], arrowleft: ['ArrowLeft', 37], up: ['ArrowUp', 38], arrowup: ['ArrowUp', 38],
    right: ['ArrowRight', 39], arrowright: ['ArrowRight', 39], down: ['ArrowDown', 40], arrowdown: ['ArrowDown', 40],
    home: ['Home', 36], end: ['End', 35], pageup: ['PageUp', 33], pagedown: ['PageDown', 34], insert: ['Insert', 45],
  };
  const named = definitions[raw.toLowerCase()];
  const fn = /^f([1-9]|1\d|2[0-4])$/i.exec(raw);
  // Physical key, base character, shifted character and Windows virtual key.
  const punctuation: any[] = [
    ['Backquote', '`', '~', 192], ['Minus', '-', '_', 189], ['Equal', '=', '+', 187],
    ['BracketLeft', '[', '{', 219], ['BracketRight', ']', '}', 221], ['Backslash', '\\', '|', 220],
    ['Semicolon', ';', ':', 186], ['Quote', "'", '"', 222], ['Comma', ',', '<', 188],
    ['Period', '.', '>', 190], ['Slash', '/', '?', 191],
    ...Array.from('1234567890', (digit, index) => [`Digit${digit}`, digit, '!@#$%^&*()'[index], digit.charCodeAt(0)]),
  ];
  const physical = punctuation.find((item) => item[1] === raw || item[2] === raw || item[0].toLowerCase() === raw.toLowerCase()
    || (raw.toLowerCase() === 'plus' && item[0] === 'Equal'));
  if (physical && raw.toLowerCase() === 'plus') modifiers |= 8;
  if (physical && raw === physical[2]) modifiers |= 8;
  const key = named?.[0] || (fn ? `F${fn[1]}` : physical ? physical[modifiers & 8 ? 2 : 1] : modifiers & 8 ? raw.toUpperCase() : raw);
  const code = named ? key === ' ' ? 'Space' : key : fn ? key : physical ? physical[0] : /^[a-z]$/i.test(raw) ? `Key${raw.toUpperCase()}` : '';
  if (!code) throw new Error(`不支持的按键：${input}`);
  return { key, code, windowsVirtualKeyCode: named?.[1] ?? (fn ? 111 + Number(fn[1]) : physical ? physical[3] : raw.toUpperCase().charCodeAt(0)), modifiers };
}
