/** 桌面页面默认最小自适应逻辑宽度（px） */
export const DESKTOP_AUTO_FIT_WIDTH = 1024;
/** 响应式视口单边最小尺寸（px） */
export const MIN_VIEWPORT_SIZE = 200;
/** 响应式视口单边最大尺寸（px） */
export const MAX_VIEWPORT_SIZE = 3840;
/** 最小缩放比例 */
export const MIN_ZOOM_FACTOR = 0.25;
/** 最大缩放比例 */
export const MAX_ZOOM_FACTOR = 3;
/** 舞台左右拖拽手柄与留白预留宽度（px） */
export const STAGE_HORIZONTAL_PADDING = 48;
/** 舞台顶部间距与底部手柄预留高度（px） */
export const STAGE_VERTICAL_PADDING = 36;

export type BrowserViewportZoomMode = "auto" | number;

export type BrowserViewportState = {
  open: boolean;
  preset: string; // "responsive" | "desktop" | "laptop" | "tablet" | "mobile"
  width: number;
  height: number;
  zoomMode: BrowserViewportZoomMode;
  mobile?: boolean;
};

export type BrowserViewportPreset = {
  id: string;
  labelKey: string;
  fallbackLabel: string;
  width: number;
  height: number;
  mobile?: boolean;
};

export type ViewportResizeEdge = "left" | "right" | "bottom" | "bottom-left" | "bottom-right";

export const BROWSER_VIEWPORT_PRESETS: readonly BrowserViewportPreset[] = [
  { id: "responsive", labelKey: "browserViewport.presetResponsive", fallbackLabel: "响应式", width: 1024, height: 720, mobile: false },
  { id: "desktop", labelKey: "browserViewport.presetDesktop", fallbackLabel: "桌面", width: 1280, height: 800, mobile: false },
  { id: "laptop", labelKey: "browserViewport.presetLaptop", fallbackLabel: "笔记本", width: 1440, height: 900, mobile: false },
  { id: "tablet", labelKey: "browserViewport.presetTablet", fallbackLabel: "平板", width: 820, height: 1180, mobile: true },
  { id: "mobile", labelKey: "browserViewport.presetMobile", fallbackLabel: "手机", width: 390, height: 844, mobile: true },
];

export const BROWSER_VIEWPORT_ZOOM_OPTIONS: readonly BrowserViewportZoomMode[] = [
  "auto",
  0.25,
  0.5,
  0.67,
  0.75,
  1,
  1.25,
  1.5,
];

/** 创建默认的响应式视口状态 */
export function createDefaultBrowserViewport(): BrowserViewportState {
  return {
    open: true,
    preset: "responsive",
    width: 1024,
    height: 720,
    zoomMode: "auto",
    mobile: false,
  };
}

/** 限制视口宽高到合法整数区间 */
export function clampViewportDimension(value: number): number {
  if (!Number.isFinite(value)) return DESKTOP_AUTO_FIT_WIDTH;
  return Math.min(MAX_VIEWPORT_SIZE, Math.max(MIN_VIEWPORT_SIZE, Math.round(value)));
}

/** 限制缩放倍率到 Chromium 稳定区间 */
export function clampZoomFactor(factor: number): number {
  if (!Number.isFinite(factor)) return 1;
  return Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, factor));
}

/**
 * 普通浏览态下，根据容器宽度与手动缩放档位计算实际 zoomFactor。
 * 当启用小窗口自动适配且容器窄于 1024px 时按比例缩小，叠加用户的 1.2^zoomLevel 调节。
 */
export function computeAutoFitZoomFactor(
  containerWidth: number,
  manualZoomLevel = 0,
  autoFitDesktop = true,
): number {
  const manualScale = 1.2 ** (Number.isFinite(manualZoomLevel) ? manualZoomLevel : 0);
  const baseScale = autoFitDesktop && containerWidth > 0 && containerWidth < DESKTOP_AUTO_FIT_WIDTH
    ? Math.max(MIN_ZOOM_FACTOR, containerWidth / DESKTOP_AUTO_FIT_WIDTH)
    : 1;
  return clampZoomFactor(baseScale * manualScale);
}

/** 计算响应式舞台画框的物理显示尺寸与实际缩放比 */
export function computeStageViewportLayout(
  viewport: Pick<BrowserViewportState, "width" | "height" | "zoomMode">,
  containerWidth: number,
  containerHeight: number,
): { scale: number; displayWidth: number; displayHeight: number; zoomPercent: number } {
  const width = clampViewportDimension(viewport.width);
  const height = clampViewportDimension(viewport.height);
  const availW = Math.max(120, containerWidth - STAGE_HORIZONTAL_PADDING);
  const availH = Math.max(120, containerHeight - STAGE_VERTICAL_PADDING);
  const rawScale = viewport.zoomMode === "auto"
    ? (containerWidth > 0 && containerHeight > 0 ? Math.min(1, availW / width, availH / height) : 1)
    : Number(viewport.zoomMode);
  const scale = clampZoomFactor(rawScale);
  return {
    scale,
    displayWidth: Math.max(50, Math.round(width * scale)),
    displayHeight: Math.max(50, Math.round(height * scale)),
    zoomPercent: Math.round(scale * 100),
  };
}

/** 计算 5 向手柄拖拽后的逻辑宽高（左右居中加倍，底边一倍） */
export function computeResizedViewport(
  start: { width: number; height: number },
  edge: ViewportResizeEdge,
  deltaX: number,
  deltaY: number,
  scale: number,
): { width: number; height: number } {
  const safeScale = Math.max(MIN_ZOOM_FACTOR, Number.isFinite(scale) && scale > 0 ? scale : 1);
  let nextWidth = start.width;
  if (edge === "right" || edge === "bottom-right") {
    nextWidth = start.width + (deltaX * 2) / safeScale;
  } else if (edge === "left" || edge === "bottom-left") {
    nextWidth = start.width - (deltaX * 2) / safeScale;
  }
  const hasBottom = edge === "bottom" || edge === "bottom-left" || edge === "bottom-right";
  const nextHeight = hasBottom ? start.height + deltaY / safeScale : start.height;
  return {
    width: clampViewportDimension(nextWidth),
    height: clampViewportDimension(nextHeight),
  };
}
