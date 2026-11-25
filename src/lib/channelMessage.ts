import type { Attachment } from "../types";

export const CHANNEL_PREFIX_REGEX = /^(\[来自(?:QQ|微信|飞书|qq|wechat|feishu)[^\]]*\])\s*/i;

export type FileCardKind =
  | "word"
  | "excel"
  | "ppt"
  | "pdf"
  | "code"
  | "archive"
  | "video"
  | "text"
  | "generic";

export interface ResolvedFileAttachment {
  attachment: Attachment;
  displayName: string;
}

const WORD_EXTS = new Set(["doc", "docx", "wps", "rtf", "odt"]);
const EXCEL_EXTS = new Set(["xls", "xlsx", "csv", "et", "ods", "tsv"]);
const PPT_EXTS = new Set(["ppt", "pptx", "dps", "odp", "key"]);
const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts",
  "py", "go", "rs", "java", "c", "cc", "cpp", "h", "hpp", "cs", "rb", "php",
  "sh", "zsh", "bash", "json", "yaml", "yml", "toml", "xml",
  "html", "htm", "css", "scss", "sql", "ini", "env", "vue", "svelte",
]);
const ARCHIVE_EXTS = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "dmg", "iso"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v"]);
const TEXT_EXTS = new Set(["md", "markdown", "txt", "log", "rst"]);

function pathBasename(filePath: string): string {
  const normalized = String(filePath || "").replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function extractChannelPrefix(raw: string): {
  channelPrefix: string;
  channelLabel: string;
  body: string;
} {
  const text = String(raw || "").trim();
  const match = text.match(CHANNEL_PREFIX_REGEX);
  if (!match) {
    return { channelPrefix: "", channelLabel: "", body: text };
  }
  const channelPrefix = match[1];
  const channelLabel = channelPrefix.slice(1, -1).trim();
  const body = text.slice(match[0].length).trim();
  return { channelPrefix, channelLabel, body };
}

export function describeFileCardKind(fileName: string): { kind: FileCardKind; extLabel: string } {
  const base = pathBasename(fileName);
  const dotIndex = base.lastIndexOf(".");
  const rawExt = dotIndex > 0 ? base.slice(dotIndex + 1).trim() : "";
  const lower = rawExt.toLowerCase();

  let kind: FileCardKind = "generic";
  if (WORD_EXTS.has(lower)) kind = "word";
  else if (EXCEL_EXTS.has(lower)) kind = "excel";
  else if (PPT_EXTS.has(lower)) kind = "ppt";
  else if (lower === "pdf") kind = "pdf";
  else if (CODE_EXTS.has(lower)) kind = "code";
  else if (ARCHIVE_EXTS.has(lower)) kind = "archive";
  else if (VIDEO_EXTS.has(lower)) kind = "video";
  else if (TEXT_EXTS.has(lower)) kind = "text";

  const extLabel = /^[a-z0-9]{1,6}$/i.test(rawExt) ? rawExt.toUpperCase() : "FILE";
  return { kind, extLabel };
}

export function parseUserMessagePresentation(
  rawText: string,
  options: {
    hasImages: boolean;
    fileAttachments: Attachment[];
    isVoice: boolean;
  },
): {
  channelPrefix: string;
  channelLabel: string;
  visibleText: string;
  resolvedFiles: ResolvedFileAttachment[];
} {
  const { channelPrefix, channelLabel, body: initialBody } = extractChannelPrefix(rawText);
  let body = initialBody;
  let placeholderFileName = "";

  if (!options.isVoice) {
    if (options.fileAttachments.length > 0) {
      const filePlaceholder = body.match(/^\[文件:([^\]]+)\]$/);
      if (filePlaceholder) {
        placeholderFileName = filePlaceholder[1].trim();
        body = "";
      } else if (/^\[(?:附件|视频)\]$/.test(body)) {
        body = "";
      }
    }
    if (options.hasImages && body === "[图片]") {
      body = "";
    }
  }

  const resolvedFiles: ResolvedFileAttachment[] = options.fileAttachments.map((attachment) => {
    const rawName = String(attachment.name || "").trim();
    const fallbackName = pathBasename(attachment.path || "");
    const displayName = (
      options.fileAttachments.length === 1
      && placeholderFileName
      && placeholderFileName !== "附件"
      && rawName !== placeholderFileName
    )
      ? placeholderFileName
      : (rawName || fallbackName || "附件");
    return { attachment, displayName };
  });

  return {
    channelPrefix,
    channelLabel,
    visibleText: body,
    resolvedFiles,
  };
}
