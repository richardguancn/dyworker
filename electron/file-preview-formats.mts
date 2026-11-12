export const previewImageTypes: Readonly<Record<string, string>> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".bmp": "image/bmp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".avif": "image/avif",
};
export const officePreviewExtensions = new Set([".doc", ".docx", ".docm", ".xlsx", ".xlsm", ".xls", ".ppt", ".pptx", ".pptm", ".rtf"]);
export const textPreviewExtensions = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".xml", ".log", ".js", ".jsx", ".ts", ".tsx", ".css", ".py", ".sql", ".sh", ".html", ".htm", ".ini", ".toml", ".c", ".cpp", ".h", ".java", ".go", ".rs", ".vue", ".svelte"]);

export function isPreviewableExtension(extension: string) {
  return extension === ".pdf" || Object.hasOwn(previewImageTypes, extension)
    || officePreviewExtensions.has(extension) || textPreviewExtensions.has(extension);
}
