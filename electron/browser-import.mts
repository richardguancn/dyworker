// 从本机其他浏览器导入 Cookie 与密码（对照 Codex 浏览器「导入 Cookie 和密码」）。
// Chromium 系浏览器：macOS 走 Keychain 的「XXX Safe Storage」派生 AES-CBC 密钥，
// Linux 优先 Secret Service（secret-tool），无密钥链时回退 Chromium 默认口令 "peanuts"，
// Windows 走 Local State + DPAPI 解出的 AES-GCM 密钥（Chrome 127+ 的 v20 应用绑定加密无法离线解密，会跳过并提示）。
// Linux 国产化环境额外覆盖 360 安全浏览器（~/.config/browser360）与奇安信可信浏览器（qaxbrowser）。
// 其他含画像登记的 Chromium 系浏览器自动发现；Firefox 系浏览器的 Cookie/浏览记录为明文 SQLite，只读复制后解析。
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readLocalStorageLeveldb, snappyDecompress } from "./localstorage-import.mts";

const CHROME_EPOCH_OFFSET_SECONDS = 11644473600; // 1601-01-01 → Unix epoch

// service/account 候选：macOS Keychain 与 Linux Secret Service 共用同一组应用名
const CHROMIUM_CATALOG = [
  {
    id: "chrome",
    name: "Google Chrome",
    dirs: {
      darwin: ["Library/Application Support/Google/Chrome"],
      linux: [".config/google-chrome"],
      win32: ["Google/Chrome/User Data"],
    },
    keyNames: ["Chrome"],
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    dirs: {
      darwin: ["Library/Application Support/Microsoft Edge"],
      linux: [".config/microsoft-edge"],
      win32: ["Microsoft/Edge/User Data"],
    },
    keyNames: ["Microsoft Edge", "Microsoft Edge Dev", "Edge"],
  },
  {
    id: "chromium",
    name: "Chromium",
    dirs: {
      darwin: ["Library/Application Support/Chromium"],
      linux: [".config/chromium"],
      win32: ["Chromium/User Data"],
    },
    keyNames: ["Chromium"],
  },
  {
    id: "brave",
    name: "Brave",
    dirs: {
      darwin: ["Library/Application Support/BraveSoftware/Brave-Browser"],
      linux: [".config/BraveSoftware/Brave-Browser"],
      win32: ["BraveSoftware/Brave-Browser/User Data"],
    },
    keyNames: ["Brave"],
  },
  {
    id: "browser360",
    name: "360 安全浏览器",
    dirs: {
      darwin: ["Library/Application Support/360Chrome"],
      // 国产化 Linux（麒麟/UOS/deepin）常见目录；旧版为 360chrome/360browser
      linux: [".config/browser360", ".config/360chrome", ".config/360browser"],
      win32: ["360Chrome/Chrome/User Data", "360Chrome X/User Data"],
    },
    keyNames: ["360", "360Chrome", "browser360"],
  },
  {
    id: "qax",
    name: "奇安信可信浏览器",
    dirs: {
      darwin: [],
      // 奇安信可信浏览器（qaxbrowser），麒麟/UOS 默认预装
      linux: [".config/qaxbrowser", ".config/qianxin", ".config/com.qianxin.browser-stable"],
      win32: [],
    },
    keyNames: ["qaxbrowser", "qianxin"],
  },
  {
    id: "arc",
    name: "Arc",
    dirs: { darwin: ["Library/Application Support/Arc/User Data"], linux: [], win32: [] },
    keyNames: ["Arc"],
  },
  {
    id: "vivaldi",
    name: "Vivaldi",
    dirs: { darwin: ["Library/Application Support/Vivaldi"], linux: [".config/vivaldi"], win32: ["Vivaldi/User Data"] },
    keyNames: ["Vivaldi"],
  },
  {
    id: "opera",
    name: "Opera",
    // Opera 的默认画像就是用户数据目录本身（没有 Default 子目录）
    dirs: { darwin: ["Library/Application Support/com.operasoftware.Opera"], linux: [".config/opera"], win32: ["%APPDATA%/Opera Software/Opera Stable"] },
    keyNames: ["Opera"],
  },
];

// Gecko 系浏览器（Firefox 及衍生版）：Cookie 与浏览记录为明文 SQLite，无需系统密钥链
const GECKO_CATALOG = [
  {
    id: "firefox",
    name: "Firefox",
    dirs: {
      darwin: ["Library/Application Support/Firefox/Profiles"],
      linux: [".mozilla/firefox", "snap/firefox/common/.mozilla/firefox", ".var/app/org.mozilla.firefox/.mozilla/firefox"],
      win32: ["%APPDATA%/Mozilla/Firefox/Profiles"],
    },
  },
  {
    id: "librewolf",
    name: "LibreWolf",
    dirs: { darwin: ["Library/Application Support/librewolf/Profiles"], linux: [".librewolf"], win32: ["%APPDATA%/librewolf/Profiles"] },
  },
  {
    id: "waterfox",
    name: "Waterfox",
    dirs: { darwin: ["Library/Application Support/Waterfox/Profiles"], linux: [".waterfox"], win32: ["%APPDATA%/Waterfox/Profiles"] },
  },
  {
    id: "zen",
    name: "Zen Browser",
    dirs: { darwin: ["Library/Application Support/zen/Profiles"], linux: [".zen"], win32: ["%APPDATA%/zen/Profiles"] },
  },
];

function execCommand(command, args, { input, timeout = 10000 } = {} as any) {
  return new Promise<any>((resolve) => {
    execFile(command, args, { encoding: "utf8", timeout, windowsHide: true, input } as any, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout || "").trim() });
    });
  });
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function candidateRoot(relative) {
  if (process.platform === "win32") {
    if (relative.startsWith("%APPDATA%/")) {
      const roaming = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
      return path.join(roaming, relative.slice("%APPDATA%/".length));
    }
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, relative);
  }
  return path.join(os.homedir(), relative);
}

async function chromiumProfileIds(userDataDir) {
  try {
    const localState = JSON.parse(await fs.readFile(path.join(userDataDir, "Local State"), "utf8"));
    const infoCache = localState?.profile?.info_cache;
    return infoCache && typeof infoCache === "object" ? Object.keys(infoCache).filter((id) => id !== "system_profile") : [];
  } catch {
    return [];
  }
}

// 标准应用数据目录下的其他 Chromium 系浏览器（如豆包、夸克、Yandex 等）：
// 含 Local State 且登记了用户画像才算浏览器，普通 Electron 应用没有画像登记。
async function scanGenericChromiumDirs(found) {
  const roots = process.platform === "darwin" ? [path.join(os.homedir(), "Library/Application Support")]
    : process.platform === "linux" ? [path.join(os.homedir(), ".config")]
    : process.platform === "win32" ? [candidateRoot("."), candidateRoot("%APPDATA%/.")]
    : [];
  const candidates = [];
  const childDirs = async (dir) => (await fs.readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && !/scoped_dir|headless|^Caches?$|^Crashpad$/i.test(entry.name))
    .map((entry) => path.join(dir, entry.name));
  for (const root of roots) {
    for (const first of await childDirs(root)) {
      candidates.push(first, path.join(first, "User Data"));
      for (const second of await childDirs(first)) candidates.push(second, path.join(second, "User Data"));
    }
  }
  const extras = [];
  for (const dir of candidates) {
    if (found.has(dir) || extras.some((item) => item.userDataDir === dir)) continue;
    if (!(await pathExists(path.join(dir, "Local State")))) continue;
    if (!(await chromiumProfileIds(dir)).length) continue;
    const relative = path.relative(roots.find((root) => dir.startsWith(root)) || "", dir)
      .split(path.sep).filter((part) => part && part !== "User Data");
    const label = relative.join(" / ") || path.basename(dir);
    extras.push({
      id: `chromium-${relative.join("-").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "-") || "custom"}`,
      name: label,
      userDataDir: dir,
      keyNames: [...new Set([relative[relative.length - 1], relative[0], label].filter(Boolean))],
    });
  }
  return extras;
}

function geckoProfileLabel(dirName) {
  return dirName.replace(/^[a-z0-9]{8}\./i, "") || dirName;
}

async function listGeckoBrowsers() {
  const browsers = [];
  for (const browser of GECKO_CATALOG) {
    for (const relative of browser.dirs[process.platform] || []) {
      const root = candidateRoot(relative);
      const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
      const profiles = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        if (!(await pathExists(path.join(dir, "cookies.sqlite"))) && !(await pathExists(path.join(dir, "places.sqlite")))) continue;
        profiles.push({ id: entry.name, name: geckoProfileLabel(entry.name) });
      }
      if (!profiles.length) continue;
      // 常用画像排在前面，便于未指定画像时选中
      profiles.sort((a, b) => Number(/default-release/.test(b.id)) - Number(/default-release/.test(a.id)));
      browsers.push({ id: browser.id, name: browser.name, userDataDir: root, engine: "gecko", keyNames: [], profiles });
      break;
    }
  }
  return browsers;
}

// Linux 国产化环境目录名可能随版本变化，额外扫描 ~/.config 下疑似目录（含 Local State 才算）
async function scanDomesticBrowserDirs(found) {
  if (process.platform !== "linux") return [];
  const configDir = path.join(os.homedir(), ".config");
  let entries = [];
  try {
    entries = await fs.readdir(configDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const extras = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/browser360|360chrome|360browser|qax|qianxin/i.test(entry.name)) continue;
    const dir = path.join(configDir, entry.name);
    if (found.has(dir)) continue;
    if (!(await pathExists(path.join(dir, "Local State")))) continue;
    extras.push({
      id: /360/i.test(entry.name) ? "browser360" : "qax",
      name: /360/i.test(entry.name) ? `360 浏览器（${entry.name}）` : `奇安信浏览器（${entry.name}）`,
      userDataDir: dir,
      keyNames: /360/i.test(entry.name) ? ["360", "browser360"] : ["qaxbrowser", "qianxin"],
    });
  }
  return extras;
}

// 列出本机可导入的浏览器及其用户画像
export async function listImportableBrowsers() {
  const found = new Map();
  for (const browser of CHROMIUM_CATALOG) {
    const candidates = browser.dirs[process.platform] || [];
    for (const relative of candidates) {
      const dir = candidateRoot(relative);
      if (found.has(dir) || !(await pathExists(path.join(dir, "Local State")))) continue;
      found.set(dir, { id: browser.id, name: browser.name, userDataDir: dir, keyNames: browser.keyNames });
      break;
    }
  }
  for (const extra of await scanDomesticBrowserDirs(found)) {
    found.set(extra.userDataDir, extra);
  }
  for (const extra of await scanGenericChromiumDirs(found)) {
    found.set(extra.userDataDir, extra);
  }
  const browsers = [];
  for (const browser of found.values()) {
    browsers.push({
      id: browser.id,
      name: browser.name,
      userDataDir: browser.userDataDir,
      engine: "chromium",
      keyNames: browser.keyNames,
      profiles: await listProfiles(browser.userDataDir),
    });
  }
  browsers.push(...await listGeckoBrowsers());
  return browsers;
}

async function listProfiles(userDataDir) {
  const fallback = [{ id: "Default", name: "默认画像" }];
  try {
    const localState = JSON.parse(await fs.readFile(path.join(userDataDir, "Local State"), "utf8"));
    const infoCache = localState?.profile?.info_cache;
    if (!infoCache || typeof infoCache !== "object") return fallback;
    const profiles = Object.entries(infoCache)
      .filter(([id]) => id !== "system_profile")
      .map(([id, info]: any) => ({ id, name: String(info?.name || id) }));
    return profiles.length ? profiles : fallback;
  } catch {
    return fallback;
  }
}

// ---- 解密密钥派生 ----

async function resolveKeyMaterial(browser) {
  if (process.platform === "darwin") {
    for (const keyName of browser.keyNames) {
      for (const service of [`${keyName} Safe Storage`, keyName]) {
        const result = await execCommand("security", ["find-generic-password", "-w", "-s", service]);
        if (result.ok && result.stdout) {
          return { mode: "cbc", password: result.stdout, iterations: 1003, source: "macOS 钥匙串" };
        }
      }
    }
    return { error: `无法从 macOS 钥匙串读取「${browser.name} Safe Storage」，请在系统弹窗中允许访问后重试` };
  }
  if (process.platform === "linux") {
    for (const keyName of browser.keyNames) {
      const result = await execCommand("secret-tool", ["lookup", "application", keyName]);
      if (result.ok && result.stdout) {
        return { mode: "cbc", password: result.stdout, iterations: 1, source: "系统密钥链" };
      }
    }
    // 无桌面密钥链（麒麟/UOS 常见）时 Chromium 回退到硬编码口令 peanuts
    return { mode: "cbc", password: "peanuts", iterations: 1, source: "Chromium 默认口令" };
  }
  if (process.platform === "win32") {
    try {
      const localState = JSON.parse(await fs.readFile(path.join(browser.userDataDir, "Local State"), "utf8"));
      const encryptedKey = localState?.os_crypt?.encrypted_key;
      if (!encryptedKey) return { error: `${browser.name} 的 Local State 中没有加密密钥` };
      const raw = Buffer.from(String(encryptedKey), "base64").subarray(5); // 去掉 "DPAPI" 前缀
      const script = [
        "Add-Type -AssemblyName System.Security;",
        `$d=[Convert]::FromBase64String('${raw.toString("base64")}');`,
        "[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($d,$null,'CurrentUser'))",
      ].join("");
      const result = await execCommand("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
      if (!result.ok || !result.stdout) return { error: "DPAPI 解密失败，请确认当前登录的就是浏览器使用者本人" };
      return { mode: "gcm", key: Buffer.from(result.stdout, "base64"), source: "Windows DPAPI" };
    } catch (error: any) {
      return { error: `读取 ${browser.name} 加密密钥失败：${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return { error: "当前系统暂不支持导入浏览器数据" };
}

function deriveKey(material) {
  if (material.mode === "gcm") return material.key;
  return crypto.pbkdf2Sync(material.password, "saltysalt", material.iterations, 16, "sha1");
}

// v10/v11：macOS/Linux 为 AES-128-CBC（IV=16 个空格），Windows 为 AES-256-GCM；v20 为应用绑定加密，无法离线解密
function decryptChromiumValue(encrypted, material, key) {
  if (!encrypted || encrypted.length < 4) return null;
  const prefix = encrypted.subarray(0, 3).toString("utf8");
  if (prefix === "v20") return null;
  if (prefix !== "v10" && prefix !== "v11") return null;
  try {
    if (material.mode === "gcm") {
      const nonce = encrypted.subarray(3, 15);
      const tag = encrypted.subarray(encrypted.length - 16);
      const data = encrypted.subarray(15, encrypted.length - 16);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]);
    }
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    return Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
  } catch {
    return null;
  }
}

// 新版 Chrome 的 Cookie 明文前会带 32 字节 SHA256(host_key) 校验前缀
function stripHostHashPrefix(plain, hostKey) {
  if (plain.length <= 32) return plain;
  const digest = crypto.createHash("sha256").update(hostKey).digest();
  return plain.subarray(0, 32).equals(digest) ? plain.subarray(32) : plain;
}

async function copyForRead(directory, fileNames, stagingDir) {
  for (const name of fileNames) {
    const source = path.join(directory, name);
    if (!(await pathExists(source))) continue;
    await fs.copyFile(source, path.join(stagingDir, name));
  }
}

function openDatabaseCopy(stagingDir, baseName) {
  const file = path.join(stagingDir, baseName);
  // readBigInts: Chromium 的时间戳是 1601 纪元微秒（约 1.3e16），超出 2^53，
  // node:sqlite 默认遇到表示不下的 INTEGER 直接抛错（整个查询失败），按 BigInt 读后再转 Number。
  // 下游所有取值都经 Number()/String()/Boolean() 归一化，BigInt 不会泄漏进 IPC 载荷。
  return pathExists(file).then((exists) => exists ? new DatabaseSync(file, { readBigInts: true }) : null);
}

function chromeTimeToUnix(microseconds) {
  const value = Number(microseconds || 0);
  if (!value) return 0;
  return Math.floor(value / 1e6) - CHROME_EPOCH_OFFSET_SECONDS;
}

// 读取并解密指定画像的 Cookie 与密码；浏览记录与 localStorage 无需解密。kinds 控制导入哪些类别。
// site（可选）：{ hostname, origin } 仅读取匹配该站点的 Cookie 与同源 localStorage，其余数据不解密、不返回。
export async function importBrowserData(source, profileId = "Default", kinds = {} as any, site = null as any) {
  const wantCookies = kinds.cookies !== false;
  const wantPasswords = kinds.passwords !== false;
  const wantHistory = kinds.history !== false;
  const wantLocalStorage = kinds.localstorage !== false;
  const browsers = await listImportableBrowsers();
  const browser = browsers.find((item) => item.id === source.id && item.userDataDir === source.userDataDir)
    || browsers.find((item) => item.id === source.id);
  if (!browser) return { ok: false, error: "没有找到这个浏览器的数据目录" };
  if (browser.engine === "gecko") return importGeckoData(browser, profileId, { wantCookies, wantPasswords, wantHistory, wantLocalStorage }, site);
  const catalogEntry = CHROMIUM_CATALOG.find((item) => item.id === browser.id);
  const keySource = { ...browser, keyNames: browser.keyNames || catalogEntry?.keyNames || [] };
  const profileDir = await resolveChromiumProfileDir(browser.userDataDir, profileId);
  if (!profileDir) return { ok: false, error: "没有找到这个浏览器的用户画像目录" };

  const warnings = [];
  const cookies = [];
  const passwords = [];
  const history = [];
  let localStorageData = {};
  let material = null;
  let key = null;
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-browser-import-"));
  try {
    // Cookie 数据库新版在 Network/Cookies，旧版在画像根目录；连 WAL 一起复制避免浏览器运行中读到半截
    if (wantCookies) {
      const cookieCandidates = [path.join(profileDir, "Network"), profileDir];
      let cookieDb = null;
      for (const directory of cookieCandidates) {
        await copyForRead(directory, ["Cookies", "Cookies-wal", "Cookies-shm"], stagingDir);
        cookieDb = await openDatabaseCopy(stagingDir, "Cookies");
        if (cookieDb) break;
      }
      if (cookieDb) {
        try {
          const nowChromeTime = (Date.now() / 1000 + CHROME_EPOCH_OFFSET_SECONDS) * 1e6;
          const rows = cookieDb.prepare(
            "SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies",
          ).all().filter((row) => !site || cookieMatchesHost(row.host_key, site.hostname));
          let undecryptable = 0;
          for (const row of rows) {
            const expiresUtc = Number(row.expires_utc || 0);
            if (expiresUtc && expiresUtc < nowChromeTime) continue; // 跳过已过期
            let value = typeof row.value === "string" ? row.value : "";
            if (!value && row.encrypted_value && (row.encrypted_value as any).length) {
              // 只有真正需要解密时才读取系统密钥（避免只读浏览记录或无匹配 Cookie 也触发密钥链弹窗）
              if (!material) {
                material = await resolveKeyMaterial(keySource);
                if (material.error) return { ok: false, error: material.error };
                key = deriveKey(material);
              }
              const encrypted = Buffer.isBuffer(row.encrypted_value) ? row.encrypted_value : Buffer.from(row.encrypted_value);
              const plain = decryptChromiumValue(encrypted, material, key);
              if (!plain) { undecryptable += 1; continue; }
              value = stripHostHashPrefix(plain, String(row.host_key || "")).toString("utf8");
            }
            cookies.push({
              host: String(row.host_key || ""),
              name: String(row.name || ""),
              value,
              path: String(row.path || "/"),
              expires: chromeTimeToUnix(expiresUtc),
              secure: Boolean(row.is_secure),
              httpOnly: Boolean(row.is_httponly),
              sameSite: Number(row.samesite ?? -1),
            });
          }
          if (undecryptable) warnings.push(`${undecryptable} 条 Cookie 无法解密（可能是新版应用绑定加密），已跳过`);
        } catch (error: any) {
          warnings.push(`读取 Cookie 失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          cookieDb.close();
        }
      } else {
        warnings.push("没有找到 Cookie 数据库（浏览器可能从未保存过 Cookie）");
      }
    }

    if (wantPasswords) {
      if (!material) {
        material = await resolveKeyMaterial(keySource);
        if (material.error) return { ok: false, error: material.error };
        key = deriveKey(material);
      }
      await copyForRead(profileDir, ["Login Data", "Login Data-wal", "Login Data-shm"], stagingDir);
      const loginDb = await openDatabaseCopy(stagingDir, "Login Data");
      if (loginDb) {
        try {
          const rows = loginDb.prepare(
            "SELECT origin_url, username_value, password_value FROM logins WHERE blacklisted_by_user = 0",
          ).all();
          let undecryptable = 0;
          for (const row of rows) {
            const encrypted = Buffer.isBuffer(row.password_value) ? row.password_value : Buffer.from((row.password_value || []) as any);
            const plain = decryptChromiumValue(encrypted, material, key);
            if (!plain) { undecryptable += 1; continue; }
            passwords.push({
              origin: String(row.origin_url || ""),
              username: String(row.username_value || ""),
              password: plain.toString("utf8"),
            });
          }
          if (undecryptable) warnings.push(`${undecryptable} 个密码无法解密（可能是新版应用绑定加密），已跳过`);
        } catch (error: any) {
          warnings.push(`读取密码失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          loginDb.close();
        }
      }
    }

    // 浏览记录：History 数据库不加密，直接复制读取
    if (wantHistory) {
      await copyForRead(profileDir, ["History", "History-wal", "History-shm"], stagingDir);
      const historyDb = await openDatabaseCopy(stagingDir, "History");
      if (historyDb) {
        try {
          const rows = historyDb.prepare(
            "SELECT url, title, visit_count, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 5000",
          ).all();
          for (const row of rows) {
            const url = String(row.url || "");
            if (!/^https?:\/\//i.test(url)) continue;
            history.push({
              url,
              title: String(row.title || ""),
              visits: Number(row.visit_count || 0),
              lastVisit: chromeTimeToUnix(Number(row.last_visit_time || 0)),
            });
          }
        } catch (error: any) {
          warnings.push(`读取浏览记录失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          historyDb.close();
        }
      }
    }

    // localStorage：SPA 站点（如 kimi）把登录令牌存在这里，只导 Cookie 无法迁移登录态。
    // LevelDB 目录整体复制后离线解析（浏览器运行中复制可能带半截文件，解析器已按容错设计）
    if (wantLocalStorage) {
      try {
        const leveldbSource = path.join(profileDir, "Local Storage", "leveldb");
        const leveldbCopy = path.join(stagingDir, "leveldb");
        await fs.mkdir(leveldbCopy, { recursive: true });
        let fileCount = 0;
        for (const name of await fs.readdir(leveldbSource).catch(() => [])) {
          if (!/\.(log|ldb|sst)$/i.test(name)) continue;
          await fs.copyFile(path.join(leveldbSource, name), path.join(leveldbCopy, name)).catch(() => {});
          fileCount += 1;
        }
        if (fileCount) {
          localStorageData = await readLocalStorageLeveldb(leveldbCopy);
          if (site) localStorageData = filterLocalStorageForOrigin(localStorageData, site.origin);
        }
      } catch (error: any) {
        warnings.push(`读取 localStorage 失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
  return {
    ok: true,
    browser: browser.name,
    keySource: material?.source || "",
    cookies,
    passwords,
    history,
    localStorage: localStorageData,
    warnings,
  };
}

// ---- 按站点只读提取登录态（供后台浏览器临时分区使用）----

// Cookie 域匹配：host-only（example.com）与域 Cookie（.example.com）都只匹配自身及其子域
export function cookieMatchesHost(cookieHost, hostname, hostOnly = undefined) {
  const rawDomain = String(cookieHost || "").toLowerCase();
  const domain = rawDomain.replace(/^\./, "");
  const host = String(hostname || "").toLowerCase();
  if (!domain || !host) return false;
  const exactOnly = hostOnly === true || (hostOnly !== false && !rawDomain.startsWith('.'));
  return host === domain || (!exactOnly && host.endsWith(`.${domain}`));
}

export function filterLocalStorageForOrigin(data, origin) {
  const entries = data && typeof data === "object" ? data[String(origin || "")] : null;
  return entries && typeof entries === "object" ? { [origin]: entries } : {};
}

async function resolveChromiumProfileDir(userDataDir, profileId) {
  const id = String(profileId || "Default");
  if (id.includes("..") || path.isAbsolute(id)) return "";
  const profileDir = path.join(userDataDir, id);
  if (await pathExists(profileDir)) return profileDir;
  // Opera 等浏览器的默认画像就是用户数据目录本身
  if (id === "Default" && (await pathExists(path.join(userDataDir, "Cookies")) || await pathExists(path.join(userDataDir, "Network", "Cookies")))) return userDataDir;
  return "";
}

// Firefox 存储目录名：https+++example.com 或 https+++example.com+8443（端口），容器画像带 ^userContextId 后缀
function geckoOriginDirName(origin) {
  const url = new URL(origin);
  return `${url.protocol.replace(":", "")}+++${url.hostname}${url.port ? `+${url.port}` : ""}`;
}

async function readGeckoLocalStorage(profileDir, origin, stagingDir) {
  const lsDir = path.join(profileDir, "storage", "default", geckoOriginDirName(origin), "ls");
  await copyForRead(lsDir, ["data.sqlite", "data.sqlite-wal", "data.sqlite-shm"], stagingDir);
  const db = await openDatabaseCopy(stagingDir, "data.sqlite");
  if (!db) return {};
  try {
    const entries = {};
    for (const row of db.prepare("SELECT key, value, conversion_type, compression_type FROM data").all() as any[]) {
      let value: any = row.value;
      if (typeof value !== "string") {
        let bytes = Buffer.from(value || []);
        if (Number(row.compression_type) === 1) bytes = snappyDecompress(bytes);
        value = bytes.toString(Number(row.conversion_type) === 1 ? "utf8" : "utf16le");
      }
      entries[String(row.key)] = String(value);
    }
    return Object.keys(entries).length ? { [origin]: entries } : {};
  } finally {
    db.close();
  }
}

// Firefox 系：Cookie（moz_cookies）与浏览记录（moz_places）为明文 SQLite；密码由 NSS 主密码保护，不导入
async function importGeckoData(browser, profileId, { wantCookies, wantPasswords, wantHistory, wantLocalStorage }, site = null as any) {
  const id = String(profileId || "");
  const profile = browser.profiles.find((item) => item.id === id) || (id === "Default" || !id ? browser.profiles[0] : null);
  if (!profile) return { ok: false, error: "没有找到这个浏览器的用户画像目录" };
  const profileDir = path.join(browser.userDataDir, profile.id);
  const warnings = [];
  const cookies = [];
  const history = [];
  let localStorageData = {};
  if (wantPasswords) warnings.push(`${browser.name} 的密码由浏览器主密码保护，未导入`);
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-browser-import-"));
  try {
    if (wantCookies) {
      await copyForRead(profileDir, ["cookies.sqlite", "cookies.sqlite-wal", "cookies.sqlite-shm"], stagingDir);
      const db = await openDatabaseCopy(stagingDir, "cookies.sqlite");
      if (db) {
        try {
          const now = Date.now() / 1000;
          for (const row of db.prepare("SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite, originAttributes FROM moz_cookies").all() as any[]) {
            if (String(row.originAttributes || "")) continue; // 容器/隐私标签页的 Cookie 不属于普通登录态
            if (site && !cookieMatchesHost(row.host, site.hostname)) continue;
            let expires = Number(row.expiry || 0);
            if (expires > 1e11) expires = Math.floor(expires / 1000); // 新版 Firefox 以毫秒记录
            if (expires && expires < now) continue;
            const sameSite = Number(row.sameSite ?? -1);
            cookies.push({
              host: String(row.host || ""),
              name: String(row.name || ""),
              value: String(row.value ?? ""),
              path: String(row.path || "/"),
              expires,
              secure: Boolean(Number(row.isSecure)),
              httpOnly: Boolean(Number(row.isHttpOnly)),
              // Firefox：0=None 1=Lax 2=Strict，与 Chromium 编码一致；其他值视为未指定
              sameSite: sameSite >= 0 && sameSite <= 2 ? sameSite : -1,
            });
          }
        } catch (error: any) {
          warnings.push(`读取 Cookie 失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          db.close();
        }
      } else {
        warnings.push("没有找到 Cookie 数据库（浏览器可能从未保存过 Cookie）");
      }
    }
    if (wantHistory) {
      await copyForRead(profileDir, ["places.sqlite", "places.sqlite-wal", "places.sqlite-shm"], stagingDir);
      const db = await openDatabaseCopy(stagingDir, "places.sqlite");
      if (db) {
        try {
          const rows = db.prepare("SELECT url, title, visit_count, last_visit_date FROM moz_places WHERE last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT 5000").all() as any[];
          for (const row of rows) {
            const url = String(row.url || "");
            if (!/^https?:\/\//i.test(url)) continue;
            history.push({ url, title: String(row.title || ""), visits: Number(row.visit_count || 0), lastVisit: Math.floor(Number(row.last_visit_date || 0) / 1e6) });
          }
        } catch (error: any) {
          warnings.push(`读取浏览记录失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          db.close();
        }
      }
    }
    // Firefox localStorage 按站点分目录存放；整库导入时不逐站扫描，只在按站点提取时读取
    if (wantLocalStorage && site?.origin) {
      try {
        localStorageData = await readGeckoLocalStorage(profileDir, site.origin, stagingDir);
      } catch (error: any) {
        warnings.push(`读取 localStorage 失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
  return { ok: true, browser: browser.name, keySource: "", cookies, passwords: [], history, localStorage: localStorageData, warnings };
}

// 不解密，只统计某画像中匹配站点的 Cookie 条数：用于 auto 模式挑选来源，避免逐个触发系统密钥链弹窗
async function countSiteCookies(browser, profileId, hostname) {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-browser-probe-"));
  try {
    let db = null;
    let query = "";
    if (browser.engine === "gecko") {
      await copyForRead(path.join(browser.userDataDir, profileId), ["cookies.sqlite", "cookies.sqlite-wal", "cookies.sqlite-shm"], stagingDir);
      db = await openDatabaseCopy(stagingDir, "cookies.sqlite");
      query = "SELECT host AS host FROM moz_cookies WHERE originAttributes = ''";
    } else {
      const profileDir = await resolveChromiumProfileDir(browser.userDataDir, profileId);
      if (!profileDir) return 0;
      for (const directory of [path.join(profileDir, "Network"), profileDir]) {
        await copyForRead(directory, ["Cookies", "Cookies-wal", "Cookies-shm"], stagingDir);
        db = await openDatabaseCopy(stagingDir, "Cookies");
        if (db) break;
      }
      query = "SELECT host_key AS host FROM cookies";
    }
    if (!db) return 0;
    try {
      return (db.prepare(query).all() as any[]).filter((row) => cookieMatchesHost(row.host, hostname)).length;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

function sameSiteName(value) {
  if (typeof value === "string") return ["no_restriction", "lax", "strict"].includes(value) ? value : "unspecified";
  return value === 0 ? "no_restriction" : value === 1 ? "lax" : value === 2 ? "strict" : "unspecified";
}

// 统一成 Electron session.cookies.set 的参数。会话级 Cookie 保持无有效期：临时分区随任务销毁。
export function toCookieSetDetails(cookie) {
  const host = String(cookie.host || cookie.domain || "");
  if (!host || !cookie.name) return null;
  const hostOnly = cookie.hostOnly === true || (cookie.hostOnly !== false && !host.startsWith("."));
  return {
    url: `http${cookie.secure ? "s" : ""}://${host.replace(/^\./, "")}${cookie.path || "/"}`,
    name: String(cookie.name),
    value: String(cookie.value ?? ""),
    ...(hostOnly ? {} : { domain: host }),
    path: cookie.path || "/",
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: sameSiteName(cookie.sameSite),
    ...(Number(cookie.expires || cookie.expirationDate) > 0 ? { expirationDate: Number(cookie.expires || cookie.expirationDate) } : {}),
  };
}

async function loadBuiltinSiteSession({ hostname, origin, builtinSession, appDataDir }) {
  const cookies = [];
  if (builtinSession?.cookies?.get) {
    for (const cookie of await builtinSession.cookies.get({})) {
      if (!cookieMatchesHost(cookie.domain, hostname, cookie.hostOnly)) continue;
      cookies.push({ host: cookie.domain, hostOnly: cookie.hostOnly, name: cookie.name, value: cookie.value, path: cookie.path,
        expires: cookie.session ? 0 : Number(cookie.expirationDate || 0), secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite });
    }
  }
  let localStorage = {};
  const leveldbSource = appDataDir ? path.join(appDataDir, "Partitions", "dyworker-browser", "Local Storage", "leveldb") : "";
  if (leveldbSource && await pathExists(leveldbSource)) {
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-browser-builtin-"));
    try {
      for (const name of await fs.readdir(leveldbSource).catch(() => [])) {
        if (/\.(log|ldb|sst)$/i.test(name)) await fs.copyFile(path.join(leveldbSource, name), path.join(stagingDir, name)).catch(() => {});
      }
      localStorage = filterLocalStorageForOrigin(await readLocalStorageLeveldb(stagingDir), origin);
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  return { ok: true, sourceLabel: "内置浏览器", sourceIdentity: "builtin", cookies, localStorage, warnings: [] };
}

function pickProfile(browser, profileId) {
  const id = String(profileId || "").trim();
  if (id) return browser.profiles.find((item) => item.id === id || item.name === id)?.id || "";
  return browser.profiles.find((item) => item.id === "Default")?.id || browser.profiles[0]?.id || "Default";
}

// 按目标网址只读提取某个浏览器环境的登录态：只返回匹配该站点的 Cookie 与同源 localStorage。
// source：builtin（内置浏览器）、auto（先内置，再在本机浏览器中选匹配 Cookie 最多的画像）、
// 或任意浏览器 ID/名称（chrome、edge、firefox、arc、vivaldi、opera 及自动发现的 Chromium 系浏览器）。
export async function loadSiteSession({ url, source = "auto", profileId = "", builtinSession = null, appDataDir = "", listBrowsers = listImportableBrowsers, importData = importBrowserData } = {} as any) {
  let target;
  try { target = new URL(String(url || "")); } catch { return { ok: false, error: "网址无效，无法匹配登录状态" }; }
  if (!/^https?:$/.test(target.protocol)) return { ok: false, error: "只有 HTTP/HTTPS 网址可以复用登录状态" };
  const hostname = target.hostname.toLowerCase();
  const origin = target.origin;
  const wanted = String(source || "auto").trim().toLowerCase();
  if (wanted === "builtin") return loadBuiltinSiteSession({ hostname, origin, builtinSession, appDataDir });
  const finish = async (browser, chosenProfile) => {
    const result: any = await importData(browser, chosenProfile, { cookies: true, passwords: false, history: false, localstorage: true }, { hostname, origin });
    if (!result.ok) return result;
    const profileName = browser.profiles.find((item) => item.id === chosenProfile)?.name || chosenProfile;
    return { ok: true, sourceLabel: `${browser.name}（${profileName}）`, sourceIdentity: JSON.stringify([browser.id, chosenProfile]), cookies: result.cookies,
      localStorage: filterLocalStorageForOrigin(result.localStorage, origin), warnings: result.warnings || [] };
  };
  const browsers = await listBrowsers();
  if (wanted === "auto") {
    const builtin = await loadBuiltinSiteSession({ hostname, origin, builtinSession, appDataDir }).catch(() => null);
    if (builtin?.cookies.length) return builtin;
    let best = null;
    for (const browser of browsers) {
      for (const profile of browser.profiles) {
        const count = await countSiteCookies(browser, profile.id, hostname);
        if (count > (best?.count || 0)) best = { browser, profile: profile.id, count };
      }
    }
    if (!best) return { ok: false, error: `本机已发现的浏览器中都没有 ${hostname} 的登录 Cookie` };
    return finish(best.browser, best.profile);
  }
  const browser = browsers.find((item) => item.id.toLowerCase() === wanted)
    || browsers.find((item) => item.name.toLowerCase() === wanted)
    || browsers.find((item) => item.id.toLowerCase().includes(wanted) || item.name.toLowerCase().includes(wanted));
  if (!browser) {
    return { ok: false, error: `没有找到浏览器「${source}」的数据目录。本机可用：builtin、auto${browsers.length ? `、${browsers.map((item) => item.id).join("、")}` : ""}` };
  }
  const chosenProfile = pickProfile(browser, profileId);
  if (!chosenProfile) return { ok: false, error: `${browser.name} 没有画像「${profileId}」。可用画像：${browser.profiles.map((item) => `${item.id}（${item.name}）`).join("、")}` };
  return finish(browser, chosenProfile);
}
