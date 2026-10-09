import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronDown, Loader2, X } from "lucide-react";
import type { PluginCompatibility } from "./types";

// 「添加插件」弹窗：包名 / GitHub 仓库地址 / 本地目录 三种来源，对齐 DSH 的添加向导。
//
// 安装源：官方源或中国大陆镜像源（npm 走 registry 镜像，GitHub 走代理前缀并逐个回退）。
//
// 安全提示照抄 DSH 的口径并保留其含义：插件以你的权限在本机运行，来源不明可能损坏应用
// 或读取泄露数据；且当前版本不支持自动更新（升级需先卸载再装新版）。

const VERDICT_LABEL: Record<string, string> = {
  runnable: "可以运行",
  partial: "部分兼容",
  unsupported: "无法运行",
  pending: "安装后检查",
};

function verdictClass(verdict?: string) {
  if (verdict === "runnable") return "ok";
  if (verdict === "partial") return "warn";
  if (verdict === "pending") return "warn";
  return "bad";
}

export function AddPluginDialog({ onClose, onInstalled, initialSpec = "" }: { onClose: () => void; onInstalled: () => void; initialSpec?: string }) {
  const [input, setInput] = useState(initialSpec);
  const [version, setVersion] = useState("");
  const [source, setSource] = useState<"default" | "cn" | "custom">("default");
  const [customRegistry, setCustomRegistry] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceWrapRef = useRef<HTMLDivElement | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [allowIncompatible, setAllowIncompatible] = useState(false);
  const [compat, setCompat] = useState<PluginCompatibility | null>(null);
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

  useEffect(() => {
    if (!sourceOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!sourceWrapRef.current?.contains(event.target as Node)) setSourceOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [sourceOpen]);

  const SOURCE_OPTIONS = [
    { id: "default", label: "官方源", hint: "registry.npmjs.org" },
    { id: "cn", label: "中国大陆镜像源", hint: "registry.npmmirror.com" },
    { id: "custom", label: "自定义地址", hint: "" },
  ] as const;
  const sourceLabel = SOURCE_OPTIONS.find((option) => option.id === source)?.label || "官方源";

  const check = async (override?: string) => {
    const probe = String(override ?? input ?? "").trim();
    if (!bridge?.checkPluginCompatibility || !probe) return;
    setBusy("check");
    setError("");
    setCompat(null);
    setLog("");
    try {
      // GitHub / 本地来源先要装进 profile 才能判定，这里只对包名做预检
      if (/^[\w@./-]+$/.test(probe) && !/^[.~/]/.test(probe) && !probe.includes("github.com")) {
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
      const entry = list?.entries?.find((item) => item.name === bundle?.packageName || item.name === name);
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
        version: version.trim() || undefined,
        source,
        customRegistry: source === "custom" ? customRegistry : undefined,
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
      onInstalled();
      onClose();
    } catch (enableError: any) {
      setError(String(enableError?.message || enableError));
    } finally {
      setBusy("");
    }
  };

  return createPortal(
    <div className="dialog-overlay" role="dialog" aria-label="添加插件">
      <div className="add-plugin-dialog">
        {result ? (
          <div className="install-result">
            <header className="add-plugin-header">
              <button className="icon-button subtle" onClick={onClose} aria-label="关闭"><X size={16} /></button>
            </header>

            <div className={`install-result-mark ${result.ok ? "ok" : "bad"}`}>
              {result.ok ? <Check size={26} /> : <AlertTriangle size={26} />}
            </div>
            <h3 className="install-result-title">{result.ok ? "已安装" : result.incompatible ? (result.verdict === "partial" ? "部分功能不可用" : "无法运行") : "安装失败"}</h3>

            <div className="install-result-card">
              <strong>{result.name}</strong>
              {result.description ? <p>{result.description}</p> : null}
              {result.version ? <span className="install-result-version">版本 {result.version}</span> : null}
            </div>

            <div className="install-result-details">
              <button className="add-plugin-guide-toggle" onClick={() => setResult({ ...result, detailOpen: !result.detailOpen })} aria-expanded={Boolean(result.detailOpen)}>
                <ChevronDown size={14} className={result.detailOpen ? "rotated" : ""} /> 查看安装详情
              </button>
              {result.detailOpen && (
                <div className="install-result-detail-body">
                  <div className="install-result-meta">
                    <span>来源：{{ npm: "npm 包", github: "GitHub 仓库", local: "本地目录" }[result.source || ""] || result.source || "—"}</span>
                    {result.version ? <span>版本：{result.version}</span> : null}
                    {result.dir ? <span>插件目录：{result.dir}</span> : null}
                    {result.patchFile ? <span>清单：{result.patchFile}</span> : null}
                  </div>
                  {result.reasons?.length ? <ul>{result.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
                  {result.matrix ? <pre>{result.matrix}</pre> : null}
                </div>
              )}
            </div>

            {result.ok ? (
              <button className="add-plugin-submit" onClick={() => void enableInstalled()} disabled={busy === "enable"}>
                {busy === "enable" ? <Loader2 size={14} className="spin" /> : null} 立即启用
              </button>
            ) : (
              <div className="install-result-actions">
                <button className="plugins-text-button" onClick={() => setResult(null)}>返回</button>
                {result.incompatible && <button className="add-plugin-submit" onClick={() => void install(true)} disabled={busy === "install"}>
                  {busy === "install" ? <Loader2 size={14} className="spin" /> : null} 仍然安装（部分功能可能不可用）
                </button>}
              </div>
            )}
            {error && <div className="plugins-message bad"><AlertTriangle size={14} /> <span>{error}</span></div>}
          </div>
        ) : (
        <>
        <header className="add-plugin-header">
          <h2>添加插件</h2>
          <button className="icon-button subtle" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>

        <p className="add-plugin-sub">输入插件的包名、GitHub 仓库地址或本地目录路径。</p>

        <input
          className="add-plugin-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="例如 dsh-plugin-whale-pet，或 https://github.com/owner/repo，或 /path/to/plugin"
          spellCheck={false}
          autoFocus
        />

        <div className="add-plugin-row">
          <input
            className="add-plugin-version"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="版本（仅包名来源可用）"
            spellCheck={false}
          />
          <div className="add-plugin-source-wrap" ref={sourceWrapRef}>
            <button className="add-plugin-source-button" onClick={() => setSourceOpen((open) => !open)} aria-expanded={sourceOpen}>
              安装源 <strong>{sourceLabel}</strong>
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

        {/^\s*(https?:\/\/)?(www\.)?github\.com\//i.test(input) || /^[.~/]/.test(input.trim()) ? (
          <div className="add-plugin-build-note">
            GitHub 或本地目录需要包含已经构建好的插件文件。安装默认不运行插件的安装脚本；只有源码时，请先在可信环境构建，或使用作者发布的包名安装。
          </div>
        ) : null}

        {source === "custom" && customRegistry.trim() ? (
          <div className="add-plugin-mirror-note">
            自定义源：<code>{customRegistry.trim()}</code>（npm 会带 <code>--registry</code> 使用它；需要登录的源请把凭据写进本机 <code>~/.npmrc</code>）
          </div>
        ) : null}

        {source === "cn" ? (
          <div className="add-plugin-mirror-note">
            大陆镜像源：npm 走 <code>registry.npmmirror.com</code>；GitHub 走第三方代理（ghfast.top / gh-proxy.com / ghproxy.net，逐个回退）。
            <strong>代理会经手你拉取的代码</strong>，仅在直连不通时使用。
          </div>
        ) : null}

        <div className="add-plugin-warning">
          <AlertTriangle size={15} />
          <div>
            <p>请确认插件来源可信。插件在本机以你的权限运行，来源不明的插件可能损坏 DYWorker，或读取和泄露你的数据。</p>
            <p>插件不会自动更新。升级时直接添加同一插件的新版本；安装或启动失败会保留原有版本。</p>
          </div>
        </div>

        <label className="add-plugin-allow">
          <input type="checkbox" checked={allowIncompatible} onChange={(event) => setAllowIncompatible(event.target.checked)} />
          允许安装不完全兼容的插件（可能装载后不生效）
        </label>

        {error && <div className="plugins-message bad"><AlertTriangle size={14} /> <span>{error}</span></div>}
        {log && !error && <pre className="add-plugin-log">{log}</pre>}
        {compat && (
          <div className={`plugins-compat ${verdictClass(compat.verdict)}`}>
            <div className="plugins-compat-head">
              {compat.verdict === "runnable" ? <Check size={14} /> : <AlertTriangle size={14} />}
              <strong>{compat.name}{compat.version ? `@${compat.version}` : ""}</strong>
              <span>{VERDICT_LABEL[compat.verdict] || compat.verdict}</span>
            </div>
            <ul>{compat.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
        )}

        <div className="add-plugin-actions">
          <button className="plugins-text-button" onClick={() => void check()} disabled={!target || Boolean(busy)}>
            {busy === "check" ? <Loader2 size={14} className="spin" /> : null} 检查兼容性
          </button>
          <button className="add-plugin-submit" onClick={() => void install()} disabled={!target || Boolean(busy)}>
            {busy === "install" ? <Loader2 size={14} className="spin" /> : null} 安装
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
