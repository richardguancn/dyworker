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

// electron-updater 的 releaseNotes 可能是字符串，也可能是 [{ version, note }] 数组
function releaseNotesText(value, limit = 12000) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => releaseText(entry?.note ?? entry, limit))
      .filter(Boolean)
      .join("\n\n")
      .slice(0, limit);
  }
  return releaseText(value, limit);
}

export function releaseTagForVersion(version, prefix = DEFAULT_TAG_PREFIX) {
  const normalizedVersion = versionText(version);
  const normalizedPrefix = String(prefix ?? DEFAULT_TAG_PREFIX);
  return normalizedVersion ? `${normalizedPrefix}${normalizedVersion}` : "";
}

// 各平台对应的更新清单文件名（与 electron-builder 生成的一致）
export function latestYmlFileNames(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") return ["latest-mac.yml"];
  if (platform === "win32") return ["latest.yml"];
  if (platform === "linux") return arch === "arm64" ? ["latest-linux-arm64.yml", "latest-linux.yml"] : ["latest-linux.yml"];
  return [];
}

// 从 latest*.yml 文本中解析 releaseNotes。发布流水线把当前版本的 Markdown
// 更新说明以块标量（releaseNotes: |）追加到 yml 末尾；这里只需一个最小解析，
// 支持块标量与单行两种写法，不引入完整 YAML 解析器。
export function releaseNotesFromUpdateYml(text, limit = 12000) {
  const lines = String(text || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^releaseNotes:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const rest = match[1].trim();
    if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") {
      const block = [];
      let indent = Infinity;
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const line = lines[cursor];
        if (line.trim() === "") {
          block.push("");
          continue;
        }
        const leading = /^ */.exec(line)[0].length;
        // 顶格行说明块标量结束，遇到了下一个字段
        if (leading === 0) break;
        indent = Math.min(indent, leading);
        block.push(line);
      }
      const dedent = Number.isFinite(indent) ? indent : 0;
      return block
        .map((line) => line.slice(Math.min(dedent, /^ */.exec(line)[0].length)))
        .join("\n")
        .trim()
        .slice(0, limit);
    }
    if (!rest || rest.startsWith("#")) return "";
    return rest.replace(/^['"]|['"]$/g, "").slice(0, limit);
  }
  return "";
}

async function fetchTextDefault(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export function isReleaseTagForVersion(tag, version, prefix = DEFAULT_TAG_PREFIX) {
  return String(tag || "").trim() === releaseTagForVersion(version, prefix);
}

export function createUpdaterController({
  updater,
  isPackaged,
  currentVersion,
  getWindow,
  updateUrl = DEFAULT_UPDATE_URL,
  platform = process.platform,
  arch = process.arch,
  fetchText = fetchTextDefault,
}) {
  let status = {
    state: isPackaged ? "idle" : "unavailable",
    currentVersion: versionText(currentVersion),
  };
  let checkPromise = null;
  let configuredUpdateUrl = normalizeUpdateUrl(updateUrl);

  const publish = (next) => {
    status = { ...status, ...next, updateUrl: configuredUpdateUrl };
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
  register("update-available", (info = {}) => {
    const version = versionText(info.version);
    publish({
      state: "available",
      version,
      releaseName: releaseText(info.releaseName),
      releaseDate: releaseText(info.releaseDate, 80),
      releaseNotes: releaseNotesText(info.releaseNotes),
      error: undefined,
      percent: undefined,
    });
    void hydrateReleaseNotes(version);
  });

  // electron-updater 从 GitHub atom feed 取到的 releaseNotes 是整份 HTML，
  // 内容含历史所有版本且无法直接渲染。发布流水线会把当前版本的 Markdown
  // 更新说明写进 latest*.yml 的 releaseNotes 字段，这里拉回来覆盖。
  const hydrateReleaseNotes = async (version) => {
    if (!version || typeof fetchText !== "function") return;
    const tag = releaseTagForVersion(version);
    for (const file of latestYmlFileNames(platform, arch)) {
      try {
        const yml = await fetchText(`${configuredUpdateUrl}/releases/download/${tag}/${file}`);
        const notes = releaseNotesFromUpdateYml(yml);
        if (!notes) continue;
        // 只在状态仍指向这个版本时覆盖，避免晚到的结果污染新一轮检查
        if (status.version !== version) return;
        if (!["available", "downloading", "downloaded"].includes(status.state)) return;
        publish({ releaseNotes: notes });
        return;
      } catch {
        // 网络失败或清单缺失时保留 electron-updater 给的原始内容
      }
    }
  };
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
    // 优先保留已从 latest*.yml 拉到的 Markdown 说明，atom feed 的 HTML 只作兜底
    releaseNotes: status.releaseNotes || releaseNotesText(info.releaseNotes),
    percent: 100,
    error: undefined,
  }));
  register("error", (error) => publish({ state: "error", error: errorMessage(error) }));

  // silent=true 用于启动后/定时的后台自动检查：不改状态、不推送渲染层，
  // 避免侧栏下载按钮因 "checking" 闪现，也避免无新版本的例行结果打扰用户
  const check = async ({ silent = false } = {}) => {
    if (!isPackaged) {
      return { ok: false, state: "unavailable", error: "开发环境不检查应用更新" };
    }
    if (!updater?.checkForUpdates) {
      return { ok: false, state: "unavailable", error: "当前版本不支持应用更新" };
    }
    if (checkPromise) return checkPromise;
    checkPromise = (async () => {
      if (!silent) publish({ state: "checking", error: undefined });
      try {
        await updater.checkForUpdates();
        return { ok: true, state: status.state, version: status.version };
      } catch (error) {
        const message = errorMessage(error);
        if (!silent) publish({ state: "error", error: message });
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
