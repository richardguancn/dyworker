import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const MAX_CLIPBOARD_IMAGE_BYTES = 12 * 1024 * 1024;

const imageTypes = new Map([
  ["image/bmp", ".bmp"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

export async function saveClipboardImage(payload, targetDirectory) {
  const mimeType = String(payload?.mimeType || "image/png").toLowerCase().split(";", 1)[0];
  const extension = imageTypes.get(mimeType);
  const data = payload?.data;
  if (!extension || !Array.isArray(data) || !data.length) {
    throw new Error("剪贴板中没有可用的图片");
  }
  if (data.length > MAX_CLIPBOARD_IMAGE_BYTES || data.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error("剪贴板图片过大或格式无效");
  }
  const filePath = path.join(targetDirectory, `clipboard-${randomUUID()}${extension}`);
  await fs.mkdir(targetDirectory, { recursive: true });
  await fs.writeFile(filePath, Buffer.from(data), { flag: "wx" });
  return {
    filePath,
    name: path.basename(filePath),
    mimeType,
    size: data.length,
  };
}
