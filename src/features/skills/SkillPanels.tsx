import { ArrowUpRight, FileCode2, FolderOpen, LoaderCircle, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { defaultSettings } from "../../lib/settings";
import type { ProviderSettings, SkillLibraryConfig, SkillLibrarySearchResult, SkillRecord } from "../../types";

// 「总结为工作模板」的草稿确认对话框：模型生成初稿，用户可改，确认后写入技能库
export function SkillDraftDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: { name: string; description: string; instructions: string };
  onClose: () => void;
  onSaved: (item?: SkillRecord) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim()) {
      setError("请填写模板名称");
      return;
    }
    if (!window.dyworker?.createSkill) {
      setError("当前预览环境没有保存技能的通道");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await window.dyworker.createSkill({
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
      });
      if (!result.ok) {
        setError(result.error || "保存失败");
        return;
      }
      onSaved(result.item);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => !saving && onClose()}>
      <div
        className="skill-draft-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="保存为工作模板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3>保存为工作模板</h3>
        <p className="dialog-note">确认后保存进技能库，之后的任务里可以用 / 引用它。</p>
        <label className="skill-draft-field">
          <span>模板名称</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：周报汇总" autoFocus />
        </label>
        <label className="skill-draft-field">
          <span>一句话简介</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="什么时候该用它" />
        </label>
        <label className="skill-draft-field">
          <span>执行要求</span>
          <textarea
            rows={10}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Markdown 分步描述可复用的做法…"
            spellCheck={false}
          />
        </label>
        {error && <p className="error-text skill-draft-error">{error}</p>}
        <div className="skill-draft-actions">
          <button type="button" className="button-secondary" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="button-primary" onClick={() => void save()} disabled={saving}>
            {saving ? "保存中…" : "保存到技能库"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 设置面板里手动编辑工作模板（内置与本地模板都可编辑；文件技能提示改源文件）
export function SkillEditDialog({
  skill,
  onClose,
  onSaved,
}: {
  skill: SkillRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [instructions, setInstructions] = useState(skill.instructions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim()) {
      setError("请填写模板名称");
      return;
    }
    if (!window.dyworker?.updateSkill) {
      setError("当前预览环境没有保存技能的通道");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await window.dyworker.updateSkill({
        id: skill.id,
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
      });
      if (!result.ok) {
        setError(result.error || "保存失败");
        return;
      }
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop stacked" role="presentation" onMouseDown={() => !saving && onClose()}>
      <div
        className="skill-draft-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="编辑工作模板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3>编辑工作模板</h3>
        <p className="dialog-note">修改立即生效，之后的任务按新内容执行。</p>
        <label className="skill-draft-field">
          <span>模板名称</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <label className="skill-draft-field">
          <span>一句话简介</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label className="skill-draft-field">
          <span>执行要求</span>
          <textarea
            rows={10}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            spellCheck={false}
          />
        </label>
        {error && <p className="error-text skill-draft-error">{error}</p>}
        <div className="skill-draft-actions">
          <button type="button" className="button-secondary" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="button-primary" onClick={() => void save()} disabled={saving}>
            {saving ? "保存中…" : "保存修改"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SkillsPanel({
  items,
  onToggle,
  onDelete,
  onEdit,
  onRefresh,
  onOpen,
  onCreate,
}: {
  items: SkillRecord[];
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (skill: SkillRecord) => void;
  onRefresh: () => void;
  onOpen: (skill: SkillRecord) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState("");
  const filteredItems = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return items;
    return items.filter((skill) => [skill.name, skill.description, skill.path, skill.sourceLabel]
      .some((value) => String(value || "").toLowerCase().includes(text)));
  }, [items, query]);

  return (
    <div className="skills-panel">
      <div className="skill-management-head skill-management-head-enhanced">
        <div>
          <div className="skill-management-title">
            <strong>已安装技能</strong>
            <span className="skill-count-badge">{items.length}</span>
          </div>
          <small>自动读取用户目录与当前工作区中的 SKILL.md</small>
        </div>
        <div className="skill-management-actions">
        <button type="button" className="button-primary" onClick={onCreate}><Plus size={13} />创建技能</button>
        <button type="button" className="button-secondary" onClick={onRefresh}>
          <RefreshCw size={13} />
          刷新技能
        </button>
        </div>
      </div>
      <div className="skill-search-field">
        <Search size={14} />
        <input
          value={query}
          aria-label="搜索已安装技能"
          placeholder="搜索名称、用途或路径"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button type="button" className="skill-search-clear" onClick={() => setQuery("")} aria-label="清除技能搜索">
            <X size={13} />
          </button>
        )}
      </div>
      {items.length > 0 && (
        <div className="skill-list-summary">
          <span>{query.trim() ? `找到 ${filteredItems.length} 个技能` : `共 ${items.length} 个技能`}</span>
          <span>{items.filter((skill) => skill.enabled).length} 个已启用</span>
        </div>
      )}
      {!items.length ? (
        <div className="skill-empty-state">
          <FileCode2 size={18} />
          <strong>还没有发现技能</strong>
          <p>可放在 ~/.agents/skills、~/.agent/skills、~/.codex/skills，或当前工作区对应的技能目录中。</p>
        </div>
      ) : !filteredItems.length ? (
        <div className="skill-empty-state">
          <Search size={18} />
          <strong>没有匹配的技能</strong>
          <p>换个名称、用途关键词，或清除搜索条件。</p>
          <button type="button" className="button-secondary" onClick={() => setQuery("")}>清除搜索</button>
        </div>
      ) : (
        <div className="panel-list skill-list">
          {filteredItems.map((skill) => (
            <div className={`skill-item ${skill.enabled ? "" : "disabled"}`} key={skill.id}>
              <div className="skill-item-head">
                <div className="skill-name-block">
                  <div className="skill-title-row">
                    <strong title={skill.description}>{skill.name}</strong>
                    <span className={`skill-source-badge ${skill.source || "saved"}`}>{skill.sourceLabel || "本地模板"}</span>
                  </div>
                  {skill.description && <p className="skill-desc" title={skill.description}>{skill.description}</p>}
                </div>
                <label className="skill-switch" title={skill.availabilityReason || (skill.enabled ? "点击停用" : "点击启用")}>
                  <input type="checkbox" checked={skill.enabled} disabled={Boolean(skill.availabilityReason)} onChange={(event) => onToggle(skill.id, event.target.checked)} />
                </label>
              </div>
              {(skill.path || !skill.readOnly) && (
                <div className="skill-item-foot">
                  {skill.path ? <small className="skill-path" title={skill.path}>{skill.path}</small> : <span />}
                  <div className="skill-actions">
                    {skill.path && (
                      <button className="icon-button subtle tiny" onClick={() => onOpen(skill)} aria-label={`打开技能 ${skill.name}`}>
                        <FolderOpen size={13} />
                      </button>
                    )}
                    {!skill.readOnly && (
                      <button className="icon-button subtle tiny" onClick={() => onEdit(skill)} aria-label={`编辑技能 ${skill.name}`}>
                        <Pencil size={13} />
                      </button>
                    )}
                    {!skill.readOnly && (
                      <button className="icon-button subtle tiny" onClick={() => onDelete(skill.id)} aria-label={`删除技能 ${skill.name}`}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SkillLibrariesPanel({ value, onSave, onRefreshSkills }: {
  value: ProviderSettings;
  onSave: (value: ProviderSettings, successMessage?: string) => Promise<boolean>;
  onRefreshSkills: () => void | Promise<void>;
}) {
  const libraries = value.skillLibraries ?? defaultSettings.skillLibraries;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillLibrarySearchResult[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [installingSlug, setInstallingSlug] = useState("");
  const [saving, setSaving] = useState(false);

  const search = async (nextQuery = query) => {
    const text = nextQuery.trim();
    setSearching(true);
    setWarnings([]);
    try {
      const response = await window.dyworker?.searchSkillLibraries(text);
      if (!response?.ok) {
        setResults([]);
        setWarnings([response?.error || "技能库搜索失败"]);
        return;
      }
      setResults(response.results || []);
      setWarnings(response.warnings || []);
    } catch (error) {
      setResults([]);
      setWarnings([error instanceof Error ? error.message : String(error)]);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    void search("");
  }, []);

  const saveLibraries = async (next: SkillLibraryConfig[], message: string) => {
    setSaving(true);
    try {
      await onSave({ ...value, skillLibraries: next }, message);
    } finally {
      setSaving(false);
    }
  };

  const install = async (result: SkillLibrarySearchResult) => {
    setInstallingSlug(`${result.libraryId}:${result.slug}`);
    setWarnings([]);
    try {
      const response = await window.dyworker?.installSkillFromLibrary({ libraryId: result.libraryId, slug: result.slug });
      if (!response?.ok) {
        setWarnings([response?.error || "技能安装失败"]);
        return;
      }
      await onRefreshSkills();
      setWarnings([`已安装「${result.name}」，现在可以在“技能”中启用或使用。`]);
    } catch (error) {
      setWarnings([error instanceof Error ? error.message : String(error)]);
    } finally {
      setInstallingSlug("");
    }
  };

  return (
    <div className="skill-libraries-panel">
      <div className="skill-library-intro">
        <div>
          <span className="dialog-kicker">资源中心</span>
          <h3>发现新技能</h3>
        </div>
        <p>从技能库查找可复用能力，安装后会出现在“技能”列表中。</p>
      </div>
      <div className="dialog-section-title">技能库来源</div>
      <div className="panel-list skill-library-list">
        {libraries.map((library) => (
          <div className={`skill-library-row ${library.enabled ? "" : "disabled"}`} key={library.id}>
            <label className="skill-switch" title={library.enabled ? "点击停用" : "点击启用"}>
              <input
                type="checkbox"
                checked={library.enabled}
                disabled={saving}
                onChange={(event) => void saveLibraries(
                  libraries.map((item) => item.id === library.id ? { ...item, enabled: event.target.checked } : item),
                  `${library.name}已${event.target.checked ? "启用" : "停用"}`,
                )}
              />
            </label>
            <span className="mcp-server-name skill-library-name">
              <strong>{library.name}</strong>
              <small>{library.description || "未填写说明"}</small>
            </span>
            {library.websiteUrl && <a className="skill-library-link" href={library.websiteUrl} target="_blank" rel="noreferrer">打开官网 <ArrowUpRight size={12} /></a>}
          </div>
        ))}
      </div>

      <div className="dialog-section-title">搜索并安装</div>
      <p className="dialog-note">当前接入 SkillHub。需要先在本机安装 SkillHub CLI；安装时会写入用户技能目录，DYWorker 刷新后即可识别。</p>
      <div className="skill-library-search-form">
        <div className="skill-search-field">
          <Search size={14} />
          <input
            value={query}
            aria-label="搜索技能库"
            placeholder="搜索技能名称或用途，例如：PDF、网页自动化"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
          />
          {query && (
            <button type="button" className="skill-search-clear" onClick={() => { setQuery(""); void search(""); }} aria-label="清除技能库搜索">
              <X size={13} />
            </button>
          )}
        </div>
        <button type="button" className="button-secondary" onClick={() => void search()} disabled={searching}>
          {searching ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />}
          搜索
        </button>
      </div>
      {warnings.map((warning) => <p className="skill-library-message" key={warning}>{warning}</p>)}
      <div className="skill-library-results-head">
        <div>
          <strong>{query.trim() ? "搜索结果" : "技能列表"}</strong>
          <small>{searching ? "正在加载…" : results.length ? `显示 ${results.length} 个，可直接安装` : "暂时没有可显示的技能"}</small>
        </div>
        <button type="button" className="icon-button subtle tiny" onClick={() => void search()} disabled={searching} aria-label="刷新技能列表" title="刷新技能列表">
          <RefreshCw size={13} className={searching ? "spin" : ""} />
        </button>
      </div>
      {results.length ? (
        <div className="skill-library-results">
          {results.map((result) => {
            const installing = installingSlug === `${result.libraryId}:${result.slug}`;
            return (
              <div className="skill-library-result" key={`${result.libraryId}:${result.slug}`}>
                <div className="skill-library-result-mark"><Sparkles size={15} /></div>
                <div className="skill-library-result-main">
                  <div className="skill-library-result-title">
                    <strong>{result.name}</strong>
                    <span>{result.libraryName}</span>
                  </div>
                  <small>{result.slug}{result.version ? ` · ${result.version}` : ""}</small>
                  {result.description && <p>{result.description}</p>}
                </div>
                <button type="button" className="button-secondary" onClick={() => void install(result)} disabled={Boolean(installingSlug)}>
                  {installing ? <LoaderCircle size={13} className="spin" /> : <Plus size={13} />}
                  {installing ? "安装中…" : "安装"}
                </button>
              </div>
            );
          })}
        </div>
      ) : !searching ? (
        <div className="skill-library-empty">
          <Sparkles size={18} />
          <strong>{query.trim() ? "没有找到匹配技能" : "暂时没有技能列表"}</strong>
          <p>{query.trim() ? "换个关键词再试试。" : "请确认 SkillHub CLI 已安装，并检查网络连接。"}</p>
        </div>
      ) : null}
    </div>
  );
}
