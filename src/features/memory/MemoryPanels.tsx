import { LoaderCircle, Pencil, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { WikiMemoryPage, WikiMemoryRow } from "../../types";

// 设置面板里手动编辑一条记忆（内置记忆的修改以覆盖方式生效）
const MEMORY_KIND_LABELS: Record<string, string> = {
  preference: "偏好",
  rule: "规则",
  taboo: "禁忌",
  fact: "事实",
  experience: "经验",
};

export function MemoryEditDialog({
  row,
  onClose,
  onSaved,
}: {
  row: WikiMemoryRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row.name || "");
  const [category, setCategory] = useState(row.category || "");
  const [kind, setKind] = useState(row.kind || "fact");
  const [content, setContent] = useState(row.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!content.trim()) {
      setError("请填写记忆内容");
      return;
    }
    if (!window.dyworker?.updateMemory) {
      setError("当前预览环境没有保存记忆的通道");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await window.dyworker.updateMemory({
        id: row.id,
        name: name.trim(),
        category: category.trim(),
        kind,
        content: content.trim(),
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
        aria-label="编辑记忆"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3>编辑记忆</h3>
        {row.builtIn ? <p className="dialog-note">这是随应用发布的内置记忆，你的修改会覆盖默认内容。</p> : null}
        <label className="skill-draft-field">
          <span>名字（可选，方便按名字引用）</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：报销流程" autoFocus />
        </label>
        <div className="skill-draft-field">
          <span>类型</span>
          <div className="memory-filter-kinds" role="group" aria-label="记忆类型">
            {Object.entries(MEMORY_KIND_LABELS).map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={`memory-filter-chip${kind === value ? " active" : ""}`}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="skill-draft-field">
          <span>分类</span>
          <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="例如：用户偏好" />
        </label>
        <label className="skill-draft-field">
          <span>内容</span>
          <textarea
            rows={6}
            value={content}
            onChange={(event) => setContent(event.target.value)}
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

export function MemoriesPanel({ pages, onDelete, onEdit, onLint, linting, lintMessage }: {
  pages: WikiMemoryPage[];
  onDelete: (id: string) => void;
  onEdit: (row: WikiMemoryRow) => void;
  onLint: () => void;
  linting: boolean;
  lintMessage: string;
}) {
  const kindLabels: Record<string, string> = {
    preference: "偏好",
    rule: "规则",
    taboo: "禁忌",
    fact: "事实",
    experience: "经验",
  };
  const [memoryQuery, setMemoryQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const total = pages.reduce((sum, page) => sum + page.rows.length, 0);
  // 看板过滤：按关键词（名字/内容/分类）与记忆类型筛选，空结果保留卡片框架
  const queryText = memoryQuery.trim().toLowerCase();
  const filteredPages = useMemo(() => pages.map((page) => ({
    ...page,
    rows: page.rows.filter((row) => {
      if (kindFilter && row.kind !== kindFilter) return false;
      if (!queryText) return true;
      return [row.name, row.content, row.category].some((value) => String(value || "").toLowerCase().includes(queryText));
    }),
  })).filter((page) => page.rows.length), [pages, kindFilter, queryText]);
  return (
    <div className="panel-list">
      <div className="memory-wiki-toolbar">
        <span className="panel-hint">个人记忆知识库：{pages.length} 个页面 · {total} 条记忆。助手保存的新记忆会在任务结束后自动合并进页面。</span>
        <button type="button" className="button-secondary tiny" onClick={onLint} disabled={linting}>
          {linting ? <LoaderCircle className="spin" size={13} /> : null}
          {linting ? "整理中…" : "整理记忆"}
        </button>
      </div>
      {total > 0 && (
        <div className="memory-filter-bar">
          <div className="memory-filter-search">
            <Search size={13} />
            <input value={memoryQuery} onChange={(event) => setMemoryQuery(event.target.value)} placeholder="搜索名字、内容或分类" />
          </div>
          <div className="memory-filter-kinds" role="group" aria-label="按记忆类型过滤">
            <button type="button" className={`memory-filter-chip${kindFilter === "" ? " active" : ""}`} onClick={() => setKindFilter("")}>全部</button>
            {Object.entries(kindLabels).map(([kind, label]) => (
              <button
                type="button"
                key={kind}
                className={`memory-filter-chip${kindFilter === kind ? " active" : ""}`}
                onClick={() => setKindFilter(kindFilter === kind ? "" : kind)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {lintMessage ? <p className="dialog-note">{lintMessage}</p> : null}
      {!pages.length ? (
        <p className="panel-empty">助手在任务中发现长期有用的偏好和事实时，会自动保存在这里。</p>
      ) : !filteredPages.length ? (
        <p className="panel-empty">没有匹配的记忆，换个关键词或清除类型过滤试试。</p>
      ) : filteredPages.map((page) => (
        <div className="memory-item" key={page.relPath}>
          <div className="memory-item-head">
            <div className="memory-meta">
              <span className="memory-category">{page.title}</span>
              <span className="memory-badge">{page.relPath === "pages/session.md" ? "按任务会话绑定" : page.scope === "workspace" ? "当前工作区" : "全部工作区"}</span>
              <span className="memory-badge">{page.rows.length} 条</span>
            </div>
          </div>
          {page.rows.map((row) => (
            <div className="memory-row" key={`${page.relPath}:${row.id}`}>
              <div className="memory-row-head">
                {row.name ? <span className="memory-name" title={row.name}>「{row.name}」</span> : null}
                <span className="memory-badge">{kindLabels[row.kind] || row.kind || "事实"}</span>
                {/* 分类徽标：与页面标题或类型徽标重复时不显示，避免出现「经验 经验」 */}
                {row.category && row.category !== page.title && row.category !== (kindLabels[row.kind] || row.kind)
                  ? <span className="memory-badge subtle">{row.category}</span>
                  : null}
                {row.builtIn ? <span className="memory-badge subtle">内置</span> : null}
                {row.sessionId ? <span className="memory-badge subtle">仅本任务</span> : null}
                <button className="icon-button subtle tiny" onClick={() => onEdit(row)} aria-label="编辑这条记忆">
                  <Pencil size={13} />
                </button>
                {!row.builtIn && (
                  <button className="icon-button subtle tiny" onClick={() => onDelete(row.id)} aria-label="删除这条记忆">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <p>{row.content}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
