import { useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronDown, FolderOpen, Loader2, PackageOpen, Share2, Sparkles, X } from "lucide-react";
import { t } from "./i18n";
import { PluginGlyph, pluginTileStyle } from "./lib/pluginIcons";
import { extractDroppedShareFile, formatShareBytes, hasDraggedShareFiles, type ShareDropInput } from "./lib/pluginShare";
import { SharePluginDialog } from "./SharePluginDialog";
import { pluginHotMountRef } from "./state/sharedRefs";
import type { CreatedLocalPluginRecord, PluginCompatibility, PluginSharePackagePreview } from "./types";

// 「添加插件」弹窗：支持「本地目录 / 我创建的插件」与「包名 / GitHub 仓库」两种入口。
//
// 本地纯 JS 插件走受控离线拷贝安装并在启用后自动热挂载打开；
// 网络来源保留官方源 / 中国大陆镜像源 / 自定义地址，并保留来源可信与默认不执行安装脚本提示。

function getVerdictLabel(verdict?: string) {
  switch (verdict) {
    case "runnable": return t("plugins.compat.runnable", "可以运行");
    case "partial": return t("plugins.compat.partial", "部分兼容");
    case "unsupported": return t("plugins.compat.unsupported", "无法运行");
    case "pending": return t("plugins.compat.pending", "安装后检查");
    default: return verdict || "";
  }
}

function verdictClass(verdict?: string) {
  if (verdict === "runnable") return "ok";
  if (verdict === "partial") return "warn";
  if (verdict === "pending") return "warn";
  return "bad";
}

function isLocalPathLike(value: string): boolean {
  const trimmed = String(value || "").trim();
  return /^[.~/]/.test(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\");
}

function isRemoteRepoLike(value: string): boolean {
  return /^\s*(https?:\/\/)?(www\.)?github\.com\//i.test(value);
}

export function AddPluginDialog({
  onClose,
  onInstalled,
  initialSpec = "",
  initialMode,
  initialShareFile = null,
  onShareLocal,
}: {
  onClose: () => void;
  onInstalled: () => void;
  initialSpec?: string;
  initialMode?: "local" | "remote";
  initialShareFile?: ShareDropInput | null;
  onShareLocal?: (target: string, title?: string) => void;
}) {
  const inferredMode: "local" | "remote" = initialMode
    ?? (initialSpec && !isLocalPathLike(initialSpec) ? "remote" : "local");
  const [mode, setMode] = useState<"local" | "remote">(inferredMode);
  const [input, setInput] = useState(initialSpec);
  const [version, setVersion] = useState("");
  const [source, setSource] = useState<"default" | "cn" | "custom">("default");
  const [customRegistry, setCustomRegistry] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceWrapRef = useRef<HTMLDivElement | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [allowIncompatible, setAllowIncompatible] = useState(false);
  const [compat, setCompat] = useState<PluginCompatibility | null>(null);
  const [createdPlugins, setCreatedPlugins] = useState<CreatedLocalPluginRecord[]>([]);
  const [createdLoading, setCreatedLoading] = useState(false);
  const [quickBusyDir, setQuickBusyDir] = useState("");
  const [shareInput, setShareInput] = useState<ShareDropInput | null>(null);
  const [sharePreview, setSharePreview] = useState<PluginSharePackagePreview | null>(null);
  const [importData, setImportData] = useState(true);
  const [overwriteData, setOverwriteData] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [inlineShareTarget, setInlineShareTarget] = useState<{ target: string; title?: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [log, setLog] = useState("");
  // 安装结果视图（对齐 DSH 的"已安装"卡片）：成功给"立即启用"，失败给原因与"仍然安装"
  const [result, setResult] = useState<{
    ok: boolean; name: string; entryId?: string; version?: string; description?: string;
    verdict?: string; reasons?: string[]; matrix?: string; source?: string;
    dir?: string; patchFile?: string; detailOpen?: boolean;
    incompatible?: boolean;
  } | null>(null);

  const bridge = typeof window !== "undefined" ? window.dyworker : undefined;
  const target = input.trim();
  const treatAsLocal = mode === "local" && !isRemoteRepoLike(target);

  useEffect(() => {
    if (!sourceOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!sourceWrapRef.current?.contains(event.target as Node)) setSourceOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [sourceOpen]);

  // 加载创造模式受管目录中已创建的本地插件，便于一键安装/恢复
  useEffect(() => {
    let cancelled = false;
    if (!bridge?.listCreatedPlugins) return;
    setCreatedLoading(true);
    void bridge.listCreatedPlugins().then((items) => {
      if (!cancelled && Array.isArray(items)) setCreatedPlugins(items);
    }).catch(() => {
      // 列出失败时不阻塞弹窗主流程
    }).finally(() => {
      if (!cancelled) setCreatedLoading(false);
    });
    return () => { cancelled = true; };
  }, [bridge]);

  const SOURCE_OPTIONS = [
    { id: "default", label: t("plugins.source.default", "官方源"), hint: "registry.npmjs.org" },
    { id: "cn", label: t("plugins.source.cn", "中国大陆镜像源"), hint: "registry.npmmirror.com" },
    { id: "custom", label: t("plugins.source.custom", "自定义地址"), hint: "" },
  ] as const;
  const sourceLabel = SOURCE_OPTIONS.find((option) => option.id === source)?.label || t("plugins.source.default", "官方源");

  const check = async (override?: string) => {
    const probe = String(override ?? input ?? "").trim();
    if (!bridge?.checkPluginCompatibility || !probe) return;
    setBusy("check");
    setError("");
    setCompat(null);
    setLog("");
    try {
      // GitHub / 本地来源先要装进 profile 才能判定，这里只对包名做预检
      if (/^[\w@./-]+$/.test(probe) && !isLocalPathLike(probe) && !probe.includes("github.com")) {
        setCompat(await bridge.checkPluginCompatibility(probe));
      } else {
        setLog("GitHub / 本地来源需要先安装到插件目录，安装完成后会自动做兼容性判定。");
      }
    } catch (checkError: any) {
      setError(String(checkError?.message || checkError));
    } finally {
      setBusy("");
    }
  };

  // 市场点「安装」时带规格进来：直接预检一次，省掉用户再点一下
  useEffect(() => {
    if (!initialSpec) return;
    void check(initialSpec);
    // 只在挂载时按预填规格跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSpec]);

  const describeInstalled = async (name: string) => {
    try {
      const list = await bridge?.listPlugins();
      const bundle = list?.bundles?.find((item) => item.name === name || item.packageName === name);
      const entry = list?.entries?.find((item) => item.name === bundle?.packageName || item.name === name || item.id === name);
      return {
        version: bundle?.version || "",
        description: bundle?.description || entry?.description || "",
        entryId: entry?.id || name,
        source: bundle?.source?.kind || (bundle ? "npm" : ""),
        dir: list?.status?.dir || "",
        patchFile: bundle?.patchFile || "",
      };
    } catch {
      return { version: "", description: "", entryId: name, source: "", dir: "", patchFile: "" };
    }
  };

  const install = async (force = false) => {
    if (!bridge || !target) return;
    setBusy("install");
    setError("");
    setLog("");
    try {
      const payload = {
        input: target,
        version: !treatAsLocal ? (version.trim() || undefined) : undefined,
        source: !treatAsLocal ? source : "default",
        customRegistry: !treatAsLocal && source === "custom" ? customRegistry : undefined,
        allowIncompatible: force || allowIncompatible,
      };
      const installed = await bridge.installPluginPackage(payload);
      if (!installed?.ok) {
        // 不兼容：不直接报错了事，进入结果视图把原因摊开，并给出"仍然安装"的选择
        setResult({
          ok: false,
          name: installed?.analysis?.name || target,
          verdict: installed?.verdict,
          reasons: installed?.analysis?.reasons || (installed?.error ? [installed.error] : []),
          matrix: installed?.matrix,
          incompatible: installed?.incompatible,
          source: installed?.source?.kind || installed?.downloaded?.kind,
          version: installed?.analysis?.version,
          dir: installed?.dir,
          detailOpen: true,
        });
        return;
      }
      const info = await describeInstalled(installed.name || target);
      setResult({
        ok: true, name: installed.name || target, ...info,
        verdict: installed.verdict, reasons: installed.analysis?.reasons, matrix: installed.matrix,
      });
      onInstalled();
    } catch (installError: any) {
      setError(String(installError?.message || installError));
    } finally {
      setBusy("");
    }
  };

  const enableInstalled = async () => {
    if (!bridge || !result?.entryId) return;
    setBusy("enable");
    try {
      const enabled = await bridge.enablePlugin(result.entryId);
      if (!enabled?.ok) { setError(enabled?.error || "插件启用失败"); return; }
      await pluginHotMountRef.current.mountClientPlugin(result.entryId, { openSlot: true }).catch(() => null);
      onInstalled();
      onClose();
    } catch (enableError: any) {
      setError(String(enableError?.message || enableError));
    } finally {
      setBusy("");
    }
  };

  const chooseDirectory = async () => {
    if (!bridge?.choosePluginDirectory) return;
    setError("");
    const picked = await bridge.choosePluginDirectory().catch(() => null);
    if (picked) {
      setMode("local");
      setInput(picked);
      setLog("");
      setCompat(null);
    }
  };

  const inspectShareInput = async (payload: ShareDropInput) => {
    if (!bridge?.inspectPluginSharePackage) {
      setError("当前环境不支持导入插件分享包");
      return;
    }
    setBusy("share-inspect");
    setError("");
    setLog("");
    setResult(null);
    try {
      const preview = await bridge.inspectPluginSharePackage(payload);
      if (!preview?.ok) {
        setError(preview?.error || "分享包校验未通过");
        return;
      }
      setShareInput(payload);
      setSharePreview(preview);
      setImportData(Boolean(preview.includesData));
      setOverwriteData(false);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    if (!initialShareFile) return;
    void inspectShareInput(initialShareFile);
    // 仅在初始携带分享包时自动预检一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialShareFile]);

  const chooseShareFile = async () => {
    if (!bridge?.choosePluginShareFile) return;
    setError("");
    const picked = await bridge.choosePluginShareFile().catch(() => null);
    if (picked) {
      await inspectShareInput({ filePath: picked, fileName: picked.split(/[\\/]/).pop() });
    }
  };

  const confirmShareImport = async (force = false) => {
    if (!bridge?.importPluginSharePackage || !shareInput) return;
    setBusy("share-import");
    setError("");
    try {
      const imported = await bridge.importPluginSharePackage({
        ...shareInput,
        importData,
        overwriteData,
        allowIncompatible: force || allowIncompatible,
      });
      if (!imported?.ok) {
        setResult({
          ok: false,
          name: imported?.analysis?.name || sharePreview?.displayName || sharePreview?.packageName || "分享包插件",
          verdict: imported?.verdict,
          reasons: imported?.analysis?.reasons || (imported?.error ? [imported.error] : []),
          matrix: imported?.matrix,
          incompatible: imported?.incompatible,
          source: "local",
          version: sharePreview?.version,
          dir: imported?.pluginDir || imported?.dir,
          detailOpen: true,
        });
        return;
      }
      const targetEntryId = imported.entryId || imported.id || imported.packageName || sharePreview?.packageName || "";
      if (targetEntryId) {
        await pluginHotMountRef.current.mountClientPlugin(targetEntryId, { openSlot: true }).catch(() => null);
      }
      onInstalled();
      onClose();
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy("");
    }
  };

  const handleDialogDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedShareFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!dragOver) setDragOver(true);
  };

  const handleDialogDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDragOver(false);
    }
  };

  const handleDialogDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedShareFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDragOver(false);
    const dropped = await extractDroppedShareFile(event.dataTransfer);
    if (!dropped) {
      setError("仅支持拖入 .dyplugin 或 .zip 格式的插件分享包");
      return;
    }
    await inspectShareInput(dropped);
  };

  const quickInstallCreated = async (item: CreatedLocalPluginRecord) => {
    if (!bridge) return;
    setQuickBusyDir(item.dir);
    setBusy("quick");
    setError("");
    try {
      const installed = await bridge.installPluginPackage({
        input: item.dir,
        allowIncompatible: true,
      });
      if (!installed?.ok) {
        setInput(item.dir);
        setResult({
          ok: false,
          name: installed?.analysis?.name || item.displayName || item.packageName,
          verdict: installed?.verdict,
          reasons: installed?.analysis?.reasons || (installed?.error ? [installed.error] : []),
          matrix: installed?.matrix,
          incompatible: installed?.incompatible,
          source: "local",
          version: item.version,
          dir: installed?.dir,
          detailOpen: true,
        });
        return;
      }
      const info = await describeInstalled(installed.name || item.packageName);
      const entryId = info.entryId || item.entryId || installed.name || item.packageName;
      const enabled = await bridge.enablePlugin(entryId);
      if (!enabled?.ok) {
        setError(enabled?.error || "启用插件失败");
        return;
      }
      await pluginHotMountRef.current.mountClientPlugin(entryId, { openSlot: true }).catch(() => null);
      onInstalled();
      onClose();
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setQuickBusyDir("");
      setBusy("");
    }
  };

  const onInputChange = (nextValue: string) => {
    setInput(nextValue);
    if (isRemoteRepoLike(nextValue)) setMode("remote");
    else if (isLocalPathLike(nextValue)) setMode("local");
  };

  return createPortal(
    <div className="dialog-overlay" role="dialog" aria-label={t("plugins.addDialogAria", "添加插件")}>
      {inlineShareTarget ? (
        <SharePluginDialog
          target={inlineShareTarget.target}
          titleHint={inlineShareTarget.title}
          onClose={() => setInlineShareTarget(null)}
        />
      ) : null}
      <div
        className={`add-plugin-dialog ${dragOver ? "drag-over" : ""}`}
        onDragOver={handleDialogDragOver}
        onDragLeave={handleDialogDragLeave}
        onDrop={(event) => void handleDialogDrop(event)}
      >
        {result ? (
          <div className="install-result">
            <header className="add-plugin-header">
              <button className="icon-button subtle" onClick={onClose} aria-label={t("common.close", "关闭")}><X size={16} /></button>
            </header>

            <div className={`install-result-mark ${result.ok ? "ok" : "bad"}`}>
              {result.ok ? <Check size={26} /> : <AlertTriangle size={26} />}
            </div>
            <h3 className="install-result-title">{result.ok ? t("plugins.installedSuccess", "已安装") : result.incompatible ? (result.verdict === "partial" ? t("plugins.partialCompat", "部分功能不可用") : t("plugins.cannotRun", "无法运行")) : t("plugins.installFailed", "安装失败")}</h3>

            <div className="install-result-card">
              <strong>{result.name}</strong>
              {result.description ? <p>{result.description}</p> : null}
              {result.version ? <span className="install-result-version">{t("plugins.versionLabel", "版本")} {result.version}</span> : null}
            </div>

            <div className="install-result-details">
              <button className="add-plugin-guide-toggle" onClick={() => setResult({ ...result, detailOpen: !result.detailOpen })} aria-expanded={Boolean(result.detailOpen)}>
                <ChevronDown size={14} className={result.detailOpen ? "rotated" : ""} /> {t("plugins.viewInstallDetails", "查看安装详情")}
              </button>
              {result.detailOpen && (
                <div className="install-result-detail-body">
                  <div className="install-result-meta">
                    <span>{t("plugins.sourcePrefix", "来源：")}{{ npm: "npm 包", github: "GitHub 仓库", local: "本地目录" }[result.source || ""] || result.source || "—"}</span>
                    {result.version ? <span>{t("plugins.versionPrefix", "版本：")}{result.version}</span> : null}
                    {result.dir ? <span>{t("plugins.dirPrefix", "插件目录：")}{result.dir}</span> : null}
                    {result.patchFile ? <span>{t("plugins.manifestPrefix", "清单：")}{result.patchFile}</span> : null}
                  </div>
                  {result.reasons?.length ? <ul>{result.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
                  {result.matrix ? <pre>{result.matrix}</pre> : null}
                </div>
              )}
            </div>

            {result.ok ? (
              <button className="add-plugin-submit" onClick={() => void enableInstalled()} disabled={busy === "enable"}>
                {busy === "enable" ? <Loader2 size={14} className="spin" /> : null} {t("plugins.enableNow", "立即启用")}
              </button>
            ) : (
              <div className="install-result-actions">
                <button className="plugins-text-button" onClick={() => setResult(null)}>{t("common.back", "返回")}</button>
                {result.incompatible && <button className="add-plugin-submit" onClick={() => void (shareInput ? confirmShareImport(true) : install(true))} disabled={Boolean(busy)}>
                  {busy === "install" || busy === "share-import" ? <Loader2 size={14} className="spin" /> : null} {t("plugins.installAnyway", "仍然安装（部分功能可能不可用）")}
                </button>}
              </div>
            )}
            {error && <div className="plugins-message bad"><AlertTriangle size={14} /> <span>{error}</span></div>}
          </div>
        ) : sharePreview ? (
          <div className="plugin-share-import-view">
            <header className="add-plugin-header">
              <div className="add-plugin-header-title">
                <h2>{t("plugins.importShareTitle", "导入插件分享包")}</h2>
                <p className="add-plugin-sub">源码将保存至受管插件目录，安装后可随时用「创造模式」继续修改。</p>
              </div>
              <button className="icon-button subtle" onClick={onClose} aria-label={t("common.close", "关闭")}><X size={16} /></button>
            </header>

            <div className="plugin-share-preview-card">
              <div className="plugin-share-summary-head">
                <span
                  className="plugin-share-summary-icon"
                  style={pluginTileStyle(sharePreview.iconColor || "", sharePreview.packageName || "")}
                >
                  <PluginGlyph iconId={sharePreview.icon || ""} color={sharePreview.iconColor || ""} size={17} />
                </span>
                <strong>{sharePreview.displayName || sharePreview.packageName}</strong>
                {sharePreview.version ? <span className="plugin-tag">v{sharePreview.version}</span> : null}
                {sharePreview.author ? <span className="plugin-tag">{sharePreview.author}</span> : null}
                <span className="plugin-tag">{sharePreview.format === "zip" ? "ZIP 插件包" : ".dyplugin 分享包"}</span>
                {sharePreview.hasClient ? <span className="plugin-tag">含界面</span> : <span className="plugin-tag">纯工具</span>}
              </div>
              {sharePreview.description ? <p>{sharePreview.description}</p> : null}
              <div className="plugin-share-summary-meta">
                <span>包名：{sharePreview.packageName}</span>
                <span>文件数：{sharePreview.pluginFileCount || 0} 个</span>
              </div>
            </div>

            {sharePreview.alreadyInstalled ? (
              <div className="plugins-message warn">
                当前已安装同名插件{sharePreview.installedVersion ? `（v${sharePreview.installedVersion}）` : ""}，继续导入将替换为分享包版本（v{sharePreview.version || "—"}）。
              </div>
            ) : null}

            {sharePreview.hasThirdPartyDeps ? (
              <div className="add-plugin-build-note">
                该插件声明了第三方依赖（{(sharePreview.dependencies || []).join("、")}），安装时需连接包管理源拉取依赖。
              </div>
            ) : null}

            {sharePreview.includesData && sharePreview.dataFiles?.length ? (
              <div className="plugin-share-data-box">
                <label className="plugin-share-checkbox">
                  <input
                    type="checkbox"
                    checked={importData}
                    disabled={Boolean(busy)}
                    onChange={(event) => setImportData(event.target.checked)}
                  />
                  <span>导入分享包附带的插件数据（{sharePreview.dataFiles.length} 个文件）</span>
                </label>
                <div className="plugin-share-data-list">
                  <ul>
                    {sharePreview.dataFiles.slice(0, 8).map((item) => (
                      <li key={item.relativePath}>
                        <code>{item.relativePath}</code>
                        <span>{formatShareBytes(item.size)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {importData && sharePreview.conflictingDataFiles?.length ? (
                  <label className="plugin-share-checkbox plugin-share-overwrite">
                    <input
                      type="checkbox"
                      checked={overwriteData}
                      disabled={Boolean(busy)}
                      onChange={(event) => setOverwriteData(event.target.checked)}
                    />
                    <span>覆盖本机已有的 {sharePreview.conflictingDataFiles.length} 个同名数据文件（默认保留本机数据）</span>
                  </label>
                ) : null}
              </div>
            ) : null}

            <div className="add-plugin-warning">
              <AlertTriangle size={14} />
              <div>
                <p>请确认分享包来自可信同事或渠道。插件在本机以你的权限运行，导入默认不运行第三方安装脚本。</p>
              </div>
            </div>

            <label className="add-plugin-allow">
              <input type="checkbox" checked={allowIncompatible} onChange={(event) => setAllowIncompatible(event.target.checked)} />
              {t("plugins.allowIncompatible", "允许安装不完全兼容的插件（可能装载后不生效）")}
            </label>

            {error ? <div className="plugins-message bad"><AlertTriangle size={14} /> <span>{error}</span></div> : null}

            <div className="add-plugin-actions">
              <button
                type="button"
                className="plugins-text-button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setShareInput(null);
                  setSharePreview(null);
                  setError("");
                }}
              >
                {t("common.back", "返回")}
              </button>
              <button
                type="button"
                className="add-plugin-submit"
                disabled={Boolean(busy)}
                onClick={() => void confirmShareImport(false)}
              >
                {busy === "share-import" ? <Loader2 size={14} className="spin" /> : null}
                {busy === "share-import" ? "正在安装并启用…" : "确认安装并启用"}
              </button>
            </div>
          </div>
        ) : (
        <>
        <header className="add-plugin-header">
          <div className="add-plugin-header-title">
            <h2>{t("plugins.addPlugin", "添加插件")}</h2>
            <p className="add-plugin-sub">{t("plugins.addPluginSub", "输入插件的包名、GitHub 仓库地址或本地目录路径。")}</p>
          </div>
          <button className="icon-button subtle" onClick={onClose} aria-label={t("common.close", "关闭")}><X size={16} /></button>
        </header>

        <div className="add-plugin-tabs" role="tablist" aria-label="插件来源">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "local"}
            className={`add-plugin-tab ${mode === "local" ? "active" : ""}`}
            onClick={() => { setMode("local"); setError(""); }}
          >
            本地文件夹 / 我创建的
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "remote"}
            className={`add-plugin-tab ${mode === "remote" ? "active" : ""}`}
            onClick={() => { setMode("remote"); setError(""); }}
          >
            包名 / GitHub 仓库
          </button>
        </div>

        {mode === "local" && (createdLoading || createdPlugins.length > 0) ? (
          <div className="add-plugin-created">
            <div className="add-plugin-created-head">
              <span><Sparkles size={13} /> 我创建的本地功能</span>
              <small>点一下即可安装并打开使用</small>
            </div>
            {createdLoading ? (
              <div className="add-plugin-created-loading"><Loader2 size={13} className="spin" /> 正在扫描本地功能…</div>
            ) : (
              <div className="add-plugin-created-list">
                {createdPlugins.map((item) => {
                  const busyThis = quickBusyDir === item.dir;
                  return (
                    <div className="add-plugin-created-item" key={item.dir}>
                      <div className="add-plugin-created-info">
                        <strong>{item.displayName || item.packageName}</strong>
                        <span className="add-plugin-created-meta">
                          {item.installed ? (item.disabled ? "已停用" : "已安装") : "未安装"}
                          {item.version ? ` · v${item.version}` : ""}
                          {item.description ? ` · ${item.description}` : ""}
                        </span>
                      </div>
                      <div className="add-plugin-created-actions">
                        <button
                          type="button"
                          className="add-plugin-created-btn"
                          disabled={Boolean(busy)}
                          title="打包分享此插件"
                          onClick={() => {
                            if (onShareLocal) onShareLocal(item.dir, item.displayName || item.packageName);
                            else setInlineShareTarget({ target: item.dir, title: item.displayName || item.packageName });
                          }}
                        >
                          <Share2 size={13} /> 分享
                        </button>
                        <button
                          type="button"
                          className="add-plugin-created-btn"
                          disabled={Boolean(busy) || !item.valid}
                          title={item.valid ? undefined : (item.error || "插件校验未通过")}
                          onClick={() => void quickInstallCreated(item)}
                        >
                          {busyThis ? <Loader2 size={13} className="spin" /> : null}
                          {item.installed ? "重装并打开" : "一键安装"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        <div className="add-plugin-path-row">
          <input
            className="add-plugin-input"
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder={
              mode === "local"
                ? t("plugins.localInputPlaceholder", "选择或粘贴本地插件文件夹路径，例如 ~/dev/my-plugin")
                : t("plugins.inputPlaceholder", "例如 dsh-plugin-whale-pet，或 https://github.com/owner/repo，或 /path/to/plugin")
            }
            spellCheck={false}
            autoFocus
          />
          {mode === "local" && (bridge?.choosePluginShareFile || bridge?.choosePluginDirectory) ? (
            <div className="add-plugin-browse-group">
              {bridge?.choosePluginShareFile ? (
                <button
                  type="button"
                  className="add-plugin-browse-btn"
                  onClick={() => void chooseShareFile()}
                  disabled={Boolean(busy)}
                >
                  <PackageOpen size={14} /> {t("plugins.importShare", "导入分享包…")}
                </button>
              ) : null}
              {bridge?.choosePluginDirectory ? (
                <button
                  type="button"
                  className="add-plugin-browse-btn"
                  onClick={() => void chooseDirectory()}
                  disabled={Boolean(busy)}
                >
                  <FolderOpen size={14} /> 选择文件夹…
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {!treatAsLocal ? (
          <div className="add-plugin-row">
            <input
              className="add-plugin-version"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              placeholder={t("plugins.versionPlaceholder", "版本（仅包名来源可用）")}
              spellCheck={false}
            />
            <div className="add-plugin-source-wrap" ref={sourceWrapRef}>
              <button className="add-plugin-source-button" onClick={() => setSourceOpen((open) => !open)} aria-expanded={sourceOpen}>
                {t("plugins.sourcePrefix", "安装源")} <strong>{sourceLabel}</strong>
                <ChevronDown size={14} className={sourceOpen ? "rotated" : ""} />
              </button>
              {sourceOpen && (
                <div className="add-plugin-source-menu" role="radiogroup" aria-label="安装源">
                  {SOURCE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      role="radio"
                      aria-checked={source === option.id}
                      className={`add-plugin-source-option ${source === option.id ? "on" : ""}`}
                      onClick={() => {
                        setSource(option.id);
                        if (option.id !== "custom") setSourceOpen(false);
                      }}
                    >
                      <span className={`add-plugin-radio ${source === option.id ? "on" : ""}`} />
                      <span className="add-plugin-source-label">{option.label}</span>
                      {option.hint ? <span className="add-plugin-source-hint">{option.hint}</span> : null}
                    </button>
                  ))}
                  {source === "custom" && (
                    <div className="add-plugin-source-custom">
                      <input
                        value={customRegistry}
                        onChange={(event) => setCustomRegistry(event.target.value)}
                        placeholder="https://npm.example.com/"
                        spellCheck={false}
                      />
                      <p>填写内网或私有 npm 源地址，以 http:// 或 https:// 开头。若为需要登录的源，请把凭据放在本机的 ~/.npmrc 里。</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <button className="add-plugin-guide-toggle" onClick={() => setGuideOpen((open) => !open)} aria-expanded={guideOpen}>
          <ChevronDown size={14} className={guideOpen ? "rotated" : ""} /> 插件安装引导和示例
        </button>
        {guideOpen && (
          <div className="add-plugin-guide">
            <div><strong>包名</strong>：发布在 npm 上的插件，例如 <code>dsh-context</code>、<code>@deepseek-ai/dsh-agent-instructions</code></div>
            <div><strong>GitHub 仓库</strong>：<code>https://github.com/owner/repo</code>，可带分支/子目录 <code>/tree/main/packages/plugin</code></div>
            <div><strong>本地目录</strong>：磁盘上的插件目录或 <code>.tgz</code>，例如 <code>~/dev/my-plugin</code></div>
            <div className="add-plugin-guide-note">
              支持加载插件界面；兼容性检查会说明缺少哪些能力。部分兼容的插件可继续安装，必要能力缺失的插件可能无法运行。
            </div>
          </div>
        )}

        {isRemoteRepoLike(target) || (isLocalPathLike(target) && guideOpen) ? (
          <div className="add-plugin-build-note">
            GitHub 或本地目录需要包含已经构建好的插件文件。安装默认不运行插件的安装脚本；只有源码时，请先在可信环境构建，或使用作者发布的包名安装。
          </div>
        ) : null}

        {!treatAsLocal && source === "custom" && customRegistry.trim() ? (
          <div className="add-plugin-mirror-note">
            自定义源：<code>{customRegistry.trim()}</code>（npm 会带 <code>--registry</code> 使用它；需要登录的源请把凭据写进本机 <code>~/.npmrc</code>）
          </div>
        ) : null}

        {!treatAsLocal && source === "cn" ? (
          <div className="add-plugin-mirror-note">
            大陆镜像源：npm 走 <code>registry.npmmirror.com</code>；GitHub 走第三方代理（ghfast.top / gh-proxy.com / ghproxy.net，逐个回退）。
            <strong>代理会经手你拉取的代码</strong>，仅在直连不通时使用。
          </div>
        ) : null}

        <div className="add-plugin-warning">
          <AlertTriangle size={14} />
          <div>
            <p>请确认插件来源可信。插件在本机以你的权限运行，来源不明的插件可能损坏 DYWorker，或读取和泄露你的数据。</p>
            <p>插件不会自动更新。升级时直接添加同一插件的新版本；安装或启动失败会保留原有版本。{isLocalPathLike(target) && !guideOpen ? "（本地目录安装默认不运行插件的安装脚本。）" : ""}</p>
          </div>
        </div>

        <label className="add-plugin-allow">
          <input type="checkbox" checked={allowIncompatible} onChange={(event) => setAllowIncompatible(event.target.checked)} />
          {t("plugins.allowIncompatible", "允许安装不完全兼容的插件（可能装载后不生效）")}
        </label>

        {error && <div className="plugins-message bad"><AlertTriangle size={14} /> <span>{error}</span></div>}
        {log && !error && <div className="add-plugin-log">{log}</div>}
        {compat && (
          <div className={`plugins-compat ${verdictClass(compat.verdict)}`}>
            <div className="plugins-compat-head">
              {compat.verdict === "runnable" ? <Check size={14} /> : <AlertTriangle size={14} />}
              <strong>{compat.name}{compat.version ? `@${compat.version}` : ""}</strong>
              <span>{getVerdictLabel(compat.verdict)}</span>
            </div>
            <ul>{compat.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
        )}

        <div className="add-plugin-actions">
          <button className="plugins-text-button" onClick={() => void check()} disabled={!target || Boolean(busy)}>
            {busy === "check" ? <Loader2 size={14} className="spin" /> : null} {t("plugins.checkCompat", "检查兼容性")}
          </button>
          <button className="add-plugin-submit" onClick={() => void install()} disabled={!target || Boolean(busy)}>
            {busy === "install" ? <Loader2 size={14} className="spin" /> : null} {t("plugins.installAction", "安装")}
          </button>
        </div>
        </>
        )}
      </div>
    </div>,
    // portal 到 body：.plugins-page 自带 z-index，会把 fixed 弹窗关进它的层叠上下文，
    // 于是面板拖拽分隔条（z-index: 40）反而压在弹窗之上、竖线切穿弹窗。
    // 挂到 body 后弹窗与分隔条同在根层叠上下文，弹窗层（z-index: 80）稳定在分隔线之上。
    document.body,
  );
}
