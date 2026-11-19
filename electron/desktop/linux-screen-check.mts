import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

const execFileAsync = promisify(execFile);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const maxPngPixels = 40_000_000;

export type DecodedPng = { width: number, height: number, rgba: Buffer };
export type ScreenImage = { mimeType?: string, data?: string };
export type OcclusionWindow = {
  id: string, pid?: number, title?: string, x: number, y: number, width: number, height: number,
  viewable: boolean, hidden?: boolean, desktop?: boolean,
};
export type MainWindowState = {
  visible?: boolean, minimized?: boolean, focused?: boolean,
  bounds?: { x: number, y: number, width: number, height: number },
};
export type OcclusionVerdict =
  | { status: "clear" }
  | { status: "occluded", occluderTitle?: string, occluderPid?: number, isSelf: boolean, point: [number, number] }
  | { status: "unknown", reason: string };

function paethPredictor(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(base64: string): DecodedPng | null {
  if (typeof base64 !== "string" || !base64) return null;
  let buffer: Buffer;
  try { buffer = Buffer.from(base64, "base64"); }
  catch { return null; }
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(pngSignature)) return null;

  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = -1;
  let palette: Buffer | undefined;
  const idats: Buffer[] = [];
  let sawIend = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) return null;
    const data = buffer.subarray(start, end);
    if (type === "IHDR") {
      if (length !== 13) return null;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (!width || !height || width * height > maxPngPixels) return null;
      if (bitDepth !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
      if (![0, 2, 3, 4, 6].includes(colorType)) return null;
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      sawIend = true;
      break;
    }
    offset = end + 4;
  }
  if (!sawIend || !width || !height || !idats.length) return null;
  if (colorType === 3 && !palette) return null;

  let inflated: Buffer;
  try { inflated = inflateSync(Buffer.concat(idats)); }
  catch { return null; }

  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const stride = width * bpp;
  if (inflated.length !== (stride + 1) * height) return null;

  const rgba = Buffer.allocUnsafe(width * height * 4);
  let prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = inflated[rowStart];
    for (let i = 0; i < stride; i++) {
      const x = inflated[rowStart + 1 + i];
      const left = i >= bpp ? cur[i - bpp] : 0;
      const up = prev[i];
      const upLeft = i >= bpp ? prev[i - bpp] : 0;
      if (filter === 0) cur[i] = x;
      else if (filter === 1) cur[i] = (x + left) & 0xff;
      else if (filter === 2) cur[i] = (x + up) & 0xff;
      else if (filter === 3) cur[i] = (x + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) cur[i] = (x + paethPredictor(left, up, upLeft)) & 0xff;
      else return null;
    }
    const rowOut = y * width * 4;
    for (let x = 0; x < width; x++) {
      const dst = rowOut + x * 4;
      const src = x * bpp;
      if (colorType === 6) {
        rgba[dst] = cur[src]; rgba[dst + 1] = cur[src + 1]; rgba[dst + 2] = cur[src + 2]; rgba[dst + 3] = cur[src + 3];
      } else if (colorType === 2) {
        rgba[dst] = cur[src]; rgba[dst + 1] = cur[src + 1]; rgba[dst + 2] = cur[src + 2]; rgba[dst + 3] = 255;
      } else if (colorType === 4) {
        rgba[dst] = cur[src]; rgba[dst + 1] = cur[src]; rgba[dst + 2] = cur[src]; rgba[dst + 3] = cur[src + 1];
      } else if (colorType === 0) {
        rgba[dst] = cur[src]; rgba[dst + 1] = cur[src]; rgba[dst + 2] = cur[src]; rgba[dst + 3] = 255;
      } else {
        const pi = cur[src] * 3;
        if (pi + 2 >= palette!.length) return null;
        rgba[dst] = palette![pi]; rgba[dst + 1] = palette![pi + 1]; rgba[dst + 2] = palette![pi + 2]; rgba[dst + 3] = 255;
      }
    }
    [prev, cur] = [cur, prev];
  }

  return { width, height, rgba };
}

function pixelChanged(a: Buffer, b: Buffer, idx: number) {
  return (Math.abs(a[idx] - b[idx]) + Math.abs(a[idx + 1] - b[idx + 1]) + Math.abs(a[idx + 2] - b[idx + 2]) + Math.abs(a[idx + 3] - b[idx + 3])) > 24;
}

export function verifyLinuxTargetRegion({
  previousImage,
  freshImage,
  points,
}: {
  previousImage?: ScreenImage,
  freshImage?: ScreenImage,
  points: [number, number][],
}): { ok: true, imageSize?: { width: number, height: number } } | { ok: false, reason: string } {
  if (!previousImage?.data || !freshImage?.data) {
    return { ok: false, reason: "缺少最新窗口截图，请重新读取界面。" };
  }
  const prevPng = decodePng(previousImage.data);
  const freshPng = decodePng(freshImage.data);
  if (!prevPng || !freshPng) {
    return previousImage.data === freshImage.data
      ? { ok: true }
      : { ok: false, reason: "窗口截图已发生变化。请重新读取界面，再选择操作目标。" };
  }
  if (prevPng.width !== freshPng.width || prevPng.height !== freshPng.height) {
    return { ok: false, reason: "目标窗口尺寸已发生变化。请重新读取界面，再选择操作目标。" };
  }
  const { width, height } = freshPng;
  const radius = 32;
  for (const [rawX, rawY] of points) {
    const cx = Math.round(rawX);
    const cy = Math.round(rawY);
    const x0 = Math.max(0, cx - radius);
    const x1 = Math.min(width - 1, cx + radius);
    const y0 = Math.max(0, cy - radius);
    const y1 = Math.min(height - 1, cy + radius);
    let total = 0;
    let changed = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        total++;
        if (pixelChanged(prevPng.rgba, freshPng.rgba, (y * width + x) * 4)) changed++;
      }
    }
    if (changed > Math.max(8, Math.floor(total * 0.015))) {
      return { ok: false, reason: "点击目标区域画面已发生变化，可能发生滚动、切换、弹窗或遮挡。请重新读取界面，再选择操作目标。" };
    }
  }

  // Catch whole-page scroll or view switch even when the click patch happens to land in uniform whitespace.
  const step = Math.max(4, Math.floor(Math.min(width, height) / 48));
  let samples = 0;
  let globalChanged = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      samples++;
      if (pixelChanged(prevPng.rgba, freshPng.rgba, (y * width + x) * 4)) globalChanged++;
    }
  }
  if (samples > 0 && globalChanged / samples > 0.25) {
    return { ok: false, reason: "页面画面发生大范围变化（可能已滚动或切换内容）。请重新读取界面，再选择操作目标。" };
  }
  return { ok: true, imageSize: { width, height } };
}

export function parseXpropStacking(text: string): string[] {
  const line = String(text || "").split("\n").find(item => item.includes("_NET_CLIENT_LIST_STACKING")) || "";
  return [...line.matchAll(/0x[0-9a-f]+/gi)].map(match => match[0].toLowerCase());
}

export function parseXwininfoGeometry(text: string): Omit<OcclusionWindow, "id"> | null {
  const raw = String(text || "");
  const x = /Absolute upper-left X:\s*(-?\d+)/.exec(raw)?.[1];
  const y = /Absolute upper-left Y:\s*(-?\d+)/.exec(raw)?.[1];
  const width = /Width:\s*(\d+)/.exec(raw)?.[1];
  const height = /Height:\s*(\d+)/.exec(raw)?.[1];
  if (!x || !y || !width || !height) return null;
  const titleMatch = /Window id:\s*0x[0-9a-f]+\s+"(.*)"(?=\r?\n|$)/i.exec(raw);
  return {
    title: titleMatch?.[1],
    x: Number(x),
    y: Number(y),
    width: Number(width),
    height: Number(height),
    viewable: /Map State:\s*IsViewable/.test(raw),
  };
}

export function parseXpropMeta(text: string) {
  const raw = String(text || "");
  const pidMatch = /_NET_WM_PID\([^)]+\)\s*=\s*(\d+)/.exec(raw);
  return {
    pid: pidMatch ? Number(pidMatch[1]) : undefined,
    hidden: /_NET_WM_STATE_HIDDEN/.test(raw),
    desktop: /_NET_WM_WINDOW_TYPE_DESKTOP/.test(raw),
  };
}

export function evaluateWindowStackOcclusion({
  windowsBottomToTop,
  targetPid,
  points,
  imageSize,
  mainWindowState,
  selfPid,
}: {
  windowsBottomToTop: OcclusionWindow[],
  targetPid: number,
  points: [number, number][],
  imageSize?: { width: number, height: number },
  mainWindowState?: MainWindowState,
  selfPid?: number,
}): OcclusionVerdict {
  const candidates = windowsBottomToTop
    .map((win, index) => ({ win, index }))
    .filter(({ win }) => win.pid === targetPid && win.viewable && !win.hidden && !win.desktop);
  if (!candidates.length) {
    return { status: "unknown", reason: "未能在桌面窗口栈中确认目标应用可见窗口" };
  }
  const matchedSize = imageSize
    ? candidates.filter(({ win }) => Math.abs(win.width - imageSize.width) <= 32 && Math.abs(win.height - imageSize.height) <= 32)
    : [];
  const target = (matchedSize.length ? matchedSize : candidates).at(-1)!;
  const above = windowsBottomToTop.slice(target.index + 1)
    .filter(win => win.viewable && !win.hidden && !win.desktop && win.width > 1 && win.height > 1);

  for (const [px, py] of points) {
    const sx = target.win.x + px;
    const sy = target.win.y + py;
    for (let i = above.length - 1; i >= 0; i--) {
      const win = above[i];
      if (sx >= win.x && sx < win.x + win.width && sy >= win.y && sy < win.y + win.height) {
        return {
          status: "occluded",
          occluderTitle: win.title,
          occluderPid: win.pid,
          isSelf: selfPid !== undefined && win.pid === selfPid,
          point: [px, py],
        };
      }
    }
    const own = mainWindowState?.bounds;
    if (mainWindowState?.visible && !mainWindowState.minimized && mainWindowState.focused && own && targetPid !== selfPid
      && sx >= own.x && sx < own.x + own.width && sy >= own.y && sy < own.y + own.height) {
      return {
        status: "occluded",
        occluderTitle: "DYWorker",
        occluderPid: selfPid,
        isSelf: true,
        point: [px, py],
      };
    }
  }
  return { status: "clear" };
}

export function createLinuxOcclusionChecker({
  exec = execFileAsync,
  getMainWindowState,
  selfPid = process.pid,
}: {
  exec?: typeof execFileAsync,
  getMainWindowState?: () => MainWindowState | undefined,
  selfPid?: number,
} = {}) {
  return async ({ pid, points, imageSize }: {
    pid: number,
    points: [number, number][],
    imageSize?: { width: number, height: number },
  }): Promise<OcclusionVerdict> => {
    try {
      const { stdout: stackOut } = await exec("xprop", ["-root", "_NET_CLIENT_LIST_STACKING"], { timeout: 800 });
      const ids = parseXpropStacking(String(stackOut || ""));
      if (!ids.length) return { status: "unknown", reason: "未能读取到桌面窗口层级列表" };
      const inspected = await Promise.all(ids.map(async (id): Promise<OcclusionWindow | null> => {
        try {
          const [{ stdout: geoOut }, { stdout: metaOut }] = await Promise.all([
            exec("xwininfo", ["-id", id], { timeout: 800 }),
            exec("xprop", ["-id", id, "_NET_WM_PID", "_NET_WM_STATE", "_NET_WM_WINDOW_TYPE"], { timeout: 800 }),
          ]);
          const geo = parseXwininfoGeometry(String(geoOut || ""));
          if (!geo) return null;
          const meta = parseXpropMeta(String(metaOut || ""));
          return { id, ...geo, ...meta };
        } catch {
          return null;
        }
      }));
      const windows = inspected.filter((item): item is OcclusionWindow => Boolean(item));
      return evaluateWindowStackOcclusion({
        windowsBottomToTop: windows,
        targetPid: pid,
        points,
        imageSize,
        mainWindowState: getMainWindowState?.(),
        selfPid,
      });
    } catch {
      return { status: "unknown", reason: "无法查询当前 X11 窗口遮挡状态" };
    }
  };
}
