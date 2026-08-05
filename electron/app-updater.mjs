const DEFAULT_TAG_PREFIX = "v";

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
  return error instanceof Error ? error.message : String(error || "更新失败");
}

function versionText(value) {
  return String(value || "").trim();
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

export function createUpdaterController({ updater, isPackaged, currentVersion, getWindow }) {
  let status = {
    state: isPackaged ? "idle" : "unavailable",
    currentVersion: versionText(currentVersion),
  };
  let checkPromise = null;

  const publish = (next) => {
    status = { ...status, ...next };
    const target = getWindow?.();
    if (!target || target.isDestroyed?.()) return status;
    target.webContents?.send("app-update:status", { ...status });
    return status;
  };

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

  return { check, download, install, getStatus, publish };
}
