import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Cookie, Database, History, KeyRound, X } from "lucide-react";
import type { BrowserImportKinds, BrowserImportSource } from "../../types";
import { BrowserBrandMark } from "./BrowserBrandMark";
import type { BrowserPasswordEntry } from "./browserUtils";

// 从浏览器导入（对照 Codex）：选择来源浏览器 + 用户画像 + 分类开关（密码/Cookie/浏览记录）
export function BrowserImportDialog({ onClose, onDone, onError }: { onClose: () => void; onDone: (message: string) => void; onError: (message: string) => void }) {
  const [sources, setSources] = useState<BrowserImportSource[] | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [kinds, setKinds] = useState<BrowserImportKinds>({ passwords: true, cookies: true, history: true, localstorage: true });
  const [busy, setBusy] = useState(false);
  const [resultText, setResultText] = useState("");
  const [resultCounts, setResultCounts] = useState<Record<keyof BrowserImportKinds, number> | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!window.dyworker?.listImportableBrowsers) {
      setSources([]);
      return;
    }
    void window.dyworker.listImportableBrowsers()
      .then((list) => {
        if (cancelled) return;
        setSources(list);
        const first = list[0];
        if (first) setSelectedKey(`${first.id}|${first.userDataDir}`);
      })
      .catch(() => { if (!cancelled) setSources([]); });
    return () => { cancelled = true; };
  }, []);

  const selected = sources?.find((item) => `${item.id}|${item.userDataDir}` === selectedKey) || null;
  // 切换浏览器后画像选择回到该浏览器的第一个画像
  const effectiveProfileId = selected?.profiles.some((profile) => profile.id === profileId)
    ? profileId
    : selected?.profiles[0]?.id || "Default";
  const anyKindOn = kinds.passwords || kinds.cookies || kinds.history || kinds.localstorage;

  const runImport = async () => {
    if (!selected || !window.dyworker?.importBrowserData) return;
    if (busy) return;
    setBusy(true);
    setResultText("");
    setResultCounts(null);
    setWarnings([]);
    try {
      const result = await window.dyworker.importBrowserData({
        id: selected.id,
        userDataDir: selected.userDataDir,
        profileId: effectiveProfileId,
        kinds,
      });
      if (!result.ok) {
        onError(result.error || "导入失败");
        onClose();
        return;
      }
      const parts: string[] = [];
      if (kinds.passwords) parts.push(`${result.passwords ?? 0} 个密码`);
      if (kinds.cookies) parts.push(`${result.cookies ?? 0} 条 Cookie`);
      if (kinds.history) parts.push(`${result.history ?? 0} 条浏览记录`);
      if (kinds.localstorage) parts.push(`${result.localStorageOrigins ?? 0} 个站点的本地数据`);
      const summary = `已从${result.browser}导入 ${parts.join("、")}`
        + (result.weakProtection ? "（当前系统没有密钥链，密码以弱保护方式存储）" : "");
      setWarnings(result.warnings || []);
      setResultText(summary);
      setResultCounts({
        passwords: Number(result.passwords ?? 0),
        cookies: Number(result.cookies ?? 0),
        history: Number(result.history ?? 0),
        localstorage: Number(result.localStorageKeys ?? 0),
      });
      onDone(summary);
    } catch (importError) {
      onError(`导入失败：${importError instanceof Error ? importError.message : String(importError)}`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const kindRows: { key: keyof BrowserImportKinds; label: string; icon: typeof KeyRound; unit: string; note?: string }[] = [
    { key: "passwords", label: "已保存的密码", icon: KeyRound, unit: "个" },
    { key: "cookies", label: "Cookie", icon: Cookie, unit: "条" },
    { key: "history", label: "浏览记录", icon: History, unit: "条" },
    { key: "localstorage", label: "站点数据", icon: Database, unit: "项", note: "localStorage，kimi 等新站点的登录态在这里" },
  ];

  return (
    <div className="dialog-overlay" role="presentation" onClick={onClose}>
      <div className="browser-import-dialog" role="dialog" aria-modal="true" aria-label="从浏览器导入" onClick={(event) => event.stopPropagation()}>
        <div className="browser-import-header">
          <div className="browser-import-title">
            <strong>从浏览器导入</strong>
            <span>选择要导入到内置浏览器的数据</span>
          </div>
          <button className="icon-button subtle tiny" onClick={onClose} aria-label="关闭" title="关闭"><X size={15} /></button>
        </div>
        {sources === null ? (
          <p className="panel-empty">正在检测本机浏览器…</p>
        ) : !sources.length ? (
          <p className="panel-empty">没有检测到可导入的浏览器。支持 Chrome、Edge、Chromium、Brave，以及国产 Linux 环境下的 360 安全浏览器和奇安信可信浏览器。</p>
        ) : (
          <>
            <div className="browser-import-from">
              <span className="browser-import-from-label">从</span>
              <div className="browser-import-picker" data-menu-root>
                <button
                  className="browser-import-picker-button"
                  aria-haspopup="listbox"
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerOpen((value) => !value)}
                >
                  {selected && <BrowserBrandMark id={selected.id} name={selected.name} />}
                  <span className="browser-import-picker-name">{selected?.name || "选择浏览器"}</span>
                  <ChevronDown size={14} />
                </button>
                {pickerOpen && (
                  <div className="browser-import-picker-menu" role="listbox" aria-label="选择浏览器">
                    {sources.map((source) => {
                      const key = `${source.id}|${source.userDataDir}`;
                      return (
                        <button
                          role="option"
                          aria-selected={key === selectedKey}
                          className={key === selectedKey ? "active" : ""}
                          key={key}
                          onClick={() => { setSelectedKey(key); setPickerOpen(false); }}
                        >
                          <BrowserBrandMark id={source.id} name={source.name} />
                          <span className="browser-import-picker-name">{source.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            {selected && selected.profiles.length > 1 && (
              <div className="browser-import-from">
                <span className="browser-import-from-label">画像</span>
                <select
                  className="browser-import-profile-select"
                  value={effectiveProfileId}
                  onChange={(event) => setProfileId(event.target.value)}
                  aria-label="选择用户画像"
                >
                  {selected.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                  ))}
                </select>
              </div>
            )}
            {selected && <p className="browser-import-hint">导入前，请完全关闭 {selected.name}</p>}
            <div className="browser-import-kinds">
              {kindRows.map((row) => {
                const Icon = row.icon;
                const on = kinds[row.key];
                const imported = resultCounts && on ? resultCounts[row.key] : null;
                return (
                  <div className="browser-import-kind-row" key={row.key}>
                    <Icon size={18} />
                    <span>
                      {row.label}
                      {row.note && <small>{row.note}</small>}
                    </span>
                    {imported !== null && (
                      <em className="browser-import-kind-count">
                        <Check size={13} />已导入 {imported} {row.unit}
                      </em>
                    )}
                    <button
                      className={`browser-import-switch ${on ? "on" : ""}`}
                      role="switch"
                      aria-checked={on}
                      aria-label={row.label}
                      disabled={busy}
                      onClick={() => setKinds((current) => ({ ...current, [row.key]: !current[row.key] }))}
                    >
                      <span className="browser-import-switch-thumb" />
                    </button>
                  </div>
                );
              })}
            </div>
            {warnings.map((warning) => (
              <p className="browser-import-warning" key={warning}><AlertTriangle size={13} aria-hidden="true" />{warning}</p>
            ))}
            <div className="browser-import-actions">
              {resultText ? (
                <button className="button-primary" onClick={onClose}>完成</button>
              ) : (
                <>
                  <button className="button-secondary" onClick={onClose}>取消</button>
                  <button className="button-primary" disabled={!selected || !anyKindOn || busy} onClick={() => void runImport()}>
                    {busy ? "正在导入…" : "导入"}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 已保存的密码管理：列表（站点/用户名/来源）、按条显示明文、删除；
// 当前页 origin 匹配的条目可直接填充到页面
export function BrowserSectionDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="browser-section-dialog" aria-labelledby="browser-section-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2 id="browser-section-title">{title}</h2><button autoFocus className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={18} /></button></header>
    <div className="browser-section-body">{children}</div>
  </dialog>;
}

export function BrowserPasswordsDialog({
  activeOrigin,
  onFill,
  onClose,
}: {
  activeOrigin: string;
  onFill: () => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<BrowserPasswordEntry[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void window.dyworker?.listPasswords?.("").then((result) => {
      if (!cancelled) setEntries(result?.passwords || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const entryKey = (entry: BrowserPasswordEntry) => `${entry.origin}\n${entry.username}`;
  const toggleReveal = async (entry: BrowserPasswordEntry) => {
    const key = entryKey(entry);
    if (revealed[key]) {
      setRevealed((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    const result = await window.dyworker?.revealPassword?.(entry.origin, entry.username);
    if (!result?.ok || !result.password) {
      setError(result?.error || "无法读取密码");
      return;
    }
    setError("");
    setRevealed((current) => ({ ...current, [key]: result.password || "" }));
  };
  const removeEntry = async (entry: BrowserPasswordEntry) => {
    if (!window.confirm(`确定删除 ${entry.origin} 的已保存密码吗？删除后无法恢复。`)) return;
    const result = await window.dyworker?.deletePassword?.(entry.origin, entry.username);
    if (!result?.ok) {
      setError(result?.error || "删除失败");
      return;
    }
    setEntries((current) => current.filter((item) => entryKey(item) !== entryKey(entry)));
  };

  return (
    <div className="dialog-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="skill-draft-dialog browser-passwords-dialog" role="dialog" aria-modal="true" aria-label="密码和自动填充">
        <div className="dialog-header">
          <h2>密码和自动填充</h2>
          <button className="icon-button subtle" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="browser-passwords-hint">
          保存的密码经系统加密存储（与导入的密码同库）。在页面提交登录表单时会询问是否保存；
          再次打开对应站点时可通过「填充已保存的密码」一键填写。
        </p>
        {error && <p className="error-text">{error}</p>}
        {entries.length ? (
          <div className="browser-password-list">
            {entries.map((entry) => {
              const key = entryKey(entry);
              const canFill = Boolean(activeOrigin) && entry.origin === activeOrigin;
              return (
                <div className="browser-password-row" key={key}>
                  <div className="browser-password-copy">
                    <strong>{entry.origin.replace(/^https?:\/\//i, "")}</strong>
                    <span>{entry.username || "（无用户名）"} · {entry.source || "导入"}</span>
                    {revealed[key] && <code>{revealed[key]}</code>}
                  </div>
                  <div className="browser-password-actions">
                    <button onClick={() => void toggleReveal(entry)}>{revealed[key] ? "隐藏" : "显示"}</button>
                    {canFill && <button className="primary" onClick={() => { onFill(); onClose(); }}>填充到当前页</button>}
                    <button className="danger" onClick={() => void removeEntry(entry)}>删除</button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="browser-passwords-empty">还没有保存的密码。在内置浏览器里登录网站时选择「保存」即可。</p>
        )}
      </div>
    </div>
  );
}
