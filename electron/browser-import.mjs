// 从本机其他浏览器导入 Cookie 与密码（对照 Codex 浏览器「导入 Cookie 和密码」）。
// 仅支持 Chromium 系浏览器：macOS 走 Keychain 的「XXX Safe Storage」派生 AES-CBC 密钥，
// Linux 优先 Secret Service（secret-tool），无密钥链时回退 Chromium 默认口令 "peanuts"，
// Windows 走 Local State + DPAPI 解出的 AES-GCM 密钥（Chrome 127+ 的 v20 应用绑定加密无法离线解密，会跳过并提示）。
// Linux 国产化环境额外覆盖 360 安全浏览器（~/.config/browser360）与奇安信可信浏览器（qaxbrowser）。
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
];

function execCommand(command, args, { input, timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", timeout, windowsHide: true, input }, (error, stdout) => {
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
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, relative);
  }
  return path.join(os.homedir(), relative);
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
  const browsers = [];
  for (const browser of found.values()) {
    browsers.push({
      id: browser.id,
      name: browser.name,
      userDataDir: browser.userDataDir,
      keyNames: browser.keyNames,
      profiles: await listProfiles(browser.userDataDir),
    });
  }
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
      .map(([id, info]) => ({ id, name: String(info?.name || id) }));
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
    } catch (error) {
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
  return pathExists(file).then((exists) => exists ? new DatabaseSync(file) : null);
}

function chromeTimeToUnix(microseconds) {
  const value = Number(microseconds || 0);
  if (!value) return 0;
  return Math.floor(value / 1e6) - CHROME_EPOCH_OFFSET_SECONDS;
}

// 读取并解密指定画像的 Cookie 与密码；浏览记录无需解密。kinds 控制导入哪些类别
export async function importBrowserData(source, profileId = "Default", kinds = {}) {
  const wantCookies = kinds.cookies !== false;
  const wantPasswords = kinds.passwords !== false;
  const wantHistory = kinds.history !== false;
  const browsers = await listImportableBrowsers();
  const browser = browsers.find((item) => item.id === source.id && item.userDataDir === source.userDataDir)
    || browsers.find((item) => item.id === source.id);
  if (!browser) return { ok: false, error: "没有找到这个浏览器的数据目录" };
  const catalogEntry = CHROMIUM_CATALOG.find((item) => item.id === browser.id);
  const keySource = { ...browser, keyNames: browser.keyNames || catalogEntry?.keyNames || [] };
  const profileDir = path.join(browser.userDataDir, String(profileId || "Default"));
  if (!(await pathExists(profileDir))) return { ok: false, error: "没有找到这个浏览器的用户画像目录" };

  // 只有导入 Cookie/密码时才需要解密密钥（避免只导入浏览记录也触发系统密钥链授权弹窗）
  let material = null;
  let key = null;
  if (wantCookies || wantPasswords) {
    material = await resolveKeyMaterial(keySource);
    if (material.error) return { ok: false, error: material.error };
    key = deriveKey(material);
  }

  const warnings = [];
  const cookies = [];
  const passwords = [];
  const history = [];
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
          ).all();
          let undecryptable = 0;
          for (const row of rows) {
            const expiresUtc = Number(row.expires_utc || 0);
            if (expiresUtc && expiresUtc < nowChromeTime) continue; // 跳过已过期
            let value = typeof row.value === "string" ? row.value : "";
            if (!value && row.encrypted_value) {
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
        } catch (error) {
          warnings.push(`读取 Cookie 失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          cookieDb.close();
        }
      } else {
        warnings.push("没有找到 Cookie 数据库（浏览器可能从未保存过 Cookie）");
      }
    }

    if (wantPasswords) {
      await copyForRead(profileDir, ["Login Data", "Login Data-wal", "Login Data-shm"], stagingDir);
      const loginDb = await openDatabaseCopy(stagingDir, "Login Data");
      if (loginDb) {
        try {
          const rows = loginDb.prepare(
            "SELECT origin_url, username_value, password_value FROM logins WHERE blacklisted_by_user = 0",
          ).all();
          let undecryptable = 0;
          for (const row of rows) {
            const encrypted = Buffer.isBuffer(row.password_value) ? row.password_value : Buffer.from(row.password_value || []);
            const plain = decryptChromiumValue(encrypted, material, key);
            if (!plain) { undecryptable += 1; continue; }
            passwords.push({
              origin: String(row.origin_url || ""),
              username: String(row.username_value || ""),
              password: plain.toString("utf8"),
            });
          }
          if (undecryptable) warnings.push(`${undecryptable} 个密码无法解密（可能是新版应用绑定加密），已跳过`);
        } catch (error) {
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
        } catch (error) {
          warnings.push(`读取浏览记录失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          historyDb.close();
        }
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
    warnings,
  };
}
