import { promises as fs } from "node:fs";
import path from "node:path";

const textExtensions = new Set([
  ".c", ".cc", ".cpp", ".css", ".csv", ".go", ".h", ".hpp", ".html", ".ini", ".java", ".js", ".json",
  ".jsx", ".log", ".md", ".mjs", ".py", ".rs", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);
const mimeTypes = new Map([
  [".bmp", "image/bmp"], [".gif", "image/gif"], [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"],
  [".png", "image/png"], [".webp", "image/webp"], [".csv", "text/csv"], [".html", "text/html"],
  [".json", "application/json"], [".md", "text/markdown"], [".txt", "text/plain"], [".xml", "application/xml"],
  [".silk", "audio/silk"], [".wav", "audio/wav"], [".mp3", "audio/mpeg"], [".m4a", "audio/mp4"],
  [".aac", "audio/aac"], [".ogg", "audio/ogg"], [".opus", "audio/opus"], [".amr", "audio/amr"],
]);

export function attachmentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return mimeTypes.get(extension) || (textExtensions.has(extension) ? "text/plain" : "application/octet-stream");
}

export async function describeAttachment(filePath) {
  const stat = await fs.stat(filePath);
  const mimeType = attachmentType(filePath);
  const isImage = mimeType.startsWith("image/");
  const extension = path.extname(filePath).toLowerCase();
  const isVoice = mimeType.startsWith("audio/") || extension === ".silk";
  // 不再内嵌缩略图：previewUrl 会随会话存档落盘，大图会让存档体积翻倍；
  // 渲染层统一走 local-image:read 按原尺寸读取，气泡/预览/复制共用同一份原图。
  return {
    name: path.basename(filePath),
    path: filePath,
    size: stat.size,
    mimeType,
    isImage,
    isVoice,
  };
}

export async function providerMessageContent(message) {
  let text = String(message?.content || "").trim();
  const imageBlocks = [];
  // assistant 消息里的图片附件大多是展示/出站媒体（如渠道回复附带的截图），
  // 不是需要回传给模型的输入；DeepSeek 视觉模型也拒绝 assistant 消息携带图片（400）。
  // 因此对 assistant 角色只保留文本，不把图片展开成 image 块，避免模型输入被服务端拒绝。
  if (message?.role === "assistant") return text || "请处理已选择的附件。";
  if (Array.isArray(message?.dshAttachments) && message.dshAttachments.length) {
    const parts = message.dshAttachments.map(part => {
      if (part?.type === 'file' && typeof part.receiptId === 'string' && part.receiptId) return {type:'dsh-file-receipt', receiptId:part.receiptId};
      if (part?.type === 'image' && ['image/png','image/jpeg','image/webp','image/gif'].includes(part.mediaType)
        && typeof part.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(part.data))
        return {type:'image_url', image_url:{url:`data:${part.mediaType};base64,${part.data}`}, ...(part.name ? {name:part.name}: {})};
      throw new Error('DSH 浏览器附件格式无效');
    });
    return [...(text ? [{type:'text',text}]:[]), ...parts];
  }
  for (const attachment of Array.isArray(message?.attachments) ? message.attachments : []) {
    const filePath = String(attachment?.path || "");
    if (!filePath) continue;
    try {
      const stat = await fs.stat(filePath);
      const mimeType = attachmentType(filePath);
      if (mimeType.startsWith("image/")) {
        if (stat.size > 12 * 1024 * 1024) {
          text += `\n\n[图片 ${path.basename(filePath)} 超过 12 MB，未发送]`;
          continue;
        }
        const encoded = (await fs.readFile(filePath)).toString("base64");
        imageBlocks.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${encoded}` } });
      } else if (textExtensions.has(path.extname(filePath).toLowerCase())) {
        if (stat.size > 2 * 1024 * 1024) {
          text += `\n\n[文本附件 ${path.basename(filePath)} 超过 2 MB，未展开]`;
          continue;
        }
        const content = await fs.readFile(filePath, "utf8");
        text += `\n\n--- 附件：${path.basename(filePath)} ---\n${content}`;
      } else {
        text += `\n\n[已选择附件 ${path.basename(filePath)}；当前通用模型接口仅直接读取文本和图片]`;
      }
    } catch (error: any) {
      text += `\n\n[附件 ${path.basename(filePath)} 读取失败：${error instanceof Error ? error.message : String(error)}]`;
    }
  }
  if (!imageBlocks.length) return text || "请处理已选择的附件。";
  return [{ type: "text", text: text || "请查看这些图片。" }, ...imageBlocks];
}
