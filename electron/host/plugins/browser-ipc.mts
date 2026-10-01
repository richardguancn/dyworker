// IPC 域插件：内置浏览器（browser:*）。
// 密码库/清除数据/设备模拟都直接调域能力；webview 登记表是壳层状态，经 getter 注入
// （登记表在 web-contents-created 里维护，插件不持有）。
import { isSafeBrowserUrl } from "../../agent.mts";

export function browserIpcPlugin(deps) {
  return {
    name: "ipc:browser",
    apply(ctx) {
      const { trustedHandle, isTrustedRendererUrl, shell, session, readJson, writeJson, browserPasswordStorePath, safeStorage, getEmbeddedBrowserContents } = deps;

trustedHandle("browser:open", async (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "浏览器请求来源无效" };
  const check = isSafeBrowserUrl(String(payload?.url || ""));
  if (!check.ok) return { ok: false, result: check.error };
  return { ok: true, url: check.url.toString(), result: "已在当前浏览器标签页打开网页" };
});

trustedHandle("browser:open-external", async (event, rawUrl) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "请求来源无效" };
  const check = isSafeBrowserUrl(String(rawUrl || ""));
  if (!check.ok) return { ok: false, error: check.error };
  if (check.url.protocol !== "http:" && check.url.protocol !== "https:") {
    return { ok: false, error: "仅支持 http/https 地址" };
  }
  try {
    await shell.openExternal(check.url.toString());
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

trustedHandle("browser:save-password", async (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "请求来源无效" };
  const origin = String(payload?.origin || "").trim();
  const username = String(payload?.username || "").trim();
  const password = String(payload?.password || "");
  if (!/^https?:\/\//i.test(origin) || !password) return { ok: false, error: "来源或密码无效" };
  try {
    const existing = await readJson(browserPasswordStorePath(), []);
    const key = `${origin}\n${username}`;
    const known = existing.find((item) => `${item.origin}\n${item.username}` === key);
    const encrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(password).toString("base64")
      : "";
    if (known) {
      // 同站点同用户名：更新密码
      known.passwordEnc = encrypted;
      known.passwordPlain = safeStorage.isEncryptionAvailable() ? undefined : password;
      known.updatedAt = new Date().toISOString();
    } else {
      existing.push({
        origin,
        username,
        passwordEnc: encrypted,
        passwordPlain: safeStorage.isEncryptionAvailable() ? undefined : password,
        source: "内置浏览器",
        importedAt: new Date().toISOString(),
      });
    }
    await writeJson(browserPasswordStorePath(), existing);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

trustedHandle("browser:list-passwords", async (event, rawOrigin) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "请求来源无效" };
  const origin = String(rawOrigin || "").trim();
  try {
    const existing = await readJson(browserPasswordStorePath(), []);
    const passwords = existing
      .filter((item) => !origin || item.origin === origin)
      .map((item) => ({ origin: item.origin, username: item.username, source: item.source || "", importedAt: item.importedAt || "" }));
    return { ok: true, passwords };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

trustedHandle("browser:reveal-password", async (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "请求来源无效" };
  const origin = String(payload?.origin || "");
  const username = String(payload?.username || "");
  try {
    const existing = await readJson(browserPasswordStorePath(), []);
    const entry = existing.find((item) => item.origin === origin && item.username === username);
    if (!entry) return { ok: false, error: "没有找到这条密码" };
    const password = entry.passwordEnc && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(entry.passwordEnc, "base64"))
      : String(entry.passwordPlain || "");
    if (!password) return { ok: false, error: "密码数据损坏或系统加密不可用" };
    return { ok: true, password };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

trustedHandle("browser:delete-password", async (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "请求来源无效" };
  const origin = String(payload?.origin || "");
  const username = String(payload?.username || "");
  try {
    const existing = await readJson(browserPasswordStorePath(), []);
    const next = existing.filter((item) => !(item.origin === origin && item.username === username));
    await writeJson(browserPasswordStorePath(), next);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

trustedHandle("browser:clear-data", async (event, kinds) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "请求来源无效" };
  const wantCookies = kinds?.cookies !== false;
  const wantCache = kinds?.cache !== false;
  const wantSiteData = kinds?.siteData === true;
  if (!wantCookies && !wantCache && !wantSiteData) return { ok: false, error: "请至少选择一类数据" };
  try {
    const browserSession = session.fromPartition("persist:dyworker-browser");
    const storages = [];
    if (wantCookies) storages.push("cookies");
    if (wantSiteData) storages.push("localstorage", "indexeddb", "serviceworkers", "cachestorage", "websql", "filesystem");
    if (storages.length) await browserSession.clearStorageData({ storages });
    if (wantCache) await browserSession.clearCache();
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

trustedHandle("browser:emulate-device", async (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "请求来源无效" };
  const contents = getEmbeddedBrowserContents(Number(payload?.webContentsId) || 0);
  if (!contents || contents.isDestroyed()) return { ok: false, error: "页面已关闭" };
  const width = Number(payload?.width) || 0;
  const height = Number(payload?.height) || 0;
  if (!width || !height) {
    contents.disableDeviceEmulation();
    return { ok: true };
  }
  contents.enableDeviceEmulation({
    screenPosition: "mobile",
    screenSize: { width, height },
    viewSize: { width, height },
    deviceScaleFactor: 2,
  });
  return { ok: true };
});
    },
  };
}
