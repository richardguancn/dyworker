// 外观自定义渲染端 store：已保存值 / 草稿 / 平台能力的唯一来源。
// main.tsx 在 createRoot 前 await bootstrapAppearance()；设置弹窗挂载时 beginSession、
// 卸载时 discardSession（取消/Esc/点遮罩共用这条恢复路径）。
import { useSyncExternalStore, useEffect, useState } from "react";
import type {
  AppearanceCapabilities,
  AppearanceEffectiveState,
  AppearanceSettings,
  AppearanceSnapshot,
} from "../types";
import {
  PANEL_COLOR_VARS,
  derivePalette,
  fontStackFor,
  isValidFontFamily,
  parseHexColor,
  resolveTheme,
  rgbaString,
  panelDefaultsFor,
} from "./tokens";

// ---- 渲染端默认值（与主进程 electron/appearance.mjs 的默认保持一致）----

export function defaultAppearance(): AppearanceSettings {
  return {
    version: 1,
    theme: "system",
    background: {
      lightColor: null,
      darkColor: null,
      transparency: 0,
      imageId: null,
      imageFit: "cover",
      overlay: 20,
    },
    glass: {
      enabled: false,
      strength: "standard",
      lightweight: false,
      systemBackdrop: false,
    },
    typography: {
      family: "system",
      uiSize: 14,
      contentSize: 16,
    },
  };
}

const UI_SIZES = [13, 14, 16, 18] as const;
const IMAGE_ID_RE = /^[a-f0-9]{32}\.(png|jpe?g|webp)$/;

/** 渲染端轻量规范化：保证草稿/外部快照里的值落在合法区间（不替代主进程校验） */
export function normalizeAppearance(input: unknown): AppearanceSettings {
  const defaults = defaultAppearance();
  if (!input || typeof input !== "object" || Array.isArray(input)) return defaults;
  const raw = input as Record<string, any>;
  const out = defaultAppearance();
  out.theme = raw.theme === "light" || raw.theme === "dark" ? raw.theme : "system";
  const bg = raw.background && typeof raw.background === "object" ? raw.background : {};
  for (const key of ["lightColor", "darkColor"] as const) {
    const value = bg[key];
    if (typeof value === "string" && parseHexColor(value)) {
      out.background[key] = normalizeHexLocal(value);
    }
  }
  out.background.transparency = clampInt(bg.transparency, 0, 70, 0);
  out.background.overlay = clampInt(bg.overlay, 0, 80, 20);
  out.background.imageFit = bg.imageFit === "contain" || bg.imageFit === "tile" ? bg.imageFit : "cover";
  out.background.imageId = typeof bg.imageId === "string" && IMAGE_ID_RE.test(bg.imageId) ? bg.imageId : null;
  const glass = raw.glass && typeof raw.glass === "object" ? raw.glass : {};
  out.glass.enabled = Boolean(glass.enabled);
  out.glass.strength = glass.strength === "subtle" || glass.strength === "strong" ? glass.strength : "standard";
  out.glass.lightweight = Boolean(glass.lightweight);
  out.glass.systemBackdrop = Boolean(glass.systemBackdrop);
  const typo = raw.typography && typeof raw.typography === "object" ? raw.typography : {};
  const family = typeof typo.family === "string" ? typo.family.trim() : "system";
  out.typography.family = family && isValidFontFamily(family) ? family : "system";
  out.typography.uiSize = (UI_SIZES as readonly number[]).includes(typo.uiSize) ? typo.uiSize : 14;
  out.typography.contentSize = clampInt(typo.contentSize, 14, 24, 16);
  return out;
}

function normalizeHexLocal(value: string): string {
  const color = parseHexColor(value)!;
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(color.r)}${to2(color.g)}${to2(color.b)}`;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cloneSettings(settings: AppearanceSettings): AppearanceSettings {
  return JSON.parse(JSON.stringify(settings)) as AppearanceSettings;
}

function settingsEqual(a: AppearanceSettings, b: AppearanceSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- store ----

export interface AppearanceStoreState {
  saved: AppearanceSettings;
  revision: number;
  /** 设置弹窗打开期间的草稿；null = 无会话，界面上以 saved 为准 */
  draft: AppearanceSettings | null;
  dirty: boolean;
  capabilities: AppearanceCapabilities | null;
  effective: AppearanceEffectiveState | null;
  /** 无桌面桥接（普通浏览器预览）：仅本地预览，绝不谎报保存成功 */
  previewOnly: boolean;
  /** 背景图损坏/丢失时的一条中文提示（同一 imageId 只记一次） */
  imageError: string | null;
  /** 当前背景图的 Blob URL（缩略图与背景层共用），无图为 null */
  imageUrl: string | null;
  ready: boolean;
}

const listeners = new Set<() => void>();

let state: AppearanceStoreState = {
  saved: defaultAppearance(),
  revision: 0,
  draft: null,
  dirty: false,
  capabilities: null,
  effective: null,
  previewOnly: false,
  imageError: null,
  imageUrl: null,
  ready: false,
};

function setState(patch: Partial<AppearanceStoreState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppearanceStore(): AppearanceStoreState {
  return useSyncExternalStore(subscribe, () => state);
}

/** 供图表组件用：按当前应用值（草稿优先）解析出的最终 light/dark */
export function useResolvedTheme(): "light" | "dark" {
  const snapshot = useAppearanceStore();
  const theme = snapshot.draft?.theme ?? snapshot.saved.theme;
  const [systemDark, setSystemDark] = useState(systemDarkNow);
  useEffect(() => {
    if (theme === "system") {
      setSystemDark(systemDarkNow());
    }
    if (theme !== "system") return;
    const media = darkMediaQuery();
    if (!media) return;
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, [theme]);
  return resolveTheme(theme, theme === "system" ? systemDark : false);
}

function darkMediaQuery(): MediaQueryList | null {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  } catch {
    return null;
  }
}

function systemDarkNow(): boolean {
  return Boolean(darkMediaQuery()?.matches);
}

// ---- 图片缓存（imageId → Blob URL）----

const imageUrlCache = new Map<string, string>();
let lastErrorImageId: string | null = null;

async function ensureImageUrl(imageId: string): Promise<string | null> {
  const cached = imageUrlCache.get(imageId);
  if (cached) return cached;
  const bridge = window.dyworker;
  if (!bridge?.readAppearanceImage) return null;
  try {
    const result = await bridge.readAppearanceImage(imageId);
    if (!result?.ok || !result.bytes?.length) throw new Error(result?.error || "图片不存在");
    const bytes = result.bytes instanceof Uint8Array
      ? result.bytes
      : new Uint8Array(result.bytes as ArrayLike<number>);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([buffer], { type: result.mime || "image/png" });
    const url = URL.createObjectURL(blob);
    imageUrlCache.set(imageId, url);
    return url;
  } catch (error) {
    // 图片损坏/丢失：应用层退化为纯色背景，只提示一次；更换 imageId 后重置
    if (lastErrorImageId !== imageId) {
      lastErrorImageId = imageId;
      setState({
        imageError: `背景图片读取失败（${error instanceof Error ? error.message : String(error)}），已临时使用纯色背景，可在下方更换或移除。`,
      });
    }
    return null;
  }
}

function dropImageUrl(imageId: string) {
  const url = imageUrlCache.get(imageId);
  if (url) {
    URL.revokeObjectURL(url);
    imageUrlCache.delete(imageId);
  }
}

// ---- 应用（写 data 属性 + CSS 变量）----

let applyScheduled = false;
let previewTimer: number | null = null;

/** rAF 合并应用：连续拖滑块只按帧写 DOM，不逐次同步重排 */
function scheduleApply() {
  if (applyScheduled) return;
  applyScheduled = true;
  requestAnimationFrame(() => {
    applyScheduled = false;
    applyCurrent();
  });
}

function applyCurrent() {
  const settings = state.draft ?? state.saved;
  applyToDom(settings);
}

function applyToDom(settings: AppearanceSettings) {
  const root = document.documentElement;
  const resolved = resolveTheme(settings.theme, systemDarkNow());

  // 受控主题：始终输出明确的 data-theme，并同步 colorScheme
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;

  const glass = settings.glass;
  root.dataset.glass = glass.enabled ? glass.strength : "off";
  // Linux 或硬件加速关闭时 capabilities.backdropFilter 为 false，强制启用轻量模式
  const forceLightweight = state.capabilities?.backdropFilter === false;
  root.dataset.glassLightweight = (forceLightweight || glass.lightweight) ? "true" : "false";
  root.style.setProperty("--glass-blur", glass.strength === "subtle" ? "12px" : glass.strength === "strong" ? "32px" : "20px");

  // 字体与字号：--font-ui-scale 驱动界面字号，--font-content-scale 驱动正文字号
  root.style.setProperty("--font-ui-scale", String(settings.typography.uiSize / 14));
  root.style.setProperty("--font-content-scale", String(settings.typography.contentSize / 16));
  const stack = fontStackFor(settings.typography.family);
  if (stack) root.style.setProperty("--font-ui", stack);
  else root.style.removeProperty("--font-ui");

  // 面板色：无自定义色、无透明度、玻璃关闭时移除内联变量（回退样式表默认，老用户观感不变）
  const palette = derivePalette(settings, resolved, { glass: glass.enabled });
  if (palette) {
    for (const name of PANEL_COLOR_VARS) root.style.setProperty(name, palette[name]);
  } else {
    for (const name of PANEL_COLOR_VARS) root.style.removeProperty(name);
  }

  // 系统背景材质透出判断：玻璃总开关 + 系统背景开关 + 平台支持 + 主进程已生效
  const isSystemBackdrop = glass.enabled
    && glass.systemBackdrop
    && state.capabilities?.systemBackdrop?.available === true
    && (state.effective?.applied === "vibrancy" || state.effective?.applied === "background-material");
  root.dataset.systemBackdrop = isSystemBackdrop ? "true" : "false";

  // 背景层变量（.appearance-backdrop 消费）：颜色 → 图片 → 遮罩
  const bg = settings.background;
  const custom = resolved === "dark" ? bg.darkColor : bg.lightColor;
  const customColor = custom ? parseHexColor(custom) : null;
  const defaults = panelDefaultsFor(resolved);
  // 当系统背景材质生效且未设置自定义色时，保持背景透明透出系统桌面；否则使用自定义色或默认底色
  if (isSystemBackdrop && !customColor) {
    root.style.setProperty("--bg-color", "transparent");
  } else {
    root.style.setProperty("--bg-color", customColor ? rgbaString(customColor, 1) : defaults.windowBg);
  }
  root.style.setProperty("--bg-overlay", String(Math.min(80, Math.max(0, bg.overlay)) / 100));
  root.style.setProperty("--bg-size", bg.imageFit === "contain" ? "contain" : bg.imageFit === "tile" ? "auto" : "cover");
  root.style.setProperty("--bg-repeat", bg.imageFit === "tile" ? "repeat" : "no-repeat");

  const imageId = bg.imageId;
  root.dataset.hasBgImage = imageId ? "true" : "false";
  // 面板需要透出背景层的统一标记：自定义色/透明度/背景图/玻璃/系统背景材质任一启用
  root.dataset.translucent = palette || imageId || isSystemBackdrop ? "true" : "false";
  if (imageId) {
    void ensureImageUrl(imageId).then((url) => {
      // 异步返回时草稿可能已换图/移除，以当前状态为准；仅在当前状态仍为此 imageId 时才更新
      const current = (state.draft ?? state.saved).background.imageId;
      if (current !== imageId) return;
      root.style.setProperty("--bg-image", url ? `url("${url}")` : "none");
      if (url && state.imageUrl !== url) setState({ imageUrl: url });
      if (!url && state.imageUrl) setState({ imageUrl: null });
    });
  } else {
    root.style.setProperty("--bg-image", "none");
    if (state.imageUrl) setState({ imageUrl: null });
  }

  syncSystemThemeListener(settings.theme);
  window.dispatchEvent(new Event("dyworker:appearance-changed"));
}

// 系统明暗监听：仅在（草稿或已保存的）theme 为 system 时挂监听，避免手动主题被系统覆盖
let mediaListenerInstalled = false;

function syncSystemThemeListener(theme: AppearanceSettings["theme"]) {
  const media = darkMediaQuery();
  if (!media) return;
  if (theme === "system" && !mediaListenerInstalled) {
    media.addEventListener?.("change", onSystemThemeChange);
    mediaListenerInstalled = true;
  } else if (theme !== "system" && mediaListenerInstalled) {
    media.removeEventListener?.("change", onSystemThemeChange);
    mediaListenerInstalled = false;
  }
}

function onSystemThemeChange() {
  applyCurrent();
}

// ---- 原生预览（仅窗口底色/系统材质相关字段变化时才走 IPC，200ms 防抖）----

const NATIVE_KEYS: Array<(settings: AppearanceSettings) => unknown> = [
  (s) => s.theme,
  (s) => s.background.lightColor,
  (s) => s.background.darkColor,
  (s) => s.glass.enabled,
  (s) => s.glass.strength,
  (s) => s.glass.systemBackdrop,
];

let sessionEpoch = 0;
let previewSequence = 0;

function nativeSignature(settings: AppearanceSettings): string {
  return JSON.stringify(NATIVE_KEYS.map((pick) => pick(settings)));
}

function scheduleNativePreview(settings: AppearanceSettings) {
  const bridge = window.dyworker;
  if (!bridge?.previewAppearance) return;
  if (previewTimer !== null) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  const requestEpoch = sessionEpoch;
  const requestSequence = ++previewSequence;
  previewTimer = window.setTimeout(() => {
    previewTimer = null;
    if (requestEpoch !== sessionEpoch || !state.draft) return;
    bridge.previewAppearance?.(settings)
      .then((result) => {
        if (requestEpoch !== sessionEpoch || requestSequence !== previewSequence || !state.draft) return;
        if (result?.effective) {
          setState({ effective: result.effective });
          scheduleApply();
        }
      })
      .catch(() => { });
  }, 200);
}

// ---- 会话生命周期 ----

let stagedImageIds: string[] = [];
let savedEffective: AppearanceEffectiveState | null = null;

/**
 * 进入设置创建草稿；幂等（React StrictMode 双挂载安全）。
 */
export function beginSession() {
  if (state.draft) return;
  if (previewTimer !== null) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  sessionEpoch++;
  savedEffective = state.effective;
  const draft = cloneSettings(state.saved);
  setState({ draft, dirty: false });
  applyToDom(draft);
}

/**
 * 关闭设置：恢复已保存外观并通知主进程取消原生预览、回收本会话暂存图片。
 */
export function discardSession() {
  if (previewTimer !== null) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  sessionEpoch++;
  if (!state.draft) return;
  const staged = stagedImageIds;
  stagedImageIds = [];
  for (const id of staged) dropImageUrl(id);
  const restoredEffective = savedEffective ?? state.effective;
  setState({
    draft: null,
    dirty: false,
    imageError: null,
    effective: restoredEffective,
  });
  applyToDom(state.saved);
  const requestEpoch = sessionEpoch;
  window.dyworker?.cancelAppearancePreview?.({ discardStaged: staged })
    .then((result) => {
      if (requestEpoch !== sessionEpoch) return;
      if (result?.effective) {
        setState({ effective: result.effective });
        applyToDom(state.saved);
      }
    })
    .catch(() => { });
}

/** 更新草稿：rAF 合并应用；仅原生相关字段变化才防抖调 previewAppearance */
export function updateDraft(recipe: (current: AppearanceSettings) => AppearanceSettings) {
  const current = state.draft ?? cloneSettings(state.saved);
  const previous = current;
  let next: AppearanceSettings;
  try {
    next = normalizeAppearance(recipe(cloneSettings(current)));
  } catch {
    return;
  }
  if (settingsEqual(previous, next) && state.draft) return;
  const nativeChanged = nativeSignature(previous) !== nativeSignature(next);
  setState({ draft: next, dirty: !settingsEqual(next, state.saved) });
  scheduleApply();
  if (nativeChanged) scheduleNativePreview(next);
}

/** 恢复默认：只改草稿，点保存后才持久化 */
export function resetDraft() {
  sessionEpoch++;
  if (previewTimer !== null) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  const defaults = defaultAppearance();
  if (state.capabilities?.glassDefault === "lightweight") {
    defaults.glass.lightweight = true;
  }
  const previous = state.draft ?? state.saved;
  setState({ draft: defaults, dirty: !settingsEqual(defaults, state.saved) });
  scheduleApply();
  if (nativeSignature(previous) !== nativeSignature(defaults)) scheduleNativePreview(defaults);
}

export type SaveDraftResult = { ok: true } | { ok: false; stale?: boolean; previewOnly?: boolean; error?: string };

export async function saveDraft(): Promise<SaveDraftResult> {
  if (previewTimer !== null) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  sessionEpoch++;
  if (state.previewOnly) return { ok: false, previewOnly: true };
  const bridge = window.dyworker;
  if (!bridge?.saveAppearance) return { ok: false, error: "当前环境不支持保存外观。" };
  const draft = state.draft;
  if (!draft) return { ok: false, error: "没有需要保存的外观修改。" };
  let snapshot: AppearanceSnapshot;
  try {
    snapshot = await bridge.saveAppearance({ settings: draft, revision: state.revision });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (snapshot?.ok) {
    // 主进程已把暂存图片转正并回收旧图：清空暂存列表，Blob URL 缓存保留供复用
    stagedImageIds = [];
    const saved = normalizeAppearance(snapshot.settings);
    const nextEffective = snapshot.effective ?? state.effective;
    savedEffective = nextEffective;
    setState({
      saved,
      revision: snapshot.revision ?? state.revision + 1,
      dirty: false,
      draft: cloneSettings(saved),
      effective: nextEffective,
      imageError: null,
    });
    applyToDom(saved);
    return { ok: true };
  }
  if (snapshot?.stale) {
    // 以主进程返回值重同步基准，草稿随新基准走
    const saved = normalizeAppearance(snapshot.settings);
    const nextEffective = snapshot.effective ?? state.effective;
    savedEffective = nextEffective;
    setState({
      saved,
      revision: snapshot.revision ?? state.revision,
      dirty: false,
      draft: cloneSettings(saved),
      effective: nextEffective,
    });
    applyToDom(saved);
    return { ok: false, stale: true };
  }
  // 其他失败：保留草稿以便重试
  return { ok: false, error: snapshot?.error || "保存失败，请重试。" };
}

/** 导入背景图：成功后读字节建 Blob URL 并把 imageId 写进草稿（暂存资源，保存后才转正） */
export async function importImage(): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  const bridge = window.dyworker;
  if (!bridge?.importAppearanceImage) return { ok: false, error: "当前环境不支持导入图片。" };
  let result;
  try {
    result = await bridge.importAppearanceImage();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!result || result.canceled) return { ok: false, canceled: true };
  if (!result.ok || !result.imageId) return { ok: false, error: result.error || "图片导入失败。" };
  const imageId = result.imageId;
  const url = await ensureImageUrl(imageId);
  if (!url) {
    return { ok: false, error: state.imageError || "图片读取失败，请换一张试试。" };
  }
  stagedImageIds = [...stagedImageIds, imageId];
  setState({ imageError: null });
  updateDraft((current) => ({ ...current, background: { ...current.background, imageId } }));
  return { ok: true };
}

/** 移除背景图：只改草稿；若移除的是本会话暂存图，同时回收暂存与 Blob URL */
export function removeImage() {
  const imageId = (state.draft ?? state.saved).background.imageId;
  updateDraft((current) => ({ ...current, background: { ...current.background, imageId: null } }));
  if (imageId && stagedImageIds.includes(imageId)) {
    stagedImageIds = stagedImageIds.filter((id) => id !== imageId);
    dropImageUrl(imageId);
    window.dyworker?.cancelAppearancePreview?.({ discardStaged: [imageId] }).catch(() => { });
  }
}

// ---- 启动 ----

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.then((value) => value as T | null).catch(() => null),
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms)),
  ]);
}

let bootstrapped = false;

/**
 * createRoot 前调用：读取已保存外观并应用后再渲染，避免启动后闪默认主题。
 * 无桥接（普通浏览器预览）时用默认值并标记 previewOnly；任何失败都不阻塞启动。
 */
export async function bootstrapAppearance(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  const bridge = window.dyworker;
  if (!bridge?.getAppearance) {
    setState({ previewOnly: true, ready: true });
    applyToDom(state.saved);
    return;
  }
  const snapshot = await withTimeout(bridge.getAppearance(), 800);
  if (snapshot?.ok && snapshot.settings) {
    savedEffective = snapshot.effective ?? null;
    setState({
      saved: normalizeAppearance(snapshot.settings),
      revision: snapshot.revision ?? 0,
      effective: snapshot.effective ?? null,
      capabilities: snapshot.capabilities ?? null,
    });
  }
  applyToDom(state.saved);
  // 能力与图片异步补齐，不阻塞首帧
  if (!state.capabilities && bridge.getAppearanceCapabilities) {
    void bridge.getAppearanceCapabilities()
      .then((capabilities) => {
        if (capabilities) setState({ capabilities });
      })
      .catch(() => { });
  }
  void bridge.onAppearanceReset?.((resetSnapshot) => {
    if (!resetSnapshot?.ok) return;
    if (previewTimer !== null) {
      window.clearTimeout(previewTimer);
      previewTimer = null;
    }
    sessionEpoch++;
    const saved = normalizeAppearance(resetSnapshot.settings);
    for (const id of stagedImageIds) dropImageUrl(id);
    stagedImageIds = [];
    const nextEffective = resetSnapshot.effective ?? state.effective;
    savedEffective = nextEffective;
    setState({
      saved,
      revision: resetSnapshot.revision ?? 0,
      draft: state.draft ? cloneSettings(saved) : null,
      dirty: false,
      effective: nextEffective,
      imageError: null,
    });
    applyToDom(saved);
  });
  setState({ ready: true });
}
