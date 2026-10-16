import { promises as fs } from "node:fs";
import { localImageMimeType, localImagePathFromSource } from "./local-image-path.mts";

export { localImagePathFromSource } from "./local-image-path.mts";

const defaultMaxBytes = 32 * 1024 * 1024;

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
