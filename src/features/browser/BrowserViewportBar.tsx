import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { t } from "../../i18n";
import {
  BROWSER_VIEWPORT_PRESETS,
  BROWSER_VIEWPORT_ZOOM_OPTIONS,
  clampViewportDimension,
  type BrowserViewportState,
} from "./browserViewport";

export interface BrowserViewportBarProps {
  viewport: BrowserViewportState;
  effectiveZoomPercent: number;
  onChange: (patch: Partial<BrowserViewportState>) => void;
  onSelectPreset: (presetId: string) => void;
  onRotate: () => void;
  onClose: () => void;
}

/** Codex 风格内置浏览器响应式 / 设备视口工具栏 */
export function BrowserViewportBar({
  viewport,
  effectiveZoomPercent,
  onChange,
  onSelectPreset,
  onRotate,
  onClose,
}: BrowserViewportBarProps) {
  const [widthDraft, setWidthDraft] = useState(() => String(viewport.width));
  const [heightDraft, setHeightDraft] = useState(() => String(viewport.height));

  useEffect(() => {
    setWidthDraft(String(viewport.width));
  }, [viewport.width]);

  useEffect(() => {
    setHeightDraft(String(viewport.height));
  }, [viewport.height]);

  const commitDimension = (axis: "width" | "height", rawValue: string) => {
    const parsed = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(parsed)) {
      if (axis === "width") setWidthDraft(String(viewport.width));
      else setHeightDraft(String(viewport.height));
      return;
    }
    const clamped = clampViewportDimension(parsed);
    if (axis === "width") {
      setWidthDraft(String(clamped));
      if (clamped !== viewport.width || viewport.preset !== "responsive") {
        onChange({ width: clamped, preset: "responsive" });
      }
    } else {
      setHeightDraft(String(clamped));
      if (clamped !== viewport.height || viewport.preset !== "responsive") {
        onChange({ height: clamped, preset: "responsive" });
      }
    }
  };

  const selectZoomValue = viewport.zoomMode === "auto" ? "auto" : String(viewport.zoomMode);

  return (
    <div
      className="browser-viewport-bar"
      role="toolbar"
      aria-label={t("browserViewport.toolbarAria", "响应式视口工具栏")}
    >
      <div className="browser-viewport-bar-left">
        <span className="browser-viewport-size-label">{t("browserViewport.sizeLabel", "尺寸:")}</span>
        <select
          className="browser-viewport-select"
          aria-label={t("browserViewport.presetAria", "设备预设")}
          value={BROWSER_VIEWPORT_PRESETS.some((item) => item.id === viewport.preset) ? viewport.preset : "responsive"}
          onChange={(event) => onSelectPreset(event.target.value)}
        >
          {BROWSER_VIEWPORT_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {t(preset.labelKey, preset.fallbackLabel)}
            </option>
          ))}
        </select>
      </div>

      <div className="browser-viewport-bar-center">
        <div className="browser-viewport-dim-group">
          <input
            type="text"
            inputMode="numeric"
            className="browser-viewport-dim-input"
            aria-label={t("browserViewport.widthAria", "视口宽度")}
            value={widthDraft}
            onChange={(event) => setWidthDraft(event.target.value)}
            onBlur={() => commitDimension("width", widthDraft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitDimension("width", widthDraft);
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                setWidthDraft(String(viewport.width));
                event.currentTarget.blur();
              }
            }}
          />
          <span className="browser-viewport-dim-sep" aria-hidden="true">×</span>
          <input
            type="text"
            inputMode="numeric"
            className="browser-viewport-dim-input"
            aria-label={t("browserViewport.heightAria", "视口高度")}
            value={heightDraft}
            onChange={(event) => setHeightDraft(event.target.value)}
            onBlur={() => commitDimension("height", heightDraft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitDimension("height", heightDraft);
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                setHeightDraft(String(viewport.height));
                event.currentTarget.blur();
              }
            }}
          />
        </div>

        <button
          type="button"
          className="browser-viewport-icon-btn"
          onClick={onRotate}
          aria-label={t("browserViewport.rotate", "旋转宽高")}
          title={t("browserViewport.rotate", "旋转宽高")}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="2.5" width="5.5" height="9" rx="1.2" />
            <path d="M10.5 6.5h2A1.5 1.5 0 0 1 14 8v4a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 12" />
            <path d="M11.6 5.1 10.2 6.5l1.4 1.4" />
          </svg>
        </button>

        <select
          className="browser-viewport-zoom-select"
          aria-label={t("browserViewport.zoomAria", "视口缩放")}
          value={selectZoomValue}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "auto") {
              onChange({ zoomMode: "auto" });
            } else {
              const num = Number(raw);
              if (Number.isFinite(num)) onChange({ zoomMode: num });
            }
          }}
        >
          {BROWSER_VIEWPORT_ZOOM_OPTIONS.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {opt === "auto"
                ? (viewport.zoomMode === "auto"
                    ? `${effectiveZoomPercent}%`
                    : t("browserViewport.zoomAuto", "自动适应"))
                : `${Math.round(opt * 100)}%`}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="browser-viewport-close-btn"
        onClick={onClose}
        aria-label={t("browserViewport.close", "关闭响应式视口")}
        title={t("browserViewport.close", "关闭响应式视口")}
      >
        <X size={15} />
      </button>
    </div>
  );
}
