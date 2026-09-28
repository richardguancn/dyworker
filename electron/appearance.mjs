import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const APPEARANCE_VERSION = 1;

const IMAGE_ID_RE = /^[a-f0-9]{32}\.(png|jpe?g|webp)$/;
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const UI_SIZES = [13, 14, 16, 18];
const FONT_FORBIDDEN_RE = /["\\;{}<>()*/@]/;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function defaultAppearance() {
  return {
    version: APPEARANCE_VERSION,
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

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  const finite = finiteNumber(value, fallback);
  return Math.min(max, Math.max(min, finite));
}

function normalizeColor(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const color = value.trim();
  if (!COLOR_RE.test(color)) return null;
  const hex = color.slice(1).toLowerCase();
  if (hex.length === 3) return `#${hex.split("").map((ch) => ch + ch).join("")}`;
  if (hex.length === 8) return `#${hex.slice(0, 6)}`;
  return `#${hex}`;
}

function normalizeFamily(value) {
  if (typeof value !== "string") return "system";
  const family = value.trim();
  if (!family || family.length > 120) return "system";
  if (FONT_FORBIDDEN_RE.test(family)) return "system";
  for (let i = 0; i < family.length; i++) {
    const code = family.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return "system";
  }
  if (!/^[\p{L}\p{N}\s_.,&'’\-+、]+$/u.test(family)) return "system";
  return family;
}

function normalizeImageId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  return IMAGE_ID_RE.test(value) ? value : null;
}

function normalizeVersion(value) {
  if (value === null || value === undefined) return APPEARANCE_VERSION;
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  return APPEARANCE_VERSION;
}

// 完整校验并规范化外观配置。version 高于当前版本时返回 { settings, unknownVersion: true }，
// 调用方据此拒绝保存，避免用旧版本规则静默覆盖新版本的文件。
export function normalizeAppearance(input) {
  const source = input && typeof input === "object" ? input : {};
  if (normalizeVersion(source.version) > APPEARANCE_VERSION) {
    return { settings: defaultAppearance(), unknownVersion: true };
  }
  const background = source.background && typeof source.background === "object" ? source.background : {};
  const glass = source.glass && typeof source.glass === "object" ? source.glass : {};
  const typography = source.typography && typeof source.typography === "object" ? source.typography : {};
  return {
    version: APPEARANCE_VERSION,
    theme: pickEnum(source.theme, ["system", "light", "dark"], "system"),
    background: {
      lightColor: normalizeColor(background.lightColor),
      darkColor: normalizeColor(background.darkColor),
      transparency: clampNumber(background.transparency, 0, 70, 0),
      imageId: normalizeImageId(background.imageId),
      imageFit: pickEnum(background.imageFit, ["cover", "contain", "tile"], "cover"),
      overlay: clampNumber(background.overlay, 0, 80, 20),
    },
    glass: {
      enabled: glass.enabled === true,
      strength: pickEnum(glass.strength, ["subtle", "standard", "strong"], "standard"),
      lightweight: glass.lightweight === true,
      systemBackdrop: glass.systemBackdrop === true,
    },
    typography: {
      family: normalizeFamily(typography.family),
      uiSize: pickEnum(typography.uiSize, UI_SIZES, 14),
      contentSize: clampNumber(typography.contentSize, 14, 24, 16),
    },
  };
}

// ---- 原子读写与串行写链 ----

const writeChains = new Map();
const fileStates = new Map();

function chainFor(file, fn) {
  const previous = writeChains.get(file) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  writeChains.set(file, next);
  return next.finally(() => {
    if (writeChains.get(file) === next) writeChains.delete(file);
  });
}

function errorMessage(error) {
  return String(error?.message || error);
}

async function loadFromDisk(file) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { revision: 0, settings: defaultAppearance(), unknownVersion: false, version: 0, source: "default" };
    }
    return recoverCorruptFile(file);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return recoverCorruptFile(file);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return recoverCorruptFile(file);
  }
  if (normalizeVersion(parsed.version) > APPEARANCE_VERSION) {
    // 磁盘上已有更高版本的配置：保留 unknownVersion 标记，之后所有保存直接拒绝
    return {
      revision: 1,
      settings: defaultAppearance(),
      unknownVersion: true,
      version: normalizeVersion(parsed.version),
      source: "file",
    };
  }
  return {
    revision: 1,
    settings: normalizeAppearance(parsed),
    unknownVersion: false,
    version: APPEARANCE_VERSION,
    source: "file",
  };
}

async function recoverCorruptFile(file) {
  try {
    await fs.rename(file, `${file}.bak-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  } catch {
    // 备份失败（例如文件刚好被删）不阻塞恢复默认
  }
  return { revision: 0, settings: defaultAppearance(), unknownVersion: false, version: 0, source: "recovered" };
}

// 读操作幂等，并发加载同一文件最多重复一次读取，无需串行化；
// 写路径会把 ensureLoaded 放在写链内调用，避免读-改-写交错。
async function ensureLoaded(file) {
  const cached = fileStates.get(file);
  if (cached) return cached;
  const loaded = await loadFromDisk(file);
  fileStates.set(file, loaded);
  return loaded;
}

export async function readAppearance(file) {
  const state = await ensureLoaded(file);
  const result = {
    ok: true,
    settings: state.settings,
    revision: state.revision,
    source: state.source,
  };
  if (state.unknownVersion) result.unknownVersion = true;
  return result;
}

export async function saveAppearance(file, input, expectedRevision) {
  try {
    return await chainFor(file, async () => {
      const state = await ensureLoaded(file);
      if (state.unknownVersion) {
        return { ok: false, unknownVersion: true, settings: state.settings, revision: state.revision };
      }
      const normalized = normalizeAppearance(input);
      if (normalized.unknownVersion) {
        return { ok: false, unknownVersion: true, settings: state.settings, revision: state.revision };
      }
      if (Number.isFinite(expectedRevision) && expectedRevision !== state.revision) {
        return { ok: false, stale: true, settings: state.settings, revision: state.revision };
      }
      const nextRevision = state.revision + 1;
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(normalized, null, 2), "utf8");
      await fs.rename(temporary, file);
      state.revision = nextRevision;
      state.settings = normalized;
      state.version = APPEARANCE_VERSION;
      state.source = "file";
      return { ok: true, settings: normalized, revision: nextRevision };
    });
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

// ---- 图片资源 ----

function failInspect(message) {
  return { ok: false, error: message };
}

function inspectPng(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((byte, index) => buffer[index] !== byte)) return null;
  if (buffer.length < 33) return failInspect("PNG 文件不完整");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return failInspect("PNG 尺寸无效");
  let animated = false;
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") {
      animated = true;
      break;
    }
    offset += 12 + size;
  }
  return { ok: true, format: "png", width, height, animated };
}

function inspectJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) return null;
  let offset = 2;
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x00) {
      offset += 2;
      continue;
    }
    offset += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2) break;
    const isSof = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 7 > buffer.length) break;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (!width || !height) return failInspect("JPEG 尺寸无效");
      return { ok: true, format: "jpeg", width, height, animated: false };
    }
    if (marker === 0xda) break;
    offset += segmentLength;
  }
  return failInspect("JPEG 文件中找不到尺寸信息");
}

function inspectWebp(buffer) {
  if (buffer.length < 12) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    chunks.push({ type, size, start: offset + 8 });
    offset += 8 + size + (size % 2);
  }
  if (!chunks.length) return failInspect("WebP 文件不完整");
  const vp8x = chunks.find((chunk) => chunk.type === "VP8X");
  if (vp8x) {
    if (vp8x.size < 10 || vp8x.start + 10 > buffer.length) return failInspect("WebP 文件不完整");
    const flags = buffer[vp8x.start];
    const width = 1 + (buffer[vp8x.start + 4] | (buffer[vp8x.start + 5] << 8) | (buffer[vp8x.start + 6] << 16));
    const height = 1 + (buffer[vp8x.start + 7] | (buffer[vp8x.start + 8] << 8) | (buffer[vp8x.start + 9] << 16));
    if (!width || !height) return failInspect("WebP 尺寸无效");
    const animated = (flags & 0x02) !== 0 || chunks.some((chunk) => chunk.type === "ANIM");
    return { ok: true, format: "webp", width, height, animated };
  }
  const first = chunks[0];
  if (first.type === "VP8 ") {
    if (first.size < 10 || first.start + 10 > buffer.length) return failInspect("WebP 文件不完整");
    if (buffer[first.start + 3] !== 0x9d || buffer[first.start + 4] !== 0x01 || buffer[first.start + 5] !== 0x2a) {
      return failInspect("WebP 文件损坏");
    }
    const width = buffer.readUInt16LE(first.start + 6) & 0x3fff;
    const height = buffer.readUInt16LE(first.start + 8) & 0x3fff;
    if (!width || !height) return failInspect("WebP 尺寸无效");
    return { ok: true, format: "webp", width, height, animated: false };
  }
  if (first.type === "VP8L") {
    if (first.size < 5 || first.start + 5 > buffer.length) return failInspect("WebP 文件不完整");
    if (buffer[first.start] !== 0x2f) return failInspect("WebP 文件损坏");
    const b1 = buffer[first.start + 1];
    const b2 = buffer[first.start + 2];
    const b3 = buffer[first.start + 3];
    const b4 = buffer[first.start + 4];
    const width = 1 + (b1 | ((b2 & 0x3f) << 8));
    const height = 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
    if (!width || !height) return failInspect("WebP 尺寸无效");
    return { ok: true, format: "webp", width, height, animated: false };
  }
  return failInspect("不支持的 WebP 编码");
}

export async function inspectImageBuffer(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return failInspect("不是受支持的图片文件");
    return inspectPng(buffer) || inspectJpeg(buffer) || inspectWebp(buffer)
      || failInspect("只支持静态 PNG、JPEG、WebP 图片");
  } catch {
    return failInspect("图片文件损坏或格式不受支持");
  }
}

function resolveAssetPath(assetsDir, imageId) {
  if (typeof imageId !== "string" || !IMAGE_ID_RE.test(imageId)) return null;
  const root = path.resolve(assetsDir);
  const resolved = path.resolve(root, imageId);
  if (!resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

async function writeFileAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, data);
  await fs.rename(temporary, file);
}

// 导入本地图片为暂存资源：校验格式/尺寸/动图后写入 staging，返回资源 ID。
// options.process 可选：(buffer, { format, width, height }) => Promise<Buffer>，
// 主进程用它做 EXIF 方向纠正、缩放和去元数据重编码。
export async function importAppearanceImage(assetsDir, sourcePath, options = {}) {
  try {
    const size = Number.isFinite(options.fileSize)
      ? options.fileSize
      : (await fs.stat(sourcePath)).size;
    if (size > MAX_IMAGE_BYTES) {
      return { ok: false, error: "图片超过 20MB 大小限制，请换一张更小的图片" };
    }
    const buffer = await fs.readFile(sourcePath);
    const inspected = await inspectImageBuffer(buffer);
    if (!inspected.ok) return { ok: false, error: inspected.error };
    if (inspected.width * inspected.height > MAX_IMAGE_PIXELS) {
      return { ok: false, error: "图片像素总量超过 4000 万，请换一张更小的图片" };
    }
    if (inspected.animated) {
      return { ok: false, error: "暂不支持动图或多帧图片，请使用静态图片" };
    }
    let output = buffer;
    let finalFormat = inspected.format;
    let finalWidth = inspected.width;
    let finalHeight = inspected.height;
    if (typeof options.process === "function") {
      const processed = await options.process(buffer, {
        format: inspected.format,
        width: inspected.width,
        height: inspected.height,
      });
      if (!Buffer.isBuffer(processed) || !processed.length) {
        return { ok: false, error: "图片处理失败" };
      }
      output = processed;
      const rechecked = await inspectImageBuffer(output);
      if (rechecked.ok) {
        finalFormat = rechecked.format;
        finalWidth = rechecked.width;
        finalHeight = rechecked.height;
      }
    }
    const extension = finalFormat === "jpeg" ? "jpg" : finalFormat;
    const imageId = `${crypto.randomUUID().replace(/-/g, "")}.${extension}`;
    await writeFileAtomic(path.join(assetsDir, "staging", imageId), output);
    return { ok: true, imageId, width: finalWidth, height: finalHeight, staging: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function readAppearanceImage(assetsDir, imageId) {
  const resolved = resolveAssetPath(assetsDir, imageId);
  if (!resolved) return { ok: false, error: "图片 ID 不合法" };
  const extension = path.extname(resolved).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[extension];
  try {
    const data = await fs.readFile(resolved);
    return { ok: true, data, mime };
  } catch {
    // fall through to staging
  }
  try {
    const data = await fs.readFile(path.join(path.dirname(resolved), "staging", path.basename(resolved)));
    return { ok: true, data, mime };
  } catch {
    return { ok: false, error: "图片不存在或不可读" };
  }
}

export async function commitStagedImage(assetsDir, imageId) {
  const resolved = resolveAssetPath(assetsDir, imageId);
  if (!resolved) return { ok: false, error: "图片 ID 不合法" };
  const staged = path.join(path.dirname(resolved), "staging", path.basename(resolved));
  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.rename(staged, resolved);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function discardStagedImage(assetsDir, imageId) {
  const resolved = resolveAssetPath(assetsDir, imageId);
  if (!resolved) return { ok: false, error: "图片 ID 不合法" };
  const staged = path.join(path.dirname(resolved), "staging", path.basename(resolved));
  try {
    await fs.unlink(staged);
    return { ok: true, discarded: true };
  } catch (error) {
    if (error && error.code === "ENOENT") return { ok: true, discarded: false };
    return { ok: false, error: errorMessage(error) };
  }
}

export async function removeAppearanceImage(assetsDir, imageId) {
  const resolved = resolveAssetPath(assetsDir, imageId);
  if (!resolved) return { ok: false, error: "图片 ID 不合法" };
  try {
    await fs.unlink(resolved);
    return { ok: true, removed: true };
  } catch (error) {
    if (error && error.code === "ENOENT") return { ok: true, removed: false };
    return { ok: false, error: errorMessage(error) };
  }
}

// 清理正式区与 staging 区中不被引用的资源。只处理顶层文件，不下钻子目录；
// referencedIds 中的文件与被引用 id 之外的所有内容一律不动。
export async function collectOrphanAssets(assetsDir, referencedIds) {
  const referenced = new Set(
    (Array.isArray(referencedIds) ? referencedIds : []).filter((id) => typeof id === "string"),
  );
  const removed = [];
  const areas = [path.resolve(assetsDir), path.join(path.resolve(assetsDir), "staging")];
  for (const area of areas) {
    let entries;
    try {
      entries = await fs.readdir(area, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      return { ok: false, error: errorMessage(error), removed };
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!IMAGE_ID_RE.test(entry.name)) continue;
      if (referenced.has(entry.name)) continue;
      try {
        await fs.unlink(path.join(area, entry.name));
        removed.push(entry.name);
      } catch {
        // 单个文件删除失败不中断其余清理
      }
    }
  }
  return { ok: true, removed };
}
