const DEFAULT_TAG_PREFIX = "v";
export const DEFAULT_UPDATE_URL = "https://github.com/richardguancn/dyworker";

export const UPDATE_STATES = new Set([
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "not-available",
  "error",
  "unavailable",
]);

function errorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error || "更新失败");
  // 0.1.19 及更早的 ad-hoc 签名把指定要求锚定在 cdhash（每次构建都不同），
  // 这些旧版本永远无法通过新包的签名校验，只能手动安装一次；给出可操作的指引而不是原始英文报错
  if (/did not pass validation|代码要求|code signature/i.test(raw)) {
    return "当前安装版本的签名校验过旧，无法直接自动升级。请前往 GitHub 仓库 Releases 页面下载最新安装包，手动安装一次后，之后的版本即可正常自动更新。";
  }
  return raw;
}

function versionText(value) {
  return String(value || "").trim();
}

export function parseGithubUpdateUrl(value = DEFAULT_UPDATE_URL) {
  const raw = String(value || "").trim() || DEFAULT_UPDATE_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("应用更新地址必须是 GitHub 仓库地址，例如 https://github.com/组织名/仓库名");
  }
  if (url.protocol !== "https:" || url.search || url.hash) {
    throw new Error("应用更新地址必须使用 HTTPS 的 GitHub 仓库地址");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("应用更新地址必须指向 GitHub 仓库，例如 https://github.com/组织名/仓库名");
  }
  let owner;
  let rawRepo;
  try {
    [owner, rawRepo] = parts.map((part) => decodeURIComponent(part));
  } catch {
    throw new Error("GitHub 仓库地址中的组织名和仓库名无效");
  }
  const repo = rawRepo.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("GitHub 仓库地址中的组织名和仓库名无效");
  }
  const host = url.host.toLowerCase() === "www.github.com" ? "github.com" : url.host;
  return {
    provider: "github",
    owner,
    repo,
    tagNamePrefix: DEFAULT_TAG_PREFIX,
    ...(host === "github.com" ? {} : { host }),
  };
}

export function normalizeUpdateUrl(value) {
  try {
    const options = parseGithubUpdateUrl(value);
    const host = options.host || "github.com";
    return `https://${host}/${options.owner}/${options.repo}`;
  } catch {
    return DEFAULT_UPDATE_URL;
  }
}

function releaseText(value, limit = 240) {
  return String(value || "").trim().slice(0, limit);
}

export function releaseTagForVersion(version, prefix = DEFAULT_TAG_PREFIX) {
  const normalizedVersion = versionText(version);
  const normalizedPrefix = String(prefix ?? DEFAULT_TAG_PREFIX);
  return normalizedVersion ? `${normalizedPrefix}${normalizedVersion}` : "";
}

export function isReleaseTagForVersion(tag, version, prefix = DEFAULT_TAG_PREFIX) {
  return String(tag || "").trim() === releaseTagForVersion(version, prefix);
}

export function createUpdaterController({ updater, isPackaged, currentVersion, getWindow, updateUrl = DEFAULT_UPDATE_URL }) {
  let status = {
    state: isPackaged ? "idle" : "unavailable",
    currentVersion: versionText(currentVersion),
  };
  let checkPromise = null;
  let configuredUpdateUrl = normalizeUpdateUrl(updateUrl);

  const publish = (next) => {
    status = { ...status, ...next };
    const target = getWindow?.();
    if (!target || target.isDestroyed?.()) return status;
    target.webContents?.send("app-update:status", { ...status });
    return status;
  };

  const configure = (nextUrl) => {
    const options = parseGithubUpdateUrl(nextUrl);
    if (updater?.setFeedURL) updater.setFeedURL(options);
    configuredUpdateUrl = normalizeUpdateUrl(nextUrl);
    status = {
      state: isPackaged ? "idle" : "unavailable",
      currentVersion: versionText(currentVersion),
    };
    publish(status);
    return { ok: true, updateUrl: configuredUpdateUrl };
  };

  configure(configuredUpdateUrl);

  const register = (event, handler) => {
    updater?.on?.(event, handler);
  };

  register("checking-for-update", () => publish({ state: "checking", error: undefined }));
  register("update-available", (info = {}) => publish({
    state: "available",
    version: versionText(info.version),
    releaseName: releaseText(info.releaseName),
    releaseDate: releaseText(info.releaseDate, 80),
    error: undefined,
    percent: undefined,
  }));
  register("update-not-available", (info = {}) => publish({
    state: "not-available",
    version: versionText(info.version),
    error: undefined,
    percent: undefined,
  }));
  register("download-progress", (progress = {}) => publish({
    state: "downloading",
    percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
    bytesPerSecond: Math.max(0, Number(progress.bytesPerSecond) || 0),
    transferred: Math.max(0, Number(progress.transferred) || 0),
    total: Math.max(0, Number(progress.total) || 0),
    error: undefined,
  }));
  register("update-downloaded", (info = {}) => publish({
    state: "downloaded",
    version: versionText(info.version) || status.version,
    releaseName: releaseText(info.releaseName) || status.releaseName,
    percent: 100,
    error: undefined,
  }));
  register("error", (error) => publish({ state: "error", error: errorMessage(error) }));

  const check = async () => {
    if (!isPackaged) {
      return { ok: false, state: "unavailable", error: "开发环境不检查应用更新" };
    }
    if (!updater?.checkForUpdates) {
      return { ok: false, state: "unavailable", error: "当前版本不支持应用更新" };
    }
    if (checkPromise) return checkPromise;
    checkPromise = (async () => {
      publish({ state: "checking", error: undefined });
      try {
        await updater.checkForUpdates();
        return { ok: true, state: status.state, version: status.version };
      } catch (error) {
        const message = errorMessage(error);
        publish({ state: "error", error: message });
        return { ok: false, state: "error", error: message };
      } finally {
        checkPromise = null;
      }
    })();
    return checkPromise;
  };

  const download = async () => {
    if (!isPackaged || !updater?.downloadUpdate) {
      return { ok: false, state: "unavailable", error: "当前版本不支持应用更新" };
    }
    try {
      publish({ state: "downloading", percent: 0, error: undefined });
      await updater.downloadUpdate();
      return { ok: true, state: status.state };
    } catch (error) {
      const message = errorMessage(error);
      publish({ state: "error", error: message });
      return { ok: false, state: "error", error: message };
    }
  };

  const install = () => {
    if (!isPackaged || !updater?.quitAndInstall) {
      return { ok: false, state: "unavailable", error: "当前版本不支持应用更新" };
    }
    if (status.state !== "downloaded") {
      return { ok: false, state: status.state, error: "更新文件还没有下载完成" };
    }
    updater.quitAndInstall();
    return { ok: true, state: "installing" };
  };

  const getStatus = () => ({ ...status });

  return { check, configure, download, install, getStatus, getUpdateUrl: () => configuredUpdateUrl, publish };
}
