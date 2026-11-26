// 插件分享与导入的渲染端通用辅助函数

export interface ShareDropInput {
  filePath?: string;
  dataBase64?: string;
  fileName?: string;
}

export function isShareArchiveName(name: string): boolean {
  return /\.(dyplugin|zip)$/i.test(String(name || "").trim());
}

export function formatShareBytes(bytes: number): string {
  const num = Number(bytes) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function hasDraggedShareFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  const items = Array.from(dataTransfer.items || []);
  if (items.some((item) => item.kind === "file")) return true;
  return Array.from(dataTransfer.types || []).includes("Files");
}

export async function extractDroppedShareFile(
  dataTransfer: DataTransfer | null | undefined,
): Promise<ShareDropInput | null> {
  const files = Array.from(dataTransfer?.files || []);
  const matched = files.find((file) => isShareArchiveName(file.name));
  if (!matched) return null;

  const bridge = typeof window !== "undefined" ? window.dyworker : undefined;
  const pathFromPreload = bridge?.getPathForFile?.(matched) || "";
  const legacyPath = typeof (matched as any).path === "string" ? String((matched as any).path) : "";
  const filePath = (pathFromPreload || legacyPath).trim();
  if (filePath) {
    return { filePath, fileName: matched.name };
  }

  const buf = await matched.arrayBuffer();
  return {
    dataBase64: arrayBufferToBase64(buf),
    fileName: matched.name,
  };
}

export async function copyShareText(text: string): Promise<boolean> {
  const value = String(text || "");
  if (!value) return false;
  try {
    const bridge = typeof window !== "undefined" ? window.dyworker : undefined;
    if (bridge?.writeClipboardText) {
      await bridge.writeClipboardText(value);
      return true;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 忽略剪贴板权限异常
  }
  return false;
}
