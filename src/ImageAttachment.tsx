import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import type { Attachment } from "./types";

export type LocalImageReadResult = { ok: boolean; dataUrl?: string; error?: string };

// 附件原图统一经 local-image:read 读取（上限见 electron/local-image.mjs），
// 会话存档不再内嵌缩略图；气泡缩略、灯箱预览与复制共用同一份原图 dataURL。
const maxConcurrentLocalImageReads = 3;
let activeLocalImageReads = 0;
const localImageReadQueue: Array<() => void> = [];
const localImageReads = new Map<string, Promise<LocalImageReadResult>>();

// 会话内图片数量可控（同一文件路径反复出现只读一次），读到的原图缓存住，
// 来回滚动/反复打开预览不用重复 IPC 读盘。
const localImageDataCache = new Map<string, string>();

export function rememberLocalImageData(filePath: string, dataUrl: string) {
  if (filePath && dataUrl) localImageDataCache.set(filePath, dataUrl);
}

function drainLocalImageReadQueue() {
  while (activeLocalImageReads < maxConcurrentLocalImageReads && localImageReadQueue.length) {
    const start = localImageReadQueue.shift();
    if (!start) break;
    activeLocalImageReads += 1;
    start();
  }
}

function scheduleLocalImageRead(reader: () => Promise<LocalImageReadResult>) {
  return new Promise<LocalImageReadResult>((resolve) => {
    localImageReadQueue.push(() => {
      void reader()
        .then(resolve)
        .catch(() => resolve({ ok: false, error: "图片不存在或读取失败" }))
        .finally(() => {
          activeLocalImageReads -= 1;
          drainLocalImageReadQueue();
        });
    });
    drainLocalImageReadQueue();
  });
}

export function readLocalImageDataUrl(filePath: string): Promise<LocalImageReadResult> {
  const key = String(filePath || "").trim();
  if (!key) return Promise.resolve<LocalImageReadResult>({ ok: false, error: "图片路径无效" });
  const cached = localImageDataCache.get(key);
  if (cached) return Promise.resolve({ ok: true, dataUrl: cached });
  const pending = localImageReads.get(key);
  if (pending) return pending;
  const reader = window.dyworker?.readLocalImage;
  if (!reader) return Promise.resolve<LocalImageReadResult>({ ok: false, error: "当前环境无法读取本地图片" });
  const request = scheduleLocalImageRead(() => reader(key))
    .then((result) => {
      if (result.ok && result.dataUrl) localImageDataCache.set(key, result.dataUrl);
      return result;
    })
    .finally(() => {
      if (localImageReads.get(key) === request) localImageReads.delete(key);
    });
  localImageReads.set(key, request);
  return request;
}

// 旧会话消息里 previewUrl 仍是内嵌缩略图：仅当没有可读的文件路径时用它兜底。
export function attachmentImageSource(attachment: Pick<Attachment, "path" | "previewUrl">): Promise<LocalImageReadResult> {
  if (attachment.path) return readLocalImageDataUrl(attachment.path);
  if (attachment.previewUrl) return Promise.resolve({ ok: true, dataUrl: attachment.previewUrl });
  return Promise.resolve<LocalImageReadResult>({ ok: false, error: "图片不存在或读取失败" });
}

// 优先走主进程原生剪贴板（clipboard.writeImage，粘贴到画图/聊天等应用最稳）；
// 不可用时回退到 Web 剪贴板图片格式，再不行回退为复制文件路径。
// 复制消息时图文一起进剪贴板：一次 clipboard.write({ text, image })，
// 粘贴到微信/备忘录/Word 等应用时文字和图片同时出现。图片读取失败时退化为纯文本复制。
export async function copyMessageWithImages(text: string, attachments: Array<Pick<Attachment, "path" | "previewUrl" | "isImage">>): Promise<boolean> {
  const image = attachments.find((attachment) => attachment.isImage && (attachment.path || attachment.previewUrl));
  const writer = window.dyworker?.writeClipboardRich;
  if (image && writer) {
    try {
      const source = await attachmentImageSource(image);
      const result = await writer({
        text,
        dataUrl: source.ok ? source.dataUrl : undefined,
        path: !source.ok && image.path ? image.path : undefined,
      });
      if (result?.ok) return true;
    } catch {
      // 图片读取或写入失败时退化为纯文本复制
    }
  }
  if (writer && text) {
    try {
      const result = await writer({ text });
      if (result?.ok) return true;
    } catch {
      // 继续走纯文本回退
    }
  }
  try {
    const result = await window.dyworker?.writeClipboardText?.(text);
    if (result?.ok) return true;
  } catch {
    // 渲染端回退
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 剪贴板不可用
  }
  return false;
}

export async function copyImageToClipboard(source: LocalImageReadResult, fallbackPath?: string): Promise<void> {
  const dataUrl = source.ok && source.dataUrl ? source.dataUrl : "";
  const nativeWriter = window.dyworker?.writeClipboardImage;
  if (nativeWriter && (dataUrl || fallbackPath)) {
    try {
      const result = await nativeWriter({ dataUrl: dataUrl || undefined, path: fallbackPath });
      if (result?.ok) return;
    } catch {
      // 继续走 Web 剪贴板回退
    }
  }
  if (dataUrl) {
    try {
      const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
      if (match && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const mime = match[1];
        const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
        // PNG 通用性最好（macOS 粘贴到第三方应用只认 PNG/TIFF）；其它格式直接原样写入
        const blob = new Blob([bytes], { type: mime });
        if (mime === "image/png") {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          return;
        }
        try {
          const converted = await convertBlobToPng(blob);
          await navigator.clipboard.write([new ClipboardItem({ "image/png": converted })]);
          return;
        } catch {
          await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
          return;
        }
      }
    } catch {
      // 继续走路径回退
    }
  }
  if (fallbackPath) {
    await navigator.clipboard?.writeText?.(fallbackPath);
    return;
  }
  throw new Error(source.error || "图片无法复制");
}

async function convertBlobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas 不可用");
    context.drawImage(bitmap, 0, 0);
    const converted = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!converted) throw new Error("图片转码失败");
    return converted;
  } finally {
    bitmap.close();
  }
}

// 共享的附件原图加载逻辑：进入视口才读盘，气泡与输入区 chip 复用。
export function useAttachmentImage(attachment: Pick<Attachment, "path" | "previewUrl" | "name">, containerRef?: { current: Element | null }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "loaded"; dataUrl: string } | { status: "error"; error: string }>({ status: "loading" });
  const [shouldLoad, setShouldLoad] = useState(false);
  const cacheKey = attachment.path || attachment.previewUrl || "";

  useEffect(() => {
    const element = containerRef?.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry?.isIntersecting) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: "400px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [cacheKey, containerRef]);

  useEffect(() => {
    if (!shouldLoad) {
      setState({ status: "loading" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    void attachmentImageSource(attachment).then((result) => {
      if (!active) return;
      if (result.ok && result.dataUrl) setState({ status: "loaded", dataUrl: result.dataUrl });
      else setState({ status: "error", error: result.error || "图片无法显示" });
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, shouldLoad]);

  return state;
}

// 输入区附件条里的小缩略图（点击预览原图）
export function ImageAttachmentThumb({ attachment, onPreview }: {
  attachment: Attachment;
  onPreview?: (payload: { url: string; name: string; path?: string }) => void;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const state = useAttachmentImage(attachment, containerRef);
  const name = attachment.name || "图片";
  return (
    <span ref={containerRef} className="attachment-thumb-wrap">
      {state.status === "loaded" ? (
        <img
          className="attachment-preview-image clickable"
          src={state.dataUrl}
          alt="待发送的图片，点击预览"
          title="点击预览图片"
          onClick={() => onPreview?.({ url: state.dataUrl, name, path: attachment.path })}
        />
      ) : (
        <span className={`attachment-image-status compact${state.status === "error" ? " error" : ""}`}>
          {state.status === "loading" ? "加载中…" : "图片无法显示"}
        </span>
      )}
    </span>
  );
}

export function ImageAttachmentView({ attachment, onPreview }: {
  attachment: Attachment;
  onPreview?: (payload: { url: string; name: string; path?: string }) => void;
}) {
  const [state, setState] = useState<{ status: "loading" } | { status: "loaded"; dataUrl: string } | { status: "error"; error: string }>({ status: "loading" });
  const [shouldLoad, setShouldLoad] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLElement>(null);
  const cacheKey = attachment.path || attachment.previewUrl || "";

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry?.isIntersecting) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: "400px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [cacheKey]);

  useEffect(() => {
    if (!shouldLoad) {
      setState({ status: "loading" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    void attachmentImageSource(attachment).then((result) => {
      if (!active) return;
      if (result.ok && result.dataUrl) setState({ status: "loaded", dataUrl: result.dataUrl });
      else setState({ status: "error", error: result.error || "图片无法显示" });
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, shouldLoad]);

  const name = attachment.name || "图片";
  const openPreview = () => {
    if (state.status !== "loaded") return;
    onPreview?.({ url: state.dataUrl, name, path: attachment.path });
  };
  const copyImage = async () => {
    if (state.status !== "loaded") return;
    try {
      await copyImageToClipboard({ ok: true, dataUrl: state.dataUrl }, attachment.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 复制失败时不打扰用户，按钮保持原样
    }
  };

  return (
    <figure
      ref={containerRef}
      className={`message-attachment-image${state.status === "loaded" ? " clickable" : ""}`}
      aria-label="图片附件，点击预览"
      role={state.status === "loaded" ? "button" : undefined}
      tabIndex={state.status === "loaded" ? 0 : undefined}
      title={state.status === "loaded" ? "点击预览原图" : undefined}
      onClick={openPreview}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPreview();
        }
      }}
    >
      {state.status === "loaded" ? (
        <img className="attachment-preview-image" src={state.dataUrl} alt={name} />
      ) : (
        <span className={`attachment-image-status${state.status === "error" ? " error" : ""}`}>
          {state.status === "loading" ? "正在加载图片…" : state.error}
        </span>
      )}
      {state.status === "loaded" && (
        <button
          type="button"
          className="attachment-image-copy"
          title={copied ? "已复制" : "复制图片"}
          aria-label={copied ? "已复制图片" : "复制图片"}
          onClick={(event) => {
            event.stopPropagation();
            void copyImage();
          }}
        >
          <Copy size={13} />
          {copied ? "已复制" : "复制"}
        </button>
      )}
    </figure>
  );
}
