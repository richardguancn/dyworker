// 只允许应用自己的本地入口；开发环境额外允许指定开发服务器的同源页面。
export function isTrustedAppRendererUrl(
  rawUrl: unknown,
  localEntryUrl: string,
  developmentEntryUrl?: string,
): boolean {
  try {
    const actual = new URL(String(rawUrl || ""));
    const localEntry = new URL(localEntryUrl);
    if (actual.protocol === "file:") {
      return actual.host === localEntry.host && actual.pathname === localEntry.pathname;
    }
    if (!developmentEntryUrl || !["http:", "https:"].includes(actual.protocol)) return false;
    return actual.origin === new URL(developmentEntryUrl).origin;
  } catch {
    return false;
  }
}
