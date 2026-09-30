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
import { readJson, writeJson } from "../io.mts";

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
    await writeJson(this.settingsFile, preserveUndecryptableSecrets(serializeSettings(nextSettings, this.safeStorage), stored, this.safeStorage));
    return updateUrl;
  }
}
