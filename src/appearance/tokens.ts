// 外观自定义的纯映射层：外观设置 → CSS 变量值。
// 只含纯函数（DOM 依赖仅限 document 传入方），供 controller 与面板复用。
import type { AppearanceSettings, AppearanceTheme } from "../types";

// ---- 默认色板（与 styles.css :root / html[data-theme="dark"] 保持一致）----

export interface PanelDefaults {
  surface: string;
  sidebar: string;
  sidebarActive: string;
  card: string;
  bubble: string;
  windowBg: string;
}

export const LIGHT_DEFAULTS: PanelDefaults = {
  surface: "#fafafa",
  sidebar: "#f7f7f7",
  sidebarActive: "#e9e9e9",
  card: "#fafafa",
  bubble: "#efeee9",
  windowBg: "#f0f0f0",
};

export const DARK_DEFAULTS: PanelDefaults = {
  surface: "#181916",
  sidebar: "#20211e",
  sidebarActive: "#2a2b27",
  card: "#252622",
  bubble: "#2a2b27",
  windowBg: "#181916",
};

export function panelDefaultsFor(resolved: "light" | "dark"): PanelDefaults {
  return resolved === "dark" ? DARK_DEFAULTS : LIGHT_DEFAULTS;
}

export function resolveTheme(theme: AppearanceTheme, systemDark: boolean): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  return systemDark ? "dark" : "light";
}

// ---- 颜色工具：全部容忍非法输入，返回 null 而不抛出 ----

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 解析 #rgb / #rrggbb / #rrggbbaa；其余输入返回 null */
export function parseHexColor(input: unknown): RgbaColor | null {
  if (typeof input !== "string") return null;
  const hex = input.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: 1,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    const color = {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
    if (hex.length === 8) color.a = parseInt(hex.slice(6, 8), 16) / 255;
    return color;
  }
  return null;
}

/** mix("112233", "ffffff", 0.5)：t 为后者的占比（0..1），返回 #rrggbb */
export function mixColor(hexA: string, hexB: string, t: number): string | null {
  const a = parseHexColor(hexA);
  const b = parseHexColor(hexB);
  if (!a || !b) return null;
  const k = Math.min(1, Math.max(0, t));
  const channel = (x: number, y: number) => Math.round(x + (y - x) * k);
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(channel(a.r, b.r))}${to2(channel(a.g, b.g))}${to2(channel(a.b, b.b))}`;
}

export function rgbaString(color: RgbaColor, alpha?: number): string {
  const a = alpha === undefined ? color.a : Math.min(1, Math.max(0, alpha));
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(a.toFixed(3))})`;
}

/** 归一化为 #rrggbb（供 hex 文本输入回显）；非法返回 null */
export function normalizeHex(input: unknown): string | null {
  const color = parseHexColor(input);
  if (!color) return null;
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(color.r)}${to2(color.g)}${to2(color.b)}`;
}

// ---- 面板色派生 ----

// 面板色派生的 CSS 变量映射。无自定义色、透明度为 0 且玻璃关闭时返回 null
//（controller 移除内联变量、回退样式表默认，老用户观感不变）。文字色（ink/muted/quiet）
// 与 accent 保持主题默认。
export const PANEL_COLOR_VARS = ["--surface", "--surface-strong", "--sidebar", "--sidebar-active", "--card", "--card-raised", "--bubble", "--table-head"] as const;

/**
 * 派生规则：自定义色与主题默认面板色混合，得到协调的导航/面板底色；
 * sidebar 系列混入比例更低（更贴近自定义色 → 相对 surface 略深/略饱和），
 * card 更贴近主题默认（更中性的承载面）。transparency 把面板底色整体转为 rgba，
 * alpha = 1 - t/100，文字与图标不受影响。全部面板（侧边栏/正文区/标题栏/
 * 输入框/新建任务/工作计划/改动卡片/表格标题栏）共用同一 alpha，全界面透明度
 * 与左侧面板统一。玻璃开启时强制面板至少保留 22% 透出，模糊才可见。
 * --card-raised 是 --card 的加浓版（补足剩余透明度），供输入框与悬浮在
 * 对话流上的元素托底，避免流过的文字透出来干扰输入。
 */
export function derivePalette(
  settings: Pick<AppearanceSettings, "background">,
  resolved: "light" | "dark",
  options?: { glass?: boolean },
): Record<string, string> | null {
  const defaults = panelDefaultsFor(resolved);
  const custom = resolved === "dark" ? settings.background.darkColor : settings.background.lightColor;
  const transparency = Math.min(70, Math.max(0, Number(settings.background.transparency) || 0));
  const glass = options?.glass === true;
  if (!custom && transparency <= 0 && !glass) return null;
  const baseHex = custom ?? defaults.surface;
  if (custom && !parseHexColor(custom)) return null;
  let alpha = 1 - transparency / 100;
  if (glass) alpha = Math.min(alpha, 0.78);
  // 输入框与悬浮层的托底 alpha：对话正文会从输入框后流过，提示 toast / 排队消息卡
  // 悬浮在正文上方，与面板同 alpha 会把后面的文字透出来和占位符混叠。
  // 在面板 alpha 基础上补足剩余透明度的 70%（单调不减，alpha=1 时仍为 1）：
  // 文字不再干扰输入，同时面板透出时输入框也保留一点透出维持半透明观感
  const raisedAlpha = alpha + (1 - alpha) * 0.7;
  // 全部面板共用同一 alpha：侧边栏、正文区（surface-strong）与卡片级表面透明度统一，
  // 避免卡片叠在更实的正文区上时视觉透明度与侧边栏脱节
  const entries: Array<[string, string | null, number]> = [
    ["--surface", mixColor(baseHex, defaults.surface, 0.5), alpha],
    ["--surface-strong", mixColor(baseHex, defaults.surface, 0.5), alpha],
    ["--sidebar", mixColor(baseHex, defaults.sidebar, 0.35), alpha],
    ["--sidebar-active", mixColor(baseHex, defaults.sidebarActive, 0.3), alpha],
    // 卡片混入自定义色的比例高于其他面板（0.42），保持与整体色调一致；alpha 与侧边栏一致
    ["--card", mixColor(baseHex, defaults.card, 0.42), alpha],
    ["--card-raised", mixColor(baseHex, defaults.card, 0.42), raisedAlpha],
    ["--bubble", mixColor(baseHex, defaults.bubble, 0.5), alpha],
    // 表格标题栏：色调与 bubble 一致，alpha 与侧边栏/卡片同一层级
    ["--table-head", mixColor(baseHex, defaults.bubble, 0.5), alpha],
  ];
  const palette: Record<string, string> = {};
  for (const [name, hex, a] of entries) {
    if (!hex) return null;
    const color = parseHexColor(hex);
    if (!color) return null;
    palette[name] = rgbaString(color, a);
  }
  return palette;
}

// ---- 字体 ----

// 自定义家族名的安全校验：允许 Unicode 字母/数字、空格、常用安全标点；严禁控制字符与 CSS 注入面
export function isValidFontFamily(family: unknown): boolean {
  if (typeof family !== "string") return false;
  const trimmed = family.trim();
  if (!trimmed || trimmed.length > 120) return false;
  // 禁止控制字符（< 0x20 或 0x7f-0x9f）
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  // 禁止样式注入字符：双引号、反斜杠、分号、大括号、尖括号、圆括号、星号、斜杠、@
  if (/["\\;{}<>()*/@]/.test(trimmed)) return false;
  // 必须由 Unicode 字母、数字及常见的字体名称符号（空格、连字符、点、逗号、单引号、顿号、&、+、_）组成
  return /^[\p{L}\p{N}\s_.,&'’\-+、]+$/u.test(trimmed);
}

/**
 * 字体家族 → 完整后备栈。system 返回 null（表示不设置 --font-ui，沿用样式表默认栈）；
 * 自定义家族先做安全校验，非法回落 sans-serif 栈。
 */
export function fontStackFor(family: string): string | null {
  if (family === "system") return null;
  if (family === "sans-serif") {
    return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Noto Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
  }
  if (family === "serif") {
    return 'Georgia, "Songti SC", "STSong", "SimSun", serif';
  }
  const name = String(family || "").trim();
  if (!isValidFontFamily(name)) {
    return fontStackFor("sans-serif");
  }
  const escaped = name.replace(/["\\]/g, "");
  return `"${escaped}", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
}
