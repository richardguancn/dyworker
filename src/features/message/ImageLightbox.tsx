import { ChevronLeft, ChevronRight, Copy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { copyImageToClipboard, rememberLocalImageData } from "../../ImageAttachment";

// 图片预览灯箱：优先按原始尺寸展示，超出视口时等比缩放；大图可拖动查看细节。
// 多图时显示左右切换箭头与序号（也支持 ←/→ 键，循环切换）。
export function ImageLightbox({ preview, onClose, onCopied, navigation }: {
  preview: { url: string; name: string; path?: string };
  onClose: () => void;
  onCopied?: (copied: boolean) => void;
  navigation?: { index: number; count: number; onNavigate: (direction: -1 | 1) => void };
}) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // 切换图片后重新测量原始尺寸，避免沿用上张图的缩放
  useEffect(() => setNaturalSize(null), [preview.url]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    // 用内容盒尺寸（clientWidth 含 padding，会撑出水平滚动条）
    const measure = () => {
      const style = window.getComputedStyle(element);
      const width = element.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
      const height = element.clientHeight - parseFloat(style.paddingTop || "0") - parseFloat(style.paddingBottom || "0");
      setViewportSize({ width: Math.max(0, width), height: Math.max(0, height) });
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

  // 原图不超过上限时按原始尺寸展示；上限为视口内容区的 80%，超出才等比缩小（小图绝不放大）
  const maxDisplaySize = useMemo(() => ({
    width: viewportSize.width * 0.8,
    height: viewportSize.height * 0.8,
  }), [viewportSize]);
  const displayScale = useMemo(() => {
    if (!naturalSize || !maxDisplaySize.width || !maxDisplaySize.height) return 1;
    return Math.min(1, maxDisplaySize.width / naturalSize.width, maxDisplaySize.height / naturalSize.height);
  }, [naturalSize, maxDisplaySize]);
  const displaySize = useMemo(() => {
    if (!naturalSize) return null;
    return {
      width: Math.max(1, Math.round(naturalSize.width * displayScale)),
      height: Math.max(1, Math.round(naturalSize.height * displayScale)),
    };
  }, [naturalSize, displayScale]);

  const copyImage = async () => {
    try {
      if (preview.path) rememberLocalImageData(preview.path, preview.url);
      await copyImageToClipboard({ ok: true, dataUrl: preview.url }, preview.path);
      setCopied(true);
      onCopied?.(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      onCopied?.(false);
    }
  };

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`图片预览：${preview.name}`}
      onClick={onClose}
    >
      <div className="image-lightbox-viewport" ref={viewportRef}>
        <img
          src={preview.url}
          alt={preview.name}
          draggable={false}
          style={displaySize ? {
            width: displaySize.width,
            height: displaySize.height,
          } : undefined}
          onClick={(event) => event.stopPropagation()}
          onLoad={(event) => {
            const target = event.currentTarget;
            if (target.naturalWidth && target.naturalHeight) {
              setNaturalSize({ width: target.naturalWidth, height: target.naturalHeight });
            }
          }}
        />
      </div>
      {navigation && navigation.count > 1 && (
        <>
          <button
            type="button"
            className="image-lightbox-nav prev"
            aria-label="上一张"
            title="上一张（←）"
            onClick={(event) => { event.stopPropagation(); navigation.onNavigate(-1); }}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            className="image-lightbox-nav next"
            aria-label="下一张"
            title="下一张（→）"
            onClick={(event) => { event.stopPropagation(); navigation.onNavigate(1); }}
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
      <div className="image-lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
        {navigation && navigation.count > 1 && (
          <span className="image-lightbox-counter">{navigation.index + 1} / {navigation.count}</span>
        )}
        <button type="button" className="image-lightbox-copy" onClick={() => void copyImage()} aria-label="复制图片" title="复制图片到剪贴板">
          <Copy size={15} />
          {copied ? "已复制" : "复制"}
        </button>
        <button
          type="button"
          className="image-lightbox-close"
          onClick={onClose}
          aria-label="关闭预览"
          title="关闭（Esc）"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
