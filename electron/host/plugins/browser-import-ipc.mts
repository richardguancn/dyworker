// IPC 域插件：浏览器数据导入（browser-import:*）。
// 导入能力直接 import browser-import.mts；落盘位置与读写由壳层边界注入。
import { importBrowserData, listImportableBrowsers } from "../../browser-import.mts";

export function browserImportIpcPlugin(deps) {
  return {
    name: "ipc:browser-import",
    apply(ctx) {
      const { trustedHandle, isTrustedRendererUrl, app, path, readJson, writeJson, session, safeStorage } = deps;

trustedHandle("browser-import:list", async (event) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return [];
  const browsers = await listImportableBrowsers();
  // keyNames 只用于主进程解密，不下发给渲染进程
  return browsers.map(({ keyNames, ...browser }) => browser);
});

trustedHandle("browser-import:import", async (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许导入浏览器数据" };
  try {
    const kinds = {
      cookies: payload?.kinds?.cookies !== false,
      passwords: payload?.kinds?.passwords !== false,
      history: payload?.kinds?.history !== false,
      localstorage: payload?.kinds?.localstorage !== false,
    };
    const result = await importBrowserData(
      { id: String(payload?.id || ""), userDataDir: String(payload?.userDataDir || "") },
      String(payload?.profileId || "Default"),
      kinds,
    );
    if (!result.ok) return result;
    // Cookie 写入右侧面板 webview 共用的持久分区
    const targetSession = session.fromPartition("persist:dyworker-browser");
    let cookieCount = 0;
    for (const cookie of result.cookies) {
      if (!cookie.host || !cookie.name) continue;
      try {
        const sameSite = cookie.sameSite === 0 ? "no_restriction" : cookie.sameSite === 1 ? "lax" : cookie.sameSite === 2 ? "strict" : "unspecified";
        // 会话级 Cookie（源浏览器里无有效期）写入持久分区后重启即被 Chromium 丢弃——
        // 登录态大多靠这种 Cookie，表现为“导入了但还是要登录”。
        // 导入时给一个 Chromium 上限（400 天）的有效期，让登录态跨重启保留。
        const expirationDate = cookie.expires > 0 ? cookie.expires : Math.floor(Date.now() / 1000) + 400 * 86400;
        await targetSession.cookies.set({
          url: `http${cookie.secure ? "s" : ""}://${cookie.host.replace(/^\./, "")}${cookie.path || "/"}`,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.host,
          path: cookie.path || "/",
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite,
          expirationDate,
        });
        cookieCount += 1;
      } catch {
        // 单条 Cookie 不合法（如域与 URL 不匹配）时跳过，不中断整体导入
      }
    }
    // 密码经 safeStorage 加密后存入 userData，供后续自动填充使用
    let passwordCount = 0;
    if (result.passwords.length) {
      const storePath = path.join(app.getPath("userData"), "imported-passwords.json");
      const existing = await readJson(storePath, []);
      const known = new Set(existing.map((item) => `${item.origin}\n${item.username}`));
      for (const item of result.passwords) {
        const key = `${item.origin}\n${item.username}`;
        if (known.has(key)) continue;
        known.add(key);
        existing.push({
          origin: item.origin,
          username: item.username,
          passwordEnc: safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(item.password).toString("base64") : "",
          passwordPlain: safeStorage.isEncryptionAvailable() ? undefined : item.password,
          source: result.browser,
          importedAt: new Date().toISOString(),
        });
        passwordCount += 1;
      }
      await writeJson(storePath, existing);
    }
    // 浏览记录存入 userData，供内置浏览器地址栏联想；按 URL 去重保留最近访问
    let historyCount = 0;
    if (result.history?.length) {
      const storePath = path.join(app.getPath("userData"), "imported-history.json");
      const existing = await readJson(storePath, []);
      const byUrl = new Map<any, any>(existing.map((item) => [item.url, item]));
      for (const item of result.history) {
        const known = byUrl.get(item.url);
        if (known && Number(known.lastVisit || 0) >= Number(item.lastVisit || 0)) continue;
        byUrl.set(item.url, { url: item.url, title: item.title, visits: Math.max(Number(known?.visits || 0), item.visits), lastVisit: item.lastVisit });
        if (!known) historyCount += 1;
      }
      const merged = [...byUrl.values()].sort((a, b) => Number(b.lastVisit || 0) - Number(a.lastVisit || 0)).slice(0, 5000);
      await writeJson(storePath, merged);
    }
    // localStorage 暂存 userData：SPA 站点（如 kimi）的登录令牌在这里。
    // 渲染端在内置浏览器首次访问对应站点时取出注入，注入成功后清除（见 browser-import:localstorage-*）
    let localStorageOriginCount = 0;
    let localStorageKeyCount = 0;
    if (result.localStorage && typeof result.localStorage === "object") {
      const storePath = path.join(app.getPath("userData"), "imported-localstorage.json");
      const existing = await readJson(storePath, {});
      const store = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
      for (const [origin, entries] of Object.entries(result.localStorage)) {
        if (!/^https?:\/\//i.test(origin) || !entries || typeof entries !== "object") continue;
        const target = { ...(store[origin] || {}) };
        for (const [key, value] of Object.entries(entries)) {
          target[String(key)] = String(value);
          localStorageKeyCount += 1;
        }
        store[origin] = target;
        localStorageOriginCount += 1;
      }
      if (localStorageOriginCount) await writeJson(storePath, store);
    }
    return {
      ok: true,
      browser: result.browser,
      cookies: cookieCount,
      passwords: passwordCount,
      history: historyCount,
      localStorageOrigins: localStorageOriginCount,
      localStorageKeys: localStorageKeyCount,
      warnings: result.warnings,
      weakProtection: !safeStorage.isEncryptionAvailable() && passwordCount > 0,
    };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

trustedHandle("browser-import:history", async (event) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return [];
  const storePath = path.join(app.getPath("userData"), "imported-history.json");
  return readJson(storePath, []);
});

trustedHandle("browser-import:localstorage-entries", async (event, origin) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return null;
  const storePath = path.join(app.getPath("userData"), "imported-localstorage.json");
  const store = await readJson(storePath, {});
  if (!store || typeof store !== "object" || Array.isArray(store)) return null;
  const entries = store[String(origin || "")];
  return entries && typeof entries === "object" ? entries : null;
});

trustedHandle("browser-import:localstorage-done", async (event, origin) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false };
  const storePath = path.join(app.getPath("userData"), "imported-localstorage.json");
  const store = await readJson(storePath, {});
  if (store && typeof store === "object" && !Array.isArray(store) && store[String(origin || "")]) {
    delete store[String(origin || "")];
    await writeJson(storePath, store);
  }
  return { ok: true };
});
    },
  };
}
