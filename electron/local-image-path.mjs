const localImageExtensions = new Set([".bmp", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);

function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathFromFileUrl(source) {
  try {
    const url = new URL(source);
    if (url.protocol !== "file:") return "";
    const pathname = decodePath(url.pathname);
    if (/^\/[a-z]:\//i.test(pathname)) return pathname.slice(1);
    if (url.hostname && url.hostname !== "localhost") return `//${url.hostname}${pathname}`;
    return pathname;
  } catch {
    return "";
  }
}

function imageExtension(filePath) {
  const match = /(?:^|\/)(?:[^/]+)(\.[^.\/]+)$/.exec(filePath.replaceAll("\\", "/"));
  return match?.[1]?.toLowerCase() || "";
}

function isAbsoluteLocalPath(filePath) {
  return filePath.startsWith("/") || /^[a-z]:[\\/]/i.test(filePath) || /^\\\\[^\\]+\\[^\\]+/.test(filePath);
}

export function localImagePathFromSource(source) {
  const value = String(source || "").trim();
  if (!value) return "";
  const filePath = /^file:/i.test(value)
    ? pathFromFileUrl(value)
    : /^%5c/i.test(value)
      ? `\\${decodePath(value)}`
      : value;
  if (!filePath || !isAbsoluteLocalPath(filePath)) return "";
  return localImageExtensions.has(imageExtension(filePath)) ? filePath : "";
}

export function localImageMimeType(filePath) {
  const extension = imageExtension(filePath);
  if (extension === ".bmp") return "image/bmp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".jpeg" || extension === ".jpg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "";
}
