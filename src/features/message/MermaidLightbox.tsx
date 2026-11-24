import { Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.25;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

/**
 * 从 Mermaid 输出的 SVG 根标签解析逻辑尺寸，优先读取 viewBox，其次读取显式像素宽高。
 */
function parseSvgSize(svg: string): { width: number; height: number } {
  const svgTag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const viewBoxMatch = /\bviewBox=["']\s*([^\s,"']+)[\s,]+([^\s,"']+)[\s,]+([^\s,"']+)[\s,]+([^\s,"']+)\s*["']/i.exec(svgTag);
  if (viewBoxMatch) {
    const width = Number(viewBoxMatch[3]);
    const height = Number(viewBoxMatch[4]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }

  const widthMatch = /\bwidth=["']\s*([0-9]+(?:\.[0-9]+)?)(?:px)?\s*["']/i.exec(svgTag);
  const heightMatch = /\bheight=["']\s*([0-9]+(?:\.[0-9]+)?)(?:px)?\s*["']/i.exec(svgTag);
  if (widthMatch && heightMatch) {
    const width = Number(widthMatch[1]);
    const height = Number(heightMatch[1]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }

  return { width: 800, height: 450 };
}

export function MermaidLightbox({
  svg,
  renderId,
  theme,
  onClose,
}: {
  svg: string;
  renderId: string;
  theme: "light" | "dark";
  onClose: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const userInteractedRef = useRef(false);
  const dragMovedRef = useRef(false);
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  scaleRef.current = scale;
  offsetRef.current = offset;

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  // 为灯箱内 SVG 的元素与引用 ID 追加后缀，避免和消息正文里的同源 SVG 发生 <defs>/<marker> 冲突。
  const scopedSvg = useMemo(() => svg.replaceAll(renderId, `${renderId}-zoom`), [svg, renderId]);
  const svgSize = useMemo(() => parseSvgSize(svg), [svg]);

  // 切换图表内容时重置交互标记，让新图重新自适应当前视口。
  useEffect(() => {
    userInteractedRef.current = false;
  }, [svg, renderId]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => {
      setViewportSize({
        width: Math.max(0, element.clientWidth),
        height: Math.max(0, element.clientHeight),
      });
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const fitScale = useMemo(() => {
    if (!viewportSize.width || !viewportSize.height) return 1;
    const rawFit = Math.min(
      (viewportSize.width * 0.88) / svgSize.width,
      (viewportSize.height * 0.84) / svgSize.height,
    );
    return Math.min(1.5, Math.max(MIN_SCALE, rawFit));
  }, [viewportSize, svgSize]);

  useEffect(() => {
    if (!viewportSize.width || !viewportSize.height || userInteractedRef.current) return;
    setScale(fitScale);
    setOffset({ x: 0, y: 0 });
  }, [fitScale, viewportSize.width, viewportSize.height]);

  const resetView = useCallback(() => {
    userInteractedRef.current = false;
    setScale(fitScale);
    setOffset({ x: 0, y: 0 });
  }, [fitScale]);

  const zoomBy = useCallback((factor: number) => {
    userInteractedRef.current = true;
    setScale((prev) => clampScale(prev * factor));
  }, []);

  // 滚轮与触控板捏合缩放：以鼠标指针相对视口中心的位置为锚点同步调整偏移。
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const prevScale = scaleRef.current;
      const prevOffset = offsetRef.current;
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0025));
      const nextScale = clampScale(prevScale * factor);
      if (nextScale === prevScale) return;

      const rect = element.getBoundingClientRect();
      const px = event.clientX - (rect.left + rect.width / 2);
      const py = event.clientY - (rect.top + rect.height / 2);
      const ratio = nextScale / prevScale;

      userInteractedRef.current = true;
      scaleRef.current = nextScale;
      const nextOffset = {
        x: px - (px - prevOffset.x) * ratio,
        y: py - (py - prevOffset.y) * ratio,
      };
      offsetRef.current = nextOffset;
      setScale(nextScale);
      setOffset(nextOffset);
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  // 快捷键支持：Esc 关闭、+/- 缩放、0 重置视图。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomBy(1 / ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        resetView();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, resetView, zoomBy]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragMovedRef.current = false;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
    };
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!dragMovedRef.current && Math.hypot(dx, dy) > 4) {
        dragMovedRef.current = true;
        setDragging(true);
      }
      if (!dragMovedRef.current) return;
      userInteractedRef.current = true;
      setOffset({ x: drag.originX + dx, y: drag.originY + dy });
    };

    const finishDrag = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragStateRef.current = null;
      setDragging(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, []);

  const handleViewportClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    if ((event.target as Element | null)?.closest(".mermaid-lightbox-card")) return;
    onClose();
  };

  const displayWidth = Math.max(1, Math.round(svgSize.width * scale));
  const displayHeight = Math.max(1, Math.round(svgSize.height * scale));
  const zoomPercent = Math.round(scale * 100);

  return createPortal(
    <div
      className="mermaid-lightbox"
      data-mermaid-theme={theme}
      role="dialog"
      aria-modal="true"
      aria-label="图表放大预览"
    >
      <div
        ref={viewportRef}
        className={`mermaid-lightbox-viewport${dragging ? " dragging" : ""}`}
        onPointerDown={handlePointerDown}
        onClick={handleViewportClick}
      >
        <div
          className="mermaid-lightbox-stage"
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
        >
          <div className="mermaid-lightbox-card">
            <div
              className="mermaid-lightbox-svg"
              style={{ width: displayWidth, height: displayHeight }}
              dangerouslySetInnerHTML={{ __html: scopedSvg }}
            />
          </div>
        </div>
      </div>

      <div className="mermaid-lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="mermaid-lightbox-btn"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={scale <= MIN_SCALE + 1e-4}
          aria-label="缩小图表"
          title="缩小（-）"
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          className="mermaid-lightbox-btn mermaid-lightbox-percent"
          onClick={resetView}
          aria-label="重置视图"
          title="重置视图（0）"
        >
          {zoomPercent}%
        </button>
        <button
          type="button"
          className="mermaid-lightbox-btn"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={scale >= MAX_SCALE - 1e-4}
          aria-label="放大图表"
          title="放大（+）"
        >
          <Plus size={15} />
        </button>
        <button
          type="button"
          className="mermaid-lightbox-close"
          onClick={onClose}
          aria-label="关闭预览"
          title="关闭（Esc）"
        >
          <X size={18} />
        </button>
      </div>

      <div className="mermaid-lightbox-hint" aria-hidden="true">
        滚轮缩放 · 拖动平移 · Esc 关闭
      </div>
    </div>,
    document.body,
  );
}
