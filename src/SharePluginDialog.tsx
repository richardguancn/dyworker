import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Copy, FolderOpen, Loader2, PackageCheck, Radio, Share2, X } from "lucide-react";
import { t } from "./i18n";
import { PluginGlyph, pluginTileStyle } from "./lib/pluginIcons";
import { copyShareText, formatShareBytes } from "./lib/pluginShare";
import { useLanShareStore } from "./state/lanShareStore";
import type { PluginExportInspection, PluginExportResult } from "./types";

// 分享插件弹窗：
// - 本地 / 创造模式插件：预检源码与关联存储数据，提供敏感信息提醒，默认仅打包本体、可选附带数据，导出 .dyplugin 单文件
// - 第三方外部插件：提供安装地址与一键复制分享引导，不重复打包外部依赖

export function SharePluginDialog({
  target,
  titleHint,
  onClose,
}: {
  target: string;
  titleHint?: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [inspection, setInspection] = useState<PluginExportInspection | null>(null);
  const [includeData, setIncludeData] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<PluginExportResult | null>(null);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<"" | "path" | "spec" | "text">("");

  const bridge = typeof window !== "undefined" ? window.dyworker : undefined;

  useEffect(() => {
    let cancelled = false;
    if (!bridge?.inspectPluginExport) {
      setLoading(false);
      setError("当前环境不支持插件导出分享");
      return;
    }
    setLoading(true);
    setError("");
    setExported(null);
    setIncludeData(false);

    void bridge.inspectPluginExport(target)
      .then((res) => {
        if (cancelled) return;
        if (!res?.ok) {
          setError(res?.error || "无法读取插件分享信息");
          setInspection(null);
        } else {
          setInspection(res);
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(String(err?.message || err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [bridge, target]);

  const handleCopy = async (key: "path" | "spec" | "text", text: string) => {
    const ok = await copyShareText(text);
    if (ok) {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? "" : prev)), 2000);
    }
  };

  const handleExport = async () => {
    if (!bridge?.exportPluginPackage || !inspection || inspection.shareKind !== "local") return;
    setExporting(true);
    setError("");
    try {
      const res = await bridge.exportPluginPackage({ target, includeData });
      if (res?.canceled) return;
      if (!res?.ok) {
        setError(res?.error || "导出分享包失败");
        return;
      }
      setExported(res);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setExporting(false);
    }
  };

  const activeWarnings = [
    ...(inspection?.pluginWarnings || []),
    ...(includeData ? (inspection?.dataWarnings || []) : []),
  ];
  const hasDataFiles = Boolean(inspection?.dataFiles?.length);

  return createPortal(
    <div className="dialog-overlay" role="dialog" aria-label={t("plugins.shareDialogAria", "分享插件")}>
      <div className="add-plugin-dialog share-plugin-dialog">
        <header className="add-plugin-header">
          <div className="add-plugin-header-title">
            <h2>{t("plugins.shareTitle", "分享插件")}</h2>
            <p className="add-plugin-sub">
              {inspection?.shareKind === "remote"
                ? "复制安装地址发给同事，对方在「添加插件 → 包名 / GitHub 仓库」粘贴即可安装。"
                : "打包成单个 .dyplugin 文件，可直接发给同事拖入或导入安装。"}
            </p>
          </div>
          <button className="icon-button subtle" onClick={onClose} aria-label={t("common.close", "关闭")}>
            <X size={16} />
          </button>
        </header>

        {loading ? (
          <div className="add-plugin-created-loading">
            <Loader2 size={15} className="spin" /> 正在检查插件内容与存储数据…
          </div>
        ) : error && !inspection ? (
          <div className="plugins-message bad">
            <AlertTriangle size={14} /> <span>{error}</span>
          </div>
        ) : exported?.ok ? (
          <div className="install-result">
            <div className="install-result-mark ok">
              <PackageCheck size={26} />
            </div>
            <h3 className="install-result-title">分享包已导出</h3>
            <div className="install-result-card">
              <div className="plugin-share-summary-head">
                <span
                  className="plugin-share-summary-icon"
                  style={pluginTileStyle(exported.iconColor || "", exported.packageName || target)}
                >
                  <PluginGlyph iconId={exported.icon || ""} color={exported.iconColor || ""} size={17} />
                </span>
                <strong>{exported.displayName || exported.packageName || titleHint}</strong>
                {exported.version ? <span className="plugin-tag">v{exported.version}</span> : null}
                {exported.author ? <span className="plugin-tag">{exported.author}</span> : null}
              </div>
              {exported.version || exported.bytes ? (
                <span className="install-result-version">
                  {exported.version ? `v${exported.version}` : ""}{exported.version && exported.bytes ? " · " : ""}{exported.bytes ? formatShareBytes(exported.bytes) : ""}
                </span>
              ) : null}
              <p className="plugin-share-path">{exported.path}</p>
            </div>
            <div className="plugin-share-meta-note">
              {exported.includesData
                ? `已附带 ${exported.includedDataFiles?.length || 0} 个插件数据文件。接收方导入时可选择是否还原数据。`
                : "仅包含插件源码本体（未附带个人运行数据），对方导入后还可使用「创造模式」继续修改。"}
            </div>
            <div className="install-result-actions">
              {exported.path && bridge?.revealInFolder ? (
                <button
                  type="button"
                  className="plugins-text-button"
                  onClick={() => void bridge.revealInFolder!(exported.path!)}
                >
                  <FolderOpen size={14} /> 在文件夹中显示
                </button>
              ) : null}
              {exported.path ? (
                <button
                  type="button"
                  className="add-plugin-submit"
                  onClick={() => void handleCopy("path", exported.path!)}
                >
                  {copiedKey === "path" ? <Check size={14} /> : <Copy size={14} />}
                  {copiedKey === "path" ? "已复制路径" : "复制文件路径"}
                </button>
              ) : null}
            </div>
          </div>
        ) : inspection?.shareKind === "remote" ? (
          <>
            <div className="plugin-share-summary-card">
              <div className="plugin-share-summary-head">
                <strong>{inspection.displayName || titleHint || inspection.packageName}</strong>
                {inspection.version ? <span className="plugin-tag">v{inspection.version}</span> : null}
                <span className="plugin-tag">{inspection.sourceKind === "github" ? "GitHub 仓库" : "npm 包"}</span>
              </div>
              {inspection.description ? <p>{inspection.description}</p> : null}
            </div>

            <div className="plugin-share-remote-box">
              <label>安装地址</label>
              <div className="plugin-share-code-row">
                <code>{inspection.installSpec || inspection.packageName}</code>
                <button
                  type="button"
                  className="plugins-text-button"
                  onClick={() => void handleCopy("spec", inspection.installSpec || inspection.packageName || "")}
                >
                  {copiedKey === "spec" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "spec" ? "已复制" : "复制地址"}
                </button>
              </div>
            </div>

            <div className="add-plugin-actions">
              <button type="button" className="plugins-text-button" onClick={onClose}>关闭</button>
              <button
                type="button"
                className="add-plugin-submit"
                onClick={() => void handleCopy("text", inspection.shareText || inspection.installSpec || "")}
              >
                {copiedKey === "text" ? "已复制完整分享说明" : "复制含安装指引的分享文案"}
              </button>
            </div>
          </>
        ) : inspection ? (
          <>
            <div className="plugin-share-summary-card">
              <div className="plugin-share-summary-head">
                <span
                  className="plugin-share-summary-icon"
                  style={pluginTileStyle(inspection.iconColor || "", inspection.packageName || target)}
                >
                  <PluginGlyph iconId={inspection.icon || ""} color={inspection.iconColor || ""} size={17} />
                </span>
                <strong>{inspection.displayName || titleHint || inspection.packageName}</strong>
                {inspection.version ? <span className="plugin-tag">v{inspection.version}</span> : null}
                {inspection.author ? <span className="plugin-tag">{inspection.author}</span> : null}
                {inspection.hasClient ? <span className="plugin-tag">含界面</span> : <span className="plugin-tag">纯工具</span>}
              </div>
              {inspection.description ? <p>{inspection.description}</p> : null}
              <div className="plugin-share-summary-meta">
                <span>包名：{inspection.packageName}</span>
                <span>源码文件：{inspection.pluginFileCount || 0} 个（已自动排除 node_modules 与 .git）</span>
              </div>
            </div>

            <div className="plugin-share-data-box">
              <label className="plugin-share-checkbox">
                <input
                  type="checkbox"
                  checked={includeData}
                  disabled={!hasDataFiles || exporting}
                  onChange={(event) => setIncludeData(event.target.checked)}
                />
                <span>附带当前插件数据（例如已整理好的话术、模板或配置）</span>
              </label>
              {hasDataFiles ? (
                <div className="plugin-share-data-list">
                  <small>
                    检测到 {inspection.dataFiles!.length} 个数据文件（共 {formatShareBytes(inspection.dataTotalBytes || 0)}），默认不附带：
                  </small>
                  <ul>
                    {inspection.dataFiles!.slice(0, 8).map((item) => (
                      <li key={item.relativePath}>
                        <code>{item.relativePath}</code>
                        <span>{formatShareBytes(item.size)}</span>
                      </li>
                    ))}
                    {inspection.dataFiles!.length > 8 ? (
                      <li className="muted">还有 {inspection.dataFiles!.length - 8} 个文件…</li>
                    ) : null}
                  </ul>
                </div>
              ) : (
                <p className="plugin-share-data-empty">当前插件未检测到独立保存的数据文件，仅导出插件本体。</p>
              )}
            </div>

            {activeWarnings.length > 0 ? (
              <div className="plugin-share-warning-list">
                <div className="plugin-share-warning-title">
                  <AlertTriangle size={14} />
                  <span>导出前隐私与路径提醒（请确认后再发送给他人）</span>
                </div>
                <ul>
                  {activeWarnings.slice(0, 6).map((item, idx) => (
                    <li key={`${item.file}-${idx}`}>
                      <strong>{item.file}</strong>：{item.reason}（<code>{item.preview}</code>）
                    </li>
                  ))}
                  {activeWarnings.length > 6 ? (
                    <li>另有 {activeWarnings.length - 6} 处同类提醒，请留意核查。</li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {error ? (
              <div className="plugins-message bad"><AlertTriangle size={14} /> <span>{error}</span></div>
            ) : null}

            <div className="add-plugin-actions">
              <button type="button" className="plugins-text-button" onClick={onClose} disabled={exporting}>
                取消
              </button>
              <button
                type="button"
                className="plugins-text-button"
                disabled={exporting}
                onClick={() => {
                  useLanShareStore.getState().openLanShareSend({
                    kind: "plugin",
                    pluginTarget: target,
                    includeData,
                    icon: inspection.icon,
                    iconColor: inspection.iconColor,
                    author: inspection.author,
                    title: inspection.displayName || titleHint || inspection.packageName || target,
                    subtitle: `${inspection.version ? `v${inspection.version} · ` : ""}${includeData ? "含插件数据" : "仅插件本体"}`,
                  });
                  onClose();
                }}
              >
                <Radio size={14} /> 局域网分享…
              </button>
              <button
                type="button"
                className="add-plugin-submit"
                onClick={() => void handleExport()}
                disabled={exporting}
              >
                {exporting ? <Loader2 size={14} className="spin" /> : <Share2 size={14} />}
                {exporting ? "正在打包…" : "导出 .dyplugin 分享包"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
