export {PLUGIN_CATALOG,CATALOG_CATEGORIES,CATALOG_SNAPSHOT_DATE,catalogSorted,filterCatalog,isInstalled,isVerifiedEntry} from '../electron/host/verified-plugin-catalog.ts';
export type {CatalogPlugin} from '../electron/host/verified-plugin-catalog.ts';
import { isListedCatalogPackage, isVerifiedEntry } from '../electron/host/verified-plugin-catalog.ts';
import type { CatalogPlugin } from '../electron/host/verified-plugin-catalog.ts';
import type { PluginBundleRecord, PluginEntryRecord } from './types';

/** 本地制作并经安装检查的插件保留管理入口，不混入推荐清单。 */
export function isVisibleInstalledPlugin(entry: PluginEntryRecord, bundle: PluginBundleRecord | undefined, catalog: CatalogPlugin[]) {
  if (entry.builtin) return true;
  return isListedCatalogPackage(entry.name) && (bundle?.source?.kind === 'local' || isVerifiedEntry(entry, bundle?.version, catalog));
}
