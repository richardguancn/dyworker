import { promises as fs } from "node:fs";
import { localImageMimeType, localImagePathFromSource } from "./local-image-path.mts";

export { localImagePathFromSource } from "./local-image-path.mts";

const defaultMaxBytes = 32 * 1024 * 1024;

export const MODEL_IMAGE_MAX_EDGE = 2048;
export const MODEL_IMAGE_TARGET_BYTES = 1_200_000;
export const MODEL_IMAGE_HARD_MAX_BYTES = 2_600_000;
export const MODEL_IMAGE_DATA_URL_MAX_CHARS = 3_600_000;
export const MODEL_TOTAL_IMAGES_MAX_CHARS = 10_000_000;

let cachedNativeImage: any = null;
async function getElectronNativeImage(override?: any) {
  if (override !== undefined) return override;
  if (cachedNativeImage !== null) return cachedNativeImage || null;
  try {
    const mod = await import("electron");
    cachedNativeImage = mod?.nativeImage || false;
  } catch {
    cachedNativeImage = false;
  }
  return cachedNativeImage || null;
}

export function detectImageDimensions(buffer: Buffer, mimeType = "", nativeImageImpl?: any): { width: number; height: number } | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return null;
  // PNG: 8-byte signature + IHDR chunk (width at offset 16, height at offset 20)
  if (
    (mimeType === "image/png" || !mimeType)
    && buffer.length >= 24
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
  }
  // GIF: GIF87a / GIF89a (little-endian uint16 at 6..10)
  if ((mimeType === "image/gif" || !mimeType) && buffer.length >= 10 && /^GIF8[79]a/.test(buffer.subarray(0, 6).toString("ascii"))) {
    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    if (width > 0 && height > 0) return { width, height };
  }
  // JPEG: scan SOF0/SOF2 markers
  if ((mimeType === "image/jpeg" || !mimeType) && buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        if (offset + 9 <= buffer.length) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          if (width > 0 && height > 0) return { width, height };
        }
        break;
      }
      offset += 2 + segmentLength;
    }
  }
  if (nativeImageImpl?.createFromBuffer) {
    try {
      const image = nativeImageImpl.createFromBuffer(buffer);
      if (image && !image.isEmpty?.()) {
        const size = image.getSize?.();
        if (size?.width > 0 && size?.height > 0) return { width: size.width, height: size.height };
      }
    } catch {
      // Ignore native decoder failures when probing dimensions.
    }
  }
  return null;
}

function resizeImageToMaxEdge(image: any, width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height);
  if (!(longest > maxEdge) || typeof image?.resize !== "function") {
    return { image, width, height };
  }
  const targetWidth = Math.max(1, Math.round((width * maxEdge) / longest));
  const targetHeight = Math.max(1, Math.round((height * maxEdge) / longest));
  const resized = image.resize({ width: targetWidth, height: targetHeight, quality: "good" });
  const size = resized?.getSize?.();
  return {
    image: resized || image,
    width: size?.width > 0 ? size.width : targetWidth,
    height: size?.height > 0 ? size.height : targetHeight,
  };
}

export async function compressImageBufferForModel(
  buffer: Buffer,
  mimeType: string,
  options: {
    maxEdge?: number;
    targetBytes?: number;
    hardMaxBytes?: number;
    nativeImageImpl?: any;
  } = {},
): Promise<{ ok: boolean; buffer?: Buffer; mimeType?: string; compressed?: boolean; error?: string }> {
  const maxEdge = Math.max(256, Number(options.maxEdge) || MODEL_IMAGE_MAX_EDGE);
  const targetBytes = Math.max(64 * 1024, Number(options.targetBytes) || MODEL_IMAGE_TARGET_BYTES);
  const hardMaxBytes = Math.max(targetBytes, Number(options.hardMaxBytes) || MODEL_IMAGE_HARD_MAX_BYTES);

  const probed = detectImageDimensions(buffer, mimeType, options.nativeImageImpl);
  const probedLongest = probed ? Math.max(probed.width, probed.height) : 0;
  if (buffer.length <= targetBytes && (!probed || probedLongest <= maxEdge)) {
    return { ok: true, buffer, mimeType, compressed: false };
  }

  const nativeImage = await getElectronNativeImage(options.nativeImageImpl);
  if (!nativeImage?.createFromBuffer) {
    if (buffer.length <= hardMaxBytes) return { ok: true, buffer, mimeType, compressed: false };
    return { ok: false, error: "图片体积过大，超出模型单图限制（请缩小分辨率或压缩后再试）" };
  }

  let decoded: any;
  try {
    decoded = nativeImage.createFromBuffer(buffer);
  } catch {
    decoded = null;
  }
  if (!decoded || decoded.isEmpty?.()) {
    if (buffer.length <= hardMaxBytes) return { ok: true, buffer, mimeType, compressed: false };
    return { ok: false, error: "图片体积过大，超出模型单图限制（请缩小分辨率或压缩后再试）" };
  }

  const rawSize = decoded.getSize?.() || probed || { width: 0, height: 0 };
  const rawWidth = Number(rawSize.width) || 0;
  const rawHeight = Number(rawSize.height) || 0;
  const rawLongest = Math.max(rawWidth, rawHeight);

  if (buffer.length <= targetBytes && rawLongest <= maxEdge) {
    return { ok: true, buffer, mimeType, compressed: false };
  }

  const scaled = resizeImageToMaxEdge(decoded, rawWidth, rawHeight, maxEdge);
  const didResize = scaled.image !== decoded;
  let best: { buffer: Buffer; mimeType: string } | null = null;
  const recordCandidate = (candidateBuffer: any, candidateMime: string) => {
    if (!Buffer.isBuffer(candidateBuffer) || candidateBuffer.length === 0) return;
    if (!best || candidateBuffer.length < best.buffer.length) {
      best = { buffer: candidateBuffer, mimeType: candidateMime };
    }
  };

  if (mimeType === "image/png" && typeof scaled.image?.toPNG === "function") {
    const pngBuffer = scaled.image.toPNG();
    if (Buffer.isBuffer(pngBuffer) && pngBuffer.length > 0) {
      recordCandidate(pngBuffer, "image/png");
      if (pngBuffer.length <= targetBytes) {
        return {
          ok: true,
          buffer: pngBuffer,
          mimeType: "image/png",
          compressed: didResize || pngBuffer.length !== buffer.length,
        };
      }
    }
  }

  const jpegStages: Array<{ edgeLimit?: number; quality: number }> = [
    { quality: 85 },
    { quality: 72 },
    { edgeLimit: 1600, quality: 72 },
    { edgeLimit: 1280, quality: 65 },
    { edgeLimit: 960, quality: 60 },
  ];

  for (const stage of jpegStages) {
    let target = scaled;
    if (stage.edgeLimit) {
      const currentLongest = Math.max(scaled.width, scaled.height);
      if (currentLongest <= stage.edgeLimit) continue;
      target = resizeImageToMaxEdge(scaled.image, scaled.width, scaled.height, stage.edgeLimit);
    }
    if (typeof target.image?.toJPEG !== "function") continue;
    const jpegBuffer = target.image.toJPEG(stage.quality);
    if (!Buffer.isBuffer(jpegBuffer) || jpegBuffer.length === 0) continue;
    recordCandidate(jpegBuffer, "image/jpeg");
    if (jpegBuffer.length <= targetBytes) {
      return { ok: true, buffer: jpegBuffer, mimeType: "image/jpeg", compressed: true };
    }
  }

  if (best) {
    if (best.buffer.length > buffer.length && buffer.length <= hardMaxBytes && rawLongest <= maxEdge) {
      return { ok: true, buffer, mimeType, compressed: false };
    }
    if (best.buffer.length <= hardMaxBytes) {
      return { ok: true, buffer: best.buffer, mimeType: best.mimeType, compressed: true };
    }
    return { ok: false, error: "图片压缩后仍超出模型单图体积限制" };
  }

  if (buffer.length <= hardMaxBytes) return { ok: true, buffer, mimeType, compressed: false };
  return { ok: false, error: "图片压缩后仍超出模型单图体积限制" };
}

const MODEL_IMAGE_DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp|gif|bmp));base64,([A-Za-z0-9+/=\s]+)$/i;

export async function compressImageDataUrlForModel(
  dataUrl: string,
  options: {
    maxEdge?: number;
    targetBytes?: number;
    hardMaxBytes?: number;
    nativeImageImpl?: any;
  } = {},
): Promise<string | null> {
  const match = MODEL_IMAGE_DATA_URL_PATTERN.exec(String(dataUrl || "").trim());
  if (!match) return null;
  const cleanBase64 = match[2].replace(/\s+/g, "");
  const buffer = Buffer.from(cleanBase64, "base64");
  if (!buffer.length) return null;
  const compressed = await compressImageBufferForModel(buffer, match[1].toLowerCase(), options);
  if (!compressed.ok) return null;
  if (!compressed.compressed && match[1].toLowerCase() === compressed.mimeType) {
    return `data:${compressed.mimeType};base64,${cleanBase64}`;
  }
  return `data:${compressed.mimeType};base64,${compressed.buffer.toString("base64")}`;
}

export async function readLocalImageForModel(
  source: string,
  options: {
    maxReadBytes?: number;
    maxEdge?: number;
    targetBytes?: number;
    hardMaxBytes?: number;
    nativeImageImpl?: any;
  } = {},
): Promise<{ ok: boolean; dataUrl?: string; mimeType?: string; compressed?: boolean; error?: string }> {
  const raw = await readLocalImageData(source, { maxBytes: options.maxReadBytes ?? defaultMaxBytes });
  if (!raw.ok || !raw.dataUrl) {
    return { ok: false, error: raw.error || "图片无法读取" };
  }
  const match = MODEL_IMAGE_DATA_URL_PATTERN.exec(raw.dataUrl);
  if (!match) return { ok: false, error: "图片格式无法识别" };
  const buffer = Buffer.from(match[2], "base64");
  const compressed = await compressImageBufferForModel(buffer, match[1].toLowerCase(), options);
  if (!compressed.ok || !compressed.buffer || !compressed.mimeType) {
    return { ok: false, error: compressed.error || "图片压缩失败" };
  }
  if (!compressed.compressed) {
    return { ok: true, dataUrl: raw.dataUrl, mimeType: compressed.mimeType, compressed: false };
  }
  return {
    ok: true,
    dataUrl: `data:${compressed.mimeType};base64,${compressed.buffer.toString("base64")}`,
    mimeType: compressed.mimeType,
    compressed: true,
  };
}

export async function readLocalImageData(source, { maxBytes = defaultMaxBytes } = {} as any) {
  const filePath = localImagePathFromSource(source);
  if (!filePath) return { ok: false, error: "不是可显示的本地图片地址" };
  const candidates = [filePath];
  if (filePath.includes("%")) {
    try {
      const decoded = decodeURIComponent(filePath);
      if (decoded !== filePath && localImagePathFromSource(decoded)) candidates.push(decoded);
    } catch {
      // Keep the literal path when percent escapes are malformed.
    }
  }
  for (const candidate of candidates) {
    let stat;
    try {
      stat = await fs.stat(candidate);
    } catch (error: any) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") continue;
      return { ok: false, error: "图片不存在或读取失败" };
    }
    if (!stat.isFile()) return { ok: false, error: "图片不存在或不是文件" };
    if (stat.size > maxBytes) return { ok: false, error: "图片过大，无法在对话中显示" };
    try {
      const content = await fs.readFile(candidate);
      if (content.length > maxBytes) return { ok: false, error: "图片过大，无法在对话中显示" };
      const mimeType = localImageMimeType(candidate) || (
        content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" :
        content[0] === 255 && content[1] === 216 && content[2] === 255 ? "image/jpeg" :
        /^GIF8[79]a/.test(content.subarray(0, 6).toString("ascii")) ? "image/gif" :
        content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp" : "");
      if (!mimeType) return { ok: false, error: "图片格式无法识别" };
      return {
        ok: true,
        dataUrl: `data:${mimeType};base64,${content.toString("base64")}`,
      };
    } catch {
      return { ok: false, error: "图片不存在或读取失败" };
    }
  }
  return { ok: false, error: "图片不存在或读取失败" };
}

export function registerLocalImageIpc(ipc, { isTrustedSender = () => false } = {} as any) {
  ipc.handle("local-image:read", (event, source) => {
    if (!isTrustedSender(event)) return { ok: false, error: "当前页面不允许读取本地图片" };
    return readLocalImageData(source);
  });
}
