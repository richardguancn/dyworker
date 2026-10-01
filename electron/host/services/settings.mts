// 设置服务：把 main.mts 的 readSettings/saveSettings 持久化逻辑收编为 cordis
// 服务。职责边界：
//   - read()：读盘 → 解密 → 逐个应用 migrator（模型目录等领域修正）→ 检测到
//     密钥迁移/字段规范化差异时回写（解不开的密文原样保留）。
//   - write()：updateUrl 校验规范化 → 加密落盘；返回最终 updateUrl 供壳层
//     （main.mts）联动 appUpdater——持久化与应用反应分离，服务不感知更新器。
// safeStorage 与 migrator 由宿主注入，本文件不依赖 electron。
import { Service } from "cordis";
import {
  deserializeSettings,
  needsSecretMigration,
  preserveUndecryptableSecrets,
  serializeSettings,
} from "../../settings.mts";
import { DEFAULT_UPDATE_URL, normalizeUpdateUrl, parseGithubUpdateUrl } from "../../app-updater.mts";
import fs from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson } from "../io.mts";

// "有 → 无"判定：落盘前若这些字段从有值变成空，说明很可能是异常覆盖而非用户主动清空
function hasModelConfig(source) {
  if (!source || typeof source !== "object") return false;
  const text = (value) => String(value ?? "").trim();
  if (text(source.endpoint) && text(source.model)) return true;
  if (text(source.apiKey) && source.encrypted === true) return true;
  if (Array.isArray(source.profiles) && source.profiles.length) return true;
  return false;
}

function losesModelConfig(stored, next) {
  return hasModelConfig(stored) && !hasModelConfig(next);
}

declare module "cordis" {
  interface Context {
    settings: SettingsService;
  }
}

export class SettingsService extends Service {
  settingsFile;
  safeStorage;
  migrators;

  constructor(ctx, config = {} as any) {
    super(ctx, "settings");
    this.settingsFile = config.settingsFile;
    this.safeStorage = config.safeStorage;
    this.migrators = config.migrators || [];
  }

  async read() {
    const stored = await readJson(this.settingsFile, {});
    const settings = deserializeSettings(stored, this.safeStorage);
    for (const migrate of this.migrators) migrate(settings);
    const approvalModeMigrated = stored?.approvalMode !== settings.approvalMode
      || stored?.channels?.approvalMode === "allow-writes";
    const updateUrlMigrated = stored?.updateUrl !== settings.updateUrl;
    if (needsSecretMigration(stored) || approvalModeMigrated || updateUrlMigrated) {
      // 解不开的密钥密文必须原样保留（签名变化导致暂时解不开时，写空值会永久毁掉密钥）
      await writeJson(this.settingsFile, preserveUndecryptableSecrets(serializeSettings(settings, this.safeStorage), stored, this.safeStorage));
    }
    return settings;
  }

  async write(settings) {
    const rawUpdateUrl = String(settings?.updateUrl || DEFAULT_UPDATE_URL).trim() || DEFAULT_UPDATE_URL;
    parseGithubUpdateUrl(rawUpdateUrl);
    const updateUrl = normalizeUpdateUrl(rawUpdateUrl);
    const nextSettings = { ...settings, updateUrl };
    const stored = await readJson(this.settingsFile, {});
    // 曾经发生过"渲染端拿到空状态后保存，把模型配置一次性覆盖成空"的事故：
    // 落盘前若检测到凭据/档案由"有"变"无"，先留一份快照再覆盖（覆盖仍然执行，
    // 保证正常清空配置的流程不被阻断，但事后可从这里取回）。
    if (losesModelConfig(stored, nextSettings)) await this.snapshotBeforeCredentialLoss(stored);
    await writeJson(this.settingsFile, preserveUndecryptableSecrets(serializeSettings(nextSettings, this.safeStorage), stored, this.safeStorage));
    return updateUrl;
  }

  // 模型配置快照：settings.json.<时间戳>.bak，只保留最近 5 份
  async snapshotBeforeCredentialLoss(stored) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await writeJson(`${this.settingsFile}.${stamp}.bak`, stored);
      const siblings = (await fs.readdir(path.dirname(this.settingsFile)))
        .filter((name) => name.startsWith(`${path.basename(this.settingsFile)}.`) && name.endsWith(".bak"))
        .sort();
      for (const stale of siblings.slice(0, Math.max(0, siblings.length - 5))) {
        await fs.rm(path.join(path.dirname(this.settingsFile), stale), { force: true }).catch(() => {});
      }
      console.warn(`[settings] 检测到模型配置由非空变空，已快照到 ${path.basename(this.settingsFile)}.${stamp}.bak`);
    } catch {
      // 快照失败不阻断保存
    }
  }
}
